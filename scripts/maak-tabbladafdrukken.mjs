// Schermafdrukken van elk tabblad per rol (taak 13, Open dag-stijl; geen onderdeel van de suite, staat bewust buiten e2e/).
// Gebruik, vanuit de root van de repo: node scripts/maak-tabbladafdrukken.mjs [filter] [uitmap]
//   filter = deel van de bestandsnaam (bv. "gsm-"); uitmap = standaard docs/superpowers/specs/assets/open-dag-tabbladen
// Het script start zelf de statische server (e2e/statische-server.mjs, poort 3338), stopt die weer en schrijft ook de README.md met de tabel rol x tabblad.
// Alles draait tegen de stubs van de e2e-suite (verzonnen gegevens, niets gaat naar Zoho, TomTom of de mail). Enkel licht thema, op pc, gsm en tablet rechtop.
// De klok staat op VRIJDAG 9 okt 2026, 10:30: zo springt de gsm-kalender (en dus ook een tablet rechtop) zichtbaar naar vandaag en de nu-regel.
// De tablet (768x1024, isMobile + aanraking, zoals e2e/tablet-rechtop.spec.mjs) is rechtop een gsm in de hele app (apparaat.js): de afdrukken
// `<rol>-tablet-<tab>.png` tonen dus de gsm-indeling op 768 px breed; de tab Route bestaat er niet. Enkel de beheerder (alle tabs) en de kalender van sales.
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import zlib from 'node:zlib';

const WT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filter = process.argv[2] || '';
const uitmap = path.resolve(WT, process.argv[3] || 'docs/superpowers/specs/assets/open-dag-tabbladen');
fs.mkdirSync(uitmap, { recursive: true });
const imp = (p) => import(pathToFileURL(path.join(WT, p)).href);
const { chromium } = await imp('node_modules/playwright/index.mjs');
const h = await imp('e2e/helpers.mjs');
const kh = await imp('e2e/kliktest-hulp.mjs');

const POORT = 3338;
const VRIJDAG = '2026-10-09T10:30:00+02:00';
const server = spawn(process.execPath, ['e2e/statische-server.mjs'], { cwd: WT, stdio: 'ignore' });
let browser; // gestart in de try hieronder: een mislukte start of een fout laat nooit een server op de poort achter
const wacht = (ms) => new Promise((r) => setTimeout(r, ms));
// Wacht tot de server op de poort luistert (kort interval, korte time-out) in plaats van een vaste pauze.
async function wachtOpPoort(poort, maxMs) {
  const einde = Date.now() + maxMs;
  while (Date.now() < einde) {
    const open = await new Promise((r) => { const sok = net.connect(poort, '127.0.0.1'); sok.once('connect', () => { sok.destroy(); r(true); }); sok.once('error', () => { sok.destroy(); r(false); }); });
    if (open) return;
    await wacht(50);
  }
  throw new Error(`de server luistert niet op poort ${poort} na ${maxMs} ms`);
}

// Echte lettertypen (de testfixture stubt Google Fonts leeg): enkel voor deze afdrukken.
async function lettertypen(page) {
  await page.route((u) => u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com', (route) => route.continue());
}


// Kaarttegels: de testfixture geeft een paars blokje terug; voor een nette afdruk een rustige, lichte kleur (een 1x1 PNG die Leaflet uitrekt).
function effenPng(r, g, b) {
  const crcTabel = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const byte of buf) c = crcTabel[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const blok = (type, data) => { const kop = Buffer.alloc(8); kop.writeUInt32BE(data.length, 0); kop.write(type, 4, 'ascii'); const staart = Buffer.alloc(4); staart.writeUInt32BE(crc(Buffer.concat([kop.subarray(4), data])), 0); return Buffer.concat([kop, data, staart]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), blok('IHDR', ihdr), blok('IDAT', zlib.deflateSync(Buffer.from([0, r, g, b]))), blok('IEND', Buffer.alloc(0))]);
}
const TEGEL = effenPng(0xe3, 0xec, 0xe6);
async function rustigeTegels(page) {
  await page.route((u) => u.hostname === 'server.arcgisonline.com' || /^[a-c]\.tile\.openstreetmap\.org$/.test(u.hostname), (route) => route.fulfill({ status: 200, contentType: 'image/png', body: TEGEL }));
}

