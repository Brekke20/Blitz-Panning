# Meerpagina service-rapport: nette pagina-afbrekingen

**Datum:** 2026-07-25
**Status:** Approved, ready for implementation plan

## Aanleiding

Het gegenereerde service-rapport (`buildRapportHtml()`) heeft momenteel geen enkele print-/pagina-CSS (geen `page-break`, geen `@page`, geen `break-inside`). Zodra het rapport meer dan één pagina beslaat, knipt de browser (of puppeteer, bij de naar Zoho gearchiveerde kopie) een sectie zomaar af waar de pagina toevallig eindigt — soms midden in een tekstblok of tabel. Dit moet netter en professioneler afgewerkt worden.

**Twee rendering-paden, dezelfde HTML:**
- **Browser-print** (`printRapport()`, [public/index.html:5674](public/index.html:5674)) — opent de HTML in een nieuw tabblad, de technieker gebruikt zijn eigen browser-printdialoog (Ctrl+P → Opslaan als PDF). Dit is de PDF die de technieker zelf downloadt.
- **Puppeteer** (`netlify/functions/rapport.js`) — genereert een PDF van diezelfde HTML en uploadt die naar het Zoho-ticket als bijlage (archief-kopie).

Beide consumeren exact dezelfde `buildRapportHtml()`-output, dus een CSS-fix aan de sectie-indeling lost beide paden tegelijk op. Paginanummers zijn wél apart per pad (zie sectie 3).

## Scope

- CSS-herstructurering in `buildRapportHtml()`'s `<style>`-blok en HTML-structuur ([public/index.html:5539-5669](public/index.html:5539)): secties krijgen wrapper-elementen met de juiste `break-inside`/`break-after`-regels.
- `netlify/functions/rapport.js`: `page.pdf()`-aanroep uitgebreid met `displayHeaderFooter`, `footerTemplate` (paginanummers), en een passende `margin`.

**Buiten scope:** inhoudelijke wijzigingen aan het rapport zelf (nieuwe velden, andere gegevens), het browser-printpad van paginanummers voorzien (technisch niet betrouwbaar haalbaar via CSS, zie sectie 3), en de PDF-bijlage-feature van het afspraakvoorstel (al eerder afgerond, ongerelateerd).

## 1. Korte secties blijven altijd samen

De volgende secties — elk een `.sec`-koptekst gevolgd door zijn inhoud — worden samen in een wrapper-`<div>` gezet met de klasse `.rapport-section`, die `break-inside: avoid; page-break-inside: avoid;` krijgt:

- Klantgegevens-infogrid (`.info-grid`)
- Omschrijving probleem (`.sec` + `.block`)
- Ondernomen acties (`.sec` + `.block`)
- Oorzaak storing (`.sec` + `.block`)
- Status laadinfrastructuur (`.sec` + `.status-row`)
- Varia (`.sec` + `.block`, indien aanwezig)
- Handtekeningen (`.sec` + `.sig-row`)

Past een van deze secties niet meer volledig op de resterende ruimte van de huidige pagina, dan verhuist de hele sectie — koptekst inclusief — in één keer naar de volgende pagina. Geen enkele van deze secties is normaliter groter dan een halve pagina, dus dit veroorzaakt geen noemenswaardige lege ruimte.

## 2. Lange secties (foto's, onderdelen, loonkosten) mogen over pagina's lopen

Voor de foto-grid en de twee tabellen (vervangen onderdelen, loonkosten) geldt een andere regel, omdat deze in theorie zelf al langer dan één pagina kunnen zijn:

- De sectie **als geheel** krijgt **geen** `break-inside: avoid` — hij mag over meerdere pagina's lopen.
- De `.sec`-koptekst krijgt `break-after: avoid; page-break-after: avoid;`, zodat hij nooit als laatste regel op een pagina blijft hangen zonder dat er nog inhoud volgt.
- Elke individuele foto (`.foto-report-item`) en elke tabelrij (`table.parts tr`) krijgt `break-inside: avoid; page-break-inside: avoid;` — een foto of rij wordt dus nooit zelf middendoor geknipt.
- `table.parts thead { display: table-header-group; }` zorgt ervoor dat de kolomkoppen automatisch herhaald worden bovenaan een vervolgpagina als de tabel over meerdere pagina's loopt.

## 3. Paginanummers — enkel voor de puppeteer/Zoho-kopie

**Puppeteer** (`rapport.js`): `page.pdf()` krijgt `displayHeaderFooter: true`, een lege `headerTemplate: '<span></span>'` (voorkomt Chromium's eigen default-header met URL/datum), en:
```js
footerTemplate: `
  <div style="font-size:8px;width:100%;text-align:center;color:#888;font-family:Arial,Helvetica,sans-serif">
    Pagina <span class="pageNumber"></span> van <span class="totalPages"></span>
  </div>`,
margin: { top: '0mm', bottom: '12mm', left: '0mm', right: '0mm' },
```
De `margin.bottom` reserveert ruimte zodat de voettekst niet over de rapport-inhoud heen valt; de rest van de marges blijft 0 omdat `buildRapportHtml()`'s `body`-padding (`13mm 17mm`) de visuele marge al zelf simuleert.

**Browser-print** (`printRapport()`): **geen wijziging.** Chromium's printmotor ondersteunt CSS Paged Media (`@page { @bottom-center { content: ... } }`) niet betrouwbaar — dit is een bekende beperking van Chrome's printengine, niet iets wat via onze eigen CSS te forceren valt. De technieker's eigen browser-printdialoog heeft een eigen "Kopteksten en voetteksten"-optie (meestal standaard aan) die dan zijn eigen paginanummering toont; dat gedrag valt buiten onze controle en wordt hier niet aangepast.

## Testen

- **Visuele verificatie in de browser:** een testrapport met genoeg inhoud om minstens 2 pagina's te vullen (bv. 3+ foto's, een paar onderdelen-rijen, langere tekst in Omschrijving/Acties) openen via `printRapport()` en via de browser's print-preview controleren dat geen enkele sectie middendoor geknipt wordt.
- **Puppeteer-PDF:** `rapport.js` is een "classic" `handler(event)`-functie (net als `plan.js`/`propose.js`), en draait dus normaal via `dev-server.mjs`. Hetzelfde testrapport via `/api/rapport` genereren en de resulterende PDF openen om te bevestigen dat paginanummers correct verschijnen en secties intact blijven.
