"""Hash MCP tokens at rest

Revision ID: 027
Revises: 026
Create Date: 2026-05-20 12:00:00.000000

MCP bearer tokens were previously stored in plaintext in `employees.mcp_token`
and looked up via direct equality on the column. A read of the DB (backup,
read-replica, leaked dump) therefore exposed every active token.

This migration:
  * adds `mcp_token_hash` (HMAC-SHA256 hex), `mcp_token_prefix` (first 12 chars
    of the plaintext, for UI display) and `mcp_token_rotated_at`.
  * adds a partial-unique index on `mcp_token_hash`.
  * NULLs out every existing `mcp_token` — all users must rotate via the UI.

The legacy `mcp_token` column is intentionally kept (nullable) for one release
to allow a clean rollback path. A follow-up migration will drop it.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "027"
down_revision: Union[str, None] = "026"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "employees",
        sa.Column("mcp_token_hash", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "employees",
        sa.Column("mcp_token_prefix", sa.String(length=12), nullable=True),
    )
    op.add_column(
        "employees",
        sa.Column("mcp_token_rotated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_employees_mcp_token_hash",
        "employees",
        ["mcp_token_hash"],
        unique=True,
        postgresql_where=sa.text("mcp_token_hash IS NOT NULL"),
    )
    # Force everyone to rotate — plaintext tokens are no longer trusted.
    op.execute("UPDATE employees SET mcp_token = NULL")


def downgrade() -> None:
    op.drop_index("ix_employees_mcp_token_hash", table_name="employees")
    op.drop_column("employees", "mcp_token_rotated_at")
    op.drop_column("employees", "mcp_token_prefix")
    op.drop_column("employees", "mcp_token_hash")
