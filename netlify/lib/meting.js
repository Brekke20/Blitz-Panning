// Tijdmeting per verzoek (S1 van het plan "Server-snelheid"): een Server-Timing-kop en één logregel [meting].
// Geen gedragswijziging: de meting is enkel actief in een Netlify-runtime (heeftNetlifyRuntime) of via de testseam
// zetMetingVoorTests(true) (die in een runtime gooit). Elke meetfout wordt ingeslikt: een kapotte klok of een gooiende
// console.log verandert nooit een antwoord, en een gooiende functie gooit dezelfde fout als zonder meting.
//
// Onderdelen (ms, afgerond):
//   auth        de sessiecontrole van de wrapper (beveiligd.js); ontbreekt bij 'open'-rijen en OPTIONS
//   blobs-auth  daarbinnen: getStore + leesGebruikers (auth.js)
//   kern        de functie zelf (niet bij een weigering)
//   zoho        som van de tijd tot de ANTWOORDKOP van elke Zoho-aanroep. Het lezen van de body telt niet mee,
//               dus `kern - zoho` is niet enkel eigen rekenwerk. n = ALLE Zoho-aanroepen van het verzoek (token en
//               org-id inbegrepen, dus exact het aantal fetch-aanroepen naar accounts.zoho.eu en desk.zoho.eu);
//               max = de hoogste gelijktijdigheid binnen dat verzoek.
//   zoho-token  daarvan enkel de tokenaanvraag (0 als het token uit de cache kwam)
//   koud        process.uptime() in ms bij de eerste meting van de instantie, daarna 0
//   totaal      van het begin van de wrapper tot het antwoord klaar is
// De Server-Timing-kop gaat enkel op antwoorden voor een ingelogde gebruiker (review M-S1-1); de logregel altijd.
// In de logregel staan enkel functienaam, methode, status, tijden, aantallen, regio en de limietgetallen van Zoho:
// nooit een gebruiker, e-mail, cookie, querystring of ticketgegevens.
import { AsyncLocalStorage } from 'node:async_hooks';
import { heeftNetlifyRuntime } from './lokale-dev.js';

const opslag = new AsyncLocalStorage();
let seam = null;      // true = meting aan buiten een runtime (enkel tests)
let nogKoud = true;   // eerste meting van deze instantie

function enkelBuitenRuntime(naam) {
  if (heeftNetlifyRuntime(process.env)) throw new Error(`${naam} is niet toegelaten in een Netlify-runtime`);
}
export function zetMetingVoorTests(aan) {
  enkelBuitenRuntime('zetMetingVoorTests');
  seam = aan === true ? true : null;
}
export function herstelKoudVoorTests() {
  enkelBuitenRuntime('herstelKoudVoorTests');
  nogKoud = true;
}
export function metingActief(env = process.env) {
  return seam === true || heeftNetlifyRuntime(env);
}

const veilig = f => { try { return f(); } catch { return null; } };
const getal = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const rond = v => (getal(v) !== null && v > 0 ? Math.round(v) : 0);
const enkelCijfers = v => (typeof v === 'string' && /^\d{1,9}$/.test(v) ? Number(v) : null);

