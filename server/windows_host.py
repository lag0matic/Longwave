from __future__ import annotations

import os
import subprocess
import sys
import webbrowser
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
import threading
from tkinter import BOTH, LEFT, RIGHT, X, Button, Entry, Frame, Label, StringVar, Tk

import httpx
import uvicorn
from alembic import command
from alembic.config import Config

from app.config import application_root, bundled_resource_root, get_settings, resolve_env_file
from app.db import SessionLocal
from app.repositories import ensure_app_settings
from app.main import app as fastapi_app


@dataclass
class HealthSnapshot:
    status: str
    database: str
    detail: str = ""


class ServerController:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.process: subprocess.Popen[str] | None = None
        self.output_thread: threading.Thread | None = None
        self.last_error = ""
        self.log_path = application_root() / "host.log"

    @property
    def base_url(self) -> str:
        return f"{self.settings.url_scheme()}://127.0.0.1:{self.settings.port}{self.settings.api_prefix}"

    def run_migrations(self) -> None:
        config = Config(str(bundled_resource_root() / "alembic.ini"))
        config.set_main_option("script_location", str(bundled_resource_root() / "alembic"))
        config.set_main_option("prepend_sys_path", str(bundled_resource_root()))
        config.set_main_option("sqlalchemy.url", self.settings.database_url)
        command.upgrade(config, "head")

    def tokens(self) -> tuple[str, str]:
        with SessionLocal() as session:
            settings = ensure_app_settings(session)
            return (
                settings.client_api_token or settings.api_token,
                settings.admin_api_token or settings.api_token,
            )

    def log(self, message: str) -> None:
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        with self.log_path.open("a", encoding="utf-8") as handle:
            handle.write(f"[{timestamp}] {message}\n")

    def is_running(self) -> bool:
        return bool(self.process and self.process.poll() is None)

    def start(self) -> None:
        if self.is_running():
            return

        self.last_error = ""
        self.settings.validate_https_configuration()
        self.log("Starting server host")
        self.run_migrations()
        client_token, admin_token = self.tokens()
        self.log(f"Client API token ready ({len(client_token)} chars)")
        self.log(f"Admin API token ready ({len(admin_token)} chars)")
        command = self._server_command()
        self.log(f"Launching API subprocess: {' '.join(command)}")
        creation_flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        self.process = subprocess.Popen(
            command,
            cwd=str(bundled_resource_root()),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            creationflags=creation_flags,
        )
        self.output_thread = threading.Thread(target=self._stream_process_output, daemon=True)
        self.output_thread.start()

    def _stream_process_output(self) -> None:
        if not self.process or not self.process.stdout:
            return
        for line in self.process.stdout:
            self.log(f"api> {line.rstrip()}")

    def _server_command(self) -> list[str]:
        if getattr(sys, "frozen", False):
            return [sys.executable, "--run-api"]
        return [sys.executable, str(Path(__file__).resolve()), "--run-api"]

    def stop(self) -> None:
        if not self.process:
            return

        self.process.terminate()
        try:
            self.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.process.kill()
        self.process = None
        self.output_thread = None

    def health(self) -> HealthSnapshot:
        try:
            request_kwargs: dict[str, object] = {"timeout": 2.0}
            if self.settings.https_enabled():
                request_kwargs["verify"] = False
            client_token, _ = self.tokens()
            request_kwargs["headers"] = {"X-Api-Key": client_token}
            response = httpx.get(f"{self.base_url}/health", **request_kwargs)
            response.raise_for_status()
            payload = response.json()
            return HealthSnapshot(status=payload.get("status", "unknown"), database=payload.get("database", "unknown"))
        except Exception as error:  # noqa: BLE001
            detail = str(error)
            if self.last_error and not detail:
                detail = self.last_error
            return HealthSnapshot(status="offline", database="unknown", detail=detail)


