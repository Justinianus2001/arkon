"""
Phase 4 (VERIFY) of the MRP pipeline.

Three checks:
  4.1  Citation verification — LLM checks each [^N] claim against source excerpt
  4.2  Coverage check — entities with many mentions not covered by any page
  4.3  Conflict check — new page content may contradict existing KB pages

All checks are non-blocking for the pipeline: issues are flagged in logs and
in the page content (markers), but never cause the pipeline to fail.
"""

import asyncio
import json
import re
from typing import Optional

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.mrp.writer import PageWriteResult
from app.ai.providers.base import EmbeddingProvider, LLMProvider
from app.utils.progress import ProgressTracker

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

VERIFY_BATCH_SIZE = 5
CONFLICT_SIM_THRESHOLD = 0.80

# ---------------------------------------------------------------------------
# 4.1 Citation verification
# ---------------------------------------------------------------------------

VERIFY_SYSTEM = """\
You are a fact-checking assistant. For each claim below, check whether the
provided source excerpt supports the claim. Return a JSON array of exactly
{n} objects with keys "verdict" and "note".
verdict must be one of: SUPPORTED, PARTIAL, NOT_SUPPORTED, CONTRADICTED
Return ONLY the JSON array.
"""

VERIFY_PROMPT_TEMPLATE = """\
Check each claim against its source excerpt:

{claim_blocks}

Return JSON array of {n} objects: [{{"verdict": "SUPPORTED|PARTIAL|NOT_SUPPORTED|CONTRADICTED", "note": "string"}}]
"""


def _extract_citation_claims(content_md: str, citations: list[dict]) -> list[dict]:
    """
    Match each [^N] marker in content to its surrounding sentence and citation metadata.
    Returns list of {ref, claim_sentence, absolute_offset, evidence_length}.
    """
    results = []
    # Split into sentences (rough split on '. ' or '.\n')
    sentences = re.split(r'(?<=[.!?])\s+', content_md)

    for cit in citations:
        ref = cit.get("ref", "")
        if not ref:
            continue
        # Find the sentence containing this ref
        claim_sentence = ""
        for sent in sentences:
            if ref in sent:
                claim_sentence = sent.strip()
                break
        if not claim_sentence:
            claim_sentence = f"(claim with citation {ref})"
        results.append({
            "ref": ref,
            "claim_sentence": claim_sentence,
            "absolute_offset": cit.get("absolute_offset", 0),
            "evidence_length": cit.get("evidence_length", 200),
        })
    return results


def _apply_verdict(content_md: str, ref: str, verdict: str, note: str) -> str:
    """Modify content_md based on citation verdict."""
    if verdict == "SUPPORTED":
        return content_md
    elif verdict == "PARTIAL":
        # Add caveat note after the citation
        return content_md.replace(ref, f"{ref}[^caveat: {note[:80]}]", 1)
    elif verdict == "NOT_SUPPORTED":
        return content_md.replace(ref, f"[unverified]{ref}", 1)
    elif verdict == "CONTRADICTED":
        return content_md.replace(ref, f"[⚠ CONTRADICTED: {note[:80]}]{ref}", 1)
    return content_md


async def verify_page_citations(
    llm: LLMProvider,
    page_result: PageWriteResult,
    full_text: str,
) -> PageWriteResult:
    """
    Verify all citations in a page's content_md.
    Returns modified PageWriteResult with verdict markers applied.
    """
    if not page_result.citations:
        return page_result

    claim_items = _extract_citation_claims(page_result.content_md, page_result.citations)
    if not claim_items:
        return page_result

    content_md = page_result.content_md

    # Process in batches of VERIFY_BATCH_SIZE
    for batch_start in range(0, len(claim_items), VERIFY_BATCH_SIZE):
        batch = claim_items[batch_start: batch_start + VERIFY_BATCH_SIZE]
        claim_blocks = []
        for i, item in enumerate(batch):
            excerpt = full_text[item["absolute_offset"]: item["absolute_offset"] + item["evidence_length"]]
            claim_blocks.append(
                f"{i + 1}. Claim: \"{item['claim_sentence'][:300]}\"\n"
                f"   Source excerpt: \"{excerpt[:300]}\""
            )

        prompt = VERIFY_PROMPT_TEMPLATE.format(
            claim_blocks="\n\n".join(claim_blocks),
            n=len(batch),
        )
        system = VERIFY_SYSTEM.format(n=len(batch))

        try:
            raw = await asyncio.wait_for(
                llm.generate(prompt, system=system, temperature=0.0),
                timeout=60,
            )
            cleaned = raw.strip().strip("```json").strip("```").strip()
            verdicts = json.loads(cleaned)
            for i, item in enumerate(batch):
                if i < len(verdicts):
                    v = verdicts[i]
                    verdict = v.get("verdict", "SUPPORTED")
                    note = v.get("note", "")
                    if verdict != "SUPPORTED":
                        logger.debug(
                            f"MRP VERIFY citation {item['ref']} on '{page_result.slug}': "
                            f"{verdict} — {note[:100]}"
                        )
                    content_md = _apply_verdict(content_md, item["ref"], verdict, note)
        except Exception as exc:
            logger.warning(f"MRP VERIFY citation batch failed for '{page_result.slug}': {exc}")

    return PageWriteResult(
        slug=page_result.slug,
        title=page_result.title,
        page_type=page_result.page_type,
        action=page_result.action,
        content_md=content_md,
        summary=page_result.summary,
        citations=page_result.citations,
        entity_names=page_result.entity_names,
        related_kb_pages=page_result.related_kb_pages,
    )


