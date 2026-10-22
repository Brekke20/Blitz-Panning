// schermen/themas-bron.js — de bron van de themapakketten voor de app: haalt /api/themas op, bewaart de cache (kern/themas-cache.js)
// en houdt het laatst gekende antwoord synchroon beschikbaar. Gooit nooit naar de aanroeper: geen netwerk, een foutstatus, een
// kapot antwoord of een opslag die weigert geeft gewoon de cache (of niets).
//
// Wat van de server komt wordt niet vertrouwd: elke indexregel en elk pakket gaat door dezelfde poort als de cache
// (`schoonIndex`, `schoonPakket` = valideerPakket); wat niet klopt, wordt weggelaten.
// Het antwoord bevat enkel de pakketten van thema's die nu actief zijn of binnen 14 dagen beginnen. Voor een thema dat in de
// index staat maar niet in het antwoord (en ook niet met dezelfde `pakketHash` in de cache) wordt het pakket apart opgehaald
// (`?id=`), maar enkel als het thema nu actief is of er al een (verouderd) pakket van in de cache staat: zo blijft een bewaard
// pakket bij en haalt een toestel niet blindelings de pakketten van thema's van over maanden op.
import { apiVerzoek } from '../kern/api.js';
import { actiefThema } from '../kern/themapakket.js';
import {
  leesCache, bewaarCache, actiefRecord, bewaarActiefRecord, schoonIndex, schoonPakket,
} from '../kern/themas-cache.js';

const PAD = '/api/themas';
const LEEG = () => ({ index: null, pakketten: {} });
const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

let laatste = null; // { index, pakketten }: het laatst gekende antwoord (uit de server of de cache)
let voorbeeldPakket = null;

// localStorage kan ontbreken of bij het openen gooien (privévenster, geblokkeerde sitegegevens).
function opslag() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

// Het laatst gekende { index, pakketten }, synchroon. Bij de eerste aanroep komt het uit de cache in localStorage.
export function themasNu() {
  if (!laatste) laatste = leesCache(opslag()) ?? LEEG();
  return laatste;
}

// Een voorbeeldpakket (uit de uploadvoorvertoning) dat enkel in het geheugen leeft; nooit bewaard.
export function zetVoorbeeld(pakket) { voorbeeldPakket = isObject(pakket) ? pakket : null; }
export function voorbeeld() { return voorbeeldPakket; }

async function haalPakket(id) {
  try {
    const r = await apiVerzoek(`${PAD}?id=${encodeURIComponent(id)}`);
    return r.ok ? schoonPakket(id, r.data) : null;
  } catch {
    return null;
  }
}

// Haalt de themas op en bewaart ze. Geeft altijd { index, pakketten }: de verse stand, anders de cache, anders { index: null, pakketten: {} }.
export async function laadThemas({ datum = new Date() } = {}) {
  let vorig = LEEG();
  try { vorig = themasNu(); } catch { /* cache onleesbaar: begin leeg */ }
  try {
    const r = await apiVerzoek(PAD);
    if (!r.ok || !isObject(r.data)) return vorig;
    const index = schoonIndex({ versie: r.data.versie, themas: r.data.themas });
    if (!index) return vorig;

    const antwoord = isObject(r.data.pakketten) ? r.data.pakketten : {};
    const vorigeHash = new Map((vorig.index?.themas || []).map((t) => [t.id, t.pakketHash]));
    const actief = actiefThema(datum, index.themas)?.id ?? null;
    const pakketten = {};
    const opTeHalen = [];
    for (const rij of index.themas) {
      const uitAntwoord = Object.hasOwn(antwoord, rij.id) ? schoonPakket(rij.id, antwoord[rij.id]) : null;
      if (uitAntwoord) { pakketten[rij.id] = uitAntwoord; continue; }
      const bewaard = Object.hasOwn(vorig.pakketten, rij.id) ? vorig.pakketten[rij.id] : null;
      if (bewaard && vorigeHash.get(rij.id) === rij.pakketHash) { pakketten[rij.id] = bewaard; continue; }
      if (bewaard || rij.id === actief) opTeHalen.push(rij.id);
    }
    const opgehaald = await Promise.all(opTeHalen.map(haalPakket));
    opTeHalen.forEach((id, i) => { if (opgehaald[i]) pakketten[id] = opgehaald[i]; });

    laatste = { index, pakketten };
    const o = opslag();
    bewaarCache(o, laatste, { datum });
    bewaarActiefRecord(o, actiefRecord(index, pakketten, datum));
    return laatste;
  } catch {
    return vorig;
  }
}
