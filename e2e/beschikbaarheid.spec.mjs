import { test, expect, startApp as startAppBasis, opslagStub, TICKETS_STUB } from './helpers.mjs';
import { maakSalesBackend, verwachtFout, BEHEERDER, ANDERE_VERKOPERS } from './sales-hulp.mjs';

// Beheer opent meteen op Beschikbaarheden (de gekozen subtab blijft staan in de sessie): zo vraagt de test niet ook /api/gebruikers van
// de tab Instellingen op. Alleen in het hoofdvenster (een sandboxed iframe heeft geen sessionStorage).
// De keuzelijst "Voor wie" komt uit /api/gebruikers (actieve accounts met een Zoho-naam): standaard Tim en Roel, plus een vertrokken technieker
// (geblokkeerd) en een account zonder Zoho-naam die er niet in horen. Een test kan `gebruikers` in `overschrijf` vervangen.
const GEBRUIKERS = () => [
  { id: 'u-t1', naam: 'Tim Techniek', rol: 'technieker', zohoNaam: 'Tim', actief: true },
  { id: 'u-t2', naam: 'Roel Techniek', rol: 'technieker', zohoNaam: 'Roel', actief: true },
  { id: 'u-t3', naam: 'Kursat Deniz', rol: 'technieker', zohoNaam: 'Kursat Deniz', actief: false },
  { id: 'u-b1', naam: 'Test Beheerder', rol: 'beheerder', actief: true },
];
const gebruikersStub = (lijst = GEBRUIKERS()) => ({ methode }) => (methode === 'GET' ? { status: 200, json: { gebruikers: structuredClone(lijst) } } : { status: 400, json: { error: 'x' } });
const startApp = async (page, opties = {}) => {
  await page.addInitScript(() => { if (window === window.top) sessionStorage.setItem('blitz_beheer_tab', 'beschikbaarheden'); });
  return startAppBasis(page, { ...opties, overschrijf: { gebruikers: gebruikersStub(), ...opties.overschrijf } });
};
// Een ticketstand waarop de eerste ticket nog op een vertrokken technieker staat (geen actief account meer).
const ticketsMetVertrokkene = () => {
  const t = structuredClone(TICKETS_STUB);
  t.tickets[0].assignee = 'Kursat Deniz';
  return () => ({ status: 200, json: t });
};

// Etappe 5b, taak 1: karakterisering van de blokkeringen (beschikbaarheid) buiten wat al gedekt is.
// Bestaand (niet dupliceren): hele dag en tijdvak vanuit de kalender, de payloads van PUT /api/availability
// en de persoonsfilter in de kalender (voorstel-afspraak-blokkering.spec.mjs), Escape en achtergrondklik
// (vensters.spec.mjs), 409 bij afspraken (conflict-409.spec.mjs). Hier: de tab Beheer → Beschikbaarheden (renderBeschikbaarhedenTab, groupExceptionsForDisplay, nextWorkday) en de keuzeknoppen
// van het blokkeringsvenster (avSetKind, avSetScope, datumvelden). Testklok: maandag 5 okt 2026.

const BLOK = (o) => ({ id: 'x', scope: 'global', person: null, kind: 'fullday', from: null, to: null, reason: '', ...o });

async function openTab(page) {
  await page.getByRole('tab', { name: 'Beheer', exact: true }).click();
  await page.getByRole('tab', { name: 'Beschikbaarheden', exact: true }).click();
  const paneel = page.locator('#beheer-paneel');
  await expect(paneel.locator('#beheer-beschikbaarheden-inhoud')).toBeVisible();
  await expect(paneel.locator('#bav-filter-person')).toBeVisible();
  return paneel;
}
const lijst = (modal) => modal.locator('#beheer-beschikbaarheden-inhoud .av-existing .av-item .av-item-label');
const lijstTekst = async (modal) => (await lijst(modal).allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim());
const puts = (verzoeken) => verzoeken.van('/api/availability', 'PUT');
const metSeed = (exceptions, versie = 1) => ({ availability: opslagStub({ versie, exceptions }, 'exceptions') });
const toastTekst = (page) => page.locator('#toast');

// Stateful stub met een eerste PUT die 409 (met de server-stand) of 500 geeft.
function stubFout(seed, { status, serverStand }) {
  let stand = { versie: 1, exceptions: seed };
  let n = 0;
  return {
    availability: ({ methode, body }) => {
      if (methode !== 'PUT') return { status: 200, json: stand };
      if (++n === 1) {
        if (status === 409) {
          stand = serverStand;
          return { status: 409, json: { error: 'Versiematch mislukt', serverVersie: stand.versie, data: stand } };
        }
        return { status: 500, json: { error: 'kapot' } };
      }
      stand = { versie: stand.versie + 1, exceptions: body.exceptions };
      return { status: 200, json: stand };
    },
  };
}
// Haalt de verwachte consolemeldingen van een mislukte opslag weg (en eist dat ze er waren).
async function verwachtMeldingen(consoleFouten, delen) {
  for (const deel of delen) {
    await expect.poll(() => consoleFouten.filter(f => f.includes(deel)).length, deel).toBeGreaterThan(0);
    for (const f of consoleFouten.filter(f => f.includes(deel))) consoleFouten.splice(consoleFouten.indexOf(f), 1);
  }
}

