// Productietests (etappe 5a, taak 2): de Zoho-gebonden planningspaden (plan, plan-datum, optimize) zonder
// testmodus, met de exacte payloads die naar de backend (en dus Zoho) zouden gaan. Karakterisering: de tests
// leggen het huidige gedrag vast, ook de eigenaardigheden (00:00-sentinel, venster sluit vóór de fetch).
// Alle uitgaande schrijfverzoeken worden per test exact opgesomd (`schrijfLijst`): een ontbrekend of extra
// verzoek laat de test falen. Een HTTP-status >= 400 telt in dit vangnet als consolefout; foutantwoorden
// zijn daarom per test expliciet toegelaten met `verwachtHttpFout` (exact pad + status; faalt als de fout uitblijft).
// De echte backend geeft bij een Zoho-fout 500 + `{ error }` (plan.js, plan-datum.js), bij een trage Zoho kan de
// Netlify-gateway 502/504 met een HTML-body geven (dan faalt res.json() in de client).
import { test, expect, startAppProductie, verwachtSchrijven, verwachtHttpFout, zohoStubs, opslagStub, OPSTART_SCHRIJVEN, settle, openKalender, TICKETS_STUB } from '../productie-hulp.mjs';

const START = 'POST /api/planning-sinds';
const schrijfLijst = async (page, verzoeken) => {
  await settle(page);
  return verzoeken.alle.filter(r => r.methode !== 'GET').map(r => `${r.methode} ${r.pad}`);
};
const planningVan = (page) => page.evaluate(() => Object.fromEntries(
  Object.entries(kern.toestand.get('planning')).map(([d, s]) => [d, s.map(p => p.ticket.id)])));
const wachtrijKaart = (page, nummer) => page.locator('#ticket-list .ticket').filter({ hasText: `#${nummer}` });
const dag = (page, datum) => page.locator(`.day-col[data-date="${datum}"]`);
const toastTekst = (page) => page.locator('#toast');

// Gemeten bij VASTE_NU (maandag 5 okt 2026, Europe/Brussels, UTC+2): de vooraf geplande tickets uit tickets.json.
const BASIS_PLANNING = { '2026-10-07': ['p1'], '2026-10-09': ['g1'] };

// Klantbeschikbaarheid-stub (GET + PUT met versie) met één ticket.
const klantStub = (items) => ({ klantbeschikbaarheid: opslagStub({ versie: 1, items }, 'items') });
const kbItem = (extra) => ({ voorkeur: null, voorkeurTijd: null, geblokkeerd: [], notitie: '', bijgewerkt: '2026-10-01T08:00:00.000Z', ...extra });

async function start(page, verzoeken, { paden = ['/api/plan'], stubs = {}, technieker = 'Tim', httpFouten = [] } = {}) {
  verwachtSchrijven(verzoeken, [...OPSTART_SCHRIJVEN, ...paden]);
  if (httpFouten.length) verwachtHttpFout(verzoeken, httpFouten);
  const z = zohoStubs();
  await startAppProductie(page, { technieker, overschrijf: { ...z.overschrijf, ...stubs } });
  return z;
}

