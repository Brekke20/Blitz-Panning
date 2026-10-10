// Sessiecontrole voor alle beveiligde functies: vereisGebruiker(reqOfEvent, opties).
// Fail-closed: elke fout, ontbrekend geheim of onverwachte vorm geeft een weigering (nooit een uitzondering,
// nooit een doorgelaten verzoek). Foutteksten bevatten nooit geheimen of interne details.
//
// Volgorde (de eerste die van toepassing is wint):
//   1. testrol (X-Blitz-Test + X-Blitz-Test-Rol) ENKEL in lokale dev (BLITZ_LOKALE_DEV, geen Netlify-runtime)
//   2. service-sleutel (enkel GET, enkel als de functie service:true vraagt)
//   3. sessiecookie -> token -> gebruiker uit de ECHTE store blitz-data (ook bij een testverzoek)
//   4. moetWachtwoordWijzigen   5. rol   6. X-Blitz (CSRF) bij schrijven
import { createHash, timingSafeEqual } from 'node:crypto';
import { controleerToken, COOKIE_NAAM } from './sessie-token.js';
import { kop, leesCookie } from './verzoek.js';
import { isTestVerzoek } from './testmodus.js';
import { ROLLEN_LIJST, leesGebruikers, publiek } from './gebruikers.js';
import { isLokaleDev, heeftNetlifyRuntime, TESTGEBRUIKERS } from './lokale-dev.js';
import { v1Json, v2Json } from './http.js';

export const ROLLEN = [...ROLLEN_LIJST];

const WEIGERINGEN = {
  'niet-ingelogd': { status: 401, fout: 'Niet ingelogd.' },
  'geen-recht': { status: 403, fout: 'Je hebt hier geen toegang toe.' },
  'csrf': { status: 403, fout: 'Verzoek geweigerd.' },
  'wachtwoord-wijzigen': { status: 403, fout: 'Je moet eerst je wachtwoord wijzigen.' },
  // Tijdelijke opslagstoring: geen toegang (fail-closed), maar de client moet NIET uitloggen en later opnieuw proberen.
  'opslag-storing': { status: 503, fout: 'De opslag is tijdelijk niet bereikbaar. Probeer het zo meteen opnieuw.' },
};
const weiger = code => ({ ok: false, ...WEIGERINGEN[code], code });

const sha = tekst => createHash('sha256').update(String(tekst)).digest();
function gelijk(a, b) {
  return timingSafeEqual(sha(a), sha(b));
}

function methode(reqOfEvent) {
  return String(reqOfEvent?.httpMethod ?? reqOfEvent?.method ?? '').toUpperCase();
}

// Lazy: @netlify/blobs wordt pas geladen als er echt een store nodig is (tests werken zonder Blobs-omgeving).
async function standaardGetStore(opties) {
  const { getStore } = await import('@netlify/blobs');
  return getStore(opties);
}

