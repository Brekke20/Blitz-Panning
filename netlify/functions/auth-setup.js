// POST /api/auth-setup { setupCode, email, naam, wachtwoord } -> eerste beheerder aanmaken.
//   200 { gebruiker, herstelcodes: [10] } + Set-Cookie | 400 | 403 (code fout/ontbreekt) | 409 (er is al een gebruiker) | 429
// Werkt enkel met env BEHEER_SETUP_CODE (ontbreekt of leeg = altijd 403) en enkel zolang er 0 gebruikers zijn
// (opnieuw gecontroleerd BINNEN de schrijfactie, zodat twee gelijktijdige setups niet allebei slagen).
// De herstelcodes worden enkel als hashes bewaard en worden nu eenmalig getoond.
// Gokken op de setupcode: 5 foute pogingen -> 1 uur vergrendeld (zelfde teller als herstel, sleutel 'setup:globaal').
import { getStore } from '@netlify/blobs';
import { createHash, timingSafeEqual } from 'node:crypto';
import { hashWachtwoord, beleidsFout } from '../lib/wachtwoord.js';
import { valideerNieuweGebruiker, leesGebruikers, wijzigGebruikers, publiek, nieuwId } from '../lib/gebruikers.js';
import { reserveerPoging, wisPoging } from '../lib/login-poging.js';
import { maakHerstelcodes, serieelGebruikers } from '../lib/herstel.js';
import { logActiviteit } from '../lib/activiteit.js';
import {
  authJson, authOpties, authNietToegestaan, authStore, nieuweSessieCookie, eisCsrfKop, OPSLAG_STORING,
} from '../lib/auth-antwoord.js';

const SLEUTEL = 'setup:globaal'; // bevat geen '@': botst nooit met een genormaliseerd e-mailadres
const GEWEIGERD = { error: 'Verzoek geweigerd.', code: 'geen-recht' };
const AL_AANGEMAAKT = { error: 'Er is al een gebruiker aangemaakt.' };
const VERGRENDELD_TEKST = 'Te veel mislukte pogingen. Probeer het later opnieuw.';

const sha256 = t => createHash('sha256').update(String(t)).digest();
const vergrendeld = tot => authJson(429, { error: VERGRENDELD_TEKST, opnieuwOp: new Date(tot).toISOString() });

export function maakHandler({ getStore: haalStore, env = process.env, nu = () => Date.now() } = {}) {
  return async (req) => {
    if (req.method === 'OPTIONS') return authOpties();
    if (req.method !== 'POST') return authNietToegestaan();
    const csrf = eisCsrfKop(req);
    if (csrf) return csrf;

    let body;
    try { body = await req.json(); } catch { return authJson(400, { error: 'Ongeldige JSON' }); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return authJson(400, { error: 'Ongeldige invoer.' });

    // Fail closed: zonder (of met lege) BEHEER_SETUP_CODE is setup nooit toegelaten.
    const verwacht = env.BEHEER_SETUP_CODE;
    if (typeof verwacht !== 'string' || verwacht === '') return authJson(403, GEWEIGERD);
    if (typeof env.SESSIE_GEHEIM !== 'string' || env.SESSIE_GEHEIM === '') {
      console.error('auth-setup: SESSIE_GEHEIM ontbreekt');
      return authJson(500, { error: 'Instellen is niet beschikbaar.' });
    }

    let store;
    try {
      store = await authStore(haalStore);
    } catch (e) {
      console.error('auth-setup: opslag niet bereikbaar (' + (e?.name || 'Error') + ')');
      return authJson(503, OPSLAG_STORING);
    }

    const reservering = await reserveerPoging(store, SLEUTEL, nu(), 'herstel');
    if (!reservering.toegelaten) return vergrendeld(reservering.tot);
    const gegeven = typeof body.setupCode === 'string' ? body.setupCode : '';
    if (!timingSafeEqual(sha256(gegeven), sha256(verwacht))) return authJson(403, GEWEIGERD);

    try {
      if ((await leesGebruikers(store)).length > 0) return authJson(409, AL_AANGEMAAKT);
    } catch (e) {
      console.error('auth-setup: opslag niet bereikbaar (' + (e?.name || 'Error') + ')');
      return authJson(503, OPSLAG_STORING);
    }

    const geldig = valideerNieuweGebruiker({ email: body.email, naam: body.naam, rol: 'beheerder' });
    if (geldig.fout) return authJson(400, { error: geldig.fout });
    const fout = beleidsFout(body.wachtwoord);
    if (fout) return authJson(400, { error: fout });

    const [wachtwoordHash, { codes, hashes }] = await Promise.all([hashWachtwoord(body.wachtwoord), maakHerstelcodes()]);
    const nieuw = {
      id: nieuwId(), ...geldig.waarden, actief: true, wachtwoordHash, moetWachtwoordWijzigen: false,
      sessieVersie: 1, herstelcodes: hashes, aangemaakt: new Date(nu()).toISOString(),
    };

    let bezet = false;
    let r;
    try {
      r = await serieelGebruikers(() => wijzigGebruikers(store, lijst => {
        bezet = lijst.length > 0; // opnieuw controleren BINNEN de schrijfactie
        return bezet ? null : [nieuw];
      }));
    } catch (e) {
      console.error('auth-setup: gebruikers niet bewaard (' + (e?.name || 'Error') + ')');
      return authJson(503, OPSLAG_STORING);
    }
    if (bezet) return authJson(409, AL_AANGEMAAKT);
    // Na het schrijven moet precies onze beheerder bewaard zijn (een gelijktijdige schrijver in een andere
    // instantie kan hem overschreven hebben: dan geen cookie voor een spookaccount).
    if (!r.ok) return authJson(503, OPSLAG_STORING);
    if (r.gebruikers.length !== 1 || r.gebruikers[0]?.id !== nieuw.id) return authJson(409, AL_AANGEMAAKT);

    await wisPoging(store, SLEUTEL, 'herstel');
    const gebruiker = publiek(nieuw);
    await logActiviteit(store, { gebruiker, actie: 'gebruiker-aangemaakt', onderwerp: nieuw.email, details: 'eerste beheerder' }, { nu });
    return authJson(200, { gebruiker, herstelcodes: codes }, {
      cookie: nieuweSessieCookie({ uid: nieuw.id, sv: nieuw.sessieVersie }, env, nu()),
    });
  };
}

export default maakHandler({ getStore });

export const config = { path: '/api/auth-setup' };
