// schermen/beheer-themas-logica.js — pure berekeningen voor de beheertab Thema's: de status per kaart in gewoon Nederlands,
// de kaartgegevens, de periode uit de invoervelden, de controle van een te uploaden bestand en de foutregels. Geen DOM, geen window.
import { actiefThema, effectievePeriode, isActief, periodeVoorJaar, vensterTekst, belgischeDag } from '../kern/themapakket.js';
import { valideerPakket, valideerPeriode, MAX_PAKKET_BYTES } from '../kern/themapakket-validatie.js';

export const MAANDEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
export const BINNENKORT_DAGEN = 14; // zoals de server: pakketten van thema's die binnen 14 dagen beginnen
const DAG_MS = 24 * 60 * 60 * 1000;
const MAX_FOUTREGELS = 50;
const MAX_REGEL = 200;

const dagTekst = (datum) => {
  const { jaar, maand, dag } = belgischeDag(datum);
  return `${jaar}-${String(maand).padStart(2, '0')}-${String(dag).padStart(2, '0')}`;
};
const dagenTussen = (van, tot) => Math.round((Date.parse(tot) - Date.parse(van)) / DAG_MS);

// Eén van: { soort: 'uit'|'actief'|'overschaduwd'|'binnenkort'|'later', tekst } in gewoon Nederlands.
//  - uit: de beheerder zette het thema uit (gaat voor alles);
//  - actief: het thema loopt en wint;
//  - overschaduwd: het loopt, maar een thema met een korter venster gaat voor (de overlapregel van actiefThema);
//  - binnenkort: begint binnen 14 dagen; later: begint later (dit jaar of volgend jaar).
export function statusVan(thema, alle, datum = new Date()) {
  if (thema.aan === false) return { soort: 'uit', tekst: 'Uit' };
  if (isActief(thema, datum)) {
    const winnaar = actiefThema(datum, alle);
    if (!winnaar || winnaar.id === thema.id) return { soort: 'actief', tekst: 'Nu actief' };
    return { soort: 'overschaduwd', tekst: `Loopt, maar ${winnaar.naam} gaat voor` };
  }
  const dag = dagTekst(datum);
  const jaar = Number(dag.slice(0, 4));
  const periode = effectievePeriode(thema);
  let start = null;
  for (const j of [jaar, jaar + 1]) {
    const s = periodeVoorJaar(periode, j).start;
    if (s > dag) { start = s; break; }
  }
  const dagen = start ? dagenTussen(dag, start) : Infinity;
  if (dagen <= BINNENKORT_DAGEN) return { soort: 'binnenkort', tekst: dagen === 1 ? 'Begint morgen' : `Begint over ${dagen} dagen` };
  return { soort: 'later', tekst: start && Number(start.slice(0, 4)) === jaar ? 'Later dit jaar' : 'Volgend jaar' };
}

// De gegevens van één kaart: { id, naam, aan, status, periodeTekst, aangepast }.
export function kaartVan(thema, alle, datum = new Date()) {
  const dag = dagTekst(datum);
  const jaar = Number(dag.slice(0, 4));
  const periode = effectievePeriode(thema);
  // Een beweeglijke periode toont de lopende of komende uitvoering (Pasen van dit jaar is misschien al voorbij).
  const tekstJaar = periodeVoorJaar(periode, jaar).einde < dag ? jaar + 1 : jaar;
  return {
    id: thema.id,
    naam: thema.naam,
    aan: thema.aan !== false,
    status: statusVan(thema, alle, datum),
    periodeTekst: vensterTekst(periode, tekstJaar),
    aangepast: thema.periodeOverride !== null && thema.periodeOverride !== undefined,
  };
}

// ── Periode uit de invoervelden ──────────────────────────────────────────────────────────────────────────────────────────
const heelGetal = (w) => {
  if (typeof w === 'number') return Number.isInteger(w) ? w : null;
  if (typeof w === 'string' && /^\s*-?\d+\s*$/.test(w)) return Number(w);
  return null;
};