export function maakAuth({ getStore = standaardGetStore, env = process.env, nu = () => Date.now(), vasteGebruiker = null } = {}) {
  // De login-omzeiling (vasteGebruiker) is onmogelijk in een Netlify-runtime, ook niet via een directe maakAuth-aanroep.
  if (vasteGebruiker && heeftNetlifyRuntime(env)) throw new Error('vasteGebruiker is niet toegelaten in een Netlify-runtime');
  async function vereisGebruiker(reqOfEvent, { rollen = [], schrijven = false, ookBijWijzigen = false, service = false } = {}) {
    try {
      const rolOk = gebruiker => rollen.length === 0 || rollen.includes(gebruiker.rol);
      if (!Array.isArray(rollen)) return weiger('geen-recht');
      const csrfOk = () => kop(reqOfEvent, 'x-blitz') === '1';

      // Vaste gebruiker (testseam): slaat 1-4 en 6 over, houdt de rollencontrole.
      // Elke aanroep opnieuw gecontroleerd: een runtime-variabele die pas later verschijnt schakelt hem ook uit.
      if (vasteGebruiker && !heeftNetlifyRuntime(env)) {
        return rolOk(vasteGebruiker) ? { ok: true, gebruiker: { ...vasteGebruiker } } : weiger('geen-recht');
      }

      // 1. Testrol: enkel lokale dev, enkel met testverzoek-header en een bekende rol.
      if (isTestVerzoek(reqOfEvent) && isLokaleDev(env)) {
        const rol = kop(reqOfEvent, 'x-blitz-test-rol');
        if (typeof rol === 'string' && ROLLEN.includes(rol)) {
          const gebruiker = { ...TESTGEBRUIKERS[`test-${rol}`] };
          if (!rolOk(gebruiker)) return weiger('geen-recht');
          if (schrijven && !csrfOk()) return weiger('csrf');
          return { ok: true, gebruiker };
        }
      }

      // 2. Service-sleutel (planning-export): enkel GET, nooit schrijvend.
      if (service && !schrijven && methode(reqOfEvent) === 'GET') {
        const sleutel = env.PLANNING_EXPORT_API_KEY;
        const auth = kop(reqOfEvent, 'authorization');
        if (typeof sleutel === 'string' && sleutel !== '' && typeof auth === 'string' && auth.startsWith('Bearer ')) {
          const aangeboden = auth.slice('Bearer '.length);
          if (aangeboden !== '' && gelijk(aangeboden, sleutel)) {
            const gebruiker = { id: 'service-planning-export', rol: 'planner', naam: 'planning-export', email: '' };
            return rolOk(gebruiker) ? { ok: true, gebruiker } : weiger('geen-recht');
          }
        }
      }

      // 3. Sessiecookie.
      const geheim = env.SESSIE_GEHEIM;
      if (typeof geheim !== 'string' || geheim === '') return weiger('niet-ingelogd');
      const claims = controleerToken(leesCookie(reqOfEvent, COOKIE_NAAM), geheim, Math.floor(nu() / 1000));
      if (!claims) return weiger('niet-ingelogd');
      // Authenticatiegegevens staan altijd in de ECHTE store, ook bij een testverzoek.
      let gebruikers;
      try {
        const store = await getStore({ name: 'blitz-data', consistency: 'strong' });
        gebruikers = await leesGebruikers(store);
      } catch (e) {
        // Alleen het fouttype loggen: een Blobs-fout kan details bevatten.
        console.error('auth: opslag niet bereikbaar (' + (e?.name || 'Error') + ')');
        // TIJDELIJK (diagnose Deploy Preview, 2026-10-10): oorzaak in het antwoord; wordt weer verwijderd.
        const w = weiger('opslag-storing');
        const ev = reqOfEvent && typeof reqOfEvent === 'object' ? reqOfEvent : {};
        return { ...w, fout: w.fout + ' [diag ' + (e?.name || 'Error') + ': ' + String(e?.message || '').slice(0, 160)
          + ' | blobs=' + typeof ev.blobs + ' | ctx=' + (process.env.NETLIFY_BLOBS_CONTEXT ? 'ja' : 'nee') + ']' };
      }
      const record = gebruikers.find(g => g && g.id === claims.uid);
      if (!record || record.actief !== true || record.sessieVersie !== claims.sv) return weiger('niet-ingelogd');
      if (!ROLLEN.includes(record.rol)) return weiger('niet-ingelogd');

      // 4-6.
      if (record.moetWachtwoordWijzigen === true && !ookBijWijzigen) return weiger('wachtwoord-wijzigen');
      if (!rolOk(record)) return weiger('geen-recht');
      if (schrijven && !csrfOk()) return weiger('csrf');
      return { ok: true, gebruiker: publiek(record) };
    } catch (e) {
      // Alleen het fouttype loggen: een Blobs-fout kan details bevatten.
      console.error('auth: controle mislukt (' + (e?.name || 'Error') + ')');
      return weiger('niet-ingelogd');
    }
  }
  return { vereisGebruiker };
}

// ---- standaardinstantie + testseam ----
let instantie = null;
const huidig = () => (instantie ??= maakAuth());

export function vereisGebruiker(reqOfEvent, opties) {
  return huidig().vereisGebruiker(reqOfEvent, opties);
}

// Testseam: vervangt de standaardinstantie (bv. { vasteGebruiker }); null herstelt. Gooit in een Netlify-runtime,
// zodat een per ongeluk gedeployde aanroep nooit de login kan omzeilen.
export function zetAuthVoorTests(opties) {
  if (heeftNetlifyRuntime(process.env)) throw new Error('zetAuthVoorTests is niet toegelaten in een Netlify-runtime');
  instantie = opties ? maakAuth(opties) : null;
}

// ---- weigeringsantwoorden ----
const body = r => ({ error: r.fout, code: r.code });

export function weigeringV1(resultaat, cors) {
  return v1Json(resultaat.status, body(resultaat), cors);
}

export function weigeringV2(resultaat, cors) {
  return v2Json(resultaat.status, body(resultaat), cors);
}
