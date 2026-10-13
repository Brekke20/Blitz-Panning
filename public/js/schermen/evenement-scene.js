// schermen/evenement-scene.js — de achtergrondscène van het Halloween-thema (puur: geeft enkel een SVG-tekst terug, geen DOM, geen netwerk).
// Een boerderij op een heuvel, vogelverschrikkers, volle maan, nacht. Getekend in 1600 x 900; de lage helft is landschap, de maan staat rechtsboven.
// Gebruikt door schermen/evenement-laag.js (element #event-achtergrond). Een smal scherm toont enkel het rechterdeel (zie `kijkvenster`).
export const SCENE_BREED = 1600;
export const SCENE_HOOG = 900;

// Welk deel van de scène getoond wordt: breed = alles; smal (staand scherm) = het rechterdeel met maan en boerderij.
export function kijkvenster(breedte, hoogte) {
  const smal = hoogte > 0 && breedte / hoogte < 1;
  return smal ? { viewBox: '820 0 780 900', uitlijning: 'xMaxYMax slice' } : { viewBox: `0 0 ${SCENE_BREED} ${SCENE_HOOG}`, uitlijning: 'xMidYMax slice' };
}

// Vaste "willekeurige" sterren (zelfde elke keer, getest op aantal en bereik).
export function sterren(aantal = 46) {
  let s = 20261031;
  const r = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  const lijst = [];
  while (lijst.length < aantal) {
    const x = Math.round(r() * SCENE_BREED), y = Math.round(r() * 430);
    if (Math.hypot(x - 1380, y - 170) < 150) continue; // niet in de gloed van de maan
    lijst.push({ x, y, r: +(0.7 + r() * 1.1).toFixed(1), o: +(0.4 + r() * 0.5).toFixed(2) });
  }
  return lijst;
}

const SIL = '#07070f';
const VLEERMUIS = '<path d="M16 17c-2-3-4-6-9-7 1 2 1 4 0 6-2-1-5 0-7 2 3 0 5 1 6 3 1-1 3-1 4 1 1-2 3-3 6-3 3 0 5 1 6 3 1-2 3-2 4-1 1-2 3-3 6-3-2-2-5-3-7-2-1-2-1-4 0-6-5 1-7 4-9 7z"/>';

