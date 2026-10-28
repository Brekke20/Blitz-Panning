// Contrast-meting op glas (Open dag, taak 9; verhuisd uit versiering.spec.mjs). Geen test-import: enkel hulpfuncties.
import zlib from 'node:zlib';
import { expect } from './helpers.mjs';

// PNG lezen zoals Chromium het aflevert (8 bit, RGB of RGBA, zonder interlace), met node:zlib: geen extra pakket nodig.
export function leesPng(buf) {
  let p = 8, breed = 0, hoog = 0, kleurType = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      breed = data.readUInt32BE(0); hoog = data.readUInt32BE(4); kleurType = data[9];
      if (data[8] !== 8 || data[12] !== 0 || (kleurType !== 2 && kleurType !== 6)) throw new Error(`PNG-vorm niet ondersteund (diepte ${data[8]}, type ${kleurType}, interlace ${data[12]})`);
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const bpp = kleurType === 6 ? 4 : 3, rij = breed * bpp, ruw = zlib.inflateSync(Buffer.concat(idat)), px = Buffer.alloc(hoog * rij);
  for (let y = 0; y < hoog; y++) {
    const f = ruw[y * (rij + 1)], bron = y * (rij + 1) + 1, doel = y * rij;
    for (let x = 0; x < rij; x++) {
      const a = x >= bpp ? px[doel + x - bpp] : 0, b = y > 0 ? px[doel - rij + x] : 0, c = x >= bpp && y > 0 ? px[doel - rij + x - bpp] : 0;
      let v = ruw[bron + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); v += pa <= pb && pa <= pc ? a : (pb <= pc ? b : c); }
      px[doel + x] = v & 255;
    }
  }
  return { breed, hoog, kleur: (x, y) => { const i = (y * breed + x) * bpp; return [px[i], px[i + 1], px[i + 2]]; } };
}

// Vervaging zoals backdrop-filter: blur(<sigma>px) (gaussisch, straal 3 sigma) van een uitsnede plus 3 sigma rand; buiten de
// foto telt de dichtstbijzijnde pixel. Geeft een lezer (x, y) -> [r, g, b] op paginacoördinaten binnen de uitsnede.
// Vanaf sigma 12 (de 28 px van het glas op een computer) wordt de foto eerst in blokken van 4 x 4 gemiddeld en daarna met sigma / 4
// vervaagd: bij zo'n brede vervaging is dat even goed en ongeveer 60 keer sneller.
const KLEIN = new WeakMap();
function verkleind(beeld, f) {
  if (KLEIN.has(beeld)) return KLEIN.get(beeld);
  const breed = Math.ceil(beeld.breed / f), hoog = Math.ceil(beeld.hoog / f), px = new Float32Array(breed * hoog * 3);
  for (let y = 0; y < hoog; y++) for (let x = 0; x < breed; x++) {
    const t = [0, 0, 0]; let n = 0;
    for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) {
      const bx = x * f + dx, by = y * f + dy;
      if (bx >= beeld.breed || by >= beeld.hoog) continue;
      const c = beeld.kleur(bx, by); t[0] += c[0]; t[1] += c[1]; t[2] += c[2]; n++;
    }
    px.set([t[0] / n, t[1] / n, t[2] / n], (y * breed + x) * 3);
  }
  const klein = { breed, hoog, kleur: (x, y) => { const i = (y * breed + x) * 3; return [px[i], px[i + 1], px[i + 2]]; } };
  KLEIN.set(beeld, klein);
  return klein;
}
export function vervaag(beeld, vak, sigma = 6) {
  if (sigma >= 12) {
    const f = 4, lees = vervaag(verkleind(beeld, f), { x: vak.x / f, y: vak.y / f, w: vak.w / f, h: vak.h / f }, sigma / f);
    return (x, y) => lees(Math.floor(x / f), Math.floor(y / f));
  }
  const s = Math.ceil(3 * sigma), kern = [];
  for (let i = -s; i <= s; i++) kern.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
  const som = kern.reduce((a, b) => a + b);
  const klem = (v, max) => Math.min(max - 1, Math.max(0, v));
  const x0 = Math.floor(vak.x) - s, y0 = Math.floor(vak.y) - s, b = Math.ceil(vak.w) + 2 * s, h = Math.ceil(vak.h) + 2 * s;
  const bron = new Float32Array(b * h * 3), hor = new Float32Array(b * h * 3), uit = new Float32Array(b * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < b; x++) bron.set(beeld.kleur(klem(x0 + x, beeld.breed), klem(y0 + y, beeld.hoog)), (y * b + x) * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < b; x++) for (let k = 0; k < 3; k++) {
    let t = 0; for (let i = -s; i <= s; i++) t += kern[i + s] * bron[(y * b + Math.min(b - 1, Math.max(0, x + i))) * 3 + k];
    hor[(y * b + x) * 3 + k] = t / som;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < b; x++) for (let k = 0; k < 3; k++) {
    let t = 0; for (let i = -s; i <= s; i++) t += kern[i + s] * hor[(Math.min(h - 1, Math.max(0, y + i)) * b + x) * 3 + k];
    uit[(y * b + x) * 3 + k] = t / som;
  }
  return (x, y) => { const i = ((y - y0) * b + (x - x0)) * 3; return [uit[i], uit[i + 1], uit[i + 2]]; };
}

