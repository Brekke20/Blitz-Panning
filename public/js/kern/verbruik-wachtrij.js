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
//
// Gelijktijdigheid (twee tabs): `verwerk` draait binnen een `slot` (navigator.locks in de browser; bezet slot = ronde overslaan).
// Zonder slot valt de code terug op een lease met eigenaar-token: voor elke POST wordt het item vers gelezen, de lease gezet en teruggelezen;
// een item met een lopende lease van een ander wordt overgeslagen. De lease wordt nooit apart gewist: ze verdwijnt samen met het item
// (gelukt/onzeker/definitief) of samen met de nieuwe stand (pogingen) bij een zekere mislukking.
// Elke aftrek staat vóór de eerste POST met lease in de opslag, zodat een pagina die tijdens de POST sluit een spoor nalaat (later: 'onzeker').

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
  if (res.status >= 200 && res.status < 300) {
    // Geslaagd, maar zonder leesbare stand: de aftrek kan gebeurd zijn; nooit opnieuw proberen.
    return res.data == null ? { uitkomst: 'onzeker', detail: 'onleesbaar antwoord van de server' } : { uitkomst: 'gelukt' };
  }
  if (res.status === 409) return { uitkomst: 'conflict', versie: res.data?.data?.versie ?? res.data?.serverVersie };
  if (res.status === 503 && /Inventaris-opslag/.test(res.data?.error || '')) return { uitkomst: 'tijdelijk' };
  if (res.status >= 400 && res.status < 500) return { uitkomst: 'definitief' };
  return { uitkomst: 'onzeker', detail: `Serverfout (HTTP ${res.status})` };
}

// Per gebruiker (logins T16): een nieuw item krijgt het id van de ingelogde gebruiker (`gebruikerId`). Onder de sessie van een ANDERE
// gebruiker wordt zo'n item niet verzonden (de server zou het met 403 weigeren en het zou als 'definitief' verdwijnen) maar bewaard
// tot de eigenaar weer inlogt. Items zonder eigenaar (van vóór deze wijziging) worden zoals vroeger verwerkt.
export function hoortBijGebruiker(item, gebruikerId) {
  if (!item || item.gebruikerId === undefined || item.gebruikerId === null) return true;
  return typeof gebruikerId === 'string' && item.gebruikerId === gebruikerId;
}

