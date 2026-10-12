// kern/verklikker.js — TIJDELIJK scrollsprong-verklikker (v1.8.0): sjLog en startVerklikker (voorheen sjInit).
// Letterlijk uit het klassieke script van index.html (etappe 5b, taak 8); `sjLog` en `sjZetTab` zijn exports,
// `sjInit` is `startVerklikker()`, `TEST_MODE` komt uit omgeving.js, en `window.sjLog` wordt niet meer gezet.
import { TEST_MODE } from './omgeving.js';

// ── TIJDELIJK scrollsprong-verklikker (v1.8.0) — verwijderen na analyse ──
// Doel: uitzoeken waarom op de gsm (Kalender) de scrollpositie soms naar boven springt zodra verse data
// binnenkomt. Ringbuffer van recente sync/render-stappen; bij een sprong (>=150px -> <=5px in één
// scroll-event zonder recente gebruikersinvoer/tabwissel) gaat één diagnostische regel naar
// /api/client-log (max 5 per paginalading, geen persoonsgegevens: enkel functienamen en tijden).
var _sjRing = [], _sjInvoer = 0, _sjSetTab = 0, _sjVerstuurd = 0, _sjPos = {};
// Alleen-lezen kopie van de ringbuffer (voor de unit-test).
export function sjRecent() { return _sjRing.slice(); }
export function sjLog(wat) { // TIJDELIJK scrollsprong-verklikker (v1.8.0) — verwijderen na analyse
  _sjRing.push({ t: Date.now(), wat });
  if (_sjRing.length > 15) _sjRing.shift();
}
// `_sjSetTab = Date.now()` uit setTab() (app.js): de variabele is module-privé, dus via een zetter. // TIJDELIJK scrollsprong-verklikker (v1.8.0) — verwijderen na analyse
export function sjZetTab() { _sjSetTab = Date.now(); } // TIJDELIJK scrollsprong-verklikker (v1.8.0) — verwijderen na analyse
export function startVerklikker() { // TIJDELIJK scrollsprong-verklikker (v1.8.0) — verwijderen na analyse
  const invoer = () => { _sjInvoer = Date.now(); };
  ['pointerdown', 'wheel', 'keydown', 'touchstart', 'touchmove', 'touchend'].forEach(ev =>
    document.addEventListener(ev, invoer, { capture: true, passive: true }));
  document.addEventListener('scroll', (e) => {
    const doel = e.target;
    const isWin = doel === document || doel === document.documentElement || doel === document.body;
    const view = document.querySelector('.view.active');
    if (!isWin && doel !== view) return;
    const sleutel = isWin ? 'window' : doel.id;
    const nu = isWin ? window.scrollY : doel.scrollTop;
    const van = _sjPos[sleutel] || 0;
    _sjPos[sleutel] = nu;
    if (!(van >= 150 && nu <= 5)) return;
    const t = Date.now();
    if (t - _sjInvoer < 700 || t - _sjSetTab < 1000 || _sjVerstuurd >= 5) return;
    _sjVerstuurd++;
    const payload = {
      soort: 'scrollsprong', stap: 'scrollsprong', tab: document.querySelector('.tab.active')?.id || '',
      doel: sleutel, van, naar: nu,
      indeling: window.apparaat?.indeling, rol: window.apparaat?.rol,
      recent: _sjRing.map(r => ({ vooraf_ms: t - r.t, wat: r.wat })),
      stack: (new Error().stack || '').slice(0, 800),
    };
    if (TEST_MODE) { console.warn('scrollsprong-verklikker (testmodus, niet verzonden):', payload); return; }
    try {
      fetch('/api/client-log', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), keepalive: true }).catch(() => {});
    } catch { /* diagnostisch */ }
  }, { capture: true, passive: true });
}

// ── Render-foutverklikker (v2.0.2) ──
// Het tabblad Rapporten toonde bij een beheerder "Laden mislukt: Cannot read properties of null (reading 'id')" zonder dat
// de bron bekend was. Een catch rond een render stuurt nu één keer per paginalading de foutmelding en de bestands-/regelnummers
// uit de stack naar /api/client-log (POST staat open voor alle rollen). Geen persoonsgegevens: enkel de melding (ingekort),
// functienamen en regelnummers. In testmodus (?test) gaat er niets weg.
const MAX_STACKREGELS = 8;
export function stackSamenvatting(stack) {
  const uit = [];
  for (const regel of String(stack || '').split('\n')) {
    const plek = /([\w-]+\.js)(?:\?[^:)\s]*)?:(\d+)/.exec(regel);
    if (!plek) continue;
    const naam = /^\s*at\s+(?:async\s+)?([^\s(]+)\s+\(/.exec(regel)?.[1] || /^\s*([^\s@]+)@/.exec(regel)?.[1] || '?';
    uit.push(`${naam}@${plek[1]}:${plek[2]}`);
    if (uit.length >= MAX_STACKREGELS) break;
  }
  return uit.join(' < ');
}
export function renderFoutPayload(plaats, err) {
  const melding = String(err?.message ?? err ?? '').slice(0, 150);
  const stack = stackSamenvatting(err?.stack);
  return { soort: 'render-fout', stap: 'render-fout:' + String(plaats).slice(0, 40), fout: `${melding} | ${stack}`.slice(0, 480), poging: 1 };
}
const _gemeldPlaatsen = new Set();
export function wisRenderFoutMeldingen() { _gemeldPlaatsen.clear(); }
// Geeft de verstuurde payload terug (of null als er niets gestuurd werd): handig voor tests.
export function meldRenderFout(plaats, err, { testmodus = TEST_MODE, verstuur } = {}) {
  try {
    if (testmodus || _gemeldPlaatsen.has(plaats)) return null;
    _gemeldPlaatsen.add(plaats);
    const payload = renderFoutPayload(plaats, err);
    const stuur = verstuur || ((p) => fetch('/api/client-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p), keepalive: true }).catch(() => {}));
    stuur(payload);
    return payload;
  } catch { return null; /* diagnostisch: nooit zelf een fout veroorzaken */ }
}
