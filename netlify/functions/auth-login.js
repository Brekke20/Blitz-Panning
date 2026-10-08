// POST /api/auth-login { email, wachtwoord }
//   200 { gebruiker, moetWachtwoordWijzigen } + Set-Cookie | 401 (altijd dezelfde tekst) | 429 { error, opnieuwOp }
// Verraadt nooit of een e-mailadres bestaat: onbekend adres doet een schijn-verificatie en geeft dezelfde 401
// en dezelfde vergrendeling. Een mislukte teller-opslag telt als vergrendeld (fail closed).
import { getStore } from '@netlify/blobs';
import { verifieerWachtwoord, SCHIJN_HASH } from '../lib/wachtwoord.js';
import { normaliseerEmail, leesGebruikers, publiek, schrijfLaatsteLogin } from '../lib/gebruikers.js';
import { leesPogingen, wijzigPogingen, isVergrendeld, registreerMislukt, wisPogingen } from '../lib/vergrendeling.js';
import { logActiviteit } from '../lib/activiteit.js';
import {
  authJson, authOpties, authNietToegestaan, authStore, nieuweSessieCookie, OPSLAG_STORING,
} from '../lib/auth-antwoord.js';

const ONJUIST = { error: 'Onjuist e-mailadres of wachtwoord' };
const VERGRENDELD_TEKST = 'Te veel mislukte pogingen. Probeer het later opnieuw.';
const VERGRENDELING_MS = 15 * 60 * 1000;
const SYSTEEM = { id: 'systeem', naam: 'Systeem' };

const vergrendeld = tot => authJson(429, { error: VERGRENDELD_TEKST, opnieuwOp: new Date(tot).toISOString() });

export function maakHandler({ getStore: haalStore, env = process.env, nu = () => Date.now() }) {
  return async (req) => {
    if (req.method === 'OPTIONS') return authOpties();
    if (req.method !== 'POST') return authNietToegestaan();

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
      const slot = isVergrendeld(await leesPogingen(store), 'login', email, nu());
      if (slot.vergrendeld) return vergrendeld(slot.tot);
      record = (await leesGebruikers(store)).find(g => g && g.email === email);
    } catch (e) {
      console.error('auth-login: opslag niet bereikbaar (' + (e?.name || 'Error') + ')');
      return authJson(503, OPSLAG_STORING);
    }

    // Altijd precies één scrypt-verificatie: bij een onbekend adres tegen een schijn-hash.
    const hash = typeof record?.wachtwoordHash === 'string' ? record.wachtwoordHash : SCHIJN_HASH;
    const juist = await verifieerWachtwoord(body.wachtwoord, hash);
    const geslaagd = Boolean(record) && juist && record.actief === true && Number.isInteger(record.sessieVersie);

    if (!geslaagd) {
      let nieuweVergrendeling = false;
      let ok = false;
      let tot = nu() + VERGRENDELING_MS;
      try {
        const r = await wijzigPogingen(store, staat => {
          const m = registreerMislukt(staat, 'login', email, nu());
          nieuweVergrendeling = m.vergrendeldNu;
          return m.staat;
        });
        ok = r.ok === true;
        const slot = isVergrendeld(r.staat, 'login', email, nu());
        if (slot.vergrendeld) tot = slot.tot;
      } catch (e) {
        console.error('auth-login: pogingenteller niet bewaard (' + (e?.name || 'Error') + ')');
      }
      if (!ok) return vergrendeld(tot); // fail closed: kan de poging niet geteld worden, dan geen nieuwe pogingen
      if (nieuweVergrendeling) {
        await logActiviteit(store, { gebruiker: SYSTEEM, actie: 'login-mislukt-reeks', onderwerp: email.slice(0, 100) }, { nu });
      }
      return authJson(401, ONJUIST);
    }

    try {
      await wijzigPogingen(store, staat => wisPogingen(staat, 'login', email));
    } catch (e) {
      console.error('auth-login: pogingen niet gewist (' + (e?.name || 'Error') + ')');
    }
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
