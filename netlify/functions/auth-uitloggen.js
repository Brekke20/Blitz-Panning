// POST /api/auth-uitloggen -> 200 { ok: true } + cookie gewist. Werkt ook zonder (geldige) sessie;
// logt 'uitloggen' enkel als er een geldige sessie was.
import { getStore } from '@netlify/blobs';
import { controleerToken, COOKIE_NAAM } from '../lib/sessie-token.js';
import { leesCookie } from '../lib/verzoek.js';
import { leesGebruikers, publiek } from '../lib/gebruikers.js';
import { logActiviteit } from '../lib/activiteit.js';
import { authJson, authOpties, authNietToegestaan, authStore, gewistCookie } from '../lib/auth-antwoord.js';

export function maakHandler({ getStore: haalStore, env = process.env, nu = () => Date.now() }) {
  return async (req) => {
    if (req.method === 'OPTIONS') return authOpties();
    if (req.method !== 'POST') return authNietToegestaan();

    // Best-effort: een fout of een ongeldige sessie mag het uitloggen nooit tegenhouden.
    try {
      const claims = controleerToken(leesCookie(req, COOKIE_NAAM), env.SESSIE_GEHEIM, Math.floor(nu() / 1000));
      if (claims) {
        const store = await authStore(haalStore);
        const record = (await leesGebruikers(store)).find(g => g && g.id === claims.uid && g.sessieVersie === claims.sv);
        if (record) await logActiviteit(store, { gebruiker: publiek(record), actie: 'uitloggen' }, { nu });
      }
    } catch (e) {
      console.error('auth-uitloggen: loggen mislukt (' + (e?.name || 'Error') + ')');
    }
    return authJson(200, { ok: true }, { cookie: gewistCookie(env) });
  };
}

export default maakHandler({ getStore });

export const config = { path: '/api/auth-uitloggen' };
