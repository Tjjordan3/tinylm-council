# TinyLM Council

A local web app where multiple **small LLMs** (0.5–4B) answer your question, peer-review each other's responses, and a chairman synthesizes a final answer. Inspired by [karpathy/llm-council](https://github.com/karpathy/llm-council), optimized for tiny models on Ollama and LM Studio.

## How it works

1. **Stage 1 — First opinions:** Your question goes to all council members in parallel.
2. **Stage 2 — Peer review:** Each member anonymously ranks the others' answers.
3. **Stage 3 — Final answer:** The chairman compiles everything into one response.

## Tiny vs Standard profile

| Profile | Best for | Behavior |
|---------|----------|----------|
| **Tiny** (default) | 0.5–4B local models | Short prompts, token limits, trimmed context, simpler `RANK:` format |
| **Standard** | Cloud / large models | Original longer prompts and full context |

Switch profiles in **Settings**.

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

### 1. Install dependencies

**Backend** (Python 3.10+):

```powershell
cd C:\Users\tjord\projects\llm-council
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

Open http://localhost:5173

## Manual start

**Backend:**

```powershell
python -m backend.main
```

**Frontend:**

```powershell
cd frontend
npm run dev
```

## Self-hosted setup

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
  frontend/          React + Vite UI
  data/              Settings and conversations (runtime)
  start.ps1          Windows launcher
```

## Tech stack

- **Backend:** FastAPI, httpx, Python 3.10+
- **Frontend:** React, Vite, Tailwind CSS
- **Storage:** JSON files in `data/`

## License

MIT
