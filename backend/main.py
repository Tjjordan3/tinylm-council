"""FastAPI backend for AI Council."""

from __future__ import annotations

import asyncio
import json
import uuid
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional, Set

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from . import storage
from .council import (
    _member_label,
    _stream_with_limits,
    calculate_aggregate_rankings,
    generate_conversation_title,
    should_auto_skip_web_search,
    stage2_collect_rankings,
    stage2_run_debate_rounds,
    stage3_synthesize_final_stream,
)
from .http_client import close_http_clients
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
from .paths import load_env_files
from .token_budget import cache_get_stage1, cache_set_stage1, stage1_cache_key
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

load_env_files()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    yield
    await close_http_clients()


app = FastAPI(title="TinyLM Council API", lifespan=lifespan)

_CORS_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:3000",
    "http://tauri.localhost",
    "https://tauri.localhost",
    "tauri://localhost",
    "http://localhost:1420",
    "http://127.0.0.1:1420",
]

APP_VERSION = "0.8.0"
APP_FEATURES = ["debate", "streaming", "quick_mode"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
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
    try:
        while not task.done():
            done, _ = await asyncio.wait({task}, timeout=interval)
            if not done:
                yield None
        yield await task
    except (asyncio.CancelledError, GeneratorExit):
        if not task.done():
            task.cancel()
            try:
                await task
            except Exception:
                pass
        raise


def _cancel_tasks(tasks: Set[asyncio.Task]) -> None:
    for task in list(tasks):
        if task and not task.done():
            task.cancel()


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
    deliberation_mode: Optional[str] = None
    debate_rounds: Optional[int] = None
    run_mode: Optional[str] = None
    max_members: Optional[int] = None


class ProviderTestRequest(BaseModel):
    provider: Dict[str, Any]


class SettingsUpdateRequest(BaseModel):
    providers: Optional[List[Dict[str, Any]]] = None
    council_members: Optional[List[Dict[str, Any]]] = None
    chairman_member_id: Optional[str] = None
    council_profile: Optional[str] = None
    deliberation_mode: Optional[str] = None
    debate_rounds: Optional[int] = None
    setup_complete: Optional[bool] = None
    serper_api_key: Optional[str] = None
    nvidia_api_key: Optional[str] = None
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
    return {
        "status": "ok",
        "service": "TinyLM Council API",
        "version": APP_VERSION,
        "features": APP_FEATURES,
    }


@app.get("/api/settings")
async def get_settings():
    settings = load_settings()
    payload = settings_to_dict(settings)
    payload["app_version"] = APP_VERSION
    payload["features"] = APP_FEATURES
    return payload


@app.put("/api/settings")
async def put_settings(request: SettingsUpdateRequest):
    data = request.model_dump(exclude_none=True)
    # Always apply deliberation fields when present (including explicit "rank").
    settings = update_settings(data)
    refresh_registry()
    payload = settings_to_dict(settings)
    payload["app_version"] = APP_VERSION
    payload["features"] = APP_FEATURES
    return payload


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


@app.post("/api/nvidia/test")
async def test_nvidia():
    from .settings import get_nvidia_api_key, nvidia_key_setup_message

    api_key = get_nvidia_api_key()
    if not api_key:
        return {"ok": False, "message": nvidia_key_setup_message()}

    import httpx

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                "https://integrate.api.nvidia.com/v1/models",
                headers={"Authorization": f"Bearer {api_key}"},
            )
            response.raise_for_status()
            data = response.json()
            count = len(data.get("data", []))
            return {
                "ok": True,
                "message": f"NVIDIA NIM OK ({count} models available)",
                "model_count": count,
            }
    except Exception as exc:
        return {"ok": False, "message": f"NVIDIA NIM test failed: {exc}"}


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


