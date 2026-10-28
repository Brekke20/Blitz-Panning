// Hulp voor de kliktest (e2e/kliktest.spec.mjs en e2e/kliktest-knoppen.spec.mjs): de rollen met hun verwachte tabbladen en de gedeelde
// stubs van de Beheer-subtabs. Alles draait tegen stubs; er verlaat niets de pagina (de fixture helpers.mjs bewaakt dat).
// De lijst met verwachte tabbladen is hier BEWUST uitgeschreven (niet uit de code afgeleid): ze is de verwachting uit
// schermen/rol-schil.js, sales-registratie.js en beheer.js, en een afwijking in de app laat de test falen.
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { startApp, opslagStub, expect } from './helpers.mjs';
import { startSalesApp, maakSalesBackend, kiesVerkoper, BEHEERDER, SALES_GEBRUIKER } from './sales-hulp.mjs';
import { STANDAARD_GRENZEN } from '../public/js/kern/dashboard-grenzen.js';
import { REDENEN } from '../netlify/lib/annulatie.js';

const MAP = path.dirname(url.fileURLToPath(import.meta.url));
const DASHBOARD = JSON.parse(fs.readFileSync(path.join(MAP, 'fixtures', 'dashboard.json'), 'utf8'));
const json = (status, obj) => ({ status, json: obj });

export const PC = { width: 1366, height: 768 };
export const GSM = { width: 375, height: 812 };

// De gebruikers die de Beheer-subtabs (Gebruikers, Instellingen, Activiteitenlog, Beschikbaarheden) tonen: verzonnen gegevens.
const GEBRUIKERS = () => [
  { id: 'u-test', email: 'b@test.be', naam: 'Test Beheerder', rol: 'beheerder', actief: true, laatsteLogin: null, aangemaakt: '2026-09-01T08:00:00.000Z', moetWachtwoordWijzigen: false },
  { id: 'u-p1', email: 'pia@test.be', naam: 'Pia Planner', rol: 'planner', actief: true, laatsteLogin: null, aangemaakt: '2026-09-02T08:00:00.000Z', moetWachtwoordWijzigen: false },
  { id: 'u-t1', email: 'tim@test.be', naam: 'Tim Techniek', rol: 'technieker', zohoNaam: 'Tim', actief: true, laatsteLogin: null, aangemaakt: '2026-09-03T08:00:00.000Z', moetWachtwoordWijzigen: false },
  { id: 'u-s1', email: 'sara@test.be', naam: 'Sara Sales', rol: 'sales', salesNaam: 'Sara S.', actief: true, laatsteLogin: null, aangemaakt: '2026-09-04T08:00:00.000Z', moetWachtwoordWijzigen: false },
];
const ACTIVITEIT = () => [
  { op: '2026-10-05T07:15:00.000Z', gebruikerId: 'u-test', naam: 'Test Beheerder', actie: 'login', onderwerp: null, details: null },
  { op: '2026-10-04T20:30:00.000Z', gebruikerId: 'u-t1', naam: 'Tim Techniek', actie: 'plannen', onderwerp: '1042', details: '2026-10-06' },
];
const SYSTEEMSTATUS = () => ({
  zoho: { ok: true, tijdstip: '2026-10-05T07:00:00.000Z' },
  foutenlog: [{ tijdstip: '2026-10-05T06:00:00.000Z', ticketId: '1042', stap: 'zoho-status', fout: 'Time-out' }],
  rapporten: { mislukt: [{ id: 'r1', ticketNumber: '1042', technieker: 'Tim', datum: '2026-10-04', laatsteFout: 'Zoho weigerde de bijlage' }] },
});
const ACTIVITEIT_STUB = ({ query }) => {
  const id = query.get('gebruiker'); const actie = query.get('actie');
  const items = ACTIVITEIT().filter((i) => (!id || i.gebruikerId === id) && (!actie || i.actie === actie));
  return json(200, { items, gebruikers: GEBRUIKERS().map((g) => ({ id: g.id, naam: g.naam })) });
};

/**
 * Stubs voor de Beheer-subtabs die de standaardstubs van helpers.mjs niet hebben. Met `metGebruikers` (de rollen die niet via startSalesApp
 * starten) komen gebruikers, instellingen en sales uit de ECHTE handlers met een in-memory store (e2e/sales-hulp.mjs), zodat bewerken,
 * blokkeren en opnieuw instellen echt werken in plaats van een 405 te krijgen. Zonder: de sales-backend van startSalesApp levert ze zelf.
 */
