"""Add MRP pipeline tables and columns to sources

Revision ID: 020
Revises: 019
Create Date: 2026-05-10 00:00:00.000000

Adds:
- source_chunk_extracts: stores Phase 1 MAP output per chunk (resumable)
- source_compilation_plans: stores Phase 2 REDUCE output (compilation plan)
- sources.pipeline_strategy: single_pass | standard | hierarchical
- sources.pipeline_phase: current phase for resume tracking
"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from alembic import op

revision: str = '020'
down_revision: Union[str, None] = '019'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'source_chunk_extracts',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('source_id', UUID(as_uuid=True), sa.ForeignKey('sources.id', ondelete='CASCADE'), nullable=False),
        sa.Column('chunk_index', sa.Integer(), nullable=False),
        sa.Column('start_char', sa.Integer(), nullable=False),
        sa.Column('end_char', sa.Integer(), nullable=False),
        sa.Column('section_path', sa.Text(), nullable=True),
        sa.Column('extract_json', JSONB(), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='pending'),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
    )
    op.create_unique_constraint('uq_sce_source_chunk', 'source_chunk_extracts', ['source_id', 'chunk_index'])
    op.create_index('ix_sce_source_status', 'source_chunk_extracts', ['source_id', 'status'])

    op.create_table(
        'source_compilation_plans',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('source_id', UUID(as_uuid=True), sa.ForeignKey('sources.id', ondelete='CASCADE'), nullable=False, unique=True),
        sa.Column('plan_json', JSONB(), nullable=False, server_default='{}'),
        sa.Column('status', sa.String(30), nullable=False, server_default='pending_review'),
        sa.Column('reviewed_by', UUID(as_uuid=True), sa.ForeignKey('employees.id', ondelete='SET NULL'), nullable=True),
        sa.Column('review_note', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_scp_status', 'source_compilation_plans', ['status'])

    op.add_column('sources', sa.Column(
        'pipeline_strategy', sa.String(20), nullable=True,
        comment='single_pass | standard | hierarchical — set by Phase 0 triage',
    ))
    op.add_column('sources', sa.Column(
        'pipeline_phase', sa.String(30), nullable=True,
        comment='Current MRP phase: map | reduce | plan_review | refine | verify | commit',
    ))


def downgrade() -> None:
    op.drop_column('sources', 'pipeline_phase')
    op.drop_column('sources', 'pipeline_strategy')
    op.drop_index('ix_scp_status', table_name='source_compilation_plans')
    op.drop_table('source_compilation_plans')
    op.drop_index('ix_sce_source_status', table_name='source_chunk_extracts')
    op.drop_constraint('uq_sce_source_chunk', 'source_chunk_extracts', type_='unique')
    op.drop_table('source_chunk_extracts')
