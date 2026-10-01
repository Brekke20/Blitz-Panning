// schermen/route-tijden.js — pure berekeningen van de Route-tab (etappe 3): aankomsttijden, ankers,
// handtekening, dagklok. Geen DOM, geen `window`, geen instellingen: alles komt als parameter binnen
// (`vanTijd`, `duurVoor`, `werktijdMin`). De bodies zijn letterlijk overgenomen uit index.html.
import { timeStrToMin } from '../kern/tijd.js';

// Pure helper (Taak 4), geëxtraheerd uit renderRouteList(): berekent cumulatieve
// aankomsttijden (minuten na middernacht) voor een allStops-lijst, plus de legIdx-mapping
// (allStops-index → routeData.legs-index, enkel voor geocodeerde stops -- zie de uitleg bij
// het gebruik in renderRouteList). `legs` mag null zijn (geen route berekend): dan overal de
// 30-min-reistijd-fallback. Gebruikt door renderRouteList() (weergave) en applyRouteOrder()
// (sleepvolgorde → tijdstippen vertalen).
// `vanTijd` = starttijd van de dag ('HH:MM', leeg = '08:00'), `duurVoor(ticketId)` = duur in minuten
// van een ticket, `werktijdMin(uur, einduur)` = duur van een lokale afspraak.
export function berekenAankomsten(allStops, legs, { vanTijd, duurVoor, werktijdMin }) {
  const legIdx = [];
  {
    let wp = 0;
    for (let i = 0; i < allStops.length; i++) {
      if (allStops[i].item._lat) legIdx[i] = wp++;
    }
  }
  const arrivalTimes = [];
  const [h, m] = (vanTijd || '08:00').split(':').map(Number);
  let curMin = h * 60 + m;
  for (let i = 0; i < allStops.length; i++) {
    const entry = allStops[i];
    const legSec = (legs && legIdx[i] !== undefined
      ? legs[legIdx[i]]?.travelTimeSeconds
      : undefined) ?? 30 * 60;
    // Vastgezet tijdstip: spring naar dat uur i.p.v. de opgetelde rijtijd te gebruiken
    // (bestaand gedrag, nodig zodat ankers/vaste tijdstippen altijd kloppen).
    curMin = entry.uur ? timeStrToMin(entry.uur) : curMin + Math.round(legSec / 60);
    arrivalTimes.push(curMin);
    if (entry.kind === 'ticket') {
      curMin += duurVoor(entry.item.ticket.id) || 60;
    } else {
      const ev = entry.item;
      curMin += (ev.uur && ev.einduur ? werktijdMin(ev.uur, ev.einduur) : 0) || 60;
    }
  }
  return { arrivalTimes, legIdx };
}

// Aankomstminuten per ticket ({ [ticketId]: min }); lokale afspraken tellen niet mee.
// Vervangt de lus uit computeArrivalTimes() (nu aankomstTijdenVoorDag() in route.js).
export function aankomstPerTicket(allStops, arrivalTimes) {
  const result = {};
  allStops.forEach((entry, i) => {
    if (entry.kind === 'ticket') result[entry.item.ticket.id] = arrivalTimes[i];
  });
  return result;
}

// Minuten (mogelijk > 1440) als 'HH:MM' (uur modulo 24). Was `fmtTime` binnen renderRouteList().
export function fmtTijd(totalMin) {
  const hh = Math.floor(totalMin / 60) % 24;
  const mm = totalMin % 60;
  return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
}

// Fix-ronde 1 (#3, Controller-ruling): slepen/optimaliseren mag enkel als de gefilterde
// tickets van de dag van hoogstens één technieker zijn — anders zou de volgorde/persist-
// logica tijden van meerdere technici als één sequentiële route door elkaar husselen.
// Ontbrekend/leeg `assignee` telt als een eigen groep. `stops` = platte lijst ticket-stop-
// objecten ({ticket,...}), zoals overal elders in de Route-tab; lokale afspraken tellen hier
// niet mee (worden nooit aan een technieker-route toegewezen in deze context).
export function dagHeeftEenTechnieker(stops) {
  const groepen = new Set(stops.map(p => p.ticket?.assignee || ''));
  return groepen.size <= 1;
}

