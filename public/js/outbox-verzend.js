// public/js/outbox-verzend.js
// Gedeeld KLASSIEK script (geen import/export, geen DOM/window) voor het versturen van
// outbox-items naar POST /api/rapport-ontvangen. Wordt geladen door de pagina (<script src>) én
// door de service worker (importScripts); in Node (tests) levert module.exports hetzelfde object.
// Bewust geen ES-module: module-service-workers werken niet overal (zie spec, afwijking 3).
(function (root) {
  'use strict';

  // Zelfde waarden als public/js/outbox.js — de bestaande IndexedDB blijft geldig.
  var OUTBOX_DB_NAME = 'blitz-rapport-outbox';
  var OUTBOX_DB_VERSION = 1;
  var OUTBOX_STORE = 'items';

  // ── IndexedDB (1-op-1 uit outbox.js: outboxOpenDb/outboxAdd/outboxGetAll/outboxRemove) ──
  function openDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(OUTBOX_DB_NAME, OUTBOX_DB_VERSION);
      req.onupgradeneeded = function () {
        req.result.createObjectStore(OUTBOX_STORE, { keyPath: 'id' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  async function put(item) {
    var db = await openDb();
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(OUTBOX_STORE, 'readwrite');
      tx.objectStore(OUTBOX_STORE).put(item);
      tx.oncomplete = function () { db.close(); resolve(); };
      tx.onerror = function () { db.close(); reject(tx.error); };
    });
  }

  async function getAll() {
    var db = await openDb();
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(OUTBOX_STORE, 'readonly');
      var req = tx.objectStore(OUTBOX_STORE).getAll();
      req.onsuccess = function () { db.close(); resolve(req.result || []); };
      req.onerror = function () { db.close(); reject(req.error); };
    });
  }

  async function remove(id) {
    var db = await openDb();
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(OUTBOX_STORE, 'readwrite');
      tx.objectStore(OUTBOX_STORE).delete(id);
      tx.oncomplete = function () { db.close(); resolve(); };
      tx.onerror = function () { db.close(); reject(tx.error); };
    });
  }

  // ── Pure logica ──

  // 'done' enkel als de server het item al ontvangen heeft; alles anders (ook oude items met
  // archived:true / zohoUploaded:false) moet naar /api/rapport-ontvangen.
  function nextAction(item) {
    return item && item.ontvangen === true ? 'done' : 'ontvangen';
  }

  // Mag dit item nu verstuurd worden? Gewone testmodus (?test): nooit. ?test&upload: enkel items die
  // zelf in testmodus zijn aangemaakt (testModus === true); echte wachtende items blijven staan,
  // zodat ze nooit in de testopslag terechtkomen.
  function magVerzenden(item, testMode, testUpload) {
    if (!testMode) return true;
    return !!testUpload && !!item && item.testModus === true;
  }

  // Zelfde strip als de server (netlify/lib/rapportlijst.js stripZwareVelden): zonder de zware
  // velden _html, de twee handtekeningen en de oude inline fotos.
  function stripZwareVelden(rapportData) {
    var kopie = Object.assign({}, rapportData);
    delete kopie._html;
    delete kopie.handtekeningTech;
    delete kopie.handtekeningKlant;
    delete kopie.fotos;
    return kopie;
  }

  // Bouwt de POST-body; muteert het item niet.
  function bouwOntvangenBody(item) {
    var archiveBody = Object.assign({}, item.archiveBody);
    if (archiveBody.rapportData) archiveBody.rapportData = stripZwareVelden(archiveBody.rapportData);
    return {
      id: item.id,
      archiveBody: archiveBody,
      html: item.html,
      ticketId: item.ticket.id,
      filename: item.ticket.filename,
      isLocal: !!item.isLocal,
    };
  }

  function vertaalFout(r) {
    r = r || {};
    if (r.timeout) return 'Geen antwoord van de server (time-out)';
    if (r.netwerkFout) return 'Geen verbinding';
    // 403 buiten de sessie (geen-recht, csrf, wachtwoord wijzigen): niet stil blijven hangen, de reden tonen. De melding
    // gaat via logOutboxFailure ook naar /api/client-log (zichtbaar voor de beheerder) en het item blijft bewaard.
    if (r.status === 403) return 'Geweigerd door de server: ' + ((r.data && r.data.error) || 'geen toegang') + ' Het rapport blijft bewaard; meld dit aan de planner.';
    if (r.status === 413) return "Rapport is te groot om te versturen (te veel foto's). Meld dit aan de planner.";
    return (r.data && r.data.error) || ('Server (' + r.status + ')');
  }

  // ── Netwerk ──

  async function verzendItem(item, opts) {
    var doFetch = opts.fetch;
    var extern = opts.signal;
    var timeoutMs = opts.timeoutMs === undefined ? 60000 : opts.timeoutMs;

    if (extern && extern.aborted) return { ok: false, fout: 'Afgebroken', status: 0, afgebroken: true };

    var headers = { 'Content-Type': 'application/json', 'X-Blitz': '1' };
    if (item.testModus) headers['X-Blitz-Test'] = '1';

    var ctrl = new AbortController();
    var timedOut = false;
    var extAborted = false;
    var timer = setTimeout(function () { timedOut = true; ctrl.abort(); }, timeoutMs);
    var onExtAbort = function () { extAborted = true; ctrl.abort(); };
    if (extern) extern.addEventListener('abort', onExtAbort);

    try {
      var res = await doFetch('/api/rapport-ontvangen', {
        method: 'POST',
        headers: headers,
        // De service worker draait zonder pagina: de sessiecookie moet expliciet mee (zelfde oorsprong), anders is het
        // verzoek voor de server anoniem en komt het rapport in de outbox te staan met "Niet ingelogd".
        credentials: 'same-origin',
        body: JSON.stringify(bouwOntvangenBody(item)),
        signal: ctrl.signal,
      });
      var data = await res.json().catch(function () { return {}; });
      if (res.status === 200 && data && data.ok === true) return { ok: true };
      return { ok: false, fout: vertaalFout({ status: res.status, data: data }), status: res.status };
    } catch (err) {
      if (extAborted) return { ok: false, fout: 'Afgebroken', status: 0, afgebroken: true };
      if (timedOut) return { ok: false, fout: vertaalFout({ status: 0, timeout: true }), status: 0 };
      return { ok: false, fout: vertaalFout({ status: 0, netwerkFout: true }), status: 0 };
    } finally {
      clearTimeout(timer);
      if (extern) extern.removeEventListener('abort', onExtAbort);
    }
  }

  // Eén verzender per item tegelijk (pagina én service worker); de server is idempotent, dus
  // zonder Web Locks gewoon uitvoeren.
  async function metSlot(id, fn) {
    var locks = typeof navigator !== 'undefined' && navigator && navigator.locks;
    if (!locks || typeof locks.request !== 'function') {
      return { uitgevoerd: true, waarde: await fn() };
    }
    return locks.request('blitz-outbox-' + id, { ifAvailable: true }, async function (lock) {
      if (!lock) return { uitgevoerd: false };
      return { uitgevoerd: true, waarde: await fn() };
    });
  }

  // Gooit niet: de aanroeper (service worker) beslist zelf wat er bij mislukte items gebeurt.
  async function verzendAlles(opts) {
    var doFetch = opts.fetch;
    var opslag = opts.opslag || { getAll: getAll, remove: remove, put: put };
    var slot = opts.slot || metSlot;
    var verstuurd = 0;
    var mislukt = 0;
    var items = await opslag.getAll();
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      try {
        var uitkomst = await slot(item.id, async function () {
          // Vers lezen binnen het slot: het item kan sinds de eerste getAll door de pagina zijn
          // geannuleerd (verwijderd) of bijgewerkt; een put van de oude kopie zou dat ongedaan maken.
          var vers = (await opslag.getAll()).find(function (i) { return i.id === item.id; });
          if (!vers) return { ok: true, overgeslagen: true };
          // Al ontvangen door de server (verwijderen na een geslaagde verzending mislukte eerder):
          // enkel nog opruimen, niet opnieuw versturen.
          if (nextAction(vers) === 'done') {
            await opslag.remove(vers.id);
            return { ok: true };
          }
          var res = await verzendItem(vers, { fetch: doFetch });
          if (res.ok) {
            await opslag.remove(vers.id);
          } else {
            await opslag.put(Object.assign({}, vers, { lastError: res.fout, attempts: (vers.attempts || 0) + 1 }));
          }
          return res;
        });
        if (!uitkomst.uitgevoerd || uitkomst.waarde.overgeslagen) continue;
        if (uitkomst.waarde.ok) verstuurd++; else mislukt++;
      } catch (err) {
        mislukt++;
      }
    }
    return { verstuurd: verstuurd, mislukt: mislukt };
  }

  var api = {
    OUTBOX_DB_NAME: OUTBOX_DB_NAME,
    OUTBOX_DB_VERSION: OUTBOX_DB_VERSION,
    OUTBOX_STORE: OUTBOX_STORE,
    openDb: openDb,
    getAll: getAll,
    put: put,
    remove: remove,
    nextAction: nextAction,
    magVerzenden: magVerzenden,
    bouwOntvangenBody: bouwOntvangenBody,
    vertaalFout: vertaalFout,
    verzendItem: verzendItem,
    metSlot: metSlot,
    verzendAlles: verzendAlles,
  };

  root.outboxVerzend = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
