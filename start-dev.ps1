# start-dev.ps1 — start de lokale dev server
Set-Location $PSScriptRoot
Write-Host "Dev server starten op http://localhost:3333 ..." -ForegroundColor Cyan
node dev-server.mjs
