// kern/api.js — fetch-helpers en de gedeelde "bewaar met versie"-helper (puur: geen toasts, geen window).
// Gebruikt de globale fetch laat-gebonden, zodat de testmodus-patch in <head> (X-Blitz-Test) gewoon meeloopt.
//
// bewaarMetVersie geeft { ok, versie, waarde, samengevoegd, reden?, status? } terug; `samengevoegd` is true als er na een
// 409 samengevoegd werd (dan is `waarde` een nieuwe stand die de oproeper moet overnemen; anders is het de eigen waarde); `versie`/`waarde` zijn de laatst bekende stand
// van de oproeper (bij een mislukte retry: samengevoegd + versie van de EERSTE 409, zoals saveKlantBeschikbaarheid).
// reden: 'conflict' (409 zonder voegSamen, of een tweede 409), 'http' (andere status, ook een 409 zonder leesbare
// serverstand), 'netwerk', 'samenvoegen' (voegSamen gooide). Bij reden 'conflict' na een tweede 409 bevatten
// `laatsteServer` (server[veld]) en `laatsteVersie` de stand uit het LAATSTE 409-antwoord (voor K12: waarschuwing +
// server-stand). Zonder voegSamen zijn ze gelijk aan `waarde`/`versie`.

export class ApiFout extends Error {
  constructor(status, data) {
    super('HTTP ' + status);
    this.name = 'ApiFout';
    this.status = status;
    this.data = data;
  }
}

let _fetch = null;
// Enkel voor unit-tests: eigen fetch inzetten (null = terug naar globalThis.fetch).
export function zetFetch(fn) { _fetch = fn || null; }
const haal = (...args) => (_fetch || globalThis.fetch)(...args);

// Bouwt het init-object: Content-Type enkel bij een body, zoals alle bestaande call sites.
function maakInit({ methode = 'GET', body, headers, keepalive } = {}) {
  const init = {};
  if (keepalive) init.keepalive = true; // een verzoek dat een 'pagehide' overleeft (uitgestelde verwijdering, sales-data.js)
  const heeftBody = body !== undefined;
  if (methode !== 'GET') init.method = methode;
  if (heeftBody || headers) init.headers = { ...(heeftBody ? { 'Content-Type': 'application/json' } : {}), ...headers };
  if (heeftBody) init.body = JSON.stringify(body);
  return init;
}

// Geeft { ok, status, data }. Gooit enkel bij een netwerkfout (of een onleesbaar antwoord bij status ok).
// Bij !ok is data het JSON-antwoord als dat leesbaar is, anders { error: 'HTTP <status>' }.
export async function apiVerzoek(pad, opties = {}) {
  const init = maakInit(opties);
  const res = Object.keys(init).length ? await haal(pad, init) : await haal(pad);
  let data = null;
  if (res.ok) data = await res.json();
  else { try { data = await res.json(); } catch { data = { error: 'HTTP ' + res.status }; } }
  return { ok: res.ok, status: res.status, data };
}

// Geeft de data, of gooit ApiFout (message 'HTTP <status>') bij !ok.
export async function apiJson(pad, opties = {}) {
  const r = await apiVerzoek(pad, opties);
  if (!r.ok) throw new ApiFout(r.status, r.data);
  return r.data;
}

