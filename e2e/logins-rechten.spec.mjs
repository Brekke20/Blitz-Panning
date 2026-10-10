// Rechten in de client (logins T19): de rolwisselaar van de lokale testmodus, collega's alleen-lezen in het ticketdetail,
// de zichtbare tabs en knoppen per rol (Rechtentabel), een geweigerde schrijfactie (403) en een verlopen sessie.
// Alles draait tegen stubs: er verlaat niets de pagina. De server beslist altijd zelf; de client verbergt enkel knoppen.
import { test, expect, startApp, authIkStub, opslagStub } from './helpers.mjs';
import { startSalesApp, VERBODEN_PADEN_SALES } from './sales-hulp.mjs';

const json = (status, obj) => ({ status, json: obj });

// auth-ik met de vlag `lokaleDev` (de standaardstub zet hem op false, zoals productie).
const authIkLokaal = (rol, gebruiker, lokaleDev) => (z) => {
  const antwoord = authIkStub(rol, gebruiker)(z);
  antwoord.json.lokaleDev = lokaleDev;
  return antwoord;
};

// Per /api-verzoek de kop X-Blitz-Test-Rol (verzamelVerzoeken bewaart die niet). Op de context, zoals de vangnetten.
function volgTestRolKop(page) {
  const lijst = [];
  page.context().on('request', (req) => {
    const u = new URL(req.url());
    if (u.hostname !== 'localhost' || !u.pathname.startsWith('/api/')) return;
    lijst.push({ pad: u.pathname, rol: req.headers()['x-blitz-test-rol'] ?? null });
  });
  return lijst;
}

const wisselaar = (page) => page.locator('#test-rol-wissel');
const zichtbareTabs = (page) => page.locator('.tabs-inner .tab:visible');
// Een tab kan een teller dragen ("Ingepland 1"): de naam moet aan het begin staan, gevolgd door niets of een getal.
const tab = (page, naam) => page.getByRole('tab', { name: new RegExp(String.raw`^${naam}( \d+)?$`) });

// Opent het detail van een ingepland ticket (p1, #1004, van Tim). Met `assignee` een kopie dat van een collega is.
async function openPlanningDetail(page, assignee) {
  await page.evaluate((a) => {
    const stop = Object.values(kern.toestand.get('planning')).flat().find(s => s.ticket.id === 'p1');
    let t = stop.ticket;
    if (a) {
      t = { ...t, id: 'p9', number: '1009', assignee: a };
      kern.toestand.get('planning')['2026-10-07'].push({ ticket: t, address: t.address, uur: null });
    }
    kern.ticketdetail.openDetail(t);
  }, assignee ?? null);
  await expect(page.locator('#det-overlay')).toHaveClass(/open/);
}
const knop = (page, id) => page.locator('#' + id);

test.describe('rolwisselaar (lokale testmodus)', () => {
  test('met lokaleDev:true: vier rollen; kiezen zet blitz_test_rol en elk /api-verzoek na het herladen draagt X-Blitz-Test-Rol', async ({ page }) => {
    const kop = volgTestRolKop(page);
    await startApp(page, { overschrijf: { 'auth-ik': authIkLokaal('beheerder', {}, true) } });
    await expect(wisselaar(page)).toBeVisible();
    await expect(wisselaar(page)).toHaveAccessibleName('Testrol');
    expect(await wisselaar(page).locator('option').evaluateAll(o => o.map(x => x.value))).toEqual(['beheerder', 'planner', 'technieker', 'sales']);
    await expect(wisselaar(page)).toHaveValue('beheerder'); // standaard van testRolVoorHeader
    await expect(page.locator('#test-badge')).toBeVisible();

    kop.length = 0;
    await wisselaar(page).selectOption('technieker');
    await expect.poll(() => kop.some(r => r.pad === '/api/auth-ik')).toBe(true); // een nieuwe pagina is gestart
    await expect(page.locator('#cnt-tickets')).toHaveText('3');
    expect(await page.evaluate(() => localStorage.getItem('blitz_test_rol'))).toBe('technieker');
    await expect(wisselaar(page)).toHaveValue('technieker');
    expect(kop.length).toBeGreaterThan(0);
    for (const r of kop) expect(r, r.pad).toEqual({ pad: r.pad, rol: 'technieker' });
  });

  test('met lokaleDev:false (productie met ?test): geen wisselaar en na de eerste auth-ik draagt geen verzoek X-Blitz-Test-Rol, ook niet met een oude keuze', async ({ page }) => {
    await page.addInitScript(() => { if (window === window.top) localStorage.setItem('blitz_test_rol', 'planner'); });
    const kop = volgTestRolKop(page);
    await startApp(page, { overschrijf: { 'auth-ik': authIkLokaal('beheerder', {}, false) } });
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await expect(wisselaar(page)).toHaveCount(0);
    // Enkel de allereerste auth-ik gaat nog zonder weet van de vlag de deur uit (de server negeert de kop buiten lokale dev).
    expect(kop[0].pad).toBe('/api/auth-ik');
    expect(kop.length).toBeGreaterThan(1);
    expect(kop.slice(1).filter(r => r.rol !== null)).toEqual([]);
  });

  test('zonder ?test bestaat de wisselaar niet, ook niet bij lokaleDev:true', async ({ page }) => {
    // startApp opent altijd ?test; deze test laadt dezelfde pagina daarna zonder.
    await startApp(page, { overschrijf: { 'auth-ik': authIkLokaal('beheerder', {}, true) } });
    await page.goto('/');
    await expect(tab(page, 'Kalender')).toBeVisible();
    await expect(wisselaar(page)).toHaveCount(0);
  });
});

