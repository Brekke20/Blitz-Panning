// Onderdelen van het performance-dashboard: top 10, waarde en verbruik per maand/technieker/type.
// Pure functies op genormaliseerde Rapport[] (geen I/O). Waarde = aantal x prijs zoals in het rapport.
const MAX_TOP = 10;

const cent = n => Math.round(n * 100) / 100;
const groepSleutel = o => String(o.sleutel || o.naam || '').trim().toLowerCase().replace(/\s+/g, ' ');
const regelWaarde = o => (o.aantal || 0) * (o.prijs || 0);

// Som over alle onderdeelregels: waarde, totaal aantal en het aantal regels zonder bekende prijs.
export function waardeTotaal(rapporten) {
  let waarde = 0, aantal = 0, zonderPrijs = 0;
  for (const r of rapporten) {
    for (const o of r.onderdelen || []) {
      waarde += regelWaarde(o);
      aantal += o.aantal || 0;
      if (o.prijsBron === 'geen') zonderPrijs++;
    }
  }
  return { waarde: cent(waarde), aantal, zonderPrijs };
}

function top10(rapporten) {
  const groepen = new Map();
  for (const r of rapporten) {
    for (const o of r.onderdelen || []) {
      const sleutel = groepSleutel(o);
      if (!sleutel) continue;
      const g = groepen.get(sleutel) || { sleutel, namen: new Map(), aantal: 0, waarde: 0, rapportIds: new Set() };
      g.namen.set(o.naam, (g.namen.get(o.naam) || 0) + 1);
      g.aantal += o.aantal || 0;
      g.waarde += regelWaarde(o);
      g.rapportIds.add(r.id);
      groepen.set(sleutel, g);
    }
  }
  return [...groepen.values()]
    .map(g => ({
      sleutel: g.sleutel,
      naam: [...g.namen].sort((a, b) => b[1] - a[1])[0][0], // meest voorkomende naam (stabiel: eerste bij gelijkstand)
      aantal: g.aantal, waarde: cent(g.waarde), rapporten: g.rapportIds.size,
    }))
    .sort((a, b) => b.aantal - a.aantal || b.waarde - a.waarde)
    .slice(0, MAX_TOP);
}

// Alle maanden ('YYYY-MM') van de eerste tot de laatste, ook de lege.
function maandenTussen(eerste, laatste) {
  const uit = [];
  let [j, m] = eerste.split('-').map(Number);
  const [lj, lm] = laatste.split('-').map(Number);
  while (j < lj || (j === lj && m <= lm)) {
    uit.push(`${j}-${String(m).padStart(2, '0')}`);
    if (++m > 12) { m = 1; j++; }
  }
  return uit;
}

function perMaand(rapporten) {
  const datums = rapporten.map(r => r.datum.slice(0, 7)).sort();
  if (!datums.length) return { maanden: [], perTechnieker: {}, perType: {}, totaal: {} };
  const maanden = maandenTussen(datums[0], datums[datums.length - 1]);
  const leeg = () => Object.fromEntries(maanden.map(m => [m, { aantal: 0, waarde: 0 }]));
  const uit = { maanden, perTechnieker: Object.create(null), perType: Object.create(null), totaal: leeg() };
  const tel = (cel, o) => { cel.aantal += o.aantal || 0; cel.waarde = cent(cel.waarde + regelWaarde(o)); };
  for (const r of rapporten) {
    const maand = r.datum.slice(0, 7);
    const technieker = r.technieker || 'Onbekend';
    for (const o of r.onderdelen || []) {
      uit.perTechnieker[technieker] = uit.perTechnieker[technieker] || leeg();
      uit.perType[r.type] = uit.perType[r.type] || leeg();
      tel(uit.perTechnieker[technieker][maand], o);
      tel(uit.perType[r.type][maand], o);
      tel(uit.totaal[maand], o);
    }
  }
  // Terug naar gewone objecten (eigen sleutel `__proto__` blijft veilig).
  return { ...uit, perTechnieker: Object.fromEntries(Object.entries(uit.perTechnieker)), perType: Object.fromEntries(Object.entries(uit.perType)) };
}

export function berekenOnderdelen(rapporten) {
  return {
    top10: top10(rapporten),
    perMaand: perMaand(rapporten),
    dekking: {
      rapporten: rapporten.length,
      metOnderdelen: rapporten.filter(r => (r.onderdelen || []).length > 0).length,
      zonderPrijs: waardeTotaal(rapporten).zonderPrijs,
    },
  };
}
