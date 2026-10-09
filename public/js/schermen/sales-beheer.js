// schermen/sales-beheer.js — de tab "Sales" van de beheerder: één tab met een eigen subtabbalk (Te plannen · Kalender · Route · Afgewerkt) en,
// in elk scherm, de verkoperkeuze (sales-schil.js). Zelfde tablist-patroon als de Beheer-pagina (pijltjestoetsen, Home/End, roving tabindex);
// het gekozen subtab blijft in sessionStorage. De subtabs en hun panelen bestaan enkel binnen #view-sales (de panelen hebben de id's
// `view-sales-<scherm>`, zodat `zorgVoorView` ze vindt) en dragen een eigen aria-label: de tabnamen in de hoofdbalk blijven eenduidig.
// Een sales-gebruiker heeft deze module niet nodig: die krijgt de vier schermen als gewone tabs (sales-registratie.js).
import { zorgVoorStijl } from './sales-schil.js';

const KEUZE_SLEUTEL = 'blitz_sales_subtab';

const leesKeuze = () => { try { return globalThis.sessionStorage.getItem(KEUZE_SLEUTEL); } catch { return null; } };
const bewaarKeuze = (id) => { try { globalThis.sessionStorage.setItem(KEUZE_SLEUTEL, id); } catch { /* geen opslag */ } };

function el(tag, props = {}) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v === true ? '' : String(v));
  }
  return e;
}

const staten = new WeakMap(); // view -> { activeer(id, focus) }

function bouw(view, tabs) {
  zorgVoorStijl();
  const balk = el('div', { class: 'sales-subtabs', role: 'tablist', 'aria-label': 'Sales-onderdelen' });
  const wortel = el('div', { class: 'sales-beheer' });
  wortel.append(el('h2', { class: 'sales-titel', text: 'Sales' }), balk);
  const knoppen = new Map();
  const panelen = new Map();
  for (const t of tabs) {
    const knop = el('button', { type: 'button', class: 'sales-subtab', role: 'tab', id: `sales-subtab-${t.id}`, 'aria-selected': 'false', 'aria-controls': `view-${t.id}`, tabindex: '-1', text: t.label });
    knop.addEventListener('click', () => activeer(t.id, false));
    balk.append(knop);
    knoppen.set(t.id, knop);
    const paneel = el('div', { class: 'sales-subpaneel', role: 'tabpanel', id: `view-${t.id}`, 'aria-labelledby': knop.id, hidden: true });
    wortel.append(paneel);
    panelen.set(t.id, paneel);
  }
  view.replaceChildren(wortel);

  async function activeer(id, focus) {
    const tab = tabs.find(t => t.id === id) || tabs[0];
    bewaarKeuze(tab.id);
    for (const [tid, knop] of knoppen) {
      const gekozen = tid === tab.id;
      knop.setAttribute('aria-selected', gekozen ? 'true' : 'false');
      knop.tabIndex = gekozen ? 0 : -1;
      panelen.get(tid).hidden = !gekozen;
    }
    if (focus) knoppen.get(tab.id).focus();
    try { await tab.laad(); } catch (fout) { console.error('Sales-subtab laden mislukt:', tab.id, fout); }
  }

  balk.addEventListener('keydown', (e) => {
    const ids = tabs.map(t => t.id);
    const huidig = ids.indexOf(String(e.target?.id ?? '').replace(/^sales-subtab-/, ''));
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
  return { activeer };
}

/** Bouwt (eenmalig) de subtabbalk in `view` en activeert het bewaarde subtab; wordt bij elke wissel naar de tab Sales opnieuw aangeroepen. */
export async function openSalesBeheer(view, tabs) {
  if (!view) return;
  let s = staten.get(view);
  if (!s) { s = bouw(view, tabs); staten.set(view, s); }
  const bewaard = leesKeuze();
  await s.activeer(tabs.some(t => t.id === bewaard) ? bewaard : tabs[0].id, false);
}
