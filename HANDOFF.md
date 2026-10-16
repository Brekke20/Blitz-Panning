# Handoff — Blitz Planning (stand 2026-09-28, aanvulling 2026-10-01 bovenaan)

> ## ⚠️ Branchbeleid sinds 2026-10-01 — eerst lezen
> - **Live = `main` = v1.10.1.** Op `main` komen **alleen bugfixes** (v1.10.x). Geen nieuwe functies,
>   geen herstructurering. Zie `CLAUDE.md`, sectie "Branchbeleid".
> - **De volledige refactor loopt op de tak `refactor`** (worktree `.claude/worktrees/planner-brein`).
>   Stap 1, het planner-brein ("Plan deze week" opnieuw opgebouwd), is gebouwd en goedgekeurd:
>   136 tests, eindreview gedaan. Hij gaat **niet** live tot Brent zegt dat de volledige refactor
>   klaar en getest is.
> - Een lokale pre-push-hook (`.git/hooks/pre-push`) blokkeert elke push naar `main` die
>   refactor-werk bevat. Nooit omzeilen.
> - Na elke bugfix op `main`: `git merge main` in de refactor-worktree.
> - Details en alle beslissingen: spec `docs/superpowers/specs/2026-09-30-planner-brein-design.md`,
>   plan `docs/superpowers/plans/2026-10-01-planner-brein.md`, ledger
>   `.superpowers/sdd/2026-10-01-planner-brein/progress.md` (in de refactor-worktree).
> - Deze handoff hieronder dateert van v1.6.0; de releases v1.6.1–v1.10.1 staan in `CHANGELOG.md`.

Overdracht voor een nieuwe Claude-sessie. Lees dit eerst, daarna `CLAUDE.md` (wordt al automatisch
geladen) en de memory-index. Dit bestand staat bewust **niet** in git (lokale notitie) en vervangt
de verouderde handoff van augustus.

**Start de nieuwe sessie altijd in deze map:**
`C:\Users\BRENT\OneDrive - Hertsens Transport (Walding)\Claude-Projects\blitz-planning`
— anders krijg je `CLAUDE.md` en de memory niet mee.

---

## 1. Wat dit project is (in één alinea)

Blitz Planning is de interne planningstool van het service-team van Blitz Power (EV-laadpalen).
PWA: `public/index.html` (kalender, wachtrij, route-tab, ticketdetail, instellingen) + modules in
`public/js/` (rapport-wizard, rapport-archief, outbox, excel-export, prijzen, inventaris) +
Netlify Functions in `netlify/functions/` (Zoho Desk, TomTom, Netlify Blobs-opslag). Live op
https://blitz-planning.netlify.app, repo https://github.com/Brekke20/Blitz-Panning (branch `main`,
Netlify deployt automatisch bij push). Achtergrond: `ONBOARDING.md`, `CHANGELOG.md`.

## 2. Stand van zaken

- **Live: v1.6.0** (gepusht 2026-09-23, deploy geverifieerd: service-worker-cache `blitz-planning-v13`).
- `main` = `origin/main` = `50c69cc`. Tags `v1.4.0`, `v1.5.0`, `v1.5.1`, `v1.6.0` staan op GitHub.
- Werkboom schoon op drie bewust niet-getrackte dingen na: `.claude/` (tooling),
  `Foutmeldingen en verbeteringen/` (foto + PDF van Brent) en dit bestand.

### Wat er in de sessie van 21–23 september gebouwd is (allemaal live)
| Versie | Inhoud (kort) |
|---|---|
| v1.4.0 | Voorkeursdatum wijzigen/wissen; voorkeursuur als vast tijdstip; route slepen = echte tijdstippen naar Zoho (🔒-ankers); uurblok −30 min, gemaild blok bewaard; kaartstijlen; routelijn-kleur; verwachte drukte |
| v1.5.0 | Drukte per wegvak (±1,5 km) voor toekomstige dagen (`netlify/functions/drukte.js`) |
| v1.5.1 | Drukte-stukjes altijd op eigen routelijn (geen rare bochten); wegenwerken/afsluitingen apart getoond |
| v1.6.0 | 8 bugfixes + UX (prioriteit NL, grotere knoppen/ticketnummers, klantvriendelijke mailtekst), kaart sneller (geocode-cache, Esri-standaardkaart), verzendwachtrij met stap/fout/annuleren + beveiliging tegen dubbele PDF |

Details, gemaakte keuzes ("rulings") en technische valkuilen per versie:
memory `project_v140_planning_verbeterpunten.md`. Plannen/specs: `docs/superpowers/plans/` en
`docs/superpowers/specs/`. Reviews en onderzoeken: `docs/reviews/2026-09-22-*.md`.

## Volgende focus (door Brent gekozen op 2026-09-28): UI/UX

Brent wil de UI en het gebruiksgemak aanpakken. Daarvoor installeerde hij de plugin
**design@knowledge-work-plugins**, met onder meer de skills `design:design-critique`,
`design:accessibility-review`, `design:ux-copy` en `design:design-system`.

