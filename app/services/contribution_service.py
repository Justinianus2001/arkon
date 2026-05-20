"""
Contribution Service — unified lifecycle for knowledge contributions.

Wraps the two existing artifact types (wiki drafts, skill contributions) behind
a single state machine so transitions emit audit + notifications consistently.
Schema stays separate; this is a service-layer wrapper, not a table merge.

State machine (both artifact types):

        ┌────────────────────────────────────────┐
        │                                        │
        ▼                                        │
    [pending] ─approve──> [approved] (terminal)  │
        │                                        │
        ├─reject────────> [rejected] (terminal)  │
        │                                        │
        ├─request_changes─> [needs_revision] ────┘ (resubmit)
        │                            │
        │                            └─withdraw─> [withdrawn] (terminal)
        │
        └─withdraw─────> [withdrawn] (terminal)

`approve` / `reject` are NOT done through this service yet — they keep calling
the existing domain helpers (`wiki_service.approve_draft`,
`SkillService.approve_contribution`) because of inline regen/index work — but
this module exposes `notify_approved` / `notify_rejected` so routers fire the
right notifications uniformly after those calls succeed.
"""

import uuid
from datetime import datetime, timezone
from typing import Optional, Protocol

from sqlalchemy.ext.asyncio import AsyncSession

from app.database.models import (
    Employee,
    SkillContribution,
    SkillContributionStatus,
    WikiDraftRound,
    WikiPage,
    WikiPageDraft,
)
from app.services import notification_service
from app.services.audit_service import log_audit
from app.services.notification_service import NotificationType


async def _run_ai_sync_and_enqueue(db, draft: WikiPageDraft) -> None:
    """Run L1+L2 AI checks synchronously and enqueue the L3+L4 worker job.

    Permissive: never raises out of this function — AI is best-effort and
    must never break the contribution path. Skips entirely if the global
    `ai_pre_review_enabled` config flag is set to "false".
    """
    from loguru import logger
    try:
        from app.services.config_service import ConfigService
        cfg = ConfigService(db)
        enabled = await cfg.get("ai_pre_review_enabled")
        # Default ON. Only the literal string "false" disables it.
        if enabled is not None and str(enabled).lower() == "false":
            draft.ai_check_status = "skipped"
            return
    except Exception:
        # Config service failure shouldn't break submit — proceed.
        pass

    try:
        from app.services.ai_review import run_sync_checks
        page = await db.get(WikiPage, draft.page_id) if draft.page_id else None
        scope_type = page.scope_type if page else (
            (draft.suggested_metadata or {}).get("scope_type") or "global"
        )
        scope_id_val = page.scope_id if page else (
            (draft.suggested_metadata or {}).get("scope_id")
        )
        try:
            scope_id = uuid.UUID(scope_id_val) if isinstance(scope_id_val, str) else scope_id_val
        except (ValueError, AttributeError):
            scope_id = None

        results = await run_sync_checks(
            db, content_md=draft.content_md,
            self_slug=page.slug if page else (draft.suggested_metadata or {}).get("slug"),
            self_page_id=draft.page_id,
            scope_type=scope_type,
            scope_id=scope_id,
        )
        draft.ai_check_results = results
        summary = results["summary"]
        # Status reflects sync-only verdict until the worker fills in L3+L4.
        if summary["fail"] > 0:
            draft.ai_check_status = "failed"
        elif summary["warn"] > 0:
            draft.ai_check_status = "warned"
        else:
            draft.ai_check_status = "running"  # waiting for async layers
    except Exception as e:
        logger.warning(f"AI sync checks failed for draft {draft.id}: {e}")
        draft.ai_check_status = "skipped"

    # Enqueue async layers. Failure (Redis down) just leaves the sync verdict.
    try:
        from app.worker import get_arq_pool
        pool = await get_arq_pool()
        await pool.enqueue_job("ai_pre_review_draft_task", str(draft.id))
    except Exception as e:
        logger.warning(f"AI async enqueue failed for draft {draft.id}: {e}")


class InvalidTransition(Exception):
    """Raised when an attempted state transition is not allowed."""


# ---------------------------------------------------------------------------
# Adapter protocol
# ---------------------------------------------------------------------------

class ContributionAdapter(Protocol):
    artifact_type: str  # "wiki_draft" | "skill_contribution"

    def status(self, obj) -> str: ...
    def set_status(self, obj, status: str) -> None: ...
    def author_id(self, obj) -> Optional[uuid.UUID]: ...
    def display_name(self, obj) -> str: ...
    def revision_round(self, obj) -> int: ...
    def bump_revision_round(self, obj) -> None: ...
    def set_returned_note(self, obj, note: Optional[str]) -> None: ...
    async def reviewers(self, db: AsyncSession, obj) -> list[uuid.UUID]: ...
    # Notification type strings for the artifact type
    types: "_TypeBundle"