export function beheerStubs({ metGebruikers = true } = {}) {
  const echt = metGebruikers
    ? maakSalesBackend({ gebruiker: BEHEERDER, verkopers: GEBRUIKERS().filter((g) => g.id !== BEHEERDER.id), leads: [] }).stubs
    : {};
  return {
    ...(metGebruikers ? { gebruikers: echt.gebruikers, instellingen: echt.instellingen, sales: echt.sales } : {}),
    activiteit: ACTIVITEIT_STUB,
    systeemstatus: () => json(200, SYSTEEMSTATUS()),
    dashboard: () => json(200, structuredClone(DASHBOARD)),
    'dashboard-instellingen': opslagStub({ versie: 1, grenzen: structuredClone(STANDAARD_GRENZEN) }, 'grenzen'),
  };
}

// Gevulde sales-schermen (verzonnen namen): te plannen, voorgesteld, bevestigd (in de week van VASTE_NU) en afgewerkt.
const lead = (id, naam, extra = {}) => ({
  id, voornaam: 'Jan', naam, gsm: '0475 12 34 56', email: 'jan@voorbeeld.be', postcode: '3500', gemeente: 'Hasselt', straat: 'Kerkstraat', huisnr: '12', adresTekst: null,
  locatie: { lat: 50.93, lon: 5.34, bron: 'adres' }, status: 'te-plannen', bezoeken: [], duurMin: 30,
  geimporteerdOp: '2026-10-01T08:00:00.000Z', bronExport: { verantwoordelijke: 'Test Verkoper', geexporteerdOp: null }, ...extra,
});
export const SALES_LEADS = () => [
  lead('l1', 'Verhaegen', { status: 'voorgesteld', planning: { datum: '2026-10-05', start: '09:00', vast: false } }),
  lead('l2', 'Maes', { status: 'bevestigd', planning: { datum: '2026-10-05', start: '11:00', vast: true }, gemeente: 'Genk' }),
  lead('l3', 'Peeters', { gemeente: 'Diepenbeek' }), lead('l4', 'Janssens', { gemeente: 'Zonhoven' }), lead('l5', 'Claes', { gemeente: 'Lummen' }),
  lead('l6', 'Willems', { status: 'afgewerkt', gemeente: 'Bilzen', resultaat: { soort: 'verkocht', notitie: 'Laadpaal besteld', op: '2026-10-02T10:00:00.000Z' }, bezoeken: [{ datum: '2026-10-02', resultaat: 'verkocht', notitie: 'Laadpaal besteld', op: '2026-10-02T10:00:00.000Z' }] }),
  lead('l7', 'Hermans', { status: 'afgewerkt', gemeente: 'Tongeren', resultaat: { soort: 'offerte', op: '2026-10-01T10:00:00.000Z' }, bezoeken: [{ datum: '2026-10-01', resultaat: 'offerte', op: '2026-10-01T10:00:00.000Z' }] }),
];

const BEHEER_ALLES = ['Gebruikers', 'Instellingen', 'Beschikbaarheden', 'Activiteitenlog', 'Systeemstatus', "Thema's", 'Performance'];
const BEHEER_PLANNER = ['Instellingen', 'Beschikbaarheden', 'Performance'];
const BEHEER_MANAGER = ['Instellingen', 'Performance'];

const PLAN = ['Wachtrij', 'Kalender', 'Route', 'Ingepland', 'Inventaris', 'Rapporten'];
const SALES = ['Leads', 'Kalender', 'Route', 'Afgewerkt'];
const TIM = { zohoNaam: 'Tim' };

/**
 * De rollen en varianten. `tabs`: de tabbladen in de volgorde van de zijkolom op pc; `beheer`: de subtabs van Beheer (leeg = geen Beheer).
 * `start(page, viewport)` start de app als die rol (op een gsm met `blitz_weergave = gsm` zoals een echt toestel).
 * `eersteTab`: de tab waarop de app start; `route`: de naam van de alleen-groot-tab (op een gsm niet zichtbaar).
 */
