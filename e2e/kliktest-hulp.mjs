// Hulp voor de kliktest (e2e/kliktest.spec.mjs en e2e/kliktest-knoppen.spec.mjs): de rollen met hun verwachte tabbladen en de gedeelde
// stubs van de Beheer-subtabs. Alles draait tegen stubs; er verlaat niets de pagina (de fixture helpers.mjs bewaakt dat).
// De lijst met verwachte tabbladen is hier BEWUST uitgeschreven (niet uit de code afgeleid): ze is de verwachting uit
// schermen/rol-schil.js, sales-registratie.js en beheer.js, en een afwijking in de app laat de test falen.
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { startApp, opslagStub, expect } from './helpers.mjs';
import { startSalesApp, BEHEERDER, SALES_GEBRUIKER } from './sales-hulp.mjs';
import { STANDAARD_GRENZEN } from '../public/js/kern/dashboard-grenzen.js';

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

/** Stubs voor de Beheer-subtabs die de standaardstubs van helpers.mjs niet hebben (en een gebruikerslijst voor wie geen echte backend heeft). */
export function beheerStubs({ metGebruikers = true } = {}) {
  // metGebruikers: false = de sales-backend (echte handlers, e2e/sales-hulp.mjs) levert zelf gebruikers en instellingen.
  return {
    ...(metGebruikers ? { gebruikers: ({ methode }) => (methode === 'GET' ? json(200, { gebruikers: GEBRUIKERS() }) : json(405, { error: 'x' })) } : {}),
    activiteit: ACTIVITEIT_STUB,
    systeemstatus: () => json(200, SYSTEEMSTATUS()),
    dashboard: () => json(200, structuredClone(DASHBOARD)),
    'dashboard-instellingen': opslagStub({ versie: 1, grenzen: structuredClone(STANDAARD_GRENZEN) }, 'grenzen'),
    // Beheer, Beschikbaarheden toont ook de verkopers uit de gebruikerslijst: hun sales-agenda is hier leeg.
    ...(metGebruikers ? { sales: ({ query }) => json(200, { gebruikerId: query.get('gebruiker') ?? 'u-s1', versie: 0, leads: [], blokken: [], open: 0 }) } : {}),
    ...(metGebruikers ? { instellingen: ({ methode, query }) => {
      if (methode === 'PUT') return json(200, { versie: 2 });
      return query.get('gebruiker')
        ? json(200, { versie: 1, instellingen: null })
        : json(200, { eigen: { gebruikerId: 'u-test', versie: 0, instellingen: null }, techniekers: {} });
    } } : {}),
  };
}

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
    start: (page, viewport) => startApp(page, { loginRol: 'beheerder', viewport, overschrijf: beheerStubs() }),
  },
  {
    sleutel: 'beheerder-sales', naam: 'beheerder (werkruimte Sales)', tabs: [...SALES, 'Beheer'], beheer: BEHEER_ALLES, eersteTab: 'Leads',
    start: (page, viewport) => startSalesApp(page, { gebruiker: BEHEERDER, werkruimte: 'sales', viewport, overschrijf: beheerStubs({ metGebruikers: false }) }),
  },
  {
    sleutel: 'planner', naam: 'planner', tabs: [...PLAN, 'Beheer'], beheer: BEHEER_PLANNER, eersteTab: 'Wachtrij',
    start: (page, viewport) => startApp(page, { loginRol: 'planner', viewport, overschrijf: beheerStubs() }),
  },
  {
    sleutel: 'technieker', naam: 'technieker', tabs: ['Kalender', 'Ingepland', 'Inventaris', 'Rapporten'], beheer: [], eersteTab: 'Kalender',
    start: (page, viewport) => startApp(page, { loginRol: 'technieker', loginGebruiker: TIM, technieker: 'Tim', viewport }),
  },
  {
    sleutel: 'technieker-plan-eigen', naam: 'technieker met "Mag zelf plannen"', tabs: [...PLAN], beheer: [], eersteTab: 'Wachtrij',
    start: (page, viewport) => startApp(page, { loginRol: 'technieker', loginGebruiker: { ...TIM, magZelfPlannen: true }, technieker: 'Tim', viewport }),
  },
  {
    sleutel: 'sales', naam: 'sales', tabs: [...SALES], beheer: [], eersteTab: 'Leads',
    start: (page, viewport) => startSalesApp(page, { gebruiker: SALES_GEBRUIKER, viewport }),
  },
  {
    sleutel: 'sales-manager', naam: 'sales manager', tabs: [...SALES, 'Beheer'], beheer: BEHEER_MANAGER, eersteTab: 'Leads',
    start: (page, viewport) => startSalesApp(page, { gebruiker: { ...SALES_GEBRUIKER, magAlleSales: true }, viewport, overschrijf: beheerStubs({ metGebruikers: false }) }),
  },
];

/** Zet de weergave van een echt toestel (gsm) vóór de start; op pc blijft ze op automatisch. */
export async function startRol(page, rol, vp) {
  const viewport = vp === 'gsm' ? GSM : PC;
  if (vp === 'gsm') await page.addInitScript(() => { if (window === window.top) localStorage.setItem('blitz_weergave', 'gsm'); });
  await rol.start(page, viewport);
  await expect(page.locator('html')).toHaveAttribute('data-nav', vp === 'gsm' ? 'dok' : 'kolom');
}

/** De namen van de tabbladen zoals een gebruiker ze ziet: zonder teller en icoon. */
export const labelsVan = (locator) => locator.evaluateAll((els) => els.map((e) => {
  const kloon = e.cloneNode(true);
  for (const x of kloon.querySelectorAll('.badge, svg')) x.remove();
  return kloon.textContent.replace(/\s+/g, ' ').trim();
}));