class _TypeBundle:
    """Notification type strings per event for one artifact."""
    def __init__(
        self, submitted: str, resubmitted: str, approved: str, rejected: str,
        changes_requested: str, withdrawn: str,
    ):
        self.submitted = submitted
        self.resubmitted = resubmitted
        self.approved = approved
        self.rejected = rejected
        self.changes_requested = changes_requested
        self.withdrawn = withdrawn


# ---------------------------------------------------------------------------
# WikiPageDraft adapter
# ---------------------------------------------------------------------------

class WikiDraftAdapter:
    artifact_type = "wiki_draft"
    types = _TypeBundle(
        submitted=NotificationType.WIKI_DRAFT_SUBMITTED,
        resubmitted=NotificationType.WIKI_DRAFT_RESUBMITTED,
        approved=NotificationType.WIKI_DRAFT_APPROVED,
        rejected=NotificationType.WIKI_DRAFT_REJECTED,
        changes_requested=NotificationType.WIKI_DRAFT_CHANGES_REQUESTED,
        withdrawn=NotificationType.WIKI_DRAFT_WITHDRAWN,
    )

    def status(self, obj: WikiPageDraft) -> str:
        return obj.status

    def set_status(self, obj: WikiPageDraft, status: str) -> None:
        obj.status = status

    def author_id(self, obj: WikiPageDraft) -> Optional[uuid.UUID]:
        return obj.author_id

    def display_name(self, obj: WikiPageDraft) -> str:
        page = obj.page
        if page is None:
            return f"draft {obj.id}"
        return f"{page.title} ({page.slug})"

    def revision_round(self, obj: WikiPageDraft) -> int:
        return obj.revision_round or 0

    def bump_revision_round(self, obj: WikiPageDraft) -> None:
        obj.revision_round = (obj.revision_round or 0) + 1

    def set_returned_note(self, obj: WikiPageDraft, note: Optional[str]) -> None:
        obj.last_returned_note = note

    async def reviewers(self, db: AsyncSession, obj: WikiPageDraft) -> list[uuid.UUID]:
        page: Optional[WikiPage] = obj.page
        if page is None:
            return await notification_service.get_global_reviewers(db)
        return await notification_service.get_reviewers_for_scope(
            db, page.scope_type or "global", page.scope_id,
        )


# ---------------------------------------------------------------------------
# SkillContribution adapter
# ---------------------------------------------------------------------------

class SkillContributionAdapter:
    artifact_type = "skill_contribution"
    types = _TypeBundle(
        submitted=NotificationType.SKILL_CONTRIBUTION_SUBMITTED,
        resubmitted=NotificationType.SKILL_CONTRIBUTION_RESUBMITTED,
        approved=NotificationType.SKILL_CONTRIBUTION_APPROVED,
        rejected=NotificationType.SKILL_CONTRIBUTION_REJECTED,
        changes_requested=NotificationType.SKILL_CONTRIBUTION_CHANGES_REQUESTED,
        withdrawn=NotificationType.SKILL_CONTRIBUTION_WITHDRAWN,
    )

    def status(self, obj: SkillContribution) -> str:
        return obj.status

    def set_status(self, obj: SkillContribution, status: str) -> None:
        obj.status = status

    def author_id(self, obj: SkillContribution) -> Optional[uuid.UUID]:
        return obj.contributor_id

    def display_name(self, obj: SkillContribution) -> str:
        return obj.title

    def revision_round(self, obj: SkillContribution) -> int:
        return obj.revision_round or 0

    def bump_revision_round(self, obj: SkillContribution) -> None:
        obj.revision_round = (obj.revision_round or 0) + 1

    def set_returned_note(self, obj: SkillContribution, note: Optional[str]) -> None:
        obj.last_returned_note = note

    async def reviewers(self, db: AsyncSession, obj: SkillContribution) -> list[uuid.UUID]:
        # Skill reviewers = admins for now (skill approval is admin-only path).
        return await notification_service.get_global_reviewers(db)


# Singleton instances — adapters are stateless.
wiki_draft_adapter = WikiDraftAdapter()
skill_contribution_adapter = SkillContributionAdapter()


# ---------------------------------------------------------------------------
# State transition helpers
# ---------------------------------------------------------------------------

def _assert_status(adapter: ContributionAdapter, obj, allowed: tuple[str, ...]) -> None:
    current = adapter.status(obj)
    if current not in allowed:
        raise InvalidTransition(
            f"Cannot perform this action while {adapter.artifact_type} is "
            f"in status '{current}'. Allowed: {', '.join(allowed)}."
        )


