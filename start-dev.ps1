# Local dev launcher - HMR + auto-restart, one command.
#
# Runs Biblefuel in split-process mode:
#   - Express API: http://localhost:5051   (node --watch, auto-restarts on .js change)
#   - Vite dev:    http://localhost:5174   (HMR, proxies /api and /outputs -> :5051)
#
# Why two ports? vite.config.ts pins Vite to 5174 with strictPort, and its
# proxy target defaults to localhost:5051. We override $env:PORT for the
# spawned server process only, so the on-disk .env (which sets PORT=5174
# for production-style single-process runs via start-test.ps1) is untouched.
#
# Open ONE URL: http://localhost:5174 - Vite serves the client and forwards
# every /api and /outputs request to the Express server.
#
# Usage from this worktree root:
#   .\start-dev.ps1
#
# To stop: Ctrl-C in this terminal. The companion server window closes
# automatically.

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

if (-not (Test-Path "$root\server\.env")) {
    Write-Error "server/.env missing"
    exit 1
}

if (-not (Test-Path "$root\server\node_modules")) {
    Write-Host "Installing server deps..."
    Push-Location "$root\server"
    npm install
    Pop-Location
}

if (-not (Test-Path "$root\client\node_modules")) {
    Write-Host "Installing client deps..."
    Push-Location "$root\client"
    npm install
    Pop-Location
}

# Launch the API server in a new window. We override PORT and CORS_ORIGIN
# inline so the dev session uses 5051 without editing .env.
$serverCmd = @"
`$Host.UI.RawUI.WindowTitle = 'Biblefuel API (dev) :5051'
Set-Location '$root\server'
`$env:PORT = '5051'
`$env:CORS_ORIGIN = 'http://localhost:5174'
Write-Host '==================================================' -ForegroundColor Cyan
Write-Host ' Biblefuel API on http://localhost:5051' -ForegroundColor Green
Write-Host ' (node --watch - restarts on .js change)' -ForegroundColor DarkGray
Write-Host '==================================================' -ForegroundColor Cyan
node --watch index.js
"@

$serverProc = Start-Process -FilePath "powershell.exe" `
    -ArgumentList @("-NoExit", "-NoProfile", "-Command", $serverCmd) `
    -PassThru

Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host " Open: http://localhost:5174" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host " API server window:    http://localhost:5051 (separate window)"
Write-Host " Vite dev (this win):  http://localhost:5174 (HMR enabled)"
Write-Host " Press Ctrl-C to stop both"
Write-Host ""

try {
    Push-Location "$root\client"
    npm run dev
} finally {
    Pop-Location
    if ($serverProc -and -not $serverProc.HasExited) {
        Write-Host "Stopping API server (PID $($serverProc.Id))..." -ForegroundColor Yellow
        try { Stop-Process -Id $serverProc.Id -Force -ErrorAction Stop } catch { }
    }
}
