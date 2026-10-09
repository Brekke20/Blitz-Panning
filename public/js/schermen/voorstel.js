// schermen/voorstel.js — het afspraakvoorstel aan de klant (etappe 5a): voorstelvenster, voorbeeld, verzenden en voorstelstatus.
// De code is letterlijk uit index.html verhuisd (W11/D12: ook sendProposal en elke schrijfactie op de voorstelstatus). Enkel de
// voorvoegsels zijn nieuw: `afh.` voor het actieve ticket en de andere schermen, `toestand.get/set/raak` voor de gedeelde
// gegevens, en imports. Het gepinde HUIDIG GEDRAG (o.a. de parser-foutmelding bij een 502 en de ontbrekende waarschuwingen)
// blijft bewust ongewijzigd. De ontvangerslijst, de serverversie van de voorstelstatus zijn module-privé.
// Raakt `document` enkel binnen functies. Alleen `kern/brug.js` wijst `window`-namen toe. De knoppen lopen via data-actie-
// delegatie, de twee invoervelden via data-invoer, de overlay sluit via registreerBackdrop (inhoudsklik sluit niet).
import { toestand } from '../kern/toestand.js';
import { TEST_MODE } from '../kern/omgeving.js';
import { apiJson, foutTekst, leesFout } from '../kern/api.js';
import { controleerMail, mailControleTekst, mailControleAfsluiting, TEKST_CONTROLEREN } from '../kern/mailcontrole.js';
import { toast, escHtml, registreerActies, registreerWijzigActies, registreerBackdrop, strengeAfh } from '../kern/ui.js';
import { timeStrToMin, minToTimeStr, extractLocalHour } from '../kern/tijd.js';
import { registreerVenster } from '../venster.js';
import { renderTickets } from './wachtrij.js';
import { renderKalender } from './kalender.js';
import { bewaarVoorstelRegister, registerEntry, doelgroepenVoorAdressen } from './voorstel-register.js';
import { tijdslotVoor, roundToNextQuarterStr, cleanTicketSubject, joinNL, DOELGROEP_LABEL } from './ticketdetail-logica.js';

// Afhankelijkheden uit app.js en andere schermen (ingevuld door initVoorstel); een vergeten init faalt luid.
let afh = new Proxy({}, { get() { throw new Error('voorstel: initVoorstel() is niet aangeroepen'); } });

let _proposalOntvangers = []; // ontvangerslijst berekend door openProposal(), gebruikt door updateProposalPreview()/sendProposal()

export function initVoorstel(afhankelijkheden) {
  afh = strengeAfh('voorstel', afhankelijkheden);
  registreerActies(document.body, {
    'voorstel-sluit':    () => closeProposal(),
    'voorstel-verstuur': () => sendProposal(),
    'voorstel-inert':    (el, e) => e.preventDefault(), // het voorbeeld-anker is inert: geen navigatie
  });
  registreerWijzigActies(document.body, { 'voorstel-voorbeeld': () => updateProposalPreview() });
  const overlay = document.getElementById('proposal-overlay');
  registreerBackdrop(overlay, closeProposal);
  registreerVenster({ el: overlay, sluit: () => closeProposal() });
}

// Centraal (niet-lokaal) bijgehouden "voorstel verzonden"-status, eager geladen bij
// app-start (zie loadVoorstelStatus()) -- vervangt de vorige localStorage-aanpak volledig.
// null (niet 0) zolang de echte serverversie onbekend is: `typeof null !== 'number'` laat
// de server zijn optimistic-locking check overslaan i.p.v. eeuwig te 409'en op versie 0
// als loadVoorstelStatus() faalde (zelfde patroon als _archiefVersie).
let _voorstelStatusVersie = null;
// I3 (eindreview v1.4.0): geeft true/false terug zodat applyRouteOrder() kan beslissen of de
// vergrendelstatus vers genoeg is om op te beslissen wat anker is en wat niet -- bij een
// mislukte refresh mag er nooit op een mogelijk stale voorstelStatus verder gewerkt worden.
export async function loadVoorstelStatus() {
  try {
    const data = await apiJson('/api/voorstel-status');
    toestand.set('voorstelStatus', data.status || {});
    _voorstelStatusVersie = data.versie || 0;
    return true;
  } catch (err) {
    console.warn('Voorstel-status laden mislukt:', err);
    return false;
  }
}

const TEKST_REGISTER_MISLUKT = '⚠ Voorstel verstuurd, maar de status kon niet bewaard worden — NIET opnieuw versturen, herlaad eerst de pagina';

