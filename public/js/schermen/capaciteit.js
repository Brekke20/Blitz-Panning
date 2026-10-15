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
import { apiVerzoek } from '../kern/api.js';
import { TEST_MODE } from '../kern/omgeving.js';
import { geocacheLookup, geocacheStore } from '../kern/opslag.js';
import { eersteHaalbareDag } from '../planner.js';

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
// `voorkeur` ('YYYY-MM-DD', optioneel): de voorkeursdatum van de klant. Ligt die later dan `van` (en niet in het verleden), dan
// begint de zoektocht op die dag: het ticket komt op de voorkeursdag, of (is die vol of geen werkdag) op de eerste dag erna met
// plaats, nooit vroeger dan de klant vroeg (v2.1.5, ticket #3964: "+" negeerde de voorkeursdatum en koos vandaag).
export function volgendeBeschikbareDag(van, { nu, werkdagen, heeftPlaats, voorkeur = null }) {
  return vrijeDagenVanaf(van, { nu, werkdagen, heeftPlaats, voorkeur, aantal: 1 })[0] ?? null;
}

// De eerste `aantal` werkdagen vanaf `van` (of de latere voorkeursdatum, zoals volgendeBeschikbareDag) waar `heeftPlaats(dag)` waar is,
// binnen 60 dagen. Gebruikt door "+" (v2.1.6): de vrije-plek-regel blijft de eerste, gratis zeef; enkel deze dagen gaan naar de
// reistijdtoets van het brein.
export function vrijeDagenVanaf(van, { nu, werkdagen, heeftPlaats, voorkeur = null, aantal = 1 }) {
  const today = new Date(nu); today.setHours(0,0,0,0);
  if (voorkeur && /^\d{4}-\d{2}-\d{2}$/.test(voorkeur) && voorkeur > van && voorkeur >= localISO(today)) van = voorkeur;
  const d = new Date(van + 'T12:00:00');
  const uit = [];
  for (let i = 0; i < 60 && uit.length < aantal; i++) {
    if (d >= today) {
      const dStr = localISO(d);
      if (werkdagen.includes(d.getDay())) {
        if (heeftPlaats(dStr)) uit.push(dStr);
      }
    }
    d.setDate(d.getDate() + 1);
  }
  return uit;
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
  afh = strengeAfh('capaciteit', afhankelijkheden); // { duurVoor, werktijdMin, kbPreferredTime, kbPreferred, kbFor }
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

// Eerstvolgende dag vanaf `van` waar een ticket echt past. `ticketId` (optioneel): duur van dat ticket, zijn voorkeursuur én zijn
// voorkeursdatum van de klant (een latere voorkeursdatum is het vertrekpunt, zie volgendeBeschikbareDag).
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
    voorkeur: ticketId != null ? afh.kbPreferred(ticketId) : null,
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

// ── "+" en "Voeg toe aan planning" met de regels van het brein (v2.1.6) ─────────────────────────────────────────────────────────
// Klantmelding: "+" zette #3979 (Oostduinkerke) op vr 16 okt naast #3894 (Meise, vast 14:00-17:00), 90 min rijden uit elkaar, en
// daarna was Meise niet meer op tijd te halen. De vrije-plek-regel hierboven rekent met 30 min per rit. Nu is die regel enkel de eerste,
// gratis zeef (de eerste PLUS_MAX_DAGEN dagen met plaats, binnen 60 dagen); daarna toetst het brein (planner.js toetsDag) dag per dag
// met echte reistijden: maxReistijdMin naar de buren (behalve op een lege dag), de vooruitcontrole naar een later vast uur, voorkeursuur
// en klantblokkeringen. De eerste dag die past wint. Lukt het opvragen van adressen of reistijden niet, dan is het resultaat 'onzeker'
// (de aanroeper vraagt dan bevestiging); er is geen stille terugval op de oude regel.
export const PLUS_MAX_DAGEN = 15;       // zoekhorizon: zoveel dagen met een vrije plek worden hoogstens met reistijden getoetst
export const PLUS_MAX_MATRIX = 30;      // hoogstens zoveel /api/matrix-opvragingen per klik (elk één TomTom-matrixaanvraag)
const REISGEHEUGEN_MS = 10 * 60 * 1000; // het reistijdgeheugen van het brein blijft 10 min bewaard over klikken heen

let _reisGeheugen = new Map();
let _reisGeheugenTot = 0;
function reisGeheugen() {
  if (Date.now() > _reisGeheugenTot) { _reisGeheugen = new Map(); _reisGeheugenTot = Date.now() + REISGEHEUGEN_MS; }
  return _reisGeheugen;
}
function wisReisGeheugen() { _reisGeheugen = new Map(); _reisGeheugenTot = 0; }

const AFSTAND_REDENEN = new Set(['te-ver', 'voorkeursdag-afstand']);
// Toasttekst als er geen geschikte dag is. Puur. `redenen`: [{ dag, reden }] van de getoetste dagen (redenen van het brein);
// `weken`: de gezochte periode.
export function plusRedenTekst(redenen, { maxReistijdMin = 45, weken = 3 } = {}) {
  const delen = [];
  if (redenen.some(r => AFSTAND_REDENEN.has(r.reden))) delen.push(`te ver van de andere afspraken (max. ${maxReistijdMin} min rijden)`);
  if (redenen.some(r => r.reden === 'vast-uur-botst')) delen.push('het voorkeursuur past niet tussen de andere afspraken');
  if (redenen.some(r => r.reden === 'klant-geblokkeerd')) delen.push('de klant is dan niet beschikbaar');
  if (!delen.length || redenen.some(r => r.reden === 'geen-plaats' || r.reden === 'voorkeursdag-vol')) delen.push('geen vrije plaats die op tijd te halen is');
  const periode = weken <= 1 ? 'de komende week' : `de komende ${weken} weken`;
  return `Geen geschikte dag gevonden in ${periode}: ${delen.join(', of ')}`;
}

// Coördinaten: eerst wat er al op het object staat, dan de geocode-cache.
function coordsVan(obj, adres) {
  if (obj && obj._lat && obj._lon) return { lat: obj._lat, lon: obj._lon };
  const hit = adres ? geocacheLookup(adres) : null;
  return hit ? { lat: hit.lat, lon: hit.lon } : null;
}

const ADRES_ONZEKER = { status: 'onzeker', tekst: 'De reistijd kon niet gecontroleerd worden: het adres van dit ticket of van een andere afspraak is niet gevonden.' };
const MATRIX_ONZEKER = { status: 'onzeker', tekst: 'De reistijd kon niet gecontroleerd worden: de reistijden zijn nu niet beschikbaar.' };

// Zoekt de dag voor "+" / "Voeg toe aan planning". Geeft:
//  { status: 'ok', datum }       de eerste dag die past;
//  { status: 'geen', tekst }     geen geschikte dag (toasttekst): niets plannen;
//  { status: 'onzeker', tekst }  adres of reistijden niet beschikbaar: de aanroeper vraagt bevestiging vóór de oude regel.
// TomTom: hoogstens één POST /api/optimize (enkel voor adressen die nog niet in de geocode-cache staan; niet in de testmodus, zoals
// "Plan deze week") en hoogstens PLUS_MAX_MATRIX POST's naar /api/matrix (gedeeld reistijdgeheugen, voorfilter in vogelvlucht).
export async function zoekHaalbareDag(ticketId) {
  const settings = toestand.get('settings');
  const t = (toestand.get('allTickets') || []).find(x => x.id === ticketId);
  if (!t) return { status: 'geen', tekst: 'Ticket niet gevonden' };
  const nu = new Date();
  const vandaag = localISO(nu);
  const nieuw = { id: '__nieuw', duurMin: afh.duurVoor(ticketId), uur: afh.kbPreferredTime(ticketId) || null };
  const dagen = vrijeDagenVanaf(vandaag, {
    nu, werkdagen: settings.werkdagen, heeftPlaats: dag => !!plekOpDag(dag, nieuw),
    voorkeur: afh.kbPreferred(ticketId), aantal: PLUS_MAX_DAGEN,
  });
  if (!dagen.length) return { status: 'geen', tekst: 'Geen beschikbare werkdag gevonden' };
  // Een ticket zonder adres heeft geen locatie: er is geen reistijd om te toetsen, dus de vrije-plek-regel beslist (zoals vroeger).
  // Een adres dat niet gevonden wordt, is wel onzeker (hieronder).
  if (!t.hasAddress || !t.address) return { status: 'ok', datum: dagen[0] };

  // De stops van de technieker van dit ticket (zoals "Plan deze week" voor de gekozen technieker).
  const filter = t.assignee || toestand.get('activeAssigneeFilter');
  const stopsPerDag = Object.fromEntries(dagen.map(d => [d, planItemsVanTechnieker(toestand.get('planning')[d], filter)]));
  const stopCoords = p => ((p._lat && p._lon) ? { lat: p._lat, lon: p._lon } : coordsVan(p.ticket, p.ticket.address));

  // Geocoderen wat nog geen coördinaten heeft: het ticket zelf en de bestaande stops van de te toetsen dagen, in één verzoek.
  const teGeocoden = new Set();
  if (t.hasAddress && t.address && !coordsVan(t, t.address)) teGeocoden.add(t.address);
  for (const d of dagen) for (const p of stopsPerDag[d]) if (p.ticket.address && !stopCoords(p)) teGeocoden.add(p.ticket.address);
  let depot = settings.startlocatie ? geocacheLookup(settings.startlocatie) : null;
  if (!TEST_MODE && teGeocoden.size && settings.startlocatie) {
    const adressen = [...teGeocoden];
    try {
      const res = await apiVerzoek('/api/optimize', { methode: 'POST', body: { origin: settings.startlocatie, stops: adressen } });
      const locs = res.ok ? res.data?.locations : null;
      if (Array.isArray(locs)) {
        adressen.forEach((adres, i) => { const l = locs[i + 1]; if (l) geocacheStore(adres, l.lat, l.lon); });
        if (!depot && locs[0]) { depot = { lat: locs[0].lat, lon: locs[0].lon }; geocacheStore(settings.startlocatie, depot.lat, depot.lon); }
      }
    } catch { /* wat hierna nog geen coördinaten heeft, maakt de toets onzeker */ }
  }
  const plek = coordsVan(t, t.address);
  if (!plek) return ADRES_ONZEKER;

  const bestaandPerDag = {}, eigenAfspraken = {}, blokkeringen = {};
  let toetsbaar = dagen.length; // een dag met een stop zonder gevonden adres kan niet getoetst worden: daar stopt de zoektocht
  dagen.forEach((d, i) => {
    bestaandPerDag[d] = stopsPerDag[d].map(p => {
      const c = stopCoords(p);
      if (!c && p.ticket.address && toetsbaar === dagen.length) toetsbaar = i;
      return { id: p.ticket.id, uur: p.uur || null, duurMin: afh.duurVoor(p.ticket.id), lat: c?.lat ?? null, lon: c?.lon ?? null };
    });
    // Eigen afspraken met een uur (zoals "Plan deze week"); met locatie zijn ze een stop in de keten.
    eigenAfspraken[d] = eigenAfsprakenVoor(toestand.get('localEvents'), d, filter).filter(e => e.uur).map(e => {
      const c = coordsVan(e, e.adres || e.notitie);
      return { uur: e.uur, duurMin: (e.einduur ? afh.werktijdMin(e.uur, e.einduur) : 0) || 60, lat: c?.lat ?? null, lon: c?.lon ?? null };
    });
    blokkeringen[d] = blokkeringenVoor(toestand.get('avExceptions'), d, filter, 'range')
      .filter(b => b.from && b.to).map(b => ({ van: b.from, tot: b.to }));
  });

  // Reistijden via /api/matrix (zelfde vorm als "Plan deze week"). Een fout of de rekenlimiet breekt de zoektocht af, in plaats van
  // met een schatting verder te rekenen.
  let opvragingen = 0, matrixFout = false, limiet = false;
  const reistijden = async (van, naar, vertrekIso) => {
    const alleNull = () => new Map(naar.map(n => [n.id, null]));
    if (matrixFout || limiet) return alleNull();
    if (opvragingen >= PLUS_MAX_MATRIX) { limiet = true; return alleNull(); }
    opvragingen++;
    try {
      const res = await apiVerzoek('/api/matrix', {
        methode: 'POST',
        body: { origin: { lat: van.lat, lon: van.lon }, destinations: naar.map(n => ({ lat: n.lat, lon: n.lon })), departAt: vertrekIso },
      });
      if (!res.ok || !Array.isArray(res.data?.results)) { matrixFout = true; return alleNull(); }
      return new Map(naar.map((n, i) => {
        const r = res.data.results[i];
        return [n.id, typeof r?.travelTimeSeconds === 'number' ? r.travelTimeSeconds / 60 : null];
      }));
    } catch { matrixFout = true; return alleNull(); }
  };

  const kb = afh.kbFor(ticketId);
  const uit = await eersteHaalbareDag({
    kandidaat: {
      id: t.id, number: t.number, priority: t.priority, interventieDatum: t.interventieDatum,
      inPlanningSinds: t.inPlanningSinds ?? null, lat: plek.lat, lon: plek.lon, duurMin: nieuw.duurMin,
    },
    bestaandPerDag, eigenAfspraken, blokkeringen,
    klant: kb ? { [t.id]: kb } : {},
    instellingen: { vanTijd: settings.vanTijd, laatsteStart: settings.laatsteStart, maxPerDag: settings.maxPerDag, maxReistijdMin: settings.maxReistijdMin },
    depot, vandaag,
    vroegst: { [vandaag]: nu.getHours() * 60 + nu.getMinutes() }, // vandaag: geen aankomst vóór de klok van nu (zoals de vrije-plek-regel)
    reistijden,
  }, { dagen: dagen.slice(0, toetsbaar), geheugen: reisGeheugen(), moetStoppen: () => matrixFout || limiet });

  if (uit.datum) return { status: 'ok', datum: uit.datum };
  if (matrixFout) { wisReisGeheugen(); return MATRIX_ONZEKER; } // het brein bewaarde schattingen: niet hergebruiken
  if (limiet) return { status: 'geen', tekst: 'Geen geschikte dag gevonden binnen de rekenlimiet: kies zelf een dag in de kalender.' };
  if (toetsbaar < dagen.length) return ADRES_ONZEKER;
  const laatste = dagen[dagen.length - 1];
  const weken = Math.max(1, Math.ceil((Date.parse(laatste) - Date.parse(vandaag)) / 86400000 / 7));
  return { status: 'geen', tekst: plusRedenTekst(uit.redenen, { maxReistijdMin: settings.maxReistijdMin ?? 45, weken }) };
}
