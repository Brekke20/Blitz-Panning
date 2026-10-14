import { test, expect, startApp, opslagStub } from './helpers.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// v2.1.5: het handtekeningenblok van het rapport mocht nooit over twee pagina's gesneden worden.
// Oorzaak: "Openen" in het rapportarchief toonde het rapport in één hoge iframe; de browser sneed die willekeurig op de paginagrens
// door en negeerde break-inside binnenin. Nu staat bij het afdrukken een inerte kopie in het venster zelf (rapport-archief.js,
// bouwDrukKopie) en heeft ook het blok zelf break-inside: avoid (rapport-wizard.js, buildRapportHtml).
// De test opent het rapport via het echte archiefvenster (echte window.open), drukt het af naar PDF in Chromium (page.pdf) en leest per
// pagina de tekst en de afbeeldingen met PyMuPDF; ontbreekt python of PyMuPDF, dan slaat enkel dat deel over.

const RAPPORT = { id: 'r1', ticketId: 't1', ticketNumber: '1001', datum: '2026-10-05', technieker: 'Tim', rapportData: { _html: '<p>x</p>' } };
const LEES_PDF = `
import sys, json, fitz
d = fitz.open(sys.argv[1]); uit = []
for p in d:
    uit.append({'tekst': p.get_text().upper(), 'afb': len(p.get_images())})
print(json.dumps(uit))
`;

function leesPdf(bestand) {
  const r = spawnSync('python', ['-W', 'ignore', '-c', LEES_PDF, bestand], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  try { return JSON.parse(r.stdout.trim().split('\n').pop()); } catch { return null; }
}

// Bouwt het echte rapport (buildRapportHtml) met twee echte PNG-handtekeningen en een afstandhouder bovenaan die het blok
// naar de paginagrens schuift.
async function bouwRapportHtml(page) {
  return page.evaluate(async () => {
    const m = await import('/js/rapport-wizard.js');
    await m.openRapport('t1', '2026-10-05');
    const c = document.createElement('canvas'); c.width = 220; c.height = 90;
    const g = c.getContext('2d'); g.lineWidth = 3; g.beginPath(); g.moveTo(5, 80); g.lineTo(60, 10); g.lineTo(110, 80); g.lineTo(170, 10); g.lineTo(215, 80); g.stroke();
    m.R.handtekeningTech = c.toDataURL();
    g.beginPath(); g.moveTo(10, 20); g.lineTo(200, 70); g.stroke(); // andere tekening: PyMuPDF telt identieke afbeeldingen als één
    m.R.handtekeningKlant = c.toDataURL();
    m.R.probleem = 'Laadpaal offline na stroomuitval'; m.R.acties = 'Controller herstart en firmware nagekeken';
    const html = m.buildRapportHtml();
    document.getElementById('rapport-wizard').classList.remove('open'); // closeWizard() vraagt een bevestiging
    return html;
  });
}

test.describe('rapport afdrukken: handtekeningenblok blijft heel', () => {
  test('stijlregels: titel blijft bij de vakken en blok en vakken breken niet', async ({ page }) => {
    await startApp(page, { overschrijf: { 'rapport-archief': opslagStub({ versie: 1, rapports: [RAPPORT] }, 'rapports') } });
    const html = await bouwRapportHtml(page);
    const ander = await page.context().newPage();
    await ander.setContent(html);
    await ander.emulateMedia({ media: 'print' });
    const stijlen = await ander.evaluate(() => {
      const sec = [...document.querySelectorAll('.sec')].find(e => /handtekeningen/i.test(e.textContent));
      const stijl = (el) => { const s = getComputedStyle(el); return { binnen: s.breakInside, na: s.breakAfter }; };
      return {
        sec: stijl(sec), omhulsel: stijl(sec.parentElement), rij: stijl(document.querySelector('.sig-row')),
        vakken: [...document.querySelectorAll('.sig-box')].map(e => stijl(e).binnen),
        rijenTabel: [...document.querySelectorAll('table.parts tr')].map(e => stijl(e).binnen),
      };
    });
    expect(stijlen.sec.na).toBe('avoid');
    expect(stijlen.omhulsel.binnen).toBe('avoid');
    expect(stijlen.rij.binnen).toBe('avoid');
    expect(stijlen.vakken).toEqual(['avoid', 'avoid']);
    expect(stijlen.rijenTabel.length).toBeGreaterThan(0);
    expect(new Set(stijlen.rijenTabel)).toEqual(new Set(['avoid']));
    await ander.close();
  });

  test('echt archiefvenster naar PDF: bij elke positie rond de paginagrens staat het hele blok op één pagina', async ({ page }) => {
    test.setTimeout(120000);
    await startApp(page, { overschrijf: { 'rapport-archief': opslagStub({ versie: 1, rapports: [RAPPORT] }, 'rapports') } });
    const html = await bouwRapportHtml(page);
    const map = fs.mkdtempSync(path.join(os.tmpdir(), 'blitz-rapport-pdf-'));
    let python = null;
    try {
      await page.getByRole('tab', { name: 'Rapporten' }).click();
      const knop = page.getByRole('button', { name: '📄 Openen' });
      await expect(knop).toHaveCount(1);
      let gecontroleerd = 0;
      for (let afstand = 0; afstand <= 450; afstand += 30) {
        const metAfstand = html.replace('<div class="accent-bar"></div>', `<div class="accent-bar"></div><div style="height:${afstand}px"></div>`);
        await page.evaluate((h) => { window.kern.rapportArchief.lijst()[0].rapportData._html = h; }, metAfstand);
        const [popup] = await Promise.all([page.waitForEvent('popup'), knop.click()]);
        await popup.waitForLoadState('load');
        await expect.poll(() => popup.evaluate(() => !!document.querySelector('iframe')?.contentDocument?.querySelector('.sig-row'))).toBe(true);
        await popup.emulateMedia({ media: 'print' });
        const bestand = path.join(map, `r-${afstand}.pdf`);
        await popup.pdf({ path: bestand, format: 'A4', printBackground: true, margin: { top: '10mm', bottom: '10mm', left: '0mm', right: '0mm' } });
        if (process.env.RAPPORT_PDF_UIT && afstand === Number(process.env.RAPPORT_PDF_AFSTAND ?? 150)) fs.copyFileSync(bestand, process.env.RAPPORT_PDF_UIT);
        await popup.close();
        if (python === null) python = leesPdf(bestand) !== null;
        if (!python) continue;
        const paginas = leesPdf(bestand);
        const metTitel = paginas.map((p, i) => (p.tekst.includes('HANDTEKENINGEN') ? i : -1)).filter(i => i >= 0);
        expect(metTitel, `afstand ${afstand}: titel op precies één pagina`).toHaveLength(1);
        const p = paginas[metTitel[0]];
        const na = p.tekst.split('HANDTEKENINGEN').pop();
        expect(na, `afstand ${afstand}: vak Technieker bij de titel`).toContain('TECHNIEKER');
        expect(na, `afstand ${afstand}: vak Klant bij de titel`).toContain('KLANT');
        expect(p.afb, `afstand ${afstand}: beide handtekeningen op dezelfde pagina`).toBe(2);
        expect(paginas.reduce((s, x) => s + x.afb, 0), `afstand ${afstand}: geen handtekening elders`).toBe(2);
        gecontroleerd++;
      }
      test.skip(!python, 'python of PyMuPDF ontbreekt: PDF-inhoud niet gecontroleerd');
      expect(gecontroleerd).toBeGreaterThan(10);
    } finally {
      fs.rmSync(map, { recursive: true, force: true });
    }
  });
});
