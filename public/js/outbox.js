// public/js/outbox.js
// Lokale IndexedDB-wachtrij voor rapport-verzending (één stap: POST /api/rapport-ontvangen; de
// server archiveert en stuurt daarna zelf op de achtergrond naar Zoho), met retry-logica
// bij offline/mislukte pogingen. Zie docs/superpowers/specs/2026-08-11-rapport-verzend-betrouwbaarheid-design.md
// voor de achtergrond van dit ontwerp.

import { TEST_UPLOAD } from './test-upload.js';

// Opslag en verzending zitten in het gedeelde klassieke script public/js/outbox-verzend.js
// (ook gebruikt door de service worker). Het wordt in index.html vóór de module-scripts geladen.
const V = globalThis.outboxVerzend;

export const OUTBOX_DB_NAME    = V.OUTBOX_DB_NAME;
export const OUTBOX_DB_VERSION = V.OUTBOX_DB_VERSION;
export const OUTBOX_STORE      = V.OUTBOX_STORE;
export let _outboxItems = [];

// Permanente window-bridge: rapport-archief.js's renderRapportArchief() leest dit array
// rechtstreeks (module-scope kan er anders niet bij zonder import/export tussen deze bestanden).
// refreshOutboxCache() hieronder vervangt _outboxItems telkens door een NIEUW array (geen
// in-place mutatie), dus een statische `window._outboxItems = _outboxItems`-toewijzing zou na de
// eerste refresh alweer verouderd zijn — vandaar een live getter in plaats van een eenmalige kopie.
Object.defineProperty(window, '_outboxItems', {
  get: () => _outboxItems,
  configurable: true,
});

export const outboxOpenDb = () => V.openDb();
export const outboxAdd    = (item) => V.put(item);
export const outboxPut    = outboxAdd; // put() op een keyPath-store is ook een upsert
export const outboxGetAll = () => V.getAll();
export const outboxRemove = (id) => V.remove(id);

// Pure functie — geen I/O — bepaalt of een wachtrij-item nog naar de server moet ('ontvangen')
// of al ontvangen is ('done').
export const nextOutboxAction = V.nextAction;

// Registreert de AbortController van de op dit moment lopende verzending per wachtrij-item, zodat
// outboxCancelItem() die meteen kan aborten i.p.v. de volledige time-out af te wachten.
const _outboxAbortControllers = new Map(); // id -> AbortController van de lopende verzending

// (T20) Exponentiële backoff tussen AUTOMATISCHE pogingen binnen één sessie. In-memory (geen
// IndexedDB), dus reset bij een paginaherlaad -- dat is bewust: een verse pagina-load mag altijd
// meteen proberen. "Opnieuw proberen" (zie renderOutboxBanner) reset dit expliciet per item.
const OUTBOX_BACKOFF_MS = [10000, 30000, 90000];
const _outboxNextAttempt = new Map(); // id -> timestamp vanaf wanneer een automatische poging weer mag

export async function refreshOutboxCache() {
  _outboxItems = await outboxGetAll();
  renderOutboxBanner();
}

// Eén stap: het rapport naar de server sturen. Alles daarna (archief, Zoho) doet de server zelf.
export function outboxStepLabel(item) {
  return 'Wordt verstuurd…';
}

// Samenvatting voor schermlezers (#outbox-live): alleen bij een wijziging van de samenvatting
// wordt de tekst gezet, zodat herrenders (stap-/pogingteller) niet opnieuw worden voorgelezen.
let _outboxLiveVorige = '';
function outboxSamenvatting() {
  const fout = _outboxItems.filter(i => i.lastError).length;
  const wacht = _outboxItems.length - fout;
  if (fout) return fout === 1 ? '1 rapport kon niet worden verzonden' : `${meervoud(fout, 'rapport', 'rapporten')} konden niet worden verzonden`;
  if (wacht) return wacht === 1 ? '1 rapport wacht op verzending' : `${meervoud(wacht, 'rapport', 'rapporten')} wachten op verzending`;
  return '';
}
function werkOutboxLiveBij() {
  const live = document.getElementById('outbox-live');
  if (!live) return;
  const nu = outboxSamenvatting();
  if (nu === _outboxLiveVorige) return;
  live.textContent = nu || 'Alle rapporten verstuurd';
  _outboxLiveVorige = nu;
}

