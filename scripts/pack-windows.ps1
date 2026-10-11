# Build the Windows desktop installer (NSIS) with Tauri + Python sidecar.
# Prerequisites: Node.js, Rust, WebView2, Python 3.10+
# Run from the repo root:
#   powershell -ExecutionPolicy Bypass -File .\scripts\pack-windows.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "==> Building API sidecar"
& "$Root\scripts\build-sidecar.ps1"

Write-Host "==> Installing frontend dependencies"
Set-Location "$Root\frontend"
npm ci

Write-Host "==> Building Tauri Windows installer"
npm run desktop:build

$Bundle = Join-Path $Root "frontend\src-tauri\target\release\bundle\nsis"
Write-Host ""
Write-Host "Done. Installer output:"
if (Test-Path $Bundle) {
    Get-ChildItem $Bundle -Filter *.exe | ForEach-Object { Write-Host "  $($_.FullName)" }
} else {
    Write-Host "  (check frontend\src-tauri\target\release\bundle\)"
}
