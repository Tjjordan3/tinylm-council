# Changelog

All notable changes to TinyLM Council are documented here.

## [Unreleased]

## [0.8.0] - 2026-10-11

### Added

- **Token streaming** — Stage 1, debate, and chairman answers stream into the UI as tokens arrive (`member_delta`, `debate_member_delta`, `stage3_delta`)
- **Quick answer mode** — Stage 1 → chairman only (skip rank/debate); Settings default + per-message composer override
- **Max members** — limit a run to 2–4 enabled members from the composer or Settings
- **Debate early-exit** — stop further rounds when positions converge
- **Shared Stage-2 brief + approx token budgets** — pack peer context more efficiently for tiny models
- **Stage 1 response cache** — short in-memory TTL reuse for identical member/query retries
- **Web search auto-skip** — optional heuristic to skip Serper on greetings/opinions/coding without freshness cues
- **Stage elapsed timers** and timeline-style progress chrome
- **Visual refresh** — amber/copper accent, IBM Plex typography, slate gradient atmosphere, final-answer-first layout
- **Stage 2 rank streaming** — peer-review rankings stream like Stage 1 / debate
- **Regenerate chairman** — re-run Stage 3 only from a finished answer (seeds Stage 1 cache for retries)
- **Brand empty state + composer** — send without pre-creating a conversation; chat is created on Send

### Changed

- **Shared httpx clients** — connection reuse across provider and search calls
- **Stop / cancel** — SSE disconnect cancels in-flight council tasks and releases the council lock
- **Local concurrency** — Tiny profile defaults to 2 concurrent local calls; “Allow more parallel local requests” raises that to 4
- **Desktop docs** — Quick mode, streaming, and regenerate chairman covered in Windows guides

### Fixed

- **Settings persistence** — `default_run_mode`, `default_max_members`, and `web_search_auto` now persist via PUT `/api/settings`
- **Live Stage 2 / debate / Stage 3 streaming** — deltas flush immediately instead of waiting on keepalive (~12s)
- **Empty-chat Send race** — auto-created conversations no longer wipe the optimistic streaming bubble
- **Regenerate + web search** — persisted `context_text` is reused for Stage 3 regen and Stage 1 cache keys
- **Max members + chairman** — forcing the chairman in no longer exceeds the member cap
- **Mid-stream conversation switch** — aborting or switching chats no longer lets late SSE/delta flushes overwrite the newly selected conversation
- **Stage 2 rank cancel** — cancelling Stage 2 now cancels sibling `rank_member` tasks instead of leaving orphans after `as_completed`

## [0.7.1] - 2026-10-11

### Fixed

- **Debate settings reverting on Save** — desktop app now uses API port `18765` so a leftover `start.ps1` backend on `:8001` cannot ignore Debate fields; Settings save applies the server response and warns if Debate did not persist
- **Composer Mode override** — chat Mode no longer gets reset from Settings while you are actively choosing Debate/Rank

## [0.7.0] - 2026-10-11

### Added

- **Debate deliberation mode** — Settings and per-message toggle between ranked peer review and structured multi-round debate before the chairman synthesizes a consensus
- **`deliberation_mode` / `debate_rounds`** — persisted settings (1–3 debate rounds); chat composer can override mode per message
- **Debate guide section** — summary in Windows setup / desktop docs for how debate rounds work

## [0.6.0] - 2026-10-11

### Added

- **Windows desktop app (Tauri)** — native WebView2 shell with FastAPI API sidecar; install from [GitHub Releases](https://github.com/Tjjordan3/tinylm-council/releases) (`TinyLM-Council-Windows-Setup.exe`)
- **Release assets on tag** — `v*` tags attach the NSIS installer to the GitHub Release via CI
- **Packaged data directory** — desktop builds store settings/conversations under `%LOCALAPPDATA%\TinyLM Council\`
- **Desktop docs** — [WINDOWS_DESKTOP.md](docs/WINDOWS_DESKTOP.md); Windows setup guide leads with the installer path

## [0.5.0] - 2026-06-10

### Added

- **NVIDIA NIM cloud provider** — OpenAI-compatible access to the full hosted model catalog at [build.nvidia.com](https://build.nvidia.com/models)
- **NVIDIA API key in Settings** — paste key in-app (with `.env` fallback), test connection, clear saved key
- **`POST /api/nvidia/test`** — verify key and report model count
- **Models: Cloud tab** — browse/search all NVIDIA and OpenRouter models; featured shortcuts for NVIDIA
- **NVIDIA cloud council preset** — Standard profile with Llama 3.1 70B, Nemotron 70B, DeepSeek R1

### Changed

- Model Manager split into **Local** (Ollama, LM Studio) and **Cloud** (OpenRouter, NVIDIA NIM) provider groups

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

[0.8.0]: https://github.com/Tjjordan3/tinylm-council/releases/tag/v0.8.0
[0.7.1]: https://github.com/Tjjordan3/tinylm-council/releases/tag/v0.7.1
[0.7.0]: https://github.com/Tjjordan3/tinylm-council/releases/tag/v0.7.0
[0.6.0]: https://github.com/Tjjordan3/tinylm-council/releases/tag/v0.6.0
[0.5.0]: https://github.com/Tjjordan3/tinylm-council/releases/tag/v0.5.0
[0.4.1]: https://github.com/Tjjordan3/tinylm-council/releases/tag/v0.4.1
[0.4.0]: https://github.com/Tjjordan3/tinylm-council/releases/tag/v0.4.0
[0.3.0]: https://github.com/Tjjordan3/tinylm-council/releases/tag/v0.3.0
[0.2.0]: https://github.com/Tjjordan3/tinylm-council/releases/tag/v0.2.0
[0.1.0]: https://github.com/Tjjordan3/tinylm-council/releases/tag/v0.1.0
