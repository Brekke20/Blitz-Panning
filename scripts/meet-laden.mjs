// Laadmeting (etappe 7, N22): hoe snel start de app, koud en warm, bij een trage server? Buiten de suites; draai met
//   node scripts/meet-laden.mjs
// en vergelijk de tabel "voor" en "na" een wijziging aan de laadketen (modulepreload, lazy ExcelJS, service worker).
//
// Opzet:
//  - Een eigen mini-server op een vrije poort serveert public/ (ETag + max-age=0,must-revalidate zoals Netlify) en
//    beantwoordt elk /api-pad met 200 (geen backend, geen Zoho/TomTom/mail). Enkel /api/tickets geeft de dummydata.
//  - Chromium met --host-resolver-rules: enkel localhost en de twee CDN-hosts (cdnjs.cloudflare.com, cdn.jsdelivr.net)
//    zijn bereikbaar; elke andere host faalt meteen. De CDN-verzoeken zijn gewone GET's van statische bibliotheken.
//  - Vertraging per verzoek naar de eigen server: 0, 150 en 400 ms (aan de serverkant, vóór het antwoord).
//  - Profielen: koud (nieuwe context, serviceWorkers geblokkeerd), warm zonder service worker (tweede bezoek, enkel
//    de HTTP-cache) en warm met service worker (de SW mag registreren en activeren; tweede bezoek).
//  - Per profiel: aantal verzoeken, overgedragen bytes (CDP encodedDataLength) en de tijd tot `window.kern` bestaat
//    en `#cnt-tickets` gevuld is (3 voor de dummydata).
//  - Vergelijking voor/na (finale fix B): met `--voor=<map met public/>` (bv. `git archive f707b07 public` uitgepakt in een tijdelijke map)
//    draaien de runs AFWISSELEND (voor, na, na, voor, ...) tegen die map en tegen public/ van deze checkout, in dezelfde sessie; de tabel
//    toont per variant de MEDIAAN van `--runs=<n>` (standaard 5) runs. Zonder `--voor` wordt enkel de huidige public/ gemeten.
//    `--vertraging=0,150,400` kiest de serververtragingen. Voorbeeld:
//      node scripts/meet-laden.mjs --voor=C:\tmp\blitz-voor\public --runs=5 --vertraging=150
//  - Daarnaast: parse- en evaluatietijd van rapport-wizard.js onder 4x CPU-vertraging (dynamische import van een nieuwe
//    URL, nadat het bestand zelf al opgehaald is; de imports van de wizard staan dan al in het modulegeheugen).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import crypto from 'node:crypto';
import { chromium } from 'playwright-core';
import { maakDummyData } from '../public/js/kern/testdata.js';

const PUBLIC = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..', 'public');
const arg = (naam) => process.argv.find(a => a.startsWith(`--${naam}=`))?.slice(naam.length + 3);
const VERTRAGINGEN = (arg('vertraging') || '0,150,400').split(',').map(Number);
const RUNS = Math.max(1, Number(arg('runs') || 5));
const VOOR = arg('voor') ? path.resolve(arg('voor')) : null;
const mediaan = (l) => { const t = [...l].sort((a, b) => a - b); const m = t.length >> 1; return t.length % 2 ? t[m] : Math.round((t[m - 1] + t[m]) / 2); };
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
};
const TOEGESTAAN = ['localhost', '127.0.0.1', 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net'];
const vreemdeHosts = [];
const TICKETS = maakDummyData(Date.now());

let vertraging = 0;
function maakServer(PUBLIC) {
const server = http.createServer((req, res) => {
  const pad = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const antwoord = () => {
    if (pad.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(pad === '/api/tickets' ? TICKETS : {}));
    }
    const bestand = path.normalize(path.join(PUBLIC, pad === '/' ? 'index.html' : pad));
    if (bestand !== PUBLIC && !bestand.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(bestand, (err, data) => {
      if (err) { res.writeHead(404); return res.end('niet gevonden'); }
      const etag = '"' + crypto.createHash('sha1').update(data).digest('hex') + '"';
      const koppen = { 'Content-Type': MIME[path.extname(bestand)] || 'application/octet-stream', ETag: etag, 'Cache-Control': 'public,max-age=0,must-revalidate' };
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, koppen); return res.end(); }
      res.writeHead(200, koppen);
      res.end(data);
    });
  };
  if (vertraging > 0) setTimeout(antwoord, vertraging); else antwoord();
});
return server;
}
const servers = { na: maakServer(PUBLIC) };
if (VOOR) servers.voor = maakServer(VOOR);
const basis = {};
for (const [naam, srv] of Object.entries(servers)) {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  basis[naam] = `http://localhost:${srv.address().port}`;
}

const browser = await chromium.launch({
  // --no-proxy-server: een systeemproxy mag de host-regels niet omzeilen.
  args: ['--no-proxy-server', `--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1, EXCLUDE cdnjs.cloudflare.com, EXCLUDE cdn.jsdelivr.net`],
});

async function nieuwContext({ sw, variant = 'na' }) {
  const context = await browser.newContext({
    baseURL: basis[variant], serviceWorkers: sw ? 'allow' : 'block', locale: 'nl-BE', timezoneId: 'Europe/Brussels',
    viewport: { width: 1280, height: 800 },
  });
  // Tweede laag naast --host-resolver-rules: elk verzoek buiten localhost en de twee CDN-hosts dat slaagt, wordt vastgelegd en laat de meting
  // falen. Bewust geen context.route: een route zet de HTTP-cache uit en vervalst het warme profiel.
  context.on('requestfinished', (req) => { // enkel geslaagde verzoeken: mislukte (NOTFOUND) verlieten de machine niet
    const host = new URL(req.url()).hostname;
    if (/^https?:$/.test(new URL(req.url()).protocol) && !TOEGESTAAN.includes(host)) vreemdeHosts.push(req.url());
  });
  await context.addInitScript(() => {
    if (window !== window.top) return;
    localStorage.setItem('blitz_rol', 'coordinator');
    localStorage.setItem('blitz_active_person', 'all');
  });
  return context;
}

