// POST /api/auth-herstel { email, bewijs, nieuwWachtwoord } waar `bewijs` een herstelcode OF de noodsleutel
// (env BEHEER_HERSTELSLEUTEL, ≥ 32 tekens, eenmalig) is.
//   200 { gebruiker, moetWachtwoordWijzigen:false } + Set-Cookie | 401 (altijd dezelfde tekst) | 429 { error, opnieuwOp }
// Enkel voor een actieve BEHEERDER; andere rollen, geblokkeerde en onbekende adressen krijgen dezelfde 401 en
// dezelfde vergrendeling als een fout bewijs (5 pogingen -> 1 uur). Een onbekend adres doet evenveel werk als een
// bekend (schijn-verificatie). De poging wordt gereserveerd VOOR de dure controle (zie login-poging.js).
import { getStore } from '@netlify/blobs';
import { hashWachtwoord, beleidsFout } from '../lib/wachtwoord.js';
import { normaliseerEmail, leesGebruikers, wijzigGebruikers, publiek } from '../lib/gebruikers.js';
import { reserveerPoging, wisPoging, maskeerEmail } from '../lib/login-poging.js';
import {
  gebruikHerstelcode, controleerNoodsleutel, gebruikNoodsleutel, lijktOpNoodsleutel, serieelGebruikers,
} from '../lib/herstel.js';
import { logActiviteit } from '../lib/activiteit.js';
import {
  authJson, authOpties, authNietToegestaan, authStore, nieuweSessieCookie, eisCsrfKop, OPSLAG_STORING,
} from '../lib/auth-antwoord.js';

const ONJUIST = { error: 'Onjuiste herstelgegevens' };
const VERGRENDELD_TEKST = 'Te veel mislukte pogingen. Probeer het later opnieuw.';
const SYSTEEM = { id: 'systeem', naam: 'Systeem' };

const vergrendeld = tot => authJson(429, { error: VERGRENDELD_TEKST, opnieuwOp: new Date(tot).toISOString() });
const isActieveBeheerder = g => Boolean(g) && g.rol === 'beheerder' && g.actief === true;

