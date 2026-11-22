$ErrorActionPreference = "Stop"

$env:AURA_ENV = "local"
$env:AURA_STORE_MODE = "memory"
$env:ALLOW_DEMO_AUTH = "true"
$env:DEMO_STAFF_PASSCODE = "aura-local-staff-2026"
$env:ENABLE_LIVE_GEMINI = "false"
$env:ALLOWED_ORIGINS = "http://127.0.0.1:3000,http://localhost:3000"
$env:PLAYWRIGHT_BASE_URL = "http://127.0.0.1:3000"

$apiProc = $null
$webProc = $null

try {
    Write-Host "Starting AURA FastAPI backend on http://127.0.0.1:8080..."
    $apiProc = Start-Process -FilePath "api\.venv\Scripts\python.exe" `
        -ArgumentList "-m", "uvicorn", "app.main:app", "--app-dir", "api", "--host", "127.0.0.1", "--port", "8080" `
        -PassThru -NoNewWindow

    Write-Host "Starting static web server for web/out on http://127.0.0.1:3000..."
    $webProc = Start-Process -FilePath "api\.venv\Scripts\python.exe" `
        -ArgumentList "-m", "http.server", "3000", "--bind", "127.0.0.1", "--directory", "web\out" `
        -PassThru -NoNewWindow

    # Wait for API /health
    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
        try {
            $resp = Invoke-WebRequest -Uri "http://127.0.0.1:8080/health" -UseBasicParsing -TimeoutSec 2
            if ($resp.StatusCode -eq 200) {
                $ready = $true
                break
            }
        } catch {}
        Start-Sleep -Milliseconds 500
    }
    if (-not $ready) {
        throw "Backend failed to become healthy on port 8080"
    }
    Write-Host "Backend healthy! Running Playwright E2E suite..."

    Push-Location web
    try {
        npx playwright test
        $testExit = $LASTEXITCODE
    } finally {
        Pop-Location
    }

    if ($testExit -ne 0) {
        exit $testExit
    }
    Write-Host "ALL PLAYWRIGHT E2E TESTS PASSED!"
} finally {
    if ($apiProc -and -not $apiProc.HasExited) { Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue }
    if ($webProc -and -not $webProc.HasExited) { Stop-Process -Id $webProc.Id -Force -ErrorAction SilentlyContinue }
}
