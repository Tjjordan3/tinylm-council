"""Shared httpx AsyncClient pool for provider and search calls."""

from __future__ import annotations

from typing import Dict, Optional

import httpx

_clients: Dict[str, httpx.AsyncClient] = {}
_DEFAULT_TIMEOUT = 120.0


def get_http_client(timeout: Optional[float] = None) -> httpx.AsyncClient:
    """Return a process-wide AsyncClient. Per-request timeouts override the default."""
    key = "default"
    client = _clients.get(key)
    if client is None or client.is_closed:
        _clients[key] = httpx.AsyncClient(
            timeout=httpx.Timeout(timeout if timeout is not None else _DEFAULT_TIMEOUT)
        )
    return _clients[key]


def get_streaming_client() -> httpx.AsyncClient:
    """Client with no read timeout for long-lived streams (pull/download/chat stream)."""
    key = "streaming"
    client = _clients.get(key)
    if client is None or client.is_closed:
        _clients[key] = httpx.AsyncClient(timeout=None)
    return _clients[key]


async def close_http_clients() -> None:
    for key, client in list(_clients.items()):
        if client is not None and not client.is_closed:
            await client.aclose()
        _clients.pop(key, None)
