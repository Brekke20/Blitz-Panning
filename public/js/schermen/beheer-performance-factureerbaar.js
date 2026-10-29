// schermen/beheer-performance-factureerbaar.js — blok "Factureerbaar": het te factureren bedrag van de gekozen periode
// (onderdelen + loon), met de uren waarop het loon rust en wat niet aangerekend wordt. Zuivere stringbouwer:
// renderFactureerbaar(data, ctx) -> html. De server rekent (netlify/lib/dashboard/factureerbaar.js); hier enkel tonen.
import { formatDuur, formatEuro } from './beheer-performance-logica.js';
import { blok, kaart, feiten } from './beheer-performance-blokhulp.js';

const isGetal = x => typeof x === 'number' && Number.isFinite(x);
const getal = x => (isGetal(x) ? x : 0);
const meervoud = (n, een, meer) => `${n} ${n === 1 ? een : meer}`;

export function renderFactureerbaar(data) {
  const f = data?.factureerbaar;
  if (!f || !(getal(f.dekking?.rapporten) > 0)) return blok('factureerbaar', 'Factureerbaar', []);
  const d = f.dekking ?? {};
  const regels = [
    ['Totaal', formatEuro(f.totaal)],
    ['Onderdelen', formatEuro(f.onderdelen)],
    ['Loon', `${formatEuro(f.loon)} · ${formatDuur(getal(f.minuten))} werk- en rijtijd`],
  ];
  const nietAangerekend = f.nietAangerekend ?? {};
  if (getal(nietAangerekend.rapporten) > 0) {
    regels.push(['Niet aangerekend (garantie of installatie)', `${formatDuur(getal(nietAangerekend.minuten))} in ${meervoud(nietAangerekend.rapporten, 'rapport', 'rapporten')}`]);
  }
  const hints = [];
  if (getal(d.zonderPrijs) > 0) hints.push(`${meervoud(d.zonderPrijs, 'onderdeel', 'onderdelen')} zonder prijs tellen voor € 0 mee.`);
  if (getal(d.zonderWerktijd) > 0) hints.push(`${meervoud(d.zonderWerktijd, 'rapport', 'rapporten')} zonder start- en stoptijd: daarvoor is geen loon geteld.`);
  if (getal(d.nietAangerekendeOnderdelen) > 0) hints.push(`${meervoud(d.nietAangerekendeOnderdelen, 'onderdeel', 'onderdelen')} als "niet aangerekend" gemarkeerd: niet meegeteld.`);
  const uitleg = `Onderdelen en loon van de gekozen periode, excl. btw, volgens de regels van het rapportarchief. Bij garantie en installatie telt het loon niet mee.${hints.length ? ` ${hints.join(' ')}` : ''}`;
  return blok('factureerbaar', 'Factureerbaar', [kaart('Factureerbaar bedrag', feiten(regels), { uitleg })]);
}