// saturate(180%) van de backdrop-filter van het glas (CSS-filterfunctie, in sRGB): de vervaagde achtergrond wordt kleurrijker voordat
// de glaskleur eroverheen komt.
export function verzadig(c, s = 1.8) {
  const [r, g, b] = c;
  const klem = (v) => Math.min(255, Math.max(0, v));
  return [
    klem((0.213 + 0.787 * s) * r + (0.715 - 0.715 * s) * g + (0.072 - 0.072 * s) * b),
    klem((0.213 - 0.213 * s) * r + (0.715 + 0.285 * s) * g + (0.072 - 0.072 * s) * b),
    klem((0.213 - 0.213 * s) * r + (0.715 - 0.715 * s) * g + (0.072 + 0.928 * s) * b),
  ];
}
export const meng = (boven, onder) => [0, 1, 2].map((i) => boven[i] * boven[3] + onder[i] * (1 - boven[3]));
export const lum = (c) => { const k = c.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * k[0] + 0.7152 * k[1] + 0.0722 * k[2]; };
export const contrast = (a, b) => { const [h, d] = [lum(a), lum(b)].sort((x, y) => y - x); return (h + 0.05) / (d + 0.05); };

// Helderste en donkerste 6x6-blok (gemiddelde, stap 2 px) van de vervaagde achtergrond binnen een vak.
export function uitersteBlokken(lees, vak) {
  let helder = null, donker = null;
  const x1 = Math.floor(vak.x + vak.w) - 6, y1 = Math.floor(vak.y + vak.h) - 6;
  for (let y = Math.ceil(vak.y); y <= Math.max(Math.ceil(vak.y), y1); y += 2) for (let x = Math.ceil(vak.x); x <= Math.max(Math.ceil(vak.x), x1); x += 2) {
    const t = [0, 0, 0];
    for (let dy = 0; dy < 6; dy++) for (let dx = 0; dx < 6; dx++) { const c = lees(x + dx, y + dy); t[0] += c[0]; t[1] += c[1]; t[2] += c[2]; }
    const g = t.map((v) => v / 36);
    if (!helder || lum(g) > lum(helder)) helder = g;
    if (!donker || lum(g) < lum(donker)) donker = g;
  }
  return { helder, donker };
}

