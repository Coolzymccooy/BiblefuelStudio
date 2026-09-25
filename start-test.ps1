# Local smoke-test launcher - single terminal, single URL.
#
# Runs Biblefuel in production-style mode: the Express server serves the
# prebuilt client bundle out of server/public/, on port 5174.
#
# No vite dev server, no proxy, no HMR - closer to how Coolify runs in prod,
# which is what you actually want to smoke-test against.
#
# Usage from this worktree root:
#   .\start-test.ps1
#
# To stop: Ctrl-C in this terminal.

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

# Ensure the prebuilt client is in place. server/public/index.html is what
# the Express static handler serves at /.
if (-not (Test-Path "$root\server\public\index.html")) {
    Write-Host "Client build missing - running 'npm run build' once..."
    if (-not (Test-Path "$root\client\node_modules")) {
        Push-Location "$root\client"
        npm install
        Pop-Location
    }
    Push-Location "$root\client"
    npm run build
    Pop-Location
}

Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host " Open: http://localhost:5174" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host " Test plan: docs/superpowers/test-plans/2026-05-27-merge-smoke-test.md"
Write-Host " Press Ctrl-C to stop the server"
Write-Host ""

Push-Location "$root\server"
node index.js
Pop-Location
