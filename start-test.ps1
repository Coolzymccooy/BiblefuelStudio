# Local smoke-test launcher (PowerShell).
#
# Opens TWO terminals:
#   1. Server  on http://localhost:5051   (Express + jobs worker)
#   2. Client  on http://localhost:5174   (Vite dev with HMR, proxies /api to server)
#
# Usage from this worktree root:
#   .\start-test.ps1
#
# To stop: close both spawned windows.

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

if (-not (Test-Path "$root\server\.env")) {
    Write-Error "server/.env missing — run npm install once and add env first"
    exit 1
}

if (-not (Test-Path "$root\client\node_modules")) {
    Write-Host "Installing client deps..."
    Push-Location "$root\client"
    npm install
    Pop-Location
}

if (-not (Test-Path "$root\server\node_modules")) {
    Write-Host "Installing server deps..."
    Push-Location "$root\server"
    npm install
    Pop-Location
}

Write-Host "Starting server (port 5051) and client (port 5174)..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\server'; node index.js"
Start-Sleep -Seconds 2
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\client'; npx vite"

Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host " Open: http://localhost:5174" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host " Server API: http://localhost:5051"
Write-Host " Smoke test plan: docs/superpowers/test-plans/2026-05-27-merge-smoke-test.md"
