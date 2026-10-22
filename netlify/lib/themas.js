// Serverkant van de themapakketten (spec "Thema's uploaden", §4): opslag, zaaien, de publieke lijst, upload en aan/uit.
// Twee soorten blobs in de store van het verzoek:
//   themas/index          { versie, themas: [{ id, naam, aan, periode, periodeOverride|null, pakketHash, geuploadOp, geuploadDoor }], gezaaid: [id…] }
//   themas/pakket/<id>    de (gevalideerde) pakket-JSON
// De index gaat via `wijzigBlob` (versie loopt op bij elke wijziging); de pakketten zijn onveranderlijk per upload.
// De regels voor "wat is nu actief" komen uit public/js/kern/themapakket.js (zelfde bron als de client).
import { createHash } from 'node:crypto';
import { wijzigBlob } from './blob-wijzig.js';
import { VOORGELADEN } from '../themas/pakketten.js';
import { belgischeDag, effectievePeriode, isActief, periodeVoorJaar } from '../../public/js/kern/themapakket.js';
import { valideerPeriode } from '../../public/js/kern/themapakket-validatie.js';

export const INDEX_SLEUTEL = 'themas/index';
export const pakketSleutel = (id) => 'themas/pakket/' + id;

const LEEG = Object.freeze({ versie: 0, themas: [], gezaaid: [] });
const NABIJ_DAGEN = 14; // een thema dat binnen zoveel dagen begint, gaat al mee naar de client (cache voor offline)
const DAG_MS = 24 * 60 * 60 * 1000;
const ID = /^[a-z0-9-]{2,30}$/;
const GERESERVEERD = new Set(['__proto__', 'constructor', 'prototype']);

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const geldigId = (id) => typeof id === 'string' && ID.test(id) && !GERESERVEERD.has(id);

export function pakketHash(pakket) {
  return createHash('sha256').update(JSON.stringify(pakket)).digest('hex');
}

// Een blob zoals hij uit de opslag komt, altijd in de vaste vorm (een kapotte of ontbrekende blob = leeg).
function normaal(blob) {
  const b = isObject(blob) ? blob : {};
  return {
    versie: typeof b.versie === 'number' ? b.versie : 0,
    themas: Array.isArray(b.themas) ? b.themas.filter((t) => isObject(t) && typeof t.id === 'string') : [],
    gezaaid: Array.isArray(b.gezaaid) ? b.gezaaid.filter((id) => typeof id === 'string') : [],
  };
}

export async function leesIndex(store) {
  return normaal(await store.get(INDEX_SLEUTEL, { type: 'json' }));
}

const itemVan = (pakket, { geuploadOp = null, geuploadDoor = null } = {}) => ({
  id: pakket.id,
  naam: pakket.naam,
  aan: true,
  periode: pakket.periode,
  periodeOverride: null,
  pakketHash: pakketHash(pakket),
  geuploadOp,
  geuploadDoor,
});

// Zet elk voorgeladen pakket waarvan de id nog niet in `gezaaid` staat in de opslag (aan: true). Daarna nooit meer: wat de
// beheerder uitzet blijft uit en een upload wordt niet overschreven. Best-effort: een schrijffout wordt gelogd (enkel het
// fouttype) en geeft de gelezen index terug. Een LEESfout van de index gooit wel (de aanroeper antwoordt dan 503).
export async function zaai(store, voorgeladen = VOORGELADEN) {
  const index = await leesIndex(store);
  const nodig = voorgeladen.filter((p) => !index.gezaaid.includes(p.id));
  if (nodig.length === 0) return index;
  try {
    // Pakketten eerst, dan de index: een onderbroken zaai laat hooguit een pakket zonder indexregel achter, geen regel zonder pakket.
    for (const p of nodig) if (!index.themas.some((t) => t.id === p.id)) await store.setJSON(pakketSleutel(p.id), p);
    const r = await wijzigBlob(store, INDEX_SLEUTEL, {
      leeg: LEEG,
      wijzig: (blob) => {
        const b = normaal(blob);
        const open = nodig.filter((p) => !b.gezaaid.includes(p.id));
        if (open.length === 0) return null;
        for (const p of open) {
          b.gezaaid.push(p.id);
          if (!b.themas.some((t) => t.id === p.id)) b.themas.push(itemVan(p));
        }
        return b;
      },
    });
    return r.ok ? normaal(r.waarde) : index;
  } catch (e) {
    console.error('themas: zaaien mislukt (' + (e?.name || 'Error') + ')');
    return index;
  }
}

// Wat de client van een thema mag zien: de effectieve gegevens, nooit wie of wanneer er uploadde.
const publiekItem = (t) => ({
  id: t.id,
  naam: t.naam,
  aan: t.aan !== false,
  periode: t.periode,
  periodeOverride: t.periodeOverride ?? null,
  pakketHash: t.pakketHash,
});
export const publiekeThemas = (index) => index.themas.map(publiekItem);

