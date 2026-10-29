// O3 stap A: Kalender en Ingepland tekenen bij het openen van hun tab enkel opnieuw als er iets veranderd kan zijn
// (schermen/kalender.js activeerKalender, schermen/ingepland.js activeerGepland, abonnement op ALLE sleutels in app.js koppelRenders).
// - Zonder wijziging: Kalender -> Wachtrij -> Kalender geeft +0 renders (idem Ingepland).
// - ELKE sleutel van kern.toestand (SLEUTELS) die verandert terwijl het tabblad verborgen is: +1 render bij de volgende opening.
// - Een nieuwe dag, een venstermaat- of weergavewissel en een rolwissel terwijl het tabblad verborgen is: +1.
// - Een gewijzigd rapportarchief tekent de kalender nog (de directe renderKalender() van rapport-archief.js blijft werken, ook bij
//   een zichtbare kalender) en een rapportkaartje opent zijn rapport.
// Testklok: maandag 5 okt 2026 (VASTE_NU); alle verzoeken zijn gestubd.
import { test, expect, startApp } from './helpers.mjs';
import { seed } from './kalender-hulp.mjs';

const TAB = { kalender: '#tab-kalender', gepland: '#tab-gepland', wachtrij: '#tab-tickets' };
const TELLER = { kalender: () => kern.kalender.renderTelling(), gepland: () => kern.ingepland.renderTelling() };
const telling = (page, scherm) => page.evaluate(TELLER[scherm]);

// Wacht tot alles wat uit een klik of wijziging volgt (microtasks, een animatieframe, een timeout van 0) afgelopen is.
const rust = (page) => page.evaluate(() => new Promise((klaar) => {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const kanaal = new MessageChannel();
    kanaal.port1.onmessage = () => setTimeout(() => klaar(true), 0);
    kanaal.port2.postMessage(0);
  }));
}));
const open = async (page, tab) => { await page.locator(TAB[tab]).click(); await rust(page); };

// Verandert `wijzig()` terwijl `scherm` verborgen is (Wachtrij open), dan geeft de volgende opening precies +1; `verwacht` = +n.
async function hertekentBijOpenen(page, scherm, wijzig, verwacht = 1) {
  await open(page, scherm);
  await open(page, 'wachtrij');
  await wijzig();
  await rust(page);
  const voor = await telling(page, scherm);
  await open(page, scherm);
  expect(await telling(page, scherm) - voor).toBe(verwacht);
  await expect(page.locator(scherm === 'kalender' ? '#view-kalender' : '#view-gepland')).toHaveClass(/active/);
}

const spoel = (page, sleutel) => page.evaluate((k) => { kern.toestand.raak(k); kern.toestand.spoel(); }, sleutel);

test.describe('O3: tab openen zonder wijziging', () => {
  for (const scherm of ['kalender', 'gepland']) {
    test(`${scherm}: Wachtrij en terug zonder wijziging tekent niet opnieuw`, async ({ page }) => {
      await startApp(page, { overschrijf: seed() });
      await open(page, scherm); // eerste bezoek: de render van de start gebeurde verborgen, dus hier wel tekenen
      await open(page, 'wachtrij');
      const voor = await telling(page, scherm);
      for (let i = 0; i < 3; i++) { await open(page, scherm); await open(page, 'wachtrij'); }
      expect(await telling(page, scherm)).toBe(voor);
    });
  }

  test('het eerste bezoek tekent (de start tekende verborgen) en de inhoud klopt', async ({ page }) => {
    await startApp(page, { overschrijf: seed() });
    const voor = await telling(page, 'kalender');
    await open(page, 'kalender');
    expect(await telling(page, 'kalender') - voor).toBe(1);
    await expect(page.locator('.tl-ticket[data-ticket-id="p1"]')).toContainText('#1004');
  });

  test('de kalender scrolt bij elke opening naar de werkdag, ook zonder hertekening', async ({ page }) => {
    await startApp(page, { overschrijf: seed() });
    await open(page, 'kalender');
    await open(page, 'wachtrij');
    await page.evaluate(() => { document.getElementById('week-grid').scrollTop = 0; });
    const voor = await telling(page, 'kalender');
    await open(page, 'kalender');
    expect(await telling(page, 'kalender')).toBe(voor);
    await expect.poll(() => page.evaluate(() => document.getElementById('week-grid').scrollTop)).toBeGreaterThan(0);
  });
});

