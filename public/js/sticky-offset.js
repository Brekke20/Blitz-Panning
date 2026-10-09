// public/js/sticky-offset.js
// Houdt twee CSS-variabelen bij zodat sticky balken onder de kop EN onder de zichtbare
// meldingsbalken plakken (v1.10.3):
//   --offline-h : hoogte van de offline-balk (0 als die verborgen is)
//   --banners-h : hoogte van offline- plus outbox-balk samen (0 als beide verborgen zijn)
// De sticky filterbalk van het Rapporten-tabblad en de outbox-balk gebruiken ze in app.css.
function hoogteVan(el) {
  if (!el || getComputedStyle(el).display === 'none') return 0;
  return el.getBoundingClientRect().height;
}

export function zetBannerHoogtes() {
  const offline = hoogteVan(document.getElementById('offline-banner'));
  const outbox = hoogteVan(document.getElementById('outbox-banner'));
  const root = document.documentElement.style;
  root.setProperty('--offline-h', offline + 'px');
  root.setProperty('--banners-h', (offline + outbox) + 'px');
}

function start() {
  zetBannerHoogtes();
  const ro = (typeof ResizeObserver !== 'undefined') ? new ResizeObserver(zetBannerHoogtes) : null;
  ['offline-banner', 'outbox-banner'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (ro) ro.observe(el);
    // display none <-> flex verandert de grootte; stijlwijzigingen vangen we hier extra op
    new MutationObserver(zetBannerHoogtes).observe(el, { attributes: true, attributeFilter: ['style', 'class'] });
  });
  window.addEventListener('resize', zetBannerHoogtes);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
