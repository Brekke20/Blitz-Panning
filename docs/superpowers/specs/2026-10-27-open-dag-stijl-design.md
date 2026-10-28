# Nieuwe stijl "Open dag" — ontwerp

Datum: 2026-10-27 · Opdrachtgever: Brent · Doelversie: v2.5.0 (MINOR)
Mockup (goedgekeurde keuze = de kaart "Keuze"): `docs/superpowers/specs/assets/2026-10-27-open-dag-mockup.html`
(ook als privé-artifact: https://claude.ai/artifact/YbEhoQyNUo1JgxkPuAECQy). Open het bestand in een browser; bovenaan kies je scherm,
modus, tijdstip en lichtbron. Waar deze spec en de mockup verschillen, wint deze spec.

## Waarom

Brent wil een modernere tool. Uit drie stijlrichtingen koos hij "Open dag" (melkglas onder een hemel met groene horizon), en daarbinnen
de combinatie: zijkolom links (versie C2), glans in de knop bij hover (C1) en een gloeiende rand rond tickets (C3). Planners werken op de
pc, techniekers op de gsm in het veld.

## Doelen

1. De hele app (alle rollen, alle schermen, licht en donker, pc/tablet/gsm) krijgt in één release de stijl Open dag.
2. Glazen kaarten zijn altijd zichtbaar, niet enkel tijdens een thema.
3. Knoppen reageren bij hover met een vervagend effect (glans), nergens nog met springen of vergroten.
4. De achtergrond is een hemel die het uur van de dag volgt, in beide modi.

## Niet-doelen

- Geen wijziging aan wat de app doet: zelfde schermen, knoppen, volgordes, teksten in knoppen, gegevens en serververkeer. Enige nieuwe
  inhoud: de korte samenvatting onder de paginatitel (zie onder).
- Geen wijziging aan de rapport-PDF (server-Chromium), aan mails naar klanten en aan de Excel-exports.
- Geen naast-elkaar-periode of schakelaar oud/nieuw (keuze Brent: in één keer vervangen).
- Geen nieuwe tabbladen of herschikking van wat een rol mag zien.

## Anti-doelen (mislukt, ook al werkt het)

Keuze Brent. De release is mislukt als:
- **techniekers zoeken**: een technieker vindt een knop of scherm niet terug zonder uitleg. Niets dat nu op de gsm zichtbaar is, mag
  naar een verborgen menu verhuizen, tenzij hieronder uitdrukkelijk zo beschreven;
- **slecht leesbaar buiten**: tekst op het glas is op de gsm in fel daglicht moeilijk te lezen;
- **trager**: de app voelt trager aan bij openen of scrollen dan v2.4.x, vooral op eenvoudige Android-toestellen.

Minder dichtheid op de pc is uitdrukkelijk GEEN anti-doel (Brent vinkte het niet aan), maar zie "Dichtheid".

## Aanpak

Drie manieren overwogen:

1. **Een laag erbovenop** — een extra stijlblad over de huidige opmaak. Snelst, laagste breukrisico, maar oude en nieuwe opmaak vechten
   tegen elkaar en de app sleept dode opmaak mee.
2. **De bestaande opmaak omvormen** — tokens, componenten en het glas van Open dag vervangen de huidige opmaak op de plek waar ze nu staat;
   het themaglas (`css/evenement.css`) wordt het gewone glas; de tabbladen blijven één lijst die CSS als zijkolom of als dok toont.
3. **De schil opnieuw bouwen** — nieuwe kop/navigatie-markup en JS. Meeste vrijheid, grootste risico (rollen, Sales, sticky-balken, tests),
   terwijl de werking niet verandert.

**Gekozen: 2** (keuze Brent, op aanbeveling). Gevolg: de bestaande DOM-structuur, id's en klassen die JS en tests gebruiken (`.tabs-inner`,
`.tab`, `#tab-<id>`, `.topbar-sticky`, `.view`, `.lijst-balk`, ...) blijven bestaan; wat verandert is opmaak, plus de kleine
markup-toevoegingen die hieronder staan.

