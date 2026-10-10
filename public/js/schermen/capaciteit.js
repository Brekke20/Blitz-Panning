// schermen/capaciteit.js — de vrije tijd van een dag (spec C3, aangepast door de proefperiode-bugfix "ticket na werkuren"):
// past er nog een ticket op een dag, wat is de eerstvolgende werkdag met echte vrije tijd, en de capaciteitskop van een dagkolom.
// Het aantalmodel (slots tellen) is vervangen door de plaatsingsregel uit planner-tijdlijn.js: bestaande stops met en zonder uur,
// eigen afspraken, tijdvak-blokkeringen en reistijd (30 min per rit, zoals de Route-tab zonder berekende route) tellen echt mee.
// De pure functies krijgen alles als parameter; de twee toestandslezers onderaan (capacityForDay, nextAvailableDay)
// lezen de toestand. Importeert enkel pure kern-modules, dus ook importeerbaar in node.
import { toestand } from '../kern/toestand.js';
import { strengeAfh } from '../kern/ui.js';
import { localISO, timeStrToMin, minToTimeStr } from '../kern/tijd.js';
import { blokkeringenVoor, planItemsVanTechnieker, eigenAfsprakenVoor } from '../kern/selecties.js';
import { plaatsNieuw, extraPlaatsen, eersteVrijeStart } from '../planner-tijdlijn.js';
import { getHolidayName } from '../kern/feestdagen.js';

// De items van één dag voor de plaatsingsregel (planner-tijdlijn.js). Alles komt als parameter binnen.
//  tickets: [{ id, uur, duurMin }]; eigen: [{ id, uur, einduur, adres, notitie }] (eigen afspraken van de dag voor de technieker);
//  blokkeringen: [{ from, to }] (tijdvak-blokkeringen); werktijdMin(uur, einduur) = duur van een eigen afspraak.
// Tickets en eigen afspraken met locatie (adres/notitie, zoals in de Route-tab) zijn stops; een eigen afspraak zonder locatie en
// een tijdvak-blokkering zijn enkel een bezet tijdvak ('blok'). Een eigen afspraak zonder uur en zonder locatie telt niet (geen tijd bekend).
export function bouwDagItems({ tickets, eigen, blokkeringen, werktijdMin }) {
  const items = [];
  for (const t of tickets) items.push({ id: 't' + t.id, uur: t.uur || null, duurMin: t.duurMin, soort: 'stop', ticket: true });
  eigen.forEach((e, i) => {
    const metLocatie = !!(e.adres || e.notitie);
    if (!e.uur && !metLocatie) return;
    const duurMin = (e.uur && e.einduur ? werktijdMin(e.uur, e.einduur) : 0) || 60;
    items.push({ id: 'l' + (e.id ?? i), uur: e.uur || null, duurMin, soort: metLocatie ? 'stop' : 'blok' });
  });
  (blokkeringen || []).forEach((b, i) => {
    if (!b.from || !b.to) return;
    const van = timeStrToMin(b.from), tot = timeStrToMin(b.to);
    if (tot > van) items.push({ id: 'b' + i, uur: b.from, duurMin: tot - van, soort: 'blok' });
  });
  return items;
}

// Eerstvolgende werkdag vanaf `van` ('YYYY-MM-DD') waar `heeftPlaats(dag)` waar is; null als er binnen 60 dagen geen is.
// `nu`: Date (enkel de dag telt). De zoektocht loopt gewoon door naar volgende weken: zit de week vol, dan wordt het de eerste dag
// van een volgende week met echte vrije tijd (Brent-besluit, proefperiode).
export function volgendeBeschikbareDag(van, { nu, werkdagen, heeftPlaats }) {
  const today = new Date(nu); today.setHours(0,0,0,0);
  const d = new Date(van + 'T12:00:00');
  for (let i = 0; i < 60; i++) {
    if (d >= today) {
      const dStr = localISO(d);
      if (werkdagen.includes(d.getDay())) {
        if (heeftPlaats(dStr)) return dStr;
      }
    }
    d.setDate(d.getDate() + 1);
  }
  return null;
}

// Kop van een dagkolom: `n/cap stops · ±Xu`; `vol` als het aantal de capaciteit haalt.
export function capaciteitsKop({ aantal, cap, duurMinuten, travelMin }) {
  return {
    label: `${aantal}/${cap} stops · ±${Math.round(aantal * (duurMinuten + travelMin) / 60 * 10) / 10}u`,
    vol: aantal >= cap,
  };
}

// ── Toestandslezers ──────────────────────────────────────────────────────────
// Afhankelijkheden uit app.js (ingevuld door initCapaciteit); een vergeten init faalt luid.
let afh = new Proxy({}, { get() { throw new Error('capaciteit: initCapaciteit() is niet aangeroepen'); } });
export function initCapaciteit(afhankelijkheden) {
  afh = strengeAfh('capaciteit', afhankelijkheden); // { duurVoor, werktijdMin, kbPreferredTime }
}

