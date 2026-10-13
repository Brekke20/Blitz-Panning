// Oorzaak storing in de rapportwizard: de lijst, de groepen en de pure regels (sinds v2.1.3).
// Puur (geen DOM): importeerbaar in `node --test`. De tekening staat in rapport-wizard.js.

export const OORZAAK_GROEPEN = Object.freeze([
  { id: 'toestel', naam: 'Toestel', opties: ['Component defect', 'Laadkabel / socket', 'Software / firmware', 'Schade'] },
  { id: 'communicatie', naam: 'Communicatie en instellingen', opties: ['Verbinding / netwerk', 'OCPP / CPO', 'Configuratie / instellingen', 'Loadbalancing / EMS / sturing', 'RFID / autorisatie'] },
  { id: 'plaatsing', naam: 'Plaatsing en omgeving', opties: ['Installatiefout', 'Netaansluiting / stroomvoorziening', 'Gebruikersfout'] },
  { id: 'overig', naam: 'Overig', opties: ['Geen defect gevonden', 'Andere'] },
]);

export const OORZAAK_LABELS = Object.freeze(OORZAAK_GROEPEN.flatMap(g => g.opties));

export const OORZAAK_FOUT = '⚠ Kies minstens één oorzaak.';

/** Maakt van wat er bewaard staat een nette lijst strings (een concept kan rommel bevatten). */
export function schoneLijst(waarde) {
  return Array.isArray(waarde) ? waarde.filter(x => typeof x === 'string' && x) : [];
}

/** Waarden uit oude rapporten (Productfout, Configuratiefout) die niet meer in de lijst staan. */
export function oudeWaarden(gekozen) {
  return schoneLijst(gekozen).filter(x => !OORZAAK_LABELS.includes(x));
}

/** Zet een label aan of uit; onbekende (oude) waarden blijven staan. */
export function wisselOorzaak(gekozen, label) {
  const lijst = schoneLijst(gekozen);
  return lijst.includes(label) ? lijst.filter(x => x !== label) : [...lijst, label];
}

/** Haalt een oude waarde bewust weg (de chip "(oud) ..."); een waarde uit de lijst blijft staan. */
export function verwijderOud(gekozen, waarde) {
  return schoneLijst(gekozen).filter(x => x !== waarde || OORZAAK_LABELS.includes(x));
}

export function gekozenInGroep(gekozen, groep) {
  const lijst = schoneLijst(gekozen);
  return groep.opties.filter(o => lijst.includes(o));
}

/** Kop-samenvatting van een groep: aantal en labels. */
export function groepSamenvatting(gekozen, groep) {
  const sel = gekozenInGroep(gekozen, groep);
  return { aantal: sel.length, tekst: sel.length ? `${sel.length} gekozen` : '', labels: sel.join(', ') };
}

/** Welke groep staat open bij het openen: de eerste met een keuze, anders de eerste. */
export function standaardOpenGroep(gekozen) {
  const g = OORZAAK_GROEPEN.find(gr => gekozenInGroep(gekozen, gr).length);
  return (g || OORZAAK_GROEPEN[0]).id;
}

/** Foutmelding of undefined. Een oude waarde telt als keuze (het oude rapport blijft geldig). */
export function valideerOorzaak(gekozen) {
  return schoneLijst(gekozen).length ? undefined : OORZAAK_FOUT;
}