// ── gevulde schermen: rapporten (Rapporten) en de rest komt uit de dummydata van de testmodus ────────────────────────────────────────────
const RAPPORTEN = [
  { id: 'r1', ticketId: 't-1', ticketNumber: '1002', datum: '2026-10-02', technieker: 'Tim', hersteld: 'ja', klant: 'Demo Klant', rapportData: { _html: '<p>Rapport</p>', servicetype: '2e-lijn', start: '09:00', stop: '10:30', aanrijtijdMin: '30', onderdelen: [{ naam: 'Contactor 25A', aantal: 1, prijs: 42.5, factureren: true }] } },
  { id: 'r2', ticketId: 't-2', ticketNumber: '1003', datum: '2026-10-01', technieker: 'Roel', hersteld: 'nee', nieuwInter: 'ja', klant: 'Voorbeeld NV', rapportData: { _html: '<p>Rapport</p>', servicetype: 'garantie', start: '13:00', stop: '14:00', aanrijtijdMin: '20', onderdelen: [] } },
  { id: 'r3', ticketId: 't-3', ticketNumber: '0998', datum: '2026-09-30', technieker: 'Tim', interventieType: 'Installatie', klant: 'Test Bedrijf', rapportData: { _html: '<p>Rapport</p>', interventieType: 'Installatie', start: '08:00', stop: '12:00', aanrijtijdMin: '45', onderdelen: [] } },
];
const rapportStub = { 'rapport-archief': h.opslagStub({ versie: 3, rapports: RAPPORTEN }, 'rapports') };
// Een technieker krijgt van de server enkel zijn eigen rapporten (de stub filtert niet, dus hier alvast gefilterd).
const rapportStubTim = { 'rapport-archief': h.opslagStub({ versie: 3, rapports: RAPPORTEN.filter((r) => r.technieker === 'Tim') }, 'rapports') };
// Voorraad van de wagen van Tim (verzonnen): een paar producten ruim voorradig, een onder en een op de meldgrens, een zonder melding.
const VOORRAAD_TIM = {
  'charx-1000': { aantal: 3, gedempt: false, drempel: 1 }, 'meter-sdm54-m': { aantal: 1, gedempt: false, drempel: 3 }, 'ct-80a': { aantal: 0, gedempt: false, drempel: 2 },
  'kabel-5m-zwart': { aantal: 5, gedempt: false, drempel: 2 }, 'kabel-7m-zwart': { aantal: 2, gedempt: false, drempel: 2 }, led: { aantal: 8, gedempt: true, drempel: null }, 'charx-rfid': { aantal: 4, gedempt: false, drempel: 1 },
};
const INVENTARIS = { versie: 3, wagenvoorraad: { Tim: VOORRAAD_TIM }, log: [
  { id: 'l1', datum: '2026-10-02T07:30:00.000Z', technieker: 'Tim', type: 'aanvulling', materiaalId: 'x1', materiaalNaam: 'Contactor 25A', aantal: 3, status: 'nieuw' },
  { id: 'l2', datum: '2026-10-05T06:00:00.000Z', technieker: 'Tim', type: 'verbruik', materiaalId: 'x2', materiaalNaam: 'Laadkabel type 2', aantal: -1, status: null, ticketNummer: '3979' },
] };
const inventarisStub = { inventaris: () => ({ status: 200, json: structuredClone(INVENTARIS) }) };

// ── tabbladen en hoe je ze toont ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const tabNaam = (naam) => new RegExp(`^${naam}(\\s|,|$)`); // een tab met een bolletje heet "Wachtrij, 3 nieuw" (aria-label, taak 19)
async function stabiel(page, sel) {
  let vorige = -1;
  for (let i = 0; i < 40; i++) {
    const n = await page.locator(sel).evaluate((e) => e.innerHTML.length).catch(() => 0);
    if (n > 0 && n === vorige) return;
    vorige = n;
    await wacht(200);
  }
}
async function openHoofdtab(page, naam, sel) {
  await h.kiesHoofdtab(page, tabNaam(naam));
  await stabiel(page, sel);
  await wacht(500);
}
async function openBeheerSub(page, sub) {
  await page.locator('.beheer-tabs').getByRole('tab', { name: sub, exact: true }).click();
  await page.locator('#beheer-paneel:not([aria-busy=true])').waitFor();
  await wacht(900);
}

const TABLET_STAAND = { width: 768, height: 1024 };
const VP = { pc: kh.PC, gsm: kh.GSM, tablet: TABLET_STAAND };

