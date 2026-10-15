import { test, expect, startApp } from './helpers.mjs';

// v2.1.6 (klantmelding): "+" zette #3979 (Oostduinkerke) op een dag met #3894 (Meise, vast 14:45), 90 min rijden uit elkaar. Nu
// toetst "+" elke dag met de regels van het brein (echte reistijden via /api/matrix, max. 45 min naar de buren, de vaste stop moet
// op tijd haalbaar blijven). Klok: maandag 5 okt 2026 09:00. #1001 (t1, Geel 51.162/4.989) is van Tim.

const PLUS = 'Inplannen op eerstvolgende vrije dag';
const kaart = (page, nr) => page.locator('#ticket-list .ticket').filter({ hasText: '#' + nr });
const plekVan = (page, id) => page.evaluate((id) => Object.entries(kern.toestand.get('planning'))
  .flatMap(([d, stops]) => stops.filter(s => s.ticket.id === id).map(() => d)), id);

// Een bestaande stop van Tim met eigen coördinaten (zoals een gegeocodeerd ticket), op een vast uur.
async function zetStops(page, stops) {
  await page.evaluate((lijst) => {
    const planning = kern.toestand.get('planning');
    for (const s of lijst) {
      const ticket = {
        id: s.id, number: s.nummer, subject: 'Vaste afspraak ' + s.nummer, status: 'Wachten op bevestiging planning', priority: 'medium',
        assignee: 'Tim', contact: '', email: '', phone: '', account: 'Klant', address: 'Adres ' + s.nummer, hasAddress: true,
        _lat: s.lat, _lon: s.lon, interventieDatum: null,
      };
      (planning[s.datum] ??= []).push({ ticket, address: ticket.address, uur: s.uur });
    }
    kern.toestand.raak('planning');
    kern.toestand.raak('allPending');
  }, stops);
}

// Deterministische matrix: elke rit van of naar de "verre" stop (Antwerpen 51.2/4.4 in deze test) duurt 90 min (bv. file), de rest
// 0,77 min per km in vogelvlucht (Geel-Oostduinkerke ruim 2 uur, Geel-Beringen een kwartier).
const VER = { lat: 51.2, lon: 4.4 };
const isVer = (p) => Math.abs(p.lat - VER.lat) < 1e-6 && Math.abs(p.lon - VER.lon) < 1e-6;
const km = (a, b) => {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};
const matrix90 = ({ body }) => ({
  status: 200,
  json: { results: (body?.destinations || []).map(d => ({
    travelTimeSeconds: Math.round((isVer(body.origin) || isVer(d)) ? 5400 : km(body.origin, d) * 0.77 * 60), distanceMeters: 1000,
  })) },
});

