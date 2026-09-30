# Afspraak annuleren + bevestiging per ontvanger — design (v1.10.0)

**Datum:** 2026-09-30 · **Status:** ter goedkeuring bij Brent · **Release:** v1.10.0 (MINOR, nieuwe functionaliteit)

## 1. Aanleiding

1. **Blijvende voorstel-status.** Een ticket waarvan de afspraak geannuleerd en opnieuw ingepland werd, toont nog 🔒 en "✉️ Voorstel verstuurd". Het register `voorstel-status` (Netlify Blobs) heeft geen pad om een entry te wissen.
2. **Geen annuleerflow.** Brent wil een knop die een afspraak annuleert, de klant verwittigt en een verplichte reden vastlegt.
3. **Onbekend wie bevestigde.** De bevestigingslink wordt in `propose.js` één keer per voorstel gemaakt en naar alle ontvangers gestuurd (contact, eindklant, installateur). Bij een bevestiging weten we enkel het IP en het tijdstip, niet via welke mail bevestigd werd. De Zoho-notitie zegt altijd "door klant".
4. **Gat in de link-controle.** `confirm-afspraak.js` controleert enkel dat de status "Wachten op bevestiging planning" is. Wordt een ticket geannuleerd en daarna opnieuw voorgesteld voor een *andere* datum, dan kan de oude link (oude datum) het nieuwe voorstel bevestigen.

## 2. Doel en succescriteria

- Een coördinator kan vanuit het ticketdetail een afspraak annuleren met een verplichte reden. De klant krijgt optioneel een nette mail.
- Na annuleren is het ticket in alle opzichten "vrij":
  - Zoho-status "Wachten op planning", geen interventiedatum;
  - geen 🔒 en geen "Voorstel verstuurd" meer;
  - een oude bevestigingslink werkt niet meer.
- Bij een bevestiging staat in Zoho en in de planner **via welke ontvanger** bevestigd werd: klant, installateur of contact, met het mailadres.
- Niets hiervan kan in `?test` naar Zoho of naar klanten gaan.

**Buiten scope:** annuleren door de klant zelf (link in de mail), meertalige mails, en een annulatie-historiek in de planner. Die historiek staat al als interne notitie in Zoho.

## 3. Deel A — Afspraak annuleren

### 3.1 Waar en voor wie
- **Knop "Afspraak annuleren"** in het ticketdetail (`openDetail`), stijl `.btn btn--danger`, klasse `coord-only`. Techniekers zien de knop niet.
- **Zichtbaar** zodra het ticket een lopend of bevestigd voorstel heeft:
  - er is een voorstel-status-entry voor het ticket; **of**
  - de status is "Wachten op bevestiging planning", "Geplande service" of "Geplande support".
- De bestaande "✕ Verwijder uit planning" blijft voor tickets zonder voorstel. Staat er wél een voorstel uit, dan vraagt ✕/× eerst:
  > "Voor dit ticket is al een voorstel naar de klant verstuurd. Wil je de afspraak annuleren? Je kiest daarna een reden en of de klant een mail krijgt."
  - Knoppen: **[Afspraak annuleren]** (opent het annuleervenster) / **[Terug]**.
  - Stil uitplannen = annuleren met "Klant verwittigen: Nee". Zo wordt ook dan altijd een reden vastgelegd en de voorstel-status gewist. Er is dus geen derde, "stille" route meer die de 🔒 laat staan.

### 3.2 Annuleervenster
Een modaal venster (`role="dialog"`, focus trap via `venster.js`, Escape = sluiten zonder actie) met:

1. **Kop:** ticketnummer, klant, geplande datum en tijd(slot).
2. **Reden** (verplicht, keuzelijst). Elke reden heeft een vaste zin voor de klant:

   | Reden (intern) | Zin in de mail aan de klant |
   |---|---|
   | Technieker ziek of onbeschikbaar | Onze technieker is onverwacht niet beschikbaar. |
   | Onderdelen niet op tijd geleverd | De nodige onderdelen zijn niet op tijd bij ons geleverd. |
   | Klant vroeg om te verzetten | Zoals met u besproken, verplaatsen we deze afspraak. |
   | Weersomstandigheden | De weersomstandigheden laten niet toe om de werken veilig uit te voeren. |
   | Dubbele of foute planning | Door een fout in onze planning kan deze afspraak niet doorgaan. |
   | Andere | *(de toelichting hieronder, verplicht)* |