test.describe('+ in de wachtrij (addTicketToDate via quickAdd)', () => {
  test('zonder voorkeursuur: exact één POST /api/plan met de 00:00-sentinel', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken);
    await expect(page.locator('#cnt-tickets')).toHaveText('2');
    await wachtrijKaart(page, 1001).locator('.btn-add').click();
    await expect(toastTekst(page)).toHaveText('✓ Toegevoegd aan 5 okt');

    // Gemeten: eerste vrije werkdag is vandaag (ma 5 okt). 00:00 lokaal = 4 okt 22:00 UTC (zomertijd) = de
    // "geen tijdstip"-sentinel (extractLocalHour).
    expect(z.opnames.plan).toEqual([{
      methode: 'POST',
      body: { ticketId: 't1', date: '2026-10-05', utcInterventieDatum: '2026-10-04T22:00:00.000Z' },
      query: {},
    }]);
    const plan = verzoeken.van('/api/plan', 'POST');
    expect(plan).toHaveLength(1);
    expect(plan[0].headers['content-type']).toBe('application/json');
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, 'POST /api/plan']);

    await expect(page.locator('#cnt-tickets')).toHaveText('1');
    await expect(wachtrijKaart(page, 1001)).toHaveCount(0);
    expect(await planningVan(page)).toEqual({ ...BASIS_PLANNING, '2026-10-05': ['t1'] });
    // Lokale status: Wachten op bevestiging planning; in de kalender zichtbaar.
    expect(await page.evaluate(() => kern.toestand.get('planning')['2026-10-05'][0].ticket.status)).toBe('Wachten op bevestiging planning');
    await openKalender(page);
    // Zonder uur: een chip in de dagkop ("Zonder uur:"), geen tijdlijnblok.
    await expect(dag(page, '2026-10-05').locator('.zu-chip').filter({ hasText: '#1001' })).toHaveCount(1);
  });

  test('met klantvoorkeursuur 10:00: utcInterventieDatum is die dag om 10:00 lokaal', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { stubs: klantStub({ t1: kbItem({ voorkeurTijd: '10:00' }) }) });
    await wachtrijKaart(page, 1001).locator('.btn-add').click();
    await expect(toastTekst(page)).toHaveText('✓ Toegevoegd aan 5 okt');

    // 10:00 lokaal (UTC+2) = 08:00 UTC.
    expect(z.opnames.plan).toEqual([{
      methode: 'POST',
      body: { ticketId: 't1', date: '2026-10-05', utcInterventieDatum: '2026-10-05T08:00:00.000Z' },
      query: {},
    }]);
    expect(verzoeken.van('/api/plan', 'POST')[0].headers['content-type']).toBe('application/json');
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, 'POST /api/plan']);
    // De stop krijgt het voorkeursuur als vast uur.
    expect(await page.evaluate(() => kern.toestand.get('planning')['2026-10-05'][0].uur)).toBe('10:00');
  });

  test('fout van Zoho: rollback, ticket terug in de wachtrij, planning zonder die dag', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { httpFouten: [{ pad: '/api/plan', status: 500 }] });
    z.zetAntwoord('plan', { status: 500, json: { error: 'Zoho kapot' } });
    await wachtrijKaart(page, 1001).locator('.btn-add').click();

    // Gemeten: de toast van addTicketToDate; quickAdd zet daarna geen "Toegevoegd"-toast.
    await expect(toastTekst(page)).toHaveText('✕ Bijwerken in Zoho mislukt. Probeer opnieuw; blijft het fout, meld dit. (Detail: Zoho kapot)');
    expect(z.opnames.plan).toEqual([{
      methode: 'POST',
      body: { ticketId: 't1', date: '2026-10-05', utcInterventieDatum: '2026-10-04T22:00:00.000Z' },
      query: {},
    }]);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, 'POST /api/plan']);
    await expect(wachtrijKaart(page, 1001)).toHaveCount(1);
    await expect(page.locator('#cnt-tickets')).toHaveText('2');
    expect(await planningVan(page)).toEqual(BASIS_PLANNING);
    await expect(toastTekst(page)).not.toContainText('Toegevoegd');
  });

  test('tweede aanroep terwijl het eerste verzoek loopt (inFlight-guard) geeft geen tweede verzoek', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken);
    let geef;
    const vast = new Promise(r => { geef = r; });
    z.zetAntwoord('plan', async ({ body }) => {
      await vast; // de test houdt het antwoord vast tot hij het zelf vrijgeeft
      return { status: 200, json: { success: true, ticketId: body.ticketId, date: body.date } };
    });
    await wachtrijKaart(page, 1001).locator('.btn-add').click();
    await expect.poll(() => z.opnames.plan.length).toBe(1);
    // Terwijl het verzoek loopt (de knop is disabled, een klik is dus een no-op): de functies zelf aanroepen,
    // want enkel zo bewijst dit de inFlightTickets-guard van addTicketToDate. addTicketToDate staat in
    // schermen/planacties.js (kern.planacties).
    const uitkomst = await page.evaluate(async () => {
      const direct = await kern.planacties.addTicketToDate('t1', '2026-10-05'); // guard: false, geen fetch
      await kern.wachtrij.quickAdd('t1'); // zelfde guard via quickAdd; geen toast
      await kern.wachtrij.quickAdd('t1');
      return direct;
    });
    expect(uitkomst).toBe(false);
    expect(z.opnames.plan).toHaveLength(1);
    expect((await planningVan(page))['2026-10-05']).toEqual(['t1']);
    geef();
    await expect(toastTekst(page)).toHaveText('✓ Toegevoegd aan 5 okt');
    expect(z.opnames.plan).toEqual([{
      methode: 'POST',
      body: { ticketId: 't1', date: '2026-10-05', utcInterventieDatum: '2026-10-04T22:00:00.000Z' },
      query: {},
    }]);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, 'POST /api/plan']);
    await expect(page.locator('#cnt-tickets')).toHaveText('1');
  });

  // Bij een trage Zoho geeft de Netlify-gateway 502 met een HTML-body: res.json() gooit en de toast toont
  // 'HTTP 502'. De rollback gebeurt.
  test('502 met HTML-body: rollback, toast met HTTP 502', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { httpFouten: [{ pad: '/api/plan', status: 502 }] });
    z.zetAntwoord('plan', { status: 502, raw: '<html><body>Bad Gateway</body></html>' });
    await wachtrijKaart(page, 1001).locator('.btn-add').click();

    // W5-fix: was HUIDIG GEDRAG (parserfout)
    await expect(toastTekst(page)).toHaveText('✕ Bijwerken in Zoho mislukt. Probeer opnieuw; blijft het fout, meld dit. (Detail: HTTP 502)');
    expect(z.opnames.plan).toHaveLength(1);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, 'POST /api/plan']);
    await expect(wachtrijKaart(page, 1001)).toHaveCount(1);
    await expect(page.locator('#cnt-tickets')).toHaveText('2');
    expect(await planningVan(page)).toEqual(BASIS_PLANNING);
  });
});

