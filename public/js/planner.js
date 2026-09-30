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
    instellingen, depot, vandaag, reistijden, blokkeringen = {},
  } = invoer;
  const maxReistijdMin = instellingen.maxReistijdMin;
  const vanTijdMin = timeStrToMin(instellingen.vanTijd || '08:00');
  const laatsteStartMin = timeStrToMin(instellingen.laatsteStart || '16:00'); // R8: standaard 16:00
  const maxPerDag = instellingen.maxPerDag > 0 ? instellingen.maxPerDag : Infinity;

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

  // Scoringformule: prio_gewicht x afstand_km x urgentie_factor; lagere score = betere kandidaat.
  function fillScore(t, fromLat, fromLon) {
    const pw = PRIO_WEIGHT[(t.priority || '').toLowerCase()] ?? 9;
    const dist = (t.lat && t.lon && fromLat && fromLon)
      ? haversine(fromLat, fromLon, t.lat, t.lon)
      : 999; // geen coords → achteraan
    return pw * dist * urgentieFactor(t, vandaag);
  }

  // Redenen, van meest naar minst specifiek (3.6): het brein houdt de meest specifieke bij.
  const REDEN_RANG = ['adres-niet-gevonden', 'voorkeursdag-afstand', 'voorkeursdag-vol', 'vast-uur-botst', 'te-ver', 'klant-geblokkeerd', 'geen-plaats'];
  const redenVan = new Map();
  const noteer = (id, reden) => {
    const huidig = redenVan.get(id);
    if (!huidig || REDEN_RANG.indexOf(reden) < REDEN_RANG.indexOf(huidig)) redenVan.set(id, reden);
  };

  // Tijdlijn-hulp (3.3): vaste blokken van een dag als { s, e, lat, lon } in minuten; lat/lon mogen null zijn.
  function vasteBlokken(dag) {
    const blokken = [];
    for (const p of (bestaandPerDag[dag] || [])) {
      if (!p.uur) continue;
      const s = timeStrToMin(p.uur);
      blokken.push({ s, e: s + p.duurMin, lat: p.lat ?? null, lon: p.lon ?? null });
    }
    for (const e of (eigenAfspraken[dag] || [])) {
      if (!e.uur) continue;
      const s = timeStrToMin(e.uur);
      blokken.push({ s, e: s + (e.duurMin || 60), lat: e.lat ?? null, lon: e.lon ?? null });
    }
    for (const r of (blokkeringen[dag] || [])) {
      blokken.push({ s: timeStrToMin(r.van), e: timeStrToMin(r.tot), lat: null, lon: null });
    }
    return blokken.sort((a, b) => a.s - b.s);
  }
  // Eerste tijdstip vanaf `klok` dat in geen enkel blok valt.
  function voorbijBlokken(blokken, klok) {
    let b;
    while ((b = blokken.find(x => x.s <= klok && klok < x.e))) klok = b.e;
    return klok;
  }
  const overlapt = (blokken, s, e) => blokken.filter(b => b.s < e && s < b.e);

  // Een dag is bruikbaar als er nog plaats is volgens maxPerDag en de klok de laatste start haalt.
  const dagBruikbaar = d =>
    dagen.includes(d) &&
    (bestaandPerDag[d] || []).length < maxPerDag &&
    voorbijBlokken(vasteBlokken(d), vanTijdMin) <= laatsteStartMin;

  const geplaatst = [];
  const pool = kandidaten.slice();

  // Voorkeursplanning: een ticket met bruikbare voorkeursdag wacht op die dag.
  const prefDayAvailable = new Map(); // ticketId → dayStr
  for (const t of pool) {
    const pref = kbPreferred(t.id);
    if (!pref) continue;
    if (dagBruikbaar(pref) && !kbBlocked(t.id, pref)) prefDayAvailable.set(t.id, pref);
  }

  for (const dag of dagen) {
    if (!pool.length) break;
    const bestaand = bestaandPerDag[dag] || [];
    let aantal = bestaand.length; // maxPerDag telt tickets: bestaande + nieuwe
    const blokken = vasteBlokken(dag);
    const dagGeplaatst = []; // { t, aank }

    // Kandidaten die deze dag in aanmerking komen (klant, voorkeursdag, extra dag).
    const toegelaten = t => {
      if (!magOpDag(t.id, dag)) return false;
      if (kbBlocked(t.id, dag)) { noteer(t.id, 'klant-geblokkeerd'); return false; }
      const pref = prefDayAvailable.get(t.id);
      if (pref && pref !== dag) return false;
      return true;
    };

    // Pass 0: tickets met voorkeursuur staan exact op hun uur (buiten de laatsteStart-grens).
    const vastePool = pool.filter(t => kbPreferredTime(t.id) && toegelaten(t))
      .sort((a, b) => voorrang(b, vandaag) - voorrang(a, vandaag));
    for (const t of vastePool) {
      if (aantal >= maxPerDag) { noteer(t.id, 'geen-plaats'); continue; }
      const s = timeStrToMin(kbPreferredTime(t.id));
      if (overlapt(blokken, s, s + t.duurMin).length) { noteer(t.id, 'vast-uur-botst'); continue; }
      blokken.push({ s, e: s + t.duurMin, lat: t.lat ?? null, lon: t.lon ?? null });
      blokken.sort((a, b) => a.s - b.s);
      dagGeplaatst.push({ t, aank: s });
      pool.splice(pool.indexOf(t), 1);
      aantal++;
    }

    // De klok en de laatste stop met gekende locatie (anker). Zonder anker geldt de dag als leeg.
    let klok = vanTijdMin;
    let anker = null;
    const gepasseerd = new Set();
    const passeer = t => { // blokken die vóór tijdstip t eindigen zijn voorbij: hun locatie is het anker
      for (const b of blokken.filter(x => x.e <= t && !gepasseerd.has(x)).sort((a, c) => a.e - c.e)) {
        gepasseerd.add(b);
        if (b.lat && b.lon) anker = { lat: b.lat, lon: b.lon };
      }
    };
    const normaliseer = () => { klok = voorbijBlokken(blokken, klok); passeer(klok); };
    const positie = () => anker ?? (depot?.lat && depot?.lon ? { lat: depot.lat, lon: depot.lon } : null);
    const reis = async (cands, vertrek) => {
      const pos = positie();
      return batchTravelTimes(cands, pos?.lat ?? null, pos?.lon ?? null, minToDepartAt(dag, vertrek));
    };

    // Bestaande stops zonder uur: vooraan in de keten vanaf vanTijd, in hun huidige volgorde.
    for (const p of bestaand.filter(x => !x.uur)) {
      normaliseer();
      const heeftLoc = p.lat && p.lon;
      const leg = heeftLoc ? ((await reis([{ id: p.id, lat: p.lat, lon: p.lon }], klok)).get(p.id) ?? 0) : 0;
      let aank = klok + leg;
      let b;
      while ((b = overlapt(blokken, aank, aank + p.duurMin)[0])) { klok = b.e; normaliseer(); aank = klok; }
      passeer(aank);
      klok = aank + p.duurMin;
      if (heeftLoc) anker = { lat: p.lat, lon: p.lon };
    }

    // Vrije tickets: starter op de hoogste voorrang (lege dag), daarna aanvullen op fillScore.
    let vrijGeplaatst = 0;
    while (aantal < maxPerDag && pool.length) {
      normaliseer();
      if (klok > laatsteStartMin) break;
      const fillPool = pool.filter(t => !kbPreferredTime(t.id) && toegelaten(t));
      if (!fillPool.length) break;
      const pos = positie();
      const tijden = await reis(fillPool, klok);
      if (vrijGeplaatst === 0) {
        // R3 (Taak 4 behouden tot Taak 6): eerste vrije ticket = hoogste voorrang; gelijk => kortste reistijd vanaf de huidige positie (depot of anker); dan laagste ticketnummer.
        const vanDepot = t => {
          const m = tijden.get(t.id);
          if (m !== undefined && m !== null) return m;
          return (depot?.lat && depot?.lon && t.lat && t.lon) ? haversine(depot.lat, depot.lon, t.lat, t.lon) : Infinity;
        };
        const vrScore = new Map(fillPool.map(t => [t.id, voorrang(t, vandaag)]));
        fillPool.sort((a, b) =>
          (vrScore.get(b.id) - vrScore.get(a.id)) ||
          (vanDepot(a) - vanDepot(b) || 0) ||
          String(a.number ?? '').localeCompare(String(b.number ?? ''), 'nl', { numeric: true }));
      } else {
        fillPool.sort((a, b) => fillScore(a, pos.lat, pos.lon) - fillScore(b, pos.lat, pos.lon));
      }

      let gekozen = null, sprong = null;
      for (const c of fillPool) {
        const heeftLoc = c.lat && c.lon;
        const reisMin = tijden.get(c.id);
        // Afstandscontrole enkel met anker; ontbrekende reistijd = fail-open (Taak 6 vervangt dit door een schatting).
        if (anker && heeftLoc && typeof reisMin === 'number' && reisMin > maxReistijdMin) continue;
        const aank = klok + (typeof reisMin === 'number' ? reisMin : 0);
        if (aank > laatsteStartMin) continue;
        const b = overlapt(blokken, aank, aank + c.duurMin)[0];
        if (b) { if (!sprong || b.e < sprong.e) sprong = b; continue; }
        gekozen = { c, aank };
        break;
      }
      if (gekozen) {
        const { c, aank } = gekozen;
        passeer(aank);
        pool.splice(pool.indexOf(c), 1);
        dagGeplaatst.push({ t: c, aank });
        aantal++; vrijGeplaatst++;
        klok = aank + c.duurMin;
        if (c.lat && c.lon) anker = { lat: c.lat, lon: c.lon };
      } else if (sprong) {
        klok = sprong.e; // klok springt naar het einde van het blok; normaliseer() zet het anker
      } else {
        break;
      }
    }

    dagGeplaatst.sort((a, b) => a.aank - b.aank)
      .forEach(({ t, aank }) => geplaatst.push({ ticketId: t.id, datum: dag, verwachteAankomst: minNaarUur(aank) }));
  }

  const nietGepland = pool.map(t => ({ ticketId: t.id, reden: redenVan.get(t.id) || 'geen-plaats' }));
  return { geplaatst, nietGepland, waarschuwingen: [] };
}

if (typeof window !== 'undefined') { window.planWeek = planWeek; window.bouwDagen = bouwDagen; }
