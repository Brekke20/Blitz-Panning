# Betrouwbare rapport-verzending (outbox + herhaling + foutenlog)

**Datum:** 2026-08-11
**Status:** Approved, ready for implementation plan

## Aanleiding

Technici melden dat een service-rapport soms niet doorkomt wanneer het vanaf een telefoon wordt afgesloten. Bij het opnieuw aanmaken op een PC bleken de foto's al bewaard te zijn — dat deel loopt via `saveFotos()`/`persistFotoChange()` ([public/index.html:4653](public/index.html:4653)) en wordt per foto onmiddellijk en apart naar de server gestuurd, los van het rapport zelf. Het probleem zit dus specifiek in de laatste stap.

**Root cause.** `printRapport()` ([public/index.html:6289](public/index.html:6289)) doet drie dingen kort na elkaar: (1) `window.open(blobUrl, '_blank')` om het afdrukvoorbeeld te openen, (2) **niet-afgewacht** `archiveerRapport(html)` en (bij een Zoho-ticket) `uploadRapportToZoho(...)` starten, en (3) synchroon de wizard sluiten. Op een telefoon duwt stap (1) de huidige tab naar de achtergrond; mobiele browsers pauzeren/onderbreken JS-uitvoering in achtergrond-tabs vaak binnen enkele seconden. Als dat gebeurt vóór de fetch in stap (2) een antwoord heeft, wordt de poging halverwege afgebroken — zonder dat een `catch`-blok ooit bereikt wordt, want de JS-context zelf ligt stil. Er is vandaag geen lokale wachtrij: een mislukte poging is gewoon weg, met enkel een 5s-durende toast als (makkelijk gemiste) melding.

**Bijkomende risicofactor.** De payload van `archiveerRapport()` bevat `rapportData: {...R, _html: html}` — dat is `R.fotos` (elk met een base64 `dataUrl`) én de volledig gerenderde HTML met die foto's er nogmaals in ingebed. Dit maakt net deze aanroep een van de grootste/traagste in de app, en dus het meest gevoelig voor exact het bovenstaande race-probleem op een zwakke mobiele verbinding.

## Scope

Enkel het moment van rapport-afsluiten in `printRapport()`: de `archiveerRapport()`-call en de `uploadRapportToZoho()`-call. Foto-uploads tijdens de interventie, en alle andere server-calls in de app, blijven buiten scope.

## 1. Lokale wachtrij ("outbox") — client-side

