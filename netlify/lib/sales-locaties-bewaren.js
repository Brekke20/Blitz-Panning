// Sales-planner (server): locaties van leads bepalen en bewaren. Het netwerk (geocoding) draait BUITEN het slot:
// eerst lezen (zonder slot), dan `vulLocatiesAan`, daarna een gerichte tweede `muteerSales` (zonder versiecontrole) die per
// lead enkel de locatie-velden zet, en alleen als die lead sindsdien niet is aangepast. Een tussentijdse wijziging wint.
import { leesSales, muteerSales } from './sales-opslag.js';
import { vulLocatiesAan } from './sales-locatie.js';
import { isPostcode } from './sales-postcode.js';

const ADRESVELDEN = ['straat', 'huisnr', 'postcode', 'adresTekst'];
const ZELFDE_ADRES = (a, b) => ADRESVELDEN.every(v => (a?.[v] ?? null) === (b?.[v] ?? null));
const ZELFDE_LOCATIE = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const SERVERVELDEN = ['adresTeGeocoderen', 'adresPogingen'];

export const telOpen = leads => leads.filter(l => isPostcode(l?.postcode) && (!l.locatie || l.adresTeGeocoderen === true)).length;

/**
 * Bepaalt de locaties van leads zonder locatie (en werkt leads bij met een openstaande adres-upgrade) en bewaart ze.
 * -> { status:'ok', data, open } | { status:'storing' }
 * Per lead wordt enkel `locatie`, een lege `gemeente` en de server-velden adresTeGeocoderen/adresPogingen gezet, en enkel
 * als de lead sinds het lezen niet veranderde (zelfde adres en nog dezelfde locatie). Geen enkele andere wijziging.
 */
export async function bewaarLocaties({ store, doelId, nu, deps = {}, maxTijdMs = 15000 }) {
  let gelezen;
  try { gelezen = await leesSales(store, doelId); } catch { return { status: 'storing' }; }

  let aangevuld = null;
  try {
    aangevuld = (await vulLocatiesAan(gelezen.leads, { store, nu, maxTijdMs, ...deps })).leads;
  } catch {
    // Geocoding mislukt onverwacht: de leads blijven zonder locatie (open) en een volgende ronde probeert het opnieuw.
    console.warn('[sales] locaties bepalen mislukt');
  }
  if (!aangevuld) return { status: 'ok', data: gelezen, open: telOpen(gelezen.leads) };

  const snapshot = new Map(gelezen.leads.map(l => [l.id, l]));
  const resultaat = new Map(aangevuld.map(l => [l.id, l]));
  const pas = lead => {
    const toen = snapshot.get(lead.id);
    const nieuw = resultaat.get(lead.id);
    if (!toen || !nieuw || nieuw === toen) return null;
    if (!ZELFDE_ADRES(lead, toen) || !ZELFDE_LOCATIE(lead.locatie, toen.locatie)) return null; // tussentijds aangepast
    const kopie = { ...lead };
    let gewijzigd = false;
    if (!ZELFDE_LOCATIE(nieuw.locatie, lead.locatie)) { kopie.locatie = nieuw.locatie; gewijzigd = true; }
    if ((kopie.gemeente == null || String(kopie.gemeente).trim() === '') && nieuw.gemeente) { kopie.gemeente = nieuw.gemeente; gewijzigd = true; }
    for (const v of SERVERVELDEN) {
      if (nieuw[v] === undefined) { if (v in kopie) { delete kopie[v]; gewijzigd = true; } }
      else if (kopie[v] !== nieuw[v]) { kopie[v] = nieuw[v]; gewijzigd = true; }
    }
    return gewijzigd ? kopie : null;
  };

  const uitkomst = await muteerSales(store, doelId, {
    wijzig: data => {
      let iets = false;
      const leads = data.leads.map(l => {
        const k = pas(l);
        if (k) iets = true;
        return k ?? l;
      });
      return iets ? { data: { ...data, leads } } : null;
    },
  });
  if (uitkomst.status === 'storing') return { status: 'storing' };
  if (uitkomst.status === 'ok' || uitkomst.status === 'ongewijzigd') {
    return { status: 'ok', data: uitkomst.data, open: telOpen(uitkomst.data.leads) };
  }
  return { status: 'storing' }; // conflict/ongeldig kunnen zonder verwachteVersie en fouten niet voorkomen
}
