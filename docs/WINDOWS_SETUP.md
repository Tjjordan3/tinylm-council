# TinyLM Council — Windows Setup Guide

Run TinyLM Council on your Windows PC with Ollama or LM Studio, and optionally access it from your phone over Tailscale.

## Architecture

```mermaid
flowchart TB
    subgraph phone [Phone - optional]
        Mobile[Mobile browser / PWA]
    end

    subgraph pc [Windows PC]
        START[start.ps1]
        VITE[Vite dev server :5173]
        API[FastAPI backend :8001]
        OLL[Ollama :11434]
        LMS[LM Studio :1234]
        DATA[(data/ folder)]
    end

    subgraph tailnet [Tailscale tailnet]
        TS[100.x.x.x:5173]
    end

    START --> VITE
    START --> API
    VITE -->|proxy /api| API
    API --> OLL
    API --> LMS
    API --> DATA
    Mobile -->|Tailscale| TS
    TS --> VITE
```

## Requirements

- **Windows 10/11**
- **Python 3.10+** — [python.org](https://www.python.org/downloads/) (check "Add to PATH")
- **Node.js 18+** — [nodejs.org](https://nodejs.org/)
- **Ollama** and/or **LM Studio** for local models
- **Tailscale** (optional, for phone access) — [tailscale.com/download](https://tailscale.com/download)

## Quick start

### 1. Clone the repo

```powershell
git clone https://github.com/Tjjordan3/tinylm-council.git
cd tinylm-council
```

### 2. Install Ollama and pull models

Install from [ollama.com](https://ollama.com/), then:

```powershell
ollama pull qwen2.5:0.5b
ollama pull phi3:mini
```

### 3. Install app dependencies

**Backend:**

```powershell
python -m pip install -r requirements.txt
```

Or with [uv](https://docs.astral.sh/uv/): `uv sync`

**Frontend:**

```powershell
cd frontend
npm install
cd ..
```

### 4. Optional — cloud models

```powershell
copy .env.example .env
```

Edit `.env` and set `OPENROUTER_API_KEY` if you use OpenRouter.

### 5. Run

```powershell
.\start.ps1
```

Open **http://localhost:5173** in your browser.

`start.ps1` starts the backend (`:8001`) and frontend (`:5173`). If Tailscale is installed, it prints your mobile URL automatically.

## First-time configuration

1. Complete the **setup wizard** (Ollama-only is fine).
2. Go to **Settings**:
   - **Council profile:** Tiny (best for 0.5–4B models)
   - Apply **Tiny local council** preset, or enable 2+ models you have installed
   - Pick a **chairman** — use an **instruct/chat** model, not a base model
   - Click **Save changes**
3. Ask a short test question (e.g. "What is the capital of France?").

### Ollama on a remote server

If Ollama runs on another machine (e.g. over Tailscale), set **both** URLs in Settings → Providers → Ollama:

| Field | Example |
|-------|---------|
| base_url | `http://100.x.x.x:11434/v1` |
| native_base_url | `http://100.x.x.x:11434` |

Both must use the **same host**. Mismatched `native_base_url` causes models to not appear in the UI.

## Phone access (Tailscale)

1. Install Tailscale on your **PC** and **phone** (same account).
2. Run `.\start.ps1` on the PC.
3. Allow Windows Firewall for port **5173** if prompted.
4. On the PC: `tailscale ip -4` — note the `100.x.x.x` address.
5. On your phone browser: `http://100.x.x.x:5173`
6. Optional: **Add to Home Screen** for a PWA shortcut.

Inference still runs on the PC (or wherever your Ollama server is configured). The phone is a remote browser.

## Using the app

- **Stop button** — appears while a consultation runs; cancels the current council and clears partial results.
- **One at a time** — wait for a run to finish (or stop it) before sending another question.
- **Failed models** — one bad model does not stop the council; remove unreliable models in Settings.

## Manual start (without start.ps1)

**Terminal 1 — backend:**

```powershell
python -m backend.main
```

**Terminal 2 — frontend:**

```powershell
cd frontend
npm run dev
```

## LM Studio

1. Start the LM Studio local server (default port **1234**).
2. In Settings, add or configure the LM Studio provider.
3. Use **Models** in the app to download/load models (LM Studio 0.4+ native API).
4. Set `LM_API_TOKEN` in `.env` if authentication is enabled.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Port 5173 or 8001 in use | Stop the old process or restart the PC; `start.ps1` warns if ports are busy |
| Models not listed | Set `native_base_url` to match `base_url` host |
| Council never finishes | Use **Stop**, then retry; remote Ollama with 4 models can take 10+ minutes |
| Stage 1 missing in UI | Refresh the page or reopen the conversation |
| `start.ps1` parse error | Update to latest `main` — Unicode dash issue was fixed |
| Mobile can't connect | Check Tailscale on both devices; allow firewall on port 5173 |

## Data location

Settings and conversations are stored in:

```text
tinylm-council/data/
  settings.json
  conversations/
```

This folder is gitignored. Back it up if you reinstall or move machines.

## Update

```powershell
cd tinylm-council
git pull
python -m pip install -r requirements.txt
cd frontend
npm install
cd ..
```

Then restart with `.\start.ps1`.

## See also

- [Server setup guide](SERVER_SETUP.md) — Linux production deployment with nginx
- [Main README](../README.md)
