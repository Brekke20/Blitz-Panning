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
//   - planEigen: true = een technieker met het vinkje "Mag zelf plannen" (gebruiker.magZelfPlannen === true) mag deze methoden ook
//     (voor de methoden waar technieker nog niet in de lijst staat). De wrapper laat hem enkel door; de FUNCTIE moet nog toetsen dat
//     het ticket van hem is (netlify/lib/eigen-ticket.js: eisEigenTicket). Een nieuwe functie met dit vlag zonder die toets is een fout.
// "T eigen" (technieker enkel eigen data) wordt in de functie zelf afgedwongen; hier staat enkel de rol.

const vries = lijst => Object.freeze([...lijst]);

const BEHEER = vries(['beheerder']);
const COORD = vries(['beheerder', 'planner']);
const INTERN = vries(['beheerder', 'planner', 'technieker']);
const ALLE = vries(['beheerder', 'planner', 'technieker', 'sales']);
const BEHEER_SALES = vries(['beheerder', 'sales']);

export const RECHTEN = {
  // tickets en setup controleren zelf geen methode: '*' houdt elke methode achter de login.
  'tickets':              { '*': INTERN, service: true },
  'planning-sinds':       { POST: INTERN },
  // Plannen: coördinator, en een technieker met "Mag zelf plannen" enkel voor zijn eigen tickets (planEigen).
  'plan':                 { POST: COORD, planEigen: true },
  'plan-datum':           { POST: COORD, planEigen: true },
  'propose':              { POST: COORD, planEigen: true },
  'annuleer':             { GET: COORD, POST: COORD, planEigen: true },
  'optimize':             { '*': ALLE },
  'matrix':               { POST: ALLE },
  'route':                { '*': ALLE },
  'drukte':               { '*': ALLE },
  'afspraken':            { GET: INTERN, PUT: INTERN, service: true },
  'availability':         { GET: INTERN, PUT: INTERN },
  'klantbeschikbaarheid': { GET: INTERN, PUT: COORD, service: true, planEigen: true },
  'voorstel-status':      { GET: INTERN, POST: COORD, DELETE: COORD, planEigen: true },
  'prijzen':              { GET: INTERN, PUT: COORD },
  'inventaris':           { GET: INTERN, POST: INTERN, PATCH: COORD },
  'rapport-archief':      { GET: INTERN, POST: INTERN, DELETE: INTERN },
  'rapport-verzonden':    { POST: INTERN },
  // Upload-functies (v1.10.2). rapport-ontvangen: technieker enkel eigen rapporten (afgedwongen in de functie).
  // rapport-verwerk-background wordt server-naar-server aangeroepen en is via /.netlify/functions/ publiek bereikbaar:
  // 'open' (geen sessie), met een EIGEN controle in de functie (interne sleutel, netlify/lib/intern-token.js).
  // rapport-vangnet is een geplande functie (schema in netlify.toml, geen config.path: Netlify weigert een aanroep via
  // de URL); de scheduler draagt geen sessie, dus 'open' en bewust niet in de wrapper.
  'rapport-ontvangen':    { POST: INTERN },
  'rapport-verwerk-background': { '*': 'open' },
  'rapport-vangnet':      { '*': 'open' },
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
  // Gebruikersbeheer: lezen/schrijven enkel beheerder; sales mag enkel GET ?rol=sales (en enkel met magAlleSales,
  // afgedwongen in de functie zelf: hier staat enkel de rol).
  'gebruikers':           { GET: BEHEER_SALES, POST: BEHEER, PATCH: BEHEER },
  // Instellingen per gebruiker: elke rol leest/schrijft de eigen; wie voor wie mag, wordt in de functie afgedwongen.
  'instellingen':         { GET: ALLE, PUT: ALLE },
  // Sales-planner: beheerder en sales. Wie welk verkoperblob mag lezen/schrijven staat in netlify/lib/sales-toegang.js.
  'sales':                { GET: BEHEER_SALES, PATCH: BEHEER_SALES, DELETE: BEHEER_SALES },
  'postcode':             { GET: BEHEER_SALES },
  // Importeren door de verkoper zelf, in het eigen blob; de beheerder mag enkel een manuele lead toevoegen voor een verkoper (afgedwongen
  // in de functie zelf). De dagelijkse opruiming is open (geplande functie,
  // idempotent: wist enkel wat al ouder dan 12 maanden is), net als activiteit-opruimen.
  'sales-import':         { POST: BEHEER_SALES },
  'sales-opruimen':       { '*': 'open' },
  // Klantlink (ondertekend) en machine-sleutel (PLANNING_EXPORT_API_KEY): eigen controles in de functie.
  'confirm-afspraak':     { '*': 'open' },
  'planning-export':      { '*': 'open' },
  // Beheerpagina: activiteitenlog en systeemstatus enkel lezen door de beheerder. De dagelijkse opruiming is open
  // (geplande functie, idempotent: een aanroep van buitenaf wist enkel wat al ouder dan 12 maanden is).
  'activiteit':           { GET: BEHEER },
  'activiteit-opruimen':  { '*': 'open' },
  'systeemstatus':        { GET: BEHEER },
  // Performance-dashboard: cijfers en ringgrenzen enkel voor de beheerder.
  'dashboard':            { GET: BEHEER },
  'dashboard-instellingen': { GET: BEHEER, PUT: BEHEER },
  // Beheer, Gebruikers: de actieve Zoho-agenten (enkel namen) voor de keuzelijst "Zoho-naam"; enkel lezen.
  'zoho-agenten':         { GET: BEHEER },
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
    // Een technieker met "Mag zelf plannen": plannen mag, maar enkel voor zijn eigen tickets. Beheerder en planner hebben dit niet nodig.
    planEigen: rol === 'technieker' && gebruiker?.magZelfPlannen === true,
  };
}
