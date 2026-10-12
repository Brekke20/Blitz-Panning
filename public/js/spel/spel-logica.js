// spel/spel-logica.js — de pure spelregels van "Blitz Run": natuurkunde, hitboxen, snelheid, score en het
// aanmaken van hindernissen. Geen DOM, geen tijd, geen toeval op moduleniveau (een `rng` wordt meegegeven).
// Wereldeenheden: 600 breed, 200 hoog, de grond op y = 0 (hoogtes tellen omhoog); tijd in seconden.

export const WERELD = Object.freeze({ breedte: 600, hoogte: 200, grondY: 170 }); // grondY = canvas-y van de grond (voor het tekenen)

export const SPELER = Object.freeze({
  x: 56,
  staan: Object.freeze({ b: 18, h: 52 }),   // hoge, slanke zuil
  bukken: Object.freeze({ b: 32, h: 30 }),  // lager en breder
});

export const FYSICA = Object.freeze({ zwaartekracht: 2000, spring: 640, valFactor: 2.6 }); // valFactor: omlaag duwen in de lucht
export const HITBOX_MARGE = 3; // vergevingsgezind: de hitbox is aan elke kant 3 eenheden kleiner dan het getekende ding

export const HINDERNIS = Object.freeze({
  jerrycan: Object.freeze({ b: 18, h: 26, bodem: 0 }),    // komt van onderen: springen
  // komt van boven en hangt tot aan het plafond (bodem 36 > bukhoogte 30, < staanhoogte 52): enkel bukken helpt, over springen kan niet
  bliksem: Object.freeze({ b: 22, h: 128, bodem: 36 }),
});

export const SNELHEID = Object.freeze({ start: 260, groei: 0.012, max: 720 });
export const SCORE_PER_EENHEID = 0.1;         // 10 eenheden afstand = 1 punt
export const BLIKSEM_VANAF_AFSTAND = 1200;    // de eerste hindernissen zijn enkel jerrycans

export function snelheidBij(afstand) {
  return Math.min(SNELHEID.max, SNELHEID.start + SNELHEID.groei * Math.max(0, afstand));
}

export const scoreBij = (afstand) => Math.floor(Math.max(0, afstand) * SCORE_PER_EENHEID);

// De hitbox van de speler op dit moment: { x, y (bodem boven de grond), b, h }.
export function spelerBox(speler) {
  const m = speler.bukken ? SPELER.bukken : SPELER.staan;
  return { x: SPELER.x, y: speler.y, b: m.b, h: m.h };
}

export function hindernisBox(h) {
  return { x: h.x, y: h.bodem, b: h.b, h: h.hoogte ?? h.h };
}

// Overlapt de speler (met marge) een hindernis (met marge)? Randen die elkaar enkel raken tellen niet.
export function botst(speler, hindernis, marge = HITBOX_MARGE) {
  const a = spelerBox(speler);
  const c = hindernisBox(hindernis);
  const aL = a.x + marge, aR = a.x + a.b - marge, aO = a.y + marge, aB = a.y + a.h - marge;
  const cL = c.x + marge, cR = c.x + c.b - marge, cO = c.y + marge, cB = c.y + c.h - marge;
  return aL < cR && aR > cL && aO < cB && aB > cO;
}

// Nieuwe hindernis aan de rechterrand. `rng` geeft getallen in [0, 1).
export function maakHindernis(afstand, rng) {
  const bliksem = afstand >= BLIKSEM_VANAF_AFSTAND && rng() < 0.45;
  const soort = bliksem ? 'bliksem' : 'jerrycan';
  const m = HINDERNIS[soort];
  return { soort, x: WERELD.breedte + 20, b: m.b, h: m.h, bodem: m.bodem };
}

// Afstand (in wereldeenheden) tot de volgende hindernis: genoeg reactietijd bij de huidige snelheid, met variatie.
export function volgendeAfstand(snelheid, rng) {
  return snelheid * (0.85 + rng() * 0.75);
}

export function maakStaat(rng = Math.random) {
  return {
    afstand: 0,
    snelheid: SNELHEID.start,
    speler: { y: 0, vy: 0, bukken: false },
    hindernissen: [],
    volgendeBij: 500, // afstand waarop de eerste hindernis verschijnt
    dood: false,
    rng,
  };
}

// Eén tijdstap (dt in seconden). `invoer`: { spring: bool (nieuwe druk op springen), bukken: bool (ingehouden) }.
// Muteert en geeft `staat` terug. Na een botsing is `dood` waar en staat het spel stil.
export function stap(staat, dt, invoer = {}) {
  if (staat.dood) return staat;
  const s = staat.speler;
  const opGrond = s.y <= 0 && s.vy <= 0;

  if (opGrond) {
    s.y = 0; s.vy = 0;
    if (invoer.spring && !invoer.bukken) s.vy = FYSICA.spring;
    s.bukken = Boolean(invoer.bukken) && s.vy === 0;
  } else {
    s.bukken = false; // in de lucht geen bukhouding
  }
  if (s.vy !== 0 || s.y > 0) {
    const g = FYSICA.zwaartekracht * (invoer.bukken ? FYSICA.valFactor : 1);
    s.vy -= g * dt;
    s.y += s.vy * dt;
    if (s.y <= 0) { s.y = 0; s.vy = 0; }
  }

  staat.snelheid = snelheidBij(staat.afstand);
  const verplaatsing = staat.snelheid * dt;
  staat.afstand += verplaatsing;
  for (const h of staat.hindernissen) h.x -= verplaatsing;
  staat.hindernissen = staat.hindernissen.filter(h => h.x + h.b > -10);

  if (staat.afstand >= staat.volgendeBij) {
    staat.hindernissen.push(maakHindernis(staat.afstand, staat.rng));
    staat.volgendeBij = staat.afstand + volgendeAfstand(staat.snelheid, staat.rng);
  }

  if (staat.hindernissen.some(h => botst(s, h))) staat.dood = true;
  return staat;
}

// ---- Invoer: toetsen en aanraking naar { spring, bukken } ----
export const SPRING_TOETSEN = Object.freeze(['ArrowUp', ' ', 'Spacebar']);
export const BUK_TOETSEN = Object.freeze(['ArrowDown']);

// Aanraking: bovenste helft = springen, onderste helft = bukken (ingehouden). `y` en `hoogte` in dezelfde eenheid.
export function aanraakActie(y, hoogte) {
  return y < hoogte / 2 ? 'spring' : 'bukken';
}

// ---- 5× snel tikken op de titel (openen en sluiten) ----
// Geeft een functie `tik(nuMs) -> boolean`: waar bij de `aantal`-ste tik binnen `venster` ms (schuivend venster); daarna begint het opnieuw.
export function maakTikDetector({ aantal = 5, venster = 2000 } = {}) {
  let tikken = [];
  return function tik(nuMs) {
    tikken.push(nuMs);
    tikken = tikken.filter(t => nuMs - t <= venster).slice(-aantal);
    if (tikken.length >= aantal) { tikken = []; return true; }
    return false;
  };
}
