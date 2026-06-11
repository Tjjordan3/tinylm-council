"""3-stage LLM Council orchestration."""

from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import Any, Callable, Dict, List, Optional, Tuple

from .context_utils import (
    summarize_stage2_for_stage3,
    trim_stage1_for_stage2,
    truncate_text,
)
from .prompts import (
    build_stage1_messages,
    build_stage2_prompt,
    build_stage3_prompt,
    build_title_prompt,
    get_stage_limits,
)
from .providers.base import CouncilMember, ProviderConfig
from .providers.registry import ProviderRegistry
from .ranking_parser import parse_ranking_with_fallback
from .settings import load_settings

LOCAL_PRESETS = {"ollama", "lmstudio", "localai", "vllm"}
_provider_semaphores: Dict[str, asyncio.Semaphore] = {}


def _member_label(member: CouncilMember) -> str:
    return member.display_name or member.model


def _is_local_provider(config: Optional[ProviderConfig]) -> bool:
    if not config:
        return False
    return (config.preset or "").lower() in LOCAL_PRESETS


def _should_serialize_local(profile: str, config: Optional[ProviderConfig]) -> bool:
    settings = load_settings()
    if settings.parallel_local_inference:
        return False
    if profile == "tiny":
        return _is_local_provider(config)
    return False


def _get_provider_semaphore(provider_id: str) -> asyncio.Semaphore:
    if provider_id not in _provider_semaphores:
        _provider_semaphores[provider_id] = asyncio.Semaphore(1)
    return _provider_semaphores[provider_id]


def calculate_aggregate_rankings(
    stage2_results: List[Dict[str, Any]],
    label_to_model: Dict[str, str],
) -> List[Dict[str, Any]]:
    model_positions: Dict[str, List[int]] = defaultdict(list)
    for ranking in stage2_results:
        parsed_ranking = ranking.get("parsed_ranking") or []
        for position, label in enumerate(parsed_ranking, start=1):
            if label in label_to_model:
                model_positions[label_to_model[label]].append(position)

    aggregate = []
    for model, positions in model_positions.items():
        if positions:
            aggregate.append(
                {
                    "model": model,
                    "average_rank": round(sum(positions) / len(positions), 2),
                    "rankings_count": len(positions),
                }
            )
    aggregate.sort(key=lambda x: x["average_rank"])
    return aggregate


async def _complete_with_limits(
    registry: ProviderRegistry,
    member: CouncilMember,
    messages: List[dict],
    stage: str,
    profile: str,
    timeout: float = 120.0,
):
    limits = get_stage_limits(profile, stage)
    provider_config = registry.settings.get_provider(member.provider_id)

    async def run():
        return await registry.complete_member(
            member,
            messages,
            timeout=timeout,
            max_tokens=limits.get("max_tokens"),
            temperature=limits.get("temperature"),
        )

    if _should_serialize_local(profile, provider_config):
        semaphore = _get_provider_semaphore(member.provider_id)
        async with semaphore:
            return await run()
    return await run()


