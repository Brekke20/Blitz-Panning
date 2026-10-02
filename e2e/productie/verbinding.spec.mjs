// Productietests (etappe 7, taak 1): karakterisering van wat de app doet bij een slechte verbinding (afgebroken of
// hangend verzoek). Elke pin hieronder legt het HUIDIGE gedrag vast, ook waar dat een bug is; de taak die het omdraait
// staat bij de pin (`→ T<n>`). Een omgedraaide pin wordt in een aparte commit aangepast (RED → GREEN), niet gewist.
// Nepbackend: `{ afbreken: 'failed' }` breekt het verzoek af nadat de stub het opnam (de fetch gooit een TypeError),
// `{ hangen: true }` beantwoordt het nooit. Een bewust afgebroken pad meld je met `verwachtNetwerkFout`.
import {
  test, expect, startAppProductie, verwachtSchrijven, verwachtHttpFout, verwachtNetwerkFout, verwachtConsoleFout,
  zohoStubs, OPSTART_SCHRIJVEN, settle, openKalender, TICKETS_STUB, VASTE_NU,
} from '../productie-hulp.mjs';

const toastTekst = (page) => page.locator('#toast');
const planningVan = (page) => page.evaluate(() => Object.fromEntries(
  Object.entries(kern.toestand.get('planning')).map(([d, s]) => [d, s.map(p => p.ticket.id)])));
const wachtrijKaart = (page, nummer) => page.locator('#ticket-list .ticket').filter({ hasText: `#${nummer}` });
const dag = (page, datum) => page.locator(`.day-col[data-date="${datum}"]`);

// De nepklok loopt standaard door in echte tijd; voor tests die tussen de fout en de herlading (300 ms) iets controleren staat hij stil:
// vanaf nu loopt hij enkel nog via page.clock.runFor (settle, settleZonderOpenstaand).
const pauzeerKlok = (page) => page.clock.pauseAt(new Date(Date.parse(VASTE_NU) + 5000));

// tickets-stub met een omschakelbaar gedrag; `aantal` telt de GET-aanroepen (de opstart is de eerste).
function ticketsStub({ gepland = false, na } = {}) {
  const toestand = { afbreken: false, aantal: 0 };
  const stub = () => {
    toestand.aantal++;
    if (toestand.afbreken) return { afbreken: 'failed' };
    const data = structuredClone(TICKETS_STUB);
    if (na && toestand.aantal > 1) na(data); // de serverstand zoals Zoho hem na de (onzekere) schrijfactie heeft
    if (gepland && toestand.aantal > 1) {
      // Zoals Zoho het ticket na een geslaagde plan-aanroep zou tonen: uit de wachtrij, in de lijst "wacht op bevestiging".
      const t1 = data.tickets.find(t => t.id === 't1');
      data.tickets = data.tickets.filter(t => t.id !== 't1');
      data.pendingTickets.push({ ...t1, status: 'Wachten op bevestiging planning', interventieDatum: '2026-10-05T08:00:00.000Z' });
    }
    return { status: 200, json: data };
  };
  return { toestand, stub };
}

// settle() wacht tot er geen verzoek meer openstaat; met een hangend verzoek kan dat niet: enkel klok en microtasks laten lopen.
async function settleZonderOpenstaand(page) {
  for (let ronde = 0; ronde < 2; ronde++) {
    await page.clock.runFor(2000);
    await page.evaluate(() => Promise.resolve());
  }
}

async function startPlan(page, verzoeken, { stubs = {}, paden = ['/api/plan'] } = {}) {
  verwachtSchrijven(verzoeken, [...OPSTART_SCHRIJVEN, ...paden]);
  const z = zohoStubs();
  await startAppProductie(page, { technieker: 'Tim', overschrijf: { ...z.overschrijf, ...stubs } });
  return z;
}

