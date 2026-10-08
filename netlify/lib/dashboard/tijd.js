// Tijd en stiptheid van het performance-dashboard: duur per groep, op tijd (te vroeg / op tijd / te laat),
// rijtijd tegenover werktijd en interventies per dag. Pure functies op genormaliseerde Rapport[] (geen I/O).
import { gemiddelde, pct } from './gemeenschappelijk.js';

const TIJD_RE = /^(\d{1,2}):(\d{2})$/;
const afgerond = n => Math.round(n * 10) / 10;

function minuten(t) {
  const m = TIJD_RE.exec(String(t ?? '').trim());
  if (!m) return null;
  const u = +m[1], mi = +m[2];
  return u > 23 || mi > 59 ? null : u * 60 + mi;
}

const heeftDuur = r => typeof r.werktijdMin === 'number';
const naam = v => v || 'Onbekend';

// Gemiddelde duur (minuten) over interventies met een betrouwbare werktijd; null als er geen zijn.
export function gemiddeldeDuur(rapporten) {
  const g = gemiddelde(rapporten.filter(r => r.interventieType === 'Interventie' && heeftDuur(r)).map(r => r.werktijdMin));
  return g === null ? null : afgerond(g);
}

// Te vroeg / op tijd / te laat t.o.v. het geplande tijdslot (grenzen inclusief). Enkel rapporten met
// een slot én een geldige start tellen mee.
export function opTijd(rapporten) {
  const uit = { n: 0, teVroeg: 0, opTijd: 0, teLaat: 0, pct: null };
  for (const r of rapporten) {
    const van = minuten(r.geplandTijdslot?.van), tot = minuten(r.geplandTijdslot?.tot), start = minuten(r.start);
    if (van === null || tot === null || start === null) continue;
    uit.n++;
    if (start < van) uit.teVroeg++;
    else if (start <= tot) uit.opTijd++;
    else uit.teLaat++;
  }
  uit.pct = pct(uit.opTijd, uit.n);
  return uit;
}

// Gemiddelde werktijd per groep; `sleutelsVan` geeft de groepen van een rapport. Aflopend op n.
function duurPerGroep(rapporten, sleutelsVan) {
  const groepen = new Map();
  for (const r of rapporten) {
    if (!heeftDuur(r)) continue;
    for (const sleutel of new Set(sleutelsVan(r))) {
      if (!groepen.has(sleutel)) groepen.set(sleutel, []);
      groepen.get(sleutel).push(r.werktijdMin);
    }
  }
  return [...groepen].map(([sleutel, w]) => ({ sleutel, label: sleutel, n: w.length, gemMin: afgerond(gemiddelde(w)) }))
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label, 'nl'));
}

function opTijdPerTechnieker(rapporten) {
  const volgorde = [];
  for (const r of rapporten) if (!volgorde.includes(naam(r.technieker))) volgorde.push(naam(r.technieker));
  return volgorde
    .map(technieker => ({ technieker, ...opTijd(rapporten.filter(r => naam(r.technieker) === technieker)) }))
    .filter(r => r.n > 0)
    .sort((a, b) => b.n - a.n);
}

function rijtijdPerDag(rapporten) {
  const dagen = new Map();
  for (const r of rapporten) {
    const d = dagen.get(r.datum) || { datum: r.datum, aanrijtijdMin: 0, werktijdMin: 0, n: 0 };
    if (typeof r.aanrijtijdMin === 'number' && r.aanrijtijdMin > 0) d.aanrijtijdMin += r.aanrijtijdMin;
    if (heeftDuur(r)) d.werktijdMin += r.werktijdMin;
    d.n++;
    dagen.set(r.datum, d);
  }
  return [...dagen.values()].sort((a, b) => a.datum.localeCompare(b.datum));
}

// Aantal bezoeken per dag per technieker; techniekers in volgorde van eerste voorkomen (vaste kleur).
function perDagPerTechnieker(rapporten) {
  const techniekers = [], datums = new Set(), waarden = {};
  for (const r of rapporten) {
    const t = naam(r.technieker);
    if (!techniekers.includes(t)) techniekers.push(t);
    datums.add(r.datum);
    waarden[t] = waarden[t] || {};
    waarden[t][r.datum] = (waarden[t][r.datum] || 0) + 1;
  }
  return { datums: [...datums].sort(), techniekers, waarden };
}

export function berekenTijd(rapporten) {
  const totaal = opTijd(rapporten);
  return {
    duurPer: {
      laadpaal: duurPerGroep(rapporten, r => [r.type]),
      oorzaak: duurPerGroep(rapporten, r => r.oorzaken),
      technieker: duurPerGroep(rapporten, r => [naam(r.technieker)]),
      bezoektype: duurPerGroep(rapporten, r => [r.interventieType]),
    },
    opTijdPerTechnieker: opTijdPerTechnieker(rapporten),
    opTijdTotaal: totaal,
    rijtijdPerDag: rijtijdPerDag(rapporten),
    perDagPerTechnieker: perDagPerTechnieker(rapporten),
    dekking: {
      rapporten: rapporten.length,
      metDuur: rapporten.filter(heeftDuur).length,
      duurOnbetrouwbaar: rapporten.filter(r => r.werktijdOnbetrouwbaar).length,
      metSlot: totaal.n,
      zonderSlot: rapporten.length - totaal.n,
      metAanrijtijd: rapporten.filter(r => typeof r.aanrijtijdMin === 'number' && r.aanrijtijdMin > 0).length,
    },
  };
}
