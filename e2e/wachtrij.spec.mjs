import { test, expect, startApp } from './helpers.mjs';
import { zetInstellingenTim } from './route-hulp.mjs';
import { seed, dag, voegStopsToe } from './kalender-hulp.mjs';

// Karakterisering van de wachtrij-tab (etappe 4, taak 1): zoeken, sorteren, tags, snelinplannen (`+`),
// kaartklik en de lege staat. Alle verwachtingen beschrijven het gedrag van vóór de verhuizing.
// Klok: maandag 5 okt 2026 09:00. DUMMY_DATA, filter 'all': #1001 (Tim, high, verlopen, aangemaakt 18 jun),
// #1002 (Tim, medium, 20 jun), #1003 (Roel, low, 21 jun).

const nummers = (page) => page.locator('#ticket-list .ticket .tnum').allTextContents();
const zoekVeld = (page) => page.locator('#wq-zoek');
const teller = (page) => page.locator('#wq-teller');

// Zoeken heeft een debounce van 150 ms: wacht op het effect (de nummers van de kaarten), nooit op een vaste tijd.
async function zoek(page, tekst, verwacht) {
  await zoekVeld(page).fill(tekst);
  await expect(page.locator('#ticket-list .ticket .tnum')).toHaveText(verwacht);
}
const ALLE = ['#1001', '#1002', '#1003'];

test.describe('wachtrij: zoeken', () => {
  test('zoeken op nummer, met of zonder #, en de teller', async ({ page }) => {
    await startApp(page);
    await expect(teller(page)).toHaveText('3 tickets');
    await expect(page.locator('#ticket-list .ticket')).toHaveCount(3);

    await zoek(page, '1002', ['#1002']);
    await expect(teller(page)).toHaveText('1 van 3 tickets');
    // De badge toont het totaal vóór het zoeken.
    await expect(page.locator('#cnt-tickets')).toHaveText('3');

    // Het # valt weg.
    await zoek(page, '', ALLE);
    await zoek(page, '#1002', ['#1002']);
    await expect(teller(page)).toHaveText('1 van 3 tickets');
    await expect(page.locator('#cnt-tickets')).toHaveText('3');
  });

  test('zoeken is hoofdletter- en accentongevoelig en alle woorden moeten voorkomen', async ({ page }) => {
    await startApp(page);
    await zoek(page, 'PARKING hasselt', ['#1002']);

    // Accent in de zoektekst, geen accent in de data.
    await zoek(page, 'résidentie', ['#1003']);

    // Twee woorden, in willekeurige volgorde; beide moeten voorkomen (hier bij hetzelfde ticket: account + regio).
    await zoek(page, '', ALLE);
    await zoek(page, 'limburg parking', ['#1002']);
    // Twee woorden die bij verschillende tickets horen: geen resultaat.
    await zoek(page, 'parking turnhout', []);
    await expect(teller(page)).toHaveText('0 van 3 tickets');
  });

  test('geen resultaat toont de lege tekst; wissen brengt de oorspronkelijke tekst terug', async ({ page }) => {
    await startApp(page);
    const leeg = page.locator('#empty-tickets');
    const oorspronkelijk = await leeg.textContent();
    await expect(leeg).toBeHidden();

    await zoek(page, 'xyz', []);
    await expect(leeg).toBeVisible();
    await expect(leeg).toHaveText("Geen tickets gevonden voor 'xyz'");

    await zoek(page, '', ALLE);
    await expect(leeg).toBeHidden();
    await expect(leeg).toHaveText(oorspronkelijk);
    await expect(teller(page)).toHaveText('3 tickets');
  });
});

