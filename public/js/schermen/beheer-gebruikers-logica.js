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

// `rol` mag ook in `invoer.rol` staan. Een `email`-sleutel in `invoer` wordt gevalideerd en teruggegeven (nieuwe
// gebruiker); zonder die sleutel (bewerken: het e-mailadres is niet wijzigbaar) blijft het e-mailadres buiten beeld.
// -> { fout } | { waarden }
export function valideerGebruikerFormulier(invoer, rol) {
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
  if (gekozen === 'technieker') {
    const zohoNaam = tekst(invoer.zohoNaam).trim();
    if (!zohoNaam) return { fout: 'Een technieker heeft een Zoho-naam nodig.' };
    waarden.zohoNaam = zohoNaam;
  }
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

const isActieveBeheerder = (g) => g?.rol === 'beheerder' && g.actief === true;

// Spiegelt de laatste-beheerder-regel van de server (kanWijzigen) voor de knop; de server beslist.
export function kanBlokkeren(gebruikers, id) {
  if (!Array.isArray(gebruikers)) return false;
  const doel = gebruikers.find(g => g && g.id === id);
  if (!doel) return false;
  if (!isActieveBeheerder(doel)) return true;
  return gebruikers.some(g => g && g.id !== id && isActieveBeheerder(g));
}

export function formatLaatsteLogin(iso) {
  const d = new Date(iso);
  if (typeof iso !== 'string' || Number.isNaN(d.getTime())) return 'Nooit';
  return new Intl.DateTimeFormat('nl-BE', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Brussels',
  }).format(d).replace(',', '');
}