// deps: opslag { lees(), schrijf(lijst) } · post(body) -> { status, data } (gooit bij netwerkfout/time-out) · versie() -> huidige versie
// · naSucces(data) · naConflict(data) · toon(tekst, ms) · online() -> boolean · nu() -> ms · maakId() -> string
// · slot(fn) -> Promise: voert fn uit als het slot vrij is (anders niet); standaard zonder slot.
// · gebruikerId() -> id van de ingelogde gebruiker of null (standaard null: nieuwe items krijgen dan geen eigenaar).
export function maakVerbruikWachtrij(deps) {
  const { opslag, post, versie, naSucces, naConflict = () => {}, toon, online = () => true, nu = Date.now,
    maakId = () => String(nu()) + Math.random().toString(36).slice(2), slot = null, gebruikerId = () => null } = deps;
  const ik = 'eig-' + maakId();
  let bezig = false;

  const lees = () => { try { const l = opslag.lees(); return Array.isArray(l) ? l : []; } catch { return []; } };
  const schrijf = lijst => { try { opslag.schrijf(lijst); } catch { /* best-effort */ } };
  const vind = id => lees().find(e => e.id === id) || null;
  const bewaar = (id, wijziging) => schrijf(lees().map(e => e.id === id ? { ...e, ...wijziging } : e));
  const verwijder = id => schrijf(lees().filter(e => e.id !== id));
  const levend = e => !!(e && e.bezigTot && e.bezigTot > nu());

  // Neemt de lease van een bestaand item: vers lezen, afbreken als een ander ze heeft, zetten en teruglezen.
  function neemLease(id) {
    const e = vind(id);
    if (!e) return false;
    if (levend(e) && e.eigenaar !== ik) return false;
    bewaar(id, { bezigTot: nu() + LEASE_MS, eigenaar: ik });
    const na = vind(id);
    return !!na && na.eigenaar === ik;
  }

  // Eén verzending voor een wachtrij-item dat al bestaat (met onze lease), na een 409 opnieuw met de versie uit het antwoord
  // (max MAX_CONFLICTEN keer). De lease blijft tussen de pogingen gehouden; de oproeper wist ze samen met de nieuwe toestand.
  async function verzend(entry, opId) {
    let v = versie();
    for (let i = 0; i < MAX_CONFLICTEN; i++) {
      if (!neemLease(opId)) return { uitkomst: 'weg' };
      let r;
      try {
        const res = await post({ versie: v, technieker: entry.technieker, actie: 'verbruik', items: entry.items });
        r = classificeer({ res });
        if (r.uitkomst === 'gelukt') naSucces(res.data);
        if (r.uitkomst === 'conflict') naConflict(res.data?.data);
      } catch (err) {
        r = classificeer({ err });
      }
      if (r.uitkomst !== 'conflict') return r;
      if (typeof r.versie !== 'number' || r.versie === v) return { uitkomst: 'onzeker', detail: 'HTTP 409 zonder bruikbare stand' };
      v = r.versie;
    }
    return { uitkomst: 'conflict' };
  }

  // Verwerkt de uitkomst van een verzending voor item `e` (lease gaat samen met het item of met de nieuwe stand).
  // `uitWachtrij`: toon de "alsnog"-melding bij succes.
  function afronden(e, r, { uitWachtrij }) {
    if (r.uitkomst === 'weg') return 'weg';
    if (r.uitkomst === 'gelukt') { verwijder(e.id); if (uitWachtrij) toon(TEKSTEN.alsnog, 4000); return 'klaar'; }
    if (r.uitkomst === 'definitief') { verwijder(e.id); toon(TEKSTEN.definitief, 6000); return 'klaar'; }
    if (r.uitkomst === 'onzeker') { verwijder(e.id); toon(TEKSTEN.onzeker(r.detail || 'onbekende fout'), 6000); return 'klaar'; }
    // conflict (opgebruikt) of tijdelijk: zeker niets geschreven; later opnieuw, tot MAX_POGINGEN
    const pogingen = (e.pogingen || 0) + (uitWachtrij ? 1 : 0);
    if (uitWachtrij && pogingen >= MAX_POGINGEN) { verwijder(e.id); toon(TEKSTEN.definitief, 6000); return 'klaar'; }
    bewaar(e.id, { pogingen, bezigTot: null, eigenaar: null });
    return r.uitkomst;
  }

  // Eerste poging, direct na het verzenden van het rapport. Het item staat met lease in de opslag vóór de POST.
  async function meld(technieker, items) {
    const eigenaarId = gebruikerId();
    const e = { id: maakId(), technieker, items, aangemaakt: nu(), pogingen: 0, bezigTot: null, eigenaar: null, ...(typeof eigenaarId === 'string' && eigenaarId ? { gebruikerId: eigenaarId } : {}) };
    if (!online()) { schrijf([...lees(), e]); toon(TEKSTEN.wachtrij, 5000); return; }
    schrijf([...lees(), { ...e, bezigTot: nu() + LEASE_MS, eigenaar: ik }]);
    const r = await verzend(e, e.id);
    const uit = afronden(e, r, { uitWachtrij: false });
    if (uit === 'conflict' || uit === 'tijdelijk') toon(TEKSTEN.wachtrij, 5000);
  }

  async function verwerkRonde() {
    if (bezig || !online()) return;
    bezig = true;
    try {
      for (const id of lees().map(e => e.id)) {
        const e = vind(id);                                 // vers lezen: een andere tab kan het al afgehandeld hebben
        if (!e) continue;
        if (!hoortBijGebruiker(e, gebruikerId())) continue; // van een andere gebruiker: laten staan (niet verzenden, niet verwijderen)
        if (e.bezigTot) {
          if (levend(e)) continue;                          // iemand (ook wij) is ermee bezig
          verwijder(e.id);                                  // verzonden, uitkomst onbekend: nooit opnieuw proberen
          toon(TEKSTEN.onzeker('de pagina werd gesloten tijdens het bijwerken'), 6000);
          continue;
        }
        const r = await verzend(e, e.id);
        const uit = afronden(e, r, { uitWachtrij: true });
        if (uit === 'tijdelijk') break;                     // de opslag ligt eruit: de rest heeft geen zin
      }
    } finally { bezig = false; }
  }

  // Wachtrij verwerken (bij opstart, online-gebeurtenis en poll), binnen het slot als er een is.
  async function verwerk() {
    if (slot) await slot(verwerkRonde); else await verwerkRonde();
  }

  return { meld, verwerk, lees };
}
