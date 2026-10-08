// schermen/inloggen.js — de loginschermen (logins T14): inloggen, eerste beheerder instellen (met eenmalige herstelcodes),
// wachtwoord wijzigen, wachtwoord vergeten (herstelcode of noodsleutel) en "geen verbinding". Eén overlay #login-overlay
// bovenop de app: ondoorzichtig, focusval, Enter verstuurt, Escape sluit niets. Registreert zichzelf via zetInlogUi.
// Veiligheid: vrije tekst komt enkel via escHtml of textContent in de DOM; wachtwoorden en herstelcodes blijven in
// closures/formuliervelden en gaan nooit naar localStorage of de URL.
import { escHtml, registreerActies } from '../kern/ui.js';
import { apiVerzoek } from '../kern/api.js';
import { zetInlogUi } from '../kern/sessie.js';
import {
  valideerInlog, valideerNieuwWachtwoord, valideerSetup, valideerHerstel, loginFoutTekst, formatHerstelcodes,
} from './inloggen-logica.js';

const OVERLAY_ID = 'login-overlay';
const KOP = { 'X-Blitz': '1' };
const GEEN_VERBINDING = 'Geen verbinding met de server. Probeer het opnieuw.';
const STORING = 'De opslag is tijdelijk niet bereikbaar. Probeer het zo meteen opnieuw.';
const klaar = { naar: 'klaar' };

let overlay = null;
let vorigFocus = null;
let geInerteerd = [];

// ── Overlay: aanmaken, focusval, Escape blokkeren, achtergrond onbereikbaar maken ───────────────────────────────
const FOCUSBAAR = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function opToets(e) {
  if (!overlay) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return; } // de loginlaag is niet te sluiten
  if (e.key !== 'Tab') return;
  const lijst = [...overlay.querySelectorAll(FOCUSBAAR)].filter(el => el.offsetParent !== null || el === document.activeElement);
  if (lijst.length === 0) { e.preventDefault(); return; }
  const eerste = lijst[0];
  const laatste = lijst[lijst.length - 1];
  const actief = document.activeElement;
  if (!overlay.contains(actief)) { e.preventDefault(); eerste.focus(); }
  else if (e.shiftKey && actief === eerste) { e.preventDefault(); laatste.focus(); }
  else if (!e.shiftKey && actief === laatste) { e.preventDefault(); eerste.focus(); }
}

function openOverlay() {
  if (overlay && overlay.isConnected) return overlay;
  vorigFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Inloggen bij Blitz Planning');
  // De rest van de pagina onbereikbaar (toetsenbord en schermlezer) zolang de overlay open is.
  geInerteerd = [...document.body.children].filter(el => el.id !== 'toast' && !el.inert);
  for (const el of geInerteerd) el.inert = true;
  document.body.appendChild(overlay);
  document.addEventListener('keydown', opToets, true);
  return overlay;
}

function sluitOverlay() {
  document.removeEventListener('keydown', opToets, true);
  for (const el of geInerteerd) el.inert = false;
  geInerteerd = [];
  document.body.classList.remove('login-afdrukken');
  if (overlay) { overlay.remove(); overlay = null; }
  try { vorigFocus?.focus?.(); } catch { /* element is weg */ }
  vorigFocus = null;
}

// ── Bouwstenen ─────────────────────────────────────────────────────────────────────────────────────────────────
// Alle teksten hier zijn vaste tekst van deze module; ze gaan toch door escHtml.
function veldHtml({ naam, label, type = 'text', autocomplete = 'off' }) {
  const id = `login-${naam}`;
  return `<div class="set-field"><label class="set-label" for="${escHtml(id)}">${escHtml(label)}</label>`
    + `<input class="set-input" id="${escHtml(id)}" name="${escHtml(naam)}" type="${escHtml(type)}" `
    + `autocomplete="${escHtml(autocomplete)}" autocapitalize="none" spellcheck="false"></div>`;
}

