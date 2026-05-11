"""
Phase 3 (REFINE) of the MRP pipeline.

Each page in the Compilation Plan gets a dedicated writer. The writer receives
pre-assembled evidence (claims + excerpts) so it never needs to scan the full
document — contrast with the old wiki_agent which did exploratory reading.

Two writer modes:
  - Simple: 1 llm.generate() call for pages with few evidence items
  - Complex: mini agent loop (max 10 steps, 3 tools) for large pages

All writers run in parallel (asyncio.Semaphore(MAX_WRITER_CONCURRENCY)).
"""

import asyncio
import json
from dataclasses import dataclass, field
from typing import Any, Optional

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.providers.base import EmbeddingProvider, LLMProvider
from app.utils.progress import ProgressTracker

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MAX_WRITER_CONCURRENCY = 4
WRITER_COMPLEX_THRESHOLD_EVIDENCE = 8
WRITER_COMPLEX_THRESHOLD_EXISTING_CHARS = 3_000
WRITER_AGENT_MAX_STEPS = 10
WRITER_AGENT_TIMEOUT = 120  # seconds per LLM call in complex writer

# ---------------------------------------------------------------------------
# Dataclass
# ---------------------------------------------------------------------------

@dataclass
class PageWriteResult:
    slug: str
    title: str
    page_type: str
    action: str          # CREATE | UPDATE
    content_md: str
    summary: str
    citations: list[dict] = field(default_factory=list)
    # [{"ref": "[^1]", "absolute_offset": int, "evidence_length": int}]
    entity_names: list[str] = field(default_factory=list)
    related_kb_pages: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Evidence assembly
# ---------------------------------------------------------------------------

def assemble_evidence(
    plan_item: dict,
    claims: list[dict],
    full_text: str,
) -> list[dict]:
    """
    Collect all claims whose subject matches any entity_name in the plan item.
    Attaches source_excerpt (up to 500 chars) from full_text for each claim.
    """
    entity_names_lower = {n.lower() for n in plan_item.get("entity_names", [])}
    evidence = []
    for claim in claims:
        subj = (claim.get("subject") or "").lower()
        if subj in entity_names_lower or any(name in subj for name in entity_names_lower):
            offset = claim.get("absolute_offset", 0)
            length = min(claim.get("evidence_length", 200), 500)
            excerpt = full_text[offset: offset + length] if full_text else ""
            evidence.append({
                "statement": claim.get("statement", ""),
                "subject": claim.get("subject", ""),
                "confidence": claim.get("confidence", "explicit"),
                "source_excerpt": excerpt,
                "absolute_offset": offset,
                "evidence_length": length,
            })
    return evidence


# ---------------------------------------------------------------------------
# System prompt (quality rules, same spirit as wiki_agent.py)
# ---------------------------------------------------------------------------

WRITER_SYSTEM = """\
You are an enterprise knowledge wiki writer. Write a single wiki page using
ONLY the evidence provided. Every factual claim must cite its source with a
footnote marker like [^1], [^2], etc.

Quality rules:
- Write in the SAME LANGUAGE as the source document.
- Open with a 2-4 sentence paragraph (no heading) defining what this thing is.
- Use H2 headings to group related facts. Each section starts with prose.
- Bold key terms on first mention.
- Use wikilinks [[slug]] or [[slug|display text]] to link to related pages.
- End with a ## See also section linking to related pages.
- Minimum lengths: concept/topic: 200 words; entity: 100 words; source: 150 words.
- Every page must link to at least 2 other pages.
- Do NOT write a page that is just a title + bullet list.
- Do NOT translate the content language.
- PRESERVE image markers verbatim: ![caption](image://<uuid>)
"""


# ---------------------------------------------------------------------------
# Simple writer — 1 LLM call
# ---------------------------------------------------------------------------

_SIMPLE_WRITER_PROMPT = """\
## Task
{action} the following wiki page.

## Page specification
- Slug: {slug}
- Title: {title}
- Type: {page_type}
- Related pages to cross-link: {related_pages}

{existing_section}

## Evidence ({evidence_count} items)
Use ONLY the evidence below. Cite each piece with [^N] footnotes.

{evidence_blocks}

## Instructions
Write the complete wiki page in markdown. Include [^N] citation markers
inline where you use each piece of evidence. End the page with a
## Citations section listing each footnote as:
[^1]: <brief source reference>

Return ONLY the markdown content, no other text.
"""


def _format_evidence_blocks(evidence: list[dict]) -> tuple[str, list[dict]]:
    """Format evidence for the prompt. Returns (formatted_string, citations_metadata)."""
    lines = []
    citations_meta = []
    for i, ev in enumerate(evidence, 1):
        lines.append(
            f"[^{i}] {ev['confidence'].upper()} — Subject: {ev['subject']}\n"
            f"Claim: {ev['statement']}\n"
            f"Source excerpt: \"{ev['source_excerpt'][:300]}\""
        )
        citations_meta.append({
            "ref": f"[^{i}]",
            "absolute_offset": ev["absolute_offset"],
            "evidence_length": ev["evidence_length"],
        })
    return "\n\n".join(lines), citations_meta


