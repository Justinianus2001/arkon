"""Verbatim sources: preserve_verbatim flag + source_chunk_embeddings_<dim>.

Adds `sources.preserve_verbatim` and one raw-chunk embedding table per supported
dimension:

  - source_chunk_embeddings_768
  - source_chunk_embeddings_1024
  - source_chunk_embeddings_1536
  - source_chunk_embeddings_3072

A preserve_verbatim source skips the LLM wiki pipeline (MRP). Its full_text is
chunked + embedded as-is into these tables so it is searchable in the same
semantic pool as wiki pages, without ever being rewritten. Mirrors the
wiki_page_embeddings_<dim> tables from migration 015.

Revision ID: 036_verbatim_sources
Revises: 035_remove_workspace_module
Create Date: 2026-06-02
"""

import sqlalchemy as sa
from pgvector.sqlalchemy import HALFVEC, Vector
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "036_verbatim_sources"
down_revision = "035_remove_workspace_module"
branch_labels = None
depends_on = None


SUPPORTED_DIMENSIONS = (768, 1024, 1536, 3072)
_HALFVEC_DIMS = {3072}

_VALID_TABLES = frozenset(f"source_chunk_embeddings_{d}" for d in SUPPORTED_DIMENSIONS)


def _table_name(dim: int) -> str:
    name = f"source_chunk_embeddings_{dim}"
    assert name in _VALID_TABLES, f"Unexpected embedding table name: {name}"
    return name


def _embedding_column(dim: int):
    if dim in _HALFVEC_DIMS:
        return sa.Column("embedding", HALFVEC(dim), nullable=False)
    return sa.Column("embedding", Vector(dim), nullable=False)


def _hnsw_ops(dim: int) -> str:
    return "halfvec_cosine_ops" if dim in _HALFVEC_DIMS else "vector_cosine_ops"


def upgrade() -> None:
    op.add_column(
        "sources",
        sa.Column(
            "preserve_verbatim",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )

    for dim in SUPPORTED_DIMENSIONS:
        table = _table_name(dim)
        op.create_table(
            table,
            sa.Column(
                "source_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("sources.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("chunk_index", sa.Integer, nullable=False),
            sa.Column("model_spec_id", sa.String(128), nullable=False),
            sa.Column("start_char", sa.Integer, nullable=False),
            sa.Column("end_char", sa.Integer, nullable=False),
            sa.Column("page_number", sa.Integer, nullable=False, server_default="1"),
            sa.Column("text", sa.Text, nullable=False),
            sa.Column("content_hash", sa.String(64), nullable=False),
            _embedding_column(dim),
            sa.Column(
                "embedded_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
            sa.PrimaryKeyConstraint("source_id", "chunk_index", "model_spec_id"),
        )
        op.execute(
            f"""
            CREATE INDEX ix_{table}_hnsw
            ON {table}
            USING hnsw (embedding {_hnsw_ops(dim)})
            WITH (m = 16, ef_construction = 64)
            """
        )
        op.create_index(f"ix_{table}_model", table, ["model_spec_id"])
        op.create_index(f"ix_{table}_source", table, ["source_id"])


def downgrade() -> None:
    for dim in SUPPORTED_DIMENSIONS:
        table = _table_name(dim)
        op.drop_index(f"ix_{table}_source", table_name=table)
        op.drop_index(f"ix_{table}_model", table_name=table)
        op.execute(f"DROP INDEX IF EXISTS ix_{table}_hnsw")
        op.drop_table(table)

    op.drop_column("sources", "preserve_verbatim")
