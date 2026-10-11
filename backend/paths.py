"""Resolve writable data directories for dev and packaged desktop builds."""

from __future__ import annotations

import os
import sys
from pathlib import Path


def project_root() -> Path:
    """Repository root in source checkouts; beside the frozen exe when packaged."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent.parent


def is_desktop_mode() -> bool:
    if os.environ.get("TINYLM_DESKTOP") == "1":
        return True
    return bool(getattr(sys, "frozen", False))


def app_data_dir() -> Path:
    """User-writable data root for settings, conversations, and optional .env."""
    override = os.environ.get("TINYLM_COUNCIL_DATA")
    if override:
        path = Path(override).expanduser().resolve()
        path.mkdir(parents=True, exist_ok=True)
        return path

    if is_desktop_mode():
        if sys.platform == "win32":
            base = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local"))
            path = base / "TinyLM Council"
        elif sys.platform == "darwin":
            path = Path.home() / "Library" / "Application Support" / "TinyLM Council"
        else:
            xdg = os.environ.get("XDG_DATA_HOME")
            base = Path(xdg) if xdg else Path.home() / ".local" / "share"
            path = base / "tinylm-council"
        path.mkdir(parents=True, exist_ok=True)
        return path

    path = project_root() / "data"
    path.mkdir(parents=True, exist_ok=True)
    return path


def settings_path() -> Path:
    return app_data_dir() / "settings.json"


def conversations_dir() -> Path:
    path = app_data_dir() / "conversations"
    path.mkdir(parents=True, exist_ok=True)
    return path


def load_env_files() -> None:
    """Load .env from the project root (dev) and the user data dir (overrides)."""
    from dotenv import load_dotenv

    load_dotenv(project_root() / ".env")
    data_env = app_data_dir() / ".env"
    if data_env.exists():
        load_dotenv(data_env, override=True)
