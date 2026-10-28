// Interactiemeting: hoe vlot voelt de app tijdens gebruik (tabwissels, weekwissel, ticketdetail), hoeveel geheugen houdt hij vast na
// een korte sessie en hoeveel foutmeldingen geeft hij? Buiten de suites; draai met
//   node scripts/meet-interactie.mjs [--na=<map met public/>] [--voor=<map met public/>] [--runs=5] [--profiel=desktop,telefoon] [--json=<bestand>]
// Zonder --na wordt de public/ van deze checkout gemeten; met --voor draaien de runs AFWISSELEND (voor, na, na, voor, ...) in dezelfde
// sessie, zodat een trend in de belasting van de machine beide varianten raakt. Tabel en JSON tonen de MEDIAAN en de spreiding (min-max).
//
// Opzet (gelijk voor alle varianten, zoals scripts/meet-laden.mjs en scripts/meet-snelheid.mjs):
//  - Een eigen mini-server per variant op een vrije poort (public/ van die variant) met enkel /api-stubs (geen backend, geen Zoho/TomTom/mail;
//    de antwoordvormen komen uit e2e/helpers.mjs en e2e/fixtures, zodat de app geen fouten geeft op een leeg antwoord). Chromium met
//    --host-resolver-rules (enkel localhost en de twee CDN-hosts). `?test`, rol coordinator (de standaard planner), ingelogd als beheerder.
//  - Twee profielen: `desktop` (1440x900) en `telefoon` (375x812 @2x, aanraking, `blitz_weergave = 'gsm'`, CPU 4x trager).
//  - Vaste klok: een init-script verschuift enkel `Date` (maandag 5 oktober 2026, 09:00 Brussel, daarna loopt de tijd gewoon door); timers,
//    requestAnimationFrame en performance.now blijven echt (page.clock zou die ook nepper maken en de meting vervalsen).
//  - Gegevens: na de lading zet het script 30 tickets in de wachtrij en 28 geplande tickets over de werkweek via kern.toestand (zoals
//    meet-snelheid.mjs; dezelfde 28 tonen Kalender, Ingepland en Route).
//  - De sessie (29 handelingen, 26 op de telefoon want daar is er geen Route-tab; vast en identiek per run):
//      ronde 1: Kalender, Route*, Ingepland, Inventaris, Rapporten, Wachtrij (eerste bezoek aan elk tabblad)
//      Kalender, dan 6 weekwissels (volgende week = leeg, terug = de volle week), 2x een ticket openen vanuit de Kalender (en sluiten)
//      ronde 2: Wachtrij, 2x een ticket openen vanuit de Wachtrij, Kalender, Route*, Ingepland, Inventaris, Rapporten
//      ronde 3: Kalender, Route*, Ingepland, Inventaris, Rapporten, Wachtrij        (* enkel desktop)
//  - Een tabwissel / weekwissel / detail is klaar als de render van dat scherm gebeurd is (tellers `kern.<scherm>.renderTelling()` of een
//    DOM-mutatie in de container van het scherm) en daarna het volgende beeld getekend is; de tijd loopt in de pagina zelf
//    (performance.now) vanaf de klik. De tijd is "klik tot getekend" (bij 4x CPU-vertraging op de telefoon).
//  - Lange taken: PerformanceObserver `longtask` vanaf het begin van de pagina (lading en sessie samen en enkel de sessie).
//  - Geheugen: `HeapProfiler.collectGarbage` en dan `Runtime.getHeapUsage` (usedSize) na de lading en na de sessie.
//  - Console: alle `console.error`, `console.warning` en `pageerror` vanaf de navigatie; meldingen over geblokkeerde externe hosts (de
//    host-regels blokkeren ze met opzet: Google Fonts, kaarttegels) en de bekende testruis van de geblokkeerde service worker staan apart en
//    tellen niet mee als appfout; de JSON bevat de ruwe meldingen van de eerste run.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { maakDummyData } from '../public/js/kern/testdata.js';

