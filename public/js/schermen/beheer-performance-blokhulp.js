// schermen/beheer-performance-blokhulp.js — gedeelde, pure bouwstenen van de vijf dashboardblokken (kaart, blok,
// ringenrij, datumlabels, groeperen per week). Enkel strings en getallen; alle tekst uit data gaat door escHtml.
import { escHtml } from '../kern/ui.js';
import { ringFiguur } from '../kern/grafiek-ring.js';
import { statusVoor } from '../kern/dashboard-grenzen.js';
import { kleurSlotVoor } from './beheer-performance-logica.js';

export const LEGE_ZIN = 'Geen gegevens in deze periode.';
const MAANDEN = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const DATUM_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const isGetal = x => typeof x === 'number' && Number.isFinite(x);

export const lijst = x => (Array.isArray(x) ? x : []);

// ---- Kaart en blok ----

// Een kaart op var(--surface): zichtbare kop, optionele uitleg en de inhoud. `breed` laat de kaart de hele rij vullen.
// Zonder titel (de inhoud heeft zelf een kop, bv. een tegel) komt er geen tweede kop bij.
export function kaart(titel, inhoud, { uitleg = '', breed = false, klasse = '' } = {}) {
  return `<section class="dash-kaart${breed ? ' dash-kaart--breed' : ''}${klasse ? ` ${klasse}` : ''}">`
    + `${titel ? `<h3 class="dash-kaart-kop">${escHtml(titel)}</h3>` : ''}${uitleg ? `<p class="dash-uitleg">${escHtml(uitleg)}</p>` : ''}${inhoud}</section>`;
}

// Een blok: titel + raster van kaarten; zonder kaarten (alles leeg) één lege-toestand-zin, nooit een lege kaart.
export function blok(id, titel, kaarten, { noot = '' } = {}) {
  const inhoud = kaarten.filter(Boolean);
  const hoofd = `<h2 class="dash-blok-kop" id="dash-blok-${escHtml(id)}">${escHtml(titel)}</h2>`;
  const nootHtml = noot ? `<p class="dash-noot">${escHtml(noot)}</p>` : '';
  const binnen = inhoud.length ? `<div class="dash-raster">${inhoud.join('')}</div>` : `<p class="dash-leeg">${escHtml(LEGE_ZIN)}</p>`;
  return `<section class="dash-blok dash-blok--${escHtml(id)}" aria-labelledby="dash-blok-${escHtml(id)}">${hoofd}${nootHtml}${binnen}</section>`;
}

// Eén ring met zichtbare kop erboven (ringFiguur toont zelf geen kop). `kop` is de zichtbare naam, `titel` het aria-label.
export function ringMetKop(kop, opties) {
  return `<div class="dash-ring"><h4 class="dash-ring-kop">${escHtml(kop)}</h4>${ringFiguur(opties)}</div>`;
}

// Rij ringen: [{ kop, pct, n, noemer, sub }] met de status uit de kleurgrenzen van `sleutel`.
export function ringenRij(rijen, sleutel, grenzen, titelVoor) {
  return `<div class="dash-ringen">${rijen.map(r => ringMetKop(r.kop, {
    pct: r.pct, status: statusVoor(sleutel, r.pct, grenzen), titel: titelVoor(r.kop), n: r.n, noemer: r.noemer, sub: r.sub ?? '',
  })).join('')}</div>`;
}

// Een kaart met één ring; de kaartkop is de zichtbare kop van de ring.
export const ringKaart = (titel, opties, extra = '', kaartOpties = {}) => kaart(titel, ringFiguur({ ...opties, titel }) + extra, kaartOpties);

// Kleine tussenkop binnen een kaart (boven een tweede grafiek).
export const subkop = tekst => `<h4 class="dash-sub">${escHtml(tekst)}</h4>`;

// Korte feitenlijst onder een ring of tegel: [[label, waardetekst]].
export function feiten(regels) {
  return `<dl class="dash-feiten">${regels.map(([l, w]) => `<div><dt>${escHtml(l)}</dt><dd>${escHtml(w)}</dd></div>`).join('')}</dl>`;
}

// ---- Datums, groeperen, kleur ----

// '2026-10-05' -> '5 okt'; al het andere ongewijzigd.
export function korteDatum(d) {
  const m = DATUM_RE.exec(String(d ?? ''));
  return m && MAANDEN[Number(m[2]) - 1] ? `${Number(m[3])} ${MAANDEN[Number(m[2]) - 1]}` : String(d ?? '');
}

// '2026-10' -> 'okt 2026'.
export function maandLabel(m) {
  const x = /^(\d{4})-(\d{2})$/.exec(String(m ?? ''));
  return x && MAANDEN[Number(x[2]) - 1] ? `${MAANDEN[Number(x[2]) - 1]} ${x[1]}` : String(m ?? '');
}

// '2026-09-01' -> '1/9' (voor "sinds 1/9"); onbekend = ''.
export function dagMaand(d) {
  const m = DATUM_RE.exec(String(d ?? ''));
  return m ? `${Number(m[3])}/${Number(m[2])}` : '';
}

// Maandag van de week van een datum (YYYY-MM-DD, UTC-rekenwerk: geen tijdzone-sprongen).
export function weekStart(d) {
  const m = DATUM_RE.exec(String(d));
  if (!m) return String(d);
  const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t.toISOString().slice(0, 10);
}

// Boven dit aantal dagpunten groeperen de lijn- en kolomgrafieken per week (anders overlappen de hit-stroken).
export const MAX_DAGPUNTEN = 19;

// punten: datums (gesorteerd); reeksen: [{ …, waarden:[number] }] -> { punten, reeksen, perWeek }.
// Boven `max` punten worden de waarden per week opgeteld; het label van een week is "wk 28 sep".
export function groepeerPerWeek(punten, reeksen, max = MAX_DAGPUNTEN) {
  if (punten.length <= max) return { punten: punten.map(korteDatum), reeksen, perWeek: false };
  const weken = [...new Set(punten.map(weekStart))];
  const index = new Map(weken.map((w, i) => [w, i]));
  const som = r => {
    const w = weken.map(() => 0);
    punten.forEach((p, i) => { w[index.get(weekStart(p))] += isGetal(r.waarden[i]) ? r.waarden[i] : 0; });
    return { ...r, waarden: w };
  };
  return { punten: weken.map(w => `wk ${korteDatum(w)}`), reeksen: reeksen.map(som), perWeek: true };
}

// Stabiel kleurslot: volgorde van de eerste niet-lege bron (ctx, dan de filteropties), aangevuld met de eigen volgorde van de data.
function slotVan(naam, bronnen, eigen) {
  const bron = bronnen.find(l => Array.isArray(l) && l.length) ?? [];
  return kleurSlotVoor(naam, [...bron, ...eigen.filter(e => !bron.includes(e))]);
}
export const techniekerSlot = (naam, ctx, data, eigen = []) => slotVan(naam, [ctx?.techniekers, data?.opties?.techniekers], eigen);
export const typeSlot = (naam, data, eigen = []) => slotVan(naam, [data?.opties?.types], eigen);
