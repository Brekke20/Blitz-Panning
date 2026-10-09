import { test, expect, startApp, opslagStub } from './helpers.mjs';

// Etappe 5b, taak 1: karakterisering van de eigen afspraken (formulier, detailvenster, import) buiten wat al gedekt is.
// Bestaand (niet dupliceren): toevoegen met de basisvelden (voorstel-afspraak-blokkering.spec.mjs) en alle 409-gevallen
// (conflict-409.spec.mjs). Hier: het volledige formulier, bewerken, verwijderen, het detailvenster, de import met
// persoonmatching (matchRespToPerson) en de weigeringen. Testklok: maandag 5 okt 2026.

const FULL = {
  id: 'ev-full', titel: 'Installatie Pietersen', datum: '2026-10-06', uur: '10:00', einduur: '12:00', type: 'Installatie', persoon: 'Tim',
  adres: 'Kerkstraat 5, 9000 Gent', notitie: 'Sleutel bij de buren', telefoon: '+32 470 12 34 56', email: 'p@x.be', bron: 'manueel', origResp: null,
};
const ENKEL_NOTITIE = {
  id: 'ev-nota', titel: 'Alleen notitie', datum: '2026-10-07', uur: '09:00', einduur: '', type: 'Overige', persoon: null,
  adres: '', notitie: 'Sleutel op kantoor', telefoon: '', email: '', bron: 'manueel', origResp: null,
};
const LEEG = {
  id: 'ev-leeg', titel: 'Zonder gegevens', datum: '2026-10-08', uur: '08:00', einduur: '', type: 'Service', persoon: null,
  adres: '', notitie: '', telefoon: '', email: '', bron: 'manueel', origResp: null,
};
const metSeed = (afspraken, versie = 2) => ({ afspraken: opslagStub({ versie, afspraken }, 'afspraken') });
const puts = (verzoeken) => verzoeken.van('/api/afspraken', 'PUT');
const toastTekst = (page) => page.locator('#toast');
const manueel = (page) => page.locator('#manueel-overlay');
const detail = (page) => page.locator('#local-det-overlay');
const kaart = (page, datum, titel) => page.locator(`.day-col[data-date="${datum}"] .cal-local-event`, { hasText: titel });

async function naarKalender(page) {
  await page.getByRole('tab', { name: 'Kalender' }).click();
  await expect(page.locator('.day-col[data-date="2026-10-05"]')).toBeVisible();
}
async function openFormulier(page) {
  await page.getByRole('button', { name: '➕ Afspraak' }).click();
  await expect(manueel(page)).toHaveClass(/open/);
}
async function openDetail(page, datum, titel) {
  await kaart(page, datum, titel).click();
  await expect(detail(page)).toHaveClass(/open/);
}

