// Snelheidsmeting van de Open dag-stijl (glas = backdrop-filter): is de app op een gsm trager geworden? Buiten de suites; draai met
//   node scripts/meet-snelheid.mjs [--voor=<map met public/ van de basis>] [--na=<map met public/>] [--runs=5] [--thema] [--url=<adres>]
// Zonder --voor wordt enkel de huidige public/ (of --na) gemeten. Met --voor draaien de runs AFWISSELEND (voor, na, na, voor, ...) in
// dezelfde sessie, zodat een trend in de belasting van de machine beide varianten raakt; de tabel toont de MEDIAAN en de spreiding.
//
// Opzet (gelijk voor alle varianten):
//  - Een eigen mini-server per variant op een vrije poort (public/ van die variant; elk /api-pad antwoordt 200 met {}; /api/themas enkel
//    met --thema), die aan het einde stopt. Geen backend, geen Zoho/TomTom/mail. Chromium met --host-resolver-rules (enkel localhost en de
//    twee CDN-hosts), zoals scripts/meet-laden.mjs. Met --url=<adres> wordt dat adres gemeten (geen eigen server, geen alternering).
//  - Een gsm: 375x812, schaalfactor 2, aanraking; localStorage `blitz_weergave = 'gsm'`; CDP `Emulation.setCPUThrottlingRate` rate 4; `?test`.
//  - De testdata (3 tickets) is te weinig om te scrollen: na de eerste lading zet het script 30 tickets in de wachtrij en 28 geplande
//    tickets over de werkweek (dezelfde 28 tonen Kalender en Ingepland) via kern.toestand (dezelfde render als bij echte data).
//  - Per run: tijd tot de eerste `.ticket` zichtbaar is (ms sinds navigatie, performance.now) en, per scherm (Wachtrij, Kalender, Ingepland),
//    tijdens 3 s heen-en-weer scrollen de som van de lange taken (PerformanceObserver `longtask`, ms) en het aantal beelden
//    (requestAnimationFrame-teller; meer is beter, 180 = 60 fps).
//  - --thema: de versiering staat aan (`?test&versiering=aan`) met een thema-scene (halloween, nepklok in de periode) uit een eigen
//    /api/themas-stub, zodat ook `.cal-day-hdr` en de lege staten op de scene meetellen.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import crypto from 'node:crypto';
import { chromium } from 'playwright-core';
import { maakDummyData } from '../public/js/kern/testdata.js';

const HIER = path.dirname(url.fileURLToPath(import.meta.url));
const arg = (naam) => process.argv.find(a => a === `--${naam}` || a.startsWith(`--${naam}=`));
const waarde = (naam) => arg(naam)?.split('=').slice(1).join('=');
const RUNS = Math.max(1, Number(waarde('runs') || 5));
const NA = waarde('na') ? path.resolve(waarde('na')) : path.join(HIER, '..', 'public');
const VOOR = waarde('voor') ? path.resolve(waarde('voor')) : null;
const EIGEN_URL = waarde('url') || null;
const THEMA = !!arg('thema');
const ALLEEN_LADEN = !!arg('laden'); // enkel de laadtijd (geen scrolmeting): voor veel runs achter elkaar

const EXTRA_CSS = waarde('css') || ''; // enkel voor proeven (bv. --css=":root{--blur:60px !important}"): extra stijl bovenop de pagina, in elke variant