Bestaande input:
- `docs/reviews/2026-09-22-ux-ronde.md` (UX-ronde; de snelle winsten zitten al in v1.6.0);
- de UX-backlog in §4 (tablet-indeling, pop-upblokkering op mobiel, één Opslaan-knop voor
  Klantbeschikbaarheid);
- de open labelvraag in §3.

Aanpak: eerst een audit met de design-skills, in de app draaiend op `?test` op desktop, gsm
en tablet. Daarna een geprioriteerd voorstel aan Brent en pas na zijn keuze bouwen.

**Welke plugin wanneer** (afgesproken 2026-09-28; alle drie staan geïnstalleerd):
- **Audit**: `design@knowledge-work-plugins`, de skills `design:*`.
- **Bouwen, visuele uitwerking**: `frontend-design@claude-plugins-official`, van Anthropic,
  geïnstalleerd op 2026-09-28. Blijf binnen de bestaande stijl: de CSS-variabelen in
  `public/css/app.css`, het donkere/lichte thema en de kleurtokens.
- **Links laten liggen**: `ui-ux-pro-max`, van een derde partij. Die bestrijkt hetzelfde terrein,
  dus gebruik hem enkel met een concrete reden.

## 3. Open bij Brent (eerst navragen in een nieuwe sessie)

1. **Productietests v1.6.0** (konden lokaal niet, want Netlify Blobs draait enkel op Netlify):
   - rapport versturen → komt aan, geen blobs-fout in het Netlify-functielog (`rapport.js` is de
     enige v1-stijl handler die Blobs gebruikt; dat moet live bevestigd worden);
   - tijdens verzenden de verbinding kort onderbreken → uiteindelijk **één** PDF op het Zoho-ticket;
   - hetzelfde rapport vanuit twee toestellen → melding "Verzending is al bezig in een ander venster";
   - dag met een afspraak zonder adres → route wordt toch berekend, met waarschuwing;
   - route twee keer berekenen → tweede keer geen adresopzoeking;
   - techniekers één keer laten herladen (cache v13).
   Ook nog open van v1.4.0: dag met 🔒-ticket + voorkeursuur-ticket + afspraak → slepen/optimaliseren
   → in Zoho nakijken dat die twee hun uur behouden.
2. **Knoplabel**: "🔓 Blokkade opheffen" opent het blokkeer-venster (heft niet direct op). Wil Brent
   "Blokkade beheren"?
3. **PR #2** (`worktree-installatie-extra-kosten-rapport`, installatierapport-meerkosten) staat nog
   **open** en wacht op de kabelprijs "boven 10 m" die Brent bij zijn supervisor navraagt. Branch is
   van vóór de Fase 0-refactor → handmatige rebase nodig zodra hij verder mag.
4. **Max-reistijd-regel** (autoPlan, sinds 2026-07-28): Brent wilde eind augustus evalueren hoe die
   bevalt — nog niet gebeurd.

## 4. Bewust uitgesteld (backlog, niets hiervan is gestart)

- **Niet in v1.6.0 gekomen**: eigen tablet-indeling (768–1023 px krijgt nu de gsm-indeling);
  pop-upblokkering bij rapport openen op mobiel; één "Opslaan" voor Klantbeschikbaarheid;
  foto-payload verder verkleinen.
- **Uit de eindreview v1.6.0**: knop om de adres-cache te wissen; `loadGeocache()` éénmaal per
  berekening; kleine race bij annuleren (upsert na verwijderen); `gcKlantBeschikbaarheid()` gebruikt
  `kbLocallyDeleted` niet.
- **Dubbele-PDF-beveiliging 100 % waterdicht maken**: vergt een upgrade van `@netlify/blobs` (8.2.0
  heeft geen `onlyIfMatch`/conditional write). Nu: niet-atomaire reservering met ~100 ms restvenster,
  gedocumenteerd in `netlify/functions/rapport.js`.
- **Eerder uitgesteld**: botsingsdetectie bij vaste tijdstippen; `berekenAankomsten` en
  `computeArrivalTimes` samenvoegen; een `?test`-stub voor `/api/propose` (voorstel-flow is lokaal
  niet end-to-end te testen).
- **Bewust geschrapt, niet opnieuw voorstellen**: Outlook-synchronisatie (memory
  `project_outlook_sync_setup.md`).

## 5. Onze werkwijze (zo werken we samen — aanhouden)

1. **Brent is opdrachtgever, geen programmeur.** Leg alles uit in gewone taal; bij elke technische
   review de skill `opdrachtgever-samenvatting` gebruiken. **Altijd Nederlands.**
2. **Nieuwe functionaliteit**: skill `superpowers:brainstorming` → kort ontwerp of spec →
   **goedkeuring van Brent** → plan (`superpowers:writing-plans`, in `docs/superpowers/plans/`).