@app.post("/api/conversations/{conversation_id}/regenerate-chairman/stream")
async def regenerate_chairman_stream(conversation_id: str):
    """Re-run Stage 3 only, reusing stored Stage 1 / deliberation (and Stage 1 cache on retries)."""
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    messages = conversation.get("messages") or []
    assistant_index = None
    for index in range(len(messages) - 1, -1, -1):
        if messages[index].get("role") == "assistant":
            assistant_index = index
            break
    if assistant_index is None or assistant_index == 0:
        raise HTTPException(status_code=400, detail="No completed council answer to regenerate")

    assistant_msg = messages[assistant_index]
    user_msg = messages[assistant_index - 1]
    if user_msg.get("role") != "user":
        raise HTTPException(status_code=400, detail="Assistant message has no preceding user question")

    stage1_results = assistant_msg.get("stage1") or []
    if not stage1_results:
        raise HTTPException(status_code=400, detail="No Stage 1 answers available to regenerate from")

    registry = get_registry()
    settings = load_settings()
    profile = settings.council_profile or "tiny"
    metadata = assistant_msg.get("metadata") or {}
    mode = (metadata.get("deliberation_mode") or "rank").strip().lower()
    run_mode = (metadata.get("run_mode") or "full").strip().lower()
    if run_mode == "quick":
        mode = "quick"
    if mode not in ("rank", "debate", "quick"):
        mode = "rank"
    stage2_results = assistant_msg.get("stage2") or []
    debate_rounds_data = assistant_msg.get("debate_rounds") or []
    aggregate_rankings = metadata.get("aggregate_rankings") or []
    web_context = ""
    web_meta = metadata.get("web_search") or {}
    # Prefer reconstructed brief from stored sources when available
    if web_meta.get("context_text"):
        web_context = web_meta["context_text"]
    chairman = settings.get_chairman()
    user_query = user_msg.get("content") or ""

    async def event_generator():
        if _council_lock.locked():
            yield f"data: {json.dumps({'type': 'error', 'message': 'Council is busy with another request. Please wait for it to finish.'})}\n\n"
            return

        async with _council_lock:
            try:
                if not chairman:
                    yield f"data: {json.dumps({'type': 'error', 'message': 'No chairman configured.'})}\n\n"
                    return

                # Seed Stage 1 cache so a full re-run of the same question can reuse answers
                for result in stage1_results:
                    if not result.get("success") and result.get("error"):
                        continue
                    mid = result.get("member_id")
                    model = result.get("model")
                    if not mid or not model:
                        continue
                    cache_set_stage1(
                        stage1_cache_key(mid, model, profile, user_query, web_context),
                        {
                            "member_id": mid,
                            "model": model,
                            "display_name": result.get("display_name") or model,
                            "provider_id": result.get("provider_id"),
                            "response": result.get("response") or "",
                            "error": None,
                            "success": True,
                        },
                    )

                yield f"data: {json.dumps({'type': 'stage3_start', 'regenerate': True})}\n\n"
                pending: List[dict] = []

                def on_delta(delta: str) -> None:
                    pending.append({"type": "stage3_delta", "delta": delta})

                stage3_result = None
                async for item in _iter_with_keepalive(
                    stage3_synthesize_final_stream(
                        registry,
                        chairman,
                        user_query,
                        stage1_results,
                        stage2_results,
                        aggregate_rankings,
                        profile,
                        web_context=web_context,
                        deliberation_mode=mode,
                        debate_rounds=debate_rounds_data,
                        on_delta=on_delta,
                    )
                ):
                    while pending:
                        event = pending.pop(0)
                        yield f"data: {json.dumps(event)}\n\n"
                    if item is None:
                        yield ": keepalive\n\n"
                    else:
                        stage3_result = item
                while pending:
                    event = pending.pop(0)
                    yield f"data: {json.dumps(event)}\n\n"

                storage.update_last_assistant_stage3(
                    conversation_id,
                    stage3_result,
                    metadata_patch={"regenerated_chairman": True},
                )
                yield f"data: {json.dumps({'type': 'stage3_complete', 'data': stage3_result, 'regenerate': True})}\n\n"
                yield f"data: {json.dumps({'type': 'complete', 'regenerate': True})}\n\n"
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


