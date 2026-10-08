// Sales-planner: postcode -> middelpunt + gemeente, met een cache in het blob 'postcode-cache'
// ({ [postcode]: { lat, lon, gemeente } }). De cache is afleidbaar en bevat geen gebruikersdata: een mislukte
// schrijfactie wordt gelogd (enkel het fouttype) en het opgezochte resultaat wordt toch teruggegeven. Dit is de enige
// bewuste uitzondering op "fail closed". 'Niet gevonden' wordt nooit gecachet (een latere poging kan slagen).
// In testmodus (nepcoördinaten) wordt niets in de cache bewaard.
import { geocodePostcode } from './sales-geocode.js';
import { wijzigBlob } from './blob-wijzig.js';
import { maakSerieel } from './serieel.js';

export const isPostcode = pc => typeof pc === 'string' && /^\d{4}$/.test(pc);

const CACHE_KEY = 'postcode-cache';
const serieel = maakSerieel(); // alle cache-schrijfacties van deze module na elkaar

const geldigeIngang = v => Number.isFinite(v?.lat) && Number.isFinite(v?.lon);
const tijdsWaarde = w => Number(new Date(w));
// `nu`: functie die een tijdstip (Date, ms of ISO) geeft; ontbreekt die, dan de echte klok.
const maakKlok = nu => () => (typeof nu === 'function' ? tijdsWaarde(nu()) : (nu != null ? tijdsWaarde(nu) : Date.now()));

function logFout(actie, fout) {
  console.error('postcode-cache: ' + actie + ' mislukt (' + (fout?.name || typeof fout) + ')');
}

async function leesCache(store) {
  try {
    const c = await store.get(CACHE_KEY, { type: 'json' });
    return c && typeof c === 'object' && !Array.isArray(c) ? c : {};
  } catch (e) {
    logFout('lezen', e);
    return {};
  }
}

// Eén schrijfactie met de verse stand samengevoegd; nooit vervangen. Best-effort.
async function bewaarInCache(store, nieuw) {
  if (!Object.keys(nieuw).length) return;
  try {
    const r = await serieel(() => wijzigBlob(store, CACHE_KEY, {
      leeg: {},
      wijzig: cache => (Object.keys(nieuw).length ? { ...cache, ...nieuw } : null),
    }));
    if (!r.ok) logFout('schrijven', { name: 'terugleescontrole' });
  } catch (e) {
    logFout('schrijven', e);
  }
}

/** Zoekt één postcode (cache eerst). Geeft { lat, lon, gemeente } of null. */
export async function zoekPostcode(store, pc, deps = {}) {
  const { gevonden } = await zoekPostcodes(store, [pc], deps);
  return gevonden[pc] ?? null;
}

/**
 * Zoekt meerdere postcodes: cache eerst, dan TomTom (max `parallel` tegelijk) tot het tijdsbudget op is.
 * -> { gevonden: { [pc]: { lat, lon, gemeente } }, open: string[] }  (open = niet opgezocht binnen het budget of niet gevonden)
 * Hoogstens één schrijfactie naar de cache per aanroep.
 */
export async function zoekPostcodes(store, lijst, { nu, maxTijdMs = 15000, parallel = 5, ...deps } = {}) {
  const uniek = [...new Set((Array.isArray(lijst) ? lijst : []).filter(pc => isPostcode(pc) && Number(pc) >= 1000))];
  const gevonden = {};
  const open = [];
  if (!uniek.length) return { gevonden, open };

  const cache = await leesCache(store);
  const teZoeken = [];
  for (const pc of uniek) {
    if (geldigeIngang(cache[pc])) gevonden[pc] = { lat: cache[pc].lat, lon: cache[pc].lon, gemeente: cache[pc].gemeente ?? '' };
    else teZoeken.push(pc);
  }

  const klok = maakKlok(nu);
  const start = klok();
  const nieuw = {};
  let volgende = 0;
  const werker = async () => {
    while (volgende < teZoeken.length) {
      if (klok() - start >= maxTijdMs) return; // budget op: de rest blijft open
      const pc = teZoeken[volgende++];
      const r = await geocodePostcode(pc, deps); // gooit nooit; null = niet gevonden, { fout } = tijdelijk (beide: open, niet gecachet)
      if (r && !r.fout) {
        gevonden[pc] = r;
        nieuw[pc] = { lat: r.lat, lon: r.lon, gemeente: r.gemeente };
      } else open.push(pc);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(parallel, teZoeken.length)) }, werker));
  for (const pc of teZoeken.slice(volgende)) open.push(pc);

  if (!deps.testModus) await bewaarInCache(store, nieuw);
  return { gevonden, open };
}