// I2 (eindreview v1.4.0): begrenzing van de dagklok voor verplaatsbare tickets -- nooit een
// tijdstip toekennen/bewaren dat naar (lokale) 00:00 zou wrappen (botst met de "geen
// tijdstip"-sentinel, zie extractLocalHour) of meer dan 2u na het einde van de werkdag valt.
// `totTijd` = einde van de werkdag ('HH:MM', leeg = '17:00').
export function buitenDagklok(minutenRuw, uurStr, totTijd) {
  const dagKlokLimiet = timeStrToMin(totTijd || '17:00') + 120;
  return minutenRuw >= 1440 || uurStr === '00:00' || timeStrToMin(uurStr) > dagKlokLimiet;
}

// mergeMetAnkers(geoptimaliseerd, ankers): voegt de TomTom-geoptimaliseerde volgorde van vrije
// (niet-vergrendelde) tickets samen met de ankers (lokale afspraken + vergrendelde tickets,
// die op hun vaste uur moeten blijven staan). `geoptimaliseerd` is een platte lijst van
// ticket-stop-objecten (in de gewenste TomTom-volgorde); `ankers` is al allStops-vormig
// ({kind,item,uur}[]). Geeft zelf ook een allStops-vormige lijst terug, die via
// applyRouteOrder() naar definitieve tijdstippen vertaald wordt.
export function mergeMetAnkers(geoptimaliseerd, ankers, { vanTijd, duurVoor, werktijdMin }) {
  // Ankers zonder uur (zou zelden voorkomen) altijd achteraan — er is toch geen vast moment
  // om op te wachten.
  const ankersGesorteerd = [...ankers].sort((a, b) => (a.uur || '99:99').localeCompare(b.uur || '99:99'));
  const resultaat = [];
  let ankerIdx = 0;
  let klok = timeStrToMin(vanTijd || '08:00');

  for (const p of geoptimaliseerd) {
    // Zolang het eerstvolgende anker een uur heeft en de lopende klok dat tijdstip al (bijna)
    // haalt, eerst dat anker inplannen — zo respecteert de merge vaste tijdstippen zonder de
    // TomTom-volgorde van de vrije tickets zelf te herschikken.
    while (ankerIdx < ankersGesorteerd.length && ankersGesorteerd[ankerIdx].uur
        && klok + 30 >= timeStrToMin(ankersGesorteerd[ankerIdx].uur)) {
      const anker     = ankersGesorteerd[ankerIdx++];
      const ankerUur  = timeStrToMin(anker.uur);
      const ankerDuur = anker.kind === 'ticket'
        ? duurVoor(anker.item.ticket.id)
        : (werktijdMin(anker.item.uur, anker.item.einduur) || 60);
      klok = Math.max(klok, ankerUur) + ankerDuur;
      resultaat.push(anker);
    }
    klok += 30 + duurVoor(p.ticket.id);
    resultaat.push({ kind: 'ticket', item: p, uur: p.uur });
  }
  // Resterende ankers achteraan.
  while (ankerIdx < ankersGesorteerd.length) resultaat.push(ankersGesorteerd[ankerIdx++]);
  return resultaat;
}

// Handtekening van de stops waarvoor een route berekend is (onafhankelijk van volgorde/uur):
// verschilt die van de huidige stops, dan staat er een verouderde route op de kaart.
// `stops` = gefilterde ticket-stops van de dag, `eigenAfspraken` = gefilterde eigen afspraken met locatie.
export function routeHandtekening(stops, eigenAfspraken) {
  const ids = stops.map(p => 't' + p.ticket.id);
  eigenAfspraken.forEach(e => ids.push('l' + e.id));
  return ids.sort().join('|');
}

// Ankers (vergrendeld of voorkeursuur) krijgen nooit een uur van applyRouteOrder, dus tellen
// ze niet mee als "zonder tijdstip" (anders zou de balk nooit verdwijnen). `isAnker` = de
// uitkomst van isStopAnchored(p) (blijft in index.html: hangt af van vergrendeling en voorkeursuur).
export function stopZonderTijdstip(p, isAnker) { return !p.uur && !isAnker; }

// Verwachte-drukte-klasse uit de verhouding (historische of live) reistijd / vrije doorstroming.
export function drukteMagnitude(ratio) {
  if (ratio >= 1.25) return 3;
  if (ratio >= 1.10) return 2;
  if (ratio >= 1.03) return 1;
  return 0;
}