3. **Toelichting** (tekstvak). Verplicht bij "Andere", anders optioneel.
   - Bij "Andere" komt de toelichting letterlijk in de mail.
   - Bij de andere redenen blijft de toelichting **intern**: ze komt alleen in de Zoho-notitie. Onder het tekstvak staat daarom *"Komt niet in de mail aan de klant"*. Dat voorkomt dat een interne opmerking per ongeluk naar de klant gaat.
4. **Klant verwittigen per mail?** Keuzerondjes **Ja (standaard)** / **Nee, ik verwittig zelf**.
   - Bij Ja staan eronder de ontvangers: dezelfde adressen en dezelfde ontdubbeling als bij het voorstel.
   - Zonder enig mailadres wordt Ja uitgeschakeld, met de melding "Geen mailadres bekend".
5. **Voorbeeld van de mail**, ingeklapt onder "Toon mail". De tekst werkt live bij met de gekozen reden.
6. **Knoppen:** [Terug] / **[Afspraak annuleren]** (danger). De knop blijft uitgeschakeld tot een reden gekozen is (plus toelichting bij "Andere"). Tijdens het versturen: uitgeschakeld met "Bezig…" (geen dubbele klik).

### 3.3 Mailtekst (via Zoho `sendReply` in de bestaande ticketdraad, HTML in dezelfde huisstijl als de voorstelmail)

> Beste {naam},
>
> Helaas moeten we uw afspraak van **{weekdag dd maand jjjj}** ({tijdslot of "om hh:mm"}) annuleren. {redenzin}
>
> Onze excuses voor het ongemak. We nemen zo snel mogelijk contact met u op om een nieuwe datum af te spreken.
>
> Met vriendelijke groeten,
> Het serviceteam van Blitz Power

- `{naam}` is dezelfde `recipientName` als bij het voorstel.
- `{tijdslot}` komt uit de voorstel-status (`tijdslot`/`tijdslotDatum`) als die er is. Anders is het het uur van `interventieDatum`.
- Er gaat geen bijlage mee.

### 3.4 Wat er bij bevestigen gebeurt — nieuw endpoint `POST /api/annuleer`
Eén serverfunctie `netlify/functions/annuleer.js` (v2-stijl zoals `voorstel-status.js`) doet alles in deze volgorde:

1. **Validatie:**
   - `ticketId` numeriek;
   - `reden` uit de vaste lijst;
   - `toelichting` verplicht bij "Andere", max. 1000 tekens;
   - `mailKlant` boolean;
   - `door` (naam, optioneel).
2. **Ticket ophalen** uit Zoho: ontvangers, huidige datum, status.
3. **Mail** (als `mailKlant`): één `sendReply` per ontvanger. Dezelfde foutafhandeling per ontvanger als in `propose.js`: een fout bij één ontvanger houdt de rest niet tegen.
4. **PATCH** status "Wachten op planning" en `cf_interventie_datm: ''`.
   - Dit gebeurt *na* de mail, om dezelfde reden als in `propose.js`: `sendReply` zet de status anders terug op "Wachten op klant".
5. **Interne Zoho-notitie** (`isPublic: false`), bijvoorbeeld:
   > *"Afspraak van 14/10/2026 08:30–11:30 geannuleerd via Blitz Planning door Brent op 30/09/2026 15:12. Reden: Onderdelen niet op tijd geleverd. Toelichting: … Klant verwittigd per mail: ja (klant@…, installateur@…)."*
6. **Voorstel-status wissen:** de entry van dit ticket in blob `voorstel-status` wordt verwijderd, met `versie + 1`.
7. **Antwoord:** `{ ok, emailSent: {contact, klant, installateur}, fouten: [...] }`.

**Foutgedrag:**
- Faalt stap 2 of 4 (Zoho onbereikbaar of PATCH-fout), dan krijg je een 5xx met een duidelijke fout, en wordt de voorstel-status *niet* gewist.
- Faalt alleen een mail, dan is het resultaat 200 met `fouten`. De planner toont dan: "Afspraak geannuleerd, maar de mail naar {doelgroep} kon niet verstuurd worden. Verwittig de klant zelf."
- Faalt de notitie, dan wordt dat enkel gelogd, zoals bij `confirm-afspraak.js`.

**"Door wie":** er is geen login. De notitie gebruikt de persoon die op dit toestel gekozen is in de persoonskiezer (rol per persoon, v1.8.0). Is er niemand gekozen, dan staat er "via Blitz Planning" zonder naam.