test.describe('afspraken: formulier', () => {
  test('beginwaarden: type Service, 09:00-11:00 en de actieve technieker voorgeselecteerd', async ({ page }) => {
    await startApp(page, { technieker: 'Tim' });
    await naarKalender(page);
    await openFormulier(page);
    await expect(page.locator('#manueel-modal-title')).toHaveText('➕ Afspraak toevoegen');
    await expect(manueel(page).locator('#man-type')).toHaveValue('Service');
    await expect(manueel(page).locator('#man-van')).toHaveValue('09:00');
    await expect(manueel(page).locator('#man-tot')).toHaveValue('11:00');
    await expect(manueel(page).locator('#man-datum')).toHaveValue('');
    await expect(manueel(page).locator('#man-persoon')).toHaveValue('Tim');
    expect(await manueel(page).locator('#man-persoon option').allInnerTexts()).toEqual(['— Geen —', 'Roel', 'Tim']);
  });

  test('alle velden: exact de PUT-body en de kaart in de kalender', async ({ page, verzoeken }) => {
    await startApp(page);
    await naarKalender(page);
    await openFormulier(page);

    await manueel(page).locator('#man-titel').fill('  Installatie Janssens  ');
    await manueel(page).locator('#man-datum').fill('2026-10-08');
    await manueel(page).locator('#man-type').selectOption('Installatie');
    await manueel(page).locator('#man-van').fill('13:00');
    await manueel(page).locator('#man-tot').fill('15:30');
    await manueel(page).locator('#man-persoon').selectOption('Roel');
    await manueel(page).locator('#man-adres').fill(' Dorpsstraat 1, 2000 Antwerpen ');
    await manueel(page).locator('#man-telefoon').fill('0470 11 22 33');
    await manueel(page).locator('#man-email').fill('janssens@test.be');
    await manueel(page).locator('#man-notitie').fill('Poort code 1234');
    await manueel(page).getByRole('button', { name: 'Opslaan' }).click();

    await expect(toastTekst(page)).toHaveText('✓ Afspraak opgeslagen');
    await expect(manueel(page)).not.toHaveClass(/open/);
    expect(puts(verzoeken)).toHaveLength(1);
    expect(puts(verzoeken)[0].body).toEqual({
      versie: 0,
      afspraken: [{
        id: expect.any(String), titel: 'Installatie Janssens', datum: '2026-10-08', uur: '13:00', einduur: '15:30', type: 'Installatie', persoon: 'Roel',
        adres: 'Dorpsstraat 1, 2000 Antwerpen', telefoon: '0470 11 22 33', email: 'janssens@test.be', notitie: 'Poort code 1234', bron: 'manueel', origResp: null,
      }],
    });
    const k = kaart(page, '2026-10-08', 'Installatie Janssens');
    await expect(k).toHaveCount(1);
    await expect(k.locator('.cal-local-type')).toHaveText('Installatie');
    await expect(k.locator('.cal-local-time')).toHaveText('⏱ 13:00–15:30');
    await expect(k.locator('.cal-addr')).toHaveText('Dorpsstraat 1, 2000 Antwerpen');
    await expect(k.locator('.cal-meta')).toHaveText('Roel');
    // Het formulier is leeggemaakt voor de volgende keer (tekstvelden), type en tijden blijven.
    await openFormulier(page);
    for (const id of ['man-titel', 'man-adres', 'man-telefoon', 'man-email', 'man-notitie']) await expect(manueel(page).locator('#' + id)).toHaveValue('');
  });

  test('zonder einduur en zonder technieker: einduur "" en persoon null; de kaart toont enkel het beginuur', async ({ page, verzoeken }) => {
    await startApp(page);
    await naarKalender(page);
    await openFormulier(page);
    await expect(manueel(page).locator('#man-persoon')).toHaveValue(''); // Iedereen: geen technieker voorgeselecteerd
    await manueel(page).locator('#man-titel').fill('Korte afspraak');
    await manueel(page).locator('#man-datum').fill('2026-10-06');
    await manueel(page).locator('#man-tot').fill('');
    await manueel(page).getByRole('button', { name: 'Opslaan' }).click();
    await expect(toastTekst(page)).toHaveText('✓ Afspraak opgeslagen');
    expect(puts(verzoeken)[0].body.afspraken).toEqual([{
      id: expect.any(String), titel: 'Korte afspraak', datum: '2026-10-06', uur: '09:00', einduur: '', type: 'Service', persoon: null,
      adres: '', telefoon: '', email: '', notitie: '', bron: 'manueel', origResp: null,
    }]);
    await expect(kaart(page, '2026-10-06', 'Korte afspraak').locator('.cal-local-time')).toHaveText('⏱ 09:00');
  });

  test('titel en datum zijn verplicht: toast, het venster blijft open en er is geen verzoek', async ({ page, verzoeken }) => {
    await startApp(page);
    await naarKalender(page);
    await openFormulier(page);
    await manueel(page).getByRole('button', { name: 'Opslaan' }).click();
    await expect(toastTekst(page)).toHaveText('⚠ Voer een titel in');
    await expect(manueel(page)).toHaveClass(/open/);
    await manueel(page).locator('#man-titel').fill('Enkel een titel');
    await manueel(page).getByRole('button', { name: 'Opslaan' }).click();
    await expect(toastTekst(page)).toHaveText('⚠ Kies een datum');
    await expect(manueel(page)).toHaveClass(/open/);
    await expect(manueel(page).locator('#man-titel')).toHaveValue('Enkel een titel'); // niets gewist
    expect(puts(verzoeken)).toEqual([]);
    // Annuleren sluit zonder verzoek.
    await manueel(page).getByRole('button', { name: 'Annuleren' }).click();
    await expect(manueel(page)).not.toHaveClass(/open/);
    expect(puts(verzoeken)).toEqual([]);
  });

  test('een geslaagde opslag toont de kaart enkel op de gekozen dag', async ({ page }) => {
    await startApp(page);
    await naarKalender(page);
    await openFormulier(page);
    await manueel(page).locator('#man-titel').fill('Dagcontrole');
    await manueel(page).locator('#man-datum').fill('2026-10-09');
    await manueel(page).getByRole('button', { name: 'Opslaan' }).click();
    await expect(kaart(page, '2026-10-09', 'Dagcontrole')).toHaveCount(1);
    await expect(page.locator('.cal-local-event', { hasText: 'Dagcontrole' })).toHaveCount(1);
  });
});

