// Eén run van het vangnet: (1) rapporten die blijven hangen opnieuw starten, (2) oude entries met
// inline HTML naar een aparte inhoudsblob migreren. De inhoudsblob is het blijvende archief van het
// rapport: nooit verwijderen. Store, start en verwerk worden geïnjecteerd (testbaar zonder Netlify).

import { LIJST_KEY, wijzigLijst } from './rapportlijst.js';
import { schrijfInhoud, leesInhoud } from './rapport-inhoud.js';
import { kiesTeStarten, kiesTeMigreren, maakMigratie, heeftZwareInhoud } from './rapport-vangnet-logica.js';

async function startDeel({ store, start, verwerk, nu, zelfVerwerken }) {
  const lijst = (await store.get(LIJST_KEY, { type: 'json' })) ?? { rapports: [] };
  let ids = kiesTeStarten(lijst.rapports, nu);
  // Terugvaloptie zonder Background Functions: zelf verwerken, één rapport per run (de functie
  // heeft een korte looptijd).
  if (zelfVerwerken) ids = ids.slice(0, 1);
  const gestart = [];
  for (const id of ids) {
    try {
      await (zelfVerwerken ? verwerk(id) : start(id));
      gestart.push(id);
    } catch (err) {
      console.error('[rapport-vangnet] starten mislukt voor', id, err?.message || err);
    }
  }
  return gestart;
}

async function migreerDeel({ store, nu, tijdsbudgetMs, begin }) {
  const lijst = (await store.get(LIJST_KEY, { type: 'json' })) ?? { rapports: [] };
  const klaar = new Set();
  for (const entry of kiesTeMigreren(lijst.rapports)) {
    if (Date.now() - begin >= tijdsbudgetMs) break;
    try {
      // Eerst de blob (overslaan als hij al bestaat), pas daarna wijzigt de lijst.
      const { inhoud } = maakMigratie(entry, nu);
      if (inhoud && !(await leesInhoud(store, entry.id))) await schrijfInhoud(store, inhoud, nu);
      klaar.add(entry.id);
    } catch (err) {
      console.error('[rapport-vangnet] migratie mislukt voor', entry.id, err?.message || err);
    }
  }
  if (klaar.size === 0) return 0;

  const res = await wijzigLijst(store, ({ rapports }) => {
    if (!rapports.some(r => klaar.has(r.id) && heeftZwareInhoud(r))) return null;
    return {
      rapports: rapports.map(r => (klaar.has(r.id) && heeftZwareInhoud(r) ? maakMigratie(r, nu).lichteEntry : r)),
      controle: terug => !terug.some(r => klaar.has(r.id) && heeftZwareInhoud(r)),
    };
  });
  if (!res.ok) throw new Error('Rapportlijst bijwerken na migratie mislukt');
  return klaar.size;
}

export async function voerVangnetUit({ store, start, verwerk, nu = new Date(), zelfVerwerken = false, tijdsbudgetMs = 20000 }) {
  const begin = Date.now();
  const gestart = await startDeel({ store, start, verwerk, nu, zelfVerwerken });
  const gemigreerd = await migreerDeel({ store, nu, tijdsbudgetMs, begin });
  return { gestart, gemigreerd };
}