// ── de sets: per rol de tabbladen die hij ziet (de slug staat in de bestandsnaam) ─────────────────────────────────────────────────────────
const PLANNING_TABS = [
  { slug: 'wachtrij', toon: (p) => openHoofdtab(p, 'Wachtrij', '#view-tickets') },
  { slug: 'kalender', toon: (p) => openHoofdtab(p, 'Kalender', '#view-kalender') },
  { slug: 'route', alleenPc: true, toon: async (p) => {
    await openHoofdtab(p, 'Route', '#view-planning');
    await p.locator('.route-weekstrook button, #view-planning button', { hasText: /^WO 7/ }).first().click().catch(() => {}); // een dag met een stop: lijst en kaart gevuld
    await wacht(1800);
  } },
  { slug: 'ingepland', toon: (p) => openHoofdtab(p, 'Ingepland', '#view-gepland') },
  { slug: 'rapporten', toon: (p) => openHoofdtab(p, 'Rapporten', '#view-rapporten') },
  { slug: 'beheer-gebruikers', toon: async (p) => { await h.kiesHoofdtab(p, tabNaam('Beheer')); await wacht(500); await openBeheerSub(p, 'Gebruikers'); } },
  ...[['instellingen', 'Instellingen'], ['beschikbaarheden', 'Beschikbaarheden'], ['activiteitenlog', 'Activiteitenlog'], ['systeemstatus', 'Systeemstatus'], ['themas', "Thema's"], ['performance', 'Performance']]
    .map(([slug, naam]) => ({ slug: `beheer-${slug}`, toon: (p) => openBeheerSub(p, naam) })),
];
const INVENTARIS_TAB = [{ slug: 'inventaris', toon: (p) => openHoofdtab(p, 'Inventaris', '#view-inventaris') }];
const TECHNIEKER_TABS = [
  { slug: 'kalender', toon: (p) => openHoofdtab(p, 'Kalender', '#view-kalender') },
  { slug: 'ingepland', toon: (p) => openHoofdtab(p, 'Ingepland', '#view-gepland') },
  { slug: 'inventaris', toon: (p) => openHoofdtab(p, 'Inventaris', '#view-inventaris') },
  { slug: 'rapporten', toon: (p) => openHoofdtab(p, 'Rapporten', '#view-rapporten') },
];
const SALES_TABS = [
  { slug: 'leads', toon: (p) => openHoofdtab(p, 'Leads', '#view-sales-lijst') },
  { slug: 'kalender', toon: (p) => openHoofdtab(p, 'Kalender', '#view-sales-kalender') },
  { slug: 'route', alleenPc: true, toon: async (p) => { await openHoofdtab(p, 'Route', '#view-sales-route'); await wacht(1800); } },
  { slug: 'afgewerkt', toon: (p) => openHoofdtab(p, 'Afgewerkt', '#view-sales-afgewerkt') },
];

const rolVan = (sleutel) => kh.ROLLEN.find((r) => r.sleutel === sleutel);
// Elke set start één app per (rol, schermgrootte) en loopt de tabbladen af; `extra` gaat naar startApp (persoon, stubs).
const SETS = [
  { rol: 'beheerder', bron: rolVan('beheerder-planning'), extra: () => ({ overschrijf: { ...kh.beheerStubs(), ...rapportStub } }), tabs: PLANNING_TABS },
  { rol: 'beheerder', bron: rolVan('beheerder-planning'), extra: () => ({ technieker: 'Tim', overschrijf: { ...kh.beheerStubs(), ...inventarisStub } }), tabs: INVENTARIS_TAB },
  { rol: 'technieker', bron: rolVan('technieker'), extra: () => ({ overschrijf: { ...rapportStubTim, ...inventarisStub } }), tabs: TECHNIEKER_TABS },
  { rol: 'sales', bron: rolVan('sales'), extra: () => ({}), tabs: SALES_TABS },
];

async function nieuwePagina(vp) {
  // Een tablet is een echte tabletemulatie (aanraking), zodat apparaat.js hem zelf herkent; zonder blitz_weergave.
  const aanraking = vp === 'tablet' ? { isMobile: true, hasTouch: true, deviceScaleFactor: 1 } : {};
  const context = await browser.newContext({ baseURL: 'http://localhost:3338', viewport: VP[vp], timezoneId: 'Europe/Brussels', locale: 'nl-BE', serviceWorkers: 'block', ...aanraking });
  const page = await context.newPage();
  await lettertypen(page);
  await rustigeTegels(page);
  await page.addInitScript((vp) => {
    if (window !== window.top) return;
    localStorage.setItem('blitz_theme', 'light');
    if (vp === 'gsm') localStorage.setItem('blitz_weergave', 'gsm');
  }, vp);
  return { page, context };
}

