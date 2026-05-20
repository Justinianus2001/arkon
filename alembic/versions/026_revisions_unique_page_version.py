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

import sqlalchemy as sa
from typing import Sequence, Union

from alembic import op

revision: str = '026'
down_revision: Union[str, None] = '025'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    # Find page_ids that have duplicate versions
    result = conn.execute(sa.text(
        "SELECT page_id FROM wiki_page_revisions GROUP BY page_id, version HAVING COUNT(*) > 1"
    ))
    page_ids = [str(row[0]) for row in result.fetchall()]

    if page_ids:
        page_ids_str = ", ".join(f"'{pid}'" for pid in page_ids)

        # Renumber revisions for these pages consecutively based on created_at, id
        conn.execute(sa.text(
            f"""
            WITH ranked_revisions AS (
                SELECT id, CAST(ROW_NUMBER() OVER(PARTITION BY page_id ORDER BY created_at, id) AS INTEGER) as new_version
                FROM wiki_page_revisions
                WHERE page_id IN ({page_ids_str})
            )
            UPDATE wiki_page_revisions
            SET version = ranked_revisions.new_version
            FROM ranked_revisions
            WHERE wiki_page_revisions.id = ranked_revisions.id
            """
        ))

        # Update version in wiki_pages to match the new maximum version
        conn.execute(sa.text(
            f"""
            UPDATE wiki_pages
            SET version = (
                SELECT COALESCE(MAX(version), 1)
                FROM wiki_page_revisions
                WHERE wiki_page_revisions.page_id = wiki_pages.id
            )
            WHERE id IN ({page_ids_str})
            """
        ))

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