export function renderOutboxBanner() {
  const banner = document.getElementById('outbox-banner');
  werkOutboxLiveBij();
  if (!_outboxItems.length) { banner.style.display = 'none'; banner.innerHTML = ''; return; }
  const offlineBanner  = document.getElementById('offline-banner');
  const offlineVisible = offlineBanner && getComputedStyle(offlineBanner).display !== 'none';
  banner.style.top = offlineVisible ? `${92 + offlineBanner.offsetHeight}px` : '92px';
  // escHtml op alle vrije tekst (ticketnummer, foutmelding) -- die komen respectievelijk uit
  // Zoho-ticketdata en uit fetch-foutmeldingen, geen van beide vertrouwd/gegarandeerd veilig.
  // (M6) data-id-attributen + addEventListener na render, i.p.v. een in de HTML-string
  // geïnjecteerde onclick="...('${id}')"-string -- geen vrije/afgeleide tekst komt zo nog in
  // uitvoerbare JS terecht (defense in depth, ook al is item.id in de praktijk altijd een
  // crypto.randomUUID()).
  banner.innerHTML = _outboxItems.map(item => `
    <div class="outbox-item">
      <span class="outbox-item-tnum">${item.ticket?.number ? '#' + escHtml(item.ticket.number) : (item.isLocal ? 'Lokale afspraak' : '—')}</span>
      <span class="outbox-item-step">⏳ ${escHtml(outboxStepLabel(item))}</span>
      ${item.attempts ? `<span class="outbox-item-attempts">poging ${escHtml(String(item.attempts))}</span>` : ''}
      ${item.lastError ? `<span class="outbox-item-error">${escHtml(menselijkeOutboxFout(item.lastError))}</span>` : ''}
      <button type="button" class="outbox-item-btn" data-action="retry" data-id="${escHtml(item.id)}">Opnieuw proberen</button>
      <button type="button" class="outbox-item-btn outbox-item-btn-cancel" data-action="cancel" data-id="${escHtml(item.id)}">Annuleren</button>
    </div>
  `).join('');
  banner.style.display = 'flex';
  banner.querySelectorAll('[data-action="retry"]').forEach(btn => btn.addEventListener('click', (e) => {
    e.stopPropagation();
    outboxRetryNow(btn.dataset.id);
  }));
  banner.querySelectorAll('[data-action="cancel"]').forEach(btn => btn.addEventListener('click', (e) => {
    e.stopPropagation();
    outboxCancelItem(btn.dataset.id);
  }));
}

// (T20) "Annuleren" -- een item in de wachtrij is nog nergens op de server bewaard, dus het
// rapport gaat volledig verloren (er is geen archief-kopie meer om te bewaren).
export async function outboxCancelItem(id) {
  const item = _outboxItems.find(i => i.id === id);
  if (!item) return;
  if (!confirm('Dit rapport gaat volledig verloren — het is nog niet naar de server verstuurd. Doorgaan?')) return;

  // Breek een eventueel op dit moment lopende poging voor dit item af en wacht die af vóórdat
  // we zelf iets verwijderen. Een fetch-abort garandeert niet dat de SERVER stopt met verwerken
  // (die kan het rapport al ontvangen hebben) -- de server is idempotent op het item-id, dus een
  // dergelijk rapport verschijnt dan gewoon in het archief; dat gaatje is bewust aanvaard.
  _outboxAbortControllers.get(id)?.abort();
  const lopendePoging = _outboxInFlightPromises.get(id);
  if (lopendePoging) { try { await lopendePoging; } catch { /* de afgebroken poging faalt gewoon af, negeren */ } }

  _outboxNextAttempt.delete(id);
  await outboxRemove(id);
  await refreshOutboxCache();
  renderRapportArchief();
}

