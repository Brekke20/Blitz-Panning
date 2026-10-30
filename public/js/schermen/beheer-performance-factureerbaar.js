// schermen/beheer-performance-factureerbaar.js — blok "Factureerbaar": het te factureren bedrag van de gekozen periode
// (onderdelen + loon). Eén brede kaart (ontwerp B): groot bedrag links, verdeelbalk onderdelen | loon met de uren rechts,
// onderaan in kleine letters enkel de aandachtspunten. Zuivere stringbouwer: renderFactureerbaar(data, ctx) -> html.
// De server rekent (netlify/lib/dashboard/factureerbaar.js, ook "niet aangerekend"); hier enkel tonen.
import { escHtml } from '../kern/ui.js';
import { formatDuur } from './beheer-performance-logica.js';
import { blok } from './beheer-performance-blokhulp.js';

const isGetal = x => typeof x === 'number' && Number.isFinite(x);
const getal = x => (isGetal(x) ? x : 0);
const meervoud = (n, een, meer) => `${n} ${n === 1 ? een : meer}`;
const heleEuro = new Intl.NumberFormat('nl-BE', { maximumFractionDigits: 0 });

// Hele euro's: "€ 2.314", minteken vóór het eurosymbool.
const euro = x => {
  const afgerond = Math.round(getal(x));
  return `${afgerond < 0 ? '-' : ''}€ ${heleEuro.format(Math.abs(afgerond))}`;
};

const UITLEG = ['Onderdelen en loon van de gekozen periode, excl. btw.', 'Loon van garantie- en installatiebezoeken telt niet mee.'];

// Zichtbare aandachtspunten (alleen wat van toepassing is); de eerste twee zijn goed Nederlands in enkelvoud en meervoud.
function aandachtspunten(d) {
  const punten = [];
  if (getal(d.zonderPrijs) > 0) punten.push(`${meervoud(d.zonderPrijs, 'onderdeel', 'onderdelen')} zonder prijs ${d.zonderPrijs === 1 ? 'telt' : 'tellen'} als € 0`);
  if (getal(d.zonderWerktijd) > 0) punten.push(`${meervoud(d.zonderWerktijd, 'rapport', 'rapporten')} zonder start- en stoptijd: geen loon geteld`);
  return punten;
}

export function renderFactureerbaar(data) {
  const f = data?.factureerbaar;
  if (!f || !(getal(f.dekking?.rapporten) > 0)) return blok('factureerbaar', 'Factureerbaar', []);
  const totaal = getal(f.totaal);
  // De twee delen tellen samen altijd 100 %: loon is de rest van het afgeronde onderdelenpercentage.
  const pctOnderdelen = totaal > 0 ? Math.min(100, Math.max(0, Math.round((getal(f.onderdelen) / totaal) * 100))) : 0;
  const pctLoon = 100 - pctOnderdelen;
  const balk = totaal > 0
    ? `<div class="fact-verdeel" role="img" aria-label="${escHtml(`Onderdelen ${euro(f.onderdelen)} (${pctOnderdelen} %), loon ${euro(f.loon)} (${pctLoon} %)`)}">`
      + `${pctOnderdelen > 0 ? `<span class="fact-deel-1" style="width:${pctOnderdelen}%"></span>` : ''}${pctLoon > 0 ? `<span class="fact-deel-2" style="width:${pctLoon}%"></span>` : ''}</div>`
    : '';
  const legende = `<ul class="fact-legende">`
    + `<li><span class="swatch swatch--1" aria-hidden="true"></span><span>Onderdelen${totaal > 0 ? ` <span class="fact-gedempt">· ${pctOnderdelen} %</span>` : ''}</span><b>${escHtml(euro(f.onderdelen))}</b></li>`
    + `<li><span class="swatch swatch--2" aria-hidden="true"></span><span>Loon${totaal > 0 ? ` <span class="fact-gedempt">· ${pctLoon} %</span>` : ''}</span><b>${escHtml(euro(f.loon))}</b>`
    + `<small>${escHtml(formatDuur(getal(f.minuten)))} werk- en rijtijd</small></li></ul>`;
  const punten = aandachtspunten(f.dekking ?? {});
  const voet = punten.length ? `<p class="fact-let">${punten.map(p => `<span>${escHtml(p)}</span>`).join('')}</p>` : '';
  const info = '<details class="fact-info"><summary aria-label="Hoe wordt dit berekend?">i</summary>'
    + `<div class="fact-bubbel"><strong>Hoe wordt dit berekend?</strong><ul>${UITLEG.map(u => `<li>${escHtml(u)}</li>`).join('')}</ul></div></details>`;
  const kaart = '<section class="dash-kaart dash-kaart--breed dash-kaart--factureerbaar">'
    + `<div class="fact-kaartkop"><h3 class="dash-kaart-kop">Factureerbaar bedrag</h3>${info}</div>`
    + `<div class="fact-hoofd"><div class="fact-groot"><span class="tegel-waarde">${escHtml(euro(totaal))}</span><p class="fact-sub">excl. btw</p></div>`
    + `<div class="fact-verdeling">${balk}${legende}</div></div>${voet}</section>`;
  return blok('factureerbaar', 'Factureerbaar', [kaart]);
}
