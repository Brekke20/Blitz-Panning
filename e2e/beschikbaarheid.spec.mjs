import { test, expect, startApp, opslagStub } from './helpers.mjs';

// Etappe 5b, taak 1: karakterisering van de blokkeringen (beschikbaarheid) buiten wat al gedekt is.
// Bestaand (niet dupliceren): hele dag en tijdvak vanuit de kalender, de payloads van PUT /api/availability
// en de persoonsfilter in de kalender (voorstel-afspraak-blokkering.spec.mjs), Escape en achtergrondklik
// (vensters.spec.mjs), 409 bij afspraken (conflict-409.spec.mjs). Hier: de tab "Beschikbaarheden" van het
// instellingenvenster (renderBeschikbaarhedenTab, groupExceptionsForDisplay, nextWorkday) en de keuzeknoppen
// van het blokkeringsvenster (avSetKind, avSetScope, datumvelden). Testklok: maandag 5 okt 2026.

const BLOK = (o) => ({ id: 'x', scope: 'global', person: null, kind: 'fullday', from: null, to: null, reason: '', ...o });

async function openTab(page) {
  await page.getByRole('button', { name: 'Instellingen', exact: true }).click();
  const modal = page.getByRole('dialog', { name: '⚙️ Instellingen' });
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: 'Beschikbaarheden', exact: true }).click();
  await expect(modal.locator('#set-tab-beschikbaarheden')).toBeVisible();
  return modal;
}
const lijst = (modal) => modal.locator('#set-tab-beschikbaarheden .av-existing .av-item .av-item-label');
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