// ── ✕ Uit planning halen (removeTicketFromDate via bevestigUitplannen) ──────────────────────────────────
test.describe('✕ uit planning halen in de kalender', () => {
  const kruis = (page) => dag(page, '2026-10-07').locator('.tl-ticket[data-ticket-id="p1"] .cal-unplan-x');
  const bevestigDialoog = (page) => page.getByRole('alertdialog', { name: 'Ticket #1004 uit de planning halen?' });
  async function naarKalender(page) {
    await openKalender(page);
    await expect(dag(page, '2026-10-07').locator('.tl-ticket[data-ticket-id="p1"]')).toHaveCount(1);
  }

  test('bevestigen: POST /api/plan met date null, ticket terug in de wachtrij', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken);
    await naarKalender(page);
    await kruis(page).click();
    await expect(bevestigDialoog(page)).toBeVisible();
    // Nog geen verzoek vóór de bevestiging.
    expect(z.opnames.plan).toEqual([]);
    await bevestigDialoog(page).getByRole('button', { name: 'Uit planning halen' }).click();

    await expect(page.locator('#cnt-tickets')).toHaveText('3');
    expect(z.opnames.plan).toEqual([{ methode: 'POST', body: { ticketId: 'p1', date: null }, query: {} }]);
    expect(verzoeken.van('/api/plan', 'POST')[0].headers['content-type']).toBe('application/json');
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, 'POST /api/plan']);
    await expect(dag(page, '2026-10-07').locator('.tl-ticket[data-ticket-id="p1"]')).toHaveCount(0);
    expect(await planningVan(page)).toEqual({ '2026-10-09': ['g1'] });
    // Lokale staat: ticket terug in allTickets (op nummer gesorteerd), uit allPending, zonder interventiedatum.
    const staat = await page.evaluate(() => ({
      tickets: kern.toestand.get('allTickets').map(t => t.id),
      pending: kern.toestand.get('allPending').map(t => t.id),
      datum: kern.toestand.get('allTickets').find(t => t.id === 'p1').interventieDatum,
    }));
    expect(staat).toEqual({ tickets: ['t1', 't2', 't3', 'p1'], pending: ['p2'], datum: null });
    await page.getByRole('tab', { name: /Wachtrij/ }).click();
    await expect(wachtrijKaart(page, 1004)).toHaveCount(1);
  });

  test('Terug laat alles staan en doet geen verzoek', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: [] });
    await naarKalender(page);
    await kruis(page).click();
    await bevestigDialoog(page).getByRole('button', { name: 'Terug' }).click();
    await expect(bevestigDialoog(page)).toBeHidden();
    expect(z.opnames.plan).toEqual([]);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START]);
    expect(await planningVan(page)).toEqual(BASIS_PLANNING);
    await expect(page.locator('#cnt-tickets')).toHaveText('2');
  });

  test('fout van Zoho: rollback, ticket blijft op de dag', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { httpFouten: [{ pad: '/api/plan', status: 500 }] });
    z.zetAntwoord('plan', { status: 500, json: { error: 'Zoho kapot' } });
    await naarKalender(page);
    await kruis(page).click();
    await bevestigDialoog(page).getByRole('button', { name: 'Uit planning halen' }).click();

    await expect(toastTekst(page)).toHaveText('✕ Bijwerken in Zoho mislukt. Probeer opnieuw; blijft het fout, meld dit. (Detail: Zoho kapot)');
    expect(z.opnames.plan).toEqual([{ methode: 'POST', body: { ticketId: 'p1', date: null }, query: {} }]);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, 'POST /api/plan']);
    expect(await planningVan(page)).toEqual(BASIS_PLANNING);
    await expect(dag(page, '2026-10-07').locator('.tl-ticket[data-ticket-id="p1"]')).toHaveCount(1);
    await expect(page.locator('#cnt-tickets')).toHaveText('2');
    const staat = await page.evaluate(() => ({
      tickets: kern.toestand.get('allTickets').map(t => t.id),
      pending: kern.toestand.get('allPending').map(t => t.id),
    }));
    expect(staat).toEqual({ tickets: ['t1', 't2', 't3'], pending: ['p1', 'p2'] });
  });
});

