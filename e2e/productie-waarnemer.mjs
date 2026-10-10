// Interne bouwstenen van het productie-vangnet: het strenge route-slot, de waarnemer en het
// WebSocket-slot. Importeren mag ENKEL e2e/productie-hulp.mjs en de zelftest (e2e/productie/zelftest-hulp.mjs);
// de importguard (tests/e2e-import-guard.test.mjs) laat elk ander bestand falen. De waarnemer bevat de
// lekmeldingen; wie ze kan leegmaken, kan een lek wegpoetsen.
import { isToegestaan } from './vangnet-regels.mjs';

// Hosts die stubExtern zelf beantwoordt (kaarttegels, lettertypen): nooit echt opgehaald.
export const GESTUBDE_HOSTEN = /^(server\.arcgisonline\.com|[a-c]\.tile\.openstreetmap\.org|fonts\.googleapis\.com)$/;

const EIGEN_HOSTS = ['localhost:3338', '127.0.0.1:3338'];
const PER_CONTEXT = new WeakMap(); // context -> waarnemer

// Registreert het strenge slot op de context. `metStubs`: mogen tegel-/fonthosts (GET) doorvallen naar
// stubExtern? In de fixture (nog geen stubs) niet: daar wordt alles buiten de eigen server afgebroken.
export async function strengVangnet(context, verzoeken, { metStubs }) {
  await context.route(u => /^https?:$/.test(u.protocol), (route) => {
    const req = route.request();
    const methode = req.method();
    const u = new URL(req.url());
    if (isToegestaan({ url: req.url(), methode }).ok) return route.fallback();
    if (metStubs && methode === 'GET' && GESTUBDE_HOSTEN.test(u.hostname)) return route.fallback();
    verzoeken.buitenHost.push(u.href);
    return route.abort('blockedbyclient');
  });
}

// WebSocket-slot: de app gebruikt geen WebSocket, dus elke poging is een fout. context.route ziet
// WebSocket-verkeer niet; routeWebSocket wel. De verbinding wordt gesloten en genoteerd.
export async function zetWebSocketSlot(context) {
  const w = waarnemer(context);
  await context.routeWebSocket(() => true, (ws) => {
    w.websockets.push(ws.url());
    ws.close();
  });
}

// Gedeelde waarnemer per context: ziet ook verzoeken die een route afbreekt of vervult.
// Niet-http(s)-schema's (geo:, data:, blob:, ws: via het WebSocket-slot) worden hier niet beoordeeld.
export function waarnemer(context) {
  if (PER_CONTEXT.has(context)) return PER_CONTEXT.get(context);
  const w = { ongeoorloofd: [], testSignalen: [], websockets: [], schrijven: [] };
  context.on('request', (req) => {
    const methode = req.method();
    const u = new URL(req.url());
    if (!/^https?:$/.test(u.protocol)) return;
    const eigen = EIGEN_HOSTS.includes(u.host);
    const h = req.headers();
    if ('x-blitz-test' in h) w.testSignalen.push(`x-blitz-test-header: ${methode} ${u.href}`);
    if (eigen && u.searchParams.has('test')) w.testSignalen.push(`?test in URL: ${methode} ${u.href}`);
    // Elk niet-GET verzoek naar de eigen server (ook buiten /api) moet op de whitelist staan.
    if (eigen && methode !== 'GET') w.schrijven.push({ methode, pad: u.pathname });
    if (isToegestaan({ url: u.href, methode }).ok) return;
    if (methode === 'GET' && GESTUBDE_HOSTEN.test(u.hostname)) return; // gestubd door stubExtern
    w.ongeoorloofd.push(`${methode} ${u.href}`);
  });
  PER_CONTEXT.set(context, w);
  return w;
}

// ── Alleen-lezen weergaven voor specs ─────────────────────────────────────────
// Specs krijgen `verzoeken` en `consoleFouten` als live, alleen-lezen weergave: lezen volgt de originelen,
// elke schrijfpoging (toewijzing, .length = 0, push/splice/pop/..., delete, defineProperty) gooit. De
// originelen blijven hier privé; het afterEach-vangnet leest ze via origineelVan(). Zo kan een spec een
// lekmelding niet wissen, ook niet via destructuring of haakjes-toegang.
const ORIGINEEL = new WeakMap(); // weergave -> origineel
const WEERGAVE = new WeakMap(); // origineel -> weergave (stabiele identiteit)
const ARRAY_MUTATORS = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin']);

function weiger(wat) {
  throw new TypeError(`alleen-lezen weergave van het productie-vangnet: ${wat} is niet toegestaan`);
}

export function alleenLezen(doel) {
  if (doel === null || typeof doel !== 'object') return doel;
  if (WEERGAVE.has(doel)) return WEERGAVE.get(doel);
  const weergave = new Proxy(doel, {
    get(t, k) {
      const v = Reflect.get(t, k, t); // receiver = origineel, zodat getters op het origineel draaien
      if (typeof v === 'function') {
        if (k === 'constructor') return v;
        if (Array.isArray(t) && ARRAY_MUTATORS.has(k)) return () => weiger(`.${String(k)}()`);
        return (...args) => alleenLezen(v.apply(t, args));
      }
      return alleenLezen(v);
    },
    set(t, k) { return weiger(`toewijzing aan ${String(k)}`); },
    defineProperty(t, k) { return weiger(`defineProperty ${String(k)}`); },
    deleteProperty(t, k) { return weiger(`delete ${String(k)}`); },
    setPrototypeOf() { return weiger('setPrototypeOf'); },
    preventExtensions() { return weiger('preventExtensions'); },
  });
  ORIGINEEL.set(weergave, doel);
  WEERGAVE.set(doel, weergave);
  return weergave;
}

// Het muteerbare origineel achter een weergave; enkel voor het vangnet zelf en de zelftest-hulp.
export function origineelVan(weergave) {
  const o = ORIGINEEL.get(weergave);
  if (!o) throw new Error('geen weergave van het productie-vangnet');
  return o;
}