test.describe('Beheer: tab Beschikbaarheden', () => {
  test('lege staat, standaarddatum is vandaag en nextWorkday is geen standaard-einddatum', async ({ page }) => {
    await startApp(page);
    const modal = await openTab(page);
    await expect(modal.locator('#beheer-beschikbaarheden-inhoud .av-empty')).toHaveText('Geen geplande beschikbaarheids-uitzonderingen.');
    await expect(modal.locator('#bav-date')).toHaveValue('2026-10-05');
    await expect(modal.locator('#bav-filter-person')).toHaveValue('all');
    // De keuzelijst "Voor wie" is de enige personenkeuze: geen aparte "Voor"-knoppen meer in het formulier.
    await expect(modal.getByRole('combobox', { name: 'Voor wie' })).toBeVisible();
    await expect(modal.getByRole('heading', { name: 'Voor wie' })).toBeVisible();
    await expect(modal.getByRole('heading', { name: 'Voor', exact: true })).toHaveCount(0);
    await expect(modal.getByRole('button', { name: '👥 Iedereen' })).toHaveCount(0);
    // Meerdere werkdagen: het einddatumveld verschijnt leeg (HUIDIG GEDRAG: geen volgende werkdag als standaard).
    await modal.locator('#bav-multiday').check();
    await expect(modal.locator('#bav-date-tot')).toBeVisible();
    await expect(modal.locator('#bav-date-tot')).toHaveValue('');
  });

  test('hele dag voor iedereen: verschijnt in de lijst met label en datum', async ({ page, verzoeken }) => {
    await startApp(page);
    const modal = await openTab(page);
    await modal.locator('#bav-date').fill('2026-10-07');
    await modal.locator('#bav-reden').fill('Teamdag');
    await modal.getByRole('button', { name: '➕ Toevoegen' }).click();
    await expect(lijst(modal)).toHaveCount(1);
    expect(await lijstTekst(modal)).toEqual(['7 okt 2026 · 🔒 Hele dag — Teamdag (Iedereen)']);
    const p = puts(verzoeken);
    expect(p).toHaveLength(1);
    expect(p[0].body.versie).toBe(0);
    expect(p[0].body.exceptions).toEqual([{ id: expect.any(String), scope: 'global', person: null, date: '2026-10-07', kind: 'fullday', from: null, to: null, reason: 'Teamdag' }]);
    // Het formulier wordt hertekend: de reden is leeg, de datum blijft staan.
    await expect(modal.locator('#bav-reden')).toHaveValue('');
    await expect(modal.locator('#bav-date')).toHaveValue('2026-10-07');
  });

  test('meerdaags verlof over een weekend: één blokkade per werkdag en één gegroepeerde regel', async ({ page, verzoeken }) => {
    await startApp(page);
    const modal = await openTab(page);
    await modal.locator('#bav-date').fill('2026-10-09'); // vrijdag
    await modal.locator('#bav-multiday').check();
    await modal.locator('#bav-date-tot').fill('2026-10-13'); // dinsdag
    await modal.locator('#bav-reden').fill('Verlof');
    await modal.getByRole('button', { name: '➕ Toevoegen' }).click();
    await expect(lijst(modal)).toHaveCount(1);
    expect(await lijstTekst(modal)).toEqual(['9 okt 2026 – 13 okt 2026 · 🔒 Hele dag — Verlof (Iedereen)']);
    const p = puts(verzoeken);
    expect(p).toHaveLength(1);
    expect(p[0].body.exceptions.map(e => e.date)).toEqual(['2026-10-09', '2026-10-12', '2026-10-13']); // za en zo overgeslagen
    expect(p[0].body.exceptions.every(e => e.kind === 'fullday' && e.scope === 'global' && e.person === null && e.reason === 'Verlof')).toBe(true);
    expect(new Set(p[0].body.exceptions.map(e => e.id)).size).toBe(3);
    // Na het toevoegen is het meerdaagse formulier terug enkelvoudig.
    await expect(modal.locator('#bav-multiday')).not.toBeChecked();
    await expect(modal.locator('#bav-date-tot')).toHaveCount(0);
  });

  test('tijdvak met van en tot: label met tijden; een eindtijd voor de begintijd wordt geweigerd', async ({ page, verzoeken }) => {
    await startApp(page);
    const modal = await openTab(page);
    await modal.getByRole('button', { name: '⏱ Tijdvak' }).click();
    await expect(modal.getByRole('button', { name: '⏱ Tijdvak' })).toHaveAttribute('aria-pressed', 'true');
    await expect(modal.getByRole('button', { name: '🔒 Hele dag' })).toHaveAttribute('aria-pressed', 'false');
    // De standaardtijden komen uit de werkuren (08:00 - 17:00).
    await expect(modal.locator('#bav-van')).toHaveValue('08:00');
    await expect(modal.locator('#bav-tot')).toHaveValue('17:00');
    // Het meerdaagse vinkje bestaat niet bij een tijdvak.
    await expect(modal.locator('#bav-multiday')).toHaveCount(0);

    await modal.locator('#bav-van').fill('15:00');
    await modal.locator('#bav-tot').fill('14:00');
    await modal.getByRole('button', { name: '➕ Toevoegen' }).click();
    await expect(toastTekst(page)).toHaveText('⚠ Eindtijd moet na begintijd liggen');
    expect(puts(verzoeken)).toEqual([]);
    expect(await lijstTekst(modal)).toEqual([]);

    await modal.locator('#bav-tot').fill('15:00'); // gelijk is ook geweigerd
    await modal.getByRole('button', { name: '➕ Toevoegen' }).click();
    await expect(toastTekst(page)).toHaveText('⚠ Eindtijd moet na begintijd liggen');
    expect(puts(verzoeken)).toEqual([]);

    await modal.locator('#bav-tot').fill('16:30');
    await modal.locator('#bav-reden').fill('Tandarts');
    await modal.getByRole('button', { name: '➕ Toevoegen' }).click();
    await expect(lijst(modal)).toHaveCount(1);
    expect(await lijstTekst(modal)).toEqual(['5 okt 2026 · ⏱ 15:00–16:30 — Tandarts (Iedereen)']);
    expect(puts(verzoeken)[0].body.exceptions).toEqual([{ id: expect.any(String), scope: 'global', person: null, date: '2026-10-05', kind: 'range', from: '15:00', to: '16:30', reason: 'Tandarts' }]);
  });

  test('weigeringen bij meerdere werkdagen: einddatum voor begindatum en een periode zonder werkdagen', async ({ page, verzoeken }) => {
    await startApp(page);
    const modal = await openTab(page);
    await modal.locator('#bav-date').fill('2026-10-09');
    await modal.locator('#bav-multiday').check();
    await modal.locator('#bav-date-tot').fill('2026-10-08');
    await modal.getByRole('button', { name: '➕ Toevoegen' }).click();
    await expect(toastTekst(page)).toHaveText('⚠ Einddatum moet na startdatum liggen');
    expect(puts(verzoeken)).toEqual([]);

    await modal.locator('#bav-date').fill('2026-10-10'); // zaterdag
    await modal.locator('#bav-date-tot').fill('2026-10-11'); // zondag
    await modal.getByRole('button', { name: '➕ Toevoegen' }).click();
    await expect(toastTekst(page)).toHaveText('⚠ In deze periode zijn er geen werkdagen. Kies andere data.');
    expect(puts(verzoeken)).toEqual([]);
    expect(await lijstTekst(modal)).toEqual([]);
  });

  test('meerdaags aangevinkt zonder einddatum: toast "⚠ Kies een einddatum, of vink "Meerdere werkdagen" uit", geen PUT', async ({ page, verzoeken }) => {
    await startApp(page);
    const modal = await openTab(page);
    await modal.locator('#bav-date').fill('2026-10-08');
    await modal.locator('#bav-multiday').check();
    await modal.getByRole('button', { name: '➕ Toevoegen' }).click();
    await expect(toastTekst(page)).toHaveText('⚠ Kies een einddatum, of vink "Meerdere werkdagen" uit');
    expect(puts(verzoeken)).toEqual([]);
    expect(await lijstTekst(modal)).toEqual([]);
  });

  test('lege datum: toast "⚠ Kies een datum" en geen PUT', async ({ page, verzoeken }) => {
    await startApp(page);
    const modal = await openTab(page);
    await modal.locator('#bav-date').fill('');
    await modal.getByRole('button', { name: '➕ Toevoegen' }).click();
    await expect(toastTekst(page)).toHaveText('⚠ Kies een datum');
    expect(puts(verzoeken)).toEqual([]);
    expect(await lijstTekst(modal)).toEqual([]);
  });

  test('groepering: aaneensluitende werkdagen met dezelfde persoon en reden vormen één regel; verleden blijft verborgen', async ({ page }) => {
    const seed = [
      BLOK({ id: 'a1', date: '2026-10-09', reason: 'Verlof' }), BLOK({ id: 'a2', date: '2026-10-12', reason: 'Verlof' }), // vr + ma: sluiten aan
      BLOK({ id: 'a3', date: '2026-10-14', reason: 'Verlof' }),   // woensdag: di 13 ontbreekt, dus een nieuwe groep
      BLOK({ id: 'b1', date: '2026-10-15', reason: 'Dokter' }),   // andere reden
      BLOK({ id: 'c1', date: '2026-10-16', reason: 'Verlof', scope: 'person', person: 'Tim' }), // andere persoon/scope
      BLOK({ id: 'd1', date: '2026-10-19', kind: 'range', from: '09:00', to: '10:00', reason: 'Dokter' }), // tijdvak wordt nooit samengevoegd
      BLOK({ id: 'd2', date: '2026-10-20', kind: 'range', from: '09:00', to: '10:00', reason: 'Dokter' }),
      BLOK({ id: 'old', date: '2026-10-02', reason: 'Voorbij' }), // vóór vandaag (5 okt)
    ];
    await startApp(page, { overschrijf: metSeed(seed) });
    const modal = await openTab(page);
    expect(await lijstTekst(modal)).toEqual([
      '9 okt 2026 – 12 okt 2026 · 🔒 Hele dag — Verlof (Iedereen)',
      '14 okt 2026 · 🔒 Hele dag — Verlof (Iedereen)',
      '15 okt 2026 · 🔒 Hele dag — Dokter (Iedereen)',
      '16 okt 2026 · 🔒 Hele dag — Verlof (Tim)',
      '19 okt 2026 · ⏱ 09:00–10:00 — Dokter (Iedereen)',
      '20 okt 2026 · ⏱ 09:00–10:00 — Dokter (Iedereen)',
    ]);
    // De groep draagt alle onderliggende ids op de verwijderknop.
    await expect(modal.locator('.av-item-del').first()).toHaveAttribute('data-exception-ids', 'a1,a2');
  });

  test('filter op persoon: toont zijn blokkades en de algemene; het formulier wordt "voor die persoon"', async ({ page, verzoeken }) => {
    const seed = [
      BLOK({ id: 'g1', date: '2026-10-06', reason: 'Bedrijfsuitstap' }),
      BLOK({ id: 't1', date: '2026-10-07', reason: 'Verlof', scope: 'person', person: 'Tim' }),
      BLOK({ id: 'r1', date: '2026-10-08', reason: 'Tandarts', scope: 'person', person: 'Roel' }),
    ];
    await startApp(page, { overschrijf: metSeed(seed) });
    const modal = await openTab(page);
    expect(await lijstTekst(modal)).toEqual([
      '6 okt 2026 · 🔒 Hele dag — Bedrijfsuitstap (Iedereen)',
      '7 okt 2026 · 🔒 Hele dag — Verlof (Tim)',
      '8 okt 2026 · 🔒 Hele dag — Tandarts (Roel)',
    ]);
    // De keuzelijst: "Iedereen", plus de actieve accounts met een Zoho-naam (Roel, Tim).
    expect(await modal.locator('#bav-filter-person option').allInnerTexts()).toEqual(['Iedereen', 'Roel (technieker)', 'Tim (technieker)']);

    await modal.locator('#bav-filter-person').selectOption('Tim');
    expect(await lijstTekst(modal)).toEqual([
      '6 okt 2026 · 🔒 Hele dag — Bedrijfsuitstap (Iedereen)',
      '7 okt 2026 · 🔒 Hele dag — Verlof (Tim)',
    ]);
    await expect(modal.locator('#bav-filter-person')).toHaveValue('Tim');
    // Geen aparte scope-knoppen: de keuzelijst bepaalt voor wie de afwezigheid geldt.
    await expect(modal.getByRole('button', { name: '👤 Tim' })).toHaveCount(0);
    await expect(modal.getByRole('button', { name: '👥 Iedereen' })).toHaveCount(0);
    await modal.locator('#bav-date').fill('2026-10-09');
    await modal.getByRole('button', { name: '➕ Toevoegen' }).click();
    await expect.poll(() => puts(verzoeken).length).toBe(1);
    expect(puts(verzoeken)[0].body.exceptions.at(-1)).toEqual({ id: expect.any(String), scope: 'person', person: 'Tim', date: '2026-10-09', kind: 'fullday', from: null, to: null, reason: '' });
    expect(await lijstTekst(modal)).toContain('9 okt 2026 · 🔒 Hele dag (Tim)');

    // "Iedereen" kiezen in de keuzelijst: de nieuwe blokkade is algemeen.
    await modal.locator('#bav-filter-person').selectOption('all');
    await modal.locator('#bav-date').fill('2026-10-13');
    await modal.getByRole('button', { name: '➕ Toevoegen' }).click();
    await expect.poll(() => puts(verzoeken).length).toBe(2);
    expect(puts(verzoeken)[1].body.exceptions.at(-1)).toMatchObject({ scope: 'global', person: null, date: '2026-10-13' });

    // Een andere persoon: zijn blokkades plus de algemene. Bij "Iedereen" staan alle afwezigheden in de lijst.
    await modal.locator('#bav-filter-person').selectOption('Roel');
    expect(await lijstTekst(modal)).toEqual([
      '6 okt 2026 · 🔒 Hele dag — Bedrijfsuitstap (Iedereen)',
      '8 okt 2026 · 🔒 Hele dag — Tandarts (Roel)',
      '13 okt 2026 · 🔒 Hele dag (Iedereen)',
    ]);
    await modal.locator('#bav-filter-person').selectOption('all');
    expect(await lijstTekst(modal)).toEqual([
      '6 okt 2026 · 🔒 Hele dag — Bedrijfsuitstap (Iedereen)',
      '7 okt 2026 · 🔒 Hele dag — Verlof (Tim)',
      '8 okt 2026 · 🔒 Hele dag — Tandarts (Roel)',
      '9 okt 2026 · 🔒 Hele dag (Tim)',
      '13 okt 2026 · 🔒 Hele dag (Iedereen)',
    ]);
  });

  test('keuzelijst "Voor wie": enkel actieve accounts met een Zoho-naam; een vertrokken persoon staat er niet in maar zijn afwezigheid blijft verwijderbaar', async ({ page, verzoeken }) => {
    const seed = [
      BLOK({ id: 'k1', date: '2026-10-08', reason: 'Oud verlof', scope: 'person', person: 'Kursat Deniz' }),
      BLOK({ id: 't1', date: '2026-10-07', reason: 'Verlof', scope: 'person', person: 'Tim' }),
    ];
    // Kursat Deniz heeft nog een ticket en een afwezigheid, maar geen actief account (geblokkeerd) meer; Tim en Roel wel.
    await startApp(page, { overschrijf: { ...metSeed(seed), tickets: ticketsMetVertrokkene() } });
    const modal = await openTab(page);
    expect(await modal.locator('#bav-filter-person option').allInnerTexts()).toEqual(['Iedereen', 'Roel (technieker)', 'Tim (technieker)']);
    // Zijn afwezigheid staat nog in de lijst van komende afwezigheden, zodat ze verwijderd kan worden.
    expect(await lijstTekst(modal)).toEqual([
      '7 okt 2026 · 🔒 Hele dag — Verlof (Tim)',
      '8 okt 2026 · 🔒 Hele dag — Oud verlof (Kursat Deniz)',
    ]);
    await modal.locator('.av-item-del').nth(1).click();
    await expect.poll(() => puts(verzoeken).length).toBe(1);
    expect(puts(verzoeken)[0].body.exceptions.map(e => e.id)).toEqual(['t1']);
  });

  test('keuzelijst "Voor wie": lukt /api/gebruikers niet, dan terugval op de personen uit tickets en afwezigheden', async ({ page, consoleFouten }) => {
    const seed = [BLOK({ id: 'k1', date: '2026-10-08', reason: 'Oud verlof', scope: 'person', person: 'Kursat Deniz' })];
    await startApp(page, { overschrijf: { ...metSeed(seed), tickets: ticketsMetVertrokkene(), gebruikers: () => ({ status: 500, json: { error: 'kapot' } }) } });
    const modal = await openTab(page);
    await verwachtMeldingen(consoleFouten, ['/api/gebruikers']);
    expect(await modal.locator('#bav-filter-person option').allInnerTexts()).toEqual(['Iedereen', 'Kursat Deniz', 'Roel', 'Tim']);
  });

  test('datumvelden van de tab (data-wijzig): een echte change-gebeurtenis bubbelt tot het private veld en overleeft het hertekenen', async ({ page }) => {
    await startApp(page);
    const modal = await openTab(page);
    await modal.locator('#bav-date').fill('2026-10-14');
    await modal.locator('#bav-multiday').check(); // hertekent het formulier
    await modal.locator('#bav-date-tot').fill('2026-10-16');
    await modal.getByRole('button', { name: '⏱ Tijdvak' }).click(); // hertekent opnieuw
    await expect(modal.locator('#bav-date')).toHaveValue('2026-10-14');
    await modal.getByRole('button', { name: '🔒 Hele dag' }).click();
    await modal.locator('#bav-multiday').check();
    await expect(modal.locator('#bav-date-tot')).toHaveValue('2026-10-16'); // het private veld (bavSetKind wist enkel het vinkje) bleef bewaard
  });

  test('persoon zonder blokkades: de lege melding noemt de persoon', async ({ page }) => {
    await startApp(page);
    const modal = await openTab(page);
    await modal.locator('#bav-filter-person').selectOption('Tim');
    await expect(modal.locator('#beheer-beschikbaarheden-inhoud .av-empty')).toHaveText('Geen geplande beschikbaarheids-uitzonderingen voor Tim.');
  });

  test('verwijderen van een groep: alle ids in één PUT', async ({ page, verzoeken }) => {
    const seed = [
      BLOK({ id: 'a1', date: '2026-10-06', reason: 'Verlof' }), BLOK({ id: 'a2', date: '2026-10-07', reason: 'Verlof' }), BLOK({ id: 'a3', date: '2026-10-08', reason: 'Verlof' }),
      BLOK({ id: 'z1', date: '2026-10-20', reason: 'Blijft' }),
    ];
    await startApp(page, { overschrijf: metSeed(seed, 3) });
    const modal = await openTab(page);
    expect(await lijstTekst(modal)).toEqual(['6 okt 2026 – 8 okt 2026 · 🔒 Hele dag — Verlof (Iedereen)', '20 okt 2026 · 🔒 Hele dag — Blijft (Iedereen)']);
    await modal.locator('.av-item-del').first().click();
    await expect.poll(() => puts(verzoeken).length).toBe(1);
    expect(puts(verzoeken)[0].body).toEqual({ versie: 3, exceptions: [BLOK({ id: 'z1', date: '2026-10-20', reason: 'Blijft' })] });
    expect(await lijstTekst(modal)).toEqual(['20 okt 2026 · 🔒 Hele dag — Blijft (Iedereen)']);
    // Ook de kalender kent de verwijderde dagen niet meer.
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await expect(page.locator('.day-col[data-date="2026-10-07"]').getByText('🔒 Geblokkeerd')).toHaveCount(0);
  });

  test('een blokkade uit de tab is meteen zichtbaar in de kalender (dag geblokkeerd)', async ({ page }) => {
    await startApp(page);
    const modal = await openTab(page);
    await modal.locator('#bav-date').fill('2026-10-07');
    await modal.getByRole('button', { name: '➕ Toevoegen' }).click();
    await expect(lijst(modal)).toHaveCount(1);
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await expect(page.locator('.day-col[data-date="2026-10-07"]').getByText('🔒 Geblokkeerd')).toBeVisible();
  });

  test('opslag mislukt (500): de blokkade wordt teruggedraaid en de toast meldt de fout', async ({ page, verzoeken, consoleFouten }) => {
    await startApp(page, { overschrijf: stubFout([], { status: 500 }) });
    const modal = await openTab(page);
    await modal.locator('#bav-date').fill('2026-10-07');
    await modal.getByRole('button', { name: '➕ Toevoegen' }).click();
    await expect(toastTekst(page)).toHaveText('✕ Opslaan is niet gelukt. Controleer je verbinding en probeer opnieuw.');
    expect(puts(verzoeken)).toHaveLength(1);
    expect(await lijstTekst(modal)).toEqual([]); // teruggedraaid
    await verwachtMeldingen(consoleFouten, ['/api/availability', 'Beschikbaarheid opslaan mislukt']);
  });

  test('conflict (409): de server-stand wordt geladen, waarschuwing; de eigen blokkade is weg en de volgende PUT gebruikt de nieuwe versie', async ({ page, verzoeken, consoleFouten }) => {
    const collega = BLOK({ id: 'srv', date: '2026-10-09', reason: 'Collega' });
    await startApp(page, { overschrijf: stubFout([], { status: 409, serverStand: { versie: 5, exceptions: [collega] } }) });
    const modal = await openTab(page);
    await modal.locator('#bav-date').fill('2026-10-07');
    await modal.getByRole('button', { name: '➕ Toevoegen' }).click();
    await expect(toastTekst(page)).toHaveText('⚠ Iemand anders wijzigde dit net. De gegevens zijn opnieuw geladen.');
    expect(puts(verzoeken)).toHaveLength(1);
    await expect.poll(() => lijstTekst(modal)).toEqual(['9 okt 2026 · 🔒 Hele dag — Collega (Iedereen)']);
    await modal.locator('#bav-date').fill('2026-10-08');
    await modal.getByRole('button', { name: '➕ Toevoegen' }).click();
    await expect.poll(() => puts(verzoeken).length).toBe(2);
    expect(puts(verzoeken)[1].body.versie).toBe(5);
    expect(puts(verzoeken)[1].body.exceptions.map(e => e.date)).toEqual(['2026-10-09', '2026-10-08']);
    await verwachtMeldingen(consoleFouten, ['/api/availability']);
  });
});

