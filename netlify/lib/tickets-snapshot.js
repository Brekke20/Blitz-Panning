// Momentopname ("snapshot") van de Zoho-tickets in Netlify Blobs (store blitz-data), zodat /api/tickets niet bij elke
// aanvraag de ~27 Zoho-aanroepen (4 tot 6 s) hoeft te doen. Een geplande functie (tickets-vooraf.js) ververst de
// momentopname; /api/tickets serveert ze zolang ze vers is en haalt anders live op (en schrijft ze dan opnieuw weg).
//
// Drie sleutels in de store:
//   tickets-snapshot            { v:1, op, dekt, klaar, tickets, pendingTickets, plannedTickets }
//                               `op` = het STARTMOMENT van de lading (ms), enkel voor de leeftijd. `dekt` = het id van de
//                               stale-marker die de lading las VOOR ze Zoho aanriep (null = er was geen). "Onvers door een
//                               schrijfactie" is dan `marker.id !== dekt` (gelijkheid, geen volgorde): een wijziging die tijdens
//                               de lading gebeurt zet een ander id, dus nooit weggemaskeerd, ook niet door een marker die door
//                               een trage schrijfactie terugvalt; een lading die na de wijziging begon is meteen vers (geen
//                               klokvergelijking tussen instanties, dus ook geen marge die elke planning twee ladingen kost).
//                               De inhoud is het ONGEFILTERDE antwoord van /api/tickets: voor alle rollen en de
//                               service-sleutel hetzelfde (de toegang zelf regelt de wrapper, rechten.js: 'tickets').
//   tickets-snapshot-verouderd  { id, op }  gezet door elke functie die een ticket in Zoho wijzigt (metTicketsVerouderd); elke
//                               markering krijgt een nieuw `id` (randomUUID).
//                               Aparte blob in plaats van een vlag in de momentopname: Blobs 8.2 heeft geen voorwaardelijke
//                               schrijfacties, dus een vlag zou verloren gaan als de planner tegelijk de momentopname herschrijft.
//   tickets-snapshot-bezig      { id, op, dekt }  best-effort slot tegen dubbele volledige ladingen (geen atomaire operatie
//                               mogelijk: schrijven en terugleggen; wie het slot verliest laadt niet, tenzij de winnaar uitblijft).
//
// Alles is fail-open: elke Blobs-fout leidt tot "live ophalen", nooit tot een fout of een leeg scherm. Geen enkele
// functie hier logt ticket-, klant- of gebruikersgegevens: enkel aantallen en tijden.
import { randomUUID } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { isTestVerzoek } from './testmodus.js';
import { heeftNetlifyRuntime } from './lokale-dev.js';

export const SNAPSHOT_SLEUTEL = 'tickets-snapshot';
export const VEROUDERD_SLEUTEL = 'tickets-snapshot-verouderd';
export const BEZIG_SLEUTEL = 'tickets-snapshot-bezig';

export const VERS_MS = 5 * 60 * 1000;            // jonger dan dit = geserveerd zonder Zoho
export const BEZIG_TTL_MS = 30 * 1000;           // een slot ouder dan dit is verlopen (een lading duurt 4 tot 6 s; de planner heeft 26 s time-out)
export const MAX_TERUGVAL_MS = 60 * 60 * 1000;   // een oude momentopname wordt bij een Zoho-fout enkel geserveerd als ze jonger is dan dit
export const FORCEER_MIN_MS = 30 * 1000;         // "Vernieuwen" (?vers=1) forceert hoogstens één Zoho-lading per zoveel ms, voor alle gebruikers samen
export const LIVE_TIMEOUT_MS = 12 * 1000;        // een live lading in /api/tickets krijgt zoveel tijd voor de terugval (de functie heeft 20 s)
export const WACHT_MAX_MS = 6000;                // hoe lang een aanvraag op een lopende lading wacht
export const WACHT_STAP_MS = 400;
export const WERKUREN_MIN_MS = 90 * 1000;        // in werkuren verversen vanaf deze leeftijd (planner tikt elke 2 min)
export const BUITEN_WERKUREN_MIN_MS = 14 * 60 * 1000; // daarbuiten ongeveer elk kwartier

const beloof = ms => new Promise(r => setTimeout(r, ms));
const isGetal = x => typeof x === 'number' && Number.isFinite(x);
const kort = e => String(e?.message ?? e ?? 'fout').slice(0, 200);

