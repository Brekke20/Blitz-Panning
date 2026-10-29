// Factureerbaar bedrag van het performance-dashboard: onderdelen + loon van de gekozen periode, met dezelfde regels als de
// "Factureerbaar"-regel per rapport in het rapportarchief (public/js/rapport-archief.js). Pure functie op genormaliseerde
// Rapport[] (geen I/O); de loonprijs komt uit berekenLoonkost (gedeeld met wizard, archief en dashboard), geen eigen tarieven.
//   - Onderdelen: aantal x prijs, zonder regels die in het rapport als "niet aangerekend" staan (factureren:false).
//   - Loon: enkel met een bruikbare werktijd; niet bij garantie en niet bij een installatie (die uren staan apart als "niet aangerekend").
//   - Uren (in minuten): werktijd + aanrijtijd, dezelfde basis als het loon.
import { berekenLoonkost } from '../../../public/js/kern/loonkost.js';

const cent = n => Math.round(n * 100) / 100;

export function berekenFactureerbaar(rapporten) {
  let onderdelen = 0, loon = 0, minuten = 0, zonderPrijs = 0, nietAangerekendeOnderdelen = 0, zonderWerktijd = 0;
  const nietAangerekend = { minuten: 0, rapporten: 0 };
  for (const r of rapporten) {
    for (const o of r.onderdelen || []) {
      if (o.factureren === false) { nietAangerekendeOnderdelen++; continue; }
      onderdelen += (o.aantal || 0) * (o.prijs || 0);
      if (o.prijsBron === 'geen') zonderPrijs++;
    }
    const aangerekend = r.servicetype !== 'garantie' && r.interventieType !== 'Installatie';
    if (typeof r.werktijdMin !== 'number') { if (aangerekend) zonderWerktijd++; continue; }
    const lonen = berekenLoonkost(r.servicetype, r.werktijdMin, r.aanrijtijdMin ?? 0);
    if (aangerekend) { loon += lonen.bruto; minuten += lonen.totMin; }
    else { nietAangerekend.minuten += lonen.totMin; nietAangerekend.rapporten++; }
  }
  return {
    onderdelen: cent(onderdelen), loon, totaal: cent(onderdelen + loon), minuten, nietAangerekend,
    dekking: { rapporten: rapporten.length, zonderPrijs, zonderWerktijd, nietAangerekendeOnderdelen },
  };
}
