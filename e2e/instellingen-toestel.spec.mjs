import { test, expect, startApp } from './helpers.mjs';

// Etappe 5b, taak 1: karakterisering van het instellingenvenster buiten wat al gedekt is.
// Bestaand (niet dupliceren): bewaren van laatste start, de weigering "laatste start buiten de werktijden" en instellingen
// voor één technieker (instellingen-rapport.spec.mjs), Escape/achtergrondklik/focus (vensters.spec.mjs), de tab
// Beschikbaarheden (beschikbaarheid.spec.mjs). Hier: de tab "Dit toestel" (rol, weergave), de weekdagknoppen, alle
// weigeringen van saveSettings, de kleurkiezer, de "laatste start voor iedereen", resetTestdata en prijsbeheer.
// Testklok: maandag 5 okt 2026. In ?test gaat prijsbeheer naar localStorage (geen PUT /api/prijzen).

const leesOpslag = (page, sleutel) => page.evaluate((k) => localStorage.getItem(k), sleutel);
const leesJson = async (page, sleutel) => JSON.parse(await leesOpslag(page, sleutel));
const toastTekst = (page) => page.locator('#toast');
const instellingen = (page) => page.getByRole('dialog', { name: '⚙️ Instellingen' });

async function openInstellingen(page) {
  await page.getByRole('button', { name: 'Instellingen', exact: true }).click();
  await expect(instellingen(page)).toBeVisible();
  return instellingen(page);
}
async function openToestel(page) {
  const modal = await openInstellingen(page);
  await modal.getByRole('button', { name: 'Dit toestel', exact: true }).click();
  await expect(modal.locator('#set-tab-toestel')).toBeVisible();
  return modal;
}
// Haalt de verwachte consolemeldingen van een mislukt verzoek weg (en eist dat ze er waren).
async function verwachtMeldingen(consoleFouten, delen) {
  for (const deel of delen) {
    await expect.poll(() => consoleFouten.filter(f => f.includes(deel)).length, deel).toBeGreaterThan(0);
    for (const f of consoleFouten.filter(f => f.includes(deel))) consoleFouten.splice(consoleFouten.indexOf(f), 1);
  }
}

