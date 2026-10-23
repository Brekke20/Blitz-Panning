// spel/skin-kleuren.js — de pure kleurconstanten en skin-id's van Blitz Run, zonder tekenwerk.
// Bestaat apart van skins.js omdat de validator van themapakketten (kern/themapakket-validatie.js, bij de opstart geladen) ze nodig heeft:
// zo blijft skins.js (met het tekenwerk en de skinlijsten) lazy, samen met de rest van het spel.

// Nachthemel van het spel (verloop boven -> onder) en de lichte contour van de paal: de paal moet bij elke skin duidelijk
// afsteken, ook als de behuizing zelf donker is. `tests/spel-skins.test.mjs` bewaakt een contrast van minstens 3:1;
// de validator eist hetzelfde van elke themaskin.
export const HEMEL = Object.freeze({ boven: '#2f4358', onder: '#1b2836' });
export const RAND_KLEUR = '#e9f2f8';

// De ids van de ingebouwde skins (tien basisskins en goud): gereserveerd, een thema-id mag er niet mee samenvallen.
// `tests/spel-skins.test.mjs` bewaakt dat dit precies de ids van BASIS_SKINS in skins.js zijn.
export const BASIS_SKIN_IDS = Object.freeze([
  'blitz', 'olijf', 'nachtblauw', 'bordeaux', 'snellader', 'stroomstoot', 'turbo', 'oceaan', 'ultraviolet', 'poolijs', 'goud',
]);
