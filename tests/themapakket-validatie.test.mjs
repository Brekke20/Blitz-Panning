// tests/themapakket-validatie.test.mjs — kern/themapakket-validatie.js: de poort die elk themapakket (enkel gegevens) moet passeren.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  valideerPakket, contrastVerhouding,
  MAX_PAKKET_BYTES, MAX_BEELD_BYTES, MAX_ELEMENTEN, MAX_BEWEGEND, PLAFONDS, BEWEGINGEN, DEEL_SOORTEN,
} from '../public/js/kern/themapakket-validatie.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const JPEG_BYTES = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1];
const WEBP_BYTES = [...Buffer.from('RIFF'), 0x1a, 0, 0, 0, ...Buffer.from('WEBPVP8 '), 0, 0, 0, 0];

// Het kleinste geldige pakket (zoals de spec).
const basis = () => ({
  formaat: 1,
  id: 'halloween',
  naam: 'Halloween',
  versie: '2026-10-22',
  periode: { van: { maand: 10, dag: 1 }, tot: { maand: 10, dag: 31 } },
  kleuren: { donker: { accent: '#f97316' } },
  vormen: { spin: { viewBox: '0 0 24 24', delen: [{ soort: 'path', d: 'M12 2 L22 22 H2 Z', vul: '#1a1a1a' }] } },
  versiering: [{ beweging: 'hoek', beeld: 'spin', hoeken: ['lb', 'rb'] }],
  spelskin: { naam: 'Spookpaal', behuizing: '#2a1840', faceplate: '#ff7a00', bliksem: '#ffe9c2' },
});
const met = (wijzig) => { const p = basis(); wijzig(p); return p; };

const velden = (r) => r.fouten.map((f) => f.veld);
function weiger(pakket, veld, opties) {
  const r = valideerPakket(pakket, opties);
  assert.equal(r.ok, false, `verwacht een weigering voor ${veld}`);
  assert.ok(Array.isArray(r.fouten) && r.fouten.length > 0);
  for (const f of r.fouten) assert.ok(typeof f.veld === 'string' && typeof f.fout === 'string' && f.fout.length > 0);
  assert.ok(velden(r).includes(veld), `veld ${veld} ontbreekt in ${JSON.stringify(velden(r))}`);
  return r;
}

test('constanten volgen de spec', () => {
  assert.equal(MAX_PAKKET_BYTES, 524288);
  assert.equal(MAX_BEELD_BYTES, 204800);
  assert.equal(MAX_ELEMENTEN, 8);
  assert.equal(MAX_BEWEGEND, 16);
  assert.deepEqual(PLAFONDS, { hoek: 4, hangen: 3, kruipen: 1, vliegen: 2, vallen: 12, opstijgen: 8, vuurwerk: 1, mist: 1 });
  assert.deepEqual(BEWEGINGEN, Object.keys(PLAFONDS));
  assert.deepEqual(DEEL_SOORTEN, ['path', 'circle', 'ellipse', 'rect', 'polygon', 'line', 'groep']);
});

test('het minimale geldige pakket is ok en komt als diepe kopie terug', () => {
  const invoer = basis();
  const r = valideerPakket(invoer);
  assert.equal(r.ok, true);
  assert.deepEqual(r.pakket, invoer);
  assert.notEqual(r.pakket, invoer);
  assert.notEqual(r.pakket.vormen.spin.delen[0], invoer.vormen.spin.delen[0]);
});

