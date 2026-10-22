# Thema's als uploadbare pakketten — ontwerp

_Opgesteld 2026-10-22 na een grill-sessie met Brent. Release: **v2.3.0**, tak `feat/themas` vanaf `main`, pas live na Brents uitdrukkelijke ja. Beslissing over "geen code in een pakket": `docs/adr/0001-themas-als-pakket-zonder-code.md`. Begrippen: `GLOSSARY.md` (Thema, Themapakket, Actief thema, Versiering)._

## Kort samengevat (voor Brent)

- Feestthema's zitten straks niet meer vast in de app. Elk thema is een **pakket**: één bestand dat Claude maakt en dat jij in **Beheer → Thema's** uploadt. Daarvoor is geen nieuwe versie van de app nodig.
- Bij de lancering staan er al **negen thema's** klaar en ze staan allemaal aan: Nieuwjaar, Valentijn, Carnaval, Pasen, Zomer, 21 juli, Halloween, Sinterklaas en Kerst. Halloween ziet er hetzelfde uit als nu.
- Per thema kan je in Beheer: **aan/uit** zetten voor iedereen, de **periode** aanpassen (elk jaar opnieuw), een **voorbeeld** bekijken (enkel op jouw scherm, tot je herlaadt), het pakket **downloaden** en een **nieuwe versie** uploaden. Verwijderen kan niet: alles blijft bewaard.
- Elke gebruiker kan de versiering op het eigen toestel nog altijd uitzetten, zoals nu. Op gsm en tablet blijft het sober (enkel stilstaande versiering).
- Elk thema krijgt een eigen **laadpaal-skin in Blitz Run**, die je enkel tijdens de periode van het thema kunt ontgrendelen en enkel als het thema aan staat. Wie de Spookpaal of Kerstpaal al heeft, houdt ze.
- Lopen twee thema's tegelijk, dan wint het thema met de **kortste periode**: Sinterklaas gaat voor op Kerst, 21 juli voor op Zomer.

**Waar jouw aandacht nodig is:**
- **Kerst verandert van periode.** Nu loopt Kerst van 1 december tot 6 januari. Met Sinterklaas (1-6 december) en Nieuwjaar (1-6 januari) erbij stel ik voor: Sinterklaas 1-6 december, Kerst 7-31 december, Nieuwjaar 1-6 januari. Dat kan je achteraf in Beheer aanpassen.
- **Een pakket kan niet alles.** Het kiest uit vaste bewegingen die de app kent: vallen (sneeuw, confetti), opstijgen (hartjes, ballonnen), vuurwerk, hangen (spinnen, slingers), kruipen, vliegen, mist en een achtergrondtekening. Een helemaal nieuw soort beweging blijft een nieuwe versie van de app. Daar staat tegenover dat een fout pakket de app niet kan breken.
- **Pakketten moeten klein blijven** (maximaal 512 kB). Ze werken dan ook zonder internet en vertragen de start niet. Vooral tekeningen, weinig foto's.

---

## 1. Doel en afbakening

**Doel:** de feestelijke versiering wordt gegevens in plaats van code. Wie de beheerdersrol heeft, beheert de thema's zonder release. Halloween wordt het eerste pakket, en er komen er acht bij.

**Binnen scope**
- Formaat en validatie van een themapakket (gedeeld door client en server).
- Opslag en API `/api/themas`, met de negen voorgeladen pakketten die bij de eerste lezing in de opslag gezet worden.
- Een data-gestuurde versieringslaag die de huidige Halloween-code vervangt.
- Het beheerdersscherm "Thema's".
- Data-gestuurde spelskins voor thema's in Blitz Run, op client en server.
- Migratie: Halloween- en Kerstskin met dezelfde id's, zodat wie ze al ontgrendeld heeft, ze houdt.

**Buiten scope**
- Pakketten met code (zie ADR 0001).
- Thema's verwijderen.
- Thema per gebruiker of per rol. Er is één globale schakelaar, met daarnaast de bestaande opt-out per toestel.

## 2. Domeinregels

1. Een **thema** is actief op dag D als het aan staat en D binnen zijn periode valt (Belgische kalenderdag, grenzen inclusief).
2. Een **periode** is:
   - **vast**: `{ van: {maand, dag}, tot: {maand, dag} }`, elk jaar terugkerend. `van` na `tot` loopt over de jaarwissel.
   - **beweeglijk**: `{ basis: 'pasen', van: -7, tot: 1 }`, uitgedrukt in dagen ten opzichte van Paaszondag. De paasberekening staat al in `kern/feestdagen.js`.