test.describe('verbinding: planning (plan) en vernieuwen', () => {
  test('P1 (omgedraaid in T6, H1): na een geslaagde plan-aanroep en een mislukte vernieuwing blijft het ticket gepland (geen verouderde cache)', async ({ page, verzoeken }) => {
    const t = ticketsStub();
    verwachtNetwerkFout(verzoeken, [{ pad: '/api/tickets', methode: 'GET' }]);
    await startPlan(page, verzoeken, { stubs: { tickets: t.stub } });
    await wachtrijKaart(page, 1001).locator('.btn-add').click();
    await expect(toastTekst(page)).toHaveText('✓ Toegevoegd aan 5 okt');
    await expect(page.locator('#cnt-tickets')).toHaveText('1');
    expect(await planningVan(page)).toMatchObject({ '2026-10-05': ['t1'] });

    // De verbinding valt weg; de gebruiker klikt op Vernieuwen. De bewaarde kopie van de opstart (die het ticket nog als
    // "in te plannen" kent) wordt enkel bij de eerste lading toegepast, niet bij een verversing.
    t.toestand.afbreken = true;
    await page.getByRole('button', { name: 'Vernieuwen' }).click();
    await expect(toastTekst(page)).toContainText('✕');
    await settle(page);

    // W5-fix: het ticket dat zojuist (geslaagd) gepland werd, blijft gepland: in de route en niet in de wachtrij.
    await expect(page.locator('#cnt-tickets')).toHaveText('1');
    await expect(wachtrijKaart(page, 1001)).toHaveCount(0);
    expect(await planningVan(page)).toMatchObject({ '2026-10-05': ['t1'] });
  });

  test('N8: een offline start past de bewaarde kopie nog wel toe (enkel bij de eerste lading)', async ({ page, verzoeken }) => {
    const t = ticketsStub();
    t.toestand.afbreken = true; // de opstartlading valt weg
    verwachtNetwerkFout(verzoeken, [{ pad: '/api/tickets', methode: 'GET' }]);
    await page.addInitScript((kopie) => {
      if (window === window.top) localStorage.setItem('blitz_tickets_cache', JSON.stringify(kopie));
    }, TICKETS_STUB);
    await startPlan(page, verzoeken, { stubs: { tickets: t.stub } });
    // startAppProductie wachtte al op de telling uit de kopie (2 tickets te plannen); de lading zelf faalde.
    await expect(page.locator('#cnt-tickets')).toHaveText('2');
    await expect(wachtrijKaart(page, 1001)).toHaveCount(1);
    expect(t.toestand.aantal).toBe(1);
  });

  test('P2 (omgedraaid in T2, H2): een hangende plan-aanroep eindigt na 20 s: foutmelding, ticket terug bedienbaar en geen half ticket', async ({ page, verzoeken }) => {
    verwachtNetwerkFout(verzoeken, [{ pad: '/api/plan', methode: 'POST' }]);
    const z = await startPlan(page, verzoeken);
    const basis = await planningVan(page);
    z.zetAntwoord('plan', { hangen: true });
    await wachtrijKaart(page, 1001).locator('.btn-add').click();
    await expect.poll(() => z.opnames.plan.length).toBe(1);
    await page.clock.runFor(19000);
    await page.evaluate(() => Promise.resolve());
    // Net vóór de limiet: nog steeds in flight (de inFlight-guard houdt een tweede klik tegen).
    await expect(wachtrijKaart(page, 1001).locator('.btn-add')).toBeDisabled();
    await expect(toastTekst(page)).not.toContainText('mislukt');

    await page.clock.runFor(2000);
    await page.evaluate(() => Promise.resolve());
    // W5-fix: de aanroep eindigt met een TimeoutError; de bestaande foutmelding toont het detail.
    await expect(toastTekst(page)).toContainText('✕ Bijwerken in Zoho mislukt. Probeer opnieuw; blijft het fout, meld dit. (Detail: Time-out na 20 s)');
    await expect(wachtrijKaart(page, 1001)).toHaveCount(1);
    await expect(wachtrijKaart(page, 1001).locator('.btn-add')).toBeEnabled();
    await expect(page.locator('#cnt-tickets')).toHaveText('2');
    expect(await planningVan(page)).toEqual(basis); // teruggedraaid: geen half ticket
    expect(z.opnames.plan).toHaveLength(1);
  });

  test('P4 (omgedraaid in T6, H3): een afgebroken plan-aanroep wordt teruggedraaid en daarna herlaadt de app de tickets: Zoho plande het ticket wel', async ({ page, verzoeken }) => {
    const t = ticketsStub({ gepland: true });
    verwachtNetwerkFout(verzoeken, [{ pad: '/api/plan', methode: 'POST' }]);
    const z = await startPlan(page, verzoeken, { stubs: { tickets: t.stub } });
    await pauzeerKlok(page);
    const basis = await planningVan(page);
    expect(t.toestand.aantal).toBe(1); // de opstartlading
    z.zetAntwoord('plan', { afbreken: 'failed' });
    await wachtrijKaart(page, 1001).locator('.btn-add').click();
    await expect(toastTekst(page)).toContainText('Bijwerken in Zoho mislukt');
    // Direct na de fout is het lokaal teruggedraaid (de herlading wacht 300 ms).
    expect(await planningVan(page)).toEqual(basis);
    expect(z.opnames.plan).toHaveLength(1);
    await settle(page);

    // W5-fix: het verzoek kwam wel aan (afgebroken nadat de stub het opnam): de uitkomst was onzeker, dus herlaadt de app één keer
    // (zonder bewaarde kopie) en toont het ticket zoals Zoho het heeft: gepland.
    expect(t.toestand.aantal).toBe(2);
    expect(verzoeken.van('/api/tickets', 'GET')).toHaveLength(2);
    await expect(wachtrijKaart(page, 1001)).toHaveCount(0);
    await expect(page.locator('#cnt-tickets')).toHaveText('1');
    expect(await planningVan(page)).toMatchObject({ '2026-10-05': ['t1'] });
    expect(z.opnames.plan).toHaveLength(1); // geen tweede schrijfaanroep
  });
});

