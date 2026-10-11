// schermen/beheer-beschikbaarheden.js — beheertab Beschikbaarheden: afwezigheden en uitzonderingen (verlof, dokter, opleiding) van een
// technieker of van iedereen. De inhoud is de bestaande tab uit schermen/beschikbaarheid.js (renderBeschikbaarhedenTab, zelfde
// functionaliteit, geen kopie); de techniekerkeuze zit in de tab zelf (los van de persoonskiezer bovenaan). Enkel beheerder en planner:
// de server beslist hoe dan ook wie /api/availability mag schrijven. Het blokkeringsvenster vanuit de kalender blijft ongewijzigd.
import { registreerBeheerTab, h } from './beheer.js';
import { renderBeschikbaarhedenTab } from './beschikbaarheid.js';

async function render(container) {
  const inhoud = h('div', { class: 'bav', id: 'beheer-beschikbaarheden-inhoud' });
  container.replaceChildren(
    h('div', { class: 'bg-kop' }, h('h3', { class: 'bg-titel', text: 'Beschikbaarheden' })),
    h('p', { class: 'bg-uitleg', text: 'Vul hier afwezigheden in (verlof, dokter, opleiding) voor een technieker of voor iedereen. Ze verschijnen in de kalender als blokkering.' }),
    inhoud);
  renderBeschikbaarhedenTab(inhoud);
}

registreerBeheerTab({ id: 'beschikbaarheden', label: 'Beschikbaarheden', render, rollen: ['beheerder', 'planner'] });
