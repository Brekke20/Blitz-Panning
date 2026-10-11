// Jaar-archief voor rapporten die uit de actieve rapportlijst (MAX_RAPPORTEN) vallen.
// Blob `rapportlijst-archief-<jaar>` = { versie, rapports: Entry[] }, append-only: een bestaande
// entry wordt nooit gewijzigd of verwijderd. Entries worden licht opgeslagen (stripZwareVelden).
//
// EEN schrijver: archiveerAfgevallen. De afkapping gebeurt in voegToeOfWerkBij (rapportlijst.js),
// dat de staart als `afgevallen` teruggeeft; de twee aanroepers (rapport-ontvangst.js en het
// POST-blok van functions/rapport-archief.js) geven die door, ná het slagen van de lijstschrijfactie
// en best-effort: een mislukte archivering is nooit een fout voor de upload (de entries zijn dan
// verloren, precies zoals vroeger bij elke afkapping). herstelEntry kapt niet meer af.
// Het dashboard leest de actieve lijst plus de archieven van de gekozen periode (leesArchieven).

import { stripZwareVelden } from './rapportlijst.js';
import { wijzigBlob } from './blob-wijzig.js';
import { maakSerieel } from './serieel.js';

export const ARCHIEF_PREFIX = 'rapportlijst-archief-';

function jaarVan(entry) {
  const uitDatum = /^(\d{4})-/.exec(String(entry?.datum ?? ''));
  if (uitDatum) return uitDatum[1];
  const uitAangemaakt = /^(\d{4})/.exec(String(entry?.aangemaakt ?? ''));
  return uitAangemaakt ? uitAangemaakt[1] : 'onbekend';
}

// 'rapportlijst-archief-2026'; jaar uit entry.datum ('YYYY-…'), anders entry.aangemaakt, anders 'onbekend'.
export function archiefSleutel(entry) {
  return ARCHIEF_PREFIX + jaarVan(entry);
}

function licht(entry) {
  if (!entry || typeof entry !== 'object' || !('rapportData' in entry)) return entry;
  return { ...entry, rapportData: stripZwareVelden(entry.rapportData) };
}

// Voegt de entries toe aan het archief van hun jaar via het gedeelde wijzigBlob (lezen, enkel ids toevoegen
// die er nog niet in staan, `versie + 1` schrijven, terugleescontrole, tot 3 pogingen) en serieel binnen
// de instantie (serieel.js), net als de andere beheer-schrijvers. Idempotent op id. Een bestaande maar
// onbruikbare (corrupte) blob wordt NOOIT overschreven. Gooit nooit: bij falen { ok:false } en een
// console.error met de ids.
const serieelArchief = maakSerieel();

export async function archiveerAfgevallen(store, entries) {
  const perSleutel = new Map();
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!e || e.id === undefined || e.id === null || e.id === '') continue;
    const sleutel = archiefSleutel(e);
    if (!perSleutel.has(sleutel)) perSleutel.set(sleutel, []);
    perSleutel.get(sleutel).push(e);
  }

  let ok = true;
  let aantal = 0;
  for (const [sleutel, groep] of perSleutel) {
    let toegevoegd = [];
    let laatsteFout = null;
    let gelukt = false;
    try {
      const r = await serieelArchief(() => wijzigBlob(store, sleutel, {
        leeg: { versie: 0, rapports: [] },
        wijzig: huidig => {
          // Corrupte blob: nooit overschrijven, de fout laat de hele poging falen.
          if (huidig === null || typeof huidig !== 'object' || !Array.isArray(huidig.rapports)) {
            throw new Error('archiefblob onleesbaar (geen rapports-array), niet overschreven');
          }
          const aanwezig = new Set(huidig.rapports.map(x => String(x.id)));
          const nieuw = [];
          for (const e of groep) {
            const id = String(e.id);
            if (aanwezig.has(id)) continue;
            aanwezig.add(id);
            nieuw.push(licht(e));
          }
          toegevoegd = nieuw;
          if (!nieuw.length) return null;
          return { versie: (huidig.versie ?? 0) + 1, rapports: [...huidig.rapports, ...nieuw] };
        },
        controleer: terug => {
          const teruggezet = new Set((terug?.rapports ?? []).map(x => String(x.id)));
          return toegevoegd.every(e => teruggezet.has(String(e.id)));
        },
      }));
      gelukt = r.ok;
    } catch (err) {
      laatsteFout = err;
    }
    if (gelukt) {
      aantal += toegevoegd.length;
    } else {
      ok = false;
      console.error(`[rapport-jaararchief] archiveren mislukt voor ${sleutel}, ids: ${groep.map(e => e.id).join(', ')}`
        + (laatsteFout ? ` (${laatsteFout?.message || laatsteFout})` : ''));
    }
  }
  return { ok, aantal };
}

// Alle jaren van het jaar van vanDatum t/m dat van totDatum, bv. ('2025-11-20','2026-02-01') -> ['2025','2026'].
export function archiefJaren(vanDatum, totDatum) {
  const van = Number((/^(\d{4})/.exec(String(vanDatum ?? '')) ?? [])[1]);
  const tot = Number((/^(\d{4})/.exec(String(totDatum ?? '')) ?? [])[1]);
  if (!Number.isInteger(van) || !Number.isInteger(tot) || van > tot) return [];
  const jaren = [];
  for (let j = van; j <= tot; j++) jaren.push(String(j));
  return jaren;
}

// Leest de archieven van de gegeven jaren. Een ontbrekend archief telt als leeg; een falende lezing
// komt (als jaar) in `fouten` en laat de andere jaren ongemoeid.
export async function leesArchieven(store, jaren) {
  const rapports = [];
  const fouten = [];
  for (const jaar of jaren) {
    try {
      const blob = await store.get(ARCHIEF_PREFIX + jaar, { type: 'json' });
      if (blob === null || blob === undefined) continue;
      if (!Array.isArray(blob.rapports)) { fouten.push(jaar); continue; }
      rapports.push(...blob.rapports);
    } catch {
      fouten.push(jaar);
    }
  }
  return { rapports, fouten };
}
