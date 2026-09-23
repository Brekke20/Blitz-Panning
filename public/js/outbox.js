// public/js/outbox.js
// Lokale IndexedDB-wachtrij voor rapport-verzending (archiveren + Zoho-upload), met retry-logica
// bij offline/mislukte pogingen. Zie docs/superpowers/specs/2026-08-11-rapport-verzend-betrouwbaarheid-design.md
// voor de achtergrond van dit ontwerp.

export const OUTBOX_DB_NAME    = 'blitz-rapport-outbox';
export const OUTBOX_DB_VERSION = 1;
export const OUTBOX_STORE      = 'items';
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

export function outboxOpenDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OUTBOX_DB_NAME, OUTBOX_DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(OUTBOX_STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

export async function outboxAdd(item) {
  const db = await outboxOpenDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, 'readwrite');
    tx.objectStore(OUTBOX_STORE).put(item);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror    = () => { db.close(); reject(tx.error); };
  });
}

export const outboxPut = outboxAdd; // put() op een keyPath-store is ook een upsert

export async function outboxGetAll() {
  const db = await outboxOpenDb();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(OUTBOX_STORE, 'readonly');
    const req = tx.objectStore(OUTBOX_STORE).getAll();
    req.onsuccess = () => { db.close(); resolve(req.result || []); };
    req.onerror   = () => { db.close(); reject(req.error); };
  });
}

export async function outboxRemove(id) {
  const db = await outboxOpenDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, 'readwrite');
    tx.objectStore(OUTBOX_STORE).delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror    = () => { db.close(); reject(tx.error); };
  });
}

// Pure functie — geen I/O — bepaalt welke stap van een wachtrij-item nog moet gebeuren.
export function nextOutboxAction(item) {
  if (!item.archived) return 'archive';
  if (item.isLocal)   return 'done';
  if (!item.zohoUploaded) return 'check-zoho';
  return 'done';
}

// (T20) Per-stap client-timeout: zonder AbortController wachtte de client onbeperkt op een
// hangende fetch (zie docs/reviews/2026-09-22-outbox-onderzoek.md, punt 4). De timeouts hieronder
// liggen royaal boven het server-side 26s-maximum (netlify.toml, [functions.rapport] timeout = 26)
// zodat dit enkel een volledig hangende verbinding opvangt, niet legitiem trage serververwerking.
//
// (Fix-ronde 1, punt 1b) itemId (optioneel) registreert de AbortController van de op dit moment
// ECHT lopende fetch voor dat wachtrij-item in _outboxAbortControllers, zodat outboxCancelItem()
// die controller kan opzoeken en meteen kan aborten i.p.v. te wachten tot de volledige (tot 120s
// lange) timeout verstreken is. Enkel de laatst geregistreerde controller voor een id wordt bij
// afronding verwijderd (de `=== ctrl`-check) -- puur defensief, want de 4 fetches per item lopen
// in de praktijk altijd sequentieel/awaited, nooit gelijktijdig.
const _outboxAbortControllers = new Map(); // id -> AbortController van de lopende fetch voor dat item

async function fetchWithTimeout(url, opts, timeoutMs, itemId) {
  const ctrl  = new AbortController();
  if (itemId) _outboxAbortControllers.set(itemId, ctrl);
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
    if (itemId && _outboxAbortControllers.get(itemId) === ctrl) _outboxAbortControllers.delete(itemId);
  }
}

// (T20) Exponentiële backoff tussen AUTOMATISCHE pogingen binnen één sessie. In-memory (geen
// IndexedDB), dus reset bij een paginaherlaad -- dat is bewust: een verse pagina-load mag altijd
// meteen proberen. "Opnieuw proberen" (zie renderOutboxBanner) reset dit expliciet per item.
const OUTBOX_BACKOFF_MS = [10000, 30000, 90000];
const _outboxNextAttempt = new Map(); // id -> timestamp vanaf wanneer een automatische poging weer mag

export async function refreshOutboxCache() {
  _outboxItems = await outboxGetAll();
  renderOutboxBanner();
}