@app.post("/api/conversations/{conversation_id}/message/stream")
async def send_message_stream(conversation_id: str, request: SendMessageRequest):
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    is_first_message = len(conversation["messages"]) == 0
    registry = get_registry()
    settings = load_settings()
    profile = settings.council_profile or "tiny"
    run_mode = (request.run_mode or settings.default_run_mode or "full").strip().lower()
    if run_mode not in ("full", "quick"):
        run_mode = "full"
    mode = (request.deliberation_mode or settings.deliberation_mode or "rank").strip().lower()
    if mode not in ("rank", "debate"):
        mode = "rank"
    if run_mode == "quick":
        mode = "quick"
    if request.debate_rounds is not None:
        try:
            rounds = max(1, min(3, int(request.debate_rounds)))
        except (TypeError, ValueError):
            rounds = settings.debate_rounds or 1
    else:
        rounds = max(1, min(3, int(settings.debate_rounds or 1)))

    members = settings.get_enabled_members()
    max_members = request.max_members
    if max_members is None:
        max_members = settings.default_max_members
    if max_members is not None:
        try:
            max_members = int(max_members)
            if max_members >= 2:
                members = members[:max_members]
        except (TypeError, ValueError):
            pass
    chairman = settings.get_chairman()
    if chairman and chairman.id not in {m.id for m in members}:
        # Keep chairman in the working set when max_members truncates them out
        enabled = settings.get_enabled_members()
        for m in enabled:
            if m.id == chairman.id:
                members = members + [m]
                break

    async def event_generator():
        user_saved = False
        assistant_saved = False
        inflight: Set[asyncio.Task] = set()

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
                    inflight.add(title_task)

                if len(members) < 2:
                    yield f"data: {json.dumps({'type': 'error', 'message': 'At least 2 enabled council members required. Configure in Settings.'})}\n\n"
                    _rollback_user_message(conversation_id, user_saved, assistant_saved)
                    return

                web_context = ""
                web_search_info: Optional[Dict[str, Any]] = None
                want_search = request.use_web_search
                if want_search and settings.web_search_auto and should_auto_skip_web_search(
                    request.content
                ):
                    skip_message = "Skipped web search (query does not look like it needs fresh facts)."
                    skipped = WebSearchResult(query=request.content, error=skip_message)
                    web_search_info = web_search_metadata(skipped, enabled=True)
                    yield f"data: {json.dumps({'type': 'web_search_skipped', 'message': skip_message, 'data': web_search_info})}\n\n"
                    want_search = False

                if want_search:
                    yield f"data: {json.dumps({'type': 'web_search_start'})}\n\n"
                    if not is_web_search_configured():
                        skip_message = serper_key_setup_message()
                        skipped = WebSearchResult(query=request.content, error=skip_message)
                        web_search_info = web_search_metadata(skipped, enabled=True)
                        yield f"data: {json.dumps({'type': 'web_search_skipped', 'message': skip_message, 'data': web_search_info})}\n\n"
                    else:
                        if title_task:
                            search_task = asyncio.create_task(
                                search_web(request.content, profile)
                            )
                            inflight.add(search_task)
                            search_result, title = await asyncio.gather(
                                search_task, title_task
                            )
                            inflight.discard(search_task)
                            inflight.discard(title_task)
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

                yield f"data: {json.dumps({'type': 'stage1_start', 'members': [{'id': m.id, 'display_name': m.display_name, 'model': m.model} for m in members], 'deliberation_mode': mode, 'run_mode': run_mode})}\n\n"

                stage1_messages = build_stage1_messages(
                    request.content, profile, web_context=web_context
                )
                event_queue: asyncio.Queue = asyncio.Queue()

                async def query_and_track(member):
                    try:
                        cache_key = stage1_cache_key(
                            member.id,
                            member.model,
                            profile,
                            request.content,
                            web_context,
                        )
                        cached = cache_get_stage1(cache_key)
                        if cached:
                            await event_queue.put(
                                {"type": "member_complete", "data": cached, "cached": True}
                            )
                            return cached

                        def on_delta(delta: str, mid: str = member.id) -> None:
                            event_queue.put_nowait(
                                {"type": "member_delta", "member_id": mid, "delta": delta}
                            )

                        response = await _stream_with_limits(
                            registry,
                            member,
                            stage1_messages,
                            "stage1",
                            profile,
                            on_delta=on_delta,
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
                        if result["success"]:
                            cache_set_stage1(cache_key, result)
                        await event_queue.put({"type": "member_complete", "data": result})
                        return result
                    except asyncio.CancelledError:
                        raise
                    except Exception as exc:
                        result = {
                            "member_id": member.id,
                            "model": member.model,
                            "display_name": _member_label(member),
                            "provider_id": member.provider_id,
                            "response": "",
                            "error": str(exc),
                            "success": False,
                        }
                        await event_queue.put({"type": "member_complete", "data": result})
                        return result

                member_tasks = [
                    asyncio.create_task(query_and_track(m)) for m in members
                ]
                for t in member_tasks:
                    inflight.add(t)

                remaining = len(member_tasks)
                while remaining > 0:
                    try:
                        event = await asyncio.wait_for(
                            event_queue.get(), timeout=KEEPALIVE_INTERVAL
                        )
                    except asyncio.TimeoutError:
                        yield ": keepalive\n\n"
                        continue
                    yield f"data: {json.dumps(event)}\n\n"
                    if event.get("type") == "member_complete":
                        remaining -= 1

                all_stage1 = []
                for t in member_tasks:
                    inflight.discard(t)
                    try:
                        all_stage1.append(await t)
                    except Exception as exc:
                        all_stage1.append(
                            {
                                "member_id": "",
                                "model": "",
                                "display_name": "Unknown",
                                "response": "",
                                "error": str(exc),
                                "success": False,
                            }
                        )

                stage1_results = [r for r in all_stage1 if r.get("success")]
                yield f"data: {json.dumps({'type': 'stage1_complete', 'data': stage1_results, 'all_results': all_stage1})}\n\n"

                if not stage1_results:
                    yield f"data: {json.dumps({'type': 'error', 'message': 'All council members failed to respond.'})}\n\n"
                    _rollback_user_message(conversation_id, user_saved, assistant_saved)
                    return

                stage2_results: List[dict] = []
                debate_rounds_data: List[dict] = []
                label_to_model: Dict[str, str] = {}
                ranking_parse_failed = False
                aggregate_rankings: List[dict] = []

                if run_mode == "quick":
                    yield f"data: {json.dumps({'type': 'stage2_skipped', 'reason': 'quick_mode'})}\n\n"
                elif mode == "debate":
                    yield f"data: {json.dumps({'type': 'debate_start', 'rounds': rounds})}\n\n"
                    pending_events: List[dict] = []

                    def on_debate_member(round_number: int, result: dict) -> None:
                        pending_events.append(
                            {
                                "type": "debate_member_complete",
                                "round": round_number,
                                "data": result,
                            }
                        )

                    def on_debate_delta(round_number: int, member_id: str, delta: str) -> None:
                        pending_events.append(
                            {
                                "type": "debate_member_delta",
                                "round": round_number,
                                "member_id": member_id,
                                "delta": delta,
                            }
                        )

                    async for item in _iter_with_keepalive(
                        stage2_run_debate_rounds(
                            registry,
                            members,
                            request.content,
                            stage1_results,
                            profile,
                            debate_rounds=rounds,
                            web_context=web_context,
                            on_member_complete=on_debate_member,
                            on_delta=on_debate_delta,
                        )
                    ):
                        while pending_events:
                            event = pending_events.pop(0)
                            yield f"data: {json.dumps(event)}\n\n"
                        if item is None:
                            yield ": keepalive\n\n"
                        else:
                            debate_rounds_data, label_to_model = item
                    while pending_events:
                        event = pending_events.pop(0)
                        yield f"data: {json.dumps(event)}\n\n"
                    yield f"data: {json.dumps({'type': 'debate_complete', 'data': debate_rounds_data, 'metadata': {'label_to_model': label_to_model, 'deliberation_mode': 'debate', 'debate_rounds_count': len(debate_rounds_data)}})}\n\n"
                else:
                    yield f"data: {json.dumps({'type': 'stage2_start'})}\n\n"
                    pending_rank_events: List[dict] = []

                    def on_rank_member(result: dict) -> None:
                        pending_rank_events.append(
                            {"type": "stage2_member_complete", "data": result}
                        )

                    def on_rank_delta(member_id: str, delta: str) -> None:
                        pending_rank_events.append(
                            {
                                "type": "stage2_member_delta",
                                "member_id": member_id,
                                "delta": delta,
                            }
                        )

                    async for item in _iter_with_keepalive(
                        stage2_collect_rankings(
                            registry,
                            members,
                            request.content,
                            stage1_results,
                            profile,
                            web_context=web_context,
                            on_member_complete=on_rank_member,
                            on_delta=on_rank_delta,
                        )
                    ):
                        while pending_rank_events:
                            event = pending_rank_events.pop(0)
                            yield f"data: {json.dumps(event)}\n\n"
                        if item is None:
                            yield ": keepalive\n\n"
                        else:
                            stage2_results, label_to_model, ranking_parse_failed = item
                    while pending_rank_events:
                        event = pending_rank_events.pop(0)
                        yield f"data: {json.dumps(event)}\n\n"
                    aggregate_rankings = calculate_aggregate_rankings(
                        stage2_results, label_to_model
                    )
                    yield f"data: {json.dumps({'type': 'stage2_complete', 'data': stage2_results, 'metadata': {'label_to_model': label_to_model, 'aggregate_rankings': aggregate_rankings, 'ranking_parse_failed': ranking_parse_failed}})}\n\n"

                yield f"data: {json.dumps({'type': 'stage3_start'})}\n\n"
                if not chairman:
                    yield f"data: {json.dumps({'type': 'error', 'message': 'No chairman configured.'})}\n\n"
                    _rollback_user_message(conversation_id, user_saved, assistant_saved)
                    return

                stage3_pending: List[dict] = []

                def on_stage3_delta(delta: str) -> None:
                    stage3_pending.append({"type": "stage3_delta", "delta": delta})

                stage3_result = None
                async for item in _iter_with_keepalive(
                    stage3_synthesize_final_stream(
                        registry,
                        chairman,
                        request.content,
                        stage1_results,
                        stage2_results,
                        aggregate_rankings,
                        profile,
                        web_context=web_context,
                        deliberation_mode=mode,
                        debate_rounds=debate_rounds_data,
                        on_delta=on_stage3_delta,
                    )
                ):
                    while stage3_pending:
                        event = stage3_pending.pop(0)
                        yield f"data: {json.dumps(event)}\n\n"
                    if item is None:
                        yield ": keepalive\n\n"
                    else:
                        stage3_result = item
                while stage3_pending:
                    event = stage3_pending.pop(0)
                    yield f"data: {json.dumps(event)}\n\n"
                yield f"data: {json.dumps({'type': 'stage3_complete', 'data': stage3_result})}\n\n"

                metadata = {
                    "label_to_model": label_to_model,
                    "aggregate_rankings": aggregate_rankings,
                    "ranking_parse_failed": ranking_parse_failed,
                    "council_profile": profile,
                    "deliberation_mode": "rank" if mode == "quick" else mode,
                    "run_mode": run_mode,
                    "debate_rounds_count": len(debate_rounds_data),
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
                    inflight.discard(title_task)
                    storage.update_conversation_title(conversation_id, title)
                    yield f"data: {json.dumps({'type': 'title_complete', 'data': {'title': title}})}\n\n"

                storage.add_assistant_message(
                    conversation_id,
                    stage1_results,
                    stage2_results,
                    stage3_result,
                    metadata,
                    debate_rounds=debate_rounds_data or None,
                )
                assistant_saved = True
                yield f"data: {json.dumps({'type': 'complete'})}\n\n"

            except asyncio.CancelledError:
                _cancel_tasks(inflight)
                if title_task and not title_task.done():
                    title_task.cancel()
                _rollback_user_message(conversation_id, user_saved, assistant_saved)
                raise
            except Exception as exc:
                _cancel_tasks(inflight)
                _rollback_user_message(conversation_id, user_saved, assistant_saved)
                yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


if __name__ == "__main__":
    import os

    import uvicorn

    from .paths import is_desktop_mode

    host = os.environ.get("TINYLM_HOST")
    if not host:
        host = "127.0.0.1" if is_desktop_mode() else "0.0.0.0"
    port = int(os.environ.get("TINYLM_PORT", "8001"))
    uvicorn.run(app, host=host, port=port)
