// public/js/sticky-offset.js
// De ENIGE bron voor de sticky-offsets van de app (v2.0.1). Houdt CSS-variabelen bij, berekend uit wat echt op het scherm staat:
//   --topbar-h  : hoogte van kop + tabbalk samen (.topbar-sticky)
//   --offline-h : hoogte van de offline-balk (0 als die verborgen is)
//   --banners-h : hoogte van offline- plus outbox-balk samen (0 als beide verborgen zijn)
//   --sticky-top: onderkant van kop + tabbalk + zichtbare meldingsbalken = de `top` van elke sticky balk onder de tabbladen
//                 (.lijst-balk, .kal-header, .route-balk, .gep-week, de filterbalk van Rapporten, ...).
// Nooit een vaste top-waarde in CSS: altijd `top: var(--sticky-top, <terugval>)`. Verandert er iets aan kop, tabbalk of meldingsbalken
// (gsm/aanraak-hoogte, tab die verdwijnt, offline-balk), dan volgen de variabelen via ResizeObserver, MutationObserver en resize.
function hoogteVan(el) {
  if (!el || getComputedStyle(el).display === 'none') return 0;
  return el.getBoundingClientRect().height;
}

const rond = (px) => Math.round(px * 10) / 10;

export function zetStickyOffsets() {
  const root = document.documentElement.style;
  const topbar = rond(hoogteVan(document.querySelector('.topbar-sticky')));
  const offline = rond(hoogteVan(document.getElementById('offline-banner')));
  const outbox = rond(hoogteVan(document.getElementById('outbox-banner')));
  if (topbar > 0) root.setProperty('--topbar-h', topbar + 'px'); // 0 = nog niet getekend: de CSS-terugval blijft gelden
  root.setProperty('--offline-h', offline + 'px');
  root.setProperty('--banners-h', rond(offline + outbox) + 'px');
  if (topbar > 0) root.setProperty('--sticky-top', rond(topbar + offline + outbox) + 'px');
}

function start() {
  zetStickyOffsets();
  const ro = (typeof ResizeObserver !== 'undefined') ? new ResizeObserver(zetStickyOffsets) : null;
  const kop = document.querySelector('.topbar-sticky');
  if (kop && ro) ro.observe(kop);
  ['offline-banner', 'outbox-banner'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (ro) ro.observe(el);
    // display none <-> flex verandert de grootte; stijlwijzigingen vangen we hier extra op
    new MutationObserver(zetStickyOffsets).observe(el, { attributes: true, attributeFilter: ['style', 'class'] });
  });
  window.addEventListener('resize', zetStickyOffsets);
  window.addEventListener('apparaatwijziging', zetStickyOffsets); // rol/indeling/aanraak: tabs verschijnen of verdwijnen, de kop wisselt van hoogte
  window.addEventListener('load', zetStickyOffsets); // na het laden van lettertypen
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
