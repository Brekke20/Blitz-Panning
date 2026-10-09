// Sales-planner: opruimregel. `ruimOp` is pure logica: afgewerkte leads en grafstenen worden BEWAAR_MAANDEN na het
// laatste bezoek / de verwijdering gewist. `ruimAllesOp` past dat toe op alle verkoperblobs (dagelijkse geplande functie).
import { muteerSales } from './sales-opslag.js';
import { logActiviteit } from './activiteit.js';

export const BEWAAR_MAANDEN = 12;

const DAG = /^\d{4}-\d{2}-\d{2}/;
const dagVan = tekst => (typeof tekst === 'string' && DAG.test(tekst) ? tekst.slice(0, 10) : null);

/** 'YYYY-MM-DD' van het laatste bezoek: max van bezoeken[].datum en resultaat.op; anders geimporteerdOp; anders null. */
export function laatsteBezoekDatum(lead) {
  if (!lead) return null;
  const dagen = [];
  if (Array.isArray(lead.bezoeken)) for (const b of lead.bezoeken) dagen.push(dagVan(b?.datum));
  dagen.push(dagVan(lead.resultaat?.op));
  const gevonden = dagen.filter(Boolean);
  if (gevonden.length) return gevonden.reduce((a, b) => (b > a ? b : a));
  return dagVan(lead.geimporteerdOp);
}

// Grensdag: `nu` min BEWAAR_MAANDEN kalendermaanden (dag begrensd op het maandeinde). Wat strikt ervoor ligt, vervalt.
function grensDag(nu) {
  const d = new Date(nu);
  if (Number.isNaN(d.getTime())) throw new Error('Ongeldig tijdstip voor opruimen');
  const maandIndex = d.getUTCFullYear() * 12 + d.getUTCMonth() - BEWAAR_MAANDEN;
  const jaar = Math.floor(maandIndex / 12);
  const maand = maandIndex - jaar * 12;
  const dagenInMaand = new Date(Date.UTC(jaar, maand + 1, 0)).getUTCDate();
  const dag = Math.min(d.getUTCDate(), dagenInMaand);
  return new Date(Date.UTC(jaar, maand, dag)).toISOString().slice(0, 10);
}

/** Wist afgewerkte leads (en hun bezoeken) en grafstenen ouder dan 12 maanden. Muteert de invoer niet. */
export function ruimOp(data, nu) {
  const grens = grensDag(nu);
  const leads = Array.isArray(data?.leads) ? data.leads : [];
  const grafstenen = Array.isArray(data?.grafstenen) ? data.grafstenen : [];
  const gewist = [];
  const bewaard = [];
  for (const lead of leads) {
    const dag = lead?.status === 'afgewerkt' ? laatsteBezoekDatum(lead) : null;
    if (dag && dag < grens) gewist.push(lead.id);
    else bewaard.push(structuredClone(lead));
  }
  const grafBewaard = grafstenen.filter(g => {
    const dag = dagVan(g?.op);
    return !(dag && dag < grens);
  }).map(g => structuredClone(g));
  const { leads: _l, blokken: _b, grafstenen: _g, ...rest } = data ?? {};
  return {
    data: { ...structuredClone(rest), leads: bewaard, blokken: structuredClone(data?.blokken ?? []), grafstenen: grafBewaard },
    gewist,
    grafstenenGewist: grafstenen.length - grafBewaard.length,
  };
}

const SYSTEEM = Object.freeze({ id: 'systeem', naam: 'Systeem' });
const PREFIX = 'sales/';

/**
 * Ruimt ALLE verkoperblobs `sales/*` op (ook van geblokkeerde of verwijderde verkopers): per blob `ruimOp`, enkel een
 * schrijfactie bij wijziging (idempotent), en per blob met gewiste leads één logregel (enkel een aantal, door Systeem).
 * Een blob die faalt stopt de rest niet; het aantal mislukte blobs staat dan als `mislukt` in het resultaat.
 * -> { gewist, grafstenenGewist, mislukt? }
 */
export async function ruimAllesOp({ store, nu }) {
  const { blobs = [] } = (await store.list({ prefix: PREFIX })) ?? {};
  let gewist = 0;
  let grafstenenGewist = 0;
  let mislukt = 0;
  for (const { key } of blobs) {
    const verkoperId = key.slice(PREFIX.length);
    if (!verkoperId) continue;
    try {
      const uitkomst = await muteerSales(store, verkoperId, {
        wijzig: data => {
          const r = ruimOp(data, nu);
          if (r.gewist.length === 0 && r.grafstenenGewist === 0) return null;
          return { data: r.data, extra: { aantal: r.gewist.length, grafstenen: r.grafstenenGewist } };
        },
      });
      if (uitkomst.status === 'storing') { mislukt++; console.error('[sales-opruimen] blob niet bewaard'); continue; }
      if (uitkomst.status !== 'ok') continue;
      gewist += uitkomst.extra.aantal;
      grafstenenGewist += uitkomst.extra.grafstenen;
      if (uitkomst.extra.aantal > 0) {
        await logActiviteit(store, {
          gebruiker: SYSTEEM, actie: 'sales-lead-verwijderd', onderwerp: verkoperId, details: { aantal: uitkomst.extra.aantal },
        }, { nu: () => nu });
      }
    } catch (e) {
      mislukt++;
      console.error('[sales-opruimen] blob mislukt (' + (e?.name || 'Error') + ')');
    }
  }
  return { gewist, grafstenenGewist, ...(mislukt ? { mislukt } : {}) };
}
