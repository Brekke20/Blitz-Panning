// Gemeenschappelijke bouwstenen van het performance-dashboard: een lijst-entry omzetten naar een
// vlak, betrouwbaar `Rapport`, plus datum- en rekenhulpen. Geen I/O; datums via Date.UTC
// (zomertijd-veilig). De enige import is de read-only statusregel van de rapportlijst.
import { effectieveStatus } from '../rapportlijst.js';

export const TYPE_ONBEKEND = 'Onbekend';
export const MAX_WERKTIJD_MIN = 720;

const DAG_MS = 86400000;
const DATUM_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIJD_RE = /^(\d{1,2}):(\d{2})$/;

const tekst = v => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());
const getal = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : null; };

function tijdNaarMin(t) {
  const m = TIJD_RE.exec(tekst(t));
  if (!m) return null;
  const u = +m[1], mi = +m[2];
  return u > 23 || mi > 59 ? null : u * 60 + mi;
}

// "1u30", "2u", "45 min", "1u 05 min", "1,5u"; null als het geen duur is.
function tekstNaarMin(s) {
  const t = tekst(s).toLowerCase();
  if (!t) return null;
  let m = /^(\d+(?:[.,]\d+)?)\s*(?:u|uur|h)\s*(?:(\d+)\s*(?:min|m)?)?$/.exec(t);
  if (m) return Math.round(parseFloat(m[1].replace(',', '.')) * 60 + (m[2] ? parseInt(m[2], 10) : 0));
  m = /^(\d+)\s*(?:min|m)$/.exec(t);
  return m ? parseInt(m[1], 10) : null;
}

// { min, onbetrouwbaar }: min = bruikbare werktijd of null; onbetrouwbaar = er stond wel een waarde
// maar die is <= 0 of > MAX_WERKTIJD_MIN (telt in de dekking, nooit in een gemiddelde).
function leesWerktijd(rd) {
  const s = tijdNaarMin(rd?.start), e = tijdNaarMin(rd?.stop);
  let min = null;
  if (s !== null && e !== null) {
    min = e - s;
    if (min < 0) min += 1440; // loopt over middernacht
  } else {
    min = tekstNaarMin(rd?.werktijd);
  }
  if (min === null) return { min: null, onbetrouwbaar: false };
  if (min <= 0 || min > MAX_WERKTIJD_MIN) return { min: null, onbetrouwbaar: true };
  return { min, onbetrouwbaar: false };
}

// Werktijd in minuten (start/stop eerst, daarna de tekst), of null als die ontbreekt of onbetrouwbaar is.
export function werktijdMinuten(rd) {
  return leesWerktijd(rd).min;
}

// Plaatshouders die technieker of Zoho in het serienummerveld zetten ("nvt", "n.v.t.", "-", "0", "?", "onbekend", ...) zijn geen
// serienummer: als sleutel zouden alle bezoeken ermee als herhaalbezoek van elkaar tellen. Hier wordt het ''; de herhaalcheck valt dan terug op het adres.
const PLAATSHOUDERS = new Set(['NVT', 'NA', 'ONBEKEND', 'GEEN', 'NIETBEKEND', 'NIETVANTOEPASSING', 'UNKNOWN', 'NONE', 'X', 'XX', 'TBD', 'NB']);
export function normaliseerSerienummer(s) {
  const n = tekst(s).toUpperCase().replace(/\s+/g, '');
  const kern = n.replace(/[^A-Z0-9]/g, '');
  if (!kern || /^0+$/.test(kern) || PLAATSHOUDERS.has(kern)) return '';
  return n;
}

