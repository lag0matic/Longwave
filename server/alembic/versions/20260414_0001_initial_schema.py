"""initial schema"""

from alembic import op
import sqlalchemy as sa


revision = "20260414_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "app_settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("station_callsign", sa.String(length=32), nullable=False),
        sa.Column("station_name", sa.String(length=100), nullable=False),
        sa.Column("qrz_username", sa.String(length=100), nullable=True),
        sa.Column("qrz_password", sa.String(length=255), nullable=True),
        sa.Column("qrz_api_key", sa.String(length=255), nullable=True),
        sa.Column("pota_api_key", sa.String(length=255), nullable=True),
        sa.Column("api_token", sa.String(length=255), nullable=False),
        sa.Column("api_token_enabled", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "users",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("username", sa.String(length=100), nullable=False),
        sa.Column("callsign", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_users_callsign"), "users", ["callsign"], unique=False)
    op.create_index(op.f("ix_users_username"), "users", ["username"], unique=True)

    op.create_table(
        "logbooks",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("operator_callsign", sa.String(length=32), nullable=False),
        sa.Column("park_reference", sa.String(length=32), nullable=True),
        sa.Column("activation_date", sa.String(length=16), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_logbooks_operator_callsign"), "logbooks", ["operator_callsign"], unique=False)
    op.create_index(op.f("ix_logbooks_user_id"), "logbooks", ["user_id"], unique=False)

    op.create_table(
        "contacts",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("logbook_id", sa.String(length=36), nullable=False),
        sa.Column("station_callsign", sa.String(length=32), nullable=False),
        sa.Column("operator_callsign", sa.String(length=32), nullable=False),
        sa.Column("qso_date", sa.String(length=16), nullable=False),
        sa.Column("time_on", sa.String(length=16), nullable=False),
        sa.Column("band", sa.String(length=16), nullable=False),
        sa.Column("mode", sa.String(length=16), nullable=False),
        sa.Column("frequency_khz", sa.Float(), nullable=False),
        sa.Column("park_reference", sa.String(length=32), nullable=True),
        sa.Column("rst_sent", sa.String(length=8), nullable=True),
        sa.Column("rst_recvd", sa.String(length=8), nullable=True),
        sa.Column("grid_square", sa.String(length=16), nullable=True),
        sa.Column("country", sa.String(length=128), nullable=True),
        sa.Column("state", sa.String(length=64), nullable=True),
        sa.Column("lat", sa.Float(), nullable=True),
        sa.Column("lon", sa.Float(), nullable=True),
        sa.Column("source_spot_id", sa.String(length=36), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["logbook_id"], ["logbooks.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_contacts_logbook_id"), "contacts", ["logbook_id"], unique=False)
    op.create_index(op.f("ix_contacts_operator_callsign"), "contacts", ["operator_callsign"], unique=False)
    op.create_index(op.f("ix_contacts_qso_date"), "contacts", ["qso_date"], unique=False)
    op.create_index(op.f("ix_contacts_station_callsign"), "contacts", ["station_callsign"], unique=False)

    op.create_table(
        "sync_events",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("entity_type", sa.String(length=32), nullable=False),
        sa.Column("entity_id", sa.String(length=36), nullable=False),
        sa.Column("action", sa.String(length=16), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("client_timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_sync_events_entity_id"), "sync_events", ["entity_id"], unique=False)
    op.create_index(op.f("ix_sync_events_user_id"), "sync_events", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_sync_events_user_id"), table_name="sync_events")
    op.drop_index(op.f("ix_sync_events_entity_id"), table_name="sync_events")
    op.drop_table("sync_events")
    op.drop_index(op.f("ix_contacts_station_callsign"), table_name="contacts")
    op.drop_index(op.f("ix_contacts_qso_date"), table_name="contacts")
    op.drop_index(op.f("ix_contacts_operator_callsign"), table_name="contacts")
    op.drop_index(op.f("ix_contacts_logbook_id"), table_name="contacts")
    op.drop_table("contacts")
    op.drop_index(op.f("ix_logbooks_user_id"), table_name="logbooks")
    op.drop_index(op.f("ix_logbooks_operator_callsign"), table_name="logbooks")
    op.drop_table("logbooks")
    op.drop_index(op.f("ix_users_username"), table_name="users")
    op.drop_index(op.f("ix_users_callsign"), table_name="users")
    op.drop_table("users")
    op.drop_table("app_settings")
