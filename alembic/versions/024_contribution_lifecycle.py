"""Contribution lifecycle: needs_revision + notifications

Revision ID: 024
Revises: 023
Create Date: 2026-05-19 12:00:00.000000

Adds:
- wiki_page_drafts.revision_round, .last_returned_note
- skill_contributions.revision_round, .last_returned_note
- wiki_draft_rounds: per-round snapshots of draft content
- notifications: in-app inbox keyed by recipient
"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

revision: str = '024'
down_revision: Union[str, None] = '023'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- 1. wiki_page_drafts: revision_round + last_returned_note --------
    op.add_column(
        'wiki_page_drafts',
        sa.Column('revision_round', sa.Integer(), nullable=False, server_default='0'),
    )
    op.add_column(
        'wiki_page_drafts',
        sa.Column('last_returned_note', sa.Text(), nullable=True),
    )

    # --- 2. skill_contributions: revision_round + last_returned_note -----
    op.add_column(
        'skill_contributions',
        sa.Column('revision_round', sa.Integer(), nullable=False, server_default='0'),
    )
    op.add_column(
        'skill_contributions',
        sa.Column('last_returned_note', sa.Text(), nullable=True),
    )

    # --- 3. wiki_draft_rounds ---------------------------------------------
    op.create_table(
        'wiki_draft_rounds',
        sa.Column('id', UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text('gen_random_uuid()')),
        sa.Column('draft_id', UUID(as_uuid=True),
                  sa.ForeignKey('wiki_page_drafts.id', ondelete='CASCADE'),
                  nullable=False),
        sa.Column('round_no', sa.Integer(), nullable=False),
        sa.Column('content_md', sa.Text(), nullable=False),
        sa.Column('author_note', sa.Text(), nullable=True),
        sa.Column('reviewer_return_note', sa.Text(), nullable=True),
        sa.Column('submitted_at', sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text('now()')),
    )
    op.create_index(
        'ix_wiki_draft_rounds_draft_id',
        'wiki_draft_rounds', ['draft_id', 'round_no'],
    )

    # --- 4. notifications -------------------------------------------------
    op.create_table(
        'notifications',
        sa.Column('id', UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text('gen_random_uuid()')),
        sa.Column('recipient_id', UUID(as_uuid=True),
                  sa.ForeignKey('employees.id', ondelete='CASCADE'),
                  nullable=False),
        sa.Column('type', sa.String(80), nullable=False),
        sa.Column('subject', sa.String(200), nullable=False),
        sa.Column('body', sa.Text(), nullable=False, server_default=''),
        sa.Column('target_type', sa.String(40), nullable=False),
        sa.Column('target_id', sa.String(100), nullable=False),
        sa.Column('actor_id', UUID(as_uuid=True),
                  sa.ForeignKey('employees.id', ondelete='SET NULL'),
                  nullable=True),
        sa.Column('read_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text('now()')),
    )
    op.create_index(
        'ix_notifications_recipient_unread',
        'notifications', ['recipient_id', 'read_at'],
    )
    op.create_index(
        'ix_notifications_created_at',
        'notifications', ['created_at'],
    )
    op.create_index(
        'ix_notifications_target',
        'notifications', ['target_type', 'target_id'],
    )


def downgrade() -> None:
    op.drop_index('ix_notifications_target', table_name='notifications')
    op.drop_index('ix_notifications_created_at', table_name='notifications')
    op.drop_index('ix_notifications_recipient_unread', table_name='notifications')
    op.drop_table('notifications')

    op.drop_index('ix_wiki_draft_rounds_draft_id', table_name='wiki_draft_rounds')
    op.drop_table('wiki_draft_rounds')

    op.drop_column('skill_contributions', 'last_returned_note')
    op.drop_column('skill_contributions', 'revision_round')
    op.drop_column('wiki_page_drafts', 'last_returned_note')
    op.drop_column('wiki_page_drafts', 'revision_round')