// Maandag tot vrijdag, 07:00 tot 19:00 Brusselse tijd. Altijd via Intl (Netlify draait in UTC en de overgang naar
// zomer- en wintertijd volgt de tijdzone-database), nooit met een vast uurverschil.
const BRUSSEL = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', weekday: 'short', hour: '2-digit', hourCycle: 'h23' });
export function inWerkuren(nuMs) {
  if (!isGetal(nuMs)) return false;
  let dag; let uur;
  try {
    for (const d of BRUSSEL.formatToParts(new Date(nuMs))) {
      if (d.type === 'weekday') dag = d.value;
      if (d.type === 'hour') uur = Number(d.value);
    }
  } catch { return false; }
  if (!['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(dag)) return false;
  return Number.isInteger(uur) && uur >= 7 && uur < 19;
}

// Een momentopname is bruikbaar als ze de verwachte vorm heeft.
export function geldigeSnapshot(s) {
  return !!s && typeof s === 'object' && isGetal(s.op)
    && Array.isArray(s.tickets) && Array.isArray(s.pendingTickets) && Array.isArray(s.plannedTickets);
}

// De identiteit van een marker: elke markering krijgt een eigen id (randomUUID), dus ook een marker die door een trage schrijfactie
// terugvalt of in dezelfde ms valt, is een ANDERE marker. Een marker uit de eerste versie (enkel `op`) telt via zijn op.
function markerSleutel(marker) {
  if (typeof marker?.id === 'string' && marker.id) return marker.id;
  return isGetal(marker?.op) ? `op:${marker.op}` : null;
}

// true als een schrijfactie (marker) de momentopname heeft ingehaald: de marker is niet die welke de lading al las (`dekt`).
// Vergelijking op gelijkheid, nooit op volgorde: een teruggevallen marker maskeert zo geen schrijfactie.
function door(snapshot, marker) {
  const sleutel = markerSleutel(marker);
  return sleutel !== null && sleutel !== (snapshot.dekt ?? null);
}

// Zoho-authenticatiefouten (verlopen of ingetrokken koppeling) mogen nooit door een oude momentopname verborgen worden:
// de client heeft er een eigen melding voor ("Sessie met Zoho verlopen"). Zelfde herkenning als de client, enkel preciezer op 401/403.
export function isAuthFout(e) {
  const t = String(e?.message ?? e ?? '');
  return /token refresh mislukt|\((401|403)\)|invalid[ _.-]?token|invalid_code|unauthori[sz]ed|expired|org id niet gevonden/i.test(t);
}

export function isVers({ snapshot, marker, nu }) {
  if (!geldigeSnapshot(snapshot)) return false;
  const leeftijd = nu - snapshot.op;
  if (!(leeftijd < VERS_MS && leeftijd > -VERS_MS)) return false; // ook een momentopname "uit de toekomst" (klokverschil) telt maar beperkt
  return !door(snapshot, marker);
}

// De beslissing van de geplande functie: moet er nu een verse lading komen?
export function moetVoorladen({ nu, snapshot, marker }) {
  if (!geldigeSnapshot(snapshot)) return { ja: true, reden: 'geen' };
  if (door(snapshot, marker)) return { ja: true, reden: 'gewijzigd' };
  const leeftijd = nu - snapshot.op;
  if (leeftijd < 0) return { ja: false, reden: 'vers' };
  const grens = inWerkuren(nu) ? WERKUREN_MIN_MS : BUITEN_WERKUREN_MIN_MS;
  return leeftijd >= grens ? { ja: true, reden: 'oud' } : { ja: false, reden: 'vers' };
}

// ---------- opslag (alles ingeslikt: een Blobs-storing is nooit een fout voor de gebruiker) ----------
async function veiligLezen(store, sleutel) {
  if (!store) return null;
  try { return (await store.get(sleutel, { type: 'json' })) ?? null; } catch { return null; }
}

// Het slot wordt enkel gelezen als het nodig is (een verse momentopname serveren kost zo twee parallelle lezingen).
async function leesToestand(store, { metBezig = true } = {}) {
  const [snapshot, marker, bezig] = await Promise.all([
    veiligLezen(store, SNAPSHOT_SLEUTEL), veiligLezen(store, VEROUDERD_SLEUTEL),
    metBezig ? veiligLezen(store, BEZIG_SLEUTEL) : null,
  ]);
  return { snapshot: geldigeSnapshot(snapshot) ? snapshot : null, marker, bezig };
}

const bezigActief = (bezig, nu) => !!bezig && isGetal(bezig.op) && nu - bezig.op < BEZIG_TTL_MS && nu - bezig.op > -BEZIG_TTL_MS;

async function haalStoreVeilig(haalStore, log, wat) {
  try { return await haalStore(); } catch (e) { log(`[tickets-snapshot] ${wat}: opslag niet bereikbaar (${e?.name || 'Error'})`); return null; }
}

// Zet een nieuwe marker voor een schrijfactie: elke markering krijgt een eigen id (en een op die nooit terugvalt of gelijk blijft).
// Geeft true/false, gooit nooit.
export async function markeerVerouderd({ store, haalStore, nu = () => Date.now(), log = () => {} } = {}) {
  try {
    const s = store ?? await haalStore();
    const moment = nu();
    const huidig = await s.get(VEROUDERD_SLEUTEL, { type: 'json' }).catch(() => null);
    const op = isGetal(huidig?.op) ? Math.max(huidig.op + 1, moment) : moment;
    await s.setJSON(VEROUDERD_SLEUTEL, { id: randomUUID(), op });
    return true;
  } catch (e) {
    log(`[tickets-snapshot] markeren mislukt (${e?.name || 'Error'})`);
    return false;
  }
}

// Om een functie die een ticket in Zoho wijzigt: na afloop (ook bij een fout halverwege: er kan al iets geschreven zijn)
// wordt de momentopname als verouderd gemarkeerd, zodat de eerstvolgende /api/tickets live ophaalt.
// Enkel voor wijzigende methodes en nooit voor een testverzoek (dat schrijft nooit naar Zoho). Weigeringen van de
// wrapper bereiken de kern niet, dus een anonieme aanroeper kan dit nooit afdwingen.
export function metTicketsVerouderd(kern, { haalStore, nu } = {}) {
  return async (reqOfEvent, ...rest) => {
    try {
      return await kern(reqOfEvent, ...rest);
    } finally {
      const methode = String(reqOfEvent?.method ?? reqOfEvent?.httpMethod ?? '').toUpperCase();
      if (!['GET', 'HEAD', 'OPTIONS', ''].includes(methode) && !isTestVerzoek(reqOfEvent)) {
        await markeerVerouderd({ haalStore: haalStore ?? standaardStore, nu });
      }
    }
  };
}
// Altijd de ECHTE store, ook bij een testverzoek (de momentopname is Zoho-data, geen testdata).
// Testnaad: zetStoreVoorTests(store) laat de functies (plan, comment, ...) in tests naar een nep-store schrijven; nooit in een runtime.
let testStore = null;
export function zetStoreVoorTests(store) {
  if (heeftNetlifyRuntime(process.env)) throw new Error('zetStoreVoorTests is niet toegelaten in een Netlify-runtime');
  testStore = store ?? null;
}
export const standaardStore = async () => testStore ?? getStore({ name: 'blitz-data', consistency: 'strong' });

// Het slot: { id, op, dekt } (dekt = de marker die de lader las, voor "heeft het zin om op hem te wachten").
// 'ja' = het slot is van ons; 'ander' = een andere aanvraag schreef het na ons (wij verloren de race); 'fout' = geen opslag of
// een storing (dat telt niet als een verloren race: dan wordt gewoon geladen).
async function neemBezig(store, id, nu, dekt) {
  if (!store) return 'fout';
  try {
    await store.setJSON(BEZIG_SLEUTEL, { id, op: nu, dekt });
    const terug = await store.get(BEZIG_SLEUTEL, { type: 'json' });
    return terug?.id === id ? 'ja' : (terug?.id ? 'ander' : 'fout');
  } catch { return 'fout'; }
}

async function geefBezigVrij(store, id) {
  if (!store) return;
  try {
    const huidig = await store.get(BEZIG_SLEUTEL, { type: 'json' });
    if (huidig?.id === id) await store.delete(BEZIG_SLEUTEL);
  } catch { /* een achterblijvend slot verloopt vanzelf na BEZIG_TTL_MS */ }
}

// Schrijft de lading weg, tenzij er intussen een nieuwere momentopname staat.
async function bewaar(store, { op, dekt, klaar, lijsten }, log) {
  if (!store) return false;
  try {
    const bestaand = await veiligLezen(store, SNAPSHOT_SLEUTEL);
    if (geldigeSnapshot(bestaand) && bestaand.op > op) return false;
    await store.setJSON(SNAPSHOT_SLEUTEL, {
      v: 1, op, dekt, klaar,
      tickets: lijsten.tickets, pendingTickets: lijsten.pendingTickets, plannedTickets: lijsten.plannedTickets,
    });
    return true;
  } catch (e) {
    log(`[tickets-snapshot] bewaren mislukt (${e?.name || 'Error'})`);
    return false;
  }
}

// `verouderd` betekent enkel: Zoho faalde en dit is de laatste goede momentopname (de client toont dan een balk "Zoho even niet bereikbaar").
// Een momentopname die gewoon wat ouder is terwijl een andere aanvraag al laadt, is `verouderd: false` (de leeftijd staat in leeftijdMs).
const uitSnapshot = (s, nu, verouderd) => ({
  body: { tickets: s.tickets, pendingTickets: s.pendingTickets, plannedTickets: s.plannedTickets },
  bron: 'snapshot', leeftijdMs: Math.max(0, nu - s.op), verouderd,
});

// Laat een belofte maximaal `ms` duren (ms leeg of 0 = geen limiet). De timer wordt altijd opgeruimd.
function metTimeout(belofte, ms) {
  if (!ms) return belofte;
  let timer;
  const limiet = new Promise((_, weiger) => {
    timer = setTimeout(() => weiger(new Error(`Zoho reageert niet binnen ${Math.round(ms / 1000)} s`)), ms);
  });
  return Promise.race([belofte, limiet]).finally(() => clearTimeout(timer));
}

// Een gedeelde lading: slot nemen, live ophalen, bewaren, slot vrijgeven. Geeft { lijsten } of gooit de Zoho-fout.
// `marker` = de stale-marker zoals de aanroeper hem las vóór de lading (dekt); een andere marker maakt het resultaat onvers.
// `eisSlot`: verlies je de race om het slot (een andere aanvraag schreef het na jou), dan wordt er NIET geladen: { geenSlot: true }.
async function laadEnBewaar({ store, haalLive, nu, log, marker, eisSlot = false, liveTimeoutMs = 0 }) {
  const id = randomUUID();
  const op = nu();
  const dekt = markerSleutel(marker);
  const slot = await neemBezig(store, id, op, dekt);
  if (eisSlot && slot === 'ander') return { geenSlot: true };
  try {
    const lijsten = await metTimeout(haalLive(), liveTimeoutMs);
    await bewaar(store, { op, dekt, klaar: nu(), lijsten }, log);
    return { lijsten };
  } finally {
    if (slot === 'ja') await geefBezigVrij(store, id);
  }
}

// Het antwoord voor /api/tickets: { body, bron: 'snapshot'|'live', leeftijdMs, verouderd }.
// forceer (Vernieuwen, ?vers=1): ook een nog verse momentopname wordt vervangen door een Zoho-lading, met een rem van één per
// FORCEER_MIN_MS voor alle gebruikers samen (gemeten aan de leeftijd van de momentopname: wat net geschreven werd, wordt geserveerd).
// Gooit als Zoho faalt EN er geen bruikbare terugval is: geen momentopname, een te oude (MAX_TERUGVAL_MS) of een authenticatiefout.
// Dan gedraagt /api/tickets zich als voorheen: een 500 met de fouttekst, en de client toont zijn eigen foutmelding.
export async function leverTickets({
  haalStore, haalLive, nu = () => Date.now(), wacht = beloof, log = console.error,
  forceer = false, liveTimeoutMs = LIVE_TIMEOUT_MS,
} = {}) {
  const begin = nu();
  const store = await haalStoreVeilig(haalStore, log, 'lezen');
  let t = await leesToestand(store, { metBezig: false });

  if (isVers({ ...t, nu: begin }) && (!forceer || begin - t.snapshot.op < FORCEER_MIN_MS)) return uitSnapshot(t.snapshot, begin, false);
  t = { ...t, bezig: await veiligLezen(store, BEZIG_SLEUTEL) };

  const ingehaald = !!t.snapshot && door(t.snapshot, t.marker); // onvers door een schrijfactie, niet enkel door ouderdom

  // Wacht op een lopende lading die onze wijziging wel zal bevatten; geeft het antwoord, of null (dan zelf laden).
  const wachtOpAndere = async () => {
    const einde = nu() + WACHT_MAX_MS;
    while (nu() < einde) {
      await wacht(WACHT_STAP_MS);
      t = await leesToestand(store);
      if (isVers({ ...t, nu: nu() })) return uitSnapshot(t.snapshot, nu(), false);
      if (!bezigActief(t.bezig, nu())) break; // de andere lading is klaar of mislukt, maar bevat onze wijziging niet: zelf laden
    }
    return null;
  };

  if (bezigActief(t.bezig, nu())) {
    // Iemand (een gebruiker of de planner) is al aan het laden.
    if (t.snapshot && !ingehaald) return uitSnapshot(t.snapshot, nu(), false); // enkel te oud: de bestaande meteen
    // Een lading die begon vóór onze schrijfactie (ze dekt de huidige marker niet) bevat die niet: wachten heeft geen zin.
    if ((t.bezig.dekt ?? null) === markerSleutel(t.marker)) {
      const antwoord = await wachtOpAndere();
      if (antwoord) return antwoord;
    }
  }

  const laad = eisSlot => laadEnBewaar({ store, haalLive, nu, log, marker: t.marker, eisSlot, liveTimeoutMs });
  try {
    let res = await laad(true);
    if (res.geenSlot) {
      // Een andere aanvraag was ons net voor met het slot: niet dubbel laden.
      if (t.snapshot && !ingehaald) return uitSnapshot(t.snapshot, nu(), false);
      const antwoord = await wachtOpAndere();
      if (antwoord) return antwoord;
      res = await laad(false); // de winnaar komt niet (meer): nooit zonder tickets blijven
    }
    return { body: res.lijsten, bron: 'live', leeftijdMs: 0, verouderd: false };
  } catch (e) {
    // Zoho faalt: liever de laatste goede momentopname (gemarkeerd als oud) dan geen tickets, maar enkel als ze niet te oud is en
    // de fout geen authenticatiefout is (die moet zichtbaar blijven: de client meldt dan "Sessie met Zoho verlopen").
    const laatste = t.snapshot ?? await veiligLezenSnapshot(store);
    if (!laatste || isAuthFout(e) || nu() - laatste.op >= MAX_TERUGVAL_MS) throw e;
    log(`[tickets-snapshot] Zoho mislukt, oude momentopname geserveerd (${Math.round((nu() - laatste.op) / 1000)} s oud): ${kort(e)}`);
    return uitSnapshot(laatste, nu(), true);
  }
}

async function veiligLezenSnapshot(store) {
  const s = await veiligLezen(store, SNAPSHOT_SLEUTEL);
  return geldigeSnapshot(s) ? s : null;
}

// De geplande functie. Geeft nooit ticketgegevens terug, enkel aantallen.
export async function voorlaad({ haalStore, haalLive, nu = () => Date.now(), log = console.error } = {}) {
  const store = await haalStoreVeilig(haalStore, log, 'voorladen');
  if (!store) return { resultaat: 'mislukt' }; // zonder opslag heeft voorladen geen zin: geen Zoho-krediet verspillen
  const moment = nu();
  const t = await leesToestand(store);
  if (!moetVoorladen({ nu: moment, snapshot: t.snapshot, marker: t.marker }).ja) return { resultaat: 'overgeslagen', reden: 'vers' };
  if (bezigActief(t.bezig, moment)) return { resultaat: 'overgeslagen', reden: 'bezig' };
  try {
    // eisSlot: de planner laadt nooit dubbel; verliest hij de race om het slot, dan laadt de andere aanvraag al.
    const res = await laadEnBewaar({ store, haalLive, nu, log, marker: t.marker, eisSlot: true });
    if (res.geenSlot) return { resultaat: 'overgeslagen', reden: 'bezig' };
    const { lijsten } = res;
    return {
      resultaat: 'ververst',
      tickets: lijsten.tickets.length, wachtend: lijsten.pendingTickets.length, gepland: lijsten.plannedTickets.length,
    };
  } catch (e) {
    log(`[tickets-snapshot] voorladen mislukt: ${kort(e)}`);
    return { resultaat: 'mislukt' };
  }
}
