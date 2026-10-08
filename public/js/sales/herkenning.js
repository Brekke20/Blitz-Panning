// Sales-planner: leads herkennen, samenvoegen met bestaande leads en grafstenen raadplegen (pure logica).
// Herkenning = e-mail, gsm (>= 9 cijfers) of, enkel als beide ontbreken, voornaam + naam + postcode.
// Grafstenen bevatten enkel hashes (de hash-functie wordt aangereikt door de server) en een datum.
import { normaliseerEmail, normaliseerGsm } from './import.js';

const kleineLetters = (x) => String(x ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Sleutels waarmee een lead herkend wordt: 'e:<email>', 'g:<32...>', anders 'n:<voornaam>|<naam>|<postcode>'. */
export function herkenningssleutels(lead) {
  const sleutels = [];
  const email = normaliseerEmail(lead?.email);
  const gsm = normaliseerGsm(lead?.gsm);
  if (email) sleutels.push('e:' + email);
  if (gsm) sleutels.push('g:' + gsm);
  if (sleutels.length) return sleutels;
  const voornaam = kleineLetters(lead?.voornaam);
  const naam = kleineLetters(lead?.naam);
  if (!voornaam && !naam) return []; // niets om op te herkennen
  return [`n:${voornaam}|${naam}|${kleineLetters(lead?.postcode)}`];
}

const leeg = (x) => x == null || String(x).trim() === '';

/** Vult lege contactvelden aan en upgradet een postcode-adres naar een volledig adres. Wijzigt `bestaande` (een kopie). */
function werkBij(bestaande, nieuw) {
  for (const veld of ['voornaam', 'naam', 'gsm', 'email']) {
    if (leeg(bestaande[veld]) && !leeg(nieuw[veld])) bestaande[veld] = nieuw[veld];
  }
  if (!bestaande.straat && nieuw.straat && nieuw.huisnr && nieuw.postcode) {
    Object.assign(bestaande, {
      straat: nieuw.straat, huisnr: nieuw.huisnr, postcode: nieuw.postcode, gemeente: nieuw.gemeente ?? null,
      adresTekst: null, locatie: null, // de server geocodeert opnieuw
    });
  }
}

function nieuweLead(n, { nu, nieuwId, bronExport }) {
  return {
    id: nieuwId(), voornaam: n.voornaam ?? null, naam: n.naam ?? null, gsm: n.gsm ?? null, email: n.email ?? null,
    postcode: n.postcode ?? null, gemeente: n.gemeente ?? null, straat: n.straat ?? null, huisnr: n.huisnr ?? null,
    adresTekst: n.adresTekst ?? null, locatie: null, status: 'te-plannen', bezoeken: [],
    geimporteerdOp: nu, bronExport: { verantwoordelijke: bronExport?.verantwoordelijke ?? null, geexporteerdOp: bronExport?.geexporteerdOp ?? null },
  };
}

// Parseniveau: vrije adrestekst of helemaal geen adres = nakijken.
const adresNakijken = (n) => Boolean(n.adresTekst) || !n.postcode;

/**
 * Voegt een import samen met de bestaande leads. Muteert de invoer niet.
 * Grafstenen worden enkel geraadpleegd voor leads die anders nieuw zouden zijn, en alleen mits `hash`.
 */
export function voegSamen(bestaande, nieuwe, { nu, nieuwId, bronExport, grafstenen = [], hash = null } = {}) {
  const leads = structuredClone(bestaande ?? []);
  const toegevoegd = [];
  const samenvatting = { nieuw: 0, alAanwezig: 0, adresNakijken: 0, eerderVerwijderd: 0 };
  const perSleutel = new Map();
  const registreer = (lead) => {
    for (const s of herkenningssleutels(lead)) if (!perSleutel.has(s)) perSleutel.set(s, lead);
  };
  leads.forEach(registreer);

  let overgebleven = structuredClone(grafstenen ?? []);
  const perHash = new Map();
  if (hash) overgebleven.forEach((g) => (g.h ?? []).forEach((h) => { if (!perHash.has(h)) perHash.set(h, g); }));
  const verbruikt = new Set();

  for (const n of nieuwe ?? []) {
    const sleutels = herkenningssleutels(n);
    const gevonden = sleutels.map((s) => perSleutel.get(s)).find(Boolean);
    if (gevonden) {
      werkBij(gevonden, n);
      registreer(gevonden); // aangevulde e-mail/gsm tellen vanaf nu mee
      samenvatting.alAanwezig++;
      continue;
    }
    const lead = nieuweLead(n, { nu, nieuwId, bronExport });
    if (hash) {
      const steen = sleutels.map((s) => perHash.get(hash(s))).find((g) => g && !verbruikt.has(g));
      if (steen) {
        lead.eerderVerwijderd = { op: steen.op };
        verbruikt.add(steen);
        samenvatting.eerderVerwijderd++;
      }
    }
    leads.push(lead);
    toegevoegd.push(lead);
    registreer(lead);
    samenvatting.nieuw++;
    if (adresNakijken(n)) samenvatting.adresNakijken++;
  }

  overgebleven = overgebleven.filter((g) => !verbruikt.has(g));
  return { leads, toegevoegd, samenvatting, grafstenen: overgebleven };
}
