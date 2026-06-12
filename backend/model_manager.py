"""Model management orchestration."""

from __future__ import annotations

import json
from typing import AsyncIterator, Dict, List, Optional

from .providers.base import ModelInfo, ProgressEvent
from .providers.registry import ProviderRegistry


POPULAR_MODELS = {
    "nvidia": [
        "meta/llama-3.1-8b-instruct",
        "google/gemma-2-9b-it",
        "microsoft/phi-3-mini-128k-instruct",
        "meta/llama-3.1-70b-instruct",
        "nvidia/llama-3.1-nemotron-70b-instruct",
    ],
    "ollama": [
        "qwen2.5:0.5b",
        "qwen2.5:1.5b",
        "phi3:mini",
        "gemma2:2b",
        "smollm:360m",
        "llama3.2:1b",
    ],
    "lmstudio": [
        "Qwen/Qwen2.5-0.5B-Instruct-GGUF",
        "Qwen/Qwen2.5-1.5B-Instruct-GGUF",
        "microsoft/Phi-3-mini-4k-instruct-gguf",
        "google/gemma-2-2b-it-GGUF",
    ],
}


def progress_to_dict(event: ProgressEvent) -> dict:
    return {
        "status": event.status,
        "completed": event.completed,
        "total": event.total,
        "percent": event.percent,
        "message": event.message,
        "done": event.done,
        "error": event.error,
    }


async def list_installed_models(registry: ProviderRegistry, provider_id: str) -> List[ModelInfo]:
    native = registry.get_native_client(provider_id)
    if native and hasattr(native, "list_installed_models"):
        models = await native.list_installed_models()
        if models:
            return models

    provider = registry.get_provider(provider_id)
    if provider:
        return await provider.list_models()
    return []


async def list_running_models(registry: ProviderRegistry, provider_id: str) -> List[str]:
    native = registry.get_native_client(provider_id)
    if native and hasattr(native, "list_running_models"):
        return await native.list_running_models()
    return []


async def pull_model_stream(
    registry: ProviderRegistry, provider_id: str, model: str
) -> AsyncIterator[str]:
    native = registry.get_native_client(provider_id)
    config = registry.settings.get_provider(provider_id)
    preset = (config.preset or "").lower() if config else ""

    if not native:
        yield f"data: {json.dumps({'type': 'error', 'message': 'Model pull not supported for this provider'})}\n\n"
        return

    if preset == "ollama" and hasattr(native, "pull_model"):
        async for event in native.pull_model(model):
            payload = {"type": "progress", **progress_to_dict(event)}
            yield f"data: {json.dumps(payload)}\n\n"
            if event.done:
                if event.error:
                    yield f"data: {json.dumps({'type': 'error', 'message': event.error})}\n\n"
                else:
                    yield f"data: {json.dumps({'type': 'complete', 'model': model})}\n\n"
                return
    elif preset == "lmstudio" and hasattr(native, "download_model"):
        async for event in native.download_model(model):
            payload = {"type": "progress", **progress_to_dict(event)}
            yield f"data: {json.dumps(payload)}\n\n"
            if event.done:
                if event.error:
                    yield f"data: {json.dumps({'type': 'error', 'message': event.error})}\n\n"
                else:
                    yield f"data: {json.dumps({'type': 'complete', 'model': model})}\n\n"
                return
    else:
        yield f"data: {json.dumps({'type': 'error', 'message': 'Pull/download not supported'})}\n\n"


async def load_model(
    registry: ProviderRegistry, provider_id: str, model: str, context_length: int = 8192
) -> Dict:
    native = registry.get_native_client(provider_id)
    config = registry.settings.get_provider(provider_id)
    preset = (config.preset or "").lower() if config else ""

    if preset == "ollama":
        return {
            "status": "ready",
            "model": model,
            "message": "Ollama loads models automatically on first use.",
        }

    if native and preset == "lmstudio" and hasattr(native, "load_model"):
        result = await native.load_model(model, context_length=context_length)
        if result.get("error"):
            return {"error": result["error"]}
        return result

    return {"error": "Load not supported for this provider"}


async def unload_model(registry: ProviderRegistry, provider_id: str, model: str) -> Dict:
    native = registry.get_native_client(provider_id)
    config = registry.settings.get_provider(provider_id)
    preset = (config.preset or "").lower() if config else ""

    if native and preset == "lmstudio" and hasattr(native, "unload_model"):
        return await native.unload_model(model)

    return {"error": "Unload not supported for this provider"}


async def delete_model(registry: ProviderRegistry, provider_id: str, model: str) -> Dict:
    native = registry.get_native_client(provider_id)
    config = registry.settings.get_provider(provider_id)
    preset = (config.preset or "").lower() if config else ""

    if native and preset == "ollama" and hasattr(native, "delete_model"):
        return await native.delete_model(model)

    return {"error": "Delete not supported for this provider"}


def get_popular_models(provider_id: str, registry: ProviderRegistry) -> List[str]:
    config = registry.settings.get_provider(provider_id)
    if not config:
        return []
    preset = (config.preset or "").lower()
    return POPULAR_MODELS.get(preset, [])