// (T20) Forceert een onmiddellijke poging, ongeacht een eventuele backoff -- een handmatige
// klik mag niet wachten op de automatische backoff-vertraging (zie logOutboxFailure).
export async function outboxRetryNow(id) {
  const item = _outboxItems.find(i => i.id === id);
  if (!item) return;
  _outboxNextAttempt.delete(id);
  // Ook als de app sluit tijdens deze poging (niet afgewacht); niet in pure testmodus (die verstuurt niets).
  if (!TEST_MODE || TEST_UPLOAD) window.registreerAchtergrondVerzending?.();
  await runOutboxItem(item);
  await refreshOutboxCache();
  renderRapportArchief();
}

// Toont bekende technische serverfouten als mensentaal. Enkel weergave: item.lastError blijft ongewijzigd.
function menselijkeOutboxFout(fout) {
  const s = String(fout || '');
  if (/ongeldig ticketid|invalid ticketid/i.test(s)) return 'Dit ticket werd niet gevonden in Zoho. Meld dit aan de planner.';
  if (/ticketid and content required/i.test(s)) return 'Het rapport mist gegevens. Meld dit aan de planner.';
  return s;
}

export async function logOutboxFailure(item, stap, fout) {
  item.attempts  = (item.attempts || 0) + 1;
  item.lastError = fout;
  // (T20) Volgende automatische poging voor dit item mag pas na de backoff-vertraging —
  // "Opnieuw proberen" (renderOutboxBanner) verwijdert deze entry expliciet om dat te omzeilen.
  _outboxNextAttempt.set(item.id, Date.now() + OUTBOX_BACKOFF_MS[Math.min(item.attempts - 1, OUTBOX_BACKOFF_MS.length - 1)]);
  try { await outboxPut(item); } catch { /* best-effort */ }
  try {
    await fetch('/api/client-log', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        ticketId:     item.ticket?.id     || '',
        ticketNumber: item.ticket?.number || '',
        stap,
        fout,
        poging: item.attempts,
      }),
    });
  } catch { /* diagnostisch, best-effort — falen hier mag genegeerd worden */ }
}

export async function attemptOutboxItem(item) {
  // Testmodus (?test, ook op de live site): nooit iets naar de server sturen, tenzij de opt-in
  // ?test&upload actief is (dan gaat het naar de testopslag, nooit naar Zoho). Het item blijft
  // met een duidelijke melding in de wachtrij; de bestaande backoff voorkomt dat flushOutbox
  // het bij elke trigger opnieuw probeert.
  if (TEST_MODE && !TEST_UPLOAD) {
    item.lastError = 'Testmodus — niet verzonden';
    _outboxNextAttempt.set(item.id, Date.now() + OUTBOX_BACKOFF_MS[OUTBOX_BACKOFF_MS.length - 1]);
    try { await outboxPut(item); } catch { /* best-effort */ }
    return item;
  }

  // Al door de server ontvangen (verwijderen na een eerdere geslaagde verzending mislukte):
  // enkel nog opruimen.
  if (nextOutboxAction(item) === 'done') {
    await outboxRemove(item.id);
    return item;
  }

  const ctrl = new AbortController();
  _outboxAbortControllers.set(item.id, ctrl);
  let uitkomst;
  try {
    uitkomst = await V.metSlot(item.id, () => V.verzendItem(item, { fetch: window.fetch.bind(window), signal: ctrl.signal }));
  } finally {
    if (_outboxAbortControllers.get(item.id) === ctrl) _outboxAbortControllers.delete(item.id);
  }
  // Een andere context (bv. de service worker) is dit item al aan het versturen.
  if (!uitkomst.uitgevoerd) return item;

  const res = uitkomst.waarde;
  if (res.ok) {
    item.ontvangen = true;
    await outboxRemove(item.id);
    return item;
  }
  // Door de gebruiker geannuleerd: outboxCancelItem ruimt het item zelf op.
  if (res.afgebroken) return item;
  await logOutboxFailure(item, 'ontvangen', res.fout);
  return item;
}

