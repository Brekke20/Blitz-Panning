# Blitz Planning — Setup gids

## 1. TomTom API key
1. Ga naar https://developer.tomtom.com
2. Maak een gratis account
3. Dashboard → Keys → "Add a new key" → naam: `blitz-planning`
4. Kopieer de key — sla hem op, je hebt hem nodig bij stap 4

## 2. GitHub repo aanmaken
1. Ga naar https://github.com/new
2. Naam: `blitz-planning` (privé is prima)
3. **Niet** initialiseren met README
4. Kopieer de repo URL (bv. `https://github.com/JOUW_NAAM/blitz-planning.git`)

## 3. Code pushen naar GitHub
Open PowerShell in de map `C:\Users\brent\Claude\Projects\Assistent Blitz\blitz-planning\`:
```powershell
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/JOUW_NAAM/blitz-planning.git
git push -u origin main
```

## 4. Netlify deployen
1. Ga naar https://app.netlify.com
2. "Add new site" → "Import an existing project" → GitHub
3. Selecteer de `blitz-planning` repo
4. Build settings worden automatisch gelezen uit `netlify.toml`
5. Klik "Deploy site"

## 5. Environment variabelen instellen
In Netlify: Site → Site configuration → Environment variables → Add variable:

| Key | Waarde |
|-----|--------|
| `ZOHO_CLIENT_ID` | `1000.4K790F00W225DTDPCTITQQTSZSWF2S` |
| `ZOHO_CLIENT_SECRET` | (zie Zoho API Console → Self Client → Client Secret) |
| `TOMTOM_API_KEY` | (van stap 1) |

Klik "Save" → "Trigger deploy" → wacht tot deployed.

## 6. Zoho refresh token genereren
1. Ga naar https://api-console.zoho.eu
2. Klik op "Self Client" → "Generate Code"
3. Scope: `Desk.tickets.READ,Desk.contacts.READ,Desk.basic.READ,Desk.accounts.READ`
4. Duration: 10 minutes
5. Klik CREATE → selecteer "Blitz Power" → CREATE
6. Kopieer de gegenereerde code

7. Ga onmiddellijk (binnen 10 minuten) naar:
   ```
   https://JOUW-SITE.netlify.app/api/setup?code=JOUW_GRANT_CODE
   ```
8. De pagina toont je `refresh_token`

9. Terug naar Netlify → Environment variables → voeg toe:
   | `ZOHO_REFRESH_TOKEN` | (de refresh_token van stap 8) |

10. Trigger nieuwe deploy → klaar!

## 7. App installeren op Android
1. Open de app URL in Chrome op je Android
2. Menu → "Toevoegen aan startscherm"
3. App werkt nu als native app, ook op 4G

## Klaar 🎉
- **Desktop**: open de URL in Chrome voor planning
- **Mobiel**: gebruik de geïnstalleerde PWA voor navigatie
