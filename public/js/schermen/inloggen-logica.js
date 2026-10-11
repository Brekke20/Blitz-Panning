// schermen/inloggen-logica.js — pure validatie en tekst voor de loginschermen (logins T14). Geen DOM, geen fetch.
// De server controleert alles opnieuw; dit zijn de snelle meldingen vóór het verzoek.

const MIN = 10;
const MAX = 200;
const FOUT_EMAIL = 'Vul een geldig e-mailadres in.';
const FOUT_VERPLICHT_WW = 'Vul je wachtwoord in.';

const tekst = (v) => (typeof v === 'string' ? v : '');
const emailVan = (v) => tekst(v).trim();
const heeftEmail = (e) => e.includes('@');

// Lengte- en spatieregel van netlify/lib/wachtwoord.js (beleidsFout), voor een veld met een naam.
function wachtwoordFout(ww) {
  if (ww.length < MIN) return `Het wachtwoord moet minstens ${MIN} tekens bevatten.`;
  if (ww.length > MAX) return `Het wachtwoord mag maximaal ${MAX} tekens bevatten.`;
  if (ww.trim() === '') return 'Het wachtwoord mag niet enkel uit spaties bestaan.';
  return null;
}
const HERHAAL_FOUT = 'De twee wachtwoorden zijn niet gelijk.';

export function valideerInlog({ email, wachtwoord } = {}) {
  const e = emailVan(email);
  if (!heeftEmail(e)) return { fout: FOUT_EMAIL };
  const ww = tekst(wachtwoord);
  if (ww === '') return { fout: FOUT_VERPLICHT_WW };
  return { waarden: { email: e, wachtwoord: ww } }; // wachtwoord nooit trimmen
}

export function valideerNieuwWachtwoord({ huidig, nieuw, herhaal } = {}) {
  const h = tekst(huidig);
  const n = tekst(nieuw);
  if (h === '') return { fout: 'Vul je huidige wachtwoord in.' };
  const fout = wachtwoordFout(n);
  if (fout) return { fout };
  if (n === h) return { fout: 'Het nieuwe wachtwoord moet verschillen van het huidige.' };
  if (tekst(herhaal) !== n) return { fout: HERHAAL_FOUT };
  return { waarden: { huidig: h, nieuw: n } };
}

export function valideerSetup({ setupCode, email, naam, wachtwoord, herhaal } = {}) {
  const code = tekst(setupCode).trim();
  if (code === '') return { fout: 'Vul de setupcode in.' };
  const e = emailVan(email);
  if (!heeftEmail(e)) return { fout: FOUT_EMAIL };
  const n = tekst(naam).trim();
  if (n === '') return { fout: 'Vul je naam in.' };
  const ww = tekst(wachtwoord);
  const fout = wachtwoordFout(ww);
  if (fout) return { fout };
  if (tekst(herhaal) !== ww) return { fout: HERHAAL_FOUT };
  return { waarden: { setupCode: code, email: e, naam: n, wachtwoord: ww } };
}

// bewijs = herstelcode OF noodsleutel, één veld.
export function valideerHerstel({ email, bewijs, nieuw, herhaal } = {}) {
  const e = emailVan(email);
  if (!heeftEmail(e)) return { fout: FOUT_EMAIL };
  const b = tekst(bewijs).trim();
  if (b === '') return { fout: 'Vul een herstelcode of de noodsleutel in.' };
  const n = tekst(nieuw);
  const fout = wachtwoordFout(n);
  if (fout) return { fout };
  if (tekst(herhaal) !== n) return { fout: HERHAAL_FOUT };
  return { waarden: { email: e, bewijs: b, nieuwWachtwoord: n } };
}

const hhmmBrussel = (iso) => {
  const d = new Date(iso);
  if (typeof iso !== 'string' || Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('nl-BE', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Brussels' }).format(d);
};

// Verraadt niets: 401 is altijd dezelfde tekst, ongeacht wat de server meestuurt.
export function loginFoutTekst(status, data) {
  if (status === 401) return 'Onjuist e-mailadres of wachtwoord';
  if (status === 429) {
    const uur = hhmmBrussel(data?.opnieuwOp);
    return uur ? `Te veel pogingen. Probeer opnieuw om ${uur}.` : 'Te veel pogingen. Probeer het later opnieuw.';
  }
  return 'Inloggen mislukt';
}

// Eén regel per code ("1.  XXXX-XXXX"): nummerkolom + codekolom, in een <pre> en bij het afdrukken netjes uitgelijnd.
export function formatHerstelcodes(codes) {
  if (!Array.isArray(codes)) return '';
  return codes.map((c, i) => `${String(i + 1).padStart(2, ' ')}.  ${String(c)}`).join('\n');
}

// ── "Onthoud mij" ───────────────────────────────────────────────────────────────────────────────────────────────
// Enkel het e-mailadres wordt bewaard (nooit het wachtwoord), enkel na een geslaagde login met het vinkje aan. Uitloggen laat
// het staan (dat is de bedoeling van onthouden). Elke opslagfout (geen localStorage, vol, geblokkeerd) wordt stil genegeerd.
export const ONTHOUD_SLEUTEL = 'blitz_onthoud_email';
const standaardOpslag = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };

// -> het bewaarde e-mailadres, of null.
export function leesOnthoudEmail(opslag = standaardOpslag()) {
  try {
    const e = opslag?.getItem(ONTHOUD_SLEUTEL);
    return typeof e === 'string' && heeftEmail(e.trim()) ? e.trim() : null;
  } catch { return null; }
}

// Vinkje aan + geldig adres: bewaren; vinkje uit: wissen. Geeft true als er na afloop een adres bewaard staat.
export function bewaarOnthoudEmail(email, onthoud, opslag = standaardOpslag()) {
  try {
    const e = emailVan(email);
    if (onthoud === true && heeftEmail(e)) { opslag.setItem(ONTHOUD_SLEUTEL, e); return true; }
    opslag.removeItem(ONTHOUD_SLEUTEL);
  } catch { /* geen opslag: stil negeren */ }
  return false;
}