const mediaan = (l) => { const t = [...l].sort((a, b) => a - b); const m = t.length >> 1; return t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2; };
const afr = (x, d = 0) => Number(x.toFixed(d));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg', '.webp': 'image/webp',
};
const TOEGESTAAN = ['localhost', '127.0.0.1', 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net'];
const vreemdeHosts = [];
const TICKETS = maakDummyData(Date.now());

// Eén thema voor --thema: een pakket uit netlify/themas (het is dezelfde bron die de server zaait).
function themaStub() {
  const bestanden = fs.readdirSync(path.join(HIER, '..', 'netlify', 'themas')).filter(f => /halloween.*\.blitzthema\.json$/.test(f));
  if (!bestanden.length) throw new Error('geen halloween-themapakket gevonden in netlify/themas');
  return JSON.parse(fs.readFileSync(path.join(HIER, '..', 'netlify', 'themas', bestanden[0]), 'utf8'));
}

function maakServer(publiek) {
  const pakket = THEMA ? themaStub() : null;
  return http.createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost');
    const pad = decodeURIComponent(u.pathname);
    if (pad.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      if (pad === '/api/tickets') return res.end(JSON.stringify(TICKETS));
      if (pad === '/api/auth-ik') return res.end(JSON.stringify({ gebruiker: { id: 'u-test', email: 'b@test.be', naam: 'Test Beheerder', rol: 'beheerder' }, rechten: { beheer: true, plannen: true, alleSales: true }, moetWachtwoordWijzigen: false, lokaleDev: false }));
      if (pad === '/api/themas') {
        if (u.searchParams.get('id') !== null) return res.end(JSON.stringify(pakket || {}));
        return res.end(JSON.stringify(pakket
          ? { versie: 1, themas: [{ id: pakket.id, naam: pakket.naam, aan: true, periode: pakket.periode, periodeOverride: null, pakketHash: 'meting' }], pakketten: { [pakket.id]: pakket } }
          : { versie: 1, themas: [], pakketten: {} }));
      }
      if (pad === '/api/planning-sinds') return res.end(JSON.stringify({}));
      return res.end('{}');
    }
    const bestand = path.normalize(path.join(publiek, pad === '/' ? 'index.html' : pad));
    if (bestand !== publiek && !bestand.startsWith(publiek + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(bestand, (err, data) => {
      if (err) { res.writeHead(404); return res.end('niet gevonden'); }
      const etag = '"' + crypto.createHash('sha1').update(data).digest('hex') + '"';
      const koppen = { 'Content-Type': MIME[path.extname(bestand)] || 'application/octet-stream', ETag: etag, 'Cache-Control': 'public,max-age=0,must-revalidate' };
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, koppen); return res.end(); }
      res.writeHead(200, koppen);
      res.end(data);
    });
  });
}

const servers = {};
const basis = {};
if (EIGEN_URL) basis.url = EIGEN_URL.replace(/\/$/, '');
else {
  servers.na = maakServer(NA);
  if (VOOR) servers.voor = maakServer(VOOR);
  for (const [naam, srv] of Object.entries(servers)) {
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    basis[naam] = `http://localhost:${srv.address().port}`;
  }
}

const browser = await chromium.launch({
  args: ['--no-proxy-server', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1, EXCLUDE cdnjs.cloudflare.com, EXCLUDE cdn.jsdelivr.net'],
});

// De extra gegevens: 30 tickets in de wachtrij en 28 geplande tickets verdeeld over de werkweek (dezelfde 28 voor Kalender en Ingepland).
function vulData() {
  const { toestand } = window.kern;
  const sjabloon = toestand.get('allTickets')[0];
  const nu = new Date();
  const dag = (n) => { const d = new Date(nu); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + n); return d; };
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const prios = ['high', 'medium', 'low'];
  const wachtrij = Array.from({ length: 30 }, (_, i) => ({
    ...sjabloon, id: `m${i}`, number: String(2000 + i), priority: prios[i % 3], subject: `Meetticket ${i}: laadpaal geeft foutcode en reageert niet`,
    interventieDatum: i % 4 === 0 ? new Date(nu.getTime() - (i + 1) * 86400000).toISOString() : null,
    inPlanningSinds: new Date(nu.getTime() - (i % 28) * 86400000).toISOString(),
  }));
  const gepland = [];
  const planning = {};
  for (let i = 0; i < 28; i++) {
    const d = dag(i % 5);
    d.setHours(8 + (i % 4) * 2, 0, 0, 0);
    const t = { ...sjabloon, id: `g${i}`, number: String(3000 + i), priority: prios[i % 3], status: 'Geplande service', subject: `Gepland meetticket ${i}`, interventieDatum: d.toISOString(), inPlanningSinds: null };
    gepland.push(t);
    (planning[iso(d)] ||= []).push({ ticket: t, address: t.address, uur: `${String(d.getHours()).padStart(2, '0')}:00` });
  }
  toestand.transactie(() => {
    toestand.set('allTickets', wachtrij);
    toestand.set('allGepland', gepland);
    toestand.set('planning', planning);
  });
  return { wachtrij: wachtrij.length, gepland: gepland.length };
}