test.describe('"+" met de reistijdregels van het brein', () => {
  test('"+" slaat een dag over waar de vaste stop 90 min rijden is en kiest de volgende dag die past', async ({ page, verzoeken }) => {
    await startApp(page, { technieker: 'Tim', overschrijf: { matrix: matrix90 } });
    // Maandag: een vaste stop om 14:45, 90 min van #1001 (in vogelvlucht ~40 km: de voorfilter laat hem door, de matrix beslist).
    await zetStops(page, [{ id: 'v1', nummer: '3894', datum: '2026-10-05', uur: '14:45', ...VER }]);
    await kaart(page, 1001).getByRole('button', { name: PLUS }).click();
    await expect(page.locator('#toast')).toHaveText('✓ Toegevoegd aan 6 okt');
    expect(await plekVan(page, 't1')).toEqual(['2026-10-06']);
    expect(verzoeken.van('/api/matrix', 'POST').length).toBeGreaterThanOrEqual(1);
    expect(verzoeken.van('/api/plan')).toEqual([]);
  });

  test('een stop op minder dan 45 min rijden: "+" plant gewoon op die dag', async ({ page }) => {
    await startApp(page, { technieker: 'Tim' }); // standaardmatrix: overal 20 min
    await zetStops(page, [{ id: 'v1', nummer: '3894', datum: '2026-10-05', uur: '14:45', ...VER }]);
    await kaart(page, 1001).getByRole('button', { name: PLUS }).click();
    await expect(page.locator('#toast')).toHaveText('✓ Toegevoegd aan 5 okt');
    expect(await plekVan(page, 't1')).toEqual(['2026-10-05']);
  });

  test('geen enkele dag past: een toast met de reden, niets gepland, het ticket blijft in de wachtrij', async ({ page, verzoeken }) => {
    await startApp(page, { technieker: 'Tim', overschrijf: { matrix: matrix90 } });
    // Elke werkdag van de komende 60 dagen een vaste stop aan de kust (Oostduinkerke, ver buiten 45 min van Geel).
    const stops = [];
    for (let d = new Date(Date.UTC(2026, 9, 5)); d <= new Date(Date.UTC(2026, 11, 10)); d.setUTCDate(d.getUTCDate() + 1)) {
      stops.push({ id: 'k' + stops.length, nummer: String(8000 + stops.length), datum: d.toISOString().slice(0, 10), uur: '14:45', lat: 51.115, lon: 2.68 });
    }
    await zetStops(page, stops);
    await kaart(page, 1001).getByRole('button', { name: PLUS }).click();
    await expect(page.locator('#toast')).toHaveText('Geen geschikte dag gevonden in de komende 3 weken: te ver van de andere afspraken (max. 45 min rijden)');
    expect(await plekVan(page, 't1')).toEqual([]);
    await expect(kaart(page, 1001)).toBeVisible();
    await expect(kaart(page, 1001).getByRole('button', { name: PLUS })).toBeEnabled();
    // Dagen met enkel de kuststop vallen al in vogelvlucht af; enkel dagen met een stop dichtbij (bv. #1004 in Beringen) vragen
    // reistijden op, en hoogstens 30 per klik.
    expect(verzoeken.van('/api/matrix').length).toBeLessThanOrEqual(30);
  });

  test('de matrix faalt: melding en bevestiging; "Niet inplannen" plant niets, "Toch inplannen" gebruikt de vrije plek', async ({ page, consoleFouten }) => {
    await startApp(page, { technieker: 'Tim', overschrijf: { matrix: () => ({ status: 500, json: { error: 'TomTom Matrix-fout' } }) } });
    await zetStops(page, [{ id: 'v1', nummer: '3894', datum: '2026-10-05', uur: '14:45', ...VER }]);
    const dialoog = page.getByRole('alertdialog', { name: 'Reistijd niet gecontroleerd' });

    await kaart(page, 1001).getByRole('button', { name: PLUS }).click();
    await expect(dialoog).toBeVisible();
    await expect(dialoog).toContainText('De reistijd kon niet gecontroleerd worden');
    await expect(dialoog).toContainText('Toch inplannen op 5 okt');
    await dialoog.getByRole('button', { name: 'Niet inplannen' }).click();
    await expect(dialoog).toBeHidden();
    expect(await plekVan(page, 't1')).toEqual([]);
    await expect(kaart(page, 1001).getByRole('button', { name: PLUS })).toBeEnabled();

    await kaart(page, 1001).getByRole('button', { name: PLUS }).click();
    await dialoog.getByRole('button', { name: 'Toch inplannen' }).click();
    await expect(page.locator('#toast')).toHaveText('✓ Toegevoegd aan 5 okt');
    expect(await plekVan(page, 't1')).toEqual(['2026-10-05']);

    // De mislukte matrixopvragingen (HTTP 500) staan als verwachte consolemeldingen; verder niets.
    await expect.poll(() => consoleFouten.filter(f => f.includes('/api/matrix')).length).toBeGreaterThan(0);
    for (const f of consoleFouten.filter(f => f.includes('/api/matrix'))) consoleFouten.splice(consoleFouten.indexOf(f), 1);
  });

  test('"+" toont bezig tijdens het rekenen en een dubbele klik plant maar één keer', async ({ page }) => {
    let los;
    const poort = new Promise(r => { los = r; });
    await startApp(page, { technieker: 'Tim', overschrijf: { matrix: async (req) => { await poort; return matrix90(req); } } });
    await zetStops(page, [{ id: 'v1', nummer: '3894', datum: '2026-10-05', uur: '14:45', ...VER }]);
    const knop = kaart(page, 1001).getByRole('button', { name: PLUS });
    await knop.click();
    await expect(knop).toBeDisabled();
    await expect(knop).toHaveAttribute('aria-busy', 'true');
    // Een tweede klik (ook rechtstreeks via de data-actie) doet niets zolang de eerste loopt.
    await page.evaluate(() => document.querySelector('[data-actie="wq-inplannen"][data-ticket-id="t1"]').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    los();
    await expect(page.locator('#toast')).toHaveText('✓ Toegevoegd aan 6 okt');
    expect(await plekVan(page, 't1')).toEqual(['2026-10-06']);
  });

  test('"+ Voeg toe aan planning" in het ticketdetail volgt dezelfde regels', async ({ page }) => {
    await startApp(page, { technieker: 'Tim', overschrijf: { matrix: matrix90 } });
    await zetStops(page, [{ id: 'v1', nummer: '3894', datum: '2026-10-05', uur: '14:45', ...VER }]);
    await page.getByRole('button', { name: 'Open ticket #1001' }).click();
    await page.locator('#d-plan-btn').click();
    await expect(page.locator('#toast')).toHaveText('✓ Toegevoegd aan 6 okt');
    expect(await plekVan(page, 't1')).toEqual(['2026-10-06']);
    await expect(page.locator('#d-num')).toBeHidden();
  });
});
