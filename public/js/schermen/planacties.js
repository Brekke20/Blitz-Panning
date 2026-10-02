// schermen/planacties.js — inplannen, uitplannen en "Plan deze week" (etappe 5b).
// De code is letterlijk uit index.html verhuisd (W11/D12: addTicketToDate, removeTicketFromDate, bevestigUitplannen en autoPlan
// schrijven de planning naar Zoho via /api/plan; payloads, TEST_MODE-poorten, rollbacks, toasts en de volgorde van de verzoeken
// zijn ongewijzigd). Enkel de voorvoegsels zijn nieuw: `afh.` voor de andere schermen en app.js, `toestand.get/set/raak`
// voor de gedeelde gegevens (altijd live gelezen, zoals de globale getters vroeger), `selecties.` en imports.
// inFlightTickets is module-privé (inFlight(id) is de leesingang). Het gepinde HUIDIG GEDRAG (technische parser-foutmelding bij een
// 502 met HTML) blijft bewust ongewijzigd. Raakt `document` enkel binnen functies. Alleen `kern/brug.js` wijst `window`-namen toe.
// De knoppen lopen via data-actie-delegatie; de resultaat-overlay sluit via registreerBackdrop. `window.bouwDagen`,
// en `window.planWeek` (planner.js) blijft zoals het was.
import { toestand } from '../kern/toestand.js';
import { TEST_MODE } from '../kern/omgeving.js';
import { toast, escHtml, registreerActies, registreerBackdrop, strengeAfh } from '../kern/ui.js';
import { localISO, getWeekStart, fmtDateShort } from '../kern/tijd.js';
import { apiVerzoek } from '../kern/api.js';
import * as selecties from '../kern/selecties.js';
import { registreerVenster } from '../venster.js';
import { appConfirm } from '../app-dialog.js';
import { renderTickets } from './wachtrij.js';
import { renderKalender, weekOffset } from './kalender.js';
import { renderGepland } from './ingepland.js';
import { leesLaatsteStart } from './instellingen.js';
import { heeftLopendVoorstel } from './ticketdetail-logica.js';
import { getHolidayName } from '../kern/feestdagen.js';

// Afhankelijkheden uit app.js en andere schermen (ingevuld door initPlanacties); een vergeten init faalt luid.
let afh = new Proxy({}, { get() { throw new Error('planacties: initPlanacties() is niet aangeroepen'); } });

export function initPlanacties(afhankelijkheden) {
  afh = strengeAfh('planacties', afhankelijkheden);
  registreerActies(document.body, {
    'plan-week':    () => autoPlan(),
    'result-sluit': () => closeResult(),
  });
  const overlay = document.getElementById('result-overlay');
  registreerBackdrop(overlay, closeResult);
  registreerVenster({ el: overlay, sluit: () => closeResult() });
}

let inFlightTickets = new Set(); // voorkomt dubbele API calls
export function inFlight(id) { return inFlightTickets.has(id); }

