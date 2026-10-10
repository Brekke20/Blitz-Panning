// Wrapper die elke functie achter de rechtentabel zet: beveiligV1 (event) en beveiligV2 (Request).
// beveiligV1 draait in productie altijd achter alsV2 (netlify/lib/v2-adapter.js): een functie is dus nooit een echte
// v1-Lambda, want enkel een v2-functie krijgt de volledige Netlify Blobs-omgeving (strong consistency).
//   const handler = beveiligV1('plan', async (event, context, gebruiker) => {...});
//   export default beveiligV2('plan-datum', async (req, context, gebruiker) => {...});
// Fail-closed: een weigering, een auth-resultaat zonder ok:true of een fout in de controle roept de functie
// nooit aan. OPTIONS (rijen zonder jokerregel) en 'open'-regels gaan ongewijzigd door; OPTIONS op een jokerrij
// beantwoordt de wrapper zelf (204) en een methode zonder regel krijgt 405 zonder de functie aan te roepen.
import { vereisGebruiker, weigeringV1, weigeringV2 } from './auth.js';
import { RECHTEN, regelVoor } from './rechten.js';
import { heeftNetlifyRuntime } from './lokale-dev.js';
import { v1Json, v1Opties, v2Json, v2Opties } from './http.js';

const CORS = Object.freeze({ 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' });
const NIET_SCHRIJVEND = new Set(['GET', 'HEAD', 'OPTIONS']);
const NIET_INGELOGD = { ok: false, status: 401, fout: 'Niet ingelogd.', code: 'niet-ingelogd' };
const GEEN_RECHT = { ok: false, status: 403, fout: 'Je hebt hier geen toegang toe.', code: 'geen-recht' };

// Testseam voor de wrappertest: vervangt de kern. Nooit in een Netlify-runtime.
let kernSpy = null;
export function zetKernSpyVoorTests(spy) {
  if (heeftNetlifyRuntime(process.env)) throw new Error('zetKernSpyVoorTests is niet toegelaten in een Netlify-runtime');
  kernSpy = typeof spy === 'function' ? spy : null;
}

function controleerNaam(naam) {
  if (typeof naam !== 'string' || !Object.hasOwn(RECHTEN, naam)) {
    throw new Error(`beveiligd: geen rij in de rechtentabel voor "${naam}"`);
  }
}

// Gedeelde kern van V1 en V2. Geeft { weiger } (401/403/503), { opties } (wrapper antwoordt OPTIONS zelf),
// { nietToegestaan } (405) of { gebruiker, methode } (kern aanroepen; gebruiker undefined = ongewijzigd doorlaten).
async function beslis(naam, methodeRuw, reqOfEvent, auth) {
  const methode = String(methodeRuw ?? '').toUpperCase();
  if (!Object.hasOwn(RECHTEN, naam)) return { weiger: GEEN_RECHT };
  const rij = RECHTEN[naam];
  const regel = regelVoor(naam, methode);
  if (methode === 'OPTIONS') {
    // Functies met een jokerregel controleren zelf geen methode (tickets, setup, ...): daar beantwoordt de
    // wrapper OPTIONS zelf en bereikt de kern nooit. 'Open'-rijen (eigen CORS en controles) en rijen zonder
    // joker laten OPTIONS door; die functies antwoorden 204/405 zelf.
    if (Object.hasOwn(rij, '*') && rij['*'] !== 'open') return { opties: true };
    return { gebruiker: undefined, methode };
  }
  if (regel === undefined) return { nietToegestaan: true }; // methode zonder regel: 405, kern niet aanroepen
  if (regel === 'open') return { gebruiker: undefined, methode };
  if (!Array.isArray(regel) || regel.length === 0) return { weiger: GEEN_RECHT }; // lege lijst = 'iedere rol' voor auth: weigeren
  // planEigen: de technieker staat niet in de rollenlijst maar mag er met het vinkje "Mag zelf plannen" toch door (zie rechten.js).
  const metPlanEigen = rij.planEigen === true && !regel.includes('technieker');
  let resultaat;
  try {
    const controle = auth ? auth.vereisGebruiker : vereisGebruiker;
    resultaat = await controle(reqOfEvent, {
      rollen: metPlanEigen ? [...regel, 'technieker'] : regel,
      schrijven: !NIET_SCHRIJVEND.has(methode),
      service: rij.service === true,
      ookBijWijzigen: rij.ookBijWijzigen === true,
    });
  } catch {
    return { weiger: NIET_INGELOGD };
  }
  if (!resultaat || resultaat.ok !== true) {
    if (resultaat && resultaat.ok === false && [401, 403, 503].includes(resultaat.status) && typeof resultaat.code === 'string') {
      return { weiger: resultaat };
    }
    return { weiger: NIET_INGELOGD };
  }
  if (!resultaat.gebruiker || typeof resultaat.gebruiker !== 'object') return { weiger: NIET_INGELOGD };
  if (metPlanEigen) {
    const g = resultaat.gebruiker;
    const toegelaten = regel.includes(g.rol) || (g.rol === 'technieker' && g.magZelfPlannen === true);
    if (!toegelaten) return { weiger: GEEN_RECHT };
  }
  return { gebruiker: resultaat.gebruiker, methode };
}

export function beveiligV1(naam, handler, { auth } = {}) {
  controleerNaam(naam);
  return async (event, context) => {
    const b = await beslis(naam, event?.httpMethod, event, auth);
    if (b.weiger) return weigeringV1(b.weiger, CORS);
    if (b.opties) return v1Opties(CORS);
    if (b.nietToegestaan) return v1Json(405, { error: 'Method not allowed' }, CORS);
    if (kernSpy) return kernSpy({ naam, methode: b.methode, gebruiker: b.gebruiker });
    return b.gebruiker === undefined ? handler(event, context) : handler(event, context, b.gebruiker);
  };
}

export function beveiligV2(naam, handler, { auth } = {}) {
  controleerNaam(naam);
  return async (req, context) => {
    const b = await beslis(naam, req?.method, req, auth);
    if (b.weiger) return weigeringV2(b.weiger, CORS);
    if (b.opties) return v2Opties(CORS);
    if (b.nietToegestaan) return v2Json(405, { error: 'Method not allowed' }, CORS);
    if (kernSpy) return kernSpy({ naam, methode: b.methode, gebruiker: b.gebruiker });
    return b.gebruiker === undefined ? handler(req, context) : handler(req, context, b.gebruiker);
  };
}
