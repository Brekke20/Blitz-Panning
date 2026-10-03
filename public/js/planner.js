// Planner-brein: puur (geen DOM, geen globals). Bepaalt welk ticket op welke dag en om welk uur komt.
// Per dag een tijdlijn (vaste blokken, bestaande stops, eigen afspraken, blokkeringen); eerst de
// voorkeursdag-tickets, dan een starter op een lege dag (hoogste voorrang), dan aanvullen op reistijd/voorrang.
// De plaatsingsregel voor stops zonder uur staat ook in planner-tijdlijn.js (zelfde regel, daar met vaste reistijd voor "+" en de Route-tab).
// Elk geplaatst ticket blijft binnen maxReistijdMin van de vorige EN de volgende stop met locatie en haalt
// die volgende stop op tijd (spec 2026-09-30-planner-brein, §1/§3.3–3.5).
// Tijden binnen het brein zijn minuten na middernacht (lokaal); datums 'YYYY-MM-DD'.

import { timeStrToMin } from './kern/tijd.js';

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

// Kalenderdag 'YYYY-MM-DD' van een datum of ISO-tijdstip (lokale dag).
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

  // Reistijdgeheugen (4.1): per planWeek-aanroep, sleutel `${van.lat},${van.lon}|${naar.id}|${vertrekkwartier}`.
  // Alleen ontbrekende sleutels gaan naar `reistijden`. Een ontbrekende of ongeldige waarde (null, geen Map,
  // gooit) wordt de schatting km x 1,3 (R6) met markering `geschat`; er is geen fail-open meer.
  const geheugen = new Map(); // sleutel -> { min, geschat }
  const heeftLoc = x => !!(x && x.lat && x.lon);
  async function reistijdenVan(van, cands, dag, vertrekMin) {
    const uit = new Map();
    if (!heeftLoc(van)) return uit;
    const lijst = cands.filter(heeftLoc);
    const vertrekIso = minToDepartAt(dag, Math.floor(vertrekMin / 15) * 15);
    const sleutel = c => `${van.lat},${van.lon}|${c.id}|${vertrekIso}`;
    const ontbreekt = lijst.filter(c => !geheugen.has(sleutel(c)));
    if (ontbreekt.length) {
      let antwoord = null;
      try { antwoord = await reistijden({ lat: van.lat, lon: van.lon }, ontbreekt.map(c => ({ id: c.id, lat: c.lat, lon: c.lon })), vertrekIso); }
      catch { antwoord = null; }
      for (const c of ontbreekt) {
        const v = antwoord && typeof antwoord.get === 'function' ? antwoord.get(c.id) : null;
        geheugen.set(sleutel(c), (typeof v === 'number' && isFinite(v))
          ? { min: v, geschat: false }
          : { min: haversine(van.lat, van.lon, c.lat, c.lon) * 1.3, geschat: true });
      }
    }
    for (const c of lijst) uit.set(c.id, geheugen.get(sleutel(c)));
    return uit;
  }
  const geschatIds = new Set();   // waarschuwing 'reistijd-geschat': enkel tickets die effectief geplaatst werden
  const onbekendIds = new Set();  // waarschuwing 'locatie-onbekend' (stop-ids)

  // Redenen, van meest naar minst specifiek (3.6): het brein houdt de meest specifieke bij.
  const REDEN_RANG = ['adres-niet-gevonden', 'voorkeursdag-afstand', 'voorkeursdag-vol', 'vast-uur-botst', 'te-ver', 'klant-geblokkeerd', 'geen-plaats'];
  const redenVan = new Map();
  const noteer = (id, reden) => {
    const huidig = redenVan.get(id);
    if (!huidig || REDEN_RANG.indexOf(reden) < REDEN_RANG.indexOf(huidig)) redenVan.set(id, reden);
  };
  const legeDagGehad = new Set(); // tickets die op een nog lege dag kans op de starterplaats kregen

  // Tijdlijn-hulp (3.3): vaste blokken van een dag als { s, e, lat, lon, stop, id } in minuten.
  // `stop` = een echte stop in de keten (bestaand ticket, of eigen afspraak met locatie); blokkeringen niet.
  function vasteBlokken(dag) {
    const blokken = [];
    for (const p of (bestaandPerDag[dag] || [])) {
      if (!p.uur) continue;
      const s = timeStrToMin(p.uur);
      blokken.push({ s, e: s + p.duurMin, lat: p.lat ?? null, lon: p.lon ?? null, stop: true, id: p.id });
    }
    for (const e of (eigenAfspraken[dag] || [])) {
      if (!e.uur) continue;
      const s = timeStrToMin(e.uur);
      const lat = e.lat ?? null, lon = e.lon ?? null;
      blokken.push({ s, e: s + (e.duurMin || 60), lat, lon, stop: !!(lat && lon), id: 'eigen@' + e.uur });
    }
    for (const r of (blokkeringen[dag] || [])) {
      blokken.push({ s: timeStrToMin(r.van), e: timeStrToMin(r.tot), lat: null, lon: null, stop: false, id: null });
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


  const geplaatst = [];
  // Kandidaten zonder coordinaten worden nooit geplaatst (Review Focus 1): reden 'adres-niet-gevonden'.
  for (const t of kandidaten) if (!heeftLoc(t)) noteer(t.id, 'adres-niet-gevonden');
  const pool = kandidaten.filter(heeftLoc);

  // Voorkeursplanning: een ticket met bruikbare voorkeursdag wacht op die dag.
  const prefDayAvailable = new Map(); // ticketId → dayStr
  for (const t of pool) {
    const pref = kbPreferred(t.id);
    if (!pref) continue;
    if (dagen.includes(pref) && !kbBlocked(t.id, pref)) prefDayAvailable.set(t.id, pref); // R7: ook een volle dag is bruikbaar: dan voorkeursdag-vol
  }

  for (const dag of dagen) {
    if (!pool.length) break;
    const bestaand = bestaandPerDag[dag] || [];
    let aantal = bestaand.length; // maxPerDag telt tickets: bestaande + nieuwe
    const blokken = vasteBlokken(dag);
    const dagGeplaatst = []; // { t, aank }
    const keten = bestaand.filter(x => !x.uur); // bestaande stops zonder uur, vooraan vanaf vanTijd
    let ketenLoc = keten.some(heeftLoc);
    // 3.4: heeft de dag minstens één stop met gekende locatie? Zo niet, dan geldt hij als leeg.
    const dagHeeftLocatie = () => ketenLoc || blokken.some(b => b.stop && heeftLoc(b));

    // Op een extra dag mogen enkel de tickets uit extraVoor[datum]; klant-, voorkeursdag-uitsluitingen.
    const toegelaten = t => {
      if (!magOpDag(t.id, dag)) return false;
      if (kbBlocked(t.id, dag)) return false;
      const pref = prefDayAvailable.get(t.id);
      if (pref && pref !== dag) return false;
      return true;
    };

    // Pass 0: tickets met voorkeursuur staan exact op hun uur (buiten de laatsteStart-grens).
    // 45-min-regel (3.4): reistijd vanaf de stop net vóór dat uur met gekende locatie.
    // R7: een ticket met voorkeursdag EN voorkeursuur wordt hier op zijn dag geplaatst (voorkeursdag eerst);
    // zijn mislukkingen krijgen de specifiekere voorkeursdag-redenen.
    const isVoorkeurHier = t => prefDayAvailable.get(t.id) === dag;
    const noteerVast = (t, reden) => noteer(t.id, !isVoorkeurHier(t) ? reden
      : reden === 'te-ver' ? 'voorkeursdag-afstand' : 'voorkeursdag-vol');
    // Alle stops van de dag in tijd: vaste blokken plus de reeds geplaatste vrije tickets (die staan niet in `blokken`).
    const stopsVanDag = () => {
      const idsInBlokken = new Set(blokken.map(b => b.id));
      return [...blokken, ...dagGeplaatst.filter(g => !idsInBlokken.has(g.t.id))
        .map(g => ({ s: g.aank, e: g.aank + g.t.duurMin, lat: g.t.lat, lon: g.t.lon, stop: true, id: g.t.id }))];
    };
    // Vooruitcontrole (§1, R6): t.o.v. de eerstvolgende stop met locatie ná het ticket moet de rit
    // (a) hoogstens maxReistijdMin duren en (b) daar op tijd aankomen (aank + duur + rit <= start volgende).
    // De rit wordt in één batch opgevraagd vanaf die volgende stop naar de kandidaten (`lijst`), met als
    // vertrek het startuur van die stop: reistijd benaderd als symmetrisch, zo blijft het één opvraging per stop.
    // Geeft { ok, reden: 'te-ver' | 'te-laat', r, volgende } terug.
    const vooruit = async (c, aank, stops, lijst = [c]) => {
      const e = aank + c.duurMin;
      const volgende = stops.filter(b => b.stop && heeftLoc(b) && b.id !== c.id && b.s >= e)
        .sort((a, b) => a.s - b.s)[0];
      if (!volgende) return { ok: true, r: null };
      const r = (await reistijdenVan(volgende, lijst, dag, volgende.s)).get(c.id);
      if (r && r.min > maxReistijdMin) return { ok: false, reden: 'te-ver', r, volgende };
      if (r && e + r.min > volgende.s) return { ok: false, reden: 'te-laat', r, volgende };
      return { ok: true, r, volgende };
    };

    // Probeer een ticket exact op zijn voorkeursuur te zetten: geen overlap, 45-min-regel en op tijd vanaf de
    // stop net vóór dat uur, en de vooruitcontrole naar de stop erna. Geeft { ok, reden, s, geschat } terug;
    // muteert niets. Vrijgesteld van laatsteStart.
    const probeerUur = async t => {
      const s = timeStrToMin(kbPreferredTime(t.id));
      const alle = stopsVanDag();
      if (overlapt(alle, s, s + t.duurMin).length) return { ok: false, reden: 'vast-uur-botst' };
      // Referentiestop: de laatste eerdere stop (in tijd) met locatie; de stop vlak ervoor mag locatie-loos zijn.
      const eerder = alle.filter(b => b.stop && b.e <= s).sort((a, b) => a.e - b.e);
      let vorige = eerder[eerder.length - 1] ?? null;
      let ref = [...eerder].reverse().find(heeftLoc) ?? null;
      const refVertrek = ref ? ref.e : vanTijdMin;
      const refEindeGekend = !!ref; // een ketenstop heeft hier nog geen gekend einde
      if (!vorige && keten.length && s >= vanTijdMin) { // geen blok vóór dit uur: de keten staat vooraan de dag
        vorige = keten[keten.length - 1];
        ref = [...keten].reverse().find(heeftLoc) ?? null;
      }
      let geschat = false;
      if (ref) {
        const r = (await reistijdenVan(ref, [t], dag, refVertrek)).get(t.id);
        geschat = !!r?.geschat;
        if (r && r.min > maxReistijdMin) return { ok: false, reden: 'te-ver' };
        if (r && refEindeGekend && refVertrek + r.min > s) return { ok: false, reden: 'vast-uur-botst' }; // vorige stop → hier niet op tijd
      }
      const v = await vooruit(t, s, alle);
      if (!v.ok) return { ok: false, reden: v.reden === 'te-ver' ? 'te-ver' : 'vast-uur-botst' };
      if (ref && vorige && !heeftLoc(vorige)) onbekendIds.add(vorige.id);
      return { ok: true, s, geschat: geschat || !!v.r?.geschat };
    };
    const zetOpUur = (t, s, geschat) => {
      blokken.push({ s, e: s + t.duurMin, lat: t.lat, lon: t.lon, stop: true, id: t.id });
      blokken.sort((a, b) => a.s - b.s);
      dagGeplaatst.push({ t, aank: s });
      pool.splice(pool.indexOf(t), 1);
      aantal++;
      if (geschat) geschatIds.add(t.id);
    };

    // Stap 1 (R7/3.5): enkel tickets MET voorkeursdag = deze dag en een voorkeursuur staan hier op hun uur.
    // Tickets met enkel een voorkeursuur doen mee als gewone kandidaat in de vulling (zie vul).
    const vastePool = pool.filter(t => kbPreferredTime(t.id) && isVoorkeurHier(t) && toegelaten(t))
      .sort((a, b) => voorrang(b, vandaag) - voorrang(a, vandaag));
    for (const t of vastePool) {
      if (aantal >= maxPerDag) { noteerVast(t, 'geen-plaats'); continue; }
      const p = await probeerUur(t);
      if (!p.ok) { noteerVast(t, p.reden); continue; }
      zetOpUur(t, p.s, p.geschat);
    }

    // De klok, de laatste stop (vorige) en de laatste stop met gekende locatie (anker).
    let klok = vanTijdMin;
    let anker = null;
    let vorige = null;
    const gepasseerd = new Set();
    const passeer = t => { // stops die vóór tijdstip t eindigen zijn voorbij
      for (const b of blokken.filter(x => x.stop && x.e <= t && !gepasseerd.has(x)).sort((a, c) => a.e - c.e)) {
        gepasseerd.add(b);
        vorige = b;
        if (heeftLoc(b)) anker = { lat: b.lat, lon: b.lon };
      }
    };
    const normaliseer = () => { klok = voorbijBlokken(blokken, klok); passeer(klok); };
    const positie = () => anker ?? (heeftLoc(depot) ? { lat: depot.lat, lon: depot.lon } : null);
    const reis = (cands, vertrek) => reistijdenVan(positie(), cands, dag, vertrek);

    // Bestaande stops zonder uur: vooraan in de keten vanaf vanTijd, in hun huidige volgorde.
    const legNaar = async p => heeftLoc(p) ? ((await reis([p], klok)).get(p.id)?.min ?? 0) : 0;
    for (const p of keten) {
      normaliseer();
      let aank = klok + await legNaar(p);
      // Dezelfde regel als planner-tijdlijn.js (de gedeelde plaatsingsregel van "+" en de Route-tab), maar met de echte reistijden:
      // een bestaande stop zonder uur komt vooraan vanaf vanTijd; botst hij met een blok, of haalt hij de eerstvolgende stop met
      // locatie niet meer op tijd, dan springt de klok naar het einde van dat blok en wordt de rit opnieuw berekend.
      for (;;) {
        let sprong = overlapt(blokken, aank, aank + p.duurMin)[0];
        if (!sprong && heeftLoc(p)) {
          const eind = aank + p.duurMin;
          const volgende = blokken.filter(x => x.stop && heeftLoc(x) && x.s >= eind).sort((x, y) => x.s - y.s)[0];
          if (volgende) {
            const r = (await reistijdenVan(volgende, [p], dag, volgende.s)).get(p.id);
            if (r && eind + r.min > volgende.s) sprong = volgende;
          }
        }
        if (!sprong) break;
        klok = sprong.e; normaliseer(); aank = klok + await legNaar(p);
      }
      passeer(aank);
      klok = aank + p.duurMin;
      vorige = p;
      if (heeftLoc(p)) anker = { lat: p.lat, lon: p.lon };
    }

    // Vrije tickets. Lege dag (geen stop met locatie): starter = hoogste voorrang, geen afstandscontrole.
    // Anders aanvullen op laagste reistijdMin / voorrang, met de 45-min-regel vanaf de vorige stop met locatie
    // (zonder vorige stop met locatie is de rit vanaf het depot vrij, 3.3) én de vooruitcontrole naar de
    // volgende stop met locatie (op tijd en binnen maxReistijdMin).
    // R7: fase 1 plaatst eerst de tickets met voorkeursdag = deze dag (op voorrang); fase 2 vult aan met de rest.
    const vul = async voorkeurFase => {
      while (aantal < maxPerDag && pool.length) {
        normaliseer();
        // Na laatsteStart kunnen enkel nog tickets met voorkeursuur (vrijgesteld) geplaatst worden.
        const naLaatste = klok > laatsteStartMin;
        const fillPool = pool.filter(t => toegelaten(t) && (voorkeurFase
          ? isVoorkeurHier(t) && !kbPreferredTime(t.id)
          : !isVoorkeurHier(t) && (!naLaatste || kbPreferredTime(t.id))));
        if (!fillPool.length) break;
        const tijden = await reis(fillPool, klok);
        const reisMin = c => tijden.get(c.id)?.min ?? 0;
        const vr = new Map(fillPool.map(t => [t.id, voorrang(t, vandaag)]));
        const nummer = (a, b) => String(a.number ?? '').localeCompare(String(b.number ?? ''), 'nl', { numeric: true });
        const starter = !dagHeeftLocatie();
        if (voorkeurFase) {
          fillPool.sort((a, b) => (vr.get(b.id) - vr.get(a.id)) || (reisMin(a) - reisMin(b)) || nummer(a, b));
        } else if (starter) {
          fillPool.forEach(t => legeDagGehad.add(t.id));
          fillPool.sort((a, b) => (vr.get(b.id) - vr.get(a.id)) || (reisMin(a) - reisMin(b)) || nummer(a, b));
        } else {
          const score = c => reisMin(c) / vr.get(c.id);
          fillPool.sort((a, b) => (score(a) - score(b)) || (vr.get(b.id) - vr.get(a.id)) || nummer(a, b));
        }

        let gekozen = null, sprong = null;
        for (const c of fillPool) {
          const r = tijden.get(c.id);
          if (kbPreferredTime(c.id)) { // gewone kandidaat met voorkeursuur: exact op zijn uur, niet op de klok
            const p = await probeerUur(c);
            if (!p.ok) { noteer(c.id, p.reden); continue; }
            gekozen = { c, aank: p.s, opUur: true, geschat: p.geschat };
            break;
          }
          const aank = klok + (r?.min ?? 0);
          if (aank > laatsteStartMin) continue;
          const b = overlapt(blokken, aank, aank + c.duurMin)[0];
          if (b) { if (!sprong || b.e < sprong.e) sprong = b; continue; }
          if (!starter && anker && r && r.min > maxReistijdMin) { noteer(c.id, voorkeurFase ? 'voorkeursdag-afstand' : 'te-ver'); continue; }
          const v = await vooruit(c, aank, stopsVanDag(), fillPool);
          if (!v.ok) {
            if (v.reden === 'te-ver') noteer(c.id, voorkeurFase ? 'voorkeursdag-afstand' : 'te-ver');
            // Vóór die stop past dit ticket niet (latere klok helpt niet): eventueel verder na die stop.
            if (!sprong || v.volgende.e < sprong.e) sprong = v.volgende;
            continue;
          }
          gekozen = { c, aank, geschat: !!(r?.geschat || v.r?.geschat) };
          break;
        }
        if (gekozen && gekozen.opUur) {
          // Op zijn uur gezet; klok en keten lopen door vanaf de huidige klok en springen over dit blok (3.3).
          zetOpUur(gekozen.c, gekozen.aank, gekozen.geschat);
          ketenLoc = true;
        } else if (gekozen) {
          const { c, aank } = gekozen;
          passeer(aank);
          if (!starter && anker && vorige && !heeftLoc(vorige)) onbekendIds.add(vorige.id);
          pool.splice(pool.indexOf(c), 1);
          dagGeplaatst.push({ t: c, aank });
          aantal++;
          if (gekozen.geschat) geschatIds.add(c.id);
          klok = aank + c.duurMin;
          vorige = c;
          anker = { lat: c.lat, lon: c.lon };
          ketenLoc = true;
        } else if (sprong) {
          klok = sprong.e; // klok springt naar het einde van het blok; normaliseer() zet het anker
        } else {
          break;
        }
      }
    };
    await vul(true);
    // Voorkeursdag-tickets die hier niet pasten, komen nergens anders meer: afstand of vol.
    for (const t of pool.filter(isVoorkeurHier)) {
      noteer(t.id, 'voorkeursdag-vol'); // de rangorde houdt 'voorkeursdag-afstand' vast als die al genoteerd was
      pool.splice(pool.indexOf(t), 1);
    }
    await vul(false);

    dagGeplaatst.sort((a, b) => a.aank - b.aank)
      .forEach(({ t, aank }) => geplaatst.push({ ticketId: t.id, datum: dag, verwachteAankomst: minNaarUur(aank) }));
  }

  // 3.6: 'klant-geblokkeerd' enkel als de klant ALLE dagen blokkeerde waarop het ticket anders mocht.
  for (const t of pool) {
    const toegestaneDagen = dagen.filter(d => magOpDag(t.id, d) && (!prefDayAvailable.get(t.id) || prefDayAvailable.get(t.id) === d));
    if (toegestaneDagen.length && toegestaneDagen.every(d => kbBlocked(t.id, d))) noteer(t.id, 'klant-geblokkeerd');
    // 'te-ver' enkel als er geen lege dag meer was: kreeg het ticket op een lege dag kans, dan was de week gewoon vol.
    if (redenVan.get(t.id) === 'te-ver' && legeDagGehad.has(t.id)) redenVan.set(t.id, 'geen-plaats');
  }

  const geplaatstIds = new Set(geplaatst.map(g => g.ticketId));
  const nietGepland = kandidaten.filter(t => !geplaatstIds.has(t.id))
    .map(t => ({ ticketId: t.id, reden: redenVan.get(t.id) || 'geen-plaats' }));
  const waarschuwingen = [];
  if (geschatIds.size) waarschuwingen.push({ soort: 'reistijd-geschat', ticketIds: [...geschatIds] });
  if (onbekendIds.size) waarschuwingen.push({ soort: 'locatie-onbekend', ticketIds: [...onbekendIds] });
  return { geplaatst, nietGepland, waarschuwingen };
}

if (typeof window !== 'undefined') { window.planWeek = planWeek; window.bouwDagen = bouwDagen; }