test.describe('O3: elke toestandssleutel die verandert terwijl het tabblad verborgen is, hertekent bij de volgende opening', () => {
  test('Kalender en Ingepland: alle sleutels uit SLEUTELS', async ({ page }) => {
    test.setTimeout(120000);
    await startApp(page, { overschrijf: seed() });
    // De lijst komt uit de module zelf (kern.toestand geeft ze niet mee): een nieuwe sleutel wordt zo automatisch meegetest.
    const alle = await page.evaluate(async () => (await import('/js/kern/toestand.js')).SLEUTELS);
    expect(alle.length).toBeGreaterThanOrEqual(11);
    for (const scherm of ['kalender', 'gepland']) {
      for (const sleutel of alle) {
        await test.step(`${scherm}: ${sleutel}`, async () => {
          await hertekentBijOpenen(page, scherm, () => spoel(page, sleutel));
          // En daarna, zonder nieuwe wijziging, niet nog eens.
          await open(page, 'wachtrij');
          const voor = await telling(page, scherm);
          await open(page, scherm);
          expect(await telling(page, scherm)).toBe(voor);
        });
      }
    }
  });
});

test.describe('O3: de inhoud is vers na een wijziging buiten de renderabonnementen', () => {
  test('voorstelStatus (kalender is er niet op geabonneerd): het tijdslotlabel verandert bij terugkeer', async ({ page }) => {
    await startApp(page, { overschrijf: seed() });
    await open(page, 'kalender');
    await open(page, 'wachtrij');
    await page.evaluate(() => { kern.toestand.get('voorstelStatus').p1 = { tijdslot: 'ZZ-TIJDSLOT', tijdslotDatum: '2026-10-07' }; kern.toestand.raak('voorstelStatus'); kern.toestand.spoel(); });
    await open(page, 'kalender');
    await expect(page.locator('.tl-ticket[data-ticket-id="p1"]')).toContainText('ZZ-TIJDSLOT');
  });

  test('planning: een nieuwe stop verschijnt bij terugkeer in de kalender', async ({ page }) => {
    await startApp(page, { overschrijf: seed() });
    await open(page, 'kalender');
    await open(page, 'wachtrij');
    await page.evaluate(() => {
      const ticket = { id: 'nieuw1', number: '9777', subject: 'Nieuwe stop', status: 'Wachten op bevestiging planning', assignee: 'Tim', account: 'Klant', address: 'Straat 1, 2000 Antwerpen', hasAddress: true, interventieDatum: null };
      (kern.toestand.get('planning')['2026-10-06'] ??= []).push({ ticket, address: ticket.address, uur: '10:00' });
      kern.toestand.raak('planning'); kern.toestand.spoel();
    });
    await open(page, 'kalender');
    await expect(page.locator('.tl-ticket[data-ticket-id="nieuw1"]')).toContainText('#9777');
  });

  test('klantbeschikbaarheid bewaren (verwachte duur): de kalender hertekent bij terugkeer en het blok wordt hoger', async ({ page }) => {
    await startApp(page, { overschrijf: seed() });
    await open(page, 'kalender');
    const hoogte = () => page.locator('.tl-ticket[data-ticket-id="p1"]').evaluate(el => el.offsetHeight);
    const voor = await hoogte();
    await open(page, 'wachtrij');
    await page.evaluate(() => kern.klantbeschikbaarheid.saveKbAll('p1', { duur: 400 }));
    await rust(page);
    const teller = await telling(page, 'kalender');
    await open(page, 'kalender');
    expect(await telling(page, 'kalender') - teller).toBe(1);
    expect(await hoogte()).toBeGreaterThan(voor);
  });

  test('voorstelStatus: ook Ingepland toont bij terugkeer het nieuwe tijdslot', async ({ page }) => {
    await startApp(page, { overschrijf: seed() });
    await open(page, 'gepland');
    await open(page, 'wachtrij');
    await page.evaluate(() => {
      const ticket = kern.toestand.get('allGepland')[0];
      const datum = ticket.interventieDatum.slice(0, 10);
      kern.toestand.get('voorstelStatus')[ticket.id] = { tijdslot: 'ZZ-GEPLAND', tijdslotDatum: datum };
      kern.toestand.raak('voorstelStatus'); kern.toestand.spoel();
    });
    await open(page, 'gepland');
    await expect(page.locator('#gep-body')).toContainText('ZZ-GEPLAND');
  });
});

