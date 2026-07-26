# Onboarding — Blitz Planning

Dit document geeft je alle context om verder te werken aan Blitz Planning. Lees het volledig voor je iets doet. Dit vervangt `voor-claude-code.md` (verouderd — Bug #24 daarin is al lang gefixt en de architectuur is intussen op meerdere punten veranderd).

---

## Wie is de gebruiker

**Brent Calaerts** — Product Expert & Service Coordinator bij Blitz Power.
- Beheert de service-afdeling: AC EV-laadinfrastructuur, OCPP-protocollen, Phoenix Contact CHARX SEC-3000/3100 controllers.
- Technische achtergrond (field service), denkt vanuit praktijkervaring, niet vanuit abstracte software-architectuur.
- Bouwt in eigen tijd ook **Voltara** — een diagnostisch platform voor CHARX-controllers (apart project).

**Communicatiestijl:** antwoord standaard in het **Nederlands**, ook zonder dat erom gevraagd wordt — dit is al meermaals expliciet gecorrigeerd. Direct, geen opvulzinnen, technisch waar het moet.

**Vaste afspraak:** nooit pushen naar `origin/main` (of om het even welke remote branch) zonder telkens opnieuw expliciete bevestiging ("ja, push maar" of gelijkaardig) — ook al is er eerder in hetzelfde gesprek al eens bevestigd. Lokaal committen/mergen mag zonder te vragen.

---

## Wat is dit project

Interne planningstool voor het serviceteam van Blitz Power. Live op **https://blitz-planning.netlify.app**.

### Stack
- **Single-file PWA**: `public/index.html` (~5700+ regels — alle HTML/CSS/JS embedded, geen build step, geen bundler).
- **Backend**: Netlify Functions in `netlify/functions/` (ES modules). Twee stijlen komen naast elkaar voor: "classic" `export async function handler(event)` (werkt lokaal via `dev-server.mjs`) en Netlify Functions v2 `export default async (req) => ...` (draait **niet** lokaal via `dev-server.mjs` — enkel in productie; bv. `klantbeschikbaarheid.js`, `plan-datum.js`, `afspraken.js`, `availability.js`, `prijzen.js`, `rapport-archief.js`).
- **Dataopslag**: Netlify Blobs (`blitz-data` store, `consistency:'strong'`).
- **APIs**: TomTom (geocoding + routing), Zoho Desk EU (`https://desk.zoho.eu/api/v1`).
- **Repo**: https://github.com/Brekke20/Blitz-Panning

### Wat de tool doet
- Haalt open tickets op uit Zoho Desk.
- Plant interventies in op een weekkalender (per technieker of "alle technici" gecombineerd).
- Stuurt afspraakvoorstellen naar klanten via Zoho Desk `sendReply`, met de service-voorwaarden-PDF als bijlage.
- Berekent en optimaliseert routes via TomTom, per technieker.
- Genereert een service-rapport (PDF, meerdere pagina's mogelijk) en archiveert dat automatisch als bijlage op het Zoho-ticket.
- Beheert manuele afspraken ("lokale events"/installaties) en klantbeschikbaarheid.
- Op mobiel/tablet (<1024px): enkel Kalender + Ingepland + on-site acties (bellen, navigeren, foto's, rapport) — plannen/route/instellingen gebeurt op desktop.

---

## Wat er dit gesprek gebeurd is (chronologisch, hoog niveau)

1. **Bug: `dueDate`-schrijffout (422 INVALID_DATA)** — een regressie had de ISO8601-Z-suffix uit `dueDate` gehaald om een cosmetisch tijdzoneverschil te "fixen", waardoor Zoho élke inplanning weigerde. Root cause gevonden, maar tijdens het onderzoek besliste Brent iets fundamentelers: **volledig overstappen van Zoho's native `dueDate` naar een eigen custom field `cf_interventie_datm`** ("Interventie Datum", Date/Time-veld), om conflicten met Zoho-automatiseringsregels op `dueDate` te vermijden. Uitgevoerd als volledige hernoeming (backend + client): `dueDate` → `interventieDatum` overal in de app. Live geverifieerd op test-ticket #3731 (inplannen + leegmaken, beide bevestigd correct in Zoho zelf).
2. **PDF-bijlage bij het afspraakvoorstel** — `SERVICE VOORWAARDEN BLITZ POWER BV.pdf` wordt nu meegestuurd bij elke voorstel-mail, en de mailtekst vraagt voortaan expliciet om bevestiging van de datum (niet enkel reageren bij onbeschikbaarheid). Kostte drie live-test-rondes om de juiste Zoho-mechaniek te vinden: **niet** `/tickets/{id}/attachments` (dat is voor ticket-bijlagen, zoals `rapport.js` al gebruikt — `sendReply` neemt die attachments nooit mee in de mail, ongeacht `isPublic`), wel het generieke **`/uploads`-endpoint**, wat een OAuth-scope-uitbreiding vereiste (zie hieronder).
3. **Bugfix: routeplanner/kaart/optimalisatie/"Leeg"-knop hielden geen rekening met de technieker-filter** — vier functies (`calculateRoute`, `updateMap`, `optimizeRoute`, `clearDay`) gebruikten het ongefilterde `planning[date]` in plaats van te filteren op `activeAssigneeFilter`, zoals de rest van de Route-tab al wel deed. Gevolg: bij een geselecteerde technieker werden toch de stops van collega's meegenomen in route/kaart/optimalisatie, en zelfs verwijderd bij "Leeg". Alle vier gefixt; `optimizeRoute`/`clearDay` laten nu expliciet de stops van andere technici ongemoeid.
4. **Rapport-paginering** — het service-rapport (PDF) knipte secties soms af midden in de tekst bij een pagina-einde. Korte secties (omschrijving, acties, oorzaak, status, varia, handtekeningen, klantgegevens) krijgen nu `break-inside:avoid`. Lange secties (foto's, onderdelen/loonkosten-tabellen) mogen over pagina's lopen, maar breken netjes tussen individuele items/rijen (nooit mid-item), met herhalende tabelkoppen. Paginanummers toegevoegd aan de puppeteer/Zoho-gearchiveerde kopie — **nog niet live geverifieerd op een echte deploy** (lokale dev-omgeving geeft een "protocol mismatch"-fout bij élke `page.pdf()`-aanroep, ook met de ongewijzigde originele code — een lokale Puppeteer/Chromium-versie-mismatch, los van deze wijziging).

Alles hierboven zit in `main`, gepusht naar `origin/main`.

---

## Belangrijk: Zoho OAuth-scope is uitgebreid

De `ZOHO_REFRESH_TOKEN` moest opnieuw geautoriseerd worden (Self Client-flow, `api-console.zoho.eu`) met scope **`Desk.tickets.ALL,Desk.basic.ALL,Desk.settings.ALL`** — nodig voor het generieke `/uploads`-endpoint (`Desk.basic.CREATE`), dat de oude scope niet had. De nieuwe token staat in `.env.local` (lokaal) en in Netlify's environment variables (productie) — **niet** in `.env.local.example` (zie beveiligingspunt hieronder, dat bestand moet sowieso herschreven worden).

Als een toekomstige Zoho-API-aanroep een `SCOPE_MISMATCH`-fout geeft: waarschijnlijk ontbreekt de benodigde scope in deze grant. Zelfde procedure herhalen: nieuwe code genereren in de API-console, inwisselen via `POST https://accounts.zoho.eu/oauth/v2/token` met `grant_type=authorization_code`.

---

## Datamodel — belangrijkste velden

- `t.interventieDatum` (client) / `cf.cf_interventie_datm` (Zoho) — de geplande interventie-datum/-tijd. **Niet** `dueDate` gebruiken — dat wordt nergens meer gelezen of geschreven.
- `planning[date][]` — geplande stops per dag: `{ticket, address, uur}`. Route-gerelateerde functies (`calculateRoute`, `updateMap`, `optimizeRoute`, `clearDay`, `renderRouteList`, `updateRouteBtns`) moeten **altijd** filteren op `activeAssigneeFilter` (zie punt 3 hierboven — dit werd 4x vergeten en dus 4x gefixt).
- `activeAssigneeFilter` — `'all'` of een technieker-naam; bepaalt wiens stops getoond/bewerkt worden.
- `localEvents[]` — manuele afspraken/installaties: `{id, titel, datum, uur, einduur, type, persoon, adres, notitie, telefoon, email, bron}`.
- `R` — het service-rapport data-object (wizard-state), zie `buildRapportHtml()` in `index.html` voor de volledige vorm.

---

## Netlify Functions overzicht

| Functie | Stijl | Doel |
|---|---|---|
| `tickets.js` | classic | Haalt tickets op, leest `interventieDatum` uit `cf.cf_interventie_datm` |
| `plan.js` | classic | Zet/haalt ticket op planning (status + `cf_interventie_datm`) |
| `plan-datum.js` | v2 | Slaat geplande datum op (los van voorstel-mail) |
| `propose.js` | classic | Verstuurt afspraakvoorstel (+ PDF-bijlage via `/uploads`) + PATCH Zoho-status |
| `rapport.js` | classic | Genereert service-rapport-PDF via puppeteer, uploadt als ticket-attachment |
| `route.js` | ? | TomTom routeberekening |
| `optimize.js` | ? | TomTom geocoding |
| `fotos.js` | v2 | Foto's per ticket (eigen blob-key per ticket, niet gedeeld) |
| `klantbeschikbaarheid.js`, `afspraken.js`, `availability.js`, `prijzen.js`, `rapport-archief.js` | v2 | Draaien niet lokaal via `dev-server.mjs` |
| `debug-*.js` (4 stuks) | — | **Onbeveiligd, zie hieronder** |

---

## Bekende beveiligingsproblemen — nog niet aangepakt

Deze zijn al meermaals gesignaleerd maar bewust nog niet opgelost (vereist Brents beslissing/actie, niet zomaar zelf oplossen):

1. **`.env.local.example` bevat echte, werkende secrets** — `ZOHO_CLIENT_ID`/`ZOHO_CLIENT_SECRET` zijn de huidige, live waarden; `ZOHO_REFRESH_TOKEN` is een oudere (intussen vervangen) token, maar client-ID/secret zijn nog steeds actief. Moet herschreven worden naar placeholders, en de client-secret zou eigenlijk geroteerd moeten worden aangezien hij ooit in git-historie heeft gestaan.
2. **4 onbeveiligde debug-endpoints** (`netlify/functions/debug-*.js`): `debug-zoho.js` PATCHt bij elke GET een hardcoded prod-ticket (channel→EMAIL) als bijwerking; `debug-ticket.js` lekt volledige ticket-PII voor eender welk geraden ID; `debug-agents.js`/`debug-list.js` lekken org-data. Geen van alle heeft authenticatie.
3. **`prijzen.js`'s doc-comment claimt een `Authorization: Bearer <ADMIN_TOKEN>`-check** die niet in de code bestaat — de prijslijst is volledig open voor wie kan POSTen naar `/api/prijzen`.
4. **CORS-allowlists** in `afspraken.js`/`availability.js`/`klantbeschikbaarheid.js`/`rapport-archief.js` verwijzen naar `blitz-power.netlify.app` i.p.v. het echte `blitz-planning.netlify.app` — latent, breekt niks in same-origin productiegebruik.

---

## Conventies & workflow

- **Taal:** UI en communicatie in het Nederlands. Commits mogen Nederlands of Engels zijn (dit gesprek: overwegend Nederlands).
- **Geen externe CSS-frameworks** — alles inline in `index.html`.
- **Excel-exports:** ExcelJS (niet SheetJS — die negeert `.s` style property zonder foutmelding).
- **Geen testframework** — verificatie gebeurt via sandboxed Node-scripts (gemockte `fetch`) voor backend, en via de browser (`?test`-modus, `getComputedStyle`, console-check) voor de client.
- **Ontwikkelworkflow** (herhaaldelijk toegepast dit gesprek): brainstormen → spec in `docs/superpowers/specs/` → implementatieplan in `docs/superpowers/plans/` → uitvoeren (ofwel subagent-driven in een geïsoleerde git-worktree, ofwel inline in de huidige sessie) → eindreview → mergen naar lokale `main` → **expliciete bevestiging vragen** → pushen.
- **Git-worktrees:** telkens gebruikt voor isolatie tijdens implementatie. Bekende eigenaardigheid: een verse worktree (`EnterWorktree`) vertrekt vanaf `origin/main`, dus lokale (nog niet gepushte) commits op `main` moeten met `git cherry-pick` meegenomen worden. `node_modules` en `.env.local` worden niet automatisch meegekopieerd naar een worktree — indien nodig zelf kopiëren (of een junction/symlink maken voor `node_modules`).
- **Live-testen tegen Zoho:** waar mogelijk test-ticket **#3731** (intern ID `157486000011122009`, subject "test") gebruiken — door Brent aangemaakt specifiek voor dit soort testen.

---

## Openstaande punten

- **Rapport-paginanummers live verifiëren** — genereer een echt service-rapport met genoeg inhoud (meerdere foto's, lange tekst, wat onderdelen) op de live site na deploy, en controleer dat de PDF er professioneel uitziet (geen mid-sectie-afkap, correcte paginanummers "Pagina X van Y").
- **Beveiligingsproblemen hierboven** — wachten op Brents beslissing (secrets-rotatie blijft sowieso een losse, manuele actie — zie hieronder).
- **Bugfix-roadmap uitgevoerd en gemerged (2026-07-25/26)** — alle 26 taken uit [`docs/superpowers/plans/2026-07-25-bug-fix-roadmap.md`](docs/superpowers/plans/2026-07-25-bug-fix-roadmap.md) zijn geïmplementeerd, individueel gereviewd, en door een finale whole-branch review + één fix-wave gehaald. Gemerged naar `main`. Volledig verloop (elke commit, elke review, elke fix-ronde) staat in `.claude/worktrees/bug-fix-roadmap/.superpowers/sdd/2026-07-25-bug-fix-roadmap/progress.md`.
  - **Opgeloste kritieke bevindingen:** rapport.js SSRF (netwerktoegang geblokkeerd in de PDF-render), path traversal via ticketId (5 bestanden), propose.js open mail-relay (recipient nu gevalideerd tegen het echte ticket), 4 debug-endpoints verwijderd, CORS-domein gefixt, prijzen.js/rapport-archief.js optimistic-locking, XSS-sweep op ticketvelden (meerdere rondes, incl. de resterende inline-onclick-injectiesites — C1-vervolg is ook afgerond), route-leg-index/aanrijtijd/facturatie-bugs, feestdagen in autoplan, wizard-focus/handtekening-bugs, en meer — zie het rapport/de ledger voor het volledige overzicht.
  - **Secrets-rotatie**: Zoho client-ID/secret/refresh-token zijn geroteerd en overal bijgewerkt (lokaal + Netlify), live bevestigd werkend. **TomTom-key nog niet geroteerd** — bewust uitgesteld door Brent, oppikken wanneer het uitkomt.
  - **Nog te beslissen:** moet TicketLog's "Bedrag EUR"-kolom ook de loonkost meetellen, of enkel onderdelen (huidige, nu consistente gedrag)?
- Origineel audit-rapport: [`docs/reviews/bug-audit-2026-07-25.md`](docs/reviews/bug-audit-2026-07-25.md). Kritiekste bevindingen die de aanleiding vormden voor de roadmap hierboven:
  - `rapport.js`: onbeveiligde SSRF via `page.setContent(html)` op ongevalideerde input (geen auth, CORS `*`).
  - Path traversal via ongevalideerde `ticketId` naar de Zoho Desk API (`rapport.js`, `plan.js`, `plan-datum.js`, `comment.js`, `propose.js`, `debug-ticket.js`).
  - `propose.js` is een onbeveiligde open mail-relay met HTML-injectie (phishing-risico vanaf jullie geverifieerde support-adres).
  - `prijzen.js`: kapotte optimistic-locking (`<` i.p.v. `!==`) — gelijktijdig opslaan overschrijft elkaar stil en corrumpeert de back-up-keten.
  - `rapport-archief.js`: geen optimistic-locking (in tegenstelling tot de andere blob-endpoints) — gelijktijdige rapport-saves kunnen elkaar overschrijven.
  - `showToast()` bestaat nergens — "Prijzen opslaan" crasht altijd met een `ReferenceError`.
  - `buildRapportHtml`: `R.probleem/acties/adres/serienummer/varia` niet ge-escaped (foto's wel) — XSS-risico + kan rapport-secties laten verdwijnen.
  - Route-leg-index-bug (`legs[i-1]` i.p.v. juiste leg) — foute rijtijd-weergave én foute aanrijtijd/facturatie op het rapport; plus een 5e variant van de eerder gefixte "vergeet `activeAssigneeFilter`"-bug (drag & drop in de routelijst).
  - Plus ~20 medium-bugs (feestdagen genegeerd bij autoplan, wizard-inputs verliezen focus, handtekeningen verdwijnen bij terugnavigeren, 3 tegenstrijdige "totaal onderdelen"-berekeningen, TicketLog niet bruikbaar als facturatiebasis, ...) — zie het rapport voor volledige details met bestand:regel.
- **Frontend-refactor (`public/index.html` opsplitsen)** — besproken, niet dringend. Zou op termijn (via native ES-modules, geen bundler nodig, blijft dus binnen de "geen build step"-conventie) kunnen helpen om herhaalde patroonfouten te vermijden (bv. het `activeAssigneeFilter`-probleem dat al 5x apart moest gefixt worden), maar is een niet-triviale ingreep met regressierisico op een live tool. Pas oppakken als apart project, na de kritieke bugs hierboven.
- Verder werk: geen specifieke openstaande feature-requests op moment van schrijven — check bij Brent wat de volgende prioriteit is.