test.describe('afspraken: detailvenster, bewerken en verwijderen', () => {
  test('detail: type, titel, datum en tijd, adres, telefoon, e-mail, notitie en technieker; de knoppen', async ({ page }) => {
    await startApp(page, { overschrijf: metSeed([FULL]) });
    await naarKalender(page);
    await openDetail(page, '2026-10-06', 'Installatie Pietersen');
    const d = page.getByRole('dialog', { name: 'Installatie Pietersen' });
    await expect(d.locator('#ld-type')).toHaveText('Installatie');
    await expect(d.locator('#ld-titel')).toHaveText('Installatie Pietersen');
    await expect(d.locator('#ld-datum')).toHaveText('di 6 okt 2026 · 10:00–12:00');
    const rij = (label) => d.locator('.mrow', { hasText: label });
    await expect(rij('Adres')).toContainText('Kerkstraat 5, 9000 Gent ↗');
    await expect(rij('Telefoon').locator('a')).toHaveAttribute('href', 'tel:+32470123456');
    await expect(rij('Telefoon')).toContainText('+32 470 12 34 56');
    await expect(rij('E-mail').locator('a')).toHaveAttribute('href', 'mailto:p@x.be');
    await expect(rij('Notitie')).toContainText('Sleutel bij de buren');
    await expect(rij('Technieker')).toContainText('Tim');
    for (const naam of ["📷 Foto's", '⏱️ Aankomst', '📋 Rapport', '✏️ Bewerken', '🗑 Verwijderen']) {
      await expect(d.getByRole('button', { name: naam })).toBeVisible();
    }
    await d.getByRole('button', { name: 'Sluiten' }).click();
    await expect(detail(page)).not.toHaveClass(/open/);
  });

  test('een handmatige afspraak zonder adres toont de notitie als Notitie, niet als adres', async ({ page }) => {
    await startApp(page, { overschrijf: metSeed([ENKEL_NOTITIE]) });
    await naarKalender(page);
    await openDetail(page, '2026-10-07', 'Alleen notitie');
    await expect(detail(page).locator('#ld-datum')).toHaveText('wo 7 okt 2026 · 09:00'); // zonder einduur
    await expect(detail(page).locator('.mrow', { hasText: 'Adres' })).toHaveCount(0);
    await expect(detail(page).locator('.mrow', { hasText: 'Notitie' })).toContainText('Sleutel op kantoor');
    await expect(detail(page).locator('.mval-nav-link')).toHaveCount(0);
    await expect(detail(page).locator('.mrow', { hasText: 'Telefoon' })).toHaveCount(0);
    // De kaart: geen adresregel en geen navigeerknop, wel de notitieregel.
    const k = kaart(page, '2026-10-07', 'Alleen notitie');
    await expect(k.locator('.cal-addr')).toHaveCount(0);
    await expect(k.locator('.cal-meta', { hasText: '📝 Sleutel op kantoor' })).toHaveCount(1);
    await expect(k.getByRole('button', { name: '🧭 Navigeer' })).toHaveCount(0);
  });

  test('een geïmporteerde afspraak (bron "import") met enkel een notitie toont die nog steeds als adres met navigatielink', async ({ page }) => {
    const IMPORT = { ...ENKEL_NOTITIE, id: 'ev-imp', titel: 'Import zonder adres', bron: 'import', notitie: 'Dorpsstraat 1, 2000 Antwerpen' };
    await startApp(page, { overschrijf: metSeed([IMPORT]) });
    await naarKalender(page);
    await openDetail(page, '2026-10-07', 'Import zonder adres');
    await expect(detail(page).locator('.mrow', { hasText: 'Adres' })).toContainText('Dorpsstraat 1, 2000 Antwerpen ↗');
    await expect(detail(page).locator('.mrow', { hasText: 'Notitie' })).toHaveCount(0);
    await expect(kaart(page, '2026-10-07', 'Import zonder adres').locator('.cal-addr')).toHaveText('Dorpsstraat 1, 2000 Antwerpen');
  });

  test('zonder contactgegevens: de melding "Geen contactgegevens beschikbaar"; geen tijd in de kop', async ({ page }) => {
    await startApp(page, { overschrijf: metSeed([LEEG]) });
    await naarKalender(page);
    await openDetail(page, '2026-10-08', 'Zonder gegevens');
    await expect(detail(page).locator('#ld-body')).toHaveText('Geen contactgegevens beschikbaar');
    await expect(detail(page).locator('#ld-datum')).toHaveText('do 8 okt 2026 · 08:00');
  });

  test('een afspraak zonder uur staat als chip "Zonder uur:" in de dagkop; een klik opent het detail', async ({ page }) => {
    await startApp(page, { overschrijf: metSeed([{ ...LEEG, id: 'ev-zonder-uur', titel: 'Zonder uur', uur: '' }]) });
    await naarKalender(page);
    const kop = page.locator('.day-col[data-date="2026-10-08"] .day-hdr-zonderuur');
    await expect(kop.locator('.zu-label')).toHaveText('Zonder uur:');
    await expect(kop.locator('.zu-chip')).toHaveText(['Zonder uur']);
    await expect(kop.locator('.zu-chip')).toHaveAttribute('title', 'Service: Zonder uur');
    // Nog steeds geen blok op de tijdlijn.
    await expect(page.locator('.cal-local-event')).toHaveCount(0);
    await kop.locator('.zu-chip').click();
    await expect(detail(page)).toHaveClass(/open/);
    await expect(detail(page).locator('#ld-titel')).toHaveText('Zonder uur');
  });

  test('knop Foto\'s: opent het fotovenster en vraagt de foto\'s op met het afspraak-id als ticketId', async ({ page, verzoeken }) => {
    const opgevraagd = [];
    const fotos = ({ query }) => { opgevraagd.push(query.get('ticketId')); return { status: 200, json: { versie: 0, fotos: [] } }; };
    await startApp(page, { overschrijf: { ...metSeed([FULL]), fotos } });
    await naarKalender(page);
    await openDetail(page, '2026-10-06', 'Installatie Pietersen');
    await detail(page).getByRole('button', { name: "📷 Foto's" }).click();
    await expect(page.locator('#foto-overlay')).toHaveClass(/open/);
    await expect(page.locator('#foto-grid')).toHaveText("Nog geen foto's toegevoegd.");
    expect(verzoeken.van('/api/fotos', 'GET')).toHaveLength(1);
    expect(opgevraagd).toEqual(['ev-full']);
  });

  test('knop Aankomst: bewaart het uur onder de sleutel "<datum>__<afspraak-id>" in blitz_arrivals en toont het uur', async ({ page }) => {
    await startApp(page, { overschrijf: metSeed([FULL]) });
    await page.clock.setFixedTime(new Date('2026-10-05T09:07:00+02:00'));
    await naarKalender(page);
    await openDetail(page, '2026-10-06', 'Installatie Pietersen');
    expect(await page.evaluate(() => localStorage.getItem('blitz_arrivals'))).toBeNull();
    await detail(page).getByRole('button', { name: '⏱️ Aankomst' }).click();
    await expect(toastTekst(page)).toHaveText('⏱ Aankomst geregistreerd: 09:07');
    expect(await page.evaluate(() => localStorage.getItem('blitz_arrivals'))).toBe('{"2026-10-06__ev-full":"09:07"}');
  });

  test('knop Rapport: sluit het detail en opent de wizard (enkel openen)', async ({ page, verzoeken }) => {
    await startApp(page, { overschrijf: metSeed([FULL]) });
    await naarKalender(page);
    await openDetail(page, '2026-10-06', 'Installatie Pietersen');
    // De wizard laadt de foto's van de afspraak: de ticketId in dat verzoek is het id van de afspraak.
    const fotoVerzoek = page.waitForRequest(r => r.url().includes('/api/fotos?ticketId=ev-full'));
    await detail(page).getByRole('button', { name: '📋 Rapport' }).click();
    await fotoVerzoek;
    await expect(page.getByRole('dialog', { name: '📋 Service Rapport' })).toHaveClass(/open/);
    await expect(detail(page)).not.toHaveClass(/open/);
    expect(verzoeken.verboden).toEqual([]);
  });

  test('bewerken: het formulier is ingevuld en de wijziging gaat als vervanging op id in de PUT', async ({ page, verzoeken }) => {
    await startApp(page, { overschrijf: metSeed([FULL, ENKEL_NOTITIE], 7) });
    await naarKalender(page);
    await openDetail(page, '2026-10-06', 'Installatie Pietersen');
    await detail(page).getByRole('button', { name: '✏️ Bewerken' }).click();
    await expect(detail(page)).not.toHaveClass(/open/); // het detail sluit, het formulier blijft open
    await expect(manueel(page)).toHaveClass(/open/);
    await expect(page.locator('#manueel-modal-title')).toHaveText('✏️ Afspraak bewerken');
    const m = manueel(page);
    await expect(m.locator('#man-titel')).toHaveValue('Installatie Pietersen');
    await expect(m.locator('#man-datum')).toHaveValue('2026-10-06');
    await expect(m.locator('#man-type')).toHaveValue('Installatie');
    await expect(m.locator('#man-van')).toHaveValue('10:00');
    await expect(m.locator('#man-tot')).toHaveValue('12:00');
    await expect(m.locator('#man-persoon')).toHaveValue('Tim');
    await expect(m.locator('#man-adres')).toHaveValue('Kerkstraat 5, 9000 Gent');
    await expect(m.locator('#man-telefoon')).toHaveValue('+32 470 12 34 56');
    await expect(m.locator('#man-email')).toHaveValue('p@x.be');
    await expect(m.locator('#man-notitie')).toHaveValue('Sleutel bij de buren');

    await m.locator('#man-titel').fill('Installatie Pietersen (verzet)');
    await m.locator('#man-datum').fill('2026-10-09');
    await m.locator('#man-tot').fill('');
    await m.locator('#man-persoon').selectOption('');
    await m.getByRole('button', { name: 'Opslaan' }).click();
    await expect(toastTekst(page)).toHaveText('✓ Afspraak bijgewerkt');
    expect(puts(verzoeken)).toHaveLength(1);
    expect(puts(verzoeken)[0].body).toEqual({
      versie: 7,
      afspraken: [
        { ...FULL, titel: 'Installatie Pietersen (verzet)', datum: '2026-10-09', einduur: '', persoon: null }, // zelfde plaats in de lijst, zelfde id
        ENKEL_NOTITIE,
      ],
    });
    await expect(kaart(page, '2026-10-06', 'Installatie Pietersen')).toHaveCount(0);
    await expect(kaart(page, '2026-10-09', 'Installatie Pietersen (verzet)')).toHaveCount(1);
    // Na het bewerken staat het formulier weer in "toevoegen"-modus.
    await openFormulier(page);
    await expect(page.locator('#manueel-modal-title')).toHaveText('➕ Afspraak toevoegen');
    await expect(manueel(page).locator('#man-titel')).toHaveValue('');
  });

  test('bewerken: titel leegmaken wordt geweigerd (toast) en annuleren laat de afspraak ongemoeid', async ({ page, verzoeken }) => {
    await startApp(page, { overschrijf: metSeed([FULL]) });
    await naarKalender(page);
    await openDetail(page, '2026-10-06', 'Installatie Pietersen');
    await detail(page).getByRole('button', { name: '✏️ Bewerken' }).click();
    await manueel(page).locator('#man-titel').fill('');
    await manueel(page).getByRole('button', { name: 'Opslaan' }).click();
    await expect(toastTekst(page)).toHaveText('⚠ Voer een titel in');
    await manueel(page).getByRole('button', { name: 'Annuleren' }).click();
    expect(puts(verzoeken)).toEqual([]);
    await expect(kaart(page, '2026-10-06', 'Installatie Pietersen')).toHaveCount(1);
  });

  test('verwijderen via het detail: confirm; weigeren laat alles staan, accepteren stuurt een PUT zonder dat id', async ({ page, verzoeken }) => {
    await startApp(page, { overschrijf: metSeed([FULL, ENKEL_NOTITIE], 4) });
    await naarKalender(page);
    await openDetail(page, '2026-10-06', 'Installatie Pietersen');
    const berichten = [];
    page.once('dialog', (dlg) => { berichten.push(dlg.message()); dlg.dismiss(); });
    await detail(page).getByRole('button', { name: '🗑 Verwijderen' }).click();
    await expect.poll(() => berichten.length).toBe(1);
    expect(berichten[0]).toBe('🗑 "Installatie Pietersen" verwijderen (di 6 okt 2026)?');
    await expect(detail(page)).toHaveClass(/open/); // geweigerd: het detail blijft
    expect(puts(verzoeken)).toEqual([]);

    page.once('dialog', (dlg) => dlg.accept());
    await detail(page).getByRole('button', { name: '🗑 Verwijderen' }).click();
    await expect(detail(page)).not.toHaveClass(/open/);
    await expect.poll(() => puts(verzoeken).length).toBe(1);
    expect(puts(verzoeken)[0].body).toEqual({ versie: 4, afspraken: [ENKEL_NOTITIE] });
    await expect(kaart(page, '2026-10-06', 'Installatie Pietersen')).toHaveCount(0);
    await expect(kaart(page, '2026-10-07', 'Alleen notitie')).toHaveCount(1);
  });

  test('✕ op de kaart: verwijdert meteen zonder confirm (PUT zonder dat id)', async ({ page, verzoeken }) => {
    await startApp(page, { overschrijf: metSeed([FULL, ENKEL_NOTITIE], 4) });
    await naarKalender(page);
    page.on('dialog', () => { throw new Error('geen dialoog verwacht'); });
    await kaart(page, '2026-10-07', 'Alleen notitie').getByRole('button', { name: 'Afspraak verwijderen' }).click();
    await expect.poll(() => puts(verzoeken).length).toBe(1);
    expect(puts(verzoeken)[0].body).toEqual({ versie: 4, afspraken: [FULL] });
    await expect(kaart(page, '2026-10-07', 'Alleen notitie')).toHaveCount(0);
    await expect(detail(page)).not.toHaveClass(/open/); // de klik opent het detail niet
  });
});

