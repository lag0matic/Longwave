import os
import shutil
import sys
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


def application_root() -> Path:
    if getattr(sys, "frozen", False):
        local_app_data = Path(os.getenv("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
        runtime_root = local_app_data / "LongwaveServer"
        runtime_root.mkdir(parents=True, exist_ok=True)
        return runtime_root
    return Path(__file__).resolve().parents[1]


def bundled_resource_root() -> Path:
    return Path(getattr(sys, "_MEIPASS", application_root()))


def default_database_url() -> str:
    database_path = application_root() / "longwave.db"
    return f"sqlite:///{database_path.as_posix()}"


def resolve_env_file() -> Path:
    explicit = os.getenv("LONGWAVE_ENV_FILE")
    if explicit:
        return Path(explicit).expanduser().resolve()
    env_path = application_root() / ".env"
    if getattr(sys, "frozen", False) and not env_path.exists():
        example_path = bundled_resource_root() / ".env.example"
        if example_path.exists():
            example_text = example_path.read_text(encoding="utf-8")
            example_text = example_text.replace("DATABASE_URL=sqlite:///./longwave.db", f"DATABASE_URL={default_database_url()}")
            env_path.write_text(example_text, encoding="utf-8")
    return env_path


class Settings(BaseSettings):
    app_name: str = "Longwave API"
    environment: str = "development"
    api_prefix: str = "/api/v1"
    database_url: str = default_database_url()
    host: str = "127.0.0.1"
    port: int = 8000
    log_level: str = "info"
    ssl_certfile: str | None = None
    ssl_keyfile: str | None = None
    cors_origins: str = "http://127.0.0.1:4173,http://localhost:4173"
    allowed_hosts: str = "127.0.0.1,localhost"
    enable_docs: bool = False
    public_healthcheck: bool = False
    auth_rate_limit_window_seconds: int = 300
    auth_rate_limit_max_failures: int = 10
    seed_demo_data: bool = False
    qrz_username: str | None = None
    qrz_password: str | None = None
    qrz_api_key: str | None = None
    qrz_xml_url: str = "https://xmldata.qrz.com/xml/current/"
    qrz_logbook_api_url: str = "https://logbook.qrz.com/api"
    pota_api_key: str | None = None
    pota_spots_url: str = "https://api.pota.app/spot/activator"
    pota_spot_post_url: str = "https://api.pota.app/spot"

    model_config = SettingsConfigDict(
        env_file_encoding="utf-8",
        extra="ignore",
    )

    def parsed_cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    def parsed_allowed_hosts(self) -> list[str]:
        return [host.strip() for host in self.allowed_hosts.split(",") if host.strip()]

    def https_enabled(self) -> bool:
        return bool(self.ssl_certfile and self.ssl_keyfile)

    def url_scheme(self) -> str:
        return "https" if self.https_enabled() else "http"

    def validate_https_configuration(self) -> None:
        if bool(self.ssl_certfile) != bool(self.ssl_keyfile):
            raise ValueError("HTTPS requires both SSL_CERTFILE and SSL_KEYFILE to be set.")


@lru_cache
def get_settings() -> Settings:
    return Settings(_env_file=resolve_env_file())
