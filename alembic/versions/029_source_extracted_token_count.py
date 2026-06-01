"""Add Source.extracted_token_count for upload gate

Revision ID: 029
Revises: 028
Create Date: 2026-05-22 14:00:00.000000

Tracks the tokenized length of the extracted document text. Used by the
post-extraction upload gate: when count > auto_approve_extraction_threshold_tokens,
the pipeline pauses at status='awaiting_approval' until a human approves or
cancels.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "029"
down_revision: Union[str, None] = "028"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "sources",
        sa.Column("extracted_token_count", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("sources", "extracted_token_count")