3. **Overlap:** zijn meerdere thema's actief, dan wint de kortste periode in dagen. Bij een gelijke lengte wint de laatste start, en daarna de alfabetische id.
4. **Aan/uit en periode:** de beheerder zet ze. Deze instellingen staan los van het pakket. Een nieuwe versie van een pakket behoudt de schakelaar en een door de beheerder gewijzigde periode.
5. **Per toestel:** `blitz_versiering = 'uit'` blijft voorgaan. Sober (aanraakscherm, gsm of tablet) en verminderde beweging blijven zoals nu: enkel statische versiering.
6. **Voorbeeld:** wordt enkel in het geheugen getoond, op het scherm van wie de knop indrukt, tot hij herlaadt of op "Stop voorbeeld" klikt. Het verandert niets voor anderen en niets in de opslag.
7. **Spelskin:** de skin van een thema is ontgrendelbaar zolang het thema actief is (aan en binnen de periode). Een skin die al ontgrendeld is, blijft altijd open.
8. **Testmodus:** de versiering staat uit in `?test`, tenzij `?versiering=aan`. Dat blijft zoals nu.

## 3. Het themapakket

Een pakket is één JSON-bestand (`<id>.blitzthema.json`). Het bevat enkel gegevens, met een vaste lijst sleutels. Elke onbekende sleutel wordt geweigerd.

```jsonc
{
  "formaat": 1,
  "id": "halloween",                 // [a-z0-9-]{2,30}; ook de skin-id voor Blitz Run
  "naam": "Halloween",               // max 40 tekens
  "versie": "2026-10-22",            // vrije tekst, max 20; enkel ter info in Beheer
  "periode": { "van": { "maand": 10, "dag": 1 }, "tot": { "maand": 10, "dag": 31 } },
  "kleuren": {                       // enkel #rrggbb of #rrggbbaa
    "donker": { "accent": "#f97316", "accentHover": "#fb923c", "accentDim": "#f973161f", "accentGlow": "#f9731638", "opAccent": "#0b0b14" },
    "licht":  { "accent": "#c2570c", "accentDim": "#c2570c1f", "accentGlow": "#c2570c38" },
    "voorkeurThema": "donker"        // 'donker' | 'licht' | null: standaard licht/donker tijdens het thema
  },
  "vormen": {                        // vectortekeningen als gegevens (zie §3.1)
    "spin": { "viewBox": "0 0 24 24", "delen": [ { "soort": "path", "d": "M12 …", "vul": "#1a1a1a" } ] }
  },
  "beelden": {                       // optioneel: rasterbeelden (zie §3.2)
    "pompoen": "data:image/webp;base64,…"
  },
  "achtergrond": { "vorm": "scene", "kijkvensterStaand": "820 0 780 900", "dekkingLicht": 0.2 },
  "versiering": [                    // max 8 elementen; zie §3.3
    { "beweging": "hoek",     "beeld": "web",       "hoeken": ["lb", "rb", "lo", "ro"] },
    { "beweging": "hangen",   "beeld": "spin",      "aantal": 2 },
    { "beweging": "kruipen",  "beeld": "spin",      "aantal": 1, "langs": "tabbalk" },
    { "beweging": "vliegen",  "beeld": "vleermuis", "aantal": 1 },
    { "beweging": "mist" }
  ],
  "teksten": {                       // optioneel, max 80 tekens elk, altijd als platte tekst getoond
    "wachtrijLeeg": "Geen spoken in de wachtrij.",
    "ingeplandLeeg": "Geen spookbezoeken gepland deze week"
  },
  "spelskin": {                      // verplicht (Brent: elk thema een skin)
    "naam": "Spookpaal", "behuizing": "#2a1840", "faceplate": "#ff7a00", "bliksem": "#ffe9c2", "rand": "#e9f2f8",
    "extra": "heksenhoed"            // naam van een vorm uit "vormen"; getekend boven op de paal
  }
}
```

