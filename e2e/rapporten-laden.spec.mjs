// O6: het archief robuust laden (public/js/rapport-archief.js, laadRapportArchief).
// - Een mislukte lading (HTTP-fout, geen lijst in het antwoord, afgebroken verzoek) laat de getoonde lijst en de versie staan, met een toast;
//   was er nog niets geladen, dan komt de foutregel zoals voorheen.
// - Een antwoord met een LAGERE versie (verouderd of de lege terugval van de server bij een opslagstoring) wordt stil genegeerd (console.warn).
// - Een byte-gelijk antwoord hertekent de kalender niet; de archieflijst wordt wel altijd hertekend en de kalenderkaartjes blijven werken.
import { test, expect, startApp } from './helpers.mjs';

const tab = (page, naam) => page.getByRole('tab', { name: naam, exact: true });
// 2026-10-07 valt in de getoonde week (VASTE_NU = ma 5 okt 2026).
const rapport = (id, nr, extra = {}) => ({ id, ticketId: `t-${id}`, ticketNumber: nr, datum: '2026-10-07', technieker: 'Tim', klant: `Klant ${nr}`, rapportData: { _html: `<p>${nr}</p>`, start: '10:00', stop: '11:00' }, ...extra });
const RAPPORTEN = [rapport('r1', '1002'), rapport('r2', '1003')];

// Een stub met een wisselbaar antwoord; telt de GET-aanroepen.
function maakStub(begin) {
  const stand = { antwoord: begin, aanroepen: 0 };
  return {
    stand,
    stub: () => { stand.aanroepen++; return typeof stand.antwoord === 'function' ? stand.antwoord() : stand.antwoord; },
  };
}
const OK = (versie, rapports) => ({ status: 200, json: { versie, rapports } });

const body = (page) => page.locator('#rapp-archief-body');
const rijen = (page) => page.locator('#rapp-archief-body .ticket');
const versie = (page) => page.evaluate(() => kern.rapportArchief.versie());
const lijstIds = (page) => page.evaluate(() => kern.rapportArchief.lijst().map(r => r.id));
const kalenderTelling = (page) => page.evaluate(() => kern.kalender.renderTelling());

// Zet een merkteken in het archief: het verdwijnt zodra het archief hertekend is (een lading die tekent).
const zetMerk = (page) => page.evaluate(() => { document.getElementById('rapp-archief-body').insertAdjacentHTML('afterbegin', '<i id="merk"></i>'); });
const merkWeg = (page) => expect(page.locator('#merk')).toHaveCount(0);

// Een bedoelde fout meldt de browser ook als HTTP-fout of consolefout; die halen we weg (zoals beheer-tabs.spec.mjs).
async function neemFoutenWeg(consoleFouten) {
  await expect.poll(() => consoleFouten.filter(f => f.includes('rapport-archief')).length).toBeGreaterThanOrEqual(1);
  for (const f of consoleFouten.filter(f => f.includes('rapport-archief'))) consoleFouten.splice(consoleFouten.indexOf(f), 1);
}
const herlaad = (page) => page.getByRole('button', { name: /Herladen/ }).click();

async function startMetArchief(page, begin) {
  const s = maakStub(begin);
  await startApp(page, { loginRol: 'beheerder', technieker: 'all', overschrijf: { 'rapport-archief': s.stub } });
  await tab(page, 'Rapporten').click();
  await expect(rijen(page)).toHaveCount(2);
  return s;
}

