// POST /api/auth-login { email, wachtwoord }
//   200 { gebruiker, moetWachtwoordWijzigen } + Set-Cookie | 401 (altijd dezelfde tekst) | 429 { error, opnieuwOp }
// Verraadt nooit of een e-mailadres bestaat: onbekend adres doet een schijn-verificatie en geeft dezelfde 401
// en dezelfde vergrendeling. Een mislukte teller-opslag telt als vergrendeld (fail closed).
import { getStore } from '@netlify/blobs';
import { verifieerWachtwoord, SCHIJN_HASH } from '../lib/wachtwoord.js';
import { normaliseerEmail, leesGebruikers, publiek, schrijfLaatsteLogin, ROLLEN_LIJST } from '../lib/gebruikers.js';
import { reserveerPoging, wisPoging, maskeerEmail } from '../lib/login-poging.js';
import { logActiviteit } from '../lib/activiteit.js';
import {
  authJson, authOpties, authNietToegestaan, authStore, nieuweSessieCookie, eisCsrfKop, OPSLAG_STORING,
} from '../lib/auth-antwoord.js';

const ONJUIST = { error: 'Onjuist e-mailadres of wachtwoord' };
const VERGRENDELD_TEKST = 'Te veel mislukte pogingen. Probeer het later opnieuw.';
const SYSTEEM = { id: 'systeem', naam: 'Systeem' };

const vergrendeld = tot => authJson(429, { error: VERGRENDELD_TEKST, opnieuwOp: new Date(tot).toISOString() });

// `verifieer` is een testseam (telt de scrypt-uitvoeringen).
export function maakHandler({ getStore: haalStore, env = process.env, nu = () => Date.now(), verifieer = verifieerWachtwoord }) {
  return async (req) => {
    if (req.method === 'OPTIONS') return authOpties();
    if (req.method !== 'POST') return authNietToegestaan();
    const csrf = eisCsrfKop(req);
    if (csrf) return csrf;

    let body;
    try { body = await req.json(); } catch { return authJson(400, { error: 'Ongeldige JSON' }); }
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || typeof body.email !== 'string' || typeof body.wachtwoord !== 'string') {
      return authJson(400, { error: 'E-mailadres en wachtwoord zijn verplicht.' });
    }
    if (typeof env.SESSIE_GEHEIM !== 'string' || env.SESSIE_GEHEIM === '') {
      console.error('auth-login: SESSIE_GEHEIM ontbreekt');
      return authJson(500, { error: 'Inloggen is niet beschikbaar.' });
    }

    const email = normaliseerEmail(body.email);
    let store, record;
    try {
      store = await authStore(haalStore);
      record = (await leesGebruikers(store)).find(g => g && g.email === email);
    } catch (e) {
      console.error('auth-login: opslag niet bereikbaar (' + (e?.name || 'Error') + ')');
      return authJson(503, OPSLAG_STORING);
    }

    // De poging wordt GERESERVEERD vóór scrypt: een parallelle stoot kan de vergrendeling zo niet omzeilen.
    // Enkel een al actieve vergrendeling (of een onbereikbare teller) geeft 429 zonder scrypt; haalt DEZE poging
    // de limiet, dan wordt het wachtwoord nog gecontroleerd (een juiste 5e poging slaagt en wist de teller).
    const reservering = await reserveerPoging(store, email, nu());
    if (!reservering.toegelaten) return vergrendeld(reservering.tot);

    // Precies één scrypt-verificatie: bij een onbekend adres tegen een schijn-hash.
    const hash = typeof record?.wachtwoordHash === 'string' ? record.wachtwoordHash : SCHIJN_HASH;
    const juist = await verifieer(body.wachtwoord, hash);
    const geslaagd = Boolean(record) && juist && record.actief === true
      && Number.isInteger(record.sessieVersie) && ROLLEN_LIJST.includes(record.rol);
    if (!geslaagd) {
      // de poging is al geteld; de vergrendeling die ze veroorzaakte blijft staan
      if (reservering.nieuweVergrendeling) {
        await logActiviteit(store, record
          ? { gebruiker: publiek(record), actie: 'login-mislukt-reeks' }
          : { gebruiker: SYSTEEM, actie: 'login-mislukt-reeks', onderwerp: maskeerEmail(email) }, { nu });
      }
      return authJson(401, ONJUIST);
    }

    await wisPoging(store, email);
    try {
      await schrijfLaatsteLogin(store, record.id, new Date(nu()).toISOString());
    } catch (e) {
      console.error('auth-login: laatste login niet bewaard (' + (e?.name || 'Error') + ')');
    }
    const gebruiker = publiek(record);
    await logActiviteit(store, { gebruiker, actie: 'login' }, { nu });
    return authJson(200, { gebruiker, moetWachtwoordWijzigen: record.moetWachtwoordWijzigen === true }, {
      cookie: nieuweSessieCookie({ uid: record.id, sv: record.sessieVersie }, env, nu()),
    });
  };
}

export default maakHandler({ getStore });

export const config = { path: '/api/auth-login' };