test.describe('wachtrij: sorteren', () => {
  test('vier sorteeropties, elk met een eigen volgorde, bewaard in localStorage en na herladen nog actief', async ({ page }) => {
    await startApp(page);
    const sel = page.locator('#wq-sorteer');
    const lijst = page.locator('#ticket-list .ticket .tnum');
    const bewaard = () => page.evaluate(() => localStorage.getItem('blitz_wachtrij_sorteer'));
    // Gemeten uit DUMMY_DATA: standaard = verlopen eerst (#1001), daarna queueScore (medium 3 vóór low 6).
    await expect(lijst).toHaveText(['#1001', '#1002', '#1003']);

    // Eigen data zodat elke optie een andere volgorde geeft (geen verlopen ticket meer):
    //   aangemaakt: #1001 18 jun, #1002 19 jun, #1003 20 jun
    //   interventie: #1001 +3 d, #1002 +5 d, #1003 +1 d
    //   queueScore: #1001 high 1 x 3/7 = 0,43; #1003 low 6 x 1/7 = 0,86; #1002 medium 3 x 5/7 = 2,14
    await page.evaluate(() => {
      const dagen = (n) => new Date(Date.now() + n * 86400000).toISOString();
      const data = { t1: ['2026-06-18T08:00:00Z', 3], t2: ['2026-06-19T08:00:00Z', 5], t3: ['2026-06-20T08:00:00Z', 1] };
      for (const t of kern.toestand.get('allTickets')) {
        t.createdTime = data[t.id][0];
        t.interventieDatum = dagen(data[t.id][1]);
      }
      kern.toestand.raak('allTickets');
    });
    // Standaard: score oplopend.
    await expect(lijst).toHaveText(['#1001', '#1003', '#1002']);
    await expect(page.locator('#ticket-list .ticket.overdue')).toHaveCount(0);

    await sel.selectOption('oudst');
    await expect(sel).toHaveValue('oudst');
    await expect(lijst).toHaveText(['#1001', '#1002', '#1003']);
    expect(await bewaard()).toBe('oudst');

    await sel.selectOption('nieuwst');
    await expect(lijst).toHaveText(['#1003', '#1002', '#1001']);
    expect(await bewaard()).toBe('nieuwst');

    await sel.selectOption('interventie');
    await expect(lijst).toHaveText(['#1003', '#1001', '#1002']);
    expect(await bewaard()).toBe('interventie');

    await sel.selectOption('standaard');
    await expect(lijst).toHaveText(['#1001', '#1003', '#1002']);
    expect(await bewaard()).toBe('standaard');

    // Na herladen blijft de laatst gekozen volgorde staan (select én volgorde; de data is weer DUMMY_DATA).
    await sel.selectOption('nieuwst');
    await page.reload();
    await expect(page.locator('#cnt-tickets')).toHaveText('3');
    await expect(sel).toHaveValue('nieuwst');
    await expect(lijst).toHaveText(['#1003', '#1002', '#1001']);
  });
});

test.describe('wachtrij: tags', () => {
  test('verlopen-tag op #1001, niet op de andere', async ({ page }) => {
    await startApp(page);
    const k1 = page.locator('#ticket-list .ticket').filter({ hasText: '#1001' });
    await expect(k1).toHaveClass(/overdue/);
    await expect(k1.locator('.stag')).toHaveText('Verlopen');
    const k2 = page.locator('#ticket-list .ticket').filter({ hasText: '#1002' });
    await expect(k2).not.toHaveClass(/overdue/);
    await expect(k2.locator('.stag')).toHaveCount(0);
  });

  test('klantvoorkeur toont de 📌-, 🕐- en 🚫-tags met hun titelteksten', async ({ page }) => {
    const klant = {
      t1: { voorkeur: '2026-10-09', voorkeurTijd: '10:00', geblokkeerd: ['2026-10-06', '2026-10-07'] },
      t2: { voorkeurTijd: '14:00' },
    };
    // Deterministisch: het klantbeschikbaarheid-antwoord wordt vastgehouden tot de wachtrij zonder tags getekend is (de
    // klantbeschikbaarheid komt dus later binnen dan de tickets); de tags moeten dan alsnog verschijnen.
    const overschrijf = seed({ klant });
    const echt = overschrijf.klantbeschikbaarheid;
    let laatDoorgaan;
    const poort = new Promise(r => { laatDoorgaan = r; });
    overschrijf.klantbeschikbaarheid = async (arg) => { await poort; return echt(arg); };
    await startApp(page, { overschrijf });
    const k1 = page.locator('#ticket-list .ticket').filter({ hasText: '#1001' });
    await expect(k1).toBeVisible();
    await expect(k1.locator('.atag[title^="Voorkeursdatum"]')).toHaveCount(0);
    laatDoorgaan();
    const voorkeur1 = k1.locator('.atag[title^="Voorkeursdatum"]');
    await expect(voorkeur1).toContainText('📌');
    await expect(voorkeur1).toContainText('10:00');
    await expect(voorkeur1).toHaveAttribute('title', 'Voorkeursdatum klant: 2026-10-09 — Voorkeursuur klant: 10:00');
    const geblokkeerd = k1.locator('.atag[title^="Klant kan niet"]');
    await expect(geblokkeerd).toHaveText('🚫 2');
    await expect(geblokkeerd).toHaveAttribute('title', 'Klant kan niet: 2026-10-06, 2026-10-07');

    // Enkel een voorkeursuur: 🕐-tag, geen 📌 en geen 🚫.
    const k2 = page.locator('#ticket-list .ticket').filter({ hasText: '#1002' });
    const voorkeur2 = k2.locator('.atag[title^="Voorkeursuur"]');
    await expect(voorkeur2).toHaveText('🕐 14:00');
    await expect(voorkeur2).toHaveAttribute('title', 'Voorkeursuur klant: 14:00');
    await expect(k2.locator('.atag[title^="Klant kan niet"]')).toHaveCount(0);

    // Positief tegenstuk: #1003 heeft niets.
    const k3 = page.locator('#ticket-list .ticket').filter({ hasText: '#1003' });
    await expect(k3.locator('.atag[title]')).toHaveCount(0);
  });
});

