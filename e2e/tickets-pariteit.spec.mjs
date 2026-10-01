import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { test, expect, startApp } from './helpers.mjs';

const MAP = path.dirname(url.fileURLToPath(import.meta.url));
const TICKETS = JSON.parse(fs.readFileSync(path.join(MAP, 'fixtures', 'tickets.json'), 'utf8'));

// Pariteit: de productie-fixture (e2e/fixtures/tickets.json) is gelijk aan DUMMY_DATA uit index.html.
// Staat in een eigen ?test-spec: het productie-vangnet weigert ?test uitdrukkelijk (e2e/productie/).
// De klok-afhankelijke velden (inPlanningSinds, interventieDatum) worden genormaliseerd: DUMMY_DATA
// rekent ze vanaf Date.now(), de fixture heeft vaste waarden.
test('tickets.json is gelijk aan DUMMY_DATA (klokafhankelijke velden genormaliseerd)', async ({ page }) => {
  await startApp(page);
  const dummy = await page.evaluate(() => JSON.parse(JSON.stringify(DUMMY_DATA)));
  const normaliseer = (data) => {
    const kopie = structuredClone(data);
    for (const lijst of Object.values(kopie)) {
      for (const t of lijst) {
        if ('inPlanningSinds' in t) t.inPlanningSinds = '<datum>';
        if (t.interventieDatum) t.interventieDatum = '<datum>';
      }
    }
    return kopie;
  };
  expect(normaliseer(TICKETS)).toEqual(normaliseer(dummy));
  // De datumvelden zelf: zelfde aanwezigheid (null of gevuld) en, voor interventieDatum, binnen een minuut
  // van de vaste klok ± het aantal dagen.
  const dag = 86400000;
  const nu = new Date('2026-10-05T09:00:00+02:00').getTime();
  const verwacht = { t1: -2, p1: 2, g1: 4 };
  for (const lijst of Object.values(TICKETS)) {
    for (const t of lijst) {
      if (t.id in verwacht) expect(new Date(t.interventieDatum).getTime()).toBe(nu + verwacht[t.id] * dag);
    }
  }
  for (const [i, t] of TICKETS.tickets.entries()) {
    expect(new Date(t.inPlanningSinds).getTime(), t.id).toBeLessThan(nu - [1, 10, 25][i] * dag + 3 * 3600000);
    expect(new Date(t.inPlanningSinds).getTime(), t.id).toBeGreaterThan(nu - [1, 10, 25][i] * dag - 3 * 3600000);
  }
});