test('een rijk pakket (beelden, achtergrond, teksten, verlopen, groepen, alle bewegingen) is ok', () => {
  const p = basis();
  p.kleuren = {
    donker: { accent: '#f97316', accentHover: '#fb923c', accentDim: '#f973161f', accentGlow: '#f9731638', opAccent: '#0b0b14' },
    licht: { accent: '#c2570c', accentDim: '#c2570c1f', accentGlow: '#c2570c38' },
    voorkeurThema: 'donker',
  };
  p.vormen.scene = {
    viewBox: '0 0 1600 900',
    delen: [
      { soort: 'rect', x: 0, y: 0, width: 1600, height: 900, vul: { verloop: 'lineair', x1: 0, y1: 0, x2: 0, y2: 1, stops: [{ op: 0, kleur: '#112233' }, { op: 1, kleur: '#445566' }] } },
      { soort: 'circle', cx: 800, cy: 100, r: 40, vul: { verloop: 'radiaal', cx: 0.5, cy: 0.5, r: 0.5, stops: [{ op: 0, kleur: '#ffffffff' }, { op: 1, kleur: '#ffffff00' }] }, dekking: 0.8 },
      { soort: 'ellipse', cx: 1, cy: 2, rx: 3, ry: 4, lijn: '#ffffff', lijnDikte: 2 },
      { soort: 'polygon', points: '0,0 10,0 5,10', vul: 'geen', lijn: '#fff000' },
      { soort: 'line', x1: 0, y1: 0, x2: 5, y2: 5, lijn: '#ffffff' },
      { soort: 'groep', transform: 'translate(10 20) rotate(45) scale(2)', delen: [{ soort: 'path', d: 'M0 0L5 5', transform: 'translate(1,1)' }] },
    ],
  };
  p.beelden = { pompoen: PNG, vleermuis: `data:image/jpeg;base64,${b64(JPEG_BYTES)}`, web: `data:image/webp;base64,${b64(WEBP_BYTES)}` };
  p.achtergrond = { vorm: 'scene', kijkvensterStaand: '820 0 780 900', dekkingLicht: 0.2 };
  p.versiering = [
    { beweging: 'hoek', beeld: 'web', hoeken: ['lb', 'rb', 'lo', 'ro'] },
    { beweging: 'hangen', beeld: 'spin', aantal: 2 },
    { beweging: 'kruipen', beeld: 'spin', aantal: 1, langs: 'tabbalk' },
    { beweging: 'vliegen', beeld: 'vleermuis', aantal: 1 },
    { beweging: 'vallen', beeld: 'pompoen', aantal: 6, wiebel: 0.5 },
    { beweging: 'opstijgen', beeld: 'pompoen', aantal: 2 },
    { beweging: 'vuurwerk', frequentie: 0.3 },
    { beweging: 'mist' },
  ];
  p.teksten = { wachtrijLeeg: 'Geen spoken in de wachtrij.', ingeplandLeeg: 'Geen spookbezoeken gepland deze week' };
  p.spelskin = { naam: 'Spookpaal', behuizing: '#2a1840', faceplate: '#ff7a00', bliksem: '#ffe9c2', rand: '#e9f2f8', extra: 'spin' };
  p.periode = { basis: 'pasen', van: -7, tot: 1 };
  const r = valideerPakket(p);
  assert.deepEqual(r.fouten, undefined, JSON.stringify(r.fouten));
  assert.equal(r.ok, true);
  assert.deepEqual(r.pakket, p);
});

test('geen object: pakket is geen JSON-object', () => {
  for (const x of [null, undefined, 3, 'tekst', [], [basis()]]) weiger(x, 'pakket');
});

test('onbekende sleutel op topniveau en dieper wordt geweigerd', () => {
  weiger(met((p) => { p.onbekend = 1; }), 'onbekend');
  weiger(met((p) => { p.periode.extra = 1; }), 'periode.extra');
  weiger(met((p) => { p.kleuren.donker.nep = '#ffffff'; }), 'kleuren.donker.nep');
  weiger(met((p) => { p.vormen.spin.script = 'x'; }), 'vormen.spin.script');
  weiger(met((p) => { p.vormen.spin.delen[0].onclick = 'x'; }), 'vormen.spin.delen[0].onclick');
  weiger(met((p) => { p.vormen.spin.delen[0].href = 'x'; }), 'vormen.spin.delen[0].href');
  weiger(met((p) => { p.versiering[0].style = 'x'; }), 'versiering[0].style');
  weiger(met((p) => { p.spelskin.html = 'x'; }), 'spelskin.html');
  weiger(met((p) => { p.teksten = { vreemd: 'x' }; }), 'teksten.vreemd');
  weiger(met((p) => { p.achtergrond = { vorm: 'spin', fout: 1 }; }), 'achtergrond.fout');
});

test('een deel mag enkel de geometrie van zijn eigen soort hebben', () => {
  weiger(met((p) => { p.vormen.spin.delen[0] = { soort: 'circle', cx: 1, cy: 1, r: 1, d: 'M0 0' }; }), 'vormen.spin.delen[0].d');
  weiger(met((p) => { p.vormen.spin.delen[0] = { soort: 'circle', cx: 1, cy: 1 }; }), 'vormen.spin.delen[0].r');
  weiger(met((p) => { p.vormen.spin.delen[0] = { soort: 'foreignObject' }; }), 'vormen.spin.delen[0].soort');
  weiger(met((p) => { p.vormen.spin.delen[0] = { soort: 'script', d: 'M0 0' }; }), 'vormen.spin.delen[0].soort');
});

test('formaat moet 1 zijn', () => {
  weiger(met((p) => { p.formaat = 2; }), 'formaat');
  weiger(met((p) => { delete p.formaat; }), 'formaat');
  weiger(met((p) => { p.formaat = '1'; }), 'formaat');
});