// (T20) 2 zichtbare stappen, niet 3: zodra de Zoho-upload lukt zet attemptOutboxItem()
// meteen item.zohoUploaded = true en de daaropvolgende recursieve aanroep ziet via
// nextOutboxAction() onmiddellijk 'done' -- de archief-bevestigingscall gebeurt daartussen
// wel, maar zonder eigen persistente/zichtbare toestand (zie task-20-brief.md, "Huidig gedrag").
export function outboxStepLabel(item) {
  if (!item.archived) return 'Archiveren (1/2)';
  if (!item.isLocal && !item.zohoUploaded) return 'PDF naar Zoho versturen (2/2)';
  return 'Bijna klaar...';
}

export function renderOutboxBanner() {
  const banner = document.getElementById('outbox-banner');
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
      ${item.lastError ? `<span class="outbox-item-error">${escHtml(item.lastError)}</span>` : ''}
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

// (T20) "Annuleren" -- de waarschuwing verschilt naargelang het item al gearchiveerd is: vóór
// die stap gaat het rapport volledig verloren (nergens bewaard), erna blijft het bewaard in het
// archief maar gemarkeerd als niet verzonden (zie ook renderRapportArchief in rapport-archief.js).
export async function outboxCancelItem(id) {
  const item = _outboxItems.find(i => i.id === id);
  if (!item) return;
  // De confirm-tekst is een momentopname van vóór het aborten hieronder -- gebaseerd op de
  // stap waarin de technieker het item ZAG staan toen die op "Annuleren" klikte.
  const msg = item.archived
    ? 'Dit rapport wordt NIET naar Zoho verstuurd. Het blijft wel bewaard in het archief, gemarkeerd als "niet verzonden". Doorgaan?'
    : 'Dit rapport gaat volledig verloren — het is nog nergens bewaard. Doorgaan?';
  if (!confirm(msg)) return;

  // (Fix-ronde 1, punt 1b) Breek een eventueel op dit moment lopende poging voor dit item af
  // (bv. de Zoho-upload-fetch) en wacht die af vóórdat we zelf iets schrijven/verwijderen.
  // Zonder dit kon annuleren tijdens een net-op-tijd geslaagde upload een archief-POST met
  // geannuleerd:true + zohoUploaded:false versturen terwijl rapport.js vlak erna (via
  // markeerUpgeload) zohoUploaded:true zou zetten -- de labels raakten dan uit sync (zie
  // rapport.js/pasMarkeringToe() en rapport-archief.js voor de server-side helft van deze fix).
  // Een fetch-abort garandeert niet dat de SERVER zelf stopt met verwerken (die kan de upload al
  // ontvangen/gestart hebben) -- dat resterende gaatje is bewust aanvaard en wordt afgedekt door
  // de server-side geannuleerd:false-regels, niet hier.
  _outboxAbortControllers.get(id)?.abort();
  const lopendePoging = _outboxInFlightPromises.get(id);
  if (lopendePoging) { try { await lopendePoging; } catch { /* de afgebroken poging faalt gewoon af, negeren */ } }

  // Na het afwachten opnieuw uit IndexedDB lezen: de zonet afgeronde (of net vóór de abort al
  // voltooide) poging kan het record gewijzigd of zelfs al verwijderd hebben (bv. een upload die
  // ondanks de abort toch op tijd doorkwam en de volledige 'done'-flow al doorliep, inclusief een
  // eigen outboxRemove()). De `item`-variabele hierboven is een momentopname van vóór het
  // afwachten en kan dus verouderd zijn.
  const fresh = (await outboxGetAll()).find(i => i.id === id);
  if (!fresh) {
    // Item bestaat niet meer -- de lopende poging is zelf al succesvol afgerond en verwijderd.
    // Niets meer te annuleren.
    await refreshOutboxCache();
    renderRapportArchief();
    return;
  }

  if (fresh.archived) {
    // Best-effort: de archief-kopie markeren als geannuleerd/niet verzonden. Lukt dit niet
    // (offline, server-fout), dan verwijderen we het item hieronder alsnog uit de lokale
    // wachtrij — annuleren moet altijd werken, ook offline; de archief-markering is een
    // bijkomend gemak, geen harde voorwaarde.
    try {
      await fetchWithTimeout('/api/rapport-archief', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ...fresh.archiveBody, id: fresh.id, zohoUploaded: fresh.zohoUploaded || false, geannuleerd: true }),
      }, 60000);
    } catch { /* best-effort, zie hierboven */ }
  }
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
  await runOutboxItem(item);
  await refreshOutboxCache();
  renderRapportArchief();
}

