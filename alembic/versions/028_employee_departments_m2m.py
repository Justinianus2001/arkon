"""Employees can belong to multiple departments

Revision ID: 028
Revises: 027
Create Date: 2026-05-22 00:00:00.000000

Replaces the single `employees.department_id` FK with a many-to-many
`employee_departments` table. Every employee row is migrated into the new
table (1:1), then the legacy column is dropped.

Permission semantics: `*:*:own_dept` is now interpreted as "any department
this user is a member of" — see app/services/permission_engine.py.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

revision: str = "028"
down_revision: Union[str, None] = "027"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "employee_departments",
        sa.Column(
            "employee_id",
            UUID(as_uuid=True),
            sa.ForeignKey("employees.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "department_id",
            UUID(as_uuid=True),
            sa.ForeignKey("departments.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_employee_departments_department_id",
        "employee_departments",
        ["department_id"],
    )

    conn = op.get_bind()
    # Copy existing single-dept assignments into the join table.
    conn.execute(sa.text(
        "INSERT INTO employee_departments (employee_id, department_id) "
        "SELECT id, department_id FROM employees WHERE department_id IS NOT NULL "
        "ON CONFLICT DO NOTHING"
    ))

    # Drop the legacy index, FK and column.
    try:
        op.drop_index("ix_employees_department_id", table_name="employees")
    except Exception:
        pass
    try:
        op.drop_constraint("employees_department_id_fkey", "employees", type_="foreignkey")
    except Exception:
        pass
    op.drop_column("employees", "department_id")


def downgrade() -> None:
    op.add_column(
        "employees",
        sa.Column("department_id", UUID(as_uuid=True), nullable=True),
    )
    conn = op.get_bind()
    # Best effort: pick the earliest-joined department as the single primary.
    conn.execute(sa.text(
        "UPDATE employees e SET department_id = ed.department_id "
        "FROM (SELECT DISTINCT ON (employee_id) employee_id, department_id "
        "      FROM employee_departments ORDER BY employee_id, created_at) ed "
        "WHERE e.id = ed.employee_id"
    ))
    op.create_foreign_key(
        "employees_department_id_fkey",
        "employees",
        "departments",
        ["department_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index("ix_employees_department_id", "employees", ["department_id"])

    op.drop_index("ix_employee_departments_department_id", table_name="employee_departments")
    op.drop_table("employee_departments")
