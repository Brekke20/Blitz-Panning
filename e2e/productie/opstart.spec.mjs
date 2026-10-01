import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { test, expect, startAppProductie, verwachtSchrijven, OPSTART_SCHRIJVEN, neemGeblokkeerdeProbesOver, ongemeldeSchrijfverzoeken } from '../productie-hulp.mjs';

const MAP = path.dirname(url.fileURLToPath(import.meta.url));
const TICKETS = JSON.parse(fs.readFileSync(path.join(MAP, '..', 'fixtures', 'tickets.json'), 'utf8'));

// ── Zelftest van het vangnet: DIT draait eerst, vóór elke andere productietest ──
test.describe.configure({ mode: 'serial' });

test('Zelftest: Zoho, TomTom, mail en een POST naar een CDN worden geblokkeerd', async ({ page, verzoeken, consoleFouten }) => {
  await startAppProductie(page, { technieker: 'Tim' });
  verwachtSchrijven(verzoeken, OPSTART_SCHRIJVEN);
  const probes = [
    ['GET', 'https://desk.zoho.eu/api/v1/tickets'],
    ['GET', 'https://api.tomtom.com/routing/1/calculateRoute/x'],
    ['GET', 'https://smtp.example.com/'],
    ['POST', 'https://cdnjs.cloudflare.com/x'],
  ];
  for (const [methode, doel] of probes) {
    const uitkomst = await page.evaluate(([m, u]) => fetch(u, { method: m }).then(() => 'bereikt', (e) => e.name), [methode, doel]);
    expect(uitkomst, `${methode} ${doel}`).toBe('TypeError');
  }
  const gezien = neemGeblokkeerdeProbesOver(page, verzoeken);
  expect(gezien.buitenHost).toEqual(probes.map(([, doel]) => doel));
  expect(gezien.ongeoorloofd).toEqual(probes.map(([m, doel]) => `${m} ${doel}`));
  // De afgebroken fetches zijn ook requestfailed-meldingen; die horen bij deze bewuste probes.
  expect(consoleFouten.length).toBeGreaterThan(0);
  consoleFouten.length = 0;
});

test('Zelftest: zonder startAppProductie verlaat ook niets de eigen server', async ({ page, verzoeken, consoleFouten }) => {
  await page.goto('/sw.js'); // een bestaand statisch bestand; geen app, geen stubs
  const uitkomst = await page.evaluate(() => fetch('https://desk.zoho.eu/api/v1/tickets').then(() => 'bereikt', () => 'geblokkeerd'));
  expect(uitkomst).toBe('geblokkeerd');
  const gezien = neemGeblokkeerdeProbesOver(page, verzoeken);
  expect(gezien.buitenHost).toEqual(['https://desk.zoho.eu/api/v1/tickets']);
  consoleFouten.length = 0;
});

test('Zelftest: de catch-all blijft dicht (/api/onbestaand geeft 599)', async ({ page, verzoeken, consoleFouten }) => {
  await startAppProductie(page, { technieker: 'Tim' });
  verwachtSchrijven(verzoeken, OPSTART_SCHRIJVEN);
  const status = await page.evaluate(() => fetch('/api/onbestaand').then(r => r.status));
  expect(status).toBe(599);
  expect(verzoeken.onverwacht).toEqual(['/api/onbestaand']);
  expect(consoleFouten).toEqual([expect.stringContaining('599')]); // de browser meldt de 599 als console.error
  verzoeken.onverwacht.length = 0;
  consoleFouten.length = 0;
});

test('Zelftest: een schrijfverzoek buiten de whitelist wordt gemeld', async ({ page, verzoeken }) => {
  await startAppProductie(page, { technieker: 'Tim' });
  verwachtSchrijven(verzoeken, OPSTART_SCHRIJVEN);
  expect(ongemeldeSchrijfverzoeken(verzoeken.alle, OPSTART_SCHRIJVEN)).toEqual([]);
  // /api/plan is gestubd (neutraal succes) maar niet aangemeld: precies wat het auto-vangnet weigert.
  await page.evaluate(() => fetch('/api/plan', { method: 'POST', body: '{}' }));
  expect(ongemeldeSchrijfverzoeken(verzoeken.alle, OPSTART_SCHRIJVEN)).toEqual(['POST /api/plan']);
  expect(ongemeldeSchrijfverzoeken(verzoeken.alle, [...OPSTART_SCHRIJVEN, 'POST /api/plan'])).toEqual([]);
  verwachtSchrijven(verzoeken, ['/api/plan']); // bewust aangemeld, anders faalt het auto-vangnet
});

