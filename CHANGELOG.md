# Changelog

All notable changes to TinyLM Council are documented here.

## [Unreleased]

## [0.4.1] - 2026-06-10

### Added

- **Delete conversations** — remove old chats from the sidebar (× button with confirmation)
- **Parallel Ollama requests** — Settings toggle to run council members concurrently (auto-enabled for remote Ollama URLs)

### Changed

- Web search uses fewer results and shorter context on **Tiny** profile (faster Serper + less for models to read)
- Title generation runs in parallel with web search on the first message (finishes before Stage 1, less Ollama contention during council)

## [0.4.0] - 2026-06-10

### Added

- **Serper API key in Settings** — paste your web search key in the app under **Settings → Web search** (no `.env` required); test and clear from the UI
- **`serper_api_key_source`** — API indicates whether the key comes from app settings or `.env`
- **`native_base_url` in Settings** — edit both Ollama/LM Studio URLs in the UI (fixes remote Ollama over Tailscale); auto-syncs from `base_url` when appropriate
- **Mini coding council preset** — one-click council with `qwen2.5-coder:1.5b`, `deepseek-coder:1.3b`, and `qwen2.5-coder:0.5b` on Tiny profile

### Changed

- Cloud council preset now switches to **Standard** profile when applied
- Docs updated for in-app Serper key and coding preset `ollama pull` commands

## [0.3.0] - 2026-06-07

### Added

- **Web pre-search (Option A)** — optional per-message "Search the web first" checkbox; runs one Serper search before Stage 1 and injects snippets into all council prompts
- **Web sources panel** — collapsible UI showing search results and links
- **`POST /api/web-search/test`** — verify Serper API key configuration
- Pluggable `backend/web_search.py` provider interface (Serper shipped first)

## [0.2.0] - 2026-06-07

### Added

- **Stop button** — cancel an in-progress council consultation from the chat UI
- **SSE keepalive** — pings every 12 seconds during long Stage 2/3 waits so mobile connections stay alive
- **Council lock** — only one council run at a time; clear error if a second request starts while busy
- **Setup guides** — `docs/WINDOWS_SETUP.md` and `docs/SERVER_SETUP.md` with architecture diagrams

### Fixed

- **Orphan user messages** — rollback user message when a council run fails, is cancelled, or disconnects
- **Stage 1 UI on mobile** — build Stage 1 incrementally from `member_complete` events; reload conversation on stream complete
- **SSE line buffering** — frontend parser no longer drops events split across network chunks
- **Stream cleanup** — loading state clears on incomplete streams; partial assistant bubble removed
- **Title generation** — uses same Ollama semaphore as council calls to avoid contention
- **Responsive Settings** — council member cards stack on mobile; long model names wrap instead of overflowing
- **Chat stage order** — Stage 1 → Stage 2 → Final answer (was showing final answer first)
- **CompletionResult crash** — fixed `UnboundLocalError` when a model returned an empty response (v0.1.1)
- **start.ps1 parse error** — replaced Unicode em-dash that broke PowerShell (v0.1.1)

### Changed

- Stage 2 rankings collected with `as_completed` for better progress behavior
- Immutable React state updates for streaming message handling

## [0.1.0] - 2026-06-06

### Added

- Initial release: 3-stage LLM council optimized for tiny local models
- Ollama, LM Studio, OpenRouter, LocalAI, vLLM provider support
- Tiny and Standard council profiles
- Tailscale mobile access, responsive layout, PWA manifest
- Windows launcher (`start.ps1`)
- LM Studio council reliability improvements

[0.4.1]: https://github.com/Tjjordan3/tinylm-council/releases/tag/v0.4.1
[0.4.0]: https://github.com/Tjjordan3/tinylm-council/releases/tag/v0.4.0
[0.3.0]: https://github.com/Tjjordan3/tinylm-council/releases/tag/v0.3.0
[0.2.0]: https://github.com/Tjjordan3/tinylm-council/releases/tag/v0.2.0
[0.1.0]: https://github.com/Tjjordan3/tinylm-council/releases/tag/v0.1.0