export function normaliseerAdres(s) {
  const n = tekst(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  return n.length < 6 ? '' : n;
}

function utc(datum) {
  const [j, m, d] = datum.split('-').map(Number);
  return Date.UTC(j, m - 1, d);
}
function naarDatum(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

// Hele dagen b - a (YYYY-MM-DD).
export function dagenTussen(a, b) {
  return Math.round((utc(b) - utc(a)) / DAG_MS);
}

export function inPeriode(datum, van, tot) {
  return datum >= van && datum <= tot;
}

// Even lange periode direct vóór `van`.
export function vorigePeriode(van, tot) {
  const lengte = dagenTussen(van, tot) + 1;
  const vorigTot = utc(van) - DAG_MS;
  return { van: naarDatum(vorigTot - (lengte - 1) * DAG_MS), tot: naarDatum(vorigTot) };
}

// Maandag van de week van `datum`.
export function weekStart(datum) {
  const dag = new Date(utc(datum)).getUTCDay(); // 0 = zondag
  return naarDatum(utc(datum) - ((dag + 6) % 7) * DAG_MS);
}

export function filterRapporten(rapporten, { technieker = '', type = '' } = {}) {
  return rapporten.filter(r => (!technieker || r.technieker === technieker) && (!type || r.type === type));
}

// Percentage met 1 decimaal; null bij noemer 0.
export function pct(teller, noemer) {
  return noemer ? Math.round((teller / noemer) * 1000) / 10 : null;
}

export function gemiddelde(waarden) {
  return waarden.length ? waarden.reduce((s, w) => s + w, 0) / waarden.length : null;
}

export function mediaan(waarden) {
  if (!waarden.length) return null;
  const v = [...waarden].sort((x, y) => x - y);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

function leesOnderdelen(lijst, prijzen) {
  if (!Array.isArray(lijst)) return [];
  const uit = [];
  for (const p of lijst) {
    if (!p || typeof p !== 'object') continue;
    const id = tekst(p.id);
    const vrij = !id || id.startsWith('vrij-');
    const uitLijst = !vrij ? prijzen.get(id) : null;
    const naam = tekst(p.naam) || tekst(uitLijst?.naam) || id;
    if (!naam) continue;
    const aantal = parseInt(p.aantal, 10) || 1;
    const inRapport = getal(p.prijs);
    let prijs = 0, prijsBron = 'geen';
    if (inRapport > 0) { prijs = inRapport; prijsBron = 'rapport'; }
    else if (uitLijst && getal(uitLijst.prijs) > 0) { prijs = getal(uitLijst.prijs); prijsBron = 'prijslijst'; }
    const sleutel = vrij ? naam.toLowerCase().replace(/\s+/g, ' ') : id;
    uit.push({ sleutel, naam, aantal, prijs, prijsBron });
  }
  return uit;
}

function leesTijdslot(t) {
  const van = tekst(t?.van), tot = tekst(t?.tot);
  return tijdNaarMin(van) !== null && tijdNaarMin(tot) !== null ? { van, tot } : null;
}

// Lijst-entry -> Rapport, of null (geannuleerd, of geen geldige datum). Zware velden van oude
// entries (_html, foto's, handtekeningen) worden nooit overgenomen.
export function normaliseerRapport(entry, { prijzen = new Map() } = {}) {
  if (!entry || typeof entry !== 'object') return null;
  if (entry.geannuleerd === true || effectieveStatus(entry) === 'geannuleerd') return null;
  const datum = tekst(entry.datum);
  if (!DATUM_RE.test(datum)) return null;
  const rd = entry.rapportData && typeof entry.rapportData === 'object' ? entry.rapportData : {};
  const werk = leesWerktijd(rd);
  const aanrit = getal(rd.aanrijtijdMin);
  const alLangs = tekst(rd.installateurAlLangsGeweest).toLowerCase();
  return {
    id: tekst(entry.id),
    datum,
    technieker: tekst(entry.technieker),
    ticketId: tekst(entry.ticketId),
    ticketNumber: tekst(entry.ticketNumber),
    klant: tekst(entry.klant),
    adres: tekst(entry.adres),
    type: tekst(rd.type) || TYPE_ONBEKEND,
    interventieType: tekst(entry.interventieType) || 'Interventie',
    hersteld: entry.hersteld === 'ja',
    nieuwInter: entry.nieuwInter === 'ja',
    servicetype: tekst(entry.servicetype),
    facturatie: tekst(entry.facturatie),
    werktijdMin: werk.min,
    werktijdOnbetrouwbaar: werk.onbetrouwbaar,
    aanrijtijdMin: aanrit > 0 ? aanrit : null,
    start: tekst(rd.start),
    oorzaken: Array.isArray(rd.oorzaakStoring) ? rd.oorzaakStoring.map(tekst).filter(Boolean) : [],
    onderdelen: leesOnderdelen(rd.onderdelen, prijzen),
    serienummer: normaliseerSerienummer(rd.serienummer),
    alLangs: alLangs === 'ja' ? true : alLangs === 'nee' ? false : null,
    partner: tekst(rd.partner) || null,
    regio: tekst(rd.regio) || null,
    geplandTijdslot: leesTijdslot(rd.geplandTijdslot),
  };
}
