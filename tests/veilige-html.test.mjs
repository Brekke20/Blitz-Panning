// Toelatingslijst voor rapport-HTML (public/js/kern/veilige-html.js): de pure beslisregels en de boombouw op een nep-DOM.
// Het echte HTML-ontleden (entiteiten zoals java&#9;script:, <math>, <svg onload>) wordt in de browser getest:
// e2e/rapport-drukkopie-veilig.spec.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tagActie, veiligeImgSrc, veiligAttribuut, schoonBoom, TAGS } from '../public/js/kern/veilige-html.js';

const HTML = 'http://www.w3.org/1999/xhtml';
const SVG = 'http://www.w3.org/2000/svg';
const MATH = 'http://www.w3.org/1998/Math/MathML';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('tagActie: enkel de lijst blijft, gevaarlijke elementen verdwijnen met inhoud, andere worden uitgepakt', () => {
  for (const t of TAGS) assert.equal(tagActie(t), 'houd', t);
  assert.equal(tagActie('DIV'), 'houd');
  for (const t of ['script', 'style', 'iframe', 'object', 'embed', 'template', 'noscript', 'svg', 'math', 'base', 'meta', 'link',
    'textarea', 'button', 'input', 'video', 'audio', 'source', 'title']) assert.equal(tagActie(t), 'weg', t);
  for (const t of ['a', 'form', 'font', 'center', 'label', 'blink', 'custom-el']) assert.equal(tagActie(t), 'uitpakken', t);
  // Een toegelaten naam in een andere namespace (svg/math) is niet toegelaten.
  assert.equal(tagActie('div', SVG), 'weg');
  assert.equal(tagActie('span', MATH), 'weg');
  assert.equal(tagActie('a', SVG), 'weg');
});

test('veiligeImgSrc: enkel data:image (png/jpeg/webp/gif, base64) of /api/fotos', () => {
  assert.equal(veiligeImgSrc(PNG), PNG);
  assert.equal(veiligeImgSrc('  ' + PNG + '\n'), PNG);
  assert.equal(veiligeImgSrc('data:image/jpeg;base64,/9j/4AAQ'), 'data:image/jpeg;base64,/9j/4AAQ');
  assert.equal(veiligeImgSrc('data:image/webp;base64,UklGRg=='), 'data:image/webp;base64,UklGRg==');
  assert.equal(veiligeImgSrc('/api/fotos?id=t1&naam=a.jpg'), '/api/fotos?id=t1&naam=a.jpg');
  assert.equal(veiligeImgSrc('/api/fotos/t1/a.jpg'), '/api/fotos/t1/a.jpg');
  for (const slecht of [
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\tscript:alert(1)', 'java\nscript:alert(1)', ' javascript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=', 'data:text/html,<script>alert(1)</script>', 'data:image/svg+xml;base64,PHN2Zz4=',
    'data:image/png,iVBOR', 'data:image/png;base64,iVBOR"onerror="x', 'data:image/png;base64,iVB OR', 'DATA:image/png;base64,iVBOR',
    'https://evil.test/x.png', 'http://127.0.0.1:9/x.png', '//evil.test/x.png', '/\\evil.test/x.png', '/api/fotos/../rapport',
    '/api/fotosx', '/api/gebruikers', '/api/fotos?u=https://evil.test', 'blob:https://app/1', 'vbscript:x', '', null, undefined, 42,
  ]) assert.equal(veiligeImgSrc(slecht), null, String(slecht));
});

test('veiligAttribuut: enkel class/colspan/rowspan en bij img src/alt/width/height', () => {
  assert.equal(veiligAttribuut('div', 'class', 'sig-box'), 'sig-box');
  assert.equal(veiligAttribuut('div', 'class', 'a"b'), null);
  assert.equal(veiligAttribuut('td', 'colspan', '2'), '2');
  assert.equal(veiligAttribuut('td', 'colspan', '2;x'), null);
  assert.equal(veiligAttribuut('div', 'colspan', '2'), null);
  assert.equal(veiligAttribuut('img', 'alt', 'handtekening'), 'handtekening');
  assert.equal(veiligAttribuut('img', 'width', '220'), '220');
  assert.equal(veiligAttribuut('img', 'width', '100%'), null);
  assert.equal(veiligAttribuut('img', 'src', PNG), PNG);
  assert.equal(veiligAttribuut('div', 'src', PNG), null);
  for (const naam of ['style', 'href', 'xlink:href', 'onload', 'onerror', 'srcdoc', 'srcset', 'formaction', 'action', 'id', 'name',
    'background', 'poster', 'data', 'http-equiv', 'content', 'target', 'ping', 'is', 'slot', 'part', 'popover', 'tabindex']) {
    assert.equal(veiligAttribuut('div', naam, 'x'), null, naam);
    assert.equal(veiligAttribuut('img', naam, 'x'), null, 'img ' + naam);
  }
});

