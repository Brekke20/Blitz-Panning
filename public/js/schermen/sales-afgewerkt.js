// schermen/sales-afgewerkt.js — de tab "Afgewerkt": de afgewerkte leads met resultaat, datum en notitie, nieuwste eerst; filter op
// resultaat en periode. Een rij opent het leaddetail (historiek, en daar kan een verkeerde klik hersteld worden met "Terug naar te plannen").
// Werkt als gewone tab van de verkoper en als subtab van de beheerder (de view komt van startScherm).
// Veiligheid: alle leadgegevens komen via textContent in de DOM (sales-dom.js).
import { maakActiveerbaar } from '../kern/ui.js';
import { RESULTAAT_LABEL } from '../sales/lead-regels.js';
import { startScherm } from './sales-schil.js';
import { salesToestand } from './sales-data.js';
import { openLeadDetail } from './sales-detail.js';
import { afgewerktRijen } from './sales-lijst-logica.js';
import { dagLabel } from './sales-tekst.js';
import { el } from './sales-dom.js';

const PERIODES = [['alles', 'Alles'], ['30d', 'Laatste 30 dagen'], ['3m', 'Laatste 3 maanden'], ['12m', 'Laatste 12 maanden']];
const AFWERKSOORTEN = ['offerte', 'verkocht', 'geen-interesse'];     // 'opnieuw' maakt een lead nooit afgewerkt
const filter = { resultaat: '', periode: 'alles' };                    // blijft staan bij een tabwissel
const wortels = new WeakMap();                                         // inhoud -> { el, vul() }

function maakRij(r) {
  const rij = el('div', { class: 'sales-afgewerkt-rij', 'data-lead-id': r.leadId });
  const open = () => openLeadDetail(r.leadId);
  maakActiveerbaar(rij, open, `Open ${r.naam}`);
  rij.addEventListener('click', open);
  rij.append(
    el('div', { class: 'sales-afgewerkt-kop' },
      el('span', { class: 'sales-kaart-titel', text: r.naam }),
      el('span', { class: `sales-chip sales-resultaat-chip sales-resultaat-chip-${r.soort}`, text: r.label })),
    el('div', { class: 'sales-afgewerkt-datum', text: dagLabel(r.datum) || r.datumLabel }),
  );
  if (r.notitie) rij.append(el('div', { class: 'sales-afgewerkt-notitie', text: r.notitie }));
  return rij;
}

function bouwWortel() {
  const resultaat = el('select', { class: 'sales-gebied' },
    el('option', { value: '', text: 'Alle resultaten' }), ...AFWERKSOORTEN.map(s => el('option', { value: s, text: RESULTAAT_LABEL[s] })));
  const periode = el('select', { class: 'sales-gebied' }, ...PERIODES.map(([w, t]) => el('option', { value: w, text: t })));
  const kies = (label, keuze) => el('label', { class: 'sales-verkoper' }, el('span', { class: 'sales-verkoper-label', text: label }), keuze);
  const filterbalk = el('div', { class: 'sales-filter' }, kies('Resultaat', resultaat), kies('Periode', periode));
  const lijst = el('div', { class: 'sales-afgewerkt-lijst' });
  const wortel = el('div', { class: 'sales-afgewerkt-wortel' }, filterbalk, lijst);

  function tekenLijst() {
    const st = salesToestand();
    if (!st.leads.some(l => l.status === 'afgewerkt')) { lijst.replaceChildren(el('p', { class: 'sales-leeg', text: 'Nog geen afgewerkte leads.' })); return; }
    const rijen = afgewerktRijen(st.leads, { resultaat: filter.resultaat, periode: filter.periode, nu: new Date() });
    if (!rijen.length) { lijst.replaceChildren(el('p', { class: 'sales-leeg', text: 'Geen afgewerkte leads voor deze keuze.' })); return; }
    lijst.replaceChildren(...rijen.map(maakRij));
  }

  function vul() {
    resultaat.value = filter.resultaat;
    periode.value = filter.periode;
    filterbalk.hidden = !salesToestand().leads.some(l => l.status === 'afgewerkt');
    tekenLijst();
  }

  resultaat.addEventListener('change', () => { filter.resultaat = resultaat.value; tekenLijst(); });
  periode.addEventListener('change', () => { filter.periode = periode.value; tekenLijst(); });
  return { el: wortel, vul };
}

function teken(inhoud) {
  let w = wortels.get(inhoud);
  if (!w) { w = bouwWortel(); wortels.set(inhoud, w); }
  if (w.el.parentNode !== inhoud) inhoud.replaceChildren(w.el); // startScherm kan een melding in `inhoud` gezet hebben
  w.vul();
}

export const toon = (view) => startScherm(view, teken);
