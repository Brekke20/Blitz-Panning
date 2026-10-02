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

function registreer({ el, isOpen, sluit }) {
  if (!el) return;
  if (!el.hasAttribute('tabindex')) el.tabIndex = -1;
  const v = { el, isOpen: isOpen || (() => el.classList.contains('open')), sluit, vorigeFocus: null, wasOpen: false };
  v.wasOpen = v.isOpen();
  vensters.push(v);
  new MutationObserver(() => {
    const open = v.isOpen();
    if (open === v.wasOpen) return;
    v.wasOpen = open;
    if (open) {
      v.vorigeFocus = document.activeElement !== document.body ? document.activeElement : null;
      // Eerste knop/link krijgt de focus; tekstvelden niet (zou op tablets meteen het toetsenbord openen).
      const eerste = focusbaar(el).find(x => !x.matches(TEKSTVELD));
      (eerste || el).focus({ preventScroll: true });
    } else {
      const f = v.vorigeFocus;
      v.vorigeFocus = null;
      if (appDialogOpen()) return;
      const boven = bovenste();
      if (f && document.contains(f) && zichtbaar(f) && (!boven || boven.el.contains(f))) {
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
window.vensterBeheer = { registreer, sluitBovenste };

// Bestaande vensters. Sluitfuncties zijn globals (classic script of window.*); lazy opgezocht.
const sluitVia = naam => () => window[naam]?.();
[
  ['set-overlay', 'closeSettings'],
  ['result-overlay', 'closeResult'],
  ['rapport-preview-overlay', 'closeRapportPreview'], ['manueel-overlay', 'closeManueelModal'],
  ['import-overlay', 'closeImportModal'], ['local-det-overlay', 'closeLocalDet'], ['foto-overlay', 'closeFotoModal'],
  ['prijs-overlay', 'closePrijsBeheer'], ['rapport-wizard', 'closeWizard'],
].forEach(([id, fn]) => registreer({ el: document.getElementById(id), sluit: sluitVia(fn) }));
