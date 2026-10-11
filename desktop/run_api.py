"""Entrypoint for the packaged TinyLM Council API sidecar."""

from __future__ import annotations

import os
import sys
from pathlib import Path

# Allow `python desktop/run_api.py` from a source checkout.
_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

os.environ.setdefault("TINYLM_DESKTOP", "1")

from backend.main import app  # noqa: E402
from backend.paths import is_desktop_mode  # noqa: E402


def main() -> None:
    import uvicorn

    host = os.environ.get("TINYLM_HOST") or ("127.0.0.1" if is_desktop_mode() else "0.0.0.0")
    port = int(os.environ.get("TINYLM_PORT", "8001"))
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