test('id: enkel [a-z0-9-]{2,30}, geen proto-vervuiling', () => {
  weiger(met((p) => { p.id = 'Halloween!'; }), 'id');
  weiger(met((p) => { p.id = '__proto__'; }), 'id');
  weiger(met((p) => { p.id = 'a'; }), 'id');
  weiger(met((p) => { p.id = 'a'.repeat(31); }), 'id');
  weiger(met((p) => { p.id = 'constructor '; }), 'id');
  weiger(met((p) => { p.id = 'ok\n'; }), 'id');
  weiger(met((p) => { delete p.id; }), 'id');
  assert.equal(valideerPakket(met((p) => { p.id = 'ab'; })).ok, true);
  assert.equal(valideerPakket(met((p) => { p.id = 'x'.repeat(30); })).ok, true);
});

test('naam en versie: verplicht, begrensde lengte, platte tekst', () => {
  weiger(met((p) => { p.naam = ''; }), 'naam');
  weiger(met((p) => { p.naam = 'n'.repeat(41); }), 'naam');
  weiger(met((p) => { p.naam = 5; }), 'naam');
  weiger(met((p) => { p.naam = 'a\u0000b'; }), 'naam');
  weiger(met((p) => { p.versie = 'v'.repeat(21); }), 'versie');
  weiger(met((p) => { delete p.versie; }), 'versie');
  assert.equal(valideerPakket(met((p) => { p.naam = 'n'.repeat(40); })).ok, true);
});

test('__proto__ als eigen sleutel (uit JSON.parse) wordt geweigerd en vervuilt niets', () => {
  const p = JSON.parse('{"__proto__":{"vervuild":true},"formaat":1}');
  weiger(p, '__proto__');
  assert.equal({}.vervuild, undefined);
  const q = basis();
  q.vormen = JSON.parse('{"__proto__":{"viewBox":"0 0 1 1","delen":[]}}');
  weiger(q, 'vormen.__proto__');
  assert.equal({}.viewBox, undefined);
  const r = basis();
  r.beelden = JSON.parse('{"constructor":"x"}');
  weiger(r, 'beelden.constructor');
});

test('periode: vast en beweeglijk, met bestaande dagen', () => {
  const vast = (v, t) => met((p) => { p.periode = { van: v, tot: t }; });
  assert.equal(valideerPakket(vast({ maand: 12, dag: 1 }, { maand: 1, dag: 6 })).ok, true);
  assert.equal(valideerPakket(vast({ maand: 2, dag: 28 }, { maand: 2, dag: 28 })).ok, true);
  weiger(vast({ maand: 2, dag: 29 }, { maand: 3, dag: 1 }), 'periode.van.dag');
  weiger(vast({ maand: 1, dag: 1 }, { maand: 2, dag: 30 }), 'periode.tot.dag');
  weiger(vast({ maand: 1, dag: 1 }, { maand: 2, dag: 31 }), 'periode.tot.dag');
  weiger(vast({ maand: 4, dag: 31 }, { maand: 5, dag: 1 }), 'periode.van.dag');
  weiger(vast({ maand: 6, dag: 31 }, { maand: 7, dag: 1 }), 'periode.van.dag');
  weiger(vast({ maand: 9, dag: 31 }, { maand: 10, dag: 1 }), 'periode.van.dag');
  weiger(vast({ maand: 11, dag: 31 }, { maand: 12, dag: 1 }), 'periode.van.dag');
  weiger(vast({ maand: 13, dag: 1 }, { maand: 12, dag: 1 }), 'periode.van.maand');
  weiger(vast({ maand: 0, dag: 1 }, { maand: 12, dag: 1 }), 'periode.van.maand');
  weiger(vast({ maand: 1, dag: 0 }, { maand: 12, dag: 1 }), 'periode.van.dag');
  weiger(vast({ maand: 1, dag: 1.5 }, { maand: 12, dag: 1 }), 'periode.van.dag');
  weiger(vast({ maand: '1', dag: 1 }, { maand: 12, dag: 1 }), 'periode.van.maand');
  weiger(vast({ maand: 1, dag: 1 }, undefined), 'periode.tot');
  const pasen = (van, tot, basisNaam = 'pasen') => met((p) => { p.periode = { basis: basisNaam, van, tot }; });
  assert.equal(valideerPakket(pasen(-60, 60)).ok, true);
  assert.equal(valideerPakket(pasen(3, 3)).ok, true);
  weiger(pasen(-61, 0), 'periode.van');
  weiger(pasen(0, 61), 'periode.tot');
  weiger(pasen(2, 1), 'periode.tot');
  weiger(pasen(0.5, 1), 'periode.van');
  weiger(pasen(0, 1, 'kerstmis'), 'periode.basis');
  weiger(met((p) => { delete p.periode; }), 'periode');
  weiger(met((p) => { p.periode = 'altijd'; }), 'periode');
});