test.describe('O3: invoer buiten de toestand', () => {
  for (const scherm of ['kalender', 'gepland']) {
    test(`${scherm}: een nieuwe dag terwijl het tabblad verborgen is hertekent`, async ({ page }) => {
      await startApp(page, { overschrijf: seed() });
      await hertekentBijOpenen(page, scherm, () => page.clock.setFixedTime(new Date('2026-10-06T09:00:00+02:00')));
    });

    test(`${scherm}: weergave computer -> gsm -> computer terwijl het tabblad verborgen is hertekent telkens`, async ({ page }) => {
      await startApp(page, { overschrijf: seed() });
      await hertekentBijOpenen(page, scherm, () => page.evaluate(() => window.zetWeergave('gsm')));
      if (scherm === 'kalender') await expect(page.locator('#week-grid')).not.toHaveClass(/tl-mode/);
      await hertekentBijOpenen(page, scherm, () => page.evaluate(() => window.zetWeergave('computer')));
      if (scherm === 'kalender') await expect(page.locator('#week-grid')).toHaveClass(/tl-mode/);
    });

    test(`${scherm}: een rolwissel (late auth) terwijl het tabblad verborgen is hertekent`, async ({ page }) => {
      await startApp(page, { overschrijf: seed() });
      await hertekentBijOpenen(page, scherm, () => page.evaluate(() => window.zetLoginRol('technieker', { planEigen: true })));
    });

    test(`${scherm}: een venstermaatwissel terwijl het tabblad verborgen is hertekent`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 720 });
      await startApp(page, { overschrijf: seed() });
      await hertekentBijOpenen(page, scherm, () => page.setViewportSize({ width: 1280, height: 900 }));
    });
  }

  test('kalender: na een vensterwissel terwijl verborgen vult het raster het nieuwe venster', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await startApp(page, { overschrijf: seed() });
    await open(page, 'kalender');
    await open(page, 'wachtrij');
    await page.setViewportSize({ width: 1280, height: 950 });
    await rust(page);
    await open(page, 'kalender');
    await expect.poll(() => page.evaluate(() => {
      const r = document.getElementById('week-grid').getBoundingClientRect();
      return Math.abs(r.bottom - (window.innerHeight - 16 - window.scrollY));
    })).toBeLessThanOrEqual(2);
  });
});

// Het rapportarchief: rapport-archief.js roept na een gewijzigd archief zelf renderKalender() aan; de overslag zit enkel in het tabpad.
const rapport = (id, nr, extra = {}) => ({ id, ticketId: `t-${id}`, ticketNumber: nr, datum: '2026-10-07', technieker: 'Tim', klant: `Klant ${nr}`, rapportData: { _html: `<p>${nr}</p>`, start: '10:00', stop: '11:00' }, ...extra });
const OK = (versie, rapports) => ({ status: 200, json: { versie, rapports } });
function archiefStub(begin) {
  const stand = { antwoord: begin, aanroepen: 0 };
  return { stand, stub: () => { stand.aanroepen++; return stand.antwoord; } };
}
const herlaadArchief = (page) => page.evaluate(() => document.querySelector('[data-actie="rapport-herlaad"]').click());
const kaartje = (page, nr) => page.locator('.cal-ticket.afgerond, .tl-report', { hasText: `#${nr}` }).first();

async function openKaartje(page, nr) {
  const [popup] = await Promise.all([page.waitForEvent('popup'), kaartje(page, nr).click()]);
  await popup.waitForLoadState('load');
  await expect.poll(() => popup.evaluate(() => document.querySelector('iframe')?.getAttribute('srcdoc') || '')).toContain(nr);
  await popup.close();
}

