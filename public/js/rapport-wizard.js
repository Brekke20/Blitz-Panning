// public/js/rapport-wizard.js
// De rapport-wizard (service rapport voor interventies + installaties): stappen-state (`R`),
// alle wizRender*/wizSave*-stapfuncties, PDF-opbouw (buildRapportHtml) en verzending
// (printRapport, via de outbox-module). Zie CLAUDE.md "Rapport wizard — R object key fields".
import { TEST_MODE } from './kern/omgeving.js';
import { arrivalData, getPlanningTicket, sluitDetailStil } from './schermen/ticketdetail.js';
import { geplandTijdslotVoor, rapportTicketVelden } from './schermen/ticketdetail-logica.js';
import { closeLocalDet } from './schermen/afspraken.js';
import { loadFotos, renderFotoGridInto, handleFotoFiles } from './schermen/fotos.js';
import { syncOplossingNaarZoho } from './schermen/rapport-verzenden.js';
import { escHtml, toast } from './kern/ui.js';
import { bijnaOpTekst, naRapportTekst } from './kern/voorraad-drempel.js';
import { berekenLoonkost } from './kern/loonkost.js';
import { RAPPORT_CSS } from './rapport-stijl.js';
import { TEST_UPLOAD } from './test-upload.js';
import { registreerAchtergrondVerzending } from './outbox-sync.js';
import { berekenAanrijtijd } from './rapport-aanrijtijd.js';
import { OORZAAK_GROEPEN, schoneLijst, oudeWaarden, wisselOorzaak, verwijderOud, groepSamenvatting, standaardOpenGroep, valideerOorzaak } from './rapport-oorzaak.js';

export let _wizTicket = null;
export let _wizDate   = null;
export let _wizStep   = 0;
export let _sigTech   = null;
export let _sigKlant  = null;
export let _fotoState = { ticketId: null, versie: 0, fotos: [] };
export function zetFotoState(v) { _fotoState = v; }

// Rapport data object — gevuld doorheen wizard
export const R = {
  datum: '', technieker: '', adres: '', start: '', stop: '', werktijd: '',
  facturatie: 'klant', facturatieVrij: '',
  servicetype: '2e-lijn',
  aanrijtijdMin: 0,
  aanrijtijdBron: '', // '' | 'tomtom' | 'onbekend' | 'handmatig' (B7: nooit stil 0)
  interventieType: 'Interventie',
  installateur: '', serienummer: '', aantalLaadpalen: 1, type: '', uitvoering: '', kabel: '', kabellengte: '',
  probleem: '', acties: '',
  oorzaakStoring: [],
  fotos: [],
  hersteld: 'nee', nieuwInter: 'nee',
  varia: '',
  onderdelen: [],
};

export const WIZ_STEPS = [
  { id: 'algemeen',     label: 'Algemeen',      render: wizRenderAlgemeen,     save: wizSaveAlgemeen     },
  { id: 'facturatie',   label: 'Facturatie',     render: wizRenderFacturatie,   save: wizSaveFacturatie   },
  { id: 'product',      label: 'Product',        render: wizRenderProduct,      save: wizSaveProduct      },
  { id: 'omschrijving', label: 'Omschrijving',   render: wizRenderOmschrijving, save: wizSaveOmschrijving },
  { id: 'fotos',        label: "Foto's",         render: wizRenderFotos,        save: wizSaveFotos        },
  { id: 'status',       label: 'Status',         render: wizRenderStatus,       save: wizSaveStatus       },
  { id: 'sig-tech',     label: 'Handtekening 1', render: wizRenderSigTech,      save: wizSaveSigTech      },
  { id: 'sig-klant',    label: 'Handtekening 2', render: wizRenderSigKlant,     save: wizSaveSigKlant     },
  { id: 'samenvatting', label: 'Overzicht',      render: wizRenderSamenvatting },
];

// ── Concept per ticket (localStorage) ──
// Bewaart de ingevulde velden zodat een rapport niet verloren gaat bij herladen of sluiten.
// Foto's en handtekeningen (zwaar, en de handtekening is bewijs) worden bewust NIET bewaard.
const CONCEPT_MAX_DAGEN = 7;
// Ook uit het concept: velden die bij het openen vers uit het ticket/de planning komen (dashboard, Taak 16); een concept mag ze nooit overschrijven.
const CONCEPT_UIT = ['fotos', 'handtekeningTech', 'handtekeningKlant', 'geplandTijdslot', 'partner', 'regio', 'installateurAlLangsGeweest'];
let _wizTicketId = null;
let _wizVanOverzicht = false;
let _conceptTimer = null;
let _conceptGewijzigd = false; // is er in deze sessie echt iets aangepast? (autosave schrijft anders niets)
let _conceptBasis = null;      // R bij het openen: een ongewijzigd formulier overschrijft nooit een bewaard concept

