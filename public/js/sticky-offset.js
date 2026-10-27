// public/js/sticky-offset.js
// De ENIGE bron voor de sticky-offsets van de app (v2.0.1). Houdt CSS-variabelen bij, berekend uit wat echt op het scherm staat:
//   --topbar-h  : hoogte van kop + tabbalk samen (.topbar-sticky)
//   --offline-h : hoogte van de offline-balk (0 als die verborgen is)
//   --banners-h : hoogte van offline- plus outbox-balk samen (0 als beide verborgen zijn)
//   --sticky-top: onderkant van kop + tabbalk + zichtbare meldingsbalken = de `top` van elke sticky balk onder de tabbladen
//                 (.lijst-balk, .kal-header, .route-balk, .gep-week, de filterbalk van Rapporten, ...).
//   --dok-h     : de ruimte die het dok onderaan inneemt (Open dag, taak 5): van de bovenkant van het dok (.tabs in het vaste kader nav, onderaan op
//                 `smal` en `tablet-staand`) tot de onderkant van het scherm, dus met de marge en de veilige zone; 0 op `breed`
//                 (daar is .tabs de zijkolom). css/navigatie.css geeft de inhoud, het meldingsvak en de Route-tab die ruimte onderaan.
//                 De tabbalk is op elk toestel `position: fixed` en telt dus niet meer mee in --topbar-h (die is nu enkel de kop).
// Nooit een vaste top-waarde in CSS: altijd `top: var(--sticky-top, <terugval>)`. Verandert er iets aan kop, tabbalk of meldingsbalken
// (gsm/aanraak-hoogte, tab die verdwijnt, offline-balk), dan volgen de variabelen via ResizeObserver, MutationObserver en resize.
function hoogteVan(el) {
  if (!el || getComputedStyle(el).display === 'none') return 0;
  return el.getBoundingClientRect().height;
}

const rond = (px) => Math.round(px * 10) / 10;

// Het dok bestaat enkel op de indelingen van gsm en staande tablet (apparaat.js zet data-indeling); verborgen = 0.
function dokRuimte() {
  const indeling = document.documentElement.getAttribute('data-indeling');
  if (indeling !== 'smal' && indeling !== 'tablet-staand') return 0;
  const dok = document.querySelector('.tabs');
  if (!dok || getComputedStyle(dok).display === 'none') return 0;
  const r = dok.getBoundingClientRect();
  if (r.height === 0) return 0;
  return Math.max(0, window.innerHeight - r.top);
}

export function zetStickyOffsets() {
  const root = document.documentElement.style;
  const topbar = rond(hoogteVan(document.querySelector('.topbar-sticky')));
  const offline = rond(hoogteVan(document.getElementById('offline-banner')));
  const outbox = rond(hoogteVan(document.getElementById('outbox-banner')));
  if (topbar > 0) root.setProperty('--topbar-h', topbar + 'px'); // 0 = nog niet getekend: de CSS-terugval blijft gelden
  root.setProperty('--offline-h', offline + 'px');
  root.setProperty('--banners-h', rond(offline + outbox) + 'px');
  if (topbar > 0) root.setProperty('--sticky-top', rond(topbar + offline + outbox) + 'px');
  root.setProperty('--dok-h', rond(dokRuimte()) + 'px');
}

function start() {
  zetStickyOffsets();
  const ro = (typeof ResizeObserver !== 'undefined') ? new ResizeObserver(zetStickyOffsets) : null;
  const kop = document.querySelector('.topbar-sticky');
  if (kop && ro) ro.observe(kop);
  const dok = document.querySelector('.tabs'); // het dok (gsm, staande tablet) wisselt van hoogte als tabs verschijnen of de letters laden
  if (dok && ro) ro.observe(dok);
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
