// kern/tijd-picker.js — een tik op een tijd- of datumveld opent meteen de klok/kalender (uit fix/tijdveld-android, v1.10.4 op main).
// Op Android Chrome opende een tik op de tekst van een tijdveld niets (geen klok, geen toetsenbord); enkel het kleine
// klokje rechts werkte. Deze delegatie roept bij een tik op het veld zelf showPicker() aan, voor alle huidige en
// toekomstige tijd- en datumvelden. Geen `window`-toewijzing: document en window komen als parameter binnen (app.js).

// Welk element krijgt de picker? Enkel tijd- en datumvelden die bewerkbaar zijn.
export function isPickerVeld(el) {
  if (!el || typeof el.tagName !== 'string' || el.tagName.toUpperCase() !== 'INPUT') return false;
  const type = String(el.type || '').toLowerCase();
  if (type !== 'time' && type !== 'date') return false;
  return !el.readOnly && !el.disabled;
}

// Met een muis en toetsenbord (fijne aanwijzer) tik je op een onderdeel (uur/minuut) om te typen:
// daar blijft het gewone gedrag. Enkel bij aanraking (grove aanwijzer) openen we de picker.
export function wilPicker(el, grofPointer) {
  return grofPointer && isPickerVeld(el);
}

export function open(el) {
  try {
    if (typeof el.showPicker === 'function') el.showPicker();
  } catch { /* NotAllowedError, SecurityError of niet ondersteund: gewoon gedrag blijft */ }
}

export function grofPointer(win) {
  try {
    if (!win || typeof win.matchMedia !== 'function') return true;
    return !win.matchMedia('(pointer: fine)').matches;
  } catch { return true; }
}

export function installeerTijdPicker(doc, win) {
  doc.addEventListener('click', (ev) => {
    if (ev.defaultPrevented) return;
    const el = ev.target;
    if (wilPicker(el, grofPointer(win))) open(el);
  });
}
