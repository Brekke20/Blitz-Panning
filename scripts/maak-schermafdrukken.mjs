// Schermafdrukken van de Open dag-stijl (geen onderdeel van de suite; staat bewust buiten e2e/).
// Gebruik, vanuit de root van de repo: node scripts/maak-schermafdrukken.mjs [filter] [uitmap]
//   filter = deel van de bestandsnaam (bv. "pc-donker"); uitmap = standaard docs/superpowers/specs/assets/open-dag-schermen
// Het script start zelf de statische server (e2e/statische-server.mjs, poort 3338) en stopt die weer.
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const WT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filter = process.argv[2] || '';
const uitmap = path.resolve(WT, process.argv[3] || 'docs/superpowers/specs/assets/open-dag-schermen');
fs.mkdirSync(uitmap, { recursive: true });
const imp = (p) => import(pathToFileURL(path.join(WT, p)).href);
const { chromium } = await imp('node_modules/playwright/index.mjs');
const h = await imp('e2e/helpers.mjs');
const sh = await imp('e2e/sales-hulp.mjs');

const server = spawn(process.execPath, ['e2e/statische-server.mjs'], { cwd: WT, stdio: 'ignore' });
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
await wacht(1200);

const browser = await chromium.launch();
const VP = { pc: { width: 1366, height: 768 }, gsm: { width: 375, height: 812 } };

// Echte lettertypen (de testfixture stubt Google Fonts leeg): enkel voor deze afdrukken.
async function lettertypen(page) {
  await page.route((u) => u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com', (route) => route.continue());
}

const lead = (id, naam, extra = {}) => ({
  id, voornaam: 'Jan', naam, gsm: '0475 12 34 56', email: 'jan@voorbeeld.be', postcode: '3500', gemeente: 'Hasselt', straat: 'Kerkstraat', huisnr: '12', adresTekst: null,
  locatie: { lat: 50.93, lon: 5.34, bron: 'adres' }, status: 'te-plannen', bezoeken: [], duurMin: 30,
  geimporteerdOp: '2026-10-01T08:00:00.000Z', bronExport: { verantwoordelijke: 'Test Verkoper', geexporteerdOp: null }, ...extra,
});
const LEADS = () => [
  lead('l1', 'Verhaegen', { status: 'voorgesteld', planning: { datum: '2026-10-05', start: '09:00', vast: false } }),
  lead('l2', 'Maes', { status: 'bevestigd', planning: { datum: '2026-10-05', start: '11:00', vast: true }, gemeente: 'Genk' }),
  lead('l3', 'Peeters', { gemeente: 'Diepenbeek' }), lead('l4', 'Janssens', { gemeente: 'Zonhoven' }), lead('l5', 'Claes', { gemeente: 'Lummen' }),
];

const tab = (page, id) => page.evaluate((i) => document.getElementById('tab-' + i).click(), id);
const SCHERMEN = [
  ['wachtrij', async (page) => { /* standaard */ }],
  ['kalender', async (page) => { await tab(page, 'kalender'); await page.waitForTimeout(700); }],
  ['route', async (page, vp) => {
    if (vp === 'gsm') throw new Error('Route bestaat niet op een gsm');
    await tab(page, 'planning'); await page.waitForTimeout(1500);
  }],
  ['ingepland', async (page) => { await tab(page, 'gepland'); await page.waitForTimeout(600); }],
  ['inventaris', async (page) => { await tab(page, 'inventaris'); await page.waitForTimeout(900); }],
  ['rapporten', async (page) => { await tab(page, 'rapporten'); await page.waitForTimeout(900); }],
  ['beheer', async (page) => { await tab(page, 'beheer'); await page.waitForTimeout(900); }],
  ['ticketdetail', async (page) => { await page.locator('#view-tickets .ticket[data-urgentie]').first().click(); await page.waitForTimeout(700); }],
  ['wizard', async (page) => {
    const open = await page.evaluate(() => {
      const planning = window.kern.toestand.get('planning');
      for (const [datum, stops] of Object.entries(planning)) if (stops.length) { window.openRapport(stops[0].ticket.id, datum); return true; }
      return false;
    });
    if (!open) throw new Error('geen geplande stop voor de wizard');
    await page.waitForTimeout(900);
  }],
  ['halloween-wachtrij', async () => {}],
  ['halloween-kalender', async (page) => { await tab(page, 'kalender'); await page.waitForTimeout(700); }],
  ['halloween-ingepland', async (page) => { await tab(page, 'gepland'); await page.waitForTimeout(600); }],
  ['inloggen', null],
  ['leads', null],
];

async function nieuwePagina(vp, thema, soort) {
  const context = await browser.newContext({ baseURL: 'http://localhost:3338', viewport: VP[vp], timezoneId: 'Europe/Brussels', locale: 'nl-BE', serviceWorkers: 'block' });
  const page = await context.newPage();
  await lettertypen(page);
  await page.addInitScript(({ thema, vp }) => {
    if (window !== window.top) return;
    localStorage.setItem('blitz_theme', thema);
    if (vp === 'gsm') localStorage.setItem('blitz_weergave', 'gsm');
  }, { thema, vp });
  return { page, context };
}

// startApp doet de zetten zelf (blitz_theme enkel als er niets staat): de init-script hierboven is eerder en wint dus.
async function maak(vp, thema, naam) {
  const bestand = path.join(uitmap, `${vp === 'pc' ? 'pc' : 'gsm'}-${thema === 'dark' ? 'donker' : 'licht'}-${naam}.png`);
  if (filter && !bestand.includes(filter)) return;
  const { page, context } = await nieuwePagina(vp, thema);
  try {
    if (naam === 'inloggen') {
      await h.startApp(page, { viewport: VP[vp], wachtOpApp: false, overschrijf: { 'auth-ik': () => ({ status: 401, json: { error: 'Niet ingelogd', code: 'niet-ingelogd', setupNodig: false } }) } });
      await page.waitForSelector('#login-overlay .login-kaart'); await page.waitForTimeout(600);
    } else if (naam === 'leads') {
      const backend = sh.maakSalesBackend({ leads: LEADS() });
      await h.startApp(page, { viewport: VP[vp], loginRol: 'sales', overschrijf: { 'auth-ik': sh.authIkVoor(sh.SALES_GEBRUIKER), ...backend.stubs }, wachtOpApp: false });
      await page.getByRole('tab', { name: 'Leads', exact: true }).waitFor(); await page.waitForTimeout(1200);
    } else {
      await h.startApp(page, { viewport: VP[vp], technieker: naam === 'inventaris' ? 'Tim' : 'all', ...(naam.startsWith('halloween') ? { query: '?test&versiering=aan' } : {}) });
      await page.waitForTimeout(500);
      const stap = SCHERMEN.find((s) => s[0] === naam)[1];
      await stap(page, vp);
    }
    await page.mouse.move(0, 0);
    await page.screenshot({ path: bestand });
    console.log('ok', path.basename(bestand), fs.statSync(bestand).size);
  } catch (fout) {
    console.log('FOUT', path.basename(bestand), String(fout.message).split('\n')[0]);
    try { await page.screenshot({ path: bestand.replace('.png', '-FOUT.png') }); } catch {}
  } finally { await context.close(); }
}

try {
  for (const vp of ['pc', 'gsm']) for (const thema of ['dark', 'light']) for (const [naam] of SCHERMEN) { if (naam.startsWith('halloween') && thema === 'light') continue; if (naam === 'route' && vp === 'gsm') continue; /* Route bestaat niet op een gsm */ await maak(vp, thema, naam); }
} finally {
  await browser.close();
  server.kill();
}
