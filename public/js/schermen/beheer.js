// schermen/beheer.js — de beheerpagina: tabbalk (role=tablist, pijltjestoetsen) en een kleine venster-hulp (logins T17).
// Wordt lazy geladen door rol-schil.js (tab Beheer, enkel voor de beheerder); de server beslist wie /api/gebruikers e.d. mag gebruiken.
// De tabbladen registreren zichzelf via registreerBeheerTab; welke bestanden dat doen staat in beheer-tabs.js (één importregel per tab).
// Veiligheid: vrije tekst (namen, e-mails) komt uitsluitend via textContent/attributen in de DOM (h() gebruikt nooit innerHTML).

const KEUZE_SLEUTEL = 'blitz_beheer_tab'; // sessionStorage: het gekozen tabblad blijft staan binnen deze sessie
const tabs = []; // { id, label, render }

// registreerBeheerTab({ id, label, render }): render(container) -> Promise<void>. Dezelfde id vervangt de bestaande op dezelfde plaats.
export function registreerBeheerTab({ id, label, render } = {}) {
  if (typeof id !== 'string' || id === '' || typeof label !== 'string' || !(render instanceof Function)) return;
  const nieuw = { id, label, render };
  const i = tabs.findIndex(t => t.id === id);
  if (i >= 0) tabs[i] = nieuw; else tabs.push(nieuw);
}

// Kleine DOM-bouwer voor de beheerschermen: h('button', { class: 'btn', text: 'Ok', onclick }, ...kinderen).
// Strings als kind worden tekstknopen (nooit HTML); false/null/undefined worden overgeslagen.
export function h(tag, props = {}, ...kinderen) {
  const el = document.createElement(tag);
  for (const [sleutel, waarde] of Object.entries(props)) {
    if (waarde === undefined || waarde === null || waarde === false) continue;
    if (sleutel === 'class') el.className = waarde;
    else if (sleutel === 'text') el.textContent = waarde;
    else if (sleutel.startsWith('on') && waarde instanceof Function) el.addEventListener(sleutel.slice(2), waarde);
    else el.setAttribute(sleutel, waarde === true ? '' : String(waarde));
  }
  for (const kind of kinderen.flat()) if (kind !== null && kind !== undefined && kind !== false) el.append(kind);
  return el;
}

function leesKeuze() {
  try { return globalThis.sessionStorage.getItem(KEUZE_SLEUTEL); } catch { return null; }
}
function bewaarKeuze(id) {
  try { globalThis.sessionStorage.setItem(KEUZE_SLEUTEL, id); } catch { /* geen opslag */ }
}

// ── Tabbalk en paneel ───────────────────────────────────────────────────────────────────────────────────────────
export async function openBeheer(container) {
  await import('./beheer-tabs.js'); // registreert de tabbladen
  if (!container) return;
  let volgnummer = 0; // enkel de laatst gekozen tab mag zijn paneel vullen
  const titel = h('h2', { class: 'beheer-titel', text: 'Beheer' });
  const balk = h('div', { class: 'beheer-tabs', role: 'tablist', 'aria-label': 'Beheer' });
  let paneel = h('div', { class: 'beheer-paneel', role: 'tabpanel', tabindex: '0' });
  const wortel = h('div', { class: 'beheer' }, titel, balk, paneel);
  container.replaceChildren(wortel);

  if (tabs.length === 0) {
    paneel.textContent = 'Er zijn geen beheeronderdelen beschikbaar.';
    return;
  }
  const knoppen = new Map();
  for (const t of tabs) {
    const knop = h('button', {
      type: 'button', class: 'beheer-tab', role: 'tab', id: `beheer-tab-${t.id}`, 'aria-selected': 'false', tabindex: '-1', text: t.label,
    });
    knop.addEventListener('click', () => activeer(t.id, false));
    knoppen.set(t.id, knop);
    balk.append(knop);
  }

  async function activeer(id, focus) {
    const tab = tabs.find(t => t.id === id) || tabs[0];
    bewaarKeuze(tab.id);
    for (const [tid, knop] of knoppen) {
      const gekozen = tid === tab.id;
      knop.setAttribute('aria-selected', gekozen ? 'true' : 'false');
      knop.tabIndex = gekozen ? 0 : -1;
      knop.setAttribute('aria-controls', 'beheer-paneel');
    }
    if (focus) knoppen.get(tab.id).focus();
    const mijn = ++volgnummer;
    const nieuw = h('div', { class: 'beheer-paneel', role: 'tabpanel', tabindex: '0', id: 'beheer-paneel', 'aria-labelledby': `beheer-tab-${tab.id}`, 'aria-busy': 'true' });
    paneel.replaceWith(nieuw);
    paneel = nieuw;
    try {
      await tab.render(nieuw);
    } catch (fout) {
      console.error('Beheer-tab laden mislukt:', tab.id, fout);
      if (mijn === volgnummer) nieuw.replaceChildren(h('p', { class: 'beheer-fout', role: 'alert', text: 'Laden is mislukt. Probeer het opnieuw.' }));
    } finally {
      nieuw.removeAttribute('aria-busy');
    }
  }

  balk.addEventListener('keydown', (e) => {
    const ids = tabs.map(t => t.id);
    const huidig = ids.indexOf(String(e.target?.id ?? '').replace(/^beheer-tab-/, ''));
    if (huidig < 0) return;
    let volgende = null;
    if (e.key === 'ArrowRight') volgende = (huidig + 1) % ids.length;
    else if (e.key === 'ArrowLeft') volgende = (huidig - 1 + ids.length) % ids.length;
    else if (e.key === 'Home') volgende = 0;
    else if (e.key === 'End') volgende = ids.length - 1;
    if (volgende === null) return;
    e.preventDefault();
    activeer(ids[volgende], true);
  });

  const bewaard = leesKeuze();
  await activeer(tabs.some(t => t.id === bewaard) ? bewaard : tabs[0].id, false);
}