async def notify_submitted(
    db: AsyncSession,
    adapter: ContributionAdapter,
    obj,
    actor: Employee,
) -> None:
    """Fire when a contribution first enters pending state."""
    # Trigger AI pre-review on wiki drafts only — skill contributions have a
    # different content model (file tree in MinIO) and aren't in scope yet.
    if isinstance(obj, WikiPageDraft):
        await _run_ai_sync_and_enqueue(db, obj)

    recipients = await adapter.reviewers(db, obj)
    await notification_service.notify_many(
        db,
        recipient_ids=recipients,
        type=adapter.types.submitted,
        subject=f"New draft: {adapter.display_name(obj)}",
        body=f"Submitted by {actor.name or actor.email}",
        target_type=adapter.artifact_type,
        target_id=str(obj.id),
        actor_id=actor.id,
    )


async def request_changes(
    db: AsyncSession,
    adapter: ContributionAdapter,
    obj,
    reviewer: Employee,
    note: str,
) -> None:
    """pending → needs_revision. Stores the reviewer note on the artifact."""
    if not note or not note.strip():
        raise InvalidTransition("reviewer_note is required when requesting changes.")
    _assert_status(adapter, obj, ("pending",))
    adapter.set_status(obj, "needs_revision")
    adapter.set_returned_note(obj, note.strip())
    await log_audit(
        db, reviewer, "request_changes", adapter.artifact_type, str(obj.id),
        reason=note.strip(),
    )
    author_id = adapter.author_id(obj)
    if author_id:
        await notification_service.notify(
            db, recipient_id=author_id,
            type=adapter.types.changes_requested,
            subject=f"Changes requested on {adapter.display_name(obj)}",
            body=note.strip(),
            target_type=adapter.artifact_type,
            target_id=str(obj.id),
            actor_id=reviewer.id,
        )


async def resubmit_wiki_draft(
    db: AsyncSession,
    draft: WikiPageDraft,
    author: Employee,
    new_content_md: str,
    author_note: Optional[str] = None,
) -> None:
    """needs_revision → pending. Snapshots prior round and bumps revision_round.

    Wiki-specific because we also append a `wiki_draft_rounds` row capturing
    what the previous submission looked like. Skill contributions snapshot via
    MinIO and aren't covered here.
    """
    adapter = wiki_draft_adapter
    _assert_status(adapter, draft, ("needs_revision",))
    if draft.author_id is not None and draft.author_id != author.id:
        raise InvalidTransition("Only the original author can resubmit this draft.")

    # Snapshot the state being replaced — including the AI verdict so the
    # reviewer can compare AI checks across rounds.
    db.add(WikiDraftRound(
        draft_id=draft.id,
        round_no=draft.revision_round or 0,
        content_md=draft.content_md,
        author_note=draft.note,
        reviewer_return_note=draft.last_returned_note,
        ai_check_results=draft.ai_check_results,
        submitted_at=datetime.now(timezone.utc),
    ))

    draft.content_md = new_content_md
    if author_note is not None:
        draft.note = author_note
    draft.last_returned_note = None
    # Content changed — re-run AI from scratch on the new content.
    draft.ai_check_status = "pending"
    draft.ai_check_results = None
    draft.ai_checked_at = None
    adapter.bump_revision_round(draft)
    adapter.set_status(draft, "pending")
    await _run_ai_sync_and_enqueue(db, draft)

    await log_audit(
        db, author, "resubmit", adapter.artifact_type, str(draft.id),
        reason=f"round {draft.revision_round}",
    )
    recipients = await adapter.reviewers(db, draft)
    await notification_service.notify_many(
        db, recipient_ids=recipients,
        type=adapter.types.resubmitted,
        subject=f"Resubmitted: {adapter.display_name(draft)} (round {draft.revision_round})",
        body=author_note or "",
        target_type=adapter.artifact_type,
        target_id=str(draft.id),
        actor_id=author.id,
    )


async def resubmit_skill_contribution(
    db: AsyncSession,
    contribution: SkillContribution,
    author: Employee,
) -> None:
    """needs_revision → pending for a skill contribution.

    Files are mutated through the existing file endpoints in
    skill_contributions router — calling this just flips the status back to
    pending after the contributor has finished editing.
    """
    adapter = skill_contribution_adapter
    _assert_status(adapter, contribution, ("needs_revision",))
    if contribution.contributor_id != author.id:
        raise InvalidTransition("Only the original contributor can resubmit.")

    contribution.last_returned_note = None
    adapter.bump_revision_round(contribution)
    adapter.set_status(contribution, SkillContributionStatus.PENDING.value)

    await log_audit(
        db, author, "resubmit", adapter.artifact_type, str(contribution.id),
        reason=f"round {contribution.revision_round}",
    )
    recipients = await adapter.reviewers(db, contribution)
    await notification_service.notify_many(
        db, recipient_ids=recipients,
        type=adapter.types.resubmitted,
        subject=f"Resubmitted: {adapter.display_name(contribution)} (round {contribution.revision_round})",
        target_type=adapter.artifact_type,
        target_id=str(contribution.id),
        actor_id=author.id,
    )


