// schermen/sales-venster.js — één plek voor de vensters van de sales-schermen (detail, resultaat, blok, instellingen).
// Overlay + modal (.overlay/.modal van app.css), geregistreerd bij venster.js (Escape, focusval, focus terug naar de opener).
// venster.js kent geen "afmelden": daarom een kleine pool van overlays die hergebruikt wordt i.p.v. een nieuwe per opening.
// Veiligheid: de titel komt via textContent; `bouw` vult de body zelf (vrije tekst enkel via textContent of escHtml).
import { registreerVenster } from '../venster.js';
import { registreerBackdrop } from '../kern/ui.js';

const pool = [];   // { el, titel, body, sluit: () => void | null }
let teller = 0;

function maakOverlay() {
  const nr = ++teller;
  const el = document.createElement('div');
  el.className = 'overlay sales-overlay';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  const modal = document.createElement('div');
  modal.className = 'modal sales-modal';
  const kop = document.createElement('div');
  kop.className = 'mhdr';
  const titel = document.createElement('div');
  titel.className = 'mhdr-title';
  titel.id = `sales-venster-titel-${nr}`;
  const kruis = document.createElement('button');
  kruis.type = 'button';
  kruis.className = 'mhdr-close';
  kruis.setAttribute('aria-label', 'Sluiten');
  kruis.textContent = '✕';
  kop.append(titel, kruis);
  const body = document.createElement('div');
  body.className = 'mbody sales-venster-body';
  modal.append(kop, body);
  el.appendChild(modal);
  el.setAttribute('aria-labelledby', titel.id);
  document.body.appendChild(el);

  const item = { el, titel, body, modal, sluit: null };
  kruis.addEventListener('click', () => item.sluit?.());
  registreerBackdrop(el, () => item.sluit?.());
  registreerVenster({ el, sluit: () => item.sluit?.() });
  pool.push(item);
  return item;
}

/** Opent een venster; `bouw(body, sluit)` vult de body. -> { sluit() } (sluiten is idempotent). */
export function openSalesVenster({ titel, bouw, breed = false }) {
  const item = pool.find(p => !p.sluit) ?? maakOverlay();
  document.body.appendChild(item.el); // een hergebruikte overlay komt weer bovenaan te liggen (gestapelde vensters)
  item.titel.textContent = String(titel ?? '');
  item.modal.classList.toggle('sales-modal-breed', breed === true);
  item.body.replaceChildren();
  let open = true;
  const sluit = () => {
    if (!open) return;
    open = false;
    item.sluit = null;
    item.el.classList.remove('open');
    item.body.replaceChildren();
  };
  item.sluit = sluit;
  try {
    bouw(item.body, sluit);
  } catch (fout) {
    sluit();
    throw fout;
  }
  item.el.classList.add('open');
  return { sluit };
}
