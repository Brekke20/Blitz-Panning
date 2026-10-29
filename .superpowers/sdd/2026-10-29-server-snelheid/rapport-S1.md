# Rapport S1 (meten) + time-out tickets

Tak `f1-server`. Plan: `2026-10-29-server-snelheid.md` (S1, 1e, 6, 8); bindend: `...-review.md` (S1, sectie 4). Waar die verschillen, won de review.

## Wat er gebouwd is
- `netlify/lib/meting.js` (nieuw): `maakMeting` (`meet`, `tel`, `zoho`, `kop`, `logObject`, `sluit`), `huidigeMeting` via `AsyncLocalStorage`, `meetOptioneel`/`meetZoho` (gewone doorgave zonder meting), `startVerzoekMeting`, `draaiMetMeting`, testseam `zetMetingVoorTests` (gooit in een Netlify-runtime), `herstelKoudVoorTests`.
- `netlify/lib/beveiligd.js`: `beveiligV1`/`beveiligV2` draaien binnen een meting; `auth` rond enkel de echte `vereisGebruiker`-aanroep (dus niet bij 'open'-rijen, OPTIONS of 405), `kern` rond de functie, `totaal` rond alles.
- `netlify/lib/auth.js`: `blobs-auth` rond `getStore` + `leesGebruikers`.
- `netlify/lib/zoho.js`: token-, org- en gewone aanvragen via `meetZoho`.
- `netlify.toml`: `[functions.tickets] timeout = 20` + `tests/netlify-toml.test.mjs` (eigen mini-lezer, geen TOML-bibliotheek in het project).

## Beslissingen (waar plan en review samenkomen)
- Kop `Server-Timing` ENKEL op antwoorden voor een ingelogde gebruiker (`b.gebruiker` gezet), dus niet op 401/403/503/405, OPTIONS en 'open'-rijen (review M-S1-1; dit vervangt de zin in het plan "ook op een weigering en OPTIONS"). De logregel staat wel op elk verzoek, ook bij weigeringen en 'open'-rijen.
- `n` = ALLE Zoho-aanroepen van het verzoek (token en org-id inbegrepen), dus exact het aantal fetch-aanroepen naar Zoho (M-S1-2); `zoho` = som van de tijd tot de antwoordkop (de body telt niet mee, dus `kern - zoho` is niet enkel eigen rekenwerk); `max` = hoogste gelijktijdigheid binnen het verzoek; `zoho-token` = enkel de tokenaanvraag (0 bij cache). In de kop staan `zoho`/`zoho-token` alleen als er minstens een Zoho-aanroep was.
- Na review-minors: `n` telt gestarte Zoho-aanroepen en `zoho` enkel de aanroepen die vóór het antwoord klaar waren; `zohoRest` = laagste gezien bij gelijktijdige antwoorden, `zohoGewicht` = hoogste; een V1-antwoord met een statusCode die geen geheel getal 200-599 is, wordt als 500 gelogd (zoals alsV2 het naar de client stuurt); `totaal` van V1-functies sluit het bouwen van het event en de Response-omzetting door alsV2 uit (commentaar in `beveiligd.js`); de rechtenmatrix draait ook met de meting aan.
- Geplande en achtergrondfuncties (`rapport-vangnet`, `rapport-verwerk-background`, `activiteit-opruimen`, `sales-opruimen`) lopen NIET door `beveiligV1/V2`: ze loggen geen `[meting]`-regels, dus geen extra logvolume. Het logvolume blijft ~1000 regels per dag.
- Logregel: `[meting] {f,m,s,auth,blobsAuth,kern,zoho,zn,zohoToken,zohoMax,koud,regio,zohoRest,zohoGewicht,totaal}`. Aan het plan toegevoegd: `totaal`, `zohoMax`, `zohoGewicht` (X-Rate-Limit-Request-Weight-v3). Niet gemeten onderdelen zijn `null` (auth bij 'open', kern bij weigering). `f` komt uit de rechtentabelnaam, `m`/`regio` worden gefilterd (regex), limietkoppen enkel als 1-9 cijfers. Geen gebruikers-id, e-mail, cookie, querystring of ticketgegevens (string-scans in de tests).
- Actief enkel in een Netlify-runtime (`heeftNetlifyRuntime`) of via de seam; anders loopt de wrapper exact als voorheen (`startVerzoekMeting()` geeft `null`). Alle bestaande koppen-vergelijkende tests zijn ongewijzigd.
- Fouten in de meting (kapotte klok, gooiende `console.log`, onveranderlijke `Response.error()`-koppen) veranderen nooit het antwoord; een gooiende functie gooit dezelfde fout (en wordt gelogd met `s:null`).
- Stap 0 van S1 (statuscodes uit observability) stond al vastgelegd in `docs/server-snelheid/metingen-live-2026-10-29.md` (commit b437430); hier niets aan gedaan.
- Niet gedaan (buiten scope): S2/S3/S4, volgorde of gelijktijdigheid van Zoho-aanroepen, A1a, client, `CACHE_NAME`/versie. Logbewaring (M-S1-3) is een vraag voor Brent (Netlify-plan), geen code.

## Tests
- Nieuw: `tests/netlify-toml.test.mjs` (3), `tests/meting.test.mjs` (16), uitbreiding `tests/server-beveiliging.test.mjs` (+6, nu 128), `tests/server-tickets.test.mjs` (+3, nu 63).
- Volledige `node --test` (zonder pad): 3645 tests, 3645 geslaagd, 0 mislukt (na de review-minors; de rechtenmatrix draait nu twee keer per functie, ook met de meting aan). Geen bestaande test gewijzigd (alleen toevoegingen en importregels). Geen Playwright nodig (enkel serverbestanden).

## Commits
1. `008a28a` time-out 20 s + test
2. `146e2e1` meting.js + eenheidstests
3. `9c58b8c` wrapper + blobs-auth + wrappertests
4. `b897b67` zoho.js + tickets-tests

## Let op voor de reviewer
- `beveiligd.js`: `uitvoer` is de oude body; `async (event, context)` daarbuiten kiest tussen rechtstreeks `uitvoer` (meting uit) en `draaiMetMeting`. Controleer dat een weigering/405/OPTIONS er hetzelfde uitziet.
- V1-antwoord krijgt een KOPIE (`{...res, headers:{...}}`), V2 `headers.set` in try/catch; V1-handlers draaien in productie achter `alsV2`, dus de kop komt via de adapter op de `Response`.
- Na de release: in DevTools > Network > Timing staat "Server Timing" (strippen Netlify de kop, dan volstaan de `[meting]`-regels); `/api/tickets` heeft nu een time-out van 20 s i.p.v. het (vermoedelijke) standaard 10 s.
