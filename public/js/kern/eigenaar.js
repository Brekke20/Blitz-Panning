// kern/eigenaar.js — van wie is de lokale staat op dit toestel (logins T15, fix 1). Pure helpers (opslag wordt meegegeven, geen
// window): bij een andere gebruiker dan de vorige verdwijnen de persoonsgebonden gegevens (gekozen persoon, ticket-/planningcaches
// en de schermstaat), zodat een gedeeld toestel niets van de vorige gebruiker toont of herstelt.
// BEWUSTE UITZONDERINGEN (nooit gewist, anders gaat werk verloren): de rapportwachtrij (IndexedDB, onverstuurde rapporten), de
// verbruikswachtrij (blitz_verbruik_wachtrij: niet gelukte voorraadaftrekken), rapportconcepten, instellingen per persoon,
// de geocodecache en aankomsttijden. De instellingen per persoon hebben een eigen eigenaarsmarkering (kern/instellingen-sync.js,
// blitz_instellingen_eigenaar): bij een andere gebruiker worden ze daar gewist, bij uitloggen door de afmeldhaak van rol-schil.js.

export const EIGENAAR_SLEUTEL = 'blitz_eigenaar';
const PERSOON_SLEUTEL = 'blitz_active_person';
// localStorage: alles wat opstart/loadFromCache van de vorige gebruiker zou terugzetten.
export const PERSOONLIJKE_SLEUTELS = [
  PERSOON_SLEUTEL, 'blitz_tickets_cache', 'blitz_afspraken_cache', 'blitz_availability_cache', 'blitz_klantbeschikbaarheid_cache',
  'blitz_inventaris_cache', 'blitz_inventaris_cache_test',
  'blitz_sales_verkoper', // sales-planner: de gekozen verkoper van een beheerder/sales-verantwoordelijke (sales-verkoper.js)
];
// sessionStorage: de bewaarde tab en scrollpositie (zou een tab openen die deze rol niet heeft).
export const SESSIE_SLEUTELS = ['blitz_schermstaat'];

// Zonder of met een andere eigenaar: de lokale staat is niet van deze gebruiker.
export function isAndereEigenaar(opgeslagenId, gebruikerId) {
  return typeof gebruikerId === 'string' && gebruikerId !== '' && opgeslagenId !== gebruikerId;
}

function verwijder(opslag, sleutels) {
  for (const k of sleutels) { try { opslag?.removeItem(k); } catch { /* geen opslag */ } }
}

// Maakt het toestel van deze gebruiker. Geeft true als er gewist is (andere of onbekende eigenaar).
export function claimToestel(opslag, sessieOpslag, gebruikerId) {
  let huidig = null;
  try { huidig = opslag?.getItem(EIGENAAR_SLEUTEL) ?? null; } catch { /* geen opslag */ }
  const wissen = isAndereEigenaar(huidig, gebruikerId);
  if (wissen) {
    verwijder(opslag, PERSOONLIJKE_SLEUTELS);
    verwijder(sessieOpslag, SESSIE_SLEUTELS);
    try { opslag?.setItem(EIGENAAR_SLEUTEL, gebruikerId); } catch { /* geen opslag */ }
  }
  return wissen;
}

// Bij het uitloggen: de gekozen persoon, de schermstaat en de eigenaarsmarkering weg (de caches volgen bij de volgende login).
export function geefToestelVrij(opslag, sessieOpslag) {
  verwijder(opslag, [PERSOON_SLEUTEL, EIGENAAR_SLEUTEL]);
  verwijder(sessieOpslag, SESSIE_SLEUTELS);
}
