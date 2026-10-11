// Deterministische invoer voor `berekenDashboard` (tests en e2e/fixtures/dashboard.json). Geen willekeur,
// geen echte klantgegevens. Periodes: huidig 2026-10-01 t/m 2026-10-08, vorige 2026-09-23 t/m 2026-09-30.
// De verwachte getallen staan uitgeschreven in tests/dashboard-metrics.test.mjs.
export const NU = '2026-10-08T10:00:00+02:00';
export const XSS_NAAM = 'Sam <img src=x>';

// Eén lijst-entry zoals `rapportlijst` ze bewaart (zonder zware velden). `rd` = rapportData.
function entry(id, datum, technieker, interventieType, extra, rd) {
  return {
    id, datum, technieker, interventieType, ticketId: `t-${id}`, ticketNumber: `#${id}`, klant: `Klant ${id}`,
    adres: `Straat ${id} 1, 2000 Antwerpen`, hersteld: '', nieuwInter: '', servicetype: '2e-lijn', facturatie: 'nee',
    verwerking: { status: 'in-zoho' },
    ...extra,
    rapportData: { type: 'Single', oorzaakStoring: [], onderdelen: [], serienummer: `SN-${id}`, ...rd },
  };
}
const slot = (van, tot) => ({ van, tot });
const led = (aantal = 1) => ({ id: 'led', naam: 'LED', aantal, prijs: 8 });