// Beschermt tegen twee gelijktijdige attemptOutboxItem-pogingen voor hetzelfde item —
// bv. de achtergrond-poging na printRapport()'s 5s-timeout en een onafhankelijke
// flushOutbox() (page load / online / visibilitychange / banner-klik) die op hetzelfde
// item botsen. (De server is idempotent op het item-id; deze guard voorkomt enkel dubbel werk.)
export const _outboxInFlight = new Set();

// (Fix-ronde 1, punt 1b) id -> Promise van de op dit moment lopende runOutboxItem()-aanroep.
// outboxCancelItem() wacht dit af NA het aborten (zie _outboxAbortControllers hierboven), zodat
// de afgebroken/afgeronde poging haar afhandeling (logOutboxFailure/outboxPut) volledig
// heeft doorlopen vóór annuleren zelf het IndexedDB-record leest/verwijdert -- anders zouden
// beide gelijktijdig op hetzelfde record kunnen schrijven.
const _outboxInFlightPromises = new Map();

export function runOutboxItem(item) {
  if (_outboxInFlight.has(item.id)) return Promise.resolve(item); // al bezig via een andere weg, niet nogmaals starten
  _outboxInFlight.add(item.id);
  const promise = (async () => {
    // Vers herlezen uit IndexedDB: de in-flight-Set beschermt enkel tegen twee
    // gelijktijdige doorlopen, niet tegen een doorloop die met een verouderde
    // momentopname (uit een eerdere outboxGetAll) blijft wachten tot het slot
    // vrijkomt. Zonder deze hercontrole zou zo'n stale kopie na afloop van een geslaagde
    // doorloop het rapport alsnog opnieuw versturen.
    const fresh = (await outboxGetAll()).find(i => i.id === item.id);
    if (!fresh) return item; // al verwijderd door een andere doorloop — klaar, niets meer te doen
    return await attemptOutboxItem(fresh);
  })().finally(() => {
    _outboxInFlight.delete(item.id);
    if (_outboxInFlightPromises.get(item.id) === promise) _outboxInFlightPromises.delete(item.id);
  });
  _outboxInFlightPromises.set(item.id, promise);
  return promise;
}

export async function flushOutbox() {
  const items = await outboxGetAll();
  for (const item of items) {
    // (T20) Backoff nog niet verstreken voor dit item -- overslaan tot een volgende
    // flushOutbox()-trigger (opstart/online/zichtbaar-worden) of een handmatige "Opnieuw
    // proberen" (die dit expliciet reset, zie renderOutboxBanner/outboxRetryNow).
    const wachtTot = _outboxNextAttempt.get(item.id);
    if (wachtTot && Date.now() < wachtTot) continue;
    // Per item afschermen: gooit één wachtrij-item een onverwachte fout (bv. een
    // mislukte IndexedDB-schrijfactie in attemptOutboxItem), dan mag dat de rest
    // van de wachtrij niet blokkeren. flushOutbox hangt bovendien rechtstreeks aan
    // het 'online'-event, dus een doorgegooide fout zou een unhandled rejection zijn.
    try {
      await runOutboxItem(item);
    } catch (err) {
      console.warn('flushOutbox: onverwachte fout bij wachtrij-item', item.id, err);
    }
  }
  await refreshOutboxCache();
  renderRapportArchief();
}

// ── Window-bridge (zie Global Constraints) ──
window.flushOutbox         = flushOutbox;
window.renderOutboxBanner  = renderOutboxBanner;
window.outboxAdd           = outboxAdd;
window.runOutboxItem       = runOutboxItem;
window.nextOutboxAction    = nextOutboxAction;
window.refreshOutboxCache  = refreshOutboxCache;
window.outboxCancelItem    = outboxCancelItem; // (T20) knop "Annuleren" in de per-item banner
window.outboxRetryNow      = outboxRetryNow;   // (T20) knop "Opnieuw proberen" in de per-item banner
