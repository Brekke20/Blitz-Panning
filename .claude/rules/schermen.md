---
paths:
  - "public/js/schermen/**"
  - "public/js/app.js"
---
# public/js/schermen

Verplaatst uit de CLAUDE.md in de hoofdmap (2026-10-29); laadt enkel bij werk aan de bestanden hieronder (paths). Staat in .claude/rules en niet in public/, omdat Netlify public/ online zet. De algemene regels staan in de hoofdmap.

## Schermen (`public/js/schermen/`)

Schermonderdelen die hun eigen toestand beheren (niet in `kern.toestand`), maar via `initRoute(afh)`, `initKaart(afh)`, `initWachtrij(afh)`, `initKalender(afh)`, `initIngepland(afh)`, `initCapaciteit(afh)` en de init-functies van etappe 5 in `DOMContentLoaded` initialiseren (vóór `koppelRenders`).

**Etappe 3 (Route en kaart):**
- `route-tijden.js`: pure berekeningen (aankomsttijden, samenvoegen met ankers, handtekening, dagklok). Unit-getest met `node --test`.
- `route-kaart.js`: Leaflet-kaart, markers, polylines, drukte-tekening, legende. Geen `L` of DOM op moduleniveau, enkel in functies.
- `route.js`: Route-scherm (lijst, weekstrook, berekenen, slepen, optimaliseren, vastleggen). Private toestand: `routeData`, `currentRouteDate`, `routeVerouderdDatum`, `_routeOrderBezig`, sorteer-instantie. Unit-tests: `tests/route.test.mjs` en `tests/route-volgorde.test.mjs` (naast `route-tijden`).

**Conventies:**
- Routetoestand (private: `routeData`, `currentRouteDate`, …) blijft buiten de store; lezers gebruiken exports: `routeActueelVoor(date)`, `routeOrderBezig()`, `vernieuwKaart()`, `invalideerKaartGrootte()`.
- Afhankelijkheden (functies uit andere schermen) worden via `afh` aangereikt; instellingen en toestandsgegevens uit `kern.toestand`.
- `kern.route.renderTelling()` is de teller die de e2e-tests gebruiken (interne aanroepen omzeilen een wrapper op `window`). Een wijziging in de planning geeft via het abonnement precies één route-render.
- `kern.route` is de namespace van het routescherm op `window.kern` (o.a. `renderTelling`); e2e-tests lezen daar de render-teller en de kaartaantallen uit.
- Knoppen van het scherm gebruiken `data-actie="route-..."` (delegatie in `route.js`) in plaats van inline handlers; gegevens staan op `data-*` attributen van de stop.
- Nieuwe schermen volgen dit patroon: module-privé toestand, expliciet aangereikte functies, exports voor lezers.

**Etappe 4 (Kalender en wachtrij):**
- `capaciteit.js`: vrije tijd per dag volgens de gedeelde plaatsingsregel `public/js/planner-tijdlijn.js` (`bouwDagItems`, `volgendeBeschikbareDag`, `capaciteitsKop`, lezers `capacityForDay` en `nextAvailableDay(van, ticketId)`); het vroegere aantalmodel (slots tellen) is vervangen (proefperiode-bugfix A17). Unit-getest met `node --test`.
- `wachtrij-logica.js`: pure berekeningen (zoeken, sorteren, scoren: `filterOpZoek`, `sorteerWachtrij`, `queueScore`). Unit-getest.
- `kalender-logica.js`: pure berekeningen (tijdlijnindeling, zichtbare dagen, maandraster: `bepaalLanes`, `zichtbareDagen`, `maandRaster`). Unit-getest met DST-weken.
- `wachtrij.js`: Wachtrij-scherm (kaarten, zoeken, sorteren, teller). Private toestand: `wqZoek` en de sorteerinstelling `wqSorteer`. Bevat ook `quickAdd`. Init via `initWachtrij(afh)` vóór `koppelRenders()`.
- `kalender.js`: Kalender-scherm (week/maand, kaarten, navigatie, teller). In de lijstweergave (indeling `smal`: dagen onder elkaar, de pagina scrolt) springt `kalLijstScroll` naar de kolom van de gekozen datum en, voor vandaag, naar de nu-regel (`lijstScrollDoel` in `kalender-logica.js`); die sprong volgt het `_kalAutoScrollKey`-patroon, wordt één tik na een render herhaald zolang de gebruiker niet zelf scrolde (de render loopt in `metBehoudScroll`, dat de oude scrollstand terugzet) en laat een scroll van de gebruiker met rust. Private toestand: `kalView`, `_kalAutoScrollKey`; de getoonde week/maand/dag volgt de gedeelde `toestand`-sleutel `gekozenDatum` (YYYY-MM-DD, bij de start vandaag, niet bewaard) die ook de Route-tab (datumkiezer, weekstrook; `route.volgGekozenDatum`), Ingepland en "Plan deze week" (week van de gekozen dag; maandweergave: idem met melding) gebruiken. Datumhulpen: `verschuifDatum`, `weekVerschil`, `volgendeWerkdagVan` in `kern/tijd.js`; `rolloverGekozenDatum()` (kalender.js) zet een verleden gekozen datum terug op vandaag bij terugkeer naar de pagina en in de minuutklok. Lezer: `kern.kalender.activeerKalender()`. De capaciteitskop wordt hier getekend. Init via `initKalender(afh)` vóór `koppelRenders()`.
- `ingepland.js`: Ingepland-scherm (kaarten, teller). Geen eigen weekverschuiving meer: de week volgt de gedeelde `gekozenDatum`. Init via `initIngepland(afh)` vóór `koppelRenders()`.

