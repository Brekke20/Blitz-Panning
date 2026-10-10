// kern/kleur-keuze.js — de kleurkeuze voor de routelijn: een rij vaste kleuren om op te tikken (geen native kleurkiezer).
// Eén gedeelde helper: de reeks, de naamgeving en de opbouw van de knoppenrij. De bewaarde waarde blijft een hex-string
// (#rrggbb, kleine letters), dus geen datamigratie. Raakt `document` enkel binnen functies.
import { isKleur } from './instellingen-regels.js';

// 8 goed onderscheidbare kleuren die op de kaart zichtbaar blijven, licht én donker/satelliet. De eerste is de standaard
// (DEFAULT_SETTINGS.routeKleur, amber).
export const ROUTE_KLEUREN = [
  { naam: 'Oranje',    hex: '#f59e0b' },
  { naam: 'Blauw',     hex: '#2563eb' },
  { naam: 'Rood',      hex: '#dc2626' },
  { naam: 'Groen',     hex: '#16a34a' },
  { naam: 'Paars',     hex: '#9333ea' },
  { naam: 'Roze',      hex: '#ec4899' },
  { naam: 'Turkoois',  hex: '#0891b2' },
  { naam: 'Limoen',    hex: '#84cc16' },
];

const gelijk = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();

// De naam van een hex uit de reeks, anders 'Eigen kleur'.
export function kleurNaam(hex) {
  return ROUTE_KLEUREN.find(k => gelijk(k.hex, hex))?.naam ?? 'Eigen kleur';
}

// De staaltjes die getoond worden: de vaste reeks, plus (als `gekozen` een geldige hex is die er niet in zit, bv. een eerder met de
// kleurkiezer bewaarde kleur) die kleur als extra staaltje achteraan, zodat er niets verloren gaat.
export function kleurOpties(gekozen) {
  const lijst = ROUTE_KLEUREN.map(k => ({ ...k, extra: false }));
  if (isKleur(gekozen) && !ROUTE_KLEUREN.some(k => gelijk(k.hex, gekozen))) lijst.push({ naam: 'Eigen kleur', hex: gekozen.toLowerCase(), extra: true });
  return lijst;
}

// De gekozen waarde van een opgebouwde kleurkeuze ('' als er niets gekozen is).
export function leesKleurKeuze(container) {
  return container?.dataset?.waarde ?? '';
}

// Bouwt (of herbouwt) de knoppenrij in `container` (het element met role="group"). `gekozen`: de huidige hex (ongeldig of leeg: de eerste
// kleur uit de reeks, de standaard). `bijKeuze(hex)` wordt na een tik aangeroepen. De waarde staat in container.dataset.waarde.
export function bouwKleurKeuze(container, gekozen, bijKeuze) {
  if (!container) return;
  const huidig = isKleur(gekozen) ? gekozen.toLowerCase() : ROUTE_KLEUREN[0].hex;
  container.dataset.waarde = huidig;
  container.classList.add('kleur-keuze');
  container.replaceChildren(...kleurOpties(huidig).map((k) => {
    const aan = gelijk(k.hex, huidig);
    const knop = document.createElement('button');
    knop.type = 'button';
    knop.className = 'kleur-staal' + (aan ? ' on' : '');
    knop.style.background = k.hex;
    knop.dataset.kleur = k.hex;
    knop.setAttribute('aria-label', k.naam);
    knop.setAttribute('aria-pressed', aan ? 'true' : 'false');
    knop.title = k.naam;
    knop.textContent = aan ? '✓' : '';
    knop.addEventListener('click', () => {
      bouwKleurKeuze(container, k.hex, bijKeuze);
      container.querySelector(`.kleur-staal[data-kleur="${k.hex}"]`)?.focus(); // de keuze herbouwt de rij: de focus blijft op het gekozen staaltje
      bijKeuze?.(k.hex);
    });
    return knop;
  }));
}
