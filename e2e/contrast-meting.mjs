// Contrast-meting op glas (Open dag, taak 9; verhuisd uit versiering.spec.mjs). Geen test-import: enkel hulpfuncties.
import fs from 'node:fs';
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
    pc:  { donker: { blur: '28px', glas: 0.40, hover: 0.52, sterk: 0.50, venster: 0.84 }, licht: { blur: '28px', glas: 0.52, hover: 0.72, sterk: 0.58, venster: 0.88 } },
    gsm: { donker: { blur: '10px', glas: 0.50, hover: 0.60, sterk: 0.56, venster: 0.92 }, licht: { blur: '10px', glas: 0.72, hover: 0.84, sterk: 0.76, venster: 0.94 } },
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

// ── Vaste vlakken (zijkolom, dok, kop en paginakop, vensters, dashboardkaarten, afgewerkte sales-kaart) ──
// Hier geen model van het glas, maar de echte pixels: de tekst van de vlakken wordt doorzichtig gemaakt en de pagina gefotografeerd
// (de foto bevat dus de echte vervaging, de saturate, de glaskleur, de gloed en de eigen vlakken van chips en knoppen); daarna haalt elk
// tekstelement tegen ELKE pixel binnen zijn eigen vak 4,5:1 (de slechtste telt). Staat er een doorzichtigheid (opacity) op de tekst of een
// ouder, dan komt er een tweede foto bij met het vlak verborgen (de achtergrond zonder glas) om de menging exact te rekenen.
// De inhoud onder een kleverige kop (kaarten die onder het glas doorschuiven) zit er enkel in voor zover de pagina ze toont.
const DOORZICHTIG = (sels) => `${sels.flatMap((s) => [s, `${s} *`, `${s} ::placeholder`]).join(', ')} { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; caret-color: transparent !important; }
  ${sels.flatMap((s) => [`${s} text`, `${s} tspan`]).join(', ')} { fill: transparent !important; }
  ${sels.flatMap((s) => [`${s} ::-webkit-datetime-edit`, `${s} ::-webkit-datetime-edit-fields-wrapper`, `${s} ::-webkit-datetime-edit-text`, `${s} ::-webkit-datetime-edit-day-field`, `${s} ::-webkit-datetime-edit-month-field`, `${s} ::-webkit-datetime-edit-year-field`, `${s} ::-webkit-datetime-edit-hour-field`, `${s} ::-webkit-datetime-edit-minute-field`]).join(', ')} { color: transparent !important; -webkit-text-fill-color: transparent !important; }`;