function hertekenVoorstelStatus(date) {
  try { renderTickets(); renderKalender(); afh.renderRouteList(date); } catch (e) { console.warn('Hertekenen mislukt:', e); }
}

// Schrijft het register voor de doelgroepen die de mail kregen (B1) en zet daarna de lokale entry, ook als het bewaren mislukte
// (de mail is weg; de entry verdwijnt bij de volgende lading van de server). Geeft true als het bewaren op de server lukte.
async function schrijfVerzondenRegister({ ticketId, doelgroepen, tijdstip, tijdslot, date }) {
  const tijdslotDatum = tijdslot ? date : undefined;
  const r = await bewaarVoorstelRegister({
    ticketId, doelgroepen, tijdstip, tijdslot: tijdslot || undefined, tijdslotDatum,
    leesVersie: () => _voorstelStatusVersie, herlaad: loadVoorstelStatus,
  });
  if (r.ok && typeof r.versie === 'number') _voorstelStatusVersie = r.versie;
  if (!r.ok) console.warn('Voorstel-status opslaan mislukt:', r.reden, r.status ?? '');
  toestand.get('voorstelStatus')[ticketId] = registerEntry({ doelgroepen, tijdstip, tijdslot, tijdslotDatum });
  hertekenVoorstelStatus(date);
  return r.ok;
}

export function openProposal(ticketId, date, arrivalMin) {
  afh.zetActiefTicket(afh.getPlanningTicket(ticketId));
  if (!afh.actiefTicket()) return toast('Ticket niet gevonden');
  afh.sluitDetailStil();

  document.getElementById('proposal-date').value = date;

  // Tijdstip: van aankomsttijd (minuten) → HH:MM → afgerond naar volgend kwartier
  let timeVal = '09:00';
  if (arrivalMin !== null && arrivalMin !== undefined && !isNaN(arrivalMin)) {
    timeVal = roundToNextQuarterStr(minToTimeStr(arrivalMin));
  }
  document.getElementById('proposal-time').value = timeVal;

  const contactEmail = afh.actiefTicket().email || null;
  const seenEmails = new Set();
  const ontvangers = [contactEmail, afh.actiefTicket().emailEindklant || null, afh.actiefTicket().emailInstallateur || null]
    .filter(email => {
      if (!email) return false;
      const key = email.toLowerCase();
      if (seenEmails.has(key)) return false;
      seenEmails.add(key);
      return true;
    });
  _proposalOntvangers = ontvangers;
  document.getElementById('proposal-email').textContent = ontvangers.length
    ? `Wordt verstuurd naar: ${ontvangers.join(', ')}`
    : 'Geen gekend e-mailadres — ticket wordt bijgewerkt maar er wordt geen mail verstuurd.';

  const name = afh.actiefTicket().naamEindklant || afh.actiefTicket().contact || '';
  document.getElementById('proposal-ticket-label').textContent =
    `#${afh.actiefTicket().number} — ${name || 'onbekende klant'}`;

  updateProposalPreview();
  document.getElementById('proposal-overlay').classList.add('open');
}

