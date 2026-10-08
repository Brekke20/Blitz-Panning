# Rapport-upload op de achtergrond — ontwerp

**Datum:** 2026-10-08
**Tak:** `main` (bugfix, live als **v1.10.2**), daarna `git merge main` in de refactor-worktree
**Status:** ontwerp goedgekeurd door Brent in chat (2026-10-08), spec ter review

## Probleem

Brent (2026-10-08): rapporten uploaden niet als het scherm vergrendeld is, en het uploaden is heel
traag.

Oorzaken (vastgesteld in de code op `main`, v1.10.1):

1. **De telefoon doet al het werk zelf, in vier opeenvolgende stappen** (`public/js/outbox.js`,
   `attemptOutboxItem`): archief-POST → archief-GET (check) → `/api/rapport` (PDF + Zoho-upload)
   → archief-POST (bevestiging). Zodra Android/iOS de app pauzeert (scherm op slot), stopt de keten.
2. **Het volledige rapport (HTML met ingebakken foto's en handtekeningen) wordt twee keer
   verstuurd**: één keer in `archiveBody.rapportData._html`, één keer als `html` naar `/api/rapport`.
3. **`/api/rapport` start bij elke koude start Chromium** (pack gedownload van GitHub) om de PDF
   te maken — tot ~26 s, en de telefoon wacht daar actief op.
4. **Alle rapporten (max. 500) staan in één blob `rapportlijst`**, inclusief `rapportData._html`
   met foto's. Elke archief-POST leest en herschrijft die volledige blob; het Rapporten-tabblad
   downloadt hem volledig. Dit wordt trager met elk rapport.

## Doel

- De technieker drukt "Verzenden"; binnen enkele seconden heeft de server het rapport. Daarna
  mag de app dicht/het scherm op slot — de server maakt de PDF en zet hem in Zoho.
- Op Android werkt ook die eerste korte overdracht verder bij vergrendeld scherm of gesloten app.
  Op iOS (toekomst) hervat ze bij het volgende openen van de app.
- Mislukt de server-verwerking definitief, dan zien technieker én coördinator dat.

## Niet in scope

- Logins/authenticatie (apart deelproject).
- Wijzigingen aan de rapportinhoud, de PDF-opmaak of `send-rapport.js` (manueel mailen naar klant),
  behalve dat `send-rapport` en het Rapporten-tabblad de HTML voortaan ook uit het aparte
  rapportbestand moeten kunnen lezen.

## Ontwerp

### Opslag (Netlify Blobs, store `blitz-data`, `consistency: 'strong'`)

| Key | Inhoud |
|---|---|
| `rapportlijst` | Zoals nu, maar entries bevatten **geen `rapportData._html` meer** (wel de rest van `rapportData`, nodig voor de TicketLog-export). Nieuw veld `verwerking` (zie hieronder). |
| `rapport-inhoud/<id>` | **Nieuw.** `{ id, html, aangemaakt }` — de volledige rapport-HTML met foto's, één blob per rapport. |
| `rapport-verzend-status` | Zoals nu (idempotentie-register van `rapport.js`), ongewijzigd. |

Nieuw veld op elke `rapportlijst`-entry:

```
verwerking: {
  status:    'wacht' | 'bezig' | 'in-zoho' | 'mislukt' | 'lokaal' | 'geannuleerd' | 'onbekend',
  pogingen:  number,
  volgendePoging: ISO-datum | null,   // vroegste tijdstip voor het vangnet
  laatsteFout:    string | null,
  bijgewerkt:     ISO-datum
}
```

- `lokaal` = rapport van een manueel toegevoegde afspraak zonder Zoho-ticket (nu `isLocal`):
  geen Zoho-stap.
- Entries zonder `verwerking` (oude rapporten) worden gelezen als
  `zohoUploaded ? 'in-zoho' : (geannuleerd ? 'geannuleerd' : 'onbekend')` — geen gedragswijziging
  voor het verleden; het vangnet pakt ze **niet** op voor Zoho-upload.

Het bestaande veld `zohoUploaded` blijft bestaan en wordt mee gezet (`true` bij `in-zoho`), zodat
de TicketLog-export en de huidige weergave blijven kloppen.

### Server — nieuwe en gewijzigde functies

**1. `POST /api/rapport-ontvangen`** (nieuw, gewone functie)

Body: `{ id, archiveBody, html, ticketId, filename, isLocal }` (id = het bestaande stabiele
`item.id` uit de outbox, een UUID).

Stappen:
1. Valideer (`id` UUID-vorm, `ticketId` enkel cijfers of leeg bij `isLocal`, `html` aanwezig,
   grootte begrensd).
2. Schrijf `rapport-inhoud/<id>` (eigen key → geen botsing met collega's).
3. Voeg de lichte entry toe aan / werk ze bij in `rapportlijst` met dezelfde dedup-regels als
   `rapport-archief.js` nu (ticketId + datum), status `wacht` (of `lokaal`). Deze read-modify-write
   gebruikt optimistische locking met retry (versie-check, max. 3 pogingen) — de blob is nu klein
   genoeg dat dit snel gaat.
4. **Idempotent:** een tweede POST met hetzelfde `id` overschrijft niets wat al `in-zoho` is en
   antwoordt gewoon `ok` (de telefoon kan een antwoord gemist hebben).
5. Start de achtergrondtaak: `fetch` naar `/.netlify/functions/rapport-verwerk-background` met
   `{ id }` (fire-and-forget; Netlify antwoordt meteen 202).
6. Antwoord `200 { ok: true, id }`.

De bestaande logica uit `rapport-archief.js` (entry-opbouw, dedup, `bepaalDedupVelden`) wordt
naar een gedeelde module `netlify/lib/rapportlijst.js` verplaatst en door beide functies gebruikt.
`rapport-archief.js` blijft bestaan voor GET (lijst, `?id=`) en de huidige POST, zodat oudere
app-versies in de cache van een toestel tijdens de overgang blijven werken.

**2. `rapport-verwerk-background`** (nieuw, Netlify Background Function, tot 15 min)

1. Lees entry + `rapport-inhoud/<id>`. Staat de status al op `in-zoho`, `lokaal` of `geannuleerd`:
   stop.
2. Zet status `bezig` (+ `bijgewerkt`).
3. Maak de PDF en upload naar Zoho via de **bestaande** logica van `rapport.js` (PDF-generatie,
   Zoho-upload, idempotentie-register op `verzendId = id`). Die logica wordt uit de handler
   gehaald naar een herbruikbare functie; `/api/rapport` zelf blijft werken voor de overgang.
4. Succes → status `in-zoho`, `zohoUploaded: true`, `zohoAttachmentId`.
   Fout → `pogingen + 1`, `laatsteFout`, `volgendePoging` volgens het schema hieronder;
   na de 5e mislukte poging status `mislukt`.

**3. `rapport-vangnet`** (nieuw, Netlify Scheduled Function, elke 5 minuten)

- Zoek entries met status `wacht` waarvan `volgendePoging` verstreken is, of `bezig` die langer
  dan 20 minuten niet bijgewerkt zijn (vastgelopen taak). Start voor elk (max. 5 per run)
  de achtergrondtaak.
- **Terugvaloptie:** blijkt de Background Function niet beschikbaar op het abonnement (Netlify
  "Personal"; niet zwart op wit bevestigd), dan verwerkt het vangnet zelf maximaal 1 rapport per
  run binnen zijn tijdslimiet. Dit wordt bij de eerste live-proef vastgesteld (zie Testen).
- **Migratie oude rapporten:** per run verhuist het vangnet maximaal 20 oude entries met inline
  `rapportData._html` naar `rapport-inhoud/<id>` en verwijdert `_html` uit de lijst-entry. Na
  ±25 runs (~2 uur) is de lijst licht.

Herhaalschema (`volgendePoging` na poging n): 5 min, 15 min, 30 min, 1 u, 2 u → daarna `mislukt`.

**4. Lezers van `_html` aanpassen**

- Rapporten-tabblad (`public/js/rapport-archief.js`, rapport openen/herdrukken) en
  `send-rapport.js`-aanroep: als `rapportData._html` ontbreekt, de inhoud ophalen via
  `GET /api/rapport-archief?inhoud=<id>`.
- `GET /api/rapport-archief` (lijst) wordt daardoor licht.

**5. `POST /api/rapport-archief` met `opnieuw: <id>`** — "Opnieuw versturen"-knop: zet een
`mislukt`-entry terug op `wacht`, `pogingen: 0`, en start de achtergrondtaak.

### Client

**Outbox (`public/js/outbox.js`)** — de vier stappen worden er één:

- `nextOutboxAction(item)`: `'ontvangen'` zolang de server het item niet bevestigd heeft, anders
  `'done'`.
- Stap `ontvangen`: één `POST /api/rapport-ontvangen` met `{ id, archiveBody (zonder _html), html,
  ticketId, filename, isLocal }`. Bij `200` → item uit de IndexedDB-wachtrij verwijderen.
- Bestaande backoff, timeouts, "Opnieuw proberen" en de in-flight-guard blijven.
- **Annuleren** kan alleen zolang het item nog niet ontvangen is (het verdwijnt daarna uit de
  balk). De oude tekst over "blijft bewaard in het archief" vervalt.
- Items die bij de update nog in de oude toestand in IndexedDB staan (`archived: true`,
  `zohoUploaded: false`) gaan ook via `rapport-ontvangen` (idempotent op `id`) — niets gaat
  verloren.
- Stap-label in de balk: "Wordt verstuurd…".

**Android: Background Sync (`public/sw.js`)**

- Na `outboxAdd` registreert de app `registration.sync.register('rapport-outbox')` als de browser
  dit ondersteunt (`'sync' in ServiceWorkerRegistration.prototype`).
- De service worker handelt het `sync`-event af: leest de IndexedDB-wachtrij en doet zelf de
  `rapport-ontvangen`-POST per item; bij succes verwijdert hij het item. Faalt het, dan gooit hij
  een fout zodat de browser het later opnieuw probeert.
- De verzendlogica (één item → POST → verwijderen) komt in een klein gedeeld script
  (`public/js/outbox-verzend.js`) dat zowel de pagina als de service worker gebruikt
  (`importScripts`/module), zodat er geen twee versies van bestaan.
- Een guard voorkomt dat pagina en service worker hetzelfde item tegelijk sturen; dubbel sturen is
  bovendien onschadelijk dankzij de idempotente server.
- iOS/geen ondersteuning: gedrag zoals nu (hervatten bij openen).
- Het commentaar in `sw.js` over het bewust niet gebruiken van Background Sync wordt bijgewerkt.
- `CACHE_NAME` ophogen (release op `main`).

**Rapporten-tabblad**

- Badge per rapport volgens `verwerking.status`: *In verwerking* (wacht/bezig), *In Zoho*,
  *Mislukt* (rood, met `laatsteFout` als tooltip en knop **Opnieuw versturen**), *Lokaal*.

**Melding aan de technieker**

- Bij het openen van de app haalt de client de lijst op (gebeurt al voor het archief) en toont
  één melding als er rapporten van deze technieker (`technieker`-veld) op `mislukt` staan die hij
  nog niet gezien heeft: "Rapport #1234 kon niet naar Zoho. Je hoeft niets opnieuw in te vullen;
  kantoor is verwittigd." "Gezien" wordt lokaal (localStorage, per rapport-id) bijgehouden.

## Foutafhandeling (samengevat)

| Situatie | Gevolg |
|---|---|
| Geen netwerk bij verzenden | Blijft in toestel-wachtrij; Android verstuurt zelf zodra er netwerk is, iOS bij heropenen. |
| Telefoon mist het antwoord van de server | Volgende poging is idempotent (zelfde `id`) → geen dubbel rapport. |
| Zoho/PDF tijdelijk stuk | Server probeert 5× opnieuw over ~4 uur. |
| Na 5 pogingen nog stuk | Status `mislukt`: rood in Rapporten-tabblad met knop, melding bij technieker. |
| Achtergrondtaak sterft halverwege | Vangnet ziet `bezig` > 20 min en start opnieuw; register voorkomt dubbele PDF. |
| Background Functions niet beschikbaar | Vangnet verwerkt zelf (trager, max. ~5 min vertraging). |

## Testen

1. **Automatisch** (`tests/*.test.mjs`, zoals de bestaande tests): pure logica voor
   status-overgangen, herhaalschema, idempotentie van `rapport-ontvangen`, dedup, migratie van
   oude entries, lezen van oude entries zonder `verwerking`.
2. **Testmodus (`?test`, lokale dev-server):** volledige flow; verzending onderbroken (netwerk uit
   in DevTools) en hervat; "Opnieuw versturen" op een gesimuleerde `mislukt`; oude
   IndexedDB-items van vóór de update.
3. **Live-proef met Brent (vóór de technici het gebruiken):** één rapport op een testticket,
   scherm meteen vergrendeld; nakijken dat de PDF in Zoho staat en dat het rapport op *In Zoho*
   komt. Hier wordt ook vastgesteld of Background Functions werken op het abonnement.
   Push naar `main` pas na akkoord van Brent.

## Release

- `package.json` → **1.10.2**, `CHANGELOG.md` (Fixed), `CACHE_NAME` in `public/sw.js` ophogen,
  git-tag `v1.10.2`.
- `netlify.toml`: config voor de scheduled function (`schedule = "*/5 * * * *"`).
- Daarna `git merge main` in `.claude/worktrees/planner-brein` (refactor-tak) en noteren in de
  ledger. De refactor-tak heeft een andere modulestructuur (`public/js/kern/…`); conflicten in
  `outbox.js` worden daar opgelost.
