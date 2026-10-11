# Build the Windows API sidecar with PyInstaller and stage it for Tauri.
# Run from the repo root on Windows:
#   powershell -ExecutionPolicy Bypass -File .\scripts\build-sidecar.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$Python = if (Get-Command py -ErrorAction SilentlyContinue) { "py" } else { "python" }

Write-Host "Installing Python build dependencies..."
& $Python -m pip install -r requirements.txt pyinstaller

Write-Host "Building tinylm-council-api sidecar..."
& $Python -m PyInstaller --noconfirm --clean desktop\tinylm-council-api.spec

$Built = Join-Path $Root "dist\tinylm-council-api.exe"
if (-not (Test-Path $Built)) {
    throw "Expected sidecar at $Built"
}

$Triple = "x86_64-pc-windows-msvc"
$DestDir = Join-Path $Root "frontend\src-tauri\binaries"
New-Item -ItemType Directory -Force -Path $DestDir | Out-Null
$Dest = Join-Path $DestDir "tinylm-council-api-$Triple.exe"
Copy-Item -Force $Built $Dest

Write-Host "Staged sidecar: $Dest"
