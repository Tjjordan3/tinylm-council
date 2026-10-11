"""Approximate token budgeting (chars/4) for tiny-model context packing."""

from __future__ import annotations

import hashlib
import re
from typing import Any, Dict, List, Optional, Tuple

from .context_utils import truncate_text

# Rough budgets for prompt packing (not model context windows).
STAGE_INPUT_BUDGETS = {
    "tiny": {"stage2_brief": 900, "per_member_own": 200, "debate_others": 700},
    "standard": {"stage2_brief": 3000, "per_member_own": 800, "debate_others": 2400},
}


def approx_tokens(text: str) -> int:
    if not text:
        return 0
    return max(1, (len(text) + 3) // 4)


def chars_for_tokens(tokens: int) -> int:
    return max(0, tokens * 4)


def budget_for(profile: str, key: str) -> int:
    profile_key = profile if profile in STAGE_INPUT_BUDGETS else "standard"
    return STAGE_INPUT_BUDGETS[profile_key].get(key, 1000)


def hash_text(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()[:16]


def normalize_for_compare(text: str) -> str:
    collapsed = re.sub(r"\s+", " ", (text or "").strip().lower())
    return collapsed


def positions_converged(texts: List[str], threshold: float = 0.92) -> bool:
    """Return True if all non-empty texts are near-duplicates."""
    norms = [normalize_for_compare(t) for t in texts if (t or "").strip()]
    if len(norms) < 2:
        return False
    if all(n == norms[0] for n in norms[1:]):
        return True
    from difflib import SequenceMatcher

    for i in range(len(norms)):
        for j in range(i + 1, len(norms)):
            if SequenceMatcher(None, norms[i], norms[j]).ratio() < threshold:
                return False
    return True


def build_shared_brief(
    stage1_results: List[Dict[str, Any]],
    profile: str,
    labels: Optional[List[str]] = None,
) -> str:
    """Pack Stage 1 answers into a shared brief under a token budget."""
    token_budget = budget_for(profile, "stage2_brief")
    char_budget = chars_for_tokens(token_budget)
    if not stage1_results:
        return ""

    n = len(stage1_results)
    per = max(80, char_budget // max(n, 1))
    parts = []
    used_labels = labels or [chr(65 + i) for i in range(n)]
    for label, result in zip(used_labels, stage1_results):
        name = result.get("display_name") or result.get("model") or "Member"
        text = truncate_text(result.get("response") or "", per)
        parts.append(f"Response {label} ({name}):\n{text}")
    brief = "\n\n".join(parts)
    return truncate_text(brief, char_budget)


def slice_own_answer(text: str, profile: str) -> str:
    return truncate_text(text or "", chars_for_tokens(budget_for(profile, "per_member_own")))


def pack_others_brief(
    others: List[Dict[str, str]],
    profile: str,
) -> List[Dict[str, str]]:
    """others items: {label, text} — trim to debate_others budget total."""
    token_budget = budget_for(profile, "debate_others")
    char_budget = chars_for_tokens(token_budget)
    if not others:
        return []
    per = max(80, char_budget // len(others))
    packed = []
    for item in others:
        packed.append(
            {
                "label": item["label"],
                "text": truncate_text(item.get("text") or "", per),
            }
        )
    return packed


# In-memory Stage 1 completion cache (process-local, TTL).
_stage1_cache: Dict[str, Tuple[float, Any]] = {}
_CACHE_TTL_SECONDS = 600.0


def stage1_cache_key(
    member_id: str,
    model: str,
    profile: str,
    query: str,
    web_context: str,
) -> str:
    return "|".join(
        [
            member_id,
            model,
            profile,
            hash_text(query),
            hash_text(web_context or ""),
        ]
    )


def cache_get_stage1(key: str):
    import time

    entry = _stage1_cache.get(key)
    if not entry:
        return None
    ts, value = entry
    if time.time() - ts > _CACHE_TTL_SECONDS:
        _stage1_cache.pop(key, None)
        return None
    return value


def cache_set_stage1(key: str, value: Any) -> None:
    import time

    _stage1_cache[key] = (time.time(), value)
    # Opportunistic prune
    if len(_stage1_cache) > 256:
        now = time.time()
        stale = [k for k, (ts, _) in _stage1_cache.items() if now - ts > _CACHE_TTL_SECONDS]
        for k in stale:
            _stage1_cache.pop(k, None)