// De items van een dag uit de toestand (gefilterd op de gekozen technieker): bestaande stops, eigen afspraken en tijdvak-blokkeringen.
function dagItemsVan(datum) {
  const filter = toestand.get('activeAssigneeFilter');
  return bouwDagItems({
    tickets: planItemsVanTechnieker(toestand.get('planning')[datum], filter)
      .map(p => ({ id: p.ticket.id, uur: p.uur || null, duurMin: afh.duurVoor(p.ticket.id) })),
    eigen: eigenAfsprakenVoor(toestand.get('localEvents'), datum, filter),
    blokkeringen: blokkeringenVoor(toestand.get('avExceptions'), datum, filter, 'range'),
    werktijdMin: afh.werktijdMin,
  });
}

// Kan er nog een ticket (met duur `duurMin`, eventueel een voorkeursuur) bij op deze dag? Geen feestdag, geen hele-dag-blokkering.
function plekOpDag(datum, nieuw) {
  if (getHolidayName(datum)) return null;
  // Vandaag: nooit een aankomst vóór de klok van nu (fix-ronde 1). Een voorkeursuur is een afspraak met de klant en blijft staan.
  const nu = new Date();
  if (datum === localISO(nu) && !nieuw.uur) nieuw = { ...nieuw, vroegst: nu.getHours() * 60 + nu.getMinutes() };
  const settings = toestand.get('settings');
  const filter = toestand.get('activeAssigneeFilter');
  if (blokkeringenVoor(toestand.get('avExceptions'), datum, filter, 'fullday').length > 0) return null;
  return plaatsNieuw({
    items: dagItemsVan(datum), nieuw,
    vanTijd: settings.vanTijd, laatsteStart: settings.laatsteStart, maxPerDag: settings.maxPerDag,
  });
}

// Capaciteit van een dag voor de kop "n/cap": het aantal tickets dat er al staat plus het aantal standaardtickets dat er volgens de
// plaatsingsregel nog bij kan. Feestdag of hele-dag-blokkering: 0.
export function capacityForDay(datum) {
  if (getHolidayName(datum)) return 0;
  const settings = toestand.get('settings');
  const filter = toestand.get('activeAssigneeFilter');
  if (blokkeringenVoor(toestand.get('avExceptions'), datum, filter, 'fullday').length > 0) return 0;
  const items = dagItemsVan(datum);
  return items.filter(i => i.ticket).length + extraPlaatsen({
    items, duurMin: settings.duurMinuten,
    vanTijd: settings.vanTijd, laatsteStart: settings.laatsteStart, maxPerDag: settings.maxPerDag,
  });
}

// Eerstvolgende dag vanaf `van` waar een ticket echt past. `ticketId` (optioneel): duur van dat ticket en zijn voorkeursuur van de klant.
export function nextAvailableDay(van, ticketId = null) {
  const settings = toestand.get('settings');
  const nieuw = {
    id: '__nieuw',
    duurMin: ticketId != null ? afh.duurVoor(ticketId) : settings.duurMinuten,
    uur: ticketId != null ? (afh.kbPreferredTime(ticketId) || null) : null,
  };
  return volgendeBeschikbareDag(van, {
    nu: new Date(),
    werkdagen: settings.werkdagen,
    heeftPlaats: dag => !!plekOpDag(dag, nieuw),
  });
}

// Het eerste vrije uur ('HH:MM', op een kwartier) voor een ticket op `datum` (B16, "Toewijzen"): volgens de
// plaatsingsregel op basis van wat er die dag al staat, ook als het na de laatste starttijd valt. Voor vandaag niet vóór de klok van nu.
// null bij een feestdag, een hele-dag-blokkering of als het voorstel niet meer binnen dezelfde dag valt (na 23:45, geen wrap naar 00:xx):
// dan blijft de terugval 09:00 van de aanroeper.
export function eersteVrijUur(datum, ticketId) {
  if (getHolidayName(datum)) return null;
  const settings = toestand.get('settings');
  const filter = toestand.get('activeAssigneeFilter');
  if (blokkeringenVoor(toestand.get('avExceptions'), datum, filter, 'fullday').length > 0) return null;
  const nu = new Date();
  const { startMin } = eersteVrijeStart({
    items: dagItemsVan(datum),
    duurMin: ticketId != null ? afh.duurVoor(ticketId) : settings.duurMinuten,
    vanTijd: settings.vanTijd, laatsteStart: settings.laatsteStart,
    vroegst: datum === localISO(nu) ? nu.getHours() * 60 + nu.getMinutes() : undefined,
    kwartier: true,
  });
  if (startMin > 23 * 60 + 45) return null;
  return minToTimeStr(startMin);
}