# ---------------------------------------------------------------------------
# 4.2 Coverage check
# ---------------------------------------------------------------------------

def check_coverage(
    chunk_extracts: list,
    page_results: list[PageWriteResult],
    min_mentions: int = 3,
) -> list[str]:
    """
    Returns entity names mentioned >= min_mentions times in extracts
    but not covered by any page result. Logged as warnings (non-blocking).
    """
    # Count mentions per entity
    mention_counts: dict[str, int] = {}
    for row in chunk_extracts:
        for e in (row.extract_json or {}).get("entities", []):
            name = e.get("name", "").lower()
            if name:
                mention_counts[name] = mention_counts.get(name, 0) + 1

    # Collect all entity names covered by page results
    covered: set[str] = set()
    for pr in page_results:
        covered.update(n.lower() for n in pr.entity_names)
        covered.add(pr.title.lower())

    uncovered = [
        name for name, count in mention_counts.items()
        if count >= min_mentions and name not in covered
    ]

    if uncovered:
        logger.warning(
            f"MRP VERIFY coverage: {len(uncovered)} significant entities not covered: "
            + ", ".join(uncovered[:10])
        )

    return uncovered


# ---------------------------------------------------------------------------
# 4.3 Conflict check
# ---------------------------------------------------------------------------

async def check_conflicts(
    session: AsyncSession,
    page_results: list[PageWriteResult],
    embedding_provider: EmbeddingProvider,
    llm: LLMProvider,
    source,
) -> list[dict]:
    """
    For each new/updated page, find KB neighbors with high similarity and
    check for factual contradictions via LLM. Returns list of conflict dicts.
    Non-blocking: conflicts are logged and returned but don't fail the pipeline.
    """
    from app.services import wiki_service

    scope_type = source.scope_type or "global"
    scope_id = source.scope_id
    conflicts = []

    for pr in page_results:
        try:
            vec = await embedding_provider.embed(
                f"{pr.title}\n\n{pr.summary}\n\n{pr.content_md[:3000]}"
            )
            hits = await wiki_service.search_pages_semantic(
                session, vec, top_k=3, scope_type=scope_type, scope_id=scope_id,
            )
        except Exception:
            continue

        candidate_neighbors = [
            (page, sim) for page, sim in hits
            if sim >= CONFLICT_SIM_THRESHOLD and page.slug != pr.slug
        ]
        if not candidate_neighbors:
            continue

        for kb_page, sim in candidate_neighbors:
            prompt = (
                f"Do the following two texts contain contradictory factual statements?\n\n"
                f"Text A (new):\n{pr.content_md[:1500]}\n\n"
                f"Text B (existing wiki page '{kb_page.slug}'):\n{(kb_page.content_md or '')[:1500]}\n\n"
                f"Return JSON: {{\"contradicts\": true|false, \"description\": \"string\"}}"
            )
            try:
                raw = await asyncio.wait_for(
                    llm.generate(prompt, system="You are a fact-checking assistant. Return only JSON.", temperature=0.0),
                    timeout=30,
                )
                cleaned = raw.strip().strip("```json").strip("```").strip()
                result = json.loads(cleaned)
                if result.get("contradicts"):
                    desc = result.get("description", "")
                    conflicts.append({
                        "new_slug": pr.slug,
                        "existing_slug": kb_page.slug,
                        "similarity": sim,
                        "description": desc,
                    })
                    logger.warning(
                        f"MRP VERIFY conflict: '{pr.slug}' ↔ '{kb_page.slug}' (sim={sim:.2f}): {desc[:150]}"
                    )
            except Exception:
                pass

    return conflicts


# ---------------------------------------------------------------------------
# Phase 4 orchestrator
# ---------------------------------------------------------------------------

async def run_verify_phase(
    session: AsyncSession,
    source,
    page_results: list[PageWriteResult],
    chunk_extracts: list,
    full_text: str,
    llm: LLMProvider,
    embedding_provider: Optional[EmbeddingProvider],
    tracker: ProgressTracker,
) -> list[PageWriteResult]:
    """
    Run Phase 4 (VERIFY). Returns verified (and potentially modified) page results.

    All three checks run regardless of results — non-blocking.
    """
    await tracker.update(88, "Verifying citations...")

    # 4.1 Citation verification for all pages (parallel)
    async def _verify_one(pr: PageWriteResult) -> PageWriteResult:
        if not pr.citations or not full_text:
            return pr
        return await verify_page_citations(llm, pr, full_text)

    verified_results = await asyncio.gather(*[_verify_one(pr) for pr in page_results])
    verified_results = list(verified_results)

    await tracker.update(91, "Checking coverage...")

    # 4.2 Coverage check (code only, non-blocking)
    check_coverage(chunk_extracts, verified_results)

    await tracker.update(93, "Checking for conflicts...")

    # 4.3 Conflict check (non-blocking)
    if embedding_provider is not None:
        try:
            await check_conflicts(session, verified_results, embedding_provider, llm, source)
        except Exception as exc:
            logger.warning(f"MRP VERIFY conflict check failed: {exc}")

    logger.info(f"MRP VERIFY complete: {len(verified_results)} pages verified for source={source.id}")
    return verified_results
