// "Eigen"-regels voor de technieker (pure functies, geen I/O).
// Een technieker leest alles maar schrijft enkel zijn eigen afspraken/verlof, wagenvoorraad en rapporten.
// Planner en beheerder zijn nergens beperkt; sales heeft geen eigen data.
import { isDeepStrictEqual } from 'node:util';
import { normaliseerNaam } from './gebruikers.js';

// true als `naam` bij deze gebruiker hoort: technieker met zohoNaam (genormaliseerd gelijk, niet leeg);
// planner en beheerder altijd; alle anderen (sales, geen gebruiker) nooit.
export function isEigenNaam(gebruiker, naam) {
  const rol = gebruiker?.rol;
  if (rol === 'planner' || rol === 'beheerder') return true;
  if (rol !== 'technieker') return false;
  const eigen = normaliseerNaam(gebruiker.zohoNaam);
  return eigen !== '' && eigen === normaliseerNaam(naam);
}

// Vergelijkt de lijst zoals ze nu bewaard is met de (opgeschoonde) lijst die de technieker wil bewaren.
// Elk toegevoegd, gewijzigd of verwijderd item moet van hem zijn (ook de oude eigenaar bij een wijziging);
// items zonder eigenaar (`eigenaar(item)` null, bv. globale blokkades) kan hij niet veranderen.
// Beide lijsten moeten met dezelfde opschoning zijn gemaakt, anders telt een verschil in vorm als wijziging.
export function eigenWijzigingen(oudeLijst, nieuweLijst, { sleutel = 'id', eigenaar, gebruiker } = {}) {
  const eigen = item => isEigenNaam(gebruiker, eigenaar(item));
  const oud = new Map();
  for (const item of oudeLijst ?? []) if (!oud.has(item[sleutel])) oud.set(item[sleutel], item);

  const gezien = new Set();
  for (const item of nieuweLijst ?? []) {
    const k = item[sleutel];
    const vorig = gezien.has(k) ? undefined : oud.get(k);
    gezien.add(k);
    if (vorig === undefined) {
      if (!eigen(item)) return { ok: false, reden: 'Je kan enkel je eigen items toevoegen.' };
    } else if (!isDeepStrictEqual(vorig, item)) {
      if (!eigen(vorig) || !eigen(item)) return { ok: false, reden: 'Je kan enkel je eigen items wijzigen.' };
    }
  }
  for (const [k, vorig] of oud) {
    if (!gezien.has(k) && !eigen(vorig)) return { ok: false, reden: 'Je kan enkel je eigen items verwijderen.' };
  }
  return { ok: true };
}

// Technieker: enkel rapporten met zijn eigen `technieker`; anderen alles.
export function filterRapportenVoor(gebruiker, rapports) {
  const lijst = Array.isArray(rapports) ? rapports : [];
  if (gebruiker?.rol !== 'technieker') return lijst;
  return lijst.filter(r => isEigenNaam(gebruiker, r?.technieker));
}
