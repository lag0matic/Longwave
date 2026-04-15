"""add split api tokens"""

from alembic import op
import sqlalchemy as sa


revision = "20260415_0004"
down_revision = "20260415_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("app_settings") as batch_op:
        batch_op.add_column(sa.Column("client_api_token", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("admin_api_token", sa.String(length=255), nullable=True))

    op.execute(
        """
        UPDATE app_settings
        SET client_api_token = api_token,
            admin_api_token = api_token
        WHERE client_api_token IS NULL
           OR admin_api_token IS NULL
        """
    )


def downgrade() -> None:
    with op.batch_alter_table("app_settings") as batch_op:
        batch_op.drop_column("admin_api_token")
        batch_op.drop_column("client_api_token")
