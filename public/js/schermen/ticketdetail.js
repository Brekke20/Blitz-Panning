// schermen/ticketdetail.js — het ticketdetail (etappe 5a): detailvenster, verzetvenster, toewijzen en aankomstregistratie.
// De code is letterlijk uit index.html verhuisd (ook de Zoho-takken van saveReschedule en saveToewijzen: enkel `afh.`-,
// `toestand`- en importvoorvoegsels zijn nieuw). Het actieve ticket (`activeTicket`), de detaildatum (`_detailDate`) en de
// dirty-controle van het KB-concept zijn module-privé en bereikbaar via accessors; gegevens komen uit `kern/toestand`, de
// afhankelijkheden van andere schermen via `initTicketdetail(afh)` (aan het begin van DOMContentLoaded). Raakt `document`
// enkel binnen functies, nooit op moduleniveau. Alleen `kern/brug.js` wijst `window`-namen toe. De knoppen van het
// detail- en verzetvenster lopen via data-actie-delegatie; de overlays sluiten via registreerBackdrop (inhoudsklik sluit niet).
import { toestand } from '../kern/toestand.js';
import { TEST_MODE } from '../kern/omgeving.js';
import { toast, escHtml, registreerActies, registreerBackdrop, strengeAfh } from '../kern/ui.js';
import { localISO, fmtDate, fmtDateShort, extractLocalHour, timeStrToMin, minToTimeStr } from '../kern/tijd.js';
import { registreerVenster } from '../venster.js';
import { nextAvailableDay } from './capaciteit.js';
import { renderKalender } from './kalender.js';
import { tijdslotVoor, telNummer, roundToNextQuarterStr } from './ticketdetail-logica.js';

// Afhankelijkheden uit het klassieke script (ingevuld door initTicketdetail); een vergeten init faalt luid.
let afh = new Proxy({}, { get() { throw new Error('ticketdetail: initTicketdetail() is niet aangeroepen'); } });

// Schermtoestand (voorheen globals in index.html).
let activeTicket = null;
let _detailDate  = null; // datum waarop het actieve ticket ingepland staat
// Dirty-controle van het KB-concept (gezet door renderKbSection; zelfde bron als de opslaan-knop)
let _kbIsDirty = null;
// Aankomsttijden (localStorage 'blitz_arrivals'): in-place bijgewerkt, nooit herbind.
export const arrivalData = JSON.parse(localStorage.getItem('blitz_arrivals') || '{}');

// Accessors voor klassieke code (voorstel, annuleren, KB-sectie) tot hun eigen taak.
export function actiefTicket() { return activeTicket; }
export function zetActiefTicket(t) { activeTicket = t; }
export function detailDatum() { return _detailDate; }
export function zetKbIsDirty(fn) { _kbIsDirty = fn; }

export function initTicketdetail(afhankelijkheden) {
  afh = strengeAfh('ticketdetail', afhankelijkheden);
  // Knoppen van het detail- en verzetvenster via data-actie-delegatie. closeDet krijgt hier geen event: de
  // knoppen sluiten altijd; enkel de achtergrondklik (registreerBackdrop) is op de overlay zelf beperkt.
  registreerActies(document.body, {
    'det-sluit':      () => closeDet(),
    'det-plan':       () => togglePlanFromDetail(),
    'det-aankomst':   () => registerArrival(activeTicket?.id, _detailDate),
    'det-voorstel':   () => afh.openProposal(activeTicket?.id, _detailDate, (() => { const t = afh.computeArrivalTimes(_detailDate); return activeTicket ? t[activeTicket.id] ?? null : null; })()),
    'det-fotos':      () => afh.openFotoModal(activeTicket?.id),
    'det-rapport':    () => afh.openRapport(activeTicket?.id, _detailDate),
    'det-annuleer':   () => afh.openAnnuleerVenster(activeTicket?.id, _detailDate),
    'det-verzet':     () => openRescheduleModal(),
    'verzet-sluit':   () => closeRescheduleModal(),
    'verzet-opslaan': () => saveReschedule(),
  });
  const detOverlay = document.getElementById('det-overlay');
  const verzetOverlay = document.getElementById('reschedule-overlay');
  registreerBackdrop(detOverlay, closeDet);
  registreerBackdrop(verzetOverlay, closeRescheduleModal);
  registreerVenster({ el: detOverlay, sluit: () => closeDet() });
  registreerVenster({ el: verzetOverlay, sluit: () => closeRescheduleModal() });
}