test.describe('verbinding: annuleren', () => {
  test('P3 (omgedraaid in T2, H6): een hangende annuleer-aanroep eindigt na 35 s: venster ontgrendeld, waarschuwing "klant kan al gemaild zijn"', async ({ page, verzoeken }) => {
    verwachtSchrijven(verzoeken, [...OPSTART_SCHRIJVEN, '/api/annuleer']);
    verwachtNetwerkFout(verzoeken, [{ pad: '/api/annuleer', methode: 'POST' }]);
    const register = { versie: 4, status: { p1: { contact: '2026-10-04T08:00:00.000Z', tijdslot: '09:30–12:30', tijdslotDatum: '2026-10-07' } } };
    const z = zohoStubs({ register });
    await startAppProductie(page, { technieker: 'Tim', overschrijf: z.overschrijf });
    await openKalender(page);
    await dag(page, '2026-10-07').locator('.tl-ticket[data-ticket-id="p1"] .cal-sub').click();
    await page.locator('#d-btn-annuleer').click();
    await expect(page.locator('#annuleer-overlay')).toHaveClass(/open/);
    await page.locator('#annuleer-modal').getByLabel('Technieker ziek of onbeschikbaar').check();
    await expect(page.locator('#annuleer-verstuur')).toBeEnabled();
    await settle(page);

    z.zetAntwoord('annuleer', { hangen: true });
    await page.locator('#annuleer-verstuur').click();
    await expect.poll(() => z.opnames.annuleer.filter(o => o.methode === 'POST' && o.body.voorbeeld !== true).length).toBe(1);
    expect(z.opnames.annuleer.find(o => o.methode === 'POST' && o.body.voorbeeld !== true).body.mailKlant).toBe(true);
    await page.clock.runFor(34000);
    await page.evaluate(() => Promise.resolve());
    // Net vóór de limiet: het venster zit nog vast.
    await expect(page.locator('#annuleer-verstuur')).toHaveText('Bezig…');
    await expect(page.locator('#annuleer-terug')).toBeDisabled();

    await page.clock.runFor(2000);
    await page.evaluate(() => Promise.resolve());
    // W5-fix: venster ontgrendeld, de bestaande waarschuwing blijft (de klant kan al gemaild zijn).
    await expect(toastTekst(page)).toContainText('✕ Annuleren mislukt: Time-out na 35 s De klant kan al gemaild zijn — controleer in Zoho vóór je opnieuw probeert.');
    await expect(page.locator('#annuleer-verstuur')).toHaveText('Afspraak annuleren');
    await expect(page.locator('#annuleer-terug')).toBeEnabled();
    await page.keyboard.press('Escape');
    await page.clock.runFor(1000);
    await expect(page.locator('#annuleer-overlay')).not.toHaveClass(/open/);
    expect(z.opnames.annuleer.filter(o => o.methode === 'POST' && o.body.voorbeeld !== true)).toHaveLength(1);
  });
});

test.describe('verbinding: foto-upload', () => {
  test('PUT /api/fotos eindigt pas na 60 s (grote upload), een gewone aanroep na 20 s', async ({ page, verzoeken }) => {
    verwachtSchrijven(verzoeken, [...OPSTART_SCHRIJVEN, '/api/fotos']);
    verwachtNetwerkFout(verzoeken, [{ pad: '/api/fotos', methode: 'PUT' }]);
    const z = zohoStubs();
    await startAppProductie(page, { technieker: 'Tim', overschrijf: { ...z.overschrijf, fotos: () => ({ hangen: true }) } });
    await page.evaluate(() => {
      window.__foto = 'bezig';
      fetch('/api/fotos', { method: 'PUT', body: '{}' }).then(() => { window.__foto = 'ok'; }, (e) => { window.__foto = e.name; });
    });
    await page.clock.runFor(59000);
    await page.evaluate(() => Promise.resolve());
    expect(await page.evaluate(() => window.__foto)).toBe('bezig');
    await page.clock.runFor(2000);
    await page.evaluate(() => Promise.resolve());
    await expect.poll(() => page.evaluate(() => window.__foto)).toBe('TimeoutError');
  });
});

