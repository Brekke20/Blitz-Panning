// POST /api/auth-wachtwoord { huidig, nieuw } -> 200 { ok: true } + verse cookie (sessieVersie + 1)
// Achter de wrapper (ookBijWijzigen: ook wie het wachtwoord nog moet wijzigen mag dit). Een fout huidig
// wachtwoord geeft 400 (NIET 401: dat zou de client in een herinlog-lus brengen) en telt als mislukte
// loginpoging (zelfde teller als auth-login, dus ook hier geen onbeperkt raden met een gestolen sessie).
import { getStore } from '@netlify/blobs';
import { beveiligV2 } from '../lib/beveiligd.js';
import { verifieerWachtwoord, hashWachtwoord, beleidsFout } from '../lib/wachtwoord.js';
import { leesGebruikers, wijzigGebruikers } from '../lib/gebruikers.js';
import { leesPogingen, wijzigPogingen, isVergrendeld, registreerMislukt, wisPogingen } from '../lib/vergrendeling.js';
import { logActiviteit } from '../lib/activiteit.js';
import { authJson, authStore, nieuweSessieCookie, OPSLAG_STORING } from '../lib/auth-antwoord.js';

const VERGRENDELD_TEKST = 'Te veel mislukte pogingen. Probeer het later opnieuw.';
const VERGRENDELING_MS = 15 * 60 * 1000;

const vergrendeld = tot => authJson(429, { error: VERGRENDELD_TEKST, opnieuwOp: new Date(tot).toISOString() });

export function maakHandler({ getStore: haalStore, env = process.env, nu = () => Date.now(), auth } = {}) {
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
      if (record) {
        const slot = isVergrendeld(await leesPogingen(store), 'login', record.email, nu());
        if (slot.vergrendeld) return vergrendeld(slot.tot);
      }
    } catch (e) {
      console.error('auth-wachtwoord: opslag niet bereikbaar (' + (e?.name || 'Error') + ')');
      return authJson(503, OPSLAG_STORING);
    }
    if (!record || typeof record.wachtwoordHash !== 'string') {
      return authJson(400, { error: 'Het wachtwoord van dit account kan niet gewijzigd worden.' });
    }

    if (!(await verifieerWachtwoord(huidig, record.wachtwoordHash))) {
      let ok = false;
      let tot = nu() + VERGRENDELING_MS;
      try {
        const r = await wijzigPogingen(store, staat => registreerMislukt(staat, 'login', record.email, nu()).staat);
        ok = r.ok === true;
        const slot = isVergrendeld(r.staat, 'login', record.email, nu());
        if (slot.vergrendeld) tot = slot.tot;
      } catch (e) {
        console.error('auth-wachtwoord: pogingenteller niet bewaard (' + (e?.name || 'Error') + ')');
      }
      if (!ok) return vergrendeld(tot); // fail closed
      return authJson(400, { error: 'Het huidige wachtwoord is onjuist.' });
    }

    const nieuweHash = await hashWachtwoord(nieuw);
    let intussenGewijzigd = false;
    let r;
    try {
      r = await wijzigGebruikers(store, lijst => {
        intussenGewijzigd = false;
        const i = lijst.findIndex(g => g && g.id === record.id);
        if (i < 0) return null;
        // Een gelijktijdige wijziging (ander wachtwoord of reset) niet stilzwijgend overschrijven.
        if (lijst[i].wachtwoordHash !== record.wachtwoordHash) { intussenGewijzigd = true; return null; }
        const kopie = [...lijst];
        kopie[i] = { ...lijst[i], wachtwoordHash: nieuweHash, sessieVersie: (lijst[i].sessieVersie ?? 0) + 1, moetWachtwoordWijzigen: false };
        return kopie;
      });
    } catch (e) {
      console.error('auth-wachtwoord: gebruikers niet bewaard (' + (e?.name || 'Error') + ')');
      return authJson(503, OPSLAG_STORING);
    }
    if (intussenGewijzigd) return authJson(409, { error: 'Het wachtwoord is intussen gewijzigd. Log opnieuw in.' });
    const bewaard = r.ok ? r.gebruikers.find(g => g && g.id === record.id) : null;
    if (!bewaard || bewaard.wachtwoordHash !== nieuweHash || !Number.isInteger(bewaard.sessieVersie)) {
      return authJson(503, OPSLAG_STORING);
    }

    try {
      await wijzigPogingen(store, staat => wisPogingen(staat, 'login', record.email));
    } catch (e) {
      console.error('auth-wachtwoord: pogingen niet gewist (' + (e?.name || 'Error') + ')');
    }
    await logActiviteit(store, { gebruiker, actie: 'wachtwoord-gewijzigd' }, { nu });
    return authJson(200, { ok: true }, {
      cookie: nieuweSessieCookie({ uid: record.id, sv: bewaard.sessieVersie }, env, nu()),
    });
  };
  return beveiligV2('auth-wachtwoord', kern, auth ? { auth } : undefined);
}

export default maakHandler({ getStore });

export const config = { path: '/api/auth-wachtwoord' };
