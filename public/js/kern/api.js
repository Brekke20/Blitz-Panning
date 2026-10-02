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
function maakInit({ methode = 'GET', body, headers } = {}) {
  const init = {};
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
  if (err instanceof TypeError && /fetch|load failed|network/i.test(err.message || '')) {
    return { soort: online === false ? 'offline' : 'netwerk', onzeker: true };
  }
  const status = typeof err?.status === 'number' ? err.status : Number(/^HTTP (\d{3})$/.exec(err?.message || '')?.[1]);
  if (status) return { soort: 'http', status, onzeker: ONZEKERE_STATUS.has(status) };
  return { soort: 'onbekend', onzeker: false };
}
