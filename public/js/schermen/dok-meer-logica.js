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