export function conceptSleutel(ticketId, datum) {
  return `${TEST_MODE ? 'blitz_test_rapportconcept' : 'blitz_rapportconcept'}:${ticketId}:${datum}`;
}
export function wisConcept(ticketId, datum) {
  clearTimeout(_conceptTimer);
  try { localStorage.removeItem(conceptSleutel(ticketId, datum)); } catch { /* privémodus */ }
}
export function leesConcept(ticketId, datum) {
  try {
    const sleutel = conceptSleutel(ticketId, datum);
    const raw = localStorage.getItem(sleutel);
    if (!raw) return null;
    let c = null;
    try { c = JSON.parse(raw); } catch { /* ongeldig */ }
    const t = c && Date.parse(c.opgeslagen);
    const oud = !t || (Date.now() - t) > CONCEPT_MAX_DAGEN * 86400000;
    if (!c || c.v !== 1 || !c.R || typeof c.R !== 'object' || oud) {
      localStorage.removeItem(sleutel);
      return null;
    }
    return c;
  } catch { return null; }
}
export function bewaarConcept() {
  if (!_wizTicketId || _rapportUploaded) return;
  try {
    const kopie = {};
    for (const k of Object.keys(R)) if (!CONCEPT_UIT.includes(k)) kopie[k] = R[k];
    if (_conceptBasis !== null && JSON.stringify(kopie) + '|' + WIZ_STEPS[_wizStep].id === _conceptBasis) return;
    localStorage.setItem(conceptSleutel(_wizTicketId, _wizDate), JSON.stringify({
      v: 1, opgeslagen: new Date().toISOString(), stap: WIZ_STEPS[_wizStep].id, R: kopie,
    }));
  } catch { /* privémodus of vol: concept is een extraatje */ }
}
function wizWizardOpen() {
  return !!document.getElementById('rapport-wizard')?.classList.contains('open');
}
// Leest de velden van de zichtbare stap (de wizSave*-functies schrijven enkel naar R; het
// resultaat — de validatie — negeren we hier) en bewaart.
function wizBewaarHuidig() {
  if (!wizWizardOpen() || !_wizTicketId || !_conceptGewijzigd) return;
  try { WIZ_STEPS[_wizStep].save?.(); } catch { /* DOM niet klaar */ }
  bewaarConcept();
}
function wizConceptDebounce() {
  if (!wizWizardOpen()) return;
  _conceptGewijzigd = true;
  clearTimeout(_conceptTimer);
  _conceptTimer = setTimeout(wizBewaarHuidig, 1000);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') wizBewaarHuidig(); });
window.addEventListener('pagehide', wizBewaarHuidig);
document.getElementById('wiz-body')?.addEventListener('input', wizConceptDebounce);
document.getElementById('wiz-body')?.addEventListener('change', wizConceptDebounce);
// Klik-only wijzigingen (onderdeel toevoegen/verwijderen, chips, knoppen): de bubbel van elke klik markeert het concept als gewijzigd
// (een ongewijzigd formulier wordt sowieso niet geschreven: zie _conceptBasis in bewaarConcept).
document.getElementById('wiz-body')?.addEventListener('click', e => { if (e.target.closest('button, label, input, [onclick]')) wizConceptDebounce(); });

let _openBezig = false;
// Dubbele tik terwijl het openen nog loopt (aanrijtijd-fetch, hervat-dialoog): tweede oproep negeren.
export async function openRapport(ticketId, date) {
  if (_openBezig) return;
  _openBezig = true;
  try { await openRapportIntern(ticketId, date); } finally { _openBezig = false; }
}
async function openRapportIntern(ticketId, date) {
  const ticket = getPlanningTicket(ticketId);
  if (!ticket) return toast('Ticket niet gevonden');
  sluitDetailStil();
  closeLocalDet();
  _wizTicket = ticket;
  _wizDate   = date;
  _wizTicketId = ticketId;
  _wizVanOverzicht = false;

  const now = new Date();
  const p2  = n => String(n).padStart(2,'0');
  const arrKey = `${date}__${ticketId}`;

  R.datum        = date;
  R.adres        = ticket.address || '';
  R.serienummer  = ticket.serienummer || '';
  R.installateur = ticket.partner || ticket.account || '';
  R.start        = arrivalData[arrKey] || '';
  R.stop         = `${p2(now.getHours())}:${p2(now.getMinutes())}`;
  R.probleem     = ticket.subject || '';
  R.acties       = '';
  R.oorzaakStoring = [];
  R.varia        = '';
  R.onderdelen   = [];
  const fotoData  = await loadFotos(ticketId);
  _fotoState      = { ticketId, versie: fotoData.versie, fotos: fotoData.fotos };
  R.fotos         = _fotoState.fotos;
  // Technieker: de persoon op dit toestel, anders de toegewezen technieker van het ticket.
  // Een teruggezet concept (Taak 5) zet R.technieker daarna opnieuw en wint dus.
  // Altijd vers berekend: R blijft tussen tickets bestaan, een oude waarde mag niet blijven hangen.
  const actief = kern.toestand.get('activeAssigneeFilter');
  R.technieker = (actief && actief !== 'all') ? actief : (ticket.assignee || '');
  R.facturatie     = 'klant';
  R.facturatieVrij = '';
  R.servicetype    = '2e-lijn';
  R._servicetypeAutoApplied = false;
  // Aanrijtijd wordt altijd berekend vanaf de ingestelde startlocatie naar het
  // interventie-adres — nooit hergebruikt uit een al-berekende route, nooit vanaf
  // de vorige stop van de dag. Geldt voor elk ticket (Zoho én lokale afspraken).
  // De routeplanning zelf (calculateRoute/autoPlan/optimizeRoute) gebruikt deze
  // berekening niet en blijft ongewijzigd.
  // B7/C4: lukt de berekening niet (geen adres, geen startlocatie, geocoderen of route mislukt, netwerk), dan blijft de
  // bron 'onbekend' en moet de technieker de aanrijtijd in de stap Facturatie zelf invullen (0 mag): nooit stil 0.
  R.aanrijtijdMin = 0;
  R.aanrijtijdBron = 'onbekend';
  if (ticket.hasAddress && kern.toestand.get('settings').startlocatie) {
    toast('📡 Aanrijtijd wordt berekend…', 5000);
    const aanrijtijd = await berekenAanrijtijd({ adres: ticket.address, startlocatie: kern.toestand.get('settings').startlocatie });
    if (aanrijtijd.minuten !== null) { R.aanrijtijdMin = aanrijtijd.minuten; R.aanrijtijdBron = 'tomtom'; }
  }
  R.type = ''; R.uitvoering = ''; R.kabel = ''; R.kabellengte = ''; R.aantalLaadpalen = 1;
  R.hersteld = 'nee'; R.nieuwInter = 'nee';
  // Automatisch bepaald uit de bron: een Zoho-ticket is altijd een interventie, een lokale
  // afspraak van het type "Installatie" is een installatie. Radio in stap Algemeen kan dit
  // nog steeds manueel overschrijven.
  R.interventieType = (ticket.isLocal && ticket.type === 'Installatie') ? 'Installatie' : 'Interventie';
  R.handtekeningTech = null; R.handtekeningKlant = null; // zie Task 23
  _sigTech = _sigKlant = null;
  _rapportUploaded = false; // reset guard bij nieuwe wizard-sessie

  _wizStep = 0;

  // Dashboard-velden (Taak 16): het geplande tijdslot en de ticketvelden partner/regio/installateurAlLangsGeweest.
  // Altijd vers (R blijft tussen tickets bestaan) en vóór het concept; CONCEPT_UIT houdt ze buiten elk concept.
  const planUur = (kern.toestand.get('planning')[date] || []).find(s => s.ticket?.id === ticketId)?.uur;
  R.geplandTijdslot = geplandTijdslotVoor({
    voorstel: kern.toestand.get('voorstelStatus')[ticketId], datum: date, planUur, isLocal: !!ticket.isLocal, settings: kern.toestand.get('settings'),
  });
  Object.assign(R, rapportTicketVelden(ticket));

  // Concept hervatten? (na het resetten van R; foto's/handtekeningen blijven vers)
  const concept = leesConcept(ticketId, date);
  if (concept) {
    const d = new Date(concept.opgeslagen);
    const dd = `${p2(d.getDate())}/${p2(d.getMonth() + 1)}`;
    const uu = `${p2(d.getHours())}:${p2(d.getMinutes())}`;
    const hervat = await window.appConfirm({
      titel: 'Concept hervatten?',
      tekst: [`Je begon eerder aan een rapport voor dit ticket (bewaard op ${dd} om ${uu}).`, 'Wil je verdergaan waar je gebleven was?'],
      bevestigLabel: 'Hervatten',
      annuleerLabel: 'Opnieuw beginnen',
    });
    if (hervat) {
      for (const k of Object.keys(concept.R)) {
        if (CONCEPT_UIT.includes(k)) continue;
        if ((k === 'onderdelen' || k === 'oorzaakStoring') && !Array.isArray(concept.R[k])) continue;
        // Een concept van vóór de bronmarkering kan een stille 0 bevatten: dan blijft de verse berekening (of 'onbekend') staan.
        // Een echte (> 0) waarde uit zo'n concept blijft behouden als handmatig ingevuld (eindreview M4).
        if (k === 'aanrijtijdMin' && !('aanrijtijdBron' in concept.R)) {
          if (concept.R[k] > 0) { R.aanrijtijdMin = concept.R[k]; R.aanrijtijdBron = 'handmatig'; }
          continue;
        }
        R[k] = concept.R[k];
      }
      const i = WIZ_STEPS.findIndex(st => st.id === concept.stap);
      if (i >= 0) _wizStep = i;
      // Eindreview I2: een hervat concept voorbij de stap Facturatie met een onbekende aanrijtijd begint opnieuw bij Facturatie.
      if (aanrijtijdOntbreekt() && _wizStep > WIZ_STEPS.findIndex(st => st.id === 'facturatie')) {
        _wizStep = WIZ_STEPS.findIndex(st => st.id === 'facturatie');
        toast(AANRIJTIJD_VERPLICHT, 4000);
      }
    }
    // false (Opnieuw beginnen, Escape, achtergrond): concept NIET wissen; leeg formulier, het oude
    // concept wordt pas overschreven zodra de gebruiker iets wijzigt, of verloopt na 7 dagen.
  }
  _conceptGewijzigd = false;
  _conceptBasis = (() => { const k = {}; for (const key of Object.keys(R)) if (!CONCEPT_UIT.includes(key)) k[key] = R[key]; return JSON.stringify(k) + '|' + WIZ_STEPS[_wizStep].id; })();

  document.getElementById('rapport-wizard').classList.add('open');
  wizRenderStep();
}

export function closeWizard() {
  // Na een geslaagd rapport is er niets meer te verliezen — geen bevestiging nodig.
  if (_rapportUploaded || confirm('Rapport sluiten? Je concept blijft bewaard.')) {
    if (!_rapportUploaded) wizBewaarHuidig();
    document.getElementById('rapport-wizard').classList.remove('open');
  }
}

// ── Nav ──
export function wizRenderStep() {
  const step  = WIZ_STEPS[_wizStep];
  const visibleSteps = R.interventieType === 'Installatie'
    ? WIZ_STEPS.filter(s => s.id !== 'facturatie')
    : WIZ_STEPS;
  const total = visibleSteps.length;
  const visibleIndex = visibleSteps.indexOf(step);

  // Dots
  const dotsEl = document.getElementById('wiz-dots');
  dotsEl.innerHTML = visibleSteps.map((s, i) =>
    `<div class="wiz-step-dot ${i === visibleIndex ? 'active' : i < visibleIndex ? 'done' : ''}"></div>`
  ).join('');

  document.getElementById('wiz-step-label').textContent = `${visibleIndex+1} / ${total} — ${step.label}`;
  document.getElementById('wiz-ftr-info').textContent   = step.label;

  const btnBack = document.getElementById('wiz-btn-back');
  const btnNext = document.getElementById('wiz-btn-next');
  btnBack.style.display = _wizStep > 0 ? '' : 'none';
  btnNext.textContent   = visibleIndex === total - 1 ? '✓ Rapport versturen'
    : (_wizVanOverzicht && step.id !== 'sig-tech' ? 'Terug naar overzicht' : 'Volgende →');

  const body = document.getElementById('wiz-body');
  body.scrollTop = 0;
  body.innerHTML = '';
  step.render(body);
}

export function wizNext() {
  const step   = WIZ_STEPS[_wizStep];
  const result = step.save ? step.save() : undefined;
  if (result === false || typeof result === 'string') {
    toast(typeof result === 'string' ? result : '⚠ Vul eerst de verplichte velden in (gemarkeerd).', 3500);
    return;
  }
  let nextStep = _wizStep + 1;
  if (R.interventieType === 'Installatie' && WIZ_STEPS[nextStep]?.id === 'facturatie') nextStep++;
  if (_wizVanOverzicht && step.id === 'sig-tech') {
    // Handtekeningen wijzigen: eerst technieker, dan klant, dan terug naar het overzicht
    _wizStep = WIZ_STEPS.findIndex(st => st.id === 'sig-klant');
    _conceptGewijzigd = true;
    bewaarConcept();
    wizRenderStep();
  } else if (_wizVanOverzicht) {
    // "Wijzig" vanuit het overzicht: na de aanpassing terug naar het overzicht
    if (aanrijtijdOntbreekt()) return naarFacturatieVoorAanrijtijd(); // bv. Installatie gewijzigd naar Interventie
    _wizVanOverzicht = false;
    _wizStep = WIZ_STEPS.findIndex(st => st.id === 'samenvatting');
    bewaarConcept();
    wizRenderStep();
  } else if (nextStep < WIZ_STEPS.length) {
    _wizStep = nextStep;
    bewaarConcept();
    wizRenderStep();
  } else {
    if (aanrijtijdOntbreekt()) return naarFacturatieVoorAanrijtijd();
    // Bevestiging vóór versturen; printRapport enkel via onBevestig (binnen de klik-gesture, voor window.open)
    const isLokaal = !!_wizTicket?.isLocal;
    const nr = _wizTicket?.number || _wizTicket?.id || '';
    let tekst;
    if (TEST_MODE && !TEST_UPLOAD) {
      tekst = ['🧪 Testmodus: er wordt niets verstuurd of opgeslagen.', 'Enkel het afdrukvoorbeeld opent in een nieuw venster.'];
    } else {
      tekst = ['Het rapport wordt gearchiveerd.'];
      if (!isLokaal) {
        tekst.push(`De PDF wordt aan ticket #${nr} toegevoegd.`);
        tekst.push('De uitgevoerde acties komen als oplossing op het Zoho-ticket.');
      }
      // Zelfde filter als registreerVerbruik: enkel echte voorraadonderdelen
      const heeftVoorraadOnderdeel = (R.onderdelen || []).some(p => p.naam && !String(p.id || '').startsWith('vrij-') && (parseInt(p.aantal) || 0) > 0);
      if (heeftVoorraadOnderdeel) tekst.push('Gebruikte onderdelen worden van je wagenvoorraad afgeboekt.');
      tekst.push('Het afdrukvoorbeeld opent in een nieuw venster.');
    }
    if (typeof window.appConfirm !== 'function') {
      // Terugval als app-dialog.js niet geladen is: native confirm, zelfde titel + tekst
      if (confirm('Rapport versturen?\n\n' + tekst.join('\n'))) printRapport();
      return;
    }
    window.appConfirm({
      titel: 'Rapport versturen?',
      tekst,
      bevestigLabel: 'Versturen',
      onBevestig: () => printRapport()
    });
  }
}

export function wizBack() {
  if (WIZ_STEPS[_wizStep].save) WIZ_STEPS[_wizStep].save();
  let prevStep = _wizStep - 1;
  if (R.interventieType === 'Installatie' && WIZ_STEPS[prevStep]?.id === 'facturatie') prevStep--;
  _wizVanOverzicht = false;
  if (prevStep >= 0) {
    _wizStep = prevStep;
    bewaarConcept();
    wizRenderStep();
  }
}

// Vanuit het overzicht ("Wijzig") naar een stap; wizNext brengt je daarna terug.
export function wizGaNaar(stapId) {
  const i = WIZ_STEPS.findIndex(st => st.id === stapId);
  if (i < 0) return;
  _wizVanOverzicht = true;
  _wizStep = i;
  bewaarConcept();
  wizRenderStep();
}

// ── Overzichtsstap (laatste; blokkeert niets) ──
export function wizRenderSamenvatting(el) {
  const rij = (l, w) => `<div class="wiz-sam-rij"><span class="wiz-sam-lbl">${escHtml(l)}</span><span class="wiz-sam-val">${w ? escHtml(String(w)) : '—'}</span></div>`;
  const kaart = (titel, id, rijen) => `
    <section class="wiz-sam-kaart">
      <div class="wiz-sam-kop"><h3 class="wiz-sam-titel">${escHtml(titel)}</h3>
        <button type="button" class="btn btn--secondary btn--sm wiz-sam-wijzig" onclick="wizGaNaar('${id}')">Wijzig</button></div>
      ${rijen}
    </section>`;
  const inst = R.interventieType === 'Installatie';
  const sigRij = (l, ok) => `<div class="wiz-sam-rij"><span class="wiz-sam-lbl">${escHtml(l)}</span><span class="wiz-sam-val ${ok ? 'wiz-sam-ok' : 'wiz-sam-waarschuw'}">${ok ? '✓ gezet' : '⚠ Handtekening ' + escHtml(l.toLowerCase()) + ' ontbreekt'}</span></div>`;
  const fact = { klant: 'Klant', partner: 'Partner / installateur', vrij: R.facturatieVrij || 'Vrij invulveld' }[R.facturatie] || R.facturatie;
  const stype = { '2e-lijn': '2e lijns interventie', '1e-lijn': '1e lijns interventie', garantie: 'Garantie' }[R.servicetype] || R.servicetype;
  const onderdelen = (R.onderdelen || []).filter(p => p.naam);
  const onderdelenHtml = onderdelen.length
    ? onderdelen.map(p => `<div class="wiz-sam-rij"><span class="wiz-sam-val">${escHtml(p.naam)} × ${escHtml(String(parseInt(p.aantal) || 1))}</span></div>`).join('')
    : '<div class="wiz-sam-rij"><span class="wiz-sam-val">Geen onderdelen</span></div>';
  const ja = v => (v === 'ja' ? 'Ja' : 'Nee');
  const nFotos = (R.fotos || []).length;
  el.innerHTML = `
    <div class="wiz-step-title" role="heading" aria-level="3">Overzicht</div>
    <p class="wiz-sam-intro">Controleer je rapport. Met "Wijzig" pas je een onderdeel aan en kom je hier terug.</p>
    ${kaart('Algemeen', 'algemeen',
      rij('Datum', R.datum ? new Date(R.datum + 'T12:00:00').toLocaleDateString('nl-BE', { day:'2-digit', month:'2-digit', year:'numeric' }) : '') + rij('Technieker', R.technieker) + rij('Adres', R.adres) +
      rij('Start – stop', `${R.start || '?'} – ${R.stop || '?'}`) + rij('Werktijd', R.werktijd) + rij('Type bezoek', R.interventieType))}
    ${inst ? '' : kaart('Facturatie', 'facturatie', rij('Facturatie aan', fact) + rij('Type interventie', stype) + rij('Aanrijtijd', R.aanrijtijdMin || R.aanrijtijdBron === 'handmatig' || R.aanrijtijdBron === 'tomtom' ? `${R.aanrijtijdMin} min` : ''))}
    ${kaart('Product', 'product',
      rij('Installateur', R.installateur) + rij('Serienummer', R.serienummer) + rij('Aantal laadpalen', R.aantalLaadpalen) +
      rij('Type', R.type) + rij('Uitvoering', R.uitvoering) + rij('Kabel', [R.kabel, R.kabellengte].filter(Boolean).join(' ')))}
    ${kaart('Omschrijving', 'omschrijving',
      rij(inst ? 'Installatie' : 'Probleem', R.probleem) + rij('Acties', R.acties) + (inst ? '' : rij('Oorzaak', (R.oorzaakStoring || []).join(', '))))}
    ${kaart("Foto's", 'fotos', rij("Foto's", `${nFotos} foto's`))}
    ${kaart('Onderdelen', 'status', onderdelenHtml)}
    ${kaart('Status', 'status', rij('Hersteld', ja(R.hersteld)) + rij('Nieuwe interventie', ja(R.nieuwInter)))}
    ${kaart('Handtekeningen', 'sig-tech', sigRij('Technieker', !!R.handtekeningTech) + sigRij('Klant', !!R.handtekeningKlant))}`;
}

// ── Helpers ──
export function wizV(id) { const el = document.getElementById(id); return el ? el.value : ''; }
export function wizChecked(name) { const el = document.querySelector(`input[name="${name}"]:checked`); return el ? el.value : ''; }
export function calcWerktijd(start, stop) {
  if (!start || !stop) return '';
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = stop.split(':').map(Number);
  let totalMin = (eh * 60 + em) - (sh * 60 + sm);
  if (totalMin < 0) totalMin += 24 * 60; // interventie loopt over middernacht heen
  if (totalMin <= 0) return '';
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} min`;
  return m > 0 ? `${h}u${String(m).padStart(2,'0')}` : `${h}u`;
}
export function calcWerktijdMin(start, stop) {
  if (!start || !stop) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = stop.split(':').map(Number);
  let diff = (eh * 60 + em) - (sh * 60 + sm);
  if (diff < 0) diff += 24 * 60; // interventie loopt over middernacht heen
  return diff > 0 ? diff : 0;
}
export function updateWerktijd() {
  const start = wizV('f-start');
  const stop  = wizV('f-stop');
  const wt    = calcWerktijd(start, stop);
  const chip  = document.getElementById('werktijd-chip');
  const val   = document.getElementById('werktijd-val');
  if (chip) { chip.style.display = wt ? 'flex' : 'none'; }
  if (val)  { val.textContent = wt; }
}

// ── Stap 1: Algemeen ──
export function wizRenderAlgemeen(el) {
  const zohoRef = _wizTicket.number ? `#${_wizTicket.number}` : (_wizTicket.isLocal ? '' : (_wizTicket.id || ''));
  el.innerHTML = `
    <div class="wiz-step-title" role="heading" aria-level="3">Algemeen</div>
    <div class="wiz-info-chip">
      <strong>${escHtml(_wizTicket.subject||'')}</strong><br>
      ${[_wizTicket.account, _wizTicket.address].filter(Boolean).map(escHtml).join(' · ')}
    </div>
    <div class="wiz-field-row">
      <div class="wiz-field">
        <label class="wiz-field-label" for="f-datum">Datum</label>
        <input class="wiz-input" id="f-datum" type="date" value="${escHtml(R.datum)}" />
      </div>
      <div class="wiz-field">
        <label class="wiz-field-label" for="f-zoho">#Zoho</label>
        <input class="wiz-input" id="f-zoho" type="text" value="${escHtml(zohoRef)}" readonly />
      </div>
    </div>
    <div class="wiz-field">
      <label class="wiz-field-label" for="f-technieker">Technieker Blitz</label>
      <input class="wiz-input" id="f-technieker" type="text" placeholder="Naam technieker" value="${escHtml(R.technieker)}" />
    </div>
    <div class="wiz-field">
      <label class="wiz-field-label" for="f-adres">Interventie adres</label>
      <input class="wiz-input" id="f-adres" type="text" value="${escHtml(R.adres)}" />
    </div>
    <div class="wiz-field">
      <label class="wiz-field-label">Type bezoek</label>
      <div class="wiz-radio-cards">
        <label class="wiz-radio-card">
          <input type="radio" name="f-interventieType" value="Interventie" ${R.interventieType !== 'Installatie' ? 'checked' : ''}>
          <div><div class="wiz-radio-card-label">Interventie</div></div>
        </label>
        <label class="wiz-radio-card">
          <input type="radio" name="f-interventieType" value="Installatie" ${R.interventieType === 'Installatie' ? 'checked' : ''}>
          <div><div class="wiz-radio-card-label">Installatie</div></div>
        </label>
      </div>
    </div>
    <div class="wiz-field-row">
      <div class="wiz-field">
        <label class="wiz-field-label" for="f-start">Starttijd (aankomst)</label>
        <input class="wiz-input" id="f-start" type="time" value="${escHtml(R.start)}" oninput="updateWerktijd()" />
      </div>
      <div class="wiz-field">
        <label class="wiz-field-label" for="f-stop">Stoptijd (einde)</label>
        <input class="wiz-input" id="f-stop" type="time" value="${escHtml(R.stop)}" oninput="updateWerktijd()" />
      </div>
    </div>
    <div id="werktijd-chip" style="display:${R.start&&R.stop?'flex':'none'};align-items:center;gap:8px;background:var(--accent-dim);border:1px solid rgba(0,223,163,0.2);border-radius:8px;padding:10px 14px;font-size:0.85rem;margin-bottom:4px">
      <span style="color:var(--muted)">⏱ Totale werktijd:</span>
      <strong id="werktijd-val" style="color:var(--accent-ink)">${calcWerktijd(R.start,R.stop)}</strong>
    </div>`;
}
export function wizSaveAlgemeen() {
  R.datum           = wizV('f-datum');
  R.technieker      = wizV('f-technieker');
  R.adres           = wizV('f-adres');
  R.start           = wizV('f-start');
  R.stop            = wizV('f-stop');
  R.werktijd        = calcWerktijd(R.start, R.stop);
  R.interventieType = document.querySelector('input[name="f-interventieType"]:checked')?.value || 'Interventie';
}

export function fmtDuur(min) {
  const h = Math.floor(min / 60), mn = min % 60;
  return h > 0 ? (mn > 0 ? `${h}u${String(mn).padStart(2,'0')}` : `${h}u`) : `${mn} min`;
}

// ── Stap 2: Facturatie & Servicetype ──
export function wizLoonkostPreview() {
  const st       = wizChecked('f-servicetype') || R.servicetype;
  const wMin     = calcWerktijdMin(R.start, R.stop);
  const aMin     = parseInt(document.getElementById('f-aanrijtijd')?.value) || 0;
  const { bruto, totMin, extraUren } = berekenLoonkost(st, wMin, aMin);

  const fmt = m => {
    const h = Math.floor(m / 60), mn = m % 60;
    return h > 0 ? (mn > 0 ? `${h}u${String(mn).padStart(2,'0')}` : `${h}u`) : `${mn} min`;
  };

  let regels = [];
  if (st === '2e-lijn') {
    if (aMin) regels.push(`Aanrijtijd: ${fmt(aMin)}`);
    regels.push(`Werktijd: ${fmt(wMin)}`);
    regels.push(`Totaal: ${fmt(totMin)} → forfait €175`);
    if (extraUren > 0) regels.push(`+ ${extraUren}u extra × €75 = €${extraUren * 75}`);
  } else if (st === '1e-lijn') {
    if (aMin) regels.push(`Aanrijtijd: ${fmt(aMin)}`);
    regels.push(`Werktijd: ${fmt(wMin)}`);
    const gu = Math.ceil(totMin / 60);
    regels.push(`Totaal: ${fmt(totMin)} → ${gu} gestart${gu !== 1 ? 'e' : ''} uur × €115`);
  } else {
    if (aMin) regels.push(`Aanrijtijd: ${fmt(aMin)}`);
    regels.push(`Werktijd: ${fmt(wMin)}`);
    const gu = Math.ceil(totMin / 60);
    regels.push(`Totaal: ${fmt(totMin)} → ${gu} gestart${gu !== 1 ? 'e' : ''} uur × €115 (gedekt door garantie)`);
  }

  const isGarantie = st === 'garantie';
  const netto = isGarantie ? 0 : bruto;

  const el = document.getElementById('wiz-loonkost-preview');
  if (!el) return;
  el.innerHTML = `
    <div style="font-size:0.78rem;color:var(--muted);margin-bottom:4px">${regels.join(' · ')}</div>
    <div style="display:flex;align-items:baseline;gap:6px">
      ${isGarantie && bruto > 0
        ? `<span style="text-decoration:line-through;color:var(--muted);font-size:0.85rem">€ ${bruto.toFixed(2)}</span>
           <span style="font-size:1rem;font-weight:700;color:var(--accent-ink)">€ 0,00</span>
           <span style="font-size:0.72rem;color:var(--muted)">(100% korting — garantie)</span>`
        : `<span style="font-size:1rem;font-weight:700;color:var(--accent-ink)">€ ${netto.toFixed(2)}</span>`
      }
    </div>`;
}

export function wizAutoServicetype() {
  const garantie = String(_wizTicket?.garantieStatus || '').trim().toLowerCase();
  const langsgeweest = String(_wizTicket?.installateurAlLangsGeweest || '').trim().toLowerCase();
  if (garantie === 'binnen garantie') return 'garantie';
  if (langsgeweest === 'ja') return '2e-lijn';
  if (langsgeweest === 'nee') return '1e-lijn';
  return null; // onduidelijk -- geen auto-selectie, huidige/handmatige waarde van R.servicetype blijft staan
}

const AANRIJTIJD_ONBEKEND = '⚠ Aanrijtijd kon niet berekend worden — vul ze hieronder zelf in (minuten, enkel heen). Typ 0 als er geen aanrijtijd is.';
const AANRIJTIJD_VERPLICHT = '⚠ Vul de aanrijtijd in (minuten, enkel heen). Typ 0 als er geen aanrijtijd is.';
// Eindreview I2: een Interventie met een onbekende aanrijtijd mag nooit ingediend worden (ook niet via een omweg: Installatie -> Interventie
// in het Overzicht, of een hervat concept na de stap Facturatie). Dan terug naar de stap Facturatie met de melding.
function aanrijtijdOntbreekt() { return R.interventieType !== 'Installatie' && R.aanrijtijdBron === 'onbekend'; }
function naarFacturatieVoorAanrijtijd() { toast(AANRIJTIJD_VERPLICHT, 4000); wizGaNaar('facturatie'); }
export function wizRenderFacturatie(el) {
  if (!R._servicetypeAutoApplied) {
    const auto = wizAutoServicetype();
    if (auto) R.servicetype = auto;
    R._servicetypeAutoApplied = true;
  }
  const isGarantie = R.servicetype === 'garantie';
  el.innerHTML = `
    <div class="wiz-step-title" role="heading" aria-level="3">Facturatie &amp; Servicetype</div>
    <div class="wiz-field">
      <label class="wiz-field-label">Facturatie aan</label>
      <div class="wiz-radio-cards">
        <label class="wiz-radio-card">
          <input type="radio" name="f-facturatie" value="klant" ${R.facturatie==='klant'?'checked':''} onchange="wizFacturatieChange()">
          <div><div class="wiz-radio-card-label">Klant</div></div>
        </label>
        <label class="wiz-radio-card">
          <input type="radio" name="f-facturatie" value="partner" ${R.facturatie==='partner'?'checked':''} onchange="wizFacturatieChange()">
          <div><div class="wiz-radio-card-label">Partner / installateur</div>${_wizTicket.partner ? `<div class="wiz-radio-card-sub">${escHtml(_wizTicket.partner)}</div>` : ''}</div>
        </label>
        <label class="wiz-radio-card">
          <input type="radio" name="f-facturatie" value="vrij" ${R.facturatie==='vrij'?'checked':''} onchange="wizFacturatieChange()">
          <div><div class="wiz-radio-card-label">Vrij invulveld</div></div>
        </label>
      </div>
      <div id="facturatie-vrij-wrap" style="${R.facturatie==='vrij'?'':'display:none'};margin-top:10px">
        <input class="wiz-input" id="f-facturatie-vrij" type="text" aria-label="Facturatie aan (vrije invoer)" placeholder="Facturatie aan..." value="${escHtml(R.facturatieVrij)}" />
      </div>
    </div>
    <div class="wiz-sep"></div>
    <div class="wiz-field">
      <label class="wiz-field-label">Type interventie</label>
      <div class="wiz-radio-cards">
        <label class="wiz-radio-card">
          <input type="radio" name="f-servicetype" value="2e-lijn" ${R.servicetype==='2e-lijn'?'checked':''} onchange="wizServicetypeChange()">
          <div>
            <div class="wiz-radio-card-label">2e lijns interventie</div>
            <div class="wiz-radio-card-sub">€175 forfait (3u) · €75/gestart uur extra · aanrijtijd inbegrepen</div>
          </div>
        </label>
        <label class="wiz-radio-card">
          <input type="radio" name="f-servicetype" value="1e-lijn" ${R.servicetype==='1e-lijn'?'checked':''} onchange="wizServicetypeChange()">
          <div>
            <div class="wiz-radio-card-label">1e lijns interventie</div>
            <div class="wiz-radio-card-sub">€115/uur · aanrijtijd inbegrepen</div>
          </div>
        </label>
        <label class="wiz-radio-card">
          <input type="radio" name="f-servicetype" value="garantie" ${R.servicetype==='garantie'?'checked':''} onchange="wizServicetypeChange()">
          <div>
            <div class="wiz-radio-card-label">Garantie</div>
            <div class="wiz-radio-card-sub">100% korting op loonkosten</div>
          </div>
        </label>
      </div>
    </div>
    <div id="aanrijtijd-wrap" style="margin-top:6px">
      ${R.aanrijtijdBron === 'onbekend' ? `<div class="wiz-aanrijtijd-waarschuwing" role="alert">${AANRIJTIJD_ONBEKEND}</div>` : ''}
      <div class="wiz-field">
        <label class="wiz-field-label" for="f-aanrijtijd">Aanrijtijd (minuten, enkel heen)
          ${R.aanrijtijdBron === 'tomtom' ? '<span style="font-size:0.72rem;color:var(--accent-ink);margin-left:6px">📡 TomTom</span>' : ''}
        </label>
        <input class="wiz-input" id="f-aanrijtijd" type="number" min="0" step="1"${R.aanrijtijdBron === 'onbekend' ? ' aria-invalid="true"' : ''}
          value="${R.aanrijtijdBron === 'tomtom' || R.aanrijtijdBron === 'handmatig' ? R.aanrijtijdMin : (R.aanrijtijdMin || '')}" placeholder="bijv. 35"
          oninput="wizLoonkostPreview()" style="max-width:120px" />
      </div>
    </div>
    <div class="wiz-sep"></div>
    <div style="background:var(--veld);border:1px solid var(--lijn);border-radius:var(--r-ev);padding:12px 14px" id="wiz-loonkost-preview"></div>`;
  wizLoonkostPreview();
}
export function wizFacturatieChange() {
  const val = wizChecked('f-facturatie');
  document.getElementById('facturatie-vrij-wrap').style.display = val === 'vrij' ? '' : 'none';
}
export function wizServicetypeChange() {
  wizLoonkostPreview();
}
export function wizSaveFacturatie() {
  R.facturatie     = wizChecked('f-facturatie') || 'klant';
  R.facturatieVrij = wizV('f-facturatie-vrij');
  R.servicetype    = wizChecked('f-servicetype') || '2e-lijn';
  const aanrijtijdRuw = String(document.getElementById('f-aanrijtijd')?.value ?? '').trim();
  R.aanrijtijdMin  = parseInt(aanrijtijdRuw) || 0;
  // B7: een lege waarde is nooit toegelaten (0 wel). De bron gaat bij een leeg veld terug naar 'onbekend', zodat ook Vorige, een
  // autosave of een teruggezet concept (die de foutwaarde negeren) later nooit een stille 0 doorlaten: het veld blijft leeg en gemarkeerd.
  if (aanrijtijdRuw === '') {
    R.aanrijtijdBron = 'onbekend';
    return AANRIJTIJD_VERPLICHT;
  }
  if (R.aanrijtijdBron === 'onbekend') R.aanrijtijdBron = 'handmatig';
}

// ── Stap 3: Productinfo ──
export function wizRenderProduct(el) {
  el.innerHTML = `
    <div class="wiz-step-title" role="heading" aria-level="3">Productinformatie</div>
    <div class="wiz-field">
      <label class="wiz-field-label" for="f-installateur">Installateur / partner</label>
      <input class="wiz-input" id="f-installateur" type="text" value="${escHtml(R.installateur)}" placeholder="Installateur" />
    </div>
    <div class="wiz-field-row">
      <div class="wiz-field">
        <label class="wiz-field-label" for="f-serienummer">Serienummer (master laadpaal)</label>
        <input class="wiz-input" id="f-serienummer" type="text" value="${escHtml(R.serienummer)}" placeholder="CHARX-XXXX" />
      </div>
      <div class="wiz-field">
        <label class="wiz-field-label" for="f-aantal-laadpalen">Aantal laadpalen</label>
        <input class="wiz-input" id="f-aantal-laadpalen" type="number" min="1" step="1" value="${R.aantalLaadpalen || 1}" />
      </div>
    </div>
    <div class="wiz-field">
      <label class="wiz-field-label">Type</label>
      <div class="wiz-radio-cards row">
        <label class="wiz-radio-card"><input type="radio" name="f-type" value="Single" ${R.type==='Single'?'checked':''}><div><div class="wiz-radio-card-label">Single</div></div></label>
        <label class="wiz-radio-card"><input type="radio" name="f-type" value="Dual 1" ${R.type==='Dual 1'?'checked':''}><div><div class="wiz-radio-card-label">Dual 1</div><div class="wiz-radio-card-sub">1 voedingskabel</div></div></label>
        <label class="wiz-radio-card"><input type="radio" name="f-type" value="Dual 2" ${R.type==='Dual 2'?'checked':''}><div><div class="wiz-radio-card-label">Dual 2</div><div class="wiz-radio-card-sub">2 voedingskabels</div></div></label>
      </div>
    </div>
    <div class="wiz-field">
      <label class="wiz-field-label">Uitvoering</label>
      <div class="wiz-radio-cards row">
        <label class="wiz-radio-card"><input type="radio" name="f-uitvoering" value="tower" ${R.uitvoering==='tower'?'checked':''}><div><div class="wiz-radio-card-label">Tower</div></div></label>
        <label class="wiz-radio-card"><input type="radio" name="f-uitvoering" value="wall" ${R.uitvoering==='wall'?'checked':''}><div><div class="wiz-radio-card-label">Wall</div></div></label>
      </div>
    </div>
    <div class="wiz-field">
      <label class="wiz-field-label">Kabeltype</label>
      <div class="wiz-radio-cards row">
        <label class="wiz-radio-card"><input type="radio" name="f-kabel" value="socket" ${R.kabel==='socket'?'checked':''} onchange="wizKabelChange()"><div><div class="wiz-radio-card-label">Socket</div></div></label>
        <label class="wiz-radio-card"><input type="radio" name="f-kabel" value="kabel" ${R.kabel==='kabel'?'checked':''} onchange="wizKabelChange()"><div><div class="wiz-radio-card-label">Vaste kabel</div></div></label>
      </div>
      <div id="kabel-lengte-wrap" style="${R.kabel==='kabel'?'':'display:none'};margin-top:10px">
        <label class="wiz-field-label">Kabellengte</label>
        <div class="wiz-radio-cards row">
          <label class="wiz-radio-card"><input type="radio" name="f-kabellengte" value="5m" ${R.kabellengte==='5m'?'checked':''}><div><div class="wiz-radio-card-label">5m</div></div></label>
          <label class="wiz-radio-card"><input type="radio" name="f-kabellengte" value="8m" ${R.kabellengte==='8m'?'checked':''}><div><div class="wiz-radio-card-label">8m</div></div></label>
          <label class="wiz-radio-card"><input type="radio" name="f-kabellengte" value="spiraal" ${R.kabellengte==='spiraal'?'checked':''}><div><div class="wiz-radio-card-label">Spiraal</div></div></label>
        </div>
      </div>
    </div>`;
}
export function wizKabelChange() {
  const val = wizChecked('f-kabel');
  const wrap = document.getElementById('kabel-lengte-wrap');
  if (wrap) wrap.style.display = val === 'kabel' ? '' : 'none';
}
export function wizSaveProduct() {
  R.installateur     = wizV('f-installateur');
  R.serienummer      = wizV('f-serienummer');
  R.aantalLaadpalen  = parseInt(wizV('f-aantal-laadpalen')) || 1;
  R.type             = wizChecked('f-type');
  R.uitvoering       = wizChecked('f-uitvoering');
  R.kabel            = wizChecked('f-kabel');
  R.kabellengte      = wizChecked('f-kabellengte');
}

// ── Stap 4: Omschrijving & acties ──
export function wizRenderOmschrijving(el) {
  const isInstallatie = R.interventieType === 'Installatie';
  _oorzaakOpen = null; // bij elk openen van de stap: de eerste groep met een keuze, anders de eerste
  el.innerHTML = `
    <div class="wiz-step-title" role="heading" aria-level="3">Omschrijving &amp; acties</div>
    <div class="wiz-field">
      <label class="wiz-field-label" for="f-probleem">${isInstallatie ? 'Omschrijving installatie' : 'Omschrijving probleem'}</label>
      <textarea class="wiz-textarea" id="f-probleem" rows="4" placeholder="${isInstallatie ? 'Beschrijf de uitgevoerde installatie...' : 'Beschrijf het probleem...'}">${escHtml(R.probleem)}</textarea>
    </div>
    <div class="wiz-field">
      <label class="wiz-field-label" for="f-acties">Ondernomen acties</label>
      <textarea class="wiz-textarea" id="f-acties" rows="6" placeholder="Beschrijf de uitgevoerde werkzaamheden...">${escHtml(R.acties)}</textarea>
    </div>
    ${isInstallatie ? '' : `
    <div class="wiz-field">
      <div class="wiz-field-label" id="oorzaak-label">Oorzaak storing</div>
      <div id="oorzaak-wrap" class="wiz-oorz" role="group" aria-labelledby="oorzaak-label">${oorzaakHtml()}</div>
    </div>`}`;
}

// Accordion met chips: één groep tegelijk open. R.oorzaakStoring is de toestand; elke klik tekent het blok opnieuw.
let _oorzaakOpen = null;
function oorzaakHtml() {
  const gekozen = schoneLijst(R.oorzaakStoring);
  if (!_oorzaakOpen) _oorzaakOpen = standaardOpenGroep(gekozen);
  const groepen = OORZAAK_GROEPEN.map(g => {
    const open = g.id === _oorzaakOpen;
    const sam = groepSamenvatting(gekozen, g);
    const chips = g.opties.map(o => {
      const aan = gekozen.includes(o);
      return `<button type="button" class="wiz-oorz-chip${aan ? ' on' : ''}" aria-pressed="${aan}" data-oorzaak="${escHtml(o)}" onclick="wizOorzaakToggle(this)"><span class="wiz-oorz-vink" aria-hidden="true">✓</span>${escHtml(o)}</button>`;
    }).join('');
    return `<div class="wiz-oorz-groep${open ? ' open' : ''}">
      <button type="button" class="wiz-oorz-kop" id="oorz-kop-${g.id}" aria-expanded="${open}" aria-controls="oorz-pnl-${g.id}" data-groep="${g.id}" onclick="wizOorzaakGroep(this)">
        <span class="wiz-oorz-naam">${escHtml(g.naam)}</span>
        <span class="wiz-oorz-sam"><span class="wiz-oorz-aantal">${sam.tekst}</span>${sam.labels ? `<span class="wiz-oorz-labels">${escHtml(sam.labels)}</span>` : ''}</span>
        <span class="wiz-oorz-chev" aria-hidden="true">›</span>
      </button>
      <div class="wiz-oorz-paneel" id="oorz-pnl-${g.id}" role="group" aria-labelledby="oorz-kop-${g.id}"${open ? '' : ' hidden'}>${chips}</div>
    </div>`;
  }).join('');
  const oud = oudeWaarden(gekozen).map(o =>
    `<button type="button" class="wiz-oorz-chip on oud" aria-pressed="true" data-oud="${escHtml(o)}" title="Waarde uit een ouder rapport; tik om te verwijderen" onclick="wizOorzaakOud(this)"><span class="wiz-oorz-vink" aria-hidden="true">✓</span>(oud) ${escHtml(o)}</button>`).join('');
  return groepen + (oud ? `<div class="wiz-oorz-oud">${oud}</div>` : '');
}
function oorzaakHertekenen(focusSelector) {
  const wrap = document.getElementById('oorzaak-wrap');
  if (!wrap) return;
  wrap.innerHTML = oorzaakHtml();
  if (focusSelector) wrap.querySelector(focusSelector)?.focus();
}
export function wizOorzaakGroep(knop) {
  const id = knop?.dataset?.groep;
  if (!id) return;
  _oorzaakOpen = id;
  oorzaakHertekenen(`[data-groep="${id}"]`);
}
export function wizOorzaakToggle(knop) {
  const label = knop?.dataset?.oorzaak;
  if (!label) return;
  R.oorzaakStoring = wisselOorzaak(R.oorzaakStoring, label);
  oorzaakHertekenen(`[data-oorzaak="${CSS.escape(label)}"]`);
}
export function wizOorzaakOud(knop) {
  const w = knop?.dataset?.oud;
  if (!w) return;
  R.oorzaakStoring = verwijderOud(R.oorzaakStoring, w);
  oorzaakHertekenen();
}
export function wizSaveOmschrijving() {
  R.probleem = wizV('f-probleem');
  R.acties   = wizV('f-acties');
  if (R.interventieType === 'Installatie') { R.oorzaakStoring = []; return; }
  R.oorzaakStoring = schoneLijst(R.oorzaakStoring);
  return valideerOorzaak(R.oorzaakStoring);
}

// ── Stap 4b: Foto's ──
export function wizRenderFotos(el) {
  el.innerHTML = `
    <div class="wiz-step-title" role="heading" aria-level="3">Foto's</div>
    <div class="wiz-field">
      <div id="wiz-foto-grid" class="foto-grid"></div>
      <input type="file" id="wiz-foto-file-input" aria-label="Foto's kiezen" accept="image/*" multiple style="display:none" onchange="handleWizFotoFiles(this)">
      <button class="foto-add-btn" onclick="document.getElementById('wiz-foto-file-input').click()">+ Foto toevoegen</button>
    </div>`;
  renderFotoGridInto('wiz-foto-grid');
}
export function wizSaveFotos() {
  R.fotos = _fotoState.fotos;
}
export async function handleWizFotoFiles(input) {
  await handleFotoFiles(input, 'wiz-foto-grid');
  R.fotos = _fotoState.fotos;
}

// ── Stap 5: Status & onderdelen ──
// Actieve tag-filters voor cataloguszoeken
export let _wizActiveTags = [];

export function wizRenderStatus(el) {
  const selHtml = _wizRenderGeselecteerd();
  // Populaire tags (max 8 meest voorkomende)
  const allTags = getAlleTags().slice(0, 12);
  // Tags komen uit prijsbeheer (vrij tekstveld, opgeslagen in de prijzen-blob). Een inline
  // onclick met een JS-string is daar niet veilig voor: de browser decodeert HTML-entities in
  // een attribuutwaarde vóórdat de handler als JS gecompileerd wordt, dus escHtml()'s &#39;
  // wordt weer een echte apostrof en breekt de JS-string open. Daarom de tag als
  // data-attribuut meegeven + addEventListener (zelfde patroon als de .btn-navigeer-knoppen).
  const tagFilterHtml = allTags.map(t =>
    `<button class="wiz-tag-filter${_wizActiveTags.includes(t)?' active':''}" aria-pressed="${_wizActiveTags.includes(t)}" data-tag="${escHtml(t)}">${escHtml(t)}</button>`
  ).join('');

  const isInstallatie = R.interventieType === 'Installatie';
  el.innerHTML = `
    <div class="wiz-step-title" role="heading" aria-level="3">${isInstallatie ? 'Materialen' : 'Status &amp; onderdelen'}</div>
    ${isInstallatie ? '' : `
    <div class="wiz-field">
      <label class="wiz-field-label">Definitief hersteld</label>
      <div class="wiz-radio-cards row">
        <label class="wiz-radio-card"><input type="radio" name="f-hersteld" value="ja" ${R.hersteld==='ja'?'checked':''}><div><div class="wiz-radio-card-label">Ja</div></div></label>
        <label class="wiz-radio-card"><input type="radio" name="f-hersteld" value="nee" ${R.hersteld!=='ja'?'checked':''}><div><div class="wiz-radio-card-label">Nee</div></div></label>
      </div>
    </div>
    <div class="wiz-field">
      <label class="wiz-field-label">Nieuwe interventie nodig</label>
      <div class="wiz-radio-cards row">
        <label class="wiz-radio-card"><input type="radio" name="f-nieuw-inter" value="ja" ${R.nieuwInter==='ja'?'checked':''}><div><div class="wiz-radio-card-label">Ja</div></div></label>
        <label class="wiz-radio-card"><input type="radio" name="f-nieuw-inter" value="nee" ${R.nieuwInter!=='ja'?'checked':''}><div><div class="wiz-radio-card-label">Nee</div></div></label>
      </div>
    </div>`}
    <div class="wiz-sep"></div>
    <div class="wiz-field">
      <label class="wiz-field-label" for="wiz-cat-q">Onderdelen toevoegen</label>
      <div class="wiz-cat-search-wrap">
        <span class="wiz-cat-search-icon">🔍</span>
        <input class="wiz-cat-search" id="wiz-cat-q" type="search"
          placeholder="Zoek op naam of tag…" oninput="wizCatFilter()" autocomplete="off" />
      </div>
      <div class="wiz-tag-filters" id="wiz-tag-filters">${tagFilterHtml}</div>
      <div class="wiz-cat-results" id="wiz-cat-results"></div>
      <button class="wiz-add-part" onclick="wizAddVrijeRegel()" style="margin-bottom:8px">+ Vrije regel (handmatig)</button>
    </div>
    <div class="wiz-field" id="wiz-sel-section">
      <label class="wiz-field-label">Geselecteerde onderdelen</label>
      <div id="wiz-sel-list">${selHtml}</div>
      ${_wizTotaalRij()}
    </div>
    <div class="wiz-sep"></div>
    <div class="wiz-field">
      <label class="wiz-field-label" for="f-varia">Varia / opmerkingen</label>
      <textarea class="wiz-textarea" id="f-varia" rows="3" placeholder="Bijzonderheden, extra info...">${escHtml(R.varia)}</textarea>
    </div>`;

  // Tag-filterknoppen: click via addEventListener i.p.v. inline onclick (zie comment hierboven)
  el.querySelectorAll('.wiz-tag-filter').forEach(btn => {
    btn.addEventListener('click', () => wizToggleTagFilter(btn.dataset.tag || ''));
  });

  // Render catalogusresultaten
  _wizUpdateCatResults();
}

export function _wizRenderGeselecteerd() {
  if (!R.onderdelen.length) return '<div style="font-size:0.8rem;color:var(--muted);padding:4px 0">Nog geen onderdelen geselecteerd</div>';
  return R.onderdelen.map((p, i) => {
    const subtotaal = (parseFloat(p.prijs) || 0) * (parseInt(p.aantal) || 1);
    const isVrij = (p.id || '').startsWith('vrij-');
    return `<div class="wiz-sel-item">
      <div class="wiz-sel-top">
        ${isVrij
          ? `<input class="wiz-part-omschr" style="flex:1" type="text" aria-label="Omschrijving onderdeel" placeholder="Omschrijving" value="${escHtml(p.naam||'')}" oninput="wizUpdSelNaam(${i},this.value)" />`
          : `<span class="wiz-sel-naam">${escHtml(p.naam)}</span>`
        }
        <button class="wiz-sel-del" onclick="wizRemovePart(${i})" title="Verwijderen" aria-label="Verwijder ${escHtml(p.naam||'onderdeel')}">✕</button>
      </div>
      <div class="wiz-sel-bottom">
        <div class="wiz-sel-aantal-wrap">
          <span class="wiz-sel-aantal-lbl">Aantal${p.eenheid==='meter' ? ' (meter)' : ''}</span>
          <input class="wiz-sel-aantal" type="number" min="1" step="1" aria-label="Aantal ${escHtml(p.naam||'onderdeel')}" value="${p.aantal||1}"
            oninput="wizUpdSelAantal(${i},this.value)" />
        </div>
        ${isVrij
          ? `<input class="wiz-part-prijs" type="number" aria-label="Prijs" placeholder="€ prijs" min="0" step="0.01"
              style="width:80px" value="${p.prijs||''}"
              oninput="wizUpdSelPrijs(${i},this.value)" />
             <select class="wiz-part-eenheid" aria-label="Eenheid" style="width:60px" onchange="wizUpdSelEenheid(${i},this.value)">
               <option value="stuk" ${p.eenheid!=='meter'?'selected':''}>stuk</option>
               <option value="meter" ${p.eenheid==='meter'?'selected':''}>meter</option>
             </select>`
          : `<span class="wiz-sel-stukprijs">€ ${(parseFloat(p.prijs)||0).toFixed(2)} / ${p.eenheid || 'stuk'}</span>`
        }
        <span class="wiz-sel-subtotaal">€ ${subtotaal.toFixed(2)}</span>
        <label class="wiz-sel-factureer">
          <input type="checkbox" aria-label="Factureren ${escHtml(p.naam||'onderdeel')}" ${p.factureren!==false?'checked':''} onchange="wizUpdSelFact(${i},this.checked)" />
          Factureren
        </label>
      </div>
    </div>`;
  }).join('');
}

export function _wizTotaalRij() {
  const billable = R.onderdelen.filter(p => p.factureren !== false);
  const totaal   = billable.reduce((sum, p) => sum + (parseFloat(p.prijs)||0) * (parseInt(p.aantal)||1), 0);
  if (!R.onderdelen.length) return '';
  const nietFactureerbaar = R.onderdelen.length - billable.length;
  return `<div class="wiz-totaal-row">
    <span class="wiz-totaal-lbl">Totaal factureerbaar (excl. btw)${nietFactureerbaar ? ` <span style="font-size:0.75em;color:var(--muted)">(${nietFactureerbaar} niet aangerekend)</span>` : ''}</span>
    <span class="wiz-totaal-val">€ ${totaal.toFixed(2)}</span>
  </div>`;
}

export function _wizUpdateCatResults() {
  const q = document.getElementById('wiz-cat-q')?.value || '';
  const resultEl = document.getElementById('wiz-cat-results');
  if (!resultEl) return;
  const resultaten = zoekOnderdelen(q, _wizActiveTags);
  if (!resultaten.length) {
    resultEl.innerHTML = `<div class="wiz-cat-empty">Geen onderdelen gevonden</div>`;
    return;
  }
  // o.id komt uit de prijzen-blob → net als bij de tag-filters geen inline onclick met een
  // JS-string, maar een data-attribuut + addEventListener.
  resultEl.innerHTML = resultaten.slice(0, 20).map(o =>
    `<div class="wiz-cat-item" data-ond-id="${escHtml(o.id)}">
      <span class="wiz-cat-item-naam">${escHtml(o.naam)}</span>
      <span class="wiz-cat-item-prijs">€ ${(o.prijs||0).toFixed(2)}</span>
    </div>`
  ).join('');
  resultEl.querySelectorAll('.wiz-cat-item').forEach(item => {
    item.addEventListener('click', () => wizVoegCatToe(item.dataset.ondId || ''));
  });
}

export function wizCatFilter() {
  _wizUpdateCatResults();
}

export function wizToggleTagFilter(tag) {
  const idx = _wizActiveTags.indexOf(tag);
  if (idx >= 0) _wizActiveTags.splice(idx, 1);
  else _wizActiveTags.push(tag);
  // Update filter buttons
  document.querySelectorAll('.wiz-tag-filter').forEach(btn => {
    btn.classList.toggle('active', _wizActiveTags.includes(btn.dataset.tag || ''));
    btn.setAttribute('aria-pressed', _wizActiveTags.includes(btn.dataset.tag || '') ? 'true' : 'false');
  });
  _wizUpdateCatResults();
}

export function wizVoegCatToe(id) {
  wizSaveStatus();
  const src = PRIJZEN || PRIJZEN_DEFAULTS;
  const o = src.onderdelen.find(x => x.id === id);
  if (!o) return;
  // Check of al aanwezig → verhoog aantal
  const existing = R.onderdelen.find(p => p.id === id);
  if (existing) {
    existing.aantal = (parseInt(existing.aantal) || 1) + 1;
  } else {
    R.onderdelen.push({ id: o.id, naam: o.naam, prijs: o.prijs, aantal: 1, factureren: true, eenheid: o.eenheid || 'stuk' });
  }
  _wizHertekenGeselecteerd();
}

export function wizAddVrijeRegel() {
  wizSaveStatus();
  R.onderdelen.push({ id: 'vrij-' + Date.now(), naam: '', prijs: '', aantal: 1, factureren: true, eenheid: 'stuk' });
  _wizHertekenGeselecteerd();
  setTimeout(() => {
    const inputs = document.querySelectorAll('.wiz-part-omschr');
    if (inputs.length) inputs[inputs.length-1].focus();
  }, 50);
}

export function wizRemovePart(i) {
  wizSaveStatus();
  R.onderdelen.splice(i, 1);
  _wizHertekenGeselecteerd();
}

export function wizUpdSelNaam(i, val)  { if (R.onderdelen[i]) R.onderdelen[i].naam      = val; _wizUpdateTotaalRow(); }
export function wizUpdSelAantal(i, val){ if (R.onderdelen[i]) R.onderdelen[i].aantal    = parseInt(val)||1; _wizUpdateTotaalRow(); }
export function wizUpdSelPrijs(i, val) { if (R.onderdelen[i]) R.onderdelen[i].prijs     = val; _wizUpdateTotaalRow(); }
export function wizUpdSelFact(i, val)  { if (R.onderdelen[i]) R.onderdelen[i].factureren = val; _wizUpdateTotaalRow(); }
export function wizUpdSelEenheid(i, val) { if (R.onderdelen[i]) R.onderdelen[i].eenheid = val; _wizHertekenGeselecteerd(); }

// Werkt enkel het totaal-rijtje bij — laat de input-elementen zelf (en dus de focus/cursorpositie) met rust.
export function _wizUpdateTotaalRow() {
  const selSection = document.getElementById('wiz-sel-section');
  if (!selSection) return;
  let totaalEl = selSection.querySelector('.wiz-totaal-row');
  if (totaalEl) totaalEl.outerHTML = _wizTotaalRij();
  else selSection.insertAdjacentHTML('beforeend', _wizTotaalRij());
}

// Volledige her-render blijft nodig zodra een rij wordt toegevoegd/verwijderd
// (aantal DOM-nodes verandert) — gebruikt door wizAddVrijeRegel/wizRemovePart/wizVoegCatToe.
export function _wizHertekenGeselecteerd() {
  const selList = document.getElementById('wiz-sel-list');
  if (!selList) return;
  selList.innerHTML = _wizRenderGeselecteerd();
  _wizUpdateTotaalRow();
}

// Oud compat alias (niet meer nodig maar voorkomt errors als ergens anders wizUpdatePart staat)
export function wizUpdatePart(i, key, val) {
  if (R.onderdelen[i]) R.onderdelen[i][key] = val;
}
export function wizAddPart() { wizAddVrijeRegel(); }
export function wizSaveStatus() {
  R.hersteld   = wizChecked('f-hersteld')    || 'nee';
  R.nieuwInter = wizChecked('f-nieuw-inter') || 'nee';
  R.varia      = wizV('f-varia');
}

export function wizSaveSigTech() {
  R.handtekeningTech = (_sigTech && !_sigTech.isEmpty()) ? _sigTech.toDataURL() : null;
}
export function wizSaveSigKlant() {
  R.handtekeningKlant = (_sigKlant && !_sigKlant.isEmpty()) ? _sigKlant.toDataURL() : null;
}

// Handtekeningvlak: het tekenvlak krijgt de weergegeven grootte in apparaatpixels (devicePixelRatio, max. 2) en blijft meeschalen
// met zijn omlijsting (draaien, venster). De getekende lijnen blijven bij een herschaling bewaard (toData/fromData).
function maakHandtekeningPad(canvas, wrap, bijEinde) {
  const pad = new SignaturePad(canvas, { penColor: '#181e24', backgroundColor: '#ffffff' });
  let breed = 0, hoog = 0;
  const pas = () => {
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (!w || !h || (w === breed && h === hoog)) return;
    const data = pad.toData();
    const ratio = Math.min(2, Math.max(1, devicePixelRatio || 1));
    canvas.width = Math.round(w * ratio); canvas.height = Math.round(h * ratio);
    canvas.getContext('2d').scale(ratio, ratio);
    breed = w; hoog = h;
    pad.clear();
    if (data.length) pad.fromData(data);
  };
  pas();
  if (typeof ResizeObserver === 'function') new ResizeObserver(pas).observe(wrap);
  else window.addEventListener('resize', pas);
  pad.addEventListener('endStroke', bijEinde);
  return pad;
}

// ── Stap 6: Handtekening technieker ──
export function wizRenderSigTech(el) {
  el.innerHTML = `<div class="wiz-sigstap">
    <div class="wiz-step-title" role="heading" aria-level="3">✍️ Handtekening technieker</div>
    <p style="font-size:0.85rem;color:var(--muted);margin-bottom:14px;line-height:1.5">
      Teken hieronder ter bevestiging van de uitgevoerde werkzaamheden.
    </p>
    <div class="wiz-sig-container" id="sig-tech-wrap">
      <canvas id="sig-tech-canvas"></canvas>
      <div class="wiz-sig-hint" id="sig-tech-hint"><div style="font-size:2rem">✍️</div><div>Teken hier</div></div>
    </div>
    <div class="wiz-sig-actions">
      <button class="wiz-sig-clear" onclick="wizClearSigTech()">Wissen</button>
      <div class="wiz-sig-status" id="sig-tech-status">Nog niet getekend</div>
    </div></div>`;
  requestAnimationFrame(() => {
    const canvas = document.getElementById('sig-tech-canvas');
    const wrap   = document.getElementById('sig-tech-wrap');
    if (window.SignaturePad) {
      _sigTech = maakHandtekeningPad(canvas, wrap, () => {
        document.getElementById('sig-tech-hint').style.display = 'none';
        const st = document.getElementById('sig-tech-status');
        if (st) { st.textContent = '✓ Getekend'; st.style.color = 'var(--accent-ink)'; }
        wrap.classList.add('has-sig');
      });
      // Terugnavigeren mag een eerder getekende handtekening niet wissen.
      if (R.handtekeningTech) {
        _sigTech.fromDataURL(R.handtekeningTech);
        document.getElementById('sig-tech-hint').style.display = 'none';
        const st = document.getElementById('sig-tech-status');
        if (st) { st.textContent = '✓ Getekend'; st.style.color = 'var(--accent-ink)'; }
        wrap.classList.add('has-sig');
      }
    }
  });
}
export function wizClearSigTech() {
  if (_sigTech) {
    _sigTech.clear();
    R.handtekeningTech = null;
    const hint = document.getElementById('sig-tech-hint');
    if (hint) hint.style.display = '';
    const st = document.getElementById('sig-tech-status');
    if (st) { st.textContent = 'Nog niet getekend'; st.style.color = ''; }
    document.getElementById('sig-tech-wrap')?.classList.remove('has-sig');
  }
}

// ── Stap 7: Handtekening klant ──
export function wizRenderSigKlant(el) {
  // Bouw rapport-preview (klant kan scrollen en lezen voor te tekenen)
  const previewHtml = buildRapportHtml();
  el.innerHTML = `<div class="wiz-sigstap wiz-sigstap--klant">
    <div class="wiz-step-title" role="heading" aria-level="3">✍️ Handtekening klant</div>
    <p style="font-size:0.85rem;color:var(--muted);margin-bottom:10px;line-height:1.5">
      Geef het apparaat aan de klant. Klant leest het rapport en tekent onderaan.
    </p>
    <iframe id="rapport-preview-frame"
      srcdoc=""
      class="wiz-preview-frame"
      sandbox="allow-same-origin">
    </iframe>
    <div class="wiz-sig-container" id="sig-klant-wrap">
      <canvas id="sig-klant-canvas"></canvas>
      <div class="wiz-sig-hint" id="sig-klant-hint"><div style="font-size:2rem">✍️</div><div>Teken hier</div></div>
    </div>
    <div class="wiz-sig-actions">
      <button class="wiz-sig-clear" onclick="wizClearSigKlant()">Wissen</button>
      <div class="wiz-sig-status" id="sig-klant-status">Nog niet getekend</div>
    </div></div>`;
  requestAnimationFrame(() => {
    // Vul de rapport-preview iframe (na render zodat het DOM beschikbaar is)
    const frame = document.getElementById('rapport-preview-frame');
    if (frame) frame.srcdoc = previewHtml;

    const canvas = document.getElementById('sig-klant-canvas');
    const wrap   = document.getElementById('sig-klant-wrap');
    if (window.SignaturePad) {
      _sigKlant = maakHandtekeningPad(canvas, wrap, () => {
        document.getElementById('sig-klant-hint').style.display = 'none';
        const st = document.getElementById('sig-klant-status');
        if (st) { st.textContent = '✓ Getekend'; st.style.color = 'var(--accent-ink)'; }
        wrap.classList.add('has-sig');
      });
      // Terugnavigeren mag een eerder getekende handtekening niet wissen.
      if (R.handtekeningKlant) {
        _sigKlant.fromDataURL(R.handtekeningKlant);
        document.getElementById('sig-klant-hint').style.display = 'none';
        const st = document.getElementById('sig-klant-status');
        if (st) { st.textContent = '✓ Getekend'; st.style.color = 'var(--accent-ink)'; }
        wrap.classList.add('has-sig');
      }
    }
  });
}
export function wizClearSigKlant() {
  if (_sigKlant) {
    _sigKlant.clear();
    R.handtekeningKlant = null;
    const hint = document.getElementById('sig-klant-hint');
    if (hint) hint.style.display = '';
    const st = document.getElementById('sig-klant-status');
    if (st) { st.textContent = 'Nog niet getekend'; st.style.color = ''; }
    document.getElementById('sig-klant-wrap')?.classList.remove('has-sig');
  }
}

// ── PDF ──
// Guard: voorkomt dubbele upload/archivering per wizard-sessie
export let _rapportUploaded = false;

// Enkel een echte afbeelding als data-URL mag in een src van het rapport (handtekeningen); al het andere wordt een lege tekenreeks.
const SIG_DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

// Bouwt de rapport-HTML-string zonder side effects (herbruikbaar voor preview + afdrukken).
export function buildRapportHtml() {
  const isInstallatie = R.interventieType === 'Installatie';
  const facturatieLabel = R.facturatie === 'vrij'
    ? (escHtml(R.facturatieVrij) || '—')
    : R.facturatie === 'klant' ? 'Klant' : 'Partner / installateur';
  const stLabel = {
    '2e-lijn': '2e lijns interventie',
    '1e-lijn': '1e lijns interventie',
    'garantie': 'Garantie',
  }[R.servicetype] || '—';
  const kabelStr = R.kabel === 'kabel'
    ? ('Vaste kabel' + (R.kabellengte ? ' ' + R.kabellengte : ''))
    : R.kabel === 'socket' ? 'Socket' : '';
  const productInfo = [R.type, R.uitvoering, kabelStr].filter(Boolean).map(escHtml).join(' · ') || '—';
  const zohoRef     = _wizTicket.number ? `#${_wizTicket.number}` : (_wizTicket.isLocal ? '' : (_wizTicket.id || ''));
  const datumStr    = R.datum
    ? new Date(R.datum + 'T12:00:00').toLocaleDateString('nl-BE', { day:'numeric', month:'long', year:'numeric' })
    : '—';

  const geldigeOnderdelen  = R.onderdelen.filter(p => p.naam);
  const billableOnderdelen = geldigeOnderdelen.filter(p => p.factureren !== false);
  const totaalOnderdelen   = billableOnderdelen.reduce((s, p) => s + (parseFloat(p.prijs)||0) * (parseInt(p.aantal)||1), 0);
  // Loonkost hier al berekenen (i.p.v. enkel lokaal in de Loonkosten-tabel-IIFE verderop),
  // zodat het gecombineerde Kostenoverzicht onderaan dit bedrag kan hergebruiken zonder
  // bedragen op meerdere, verspreide plekken te tonen.
  const isGarantieTotaal = R.servicetype === 'garantie';
  const { bruto: brutoTotaal } = berekenLoonkost(R.servicetype, calcWerktijdMin(R.start, R.stop), parseInt(R.aanrijtijdMin) || 0);
  const nettoTotaal = isGarantieTotaal ? 0 : brutoTotaal;
  let partsHtml = geldigeOnderdelen
    .map(p => {
      const aantal      = parseInt(p.aantal) || 1;
      const factureren  = p.factureren !== false;
      const stukprijs   = parseFloat(p.prijs) || 0;
      const subtotaal   = stukprijs * aantal;
      return `<tr>
        <td>${escHtml(p.naam)}${!factureren ? ' <span style="font-size:7.5pt;color:#888;font-style:italic">(niet aangerekend)</span>' : ''}</td>
        <td style="text-align:center">${aantal}${p.eenheid==='meter' ? ' meter' : ''}</td>
        <td style="text-align:right">${factureren ? `€ ${stukprijs.toFixed(2)}` : '—'}</td>
        <td style="text-align:right">${factureren ? `€ ${subtotaal.toFixed(2)}` : '—'}</td>
      </tr>`;
    }).join('');
  const veiligeSig = (v) => (typeof v === 'string' && SIG_DATA_URL.test(v) ? v : '');
  const sigTechSrc  = veiligeSig(R.handtekeningTech);
  const sigKlantSrc = veiligeSig(R.handtekeningKlant);
  const sigTechImg  = sigTechSrc
    ? `<img src="${sigTechSrc}" style="max-width:220px;max-height:90px;display:block">`
    : '<span style="color:#aaa;font-style:italic;font-size:9pt">(niet getekend)</span>';
  const sigKlantImg = sigKlantSrc
    ? `<img src="${sigKlantSrc}" style="max-width:220px;max-height:90px;display:block">`
    : '<span style="color:#aaa;font-style:italic;font-size:9pt">(niet getekend)</span>';

  const bolt = `<svg width="12" height="20" viewBox="0 0 14 22" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;margin-right:5px">
    <line x1="9" y1="5" x2="6" y2="11" stroke="#00dfa3" stroke-width="3" stroke-linecap="round"/>
    <line x1="8" y1="12" x2="5" y2="18" stroke="#00dfa3" stroke-width="3" stroke-linecap="round"/>
  </svg>`;

  const html = `<!DOCTYPE html>
<html lang="nl"><head>
<meta charset="utf-8">
<title>Service Rapport Blitz Power — ${escHtml(R.datum)}</title>
<style>${RAPPORT_CSS}</style>
</head><body>
<div class="header">${bolt}<div><div class="logo-text">BLITZ POWER</div><div class="logo-sub">SERVICE RAPPORT</div></div></div>
<div class="accent-bar"></div>
<div class="rapport-section info-grid">
  <div class="info-row cols-3">
    <div class="info-cell"><div class="info-lbl">Datum</div><div class="info-val">${datumStr}</div></div>
    <div class="info-cell"><div class="info-lbl">Technieker</div><div class="info-val">${escHtml(R.technieker)||'—'}</div></div>
    <div class="info-cell"><div class="info-lbl">#Zoho</div><div class="info-val">${escHtml(zohoRef)||'—'}</div></div>
  </div>
  <div class="info-row cols-1">
    <div class="info-cell"><div class="info-lbl">${isInstallatie ? 'Installatie adres' : 'Interventie adres'}</div><div class="info-val">${escHtml(R.adres)||'—'}</div></div>
  </div>
  <div class="info-row ${R.aanrijtijdMin > 0 ? 'cols-4' : 'cols-3'}">
    <div class="info-cell accent"><div class="info-lbl">Starttijd</div><div class="info-val">${R.start||'—'}</div></div>
    <div class="info-cell accent"><div class="info-lbl">Stoptijd</div><div class="info-val">${R.stop||'—'}</div></div>
    <div class="info-cell accent"><div class="info-lbl">Totale werktijd</div><div class="info-val">${R.werktijd||'—'}</div></div>
    ${R.aanrijtijdMin > 0 ? `<div class="info-cell accent"><div class="info-lbl">Aanrijtijd</div><div class="info-val">${fmtDuur(R.aanrijtijdMin)}</div></div>` : ''}
  </div>
  <div class="info-row ${isInstallatie ? 'cols-1' : 'cols-3'}">
    ${isInstallatie ? '' : `<div class="info-cell"><div class="info-lbl">Servicetype</div><div class="info-val">${stLabel}</div></div>
    <div class="info-cell"><div class="info-lbl">Facturatie aan</div><div class="info-val">${facturatieLabel}</div></div>`}
    <div class="info-cell"><div class="info-lbl">Installateur</div><div class="info-val">${escHtml(R.installateur)||'—'}</div></div>
  </div>
  <div class="info-row cols-2">
    <div class="info-cell"><div class="info-lbl">Serienummer</div><div class="info-val">${R.aantalLaadpalen > 1 ? `${escHtml(R.serienummer) || 'Geen serienummer'} (master) — ${R.aantalLaadpalen}×` : (escHtml(R.serienummer)||'—')}</div></div>
    <div class="info-cell"><div class="info-lbl">Type / uitvoering</div><div class="info-val">${productInfo}</div></div>
  </div>
</div>
<div class="rapport-section">
<div class="sec">${isInstallatie ? 'Omschrijving installatie' : 'Omschrijving probleem'}</div>
<div class="block">${escHtml(R.probleem)||'&nbsp;'}</div>
</div>
<div class="rapport-section">
<div class="sec">Ondernomen acties</div>
<div class="block">${escHtml(R.acties)||'&nbsp;'}</div>
</div>
${isInstallatie ? '' : `
<div class="rapport-section">
<div class="sec">Oorzaak storing</div>
<div class="block">${escHtml(R.oorzaakStoring.join(', ')) || '&nbsp;'}</div>
</div>`}
${R.fotos.length ? `<div class="sec">Foto's</div>
<div class="foto-report-grid">${R.fotos.map(f => `<div class="foto-report-item"><img src="${escHtml(f.dataUrl)}" style="max-width:100%;border-radius:3px"><div style="font-size:7.5pt;color:#777;margin-top:2px">${escHtml(new Date(f.tijdstip).toLocaleString('nl-BE'))}${f.caption ? ' — ' + escHtml(f.caption) : ''}</div></div>`).join('')}</div>` : ''}
${isInstallatie ? '' : `
<div class="rapport-section">
<div class="sec">Status laadinfrastructuur</div>
<div class="status-row">
  <div class="status-cell"><div class="info-lbl">Definitief hersteld</div><strong>${R.hersteld==='ja'?'Ja':'Nee'}</strong></div>
  <div class="status-cell"><div class="info-lbl">Nieuwe interventie nodig</div><strong>${R.nieuwInter==='ja'?'Ja':'Nee'}</strong></div>
</div>
</div>`}
${geldigeOnderdelen.length ? `<div class="sec">${isInstallatie ? 'Gebruikte materialen' : 'Vervangen onderdelen'}</div>
<table class="parts"><thead><tr><th>Omschrijving</th><th style="text-align:center">Aantal</th><th style="text-align:right">Stukprijs</th><th style="text-align:right">Subtotaal</th></tr></thead>
<tbody>${partsHtml}</tbody></table>` : ''}
${R.varia ? `<div class="rapport-section"><div class="sec">Varia</div><div class="block">${escHtml(R.varia)}</div></div>` : ''}
${isInstallatie ? '' : (() => {
  const wMin = calcWerktijdMin(R.start, R.stop);
  const aMin = parseInt(R.aanrijtijdMin) || 0;
  const st   = R.servicetype;
  const { bruto, totMin, extraUren } = berekenLoonkost(st, wMin, aMin);
  const isGarantie = st === 'garantie';
  const netto = isGarantie ? 0 : bruto;

  const fmtMin = m => {
    const h = Math.floor(m / 60), mn = m % 60;
    return h > 0 ? (mn > 0 ? `${h}u${String(mn).padStart(2,'0')}` : `${h}u`) : `${mn} min`;
  };

  let detail = '';
  if (st === '2e-lijn') {
    const delen = [];
    if (aMin) delen.push(`Aanrijtijd: ${fmtMin(aMin)}`);
    delen.push(`Werktijd: ${fmtMin(wMin)}`);
    delen.push(`Totaal: ${fmtMin(totMin)} → forfait €175 (eerste 3u)`);
    if (extraUren > 0) delen.push(`${extraUren} extra gestart${extraUren > 1 ? 'e' : ''} uur × €75 = €${extraUren * 75}`);
    detail = delen.join(' &nbsp;·&nbsp; ');
  } else if (st === '1e-lijn') {
    const delen = [];
    if (aMin) delen.push(`Aanrijtijd: ${fmtMin(aMin)}`);
    delen.push(`Werktijd: ${fmtMin(wMin)}`);
    const gu = Math.ceil(totMin / 60);
    delen.push(`Totaal: ${fmtMin(totMin)} → ${gu} gestart${gu !== 1 ? 'e' : ''} uur × €115`);
    detail = delen.join(' &nbsp;·&nbsp; ');
  } else {
    const delen = [];
    if (aMin) delen.push(`Aanrijtijd: ${fmtMin(aMin)}`);
    delen.push(`Werktijd: ${fmtMin(wMin)}`);
    const gu = Math.ceil(totMin / 60);
    delen.push(`Totaal: ${fmtMin(totMin)} → ${gu} gestart${gu !== 1 ? 'e' : ''} uur × €115 — volledig gedekt door garantie`);
    detail = delen.join(' &nbsp;·&nbsp; ');
  }

  const nettoCel = isGarantie
    ? `<td style="text-align:right"><span style="text-decoration:line-through;color:#aaa;font-size:8pt">€ ${bruto.toFixed(2)}</span> &nbsp; <strong style="color:#00b87a">€ 0,00</strong></td>`
    : `<td style="text-align:right"><strong>€ ${netto.toFixed(2)}</strong></td>`;

  return `<div class="sec">Loonkosten</div>
<table class="parts"><thead><tr><th>Omschrijving</th><th style="text-align:right">Bedrag (excl. btw)</th></tr></thead>
<tbody>
<tr>
  <td>${stLabel}${isGarantie ? ' <span style="font-size:7.5pt;color:#888;font-style:italic">(100% korting)</span>' : ''}<br>
    <span style="font-size:7.5pt;color:#777">${detail}</span></td>
  ${nettoCel}
</tr>
</tbody></table>`;
})()}
<div class="rapport-section">
<div class="sec">Kostenoverzicht</div>
<table class="parts"><tbody>
<tr><td>Onderdelen (excl. btw)</td><td style="text-align:right">€ ${totaalOnderdelen.toFixed(2)}</td></tr>
${isInstallatie ? '' : `<tr><td>Loonkosten (excl. btw)${isGarantieTotaal ? ' <span style="font-size:7.5pt;color:#888;font-style:italic">(100% korting)</span>' : ''}</td><td style="text-align:right">€ ${nettoTotaal.toFixed(2)}</td></tr>`}
<tr style="background:#111;color:#fff;font-weight:700"><td style="text-transform:uppercase;letter-spacing:.05em;font-size:8pt">Totaal te factureren (excl. btw)</td><td style="text-align:right;font-size:11pt">€ ${(totaalOnderdelen + (isInstallatie ? 0 : nettoTotaal)).toFixed(2)}</td></tr>
</tbody></table>
</div>
<div class="rapport-section">
<div class="sec">Handtekeningen</div>
<div class="sig-row">
  <div class="sig-box"><div class="sig-box-title">Technieker</div>${sigTechImg}</div>
  <div class="sig-box"><div class="sig-box-title">Klant</div>${sigKlantImg}</div>
</div>
</div>
</body></html>`;

  return html;
}

export async function printRapport() {
  if (aanrijtijdOntbreekt()) return naarFacturatieVoorAanrijtijd(); // vangnet (eindreview I2), vóór window.open
  // Venster synchroon openen, vóór elke await. Browsers laten window.open() enkel toe
  // binnen de korte "transient user activation" na de klik (Chrome: ~5s). Wachten we
  // eerst de outbox-poging af (tot 5s), dan is die activation op het trage/offline-pad
  // — precies het scenario waarvoor deze flow bestaat — net verlopen en blokkeert de
  // browser het afdrukvoorbeeld alsnog. html/blob/blobUrl zijn stuk voor stuk synchroon
  // te berekenen (geen enkele await nodig), dus window.open() kan de echte inhoud meteen
  // krijgen — geen tussentijds leeg tabblad nodig, en dus ook geen risico dat dat lege
  // tabblad blijft hangen als de tab intussen naar de achtergrond gaat.
  const html    = buildRapportHtml();
  const blob    = new Blob([html], { type: 'text/html; charset=utf-8' });
  const blobUrl = URL.createObjectURL(blob);
  const win     = window.open(blobUrl, '_blank');
  if (!win) {
    toast(TEST_MODE
      ? 'Pop-upblokkering actief — sta pop-ups toe om het afdrukvoorbeeld te zien.'
      : 'Pop-upblokkering actief — sta pop-ups toe om het afdrukvoorbeeld te zien. Het rapport wordt wel verstuurd.');
  }

  // Wachtrij-item aanmaken en proberen te verzenden vóórdat het afdrukvoorbeeld
  // gevuld wordt — op mobiel duwt het openen van de tab de app naar de achtergrond,
  // en dat mocht niet meer gelijktijdig lopen met de niet-afgewachte verzending zoals
  // voorheen (zie design doc 2026-08-11-rapport-verzend-betrouwbaarheid-design.md,
  // "Root cause").
  // Testmodus (?test, ook op de live site): niets naar de server. Geen outbox-item (dus geen
  // archief, geen Zoho-upload), geen oplossing-sync en geen voorraadaftrek. Enkel het
  // afdrukvoorbeeld (hierboven al synchroon geopend) en het sluiten van de wizard.
  if (TEST_MODE && !TEST_UPLOAD) {
    toast('🧪 Testmodus — rapport niet verzonden (enkel afdrukvoorbeeld)', 5000);
    wisConcept(_wizTicketId, _wizDate);
  } else if (!_rapportUploaded) {
    _rapportUploaded = true;

    // Alles hieronder in try/catch: faalt de IndexedDB-schrijfactie (quota vol,
    // privémodus, geblokkeerde DB), dan mag dat printRapport niet afbreken.
    // _rapportUploaded staat immers al op true, dus een tweede poging in dezelfde
    // wizard-sessie zou dit blok overslaan en het rapport stil verloren laten gaan.
    // We tonen daarom een duidelijke fout, maar lopen sowieso door naar het
    // afdrukvoorbeeld en het sluiten van de wizard.
    try {
      const totaal = R.onderdelen
        .filter(p => p.naam && p.factureren !== false)
        .reduce((s, p) => s + (parseFloat(p.prijs) || 0) * (parseInt(p.aantal) || 1), 0);

      const item = {
        id:           crypto.randomUUID(),
        html,
        isLocal:      !!_wizTicket.isLocal,
        ontvangen:    false,
        attempts:     0,
        lastError:    null,
        createdAt:    new Date().toISOString(),
        testModus:    TEST_MODE, // ?test&upload: ook de achtergrondverzender gebruikt dan de testopslag
        ticket: {
          id:       _wizTicket.id   || '',
          number:   _wizTicket.number || '',
          filename: `rapport-${_wizTicket.number || _wizTicket.id}-${R.datum || 'onbekend'}.pdf`,
        },
        archiveBody: {
          datum:            R.datum,
          technieker:       R.technieker,
          ticketId:         _wizTicket.id   || '',
          ticketNumber:     _wizTicket.number ? String(_wizTicket.number) : '',
          klant:            _wizTicket.contact || _wizTicket.account || '',
          adres:            R.adres,
          nieuwInter:       R.nieuwInter,
          hersteld:         R.hersteld,
          servicetype:      R.servicetype,
          facturatie:       R.facturatie,
          prioriteit:       _wizTicket.priority || '',
          interventieType:  R.interventieType || 'Interventie',
          totaalOnderdelen: totaal,
          // R.fotos (losse dataUrl's) en de handtekeningen NIET meesturen -- die staan al
          // ingebakken als <img>-tags in `html`. De HTML zelf gaat apart mee (item.html) en wordt
          // server-side bij het rapport bewaard, dus ook geen `_html` meer in rapportData.
          rapportData:      (({ fotos, handtekeningTech, handtekeningKlant, ...rest }) => rest)(R),
          // Geen 'versie' hier — dedup gebeurt server-side op ticketId+datum
          // (rapport-archief.js), zodat opgestapelde wachtrij-items elkaar niet
          // vals-positief als conflict blokkeren.
        },
      };

      await outboxAdd(item);
      registreerAchtergrondVerzending(); // Background Sync (Android), niet afgewacht
      wisConcept(_wizTicketId, _wizDate); // rapport staat veilig in de outbox
      await refreshOutboxCache();

      // Post-launch feedback (2026-08-17): geen apart "Oplossing invoeren"-knopje meer -- de
      // uitgevoerde acties staan toch al hier (R.acties), dus die worden meteen als oplossing op
      // het Zoho-ticket gezet. Enkel zinvol bij een echt gekoppeld ticket (niet bij een lokale,
      // manueel toegevoegde afspraak) en enkel als er effectief iets ingevuld is. Best-effort,
      // niet afgewacht: mag de rapport-verzending zelf niet vertragen of laten falen.
      if (!item.isLocal && R.acties?.trim()) {
        syncOplossingNaarZoho(item.ticket.id, R.acties);
      }

      // Zelfde best-effort-aanpak als hierboven: wagenvoorraad-aftrek voor gebruikt materiaal
      // mag het afronden van het rapport nooit vertragen of laten falen (zie
      // docs/superpowers/specs/2026-08-20-inventarissysteem-design.md, "Randgevallen").
      // Ticketnummer enkel bij een echt Zoho-ticket (een lokale afspraak heeft er geen).
      // De belofte geeft de producten uit dit rapport die na de aftrek onder hun meldgrens zitten (v2.4.0, "Bijna op").
      const laagBelofte = Promise.resolve(window.registreerVerbruik?.(_wizTicket.assignee, R.onderdelen, item.isLocal ? '' : (_wizTicket.number || '')))
        .then(laag => (Array.isArray(laag) ? laag : []))
        .catch(err => { console.warn('Inventaris-aftrek mislukt (niet blokkerend):', err); return []; });

      const TIMEOUT_MS = 5000;
      const timeout = new Promise(resolve => setTimeout(() => resolve('timeout'), TIMEOUT_MS));
      const result  = await Promise.race([runOutboxItem(item), timeout]);

      let melding, meldingMs;
      if (result === 'timeout') {
        melding = '⏳ Rapport wordt verstuurd — je kan gewoon verder, dit gebeurt op de achtergrond'; meldingMs = 5000;
      } else if (result?.ontvangen === true || nextOutboxAction(result) === 'done') {
        melding = item.isLocal
          ? '✓ Rapport opgeslagen in archief — geen Zoho-ticket gekoppeld'
          : '✓ Rapport verstuurd — het wordt op de achtergrond naar Zoho gestuurd';
        meldingMs = 4500;
      } else {
        melding = '⏳ Rapport staat klaar om te versturen. We proberen opnieuw zodra je verbinding hebt. Je hoeft niets te doen.'; meldingMs = 5000;
      }
      // Eén toast-element: is de aftrek al klaar, dan komt "Bijna op" in dezelfde melding; anders een eigen melding zodra ze klaar is.
      const NOG_BEZIG = Symbol('bezig');
      const laag = await Promise.race([laagBelofte, Promise.resolve(NOG_BEZIG)]);
      if (laag === NOG_BEZIG) {
        toast(melding, meldingMs);
        laagBelofte.then(l => { if (l.length) toast(bijnaOpTekst(l), 7000); });
      } else {
        toast(naRapportTekst(melding, laag), laag.length ? 9000 : meldingMs);
      }

      await refreshOutboxCache();
      renderRapportArchief();
    } catch (err) {
      toast('⚠ Rapport kon niet lokaal bewaard worden — controleer opslagruimte, herlaad de pagina en probeer opnieuw', 6000);
      console.warn('printRapport: onverwachte fout bij het wegschrijven naar de outbox:', err);
    }
  }

  if (win) {
    // Revoke na 2 min — genoeg tijd om te printen
    setTimeout(() => URL.revokeObjectURL(blobUrl), 120000);
  } else {
    URL.revokeObjectURL(blobUrl);
  }

  // Wizard sluiten na geslaagd rapport — geen bevestigingsdialoog meer nodig
  document.getElementById('rapport-wizard').classList.remove('open');
}

// ── Window-bridge ──
// Alle wiz*-functies die in index.html via onclick=/oninput=/onchange= aangeroepen worden
// (bevestigd met: grep -no 'onclick="[^"]*"\|oninput="[^"]*"\|onchange="[^"]*"' public/index.html
// | grep -iE 'wiz|handleWizFotoFiles|updateWerktijd|openRapport|closeWizard|printRapport'), plus de
// interne addEventListener-gebruikte functies (wizVoegCatToe/wizToggleTagFilter — data-attribuut-
// patroon, zie comments hierboven) en de wizAddPart/wizUpdatePart compat-aliassen, voor
// consistentie met de rest van deze lijst.
window.openRapport          = openRapport;
window.closeWizard          = closeWizard;
window.wizNext               = wizNext;
window.wizBack               = wizBack;
window.wizGaNaar             = wizGaNaar;
window.updateWerktijd        = updateWerktijd;
window.wizFacturatieChange   = wizFacturatieChange;
window.wizServicetypeChange  = wizServicetypeChange;
window.wizLoonkostPreview    = wizLoonkostPreview;
window.wizKabelChange        = wizKabelChange;
window.wizOorzaakGroep       = wizOorzaakGroep;
window.wizOorzaakToggle      = wizOorzaakToggle;
window.wizOorzaakOud         = wizOorzaakOud;
window.handleWizFotoFiles    = handleWizFotoFiles;
window.wizCatFilter          = wizCatFilter;
window.wizToggleTagFilter    = wizToggleTagFilter;
window.wizVoegCatToe         = wizVoegCatToe;
window.wizAddVrijeRegel      = wizAddVrijeRegel;
window.wizRemovePart         = wizRemovePart;
window.wizUpdSelNaam         = wizUpdSelNaam;
window.wizUpdSelAantal       = wizUpdSelAantal;
window.wizUpdSelPrijs        = wizUpdSelPrijs;
window.wizUpdSelFact         = wizUpdSelFact;
window.wizUpdSelEenheid      = wizUpdSelEenheid;
window.wizAddPart            = wizAddPart;
window.wizUpdatePart         = wizUpdatePart;
window.wizClearSigTech       = wizClearSigTech;
window.wizClearSigKlant      = wizClearSigKlant;
window.printRapport          = printRapport;

// calcWerktijdMin wordt OOK gebruikt buiten dit blok, in de planning/autoPlan-code
// (index.html, berekening van bezette tijd per dag — `calcWerktijdMin(ev.uur, ev.einduur)`).
// Dat blijft een kale aanroep in een classic <script> — die lost een onbekende identifier op
// via de globale scope-chain (window), dus enkel deze bridge is nodig, geen wijziging daar.
window.calcWerktijdMin = calcWerktijdMin;

export { berekenLoonkost };

// berekenLoonkost wordt ook aangeroepen vanuit rapport-archief.js (renderRapportArchief,
// voor de prijsweergave op archiefkaarten) — zonder deze bridge gooit dat een
// ReferenceError zodra er een archiefkaart met werktijd > 0 gerenderd wordt.
window.berekenLoonkost = berekenLoonkost;

// _fotoState wordt van BUITEN dit bestand zowel gelezen ALS herwezen: index.html's
// openFotoModal()/persistFotoChange()/handleFotoFiles() (het generieke foto-beheer voor de
// ticket-detail "Foto's"-knop, NIET onderdeel van de wizard-brief) delen dit ene state-object
// met de wizard-stap "Foto's" (openRapport/wizRenderFotos/wizSaveFotos/handleWizFotoFiles
// hierboven). openFotoModal() doet `_fotoState = { ticketId, versie, fotos }` — een volledige
// herwijzing, niet enkel een mutatie — dus is een statische `window._fotoState = _fotoState`
// hier fout (zou na de eerste foto-actie een verouderde momentopname vastzetten). Vandaar
// dezelfde live getter/setter-accessor als bij _archiefVersie (Task 2, rapport-archief.js):
Object.defineProperty(window, '_fotoState', {
  get: () => _fotoState,
  set: (v) => { _fotoState = v; },
  configurable: true,
});