export function maakHandler({ getStore: haalStore, env = process.env, nu = () => Date.now() } = {}) {
  return async (req) => {
    if (req.method === 'OPTIONS') return authOpties();
    if (req.method !== 'POST') return authNietToegestaan();
    const csrf = eisCsrfKop(req);
    if (csrf) return csrf;

    let body;
    try { body = await req.json(); } catch { return authJson(400, { error: 'Ongeldige JSON' }); }
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || typeof body.email !== 'string' || typeof body.bewijs !== 'string' || typeof body.nieuwWachtwoord !== 'string') {
      return authJson(400, { error: 'E-mailadres, herstelcode en nieuw wachtwoord zijn verplicht.' });
    }
    const fout = beleidsFout(body.nieuwWachtwoord);
    if (fout) return authJson(400, { error: fout });
    if (typeof env.SESSIE_GEHEIM !== 'string' || env.SESSIE_GEHEIM === '') {
      console.error('auth-herstel: SESSIE_GEHEIM ontbreekt');
      return authJson(500, { error: 'Herstellen is niet beschikbaar.' });
    }

    const email = normaliseerEmail(body.email);
    // Een adres zonder '@' bestaat niet: generieke 401 VOOR er een poging gereserveerd wordt. Zo botst een
    // vrije sleutel (bv. 'setup:globaal', de teller van auth-setup) nooit met een e-mailadres.
    if (!email.includes('@')) return authJson(401, ONJUIST);
    const { bewijs, nieuwWachtwoord } = body;
    let store, record;
    try {
      store = await authStore(haalStore);
      record = (await leesGebruikers(store)).find(g => g && g.email === email);
    } catch (e) {
      console.error('auth-herstel: opslag niet bereikbaar (' + (e?.name || 'Error') + ')');
      return authJson(503, OPSLAG_STORING);
    }

    const reservering = await reserveerPoging(store, email, nu(), 'herstel');
    if (!reservering.toegelaten) return vergrendeld(reservering.tot);

    const beheerder = isActieveBeheerder(record) ? record : null;
    const viaSleutel = lijktOpNoodsleutel(bewijs);
    let bewezen = false;
    let gebruiktCode = null; // hash van de gebruikte herstelcode
    let sleutelHash = null;
    try {
      if (viaSleutel) {
        const s = await controleerNoodsleutel(bewijs, env, store);
        bewezen = s.ok;
        sleutelHash = s.hash ?? null;
      } else {
        // Altijd evenveel scrypt-werk, ook zonder (geschikt) account.
        const c = await gebruikHerstelcode(beheerder ?? { herstelcodes: [] }, bewijs);
        bewezen = c.ok;
        gebruiktCode = c.ok ? c.gebruikt : null;
      }
    } catch (e) {
      console.error('auth-herstel: controle mislukt (' + (e?.name || 'Error') + ')');
      return authJson(503, OPSLAG_STORING);
    }

    const mislukt = async () => {
      if (reservering.nieuweVergrendeling) {
        await logActiviteit(store, beheerder
          ? { gebruiker: publiek(beheerder), actie: 'herstel-mislukt-reeks' }
          : { gebruiker: SYSTEEM, actie: 'herstel-mislukt-reeks', onderwerp: maskeerEmail(email) }, { nu });
      }
      return authJson(401, ONJUIST); // de poging is al geteld; een eventuele vergrendeling blijft staan
    };
    if (!beheerder || !bewezen) return mislukt();

    const nieuweHash = await hashWachtwoord(nieuwWachtwoord);

    // Noodsleutel: eerst in beslag nemen (eenmalig, ook bij een gelijktijdige tweede aanroep).
    if (viaSleutel) {
      let genomen = false;
      try {
        genomen = await gebruikNoodsleutel(store, sleutelHash, new Date(nu()).toISOString());
      } catch (e) {
        console.error('auth-herstel: noodroute niet bewaard (' + (e?.name || 'Error') + ')');
        return authJson(503, OPSLAG_STORING);
      }
      if (!genomen) return mislukt();
    }

    let verworpen = false;
    let r;
    try {
      r = await serieelGebruikers(() => wijzigGebruikers(store, lijst => {
        verworpen = false;
        const i = lijst.findIndex(g => g && g.id === beheerder.id);
        const huidig = lijst[i];
        // Intussen geblokkeerd/gedegradeerd, of de code is intussen al gebruikt: niets doen.
        if (i < 0 || !isActieveBeheerder(huidig)) { verworpen = true; return null; }
        const wijziging = {
          ...huidig, wachtwoordHash: nieuweHash, moetWachtwoordWijzigen: false,
          sessieVersie: (huidig.sessieVersie ?? 0) + 1,
        };
        if (gebruiktCode !== null) {
          const codes = Array.isArray(huidig.herstelcodes) ? huidig.herstelcodes : [];
          if (!codes.includes(gebruiktCode)) { verworpen = true; return null; }
          wijziging.herstelcodes = codes.filter(h => h !== gebruiktCode);
        }
        const kopie = [...lijst];
        kopie[i] = wijziging;
        return kopie;
      }));
    } catch (e) {
      console.error('auth-herstel: gebruikers niet bewaard (' + (e?.name || 'Error') + ')');
      return authJson(503, OPSLAG_STORING);
    }
    if (verworpen) return mislukt();
    const bewaard = r.ok ? r.gebruikers.find(g => g && g.id === beheerder.id) : null;
    if (!bewaard || bewaard.wachtwoordHash !== nieuweHash || !Number.isInteger(bewaard.sessieVersie)) {
      return authJson(503, OPSLAG_STORING);
    }

    await wisPoging(store, email, 'herstel');
    await wisPoging(store, email, 'login'); // wie herstelt mag meteen weer inloggen
    const gebruiker = publiek(bewaard);
    await logActiviteit(store, { gebruiker, actie: 'herstel', details: viaSleutel ? 'noodsleutel' : 'code' }, { nu });
    return authJson(200, { gebruiker, moetWachtwoordWijzigen: false }, {
      cookie: nieuweSessieCookie({ uid: bewaard.id, sv: bewaard.sessieVersie }, env, nu()),
    });
  };
}

export default maakHandler({ getStore });

export const config = { path: '/api/auth-herstel' };
