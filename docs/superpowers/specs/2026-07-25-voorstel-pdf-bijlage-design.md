# Service voorwaarden als PDF-bijlage bij het afspraakvoorstel

**Datum:** 2026-07-25
**Status:** Approved, ready for implementation plan

## Aanleiding

Bij het versturen van een afspraakvoorstel (`/api/propose`) ontvangt de klant momenteel enkel een tekstuele uitnodiging. De klant krijgt geen inzicht in Blitz Power's service voorwaarden (garantieregels, kostenmodel, wat inbegrepen is), en de mail vraagt vandaag enkel actie **als het voorgestelde tijdstip niet past** — er wordt nergens expliciet om bevestiging van de afspraak gevraagd. Brent wil beide oplossen: de voorwaarden-PDF meesturen, en de mailtekst zo aanpassen dat een expliciete bevestiging gevraagd wordt.

## Scope

- Verplaatsen van `SERVICE VOORWAARDEN BLITZ POWER BV.pdf` naar een vaste plek in de repo, gebundeld met de Netlify Function.
- `netlify/functions/propose.js` — PDF uploaden naar Zoho en meesturen als bijlage bij `sendReply`.
- Mailtekst in `buildEmailHtml()` (propose.js) aanpassen: expliciet om bevestiging vragen + verwijzing naar de bijgevoegde voorwaarden.
- Voorbeeld-mail in `public/index.html` (het "Afspraakvoorstel"-scherm) synchroon houden met de echte mailtekst, plus een bijlage-indicatie.

**Buiten scope:** de PDF-inhoud zelf wijzigen, of andere e-mail-flows (er is maar één plek in de codebase die mails verstuurt — `propose.js` — bevestigd via een grep op `sendReply`/`buildEmailHtml`).

## 1. Bestand & bundeling

Het PDF-bestand verhuist van `Foutmeldingen en verbeteringen/SERVICE VOORWAARDEN BLITZ POWER BV.pdf` (een scratch-map voor dit gesprek, niet bedoeld als permanente opslag) naar **`netlify/functions/assets/service-voorwaarden.pdf`** — een vaste plek binnen de functie-map.

Netlify's function-bundelaar (esbuild-gebaseerd) volgt enkel de JS `import`/`require`-graaf; een los `fs.readFileSync()`-pad naar een binair bestand wordt niet automatisch meegenomen in de deployment-bundle. Daarom komt er in `netlify.toml` een `included_files`-regel bij voor de `propose`-functie:

```toml
[functions.propose]
  included_files = ["netlify/functions/assets/*.pdf"]
```

Dit volgt hetzelfde patroon als de bestaande `[functions.rapport]`-sectie (functie-specifieke config in `netlify.toml`).

## 2. Backend — bijlage uploaden en meesturen (`netlify/functions/propose.js`)

Wanneer `recipientEmail` aanwezig is (dus wanneer er effectief een mail verstuurd wordt, zelfde voorwaarde als vandaag al geldt voor `sendReply`):

1. Lees de PDF van schijf: `fs.readFileSync(path.join(__dirname, 'assets', 'service-voorwaarden.pdf'))`.
2. Upload naar **`${ZOHO_DESK}/tickets/${ticketId}/attachments`** — hetzelfde bewezen, werkende endpoint dat `rapport.js` al gebruikt voor de rapport-PDF (multipart `FormData`, `Blob`-veld `file`, respons bevat `id`). Een apart, generiek `/uploads`-endpoint bleek bij een live test 401 te geven — vermoedelijk een ander Zoho-product-API (CRM/Mail) dat abusievelijk in zoekresultaten opdook, niet Zoho Desk. Het ticket-attachments-endpoint is bevestigd te werken tegen deze exacte org.
3. Neem de resulterende attachment-`id` op in de `sendReply`-body als `attachmentIds: [<id>]`.
4. Weergavenaam voor de klant: **"Service Voorwaarden Blitz Power.pdf"** (los van de interne bestandsnaam op schijf) — meegeven als derde argument aan de `Blob`/`FormData`-append, zoals `rapport.js` ook met zijn `filename`-parameter doet.

**Onzekerheid, te verifiëren tijdens implementatie:** of Zoho's `sendReply` de `attachmentIds` van een ticket-attachment ook effectief bijvoegt aan de uitgaande mail (in plaats van enkel op het ticket te blijven staan) is nog niet live getest. Dit wordt tijdens de implementatie geverifieerd met een echte test-verzending (naar een test-ticket/adres) — dezelfde aanpak als bij de eerdere `cf_interventie_datm`-verificatie. Dit is een gewone implementatie-verificatiestap, geen aparte live-test die Brents aanwezigheid vereist (in tegenstelling tot de eerdere Zoho-schrijfactie op een echt gepland ticket) — een test-mail versturen heeft geen destructieve impact op productiedata.

Er wordt **elke keer opnieuw** geüpload bij het versturen van een voorstel (geen caching/hergebruik van een eerder verkregen attachment-ID) — simpelste aanpak, geen risico op een verlopen of over meerdere tickets heen ongeldige ID, en het bestand is klein genoeg (138KB) om de overhead te verwaarlozen.

## 3. Mailtekst versterken

Huidige tekst (`propose.js`, in `buildEmailHtml()`):
> *"Kan dit tijdstip u niet schikken? Beantwoord dan deze e-mail en wij zoeken samen naar een alternatief."*

Nieuwe tekst:
> *"Gelieve deze afspraak te bevestigen door op deze e-mail te antwoorden. Komt het voorgestelde tijdstip u niet uit? Laat het ons dan ook weten, zodat we samen een alternatief zoeken. In bijlage vindt u onze service voorwaarden — door de afspraak te bevestigen gaat u hiermee akkoord."*

De laatste zin verwijst bewust naar punt 7 ("Akkoord") van de bijgevoegde voorwaarden-PDF, die stelt dat het bevestigen van een interventie een akkoord met de voorwaarden inhoudt.

## 4. Voorbeeld-mail in de app synchroniseren (`public/index.html`)

De losstaande, vereenvoudigde preview-HTML in het "Afspraakvoorstel"-scherm (`updateProposalPreview()`, [public/index.html:4324](public/index.html:4324), zet `innerHTML` van `#proposal-preview` — herkenbaar aan de gedupliceerde `bolt`-SVG en dezelfde opbouw als `buildEmailHtml()`) krijgt:
- Dezelfde tekstwijziging als hierboven.
- Een extra regel **"📎 Bijlage: Service Voorwaarden Blitz Power.pdf"**, zodat de coördinator vóór het versturen ziet dat er een bijlage meegaat — zonder dat de PDF zelf al geüpload wordt tijdens het bekijken van de preview (dat blijft server-side, enkel bij de echte verzending).

## Testen

- **Sandbox (geen echte Zoho-aanroep):** gemockte `fetch`-test die bevestigt dat de PATCH/POST-aanroepen naar `/uploads` en `/tickets/{id}/sendReply` de juiste body-vorm hebben (`attachmentIds` aanwezig, weergavenaam correct), zelfde patroon als bij eerdere backend-taken dit gesprek.
- **Live verificatie (klein risico, geen productie-impact):** één echte testmail versturen (naar een test-ticket met een eigen test-e-mailadres, geen echte klant) om te bevestigen dat de bijlage effectief aankomt en leesbaar is, en dat de mailtekst er correct uitziet.
- **Client:** `?test`-modus in de browser om te bevestigen dat de preview de nieuwe tekst + bijlage-indicatie toont.