**Etappe 5a (Ticketdetail, voorstel, annuleren):**
- `ticketdetail-logica.js`: pure berekeningen (aankomsttijden, afrondingstijden, onderwerpschoning, termen: `tijdslotVoor()`, `roundToNextQuarterStr()`, `cleanTicketSubject()`, `joinNL()`, `meervoud()`, `telNummer()`, `bevestigdLabel()`, `heeftLopendVoorstel()`, plus de gedeelde constante `DOELGROEP_LABEL`). Unit-getest met `node --test`.
- `ticketdetail.js`: Ticketdetail-venster (taken, voorstel, annuleren, toewijzen, aankomst). Init via `initTicketdetail(afh)` vóór `koppelRenders()`. Private toestand: `activeTicket` en `_detailDate` (lezers `actiefTicket()`, `detailDatum()`) en `_kbIsDirty` (via `zetKbIsDirty`); `arrivalData` is een export (route en wizard lezen het). Knoppen gebruiken `data-actie`-delegatie; Zoho-functies verhuizen via productietest als vangnet.
- `voorstel.js`: Voorstelvenster (datum, tijd, ontvangers, voorbeeld, verzenden). Init via `initVoorstel(afh)`. Private toestand beheerd via accessors. Afh: `getPlanningTicket`, `sluitDetailStil`, `actiefTicket`, `zetActiefTicket`, `renderRouteList`.
- `annuleren.js`: Annuleervenster (reden, toelichting, mailkeuze). Init via `initAnnuleren(afh)`. Private toestand. Afh: `sluitDetailStil`, `actiefTicket`, `loadVoorstelStatus`, `renderRouteList`, `updateRouteBtns`, `inFlight`. `zetRedenenVoorTest` gooit buiten `?test`.
- `venster.js` export `registreerVenster({ el, isOpen, sluit, terugFocus })`: registreert per venster Escape-gedrag en focusbeheer; `terugFocus: () => HTMLElement | null` (optioneel) bepaalt waar de focus na sluiten terugkomt, en een venster dat vanuit een ander venster opent erft het terugkeerpunt (korte erfenisperiode) (de achtergrondklik loopt via `kern.ui.registreerBackdrop`); `venster.js` registreert zelf enkel nog de rapport-wizard (die sluit via `window.closeWizard`, zie hieronder).

**Conventies:**
- Afhankelijkheden (functies uit de app-schil `app.js`) worden via `afh` aangereikt; instellingen en toestandsgegevens uit `kern.toestand`.
- `kern.wachtrij.renderTelling()`, `kern.kalender.renderTelling()`, `kern.ingepland.renderTelling()` zijn de tellers die de e2e-tests gebruiken.
- Knoppen gebruiken `data-actie`-delegatie in plaats van inline handlers. Elke kaartluisteraar heeft een **bubbel-guard**: `if (e.target.closest('[data-actie]')) return;` om te voorkomen dat kaarten openen.
- `quickAdd` (`wachtrij.js`), de capaciteitskop (`n/cap · ±u`, getekend in `kalender.js`) en de volgorde van de Route-tab (`kern/selecties.js` `stopsVoorDag` met opties) gebruiken dezelfde plaatsingsregel (`planner-tijdlijn.js`: aankomst uiterlijk `laatsteStart`, 30 min reistijd per rit, items zonder uur in lijstvolgorde vanaf `vanTijd`). Het brein volgt dezelfde regel met echte reistijden.
- `kern.ui.strengeAfh(scherm, afh)` bewaakt de `afh`-objecten: een ontbrekende `afh`-sleutel gooit, zowel vóór als na de init.
- Blokkeringen en selecties gebruiken `kern.selecties.blokkeringenVoor` en `kern.ui.maakActiveerbaar`.