test.describe('afspraken: import', () => {
  const bestand = (inhoud) => ({ name: 'afspraken.json', mimeType: 'application/json', buffer: Buffer.from(typeof inhoud === 'string' ? inhoud : JSON.stringify(inhoud)) });
  const importeer = async (page, inhoud) => { await page.locator('#import-file-input').setInputFiles(bestand(inhoud)); };
  const overlay = (page) => page.locator('#import-overlay');
  const rij = (page, i) => page.locator('#import-list .imp-item').nth(i);

  const BRON = [
    { titel: 'Installatie A', datum: '2026-10-08', uur: '09:00', einduur: '11:00', type: 'Installatie', resp: 'Tim', notitie: 'Poort open', telefoon: '0470 00 00 01', email: 'a@x.be' },
    { titel: 'Installatie B', datum: '2026-10-09', uur: '14:00', resp: 'tim vermeulen' },
    { titel: 'Installatie C', datum: '2026-10-12', uur: '08:00', resp: 'ROEL' },
    { titel: 'Installatie D', datum: '2026-10-13', uur: '10:00', resp: 'Onbekende' },
    { type: 'Installatie', linkLabel: 'Pietersen', datum: '2026-10-14', uur: '11:00' },
    { titel: 'Zonder datum', uur: '12:00', resp: 'Tim' },
  ];

  test('bestand kiezen: reviewvenster met titel, datum en match per rij; de persoonmatching', async ({ page, verzoeken }) => {
    await startApp(page);
    await naarKalender(page);
    await importeer(page, BRON);
    await expect(overlay(page)).toHaveClass(/open/);
    await expect(page.locator('#import-subtitle')).toHaveText('6 afspraken · 2 onbekende technicus');
    await expect(page.locator('#import-list .imp-item')).toHaveCount(6);
    const titels = await page.locator('#import-list .imp-item-title').allInnerTexts();
    expect(titels).toEqual(['Installatie A', 'Installatie B', 'Installatie C', 'Installatie D', 'Installatie: Pietersen', 'Zonder datum']);
    // Metaregel: datum, tijd en notitie.
    await expect(rij(page, 0).locator('.imp-item-meta')).toHaveText('do 8 okt · 09:00–11:00 · Poort open');
    await expect(rij(page, 1).locator('.imp-item-meta')).toHaveText('vr 9 okt · 14:00');
    await expect(rij(page, 5).locator('.imp-item-meta')).toHaveText('? · 12:00');
    // matchRespToPerson: exact, deels (naam bevat voornaam), hoofdletters, onbekend en zonder resp.
    const select = (i) => rij(page, i).locator('select.imp-person-sel');
    const tag = (i) => rij(page, i).locator('.imp-match-tag');
    expect(await select(0).inputValue()).toBe('Tim');
    expect(await select(1).inputValue()).toBe('Tim');
    expect(await select(2).inputValue()).toBe('Roel');
    expect(await select(3).inputValue()).toBe('');
    expect(await select(4).inputValue()).toBe('');
    expect(await select(5).inputValue()).toBe('Tim');
    await expect(tag(0)).toHaveText('✓ Match');
    await expect(tag(3)).toHaveText('⚠ Handmatig');
    expect(await select(0).locator('option').allInnerTexts()).toEqual(['— Niet toewijzen —', 'Roel', 'Tim']);
    // Nog niets bewaard.
    expect(puts(verzoeken)).toEqual([]);
  });

  test('bevestigen: de select-keuze telt, rijen zonder datum vallen af en de PUT bevat de geïmporteerde lijst exact', async ({ page, verzoeken }) => {
    const bestaand = { ...FULL, id: 'bestaand' };
    await startApp(page, { overschrijf: metSeed([bestaand], 3) });
    await naarKalender(page);
    await importeer(page, { afspraken: BRON });
    await expect(overlay(page)).toHaveClass(/open/);
    await rij(page, 3).locator('select').selectOption('Roel'); // handmatig toewijzen (onchange)
    await rij(page, 0).locator('select').selectOption(''); // en een match weer wegnemen
    await overlay(page).getByRole('button', { name: '✓ Importeren' }).click();
    await expect(toastTekst(page)).toHaveText('✓ 5 afspraken geïmporteerd');
    await expect(overlay(page)).not.toHaveClass(/open/);
    expect(puts(verzoeken)).toHaveLength(1);
    const basis = { einduur: '', type: 'Overige', notitie: '', telefoon: '', email: '', bron: 'import' };
    expect(puts(verzoeken)[0].body).toEqual({
      versie: 3,
      afspraken: [
        bestaand,
        { ...basis, id: expect.any(String), titel: 'Installatie A', datum: '2026-10-08', uur: '09:00', einduur: '11:00', type: 'Installatie', persoon: null, notitie: 'Poort open', telefoon: '0470 00 00 01', email: 'a@x.be', origResp: 'Tim' },
        { ...basis, id: expect.any(String), titel: 'Installatie B', datum: '2026-10-09', uur: '14:00', persoon: 'Tim', origResp: 'tim vermeulen' },
        { ...basis, id: expect.any(String), titel: 'Installatie C', datum: '2026-10-12', uur: '08:00', persoon: 'Roel', origResp: 'ROEL' },
        { ...basis, id: expect.any(String), titel: 'Installatie D', datum: '2026-10-13', uur: '10:00', persoon: 'Roel', origResp: 'Onbekende' },
        { ...basis, id: expect.any(String), titel: 'Installatie: Pietersen', datum: '2026-10-14', uur: '11:00', type: 'Installatie', persoon: null, origResp: '' },
      ],
    });
    // De tijdelijke _agents-lijst gaat niet mee.
    expect(JSON.stringify(puts(verzoeken)[0].body)).not.toContain('_agents');
    await expect(kaart(page, '2026-10-08', 'Installatie A')).toHaveCount(1);
    await expect(kaart(page, '2026-10-09', 'Installatie B')).toHaveCount(1);
  });

  test('duplicaten (zelfde datum, titel en uur) worden overgeslagen; niets nieuws: toast en geen verzoek', async ({ page, verzoeken }) => {
    const bestaand = { ...FULL, id: 'bestaand', titel: 'Installatie A', datum: '2026-10-08', uur: '09:00' };
    await startApp(page, { overschrijf: metSeed([bestaand], 3) });
    await naarKalender(page);
    await importeer(page, [BRON[0]]);
    await overlay(page).getByRole('button', { name: '✓ Importeren' }).click();
    await expect(toastTekst(page)).toHaveText('Alle afspraken zijn al aanwezig');
    await expect(overlay(page)).not.toHaveClass(/open/);
    expect(puts(verzoeken)).toEqual([]);
  });

  test('"Annuleren" sluit zonder verzoek en een volgende import begint opnieuw', async ({ page, verzoeken }) => {
    await startApp(page);
    await naarKalender(page);
    await importeer(page, BRON);
    await expect(overlay(page)).toHaveClass(/open/);
    await overlay(page).getByRole('button', { name: 'Annuleren' }).click();
    await expect(overlay(page)).not.toHaveClass(/open/);
    expect(puts(verzoeken)).toEqual([]);
    await importeer(page, [BRON[2]]);
    await expect(overlay(page)).toHaveClass(/open/);
    await expect(page.locator('#import-list .imp-item')).toHaveCount(1);
    await expect(page.locator('#import-subtitle')).toHaveText('1 afspraak · 0 onbekende technicus');
    await overlay(page).getByRole('button', { name: 'Sluiten' }).click();
    await expect(overlay(page)).not.toHaveClass(/open/);
    expect(puts(verzoeken)).toEqual([]);
  });

  test('geen JSON: toast; leeg bestand of lege lijst: toast; een kale lijst (zonder "afspraken") wordt ook aanvaard', async ({ page }) => {
    await startApp(page);
    await naarKalender(page);
    await importeer(page, 'dit is geen json');
    await expect(toastTekst(page)).toHaveText('✕ Ongeldig JSON-bestand');
    await expect(overlay(page)).not.toHaveClass(/open/);
    await importeer(page, { afspraken: [] });
    await expect(toastTekst(page)).toHaveText('⚠ Geen afspraken gevonden in bestand');
    await importeer(page, []);
    await expect(toastTekst(page)).toHaveText('⚠ Geen afspraken gevonden in bestand');
    await importeer(page, { iets: 'anders' });
    await expect(toastTekst(page)).toHaveText('⚠ Geen afspraken gevonden in bestand');
    await expect(overlay(page)).not.toHaveClass(/open/);
    await importeer(page, [BRON[1]]);
    await expect(overlay(page)).toHaveClass(/open/);
  });
});