test('kleuren: enkel #rrggbb of #rrggbbaa', () => {
  const kleur = (c) => met((p) => { p.kleuren.donker.accent = c; });
  for (const goed of ['#000000', '#FFFFFF', '#f973161f']) assert.equal(valideerPakket(kleur(goed)).ok, true, goed);
  for (const slecht of ['red', 'javascript:alert(1)', '#fff', '#12345', '#1234567', '#ggg000', 'rgb(0,0,0)', 'url(#x)', '#ffffff;x', '#ffffff\n', 5, null]) {
    weiger(kleur(slecht), 'kleuren.donker.accent');
  }
  weiger(met((p) => { p.kleuren.voorkeurThema = 'blauw'; }), 'kleuren.voorkeurThema');
  assert.equal(valideerPakket(met((p) => { p.kleuren.voorkeurThema = null; })).ok, true);
  assert.equal(valideerPakket(met((p) => { p.kleuren.voorkeurThema = 'licht'; })).ok, true);
  weiger(met((p) => { p.kleuren.donker = {}; }), 'kleuren.donker.accent');
  weiger(met((p) => { delete p.kleuren; }), 'kleuren');
});

test('vormen: viewBox, d-tekenset, getallen, vulling', () => {
  weiger(met((p) => { p.vormen.spin.delen[0].d = 'M0 0 <script>'; }), 'vormen.spin.delen[0].d');
  weiger(met((p) => { p.vormen.spin.delen[0].d = 'M0 0 url(x)'; }), 'vormen.spin.delen[0].d');
  weiger(met((p) => { p.vormen.spin.delen[0].d = ''; }), 'vormen.spin.delen[0].d');
  weiger(met((p) => { p.vormen.spin.delen[0].d = 'M0 0 ' + '1 '.repeat(10001); }), 'vormen.spin.delen[0].d');
  weiger(met((p) => { p.vormen.spin.delen[0].d = 'M0 0 L1e999 5'; }), 'vormen.spin.delen[0].d');
  weiger(met((p) => { p.vormen.spin.delen[0].d = 'M0 0 L9999999 5'; }), 'vormen.spin.delen[0].d');
  weiger(met((p) => { p.vormen.spin.delen[0].d = 5; }), 'vormen.spin.delen[0].d');
  weiger(met((p) => { p.vormen.spin.viewBox = '0 0 24'; }), 'vormen.spin.viewBox');
  weiger(met((p) => { p.vormen.spin.viewBox = '0 0 0 24'; }), 'vormen.spin.viewBox');
  weiger(met((p) => { p.vormen.spin.viewBox = '0 0 24 24" onload="x'; }), 'vormen.spin.viewBox');
  weiger(met((p) => { p.vormen.spin.delen[0].vul = 'url(#x)'; }), 'vormen.spin.delen[0].vul');
  weiger(met((p) => { p.vormen.spin.delen[0].lijn = 'red'; }), 'vormen.spin.delen[0].lijn');
  weiger(met((p) => { p.vormen.spin.delen[0].dekking = 2; }), 'vormen.spin.delen[0].dekking');
  weiger(met((p) => { p.vormen.spin.delen[0].lijnDikte = -1; }), 'vormen.spin.delen[0].lijnDikte');
  weiger(met((p) => { p.vormen.spin.delen[0] = { soort: 'circle', cx: NaN, cy: 0, r: 1 }; }), 'vormen.spin.delen[0].cx');
  weiger(met((p) => { p.vormen.spin.delen[0] = { soort: 'circle', cx: '5', cy: 0, r: 1 }; }), 'vormen.spin.delen[0].cx');
  weiger(met((p) => { p.vormen.spin.delen[0] = { soort: 'circle', cx: 0, cy: 0, r: -1 }; }), 'vormen.spin.delen[0].r');
  weiger(met((p) => { p.vormen.spin.delen[0] = { soort: 'polygon', points: '0,0 <x>' }; }), 'vormen.spin.delen[0].points');
  weiger(met((p) => { p.vormen.spin.delen = 'nee'; }), 'vormen.spin.delen');
  weiger(met((p) => { p.vormen.spin.delen = []; }), 'vormen.spin.delen');
  assert.equal(valideerPakket(met((p) => { p.vormen = {}; p.beelden = { b: PNG }; p.versiering = [{ beweging: 'hoek', beeld: 'b', hoeken: ['lb'] }]; p.spelskin.extra = undefined; delete p.spelskin.extra; })).ok, true);
  weiger(met((p) => { delete p.vormen; }), 'vormen');
  weiger(met((p) => { p.vormen.Spin = p.vormen.spin; }), 'vormen.Spin');
});