// PUT { versie, [veld]: waarde }. Bij 409 en een `voegSamen`: server-stand ophalen uit het 409-antwoord,
// samenvoegen en één keer opnieuw bewaren met de server-versie. Geeft altijd de laatst bekende stand terug.
export async function bewaarMetVersie({ pad, veld, versie, waarde, voegSamen }) {
  const stand = (ok, extra) => ({ ok, samengevoegd: false, ...extra });
  try {
    const r = await apiVerzoek(pad, { methode: 'PUT', body: { versie, [veld]: waarde } });
    if (r.ok) return stand(true, { versie: r.data.versie, waarde });
    if (r.status !== 409) return stand(false, { reden: 'http', status: r.status, versie, waarde });

    const server = r.data?.data;
    // 409 zonder leesbare serverstand: niet als lege serverstand behandelen.
    if (!server) return stand(false, { reden: 'http', status: 409, versie, waarde });
    const serverVersie = server.versie || 0;
    if (!voegSamen) return stand(false, { reden: 'conflict', status: 409, versie: serverVersie, waarde: server[veld], laatsteServer: server[veld], laatsteVersie: serverVersie });

    let samen;
    try { samen = voegSamen(server[veld], waarde); } catch { return stand(false, { reden: 'samenvoegen', versie, waarde }); }
    try {
      const r2 = await apiVerzoek(pad, { methode: 'PUT', body: { versie: serverVersie, [veld]: samen } });
      if (r2.ok) return stand(true, { versie: r2.data.versie, waarde: samen, samengevoegd: true });
      if (r2.status === 409) {
        const s2 = r2.data?.data;
        return stand(false, { samengevoegd: true, reden: 'conflict', status: 409, versie: serverVersie, waarde: samen, laatsteServer: s2?.[veld], laatsteVersie: s2 ? (s2.versie || 0) : undefined });
      }
      return stand(false, { samengevoegd: true, reden: 'http', status: r2.status, versie: serverVersie, waarde: samen });
    } catch {
      return stand(false, { samengevoegd: true, reden: 'netwerk', versie: serverVersie, waarde: samen });
    }
  } catch {
    return stand(false, { reden: 'netwerk', versie, waarde });
  }
}

// Classificeert een fout van een /api-aanroep voor de aanroeper (en later voor "onzeker"-afhandeling, etappe 7 T8).
// soort: 'offline' | 'timeout' | 'netwerk' | 'http' | 'onbekend'. onzeker: kan de server de schrijfactie toch uitgevoerd hebben?
// Een 500 van onze eigen functie is een definitief antwoord; 502/503/504 (proxy/gateway) zeggen niets over de uitkomst.
const ONZEKERE_STATUS = new Set([502, 503, 504]);
export function leesFout(err, { online = globalThis.navigator?.onLine } = {}) {
  if (err?.name === 'TimeoutError') return { soort: 'timeout', onzeker: true };
  if (err?.name === 'AbortError') return { soort: 'netwerk', onzeker: true };
  if (err instanceof TypeError && err.vanFetch === true) {
    return { soort: online === false ? 'offline' : 'netwerk', onzeker: true };
  }
  const status = typeof err?.status === 'number' ? err.status : Number(/^HTTP (\d{3})$/.exec(err?.message || '')?.[1]);
  if (status) return { soort: 'http', status, onzeker: ONZEKERE_STATUS.has(status) };
  return { soort: 'onbekend', onzeker: false };
}

// De Nederlandse tekst voor het detail van een foutmelding (W5-fix, Q2): de ENIGE plek die technische foutklassen vertaalt.
// Alleen herkende klassen worden vertaald; een eigen foutmelding van de server (data.error) of een onbekende fout blijft zoals ze is.
// 4xx is een geweigerd verzoek, geen fout van de server.
const statusTekst = (status) => (status >= 400 && status < 500 ? `Verzoek geweigerd (HTTP ${status})` : `Serverfout (HTTP ${status})`);
export function foutTekst(err, opties) {
  if (typeof err === 'string') { // 'HTTP 502' als losse tekst (data.error)
    const m = /^HTTP (\d{3})$/.exec(err);
    return m ? statusTekst(Number(m[1])) : err;
  }
  const f = leesFout(err, opties);
  if (f.soort === 'timeout') {
    const sec = /(\d+) s/.exec(err?.message || '')?.[1];
    return sec ? `De server antwoordt niet (time-out na ${sec} s)` : 'De server antwoordt niet (time-out)';
  }
  if (f.soort === 'offline' || f.soort === 'netwerk') return 'Geen verbinding met de server';
  if (f.soort === 'http' && /^HTTP \d{3}$/.test(err?.message || '')) return statusTekst(f.status);
  return err?.message || '';
}

