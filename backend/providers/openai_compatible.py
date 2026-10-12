"""OpenAI-compatible provider for Ollama, LM Studio, LocalAI, vLLM, etc."""

from __future__ import annotations

import asyncio
import json
import os
import time
from typing import Any, AsyncIterator, Dict, List, Optional

import httpx

from ..http_client import get_http_client, get_streaming_client
from .base import (
    CompletionResult,
    ConnectionTestResult,
    ModelInfo,
    ProviderCapabilities,
    ProviderConfig,
)


class OpenAICompatibleProvider:
    def __init__(self, config: ProviderConfig):
        self.config = config
        self.api_key = self._resolve_api_key()

    def _resolve_api_key(self) -> Optional[str]:
        preset = (self.config.preset or "").lower()
        if preset == "nvidia":
            from ..settings import load_settings

            settings = load_settings()
            if settings.nvidia_api_key and settings.nvidia_api_key.strip():
                return settings.nvidia_api_key.strip()
            env_key = os.getenv("NVIDIA_API_KEY")
            return env_key.strip() if env_key and env_key.strip() else None
        if not self.config.api_key_env:
            return None
        return os.getenv(self.config.api_key_env) or None

    def _missing_nvidia_key_message(self) -> str:
        return (
            "Add your NVIDIA API key in Settings → NVIDIA NIM "
            "or set NVIDIA_API_KEY in .env (free key at https://build.nvidia.com)"
        )

    def _headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    def get_capabilities(self) -> ProviderCapabilities:
        preset = (self.config.preset or "").lower()
        if preset == "ollama":
            return ProviderCapabilities(
                can_list_models=True,
                can_pull=True,
                can_load=False,
                can_unload=False,
                can_delete=True,
                can_list_running=True,
                native_api_available=True,
                notes="Ollama loads models on first use. Use Model Manager to pull/delete.",
            )
        if preset == "lmstudio":
            return ProviderCapabilities(
                can_list_models=True,
                can_pull=True,
                can_load=True,
                can_unload=True,
                can_delete=False,
                can_list_running=True,
                native_api_available=True,
                notes="Download/load requires LM Studio 0.4+ native API.",
            )
        if preset == "nvidia":
            return ProviderCapabilities(
                can_list_models=True,
                can_pull=False,
                can_load=False,
                can_unload=False,
                can_delete=False,
                can_list_running=False,
                native_api_available=False,
                notes="Cloud models via NVIDIA NIM API; browse catalog in Models and add to council.",
            )
        return ProviderCapabilities(
            can_list_models=True,
            can_pull=False,
            can_load=False,
            can_unload=False,
            can_delete=False,
            can_list_running=False,
            native_api_available=False,
            notes="Generic OpenAI-compatible endpoint; list models only.",
        )

    def _build_payload(
        self,
        model: str,
        messages: List[Dict[str, Any]],
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
        messages: List[Dict[str, Any]],
        timeout: float = 120.0,
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
    ) -> CompletionResult:
        if (self.config.preset or "").lower() == "nvidia" and not self.api_key:
            return CompletionResult(content="", error=self._missing_nvidia_key_message())
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
            return CompletionResult(content=message.get("content") or "")
        except asyncio.CancelledError:
            raise
        except httpx.TimeoutException as exc:
            return CompletionResult(content="", error=f"Timeout: {exc}")
        except Exception as exc:
            return CompletionResult(content="", error=str(exc))

    async def complete_stream(
        self,
        model: str,
        messages: List[Dict[str, Any]],
        timeout: float = 120.0,
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
    ) -> AsyncIterator[str]:
        """Yield text deltas from a streaming chat completion."""
        if (self.config.preset or "").lower() == "nvidia" and not self.api_key:
            raise RuntimeError(self._missing_nvidia_key_message())

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
        if (self.config.preset or "").lower() == "nvidia" and not self.api_key:
            return []
        try:
            client = get_http_client()
            response = await client.get(
                f"{self.config.base_url.rstrip('/')}/models",
                headers=self._headers(),
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
        if (self.config.preset or "").lower() == "nvidia" and not self.api_key:
            return ConnectionTestResult(ok=False, message=self._missing_nvidia_key_message())
        start = time.perf_counter()
        try:
            client = get_http_client()
            response = await client.get(
                f"{self.config.base_url.rstrip('/')}/models",
                headers=self._headers(),
                timeout=15.0,
            )
            response.raise_for_status()
            latency = (time.perf_counter() - start) * 1000
            return ConnectionTestResult(
                ok=True,
                message=f"Connected to {self.config.name}",
                latency_ms=round(latency, 1),
            )
        except Exception as exc:
            return ConnectionTestResult(
                ok=False,
                message=f"Cannot reach {self.config.name} at {self.config.base_url}: {exc}",
            )

