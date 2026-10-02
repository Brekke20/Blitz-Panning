// schermen/annuleren.js — afspraak annuleren (etappe 5a): annuleervenster, mailvoorbeeld en verzenden.
// De code is letterlijk uit index.html verhuisd (W11/D12: ook verstuurAnnulatie en elke schrijfactie op planning, lijsten en
// register; hier mailt de server de klant en zet hij het ticket in Zoho terug). Enkel de voorvoegsels zijn nieuw: `afh.` voor
// de andere schermen, `toestand.get/set/raak` voor de gedeelde gegevens, en imports. Het gepinde HUIDIG GEDRAG (een 502 nadat
// de mail weg is laat het ticket gepland staan) blijft bewust ongewijzigd. _ann en de redenenlijst zijn module-privé.
// Raakt `document` enkel binnen functies. Alleen `kern/brug.js` wijst `window`-namen toe. De knoppen lopen via data-actie-
// delegatie, de mailkeuze via data-wijzig en de toelichting via data-invoer; de overlay sluit via registreerBackdrop.
// De `toggle` van <details> bubbelt niet: die luisteraar hangt rechtstreeks aan #annuleer-details.
import { foutTekst, leesFout } from '../kern/api.js';
import { controleerMail, mailControleTekst, TEKST_CONTROLEREN } from '../kern/mailcontrole.js';
import { toestand } from '../kern/toestand.js';
import { TEST_MODE } from '../kern/omgeving.js';
import { toast, registreerActies, registreerWijzigActies, registreerBackdrop, strengeAfh } from '../kern/ui.js';
import { localISO } from '../kern/tijd.js';
import { registreerVenster } from '../venster.js';
import { renderTickets } from './wachtrij.js';
import { renderKalender } from './kalender.js';
import { renderGepland } from './ingepland.js';
import { joinNL, DOELGROEP_LABEL } from './ticketdetail-logica.js';

// Afhankelijkheden uit app.js en andere schermen (ingevuld door initAnnuleren); een vergeten init faalt luid.
let afh = new Proxy({}, { get() { throw new Error('annuleren: initAnnuleren() is niet aangeroepen'); } });

export function initAnnuleren(afhankelijkheden) {
  afh = strengeAfh('annuleren', afhankelijkheden);
  registreerActies(document.body, {
    'annuleer-sluit':    () => sluitAnnuleerVenster(),
    'annuleer-terug':    () => sluitAnnuleerVenster(),
    'annuleer-verstuur': () => verstuurAnnulatie(),
  });
  registreerWijzigActies(document.body, { 'annuleer-wijzig': () => annuleerWijzig() });
  document.getElementById('annuleer-details').addEventListener('toggle', () => annuleerVoorbeeld());
  const overlay = document.getElementById('annuleer-overlay');
  registreerBackdrop(overlay, sluitAnnuleerVenster);
  registreerVenster({ el: overlay, sluit: () => sluitAnnuleerVenster() });
}

let _annuleerRedenen = null; // [{code,label}] -- één keer opgehaald
let _ann = null;             // toestand van het openstaande venster

// Enkel voor e2e in testmodus (E12: /api/annuleer is daar verboden): zet de redenenlijst vooraf, zodat er geen GET nodig is.
// Buiten ?test gooit ze, zodat een console-aanroeper via window.kern de redenen van een klantmail niet kan vervangen.
export function zetRedenenVoorTest(lijst) {
  if (!TEST_MODE) throw new Error('zetRedenenVoorTest is enkel beschikbaar in testmodus');
  _annuleerRedenen = lijst;
}

// Gekozen persoon op dit toestel (persoonskiezer bewaart 'all' voor "Alle technici"); niemand = leeg.
function annuleerDoor() {
  let d = '';
  try { d = localStorage.getItem('blitz_active_person') || ''; } catch (e) {}
  return d === 'all' ? '' : d;
}

async function laadAnnuleerRedenen() {
  if (_annuleerRedenen) return _annuleerRedenen;
  const res = await fetch('/api/annuleer');
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  if (!Array.isArray(data.redenen) || !data.redenen.length) throw new Error('Geen redenen ontvangen');
  _annuleerRedenen = data.redenen;
  return _annuleerRedenen;
}

function annuleerZoekTicket(ticketId, date) {
  const planning = toestand.get('planning'), allTickets = toestand.get('allTickets'), allPending = toestand.get('allPending'), allGepland = toestand.get('allGepland'); // synchrone functie: geen await tussen lezen en gebruik
  const stop = (planning[date] || []).find(p => p.ticket.id === ticketId)
    || Object.values(planning).flat().find(p => p.ticket.id === ticketId);
  if (stop) return { ticket: stop.ticket, stop };
  if (afh.actiefTicket()?.id === ticketId) return { ticket: afh.actiefTicket(), stop: null };
  const t = [...allTickets, ...allPending, ...allGepland].find(x => x.id === ticketId);
  return { ticket: t || null, stop: null };
}

