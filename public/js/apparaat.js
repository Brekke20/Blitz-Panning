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

  // Rol van de ingelogde gebruiker (zetLoginRol, logins T15): enkel 'technieker' en 'sales' beperken het toestel.
  var loginRol = null;
  // Een technieker met "Mag zelf plannen" (zetLoginRol, tweede argument): de ingeplande-functies voor zijn eigen tickets blijven zichtbaar
  // (CSS: .coord-only.plan-eigen); de server en de knoppen per ticket beperken hem tot zijn eigen tickets.
  var planEigen = false;

  function bepaal() {
    var grof = !!(grofMQ && grofMQ.matches);
    var b = window.innerWidth, h = window.innerHeight;
    // kortsteZijde komt van het SCHERM (screen.width/height), niet van het venster: een schermtoetsenbord
    // (Android, liggend) verkleint de viewporthoogte tot < 600 en zou een tablet anders 'gsm' maken.
    // Val terug op het venster als de schermmaten ontbreken/0 zijn. `staand` blijft van het venster.
    var sb = window.screen && window.screen.width, sh = window.screen && window.screen.height;
    var kortsteZijde = (sb > 0 && sh > 0) ? Math.min(sb, sh) : Math.min(b, h);
    var staand = h >= b;

    var auto = !grof ? 'computer' : (kortsteZijde < 600 ? 'gsm' : 'tablet');
    var w = lees('blitz_weergave');
    var soort = (w === 'gsm' || w === 'tablet' || w === 'computer') ? w : auto;

    var indeling = soort === 'gsm' ? 'smal'
      : soort === 'computer' ? 'breed'
      : (staand ? 'tablet-staand' : 'breed');

    var r = lees('blitz_rol');
    var rolGekozen = (r === 'coordinator' || r === 'technieker');
    var rol = rolGekozen ? r : (soort === 'computer' ? 'coordinator' : 'technieker');
    // Een ingelogde technieker (of sales) is altijd de beperkte rol, op elk toestel, en krijgt geen tablet-rolvraag.
    // Sales houdt zijn eigen waarde 'sales' (CSS behandelt hem als technieker voor .coord-only; sales-schermen gebruiken eigen klassen).
    if (loginRol) { rol = loginRol === 'sales' ? 'sales' : 'technieker'; rolGekozen = true; }

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
    loginRol = (r === 'technieker' || r === 'sales') ? r : null;
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
  if (grofMQ) {
    if (grofMQ.addEventListener) grofMQ.addEventListener('change', evalueer);
    else if (grofMQ.addListener) grofMQ.addListener(evalueer);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') evalueer();
  });

  evalueer();
})();