// ── Verzetten in het detail (saveReschedule) ────────────────────────────────────────────────────────────
test.describe('verzetten in het ticketdetail (saveReschedule)', () => {
  async function openVerzet(page, id = 'p1', datum = '2026-10-07') {
    await openKalender(page);
    await dag(page, datum).locator(`.tl-ticket[data-ticket-id="${id}"] .cal-sub`).click();
    await page.getByRole('button', { name: '📅 Datum/tijd' }).click();
    await expect(page.getByRole('dialog', { name: '📅 Nieuwe datum/tijd' })).toBeVisible();
  }
  const vulIn = async (page, datum, tijd) => {
    const venster = page.getByRole('dialog', { name: '📅 Nieuwe datum/tijd' });
    await venster.locator('#d-reschedule-date').fill(datum);
    await venster.locator('#d-reschedule-time').fill(tijd);
    await venster.getByRole('button', { name: '✓ Opslaan' }).click();
  };
  const staatLijsten = (page) => page.evaluate(() => ({
    pending: kern.toestand.get('allPending').map(t => t.id),
    gepland: kern.toestand.get('allGepland').map(t => t.id),
  }));
  // Verzamelt de native confirm()-meldingen en beantwoordt ze (accepteren of weigeren).
  function beantwoordDialogen(page, accepteer) {
    const berichten = [];
    page.on('dialog', d => { berichten.push(d.message()); return accepteer ? d.accept() : d.dismiss(); });
    return berichten;
  }

  test('verzet #1004 naar do 8 okt 14:30: POST /api/plan met de nieuwe dag en tijd', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken);
    const dialogen = beantwoordDialogen(page, true);
    await openVerzet(page);
    await vulIn(page, '2026-10-08', '14:30');

    await expect(toastTekst(page)).toHaveText('✓ Verzet naar 8 okt om 14:30');
    // 14:30 lokaal (UTC+2) = 12:30 UTC.
    expect(z.opnames.plan).toEqual([{
      methode: 'POST',
      body: { ticketId: 'p1', date: '2026-10-08', utcInterventieDatum: '2026-10-08T12:30:00.000Z' },
      query: {},
    }]);
    expect(verzoeken.van('/api/plan', 'POST')[0].headers['content-type']).toBe('application/json');
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, 'POST /api/plan']);
    expect(dialogen).toEqual([]);
    expect(await planningVan(page)).toEqual({ '2026-10-08': ['p1'], '2026-10-09': ['g1'] });
    const p1 = await page.evaluate(() => {
      const t = kern.toestand.get('planning')['2026-10-08'][0];
      return { status: t.ticket.status, interventieDatum: t.ticket.interventieDatum, uur: t.uur };
    });
    expect(p1).toEqual({ status: 'Wachten op bevestiging planning', interventieDatum: '2026-10-08T12:30:00.000Z', uur: '14:30' });
    expect(await staatLijsten(page)).toEqual({ pending: ['p1', 'p2'], gepland: ['g1'] });
    await expect(page.locator('#det-overlay')).not.toHaveClass(/open/);
    await expect(page.locator('#reschedule-overlay')).not.toHaveClass(/open/);
    await expect(dag(page, '2026-10-07').locator('.tl-ticket[data-ticket-id="p1"]')).toHaveCount(0);
    await expect(dag(page, '2026-10-08').locator('.tl-ticket[data-ticket-id="p1"]')).toHaveCount(1);
  });

  test('#1006 (Geplande service, allGepland) verhuist naar allPending', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken);
    await openVerzet(page, 'g1', '2026-10-09');
    await vulIn(page, '2026-10-12', '09:00');

    await expect(toastTekst(page)).toHaveText('✓ Verzet naar 12 okt om 09:00');
    expect(z.opnames.plan).toEqual([{
      methode: 'POST',
      body: { ticketId: 'g1', date: '2026-10-12', utcInterventieDatum: '2026-10-12T07:00:00.000Z' },
      query: {},
    }]);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, 'POST /api/plan']);
    expect(await planningVan(page)).toEqual({ '2026-10-07': ['p1'], '2026-10-12': ['g1'] });
    expect(await staatLijsten(page)).toEqual({ pending: ['p1', 'p2', 'g1'], gepland: [] });
    expect(await page.evaluate(() => kern.toestand.get('planning')['2026-10-12'][0].ticket.status)).toBe('Wachten op bevestiging planning');
  });

  test('feestdag (11 nov): confirm; weigeren = geen verzoek, venster blijft open', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: [] });
    const dialogen = beantwoordDialogen(page, false);
    await openVerzet(page);
    await vulIn(page, '2026-11-11', '10:00');

    await expect.poll(() => dialogen.length).toBe(1);
    expect(dialogen[0]).toBe('🎌 Wapenstilstand is een wettelijke feestdag (11 nov).\nToch inplannen?');
    expect(z.opnames.plan).toEqual([]);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START]);
    expect(await planningVan(page)).toEqual(BASIS_PLANNING);
    // De confirm komt vóór het sluiten: het verzetvenster en het detail blijven open.
    await expect(page.locator('#reschedule-overlay')).toHaveClass(/open/);
    await expect(page.locator('#det-overlay')).toHaveClass(/open/);
  });

  test('feestdag (11 nov): accepteren plant toch (winteruur: 10:00 lokaal = 09:00 UTC)', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken);
    const dialogen = beantwoordDialogen(page, true);
    await openVerzet(page);
    await vulIn(page, '2026-11-11', '10:00');

    await expect(toastTekst(page)).toHaveText('✓ Verzet naar 11 nov om 10:00');
    expect(dialogen).toEqual(['🎌 Wapenstilstand is een wettelijke feestdag (11 nov).\nToch inplannen?']);
    expect(z.opnames.plan).toEqual([{
      methode: 'POST',
      body: { ticketId: 'p1', date: '2026-11-11', utcInterventieDatum: '2026-11-11T09:00:00.000Z' },
      query: {},
    }]);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, 'POST /api/plan']);
    expect(await planningVan(page)).toEqual({ '2026-10-09': ['g1'], '2026-11-11': ['p1'] });
  });

  // W5-fix: nieuw. Gateway-502 met HTML-body bij het verzetten: de toast toont 'HTTP 502', de planning blijft ongewijzigd.
  test('502 met HTML-body: toast met HTTP 502, planning ongewijzigd', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { httpFouten: [{ pad: '/api/plan', status: 502 }] });
    z.zetAntwoord('plan', { status: 502, raw: '<html><body>Bad Gateway</body></html>' });
    beantwoordDialogen(page, true);
    await openVerzet(page);
    await vulIn(page, '2026-10-08', '14:30');

    await expect(toastTekst(page)).toHaveText('✕ Bijwerken in Zoho mislukt. Probeer opnieuw; blijft het fout, meld dit. (Detail: HTTP 502)');
    expect(z.opnames.plan).toHaveLength(1);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, 'POST /api/plan']);
    expect(await planningVan(page)).toEqual(BASIS_PLANNING);
  });

  test('klant niet beschikbaar op de nieuwe dag: confirm; weigeren = geen verzoek', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: [], stubs: klantStub({ p1: kbItem({ geblokkeerd: ['2026-10-08'] }) }) });
    const dialogen = beantwoordDialogen(page, false);
    await openVerzet(page);
    await vulIn(page, '2026-10-08', '10:00');

    await expect.poll(() => dialogen.length).toBe(1);
    expect(dialogen[0]).toBe('⚠ Klant gaf aan NIET beschikbaar te zijn op 8 okt.\nToch inplannen?');
    expect(z.opnames.plan).toEqual([]);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START]);
    expect(await planningVan(page)).toEqual(BASIS_PLANNING);
  });

  test('klant niet beschikbaar: accepteren plant toch; zelfde dag geeft geen waarschuwing', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { stubs: klantStub({ p1: kbItem({ geblokkeerd: ['2026-10-07', '2026-10-08'] }) }) });
    const dialogen = beantwoordDialogen(page, true);
    // Zelfde dag (7 okt, door de klant geblokkeerd) met een ander uur: geen confirm, wel een verzoek.
    await openVerzet(page);
    await vulIn(page, '2026-10-07', '11:00');
    await expect(toastTekst(page)).toHaveText('✓ Verzet naar 7 okt om 11:00');
    expect(dialogen).toEqual([]);
    expect(z.opnames.plan).toEqual([{
      methode: 'POST',
      body: { ticketId: 'p1', date: '2026-10-07', utcInterventieDatum: '2026-10-07T09:00:00.000Z' },
      query: {},
    }]);
    expect(await planningVan(page)).toEqual(BASIS_PLANNING);
    // Andere dag (8 okt, geblokkeerd): confirm, accepteren, tweede verzoek.
    await dag(page, '2026-10-07').locator('.tl-ticket[data-ticket-id="p1"] .cal-sub').click();
    await page.getByRole('button', { name: '📅 Datum/tijd' }).click();
    await vulIn(page, '2026-10-08', '10:00');
    await expect(toastTekst(page)).toHaveText('✓ Verzet naar 8 okt om 10:00');
    expect(dialogen).toEqual(['⚠ Klant gaf aan NIET beschikbaar te zijn op 8 okt.\nToch inplannen?']);
    expect(z.opnames.plan.map(o => o.body)).toEqual([
      { ticketId: 'p1', date: '2026-10-07', utcInterventieDatum: '2026-10-07T09:00:00.000Z' },
      { ticketId: 'p1', date: '2026-10-08', utcInterventieDatum: '2026-10-08T08:00:00.000Z' },
    ]);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, 'POST /api/plan', 'POST /api/plan']);
    expect(await planningVan(page)).toEqual({ '2026-10-08': ['p1'], '2026-10-09': ['g1'] });
  });

  test('fout van Zoho: de vensters sluiten vóór de fetch, daarna toast en ongewijzigde planning', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { httpFouten: [{ pad: '/api/plan', status: 500 }] });
    let geef;
    const vast = new Promise(r => { geef = r; });
    z.zetAntwoord('plan', async () => { await vast; return { status: 500, json: { error: 'Zoho kapot' } }; });
    await openVerzet(page);
    await vulIn(page, '2026-10-08', '14:30');

    // Het verzoek loopt (vastgehouden): detail en verzetvenster zijn al dicht, de planning nog ongewijzigd.
    await expect.poll(() => z.opnames.plan.length).toBe(1);
    await expect(page.locator('#reschedule-overlay')).not.toHaveClass(/open/);
    await expect(page.locator('#det-overlay')).not.toHaveClass(/open/);
    expect(await planningVan(page)).toEqual(BASIS_PLANNING);
    geef();

    await expect(toastTekst(page)).toHaveText('✕ Bijwerken in Zoho mislukt. Probeer opnieuw; blijft het fout, meld dit. (Detail: Zoho kapot)');
    expect(z.opnames.plan).toEqual([{
      methode: 'POST',
      body: { ticketId: 'p1', date: '2026-10-08', utcInterventieDatum: '2026-10-08T12:30:00.000Z' },
      query: {},
    }]);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, 'POST /api/plan']);
    expect(await planningVan(page)).toEqual(BASIS_PLANNING);
    expect(await staatLijsten(page)).toEqual({ pending: ['p1', 'p2'], gepland: ['g1'] });
    await expect(page.locator('#det-overlay')).not.toHaveClass(/open/);
    await expect(dag(page, '2026-10-07').locator('.tl-ticket[data-ticket-id="p1"]')).toHaveCount(1);
  });
});