## Huidige toestand (wat dit raakt)

- Schil in `public/index.html`: `.topbar-sticky` met `<header>` (logo, TEST-badge, persoonkiezer `#person-sel`, knoppen vernieuwen,
  thema, instellingen; het gebruikersmenu/avatar komt uit `schermen/gebruikersmenu.js`) en `<nav>` → `.tabs` → `.tabs-inner` met
  `.tab`-knoppen en een glijdende onderlijn (`.tabs::after`, `--ind-left/--ind-width` gezet door JS).
- Tabbladen per rol: `schermen/rol-schil.js` (`registreerTabs`, `maakTab` voor tabs die `index.html` niet kent: Beheer, de vier
  sales-tabs uit `schermen/sales-registratie.js`). Tabs krijgen enkel `textContent = label`. Route (`alleenGroot`) bestaat niet op `smal`.
  De beheerder wisselt van werkruimte (Techniek/Sales) en de tabvolgorde wordt dan herschikt.
- Toestel: `apparaat.js` zet op `<html>` `data-apparaat` (gsm/tablet/computer), `data-indeling` (smal/tablet-staand/breed),
  `data-aanraak`, `data-rol`.
- Sticky: `sticky-offset.js` meet `.topbar-sticky` + meldingsbalken en zet `--sticky-top`; elke balk onder de tabs plakt op
  `top: var(--sticky-top)`.
- Tokens: `css/base.css` (`:root` donker, `[data-theme="light"]`). Componenten: `css/app.css` (1354 regels) en de schermbladen
  `wizard`, `prijzen`, `inventaris`, `inloggen`, `beheer`, `sales`, `dashboard`. Letter: Inter via Google Fonts.
- Glas en thema's: `css/evenement.css` maakt kaarten glas enkel bij `:root[data-event][data-event-achtergrond="ja"]`, met eigen
  tekstkleuren voor contrast; `e2e/versiering.spec.mjs` (`@contrast`) meet dat contrast over de echte achtergrond.
- Knoppen bewegen nu bij hover (`translateY`/`scale` op `.btn`, `.hbtn`, `.btn-add`, `.ticket`, `.filter-pill`, ...).

## Het ontwerp

### Opbouw per toestel (beslist)

| `data-indeling` | Navigatie | Bovenaan de inhoud |
|---|---|---|
| `breed` (pc, liggende tablet) | **Zijkolom**: zwevend glazen paneel links (± 228 px breed, 14 px van de randen, hoeken 30 px), volle hoogte. Bovenaan logo + "Blitz Planning", dan de tabbladen onder elkaar (icoon + naam + teller rechts), onderaan de persoonkiezer over de volle breedte. | **Paginakop**: grote titel van het actieve tabblad (Bricolage Grotesque ± 26 px) met eronder de samenvatting; rechts TEST-badge, rolbadge, vernieuwen, thema, instellingen, avatar (ronde glazen knoppen). |
| `tablet-staand`, `smal` (gsm) | **Dok**: zwevend glazen balk onderaan (12 px van de zijkanten, boven de veilige zone), elk tabblad als icoon boven een kleine naam. | **Kop**: logo + naam links, persoonkiezer (kort: "Alle"), vernieuwen, thema, instellingen en avatar rechts. Geen grote titel. |

- Alles wat nu in de kop staat, blijft op elk toestel zichtbaar (anti-doel "techniekers zoeken"). Mijn keuze, afwijkend van de mockup
  (die verborg vernieuwen/thema/instellingen op de gsm): niets verdwijnt in een menu. Past het op 360 px niet, dan krimpen de knoppen
  (icoon zonder rand) en mag het logo de naam inkorten; nooit horizontaal scrollen van de pagina.
