"""Shared types and provider protocol."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Dict, List, Optional, Protocol


@dataclass
class CompletionResult:
    content: str
    error: Optional[str] = None
    reasoning_details: Optional[Any] = None


@dataclass
class ConnectionTestResult:
    ok: bool
    message: str
    latency_ms: Optional[float] = None


@dataclass
class ModelInfo:
    id: str
    name: str
    size: Optional[int] = None
    loaded: bool = False


@dataclass
class ProviderCapabilities:
    can_list_models: bool = True
    can_pull: bool = False
    can_load: bool = False
    can_unload: bool = False
    can_delete: bool = False
    can_list_running: bool = False
    native_api_available: bool = False
    notes: str = ""


@dataclass
class ProviderConfig:
    id: str
    type: str
    name: str
    base_url: str
    api_key_env: Optional[str] = None
    native_base_url: Optional[str] = None
    preset: Optional[str] = None


@dataclass
class CouncilMember:
    id: str
    provider_id: str
    model: str
    display_name: str
    enabled: bool = True


@dataclass
class ProgressEvent:
    status: str
    completed: Optional[int] = None
    total: Optional[int] = None
    percent: Optional[float] = None
    message: Optional[str] = None
    done: bool = False
    error: Optional[str] = None


class LLMProvider(Protocol):
    config: ProviderConfig

    async def complete(
        self,
        model: str,
        messages: List[Dict[str, str]],
        timeout: float = 120.0,
    ) -> CompletionResult: ...

    async def list_models(self) -> List[ModelInfo]: ...

    async def test_connection(self) -> ConnectionTestResult: ...

    def get_capabilities(self) -> ProviderCapabilities: ...


@dataclass
class AppSettings:
    providers: List[ProviderConfig] = field(default_factory=list)
    council_members: List[CouncilMember] = field(default_factory=list)
    chairman_member_id: Optional[str] = None
    council_profile: str = "tiny"
    setup_complete: bool = False

    def get_enabled_members(self) -> List[CouncilMember]:
        return [m for m in self.council_members if m.enabled]

    def get_chairman(self) -> Optional[CouncilMember]:
        if not self.chairman_member_id:
            enabled = self.get_enabled_members()
            return enabled[0] if enabled else None
        for member in self.council_members:
            if member.id == self.chairman_member_id and member.enabled:
                return member
        enabled = self.get_enabled_members()
        return enabled[0] if enabled else None

    def get_provider(self, provider_id: str) -> Optional[ProviderConfig]:
        for provider in self.providers:
            if provider.id == provider_id:
                return provider
        return None
