// Netlify Blobs-context voor v1-functies (`export const handler = async (event) => ...`, Lambda-compat).
// Een v2-functie (`export default async (req) => ...`) krijgt de Blobs-omgeving automatisch; een v1-functie niet:
// daar moet `connectLambda(event)` éérst aangeroepen worden (het leest `event.blobs` en de x-nf-*-headers), anders
// gooit elke `getStore()` een MissingBlobsEnvironmentError. De login (auth.js) leest de gebruikers uit Blobs, dus
// zonder deze stap kreeg iedere ingelogde gebruiker op een v1-functie (tickets, plan, propose, ...) 503 opslag-storing.
// Lokaal en in tests ontbreekt `event.blobs`: dan gebeurt er niets.
export async function verbindBlobs(event, { connect } = {}) {
  if (typeof event?.blobs !== 'string' || event.blobs === '') return;
  try {
    const verbind = connect ?? (await import('@netlify/blobs')).connectLambda;
    verbind(event);
  } catch (e) {
    // Alleen het fouttype loggen; de eerstvolgende getStore() geeft dan zelf de storing (fail-closed).
    console.error('blobs: connectLambda mislukt (' + (e?.name || 'Error') + ')');
  }
}
