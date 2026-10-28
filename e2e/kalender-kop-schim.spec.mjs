import { test, expect, startApp } from './helpers.mjs';
import { seed } from './kalender-hulp.mjs';

// Fix ronde 1 van taak 20 (v2.5.1): in de tijdlijnweek (pc en liggende tablet) schuiven de uurlabels ("08:00", "09:00") na de sprong naar het huidige uur onder de
// vastgeplakte dagkoppen en de hoekcel linksboven door. Met het doorzichtiger glas waren ze er leesbaar doorheen te zien. De kop (`.week-grid.tl-mode .day-hdr`,
// ook de hoekcel) heeft nu een vervaging (--blur-balk, op pc het gewone --blur) en het dichtere glas van een venster. Zelfde meting als de schimtest in kalender-gsm-vandaag.spec.mjs: de
// beeldpunten van de kopregel met en zonder de inhoud eronder (tl-wrap en tl-gutter-wrap onzichtbaar); `max` = sterkte, `scherp` = grootste stap tussen twee
// naburige beeldpunten van het verschilbeeld. De kop is daarbij ook dichter geworden (--glas-venster, het token van een venster, niet effen): enkel de vervaging bleek niet genoeg omdat de hoekcel smal is.
const VRIJDAG = '2026-10-09T10:30:00+02:00';
const MATEN = [
  { naam: 'pc 1366x768', viewport: { width: 1366, height: 768 } },
  { naam: 'tablet liggend 1024x768', viewport: { width: 1024, height: 768 } },
];
// Gemeten na de fix (dagkop op --glas-venster plus vervaging): donker max 24 tot 27 en scherp 21 tot 25, licht 13 en 13. Gemeten zonder fix (--glas-sterk, geen vervaging):
// donker 136 en 136, licht 88 en 88 (de labels zijn dan goed leesbaar). De grenzen liggen er ruim tussen.
const GRENZEN = { dark: { max: 36, scherp: 32 }, light: { max: 22, scherp: 20 } };

// De hoekcel (een uurlabel van 28 px in een kop van 39 px) kreeg bij de eerste fix nog een zwak maar zichtbaar spoor mee; strengere grens (zie het rapport).
const HOEK = { dark: { max: 10, scherp: 8 }, light: { max: 6, scherp: 5 } };