test('verloop: soort, stops (max 8, op 0..1, kleur) en eigen sleutels', () => {
  const verloop = (v) => met((p) => { p.vormen.spin.delen[0].vul = v; });
  const stops = [{ op: 0, kleur: '#000000' }, { op: 1, kleur: '#ffffff' }];
  assert.equal(valideerPakket(verloop({ verloop: 'lineair', stops })).ok, true);
  weiger(verloop({ verloop: 'conisch', stops }), 'vormen.spin.delen[0].vul.verloop');
  weiger(verloop({ verloop: 'lineair', stops: [] }), 'vormen.spin.delen[0].vul.stops');
  weiger(verloop({ verloop: 'lineair', stops: Array.from({ length: 9 }, (_, i) => ({ op: i / 9, kleur: '#000000' })) }), 'vormen.spin.delen[0].vul.stops');
  weiger(verloop({ verloop: 'lineair', stops: [{ op: 2, kleur: '#000000' }] }), 'vormen.spin.delen[0].vul.stops[0].op');
  weiger(verloop({ verloop: 'lineair', stops: [{ op: 0, kleur: 'red' }] }), 'vormen.spin.delen[0].vul.stops[0].kleur');
  weiger(verloop({ verloop: 'lineair', stops: [{ op: 0, kleur: '#000000', href: 'x' }] }), 'vormen.spin.delen[0].vul.stops[0].href');
  weiger(verloop({ verloop: 'lineair', stops, r: 1 }), 'vormen.spin.delen[0].vul.r');
  weiger(verloop({ verloop: 'radiaal', stops, x1: 1 }), 'vormen.spin.delen[0].vul.x1');
  weiger(verloop({ verloop: 'lineair', stops, x1: 'a' }), 'vormen.spin.delen[0].vul.x1');
});

test('transform: enkel translate, rotate en scale met getallen', () => {
  const tr = (t) => met((p) => { p.vormen.spin.delen[0].transform = t; });
  weiger(tr('url(x)'), 'vormen.spin.delen[0].transform');
  weiger(tr('matrix(1 0 0 1 0 0)'), 'vormen.spin.delen[0].transform');
  weiger(tr('translate(1 2) url(x)'), 'vormen.spin.delen[0].transform');
  weiger(tr('translate(1 2);'), 'vormen.spin.delen[0].transform');
  weiger(tr('translate(' + '1'.repeat(300) + ')'), 'vormen.spin.delen[0].transform');
  weiger(tr(''), 'vormen.spin.delen[0].transform');
  assert.equal(valideerPakket(tr('translate(1.5, -2) rotate(45) scale(0.5)')).ok, true);
});

test('groep: één niveau diep, met delen en optionele transform', () => {
  const groep = (delen, extra = {}) => met((p) => { p.vormen.spin.delen = [{ soort: 'groep', delen, ...extra }]; });
  const pad = { soort: 'path', d: 'M0 0L1 1' };
  assert.equal(valideerPakket(groep([pad, pad])).ok, true);
  weiger(groep([{ soort: 'groep', delen: [pad] }]), 'vormen.spin.delen[0].delen[0].soort');
  weiger(groep([pad], { vul: '#000000' }), 'vormen.spin.delen[0].vul');
  weiger(groep('x'), 'vormen.spin.delen[0].delen');
  weiger(groep([pad], { transform: 'url(x)' }), 'vormen.spin.delen[0].transform');
});

test('te veel delen: 401 in één vorm, 3001 in het pakket', () => {
  const pad = { soort: 'path', d: 'M0 0L1 1' };
  weiger(met((p) => { p.vormen.spin.delen = Array.from({ length: 401 }, () => pad); }), 'vormen.spin.delen');
  assert.equal(valideerPakket(met((p) => { p.vormen.spin.delen = Array.from({ length: 400 }, () => pad); })).ok, true);
  // groepskinderen tellen mee
  weiger(met((p) => { p.vormen.spin.delen = [{ soort: 'groep', delen: Array.from({ length: 400 }, () => pad) }]; }), 'vormen.spin.delen');
  const veel = met((p) => {
    for (let i = 0; i < 8; i++) p.vormen[`v${i}`] = { viewBox: '0 0 1 1', delen: Array.from({ length: 400 }, () => pad) };
  });
  weiger(veel, 'vormen');
});

test('beelden: enkel png, webp en jpeg met kloppende magic bytes', () => {
  const beeld = (s) => met((p) => { p.beelden = { b: s }; });
  const veld = 'beelden.b';
  assert.equal(valideerPakket(beeld(PNG)).ok, true);
  assert.equal(valideerPakket(beeld(`data:image/jpeg;base64,${b64(JPEG_BYTES)}`)).ok, true);
  assert.equal(valideerPakket(beeld(`data:image/webp;base64,${b64(WEBP_BYTES)}`)).ok, true);
  weiger(beeld('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4='), veld);
  weiger(beeld('data:image/svg+xml;utf8,<svg/>'), veld);
  weiger(beeld('data:image/gif;base64,R0lGODlhAQABAAAAACw='), veld);
  weiger(beeld('https://example.com/a.png'), veld);
  weiger(beeld('javascript:alert(1)'), veld);
  weiger(beeld(''), veld);
  weiger(beeld(5), veld);
  // PNG-type maar JPEG-bytes, en andere kruiscombinaties
  weiger(beeld(`data:image/png;base64,${b64(JPEG_BYTES)}`), veld);
  weiger(beeld(`data:image/jpeg;base64,${PNG.split(',')[1]}`), veld);
  weiger(beeld(`data:image/webp;base64,${PNG.split(',')[1]}`), veld);
  weiger(beeld(`data:image/webp;base64,${b64([...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WAVEfmt '), 0, 0, 0, 0])}`), veld);
  weiger(beeld(`data:image/png;base64,${b64([0x89, 0x50, 0x4e, 0x47])}`), veld);
  weiger(beeld('data:image/png;base64,iVBORw0KGgo@@@@'), veld);
  weiger(beeld('data:image/png;base64,iVBORw0KGgoAAAANSU'), veld); // 18 tekens: geen veelvoud van 4
  weiger(beeld(PNG + ' '), veld);
  weiger(beeld(PNG + '\n<script>'), veld);
  weiger(met((p) => { p.beelden = { 'b/..': PNG }; }), 'beelden.b/..');
});

