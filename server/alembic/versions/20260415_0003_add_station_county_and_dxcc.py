"""add station county and dxcc fields"""

from alembic import op
import sqlalchemy as sa


revision = "20260415_0003"
down_revision = "20260415_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("app_settings") as batch_op:
        batch_op.add_column(sa.Column("my_county", sa.String(length=128), nullable=True))

    with op.batch_alter_table("contacts") as batch_op:
        batch_op.add_column(sa.Column("dxcc", sa.String(length=16), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("contacts") as batch_op:
        batch_op.drop_column("dxcc")

    with op.batch_alter_table("app_settings") as batch_op:
        batch_op.drop_column("my_county")
