// schermen/route-kaart.js — Leaflet-kaart van de Route-tab (etappe 3): basiskaarten, routelijn, markers,
// drukte-kleuring en legende. `L` (Leaflet, CDN) is een global en wordt enkel binnen functies gebruikt,
// nooit op moduleniveau. De kaarttoestand (`leafletMap`, `routeLayer`, ...) is module-privé; instellingen
// en bewaren komen via `initKaart({ ... })`, de routegegevens via `updateKaart({ ... })`.
// De code is letterlijk uit index.html verhuisd.
import { toast, escHtml } from '../kern/ui.js';
import { drukteMagnitude } from './route-tijden.js';

// Afhankelijkheden uit app.js (ingevuld door initKaart).
const nietGeinitialiseerd = () => { throw new Error('route-kaart: initKaart() is niet aangeroepen'); };
let instellingen = nietGeinitialiseerd;
let bewaarKaartStijl = nietGeinitialiseerd;
let standaardRouteKleur = '#f59e0b';
export function initKaart(afh) {
  instellingen = afh.instellingen;
  bewaarKaartStijl = afh.bewaarKaartStijl;
  standaardRouteKleur = afh.standaardRouteKleur;
}

// Kaartlagen — 5 gratis basiskaarten, keuze wordt per persoon onthouden in instellingen().kaartStijl.
// Esri als 'standaard' (kaart-snelheid-onderzoek 2026-09-22): commerciële CDN zonder OSM's
// "fair use"-beleid/throttling-risico. OpenStreetMap blijft gewoon kiesbaar (sleutel 'osm').
// Migratie: een eerder opgeslagen instellingen().kaartStijl === 'standaard' wijst voortaan automatisch
// naar deze nieuwe laag — 'standaard' blijft een geldige sleutel, enkel de laag erachter wijzigt
// (aanvaardbaar, geen aparte migratiecode nodig).
export const KAART_LAGEN = {
  standaard: { naam: 'Standaard', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', opts: { attribution: 'Tiles © Esri', maxZoom: 19 } },
  osm:       { naam: 'OpenStreetMap', url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', opts: { attribution: '© OpenStreetMap', maxZoom: 19 } },
  // CARTO's gratis anonieme tegels vereisen sinds kort een API-key (watermerk "API KEY
  // REQUIRED") — vervangen door Esri's gratis Canvas-basemaps. Die stoppen op zoom 16;
  // maxNativeZoom houdt de laatst geladen tegel scherp bij verder inzoomen i.p.v. blanco.
  licht:     { naam: 'Licht',     url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', opts: { attribution: 'Tiles © Esri', maxZoom: 19, maxNativeZoom: 16 } },
  donker:    { naam: 'Donker',    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',  opts: { attribution: 'Tiles © Esri', maxZoom: 19, maxNativeZoom: 16 } },
  satelliet: { naam: 'Satelliet', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', opts: { attribution: 'Tiles © Esri', maxZoom: 19 } },
};
// Module-privé kaarttoestand (Leaflet wordt pas bij initMap() aangeraakt, nooit op moduleniveau).
let leafletMap = null, routeLayer = null;
let routeLegendeControl = null;

// Drukte-kleuring per wegstuk (TomTom TRAFFIC-secties, magnitudeOfDelay 0-4). Enkel voor
// JAM/OTHER — een ROAD_WORK- of ROAD_CLOSURE-sectie gebruikt altijd zijn eigen stijl
// hieronder (tekenWerkOfSluitingSectie), nooit DRUKTE_KLEUR[4]/DRUKTE_LABEL[4] (dat gaf
// voorheen een wegenwerken-sectie zónder vertraging misleidend weer als "afsluiting").
const DRUKTE_KLEUR = { 0: '#9ca3af', 1: '#facc15', 2: '#f97316', 3: '#ef4444', 4: '#7f1d1d' };
const DRUKTE_LABEL = { 0: 'onbekend', 1: 'lichte vertraging', 2: 'matige vertraging', 3: 'zware vertraging', 4: 'zware file' };
const CAT_LABEL = { JAM: 'file', OTHER: 'hinder' };
// Wegenwerken/wegafsluitingen zijn geen drukte-signaal (delayInSeconds is er zo goed als
// altijd 0, zie drukte.js) — eigen, herkenbare gestippelde stijl i.p.v. de drukte-kleuren.
const WEGWERK_KLEUR = '#a855f7';
const WEGSLUITING_KLEUR = '#7f1d1d';
// Reset in calculateRoute() zodat de wegafsluiting-toast maar één keer per routeberekening
// verschijnt, ook al wordt updateMap() daarna nog meermaals aangeroepen (rit-vangnet, dan
// het per-wegvak-detail dat asynchroon binnenkomt).
let wegafsluitingToastGetoond = false;

// Tekent een ROAD_WORK- of ROAD_CLOSURE-sectie op `laag` in zijn eigen gestippelde stijl (geen
// drukte-kleur — zie DRUKTE_KLEUR hierboven) en geeft true terug als het er een was, zodat
// de aanroeper JAM/OTHER-afhandeling kan overslaan. `waarschuw()` wordt aangeroepen bij een
// wegafsluiting zodat de aanroeper de kaart-brede waarschuwing kan tonen.
function tekenWerkOfSluitingSectie(laag, sec, pts, waarschuw) {
  if (sec.simpleCategory === 'ROAD_WORK') {
    const vertragingTxt = sec.delayInSeconds > 0
      ? ` · +${Math.round(sec.delayInSeconds / 60)} min`
      : ' · geen vertraging verwacht';
    const snelheidTxt = sec.effectiveSpeedInKmh != null ? ` · ${Math.round(sec.effectiveSpeedInKmh)} km/u` : '';
    L.polyline(pts, { color: WEGWERK_KLEUR, weight: 5, opacity: 0.95, dashArray: '8 6' })
      .bindPopup(`<b>Wegenwerken</b>${escHtml(vertragingTxt)}${escHtml(snelheidTxt)}`)
      .addTo(laag);
    return true;
  }
  if (sec.simpleCategory === 'ROAD_CLOSURE') {
    L.polyline(pts, { color: WEGSLUITING_KLEUR, weight: 7, opacity: 1, dashArray: '10 6' })
      .bindPopup('<b>Wegafsluiting op de route</b><br>TomTom kon er niet omheen — controleer de bereikbaarheid van het adres.')
      .addTo(laag);
    waarschuw();
    return true;
  }
  return false;
}

// Laat de drukte-kleuren vloeiend in elkaar overlopen: op elke grens tussen twee opeenvolgende
// drukte-segmenten (of een drukte-segment en een ongetekend segment zonder vertraging, dat de
// gewone routekleur krijgt) met een ANDERE kleur komt een overgangszone van DRUKTE_OVERGANG_METERS aan
// weerszijden (max. 25% van de lengte van het aanliggende segment). De kleur loopt er lineair
// (RGB) van links naar rechts, met het midden precies op de grens. De segmenten zelf (met hun
// popup) blijven als basis staan; de overgang komt er als korte, niet-klikbare stukjes
// (~DRUKTE_OVERGANG_STAP_METERS) bovenop, zodat een klik nog steeds het segment-popup opent.
// `segmenten`: [{ startIndex, endIndex }] in routevolgorde; `kleurVan(seg)` geeft de hex-kleur.
// Geeft het aantal getekende stukjes terug.
const DRUKTE_OVERGANG_METERS = 150;
const DRUKTE_OVERGANG_STAP_METERS = 20;
function tekenDrukteOvergangen(laag, polyline, segmenten, kleurVan) {
  const hexNaarRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const mix = (c1, c2, t) => '#' + c1.map((v, i) => Math.round(v + (c2[i] - v) * t).toString(16).padStart(2, '0')).join('');
  // Cumulatieve afstand (m) langs een reeks [lat,lon]-punten.
  const cumul = pts => {
    const d = [0];
    for (let i = 1; i < pts.length; i++) d.push(d[i - 1] + L.latLng(pts[i - 1]).distanceTo(L.latLng(pts[i])));
    return d;
  };
  // Punt op afstand x (m) langs de reeks, lineair tussen de omliggende punten.
  const puntOp = (pts, d, x) => {
    let i = 1;
    while (i < d.length - 1 && d[i] < x) i++;
    const span = d[i] - d[i - 1] || 1;
    const f = Math.min(1, Math.max(0, (x - d[i - 1]) / span));
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
  };
  let aantal = 0;
  for (let k = 0; k + 1 < segmenten.length; k++) {
    const a = segmenten[k], b = segmenten[k + 1];
    if (b.startIndex > a.endIndex + 1) continue;            // niet aansluitend: geen grens
    const kleurA = kleurVan(a), kleurB = kleurVan(b);
    if (kleurA === kleurB) continue;
    const ptsA = polyline.slice(a.startIndex, a.endIndex + 1);
    const ptsB = polyline.slice(b.startIndex, b.endIndex + 1);
    if (ptsA.length < 2 || ptsB.length < 2) continue;
    const dA = cumul(ptsA), dB = cumul(ptsB);
    const lenA = dA[dA.length - 1], lenB = dB[dB.length - 1];
    const zoneL = Math.min(DRUKTE_OVERGANG_METERS, lenA * 0.25);
    const zoneR = Math.min(DRUKTE_OVERGANG_METERS, lenB * 0.25);
    if (zoneL + zoneR <= 0) continue;
    // Samengesteld pad rond de grens (grens op afstand lenA).
    const pad = ptsA.concat(ptsB);
    const d = cumul(pad);
    const grens = lenA;
    const van = grens - zoneL, tot = grens + zoneR;
    const stukken = Math.max(2, Math.ceil((tot - van) / DRUKTE_OVERGANG_STAP_METERS));
    const rgbA = hexNaarRgb(kleurA), rgbB = hexNaarRgb(kleurB);
    for (let s = 0; s < stukken; s++) {
      const x0 = van + (tot - van) * s / stukken, x1 = van + (tot - van) * (s + 1) / stukken;
      const mid = (x0 + x1) / 2;
      const t = mid < grens
        ? 0.5 * (mid - van) / zoneL
        : 0.5 + 0.5 * (mid - grens) / zoneR;
      L.polyline([puntOp(pad, d, x0), puntOp(pad, d, x1)], {
        color: mix(rgbA, rgbB, t), weight: 6, opacity: 0.95, lineCap: 'butt', interactive: false,
      }).addTo(laag);
      aantal++;
    }
  }
  return aantal;
}

// Tekent de berekende route (TomTom-lijn) met de drukte- en werken-kleuring op `laag` van `kaart`, en voegt de legende toe: gedeeld door de
// route van de technieker (updateKaart hieronder) en die van de verkoper (sales-kaart.js), zodat lijnen, kleuren, popups en legende gelijk zijn.
// `routeData` = het antwoord van /api/route (polyline, legs, sections, departAtUsed, drukteDetail wanneer geladen); `routeKleur` = de gekozen
// routekleur (ongeldig of leeg: `standaardKleur`); `drukteKleuring` = de instelling (uit: enkel de lijn, geen legende).
// De oproeper wist de laag en de vorige legende vooraf. Geeft { poly, legende, wegafsluiting }: de basislijn, de legende (of null) en of er een
// ROAD_CLOSURE op de route ligt (de oproeper toont dan de waarschuwing).
export function tekenRouteLaag({ kaart, laag, routeData, routeKleur, drukteKleuring, standaardKleur = '#f59e0b' }) {
  const poly = L.polyline(routeData.polyline, { color: routeKleur || standaardKleur, weight: 4, opacity: 0.85 }).addTo(laag);
  let legende = null;
  let wegafsluiting = false;
  if (drukteKleuring) {
    let wegafsluitingGevonden = false;
    const waarschuwWegafsluiting = () => { wegafsluitingGevonden = true; };

    // Gedeeld door de "vandaag"- en "toekomstige dag"-tak hieronder: tekent JAM/OTHER-
    // secties met de drukte-kleuren, en laat een ROAD_WORK/ROAD_CLOSURE-sectie in zijn
    // eigen gestippelde stijl tekenen (nooit als drukte-kleur). `alleenMetVertraging`
    // slaat een JAM/OTHER-sectie zonder effectieve vertraging over — enkel relevant voor
    // een toekomstige dag, waar zo'n sectie sowieso zeldzaam is (zie drukte.js).
    const tekenDrukteSecties = (secties, alleenMetVertraging) => {
      secties.forEach(sec => {
        const pts = routeData.polyline.slice(sec.startPointIndex, sec.endPointIndex + 1);
        if (pts.length < 2) return;
        if (tekenWerkOfSluitingSectie(laag, sec, pts, waarschuwWegafsluiting)) return;
        if (alleenMetVertraging && (sec.delayInSeconds || 0) <= 0) return;
        const kleur = DRUKTE_KLEUR[sec.magnitudeOfDelay] || DRUKTE_KLEUR[0];
        const label = DRUKTE_LABEL[sec.magnitudeOfDelay] || DRUKTE_LABEL[0];
        const catLabel = CAT_LABEL[sec.simpleCategory] || 'hinder';
        L.polyline(pts, { color: kleur, weight: 6, opacity: 0.95 })
          .bindPopup(`<b>+${Math.round(sec.delayInSeconds / 60)} min</b> · ${escHtml(catLabel)} (${escHtml(label)})`)
          .addTo(laag);
      });
    };

    // Vangnet: kleur per leg o.b.v. twee signalen — (1) live vertraging/reistijd-
    // verhouding (werkt voor vandaag, met live verkeer); (2) bij een toekomstig departAt
    // is het enige bruikbare congestiesignaal het verschil tussen de historische
    // (typische) reistijd voor dat tijdstip en de vrije doorstroming
    // (noTrafficTravelTimeSeconds) — we nemen de zwaarste van de twee. Gebruikt zowel
    // vandaag (geen sections) als op een toekomstige dag zolang het per-wegvak-detail nog
    // laadt of niet lukte.
    const tekenLegVangnet = () => {
      let offset = 0;
      (routeData.legs || []).forEach(leg => {
        const pointCount = leg.pointCount || 0;

        const liveRatio = (leg.trafficDelaySeconds || 0) / Math.max(1, leg.travelTimeSeconds || 0);
        const liveMagnitude = drukteMagnitude(1 + liveRatio);

        const basis    = leg.noTrafficTravelTimeSeconds || 0;
        const verwacht = leg.historicTrafficTravelTimeSeconds ?? leg.travelTimeSeconds;
        let historMagnitude = 0;
        let historRatio = 0;
        if (basis > 0) {
          historRatio = verwacht / basis;
          historMagnitude = drukteMagnitude(historRatio);
        }

        const magnitude = Math.max(liveMagnitude, historMagnitude);
        if (magnitude > 0) {
          const pts = routeData.polyline.slice(offset, offset + pointCount);
          if (pts.length >= 2) {
            const popup = historMagnitude >= liveMagnitude && basis > 0
              ? `+${Math.round((verwacht - basis) / 60)} min verwachte vertraging op deze rit (${Math.round((historRatio - 1) * 100)}% trager dan vrije doorstroming)`
              : `+${Math.round((leg.trafficDelaySeconds || 0) / 60)} min verwachte vertraging op deze rit`;
            L.polyline(pts, { color: DRUKTE_KLEUR[magnitude], weight: 6, opacity: 0.95 })
              .bindPopup(popup)
              .addTo(laag);
          }
        }
        offset += pointCount;
      });
    };

    if (routeData.departAtUsed) {
      // Toekomstige dag: het per-wegvak-detail (of het leg-vangnet zolang dat nog laadt)
      // is de basis-kleuring; TomTom's sections voor een toekomstig departAt zijn geen
      // drukte-signaal (zie drukte.js/route.js) maar geplande wegenwerken/afsluitingen —
      // die tekenen we er bovenop, apart herkenbaar, i.p.v. ze de drukte-kleuring te
      // laten verdringen (v1.5.0-gedrag: zodra er ergens wegenwerken op de route lagen,
      // verscheen er geen drukte-kleuring meer omdat sections voorrang kregen).
      if (routeData.drukteDetail?.length) {
        const getekendeSegmenten = [];
        const overgangsSegmenten = [];
        routeData.drukteDetail.forEach(seg => {
          if (seg.betrouwbaar === false) return;
          // Altijd op de eigen routelijn tekenen — nooit TomTom's teruggegeven
          // leg-geometrie (die kan bij een geweigerde/mislukte reconstructie een
          // keerlus/omweg bevatten, vandaar ook de sanity-check in drukte.js).
          const pts = routeData.polyline.slice(seg.startIndex, seg.endIndex + 1);
          if (pts.length < 2) return;
          const ratio = (seg.historicSeconds && seg.noTrafficSeconds) ? seg.historicSeconds / seg.noTrafficSeconds : 0;
          const m = drukteMagnitude(ratio);
          if (m === 0) { overgangsSegmenten.push({ startIndex: seg.startIndex, endIndex: seg.endIndex, m: 0 }); return; }
          const hhmm = escHtml(new Date(Date.parse(routeData.departAtUsed) + seg.vertrekOffsetSeconds * 1000)
            .toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' }));
          L.polyline(pts, { color: DRUKTE_KLEUR[m], weight: 6, opacity: 0.95 })
            .bindPopup(`<b>+${Math.round((seg.historicSeconds - seg.noTrafficSeconds) / 60)} min</b> · ${Math.round((ratio - 1) * 100)}% trager dan vrije doorstroming<br><span style="opacity:.7">verwacht rond ${hhmm}</span>`)
            .addTo(laag);
          getekendeSegmenten.push({ startIndex: seg.startIndex, endIndex: seg.endIndex, m });
          overgangsSegmenten.push(getekendeSegmenten[getekendeSegmenten.length - 1]);
        });
        // Betrouwbare segmenten zonder vertraging (m = 0) tekenen we niet, maar ze tellen wél
        // mee als "normale routekleur" voor de overgang; onbetrouwbare segmenten ontbreken hier
        // en vormen dus een harde grens (nooit doorvloeien in een segment zonder betrouwbare data).
        const basisKleur = /^#[0-9a-f]{6}$/i.test(routeKleur || '') ? routeKleur : standaardKleur;
        routeData.drukteOvergangAantal = tekenDrukteOvergangen(laag, routeData.polyline, overgangsSegmenten, sg => sg.m === 0 ? basisKleur : DRUKTE_KLEUR[sg.m]);
      } else {
        tekenLegVangnet();
      }
      if (routeData.sections?.length) tekenDrukteSecties(routeData.sections, true);
    } else if (routeData.sections?.length) {
      // Vandaag/live: TomTom's live sections zijn het preciestse signaal.
      tekenDrukteSecties(routeData.sections, false);
    } else {
      tekenLegVangnet();
    }

    wegafsluiting = wegafsluitingGevonden;

    // Legende: de oproeper houdt de referentie bij en haalt ze weg vóór een nieuwe tekening (nooit twee tegelijk).
    legende = L.control({ position: 'bottomright' });
    legende.onAdd = () => {
      const div = L.DomUtil.create('div', 'route-legende');
      const drukteItems = [1, 2, 3, 4].map(m =>
        `<div class="rl-item"><span class="rl-streep" style="background:${DRUKTE_KLEUR[m]}"></span>${escHtml(DRUKTE_LABEL[m])}</div>`
      ).join('');
      div.innerHTML = drukteItems +
        `<div class="rl-item"><span class="rl-streep" style="background:${WEGWERK_KLEUR}"></span>wegenwerken</div>` +
        `<div class="rl-item"><span class="rl-streep" style="background:${WEGSLUITING_KLEUR}"></span>wegafsluiting</div>`;
      return div;
    };
    legende.addTo(kaart);
  }
  return { poly, legende, wegafsluiting };
}

// Gedeelde lagenkeuze (technieker-route én sales-route): de vijf basiskaarten als Leaflet-lagen op `kaart`, de keuzelijst rechtsboven en de
// bewaarhaak. `startSleutel`: sleutel van KAART_LAGEN (onbekend = standaard). `bijKeuze(sleutel)` wordt enkel aangeroepen als de GEBRUIKER een
// andere kaart kiest; een wissel via `zet(sleutel)` (persoonswissel, andere verkoper) toont enkel en bewaart nooit (AT-fix 1: Leaflet vuurt
// 'baselayerchange' ook bij addTo, zonder die vlag zou het bekijken van een ander diens instellingen overschrijven).
const geldigeSleutel = (sleutel) => (typeof sleutel === 'string' && Object.hasOwn(KAART_LAGEN, sleutel) ? sleutel : 'standaard');
export function voegKaartLagenToe(kaart, { startSleutel, bijKeuze } = {}) {
  const lagen = {};
  Object.values(KAART_LAGEN).forEach((laag) => { lagen[laag.naam] = L.tileLayer(laag.url, laag.opts); });
  lagen[KAART_LAGEN[geldigeSleutel(startSleutel)].naam].addTo(kaart);
  L.control.layers(lagen, null, { position: 'topright', collapsed: false }).addTo(kaart);
  let wordtToegepast = false;
  kaart.on('baselayerchange', (e) => {
    if (wordtToegepast) return;
    const sleutel = Object.keys(KAART_LAGEN).find((k) => KAART_LAGEN[k].naam === e.name);
    if (sleutel) bijKeuze?.(sleutel);
  });
  return {
    /** Schakelt de actieve basislaag om naar `sleutel` (onbekend = standaard), zonder iets te bewaren. */
    zet(sleutel) {
      const doelLaag = lagen[KAART_LAGEN[geldigeSleutel(sleutel)].naam];
      if (!doelLaag) return;
      wordtToegepast = true;
      try {
        Object.values(lagen).forEach((laag) => { if (kaart.hasLayer(laag)) kaart.removeLayer(laag); });
        doelLaag.addTo(kaart);
      } finally { wordtToegepast = false; }
    },
  };
}

let kaartLagenKeuze = null;
export function initMap() {
  // fadeAnimation uit: Leaflet's tegel-fade is een rAF-lus op Date.now() (tot 200 ms na het laden van een tegel). Onder de e2e-nepklok met
  // vastgezette tijd (setFixedTime) eindigt die lus nooit en elke page.clock.runFor kost dan echte tijd (zie eindreview-fix-report.md).
  leafletMap  = L.map('map', { zoomControl: true, fadeAnimation: false }).setView([51.0, 4.5], 8);
  kaartLagenKeuze = voegKaartLagenToe(leafletMap, {
    startSleutel: instellingen().kaartStijl,
    bijKeuze: (sleutel) => { instellingen().kaartStijl = sleutel; bewaarKaartStijl(sleutel); },
  });
  routeLayer  = L.layerGroup().addTo(leafletMap);
}

// Schakelt de actieve basislaag om naar instellingen().kaartStijl — gebruikt na een persoonswissel
// zodat de kaart meteen de eigen kaartstijl van die persoon toont.
export function applyKaartStijl() {
  if (!leafletMap || !kaartLagenKeuze) return;
  kaartLagenKeuze.zet(instellingen().kaartStijl);
}

export function updateKaart({ date, allStops, routeData, currentRouteDate }) {
  // Fix (bugronde 2026-09-22, item G): geen kaart (Leaflet-CDN faalde) -- niets te tekenen.
  if (!leafletMap || !routeLayer) return;
  routeLayer.clearLayers();
  // Legende hoort bij de drukte-overlay, dus eerst weghalen — wordt hieronder opnieuw
  // toegevoegd als er effectief een route + drukte-kleuring getoond wordt.
  if (routeLegendeControl) { leafletMap.removeControl(routeLegendeControl); routeLegendeControl = null; }
  // Wegafsluiting-waarschuwing hoort bij deze render — altijd wissen, wordt verderop
  // opnieuw gezet als er dit keer effectief een ROAD_CLOSURE-sectie op de route ligt.
  const warnEl0 = document.getElementById('s-warn');
  if (warnEl0) warnEl0.textContent = '';
  // `allStops`: zelfde combinatie + sortering als renderRouteList()/calculateRoute(), zodat de
  // kaartnummering (1,2,3...) exact overeenkomt met de lijst ernaast, en handmatige
  // afspraken ook zichtbaar worden (voorheen enkel Zoho-tickets). De oproeper levert ze aan.
  if (!allStops.length) return;
  if (routeData?.polyline?.length && currentRouteDate === date) {
    const r = tekenRouteLaag({ kaart: leafletMap, laag: routeLayer, routeData, routeKleur: instellingen().routeKleur, drukteKleuring: instellingen().drukteKleuring, standaardKleur: standaardRouteKleur });
    leafletMap.fitBounds(r.poly.getBounds(), { padding:[30,30] });
    routeLegendeControl = r.legende;
    if (r.wegafsluiting) {
      const warnEl = document.getElementById('s-warn');
      if (warnEl) warnEl.textContent = '⚠ wegafsluiting op de route';
      if (!wegafsluitingToastGetoond) {
        wegafsluitingToastGetoond = true;
        toast('⚠ Wegafsluiting op de route — controleer de bereikbaarheid van het adres', 6000);
      }
    }
  }
  const pts = [];
  allStops.forEach((entry, i) => {
    const item = entry.item;
    if (!item._lat) return;
    const label = entry.kind === 'ticket' ? escHtml(item.ticket.subject) : escHtml(item.titel || 'Afspraak');
    const addr  = entry.kind === 'ticket' ? item.address : (item.adres || item.notitie);
    L.marker([item._lat, item._lon], { icon: L.divIcon({
      html:`<div style="background:#f59e0b;color:#000;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:11px;border:2px solid #000;box-shadow:0 2px 5px rgba(0,0,0,.4)">${i+1}</div>`,
      iconSize:[24,24], iconAnchor:[12,12], className:'',
    })}).bindPopup(`<b>#${i+1}</b> ${label}<br>${escHtml(addr || '')}`).addTo(routeLayer);
    pts.push([item._lat, item._lon]);
  });
  if (pts.length && !(routeData?.polyline?.length && currentRouteDate === date))
    leafletMap.fitBounds(L.latLngBounds(pts), { padding:[40,40] });
}
export function invalideerKaartGrootte() { leafletMap?.invalidateSize(); }

// Kaartdeel van wisRouteWeergave(): laag leegmaken en de legende weghalen.
export function wisKaart() {
  if (leafletMap && routeLayer) {
    routeLayer.clearLayers();
    if (routeLegendeControl) { leafletMap.removeControl(routeLegendeControl); routeLegendeControl = null; }
  }
}

// Nieuwe routeberekening → de wegafsluiting-toast mag opnieuw één keer verschijnen.
export function herstelWegafsluitingToast() { wegafsluitingToastGetoond = false; }

// Vroeg inzoomen (kaart-snelheid-onderzoek, voorstellen): zoomt de kaart alvast in op de stops
// die al coördinaten hebben (uit de geocode-cache of een eerdere berekening deze sessie), vóór
// calculateRoute() zijn eigen netwerkaanroepen doet — de juiste tegels beginnen dan al te laden
// terwijl TomTom de effectieve route nog berekent. Geen effect als er nog niets gekend is (dan
// blijft de kaart gewoon op zijn huidige stand). Leaflet's fitBounds() hierna in updateKaart()
// blijft gewoon opnieuw gebeuren op de definitieve polylijn zodra de route binnen is; overlappen
// de bounds al (het normale geval bij een cache-hit), dan is er visueel geen tweede sprong.
// `routeActueel`: er staat al een berekende route voor deze dag (dan niet opnieuw inzoomen).
export function zoomOpGekendeStops(stops, localForDate, routeActueel) {
  if (!leafletMap || routeActueel) return;
  const pts = [
    ...stops.filter(p => p._lat).map(p => [p._lat, p._lon]),
    ...localForDate.filter(e => e._lat).map(e => [e._lat, e._lon]),
  ];
  if (!pts.length) return;
  try { leafletMap.fitBounds(L.latLngBounds(pts), { padding: [40, 40] }); } catch { /* kaart nog niet klaar — negeren */ }
}