test.describe('instellingen: tab Dit toestel', () => {
  test('coördinator: standaardtab Algemeen; de toesteltab toont herkenning, rol en weergave', async ({ page }) => {
    await startApp(page);
    const modal = await openInstellingen(page);
    await expect(modal.locator('#set-tab-algemeen')).toBeVisible();
    await expect(modal.locator('#set-tab-toestel')).toBeHidden();
    await expect(modal.locator('#set-subtab-algemeen')).toHaveClass(/active/);
    await modal.getByRole('button', { name: 'Dit toestel', exact: true }).click();
    await expect(modal.locator('#set-subtab-toestel')).toHaveClass(/active/);
    await expect(modal.locator('#set-tab-algemeen')).toBeHidden();
    // De opslaan-knop hoort enkel bij Algemeen.
    await expect(modal.locator('#set-save-btn')).toBeHidden();
    await expect(modal.locator('#set-toestel-status')).toHaveText('Herkend als: Computer · liggend · muis/trackpad');
    await expect(modal.getByRole('radio', { name: 'Coördinator' })).toBeChecked();
    await expect(modal.getByRole('radio', { name: 'Technieker' })).not.toBeChecked();
    await expect(modal.getByRole('radio', { name: 'Automatisch' })).toBeChecked();
    // Testmodus: het blok "Testgegevens" is zichtbaar.
    await expect(modal.locator('#set-testdata-blok')).toBeVisible();
    // Terug naar Algemeen: de opslaan-knop komt terug.
    await modal.getByRole('button', { name: 'Algemeen', exact: true }).click();
    await expect(modal.locator('#set-save-btn')).toBeVisible();
  });

  test('technieker-rol: het venster opent op "Dit toestel" en de coördinatortabs bestaan niet', async ({ page }) => {
    await startApp(page, { rol: 'technieker', technieker: 'Tim' });
    const modal = await openInstellingen(page);
    await expect(modal.locator('#set-tab-toestel')).toBeVisible();
    await expect(modal.locator('#set-tab-algemeen')).toBeHidden();
    await expect(modal.locator('#set-subtab-algemeen')).toBeHidden();
    await expect(modal.locator('#set-subtab-beschikbaarheden')).toBeHidden();
    await expect(modal.getByRole('radio', { name: 'Technieker' })).toBeChecked();
    // Ook een expliciete klik op een andere tab laat de technieker op "Dit toestel" (setSettingsTab forceert het).
    await page.evaluate(() => kern.instellingen.setSettingsTab('algemeen'));
    await expect(modal.locator('#set-tab-toestel')).toBeVisible();
    await expect(modal.locator('#set-tab-algemeen')).toBeHidden();
  });

  test('rol kiezen (kiesToestelRol): tabs verdwijnen en verschijnen, blitz_rol wordt bewaard en de kalender wordt hertekend', async ({ page }) => {
    await startApp(page);
    const modal = await openToestel(page);
    for (const naam of ['Wachtrij', 'Route', 'Rapporten']) await expect(page.getByRole('tab', { name: naam })).toBeVisible();
    const voor = await page.evaluate(() => kern.kalender.renderTelling());

    await modal.getByRole('radio', { name: 'Technieker' }).check();
    await expect(page.locator('html')).toHaveAttribute('data-rol', 'technieker');
    expect(await leesOpslag(page, 'blitz_rol')).toBe('technieker');
    for (const naam of ['Wachtrij', 'Route', 'Rapporten']) await expect(page.getByRole('tab', { name: naam })).toBeHidden();
    // apparaatwijziging: de kalender is hertekend, het venster blijft open op de toesteltab met een bijgewerkte status.
    expect(await page.evaluate(() => kern.kalender.renderTelling())).toBeGreaterThan(voor);
    await expect(modal.locator('#set-tab-toestel')).toBeVisible();
    await expect(modal.getByRole('radio', { name: 'Technieker' })).toBeChecked();
    await expect(modal.locator('#set-subtab-algemeen')).toBeHidden();

    await modal.getByRole('radio', { name: 'Coördinator' }).check();
    await expect(page.locator('html')).toHaveAttribute('data-rol', 'coordinator');
    expect(await leesOpslag(page, 'blitz_rol')).toBe('coordinator');
    for (const naam of ['Wachtrij', 'Route', 'Rapporten']) await expect(page.getByRole('tab', { name: naam })).toBeVisible();
    await expect(modal.locator('#set-subtab-algemeen')).toBeVisible();
  });

  test('weergave kiezen (kiesToestelWeergave): blitz_weergave, data-attributen, statustekst met (handmatig) en de kalender wordt hertekend', async ({ page }) => {
    await startApp(page);
    const modal = await openToestel(page);
    const voor = await page.evaluate(() => kern.kalender.renderTelling());
    await modal.getByRole('radio', { name: 'Gsm' }).check();
    expect(await leesOpslag(page, 'blitz_weergave')).toBe('gsm');
    await expect(page.locator('html')).toHaveAttribute('data-apparaat', 'gsm');
    await expect(page.locator('html')).toHaveAttribute('data-indeling', 'smal');
    await expect(modal.locator('#set-toestel-status')).toHaveText('Herkend als: Computer · liggend · muis/trackpad (handmatig: Gsm)');
    await expect(modal.getByRole('radio', { name: 'Gsm' })).toBeChecked();
    expect(await page.evaluate(() => kern.kalender.renderTelling())).toBeGreaterThan(voor);

    await modal.getByRole('radio', { name: 'Tablet' }).check();
    expect(await leesOpslag(page, 'blitz_weergave')).toBe('tablet');
    await expect(page.locator('html')).toHaveAttribute('data-apparaat', 'tablet');
    await modal.getByRole('radio', { name: 'Computer' }).check();
    expect(await leesOpslag(page, 'blitz_weergave')).toBe('computer');
    await expect(page.locator('html')).toHaveAttribute('data-indeling', 'breed');
    // Computer is ook de automatische soort: geen "(handmatig…)" achter de tekst.
    await expect(modal.locator('#set-toestel-status')).toHaveText('Herkend als: Computer · liggend · muis/trackpad');

    await modal.getByRole('radio', { name: 'Automatisch' }).check();
    expect(await leesOpslag(page, 'blitz_weergave')).toBe('auto');
    await expect(modal.getByRole('radio', { name: 'Automatisch' })).toBeChecked();
  });

  test('een echt bubbelend change-event op een toesteluitkeuze (delegatie op document.body) zet rol en weergave', async ({ page }) => {
    await startApp(page);
    await openToestel(page);
    await page.evaluate(() => {
      const kies = (naam, waarde) => {
        const r = document.querySelector(`input[name="${naam}"][value="${waarde}"]`);
        r.checked = true;
        r.dispatchEvent(new Event('change', { bubbles: true }));
      };
      kies('set-weergave', 'tablet');
      kies('set-rol', 'technieker');
    });
    expect(await leesOpslag(page, 'blitz_weergave')).toBe('tablet');
    expect(await leesOpslag(page, 'blitz_rol')).toBe('technieker');
    await expect(page.locator('html')).toHaveAttribute('data-rol', 'technieker');
    await expect(page.locator('#set-toestel-status')).toHaveText(/\(handmatig: Tablet\)$/);
  });

  test('de weergavekeuze blijft na herladen en wordt in het venster teruggezet', async ({ page }) => {
    await startApp(page);
    let modal = await openToestel(page);
    await modal.getByRole('radio', { name: 'Tablet' }).check();
    await page.reload();
    await expect(page.locator('#cnt-tickets')).toHaveText('3');
    modal = await openToestel(page);
    await expect(modal.getByRole('radio', { name: 'Tablet' })).toBeChecked();
    await expect(page.locator('html')).toHaveAttribute('data-apparaat', 'tablet');
  });

  test('eerste weergavekeuze zonder gekozen rol legt de huidige rol vast (de rol flipt niet mee)', async ({ page }) => {
    await startApp(page, { rol: null });
    expect(await leesOpslag(page, 'blitz_rol')).toBeNull();
    await expect(page.locator('html')).toHaveAttribute('data-rol', 'coordinator'); // computer: standaardrol
    const modal = await openToestel(page);
    await modal.getByRole('radio', { name: 'Gsm' }).check();
    // Zonder die vastlegging zou de standaardrol van een gsm "technieker" zijn.
    expect(await leesOpslag(page, 'blitz_rol')).toBe('coordinator');
    await expect(page.locator('html')).toHaveAttribute('data-rol', 'coordinator');
    await expect(page.locator('html')).toHaveAttribute('data-apparaat', 'gsm');
  });

  test('Testgegevens opnieuw kopiëren: bevestigen stuurt POST /api/testdata, toast en herlaadt de pagina', async ({ page, verzoeken }) => {
    await startApp(page);
    const modal = await openToestel(page);
    const herladen = page.waitForEvent('load');
    await modal.getByRole('button', { name: 'Testgegevens opnieuw kopiëren' }).click();
    const dialoog = page.getByRole('alertdialog', { name: 'Testgegevens opnieuw kopiëren?' });
    await expect(dialoog).toBeVisible();
    await expect(dialoog).toContainText('Alle testwijzigingen gaan verloren. De echte gegevens worden niet aangeraakt.');
    expect(verzoeken.van('/api/testdata')).toEqual([]);
    await dialoog.getByRole('button', { name: 'Opnieuw kopiëren' }).click();
    await expect(toastTekst(page)).toHaveText('🧪 Testgegevens opnieuw gekopieerd');
    expect(verzoeken.van('/api/testdata').map(r => r.methode)).toEqual(['POST']);
    await herladen; // na 800 ms: location.reload()
    await expect(page.locator('#cnt-tickets')).toHaveText('3');
    expect(verzoeken.van('/api/testdata')).toHaveLength(1);
  });

  test('Testgegevens kopiëren: "Terug" doet niets; een fout geeft een toast en schakelt de knop weer in', async ({ page, verzoeken, consoleFouten }) => {
    await startApp(page, { overschrijf: { testdata: () => ({ status: 500, json: { error: 'kapot' } }) } });
    const modal = await openToestel(page);
    await modal.getByRole('button', { name: 'Testgegevens opnieuw kopiëren' }).click();
    const dialoog = page.getByRole('alertdialog', { name: 'Testgegevens opnieuw kopiëren?' });
    await dialoog.getByRole('button', { name: 'Terug' }).click();
    await expect(dialoog).toBeHidden();
    expect(verzoeken.van('/api/testdata')).toEqual([]);
    await expect(modal.locator('#set-testdata-btn')).toBeEnabled();

    await modal.getByRole('button', { name: 'Testgegevens opnieuw kopiëren' }).click();
    await page.getByRole('alertdialog', { name: 'Testgegevens opnieuw kopiëren?' }).getByRole('button', { name: 'Opnieuw kopiëren' }).click();
    await expect(toastTekst(page)).toHaveText('Testgegevens kopiëren mislukt — probeer opnieuw');
    await expect(modal.locator('#set-testdata-btn')).toBeEnabled();
    expect(verzoeken.van('/api/testdata')).toHaveLength(1);
    await verwachtMeldingen(consoleFouten, ['/api/testdata']);
  });
});

