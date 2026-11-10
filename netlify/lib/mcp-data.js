// Data-functies voor de leesconnector (MCP): zoeken, tellen en paalhistoriek over interventierapporten.
// Rol-blind: de aanroeper past de rechten (filterRapportenVoor) VOOR deze functies toe.
// Enkel lezen, schrijft nooit naar de store.

import { LIJST_KEY, effectieveStatus } from './rapportlijst.js';
import { ARCHIEF_PREFIX, archiefJaren, leesArchieven } from './rapport-jaararchief.js';

export const MAX_RESULTATEN = 200;
const ONBEKEND = '(onbekend)';

const tekst = v => (v === undefined || v === null ? '' : String(v));
const klein = v => tekst(v).trim().toLowerCase();

// Serienummer: trim, hoofdletters, alle spaties weg.
export function normSerie(s) {
  return tekst(s).replace(/\s+/g, '').toUpperCase();
}

function geannuleerd(entry) {
  return entry.geannuleerd === true || effectieveStatus(entry) === 'geannuleerd';
}

// Vroegste archiefjaar: uit store.list (prefix), anders een vaste ondergrens.
const ARCHIEF_ONDERGRENS = 2024;
async function vroegsteArchiefJaar(store) {
  try {
    if (typeof store.list !== 'function') return ARCHIEF_ONDERGRENS;
    const { blobs } = await store.list({ prefix: ARCHIEF_PREFIX });
    const jaren = (blobs ?? []).map(b => Number(tekst(b.key).slice(ARCHIEF_PREFIX.length))).filter(j => Number.isInteger(j) && j > 1900);
    return jaren.length ? Math.min(...jaren) : ARCHIEF_ONDERGRENS;
  } catch {
    return ARCHIEF_ONDERGRENS;
  }
}

// Actieve lijst + jaararchieven van de periode, ontdubbeld op id (actief wint), geannuleerde eruit.
// Ontbrekende van = vroegste archief, ontbrekende tot = huidig jaar (nu, injecteerbaar).
// Geeft { rapporten, ontbrekendeJaren }: archiefjaren die niet leesbaar waren (data dan onvolledig).
export async function laadRapporten(store, { van, tot } = {}, { nu = new Date() } = {}) {
  const actief = (await store.get(LIJST_KEY, { type: 'json' }))?.rapports;
  const vanDatum = van || `${await vroegsteArchiefJaar(store)}-01-01`;
  const totDatum = tot || `${nu.getFullYear()}-12-31`;
  const { rapports: archief, fouten } = await leesArchieven(store, archiefJaren(vanDatum, totDatum));
  const gezien = new Set();
  const rapporten = [];
  for (const e of [...(Array.isArray(actief) ? actief : []), ...archief]) {
    if (!e || typeof e !== 'object') continue;
    const id = tekst(e.id);
    if (id && gezien.has(id)) continue;
    if (id) gezien.add(id);
    if (geannuleerd(e)) continue;
    rapporten.push(e);
  }
  return { rapporten, ontbrekendeJaren: fouten.map(Number) };
}

function oorzakenVan(rd) {
  const o = rd?.oorzaakStoring;
  const lijst = Array.isArray(o) ? o : (o ? [o] : []);
  return lijst.map(x => tekst(x).trim()).filter(Boolean);
}

// Plat, licht rapport voor het antwoord aan Claude (geen zware velden).
export function vlakRapport(entry) {
  const rd = entry?.rapportData && typeof entry.rapportData === 'object' ? entry.rapportData : {};
  const vlak = {
    id: tekst(entry.id),
    datum: tekst(entry.datum),
    technieker: tekst(entry.technieker),
    ticketNumber: tekst(entry.ticketNumber),
    klant: tekst(entry.klant),
    adres: tekst(entry.adres),
    interventieType: tekst(entry.interventieType),
    servicetype: tekst(entry.servicetype),
    serienummer: normSerie(rd.serienummer),
    oorzaken: oorzakenVan(rd),
    probleem: tekst(rd.probleem),
    acties: tekst(rd.acties),
    hersteld: tekst(entry.hersteld),
    nieuwInter: tekst(entry.nieuwInter),
    onderdelen: Array.isArray(rd.onderdelen)
      ? rd.onderdelen.filter(p => p && p.naam).map(p => ({ naam: tekst(p.naam), aantal: parseInt(p.aantal, 10) || 1 }))
      : [],
  };
  if (rd.probleemtype !== undefined && rd.probleemtype !== null && rd.probleemtype !== '') vlak.probleemtype = tekst(rd.probleemtype);
  if (rd.garantieStatus !== undefined && rd.garantieStatus !== null && rd.garantieStatus !== '') vlak.garantieStatus = tekst(rd.garantieStatus);
  return vlak;
}

