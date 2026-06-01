"""Add Source.auto_recover_count for stuck-processing sweep

Revision ID: 030
Revises: 029
Create Date: 2026-05-25 12:00:00.000000

Counts how many times a source has been auto-flipped from 'processing' back to
'error' by sweep_stuck_processing_cron. Used to gate manual retries: once a
source has been swept too many times in a row, the retry API blocks further
attempts so a misconfigured LLM provider can't burn tokens in a loop. Reset to
0 whenever the pipeline reaches a successful checkpoint (plan_ready or ready).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "030"
down_revision: Union[str, None] = "029"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "sources",
        sa.Column(
            "auto_recover_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )


def downgrade() -> None:
    op.drop_column("sources", "auto_recover_count")
