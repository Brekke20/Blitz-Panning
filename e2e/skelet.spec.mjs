// Skeleton-laadschermen (kern/skelet.js): bij een trage lading staat er na ~150 ms een skelet (aria-hidden) en het vak is aria-busy;
// daarna verdwijnt het en staat de echte inhoud er; bij een snelle lading, of als er al inhoud staat, verschijnt er nooit een skelet.
// Alles tegen stubs (een stub die 1 s wacht = een trage server); er verlaat niets de pagina.
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { test, expect, startApp, kiesHoofdtab, opslagStub, standaardStub } from './helpers.mjs';
import { maakSalesBackend, authIkVoor, SALES_GEBRUIKER, verwachtFout } from './sales-hulp.mjs';
import { STANDAARD_GRENZEN } from '../public/js/kern/dashboard-grenzen.js';

const MAP = path.dirname(url.fileURLToPath(import.meta.url));
const DASHBOARD = JSON.parse(fs.readFileSync(path.join(MAP, 'fixtures', 'dashboard.json'), 'utf8'));
const json = (status, obj) => ({ status, json: obj });
const wacht = (ms) => new Promise(r => setTimeout(r, ms));
// Een trage server: dezelfde stub, maar het antwoord komt pas na `ms`.
const trager = (stub, ms = 1200) => async (a) => { await wacht(ms); return stub(a); };

