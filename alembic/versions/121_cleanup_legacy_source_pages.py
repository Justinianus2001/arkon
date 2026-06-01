"""cleanup_legacy_source_pages

Revision ID: 121
Revises: 120ffbbffa7c
Create Date: 2026-05-31 21:22:00.000000
"""

from typing import Sequence, Union
from alembic import op

# revision identifiers
revision: str = '121'
down_revision: Union[str, None] = '120ffbbffa7c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # SQL commands to delete legacy 'source/' wiki pages, drafts, and revisions
    # 1. Delete revisions whose parent page has a source/ slug
    op.execute(
        "DELETE FROM wiki_page_revisions WHERE page_id IN (SELECT id FROM wiki_pages WHERE slug LIKE 'source/%')"
    )
    # 2. Delete drafts referencing a source/ page or suggesting a source/ slug
    op.execute(
        "DELETE FROM wiki_page_drafts WHERE page_id IN (SELECT id FROM wiki_pages WHERE slug LIKE 'source/%') "
        "OR (suggested_metadata->>'slug' LIKE 'source/%')"
    )
    # 3. Delete the legacy wiki pages
    op.execute("DELETE FROM wiki_pages WHERE slug LIKE 'source/%'")


def downgrade() -> None:
    pass
