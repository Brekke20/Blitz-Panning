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
