# Testopslag (v1.8.1): ontwerp

**Status:** goedgekeurd door Brent in de chat op 2026-09-29. Keuze: testmodus start met een **kopie van de echte gegevens, plus een resetknop**.

**Aanleiding:**
- Sinds v1.6.1 blokkeert de app zelf, knop per knop, de schrijfacties in testmodus (`?test`).
- Beschikbaarheid, eigen afspraken, klantvoorkeuren, foto's en prijzen schreven toch nog naar de echte opslag.
- Een nieuwe functie die zo'n blokkade vergeet, kan opnieuw echte gegevens of Zoho raken.

**Doel:** de server zelf scheidt testverzoeken volledig van de echte gegevens en van schrijfacties naar Zoho.

## 1. Markering aan de kant van de app
- In `<head>` van `public/index.html` komt een klein inline script, vóór alle andere scripts, met dezelfde test als `TEST_MODE`: `new URLSearchParams(location.search).has('test')`. Is testmodus actief, dan wordt `window.fetch` omwikkeld. Elk verzoek naar een URL die begint met `/api/` (relatief of op dezelfde origin) krijgt de header **`X-Blitz-Test: 1`**. Andere verzoeken blijven ongemoeid (CDN, tegels, enzovoort).
- Het werkt voor alle 26 losse `fetch('/api/…')`-aanroepen in `index.html` en `public/js/*.js`, ook voor toekomstige.
- De service worker onderschept `/api/` niet (`sw.js:26`), dus de header komt door.
- Bestaande blokkades in de app blijven staan (dubbel slot).

## 2. Gedeelde helper op de server: `netlify/lib/testmodus.js`
Die staat buiten `netlify/functions/`, zodat Netlify hem niet als functie uitrolt. Functies importeren hem relatief (`../lib/testmodus.js`), en de bundler neemt hem mee.
- `isTestVerzoek(reqOfEvent): boolean`. Dat werkt voor v2 (`Request`: `req.headers.get('x-blitz-test') === '1'`) en voor v1 (`event.headers['x-blitz-test'] === '1'`, sleutels in kleine letters).
- `winkelNaam(reqOfEvent): 'blitz-data' | 'blitz-data-test'`.
- `async zorgVoorTestkopie(getStore): void`:
  - is `blitz-data-test` leeg van de markeersleutel `_testkopie`, dan worden alle sleutels van `blitz-data` gekopieerd, **behalve** `client-log*`, `rapport-verzend-status*` en `foto-*`;
  - daarna wordt `_testkopie` gezet (`{ gekopieerdOp: ISO }`);
  - één keer per koude start wordt ook een geheugenvlag gezet, zodat er niet bij elk verzoek gecontroleerd wordt;
  - de functie is idempotent;
  - bij een fout bij het kopiëren wordt het verzoek niet geblokkeerd: loggen en verdergaan.
- `nepZohoAntwoord(extra?)`: `{ ok: true, test: true, ...extra }`.

## 3. Functies die de opslag gebruiken
`afspraken`, `availability`, `client-log`, `fotos`, `inventaris`, `klantbeschikbaarheid`, `prijzen`, `rapport-archief`, `rapport-verzonden`, `voorstel-status` en de opslagdelen van `rapport`:
- `getStore({ name: 'blitz-data', … })` wordt `getStore({ name: winkelNaam(req), … })`;
- bij een testverzoek wordt vóór het eerste lezen `await zorgVoorTestkopie(getStore)` aangeroepen;
- verder verandert er niets aan de logica.

## 4. Functies die naar Zoho schrijven
Bij een testverzoek volgt **meteen** `nepZohoAntwoord()`, vóór het ophalen van een token en vóór elke `fetch` naar Zoho. Het gaat om:
- `comment` (oplossing);
- `plan` (status en datum);
- `plan-datum` (datum);
- `propose` (voorstelmail en status);
- `send-rapport` (mail en upload);
- `rapport`: de upload naar Zoho wordt overgeslagen. De rest, zoals de PDF en de idempotentie in de testopslag, mag doorlopen, maar de beslissing om te uploaden eindigt in een nep-succes.

De vorm van het antwoord moet overeenkomen met wat de app verwacht, zodat de app verder "gelukt" toont. Lees per functie wat de app met het antwoord doet.

**Niet aangepast:**
- `confirm-afspraak`: publieke link voor klanten, nooit in testmodus;
- `tickets`, `setup` en `planning-export`: lezen alleen;
- de TomTom-functies `matrix`, `optimize`, `route` en `drukte`: lezen alleen.

## 5. Resetknop
- **Nieuwe functie `netlify/functions/testdata.js`** (v2, `POST`):
  - zonder testheader: **403** `{ error: 'Enkel in testmodus' }`;
  - met testheader: alle sleutels in `blitz-data-test` verwijderen en daarna `zorgVoorTestkopie` opnieuw uitvoeren (de markering en de geheugenvlag worden eerst gewist);
  - antwoord `{ ok: true, gekopieerd: <aantal sleutels> }`.
- **In de app:** in Instellingen → "Dit toestel" staat, **enkel als `TEST_MODE`**, een blok "Testgegevens" met de knop "Testgegevens opnieuw kopiëren". Eerst verschijnt `appConfirm` met titel "Testgegevens opnieuw kopiëren?", tekst "Alle testwijzigingen gaan verloren. De echte gegevens worden niet aangeraakt." en de knop "Opnieuw kopiëren". Daarna volgt `POST /api/testdata`, de toast "🧪 Testgegevens opnieuw gekopieerd" en `location.reload()`.

## 6. Beveiliging
- De header kan alleen beperken: minder schrijven, een andere opslag. Vervalsen geeft niet meer rechten. Het is geen authenticatie, en die bestond vroeger ook niet.
- De kopie gaat alleen van echt naar test, nooit terug.

## 7. Verificatie (lokaal via `blobs-local-bootstrap.mjs`)
- Voor elke opslagfunctie: een `PUT`/`POST` met header schrijft in `blitz-data-test` (terug te lezen met header), en dezelfde `GET` zonder header toont die wijziging niet.
- Bij het eerste testverzoek staan de sleutels uit echt ook in test; `foto-*` en `client-log` niet.
- Zoho-schrijffuncties met header geven een nep-succes zonder token-fetch (met een fetch-spy of een log). **Nooit zonder header aanroepen tijdens het testen.**
- `POST /api/testdata` zonder header geeft 403; met header volgen reset en kopie.
- In de app, `?test`: in het netwerkpaneel of de serverlog heeft elk `/api/`-verzoek de header; zonder `?test` heeft geen enkel verzoek hem.