test.describe('instellingen: tab Beschikbaarheden', () => {
  test('lege staat, standaarddatum is vandaag en nextWorkday is geen standaard-einddatum', async ({ page }) => {
    await startApp(page);
    const modal = await openTab(page);
    await expect(modal.locator('#set-tab-beschikbaarheden .av-empty')).toHaveText('Geen geplande beschikbaarheids-uitzonderingen.');
    await expect(modal.locator('#bav-date')).toHaveValue('2026-10-05');
    await expect(modal.locator('#bav-filter-person')).toHaveValue('all');
    // Enkel "Iedereen" (uitgeschakeld) zolang er geen persoon gekozen is.
    const scope = modal.locator('#set-tab-beschikbaarheden .av-radio-group').nth(1).getByRole('button');
    await expect(scope).toHaveCount(1);
    await expect(scope).toHaveText('👥 Iedereen');
    await expect(scope).toBeDisabled();
    // Meerdere werkdagen: het einddatumveld verschijnt leeg (HUIDIG GEDRAG: geen volgende werkdag als standaard).
    await modal.locator('#bav-multiday').check();
    await expect(modal.locator('#bav-date-tot')).toBeVisible();
    await expect(modal.locator('#bav-date-tot')).toHaveValue('');
    // Opslaan-knop van het algemene tabblad is hier verborgen.
    await expect(modal.locator('#set-save-btn')).toBeHidden();
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

  test('meerdaags aangevinkt zonder einddatum: HUIDIG GEDRAG (bug?) er wordt één enkele dag toegevoegd', async ({ page, verzoeken }) => {
    await startApp(page);
    const modal = await openTab(page);
    await modal.locator('#bav-date').fill('2026-10-08');
    await modal.locator('#bav-multiday').check();
    await modal.getByRole('button', { name: '➕ Toevoegen' }).click();
    await expect(lijst(modal)).toHaveCount(1);
    expect(await lijstTekst(modal)).toEqual(['8 okt 2026 · 🔒 Hele dag (Iedereen)']);
    expect(puts(verzoeken)[0].body.exceptions.map(e => e.date)).toEqual(['2026-10-08']);
  });

  test('lege datum: HUIDIG GEDRAG (bug?) geen validatie, een blokkade met datum "" wordt bewaard (en niet getoond)', async ({ page, verzoeken }) => {
    await startApp(page);
    const modal = await openTab(page);
    await modal.locator('#bav-date').fill('');
    await modal.getByRole('button', { name: '➕ Toevoegen' }).click();
    await expect.poll(() => puts(verzoeken).length).toBe(1);
    expect(puts(verzoeken)[0].body.exceptions.map(e => e.date)).toEqual(['']);
    // Een verleden of lege datum valt buiten het filter `datum >= vandaag`: de lijst blijft leeg.
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
    // De keuzelijst: alle personen, plus wie een ticket of blokkade heeft (Roel, Tim).
    expect(await modal.locator('#bav-filter-person option').allInnerTexts()).toEqual(['Alle personen', 'Roel', 'Tim']);

    await modal.locator('#bav-filter-person').selectOption('Tim');
    expect(await lijstTekst(modal)).toEqual([
      '6 okt 2026 · 🔒 Hele dag — Bedrijfsuitstap (Iedereen)',
      '7 okt 2026 · 🔒 Hele dag — Verlof (Tim)',
    ]);
    await expect(modal.locator('#bav-filter-person')).toHaveValue('Tim');
    // Het formulier staat nu op "👤 Tim" (aria-pressed) met "👥 Iedereen" als alternatief.
    await expect(modal.getByRole('button', { name: '👤 Tim' })).toHaveAttribute('aria-pressed', 'true');
    await expect(modal.getByRole('button', { name: '👥 Iedereen' })).toHaveAttribute('aria-pressed', 'false');
    await modal.locator('#bav-date').fill('2026-10-09');
    await modal.getByRole('button', { name: '➕ Toevoegen' }).click();
    await expect.poll(() => puts(verzoeken).length).toBe(1);
    expect(puts(verzoeken)[0].body.exceptions.at(-1)).toEqual({ id: expect.any(String), scope: 'person', person: 'Tim', date: '2026-10-09', kind: 'fullday', from: null, to: null, reason: '' });
    expect(await lijstTekst(modal)).toContain('9 okt 2026 · 🔒 Hele dag (Tim)');

    // "Iedereen" kiezen: de nieuwe blokkade is algemeen, ook al staat de filter op Tim.
    await modal.getByRole('button', { name: '👥 Iedereen' }).click();
    await expect(modal.getByRole('button', { name: '👥 Iedereen' })).toHaveAttribute('aria-pressed', 'true');
    await modal.locator('#bav-date').fill('2026-10-13');
    await modal.getByRole('button', { name: '➕ Toevoegen' }).click();
    await expect.poll(() => puts(verzoeken).length).toBe(2);
    expect(puts(verzoeken)[1].body.exceptions.at(-1)).toMatchObject({ scope: 'global', person: null, date: '2026-10-13' });

    // Een andere persoon: zijn blokkades plus de algemene. Terug naar "Alle personen" zet het formulier op iedereen.
    await modal.locator('#bav-filter-person').selectOption('Roel');
    expect(await lijstTekst(modal)).toEqual([
      '6 okt 2026 · 🔒 Hele dag — Bedrijfsuitstap (Iedereen)',
      '8 okt 2026 · 🔒 Hele dag — Tandarts (Roel)',
      '13 okt 2026 · 🔒 Hele dag (Iedereen)',
    ]);
    await modal.locator('#bav-filter-person').selectOption('all');
    await expect(modal.getByRole('button', { name: '👥 Iedereen' })).toBeDisabled();
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
    await expect(modal.locator('#set-tab-beschikbaarheden .av-empty')).toHaveText('Geen geplande beschikbaarheids-uitzonderingen voor Tim.');
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
    await modal.getByRole('button', { name: 'Annuleren' }).click();
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await expect(page.locator('.day-col[data-date="2026-10-07"]').getByText('🔒 Geblokkeerd')).toHaveCount(0);
  });

  test('een blokkade uit de tab is meteen zichtbaar in de kalender (dag geblokkeerd)', async ({ page }) => {
    await startApp(page);
    const modal = await openTab(page);
    await modal.locator('#bav-date').fill('2026-10-07');
    await modal.getByRole('button', { name: '➕ Toevoegen' }).click();
    await expect(lijst(modal)).toHaveCount(1);
    await modal.getByRole('button', { name: 'Annuleren' }).click();
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
    // HUIDIG GEDRAG (bug?): het datumveld wijzigt ook de dag die het venster toont (_avFormDate): de lijst toont nu 13 okt,
    // terwijl de titel nog "dinsdag 6 oktober" zegt.
    await expect(modal.locator('#block-date-label')).toHaveText('dinsdag 6 oktober');
    await expect(modal.locator('.av-item')).toHaveCount(1);
    await expect(modal.locator('.av-item')).toContainText('🔒 Hele dag — Cursus (Iedereen)');
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
