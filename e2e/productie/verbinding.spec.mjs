// Productietests (etappe 7, taak 1): karakterisering van wat de app doet bij een slechte verbinding (afgebroken of
// hangend verzoek). Elke pin hieronder legt het HUIDIGE gedrag vast, ook waar dat een bug is; de taak die het omdraait
// staat bij de pin (`→ T<n>`). Een omgedraaide pin wordt in een aparte commit aangepast (RED → GREEN), niet gewist.
// Nepbackend: `{ afbreken: 'failed' }` breekt het verzoek af nadat de stub het opnam (de fetch gooit een TypeError),
// `{ hangen: true }` beantwoordt het nooit. Een bewust afgebroken pad meld je met `verwachtNetwerkFout`.
import {
  test, expect, startAppProductie, verwachtSchrijven, verwachtHttpFout, verwachtNetwerkFout, verwachtConsoleFout,
  zohoStubs, OPSTART_SCHRIJVEN, settle, openKalender, TICKETS_STUB,
} from '../productie-hulp.mjs';

const toastTekst = (page) => page.locator('#toast');
const planningVan = (page) => page.evaluate(() => Object.fromEntries(
  Object.entries(kern.toestand.get('planning')).map(([d, s]) => [d, s.map(p => p.ticket.id)])));
const wachtrijKaart = (page, nummer) => page.locator('#ticket-list .ticket').filter({ hasText: `#${nummer}` });
const dag = (page, datum) => page.locator(`.day-col[data-date="${datum}"]`);