// ── 📅 Toewijzen in het "zonder datum"-paneel (saveToewijzen) ───────────────────────────────────────────
test.describe('📅 toewijzen (saveToewijzen)', () => {
  async function openRij(page) {
    await openKalender(page);
    await page.locator('#kal-pending-pill').click();
    const kaart = page.locator('#kal-no-date-section .ticket').filter({ hasText: '#1005' });
    await kaart.getByRole('button', { name: '📅 Toewijzen' }).click();
    await expect(kaart.locator('.t-assign-row')).toBeVisible();
    return kaart;
  }

  test('datum en tijd: POST /api/plan-datum, ticket in de planning', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/plan-datum'] });
    const kaart = await openRij(page);
    await kaart.getByLabel('Datum toewijzen').fill('2026-10-06');
    await kaart.getByLabel('Tijd toewijzen').fill('13:15');
    await kaart.getByRole('button', { name: '✓ Opslaan' }).click();

    await expect(toastTekst(page)).toHaveText('✓ Datum ingesteld op 2026-10-06 om 13:15');
    // 13:15 lokaal (UTC+2) = 11:15 UTC.
    expect(z.opnames['plan-datum']).toEqual([{
      methode: 'POST',
      body: { ticketId: 'p2', utcInterventieDatum: '2026-10-06T11:15:00.000Z' },
      query: {},
    }]);
    expect(verzoeken.van('/api/plan-datum', 'POST')[0].headers['content-type']).toBe('application/json');
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, 'POST /api/plan-datum']);
    expect(z.opnames.plan).toEqual([]);
    expect(await planningVan(page)).toEqual({ ...BASIS_PLANNING, '2026-10-06': ['p2'] });
    const stop = await page.evaluate(() => {
      const s = kern.toestand.get('planning')['2026-10-06'][0];
      return { uur: s.uur, interventieDatum: s.ticket.interventieDatum };
    });
    expect(stop).toEqual({ uur: '13:15', interventieDatum: '2026-10-06T11:15:00.000Z' });
  });

  test('fout 500 met {error}: toast met de fout, geen lokale wijziging', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/plan-datum'], httpFouten: [{ pad: '/api/plan-datum', status: 500 }] });
    z.zetAntwoord('plan-datum', { status: 500, json: { error: 'x' } });
    const kaart = await openRij(page);
    await kaart.getByLabel('Datum toewijzen').fill('2026-10-06');
    await kaart.getByLabel('Tijd toewijzen').fill('13:15');
    await kaart.getByRole('button', { name: '✓ Opslaan' }).click();

    await expect(toastTekst(page)).toHaveText('✕ x');
    expect(z.opnames['plan-datum']).toEqual([{
      methode: 'POST',
      body: { ticketId: 'p2', utcInterventieDatum: '2026-10-06T11:15:00.000Z' },
      query: {},
    }]);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, 'POST /api/plan-datum']);
    expect(await planningVan(page)).toEqual(BASIS_PLANNING);
    expect(await page.evaluate(() => kern.toestand.get('allPending').find(t => t.id === 'p2').interventieDatum)).toBeNull();
  });

  // Zelfde gateway-fout voor plan-datum: HTML-body, res.json() gooit, de toast toont 'HTTP 502'.
  test('502 met HTML-body: toast met HTTP 502, geen lokale wijziging', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/plan-datum'], httpFouten: [{ pad: '/api/plan-datum', status: 502 }] });
    z.zetAntwoord('plan-datum', { status: 502, raw: '<html><body>Bad Gateway</body></html>' });
    const kaart = await openRij(page);
    await kaart.getByLabel('Datum toewijzen').fill('2026-10-06');
    await kaart.getByLabel('Tijd toewijzen').fill('13:15');
    await kaart.getByRole('button', { name: '✓ Opslaan' }).click();

    // W5-fix: was HUIDIG GEDRAG (parserfout)
    await expect(toastTekst(page)).toHaveText('✕ HTTP 502');
    expect(z.opnames['plan-datum']).toHaveLength(1);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START, 'POST /api/plan-datum']);
    expect(await planningVan(page)).toEqual(BASIS_PLANNING);
    expect(await page.evaluate(() => kern.toestand.get('allPending').find(t => t.id === 'p2').interventieDatum)).toBeNull();
  });

  test('zonder datum: waarschuwing en geen verzoek', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: [] });
    const kaart = await openRij(page);
    await kaart.getByLabel('Datum toewijzen').fill('');
    await kaart.getByRole('button', { name: '✓ Opslaan' }).click();

    await expect(toastTekst(page)).toHaveText('⚠ Selecteer een datum');
    expect(z.opnames['plan-datum']).toEqual([]);
    expect(await schrijfLijst(page, verzoeken)).toEqual([START]);
    expect(await planningVan(page)).toEqual(BASIS_PLANNING);
  });
});

