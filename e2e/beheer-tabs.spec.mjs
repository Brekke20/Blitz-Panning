// Beheerpagina, tabs Instellingen, Activiteitenlog en Systeemstatus (logins T18). Alle stubs bevatten enkel verzonnen gegevens.
import { test, expect, startApp, standaardStub } from './helpers.mjs';

const json = (status, obj) => ({ status, json: obj });

const GEBRUIKERS = () => [
  { id: 'u-test', email: 'b@test.be', naam: 'Test Beheerder', rol: 'beheerder', actief: true, laatsteLogin: null, aangemaakt: '2026-09-01T08:00:00.000Z', moetWachtwoordWijzigen: false },
  { id: 'u-t1', email: 'tim@test.be', naam: 'Tim Techniek', rol: 'technieker', zohoNaam: 'Tim', actief: true, laatsteLogin: null, aangemaakt: '2026-09-03T08:00:00.000Z', moetWachtwoordWijzigen: false },
  { id: 'u-s1', email: 'sara@test.be', naam: 'Sara Sales', rol: 'sales', actief: true, laatsteLogin: null, aangemaakt: '2026-09-04T08:00:00.000Z', moetWachtwoordWijzigen: false },
];

const TIM = { startlocatie: 'Teststraat 1, 2000 Antwerpen', duurMinuten: 90, maxPerDag: 5, vanTijd: '07:30', totTijd: '16:30', laatsteStart: '15:00', werkdagen: [1, 2, 3, 4], maxReistijdMin: 40, tijdslotMinuten: 120, routeKleur: '#123456', kaartStijl: 'standaard', drukteKleuring: false };
const SARA = { startlocatie: 'Salesplein 2, 9000 Gent', duurMinuten: 120, maxPerDag: 4, vanTijd: '08:00', totTijd: '17:00', laatsteStart: '16:00', werkdagen: [1, 2, 3, 4, 5], maxReistijdMin: 45, tijdslotMinuten: 180, bezoekDuurMin: 75 };

// Stub voor /api/instellingen: ?gebruiker=<id> leest, PUT schrijft; de rest (overzicht bij het opstarten) blijft de standaard.
function instellingenStub({ begin = { 'u-t1': TIM, 'u-s1': SARA }, weiger, naEersteLezing } = {}) {
  const opslag = structuredClone(begin);
  const standaard = standaardStub('instellingen');
  const lezingen = {};
  const stub = (a) => {
    if (a.methode === 'PUT') {
      const eigen = weiger?.(a.body);
      if (eigen) return eigen;
      opslag[a.body.gebruiker] = a.body.instellingen;
      return json(200, { versie: 7 });
    }
    const id = a.query.get('gebruiker');
    if (id === null) return standaard(a);
    // naEersteLezing: gaat vanaf de tweede lezing van dezelfde gebruiker over de bewaarde stand heen (een wijziging tussendoor).
    lezingen[id] = (lezingen[id] ?? 0) + 1;
    if (naEersteLezing && lezingen[id] === 2) opslag[id] = { ...(opslag[id] ?? {}), ...naEersteLezing };
    return json(200, { versie: 3, instellingen: opslag[id] ?? null });
  };
  return stub;
}

const gebruikersStub = (lijst = GEBRUIKERS()) => ({ methode }) => (methode === 'GET' ? json(200, { gebruikers: structuredClone(lijst) }) : json(400, { error: 'x' }));

const ITEMS = () => [
  { op: '2026-10-08T09:15:00.000Z', gebruikerId: 'u-test', naam: 'Test Beheerder', actie: 'login', onderwerp: null, details: null },
  { op: '2026-10-07T22:30:00.000Z', gebruikerId: 'u-t1', naam: 'Tim Techniek', actie: 'plannen', onderwerp: '1042', details: '2026-10-09' },
  { op: '2026-10-07T20:00:00.000Z', gebruikerId: 'systeem', naam: 'Systeem', actie: 'login-mislukt-reeks', onderwerp: 'a***@test.be', details: '<img src=x onerror=window.__xss=1>' },
  { op: '2026-10-07T08:00:00.000Z', gebruikerId: 'u-t1', naam: '<b>Tim</b>', actie: 'iets-nieuws', onderwerp: '<i>x</i>', details: 'a < b & c' },
];

// Stateful nep van /api/activiteit: past de filters toe en noteert elke querystring.
function activiteitStub({ items = ITEMS(), status = 200 } = {}) {
  const queries = [];
  const stub = ({ query }) => {
    queries.push(query.toString());
    if (status !== 200) return json(status, { error: 'De opslag is tijdelijk niet bereikbaar.' });
    const id = query.get('gebruiker'); const actie = query.get('actie');
    const gefilterd = items.filter(i => (!id || i.gebruikerId === id) && (!actie || i.actie === actie));
    const gebruikers = [...new Map(items.map(i => [i.gebruikerId, { id: i.gebruikerId, naam: i.naam }])).values()];
    return json(200, { items: gefilterd, gebruikers });
  };
  stub.queries = queries;
  return stub;
}

const STATUS_GOED = () => ({ zoho: { ok: true, tijdstip: '2026-10-08T10:00:00.000Z' }, foutenlog: [], rapporten: { mislukt: [] } });
const STATUS_SLECHT = () => ({
  zoho: { ok: false, fout: 'Zoho is niet bereikbaar.', tijdstip: '2026-10-08T10:00:00.000Z' },
  foutenlog: [
    { tijdstip: '2026-10-08T09:00:00.000Z', ticketId: '1042', stap: 'zoho-status', fout: 'Time-out <script>x</script>' },
    { tijdstip: '2026-10-08T08:00:00.000Z', ticketId: '1043', stap: 'upload', fout: 'Verbinding verbroken' },
  ],
  rapporten: { mislukt: [
    { id: 'r1', ticketNumber: '1042', technieker: 'Tim', datum: '2026-10-07', laatsteFout: 'Zoho weigerde de bijlage' },
    { id: 'r2', ticketNumber: '1050', technieker: 'Roel', datum: '2026-10-06', laatsteFout: null },
  ] },
});