// tickets-stub met een omschakelbaar gedrag; `aantal` telt de GET-aanroepen (de opstart is de eerste).
function ticketsStub({ gepland = false } = {}) {
  const toestand = { afbreken: false, aantal: 0 };
  const stub = () => {
    toestand.aantal++;
    if (toestand.afbreken) return { afbreken: 'failed' };
    const data = structuredClone(TICKETS_STUB);
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

async function startPlan(page, verzoeken, { stubs = {}, paden = ['/api/plan'] } = {}) {
  verwachtSchrijven(verzoeken, [...OPSTART_SCHRIJVEN, ...paden]);
  const z = zohoStubs();
  await startAppProductie(page, { technieker: 'Tim', overschrijf: { ...z.overschrijf, ...stubs } });
  return z;
}

test.describe('verbinding: planning (plan) en vernieuwen', () => {
  test('P1 (→ T6, H1): na een geslaagde plan-aanroep en een mislukte vernieuwing komt het ticket terug in de wachtrij', async ({ page, verzoeken }) => {
    const t = ticketsStub();
    verwachtNetwerkFout(verzoeken, [{ pad: '/api/tickets' }]);
    await startPlan(page, verzoeken, { stubs: { tickets: t.stub } });
    await wachtrijKaart(page, 1001).locator('.btn-add').click();
    await expect(toastTekst(page)).toHaveText('✓ Toegevoegd aan 5 okt');
    await expect(page.locator('#cnt-tickets')).toHaveText('1');
    expect(await planningVan(page)).toMatchObject({ '2026-10-05': ['t1'] });

    // De verbinding valt weg; de gebruiker klikt op Vernieuwen. loadTickets past eerst de bewaarde kopie van de
    // opstart toe (die het ticket nog als "in te plannen" kent) en faalt daarna op de fetch.
    t.toestand.afbreken = true;
    await page.getByRole('button', { name: 'Vernieuwen' }).click();
    await expect(toastTekst(page)).toContainText('✕');
    await settle(page);

    // HUIDIG GEDRAG (bug?): het ticket dat zojuist (geslaagd) gepland werd, staat weer in de wachtrij en niet meer in de route.
    await expect(page.locator('#cnt-tickets')).toHaveText('2');
    await expect(wachtrijKaart(page, 1001)).toHaveCount(1);
    expect(await planningVan(page)).not.toHaveProperty('2026-10-05');
  });

  test('P2 (→ T2, H2): een hangende plan-aanroep blijft "in flight" (geen time-out), een tweede klik doet niets', async ({ page, verzoeken }) => {
    const z = await startPlan(page, verzoeken);
    z.zetAntwoord('plan', { hangen: true });
    await wachtrijKaart(page, 1001).locator('.btn-add').click();
    await expect.poll(() => z.opnames.plan.length).toBe(1);
    await page.clock.runFor(120000);
    await page.evaluate(() => Promise.resolve());

    // HUIDIG GEDRAG (bug?): na twee minuten wacht de app nog steeds; de knop blijft uitgeschakeld en er komt geen foutmelding.
    const knop = wachtrijKaart(page, 1001).locator('.btn-add');
    await expect(knop).toBeDisabled();
    await knop.click({ force: true });
    await page.clock.runFor(1000);
    expect(z.opnames.plan).toHaveLength(1);
    await expect(toastTekst(page)).not.toContainText('mislukt');
    expect(await planningVan(page)).toMatchObject({ '2026-10-05': ['t1'] }); // nog de optimistische stand
  });

  test('P4 (→ T6, H3): een afgebroken plan-aanroep wordt teruggedraaid, maar de app herlaadt de tickets niet', async ({ page, verzoeken }) => {
    const t = ticketsStub({ gepland: true });
    verwachtNetwerkFout(verzoeken, [{ pad: '/api/plan' }]);
    const z = await startPlan(page, verzoeken, { stubs: { tickets: t.stub } });
    const basis = await planningVan(page);
    expect(t.toestand.aantal).toBe(1); // de opstartlading
    z.zetAntwoord('plan', { afbreken: 'failed' });
    await wachtrijKaart(page, 1001).locator('.btn-add').click();
    await expect(toastTekst(page)).toContainText('Bijwerken in Zoho mislukt');
    await settle(page);

    // Het verzoek kwam wel aan (afgebroken nadat de stub het opnam): de uitkomst is onzeker, de rollback is lokaal.
    expect(z.opnames.plan).toHaveLength(1);
    expect(await planningVan(page)).toEqual(basis);
    await expect(wachtrijKaart(page, 1001)).toHaveCount(1);
    await expect(page.locator('#cnt-tickets')).toHaveText('2');
    // HUIDIG GEDRAG (bug?): geen herlading om te zien of Zoho het ticket tóch plande.
    expect(t.toestand.aantal).toBe(1);
    expect(verzoeken.van('/api/tickets', 'GET')).toHaveLength(1);
  });
});

test.describe('verbinding: annuleren', () => {
  test('P3 (→ T2, H6): een hangende annuleer-aanroep houdt het venster vast, ook na twee minuten en Escape', async ({ page, verzoeken }) => {
    verwachtSchrijven(verzoeken, [...OPSTART_SCHRIJVEN, '/api/annuleer']);
    const register = { versie: 4, status: { p1: { contact: '2026-10-04T08:00:00.000Z', tijdslot: '09:30–12:30', tijdslotDatum: '2026-10-07' } } };
    const z = zohoStubs({ register });
    // Bewust zonder vasteKlok: met een bevroren Date blijft page.clock.runFor(120000) hangen (de pagina draait vast).
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
    await page.clock.runFor(120000);
    await page.evaluate(() => Promise.resolve());

    // HUIDIG GEDRAG (bug?): het venster zit vast: "Bezig…", Terug uit, Escape sluit niet.
    await expect(page.locator('#annuleer-verstuur')).toHaveText('Bezig…');
    await expect(page.locator('#annuleer-terug')).toBeDisabled();
    await page.keyboard.press('Escape');
    await page.clock.runFor(1000);
    await expect(page.locator('#annuleer-overlay')).toHaveClass(/open/);
    await expect(toastTekst(page)).not.toContainText('mislukt');
  });
});

test.describe('verbinding: beschikbaarheid bewaren', () => {
  test('P5 (→ T6, H5): een afgebroken PUT na opslag op de server: lokaal teruggedraaid, de volgende schrijf geeft 409 en het item komt terug', async ({ page, verzoeken }) => {
    verwachtSchrijven(verzoeken, [...OPSTART_SCHRIJVEN, '/api/availability']);
    verwachtNetwerkFout(verzoeken, [{ pad: '/api/availability' }]);
    verwachtHttpFout(verzoeken, [{ pad: '/api/availability', status: 409 }]);
    verwachtConsoleFout(verzoeken, [{ bevat: 'Beschikbaarheid opslaan mislukt' }]);

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
    await expect(modal.getByText('Geen blokkeringen voor deze dag.')).toBeVisible(); // lokaal teruggedraaid
    expect(stand.exceptions.map(e => e.reason)).toEqual(['Verlof']); // maar op de server staat het wel

    // Tweede schrijf (bewaart met de oude versie): 409; het weggerolde item komt terug uit de serverstand.
    await modal.getByLabel('Reden').fill('Cursus');
    await modal.getByRole('button', { name: '➕ Toevoegen' }).click();
    // HUIDIG GEDRAG (bug?): geen herlading na de onzekere eerste schrijf; pas de 409 brengt de serverstand binnen.
    await expect(toastTekst(page)).toContainText('Iemand anders wijzigde dit net');
    await expect(modal.getByText('🔒 Hele dag — Verlof')).toBeVisible();
    await expect(modal.getByText('Cursus')).toHaveCount(0); // de tweede schrijf is weggegooid
    expect(puts).toBe(2);
  });
});
