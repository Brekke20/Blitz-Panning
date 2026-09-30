// Planner-brein: puur (geen DOM, geen globals). Bepaalt welk ticket op welke dag komt.
// Taak 1: het bestaande algoritme van autoPlan() ongewijzigd verhuisd (karakterisatie).
// Tijden binnen het brein zijn minuten na middernacht (lokaal); datums 'YYYY-MM-DD'.

const PRIO_WEIGHT = { high: 1, medium: 3, low: 6 };

function timeStrToMin(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function minNaarUur(min) {
  const m = Math.round(min);
  return String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}

export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Urgentie: daalt naarmate de due date nadert (max 1.0, min 0.1); zonder due date neutraal 1.0.
function urgentieFactor(t, vandaag) {
  if (!t.interventieDatum) return 1.0;
  const today0 = new Date(vandaag + 'T00:00:00');
  const due = new Date(t.interventieDatum); due.setHours(0, 0, 0, 0);
  return Math.max(0.1, Math.min(1.0, (due - today0) / 86400000 / 7));
}

// Kalenderdag 'YYYY-MM-DD' van een datum of ISO-tijdstip (lokale dag, zoals urgentieFactor).
function dagVan(x) {
  if (!x) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(x)) return x;
  const d = new Date(x);
  if (isNaN(d)) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const VOORRANG_PRIO = { high: 3, medium: 2, low: 1 };

// R3 (spec 3.2): prioBasis + wachtBonus. Doorlopend: min(1.5, 0.5 x dagenInPlanning / 7);
// achterstallig (interventieDatum < vandaag) => 1.5; zonder inPlanningSinds geen wachtbonus.
export function voorrang(kandidaat, vandaag) {
  const basis = VOORRANG_PRIO[String(kandidaat.priority || '').toLowerCase()] ?? 1;
  let bonus = 0;
  const sinds = dagVan(kandidaat.inPlanningSinds);
  if (sinds) {
    const dagen = (Date.parse(vandaag + 'T00:00:00Z') - Date.parse(sinds + 'T00:00:00Z')) / 86400000;
    bonus = Math.min(1.5, 0.5 * Math.max(0, dagen) / 7);
  }
  const due = dagVan(kandidaat.interventieDatum);
  if (due && due < vandaag) bonus = 1.5;
  return basis + bonus;
}

// Zet minuten-na-middernacht om naar een ISO-datetime voor de gegeven dag (vertrekmoment).
function minToDepartAt(dateStr, minutesSinceMidnight) {
  const h = Math.floor(minutesSinceMidnight / 60) % 24;
  const m = Math.floor(minutesSinceMidnight) % 60;
  return new Date(`${dateStr}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).toISOString();
}

function isoPlusDagen(datum, n) {
  const d = new Date(datum + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// R2: de te plannen dagen = werkdagen van de bekeken week (vanaf vandaag, niet uitgesloten),
// plus voorkeursdatums na die week (werkdag, niet uitgesloten) als extra dag voor enkel die tickets.
export function bouwDagen({ weekStart, vandaag, werkdagen, uitgesloten, voorkeuren = [] }) {
  const isWerkdag = d => werkdagen.includes(new Date(d + 'T00:00:00Z').getUTCDay()) && !uitgesloten(d);
  const dagen = [];
  for (let i = 0; i < 7; i++) {
    const d = isoPlusDagen(weekStart, i);
    if (d >= vandaag && isWerkdag(d)) dagen.push(d);
  }
  const weekEinde = isoPlusDagen(weekStart, 6);
  const extraVoor = {};
  for (const { ticketId, datum } of voorkeuren) {
    if (!datum || datum <= weekEinde || datum < vandaag || !isWerkdag(datum)) continue;
    (extraVoor[datum] ||= []).push(ticketId);
  }
  for (const d of Object.keys(extraVoor).sort()) dagen.push(d);
  return { dagen, extraVoor };
}

export async function planWeek(invoer) {
  const {
    kandidaten, dagen, extraVoor = {}, bestaandPerDag = {}, eigenAfspraken = {}, klant = {},
    instellingen, depot, vandaag, reistijden, capPerDag = {},
  } = invoer;
  const maxReistijdMin = instellingen.maxReistijdMin;
  const duurMinuten = instellingen.duurMinuten; // tijdelijk (Taak 1): slotgrootte voor capPerDag

  // Op een extra dag (buiten de bekeken week) mogen enkel de tickets uit extraVoor[datum].
  const magOpDag = (id, d) => !extraVoor[d] || extraVoor[d].includes(id);

  const kbFor = id => klant[id] || null;
  const kbBlocked = (id, d) => !!(kbFor(id)?.geblokkeerd?.includes(d));
  const kbPreferred = id => kbFor(id)?.voorkeur || null;
  const kbPreferredTime = id => kbFor(id)?.voorkeurTijd || null;

  // Reistijd vanaf (fromLat, fromLon) naar alle kandidaten met coords, via de ingespoten functie.
  // Ontbrekende cellen (null/undefined) en een lege Map = fail-open.
  async function batchTravelTimes(cands, fromLat, fromLon, departAtIso) {
    const withCoords = cands.filter(c => c.lat && c.lon);
    if (!fromLat || !fromLon || !withCoords.length) return new Map();
    return (await reistijden({ lat: fromLat, lon: fromLon }, withCoords.map(c => ({ id: c.id, lat: c.lat, lon: c.lon })), departAtIso)) || new Map();
  }

  // Eerste kandidaat (in gegeven volgorde) binnen maxReistijdMin; fail-open bij ontbrekende data.
  async function pickNearbyCandidate(cands, fromLat, fromLon, departAtIso) {
    const times = await batchTravelTimes(cands, fromLat, fromLon, departAtIso);
    for (const candidate of cands) {
      if (!fromLat || !fromLon || !candidate.lat || !candidate.lon) return { candidate, legMin: 0 };
      const legMin = times.get(candidate.id);
      if (legMin === undefined || legMin === null || legMin <= maxReistijdMin) return { candidate, legMin: legMin ?? 0 };
    }
    return null;
  }

  // Scoringformule: prio_gewicht x afstand_km x urgentie_factor; lagere score = betere kandidaat.
  function fillScore(t, fromLat, fromLon) {
    const pw = PRIO_WEIGHT[(t.priority || '').toLowerCase()] ?? 9;
    const dist = (t.lat && t.lon && fromLat && fromLon)
      ? haversine(fromLat, fromLon, t.lat, t.lon)
      : 999; // geen coords → achteraan
    return pw * dist * urgentieFactor(t, vandaag);
  }

  // Voorkeursuur = vast tijdstip: botst met bestaande stop met uur, eigen afspraak met uur,
  // of een al gekozen dayTickets-ticket met voorkeurTijd.
  function botstMetVastUur(kandidaat, dayStr, dayTickets) {
    const tijd = kbPreferredTime(kandidaat.id);
    if (!tijd) return false;
    const start = timeStrToMin(tijd), eind = start + kandidaat.duurMin;
    const overlapt = (s, e) => s < eind && start < e;
    for (const p of (bestaandPerDag[dayStr] || [])) {
      if (!p.uur) continue;
      const s = timeStrToMin(p.uur);
      if (overlapt(s, s + p.duurMin)) return true;
    }
    for (const e of (eigenAfspraken[dayStr] || [])) {
      if (!e.uur) continue;
      const s = timeStrToMin(e.uur);
      if (overlapt(s, s + e.duurMin)) return true;
    }
    for (const t of dayTickets) {
      const tt = kbPreferredTime(t.id);
      if (!tt) continue;
      const s = timeStrToMin(tt);
      if (overlapt(s, s + t.duurMin)) return true;
    }
    return false;
  }

  const geplaatst = [];
  const availDays = dagen
    .map(d => ({ date: d, cap: capPerDag[d] ?? 0 }))
    .filter(d => d.cap > 0);
  const pool = kandidaten.slice();

  // Voorkeursplanning: een ticket met beschikbare voorkeursdag wacht op die dag.
  const prefDayAvailable = new Map(); // ticketId → dayStr
  for (const t of pool) {
    const pref = kbPreferred(t.id);
    if (!pref) continue;
    const prefDay = availDays.find(d => d.date === pref);
    if (prefDay && prefDay.cap > 0 && !kbBlocked(t.id, pref)) prefDayAvailable.set(t.id, pref);
  }

  for (const day of availDays) {
    if (!pool.length) break;

    const dayPool = pool.filter(t => {
      if (!magOpDag(t.id, day.date)) return false;
      if (kbBlocked(t.id, day.date)) return false;
      const pref = prefDayAvailable.get(t.id);
      if (pref && pref !== day.date) return false;
      if (botstMetVastUur(t, day.date, [])) return false;
      return true;
    });

    // Geografisch seeden: startpositie = laatste bestaande stop van de dag, anders depot.
    const existingOnDay = (bestaandPerDag[day.date] || [])
      .slice().sort((a, b) => (a.uur || '99:99').localeCompare(b.uur || '99:99'));
    const lastExisting = existingOnDay[existingOnDay.length - 1];
    // Ankerpunt = positie van het bestaande ticket; ontbreken coords dan fail-open (NIET depot).
    const anchorLat = lastExisting?.lat ?? null;
    const anchorLon = lastExisting?.lon ?? null;
    const startLat = anchorLat ?? depot?.lat ?? null; // sortering (fillScore)
    const startLon = anchorLon ?? depot?.lon ?? null;

    // Lopend geschat uur voor deze dag (minuten na middernacht).
    const [vanH, vanM] = (instellingen.vanTijd || '08:00').split(':').map(Number);
    let curTimeOfDay = lastExisting?.uur
      ? timeStrToMin(lastExisting.uur) + lastExisting.duurMin
      : vanH * 60 + vanM;

    // Filter op "past in day.cap" vóór het sorteren op fillScore.
    const seedPool = [...dayPool].filter(t => Math.ceil(t.duurMin / duurMinuten) <= day.cap);
    // R3: starter = hoogste voorrang; gelijk => kortste reistijd vanaf het depot; dan laagste ticketnummer.
    const depotTijden = await batchTravelTimes(seedPool, depot?.lat ?? null, depot?.lon ?? null, minToDepartAt(day.date, curTimeOfDay));
    const vanDepot = t => {
      const m = depotTijden.get(t.id);
      if (m !== undefined && m !== null) return m;
      return (depot?.lat && depot?.lon && t.lat && t.lon) ? haversine(depot.lat, depot.lon, t.lat, t.lon) : Infinity;
    };
    const vrScore = new Map(seedPool.map(t => [t.id, voorrang(t, vandaag)]));
    seedPool.sort((a, b) =>
      (vrScore.get(b.id) - vrScore.get(a.id)) ||
      (vanDepot(a) - vanDepot(b) || 0) ||
      String(a.number ?? '').localeCompare(String(b.number ?? ''), 'nl', { numeric: true }));
    if (!seedPool.length) continue;
    const seedExempt = !lastExisting || anchorLat == null || anchorLon == null;
    let seed;
    if (seedExempt) {
      seed = seedPool[0];
    } else {
      const result = await pickNearbyCandidate(seedPool, startLat, startLon, minToDepartAt(day.date, curTimeOfDay));
      if (!result) continue; // dag heeft al een ticket, maar niemand past binnen de max-reistijd
      seed = result.candidate;
      curTimeOfDay += result.legMin;
    }
    pool.splice(pool.indexOf(seed), 1);
    const dayTickets = [seed];
    const aankomsten = [curTimeOfDay];
    curTimeOfDay += seed.duurMin;

    // Fill: laagste score t.o.v. huidige positie. Te grote kandidaat wordt enkel voor deze dag uitgesloten.
    let curLat = seed.lat, curLon = seed.lon;
    let usedSlots = Math.ceil(seed.duurMin / duurMinuten);
    const excludedForDay = new Set();
    while (usedSlots < day.cap && pool.length) {
      const fillPool = pool.filter(t => {
        if (excludedForDay.has(t.id)) return false;
        if (!magOpDag(t.id, day.date)) return false;
        if (kbBlocked(t.id, day.date)) return false;
        const pref = prefDayAvailable.get(t.id);
        if (pref && pref !== day.date) return false;
        if (botstMetVastUur(t, day.date, dayTickets)) return false;
        return true;
      });
      if (!fillPool.length) break;
      fillPool.sort((a, b) => fillScore(a, curLat, curLon) - fillScore(b, curLat, curLon));
      const result = await pickNearbyCandidate(fillPool, curLat, curLon, minToDepartAt(day.date, curTimeOfDay));
      if (!result) break; // niemand past nog binnen de max-reistijd voor deze dag
      const chosen = result.candidate;
      const chosenSlots = Math.ceil(chosen.duurMin / duurMinuten);
      if (usedSlots + chosenSlots > day.cap) { excludedForDay.add(chosen.id); continue; }
      pool.splice(pool.indexOf(chosen), 1);
      dayTickets.push(chosen);
      aankomsten.push(curTimeOfDay + result.legMin);
      usedSlots += chosenSlots;
      curTimeOfDay += result.legMin + chosen.duurMin;
      if (chosen.lat && chosen.lon) { curLat = chosen.lat; curLon = chosen.lon; }
    }

    dayTickets.forEach((t, i) => geplaatst.push({ ticketId: t.id, datum: day.date, verwachteAankomst: minNaarUur(aankomsten[i]) }));
  }

  const nietGepland = pool.map(t => ({ ticketId: t.id, reden: 'geen-plaats' }));
  return { geplaatst, nietGepland, waarschuwingen: [] };
}

if (typeof window !== 'undefined') { window.planWeek = planWeek; window.bouwDagen = bouwDagen; }