test.describe('Beheer → Beschikbaarheden per rol', () => {
  const beheerTabs = (page) => page.locator('.beheer-tabs [role="tab"]');

  test('beheerder: de subtab staat na Instellingen en ⚙ heeft geen Beschikbaarheden meer', async ({ page }) => {
    await startApp(page);
    await page.getByRole('tab', { name: 'Beheer', exact: true }).click();
    await expect(beheerTabs(page).filter({ hasText: /^(Instellingen|Beschikbaarheden)$/ })).toHaveText(['Instellingen', 'Beschikbaarheden']);
    await page.getByRole('tab', { name: 'Kalender', exact: true }).click();
    await page.getByRole('button', { name: 'Instellingen', exact: true }).click();
    const venster = page.getByRole('dialog', { name: /⚙️ Instellingen/ });
    await expect(venster).toBeVisible();
    await expect(venster.locator('#set-subtab-beschikbaarheden')).toHaveCount(0);
    await expect(venster.locator('#set-tab-beschikbaarheden')).toHaveCount(0);
    await expect(venster.getByRole('button', { name: 'Beschikbaarheden', exact: true })).toHaveCount(0);
  });

  test('planner: ziet de subtab en een afwezigheid voor Tim verschijnt als blokkering in de kalender van Tim (niet in die van Roel)', async ({ page, verzoeken }) => {
    await startApp(page, { loginRol: 'planner', technieker: 'Tim' });
    const paneel = await openTab(page);
    await expect(beheerTabs(page)).toContainText(['Beschikbaarheden']);
    await paneel.locator('#bav-filter-person').selectOption('Tim');
    await paneel.locator('#bav-date').fill('2026-10-07');
    await paneel.locator('#bav-reden').fill('Verlof');
    await paneel.getByRole('button', { name: '➕ Toevoegen' }).click();
    await expect(lijst(paneel)).toHaveCount(1);
    await expect.poll(() => puts(verzoeken).length).toBe(1);
    expect(puts(verzoeken)[0].body.exceptions).toMatchObject([{ scope: 'person', person: 'Tim', date: '2026-10-07', kind: 'fullday', reason: 'Verlof' }]);
    await page.getByRole('tab', { name: 'Kalender', exact: true }).click();
    await expect(page.locator('.day-col[data-date="2026-10-07"]').getByText('🔒 Geblokkeerd')).toBeVisible();
    // Roel ziet de afwezigheid van Tim niet.
    await page.locator('#person-btn').click();
    await page.locator('#person-menu').getByRole('button', { name: /Roel/ }).click();
    await expect(page.locator('.day-col[data-date="2026-10-07"]').getByText('🔒 Geblokkeerd')).toHaveCount(0);
  });

  test('planner: een afwezigheid voor iedereen toevoegen en weer verwijderen', async ({ page, verzoeken }) => {
    await startApp(page, { loginRol: 'planner' });
    const paneel = await openTab(page);
    await paneel.locator('#bav-date').fill('2026-10-08');
    await paneel.getByRole('button', { name: '➕ Toevoegen' }).click();
    await expect(lijst(paneel)).toHaveCount(1);
    await paneel.locator('.av-item-del').click();
    await expect(lijst(paneel)).toHaveCount(0);
    await expect.poll(() => puts(verzoeken).length).toBe(2);
    expect(puts(verzoeken)[1].body.exceptions).toEqual([]);
  });

  test('technieker (ook met "Mag zelf plannen"): geen Beheer, geen Beschikbaarheden in ⚙', async ({ page }) => {
    await startApp(page, { loginRol: 'technieker', loginGebruiker: { zohoNaam: 'Tim', magZelfPlannen: true }, technieker: 'Tim' });
    await expect(page.getByRole('tab', { name: 'Beheer', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Instellingen', exact: true }).click();
    await expect(page.locator('#set-subtab-beschikbaarheden')).toHaveCount(0);
    await expect(page.locator('#set-tab-beschikbaarheden')).toHaveCount(0);
  });
});

test.describe('blokkeringsvenster vanuit de kalender: keuzeknoppen en datumvelden', () => {
  async function openBlok(page, dag = '2026-10-06', opties, knop = '⏱ Beschikbaar') {
    await startApp(page, opties);
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await page.locator(`.day-col[data-date="${dag}"]`).getByRole('button', { name: knop }).click();
    const modal = page.getByRole('dialog', { name: '⛔ Beschikbaarheid' });
    await expect(modal).toBeVisible();
    return modal;
  }

  test('type wisselen (avSetKind): Hele dag toont het periode-vinkje, Tijdvak de tijdvelden; meerdaags wordt gewist', async ({ page }) => {
    const modal = await openBlok(page);
    await expect(modal.getByRole('button', { name: '🔒 Hele dag' })).toHaveAttribute('aria-pressed', 'true');
    await expect(modal.getByRole('button', { name: '⏱ Tijdvak' })).toHaveAttribute('aria-pressed', 'false');
    await expect(modal.locator('#av-multiday')).toBeVisible();
    await expect(modal.locator('#av-van')).toHaveCount(0);

    await modal.locator('#av-multiday').check();
    await expect(modal.locator('#av-date-van')).toHaveValue('2026-10-06');
    await expect(modal.locator('#av-date-tot')).toHaveValue('');

    await modal.getByRole('button', { name: '⏱ Tijdvak' }).click();
    await expect(modal.getByRole('button', { name: '⏱ Tijdvak' })).toHaveAttribute('aria-pressed', 'true');
    await expect(modal.locator('#av-van')).toHaveValue('08:00');
    await expect(modal.locator('#av-tot')).toHaveValue('17:00');
    await expect(modal.locator('#av-multiday')).toHaveCount(0);

    await modal.getByRole('button', { name: '🔒 Hele dag' }).click();
    await expect(modal.locator('#av-multiday')).not.toBeChecked(); // het meerdaagse vinkje is gewist
    await expect(modal.locator('#av-date-tot')).toHaveCount(0);
  });

  test('scope wisselen (avSetScope): met een gekozen technieker kan "Iedereen" gekozen worden', async ({ page, verzoeken }) => {
    const modal = await openBlok(page, '2026-10-06', { technieker: 'Tim' });
    await expect(modal.getByRole('button', { name: '👤 Tim' })).toHaveAttribute('aria-pressed', 'true');
    await modal.getByRole('button', { name: '👥 Iedereen' }).click();
    await expect(modal.getByRole('button', { name: '👥 Iedereen' })).toHaveAttribute('aria-pressed', 'true');
    await expect(modal.getByRole('button', { name: '👤 Tim' })).toHaveAttribute('aria-pressed', 'false');
    await modal.getByLabel('Reden').fill('Gezamenlijk');
    await modal.getByRole('button', { name: '➕ Toevoegen' }).click();
    await expect(modal.getByText('🔒 Hele dag — Gezamenlijk (Iedereen)')).toBeVisible();
    expect(puts(verzoeken)[0].body.exceptions).toEqual([{ id: expect.any(String), scope: 'global', person: null, date: '2026-10-06', kind: 'fullday', from: null, to: null, reason: 'Gezamenlijk' }]);
    // Terug naar de persoon en nog een blokkade: nu persoonlijk.
    await modal.getByRole('button', { name: '👤 Tim' }).click();
    await modal.getByRole('button', { name: '➕ Toevoegen' }).click();
    await expect.poll(() => puts(verzoeken).length).toBe(2);
    expect(puts(verzoeken)[1].body.exceptions.at(-1)).toMatchObject({ scope: 'person', person: 'Tim', date: '2026-10-06' });
  });

  test('datum wijzigen bij meerdere werkdagen: de blokkades komen op de gekozen data, niet op de geopende dag', async ({ page, verzoeken }) => {
    const modal = await openBlok(page);
    await modal.locator('#av-multiday').check();
    await modal.locator('#av-date-van').fill('2026-10-13');
    await modal.locator('#av-date-tot').fill('2026-10-14');
    await modal.getByLabel('Reden').fill('Cursus');
    await modal.getByRole('button', { name: '➕ Toevoegen' }).click();
    await expect.poll(() => puts(verzoeken).length).toBe(1);
    expect(puts(verzoeken)[0].body.exceptions.map(e => [e.date, e.kind, e.reason])).toEqual([['2026-10-13', 'fullday', 'Cursus'], ['2026-10-14', 'fullday', 'Cursus']]);
    // B9: het veld "Van datum" wijzigt enkel het begin van de periode; het venster blijft de geopende dag tonen.
    await expect(modal.locator('#block-date-label')).toHaveText('dinsdag 6 oktober');
    await expect(modal.locator('.av-item')).toHaveCount(0);
    await expect(modal.getByText('Geen blokkeringen voor deze dag.')).toBeVisible();
  });

  test('Van datum leeg bij meerdere werkdagen: "⚠ Kies een datum"', async ({ page, verzoeken }) => {
    const modal = await openBlok(page);
    await modal.locator('#av-multiday').check();
    await modal.locator('#av-date-van').fill('');
    await modal.locator('#av-date-tot').fill('2026-10-14');
    await modal.getByRole('button', { name: '➕ Toevoegen' }).click();
    await expect(page.locator('#toast')).toHaveText('⚠ Kies een datum');
    expect(puts(verzoeken)).toEqual([]);
  });

  test('meerdaags zonder Tot-datum: "⚠ Kies een einddatum, of vink "Meerdere werkdagen" uit"', async ({ page, verzoeken }) => {
    const modal = await openBlok(page);
    await modal.locator('#av-multiday').check();
    await modal.getByRole('button', { name: '➕ Toevoegen' }).click();
    await expect(page.locator('#toast')).toHaveText('⚠ Kies een einddatum, of vink "Meerdere werkdagen" uit');
    expect(puts(verzoeken)).toEqual([]);
  });

  test('een enkele dag na het wijzigen van Van datum blijft op de geopende dag', async ({ page, verzoeken }) => {
    const modal = await openBlok(page);
    await modal.locator('#av-multiday').check();
    await modal.locator('#av-date-van').fill('2026-10-13');
    await modal.locator('#av-multiday').uncheck();
    await modal.getByRole('button', { name: '➕ Toevoegen' }).click();
    await expect.poll(() => puts(verzoeken).length).toBe(1);
    expect(puts(verzoeken)[0].body.exceptions.map(e => e.date)).toEqual(['2026-10-06']);
  });

  test('weigeringen: eindtijd voor begintijd, einddatum voor begindatum en geen werkdagen', async ({ page, verzoeken }) => {
    const modal = await openBlok(page);
    await modal.getByRole('button', { name: '⏱ Tijdvak' }).click();
    await modal.getByLabel('Van (tijd)').fill('12:00');
    await modal.getByLabel('Tot (tijd)').fill('11:00');
    await modal.getByRole('button', { name: '➕ Toevoegen' }).click();
    await expect(page.locator('#toast')).toHaveText('⚠ Eindtijd moet na begintijd liggen');

    await modal.getByRole('button', { name: '🔒 Hele dag' }).click();
    await modal.locator('#av-multiday').check();
    await modal.locator('#av-date-van').fill('2026-10-09');
    await modal.locator('#av-date-tot').fill('2026-10-08');
    await modal.getByRole('button', { name: '➕ Toevoegen' }).click();
    await expect(page.locator('#toast')).toHaveText('⚠ Einddatum moet na startdatum liggen');

    await modal.locator('#av-date-van').fill('2026-10-10');
    await modal.locator('#av-date-tot').fill('2026-10-11');
    await modal.getByRole('button', { name: '➕ Toevoegen' }).click();
    await expect(page.locator('#toast')).toHaveText('⚠ In deze periode zijn er geen werkdagen. Kies andere data.');
    expect(puts(verzoeken)).toEqual([]);
  });

  test('een bestaande blokkade verwijderen (✕ in het venster): één PUT zonder dat id', async ({ page, verzoeken }) => {
    const seed = [
      BLOK({ id: 'e1', date: '2026-10-06', kind: 'range', from: '09:00', to: '10:00', reason: 'Eerste' }),
      BLOK({ id: 'e2', date: '2026-10-06', kind: 'range', from: '13:00', to: '14:00', reason: 'Tweede' }),
    ];
    const modal = await openBlok(page, '2026-10-06', { overschrijf: metSeed(seed, 2) }, '⏱ 2 uitzonderingen');
    await expect(modal.locator('.av-item')).toHaveCount(2);
    await modal.locator('.av-item', { hasText: 'Eerste' }).getByRole('button', { name: 'Blokkering verwijderen' }).click();
    await expect.poll(() => puts(verzoeken).length).toBe(1);
    expect(puts(verzoeken)[0].body).toEqual({ versie: 2, exceptions: [seed[1]] });
    await expect(modal.locator('.av-item')).toHaveCount(1);
    await expect(modal.getByText('— Tweede')).toBeVisible();
  });
});

// ── Voor wie = alle accounts (L1): verkopers staan in de keuzelijst; hun afwezigheid wordt een blok in hun sales-agenda ─────────────────
test.describe('Beheer → Beschikbaarheden: verkopers (L1)', () => {
  const TECHNIEKERS = [
    { id: 'u-t1', email: 't1@test.be', naam: 'Tim Techniek', rol: 'technieker', zohoNaam: 'Tim', actief: true },
    { id: 'u-t2', email: 't2@test.be', naam: 'Roel Techniek', rol: 'technieker', zohoNaam: 'Roel', actief: true },
    { id: 'u-p0', email: 'p0@test.be', naam: 'Plan Zonder Zoho', rol: 'planner', actief: true }, // plant niet: niet in de lijst
  ];
  const VERLOF = (id, datum, omschrijving) => ({ id, datum, start: '00:00', eind: '23:59', soort: 'verlof', ...(omschrijving ? { omschrijving } : {}) });
  const salesPatches = (verzoeken) => verzoeken.van('/api/sales', 'PATCH');

  // De echte sales- en gebruikers-handlers (met in-memory blobs) naast de gewone availability-stub van de tab.
  async function startVerkoperTab(page, { blokken = {}, seed = [], vervangSales } = {}) {
    const blobs = Object.fromEntries(Object.entries(blokken).map(([id, lijst]) => [`sales/${id}`, { versie: 1, leads: [], blokken: lijst, grafstenen: [] }]));
    const backend = maakSalesBackend({ gebruiker: BEHEERDER, verkopers: [...TECHNIEKERS, ...ANDERE_VERKOPERS], blobs });
    const sales = vervangSales ? vervangSales(backend.stubs.sales) : backend.stubs.sales;
    await startApp(page, { overschrijf: { ...backend.stubs, sales, ...metSeed(seed) } });
    return { backend, modal: await openTab(page) };
  }
  const blobVan = (backend, id) => backend.test.get(`sales/${id}`, { type: 'json' });

  test('keuzelijst: Iedereen, daarna groepen Techniek en Sales met de rol achter de naam; hulptekst "Iedereen = alle techniekers"', async ({ page }) => {
    const { modal } = await startVerkoperTab(page);
    const keuze = modal.locator('#bav-filter-person');
    expect(await keuze.locator('option').allInnerTexts()).toEqual(['Iedereen', 'Roel (technieker)', 'Tim (technieker)', 'Bea V. (verkoper)', 'Carl V. (verkoper)']);
    expect(await keuze.locator('optgroup').evaluateAll(g => g.map(x => [x.label, x.querySelectorAll('option').length]))).toEqual([['Techniek', 2], ['Sales', 2]]);
    await expect(modal.locator('#bav-hulp')).toContainText('Iedereen = alle techniekers');
  });

  test('verkoper kiezen en een hele dag toevoegen: PATCH op zijn sales-agenda (hele dag, soort verlof, reden), niets in /api/availability; verschijnt in de lijst', async ({ page, verzoeken }) => {
    const { backend, modal } = await startVerkoperTab(page);
    await modal.locator('#bav-filter-person').selectOption('verkoper:u-bea');
    await expect(modal.locator('.av-empty')).toHaveText('Geen geplande beschikbaarheids-uitzonderingen voor Bea V..');
    await modal.locator('#bav-date').fill('2026-10-07');
    await modal.locator('#bav-reden').fill('Verlof');
    await modal.getByRole('button', { name: '➕ Toevoegen' }).click();
    await expect(lijst(modal)).toHaveCount(1);
    expect(await lijstTekst(modal)).toEqual(['7 okt 2026 · 🔒 Hele dag — Verlof (Bea V.)']);
    const p = salesPatches(verzoeken);
    expect(p).toHaveLength(1);
    expect(p[0].body).toEqual({ versie: 0, blokken: { toevoegen: [{ datum: '2026-10-07', start: '00:00', eind: '23:59', soort: 'verlof', omschrijving: 'Verlof' }] } });
    expect(puts(verzoeken)).toEqual([]);
    // Echt bewaard in het blob van Bea, en alleen daar.
    expect((await blobVan(backend, 'u-bea')).blokken).toMatchObject([{ datum: '2026-10-07', start: '00:00', eind: '23:59', soort: 'verlof', omschrijving: 'Verlof' }]);
    expect(await blobVan(backend, 'u-carl')).toBeNull();
    await expect(modal.locator('#bav-reden')).toHaveValue('');
  });

  test('de afwezigheid van een verkoper is verwijderbaar met ✕ (verwijdert het sales-blok)', async ({ page, verzoeken }) => {
    const { backend, modal } = await startVerkoperTab(page, { blokken: { 'u-bea': [VERLOF('bl1', '2026-10-08', 'Dokter'), VERLOF('bl2', '2026-10-20', 'Blijft')] } });
    await modal.locator('#bav-filter-person').selectOption('verkoper:u-bea');
    await expect.poll(() => lijstTekst(modal)).toEqual(['8 okt 2026 · 🔒 Hele dag — Dokter (Bea V.)', '20 okt 2026 · 🔒 Hele dag — Blijft (Bea V.)']);
    await modal.locator('.av-item', { hasText: 'Dokter' }).getByRole('button', { name: 'Blokkering verwijderen' }).click();
    await expect.poll(() => lijstTekst(modal)).toEqual(['20 okt 2026 · 🔒 Hele dag — Blijft (Bea V.)']);
    expect(salesPatches(verzoeken).map(r => r.body.blokken)).toEqual([{ verwijder: ['bl1'] }]);
    expect((await blobVan(backend, 'u-bea')).blokken.map(b => b.id)).toEqual(['bl2']);
    expect(puts(verzoeken)).toEqual([]);
  });

  test('van een verkoper staan enkel verlofblokken in de lijst: kantoor en afspraak blijven weg (en zijn dus niet te verwijderen)', async ({ page, verzoeken }) => {
    const gewoon = [
      { id: 'k1', datum: '2026-10-08', start: '00:00', eind: '23:59', soort: 'kantoor', omschrijving: 'Kantoordag' },
      { id: 'a1', datum: '2026-10-08', start: '14:00', eind: '15:00', soort: 'afspraak', omschrijving: 'Klantbezoek' },
    ];
    const { backend, modal } = await startVerkoperTab(page, { blokken: { 'u-bea': [VERLOF('bl1', '2026-10-09', 'Dokter'), ...gewoon] } });
    for (const keuze of ['verkoper:u-bea', 'all']) {
      await modal.locator('#bav-filter-person').selectOption(keuze);
      await expect.poll(() => lijstTekst(modal)).toEqual(['9 okt 2026 · 🔒 Hele dag — Dokter (Bea V.)']);
    }
    await modal.locator('.av-item-del').click();
    await expect.poll(() => lijstTekst(modal)).toEqual([]);
    expect(salesPatches(verzoeken).map(r => r.body.blokken)).toEqual([{ verwijder: ['bl1'] }]);
    expect((await blobVan(backend, 'u-bea')).blokken.map(b => b.id)).toEqual(['k1', 'a1']); // de gewone blokken blijven staan
  });

  test('meerdere werkdagen: één blok per werkdag in één PATCH en één gegroepeerde regel; verwijderen haalt alle blokken weg', async ({ page, verzoeken }) => {
    const { modal } = await startVerkoperTab(page);
    await modal.locator('#bav-filter-person').selectOption('verkoper:u-carl');
    await modal.locator('#bav-date').fill('2026-10-09'); // vrijdag
    await modal.locator('#bav-multiday').check();
    await modal.locator('#bav-date-tot').fill('2026-10-13'); // dinsdag
    await modal.locator('#bav-reden').fill('Verlof');
    await modal.getByRole('button', { name: '➕ Toevoegen' }).click();
    await expect.poll(() => lijstTekst(modal)).toEqual(['9 okt 2026 – 13 okt 2026 · 🔒 Hele dag — Verlof (Carl V.)']);
    const p = salesPatches(verzoeken);
    expect(p).toHaveLength(1);
    expect(p[0].body.blokken.toevoegen.map(b => b.datum)).toEqual(['2026-10-09', '2026-10-12', '2026-10-13']); // za en zo overgeslagen
    expect(p[0].body.blokken.toevoegen.every(b => b.start === '00:00' && b.eind === '23:59' && b.soort === 'verlof')).toBe(true);
    await modal.locator('.av-item-del').click();
    await expect.poll(() => lijstTekst(modal)).toEqual([]);
    expect(salesPatches(verzoeken)[1].body.blokken.verwijder).toHaveLength(3);
  });

  test('tijdvak voor een verkoper: blok met van en tot', async ({ page, verzoeken }) => {
    const { modal } = await startVerkoperTab(page);
    await modal.locator('#bav-filter-person').selectOption('verkoper:u-bea');
    await modal.getByRole('button', { name: '⏱ Tijdvak' }).click();
    await modal.locator('#bav-van').fill('13:00');
    await modal.locator('#bav-tot').fill('15:30');
    await modal.getByRole('button', { name: '➕ Toevoegen' }).click();
    await expect.poll(() => lijstTekst(modal)).toEqual(['5 okt 2026 · ⏱ 13:00–15:30 (Bea V.)']);
    expect(salesPatches(verzoeken)[0].body.blokken.toevoegen).toEqual([{ datum: '2026-10-05', start: '13:00', eind: '15:30', soort: 'verlof' }]);
  });

  test('"Iedereen" blijft enkel de techniek-kalender (PUT /api/availability, geen sales-PATCH) maar toont ook de komende afwezigheden van verkopers', async ({ page, verzoeken }) => {
    const seed = [BLOK({ id: 'g1', date: '2026-10-06', reason: 'Teamdag' })];
    const { modal } = await startVerkoperTab(page, { seed, blokken: { 'u-bea': [VERLOF('bl1', '2026-10-08', 'Dokter')] } });
    await expect.poll(() => lijstTekst(modal)).toEqual(['6 okt 2026 · 🔒 Hele dag — Teamdag (Iedereen)', '8 okt 2026 · 🔒 Hele dag — Dokter (Bea V.)']);
    await modal.locator('#bav-date').fill('2026-10-12');
    await modal.getByRole('button', { name: '➕ Toevoegen' }).click();
    await expect.poll(() => puts(verzoeken).length).toBe(1);
    expect(puts(verzoeken)[0].body.exceptions.at(-1)).toMatchObject({ scope: 'global', person: null, date: '2026-10-12' });
    expect(salesPatches(verzoeken)).toEqual([]);
    // Een verkoper-afwezigheid verwijderen vanuit "Iedereen" gaat via zijn sales-agenda.
    await modal.locator('.av-item', { hasText: 'Dokter' }).getByRole('button', { name: 'Blokkering verwijderen' }).click();
    await expect.poll(() => salesPatches(verzoeken).length).toBe(1);
    expect(salesPatches(verzoeken)[0].body.blokken).toEqual({ verwijder: ['bl1'] });
  });

  test('technieker kiezen: ongewijzigd (PUT /api/availability met zijn Zoho-naam), geen verkoperblokken in de lijst', async ({ page, verzoeken }) => {
    const { modal } = await startVerkoperTab(page, { blokken: { 'u-bea': [VERLOF('bl1', '2026-10-08', 'Dokter')] } });
    await modal.locator('#bav-filter-person').selectOption('Tim');
    await expect(modal.locator('.av-empty')).toHaveText('Geen geplande beschikbaarheids-uitzonderingen voor Tim.');
    await modal.locator('#bav-date').fill('2026-10-09');
    await modal.getByRole('button', { name: '➕ Toevoegen' }).click();
    await expect.poll(() => puts(verzoeken).length).toBe(1);
    expect(puts(verzoeken)[0].body.exceptions).toEqual([{ id: expect.any(String), scope: 'person', person: 'Tim', date: '2026-10-09', kind: 'fullday', from: null, to: null, reason: '' }]);
    expect(salesPatches(verzoeken)).toEqual([]);
  });

  test('mislukt opslaan (500): bestaande foutmelding, de lijst blijft ongewijzigd', async ({ page, verzoeken, consoleFouten }) => {
    const { modal } = await startVerkoperTab(page, { vervangSales: (echt) => (req) => (req.methode === 'PATCH' ? { status: 500, json: { error: 'kapot' } } : echt(req)) });
    await modal.locator('#bav-filter-person').selectOption('verkoper:u-bea');
    await modal.locator('#bav-date').fill('2026-10-07');
    await modal.getByRole('button', { name: '➕ Toevoegen' }).click();
    await expect(toastTekst(page)).toHaveText('✕ Opslaan is niet gelukt. Controleer je verbinding en probeer opnieuw.');
    expect(await lijstTekst(modal)).toEqual([]);
    expect(salesPatches(verzoeken)).toHaveLength(1);
    await verwachtFout(consoleFouten, '/api/sales', 500);
  });

  test('planner: ziet enkel de groep Techniek, geen verkopers (ook niet als de server ze zou meesturen) en roept /api/sales nooit aan', async ({ page, verzoeken }) => {
    const lijstMetVerkoper = [...GEBRUIKERS(), { id: 'u-s1', naam: 'Bea Verkoper', rol: 'sales', salesNaam: 'Bea V.', actief: true }];
    await startApp(page, { loginRol: 'planner', overschrijf: { gebruikers: gebruikersStub(lijstMetVerkoper) } });
    const paneel = await openTab(page);
    expect(await paneel.locator('#bav-filter-person option').allInnerTexts()).toEqual(['Iedereen', 'Roel (technieker)', 'Tim (technieker)']);
    await expect(paneel.locator('#bav-filter-person optgroup')).toHaveCount(1);
    await expect(paneel.locator('#bav-hulp')).toHaveText('Iedereen = alle techniekers.');
    expect(verzoeken.van('/api/sales')).toEqual([]);
  });
});
