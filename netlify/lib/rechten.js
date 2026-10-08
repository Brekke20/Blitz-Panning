// Rechtentabel: welke rol welke methode van welke functie mag aanroepen (beslissing per functie uit het
// logins-plan). De wrapper (beveiligd.js) leest deze tabel; elke functie onder netlify/functions/ MOET een rij
// hebben (tests/rechten.test.mjs). Een nieuwe functie voegt zijn eigen rij toe.
//
// Rij-schema: { [methode | '*']: string[] | 'open', service?: true, ookBijWijzigen?: true }
//   - een methode-sleutel (hoofdletters) wint van '*'; '*' geldt voor elke andere methode.
//   - 'open': geen login nodig (de functie heeft eigen controles); OPTIONS is altijd open.
//   - een methode zonder regel (en zonder '*') krijgt van de wrapper 405, de functie wordt niet aangeroepen.
//   - OPTIONS: bij een rij met '*' (niet 'open') antwoordt de wrapper zelf 204; anders gaat OPTIONS naar de functie.
//     Functies die zelf NIET op methode controleren hebben een '*'-regel.
//   - service: true  = de service-sleutel van planning-export is geldig (enkel GET, zie auth.js).
//   - ookBijWijzigen: true = ook toegelaten als de gebruiker nog een wachtwoord moet wijzigen.
// "T eigen" (technieker enkel eigen data) wordt in de functie zelf afgedwongen; hier staat enkel de rol.

const vries = lijst => Object.freeze([...lijst]);

const BEHEER = vries(['beheerder']);
const COORD = vries(['beheerder', 'planner']);
const INTERN = vries(['beheerder', 'planner', 'technieker']);
const ALLE = vries(['beheerder', 'planner', 'technieker', 'sales']);

export const RECHTEN = {
  // tickets en setup controleren zelf geen methode: '*' houdt elke methode achter de login.
  'tickets':              { '*': INTERN, service: true },
  'planning-sinds':       { POST: INTERN },
  'plan':                 { POST: COORD },
  'plan-datum':           { POST: COORD },
  'propose':              { POST: COORD },
  'annuleer':             { GET: COORD, POST: COORD },
  'optimize':             { '*': ALLE },
  'matrix':               { POST: ALLE },
  'route':                { '*': ALLE },
  'drukte':               { '*': ALLE },
  'afspraken':            { GET: INTERN, PUT: INTERN },
  'availability':         { GET: INTERN, PUT: INTERN },
  'klantbeschikbaarheid': { GET: INTERN, PUT: COORD },
  'voorstel-status':      { GET: INTERN, POST: COORD, DELETE: COORD },
  'prijzen':              { GET: INTERN, PUT: COORD },
  'inventaris':           { GET: INTERN, POST: INTERN, PATCH: COORD },
  'rapport-archief':      { GET: INTERN, POST: INTERN, DELETE: INTERN },
  'rapport-verzonden':    { POST: INTERN },
  'rapport':              { POST: INTERN },
  'send-rapport':         { POST: INTERN },
  'comment':              { POST: INTERN },
  'fotos':                { GET: INTERN, PUT: INTERN },
  'mail-check':           { GET: INTERN },
  'client-log':           { GET: BEHEER, POST: ALLE },
  'testdata':             { POST: BEHEER },
  'setup':                { '*': BEHEER },
  // Sessiefuncties: login/uitloggen zijn open (nog geen sessie); auth-ik en auth-wachtwoord werken ook
  // terwijl een wachtwoordwijziging nog openstaat.
  'auth-login':           { '*': 'open' },
  'auth-uitloggen':       { '*': 'open' },
  'auth-setup':           { '*': 'open' }, // eerste beheerder: eigen controle (BEHEER_SETUP_CODE, enkel bij 0 gebruikers)
  'auth-herstel':         { '*': 'open' }, // herstelcode of noodsleutel + e-mail van een actieve beheerder
  'auth-ik':              { GET: ALLE, ookBijWijzigen: true },
  'auth-wachtwoord':      { POST: ALLE, ookBijWijzigen: true },
  // Klantlink (ondertekend) en machine-sleutel (PLANNING_EXPORT_API_KEY): eigen controles in de functie.
  'confirm-afspraak':     { '*': 'open' },
  'planning-export':      { '*': 'open' },
};

// Gedeeld met de wrapper: de regel voor naam + methode (undefined = geen regel).
export function regelVoor(naam, methode) {
  if (typeof naam !== 'string' || !Object.hasOwn(RECHTEN, naam)) return undefined;
  const rij = RECHTEN[naam];
  const m = String(methode ?? '').toUpperCase();
  if (Object.hasOwn(rij, m)) return rij[m]; // methodesleutels zijn hoofdletters, de rij-velden niet
  return Object.hasOwn(rij, '*') ? rij['*'] : undefined;
}

// true | 'open' | false. Onbekende functie, methode zonder regel of onbekende rol = false (fail-closed).
export function rolIsToegelaten(naam, methode, rol) {
  const regel = regelVoor(naam, methode);
  if (regel === 'open') return 'open';
  return Array.isArray(regel) && typeof rol === 'string' && regel.includes(rol);
}

export function rechtenVoor(gebruiker) {
  const rol = gebruiker?.rol;
  const beheer = rol === 'beheerder';
  return {
    beheer,
    plannen: beheer || rol === 'planner',
    alleSales: beheer || gebruiker?.magAlleSales === true,
  };
}