async def stage1_collect_responses(
    registry: ProviderRegistry,
    members: List[CouncilMember],
    user_query: str,
    profile: str,
    on_member_complete: Optional[Callable[[Dict[str, Any]], None]] = None,
    web_context: str = "",
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    messages = build_stage1_messages(user_query, profile, web_context=web_context)
    all_results: List[Dict[str, Any]] = []

    async def query_member(member: CouncilMember) -> Dict[str, Any]:
        response = await _complete_with_limits(
            registry, member, messages, "stage1", profile
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
        if on_member_complete:
            on_member_complete(result)
        return result

    completed = await asyncio.gather(*[query_member(member) for member in members])
    all_results.extend(completed)
    successful = [result for result in all_results if result.get("success")]
    return successful, all_results


async def stage2_collect_rankings(
    registry: ProviderRegistry,
    members: List[CouncilMember],
    user_query: str,
    stage1_results: List[Dict[str, Any]],
    profile: str,
    web_context: str = "",
) -> Tuple[List[Dict[str, Any]], Dict[str, str], bool]:
    stage1_input = stage1_results
    if profile == "tiny":
        stage1_input = trim_stage1_for_stage2(stage1_results, max_chars_per_response=600)

    labels = [chr(65 + i) for i in range(len(stage1_input))]
    available_labels = [f"Response {label}" for label in labels]
    label_to_model = {
        f"Response {label}": result.get("display_name") or result["model"]
        for label, result in zip(labels, stage1_input)
    }

    ranking_prompt = build_stage2_prompt(
        user_query, stage1_input, labels, profile, web_context=web_context
    )
    messages = [{"role": "user", "content": ranking_prompt}]
    any_parse_failed = False
    stage2_results = []

    successful_member_ids = {result.get("member_id") for result in stage1_results}
    ranking_members = [m for m in members if m.id in successful_member_ids]
    if not ranking_members:
        ranking_members = members

    async def rank_member(member: CouncilMember) -> Optional[Dict[str, Any]]:
        nonlocal any_parse_failed
        response = await _complete_with_limits(
            registry, member, messages, "stage2", profile
        )
        if response.error:
            return {
                "member_id": member.id,
                "model": member.model,
                "display_name": _member_label(member),
                "provider_id": member.provider_id,
                "ranking": "",
                "parsed_ranking": [],
                "parse_failed": True,
                "error": response.error,
            }
        full_text = response.content
        parsed, parse_failed = parse_ranking_with_fallback(full_text, available_labels)
        if parse_failed:
            any_parse_failed = True
        return {
            "member_id": member.id,
            "model": member.model,
            "display_name": _member_label(member),
            "provider_id": member.provider_id,
            "ranking": full_text,
            "parsed_ranking": parsed,
            "parse_failed": parse_failed,
            "error": None,
        }

    stage2_results = []
    for coro in asyncio.as_completed([rank_member(member) for member in ranking_members]):
        result = await coro
        if result is not None:
            stage2_results.append(result)
    return stage2_results, label_to_model, any_parse_failed


async def stage3_synthesize_final(
    registry: ProviderRegistry,
    chairman: CouncilMember,
    user_query: str,
    stage1_results: List[Dict[str, Any]],
    stage2_results: List[Dict[str, Any]],
    aggregate_rankings: List[Dict[str, Any]],
    profile: str,
    web_context: str = "",
) -> Dict[str, Any]:
    stage1_input = stage1_results
    if profile == "tiny":
        stage1_input = [
            {
                **result,
                "response": truncate_text(result.get("response", ""), 600),
            }
            for result in stage1_results
        ]

    if profile == "tiny":
        stage2_summary = summarize_stage2_for_stage3(stage2_results, aggregate_rankings)
    else:
        stage2_summary = "\n\n".join(
            f"Model: {result.get('display_name') or result['model']}\nRanking: {result['ranking']}"
            for result in stage2_results
        )

    chairman_prompt = build_stage3_prompt(
        user_query, stage1_input, stage2_summary, profile, web_context=web_context
    )
    messages = [{"role": "user", "content": chairman_prompt}]
    response = await _complete_with_limits(
        registry, chairman, messages, "stage3", profile
    )

    if response.error:
        return {
            "member_id": chairman.id,
            "model": chairman.model,
            "display_name": _member_label(chairman),
            "provider_id": chairman.provider_id,
            "response": f"Error: Unable to generate final synthesis. {response.error}",
            "error": response.error,
        }

    return {
        "member_id": chairman.id,
        "model": chairman.model,
        "display_name": _member_label(chairman),
        "provider_id": chairman.provider_id,
        "response": response.content,
    }


async def generate_conversation_title(
    registry: ProviderRegistry, user_query: str, profile: str
) -> str:
    settings = load_settings()
    title_member = settings.get_chairman()
    if not title_member:
        return "New Conversation"

    messages = [{"role": "user", "content": build_title_prompt(user_query)}]
    response = await _complete_with_limits(
        registry,
        title_member,
        messages,
        "title",
        profile,
        timeout=30.0,
    )
    if response.error or not response.content:
        return "New Conversation"

    title = response.content.strip().strip('"\'')
    if len(title) > 50:
        title = title[:47] + "..."
    return title or "New Conversation"


async def run_full_council(
    registry: ProviderRegistry,
    user_query: str,
    on_member_complete: Optional[Callable[[Dict[str, Any]], None]] = None,
) -> Tuple[List, List, Dict, Dict]:
    settings = load_settings()
    profile = settings.council_profile or "standard"
    members = settings.get_enabled_members()
    chairman = settings.get_chairman()

    if len(members) < 2:
        return [], [], {
            "display_name": "Error",
            "model": "error",
            "response": "At least 2 enabled council members are required.",
            "error": "insufficient_members",
        }, {}

    stage1_all, all_stage1 = await stage1_collect_responses(
        registry, members, user_query, profile, on_member_complete=on_member_complete
    )
    if not stage1_all:
        return [], [], {
            "display_name": "Error",
            "model": "error",
            "response": "All council members failed to respond. Check your provider settings.",
            "error": "all_failed",
        }, {}

    stage2_results, label_to_model, ranking_parse_failed = await stage2_collect_rankings(
        registry, members, user_query, stage1_all, profile
    )
    aggregate_rankings = calculate_aggregate_rankings(stage2_results, label_to_model)

    if not chairman:
        return stage1_all, stage2_results, {
            "display_name": "Error",
            "model": "error",
            "response": "No chairman configured.",
            "error": "no_chairman",
        }, {
            "label_to_model": label_to_model,
            "aggregate_rankings": aggregate_rankings,
            "ranking_parse_failed": ranking_parse_failed,
        }

    stage3_result = await stage3_synthesize_final(
        registry,
        chairman,
        user_query,
        stage1_all,
        stage2_results,
        aggregate_rankings,
        profile,
    )

    metadata = {
        "label_to_model": label_to_model,
        "aggregate_rankings": aggregate_rankings,
        "ranking_parse_failed": ranking_parse_failed,
        "council_profile": profile,
        "failed_members": [
            result.get("display_name")
            for result in all_stage1
            if not result.get("success")
        ],
    }

    return stage1_all, stage2_results, stage3_result, metadata
