#!/usr/bin/env bash
# Create a stub sidecar binary so `tauri build` can resolve externalBin on non-Windows hosts.
# `tauri dev` does not use this file (it spawns Python directly).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
DEST_DIR="$ROOT/frontend/src-tauri/binaries"
mkdir -p "$DEST_DIR"
DEST="$DEST_DIR/tinylm-council-api-$TRIPLE"

cat > "$DEST" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
export TINYLM_DESKTOP=1
export TINYLM_HOST="${TINYLM_HOST:-127.0.0.1}"
export TINYLM_PORT="${TINYLM_PORT:-8001}"
cd "$ROOT"
if command -v uv >/dev/null 2>&1; then
  exec uv run python -m backend.main
fi
exec python3 -m backend.main
EOF
chmod +x "$DEST"
echo "Prepared stub sidecar: $DEST"