export async function addTicketToDate(ticketId, date) {
  if (inFlightTickets.has(ticketId)) return false;
  const t = toestand.get('allTickets').find(t => t.id === ticketId);
  if (!t) return false;
  if (!toestand.get('planning')[date]) toestand.get('planning')[date] = [];
  if (toestand.get('planning')[date].find(p => p.ticket.id === ticketId)) return true; // al ingepland

  // Waarschuwing bij wettelijke feestdag
  const feestdag = getHolidayName(date);
  if (feestdag) {
    const ok = confirm(`🎌 ${feestdag} is een wettelijke feestdag (${fmtDateShort(date)}).\nToch inplannen?`);
    if (!ok) return false;
  }

  // Waarschuwing als klant deze datum heeft geblokkeerd
  if (afh.kbBlocked(ticketId, date)) {
    const ok = confirm(`⚠ Klant gaf aan NIET beschikbaar te zijn op ${fmtDateShort(date)}.\nToch inplannen?`);
    if (!ok) return false;
  }

  // Voorkeursuur klant = vast tijdstip
  const uur = afh.kbPreferredTime(ticketId) || null;

  // Optimistische update
  toestand.get('planning')[date].push({ ticket: t, address: t.address, uur });
  // Bewust geen raak('planning') hier: de route zou tijdens de Zoho-aanroep gewist worden en bij een mislukking
  // niet terugkomen. Het succespad (raak hieronder + allTickets) en de rollback raken planning zelf.
  inFlightTickets.add(ticketId);
  renderTickets();
  renderKalender();

  let success = true;
  if (!TEST_MODE) {
    try {
      // 00:00 blijft de "geen tijdstip"-sentinel (zie extractLocalHour())
      const utcInterventieDatum = new Date(`${date}T${uur || '00:00'}:00`).toISOString();
      const res  = await fetch('/api/plan', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ticketId, date, utcInterventieDatum }),
      });
      const data = await res.json().catch(() => ({ error: 'HTTP ' + res.status })); // W5-fix: onleesbaar antwoord (bv. 502-HTML) wordt 'HTTP <status>'
      if (data.error) throw new Error(data.error);
      // Ticket is nu "Wachten op bevestiging planning" in Zoho
      Object.values(toestand.get('planning')).forEach(stops =>
        stops.forEach(p => { if (p.ticket.id === ticketId) p.ticket.status = 'Wachten op bevestiging planning'; })
      );
      toestand.raak('planning'); // entries in-place gewijzigd (status)
      toestand.set('allTickets', toestand.get('allTickets').filter(t => t.id !== ticketId));
      document.getElementById('cnt-tickets').textContent = toestand.get('allTickets').length;
    } catch (err) {
      // Revert
      toestand.get('planning')[date] = toestand.get('planning')[date].filter(p => p.ticket.id !== ticketId);
      if (!toestand.get('planning')[date].length) delete toestand.get('planning')[date];
      toestand.raak('planning'); // Zoho-gebonden rollback: de handmatige renders hieronder blijven staan (R7)
      toast('✕ Bijwerken in Zoho mislukt. Probeer opnieuw; blijft het fout, meld dit. (Detail: ' + err.message + ')', 4000);
      success = false;
    }
  } else {
    // Testmodus: simuleer succes
    Object.values(toestand.get('planning')).forEach(stops =>
      stops.forEach(p => { if (p.ticket.id === ticketId) p.ticket.status = 'Wachten op bevestiging planning'; })
    );
    toestand.raak('planning'); // entries in-place gewijzigd (status)
    toestand.set('allTickets', toestand.get('allTickets').filter(tt => tt.id !== ticketId));
    document.getElementById('cnt-tickets').textContent = toestand.get('allTickets').length;
  }

  inFlightTickets.delete(ticketId);
  // Gelukt: allTickets is hierboven toegewezen, dus koppelRenders hertekent wachtrij, kalender en route.
  // Mislukt: planning is teruggedraaid (raak in de rollback); wachtrij en kalender hertekenen hier zelf (etappe 4),
  // de route-render staat er naast het abonnement (R7).
  if (!success) {
    renderTickets();
    renderKalender();
    afh.renderRouteList(document.getElementById('plan-date').value);
    afh.updateRouteBtns(document.getElementById('plan-date').value);
  }
  return success;
}