for (const { naam, viewport } of MATEN) {
  for (const thema of ['dark', 'light']) {
    test(`tijdlijnweek, ${naam}, ${thema}: uurlabels onder de dagkoppen en de hoekcel zijn niet leesbaar`, async ({ page }) => {
      await page.addInitScript((t) => { if (window === window.top) localStorage.setItem('blitz_theme', t); }, thema);
      await startApp(page, { viewport, nu: VRIJDAG, wachtOpApp: false, overschrijf: seed() });
      await page.getByRole('tab', { name: 'Kalender' }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', thema);
      await expect(page.locator('#week-grid')).toHaveClass(/tl-mode/);
      await expect(page.locator('.tl-now-label').first()).toHaveText(/10:3\d/);
      await expect.poll(() => page.locator('#week-grid .tl-block').count(), { message: 'de gegevens zijn binnen en getekend' }).toBeGreaterThan(0);
      // wacht tot de sprong klaar is (de scrollstand van het raster staat stil) en er labels onder de kop doorgeschoven zijn
      await expect.poll(async () => {
        const a = await page.evaluate(() => document.getElementById('week-grid').scrollTop);
        await page.evaluate(() => new Promise((r) => setTimeout(r, 60)));
        return a > 0 && a === await page.evaluate(() => document.getElementById('week-grid').scrollTop);
      }).toBe(true);
      const koprechthoek = () => page.evaluate(() => {
        const r = [...document.querySelectorAll('#week-grid .day-hdr')].map((e) => e.getBoundingClientRect());
        const g = document.getElementById('week-grid').getBoundingClientRect();
        return { x: Math.round(g.left), y: Math.round(Math.min(...r.map((q) => q.top))), width: Math.round(g.width), height: Math.round(Math.max(...r.map((q) => q.bottom)) - Math.min(...r.map((q) => q.top))) };
      });
      // de pagina staat stil: twee metingen na elkaar geven dezelfde kopregel (geen late hertekening of melding die het raster verschuift)
      let kop = await koprechthoek();
      await expect.poll(async () => { const nieuw = await koprechthoek(); const gelijk = JSON.stringify(nieuw) === JSON.stringify(kop); kop = nieuw; await page.evaluate(() => new Promise((r) => setTimeout(r, 150))); return gelijk; }).toBe(true);
      // er schuift echt een uurlabel onder de kop door (anders meet de test niets)
      const labelsOnder = await page.evaluate((k) => [...document.querySelectorAll('.tl-gutter-label')].filter((e) => { const r = e.getBoundingClientRect(); return r.bottom > k.y && r.top < k.y + k.height; }).length, kop);
      expect(labelsOnder, 'uurlabels onder de kop').toBeGreaterThan(0);
      const met = (await page.screenshot({ clip: kop })).toString('base64');
      await page.addStyleTag({ content: '#week-grid .tl-wrap, #week-grid .tl-gutter-wrap { visibility: hidden !important; }' });
      const zonder = (await page.screenshot({ clip: kop })).toString('base64');
      // Drie gebieden van het verschilbeeld (de hoekcel zonder de eerste 6 px links: daar buigt de ronde hoek van het glazen vlak, en het verschil met en zonder inhoud zit daar aan de rand, niet in het label): de hele kopregel, enkel de hoekcel (de smalle kop van de uurkolom, `.tl-gutter .day-hdr`) en enkel de dagkoppen (zonder hoekcel).
      const hoek = await page.evaluate(() => { const r = document.querySelector('.tl-gutter .day-hdr').getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; });
      const gebieden = { kopregel: { x: 0, y: 0, w: kop.width, h: kop.height }, hoekcel: { x: hoek.x - kop.x + 6, y: hoek.y - kop.y, w: hoek.w - 6, h: hoek.h }, dagkoppen: { x: hoek.x - kop.x + hoek.w, y: 0, w: kop.width - (hoek.x - kop.x + hoek.w), h: kop.height } };
      const meting = await page.evaluate(async ([a, b, geb]) => {
        const lees = async (s) => { const bm = await createImageBitmap(await (await fetch('data:image/png;base64,' + s)).blob()); const c = new OffscreenCanvas(bm.width, bm.height); c.getContext('2d').drawImage(bm, 0, 0); return { d: c.getContext('2d').getImageData(0, 0, bm.width, bm.height).data, w: bm.width, h: bm.height }; };
        const [p, q] = [await lees(a), await lees(b)];
        const w = p.w, h = p.h, v = new Float32Array(w * h);
        for (let i = 0; i < w * h; i++) { const j = i * 4; v[i] = Math.max(Math.abs(p.d[j] - q.d[j]), Math.abs(p.d[j + 1] - q.d[j + 1]), Math.abs(p.d[j + 2] - q.d[j + 2])); }
        const uit = {};
        for (const [naam, g] of Object.entries(geb)) {
          let m = 0, s = 0;
          // de bovenste 8 rijen en de randen (1 px) vallen weg: aan de bovenrand van de kop (rijen 0 tot 7: max 12 licht en 21 donker, gemeten per rij) verschilt de vervaging met en zonder
          // inhoud om een andere reden dan een doorschemerend label; de uurlabels staan daaronder (eerste label vanaf rij 10)
          for (let y = Math.max(0, g.y) + 8; y < Math.min(h, g.y + g.h) - 1; y++) for (let x = Math.max(0, g.x) + 1; x < Math.min(w, g.x + g.w) - 1; x++) {
            const i = y * w + x; m = Math.max(m, v[i]);
            if (x + 1 < Math.min(w, g.x + g.w) - 1) s = Math.max(s, Math.abs(v[i] - v[i + 1]));
            if (y + 1 < Math.min(h, g.y + g.h) - 1) s = Math.max(s, Math.abs(v[i] - v[i + w]));
          }
          uit[naam] = { max: m, scherp: s };
        }
        return uit;
      }, [met, zonder, gebieden]);
      console.log(`SCHIMMETING ${naam} ${thema}: ` + JSON.stringify(meting));
      for (const [gebied, { max, scherp }] of Object.entries(meting)) {
        const grens = gebied === 'hoekcel' ? HOEK[thema] : GRENZEN[thema];
        expect(max, `sterkte van wat doorschemert (${gebied})`).toBeLessThanOrEqual(grens.max);
        expect(scherp, `scherpte van wat doorschemert (${gebied})`).toBeLessThanOrEqual(grens.scherp);
      }
    });
  }
}