test.describe('ticketdetail: collega\'s alleen-lezen', () => {
  const SCHRIJF = ['d-btn-arrival', 'd-btn-fotos', 'd-btn-rapport'];

  test('technieker (Tim) bij een ticket van Roel: geen Aankomst, Foto\'s of Rapport; wel de contactknoppen', async ({ page }) => {
    await startApp(page, { loginRol: 'technieker' });
    await openPlanningDetail(page, 'Roel');
    for (const id of SCHRIJF) await expect(knop(page, id), id).toBeHidden();
    await expect(page.locator('#d-title')).toHaveText('Energiemeting klopt niet'); // het detail zelf blijft leesbaar
    await expect(page.locator('#d-contact a[href^="tel:"]')).toBeVisible();
  });

  test('technieker (Tim) bij een eigen ticket: Aankomst, Foto\'s en Rapport zijn er', async ({ page }) => {
    await startApp(page, { loginRol: 'technieker' });
    await openPlanningDetail(page);
    for (const id of SCHRIJF) await expect(knop(page, id), id).toBeVisible();
  });

  test('de naamvergelijking negeert hoofdletters en spaties', async ({ page }) => {
    await startApp(page, { loginRol: 'technieker' });
    await openPlanningDetail(page, '  tim ');
    for (const id of SCHRIJF) await expect(knop(page, id), id).toBeVisible();
  });

  test('een technieker zonder zohoNaam kan geen enkel ticket schrijven', async ({ page }) => {
    await startApp(page, { loginRol: 'technieker', loginGebruiker: { zohoNaam: '' }, technieker: 'Tim' });
    await openPlanningDetail(page);
    for (const id of SCHRIJF) await expect(knop(page, id), id).toBeHidden();
  });

  for (const rol of ['planner', 'beheerder']) {
    test(`${rol} heeft de knoppen bij elk ticket, ook dat van een collega`, async ({ page }) => {
      await startApp(page, { loginRol: rol });
      await openPlanningDetail(page, 'Roel');
      for (const id of SCHRIJF) await expect(knop(page, id), id).toBeVisible();
    });
  }
});

test.describe("lokale afspraak: collega's alleen-lezen", () => {
  const SCHRIJF = ['ld-btn-arrival', 'ld-btn-rapport'];
  const openLokaal = async (page, persoon) => {
    await page.evaluate((p) => kern.afspraken.openLocalEventDetail({ id: 'l1', type: 'Interventie', titel: 'Controle laadpaal', datum: '2026-10-07', uur: '10:00', einduur: '11:00', adres: 'Dorpsstraat 1, Gent', persoon: p }), persoon);
    await expect(page.locator('#local-det-overlay')).toHaveClass(/open/);
  };

  test('technieker (Tim) bij een afspraak van Roel: geen Aankomst of Rapport; het detail blijft leesbaar', async ({ page }) => {
    await startApp(page, { loginRol: 'technieker' });
    await openLokaal(page, 'Roel');
    for (const id of SCHRIJF) await expect(knop(page, id), id).toBeHidden();
    await expect(page.locator('#ld-titel')).toHaveText('Controle laadpaal');
  });

  test('technieker (Tim) bij zijn eigen afspraak: Aankomst en Rapport zijn er', async ({ page }) => {
    await startApp(page, { loginRol: 'technieker' });
    await openLokaal(page, 'Tim');
    for (const id of SCHRIJF) await expect(knop(page, id), id).toBeVisible();
  });

  for (const rol of ['planner', 'beheerder']) {
    test(`${rol} heeft de knoppen bij elke afspraak, ook die van een collega`, async ({ page }) => {
      await startApp(page, { loginRol: rol });
      await openLokaal(page, 'Roel');
      for (const id of SCHRIJF) await expect(knop(page, id), id).toBeVisible();
    });
  }
});

