// schermen/beheer-activiteit-logica.js — pure delen van de tab Activiteitenlog (logins T18): labels van de actienamen,
// de querystring van /api/activiteit, groeperen per Brusselse kalenderdag en de standaardperiode. Geen DOM, geen opslag.

const LABELS = Object.freeze({
  'login': 'Ingelogd',
  'login-mislukt-reeks': 'Reeks mislukte logins',
  'uitloggen': 'Uitgelogd',
  'wachtwoord-gewijzigd': 'Wachtwoord gewijzigd',
  'herstel': 'Herstel met code',
  'herstel-mislukt-reeks': 'Reeks mislukte herstelpogingen',
  'gebruiker-aangemaakt': 'Gebruiker aangemaakt',
  'gebruiker-gewijzigd': 'Gebruiker gewijzigd',
  'gebruiker-geblokkeerd': 'Gebruiker geblokkeerd',
  'gebruiker-verwijderd': 'Gebruiker verwijderd',
  'plannen': 'Ingepland',
  'voorstel-verstuurd': 'Voorstel verstuurd',
  'annulatie': 'Geannuleerd',
  'rapport-verstuurd': 'Rapport verstuurd',
  'rapport-opnieuw': 'Rapport opnieuw verstuurd',
  'rapport-geweigerd': 'Rapport geweigerd',
  'rapport-verwijderd': 'Rapport verwijderd',
  'sales-import': 'Sales-import',
  'sales-lead-verwijderd': 'Sales-lead verwijderd',
  'sales-resultaat': 'Sales-resultaat',
  'instellingen-gewijzigd': 'Instellingen gewijzigd',
  'wachtwoord-gereset': 'Wachtwoord gereset',
  'foto-toegevoegd': 'Foto toegevoegd',
  'notitie-toegevoegd': 'Notitie toegevoegd',
});

// Alle bekende actienamen (voor de keuzelijst), in de volgorde van de labels.
export const ACTIES = Object.freeze(Object.keys(LABELS));

// Onbekend -> de ruwe naam (een nieuwe actie breekt het scherm niet); geen tekst -> ''.
export function actieLabel(actie) {
  if (typeof actie !== 'string') return '';
  return Object.hasOwn(LABELS, actie) ? LABELS[actie] : actie;
}

// '/api/activiteit?van=..&tot=..&gebruiker=..&actie=..' met enkel de ingevulde filters.
export function bouwActiviteitUrl({ van, tot, gebruiker, actie } = {}) {
  const delen = [];
  for (const [naam, waarde] of [['van', van], ['tot', tot], ['gebruiker', gebruiker], ['actie', actie]]) {
    if (typeof waarde === 'string' && waarde !== '') delen.push(`${naam}=${encodeURIComponent(waarde)}`);
  }
  return delen.length ? `/api/activiteit?${delen.join('&')}` : '/api/activiteit';
}

const BRUSSEL = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' });

// ISO-tijdstip (of Date/ms) -> 'YYYY-MM-DD' op de Brusselse kalender; geen geldige tijd -> ''.
export function brusselDag(op) {
  const d = op instanceof Date ? op : new Date(op);
  if (Number.isNaN(d.getTime())) return '';
  return BRUSSEL.format(d);
}

// Groepen { dag, items }, de nieuwste dag eerst en binnen een dag de nieuwste eerst; items zonder geldige tijd komen
// onderaan in de groep met dag ''. Muteert de invoer niet.
export function groepeerPerDag(items) {
  if (!Array.isArray(items)) return [];
  const tijd = it => { const t = Date.parse(it?.op); return Number.isNaN(t) ? null : t; };
  const gesorteerd = [...items].sort((a, b) => (tijd(b) ?? -Infinity) - (tijd(a) ?? -Infinity));
  const groepen = [];
  for (const it of gesorteerd) {
    const dag = tijd(it) === null ? '' : brusselDag(it.op);
    const laatste = groepen[groepen.length - 1];
    if (laatste && laatste.dag === dag) laatste.items.push(it);
    else groepen.push({ dag, items: [it] });
  }
  return groepen;
}

// De laatste 30 dagen: { van, tot } als 'YYYY-MM-DD', tot = vandaag (Brussel). `nu`: Date, ms, ISO-tekst of 'YYYY-MM-DD'.
export function standaardPeriode(nu = new Date()) {
  const bron = typeof nu === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(nu) ? new Date(`${nu}T12:00:00Z`) : new Date(nu);
  const tot = brusselDag(bron);
  if (!tot) return standaardPeriode(new Date());
  const [j, m, d] = tot.split('-').map(Number);
  const van = new Date(Date.UTC(j, m - 1, d - 30)).toISOString().slice(0, 10);
  return { van, tot };
}

// 'YYYY-MM-DD' -> 'woensdag 8 oktober 2026' (Brusselse kalenderdag); '' of ongeldig -> 'Onbekende datum'.
export function formatDagKop(dag) {
  if (typeof dag !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dag)) return 'Onbekende datum';
  return new Intl.DateTimeFormat('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Brussels' })
    .format(new Date(`${dag}T12:00:00Z`));
}

// ISO -> 'HH:mm' (Brussel); ongeldig -> '—'.
export function formatUur(op) {
  const d = new Date(op);
  if (typeof op !== 'string' || Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('nl-BE', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Brussels' }).format(d);
}

// ISO -> 'dd/mm/jjjj uu:mm' (Brussel); ongeldig of leeg -> '—'.
export function formatDatumTijd(iso) {
  const d = new Date(iso);
  if (typeof iso !== 'string' || iso === '' || Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('nl-BE', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Brussels',
  }).format(d).replace(',', '');
}
