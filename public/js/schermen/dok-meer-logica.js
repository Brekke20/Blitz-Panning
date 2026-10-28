// schermen/dok-meer-logica.js — puur (Open dag, taak 6): hoe de zichtbare tabbladen over het dok en het "Meer"-blad verdeeld worden.
// Passen er hoogstens `max` tabs, dan staan ze allemaal in het dok. Anders staan de eerste `max - 1` in het dok en de rest achter "Meer",
// zodat "Meer" zelf de laatste (max-ste) plek van het dok inneemt. Is het actieve tabblad een van de overige, dan is "Meer" actief.

/**
 * @param {string[]} ids   tab-id's in de volgorde van het dok (enkel de zichtbare)
 * @param {string|null} actiefId  id van het actieve tabblad (of null)
 * @param {number} [max=5] aantal plekken in het dok, "Meer" meegeteld
 * @returns {{ inDok: string[], inMeer: string[], meerActief: boolean }}
 */
export function dokVerdeling(ids, actiefId, max = 5) {
  const lijst = Array.isArray(ids) ? ids : [];
  if (lijst.length <= max) return { inDok: [...lijst], inMeer: [], meerActief: false };
  const inDok = lijst.slice(0, max - 1);
  const inMeer = lijst.slice(max - 1);
  return { inDok, inMeer, meerActief: actiefId != null && inMeer.includes(actiefId) };
}

// Taak 18: het bolletje op de knop "Meer". Het volgt de tellers van de tabs die achter Meer zitten: één zichtbare teller is genoeg.
// Een teller is { tekst, verborgen, op, bijna } (of null/undefined voor een tab zonder teller); `op` en `bijna` zijn de statusklassen
// badge--op en badge--bijna. Een lege teller, een nul en een verborgen teller tellen niet mee.
// Kleur: 'op' (rood) boven 'bijna' (oranje) boven 'gewoon' (accent); null = geen bolletje.
const isNul = (tekst) => {
  const t = String(tekst ?? '').trim();
  return t === '' || (Number.isFinite(Number(t)) && Number(t) === 0);
};

/**
 * @param {Array<{tekst: string, verborgen?: boolean, op?: boolean, bijna?: boolean}|null|undefined>} tellers
 * @returns {'op'|'bijna'|'gewoon'|null}
 */
export function meerBolletje(tellers) {
  const zichtbaar = (Array.isArray(tellers) ? tellers : []).filter(t => t && !t.verborgen && !isNul(t.tekst));
  if (!zichtbaar.length) return null;
  if (zichtbaar.some(t => t.op)) return 'op';
  if (zichtbaar.some(t => t.bijna)) return 'bijna';
  return 'gewoon';
}

// De aria-label van "Meer" bij een bolletje (null = geen bolletje, dus de gewone naam).
export function meerBolletjeLabel(kleur) {
  if (kleur === 'op') return 'Meer, voorraad op';
  if (kleur === 'bijna') return 'Meer, voorraad bijna op';
  if (kleur === 'gewoon') return 'Meer, nieuwe meldingen';
  return null;
}