### 3.1 Vormen (veilige vectortekeningen)
- Een vorm heeft een `viewBox` en `delen`. Een deel heeft als `soort` één van `path`, `circle`, `ellipse`, `rect`, `polygon` of `line`, met enkel de geometrische attributen van die soort (`d`, `cx`, `cy`, `r`, `rx`, `ry`, `x`, `y`, `width`, `height`, `points`, `x1`, `y1`, `x2`, `y2`) en de stijl `vul`, `lijn`, `lijnDikte`, `dekking`.
- Aanvulling (taak 3, taak 9c): een deel mag `vulLicht` en `lijnLicht` hebben (kleur of `geen`; `vulLicht` sinds taak 9c ook een verloop, voor een eigen lichte lucht): in het lichte thema gebruikt de renderer die, anders `vul`/`lijn`. Verder `lijnEinde` (`rond`, `recht`, `vierkant`), `lijnHoek` (`rond`, `scherp`, `schuin`) en, enkel op `rect`, `rx`/`ry` (afgeronde hoeken).
- Verlopen (`verloop: { soort: 'lineair'|'radiaal', stops: [{ op, kleur }] }`) mogen, als eigenschap van `vul`.
- `d` voldoet aan `/^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]{1,20000}$/`. Getallen zijn begrensd. Elke vorm heeft maximaal 400 delen, het hele pakket maximaal 3000.
- De app bouwt het SVG zelf op met `createElementNS` en een vaste lijst attributen. Er komt nooit een `innerHTML`, `href`, `style`, `on*`, `<script>` of `<foreignObject>` aan te pas. Een vorm is dus veilig door de manier waarop hij gebouwd wordt.
- In het spel wordt dezelfde vorm getekend met `Path2D` (enkel paden; andere soorten worden omgezet), wat even veilig is.

### 3.2 Rasterbeelden
- Toegelaten zijn enkel `data:image/png`, `data:image/webp` en `data:image/jpeg`. De server controleert de eerste bytes (magic bytes) tegen het opgegeven type. SVG als rasterbeeld wordt geweigerd: vectorwerk gaat via vormen.
- Elk beeld is maximaal 200 kB. Het hele pakket is maximaal **512 kB** (de JSON-tekst).
- Een beeld wordt getoond als `<img>` of CSS-achtergrond met de data-URI. Zo werkt het offline zonder dat de service worker iets moet doen.

### 3.3 Vaste bewegingen (in de app, niet in het pakket)

| `beweging` | Wat het doet | Opties | Plafond |
|---|---|---|---|
| `hoek` | statisch beeld in de schermhoeken (webben, slingers) | `hoeken` | 4 |
| `hangen` | beeld aan een draad dat zacht op en neer gaat (spin, kerstbal) | `aantal` | 3 |
| `kruipen` | kruipt langs de tabbalk en ontwijkt de muis | `aantal`, `langs` | 1 |
| `vliegen` | vliegt af en toe over het scherm in een golfbaan (vleermuis, vogel, rendier) | `aantal` | 2 |
| `vallen` | valt traag van boven (sneeuw, confetti, blaadjes) | `aantal`, `wiebel` | 12 |
| `opstijgen` | stijgt traag op (hartjes, ballonnen, bellen) | `aantal` | 8 |
| `vuurwerk` | af en toe een vuurwerkpluim met de themakleuren | `frequentie` | 1 tegelijk |
| `mist` | lichte nevel onderaan | — | 1 |

- Alle bewegende elementen samen: maximaal 16. Ze draaien in de bestaande lus van ±30 beelden per seconde, die pauzeert tijdens het spel en in een verborgen tab.
- Sober of verminderde beweging: enkel `hoek` en `achtergrond` worden getoond.
- `MAX_SPINNEN = 3` verdwijnt en wordt vervangen door de plafonds per beweging. `hangen + kruipen` samen blijft maximaal 3, zodat Halloween niet drukker wordt dan nu.

## 4. Opslag en API

**Blobs** (store `winkelNaam(req)`, `consistency: 'strong'`)
- `themas/index`: `{ versie, themas: [{ id, naam, aan, periodeOverride|null, pakketHash, geuploadOp, geuploadDoor }], gezaaid: [id…] }`
- `themas/pakket/<id>`: de pakket-JSON. Zo staat de index klein en wordt een pakket enkel geladen als het nodig is.

**Voorladen (zaaien):** de negen pakketten staan in de repo onder `netlify/themas/*.blitzthema.json`. Bij elke lezing zet de server elk pakket waarvan de id nog niet in `gezaaid` staat, in de opslag, met `aan: true`. Daarna komt het nooit opnieuw: een thema dat de beheerder uitzet, blijft uit, en een nieuwere versie in de repo overschrijft een upload niet. Dit gebeurt best-effort, net als het bewaren van event-skins in `spel`.

