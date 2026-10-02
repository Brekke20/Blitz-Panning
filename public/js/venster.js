// Venster-beheer: één Escape-luisteraar (enkel het bovenste venster sluit), een focusval binnen
// het bovenste open venster en focus onthouden/terugzetten bij openen/sluiten.
// appConfirm (app-dialog.js) heeft zijn eigen capture-Escape/Tab; zolang die open is doet dit niets.

const FOCUSBAAR = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const TEKSTVELD = 'input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=file]), textarea, select';

const vensters = []; // { el, isOpen, sluit, vorigeFocus, wasOpen } — volgorde = DOM-volgorde bij registratie

const zichtbaar = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
const focusbaar = venster => [...venster.querySelectorAll(FOCUSBAAR)].filter(zichtbaar);
const appDialogOpen = () => document.querySelector('.app-dialog-overlay') !== null;

function bovenste() {
  let beste = null, bz = -Infinity;
  for (const v of vensters) {
    if (!v.isOpen()) continue;
    const z = parseInt(getComputedStyle(v.el).zIndex, 10) || 0;
    // gelijke z-index: het venster dat later in de DOM staat ligt erboven
    if (z > bz || (z === bz && (v.el.compareDocumentPosition(beste.el) & Node.DOCUMENT_POSITION_PRECEDING))) { beste = v; bz = z; }
  }
  return beste;
}

// Erfenis (N11): sluit venster A stil en opent binnen ERFENIS_MS venster B (bv. detail -> voorstel, instellingen -> prijsbeheer),
// dan staat de opener van A in een onzichtbaar venster; B neemt de opener van A over zodat de focus na sluiten logisch terugkeert.
const ERFENIS_MS = 500;
let laatsteSluiting = null; // { opener, t } — de vorigeFocus van het laatst gesloten venster

const bruikbaar = f => !!f && f !== document.body && document.contains(f) && zichtbaar(f);

// Optioneel `terugFocus: () => HTMLElement | null`: plek waar de focus naartoe gaat als de opener onbruikbaar is
// (bv. een knop die tijdens het werk uitgeschakeld was).
function registreer({ el, isOpen, sluit, terugFocus }) {
  if (!el) return;
  if (!el.hasAttribute('tabindex')) el.tabIndex = -1;
  const v = { el, isOpen: isOpen || (() => el.classList.contains('open')), sluit, vorigeFocus: null, wasOpen: false, geopendOp: -Infinity };
  v.wasOpen = v.isOpen();
  vensters.push(v);
  new MutationObserver(() => {
    const open = v.isOpen();
    if (open === v.wasOpen) return;
    v.wasOpen = open;
    if (open) {
      v.vorigeFocus = document.activeElement !== document.body ? document.activeElement : null;
      // De focus is weg (<body>), zit in een venster dat net sloot of al in dit venster zelf: erf de opener van dat venster.
      if (!(bruikbaar(v.vorigeFocus) && !el.contains(v.vorigeFocus)) && laatsteSluiting && performance.now() - laatsteSluiting.t < ERFENIS_MS && bruikbaar(laatsteSluiting.opener)) {
        v.vorigeFocus = laatsteSluiting.opener;
      }
      v.geopendOp = performance.now();
      laatsteSluiting = null;
      // Eerste knop/link krijgt de focus; tekstvelden niet (zou op tablets meteen het toetsenbord openen).
      const eerste = focusbaar(el).find(x => !x.matches(TEKSTVELD));
      (eerste || el).focus({ preventScroll: true });
    } else {
      let f = v.vorigeFocus;
      v.vorigeFocus = null;
      laatsteSluiting = { opener: f, t: performance.now() };
      if (appDialogOpen()) return;
      const boven = bovenste();
      // Volgorde van de waarnemers is niet gegarandeerd: opende B al vóór deze sluiting verwerkt werd, geef B de opener alsnog.
      if (boven && boven !== v && bruikbaar(f) && !(bruikbaar(boven.vorigeFocus) && !boven.el.contains(boven.vorigeFocus)) && performance.now() - boven.geopendOp < ERFENIS_MS) boven.vorigeFocus = f;
      if (!bruikbaar(f) && terugFocus) {
        let alt = null;
        try { alt = terugFocus(); } catch (e) {}
        if (bruikbaar(alt)) f = alt;
      }
      if (f && bruikbaar(f) && (!boven || boven.el.contains(f))) {
        try { f.focus({ preventScroll: true }); } catch (e) {}
      } else if (boven && !boven.el.contains(document.activeElement)) {
        // Gestapeld venster gesloten en de opener is weg: focus naar het venster eronder, niet naar <body>
        (focusbaar(boven.el).find(x => !x.matches(TEKSTVELD)) || boven.el).focus({ preventScroll: true });
      }
    }
  }).observe(el, { attributes: true, attributeFilter: ['class'] });
}

// Sluit enkel het bovenste open venster; geeft terug of er iets werd afgehandeld.
function sluitBovenste() {
  if (appDialogOpen()) return false;
  const v = bovenste();
  if (!v) return false;
  v.sluit(); // kan zelf een bevestiging vragen (wizard, prijsbeheer)
  return true;
}

document.addEventListener('keydown', e => {
  if (e.defaultPrevented || appDialogOpen()) return;
  if (e.key === 'Escape') {
    if (sluitBovenste()) e.preventDefault();
  } else if (e.key === 'Tab') {
    const v = bovenste();
    if (!v) return;
    const lijst = focusbaar(v.el);
    if (!lijst.length) { e.preventDefault(); v.el.focus(); return; }
    const eerste = lijst[0], laatste = lijst[lijst.length - 1];
    const actief = document.activeElement;
    if (!v.el.contains(actief) || actief === v.el) {
      e.preventDefault(); (e.shiftKey ? laatste : eerste).focus();
    } else if (e.shiftKey && actief === eerste) {
      e.preventDefault(); laatste.focus();
    } else if (!e.shiftKey && actief === laatste) {
      e.preventDefault(); eerste.focus();
    }
  }
});

export { registreer as registreerVenster };
