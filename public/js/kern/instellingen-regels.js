// kern/instellingen-regels.js — DE regels voor de instellingen (grenzen, veldtypes en Nederlandse weigeringsteksten),
// gedeeld door het instellingenscherm (schermen/instellingen-logica.js, client) en de server
// (netlify/lib/instellingen.js). Puur: geen DOM, geen toestand, geen opslag, geen imports.
// De volgorde van de controles is de volgorde van de weigeringen in het scherm: de eerste weigering wint.

export const WERKUREN_STANDAARD = Object.freeze({ vanTijd: '08:00', totTijd: '17:00' });
export const MIN_DUUR = 15;
export const MIN_MAX_PER_DAG = 1;
export const MIN_TIJDSLOT = 60;
export const MIN_BEZOEKDUUR = 5;
export const MAX_BEZOEKDUUR = 480;
export const MAX_STARTLOCATIE = 200;

const TIJD_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const KLEUR_RE = /^#[0-9a-f]{6}$/i;
const KAART_RE = /^[a-z0-9_-]{1,40}$/i;
const TIJD_NAMEN = { vanTijd: 'Begintijd', totTijd: 'Eindtijd', laatsteStart: 'Laatste start' };

export const isKleur = w => typeof w === 'string' && KLEUR_RE.test(w);

const isObject = b => Boolean(b) && typeof b === 'object' && !Array.isArray(b);
const isGetal = w => typeof w === 'number' && Number.isFinite(w);
const aanwezig = w => w !== undefined && w !== null;

// invoer: object met (een deel van) de velden; een ontbrekend veld (undefined/null) wordt niet gecontroleerd en niet
// teruggegeven. fallback: de werkuren waartegen "laatste start" wordt gehouden als begin- of eindtijd ontbreekt.
// Geeft { fout } met de tekst van de eerste weigering, of { waarden } met enkel de bekende, geldige velden (onbekende
// velden vallen weg; startlocatie getrimd, een lege startlocatie telt als ontbrekend).
export function valideerVelden(invoer, fallback = WERKUREN_STANDAARD) {
  if (!isObject(invoer)) return { fout: 'Ongeldige instellingen.' };
  const i = invoer;
  const w = {};

  for (const veld of ['vanTijd', 'totTijd', 'laatsteStart']) {
    if (!aanwezig(i[veld]) || i[veld] === '') continue;
    if (typeof i[veld] !== 'string' || !TIJD_RE.test(i[veld])) return { fout: `⚠ ${TIJD_NAMEN[veld]} moet een tijdstip zijn (uu:mm)` };
    w[veld] = i[veld];
  }
  if (w.vanTijd && w.totTijd && w.vanTijd >= w.totTijd) return { fout: '⚠ Begintijd moet voor eindtijd liggen' };
  if (w.laatsteStart && (w.laatsteStart < (w.vanTijd || fallback.vanTijd) || w.laatsteStart > (w.totTijd || fallback.totTijd))) {
    return { fout: '⚠ Laatste start moet tussen begin- en eindtijd liggen' };
  }

  if (aanwezig(i.duurMinuten)) {
    if (!isGetal(i.duurMinuten) || i.duurMinuten < MIN_DUUR) return { fout: `⚠ Minimale interventieduur is ${MIN_DUUR} minuten` };
    w.duurMinuten = i.duurMinuten;
  }
  if (aanwezig(i.maxPerDag)) {
    if (!isGetal(i.maxPerDag) || i.maxPerDag < MIN_MAX_PER_DAG) return { fout: `⚠ Maximaal per dag moet minstens ${MIN_MAX_PER_DAG} zijn` };
    w.maxPerDag = i.maxPerDag;
  }
  if (aanwezig(i.maxReistijdMin)) {
    if (!isGetal(i.maxReistijdMin) || i.maxReistijdMin < 0) return { fout: '⚠ Max. reistijd kan niet negatief zijn' };
    w.maxReistijdMin = i.maxReistijdMin;
  }
  // Een te kleine waarde laat tijdslotVoor() omgekeerde tijdvak-labels maken ("08:00–07:30") in klantmails.
  if (aanwezig(i.tijdslotMinuten)) {
    if (!isGetal(i.tijdslotMinuten) || i.tijdslotMinuten < MIN_TIJDSLOT) return { fout: `⚠ Tijdslot moet minstens ${MIN_TIJDSLOT} minuten zijn` };
    w.tijdslotMinuten = i.tijdslotMinuten;
  }
  if (aanwezig(i.werkdagen)) {
    if (!Array.isArray(i.werkdagen) || !i.werkdagen.length) return { fout: '⚠ Selecteer minstens één werkdag' };
    if (!i.werkdagen.every(d => Number.isInteger(d) && d >= 0 && d <= 6)) return { fout: '⚠ Werkdagen zijn getallen van 0 tot 6' };
    w.werkdagen = [...new Set(i.werkdagen)];
  }

  if (aanwezig(i.startlocatie)) {
    if (typeof i.startlocatie !== 'string') return { fout: '⚠ Startlocatie moet tekst zijn' };
    const s = i.startlocatie.trim();
    if (s.length > MAX_STARTLOCATIE) return { fout: '⚠ Startlocatie is te lang' };
    if (s) w.startlocatie = s;
  }
  if (aanwezig(i.kaartStijl)) {
    if (typeof i.kaartStijl !== 'string' || !KAART_RE.test(i.kaartStijl)) return { fout: '⚠ Ongeldige kaartstijl' };
    w.kaartStijl = i.kaartStijl;
  }
  if (aanwezig(i.routeKleur)) {
    if (!isKleur(i.routeKleur)) return { fout: '⚠ Routekleur moet een kleur zijn zoals #f59e0b' };
    w.routeKleur = i.routeKleur;
  }
  if (aanwezig(i.drukteKleuring)) {
    if (typeof i.drukteKleuring !== 'boolean') return { fout: '⚠ Drukte-kleuring moet aan of uit zijn' };
    w.drukteKleuring = i.drukteKleuring;
  }
  if (aanwezig(i.bezoekDuurMin)) {
    if (!isGetal(i.bezoekDuurMin) || i.bezoekDuurMin < MIN_BEZOEKDUUR || i.bezoekDuurMin > MAX_BEZOEKDUUR) {
      return { fout: `⚠ Bezoekduur moet tussen ${MIN_BEZOEKDUUR} en ${MAX_BEZOEKDUUR} minuten liggen` };
    }
    w.bezoekDuurMin = i.bezoekDuurMin;
  }
  return { waarden: w };
}
