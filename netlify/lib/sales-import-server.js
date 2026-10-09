// Sales-planner (server): een exportbestand van de verkoper importeren in zijn eigen blob `sales/<gebruikerId>`.
// Parseren en samenvoegen komen uit de pure modules in public/js/sales (leesExport, voegSamen); hier zit de opslag:
//   1. samenvoegen binnen EEN muteerSales (zonder versiecontrole, altijd op de verse stand) -> leads + verbruikte grafstenen,
//   2. daarna de locaties bepalen en bewaren (netwerk BUITEN het slot; tweede schrijfactie),
//   3. loggen: enkel aantallen (nooit namen, e-mails, nummers of lead-id's).
// Lead-id's zijn willekeurig (randomUUID): ze komen in het activiteitenlog terecht en mogen dus niets verraden.
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { leesExport } from '../../public/js/sales/import.js';
import { voegSamen } from '../../public/js/sales/herkenning.js';
import { muteerSales } from './sales-opslag.js';
import { bewaarLocaties, telOpen } from './sales-locaties-bewaren.js';
import { hashVoor } from './sales-grafsteen.js';
import { OPSLAG_STORING } from './auth-antwoord.js';

// Tijdsbudget voor het geocoderen: de functie mag 26 s duren en een lopende aanvraag kan het budget nog ~5 s (time-out) overschrijden.
const LOCATIE_BUDGET_MS = 12000;
const STORING = Object.freeze({ status: 503, json: OPSLAG_STORING });
const tijd = nu => (typeof nu === 'function' ? nu() : nu);
const isObject = x => x !== null && typeof x === 'object' && !Array.isArray(x);

/** true als ergens in het (geparste) bestand een eigen sleutel `__proto__` staat. Iteratief: geen stack-overflow bij diepe nesting. */
export function heeftProtoSleutel(waarde) {
  const stapel = [waarde];
  while (stapel.length) {
    const w = stapel.pop();
    if (w === null || typeof w !== 'object') continue;
    if (Array.isArray(w)) { stapel.push(...w); continue; }
    for (const k of Object.keys(w)) {
      if (k === '__proto__') return true;
      stapel.push(w[k]);
    }
  }
  return false;
}

/**
 * body = { export: <object> } -> { status, json }
 *   200 { versie, samenvatting: { nieuw, alAanwezig, adresNakijken, eerderVerwijderd, overgeslagen }, export: { verantwoordelijke, geexporteerdOp, aantal, statussen }, open }
 *   400 { error } | 503 opslag-storing.
 * `deps` = { fetch, sleutel, testModus, geheim (functie of tekst), wacht?, timeoutMs? }. `log({ actie, details })` is best-effort.
 * Het antwoord bevat nooit `grafstenen`.
 */
export async function importeerExport({
  store, doelId, body, nu, nieuwId = () => randomUUID(), deps = {}, log = async () => {},
}) {
  if (!isObject(body) || !isObject(body.export)) return { status: 400, json: { error: 'Geen geldig exportbestand' } };
  if (heeftProtoSleutel(body.export)) return { status: 400, json: { error: 'Geen geldig exportbestand' } };
  const gelezen = leesExport(body.export);
  if (!gelezen.ok) return { status: 400, json: { error: gelezen.fout } };

  const { geheim, ...geoDeps } = deps;
  const sleutel = typeof geheim === 'function' ? geheim() : geheim;
  const hash = typeof sleutel === 'string' && sleutel !== '' ? hashVoor(doelId, sleutel) : null; // zonder geheim: geen grafsteen-herkenning
  const moment = new Date(tijd(nu)).toISOString();
  const bronExport = { verantwoordelijke: gelezen.verantwoordelijke, geexporteerdOp: gelezen.geexporteerdOp };

  let samenvatting = null; // opnieuw gezet bij elke aanroep van de callback (ook bij een herhaling door wijzigBlob)
  const uitkomst = await muteerSales(store, doelId, {
    wijzig: data => {
      const r = voegSamen(data.leads, gelezen.leads, { nu: moment, nieuwId, bronExport, grafstenen: data.grafstenen, hash });
      samenvatting = r.samenvatting;
      if (isDeepStrictEqual(r.leads, data.leads) && isDeepStrictEqual(r.grafstenen, data.grafstenen)) return null; // niets nieuws: geen schrijfactie
      return { data: { ...data, leads: r.leads, grafstenen: r.grafstenen } };
    },
  });
  if (uitkomst.status !== 'ok' && uitkomst.status !== 'ongewijzigd') return STORING;

  let data = uitkomst.data;
  let open = telOpen(data.leads);
  // Locaties buiten het slot. Faalt het bewaren ervan, dan blijven de al geschreven leads staan (ze blijven `open`; een volgende
  // aanvul-ronde of import probeert het opnieuw).
  const l = await bewaarLocaties({ store, doelId, nu, deps: geoDeps, maxTijdMs: LOCATIE_BUDGET_MS });
  if (l.status === 'ok') { data = l.data; open = l.open; }

  const { nieuw, alAanwezig, adresNakijken, eerderVerwijderd } = samenvatting;
  await log({ actie: 'sales-import', details: { nieuw, alAanwezig, adresNakijken, eerderVerwijderd } });
  return {
    status: 200,
    json: {
      versie: data.versie,
      samenvatting: { nieuw, alAanwezig, adresNakijken, eerderVerwijderd, overgeslagen: gelezen.overgeslagen },
      export: {
        verantwoordelijke: gelezen.verantwoordelijke, geexporteerdOp: gelezen.geexporteerdOp, aantal: gelezen.aantal, statussen: gelezen.statussen,
      },
      open,
    },
  };
}
