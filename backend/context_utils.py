"""Context trimming helpers for tiny-model council runs."""

from __future__ import annotations

import re
from typing import Any, Dict, List


def truncate_text(text: str, max_chars: int) -> str:
    if not text or len(text) <= max_chars:
        return text

    truncated = text[:max_chars]
    last_period = max(truncated.rfind(". "), truncated.rfind(".\n"), truncated.rfind("! "))
    if last_period > max_chars // 2:
        return truncated[: last_period + 1].strip()
    return truncated.rstrip() + "..."


def trim_stage1_for_stage2(
    stage1_results: List[Dict[str, Any]],
    max_chars_per_response: int = 600,
) -> List[Dict[str, Any]]:
    trimmed = []
    for result in stage1_results:
        copy = dict(result)
        copy["response"] = truncate_text(result.get("response", ""), max_chars_per_response)
        trimmed.append(copy)
    return trimmed


def summarize_stage2_for_stage3(
    stage2_results: List[Dict[str, Any]],
    aggregate_rankings: List[Dict[str, Any]],
) -> str:
    lines = ["Aggregate peer rankings (best first):"]
    for index, agg in enumerate(aggregate_rankings, start=1):
        lines.append(
            f"{index}. {agg['model']} (avg rank {agg['average_rank']}, {agg['rankings_count']} votes)"
        )

    lines.append("")
    lines.append("Individual parsed rankings:")
    for result in stage2_results:
        parsed = result.get("parsed_ranking") or []
        if parsed:
            ranking_str = " > ".join(parsed)
        else:
            first_line = (result.get("ranking") or "").split("\n")[0][:120]
            ranking_str = first_line or "(parse failed)"
        lines.append(f"- {result.get('display_name') or result['model']}: {ranking_str}")

    return "\n".join(lines)
