// kern/toestand.js — observable store met gebundelde verwittiging (puur: geen window, geen DOM).
// Toewijzing via set/patch verwittigt vanzelf; in-place mutatie van een array/object vraagt raak(sleutel).
// Zelfde array/object-referentie zetten verwittigt altijd; een identieke primitieve niet. Na een in-place mutatie
// (push, splice, eigenschap toewijzen) roep je raak(sleutel) aan.
// transactie(async fn) spoelt op de synchrone grens (zodra fn zijn promise teruggeeft), niet na het await.
// Verwittiging is gebundeld per microtask; transactie(fn) spoelt synchroon bij het einde van de buitenste transactie.
// Een abonnee die gooit wordt gelogd ('toestand: abonnee faalde') en bereikt de oproeper niet; de andere abonnees lopen door.
// Een abonnee die tijdens een flush wordt toegevoegd, mist de lopende ronde (hij hoort pas bij latere wijzigingen).
// `settings` is null tot DOMContentLoaded (index.html zaait het daar); lees het nooit op het hoogste niveau van een script.

export const SLEUTELS = ['allTickets', 'allPending', 'allGepland', 'planning', 'localEvents', 'avExceptions', 'klantBeschikbaarheid', 'voorstelStatus', 'settings', 'activeAssigneeFilter'];

const MAX_RONDES = 10;

function beginwaarden() {
  return {
    allTickets: [],
    allPending: [],
    allGepland: [],
    planning: {},
    localEvents: [],
    avExceptions: [],
    klantBeschikbaarheid: {},
    voorstelStatus: {},
    settings: null,
    activeAssigneeFilter: 'all',
  };
}

export function maakToestand(begin = {}) {
  const waarden = { ...beginwaarden(), ...begin };
  const abonnees = []; // { sleutels:Set, fn, actief }
  let wacht = new Set();  // openstaande gewijzigde sleutels
  let diepte = 0;         // nesting van transactie()
  let gepland = false;    // microtask-flush gepland
  let bezig = false;      // een flush loopt
  let omhulling = null;

  function controleer(k) {
    if (!SLEUTELS.includes(k)) throw new Error(`toestand: onbekende sleutel '${k}'`);
  }

  function noteer(k) {
    wacht.add(k);
    if (diepte === 0 && !gepland && !bezig) {
      gepland = true;
      queueMicrotask(() => { gepland = false; spoel(); });
    }
  }

  function echteFlush() {
    let ronde = 0;
    while (wacht.size) {
      if (ronde >= MAX_RONDES) {
        console.error('toestand: renderlus afgebroken', [...wacht]);
        wacht = new Set();
        return;
      }
      ronde++;
      const gewijzigd = wacht;
      wacht = new Set();
      for (const a of abonnees.slice()) {
        if (!a.actief) continue;
        let raakt = false;
        for (const k of gewijzigd) if (a.sleutels.has(k)) { raakt = true; break; }
        if (!raakt) continue;
        try { a.fn(gewijzigd); } catch (e) { console.error('toestand: abonnee faalde', e); }
      }
    }
  }

  function spoel() {
    if (bezig || !wacht.size) return; // een lopende flush verwerkt nieuwe wijzigingen zelf in een volgende ronde
    bezig = true;
    try {
      if (omhulling) {
        omhulling(() => echteFlush());
        if (wacht.size) { // omhulling riep de flush niet (volledig) aan: niet eeuwig blijven hangen
          console.error('toestand: omhulling voerde de flush niet uit', [...wacht]);
          wacht = new Set();
        }
      } else echteFlush();
    } catch (e) {
      console.error('toestand: flush faalde', e);
      wacht = new Set();
    } finally {
      bezig = false;
    }
  }

  function get(k) { controleer(k); return waarden[k]; }

  function set(k, v) {
    controleer(k);
    const oud = waarden[k];
    const primitief = v === null || (typeof v !== 'object' && typeof v !== 'function');
    if (primitief && Object.is(oud, v)) return;
    waarden[k] = v;
    noteer(k);
  }

  function patch(k, deel) { set(k, { ...get(k), ...deel }); }

  function raak(k) { controleer(k); noteer(k); }

  function abonneer(sleutels, fn) {
    if (typeof sleutels === 'string') sleutels = [sleutels];
    sleutels.forEach(controleer);
    const a = { sleutels: new Set(sleutels), fn, actief: true };
    abonnees.push(a);
    return () => {
      a.actief = false;
      const i = abonnees.indexOf(a);
      if (i >= 0) abonnees.splice(i, 1);
    };
  }

  function transactie(fn) {
    diepte++;
    try {
      return fn();
    } finally {
      diepte--;
      if (diepte === 0) spoel();
    }
  }

  function zetOmhulling(fn) { omhulling = fn; }

  return { get, set, patch, raak, abonneer, transactie, spoel, zetOmhulling };
}

export const toestand = maakToestand();