export function updateProposalPreview() {
  if (!afh.actiefTicket()) return;
  const date     = document.getElementById('proposal-date').value;
  const rawTime  = document.getElementById('proposal-time').value;
  // Weergave-tijdslot (Task 9, Blok 1C): de klant ziet nooit de exacte tijd, enkel het
  // configureerbare tijdslot (bv. "10:00–13:00") waarin apptTime valt. aankomstTijdenVoorDag() (kern.route; legacy-naam computeArrivalTimes)
  // en de exacte opgeslagen tijd blijven hierdoor volledig ongewijzigd — dit is uitsluitend
  // een weergave-laag via tijdslotVoor() (Task 6). I5 (eindreview v1.4.0): tijdslotVoor() volgt
  // de schatting nu ook buiten de werkdag (zie aldaar) -- hieronder tonen we in dat geval een
  // aparte waarschuwing, puur informatief voor de coördinator, geen blokkering.
  const apptMin    = rawTime ? timeStrToMin(roundToNextQuarterStr(rawTime)) : null;
  const apptWindow = apptMin !== null ? tijdslotVoor(apptMin, undefined, toestand.get('settings')).label : '—';
  const buitenWerkdag = apptMin !== null && (
    apptMin < timeStrToMin(toestand.get('settings').vanTijd || '08:00') ||
    apptMin >= timeStrToMin(toestand.get('settings').totTijd || '17:00')
  );
  const outsideEl = document.getElementById('proposal-outside-workday');
  if (outsideEl) outsideEl.style.display = buitenWerkdag ? '' : 'none';
  const dateFmt  = date
    ? new Date(date + 'T12:00:00').toLocaleDateString('nl-BE', { weekday:'long', day:'numeric', month:'long', year:'numeric' })
    : '—';
  const name     = escHtml(afh.actiefTicket().naamEindklant || afh.actiefTicket().contact || 'klant');
  const subj     = escHtml(cleanTicketSubject(afh.actiefTicket().subject));
  const sn       = escHtml(afh.actiefTicket().serienummer || '');

  document.getElementById('proposal-no-email').style.display = _proposalOntvangers.length ? 'none' : '';

  const bolt = `<svg width="14" height="22" viewBox="0 0 14 22" xmlns="http://www.w3.org/2000/svg">`
    + `<line x1="9" y1="5" x2="6" y2="11" stroke="#00dfa3" stroke-width="3" stroke-linecap="round"/>`
    + `<line x1="8" y1="12" x2="5" y2="18" stroke="#00dfa3" stroke-width="3" stroke-linecap="round"/>`
    + `</svg>`;

  document.getElementById('proposal-preview').innerHTML = `
    <div style="background:#181e24;padding:14px 18px;display:flex;align-items:center;gap:10px">
      ${bolt}
      <div>
        <span style="font-family:'Arial Black',Arial,sans-serif;font-size:15px;font-weight:900;letter-spacing:3px;color:#00dfa3">BLITZ</span>
        <span style="display:block;font-size:8px;color:#5a6472;letter-spacing:2px">POWER</span>
      </div>
    </div>
    <div style="height:2px;background:#00dfa3"></div>
    <div style="padding:16px 18px;font-family:Arial,sans-serif;background:#fff">
      <p style="margin:0 0 10px;font-size:13px;color:#181e24">Geachte ${name},</p>
      <p style="margin:0 0 14px;font-size:13px;color:#3a3a3a;line-height:1.5">Wij plannen een servicebezoek voor: <strong>${subj}</strong>.</p>
      <div style="background:#f7f7f7;border-left:3px solid #00dfa3;padding:12px 14px;margin-bottom:14px;border-radius:0 4px 4px 0">
        <div style="font-size:9px;text-transform:uppercase;letter-spacing:1px;color:#8a9aaa;margin-bottom:4px">Voorgestelde afspraak</div>
        <div style="font-size:15px;font-weight:700;color:#181e24">${dateFmt}</div>
        <div style="font-size:12px;color:#3a3a3a">tussen <strong>${apptWindow}</strong> uur</div>
        ${sn ? `<div style="font-size:10px;color:#8a9aaa;margin-top:6px">Serienummer: ${sn}</div>` : ''}
      </div>
      <!-- Fix 3 (finale review): dit spiegelt de bevestigingsknop uit propose.js's buildEmailHtml()
           (Fix 1/2), zodat de coördinator hier ziet wat de klant écht ontvangt. Bewust GEEN echte
           confirmUrl/href nodig -- dit is een preview, geen live link, dus een inert element
           (href="#") kan geen per-ongeluk-klik veroorzaken. Stijl (kleuren/padding/radius) moet
           gelijk blijven aan de echte knop. -->
      <div style="text-align:center;margin:14px 0">
        <a href="#" data-actie="voorstel-inert" style="display:inline-block;background:#00dfa3;color:#181e24;
          text-decoration:none;font-weight:700;font-size:13px;padding:10px 24px;border-radius:6px">
          ✅ Bevestig deze afspraak
        </a>
      </div>
      <p style="margin:0 0 10px;font-size:12px;color:#3a3a3a">Klik op de knop hierboven en bevestig op de volgende pagina om deze afspraak vast te leggen, of antwoord op deze e-mail. Komt het voorgestelde tijdstip u niet uit? Laat het ons dan weten via een antwoord op deze e-mail, zodat we samen een alternatief zoeken. In bijlage vindt u onze service voorwaarden — door de afspraak te bevestigen gaat u hiermee akkoord.</p>
      <p style="margin:0;font-size:12px;color:#3a3a3a">Met vriendelijke groeten,<br><strong>Team Blitz Power — Service &amp; Support</strong></p>
    </div>
    <div style="background:#f7f7f7;border-top:1px solid #e8e8e8;padding:10px 18px;font-size:10px;color:#8a9aaa">
      📎 Bijlage: Service Voorwaarden Blitz Power.pdf
    </div>
    <div style="background:#f7f7f7;border-top:1px solid #e8e8e8;padding:10px 18px;font-size:10px;color:#8a9aaa">
      Blitz Power BV &nbsp;·&nbsp; Tel: +32 3 36 16 404 &nbsp;·&nbsp;
      <span style="color:#00dfa3">www.blitzpower.com</span>
    </div>`;
}

