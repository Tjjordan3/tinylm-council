$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Start-Backend {
    if (Get-Command uv -ErrorAction SilentlyContinue) {
        return Start-Process -FilePath "uv" -ArgumentList "run", "python", "-m", "backend.main" -PassThru -NoNewWindow
    }
    return Start-Process -FilePath "python" -ArgumentList "-m", "backend.main" -PassThru -NoNewWindow
}

Write-Host "Starting TinyLM Council backend..."
$backend = Start-Backend

Start-Sleep -Seconds 2

Write-Host "Starting TinyLM Council frontend..."
$frontend = Start-Process -FilePath "npm" -ArgumentList "run", "dev" -WorkingDirectory "$PSScriptRoot\frontend" -PassThru -NoNewWindow

Write-Host ""
Write-Host "TinyLM Council is starting:"
Write-Host "  Frontend: http://localhost:5173"
Write-Host "  Backend:  http://localhost:8001"
Write-Host ""
Write-Host "Press Ctrl+C to stop."

try {
    Wait-Process -Id $backend.Id, $frontend.Id
} finally {
    Stop-Process -Id $backend.Id -Force -ErrorAction SilentlyContinue
    Stop-Process -Id $frontend.Id -Force -ErrorAction SilentlyContinue
}
