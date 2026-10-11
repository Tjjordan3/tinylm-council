# PyInstaller spec for the TinyLM Council API sidecar.
# Build from repo root:
#   pyinstaller desktop/tinylm-council-api.spec

import sys
from pathlib import Path

block_cipher = None
root = Path(SPECPATH).resolve().parent

a = Analysis(
    [str(root / "desktop" / "run_api.py")],
    pathex=[str(root)],
    binaries=[],
    datas=[],
    hiddenimports=[
        "uvicorn.logging",
        "uvicorn.loops",
        "uvicorn.loops.auto",
        "uvicorn.protocols",
        "uvicorn.protocols.http",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.websockets",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.lifespan",
        "uvicorn.lifespan.on",
        "backend",
        "backend.main",
        "backend.paths",
        "backend.settings",
        "backend.storage",
        "backend.council",
        "backend.prompts",
        "backend.model_manager",
        "backend.web_search",
        "backend.ranking_parser",
        "backend.context_utils",
        "backend.providers",
        "backend.providers.base",
        "backend.providers.registry",
        "backend.providers.openai_compatible",
        "backend.providers.ollama_native",
        "backend.providers.lmstudio_native",
        "backend.providers.openrouter",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="tinylm-council-api",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
