// schermen/beheer-beschikbaarheden.js — beheertab Beschikbaarheden: afwezigheden en uitzonderingen (verlof, dokter, opleiding) van een
// technieker, van een verkoper (enkel de beheerder; komt als blok in zijn sales-agenda) of van iedereen (= alle techniekers). De inhoud is de bestaande tab uit schermen/beschikbaarheid.js (renderBeschikbaarhedenTab, zelfde
// functionaliteit, geen kopie); de keuze "Voor wie" (alle actieve accounts die plannen of verkopen, uit /api/gebruikers) zit in de tab zelf (los van de persoonskiezer bovenaan). Enkel beheerder en planner:
// de server beslist hoe dan ook wie /api/availability mag schrijven. Het blokkeringsvenster vanuit de kalender blijft ongewijzigd.
import { registreerBeheerTab, beheerVerzoek, beheerRolVan, h } from './beheer.js';
import { huidigeGebruiker } from '../kern/sessie.js';
import { renderBeschikbaarhedenTab } from './beschikbaarheid.js';

async function render(container) {
  const inhoud = h('div', { class: 'bav', id: 'beheer-beschikbaarheden-inhoud' });
  container.replaceChildren(
    h('div', { class: 'bg-kop' }, h('h3', { class: 'bg-titel', text: 'Beschikbaarheden' })),
    h('p', { class: 'bg-uitleg', text: 'Vul hier afwezigheden in (verlof, dokter, opleiding) voor een technieker of voor iedereen. Ze verschijnen in de kalender als blokkering.' }),
    inhoud);
  // De keuzelijst "Voor wie" = actieve accounts met een Zoho-naam. Lukt het laden niet, dan blijft de tab werken met de terugval
  // (tickets + bestaande afwezigheden).
  const r = await beheerVerzoek('/api/gebruikers');
  renderBeschikbaarhedenTab(inhoud, { gebruikers: r.ok ? r.data?.gebruikers : null, kijkerRol: beheerRolVan(huidigeGebruiker()) });
}

registreerBeheerTab({ id: 'beschikbaarheden', label: 'Beschikbaarheden', render, rollen: ['beheerder', 'planner'] });
