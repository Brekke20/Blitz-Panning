// schermen/gebruikersmenu.js — het gebruikersmenu in de kop, na ⚙ (logins T15): naam en rol van wie ingelogd is,
// 'Wachtwoord wijzigen' en 'Uitloggen'. Geen item voor Beheer: dat is de tab Beheer (geen dubbele ingang).
// Veiligheid: de naam en rol komen enkel via textContent in de DOM (nooit innerHTML).
import { registreerActies } from '../kern/ui.js';
import { afmelden } from '../kern/sessie.js';
import { heeftVuileInstellingen } from '../kern/instellingen-sync.js';
import { appConfirm } from '../app-dialog.js';
import { toonWachtwoordWijzigen } from './inloggen.js';

const ROL_LABEL = { beheerder: 'Beheerder', planner: 'Planner', technieker: 'Technieker', sales: 'Sales' };
const WRAPPER_ID = 'gebruiker-sel';

let wortel = null;
let afmeldActies = null;

const rolLabel = (rol) => ROL_LABEL[rol] || String(rol ?? '');

// Voorletters voor de knop: eerste letter van maximaal twee woorden van de naam.
function voorletters(naam) {
  const delen = String(naam ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return (delen.map(d => Array.from(d)[0]).join('') || '?').toUpperCase();
}

function el(tag, klasse, tekst) {
  const e = document.createElement(tag);
  if (klasse) e.className = klasse;
  if (tekst !== undefined) e.textContent = tekst;
  return e;
}

function menuItem(actie, tekst) {
  const b = el('button', 'pm-item gm-item', tekst);
  b.type = 'button';
  b.setAttribute('role', 'menuitem');
  b.dataset.actie = actie;
  return b;
}

function zetOpen(open) {
  if (!wortel) return;
  wortel.querySelector('.gebruiker-menu')?.classList.toggle('open', open);
  wortel.querySelector('.gebruiker-btn')?.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function opDocumentKlik(e) { if (wortel && !wortel.contains(e.target)) zetOpen(false); }
function opToets(e) {
  if (e.key !== 'Escape' || !wortel?.querySelector('.gebruiker-menu.open')) return;
  zetOpen(false);
  wortel.querySelector('.gebruiker-btn')?.focus();
}

// Afmelden, maar eerst een waarschuwing als er instellingen zijn die nog niet naar de server gingen: afmelden wist de lokale cache,
// dus die wijzigingen gaan dan verloren (logins T16). Annuleren = ingelogd blijven.
async function meldAf() {
  if (heeftVuileInstellingen(globalThis.localStorage)) {
    const ok = await appConfirm({
      titel: 'Instellingen nog niet opgeslagen',
      tekst: 'Er zijn instellingen die nog niet naar de server gingen. Als je nu afmeldt, gaan ze verloren. Toch afmelden?',
      bevestigLabel: 'Toch afmelden', annuleerLabel: 'Terug', gevaar: true,
    });
    if (!ok) return;
  }
  afmelden();
}

// Bouwt de knop en het menu (of bouwt ze opnieuw voor een andere gebruiker); veilig om meerdere keren aan te roepen.
export function toonGebruikersmenu(gebruiker) {
  const kop = document.querySelector('header');
  if (!kop || !gebruiker) return;
  if (wortel) { afmeldActies?.(); wortel.remove(); }
  wortel = el('div', 'gebruiker-sel');
  wortel.id = WRAPPER_ID;

  const knop = el('button', 'hbtn gebruiker-btn', voorletters(gebruiker.naam));
  knop.type = 'button';
  knop.dataset.actie = 'gebruiker-menu';
  knop.title = 'Gebruikersmenu';
  knop.setAttribute('aria-label', `Gebruikersmenu van ${String(gebruiker.naam ?? '')}`);
  knop.setAttribute('aria-haspopup', 'menu');
  knop.setAttribute('aria-expanded', 'false');

  const menu = el('div', 'gebruiker-menu');
  menu.setAttribute('role', 'menu');
  const hoofd = el('div', 'gm-kop');
  hoofd.append(el('div', 'gm-naam', String(gebruiker.naam ?? '')), el('div', 'gm-rol', rolLabel(gebruiker.rol)));
  menu.append(hoofd, menuItem('gebruiker-wachtwoord', 'Wachtwoord wijzigen'));
  menu.append(menuItem('gebruiker-uitloggen', 'Uitloggen'));
  wortel.append(knop, menu);

  const instellingen = kop.querySelector('[data-actie="instellingen"]');
  if (instellingen) instellingen.insertAdjacentElement('afterend', wortel); else kop.appendChild(wortel);

  afmeldActies = registreerActies(wortel, {
    'gebruiker-menu': () => zetOpen(!menu.classList.contains('open')),
    'gebruiker-wachtwoord': () => { zetOpen(false); toonWachtwoordWijzigen({ verplicht: false }); },
    'gebruiker-uitloggen': () => { zetOpen(false); meldAf(); },
  });
  // Eén keer per document: buiten klikken en Escape sluiten het menu.
  document.removeEventListener('click', opDocumentKlik);
  document.removeEventListener('keydown', opToets);
  document.addEventListener('click', opDocumentKlik);
  document.addEventListener('keydown', opToets);
}