async function openTab(page, naam, overschrijf = {}, app = {}) {
  await startApp(page, { ...app, overschrijf: { gebruikers: gebruikersStub(), instellingen: instellingenStub(), activiteit: activiteitStub(), systeemstatus: () => json(200, STATUS_GOED()), ...overschrijf } });
  await page.getByRole('tab', { name: 'Beheer', exact: true }).click();
  await page.getByRole('tab', { name: naam, exact: true }).click();
  await expect(page.getByRole('tab', { name: naam, exact: true })).toHaveAttribute('aria-selected', 'true');
}

// Een bedoelde 4xx/5xx meldt de browser als HTTP-fout en als consolefout; die halen we weg.
async function verwachtFout(consoleFouten, pad, status) {
  const isDeze = (f) => f.includes(pad) && f.includes(String(status));
  await expect.poll(() => consoleFouten.filter(isDeze).length).toBeGreaterThanOrEqual(1);
  for (const f of consoleFouten.filter(isDeze)) consoleFouten.splice(consoleFouten.indexOf(f), 1);
}

const paneel = (page) => page.locator('#beheer-paneel');
const geenPaginaScroll = (page) => page.evaluate(() => ({
  doc: document.documentElement.scrollWidth <= window.innerWidth,
  view: document.getElementById('view-beheer').scrollWidth <= document.getElementById('view-beheer').clientWidth,
  balk: document.querySelector('.beheer-tabs').getBoundingClientRect().right <= window.innerWidth + 0.5, // de tabbalk zelf past; zijn tabs scrollen erin
}));

test.describe('beheer: tabbalk', () => {
  test('de tabs staan in de vaste volgorde en elke tab registreert zichzelf', async ({ page }) => {
    await openTab(page, 'Instellingen');
    const namen = await page.getByRole('tab').evaluateAll(els => els.map(e => e.textContent.trim()).filter(t => ['Gebruikers', 'Instellingen', 'Activiteitenlog', 'Systeemstatus'].includes(t)));
    expect(namen).toEqual(['Gebruikers', 'Instellingen', 'Activiteitenlog', 'Systeemstatus']);
  });

  test('pijltjestoetsen gaan één stap vooruit en terug zonder te wikkelen', async ({ page }) => {
    await openTab(page, 'Instellingen');
    const tab = n => page.getByRole('tab', { name: n, exact: true });
    await tab('Gebruikers').click();
    await tab('Gebruikers').focus();
    for (const volgende of ['Instellingen', 'Activiteitenlog', 'Systeemstatus']) {
      await page.keyboard.press('ArrowRight');
      await expect(tab(volgende)).toBeFocused();
      await expect(tab(volgende)).toHaveAttribute('aria-selected', 'true');
      await expect(tab(volgende)).toHaveAttribute('tabindex', '0');
    }
    for (const vorige of ['Activiteitenlog', 'Instellingen', 'Gebruikers']) {
      await page.keyboard.press('ArrowLeft');
      await expect(tab(vorige)).toBeFocused();
      await expect(tab(vorige)).toHaveAttribute('aria-selected', 'true');
    }
  });
});

