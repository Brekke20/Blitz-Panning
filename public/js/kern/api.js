// kern/api.js — fetch-helpers en de gedeelde "bewaar met versie"-helper (puur: geen toasts, geen window).
// Gebruikt de globale fetch laat-gebonden, zodat de testmodus-patch in <head> (X-Blitz-Test) gewoon meeloopt.

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
// Bij !ok is data het JSON-antwoord als dat leesbaar is, anders null.
export async function apiVerzoek(pad, opties = {}) {
  const init = maakInit(opties);
  const res = Object.keys(init).length ? await haal(pad, init) : await haal(pad);
  let data = null;
  if (res.ok) data = await res.json();
  else { try { data = await res.json(); } catch { data = null; } }
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
  const stand = (ok, extra) => ({ ok, ...extra });
  try {
    const r = await apiVerzoek(pad, { methode: 'PUT', body: { versie, [veld]: waarde } });
    if (r.ok) return stand(true, { versie: r.data.versie, waarde });
    if (r.status !== 409) return stand(false, { reden: 'http', status: r.status, versie, waarde });

    const server = r.data?.data || {};
    const serverVersie = server.versie || 0;
    if (!voegSamen) return stand(false, { reden: 'conflict', status: 409, versie: serverVersie, waarde: server[veld] });

    const samen = voegSamen(server[veld], waarde);
    try {
      const r2 = await apiVerzoek(pad, { methode: 'PUT', body: { versie: serverVersie, [veld]: samen } });
      if (r2.ok) return stand(true, { versie: r2.data.versie, waarde: samen });
      return stand(false, { reden: r2.status === 409 ? 'conflict' : 'http', status: r2.status, versie: serverVersie, waarde: samen });
    } catch {
      return stand(false, { reden: 'netwerk', versie: serverVersie, waarde: samen });
    }
  } catch {
    return stand(false, { reden: 'netwerk', versie, waarde });
  }
}