// Eén bezoek meten: verzoeken, bytes en tijd tot "klaar".
async function bezoek(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  const lopend = new Map();
  let verzoeken = 0, bytes = 0;
  cdp.on('Network.requestWillBeSent', (e) => { verzoeken++; lopend.set(e.requestId, e.request.url); });
  cdp.on('Network.loadingFinished', (e) => { bytes += e.encodedDataLength || 0; });
  const t0 = Date.now();
  await page.goto('/', { waitUntil: 'commit' });
  await page.waitForFunction(() => window.kern && document.getElementById('cnt-tickets')?.textContent === '3', null, { timeout: 60000, polling: 'raf' });
  const klaarMs = await page.evaluate(() => Math.round(performance.now()));
  const wandMs = Date.now() - t0;
  await page.waitForLoadState('load');
  // Even laten uitrollen: late verzoeken (kaart, planning-sinds) horen bij het bezoek.
  await new Promise(r => setTimeout(r, 1500));
  await cdp.detach();
  return { verzoeken, kB: Math.round(bytes / 1024), klaarMs, wandMs };
}

async function meetProfiel(profiel, variant = 'na') {
  const sw = profiel === 'warm + SW';
  const context = await nieuwContext({ sw, variant });
  const page = await context.newPage();
  try {
    if (profiel === 'koud') return await bezoek(page);
    // Eerste bezoek zet de caches (en registreert de SW); wacht tot de SW de pagina bestuurt of activeert.
    await page.goto('/', { waitUntil: 'load' });
    await page.waitForFunction(() => window.kern && document.getElementById('cnt-tickets')?.textContent === '3', null, { timeout: 60000 });
    if (sw) {
      await page.evaluate(async () => { await navigator.serviceWorker.ready; });
      await new Promise(r => setTimeout(r, 2000)); // install/precache laten afronden
    }
    await page.close();
    const tweede = await context.newPage();
    return await bezoek(tweede);
  } finally {
    await context.close();
  }
}

// Parse- en evaluatietijd van rapport-wizard.js onder 4x CPU-vertraging (koude pagina, nadien gemeten).
async function meetWizardParse() {
  const context = await nieuwContext({ sw: false });
  const page = await context.newPage();
  try {
    await page.goto('/', { waitUntil: 'load' });
    await page.waitForFunction(() => window.kern && document.getElementById('cnt-tickets')?.textContent === '3', null, { timeout: 60000 });
    const grootte = (await page.evaluate(() => fetch('/js/rapport-wizard.js').then(r => r.text()))).length;
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const metingen = [];
    for (let i = 0; i < 5; i++) {
      // Nieuwe URL per meting = nieuwe module-instantie (wordt opnieuw gecompileerd en geëvalueerd).
      const ms = await page.evaluate(async (n) => {
        await fetch(`/js/rapport-wizard.js?m=${n}`).then(r => r.text()); // enkel ophalen; de tijd hieronder is parse + evaluatie
        const t = performance.now();
        await import(`/js/rapport-wizard.js?m=${n}`);
        return performance.now() - t;
      }, i);
      metingen.push(Math.round(ms));
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    metingen.sort((a, b) => a - b);
    return { grootteKB: Math.round(grootte / 1024), mediaanMs: metingen[2], metingen };
  } finally {
    await context.close();
  }
}

const rijen = [];
try {
  for (const v of VERTRAGINGEN) {
    vertraging = v;
    for (const profiel of ['koud', 'warm', 'warm + SW']) {
      // Afwisselend: even runs voor-dan-na, oneven runs na-dan-voor, zodat een trend in de belasting van de machine beide varianten raakt.
      const varianten = VOOR ? ['voor', 'na'] : ['na'];
      const metingen = { voor: [], na: [] };
      for (let i = 0; i < RUNS; i++) {
        for (const variant of (i % 2 ? [...varianten].reverse() : varianten)) metingen[variant].push(await meetProfiel(profiel, variant));
      }
      for (const variant of varianten) {
        const m = metingen[variant];
        rijen.push({
          'server (ms)': v, profiel, variant: VOOR ? variant : '-', runs: m.length,
          'verzoeken': mediaan(m.map(x => x.verzoeken)), 'kB': mediaan(m.map(x => x.kB)),
          'mediaan klaar (ms, performance.now)': mediaan(m.map(x => x.klaarMs)), 'mediaan klaar (ms, muurtijd)': mediaan(m.map(x => x.wandMs)),
          'alle muurtijden': m.map(x => x.wandMs).join(' '),
        });
      }
    }
  }
  vertraging = 0;
  const wizard = await meetWizardParse();
  if (vreemdeHosts.length) throw new Error('verzoeken naar niet-toegestane hosts: ' + [...new Set(vreemdeHosts)].join(', '));
  console.table(rijen);
  console.log(`rapport-wizard.js: ${wizard.grootteKB} kB, parse + evaluatie onder 4x CPU-vertraging: mediaan ${wizard.mediaanMs} ms (metingen ${wizard.metingen.join(', ')} ms)`);
  console.log(wizard.mediaanMs > 150 ? 'LET OP: boven 150 ms (vraag voor Brent, N2).' : 'Onder de 150 ms-grens (N2).');
} finally {
  await browser.close();
  for (const srv of Object.values(servers)) srv.close();
}
