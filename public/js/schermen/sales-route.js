// schermen/sales-route.js — de tab "Route" van de verkoper: de bezoeken van één dag op uur (de uren staan vast, niets te slepen), per
// bezoek de rit vanaf het vorige, een waarschuwing als een bezoek het volgende niet haalt, de kaart (sales-kaart.js) en een samenvatting.
// Werkt als gewone tab van de verkoper en als subtab van de beheerder (de view komt van startScherm). De dag is de gedeelde gekozen
// datum van de Kalender (sales-data.js).
// Ritten: POST /api/route (depot + bezoeken met locatie), ook in testmodus (zoals de technieker; de testmodus geeft de leads echte Limburgse
// coordinaten); bij een fout de geschatte ritten (haversine x 1,3 aan 50 km/u) met de toast "Rit geschat". De route wordt opnieuw berekend zodra de handtekening (volgorde, leads, coordinaten, depot) verandert,
// bv. nadat een adres van postcode naar volledig adres ging (melding "Route herberekend").
// De kaart toont de route zoals bij de technieker: de TomTom-lijn met de drukte-kleuring (voor een toekomstige dag het verwachte verkeer per
// wegvak via /api/drukte, daarna ingekleurd), wegenwerken, wegafsluitingen met waarschuwing, de legende en de vertraging in de samenvatting.
// Bovenaan staat de weekstrook van de technieker: de werkdagen van de gekozen week met het aantal bezoeken en of ze bevestigd zijn; een klik kiest die dag.
// De routekleur en de drukte-kleuring komen uit de instellingen van de verkoper (standaard amber en aan, zoals bij de technieker).
// Een lead die enkel op de postcode staat ("ongeveer") is zo te zien in de lijst en op de kaart. Alle leadgegevens via textContent.
import { toast, maakActiveerbaar } from '../kern/ui.js';
import { apiVerzoek } from '../kern/api.js';
import { TEST_MODE } from '../kern/omgeving.js';
import { geocacheLookup, geocacheStore } from '../kern/opslag.js';
import { fmtSec, timeStrToMin, localISO } from '../kern/tijd.js';
import { routeVertraging, haalDrukteDetail } from './route-tijden.js';
import { renderWeekstrook } from './week-strook.js';
import { ontleedAdres } from '../sales/adres.js';
import { startScherm } from './sales-schil.js';
import { salesToestand, gekozenDatum, zetGekozenDatum } from './sales-data.js';
import { schrijfbaarNu } from './sales-verkoper.js';
import { openLeadDetail } from './sales-detail.js';
import { openResultaat } from './sales-resultaat.js';
import { bouwRouteStops, controleerKeten, routeHandtekening, berekenRoute, weekDagInfo } from './sales-route-logica.js';
import { maakSalesKaart, ONGEVEER_TEKST } from './sales-kaart.js';
import { KAART_LAGEN } from './route-kaart.js';
import { el } from './sales-dom.js';

export const LEEG_TEKST = 'Geen bezoeken op deze dag';
export const WAARSCHUWING_TEKST = (laatMin) => `⚠ haalt het volgende bezoek niet (+${laatMin} min)`;
// Dezelfde teksten als de route van de technieker (route-kaart.js).
export const WEGAFSLUITING_TEKST = '⚠ wegafsluiting op de route';
const WEGAFSLUITING_TOAST = '⚠ Wegafsluiting op de route — controleer de bereikbaarheid van het adres';
const GEEN_START_TEKST = 'Geen startlocatie ingesteld: de eerste rit is niet berekend. Stel je startadres in via ⚙ Instellingen.';
const START_ONBEKEND_TEKST = 'Het startadres kon niet gevonden worden: de eerste rit is niet berekend.';

const staten = new WeakMap(); // inhoud -> toestand van het scherm

// ---- het startpunt (depot): de geocode van instellingen.startlocatie ----

const POSTCODE_IN_TEKST = /\b([1-9]\d{3})\b/;

async function opPostcode(pc) {
  try {
    const r = await apiVerzoek(`/api/postcode?pc=${encodeURIComponent(pc)}`);
    if (!r.ok || r.data?.lat == null || r.data?.lon == null) return null;
    return { lat: r.data.lat, lon: r.data.lon };
  } catch { return null; }
}