export function getPlanningTicket(id) {
  const allTickets = toestand.get('allTickets');
  const allPending = toestand.get('allPending');
  const allGepland = toestand.get('allGepland');
  const planning = toestand.get('planning');
  const localEvents = toestand.get('localEvents');
  const real = allTickets.find(t => t.id === id)
      || allPending.find(t => t.id === id)
      || allGepland.find(t => t.id === id)
      || Object.values(planning).flat().find(p => p.ticket.id === id)?.ticket;
  if (real) return real;

  const ev = localEvents.find(e => e.id === id);
  if (!ev) return undefined;
  // Pseudo-ticket voor manuele/geïmporteerde afspraken zonder Zoho-ticket, zodat
  // openRapport() ze kan behandelen als een gewoon ticket. account/partner blijven
  // bewust leeg (niet ev.titel) — R.installateur leest ticket.partner||ticket.account,
  // en zou anders bij élke afspraak foutief op "Ja" komen te staan.
  return {
    id: ev.id, number: '', subject: ev.titel,
    address: ev.adres || ev.notitie || '', hasAddress: !!(ev.adres || ev.notitie),
    assignee: ev.persoon || '',
    phone: ev.telefoon || '', telefoonEindklant: ev.telefoon || '',
    contact: ev.titel, account: '', partner: '',
    serienummer: '', priority: '',
    isLocal: true,
    type: ev.type || '',
  };
}

// Grote contactknoppen (Bellen, Mailen, Navigeer) — gedeeld door ticketdetail en Ingepland.
// Navigeer krijgt geen inline onclick: koppelAdresNavigatie() hangt de luisteraar eraan.
export function contactActiesHtml(t) {
  const tel  = t.telefoonEindklant || t.phone;
  const mail = t.emailEindklant || t.email;
  const knoppen = [];
  const telNr = telNummer(tel);
  if (/\d/.test(telNr)) knoppen.push(`<a class="btn btn--secondary btn--lg" href="tel:${escHtml(telNr)}"><span>📞 Bellen</span></a>`);
  const mailAdres = mail ? String(mail).trim() : '';
  if (/^[^\s@,;<>?&]+@[^\s@,;<>?&]+\.[^\s@,;<>?&]+$/.test(mailAdres)) knoppen.push(`<a class="btn btn--secondary btn--lg" href="mailto:${escHtml(encodeURIComponent(mailAdres).replace(/%40/g, '@'))}"><span>✉ Mailen</span></a>`);
  if (t.hasAddress) knoppen.push(`<button type="button" class="btn btn--secondary btn--lg btn-navigeer-groot" data-adres="${escHtml(t.address || '')}"><span>🧭 Navigeer</span></button>`);
  return knoppen.length ? `<div class="contact-acties">${knoppen.join('')}</div>` : '';
}
export function koppelAdresNavigatie(root) {
  root.querySelector('.btn-navigeer-groot')?.addEventListener('click', e => {
    e.stopPropagation();
    afh.navigate(encodeURIComponent(e.currentTarget.dataset.adres));
  });
}