**`/api/themas`** (`netlify/functions/themas.js`, `beveiligV2`, `maakHandler({ getStore, nu, auth })`, CORS via `lib/http.js`, `Cache-Control: no-store`)

| Methode | Rol | Wat |
|---|---|---|
| `GET /api/themas` | alle rollen | De index zonder uploadgegevens, plus per thema de effectieve periode en `pakketHash`. Daarnaast de volledige pakketten van de thema's die vandaag actief zijn of binnen 14 dagen beginnen. |
| `GET /api/themas?id=<id>` | alle rollen | Eén pakket (voor voorbeeld, download en beheer). |
| `POST /api/themas` | beheerder | Upload van een pakket (nieuw of nieuwe versie, op id), met header `X-Blitz: 1`. Body maximaal 600 kB, anders 413. Ongeldig geeft 422 met een lijst Nederlandse foutmeldingen per veld. |
| `PATCH /api/themas` | beheerder | `{ id, aan?, periode? }` (periode `null` = terug naar die van het pakket). Optimistic locking op `versie` (409 + `serverVersie`), zoals bij `fotos`. |

- Een rij in `netlify/lib/rechten.js`: `'themas': { GET: ALLE, POST: BEHEER, PATCH: BEHEER }`. Het aantal functies in `tests/rechten.test.mjs` gaat van 50 naar 51.
- Elke upload en wijziging komt in de activiteitslog (`beheer-activiteit`).
- `themas/` gaat **niet** in `NIET_KOPIEREN`. De testwinkel krijgt dus een kopie, zodat de testmodus dezelfde thema's ziet.
- De validator is **één pure module** `public/js/kern/themapakket.js` (`valideerPakket(json) → { ok, fouten[] }`, `effectievePeriode`, `isActief`, `actiefThema(datum, lijst)`). Ze vervangt `kern/evenementen.js`, en client en server gebruiken ze allebei, net als `spel-regels.js`. Zo is er geen dubbele regel en geen pariteitsrisico. De client valideert een pakket uit de cache opnieuw voor hij het toont (diepteverdediging).

## 5. Client

**Cache en eerste schermopbouw**
- `localStorage` `blitz_themas` = `{ index, pakketten: { <id>: pakket } }`, enkel de pakketten die actief zijn of binnen 14 dagen beginnen. Een pakket wordt opnieuw opgehaald als `pakketHash` verandert. Er is een plafond van 1,5 MB; bij een volle opslag houdt de cache enkel het actieve pakket.
- `blitz_thema_actief` = `{ id, tot, kleuren, voorkeurThema }`: een klein record voor het inline script in `index.html`. Dat script vervangt de hardcode `d.month === '10'` door dit record. Het zet `data-event`, de kleurvariabelen (via `style.setProperty`, met waarden die al gevalideerd zijn) en het standaard licht/donker vóór de eerste schermopbouw.
- Offline start: de app gebruikt wat in de cache staat. Zonder cache is er geen thema; dat is nooit een fout.
- De sleutel `blitz_theme_<thema>_<jaar>` (eigen keuze licht/donker tijdens het thema) blijft, nu generiek op id.

**Versieringslaag** (`schermen/evenement-laag.js`, herschreven)
- Leest het actieve thema uit `kern/themapakket.js`, bouwt `#event-achtergrond` uit `achtergrond` en `#event-laag` uit `versiering`, met één bouwer per beweging. De Halloween-specifieke code (`SPIN`, `VLEERMUIS`, `WEB`, `evenement-scene.js`) verhuist als gegevens naar `halloween.blitzthema.json`.
- `css/evenement.css` wordt generiek: `:root[data-event]` gebruikt `--ev-accent*`, gezet door de laag, in plaats van `[data-event="halloween"]`. Print verbergt alles, zoals nu.
- De lege teksten (`legeTekst`) komen uit `teksten` van het actieve pakket.
- De bestaande gedragsregels blijven: minuutcontrole, herberekening bij terugkeer naar de pagina, pauze tijdens het spel, klikken gaan door de laag heen.

