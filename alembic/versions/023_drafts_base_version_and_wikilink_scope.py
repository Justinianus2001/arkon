"""Wiki drafts base_version + wiki_links keyed by from_page_id

Revision ID: 023
Revises: 022
Create Date: 2026-05-19 00:00:00.000000

- wiki_page_drafts: add `base_version` (nullable int) — version of the page the
  draft was authored against, used to detect mid-air collisions on approve.
- wiki_links: replace `from_slug` PK with `from_page_id` (FK to wiki_pages.id,
  ON DELETE CASCADE) so edges are scope-disambiguated. Dangling rows (where the
  origin slug no longer exists in any scope) are dropped during migration.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

revision: str = '023'
down_revision: Union[str, None] = '022'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- 1. wiki_page_drafts.base_version --------------------------------
    op.add_column(
        'wiki_page_drafts',
        sa.Column('base_version', sa.Integer(), nullable=True),
    )

    # --- 2. wiki_links: from_slug -> from_page_id ------------------------
    op.add_column(
        'wiki_links',
        sa.Column('from_page_id', UUID(as_uuid=True), nullable=True),
    )

    # Backfill: pick any page whose slug matches from_slug. If a slug exists
    # in multiple scopes the choice is arbitrary, but refresh_links will
    # rewrite edges with the correct page_id on the next page upsert.
    op.execute(
        """
        UPDATE wiki_links wl
        SET from_page_id = wp.id
        FROM wiki_pages wp
        WHERE wp.slug = wl.from_slug
        """
    )
    # Drop rows that could not be mapped (origin page no longer exists).
    op.execute("DELETE FROM wiki_links WHERE from_page_id IS NULL")

    # Switch PK and indexes
    op.drop_index('ix_wiki_links_from_slug', table_name='wiki_links')
    op.drop_constraint('wiki_links_pkey', 'wiki_links', type_='primary')
    op.drop_column('wiki_links', 'from_slug')

    op.alter_column('wiki_links', 'from_page_id', nullable=False)
    op.create_foreign_key(
        'fk_wiki_links_from_page_id',
        'wiki_links', 'wiki_pages',
        ['from_page_id'], ['id'],
        ondelete='CASCADE',
    )
    op.create_primary_key(
        'wiki_links_pkey', 'wiki_links', ['from_page_id', 'to_slug'],
    )
    op.create_index(
        'ix_wiki_links_from_page_id', 'wiki_links', ['from_page_id'],
    )


def downgrade() -> None:
    # wiki_links: from_page_id -> from_slug
    op.add_column(
        'wiki_links',
        sa.Column('from_slug', sa.String(length=300), nullable=True),
    )
    op.execute(
        """
        UPDATE wiki_links wl
        SET from_slug = wp.slug
        FROM wiki_pages wp
        WHERE wp.id = wl.from_page_id
        """
    )
    op.drop_index('ix_wiki_links_from_page_id', table_name='wiki_links')
    op.drop_constraint('wiki_links_pkey', 'wiki_links', type_='primary')
    op.drop_constraint('fk_wiki_links_from_page_id', 'wiki_links', type_='foreignkey')
    op.drop_column('wiki_links', 'from_page_id')
    op.alter_column('wiki_links', 'from_slug', nullable=False)
    op.create_primary_key('wiki_links_pkey', 'wiki_links', ['from_slug', 'to_slug'])
    op.create_index('ix_wiki_links_from_slug', 'wiki_links', ['from_slug'])

    # wiki_page_drafts.base_version
    op.drop_column('wiki_page_drafts', 'base_version')