const PLUS = 'Inplannen op eerstvolgende vrije dag';

test.describe('wachtrij: snelinplannen met +', () => {
  test('plant op de eerste dag met vrije capaciteit; het detail opent niet', async ({ page, verzoeken }) => {
    await startApp(page, { technieker: 'Tim', overschrijf: seed() });
    await expect(page.locator('#cnt-tickets')).toHaveText('2');
    await expect(page.locator('#ticket-list .ticket .tnum').first()).toHaveText('#1001');

    await page.locator('#ticket-list .ticket').first().getByRole('button', { name: PLUS }).click();

    // Gemeten: maandag 5 okt is de eerste werkdag met vrije capaciteit (cap 3 bij 120 min + 30 min reistijd).
    await expect(page.locator('#toast')).toHaveText('✓ Toegevoegd aan 5 okt');
    await expect(page.locator('#cnt-tickets')).toHaveText('1');
    expect(await nummers(page)).toEqual(['#1002']);
    // Het detailvenster is niet geopend (de klik bubbelt niet naar de kaart).
    await expect(page.locator('#d-num')).toBeHidden();
    expect(verzoeken.van('/api/plan')).toEqual([]);

    await page.getByRole('tab', { name: 'Kalender' }).click();
    const maandag = dag(page, '2026-10-05');
    // Zonder tijdstip: het ticket staat als chip in de dagkop (zie 'Zonder uur'), niet als tijdlijnblok.
    await expect(maandag.locator('.zu-chip')).toHaveText('#1001');
    // Brent-besluit (proefperiode): 1 stop van 4 (de echte vrije tijd laat nog 3 tickets toe), ±(120 + 30) / 60 = 2,5 uur.
    await expect(maandag.locator('.day-cap')).toHaveText('1/4 stops · ±2.5u');
  });

  test('volle dag: het volgende ticket gaat naar de volgende werkdag', async ({ page, verzoeken }) => {
    await startApp(page, { technieker: 'Tim', overschrijf: seed() });
    // Brent-besluit (proefperiode): "vol" is nu echte vrije tijd + maxPerDag (4), niet meer 3 slots. Vier stops zonder uur
    // (aankomst 08:30, 11:00, 13:30, 16:00) vullen de maandag; het volgende ticket gaat naar dinsdag.
    await voegStopsToe(page, [
      { id: 'x1', nummer: '9001', datum: '2026-10-05' },
      { id: 'x2', nummer: '9002', datum: '2026-10-05' },
      { id: 'x3', nummer: '9003', datum: '2026-10-05' },
      { id: 'x4', nummer: '9004', datum: '2026-10-05' },
    ]);
    await page.locator('#ticket-list .ticket').first().getByRole('button', { name: PLUS }).click();
    await expect(page.locator('#toast')).toHaveText('✓ Toegevoegd aan 6 okt');
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await expect(dag(page, '2026-10-05').locator('.day-cap')).toHaveText('4/4 stops · ±10u');
    await expect(dag(page, '2026-10-06').locator('.zu-chip')).toHaveText('#1001');
    expect(verzoeken.van('/api/plan')).toEqual([]);
  });

  test('een hele-dag-blokkade wordt overgeslagen', async ({ page }) => {
    const maandagBlok = { id: 'b9', scope: 'global', person: null, date: '2026-10-05', kind: 'fullday', from: null, to: null, reason: 'Studiedag' };
    await startApp(page, { technieker: 'Tim', overschrijf: seed({ blokkades: [maandagBlok] }) });
    await page.locator('#ticket-list .ticket').first().getByRole('button', { name: PLUS }).click();
    await expect(page.locator('#toast')).toHaveText('✓ Toegevoegd aan 6 okt');
  });

  test('een feestdag wordt overgeslagen', async ({ page }) => {
    // Alle dagen van 5 okt tot en met 10 nov zijn geblokkeerd; 11 nov (Wapenstilstand) is een feestdag.
    const blokkades = [];
    for (let d = new Date(Date.UTC(2026, 9, 5)); d <= new Date(Date.UTC(2026, 10, 10)); d.setUTCDate(d.getUTCDate() + 1)) {
      blokkades.push({ id: `bb${blokkades.length}`, scope: 'global', person: null, date: d.toISOString().slice(0, 10), kind: 'fullday', from: null, to: null, reason: '' });
    }
    await startApp(page, { technieker: 'Tim', overschrijf: seed({ blokkades }) });
    await page.locator('#ticket-list .ticket').first().getByRole('button', { name: PLUS }).click();
    // Gemeten: woensdag 11 nov is een feestdag (capaciteit 0), dus donderdag 12 nov.
    await expect(page.locator('#toast')).toHaveText('✓ Toegevoegd aan 12 nov');
  });

  test('geen vrije werkdag in 60 dagen geeft een toast en laat het ticket staan', async ({ page, verzoeken }) => {
    await zetInstellingenTim(page, { maxPerDag: 0 });
    await startApp(page, { technieker: 'Tim' });
    await page.locator('#ticket-list .ticket').first().getByRole('button', { name: PLUS }).click();
    await expect(page.locator('#toast')).toHaveText('Geen beschikbare werkdag gevonden');
    await expect(page.locator('#cnt-tickets')).toHaveText('2');
    expect(await nummers(page)).toEqual(['#1001', '#1002']);
    expect(verzoeken.van('/api/plan')).toEqual([]);
  });
});

