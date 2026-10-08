// Gedeelde testmodus-helper (buiten netlify/functions/, dus geen eigen functie).
// Een testverzoek (header X-Blitz-Test: 1) gebruikt de opslag 'blitz-data-test'
// (een kopie van 'blitz-data') en schrijft nooit naar Zoho.

const ECHTE_WINKEL = 'blitz-data';
const TEST_WINKEL  = 'blitz-data-test';
const MARKER_KEY   = '_testkopie';
// Sleutels die niet naar de testopslag gekopieerd worden.
// Authenticatiegegevens (gebruikers, pogingen, laatste logins, noodroute, activiteit) leven altijd
// enkel in de echte opslag, ook bij een testverzoek.
const NIET_KOPIEREN = [
  /^client-log/, /^foutenlog$/, /^rapport-verzend-status/, /^foto-/,
  /^gebruikers$/, /^login-pogingen$/, /^login-laatst$/, /^herstel-noodroute$/, /^activiteit\//,
];

let kopieKlaar = false;   // geheugenvlag per koude start
let kopieBezig = null;    // lopende kopie (voorkomt gelijktijdige kopieën)

export function isTestVerzoek(reqOfEvent) {
  const h = reqOfEvent?.headers;
  if (!h) return false;
  if (typeof h.get === 'function') return h.get('x-blitz-test') === '1';
  // v1-event: gewone objecten, sleutelnaam hoofdletterongevoelig zoeken
  const zoek = obj => {
    if (!obj || typeof obj !== 'object') return undefined;
    const k = Object.keys(obj).find(x => x.toLowerCase() === 'x-blitz-test');
    return k === undefined ? undefined : obj[k];
  };
  if (zoek(h) === '1') return true;
  const mv = zoek(reqOfEvent.multiValueHeaders);
  return Array.isArray(mv) ? mv.length === 1 && mv[0] === '1' : mv === '1';
}

export function winkelNaam(reqOfEvent) {
  return isTestVerzoek(reqOfEvent) ? TEST_WINKEL : ECHTE_WINKEL;
}

export function nepZohoAntwoord(extra = {}) {
  return { ok: true, test: true, ...extra };
}

async function alleSleutels(store) {
  const res = await store.list();
  return (res?.blobs || []).map(b => b.key);
}

async function kopieer(getStore) {
  const echt = getStore({ name: ECHTE_WINKEL, consistency: 'strong' });
  const test = getStore({ name: TEST_WINKEL, consistency: 'strong' });
  if (await test.get(MARKER_KEY, { type: 'text' }) != null) return 0;
  // Bestaande testsleutels nooit overschrijven (gelijktijdige instantie of testwrite tijdens het kopiëren)
  const bestaand = new Set(await alleSleutels(test));
  let n = 0;
  for (const key of await alleSleutels(echt)) {
    if (key === MARKER_KEY || bestaand.has(key) || NIET_KOPIEREN.some(re => re.test(key))) continue;
    const data = await echt.get(key, { type: 'arrayBuffer' });
    if (data == null) continue;
    await test.set(key, data);
    n++;
  }
  await test.set(MARKER_KEY, JSON.stringify({ gekopieerdOp: new Date().toISOString() }));
  return n;
}

// Idempotent; geeft het aantal gekopieerde sleutels terug (0 als er niets te doen was).
// Standaard: bij een fout loggen en het verzoek laten doorgaan. Met { gooiFout: true }
// (enkel /api/testdata) wordt de fout doorgegeven aan de aanroeper.
export async function zorgVoorTestkopie(getStore, { gooiFout = false } = {}) {
  if (kopieKlaar) return 0;
  if (!kopieBezig) {
    kopieBezig = kopieer(getStore)
      .then(n => { kopieKlaar = true; return { n }; })
      .catch(err => { console.error('[testmodus] kopiëren mislukt:', err?.message || err); return { fout: err }; })
      .finally(() => { kopieBezig = null; });
  }
  const res = await kopieBezig;
  if (res.fout) {
    if (gooiFout) throw res.fout;
    return 0;
  }
  return res.n;
}

// Wist de volledige testopslag en de geheugenvlag. De markering gaat eerst weg,
// zodat een crash halverwege bij het volgende verzoek een nieuwe kopie uitlokt.
export async function wisTestopslag(getStore) {
  if (kopieBezig) await kopieBezig;
  kopieKlaar = false;
  const test = getStore({ name: TEST_WINKEL, consistency: 'strong' });
  await test.delete(MARKER_KEY);
  for (const key of await alleSleutels(test)) await test.delete(key);
}
