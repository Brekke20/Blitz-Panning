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
git commit -m "fix: timezone bug (toISOString→localISO), tickets per status ophalen; feat: Zoho status writeback, kalender tab, eigenaar filter, auto-plan, tijdsblokkering

- Nieuwe Netlify function /api/plan: PATCH Zoho status + dueDate bij in/uit planning zetten
- Correcte Zoho statussen: Service in te plannen / Wachten op bevestiging planning / Geplande service
- tickets.js geeft 3 arrays terug (tickets, pendingTickets, plannedTickets)
- Zoho als source of truth bij laden: pending tickets seeden planning via dueDate
- Optimistische UI updates met rollback bij API fout + race condition guard
- Pending tickets zonder dueDate getoond in aparte waarschuwingssectie
- Visueel onderscheid pending (oranje) vs bevestigd (groen) op kalender
- TEST_MODE via ?test URL param: dummy data, geen API calls
- Auto-plan met TomTom reistijd, capaciteitsberekening, regio-clustering
- 15-minuten tijdsblokkering via click+drag op dagrooster
- Dagcapaciteit indicator + overduemarkering
- Fix: dubbele event handler op blokknop verwijderd"
git push origin main

Write-Host ""
Write-Host "Klaar! Netlify deployt automatisch." -ForegroundColor Green
Write-Host "Druk Enter om te sluiten..."
Read-Host
