// kern/themas-cache.js — de themacache in localStorage (puur: geen DOM, geen window; de opslag wordt meegegeven).
// Twee sleutels:
//   blitz_themas        { index: { versie, themas: [rij…] }, pakketten: { [id]: pakket } }  — het laatst gekende antwoord van /api/themas
//   blitz_thema_actief  { id, tot, kleuren: { donker, licht }, voorkeurThema }               — het kleine record waarmee de eerste
//                                                                                              schermopbouw (voor de modules) het actieve thema kent
// Niets uit de opslag wordt vertrouwd: `leesCache` valideert elk pakket opnieuw (`valideerPakket`) en elke indexregel (periode,
// override) en laat weg wat niet klopt. Geen enkele functie hier gooit naar de aanroeper: een opslag die ontbreekt, vol is of gooit
// geeft null of false.
import { actiefThema, belgischeDag, effectievePeriode, periodeVoorJaar } from './themapakket.js';
import { valideerPakket, valideerPeriode } from './themapakket-validatie.js';

export const CACHE_SLEUTEL = 'blitz_themas';
export const ACTIEF_SLEUTEL = 'blitz_thema_actief';
export const MAX_CACHE_BYTES = 1572864; // 1,5 MB: ruim onder de grens van localStorage (rond 5 MB) en naast de andere sleutels

const ID = /^[a-z0-9-]{2,30}$/;
const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const bytes = (tekst) => new TextEncoder().encode(tekst).length;

// Een indexregel zoals ze uit de opslag of van de server komt, opgeschoond tot de bekende velden; null als ze niet deugt
// (geen id, ongeldige periode of override). Een kapotte regel breekt de lijst dus nooit: `actiefThema` ziet enkel geldige periodes.
export function schoonIndexRij(rij) {
  if (!isObject(rij) || typeof rij.id !== 'string' || !ID.test(rij.id)) return null;
  const periode = valideerPeriode(rij.periode);
  if (!periode.ok) return null;
  let override = null;
  if (rij.periodeOverride !== null && rij.periodeOverride !== undefined) {
    const o = valideerPeriode(rij.periodeOverride);
    if (!o.ok) return null;
    override = o.periode;
  }
  return {
    id: rij.id,
    naam: typeof rij.naam === 'string' ? rij.naam : rij.id,
    aan: rij.aan !== false,
    periode: periode.periode,
    periodeOverride: override,
    pakketHash: typeof rij.pakketHash === 'string' ? rij.pakketHash : '',
  };
}

// De index opgeschoond: { versie, themas } met enkel geldige regels (zonder dubbele id's).
export function schoonIndex(index) {
  if (!isObject(index) || !Array.isArray(index.themas)) return null;
  const gezien = new Set();
  const themas = [];
  for (const r of index.themas) {
    const s = schoonIndexRij(r);
    if (s && !gezien.has(s.id)) { gezien.add(s.id); themas.push(s); }
  }
  return { versie: Number.isFinite(index.versie) ? index.versie : 0, themas };
}

// Een pakket dat onder `sleutel` staat, gevalideerd; null als het niet deugt of niet bij zijn sleutel hoort.
export function schoonPakket(sleutel, pakket) {
  if (!isObject(pakket) || pakket.id !== sleutel) return null;
  const r = valideerPakket(pakket);
  return r.ok ? r.pakket : null;
}

// De cache uit de opslag: { index, pakketten } of null (geen sleutel, kapotte JSON, geen opslag). Ongeldige pakketten worden weggelaten.
export function leesCache(opslag) {
  try {
    const ruw = opslag?.getItem(CACHE_SLEUTEL);
    if (typeof ruw !== 'string' || ruw === '') return null;
    const inhoud = JSON.parse(ruw);
    if (!isObject(inhoud) || !isObject(inhoud.pakketten)) return null;
    const index = schoonIndex(inhoud.index);
    if (!index) return null;
    const pakketten = {};
    for (const sleutel of Object.keys(inhoud.pakketten)) {
      const p = schoonPakket(sleutel, inhoud.pakketten[sleutel]);
      if (p) pakketten[sleutel] = p;
    }
    return { index, pakketten };
  } catch {
    return null;
  }
}

// Bewaart de cache. Past ze niet in MAX_CACHE_BYTES, dan blijft enkel het pakket van het thema dat op `datum` actief is.
// Geeft true als er geschreven werd, false bij een opslagfout (vol, geen toegang) of als er niets te bewaren valt.
export function bewaarCache(opslag, { index, pakketten }, { datum = new Date() } = {}) {
  try {
    if (!opslag || !isObject(index)) return false;
    let tekst = JSON.stringify({ index, pakketten: pakketten || {} });
    if (bytes(tekst) > MAX_CACHE_BYTES) {
      const actief = actiefThema(datum, schoonIndex(index)?.themas || []);
      const enkelActief = {};
      if (actief && pakketten && Object.hasOwn(pakketten, actief.id)) enkelActief[actief.id] = pakketten[actief.id];
      tekst = JSON.stringify({ index, pakketten: enkelActief });
      if (bytes(tekst) > MAX_CACHE_BYTES) return false;
    }
    opslag.setItem(CACHE_SLEUTEL, tekst);
    return true;
  } catch {
    return false;
  }
}

const dagTekst = (datum) => {
  const { jaar, maand, dag } = belgischeDag(datum);
  return `${jaar}-${String(maand).padStart(2, '0')}-${String(dag).padStart(2, '0')}`;
};

// De laatste dag (YYYY-MM-DD) van de uitvoering van de periode die `dag` omvat. Een periode over de jaarwissel kan ook van vorig jaar zijn.
function eindeVanUitvoering(periode, dag) {
  const jaar = Number(dag.slice(0, 4));
  for (const j of [jaar, jaar - 1]) {
    const u = periodeVoorJaar(periode, j);
    if (u.start <= dag && dag <= u.einde) return u.einde;
  }
  return null;
}

// Het record voor de eerste schermopbouw: het thema dat op `datum` actief is, met zijn kleuren. Ontbrekende sleutels in `licht`
// vallen terug op dezelfde sleutel van `donker` (dezelfde regel als de renderer). null als er geen actief thema is of het
// pakket ontbreekt.
export function actiefRecord(index, pakketten, datum = new Date()) {
  try {
    const themas = Array.isArray(index?.themas) ? index.themas : [];
    const thema = actiefThema(datum, themas);
    if (!thema) return null;
    const pakket = pakketten && Object.hasOwn(pakketten, thema.id) ? pakketten[thema.id] : null;
    if (!pakket) return null;
    const tot = eindeVanUitvoering(effectievePeriode(thema), dagTekst(datum));
    if (!tot) return null;
    const donker = { ...(pakket.kleuren?.donker || {}) };
    const licht = { ...donker, ...(pakket.kleuren?.licht || {}) };
    return { id: thema.id, tot, kleuren: { donker, licht }, voorkeurThema: pakket.kleuren?.voorkeurThema ?? null };
  } catch {
    return null;
  }
}

// Bewaart het actieve record, of wist het bij null. true bij gelukt, false bij een opslagfout.
export function bewaarActiefRecord(opslag, record) {
  try {
    if (!opslag) return false;
    if (record === null || record === undefined) opslag.removeItem(ACTIEF_SLEUTEL);
    else opslag.setItem(ACTIEF_SLEUTEL, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}
