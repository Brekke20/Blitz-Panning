// Techniekers van het performance-dashboard: een rapport hangt aan Zoho-namen, niet aan de vrije tekst in het rapport.
// Puur (geen I/O). Volgorde van de koppeling per rapport:
//   1. ingediendDoor -> account -> zohoNaam (planner/beheerder die een rapport voor een ander indienen: dan wint de tekst, zodra die
//      eenduidig op een Zoho-naam past). Staat er meerdere namen in de tekst ("Brent + Deniz"), dan komen de eenduidige namen erbij.
//   2. anders de vrije tekst: splitsen op + & , ; / " en ", per stuk normaliseren (kleine letters, geen accenten, geen punten of spaties)
//      en matchen op volledige naam, daarna op voornaam, achternaam of initiaal + achternaam. Enkel een eenduidige match telt.
//   3. dubbelzinnig of geen match -> 'Niet gekoppeld' (één verzamelwaarde); de originele stukken blijven bewaard voor de uitleg.
// Zonder enige bron (geen Zoho-agenten en geen accounts met zohoNaam) geeft maakKoppelaar null: dan geldt de ruwe tekst, zoals vroeger.

export const NIET_GEKOPPELD = 'Niet gekoppeld';

const tekst = v => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());
const normaliseer = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const ZELF_REGELT = new Set(['planner', 'beheerder']);

// "Brent + Deniz", "K.Deniz & Roel", "Tim en Sven" -> losse stukken (getrimd, zonder lege).
export function splitsNamen(invoer) {
  return String(invoer ?? '').split(/\s*[+&,;/]\s*|\s+(?:en|and)\s+/i).map(s => s.trim()).filter(Boolean);
}

// Zoeksleutels van één naam: volledige naam, en (bij minstens twee delen) voornaam, achternaam, laatste deel, initiaal + achternaam.
function sleutelsVan(naam) {
  const delen = tekst(naam).split(/\s+/).map(normaliseer).filter(Boolean);
  if (!delen.length) return null;
  const uit = { volledig: delen.join(''), deel: new Set() };
  if (delen.length >= 2) {
    const rest = delen.slice(1).join(''), laatste = delen[delen.length - 1], voor = delen[0];
    for (const s of [voor, rest, laatste, voor[0] + rest, voor[0] + laatste]) uit.deel.add(s);
  }
  return uit;
}

// bron: { agenten: string[] | null, accounts: [{ id, zohoNaam?, rol? }] | null } -> (entry) => koppeling, of null zonder bron.
// koppeling = { namen: [Zoho-namen], onbekend: [ruwe stukken zonder eenduidige match], groepen: [namen..., 'Niet gekoppeld'?] }.
export function maakKoppelaar({ agenten, accounts } = {}) {
  const kandidaten = new Map(); // volledige genormaliseerde naam -> weergavenaam (agenten eerst: hun spelling wint)
  const voegToe = naam => {
    const n = tekst(naam), s = sleutelsVan(n);
    if (s && !kandidaten.has(s.volledig)) kandidaten.set(s.volledig, n);
  };
  for (const a of Array.isArray(agenten) ? agenten : []) voegToe(a);
  const perId = new Map();
  for (const a of Array.isArray(accounts) ? accounts : []) {
    const zoho = tekst(a?.zohoNaam);
    if (!a || a.id == null || !zoho) continue;
    voegToe(zoho);
    perId.set(String(a.id), { zohoNaam: zoho, rol: a.rol });
  }
  if (!kandidaten.size) return null;
  const lijst = [...kandidaten.values()].map(naam => ({ naam, ...sleutelsVan(naam) }));
  const canoniek = naam => kandidaten.get(sleutelsVan(naam)?.volledig) ?? tekst(naam);

  function zoekStuk(stuk) {
    const n = normaliseer(stuk);
    if (!n) return { leeg: true };
    const volledig = lijst.filter(k => k.volledig === n);
    if (volledig.length) return volledig.length === 1 ? { naam: volledig[0].naam } : { onbekend: true };
    const deel = lijst.filter(k => k.deel.has(n));
    return deel.length === 1 ? { naam: deel[0].naam } : { onbekend: true };
  }
  function leesTekst(ruw) {
    const namen = [], onbekend = [];
    const stukken = splitsNamen(ruw);
    for (const stuk of stukken) {
      const r = zoekStuk(stuk);
      if (r.leeg) continue;
      if (r.naam) { if (!namen.includes(r.naam)) namen.push(r.naam); } else onbekend.push(stuk);
    }
    return { namen, onbekend, stukken: stukken.length };
  }
  const afronden = (namen, onbekend) => ({
    namen, onbekend, groepen: namen.length && !onbekend.length ? namen : [...namen, NIET_GEKOPPELD],
  });

  return function koppel(entry) {
    const ruw = tekst(entry?.technieker);
    const uitTekst = leesTekst(ruw);
    const account = entry?.ingediendDoor != null && entry.ingediendDoor !== '' ? perId.get(String(entry.ingediendDoor)) : undefined;
    if (account && !(ZELF_REGELT.has(account.rol) && uitTekst.namen.length)) {
      const eigen = canoniek(account.zohoNaam);
      const namen = [eigen];
      if (uitTekst.stukken > 1) for (const n of uitTekst.namen) if (!namen.includes(n)) namen.push(n);
      return afronden(namen, []);
    }
    return afronden(uitTekst.namen, uitTekst.onbekend.length || uitTekst.namen.length ? uitTekst.onbekend : (ruw ? [ruw] : []));
  };
}

// De groepen (technieker-sleutels) van een genormaliseerd rapport; zonder koppeling de ruwe tekst. Leeg = nergens op te hangen.
export function techniekerGroepen(r) {
  if (Array.isArray(r?.techniekers)) return r.techniekers;
  return r?.technieker ? [r.technieker] : [];
}