export function maakMeting({
  nu = () => performance.now(),
  uptimeMs = () => process.uptime() * 1000,
  koud,
  regio = () => process.env.AWS_REGION ?? 'onbekend',
} = {}) {
  const tijd = () => getal(veilig(nu));
  const t0 = tijd();
  const koudDuur = rond(veilig(koud ?? (() => {
    if (!nogKoud) return 0;
    nogKoud = false;
    return uptimeMs();
  })));
  const delen = new Map(); // naam -> som in ms
  const z = { n: 0, som: 0, token: 0, actief: 0, max: 0, rest: null, gewicht: null };
  let ingelogd = false;
  let totaal = null;
  let gesloten = false;

  function tel(naam, ms) {
    if (typeof naam !== 'string' || getal(ms) === null || ms < 0) return;
    delen.set(naam, (delen.get(naam) ?? 0) + ms);
  }

  async function meet(naam, fn) {
    const begin = tijd();
    try {
      return await fn();
    } finally {
      const eind = tijd();
      if (begin !== null && eind !== null) tel(naam, eind - begin);
    }
  }

  function leesLimieten(res) {
    try {
      const h = res?.headers;
      if (!h || typeof h.get !== 'function') return;
      const rest = enkelCijfers(h.get('X-Rate-Limit-Remaining-v3'));
      const gewicht = enkelCijfers(h.get('X-Rate-Limit-Request-Weight-v3'));
      if (rest !== null) z.rest = rest;
      if (gewicht !== null) z.gewicht = gewicht;
    } catch { /* koppen enkel lezen; nooit een fout */ }
  }

  async function zoho(fn, { token = false } = {}) {
    z.n++;
    z.actief++;
    if (z.actief > z.max) z.max = z.actief;
    const begin = tijd();
    try {
      const res = await fn();
      leesLimieten(res);
      return res;
    } finally {
      z.actief--;
      const eind = tijd();
      if (begin !== null && eind !== null && eind >= begin) {
        z.som += eind - begin;
        if (token) z.token += eind - begin;
      }
    }
  }

  function sluit() {
    if (gesloten) return;
    gesloten = true;
    const eind = tijd();
    if (t0 !== null && eind !== null) totaal = rond(eind - t0);
  }

  function kop() {
    try {
      sluit();
      const lijst = [];
      for (const naam of ['auth', 'blobs-auth', 'kern']) {
        if (delen.has(naam)) lijst.push(`${naam};dur=${rond(delen.get(naam))}`);
      }
      if (z.n > 0) {
        lijst.push(`zoho;dur=${rond(z.som)};desc="n=${z.n} max=${z.max}"`);
        lijst.push(`zoho-token;dur=${rond(z.token)}`);
      }
      lijst.push(`koud;dur=${koudDuur}`);
      if (totaal !== null) lijst.push(`totaal;dur=${totaal}`);
      return lijst.join(', ');
    } catch {
      return '';
    }
  }

  const deel = naam => (delen.has(naam) ? rond(delen.get(naam)) : null);

  function logObject({ f, m, s } = {}) {
    sluit();
    const methode = typeof m === 'string' ? m.toUpperCase() : '';
    const gewesten = veilig(regio);
    return {
      f: typeof f === 'string' && /^[a-z0-9-]{1,60}$/.test(f) ? f : 'onbekend',
      m: /^[A-Z]{3,10}$/.test(methode) ? methode : 'ANDERE',
      s: Number.isInteger(s) && s >= 100 && s <= 599 ? s : null,
      auth: deel('auth'),
      blobsAuth: deel('blobs-auth'),
      kern: deel('kern'),
      zoho: rond(z.som),
      zn: z.n,
      zohoToken: rond(z.token),
      zohoMax: z.max,
      koud: koudDuur,
      regio: typeof gewesten === 'string' && /^[a-z0-9-]{2,30}$/.test(gewesten) ? gewesten : 'onbekend',
      zohoRest: z.rest,
      zohoGewicht: z.gewicht,
      totaal,
    };
  }

  return { meet, tel, zoho, sluit, kop, logObject, zetIngelogd: () => { ingelogd = true; }, isIngelogd: () => ingelogd };
}

// De meting van het lopende verzoek (voor dieper gelegen code: auth.js, zoho.js), of null.
export const huidigeMeting = () => opslag.getStore() ?? null;

// Zonder lopende meting een gewone doorgave: dezelfde belofte, hetzelfde resultaat, dezelfde fout.
export function meetOptioneel(naam, fn) {
  const m = huidigeMeting();
  return m ? m.meet(naam, fn) : fn();
}
export function meetZoho(fn, opties) {
  const m = huidigeMeting();
  return m ? m.zoho(fn, opties) : fn();
}

// Een nieuwe meting voor één verzoek, of null als de meting uit staat (dan draait alles precies als voorheen).
export function startVerzoekMeting() {
  try {
    return metingActief() ? maakMeting() : null;
  } catch {
    return null;
  }
}

function voegKopToe(res, tekst, soort) {
  if (!tekst || !res || typeof res !== 'object') return res;
  if (soort === 'v1') return { ...res, headers: { ...res.headers, 'Server-Timing': tekst } };
  if (typeof res.headers?.set !== 'function') return res;
  res.headers.set('Server-Timing', tekst); // een onveranderlijk antwoord (Response.error()) gooit: de aanroeper vangt dat
  return res;
}

function schrijfLog(m, f, methode, status) {
  try {
    console.log('[meting] ' + JSON.stringify(m.logObject({ f, m: methode, s: status })));
  } catch { /* een logfout verandert niets aan het antwoord */ }
}

// Draait `werk` binnen de meting, sluit af, zet (enkel voor een ingelogde gebruiker) de kop op het antwoord en logt.
// soort: 'v1' ({ statusCode, headers, body }: een kopie met de kop) of 'v2' (Response: de kop wordt gezet).
export async function draaiMetMeting(m, { f, methode }, werk, soort) {
  let res;
  try {
    res = await opslag.run(m, werk);
  } catch (e) {
    schrijfLog(m, f, methode, null);
    throw e;
  }
  let uit = res;
  try {
    m.sluit();
    if (m.isIngelogd()) uit = voegKopToe(res, m.kop(), soort);
  } catch {
    uit = res;
  }
  const status = soort === 'v1' ? res?.statusCode : res?.status;
  schrijfLog(m, f, methode, status);
  return uit;
}