**Etappe 5b (Beschikbaarheid, afspraken, instellingen, planacties en de app-schil):**
- `klantbeschikbaarheid.js` (+ `-logica.js`): klantbeschikbaarheid per ticket (laden/bewaren met optimistic locking, `kbFor`, `kbBlocked`, `kbPreferred*`, het blok in het detail). De samenvoeg-logica staat puur in `klantbeschikbaarheid-logica.js` (`voegSamenKb`).
- `beschikbaarheid.js` (+ `-logica.js`): blokkeringen (venster en tab Beschikbaarheden). `nextWorkday` en `groupExceptionsForDisplay` krijgen de werkdagen als parameter en lopen niet meer vast zonder werkdag.
- `afspraken.js` (+ `-logica.js`): eigen afspraken (manueel venster, detail, importeren). Schrijven via `saveAfspraken(wijzigingen)`.
- `instellingen.js` (+ `-logica.js`): instellingen per persoon en tabblad Dit toestel; `valideerInstellingen` is puur en unit-getest. De prijsbeheer-knoppen lopen via `kern.prijzen`.
- `fotos.js`: foto's bij een ticket. Deelt `_fotoState` met de rapport-wizard (import-cyclus `fotos.js` <-> `rapport-wizard.js`, bewust gelaten: loskoppelen vraagt wizard-wijzigingen buiten D19).
- `rapport-verzenden.js`: rapportvoorbeeld, rapport versturen en `syncOplossingNaarZoho`. `sendBtn.onclick =` blijft een toewijzing (anders verstuurt elke preview meerdere keren).
- `planacties.js`: inplannen, uitplannen en "Plan deze week" (`addTicketToDate`, `removeTicketFromDate`, `bevestigUitplannen`, `autoPlan`).
- `public/js/app.js`: de app-schil (opstart, persoonkiezer, tabs, polling, `koppelRenders`, `reconcilePlanning`); het vroegere klassieke script. Het exporteert niets en start zichzelf op `DOMContentLoaded`. Schermmodules importeren `app.js` nooit: wat ze van de schil nodig hebben, krijgen ze via `afh`. Oudere modules mogen uit schermmodules importeren (eenrichting).
- Conventies: `init…(afh)` met `kern.ui.strengeAfh`; knoppen via `data-actie`, wijzigingen via `data-wijzig` en live invoer via `data-invoer` (`kern.ui.registreerWijzigActies`); vensters via `registreerVenster` en `registreerBackdrop`. Geen `onclick=`/`onchange=`/`oninput=` in `index.html` of in de HTML-strings van modules.
- Gedocumenteerd restant: de rapport-wizard blijft inline handlers gebruiken (30 in `rapport-wizard.js`, D2) en biedt daarvoor het `wiz*`-blok op `window` aan, plus `openRapport`, `closeWizard`, `printRapport`, `calcWerktijdMin`, `berekenLoonkost` en de `_fotoState`-accessor. Andere `window`-namen die blijven omdat de wizard of `outbox.js` ze als kale naam leest: `PRIJZEN`, `PRIJZEN_DEFAULTS`, `zoekOnderdelen`, `getAlleTags`, `renderRapportArchief`, `registreerVerbruik`, `outboxAdd`, `runOutboxItem`, `nextOutboxAction`, `refreshOutboxCache`, `_outboxItems`, `appConfirm` en de `apparaat`-familie (`apparaat.js`, klassiek script). Specs lezen het rapportarchief via `kern.rapportArchief.lijst()` en `.versie()`.
- Ticketlading en de balk "Gegevens van HH:MM — Zoho even niet bereikbaar": `loadTickets` (app.js) leest `X-Blitz-Verouderd` en `X-Blitz-Leeftijd` van `/api/tickets` (`kern/gegevens-stand.js`, puur, unit-getest) en toont `#tickets-verouderd` (bovenaan `#hoofdinhoud`, niet vastgeplakt) enkel bij een toegepaste lading die een terugval van de server was; een gewone lading verbergt hem. De knop Vernieuwen (`data-actie="vernieuw"`) vraagt `?vers=1` (de server remt tot één geforceerde lading per 30 s). Spec: `e2e/productie/tickets-verouderd.spec.mjs` (de stub van `helpers.mjs` ondersteunt extra antwoordkoppen via `headers`).
- Nieuw bestand in `public/js/`: dezelfde commit zet het in `SHELL` van `public/sw.js`.

**Etappe 7 (Technieker):**
- `rapport-verzenden.js`: de rijknop gaat vóór de bevestiging van een eerder gedetecteerde mail op slot en komt bij 'Terug' weer open. Na een onzeker resultaat controleert `kern/mailcontrole.js` of de mail al weg is; tijdens de controle blijft de knop op slot.
- `excel-export.js` wordt pas bij de eerste export geladen (dynamische import in `app.js`; niet in `index.html`) en haalt ExcelJS via `kern/exceljs.js`.
- Lokale afspraakkaarten in de kalender zijn met het toetsenbord te openen (`maakActiveerbaar`).
- Gedocumenteerd restant (N12): een route-volgorde slepen tijdens een render kan af en toe geannuleerd worden (`applyRouteOrder` werkt op verouderde objecten; vastgelegd in `e2e/route-slepen-render.spec.mjs`, bewust niet gewijzigd: W11). Ook `negeerSchrijfstand` in `loadTickets` (aangeroepen door `route.js`) slaat de hele schrijfstand-controle over in plaats van enkel het routedeel; zeldzaam, bewust gelaten.