// Noteert elk skelet dat in de pagina verschijnt (met de aria-toestand op dat moment): een snelle lading mag er geen laten zien.
async function volgSkeletten(page) {
  await page.addInitScript(() => {
    if (window !== window.top) return;
    window.__skeletten = [];
    new MutationObserver((lijst) => {
      for (const m of lijst) for (const n of m.addedNodes) {
        if (n.nodeType === 1 && n.classList.contains('skelet')) {
          window.__skeletten.push({ vorm: n.dataset.skelet, verborgen: n.getAttribute('aria-hidden'), busy: n.parentElement?.getAttribute('aria-busy'), vak: n.parentElement?.id || n.parentElement?.className, tickets: n.classList.contains('skelet--tickets') });
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
}
// De wachtrij (testmodus: dummy-tickets na 400 ms) toont bij de start zelf een skelet; de andere schermen worden zonder dat vak bekeken.
// De skeletten van Kalender, Ingepland en Route (L1, `skelet--tickets`) staan zolang de tickets onbekend zijn al in de DOM (onzichtbaar tot 150 ms
// na de start van de ticketlading; e2e/productie/skelet-tickets.spec.mjs test ze): ze horen niet bij de schermen die deze specs bekijken.
const gezien = async (page, { metWachtrij = false } = {}) => (await page.evaluate(() => window.__skeletten)).filter(s => !s.tickets && (metWachtrij || s.vak !== 'ticket-list'));

const GEBRUIKERS = [
  { id: 'u-test', email: 'b@test.be', naam: 'Test Beheerder', rol: 'beheerder', actief: true, laatsteLogin: null, aangemaakt: '2026-09-01T08:00:00.000Z', moetWachtwoordWijzigen: false },
  { id: 'u-t1', email: 'tim@test.be', naam: 'Tim Techniek', rol: 'technieker', zohoNaam: 'Tim', actief: true, laatsteLogin: null, aangemaakt: '2026-09-03T08:00:00.000Z', moetWachtwoordWijzigen: false },
];
const gebruikersStub = ({ methode }) => (methode === 'GET' ? json(200, { gebruikers: structuredClone(GEBRUIKERS) }) : json(400, { error: 'x' }));

test.describe('skelet: Beheer', () => {
  test('Performance: trage lading toont tegels- en blokkenskelet (aria-hidden, aria-busy), daarna de echte inhoud zonder skelet', async ({ page }) => {
    await volgSkeletten(page);
    await page.addInitScript(() => { if (window === window.top) sessionStorage.setItem('blitz_beheer_tab', 'performance'); });
    await startApp(page, {
      overschrijf: {
        dashboard: trager(() => json(200, structuredClone(DASHBOARD))),
        'dashboard-instellingen': opslagStub({ versie: 1, grenzen: structuredClone(STANDAARD_GRENZEN) }, 'grenzen'),
      },
    });
    await page.getByRole('tab', { name: 'Beheer', exact: true }).click();
    const inhoud = page.locator('.dash-inhoud');
    await expect(inhoud.locator('.skelet[data-skelet="tegels"]')).toBeVisible();
    await expect(inhoud.locator('.skelet')).toHaveAttribute('aria-hidden', 'true');
    await expect(inhoud).toHaveAttribute('aria-busy', 'true');
    await expect(inhoud.locator('.skelet-melding')).toHaveText('Laden…'); // voor schermlezers
    await expect(page.locator('.tegels > .tegel')).toHaveCount(6);
    await expect(page.locator('.skelet')).toHaveCount(0);
    await expect(inhoud).not.toHaveAttribute('aria-busy', /.*/);
    // Een tweede lading (filter) toont het skelet niet meer: de oude inhoud blijft staan.
    const voor = (await gezien(page)).length;
    await page.locator('[data-actie="dashboard-preset"]').nth(1).click();
    await expect(page.locator('.tegels > .tegel')).toHaveCount(6);
    expect((await gezien(page)).length).toBe(voor);
  });

  test('Performance: een snelle lading toont nooit een skelet', async ({ page }) => {
    await volgSkeletten(page);
    await page.addInitScript(() => { if (window === window.top) sessionStorage.setItem('blitz_beheer_tab', 'performance'); });
    await startApp(page, {
      overschrijf: {
        dashboard: () => json(200, structuredClone(DASHBOARD)),
        'dashboard-instellingen': opslagStub({ versie: 1, grenzen: structuredClone(STANDAARD_GRENZEN) }, 'grenzen'),
      },
    });
    await page.getByRole('tab', { name: 'Beheer', exact: true }).click();
    await expect(page.locator('.tegels > .tegel')).toHaveCount(6);
    expect(await gezien(page)).toEqual([]);
    await expect(page.locator('.dash-inhoud')).not.toHaveAttribute('aria-busy', /.*/);
  });

  test('Performance: een 503 maakt plaats voor de bestaande foutmelding (geen skelet blijven staan)', async ({ page, consoleFouten }) => {
    await page.addInitScript(() => { if (window === window.top) sessionStorage.setItem('blitz_beheer_tab', 'performance'); });
    await startApp(page, {
      overschrijf: {
        dashboard: trager(() => json(503, { error: 'De opslag is tijdelijk niet bereikbaar.', code: 'opslag-storing' }), 600),
        'dashboard-instellingen': opslagStub({ versie: 1, grenzen: structuredClone(STANDAARD_GRENZEN) }, 'grenzen'),
      },
    });
    await page.getByRole('tab', { name: 'Beheer', exact: true }).click();
    await expect(page.locator('.dash-inhoud .skelet')).toBeVisible();
    await expect(page.locator('.dash-melding--fout')).toBeVisible();
    await expect(page.locator('.skelet')).toHaveCount(0);
    await verwachtFout(consoleFouten, '/api/dashboard', 503);
  });

  test('Gebruikers: trage lijst toont tabelrijen als skelet, daarna de tabel', async ({ page }) => {
    await startApp(page, { overschrijf: { gebruikers: trager(gebruikersStub) } });
    await page.getByRole('tab', { name: 'Beheer', exact: true }).click();
    const lijst = page.locator('.bg-lijst');
    await expect(lijst.locator('.skelet[data-skelet="rijen"]')).toBeVisible();
    await expect(lijst).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('.bg-tabel tbody tr')).toHaveCount(2);
    await expect(page.locator('.skelet')).toHaveCount(0);
    await expect(lijst).not.toHaveAttribute('aria-busy', /.*/);
  });

  test('Instellingen: het paneel is leeg tot de gebruikerslijst er is: formulierskelet op paneelniveau', async ({ page }) => {
    await startApp(page, {
      overschrijf: {
        gebruikers: trager(gebruikersStub),
        instellingen: (a) => (a.query.get('gebruiker') ? json(200, { versie: 1, instellingen: null }) : standaardStub('instellingen')(a)),
      },
    });
    await page.getByRole('tab', { name: 'Beheer', exact: true }).click();
    await page.getByRole('tab', { name: 'Instellingen', exact: true }).click();
    const paneel = page.locator('#beheer-paneel');
    await expect(paneel.locator('.skelet[data-skelet="formulier"]')).toBeVisible();
    await expect(paneel).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByLabel('Gebruiker', { exact: true })).toBeVisible();
    await expect(page.locator('.skelet')).toHaveCount(0);
    await expect(paneel).not.toHaveAttribute('aria-busy', /.*/);
  });
});

test.describe('skelet: Sales', () => {
  const startSales = async (page, { vertraging = 1200, leads = [], sales } = {}) => {
    const backend = maakSalesBackend({ leads });
    const echt = backend.stubs.sales;
    await startApp(page, {
      loginRol: 'sales',
      overschrijf: { 'auth-ik': authIkVoor(SALES_GEBRUIKER), ...backend.stubs, sales: sales ?? trager(echt, vertraging) },
    });
    await expect(page.getByRole('tab', { name: 'Leads', exact: true })).toBeVisible();
  };
  const LEAD = { id: 'l1', naam: 'Verhaegen', voornaam: 'Lotte', status: 'te-plannen', bezoeken: [] };

  test('Leads: trage lading toont kaartenskelet (aria-busy), daarna de leads zonder skelet', async ({ page }) => {
    await startSales(page, { leads: [LEAD] });
    const inhoud = page.locator('#view-sales-lijst .sales-inhoud');
    await expect(inhoud.locator('.skelet[data-skelet="kaarten"]')).toBeVisible();
    await expect(inhoud.locator('.skelet')).toHaveAttribute('aria-hidden', 'true');
    await expect(inhoud).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('#view-sales-lijst .sales-kaart')).toHaveCount(1);
    await expect(page.locator('#view-sales-lijst .skelet')).toHaveCount(0);
    await expect(inhoud).not.toHaveAttribute('aria-busy', /.*/);
  });

  test('Route (sales): trage lading toont lijst + kaartvlak als skelet', async ({ page }) => {
    await startSales(page, { leads: [LEAD] });
    await page.getByRole('tab', { name: 'Route', exact: true }).click();
    await expect(page.locator('#view-sales-route .skelet[data-skelet="route"]')).toBeVisible();
    await expect(page.locator('#view-sales-route .skelet')).toHaveCount(0);
    await expect(page.locator('#view-sales-route .sales-inhoud')).not.toHaveAttribute('aria-busy', /.*/);
  });

  test('een snelle lading toont nooit een skelet, ook niet bij het wisselen van tab', async ({ page }) => {
    await volgSkeletten(page);
    await startSales(page, { leads: [LEAD], vertraging: 0 });
    await expect(page.locator('#view-sales-lijst .sales-kaart')).toHaveCount(1);
    await page.getByRole('tab', { name: 'Kalender', exact: true }).click();
    await expect(page.locator('#view-sales-kalender .sales-kal')).toBeVisible();
    expect(await gezien(page)).toEqual([]);
  });

  test('terug naar een tab die al inhoud heeft: de inhoud blijft staan en ververst stil, zonder skelet', async ({ page }) => {
    await volgSkeletten(page);
    let trage = false;
    const backend = maakSalesBackend({ leads: [LEAD] });
    await startApp(page, {
      loginRol: 'sales',
      overschrijf: { 'auth-ik': authIkVoor(SALES_GEBRUIKER), ...backend.stubs, sales: async (a) => { if (trage) await wacht(1000); return backend.stubs.sales(a); } },
    });
    await expect(page.locator('#view-sales-lijst .sales-kaart')).toHaveCount(1);
    await page.getByRole('tab', { name: 'Kalender', exact: true }).click();
    await expect(page.locator('#view-sales-kalender .sales-kal')).toBeVisible();
    const voor = (await gezien(page)).length;
    trage = true;
    await page.getByRole('tab', { name: 'Leads', exact: true }).click();
    await expect(page.locator('#view-sales-lijst .sales-kaart')).toHaveCount(1); // meteen zichtbaar, de herlading loopt nog
    await expect(page.locator('#view-sales-lijst .sales-inhoud')).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('#view-sales-lijst .sales-inhoud')).not.toHaveAttribute('aria-busy', /.*/);
    await expect(page.locator('#view-sales-lijst .skelet')).toHaveCount(0);
    expect((await gezien(page)).length).toBe(voor);
  });

  test('een 503 opslag-storing maakt plaats voor de bestaande foutmelding met Opnieuw', async ({ page, consoleFouten }) => {
    const sales = trager(() => json(503, { error: 'De opslag is tijdelijk niet bereikbaar. Probeer het zo meteen opnieuw.', code: 'opslag-storing' }), 700);
    await startSales(page, { sales });
    await expect(page.locator('#view-sales-lijst .skelet')).toBeVisible();
    const view = page.locator('#view-sales-lijst');
    await expect(view.getByRole('button', { name: 'Opnieuw' })).toBeVisible();
    await expect(page.locator('#view-sales-lijst .skelet')).toHaveCount(0);
    await expect(page.locator('#view-sales-lijst .sales-inhoud')).not.toHaveAttribute('aria-busy', /.*/);
    await verwachtFout(consoleFouten, '/api/sales', 503);
  });
});

test.describe('skelet: Wachtrij', () => {
  test('de eerste lading toont kaartenskelet zolang de wachtrij leeg is (aria-busy); daarna de tickets zonder skelet', async ({ page }) => {
    await volgSkeletten(page);
    await startApp(page); // testmodus: de dummy-tickets komen na 400 ms (> 150 ms, dus het skelet verschijnt)
    const sk = await gezien(page, { metWachtrij: true });
    expect(sk).toHaveLength(1);
    expect(sk[0]).toMatchObject({ vorm: 'kaarten', verborgen: 'true', busy: 'true', vak: 'ticket-list' });
    await expect(page.locator('#ticket-list .ticket')).toHaveCount(3);
    await expect(page.locator('#ticket-list .skelet')).toHaveCount(0);
    await expect(page.locator('#ticket-list')).not.toHaveAttribute('aria-busy', /.*/);
    await expect(page.locator('#empty-tickets')).toBeHidden(); // de "Laden..."-tekst is weer netjes weg
  });
});

// L2: Rapporten en Inventaris tonen bij de eerste lading een rijenskelet i.p.v. de platte tekst "Laden…" (de vaste beginregels uit index.html
// zijn dan verborgen); een verversing met een bestaande lijst of een bewaarde kopie toont nooit een skelet.
const RAPPORT = (id, nr) => ({ id, ticketId: `t-${id}`, ticketNumber: nr, datum: '2026-10-07', technieker: 'Tim', klant: `Klant ${nr}`, rapportData: { _html: `<p>${nr}</p>`, start: '10:00', stop: '11:00' } });
const ARCHIEF = { versie: 3, rapports: [RAPPORT('r1', '1002'), RAPPORT('r2', '1003')] };
const archiefStub = () => json(200, structuredClone(ARCHIEF));
const INVENTARIS = { versie: 2, wagenvoorraad: {}, log: [] };
const inventarisStub = () => json(200, structuredClone(INVENTARIS));

test.describe('skelet: Rapporten en Inventaris (L2)', () => {
  test('Rapporten: de eerste lading toont rijenskelet (aria-busy, "Laden…" verborgen), daarna de rapporten zonder skelet', async ({ page }) => {
    await volgSkeletten(page);
    await startApp(page, { loginRol: 'beheerder', overschrijf: { 'rapport-archief': trager(archiefStub, 3000) } });
    await page.getByRole('tab', { name: 'Rapporten', exact: true }).click();
    const body = page.locator('#rapp-archief-body');
    await expect(body.locator('.skelet[data-skelet="rijen"]')).toHaveCount(1);
    await expect(body.locator('.skelet')).toHaveAttribute('aria-hidden', 'true');
    await expect(body).toHaveAttribute('aria-busy', 'true');
    await expect(body.locator('.skelet-melding')).toHaveText('Laden…'); // voor schermlezers
    await expect(page.locator('#rapp-archief-laden')).toBeHidden(); // de vaste "Laden…"-tekst is verborgen zolang het skelet staat
    await expect(body.locator('.ticket')).toHaveCount(2);
    await expect(body.locator('.skelet')).toHaveCount(0);
    await expect(body).not.toHaveAttribute('aria-busy', /.*/);
    expect((await gezien(page)).filter(s => s.vak === 'rapp-archief-body')).toHaveLength(1); // precies één skelet (de opstart- en de tablading delen het)
  });

  test('Rapporten: een snelle lading toont nooit een skelet', async ({ page }) => {
    await volgSkeletten(page);
    await startApp(page, { loginRol: 'beheerder', overschrijf: { 'rapport-archief': archiefStub } });
    await page.getByRole('tab', { name: 'Rapporten', exact: true }).click();
    await expect(page.locator('#rapp-archief-body .ticket')).toHaveCount(2);
    expect(await gezien(page)).toEqual([]);
    await expect(page.locator('#rapp-archief-body')).not.toHaveAttribute('aria-busy', /.*/);
  });

  test('Rapporten: een tweede bezoek met een bestaande lijst toont geen skelet: de lijst blijft staan tijdens het verversen', async ({ page }) => {
    await volgSkeletten(page);
    let traag = false;
    const stub = async (a) => { if (traag) await wacht(1500); return archiefStub(a); };
    await startApp(page, { loginRol: 'beheerder', overschrijf: { 'rapport-archief': stub } });
    await page.getByRole('tab', { name: 'Rapporten', exact: true }).click();
    await expect(page.locator('#rapp-archief-body .ticket')).toHaveCount(2);
    const voor = (await gezien(page)).length;
    traag = true;
    await page.getByRole('tab', { name: 'Kalender', exact: true }).click();
    await page.getByRole('tab', { name: 'Rapporten', exact: true }).click();
    await page.waitForTimeout(400); // ruim voorbij 150 ms met het antwoord nog onderweg
    await expect(page.locator('#rapp-archief-body .ticket')).toHaveCount(2);
    expect((await gezien(page)).length).toBe(voor);
    await expect(page.locator('#rapp-archief-body .skelet')).toHaveCount(0);
  });

  test('Rapporten: een fout bij de eerste lading maakt plaats voor de bestaande foutregel (geen skelet blijven staan)', async ({ page, consoleFouten }) => {
    await startApp(page, { loginRol: 'beheerder', overschrijf: { 'rapport-archief': trager(() => json(500, { error: 'x' }), 600) } });
    await page.getByRole('tab', { name: 'Rapporten', exact: true }).click();
    await expect(page.locator('#rapp-archief-body')).toContainText('Laden mislukt');
    await expect(page.locator('#rapp-archief-body .skelet')).toHaveCount(0);
    await expect(page.locator('#rapp-archief-body')).not.toHaveAttribute('aria-busy', /.*/);
    await verwachtFout(consoleFouten, '/api/rapport-archief', 500);
  });

  test('Inventaris: de eerste lading zonder kopie toont rijenskelet (aria-busy, "Laden..." verborgen), daarna de voorraad zonder skelet', async ({ page }) => {
    await volgSkeletten(page);
    await startApp(page, { technieker: 'Tim', overschrijf: { inventaris: trager(inventarisStub, 3000) } });
    await kiesHoofdtab(page, /Inventaris/);
    const body = page.locator('#inventaris-body');
    await expect(body.locator('.skelet[data-skelet="rijen"]')).toHaveCount(1);
    await expect(body).toHaveAttribute('aria-busy', 'true');
    await expect(body.locator('.inv-empty')).toBeHidden();
    await expect(page.locator('#inv-edit-btn')).toBeVisible();
    await expect(body.locator('.skelet')).toHaveCount(0);
    await expect(body).not.toHaveAttribute('aria-busy', /.*/);
  });

  test('Inventaris: met een bewaarde kopie nooit een skelet', async ({ page }) => {
    await volgSkeletten(page);
    await page.addInitScript((k) => { if (window === window.top) localStorage.setItem('blitz_inventaris_cache_test', JSON.stringify(k)); }, INVENTARIS);
    await startApp(page, { technieker: 'Tim', overschrijf: { inventaris: trager(inventarisStub, 1500) } });
    await kiesHoofdtab(page, /Inventaris/);
    await page.waitForTimeout(400);
    expect((await gezien(page)).filter(s => s.vak === 'inventaris-body')).toEqual([]);
    await expect(page.locator('#inv-edit-btn')).toBeVisible();
  });

  test('Inventaris: een snelle lading toont nooit een skelet', async ({ page }) => {
    await volgSkeletten(page);
    await startApp(page, { technieker: 'Tim', overschrijf: { inventaris: inventarisStub } });
    await kiesHoofdtab(page, /Inventaris/);
    await expect(page.locator('#inv-edit-btn')).toBeVisible();
    expect(await gezien(page)).toEqual([]);
  });
});

test.describe('skelet: uitzicht', () => {
  for (const [naam, thema] of [['donker', 'dark'], ['licht', 'light']]) {
    test(`de blokken hebben een shimmer-verloop in het ${naam} thema en een tegen reduced motion uitgeschakelde animatie`, async ({ page }) => {
      await page.addInitScript((t) => { if (window === window.top) localStorage.setItem('blitz_theme', t); }, thema);
      await page.addInitScript(() => {
        if (window !== window.top) return;
        // Een eigen skelet op de pagina, zodat het uitzicht los van een trage lading getest wordt.
        document.addEventListener('DOMContentLoaded', () => {
          const div = document.createElement('div');
          div.id = 'skelet-proef';
          div.innerHTML = '<div class="skelet"><div class="skelet-blok skelet-regel"></div></div>';
          document.body.append(div);
        });
      });
      await startApp(page);
      const stijl = () => page.locator('#skelet-proef .skelet-blok').evaluate(el => { const s = getComputedStyle(el); return { animatie: s.animationName, achtergrond: s.backgroundImage }; });
      const normaal = await stijl();
      expect(normaal.animatie).toBe('skelet-shimmer');
      expect(normaal.achtergrond).toContain('linear-gradient');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      expect((await stijl()).animatie).toBe('none');
    });
  }
});