// Eén scherm 3 s heen-en-weer scrollen; geeft de som van de lange taken (ms), het aantal ervan en het aantal beelden.
async function meetScroll(page, cdp) {
  await page.evaluate(() => {
    window.__lt = []; window.__beelden = 0; window.__scroll = 0; window.scrollTo(0, 0);
    if (!window.__ltObs) { window.__ltObs = new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); }); window.__ltObs.observe({ type: 'longtask', buffered: false }); }
    document.addEventListener('scroll', () => { window.__scroll++; }, { capture: true, passive: true });
    const tel = () => { window.__beelden++; window.__raf = requestAnimationFrame(tel); };
    window.__raf = requestAnimationFrame(tel);
  });
  await page.mouse.move(187, 500);
  await new Promise(r => setTimeout(r, 300)); // eventuele opbouw van het scherm laten uitrollen
  await page.evaluate(() => { window.__lt.length = 0; window.__beelden = 0; window.__scroll = 0; });
  // Vaste snelheid van 1200 px/s (een flinke veeg), elke seconde van richting wisselen: de afgelegde weg is dan onafhankelijk van hoe vlot
  // de pagina tekent (anders zou een tragere variant ook minder ver scrollen).
  const t0 = Date.now();
  let vorige = t0, stap = 0;
  while (Date.now() - t0 < 3000) {
    await new Promise(r => setTimeout(r, 12));
    const nu = Date.now(), richting = Math.floor((nu - t0) / 1000) % 2 ? -1 : 1;
    await page.mouse.wheel(0, richting * 1.2 * (nu - vorige));
    vorige = nu; stap++;
  }
  const res = await page.evaluate(() => { cancelAnimationFrame(window.__raf); return { lt: window.__lt.slice(), beelden: window.__beelden, scroll: window.__scroll, y: Math.round(scrollY) }; });
  if (process.env.MEET_DIAG) console.log('scrollY na afloop', res.y, 'gebaren', stap);
  return { ltMs: res.lt.reduce((a, b) => a + b, 0), ltAantal: res.lt.length, beelden: res.beelden, scrollEvents: res.scroll };
}

async function meetRun(variant) {
  const context = await browser.newContext({
    baseURL: basis[variant], serviceWorkers: 'block', locale: 'nl-BE', timezoneId: 'Europe/Brussels',
    viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  });
  context.on('requestfinished', (req) => {
    const host = new URL(req.url()).hostname;
    if (/^https?:$/.test(new URL(req.url()).protocol) && !TOEGESTAAN.includes(host)) vreemdeHosts.push(req.url());
  });
  await context.addInitScript(() => {
    if (window !== window.top) return;
    localStorage.setItem('blitz_rol', 'coordinator');
    localStorage.setItem('blitz_active_person', 'all');
    localStorage.setItem('blitz_weergave', 'gsm');
    localStorage.setItem('blitz_theme', 'dark');
  });
  if (EXTRA_CSS) await context.addInitScript((css) => { if (window !== window.top) return; document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = css; document.head.append(st); }); }, EXTRA_CSS);
  const page = await context.newPage();
  try {
    if (THEMA) await page.clock.install({ time: new Date(`${new Date().getFullYear()}-10-28T10:00:00`) }); // binnen de periode van Halloween
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.goto('/' + (THEMA ? '?test&versiering=aan' : '?test'), { waitUntil: 'commit' });
    await page.waitForFunction(() => { const t = document.querySelector('.ticket'); return !!t && t.getBoundingClientRect().height > 0; }, null, { timeout: 90000, polling: 'raf' });
    const eersteTicketMs = await page.evaluate(() => Math.round(performance.now()));
    await page.waitForFunction(() => window.kern && document.getElementById('cnt-tickets')?.textContent === '3', null, { timeout: 90000 });
    const info = await page.evaluate(`(${vulData.toString()})()`);
    if (THEMA) {
      await page.waitForFunction(() => document.documentElement.dataset.eventAchtergrond === 'ja', null, { timeout: 30000 });
    }
    await new Promise(r => setTimeout(r, 1500)); // tickets tekenen, de laatste verzoeken laten uitrollen
    const apparaat = await page.evaluate(() => ({ app: document.documentElement.dataset.apparaat, achtergrond: document.documentElement.dataset.eventAchtergrond || '-', blur: getComputedStyle(document.documentElement).getPropertyValue('--blur').trim(), tickets: document.querySelectorAll('#ticket-list .ticket').length, kaartFilter: getComputedStyle(document.querySelector('#ticket-list .ticket')).backdropFilter }));
    if (apparaat.app !== 'gsm') throw new Error(`geen gsm-weergave (${apparaat.app})`);
    const schermen = {};
    for (const [naam, tab] of ALLEEN_LADEN ? [] : [['wachtrij', null], ['kalender', '#tab-kalender'], ['ingepland', '#tab-gepland']]) {
      if (tab) { await page.click(tab); await new Promise(r => setTimeout(r, 500)); }
      if (!process.env.MEET_DIAG) { /* geen diagnose */ } else console.log(naam, JSON.stringify(await page.evaluate(() => { const o = []; for (const el of document.querySelectorAll('*')) { const cs = getComputedStyle(el); if (el.scrollHeight > el.clientHeight + 5 && /auto|scroll/.test(cs.overflowY)) o.push(`${el.tagName}#${el.id}.${el.className} ${el.scrollHeight}/${el.clientHeight}`); } return { o, doc: `${document.scrollingElement.scrollHeight}/${innerHeight}` }; })));
      schermen[naam] = await meetScroll(page, cdp);
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    return { eersteTicketMs, schermen, apparaat, info };
  } finally {
    await context.close();
  }
}

