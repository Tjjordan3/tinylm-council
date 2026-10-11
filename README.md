# TinyLM Council

A local web app where multiple **small LLMs** (0.5–4B) answer your question, peer-review each other's responses, and a chairman synthesizes a final answer. Inspired by [karpathy/llm-council](https://github.com/karpathy/llm-council), optimized for tiny models on Ollama and LM Studio.

## Downloads / Releases

Get the Windows desktop installer from GitHub Releases:

**[https://github.com/Tjjordan3/tinylm-council/releases](https://github.com/Tjjordan3/tinylm-council/releases)**

| Asset | Platform |
|-------|----------|
| `TinyLM-Council-Windows-Setup.exe` | Windows 10/11 (NSIS installer) |
| `TinyLM-Council-<version>-Windows-Setup.exe` | Same build, versioned filename |

Install Ollama or LM Studio separately, then launch **TinyLM Council** from the Start menu. Details: **[docs/WINDOWS_DESKTOP.md](docs/WINDOWS_DESKTOP.md)**.

Release notes: [CHANGELOG.md](CHANGELOG.md).

## Setup guides

| Platform | Guide |
|----------|-------|
| **Windows desktop app** (installer — recommended) | **[docs/WINDOWS_DESKTOP.md](docs/WINDOWS_DESKTOP.md)** |
| **Windows** (dev server + phone via Tailscale) | **[docs/WINDOWS_SETUP.md](docs/WINDOWS_SETUP.md)** |
| **Linux server** (production + Tailscale) | **[docs/SERVER_SETUP.md](docs/SERVER_SETUP.md)** |

## How it works

1. **Stage 1 — First opinions:** Your question goes to all council members in parallel.
2. **Stage 2 — Deliberation** (choose in Settings or per message):
   - **Ranked peer review** (default): each member anonymously ranks the others' answers.
   - **Debate:** members rebut each other for 1–3 rounds, then revise their positions.
3. **Stage 3 — Final answer:** The chairman compiles everything into one consensus response.

## Tiny vs Standard profile

| Profile | Best for | Behavior |
|---------|----------|----------|
| **Tiny** (default) | 0.5–4B local models | Short prompts, token limits, trimmed context, simpler `RANK:` format |
| **Standard** | Cloud / large models | Original longer prompts and full context |

Switch profiles in **Settings**. Optional **Search the web first** (per message) uses [Serper](https://serper.dev) — add the key in **Settings → Web search** or in `.env`. **NVIDIA NIM** cloud models use an API key from [build.nvidia.com](https://build.nvidia.com/models) — set in **Settings → NVIDIA NIM** or `.env`.

## Supported providers

| Provider | Chat | Model download | Load into memory |
|----------|------|----------------|------------------|
| Ollama | Yes | Pull via app | Auto on first use |
| LM Studio | Yes | Download via app | Load/unload via app |
| OpenRouter (cloud) | Yes | Browse catalog | — |
| NVIDIA NIM (cloud) | Yes | Browse full catalog | — |
| LocalAI / vLLM | Yes | — | — |

## Test run checklist

**Desktop installer**

1. Download `TinyLM-Council-Windows-Setup.exe` from [Releases](https://github.com/Tjjordan3/tinylm-council/releases)
2. Install [Ollama](https://ollama.com/) and pull at least one small model, e.g. `ollama pull qwen2.5:0.5b`
3. Launch **TinyLM Council** and complete the setup wizard (Ollama only is fine)
4. In **Settings**, confirm **Tiny** profile is selected, enable 2+ models, pick a chairman, save
5. Ask a short factual question first (e.g. "What is the capital of France?")

**Dev server** (`start.ps1`)

1. Install [Ollama](https://ollama.com/) and pull at least one small model, e.g. `ollama pull qwen2.5:0.5b`
2. From the project folder, run `.\start.ps1`
3. Open http://localhost:5173 and complete the setup wizard (Ollama only is fine)
4. In **Settings**, confirm **Tiny** profile is selected
5. Apply the **Tiny local council** preset, **Mini coding council** (code-tuned models), or enable 2+ models you have installed
6. Pick a chairman and save
7. Ask a short factual question first (e.g. "What is the capital of France?")

For the **Mini coding council** preset, pull the models first:

```powershell
ollama pull qwen2.5-coder:1.5b
ollama pull deepseek-coder:1.3b
ollama pull qwen2.5-coder:0.5b
```

## Quick start (Windows)

**Prefer the installer?** Download `TinyLM-Council-Windows-Setup.exe` from **[Releases](https://github.com/Tjjordan3/tinylm-council/releases)** — see **[Windows desktop guide](docs/WINDOWS_DESKTOP.md)**.

For the source / `start.ps1` flow, see the full **[Windows setup guide](docs/WINDOWS_SETUP.md)** (diagrams, Tailscale phone access, troubleshooting).

### 1. Install dependencies

**Backend** (Python 3.10+):

```powershell
cd path\to\tinylm-council
python -m pip install -r requirements.txt
```

Or with [uv](https://docs.astral.sh/uv/): `uv sync`

**Frontend**:

```powershell
cd frontend
npm install
cd ..
```

### 2. Configure API key (optional — cloud models only)

```powershell
copy .env.example .env
```

Add `OPENROUTER_API_KEY` for OpenRouter cloud models.

### 3. Run

```powershell
.\start.ps1
```

Open http://localhost:5173 on your PC.

## Mobile access with Tailscale

TinyLM Council is a single web app. Your PC keeps the same desktop experience at `http://localhost:5173`, and you can also open it on your phone over [Tailscale](https://tailscale.com/) — no separate mobile app required.

### Prerequisites

1. [Tailscale](https://tailscale.com/download) installed on your **PC** and **phone**, signed into the same tailnet
2. TinyLM Council running on the PC (`.\start.ps1` or manual start below)
3. Windows Firewall (if prompted) allowing inbound connections on port **5173**

The frontend dev server binds to all interfaces (`0.0.0.0:5173`). API calls still go through the Vite proxy to the backend on your PC, so models run locally — your phone is just a remote browser.

### Find your PC's Tailscale address

On the PC:

```powershell
tailscale ip -4
```

Or use your PC's MagicDNS name from the Tailscale admin console (e.g. `http://my-pc:5173`).

`start.ps1` prints the mobile URL automatically when Tailscale CLI is available.

### Open on your phone

In your phone browser, go to:

```text
http://<your-pc-tailscale-ip>:5173
```

Replace `<your-pc-tailscale-ip>` with the address from `tailscale ip -4` (typically a `100.x.x.x` address).

### Install as a PWA (optional)

On your phone:

- **iOS (Safari):** Share → **Add to Home Screen**
- **Android (Chrome):** Menu → **Install app** or **Add to Home Screen**

This creates a home-screen shortcut to the same Tailscale URL. It is not a native app — inference still runs on your PC.

### Security notes

- Only devices on **your** Tailscale tailnet can reach the app.
- Do not expose ports 5173/8001 to the public internet without additional auth.
- Conversations and settings stay in the local `data/` folder on your PC (gitignored).

## Manual start

**Backend:**

```powershell
python -m backend.main
```

**Frontend** (network-accessible for Tailscale):

```powershell
cd frontend
npm run dev
```

Vite is configured with `host: true`, so the frontend listens on `0.0.0.0:5173` as well as localhost.

## Self-hosted setup

For Linux server deployment with nginx and systemd, see **[docs/SERVER_SETUP.md](docs/SERVER_SETUP.md)**.

### Ollama

1. Ensure Ollama is running (`http://localhost:11434`)
2. Use **Models** to pull tiny models: `qwen2.5:0.5b`, `phi3:mini`, `gemma2:2b`
3. Add them to your council in Settings or via **Add to council** in Model Manager

### LM Studio

1. Start the local server (default port 1234)
2. For download/load, use LM Studio 0.4+ with native REST API
3. Set `LM_API_TOKEN` in `.env` if authentication is enabled

## Project structure

```
tinylm-council/
  backend/           FastAPI server, council logic, tiny-model prompts
  frontend/          React + Vite UI (+ Tauri desktop shell in src-tauri/)
  desktop/           PyInstaller sidecar entry for Windows builds
  docs/              Windows and Linux setup guides
  scripts/           Windows pack / sidecar build helpers
  data/              Settings and conversations (dev runtime, not committed)
  start.ps1          Windows browser launcher
  CHANGELOG.md       Release notes
```

## Tech stack

- **Backend:** FastAPI, httpx, Python 3.10+
- **Frontend:** React, Vite, Tailwind CSS
- **Desktop:** Tauri 2 (WebView2) + PyInstaller API sidecar
- **Storage:** JSON files in `data/` (dev) or `%LOCALAPPDATA%\TinyLM Council\` (desktop)

## License

MIT
