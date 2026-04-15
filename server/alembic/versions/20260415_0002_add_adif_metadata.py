"""add adif metadata fields"""

from alembic import op
import sqlalchemy as sa


revision = "20260415_0002"
down_revision = "20260414_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("app_settings") as batch_op:
        batch_op.add_column(sa.Column("my_grid_square", sa.String(length=16), nullable=True))
        batch_op.add_column(sa.Column("my_state", sa.String(length=32), nullable=True))
        batch_op.add_column(sa.Column("default_tx_power", sa.String(length=16), nullable=True))

    with op.batch_alter_table("contacts") as batch_op:
        batch_op.add_column(sa.Column("tx_power", sa.String(length=16), nullable=True))
        batch_op.add_column(sa.Column("name", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("qth", sa.String(length=128), nullable=True))
        batch_op.add_column(sa.Column("county", sa.String(length=128), nullable=True))
        batch_op.add_column(sa.Column("qrz_upload_status", sa.String(length=8), nullable=True))
        batch_op.add_column(sa.Column("qrz_upload_date", sa.String(length=16), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("contacts") as batch_op:
        batch_op.drop_column("qrz_upload_date")
        batch_op.drop_column("qrz_upload_status")
        batch_op.drop_column("county")
        batch_op.drop_column("qth")
        batch_op.drop_column("name")
        batch_op.drop_column("tx_power")

    with op.batch_alter_table("app_settings") as batch_op:
        batch_op.drop_column("default_tx_power")
        batch_op.drop_column("my_state")
        batch_op.drop_column("my_grid_square")