const varianten = EIGEN_URL ? ['url'] : VOOR ? ['voor', 'na'] : ['na'];
const runs = Object.fromEntries(varianten.map(v => [v, []]));
try {
  for (let i = 0; i < RUNS; i++) {
    for (const v of (i % 2 ? [...varianten].reverse() : varianten)) {
      const r = await meetRun(v);
      runs[v].push(r);
      console.log(`run ${i + 1}/${RUNS} ${v}: eerste ticket ${r.eersteTicketMs} ms | ` + Object.entries(r.schermen).map(([n, s]) => `${n} lt ${afr(s.ltMs)} ms/${s.ltAantal}x, ${s.beelden} beelden (${s.scrollEvents} scrolls)`).join(' | '));
    }
  }
  if (vreemdeHosts.length) throw new Error('verzoeken naar niet-toegestane hosts: ' + [...new Set(vreemdeHosts)].join(', '));
  const kolommen = [
    ['eerste ticket (ms)', r => r.eersteTicketMs],
    ...(ALLEEN_LADEN ? [] : ['wachtrij', 'kalender', 'ingepland']).flatMap(n => [
      [`${n}: lange taken (ms)`, r => r.schermen[n].ltMs],
      [`${n}: beelden in 3 s`, r => r.schermen[n].beelden],
    ]),
  ];
  const rijen = [];
  for (const [naam, f] of kolommen) {
    const rij = { cijfer: naam };
    for (const v of varianten) { const w = runs[v].map(f); rij[v] = afr(mediaan(w), 1); rij[`${v} (min-max)`] = `${afr(Math.min(...w), 1)}-${afr(Math.max(...w), 1)}`; }
    if (VOOR) { const a = rij.voor, b = rij.na; rij['verschil'] = a ? `${afr((b - a) / a * 100, 1)} %` : 'n.v.t.'; }
    rijen.push(rij);
  }
  console.log(`modus: ${THEMA ? 'thema-scene (halloween)' : 'hemel'}, ${RUNS} runs per variant, gsm 375x812 @2x, CPU 4x trager, ${JSON.stringify(runs[varianten[0]][0].info)}`);
  console.log(`weergave eerste run: ${JSON.stringify(runs[varianten[0]][0].apparaat)}`);
  console.table(rijen);
} finally {
  await browser.close();
  for (const srv of Object.values(servers)) srv.close();
}