/**
 * Het depot voor een startadres: de geocache van het toestel, anders (live) TomTom via /api/optimize, anders het postcode-middelpunt.
 * `ongeveer` = enkel een postcode bekend. Een enkele postcode: het middelpunt via /api/postcode (in testmodus niet in de geocache bewaard). -> { lat, lon, ongeveer } | null
 */
export async function zoekDepot(startlocatie) {
  const tekst = String(startlocatie ?? '').trim();
  if (!tekst) return null;
  const ontleed = ontleedAdres(tekst);
  const enkelPostcode = ontleed.soort === 'postcode';
  const bewaard = geocacheLookup(tekst);
  if (bewaard) return { ...bewaard, ongeveer: enkelPostcode };
  if (!enkelPostcode) {
    try {
      const r = await apiVerzoek('/api/optimize', { methode: 'POST', body: { origin: tekst, stops: [tekst] } });
      const punt = r.ok ? r.data?.locations?.[0] : null;
      if (punt?.lat != null && punt?.lon != null) { geocacheStore(tekst, punt.lat, punt.lon); return { lat: punt.lat, lon: punt.lon, ongeveer: false }; }
    } catch { /* terugvallen op de postcode */ }
  }
  const pc = ontleed.postcode ?? POSTCODE_IN_TEKST.exec(tekst)?.[1];
  const punt = pc ? await opPostcode(pc) : null;
  if (!punt) return null;
  if (enkelPostcode && !TEST_MODE) geocacheStore(tekst, punt.lat, punt.lon);
  return { ...punt, ongeveer: true };
}

// ---- opbouw van het scherm (eenmalig per view) ----

function bouwSkelet(inhoud) {
  // UI/UX-review P1-4: één navigatie, zoals bij de technieker: het datumveld en de weekstrook (met haar eigen ‹ › voor de week).
  // De dag-‹ › en het dag-label van vroeger zijn weg; de gekozen dag staat in de strook (actief) en in het datumveld.
  const kiezer = el('input', { type: 'date', class: 'sales-route-datumveld', 'aria-label': 'Kies een dag' });
  const dagkiezer = el('div', { class: 'sales-route-dagkiezer' }, kiezer);
  // De weekstrook van de technieker (week-strook.js): per werkdag het aantal bezoeken en of ze bevestigd zijn; een klik kiest die dag.
  const weekstrook = el('div', { class: 'week-strip sales-route-weekstrook', role: 'group', 'aria-label': 'Week van de gekozen datum' });
  const samenvatting = el('div', { class: 'sales-route-samenvatting' });
  const melding = el('div', { class: 'sales-route-melding', role: 'status', hidden: true });
  const wegafsluiting = el('div', { class: 'sales-route-wegafsluiting', role: 'alert', hidden: true, text: WEGAFSLUITING_TEKST });
  const nota = el('p', { class: 'sales-route-nota', hidden: true });
  const lijst = el('ol', { class: 'sales-route-lijst' });
  const leeg = el('p', { class: 'sales-leeg sales-route-leeg', hidden: true, text: LEEG_TEKST });
  const kaartEl = el('div', { id: 'sales-kaart', class: 'sales-route-kaart', role: 'region', 'aria-label': 'Kaart van de route' });
  const kaartNoot = el('p', { class: 'sales-route-nota', hidden: true, text: 'De kaart kon niet geladen worden (geen verbinding met de kaartdienst). De lijst klopt wel.' });
  const kaartVak = el('div', { class: 'sales-route-kaartvak' }, kaartEl, kaartNoot);
  const lijstVak = el('div', { class: 'sales-route-lijstvak' }, nota, lijst);
  const inhoudVak = el('div', { class: 'sales-route-inhoud' }, lijstVak, kaartVak);
  const wortel = el('div', { class: 'sales-route-wortel' }, dagkiezer, weekstrook, samenvatting, wegafsluiting, melding, leeg, inhoudVak);
  inhoud.replaceChildren(wortel);

  const naarDatum = (iso) => { if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) zetGekozenDatum(iso); };
  kiezer.addEventListener('change', () => naarDatum(kiezer.value));

  return {
    wortel, kiezer, weekstrook, samenvatting, wegafsluiting, melding, nota, lijst, leeg, kaartEl, kaartNoot, inhoudVak,
    kaart: null, laatste: null, route: null, bezigSig: null, aanvraag: 0, depot: null, depotVoor: null, depotBezig: false,
    toonde: false, kaartHerstel: false, wegToastSig: null,
  };
}