async def _write_page_simple(
    llm: LLMProvider,
    plan_item: dict,
    evidence: list[dict],
    existing_content: Optional[str],
    related_summaries: dict[str, str],
) -> tuple[str, str, list[dict]]:
    """
    Returns (content_md, summary, citations_meta).
    """
    related_pages = ", ".join(f"[[{s}]]" for s in plan_item.get("related_kb_pages", []))
    existing_section = (
        f"## Existing page content (UPDATE — integrate new evidence into this)\n\n{existing_content}\n"
        if existing_content else ""
    )
    evidence_blocks, citations_meta = _format_evidence_blocks(evidence)

    prompt = _SIMPLE_WRITER_PROMPT.format(
        action=plan_item.get("action", "CREATE"),
        slug=plan_item.get("slug", ""),
        title=plan_item.get("title", ""),
        page_type=plan_item.get("page_type", "concept"),
        related_pages=related_pages or "(none specified)",
        existing_section=existing_section,
        evidence_count=len(evidence),
        evidence_blocks=evidence_blocks or "(no evidence — write from plan spec only)",
    )

    raw = await asyncio.wait_for(
        llm.generate(prompt, system=WRITER_SYSTEM, temperature=0.15),
        timeout=180,
    )

    # Extract summary from first non-heading paragraph
    lines = raw.strip().splitlines()
    summary_lines = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("#"):
            continue
        if stripped:
            summary_lines.append(stripped)
            if len(" ".join(summary_lines)) > 100:
                break
    summary = " ".join(summary_lines)[:300]

    return raw.strip(), summary, citations_meta


# ---------------------------------------------------------------------------
# Complex writer — mini agent loop
# ---------------------------------------------------------------------------

