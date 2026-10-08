// GET /api/auth-ik -> 200 { gebruiker, rechten, moetWachtwoordWijzigen, lokaleDev } (verlengt de cookie)
//                  |  401 { error, code: 'niet-ingelogd', setupNodig }
// Achter de wrapper (rij met ookBijWijzigen: ook wie nog een wachtwoord moet wijzigen mag dit opvragen).
// De wrapper kent `setupNodig` niet: een 401 wordt hier aangevuld.
import { getStore } from '@netlify/blobs';
import { beveiligV2 } from '../lib/beveiligd.js';
import { rechtenVoor } from '../lib/rechten.js';
import { isLokaleDev } from '../lib/lokale-dev.js';
import { controleerToken, COOKIE_NAAM, VERLENG_ONDER_S } from '../lib/sessie-token.js';
import { leesCookie } from '../lib/verzoek.js';
import { leesGebruikers } from '../lib/gebruikers.js';
import { authJson, authStore, nieuweSessieCookie } from '../lib/auth-antwoord.js';

// `auth` (optioneel) vervangt de standaardcontrole van de wrapper; tests geven een eigen instantie mee.
export function maakHandler({ getStore: haalStore, env = process.env, nu = () => Date.now(), auth } = {}) {
  const kern = async (req, _context, gebruiker) => {
    const nuMs = nu();
    const nuS = Math.floor(nuMs / 1000);
    const record = (await leesGebruikers(await authStore(haalStore))).find(g => g && g.id === gebruiker.id);
    let cookie;
    const claims = controleerToken(leesCookie(req, COOKIE_NAAM), env.SESSIE_GEHEIM, nuS);
    if (claims && claims.exp - nuS < VERLENG_ONDER_S) {
      cookie = nieuweSessieCookie({ uid: claims.uid, sv: claims.sv }, env, nuMs);
    }
    return authJson(200, {
      gebruiker,
      rechten: rechtenVoor(gebruiker),
      moetWachtwoordWijzigen: record?.moetWachtwoordWijzigen === true,
      lokaleDev: isLokaleDev(env),
    }, { cookie });
  };
  const beveiligd = beveiligV2('auth-ik', kern, auth ? { auth } : undefined);

  async function setupNodig() {
    try {
      if (typeof env.BEHEER_SETUP_CODE !== 'string' || env.BEHEER_SETUP_CODE === '') return false;
      return (await leesGebruikers(await authStore(haalStore))).length === 0;
    } catch {
      return false;
    }
  }

  return async (req, context) => {
    const antwoord = await beveiligd(req, context);
    if (antwoord.status !== 401) return antwoord;
    return authJson(401, { error: 'Niet ingelogd.', code: 'niet-ingelogd', setupNodig: await setupNodig() });
  };
}

export default maakHandler({ getStore });

export const config = { path: '/api/auth-ik' };
