$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Get-NpmCommand {
    if (Get-Command npm.cmd -ErrorAction SilentlyContinue) {
        return (Get-Command npm.cmd).Source
    }
    if (Get-Command npm -ErrorAction SilentlyContinue) {
        return (Get-Command npm).Source
    }
    throw "npm was not found. Install Node.js from https://nodejs.org/"
}

function Test-PortInUse($Port) {
    $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    return $null -ne $connections
}

function Start-Backend {
    if (Test-PortInUse 8001) {
        Write-Host "WARNING: Port 8001 is already in use. Backend may already be running."
        Write-Host "         Stop the other process or run: Get-NetTCPConnection -LocalPort 8001 | Select OwningProcess"
        return $null
    }
    if (Get-Command uv -ErrorAction SilentlyContinue) {
        return Start-Process -FilePath "uv" -ArgumentList "run", "python", "-m", "backend.main" -PassThru -NoNewWindow
    }
    return Start-Process -FilePath "python" -ArgumentList "-m", "backend.main" -PassThru -NoNewWindow
}

Write-Host "Starting TinyLM Council backend..."
$backend = Start-Backend

Start-Sleep -Seconds 2

Write-Host "Starting TinyLM Council frontend..."
$npm = Get-NpmCommand
if (Test-PortInUse 5173) {
    Write-Host "WARNING: Port 5173 is already in use. Frontend may already be running at http://localhost:5173"
    $frontend = $null
} else {
    $frontend = Start-Process -FilePath $npm -ArgumentList "run", "dev" -WorkingDirectory "$PSScriptRoot\frontend" -PassThru -NoNewWindow
}

Write-Host ""
Write-Host "TinyLM Council is starting:"
Write-Host "  Frontend: http://localhost:5173"
Write-Host "  Backend:  http://localhost:8001"
Write-Host ""
Write-Host "Press Ctrl+C to stop."

$waitIds = @()
if ($backend) { $waitIds += $backend.Id }
if ($frontend) { $waitIds += $frontend.Id }

if ($waitIds.Count -eq 0) {
    Write-Host "Both servers appear to be already running. Open http://localhost:5173"
    exit 0
}

try {
    Wait-Process -Id $waitIds
} finally {
    if ($backend) { Stop-Process -Id $backend.Id -Force -ErrorAction SilentlyContinue }
    if ($frontend) { Stop-Process -Id $frontend.Id -Force -ErrorAction SilentlyContinue }
}
