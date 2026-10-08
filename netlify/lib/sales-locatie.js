// Sales-planner: de locatie van een lead bepalen. Volledig adres -> TomTom-geocoding ('adres'); mislukt dat of is er
// enkel een postcode, dan het postcode-middelpunt ('postcode'). Zonder postcode: geen locatie.
import { geocodeAdres } from './sales-geocode.js';
import { zoekPostcode, zoekPostcodes, isPostcode } from './sales-postcode.js';
import { adresTekstVoorGeocoding } from '../../public/js/sales/adres.js';

/** -> { lat, lon, bron: 'adres' | 'postcode' } | null. Muteert de lead niet. */
export async function bepaalLocatie(lead, { store, ...deps } = {}) {
  const tekst = adresTekstVoorGeocoding(lead);
  if (tekst) {
    const p = await geocodeAdres(tekst, deps);
    if (p) return { lat: p.lat, lon: p.lon, bron: 'adres' };
  }
  if (isPostcode(lead?.postcode)) {
    const p = await zoekPostcode(store, lead.postcode, deps);
    if (p) return { lat: p.lat, lon: p.lon, bron: 'postcode' };
  }
  return null;
}

const zonderVlag = l => { const { adresTeGeocoderen: _weg, ...rest } = l; return rest; };

/**
 * Vult de locatie (en een lege gemeente) aan voor leads met een postcode maar zonder locatie, en werkt leads bij die
 * eerder enkel een postcode-locatie kregen omdat het tijdsbudget hun adresgeocoding oversloeg (`adresTeGeocoderen: true`).
 * Volgorde (één tijdsbudget `maxTijdMs`, standaard 15 s): eerst de postcode-middelpunten (weinig unieke postcodes, cache,
 * één schrijfactie) zodat elke lead meteen plannbaar is, daarna de adresgeocoding binnen het resterende budget.
 * - Volledig adres, geocoding lukt: locatie bron 'adres', vlag weg.
 * - Volledig adres, geocoding mislukt (geen resultaat): postcode-middelpunt blijft, vlag weg (definitief, geen eindeloze pogingen).
 * - Volledig adres, geocoding door het budget overgeslagen: postcode-middelpunt PLUS vlag `adresTeGeocoderen: true`;
 *   een latere run probeert het adres opnieuw.
 * `open` telt leads zonder locatie en leads met een nog openstaande adres-upgrade (vlag). De invoer wordt niet gemuteerd.
 * -> { leads, open: number }
 */
export async function vulLocatiesAan(leads, { store, nu, maxTijdMs = 15000, parallel = 5, ...deps } = {}) {
  const lijst = Array.isArray(leads) ? leads : [];
  const klok = typeof nu === 'function' ? () => Number(new Date(nu())) : (nu != null ? () => Number(new Date(nu)) : () => Date.now());
  const start = klok();
  const resultaat = lijst.slice();
  const metVlag = l => l?.adresTeGeocoderen === true && !!l.locatie;
  const doel = lijst.map((l, i) => i).filter(i => isPostcode(lijst[i]?.postcode) && (!lijst[i].locatie || metVlag(lijst[i])));

  // Fase 1: postcode-middelpunten voor leads zonder locatie.
  const naarPostcode = doel.filter(i => !lijst[i].locatie);
  if (naarPostcode.length) {
    const { gevonden } = await zoekPostcodes(store, naarPostcode.map(i => lijst[i].postcode), { nu, maxTijdMs, parallel, ...deps });
    for (const i of naarPostcode) {
      const p = gevonden[lijst[i].postcode];
      if (!p) continue;
      resultaat[i] = {
        ...lijst[i],
        locatie: { lat: p.lat, lon: p.lon, bron: 'postcode' },
        ...(!lijst[i].gemeente && p.gemeente ? { gemeente: p.gemeente } : {}),
      };
    }
  }

  // Fase 2: adresgeocoding (parallel, binnen het resterende budget) voor volledige adressen.
  const metAdres = [];
  for (const i of doel) {
    if (adresTekstVoorGeocoding(lijst[i])) metAdres.push(i);
    else if (resultaat[i].adresTeGeocoderen !== undefined) resultaat[i] = zonderVlag(resultaat[i]); // adres gewijzigd: niets meer te upgraden
  }
  let volgende = 0;
  const werker = async () => {
    while (volgende < metAdres.length) {
      if (klok() - start >= maxTijdMs) return; // niet aan toe gekomen
      const i = metAdres[volgende++];
      const p = await geocodeAdres(adresTekstVoorGeocoding(lijst[i]), deps);
      if (p) resultaat[i] = { ...zonderVlag(resultaat[i]), locatie: { lat: p.lat, lon: p.lon, bron: 'adres' } };
      else resultaat[i] = zonderVlag(resultaat[i]); // adres onvindbaar: de postcode-locatie (indien er een is) blijft
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(parallel, metAdres.length)) }, werker));
  // Overgeslagen door het budget: wie een (postcode-)locatie heeft, krijgt de vlag voor een latere upgrade.
  for (const i of metAdres.slice(volgende)) {
    if (resultaat[i].locatie) resultaat[i] = { ...resultaat[i], adresTeGeocoderen: true };
  }

  return { leads: resultaat, open: doel.filter(i => !resultaat[i].locatie || resultaat[i].adresTeGeocoderen === true).length };
}
