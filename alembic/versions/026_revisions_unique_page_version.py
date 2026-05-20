"""Tighten wiki_page_revisions: unique (page_id, version)

Revision ID: 026
Revises: 025
Create Date: 2026-05-19 22:00:00.000000

The existing index ix_wiki_revisions_page_version was non-unique, leaving
the table vulnerable to a race in approve_draft where two concurrent
approves on the same page each INSERT a row at version=N+1. The race is
now prevented at the application layer by an advisory lock; this
migration adds the DB-level backstop.

If any duplicate (page_id, version) rows already exist they will block
the migration — clean them up first by keeping the lowest id and
re-numbering the rest.
"""

from typing import Sequence, Union

from alembic import op

revision: str = '026'
down_revision: Union[str, None] = '025'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index("ix_wiki_revisions_page_version", table_name="wiki_page_revisions")
    op.create_index(
        "uq_wiki_revisions_page_version",
        "wiki_page_revisions",
        ["page_id", "version"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_wiki_revisions_page_version", table_name="wiki_page_revisions")
    op.create_index(
        "ix_wiki_revisions_page_version",
        "wiki_page_revisions",
        ["page_id", "version"],
    )
