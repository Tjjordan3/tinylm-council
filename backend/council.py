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
    build_debate_round_prompt,
    build_stage1_messages,
    build_stage2_prompt,
    build_stage3_prompt,
    build_title_prompt,
    get_stage_limits,
    summarize_debate_for_stage3,
)
from .providers.base import CompletionResult, CouncilMember, ProviderConfig
from .providers.registry import ProviderRegistry
from .ranking_parser import parse_ranking_with_fallback
from .settings import load_settings
from .token_budget import (
    build_shared_brief,
    cache_get_stage1,
    cache_set_stage1,
    pack_others_brief,
    positions_converged,
    slice_own_answer,
    stage1_cache_key,
)

LOCAL_PRESETS = {"ollama", "lmstudio", "localai", "vllm"}
_provider_semaphores: Dict[str, asyncio.Semaphore] = {}
_semaphore_limits: Dict[str, int] = {}


def _member_label(member: CouncilMember) -> str:
    return member.display_name or member.model


def _is_local_provider(config: Optional[ProviderConfig]) -> bool:
    if not config:
        return False
    return (config.preset or "").lower() in LOCAL_PRESETS


def _local_concurrency(profile: str, config: Optional[ProviderConfig]) -> Optional[int]:
    """Return semaphore size for local providers, or None for unlimited."""
    if not _is_local_provider(config):
        return None
    settings = load_settings()
    if settings.parallel_local_inference:
        return 4
    if profile == "tiny":
        return 2
    return None


def _get_provider_semaphore(provider_id: str, limit: int) -> asyncio.Semaphore:
    current = _semaphore_limits.get(provider_id)
    sem = _provider_semaphores.get(provider_id)
    if sem is None:
        _provider_semaphores[provider_id] = asyncio.Semaphore(limit)
        _semaphore_limits[provider_id] = limit
        return _provider_semaphores[provider_id]
    if current != limit:
        # Only swap when fully released to avoid briefly over-admitting holders.
        if getattr(sem, "_value", None) == current:
            _provider_semaphores[provider_id] = asyncio.Semaphore(limit)
            _semaphore_limits[provider_id] = limit
    return _provider_semaphores[provider_id]


async def _with_provider_limit(
    profile: str,
    provider_config: Optional[ProviderConfig],
    provider_id: str,
    coro_factory,
):
    limit = _local_concurrency(profile, provider_config)
    if limit is None:
        return await coro_factory()
    semaphore = _get_provider_semaphore(provider_id, limit)
    async with semaphore:
        return await coro_factory()


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

    return await _with_provider_limit(
        profile, provider_config, member.provider_id, run
    )


async def _stream_with_limits(
    registry: ProviderRegistry,
    member: CouncilMember,
    messages: List[dict],
    stage: str,
    profile: str,
    timeout: float = 120.0,
    on_delta: Optional[Callable[[str], None]] = None,
) -> CompletionResult:
    """Stream tokens via on_delta; return final CompletionResult."""
    limits = get_stage_limits(profile, stage)
    provider_config = registry.settings.get_provider(member.provider_id)

    async def run() -> CompletionResult:
        parts: List[str] = []
        try:
            async for delta in registry.complete_member_stream(
                member,
                messages,
                timeout=timeout,
                max_tokens=limits.get("max_tokens"),
                temperature=limits.get("temperature"),
            ):
                parts.append(delta)
                if on_delta:
                    on_delta(delta)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            return CompletionResult(content="".join(parts), error=str(exc))
        content = "".join(parts)
        if not content.strip():
            return CompletionResult(
                content="",
                error=f"Model {member.display_name or member.model} returned an empty response",
            )
        return CompletionResult(content=content)

    return await _with_provider_limit(
        profile, provider_config, member.provider_id, run
    )


