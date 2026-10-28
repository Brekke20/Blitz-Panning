// Apparaatherkenning: soort toestel, indeling, aanraak en rol -- één centrale plek.
// Klassiek script (geen module) in <head>: de attributen staan op <html> vóór de eerste render.
// De rol verbergt enkel knoppen en is GEEN beveiliging.
(function () {
  'use strict';
  var root = document.documentElement;
  var grofMQ = null;
  try { grofMQ = window.matchMedia('(pointer: coarse)'); } catch (e) {}

  function lees(sleutel) {
    try { return localStorage.getItem(sleutel); } catch (e) { return null; }
  }
  function bewaar(sleutel, waarde) {
    try { localStorage.setItem(sleutel, waarde); } catch (e) {}
  }

  // Rol van de ingelogde gebruiker (zetLoginRol, logins T15). De ACCOUNT bepaalt de weergave op elk toestel: technieker en sales zijn
  // beperkt, beheerder en planner krijgen de volledige coördinatorweergave (UI/UX-review P1-5; de oude keuze "Rol op dit toestel" is weg).
  var loginRol = null;
  // Een technieker met "Mag zelf plannen" (zetLoginRol, tweede argument): de ingeplande-functies voor zijn eigen tickets blijven zichtbaar
  // (CSS: .coord-only.plan-eigen); de server en de knoppen per ticket beperken hem tot zijn eigen tickets.
  var planEigen = false;

  // Rechtop of liggend voor de gsm-regel: screen.orientation.type ('portrait-*' / 'landscape-*') als het toestel die geeft. NIET screen.width/height (WebKit
  // op iOS/iPadOS wisselt die bij het draaien niet om) en NIET het venster alleen: Android-splitscreen op een liggende tablet geeft een smal, hoog venster en
  // blijft dus een tablet (de oriëntatie van het scherm is liggend). Zonder screen.orientation geldt het venster (innerHeight >= innerWidth), met een
  // toetsenbordslot: een schermtoetsenbord verkleint enkel de hoogte, dus bij een ongewijzigde breedte blijft het vorige oordeel staan en schakelt de app nooit
  // midden in het typen om (een draai verandert de breedte altijd).
  var laatsteBreedte = null, laatsteVensterStaand = null;
  function staandVoorGsm(b, vensterStaand) {
    var o = window.screen && window.screen.orientation && window.screen.orientation.type;
    if (typeof o === 'string') {
      if (o.indexOf('portrait') === 0) return true;
      if (o.indexOf('landscape') === 0) return false;
    }
    if (laatsteVensterStaand !== null && laatsteBreedte === b) return laatsteVensterStaand;
    laatsteBreedte = b; laatsteVensterStaand = vensterStaand;
    return vensterStaand;
  }

  function bepaal() {
    var grof = !!(grofMQ && grofMQ.matches);
    var b = window.innerWidth, h = window.innerHeight;
    // kortsteZijde komt van het SCHERM (screen.width/height), niet van het venster: een schermtoetsenbord
    // (Android, liggend) verkleint de viewporthoogte tot < 600 en zou een tablet anders 'gsm' maken.
    // Val terug op het venster als de schermmaten ontbreken/0 zijn. `staand` blijft van het venster.
    var sb = window.screen && window.screen.width, sh = window.screen && window.screen.height;
    var kortsteZijde = (sb > 0 && sh > 0) ? Math.min(sb, sh) : Math.min(b, h);
    var staand = h >= b;
    // Een tablet RECHTOP is een gsm in de hele app (Brent, 2026-10-28: het verschil was vooral de voorraadbel; dok, gsm-kalender en gsm-glas horen erbij);
    // liggend blijft hij een tablet (indeling 'breed', zoals de computer). Een handmatige keuze (blitz_weergave, Instellingen) gaat voor en laat dit onaangeroerd.
    var auto = !grof ? 'computer' : (kortsteZijde < 600 || staandVoorGsm(b, staand) ? 'gsm' : 'tablet');
    var w = lees('blitz_weergave');
    var soort = (w === 'gsm' || w === 'tablet' || w === 'computer') ? w : auto;

    var indeling = soort === 'gsm' ? 'smal'
      : soort === 'computer' ? 'breed'
      : (staand ? 'tablet-staand' : 'breed');

    var r = lees('blitz_rol');
    var rolGekozen = (r === 'coordinator' || r === 'technieker');
    var rol = rolGekozen ? r : (soort === 'computer' ? 'coordinator' : 'technieker');
    // Een ingelogde technieker (of sales) is altijd de beperkte rol, een beheerder of planner altijd coördinator, op elk toestel
    // (ook een gsm of tablet: het compacte gedrag komt van `indeling`, niet van de rol). Geen rolvraag meer.
    // Sales houdt zijn eigen waarde 'sales' (CSS behandelt hem als technieker voor .coord-only; sales-schermen gebruiken eigen klassen).
    if (loginRol) { rol = loginRol === 'sales' ? 'sales' : loginRol === 'technieker' ? 'technieker' : 'coordinator'; rolGekozen = true; }

    return { soort: soort, automatischeSoort: auto, indeling: indeling, staand: staand,
             aanraak: grof, rol: rol, rolGekozen: rolGekozen, kortsteZijde: kortsteZijde,
             planEigen: planEigen && rol === 'technieker' };
  }

  function zetAttributen(a) {
    root.setAttribute('data-apparaat', a.soort);
    root.setAttribute('data-indeling', a.indeling);
    root.setAttribute('data-orientatie', a.staand ? 'staand' : 'liggend');
    root.setAttribute('data-aanraak', a.aanraak ? 'ja' : 'nee');
    root.setAttribute('data-rol', a.rol);
    root.setAttribute('data-plan-eigen', a.planEigen ? 'ja' : 'nee');
    // data-nav (zijkolom of dok, Open dag): enkel de EERSTE keer hier gezet, zodat het attribuut er al is bij de eerste verf (de CSS hangt
    // eraan). Daarna is kern/navigatievorm.js de enige bron. Dezelfde regel (NAV_MIN_BREEDTE = 768): tests/navigatievorm.test.mjs
    // laat dit bestand draaien en pint de twee aan elkaar.
    if (!root.hasAttribute('data-nav')) root.setAttribute('data-nav', (a.indeling !== 'breed' || window.innerWidth < 768) ? 'dok' : 'kolom');
  }

  function evalueer() {
    var vorig = window.apparaat;
    var nu = bepaal();
    window.apparaat = nu;
    zetAttributen(nu);
    if (vorig && (vorig.soort !== nu.soort || vorig.staand !== nu.staand || vorig.indeling !== nu.indeling ||
                  vorig.rol !== nu.rol || vorig.aanraak !== nu.aanraak || vorig.planEigen !== nu.planEigen)) {
      window.dispatchEvent(new CustomEvent('apparaatwijziging', { detail: nu }));
    }
  }

  window.zetWeergave = function (w) {
    // Nog nooit een rol gekozen? Leg eerst de HUIDIGE rol vast: de standaardrol volgt de effectieve
    // soort en zou anders meeflippen bij het wisselen van weergave.
    var huidig = window.apparaat;
    if (huidig && !huidig.rolGekozen) bewaar('blitz_rol', huidig.rol);
    bewaar('blitz_weergave', (w === 'gsm' || w === 'tablet' || w === 'computer') ? w : 'auto');
    evalueer();
  };
  window.zetRol = function (r) {
    if (r !== 'coordinator' && r !== 'technieker') return;
    bewaar('blitz_rol', r);
    evalueer();
  };

  window.zetLoginRol = function (r, opties) {
    loginRol = (r === 'technieker' || r === 'sales' || r === 'beheerder' || r === 'planner') ? r : null;
    planEigen = !!(opties && opties.planEigen === true);
    evalueer();
  };

  var wacht = false;
  function gedebounced() {
    if (wacht) return;
    wacht = true;
    requestAnimationFrame(function () { wacht = false; evalueer(); });
  }
  window.addEventListener('resize', gedebounced);
  window.addEventListener('orientationchange', gedebounced);
  try { if (window.screen && window.screen.orientation && window.screen.orientation.addEventListener) window.screen.orientation.addEventListener('change', gedebounced); } catch (e) {}
  if (grofMQ) {
    if (grofMQ.addEventListener) grofMQ.addEventListener('change', evalueer);
    else if (grofMQ.addListener) grofMQ.addListener(evalueer);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') evalueer();
  });

  evalueer();
})();