test.describe('tab Instellingen', () => {
  test('toont de waarden van de gekozen gebruiker en wisselt van gebruiker', async ({ page, verzoeken }) => {
    await openTab(page, 'Instellingen');
    const kies = paneel(page).getByLabel('Gebruiker', { exact: true });
    await kies.selectOption('u-t1');
    await expect(paneel(page).getByLabel('Startlocatie')).toHaveValue(TIM.startlocatie);
    await expect(paneel(page).getByLabel('Tijd per interventie (minuten)')).toHaveValue('90');
    await expect(paneel(page).getByLabel('Max interventies per dag')).toHaveValue('5');
    await expect(paneel(page).getByLabel('Max. reistijd tussen interventies (minuten)')).toHaveValue('40');
    await expect(paneel(page).getByLabel('Werkuren', { exact: true })).toHaveValue('07:30');
    await expect(paneel(page).getByLabel('Werkuren tot')).toHaveValue('16:30');
    await expect(paneel(page).getByLabel('Laatste start')).toHaveValue('15:00');
    await expect(paneel(page).getByLabel('Tijdslot-grootte voor klant/technieker (minuten)')).toHaveValue('120');
    const dagen = paneel(page).getByRole('group', { name: 'Werkdagen' }).getByRole('button');
    await expect(dagen.filter({ hasText: 'Ma' })).toHaveAttribute('aria-pressed', 'true');
    await expect(dagen.filter({ hasText: 'Vr' })).toHaveAttribute('aria-pressed', 'false');
    expect(verzoeken.van('/api/instellingen', 'GET').length).toBeGreaterThan(0);
    await expect(paneel(page).getByLabel('Bezoekduur (minuten)')).toBeHidden(); // technieker: geen bezoekduur
  });

  test('de bestaande validatie: een ongeldige duur toont de foutmelding en stuurt geen PUT', async ({ page, verzoeken }) => {
    await openTab(page, 'Instellingen');
    await paneel(page).getByLabel('Gebruiker', { exact: true }).selectOption('u-t1');
    await expect(paneel(page).getByLabel('Startlocatie')).toHaveValue(TIM.startlocatie);
    await paneel(page).getByLabel('Tijd per interventie (minuten)').fill('10');
    await page.getByRole('button', { name: 'Opslaan' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Minimale interventieduur is 15 minuten' })).toBeVisible();
    expect(verzoeken.van('/api/instellingen', 'PUT')).toEqual([]);
  });

  test('opslaan stuurt PUT met gebruiker en behoudt velden die het formulier niet toont', async ({ page, verzoeken }) => {
    await openTab(page, 'Instellingen');
    await paneel(page).getByLabel('Gebruiker', { exact: true }).selectOption('u-t1');
    await expect(paneel(page).getByLabel('Startlocatie')).toHaveValue(TIM.startlocatie);
    await paneel(page).getByLabel('Tijd per interventie (minuten)').fill('105');
    await paneel(page).getByRole('group', { name: 'Werkdagen' }).getByRole('button', { name: 'Vr' }).click();
    await page.getByRole('button', { name: 'Opslaan' }).click();
    await expect(page.locator('#toast')).toContainText('Instellingen opgeslagen');
    const put = verzoeken.van('/api/instellingen', 'PUT');
    expect(put).toHaveLength(1);
    expect(put[0].body.gebruiker).toBe('u-t1');
    expect(put[0].body.instellingen).toMatchObject({
      startlocatie: TIM.startlocatie, duurMinuten: 105, maxPerDag: 5, vanTijd: '07:30', totTijd: '16:30', laatsteStart: '15:00',
      maxReistijdMin: 40, tijdslotMinuten: 120, werkdagen: expect.arrayContaining([1, 2, 3, 4, 5]),
      routeKleur: '#123456', kaartStijl: 'standaard', drukteKleuring: false,
    });
    expect(put[0].body.instellingen.bezoekDuurMin).toBeUndefined();
  });

  test('een sales-gebruiker toont en bewaart de bezoekduur', async ({ page, verzoeken }) => {
    await openTab(page, 'Instellingen');
    await paneel(page).getByLabel('Gebruiker', { exact: true }).selectOption('u-s1');
    const veld = paneel(page).getByLabel('Bezoekduur (minuten)');
    await expect(veld).toHaveValue('75');
    await veld.fill('90');
    await page.getByRole('button', { name: 'Opslaan' }).click();
    await expect(page.locator('#toast')).toContainText('Instellingen opgeslagen');
    expect(verzoeken.van('/api/instellingen', 'PUT')[0].body).toMatchObject({ gebruiker: 'u-s1', instellingen: { bezoekDuurMin: 90 } });
    await veld.fill('2');
    await page.getByRole('button', { name: 'Opslaan' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Bezoekduur moet tussen 15 en 480 minuten liggen' })).toBeVisible();
    expect(verzoeken.van('/api/instellingen', 'PUT')).toHaveLength(1);
  });

  test('een sales-gebruiker zonder bewaarde bezoekduur toont een lege waarde met placeholder en bewaart geen 60', async ({ page, verzoeken }) => {
    await openTab(page, 'Instellingen', { instellingen: instellingenStub({ begin: { 'u-s1': { ...SARA, bezoekDuurMin: undefined } } }) });
    await paneel(page).getByLabel('Gebruiker', { exact: true }).selectOption('u-s1');
    const veld = paneel(page).getByLabel('Bezoekduur (minuten)');
    await expect(paneel(page).getByLabel('Startlocatie')).toHaveValue(SARA.startlocatie);
    await expect(veld).toHaveValue('');
    await expect(veld).toHaveAttribute('placeholder', 'Standaard 60');
    await page.getByRole('button', { name: 'Opslaan' }).click();
    await expect(page.locator('#toast')).toContainText('Instellingen opgeslagen');
    expect(verzoeken.van('/api/instellingen', 'PUT')[0].body.instellingen).not.toHaveProperty('bezoekDuurMin');
  });

  test('vlak vóór het opslaan wordt de stand opnieuw gelezen: een tussentijdse wijziging van verborgen velden blijft bewaard', async ({ page, verzoeken }) => {
    await openTab(page, 'Instellingen', { instellingen: instellingenStub({ naEersteLezing: { routeKleur: '#abcdef', drukteKleuring: true, kaartStijl: 'satelliet' } }) });
    await paneel(page).getByLabel('Gebruiker', { exact: true }).selectOption('u-t1');
    await expect(paneel(page).getByLabel('Startlocatie')).toHaveValue(TIM.startlocatie);
    await paneel(page).getByLabel('Tijd per interventie (minuten)').fill('100');
    await page.getByRole('button', { name: 'Opslaan' }).click();
    await expect(page.locator('#toast')).toContainText('Instellingen opgeslagen');
    expect(verzoeken.van('/api/instellingen', 'PUT')[0].body.instellingen).toMatchObject({ duurMinuten: 100, routeKleur: '#abcdef', drukteKleuring: true, kaartStijl: 'satelliet' });
  });

  test('de eigen instellingen opslaan ververst de lokale kopie en de actieve instellingen; een latere opslag in het gewone scherm draait niets terug', async ({ page, verzoeken }) => {
    await openTab(page, 'Instellingen');
    await expect(paneel(page).getByLabel('Gebruiker', { exact: true })).toHaveValue('u-test');
    await expect(paneel(page).getByLabel('Tijd per interventie (minuten)')).toHaveValue('120');
    await paneel(page).getByLabel('Tijd per interventie (minuten)').fill('100');
    await paneel(page).getByLabel('Laatste start').fill('15:30');
    await page.getByRole('button', { name: 'Opslaan' }).click();
    await expect(page.locator('#toast')).toContainText('Instellingen opgeslagen');
    const lokaal = await page.evaluate(() => ({ kopie: JSON.parse(localStorage.getItem('blitz_settings')), laatsteStart: localStorage.getItem('blitz_laatste_start') }));
    expect(lokaal.kopie.duurMinuten).toBe(100);
    expect(lokaal.laatsteStart).toBe('15:30');
    expect(await page.evaluate(async () => (await import('/js/kern/toestand.js')).toestand.get('settings').duurMinuten)).toBe(100);
    // Het gewone scherm bewaart nu zijn (verse) stand: de PUT bevat de nieuwe duur, niet de oude.
    await page.evaluate(async () => (await import('/js/schermen/instellingen.js')).savePersonSettings('all'));
    await expect.poll(() => verzoeken.van('/api/instellingen', 'PUT').length).toBe(2);
    expect(verzoeken.van('/api/instellingen', 'PUT')[1].body.instellingen.duurMinuten).toBe(100);
  });

  // UI/UX P1-3: Beheer → Instellingen is de enige plek om de werkinstellingen van een technieker te bewerken. De lokale kopie van DIE
  // technieker volgt daarom de server (anders schrijft een latere ⚙-opslag voor Tim de oude set terug); de eigen kopie blijft ongemoeid.
  test('de instellingen van een ANDERE gebruiker (technieker Tim): zijn lokale kopie volgt de server, de eigen kopie blijft met rust', async ({ page }) => {
    await openTab(page, 'Instellingen');
    await paneel(page).getByLabel('Gebruiker', { exact: true }).selectOption('u-t1');
    await expect(paneel(page).getByLabel('Startlocatie')).toHaveValue(TIM.startlocatie);
    await page.getByRole('button', { name: 'Opslaan' }).click();
    await expect(page.locator('#toast')).toContainText('Instellingen opgeslagen');
    expect(await page.evaluate(() => [localStorage.getItem('blitz_settings_Tim'), localStorage.getItem('blitz_settings')])).toEqual([expect.stringContaining('Teststraat'), expect.not.stringContaining('Teststraat')]);
  });

  test('een gebruiker zonder bewaarde instellingen toont de standaardwaarden', async ({ page }) => {
    await openTab(page, 'Instellingen');
    await expect(paneel(page).getByLabel('Gebruiker', { exact: true })).toHaveValue('u-test'); // eerste in de lijst
    await expect(paneel(page).getByLabel('Tijd per interventie (minuten)')).toHaveValue('120');
    await expect(paneel(page).getByLabel('Startlocatie')).toHaveValue('Heirbaan 9, 9150 Kruibeke');
  });

  test('een 503 bij het opslaan toont "tijdelijk niet bereikbaar" en laat de gebruiker ingelogd', async ({ page, consoleFouten }) => {
    await openTab(page, 'Instellingen', { instellingen: instellingenStub({ weiger: () => json(503, { error: 'x' }) }) });
    await paneel(page).getByLabel('Gebruiker', { exact: true }).selectOption('u-t1');
    await expect(paneel(page).getByLabel('Startlocatie')).toHaveValue(TIM.startlocatie);
    await page.getByRole('button', { name: 'Opslaan' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'tijdelijk niet bereikbaar' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Instellingen', exact: true })).toBeVisible();
    await verwachtFout(consoleFouten, '/api/instellingen', 503);
  });

  test('een servernaam met HTML verschijnt als tekst in de keuzelijst', async ({ page }) => {
    const lijst = GEBRUIKERS(); lijst[1].naam = '<img src=x onerror=window.__xss=1>';
    await openTab(page, 'Instellingen', { gebruikers: gebruikersStub(lijst) });
    await expect(paneel(page).getByLabel('Gebruiker', { exact: true }).locator('option', { hasText: '<img src=x' })).toHaveCount(1);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });

  test('375 px: geen horizontale paginascroll', async ({ page }) => {
    await openTab(page, 'Instellingen', {}, { viewport: { width: 375, height: 812 } });
    await paneel(page).getByLabel('Gebruiker', { exact: true }).selectOption('u-s1');
    await expect(paneel(page).getByLabel('Bezoekduur (minuten)')).toBeVisible();
    expect(await geenPaginaScroll(page)).toEqual({ doc: true, view: true, balk: true });
  });
});

test.describe('tab Activiteitenlog', () => {
  test('toont de laatste 30 dagen per dag, nieuwste eerst, met Brusselse tijden', async ({ page }) => {
    const stub = activiteitStub();
    await openTab(page, 'Activiteitenlog', { activiteit: stub });
    await expect(page.getByRole('heading', { name: 'donderdag 8 oktober 2026' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'woensdag 7 oktober 2026' })).toBeVisible();
    // 22:30 UTC op 7 okt = 00:30 Brussel op 8 okt
    const eerste = page.locator('.ba-dag').first();
    await expect(eerste).toContainText('00:30');
    await expect(eerste).toContainText('11:15');
    await expect(eerste).toContainText('Ingelogd');
    await expect(eerste).toContainText('Ingepland');
    expect(stub.queries[0]).toBe('van=2026-09-05&tot=2026-10-05'); // VASTE_NU is 2026-10-05 in Brussel
  });

  test('filtert op persoon, actie en periode via de querystring', async ({ page }) => {
    const stub = activiteitStub();
    await openTab(page, 'Activiteitenlog', { activiteit: stub });
    await expect(page.locator('.ba-rij')).toHaveCount(4);
    await paneel(page).getByLabel('Persoon').selectOption('u-t1');
    await expect(page.locator('.ba-rij')).toHaveCount(2);
    expect(stub.queries.at(-1)).toBe('van=2026-09-05&tot=2026-10-05&gebruiker=u-t1');
    await paneel(page).getByLabel('Actie').selectOption('plannen');
    await expect(page.locator('.ba-rij')).toHaveCount(1);
    expect(stub.queries.at(-1)).toBe('van=2026-09-05&tot=2026-10-05&gebruiker=u-t1&actie=plannen');
    await paneel(page).getByLabel('Van').fill('2026-10-01');
    await expect.poll(() => stub.queries.at(-1)).toBe('van=2026-10-01&tot=2026-10-05&gebruiker=u-t1&actie=plannen');
    await paneel(page).getByLabel('Persoon').selectOption({ label: 'Iedereen' });
    await paneel(page).getByLabel('Actie').selectOption({ label: 'Alle acties' });
    await expect.poll(() => stub.queries.at(-1)).toBe('van=2026-10-01&tot=2026-10-05');
    await expect(page.locator('.ba-rij')).toHaveCount(4);
  });

  test('details, onderwerp en naam met HTML verschijnen als tekst; een onbekende actie toont de ruwe naam', async ({ page }) => {
    await openTab(page, 'Activiteitenlog');
    await expect(page.locator('.ba-rij').filter({ hasText: 'Reeks mislukte logins' })).toContainText('<img src=x onerror=window.__xss=1>');
    await expect(page.locator('.ba-rij').filter({ hasText: 'a < b & c' })).toContainText('<b>Tim</b>');
    await expect(page.locator('.ba-rij').filter({ hasText: 'a < b & c' })).toContainText('iets-nieuws');
    await expect(page.locator('#beheer-paneel img, #beheer-paneel b, #beheer-paneel i')).toHaveCount(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });

  test('een lege uitkomst geeft een duidelijke tekst', async ({ page }) => {
    await openTab(page, 'Activiteitenlog', { activiteit: activiteitStub({ items: [] }) });
    await expect(page.getByText('Geen activiteit gevonden')).toBeVisible();
  });

  test('een 503 toont "tijdelijk niet bereikbaar"', async ({ page, consoleFouten }) => {
    await openTab(page, 'Activiteitenlog', { activiteit: activiteitStub({ status: 503 }) });
    await expect(page.getByRole('alert').filter({ hasText: 'tijdelijk niet bereikbaar' })).toBeVisible();
    await verwachtFout(consoleFouten, '/api/activiteit', 503);
  });

  test('375 px: geen horizontale paginascroll', async ({ page }) => {
    await openTab(page, 'Activiteitenlog', {}, { viewport: { width: 375, height: 812 } });
    await expect(page.locator('.ba-rij')).toHaveCount(4);
    expect(await geenPaginaScroll(page)).toEqual({ doc: true, view: true, balk: true });
  });
});

test.describe('tab Systeemstatus', () => {
  test('groen als Zoho bereikbaar is, zonder fouten of mislukte rapporten', async ({ page }) => {
    await openTab(page, 'Systeemstatus');
    const zoho = page.locator('.bs-zoho');
    await expect(zoho).toHaveAttribute('data-status', 'ok');
    await expect(zoho).toContainText('Verbonden');
    await expect(zoho).toContainText('08/10/2026 12:00');
    await expect(page.getByText('Geen recente fouten')).toBeVisible();
    await expect(page.getByText('Geen mislukte rapporten')).toBeVisible();
  });

  test('rood bij zoho.ok:false, met foutenlijst en mislukte rapporten', async ({ page }) => {
    await openTab(page, 'Systeemstatus', { systeemstatus: () => json(200, STATUS_SLECHT()) });
    const zoho = page.locator('.bs-zoho');
    await expect(zoho).toHaveAttribute('data-status', 'fout');
    await expect(zoho).toContainText('Niet bereikbaar');
    await expect(zoho).toContainText('Zoho is niet bereikbaar.');
    const fouten = page.locator('.bs-fouten tbody tr');
    await expect(fouten).toHaveCount(2);
    await expect(fouten.first()).toContainText('Time-out <script>x</script>');
    await expect(page.locator('.bs-fouten script')).toHaveCount(0);
    const rapporten = page.locator('.bs-rapporten tbody tr');
    await expect(rapporten).toHaveCount(2);
    await expect(rapporten.first()).toContainText('1042');
    await expect(rapporten.first()).toContainText('Tim');
    await expect(rapporten.first()).toContainText('Zoho weigerde de bijlage');
    await expect(rapporten.nth(1)).toContainText('1050');
    // Task 11b: bij elk mislukt rapport staat een knop "Opnieuw versturen" (de werking staat in de tests hieronder).
    await expect(page.locator('.bs-rapporten').getByRole('button', { name: 'Opnieuw versturen' })).toHaveCount(2);
  });

  describe_opnieuw();

  test('Vernieuwen haalt de status opnieuw op', async ({ page }) => {
    let n = 0;
    await openTab(page, 'Systeemstatus', { systeemstatus: () => json(200, ++n === 1 ? STATUS_GOED() : STATUS_SLECHT()) });
    await expect(page.locator('.bs-zoho')).toHaveAttribute('data-status', 'ok');
    await page.locator('#beheer-paneel').getByRole('button', { name: 'Vernieuwen' }).click();
    await expect(page.locator('.bs-zoho')).toHaveAttribute('data-status', 'fout');
    expect(n).toBe(2);
  });

  test('een 503 toont "tijdelijk niet bereikbaar" en een Vernieuwen-knop', async ({ page, consoleFouten }) => {
    await openTab(page, 'Systeemstatus', { systeemstatus: () => json(503, { error: 'x' }) });
    await expect(page.getByRole('alert').filter({ hasText: 'tijdelijk niet bereikbaar' })).toBeVisible();
    await expect(page.locator('#beheer-paneel').getByRole('button', { name: 'Vernieuwen' })).toBeVisible();
    await verwachtFout(consoleFouten, '/api/systeemstatus', 503);
  });

  test('375 px: geen horizontale paginascroll', async ({ page }) => {
    await openTab(page, 'Systeemstatus', { systeemstatus: () => json(200, STATUS_SLECHT()) }, { viewport: { width: 375, height: 812 } });
    await expect(page.locator('.bs-rapporten tbody tr')).toHaveCount(2);
    expect(await geenPaginaScroll(page)).toEqual({ doc: true, view: true, balk: true });
  });
});

function describe_opnieuw() {
  // POST-stub voor /api/rapport-archief: antwoordt met `antwoord` (of een functie), laat GET (de archieflijst bij het opstarten) aan de standaard.
  const archiefStub = (antwoord) => {
    const standaard = standaardStub('rapport-archief');
    return (a) => (a.methode === 'POST' ? (typeof antwoord === 'function' ? antwoord(a) : antwoord) : standaard(a));
  };
  const opnieuwPosts = (page) => {
    const lijst = [];
    page.on('request', (req) => {
      if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/rapport-archief') lijst.push({ body: req.postDataJSON(), xBlitz: req.headers()['x-blitz'] });
    });
    return lijst;
  };
  const rij = (page, ticket) => page.locator('.bs-rapporten tbody tr').filter({ hasText: ticket });
  const bevestig = (page) => page.getByRole('alertdialog', { name: 'Rapport opnieuw versturen?' });

  test('Opnieuw versturen: bevestigen stuurt precies één POST { opnieuw: id } met X-Blitz, toont de toast en "opnieuw in behandeling"', async ({ page }) => {
    const posts = opnieuwPosts(page);
    await openTab(page, 'Systeemstatus', { systeemstatus: () => json(200, STATUS_SLECHT()), 'rapport-archief': archiefStub(json(200, { ok: true, versie: 4 })) });
    const eerste = rij(page, '1042');
    await eerste.getByRole('button', { name: 'Opnieuw versturen' }).click();
    await expect(bevestig(page)).toContainText('Dit rapport opnieuw naar Zoho sturen?');
    expect(posts).toEqual([]); // nog niets verstuurd voor de bevestiging
    await bevestig(page).getByRole('button', { name: 'Opnieuw versturen' }).click();
    await expect(page.getByText('Rapport staat opnieuw in de wachtrij')).toBeVisible();
    await expect(eerste).toContainText('opnieuw in behandeling');
    await expect(eerste.getByRole('button')).toHaveCount(0);
    await expect(rij(page, '1050').getByRole('button', { name: 'Opnieuw versturen' })).toBeEnabled(); // het andere rapport is onaangeroerd
    expect(posts).toEqual([{ body: { opnieuw: 'r1' }, xBlitz: '1' }]);
  });

  test('Opnieuw versturen: annuleren in de bevestiging stuurt niets en laat de knop bruikbaar', async ({ page }) => {
    const posts = opnieuwPosts(page);
    await openTab(page, 'Systeemstatus', { systeemstatus: () => json(200, STATUS_SLECHT()), 'rapport-archief': archiefStub(json(200, { ok: true })) });
    const knop = rij(page, '1042').getByRole('button', { name: 'Opnieuw versturen' });
    await knop.click();
    await bevestig(page).getByRole('button', { name: 'Terug' }).click();
    await expect(bevestig(page)).toHaveCount(0);
    await expect(knop).toBeEnabled();
    expect(posts).toEqual([]);
  });

  test('Opnieuw versturen: knop is "Bezig…" en uitgeschakeld tijdens de aanvraag; een dubbelklik stuurt nooit twee aanvragen', async ({ page }) => {
    const posts = opnieuwPosts(page);
    let vrijgeven;
    const wacht = new Promise((r) => { vrijgeven = r; });
    await openTab(page, 'Systeemstatus', { systeemstatus: () => json(200, STATUS_SLECHT()), 'rapport-archief': archiefStub(async () => { await wacht; return json(200, { ok: true }); }) });
    const knop = rij(page, '1042').getByRole('button', { name: /Opnieuw versturen|Bezig/ });
    await knop.click();
    await expect(bevestig(page)).toHaveCount(1);
    await bevestig(page).getByRole('button', { name: 'Opnieuw versturen' }).dblclick();
    await expect(knop).toHaveText('Bezig…');
    await expect(knop).toBeDisabled();
    vrijgeven();
    await expect(rij(page, '1042')).toContainText('opnieuw in behandeling');
    expect(posts).toHaveLength(1);
  });

  test('Opnieuw versturen: 503 geeft de melding "tijdelijk niet bereikbaar" en de knop is weer bruikbaar', async ({ page, consoleFouten }) => {
    const posts = opnieuwPosts(page);
    await openTab(page, 'Systeemstatus', { systeemstatus: () => json(200, STATUS_SLECHT()), 'rapport-archief': archiefStub(json(503, { error: 'Rapportarchief tijdelijk niet bereikbaar, probeer opnieuw.' })) });
    const eerste = rij(page, '1042');
    await eerste.getByRole('button', { name: 'Opnieuw versturen' }).click();
    await bevestig(page).getByRole('button', { name: 'Opnieuw versturen' }).click();
    await expect(page.getByText('De opslag is tijdelijk niet bereikbaar. Probeer het zo meteen opnieuw.')).toBeVisible();
    await expect(eerste.getByRole('button', { name: 'Opnieuw versturen' })).toBeEnabled();
    await expect(eerste).not.toContainText('opnieuw in behandeling');
    expect(posts).toHaveLength(1);
    await verwachtFout(consoleFouten, '/api/rapport-archief', 503);
  });

  test('Opnieuw versturen: een 4xx toont de servermelding', async ({ page, consoleFouten }) => {
    await openTab(page, 'Systeemstatus', { systeemstatus: () => json(200, STATUS_SLECHT()), 'rapport-archief': archiefStub(json(404, { error: 'Rapport niet gevonden' })) });
    const eerste = rij(page, '1042');
    await eerste.getByRole('button', { name: 'Opnieuw versturen' }).click();
    await bevestig(page).getByRole('button', { name: 'Opnieuw versturen' }).click();
    await expect(page.getByText('Rapport niet gevonden')).toBeVisible();
    await expect(eerste.getByRole('button', { name: 'Opnieuw versturen' })).toBeEnabled();
    await verwachtFout(consoleFouten, '/api/rapport-archief', 404);
  });

  test('Opnieuw versturen: na Vernieuwen leidt de lijst van de server', async ({ page }) => {
    let n = 0;
    await openTab(page, 'Systeemstatus', {
      systeemstatus: () => { n++; const s = STATUS_SLECHT(); if (n > 1) s.rapporten.mislukt = s.rapporten.mislukt.filter(r => r.id !== 'r1'); return json(200, s); },
      'rapport-archief': archiefStub(json(200, { ok: true })),
    });
    await rij(page, '1042').getByRole('button', { name: 'Opnieuw versturen' }).click();
    await bevestig(page).getByRole('button', { name: 'Opnieuw versturen' }).click();
    await expect(rij(page, '1042')).toContainText('opnieuw in behandeling');
    await page.locator('#beheer-paneel').getByRole('button', { name: 'Vernieuwen' }).click();
    await expect(rij(page, '1042')).toHaveCount(0);
    await expect(page.locator('.bs-rapporten tbody tr')).toHaveCount(1);
  });
}

// UI/UX-review P1-3: twee schermen voor dezelfde werkinstellingen per persoon. Voor de beheerder is Beheer → Instellingen de enige
// plek om ze te bewerken; het ⚙-venster toont ze alleen-lezen met een link. Persoonlijke/toestelkeuzes (routekleur) blijven bewerkbaar.
// ⚙ opent altijd de EIGEN instellingen (eigen Zoho-naam), los van de persoonskiezer. Zonder Zoho-naam: enkel de persoonlijke velden.
// De planner heeft geen Beheer-tab en bewerkt in ⚙ zijn eigen werkinstellingen (die van techniekers kan enkel de beheerder in Beheer).
test.describe('⚙-venster en Beheer → Instellingen: één plek om de werkinstellingen te bewerken', () => {
  const WERKVELDEN = ['#set-start', '#set-duration', '#set-max', '#set-maxreistijd', '#set-laatste-start', '#set-van', '#set-tot', '#set-tijdslot'];
  const stubs = () => ({ gebruikers: gebruikersStub(), instellingen: instellingenStub(), activiteit: activiteitStub(), systeemstatus: () => json(200, STATUS_GOED()) });
  const venster = (page) => page.getByRole('dialog', { name: '⚙️ Instellingen' });
  const openSettings = async (page) => {
    await page.getByRole('button', { name: 'Instellingen', exact: true }).click();
    await expect(venster(page)).toBeVisible();
  };

  test('beheerder met Zoho-naam: werkvelden en werkdagen alleen-lezen, routekleur bewerkbaar, met de link naar Beheer', async ({ page }) => {
    await startApp(page, { loginGebruiker: { zohoNaam: 'Brent' }, overschrijf: stubs() });
    await openSettings(page);
    for (const sel of WERKVELDEN) await expect(venster(page).locator(sel), sel).toBeDisabled();
    await expect(venster(page).locator('#days-grid .day-btn').first()).toBeDisabled();
    await expect(venster(page).getByRole('button', { name: 'Blauw' })).toBeEnabled();
    await expect(venster(page).locator('#set-drukte')).toBeEnabled();
    await expect(venster(page).locator('#set-beheer-hint')).toBeVisible();
    // Het label van "Laatste start" is in beide schermen waar: een waarde van de gebruiker zelf, niet "voor iedereen".
    await expect(venster(page).getByText('geldt voor iedereen')).toHaveCount(0);
    await expect(venster(page).locator('label[for="set-laatste-start"]')).toContainText('al je planning');
  });

  test('beheerder zonder Zoho-naam: de werkvelden zijn verborgen, enkel persoonlijke velden en een verwijzing naar Beheer', async ({ page }) => {
    await startApp(page, { overschrijf: stubs() });
    await openSettings(page);
    for (const sel of WERKVELDEN) await expect(venster(page).locator(sel), sel).toBeHidden();
    await expect(venster(page).locator('#days-grid')).toBeHidden();
    await expect(venster(page).locator('#set-routekleur')).toBeVisible();
    await expect(venster(page).locator('#set-drukte')).toBeVisible();
    await expect(venster(page).locator('#set-geen-werk-hint')).toContainText('Werkinstellingen van techniekers pas je aan in Beheer → Instellingen.');
    await expect(venster(page).locator('#set-beheer-hint')).toBeHidden();
  });

  test('de link "Aanpassen in Beheer → Instellingen" sluit het venster en opent dat tabblad; het label daar is ook waar', async ({ page }) => {
    await startApp(page, { loginGebruiker: { zohoNaam: 'Brent' }, overschrijf: stubs() });
    await openSettings(page);
    await venster(page).getByRole('button', { name: 'Aanpassen in Beheer → Instellingen' }).click();
    await expect(venster(page)).toBeHidden();
    await expect(page.getByRole('tab', { name: 'Instellingen', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(paneel(page).getByLabel('Startlocatie')).toBeVisible();
    await expect(paneel(page).getByLabel('Laatste start')).toBeVisible();
    await expect(paneel(page).locator('label[for="bi-laatste"]')).toContainText('de planning die deze gebruiker zelf maakt');
  });

  test('beheerder: Opslaan in het ⚙-venster bewaart enkel de persoonlijke keuze (routekleur); de werkwaarden blijven gelijk', async ({ page, verzoeken }) => {
    await startApp(page, { loginGebruiker: { zohoNaam: 'Brent' }, overschrijf: stubs() });
    await openSettings(page);
    const duur = await venster(page).locator('#set-duration').inputValue();
    await venster(page).getByRole('button', { name: 'Blauw' }).click();
    await venster(page).getByRole('button', { name: 'Opslaan', exact: true }).click();
    await expect(page.locator('#toast')).toContainText('Instellingen opgeslagen');
    await expect.poll(() => verzoeken.van('/api/instellingen', 'PUT').length).toBe(1);
    const put = verzoeken.van('/api/instellingen', 'PUT')[0].body.instellingen;
    expect(put.routeKleur).toBe('#2563eb');
    expect(String(put.duurMinuten)).toBe(duur);
  });

  test('planner met Zoho-naam (geen Beheer-tab): de eigen werkvelden blijven bewerkbaar en er is geen link naar Beheer', async ({ page }) => {
    await startApp(page, { loginRol: 'planner', loginGebruiker: { zohoNaam: 'Brent' }, overschrijf: stubs() });
    await openSettings(page);
    for (const sel of WERKVELDEN) await expect(venster(page).locator(sel), sel).toBeEnabled();
    await expect(venster(page).locator('#set-beheer-hint')).toBeHidden();
    await expect(venster(page).locator('#set-geen-werk-hint')).toBeHidden();
    await expect(page.getByRole('tab', { name: 'Beheer', exact: true })).toHaveCount(0);
  });

  test('planner zonder Zoho-naam: enkel persoonlijke velden, zonder verwijzing naar Beheer', async ({ page }) => {
    await startApp(page, { loginRol: 'planner', overschrijf: stubs() });
    await openSettings(page);
    for (const sel of WERKVELDEN) await expect(venster(page).locator(sel), sel).toBeHidden();
    await expect(venster(page).locator('#days-grid')).toBeHidden();
    await expect(venster(page).locator('#set-routekleur')).toBeVisible();
    await expect(venster(page).locator('#set-drukte')).toBeVisible();
    await expect(venster(page).locator('#set-geen-werk-hint')).toBeHidden();
    await expect(venster(page).locator('#set-beheer-hint')).toBeHidden();
    await venster(page).getByRole('button', { name: 'Opslaan', exact: true }).click();
    await expect(page.locator('#toast')).toHaveText('✓ Instellingen opgeslagen voor Test');
  });

  // Merge-review I1: een beheerder met een Zoho-naam leest zijn eigen planning onder die naam; Beheer → Instellingen voor zichzelf schrijft
  // hetzelfde record, dus ⚙ onder zijn eigen naam toont de nieuwe waarde (alleen-lezen, link naar Beheer blijft).
  test('beheerder met Zoho-naam: wat hij in Beheer voor zichzelf bewaart, staat daarna in ⚙ onder zijn eigen naam', async ({ page }) => {
    await startApp(page, { technieker: 'Brent', loginGebruiker: { zohoNaam: 'Brent' }, overschrijf: stubs() });
    await expect(page.locator('#person-name-hdr')).toHaveText('Brent');
    await page.getByRole('tab', { name: 'Beheer', exact: true }).click();
    await page.getByRole('tab', { name: 'Instellingen', exact: true }).click();
    await expect(paneel(page).getByLabel('Gebruiker', { exact: true })).toHaveValue('u-test'); // zichzelf
    await expect(paneel(page).getByLabel('Startlocatie')).toHaveValue('Heirbaan 9, 9150 Kruibeke');
    await paneel(page).getByLabel('Startlocatie').fill('Brentstraat 1, 2000 Antwerpen');
    await page.getByRole('button', { name: 'Opslaan' }).click();
    await expect(page.locator('#toast')).toContainText('Instellingen opgeslagen');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('blitz_settings_Brent')).startlocatie)).toBe('Brentstraat 1, 2000 Antwerpen');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('blitz_settings')).startlocatie)).toBe('Brentstraat 1, 2000 Antwerpen');
    await openSettings(page);
    await expect(venster(page).getByRole('heading', { name: '⚙️ Instellingen — Brent' })).toBeVisible();
    await expect(venster(page).locator('#set-start')).toHaveValue('Brentstraat 1, 2000 Antwerpen');
    await expect(venster(page).locator('#set-start')).toBeDisabled();
    await expect(venster(page).getByRole('button', { name: 'Aanpassen in Beheer → Instellingen' })).toBeVisible();
  });

  // ⚙ is altijd je EIGEN venster: ook als je de week van Tim bekijkt, opent de link naar Beheer bij jezelf, niet bij Tim.
  test('beheerder bekijkt Tim: ⚙ toont de eigen naam en de link naar Beheer opent bij de beheerder zelf', async ({ page }) => {
    await startApp(page, { technieker: 'Tim', loginGebruiker: { zohoNaam: 'Brent' }, overschrijf: stubs() });
    await openSettings(page);
    await expect(venster(page).getByRole('heading', { name: '⚙️ Instellingen — Brent' })).toBeVisible();
    await venster(page).getByRole('button', { name: 'Aanpassen in Beheer → Instellingen' }).click();
    await expect(paneel(page).getByLabel('Gebruiker', { exact: true })).toHaveValue('u-test');
  });

  // De beheerder bekijkt Tim en bewaart in ⚙: dat is zijn eigen record; Tim's serverrecord wordt niet aangeraakt.
  test('beheerder bekijkt Tim en bewaart in ⚙: de PUT is voor de eigen set, nooit voor Tim', async ({ page, verzoeken }) => {
    const basis = instellingenStub();
    const metTim = (a) => (a.methode === 'GET' && a.query.get('overzicht') === '1'
      ? json(200, { eigen: { gebruikerId: 'u-test', versie: 1, instellingen: null }, techniekers: { Tim: { gebruikerId: 'u-t1', instellingen: TIM } } })
      : basis(a));
    await startApp(page, { technieker: 'Tim', loginGebruiker: { zohoNaam: 'Brent' }, overschrijf: { ...stubs(), instellingen: metTim } });
    await openSettings(page);
    await venster(page).getByRole('button', { name: 'Blauw' }).click();
    await venster(page).getByRole('button', { name: 'Opslaan', exact: true }).click();
    await expect(page.locator('#toast')).toHaveText('✓ Instellingen opgeslagen voor Brent');
    await expect.poll(() => verzoeken.van('/api/instellingen', 'PUT').length).toBeGreaterThan(0);
    for (const put of verzoeken.van('/api/instellingen', 'PUT')) {
      expect(put.body.gebruiker).toBeUndefined();
      expect(put.body.instellingen.routeKleur).toBe('#2563eb');
    }
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('blitz_settings_Tim')).routeKleur)).toBe(TIM.routeKleur); // Tim ongewijzigd
  });
});
