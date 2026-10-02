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
//   al het andere                  null
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.SwStrategie = fabriek();
})(typeof self !== 'undefined' ? self : this, function () {
  function maakStrategie({
    cacheNaam, externNaam, shell, cdnVast, fontHosts, eigenOrigin,
    navTimeoutMs = 0, subTimeoutMs = 0, cacheModusMs = 60000,
    caches, fetchFn, nu, wacht,
  }) {
    const shellPaden = new Set(shell);
    const cdnSet = new Set(cdnVast);
    const fontSet = new Set(fontHosts);
    let cacheModusTot = 0;

    const isApi = (u) => u.pathname === '/api' || u.pathname.startsWith('/api/');
    const bewaarbaar = (r) => r && r.ok;

    async function uitCache(naam, sleutel) {
      const c = await caches.open(naam);
      return c.match(sleutel);
    }

    // Shell: netwerk-eerst met cache als terugval; optioneel een time-out waarna de cache voorrang krijgt.
    async function shellAntwoord(request, url) {
      const isNav = request.mode === 'navigate';
      const pad = eigenOrigin + url.pathname;
      const zoekCache = async () => (await uitCache(cacheNaam, pad)) || (isNav ? uitCache(cacheNaam, eigenOrigin + '/index.html') : undefined);

      if (nu() < cacheModusTot) {
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
        if (kopie) return kopie;
        throw err;
      }
      if (eerste) return eerste.r;

      // Time-out: heeft de cache een kopie, geef die en zet de cache-modus aan; anders blijven we op het netwerk wachten.
      const kopie = await zoekCache();
      if (kopie) {
        cacheModusTot = nu() + cacheModusMs;
        netwerk.catch(() => {}); // het lopende verzoek mag stil mislukken
        return kopie;
      }
      try {
        return await netwerk;
      } catch (err) {
        const laat = await zoekCache();
        if (laat) return laat;
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
        if (isApi(url)) return null;
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
      await Promise.allSettled(cdnVast.map(async (u) => {
        const antw = await fetchFn(u, { mode: 'cors' });
        if (bewaarbaar(antw)) await extern.put(u, antw);
      }));
    }

    async function activeer() {
      const sleutels = await caches.keys();
      await Promise.all(sleutels.filter((k) => k !== cacheNaam && k !== externNaam).map((k) => caches.delete(k)));
    }

    return { installeer, activeer, behandel };
  }

  return { maakStrategie };
});
