# Service rapport: gegroepeerd kostenoverzicht (totaal onderdelen + loon)

**Datum:** 2026-07-30
**Status:** Approved, ready for implementation

## Aanleiding

Het gegenereerde PDF-rapport toont vandaag twee aparte subtotalen — "Totaal onderdelen (excl. btw)" (inline in de onderdelen-tabel) en "Totaal loonkosten (excl. btw)" (inline in de loonkosten-tabel) — maar nergens een gecombineerd eindtotaal. (De rapportenarchief-lijst in de app zelf berekent dit gecombineerde totaal al wél, via `totFactureerbaar` in `renderRapportArchief()` — enkel het PDF-document zelf mist dit.)

Brent wil dit niet oplossen door gewoon een derde bedrag ergens toe te voegen (dan staan bedragen op 3 verspreide plekken), maar door alles overzichtelijk te groeperen op één plek.

## Wijziging

**`buildRapportHtml()`** (public/index.html), drie aanpassingen:

**1. Loonkost-gegevens vroeger berekenen** — vlak na de bestaande `totaalOnderdelen`-berekening (index.html:5993-5995):
```js
const geldigeOnderdelen  = R.onderdelen.filter(p => p.naam);
const billableOnderdelen = geldigeOnderdelen.filter(p => p.factureren !== false);
const totaalOnderdelen   = billableOnderdelen.reduce((s, p) => s + (parseFloat(p.prijs)||0) * (parseInt(p.aantal)||1), 0);
```
toevoegen:
```js
const geldigeOnderdelen  = R.onderdelen.filter(p => p.naam);
const billableOnderdelen = geldigeOnderdelen.filter(p => p.factureren !== false);
const totaalOnderdelen   = billableOnderdelen.reduce((s, p) => s + (parseFloat(p.prijs)||0) * (parseInt(p.aantal)||1), 0);
// Loonkost hier al berekenen (i.p.v. enkel lokaal in de Loonkosten-tabel-IIFE verderop),
// zodat het gecombineerde Kostenoverzicht onderaan dit bedrag kan hergebruiken zonder
// bedragen op meerdere, verspreide plekken te tonen.
const isGarantieTotaal = R.servicetype === 'garantie';
const { bruto: brutoTotaal } = berekenLoonkost(R.servicetype, calcWerktijdMin(R.start, R.stop), parseInt(R.aanrijtijdMin) || 0);
const nettoTotaal = isGarantieTotaal ? 0 : brutoTotaal;
```

**2. Subtotaal-regel uit de onderdelen-tabel verwijderen** (index.html:6009-6014), huidige code:
```js
  if (geldigeOnderdelen.length) {
    partsHtml += `<tr style="background:#f0fdf9;font-weight:700">
      <td colspan="2" style="text-align:right;font-size:8pt;text-transform:uppercase;letter-spacing:.05em;color:#555">Totaal onderdelen (excl. btw)</td>
      <td colspan="2" style="text-align:right">€ ${totaalOnderdelen.toFixed(2)}</td>
    </tr>`;
  }
```
wordt volledig verwijderd — de tabel toont voortaan enkel lijnitems, het subtotaal verhuist naar het Kostenoverzicht (zie punt 3).

**3. Subtotaal-regel uit de loonkosten-tabel verwijderen, en het Kostenoverzicht toevoegen** (index.html:6160-6163), huidige code:
```js
${isGarantie ? `<tr style="background:#f0fdf9;font-weight:700"><td style="text-align:right;font-size:8pt;text-transform:uppercase;letter-spacing:.05em;color:#555">Totaal loonkosten (excl. btw)</td><td style="text-align:right">€ 0,00</td></tr>`
             : `<tr style="background:#f0fdf9;font-weight:700"><td style="text-align:right;font-size:8pt;text-transform:uppercase;letter-spacing:.05em;color:#555">Totaal loonkosten (excl. btw)</td><td style="text-align:right">€ ${netto.toFixed(2)}</td></tr>`}
</tbody></table>`;
})()}
```
wordt:
```js
</tbody></table>`;
})()}
<div class="rapport-section">
<div class="sec">Kostenoverzicht</div>
<table class="parts"><tbody>
<tr><td>Onderdelen (excl. btw)</td><td style="text-align:right">€ ${totaalOnderdelen.toFixed(2)}</td></tr>
<tr><td>Loonkosten (excl. btw)${isGarantieTotaal ? ' <span style="font-size:7.5pt;color:#888;font-style:italic">(100% korting)</span>' : ''}</td><td style="text-align:right">€ ${nettoTotaal.toFixed(2)}</td></tr>
<tr style="background:#111;color:#fff;font-weight:700"><td style="text-transform:uppercase;letter-spacing:.05em;font-size:8pt">Totaal te factureren (excl. btw)</td><td style="text-align:right;font-size:11pt">€ ${(totaalOnderdelen + nettoTotaal).toFixed(2)}</td></tr>
</tbody></table>
</div>
```
(De Loonkosten-tabel zelf — met de gedetailleerde regel "Werktijd: ... → X gestarte uur × €115" — blijft ongewijzigd staan vóór dit nieuwe blok; enkel de dubbele subtotaal-regel eronder verdwijnt.)

## Resultaat

Twee tabellen tonen enkel nog lijnitems ("Vervangen onderdelen", "Loonkosten"). Daaronder staat exact één sectie "Kostenoverzicht" met de twee subtotalen en het gecombineerde eindtotaal — alle bedragen gegroepeerd op één plek, in plaats van verspreid over 3 losse regels.

## Niet in scope

- Geen wijziging aan `renderRapportArchief()`'s eigen `totFactureerbaar`-berekening (index.html:6314) — die bestond al correct, enkel het PDF-document zelf miste dit.
- Geen wijziging aan de rapport-wizard's live voorbeeldweergave tijdens het invullen (indien die apart bestaat) — enkel het finale, gegenereerde PDF-rapport.