// ── Nep-DOM: genoeg voor schoonBoom (bron: nodeType/localName/namespaceURI/attributes/childNodes/getAttribute) ──
function el(naam, attrs = {}, kinderen = [], ns = HTML) {
  return {
    nodeType: 1, localName: naam, namespaceURI: ns,
    attributes: Object.entries(attrs).map(([name, value]) => ({ name, value })),
    getAttribute: (n) => (n in attrs ? attrs[n] : null),
    childNodes: kinderen,
  };
}
const tekst = (data) => ({ nodeType: 3, data });
const commentaar = (data) => ({ nodeType: 8, data });

const doelDoc = {
  createElement: (tag) => ({ tag, attrs: {}, kinderen: [], setAttribute(n, v) { this.attrs[n] = v; }, appendChild(k) { this.kinderen.push(k); } }),
  createTextNode: (data) => ({ tekst: data }),
};
function bouw(...kinderen) {
  const wortel = { kinderen: [], appendChild(k) { this.kinderen.push(k); } };
  schoonBoom({ childNodes: kinderen }, wortel, doelDoc);
  return wortel.kinderen;
}
const alsHtml = (lijst) => lijst.map(n => n.tekst !== undefined ? `#${n.tekst}`
  : `<${n.tag}${Object.entries(n.attrs).map(([k, v]) => ` ${k}=${v}`).join('')}>${alsHtml(n.kinderen)}</${n.tag}>`).join('');

test('schoonBoom: bouwt nieuwe knopen met enkel toegelaten tags en attributen', () => {
  const uit = bouw(el('div', { class: 'sig-box', style: 'position:fixed', onclick: 'x()', id: 'a' }, [
    tekst('Technieker'), el('img', { src: PNG, style: 'max-width:220px', onerror: 'x()' }),
  ]));
  assert.equal(alsHtml(uit), `<div class=sig-box>#Technieker<img src=${PNG}></img></div>`);
});

test('schoonBoom: script, style, svg, math, iframe en commentaar verdwijnen met inhoud', () => {
  const uit = bouw(
    el('script', {}, [tekst('alert(1)')]),
    el('style', {}, [tekst(':host{display:block!important}')]),
    el('svg', { onload: 'x()' }, [el('a', { href: 'javascript:x()' }, [tekst('klik')], SVG), el('animate', { attributeName: 'href', values: 'javascript:x()' }, [], SVG)], SVG),
    el('math', {}, [el('mtext', {}, [tekst('m')], MATH)], MATH),
    el('iframe', { srcdoc: '<script>x()</script>' }),
    el('meta', { 'http-equiv': 'refresh', content: '0;url=javascript:x()' }),
    el('base', { href: 'https://evil.test/' }),
    commentaar('<img src=x onerror=x()>'),
    tekst('rest'),
  );
  assert.equal(alsHtml(uit), '#rest');
});

test('schoonBoom: a en form worden uitgepakt (tekst blijft, geen href of formaction)', () => {
  const uit = bouw(
    el('a', { href: 'java\tscript:x()', 'xlink:href': 'javascript:x()' }, [tekst('Klik om te bekijken')]),
    el('form', { action: 'https://evil.test' }, [el('button', { formaction: 'javascript:x()' }, [tekst('knop')]), el('p', {}, [tekst('in formulier')])]),
  );
  assert.equal(alsHtml(uit), '#Klik om te bekijken<p>#in formulier</p>');
});

test('schoonBoom: een img zonder veilige bron verdwijnt helemaal', () => {
  const uit = bouw(
    el('img', { src: 'https://evil.test/a.png', alt: 'a' }),
    el('img', { src: 'java&#9;script:x()' }),
    el('img', { src: 'data:image/svg+xml;base64,PHN2Zz4=' }),
    el('img', { srcset: 'https://evil.test/b.png 1x' }),
    el('img', { src: '/api/fotos?id=1', alt: 'foto', width: '100' }),
  );
  assert.equal(alsHtml(uit), '<img alt=foto width=100 src=/api/fotos?id=1></img>');
});

test('schoonBoom: tagnaam komt uit de eigen lijst (hoofdletters in de bron) en diepe nesting stopt', () => {
  assert.equal(alsHtml(bouw(el('DIV', { CLASS: 'x' }, [tekst('t')]))), '<div class=x>#t</div>');
  let diep = tekst('bodem');
  for (let i = 0; i < 500; i++) diep = el('div', {}, [diep]);
  const uit = bouw(diep);
  let n = 0; let k = uit[0];
  while (k && k.kinderen) { n++; k = k.kinderen[0]; }
  assert.ok(n <= 66, `diepte ${n}`);
});