// ── ⚡ Plan deze week (autoPlan) ─────────────────────────────────────────────────────────────────────────
// Tickets zonder coördinaten (geen _lat/_lon): autoPlan moet ze eerst geocoderen via POST /api/optimize.
const TICKETS = TICKETS_STUB;
const zonderCoords = () => {
  const kopie = structuredClone(TICKETS);
  for (const t of kopie.tickets) { delete t._lat; delete t._lon; }
  return kopie;
};
const matrixVerzoeken = (verzoeken) => verzoeken.van('/api/matrix', 'POST');
// Alle niet-GET verzoeken behalve /api/matrix (die telt apart, het aantal hangt van het brein af).
const schrijfLijstZonderMatrix = async (page, verzoeken) => (await schrijfLijst(page, verzoeken)).filter(r => r !== 'POST /api/matrix');

test.describe('⚡ plan deze week (autoPlan)', () => {
  const resultaat = (page) => page.getByRole('dialog', { name: '⚡ Planningsresultaat' });
  async function klikPlan(page) {
    await openKalender(page);
    await page.getByRole('button', { name: '⚡ Plan deze week' }).click();
  }

  test('geen geocodes nodig: geen /api/optimize, per ticket één POST /api/plan', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/plan', '/api/matrix'] });
    await klikPlan(page);
    await expect(resultaat(page).getByText('Ingepland (2)', { exact: true })).toBeVisible();

    expect(verzoeken.van('/api/optimize')).toEqual([]);
    expect(z.opnames.optimize).toEqual([]);
    // Gemeten: beide Tim-tickets op maandag 5 okt, zonder tijdstip (00:00-sentinel = 4 okt 22:00 UTC).
    expect(z.opnames.plan).toEqual([
      { methode: 'POST', body: { ticketId: 't1', date: '2026-10-05', utcInterventieDatum: '2026-10-04T22:00:00.000Z' }, query: {} },
      { methode: 'POST', body: { ticketId: 't2', date: '2026-10-05', utcInterventieDatum: '2026-10-04T22:00:00.000Z' }, query: {} },
    ]);
    expect(await schrijfLijstZonderMatrix(page, verzoeken)).toEqual([START, 'POST /api/plan', 'POST /api/plan']);
    expect(matrixVerzoeken(verzoeken).length).toBeGreaterThanOrEqual(1);
    expect(await planningVan(page)).toEqual({ ...BASIS_PLANNING, '2026-10-05': ['t1', 't2'] });
  });

  test('ontbrekende geocodes: POST /api/optimize met startlocatie en adressen, daarna matrix en plan', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, {
      paden: ['/api/plan', '/api/matrix', '/api/optimize'],
      stubs: { tickets: () => ({ status: 200, json: zonderCoords() }) },
    });
    await klikPlan(page);
    await expect(resultaat(page).getByText('Ingepland (2)', { exact: true })).toBeVisible();

    // Gemeten: de standaard startlocatie uit de instellingen, en de adressen in de volgorde van de wachtrij.
    expect(z.opnames.optimize).toEqual([{
      methode: 'POST',
      body: { origin: 'Heirbaan 9, 9150 Kruibeke', stops: ['Antwerpseweg 50, 2440 Geel', 'Kuringersteenweg 12, 3500 Hasselt'] },
      query: {},
    }]);
    expect(verzoeken.van('/api/optimize', 'POST')[0].headers['content-type']).toBe('application/json');
    expect(matrixVerzoeken(verzoeken).length).toBeGreaterThanOrEqual(1);
    expect(z.opnames.plan.map(o => o.body)).toEqual([
      { ticketId: 't1', date: '2026-10-05', utcInterventieDatum: '2026-10-04T22:00:00.000Z' },
      { ticketId: 't2', date: '2026-10-05', utcInterventieDatum: '2026-10-04T22:00:00.000Z' },
    ]);
    // De volgorde van de verzoeken: eerst geocoderen, dan plannen.
    expect(await schrijfLijstZonderMatrix(page, verzoeken)).toEqual([START, 'POST /api/optimize', 'POST /api/plan', 'POST /api/plan']);
    await expect(resultaat(page).getByText(/#1001 Laadpaal offline na stroomuitval → .*5 okt/)).toBeVisible();
    await expect(resultaat(page).getByText(/#1002 Controller reageert niet op OCPP commando → .*5 okt/)).toBeVisible();
    expect(await planningVan(page)).toEqual({ ...BASIS_PLANNING, '2026-10-05': ['t1', 't2'] });
  });

  test('fout bij één plan-verzoek: dat ticket staat bij "Niet ingepland" met reden zoho-fout', async ({ page, verzoeken }) => {
    const z = await start(page, verzoeken, { paden: ['/api/plan', '/api/matrix'], httpFouten: [{ pad: '/api/plan', status: 500 }] });
    z.zetAntwoord('plan', ({ body }) => body.ticketId === 't2'
      ? { status: 500, json: { error: 'Zoho kapot' } }
      : { status: 200, json: { success: true, ticketId: body.ticketId, date: body.date } });
    await klikPlan(page);
    const venster = resultaat(page);
    await expect(venster.getByText('Ingepland (1)', { exact: true })).toBeVisible();
    await expect(venster.getByText('Niet ingepland (1)', { exact: true })).toBeVisible();
    await expect(venster.getByText(/#1001 Laadpaal offline na stroomuitval → .*5 okt/)).toBeVisible();
    await expect(venster.getByText(/#1002 Controller reageert niet op OCPP commando/)).toBeVisible();
    await expect(venster.getByText('Kon niet opgeslagen worden in Zoho')).toBeVisible();

    expect(z.opnames.plan.map(o => o.body)).toEqual([
      { ticketId: 't1', date: '2026-10-05', utcInterventieDatum: '2026-10-04T22:00:00.000Z' },
      { ticketId: 't2', date: '2026-10-05', utcInterventieDatum: '2026-10-04T22:00:00.000Z' },
    ]);
    expect(await schrijfLijstZonderMatrix(page, verzoeken)).toEqual([START, 'POST /api/plan', 'POST /api/plan']);
    // Rollback van t2: enkel t1 staat in de planning, t2 blijft in de wachtrij.
    expect(await planningVan(page)).toEqual({ ...BASIS_PLANNING, '2026-10-05': ['t1'] });
    await expect(page.locator('#cnt-tickets')).toHaveText('1');
  });
});

// ── Route "Tijden vastleggen" (applyRouteOrder → POST /api/plan-datum per gewijzigde stop) ────────────────
test.describe('route: tijden vastleggen', () => {
  // Werkdag van Tim begint om 10:00 (zoals een gebruiker via Instellingen zou bewaren); enkel in het hoofdvenster.
  async function zetStartTijd(page, vanTijd) {
    await page.addInitScript((i) => {
      if (window !== window.top) return;
      if (localStorage.getItem('blitz_settings_Tim') === null) localStorage.setItem('blitz_settings_Tim', JSON.stringify(i));
    }, { vanTijd });
  }
  // "Plan deze week" zet #1001 en #1002 op maandag 5 okt; vandaaruit de Route-tab.
  async function naarRoute(page) {
    await openKalender(page);
    await page.getByRole('button', { name: '⚡ Plan deze week' }).click();
    const venster = page.getByRole('dialog', { name: '⚡ Planningsresultaat' });
    await expect(venster.getByText('Ingepland (2)', { exact: true })).toBeVisible();
    await venster.getByRole('button', { name: 'Sluiten' }).click();
    await expect(venster).toBeHidden();
    await page.getByRole('tab', { name: 'Route' }).click();
    await expect(page.getByTestId('route-aantal-stops')).toHaveText('2');
    await expect(page.getByTestId('route-stop-tijd')).toHaveCount(2);
  }
  const PADEN = ['/api/plan', '/api/matrix', '/api/route', '/api/optimize', '/api/drukte', '/api/plan-datum', '/api/planning-sinds'];
  // matrix, optimize, route en drukte zijn POST's die niets naar Zoho schrijven; hun aantal hangt van het brein en de
  // route-heuristiek af (Gemeten: matrix 1, optimize 1, route 2, drukte 2). Daarom: telling met >=, exacte payload waar
  // die deterministisch is (optimize), en een exacte lijst voor alle overige (Zoho-gebonden) schrijfverzoeken.
  const BEREKEND = new Set(['POST /api/matrix', 'POST /api/optimize', 'POST /api/route', 'POST /api/drukte']);
  const zohoLijst = async (page, verzoeken) => (await schrijfLijst(page, verzoeken)).filter(r => !BEREKEND.has(r));
  const berekeningenGelopen = (verzoeken) => {
    for (const pad of ['/api/matrix', '/api/optimize', '/api/route', '/api/drukte']) {
      expect(verzoeken.van(pad, 'POST').length, pad).toBeGreaterThanOrEqual(1);
    }
  };
  const NAAR_ROUTE = [START, 'POST /api/plan', 'POST /api/plan'];

  test('elke niet-verankerde stop met een nieuw uur: één POST /api/plan-datum, in stopvolgorde', async ({ page, verzoeken }) => {
    await zetStartTijd(page, '10:00');
    const z = await start(page, verzoeken, { paden: PADEN });
    await naarRoute(page);
    expect(z.opnames['plan-datum']).toEqual([]);
    await page.getByRole('button', { name: 'Tijden vastleggen' }).click();
    await expect(toastTekst(page)).toHaveText('✓ Volgorde en tijdstippen bijgewerkt');

    // Gemeten (zelfde waarden als e2e/route.spec.mjs): #1001 om 10:30 en #1002 om 12:45 lokaal (UTC+2).
    expect(z.opnames['plan-datum']).toEqual([
      { methode: 'POST', body: { ticketId: 't1', utcInterventieDatum: '2026-10-05T08:30:00.000Z' }, query: {} },
      { methode: 'POST', body: { ticketId: 't2', utcInterventieDatum: '2026-10-05T10:45:00.000Z' }, query: {} },
    ]);
    for (const r of verzoeken.van('/api/plan-datum', 'POST')) expect(r.headers['content-type']).toBe('application/json');
    // Gemeten: het openen van de Route-tab geocodeert (zoals bij autoPlan) de startlocatie en de adressen van de stops.
    expect(z.opnames.optimize.map(o => o.body)).toEqual([{ origin: 'Heirbaan 9, 9150 Kruibeke', stops: ['Antwerpseweg 50, 2440 Geel', 'Kuringersteenweg 12, 3500 Hasselt'] }]);
    berekeningenGelopen(verzoeken);
    expect(await zohoLijst(page, verzoeken)).toEqual([...NAAR_ROUTE, 'POST /api/plan-datum', 'POST /api/plan-datum']);
    // Lokaal: de tickets onthouden de bewaarde datum.
    expect(await page.evaluate(() => kern.toestand.get('planning')['2026-10-05'].map(p => [p.ticket.id, p.ticket.interventieDatum, p.uur])))
      .toEqual([['t1', '2026-10-05T08:30:00.000Z', '10:30'], ['t2', '2026-10-05T10:45:00.000Z', '12:45']]);
    // Opnieuw vastleggen kan niet meer: beide stops hebben nu een tijdstip, de knop is weg.
    await expect(page.getByRole('button', { name: 'Tijden vastleggen' })).toHaveCount(0);
  });

  test('een stop met voorkeursuur (verankerd) wordt nooit gepost', async ({ page, verzoeken }) => {
    await zetStartTijd(page, '10:00');
    const z = await start(page, verzoeken, {
      paden: PADEN,
      stubs: klantStub({ t1: kbItem({ voorkeurTijd: '11:00' }) }),
    });
    await naarRoute(page);
    // t1 staat vast om 11:00 (verankerd), t2 is vrij.
    await page.getByRole('button', { name: 'Tijden vastleggen' }).click();
    await expect(toastTekst(page)).toHaveText('✓ Volgorde en tijdstippen bijgewerkt');

    // t1 is met zijn voorkeursuur (11:00 lokaal = 09:00 UTC) ingepland, t2 zonder tijdstip.
    expect(z.opnames.plan.map(o => o.body)).toEqual([
      { ticketId: 't1', date: '2026-10-05', utcInterventieDatum: '2026-10-05T09:00:00.000Z' },
      { ticketId: 't2', date: '2026-10-05', utcInterventieDatum: '2026-10-04T22:00:00.000Z' },
    ]);
    // Gemeten: enkel t2 wordt vastgelegd; t1 (voorkeursuur 11:00 is al zijn uur) krijgt geen verzoek.
    const ids = z.opnames['plan-datum'].map(o => o.body.ticketId);
    expect(ids).toEqual(['t2']);
    expect(z.opnames['plan-datum']).toEqual([
      { methode: 'POST', body: { ticketId: 't2', utcInterventieDatum: '2026-10-05T11:30:00.000Z' }, query: {} },
    ]);
    berekeningenGelopen(verzoeken);
    expect(await zohoLijst(page, verzoeken)).toEqual([...NAAR_ROUTE, 'POST /api/plan-datum']);
  });

  test('fout bij het tweede verzoek: toast, tickets herladen, geen derde verzoek', async ({ page, verzoeken }) => {
    await zetStartTijd(page, '10:00');
    const z = await start(page, verzoeken, { paden: PADEN, httpFouten: [{ pad: '/api/plan-datum', status: 500 }] });
    // Eerste plan-datum lukt, de tweede niet (de opname staat er al vóór het antwoord).
    z.zetAntwoord('plan-datum', ({ body }) => z.opnames['plan-datum'].length === 2
      ? { status: 500, json: { error: 'Zoho kapot' } }
      : { status: 200, json: { ok: true, interventieDatum: body.utcInterventieDatum } });
    await naarRoute(page);
    const ticketsVoor = verzoeken.van('/api/tickets', 'GET').length;
    await page.getByRole('button', { name: 'Tijden vastleggen' }).click();

    // Herladen via afh.loadTickets: één extra GET /api/tickets, daarna de wachttijden (planning-sinds).
    await expect.poll(() => verzoeken.van('/api/tickets', 'GET').length).toBe(ticketsVoor + 1);
    await expect.poll(() => verzoeken.van('/api/planning-sinds', 'POST').length).toBe(2);
    // Deterministisch: pas NA de volledige herlading en een rustige klok (binnen de 5 s van de toast) is de
    // foutmelding nog zichtbaar. Voor de bugfix (W5) overschreef de telmelding van loadTickets ze meteen.
    await settle(page);
    await expect(toastTekst(page)).toHaveText('✕ Volgorde bewaren mislukt voor #1002');
    await expect(toastTekst(page)).toHaveClass(/show/);
    expect(z.opnames['plan-datum']).toEqual([
      { methode: 'POST', body: { ticketId: 't1', utcInterventieDatum: '2026-10-05T08:30:00.000Z' }, query: {} },
      { methode: 'POST', body: { ticketId: 't2', utcInterventieDatum: '2026-10-05T10:45:00.000Z' }, query: {} },
    ]);
    // Na de fout herlaadt afh.loadTickets en vraagt de app de wachttijden opnieuw op (planning-sinds).
    berekeningenGelopen(verzoeken);
    expect(await zohoLijst(page, verzoeken)).toEqual([...NAAR_ROUTE, 'POST /api/plan-datum', 'POST /api/plan-datum', START]);
  });
});
