// POST /api/auth-wachtwoord { huidig, nieuw } -> 200 { ok: true } + verse cookie (sessieVersie + 1)
// Achter de wrapper (ookBijWijzigen: ook wie het wachtwoord nog moet wijzigen mag dit). Een fout huidig
// wachtwoord geeft 400 (NIET 401: dat zou de client in een herinlog-lus brengen) en telt als mislukte
// loginpoging (zelfde teller als auth-login, dus ook hier geen onbeperkt raden met een gestolen sessie);
// de poging wordt gereserveerd VOOR scrypt, zodat een parallelle stoot de vergrendeling niet omzeilt.
import { getStore } from '@netlify/blobs';
import { beveiligV2 } from '../lib/beveiligd.js';
import { verifieerWachtwoord, hashWachtwoord, beleidsFout } from '../lib/wachtwoord.js';
import { leesGebruikers, wijzigGebruikers } from '../lib/gebruikers.js';
import { reserveerPoging, wisPoging } from '../lib/login-poging.js';
import { serieelGebruikers } from '../lib/herstel.js';
import { logActiviteit } from '../lib/activiteit.js';
import { authJson, authStore, nieuweSessieCookie, OPSLAG_STORING } from '../lib/auth-antwoord.js';

const VERGRENDELD_TEKST = 'Te veel mislukte pogingen. Probeer het later opnieuw.';

const vergrendeld = tot => authJson(429, { error: VERGRENDELD_TEKST, opnieuwOp: new Date(tot).toISOString() });

// `verifieer` is een testseam (telt de scrypt-uitvoeringen).
export function maakHandler({ getStore: haalStore, env = process.env, nu = () => Date.now(), auth, verifieer = verifieerWachtwoord } = {}) {
  const kern = async (req, _context, gebruiker) => {
    let body;
    try { body = await req.json(); } catch { return authJson(400, { error: 'Ongeldige JSON' }); }
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || typeof body.huidig !== 'string' || typeof body.nieuw !== 'string') {
      return authJson(400, { error: 'Huidig en nieuw wachtwoord zijn verplicht.' });
    }
    const { huidig, nieuw } = body;
    const fout = beleidsFout(nieuw);
    if (fout) return authJson(400, { error: fout });
    if (nieuw === huidig) return authJson(400, { error: 'Het nieuwe wachtwoord moet verschillen van het huidige.' });

    let store, record;
    try {
      store = await authStore(haalStore);
      record = (await leesGebruikers(store)).find(g => g && g.id === gebruiker.id);
    } catch (e) {
      console.error('auth-wachtwoord: opslag niet bereikbaar (' + (e?.name || 'Error') + ')');
      return authJson(503, OPSLAG_STORING);
    }
    if (!record || typeof record.wachtwoordHash !== 'string') {
      return authJson(400, { error: 'Het wachtwoord van dit account kan niet gewijzigd worden.' });
    }

    // Reserveer de poging vóór scrypt; enkel een al actieve vergrendeling (of onbereikbare teller) = 429 zonder scrypt.
    // Haalt DEZE poging de limiet, dan wordt "huidig" nog gecontroleerd (juist = slagen en teller wissen).
    const reservering = await reserveerPoging(store, record.email, nu());
    if (!reservering.toegelaten) return vergrendeld(reservering.tot);
    if (!(await verifieer(huidig, record.wachtwoordHash))) {
      if (reservering.nieuweVergrendeling) {
        await logActiviteit(store, { gebruiker, actie: 'login-mislukt-reeks' }, { nu });
      }
      return authJson(400, { error: 'Het huidige wachtwoord is onjuist.' }); // de poging is al geteld
    }

    const nieuweHash = await hashWachtwoord(nieuw);
    let intussenGewijzigd = false;
    let r;
    try {
      r = await serieelGebruikers(() => wijzigGebruikers(store, lijst => {
        intussenGewijzigd = false;
        const i = lijst.findIndex(g => g && g.id === record.id);
        if (i < 0) return null;
        // Een gelijktijdige wijziging (ander wachtwoord of reset) niet stilzwijgend overschrijven.
        if (lijst[i].wachtwoordHash !== record.wachtwoordHash) { intussenGewijzigd = true; return null; }
        const kopie = [...lijst];
        kopie[i] = { ...lijst[i], wachtwoordHash: nieuweHash, sessieVersie: (lijst[i].sessieVersie ?? 0) + 1, moetWachtwoordWijzigen: false };
        return kopie;
      }));
    } catch (e) {
      console.error('auth-wachtwoord: gebruikers niet bewaard (' + (e?.name || 'Error') + ')');
      return authJson(503, OPSLAG_STORING);
    }
    if (intussenGewijzigd) return authJson(409, { error: 'Het wachtwoord is intussen gewijzigd. Log opnieuw in.' });
    const bewaard = r.ok ? r.gebruikers.find(g => g && g.id === record.id) : null;
    if (!bewaard || bewaard.wachtwoordHash !== nieuweHash || !Number.isInteger(bewaard.sessieVersie)) {
      return authJson(503, OPSLAG_STORING);
    }

    await wisPoging(store, record.email);
    await logActiviteit(store, { gebruiker, actie: 'wachtwoord-gewijzigd' }, { nu });
    return authJson(200, { ok: true }, {
      cookie: nieuweSessieCookie({ uid: record.id, sv: bewaard.sessieVersie }, env, nu()),
    });
  };
  return beveiligV2('auth-wachtwoord', kern, auth ? { auth } : undefined);
}

export default maakHandler({ getStore });

export const config = { path: '/api/auth-wachtwoord' };
