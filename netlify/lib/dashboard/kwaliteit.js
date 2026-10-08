// Kwaliteit van het performance-dashboard: first-time-fix, herhaalbezoeken en top-oorzaken.
// Pure functies op genormaliseerde Rapport[] (geen I/O).
import { dagenTussen, normaliseerAdres, pct } from './gemeenschappelijk.js';

const MAX_HERHAAL_LIJST = 200;
const MAX_OORZAKEN = 8;

const isInterventie = r => r.interventieType === 'Interventie';
const isFtf = r => r.hersteld === true && r.nieuwInter === false;

// Enkel interventies: hersteld zonder nieuwe interventie.
export function firstTimeFix(rapporten) {
  const interventies = rapporten.filter(isInterventie);
  const ftf = interventies.filter(isFtf).length;
  return { n: interventies.length, ftf, pct: pct(ftf, interventies.length) };
}

// Zoeksleutel van een rapport: serienummer eerst, anders het genormaliseerde adres; '' = geen sleutel.
function herhaalSleutel(r) {
  if (r.serienummer) return `serie:${r.serienummer}`;
  const adres = normaliseerAdres(r.adres);
  return adres ? `adres:${adres}` : '';
}

// Herhaalbezoeken: een geselecteerde interventie B met een eerdere interventie A (1 t/m `dagen` dagen
// eerder) op hetzelfde serienummer, of bij ontbrekend serienummer hetzelfde adres. `alle` = de volledige
// lijst (A mag buiten de periode liggen). Zelfde datum en dubbele entries tellen nooit als herhaal.
export function herhaalbezoeken(alle, geselecteerd, dagen) {
  const perSleutel = new Map();
  for (const a of alle) {
    if (!isInterventie(a)) continue;
    const sleutel = herhaalSleutel(a);
    if (!sleutel) continue;
    if (!perSleutel.has(sleutel)) perSleutel.set(sleutel, []);
    perSleutel.get(sleutel).push(a);
  }
  const uit = [];
  for (const b of geselecteerd) {
    if (!isInterventie(b)) continue;
    const sleutel = herhaalSleutel(b);
    if (!sleutel) continue;
    let vorige = null, vorigeDagen = 0;
    for (const a of perSleutel.get(sleutel) || []) {
      if (a.id === b.id) continue;
      const d = dagenTussen(a.datum, b.datum);
      if (d < 1 || d > dagen) continue;
      if (vorige === null || d < vorigeDagen) { vorige = a; vorigeDagen = d; } // meest recente eerdere bezoek
    }
    if (!vorige) continue;
    uit.push({
      id: b.id, ticketNumber: b.ticketNumber, datum: b.datum, vorigeId: vorige.id, vorigeDatum: vorige.datum,
      dagen: vorigeDagen, technieker: b.technieker, klant: b.klant, sleutel,
    });
  }
  return uit.sort((x, y) => y.datum.localeCompare(x.datum) || x.id.localeCompare(y.id));
}

// First-time-fix per groep (technieker of type), aflopend op n.
function ftfPer(interventies, sleutelVan) {
  const groepen = new Map();
  for (const r of interventies) {
    const sleutel = sleutelVan(r) || 'Onbekend';
    const g = groepen.get(sleutel) || { sleutel, label: sleutel, n: 0, ftf: 0 };
    g.n++;
    if (isFtf(r)) g.ftf++;
    groepen.set(sleutel, g);
  }
  return [...groepen.values()].map(g => ({ ...g, pct: pct(g.ftf, g.n) })).sort((a, b) => b.n - a.n);
}

function topOorzaken(rapporten) {
  const groepen = new Map();
  for (const r of rapporten) {
    for (const oorzaak of new Set(r.oorzaken)) {
      const g = groepen.get(oorzaak) || { oorzaak, n: 0, perType: {} };
      g.n++;
      g.perType[r.type] = (g.perType[r.type] || 0) + 1;
      groepen.set(oorzaak, g);
    }
  }
  return [...groepen.values()].sort((a, b) => b.n - a.n).slice(0, MAX_OORZAKEN);
}

export function berekenKwaliteit({ rapporten, alle = rapporten, herhaalDagen = 30 }) {
  const interventies = rapporten.filter(isInterventie);
  const herhaal = herhaalbezoeken(alle, rapporten, herhaalDagen);
  return {
    ftfTotaal: firstTimeFix(rapporten),
    ftfPerTechnieker: ftfPer(interventies, r => r.technieker),
    ftfPerType: ftfPer(interventies, r => r.type),
    herhaal: { dagen: herhaalDagen, aantal: herhaal.length, lijst: herhaal.slice(0, MAX_HERHAAL_LIJST) },
    topOorzaken: topOorzaken(rapporten),
    dekking: { interventies: interventies.length, herhaalZonderSleutel: interventies.filter(r => !herhaalSleutel(r)).length },
  };
}
