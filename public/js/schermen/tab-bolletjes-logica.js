// schermen/tab-bolletjes-logica.js — puur (Open dag, taak 19): wat het bolletje van een tabteller betekent.
// De tellers van de tabbladen (.badge) tonen geen cijfer meer maar een bolletje (css/navigatie.css). Het cijfer blijft in de DOM; de
// kleur en de tekst voor schermlezers volgen uit deze functies. Een teller is { tekst, verborgen, op, bijna }: `op` en `bijna` zijn de
// statusklassen badge--op en badge--bijna.

// Leeg of nul: geen bolletje.
export const isNul = (tekst) => {
  const t = String(tekst ?? '').trim();
  return t === '' || (Number.isFinite(Number(t)) && Number(t) === 0);
};

/**
 * @param {{tekst: string, verborgen?: boolean, op?: boolean, bijna?: boolean}|null|undefined} teller
 * @returns {'op'|'bijna'|'gewoon'|null} null = geen bolletje (geen teller, verborgen of nul)
 */
export function tellerKleur(teller) {
  if (!teller || teller.verborgen || isNul(teller.tekst)) return null;
  if (teller.op) return 'op';
  if (teller.bijna) return 'bijna';
  return 'gewoon';
}

/**
 * De aria-label van een tab met een bolletje: de naam plus wat het bolletje zegt (null = gewone naam, dus geen label).
 * 'op' en 'bijna' zeggen hetzelfde als de label van "Meer" (dok-meer-logica.js); een gewone teller: "Wachtrij, 3 nieuw".
 */
export function tellerLabel(naam, kleur, tekst) {
  if (!kleur || !naam) return null;
  if (kleur === 'op') return `${naam}, voorraad op`;
  if (kleur === 'bijna') return `${naam}, voorraad bijna op`;
  return `${naam}, ${String(tekst).trim()} nieuw`;
}