test('beeld groter dan 200 kB wordt geweigerd, 200 kB zelf niet', () => {
  const groot = (bytes) => `data:image/png;base64,${b64([0x89, 0x50, 0x4e, 0x47, ...new Uint8Array(bytes - 4)])}`;
  weiger(met((p) => { p.beelden = { b: groot(MAX_BEELD_BYTES + 1) }; }), 'beelden.b');
  // ver boven de grens: valt af vóór er iets gedecodeerd wordt (tekstLengte omzeilt hier de pakketgrens)
  weiger(met((p) => { p.beelden = { b: groot(MAX_BEELD_BYTES * 3) }; }), 'beelden.b', { tekstLengte: 1 });
  weiger(met((p) => { p.beelden = { b: groot(MAX_BEELD_BYTES + 5000) }; }), 'beelden.b');
  assert.equal(valideerPakket(met((p) => { p.beelden = { b: groot(MAX_BEELD_BYTES) }; })).ok, true);
});

test('vormen en beelden delen één naamruimte', () => {
  weiger(met((p) => { p.beelden = { spin: PNG }; }), 'beelden.spin');
});

test('versiering: maximaal 8 elementen', () => {
  const el = { beweging: 'hoek', beeld: 'spin', hoeken: ['lb'] };
  const acht = [
    ...['lb', 'rb', 'lo', 'ro'].map((h) => ({ beweging: 'hoek', beeld: 'spin', hoeken: [h] })),
    { beweging: 'hangen', beeld: 'spin', aantal: 1 },
    { beweging: 'vliegen', beeld: 'spin', aantal: 1 },
    { beweging: 'vliegen', beeld: 'spin', aantal: 1 },
    { beweging: 'opstijgen', beeld: 'spin', aantal: 1 },
  ];
  assert.equal(acht.length, 8);
  assert.equal(valideerPakket(met((p) => { p.versiering = structuredClone(acht); })).ok, true);
  weiger(met((p) => { p.versiering = [...structuredClone(acht), { ...el }]; }), 'versiering');
  weiger(met((p) => { p.versiering = {}; }), 'versiering');
  weiger(met((p) => { delete p.versiering; }), 'versiering');
});

test('versiering: elementen volgen hun bewegingsschema', () => {
  const zet = (el) => met((p) => { p.versiering = [el]; });
  weiger(zet({ beweging: 'teleporteren', beeld: 'spin' }), 'versiering[0].beweging');
  weiger(zet({ beweging: 'hoek', beeld: 'spin', hoeken: [] }), 'versiering[0].hoeken');
  weiger(zet({ beweging: 'hoek', beeld: 'spin', hoeken: ['lb', 'lb'] }), 'versiering[0].hoeken');
  weiger(zet({ beweging: 'hoek', beeld: 'spin', hoeken: ['midden'] }), 'versiering[0].hoeken[0]');
  weiger(zet({ beweging: 'hoek', beeld: 'spin' }), 'versiering[0].hoeken');
  weiger(zet({ beweging: 'hoek', beeld: 'spin', hoeken: ['lb'], aantal: 1 }), 'versiering[0].aantal');
  weiger(zet({ beweging: 'hangen', beeld: 'spin' }), 'versiering[0].aantal');
  weiger(zet({ beweging: 'hangen', beeld: 'spin', aantal: 0 }), 'versiering[0].aantal');
  weiger(zet({ beweging: 'hangen', beeld: 'spin', aantal: 1.5 }), 'versiering[0].aantal');
  weiger(zet({ beweging: 'hangen', beeld: 'spin', aantal: 4 }), 'versiering[0].aantal');
  weiger(zet({ beweging: 'hangen', beeld: 'spin', aantal: 1, langs: 'tabbalk' }), 'versiering[0].langs');
  weiger(zet({ beweging: 'kruipen', beeld: 'spin', aantal: 1, langs: 'rand' }), 'versiering[0].langs');
  weiger(zet({ beweging: 'kruipen', beeld: 'spin', aantal: 2 }), 'versiering[0].aantal');
  weiger(zet({ beweging: 'vallen', beeld: 'spin', aantal: 13 }), 'versiering[0].aantal');
  weiger(zet({ beweging: 'vallen', beeld: 'spin', aantal: 5, wiebel: 'ja' }), 'versiering[0].wiebel');
  weiger(zet({ beweging: 'opstijgen', beeld: 'spin', aantal: 9 }), 'versiering[0].aantal');
  weiger(zet({ beweging: 'vliegen', beeld: 'spin', aantal: 3 }), 'versiering[0].aantal');
  weiger(zet({ beweging: 'vuurwerk', frequentie: 5 }), 'versiering[0].frequentie');
  weiger(zet({ beweging: 'vuurwerk', beeld: 'spin' }), 'versiering[0].beeld');
  weiger(zet({ beweging: 'mist', aantal: 2 }), 'versiering[0].aantal');
  weiger(zet({ beweging: 'hangen', aantal: 1 }), 'versiering[0].beeld');
  weiger(zet('hangen'), 'versiering[0]');
  assert.equal(valideerPakket(zet({ beweging: 'vallen', beeld: 'spin', aantal: 12 })).ok, true);
});

