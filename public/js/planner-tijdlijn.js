// planner-tijdlijn.js — de ENE plaatsingsregel voor een dag (proefperiode-bugfix "ticket na werkuren", Brent-besluit).
// Puur: geen DOM, geen toestand. Gebruikt door "+" (schermen/capaciteit.js), de volgorde van de Route-tab
// (kern/selecties.js stopsVoorDag) en als referentie voor de keten van bestaande stops zonder uur in het
// planner-brein (planner.js; het brein rekent met echte TomTom-reistijden, de regel is dezelfde).
//
// De regel:
//  - Items MET uur staan vast op dat uur (tickets, eigen afspraken, tijdvak-blokkeringen).
//  - Items ZONDER uur worden in hun lijstvolgorde achter elkaar gezet, beginnend bij vanTijd: aankomst = klok + reistijd,
//    einde = aankomst + duur. Botst dat met een vast item, of haalt het ticket de eerstvolgende vaste stop niet meer
//    (einde + reistijd > start van die stop), dan springt de klok naar het einde van dat vaste item en wordt opnieuw geprobeerd.
//    De klok loopt nooit terug: een item ZONDER uur komt dus nooit voor een ander item zonder uur dat vóór hem in de lijst staat.
//  - Een nieuw ticket is het laatste item zonder uur. Het mag dus VOOR een vast uur komen als daar plek is.
//  - Grens (B1): de AANKOMST bij de klant is hoogstens `laatsteStart`. Het einde (aankomst + duur) wordt bewust niet getoetst.
//  - Reistijd: standaard 30 min per rit (de terugval van de Route-tab, zie route-tijden.js), ook voor de eerste rit vanaf het depot.
import { timeStrToMin } from './kern/tijd.js';

export const REISTIJD_TERUGVAL_MIN = 30;
const STANDAARD_DUUR_MIN = 60;

// item: { id, uur: 'HH:MM' | null, duurMin, soort: 'stop' | 'blok', ticket?: boolean }
//   soort 'stop'  = een afspraak bij een klant of op een locatie: er is reistijd naartoe en ervandaan.
//   soort 'blok'  = enkel een bezet tijdvak (tijdvak-blokkering, eigen afspraak zonder locatie): geen reistijd naar het blok toe.
// Geeft { plaatsingen } terug: per item { id, start, eind, vast, laat, soort, ticket }, gesorteerd op start (vaste items eerst bij gelijk begin).
// `laat` = item zonder uur waarvan de aankomst na `laatsteStart` valt.
export function leggDagUit({ items, vanTijd = '08:00', laatsteStart = '16:00', reisMin = REISTIJD_TERUGVAL_MIN }) {
  const vanMin = timeStrToMin(vanTijd || '08:00');
  const laatsteMin = timeStrToMin(laatsteStart || '16:00');
  const duurVan = i => (i.duurMin > 0 ? i.duurMin : STANDAARD_DUUR_MIN);

  const vast = items.filter(i => i.uur).map(i => {
    const s = timeStrToMin(i.uur);
    return { id: i.id, s, e: s + duurVan(i), soort: i.soort || 'stop', ticket: !!i.ticket };
  }).sort((a, b) => a.s - b.s);

  const plaatsingen = vast.map(b => ({ id: b.id, start: b.s, eind: b.e, vast: true, laat: false, soort: b.soort, ticket: b.ticket }));

  let klok = vanMin;
  for (const it of items.filter(i => !i.uur)) {
    const duur = duurVan(it);
    let start;
    for (;;) {
      start = klok + reisMin;
      const eind = start + duur;
      const botst = vast.find(b => b.s < eind && start < b.e);
      if (botst) { klok = Math.max(klok, botst.e); continue; }
      const volgende = vast.find(b => b.soort === 'stop' && b.s >= eind);
      if (volgende && eind + reisMin > volgende.s) { klok = Math.max(klok, volgende.e); continue; }
      break;
    }
    plaatsingen.push({ id: it.id, start, eind: start + duur, vast: false, laat: start > laatsteMin, soort: it.soort || 'stop', ticket: !!it.ticket });
    klok = start + duur;
  }
  plaatsingen.sort((a, b) => (a.start - b.start) || ((b.vast ? 1 : 0) - (a.vast ? 1 : 0)));
  return { plaatsingen };
}

// Plaatst één nieuw ticket op een dag met de bestaande items. Geeft { start, eind } (minuten) of null als er geen plek is:
//  - het aantal tickets haalt `maxPerDag` (0 of minder: nooit plek; ontbrekend: geen grens);
//  - de aankomst valt na `laatsteStart` (zonder uur), of het vaste uur van het nieuwe ticket (voorkeursuur) botst met iets.
// nieuw: { id, duurMin, uur? } (uur = voorkeursuur van de klant: vast, vrijgesteld van laatsteStart zoals in het brein).
export function plaatsNieuw({ items, nieuw, vanTijd, laatsteStart, maxPerDag, reisMin }) {
  const aantal = items.filter(i => i.ticket).length;
  if (maxPerDag != null && aantal + 1 > maxPerDag) return null;
  const item = { id: nieuw.id, uur: nieuw.uur || null, duurMin: nieuw.duurMin, soort: 'stop', ticket: true };
  const { plaatsingen } = leggDagUit({ items: [...items, item], vanTijd, laatsteStart, reisMin });
  const p = plaatsingen.find(x => x.id === nieuw.id);
  if (!p) return null;
  if (item.uur) {
    const botst = plaatsingen.some(x => x !== p && x.start < p.eind && p.start < x.eind);
    return botst ? null : { start: p.start, eind: p.eind };
  }
  return p.laat ? null : { start: p.start, eind: p.eind };
}

// Hoeveel extra tickets van `duurMin` er nog bij kunnen (voor de kop "n/cap" van een dagkolom).
export function extraPlaatsen({ items, duurMin, vanTijd, laatsteStart, maxPerDag, reisMin }) {
  let extra = 0;
  const lijst = [...items];
  for (;;) {
    const id = '__extra' + extra;
    const p = plaatsNieuw({ items: lijst, nieuw: { id, duurMin }, vanTijd, laatsteStart, maxPerDag, reisMin });
    if (!p) return extra;
    lijst.push({ id, uur: null, duurMin, soort: 'stop', ticket: true });
    extra++;
    if (extra > 50) return extra; // veiligheidsgrens
  }
}
