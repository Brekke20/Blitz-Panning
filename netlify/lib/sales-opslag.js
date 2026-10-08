// Sales-planner (server): opslag van het verkoperblob `sales/<gebruikerId>` = { versie, leads, blokken, grafstenen }.
// Elke lees-wijzig-schrijf-actie loopt via `wijzigBlob` binnen één serieel per blobsleutel en faalt gesloten:
// `ok:false` of een Blobs-fout geeft `{ status:'storing' }` (de handlers vertalen dat naar 503 'opslag-storing').
import { wijzigBlob } from './blob-wijzig.js';
import { maakSerieel } from './serieel.js';

export const salesSleutel = gebruikerId => `sales/${gebruikerId}`;
export const leegSales = () => ({ versie: 0, leads: [], blokken: [], grafstenen: [] });

const lijst = x => (Array.isArray(x) ? x : []);

// Vult ontbrekende velden aan; geeft een nieuw object (behoudt onbekende velden).
function vulAan(blob) {
  const b = blob && typeof blob === 'object' ? blob : {};
  return {
    ...b,
    versie: typeof b.versie === 'number' ? b.versie : 0,
    leads: lijst(b.leads),
    blokken: lijst(b.blokken),
    grafstenen: lijst(b.grafstenen),
  };
}

/** Leest het blob (zonder slot). Leeg als er geen blob is; ontbrekende velden aangevuld. Gooit bij een Blobs-fout. */
export async function leesSales(store, gebruikerId) {
  return vulAan(await store.get(salesSleutel(gebruikerId), { type: 'json' }));
}

/** Wat een client te zien krijgt: nooit `grafstenen`; een diepe kopie (deelt geen referenties met `data`). */
export function naarClient(data, gebruikerId) {
  const d = vulAan(data);
  return structuredClone({ gebruikerId, versie: d.versie, leads: d.leads, blokken: d.blokken });
}

// Eén serieel per blobsleutel: gelijktijdige verzoeken op hetzelfde verkoperblob overschrijven elkaar niet.
const serieleKetens = new Map();
function serieelVoor(sleutel) {
  let s = serieleKetens.get(sleutel);
  if (!s) { s = maakSerieel(); serieleKetens.set(sleutel, s); }
  return s;
}

/**
 * Lees-wijzig-schrijf op het verkoperblob.
 * wijzig(data /* verse kopie van de huidige blob *\/) -> { data, extra? } | { fouten: string[] } | null (niets doen)
 * -> { status:'ok', data /* geschreven blob, versie + 1 *\/, extra } | { status:'ongewijzigd', data }
 *  | { status:'conflict', data /* huidige blob *\/ } | { status:'ongeldig', fouten } | { status:'storing' }
 */
export async function muteerSales(store, gebruikerId, { verwachteVersie, wijzig }) {
  const sleutel = salesSleutel(gebruikerId);
  return serieelVoor(sleutel)(async () => {
    // De uitkomst begint bij ELKE aanroep van de callback opnieuw (ook bij een herhaling door wijzigBlob).
    let uitkomst = null;
    let eigenFout = null;
    let res;
    try {
      res = await wijzigBlob(store, sleutel, {
        leeg: leegSales(),
        wijzig: huidig => {
          uitkomst = null;
          try {
            const data = vulAan(huidig);
            if (verwachteVersie != null && data.versie !== verwachteVersie) {
              uitkomst = { status: 'conflict', data };
              return null;
            }
            const r = wijzig(structuredClone(data));
            if (r == null) { uitkomst = { status: 'ongewijzigd', data }; return null; }
            if (Array.isArray(r.fouten)) { uitkomst = { status: 'ongeldig', fouten: r.fouten }; return null; }
            // Geen `data` (bv. enkel { extra }) is geen wijziging: nooit schrijven, het blob wordt dus nooit leeggemaakt.
            if (r.data === null || typeof r.data !== 'object' || Array.isArray(r.data)) { uitkomst = { status: 'ongewijzigd', data }; return null; }
            uitkomst = { status: 'ok', extra: r.extra };
            const nieuw = vulAan(r.data);
            nieuw.versie = data.versie + 1; // wijzigBlob verhoogt de versie ook zelf; dit dekt een oud blob zonder versie
            return nieuw;
          } catch (fout) {
            eigenFout = fout; // een bug in de callback is geen opslagstoring
            uitkomst = null;
            return null;
          }
        },
      });
    } catch {
      return { status: 'storing' }; // de store gooit: fail closed
    }
    if (eigenFout) throw eigenFout;
    if (!res.ok) return { status: 'storing' };
    if (uitkomst.status === 'ok') return { status: 'ok', data: vulAan(res.waarde), extra: uitkomst.extra };
    return uitkomst;
  });
}