Nieuw, klein IndexedDB-store (niet `localStorage`: de payload per rapport kan enkele MB's zijn door ingebedde foto's, en `localStorage`'s paar MB quotum raakt te snel vol als er op een dag met slecht signaal meerdere rapporten opstapelen).

Bij het klikken op afdrukken/verzenden komt een rapport **eerst** in deze wachtrij terecht — vóór er iets naar het netwerk gestuurd wordt — zodat de poging een app-crash of volledige afsluiting overleeft. Elk item houdt bij: het rapport zelf (html + de velden voor het archief), het gekoppelde ticket (of `isLocal` als er geen Zoho-ticket is), en per stap of die al bevestigd gelukt is (`archived`, `zohoUploaded`). Een rapport wordt pas uit de wachtrij verwijderd zodra **alle** relevante stappen bevestigd zijn.

Een vast, client-gegenereerd id (`crypto.randomUUID()`) wordt aangemaakt bij het toevoegen aan de wachtrij en meegestuurd als `id` in de archiveerRapport-body — `rapport-archief.js` accepteert dit al ([netlify/functions/rapport-archief.js:69](netlify/functions/rapport-archief.js:69)). Dat ene id identificeert het rapport doorheen client én server, en wordt hergebruikt in de dubbele-bijlage-check (zie sectie 4).

## 2. Verzendflow in `printRapport()`

`printRapport()` blijft het afdrukvoorbeeld tonen zoals nu, maar de volgorde en timing veranderen:

1. Html bouwen (ongewijzigd).
2. Rapport toevoegen aan de outbox.
3. Eén gedeelde functie `attemptOutboxItem(item)` starten — voert de nog-niet-bevestigde stappen uit (archiveren, en indien van toepassing de Zoho-upload, zie sectie 4).
4. Deze aanroep krijgt hier **een kort venster (~5s)** om te bevestigen, via een race tussen de aanroep en een timer — **niet** door de aanroep zelf af te breken. Bevestigt het binnen dat venster → normale "✅ bewaard"-toast, item verdwijnt uit de wachtrij, afdrukvoorbeeld opent. Bevestigt het niet binnen dat venster (traag, of al mislukt) → afdrukvoorbeeld opent sowieso, blijvend "⏳ nog niet bevestigd"-signaal verschijnt (sectie 3), en de lopende poging draait op de achtergrond door — wat ze ook doet, ze werkt verder op **dezelfde** wachtrij-entry.
5. Wizard sluiten (ongewijzigd, synchroon — dit hangt niet meer af van of de verzending al klaar is).

De bestaande `_rapportUploaded`-guard ([public/index.html:6302](public/index.html:6302)) blijft behouden om dubbele wachtrij-items binnen één wizard-sessie te voorkomen.

## 3. Automatische herhaling + blijvend signaal

`flushOutbox()`: doorloopt alle wachtrij-items en roept voor elk `attemptOutboxItem(item)` aan (zonder het 5s-tijdsvenster — hier mag het gewoon zo lang duren als nodig). Wordt aangeroepen bij:
- app-opstart (`DOMContentLoaded`, naast de bestaande `laadRapportArchief()`-aanroep op [public/index.html:1899](public/index.html:1899)),
- `window.addEventListener('online', ...)`,
- `document.addEventListener('visibilitychange', ...)` wanneer het scherm terug zichtbaar wordt.

**Zichtbaar signaal:** een nieuwe sticky banner (zelfde patroon als `#offline-banner`, [public/index.html:856](public/index.html:856)) die verschijnt zolang de wachtrij niet leeg is: *"⏳ N rapport(en) nog niet bevestigd — wordt automatisch opnieuw geprobeerd"*, klikbaar om direct een `flushOutbox()` te forceren. Verdwijnt automatisch zodra de wachtrij leeg is. Extra: in `renderRapportArchief()` ([public/index.html:6410](public/index.html:6410)) krijgt een rij waarvan het bijhorende wachtrij-item nog niet volledig bevestigd is een kleine "⏳ In wachtrij"-tag, zodat het ook zichtbaar is op het Rapporten-tabblad.

Geen limiet op het aantal pogingen — een rapport blijft in de wachtrij en het signaal blijft staan tot het echt lukt (bevestigd in sectie "Ja, klopt zo" van het ontwerpgesprek). Een blijvend niet-lukkend rapport is zichtbaar precies daardoor, in plaats van stil te verdwijnen.

**Gekende grens:** dit werkt zodra de app open/zichtbaar is of terug verbinding heeft — er is geen garantie dat verzending ook gebeurt terwijl het scherm van het toestel uit staat of de app volledig gesloten is (vooral op iPhone bestaat daar geen ondersteunde weg voor). De garantie is: uiterlijk bij de volgende keer dat de technieker de app opent.

## 4. Voorkomen van een dubbele Zoho-bijlage

`archiveerRapport()` (het bewaren in ons eigen archief) is al veilig te herhalen: `rapport-archief.js` dedupliceert op `ticketId` + `datum` ([netlify/functions/rapport-archief.js:90](netlify/functions/rapport-archief.js:90)) en overschrijft een bestaande entry in plaats van een tweede toe te voegen. **Eén aanpassing hier:** wachtrij-herhalingen sturen geen `versie`-veld mee in de body, zodat de optimistic-lock-check (die anders vals-positief zou afgaan wanneer meerdere opgestapelde rapporten na elkaar doorkomen en de versie tussentijds ophoogt) hier niet van toepassing is — de dedup op ticket+datum blijft de eigenlijke bescherming tegen dubbels.

`uploadRapportToZoho()` (`/api/rapport`, [netlify/functions/rapport.js](netlify/functions/rapport.js)) heeft **geen** dedup — elke geslaagde aanroep voegt een nieuwe PDF-bijlage toe aan het ticket. Als een eerdere poging serverzijde wél gelukt is maar het antwoord de client nooit bereikte (het scenario dat we net repareren), zou blind herhalen een tweede, identieke bijlage opleveren.

**Oplossing:** `rapport-archief.js` krijgt een nieuw veld `zohoUploaded` op elke entry (default `false`), en de bestaande `GET` krijgt een optionele `?id=<id>` parameter die — als opgegeven — enkel `{ versie, rapport: <die ene entry of null> }` teruggeeft in plaats van de volledige lijst (lichtgewicht, want de volledige lijst kan zwaar zijn door ingebedde foto's). Vóór `attemptOutboxItem` de Zoho-upload-stap effectief opnieuw probeert, checkt het eerst via dit endpoint of `zohoUploaded` al `true` staat — zo ja, stap overslaan (server bevestigt: al gebeurd), zo nee, upload proberen. Na een geslaagde upload stuurt de client een nieuwe `archiveerRapport()`-aanroep met dezelfde volledige body plus `zohoUploaded: true`, wat de bestaande entry bijwerkt (dedup op ticket+datum, zie hierboven).

## 5. Foutenlogboek — nieuwe Netlify function

`netlify/functions/client-log.js` → `/api/client-log`, zelfde opzet als `rapport-archief.js` (blob `blitz-data`, `consistency: 'strong'`, publiek/geen auth, gekapt op bv. 500 regels, oudste eruit).

- `POST` body `{ tijdstip, ticketId, ticketNumber, stap, fout, poging }` → toegevoegd aan de lijst.
- `GET` → volledige lijst, enkel voor handmatige inspectie (door mij, op vraag van Brent) — geen UI in de app hiervoor.

Elke mislukte stap in `attemptOutboxItem` (zowel de eerste poging als latere herhalingen) schrijft hier een regel naar toe. Dit is puur diagnostisch: als deze aanroep zelf faalt, wordt dat genegeerd (geen eigen wachtrij, geen retry) — enkel het rapport zelf moet gegarandeerd toekomen.

## Niet in scope

- Wijzigingen aan hoe foto's tijdens de interventie bewaard worden (`fotos.js`, `persistFotoChange`) — werkt al robuust.
- Een in-app scherm om het foutenlogboek te bekijken.
- Achtergrond-verzending terwijl de app volledig gesloten is of het scherm van het toestel uit staat (niet haalbaar op alle platformen, met name iOS).
- Een harde limiet/vervaldatum waarna een blijvend mislukkend rapport uit de wachtrij verdwijnt.
- Verkleinen van de payload door foto's niet meer dubbel in te bedden (in `R.fotos` én in de gerenderde `_html`) — reëel geïdentificeerd als bijkomende risicofactor, maar een aparte, grotere wijziging die hier niet nodig is om het kernprobleem op te lossen.

## Edge cases

- **Twee rapporten in de wachtrij voor hetzelfde ticket+datum** (bv. opnieuw gemaakt na een eerdere mislukking): bestaande dedup in `rapport-archief.js` zorgt dat dit één entry blijft, niet twee.
- **App volledig herladen/herinstalleerd tussen het aanmaken en het bevestigen van een wachtrij-item:** IndexedDB overleeft een pagina-herlaad; enkel het volledig wissen van site-data (of het wisselen van toestel) zou het wachtrij-item verliezen — in dat laatste geval is het rapport alsnog terug op te maken zoals vandaag (foto's blijven immers al bewaard).
- **`_wizTicket.isLocal` (geen Zoho-ticket):** wachtrij-item heeft dan geen Zoho-stap; enkel `archived` moet bevestigd worden.
- **Technieker klikt de "⏳"-banner aan terwijl er geen verbinding is:** `flushOutbox()` mag gewoon opnieuw proberen en gewoon opnieuw mislukken (nieuwe toast/logregel) — geen speciale afhandeling nodig.

## Openstaand testpunt

Het kernprobleem is mobiel achtergrond-gedrag, wat niet volledig op een computer te simuleren is. Naast eigen tests (netwerkstoringen simuleren, meerdere wachtrij-items, dedup-gedrag controleren) is een **praktijktest op een echte telefoon** nodig — bewust een rapport versturen met wifi/4G uit op een slecht moment — vóór dit met zekerheid als opgelost beschouwd wordt.
