// schermen/plan-resultaat.js — het resultaatvenster van "Plan deze week" (#result-overlay in index.html), gedeeld door de planning van de
// technieker (planacties.js) en die van de verkoper (sales-plan.js): zelfde venster, zelfde opbouw (secties Ingepland, Niet ingepland en
// Overgeslagen met een gekleurd bolletje per regel), zelfde sluiten (✕, achtergrond of Escape). De sales-tabs draaien zonder de gewone
// opstart (app.js), dus het venster registreert zichzelf bij het eerste gebruik; `initPlanResultaat` is idempotent.
// Veiligheid: alle teksten (ook namen van leads) gaan door escHtml.
import { escHtml, registreerActies, registreerBackdrop } from '../kern/ui.js';
import { registreerVenster } from '../venster.js';

let gebonden = false;

const zichtbaar = (el) => el.getClientRects().length > 0;
// De knop "Plan deze week" om naar terug te keren als de opener weg is (de kalender van de verkoper tekent zich na het plannen opnieuw).
const planKnop = () => [...document.querySelectorAll('.btn-autoplan')].find(zichtbaar) ?? null;

/** Sluit het venster. Met een klik-gebeurtenis (achtergrond) enkel als er op de achtergrond zelf geklikt werd. */
export function sluitPlanResultaat(e) {
  const overlay = document.getElementById('result-overlay');
  if (!overlay) return;
  if (e && e.target !== overlay) return;
  overlay.classList.remove('open');
}

/** Koppelt sluiten (✕, achtergrond, Escape) en focusbeheer aan het venster; veilig om meermaals aan te roepen. */
export function initPlanResultaat() {
  if (gebonden) return;
  const overlay = document.getElementById('result-overlay');
  if (!overlay) return;
  gebonden = true;
  registreerActies(document.body, { 'result-sluit': () => sluitPlanResultaat() });
  registreerBackdrop(overlay, sluitPlanResultaat);
  registreerVenster({ el: overlay, sluit: () => sluitPlanResultaat(), terugFocus: planKnop });
}

const rij = (kleur, binnen) => {
  const r = document.createElement('div');
  r.className = 'result-item';
  r.innerHTML = `<div class="result-dot ${kleur}"></div><div>${binnen}</div>`;
  return r;
};
const sectie = (titel, rijen) => {
  const s = document.createElement('div');
  s.className = 'result-section';
  s.innerHTML = `<div class="result-section-title">${escHtml(titel)}</div>`;
  rijen.forEach((r) => s.appendChild(r));
  return s;
};
// "<b>#1001</b> onderwerp": zonder onderwerp (een lead) enkel de vetgedrukte naam.
const kop = ({ vet, tekst }) => `<b>${escHtml(vet)}</b>${tekst ? ` ${escHtml(tekst)}` : ''}`;
const stil = (tekst) => {
  const p = document.createElement('p');
  p.style.cssText = 'color:var(--muted);font-size:0.83rem';
  p.textContent = tekst;
  return p;
};

/**
 * Toont het resultaat. Alle velden zijn optioneel.
 *  - bericht: een losse melding bovenaan (bv. maandweergave, geen dagen meer)
 *  - waarschuwingen: [tekst] (zonder ⚠; dat zet dit venster ervoor)
 *  - ingepland: [{ vet, tekst?, label }]      "<vet> <tekst> → <label>"
 *  - nietIngepland: [{ vet, tekst?, reden }]  met de reden eronder
 *  - overgeslagen: { titel, items: [{ vet, tekst? }] }
 */
export function toonPlanResultaat({ bericht, waarschuwingen = [], ingepland = [], nietIngepland = [], overgeslagen } = {}) {
  initPlanResultaat();
  const body = document.getElementById('result-body');
  const overlay = document.getElementById('result-overlay');
  if (!body || !overlay) return;
  body.innerHTML = '';
  if (bericht) body.appendChild(stil(bericht));
  waarschuwingen.forEach((w) => body.appendChild(stil(`⚠ ${w}`)));
  if (ingepland.length) {
    body.appendChild(sectie(`Ingepland (${ingepland.length})`,
      ingepland.map((i) => rij('ok', `${kop(i)} → ${escHtml(i.label)}`))));
  }
  if (nietIngepland.length) {
    body.appendChild(sectie(`Niet ingepland (${nietIngepland.length})`,
      nietIngepland.map((n) => rij('skip', `${kop(n)}<div style="color:var(--muted);font-size:0.78rem">${escHtml(n.reden)}</div>`))));
  }
  if (overgeslagen?.items?.length) {
    body.appendChild(sectie(`${overgeslagen.titel} (${overgeslagen.items.length})`, overgeslagen.items.map((i) => rij('skip', kop(i)))));
  }
  overlay.classList.add('open');
}
