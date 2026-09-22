# Onderzoek: groen balkje "rapport nog aan het uploaden" bij elke app-opening

**Datum:** 2026-09-22
**Type:** Onderzoek (read-only, geen code aangepast)
**Aanleiding:** melding Brent — "Rapporten worden niet onmiddellijk geüpload. Elke keer dat ik de
app weer open op mijn telefoon zie ik bovenaan het groene balkje dat er nog een rapport aan het
uploaden is." Later aangevuld: het rapport komt uiteindelijk wél aan (verschijnt later als
Verzonden), het balkje verschijnt gewoon telkens opnieuw bij het openen.

---

## Kort samengevat (voor Brent)

- Een rapport versturen is geen kleine, snelle actie. Er gaan **drie zware verzendingen** naar de
  server voor één rapport: het rapport zelf wegschrijven naar ons archief, de PDF laten opmaken en
  naar Zoho sturen, en daarna nog een bevestiging terugsturen naar het archief. Elke foto in het
  rapport wordt daarbij **twee keer** meegestuurd (dat is een gekende, apart genoteerde bug — zie
  punt H in de bugronde van 22 september).
- Bij 6 foto's schat ik dat er in totaal **al snel 10 à 12 MB** van de telefoon naar de server moet.
  Op een zwak of wisselend signaal (typisch op verplaatsing/bij een klant) kan dat alleen al
  **tientallen seconden tot enkele minuten** duren.
- De app is een gewone PWA: zodra je het scherm vergrendelt of naar een andere app schakelt terwijl
  die verzending nog bezig is, onderbreekt het besturingssysteem de lopende poging — er is geen
  "verzenden op de achtergrond terwijl het scherm uit staat" (dat bestaat wel als techniek, maar is
  op iPhone sowieso niet mogelijk en is in deze app nergens ingebouwd).
- Daardoor herstart de poging simpelweg **de volgende keer dat je de app opent** — vandaar dat je
  het balkje telkens opnieuw ziet, tot een keer de app lang genoeg open/actief blijft om de rest af
  te werken. Dat verklaart ook waarom het rapport uiteindelijk toch aankomt: er gaat niets verloren,
  het duurt gewoon meerdere pogingen.
- **Wat je aandacht vraagt:** het balkje zelf legt niets uit — geen "waarmee is dit bezig", geen
  foutmelding, geen manier om een hardnekkig rapport te annuleren. Voor jou als technicus voelt dit
  aan als "het werkt niet", terwijl het eigenlijk gewoon (te) lang bezig is.
- Er is ook een **klein maar reëel risico op een dubbele PDF-bijlage** op hetzelfde Zoho-ticket: als
  de server de upload naar Zoho toch had voltooid net op het moment dat de verbinding wegvalt, weet
  de telefoon dat niet en probeert de volgende keer opnieuw. Dit is nu niet 100% afgedekt.
- Mijn voorstel: eerst de dubbele foto-opslag wegwerken (kleine ingreep, halveert een deel van de
  data), dan de balktekst duidelijker maken, en als het probleem blijft: foto's kleiner maken of
  apart versturen in plaats van ingebed in elk bericht. Verderop in dit document staat dit
  uitgewerkt met kleine vs. grotere opties — dat hoef je niet te lezen, tenzij je de details wil.

---

## De leidende hypothese (bevestigd door het gedrag dat je meldt)

Een rapport "verzenden" doorloopt, per wachtrij-item, tot drie opeenvolgende netwerkoproepen
(`public/js/outbox.js:108-189`, functie `attemptOutboxItem`):

1. **archiveren** — `POST /api/rapport-archief` met het volledige rapport inclusief alle foto's
   (`public/js/rapport-wizard.js:1176-1194`, veld `archiveBody`).
2. **Zoho-upload** — `POST /api/rapport` met de volledige gerenderde HTML (foto's er nogmaals in
   ingebed) → deze functie genereert server-side een PDF via Puppeteer/Chromium en upload die naar
   Zoho Desk (`netlify/functions/rapport.js`).