// { maand, dag } (getallen of cijfertekst), 'MM-DD' of 'YYYY-MM-DD' -> { maand, dag } of null.
function leesDatum(w) {
  if (w !== null && typeof w === 'object') {
    const maand = heelGetal(w.maand);
    const dag = heelGetal(w.dag);
    return maand === null || dag === null ? null : { maand, dag };
  }
  if (typeof w === 'string') {
    const m = /^(?:\d{4}-)?(\d{1,2})-(\d{1,2})$/.exec(w.trim());
    if (m) return { maand: Number(m[1]), dag: Number(m[2]) };
  }
  return null;
}

// Invoer van het periodeformulier -> een periode, of { fout } met een Nederlandse tekst. `soort` is 'vast' (twee datums: van na tot
// = over de jaarwissel) of 'pasen' (twee getallen: dagen ten opzichte van Pasen). Valideert met dezelfde regels als de server.
export function periodeUitInvoer(invoer) {
  const i = invoer !== null && typeof invoer === 'object' ? invoer : {};
  let kandidaat;
  if (i.soort === 'vast') {
    const van = leesDatum(i.vanDatum);
    const tot = leesDatum(i.totDatum);
    if (!van || !tot) return { fout: 'Vul een begin- en einddatum in (dag en maand).' };
    kandidaat = { van, tot };
  } else if (i.soort === 'pasen') {
    const van = heelGetal(i.vanDagen);
    const tot = heelGetal(i.totDagen);
    if (van === null || tot === null) return { fout: 'Vul voor beide grenzen een geheel aantal dagen in (negatief is voor Pasen).' };
    kandidaat = { basis: 'pasen', van, tot };
  } else {
    return { fout: 'Kies een soort periode.' };
  }
  const r = valideerPeriode(kandidaat);
  if (!r.ok) return { fout: String(r.fouten[0]?.fout ?? 'De periode is ongeldig.') };
  return r.periode;
}

// ── Upload ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Controleert de tekst van een gekozen bestand vóór het verzenden: { ok: true, pakket } of { ok: false, fouten: [{ veld, fout }] }.
// Meer dan 512 kB geeft een fout zonder dat er iets verstuurd wordt.
export function controleerUpload(tekst) {
  const t = typeof tekst === 'string' ? tekst : '';
  const bytes = new TextEncoder().encode(t).length;
  if (bytes > MAX_PAKKET_BYTES) return { ok: false, fouten: [{ veld: 'pakket', fout: 'Het bestand is groter dan 512 kB.' }] };
  let pakket;
  try { pakket = JSON.parse(t); } catch { return { ok: false, fouten: [{ veld: 'pakket', fout: 'Het bestand is geen geldige JSON.' }] }; }
  const r = valideerPakket(pakket, { tekstLengte: bytes });
  return r.ok ? { ok: true, pakket: r.pakket } : { ok: false, fouten: r.fouten };
}

// De foutregels als platte tekst ("veld: fout"), hoogstens 50 + een samenvatting; elke regel is begrensd. De tekst bevat ruwe
// sleutels uit een bestand of een serverantwoord: de aanroeper toont ze enkel via textContent.
export function foutRegels(fouten) {
  const lijst = Array.isArray(fouten) ? fouten.filter(f => f !== null && typeof f === 'object' && typeof f.fout === 'string') : [];
  const regel = (f) => {
    const veld = typeof f.veld === 'string' ? f.veld : '';
    return (veld === '' ? f.fout : `${veld}: ${f.fout}`).slice(0, MAX_REGEL);
  };
  const uit = lijst.slice(0, MAX_FOUTREGELS).map(regel);
  if (lijst.length > MAX_FOUTREGELS) uit.push(`en ${lijst.length - MAX_FOUTREGELS} andere fouten`);
  return uit;
}

// ── Download ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
export function downloadNaam(id) {
  return `${String(id ?? '').replace(/[^A-Za-z0-9-]/g, '-')}.blitzthema.json`;
}
export function downloadTekst(pakket) {
  return JSON.stringify(pakket, null, 2);
}
