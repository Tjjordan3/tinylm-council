"""LM Studio native v1 API for model management."""

from __future__ import annotations

import json
import os
from typing import AsyncIterator, Dict, List, Optional

import httpx

from .base import ModelInfo, ProgressEvent, ProviderConfig


class LMStudioNativeClient:
    def __init__(self, config: ProviderConfig):
        native = config.native_base_url or config.base_url.replace("/v1", "")
        self.base_url = native.rstrip("/")
        self.api_token = os.getenv("LM_API_TOKEN") or os.getenv(config.api_key_env or "")

    def _headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_token:
            headers["Authorization"] = f"Bearer {self.api_token}"
        return headers

    async def _request(self, method: str, path: str, **kwargs) -> httpx.Response:
        async with httpx.AsyncClient(timeout=kwargs.pop("timeout", 120.0)) as client:
            response = await client.request(
                method,
                f"{self.base_url}{path}",
                headers=self._headers(),
                **kwargs,
            )
            return response

    async def list_installed_models(self) -> List[ModelInfo]:
        try:
            response = await self._request("GET", "/api/v1/models")
            if response.status_code == 404:
                return []
            response.raise_for_status()
            data = response.json()
            models = []
            items = data if isinstance(data, list) else data.get("models", data.get("data", []))
            for item in items:
                if isinstance(item, str):
                    models.append(ModelInfo(id=item, name=item))
                elif isinstance(item, dict):
                    model_id = item.get("id") or item.get("model") or item.get("name", "")
                    if model_id:
                        models.append(
                            ModelInfo(
                                id=model_id,
                                name=model_id,
                                loaded=item.get("loaded", False),
                            )
                        )
            return sorted(models, key=lambda m: m.id)
        except Exception:
            return []

    async def download_model(self, model: str) -> AsyncIterator[ProgressEvent]:
        try:
            async with httpx.AsyncClient(timeout=None) as client:
                async with client.stream(
                    "POST",
                    f"{self.base_url}/api/v1/models/download",
                    headers=self._headers(),
                    json={"model": model},
                ) as response:
                    if response.status_code == 404:
                        yield ProgressEvent(
                            status="error",
                            message="LM Studio native API not available. Requires LM Studio 0.4+.",
                            error="native_api_unavailable",
                            done=True,
                        )
                        return
                    response.raise_for_status()
                    async for line in response.aiter_lines():
                        if not line.strip():
                            continue
                        try:
                            data = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        status = data.get("status", data.get("state", "downloading"))
                        total = data.get("total") or data.get("total_bytes")
                        completed = data.get("completed") or data.get("downloaded_bytes")
                        percent = data.get("percent")
                        if percent is None and total and completed is not None and total > 0:
                            percent = round((completed / total) * 100, 1)
                        done = status in ("success", "completed", "done")
                        yield ProgressEvent(
                            status=status,
                            completed=completed,
                            total=total,
                            percent=percent,
                            message=data.get("message", status),
                            done=done,
                        )
        except Exception as exc:
            yield ProgressEvent(status="error", message=str(exc), error=str(exc), done=True)

    async def load_model(self, model: str, context_length: int = 8192) -> Dict:
        response = await self._request(
            "POST",
            "/api/v1/models/load",
            json={"model": model, "context_length": context_length},
            timeout=600.0,
        )
        if response.status_code == 404:
            return {"error": "LM Studio native API not available. Requires LM Studio 0.4+."}
        response.raise_for_status()
        return response.json()

    async def unload_model(self, model: str) -> Dict:
        response = await self._request(
            "POST",
            "/api/v1/models/unload",
            json={"model": model},
            timeout=120.0,
        )
        if response.status_code == 404:
            return {"error": "LM Studio native API not available."}
        response.raise_for_status()
        return response.json()

    async def list_running_models(self) -> List[str]:
        models = await self.list_installed_models()
        return [m.id for m in models if m.loaded]