export function closeProposal(e) {
  if (e && e.target !== document.getElementById('proposal-overlay')) return;
  document.getElementById('proposal-overlay').classList.remove('open');
}

export async function sendProposal() {
  if (!afh.actiefTicket()) return;
  const ticketId       = afh.actiefTicket().id;
  const date           = document.getElementById('proposal-date').value;
  const rawTime        = document.getElementById('proposal-time').value;

  if (!date) return toast('⚠ Selecteer een datum');

  const btn = document.getElementById('proposal-send-btn');
  btn.disabled    = true;
  btn.textContent = 'Bezig...';

  // Weergave-tijdslot (Task 9, Blok 1C) — zelfde berekening als updateProposalPreview(). Vóór de
  // TEST_MODE-tak berekend (Taak 3, punt 4), zodat ook in testmodus het lokaal opgeslagen
  // voorstelStatus het gemailde tijdslot bevat en de UI dat kan tonen.
  const apptMinSend    = rawTime ? timeStrToMin(roundToNextQuarterStr(rawTime)) : null;
  const apptWindowSend = apptMinSend !== null ? tijdslotVoor(apptMinSend, undefined, toestand.get('settings')).label : '';

  if (TEST_MODE) {
    await new Promise(r => setTimeout(r, 600));
    afh.actiefTicket().status = 'Wachten op bevestiging planning';
    toestand.set('allTickets', toestand.get('allTickets').filter(t => t.id !== ticketId));
    if (!toestand.get('allPending').find(t => t.id === ticketId)) toestand.get('allPending').push(afh.actiefTicket());
    toestand.raak('allPending'); // in-place push
    // Nieuw voorstel vervangt de oude registerentry (geen oude doelgroepen/bevestiging laten staan).
    // Realistisch register-effect: doelgroepen met tijdstip, zodat 🔒 en de annuleerknop verschijnen.
    const nuIso = new Date().toISOString();
    const lc = e => (e || '').toLowerCase();
    const inLijst = e => !!e && _proposalOntvangers.some(o => lc(o) === lc(e));
    const regEntry = apptWindowSend ? { tijdslot: apptWindowSend, tijdslotDatum: date } : {};
    if (inLijst(afh.actiefTicket().email)) regEntry.contact = nuIso;
    if (inLijst(afh.actiefTicket().emailEindklant)) regEntry.klant = nuIso;
    if (inLijst(afh.actiefTicket().emailInstallateur)) regEntry.installateur = nuIso;
    toestand.get('voorstelStatus')[ticketId] = regEntry;
    document.getElementById('proposal-overlay').classList.remove('open');
    btn.disabled = false; btn.textContent = '✉️ Verstuur voorstel';
    // allTickets is toegewezen: koppelRenders hertekent wachtrij, kalender en route (voorstelStatus
    // en planning zijn dan al bijgewerkt: de flush volgt pas na dit synchrone blok).
    toast(`🧪 Testmodus — ${_proposalOntvangers.length ? 'voorstel verstuurd (demo)' : 'status bijgewerkt (geen e-mail)'}`, 3500);
    return;
  }

  // Q1 (etappe 7): begin van de verzending en de ontvangers, voor de controle na een onzeker resultaat (enkel in de catch gebruikt).
  const verzendStart = performance.now();
  const verzendStartWand = Date.now(); // I1: loopt door tijdens slaapstand, performance.now() niet
  const verwachtAdressen = [..._proposalOntvangers];
  // B4: de ticketadressen, het tijdslot en de datum van DEZE verzending, vastgelegd vóór de fetch (het actieve ticket kan intussen wisselen).
  const registerInvoer = {
    ticketMails: { email: afh.actiefTicket().email, emailEindklant: afh.actiefTicket().emailEindklant, emailInstallateur: afh.actiefTicket().emailInstallateur },
    tijdslot: apptWindowSend, date,
  };
  try {
    // Bereken UTC-tijdstip in de browser (die kent de lokale tijdzone)
    const timeStr             = rawTime || '09:00';
    const utcInterventieDatum = new Date(`${date}T${timeStr}:00`).toISOString();

    const res  = await fetch('/api/propose', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        ticketId,
        date,
        time: rawTime,
        utcInterventieDatum,
        recipientName: afh.actiefTicket().naamEindklant || afh.actiefTicket().contact || '',
        subject:       cleanTicketSubject(afh.actiefTicket().subject),
        serienummer:   afh.actiefTicket().serienummer || '',
        appointmentWindow: apptWindowSend,
      }),
    });
    const data = await res.json().catch(() => ({ error: 'HTTP ' + res.status })); // W5-fix: onleesbaar antwoord (bv. 502-HTML) wordt 'HTTP <status>'
    if (data.error) {
      // B2: de server meldt dat de mail al vertrokken is maar de ticket-update daarna faalde: geen gewone fout maar een waarschuwing.
      const vertrokken = ['contact', 'klant', 'installateur'].filter(d => data.emailSent?.[d] === true);
      if (vertrokken.length) return naMailZonderTicketUpdate({ ticketId, date, vertrokken, fout: data.error, registerInvoer, btn });
      throw new Error(data.error);
    }

    // Eén atomische POST met alle doelgroepen die een mail kregen; reset vervangt de oude entry.
    const verzonden = ['contact', 'klant', 'installateur'].filter(d => data.emailSent?.[d] === true);
    const hertekenStatus = () => hertekenVoorstelStatus(date);
    if (verzonden.length) {
      // B1: het register gaat niet meer verloren bij gelijktijdig werken (zie voorstel-register.js); bij mislukken een waarschuwing.
      schrijfVerzondenRegister({ ticketId, doelgroepen: verzonden, tijdstip: new Date().toISOString(), tijdslot: apptWindowSend, date })
        .then(ok => { if (!ok) toast(TEKST_REGISTER_MISLUKT, 8000); })
        .catch(err => console.warn('Voorstel-status opslaan mislukt:', err));
    } else {
      // Geen enkele mail verstuurd: een oude registerentry (verzonden-vinkje, tijdslot, bevestigd) wissen.
      fetch('/api/voorstel-status?ticketId=' + encodeURIComponent(ticketId), { method: 'DELETE' })
        .then(r => r.json())
        .then(d => {
          if (d.error) { console.warn('Voorstel-status wissen mislukt:', d.error); return; }
          if (typeof d.versie === 'number') _voorstelStatusVersie = d.versie;
          delete toestand.get('voorstelStatus')[ticketId];
          hertekenStatus();
        })
        .catch(err => console.warn('Voorstel-status wissen mislukt:', err));
    }
    afh.actiefTicket().status           = 'Wachten op bevestiging planning';
    afh.actiefTicket().interventieDatum = data.interventieDatum;

    toestand.set('allTickets', toestand.get('allTickets').filter(t => t.id !== ticketId));
    if (!toestand.get('allPending').find(t => t.id === ticketId)) toestand.get('allPending').push({ ...afh.actiefTicket() });
    toestand.raak('allPending'); // in-place push

    // Gelezen na het laatste await (r.json()) en vóór elk gebruik: er staat geen await tussen lezen en gebruik van `planning`.
    const planning = toestand.get('planning');
    // Fix (bugronde 2026-09-22, item E): een datumwijziging via het voorstel-venster mag het
    // ticket niet op zowel de oude als de nieuwe datum laten staan -- eerst overal weghalen.
    Object.keys(planning).forEach(d => {
      if (d === date) return;
      planning[d] = planning[d].filter(p => p.ticket.id !== ticketId);
      if (!planning[d].length) delete planning[d];
    });

    if (!planning[date]) planning[date] = [];
    if (!planning[date].find(p => p.ticket.id === ticketId)) {
      planning[date].push({ ticket: afh.actiefTicket(), address: afh.actiefTicket().address, uur: extractLocalHour(data.interventieDatum) });
    }
    toestand.raak('planning'); // Zoho-gebonden succespad (R7): in-place filter/delete/push

    document.getElementById('proposal-overlay').classList.remove('open');
    btn.disabled = false; btn.textContent = '✉️ Verstuur voorstel';

    // allTickets is toegewezen: koppelRenders hertekent wachtrij, kalender en route (na dit synchrone blok).
    const gelukt = (data.ontvangers || []).filter(d => data.emailSent?.[d]);
    const msg = gelukt.length
      ? `✓ Voorstel verstuurd naar ${joinNL(gelukt.map(d => DOELGROEP_LABEL[d] || d))}`
      : (data.ontvangers || []).length
        ? '✓ Ticket bijgewerkt — e-mail kon niet verstuurd worden via Zoho'
        : '✓ Status bijgewerkt (geen e-mailadres)';
    toast(msg, 3500);
  } catch (err) {
    if (verwachtAdressen.length && leesFout(err).onzeker) {
      // Q1: de mail kan al weg zijn. De knop blijft op slot tot de controle klaar is: er start nooit vanzelf een tweede verzending.
      toast('✕ ' + foutTekst(err), 5000);
      return naOnzekerVoorstel(ticketId, verzendStart, verzendStartWand, verwachtAdressen, btn, registerInvoer);
    }
    btn.disabled    = false;
    btn.textContent = '✉️ Verstuur voorstel';
    toast('✕ ' + foutTekst(err), 5000);
  }
}

