// Open dag-stijl, taak 4: knoppen vervagen met glans. Geen enkele hover- of active-regel verplaatst of schaalt nog iets;
// het gedrag (glans, vervaging) bewijst e2e/knoppen-glans.spec.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const MAP = new URL('../public/css/', import.meta.url);

// Eenvoudige regelsplitsing: commentaar weg, dan per "selector { blok }" (ook binnen @media).
function regels(css) {
  const schoon = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const uit = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(schoon))) uit.push({ selector: m[1].trim(), blok: m[2] });
  return uit;
}

test('geen hover- of active-regel in public/css/*.css zet een transform (behalve none)', () => {
  const overtreders = [];
  for (const f of readdirSync(MAP).filter((n) => n.endsWith('.css'))) {
    for (const { selector, blok } of regels(readFileSync(new URL(f, MAP), 'utf8'))) {
      if (!/:(hover|active)\b/.test(selector)) continue;
      for (const d of blok.split(';')) {
        const m = d.match(/^\s*transform\s*:\s*([^!]+?)\s*(!important)?\s*$/);
        if (m && m[1] !== 'none') overtreders.push(`${f}: ${selector.replace(/\s+/g, ' ')} -> transform: ${m[1]}`);
      }
    }
  }
  assert.deepEqual(overtreders, [], 'hover/active met transform:\n' + overtreders.join('\n'));
});

test('de glans: één gedeelde regel met radial-gradient, opacity 0 naar 1 bij hover, duur-glans', () => {
  const app = readFileSync(new URL('app.css', MAP), 'utf8');
  assert.match(app, /radial-gradient\(120% 140% at 50% -20%, rgba\(255,\s*255,\s*255,\s*\.45\), transparent 60%\)/);
  assert.match(app, /transition:\s*opacity var\(--duur-glans\) ease/);
  assert.match(app, /:hover::before[^{]*\{\s*opacity:\s*1/);
});
