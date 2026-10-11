// Sales in het performance-dashboard: bezoeken per verkoper per week, resultaten en leads die wachten.
// Pure functies op `sales/<id>`-blobs (geen I/O). Er komen enkel tellingen uit, nooit gegevens van een lead;
// verkopersnamen blijven ruwe tekst (escaping gebeurt in de client).
import { datumInBrussel } from '../bevestigingslink.js';
import { gemiddelde, inPeriode, pct, weekStart } from './gemeenschappelijk.js';

// Vaste volgorde = categorische kleurslots 1 t/m 4.
export const SALES_RESULTATEN = ['offerte', 'verkocht', 'geen-interesse', 'opnieuw'];

const DAG_MS = 86400000;
const DATUM_RE = /^\d{4}-\d{2}-\d{2}$/;
const platteObject = m => Object.fromEntries(Object.entries(m)); // null-prototype -> gewoon object (eigen sleutel `__proto__` blijft veilig)
const WACHT_BUCKETS = [
  { label: '<7d', tot: 7 }, { label: '7–14d', tot: 14 }, { label: '14–30d', tot: 30 }, { label: '>30d', tot: Infinity },
];

// Leeg of ongeldig tijdstip -> null (new Date(null) zou 1970 zijn).
const ms = iso => { if (iso == null || iso === '') return null; const t = new Date(iso).getTime(); return Number.isNaN(t) ? null : t; };

// Staat het slotresultaat al als bezoek in `bezoeken`? Zelfde resultaat en (zelfde Brusselse dag, of
// binnen 5 minuten, of identieke `op`); niet afhankelijk van byte-identieke tijdstippen.
function alGeteld(bezoeken, soort, op) {
  const dag = datumInBrussel(op), opMs = ms(op);
  return bezoeken.some(b => {
    if (!b || (b.resultaat !== soort)) return false;
    if (b.op && b.op === op) return true;
    const bMs = ms(b.op);
    if (bMs !== null && opMs !== null && Math.abs(bMs - opMs) <= 5 * 60000) return true;
    return dag !== null && (b.datum === dag || datumInBrussel(b.op) === dag);
  });
}

// Alle bezoeken van een lead: `bezoeken[]` plus het slotresultaat `lead.resultaat` als dat niet al
// (zelfde `op`) in `bezoeken` staat. Onbekende resultaten vallen weg.
export function bezoekenVanLead(lead) {
  const uit = [];
  const voeg = (datum, resultaat, op) => {
    if (!SALES_RESULTATEN.includes(resultaat)) return;
    const d = DATUM_RE.test(datum || '') ? datum : datumInBrussel(op);
    if (d) uit.push({ datum: d, resultaat, op: op ?? null });
  };
  const bezoeken = Array.isArray(lead?.bezoeken) ? lead.bezoeken : [];
  for (const b of bezoeken) voeg(b?.datum, b?.resultaat, b?.op);
  const slot = lead?.resultaat;
  const soort = slot?.soort ?? slot?.resultaat;
  if (slot && typeof slot === 'object' && !alGeteld(bezoeken, soort, slot.op)) voeg(null, soort, slot.op);
  return uit;
}

// Maandagen van de eerste tot de laatste week van de periode (ook lege weken).
function weken(van, tot) {
  const uit = [];
  for (let w = weekStart(van); w <= tot; w = datumPlus(w, 7)) uit.push(w);
  return uit;
}
function datumPlus(datum, dagen) {
  const [j, m, d] = datum.split('-').map(Number);
  return new Date(Date.UTC(j, m - 1, d) + dagen * DAG_MS).toISOString().slice(0, 10);
}

function wachtend(blobs, nu) {
  const nuMs = ms(nu ?? new Date().toISOString());
  const dagenLijst = [];
  let zonderDatum = 0; // te-plannen leads zonder enig tijdstip: tellen in n, niet in de wachttijden
  const perVerkoper = new Map();
  for (const { verkoper, leads } of blobs) {
    for (const lead of leads) {
      if (lead?.status !== 'te-plannen') continue;
      // Wacht sinds het laatste moment van contact: import of laatste bezoek.
      const sinds = Math.max(...[ms(lead.geimporteerdOp), ...bezoekenVanLead(lead).map(b => ms(b.op))].filter(t => t !== null), -Infinity);
      perVerkoper.set(verkoper, (perVerkoper.get(verkoper) || 0) + 1);
      if (!Number.isFinite(sinds) || nuMs === null) { zonderDatum++; continue; }
      dagenLijst.push(Math.max(0, Math.floor((nuMs - sinds) / DAG_MS)));
    }
  }
  const buckets = WACHT_BUCKETS.map(b => ({ label: b.label, n: 0 }));
  for (const d of dagenLijst) buckets[WACHT_BUCKETS.findIndex(b => d < b.tot)].n++;
  const gem = gemiddelde(dagenLijst);
  return {
    n: dagenLijst.length + zonderDatum,
    zonderDatum,
    gemDagen: gem === null ? 0 : Math.round(gem * 10) / 10,
    oudsteDagen: dagenLijst.length ? Math.max(...dagenLijst) : 0,
    buckets,
    perVerkoper: [...perVerkoper].map(([verkoper, n]) => ({ verkoper, n })).sort((a, b) => b.n - a.n),
  };
}

export function berekenSales({ salesBlobs, van, tot, nu }) {
  // Blobs met dezelfde verkoper samenvoegen (volgorde van eerste voorkomen).
  const perNaam = new Map();
  for (const b of salesBlobs || []) {
    const leads = Array.isArray(b?.leads) ? b.leads : [];
    perNaam.set(b.verkoper, [...(perNaam.get(b.verkoper) || []), ...leads]);
  }
  const blobs = [...perNaam].map(([verkoper, leads]) => ({ verkoper, leads }));

  const waarden = Object.create(null), soorten = Object.fromEntries(SALES_RESULTATEN.map(s => [s, 0]));
  const verkopers = [];
  let totaal = 0;
  for (const { verkoper, leads } of blobs) {
    for (const lead of leads) {
      for (const b of bezoekenVanLead(lead)) {
        if (!inPeriode(b.datum, van, tot)) continue;
        totaal++;
        soorten[b.resultaat]++;
        if (!verkopers.includes(verkoper)) verkopers.push(verkoper);
        const week = weekStart(b.datum);
        waarden[verkoper] = waarden[verkoper] || Object.create(null);
        waarden[verkoper][week] = (waarden[verkoper][week] || 0) + 1;
      }
    }
  }
  return {
    perWeek: { weken: totaal ? weken(van, tot) : [], verkopers, waarden: platteObject(Object.fromEntries(Object.entries(waarden).map(([v, w]) => [v, platteObject(w)]))) },
    resultaten: {
      totaal,
      perSoort: SALES_RESULTATEN.map(soort => ({ soort, n: soorten[soort], pct: totaal ? pct(soorten[soort], totaal) : 0 })),
    },
    wachtend: wachtend(blobs, nu),
    dekking: { verkopers: blobs.length, bezoeken: totaal },
  };
}