export function maakRapporten() {
  return [
    // ---- huidige periode (1 t/m 8 oktober) ----
    entry('h1', '2026-10-01', 'Tim', 'Interventie', { hersteld: 'ja', nieuwInter: 'nee', servicetype: 'garantie' },
      { start: '08:35', stop: '09:35', geplandTijdslot: slot('08:30', '11:30'), oorzaakStoring: ['Firmware'], onderdelen: [led(2)],
        serienummer: 'CHARX-1001', installateurAlLangsGeweest: 'Ja', partner: 'Proxes', regio: 'Kempen', aanrijtijdMin: 30 }),
    entry('h2', '2026-10-01', 'Tim', 'Interventie', { hersteld: 'ja', nieuwInter: 'ja', servicetype: '2e-lijn' },
      { start: '12:00', stop: '13:30', geplandTijdslot: slot('13:00', '15:00'), oorzaakStoring: ['Firmware', 'Bekabeling'],
        onderdelen: [{ id: 'ct-80a', naam: 'CT-klem 80A/1A', aantal: 1, prijs: 10 }],
        serienummer: 'CHARX-1002', installateurAlLangsGeweest: 'Nee', partner: 'Proxes', regio: 'Kempen', aanrijtijdMin: 20 }),
    entry('h3', '2026-10-02', 'Roel', 'Interventie', { hersteld: 'ja', nieuwInter: 'nee', servicetype: '1e-lijn' },
      { type: 'Dual 1', start: '09:00', stop: '11:00', geplandTijdslot: slot('08:00', '09:00'), oorzaakStoring: ['Bekabeling'],
        onderdelen: [{ id: 'charx-3000', naam: 'Controller - CHARX 3000', aantal: 1, prijs: '' }], // prijs uit de prijslijst
        serienummer: 'CHARX-1003', installateurAlLangsGeweest: '', aanrijtijdMin: 45 }),
    entry('h4', '2026-10-02', 'Roel', 'Interventie', { hersteld: 'nee', nieuwInter: 'nee', servicetype: '1e-lijn' },
      { type: 'Dual 1', start: '14:00', stop: '15:00', geplandTijdslot: slot('11:00', '13:00'), oorzaakStoring: ['Controller'],
        onderdelen: [{ id: 'vrij-1', naam: 'Zekering', aantal: 1, prijs: 12.5 }],
        serienummer: 'CHARX-1004', installateurAlLangsGeweest: 'Ja', partner: 'Elektro Bos', regio: 'Limburg', aanrijtijdMin: 0 }),
    // zonder serienummer, zonder geplandTijdslot, laadpaaltype leeg
    entry('h5', '2026-10-03', XSS_NAAM, 'Interventie', { hersteld: 'ja', nieuwInter: 'nee', servicetype: 'garantie', adres: 'Dorpsstraat 12, 3500 Hasselt' },
      { type: '', start: '10:00', stop: '11:00', serienummer: '', installateurAlLangsGeweest: 'Nee', aanrijtijdMin: 15 }),
    entry('h6', '2026-10-05', 'Tim', 'Installatie', {},
      { start: '08:00', stop: '10:30', geplandTijdslot: slot('08:00', '10:00'), onderdelen: [led(1)],
        serienummer: 'CHARX-2001', installateurAlLangsGeweest: 'Ja', partner: 'Proxes', regio: 'Kempen', aanrijtijdMin: 25 }),
    // over middernacht: 22:00 -> 02:00 = 240 min; zelfde serienummer als h1 (4 dagen later = herhaalbezoek)
    entry('h7', '2026-10-05', 'Tim', 'Interventie', { hersteld: 'ja', nieuwInter: 'nee', servicetype: '2e-lijn' },
      { start: '22:00', stop: '02:00', geplandTijdslot: slot('21:30', '22:30'), oorzaakStoring: ['Stroomuitval'],
        onderdelen: [{ id: 'vrij-2', naam: ' zekering ', aantal: 2, prijs: 12.5 }],
        serienummer: 'CHARX-1001', installateurAlLangsGeweest: 'Ja', partner: 'Proxes', regio: 'Kempen', aanrijtijdMin: 10 }),
    // 08:00 -> 07:59 = 23u59: onbetrouwbare duur; nieuwe interventie nodig (geen first-time-fix); herhaal van h2
    entry('h8', '2026-10-06', 'Roel', 'Interventie', { hersteld: 'ja', nieuwInter: 'ja', servicetype: 'garantie' },
      { start: '08:00', stop: '07:59', geplandTijdslot: slot('07:00', '09:00'), oorzaakStoring: ['Firmware'], onderdelen: [led(1)],
        serienummer: 'CHARX-1002', installateurAlLangsGeweest: 'Ja', partner: 'Elektro Bos', regio: 'Limburg', aanrijtijdMin: 35 }),
    entry('h9', '2026-10-06', 'Roel', 'Interventie', { hersteld: 'nee', nieuwInter: 'ja', servicetype: '1e-lijn' },
      { type: 'Dual 1', start: '13:00', stop: '14:15', geplandTijdslot: slot('13:00', '15:00'), oorzaakStoring: ['Controller', 'Firmware'],
        onderdelen: [{ id: 'onbekend-deel', naam: 'Onbekend deel', aantal: 1, prijs: '' }], // nergens een prijs
        serienummer: 'CHARX-3003', installateurAlLangsGeweest: 'Nee', partner: 'Elektro Bos', regio: 'Limburg', aanrijtijdMin: 20 }),
    // duur enkel als tekst, geen aankomst (start); zelfde adres als h5 zonder serienummer
    entry('h10', '2026-10-07', 'Tim', 'Interventie', { hersteld: 'ja', nieuwInter: 'nee', servicetype: '2e-lijn', adres: 'Dorpsstraat 12, 3500 Hasselt', verwerking: { status: 'wacht' } },
      { werktijd: '1u30', geplandTijdslot: slot('08:00', '10:00'), oorzaakStoring: ['Bekabeling'], serienummer: '',
        installateurAlLangsGeweest: 'Ja', partner: 'Proxes', regio: 'Kempen', aanrijtijdMin: 40 }),
    entry('h11', '2026-10-08', XSS_NAAM, 'Interventie', { hersteld: 'ja', nieuwInter: 'nee', servicetype: 'garantie' },
      { type: 'Dual 1', start: '09:00', stop: '09:45', geplandTijdslot: slot('09:30', '11:30'), oorzaakStoring: ['Firmware'], onderdelen: [led(3)],
        serienummer: 'CHARX-1005', installateurAlLangsGeweest: 'Ja', partner: 'Proxes', regio: 'Antwerpen', aanrijtijdMin: 50 }),
    entry('h12', '2026-10-08', 'Tim', 'Installatie', { verwerking: { status: 'mislukt' } },
      { type: 'Dual 1', start: '13:00', stop: '15:00', geplandTijdslot: slot('13:00', '14:00'), serienummer: 'CHARX-2002', installateurAlLangsGeweest: '', aanrijtijdMin: 22 }),
    // geannuleerd: telt nergens mee
    entry('h13', '2026-10-04', 'Tim', 'Interventie', { verwerking: { status: 'geannuleerd' }, hersteld: 'ja', nieuwInter: 'nee' },
      { start: '09:00', stop: '10:00', geplandTijdslot: slot('09:00', '10:00') }),

    // ---- vorige periode (23 t/m 30 september) ----
    entry('p1', '2026-09-23', 'Tim', 'Interventie', { hersteld: 'ja', nieuwInter: 'nee', servicetype: 'garantie' },
      { start: '08:00', stop: '09:00', geplandTijdslot: slot('08:00', '10:00'), oorzaakStoring: ['Firmware'], onderdelen: [led(1)],
        serienummer: 'CHARX-0901', installateurAlLangsGeweest: 'Ja', partner: 'Proxes', regio: 'Kempen', aanrijtijdMin: 30 }),
    entry('p2', '2026-09-24', 'Tim', 'Interventie', { hersteld: 'nee', nieuwInter: 'nee' },
      { type: 'Dual 1', start: '10:00', stop: '12:00', geplandTijdslot: slot('09:00', '11:00'), oorzaakStoring: ['Controller'],
        serienummer: 'CHARX-0902', installateurAlLangsGeweest: 'Nee' }),
    entry('p3', '2026-09-25', 'Roel', 'Interventie', { hersteld: 'ja', nieuwInter: 'nee' },
      { start: '14:30', stop: '15:00', geplandTijdslot: slot('13:00', '14:00'), oorzaakStoring: ['Bekabeling'],
        onderdelen: [{ id: 'ct-80a', naam: 'CT-klem 80A/1A', aantal: 2, prijs: 10 }], serienummer: 'CHARX-0903', installateurAlLangsGeweest: 'Ja' }),
    entry('p4', '2026-09-28', 'Roel', 'Interventie', { hersteld: 'ja', nieuwInter: 'nee' },
      { type: 'Dual 1', start: '09:00', stop: '10:00', geplandTijdslot: slot('09:00', '11:00'), oorzaakStoring: ['Bekabeling'], onderdelen: [led(1)],
        serienummer: 'CHARX-1003', installateurAlLangsGeweest: 'Ja' }),
    entry('p5', '2026-09-29', XSS_NAAM, 'Interventie', { hersteld: 'ja', nieuwInter: 'nee' },
      { start: '08:00', stop: '09:00', geplandTijdslot: slot('10:00', '12:00'), serienummer: 'CHARX-0905', installateurAlLangsGeweest: 'Nee' }),
    entry('p6', '2026-09-30', 'Tim', 'Installatie', {},
      { start: '08:00', stop: '10:00', geplandTijdslot: slot('08:00', '09:00'), onderdelen: [led(2)], serienummer: 'CHARX-2900' }),
    // herhaal van p1 (7 dagen), zonder geplandTijdslot
    entry('p7', '2026-09-30', 'Tim', 'Interventie', { hersteld: 'ja', nieuwInter: 'nee' },
      { start: '11:00', stop: '11:45', serienummer: 'CHARX-0901' }),
    // 08:00 -> 08:00 = 0 min: onbetrouwbare duur
    entry('p8', '2026-09-26', 'Roel', 'Interventie', { hersteld: 'ja', nieuwInter: 'nee' },
      { start: '08:00', stop: '08:00', geplandTijdslot: slot('08:00', '10:00'), serienummer: 'CHARX-0908', installateurAlLangsGeweest: 'Ja' }),
    // geannuleerd via de vlag; entry van vóór v1.10.2 met een zwaar veld dat nooit doorgegeven mag worden
    { ...entry('p9', '2026-09-27', 'Roel', 'Interventie', {}, {}), geannuleerd: true, verwerking: undefined, _html: '<html>zwaar</html>' },

    // ---- daarbuiten (enkel voor de herhaalbezoek-terugblik en de opties) ----
    // 43 dagen vóór h4 (zelfde serienummer): herhaal bij 90 dagen, niet bij 30; met zware velden
    { ...entry('o1', '2026-08-20', 'Roel', 'Interventie', { hersteld: 'ja', nieuwInter: 'nee' }, { serienummer: 'CHARX-1004' }),
      _html: '<html>zwaar</html>',
      rapportData: { type: 'Single', serienummer: 'CHARX-1004', fotos: ['data:image/png;base64,AAAA'], handtekening: 'data:image/png;base64,BBBB' } },
    // een dag vóór de vorige periode, 3 dagen vóór p3 (zelfde serienummer)
    entry('o2', '2026-09-22', 'Roel', 'Interventie', { hersteld: 'ja', nieuwInter: 'nee' }, { serienummer: 'CHARX-0903' }),
  ];
}

