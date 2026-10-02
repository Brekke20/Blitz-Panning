// kern/verbruik-wachtrij.js — wagenvoorraad-aftrek na een verzonden rapport: melding bij mislukken en later automatisch opnieuw
// proberen (etappe 7, Q4). Puur: alle afhankelijkheden worden meegegeven (geen window, geen localStorage, geen fetch).
//
// Idempotentie: de server (netlify/functions/inventaris.js) heeft GEEN sleutel per aftrek; enkel een versiecontrole (409 bij een
// verouderde `versie`, vóór er iets geschreven wordt). Een herpoging kan dus nooit dubbel aftrekken als ze enkel gebeurt na een
// ZEKERE mislukking (er is niets geschreven):
//   - 'conflict'   409 (versie verouderd): geen schrijfactie; opnieuw met de versie uit het antwoord.
//   - 'tijdelijk'  503 met de eigen foutboodschap van de functie ("opslag tijdelijk niet bereikbaar"): geen schrijfactie.
//   - offline      de browser is offline vóór het verzenden: niets verstuurd.
// Alles waarvan de uitkomst onzeker is (netwerkfout of time-out na het verzenden, 500, 502/503/504 zonder eigen boodschap) wordt
// NIET opnieuw geprobeerd: enkel een melding, zodat de technieker de voorraad controleert. 4xx (behalve 409) is definitief.
// Een wachtrij-item dat nog 'onderweg' staat maar waarvan de lease verlopen is (pagina gesloten tijdens het verzenden) is onzeker:
// melding, geen herpoging.

import { foutTekst } from './api.js';

export const WACHTRIJ_SLEUTEL = 'blitz_verbruik_wachtrij';
const LEASE_MS = 60000;
const MAX_CONFLICTEN = 3;
const MAX_POGINGEN = 8;

export const TEKSTEN = {
  wachtrij: '⚠ Wagenvoorraad is niet bijgewerkt. De app probeert het later automatisch opnieuw.',
  alsnog: '✓ Wagenvoorraad alsnog bijgewerkt',
  onzeker: detail => `⚠ Onzeker of de wagenvoorraad is bijgewerkt (${detail}). Controleer de voorraad in Inventaris.`,
  definitief: '✕ Wagenvoorraad kon niet bijgewerkt worden. Pas ze zelf aan in Inventaris.',
};

// Classificeert de uitkomst van één POST. `res` is { status, data }; bij een gegooide fout geef je `err` mee.
export function classificeer({ res, err }) {
  if (err) return { uitkomst: 'onzeker', detail: foutTekst(err) };
  if (res.status >= 200 && res.status < 300) return { uitkomst: 'gelukt' };
  if (res.status === 409) return { uitkomst: 'conflict', versie: res.data?.data?.versie ?? res.data?.serverVersie };
  if (res.status === 503 && /Inventaris-opslag/.test(res.data?.error || '')) return { uitkomst: 'tijdelijk' };
  if (res.status >= 400 && res.status < 500) return { uitkomst: 'definitief' };
  return { uitkomst: 'onzeker', detail: `Serverfout (HTTP ${res.status})` };
}

