// Instellingen per gebruiker op de server: blob `instellingen` = { versie, perGebruiker: { [gebruikerId]: Instellingen } }.
// De store is die van het VERZOEK (een testverzoek gebruikt dus de teststore); de gebruikerslijst komt apart uit de
// ECHTE store (authStore). Schrijven voegt per gebruiker samen: de sleutel van één gebruiker wordt vervangen, de rest
// blijft staan (geen 409 op de hele blob). Serieel binnen de instantie + terugleescontrole van wijzigBlob.
import { wijzigBlob } from './blob-wijzig.js';
import { maakSerieel } from './serieel.js';
import { leesGebruikers } from './gebruikers.js';
import { valideerVelden } from '../../public/js/kern/instellingen-regels.js';

const BLOB = 'instellingen';
const serieelInstellingen = maakSerieel();

export const INSTELLING_VELDEN = Object.freeze([
  'startlocatie', 'duurMinuten', 'maxPerDag', 'vanTijd', 'totTijd', 'laatsteStart', 'werkdagen',
  'maxReistijdMin', 'tijdslotMinuten', 'kaartStijl', 'routeKleur', 'drukteKleuring', 'bezoekDuurMin',
]);

const isObject = b => Boolean(b) && typeof b === 'object' && !Array.isArray(b);

// De regels (grenzen, veldtypes, teksten, volgorde) staan in public/js/kern/instellingen-regels.js en zijn dezelfde als
// in het instellingenscherm. Geeft { fout } met de eerste weigering (Nederlands) of { waarden } met enkel de bekende, geldige velden.
export const schoonInstellingen = invoer => valideerVelden(invoer);

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

// Haalt de instellingen van ÉÉN gebruiker weg (verwijderde gebruiker); de rest blijft staan. Geen blob of geen sleutel: niets schrijven.
// Gooit bij ok:false (de aanroeper vangt dat op).
export function verwijderInstellingen(store, gebruikerId) {
  if (!sleutel(gebruikerId)) return Promise.resolve(false);
  return serieelInstellingen(async () => {
    let was = false;
    const r = await wijzigBlob(store, BLOB, {
      leeg: { versie: 0, perGebruiker: {} },
      wijzig: blob => {
        const perGebruiker = isObject(blob.perGebruiker) ? blob.perGebruiker : {};
        was = Object.hasOwn(perGebruiker, gebruikerId);
        if (!was) return null;
        return { ...blob, perGebruiker: Object.fromEntries(Object.entries(perGebruiker).filter(([k]) => k !== gebruikerId)) };
      },
    });
    if (!r.ok) throw new Error('instellingen: verwijderen mislukt na herhaling');
    return was;
  });
}

// E4: de eigen instellingen plus (behalve voor sales) die van de actieve techniekers met een zohoNaam (voor een technieker zonder
// de startlocatie van collega's, zie M7).
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
    let instellingen = van(g.id);
    // Privacy (eindreview M7): de startlocatie is vaak het thuisadres. Een technieker krijgt die van collega's niet; de alleen-lezen-
    // weergave heeft enkel werkuren, -dagen e.d. nodig. Zijn eigen waarden en alles voor planner/beheerder blijven volledig.
    if (gebruiker.rol === 'technieker' && g.id !== gebruiker.id && instellingen) {
      const { startlocatie: _thuis, ...zonderStart } = instellingen;
      instellingen = zonderStart;
    }
    techniekers[g.zohoNaam] = { gebruikerId: g.id, instellingen };
  }
  return { eigen, techniekers };
}
