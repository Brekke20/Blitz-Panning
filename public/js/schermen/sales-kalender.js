// schermen/sales-kalender.js — de tab "Kalender". TIJDELIJK (Task 13): een plaatshouder zodat de lazy import niet 404't; Task 16 vervangt dit bestand door het echte scherm.
import { startScherm } from './sales-schil.js';

function teken(inhoud) {
  const p = document.createElement('p');
  p.className = 'sales-leeg';
  p.textContent = 'De kalender volgt.';
  inhoud.replaceChildren(p);
}

export const toon = (view) => startScherm(view, teken);
