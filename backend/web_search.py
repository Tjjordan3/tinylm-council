"""Web pre-search for council prompts (Option A — single search before Stage 1)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

import httpx

from .context_utils import truncate_text

MAX_RESULTS = 5
SEARCH_TIMEOUT = 15.0
CONTEXT_LIMITS = {"tiny": 1500, "standard": 4000}


@dataclass
class WebSearchResult:
    query: str
    sources: List[Dict[str, str]] = field(default_factory=list)
    context_text: str = ""
    error: Optional[str] = None


def _get_provider_name() -> str:
    return (os.getenv("WEB_SEARCH_PROVIDER") or "serper").strip().lower()


def _get_serper_api_key() -> Optional[str]:
    from .settings import load_settings

    settings = load_settings()
    if settings.serper_api_key and settings.serper_api_key.strip():
        return settings.serper_api_key.strip()
    env_key = os.getenv("SERPER_API_KEY")
    return env_key.strip() if env_key and env_key.strip() else None


def serper_key_setup_message() -> str:
    return (
        "Add your Serper API key in Settings or set SERPER_API_KEY in .env "
        "(free key at https://serper.dev)"
    )


def _missing_serper_key_message() -> str:
    return serper_key_setup_message()


def _format_context(sources: List[Dict[str, str]], profile: str) -> str:
    if not sources:
        return ""
    lines = []
    for index, source in enumerate(sources, start=1):
        title = source.get("title") or "Untitled"
        snippet = source.get("snippet") or ""
        url = source.get("url") or ""
        lines.append(f"{index}. {title}\n   {snippet}\n   Source: {url}")
    raw = "\n\n".join(lines)
    limit = CONTEXT_LIMITS.get(profile, CONTEXT_LIMITS["standard"])
    return truncate_text(raw, limit)


async def _serper_search(query: str, profile: str) -> WebSearchResult:
    api_key = _get_serper_api_key()
    if not api_key:
        return WebSearchResult(
            query=query,
            error=_missing_serper_key_message(),
        )

    try:
        async with httpx.AsyncClient(timeout=SEARCH_TIMEOUT) as client:
            response = await client.post(
                "https://google.serper.dev/search",
                headers={
                    "X-API-KEY": api_key,
                    "Content-Type": "application/json",
                },
                json={"q": query, "num": MAX_RESULTS},
            )
            response.raise_for_status()
            data = response.json()
    except Exception as exc:
        return WebSearchResult(query=query, error=f"Web search failed: {exc}")

    sources: List[Dict[str, str]] = []
    for item in data.get("organic", [])[:MAX_RESULTS]:
        sources.append(
            {
                "title": item.get("title") or "",
                "url": item.get("link") or "",
                "snippet": item.get("snippet") or "",
            }
        )

    if not sources:
        return WebSearchResult(
            query=query,
            error="Web search returned no results",
        )

    return WebSearchResult(
        query=query,
        sources=sources,
        context_text=_format_context(sources, profile),
    )


PROVIDERS: Dict[str, Callable[..., Any]] = {
    "serper": _serper_search,
}


def is_web_search_configured() -> bool:
    provider = _get_provider_name()
    if provider == "serper":
        return bool(_get_serper_api_key())
    return False


async def search_web(query: str, profile: str) -> WebSearchResult:
    provider = _get_provider_name()
    search_fn = PROVIDERS.get(provider)
    if not search_fn:
        return WebSearchResult(
            query=query,
            error=f"Unknown WEB_SEARCH_PROVIDER: {provider}",
        )
    return await search_fn(query, profile)


def web_search_metadata(result: WebSearchResult, enabled: bool) -> Dict[str, Any]:
    return {
        "enabled": enabled,
        "query": result.query,
        "sources": result.sources,
        "error": result.error,
    }