- **Dok met meer dan 5 tabbladen**: de eerste 4 in de volgorde van de rol, als 5e "Meer" (icoon drie puntjes) dat een glazen
  blad van onderen opent met de overige tabbladen. Komt in de praktijk enkel voor bij planner/beheerder op een gsm of staande tablet;
  een technieker heeft er hoogstens 5 (Kalender, Ingepland, Inventaris, Rapporten, plus Wachtrij met "Mag zelf plannen"; Route bestaat
  niet op `smal`). Een tabblad dat in "Meer" zit en actief is, maakt "Meer" actief.
- Tabbladen krijgen een icoon. Eén register (id → icoon) dekt alle tabs, ook die van `rol-schil.js`/`sales-registratie.js`:
  tickets/Wachtrij, kalender, planning/Route, gepland/Ingepland, inventaris, rapporten, beheer, sales-lijst/Leads, sales-kalender,
  sales-route, sales-afgewerkt. Iconen als inline SVG (lijnstijl 1,8 zoals in de mockup), geen emoji, geen extra bibliotheek.
- De glijdende onderlijn van de tabbalk verdwijnt; het actieve tabblad is een lichtere glazen pil met groen icoon en groene teller.
- De tellers (`#cnt-tickets`, `#cnt-gepland`, `#cnt-inventaris` met `badge--op`/`badge--bijna`) behouden hun betekenis en kleuren.

### Paginatitel en samenvatting (beslist: "waar het zinvol is")

Enkel op `breed`. Titel = naam van het actieve tabblad. Samenvatting enkel op schermen met cijfers, uit gegevens die de app al heeft
(geen nieuwe serveraanroep):

- Wachtrij: "N tickets wachten op een datum" + ", M verlopen" als M > 0.
- Kalender: "Week W · N stops gepland" + ", M zonder datum" als M > 0 (week van `gekozenDatum`).
- Ingepland: "N afspraken deze week" + ", M wachten op bevestiging" als M > 0.
- Inventaris: "N producten onder hun meldgrens" of "Alles boven de meldgrens".
- Leads (sales): "N open leads".
- Andere schermen: enkel de titel.

Formulering, enkelvoud/meervoud (`meervoud()` bestaat al) en exacte bron per scherm laat ik aan de bouwer, als pure functie met
unit-tests. De samenvatting volgt de toestand via het bestaande abonnement (`koppelRenders()`), geen eigen polling.

### Hemel (beslist)

- Vier tijdstippen in beide modi: **ochtend** (zon links, perzik), **middag** (helder, lichte gloed rechtsboven), **avond** (zon rechts,
  oranje), **nacht** (donkerder, in donker met enkele sterren). Altijd een groene horizongloed onderaan. Kleuren: zie de tokens
  `.app[data-tijd=...]` in de mockup; die zijn het vertrekpunt, contrastmeting mag ze bijsturen.
- Grenzen (mijn keuze, de bouwer mag verfijnen): ochtend 05–10 u, middag 10–17 u, avond 17–21 u, nacht 21–05 u, Europe/Brussels.
  Wissel bij de minuutcontrole die de versiering al heeft en bij terugkeer naar de pagina; geen animatie van het verloop (wisselt hooguit
  vier keer per dag).
- De hemel is CSS (verlopen), geen afbeelding, geen canvas, geen beweging.
- **Thema actief met achtergrond** (keuze Brent): de scène van het thema vervangt de hemel. Glas, vormen en knoppen blijven die van Open
  dag. De themakleuren (`--ev-*`) blijven werken zoals nu; de regel "statuskleuren nooit overschrijven" blijft.
- Nooit in print (zoals de versiering nu).

### Glas en kaarten

- Glas = halfdoorschijnende kaartkleur + vervaging + fijne lichte rand + lichtrand bovenaan. Startwaarden uit de mockup: donker
  wit 7,5 %, licht wit 52 %, vervaging 28 px.