test('versiering: een beeld moet bestaan in vormen of beelden', () => {
  weiger(met((p) => { p.versiering[0].beeld = 'bestaatniet'; }), 'versiering[0].beeld');
  weiger(met((p) => { p.versiering[0].beeld = '__proto__'; }), 'versiering[0].beeld');
  weiger(met((p) => { p.versiering[0].beeld = 'toString'; }), 'versiering[0].beeld');
  weiger(met((p) => { p.versiering[0].beeld = 'constructor'; }), 'versiering[0].beeld');
  const m = met((p) => { p.beelden = { pompoen: PNG }; p.versiering[0].beeld = 'pompoen'; });
  assert.equal(valideerPakket(m).ok, true);
});

test('versiering: plafonds per beweging, hangen plus kruipen en het totaal bewegend', () => {
  const p = (...els) => met((x) => { x.versiering = els.map((e) => ({ beeld: 'spin', ...e })); });
  weiger(p({ beweging: 'hangen', aantal: 3 }, { beweging: 'kruipen', aantal: 1 }), 'versiering');
  assert.equal(valideerPakket(p({ beweging: 'hangen', aantal: 2 }, { beweging: 'kruipen', aantal: 1 })).ok, true);
  weiger(p({ beweging: 'hangen', aantal: 2 }, { beweging: 'hangen', aantal: 2 }), 'versiering');
  weiger(p({ beweging: 'vallen', aantal: 12 }, { beweging: 'vallen', aantal: 1 }), 'versiering');
  weiger(met((x) => { x.versiering = [{ beweging: 'mist' }, { beweging: 'mist' }]; }), 'versiering');
  weiger(p({ beweging: 'hoek', hoeken: ['lb', 'rb', 'lo', 'ro'] }, { beweging: 'hoek', hoeken: ['lb'] }), 'versiering');
  // 12 + 8 = 20 bewegende elementen > 16
  weiger(p({ beweging: 'vallen', aantal: 12 }, { beweging: 'opstijgen', aantal: 8 }), 'versiering');
  assert.equal(valideerPakket(p({ beweging: 'vallen', aantal: 8 }, { beweging: 'opstijgen', aantal: 8 })).ok, true);
  // hoeken tellen niet als bewegend
  assert.equal(valideerPakket(p({ beweging: 'hoek', hoeken: ['lb', 'rb', 'lo', 'ro'] }, { beweging: 'vallen', aantal: 12 }, { beweging: 'opstijgen', aantal: 4 })).ok, true);
});

test('achtergrond: vorm bestaat, kijkvenster en dekking begrensd', () => {
  const ach = (a) => met((p) => { p.achtergrond = a; });
  assert.equal(valideerPakket(ach({ vorm: 'spin' })).ok, true);
  weiger(ach({ vorm: 'bestaatniet' }), 'achtergrond.vorm');
  weiger(ach({}), 'achtergrond.vorm');
  weiger(ach({ vorm: 'spin', kijkvensterStaand: '1 2 3' }), 'achtergrond.kijkvensterStaand');
  weiger(ach({ vorm: 'spin', dekkingLicht: 1.5 }), 'achtergrond.dekkingLicht');
  weiger(ach('spin'), 'achtergrond');
});

