// schermen/persoonskiezer-logica.js — de lijst van de persoonskiezer in de kop (kop B, taak 1), als pure functie (geen DOM, geen opslag).
// Eén plek voor alle rollen: wie staat er in het menu, wat zegt de knop, wie is "jij", wat is "Alle". De tekenmodule
// (persoonskiezer.js) tekent enkel wat hier uitkomt.
// Privacy: de uitvoer bevat per persoon enkel { soort, sleutel, naam, rol, rolLabel, extra, actief, jij, huidig, sub }; een e-mailadres of een
// ander veld van de gebruikerslijst wordt NOOIT overgenomen (eenheidstest). De server stuurt het mee aan de beheerder, de kiezer negeert het.
//
// Rollen (zie het ontwerp §2.2):
//   technieker      "👤 Planning: Tim"  alle namen uit de tickets en zichzelf; geen "Alle technici"
//   planner         "👤 Planning: Alle" "Alle technici" + de namen uit de tickets (en zichzelf bij een Zoho-naam)
//   gewone verkoper geen kiezer
//   sales manager   "👥 Sales: An"      alle (actieve) verkopers, de eigen naam met "(jij)"; nooit "Alle"
//   beheerder       "👤 Planning: Tim" of "👥 Sales: An"; twee groepen (Techniek, Sales) met de rol achter elke naam

