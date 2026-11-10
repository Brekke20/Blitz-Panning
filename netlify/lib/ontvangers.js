// netlify/lib/ontvangers.js: de ontvangers van een voorstel- of annuleermail (propose.js en annuleer.js).
// De planner mag per doelgroep (contact, klant, installateur) uitvinken, en het klant- en installateuradres aanpassen of invullen.
// Request-velden (beide optioneel; zonder = alle doelgroepen met het adres uit Zoho, het oude gedrag):
//   ontvangers: { contact?: boolean, klant?: boolean, installateur?: boolean }   (ontbrekend = true)
//   adressen:   { klant?: string, installateur?: string }                         (leeg of ontbrekend = het Zoho-adres)
// Een adres wordt strikt gevalideerd (één adres, geen scheidingstekens of regeleinden: header-injectie). Leeg maken wist het Zoho-veld
// nooit: enkel een geldig, gewijzigd adres wordt naar Zoho teruggeschreven (`cf_e_mail_eindklant` / `cf_e_mail_installateur`).

export const DOELGROEPEN = ['contact', 'klant', 'installateur'];
const CF_VELD = { klant: 'cf_e_mail_eindklant', installateur: 'cf_e_mail_installateur' };
const MAX_ADRES = 254;
// Eén adres: geen spaties, komma, puntkomma, haakjes of aanhalingstekens; een punt in het domein.
const ADRES_RE = /^[^\s@,;<>()"'\\]+@[^\s@,;<>()"'\\]+\.[^\s@,;<>()"'\\]+$/;

export function isGeldigAdres(adres) {
  return typeof adres === 'string' && adres.length <= MAX_ADRES && ADRES_RE.test(adres);
}

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// -> { ok: true, keuze: { contact, klant, installateur }, adressen: { klant?, installateur? } } | { ok: false, fout }
export function leesOntvangerKeuze(body) {
  const keuze = { contact: true, klant: true, installateur: true };
  const vlag = body?.ontvangers;
  if (vlag !== undefined && vlag !== null) {
    if (!isObject(vlag)) return { ok: false, fout: 'ontvangers moet een object zijn' };
    for (const d of DOELGROEPEN) {
      if (vlag[d] === undefined) continue;
      if (typeof vlag[d] !== 'boolean') return { ok: false, fout: `ontvangers.${d} moet true of false zijn` };
      keuze[d] = vlag[d];
    }
  }
  const adressen = {};
  const ruw = body?.adressen;
  if (ruw !== undefined && ruw !== null) {
    if (!isObject(ruw)) return { ok: false, fout: 'adressen moet een object zijn' };
    for (const d of ['klant', 'installateur']) {
      if (ruw[d] === undefined || ruw[d] === null) continue;
      if (typeof ruw[d] !== 'string') return { ok: false, fout: `Ongeldig e-mailadres voor ${d}` };
      const adres = ruw[d].trim();
      if (!adres) continue; // leeg: het Zoho-adres blijft gelden en het veld wordt niet gewist
      if (!isGeldigAdres(adres)) return { ok: false, fout: `Ongeldig e-mailadres voor ${d}` };
      adressen[d] = adres;
    }
  }
  return { ok: true, keuze, adressen };
}

// Eerst filteren op de aangevinkte doelgroepen met een adres, dan pas ontdubbelen (hoofdletterongevoelig): een uitgevinkt contact met
// hetzelfde adres als de klant mag de klantmail niet opslokken. `zoho`: { contact, klant, installateur } (adressen uit het ticket).
// -> { ontvangers: [{ doelgroep, email }], cf: { cf_e_mail_eindklant?, cf_e_mail_installateur? } } (cf: enkel wat echt wijzigt).
export function bepaalOntvangers({ zoho, keuze, adressen }) {
  const effectief = {
    contact: zoho.contact || '',
    klant: adressen.klant || zoho.klant || '',
    installateur: adressen.installateur || zoho.installateur || '',
  };
  const gezien = new Set();
  const ontvangers = DOELGROEPEN
    .filter(d => keuze[d] && effectief[d])
    .map(d => ({ doelgroep: d, email: effectief[d] }))
    .filter(o => {
      const sleutel = o.email.toLowerCase();
      if (gezien.has(sleutel)) return false;
      gezien.add(sleutel);
      return true;
    });
  const cf = {};
  for (const d of ['klant', 'installateur']) {
    if (adressen[d] && adressen[d].toLowerCase() !== (zoho[d] || '').toLowerCase()) cf[CF_VELD[d]] = adressen[d];
  }
  return { ontvangers, cf };
}