const gemaakt = []; // { rol, vp, slug, bestand }
async function maakSet(set, vp) {
  // Route bestaat niet op een gsm en dus ook niet op een tablet rechtop; van de tablet enkel de beheerder en de kalender van sales.
  const tabs = set.tabs.filter((t) => !(vp !== 'pc' && t.alleenPc)).filter((t) => vp !== 'tablet' || set.rol === 'beheerder' || (set.rol === 'sales' && t.slug === 'kalender'));
  if (vp === 'tablet' && set.rol !== 'beheerder' && set.rol !== 'sales') return;
  const wanted = tabs.filter((t) => !filter || `${set.rol}-${vp}-${t.slug}.png`.includes(filter));
  if (!wanted.length) return;
  const { page, context } = await nieuwePagina(vp);
  try {
    // De rol start zoals in de kliktest (e2e/kliktest-hulp.mjs); de stubs van de e2e-suite blijven het vangnet.
    await set.bron.start(page, VP[vp], { ...set.extra(), nu: VRIJDAG });
    await wacht(600);
    for (const tab of wanted) {
      const bestand = path.join(uitmap, `${set.rol}-${vp}-${tab.slug}.png`);
      try {
        await tab.toon(page);
        await page.evaluate(() => document.getElementById('toast')?.classList.remove('show')); // een meldingsbalk in beeld is geen inhoud van het tabblad
        await wacht(450);
        await page.mouse.move(0, 0);
        await page.screenshot({ path: bestand });
        gemaakt.push({ rol: set.rol, vp, slug: tab.slug, bestand: path.basename(bestand) });
        console.log('ok', path.basename(bestand), fs.statSync(bestand).size);
      } catch (fout) {
        console.log('FOUT', path.basename(bestand), String(fout.message).split('\n')[0]);
        try { await page.screenshot({ path: bestand.replace('.png', '-FOUT.png') }); } catch { /* geen beeld */ }
      }
    }
    // Op een gsm (en een tablet rechtop) staan Rapporten en Beheer achter "Meer": één afdruk van dat blad.
    if (vp !== 'pc' && set.rol === 'beheerder' && set.tabs === PLANNING_TABS && (!filter || `beheerder-${vp}-meer-blad.png`.includes(filter))) {
      await page.locator('.dok-meer').click();
      await wacht(500);
      const bestand = path.join(uitmap, `beheerder-${vp}-meer-blad.png`);
      await page.screenshot({ path: bestand });
      gemaakt.push({ rol: 'beheerder', vp, slug: 'meer-blad', bestand: path.basename(bestand) });
      console.log('ok', path.basename(bestand));
    }
  } finally { await context.close(); }
}

// Taak 18: het bolletje op "Meer". Achter Meer staat een teller enkel als Route in het dok meedoet (een smal computervenster, of een met de hand
// gekozen tablet): op een echte gsm staat Inventaris zelf in het dok, met de eigen teller. Dus: de beheerder in een computervenster van 375 px.
async function maakBolletjeAfdruk() {
  const bestand = path.join(uitmap, 'beheerder-gsm-meer-bolletje.png');
  if (filter && !path.basename(bestand).includes(filter)) return;
  const context = await browser.newContext({ baseURL: 'http://localhost:3338', viewport: kh.GSM, timezoneId: 'Europe/Brussels', locale: 'nl-BE', serviceWorkers: 'block' });
  const page = await context.newPage();
  try {
    await lettertypen(page);
    await page.addInitScript(() => { if (window !== window.top) return; localStorage.setItem('blitz_theme', 'light'); localStorage.setItem('blitz_weergave', 'computer'); });
    await rolVan('beheerder-planning').start(page, kh.GSM, { technieker: 'Tim', overschrijf: { ...kh.beheerStubs(), ...inventarisStub }, nu: VRIJDAG });
    await wacht(600);
    await page.waitForSelector('.dok-meer .dok-meer-bolletje:not([hidden])');
    await page.evaluate(() => document.getElementById('toast')?.classList.remove('show'));
    await wacht(450);
    await page.screenshot({ path: bestand });
    console.log('ok', path.basename(bestand), fs.statSync(bestand).size);
  } finally { await context.close(); }
}