const HIER = path.dirname(url.fileURLToPath(import.meta.url));
const arg = (naam) => process.argv.find(a => a.startsWith(`--${naam}=`))?.slice(naam.length + 3);
const RUNS = Math.max(1, Number(arg('runs') || 5));
const NA = arg('na') ? path.resolve(arg('na')) : path.join(HIER, '..', 'public');
const VOOR = arg('voor') ? path.resolve(arg('voor')) : null;
const JSON_UIT = arg('json') ? path.resolve(arg('json')) : null;
const PROFIELEN = (arg('profiel') || 'desktop,telefoon').split(',');
const VASTE_NU = '2026-10-05T09:00:00+02:00'; // maandag, Europe/Brussels (zoals e2e/helpers.mjs)
const START = Date.now();

const mediaan = (l) => { const t = [...l].sort((a, b) => a - b); const m = t.length >> 1; return t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2; };
const afr = (x, d = 0) => Number(x.toFixed(d));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg', '.webp': 'image/webp',
};
const TOEGESTAAN = ['localhost', '127.0.0.1', 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net'];
const vreemdeHosts = [];
const TICKETS = maakDummyData(Date.parse(VASTE_NU));
const fixture = (naam) => JSON.parse(fs.readFileSync(path.join(HIER, '..', 'e2e', 'fixtures', naam), 'utf8'));
const FIX = { matrix: fixture('matrix.json'), route: fixture('route.json'), optimize: fixture('optimize.json'), drukte: fixture('drukte.json'), planningSinds: fixture('planning-sinds.json') };

// De /api-stubs: dezelfde vormen als maakStandaardStubs() in e2e/helpers.mjs (leeg waar het kan), zodat de app niet struikelt over een kaal `{}`.
function stub(pad, methode, body, query) {
  const naam = pad.replace(/^\/api\//, '');
  const ok = { ok: true, versie: 1 };
  switch (naam) {
    case 'tickets': return TICKETS;
    case 'auth-ik': return { gebruiker: { id: 'u-test', email: 'b@test.be', naam: 'Test Beheerder', rol: 'beheerder' }, rechten: { beheer: true, plannen: true, alleSales: true }, moetWachtwoordWijzigen: false, lokaleDev: false };
    case 'afspraken': return methode === 'GET' ? { versie: 0, afspraken: [] } : ok;
    case 'availability': return methode === 'GET' ? { versie: 0, exceptions: [] } : ok;
    case 'klantbeschikbaarheid': return methode === 'GET' ? { versie: 0, items: {} } : ok;
    case 'voorstel-status': return methode === 'GET' ? { versie: 0, status: {} } : ok;
    case 'rapport-archief': return methode === 'GET' ? { versie: 0, rapports: [] } : ok;
    case 'inventaris': return { versie: 0, wagenvoorraad: {}, log: [] };
    case 'prijzen': return { versie: 1, bijgewerkt: '2026-10-05T07:00:00.000Z', onderdelen: [], tarieven: [] };
    case 'fotos': return { versie: 0, fotos: [] };
    case 'planning-sinds': return FIX.planningSinds;
    case 'themas': return query.get('id') !== null ? {} : { versie: 1, themas: [], pakketten: {} };
    case 'spel': return { besteScore: 0, ontgrendeld: ['blitz'], gekozenSkin: 'blitz' };
    case 'instellingen': return methode === 'GET' ? { eigen: { gebruikerId: 'u-test', versie: 0, instellingen: null }, techniekers: {} } : { versie: 1 };
    case 'gebruikers': return { gebruikers: [] };
    case 'zoho-agenten': return { agenten: [{ naam: 'Roel' }, { naam: 'Sven Peeters' }, { naam: 'Tim' }] };
    case 'matrix': return { results: (body?.destinations || []).map(() => ({ ...FIX.matrix.cel })) };
    case 'drukte': return FIX.drukte;
    case 'optimize': {
      const stops = body?.stops || [];
      const { vertrek, stapLat, stapLon } = FIX.optimize;
      return { locations: [vertrek, ...stops.map((_, i) => ({ lat: +(vertrek.lat + (i + 1) * stapLat).toFixed(5), lon: +(vertrek.lon + (i + 1) * stapLon).toFixed(5) }))], optimizedOrder: stops.map((_, i) => i) };
    }
    case 'route': {
      const wps = body?.waypoints || [];
      const legs = Array.from({ length: Math.max(0, wps.length - 1) }, () => ({ ...FIX.route.been, pointCount: 2 }));
      const som = (veld) => legs.reduce((t, l) => t + l[veld], 0);
      return {
        totalTravelTimeSeconds: som('travelTimeSeconds'), totalDistanceMeters: som('distanceMeters'), totalTrafficDelaySeconds: som('trafficDelaySeconds'),
        totalNoTrafficTravelTimeSeconds: som('noTrafficTravelTimeSeconds'), totalHistoricTrafficTravelTimeSeconds: som('historicTrafficTravelTimeSeconds'),
        arrivalTime: null, departureTime: body?.departAt || null, legs, sections: [], departAtUsed: body?.departAt || null, polyline: wps.map(w => [w.lat, w.lon]),
      };
    }
    default: return methode === 'GET' ? {} : ok;
  }
}

function maakServer(publiek) {
  return http.createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost');
    const pad = decodeURIComponent(u.pathname);
    if (pad.startsWith('/api/')) {
      const delen = [];
      req.on('data', d => delen.push(d));
      req.on('end', () => {
        let body = null;
        try { body = JSON.parse(Buffer.concat(delen).toString() || 'null'); } catch { body = null; }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(stub(pad, req.method, body, u.searchParams)));
      });
      return;
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

const servers = { na: maakServer(NA) };
if (VOOR) servers.voor = maakServer(VOOR);
const basis = {};
for (const [naam, srv] of Object.entries(servers)) {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  basis[naam] = `http://localhost:${srv.address().port}`;
}

const browser = await chromium.launch({
  args: ['--no-proxy-server', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1, EXCLUDE cdnjs.cloudflare.com, EXCLUDE cdn.jsdelivr.net'],
});

// ── Init-script (in elke pagina, enkel het hoofdvenster): vaste klok, lange taken en de meethulp `window.__meet` ──
function installeerMeet({ vastNu }) {
  if (window !== window.top) return;
  // Vaste klok: enkel `Date` verschuiven (nu = vastNu + verstreken echte tijd); timers en performance.now blijven echt.
  const Echt = Date, verschil = Echt.parse(vastNu) - Echt.now();
  window.Date = class extends Echt {
    constructor(...a) { if (a.length === 0) super(Echt.now() + verschil); else super(...a); }
    static now() { return Echt.now() + verschil; }
  };
  window.__lt = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push({ start: e.startTime, duur: e.duration }); }).observe({ type: 'longtask', buffered: true }); } catch { /* geen longtask */ }

  const teken = () => new Promise(r => requestAnimationFrame(() => { const k = new MessageChannel(); k.port1.onmessage = () => r(performance.now()); k.port2.postMessage(0); }));
  const zichtbaar = (el) => !!el && el.getClientRects().length > 0;
  // Wacht tot `klaar()` waar is; gecontroleerd bij elke DOM-mutatie in `wortels` (en direct). null bij een time-out.
  const wacht = (wortels, klaar, max) => new Promise(res => {
    let gedaan = false;
    const af = (w) => { if (gedaan) return; gedaan = true; mo.disconnect(); clearTimeout(id); res(w); };
    const mo = new MutationObserver(() => { if (klaar()) af(true); });
    for (const w of wortels) mo.observe(w, { childList: true, subtree: true, characterData: true, attributes: true });
    const id = setTimeout(() => af(false), max);
    if (klaar()) af(true);
  });
  const tel = {
    tickets: () => window.kern.wachtrij.renderTelling(), kalender: () => window.kern.kalender.renderTelling(),
    gepland: () => window.kern.ingepland.renderTelling(), planning: () => window.kern.route.renderTelling(),
  };
  const view = (tab) => document.getElementById('view-' + tab);
  const container = { tickets: '#ticket-list', kalender: '#week-grid', planning: '#route-list', gepland: '#gep-body', inventaris: '#inventaris-body', rapporten: '#rapp-archief-body' };
  const bezocht = new Set(['tickets']);

  window.__meet = {
    sessieStart: null,
    // Tabwissel: klik op het tabblad tot het scherm getekend is.
    async tab(naam) {
      const el = document.getElementById('tab-' + naam);
      const cont = document.querySelector(container[naam]);
      const eerste = !bezocht.has(naam); bezocht.add(naam);
      const voor = tel[naam] ? tel[naam]() : 0;
      let klaar;
      if (naam === 'kalender' || naam === 'gepland') klaar = () => view(naam).classList.contains('active') && tel[naam]() > voor;
      else if (naam === 'inventaris' || naam === 'rapporten') klaar = () => view(naam).classList.contains('active') && !/Laden/.test(cont.textContent) && cont.children.length > 0 && gemuteerd;
      else if (naam === 'planning' && eerste) klaar = () => view(naam).classList.contains('active') && gemuteerd;
      else klaar = () => view(naam).classList.contains('active');
      let gemuteerd = false;
      const mo = new MutationObserver(() => { gemuteerd = true; }); mo.observe(cont, { childList: true, subtree: true, characterData: true });
      const t0 = performance.now();
      el.click();
      const gelukt = await wacht([view(naam)], klaar, 4000);
      const t1 = await teken();
      mo.disconnect();
      return { ms: t1 - t0, gelukt, eerste };
    },
    // Weekwissel in de Kalender: klik op ‹ of › tot het weeglabel veranderd en de kalender opnieuw getekend is.
    async week(richting) {
      const knop = document.querySelector(`.kal-nav[data-arg="${richting}"]`);
      const label = document.getElementById('kal-label-tekst'), oud = label.textContent, voor = tel.kalender();
      const t0 = performance.now();
      knop.click();
      const gelukt = await wacht([view('kalender')], () => tel.kalender() > voor && label.textContent !== oud, 4000);
      const t1 = await teken();
      return { ms: t1 - t0, gelukt, kaarten: document.querySelectorAll('#week-grid .cal-ticket').length };
    },
    // Ticketdetail openen (de eerste zichtbare kaart van de Wachtrij of de Kalender) tot het venster getekend is.
    async detail(bron) {
      const kaart = [...document.querySelectorAll(bron === 'kalender' ? '#week-grid .cal-ticket' : '#ticket-list .ticket')].find(zichtbaar);
      if (!kaart) return { ms: null, gelukt: false };
      const ov = document.getElementById('det-overlay');
      const t0 = performance.now();
      kaart.click();
      const gelukt = await wacht([ov], () => ov.classList.contains('open') && document.getElementById('d-num').textContent !== '', 4000);
      const t1 = await teken();
      return { ms: t1 - t0, gelukt };
    },
    start() { this.sessieStart = performance.now(); },
    eind() {
      const lt = window.__lt, s = this.sessieStart ?? 0;
      const sessie = lt.filter(e => e.start >= s), laden = lt.filter(e => e.start < s);
      const max = (l) => l.reduce((m, e) => Math.max(m, e.duur), 0), som = (l) => l.reduce((t, e) => t + e.duur, 0);
      return { sessie: { max: max(sessie), aantal: sessie.length, som: som(sessie) }, laden: { max: max(laden), aantal: laden.length, som: som(laden) } };
    },
  };
}

// De extra gegevens (zoals meet-snelheid.mjs): 30 tickets in de wachtrij en 28 geplande tickets verdeeld over de werkweek.
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

const PROFIEL = {
  desktop: { viewport: { width: 1440, height: 900 }, cpu: 1, telefoon: false },
  telefoon: { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, cpu: 4, telefoon: true },
};
const BLAD_NAMEN = ['kalender', 'planning', 'gepland', 'inventaris', 'rapporten', 'tickets'];

async function heap(cdp) {
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.collectGarbage');
  const h = await cdp.send('Runtime.getHeapUsage');
  return Math.round(h.usedSize / 1024) / 1024; // MB
}
const pauze = (ms) => new Promise(r => setTimeout(r, ms));

async function meetRun(profielNaam, variant) {
  const p = PROFIEL[profielNaam];
  const { cpu, telefoon, ...opties } = p;
  const context = await browser.newContext({ baseURL: basis[variant], serviceWorkers: 'block', locale: 'nl-BE', timezoneId: 'Europe/Brussels', ...opties });
  context.on('requestfinished', (req) => {
    const host = new URL(req.url()).hostname;
    if (/^https?:$/.test(new URL(req.url()).protocol) && !TOEGESTAAN.includes(host)) vreemdeHosts.push(req.url());
  });
  await context.addInitScript(({ telefoon }) => {
    if (window !== window.top) return;
    const zet = (k, v) => { if (localStorage.getItem(k) === null) localStorage.setItem(k, v); };
    zet('blitz_rol', 'coordinator'); zet('blitz_active_person', 'all'); zet('blitz_eigenaar', 'u-test'); zet('blitz_theme', 'dark');
    if (telefoon) zet('blitz_weergave', 'gsm');
  }, { telefoon });
  await context.addInitScript(installeerMeet, { vastNu: VASTE_NU });
  const page = await context.newPage();

  const berichten = [];
  const noteer = (soort, tekst, plek) => berichten.push({ soort, tekst: tekst.slice(0, 300), plek: plek || '' });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') noteer(m.type(), m.text(), m.location().url); });
  page.on('pageerror', (e) => noteer('pageerror', e.message));

  try {
    const cdp = await context.newCDPSession(page);
    await cdp.send('HeapProfiler.enable');
    if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
    await page.goto('/?test', { waitUntil: 'commit' });
    await page.waitForFunction(() => { const t = document.querySelector('.ticket'); return !!t && t.getBoundingClientRect().height > 0; }, null, { timeout: 90000, polling: 'raf' });
    await page.waitForFunction(() => window.kern && document.getElementById('cnt-tickets')?.textContent === '3', null, { timeout: 90000 });
    const info = await page.evaluate(`(${vulData.toString()})()`);
    await page.waitForFunction(() => document.getElementById('cnt-tickets')?.textContent === '30' && document.querySelectorAll('#ticket-list .ticket').length === 30, null, { timeout: 30000 });
    await pauze(1500); // de laatste verzoeken en renders laten uitrollen
    const apparaat = await page.evaluate(() => ({ app: document.documentElement.dataset.apparaat, nav: document.documentElement.dataset.nav, route: !!document.getElementById('tab-planning')?.getClientRects().length }));
    if (telefoon && apparaat.app !== 'gsm') throw new Error(`geen gsm-weergave (${apparaat.app})`);
    const heapNaLaden = await heap(cdp);

    // ── De sessie ──
    await page.evaluate(() => window.__meet.start());
    const stappen = []; // { stap, soort, naam, ms, gelukt }
    const doe = async (soort, naam, uitvoer) => { const r = await uitvoer(); stappen.push({ soort, naam, ...r }); await pauze(250); return r; };
    const tab = (naam) => doe('tab', naam, () => page.evaluate((n) => window.__meet.tab(n), naam));
    const week = (richting) => doe('week', richting > 0 ? 'volgende' : 'vorige', () => page.evaluate((r) => window.__meet.week(r), richting));
    const detail = async (bron) => {
      await doe('detail', bron, () => page.evaluate((b) => window.__meet.detail(b), bron));
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.getElementById('det-overlay').classList.contains('open'), null, { timeout: 5000 });
      await pauze(150);
    };
    const ronde = async (volgorde) => { for (const n of volgorde) if (n !== 'planning' || !telefoon) await tab(n); };

    await ronde(BLAD_NAMEN);                          // ronde 1 (eerste bezoek)
    await tab('kalender');
    for (let i = 0; i < 3; i++) { await week(1); await week(-1); } // 3x naar de lege volgende week en terug naar de volle week
    await detail('kalender'); await detail('kalender');
    await tab('tickets');                              // ronde 2 start in de Wachtrij
    await detail('tickets'); await detail('tickets');
    await ronde(['kalender', 'planning', 'gepland', 'inventaris', 'rapporten']);
    await ronde(BLAD_NAMEN);                          // ronde 3
    await pauze(500);

    const lt = await page.evaluate(() => window.__meet.eind());
    const heapNaSessie = await heap(cdp);
    if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

    // ── Cijfers ──
    const metrics = {};
    const nul = stappen.filter(s => !s.gelukt);
    const zet = (naam, waarden) => { const w = waarden.filter(x => typeof x === 'number'); if (w.length) metrics[naam] = afr(mediaan(w), 1); };
    for (const naam of BLAD_NAMEN) {
      const bezoeken = stappen.filter(s => s.soort === 'tab' && s.naam === naam);
      const eerste = bezoeken.filter(s => s.eerste), herhaald = bezoeken.filter(s => !s.eerste);
      if (eerste.length) zet(`tab ${naam}: eerste bezoek (ms)`, eerste.map(s => s.ms));
      if (herhaald.length) zet(`tab ${naam}: herhaald bezoek (ms)`, herhaald.map(s => s.ms));
    }
    zet('week: naar de lege volgende week (ms)', stappen.filter(s => s.soort === 'week' && s.naam === 'volgende').map(s => s.ms));
    zet('week: terug naar de volle week (ms)', stappen.filter(s => s.soort === 'week' && s.naam === 'vorige').map(s => s.ms));
    zet('ticketdetail openen vanuit Wachtrij (ms)', stappen.filter(s => s.soort === 'detail' && s.naam === 'tickets').map(s => s.ms));
    zet('ticketdetail openen vanuit Kalender (ms)', stappen.filter(s => s.soort === 'detail' && s.naam === 'kalender').map(s => s.ms));
    metrics['langste lange taak in de sessie (ms)'] = afr(lt.sessie.max, 1);
    metrics['langste lange taak, lading + sessie (ms)'] = afr(Math.max(lt.sessie.max, lt.laden.max), 1);
    metrics['aantal lange taken in de sessie'] = lt.sessie.aantal;
    metrics['som lange taken in de sessie (ms)'] = afr(lt.sessie.som, 0);
    metrics['geheugen na laden (MB)'] = afr(heapNaLaden, 1);
    metrics['geheugen na sessie (MB)'] = afr(heapNaSessie, 1);
    metrics['geheugengroei in de sessie (MB)'] = afr(heapNaSessie - heapNaLaden, 1);
    // Bekende testruis (zie TOEGESTANE_CONSOLERUIS in e2e/helpers.mjs): met serviceWorkers 'block' leest de app navigator.serviceWorker ook in het
    // sandbox-iframe #annuleer-frame en meldt Playwright de geblokkeerde registratie. Geen fout van de app; telt apart.
    const testruis = (b) => /Service worker is disabled because the context is sandboxed|Service Worker registration blocked by Playwright/.test(b.tekst);
    const extern = (b) => /ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION_REFUSED/.test(b.tekst) && !b.plek.startsWith(basis[variant]);
    const app = berichten.filter(b => !extern(b) && !testruis(b));
    metrics['console: fouten van de app'] = app.filter(b => b.soort === 'error' || b.soort === 'pageerror').length;
    metrics['console: waarschuwingen van de app'] = app.filter(b => b.soort === 'warning').length;
    metrics['console: geblokkeerde externe hosts'] = berichten.filter(extern).length;
    metrics['console: bekende testruis (service worker)'] = berichten.filter(b => !extern(b) && testruis(b)).length;
    metrics['handelingen in de sessie'] = stappen.length;
    metrics['handelingen die niet klaar raakten (time-out)'] = nul.length;
    return { metrics, stappen, berichten, info, apparaat, heapNaLaden, heapNaSessie };
  } finally {
    await context.close();
  }
}

