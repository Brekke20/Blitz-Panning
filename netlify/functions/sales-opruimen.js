// Dagelijkse opruiming van de verkoperblobs: wist afgewerkte leads en grafstenen ouder dan 12 maanden (alle `sales/*`).
// Geplande functie zonder `config.path` (niet via een URL bedoeld). Idempotent en onschadelijk als hij toch van buitenaf
// wordt aangeroepen: er wordt enkel gewist wat al verouderd is, nooit iets anders. Rij 'open' in de rechtentabel (de
// scheduler draagt geen sessie), zoals `activiteit-opruimen`. Antwoorden en logs bevatten nooit persoonsgegevens.
import { getStore } from '@netlify/blobs';
import { ruimAllesOp } from '../lib/sales-opruimen.js';
import { authStore } from '../lib/auth-antwoord.js';

const json = (status, obj) => new Response(JSON.stringify(obj), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

export function maakOpruimHandler({ getStore: haalStore, nu = () => Date.now() } = {}) {
  return async () => {
    try {
      const r = await ruimAllesOp({ store: await authStore(haalStore), nu: nu() });
      if (r.gewist || r.grafstenenGewist) console.log(`[sales-opruimen] ${r.gewist} lead(s) en ${r.grafstenenGewist} grafsteen(en) gewist`);
      if (r.mislukt) return json(500, { ...r, error: 'Opruimen was niet overal gelukt.' });
      return json(200, r);
    } catch (e) {
      console.error('[sales-opruimen] mislukt (' + (e?.name || 'Error') + ')');
      return json(500, { error: 'Opruimen mislukt.' });
    }
  };
}

export default async () => maakOpruimHandler({ getStore })();

export const config = { schedule: '@daily' };
