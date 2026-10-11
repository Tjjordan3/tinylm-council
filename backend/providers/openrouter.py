"""OpenRouter cloud provider."""

from __future__ import annotations

import asyncio
import json
import os
import time
from typing import AsyncIterator, Dict, List, Optional

from ..http_client import get_http_client, get_streaming_client
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

    def _headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def _build_payload(
        self,
        model: str,
        messages: List[Dict[str, str]],
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
        stream: bool = False,
    ) -> Dict:
        payload: Dict = {"model": model, "messages": messages}
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens
        if temperature is not None:
            payload["temperature"] = temperature
        if stream:
            payload["stream"] = True
        return payload

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

        payload = self._build_payload(model, messages, max_tokens, temperature)
        try:
            client = get_http_client()
            response = await client.post(
                f"{self.config.base_url.rstrip('/')}/chat/completions",
                headers=self._headers(),
                json=payload,
                timeout=timeout,
            )
            response.raise_for_status()
            data = response.json()
            message = data["choices"][0]["message"]
            return CompletionResult(
                content=message.get("content") or "",
                reasoning_details=message.get("reasoning_details"),
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            return CompletionResult(content="", error=str(exc))

    async def complete_stream(
        self,
        model: str,
        messages: List[Dict[str, str]],
        timeout: float = 120.0,
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
    ) -> AsyncIterator[str]:
        if not self.api_key:
            raise RuntimeError(
                "OpenRouter API key not configured. Set OPENROUTER_API_KEY in .env"
            )

        payload = self._build_payload(
            model, messages, max_tokens, temperature, stream=True
        )
        client = get_streaming_client()
        async with client.stream(
            "POST",
            f"{self.config.base_url.rstrip('/')}/chat/completions",
            headers=self._headers(),
            json=payload,
            timeout=timeout,
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line:
                    continue
                if line.startswith("data: "):
                    data_str = line[6:].strip()
                else:
                    data_str = line.strip()
                if not data_str or data_str == "[DONE]":
                    if data_str == "[DONE]":
                        break
                    continue
                try:
                    data = json.loads(data_str)
                except json.JSONDecodeError:
                    continue
                choices = data.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta") or {}
                content = delta.get("content")
                if content:
                    yield content

    async def list_models(self) -> List[ModelInfo]:
        if not self.api_key:
            return []

        try:
            client = get_http_client()
            response = await client.get(
                f"{self.config.base_url.rstrip('/')}/models",
                headers={"Authorization": f"Bearer {self.api_key}"},
                timeout=30.0,
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
            client = get_http_client()
            response = await client.get(
                f"{self.config.base_url.rstrip('/')}/models",
                headers={"Authorization": f"Bearer {self.api_key}"},
                timeout=15.0,
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