def should_auto_skip_web_search(query: str) -> bool:
    """Heuristic: skip Serper for greetings / opinion / pure coding without freshness cues."""
    q = (query or "").strip().lower()
    if not q:
        return True
    freshness = (
        "latest",
        "current",
        "today",
        "news",
        "2024",
        "2025",
        "2026",
        "price",
        "who is",
        "when did",
        "weather",
    )
    if any(token in q for token in freshness):
        return False
    greetings = (
        "hi",
        "hello",
        "hey",
        "thanks",
        "thank you",
        "good morning",
        "good evening",
    )
    if q in greetings or q.rstrip("!") in greetings:
        return True
    if q.startswith(("what do you think", "how do you feel", "opinion on")):
        return True
    coding_starts = (
        "write a",
        "implement ",
        "refactor ",
        "fix this",
        "debug ",
        "explain this code",
        "```",
    )
    if any(q.startswith(s) for s in coding_starts) or "```" in q:
        return True
    return False


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
    on_member_complete: Optional[Callable[[Dict[str, Any]], None]] = None,
    on_delta: Optional[Callable[[str, str], None]] = None,
) -> Tuple[List[Dict[str, Any]], Dict[str, str], bool]:
    labels = [chr(65 + i) for i in range(len(stage1_results))]
    brief = build_shared_brief(stage1_results, profile, labels=labels)
    # Reconstruct trimmed stage1_input for prompt helper compatibility
    stage1_input = trim_stage1_for_stage2(
        stage1_results,
        max_chars_per_response=max(80, (len(brief) // max(len(stage1_results), 1)) + 20),
    )
    if brief:
        # Prefer shared brief packing over naive per-response trim
        for idx, result in enumerate(stage1_input):
            label = labels[idx]
            marker = f"Response {label}"
            # keep display fields; response already trimmed via brief allocation
            _ = marker

    available_labels = [f"Response {label}" for label in labels]
    label_to_model = {
        f"Response {label}": result.get("display_name") or result["model"]
        for label, result in zip(labels, stage1_input)
    }

    ranking_prompt = build_stage2_prompt(
        user_query,
        stage1_input,
        labels,
        profile,
        web_context=web_context,
        shared_brief=brief,
    )
    messages = [{"role": "user", "content": ranking_prompt}]
    any_parse_failed = False

    successful_member_ids = {result.get("member_id") for result in stage1_results}
    ranking_members = [m for m in members if m.id in successful_member_ids]
    if not ranking_members:
        ranking_members = members

    async def rank_member(member: CouncilMember) -> Optional[Dict[str, Any]]:
        nonlocal any_parse_failed

        def delta_cb(delta: str, mid: str = member.id) -> None:
            if on_delta:
                on_delta(mid, delta)

        response = await _stream_with_limits(
            registry,
            member,
            messages,
            "stage2",
            profile,
            on_delta=delta_cb if on_delta else None,
        )
        if response.error:
            result = {
                "member_id": member.id,
                "model": member.model,
                "display_name": _member_label(member),
                "provider_id": member.provider_id,
                "ranking": response.content or "",
                "parsed_ranking": [],
                "parse_failed": True,
                "error": response.error,
            }
            if on_member_complete:
                on_member_complete(result)
            return result
        full_text = response.content
        parsed, parse_failed = parse_ranking_with_fallback(full_text, available_labels)
        if parse_failed:
            any_parse_failed = True
        result = {
            "member_id": member.id,
            "model": member.model,
            "display_name": _member_label(member),
            "provider_id": member.provider_id,
            "ranking": full_text,
            "parsed_ranking": parsed,
            "parse_failed": parse_failed,
            "error": None,
        }
        if on_member_complete:
            on_member_complete(result)
        return result

    stage2_results = []
    for coro in asyncio.as_completed([rank_member(member) for member in ranking_members]):
        result = await coro
        if result is not None:
            stage2_results.append(result)
    return stage2_results, label_to_model, any_parse_failed


async def stage2_run_debate_rounds(
    registry: ProviderRegistry,
    members: List[CouncilMember],
    user_query: str,
    stage1_results: List[Dict[str, Any]],
    profile: str,
    debate_rounds: int = 1,
    web_context: str = "",
    on_member_complete: Optional[Callable[[int, Dict[str, Any]], None]] = None,
    on_delta: Optional[Callable[[int, str, str], None]] = None,
) -> Tuple[List[Dict[str, Any]], Dict[str, str]]:
    """Run structured anonymized debate rounds; returns (rounds, label_to_model)."""
    rounds_count = max(1, min(3, int(debate_rounds or 1)))
    positions = {
        result["member_id"]: {
            "member_id": result["member_id"],
            "model": result["model"],
            "display_name": result.get("display_name") or result["model"],
            "provider_id": result.get("provider_id"),
            "response": result.get("response") or "",
        }
        for result in stage1_results
        if result.get("success") and result.get("member_id")
    }
    if len(positions) < 2:
        return [], {}

    ordered_ids = [result["member_id"] for result in stage1_results if result["member_id"] in positions]
    labels = [chr(65 + i) for i in range(len(ordered_ids))]
    id_to_label = {
        member_id: f"Response {label}" for member_id, label in zip(ordered_ids, labels)
    }
    label_to_model = {
        id_to_label[member_id]: positions[member_id]["display_name"]
        for member_id in ordered_ids
    }

    member_by_id = {member.id: member for member in members}
    debate_history: List[Dict[str, Any]] = []

    for round_number in range(1, rounds_count + 1):
        async def debate_member(
            member_id: str, current_round: int = round_number
        ) -> Dict[str, Any]:
            pos = positions[member_id]
            member = member_by_id.get(member_id)
            if not member:
                return {
                    **pos,
                    "response": "",
                    "error": "member_not_found",
                    "success": False,
                }

            own_label = id_to_label[member_id]
            own_text = slice_own_answer(pos["response"], profile)

            others = []
            for other_id in ordered_ids:
                if other_id == member_id:
                    continue
                others.append(
                    {
                        "label": id_to_label[other_id],
                        "text": positions[other_id]["response"],
                    }
                )
            others = pack_others_brief(others, profile)

            prompt = build_debate_round_prompt(
                user_query,
                own_label,
                own_text,
                others,
                current_round,
                profile,
                web_context=web_context,
            )
            messages = [{"role": "user", "content": prompt}]

            def delta_cb(delta: str, mid: str = member.id, rnd: int = current_round) -> None:
                if on_delta:
                    on_delta(rnd, mid, delta)

            response = await _stream_with_limits(
                registry,
                member,
                messages,
                "debate",
                profile,
                on_delta=delta_cb if on_delta else None,
            )
            result = {
                "member_id": member.id,
                "model": member.model,
                "display_name": _member_label(member),
                "provider_id": member.provider_id,
                "response": response.content if not response.error else "",
                "error": response.error,
                "success": response.error is None,
                "label": own_label,
            }
            if on_member_complete:
                on_member_complete(current_round, result)
            return result

        round_results = list(
            await asyncio.gather(*[debate_member(mid) for mid in ordered_ids])
        )
        for result in round_results:
            if result.get("success") and result.get("response"):
                positions[result["member_id"]]["response"] = result["response"]

        debate_history.append({"round": round_number, "results": round_results})

        # Early-exit when positions have converged
        if round_number < rounds_count:
            texts = [
                positions[mid]["response"]
                for mid in ordered_ids
                if (positions[mid].get("response") or "").strip()
            ]
            if positions_converged(texts):
                break

    return debate_history, label_to_model


async def stage3_synthesize_final(
    registry: ProviderRegistry,
    chairman: CouncilMember,
    user_query: str,
    stage1_results: List[Dict[str, Any]],
    stage2_results: List[Dict[str, Any]],
    aggregate_rankings: List[Dict[str, Any]],
    profile: str,
    web_context: str = "",
    deliberation_mode: str = "rank",
    debate_rounds: Optional[List[Dict[str, Any]]] = None,
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

    mode = (deliberation_mode or "rank").strip().lower()
    if mode == "debate":
        stage2_summary = summarize_debate_for_stage3(debate_rounds or [], profile)
    elif mode == "quick":
        stage2_summary = ""
    elif profile == "tiny":
        stage2_summary = summarize_stage2_for_stage3(stage2_results, aggregate_rankings)
    else:
        stage2_summary = "\n\n".join(
            f"Model: {result.get('display_name') or result['model']}\nRanking: {result['ranking']}"
            for result in stage2_results
        )

    chairman_prompt = build_stage3_prompt(
        user_query,
        stage1_input,
        stage2_summary,
        profile,
        web_context=web_context,
        deliberation_mode=mode,
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


async def stage3_synthesize_final_stream(
    registry: ProviderRegistry,
    chairman: CouncilMember,
    user_query: str,
    stage1_results: List[Dict[str, Any]],
    stage2_results: List[Dict[str, Any]],
    aggregate_rankings: List[Dict[str, Any]],
    profile: str,
    web_context: str = "",
    deliberation_mode: str = "rank",
    debate_rounds: Optional[List[Dict[str, Any]]] = None,
    on_delta: Optional[Callable[[str], None]] = None,
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

    mode = (deliberation_mode or "rank").strip().lower()
    if mode == "debate":
        stage2_summary = summarize_debate_for_stage3(debate_rounds or [], profile)
    elif mode == "quick":
        stage2_summary = ""
    elif profile == "tiny":
        stage2_summary = summarize_stage2_for_stage3(stage2_results, aggregate_rankings)
    else:
        stage2_summary = "\n\n".join(
            f"Model: {result.get('display_name') or result['model']}\nRanking: {result['ranking']}"
            for result in stage2_results
        )

    chairman_prompt = build_stage3_prompt(
        user_query,
        stage1_input,
        stage2_summary,
        profile,
        web_context=web_context,
        deliberation_mode=mode,
    )
    messages = [{"role": "user", "content": chairman_prompt}]
    response = await _stream_with_limits(
        registry,
        chairman,
        messages,
        "stage3",
        profile,
        on_delta=on_delta,
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
    mode = (settings.deliberation_mode or "rank").strip().lower()
    if mode not in ("rank", "debate"):
        mode = "rank"
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

    debate_rounds_data: List[Dict[str, Any]] = []
    stage2_results: List[Dict[str, Any]] = []
    label_to_model: Dict[str, str] = {}
    ranking_parse_failed = False
    aggregate_rankings: List[Dict[str, Any]] = []

    if mode == "debate":
        debate_rounds_data, label_to_model = await stage2_run_debate_rounds(
            registry,
            members,
            user_query,
            stage1_all,
            profile,
            debate_rounds=settings.debate_rounds,
        )
    else:
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
            "deliberation_mode": mode,
            "debate_rounds": debate_rounds_data,
        }

    stage3_result = await stage3_synthesize_final(
        registry,
        chairman,
        user_query,
        stage1_all,
        stage2_results,
        aggregate_rankings,
        profile,
        deliberation_mode=mode,
        debate_rounds=debate_rounds_data,
    )

    metadata = {
        "label_to_model": label_to_model,
        "aggregate_rankings": aggregate_rankings,
        "ranking_parse_failed": ranking_parse_failed,
        "council_profile": profile,
        "deliberation_mode": mode,
        "debate_rounds_count": len(debate_rounds_data),
        "failed_members": [
            result.get("display_name")
            for result in all_stage1
            if not result.get("success")
        ],
    }
    if debate_rounds_data:
        metadata["debate_rounds"] = debate_rounds_data

    return stage1_all, stage2_results, stage3_result, metadata
