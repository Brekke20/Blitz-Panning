// public/js/vrije-dag.js
// Klassiek script (geen import/export, geen DOM): beslist of VANDAAG nog bruikbaar is voor
// "Inplannen op eerstvolgende vrije dag" (de +-knop in de wachtrij). Zonder deze check werd een
// ticket 's avonds laat nog op vandaag gezet, ook al was de werkdag al voorbij (v1.10.3).
// In de pagina: window.vrijeDag; in Node (tests): module.exports.
(function (root) {
  'use strict';

  // Alle waarden in minuten sinds middernacht (duurMin/reisMin: minuten).
  // Vandaag is bruikbaar als een ticket dat nu start (of bij het begin van de werkdag, als die nog
  // moet komen) inclusief reistijd vóór het einde van de werkdag klaar is -- dezelfde slotlengte
  // (duur + reistijd) als capacityForDay(). Ontbrekende/ongeldige waarden: oud gedrag (toegelaten).
  function vandaagNogBruikbaar(o) {
    o = o || {};
    var waarden = [o.nuMin, o.totMin, o.duurMin];
    for (var i = 0; i < waarden.length; i++) {
      if (typeof waarden[i] !== 'number' || !isFinite(waarden[i])) return true;
    }
    var van = (typeof o.vanMin === 'number' && isFinite(o.vanMin)) ? o.vanMin : 0;
    var reis = (typeof o.reisMin === 'number' && isFinite(o.reisMin)) ? o.reisMin : 0;
    var start = Math.max(o.nuMin, van);
    return start + reis + o.duurMin <= o.totMin;
  }

  function naarMin(hhmm, standaard) {
    var m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ''));
    return m ? Number(m[1]) * 60 + Number(m[2]) : standaard;
  }

  // Voor de pagina: instellingen (vanTijd/totTijd "HH:MM", duurMinuten) + het huidige moment (Date).
  function vandaagBruikbaarNu(settings, nu, reisMin) {
    settings = settings || {};
    return vandaagNogBruikbaar({
      nuMin: nu.getHours() * 60 + nu.getMinutes(),
      vanMin: naarMin(settings.vanTijd, 8 * 60),
      totMin: naarMin(settings.totTijd, 17 * 60),
      duurMin: settings.duurMinuten || 120,
      reisMin: reisMin === undefined ? 30 : reisMin,
    });
  }

  var api = { vandaagNogBruikbaar: vandaagNogBruikbaar, vandaagBruikbaarNu: vandaagBruikbaarNu };
  root.vrijeDag = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
