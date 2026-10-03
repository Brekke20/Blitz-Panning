// Beslislogica van de service worker (etappe 7, N3). UMD: `self.SwStrategie` in de service worker, `module.exports` in node
// (zodat `node --test` ze zonder browser kan testen). Alles wat de buitenwereld raakt wordt geinjecteerd
// (caches, fetchFn, nu, wacht); dit bestand gebruikt geen globals.
//
// Vaste lijn: `/api` en alles wat geen GET is wordt NOOIT afgehandeld (behandel geeft null: de browser doet het zelf) en dus
// nooit bewaard of uit een cache beantwoord.
//
//   eigen origin, GET, niet /api   shell: netwerk-eerst; de cache is enkel de terugval (bij netwerkfout of na de
//                                  time-out), en wordt bij een netwerksucces NIET ververst (N3e: de momentopname blijft
//                                  die van de installatie, zodat de modules onderling consistent blijven)
//   exacte CDN-URL (cdnVast)       cache-eerst in externNaam; bij een miss netwerk en bewaren (enkel bij ok)
//   Google Fonts-hosts             stale-while-revalidate in externNaam
//   al het andere                  null (ook /api en /.netlify/: geen navigatie-fallback naar index.html)
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.SwStrategie = fabriek();
})(typeof self !== 'undefined' ? self : this, function () {
  function maakStrategie({
    cacheNaam, externNaam, shell, cdnVast, cdnLui = [], fontHosts, eigenOrigin,
    navTimeoutMs = 0, subTimeoutMs = 0, cacheModusMs = 60000, installTimeoutMs = 10000,
    caches, fetchFn, nu, wacht,
  }) {
    const shellPaden = new Set(shell);
    const cdnSet = new Set(cdnVast);
    const fontSet = new Set(fontHosts);
    const luiSet = new Set(cdnLui); // URL's in cdnVast die wel cache-eerst/bewaard worden maar niet vooraf opgehaald (nu leeg: ExcelJS wordt wél vooraf opgehaald)
    let cacheModusTot = 0;
    // Cache-modus per client (I3): wie zijn pagina uit de cache kreeg, krijgt ook al zijn modules en late imports daaruit, zolang de
    // client leeft (de SW-herstart wist dit; dan geldt enkel nog de globale time-out). Begrensd, oudste eerst weg.
    const cacheClients = new Set();
    const MAX_CLIENTS = 50;

    const isApi = (u) => u.pathname === '/api' || u.pathname.startsWith('/api/');
    // Enkel een volledig antwoord (200) gaat de cache in: een 206 (gedeeltelijk) in cache.put geeft een fout of een stuk bestand.
    const bewaarbaar = (r) => !!r && r.status === 200;
    const isNetlify = (u) => u.pathname === '/.netlify' || u.pathname.startsWith('/.netlify/');

    const inCacheModus = (request) => (request.clientId && cacheClients.has(request.clientId)) || nu() < cacheModusTot;
    // Zet de cache-modus aan voor deze load: voor de client van de navigatie (resultingClientId) of van de submodule (clientId), en globaal
    // voor `cacheModusMs` (terugval voor verzoeken zonder clientId).
    function zetCacheModus(request) {
      cacheModusTot = nu() + cacheModusMs;
      const id = request.mode === 'navigate' ? request.resultingClientId : request.clientId;
      if (!id) return;
      cacheClients.delete(id);
      cacheClients.add(id);
      if (cacheClients.size > MAX_CLIENTS) cacheClients.delete(cacheClients.values().next().value);
    }

    async function uitCache(naam, sleutel) {
      const c = await caches.open(naam);
      return c.match(sleutel);
    }

    // Shell: netwerk-eerst met cache als terugval; optioneel een time-out waarna de cache voorrang krijgt.
    async function shellAntwoord(request, url) {
      const isNav = request.mode === 'navigate';
      const pad = eigenOrigin + url.pathname;
      const zoekCache = async () => (await uitCache(cacheNaam, pad)) || (isNav ? uitCache(cacheNaam, eigenOrigin + '/index.html') : undefined);

      if (inCacheModus(request)) {
        const kopie = await zoekCache();
        if (kopie) return kopie;
      }

      const netwerk = Promise.resolve().then(() => fetchFn(request));
      const limiet = isNav ? navTimeoutMs : subTimeoutMs;
      let eerste;
      try {
        eerste = limiet > 0
          ? await Promise.race([netwerk.then((r) => ({ r })), wacht(limiet).then(() => null)])
          : { r: await netwerk };
      } catch (err) {
        const kopie = await zoekCache();
        if (kopie) { zetCacheModus(request); return kopie; }
        throw err;
      }
      if (eerste) return eerste.r;

      // Time-out: heeft de cache een kopie, geef die en zet de cache-modus aan; anders blijven we op het netwerk wachten.
      const kopie = await zoekCache();
      if (kopie) {
        zetCacheModus(request);
        netwerk.catch(() => {}); // het lopende verzoek mag stil mislukken
        return kopie;
      }
      try {
        return await netwerk;
      } catch (err) {
        const laat = await zoekCache();
        if (laat) { zetCacheModus(request); return laat; }
        throw err;
      }
    }

    async function cdnAntwoord(request) {
      const kopie = await uitCache(externNaam, request.url);
      if (kopie) return kopie;
      const antw = await fetchFn(request.url, { mode: 'cors' });
      if (bewaarbaar(antw)) {
        const c = await caches.open(externNaam);
        await c.put(request.url, antw.clone());
      }
      return antw;
    }

    async function fontAntwoord(request, opties) {
      const ververs = async () => {
        const antw = await fetchFn(request.url, { mode: 'cors' });
        if (bewaarbaar(antw)) {
          const c = await caches.open(externNaam);
          await c.put(request.url, antw.clone());
        }
        return antw;
      };
      const kopie = await uitCache(externNaam, request.url);
      if (kopie) {
        const p = ververs().catch(() => {});
        if (opties && typeof opties.waitUntil === 'function') opties.waitUntil(p);
        return kopie;
      }
      return ververs();
    }

    // null = niet afhandelen (de browser doet het verzoek zelf). `opties.waitUntil` houdt de achtergrondverversing in leven.
    function behandel(request, opties) {
      if (request.method !== 'GET') return null;
      let url;
      try { url = new URL(request.url); } catch { return null; }
      if (url.origin === eigenOrigin) {
        if (isApi(url) || isNetlify(url)) return null;
        if (request.mode === 'navigate' || shellPaden.has(url.pathname)) return shellAntwoord(request, url);
        return null;
      }
      if (cdnSet.has(request.url)) return cdnAntwoord(request);
      if (url.protocol === 'https:' && fontSet.has(url.hostname)) return fontAntwoord(request, opties);
      return null;
    }

    async function installeer() {
      const hoofd = await caches.open(cacheNaam);
      await hoofd.addAll(shell); // één 404 laat de installatie falen (bewust: een halve schil is erger dan de oude)
      const extern = await caches.open(externNaam);
      // Elke CDN-prefetch heeft een time-out die de hele download dekt (fetch EN lezen/bewaren van de body, want een CDN die de headers stuurt
      // en dan stokt, mag de installatie/update evenmin ophouden); bij de time-out wordt de fetch afgebroken. De externe cache kan daardoor
      // gedeeltelijk gevuld blijven: een ontbrekende URL haalt de runtime cache-miss alsnog op en een volgende installatie vult aan.
      // CDN-URL's zijn op versie vastgepind: wat al in de externe cache staat, wordt niet opnieuw opgehaald (I5). De `cdnLui`-lijst
      // (momenteel leeg; ExcelJS wordt wél vooraf opgehaald) bevat URL's die pas bij het eerste gebruik worden opgehaald en bewaard.
      await Promise.allSettled(cdnVast.filter((u) => !luiSet.has(u)).map(async (u) => {
        if (await extern.match(u)) return;
        const stop = typeof AbortController === 'function' ? new AbortController() : null;
        const download = (async () => {
          const antw = await fetchFn(u, stop ? { mode: 'cors', signal: stop.signal } : { mode: 'cors' });
          if (bewaarbaar(antw)) await extern.put(u, antw);
        })();
        download.catch(() => {}); // na een time-out mag de afgebroken download stil mislukken
        try {
          await Promise.race([
            download,
            wacht(installTimeoutMs).then(() => { throw new Error('time-out CDN-prefetch ' + u); }),
          ]);
        } catch (err) {
          if (stop) stop.abort();
          throw err;
        }
      }));
    }

    async function activeer() {
      const sleutels = await caches.keys();
      await Promise.all(sleutels.filter((k) => k !== cacheNaam && k !== externNaam).map((k) => caches.delete(k)));
    }

    return { installeer, activeer, behandel };
  }

  // '?navTimeout=<ms>' van het sw.js-adres: enkel gehele getallen 0-30000 (de tests zetten hem); al het andere geeft de standaard.
  function leesNavTimeout(zoek, standaard = 0) {
    const w = new URLSearchParams(zoek).get('navTimeout');
    return w !== null && /^\d{1,5}$/.test(w) && Number(w) <= 30000 ? Number(w) : standaard;
  }

  return { maakStrategie, leesNavTimeout };
});