// deps: opslag { lees(), schrijf(lijst) } · post(body) -> { status, data } (gooit bij netwerkfout/time-out) · versie() -> huidige versie
// · naSucces(data) · naConflict(data) · toon(tekst, ms) · online() -> boolean · nu() -> ms · maakId() -> string
export function maakVerbruikWachtrij(deps) {
  const { opslag, post, versie, naSucces, naConflict = () => {}, toon, online = () => true, nu = Date.now,
    maakId = () => String(nu()) + Math.random().toString(36).slice(2) } = deps;
  let bezig = false;

  const lees = () => { try { const l = opslag.lees(); return Array.isArray(l) ? l : []; } catch { return []; } };
  const schrijf = lijst => { try { opslag.schrijf(lijst); } catch { /* best-effort */ } };
  const bewaar = (id, wijziging) => schrijf(lees().map(e => e.id === id ? { ...e, ...wijziging } : e));
  const verwijder = id => schrijf(lees().filter(e => e.id !== id));
  const bestaat = id => lees().some(e => e.id === id);

  // Eén verzending, na een 409 opnieuw met de versie uit het antwoord (max MAX_CONFLICTEN keer). `opId` is het id van een
  // wachtrij-item (null bij de eerste poging): dan gaat elke verzending enkel door als het item nog bestaat (een andere tab kan het
  // al gelukt zijn) en staat het tijdens het verzenden op 'onderweg' (lease).
  async function verzend(entry, opId) {
    let v = versie();
    for (let i = 0; i < MAX_CONFLICTEN; i++) {
      if (opId) {
        if (!bestaat(opId)) return { uitkomst: 'weg' };
        bewaar(opId, { bezigTot: nu() + LEASE_MS });
      }
      let r;
      try {
        const res = await post({ versie: v, technieker: entry.technieker, actie: 'verbruik', items: entry.items });
        r = classificeer({ res });
        if (r.uitkomst === 'gelukt') naSucces(res.data);
        if (r.uitkomst === 'conflict') naConflict(res.data?.data);
      } catch (err) {
        r = classificeer({ err });
      }
      if (opId && bestaat(opId)) bewaar(opId, { bezigTot: null });
      if (r.uitkomst !== 'conflict') return r;
      if (typeof r.versie !== 'number' || r.versie === v) return { uitkomst: 'onzeker', detail: 'Serverfout (HTTP 409)' };
      v = r.versie;
    }
    return { uitkomst: 'conflict' };
  }

  function zetInWachtrij(entry) {
    const item = { id: maakId(), technieker: entry.technieker, items: entry.items, aangemaakt: nu(), pogingen: 0, bezigTot: null };
    schrijf([...lees(), item]);
    return item;
  }

  // Eerste poging, direct na het verzenden van het rapport.
  async function meld(technieker, items) {
    const entry = { technieker, items };
    if (!online()) { zetInWachtrij(entry); toon(TEKSTEN.wachtrij, 5000); return; }
    const r = await verzend(entry, null);
    if (r.uitkomst === 'gelukt') return;
    if (r.uitkomst === 'conflict' || r.uitkomst === 'tijdelijk') { zetInWachtrij(entry); toon(TEKSTEN.wachtrij, 5000); return; }
    if (r.uitkomst === 'definitief') { toon(TEKSTEN.definitief, 6000); return; }
    toon(TEKSTEN.onzeker(r.detail || 'onbekende fout'), 6000);
  }

  // Wachtrij verwerken (bij opstart, online-gebeurtenis en poll). Eén verwerker tegelijk per pagina; de lease dekt andere tabs.
  async function verwerk() {
    if (bezig || !online()) return;
    bezig = true;
    try {
      for (const e of lees()) {
        if (e.bezigTot) {
          if (e.bezigTot > nu()) continue;            // een andere tab is bezig
          verwijder(e.id);                              // verzonden, uitkomst onbekend: nooit opnieuw proberen
          toon(TEKSTEN.onzeker('de pagina werd gesloten tijdens het bijwerken'), 6000);
          continue;
        }
        const r = await verzend(e, e.id);
        if (r.uitkomst === 'weg') continue;
        if (r.uitkomst === 'gelukt') { verwijder(e.id); toon(TEKSTEN.alsnog, 4000); continue; }
        if (r.uitkomst === 'definitief') { verwijder(e.id); toon(TEKSTEN.definitief, 6000); continue; }
        if (r.uitkomst === 'onzeker') { verwijder(e.id); toon(TEKSTEN.onzeker(r.detail || 'onbekende fout'), 6000); continue; }
        // conflict (opgebruikt) of tijdelijk: later opnieuw, tot MAX_POGINGEN
        const pogingen = (e.pogingen || 0) + 1;
        if (pogingen >= MAX_POGINGEN) { verwijder(e.id); toon(TEKSTEN.definitief, 6000); continue; }
        bewaar(e.id, { pogingen });
        if (r.uitkomst === 'tijdelijk') break;           // de opslag ligt eruit: de rest heeft geen zin
      }
    } finally { bezig = false; }
  }

  return { meld, verwerk, lees };
}
