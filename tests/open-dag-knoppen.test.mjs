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

// Taak 8a (Ruling 9): de glans bij hover enkel met een echte muis; op aanraking blijft hij anders na een tik hangen.
// Geeft per voorkomen van `needle` de omhullende @media-voorwaarden (buiten naar binnen).
function omhullendeMedia(css, needle) {
  const schoon = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const uit = [];
  const stapel = [];
  let start = 0;
  for (let i = 0; i < schoon.length; i++) {
    const c = schoon[i];
    if (c === '{') { stapel.push(schoon.slice(start, i).trim()); start = i + 1; }
    else if (c === '}') { stapel.pop(); start = i + 1; }
    else if (c === ';') start = i + 1;
    if (schoon.startsWith(needle, i)) uit.push(stapel.filter((s) => s.startsWith('@media')));
  }
  return uit;
}

test('de glans-hoverregel (:hover::before) staat enkel binnen @media (hover: hover)', () => {
  const app = readFileSync(new URL('app.css', MAP), 'utf8');
  const voorkomens = omhullendeMedia(app, ':hover::before');
  assert.ok(voorkomens.length >= 1, 'geen :hover::before gevonden');
  for (const media of voorkomens) {
    assert.ok(media.some((m) => /\(hover:\s*hover\)/.test(m)), ':hover::before buiten @media (hover: hover): ' + JSON.stringify(media));
  }
});

test('Ruling 8: ook chips en legacy knoppen krijgen de glans', () => {
  const app = readFileSync(new URL('app.css', MAP), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const m = app.match(/:where\(([^)]*)\)::before\s*\{[^}]*radial-gradient/);
  assert.ok(m, 'gedeelde glansregel niet gevonden');
  const lijst = m[1].split(',').map((s) => s.trim());
  // Open dag (v2.5.0, taak 8b): '.filter-pill' is weg; de klasse stond nergens in public/ in gebruik (enkel in de stijl).
  for (const sel of ['.sico', '.gep-week button', '.kal-pending-pill', '.day-btn', '.btn-primary', '.btn-save', '.btn-autoplan', '.btn-add', '.btn-sec', '.btn-cancel']) {
    assert.ok(lijst.includes(sel), `${sel} ontbreekt in de glansregel`);
  }
});

// Taak 8b: elke zuivere hover-kleurregel staat in @media (hover: hover); op een aanraaktoestel blijft :hover na een tik hangen (Ruling 9).
// Gemengde selectorlijsten (hover én focus, zoals de grafiekpunten in dashboard.css) tellen niet mee: die zijn ook voor het toetsenbord.
test('elke zuivere :hover-regel in public/css/*.css staat in @media (hover: hover)', () => {
  const overtreders = [];
  for (const f of readdirSync(MAP).filter((n) => n.endsWith('.css'))) {
    const css = readFileSync(new URL(f, MAP), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const media = []; // de lopende @-regels bij elke open accolade
    let start = 0;
    for (let i = 0; i < css.length; i++) {
      const c = css[i];
      if (c === '{') {
        const kop = css.slice(start, i).trim();
        if (!kop.startsWith('@') && /:hover/.test(kop)
          && kop.split(/,(?![^(]*\))/).every((d) => /:hover/.test(d))
          && !media.some((m) => /\(hover:\s*hover\)/.test(m))) overtreders.push(`${f}: ${kop.replace(/\s+/g, ' ').slice(0, 90)}`);
        media.push(kop);
        start = i + 1;
      } else if (c === '}') { media.pop(); start = i + 1; }
      else if (c === ';' ) { if (!media.length) start = i + 1; }
    }
  }
  assert.deepEqual(overtreders, [], 'hover-regel buiten @media (hover: hover):\n' + overtreders.join('\n'));
});