// Beveiligings-omhulling van fetch (logins T13). Buitenste laag, ná installeerFetchTimeout. Enkel same-origin /api/-verzoeken:
//  - X-Blitz: 1 bij elke schrijvende methode (alles behalve GET/HEAD/OPTIONS; CSRF-kop die de server eist, ook voor auth-login/-uitloggen);
//  - X-Blitz-Test-Rol: <rol> als testRol() een tekst geeft (enkel lokale dev; de server negeert het elders);
//  - 401 (niet van /api/auth-*) of 403 met code 'wachtwoord-wijzigen': await herlogin(), dan het verzoek ÉÉN keer herhalen
//    (enkel als dat veilig kan: string/URL-invoer, of een tekst-body); een tweede 401 gaat gewoon door naar de aanroeper;
//  - 503 met code 'opslag-storing': bijStoring() (toast), geen herlogin: "later opnieuw proberen", niet uitloggen.
// Een eigen `signal` van de aanroeper blijft behouden. Bodies van antwoorden worden enkel via clone() gelezen.
const LEZEND = new Set(['GET', 'HEAD', 'OPTIONS']);
const bevatCode = async (res, code) => { try { return (await res.clone().json())?.code === code; } catch { return false; } };

export function installeerApiBeveiliging(doel, { herlogin, testRol = () => null, bijStoring } = {}) {
  const oorspronkelijk = doel.fetch;
  const basis = doel.location?.href || 'http://localhost/';
  const origin = new URL(basis).origin;
  const urlVan = (invoer) => { try { return new URL(typeof invoer === 'string' ? invoer : (invoer.url ?? String(invoer)), basis); } catch { return null; } };
  const isRequest = (invoer) => typeof Request !== 'undefined' && invoer instanceof Request;

  doel.fetch = async function (invoer, init) {
    const url = urlVan(invoer);
    if (!url || url.origin !== origin || !url.pathname.startsWith('/api/')) return oorspronkelijk.call(doel, invoer, init);

    const methode = String(init?.method || invoer?.method || 'GET').toUpperCase();
    let rol = null;
    try { rol = testRol(); } catch { /* geen testrol */ }
    const metX = !LEZEND.has(methode);
    let uitInit = init;
    if (metX || (typeof rol === 'string' && rol)) {
      const koppen = new Headers(isRequest(invoer) ? invoer.headers : undefined);
      if (init?.headers) new Headers(init.headers).forEach((v, k) => koppen.set(k, v));
      if (metX) koppen.set('X-Blitz', '1');
      if (typeof rol === 'string' && rol) koppen.set('X-Blitz-Test-Rol', rol);
      uitInit = { ...init, headers: koppen };
    }

    const verstuur = () => oorspronkelijk.call(doel, invoer, uitInit);
    const res = await verstuur();

    if (res.status === 503) {
      if (bijStoring && await bevatCode(res, 'opslag-storing')) { try { bijStoring(); } catch { /* melding mag niets breken */ } }
      return res;
    }
    const isAuthPad = url.pathname.startsWith('/api/auth-');
    const moetHerlogin = !isAuthPad && herlogin && (res.status === 401 || (res.status === 403 && await bevatCode(res, 'wachtwoord-wijzigen')));
    if (!moetHerlogin) return res;

    try { await herlogin(); } catch { return res; }
    const body = uitInit?.body;
    const herhaalbaar = typeof body === 'string' || (!isRequest(invoer) && (body == null || !(typeof ReadableStream !== 'undefined' && body instanceof ReadableStream)));
    if (!herhaalbaar) return res;
    return verstuur();
  };
  return () => { doel.fetch = oorspronkelijk; };
}