_COMPLEX_WRITER_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "read_kb_page",
            "description": "Read the full markdown content of an existing wiki page.",
            "parameters": {
                "type": "object",
                "properties": {"slug": {"type": "string", "description": "Page slug"}},
                "required": ["slug"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_source_excerpt",
            "description": "Read more context from the source document by character offset.",
            "parameters": {
                "type": "object",
                "properties": {
                    "start_char": {"type": "integer"},
                    "length": {"type": "integer", "description": "Max 10000"},
                },
                "required": ["start_char"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "finish",
            "description": "Submit the completed wiki page content. Must be the final call.",
            "parameters": {
                "type": "object",
                "properties": {
                    "content_md": {"type": "string", "description": "Full markdown content with [^N] citations"},
                    "summary": {"type": "string", "description": "One-sentence summary"},
                },
                "required": ["content_md", "summary"],
            },
        },
    },
]

_COMPLEX_WRITER_SYSTEM = WRITER_SYSTEM + """

# Tool workflow
1. Optionally call read_kb_page for any related page you want to reference.
2. Optionally call read_source_excerpt to read more context from the source.
3. Call finish with the complete page content and summary.
"""


async def _write_page_complex(
    llm: LLMProvider,
    plan_item: dict,
    evidence: list[dict],
    existing_content: Optional[str],
    full_text: str,
    session: AsyncSession,
    source,
) -> tuple[str, str, list[dict]]:
    """
    Mini agent loop for pages with many evidence items or large existing content.
    Returns (content_md, summary, citations_meta).
    """
    from app.ai.agent_protocol import assistant_message_from_turn, tool_results_message
    from app.services import wiki_service

    scope_type = source.scope_type or "global"
    scope_id = source.scope_id

    evidence_blocks, citations_meta = _format_evidence_blocks(evidence)
    existing_section = (
        f"\n## Existing page content (UPDATE — integrate):\n{existing_content}\n"
        if existing_content else ""
    )
    related = ", ".join(plan_item.get("related_kb_pages", []))

    initial_msg = (
        f"Write a wiki page for: **{plan_item.get('title', '')}** "
        f"(slug: `{plan_item.get('slug', '')}`, type: {plan_item.get('page_type', 'concept')})\n"
        f"Action: {plan_item.get('action', 'CREATE')}\n"
        f"Related pages: {related or 'none'}\n"
        f"{existing_section}\n"
        f"## Evidence ({len(evidence)} items)\n{evidence_blocks}"
    )

    messages = [{"role": "user", "content": initial_msg}]
    result_content = None
    result_summary = None

    for step in range(WRITER_AGENT_MAX_STEPS):
        from app.ai.agent_protocol import AssistantTurn
        try:
            turn: AssistantTurn = await asyncio.wait_for(
                llm.generate_with_tools(
                    messages=messages,
                    tools=_COMPLEX_WRITER_TOOLS,
                    system=_COMPLEX_WRITER_SYSTEM,
                    temperature=0.15,
                ),
                timeout=WRITER_AGENT_TIMEOUT,
            )
        except Exception as e:
            logger.error(f"MRP complex writer LLM call failed at step {step}: {e}")
            raise

        messages.append(assistant_message_from_turn(turn))

        if not turn.tool_calls:
            break

        tool_results = []
        for call in turn.tool_calls:
            if call.name == "finish":
                result_content = call.arguments.get("content_md", "")
                result_summary = call.arguments.get("summary", "")
                tool_results.append((call.id, call.name, {"done": True}))
                break
            elif call.name == "read_kb_page":
                slug = call.arguments.get("slug", "")
                page = await wiki_service.get_page_by_slug(session, slug, scope_type=scope_type, scope_id=scope_id)
                if page:
                    result: Any = {"slug": page.slug, "title": page.title, "content_md": page.content_md}
                else:
                    result = {"error": f"Page '{slug}' not found"}
                tool_results.append((call.id, call.name, result))
            elif call.name == "read_source_excerpt":
                start = max(0, int(call.arguments.get("start_char", 0)))
                length = min(int(call.arguments.get("length", 5000)), 10000)
                excerpt = full_text[start: start + length] if full_text else ""
                tool_results.append((call.id, call.name, {"excerpt": excerpt, "start_char": start}))
            else:
                tool_results.append((call.id, call.name, {"error": f"Unknown tool: {call.name}"}))

        if result_content is not None:
            break

        messages.append(tool_results_message(tool_results))

    if result_content is None:
        # Agent didn't call finish — extract from last text response
        for msg in reversed(messages):
            if msg.get("role") == "assistant":
                content = msg.get("content", "")
                if isinstance(content, list):
                    for block in content:
                        if isinstance(block, dict) and block.get("type") == "text":
                            result_content = block.get("text", "")
                            break
                elif isinstance(content, str):
                    result_content = content
                if result_content:
                    break
        result_content = result_content or f"# {plan_item.get('title', '')}\n\n(content generation incomplete)"
        result_summary = plan_item.get("title", "")

    # Quick summary extraction if not provided
    if not result_summary:
        for line in result_content.splitlines():
            s = line.strip()
            if s and not s.startswith("#"):
                result_summary = s[:300]
                break
        result_summary = result_summary or plan_item.get("title", "")

    return result_content.strip(), result_summary, citations_meta


# ---------------------------------------------------------------------------
# Phase 3 orchestrator
# ---------------------------------------------------------------------------

async def run_refine_phase(
    session: AsyncSession,
    source,
    plan: "SourceCompilationPlan",
    chunk_extracts: list,
    full_text: str,
    llm: LLMProvider,
    embedding_provider: Optional[EmbeddingProvider],
    kt_slug: Optional[str],
    tracker: ProgressTracker,
) -> list[PageWriteResult]:
    """
    Run Phase 3 (REFINE): write all pages in the compilation plan in parallel.
    Returns list of PageWriteResult objects ready for Phase 4 (VERIFY).
    """
    from app.services import wiki_service

    plan_dict = plan.plan_json
    pages_spec = plan_dict.get("pages", [])
    all_claims = plan_dict.get("_claims", [])

    # Sort by priority (lower number = higher priority)
    pages_spec = sorted(pages_spec, key=lambda p: p.get("priority", 99))

    scope_type = source.scope_type or "global"
    scope_id = source.scope_id

    await tracker.update(78, f"Writing {len(pages_spec)} wiki pages...")

    semaphore = asyncio.Semaphore(MAX_WRITER_CONCURRENCY)

    async def _write_one(plan_item: dict) -> Optional[PageWriteResult]:
        async with semaphore:
            action = plan_item.get("action", "CREATE").upper()
            slug = plan_item.get("slug", "")
            title = plan_item.get("title", slug)
            page_type = plan_item.get("page_type", "concept")
            related_kb_pages = plan_item.get("related_kb_pages", [])

            # Assemble evidence
            evidence = assemble_evidence(plan_item, all_claims, full_text)

            # Fetch existing content for UPDATE
            existing_content: Optional[str] = None
            if action == "UPDATE":
                existing_page = await wiki_service.get_page_by_slug(
                    session, slug, scope_type=scope_type, scope_id=scope_id,
                )
                if existing_page:
                    existing_content = existing_page.content_md

            # Choose writer mode
            is_complex = (
                len(evidence) > WRITER_COMPLEX_THRESHOLD_EVIDENCE
                or len(existing_content or "") > WRITER_COMPLEX_THRESHOLD_EXISTING_CHARS
            )

            try:
                if is_complex:
                    content_md, summary, citations = await _write_page_complex(
                        llm, plan_item, evidence, existing_content, full_text, session, source,
                    )
                else:
                    content_md, summary, citations = await _write_page_simple(
                        llm, plan_item, evidence, existing_content, {},
                    )
            except Exception as e:
                logger.error(f"MRP REFINE writer failed for '{slug}': {e}")
                # Return minimal stub so COMMIT can still proceed
                content_md = f"# {title}\n\n(Page generation failed: {str(e)[:200]})"
                summary = title
                citations = []

            return PageWriteResult(
                slug=slug,
                title=title,
                page_type=page_type,
                action=action,
                content_md=content_md,
                summary=summary,
                citations=citations,
                entity_names=plan_item.get("entity_names", []),
                related_kb_pages=related_kb_pages,
            )

    results = await asyncio.gather(*[_write_one(p) for p in pages_spec])
    page_results = [r for r in results if r is not None]

    logger.info(f"MRP REFINE complete: {len(page_results)} pages written for source={source.id}")
    return page_results
