// kern/netwerk.js — time-outs op same-origin /api-verzoeken (etappe 7, N6). Zuiver: krijgt het doel (de globale scope) als parameter.
// Een aanroep die zelf een `signal` meegeeft (de outbox) blijft onaangeroerd. De timer loopt tot de antwoordkop.
export const TIJDLIMIETEN = { standaard: 20000, lang: 35000, fotoUpload: 60000 };
const LANG = new Set(['propose', 'send-rapport', 'annuleer', 'rapport', 'planning-sinds', 'planning-export']);

function klasseVoor(pad, methode) {
  const p = String(pad).split(/[?#]/)[0].replace(/\/+$/, '');
  const naam = p.startsWith('/api/') ? p.slice(5) : '';
  if (naam === 'fotos' && String(methode).toUpperCase() === 'PUT') return 'fotoUpload';
  return LANG.has(naam) ? 'lang' : 'standaard';
}
export const limietVoor = (pad, methode = 'GET') => TIJDLIMIETEN[klasseVoor(pad, methode)];

// Geeft de herstelfunctie terug (zet de oorspronkelijke fetch terug).
export function installeerFetchTimeout(doel, { limieten = TIJDLIMIETEN, setTimeoutFn = (f, ms) => setTimeout(f, ms), clearTimeoutFn = (t) => clearTimeout(t) } = {}) {
  const oorspronkelijk = doel.fetch;
  const basis = doel.location?.href || 'http://localhost/';
  const urlVan = (invoer) => { try { return new URL(typeof invoer === 'string' ? invoer : (invoer.url ?? String(invoer)), basis); } catch { return null; } };
  doel.fetch = function (invoer, init) {
    const url = urlVan(invoer);
    if (!url || url.origin !== new URL(basis).origin || !url.pathname.startsWith('/api/') || init?.signal) {
      return oorspronkelijk.call(doel, invoer, init);
    }
    const methode = init?.method || invoer?.method || 'GET';
    const ms = limieten[klasseVoor(url.pathname, methode)];
    const controller = new AbortController();
    const timer = setTimeoutFn(() => controller.abort(new DOMException('Time-out na ' + Math.round(ms / 1000) + ' s', 'TimeoutError')), ms);
    const klaar = () => clearTimeoutFn(timer);
    let belofte;
    try { belofte = oorspronkelijk.call(doel, invoer, { ...init, signal: controller.signal }); } catch (e) { klaar(); throw e; }
    return belofte.then((r) => { klaar(); return r; }, (e) => { klaar(); throw e; });
  };
  return () => { doel.fetch = oorspronkelijk; };
}
