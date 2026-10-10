// Sales-planner: adres ontleden (pure logica, geen DOM, geen netwerk).
// Een exportadres is een postcode ("3640"), postcode + gemeente ("3500 Hasselt"),
// een volledig adres ("Dorpsstraat 12, 3640 Kinrooi") of vrije tekst die nagekeken moet worden.

const POSTCODE = /^\d{4}$/;
const POSTCODE_GEMEENTE = /^(\d{4})\s+(.+)$/;
const VOLLEDIG = /^(.+?)\s+(\d+\s*[A-Za-z]?(?:\s*(?:bus|\/)\s*\w+)?)\s*,\s*(\d{4})\s+(.+)$/;

/** Ontleedt een adrestekst. Geeft altijd een object met `soort`: 'postcode' | 'adres' | 'nakijken'. */
export function ontleedAdres(tekst) {
  const t = (typeof tekst === 'string' ? tekst : '').trim();
  if (POSTCODE.test(t)) return { soort: 'postcode', postcode: t };
  const pg = POSTCODE_GEMEENTE.exec(t);
  if (pg) return { soort: 'postcode', postcode: pg[1], gemeente: pg[2].trim() };
  const v = VOLLEDIG.exec(t);
  if (v) {
    return { soort: 'adres', straat: v[1].trim(), huisnr: v[2].trim(), postcode: v[3], gemeente: v[4].trim() };
  }
  return { soort: 'nakijken', adresTekst: t };
}

/** 'volledig' (straat + adres-locatie), 'postcode' of 'nakijken' (vrije tekst, straat zonder adres-locatie, geen postcode). */
export function adresSoort(lead) {
  if (lead?.straat && lead.locatie?.bron === 'adres') return 'volledig';
  if (lead?.adresTekst || lead?.straat || !lead?.postcode) return 'nakijken';
  return 'postcode';
}

/** Tekst om te geocoderen, of null zonder straat, huisnummer en postcode. */
export function adresTekstVoorGeocoding(lead) {
  if (!lead?.straat || !lead.huisnr || !lead.postcode) return null;
  return `${lead.straat} ${lead.huisnr}, ${lead.postcode} ${lead.gemeente || ''}`.trim();
}

/** 'Kinrooi (3640)', '3640' of '' (zonder postcode). */
export function plaatsLabel(lead) {
  if (!lead?.postcode) return '';
  return lead.gemeente ? `${lead.gemeente} (${lead.postcode})` : String(lead.postcode);
}
