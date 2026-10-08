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

/**
 * Vult de locatie (en een lege gemeente) aan voor leads met een postcode maar zonder locatie.
 * Adresgeocoding en postcode-opzoeking delen één tijdsbudget (`maxTijdMs`, standaard 15 s); wat het budget niet haalde of
 * niet gevonden werd, blijft zonder locatie en telt mee in `open` (een latere run probeert opnieuw).
 * -> { leads, open: number }. De invoer wordt niet gemuteerd.
 */
export async function vulLocatiesAan(leads, { store, nu, maxTijdMs = 15000, parallel = 5, ...deps } = {}) {
  const lijst = Array.isArray(leads) ? leads : [];
  const klok = typeof nu === 'function' ? () => Number(new Date(nu())) : (nu != null ? () => Number(new Date(nu)) : () => Date.now());
  const start = klok();
  const resultaat = lijst.slice();
  const doel = lijst.map((l, i) => i).filter(i => isPostcode(lijst[i]?.postcode) && !lijst[i].locatie);
  const naarPostcode = []; // indexen die op het postcode-middelpunt moeten terugvallen

  // Fase A: volledige adressen (parallel, binnen het budget).
  const metAdres = doel.filter(i => adresTekstVoorGeocoding(lijst[i]));
  const zonderAdres = doel.filter(i => !adresTekstVoorGeocoding(lijst[i]));
  naarPostcode.push(...zonderAdres);
  let volgende = 0;
  const werker = async () => {
    while (volgende < metAdres.length) {
      if (klok() - start >= maxTijdMs) return; // niet aan toe gekomen: blijft open
      const i = metAdres[volgende++];
      const p = await geocodeAdres(adresTekstVoorGeocoding(lijst[i]), deps);
      if (p) resultaat[i] = { ...lijst[i], locatie: { lat: p.lat, lon: p.lon, bron: 'adres' } };
      else naarPostcode.push(i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(parallel, metAdres.length)) }, werker));

  // Fase B: postcode-middelpunten voor de rest (één schrijfactie naar de cache).
  if (naarPostcode.length) {
    const rest = Math.max(0, maxTijdMs - (klok() - start));
    const { gevonden } = await zoekPostcodes(store, naarPostcode.map(i => lijst[i].postcode), { nu, maxTijdMs: rest, parallel, ...deps });
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

  return { leads: resultaat, open: doel.filter(i => !resultaat[i].locatie).length };
}