class ServerHostApp:
    def __init__(self) -> None:
        self.controller = ServerController()
        self.root = Tk()
        self.root.title("Longwave Server")
        self.root.geometry("640x360")
        self.root.minsize(560, 320)
        self.root.protocol("WM_DELETE_WINDOW", self.on_close)

        self.status_var = StringVar(value="Starting...")
        self.health_var = StringVar(value="Checking...")
        self.database_var = StringVar(value="--")
        self.url_var = StringVar(value=self.controller.base_url)
        self.client_token_var = StringVar(value="")
        self.admin_token_var = StringVar(value="")
        self.env_var = StringVar(value=str(resolve_env_file()))
        self.data_var = StringVar(value=str(application_root()))

        self.build_ui()
        self.start_server()
        self.refresh_status()

    def build_ui(self) -> None:
        self.root.configure(background="#101726")

        main = Frame(self.root, bg="#101726", padx=18, pady=18)
        main.pack(fill=BOTH, expand=True)

        header = Frame(main, bg="#101726")
        header.pack(fill=X)
        Label(header, text="Longwave Server", fg="#eef4ff", bg="#101726", font=("Segoe UI", 18, "bold")).pack(anchor="w")
        Label(header, text="Self-hosted API host for Windows", fg="#91b2f0", bg="#101726", font=("Segoe UI", 10)).pack(anchor="w")

        card = Frame(main, bg="#202b3f", padx=16, pady=16, highlightbackground="#3f4c6d", highlightthickness=1)
        card.pack(fill=BOTH, expand=True, pady=(16, 0))

        self.add_readout(card, "Server Status", self.status_var)
        self.add_readout(card, "Health", self.health_var)
        self.add_readout(card, "Database", self.database_var)
        self.add_readout(card, "API URL", self.url_var)
        self.add_readout(card, "Client Token", self.client_token_var, readonly=True)
        self.add_readout(card, "Admin Token", self.admin_token_var, readonly=True)
        self.add_readout(card, "Env File", self.env_var, readonly=True)
        self.add_readout(card, "Data Folder", self.data_var, readonly=True)

        actions = Frame(card, bg="#202b3f")
        actions.pack(fill=X, pady=(14, 0))

        Button(actions, text="Start", command=self.start_server, bg="#19a56f", fg="white", relief="flat", padx=14, pady=8).pack(side=LEFT)
        Button(actions, text="Stop", command=self.stop_server, bg="#7b3340", fg="white", relief="flat", padx=14, pady=8).pack(side=LEFT, padx=(10, 0))
        Button(actions, text="Open Health", command=lambda: webbrowser.open(f"{self.controller.base_url}/health"), bg="#647691", fg="white", relief="flat", padx=14, pady=8).pack(side=LEFT, padx=(10, 0))
        Button(actions, text="Open Data Folder", command=self.open_data_folder, bg="#647691", fg="white", relief="flat", padx=14, pady=8).pack(side=RIGHT)
        Button(actions, text="Copy Client Token", command=self.copy_client_token, bg="#647691", fg="white", relief="flat", padx=14, pady=8).pack(side=RIGHT, padx=(0, 10))
        Button(actions, text="Copy Admin Token", command=self.copy_admin_token, bg="#647691", fg="white", relief="flat", padx=14, pady=8).pack(side=RIGHT, padx=(0, 10))

    def add_readout(self, parent: Frame, label_text: str, variable: StringVar, readonly: bool = False) -> None:
        row = Frame(parent, bg="#202b3f")
        row.pack(fill=X, pady=4)
        Label(row, text=label_text, fg="#8fb1f0", bg="#202b3f", width=12, anchor="w", font=("Segoe UI", 10, "bold")).pack(side=LEFT)
        entry = Entry(row, textvariable=variable, relief="flat", readonlybackground="#11192b", bg="#11192b", fg="#eef4ff")
        if readonly:
            entry.configure(state="readonly")
        entry.pack(side=RIGHT, fill=X, expand=True)

    def start_server(self) -> None:
        try:
            self.controller.start()
            client_token, admin_token = self.controller.tokens()
            self.client_token_var.set(client_token)
            self.admin_token_var.set(admin_token)
            self.status_var.set("Starting...")
        except Exception as error:  # noqa: BLE001
            self.controller.last_error = str(error)
            self.status_var.set("Failed to start")
            self.health_var.set(str(error))

    def stop_server(self) -> None:
        self.controller.stop()
        self.status_var.set("Stopped")
        self.health_var.set("offline")
        self.database_var.set("--")

    def refresh_status(self) -> None:
        snapshot = self.controller.health()
        if self.controller.is_running():
            self.status_var.set("Running" if snapshot.status == "ok" else "Starting...")
        else:
            self.status_var.set("Stopped")
        self.health_var.set(snapshot.status if not snapshot.detail else f"{snapshot.status}: {snapshot.detail}")
        self.database_var.set(snapshot.database)
        self.root.after(2000, self.refresh_status)

    def copy_client_token(self) -> None:
        self.root.clipboard_clear()
        self.root.clipboard_append(self.client_token_var.get())
        self.root.update()

    def copy_admin_token(self) -> None:
        self.root.clipboard_clear()
        self.root.clipboard_append(self.admin_token_var.get())
        self.root.update()

    def open_data_folder(self) -> None:
        os.startfile(application_root())  # type: ignore[attr-defined]

    def on_close(self) -> None:
        self.stop_server()
        self.root.destroy()

    def run(self) -> None:
        self.root.mainloop()


if __name__ == "__main__":
    if "--run-api" in sys.argv:
        settings = get_settings()
        settings.validate_https_configuration()
        uvicorn.run(
            fastapi_app,
            host=settings.host,
            port=settings.port,
            log_level=settings.log_level,
            proxy_headers=True,
            ssl_certfile=settings.ssl_certfile,
            ssl_keyfile=settings.ssl_keyfile,
        )
    else:
        ServerHostApp().run()
