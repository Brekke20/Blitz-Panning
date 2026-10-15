// public/js/versie.js
// Het versienummer van de app, getoond onderaan Instellingen. Moet gelijk zijn aan "version" in
// package.json (tests/versie.test.mjs bewaakt dat, zodat een release dit niet kan vergeten).
export const APP_VERSIE = '2.1.5';

// Leest het versienummer uit de broncode van versie.js (v2.1.6): zo kan de app na een nieuwe service worker nagaan of er echt een andere
// release klaarstaat. null als de tekst er niet uitziet als dit bestand.
export function leesVersie(bron) {
  const m = /export const APP_VERSIE = '([0-9]+\.[0-9]+\.[0-9]+)';/.exec(String(bron ?? ''));
  return m ? m[1] : null;
}

if (typeof document !== 'undefined') {
  const toon = () => {
    const el = document.getElementById('app-versie');
    if (el) el.textContent = 'Versie ' + APP_VERSIE;
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', toon);
  else toon();
}