test.describe('verbinding: beschikbaarheid bewaren', () => {
  test('P5 (omgedraaid in T6, H5): een afgebroken PUT na opslag op de server: lokaal teruggedraaid, daarna haalt de app de serverstand op en de volgende schrijf geeft geen 409', async ({ page, verzoeken }) => {
    verwachtSchrijven(verzoeken, [...OPSTART_SCHRIJVEN, '/api/availability']);
    verwachtNetwerkFout(verzoeken, [{ pad: '/api/availability', methode: 'PUT' }]);
    verwachtConsoleFout(verzoeken, [{ tekst: /^Beschikbaarheid opslaan mislukt: TypeError\b/ }]);

    // Server: bewaart elke geldige schrijf (versie + 1). De eerste PUT wordt na het opslaan afgebroken: het antwoord gaat verloren.
    let stand = { versie: 0, exceptions: [] };
    let puts = 0;
    const availability = ({ methode, body }) => {
      if (methode !== 'PUT') return { status: 200, json: stand };
      puts++;
      if (body.versie !== stand.versie) {
        return { status: 409, json: { error: 'Versiematch mislukt', serverVersie: stand.versie, data: stand } };
      }
      stand = { versie: stand.versie + 1, exceptions: body.exceptions };
      return puts === 1 ? { afbreken: 'failed' } : { status: 200, json: stand };
    };
    const z = zohoStubs();
    await startAppProductie(page, { technieker: 'Tim', overschrijf: { ...z.overschrijf, availability } });
    await openKalender(page);
    await dag(page, '2026-10-06').getByRole('button', { name: '⏱ Beschikbaar' }).click();
    const modal = page.getByRole('dialog', { name: '⛔ Beschikbaarheid' });
    await expect(modal.getByText('Geen blokkeringen voor deze dag.')).toBeVisible();

    // Eerste schrijf: de server bewaarde het, de app hoort niets.
    await modal.getByLabel('Reden').fill('Verlof');
    await modal.getByRole('button', { name: '➕ Toevoegen' }).click();
    await expect(toastTekst(page)).toContainText('Opslaan is niet gelukt');
    expect(stand.exceptions.map(e => e.reason)).toEqual(['Verlof']); // op de server staat het wel
    // W5-fix: na het terugdraaien (zonder wachten op de klok) volgt een herlading van de serverstand: het item staat er weer.
    await page.clock.runFor(1);
    await expect(modal.getByText('🔒 Hele dag — Verlof')).toBeVisible();
    expect(await page.evaluate(() => kern.toestand.get('avExceptions').map(e => e.reason))).toEqual(['Verlof']);

    // Tweede schrijf bewaart met de actuele versie: geen 409, beide items blijven staan.
    await modal.getByLabel('Reden').fill('Cursus');
    await modal.getByRole('button', { name: '➕ Toevoegen' }).click();
    await expect(modal.getByText('Cursus')).toBeVisible();
    await settle(page);
    await expect(toastTekst(page)).not.toContainText('Iemand anders wijzigde dit net');
    await expect(modal.getByText('🔒 Hele dag — Verlof')).toBeVisible();
    expect(stand.exceptions.map(e => e.reason)).toEqual(['Verlof', 'Cursus']);
    expect(puts).toBe(2);
  });
});