// ── README: een tabel rol x tabblad in gewone taal ───────────────────────────────────────────────────────────────────────────────────────
const TITELS = {
  wachtrij: 'Wachtrij', kalender: 'Kalender', route: 'Route', ingepland: 'Ingepland', inventaris: 'Inventaris', rapporten: 'Rapporten',
  'beheer-gebruikers': 'Beheer: Gebruikers', 'beheer-instellingen': 'Beheer: Instellingen', 'beheer-beschikbaarheden': 'Beheer: Beschikbaarheden',
  'beheer-activiteitenlog': 'Beheer: Activiteitenlog', 'beheer-systeemstatus': 'Beheer: Systeemstatus', 'beheer-themas': "Beheer: Thema's", 'beheer-performance': 'Beheer: Performance',
  leads: 'Leads', afgewerkt: 'Afgewerkt', 'meer-blad': 'Het blad "Meer" op een gsm',
};
function schrijfReadme() {
  // Het bestand telt als het op schijf staat (ook uit een vorige of gefilterde run): zo houdt de tabel alle afdrukken.
  const bestandVan = (rol, vp, slug) => { const b = `${rol}-${vp}-${slug}.png`; return fs.existsSync(path.join(uitmap, b)) ? b : undefined; };
  const cel = (rol, slug) => ['pc', 'gsm', 'tablet'].map((vp) => { const b = bestandVan(rol, vp, slug); return b ? `[${vp}](${b})` : '–'; }).join(' · ');
  const rij = (rol, slug) => `| ${TITELS[slug]} | ${cel(rol, slug)} |`;
  const blok = (kop, rol, slugs, uitleg) => [`## ${kop}`, '', uitleg, '', '| Tabblad | Schermafdruk |', '|---|---|', ...slugs.map((s) => rij(rol, s)), ''].join('\n');
  const tekst = [
    '# Schermafdrukken van elk tabblad (Open dag)',
    '',
    'Per rol een afdruk van elk tabblad dat die rol in de app ziet, in het lichte thema, op een computer (`pc`) en op een gsm (`gsm`). Van de beheerder en van de kalender van sales staan er ook afdrukken van een tablet rechtop (`tablet`, 768 x 1024): rechtop is een tablet een gsm in de hele app, dus die afdrukken tonen de gsm-indeling op 768 px breed. De gsm-kalender en de tabletafdrukken zijn gemaakt op vrijdag 9 oktober 10:30, zodat de kalender zichtbaar naar vandaag en de nu-regel springt.',
    'De afdrukken komen uit de testversie van de app met verzonnen gegevens; er is niets echts aan geraakt. Op een gsm bestaat het tabblad Route niet.',
    'Het script `scripts/maak-tabbladafdrukken.mjs` maakt ze opnieuw als de stijl verandert.',
    '',
    blok('Beheerder (werkruimte Planning)', 'beheerder', ['wachtrij', 'kalender', 'route', 'ingepland', 'inventaris', 'rapporten', 'beheer-gebruikers', 'beheer-instellingen', 'beheer-beschikbaarheden', 'beheer-activiteitenlog', 'beheer-systeemstatus', 'beheer-themas', 'beheer-performance', 'meer-blad'],
      'De beheerder ziet alle tabbladen en elk onderdeel van Beheer. **Dezelfde schermen zien ook:** de planner (dezelfde tabbladen; in Beheer enkel Instellingen, Beschikbaarheden en Performance) en een technieker met het vinkje "Mag zelf plannen" (de tabbladen van de technieker, plus Wachtrij en Route; geen Beheer). Inventaris is hier getoond met de technieker Tim gekozen, want zonder gekozen technieker toont die enkel de aanvullingen.'),
    blok('Technieker', 'technieker', ['kalender', 'ingepland', 'inventaris', 'rapporten'],
      'Een technieker ziet vier tabbladen, gefilterd op zijn eigen werk (hier: Tim). Het zijn dezelfde schermen als bij de beheerder, maar met enkel zijn eigen gegevens; daarom staan ze hier apart.'),
    blok('Sales (verkoper)', 'sales', ['leads', 'kalender', 'route', 'afgewerkt'],
      'Een verkoper ziet vier tabbladen. **Dezelfde schermen zien ook:** de beheerder in de werkruimte Sales (na het kiezen van een verkoper) en de sales manager; die laatste twee hebben er Beheer bij (dezelfde schermen als hierboven bij de beheerder: de sales manager ziet enkel Instellingen en Performance).'),
  ].join('\n');
  fs.writeFileSync(path.join(uitmap, 'README.md'), tekst, 'utf8');
}

try {
  await wachtOpPoort(POORT, 10000);
  browser = await chromium.launch();
  for (const vp of ['pc', 'gsm', 'tablet']) for (const set of SETS) await maakSet(set, vp);
  await maakBolletjeAfdruk();
  schrijfReadme();
} finally {
  if (browser) await browser.close();
  server.kill();
}
