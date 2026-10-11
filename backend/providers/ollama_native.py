"""Ollama native API for model management."""

from __future__ import annotations

import json
from typing import AsyncIterator, Dict, List

from ..http_client import get_http_client, get_streaming_client
from .base import ModelInfo, ProgressEvent, ProviderConfig


class OllamaNativeClient:
    def __init__(self, config: ProviderConfig):
        native = config.native_base_url or config.base_url.replace("/v1", "")
        self.base_url = native.rstrip("/")

    async def list_installed_models(self) -> List[ModelInfo]:
        try:
            client = get_http_client()
            response = await client.get(f"{self.base_url}/api/tags", timeout=30.0)
            response.raise_for_status()
            data = response.json()
            models = []
            for item in data.get("models", []):
                name = item.get("name", "")
                if name:
                    models.append(
                        ModelInfo(
                            id=name,
                            name=name,
                            size=item.get("size"),
                        )
                    )
            return sorted(models, key=lambda m: m.name)
        except Exception:
            return []

    async def list_running_models(self) -> List[str]:
        try:
            client = get_http_client()
            response = await client.get(f"{self.base_url}/api/ps", timeout=15.0)
            response.raise_for_status()
            data = response.json()
            return [m.get("name", "") for m in data.get("models", []) if m.get("name")]
        except Exception:
            return []

    async def pull_model(self, model: str) -> AsyncIterator[ProgressEvent]:
        try:
            client = get_streaming_client()
            async with client.stream(
                "POST",
                f"{self.base_url}/api/pull",
                json={"model": model, "stream": True},
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.strip():
                        continue
                    data = json.loads(line)
                    status = data.get("status", "")
                    total = data.get("total")
                    completed = data.get("completed")
                    percent = None
                    if total and completed is not None and total > 0:
                        percent = round((completed / total) * 100, 1)
                    done = status == "success"
                    yield ProgressEvent(
                        status=status,
                        completed=completed,
                        total=total,
                        percent=percent,
                        message=status,
                        done=done,
                    )
        except Exception as exc:
            yield ProgressEvent(status="error", message=str(exc), error=str(exc), done=True)

    async def delete_model(self, model: str) -> Dict[str, str]:
        client = get_http_client()
        response = await client.delete(
            f"{self.base_url}/api/delete",
            json={"model": model},
            timeout=60.0,
        )
        response.raise_for_status()
        return {"status": "deleted", "model": model}
