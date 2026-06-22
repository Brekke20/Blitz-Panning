# git-push.ps1 — commit en push naar GitHub
Set-Location $PSScriptRoot

# Verwijder alle git lock files
$locks = @(".git\index.lock", ".git\HEAD.lock", ".git\COMMIT_EDITMSG.lock")
foreach ($lock in $locks) {
    $path = Join-Path $PSScriptRoot $lock
    if (Test-Path $path) {
        Remove-Item $path -Force
        Write-Host "Lock verwijderd: $lock" -ForegroundColor Yellow
    }
}

git config user.email "brentcalaerts5@gmail.com"
git config user.name "Brent Calaerts"
git add .
git commit -m "fix: status filter tabs, oplossing veld, kalender view"
git push origin main

Write-Host ""
Write-Host "Klaar! Netlify deployt automatisch." -ForegroundColor Green
Write-Host "Druk Enter om te sluiten..."
Read-Host