// ── Opstart zonder ?test ──────────────────────────────────────────────────────
test('Laden: exact de verwachte opstartverzoeken, geen testmodus', async ({ page, verzoeken }) => {
  verwachtSchrijven(verzoeken, OPSTART_SCHRIJVEN);
  await startAppProductie(page, { technieker: 'Tim' });
  const verzameling = [...new Set(verzoeken.alle.map(r => `${r.methode} ${r.pad}`))].sort();
  expect(verzameling).toEqual([
    'GET /api/afspraken',
    'GET /api/availability',
    'GET /api/inventaris',
    'GET /api/klantbeschikbaarheid',
    'GET /api/prijzen',
    'GET /api/rapport-archief',
    'GET /api/tickets',
    'GET /api/voorstel-status',
    'POST /api/planning-sinds',
  ]);
  await expect(page.locator('#test-badge')).toBeHidden();
  // Gemeten: de tellingen gelden voor het hele antwoord (niet voor de technieker).
  await expect(page.locator('#toast')).toHaveText('3 te plannen · 2 wacht bevestiging · 1 gepland');
  await expect(page.locator('#toast')).not.toContainText('Testmodus');
  expect(new URL(page.url()).search).toBe('');
});

test('X-Blitz-Test ontbreekt en planning-sinds krijgt exact de ticket-ids', async ({ page, verzoeken }) => {
  verwachtSchrijven(verzoeken, OPSTART_SCHRIJVEN);
  await startAppProductie(page, { technieker: 'Tim' });
  expect(verzoeken.alle.length).toBeGreaterThan(0);
  for (const r of verzoeken.alle) expect(r.headers['x-blitz-test'], `${r.methode} ${r.pad}`).toBeNull();
  const sinds = verzoeken.van('/api/planning-sinds', 'POST');
  expect(sinds).toHaveLength(1);
  expect(sinds[0].headers['content-type']).toBe('application/json');
  // Gemeten volgorde uit tickets.json.
  expect(sinds[0].body).toEqual({
    opzoeken: TICKETS.tickets.map(t => t.id),
    actief: [...TICKETS.tickets, ...TICKETS.pendingTickets, ...TICKETS.plannedTickets].map(t => t.id),
  });
  expect(sinds[0].body.opzoeken).toEqual(['t1', 't2', 't3']);
  expect(sinds[0].body.actief).toEqual(['t1', 't2', 't3', 'p1', 'p2', 'g1']);
});

// ── Afdwingen: productiespecs omzeilen het vangnet niet ───────────────────────
test('vangnet: elke productiespec importeert enkel uit ../productie-hulp.mjs en vermijdt testmodus', async () => {
  const specs = fs.readdirSync(MAP).filter(f => f.endsWith('.spec.mjs'));
  expect(specs).toContain('opstart.spec.mjs');
  const importRegel = /(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g;
  // De trefwoorden zijn in stukken geschreven, zodat dit bestand zichzelf niet raakt.
  const verboden = [new RegExp('\\?te' + 'st\\b'), new RegExp('x-blitz-' + 'test', 'i'), new RegExp('waitFor' + 'Timeout')];
  const overtredingen = [];
  for (const f of specs) {
    const tekst = fs.readFileSync(path.join(MAP, f), 'utf8');
    for (const m of tekst.matchAll(importRegel)) {
      if (!m[1].startsWith('node:') && m[1] !== '../productie-hulp.mjs') overtredingen.push(`${f}: import ${m[1]}`);
    }
    if (f !== 'opstart.spec.mjs') {
      for (const v of verboden) if (v.test(tekst)) overtredingen.push(`${f}: ${v}`);
    }
  }
  expect(overtredingen).toEqual([]);
});