- **Snelheid voorop** (keuze Brent): op `data-apparaat="gsm"` minder vervaging (startwaarde 10 px) en een hogere dekking; op
  `tablet` en `computer` het volle effect. Bij `prefers-reduced-transparency: reduce` of zonder `backdrop-filter`-ondersteuning:
  bijna effen kaarten (zoals `--ev-glas-vast` nu). Exacte waarden bepaalt de bouwer met meting (zie Toetsing).
- Wat glas wordt: alle kaarten en rijen in lijsten (`.ticket`, `.cal-ticket`, `.cal-local-event`, `.stop`, `.inv-row`, `.sales-*`-kaarten,
  rapportrijen), de zijkolom, het dok, de paginakop-knoppen, zoek- en filtervelden, de kalender als één glazen vlak, vensters
  (`.modal`-familie, sterker gedekt), het meldingsvak, de persoonkiezer en zijn menu. Het themaglas uit `css/evenement.css` gaat op in
  deze ene regel; wat daar themaspecifiek blijft (scène, versiering, `--ev-*`) blijft daar.
- Vormen: kaarten 22 px (gsm 26 px), vensters 28 px, knoppen en velden als pil, kalenderafspraken 16 px. Kaarten in de wachtrij ruimer
  op gsm dan op pc (zie Dichtheid).
- **Gloed langs de omtrek** (keuze Brent): de rand van een ticketkaart licht op in de kleur van de urgentie, met een zachte schijn naar
  binnen en buiten en een lichte tint linksboven. Rood = verlopen of hoog, oranje = middel of wacht op bevestiging, groen = laag of
  bevestigd, paars = eigen afspraak (kalender). Ook op kalenderafspraken en op de rand van het ticketdetail-venster (kleur van dat
  ticket). De bestaande linkerbalk (`.ticket.overdue::before`, statusbalken) verdwijnt in ruil voor deze gloed.
- Tekst op kaarten: in donker bijna wit / lichtgrijs, in licht donkerblauw/grijs, zoals nu bij een thema, zodat 4,5:1 haalbaar blijft.

### Knoppen

- Elke klikbare knop (primair, secundair, gevaar, ronde icoonknoppen, de "+"-knop, tabbladen in zijkolom en dok, persoonkiezer) krijgt
  bij hover **glans**: een zachte witte lichtvlek bovenaan die in ± 0,4 s invervaagt en bij verlaten uitvervaagt. Daarnaast vervagen
  achtergrond, rand en tekstkleur (± 0,28 s).