// (Fix-ronde 2, punt 2) Een 409 "al bezig in een ander venster" (server-side in-flight-
// reservering, zie rapport.js) is een BENIGNE, verwachte wachttoestand -- geen echte fout: een
// andere sessie/tab is gewoon nog bezig met exact hetzelfde rapport. We tonen dit wel via
// item.lastError (dezelfde banner-weergave als een echte fout) en passen dezelfde backoff toe,
// maar tellen het niet bij élke herhaalde 409 opnieuw mee in item.attempts -- anders zou het
// balkje bij een lang wachtende andere sessie een steeds oplopend "poging N" tonen alsof er
// iets misloopt, terwijl het gewoon normaal aan het wachten is. Wél één keer meegeteld (bij de
// eerste 409 voor dit item) zodat er zichtbaar íets gebeurd is. Geen /api/client-log-melding --
// dit is geen fout om te diagnosticeren.
async function logOutboxWait(item, fout) {
  if (item.lastError !== fout) {
    item.attempts = (item.attempts || 0) + 1;
  }
  item.lastError = fout;
  _outboxNextAttempt.set(item.id, Date.now() + OUTBOX_BACKOFF_MS[Math.min(Math.max(item.attempts, 1) - 1, OUTBOX_BACKOFF_MS.length - 1)]);
  try { await outboxPut(item); } catch { /* best-effort */ }
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
  const action = nextOutboxAction(item);

  if (action === 'archive') {
    try {
      const res  = await fetchWithTimeout('/api/rapport-archief', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ...item.archiveBody, id: item.id }),
      }, 60000, item.id);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || String(res.status));
      item.archived = true;
      await outboxPut(item);
      // Houd de globale archief-versie synchroon — verwijderRapport()/verstuurRapport()
      // gebruiken _archiefVersie voor hun eigen optimistic-lock en zouden anders een
      // vals-positief conflict kunnen krijgen na een outbox-archivering.
      if (typeof data.versie === 'number') _archiefVersie = data.versie;
    } catch (err) {
      const msg = err.name === 'AbortError' ? 'Geen antwoord van de server (time-out)' : err.message;
      await logOutboxFailure(item, 'archiveren', msg);
      return item;
    }
    return attemptOutboxItem(item);
  }

  if (action === 'check-zoho') {
    let alreadyDone = false;
    try {
      const res  = await fetchWithTimeout(`/api/rapport-archief?id=${encodeURIComponent(item.id)}`, {}, 30000, item.id);
      const data = await res.json();
      alreadyDone = data?.rapport?.zohoUploaded === true;
    } catch { /* check mislukt (ook bij een time-out) — probeer de upload gewoon, geen erg bij een extra check-poging later */ }

    if (alreadyDone) {
      item.zohoUploaded = true;
      await outboxPut(item);
      return attemptOutboxItem(item);
    }

    try {
      // (T20) verzendId = item.id -- al een stabiele UUID sinds Task 1 (keyPath van de
      // IndexedDB-store, dus gegarandeerd aanwezig op elk item, ook op een outbox-item dat al
      // van vóór deze release in de wachtrij van een technieker staat). Dient server-side
      // (rapport.js) als idempotentiesleutel tegen een dubbele Zoho-bijlage.
      const res  = await fetchWithTimeout('/api/rapport', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ html: item.html, ticketId: item.ticket.id, filename: item.ticket.filename, verzendId: item.id }),
      }, 120000, item.id);
      const data = await res.json().catch(() => ({}));
      // (Fix-ronde 2, punt 2) Server-side in-flight-reservering: een andere sessie/tab is al
      // bezig met exact hetzelfde rapport (zelfde verzendId). Geen echte fout -- gewoon wachten
      // en later opnieuw proberen (normale backoff, zie logOutboxWait hierboven).
      if (res.status === 409 && data?.inProgress) {
        await logOutboxWait(item, 'Verzending is al bezig in een ander venster — even wachten');
        return item;
      }
      if (!res.ok) throw new Error(data.error || 'Upload mislukt');

      // De Zoho-upload zelf is gelukt — dit ONMIDDELLIJK lokaal vastleggen, nog
      // vóór de bevestigings-call hieronder. Zo herhaalt een latere mislukte
      // confirm-call nooit de upload zelf (dat zou de PDF een tweede keer aan
      // hetzelfde ticket hangen — precies wat deze functie moet voorkomen).
      item.zohoUploaded = true;
      await outboxPut(item);
    } catch (err) {
      // Let op: een AbortError hier betekent NIET noodzakelijk dat de upload zelf mislukte —
      // de server kan de Zoho-upload alsnog voltooien terwijl de client al opgaf op de
      // time-out. Precies dat scenario dekt de server-side verzendId-idempotentie (rapport.js)
      // af: een volgende poging met hetzelfde item.id/verzendId hangt dan geen tweede PDF aan.
      const msg = err.name === 'AbortError' ? 'Geen antwoord van de server (time-out)' : err.message;
      await logOutboxFailure(item, 'zoho-upload', msg);
      return item;
    }

    // Archief-bevestiging is best-effort: mislukt ze, dan blijft de server-side
    // zohoUploaded-vlag mogelijk (stil) false — aanvaardbaar, want dit item wordt
    // sowieso niet opnieuw geprobeerd (lokaal al als geüpload gemarkeerd), dus er
    // is geen risico meer op een dubbele upload. Enkel diagnostisch loggen.
    try {
      const confirmRes  = await fetchWithTimeout('/api/rapport-archief', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ...item.archiveBody, id: item.id, zohoUploaded: true }),
      }, 60000, item.id);
      const confirmData = await confirmRes.json().catch(() => ({}));
      if (!confirmRes.ok) throw new Error('Bevestigen van Zoho-upload in archief mislukt');
      if (typeof confirmData.versie === 'number') _archiefVersie = confirmData.versie;
    } catch (err) {
      const msg = err.name === 'AbortError' ? 'Geen antwoord van de server (time-out)' : err.message;
      await logOutboxFailure(item, 'zoho-confirm', msg);
    }
    return attemptOutboxItem(item);
  }

  // action === 'done'
  await outboxRemove(item.id);
  return item;
}

// Beschermt tegen twee gelijktijdige attemptOutboxItem-pogingen voor hetzelfde item —
// bv. de achtergrond-poging na printRapport()'s 5s-timeout en een onafhankelijke
// flushOutbox() (page load / online / visibilitychange / banner-klik) die op hetzelfde
// item botsen. Zonder deze guard konden beide onafhankelijk de check-zoho-stap bereiken
// en dus tweemaal naar Zoho uploaden.
export const _outboxInFlight = new Set();

// (Fix-ronde 1, punt 1b) id -> Promise van de op dit moment lopende runOutboxItem()-aanroep.
// outboxCancelItem() wacht dit af NA het aborten (zie _outboxAbortControllers hierboven), zodat
// de afgebroken/afgeronde poging haar catch-afhandeling (logOutboxFailure/outboxPut) volledig
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
    // vrijkomt. Zonder deze hercontrole zou zo'n stale kopie (met bv. nog
    // zohoUploaded:false) na afloop van een geslaagde doorloop alsnog opnieuw
    // naar Zoho uploaden — precies de dubbele bijlage die we willen vermijden.
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