// ── N7: een onzeker resultaat (time-out, netwerkfout, 502/503/504) draait terug en herlaadt daarna één keer ──────────
test.describe('verbinding: synchroniseren na een onzeker resultaat', () => {
  const HTML_504 = '<html><body>Gateway Timeout</body></html>';
  const stubPlanNa = (data) => { // Zoho plande #1001 (t1) wel
    const t1 = data.tickets.find(t => t.id === 't1');
    data.tickets = data.tickets.filter(t => t.id !== 't1');
    data.pendingTickets.push({ ...t1, status: 'Wachten op bevestiging planning', interventieDatum: '2026-10-05T08:00:00.000Z' });
  };

  test('plan met een 504-antwoord (HTML): rollback, één herlading, het ticket staat als gepland', async ({ page, verzoeken }) => {
    verwachtHttpFout(verzoeken, [{ pad: '/api/plan', status: 504 }]);
    const t = ticketsStub({ na: stubPlanNa });
    const z = await startPlan(page, verzoeken, { stubs: { tickets: t.stub } });
    z.zetAntwoord('plan', { status: 504, raw: HTML_504 });
    await wachtrijKaart(page, 1001).locator('.btn-add').click();
    await expect(toastTekst(page)).toContainText('(Detail: HTTP 504)'); // de foutmelding blijft ongewijzigd (T8)
    await settle(page);
    expect(t.toestand.aantal).toBe(2);
    await expect(wachtrijKaart(page, 1001)).toHaveCount(0);
    expect(await planningVan(page)).toMatchObject({ '2026-10-05': ['t1'] });
    expect(z.opnames.plan).toHaveLength(1);
    await expect(toastTekst(page)).toContainText('(Detail: HTTP 504)'); // de herlading zelf is stil
  });

  test('plan met een time-out (hangend verzoek): na de 20 s rollback en één herlading', async ({ page, verzoeken }) => {
    verwachtNetwerkFout(verzoeken, [{ pad: '/api/plan', methode: 'POST' }]);
    const t = ticketsStub({ na: stubPlanNa });
    const z = await startPlan(page, verzoeken, { stubs: { tickets: t.stub } });
    z.zetAntwoord('plan', { hangen: true });
    await wachtrijKaart(page, 1001).locator('.btn-add').click();
    await expect.poll(() => z.opnames.plan.length).toBe(1);
    await page.clock.runFor(19000);
    await page.evaluate(() => Promise.resolve());
    expect(t.toestand.aantal).toBe(1); // nog geen uitkomst: geen herlading
    await page.clock.runFor(2000);
    await settleZonderOpenstaand(page);
    await expect(toastTekst(page)).toContainText('(Detail: Time-out na 20 s)');
    expect(t.toestand.aantal).toBe(2);
    await expect(wachtrijKaart(page, 1001)).toHaveCount(0);
    expect(await planningVan(page)).toMatchObject({ '2026-10-05': ['t1'] });
  });

  for (const [status, json] of [[400, { error: 'Ongeldig verzoek' }], [500, { error: 'Zoho kapot' }]]) {
    test(`plan met een definitief antwoord (${status}, JSON): rollback, geen herlading`, async ({ page, verzoeken }) => {
      verwachtHttpFout(verzoeken, [{ pad: '/api/plan', status }]);
      const t = ticketsStub();
      const z = await startPlan(page, verzoeken, { stubs: { tickets: t.stub } });
      z.zetAntwoord('plan', { status, json });
      await wachtrijKaart(page, 1001).locator('.btn-add').click();
      await expect(toastTekst(page)).toContainText('(Detail: ' + json.error + ')');
      await settle(page);
      expect(t.toestand.aantal).toBe(1);
      await expect(wachtrijKaart(page, 1001)).toHaveCount(1);
    });
  }

  test('twee snelle fouten na elkaar geven precies één herlading', async ({ page, verzoeken }) => {
    verwachtNetwerkFout(verzoeken, [{ pad: '/api/plan', methode: 'POST' }, { pad: '/api/plan', methode: 'POST' }]);
    const t = ticketsStub();
    const z = await startPlan(page, verzoeken, { stubs: { tickets: t.stub } });
    await pauzeerKlok(page);
    z.zetAntwoord('plan', { afbreken: 'failed' });
    await wachtrijKaart(page, 1001).locator('.btn-add').click();
    await wachtrijKaart(page, 1002).locator('.btn-add').click();
    await expect.poll(() => z.opnames.plan.length).toBe(2);
    await expect(wachtrijKaart(page, 1001).locator('.btn-add')).toBeEnabled();
    await expect(wachtrijKaart(page, 1002).locator('.btn-add')).toBeEnabled();
    expect(t.toestand.aantal).toBe(1); // de klok staat stil: de herlading wacht nog
    await settle(page);
    expect(t.toestand.aantal).toBe(2);
    expect(verzoeken.van('/api/tickets', 'GET')).toHaveLength(2);
  });

  test('de herlading wacht tot het andere ticket klaar is, en overschrijft geen nieuwere lokale wijziging', async ({ page, verzoeken }) => {
    verwachtNetwerkFout(verzoeken, [{ pad: '/api/plan', methode: 'POST' }, { pad: '/api/plan', methode: 'POST' }]);
    const t = ticketsStub();
    const z = await startPlan(page, verzoeken, { stubs: { tickets: t.stub } });
    await pauzeerKlok(page);
    z.zetAntwoord('plan', ({ body }) => body.ticketId === 't1' ? { afbreken: 'failed' } : { hangen: true });
    await wachtrijKaart(page, 1001).locator('.btn-add').click();
    await wachtrijKaart(page, 1002).locator('.btn-add').click();
    await expect.poll(() => z.opnames.plan.length).toBe(2);
    await settleZonderOpenstaand(page); // 4 s: #1001 faalde, #1002 hangt nog (in flight)
    expect(t.toestand.aantal).toBe(1); // geen herlading terwijl #1002 openstaat
    expect((await planningVan(page))['2026-10-05']).toEqual(['t2']); // de lokale, optimistische wijziging van #1002 staat nog
    await page.clock.runFor(17000); // #1002 loopt op de time-out
    await settleZonderOpenstaand(page);
    expect(t.toestand.aantal).toBe(2); // daarna precies één herlading
    expect(verzoeken.van('/api/tickets', 'GET')).toHaveLength(2);
  });

  test('plan deze week: beide tickets van Tim afgebroken: één herlading na de reeks', async ({ page, verzoeken }) => {
    verwachtSchrijven(verzoeken, [...OPSTART_SCHRIJVEN, '/api/plan', '/api/matrix']);
    verwachtNetwerkFout(verzoeken, [{ pad: '/api/plan', methode: 'POST' }, { pad: '/api/plan', methode: 'POST' }]);
    const t = ticketsStub();
    const z = zohoStubs();
    await startAppProductie(page, { technieker: 'Tim', overschrijf: { ...z.overschrijf, tickets: t.stub } });
    z.zetAntwoord('plan', { afbreken: 'failed' });
    await openKalender(page);
    await page.getByRole('button', { name: '⚡ Plan deze week' }).click();
    await expect.poll(() => z.opnames.plan.length).toBe(2);
    await expect(page.getByRole('dialog', { name: '⚡ Planningsresultaat' })).toBeVisible();
    await settle(page);
    expect(t.toestand.aantal).toBe(2); // opstart + precies één herlading voor de twee fouten
    expect(verzoeken.van('/api/tickets', 'GET')).toHaveLength(2);
  });

  test('uit de planning halen met een afgebroken aanroep: rollback, één herlading, serverstand overgenomen', async ({ page, verzoeken }) => {
    verwachtNetwerkFout(verzoeken, [{ pad: '/api/plan', methode: 'POST' }]);
    const t = ticketsStub({ na: (data) => { // Zoho haalde #1004 (p1) wel uit de planning
      const p1 = data.pendingTickets.find(x => x.id === 'p1');
      data.pendingTickets = data.pendingTickets.filter(x => x.id !== 'p1');
      data.tickets.push({ ...p1, status: 'Service in te plannen', interventieDatum: null });
    } });
    const z = await startPlan(page, verzoeken, { stubs: { tickets: t.stub } });
    await pauzeerKlok(page);
    z.zetAntwoord('plan', { afbreken: 'failed' });
    await openKalender(page);
    await dag(page, '2026-10-07').locator('.tl-ticket[data-ticket-id="p1"] .cal-unplan-x').click();
    await page.getByRole('alertdialog', { name: 'Ticket #1004 uit de planning halen?' }).getByRole('button', { name: 'Uit planning halen' }).click();
    await expect(toastTekst(page)).toContainText('Bijwerken in Zoho mislukt');
    await settle(page);
    expect(z.opnames.plan).toEqual([{ methode: 'POST', body: { ticketId: 'p1', date: null }, query: {} }]);
    expect(t.toestand.aantal).toBe(2);
    expect(await planningVan(page)).not.toHaveProperty('2026-10-07');
    await expect(page.locator('#cnt-tickets')).toHaveText('3');
  });

  test('verzetten met een afgebroken aanroep: één herlading, serverstand overgenomen', async ({ page, verzoeken }) => {
    verwachtNetwerkFout(verzoeken, [{ pad: '/api/plan', methode: 'POST' }]);
    const t = ticketsStub({ na: (data) => { // Zoho verzette #1004 (p1) wel naar do 8 okt 14:30 lokaal
      data.pendingTickets.find(x => x.id === 'p1').interventieDatum = '2026-10-08T12:30:00.000Z';
    } });
    const z = await startPlan(page, verzoeken, { stubs: { tickets: t.stub } });
    await pauzeerKlok(page);
    z.zetAntwoord('plan', { afbreken: 'failed' });
    await openKalender(page);
    await dag(page, '2026-10-07').locator('.tl-ticket[data-ticket-id="p1"] .cal-sub').click();
    await page.getByRole('button', { name: '📅 Datum/tijd' }).click();
    const venster = page.getByRole('dialog', { name: '📅 Nieuwe datum/tijd' });
    await venster.locator('#d-reschedule-date').fill('2026-10-08');
    await venster.locator('#d-reschedule-time').fill('14:30');
    await venster.getByRole('button', { name: '✓ Opslaan' }).click();
    await expect(toastTekst(page)).toContainText('Bijwerken in Zoho mislukt');
    expect(await planningVan(page)).toMatchObject({ '2026-10-07': ['p1'] }); // direct na de fout: ongewijzigd
    await settle(page);
    expect(t.toestand.aantal).toBe(2);
    expect(await planningVan(page)).toMatchObject({ '2026-10-08': ['p1'] });
    expect((await planningVan(page))['2026-10-07'] ?? []).not.toContain('p1');
  });

  test('toewijzen met een afgebroken aanroep: één herlading, serverstand overgenomen', async ({ page, verzoeken }) => {
    verwachtSchrijven(verzoeken, [...OPSTART_SCHRIJVEN, '/api/plan-datum']);
    verwachtNetwerkFout(verzoeken, [{ pad: '/api/plan-datum', methode: 'POST' }]);
    const t = ticketsStub({ na: (data) => { // Zoho kende #1005 (p2) wel de datum toe
      data.pendingTickets.find(x => x.id === 'p2').interventieDatum = '2026-10-06T11:15:00.000Z';
    } });
    const z = zohoStubs();
    await startAppProductie(page, { technieker: 'Tim', overschrijf: { ...z.overschrijf, tickets: t.stub } });
    await pauzeerKlok(page);
    z.zetAntwoord('plan-datum', { afbreken: 'failed' });
    await openKalender(page);
    await page.locator('#kal-pending-pill').click();
    const kaart = page.locator('#kal-no-date-section .ticket').filter({ hasText: '#1005' });
    await kaart.getByRole('button', { name: '📅 Toewijzen' }).click();
    await kaart.getByLabel('Datum toewijzen').fill('2026-10-06');
    await kaart.getByLabel('Tijd toewijzen').fill('13:15');
    await kaart.getByRole('button', { name: '✓ Opslaan' }).click();
    await expect(toastTekst(page)).toContainText('✕');
    expect(await planningVan(page)).not.toHaveProperty('2026-10-06');
    await settle(page);
    expect(t.toestand.aantal).toBe(2);
    expect(await planningVan(page)).toMatchObject({ '2026-10-06': ['p2'] });
  });
});