export function maakRegister() {
  const u = (d, t) => `${d}T${t}.000Z`;
  return {
    versie: 12,
    status: {
      // bevestigd door de klant na 120 min
      A: { klant: u('2026-10-02', '08:00:00'), bevestigd: { door: 'klant', tijdstip: u('2026-10-02', '10:00:00') } },
      // contact en klant tegelijk verstuurd, contact bevestigt na 30 min
      B: { contact: u('2026-10-03', '07:00:00'), klant: u('2026-10-03', '07:00:00'), bevestigd: { door: 'contact', tijdstip: u('2026-10-03', '07:30:00') } },
      // lopend: gisteren verstuurd (jonger dan 14 dagen, niet bevestigd)
      C: { klant: u('2026-10-07', '09:00:00') },
      // oude link zonder `door`: bevestigd, maar zonder snelheid
      G: { klant: u('2026-10-04', '08:00:00'), bevestigd: { door: null, tijdstip: u('2026-10-04', '09:00:00') } },
      // vorige periode: verlopen zonder bevestiging (meer dan 14 dagen)
      D: { klant: u('2026-09-23', '12:00:00') },
      // vorige periode: bevestigd na precies 24 uur
      E: { klant: u('2026-09-26', '08:00:00'), bevestigd: { door: 'klant', tijdstip: u('2026-09-27', '08:00:00') } },
      // Geannuleerde voorstellen staan er niet meer in: `wisVoorstel` verwijdert het ticket uit het register.
    },
  };
}

