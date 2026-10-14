import { test, expect, startApp, opslagStub } from './helpers.mjs';

// v2.1.5 (veiligheid): buildRapportHtml zet vrije tekst (technieker, uitvoering, facturatie, datum, oorzaak) en de handtekening-src
// enkel als tekst of als echte afbeeldings-data-URL in het rapport.
const RAPPORT = { id: 'r1', ticketId: 't1', ticketNumber: '1001', datum: '2026-10-05', technieker: 'Tim', rapportData: { _html: '<p>x</p>' } };
const AANVAL = '<img src=x onerror=window.__pwned=1>';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function bouw(page, extra) {
  return page.evaluate(async (extra) => {
    const m = await import('/js/rapport-wizard.js');
    await m.openRapport('t1', '2026-10-05');
    Object.assign(m.R, extra);
    const html = m.buildRapportHtml();
    document.getElementById('rapport-wizard').classList.remove('open'); // closeWizard() vraagt een bevestiging
    return html;
  }, extra);
}

test.describe('rapport-HTML: ongeldige waarden komen als tekst uit', () => {
  test('aanvalswaarden in tekstvelden worden tekst, handtekening-src enkel als echte afbeelding', async ({ page }) => {
    await startApp(page, { overschrijf: { 'rapport-archief': opslagStub({ versie: 1, rapports: [RAPPORT] }, 'rapports') } });
    const html = await bouw(page, {
      technieker: AANVAL, type: AANVAL, uitvoering: AANVAL, kabel: 'kabel', kabellengte: AANVAL,
      facturatie: 'vrij', facturatieVrij: AANVAL, servicetype: '2e-lijn', interventieType: 'Interventie',
      oorzaakStoring: [AANVAL, 'Ander'], datum: '"></title><img src=x onerror=window.__pwned=1>',
      handtekeningTech: 'x" onerror="window.__pwned=1', handtekeningKlant: 'javascript:window.__pwned=1',
    });
    expect(html).not.toContain(AANVAL);
    expect(html).not.toContain('</title><img');
    expect(html).not.toContain('javascript:');
    expect(html).not.toMatch(/<img[^>]*onerror/i);
    expect(html).toContain('&lt;img src=x onerror=window.__pwned=1&gt;');
    // Beide ongeldige handtekeningen: geen <img>, wel "(niet getekend)".
    expect(html.match(/\(niet getekend\)/g)).toHaveLength(2);
    expect(html).not.toMatch(/<img/i);

    const ander = await page.context().newPage();
    await ander.setContent(html);
    expect(await ander.evaluate(() => document.querySelectorAll('[onerror],[onload]').length)).toBe(0);
    expect(await ander.evaluate(() => window.__pwned)).toBeUndefined();
    await ander.close();
  });

  test('gewone waarden en echte handtekeningen blijven ongewijzigd', async ({ page }) => {
    await startApp(page, { overschrijf: { 'rapport-archief': opslagStub({ versie: 1, rapports: [RAPPORT] }, 'rapports') } });
    const html = await bouw(page, {
      technieker: 'Tim Peeters', type: 'Blitz 11', uitvoering: 'Wallbox', kabel: 'kabel', kabellengte: '5m',
      facturatie: 'vrij', facturatieVrij: 'Firma Janssens', oorzaakStoring: ['Firmwarefout', 'Slechte verbinding'],
      handtekeningTech: PNG, handtekeningKlant: PNG,
    });
    expect(html).toContain('Tim Peeters');
    expect(html).toContain('Blitz 11 · Wallbox · Vaste kabel 5m');
    expect(html).toContain('Firma Janssens');
    expect(html).toContain('Firmwarefout, Slechte verbinding');
    expect(html.split(`<img src="${PNG}"`)).toHaveLength(3);
  });
});