test('teksten: enkel de twee bekende sleutels, max 80 tekens, platte tekst', () => {
  const t = (x) => met((p) => { p.teksten = x; });
  assert.equal(valideerPakket(t({})).ok, true);
  assert.equal(valideerPakket(t({ wachtrijLeeg: 'x'.repeat(80) })).ok, true);
  weiger(t({ wachtrijLeeg: 'x'.repeat(81) }), 'teksten.wachtrijLeeg');
  weiger(t({ ingeplandLeeg: 'x'.repeat(81) }), 'teksten.ingeplandLeeg');
  weiger(t({ wachtrijLeeg: 5 }), 'teksten.wachtrijLeeg');
  weiger(t({ wachtrijLeeg: 'a\u0007b' }), 'teksten.wachtrijLeeg');
  weiger(t('tekst'), 'teksten');
});

test('spelskin: verplicht, kleuren #rrggbb, extra is een vorm', () => {
  weiger(met((p) => { delete p.spelskin; }), 'spelskin');
  weiger(met((p) => { p.spelskin = 'x'; }), 'spelskin');
  weiger(met((p) => { delete p.spelskin.naam; }), 'spelskin.naam');
  weiger(met((p) => { p.spelskin.naam = 'n'.repeat(41); }), 'spelskin.naam');
  weiger(met((p) => { p.spelskin.behuizing = 'red'; }), 'spelskin.behuizing');
  weiger(met((p) => { p.spelskin.faceplate = '#ff7a0080'; }), 'spelskin.faceplate');
  weiger(met((p) => { delete p.spelskin.bliksem; }), 'spelskin.bliksem');
  weiger(met((p) => { p.spelskin.extra = 'onbekend'; }), 'spelskin.extra');
  weiger(met((p) => { p.spelskin.extra = '__proto__'; }), 'spelskin.extra');
  weiger(met((p) => { p.beelden = { pompoen: PNG }; p.spelskin.extra = 'pompoen'; }), 'spelskin.extra');
  assert.equal(valideerPakket(met((p) => { p.spelskin.extra = 'spin'; })).ok, true);
});

test('spelskin: de rand heeft minstens 3:1 contrast met beide kanten van de spelhemel', () => {
  weiger(met((p) => { p.spelskin.rand = '#2f4358'; }), 'spelskin.rand');
  weiger(met((p) => { p.spelskin.rand = '#1b2836'; }), 'spelskin.rand');
  weiger(met((p) => { p.spelskin.rand = '#555555'; }), 'spelskin.rand');
  assert.equal(valideerPakket(met((p) => { p.spelskin.rand = '#ffffff'; })).ok, true);
  assert.equal(valideerPakket(met((p) => { p.spelskin.rand = '#e9f2f8'; })).ok, true);
});

test('pakket groter dan 512 kB: fout op "pakket" met de grens in de tekst', () => {
  const r = weiger(basis(), 'pakket', { tekstLengte: MAX_PAKKET_BYTES + 1 });
  assert.match(r.fouten.find((f) => f.veld === 'pakket').fout, /groter dan 512 kB/);
  assert.equal(valideerPakket(basis(), { tekstLengte: MAX_PAKKET_BYTES }).ok, true);
});

test('zonder tekstLengte telt de validator de JSON-bytes zelf', () => {
  const p = basis();
  p.vormen.spin.delen = Array.from({ length: 400 }, () => ({ soort: 'path', d: 'M' + '1 '.repeat(5000) }));
  p.vormen.b = { viewBox: '0 0 1 1', delen: p.vormen.spin.delen };
  weiger(p, 'pakket');
  const cyclisch = basis();
  cyclisch.zelf = cyclisch;
  weiger(cyclisch, 'pakket');
});

test('de validator wijzigt de invoer niet en geeft enkel toegelaten sleutels terug', () => {
  const invoer = basis();
  const kopie = structuredClone(invoer);
  const r = valideerPakket(invoer);
  assert.equal(r.ok, true);
  assert.deepEqual(invoer, kopie);
  r.pakket.id = 'gewijzigd';
  assert.equal(invoer.id, 'halloween');
});

test('meerdere fouten worden samen gemeld', () => {
  const r = valideerPakket(met((p) => { p.id = 'X'; p.naam = ''; p.versie = 5; }));
  assert.equal(r.ok, false);
  assert.ok(r.fouten.length >= 3);
});

test('contrastVerhouding: wit-zwart is 21, gelijke kleuren 1, symmetrisch, alpha genegeerd', () => {
  assert.ok(Math.abs(contrastVerhouding('#ffffff', '#000000') - 21) < 0.01);
  assert.ok(Math.abs(contrastVerhouding('#000000', '#ffffff') - 21) < 0.01);
  assert.ok(Math.abs(contrastVerhouding('#336699', '#336699') - 1) < 1e-9);
  assert.ok(contrastVerhouding('#e9f2f8', '#2f4358') >= 3);
  assert.ok(contrastVerhouding('#2f4358', '#2f4358') < 3);
  assert.ok(Math.abs(contrastVerhouding('#ffffff80', '#000000') - 21) < 0.01);
});