// Annulaties (twee in de huidige periode, waarvan één rond middernacht UTC, één in de vorige) en ruis.
export function maakActiviteit() {
  const item = (op, actie) => ({ op, gebruikerId: 'u-1', naam: 'Planner Piet', actie, onderwerp: 'ticket 1001', details: 'klant-annuleert' });
  return [
    item('2026-09-25T09:00:00.000Z', 'annulatie'),
    item('2026-10-03T09:00:00.000Z', 'annulatie'),
    item('2026-10-05T22:30:00.000Z', 'annulatie'), // 6 oktober in Brussel
    item('2026-10-04T09:00:00.000Z', 'login'),
  ];
}

// Twee verkopers; de leads bevatten persoonsgegevens die nooit in het resultaat mogen komen.
export function maakSalesBlobs() {
  const persoon = n => ({ naam: `Lead Naam ${n}`, gsm: `04751230${n}0`, email: `lead${n}@voorbeeld.test`, adres: `Leadstraat ${n}, 2000 Antwerpen` });
  return [
    {
      verkoper: 'An Janssens',
      leads: [
        { id: 'l1', status: 'afgewerkt', geimporteerdOp: '2026-09-01T08:00:00.000Z', ...persoon(1),
          bezoeken: [
            { datum: '2026-10-02', resultaat: 'offerte', op: '2026-10-02T09:00:00.000Z' },
            { datum: '2026-10-06', resultaat: 'verkocht', op: '2026-10-06T09:00:00.000Z' },
          ],
          resultaat: { soort: 'verkocht', op: '2026-10-06T09:00:00.000Z' } }, // staat al in bezoeken: telt niet dubbel
        { id: 'l2', status: 'te-plannen', geimporteerdOp: '2026-09-28T08:00:00.000Z', bezoeken: [], ...persoon(2) },
      ],
    },
    {
      verkoper: 'Bart <b>Verhaegen',
      leads: [
        { id: 'l3', status: 'te-plannen', geimporteerdOp: '2026-09-01T08:00:00.000Z', ...persoon(3),
          bezoeken: [
            { datum: '2026-10-01', resultaat: 'geen-interesse', op: '2026-10-01T10:00:00.000Z' },
            { datum: '2026-10-08', resultaat: 'opnieuw', op: '2026-10-08T06:00:00.000Z' },
          ] },
        { id: 'l4', status: 'afgewerkt', geimporteerdOp: '2026-09-01T08:00:00.000Z', ...persoon(4),
          bezoeken: [{ datum: '2026-09-24', resultaat: 'offerte', op: '2026-09-24T10:00:00.000Z' }] }, // vorige periode
      ],
    },
  ];
}

export function maakPrijslijst() {
  return {
    versie: 3, bijgewerkt: '2026-09-01T08:00:00.000Z',
    onderdelen: [
      { id: 'led', naam: 'LED', categorie: 'overig', prijs: 8, eenheid: 'stuk' },
      { id: 'ct-80a', naam: 'CT-klem 80A/1A', categorie: 'ct-klem', prijs: 10, eenheid: 'stuk' },
      { id: 'charx-3000', naam: 'Controller - CHARX 3000', categorie: 'controller', prijs: 442.13, eenheid: 'stuk' },
    ],
  };
}

export function maakTestset() {
  return {
    rapporten: maakRapporten(),
    register: maakRegister(),
    activiteit: maakActiviteit(),
    activiteitVanaf: '2026-09-01T08:00:00.000Z',
    salesBlobs: maakSalesBlobs(),
    prijslijst: maakPrijslijst(),
    filters: { van: '2026-10-01', tot: '2026-10-08', technieker: '', type: '', herhaalDagen: 30 },
    nu: NU,
  };
}