function kaartHtml({ titel, intro, velden = [], verstuurTekst, extraKnoppen = [] }) {
  const knoppen = extraKnoppen.map(k => `<button type="button" class="btn ${escHtml(k.stijl || 'btn--secondary')}" data-actie="${escHtml(k.actie)}">${escHtml(k.tekst)}</button>`).join('');
  return `<div class="login-kaart"><div class="login-merk">Blitz Planning</div><h2>${escHtml(titel)}</h2>`
    + (intro ? `<p class="login-intro">${escHtml(intro)}</p>` : '')
    + `<form class="login-formulier" novalidate>${velden.map(veldHtml).join('')}`
    + `<p class="login-fout" role="alert" data-fout></p>`
    + `<div class="login-acties">${verstuurTekst ? `<button type="submit" class="btn btn--primary">${escHtml(verstuurTekst)}</button>` : ''}${knoppen}</div></form></div>`;
}

function leesWaarden(form) {
  const uit = {};
  for (const el of form.querySelectorAll('input[name]')) uit[el.name] = el.value; // niet trimmen: de validatie beslist
  return uit;
}

// Eén formulierscherm: versturen (Enter of knop) → `verwerk(waarden)` geeft { fout } of { volgende }; knoppen met
// data-actie lossen op met het scherm uit `acties`. Geeft een belofte met het volgende scherm.
function formScherm(kaart, verwerk, acties = {}) {
  return new Promise((resolve) => {
    const wortel = openOverlay();
    wortel.innerHTML = kaartHtml(kaart);
    const form = wortel.querySelector('form');
    const foutEl = wortel.querySelector('[data-fout]');
    const verstuurKnop = form.querySelector('button[type="submit"]');
    let bezig = false;
    const handlers = {};
    for (const [naam, volgende] of Object.entries(acties)) handlers[naam] = () => { afmelden(); resolve(volgende); };
    const afmelden = registreerActies(wortel, handlers);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (bezig) return;
      bezig = true;
      if (verstuurKnop) verstuurKnop.disabled = true;
      foutEl.textContent = '';
      try {
        const r = await verwerk(leesWaarden(form));
        if (r?.fout) { foutEl.textContent = r.fout; return; }
        afmelden();
        form.reset(); // wachtwoorden niet in het DOM laten staan
        resolve(r.volgende);
      } catch {
        foutEl.textContent = GEEN_VERBINDING;
      } finally {
        bezig = false;
        if (verstuurKnop) verstuurKnop.disabled = false;
      }
    });
    (form.querySelector('input') || wortel.querySelector(FOCUSBAAR))?.focus();
  });
}

// POST naar een auth-eindpunt; zet X-Blitz zelf (de omhulling in kern/api.js doet dat ook).
const post = (pad, body) => apiVerzoek(pad, { methode: 'POST', body, headers: KOP });
// 429 en 503 hebben vaste teksten; een 400 toont de (Nederlandse) validatietekst van de server via textContent.
const serverFout = (r, standaard) => (r.status === 429 ? loginFoutTekst(429, r.data)
  : r.status === 503 ? STORING
    : (r.status === 400 && typeof r.data?.error === 'string' && r.data.error) || standaard);

// ── Schermen ───────────────────────────────────────────────────────────────────────────────────────────────────
function schermInloggen() {
  return formScherm({
    titel: 'Inloggen',
    velden: [
      { naam: 'email', label: 'E-mailadres', type: 'email', autocomplete: 'username' },
      { naam: 'wachtwoord', label: 'Wachtwoord', type: 'password', autocomplete: 'current-password' },
    ],
    verstuurTekst: 'Inloggen',
    extraKnoppen: [{ tekst: 'Wachtwoord vergeten (beheerder)', actie: 'herstel', stijl: 'btn--ghost login-link' }],
  }, async (w) => {
    const v = valideerInlog(w);
    if (v.fout) return { fout: v.fout };
    const r = await post('/api/auth-login', v.waarden);
    if (!r.ok) return { fout: r.status === 401 ? loginFoutTekst(401) : serverFout(r, loginFoutTekst(r.status, r.data)) };
    // Moet het wachtwoord nog gewijzigd worden: meteen in dezelfde overlay (de cookie staat al).
    return { volgende: r.data?.moetWachtwoordWijzigen === true ? { naar: 'wijzigen', verplicht: true } : klaar };
  }, { herstel: { naar: 'herstel' } });
}