- Alle hover-sprongen (`translateY`, `scale`) verdwijnen. Een korte indruk bij klikken (`:active`) mag, als kleurverandering.
- Primaire knop: groen verloop (#2df0bb → #00d49b) met donkere tekst; secundair: glazen pil; gevaar: rode rand en tekst.
- `prefers-reduced-motion`: overgangen worden zo goed als ogenblikkelijk (bestaande regel in `base.css` blijft gelden).
- Aanraaktoestellen: geen hover, dus geen glans; de focusring (`:focus-visible`) blijft overal zichtbaar.

### Letters

Bricolage Grotesque (titels, paginakop, kaarttitels, venstertitels, grote dagnummers) en Figtree (alle andere tekst) via Google Fonts,
ter vervanging van Inter. Gewichten: Figtree 400/500/600/700, Bricolage 500/700. `font-display: swap`. De SW-cache voor Google Fonts
(`FONT_HOSTS`, stale-while-revalidate) dekt dit al.

### Dichtheid

Keuze Brent: per toestel. Op `breed` iets compacter dan de mockup (kaartpadding ± 15/18 px, tussenruimte 10 px), op `smal` ruimer
(18/20 px, 12 px). Brent vinkte "minder op het scherm" niet aan als mislukking, dus de bouwer hoeft de huidige dichtheid niet te halen,
maar mag ze ook niet zonder reden verder laten zakken dan de mockup.

### Schermen die de mockup niet toont

Zelfde regels toepassen; geen nieuwe indeling, geen verplaatste knoppen:
- **Route**: de Leaflet-kaart blijft ondoorzichtig; de lijst met stops wordt glas; de weekstrook en balken als glazen pillen.
- **Ingepland, Inventaris, Rapporten, Beheer (+ subtabs), Prijzen, Dashboard, Sales (Leads, Kalender, Route, Afgewerkt)**: kaarten en
  rijen glas, balken als glas over de volle breedte van de inhoudskolom, tabelkoppen leesbaar.
- **Rapport-wizard** (volledig scherm venster, `css/wizard.css`): sterk gedekt glas, zelfde knoppen; de inline handlers blijven
  (gedocumenteerd restant).
- **Inloggen**: hemel als achtergrond, één glazen kaart in het midden.
- **Vensters, meldingsvak (toast), offline- en outbox-balk, skeletten**: Open dag-vormen en -kleuren; de offline/outbox-balken blijven
  meteen opvallen (eigen effen kleur, geen glas).
- **Blitz Run (spel)**: buiten scope, behalve dat het overlay op de nieuwe achtergrond goed blijft staan.

## Randvoorwaarden

- Alle bestaande id's, klassen, `data-actie`/`data-arg`-attributen en ARIA-rollen die JS of tests gebruiken blijven; de zijkolom en het
  dok zijn dezelfde `.tabs-inner role="tablist"` met dezelfde `.tab`-knoppen, enkel anders opgemaakt (en een icoon-`<svg>` vóór het label).
  Nieuwe elementen (paginakop, "Meer"-blad) krijgen eigen klassen.
- `sticky-offset.js` blijft de enige bron van `--sticky-top`. Op `breed` moet `--sticky-top` de onderkant van de paginakop worden (de
  zijkolom zit niet boven de inhoud); op `smal` de onderkant van de kop. Het dok onderaan vraagt onderaan de inhoud ruimte (hoogte dok +
  veilige zone), ook voor het meldingsvak en vensters met knoppen onderaan.
- Werkt met de bestaande toestelregels (`apparaat.js`, ook de handmatige weergavekeuze `blitz_weergave`).
- Contrast: elke tekstkleur op glas haalt 4,5:1 over wat er echt achter ligt, voor de vier tijdstippen × licht/donker, en voor de thema's
  zoals nu. Statuskleuren (`--red` ...) worden nooit overschreven.
- Projectregels: nieuw bestand onder `public/js/` → in dezelfde commit in `SHELL` van `public/sw.js` (en modulepreload als eager);
  `CACHE_NAME` ophogen bij de release; `CHANGELOG.md` + versie 2.5.0; geen `onclick=` in nieuwe markup; ExcelJS-regels ongewijzigd.

## Toetsing

- Bestaande suites blijven groen: `node --test` en de volledige Playwright-run (chromium + sw), inclusief de `@contrast`-proeven.
  Tests die aan opmaak vasthangen (bv. de glijdende onderlijn, hover-transforms) worden bewust aangepast, met commentaar.
- Nieuwe e2e: navigatie als zijkolom op `breed` en als dok op `smal`/`tablet-staand`; "Meer" bij > 5 tabs; elke rol (planner,
  beheerder in beide werkruimtes, technieker met en zonder "Mag zelf plannen", sales, sales manager) ziet dezelfde tabbladen als nu;
  hemel per tijdstip met de nepklok; paginatitel en samenvatting; geen hover-transform meer; effen kaarten bij verminderde transparantie.
- Nieuwe `@contrast`-proeven voor de hemel (4 tijdstippen × 2 modi × pc en gsm), naar het model van `e2e/versiering.spec.mjs`.
- Snelheid: meet op een gesimuleerd traag toestel (CPU-vertraging in Chromium) de opstarttijd en het scrollen van de wachtrij en de
  kalender, vóór en na; "na" mag niet merkbaar slechter zijn. Rapporteer de cijfers.
- Visuele controle: schermafdrukken van elk scherm in licht en donker op pc en gsm voor Brent, vóór de release.

## Beslissingen na de bouwerscheck (keuzes van Claude, door Brent na te lezen)

1. **"Meer" in het dok.** Telt de tabbladen die voor die rol en dat toestel echt zichtbaar zijn (na `alleen-groot`, `coord-only`,
   `hidden`). Bij meer dan 5: JS zet een klasse op de overtollige `.tab`-knoppen zodat het dok ze verbergt, en het "Meer"-blad toont
   voor elk ervan een eigen knop (`data-actie="hoofdtab"`, zelfde `data-arg`) die hetzelfde doet. De echte `.tab`-knoppen blijven in
   `.tabs-inner` staan: geen verplaatsing, geen kopie met dezelfde id. Planner/beheerder op gsm: Wachtrij, Kalender, Ingepland,
   Inventaris, Rapporten, Beheer = 6, dus "Meer" met Rapporten en Beheer.
2. **Tests.** Functionele e2e-tests blijven ongewijzigd groen (ze klikken via `#tab-<id>`, dat blijft). Enkel beweringen over opmaak
   (onderlijn, hover-transform, vaste hoogtes of posities van de kop) mogen aangepast worden, elk met commentaar waarom.
3. **Snelheid op gsm, terugvalvolgorde.** Eerst minder vervaging (10 px). Is de meting dan nog slechter dan v2.4.x, dan krijgen
   kaarten en rijen in lijsten op `gsm` geen `backdrop-filter` meer (enkel een halfdoorschijnende kaartkleur, met de gloed en de rand);
   dok, kop en vensters houden hun vervaging. Dat mag zonder nieuwe vraag aan Brent (hij koos "snelheid voorop").
4. **Kop op 360 px.** Wat wijkt, in deze volgorde: de tekst "Blitz Planning" (het bliksemicoon blijft), dan de randen van de
   icoonknoppen, dan de TEST-badge wordt een klein label boven het logo. Nooit een tweede regel, nooit iets verbergen, nooit horizontaal
   scrollen.
5. **Paginakop op `breed`** plakt bovenaan de inhoudskolom (sticky, meeschuivend met niets); `--sticky-top` = onderkant paginakop +
   meldingsbalken, en de bestaande balken (`.lijst-balk`, `.kal-header`, ...) plakken daaronder zoals nu onder de tabbalk.
6. **Hemeltokens.** De mockup bevat alle acht varianten (4 tijdstippen × licht/donker); die worden overgenomen. Haalt een tekst geen
   4,5:1, dan eerst de tekstkleur aanpassen, dan de dekking van het glas verhogen; de hemelkleuren zelf enkel als laatste.
7. **Thema's en contrast.** De negen bestaande `@contrast`-proeven moeten blijven slagen met dezelfde drempel (4,5:1); de
   themaspecifieke tekstkleuren mogen wijzigen, de drempel niet.
8. **Gloedkleuren.** Eigen tokens (bv. `--gloed-rood`) afgeleid van de statuskleuren met `color-mix`, zodat `--red` en co nooit
   overschreven worden; paars voor eigen afspraken komt van het bestaande `--purple`.
9. **Tablet staand** krijgt het dok; een smalle iconenkolom blijft een idee voor later, er wordt niets voor voorbereid.
10. **Letters offline.** Bij de allereerste start zonder verbinding mag de app met systeemletters tonen; daarna haalt de SW-cache
    Google Fonts. Geen zelf gehoste letters.

## Aan de bouwer gelaten

Exacte tokenwaarden na contrastmeting; de gsm-vervaging en -dekking na snelheidsmeting; de tijdsgrenzen van de hemel; de volgorde van
het werk; hoe de CSS over de bestaande bladen verdeeld wordt (zolang er geen tweede, overlappende laag ontstaat); de exacte vorm van de
iconen; de formulering van de samenvattingen; hoe het "Meer"-blad sluit (buiten tikken, Escape, `registreerVenster`).

## Open punten voor later (niet in deze release)

- Een instelling om de hemel vast te zetten op één tijdstip.
- Tablet staand met een smalle iconenkolom in plaats van het dok.