3. **bevestigen** — nogmaals `POST /api/rapport-archief`, met dezelfde volledige payload als stap 1
   plus `zohoUploaded: true` (`public/js/outbox.js:171-182`).

Elke stap wordt pas na een bevestigd antwoord als "klaar" gemarkeerd en weggeschreven in de lokale
IndexedDB-wachtrij (`outboxPut`, `public/js/outbox.js:32-42`). Zolang niet **alle** stappen
bevestigd zijn, blijft het item in de wachtrij staan en blijft het balkje zichtbaar
(`renderOutboxBanner`, `public/js/outbox.js:77-87`).

`flushOutbox()` wordt aangeroepen bij app-start, bij elk `online`-event, en telkens het scherm
weer zichtbaar wordt (`public/index.html:788-793`) — zonder enige tijdslimiet (geen
`AbortController`, geen client-side timeout in `outbox.js`). Dat betekent: een poging stopt **niet**
omdat de app het opgeeft, maar wél zodra de browser/het OS de tab/app op de achtergrond zet en de
lopende JavaScript (en dus de wachtende `fetch`) onderbreekt — een gekend mobiel-browsergedrag,
expliciet benoemd als root cause in het eerdere ontwerpdocument
(`docs/superpowers/specs/2026-08-11-rapport-verzend-betrouwbaarheid-design.md:10`): *"mobiele
browsers pauzeren/onderbreken JS-uitvoering in achtergrond-tabs vaak binnen enkele seconden [...]
zonder dat een catch-blok ooit bereikt wordt."* Dat ontwerp loste dit alleen op voor het moment
vlak na het klikken op "afdrukken" (een race met een 5s-timer, die overigens de onderliggende
poging niet afbreekt — zie `public/js/rapport-wizard.js:1215-1227`). Voor de herhaalde pogingen via
`flushOutbox()` bij een latere app-opening geldt diezelfde kwetsbaarheid, maar dan zonder enige
tijdslimiet of voortgangsindicatie — de poging loopt gewoon door tot ze lukt of tot de app naar de
achtergrond gaat.

Zodra de technicus het rapport afrondt en de telefoon wegstopt (heel gebruikelijk gedrag: klaar,
scherm uit, naar de volgende klant), is de kans reëel dat precies dít moment samenvalt met een nog
lopende, trage upload — en dan herstart alles bij de volgovergaande app-opening, telkens opnieuw,
tot een sessie waarin de app lang genoeg actief blijft (bv. tijdens het rijden met scherm aan, of in
kantoor met goed wifi) om alle stappen af te werken.

---

## Bewijs per onderzoeksvraag

### 1. Wat triggert het balkje, wanneer verdwijnt het, wordt er meteen geprobeerd?

- Balkje toont zodra de lokale wachtrij (IndexedDB) niet leeg is, ongeacht of een item nog nooit
  geprobeerd is, gedeeltelijk gelukt is, of al meermaals gefaald heeft — er wordt geen onderscheid
  gemaakt (`renderOutboxBanner`, `public/js/outbox.js:77-87`, gebaseerd op `_outboxItems.length`).
- Verdwijnt pas zodra een item volledig is afgerond (`nextOutboxAction` geeft `'done'` →
  `outboxRemove`, `public/js/outbox.js:64-70` en `186-188`) — dus pas na **alle drie** de stappen
  hierboven.
- Bij app-start wordt **onmiddellijk** geprobeerd, geen vertraging/backoff:
  `refreshOutboxCache(); flushOutbox();` direct in de opstartcode (`public/index.html:788-789`).
  Ook bij `online` en bij `visibilitychange`→zichtbaar (`public/index.html:790-793`).

### 2. Retry-beleid: hoe vaak, max pogingen, backoff, network vs 4xx/5xx vs timeout, kan het oneindig doorgaan, kan een item server-side gelukt zijn maar toch in de wachtrij blijven?

