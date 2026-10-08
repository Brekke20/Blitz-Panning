// Gedeelde hulp voor de sessiefuncties (auth-login, auth-uitloggen, auth-ik, auth-wachtwoord).
import { maakCors } from './http.js';
import { isLokaleDev } from './lokale-dev.js';
import { maakSessieCookie, wisSessieCookie, ondertekenToken, SESSIE_LEVENSDUUR_S } from './sessie-token.js';

export const AUTH_CORS = Object.freeze(maakCors({
  methoden: 'GET, POST, OPTIONS', headers: 'Content-Type, X-Blitz', inhoudType: 'application/json',
}));

// JSON-antwoord; sessieantwoorden mogen nooit gecachet worden. Optioneel met Set-Cookie.
export function authJson(status, obj, { cookie } = {}) {
  const headers = { ...AUTH_CORS, 'Cache-Control': 'no-store' };
  if (cookie) headers['Set-Cookie'] = cookie;
  return new Response(JSON.stringify(obj), { status, headers });
}

export const authOpties = () => new Response(null, { status: 204, headers: AUTH_CORS });
export const authNietToegestaan = () => authJson(405, { error: 'Method not allowed' });

// Authenticatiegegevens staan altijd in de ECHTE store, ook bij een testverzoek.
export const authStore = getStore => getStore({ name: 'blitz-data', consistency: 'strong' });

// Secure weglaten enkel in lokale dev (http://localhost).
const secure = env => !isLokaleDev(env);
export const sessieCookie = (token, env) => maakSessieCookie(token, { secure: secure(env) });
export const gewistCookie = env => wisSessieCookie({ secure: secure(env) });

// Nieuw token voor een gebruiker, 30 dagen vanaf nu.
export function nieuweSessieCookie({ uid, sv }, env, nuMs) {
  const exp = Math.floor(nuMs / 1000) + SESSIE_LEVENSDUUR_S;
  return sessieCookie(ondertekenToken({ uid, sv, exp }, env.SESSIE_GEHEIM), env);
}

export const OPSLAG_STORING = Object.freeze({
  error: 'De opslag is tijdelijk niet bereikbaar. Probeer het zo meteen opnieuw.',
  code: 'opslag-storing',
});
