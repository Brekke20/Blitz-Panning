// public/js/versie.js
// Het versienummer van de app, getoond onderaan Instellingen. Moet gelijk zijn aan "version" in
// package.json (tests/versie.test.mjs bewaakt dat, zodat een release dit niet kan vergeten).
export const APP_VERSIE = '1.10.3';

if (typeof document !== 'undefined') {
  const toon = () => {
    const el = document.getElementById('app-versie');
    if (el) el.textContent = 'Versie ' + APP_VERSIE;
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', toon);
  else toon();
}