export async function removeTicketFromDate(ticketId, date) {
  if (inFlightTickets.has(ticketId)) return;
  if (!toestand.get('planning')[date]) return;

  const stop = toestand.get('planning')[date].find(p => p.ticket.id === ticketId);
  if (!stop) return;

  // Optimistische update
  toestand.get('planning')[date] = toestand.get('planning')[date].filter(p => p.ticket.id !== ticketId);
  if (!toestand.get('planning')[date].length) delete toestand.get('planning')[date];
  toestand.raak('planning'); // koppelRenders hertekent de route (lijst, kaart, knoppen)
  inFlightTickets.add(ticketId);
  renderTickets();
  renderKalender();

  let verwijderMislukt = false;
  if (!TEST_MODE) {
    try {
      const res  = await fetch('/api/plan', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ticketId, date: null }),
      });
      const data = await res.json().catch(() => ({ error: 'HTTP ' + res.status })); // W5-fix: onleesbaar antwoord (bv. 502-HTML) wordt 'HTTP <status>'
      if (data.error) throw new Error(data.error);
      // Ticket is terug "Service in te plannen" — voeg terug toe aan allTickets
      stop.ticket.interventieDatum = null;
      toestand.get('allTickets').push(stop.ticket);
      toestand.get('allTickets').sort((a, b) => (a.number || 0) - (b.number || 0));
      toestand.raak('allTickets'); // in-place push/sort
      // Fix (bugronde 2026-09-22, item A): ticket ook uit wachtrij/gepland-lijsten halen
      toestand.set('allPending', toestand.get('allPending').filter(t => t.id !== ticketId));
      toestand.set('allGepland', toestand.get('allGepland').filter(t => t.id !== ticketId));
      document.getElementById('cnt-tickets').textContent = toestand.get('allTickets').length;
    } catch (err) {
      // Revert
      if (!toestand.get('planning')[date]) toestand.get('planning')[date] = [];
      toestand.get('planning')[date].push(stop);
      toestand.raak('planning'); // Zoho-gebonden rollback (R7)
      verwijderMislukt = true;
      toast('✕ Bijwerken in Zoho mislukt. Probeer opnieuw; blijft het fout, meld dit. (Detail: ' + err.message + ')', 4000);
    }
  } else {
    stop.ticket.interventieDatum = null;
    toestand.get('allTickets').push(stop.ticket);
    toestand.raak('allTickets'); // in-place push
    // Fix (bugronde 2026-09-22, item A): ticket ook uit wachtrij/gepland-lijsten halen
    toestand.set('allPending', toestand.get('allPending').filter(t => t.id !== ticketId));
    toestand.set('allGepland', toestand.get('allGepland').filter(t => t.id !== ticketId));
    document.getElementById('cnt-tickets').textContent = toestand.get('allTickets').length;
  }

  inFlightTickets.delete(ticketId);
  // Gelukt: allTickets/allPending/allGepland zijn hierboven bijgewerkt (I3: ook de "Ingepland"-lijst
  // en cnt-gepland), dus koppelRenders hertekent wachtrij, kalender en ingepland (plus route/inventaris).
  // Mislukt: planning is teruggedraaid (raak in de rollback, dus de route volgt); wachtrij, kalender en ingepland
  // hertekenen hier zelf (etappe 4).
  if (verwijderMislukt) {
    renderTickets();
    renderKalender();
    renderGepland();
  }
}

// Vraagt bevestiging vóór een ticket uit de planning gehaald wordt (× op kaart, routestop, detail).
export async function bevestigUitplannen(ticketId, date) {
  const t = (toestand.get('planning')[date] || []).find(p => p.ticket.id === ticketId)?.ticket;
  const nr = t?.number ?? '';
  // Staat er een voorstel uit, dan is uitplannen een annulering (reden vastleggen, klant verwittigen).
  if (t && heeftLopendVoorstel(t, toestand.get('voorstelStatus'))) {
    const titelA = 'Ticket #' + nr + ': afspraak annuleren?';
    const tekstA = 'Voor dit ticket is al een voorstel naar de klant verstuurd. Wil je de afspraak annuleren? Je kiest daarna een reden en of de klant een mail krijgt.';
    const okA = await appConfirm({ titel: titelA, tekst: tekstA, bevestigLabel: 'Afspraak annuleren', annuleerLabel: 'Terug', gevaar: true });
    if (okA) await afh.openAnnuleerVenster(ticketId, date);
    return false; // er is nog niets uitgepland
  }
  const titel = 'Ticket #' + nr + ' uit de planning halen?';
  const tekst = 'Het ticket gaat terug naar de wachtrij.';
  const ok = await appConfirm({ titel, tekst, bevestigLabel: 'Uit planning halen', gevaar: true });
  if (ok) await removeTicketFromDate(ticketId, date);
  return ok;
}