const varianten = VOOR ? ['voor', 'na'] : ['na'];
const resultaat = {};
try {
  for (const profiel of PROFIELEN) {
    if (!PROFIEL[profiel]) throw new Error(`onbekend profiel ${profiel}`);
    resultaat[profiel] = Object.fromEntries(varianten.map(v => [v, []]));
    for (let i = 0; i < RUNS; i++) {
      for (const v of (i % 2 ? [...varianten].reverse() : varianten)) {
        const r = await meetRun(profiel, v);
        resultaat[profiel][v].push(r);
        const m = r.metrics;
        console.log(`${profiel} run ${i + 1}/${RUNS} ${v}: ${m['handelingen in de sessie']} handelingen (${m['handelingen die niet klaar raakten (time-out)']} time-out) | kalender ${m['tab kalender: eerste bezoek (ms)']} ms, week terug ${m['week: terug naar de volle week (ms)']} ms, detail ${m['ticketdetail openen vanuit Wachtrij (ms)']} ms | langste taak ${m['langste lange taak in de sessie (ms)']} ms | heap ${m['geheugen na sessie (MB)']} MB | fouten ${m['console: fouten van de app']}, waarschuwingen ${m['console: waarschuwingen van de app']}`);
      }
    }
  }
  if (vreemdeHosts.length) throw new Error('verzoeken naar niet-toegestane hosts: ' + [...new Set(vreemdeHosts)].join(', '));

  const samenvatting = {};
  for (const profiel of PROFIELEN) {
    samenvatting[profiel] = {};
    const rijen = [];
    const namen = [...new Set(varianten.flatMap(v => resultaat[profiel][v].flatMap(r => Object.keys(r.metrics))))];
    for (const naam of namen) {
      const rij = { cijfer: naam };
      for (const v of varianten) {
        const w = resultaat[profiel][v].map(r => r.metrics[naam]).filter(x => typeof x === 'number');
        if (!w.length) { rij[v] = 'n.v.t.'; continue; }
        const s = { mediaan: afr(mediaan(w), 1), min: afr(Math.min(...w), 1), max: afr(Math.max(...w), 1), runs: w.length };
        (samenvatting[profiel][v] ||= {})[naam] = s;
        rij[v] = s.mediaan; rij[`${v} (min-max)`] = `${s.min}-${s.max}`;
      }
      if (VOOR && typeof rij.voor === 'number' && typeof rij.na === 'number') rij.verschil = rij.voor ? `${afr((rij.na - rij.voor) / rij.voor * 100, 1)} %` : 'n.v.t.';
      rijen.push(rij);
    }
    const eerste = resultaat[profiel][varianten[0]][0];
    console.log(`\nprofiel ${profiel}: ${RUNS} runs per variant, ${JSON.stringify(PROFIEL[profiel].viewport)}${PROFIEL[profiel].cpu > 1 ? `, CPU ${PROFIEL[profiel].cpu}x trager` : ''}, ${JSON.stringify(eerste.info)}, ${JSON.stringify(eerste.apparaat)}`);
    console.table(rijen);
  }

  if (JSON_UIT) {
    const kern = {};
    for (const profiel of PROFIELEN) {
      kern[profiel] = {};
      for (const v of varianten) {
        kern[profiel][v] = {
          samenvatting: samenvatting[profiel][v],
          runs: resultaat[profiel][v].map(r => ({ metrics: r.metrics, stappen: r.stappen.map(s => ({ soort: s.soort, naam: s.naam, ms: s.ms == null ? null : afr(s.ms, 1), gelukt: s.gelukt })), heapNaLadenMB: afr(r.heapNaLaden, 2), heapNaSessieMB: afr(r.heapNaSessie, 2) })),
          consoleBerichten: resultaat[profiel][v][0].berichten, // de meldingen van de eerste run, om te zien WAT er gemeld wordt
        };
      }
    }
    const req = createRequire(import.meta.url);
    fs.mkdirSync(path.dirname(JSON_UIT), { recursive: true });
    fs.writeFileSync(JSON_UIT, JSON.stringify({
      meta: {
        script: 'scripts/meet-interactie.mjs', gemetenMap: NA, voorMap: VOOR, runs: RUNS, profielen: PROFIELEN, mediaan: 'mediaan van de runs; bij --voor afwisselend',
        klok: `Date vast op ${VASTE_NU} (daarna loopt de tijd door)`, data: '30 wachtrijtickets + 28 geplande tickets', rol: 'coordinator, ingelogd als beheerder (stub), ?test',
        desktop: '1440x900', telefoon: '375x812 @2x, aanraking, blitz_weergave=gsm, CPU 4x trager (Route-tab bestaat daar niet)',
        longtask: 'sessie = vanaf de eerste handeling; laden = alles daarvoor (vanaf het begin van de pagina)',
        gestart: new Date(START).toISOString(), duurMs: Date.now() - START, node: process.version, playwright: req('playwright-core/package.json').version,
        cpu: os.cpus()[0]?.model, kernen: os.cpus().length, geheugenGB: Math.round(os.totalmem() / 2 ** 30), os: `${os.platform()} ${os.release()}`,
      },
      profielen: kern,
    }, null, 2));
    console.log('JSON geschreven: ' + JSON_UIT);
  }
} finally {
  await browser.close();
  for (const srv of Object.values(servers)) srv.close();
}
