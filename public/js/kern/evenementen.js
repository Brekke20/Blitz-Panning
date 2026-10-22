// kern/evenementen.js — de ENIGE kalender van feestelijke evenementen (puur: geen DOM, geen window, geen opslag).
// Twee afnemers: de app-versiering (schermen/evenement-laag.js) en later het dino-spel (`spelSkin`: de skin-id die in het venster
// van het evenement beschikbaar is; ontgrendeld in Blitz Run).
//
// Een evenement is een JAARLIJKS terugkerend venster in Belgische kalenderdagen (Europe/Brussels), grenzen inclusief:
//   { id, naam, van: { maand, dag }, tot: { maand, dag }, thema, spelSkin }
// `van` na `tot` (Kerst: 1 dec tot 6 jan) betekent een venster over de jaarwissel. `thema` is de naam van een thema-implementatie
// (enkel 'halloween' bestaat) of null: een evenement zonder thema is wel actief maar toont niets.
// De lijst staat hard in de code (wijzigt enkele keren per jaar en moet offline werken); een nieuw thema is een nieuwe release.
// Bij overlap wint de volgorde van de lijst.
//
// Bewust weggelaten: Pasen. Pasen is beweeglijk (datum hangt van het jaar af) en heeft nog geen thema; het komt erbij zodra
// het thema er is, met `van`/`tot` als functie van het jaar (feestdagen.js heeft de paasberekening).

import { belgischeDag } from './themapakket.js';

export const MAX_SPINNEN = 3; // harde bovengrens op bewegende spinnen, in de thema-definitie en getest

export const EVENEMENTEN = [
  { id: 'halloween', naam: 'Halloween', van: { maand: 10, dag: 1 }, tot: { maand: 10, dag: 31 }, thema: 'halloween', spelSkin: 'halloween' },
  // Kerst: nog geen thema (thema: null), maar dit venster over de jaarwissel houdt de kalender eerlijk en getest.
  { id: 'kerst', naam: 'Kerst', van: { maand: 12, dag: 1 }, tot: { maand: 1, dag: 6 }, thema: null, spelSkin: null },
];

const MAANDEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];

// De Belgische kalenderdag van een moment staat nu in kern/themapakket.js; hier voorlopig her-geëxporteerd.
export { belgischeDag };

const sleutel = (md) => md.maand * 100 + md.dag;

export function isActief(evenement, datum = new Date()) {
  const k = sleutel(belgischeDag(datum));
  const van = sleutel(evenement.van), tot = sleutel(evenement.tot);
  return van <= tot ? (k >= van && k <= tot) : (k >= van || k <= tot);
}

// Het eerste evenement (in lijstvolgorde) dat op deze dag loopt, of null.
export function actiefEvenement(datum = new Date(), lijst = EVENEMENTEN) {
  return lijst.find(ev => isActief(ev, datum)) ?? null;
}

// Alle evenementen die op deze dag lopen (lijstvolgorde), als [{ id, naam, spelSkin }]. Voor het spel (skin-beschikbaarheid);
// `spelSkin` is null voor een evenement zonder skin.
export function actieveEvenementen(datum = new Date(), lijst = EVENEMENTEN) {
  return lijst.filter(ev => isActief(ev, datum)).map(ev => ({ id: ev.id, naam: ev.naam, spelSkin: ev.spelSkin ?? null }));
}

// Het eerstvolgende evenement MET thema dat nog moet beginnen (voor de uitleg in de instellingen), of null.
export function volgendEvenement(datum = new Date(), lijst = EVENEMENTEN) {
  const { jaar, maand, dag } = belgischeDag(datum);
  const nu = Date.UTC(jaar, maand - 1, dag);
  let beste = null, bestAfstand = Infinity;
  for (const ev of lijst) {
    if (!ev.thema) continue;
    let start = Date.UTC(jaar, ev.van.maand - 1, ev.van.dag);
    if (start <= nu) start = Date.UTC(jaar + 1, ev.van.maand - 1, ev.van.dag);
    if (start - nu < bestAfstand) { bestAfstand = start - nu; beste = ev; }
  }
  return beste;
}

// "1 tot 31 oktober" of "1 december tot 6 januari".
export function vensterTekst(ev) {
  const { van, tot } = ev;
  return van.maand === tot.maand
    ? `${van.dag} tot ${tot.dag} ${MAANDEN[tot.maand - 1]}`
    : `${van.dag} ${MAANDEN[van.maand - 1]} tot ${tot.dag} ${MAANDEN[tot.maand - 1]}`;
}