export async function autoPlan() {
  if (toestand.get('activeAssigneeFilter') === 'all') return toast('Kies eerst een technieker');
  const pendingIds  = new Set(toestand.get('allPending').map(t => t.id));
  const myTickets   = selecties.ticketsVanTechnieker(toestand.get('allTickets'), toestand.get('activeAssigneeFilter'));
  const toplan      = myTickets.filter(t => t.hasAddress && !pendingIds.has(t.id));
  const skipped     = myTickets.filter(t => !t.hasAddress && !pendingIds.has(t.id));

  if (!toplan.length && !skipped.length) return toast('Geen tickets om in te plannen');

  const btn = document.getElementById('btn-autoplan');
  btn.disabled    = true;
  btn.textContent = 'Bezig...';

  const geplande   = [];
  const nietGepland = [];

  try {
    // Werkdagen deze week (verleden overslaan) — vooraf bepaald zodat we de bestaande
    // stops van die dagen ook kunnen meenemen in de geocode-batch hieronder (nodig voor de
    // max-reistijd-check t.o.v. een bestaand/manueel verzet ticket).
    const today     = new Date(); today.setHours(0,0,0,0);
    const weekStart = getWeekStart(today, weekOffset());

    // R2: enkel de bekeken week (vanaf vandaag) plus voorkeursdatums na die week als extra dag
    // voor enkel het ticket dat die voorkeur heeft (zie bouwDagen in public/js/planner.js).
    const uitgesloten = d => !!getHolidayName(d) ||
      selecties.blokkeringenVoor(toestand.get('avExceptions'), d, toestand.get('activeAssigneeFilter'), 'fullday').length > 0;
    const { dagen: weekDates, extraVoor } = window.bouwDagen({
      weekStart: localISO(weekStart),
      vandaag: localISO(today),
      werkdagen: toestand.get('settings').werkdagen,
      uitgesloten,
      voorkeuren: toplan.map(t => ({ ticketId: t.id, datum: afh.kbPreferred(t.id) })).filter(v => v.datum),
    });

    // ALLE bestaande stops van de plandagen zonder coördinaten: elke stop met locatie is een
    // ankerpunt voor de 45-min-regel en de vooruitcontrole van het brein (spec 3.3), niet enkel de laatste.
    const bestaandeStops = weekDates
      .flatMap(dStr => selecties.planItemsVanTechnieker(toestand.get('planning')[dStr], toestand.get('activeAssigneeFilter')))
      .filter(stop => !stop._lat && !stop.ticket._lat && stop.ticket.address);

    // Geocoding via TomTom (geocode-cache eerst)
    const geocodeStops = [...new Set([...toplan, ...bestaandeStops.map(s => s.ticket)])];
    // Cache raadplegen (geocode-cache) vóór TomTom nodig is.
    geocodeStops.forEach(t => {
      if (!t._lat) { const hit = afh.geocacheLookup(t.address); if (hit) { t._lat = hit.lat; t._lon = hit.lon; } }
    });
    const nogTeGeocoden = geocodeStops.filter(t => !t._lat);
    let originCoords = afh.geocacheLookup(toestand.get('settings').startlocatie);

    if (!TEST_MODE && nogTeGeocoden.length) {
      toast('Adressen geocoden...', 8000);
      try {
        const gRes  = await fetch('/api/optimize', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ origin: toestand.get('settings').startlocatie, stops: nogTeGeocoden.map(t => t.address) }),
        });
        const gData = await gRes.json();
        if (gData.locations) {
          nogTeGeocoden.forEach((t, i) => {
            const loc = gData.locations[i+1];
            if (loc) { t._lat = loc.lat; t._lon = loc.lon; afh.geocacheStore(t.address, loc.lat, loc.lon); }
          });
          if (!originCoords && gData.locations[0]) { originCoords = gData.locations[0]; afh.geocacheStore(toestand.get('settings').startlocatie, originCoords.lat, originCoords.lon); }
        }
      } catch (e) { /* geocoding mislukt: kandidaten zonder coördinaten */ }
    }
    if (!weekDates.length) {
      showResult([], toplan.map(t => ({ ticket: t, reden: 'geen-plaats' })), skipped, 'Geen beschikbare dagen meer deze week');
      return;
    }

    // Invoer voor het brein (public/js/planner.js) opbouwen. Het brein is puur: alles wat het
    // nodig heeft komt via deze invoer, reistijden via de adapter op /api/matrix.
    const perId = new Map(toplan.map(t => [t.id, t]));
    const bestaandPerDag = {}, eigenAfspraken = {}, blokkeringen = {};
    // Eigen afspraken met coordinaten zijn stops in de keten (spec 3.3): eigen _lat/_lon, anders de geocode-cache.
    const eigenCoords = e => {
      const c = (e._lat && e._lon) ? { lat: e._lat, lon: e._lon } : afh.geocacheLookup(e.adres || e.notitie);
      return { lat: c?.lat ?? null, lon: c?.lon ?? null };
    };
    for (const dStr of weekDates) {
      bestaandPerDag[dStr] = selecties.planItemsVanTechnieker(toestand.get('planning')[dStr], toestand.get('activeAssigneeFilter'))
        .map(p => ({
          id: p.ticket.id, uur: p.uur || null, duurMin: afh.duurVoor(p.ticket.id),
          lat: p._lat ?? p.ticket._lat ?? null, lon: p._lon ?? p.ticket._lon ?? null,
        }));
      eigenAfspraken[dStr] = selecties.eigenAfsprakenVoor(toestand.get('localEvents'), dStr, toestand.get('activeAssigneeFilter'))
        .filter(e => e.uur)
        .map(e => ({
          uur: e.uur,
          duurMin: (e.einduur ? afh.calcWerktijdMin(e.uur, e.einduur) : 0) || 60,
          ...eigenCoords(e),
        }));
      // Tijdvak-blokkeringen (avExceptions kind 'range'), globaal of voor deze technieker.
      blokkeringen[dStr] = toestand.get('avExceptions')
        .filter(e => e.date === dStr && e.kind === 'range' &&
          (e.scope === 'global' || e.person === toestand.get('activeAssigneeFilter')))
        .map(e => ({ van: e.from, tot: e.to }));
    }
    const invoer = {
      kandidaten: toplan.map(t => ({
        id: t.id, number: t.number, priority: t.priority, interventieDatum: t.interventieDatum,
        inPlanningSinds: t.inPlanningSinds ?? null, lat: t._lat ?? null, lon: t._lon ?? null, duurMin: afh.duurVoor(t.id),
      })),
      dagen: weekDates,
      extraVoor,
      bestaandPerDag,
      eigenAfspraken,
      blokkeringen,
      klant: Object.fromEntries(toplan.map(t => [t.id, afh.kbFor(t.id)]).filter(([, v]) => v)),
      instellingen: {
        vanTijd: toestand.get('settings').vanTijd, laatsteStart: leesLaatsteStart(), maxPerDag: toestand.get('settings').maxPerDag,
        maxReistijdMin: toestand.get('settings').maxReistijdMin,
      },
      depot: originCoords || null,
      vandaag: localISO(today),
      // Adapter op /api/matrix: gooit nooit. Een ontbrekende cel geeft null; bij een fout krijgen ALLE
      // gevraagde id's null, zodat het brein de schatting (km x 1,3) + waarschuwing gebruikt (R6).
      reistijden: async (van, naar, vertrekIso) => {
        const alleNull = () => new Map(naar.map(n => [n.id, null]));
        try {
          const res  = await apiVerzoek('/api/matrix', {
            methode: 'POST',
            body:    {
              origin:       { lat: van.lat, lon: van.lon },
              destinations: naar.map(n => ({ lat: n.lat, lon: n.lon })),
              departAt:     vertrekIso,
            },
          });
          const data = res.data;
          if (!res.ok) {
            console.warn('Matrix-opzoeking mislukt, het brein rekent met een schatting:', data.error || res.status);
            return alleNull();
          }
          const map = new Map();
          naar.forEach((n, i) => {
            const r = (data.results || [])[i];
            map.set(n.id, typeof r?.travelTimeSeconds === 'number' ? r.travelTimeSeconds / 60 : null);
          });
          return map;
        } catch (err) {
          console.warn('Matrix-opzoeking mislukt (netwerkfout), het brein rekent met een schatting:', err.message);
          return alleNull();
        }
      },
    };
    const uitkomst = await window.planWeek(invoer);

    // Inplannen — alleen tellen als de Zoho call slaagt
    for (const g of uitkomst.geplaatst) {
      const t = perId.get(g.ticketId);
      const ok = await addTicketToDate(t.id, g.datum);
      if (ok) geplande.push({ ticket: t, date: g.datum });
      else nietGepland.push({ ticket: t, reden: 'zoho-fout' }); // mislukte tickets zichtbaar houden
    }
    // Past niet meer deze week, elk met de reden uit het brein
    uitkomst.nietGepland.forEach(n => nietGepland.push({ ticket: perId.get(n.ticketId), reden: n.reden }));

    showResult(geplande, nietGepland, skipped, null, uitkomst.waarschuwingen || []);
  } catch (err) {
    toast('✕ ' + err.message, 4000);
  } finally {
    btn.disabled    = false;
    btn.textContent = '⚡ Plan deze week';
  }
}

