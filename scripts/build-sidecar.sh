#!/usr/bin/env bash
# Build the API sidecar with PyInstaller and stage it for Tauri (Linux/macOS).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

python3 -m pip install -r requirements.txt pyinstaller
python3 -m PyInstaller --noconfirm --clean desktop/tinylm-council-api.spec

TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
DEST_DIR="$ROOT/frontend/src-tauri/binaries"
mkdir -p "$DEST_DIR"
SRC="$ROOT/dist/tinylm-council-api"
DEST="$DEST_DIR/tinylm-council-api-$TRIPLE"
cp -f "$SRC" "$DEST"
chmod +x "$DEST"
echo "Staged sidecar: $DEST"
