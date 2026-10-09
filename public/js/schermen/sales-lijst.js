// schermen/sales-lijst.js — de tab "Te plannen". TIJDELIJK (Task 13): enkel de lege toestand; Task 14 vervangt dit bestand door het echte scherm.
import { startScherm } from './sales-schil.js';
import { salesToestand } from './sales-data.js';

function teken(inhoud) {
  const open = salesToestand().leads.filter(l => l.status !== 'afgewerkt');
  const p = document.createElement('p');
  p.className = 'sales-leeg';
  p.textContent = open.length === 0 ? 'Nog geen leads. Laad een export.' : `${open.length} leads`;
  inhoud.replaceChildren(p);
}

export const toon = (view) => startScherm(view, teken);