const staatVan = (inhoud) => {
  let s = staten.get(inhoud);
  if (!s) { s = bouwSkelet(inhoud); staten.set(inhoud, s); }
  return s;
};

const zichtbaar = (inhoud) => inhoud.getClientRects().length > 0;

// ---- tekenen ----

function ritTekst(rit, geschat) {
  if (rit?.ritSec == null) return null;
  const km = rit.afstandM != null ? ` · ${Math.max(1, Math.round(rit.afstandM / 1000))} km` : '';
  return `${geschat ? 'rit ca. ' : 'rit '}${fmtSec(rit.ritSec)}${km}`;
}

function maakRij(stop, rit, geschat, laatMin, kanResultaat) {
  const li = el('li', {
    class: `sales-route-rij ${stop.vast ? 'sales-bevestigd' : 'sales-voorgesteld'}${laatMin ? ' sales-route-laat' : ''}`,
    'data-lead-id': stop.leadId,
  });
  maakActiveerbaar(li, () => openLeadDetail(stop.leadId), `Open ${stop.naam}`);
  li.addEventListener('click', (e) => { if (!e.target.closest('button, a')) openLeadDetail(stop.leadId); });
  li.append(el('div', { class: 'sales-route-kop' },
    el('span', { class: 'sales-route-nr', text: stop.nr }),
    el('span', { class: 'sales-route-naam', text: stop.naam }),
    el('span', { class: 'sales-route-uur', text: `${stop.start} · ${stop.duurMin} min` })));
  if (stop.plaats) li.append(el('div', { class: 'sales-route-plaats', text: stop.plaats }));
  const chips = el('div', { class: 'sales-kaart-chips' });
  if (stop.vast) chips.append(el('span', { class: 'sales-chip sales-chip-vast', text: 'vast uur' }));
  if (stop.ongeveer) chips.append(el('span', { class: 'sales-chip sales-route-ongeveer', title: ONGEVEER_TEKST, text: `ongeveer — enkel postcode` }));
  if (!stop.locatie) chips.append(el('span', { class: 'sales-chip sales-route-geenloc', text: 'geen locatie — niet op de kaart' }));
  if (chips.childNodes.length) li.append(chips);
  const tekst = ritTekst(rit, geschat);
  if (tekst) li.append(el('div', { class: 'sales-route-rit', text: tekst }));
  if (kanResultaat) {
    const knop = el('button', { type: 'button', class: 'btn btn--secondary sales-route-resultaat', text: 'Resultaat', 'aria-label': `Resultaat ingeven voor ${stop.naam}` });
    knop.addEventListener('click', (e) => { e.stopPropagation(); openResultaat(stop.leadId); });
    li.append(knop);
  }
  return li;
}

const waarschuwing = (laatMin) => el('div', { class: 'sales-route-waarschuwing', role: 'alert', text: WAARSCHUWING_TEKST(laatMin) });

function tekenLijst(s, stops, depot, route, startTekst, laat, geschat, kanResultaat) {
  const rijen = [];
  if (startTekst) {
    const li = el('li', { class: 'sales-route-rij sales-route-depot' },
      el('div', { class: 'sales-route-kop' }, el('span', { class: 'sales-route-nr', 'aria-hidden': 'true', text: 'S' }), el('span', { class: 'sales-route-naam', text: `Vertrek: ${startTekst}` })));
    if (depot?.ongeveer) li.append(el('div', { class: 'sales-chip sales-route-ongeveer', text: ONGEVEER_TEKST }));
    const eerste = laat.find((l) => l.leadId === stops[0]?.leadId);
    if (eerste) li.append(waarschuwing(eerste.laatMin));
    rijen.push(li);
  }
  stops.forEach((stop, i) => {
    const laatNaDeze = laat.find((l) => l.leadId === stops[i + 1]?.leadId);
    const rij = maakRij(stop, route?.legs?.[i], geschat, laat.some((l) => l.leadId === stop.leadId), kanResultaat);
    if (laatNaDeze) rij.append(waarschuwing(laatNaDeze.laatMin));
    rijen.push(rij);
  });
  s.lijst.replaceChildren(...rijen);
}

