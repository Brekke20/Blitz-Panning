// Instellingen per gebruiker op de server: blob `instellingen` = { versie, perGebruiker: { [gebruikerId]: Instellingen } }.
// De store is die van het VERZOEK (een testverzoek gebruikt dus de teststore); de gebruikerslijst komt apart uit de
// ECHTE store (authStore). Schrijven voegt per gebruiker samen: de sleutel van één gebruiker wordt vervangen, de rest
// blijft staan (geen 409 op de hele blob). Serieel binnen de instantie + terugleescontrole van wijzigBlob.
import { wijzigBlob } from './blob-wijzig.js';
import { maakSerieel } from './serieel.js';
import { leesGebruikers } from './gebruikers.js';

const BLOB = 'instellingen';
const MAX_STARTLOCATIE = 200;
const TIJD_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const KLEUR_RE = /^#[0-9a-f]{6}$/i;
const KAART_RE = /^[a-z0-9_-]{1,40}$/i;
const serieelInstellingen = maakSerieel();

export const INSTELLING_VELDEN = Object.freeze([
  'startlocatie', 'duurMinuten', 'maxPerDag', 'vanTijd', 'totTijd', 'laatsteStart', 'werkdagen',
  'maxReistijdMin', 'tijdslotMinuten', 'kaartStijl', 'routeKleur', 'drukteKleuring', 'bezoekDuurMin',
]);

const isObject = b => Boolean(b) && typeof b === 'object' && !Array.isArray(b);
const isGetal = w => typeof w === 'number' && Number.isFinite(w);
const aanwezig = w => w !== undefined && w !== null;

// Zelfde grenzen en weigeringsteksten als public/js/schermen/instellingen-logica.js (valideerInstellingen), maar op
// de ruwe waarden en zonder terugval op standaarden: een ontbrekend veld blijft ontbreken (de client valt terug).
// Geeft { fout } met de eerste weigering (Nederlands) of { waarden } met enkel de bekende, geldige velden.
export function schoonInstellingen(invoer) {
  if (!isObject(invoer)) return { fout: 'Ongeldige instellingen.' };
  const w = {};
  const i = invoer;

  for (const veld of ['vanTijd', 'totTijd', 'laatsteStart']) {
    if (!aanwezig(i[veld])) continue;
    if (typeof i[veld] !== 'string' || !TIJD_RE.test(i[veld])) return { fout: `⚠ ${veld} moet een tijdstip zijn (uu:mm)` };
    w[veld] = i[veld];
  }
  if (w.vanTijd && w.totTijd && w.vanTijd >= w.totTijd) return { fout: '⚠ Begintijd moet voor eindtijd liggen' };
  if (w.laatsteStart && ((w.vanTijd && w.laatsteStart < w.vanTijd) || (w.totTijd && w.laatsteStart > w.totTijd))) {
    return { fout: '⚠ Laatste start moet tussen begin- en eindtijd liggen' };
  }

  if (aanwezig(i.startlocatie)) {
    if (typeof i.startlocatie !== 'string') return { fout: '⚠ Startlocatie moet tekst zijn' };
    const s = i.startlocatie.trim();
    if (s.length > MAX_STARTLOCATIE) return { fout: '⚠ Startlocatie is te lang' };
    if (s) w.startlocatie = s;
  }
  if (aanwezig(i.duurMinuten)) {
    if (!isGetal(i.duurMinuten) || i.duurMinuten < 15) return { fout: '⚠ Minimale interventieduur is 15 minuten' };
    w.duurMinuten = i.duurMinuten;
  }
  if (aanwezig(i.maxPerDag)) {
    if (!isGetal(i.maxPerDag) || i.maxPerDag < 1) return { fout: '⚠ Maximaal per dag moet minstens 1 zijn' };
    w.maxPerDag = i.maxPerDag;
  }
  if (aanwezig(i.maxReistijdMin)) {
    if (!isGetal(i.maxReistijdMin) || i.maxReistijdMin < 0) return { fout: '⚠ Max. reistijd kan niet negatief zijn' };
    w.maxReistijdMin = i.maxReistijdMin;
  }
  if (aanwezig(i.tijdslotMinuten)) {
    if (!isGetal(i.tijdslotMinuten) || i.tijdslotMinuten < 60) return { fout: '⚠ Tijdslot moet minstens 60 minuten zijn' };
    w.tijdslotMinuten = i.tijdslotMinuten;
  }
  if (aanwezig(i.werkdagen)) {
    if (!Array.isArray(i.werkdagen) || !i.werkdagen.length) return { fout: '⚠ Selecteer minstens één werkdag' };
    if (!i.werkdagen.every(d => Number.isInteger(d) && d >= 0 && d <= 6)) return { fout: '⚠ Werkdagen zijn getallen van 0 tot 6' };
    w.werkdagen = [...new Set(i.werkdagen)];
  }
  if (aanwezig(i.kaartStijl)) {
    if (typeof i.kaartStijl !== 'string' || !KAART_RE.test(i.kaartStijl)) return { fout: '⚠ Ongeldige kaartstijl' };
    w.kaartStijl = i.kaartStijl;
  }
  if (aanwezig(i.routeKleur)) {
    if (typeof i.routeKleur !== 'string' || !KLEUR_RE.test(i.routeKleur)) return { fout: '⚠ Routekleur moet een kleur zijn zoals #f59e0b' };
    w.routeKleur = i.routeKleur;
  }
  if (aanwezig(i.drukteKleuring)) {
    if (typeof i.drukteKleuring !== 'boolean') return { fout: '⚠ Drukte-kleuring moet aan of uit zijn' };
    w.drukteKleuring = i.drukteKleuring;
  }
  if (aanwezig(i.bezoekDuurMin)) {
    if (!isGetal(i.bezoekDuurMin) || i.bezoekDuurMin < 5 || i.bezoekDuurMin > 480) return { fout: '⚠ Bezoekduur moet tussen 5 en 480 minuten liggen' };
    w.bezoekDuurMin = i.bezoekDuurMin;
  }
  return { waarden: w };
}

