// Sales-planner: een lead manueel toevoegen (pure logica, geen DOM, geen netwerk; ook door de server gebruikt).
// De verkoper tikt één lead in (telefoon, beurs, doorverwijzing); die wordt als export-object met `bron: 'manueel'` langs dezelfde
// import- en samenvoeglogica gestuurd als een JSON-export (herkenning, grafstenen, geocoding). Minimum: een naam (voornaam of naam),
// een gsm-nummer of e-mailadres en een postcode van 4 cijfers; al de rest is optioneel en later aan te vullen in de fiche.
import { normaliseerGsm, normaliseerEmail } from './import.js';
import { herkenningssleutels } from './herkenning.js';

export const MANUEEL = 'manueel';
export const MAX_VELD = 200;
export const MAX_NOTITIE = 1000;

export const FOUT_NAAM = 'Vul een naam in';
export const FOUT_CONTACT = 'Vul een gsm-nummer of e-mailadres in';
export const FOUT_POSTCODE = 'Postcode bestaat uit 4 cijfers';
export const FOUT_STRAAT = 'Vul straat én huisnummer in';
export const FOUT_PRECIES_EEN = 'Een manueel toegevoegde lead bestaat uit precies één lead';

const VELDEN = ['voornaam', 'naam', 'gsm', 'email', 'postcode', 'gemeente', 'straat', 'huisnr', 'notitie'];
const LABELS = { voornaam: 'Voornaam', naam: 'Naam', gsm: 'Gsm', email: 'E-mail', gemeente: 'Gemeente', straat: 'Straat', huisnr: 'Huisnummer' };
const tekst = (x) => (x == null ? '' : String(x).trim());
const leegNaarNull = (s) => (s === '' ? null : s);

/**
 * invoer = { voornaam, naam, gsm, email, postcode, gemeente, straat, huisnr, notitie } (teksten uit het formulier)
 * -> { fouten: { naam?, contact?, gsm?, email?, postcode?, straat?, voornaam?, ..., notitie? } } | { lead } (getrimd, leeg = null)
 * Een ingevuld maar onbruikbaar nummer of e-mailadres krijgt een fout op het veld zelf (het zou anders stilzwijgend wegvallen);
 * `contact` staat er enkel als beide velden leeg zijn.
 */
export function valideerManueleLead(invoer) {
  const v = Object.fromEntries(VELDEN.map(k => [k, tekst(invoer?.[k])]));
  const fouten = {};
  if (v.voornaam === '' && v.naam === '') fouten.naam = FOUT_NAAM;
  if (v.gsm === '' && v.email === '') fouten.contact = FOUT_CONTACT;
  if (v.gsm !== '' && normaliseerGsm(v.gsm) === null) fouten.gsm = 'Dit gsm-nummer lijkt niet te kloppen';
  if (v.email !== '' && normaliseerEmail(v.email) === null) fouten.email = 'Dit e-mailadres lijkt niet te kloppen';
  if (!/^\d{4}$/.test(v.postcode)) fouten.postcode = FOUT_POSTCODE;
  if ((v.straat === '') !== (v.huisnr === '')) fouten.straat = FOUT_STRAAT;
  for (const [k, label] of Object.entries(LABELS)) {
    if (v[k].length > MAX_VELD && !fouten[k]) fouten[k] = `${label} is te lang (max. ${MAX_VELD} tekens)`;
  }
  if (v.notitie.length > MAX_NOTITIE) fouten.notitie = `Notitie is te lang (max. ${MAX_NOTITIE} tekens)`;
  if (Object.keys(fouten).length) return { fouten };
  return { lead: Object.fromEntries(Object.entries(v).map(([k, w]) => [k, leegNaarNull(w)])) };
}

/** Het export-object voor POST /api/sales-import: één lead, `bron: 'manueel'`, geen verantwoordelijke (de verkoper is de ingelogde gebruiker). */
export function bouwManueelExport(lead) {
  const { voornaam, naam, gsm, email, postcode, gemeente, straat, huisnr, notitie } = lead;
  return { bron: MANUEEL, verantwoordelijke: null, geexporteerdOp: null, aantal: 1, statussen: [], leads: [{ voornaam, naam, gsm, email, postcode, gemeente, straat, huisnr, notitie }] };
}

/**
 * Server: de controle op een export met `bron: 'manueel'` (de client mag niets omzeilen). -> null (in orde) | { fout, fouten }
 * `fout` = de eerste fouttekst (naam, dan contact, dan postcode, dan de rest).
 */
export function controleerManueleExport(exp) {
  const leads = exp?.leads;
  if (!Array.isArray(leads) || leads.length !== 1 || leads[0] === null || typeof leads[0] !== 'object' || Array.isArray(leads[0])) {
    return { fout: FOUT_PRECIES_EEN, fouten: {} };
  }
  const { fouten } = valideerManueleLead(leads[0]);
  if (!fouten) return null;
  const eerste = fouten.naam ?? fouten.contact ?? fouten.postcode ?? Object.values(fouten)[0];
  return { fout: eerste, fouten };
}

/** De bestaande lead die dezelfde herkenningssleutel (e-mail of gsm) heeft als `lead`, of null: de klant staat dan al in de lijst. */
export function zoekBestaandeLead(leads, lead) {
  const sleutels = new Set(herkenningssleutels(lead));
  if (sleutels.size === 0) return null;
  return (leads ?? []).find(l => herkenningssleutels(l).some(s => sleutels.has(s))) ?? null;
}