function schermSetup() {
  return formScherm({
    titel: 'Beheerder instellen',
    intro: 'Er is nog geen account. Maak het eerste beheerdersaccount aan met de setupcode.',
    velden: [
      { naam: 'setupCode', label: 'Setupcode', type: 'password', autocomplete: 'off' },
      { naam: 'email', label: 'E-mailadres', type: 'email', autocomplete: 'username' },
      { naam: 'naam', label: 'Naam', type: 'text', autocomplete: 'name' },
      { naam: 'wachtwoord', label: 'Wachtwoord (minstens 10 tekens)', type: 'password', autocomplete: 'new-password' },
      { naam: 'herhaal', label: 'Herhaal wachtwoord', type: 'password', autocomplete: 'new-password' },
    ],
    verstuurTekst: 'Beheerder aanmaken',
  }, async (w) => {
    const v = valideerSetup(w);
    if (v.fout) return { fout: v.fout };
    const r = await post('/api/auth-setup', v.waarden);
    if (r.status === 409) return { volgende: { naar: 'login' } }; // intussen is er al een account
    if (!r.ok) return { fout: r.status === 403 ? 'Instellen is niet gelukt. Controleer de setupcode.' : serverFout(r, 'Instellen is niet gelukt.') };
    return { volgende: { naar: 'codes', codes: Array.isArray(r.data?.herstelcodes) ? r.data.herstelcodes : [] } };
  });
}

// Toont de herstelcodes ÉÉN keer. De codes leven enkel in deze closure en in de <pre>; nooit in opslag of URL.
function schermCodes(codes) {
  return new Promise((resolve) => {
    const wortel = openOverlay();
    const tekst = formatHerstelcodes(codes);
    wortel.innerHTML = `<div class="login-kaart"><div class="login-merk">Blitz Planning</div><h2>Bewaar je herstelcodes</h2>`
      + `<p class="login-intro login-niet-afdrukken">Met deze codes kun je je wachtwoord herstellen als je het vergeet. Elke code werkt één keer. `
      + `Je ziet ze hier maar één keer: bewaar ze nu op een veilige plek (bv. in een wachtwoordkluis of afgedrukt).</p>`
      + `<div class="login-print-kop">Blitz Planning, herstelcodes beheerder. Bewaar op een veilige plek.</div>`
      + `<pre class="login-codes" data-codes></pre><p class="login-status login-niet-afdrukken" role="status" data-status></p>`
      + `<div class="login-acties login-niet-afdrukken">`
      + `<button type="button" class="btn btn--secondary" data-actie="kopieer">Kopiëren</button>`
      + `<button type="button" class="btn btn--secondary" data-actie="print">Afdrukken</button>`
      + `<button type="button" class="btn btn--primary" data-actie="bewaard">Ik heb ze bewaard</button></div></div>`;
    const pre = wortel.querySelector('[data-codes]');
    const status = wortel.querySelector('[data-status]');
    pre.textContent = tekst;
    const afmelden = registreerActies(wortel, {
      kopieer: async () => {
        try { await navigator.clipboard.writeText(tekst); status.textContent = 'Gekopieerd naar het klembord.'; }
        catch { status.textContent = 'Kopiëren is niet gelukt. Selecteer de codes en kopieer ze handmatig.'; }
      },
      print: () => {
        document.body.classList.add('login-afdrukken');
        const weg = () => { document.body.classList.remove('login-afdrukken'); window.removeEventListener('afterprint', weg); };
        window.addEventListener('afterprint', weg);
        window.print();
      },
      bewaard: () => { afmelden(); pre.textContent = ''; resolve(klaar); },
    });
    wortel.querySelector('[data-actie="bewaard"]').focus();
  });
}

