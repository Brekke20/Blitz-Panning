// Sales-planner: opruimregel (AVG-bewaartermijn, besluit Brent 2026-10-09). `ruimOp` is pure logica: elke lead (ook een niet afgewerkte) en elk
// blok wordt BEWAAR_MAANDEN na de LAATSTE ACTIVITEIT gewist (import, wijziging, bezoek, resultaat); grafstenen BEWAAR_MAANDEN na de verwijdering.
// `ruimAllesOp` past dat toe op alle verkoperblobs van een store (dagelijkse geplande functie; ook de blobs van geblokkeerde of verwijderde verkopers).
import { muteerSales } from './sales-opslag.js';
import { logActiviteit } from './activiteit.js';

export const BEWAAR_MAANDEN = 12;

const DAG = /^\d{4}-\d{2}-\d{2}/;
const dagVan = tekst => (typeof tekst === 'string' && DAG.test(tekst) ? tekst.slice(0, 10) : null);

/**
 * 'YYYY-MM-DD' van de laatste activiteit van een lead: de laatste van geimporteerdOp (ook een nieuwe import van dezelfde lead zet `gewijzigdOp`),
 * gewijzigdOp (door de server gezet bij elke wijziging), eerderVerwijderd.op, resultaat.op en van elk bezoek `op` en `datum`.
 * De door de gebruiker gekozen bezoekdatum telt hoogstens tot vandaag (`nu`). Een lead met een voorgesteld of bevestigd bezoek
 * vandaag of later wordt hoe dan ook bewaard (zie ruimOp); pas als die datum voorbij is, loopt de termijn van 12 maanden.
 * Zonder enige datum: null (de lead wordt dan nooit gewist).
 */
export function laatsteActiviteitDatum(lead, nu) {
  if (!lead) return null;
  const vandaag = nu === undefined ? null : dagVan(new Date(nu).toISOString());
  const dagen = [dagVan(lead.geimporteerdOp), dagVan(lead.gewijzigdOp), dagVan(lead.eerderVerwijderd?.op), dagVan(lead.resultaat?.op)];
  if (Array.isArray(lead.bezoeken)) {
    for (const b of lead.bezoeken) {
      dagen.push(dagVan(b?.op));
      const d = dagVan(b?.datum);
      dagen.push(d && vandaag && d > vandaag ? vandaag : d);
    }
  }
  const gevonden = dagen.filter(Boolean);
  return gevonden.length ? gevonden.reduce((a, b) => (b > a ? b : a)) : null;
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

// Een lead met een voorgesteld of bevestigd bezoek van vandaag of later is duidelijk nog in behandeling.
const heeftToekomstigeAfspraak = (lead, vandaag) => (lead?.status === 'voorgesteld' || lead?.status === 'bevestigd') && (dagVan(lead.planning?.datum) ?? '') >= vandaag;

/** Wist leads zonder activiteit in de laatste 12 maanden, blokken en grafstenen ouder dan 12 maanden. Muteert de invoer niet. */
export function ruimOp(data, nu) {
  const grens = grensDag(nu);
  const vandaag = dagVan(new Date(nu).toISOString());
  const leads = Array.isArray(data?.leads) ? data.leads : [];
  const blokken = Array.isArray(data?.blokken) ? data.blokken : [];
  const grafstenen = Array.isArray(data?.grafstenen) ? data.grafstenen : [];
  const gewist = [];
  const bewaard = [];
  for (const lead of leads) {
    const dag = laatsteActiviteitDatum(lead, nu);
    if (dag && dag < grens && !heeftToekomstigeAfspraak(lead, vandaag)) gewist.push(lead.id);
    else bewaard.push(structuredClone(lead));
  }
  const blokBewaard = blokken.filter(b => {
    const dag = dagVan(b?.datum);
    return !(dag && dag < grens);
  }).map(b => structuredClone(b));
  const grafBewaard = grafstenen.filter(g => {
    const dag = dagVan(g?.op);
    return !(dag && dag < grens);
  }).map(g => structuredClone(g));
  const { leads: _l, blokken: _b, grafstenen: _g, ...rest } = data ?? {};
  return {
    data: { ...structuredClone(rest), leads: bewaard, blokken: blokBewaard, grafstenen: grafBewaard },
    gewist,
    blokkenGewist: blokken.length - blokBewaard.length,
    grafstenenGewist: grafstenen.length - grafBewaard.length,
  };
}

const SYSTEEM = Object.freeze({ id: 'systeem', naam: 'Systeem' });
const PREFIX = 'sales/';

/**
 * Ruimt ALLE verkoperblobs `sales/*` van `store` op (ook van geblokkeerde of verwijderde verkopers): per blob `ruimOp`, enkel een
 * schrijfactie bij wijziging (idempotent), en per blob met gewiste leads één logregel (enkel een aantal, door Systeem) in `logStore`
 * (standaard `store`; `null` = niet loggen, voor de testopslag). Een blob die faalt stopt de rest niet; het aantal mislukte blobs staat dan
 * als `mislukt` in het resultaat.
 * -> { gewist, blokkenGewist, grafstenenGewist, mislukt? }
 */
export async function ruimAllesOp({ store, nu, logStore = store }) {
  const { blobs = [] } = (await store.list({ prefix: PREFIX })) ?? {};
  let gewist = 0;
  let blokkenGewist = 0;
  let grafstenenGewist = 0;
  let mislukt = 0;
  for (const { key } of blobs) {
    const verkoperId = key.slice(PREFIX.length);
    if (!verkoperId) continue;
    try {
      const uitkomst = await muteerSales(store, verkoperId, {
        wijzig: data => {
          const r = ruimOp(data, nu);
          if (r.gewist.length === 0 && r.blokkenGewist === 0 && r.grafstenenGewist === 0) return null;
          return { data: r.data, extra: { aantal: r.gewist.length, blokken: r.blokkenGewist, grafstenen: r.grafstenenGewist } };
        },
      });
      if (uitkomst.status === 'storing') { mislukt++; console.error('[sales-opruimen] blob niet bewaard'); continue; }
      if (uitkomst.status !== 'ok') continue;
      gewist += uitkomst.extra.aantal;
      blokkenGewist += uitkomst.extra.blokken;
      grafstenenGewist += uitkomst.extra.grafstenen;
      if (uitkomst.extra.aantal > 0 && logStore) {
        await logActiviteit(logStore, {
          gebruiker: SYSTEEM, actie: 'sales-lead-verwijderd', onderwerp: verkoperId, details: { aantal: uitkomst.extra.aantal },
        }, { nu: () => nu });
      }
    } catch (e) {
      mislukt++;
      console.error('[sales-opruimen] blob mislukt (' + (e?.name || 'Error') + ')');
    }
  }
  return { gewist, blokkenGewist, grafstenenGewist, ...(mislukt ? { mislukt } : {}) };
}
