# TinyLM Council

A local web app where multiple **small LLMs** (0.5–4B) answer your question, peer-review each other's responses, and a chairman synthesizes a final answer. Inspired by [karpathy/llm-council](https://github.com/karpathy/llm-council), optimized for tiny models on Ollama and LM Studio.

## Setup guides

| Platform | Guide |
|----------|-------|
| **Windows** (PC + phone via Tailscale) | **[docs/WINDOWS_SETUP.md](docs/WINDOWS_SETUP.md)** |
| **Linux server** (production + Tailscale) | **[docs/SERVER_SETUP.md](docs/SERVER_SETUP.md)** |

See [CHANGELOG.md](CHANGELOG.md) for release notes.

## How it works

1. **Stage 1 — First opinions:** Your question goes to all council members in parallel.
2. **Stage 2 — Peer review:** Each member anonymously ranks the others' answers.
3. **Stage 3 — Final answer:** The chairman compiles everything into one response.

## Tiny vs Standard profile

| Profile | Best for | Behavior |
|---------|----------|----------|
| **Tiny** (default) | 0.5–4B local models | Short prompts, token limits, trimmed context, simpler `RANK:` format |
| **Standard** | Cloud / large models | Original longer prompts and full context |

Switch profiles in **Settings**. Optional **Search the web first** (per message) uses [Serper](https://serper.dev) — set `SERPER_API_KEY` in `.env`.

## Supported providers

| Provider | Chat | Model download | Load into memory |
|----------|------|----------------|------------------|
| Ollama | Yes | Pull via app | Auto on first use |
| LM Studio | Yes | Download via app | Load/unload via app |
| OpenRouter (cloud) | Yes | — | — |
| LocalAI / vLLM | Yes | — | — |

## Test run checklist

1. Install [Ollama](https://ollama.com/) and pull at least one small model, e.g. `ollama pull qwen2.5:0.5b`
2. From the project folder, run `.\start.ps1`
3. Open http://localhost:5173 and complete the setup wizard (Ollama only is fine)
4. In **Settings**, confirm **Tiny** profile is selected
5. Apply the **Tiny local council** preset, or enable 2+ models you have installed
6. Pick a chairman and save
7. Ask a short factual question first (e.g. "What is the capital of France?")

## Quick start (Windows)

See the full **[Windows setup guide](docs/WINDOWS_SETUP.md)** for diagrams, Tailscale phone access, and troubleshooting.

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
  frontend/          React + Vite UI (responsive + PWA manifest)
  docs/              Windows and Linux setup guides
  data/              Settings and conversations (runtime, not committed)
  start.ps1          Windows launcher
  CHANGELOG.md       Release notes
```

## Tech stack

- **Backend:** FastAPI, httpx, Python 3.10+
- **Frontend:** React, Vite, Tailwind CSS
- **Storage:** JSON files in `data/`

## License

MIT