export function openDetail(t) {
  _kbIsDirty = null; // nieuw ticket: oud concept niet meenemen (renderKbSection zet het opnieuw)
  if (!t) return;
  activeTicket = t;

  // Zoek de datum waarop dit ticket ingepland staat
  _detailDate = null;
  for (const [date, stops] of Object.entries(toestand.get('planning'))) {
    if (stops.some(s => s.ticket.id === t.id)) { _detailDate = date; break; }
  }
  const showPlanBtns = !!_detailDate;
  document.getElementById('d-btn-arrival').style.display  = showPlanBtns ? '' : 'none';
  document.getElementById('d-btn-proposal').style.display = showPlanBtns ? '' : 'none';
  document.getElementById('d-btn-fotos').style.display    = showPlanBtns ? '' : 'none';
  document.getElementById('d-btn-rapport').style.display  = showPlanBtns ? '' : 'none';
  document.getElementById('d-btn-reschedule').style.display = showPlanBtns ? '' : 'none';
  document.getElementById('d-num').textContent   = '#' + t.number;
  document.getElementById('d-title').textContent = t.subject || '—';

  const tags = document.getElementById('d-tags');
  tags.innerHTML = `<span class="mtag status">${escHtml(t.status)}</span>`;
  if (t.priority) { const pc = {high:'prtag high',medium:'prtag medium',low:'prtag low'}[(t.priority||'').toLowerCase()]||'mtag'; tags.innerHTML += `<span class="${pc}">${escHtml(afh.prioLabel(t.priority))}</span>`; }
  if (t.assignee) tags.innerHTML += `<span class="mtag assignee">${escHtml(t.assignee)}</span>`;

  // Task 6: Bevestigingslabel als beschikbaar
  const vs = toestand.get('voorstelStatus')[t.id];
  const blabel = afh.bevestigdLabel(vs);
  if (blabel && vs?.bevestigd?.tijdstip) {
    const ts = new Date(vs.bevestigd.tijdstip).toLocaleString('nl-BE', {dateStyle:'short', timeStyle:'short'});
    tags.innerHTML += `<span class="mtag confirmed-by" title="${escHtml(ts)} — Via welke mail bevestigd werd, niet wie er fysiek op drukte">${escHtml(blabel)}</span>`;
  }

  const contactEl = document.getElementById('d-contact');
  contactEl.innerHTML = contactActiesHtml(t);
  koppelAdresNavigatie(contactEl);

  const row = (l, v, href, tel) => v ? `<div class="mrow" data-testid="detail-rij"><span class="mlabel">${l}</span><span class="mval" data-testid="detail-waarde">${tel && /\d/.test(tel) ? `<a href="tel:${escHtml(tel)}">${escHtml(v)}</a>` : href ? `<a href="${href}${escHtml(v)}">${escHtml(v)}</a>` : escHtml(v)}</span></div>` : '';
  document.getElementById('d-klant').innerHTML = [
    row('Contact',  t.naamEindklant || t.contact),
    row('Bedrijf',  t.account),
    row('E-mail',   t.emailEindklant  || t.email, 'mailto:'),
    row('Telefoon', t.telefoonEindklant || t.phone, null, telNummer(t.telefoonEindklant || t.phone)),
    t.hasAddress
      ? `<div class="mrow"><span class="mlabel">Adres</span><span class="mval"><a href="#" class="mval-nav-link" data-adres="${escHtml(t.address)}">${escHtml(t.address)} ↗</a></span></div>`
      : `<div class="mrow"><span class="mlabel">Adres</span><span class="mval miss">Geen adres bekend</span></div>`,
  ].join('');
  document.getElementById('d-klant').querySelector('.mval-nav-link')?.addEventListener('click', e => {
    e.preventDefault();
    afh.navigate(encodeURIComponent(e.currentTarget.dataset.adres));
  });

  document.getElementById('d-ticket').innerHTML = [
    row('Probleemtype', t.probleemtype),
    row('Serienummer',  t.serienummer),
    row('Partner',      t.partner),
    row('Regio',        t.regio),
    row('Interventiedatum',  t.interventieDatum && fmtDate(t.interventieDatum)),
    row('In planning sinds', t.inPlanningSinds && fmtDateShort(t.inPlanningSinds)),
    row('Aangemaakt',   t.createdTime && fmtDate(t.createdTime)),
  ].join('') || '<div class="mrow"><span class="mval" style="color:var(--muted)">—</span></div>';

  // Klantbeschikbaarheid sectie
  afh.renderKbSection(t.id);

  // Plan-knop: zichtbaar voor te-plannen en pending tickets
  const STATUS_TE_PLANNEN = ['Service in te plannen', 'Wachten op planning'];
  const STATUS_PENDING    = ['Wachten op bevestiging planning'];
  const planBtn = document.getElementById('d-plan-btn');
  if (STATUS_TE_PLANNEN.includes(t.status)) {
    planBtn.style.display    = '';
    planBtn.textContent      = '+ Voeg toe aan planning';
    planBtn.classList.add('btn--primary'); planBtn.classList.remove('btn--danger');
  } else if (STATUS_PENDING.includes(t.status) && !afh.heeftLopendVoorstel(t)) {
    planBtn.style.display    = '';
    planBtn.textContent      = '✕ Uit planning halen';
    planBtn.classList.add('btn--danger'); planBtn.classList.remove('btn--primary');
  } else {
    planBtn.style.display = 'none';
  }

  // Afspraak annuleren vervangt "Uit planning halen" zodra er een voorstel uitstaat.
  document.getElementById('d-btn-annuleer').style.display = afh.heeftLopendVoorstel(t) ? '' : 'none';

  document.getElementById('det-overlay').classList.add('open');
}