// Redenen waarom een ticket niet gepland werd (planner-brein + 'zoho-fout' van de schil)
function redenTekst(reden) {
  const teksten = {
    'geen-plaats':          'Geen plaats meer deze week',
    'te-ver':               `Te ver van de andere afspraken (meer dan ${toestand.get('settings').maxReistijdMin ?? 45} min)`,
    'klant-geblokkeerd':    'Klant is niet beschikbaar op de vrije dagen',
    'voorkeursdag-afstand': 'Voorkeursdag botst qua afstand met een ander ticket',
    'voorkeursdag-vol':     'Voorkeursdag is al vol',
    'vast-uur-botst':       'Voorkeursuur botst met een andere afspraak',
    'adres-niet-gevonden':  'Adres niet gevonden',
    'zoho-fout':            'Kon niet opgeslagen worden in Zoho',
  };
  return teksten[reden] || 'Geen plaats meer deze week';
}

function showResult(geplande, nietGepland, skipped, bericht, waarschuwingen = []) {
  const body = document.getElementById('result-body');
  body.innerHTML = '';

  if (bericht) {
    body.innerHTML = `<p style="color:var(--muted);font-size:0.83rem">${bericht}</p>`;
  }

  waarschuwingen.forEach(w => {
    const tekst = w.soort === 'reistijd-geschat'
      ? `⚠ Reistijd kon niet gecontroleerd worden voor ${(w.ticketIds || []).length} tickets — kijk de route na`
      : w.soort === 'locatie-onbekend'
        ? '⚠ Locatie van een bestaande afspraak onbekend — reistijdcontrole minder nauwkeurig'
        : null;
    if (!tekst) return;
    const p = document.createElement('p');
    p.style.cssText = 'color:var(--muted);font-size:0.83rem';
    p.innerHTML = escHtml(tekst);
    body.appendChild(p);
  });

  if (geplande.length) {
    const s = document.createElement('div'); s.className = 'result-section';
    s.innerHTML = `<div class="result-section-title">Ingepland (${geplande.length})</div>`;
    geplande.forEach(({ ticket, date }) => {
      const row = document.createElement('div'); row.className = 'result-item';
      row.innerHTML = `<div class="result-dot ok"></div><div><b>#${escHtml(ticket.number)}</b> ${escHtml(ticket.subject)} → ${fmtDateShort(date)}</div>`;
      s.appendChild(row);
    });
    body.appendChild(s);
  }

  if (nietGepland.length) {
    const s = document.createElement('div'); s.className = 'result-section';
    s.innerHTML = `<div class="result-section-title">Niet ingepland (${nietGepland.length})</div>`;
    nietGepland.forEach(({ ticket: t, reden }) => {
      const row = document.createElement('div'); row.className = 'result-item';
      row.innerHTML = `<div class="result-dot skip"></div><div><b>#${escHtml(t.number)}</b> ${escHtml(t.subject)}<div style="color:var(--muted);font-size:0.78rem">${escHtml(redenTekst(reden))}</div></div>`;
      s.appendChild(row);
    });
    body.appendChild(s);
  }

  if (skipped.length) {
    const s = document.createElement('div'); s.className = 'result-section';
    s.innerHTML = `<div class="result-section-title">Overgeslagen — geen adres (${skipped.length})</div>`;
    skipped.forEach(t => {
      const row = document.createElement('div'); row.className = 'result-item';
      row.innerHTML = `<div class="result-dot skip"></div><div><b>#${escHtml(t.number)}</b> ${escHtml(t.subject)}</div>`;
      s.appendChild(row);
    });
    body.appendChild(s);
  }

  document.getElementById('result-overlay').classList.add('open');
}

export function closeResult(e) {
  if (e && e.target !== document.getElementById('result-overlay')) return;
  document.getElementById('result-overlay').classList.remove('open');
}
