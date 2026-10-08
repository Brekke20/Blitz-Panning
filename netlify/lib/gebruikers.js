// Gebruikersopslag: blob `gebruikers` = { versie, gebruikers: [Gebruiker] }.
// `laatsteLogin` staat bewust NIET hier maar in de blob `login-laatst`: een login herschrijft `gebruikers`
// nooit, zodat die een gelijktijdige blokkering of rolwijziging niet ongedaan kan maken.
import { randomBytes } from 'node:crypto';
import { wijzigBlob } from './blob-wijzig.js';

export const ROLLEN_LIJST = ['beheerder', 'planner', 'technieker', 'sales'];

const GEBRUIKERS = 'gebruikers';
const LAATSTE_LOGIN = 'login-laatst';
const MAX_NAAM = 100;
const MAX_EMAIL = 254;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normaliseerEmail = e => String(e ?? '').trim().toLowerCase();
export const normaliseerNaam = n => String(n ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

export function nieuwId() {
  return 'u-' + randomBytes(6).toString('hex');
}

export async function leesGebruikers(store) {
  const blob = await store.get(GEBRUIKERS, { type: 'json' });
  return Array.isArray(blob?.gebruikers) ? blob.gebruikers : [];
}

// Enkel de velden die de client mag zien; nooit hashes, herstelcodes of sessieVersie.
export function publiek(g) {
  const p = { id: g.id, email: g.email, naam: g.naam, rol: g.rol };
  if (g.zohoNaam !== undefined) p.zohoNaam = g.zohoNaam;
  if (g.salesNaam !== undefined) p.salesNaam = g.salesNaam;
  if (g.magAlleSales !== undefined) p.magAlleSales = g.magAlleSales;
  return p;
}

export function beheerWeergave(g, laatsteLogin = null) {
  return {
    ...publiek(g),
    actief: Boolean(g.actief),
    laatsteLogin: laatsteLogin ?? null,
    aangemaakt: g.aangemaakt ?? null,
    moetWachtwoordWijzigen: Boolean(g.moetWachtwoordWijzigen),
  };
}

export function valideerNieuweGebruiker(invoer) {
  if (!invoer || typeof invoer !== 'object') return { fout: 'Ongeldige invoer.' };
  const email = normaliseerEmail(invoer.email);
  if (!email || email.length > MAX_EMAIL || !EMAIL_RE.test(email)) return { fout: 'Geef een geldig e-mailadres op.' };
  const naam = String(invoer.naam ?? '').trim();
  if (!naam) return { fout: 'Naam is verplicht.' };
  if (naam.length > MAX_NAAM) return { fout: `De naam mag maximaal ${MAX_NAAM} tekens bevatten.` };
  const rol = invoer.rol;
  if (!ROLLEN_LIJST.includes(rol)) return { fout: 'Onbekende rol.' };
  const waarden = { email, naam, rol };
  if (rol === 'technieker') {
    const zohoNaam = String(invoer.zohoNaam ?? '').trim();
    if (!zohoNaam) return { fout: 'Een technieker heeft een Zoho-naam nodig.' };
    waarden.zohoNaam = zohoNaam;
  }
  if (rol === 'sales') {
    const salesNaam = String(invoer.salesNaam ?? '').trim();
    if (!salesNaam) return { fout: 'Een verkoper heeft een verkopersnaam nodig.' };
    waarden.salesNaam = salesNaam;
    waarden.magAlleSales = invoer.magAlleSales === true;
  }
  return { waarden };
}

// Pure wijziging van één gebruiker (PATCH). `invoer` bevat enkel de velden die mogen veranderen
// (naam, rol, actief, zohoNaam, salesNaam, magAlleSales); alles anders in de body wordt genegeerd.
// Validatie hergebruikt valideerNieuweGebruiker op de samengevoegde waarden, zodat de rolvelden altijd
// kloppen (technieker heeft een zohoNaam, sales een salesNaam) en velden van een vorige rol verdwijnen.
// -> { fout } | { nieuw, gewijzigd: [veldnaam], blokkeert, rolWijzigt, promotie }
// `sessieVersie` stijgt bij blokkeren en bij een rolwijziging (onmiddellijk uitloggen). `herstelcodes` blijven
// enkel bij een beheerder bestaan; nieuwe codes bij een promotie zet de aanroeper (async hashing).
export function pasWijzigingToe(huidig, invoer) {
  if (!invoer || typeof invoer !== 'object') return { fout: 'Ongeldige invoer.' };
  for (const veld of ['naam', 'rol', 'zohoNaam', 'salesNaam']) {
    if (invoer[veld] !== undefined && typeof invoer[veld] !== 'string') return { fout: `Ongeldige waarde voor ${veld}.` };
  }
  for (const veld of ['actief', 'magAlleSales']) {
    if (invoer[veld] !== undefined && typeof invoer[veld] !== 'boolean') return { fout: `Ongeldige waarde voor ${veld}.` };
  }
  const gekozen = (veld) => (invoer[veld] !== undefined ? invoer[veld] : huidig[veld]);
  const v = valideerNieuweGebruiker({
    email: 'intern@intern.test', // het e-mailadres is niet wijzigbaar: enkel een geldige plaatshouder voor de validatie
    naam: gekozen('naam'), rol: gekozen('rol'),
    zohoNaam: gekozen('zohoNaam'), salesNaam: gekozen('salesNaam'), magAlleSales: gekozen('magAlleSales'),
  });
  if (v.fout) return { fout: v.fout };
  const { naam, rol, zohoNaam, salesNaam, magAlleSales } = v.waarden;
  const nieuw = { ...huidig };
  delete nieuw.zohoNaam; delete nieuw.salesNaam; delete nieuw.magAlleSales;
  Object.assign(nieuw, { naam, rol });
  if (zohoNaam !== undefined) nieuw.zohoNaam = zohoNaam;
  if (salesNaam !== undefined) nieuw.salesNaam = salesNaam;
  if (magAlleSales !== undefined) nieuw.magAlleSales = magAlleSales;
  if (invoer.actief !== undefined) nieuw.actief = invoer.actief;
  if (rol !== 'beheerder') delete nieuw.herstelcodes;
  const gewijzigd = ['naam', 'rol', 'actief', 'zohoNaam', 'salesNaam', 'magAlleSales'].filter(veld => huidig[veld] !== nieuw[veld]);
  const blokkeert = huidig.actief === true && nieuw.actief === false;
  const rolWijzigt = huidig.rol !== rol;
  const promotie = rolWijzigt && rol === 'beheerder';
  if (blokkeert || rolWijzigt) nieuw.sessieVersie = (huidig.sessieVersie ?? 0) + 1;
  return { nieuw, gewijzigd, blokkeert, rolWijzigt, promotie };
}

const isActieveBeheerder = g => g.rol === 'beheerder' && g.actief === true;

// Aanroepen binnen de wijzigGebruikers-callback, op de lijst die die callback ontvangt (niet op een eerder gelezen kopie).
// De laatste actieve beheerder mag niet geblokkeerd of gedegradeerd worden (anders sluit het systeem zichzelf buiten).
export function kanWijzigen(gebruikers, id, wijziging = {}) {
  const doel = gebruikers.find(g => g.id === id);
  if (!doel) return { ok: false, fout: 'Gebruiker niet gevonden.' };
  if (isActieveBeheerder(doel)) {
    const blokkeert = wijziging.actief === false;
    const degradeert = wijziging.rol !== undefined && wijziging.rol !== 'beheerder';
    if ((blokkeert || degradeert) && !gebruikers.some(g => g.id !== id && isActieveBeheerder(g))) {
      return { ok: false, fout: 'Dit is de enige actieve beheerder: die kan niet geblokkeerd of van rol veranderd worden.' };
    }
  }
  return { ok: true };
}

// wijzig(gebruikers) -> nieuwe array | null (null = niets doen)
export async function wijzigGebruikers(store, wijzig) {
  const r = await wijzigBlob(store, GEBRUIKERS, {
    leeg: { versie: 0, gebruikers: [] },
    wijzig: blob => {
      const nieuw = wijzig(blob.gebruikers);
      return nieuw == null ? null : { ...blob, gebruikers: nieuw };
    },
  });
  return { ok: r.ok, gebruikers: r.waarde?.gebruikers ?? [] };
}

export async function leesLaatsteLogins(store) {
  const blob = await store.get(LAATSTE_LOGIN, { type: 'json' });
  return blob && typeof blob === 'object' && !Array.isArray(blob) ? blob : {};
}

export async function schrijfLaatsteLogin(store, gebruikerId, iso) {
  await wijzigBlob(store, LAATSTE_LOGIN, { leeg: {}, wijzig: map => ({ ...map, [gebruikerId]: iso }) });
}