**Achtergrond altijd zichtbaar, ticketkaarten als mat glas** (Brent, 2026-10-22)
- Tijdens een thema met `achtergrond` mag geen effen schermvlak de tekening verbergen: de inhoudsvlakken van de tabbladen (wachtrij, kalender, route, ingepland, beschikbaarheden, rapporten …) zijn doorzichtig. De bovenbalk, de tabbalk en vensters (modals) blijven effen.
- Ticketkaarten (en vergelijkbare kaarten in de lijsten) worden mat glas: half doorschijnende achtergrond in de kleur van de kaart met `backdrop-filter: blur(…)`, zodat de achtergrond wazig doorschemert en de tekst leesbaar blijft (contrast ≥ 4,5:1 voor gewone tekst).
- Op gsm, tablet en aanraakschermen (sober) is het glas lichter (minder vervaging) zodat scrollen vlot blijft. Zonder ondersteuning voor `backdrop-filter`, of met `prefers-reduced-transparency`, krijgt de kaart een bijna-effen achtergrond.
- Zonder actief thema of zonder `achtergrond` verandert er niets aan het huidige uitzicht.

**Beheer → Thema's** (`schermen/beheer-themas.js`, enkel beheerder, `registreerBeheerTab`)
- Bovenaan: knop **Thema uploaden** (bestandskiezer, `.json`). De client valideert al met dezelfde module en toont de fouten in het Nederlands, nog vóór het verzenden. Bij een bestaande id vraagt hij "Nieuwe versie van <naam> uploaden?".
- Een kaart per thema met:
  - naam, periode als tekst, en een status: "nu actief", "begint over n dagen" of "uit", met de reden waarom een ander thema voorgaat bij overlap;
  - een schakelaar aan/uit;
  - **Periode aanpassen** (datums of, bij beweeglijk, dagen rond Pasen; "terug naar standaard");
  - **Voorbeeld** en **Stop voorbeeld**;
  - **Downloaden**, zodat Claude een bestaand pakket kan aanpassen;
  - een kleine weergave van de spelskin.
- Het patroon volgt `beheer-systeemstatus.js`: volgnummer tegen races, skelet, `beheerVerzoek`, `beheerFoutTekst`, `appConfirm` voor uitzetten.

**Instellingen → Dit toestel:** de schakelaar blijft. De uitleg leest het actieve of volgende thema uit de nieuwe module.

**Bewegende beelden uit, per gebruiker** (Brent, 2026-10-22): een nieuwe persoonlijke instelling `bewegingUit` (aan/uit, standaard uit = beweging toegelaten), bewaard bij het account zoals de andere instellingen (`kern/instellingen-regels.js`, `netlify/lib/instellingen.js`), dus geldig op al zijn toestellen. Staat ze aan, dan toont de app enkel de achtergrond en de hoekbeelden (zoals de sobere stand): geen hangende figuren, geen mist, geen vallende, opstijgende, vliegende of kruipende figuren en geen vuurwerk. Ook een technieker in de beperkte weergave (enkel "Dit toestel") kan de schakelaar zetten; zijn keuze wordt meteen bewaard in zijn eigen account. De schakelaar "Feestelijke versiering" per toestel (alles uit) blijft bestaan en gaat voor. De nieuwe schakelaar staat bij de persoonlijke instellingen, met als label "Bewegende beelden tijdens een thema".

## 6. Blitz Run

