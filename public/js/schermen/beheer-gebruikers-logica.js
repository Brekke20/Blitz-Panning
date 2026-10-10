// schermen/beheer-gebruikers-logica.js — pure logica van de tab Gebruikers (logins T17). Geen DOM, geen fetch.
// De validatie spiegelt netlify/lib/gebruikers.js (valideerNieuweGebruiker): dit zijn de snelle meldingen vóór het
// verzoek; de server controleert alles opnieuw en beslist (ook over de laatste actieve beheerder).

export const ROLLEN = ['beheerder', 'planner', 'technieker', 'sales'];
const ROL_LABELS = { beheerder: 'Beheerder', planner: 'Planner', technieker: 'Technieker', sales: 'Sales' };
const MAX_NAAM = 100;
const MAX_EMAIL = 254;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const tekst = (v) => (typeof v === 'string' ? v : '');
const vergelijk = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), 'nl', { sensitivity: 'base' });

export function rolLabel(rol) {
  return ROL_LABELS[rol] ?? String(rol ?? '');
}

// Actieve gebruikers eerst, daarna op naam (zonder hoofdlettergevoeligheid); geeft een nieuwe lijst.
export function sorteerGebruikers(lijst) {
  if (!Array.isArray(lijst)) return [];
  return lijst.filter(Boolean).map((g, i) => ({ g, i }))
    .sort((a, b) => (Number(b.g.actief === true) - Number(a.g.actief === true)) || vergelijk(a.g.naam, b.g.naam) || (a.i - b.i))
    .map(x => x.g);
}

const normaliseerNaam = (n) => tekst(n).trim().toLowerCase().replace(/\s+/g, ' ');

// Het account (uit de lijst van de server) dat deze Zoho-naam al gebruikt, genormaliseerd; `behalveId` telt niet mee. Spiegelt
// zohoNaamBezet in netlify/lib/gebruikers.js (de server weigert een dubbele naam met 409).
export function zohoNaamBezetDoor(gebruikers, zohoNaam, behalveId) {
  const gezocht = normaliseerNaam(zohoNaam);
  if (gezocht === '' || !Array.isArray(gebruikers)) return null;
  return gebruikers.find(g => g && g.id !== behalveId && normaliseerNaam(g.zohoNaam) === gezocht) ?? null;
}

// `rol` mag ook in `invoer.rol` staan. `opties.gebruikers` (de lijst van de server) en `opties.id` (het account dat bewerkt wordt)
// laten de dubbele Zoho-naam vooraf melden. Een `email`-sleutel in `invoer` wordt gevalideerd en teruggegeven (nieuwe
// gebruiker); zonder die sleutel (bewerken: het e-mailadres is niet wijzigbaar) blijft het e-mailadres buiten beeld.
// -> { fout } | { waarden }
export function valideerGebruikerFormulier(invoer, rol, opties = {}) {
  if (!invoer || typeof invoer !== 'object') return { fout: 'Ongeldige invoer.' };
  const gekozen = rol ?? invoer.rol;
  const waarden = {};
  if ('email' in invoer) {
    const email = tekst(invoer.email).trim().toLowerCase();
    if (!email || email.length > MAX_EMAIL || !EMAIL_RE.test(email)) return { fout: 'Geef een geldig e-mailadres op.' };
    waarden.email = email;
  }
  const naam = tekst(invoer.naam).trim();
  if (!naam) return { fout: 'Naam is verplicht.' };
  if (naam.length > MAX_NAAM) return { fout: `De naam mag maximaal ${MAX_NAAM} tekens bevatten.` };
  if (!ROLLEN.includes(gekozen)) return { fout: 'Kies een rol.' };
  waarden.naam = naam;
  waarden.rol = gekozen;
  // Zoho-naam: verplicht voor een technieker, optioneel voor beheerder en planner (voert zelf interventies uit), nooit voor sales.
  if (gekozen !== 'sales') {
    const zohoNaam = tekst(invoer.zohoNaam).trim();
    if (!zohoNaam && gekozen === 'technieker') return { fout: 'Een technieker heeft een Zoho-naam nodig.' };
    if (zohoNaam.length > MAX_NAAM) return { fout: `De Zoho-naam mag maximaal ${MAX_NAAM} tekens bevatten.` };
    const bezet = zohoNaamBezetDoor(opties.gebruikers, zohoNaam, opties.id);
    if (bezet) return { fout: `Deze Zoho-naam is al gekoppeld aan ${bezet.naam}. Kies een andere naam of ontkoppel eerst dat account.` };
    if (zohoNaam) waarden.zohoNaam = zohoNaam;
  }
  // "Mag zelf plannen": enkel een technieker; hij plant en stuurt voorstellen dan voor zijn eigen tickets (de server dwingt dat af).
  if (gekozen === 'technieker') waarden.magZelfPlannen = invoer.magZelfPlannen === true;
  if (gekozen === 'sales') {
    const salesNaam = tekst(invoer.salesNaam).trim();
    if (!salesNaam) return { fout: 'Een verkoper heeft een naam in de export nodig.' };
    waarden.salesNaam = salesNaam;
    waarden.magAlleSales = invoer.magAlleSales === true;
  }
  return { waarden };
}

