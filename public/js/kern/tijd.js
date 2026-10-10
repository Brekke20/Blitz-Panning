// kern/tijd.js — datum- en tijdhulpen (puur, geen DOM). Alle datums in LOKALE tijd, nooit stil UTC.
// Letterlijk overgenomen uit index.html (etappe 2, Taak 1); `todayISO` is nieuw.

export function localISO(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

// Dynamisch berekend zodat overnight-gebruik correct blijft
export function todayISO(nu = new Date()) { return localISO(nu); }

// ── Gedeelde gekozen datum (Brent-verzoek, proefperiode): Kalender, Route en Ingepland tonen dezelfde week ──
// Alle functies werken op 'YYYY-MM-DD' en op lokale middag (geen DST-sprong).
const isoNaarDatum = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d, 12); };

// Verschuift een datum met `dagen` dagen en/of `maanden` maanden; bij een maandstap wordt de dag begrensd tot de lengte van de doelmaand.
// `ankerDag` (optioneel): de oorspronkelijke dag van de maand bij opeenvolgende maandstappen, zodat 31 jan, 28 feb, 31 mrt niet wegdrijft.
export function verschuifDatum(iso, { dagen = 0, maanden = 0, ankerDag = null } = {}) {
  const d = isoNaarDatum(iso);
  if (maanden) {
    const dag = ankerDag ?? d.getDate();
    d.setDate(1); d.setMonth(d.getMonth() + maanden);
    d.setDate(Math.min(dag, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  }
  if (dagen) d.setDate(d.getDate() + dagen);
  return localISO(d);
}

// De datum waarop Kalender, Route, Ingepland en "Plan deze week" openen: vandaag, behalve in het weekend (zaterdag/zondag, en geen werkdag
// volgens `werkdagen` = getDay()-nummers): dan de eerste werkdag van de KOMENDE week, want de week die voorbij is, valt niets meer te plannen.
export function openingsDatum(nu = new Date(), werkdagen = null) {
  const dag = nu.getDay();
  if ((dag !== 0 && dag !== 6) || (werkdagen && werkdagen.includes(dag))) return localISO(nu);
  const maandag = verschuifDatum(localISO(nu), { dagen: dag === 0 ? 1 : 2 });
  const gewerkt = werkdagen && werkdagen.length ? werkdagen : [1, 2, 3, 4, 5];
  for (let i = 0; i < 7; i++) {
    const iso = verschuifDatum(maandag, { dagen: i });
    if (gewerkt.includes(isoNaarDatum(iso).getDay())) return iso;
  }
  return maandag;
}

// Aantal weken tussen de week van `vandaagIso` en de week van `iso` (negatief = verleden); de oude `kalOffset`.
export function weekVerschil(iso, vandaagIso) {
  const a = getWeekStart(isoNaarDatum(iso), 0), b = getWeekStart(isoNaarDatum(vandaagIso), 0);
  return Math.round((a - b) / (7 * 86400000));
}

// Eerstvolgende werkdag (`stap` = 1) of vorige werkdag (-1) vóór/na `iso`; `werkdagen` = getDay()-nummers. Zonder werkdagen: één dag verder.
export function volgendeWerkdagVan(iso, werkdagen, stap) {
  if (!werkdagen || !werkdagen.length) return verschuifDatum(iso, { dagen: stap });
  let d = iso;
  for (let i = 0; i < 7; i++) { d = verschuifDatum(d, { dagen: stap }); if (werkdagen.includes(isoNaarDatum(d).getDay())) return d; }
  return d;
}

export function getWeekStart(baseDate, offset) {
  const d = new Date(baseDate); d.setHours(0,0,0,0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7);
  return d;
}

export function minToTimeStr(totalMin) {
  const hh = String(Math.floor((totalMin || 0) / 60) % 24).padStart(2, '0');
  const mm  = String((totalMin || 0) % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function timeStrToMin(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function fmtDate(s)     { return new Date(s).toLocaleDateString('nl-BE', { weekday:'short', day:'numeric', month:'short', year:'numeric' }); }
export function fmtDateShort(d){ const date = d instanceof Date ? d : new Date(String(d).includes('T') ? d : d + 'T12:00:00'); return date.toLocaleDateString('nl-BE', { day:'numeric', month:'short' }); }
export function fmtSec(s)      { const h = Math.floor(s/3600), m = Math.round((s%3600)/60); return h > 0 ? `${h}u ${m}min` : `${m}min`; }

// Haal lokaal uur:minuten op uit een ISO interventieDatum-string (null als 00:00 = geen uur)
export function extractLocalHour(interventieDatum) {
  if (!interventieDatum) return null;
  const d = new Date(interventieDatum);
  const h = d.getHours(), m = d.getMinutes();
  // Sentinel: lokale middernacht (00:00) = geen tijdstip.
  // Ook UTC-middernacht detecteren voor backward compat met oude plan.js records (T00:00:00.000Z).
  if (h === 0 && m === 0) return null;
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && interventieDatum.endsWith('Z')) return null;
  return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
}
