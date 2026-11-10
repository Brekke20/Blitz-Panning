# Eindreview-fixes — feat/mcp-claude-lezen (2026-11-10)

Werktak: `feat/mcp-claude-lezen` (worktree `.claude/worktrees/mcp-claude-lezen`). Geen push, geen versie/CACHE_NAME-bump. Test-first: per punt eerst de falende test, dan de fix (uitzondering: T3 en de e2e van T6, zie onder).

## Per punt

**I1 — absolute vervaltijd 30 dagen**
- `netlify/lib/mcp-oauth.js:21-22` `eindVan`/`toegangVerlopen` (aangemaakt + REFRESH_TTL; onleesbaar `aangemaakt` = verlopen).
- `:84-85` refresh token `verlooptOp = min(nu + 30 d, aangemaakt + 30 d)`.
- `:124` `ververs`: verlopen (token of toegang) -> `trekIn` + invalid_grant. Toegang wordt eerst geladen, dan pas de vervalcontrole, zodat opruimen ook echt gebeurt. Een clientId-mismatch trekt NIET in (vreemde client).
- `:147` `zoekToegang`: toegang ouder dan 30 d -> access-blob weg, `trekIn`, null.
- Tests (`tests/mcp-oauth.test.mjs`): ververs dag 29 lukt + nieuw refresh vervalt op aangemaakt+30d; ververs dag 31 -> invalid_grant en toegangsrecord weg; access token uitgegeven 10 min vóór dag 30 is na dag 30 null (discriminerend: het token zelf is pas 10 min oud). HTTP: refresh na 30 d -> 400 invalid_grant (`tests/mcp-oauth-endpoints.test.mjs`). `tests/mcp-toegang.test.mjs`: toegang ouder dan 30 d -> 401.

**I2 — gebruikerscontrole bij verversen**
- Eén gedeelde functie `geldigeGebruiker(store, toegang)` in `netlify/lib/mcp-oauth.js:30` (actief === true, sessieVersie gelijk, rol in ROLLEN_LIJST, niet moetWachtwoordWijzigen). Staat in mcp-oauth.js zodat er geen importcyclus is; `netlify/lib/mcp-toegang.js` gebruikt dezelfde functie (de oude inline controle is weg).
- `ververs` (`:124`): ongeldig -> `trekIn` + invalid_grant. Een opslagfout bij het lezen van de gebruikers wordt NIET opgevangen (wordt 500 via de token-endpoint) en trekt niets in.
- `laatstGebruikt`: `zoekToegang` schrijft niets meer; nieuwe `markeerGebruikt` (`:158`) wordt door `vereisMcpGebruiker` pas na een geslaagde `geldigeGebruiker` aangeroepen.
- Tests: ververs na sessieVersie+1, deactivatie, moetWachtwoordWijzigen, ongeldige rol, verwijderde gebruiker -> invalid_grant, toegang weg, geen nieuwe tokens; opslagfout -> rejects en toegang blijft; andere client -> toegang blijft. HTTP-niveau: grant_type=refresh_token succes (200, nieuw refresh, scope lezen) en invalid_grant na deactivatie / wachtwoordwijziging (koppeling weg). `mcp-toegang.test.mjs`: geweigerde gebruiker schrijft geen `mcp-gebruikt-*`, geldige wel; `zoekToegang` alleen schrijft nooit `mcp-gebruikt-*`. De bestaande laatstGebruikt-tests zijn omgezet naar zoekToegang + markeerGebruikt; `opzet()` in mcp-oauth.test.mjs zaait nu gebruiker u1.

**I3a — testmodus**
- `netlify/lib/testmodus.js:15` `/^mcp-/` in NIET_KOPIEREN. Test in `tests/testmodus-auth.test.mjs` (client, code, acc, ref, toegang, gebruikt worden niet gekopieerd; wisTestopslag voor/na).

**I4 — batch**
- `netlify/functions/mcp.js:17` MAX_BATCH = 5; `:79` per verzoek `metLeesCache(store)`.
- `netlify/lib/mcp-data.js:27` `metLeesCache`: memoiseert (als promise) `get(..., {type:'json'})` van `rapportlijst` en `rapportlijst-archief-*` en `list({prefix: ARCHIEF_PREFIX})`; al het andere gaat ongewijzigd door. Per verzoek nieuw, nooit op moduleniveau; rechtenfilter blijft na de cache (in mcp-protocol.js).
- Tests (`tests/mcp-protocol.test.mjs`): batch van 6 -> -32600, batch van 5 -> 5 antwoorden; batch van 5 rapportgereedschappen leest `rapportlijst`, `-archief-2025` en `-archief-2026` elk één keer; een volgend verzoek leest opnieuw.

