"""FastAPI backend for AI Council."""

from __future__ import annotations

import asyncio
import json
import uuid
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from . import storage
from .council import (
    _complete_with_limits,
    _member_label,
    calculate_aggregate_rankings,
    generate_conversation_title,
    stage2_collect_rankings,
    stage3_synthesize_final,
)
from .prompts import build_stage1_messages
from .model_manager import (
    delete_model,
    get_popular_models,
    list_installed_models,
    list_running_models,
    load_model,
    pull_model_stream,
    unload_model,
)
from .web_search import (
    WebSearchResult,
    is_web_search_configured,
    search_web,
    serper_key_setup_message,
    web_search_metadata,
)
from .providers.registry import ProviderRegistry
from .settings import (
    add_council_member,
    get_presets,
    load_settings,
    settings_to_dict,
    update_settings,
)

load_dotenv()

app = FastAPI(title="TinyLM Council API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_registry = ProviderRegistry(load_settings())
_registry.refresh(load_settings())
_council_lock = asyncio.Lock()
KEEPALIVE_INTERVAL = 12.0


async def _iter_with_keepalive(awaitable, interval: float = KEEPALIVE_INTERVAL):
    """Yield None for keepalive ticks while waiting on a long council step."""
    task = asyncio.create_task(awaitable)
    while not task.done():
        done, _ = await asyncio.wait({task}, timeout=interval)
        if not done:
            yield None
    yield await task


def _rollback_user_message(conversation_id: str, user_saved: bool, assistant_saved: bool) -> None:
    if user_saved and not assistant_saved:
        storage.remove_last_user_message(conversation_id)


def get_registry() -> ProviderRegistry:
    return _registry


def refresh_registry() -> ProviderRegistry:
    settings = load_settings()
    _registry.refresh(settings)
    return _registry


class SendMessageRequest(BaseModel):
    content: str
    use_web_search: bool = False


class ProviderTestRequest(BaseModel):
    provider: Dict[str, Any]


class SettingsUpdateRequest(BaseModel):
    providers: Optional[List[Dict[str, Any]]] = None
    council_members: Optional[List[Dict[str, Any]]] = None
    chairman_member_id: Optional[str] = None
    council_profile: Optional[str] = None
    setup_complete: Optional[bool] = None
    serper_api_key: Optional[str] = None
    parallel_local_inference: Optional[bool] = None


class PullModelRequest(BaseModel):
    model: str


class LoadModelRequest(BaseModel):
    model: str
    context_length: int = 8192


class AddMemberRequest(BaseModel):
    provider_id: str
    model: str
    display_name: Optional[str] = None


@app.get("/")
async def root():
    return {"status": "ok", "service": "TinyLM Council API"}


@app.get("/api/settings")
async def get_settings():
    settings = load_settings()
    return settings_to_dict(settings)


@app.put("/api/settings")
async def put_settings(request: SettingsUpdateRequest):
    data = request.model_dump(exclude_none=True)
    settings = update_settings(data)
    refresh_registry()
    return settings_to_dict(settings)


@app.get("/api/providers/presets")
async def provider_presets():
    return get_presets()


@app.post("/api/providers/test")
async def test_provider(request: ProviderTestRequest):
    from .providers.registry import config_from_dict, create_provider

    config = config_from_dict(request.provider)
    provider = create_provider(config)
    result = await provider.test_connection()
    return {
        "ok": result.ok,
        "message": result.message,
        "latency_ms": result.latency_ms,
    }


@app.get("/api/providers/{provider_id}/capabilities")
async def provider_capabilities(provider_id: str):
    registry = get_registry()
    caps = registry.get_capabilities(provider_id)
    return {
        "can_list_models": caps.can_list_models,
        "can_pull": caps.can_pull,
        "can_load": caps.can_load,
        "can_unload": caps.can_unload,
        "can_delete": caps.can_delete,
        "can_list_running": caps.can_list_running,
        "native_api_available": caps.native_api_available,
        "notes": caps.notes,
        "popular_models": get_popular_models(provider_id, registry),
    }


@app.get("/api/providers/{provider_id}/models")
async def provider_models(provider_id: str):
    registry = get_registry()
    models = await list_installed_models(registry, provider_id)
    return [
        {"id": m.id, "name": m.name, "size": m.size, "loaded": m.loaded}
        for m in models
    ]


@app.get("/api/providers/{provider_id}/models/running")
async def provider_running_models(provider_id: str):
    registry = get_registry()
    return {"models": await list_running_models(registry, provider_id)}


@app.post("/api/providers/{provider_id}/models/pull")
async def provider_pull_model(provider_id: str, request: PullModelRequest):
    registry = get_registry()

    async def event_generator():
        async for event in pull_model_stream(registry, provider_id, request.model):
            yield event

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


@app.post("/api/providers/{provider_id}/models/load")
async def provider_load_model(provider_id: str, request: LoadModelRequest):
    registry = get_registry()
    result = await load_model(registry, provider_id, request.model, request.context_length)
    if result.get("error"):
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@app.post("/api/providers/{provider_id}/models/unload")
async def provider_unload_model(provider_id: str, request: PullModelRequest):
    registry = get_registry()
    result = await unload_model(registry, provider_id, request.model)
    if result.get("error"):
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@app.delete("/api/providers/{provider_id}/models/{model_name:path}")
async def provider_delete_model(provider_id: str, model_name: str):
    registry = get_registry()
    result = await delete_model(registry, provider_id, model_name)
    if result.get("error"):
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@app.post("/api/council/members")
async def create_council_member(request: AddMemberRequest):
    member = add_council_member(request.provider_id, request.model, request.display_name)
    refresh_registry()
    return {
        "id": member.id,
        "provider_id": member.provider_id,
        "model": member.model,
        "display_name": member.display_name,
        "enabled": member.enabled,
    }


@app.post("/api/web-search/test")
async def test_web_search():
    if not is_web_search_configured():
        return {
            "ok": False,
            "message": serper_key_setup_message(),
        }
    result = await search_web("current date and time UTC", "tiny")
    if result.error:
        return {"ok": False, "message": result.error}
    return {
        "ok": True,
        "message": f"Web search OK ({len(result.sources)} results)",
        "sample_source": result.sources[0] if result.sources else None,
    }


@app.get("/api/conversations")
async def list_conversations():
    return storage.list_conversations()


@app.post("/api/conversations")
async def create_conversation():
    conversation_id = str(uuid.uuid4())
    return storage.create_conversation(conversation_id)


@app.get("/api/conversations/{conversation_id}")
async def get_conversation(conversation_id: str):
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


@app.delete("/api/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str):
    if not storage.delete_conversation(conversation_id):
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"ok": True}


@app.post("/api/conversations/{conversation_id}/message/stream")
async def send_message_stream(conversation_id: str, request: SendMessageRequest):
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    is_first_message = len(conversation["messages"]) == 0
    registry = get_registry()
    settings = load_settings()
    profile = settings.council_profile or "tiny"
    members = settings.get_enabled_members()
    chairman = settings.get_chairman()

    async def event_generator():
        user_saved = False
        assistant_saved = False

        if _council_lock.locked():
            yield f"data: {json.dumps({'type': 'error', 'message': 'Council is busy with another request. Please wait for it to finish.'})}\n\n"
            return

        async with _council_lock:
            title_task = None
            try:
                storage.add_user_message(conversation_id, request.content)
                user_saved = True

                if is_first_message:
                    title_task = asyncio.create_task(
                        generate_conversation_title(registry, request.content, profile)
                    )

                if len(members) < 2:
                    yield f"data: {json.dumps({'type': 'error', 'message': 'At least 2 enabled council members required. Configure in Settings.'})}\n\n"
                    _rollback_user_message(conversation_id, user_saved, assistant_saved)
                    return

                web_context = ""
                web_search_info: Optional[Dict[str, Any]] = None

                if request.use_web_search:
                    yield f"data: {json.dumps({'type': 'web_search_start'})}\n\n"
                    if not is_web_search_configured():
                        skip_message = serper_key_setup_message()
                        skipped = WebSearchResult(query=request.content, error=skip_message)
                        web_search_info = web_search_metadata(skipped, enabled=True)
                        yield f"data: {json.dumps({'type': 'web_search_skipped', 'message': skip_message, 'data': web_search_info})}\n\n"
                    else:
                        if title_task:
                            search_result, title = await asyncio.gather(
                                search_web(request.content, profile),
                                title_task,
                            )
                            title_task = None
                            storage.update_conversation_title(conversation_id, title)
                            yield f"data: {json.dumps({'type': 'title_complete', 'data': {'title': title}})}\n\n"
                        else:
                            search_result = await search_web(request.content, profile)
                        web_search_info = web_search_metadata(search_result, enabled=True)
                        if search_result.error or not search_result.context_text:
                            yield f"data: {json.dumps({'type': 'web_search_skipped', 'message': search_result.error or 'No results', 'data': web_search_info})}\n\n"
                        else:
                            web_context = search_result.context_text
                            yield f"data: {json.dumps({'type': 'web_search_complete', 'data': web_search_info})}\n\n"

                yield f"data: {json.dumps({'type': 'stage1_start', 'members': [{'id': m.id, 'display_name': m.display_name, 'model': m.model} for m in members]})}\n\n"

                stage1_messages = build_stage1_messages(
                    request.content, profile, web_context=web_context
                )
                all_stage1: List[dict] = []

                async def query_and_track(member):
                    response = await _complete_with_limits(
                        registry, member, stage1_messages, "stage1", profile
                    )
                    result = {
                        "member_id": member.id,
                        "model": member.model,
                        "display_name": _member_label(member),
                        "provider_id": member.provider_id,
                        "response": response.content if not response.error else "",
                        "error": response.error,
                        "success": response.error is None,
                    }
                    all_stage1.append(result)
                    return result

                tasks = [query_and_track(m) for m in members]
                for coro in asyncio.as_completed(tasks):
                    result = await coro
                    yield f"data: {json.dumps({'type': 'member_complete', 'data': result})}\n\n"

                stage1_results = [r for r in all_stage1 if r.get("success")]
                yield f"data: {json.dumps({'type': 'stage1_complete', 'data': stage1_results, 'all_results': all_stage1})}\n\n"

                if not stage1_results:
                    yield f"data: {json.dumps({'type': 'error', 'message': 'All council members failed to respond.'})}\n\n"
                    _rollback_user_message(conversation_id, user_saved, assistant_saved)
                    return

                yield f"data: {json.dumps({'type': 'stage2_start'})}\n\n"
                async for item in _iter_with_keepalive(
                    stage2_collect_rankings(
                        registry,
                        members,
                        request.content,
                        stage1_results,
                        profile,
                        web_context=web_context,
                    )
                ):
                    if item is None:
                        yield ": keepalive\n\n"
                    else:
                        stage2_results, label_to_model, ranking_parse_failed = item
                aggregate_rankings = calculate_aggregate_rankings(stage2_results, label_to_model)
                yield f"data: {json.dumps({'type': 'stage2_complete', 'data': stage2_results, 'metadata': {'label_to_model': label_to_model, 'aggregate_rankings': aggregate_rankings, 'ranking_parse_failed': ranking_parse_failed}})}\n\n"

                yield f"data: {json.dumps({'type': 'stage3_start'})}\n\n"
                if not chairman:
                    yield f"data: {json.dumps({'type': 'error', 'message': 'No chairman configured.'})}\n\n"
                    _rollback_user_message(conversation_id, user_saved, assistant_saved)
                    return

                async for item in _iter_with_keepalive(
                    stage3_synthesize_final(
                        registry,
                        chairman,
                        request.content,
                        stage1_results,
                        stage2_results,
                        aggregate_rankings,
                        profile,
                        web_context=web_context,
                    )
                ):
                    if item is None:
                        yield ": keepalive\n\n"
                    else:
                        stage3_result = item
                yield f"data: {json.dumps({'type': 'stage3_complete', 'data': stage3_result})}\n\n"

                metadata = {
                    "label_to_model": label_to_model,
                    "aggregate_rankings": aggregate_rankings,
                    "ranking_parse_failed": ranking_parse_failed,
                    "council_profile": profile,
                    "failed_members": [
                        r.get("display_name")
                        for r in all_stage1
                        if not r.get("success")
                    ],
                }
                if web_search_info is not None:
                    metadata["web_search"] = web_search_info

                if title_task:
                    title = await title_task
                    storage.update_conversation_title(conversation_id, title)
                    yield f"data: {json.dumps({'type': 'title_complete', 'data': {'title': title}})}\n\n"

                storage.add_assistant_message(
                    conversation_id, stage1_results, stage2_results, stage3_result, metadata
                )
                assistant_saved = True
                yield f"data: {json.dumps({'type': 'complete'})}\n\n"

            except asyncio.CancelledError:
                if title_task and not title_task.done():
                    title_task.cancel()
                _rollback_user_message(conversation_id, user_saved, assistant_saved)
                raise
            except Exception as exc:
                _rollback_user_message(conversation_id, user_saved, assistant_saved)
                yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8001)
