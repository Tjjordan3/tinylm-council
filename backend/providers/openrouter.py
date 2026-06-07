"""OpenRouter cloud provider."""

from __future__ import annotations

import os
import time
from typing import Dict, List, Optional

import httpx

from .base import (
    CompletionResult,
    ConnectionTestResult,
    ModelInfo,
    ProviderCapabilities,
    ProviderConfig,
)


class OpenRouterProvider:
    def __init__(self, config: ProviderConfig):
        self.config = config
        self.api_key = os.getenv(config.api_key_env or "OPENROUTER_API_KEY", "")

    def get_capabilities(self) -> ProviderCapabilities:
        return ProviderCapabilities(
            can_list_models=True,
            can_pull=False,
            can_load=False,
            can_unload=False,
            can_delete=False,
            can_list_running=False,
            native_api_available=False,
            notes="Cloud models are accessed via OpenRouter; no local download.",
        )

    async def complete(
        self,
        model: str,
        messages: List[Dict[str, str]],
        timeout: float = 120.0,
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
    ) -> CompletionResult:
        if not self.api_key:
            return CompletionResult(
                content="",
                error="OpenRouter API key not configured. Set OPENROUTER_API_KEY in .env",
            )

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = {"model": model, "messages": messages}
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens
        if temperature is not None:
            payload["temperature"] = temperature

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(
                    f"{self.config.base_url.rstrip('/')}/chat/completions",
                    headers=headers,
                    json=payload,
                )
                response.raise_for_status()
                data = response.json()
                message = data["choices"][0]["message"]
                return CompletionResult(
                    content=message.get("content") or "",
                    reasoning_details=message.get("reasoning_details"),
                )
        except Exception as exc:
            return CompletionResult(content="", error=str(exc))

    async def list_models(self) -> List[ModelInfo]:
        if not self.api_key:
            return []

        headers = {"Authorization": f"Bearer {self.api_key}"}
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(
                    f"{self.config.base_url.rstrip('/')}/models",
                    headers=headers,
                )
                response.raise_for_status()
                data = response.json()
                models = []
                for item in data.get("data", []):
                    model_id = item.get("id", "")
                    if model_id:
                        models.append(ModelInfo(id=model_id, name=model_id))
                return sorted(models, key=lambda m: m.id)
        except Exception:
            return []

    async def test_connection(self) -> ConnectionTestResult:
        if not self.api_key:
            return ConnectionTestResult(
                ok=False,
                message="OPENROUTER_API_KEY is not set in .env",
            )

        start = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.get(
                    f"{self.config.base_url.rstrip('/')}/models",
                    headers={"Authorization": f"Bearer {self.api_key}"},
                )
                response.raise_for_status()
                latency = (time.perf_counter() - start) * 1000
                return ConnectionTestResult(
                    ok=True,
                    message="Connected to OpenRouter",
                    latency_ms=round(latency, 1),
                )
        except Exception as exc:
            return ConnectionTestResult(ok=False, message=str(exc))