test.describe('wachtrij: kaart en lege staat', () => {
  test('een klik op de kaart opent het detail', async ({ page }) => {
    await startApp(page);
    await page.locator('#ticket-list .ticket').filter({ hasText: '#1002' }).locator('.tsub').click();
    await expect(page.locator('#d-num')).toHaveText('#1002');
  });

  test('Enter op de gefocuste kaart opent het detail; de kaart is een knop met label', async ({ page }) => {
    await startApp(page);
    const kaart = page.locator('#ticket-list .ticket').filter({ hasText: '#1003' });
    await expect(kaart).toHaveAttribute('role', 'button');
    await expect(kaart).toHaveAttribute('tabindex', '0');
    await expect(kaart).toHaveAttribute('aria-label', 'Open ticket #1003');
    await kaart.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#d-num')).toHaveText('#1003');
  });

  test('zonder tickets toont de lege staat zijn tekst', async ({ page }) => {
    await startApp(page, { technieker: 'Roel' });
    await expect(page.locator('#ticket-list .ticket')).toHaveCount(1);
    await expect(page.locator('#empty-tickets')).toBeHidden();
    await page.locator('#ticket-list .ticket').getByRole('button', { name: PLUS }).click();
    await expect(page.locator('#cnt-tickets')).toHaveText('0');
    await expect(page.locator('#ticket-list .ticket')).toHaveCount(0);
    await expect(page.locator('#empty-tickets')).toBeVisible();
    // Bewust gewijzigd (fix W5): vroeger bleef hier de beginwaarde 'Laden...' staan; nu de bestaande
    // app-tekst uit autoPlan.
    await expect(page.locator('#empty-tickets')).toHaveText('Geen tickets om in te plannen');
    await expect(teller(page)).toHaveText('0 tickets');
  });
});