// UI/UX-review P1-3: de werkinstellingen per persoon zijn voor de beheerder alleen-lezen in dit venster (Beheer → Instellingen is de enige
// plek); de planner (geen Beheer-tab) bewerkt ze hier nog. Deze specs testen dat bewerkpad dus als planner; de beheerder staat verderop.
const PLANNER = { loginRol: 'planner' };
test.describe('instellingen: algemeen (werkdagen, weigeringen, kleur)', () => {
  const dagKnop = (modal, naam) => modal.locator('#days-grid .day-btn', { hasText: new RegExp(`^${naam}$`) });

  test('weekdagknoppen: Ma-Vr staan aan, klikken wisselt aria-pressed; bewaren schrijft de volgorde van klikken', async ({ page }) => {
    await startApp(page, PLANNER);
    let modal = await openInstellingen(page);
    expect(await modal.locator('#days-grid .day-btn').allInnerTexts()).toEqual(['Zo', 'Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za']);
    for (const d of ['Ma', 'Di', 'Wo', 'Do', 'Vr']) await expect(dagKnop(modal, d)).toHaveAttribute('aria-pressed', 'true');
    for (const d of ['Zo', 'Za']) await expect(dagKnop(modal, d)).toHaveAttribute('aria-pressed', 'false');
    await dagKnop(modal, 'Za').click();
    await expect(dagKnop(modal, 'Za')).toHaveAttribute('aria-pressed', 'true');
    await expect(dagKnop(modal, 'Za')).toHaveClass(/\bon\b/);
    await dagKnop(modal, 'Wo').click();
    await expect(dagKnop(modal, 'Wo')).toHaveAttribute('aria-pressed', 'false');
    await dagKnop(modal, 'Zo').click();
    await modal.getByRole('button', { name: 'Opslaan', exact: true }).click();
    await expect(toastTekst(page)).toHaveText('✓ Instellingen opgeslagen voor alle technici');
    // Gemeten: de array wordt in klikvolgorde aangepast (Za erbij, Wo eruit, Zo erbij).
    expect((await leesJson(page, 'blitz_settings')).werkdagen).toEqual([1, 2, 4, 5, 6, 0]);
    modal = await openInstellingen(page);
    await expect(dagKnop(modal, 'Wo')).toHaveAttribute('aria-pressed', 'false');
    await expect(dagKnop(modal, 'Zo')).toHaveAttribute('aria-pressed', 'true');
  });

  test('geen enkele werkdag: toast, het venster blijft open en er wordt niets bewaard', async ({ page }) => {
    await startApp(page, PLANNER);
    const modal = await openInstellingen(page);
    for (const d of ['Ma', 'Di', 'Wo', 'Do', 'Vr']) await dagKnop(modal, d).click();
    await modal.getByRole('button', { name: 'Opslaan', exact: true }).click();
    await expect(toastTekst(page)).toHaveText('⚠ Selecteer minstens één werkdag');
    await expect(modal).toBeVisible();
    expect(await leesOpslag(page, 'blitz_settings')).toBeNull();
  });

  test('Annuleren verwerpt een weekdagklik: bij heropenen staat de dag weer zoals bewaard', async ({ page }) => {
    await startApp(page, PLANNER);
    let modal = await openInstellingen(page);
    await dagKnop(modal, 'Za').click();
    await expect(dagKnop(modal, 'Za')).toHaveAttribute('aria-pressed', 'true');
    await modal.getByRole('button', { name: 'Annuleren' }).click();
    expect(await leesOpslag(page, 'blitz_settings')).toBeNull();
    modal = await openInstellingen(page);
    await expect(dagKnop(modal, 'Za')).toHaveAttribute('aria-pressed', 'false'); // weer uit na Annuleren
    // Ook Escape en een klik naast het venster verwerpen de klik (Wo uitzetten).
    await dagKnop(modal, 'Wo').click();
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    modal = await openInstellingen(page);
    await expect(dagKnop(modal, 'Wo')).toHaveAttribute('aria-pressed', 'true');
    await dagKnop(modal, 'Wo').click();
    await page.locator('#set-overlay').click({ position: { x: 5, y: 5 } });
    await expect(modal).toBeHidden();
    modal = await openInstellingen(page);
    await expect(dagKnop(modal, 'Wo')).toHaveAttribute('aria-pressed', 'true');
  });

  test('Opslaan neemt de weekdagwijziging wel over', async ({ page }) => {
    await startApp(page, PLANNER);
    let modal = await openInstellingen(page);
    await dagKnop(modal, 'Za').click();
    await modal.getByRole('button', { name: 'Opslaan', exact: true }).click();
    await expect(toastTekst(page)).toHaveText('✓ Instellingen opgeslagen voor alle technici');
    expect((await leesJson(page, 'blitz_settings')).werkdagen).toEqual([1, 2, 3, 4, 5, 6]);
    modal = await openInstellingen(page);
    await expect(dagKnop(modal, 'Za')).toHaveAttribute('aria-pressed', 'true');
  });

  const WEIGERINGEN = [
    ['begintijd na eindtijd', { '#set-van': '17:00', '#set-tot': '08:00' }, '⚠ Begintijd moet voor eindtijd liggen'],
    ['begintijd gelijk aan eindtijd', { '#set-van': '09:00', '#set-tot': '09:00' }, '⚠ Begintijd moet voor eindtijd liggen'],
    ['laatste start vóór de begintijd', { '#set-van': '09:00', '#set-laatste-start': '08:30' }, '⚠ Laatste start moet tussen begin- en eindtijd liggen'],
    ['laatste start na de eindtijd', { '#set-tot': '17:00', '#set-laatste-start': '18:00' }, '⚠ Laatste start moet tussen begin- en eindtijd liggen'],
    ['duur onder 15 minuten', { '#set-duration': '10' }, '⚠ Minimale interventieduur is 15 minuten'],
    ['maximaal per dag onder 1', { '#set-max': '0' }, '⚠ Maximaal per dag moet minstens 1 zijn'],
    ['negatieve reistijd', { '#set-maxreistijd': '-5' }, '⚠ Max. reistijd kan niet negatief zijn'],
    ['tijdslot onder 60 minuten', { '#set-tijdslot': '30' }, '⚠ Tijdslot moet minstens 60 minuten zijn'],
  ];
  for (const [naam, velden, tekst] of WEIGERINGEN) {
    test(`weigering: ${naam}`, async ({ page }) => {
      await startApp(page, PLANNER);
      const modal = await openInstellingen(page);
      for (const [sel, waarde] of Object.entries(velden)) await modal.locator(sel).fill(waarde);
      await modal.getByRole('button', { name: 'Opslaan', exact: true }).click();
      await expect(toastTekst(page)).toHaveText(tekst);
      await expect(modal).toBeVisible();
      expect(await leesOpslag(page, 'blitz_settings')).toBeNull();
      expect(await leesOpslag(page, 'blitz_laatste_start')).toBeNull();
    });
  }

  test('de volgorde van de controles: begin/eind gaat vóór duur, en duur vóór het tijdslot', async ({ page }) => {
    await startApp(page, PLANNER);
    const modal = await openInstellingen(page);
    await modal.locator('#set-van').fill('17:00');
    await modal.locator('#set-tot').fill('08:00');
    await modal.locator('#set-duration').fill('10');
    await modal.locator('#set-tijdslot').fill('30');
    await modal.getByRole('button', { name: 'Opslaan', exact: true }).click();
    await expect(toastTekst(page)).toHaveText('⚠ Begintijd moet voor eindtijd liggen');
    await modal.locator('#set-van').fill('08:00');
    await modal.locator('#set-tot').fill('17:00');
    await modal.getByRole('button', { name: 'Opslaan', exact: true }).click();
    await expect(toastTekst(page)).toHaveText('⚠ Minimale interventieduur is 15 minuten');
    await modal.locator('#set-duration').fill('60');
    await modal.getByRole('button', { name: 'Opslaan', exact: true }).click();
    await expect(toastTekst(page)).toHaveText('⚠ Tijdslot moet minstens 60 minuten zijn');
  });

  test('max. reistijd 0 blijft geldig (en een leeg veld wordt ook 0); alle velden worden bewaard', async ({ page }) => {
    await startApp(page, PLANNER);
    let modal = await openInstellingen(page);
    // Beginwaarden uit DEFAULT_SETTINGS.
    await expect(modal.locator('#set-start')).toHaveValue('Heirbaan 9, 9150 Kruibeke');
    await expect(modal.locator('#set-duration')).toHaveValue('120');
    await expect(modal.locator('#set-max')).toHaveValue('4');
    await expect(modal.locator('#set-maxreistijd')).toHaveValue('45');
    await expect(modal.locator('#set-van')).toHaveValue('08:00');
    await expect(modal.locator('#set-tot')).toHaveValue('17:00');
    await expect(modal.locator('#set-laatste-start')).toHaveValue('16:00');
    await expect(modal.locator('#set-tijdslot')).toHaveValue('180');
    await expect(modal.locator('#set-routekleur')).toHaveValue('#f59e0b');
    await expect(modal.locator('#set-routekleur-hex')).toHaveText('#F59E0B');
    await expect(modal.locator('#set-drukte')).toBeChecked();

    await modal.locator('#set-maxreistijd').fill('0');
    await modal.locator('#set-start').fill('  Kerkstraat 1, 9000 Gent  ');
    await modal.locator('#set-duration').fill('90');
    await modal.locator('#set-max').fill('6');
    await modal.locator('#set-van').fill('07:30');
    await modal.locator('#set-tot').fill('18:00');
    await modal.locator('#set-laatste-start').fill('15:30');
    await modal.locator('#set-tijdslot').fill('120');
    await modal.locator('#set-drukte').uncheck();
    await modal.getByRole('button', { name: 'Opslaan', exact: true }).click();
    await expect(toastTekst(page)).toHaveText('✓ Instellingen opgeslagen voor alle technici');
    await expect(modal).toBeHidden();
    const s = await leesJson(page, 'blitz_settings');
    expect(s).toMatchObject({
      startlocatie: 'Kerkstraat 1, 9000 Gent', duurMinuten: 90, maxPerDag: 6, vanTijd: '07:30', totTijd: '18:00', laatsteStart: '15:30',
      maxReistijdMin: 0, tijdslotMinuten: 120, drukteKleuring: false, routeKleur: '#f59e0b', werkdagen: [1, 2, 3, 4, 5],
    });
    expect(await leesOpslag(page, 'blitz_laatste_start')).toBe('15:30');
    modal = await openInstellingen(page);
    await expect(modal.locator('#set-maxreistijd')).toHaveValue('0');
    await expect(modal.locator('#set-drukte')).not.toBeChecked();
    // Een leeg reistijdveld wordt als 0 bewaard (+'' === 0).
    await modal.locator('#set-maxreistijd').fill('');
    await modal.getByRole('button', { name: 'Opslaan', exact: true }).click();
    expect((await leesJson(page, 'blitz_settings')).maxReistijdMin).toBe(0);
  });

  test('lege startlocatie, duur en max vallen terug op de standaardwaarden', async ({ page }) => {
    await startApp(page, PLANNER);
    const modal = await openInstellingen(page);
    await modal.locator('#set-start').fill('   ');
    await modal.locator('#set-van').fill('');
    await modal.locator('#set-tot').fill('');
    await modal.getByRole('button', { name: 'Opslaan', exact: true }).click();
    await expect(toastTekst(page)).toHaveText('✓ Instellingen opgeslagen voor alle technici');
    expect(await leesJson(page, 'blitz_settings')).toMatchObject({ startlocatie: 'Heirbaan 9, 9150 Kruibeke', vanTijd: '08:00', totTijd: '17:00' });
  });

  test('Annuleren bewaart niets en een heropend venster toont de bewaarde waarden', async ({ page }) => {
    await startApp(page, PLANNER);
    let modal = await openInstellingen(page);
    await modal.locator('#set-max').fill('9');
    await modal.getByRole('button', { name: 'Annuleren' }).click();
    await expect(modal).toBeHidden();
    expect(await leesOpslag(page, 'blitz_settings')).toBeNull();
    modal = await openInstellingen(page);
    await expect(modal.locator('#set-max')).toHaveValue('4');
  });

  test('routekleur: de hex-weergave volgt de kleurkiezer live en de gekozen kleur wordt bewaard', async ({ page }) => {
    await startApp(page, PLANNER);
    const modal = await openInstellingen(page);
    await expect(modal.locator('#set-routekleur-hex')).toHaveText('#F59E0B');
    await modal.locator('#set-routekleur').fill('#12ab34');
    await expect(modal.locator('#set-routekleur-hex')).toHaveText('#12AB34'); // hoofdletters, zonder te bewaren
    expect(await leesOpslag(page, 'blitz_settings')).toBeNull();
    await modal.getByRole('button', { name: 'Opslaan', exact: true }).click();
    expect((await leesJson(page, 'blitz_settings')).routeKleur).toBe('#12ab34');
    // Heropenen toont de bewaarde kleur; een nieuwe sessie zonder bewaarde kleur toont de standaard.
    const opnieuw = await openInstellingen(page);
    await expect(opnieuw.locator('#set-routekleur')).toHaveValue('#12ab34');
    await expect(opnieuw.locator('#set-routekleur-hex')).toHaveText('#12AB34');
  });

  test('laatste start is één waarde voor alle technici (blitz_laatste_start); de rest is per technieker', async ({ page }) => {
    await startApp(page, { ...PLANNER, technieker: 'Tim' });
    let modal = await openInstellingen(page);
    await modal.locator('#set-laatste-start').fill('15:00');
    await modal.locator('#set-max').fill('6');
    await modal.getByRole('button', { name: 'Opslaan', exact: true }).click();
    await expect(toastTekst(page)).toHaveText('✓ Instellingen opgeslagen voor Tim');
    expect(await leesOpslag(page, 'blitz_laatste_start')).toBe('15:00');
    expect((await leesJson(page, 'blitz_settings_Tim')).maxPerDag).toBe(6);

    await page.locator('#person-btn').click();
    await page.locator('#person-menu').getByRole('button', { name: /Roel/ }).click();
    await expect(page.locator('#person-name-hdr')).toHaveText('Roel');
    modal = await openInstellingen(page);
    await expect(modal.locator('#set-person-label')).toHaveText('Instellingen voor: Roel');
    await expect(modal.locator('#set-laatste-start')).toHaveValue('15:00'); // gedeeld
    await expect(modal.locator('#set-max')).toHaveValue('4'); // per technieker
  });

  test('een eerder per technieker bewaarde laatste start wordt genegeerd (R8): enkel blitz_laatste_start telt', async ({ page }) => {
    await page.addInitScript(() => {
      if (window !== window.top) return;
      if (localStorage.getItem('blitz_settings_Tim') === null) localStorage.setItem('blitz_settings_Tim', JSON.stringify({ laatsteStart: '12:00', maxPerDag: 7 }));
    });
    await startApp(page, { ...PLANNER, technieker: 'Tim' });
    const modal = await openInstellingen(page);
    await expect(modal.locator('#set-laatste-start')).toHaveValue('16:00');
    await expect(modal.locator('#set-max')).toHaveValue('7');
  });
});