test.describe('rapportarchief laden (O6)', () => {
  test('een tweede lading met een identiek antwoord hertekent de kalender niet, de lijst wel', async ({ page }) => {
    const s = await startMetArchief(page, OK(3, RAPPORTEN));
    const voorTelling = await kalenderTelling(page);
    const voorAanroepen = s.stand.aanroepen;
    const voorTekst = await body(page).innerText();
    await zetMerk(page);
    await herlaad(page);
    await merkWeg(page); // de archieflijst is hertekend
    expect(s.stand.aanroepen).toBe(voorAanroepen + 1);
    expect(await kalenderTelling(page)).toBe(voorTelling);
    expect(await body(page).innerText()).toBe(voorTekst);
    await expect(rijen(page)).toHaveCount(2);
    expect(await versie(page)).toBe(3);
  });

  test('een antwoord dat wel verschilt hertekent de kalender en de lijst', async ({ page }) => {
    const s = await startMetArchief(page, OK(3, RAPPORTEN));
    const voorTelling = await kalenderTelling(page);
    s.stand.antwoord = OK(4, [...RAPPORTEN, rapport('r3', '1004')]);
    await herlaad(page);
    await expect(rijen(page)).toHaveCount(3);
    expect(await versie(page)).toBe(4);
    expect(await kalenderTelling(page)).toBeGreaterThan(voorTelling);
  });

  test('na een identiek antwoord opent een kalenderkaartje het rapport nog (het record blijft hetzelfde object)', async ({ page }) => {
    const s = await startMetArchief(page, OK(3, RAPPORTEN));
    await tab(page, 'Kalender').click();
    await expect(page.locator('.cal-ticket.afgerond', { hasText: '#1002' }).first()).toBeVisible();
    await tab(page, 'Rapporten').click();
    const voorTelling = await kalenderTelling(page);
    await zetMerk(page);
    await herlaad(page);
    await merkWeg(page);
    expect(await kalenderTelling(page)).toBe(voorTelling); // de kalender is niet opnieuw getekend: de kaartjes houden hun oude record
    expect(s.stand.aanroepen).toBeGreaterThanOrEqual(2);
    await tab(page, 'Kalender').click();
    const [popup] = await Promise.all([page.waitForEvent('popup'), page.locator('.cal-ticket.afgerond', { hasText: '#1002' }).first().click()]);
    await popup.waitForLoadState('load');
    await expect.poll(() => popup.evaluate(() => document.querySelector('iframe')?.getAttribute('srcdoc') || '')).toContain('1002');
    await popup.close();
  });

  for (const [naam, fout] of [
    ['een 500', { status: 500, json: { error: 'Interne fout' } }],
    ['een 503 { error, code }', { status: 503, json: { error: 'Opslag tijdelijk niet bereikbaar', code: 'opslag-storing' } }],
  ]) {
    test(`${naam} na een geslaagde lading: de rijen en de versie blijven, met een melding`, async ({ page, consoleFouten }) => {
      const s = await startMetArchief(page, OK(3, RAPPORTEN));
      const voor = await body(page).innerText();
      s.stand.antwoord = fout;
      await herlaad(page);
      await expect(page.locator('#toast')).toContainText('✕ Rapporten vernieuwen mislukt: Serverfout (HTTP ' + fout.status + ')');
      await neemFoutenWeg(consoleFouten);
      expect(await body(page).innerText()).toBe(voor);
      await expect(rijen(page)).toHaveCount(2);
      expect(await versie(page)).toBe(3);
      expect(await lijstIds(page)).toEqual(['r1', 'r2']);
    });
  }

  test('een 200 zonder lijst (rapports ontbreekt of is geen array) is een fout: rijen en versie blijven', async ({ page }) => {
    const s = await startMetArchief(page, OK(3, RAPPORTEN));
    const voor = await body(page).innerText();
    for (const kapot of [{ versie: 5 }, { versie: 5, rapports: 'x' }, { versie: 5, rapports: null }, null]) {
      s.stand.antwoord = { status: 200, json: kapot };
      const n = s.stand.aanroepen;
      await herlaad(page);
      await expect.poll(() => s.stand.aanroepen).toBe(n + 1);
      await expect(page.locator('#toast')).toContainText('✕ Rapporten vernieuwen mislukt: Onverwacht antwoord van de server');
      await page.locator('#toast').evaluate(el => { el.textContent = ''; el.classList.remove('show'); });
      expect(await body(page).innerText()).toBe(voor);
      expect(await versie(page)).toBe(3);
    }
    await expect(rijen(page)).toHaveCount(2);
  });

  test('een antwoord dat geen JSON is: foutmelding, rijen en versie blijven', async ({ page }) => {
    const s = await startMetArchief(page, OK(3, RAPPORTEN));
    s.stand.antwoord = { status: 200, raw: '<html>Bad Gateway</html>' };
    await herlaad(page);
    await expect(page.locator('#toast')).toContainText('✕ Rapporten vernieuwen mislukt: Onleesbaar antwoord van de server');
    await expect(rijen(page)).toHaveCount(2);
    expect(await versie(page)).toBe(3);
  });

  test('een afgebroken verzoek: de rijen en de versie blijven, met een melding', async ({ page, consoleFouten }) => {
    const s = await startMetArchief(page, OK(3, RAPPORTEN));
    s.stand.antwoord = { afbreken: 'failed' };
    await herlaad(page);
    await expect(page.locator('#toast')).toContainText('✕ Rapporten vernieuwen mislukt: Geen verbinding met de server');
    await neemFoutenWeg(consoleFouten);
    await expect(rijen(page)).toHaveCount(2);
    expect(await versie(page)).toBe(3);
  });

  test('een lagere versie (de lege terugval van de server) wordt stil genegeerd: console.warn, geen melding, lijst en versie blijven', async ({ page }) => {
    const s = await startMetArchief(page, OK(3, RAPPORTEN));
    const waarschuwingen = [];
    page.on('console', m => { if (m.type() === 'warning') waarschuwingen.push(m.text()); });
    const voorTelling = await kalenderTelling(page);
    for (const antwoord of [OK(0, []), OK(2, [rapport('r9', '9999')])]) {
      s.stand.antwoord = antwoord;
      const n = waarschuwingen.length;
      await herlaad(page);
      await expect.poll(() => waarschuwingen.length).toBe(n + 1);
    }
    expect(waarschuwingen.every(w => w.includes('genegeerd'))).toBe(true);
    await expect(page.locator('#toast')).not.toContainText('mislukt');
    await expect(rijen(page)).toHaveCount(2);
    expect(await lijstIds(page)).toEqual(['r1', 'r2']);
    expect(await versie(page)).toBe(3);
    expect(await kalenderTelling(page)).toBe(voorTelling);
    // Een gelijke of hogere versie wordt wel gewoon aangenomen.
    s.stand.antwoord = OK(3, [RAPPORTEN[0]]);
    await herlaad(page);
    await expect(rijen(page)).toHaveCount(1);
  });

  test('de eerste lading faalt: de foutregel zoals voorheen, en een volgende lading herstelt', async ({ page, consoleFouten }) => {
    const s = maakStub({ status: 500, json: { error: 'Interne fout' } });
    await startApp(page, { loginRol: 'beheerder', technieker: 'all', overschrijf: { 'rapport-archief': s.stub } });
    await tab(page, 'Rapporten').click();
    await expect(body(page)).toContainText('✕ Laden mislukt: Serverfout (HTTP 500)');
    await neemFoutenWeg(consoleFouten);
    expect(await versie(page)).toBeNull();
    s.stand.antwoord = OK(3, RAPPORTEN);
    await herlaad(page);
    await expect(rijen(page)).toHaveCount(2);
    await expect(body(page)).not.toContainText('Laden mislukt');
    expect(await versie(page)).toBe(3);
  });
});