test.describe('O3: rapportarchief en kalender', () => {
  test('archief gewijzigd geladen terwijl de kalender verborgen is: +1 bij terugkeer, nieuwe kaartjes openen hun rapport', async ({ page }) => {
    const s = archiefStub(OK(3, [rapport('r1', '1002'), rapport('r2', '1003')]));
    await startApp(page, { loginRol: 'beheerder', technieker: 'all', overschrijf: { ...seed(), 'rapport-archief': s.stub } });
    await expect.poll(() => s.stand.aanroepen).toBeGreaterThanOrEqual(1); // de start laadt het archief al
    await open(page, 'kalender');
    await open(page, 'wachtrij');
    s.stand.antwoord = OK(4, [rapport('r1', '1002'), rapport('r2', '1003'), rapport('r3', '1004')]);
    // Het Rapporten-tabblad laadt het gewijzigde archief (kalender verborgen).
    await page.locator('#tab-rapporten').click();
    await expect(page.locator('#rapp-archief-body .ticket')).toHaveCount(3);
    await rust(page);
    const voor = await telling(page, 'kalender');
    await open(page, 'kalender');
    expect(await telling(page, 'kalender') - voor).toBe(1);
    for (const nr of ['1002', '1003', '1004']) await expect(kaartje(page, nr)).toBeVisible();
    await openKaartje(page, '1004');
    await openKaartje(page, '1002');
    // Daarna opnieuw weg en terug zonder wijziging: niet nog eens tekenen en de kaartjes werken nog.
    await open(page, 'wachtrij');
    const voor2 = await telling(page, 'kalender');
    await open(page, 'kalender');
    expect(await telling(page, 'kalender')).toBe(voor2);
    await openKaartje(page, '1003');
  });

  test('een gewijzigd archief terwijl de kalender open en onveranderd is: de directe render loopt (niet overgeslagen) en het nieuwe kaartje opent', async ({ page }) => {
    const s = archiefStub(OK(3, [rapport('r1', '1002'), rapport('r2', '1003')]));
    await startApp(page, { loginRol: 'beheerder', technieker: 'all', overschrijf: { ...seed(), 'rapport-archief': s.stub } });
    await page.locator('#tab-rapporten').click();
    await expect(page.locator('#rapp-archief-body .ticket')).toHaveCount(2);
    await open(page, 'kalender');
    await open(page, 'wachtrij');
    await open(page, 'kalender'); // zichtbaar getekend en onveranderd
    await expect(kaartje(page, '1002')).toBeVisible();
    await expect(kaartje(page, '1004')).toHaveCount(0);
    const voor = await telling(page, 'kalender');
    const aanroepen = s.stand.aanroepen;
    s.stand.antwoord = OK(4, [rapport('r1', '1002'), rapport('r2', '1003'), rapport('r3', '1004')]);
    await herlaadArchief(page); // de kalender blijft het zichtbare tabblad
    await expect.poll(() => s.stand.aanroepen).toBeGreaterThan(aanroepen);
    await expect(kaartje(page, '1004')).toBeVisible();
    expect(await telling(page, 'kalender') - voor).toBeGreaterThanOrEqual(1);
    await openKaartje(page, '1004');
    await openKaartje(page, '1002');
  });

  test('een gewijzigd archief terwijl de kalender verborgen is, daarna een tabwissel: de kaartjes verwijzen naar de nieuwe lijst', async ({ page }) => {
    const s = archiefStub(OK(3, [rapport('r1', '1002'), rapport('r2', '1003')]));
    await startApp(page, { loginRol: 'beheerder', technieker: 'all', overschrijf: { ...seed(), 'rapport-archief': s.stub } });
    await page.locator('#tab-rapporten').click();
    await expect(page.locator('#rapp-archief-body .ticket')).toHaveCount(2);
    await open(page, 'kalender');
    await page.locator('#tab-rapporten').click();
    s.stand.antwoord = OK(4, [rapport('r3', '1004'), rapport('r1', '1002'), rapport('r2', '1003')]); // andere volgorde: indexen schuiven op
    const aanroepen = s.stand.aanroepen;
    await herlaadArchief(page);
    await expect.poll(() => s.stand.aanroepen).toBeGreaterThan(aanroepen);
    await expect(page.locator('#rapp-archief-body .ticket')).toHaveCount(3);
    await rust(page);
    await open(page, 'kalender');
    await expect(kaartje(page, '1004')).toBeVisible();
    await openKaartje(page, '1002');
    await openKaartje(page, '1004');
  });
});