- **Geen backoff, geen maximum aantal pogingen.** `item.attempts` wordt wel bijgehouden en gelogd
  (`logOutboxFailure`, `public/js/outbox.js:89-106`), maar nergens gecontroleerd om te stoppen.
  Dit is een **bewuste ontwerpkeuze**, expliciet zo genoteerd in het ontwerpdocument: *"Geen limiet
  op het aantal pogingen [...] tot het echt lukt"*
  (`docs/superpowers/specs/2026-08-11-rapport-verzend-betrouwbaarheid-design.md:47`, en nogmaals
  onder "Niet in scope", regel 73).
- Netwerkfout, 4xx en 5xx worden identiek behandeld: elke niet-`res.ok` of afgevangen `fetch`-fout
  wordt gelogd en het item blijft gewoon staan voor een volgende poging
  (`public/js/outbox.js:118-129`, `147-165`).
- **Dubbele-upload-bescherming bestaat wél, maar heeft een gat.** Vóór een hernieuwde Zoho-upload
  checkt de client eerst server-side of `zohoUploaded` al `true` staat
  (`public/js/outbox.js:133-145`, `GET /api/rapport-archief?id=...`). Die vlag wordt echter pas
  gezet ná een **volledige, succesvolle round-trip**: upload gelukt → lokaal `zohoUploaded = true`
  zetten (`outbox.js:160-161`) → daarna nog een aparte bevestigingscall naar het archief
  (`outbox.js:171-182`) die de server-side vlag zet. Als de verbinding/app wegvalt **nadat** de
  server de PDF al naar Zoho geupload heeft, maar **vóórdat** het antwoord de telefoon bereikt (heel
  plausibel bij een onderbroken achtergrond-fetch op mobiel), weet noch de telefoon, noch het
  archief dat de upload al gebeurd is. `rapport.js` zelf heeft geen idempotentie (geen check op "is
  deze PDF al bijgevoegd") — elke geslaagde aanroep hangt gewoon een nieuwe bijlage aan het ticket.
  Dit is expliciet zo benoemd in het ontwerpdocument als reëel risico
  (`...design.md:55`: *"Als een eerdere poging serverzijde wél gelukt is maar het antwoord de
  client nooit bereikte [...] zou blind herhalen een tweede, identieke bijlage opleveren"*), en de
  gebouwde bescherming dekt enkel het geval waarbij de client wél een antwoord kreeg maar de
  ná-bevestiging faalde — niet het geval waarbij de client nooit een antwoord kreeg.

### 3. Payload-grootte

- Foto's worden client-side gecomprimeerd tot max. 1600px, JPEG-kwaliteit 0,7
  (`public/index.html:2032-2053`, `compressFotoFile`).
- **Foto's staan dubbel in het archiveringsbericht:** `rapportData: { ...R, _html: html }`
  (`public/js/rapport-wizard.js:1190`) bevat zowel `R.fotos` (de losse base64-`dataUrl`'s) als
  `_html` (de volledige rapport-HTML met diezelfde foto's er nogmaals als `<img>` in ingebed,
  `rapport-wizard.js:1041-1042`). Dit is al apart genoteerd als bug **H** in de bugronde van
  22 september (`docs/reviews/2026-09-22-bugronde.md`): *"Elke foto neemt zo ~2× zijn
  opslagruimte in."*
- **Schatting (niet gemeten, aanname):** een gecomprimeerde foto op 1600px/q0,7 weegt doorgaans
  ~200–400 KB. Bij 6 foto's: ruw ~1,8 MB aan binaire foto-data → ~2,4 MB als base64 (factor 4/3).
  Omdat dit twee keer in het archiveringsbericht zit: ~4,8 MB in dat ene bericht. Daar bovenop komt
  de Zoho-upload-stap die dezelfde ~2,4 MB (eenmaal ingebed) opnieuw verstuurt, en de
  bevestigingsstap die het volledige ~4,8 MB-archiveringsbericht **nog een derde keer** verstuurt.
  **Totaal geschat dataverkeer voor één rapport met 6 foto's: ~10–12 MB**, verdeeld over drie
  opeenvolgende POST-aanroepen vanaf de telefoon.
- Netlify Functions (het type dat hier gebruikt wordt, zowel de "handler"-stijl als de
  "default export"-stijl — beide draaien op hetzelfde Lambda-achtige platform, zie
  `netlify.toml:1-3`: alle functies onder `netlify/functions`) hanteren een payload-limiet van
  6 MB per synchrone aanroep. Het geïsoleerde archiveringsbericht (~4,8 MB geschat) zit daar in dit
  voorbeeld nog onder, maar bij meer of grotere foto's (het systeem laat tot 30 foto's per ticket
  toe, `netlify/functions/fotos.js:15`) is een 413-fout (payload too large) op de archiveringsstap
  reëel — precies wat bug H beschrijft: *"kan het archiveren stil mislukken (payload te groot [...])
  zonder duidelijke melding."* Dat zou een item **permanent** laten falen (nooit "Verzonden"), wat
  niet overeenkomt met wat Brent nu meldt (rapport komt wél aan) — dus dit is voor de gemelde
  gevallen vermoedelijk niet de hoofdoorzaak, maar blijft een reëel risico bij foto-rijke rapporten,
  en verlengt sowieso elke poging.
- Bijkomend, **niet eerder genoteerd**: de check-zoho-voorcontrole (`GET /api/rapport-archief?id=`)
  leest server-side het **volledige** rapportenarchief in (tot 500 items, elk met ingebedde
  HTML+foto's) om daarna maar één item terug te geven (`netlify/functions/rapport-archief.js:34-42`,
  `store.get(BLOB_KEY, ...)` zonder filtering vóór het inlezen). Naarmate het archief groeit, wordt
  die ene "is dit al gebeurd?"-check trager — een sluimerend, groeiend risico, niet de kern van het
  huidige probleem maar wel iets om in de gaten te houden.

### 4. Timeouts

- `rapport.js` (PDF genereren + Zoho-upload) en `send-rapport.js` (los feature: rapport per mail
  doorsturen) hebben een verlengde functie-timeout van 26s (`netlify.toml:14-18`, het Netlify-
  maximum). `rapport-archief.js` heeft geen override, dus het standaard 10s-limiet.
- Binnen die 26s gebeurt: token ophalen, org-ID ophalen, Puppeteer/Chromium opstarten (bij een koude
  Lambda-container mogelijk een download van het Chromium-pakket), de HTML (met ingebedde foto's)
  laten renderen, de PDF genereren, en de PDF uploaden naar Zoho — bij een koude start realistisch
  meerdere seconden tot mogelijk dicht tegen de 26s aan.
- **Geen enkele client-side timeout** op de `fetch()`-aanroepen in `outbox.js` (geen
  `AbortController`, geen `Promise.race` met een timer behalve de losstaande 5s-UI-race net na het
  klikken op afdrukken die de onderliggende poging niet afbreekt). De client wacht dus zo lang als
  nodig — de aanroep stopt niet uit zichzelf, enkel door een echte netwerkfout of doordat de
  app/tab op de achtergrond gaat.

### 5. Mobiel-specifiek

- **Geen Background Sync.** De service worker (`public/sw.js`) registreert enkel `install`,
  `activate` en `fetch` — geen `sync`-event. Verzenden gebeurt dus uitsluitend terwijl de app open
  en zichtbaar is (of net terug zichtbaar wordt); er is geen mechanisme om verder te werken terwijl
  het scherm uit staat of de app volledig gesloten is. Dit is bewust zo afgebakend in het
  ontwerpdocument (*"niet haalbaar op alle platformen, met name iOS"*,
  `...design.md:49, 72`) — een bekende, aanvaarde grens, geen fout.
- De service worker cachet enkel de "app shell" en laat `/api/`-verzoeken expliciet ongemoeid
  (`public/sw.js:19-21`) — geen interferentie met de outbox-POSTs.
- De wachtrij zelf zit in IndexedDB (`public/js/outbox.js:6-8, 21-30`), niet in `localStorage` —
  overleeft dus heropstart van de app en het sluiten/heropenen van het toestel probleemloos. Dat is
  precies waarom het balkje elke keer terugkomt: het item bestaat nog gewoon, met de laatst bekende
  voortgang (bv. al gearchiveerd, nog niet naar Zoho).

### 6. Zichtbaarheid: welk rapport, hoeveel pogingen, laatste fout, handmatig annuleren?

- Het balkje toont enkel een **aantal** (*"⏳ N rapporten nog niet bevestigd"*,
  `public/js/outbox.js:83-85`) — geen ticketnummer, geen klantnaam, geen stap waarin het vastzit.
- Op het Rapporten-tabblad krijgt een rij een kleine "⏳ In wachtrij"-tag als het bijhorend
  wachtrij-item nog niet volledig bevestigd is (`public/js/rapport-archief.js:66-68`). **Belangrijke
  beperking:** dit werkt enkel voor een rapport dat de **archiveringsstap** al haalde — als zelfs die
  eerste stap nooit lukt, verschijnt de rij nooit in het archief en is er dus helemaal geen
  aanknopingspunt op dat tabblad.
- `item.attempts` en `item.lastError` worden wel bijgehouden (`public/js/outbox.js:89-92`) en naar
  een diagnostisch logboek gestuurd (`/api/client-log`), maar dat logboek heeft **geen UI in de
  app** — enkel handmatig raadpleegbaar via een GET-aanroep, zoals expliciet zo ontworpen
  (`...design.md:64`: *"geen UI in de app hiervoor"*).
- "Tik om nu te proberen" op het balkje roept gewoon opnieuw `flushOutbox()` aan — dat is dezelfde
  poging nogmaals starten, geen manier om te annuleren of het item te verwijderen.

---

## Meest waarschijnlijke oorzaken, gerangschikt

1. **(Hoofdoorzaak, sluit aan bij het gemelde gedrag)** Een volledige verzendcyclus bestaat uit drie
   zware POST's met (deels dubbel ingebedde) foto's, geschat 10–12 MB voor 6 foto's, zonder client-
   timeout. Op een wisselend/zwak mobiel signaal duurt dat lang genoeg dat de technicus het scherm
   vergrendelt of de app wegduwt vóór alle stappen klaar zijn. Zonder Background Sync onderbreekt
   dat de lopende poging; ze herstart pas bij de volgende app-opening, exact bij de stap waar ze
   bleef steken (dankzij de IndexedDB-wachtrij). Dit verklaart zowel het herhaaldelijk terugkerende
   balkje als het uiteindelijk wél aankomen.
2. **(Versterkende factor)** Foto's staan dubbel ingebed in het archiveringsbericht (bug H) —
   maakt elke poging nodeloos groter/trager dan nodig, en vergroot dus de kans op onderbreking.
3. **(Reëel, kleiner risico)** Geen sluitende bescherming tegen een dubbele PDF-bijlage wanneer de
   server een upload wél voltooit maar het antwoord de telefoon nooit bereikt — `rapport.js` heeft
   geen eigen idempotentie, enkel een client-/archief-vlag die net dat scenario niet dekt.
4. **(Gebruikerservaring, geen technische fout)** Het balkje/de "In wachtrij"-tag geven geen inzicht
   in welk rapport, welke stap, of waarom het lang duurt — een technicus kan niet zien of dit normaal
   trage verzending is dan wel een echt probleem.
5. **(Zeldzamer, bij zeer foto-rijke rapporten)** Bij rapporten met veel foto's (systeem laat tot 30
   toe) kan de archiveringsstap de Netlify-payloadlimiet (6 MB) raken en **permanent** falen — dit
   is een aparte faalmodus dan het hierboven beschreven "duurt gewoon lang" patroon, en zou zich
   tonen als een rapport dat nooit "Verzonden" wordt (niet wat momenteel gemeld is, maar wel al
   apart genoteerd als bug H).
6. **(Sluimerend, nog niet acuut)** De check-zoho-voorcontrole leest bij elke poging het volledige,
   groeiende rapportenarchief in — een bijkomende, toenemende vertraging per poging naarmate er meer
   rapporten opgestapeld raken.

---

## Voorgestelde oplossingen (niet geïmplementeerd — enkel voorstel)

**Klein / snel:**
- Foto's niet meer dubbel meesturen in het archiveringsbericht (bug H oplossen): enkel `_html`
  bewaren óf enkel `R.fotos` apart, niet beide. Halveert meteen een groot deel van elke poging.
- De check-zoho-voorcontrole niet het volledige archief laten inlezen voor één id — een aparte,
  lichte status-opslag per rapport-id (of filtering vóór het parsen) i.p.v. de hele lijst.
- Duidelijkere balktekst: welke stap loopt (bv. "bezig met versturen naar Zoho, kan even duren bij
  veel foto's"), en de laatst gelogde fout/tijdstip tonen in plaats van enkel een generiek aantal.
- Een zichtbare "verwijder uit wachtrij"-optie voor een technicus die weet dat een item nooit meer
  gaat lukken (bv. verkeerd ticket) — met duidelijke waarschuwing dat het rapport dan effectief
  verloren gaat, want vandaag is er geen enkele manier om een hardnekkig item kwijt te raken.

**Groter / structureel:**
- Echte idempotentie aan Zoho-kant voor de PDF-upload (bv. eerst controleren of er al een bijlage
  met dezelfde bestandsnaam op het ticket staat vóór een nieuwe upload) i.p.v. enkel te vertrouwen
  op de lokale/archief-vlag — sluit het dubbele-bijlage-risico structureel.
- Payload verder verkleinen en/of foto's apart (buiten de hoofdcyclus) versturen in plaats van
  driemaal ingebed mee te sturen bij elke poging — vermindert de kans op onderbreking het meest
  direct.
- Background Sync inzetten waar het platform het toelaat (Android/Chrome) zodat een onderbroken
  verzending ook zonder expliciet heropenen kan afwerken — lost het probleem niet overal op (niet op
  iPhone, zoals het ontwerpdocument al aangaf), maar wel voor een deel van de situaties.
- Tijd per stap effectief meten/loggen (client + server) om de aanname over duur/grootte in dit
  document te bevestigen of bij te stellen vóór er verder geïnvesteerd wordt in een fix.

---

## Referenties

- `public/js/outbox.js` — volledige wachtrijlogica (`attemptOutboxItem`, `flushOutbox`,
  `renderOutboxBanner`).
- `public/js/rapport-wizard.js:1126-1246` (`printRapport`) en `:1176-1194` (`archiveBody`-opbouw,
  incl. dubbele foto-embedding).
- `public/index.html:2032-2053` (fotocompressie), `:788-793` (flush-triggers bij opstart/online/
  zichtbaar).
- `netlify/functions/rapport-archief.js`, `rapport.js`, `rapport-verzonden.js`, `fotos.js`.
- `netlify.toml` — functie-timeouts.
- `public/sw.js` — service worker (geen Background Sync).
- `docs/superpowers/specs/2026-08-11-rapport-verzend-betrouwbaarheid-design.md` en het
  bijhorende implementatieplan — origineel ontwerp van de outbox, inclusief de bewuste keuze voor
  "geen limiet op pogingen" en de erkende grens rond achtergrond-onderbrekingen.
- `docs/reviews/2026-09-22-bugronde.md`, punt H — dubbele foto-opslag, al apart genoteerd.

*Dit document is een onderzoek; er is geen code gewijzigd.*
