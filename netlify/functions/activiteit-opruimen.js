// Dagelijkse opruiming van het activiteitenlog: verwijdert maand-blobs ouder dan 12 maanden.
// Idempotent en onschadelijk (een aanroep van buitenaf wist enkel wat al verouderd is): rij 'open' in de rechtentabel.
import { getStore } from '@netlify/blobs';
import { ruimActiviteitOp } from '../lib/activiteit.js';
import { authStore } from '../lib/auth-antwoord.js';

const json = (status, obj) => new Response(JSON.stringify(obj), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

export function maakOpruimHandler({ getStore: haalStore, nu = () => Date.now() } = {}) {
  return async () => {
    try {
      const verwijderd = await ruimActiviteitOp(authStore(haalStore), { nu: nu(), maanden: 12 });
      if (verwijderd.length) console.log(`[activiteit-opruimen] ${verwijderd.length} maand(en) verwijderd`);
      return json(200, { verwijderd });
    } catch (e) {
      console.error('[activiteit-opruimen] mislukt (' + (e?.name || 'Error') + ')');
      return json(500, { error: 'Opruimen mislukt.' });
    }
  };
}

export default async () => maakOpruimHandler({ getStore })();

export const config = { schedule: '@daily' };
