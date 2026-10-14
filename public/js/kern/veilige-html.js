// public/js/kern/veilige-html.js
// Strenge toelatingslijst voor rapport-HTML uit de opslag (niet te vertrouwen). Gebruikt voor de afdrukkopie in het
// archiefvenster (rapport-archief.js): die kopie staat in een venster van de app zelf, dus mag er nooit iets uitvoerbaars,
// klikbaars of extern ladends in zitten.
//
// Werkwijze: de bron wordt door DOMParser gelezen (inert: geen scripts, geen laden) en daarna wordt een NIEUWE boom opgebouwd
// met enkel toegelaten elementen en attributen; er wordt nooit een bestaand element of een stuk HTML-tekst overgenomen.
// - Elementen: enkel TAGS (HTML-namespace). SVG, MathML en alles in WEG_MET_INHOUD verdwijnt met inhoud; een ander onbekend
//   element verdwijnt, maar zijn kinderen worden (zelf weer gefilterd) behouden.
// - Attributen: enkel class, colspan en rowspan, plus bij img src/alt/width/height. Geen style, geen href, geen on*.
// - img src: enkel data:image/(png|jpeg|webp|gif);base64,... of een pad onder /api/fotos van de eigen origin; anders weg.
// - Tekst wordt als tekstknoop gemaakt (createTextNode), nooit als HTML.
// De beslisregels (tagActie, veiligeImgSrc, veiligAttribuut) zijn puur en worden in node --test getest; schoonBoom werkt op
// elk DOM-achtig object (in de test een nep-DOM, in de browser de echte).

const HTML_NS = 'http://www.w3.org/1999/xhtml';

export const TAGS = Object.freeze(['div', 'span', 'p', 'br', 'b', 'strong', 'i', 'em', 'small', 'h1', 'h2', 'h3', 'h4',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'ul', 'ol', 'li', 'img', 'hr', 'section', 'header', 'footer']);
const TAG_SET = new Set(TAGS);

// Verdwijnen met hun volledige inhoud (hun tekst is geen rapportinhoud, of ze zijn een andere taal/namespace).
const WEG_MET_INHOUD = new Set(['script', 'style', 'template', 'noscript', 'noembed', 'noframes', 'iframe', 'frame', 'frameset',
  'object', 'embed', 'applet', 'title', 'head', 'textarea', 'select', 'option', 'optgroup', 'button', 'svg', 'math', 'xmp',
  'plaintext', 'video', 'audio', 'picture', 'source', 'track', 'canvas', 'map', 'area', 'link', 'meta', 'base', 'input',
  'portal', 'dialog', 'slot']);

const MAX_DIEPTE = 64;

// 'houd' | 'uitpakken' (element weg, kinderen blijven) | 'weg' (element en inhoud weg)
export function tagActie(naam, namespace = HTML_NS) {
  if (namespace !== HTML_NS) return 'weg';
  const n = String(naam || '').toLowerCase();
  if (TAG_SET.has(n)) return 'houd';
  if (WEG_MET_INHOUD.has(n)) return 'weg';
  return 'uitpakken';
}

const DATA_IMG = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
const FOTO_PAD = /^\/api\/fotos(?:[/?][A-Za-z0-9\-._~%/?=&]*)?$/;

// Geeft de src terug als die veilig is, anders null. Enkel ASCII-witruimte aan de randen wordt weggenomen; alles daarbinnen
// moet exact kloppen (dus geen tab of nieuwe regel in het schema, geen ander schema, geen // of \ of ..).
export function veiligeImgSrc(src) {
  if (typeof src !== 'string') return null;
  const s = src.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '');
  if (DATA_IMG.test(s)) return s;
  if (FOTO_PAD.test(s) && !s.includes('..')) return s;
  return null;
}

const GETAL = /^\d{1,4}$/;
const KLASSE = /^[A-Za-z0-9_\- ]{0,200}$/;

// Geeft de te zetten waarde terug, of null als het attribuut wegvalt. naam en tag in kleine letters.
export function veiligAttribuut(tag, naam, waarde) {
  const v = String(waarde ?? '');
  switch (naam) {
    case 'class': return KLASSE.test(v) ? v : null;
    case 'colspan':
    case 'rowspan': return (tag === 'td' || tag === 'th') && GETAL.test(v) ? v : null;
    case 'alt': return tag === 'img' ? v.slice(0, 500) : null;
    case 'width':
    case 'height': return tag === 'img' && GETAL.test(v) ? v : null;
    case 'src': return tag === 'img' ? veiligeImgSrc(v) : null;
    default: return null;
  }
}

// Bouwt van de kinderen van `bron` een nieuwe, gefilterde boom in `doel` (een element of fragment van doelDoc).
export function schoonBoom(bron, doel, doelDoc, diepte = 0) {
  if (diepte > MAX_DIEPTE) return;
  for (const kind of Array.from(bron.childNodes || [])) {
    if (kind.nodeType === 3) { doel.appendChild(doelDoc.createTextNode(String(kind.data ?? ''))); continue; }
    if (kind.nodeType !== 1) continue; // commentaar, verwerkingsinstructies, ...
    const actie = tagActie(kind.localName, kind.namespaceURI);
    if (actie === 'weg') continue;
    if (actie === 'uitpakken') { schoonBoom(kind, doel, doelDoc, diepte + 1); continue; }
    const tag = TAGS[TAGS.indexOf(String(kind.localName).toLowerCase())]; // de naam uit de eigen lijst, niet uit de bron
    const el = doelDoc.createElement(tag);
    for (const a of Array.from(kind.attributes || [])) {
      const naam = String(a.name).toLowerCase();
      if (naam === 'src') continue; // apart hieronder
      const w = veiligAttribuut(tag, naam, a.value);
      if (w !== null) el.setAttribute(naam, w);
    }
    if (tag === 'img') {
      const src = veiligAttribuut('img', 'src', kind.getAttribute ? kind.getAttribute('src') : null);
      if (src === null) continue; // afbeelding zonder veilige bron: helemaal weg
      el.setAttribute('src', src);
    }
    schoonBoom(kind, el, doelDoc, diepte + 1);
    doel.appendChild(el);
  }
}

// Leest html met DOMParser van `win` en geeft een DocumentFragment van win.document met de gefilterde inhoud van <body>,
// of null zonder DOMParser.
export function schoonRapportHtml(html, win) {
  if (typeof win?.DOMParser !== 'function') return null;
  const bron = new win.DOMParser().parseFromString(String(html ?? ''), 'text/html');
  const frag = win.document.createDocumentFragment();
  if (bron.body) schoonBoom(bron.body, frag, win.document);
  return frag;
}