export function sceneSvg() {
  const sterrenSvg = sterren().map(s => `<circle cx="${s.x}" cy="${s.y}" r="${s.r}" fill="#e8e4ff" opacity="${s.o}"/>`).join('');
  const verschrikker = (x, y, sc, hoek) => `<use href="#ev-vv" transform="translate(${x} ${y}) rotate(${hoek}) scale(${sc})"/>`;
  const bat = (x, y, sc, hoek) => `<g transform="translate(${x} ${y}) rotate(${hoek}) scale(${sc})" fill="${SIL}">${VLEERMUIS}</g>`;
  let hek = '';
  for (let i = 0; i < 11; i++) {
    const x = 330 + i * 38, lean = [-3, 2, 0, -2, 3, 0, -1, 2, -3, 1, 0][i];
    hek += `<rect x="${x - 3}" y="778" width="6" height="50" fill="${SIL}" transform="rotate(${lean} ${x} 828)"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" id="ev-scene" viewBox="0 0 ${SCENE_BREED} ${SCENE_HOOG}" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
<defs>
<linearGradient id="ev-lucht" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#070a1c"/><stop offset="0.55" stop-color="#17173a"/><stop offset="1" stop-color="#352552"/></linearGradient>
<radialGradient id="ev-maanglans" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fff3cf" stop-opacity="0.55"/><stop offset="0.35" stop-color="#d9d3ff" stop-opacity="0.18"/><stop offset="1" stop-color="#8f86e8" stop-opacity="0"/></radialGradient>
<radialGradient id="ev-raamglans" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#f97316" stop-opacity="0.55"/><stop offset="1" stop-color="#f97316" stop-opacity="0"/></radialGradient>
<g id="ev-vv" fill="${SIL}">
<rect x="-2.5" y="-112" width="5" height="112"/>
<rect x="-38" y="-84" width="76" height="4.5" rx="2"/>
<path d="M-15 -86L15 -86L20 -48L12 -52L8 -44L2 -51L-4 -43L-9 -51L-16 -44L-20 -50Z"/>
<circle cx="0" cy="-98" r="10.5"/>
<path d="M-19 -105H19L11 -108Q8 -128 0 -128Q-8 -128 -11 -108Z"/>
<path d="M-38 -83L-46 -90M-38 -82L-48 -80M-38 -81L-45 -73M38 -83L46 -90M38 -82L48 -80M38 -81L45 -73" stroke="${SIL}" stroke-width="2.2" stroke-linecap="round" fill="none"/>
</g>
</defs>
<rect width="${SCENE_BREED}" height="${SCENE_HOOG}" fill="url(#ev-lucht)"/>
${sterrenSvg}
<circle cx="1380" cy="170" r="270" fill="url(#ev-maanglans)"/>
<circle cx="1380" cy="170" r="84" fill="#f3ead0"/>
<g fill="#d8cfae" opacity="0.55"><circle cx="1352" cy="148" r="15"/><circle cx="1402" cy="196" r="11"/><circle cx="1380" cy="132" r="7"/><circle cx="1338" cy="196" r="9"/></g>
<g>${bat(1210, 118, 1.1, -12)}${bat(1275, 70, 0.8, 8)}${bat(1130, 205, 0.7, -20)}${bat(1500, 275, 0.9, 14)}</g>
<path d="M0 600Q220 548 470 590T900 585T1280 560T1600 590V900H0Z" fill="#211d46"/>
<path d="M700 760Q1000 560 1280 548Q1450 545 1600 590V900H700Z" fill="#191738"/>
<circle cx="1352" cy="590" r="120" fill="url(#ev-raamglans)"/>
<g transform="translate(1350 622)" fill="${SIL}">
<rect x="-50" y="-62" width="100" height="62"/>
<path d="M-62 -62L0 -108L62 -62Z"/>
<rect x="28" y="-104" width="12" height="34"/>
<rect x="-30" y="-44" width="18" height="20" fill="#f97316"/>
<path d="M-21 -44V-24M-30 -34H-12" stroke="${SIL}" stroke-width="1.6"/>
<rect x="14" y="-36" width="14" height="36" fill="#0d0c1c"/>
<path d="M82 0V-52L98 -78L130 -90L162 -78L178 -52V0Z"/>
<rect x="120" y="-72" width="20" height="14" fill="#c2570c"/>
<rect x="116" y="-30" width="28" height="30" fill="#0d0c1c"/>
</g>
<path d="M0 700Q300 640 640 690T1280 680T1600 700V900H0Z" fill="#12122a"/>
${verschrikker(250, 790, 0.95, -4)}${verschrikker(560, 765, 0.75, 3)}${verschrikker(1010, 770, 0.8, -3)}${verschrikker(1420, 790, 1.05, 4)}
<g>
<path d="M120 800C124 740 112 700 118 650C122 610 108 580 96 560L102 556C116 574 130 600 128 640C134 600 148 570 170 548L174 553C152 580 140 612 138 650C140 700 150 750 152 800Z" fill="${SIL}"/>
<g stroke="${SIL}" stroke-width="5" stroke-linecap="round" fill="none"><path d="M118 690L80 650M122 650L70 620M130 610L152 566M122 700L170 668M128 660L180 628M96 560L80 530M102 566L124 530"/></g>
</g>
${hek}
<rect x="320" y="796" width="440" height="5" fill="${SIL}"/><rect x="320" y="816" width="440" height="5" fill="${SIL}"/>
<path d="M0 820Q400 780 800 815T1600 805V900H0Z" fill="#07070f"/>
</svg>`;
}
