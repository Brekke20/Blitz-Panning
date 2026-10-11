// schermen/beschikbaarheid-logica.js — pure delen van de blokkeringen (etappe 5b, D18): volgende werkdag en weergave-groepering.
// De code is letterlijk uit index.html verhuisd; enkel `werkdagen` (vroeger `settings.werkdagen`) is nu een parameter.
// Geen DOM, geen toestand.
import { valideerBlok, isHeleDag } from '../sales/blok-regels.js';

// Volgende werkdag na `dateStr` ('YYYY-MM-DD'); `werkdagen` = lijst getDay()-nummers (zo = 0).
// Is er geen enkele werkdag aangevinkt, dan bestaat er geen volgende werkdag: null (anders oneindige lus).
export function nextWorkday(dateStr, werkdagen) {
  if (![0, 1, 2, 3, 4, 5, 6].some(dag => werkdagen.includes(dag))) return null;
  const d = new Date(dateStr + 'T12:00:00');
  do { d.setDate(d.getDate() + 1); } while (!werkdagen.includes(d.getDay()));
  return d.toISOString().split('T')[0];
}

// Groepeert opeenvolgende 'hele dag'-uitzondering-rijen met dezelfde persoon/scope/reden tot één
// weergave-periode (bv. "17 aug – 21 aug 2026"), zodat een meerdaags verlof niet als N losse
// regels verschijnt. Zuiver een WEERGAVE-groepering: de onderliggende data blijft N losse
// avExceptions-records (nodig voor capacityForDay() in schermen/capaciteit.js en de kalender-dagblokkering, die per dag
// werken) -- verwijderen van een periode verwijdert wel alle onderliggende records ineens, zie
// avRemoveExceptionGroup(). Rijen worden enkel samengevoegd als ze ook echt op elkaar aansluiten
// (via nextWorkday) -- anders zou bv. verlof op 24-26 aug gevolgd door los verlof op
// 28 aug (met een gewone werkdag ertussen) foutief tonen als "24 aug – 28 aug".
export function groupExceptionsForDisplay(sortedList, werkdagen) {
  const groups = [];
  sortedList.forEach(e => {
    const last = groups[groups.length - 1];
    // Geen werkdagen -> nextWorkday geeft null -> niets sluit aan, elke rij blijft apart.
    const volgende = last ? nextWorkday(last.endDate, werkdagen) : null;
    const aaneensluitend = last && volgende !== null && volgende === e.date;
    if (last && aaneensluitend && e.kind === 'fullday' && last.kind === 'fullday' &&
        last.scope === e.scope && last.person === e.person && last.reason === e.reason) {
      last.items.push(e);
      last.endDate = e.date;
    } else {
      groups.push({ kind: e.kind, scope: e.scope, person: e.person, reason: e.reason,
                     startDate: e.date, endDate: e.date, items: [e] });
    }
  });
  return groups;
}

// Controle van een nieuw blokkeringsformulier (B8), gedeeld door het venster en de tab "Beschikbaarheden". Volgorde van de controles:
// eindtijd na begintijd, datum ingevuld, einddatum ingevuld (periode), einddatum niet voor startdatum.
// De melding "geen werkdagen in deze periode" blijft in de uitbreidingslus (die heeft `werkdagen` nodig).
export function valideerNieuweBlokkering({ kind, meerdaags, datum, datumTot, van, tot }) {
  if (kind === 'range' && van >= tot) return { ok: false, melding: '⚠ Eindtijd moet na begintijd liggen' };
  if (!datum) return { ok: false, melding: '⚠ Kies een datum' };
  if (kind === 'fullday' && meerdaags) {
    if (!datumTot) return { ok: false, melding: '⚠ Kies een einddatum, of vink "Meerdere werkdagen" uit' };
    if (datumTot < datum) return { ok: false, melding: '⚠ Einddatum moet na startdatum liggen' };
  }
  return { ok: true };
}

// De keuzelijst "Voor wie" in Beheer → Beschikbaarheden. `gebruikers` = de lijst van GET /api/gebruikers (id/naam/rol/zohoNaam/actief)
// of null/geen array als die niet geladen kon worden. Geladen: enkel actieve accounts met een Zoho-naam, op die Zoho-naam (de waarde die in de
// afwezigheden als `person` bewaard wordt). Niet geladen: terugval op het oude gedrag (assignees van tickets + personen uit bestaande afwezigheden).
// `ticketLijsten` = lijsten tickets (allTickets/allGepland/allPending), `exceptions` = avExceptions.
export function bouwPersonenlijst({ gebruikers, ticketLijsten = [], exceptions = [] } = {}) {
  const uniek = (namen) => [...new Set(namen.map(n => (typeof n === 'string' ? n.trim() : '')).filter(Boolean))].sort();
  if (Array.isArray(gebruikers)) {
    return uniek(gebruikers.filter(g => g && g.actief === true).map(g => g.zohoNaam));
  }
  return uniek([
    ...ticketLijsten.flatMap(lijst => (Array.isArray(lijst) ? lijst : []).map(t => t?.assignee)),
    ...(Array.isArray(exceptions) ? exceptions : []).map(e => e?.person),
  ]);
}

// ── "Voor wie" met alle accounts (Beheer → Beschikbaarheden) ─────────────────────────────────────────────────────────
// Techniekers (en planners/beheerders met een Zoho-naam) krijgen hun afwezigheid in /api/availability (op Zoho-naam); een verkoper
// heeft geen Zoho-naam en krijgt ze als blok in zijn eigen sales-agenda. De keuzewaarde van een verkoper is 'verkoper:<id>'.
export const VERKOPER_PREFIX = 'verkoper:';
export const verkoperWaarde = (id) => VERKOPER_PREFIX + id;
export const verkoperIdUitWaarde = (waarde) => (typeof waarde === 'string' && waarde.startsWith(VERKOPER_PREFIX) && waarde.length > VERKOPER_PREFIX.length ? waarde.slice(VERKOPER_PREFIX.length) : null);

