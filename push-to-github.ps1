# push-to-github.ps1
# Dubbelklik op dit bestand om de code naar GitHub te pushen
# Vereist: Git geinstalleerd + GitHub ingelogd

$ErrorActionPreference = "Stop"
$repoPath = $PSScriptRoot

Write-Host "Blitz Planning -> GitHub pushen..." -ForegroundColor Cyan
Set-Location $repoPath

# Verwijder oud .git als het er al is
if (Test-Path ".git") {
    Write-Host "Bestaand .git gevonden, wordt gereset..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force ".git"
}

git init
git add .
git commit -m "Initial commit: Blitz Planning App"
git branch -M main
git remote add origin https://github.com/Brekke20/Blitz-Panning.git
git push -u origin main --force

Write-Host ""
Write-Host "Klaar! Code staat nu op GitHub." -ForegroundColor Green
Write-Host "Druk op Enter om dit venster te sluiten..."
Read-Host
