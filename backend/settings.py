"""Settings persistence."""

from __future__ import annotations

import json
import os
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from .providers.base import AppSettings, CouncilMember, ProviderConfig
from .providers.registry import (
    PROVIDER_PRESETS,
    config_from_dict,
    member_from_dict,
)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
SETTINGS_PATH = DATA_DIR / "settings.json"


def _default_settings() -> AppSettings:
    providers = [
        ProviderConfig(
            id="ollama",
            type="openai_compatible",
            name="Ollama",
            base_url="http://localhost:11434/v1",
            native_base_url="http://localhost:11434",
            api_key_env=None,
            preset="ollama",
        ),
        ProviderConfig(
            id="openrouter",
            type="openrouter",
            name="OpenRouter",
            base_url="https://openrouter.ai/api/v1",
            api_key_env="OPENROUTER_API_KEY",
            preset="openrouter",
        ),
        ProviderConfig(
            id="lmstudio",
            type="openai_compatible",
            name="LM Studio",
            base_url="http://localhost:1234/v1",
            native_base_url="http://localhost:1234",
            api_key_env="LM_API_TOKEN",
            preset="lmstudio",
        ),
    ]
    members = [
        CouncilMember(
            id="m1",
            provider_id="ollama",
            model="qwen2.5:0.5b",
            display_name="Qwen 0.5B",
            enabled=False,
        ),
        CouncilMember(
            id="m2",
            provider_id="ollama",
            model="phi3:mini",
            display_name="Phi-3 Mini",
            enabled=False,
        ),
        CouncilMember(
            id="m3",
            provider_id="ollama",
            model="gemma2:2b",
            display_name="Gemma 2B",
            enabled=False,
        ),
    ]
    return AppSettings(
        providers=providers,
        council_members=members,
        chairman_member_id="m1",
        council_profile="tiny",
        setup_complete=False,
    )


def _serper_api_key_source(settings: AppSettings) -> Optional[str]:
    if settings.serper_api_key and settings.serper_api_key.strip():
        return "settings"
    env_key = os.getenv("SERPER_API_KEY")
    if env_key and env_key.strip():
        return "env"
    return None


def _serper_api_key_configured(settings: AppSettings) -> bool:
    return _serper_api_key_source(settings) is not None


def settings_to_dict(settings: AppSettings, *, include_secrets: bool = False) -> Dict[str, Any]:
    result: Dict[str, Any] = {
        "providers": [
            {
                "id": p.id,
                "type": p.type,
                "name": p.name,
                "base_url": p.base_url,
                "api_key_env": p.api_key_env,
                "native_base_url": p.native_base_url,
                "preset": p.preset,
            }
            for p in settings.providers
        ],
        "council_members": [
            {
                "id": m.id,
                "provider_id": m.provider_id,
                "model": m.model,
                "display_name": m.display_name,
                "enabled": m.enabled,
            }
            for m in settings.council_members
        ],
        "chairman_member_id": settings.chairman_member_id,
        "council_profile": settings.council_profile,
        "setup_complete": settings.setup_complete,
    }
    if include_secrets:
        result["serper_api_key"] = settings.serper_api_key
    else:
        result["serper_api_key_configured"] = _serper_api_key_configured(settings)
        result["serper_api_key_source"] = _serper_api_key_source(settings)
    return result


def settings_from_dict(data: Dict[str, Any]) -> AppSettings:
    return AppSettings(
        providers=[config_from_dict(p) for p in data.get("providers", [])],
        council_members=[member_from_dict(m) for m in data.get("council_members", [])],
        chairman_member_id=data.get("chairman_member_id"),
        council_profile=data.get("council_profile", "tiny"),
        setup_complete=data.get("setup_complete", False),
        serper_api_key=data.get("serper_api_key"),
    )


def ensure_data_dir() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "conversations").mkdir(parents=True, exist_ok=True)


def load_settings() -> AppSettings:
    ensure_data_dir()
    if not SETTINGS_PATH.exists():
        settings = _default_settings()
        save_settings(settings)
        return settings
    with open(SETTINGS_PATH, "r", encoding="utf-8") as f:
        return settings_from_dict(json.load(f))


def save_settings(settings: AppSettings) -> None:
    ensure_data_dir()
    with open(SETTINGS_PATH, "w", encoding="utf-8") as f:
        json.dump(settings_to_dict(settings, include_secrets=True), f, indent=2)


def update_settings(data: Dict[str, Any]) -> AppSettings:
    current = load_settings()
    if "providers" in data:
        current.providers = [config_from_dict(p) for p in data["providers"]]
    if "council_members" in data:
        current.council_members = [member_from_dict(m) for m in data["council_members"]]
    if "chairman_member_id" in data:
        current.chairman_member_id = data["chairman_member_id"]
    if "council_profile" in data:
        current.council_profile = data["council_profile"]
    if "setup_complete" in data:
        current.setup_complete = data["setup_complete"]
    if "serper_api_key" in data:
        key = data["serper_api_key"]
        current.serper_api_key = key.strip() if key and key.strip() else None
    save_settings(current)
    return current


def add_council_member(provider_id: str, model: str, display_name: Optional[str] = None) -> CouncilMember:
    settings = load_settings()
    member = CouncilMember(
        id=f"m{uuid.uuid4().hex[:8]}",
        provider_id=provider_id,
        model=model,
        display_name=display_name or model.split("/")[-1],
        enabled=True,
    )
    settings.council_members.append(member)
    if not settings.chairman_member_id:
        settings.chairman_member_id = member.id
    save_settings(settings)
    return member


def get_presets() -> List[dict]:
    return PROVIDER_PRESETS