// Unieke, niet-lege assignees uit de ticketlijsten, plus de huidige waarde, gesorteerd.
export function zohoNaamOpties(tickets, huidige) {
  const namen = new Set();
  for (const t of Array.isArray(tickets) ? tickets : []) {
    const naam = tekst(t?.assignee).trim();
    if (naam) namen.add(naam);
  }
  const nu = tekst(huidige).trim();
  if (nu) namen.add(nu);
  return [...namen].sort(vergelijk);
}

// De waarde van de keuzelijst Zoho-naam voor "een andere naam" (vrij tekstveld); komt nooit als naam naar de server.
export const ZOHO_ANDERE = '__andere__';

// Keuzes voor de lijst Zoho-naam: de actieve Zoho-agenten (`agenten`: [{ naam }] van /api/zoho-agenten) plus de huidige waarde van dit
// account als die er niet in staat, gesorteerd. `bezetDoor` = de naam van het ANDERE account dat die Zoho-naam al gebruikt, anders null
// (zo'n keuze is niet te kiezen: één Zoho-naam hoort bij één account). `behalveId` = het account dat bewerkt wordt.
export function zohoNaamKeuzes({ agenten, huidige, gebruikers, behalveId } = {}) {
  const namen = new Map(); // genormaliseerd -> naam zoals getoond
  const voegToe = (naam) => {
    const n = tekst(naam).trim();
    if (n && !namen.has(normaliseerNaam(n))) namen.set(normaliseerNaam(n), n);
  };
  for (const a of Array.isArray(agenten) ? agenten : []) voegToe(typeof a === 'string' ? a : a?.naam);
  voegToe(huidige);
  return [...namen.values()].sort(vergelijk)
    .map(naam => ({ naam, bezetDoor: zohoNaamBezetDoor(gebruikers, naam, behalveId)?.naam ?? null }));
}

const isActieveBeheerder = (g) => g?.rol === 'beheerder' && g.actief === true;

// Spiegelt de laatste-beheerder-regel van de server (kanWijzigen) voor de knop; de server beslist.
export function kanBlokkeren(gebruikers, id) {
  if (!Array.isArray(gebruikers)) return false;
  const doel = gebruikers.find(g => g && g.id === id);
  if (!doel) return false;
  if (!isActieveBeheerder(doel)) return true;
  return gebruikers.some(g => g && g.id !== id && isActieveBeheerder(g));
}

// Spiegelt kanVerwijderen van de server voor de knop (de server beslist): enkel een geblokkeerde gebruiker, nooit jezelf, en er blijft
// een actieve beheerder over.
export function kanVerwijderen(gebruikers, id, eigenId) {
  if (!Array.isArray(gebruikers)) return false;
  const doel = gebruikers.find(g => g && g.id === id);
  if (!doel || doel.actief === true || id === eigenId) return false;
  return gebruikers.some(g => g && g.id !== id && isActieveBeheerder(g));
}

// De tekst van het bevestigingsvenster voor het verwijderen, in gewone taal. Een verkoper krijgt de extra waarschuwing over zijn leads.
export function verwijderUitleg(gebruiker) {
  const naam = tekst(gebruiker?.naam);
  const alinea = [
    `${naam} wordt definitief verwijderd. ${naam} kan dan niet meer inloggen en zijn of haar instellingen worden gewist. Dit kan niet ongedaan gemaakt worden.`,
    'Rapporten en tickets blijven bewaard. Het activiteitenlogboek blijft ook: de bestaande regels blijven staan en de verwijdering komt er als nieuwe regel bij.',
  ];
  if (gebruiker?.rol === 'sales') alinea.push('Zijn leads en planning worden ook verwijderd. Wil je die bewaren, laat hem dan geblokkeerd.');
  return alinea;
}

// Is de ingetikte naam gelijk aan de naam van de gebruiker? Spaties aan de rand en hoofdletters tellen niet mee.
export function naamKomtOver(ingetikt, naam) {
  const norm = (w) => (typeof w === 'string' ? w.trim().replace(/\s+/g, ' ').toLowerCase() : '');
  return norm(naam) !== '' && norm(ingetikt) === norm(naam);
}

export function formatLaatsteLogin(iso) {
  const d = new Date(iso);
  if (typeof iso !== 'string' || Number.isNaN(d.getTime())) return 'Nooit';
  return new Intl.DateTimeFormat('nl-BE', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Brussels',
  }).format(d).replace(',', '');
}