// De tekstelementen van de vlakken: vak, kleur, doorzichtigheid, korte naam. Enkel wat zichtbaar is en echt in het vlak ligt.
async function meetTeksten(page, wortelSels, uitsluiten = [], alleenLos = false) {
  return page.evaluate(([sels, buiten, alleenLos]) => {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    const rgba = (kleur) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = kleur; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
    const wortels = sels.flatMap((s) => [...document.querySelectorAll(s)]);
    const uit = [], gezien = new Set();
    const knip = (a, b) => ({ l: Math.max(a.l, b.l), t: Math.max(a.t, b.t), r: Math.min(a.r, b.r), b: Math.min(a.b, b.b) });
    for (const w of wortels) for (const el of [w, ...w.querySelectorAll('*')]) {
      if (gezien.has(el)) continue;
      gezien.add(el);
      const eigenTekst = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
      const isVeld = (el.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=hidden]), textarea') && el.value) || (el.tagName === 'SELECT' && el.selectedOptions.length);
      if (!eigenTekst.length && !isVeld) continue;
      if (buiten.length && el.closest(buiten.join(', '))) continue; // bv. de kaart met tegels van een derde (geen tekst van ons)
      const cs = getComputedStyle(el);
      if (cs.visibility !== 'visible' || cs.display === 'none') continue;
      // vak van de tekst zelf (alle regels), geknipt op het element en op wat zijn ouders afknippen
      // Emoji (⚠, 📅, 👤) zijn kleurenglyphs: de doorzichtige tekstkleur raakt ze niet, dus hun pixels zeggen niets over de achtergrond.
      // Enkel de runs zonder emoji tellen mee; een element met alleen emoji slaan we over.
      let vak = null;
      for (const n of eigenTekst) {
        for (const run of n.textContent.matchAll(/[^\p{Extended_Pictographic}\uFE0F\u200D\s]+/gu)) {
          const r = document.createRange();
          r.setStart(n, run.index);
          r.setEnd(n, run.index + run[0].length);
          for (const q of r.getClientRects()) vak = vak ? { l: Math.min(vak.l, q.left), t: Math.min(vak.t, q.top), r: Math.max(vak.r, q.right), b: Math.max(vak.b, q.bottom) } : { l: q.left, t: q.top, r: q.right, b: q.bottom };
        }
      }
      const eigen = el.getBoundingClientRect();
      if (isVeld) {
        // de tekst van een veld ligt binnen rand en opvulling; de pijl van een keuzelijst en het icoon van een datumveld zijn geen tekst
        const pijl = el.tagName === 'SELECT' || /^(date|time|datetime-local|month|week|search|number)$/.test(el.type) ? 22 : 0;
        vak = { l: eigen.left + (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.paddingLeft) || 0), t: eigen.top, r: eigen.right - (parseFloat(cs.borderRightWidth) || 0) - (parseFloat(cs.paddingRight) || 0) - pijl, b: eigen.bottom };
      }
      if (!vak) continue;
      vak = knip(vak, { l: eigen.left, t: eigen.top, r: eigen.right, b: eigen.bottom });
      const voll = { b: vak.b - vak.t, r: vak.r - vak.l }; // vak zoals de tekst echt ligt, vóór het afknippen
      for (let x = el.parentElement; x; x = x.parentElement) {
        const o = getComputedStyle(x);
        if (/(hidden|clip|auto|scroll)/.test(o.overflowX + o.overflowY)) { const r = x.getBoundingClientRect(); vak = knip(vak, { l: r.left, t: r.top, r: r.right, b: r.bottom }); }
      }
      vak = knip(vak, { l: 0, t: 0, r: innerWidth, b: innerHeight });
      // het tekstvak is de regelhoogte, de inkt ligt er 10 % vanaf boven en onder en niet tot aan de zijrand (een pil heeft ronde einden)
      const dy = Math.max(1, 0.1 * (vak.b - vak.t));
      vak = { l: vak.l + 1, t: vak.t + dy, r: vak.r - 1, b: vak.b - dy };
      if (vak.r - vak.l < 2 || vak.b - vak.t < 2) continue;
      if (vak.b - vak.t < 0.6 * voll.b || vak.r - vak.l < 0.6 * voll.r) continue; // grotendeels afgeknipt (weggescrold): geen leesbare tekst
      // Ligt er iets anders overheen (een kleverige voet, een menu, een venster), dan is dit niet de zichtbare tekst
      const geraakt = document.elementFromPoint((vak.l + vak.r) / 2, (vak.t + vak.b) / 2);
      if (!geraakt || !(geraakt === el || el.contains(geraakt) || geraakt.contains(el)) || !wortels.some((w) => w.contains(geraakt))) continue;
      let o = 1;
      for (let x = el; x; x = x.parentElement) o *= parseFloat(getComputedStyle(x).opacity);
      const svg = el instanceof SVGElement;
      // los = geen eigen vlak tussen de tekst en de hemel: geen backdrop-filter (glas), geen verloop of afbeelding en geen achtergrondkleur
      // met een dekking vanaf 35 % (een effen vlak of een chip met een eigen kleur). Een lichte tint (--accent-dim, een dagkolom, een
      // gestreepte rij) telt als los: daarachter blijft de hemel bepalend.
      let los = true;
      for (let x = el; x && x !== document.documentElement; x = x.parentElement) {
        const xs = getComputedStyle(x);
        if (x !== document.body && (rgba(xs.backgroundColor)[3] >= 0.35 || xs.backgroundImage !== 'none' || (xs.backdropFilter && xs.backdropFilter !== 'none'))) { los = false; break; }
      }
      if (alleenLos && !los) continue;
      uit.push({
        los,
        sel: `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''}`,
        tekst: (el.textContent || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 24),
        kleur: rgba(svg ? cs.fill : (cs.webkitTextFillColor && cs.webkitTextFillColor !== 'currentcolor' ? cs.webkitTextFillColor : cs.color)),
        opacity: o,
        vak: { x: Math.floor(vak.l), y: Math.floor(vak.t), w: Math.ceil(vak.r) - Math.floor(vak.l), h: Math.ceil(vak.b) - Math.floor(vak.t) },
      });
    }
    return uit;
  }, [wortelSels, uitsluiten, alleenLos]);
}