function pastBij(v, f) {
  if (f.van && !(v.datum >= f.van)) return false;
  if (f.tot && !(v.datum.slice(0, f.tot.length) <= f.tot)) return false;
  if (f.serienummer && v.serienummer !== normSerie(f.serienummer)) return false;
  if (f.ticketNumber && klein(v.ticketNumber) !== klein(f.ticketNumber)) return false;
  if (f.technieker && !klein(v.technieker).includes(klein(f.technieker))) return false;
  if (f.oorzaak && !v.oorzaken.some(o => klein(o) === klein(f.oorzaak))) return false;
  if (f.interventieType && klein(v.interventieType) !== klein(f.interventieType)) return false;
  if (f.hersteld && klein(v.hersteld) !== klein(f.hersteld)) return false;
  if (f.tekst) {
    const n = klein(f.tekst);
    if (![v.probleem, v.acties, v.klant, v.adres].some(t => klein(t).includes(n))) return false;
  }
  return true;
}

const FILTERSLEUTELS = ['van', 'tot', 'serienummer', 'ticketNumber', 'technieker', 'oorzaak', 'interventieType', 'hersteld', 'tekst'];
const enkelFilters = (o = {}) => Object.fromEntries(FILTERSLEUTELS.filter(k => o[k] !== undefined && o[k] !== null && o[k] !== '').map(k => [k, o[k]]));

function gefilterd(rapporten, filters) {
  const f = enkelFilters(filters);
  return rapporten.map(vlakRapport).filter(v => pastBij(v, f));
}

// Nieuwste eerst; afgekapt op `limiet` (standaard 200).
export function zoekRapporten(rapporten, filters = {}, { limiet = MAX_RESULTATEN } = {}) {
  const max = Math.min(Math.max(1, Number(limiet) || MAX_RESULTATEN), MAX_RESULTATEN);
  const alle = gefilterd(rapporten, filters).sort((a, b) => (a.datum < b.datum ? 1 : a.datum > b.datum ? -1 : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
  return { resultaten: alle.slice(0, max), totaal: alle.length, afgekapt: alle.length > max };
}

function sleutelsVoor(v, groepeer) {
  switch (groepeer) {
    case 'oorzaak': return v.oorzaken.length ? v.oorzaken : [ONBEKEND];
    case 'serienummer': return [v.serienummer || ONBEKEND];
    case 'technieker': return [v.technieker.trim() || ONBEKEND];
    case 'maand': return [/^\d{4}-\d{2}/.test(v.datum) ? v.datum.slice(0, 7) : ONBEKEND];
    case 'klant': return [v.klant.trim() || ONBEKEND];
    case 'interventieType': return [v.interventieType.trim() || ONBEKEND];
    default: throw new Error('onbekende groepering: ' + groepeer);
  }
}

function tel(vlakken, groepeer) {
  const m = new Map();
  for (const v of vlakken) for (const s of new Set(sleutelsVoor(v, groepeer))) m.set(s, (m.get(s) || 0) + 1);
  return [...m].map(([sleutel, aantal]) => ({ sleutel, aantal }))
    .sort((a, b) => b.aantal - a.aantal || (a.sleutel < b.sleutel ? -1 : a.sleutel > b.sleutel ? 1 : 0));
}

// Aflopend op aantal; bij 'maand' blijft dat ook zo (chronologisch kan de aanroeper zelf).
export function telRapporten(rapporten, { groepeer, minimum = 1, ...filters } = {}) {
  const vlakken = gefilterd(rapporten, filters);
  const groepen = tel(vlakken, groepeer).filter(g => g.aantal >= (Number(minimum) || 1));
  return { groepen, totaalRapporten: vlakken.length };
}

export function paalHistoriek(rapporten, serienummer) {
  const norm = normSerie(serienummer);
  const bezoeken = norm
    ? rapporten.map(vlakRapport).filter(v => v.serienummer === norm).sort((a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : 0))
    : [];
  return { serienummer: norm, bezoeken, oorzaken: tel(bezoeken, 'oorzaak') };
}