// Meet per kaart in het huidige venster: de kaartkleur (rgba), de vervaging, het kaartvak, de teksten (zonder eigen achtergrond)
// en of de kaart volledig zichtbaar is (de hoeken en het midden raken de kaart zelf, niet een vaste balk).
export async function meetKaarten(page, sel) {
  return page.locator(sel).evaluateAll((lijst) => {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    const rgba = (kleur) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = kleur; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
    const vakVan = (r) => ({ x: r.left, y: r.top, w: r.width, h: r.height });
    return lijst.map((el, nr) => {
      const cs = getComputedStyle(el), r = el.getBoundingClientRect();
      // de hoekpunten liggen binnen de ronding van het glas (hoeken tot 24 px): 3 px plus 30 % van de straal van de rand
      const i = 3 + 0.3 * (parseFloat(cs.borderTopLeftRadius) || 0);
      const punten = [[r.left + i, r.top + i], [r.right - i, r.top + i], [r.left + i, r.bottom - i], [r.right - i, r.bottom - i], [r.left + r.width / 2, r.top + r.height / 2]];
      const zichtbaar = r.width > 0 && r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth
        && punten.every(([x, y]) => el.contains(document.elementFromPoint(x, y)));
      const geraakt = punten.map(([x, y]) => document.elementFromPoint(x, y)).filter((g) => !el.contains(g)).map((g) => `${g?.tagName}.${g?.className}`);
      const teksten = [...el.querySelectorAll('*')]
        .filter((t) => [...t.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
        .filter((t) => { let x = t; while (x && x !== el) { const xs = getComputedStyle(x); if (rgba(xs.backgroundColor)[3] > 0 || xs.backgroundImage !== 'none') return false; x = x.parentElement; } return true; })
        .map((t) => ({ sel: t.className, kleur: rgba(getComputedStyle(t).color) }));
      return { nr, naam: el.textContent.replace(/\s+/g, ' ').trim().slice(0, 30), kaart: rgba(cs.backgroundColor), blur: cs.backdropFilter, vak: vakVan(r), zichtbaar, geraakt, teksten };
    });
  });
}

// Foto van enkel de achtergrond: de kaarten en de voorste laag verborgen (visibility: de opmaak blijft), animaties stil.
export async function fotoAchtergrond(page, sel) {
  const stijl = await page.addStyleTag({ content: `${sel}, #event-laag { visibility: hidden !important; }` });
  const png = await page.screenshot({ animations: 'disabled', caret: 'hide' });
  await stijl.evaluate((el) => el.remove());
  const beeld = leesPng(png);
  expect(beeld.breed, 'de foto is op schaal 1').toBe(await page.evaluate(() => innerWidth));
  return beeld;
}

// Na een nieuwe vensterbreedte schakelt de app met een korte vertraging tussen zijkolom en dok (kern/navigatievorm.js: data-nav, dezelfde
// regel als apparaat.js): wacht tot data-nav klopt voor de huidige breedte en dan twee frames, zodat de lay-out stilstaat.
export async function wachtOpNavigatie(page) {
  await page.waitForFunction(() => document.documentElement.dataset.nav === ((window.apparaat?.indeling !== 'breed' || innerWidth < 768) ? 'dok' : 'kolom'));
  await wachtOpFrames(page, 2);
}

// Wacht op een aantal animatieframes (stijl en hover-toestand zijn dan bijgewerkt).
export async function wachtOpFrames(page, aantal = 2) {
  await page.evaluate((n) => new Promise((klaar) => { const stap = (i) => (i <= 0 ? klaar() : requestAnimationFrame(() => stap(i - 1))); stap(n); }), aantal);
}

// Wacht tot het kaartvak (getBoundingClientRect) over twee opeenvolgende animatieframes gelijk blijft (scrollen en lay-out zijn dan klaar).
export async function wachtOpStilstand(page, locator) {
  await locator.evaluate((el) => new Promise((klaar) => {
    const vorm = () => { const r = el.getBoundingClientRect(); return `${r.left},${r.top},${r.width},${r.height}`; };
    let vorige = vorm(), gelijk = 0, frames = 0;
    const stap = () => {
      const nu = vorm();
      gelijk = nu === vorige ? gelijk + 1 : 0;
      vorige = nu;
      if (gelijk >= 2 || ++frames > 120) klaar(); else requestAnimationFrame(stap);
    };
    requestAnimationFrame(stap);
  }));
}

// De glaswaarden die de stijl (base.css) per toestel, thema en achtergrond hoort te geven. DIT is de ene plek die taak 10 (snelheid, gsm)
// of een nieuwe tuning aanpast; de metingen hieronder lezen de echte waarden uit de berekende stijl van <html> en eisen dat ze hieraan
// gelijk zijn. Sleutels: [achtergrond: 'hemel' | 'thema'][toestel: 'pc' | 'gsm'][modus: 'donker' | 'licht']. `glas` = kaart, `hover` =
// kaart met de muis erboven, `sterk` = kop en dok, `venster` = vensters en dashboardkaarten (allemaal alpha van de kleur).
export const VERWACHT_GLAS = {
  hemel: {
    pc:  { donker: { blur: '28px', glas: 0.075, hover: 0.12, sterk: 0.09, venster: 0.84 }, licht: { blur: '28px', glas: 0.52, hover: 0.72, sterk: 0.58, venster: 0.88 } },
    gsm: { donker: { blur: '10px', glas: 0.12, hover: 0.17, sterk: 0.14, venster: 0.92 },  licht: { blur: '10px', glas: 0.72, hover: 0.84, sterk: 0.76, venster: 0.94 } },
  },
  // Een thema met achtergrond (data-event-achtergrond="ja") vervangt de hemel door een scène; zie evenement.css
  // en krijgt in donker dichter, donkerblauw glas (base.css, taak 9); in licht is het gewone glas genoeg
  thema: {
    pc:  { donker: { blur: '28px', glas: 0.56, hover: 0.66, sterk: 0.62, venster: 0.84 }, licht: { blur: '28px', glas: 0.52, hover: 0.72, sterk: 0.58, venster: 0.88 } },
    gsm: { donker: { blur: '10px', glas: 0.56, hover: 0.66, sterk: 0.62, venster: 0.92 }, licht: { blur: '10px', glas: 0.72, hover: 0.84, sterk: 0.76, venster: 0.94 } },
  },
};

// De glaswaarden zoals base.css ze nu voor dit toestel en thema geeft (--glas, --glas-hover, --glas-sterk, --glas-venster en --blur op <html>),
// plus de sleutel waaronder ze in VERWACHT_GLAS horen.
export async function leesGlasTokens(page) {
  return page.evaluate(() => {
    const root = document.documentElement, cs = getComputedStyle(root);
    const alpha = (naam) => { const m = cs.getPropertyValue(naam).match(/rgba?\(([^)]*)\)/)[1].split(',').map((x) => parseFloat(x)); return m.length > 3 ? m[3] : 1; };
    return {
      alpha: alpha('--glas'), alphaHover: alpha('--glas-hover'), alphaSterk: alpha('--glas-sterk'), alphaVenster: alpha('--glas-venster'), blur: cs.getPropertyValue('--blur').trim(),
      sleutel: [root.dataset.eventAchtergrond === 'ja' ? 'thema' : 'hemel', root.dataset.apparaat === 'gsm' ? 'gsm' : 'pc', root.dataset.theme === 'light' ? 'licht' : 'donker'],
    };
  });
}

// De berekende tokens moeten gelijk zijn aan VERWACHT_GLAS (één plek om te wijzigen); geeft de tokens terug.
export async function controleerGlasTokens(page, label) {
  const glas = await leesGlasTokens(page);
  const [achtergrond, toestel, modus] = glas.sleutel;
  const verwacht = VERWACHT_GLAS[achtergrond][toestel][modus], wat = `${label}: glas ${glas.sleutel.join('/')}`;
  expect(glas.blur, `${wat}: --blur`).toBe(verwacht.blur);
  expect(glas.alpha, `${wat}: --glas`).toBeCloseTo(verwacht.glas, 3);
  expect(glas.alphaHover, `${wat}: --glas-hover`).toBeCloseTo(verwacht.hover, 3);
  expect(glas.alphaSterk, `${wat}: --glas-sterk`).toBeCloseTo(verwacht.sterk, 3);
  expect(glas.alphaVenster, `${wat}: --glas-venster`).toBeCloseTo(verwacht.venster, 3);
  return glas;
}

// Voor het afstemmen van tokens: CONTRAST_ZACHT=1 laat de metingen doorlopen en meldt alle tekorten (expect.soft) in plaats van bij het
// eerste te stoppen. Een gewone run (en de releaserun) faalt bij het eerste tekort.
const toets = (waarde, bericht) => (process.env.CONTRAST_ZACHT ? expect.soft(waarde, bericht) : expect(waarde, bericht));

// Alle kaarten van `sel` meten: één foto voor de kaarten die al volledig zichtbaar zijn, daarna de rest één voor één in beeld
// geschoven. Per kaart en tekst: het slechtste contrast tegen het gemiddelde en tegen de helderste en donkerste vlek (na vervaging
// en saturate zoals het glas ze doet), met de kaartkleur eroverheen.
export async function controleerKaarten(page, sel, label, slechtste) {
  await wachtOpNavigatie(page);
  const glas = await controleerGlasTokens(page, label);
  const sigma = parseFloat(glas.blur) || 0;
  const gedaan = new Set();
  let aantal = 0;
  for (let ronde = 0; ronde < 40; ronde++) {
    let kaarten = await meetKaarten(page, sel);
    aantal = kaarten.length;
    expect(aantal, `${label}: kaarten`).toBeGreaterThan(0);
    const open = kaarten.filter((k) => !gedaan.has(k.nr));
    if (!open.length) break;
    if (!open.some((k) => k.zichtbaar)) {
      // Na het scrollen wachten tot het kaartvak over twee animatieframes niet meer verschuift, daarna meten; zichtbaar? Eén keer opnieuw
      for (let poging = 0; poging < 2; poging++) {
        await page.locator(sel).nth(open[0].nr).evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'center' }));
        await wachtOpStilstand(page, page.locator(sel).nth(open[0].nr));
        kaarten = await meetKaarten(page, sel);
        if (kaarten.some((k) => !gedaan.has(k.nr) && k.zichtbaar)) break;
      }
    }
    const nu = kaarten.filter((k) => !gedaan.has(k.nr) && k.zichtbaar);
    expect(nu.length, `${label}: kaart ${open[0].naam} komt volledig in beeld (vak ${JSON.stringify(kaarten[open[0].nr].vak)}, geraakt ${kaarten[open[0].nr].geraakt})`).toBeGreaterThan(0);
    const beeld = await fotoAchtergrond(page, sel);
    for (const k of nu) {
      gedaan.add(k.nr);
      // Open dag (v2.5.0): glas is algemeen, waarden uit base.css (--glas en --blur van dit toestel en thema; de kaart zelf is
      // --glas, bij hover --glas-hover)
      expect(k.kaart[3], `${label} ${k.naam}`).toBeCloseTo(glas.alpha, 2);
      expect(k.blur, `${label} ${k.naam}: vervaging`).toContain(`blur(${glas.blur})`);
      expect(k.teksten.length).toBeGreaterThanOrEqual(2);
      const t0 = [0, 0, 0];
      let n = 0;
      for (let y = Math.ceil(k.vak.y); y < Math.floor(k.vak.y + k.vak.h); y++) for (let x = Math.ceil(k.vak.x); x < Math.floor(k.vak.x + k.vak.w); x++) {
        const c = beeld.kleur(x, y); t0[0] += c[0]; t0[1] += c[1]; t0[2] += c[2]; n++;
      }
      const gemiddeld = sigma > 0 ? verzadig(t0.map((v) => v / n)) : t0.map((v) => v / n);
      const lees0 = sigma > 0 ? vervaag(beeld, k.vak, sigma) : (x, y) => beeld.kleur(x, y);
      const lees = sigma > 0 ? (x, y) => verzadig(lees0(x, y)) : lees0;
      // de uiterste vlek ERGENS in de kaart: een andere afspraak of een lange titel kan tekst op elke plek van de kaart leggen
      const vlek = uitersteBlokken(lees, k.vak);
      // Ook met de muis erboven (hover: bv. --surface2, of de rodere kaart van een verlopen ticket): elke kaart, dezelfde vlekken
      await page.mouse.move(k.vak.x + k.vak.w / 2, k.vak.y + k.vak.h / 2);
      await wachtOpFrames(page, 2); // de hover-toestand volgt de muis pas bij de volgende frame
      const zweef = (await meetKaarten(page, sel))[k.nr];
      await page.mouse.move(0, 0);
      expect(zweef.kaart[3], `${label} ${k.naam} (hover)`).toBeCloseTo(glas.alphaHover, 2);
      for (const [stand, kaart, teksten] of [['', k.kaart, k.teksten], [' (hover)', zweef.kaart, zweef.teksten]]) {
        for (const t of teksten) {
          for (const [soort, onder] of [['gemiddelde', gemiddeld], ['helderste vlek', vlek.helder], ['donkerste vlek', vlek.donker]]) {
            const c = contrast(t.kleur, meng(kaart, onder));
            const waar = `${label}${stand} ${k.naam} .${t.sel} rgb(${t.kleur.slice(0, 3)}) over ${soort} rgb(${onder.map(Math.round)})`;
            if (c < slechtste.waarde) Object.assign(slechtste, { waarde: c, waar });
            const v = label.split(' ')[2];
            slechtste.perVenster[v] = Math.min(slechtste.perVenster[v] ?? Infinity, c);
            toets(c, waar).toBeGreaterThanOrEqual(4.5);
          }
        }
      }
    }
  }
  expect(gedaan.size, `${label}: alle kaarten gemeten`).toBe(aantal);
}