export const ROLLEN = [
  {
    sleutel: 'beheerder-planning', naam: 'beheerder (werkruimte Planning)', tabs: [...PLAN, 'Beheer'], beheer: BEHEER_ALLES, eersteTab: 'Wachtrij',
    start: (page, viewport, extra = {}) => startApp(page, { loginRol: 'beheerder', viewport, overschrijf: beheerStubs(), ...extra }),
  },
  {
    sleutel: 'beheerder-sales', naam: 'beheerder (werkruimte Sales)', tabs: [...SALES, 'Beheer'], beheer: BEHEER_ALLES, eersteTab: 'Leads',
    // De beheerder kiest zelf een verkoper in de persoonskiezer; de verkoper Bea heeft hier de gevulde sales-schermen.
    start: async (page, viewport) => {
      const blobs = { 'sales/u-bea': { versie: 1, leads: SALES_LEADS(), blokken: [], grafstenen: [] } };
      await startSalesApp(page, { gebruiker: BEHEERDER, werkruimte: 'sales', viewport, blobs, overschrijf: beheerStubs({ metGebruikers: false }) });
      await kiesVerkoper(page, 'u-bea');
      await expect(page.locator('#view-sales-lijst .sales-kaart, #view-sales-lijst [data-lead-id]').first()).toBeVisible();
    },
  },
  {
    sleutel: 'planner', naam: 'planner', tabs: [...PLAN, 'Beheer'], beheer: BEHEER_PLANNER, eersteTab: 'Wachtrij',
    start: (page, viewport, extra = {}) => startApp(page, { loginRol: 'planner', viewport, overschrijf: beheerStubs(), ...extra }),
  },
  {
    sleutel: 'technieker', naam: 'technieker', tabs: ['Kalender', 'Ingepland', 'Inventaris', 'Rapporten'], beheer: [], eersteTab: 'Kalender',
    start: (page, viewport, extra = {}) => startApp(page, { loginRol: 'technieker', loginGebruiker: TIM, technieker: 'Tim', viewport, ...extra }),
  },
  {
    sleutel: 'technieker-plan-eigen', naam: 'technieker met "Mag zelf plannen"', tabs: [...PLAN], beheer: [], eersteTab: 'Wachtrij',
    start: (page, viewport, extra = {}) => startApp(page, { loginRol: 'technieker', loginGebruiker: { ...TIM, magZelfPlannen: true }, technieker: 'Tim', viewport, ...extra }),
  },
  {
    sleutel: 'sales', naam: 'sales', tabs: [...SALES], beheer: [], eersteTab: 'Leads',
    start: (page, viewport) => startSalesApp(page, { gebruiker: SALES_GEBRUIKER, viewport, leads: SALES_LEADS() }),
  },
  {
    sleutel: 'sales-manager', naam: 'sales manager', tabs: [...SALES, 'Beheer'], beheer: BEHEER_MANAGER, eersteTab: 'Leads',
    start: (page, viewport) => startSalesApp(page, { gebruiker: { ...SALES_GEBRUIKER, magAlleSales: true }, viewport, leads: SALES_LEADS(), overschrijf: beheerStubs({ metGebruikers: false }) }),
  },
];

/**
 * Het annuleervenster haalt zijn redenen met een GET op /api/annuleer, en dat pad is voor tests verboden (E12): zet de lijst vooraf, zoals
 * e2e/ticketdetail.spec.mjs (het gedocumenteerde testhaakje zetRedenenVoorTest, enkel in testmodus). Na een herladen opnieuw aanroepen.
 */
export const zetTestHaken = (page) => page.evaluate((redenen) => window.kern?.annuleren?.zetRedenenVoorTest?.(redenen), REDENEN.map(({ code, label }) => ({ code, label })));

/** Zet de weergave van een echt toestel (gsm) vóór de start; op pc blijft ze op automatisch. */
export async function startRol(page, rol, vp, extra = {}) {
  const viewport = vp === 'gsm' ? GSM : PC;
  if (vp === 'gsm') await page.addInitScript(() => { if (window === window.top) localStorage.setItem('blitz_weergave', 'gsm'); });
  await rol.start(page, viewport, extra);
  await zetTestHaken(page);
  await expect(page.locator('html')).toHaveAttribute('data-nav', vp === 'gsm' ? 'dok' : 'kolom');
}

/** De namen van de tabbladen zoals een gebruiker ze ziet: zonder teller en icoon. */
export const labelsVan = (locator) => locator.evaluateAll((els) => els.map((e) => {
  const kloon = e.cloneNode(true);
  for (const x of kloon.querySelectorAll('.badge, svg')) x.remove();
  return kloon.textContent.replace(/\s+/g, ' ').trim();
}));