// ── Venster (modal dialoog) ─────────────────────────────────────────────────────────────────────────────────────
// openBeheerVenster({ titel, dwingend }) -> { body, wortel, sluit }. De bouwer vult `body` (DOM, geen innerHTML met servergegevens).
// dwingend: geen sluitknop, Escape of klik ernaast (venster met een eenmalig getoond geheim: enkel de eigen knop sluit).
// De rest van de pagina is onbereikbaar zolang het open is (inert), de focus blijft erbinnen en keert bij sluiten terug.
const FOCUSBAAR = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
let vensterTeller = 0;

export function openBeheerVenster({ titel, dwingend = false } = {}) {
  const vorigFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const titelId = `beheer-venster-titel-${++vensterTeller}`;
  const kop = h('div', { class: 'mhdr' }, h('h2', { class: 'mhdr-title', id: titelId, text: String(titel ?? '') }));
  const body = h('div', { class: 'beheer-venster-body' });
  const wortel = h('div', { class: 'modal beheer-venster', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titelId, tabindex: '-1' }, kop, body);
  const overlay = h('div', { class: 'overlay open beheer-overlay' }, wortel);
  let open = true;
  const geInerteerd = [...document.body.children].filter(el => el.id !== 'toast' && !el.inert && !el.classList.contains('beheer-overlay'));
  for (const el of geInerteerd) el.inert = true;

  function sluit() {
    if (!open) return;
    open = false;
    document.removeEventListener('keydown', opToets, true);
    for (const el of geInerteerd) el.inert = false;
    overlay.remove();
    try { if (vorigFocus && document.contains(vorigFocus)) vorigFocus.focus(); } catch { /* element is weg */ }
  }
  function opToets(e) {
    if (!open || !overlay.isConnected) return;
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      if (!dwingend) sluit();
      return;
    }
    if (e.key !== 'Tab') return;
    const lijst = [...wortel.querySelectorAll(FOCUSBAAR)].filter(el => el.offsetParent !== null || el === document.activeElement);
    if (lijst.length === 0) { e.preventDefault(); wortel.focus(); return; }
    const eerste = lijst[0];
    const laatste = lijst[lijst.length - 1];
    const actief = document.activeElement;
    if (!wortel.contains(actief)) { e.preventDefault(); eerste.focus(); }
    else if (e.shiftKey && actief === eerste) { e.preventDefault(); laatste.focus(); }
    else if (!e.shiftKey && actief === laatste) { e.preventDefault(); eerste.focus(); }
  }
  if (!dwingend) {
    kop.append(h('button', { type: 'button', class: 'mhdr-close', 'aria-label': 'Sluiten', text: '✕', onclick: sluit }));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) sluit(); });
  }
  document.addEventListener('keydown', opToets, true);
  document.body.appendChild(overlay);
  // Focus op het eerste invoerveld of de eerste knop in de inhoud (na het vullen door de bouwer, vandaar de microtask).
  queueMicrotask(() => {
    if (!open) return;
    if (wortel.contains(document.activeElement) && document.activeElement !== wortel) return;
    (body.querySelector(FOCUSBAAR) || wortel).focus();
  });
  return { body, wortel, sluit };
}