**Na succes in de planner:**
- de lokale ticketstatus en het ticket worden uit de dag verwijderd (zelfde pad als `removeTicketFromDate`);
- `loadVoorstelStatus()` wordt opnieuw geladen;
- detail sluit via `sluitDetailStil`;
- een toast "Afspraak geannuleerd" plus "klant verwittigd per mail" of "klant niet gemaild";
- de route wordt opnieuw berekend (bestaand pad na verwijderen).

### 3.5 Voorstel-status opruimen
- `voorstel-status.js` krijgt `DELETE ?ticketId=…`. Die verwijdert de entry en verhoogt `versie`, zonder 409-check: wissen is idempotent. `annuleer.js` roept dezelfde wislogica aan via een gedeelde helper in `netlify/lib/`, niet via HTTP.
- **Vangnet voor oude, blijvende 🔒-gevallen:** bij het versturen van een **nieuw** voorstel (`propose` gelukt) wordt de oude entry eerst vervangen, niet aangevuld. Oude doelgroep-tijdstippen of een oud tijdslot blijven zo niet hangen. Dat gebeurt in dezelfde POST: de client stuurt een `reset: true` mee bij de eerste doelgroep van een nieuw voorstel.
- **Tickets die vandaag al onterecht 🔒 tonen**, zoals het geval dat Brent meldde: de planner wist bij `loadVoorstelStatus()` niets automatisch. Brent kan die tickets gewoon annuleren (mail: Nee) of opnieuw voorstellen, en dat ruimt ze op.
  - **Ruling:** geen automatische opruiming op basis van de Zoho-status. Dat zou ook terecht vergrendelde tickets kunnen ontgrendelen. Kost het als dat fout blijkt: een handvol tickets manueel annuleren.

## 4. Deel B — Bevestiging per ontvanger

### 4.1 Eigen link per ontvanger
- In `propose.js` verhuist het maken van de link **naar binnen de lus per ontvanger**. De link krijgt een extra parameter `d` (contact | klant | installateur).
- De handtekening wordt `HMAC(ticketId.date.exp.d)`. De doelgroep zit dus mee in de handtekening en kan niet aangepast worden.
- `sign()` in beide bestanden blijft zo nodig exact gelijk. Het wordt een gedeelde helper `netlify/lib/bevestigingslink.js`, zodat de twee versies niet meer uit elkaar kunnen lopen.

### 4.2 Verwerken in `confirm-afspraak.js`
- **Met `d`:** controle met het nieuwe formaat. **Zonder `d`:** controle met het oude formaat. Links die al verstuurd zijn, werken dus tot ze vervallen (max. 14 dagen, daarna kan het oude formaat weg).
  - **Ruling:** oude links blijven werken tot hun vervaldatum. Kost het als dat fout blijkt: niets, de notitie zegt dan "ontvanger onbekend (oude link)".
- **Extra controle (dicht gat 4):** naast de status moet ook de **datum** van `cf_interventie_datm` gelijk zijn aan de `date` in de link. Is dat niet zo, dan verschijnt de bestaande pagina "Afspraak niet meer actueel" (409).
  - De datum wordt in Europe/Brussels omgerekend, want Zoho bewaart die in UTC. Anders zou een afspraak om 00:30 op de verkeerde dag vallen.
  - Na een annulatie is de status "Wachten op planning", dus ook zonder deze datumcontrole zijn oude links na annuleren al dood. De datumcontrole dekt het geval annuleren + nieuw voorstel voor een andere dag.
- **Zoho-notitie:**
  > *"Afspraak bevestigd voor 2026-10-14 door **installateur** (jan@installatie.be) via bevestigingslink op … IP-adres: …"*
  - Het mailadres komt uit het ticket zoals het nu in Zoho staat. Met het oude linkformaat staat er "door onbekende ontvanger (oude link)".
- **Registreren in de planner:** de voorstel-status-entry krijgt `bevestigd: { door: 'installateur', tijdstip }`. Dit gebeurt in de productie-store, want de bevestigingslink komt van buiten en draagt nooit de testheader. Een mislukte blob-schrijf mag de bevestiging niet laten mislukken: die wordt enkel gelogd.