async def withdraw(
    db: AsyncSession,
    adapter: ContributionAdapter,
    obj,
    author: Employee,
) -> None:
    """pending|needs_revision → withdrawn. Author-only (admin override caller-side)."""
    _assert_status(adapter, obj, ("pending", "needs_revision"))
    if (
        adapter.author_id(obj) is not None
        and adapter.author_id(obj) != author.id
        and author.role != "admin"
    ):
        raise InvalidTransition("Only the original author can withdraw this contribution.")

    adapter.set_status(obj, "withdrawn")
    await log_audit(
        db, author, "withdraw", adapter.artifact_type, str(obj.id),
    )
    recipients = await adapter.reviewers(db, obj)
    await notification_service.notify_many(
        db, recipient_ids=recipients,
        type=adapter.types.withdrawn,
        subject=f"Withdrawn: {adapter.display_name(obj)}",
        target_type=adapter.artifact_type,
        target_id=str(obj.id),
        actor_id=author.id,
    )


# ---------------------------------------------------------------------------
# Notification-only helpers for existing approve / reject paths
# ---------------------------------------------------------------------------

async def notify_approved(
    db: AsyncSession,
    adapter: ContributionAdapter,
    obj,
    reviewer: Employee,
    version_label: Optional[str] = None,
) -> None:
    """Fire after a successful approve. Author gets the good news.

    For wiki drafts we also notify the authors of every OTHER still-pending
    draft on the same page so they know the page has advanced under them —
    their drafts will now flag as having a version conflict on next approve.
    """
    author_id = adapter.author_id(obj)
    if not author_id:
        return
    suffix = f" ({version_label})" if version_label else ""
    await notification_service.notify(
        db, recipient_id=author_id,
        type=adapter.types.approved,
        subject=f"Your contribution was approved: {adapter.display_name(obj)}{suffix}",
        body=f"Approved by {reviewer.name or reviewer.email}",
        target_type=adapter.artifact_type,
        target_id=str(obj.id),
        actor_id=reviewer.id,
    )

    # Cross-author awareness for wiki drafts only.
    if isinstance(obj, WikiPageDraft) and obj.page_id is not None:
        from sqlalchemy import select as _select
        sibling_rows = await db.execute(
            _select(WikiPageDraft.author_id, WikiPageDraft.id)
            .where(
                WikiPageDraft.page_id == obj.page_id,
                WikiPageDraft.status == "pending",
                WikiPageDraft.id != obj.id,
            )
        )
        # Group by author so a user with 2 sibling drafts gets 1 notification.
        seen_authors: set[uuid.UUID] = set()
        for sibling_author_id, sibling_id in sibling_rows.all():
            if not sibling_author_id or sibling_author_id == author_id:
                continue  # don't ping the author we already notified
            if sibling_author_id in seen_authors:
                continue
            seen_authors.add(sibling_author_id)
            await notification_service.notify(
                db, recipient_id=sibling_author_id,
                type=adapter.types.approved,  # same type — the author's draft is now stale
                subject=(
                    f"Page advanced while your draft was pending: "
                    f"{adapter.display_name(obj)}{suffix}"
                ),
                body=(
                    f"{reviewer.name or reviewer.email} approved another draft on "
                    "this page. Your draft will flag as conflicting on the next "
                    "approve — re-base or withdraw."
                ),
                target_type=adapter.artifact_type,
                target_id=str(sibling_id),  # link to the sibling's own draft
                actor_id=reviewer.id,
            )


async def notify_rejected(
    db: AsyncSession,
    adapter: ContributionAdapter,
    obj,
    reviewer: Employee,
    reason: Optional[str] = None,
) -> None:
    """Fire after a reject. Author gets the bad news with the reason."""
    author_id = adapter.author_id(obj)
    if not author_id:
        return
    await notification_service.notify(
        db, recipient_id=author_id,
        type=adapter.types.rejected,
        subject=f"Your contribution was rejected: {adapter.display_name(obj)}",
        body=reason or "",
        target_type=adapter.artifact_type,
        target_id=str(obj.id),
        actor_id=reviewer.id,
    )