test.describe('rechten per rol (Rechtentabel): tabs en knoppen', () => {
  const COORD_KNOPPEN = ['d-btn-proposal', 'd-btn-reschedule'];
  const SCHRIJF = ['d-btn-arrival', 'd-btn-fotos', 'd-btn-rapport'];

  test('beheerder: 8 tabs (met Beheer en Sales); alle knoppen in het detail', async ({ page }) => {
    await startApp(page, { loginRol: 'beheerder' });
    await expect(zichtbareTabs(page)).toHaveCount(8);
    await expect(tab(page, 'Beheer')).toBeVisible();
    await openPlanningDetail(page);
    for (const id of [...SCHRIJF, ...COORD_KNOPPEN, 'd-plan-btn']) await expect(knop(page, id), id).toBeVisible();
  });

  test('planner: 7 tabs (met Beheer, enkel Instellingen en Performance); alle knoppen in het detail', async ({ page }) => {
    await startApp(page, { loginRol: 'planner' });
    await expect(zichtbareTabs(page)).toHaveCount(7);
    await expect(tab(page, 'Beheer')).toBeVisible();
    await openPlanningDetail(page);
    for (const id of [...SCHRIJF, ...COORD_KNOPPEN, 'd-plan-btn']) await expect(knop(page, id), id).toBeVisible();
  });

  test('technieker: Kalender, Ingepland, Inventaris en Rapporten; enkel zijn eigen werkknoppen, geen coördinatorknoppen', async ({ page }) => {
    await startApp(page, { loginRol: 'technieker' });
    await expect(zichtbareTabs(page)).toHaveCount(4);
    for (const naam of ['Kalender', 'Ingepland', 'Inventaris', 'Rapporten']) await expect(tab(page, naam)).toBeVisible();
    for (const naam of ['Wachtrij', 'Route', 'Beheer']) await expect(tab(page, naam)).toHaveCount(0);
    await openPlanningDetail(page);
    for (const id of SCHRIJF) await expect(knop(page, id), id).toBeVisible();
    for (const id of [...COORD_KNOPPEN, 'd-plan-btn', 'd-btn-annuleer']) await expect(knop(page, id), id).toBeHidden();
  });

  test('sales: de vier sales-tabs; geen ticket-tabs en geen planning-API-aanroepen, enkel de sessie, de eigen instellingen en de eigen leads', async ({ page, verzoeken }) => {
    await startSalesApp(page);
    await expect(zichtbareTabs(page)).toHaveCount(4);
    await expect(zichtbareTabs(page)).toHaveText(['Leads', 'Kalender', 'Route', 'Afgewerkt']);
    await expect(page.locator('nav[aria-label="Hoofdmenu"]')).toBeVisible();
    await expect(page.locator('#view-sales-lijst')).toBeVisible();
    await expect(page.locator('#view-tickets')).toBeHidden();
    // Enkel de sessie, de eigen instellingen en de eigen leads (de opstart van rol sales); geen tickets, planning, afspraken of route.
    const paden = [...new Set(verzoeken.alle.map(r => r.pad))].sort();
    expect(paden).toEqual(['/api/auth-ik', '/api/instellingen', '/api/sales']);
    for (const verboden of VERBODEN_PADEN_SALES) expect(paden).not.toContain(verboden);
  });
});