function samenvattingTekst(stops, route) {
  const delen = [stops.length === 1 ? '1 bezoek' : `${stops.length} bezoeken`];
  if (route && route.totaalMeter > 0) delen.push(`${Math.max(1, Math.round(route.totaalMeter / 1000))} km`);
  if (route && route.totaalSec > 0) delen.push(`${fmtSec(route.totaalSec)} rijden${route.geschat ? ' (geschat)' : ''}`);
  const vertraging = route?.data ? routeVertraging(route.data) : 'geen';
  if (vertraging !== 'geen') delen.push(`vertraging ${vertraging}`);
  const ongeveer = stops.filter((x) => x.ongeveer).length;
  if (ongeveer) delen.push(`${ongeveer} ongeveer`);
  return delen.join(' · ');
}

function teken(inhoud) {
  const s = staatVan(inhoud);
  const toestand = salesToestand();
  const datum = gekozenDatum();
  s.kiezer.value = datum;
  renderWeekstrook(s.weekstrook, {
    datum, werkdagen: toestand.instellingen.werkdagen, vandaag: localISO(new Date()), kies: zetGekozenDatum,
    dagInfo: (iso) => weekDagInfo(toestand.leads, iso),
  });

  const stops = bouwRouteStops(toestand.leads, datum, { standaardDuurMin: toestand.instellingen.bezoekDuurMin });
  const sleutel = `${toestand.gebruikerId ?? ''}|${datum}`;
  const start = String(toestand.instellingen.startlocatie ?? '').trim();

  if (!zichtbaar(inhoud)) { s.toonde = false; return; } // een verborgen tab tekent niet (geen kaart op 0x0, geen overbodige route-aanvraag); toon() tekent opnieuw

  const eerstGetoond = !s.toonde;
  s.toonde = true;
  s.melding.hidden = s.laatste?.sleutel !== sleutel ? true : s.melding.hidden;

  // Het depot (async; de route wacht erop zodat een late depot-aankomst geen valse "Route herberekend" geeft).
  if (s.depotVoor !== start) {
    s.depotVoor = start;
    s.depot = null;
    s.depotBezig = Boolean(start);
    if (start) {
      zoekDepot(start).then((d) => {
        if (s.depotVoor !== start) return;
        s.depot = d;
        s.depotBezig = false;
        if (staten.get(inhoud) === s) teken(inhoud);
      }).catch(() => { if (s.depotVoor === start) { s.depotBezig = false; teken(inhoud); } });
    }
  }
  const depot = s.depot;

  const heeftStops = stops.length > 0;
  s.leeg.hidden = heeftStops;
  s.inhoudVak.hidden = !heeftStops;
  s.samenvatting.hidden = !heeftStops;

  // Notas boven de lijst: geen of onvindbaar startadres.
  const nota = !start ? GEEN_START_TEKST : (!s.depotBezig && !depot ? START_ONBEKEND_TEKST : '');
  s.nota.textContent = nota;
  s.nota.hidden = !nota || !heeftStops;

  if (!heeftStops) {
    s.wortel.dataset.handtekening = '';
    s.melding.hidden = true;
    s.wegafsluiting.hidden = true;
    s.kaartHerstel = true; // de kaart zit nu in een verborgen vak: bij de volgende keer opnieuw opmeten
    return;
  }

  const sig = routeHandtekening(depot, stops);
  s.wortel.dataset.handtekening = sig;
  const geldig = s.route?.sig === sig ? s.route : null;
  const kanResultaat = schrijfbaarNu();
  tekenRoute(s, stops, depot, geldig, start, toestand.instellingen, kanResultaat);

  if (!s.kaart) {
    const stijl = toestand.instellingenRuw?.kaartStijl;
    s.kaart = maakSalesKaart(s.kaartEl, { kaartStijl: typeof stijl === 'string' && Object.hasOwn(KAART_LAGEN, stijl) ? stijl : undefined });
    s.kaartNoot.hidden = s.kaart.beschikbaar;
  }
  tekenKaart(s, stops, depot, geldig, sig);
  if (eerstGetoond || s.kaartHerstel) { s.kaartHerstel = false; requestAnimationFrame(() => s.kaart?.invalideer()); }

  if (!geldig && !s.depotBezig && s.bezigSig !== sig) rekenRoute(inhoud, s, { sig, sleutel, stops, depot, datum, vanTijd: toestand.instellingen.vanTijd });
}