// B2: de mail is vertrokken, maar Zoho kon het ticket daarna niet bijwerken. Het venster sluit, het register wordt eerst geschreven (voor precies
// de doelgroepen die de mail kregen) en pas daarna leest de app de tickets opnieuw (de echte stand). Het ticket wordt NIET lokaal verplaatst.
// Enkel een duidelijke waarschuwing: de planner zet status en datum in Zoho zelf recht (er is bewust geen "ticket bijwerken"-knop).
async function naMailZonderTicketUpdate({ ticketId, date, vertrokken, fout, registerInvoer, btn }) {
  document.getElementById('proposal-overlay').classList.remove('open');
  btn.disabled = false;
  btn.textContent = '✉️ Verstuur voorstel';
  const ok = await schrijfVerzondenRegister({ ticketId, doelgroepen: vertrokken, tijdstip: new Date().toISOString(), tijdslot: registerInvoer.tijdslot, date });
  afh.planResync();
  toast(`⚠ Voorstel is verstuurd naar ${joinNL(vertrokken.map(d => DOELGROEP_LABEL[d] || d))}, maar Zoho kon het ticket niet bijwerken (${fout}). Stuur het voorstel NIET opnieuw: zet de status en de datum in Zoho zelf recht.`
    + (ok ? '' : ' Ook de status in de app kon niet bewaard worden: herlaad de pagina.'), 8000);
}

