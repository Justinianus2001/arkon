"""
AI pre-review — permissive layer that annotates wiki drafts before human review.

Public entry points:
    run_sync_checks(content_md)  -> dict  (L1 + L2; called from request handlers)
    run_async_checks(draft_id)   -> None  (L3 + L4; called from arq worker)

The output JSON shape is documented in `runner.py`.
"""

from app.services.ai_review.runner import (  # noqa: F401
    CheckResult,
    AiReviewResults,
    run_sync_checks,
    run_async_checks,
    merge_results,
)