export async function neemFoto(page) {
  const png = await page.screenshot({ animations: 'disabled', caret: 'hide' });
  const beeld = leesPng(png);
  if (beeld.breed !== await page.evaluate(() => innerWidth)) throw new Error('de foto is niet op schaal 1');
  return beeld;
}

const LUM = Array.from({ length: 256 }, (_, i) => { const v = i / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
export const lumRgb = (r, g, b) => 0.2126 * LUM[Math.round(r)] + 0.7152 * LUM[Math.round(g)] + 0.0722 * LUM[Math.round(b)];

// Meet de tekst van de vlakken `wortelSels` (selectoren van het glas zelf; de tekst ligt er binnen) in het huidige beeld. `slechtste` is
// dezelfde verzamelaar als bij controleerKaarten ({ waarde, waar, perVenster }); `perVenster` is hier per eerste woord van het label.
// Geeft het aantal gemeten teksten terug (een lege meting is een fout van de test, geen succes).
export async function controleerVlakken(page, wortelSels, label, slechtste, { minimum = 1, uitsluiten = [], alleenLos = false } = {}) {
  await wachtOpFrames(page, 2);
  const teksten = await meetTeksten(page, wortelSels, uitsluiten, alleenLos);
  expect(teksten.length, `${label}: tekst gevonden in ${wortelSels.join(', ')}`).toBeGreaterThanOrEqual(minimum);
  const alle = wortelSels.join(', ');
  const stijlB = await page.addStyleTag({ content: `${DOORZICHTIG(wortelSels)} #event-laag, #toast, #spel-tik-toast { visibility: hidden !important; }` });
  let B, S = null;
  try {
    await wachtOpFrames(page, 2);
    B = await neemFoto(page);
    if (teksten.some((t) => t.opacity < 0.999)) {
      const stijlS = await page.addStyleTag({ content: `${alle} { visibility: hidden !important; }` });
      try { await wachtOpFrames(page, 2); S = await neemFoto(page); } finally { await stijlS.evaluate((el) => el.remove()); }
    }
  } finally { await stijlB.evaluate((el) => el.remove()); }
  for (const t of teksten) {
    const [tr, tg, tb, ta] = t.kleur, o = t.opacity;
    let min = Infinity, waar = null;
    for (let y = t.vak.y; y < t.vak.y + t.vak.h; y++) for (let x = t.vak.x; x < t.vak.x + t.vak.w; x++) {
      const b = B.kleur(x, y);
      let tekst = [tr * ta + b[0] * (1 - ta), tg * ta + b[1] * (1 - ta), tb * ta + b[2] * (1 - ta)], grond = b;
      if (o < 0.999) {
        const s = S.kleur(x, y);
        tekst = tekst.map((v, i) => o * v + (1 - o) * s[i]);
        grond = b.map((v, i) => o * v + (1 - o) * s[i]);
      }
      const l1 = lumRgb(...tekst), l2 = lumRgb(...grond), c = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      if (c < min) { min = c; waar = { x, y, tekst: tekst.map(Math.round), grond: grond.map(Math.round) }; }
    }
    const kleurTekst = t.kleur.map((v, i) => (i < 3 ? Math.round(v) : +v.toFixed(2)));
    const beschrijving = `${label} ${t.los ? '[los]' : '[glas]'} <${t.sel}> "${t.tekst}" tekst rgb(${waar.tekst}) op rgb(${waar.grond}) bij ${waar.x},${waar.y} (kleur ${kleurTekst}, opacity ${+t.opacity.toFixed(2)})`;
    if (min < slechtste.waarde) Object.assign(slechtste, { waarde: min, waar: beschrijving });
    const v = label.split(' ')[0];
    slechtste.perVenster[v] = Math.min(slechtste.perVenster[v] ?? Infinity, min);
    toets(min, beschrijving).toBeGreaterThanOrEqual(4.5);
  }
  return teksten.length;
}

// Losse tekst (taak 9b): alle zichtbare tekst van de pagina in het huidige beeld (body): die rechtstreeks op de hemel of de scène van een
// thema staat (kalender-uurlabels en dagkoppen, subtabs, lege staten) en die op een dun glasvlak zonder eigen tint (de kalender, de
// samenvatting van de route). Zelfde echte-pixelmethode als hierboven. `alleenLos`: enkel tekst zonder enig eigen vlak (zie `los` in
// meetTeksten; voor de scène van een thema, waar de accentkleuren van het pakket zelf op de knoppen komen). De routekaart (Leaflet, tegels en
// attributie van derden) en uitgeschakelde bediening (WCAG-uitzondering) tellen niet mee. Geeft { aantal } terug (de gemeten teksten).
export async function controleerLosseTekst(page, label, slechtste, { minimum = 1, alleenLos = false } = {}) {
  const uitsluiten = ['.leaflet-container', ':disabled', '[aria-disabled="true"]'];
  const aantal = await controleerVlakken(page, ['body'], label, slechtste, { minimum, uitsluiten, alleenLos });
  return { aantal };
}

// De kleuren van de reeksen in de legenda's (.swatch) tegen de kaart waarop ze liggen (de pixel vlak naast het blokje): geeft per kleur het
// contrast (niet-tekst, WCAG 1.4.11 vraagt 3:1). De grafiekkleuren zijn afgestemd op een effen ondergrond; dit is een meting, geen drempel.
export async function meetReeksen(page) {
  const blokjes = await page.evaluate(() => {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    return [...document.querySelectorAll('.dash-kaart .swatch')].map((el) => {
      const r = el.getBoundingClientRect();
      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = getComputedStyle(el).backgroundColor; ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return { naam: el.className.replace('swatch', '').trim(), kleur: [d[0], d[1], d[2]], x: Math.floor(r.left) - 4, y: Math.floor(r.top + r.height / 2), zichtbaar: r.top >= 0 && r.bottom <= innerHeight && r.left > 4 };
    }).filter((b) => b.zichtbaar);
  });
  if (!blokjes.length) return [];
  const beeld = await neemFoto(page);
  return blokjes.map((b) => {
    const g = beeld.kleur(b.x, b.y), l1 = lumRgb(...b.kleur), l2 = lumRgb(...g);
    return { naam: b.naam, kleur: b.kleur, grond: g, contrast: (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05) };
  });
}

// ── Themapakketten voor de proeven met een scène (versiering.spec.mjs en hemel-contrast.spec.mjs) ──
// Het voorgeladen pakket uit netlify/themas en de stub van /api/themas met een periode over de testklok (5 okt 2026).
export const leesPakket = (id) => JSON.parse(fs.readFileSync(new URL(`../netlify/themas/${id}.blitzthema.json`, import.meta.url), 'utf8'));
export function themaStub(p) {
  const periodeOverride = { van: { maand: 10, dag: 1 }, tot: { maand: 10, dag: 31 } };
  return ({ query }) => {
    if (query.get('id') !== null) return { status: 200, json: structuredClone(p) };
    return {
      status: 200,
      json: { versie: 1, themas: [{ id: p.id, naam: p.naam, aan: true, periode: p.periode, periodeOverride, pakketHash: `e2e-${p.id}` }], pakketten: { [p.id]: structuredClone(p) } },
    };
  };
}
