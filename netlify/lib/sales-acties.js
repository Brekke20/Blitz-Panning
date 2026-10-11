// Sales-planner (server): de drie acties van /api/sales als functies rond de opslag. Elke actie geeft { status, json };
// de handler (functions/sales.js) doet toegang, CORS en foutvertaling. Nooit persoonsgegevens in logregels of console:
// enkel lead-id's en de soort van een resultaat.
import { randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { leesSales, muteerSales, naarClient } from './sales-opslag.js';
import { pasWijzigingToe } from './sales-wijzig.js';
import { bewaarLocaties, telOpen } from './sales-locaties-bewaren.js';
import { maakGrafsteen, voegGrafsteenToe } from './sales-grafsteen.js';
import { OPSLAG_STORING } from './auth-antwoord.js';

const STORING = Object.freeze({ status: 503, json: OPSLAG_STORING });
const tijd = nu => (typeof nu === 'function' ? nu() : nu);
const isObject = x => x !== null && typeof x === 'object' && !Array.isArray(x);

const metOpen = (data, doelId, open = telOpen(data.leads)) => ({ ...naarClient(data, doelId), open });

/** GET: de blob van de verkoper (zonder grafstenen) + het aantal leads zonder (definitieve) locatie. */
export async function haalSales({ store, doelId }) {
  const data = await leesSales(store, doelId);
  return { status: 200, json: metOpen(data, doelId) };
}

/**
 * PATCH { versie, leads?, blokken?, aanvullen? }.
 * 200 { ...blob, open } | 400 { error, fouten? } | 409 { error, serverVersie, data } | 503 opslag-storing.
 * `deps` = { fetch, sleutel, testModus, wacht?, timeoutMs?, nieuwBlokId? }; `log({ actie, onderwerp, details })` is best-effort.
 */
export async function wijzigSales({ store, doelId, body, nu, deps = {}, log = async () => {} }) {
  if (!isObject(body)) return { status: 400, json: { error: 'Ongeldige invoer' } };
  if (body.versie === undefined || body.versie === null) return { status: 400, json: { error: 'versie ontbreekt' } };
  if (!Number.isInteger(body.versie) || body.versie < 0) return { status: 400, json: { error: 'versie moet een geheel getal zijn' } };
  const moment = tijd(nu);
  const { nieuwBlokId = () => 'b-' + randomBytes(6).toString('hex'), ...geoDeps } = deps;

  const uitkomst = await muteerSales(store, doelId, {
    verwachteVersie: body.versie,
    wijzig: data => {
      const r = pasWijzigingToe(data, body, { nu: moment, nieuwBlokId });
      if (r.fouten.length) return { fouten: r.fouten };
      if (isDeepStrictEqual(r.data, data)) return null; // niets veranderd: geen schrijfactie, geen versieverhoging
      return { data: r.data, extra: { adresGewijzigd: r.adresGewijzigd, resultaten: r.resultaten } };
    },
  });
  if (uitkomst.status === 'storing') return STORING;
  if (uitkomst.status === 'conflict') {
    return { status: 409, json: { error: 'Versiematch mislukt', serverVersie: uitkomst.data.versie, data: naarClient(uitkomst.data, doelId) } };
  }
  if (uitkomst.status === 'ongeldig') return { status: 400, json: { error: 'Ongeldige wijziging', fouten: uitkomst.fouten } };

  let data = uitkomst.data;
  const extra = uitkomst.status === 'ok' ? uitkomst.extra : null;
  for (const { leadId, soort } of extra?.resultaten ?? []) {
    await log({ actie: 'sales-resultaat', onderwerp: leadId, details: { soort } });
  }
  let open = telOpen(data.leads);
  if ((extra?.adresGewijzigd?.length ?? 0) > 0 || body.aanvullen === true) {
    // Geocoding buiten het slot. Faalt het bewaren van de locaties, dan blijft de al geschreven wijziging staan (de leads
    // zonder locatie blijven `open` en een volgende aanvul-ronde probeert het opnieuw).
    const l = await bewaarLocaties({ store, doelId, nu, deps: geoDeps });
    if (l.status === 'ok') { data = l.data; open = l.open; }
  }
  return { status: 200, json: metOpen(data, doelId, open) };
}

/**
 * DELETE ?lead=<id>: de lead eruit, met een grafsteen (enkel hashes, nooit namen) als er een geheim is.
 * 200 { versie } | 404 | 503. Geen versiecontrole: verwijderen botst niet met andere wijzigingen.
 */
export async function verwijderLead({ store, doelId, leadId, nu, geheim, log = async () => {} }) {
  const moment = tijd(nu);
  const sleutel = typeof geheim === 'function' ? geheim() : geheim;
  const uitkomst = await muteerSales(store, doelId, {
    wijzig: data => {
      const index = data.leads.findIndex(l => l.id === leadId);
      if (index < 0) return null;
      const steen = maakGrafsteen(data.leads[index], { gebruikerId: doelId, nu: moment, geheim: sleutel });
      return {
        data: {
          ...data,
          leads: data.leads.filter((_, i) => i !== index),
          grafstenen: voegGrafsteenToe(data.grafstenen, steen),
        },
      };
    },
  });
  if (uitkomst.status === 'storing') return STORING;
  if (uitkomst.status !== 'ok') return { status: 404, json: { error: 'Lead niet gevonden' } };
  await log({ actie: 'sales-lead-verwijderd', onderwerp: leadId });
  return { status: 200, json: { versie: uitkomst.data.versie } };
}