const dagTekst = (ms) => new Date(ms).toISOString().slice(0, 10);

// De publieke lijst + de volledige pakketten van de thema's die nu lopen of binnen 14 dagen beginnen (`aan` of niet:
// de client beslist met `aan`). `datum` is een Date of tijdstip in ms.
export async function openbareLijst(index, datum, store) {
  const d = belgischeDag(datum);
  const jaar = d.jaar;
  const vandaag = dagTekst(Date.UTC(d.jaar, d.maand - 1, d.dag));
  const grens = dagTekst(Date.UTC(d.jaar, d.maand - 1, d.dag) + NABIJ_DAGEN * DAG_MS);
  const nabij = (t) => {
    if (isActief({ ...t, aan: true }, datum)) return true;
    const periode = effectievePeriode(t);
    return [jaar, jaar + 1].some((j) => {
      const { start } = periodeVoorJaar(periode, j);
      return start > vandaag && start <= grens;
    });
  };
  const pakketten = {};
  for (const t of index.themas) {
    if (!nabij(t)) continue;
    const pakket = await store.get(pakketSleutel(t.id), { type: 'json' });
    if (pakket) pakketten[t.id] = pakket;
  }
  return { versie: index.versie, themas: publiekeThemas(index), pakketten };
}

// Bewaart een GEVALIDEERD pakket (nieuw of een nieuwe versie op id). Een bestaand thema houdt `aan` en `periodeOverride`.
// Heeft het id van een voorgeladen pakket, dan telt het als gezaaid: een latere zaai overschrijft de upload nooit.
export async function bewaarPakket(store, pakket, gebruiker, { nu = () => Date.now(), voorgeladen = VOORGELADEN } = {}) {
  await store.setJSON(pakketSleutel(pakket.id), pakket);
  const geuploadOp = new Date(nu()).toISOString();
  let nieuw = true;
  const r = await wijzigBlob(store, INDEX_SLEUTEL, {
    leeg: LEEG,
    wijzig: (blob) => {
      const b = normaal(blob);
      const vers = itemVan(pakket, { geuploadOp, geuploadDoor: gebruiker?.id ?? null });
      const bestaand = b.themas.findIndex((t) => t.id === pakket.id);
      nieuw = bestaand === -1;
      if (nieuw) b.themas.push(vers);
      else {
        const oud = b.themas[bestaand];
        b.themas[bestaand] = { ...vers, aan: oud.aan !== false, periodeOverride: oud.periodeOverride ?? null };
      }
      if (voorgeladen.some((p) => p.id === pakket.id) && !b.gezaaid.includes(pakket.id)) b.gezaaid.push(pakket.id);
      return b;
    },
  });
  if (!r.ok) throw new Error('themas: index niet bewaard');
  return { ok: true, nieuw, index: normaal(r.waarde) };
}

// PATCH { id, aan?, periode?, versie }: `periode: null` wist de override. Optimistic locking op `index.versie`.
// -> { ok: true, index } | { ok: false, status: 404 | 409 | 422, ... }
export async function wijzigThema(store, { id, aan, periode, versie } = {}, _gebruiker) {
  const fouten = [];
  if (!geldigId(id)) fouten.push({ veld: 'id', fout: 'Een thema-id is verplicht.' });
  if (!Number.isInteger(versie)) fouten.push({ veld: 'versie', fout: 'De versie van de lijst is verplicht (een geheel getal).' });
  const metAan = aan !== undefined;
  const metPeriode = periode !== undefined;
  if (metAan && typeof aan !== 'boolean') fouten.push({ veld: 'aan', fout: 'Moet waar of onwaar zijn.' });
  let nieuwePeriode = null;
  if (metPeriode && periode !== null) {
    const p = valideerPeriode(periode);
    if (p.ok) nieuwePeriode = p.periode;
    else fouten.push(...p.fouten);
  }
  if (!metAan && !metPeriode) fouten.push({ veld: 'pakket', fout: 'Er is niets te wijzigen (geef aan of periode mee).' });
  if (fouten.length) return { ok: false, status: 422, fouten };

  let weiger = null;
  const r = await wijzigBlob(store, INDEX_SLEUTEL, {
    leeg: LEEG,
    wijzig: (blob) => {
      weiger = null;
      const b = normaal(blob);
      const t = b.themas.find((x) => x.id === id);
      if (!t) { weiger = { ok: false, status: 404, error: 'Dit thema bestaat niet.' }; return null; }
      if (b.versie !== versie) {
        weiger = { ok: false, status: 409, error: 'De themalijst is intussen gewijzigd. Vernieuw en probeer opnieuw.', serverVersie: b.versie };
        return null;
      }
      if (metAan) t.aan = aan;
      if (metPeriode) t.periodeOverride = nieuwePeriode;
      return b;
    },
  });
  if (weiger) return weiger;
  if (!r.ok) throw new Error('themas: index niet bewaard');
  return { ok: true, index: normaal(r.waarde) };
}
