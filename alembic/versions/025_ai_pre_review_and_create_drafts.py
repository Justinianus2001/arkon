"""AI pre-review + create-kind drafts

Revision ID: 025
Revises: 024
Create Date: 2026-05-19 18:00:00.000000

- wiki_page_drafts: ai_check_status, ai_check_results, ai_checked_at
  for the permissive AI pre-review layer (regex + structural + semantic + LLM).
- wiki_draft_rounds.ai_check_results — snapshot of the AI verdict per round.
- wiki_page_drafts: draft_kind ('edit' | 'create'), suggested_metadata JSONB
  for propose_create_page; page_id becomes nullable for create-kind drafts
  (the target page is materialised at approve time).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision: str = '025'
down_revision: Union[str, None] = '024'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- 1. AI pre-review columns on wiki_page_drafts ---------------------
    op.add_column(
        'wiki_page_drafts',
        sa.Column('ai_check_status', sa.String(20),
                  nullable=False, server_default='pending'),
    )
    op.add_column(
        'wiki_page_drafts',
        sa.Column('ai_check_results', JSONB, nullable=True),
    )
    op.add_column(
        'wiki_page_drafts',
        sa.Column('ai_checked_at', sa.DateTime(timezone=True), nullable=True),
    )

    # --- 2. Snapshot of AI verdict per draft round ------------------------
    op.add_column(
        'wiki_draft_rounds',
        sa.Column('ai_check_results', JSONB, nullable=True),
    )

    # --- 3. Create-kind drafts -------------------------------------------
    op.add_column(
        'wiki_page_drafts',
        sa.Column('draft_kind', sa.String(20),
                  nullable=False, server_default='edit'),
    )
    op.add_column(
        'wiki_page_drafts',
        sa.Column('suggested_metadata', JSONB, nullable=True),
        # {slug, title, page_type, knowledge_type_slugs, scope_type, scope_id}
    )
    # page_id was NOT NULL — drafts for new pages have no parent yet, so we
    # relax the constraint. The application layer enforces that draft_kind
    # 'edit' must have page_id and 'create' must have suggested_metadata.
    op.alter_column('wiki_page_drafts', 'page_id', nullable=True)


def downgrade() -> None:
    # Reverse order. NULL out page_id rows for create drafts before
    # re-tightening the constraint isn't safe — error in that case is fine.
    op.alter_column('wiki_page_drafts', 'page_id', nullable=False)
    op.drop_column('wiki_page_drafts', 'suggested_metadata')
    op.drop_column('wiki_page_drafts', 'draft_kind')
    op.drop_column('wiki_draft_rounds', 'ai_check_results')
    op.drop_column('wiki_page_drafts', 'ai_checked_at')
    op.drop_column('wiki_page_drafts', 'ai_check_results')
    op.drop_column('wiki_page_drafts', 'ai_check_status')
