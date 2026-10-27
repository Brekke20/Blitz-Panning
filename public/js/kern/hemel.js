// Open dag-stijl, taak 2: het dagdeel van de hemel (puur; het DOM-deel staat in schermen/hemel-laag.js).
// Ochtend 05:00 tot 10:00, middag 10:00 tot 17:00, avond 17:00 tot 21:00, nacht 21:00 tot 05:00, op het uur van Brussel
// (niet dat van het toestel: een pc op een andere tijdzone toont dezelfde hemel als de planning).
export const TIJDSTIPPEN = Object.freeze(['ochtend', 'middag', 'avond', 'nacht']);

const UUR = new Intl.DateTimeFormat('nl-BE', { timeZone: 'Europe/Brussels', hour: 'numeric', hourCycle: 'h23' });

export function tijdstipVoor(datum) {
  const uur = Number(UUR.format(datum)) % 24;
  if (uur >= 5 && uur < 10) return 'ochtend';
  if (uur >= 10 && uur < 17) return 'middag';
  if (uur >= 17 && uur < 21) return 'avond';
  return 'nacht';
}