export const normaalNaam = (n) => String(n ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
export const voornaam = (n) => String(n ?? '').trim().split(/\s+/)[0] || '';

const vergelijk = (a, b) => String(a).localeCompare(String(b), 'nl', { sensitivity: 'base' });

const ROL_LABEL = Object.freeze({ beheerder: 'beheerder', planner: 'planner', technieker: 'technieker' });

/** Initialen voor het avatarrondje: 'A' voor "Alle", anders de eerste letters van maximaal twee woorden. */
export function initialen(naam) {
  if (!naam || naam === 'all') return 'A';
  return String(naam).split(/\s+/).filter(Boolean).map(n => Array.from(n)[0]).join('').toUpperCase().slice(0, 2) || '?';
}

// Een techniekernaam (Zoho-naam) als menu-item. Sleutel = de Zoho-naam zoals hij in de tickets staat (de filter vergelijkt hem letterlijk).
function technieker(naam, { eigen, gekozen, rol, extra, metRol }) {
  const jij = eigen !== '' && normaalNaam(naam) === normaalNaam(eigen);
  const rolLabel = metRol ? (rol || 'technieker') : '';
  return {
    soort: 'technieker', sleutel: naam, naam, rol: rol || '', rolLabel, extra: extra || '', actief: true, jij,
    huidig: normaalNaam(gekozen) === normaalNaam(naam) && gekozen !== 'all',
    sub: metRol ? [rolLabel, extra].filter(Boolean).join(' · ') : 'Persoonlijke planning',
  };
}

function alleItem(gekozen) {
  return { soort: 'alle', sleutel: 'all', naam: 'Alle technici', rol: '', rolLabel: '', extra: '', actief: true, jij: false, huidig: gekozen === 'all', sub: 'Gecombineerde weergave' };
}

// Een verkoper als menu-item. Sleutel = het gebruikers-id.
function verkoper(v, { ikId, gekozenId, metRol }) {
  const actief = v.actief !== false;
  const rolLabel = metRol ? (v.salesManager === true ? 'sales manager' : 'verkoper') : '';
  const extra = actief ? '' : 'geblokkeerd (alleen lezen)';
  return {
    soort: 'verkoper', sleutel: v.id, naam: v.naam || v.salesNaam || '', rol: 'sales', rolLabel, extra, actief,
    jij: Boolean(ikId) && v.id === ikId, huidig: v.id === gekozenId,
    sub: metRol ? [rolLabel, extra].filter(Boolean).join(' · ') : (actief ? 'Verkoper' : extra),
  };
}

// De techniekersnamen: tickets, de eigen naam en (beheerder) de accounts met een Zoho-naam, ongevoelig voor hoofdletters en spaties.
function techniekNamen({ ticketNamen, eigen, gebruikers, beheerder }) {
  const gezien = new Map(); // normaal -> naam (de eerste schrijfwijze wint: die van de tickets)
  const voegToe = (n) => {
    const naam = String(n ?? '').trim();
    if (naam && !gezien.has(normaalNaam(naam))) gezien.set(normaalNaam(naam), naam);
  };
  for (const n of ticketNamen || []) voegToe(n);
  voegToe(eigen);
  if (beheerder && Array.isArray(gebruikers)) {
    for (const g of gebruikers) if (g && g.rol !== 'sales' && typeof g.zohoNaam === 'string') voegToe(g.zohoNaam);
  }
  return [...gezien.values()].sort(vergelijk);
}

/**
 * Berekent wat de persoonskiezer toont.
 * @param {object} p
 * @param {string} p.rol                  'technieker' | 'planner' | 'beheerder' | 'sales'
 * @param {object} [p.rechten]            { plannen, beheer, alleSales } (uit sessie.js)
 * @param {string[]} [p.ticketNamen]      de Zoho-toegewezenen uit de tickets
 * @param {string} [p.eigen]              de eigen Zoho-naam ('' als er geen is)
 * @param {object[]|null} [p.gebruikers]  de volledige gebruikerslijst (enkel beheerder; null = niet (geladen)); enkel naam, rol, zohoNaam worden gelezen
 * @param {object[]} [p.verkopers]        [{ id, naam, actief, salesManager? }] (sales manager en beheerder)
 * @param {boolean} [p.verkopersFout]     de verkopers konden niet geladen worden
 * @param {'techniek'|'sales'} [p.werkruimte]
 * @param {string} [p.gekozenTechnieker]  'all' of een Zoho-naam
 * @param {string|null} [p.gekozenVerkoper]  een gebruikers-id
 * @param {string|null} [p.ikId]          het id van de ingelogde gebruiker
 * @param {boolean} [p.metSales]          mag de beheerder een verkoper kiezen (de groep Sales)? (false: enkel de techniekers)
 * @returns {{ zichtbaar:boolean, werkruimte:string, knop:object|null, groepen:{titel:string|null,items:object[]}[], terug:object|null, melding:string|null }}
 */
export function kiezerLijst({
  rol, rechten = {}, ticketNamen = [], eigen = '', gebruikers = null, verkopers = [], verkopersFout = false,
  werkruimte = 'techniek', gekozenTechnieker = 'all', gekozenVerkoper = null, ikId = null, metSales = true,
} = {}) {
  const leeg = { zichtbaar: false, werkruimte: 'techniek', knop: null, groepen: [], terug: null, melding: null };
  const beheerder = rol === 'beheerder' || rechten.beheer === true;
  const salesManager = rol === 'sales' && rechten.alleSales === true;
  if (rol === 'sales' && !salesManager) return leeg; // een gewone verkoper heeft niets te kiezen

  const gesorteerdVerkopers = [...verkopers].filter(v => v && typeof v.id === 'string').sort((a, b) => vergelijk(a.naam ?? '', b.naam ?? ''));
  // Wie wordt getoond? De bewaarde keuze als die in de lijst staat; anders (zoals getoondeVerkoper in sales-verkoper.js) een sales manager zichzelf,
  // een beheerder de eerste actieve verkoper.
  const gekozenId = gesorteerdVerkopers.some(v => v.id === gekozenVerkoper) ? gekozenVerkoper
    : (salesManager ? (gesorteerdVerkopers.find(v => v.id === ikId)?.id ?? null) : (gesorteerdVerkopers.find(v => v.actief !== false) ?? gesorteerdVerkopers[0])?.id ?? null);
  const eigenNaam = String(eigen ?? '').trim();

  // Sales manager: één groep met enkel verkopers; er is altijd één verkoper getoond.
  if (salesManager) {
    const items = gesorteerdVerkopers.map(v => verkoper(v, { ikId, gekozenId, metRol: false }));
    const gekozen = items.find(i => i.huidig) || null;
    return {
      zichtbaar: true, werkruimte: 'sales', knop: salesKnop(gekozen, { lees: Boolean(gekozen) && (gekozen.actief === false || gekozen.sleutel !== ikId) }), terug: null,
      groepen: [{ titel: null, items }], melding: verkopersFout ? VERKOPERS_FOUT : null,
    };
  }

  const inSales = beheerder && metSales && werkruimte === 'sales';
  const metRol = beheerder;
  const namen = techniekNamen({ ticketNamen, eigen: eigenNaam, gebruikers, beheerder });
  const accounts = new Map(); // normaal(zohoNaam) -> account (enkel beheerder)
  if (beheerder && Array.isArray(gebruikers)) {
    for (const g of gebruikers) if (g && g.rol !== 'sales' && typeof g.zohoNaam === 'string' && g.zohoNaam.trim()) accounts.set(normaalNaam(g.zohoNaam), g);
  }
  const technieken = namen.map((naam) => {
    const account = accounts.get(normaalNaam(naam));
    const rolNaam = ROL_LABEL[account?.rol] || (beheerder && Array.isArray(gebruikers) ? 'technieker' : '');
    const extra = beheerder && Array.isArray(gebruikers) && !account ? 'geen login' : '';
    return technieker(naam, { eigen: eigenNaam, gekozen: inSales ? '' : gekozenTechnieker, rol: rolNaam, extra, metRol: metRol && Array.isArray(gebruikers) });
  });
  if (beheerder && !Array.isArray(gebruikers)) for (const t of technieken) { t.sub = 'Persoonlijke planning'; t.rolLabel = ''; }

  const kanAlle = rechten.plannen === true || beheerder || rol === 'planner';
  const techniekItems = [...(kanAlle ? [alleItem(inSales ? '' : gekozenTechnieker)] : []), ...technieken];

  const wieTechniek = gekozenTechnieker === 'all' ? 'Alle' : voornaam(gekozenTechnieker);
  if (!beheerder) {
    return {
      zichtbaar: true, werkruimte: 'techniek', terug: null, melding: null,
      knop: { icoon: '👤', voor: 'Planning:', naam: wieTechniek, werkruimte: 'techniek', leesalleen: false, ...techniekTitel(gekozenTechnieker) },
      groepen: [{ titel: null, items: techniekItems }],
    };
  }

  // Beheerder: Techniek en (als de werkruimtewissel aan staat) Sales.
  const groepen = [{ titel: 'Techniek', items: techniekItems }];
  let melding = null;
  if (metSales) {
    const salesItems = gesorteerdVerkopers.map(v => verkoper(v, { ikId, gekozenId: inSales ? gekozenId : null, metRol: true }));
    if (salesItems.length) groepen.push({ titel: 'Sales', items: salesItems });
    if (verkopersFout) melding = VERKOPERS_FOUT;
  }
  if (inSales) {
    const gekozen = groepen.find(g => g.titel === 'Sales')?.items.find(i => i.huidig) || null;
    return {
      zichtbaar: true, werkruimte: 'sales', knop: salesKnop(gekozen, { lees: Boolean(gekozen) && gekozen.actief === false }), groepen, melding,
      terug: { tekst: `↩ Terug naar techniekers (${gekozenTechnieker === 'all' ? 'alle technici' : voornaam(gekozenTechnieker)})`, sleutel: gekozenTechnieker },
    };
  }
  return {
    zichtbaar: true, werkruimte: 'techniek', terug: null, melding, groepen,
    knop: { icoon: '👤', voor: 'Planning:', naam: wieTechniek, werkruimte: 'techniek', leesalleen: false, ...techniekTitel(gekozenTechnieker) },
  };
}

export const VERKOPERS_FOUT = 'De lijst met verkopers kon niet geladen worden';

function techniekTitel(gekozen) {
  const wie = gekozen === 'all' ? 'alle technici' : gekozen;
  return { titel: `Kies technieker (nu: ${wie})`, aria: `Kies technieker, nu ${wie}` };
}

// `lees`: de getoonde leads zijn enkel te lezen (een geblokkeerde verkoper bij de beheerder; een collega bij een sales manager).
function salesKnop(gekozen, { lees = false } = {}) {
  const leesalleen = lees;
  const wie = gekozen ? gekozen.naam : '';
  return {
    icoon: '👥', voor: 'Sales:', naam: gekozen ? voornaam(gekozen.naam) : '…', werkruimte: 'sales', leesalleen,
    titel: `Kies verkoper (nu: ${wie || 'niemand'})${leesalleen ? ', alleen lezen' : ''}`,
    aria: `Kies verkoper, nu ${wie || 'niemand'}${leesalleen ? ', alleen lezen' : ''}`,
  };
}