// Q1 (etappe 7): na een onzeker resultaat nagaan of de mail al verzonden is (enkel lezen) en dat melden.
// B4: bij een teruggevonden mail wordt het voorstel ook "verzonden" aangevinkt (register), voor wie de mail kreeg.
// verzonden: niets opnieuw te versturen; het venster sluit en de tickets worden opnieuw gelezen. Anders gaat de knop weer open.
async function naOnzekerVoorstel(ticketId, start, startWand, verwacht, btn, registerInvoer) {
  toast(TEKST_CONTROLEREN, 30000);
  const r = await controleerMail({ ticketId, start, startWand, verwacht });
  btn.disabled = false;
  btn.textContent = '✉️ Verstuur voorstel';
  const gevonden = r.uitkomst === 'verzonden' ? r.verzonden : (r.gevonden || []);
  let afsluiting = '';
  if (gevonden.length > 0) {
    // Altijd het register schrijven voor de doelgroepen die de mail vonden; lukt dat niet (of is er geen doelgroep bij een adres), dan 'mislukt'.
    const doelgroepen = doelgroepenVoorAdressen(registerInvoer.ticketMails, gevonden.map(v => v.aan));
    const tijdstip = gevonden.map(v => v.tijdstip).sort()[0];
    const ok = doelgroepen.length > 0 && await schrijfVerzondenRegister({ ticketId, doelgroepen, tijdstip, tijdslot: registerInvoer.tijdslot, date: registerInvoer.date });
    afsluiting = mailControleAfsluiting('voorstel', !ok ? 'mislukt' : (r.uitkomst === 'verzonden' ? 'alles' : 'deel'));
  }
  if (r.uitkomst === 'verzonden') {
    if (String(afh.actiefTicket()?.id) === String(ticketId)) document.getElementById('proposal-overlay').classList.remove('open');
    afh.planResync();
    toast('✓ ' + mailControleTekst(r) + afsluiting, 8000);
    return;
  }
  toast('⚠ ' + mailControleTekst(r) + afsluiting, 8000);
}