const ROL_LABEL = { technieker: 'technieker', planner: 'planner', beheerder: 'beheerder', sales: 'verkoper' };
const ROL_VOLGORDE = { technieker: 0, planner: 1, beheerder: 2 };
const metNaam = (t) => (typeof t === 'string' ? t.trim() : '');

// `gebruikers` = lijst van GET /api/gebruikers, of iets anders (niet geladen) -> null (de oproeper valt terug op bouwPersonenlijst).
// -> { techniek: [{ waarde: zohoNaam, label: 'Tim (technieker)', rol }], sales: [{ waarde: 'verkoper:<id>', id, naam, label: 'Bea V. (verkoper)', rol: 'sales' }] }
// Enkel actieve accounts. Techniek: elke rol met een Zoho-naam (een planner of beheerder zonder Zoho-naam plant niet en staat er niet in;
// dubbele namen tellen één keer, de technieker voor de planner). Sales: enkel de verkopers, enkel voor de beheerder (`kijkerRol`): de planner
// ziet alleen de groep Techniek.
export function bouwVoorWieGroepen({ gebruikers, kijkerRol = 'beheerder' } = {}) {
  if (!Array.isArray(gebruikers)) return null;
  const actief = gebruikers.filter(g => g && typeof g === 'object' && g.actief === true);
  const perNaam = new Map();
  for (const g of [...actief].sort((a, b) => (ROL_VOLGORDE[a.rol] ?? 9) - (ROL_VOLGORDE[b.rol] ?? 9))) {
    const zoho = metNaam(g.zohoNaam);
    if (!zoho || g.rol === 'sales' || perNaam.has(zoho)) continue;
    perNaam.set(zoho, { waarde: zoho, label: `${zoho} (${ROL_LABEL[g.rol] ?? g.rol})`, rol: g.rol });
  }
  const techniek = [...perNaam.values()].sort((a, b) => a.waarde.localeCompare(b.waarde));
  const sales = kijkerRol !== 'beheerder' ? [] : actief
    .filter(g => g.rol === 'sales' && typeof g.id === 'string' && g.id !== '')
    .map(g => { const naam = metNaam(g.salesNaam) || metNaam(g.naam) || g.id; return { waarde: verkoperWaarde(g.id), id: g.id, naam, label: `${naam} (verkoper)`, rol: 'sales' }; })
    .sort((a, b) => a.naam.localeCompare(b.naam));
  return { techniek, sales };
}

const pad2 = (n) => String(n).padStart(2, '0');
const isoLokaal = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

// Het formulier van de tab -> de sales-blokken van een verkoper (soort 'verlof'; de reden wordt de omschrijving). Hele dag = 00:00-23:59 (isHeleDag);
// meerdere werkdagen = één blok per werkdag. -> { blokken } | { fout }. De server valideert opnieuw (valideerBlok).
export function maakVerkoperBlokken({ kind, meerdaags, datum, datumTot, van, tot, reden, werkdagen }) {
  const omschrijving = typeof reden === 'string' ? reden.trim() : '';
  const maak = (dag, start, eind) => {
    const r = valideerBlok({ datum: dag, start, eind, soort: 'verlof', ...(omschrijving ? { omschrijving } : {}) });
    return r.fout ? { fout: `⚠ ${r.fout}` } : { blok: r.blok };
  };
  if (kind === 'range') {
    const r = maak(datum, van, tot);
    return r.fout ? r : { blokken: [r.blok] };
  }
  if (!meerdaags) {
    const r = maak(datum, '00:00', '23:59');
    return r.fout ? r : { blokken: [r.blok] };
  }
  const blokken = [];
  const einde = new Date(datumTot + 'T12:00:00');
  for (const cur = new Date(datum + 'T12:00:00'); cur <= einde; cur.setDate(cur.getDate() + 1)) {
    if (!werkdagen.includes(cur.getDay())) continue;
    const r = maak(isoLokaal(cur), '00:00', '23:59');
    if (r.fout) return r;
    blokken.push(r.blok);
  }
  return blokken.length ? { blokken } : { fout: '⚠ In deze periode zijn er geen werkdagen. Kies andere data.' };
}

// De komende afwezigheden van een verkoper (vanaf `vandaag`) uit zijn sales-blokken, in dezelfde vorm als een afwezigheid, zodat
// groupExceptionsForDisplay ze kan samenvoegen: { id, scope:'person', person: naam, date, kind:'fullday'|'range', from, to, reason }.
// ENKEL soort 'verlof' (en een hele-dag-blok zonder soort): kantoor, afspraak en andere blokken zijn geen afwezigheid en worden hier niet getoond,
// dus ook niet verwijderbaar vanuit Beheer. Gesorteerd op datum en begin.
export function verkoperBlokkenNaarUitzonderingen(blokken, { naam, vandaag }) {
  return (Array.isArray(blokken) ? blokken : [])
    .filter(b => b && typeof b.datum === 'string' && b.datum >= vandaag && (b.soort === 'verlof' || (!b.soort && isHeleDag(b))))
    .map(b => ({
      id: b.id, scope: 'person', person: naam, date: b.datum, kind: isHeleDag(b) ? 'fullday' : 'range', from: b.start, to: b.eind,
      reason: typeof b.omschrijving === 'string' ? b.omschrijving.trim() : '',
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.from).localeCompare(String(b.from)));
}