function tekenRoute(s, stops, depot, route, start, instellingen, kanResultaat) {
  const legsMin = route ? route.legs.map((l) => (l.ritSec == null ? null : l.ritSec / 60)) : stops.map(() => null);
  // Het eerste bezoek wordt gecontroleerd vanaf het vertrek uit het depot (= begin van de werkdag).
  const depotVertrekMin = depot && instellingen.vanTijd ? timeStrToMin(instellingen.vanTijd) : undefined;
  const laat = route ? controleerKeten(stops, legsMin, depotVertrekMin) : [];
  tekenLijst(s, stops, depot, route, start && (depot || s.depotBezig) ? start : '', laat, route?.geschat === true, kanResultaat);
  s.samenvatting.textContent = samenvattingTekst(stops, route);
}

// De routekleur en de drukte-kleuring van de verkoper (ruwe instellingen; ontbrekend = de standaard van de technieker: amber en aan).
const kaartInstellingen = () => {
  const ruw = salesToestand().instellingenRuw ?? {};
  return { routeKleur: typeof ruw.routeKleur === 'string' ? ruw.routeKleur : undefined, drukteKleuring: ruw.drukteKleuring !== false };
};

function tekenKaart(s, stops, depot, route, sig) {
  const uit = s.kaart?.toon({
    depot, stops, polyline: route?.polyline ?? [], geschat: route?.geschat === true, routeData: route?.data ?? null, ...kaartInstellingen(),
  });
  const weg = uit?.wegafsluiting === true;
  s.wegafsluiting.hidden = !weg;
  if (weg && s.wegToastSig !== sig) { s.wegToastSig = sig; toast(WEGAFSLUITING_TOAST, 6000); } // één keer per route, ook al wordt de kaart nog meermaals getekend
}

// De verwachte drukte per wegvak (toekomstige dag) komt na de route binnen en kleurt de kaart in; zonder (of bij een fout) blijft het leg-vangnet staan.
async function laadDrukte(inhoud, s, route) {
  try {
    const detail = await haalDrukteDetail({ rData: route.data, apiVerzoek, drukteKleuring: kaartInstellingen().drukteKleuring });
    if (!detail || s.route !== route || staten.get(inhoud) !== s) return; // niet van toepassing, of de route is intussen vervangen
    route.data.drukteDetail = detail.segmenten;
    teken(inhoud);
  } catch (fout) {
    console.warn('Drukte-detail niet beschikbaar:', fout);
  }
}

async function rekenRoute(inhoud, s, { sig, sleutel, stops, depot, datum, vanTijd }) {
  s.bezigSig = sig;
  const mijn = ++s.aanvraag;
  let resultaat;
  try {
    resultaat = await berekenRoute({
      depot, stops, datum, vertrekMin: vanTijd ? timeStrToMin(vanTijd) : null, apiVerzoek, testModus: false,
    });
  } catch (fout) {
    console.error('Sales-route berekenen mislukt:', fout);
    s.bezigSig = null;
    return;
  }
  if (mijn !== s.aanvraag || staten.get(inhoud) !== s) return; // een nieuwere aanvraag of een ander scherm
  s.bezigSig = null;
  const vorige = s.laatste;
  s.route = { sig, ...resultaat };
  s.laatste = { sleutel, sig };
  if (resultaat.geschat) toast('Rit geschat');
  if (vorige && vorige.sleutel === sleutel && vorige.sig !== sig) {
    s.melding.textContent = 'Route herberekend';
    s.melding.hidden = false;
    toast('Route herberekend');
  } else if (!vorige || vorige.sleutel !== sleutel) {
    s.melding.hidden = true;
  }
  teken(inhoud);
  if (!resultaat.geschat && resultaat.data) laadDrukte(inhoud, s, s.route);
}

export const toon = (view) => startScherm(view, teken);
