"""Unit tests for _write_page_multipass — mock LLM, no DB."""

import asyncio

import pytest

from app.ai.mrp.writer import (
    SectionRef,
    _write_page_multipass,
)


class MockLLM:
    """Stub LLMProvider that responds deterministically based on system prompt."""

    def __init__(self, behavior="concat"):
        self.behavior = behavior
        self.calls: list[tuple[str, str]] = []  # (system_marker, prompt)
        # Need a `.config.spec.context_window_tokens` for budget calc upstream
        self.config = type("Cfg", (), {"spec": type("Spec", (), {"context_window_tokens": 200_000})()})()

    async def generate(self, prompt: str, system: str = "", temperature: float = 0.0) -> str:
        # Identify pass by system prompt suffix
        if "Multi-pass extension mode" in system:
            mode = "extend"
        elif "Multi-pass polish mode" in system:
            mode = "polish"
        else:
            mode = "create"
        self.calls.append((mode, prompt[:200]))

        if self.behavior == "concat":
            # Pass 1: produce a base draft. Pass 2+: concat existing + new.
            if mode == "create":
                return "# Page\n\n## Section A\n\nbase content " * 5
            if mode == "extend":
                # Find existing draft from prompt and return it + new content
                draft_marker = "## Existing draft (preserve verbatim, extend only)\n\n"
                end_marker = "\n\n---\n\n## New source sections to incorporate"
                if draft_marker in prompt and end_marker in prompt:
                    start = prompt.index(draft_marker) + len(draft_marker)
                    end = prompt.index(end_marker, start)
                    existing = prompt[start:end]
                    return existing + "\n\n## New Section\n\nextended content " * 5
                return "# Page\n\nfallback"
            if mode == "polish":
                # Just return input draft
                draft_marker = "## Multi-pass draft to polish\n\n"
                if draft_marker in prompt:
                    start = prompt.index(draft_marker) + len(draft_marker)
                    end = prompt.index("\n\n## Image markers", start)
                    return prompt[start:end]
                return "polished"
        elif self.behavior == "shrink":
            # Create returns a long base draft; extend returns a tiny string,
            # triggering anti-shrink fallback for the extend pass.
            if mode == "create":
                return "# Page\n\n## Base\n\n" + ("base content " * 200)
            return "# Tiny\n\nshort"
        elif self.behavior == "fail_extend":
            if mode == "extend":
                raise RuntimeError("simulated extend failure")
            return "# Page\n\n## Base\n\nlots of base content " * 10
        return ""


def _make_sections(*sizes):
    sections = []
    cursor = 0
    for i, sz in enumerate(sizes):
        sections.append(SectionRef(
            title=f"Sec{i}",
            level=2,
            char_start=cursor,
            char_end=cursor + sz,
            text=("x" * sz),
            evidence_indices=[i],
        ))
        cursor += sz
    return sections


@pytest.mark.asyncio
async def test_multipass_accumulates_across_passes():
    plan_item = {
        "slug": "concept/test",
        "title": "Test",
        "page_type": "concept",
        "action": "CREATE",
        "entity_names": ["test"],
    }
    tier_a = _make_sections(2000, 2000, 2000)
    evidence = [
        {"absolute_offset": 0, "evidence_length": 100, "subject": "test", "statement": "fact 1", "confidence": "explicit"},
        {"absolute_offset": 2000, "evidence_length": 100, "subject": "test", "statement": "fact 2", "confidence": "explicit"},
        {"absolute_offset": 4000, "evidence_length": 100, "subject": "test", "statement": "fact 3", "confidence": "explicit"},
    ]
    llm = MockLLM(behavior="concat")
    content, summary, _ = await _write_page_multipass(
        llm=llm,
        plan_item=plan_item,
        evidence=evidence,
        existing_content=None,
        tier_a=tier_a,
        tier_b=[],
        tier_c=[],
        budget_per_pass=2500,  # forces 3 batches of 2000 each
        all_plan_slugs=["concept/test"],
        image_markers=[],
    )
    # Should have made >= 3 calls (create + 2 extends, possibly + polish)
    modes = [c[0] for c in llm.calls]
    assert modes.count("create") == 1
    assert modes.count("extend") >= 2
    # Polish triggered because batches=3 ≥ _POLISH_MIN_BATCHES
    assert "polish" in modes
    assert "New Section" in content


@pytest.mark.asyncio
async def test_multipass_anti_shrink_hard_appends():
    plan_item = {"slug": "concept/test", "title": "T", "page_type": "concept", "action": "CREATE"}
    tier_a = _make_sections(2000, 2000)
    evidence = [
        {"absolute_offset": 0, "evidence_length": 100, "subject": "T", "statement": "f1", "confidence": "explicit"},
        {"absolute_offset": 2000, "evidence_length": 100, "subject": "T", "statement": "f2", "confidence": "explicit"},
    ]
    llm = MockLLM(behavior="shrink")
    content, _, _ = await _write_page_multipass(
        llm=llm,
        plan_item=plan_item,
        evidence=evidence,
        existing_content=None,
        tier_a=tier_a,
        tier_b=[],
        tier_c=[],
        budget_per_pass=2500,
        all_plan_slugs=["concept/test"],
        image_markers=[],
    )
    # Hard-append fallback should inject each Sec title with its raw text
    assert "## Sec1" in content
    # And the content includes the actual section text (xxxx...)
    assert "x" * 100 in content


@pytest.mark.asyncio
async def test_multipass_extend_failure_returns_prev_draft():
    plan_item = {"slug": "concept/test", "title": "T", "page_type": "concept", "action": "CREATE"}
    tier_a = _make_sections(2000, 2000)
    evidence = [
        {"absolute_offset": 0, "evidence_length": 100, "subject": "T", "statement": "f1", "confidence": "explicit"},
        {"absolute_offset": 2000, "evidence_length": 100, "subject": "T", "statement": "f2", "confidence": "explicit"},
    ]
    llm = MockLLM(behavior="fail_extend")
    content, _, _ = await _write_page_multipass(
        llm=llm,
        plan_item=plan_item,
        evidence=evidence,
        existing_content=None,
        tier_a=tier_a,
        tier_b=[],
        tier_c=[],
        budget_per_pass=2500,
        all_plan_slugs=["concept/test"],
        image_markers=[],
    )
    # Should have CREATE pass + extend attempt (fails) → hard-append fallback
    # Result should still contain the base draft
    assert "# Page" in content or "## Base" in content
    # And the new section appended via fallback
    assert "## Sec1" in content