test.describe('instellingen: prijsbeheer', () => {
  const prijs = (page) => page.locator('#prijs-overlay');
  const naamInvoer = (page) => prijs(page).locator('.prijs-naam-input');
  const eersteRij = (page) => prijs(page).locator('.prijs-row').first();
  async function openPrijzen(page) {
    const modal = await openInstellingen(page);
    await modal.getByRole('button', { name: '💰 Prijzen' }).click();
    await expect(prijs(page)).toHaveClass(/open/);
    return prijs(page);
  }

  test('openen sluit de instellingen; categorieën, onderdelen, tarieven en de metaregel staan er', async ({ page }) => {
    await startApp(page);
    const p = await openPrijzen(page);
    await expect(instellingen(page)).toBeHidden();
    await expect(page.locator('#prijs-titel')).toHaveText('💰 Prijsbeheer');
    await expect(page.locator('#prijs-meta')).toHaveText(/^v1 · 5\/10\/2026 \d\d:\d\d$/);
    expect(await p.locator('.prijs-cat-title').evaluateAll(els => els.map(e => e.textContent))).toEqual(['Controllers', 'Energiemeters', 'CT-klemmen', 'Overige componenten', 'Laadkabels & aansluitingen', 'Tarieven']);
    await expect(naamInvoer(page)).toHaveCount(25);
    await expect(naamInvoer(page).first()).toHaveValue('Controller - CHARX 3000');
    await expect(p.getByLabel('Prijs Controller - CHARX 3000')).toHaveValue('442.13');
    await expect(p.getByLabel('Tarief Extra uur')).toHaveValue('75');
    await expect(p.locator('.prijs-tarief-row')).toHaveCount(3);
    await expect(p.locator('.prijs-btn-voegtoe')).toHaveCount(5);
    await expect(p.locator('#prijs-save-btn')).not.toHaveClass(/btn-dirty/);
  });

  test('Opslaan zonder wijziging: toast "Geen wijzigingen" en geen verzoek', async ({ page, verzoeken }) => {
    await startApp(page);
    const p = await openPrijzen(page);
    await p.getByRole('button', { name: 'Opslaan', exact: true }).click();
    await expect(toastTekst(page)).toHaveText('Geen wijzigingen');
    expect(verzoeken.van('/api/prijzen').filter(r => r.methode !== 'GET')).toEqual([]);
  });

  test('naam en prijs van een onderdeel wijzigen (oninput): de opslaanknop wordt "dirty" en Opslaan bewaart lokaal', async ({ page, verzoeken }) => {
    await startApp(page);
    const p = await openPrijzen(page);
    await naamInvoer(page).first().fill('Controller - CHARX 3000 (nieuw)');
    await expect(p.locator('#prijs-save-btn')).toHaveClass(/btn-dirty/);
    // De aria-labels worden bij het tekenen gezet: de prijsinvoer heet nog naar de oude naam.
    await p.getByLabel('Prijs Controller - CHARX 3000', { exact: true }).fill('450.5');
    await p.getByLabel('Tarief Extra uur').fill('80');
    await p.getByRole('button', { name: 'Opslaan', exact: true }).click();
    await expect(toastTekst(page)).toHaveText('Prijzen opgeslagen (test)');
    await expect(p.locator('#prijs-save-btn')).not.toHaveClass(/btn-dirty/);
    await expect(p.locator('#prijs-save-btn')).toHaveText('Opslaan');
    await expect(p.locator('#prijs-save-btn')).toBeEnabled();
    await expect(page.locator('#prijs-meta')).toHaveText(/^v2 · /);
    // In ?test: enkel localStorage, geen PUT.
    expect(verzoeken.van('/api/prijzen').filter(r => r.methode !== 'GET')).toEqual([]);
    const cache = await leesJson(page, 'blitz_prijzen_cache');
    expect(cache.versie).toBe(2);
    expect(cache.onderdelen[0]).toMatchObject({ id: 'charx-3000', naam: 'Controller - CHARX 3000 (nieuw)', prijs: 450.5 });
    expect(cache.tarieven.find(t => t.id === 'extra-uur').prijs).toBe(80);
    expect(cache.bijgewerkt).toMatch(/^2026-10-05T/);
    // Niet-numerieke prijs wordt 0. Na het bewaren is de editor hertekend: het label noemt nu de nieuwe naam.
    await p.getByLabel('Prijs Controller - CHARX 3000 (nieuw)', { exact: true }).fill('');
    await p.getByRole('button', { name: 'Opslaan', exact: true }).click();
    expect((await leesJson(page, 'blitz_prijzen_cache')).onderdelen[0].prijs).toBe(0);
  });

  test('tag toevoegen (prompt) en verwijderen; lege of geannuleerde prompt doet niets', async ({ page }) => {
    await startApp(page);
    const p = await openPrijzen(page);
    const tags = () => eersteRij(page).locator('.prijs-tag').evaluateAll(els => els.map(e => e.firstChild.textContent));
    expect(await tags()).toEqual(['controller', 'Phoenix Contact', '3000']);
    page.once('dialog', d => { expect(d.message()).toBe('Nieuwe tag:'); d.accept('  nieuwe-tag  '); });
    await eersteRij(page).getByRole('button', { name: '+ tag' }).click();
    await expect.poll(tags).toEqual(['controller', 'Phoenix Contact', '3000', 'nieuwe-tag']);
    await expect(p.locator('#prijs-save-btn')).toHaveClass(/btn-dirty/);
    page.once('dialog', d => d.dismiss());
    await eersteRij(page).getByRole('button', { name: '+ tag' }).click();
    page.once('dialog', d => d.accept('   '));
    await eersteRij(page).getByRole('button', { name: '+ tag' }).click();
    expect(await tags()).toEqual(['controller', 'Phoenix Contact', '3000', 'nieuwe-tag']);
    await eersteRij(page).getByRole('button', { name: 'Verwijder label Phoenix Contact' }).click();
    await expect.poll(tags).toEqual(['controller', '3000', 'nieuwe-tag']);
    await p.getByRole('button', { name: 'Opslaan', exact: true }).click();
    expect((await leesJson(page, 'blitz_prijzen_cache')).onderdelen[0].tags).toEqual(['controller', '3000', 'nieuwe-tag']);
  });

  test('onderdeel verwijderen en toevoegen; een nieuw onderdeel start leeg met prijs 0', async ({ page }) => {
    await startApp(page);
    const p = await openPrijzen(page);
    await p.getByRole('button', { name: 'Verwijder Controller - CHARX 3000' }).click();
    await expect(naamInvoer(page)).toHaveCount(24);
    await expect(naamInvoer(page).first()).toHaveValue('Controller - CHARX 3100');
    await p.locator('.prijs-btn-voegtoe').first().click(); // categorie Controllers
    await expect(naamInvoer(page)).toHaveCount(25);
    // Het nieuwe onderdeel (categorie controller) staat onder de controllers, niet onderaan de pagina.
    const nieuw = p.locator('.prijs-naam-input[value=""]');
    await expect(nieuw).toHaveCount(1);
    // B13: de focus gaat naar het naamveld van het nieuwe onderdeel (niet naar het laatste naamveld van de pagina).
    await expect(nieuw).toBeFocused();
    await expect(naamInvoer(page).last()).not.toBeFocused();
    await nieuw.fill('Test onderdeel');
    await p.getByRole('button', { name: 'Opslaan', exact: true }).click();
    const cache = await leesJson(page, 'blitz_prijzen_cache');
    expect(cache.onderdelen).toHaveLength(25);
    // HUIDIG GEDRAG: het nieuwe onderdeel komt achteraan in de lijst (bij de categorie "controller", getoond bij de controllers).
    expect(cache.onderdelen.at(-1)).toMatchObject({ naam: 'Test onderdeel', categorie: 'controller', tags: [], prijs: 0, eenheid: 'stuk' });
    expect(cache.onderdelen.at(-1).id).toMatch(/^nieuw-\d+$/);
    expect(cache.onderdelen.some(o => o.id === 'charx-3000')).toBe(false);
  });

  test('"Ongedaan maken": confirm; weigeren behoudt de wijzigingen, accepteren zet alles terug', async ({ page }) => {
    await startApp(page);
    const p = await openPrijzen(page);
    await naamInvoer(page).first().fill('Gewijzigd');
    const berichten = [];
    page.once('dialog', d => { berichten.push(d.message()); d.dismiss(); });
    await p.getByRole('button', { name: 'Ongedaan maken' }).click();
    await expect.poll(() => berichten).toEqual(['Alle wijzigingen ongedaan maken?']);
    await expect(naamInvoer(page).first()).toHaveValue('Gewijzigd');
    await expect(p.locator('#prijs-save-btn')).toHaveClass(/btn-dirty/);
    page.once('dialog', d => d.accept());
    await p.getByRole('button', { name: 'Ongedaan maken' }).click();
    await expect(naamInvoer(page).first()).toHaveValue('Controller - CHARX 3000');
    await expect(p.locator('#prijs-save-btn')).not.toHaveClass(/btn-dirty/);
  });

  test('sluiten met ongeopgeslagen wijzigingen vraagt een bevestiging; zonder wijziging of na Opslaan meteen', async ({ page }) => {
    await startApp(page);
    let p = await openPrijzen(page);
    // Zonder wijziging: geen dialoog.
    await p.getByRole('button', { name: 'Sluiten' }).click();
    await expect(p).not.toHaveClass(/open/);
    // Met wijziging: weigeren houdt het venster open, accepteren sluit en gooit de wijziging weg.
    p = await openPrijzen(page);
    await naamInvoer(page).first().fill('Tijdelijk');
    const berichten = [];
    page.once('dialog', d => { berichten.push(d.message()); d.dismiss(); });
    await p.getByRole('button', { name: 'Sluiten' }).click();
    await expect.poll(() => berichten).toEqual(['Je hebt onopgeslagen wijzigingen. Toch sluiten?']);
    await expect(p).toHaveClass(/open/);
    page.once('dialog', d => d.accept());
    await p.getByRole('button', { name: 'Sluiten' }).click();
    await expect(p).not.toHaveClass(/open/);
    p = await openPrijzen(page);
    await expect(naamInvoer(page).first()).toHaveValue('Controller - CHARX 3000');
    // Na Opslaan is er niets meer dat verloren gaat: sluiten zonder dialoog.
    await naamInvoer(page).first().fill('Bewaard');
    await p.getByRole('button', { name: 'Opslaan', exact: true }).click();
    await p.getByRole('button', { name: 'Sluiten' }).click();
    await expect(p).not.toHaveClass(/open/);
    p = await openPrijzen(page);
    await expect(naamInvoer(page).first()).toHaveValue('Bewaard');
  });
});