test.describe('verbinding: spookschrijf bij afspraken en klantbeschikbaarheid', () => {
  const afspraakVenster = async (page, titel) => {
    await openKalender(page);
    await page.getByRole('button', { name: '➕ Afspraak' }).click();
    const modal = page.locator('#manueel-overlay');
    await expect(modal).toHaveClass(/open/);
    await modal.getByLabel('Titel *').fill(titel);
    await modal.getByLabel('Datum *').fill('2026-10-06');
    await modal.getByLabel('Van *').fill('09:00');
    await modal.getByLabel('Tot *').fill('10:00');
    return modal;
  };

  test('afspraak: afgebroken PUT na opslag: rollback, daarna toont de app de serverstand en de volgende schrijf geeft geen 409', async ({ page, verzoeken }) => {
    verwachtSchrijven(verzoeken, [...OPSTART_SCHRIJVEN, '/api/afspraken']);
    verwachtNetwerkFout(verzoeken, [{ pad: '/api/afspraken', methode: 'PUT' }]);
    verwachtConsoleFout(verzoeken, [{ tekst: /^Afspraken opslaan mislukt: Error: netwerk/ }]);
    let stand = { versie: 0, afspraken: [] };
    let puts = 0;
    const afspraken = ({ methode, body }) => {
      if (methode !== 'PUT') return { status: 200, json: stand };
      puts++;
      if (body.versie !== stand.versie) return { status: 409, json: { error: 'Versiematch mislukt', serverVersie: stand.versie, data: stand } };
      stand = { versie: stand.versie + 1, afspraken: body.afspraken };
      return puts === 1 ? { afbreken: 'failed' } : { status: 200, json: stand };
    };
    const z = zohoStubs();
    await startAppProductie(page, { technieker: 'Tim', overschrijf: { ...z.overschrijf, afspraken } });
    await pauzeerKlok(page);
    const modal = await afspraakVenster(page, 'Bezoek');
    await modal.getByRole('button', { name: 'Opslaan' }).click();
    await expect(toastTekst(page)).toContainText('Afspraken opslaan mislukt');
    expect(await page.evaluate(() => kern.toestand.get('localEvents').length)).toBe(0); // lokaal teruggedraaid
    expect(stand.afspraken).toHaveLength(1); // maar de server heeft hem
    await page.clock.runFor(1);
    await expect.poll(() => page.evaluate(() => kern.toestand.get('localEvents').map(e => e.titel))).toEqual(['Bezoek']);

    const modal2 = await afspraakVenster(page, 'Tweede');
    await modal2.getByRole('button', { name: 'Opslaan' }).click();
    await settle(page);
    expect(puts).toBe(2);
    expect(await page.evaluate(() => kern.toestand.get('localEvents').map(e => e.titel))).toEqual(['Bezoek', 'Tweede']);
    await expect(toastTekst(page)).not.toContainText('Iemand anders wijzigde dit net');
  });

  test('klantbeschikbaarheid: afgebroken PUT na opslag: rollback, daarna toont de app de serverstand', async ({ page, verzoeken }) => {
    verwachtSchrijven(verzoeken, [...OPSTART_SCHRIJVEN, '/api/klantbeschikbaarheid']);
    verwachtNetwerkFout(verzoeken, [{ pad: '/api/klantbeschikbaarheid', methode: 'PUT' }]);
    verwachtConsoleFout(verzoeken, [{ tekst: /^Klantbeschikbaarheid opslaan mislukt: Error: netwerk/ }]);
    let stand = { versie: 0, items: {} };
    let puts = 0;
    const klantbeschikbaarheid = ({ methode, body }) => {
      if (methode !== 'PUT') return { status: 200, json: stand };
      puts++;
      stand = { versie: stand.versie + 1, items: body.items };
      return { afbreken: 'failed' };
    };
    const z = zohoStubs();
    await startAppProductie(page, { technieker: 'Tim', overschrijf: { ...z.overschrijf, klantbeschikbaarheid } });
    await pauzeerKlok(page);
    await page.getByRole('button', { name: 'Open ticket #1001' }).click();
    const detail = page.getByRole('dialog', { name: /Laadpaal offline na stroomuitval/ });
    await detail.getByLabel('Datum waarop de klant niet kan').fill('2026-10-09');
    await detail.getByRole('button', { name: '+ Datum toevoegen' }).click();
    await detail.getByRole('button', { name: '✓ Opslaan' }).click();
    await expect(toastTekst(page)).toContainText('Klantbeschikbaarheid opslaan mislukt');
    expect(puts).toBe(1);
    expect(await page.evaluate(() => kern.toestand.get('klantBeschikbaarheid').t1)).toBeUndefined(); // lokaal teruggedraaid
    await page.clock.runFor(1);
    await expect.poll(() => page.evaluate(() => kern.toestand.get('klantBeschikbaarheid').t1?.geblokkeerd)).toEqual(['2026-10-09']);
  });

  test('geen herlading bij een 500-antwoord (definitieve fout)', async ({ page, verzoeken }) => {
    verwachtSchrijven(verzoeken, [...OPSTART_SCHRIJVEN, '/api/availability']);
    verwachtHttpFout(verzoeken, [{ pad: '/api/availability', status: 500 }]);
    verwachtConsoleFout(verzoeken, [{ tekst: /^Beschikbaarheid opslaan mislukt: Error: HTTP 500/ }]);
    const availability = ({ methode }) => methode === 'PUT' ? { status: 500, json: { error: 'kapot' } } : { status: 200, json: { versie: 0, exceptions: [] } };
    const z = zohoStubs();
    await startAppProductie(page, { technieker: 'Tim', overschrijf: { ...z.overschrijf, availability } });
    await openKalender(page);
    await dag(page, '2026-10-06').getByRole('button', { name: '⏱ Beschikbaar' }).click();
    const modal = page.getByRole('dialog', { name: '⛔ Beschikbaarheid' });
    await modal.getByLabel('Reden').fill('Verlof');
    await modal.getByRole('button', { name: '➕ Toevoegen' }).click();
    await expect(toastTekst(page)).toContainText('Opslaan is niet gelukt');
    await settle(page);
    expect(verzoeken.van('/api/availability', 'GET')).toHaveLength(1); // alleen de opstart
  });
});