**I5 — planning_lezen**
- `netlify/lib/mcp-protocol.js:306` technieker: eigen naam OF (`soort === 'afspraak'` en geen persoon). Tickets zonder technieker blijven verborgen. Kopcommentaar en INSTRUCTIES aangepast.
- Test aangepast (t3, a1, t5, a3; a2/t4 van collega niet) + nieuwe test: afspraak met `persoon: ''` zichtbaar, ticket met lege assignee niet (planner ziet het wel).
- Zorg/afwijking: "Iedereen blokkeren" (beschikbaarheid, `scope: 'global'` in de availability-blob) en feestdagen (client-side berekend, `kern/feestdagen.js`) zitten helemaal niet in de afspraken-blob en dus niet in planning_lezen (ook niet voor de planner). De fix volgt de kalender (`kern/selecties.js:30`: afspraak zonder persoon = voor iedereen). Beschikbaarheid/feestdagen toevoegen zou een uitbreiding van het gereedschap zijn; niet gedaan.

**M2 — rapport_lezen volledig**
- `netlify/lib/mcp-data.js:126` `volledigRapport`: alle entry-velden + volledig `rapportData` via bestaande `stripZwareVelden` (rapportlijst.js, al geëxporteerd) plus het wegfilteren van elke andere `data:`-tekst (diep); de genormaliseerde vlakRapport-velden staan bovenaan (bestaande tests blijven werken). `mcp-protocol.js` rapportLezen gebruikt het; technieker-filter ongewijzigd.
- Test: installateur, facturatie, prioriteit, geneste velden aanwezig; `_html`, handtekeningen, `fotos` afwezig; geen `data:` in de JSON; rapport van collega blijft isError.

**M4** — `netlify/functions/mcp-oauth.js:106-107` commentaar: `form-action` ontbreekt bewust (zou de 302 naar claude.ai/localhost blokkeren).

**M5** — `netlify/lib/mcp-oauth.js:24,100` code_verifier 43–128 tekens uit `[A-Za-z0-9-._~]`, gecontroleerd na het verwijderen van de code (één poging blijft de code verbruiken). Tests: 42, 129, spatie, `+`, `é` met een challenge die er wél bij past -> invalid_grant en code weg; 43 en 128 met alle toegestane tekens werken.

**T3** — test in `tests/mcp-oauth-endpoints.test.mjs`: consentpagina tonen, daarna moetWachtwoordWijzigen zetten, POST Toestaan -> 403, geen Location, geen `mcp-code-*`. Was meteen groen (dekking, geen bug).

**T6** — `public/js/schermen/sales-instellingen.js:16` eigen id `sales-claude-blok`; `public/js/schermen/beheer-claude.js:21` teller per weergave: `bc-adres-N` / `bc-titel-N` voor input-id, label `for`, h2-id en `aria-labelledby`. `e2e/beheer-claude.spec.mjs`: hulp `controleerIds` (geen dubbele id's in het document, label/aria-labelledby wijzen naar het eigen blok) in beheertab, technieker- en sales-test; selectors `.bc-adres`, `#sales-claude-blok`. De e2e-test is vóór de fix geschreven maar niet apart rood gedraaid (zware run op een zwakke pc).

**CHANGELOG** — `[Unreleased]`-regel aangevuld: koppeling vervalt 30 dagen na het toestaan en meteen bij deactivatie of wachtwoordwijziging.

## Commits (b0d079c..HEAD)
- d378654 fix(mcp): absolute vervaltijd 30 dagen, gebruikerscontrole bij verversen, PKCE-verifier volgens RFC 7636 (I1, I2, M4, M5, T3)
- bfc439f fix(mcp): Claude-koppelingen (mcp-*) nooit naar de testopslag kopiëren (I3a)
- c205ca7 fix(mcp): batch hoogstens 5 berichten; rapportlijst en jaararchieven één keer per verzoek lezen (I4)
- f16184c fix(mcp): planning_lezen toont een technieker ook afspraken zonder persoon (I5)
- 941878a fix(mcp): rapport_lezen geeft het volledige rapport zonder foto's, handtekeningen en HTML (M2)
- f379d8a fix(mcp): unieke id's voor het Claude-blok (T6)
- (laatste) fix(mcp): CHANGELOG en eindreview-fixverslag

## Testuitvoer
- `node --test` (zonder pad): tests 3999, pass 3999, fail 0 (54 s).
- `npx playwright test e2e/beheer-claude.spec.mjs --project=chromium --workers=1`: 8 passed (26 s).

## Zorgen / afwijkingen
- Refresh-rotatie verbruikt het refresh token vóór de gebruikerscontrole (behoud van "werkt één keer"). Bij een tijdelijke opslagfout op de gebruikersblob krijgt Claude een 500 en is het refresh token weg: de gebruiker moet dan opnieuw koppelen (de toegang zelf wordt niet ingetrokken). Bewuste keuze tegenover een groter replay-venster.
- Bij een geweigerde gebruiker op het access-token-pad (vereisMcpGebruiker) wordt niet ingetrokken (enkel 401); de eerstvolgende refresh trekt wel in.
- `expires_in` blijft 3600 ook in het laatste uur vóór dag 30; het token wordt dan door zoekToegang vroeger geweigerd.
- I5: zie hierboven (Iedereen blokkeren/feestdagen zitten niet in de afspraken-data).
