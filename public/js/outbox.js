// public/js/outbox.js
// Lokale IndexedDB-wachtrij voor rapport-verzending (archiveren + Zoho-upload), met retry-logica
// bij offline/mislukte pogingen. Zie docs/superpowers/specs/2026-08-11-rapport-verzend-betrouwbaarheid-design.md
// voor de achtergrond van dit ontwerp.

export const OUTBOX_DB_NAME    = 'blitz-rapport-outbox';
export const OUTBOX_DB_VERSION = 1;
export const OUTBOX_STORE      = 'items';
export let _outboxItems = [];

// Tijdelijke window-bridge: index.html's renderRapportArchief() (nog niet verplaatst) leest dit
// array nog rechtstreeks (module-scope kan er anders niet bij). refreshOutboxCache() hieronder
// vervangt _outboxItems telkens door een NIEUW array (geen in-place mutatie), dus een statische
// `window._outboxItems = _outboxItems`-toewijzing zou na de eerste refresh alweer verouderd zijn
// — vandaar een live getter in plaats van een eenmalige kopie.
Object.defineProperty(window, '_outboxItems', {
  get: () => _outboxItems,
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

export async function refreshOutboxCache() {
  _outboxItems = await outboxGetAll();
  renderOutboxBanner();
}

export function renderOutboxBanner() {
  const banner = document.getElementById('outbox-banner');
  if (!_outboxItems.length) { banner.style.display = 'none'; return; }
  const offlineBanner  = document.getElementById('offline-banner');
  const offlineVisible = offlineBanner && getComputedStyle(offlineBanner).display !== 'none';
  banner.style.top = offlineVisible ? `${92 + offlineBanner.offsetHeight}px` : '92px';
  banner.textContent = _outboxItems.length === 1
    ? '⏳ 1 rapport nog niet bevestigd — wordt automatisch opnieuw geprobeerd (tik om nu te proberen)'
    : `⏳ ${_outboxItems.length} rapporten nog niet bevestigd — wordt automatisch opnieuw geprobeerd (tik om nu te proberen)`;
  banner.style.display = 'flex';
}

export async function logOutboxFailure(item, stap, fout) {
  item.attempts  = (item.attempts || 0) + 1;
  item.lastError = fout;
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
      const res  = await fetch('/api/rapport-archief', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ...item.archiveBody, id: item.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || String(res.status));
      item.archived = true;
      await outboxPut(item);
      // Houd de globale archief-versie synchroon — verwijderRapport()/verstuurRapport()
      // gebruiken _archiefVersie voor hun eigen optimistic-lock en zouden anders een
      // vals-positief conflict kunnen krijgen na een outbox-archivering.
      if (typeof data.versie === 'number') _archiefVersie = data.versie;
    } catch (err) {
      await logOutboxFailure(item, 'archiveren', err.message);
      return item;
    }
    return attemptOutboxItem(item);
  }

  if (action === 'check-zoho') {
    let alreadyDone = false;
    try {
      const res  = await fetch(`/api/rapport-archief?id=${encodeURIComponent(item.id)}`);
      const data = await res.json();
      alreadyDone = data?.rapport?.zohoUploaded === true;
    } catch { /* check mislukt — probeer de upload gewoon, geen erg bij een extra check-poging later */ }

    if (alreadyDone) {
      item.zohoUploaded = true;
      await outboxPut(item);
      return attemptOutboxItem(item);
    }

    try {
      const res  = await fetch('/api/rapport', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ html: item.html, ticketId: item.ticket.id, filename: item.ticket.filename }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload mislukt');

      // De Zoho-upload zelf is gelukt — dit ONMIDDELLIJK lokaal vastleggen, nog
      // vóór de bevestigings-call hieronder. Zo herhaalt een latere mislukte
      // confirm-call nooit de upload zelf (dat zou de PDF een tweede keer aan
      // hetzelfde ticket hangen — precies wat deze functie moet voorkomen).
      item.zohoUploaded = true;
      await outboxPut(item);
    } catch (err) {
      await logOutboxFailure(item, 'zoho-upload', err.message);
      return item;
    }

    // Archief-bevestiging is best-effort: mislukt ze, dan blijft de server-side
    // zohoUploaded-vlag mogelijk (stil) false — aanvaardbaar, want dit item wordt
    // sowieso niet opnieuw geprobeerd (lokaal al als geüpload gemarkeerd), dus er
    // is geen risico meer op een dubbele upload. Enkel diagnostisch loggen.
    try {
      const confirmRes  = await fetch('/api/rapport-archief', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ...item.archiveBody, id: item.id, zohoUploaded: true }),
      });
      const confirmData = await confirmRes.json().catch(() => ({}));
      if (!confirmRes.ok) throw new Error('Bevestigen van Zoho-upload in archief mislukt');
      if (typeof confirmData.versie === 'number') _archiefVersie = confirmData.versie;
    } catch (err) {
      await logOutboxFailure(item, 'zoho-confirm', err.message);
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

export async function runOutboxItem(item) {
  if (_outboxInFlight.has(item.id)) return item; // al bezig via een andere weg, niet nogmaals starten
  _outboxInFlight.add(item.id);
  try {
    // Vers herlezen uit IndexedDB: de in-flight-Set beschermt enkel tegen twee
    // gelijktijdige doorlopen, niet tegen een doorloop die met een verouderde
    // momentopname (uit een eerdere outboxGetAll) blijft wachten tot het slot
    // vrijkomt. Zonder deze hercontrole zou zo'n stale kopie (met bv. nog
    // zohoUploaded:false) na afloop van een geslaagde doorloop alsnog opnieuw
    // naar Zoho uploaden — precies de dubbele bijlage die we willen vermijden.
    const fresh = (await outboxGetAll()).find(i => i.id === item.id);
    if (!fresh) return item; // al verwijderd door een andere doorloop — klaar, niets meer te doen
    return await attemptOutboxItem(fresh);
  } finally {
    _outboxInFlight.delete(item.id);
  }
}

export async function flushOutbox() {
  const items = await outboxGetAll();
  for (const item of items) {
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
