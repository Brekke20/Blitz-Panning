// Bronscan (v2.0.1): elke sticky balk onder de tabbladen gebruikt de gedeelde --sticky-top (sticky-offset.js), nooit een vaste top in px of een
// oude kop-variabele zonder de meldingsbalken. En de body heeft geen vaste hoogte: `height: 100%` maakte de body tot een sticky-bakje ter grootte van
// het scherm, waardoor de kop wegschoof terwijl de balken in de tabbladen bleven plakken (de strook tussen tabbalk en balk).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const lees = (p) => fs.readFileSync(path.join(PUBLIC, p), 'utf8');
const zonderCommentaar = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '');
const CSS = fs.readdirSync(path.join(PUBLIC, 'css')).filter(f => f.endsWith('.css')).map(f => ({ naam: 'css/' + f, tekst: zonderCommentaar(lees('css/' + f)) }));

// Alle declaratieblokken met position: sticky (CSS-bestanden en inline style="" in index.html).
function stickyBlokken() {
  const uit = [];
  for (const { naam, tekst } of CSS) {
    for (const m of tekst.matchAll(/([^{}]+)\{([^{}]*position:\s*sticky[^{}]*)\}/g)) uit.push({ naam, kiezer: m[1].trim().replace(/\s+/g, ' '), blok: m[2] });
  }
  const html = lees('index.html');
  for (const m of html.matchAll(/style="([^"]*position:\s*sticky[^"]*)"/g)) uit.push({ naam: 'index.html (inline)', kiezer: 'inline style', blok: m[1] });
  return uit;
}

test('de scan vindt de bekende sticky balken (zelftest)', () => {
  const kiezers = stickyBlokken().map(b => b.kiezer).join('\n');
  for (const k of ['.lijst-balk', '.kal-header', '.route-balk', '.gep-week', '.rapp-balk', '.topbar-sticky']) assert.ok(kiezers.includes(k), k + ' ontbreekt in de scan');
});

test('geen sticky balk met een vaste top in px: enkel var(--sticky-top), de kop zelf (top: 0) en de meldingsbalken onder de kop', () => {
  const fouten = [];
  for (const { naam, kiezer, blok } of stickyBlokken()) {
    if (/bottom\s*:/.test(blok) && !/(?<![\w-])top\s*:/.test(blok)) continue; // vastgeplakt onderaan (bewerkbalk Inventaris)
    const top = blok.match(/(?<![\w-])top\s*:\s*([^;]+)/);
    if (!top) { fouten.push(`${naam}: ${kiezer} is sticky zonder top`); continue; }
    const waarde = top[1].trim();
    const ok = /var\(--sticky-top\b/.test(waarde)
      || waarde === '0'
      || (/^(\.offline|#offline-banner|#outbox-banner)/.test(kiezer) && /--topbar-h/.test(waarde)); // meldingsbalken: plakken zelf direct onder de kop
    if (!ok) fouten.push(`${naam}: ${kiezer} heeft top: ${waarde}`);
  }
  assert.deepEqual(fouten, []);
});

test('sticky top: 0 staat enkel op de kop zelf en op elementen in een eigen scrollbak (dagkop van de tijdlijn, venstertitel)', () => {
  const toegestaan = ['.topbar-sticky', '.week-grid.tl-mode .day-hdr', '.mhdr'];
  const fouten = [];
  for (const { naam, kiezer, blok } of stickyBlokken()) {
    const top = blok.match(/(?<![\w-])top\s*:\s*([^;]+)/);
    if (top && top[1].trim() === '0' && !toegestaan.includes(kiezer)) fouten.push(`${naam}: ${kiezer}`);
  }
  assert.deepEqual(fouten, []);
});

test('de body heeft min-height in plaats van een vaste hoogte (sticky-bakje van de kop)', () => {
  const base = CSS.find(c => c.naam === 'css/base.css').tekst;
  assert.doesNotMatch(base, /html\s*,\s*body\s*\{[^}]*\bheight\s*:\s*100%/, 'html, body { height: 100% } laat de kop wegschuiven');
  const body = [...base.matchAll(/([^{}]+)\{([^}]*)\}/g)].find(m => m[1].trim() === 'body');
  assert.ok(body && /min-height\s*:\s*100%/.test(body[2]) && !/(?<![\w-])height\s*:/.test(body[2]), 'body: min-height: 100% en geen height');
});

test('sticky-offset.js bewaakt kop, tabbalk en meldingsbalken en zet --sticky-top', () => {
  const js = lees('js/sticky-offset.js');
  for (const s of ['--topbar-h', '--banners-h', '--sticky-top', 'ResizeObserver', '.topbar-sticky', 'offline-banner', 'outbox-banner']) assert.ok(js.includes(s), s + ' ontbreekt');
});