// Stil sluiten voor programmatische paden (plannen, verzetten, voorstel, rapport openen):
// geen KB-bewaarwaarschuwing, want die acties raken de klantbeschikbaarheid niet.
export function sluitDetailStil() {
  _kbIsDirty = null;
  document.getElementById('det-overlay').classList.remove('open');
}
// Gebruikerssluiting (✕, Escape via venster.js, achtergrondklik): met bewaarwaarschuwing.
export function closeDet(e) {
  if (e && e.target !== document.getElementById('det-overlay')) return;
  if (_kbIsDirty && _kbIsDirty() && window.appConfirm) {
    window.appConfirm({
      titel: 'Niet-opgeslagen wijzigingen',
      tekst: 'Je hebt wijzigingen in de klantbeschikbaarheid die nog niet zijn opgeslagen. Wil je ze weggooien?',
      bevestigLabel: 'Weggooien', annuleerLabel: 'Terug', gevaar: true,
      onBevestig: () => { _kbIsDirty = null; document.getElementById('det-overlay').classList.remove('open'); },
    });
    return;
  }
  _kbIsDirty = null;
  document.getElementById('det-overlay').classList.remove('open');
}

export function openRescheduleModal() {
  if (!activeTicket) return;
  const d = activeTicket.interventieDatum ? new Date(activeTicket.interventieDatum) : new Date();
  document.getElementById('d-reschedule-date').value = localISO(d);
  document.getElementById('d-reschedule-time').value =
    `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  document.getElementById('reschedule-overlay').classList.add('open');
}

export function closeRescheduleModal(e) {
  if (e && e.target !== document.getElementById('reschedule-overlay')) return;
  document.getElementById('reschedule-overlay').classList.remove('open');
}

export async function saveReschedule() {
  if (!activeTicket || !_detailDate) return;
  const date = document.getElementById('d-reschedule-date').value;
  const time = document.getElementById('d-reschedule-time').value || '09:00';
  if (!date) return toast('⚠ Selecteer een datum');

  const oldDate  = _detailDate;
  const t        = activeTicket; // vastleggen: activeTicket kan tijdens de await al naar een ander ticket wijzen
  const ticketId = t.id;

  // Zelfde waarschuwingen als bij een eerste toewijzing (addTicketToDate) — enkel
  // relevant als de dag effectief verandert.
  if (date !== oldDate) {
    const feestdag = afh.getHolidayName(date);
    if (feestdag && !confirm(`🎌 ${feestdag} is een wettelijke feestdag (${fmtDateShort(date)}).\nToch inplannen?`)) return;
    if (afh.kbBlocked(ticketId, date) && !confirm(`⚠ Klant gaf aan NIET beschikbaar te zijn op ${fmtDateShort(date)}.\nToch inplannen?`)) return;
  }

  const utcInterventieDatum = new Date(`${date}T${time}:00`).toISOString();
  closeRescheduleModal();
  sluitDetailStil();
  try {
    // Testmodus (?test, ook op de live site): niets naar Zoho schrijven, lokale wijziging blijft
    if (!TEST_MODE) {
      const res  = await fetch('/api/plan', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ticketId, date, utcInterventieDatum }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
    }

    // Lokale state: uit de oude dag halen, aan de nieuwe dag toevoegen.
    const planning = toestand.get('planning');
    if (planning[oldDate]) {
      planning[oldDate] = planning[oldDate].filter(p => p.ticket.id !== ticketId);
      if (!planning[oldDate].length) delete planning[oldDate];
    }
    t.interventieDatum = utcInterventieDatum;
    t.status = 'Wachten op bevestiging planning';
    if (!planning[date]) planning[date] = [];
    if (!planning[date].find(p => p.ticket.id === ticketId)) {
      planning[date].push({ ticket: t, address: t.address, uur: extractLocalHour(utcInterventieDatum) });
    }
    toestand.raak('planning'); // in-place filter/delete/push (oude en nieuwe dag)
    // Array-membership bijwerken: een verzet ticket kan tot nu toe "Bevestigd" (allGepland)
    // geweest zijn; de status hierboven gaat terug naar "Wachten op bevestiging planning".
    toestand.set('allGepland', toestand.get('allGepland').filter(x => x.id !== ticketId));
    const allPending = toestand.get('allPending');
    if (!allPending.find(x => x.id === ticketId)) allPending.push(t);

    // allGepland is toegewezen en allPending in-place gewijzigd: koppelRenders hertekent kalender,
    // ingepland en route. De wachtrij hertekende hier vroeger ook (t.status wijzigde): raak('allTickets')
    // behoudt dat.
    toestand.raak('allTickets');
    toestand.raak('allPending');
    toast(TEST_MODE ? '🧪 Testmodus — niet opgeslagen' : `✓ Verzet naar ${fmtDateShort(date)} om ${time}`);
  } catch (err) {
    toast('✕ Bijwerken in Zoho mislukt. Probeer opnieuw; blijft het fout, meld dit. (Detail: ' + err.message + ')', 4000);
  }
}

export async function togglePlanFromDetail() {
  if (!activeTicket) return;
  if (['Service in te plannen','Wachten op planning'].includes(activeTicket.status)) {
    const date = nextAvailableDay(localISO(new Date()));
    if (!date) return toast('Geen beschikbare dag gevonden');
    sluitDetailStil();
    if (!(await afh.addTicketToDate(activeTicket.id, date))) return;
    toast('✓ Toegevoegd aan ' + fmtDateShort(date));
  } else if (activeTicket.status === 'Wachten op bevestiging planning') {
    const planning = toestand.get('planning');
    const date = Object.keys(planning).find(d => planning[d].find(p => p.ticket.id === activeTicket.id));
    if (!date) return toast('Dit ticket staat niet (meer) in de planning.');
    const ticketId = activeTicket.id;
    if (!(await afh.bevestigUitplannen(ticketId, date))) return;
    sluitDetailStil();
  }
}

// Het tijdslot dat aan de klant gecommuniceerd is heeft voorrang op een herberekening:
// als er voor dit ticket een voorstel verstuurd is voor exact deze datum, toon dat blok.
// Anders (nog niets gemaild, of ondertussen verzet naar een andere datum) herberekenen.
export function tijdslotLabelVoor(stop, date) {
  const vs = toestand.get('voorstelStatus')[stop.ticket?.id];
  if (vs?.tijdslot && vs.tijdslotDatum === date) return vs.tijdslot;
  return stop.uur ? tijdslotVoor(timeStrToMin(stop.uur), undefined, toestand.get('settings')).label : '';
}

export function toggleAssignRow(ticketId) {
  const row = document.getElementById('assign-row-' + ticketId);
  if (!row) return;
  const wasHidden = row.style.display === 'none';
  row.style.display = wasHidden ? 'flex' : 'none';
  if (wasHidden) {
    const dateInp = document.getElementById('assign-date-' + ticketId);
    if (dateInp && !dateInp.value) dateInp.value = localISO(new Date());
    // Prefill tijdstip: voorkeursuur klant (vast tijdstip) heeft voorrang,
    // anders berekende aankomsttijd als beschikbaar
    const timeInp = document.getElementById('assign-time-' + ticketId);
    if (timeInp) {
      const voorkeurTijd = afh.kbPreferredTime(ticketId);
      if (voorkeurTijd) {
        timeInp.value = voorkeurTijd;
      } else {
        const date    = dateInp?.value || localISO(new Date());
        const times   = afh.computeArrivalTimes(date);
        const arrival = times[ticketId];
        timeInp.value = arrival != null
          ? roundToNextQuarterStr(minToTimeStr(arrival))
          : '09:00';
      }
    }
  }
}

export async function saveToewijzen(ticketId) {
  const dateInp = document.getElementById('assign-date-' + ticketId);
  const timeInp = document.getElementById('assign-time-' + ticketId);
  const date    = dateInp?.value;
  const time    = timeInp?.value || '09:00';
  if (!date) return toast('⚠ Selecteer een datum');

  const utcInterventieDatum = new Date(`${date}T${time}:00`).toISOString();

  try {
    // Testmodus (?test, ook op de live site): niets naar Zoho schrijven, lokale wijziging blijft
    if (!TEST_MODE) {
      const res  = await fetch('/api/plan-datum', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ticketId, utcInterventieDatum }),
      });
      const data = await res.json().catch(() => ({ error: 'HTTP ' + res.status })); // W5-fix: onleesbaar antwoord (bv. 502-HTML) wordt 'HTTP <status>'
      if (!data.ok) throw new Error(data.error || 'Onbekende fout');
    }

    // Update lokale state
    const planning = toestand.get('planning');
    const t = toestand.get('allPending').find(p => p.id === ticketId);
    if (t) {
      t.interventieDatum = utcInterventieDatum;
      if (!planning[date]) planning[date] = [];
      if (!planning[date].find(p => p.ticket.id === ticketId)) {
        planning[date].push({ ticket: t, address: t.address, uur: extractLocalHour(utcInterventieDatum) });
      }
      toestand.raak('planning'); // koppelRenders hertekent de route (de lijst bleef hier voorheen verouderd)
    }
    renderKalender();
    toast(TEST_MODE ? '🧪 Testmodus — niet opgeslagen' : `✓ Datum ingesteld op ${date} om ${time}`);
  } catch (err) {
    toast('✕ ' + err.message, 5000);
  }
}

export function registerArrival(ticketId, date) {
  const key = `${date}__${ticketId}`;
  const now  = new Date();
  const hhmm = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  if (arrivalData[key]) {
    if (!confirm(`Aankomst al geregistreerd om ${arrivalData[key]}. Overschrijven?`)) return;
  }
  arrivalData[key] = hhmm;
  localStorage.setItem('blitz_arrivals', JSON.stringify(arrivalData));
  toast(`⏱ Aankomst geregistreerd: ${hhmm}`);
  afh.renderRouteList(date);
}
