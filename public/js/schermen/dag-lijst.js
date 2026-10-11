// schermen/dag-lijst.js — wat de dagen onder elkaar (gsm-dagoverzicht) van de techniekerkalender (kalender.js) en van de verkoperkalender
// (sales-kalender.js) delen: de rode regel "nu 10:42" vóór het eerstvolgende kaartje van vandaag en de badge "buiten werkuren".
// Beide kalenders zetten `data-sortkey="HH:MM"` ('99:99' = zonder uur, telt als later) op elk kaartje van een `.day-body`.
import { localISO } from '../kern/tijd.js';
import { isBuitenWerkuren } from './kalender-logica.js';

/**
 * Zet (of verplaatst) de nu-regel in de lijst van vandaag binnen `grid` en haalt elke andere weg. Geen kolom van vandaag of een tijdlijn
 * (`.tl-wrap`) in die kolom: geen regel. De regel staat vóór de eerste kaart met een sortkey later dan nu, anders achteraan.
 */
export function updateNuMarker(grid, nu = new Date()) {
  if (!grid) return;
  const hhmm = `${String(nu.getHours()).padStart(2, '0')}:${String(nu.getMinutes()).padStart(2, '0')}`;
  const body = grid.querySelector(`.day-col[data-date="${localISO(nu)}"] .day-body`);
  grid.querySelectorAll('.kal-nu-marker').forEach(el => { if (!body || el.parentNode !== body) el.remove(); });
  if (!body || body.querySelector('.tl-wrap')) return;
  let marker = body.querySelector(':scope > .kal-nu-marker');
  if (!marker) { marker = document.createElement('div'); marker.className = 'kal-nu-marker'; }
  marker.textContent = `nu ${hhmm}`;
  const kaarten = Array.from(body.querySelectorAll(':scope > [data-sortkey]'));
  const volgende = kaarten.find(k => k.dataset.sortkey > hhmm);
  if (volgende) body.insertBefore(marker, volgende); else body.appendChild(marker);
}

/** Voegt de badge "buiten werkuren" toe aan `kaart` (na `ankerSelector`, anders vooraan) als `sortKey` buiten de werkuren valt. */
export function voegBuitenUrenBadgeToe(kaart, sortKey, ankerSelector) {
  if (!isBuitenWerkuren(sortKey)) return null;
  const badge = document.createElement('span');
  badge.className = 'badge-buitenuren';
  badge.textContent = 'buiten werkuren';
  const anker = ankerSelector ? kaart.querySelector(ankerSelector) : null;
  if (anker) anker.after(badge); else kaart.prepend(badge);
  return badge;
}