### 4.3 Tonen in de planner
- In het ticketdetail en op de routestop komt naast of in plaats van "✉️ Voorstel verstuurd" de melding **"✓ Bevestigd door installateur"** (of klant/contact), met datum en uur in de tooltip.
- Staat de status op "Geplande …" maar is `bevestigd` er niet (oude link of telefonisch bevestigd), dan blijft de bestaande weergave.

### 4.4 Eerlijke beperking
We weten welke **mail** gebruikt werd, niet wie er fysiek op drukte. Een doorgestuurde mail blijft "klant". Dat staat zo in de help-tooltip.

## 5. Testmodus (`?test`)
- `annuleer.js`:
  - `isTestVerzoek(req)` betekent geen `sendReply`, PATCH of notitie. In de plaats komt `nepZohoAntwoord`: de mails zijn "als verstuurd" gemarkeerd en de response is `test: true`.
  - De voorstel-status wordt **wel** gewist, maar in de teststore (`winkelNaam(req)` → `blitz-data-test`).
- Het voorbeeld van de mail is zichtbaar in `?test`, zodat Brent de tekst kan nalezen zonder iets te versturen.
- `confirm-afspraak.js`: in test worden geen echte links gemaakt (`propose` geeft een nepantwoord). Het endpoint zelf wijzigt dus niet voor test.
- De client-guard blijft: in `TEST_MODE` gaat het annuleren via hetzelfde endpoint met de `X-Blitz-Test`-header. Er gebeurt geen directe Zoho-call.

## 6. Bestanden

| Bestand | Wijziging |
|---|---|
| `netlify/functions/annuleer.js` | **nieuw**: annuleerflow (3.4) |
| `netlify/lib/voorstelregister.js` | **nieuw**: lees/schrijf/wis van blob `voorstel-status` (gedeeld) |
| `netlify/lib/bevestigingslink.js` | **nieuw**: `maakLink`/`controleer` (oud + nieuw formaat) |
| `netlify/functions/voorstel-status.js` | DELETE, `reset: true`, gebruikt de helper |
| `netlify/functions/propose.js` | link per ontvanger via de helper |
| `netlify/functions/confirm-afspraak.js` | `d`, datumcontrole, notitie met ontvanger, `bevestigd` registreren |
| `public/index.html` | knop, annuleervenster, ✕/×-omleiding, "✓ Bevestigd door …", reset bij nieuw voorstel |
| `public/css/app.css` | annuleervenster (bestaande `.btn`/tokens) |
| `package.json`, lock, `public/sw.js` (CACHE_NAME), `CHANGELOG.md` | release v1.10.0 |

## 7. Verificatie
- **Backend** (`node --check` plus een klein Node-script in de scratchpad):
  - token oud/nieuw formaat geldig, gewijzigde `d` ongeldig, verlopen ongeldig;
  - datumvergelijking met UTC-randgevallen, bv. 00:30 Brussel = 22:30 UTC de dag ervoor;
  - `annuleer` in testmodus doet nul `fetch` naar Zoho (fetch-stub).
- **Browser** op 127.0.0.1:3333/?test, op 1440, 768 en 375, in beide thema's:
  - knop zichtbaar voor een coördinator bij een ticket met voorstel, onzichtbaar voor een technieker en bij een ticket zonder voorstel;
  - validatie van reden en "Andere";
  - voorbeeldmail wijzigt mee met de reden;
  - na annuleren: 🔒 en "Voorstel verstuurd" weg, ticket terug in de Wachtrij, toast;
  - ✕/× op een ticket met voorstel opent de vraag en daarna het venster;
  - Escape sluit zonder actie, de focus blijft in het venster.
- **Serverlog:** geen enkele Zoho-call tijdens de browsertest.
- **Eindreview** door opus, daarna Brents "ja" vóór de push.
- Brent test na de release één echte annulatie en één echte bevestiging op een eigen testticket.

## 8. Rulings ter controle door Brent
1. **Redenenlijst en klantzinnen** (3.2). Klopt de lijst? Ontbreekt er een reden?
2. **Mailtekst** (3.3), inclusief de afsluiter "Het serviceteam van Blitz Power".
3. **Toelichting blijft intern**, behalve bij "Andere".
4. **Stil uitplannen van een ticket met voorstel** gaat altijd via het annuleervenster (mail: Nee). Er blijft geen route over zonder reden.
5. **Geen automatische opruiming** van bestaande onterechte 🔒-tickets.
6. **Oude bevestigingslinks** blijven werken tot hun vervaldatum, met "ontvanger onbekend".