const sleutel = id => typeof id === 'string' && id !== '' && !['__proto__', 'constructor', 'prototype'].includes(id);

async function leesBlob(store) {
  const b = await store.get(BLOB, { type: 'json' });
  return isObject(b) ? b : null;
}

export async function leesInstellingen(store, gebruikerId) {
  const b = await leesBlob(store);
  if (!sleutel(gebruikerId) || !isObject(b?.perGebruiker) || !Object.hasOwn(b.perGebruiker, gebruikerId)) return null;
  return b.perGebruiker[gebruikerId] ?? null;
}

export async function leesVersie(store) {
  const b = await leesBlob(store);
  return typeof b?.versie === 'number' ? b.versie : 0;
}

// Vervangt de instellingen van ÉÉN gebruiker; andere sleutels blijven staan. Gooit bij ok:false (fail closed).
// Geeft { versie, gewijzigd } terug: gewijzigd = namen van de velden die verschillen van de vorige waarde.
export function bewaarInstellingen(store, gebruikerId, instellingen) {
  if (!sleutel(gebruikerId)) return Promise.reject(new Error('instellingen: ongeldige gebruikersid'));
  return serieelInstellingen(async () => {
    let gewijzigd = [];
    const r = await wijzigBlob(store, BLOB, {
      leeg: { versie: 0, perGebruiker: {} },
      wijzig: blob => {
        const perGebruiker = isObject(blob.perGebruiker) ? blob.perGebruiker : {};
        const oud = isObject(perGebruiker[gebruikerId]) ? perGebruiker[gebruikerId] : {};
        gewijzigd = [...new Set([...Object.keys(oud), ...Object.keys(instellingen)])]
          .filter(v => JSON.stringify(oud[v]) !== JSON.stringify(instellingen[v]));
        return { ...blob, perGebruiker: { ...perGebruiker, [gebruikerId]: instellingen } };
      },
    });
    if (!r.ok) throw new Error('instellingen: schrijven mislukt na herhaling');
    return { versie: r.waarde.versie, gewijzigd };
  });
}

// E4: de eigen instellingen plus (behalve voor sales) die van de actieve techniekers met een zohoNaam.
// `store` = de store van het verzoek (instellingen), `authStore` = de ECHTE store (gebruikers).
export async function overzichtVoor(store, authStore, gebruiker) {
  const b = await leesBlob(store);
  const per = isObject(b?.perGebruiker) ? b.perGebruiker : {};
  const van = id => (Object.hasOwn(per, id) && isObject(per[id]) ? per[id] : null);
  const eigen = {
    gebruikerId: gebruiker.id,
    versie: typeof b?.versie === 'number' ? b.versie : 0,
    instellingen: van(gebruiker.id),
  };
  if (gebruiker.rol === 'sales') return { eigen };
  const techniekers = {};
  for (const g of await leesGebruikers(authStore)) {
    if (g?.rol !== 'technieker' || g.actief !== true || typeof g.zohoNaam !== 'string' || !g.zohoNaam) continue;
    if (Object.hasOwn(techniekers, g.zohoNaam)) continue;
    techniekers[g.zohoNaam] = { gebruikerId: g.id, instellingen: van(g.id) };
  }
  return { eigen, techniekers };
}