- `skins.js` houdt de tien basisskins en goud. De twee event-skins (`halloween`, `kerst`) en hun `EXTRAS` verdwijnen uit de code en komen in de pakketten. **De id's blijven `halloween` en `kerst`**, zodat bewaarde ontgrendelingen geldig blijven.
- Een themaskin is `{ id: <thema-id>, naam, soort: 'thema', behuizing, faceplate, bliksem, rand, extra: <vorm> }`. `tekenPaal` tekent `extra` met `Path2D` uit de vorm, in plaats van via een vaste functie.
- `spel-regels.js` krijgt de bekende themaskins en de actieve thema-id's mee (`ontgrendeldeSkins`, `ontgrendelVoorwaarde`, `schoonVoortgang`), in plaats van de statische lijst en `actieveEvenementen`.
- Server (`netlify/lib/spel.js`, `functions/spel.js`): leest `themas/index` en de nodige pakketten uit dezelfde store om de skins te kennen en de actieve thema's te bepalen (datum in Europe/Brussels, zoals nu). Dat blijft injecteerbaar voor tests. Een skin-id van een thema dat niet meer bestaat, kan niet bestaan (er wordt niets verwijderd). Een skin van een uitgezet thema blijft geldig voor wie hem al had.
- `spel-ui.js` (keuzerij en `skinVan`) gebruikt de samengevoegde lijst (basis + thema's). Een vergrendelde themaskin toont "<Naam>-thema" als voorwaarde.
- Elke themaskin moet de bestaande contrastregel halen (contour tegen de hemel ≥ 3:1). Die regel zit in de validator.

## 7. De negen voorgeladen pakketten

| id | Naam | Standaardperiode | Versiering (samengevat) | Spelskin |
|---|---|---|---|---|
| `nieuwjaar` | Nieuwjaar | 1-6 jan | vuurwerk, vallende confetti in goud en zilver, nachtlucht | Feestpaal (feesthoedje) |
| `valentijn` | Valentijn | 10-14 feb | opstijgende hartjes, roze accent | Liefdespaal (hartje) |
| `carnaval` | Carnaval | Pasen −52 tot −46 (do vóór tot Aswoensdag) | veelkleurige vallende confetti, slingers in de hoeken | Carnavalspaal (masker) |
| `pasen` | Pasen | Pasen −7 tot +1 | eieren in de hoeken, opstijgende bloesem, lentegroen | Paaspaal (konijnenoren) |
| `zomer` | Zomer | 1 jul-31 aug | zon in de hoek, opstijgende bellen, zacht zomeraccent | Zomerpaal (zonnebril) |
| `nationale-feestdag` | 21 juli | 19-21 jul | Belgische driekleur als slingers, vuurwerk | Driekleurpaal (vlaggetje) |
| `halloween` | Halloween | 1-31 okt | zoals nu: webben, 2 hangspinnen, 1 kruipspin, vleermuis, mist, scène | Spookpaal (heksenhoed) — bestaande id |
| `sinterklaas` | Sinterklaas | 1-6 dec | vallende pepernoten, mijter in de hoek, rood-goud | Sintpaal (mijter) |
| `kerst` | Kerst | 7-31 dec | vallende sneeuw, kerstballen die hangen, rendier dat overvliegt | Kerstpaal (kerstmuts) — bestaande id |

## 8. Tests

**Unit (`node --test`)**
- `themapakket.test.mjs`: validator (elke regel, onbekende sleutels, path-regex, magic bytes, maten, kleurformaat, contrast van de skin), periodes (vast, over de jaarwissel, Pasen- en Carnaval-offsets over meerdere jaren), overlap (kortste wint, gelijke lengte), periode-override.
- De negen pakketten in de repo zijn geldig (test laadt elk bestand).
- `versiering-logica.test.mjs`, `spel-skins.test.mjs`, `spel-regels.test.mjs` en `evenementen.test.mjs` worden aangepast of vervangen. Elke gewijzigde karakteriseringstest krijgt commentaar.
- `server-themas.test.mjs`: rechten (GET alle rollen, POST/PATCH enkel beheerder, `X-Blitz`), zaaien (één keer, uitzetten blijft), 413, 422 met fouten, 409, activiteitslog.
- `server-spel.test.mjs`: skins uit de themas-store, een bestaande `halloween`-ontgrendeling blijft geldig.
- `rechten.test.mjs`: 51 functies en de rij `themas`. `sw-schil.test.mjs`: nieuwe bestanden in SHELL en modulepreload, en de `CACHE_NAME`-bump.

**E2e (Playwright)**
- Een stub `/api/themas` in `e2e/helpers.mjs` (`maakStandaardStubs`), standaard met het Halloween-pakket. `versiering.spec.mjs` blijft groen.
- `beheer-themas.spec.mjs`: upload (geldig, ongeldig met foutmeldingen, nieuwe versie), aan/uit, periode aanpassen, voorbeeld enkel lokaal, download, tab enkel voor de beheerder (`beheer-rollen.spec.mjs` blijft gelijk voor planner en sales).
- Versiering per beweging (één pakket per soort beweging) en sober op gsm.
- `spel.spec.mjs`: een themaskin in de keuzerij, vergrendeld en ontgrendeld.
- Een productietest (`e2e/productie/`) controleert dat een upload enkel `POST /api/themas` schrijft.

## 9. Volgorde van bouwen

1. `kern/themapakket.js` met validator en periodes, plus tests. Het Halloween-pakket omzetten en vergelijken (zelfde aantal elementen, zelfde kleuren).
2. Server `/api/themas` met zaaien en rechten.
3. Versieringslaag en inline script data-gestuurd. `versiering.spec.mjs` groen op het Halloween-pakket.
4. Beheer → Thema's.
5. Blitz Run: data-gestuurde skins op client en server, met migratietest.
6. De andere acht pakketten maken; elk eerst als voorbeeld laten zien aan Brent.
7. Release v2.3.0: `CACHE_NAME` ophogen, CHANGELOG, volledige testrun, Brents ja.