function schermWijzigen({ verplicht = true } = {}) {
  return formScherm({
    titel: 'Wachtwoord wijzigen',
    intro: verplicht ? 'Je moet je wachtwoord wijzigen voor je verder kunt.' : '',
    velden: [
      { naam: 'huidig', label: 'Huidig wachtwoord', type: 'password', autocomplete: 'current-password' },
      { naam: 'nieuw', label: 'Nieuw wachtwoord (minstens 10 tekens)', type: 'password', autocomplete: 'new-password' },
      { naam: 'herhaal', label: 'Herhaal nieuw wachtwoord', type: 'password', autocomplete: 'new-password' },
    ],
    verstuurTekst: 'Wachtwoord wijzigen',
    extraKnoppen: verplicht ? [] : [{ tekst: 'Annuleren', actie: 'annuleer' }],
  }, async (w) => {
    const v = valideerNieuwWachtwoord(w);
    if (v.fout) return { fout: v.fout };
    const r = await post('/api/auth-wachtwoord', v.waarden);
    if (!r.ok) return { fout: serverFout(r, 'Wachtwoord wijzigen is niet gelukt.') };
    return { volgende: klaar };
  }, verplicht ? {} : { annuleer: klaar });
}

function schermHerstel() {
  return formScherm({
    titel: 'Wachtwoord vergeten (beheerder)',
    intro: 'Enkel voor beheerders. Vul je e-mailadres in, een herstelcode of de noodsleutel, en kies een nieuw wachtwoord.',
    velden: [
      { naam: 'email', label: 'E-mailadres', type: 'email', autocomplete: 'username' },
      { naam: 'bewijs', label: 'Herstelcode of noodsleutel', type: 'password', autocomplete: 'off' },
      { naam: 'nieuw', label: 'Nieuw wachtwoord (minstens 10 tekens)', type: 'password', autocomplete: 'new-password' },
      { naam: 'herhaal', label: 'Herhaal nieuw wachtwoord', type: 'password', autocomplete: 'new-password' },
    ],
    verstuurTekst: 'Wachtwoord herstellen',
    extraKnoppen: [{ tekst: 'Terug naar inloggen', actie: 'terug' }],
  }, async (w) => {
    const v = valideerHerstel(w);
    if (v.fout) return { fout: v.fout };
    const r = await post('/api/auth-herstel', v.waarden);
    if (!r.ok) return { fout: r.status === 401 ? 'Onjuiste herstelgegevens' : serverFout(r, 'Herstellen is niet gelukt.') };
    return { volgende: klaar };
  }, { terug: { naar: 'login' } });
}

function schermGeenVerbinding() {
  return new Promise((resolve) => {
    const wortel = openOverlay();
    wortel.innerHTML = `<div class="login-kaart"><div class="login-merk">Blitz Planning</div><h2>Geen verbinding</h2>`
      + `<p class="login-intro">De server is niet bereikbaar. Controleer je internetverbinding en probeer het opnieuw.</p>`
      + `<div class="login-acties"><button type="button" class="btn btn--primary" data-actie="opnieuw">Opnieuw proberen</button></div></div>`;
    const afmelden = registreerActies(wortel, { opnieuw: () => { afmelden(); resolve(klaar); } });
    wortel.querySelector('[data-actie="opnieuw"]').focus();
  });
}

// ── Schermreeks ─────────────────────────────────────────────────────────────────────────────────────────────────
// Elk scherm lost op met het volgende ({ naar, ... }); 'klaar' sluit de overlay en lost de publieke belofte op.
async function reeks(start) {
  let nu = start;
  for (;;) {
    switch (nu.naar) {
      case 'login': nu = await schermInloggen(); break;
      case 'setup': nu = await schermSetup(); break;
      case 'codes': nu = await schermCodes(nu.codes); break;
      case 'wijzigen': nu = await schermWijzigen(nu); break;
      case 'herstel': nu = await schermHerstel(); break;
      case 'verbinding': nu = await schermGeenVerbinding(); break;
      default: sluitOverlay(); return;
    }
  }
}

export function toonInloggen({ setupNodig = false } = {}) { return reeks({ naar: setupNodig === true ? 'setup' : 'login' }); }
export function toonWachtwoordWijzigen({ verplicht = true } = {}) { return reeks({ naar: 'wijzigen', verplicht }); }
export function toonHerstel() { return reeks({ naar: 'herstel' }); }
export function toonGeenVerbinding() { return reeks({ naar: 'verbinding' }); }

zetInlogUi({ toonInloggen, toonWachtwoordWijzigen, toonGeenVerbinding });
