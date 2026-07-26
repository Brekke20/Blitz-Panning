# Instructies voor Claude Code — Blitz Planning project

Dit document geeft je alle context die je nodig hebt om verder te werken aan het Blitz Planning project. Lees het volledig voor je iets doet.

---

## Wie is de gebruiker

**Brent Calaerts** — Product Expert & Service Coordinator bij Blitz Power.
- Beheert de service-afdeling: AC EV-laadinfrastructuur, OCPP-protocollen, Phoenix Contact CHARX SEC-3000/3100 controllers
- Ticketing via Zoho Desk
- Technische achtergrond (field service), denkt vanuit praktijkervaring
- Bouwt in eigen tijd ook **Voltara** — een diagnostisch platform voor CHARX-controllers (apart project)

**Communicatiestijl:** Nederlands, direct, geen opvulzinnen. Technisch waar het moet.

---

## Wat is dit project

Een interne planningstool voor het serviceteam van Blitz Power. Draait op: **https://blitz-planning.netlify.app**

### Stack
- **Single-file PWA**: `public/index.html` (~5600+ regels, alles embedded — CSS, HTML, JS)
- **Backend**: Netlify Functions in `netlify/functions/` (ES modules)
- **Dataopslag**: Netlify Blobs (`blitz-data` store, `consistency: 'strong'`)
- **APIs**: TomTom (geocoding + routing), Zoho Desk EU
- **Repo**: https://github.com/Brekke20/Blitz-Panning

### Wat de tool doet
- Haalt open tickets op uit Zoho Desk
- Plant interventies in op een weekkalender
- Stuurt afspraakvoorstellen naar klanten via Zoho Desk sendReply
- Berekent routes via TomTom
- Beheert manuele afspraken en verlof

---

## API keys & services

### Wat lokaal NIET nodig is
Alle secrets zitten in Netlify environment variables — je hoeft ze niet lokaal te hebben:
- `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN` — Zoho Desk OAuth
- `ZOHO_FROM_EMAIL` — afzenderadres voor klantmails
- `TOMTOM_API_KEY` — geocoding en routering
- Netlify Blobs — automatisch beschikbaar in Netlify Functions

### GitHub
- Repo: https://github.com/Brekke20/Blitz-Panning
- Als Brent je een GitHub Personal Access Token geeft, configureer dan `.claude.json`:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@github/mcp-server"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "<TOKEN_HIER>"
      }
    }
  }
}
```
Sla dit op als `C:\Users\<user>\.claude.json`

### Netlify
- Site: blitz-planning
- Site ID: `fdc90d24-e5df-4898-9f7d-589aa23faeff`
- URL: https://blitz-planning.netlify.app
- Deploy: automatisch via GitHub push naar `main`
- Handmatig deployen kan via Netlify CLI: `npx netlify-cli deploy --prod --dir=public`

---

## Architectuur — belangrijke details

### Frontend (public/index.html)
- Alles in één bestand — geen build step, geen bundler
- `planning[date][]` — geplande stops per dag: `{ticket, address, uur}`
- `localEvents[]` — manuele afspraken: `{id, titel, datum, uur, einduur, type, persoon, adres, notitie, telefoon, email, bron}`
- `klantBeschikbaarheid` — `{ [ticketId]: { voorkeur, geblokkeerd[], notitie } }`
- `PRIO_WEIGHT` — `{high:1, medium:3, low:6, geen:9}` (lager = hogere prioriteit)
- `autoPlan()` — plant tickets automatisch in met geografisch algoritme + voorkeursdatum hard exclusion

### Netlify Functions (netlify/functions/)
| Functie | Doel |
|---|---|
| `tickets.js` | Haalt open tickets op uit Zoho Desk |
| `propose.js` | Stuurt afspraakvoorstel + PATCH Zoho status |
| `plan-datum.js` | Slaat geplande datum op per ticket |
| `klantbeschikbaarheid.js` | Beheert klantvoorkeur/blokkering |
| `afspraken.js` | Manuele afspraken opslaan/ophalen |
| `route.js` | TomTom routeberekening |
| `optimize.js` | TomTom geocoding |
| `rapport.js` | Servicerap portgeneratie |

### Zoho Desk
- EU datacenter: `https://desk.zoho.eu/api/v1`
- OAuth token refresh via `https://accounts.zoho.eu/oauth/v2/token`
- **Belangrijk**: `sendReply` zet automatisch de ticket status op "Wachten op klant". Daarom altijd sendReply VOOR de status-PATCH uitvoeren.
- Status flow: open → "Wachten op bevestiging planning" → "Wachten op bevestiging klant" → gesloten

### Excel exports
Gebruik **ExcelJS** (niet SheetJS). SheetJS community edition negeert `.s` style property zonder error.
```html
<script src="https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js"></script>
```

---

## Open bugs & taken

### Bug #24 — '+' knop wachtrij plant ticket niet in
**Symptoom:** Klikken op het '+' symbool naast een ticket op de wachtrij-pagina plant het ticket niet in.
**Vermoedelijke oorzaak:** Regressie door de autoPlan-refactor (prefDayAvailable / fillScore wijzigingen). Onderzoek de inline "plan dit ticket" functie die vanuit de wachtrij wordt aangeroepen — vermoedelijk `addTicketToDate` of een wrapper.

---

## Conventies

- Schrijf altijd in het **Nederlands** in de UI
- Geen externe CSS frameworks — alles inline in index.html
- Netlify Blobs key-namen: kebab-case (`blitz-data` store)
- Datumformat in de app: `YYYY-MM-DD` (ISO)
- Commits in het Engels (conventionele commits: `feat:`, `fix:`, `chore:`)
- Test altijd op de live site na deploy: https://blitz-planning.netlify.app

---

## Hoe deployen

```bash
# Gewoon pushen naar main — Netlify deployt automatisch
git add -A
git commit -m "feat: beschrijving"
git push origin main
```

Deploy duurt ~30 seconden. Check status op https://app.netlify.com/projects/blitz-planning

---

## Eerste stap die je moet doen

1. Lees `public/index.html` en `netlify/functions/` om de codebase te begrijpen
2. Fix Bug #24 ('+' knop wachtrij) — dit is de eerste prioriteit
3. Vraag Brent om bevestiging voor je iets deployt