function annuleerStopDatum(ticketId) {
  const planning = toestand.get('planning'); // synchrone functie: geen await tussen lezen en gebruik
  return Object.keys(planning).find(d => planning[d].some(p => p.ticket.id === ticketId)) || null;
}

export async function openAnnuleerVenster(ticketId, date, { mailStandaard = true } = {}) {
  if (!ticketId || _ann) return;
  const { ticket, stop } = annuleerZoekTicket(ticketId, date);
  if (!ticket) return toast('✕ Ticket niet gevonden.');
  let redenen;
  try { redenen = await laadAnnuleerRedenen(); }
  catch (e) { return toast('✕ De redenenlijst laden mislukt. Probeer opnieuw. (Detail: ' + foutTekst(e) + ')'); }
  if (_ann) return;

  // Datum en tijd(slot) voor kop en voorbeeld
  const datum = (stop && annuleerStopDatum(ticketId)) || date
    || (ticket.interventieDatum ? localISO(new Date(ticket.interventieDatum)) : null);
  const vs = toestand.get('voorstelStatus')[ticketId];
  const tijdslot = vs?.tijdslot && vs.tijdslotDatum === datum ? vs.tijdslot : '';
  let uur = '';
  if (!tijdslot) {
    if (stop?.uur) uur = stop.uur;
    else if (ticket.interventieDatum) {
      const d = new Date(ticket.interventieDatum);
      uur = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
  }

  // Ontvangers: zelfde volgorde en ontdubbeling als het voorstel
  const gezien = new Set();
  const ontvangers = [ticket.email, ticket.emailEindklant, ticket.emailInstallateur].filter(m => {
    if (!m) return false;
    const k = m.toLowerCase();
    if (gezien.has(k)) return false;
    gezien.add(k);
    return true;
  });

  const naam = ticket.naamEindklant || ticket.contact || '';
  _ann = { ticketId, ticket, datum, tijdslot, uur, naam, ontvangers, busy: false, seq: 0, timer: null };

  const datumTxt = datum ? new Date(datum + 'T12:00:00').toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short' }) : '';
  const tijdTxt = tijdslot || (uur ? 'om ' + uur : '');
  document.getElementById('annuleer-label').textContent =
    `#${ticket.number} — ${naam || 'onbekende klant'}` + (datumTxt ? ` · ${datumTxt}${tijdTxt ? ' ' + tijdTxt : ''}` : '');

  const lijst = document.getElementById('annuleer-redenen');
  lijst.textContent = '';
  redenen.forEach(r => {
    const lab = document.createElement('label');
    lab.className = 'ann-optie';
    const inp = document.createElement('input');
    inp.type = 'radio'; inp.name = 'ann-reden'; inp.value = r.code;
    inp.addEventListener('change', annuleerWijzig);
    const sp = document.createElement('span');
    sp.textContent = r.label;
    lab.append(inp, sp);
    lijst.appendChild(lab);
  });
  document.getElementById('annuleer-toelichting').value = '';
  const ja = document.getElementById('annuleer-mail-ja'), nee = document.getElementById('annuleer-mail-nee');
  ja.disabled = !ontvangers.length;
  ja.checked = !!ontvangers.length && mailStandaard;
  nee.checked = !ja.checked;
  document.getElementById('annuleer-details').open = false;
  document.getElementById('annuleer-frame').srcdoc = '';
  document.getElementById('annuleer-terug').disabled = false;
  document.getElementById('annuleer-verstuur').textContent = 'Afspraak annuleren';
  annuleerWijzig();
  document.getElementById('annuleer-overlay').classList.add('open');
}

// Leest het formulier; geldig = reden gekozen, bij "Andere" ook een toelichting.
function annuleerLees() {
  const reden = document.querySelector('input[name="ann-reden"]:checked')?.value || '';
  const toelichting = document.getElementById('annuleer-toelichting').value;
  const ja = document.getElementById('annuleer-mail-ja');
  const mailKlant = ja.checked && !ja.disabled;
  const geldig = !!reden && toelichting.length <= 1000 && (reden !== 'andere' || toelichting.trim().length > 0);
  return { reden, toelichting, mailKlant, geldig };
}

export function annuleerWijzig() {
  if (!_ann) return;
  const v = annuleerLees();
  const andere = v.reden === 'andere';
  document.getElementById('annuleer-hint').style.display = andere ? 'none' : '';
  document.getElementById('annuleer-toelichting-label').textContent = andere ? 'Toelichting (verplicht, komt in de mail aan de klant)' : 'Toelichting (optioneel)';
  document.getElementById('annuleer-toelichting').required = andere;
  document.getElementById('annuleer-ontvangers').textContent = !_ann.ontvangers.length
    ? 'Geen mailadres bekend'
    : (v.mailKlant ? 'Wordt verstuurd naar: ' + _ann.ontvangers.join(', ') : 'De klant krijgt geen mail.');
  document.getElementById('annuleer-verstuur').disabled = !v.geldig || _ann.busy;
  clearTimeout(_ann.timer);
  _ann.timer = setTimeout(annuleerVoorbeeld, 300);
}

// Haalt het mailvoorbeeld bij de server (één plek voor de mailtekst) -- enkel als "Toon mail" openstaat.
async function annuleerVoorbeeld() {
  const s = _ann;
  if (!s || !document.getElementById('annuleer-details').open) return;
  const frame = document.getElementById('annuleer-frame');
  const v = annuleerLees();
  const plaatshouder = t => { frame.srcdoc = `<body style="font-family:sans-serif;color:#555;padding:12px;font-size:14px">${t}</body>`; };
  if (!v.reden) return plaatshouder('Kies eerst een reden.');
  if (!v.geldig) return plaatshouder('Vul eerst de toelichting in.');
  const mijn = ++s.seq;
  try {
    const res = await fetch('/api/annuleer', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        voorbeeld: true, naam: s.naam, datum: s.datum || undefined,
        tijdslot: s.tijdslot || undefined, uur: s.uur || undefined,
        reden: v.reden, toelichting: v.toelichting,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (mijn !== s.seq || _ann !== s) return;
    if (!res.ok || !data.html) throw new Error(data.error || 'HTTP ' + res.status);
    frame.srcdoc = data.html.replace('</head>', '<style>table[width="600"]{width:100%!important}img{max-width:100%;height:auto}body{overflow-x:hidden;margin:0}</style></head>');
  } catch (e) {
    if (mijn === s.seq && _ann === s) plaatshouder('Voorbeeld laden mislukt.');
  }
}

export function sluitAnnuleerVenster(e) {
  if (e && e.target !== document.getElementById('annuleer-overlay')) return;
  if (!_ann || _ann.busy) return; // tijdens het versturen sluit niets
  clearTimeout(_ann.timer);
  _ann = null;
  document.getElementById('annuleer-overlay').classList.remove('open');
}

export async function verstuurAnnulatie() {
  const s = _ann;
  if (!s || s.busy) return; // dubbele klik: geen tweede verzoek
  if (afh.inFlight(s.ticketId)) { toast('Even geduld — dit ticket wordt nog bijgewerkt.'); return; }
  const v = annuleerLees();
  if (!v.geldig) return;
  s.busy = true;
  clearTimeout(s.timer);
  const btn = document.getElementById('annuleer-verstuur');
  btn.disabled = true; btn.textContent = 'Bezig…';
  document.getElementById('annuleer-terug').disabled = true;
  document.getElementById('annuleer-overlay').focus({ preventScroll: true });

  const mislukt = (bericht, mogelijkGemaild, eigenToast) => {
    s.busy = false;
    document.getElementById('annuleer-terug').disabled = false;
    btn.textContent = 'Afspraak annuleren';
    annuleerWijzig();
    toast(eigenToast ?? ('✕ Annuleren mislukt: ' + bericht + (mogelijkGemaild ? ' De klant kan al gemaild zijn — controleer in Zoho vóór je opnieuw probeert.' : '')), 7000);
  };

  // Q1 (etappe 7): onzeker resultaat met een gevraagde klantmail. Eerst dezelfde waarschuwing als voorheen; het venster blijft op slot
  // tot de controle (enkel lezen) klaar is, zodat er nooit vanzelf een tweede verzending start.
  const naOnzeker = async (bericht) => {
    toast('✕ Annuleren mislukt: ' + bericht + ' De klant kan al gemaild zijn — controleer in Zoho vóór je opnieuw probeert.', 7000);
    toast(TEKST_CONTROLEREN, 30000);
    const r = await controleerMail({ ticketId: s.ticketId, start });
    if (r.uitkomst === 'verzonden') {
      // Niets opnieuw te versturen: het venster sluit en de planning wordt opnieuw gelezen.
      s.busy = false;
      sluitAnnuleerVenster();
      afh.sluitDetailStil();
      afh.loadVoorstelStatus().catch(() => {}).then(() => afh.planResync());
      toast('✓ ' + mailControleTekst(r), 8000);
    } else if (r.uitkomst === 'niet-verzonden') {
      mislukt(bericht, false, '⚠ ' + mailControleTekst(r));
    } else {
      mislukt(bericht, true); // de bestaande waarschuwing blijft de terugval
    }
  };

  const start = performance.now(); // begin van de verzending, enkel gebruikt na een onzeker resultaat
  let res, data;
  try {
    res = await fetch('/api/annuleer', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticketId: s.ticketId, reden: v.reden, toelichting: v.toelichting, mailKlant: v.mailKlant,
        door: annuleerDoor(), naam: s.naam,
      }),
    });
    data = await res.json().catch(() => ({}));
  } catch (err) {
    if (v.mailKlant && leesFout(err).onzeker) return naOnzeker(foutTekst(err) || 'netwerkfout');
    return mislukt(foutTekst(err) || 'netwerkfout', v.mailKlant);
  }
  if (res.status === 409 && data.nietGepland) {
    // Niets verstuurd: venster blijft open, keuze 'Nee' voorgeselecteerd.
    s.busy = false;
    document.getElementById('annuleer-terug').disabled = false;
    btn.textContent = 'Afspraak annuleren';
    document.getElementById('annuleer-mail-nee').checked = true;
    annuleerWijzig();
    toast('⚠ ' + data.error, 7000);
    return;
  }
  if (!res.ok || data.error) {
    if (v.mailKlant && !data.emailSent && leesFout({ status: res.status }).onzeker) return naOnzeker(foutTekst(data.error || ('HTTP ' + res.status)));
    const mailVerstuurd = Object.values(data.emailSent || {}).some(Boolean);
    const onzeker = v.mailKlant && res.status >= 500 && (mailVerstuurd || !data.emailSent);
    return mislukt(foutTekst(data.error || ('HTTP ' + res.status)), onzeker);
  }

  // Succes: lokaal opruimen zoals removeTicketFromDate, maar zonder /api/plan-call.
  const id = s.ticketId;
  // Geen await meer tussen deze lezingen en hun gebruik (het laatste await is de fetch/json hierboven).
  const planning = toestand.get('planning'), allTickets = toestand.get('allTickets');
  delete toestand.get('voorstelStatus')[id];
  let tk = s.ticket;
  Object.keys(planning).forEach(d => {
    const i = planning[d].findIndex(p => p.ticket.id === id);
    if (i < 0) return;
    tk = planning[d][i].ticket;
    planning[d].splice(i, 1);
    if (!planning[d].length) delete planning[d];
  });
  toestand.raak('planning'); // in-place splice/delete; de handmatige hertekening na loadVoorstelStatus blijft (R7)
  tk.status = 'Wachten op planning';
  tk.interventieDatum = null;
  toestand.set('allPending', toestand.get('allPending').filter(t => t.id !== id));
  toestand.set('allGepland', toestand.get('allGepland').filter(t => t.id !== id));
  if (!allTickets.some(t => t.id === id)) {
    allTickets.push(tk);
    allTickets.sort((a, b) => (a.number || 0) - (b.number || 0));
  }
  toestand.raak('allTickets'); // in-place push/sort (en tk.status wijzigde)
  document.getElementById('cnt-tickets').textContent = allTickets.length;

  s.busy = false;
  sluitAnnuleerVenster();
  afh.sluitDetailStil();
  // Meteen: allPending/allGepland zijn toegewezen en allTickets geraakt, dus koppelRenders hertekent
  // wachtrij, kalender, ingepland en route. Na het laden van voorstelStatus (geen geabonneerde sleutel)
  // hertekenen we nog eens zelf.
  const hertekenen = () => {
    try {
      const datum = document.getElementById('plan-date').value;
      renderTickets(); renderKalender(); renderGepland(); afh.renderRouteList(datum); afh.updateRouteBtns(datum);
    } catch (e) { console.warn('Hertekenen mislukt:', e); }
  };
  afh.loadVoorstelStatus().then(hertekenen);

  const fouten = Array.isArray(data.fouten) ? data.fouten : [];
  const delen = [];
  if (data.opgeruimd) {
    delen.push('Vergrendeling opgeruimd — ticket stond al niet meer gepland in Zoho');
  } else if (fouten.length) {
    const wie = joinNL([...new Set(fouten.map(f => DOELGROEP_LABEL[f.doelgroep] || f.doelgroep))]);
    delen.push(`Afspraak geannuleerd, maar de mail naar ${wie} kon niet verstuurd worden. Verwittig de klant zelf.`);
  } else {
    delen.push('Afspraak geannuleerd — ' + (v.mailKlant ? 'klant verwittigd per mail' : 'klant niet gemaild'));
  }
  if (data.waarschuwing) delen.push(data.waarschuwing);
  const testSuffix = data.test ? ' (testmodus — niets verstuurd)' : '';
  toast(delen.join(' ') + testSuffix, fouten.length || data.waarschuwing ? 7000 : undefined);
}
