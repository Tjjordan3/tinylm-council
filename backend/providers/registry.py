"""Provider registry and factory."""

from __future__ import annotations

from typing import Dict, List, Optional

from .base import (
    AppSettings,
    CompletionResult,
    CouncilMember,
    LLMProvider,
    ProviderCapabilities,
    ProviderConfig,
)
from .lmstudio_native import LMStudioNativeClient
from .ollama_native import OllamaNativeClient
from .openai_compatible import OpenAICompatibleProvider
from .openrouter import OpenRouterProvider


PROVIDER_PRESETS = [
    {
        "id": "openrouter",
        "type": "openrouter",
        "name": "OpenRouter",
        "base_url": "https://openrouter.ai/api/v1",
        "api_key_env": "OPENROUTER_API_KEY",
        "preset": "openrouter",
    },
    {
        "id": "ollama",
        "type": "openai_compatible",
        "name": "Ollama",
        "base_url": "http://localhost:11434/v1",
        "native_base_url": "http://localhost:11434",
        "api_key_env": None,
        "preset": "ollama",
    },
    {
        "id": "lmstudio",
        "type": "openai_compatible",
        "name": "LM Studio",
        "base_url": "http://localhost:1234/v1",
        "native_base_url": "http://localhost:1234",
        "api_key_env": "LM_API_TOKEN",
        "preset": "lmstudio",
    },
    {
        "id": "localai",
        "type": "openai_compatible",
        "name": "LocalAI",
        "base_url": "http://localhost:8080/v1",
        "native_base_url": "http://localhost:8080",
        "api_key_env": None,
        "preset": "localai",
    },
    {
        "id": "vllm",
        "type": "openai_compatible",
        "name": "vLLM",
        "base_url": "http://localhost:8000/v1",
        "native_base_url": "http://localhost:8000",
        "api_key_env": None,
        "preset": "vllm",
    },
]


def config_from_dict(data: dict) -> ProviderConfig:
    return ProviderConfig(
        id=data["id"],
        type=data["type"],
        name=data["name"],
        base_url=data["base_url"],
        api_key_env=data.get("api_key_env"),
        native_base_url=data.get("native_base_url"),
        preset=data.get("preset"),
    )


def member_from_dict(data: dict) -> CouncilMember:
    return CouncilMember(
        id=data["id"],
        provider_id=data["provider_id"],
        model=data["model"],
        display_name=data.get("display_name", data["model"]),
        enabled=data.get("enabled", True),
    )


def create_provider(config: ProviderConfig) -> LLMProvider:
    if config.type == "openrouter":
        return OpenRouterProvider(config)
    return OpenAICompatibleProvider(config)


class ProviderRegistry:
    def __init__(self, settings: AppSettings):
        self.settings = settings
        self._providers: Dict[str, LLMProvider] = {}

    def refresh(self, settings: AppSettings) -> None:
        self.settings = settings
        self._providers = {
            p.id: create_provider(p) for p in settings.providers
        }

    def get_provider(self, provider_id: str) -> Optional[LLMProvider]:
        return self._providers.get(provider_id)

    def get_capabilities(self, provider_id: str) -> ProviderCapabilities:
        provider = self.get_provider(provider_id)
        if not provider:
            return ProviderCapabilities(can_list_models=False, notes="Provider not found")
        return provider.get_capabilities()

    def get_native_client(self, provider_id: str):
        config = self.settings.get_provider(provider_id)
        if not config:
            return None
        preset = (config.preset or "").lower()
        if preset == "ollama":
            return OllamaNativeClient(config)
        if preset == "lmstudio":
            return LMStudioNativeClient(config)
        return None

    async def ensure_model_ready(self, member: CouncilMember) -> Optional[str]:
        """Load model into memory for LM Studio before inference."""
        config = self.settings.get_provider(member.provider_id)
        if not config or (config.preset or "").lower() != "lmstudio":
            return None

        native = self.get_native_client(member.provider_id)
        if not native or not hasattr(native, "load_model"):
            return None

        result = await native.load_model(member.model)
        if result.get("error"):
            error = result["error"]
            if "native API not available" in error:
                return None
            return error
        return None

    async def complete_member(
        self,
        member: CouncilMember,
        messages: List[dict],
        timeout: float = 120.0,
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
    ):
        provider = self.get_provider(member.provider_id)
        if not provider:
            return CompletionResult(
                content="",
                error=f"Provider '{member.provider_id}' not found",
            )

        load_error = await self.ensure_model_ready(member)
        if load_error:
            return CompletionResult(
                content="",
                error=f"Could not load {member.model} in LM Studio: {load_error}",
            )

        result = await provider.complete(
            member.model,
            messages,
            timeout=timeout,
            max_tokens=max_tokens,
            temperature=temperature,
        )

        if not result.error and not (result.content or "").strip():
            return CompletionResult(
                content="",
                error=f"Model {member.display_name or member.model} returned an empty response",
            )

        return result
