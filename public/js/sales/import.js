// Sales-planner: het exportbestand van de verkoper lezen (pure logica).
// Leads zijn persoonsgegevens: velden worden enkel als tekst bewaard (nooit geinterpreteerd) en afgekapt.
import { ontleedAdres } from './adres.js';

export const MAX_LEADS = 500;
export const MAX_BYTES = 2 * 1024 * 1024;
const MAX_VELD = 200;

/** E-mail lowercase en getrimd, of null zonder '@'. */
export function normaliseerEmail(x) {
  if (typeof x !== 'string') return null;
  const e = x.trim().toLowerCase();
  return e.includes('@') ? e : null;
}

/** Gsm als enkel cijfers met landcode 32 ('32478123456'), of null bij minder dan 9 cijfers (placeholder). */
export function normaliseerGsm(x) {
  if (typeof x !== 'string' && typeof x !== 'number') return null;
  let d = String(x).replace(/\D/g, '');
  if (d.length < 9 || /^0+$/.test(d)) return null;
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('320')) d = '32' + d.slice(3); // '+32 (0)478 ...'
  else if (d.startsWith('0')) d = '32' + d.slice(1);
  return d;
}

const sleutelNaam = (x) => String(x ?? '').toLowerCase().replace(/\s+/g, '');

/** Hoofdletter- en spatie-ongevoelige vergelijking; lege namen zijn nooit gelijk. */
export function zelfdeNaam(a, b) {
  const x = sleutelNaam(a);
  return x !== '' && x === sleutelNaam(b);
}

function tekstVeld(x) {
  if (typeof x === 'number' && Number.isFinite(x)) x = String(x);
  if (typeof x !== 'string') return null;
  const t = x.trim().slice(0, MAX_VELD).trim();
  return t === '' ? null : t;
}

function leesLead(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const voornaam = tekstVeld(r.voornaam);
  const naam = tekstVeld(r.naam);
  const gsm = tekstVeld(r.gsm);
  const email = normaliseerEmail(tekstVeld(r.email) ?? '');
  if (!voornaam && !naam && !gsm && !email) return null;
  const lead = { voornaam, naam, gsm, email, postcode: null, gemeente: null, straat: null, huisnr: null, adresTekst: null };
  const a = ontleedAdres(tekstVeld(r.adres) ?? '');
  if (a.soort === 'postcode') {
    lead.postcode = a.postcode;
    lead.gemeente = a.gemeente ?? null;
  } else if (a.soort === 'adres') {
    Object.assign(lead, { straat: a.straat, huisnr: a.huisnr, postcode: a.postcode, gemeente: a.gemeente });
  } else {
    lead.adresTekst = a.adresTekst || null;
  }
  return lead;
}

/** Leest het exportbestand (JSON-tekst of al geparst object). */
export function leesExport(invoer) {
  let data = invoer;
  if (typeof invoer === 'string') {
    if (new TextEncoder().encode(invoer).length > MAX_BYTES) return { ok: false, fout: 'Het bestand is groter dan 2 MB' };
    try { data = JSON.parse(invoer); } catch { return { ok: false, fout: 'Het bestand is geen geldige JSON' }; }
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.leads)) {
    return { ok: false, fout: 'Geen geldige export: "leads" ontbreekt' };
  }
  if (data.leads.length > MAX_LEADS) return { ok: false, fout: 'Maximaal 500 leads per bestand' };
  const leads = [];
  let overgeslagen = 0;
  for (const r of data.leads) {
    const lead = leesLead(r);
    if (lead) leads.push(lead); else overgeslagen++;
  }
  return {
    ok: true,
    verantwoordelijke: tekstVeld(data.verantwoordelijke),
    geexporteerdOp: tekstVeld(data.geexporteerdOp),
    statussen: Array.isArray(data.statussen) ? data.statussen.map(tekstVeld).filter(Boolean) : [],
    aantal: Number.isFinite(data.aantal) ? data.aantal : null,
    overgeslagen,
    leads,
  };
}
