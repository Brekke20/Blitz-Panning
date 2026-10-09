// Testhulp (geen *.test.mjs): zet tijdelijk een rol of een afwezige sessie voor de servertests.
//   await metRol('planner', () => handler(req))
//   await metRol('technieker', werk, { zohoNaam: 'Roel', magZelfPlannen: true })
//   await metRol('sales', werk, { magAlleSales: true })
//   await metGeenSessie(() => handler(req))      // echte cookiecontrole zonder cookie: 401 niet-ingelogd
// Na afloop (ook bij een fout) is de vorige instelling terug. zetStandaard(opties | null) bepaalt de
// basisinstelling (bv. de standaardbeheerder van nep-fetch.mjs); zonder is dat de echte controle.
import { zetAuthVoorTests } from '../netlify/lib/auth.js';
import { TESTGEBRUIKERS } from '../netlify/lib/lokale-dev.js';

let standaard = null; // opties voor zetAuthVoorTests, of null = echte controle
let actief = null;    // wat nu door deze hulp is gezet

function zet(opties) {
  actief = opties;
  zetAuthVoorTests(opties);
}

async function tijdelijk(opties, werk) {
  const vorige = actief;
  zet(opties);
  try {
    return await werk();
  } finally {
    zet(vorige);
  }
}

export function zetStandaard(opties) {
  standaard = opties ?? null;
  zet(standaard);
}

export async function metRol(rol, werk, { zohoNaam, magAlleSales, magZelfPlannen } = {}) {
  const basis = TESTGEBRUIKERS[`test-${rol}`];
  if (!basis) throw new Error(`metRol: onbekende rol "${rol}"`);
  const gebruiker = { ...basis };
  if (rol === 'technieker' && zohoNaam !== undefined) gebruiker.zohoNaam = zohoNaam;
  if (rol === 'technieker' && magZelfPlannen !== undefined) gebruiker.magZelfPlannen = magZelfPlannen;
  if (rol === 'sales' && magAlleSales !== undefined) gebruiker.magAlleSales = magAlleSales === true;
  return tijdelijk({ ...(standaard ?? {}), vasteGebruiker: gebruiker }, werk);
}

export async function metGeenSessie(werk) {
  return tijdelijk({ ...(standaard ?? {}), vasteGebruiker: null }, werk);
}