test.describe('een geweigerde schrijfactie (403 geen-recht)', () => {
  test('toont een toast en de app blijft werken', async ({ page, consoleFouten }) => {
    const gewoon = opslagStub({ versie: 0, afspraken: [] }, 'afspraken');
    const afspraken = (z) => (z.methode === 'PUT' ? json(403, { error: 'Je hebt hier geen toegang toe.', code: 'geen-recht' }) : gewoon(z));
    await startApp(page, { loginRol: 'planner', overschrijf: { afspraken } });
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await page.getByRole('button', { name: '➕ Afspraak' }).click();
    const formulier = page.locator('#manueel-overlay');
    await formulier.locator('#man-titel').fill('Proefafspraak');
    await formulier.locator('#man-datum').fill('2026-10-08');
    await formulier.getByRole('button', { name: 'Opslaan' }).click();
    await expect(page.locator('#toast')).toHaveText('✕ Afspraken opslaan mislukt');
    // Geen crash: de tabs reageren nog.
    await tab(page, 'Ingepland').click();
    await expect(page.locator('#view-gepland')).toHaveClass(/active/);
    await expect(page.locator('#cnt-tickets')).toHaveText('3');
    // De bewuste 403 en de eigen foutmelding van de app staan als consolefout in de vangnetlijst.
    await expect.poll(() => consoleFouten.filter(f => /403/.test(f) && /\/api\/afspraken/.test(f)).length).toBeGreaterThan(0);
    for (let i = consoleFouten.length - 1; i >= 0; i--) {
      if ((/403/.test(consoleFouten[i]) && /\/api\/afspraken/.test(consoleFouten[i])) || /Afspraken opslaan mislukt/.test(consoleFouten[i])) consoleFouten.splice(i, 1);
    }
  });
});