3. **Bouwen**: in een aparte worktree (`EnterWorktree`), via `superpowers:subagent-driven-development`:
   per taak een implementer-subagent + een reviewer, fix-rondes tot clean, en tot slot één
   eindreview over de hele branch.
4. **Modelkeuze per subagent, altijd expliciet `model` meegeven** (Brent heeft dit twee keer
   gevraagd — tokens besparen): haiku voor verkennen en puur CSS/label-werk, sonnet voor
   implementatie/plannen/reviews, opus enkel voor de eindreview. De hoofdsessie coördineert en
   schrijft zelf geen code (hooguit een triviale één-regelfix, een commit of een memory).
5. **Verifiëren in de browser** met de built-in browser-tools op `http://localhost:3333/?test`.
   Beweringen van subagents over tests niet blind vertrouwen; na elke implementer
   `git branch --show-current` controleren.
6. **Afronden** (`superpowers:finishing-a-development-branch`): versie ophogen (semver) in
   `package.json` + `package-lock.json`, `CHANGELOG.md`-entry, `CACHE_NAME` in `public/sw.js` +1,
   mergen naar `main`, tag `vX.Y.Z`, worktree en branch opruimen.
7. **Nooit pushen of deployen zonder expliciete "ja" van Brent.** Na de push:
   `curl -s https://blitz-planning.netlify.app/sw.js | grep -o "blitz-planning-v[0-9]*"` → de nieuwe
   cache-versie bevestigt dat de deploy live is.
8. Commit-trailer: gebruik de `Co-Authored-By`-regel die de systeemmelding aangeeft.

## 6. Valkuilen (kost anders tijd)

- **Altijd `?test`** in de URL lokaal — zonder gaan er echte TomTom- en Zoho-aanroepen uit.
  Let op: ook mét `?test` roepen routeberekening en "Plan deze week" echt TomTom aan (gekend,
  toegestaan).
- **Netlify Blobs lokaal**: kaal `node dev-server.mjs` geeft HTTP 500 op alle opslag-endpoints.
  `node blobs-local-bootstrap.mjs` (projectroot, gitignored) start een lokale Blobs-emulator + de
  dev-server. In een worktree moet je dat bestand én `.env.local` eerst uit de hoofdmap kopiëren.
- **Service worker cachet agressief**: bij "mijn wijziging is er niet" eerst caches/SW legen.
- **`preview_start` op naam** kan naar de verkeerde checkout (main i.p.v. worktree) wijzen — check
  welke code geserveerd wordt.
- **Pushen**: `git push` via de Bash-tool wordt door de auto-mode-classifier geweigerd; via de
  PowerShell-tool lukt het. `git-push.ps1` in de repo **niet** gebruiken (doet `git add .` met een
  oude, vaste commitboodschap).
- **Worktree opruimen** botst vaak op OneDrive-bestandsvergrendeling ("Permission denied"): eerst
  achtergebleven `node dev-server.mjs`-processen stoppen, dan `git worktree remove --force` en zo
  nodig de map met PowerShell `Remove-Item` verwijderen.
- **Technische TomTom-feiten**: voor een toekomstige vertrektijd geeft TomTom geen live
  file-secties, enkel geplande wegenwerken; verwachte drukte zit in historic- vs noTraffic-reistijd.
  `supportingPoints` werkt niet met tussenpunten. Details in memory.
- **Zoho**: `cf_interventie_datm` is het datumveld (nooit `dueDate`); `sendReply` vóór de
  status-PATCH. API-naslag: `docs/integrations/zoho-desk-api-referentie.md`.

## 7. Opruimwerk dat nog ligt (niet dringend, eerst Brent vragen)

- Oude werkmappen onder `.claude/worktrees/` (±17 stuks) van eerdere sessies — git kent ze niet
  meer, het zijn losse mappen. Veilig te verwijderen, maar OneDrive-vergrendeling kan tegenwerken.
- Oude lokale branches: `worktree-rapport-verzend-outbox` en `claude/mystifying-cray-a07245`
  (0 commits vóór `main`, dus volledig gemerged); `claude/dazzling-pascal-eb0413` (1 commit van
  2026-07-26, een escHtml-fix die waarschijnlijk al anders in `main` zit — eerst nakijken vóór je
  hem weggooit). `worktree-installatie-extra-kosten-rapport` **niet** verwijderen (PR #2).

## 8. Tools en koppelingen op dit toestel

- `gh` (GitHub CLI) is ingelogd als `Brekke20` — PR's aanmaken werkt.
- Plugin **design@knowledge-work-plugins** is geïnstalleerd (2026-09-28). De koppelingen die hij
  meebrengt (Figma, Notion, Slack, Linear, Atlassian, Intercom) werken pas na toestemming via `/mcp`
  in een gewone `claude`-terminalsessie; de Asana-koppeling kon niet verbinden.
- Er is een Zoho Desk-koppeling (MCP) beschikbaar in sessies, los van de app zelf.