test.describe('verlopen sessie en herinloggen', () => {
  // De stubs zijn enkel nep-eindpunten: /api/plan en /api/rapport-ontvangen staan in de verbodenlijst van de vangnetten
  // (echt schrijven naar Zoho). Hier zijn ze juist het onderwerp; na de controles halen we ze uit de lijst.
  const VERBODEN = ['/api/plan', '/api/rapport-ontvangen'];
  const schoonVerboden = (verzoeken) => {
    for (let i = verzoeken.alle.length - 1; i >= 0; i--) if (VERBODEN.includes(verzoeken.alle[i].pad)) verzoeken.alle.splice(i, 1);
  };
  const schoonConsole = (consoleFouten, pad) => {
    for (let i = consoleFouten.length - 1; i >= 0; i--) if (consoleFouten[i].includes(pad) && /401/.test(consoleFouten[i])) consoleFouten.splice(i, 1);
  };
  const login = (page) => page.locator('#login-overlay');
  async function logIn(page) {
    await login(page).getByLabel('E-mailadres').fill('b@test.be');
    await login(page).getByLabel('Wachtwoord', { exact: true }).fill('een-lang-wachtwoord');
    await login(page).getByRole('button', { name: 'Inloggen', exact: true }).click();
  }

  // Stubs: de sessie is geldig tot de eerste schrijfactie (eerste antwoord 401 en de sessie is weg); auth-login herstelt hem.
  function sessieStubs({ wie = authIkStub('beheerder'), naLogin = wie } = {}) {
    const staat = { verlopen: false, geweigerd: false, ingelogdAls: wie };
    const schrijf = () => {
      if (!staat.geweigerd) { staat.geweigerd = true; staat.verlopen = true; return json(401, { error: 'Niet ingelogd', code: 'niet-ingelogd' }); }
      return json(200, { ok: true });
    };
    return {
      staat,
      stubs: {
        'auth-ik': (z) => (staat.verlopen ? json(401, { error: 'Niet ingelogd', code: 'niet-ingelogd' }) : staat.ingelogdAls(z)),
        'auth-login': () => { staat.verlopen = false; staat.ingelogdAls = naLogin; return json(200, { ok: true }); },
        plan: schrijf,
        'rapport-ontvangen': (z) => { const r = schrijf(z); return r.status === 200 ? json(200, { ok: true }) : r; },
      },
    };
  }

  test('401 op een schrijfactie: het loginscherm komt over de app (die blijft staan) en na de login wordt de actie één keer herhaald', async ({ page, verzoeken, consoleFouten }) => {
    const { stubs } = sessieStubs();
    await startApp(page, { overschrijf: stubs });
    const uitkomst = page.evaluate(() => fetch('/api/plan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticketId: 't1' }),
    }).then(r => r.status));
    await expect(login(page)).toBeVisible();
    await expect(login(page).getByRole('heading', { name: 'Inloggen' })).toBeVisible();
    // De app eronder blijft staan (niet herladen, niet leeg): de tickets staan er nog, de achtergrond is onbereikbaar.
    await expect(page.locator('#cnt-tickets')).toHaveText('3');
    await expect(page.locator('main#hoofdinhoud')).toHaveJSProperty('inert', true);
    expect(verzoeken.van('/api/plan', 'POST')).toHaveLength(1);

    await logIn(page);
    await expect(login(page)).toHaveCount(0);
    expect(await uitkomst).toBe(200);
    expect(verzoeken.van('/api/plan', 'POST')).toHaveLength(2); // het geweigerde verzoek en één herhaling
    await expect(page.locator('#cnt-tickets')).toHaveText('3');
    schoonVerboden(verzoeken);
    await expect.poll(() => consoleFouten.some(f => f.includes('/api/plan'))).toBe(true);
    schoonConsole(consoleFouten, '/api/plan');
  });

  test('een openstaand rapport in de outbox (IndexedDB) blijft bewaard tijdens het inloggen en wordt daarna verstuurd', async ({ page, verzoeken, consoleFouten }) => {
    const { stubs } = sessieStubs();
    await startApp(page, { overschrijf: stubs });
    // De echte outbox in testmodus: ?test&upload (items die zelf in testmodus zijn gemaakt gaan naar de testopslag; hier naar de stub).
    await page.goto('/?test&upload');
    await expect(page.locator('#cnt-tickets')).toHaveText('3');
    const ITEM = { id: 'outbox-t19', testModus: true, ticket: { id: 't1', number: '1001', filename: 'rapport.pdf' }, archiveBody: { ticketId: 't1', rapportData: {} }, html: '<p>Rapport</p>', isLocal: false };
    const inDb = () => page.evaluate(() => new Promise((ok, fout) => {
      const open = indexedDB.open('blitz-rapport-outbox');
      open.onerror = () => fout(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const req = db.transaction('items', 'readonly').objectStore('items').getAll();
        req.onsuccess = () => { db.close(); ok(req.result.map(i => i.id)); };
        req.onerror = () => { db.close(); fout(req.error); };
      };
    }));
    await page.evaluate(async (item) => { await window.outboxAdd(item); await window.refreshOutboxCache(); }, ITEM);
    expect(await inDb()).toEqual(['outbox-t19']);

    const klaar = page.evaluate((id) => window.runOutboxItem({ id }).then(() => 'klaar'), ITEM.id);
    await expect(login(page)).toBeVisible();
    expect(verzoeken.van('/api/rapport-ontvangen', 'POST')).toHaveLength(1);
    expect(await inDb(), 'het rapport blijft bewaard zolang er niet ingelogd is').toEqual(['outbox-t19']);

    await logIn(page);
    await expect(login(page)).toHaveCount(0);
    expect(await klaar).toBe('klaar');
    expect(verzoeken.van('/api/rapport-ontvangen', 'POST')).toHaveLength(2); // herhaald na de login
    await expect.poll(inDb).toEqual([]); // ontvangen en opgeruimd
    schoonVerboden(verzoeken);
    await expect.poll(() => consoleFouten.some(f => f.includes('/api/rapport-ontvangen'))).toBe(true);
    schoonConsole(consoleFouten, '/api/rapport-ontvangen');
  });

  test('inloggen als een ander account (andere id) herlaadt de pagina; hetzelfde account niet', async ({ page, verzoeken, consoleFouten }) => {
    const ander = authIkStub('planner', { id: 'u-ander', naam: 'Andere Planner' });
    const { stubs } = sessieStubs({ naLogin: ander });
    await startApp(page, { overschrijf: stubs });
    await page.evaluate(() => { window.__nietHerladen = true; });
    const uitkomst = page.evaluate(() => fetch('/api/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(r => r.status).catch(() => 'herladen'));
    await expect(login(page)).toBeVisible();
    const herladen = page.waitForEvent('load');
    await logIn(page);
    await herladen;
    await expect(page.locator('#cnt-tickets')).toHaveText('3');
    expect(await page.evaluate(() => window.__nietHerladen)).toBeUndefined();
    await uitkomst.catch(() => {});
    schoonVerboden(verzoeken);
    schoonConsole(consoleFouten, '/api/plan');
  });

  test('hetzelfde account opnieuw inloggen laadt de pagina niet opnieuw', async ({ page, verzoeken, consoleFouten }) => {
    const { stubs } = sessieStubs();
    await startApp(page, { overschrijf: stubs });
    await page.evaluate(() => { window.__nietHerladen = true; });
    const uitkomst = page.evaluate(() => fetch('/api/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(r => r.status));
    await expect(login(page)).toBeVisible();
    await logIn(page);
    expect(await uitkomst).toBe(200);
    expect(await page.evaluate(() => window.__nietHerladen)).toBe(true);
    schoonVerboden(verzoeken);
    schoonConsole(consoleFouten, '/api/plan');
  });
});
