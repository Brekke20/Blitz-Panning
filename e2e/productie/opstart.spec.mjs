import { test, expect, startAppProductie, verwachtSchrijven, OPSTART_SCHRIJVEN, TICKETS_STUB } from '../productie-hulp.mjs';

const TICKETS = TICKETS_STUB;

// ── Opstart zonder ?test ──────────────────────────────────────────────────────
test('Laden: exact de verwachte opstartverzoeken, geen testmodus', async ({ page, verzoeken }) => {
  verwachtSchrijven(verzoeken, OPSTART_SCHRIJVEN);
  await startAppProductie(page, { technieker: 'Tim' });
  const verzameling = [...new Set(verzoeken.alle.map(r => `${r.methode} ${r.pad}`))].sort();
  expect(verzameling).toEqual([
    'GET /api/afspraken',
    'GET /api/auth-ik', // de sessie (logins T15): de app start pas na de login
    'GET /api/availability',
    'GET /api/instellingen', // de instellingen van de server naar de lokale cache (logins T16)
    'GET /api/inventaris',
    'GET /api/klantbeschikbaarheid',
    'GET /api/prijzen',
    'GET /api/rapport-archief',
    'GET /api/tickets',
    'GET /api/voorstel-status',
    'POST /api/planning-sinds',
  ]);
  await expect(page.locator('#test-badge')).toBeHidden();
  // Gemeten: de tellingen gelden voor het hele antwoord (niet voor de technieker).
  await expect(page.locator('#toast')).toHaveText('3 te plannen · 2 wacht bevestiging · 1 gepland');
  await expect(page.locator('#toast')).not.toContainText('Testmodus');
  expect(new URL(page.url()).search).toBe('');
});

test('X-Blitz-Test ontbreekt en planning-sinds krijgt exact de ticket-ids', async ({ page, verzoeken }) => {
  verwachtSchrijven(verzoeken, OPSTART_SCHRIJVEN);
  await startAppProductie(page, { technieker: 'Tim' });
  expect(verzoeken.alle.length).toBeGreaterThan(0);
  for (const r of verzoeken.alle) expect(r.headers['x-blitz-test'], `${r.methode} ${r.pad}`).toBeNull();
  const sinds = verzoeken.van('/api/planning-sinds', 'POST');
  expect(sinds).toHaveLength(1);
  expect(sinds[0].headers['content-type']).toBe('application/json');
  // Gemeten volgorde uit tickets.json.
  expect(sinds[0].body).toEqual({
    opzoeken: TICKETS.tickets.map(t => t.id),
    actief: [...TICKETS.tickets, ...TICKETS.pendingTickets, ...TICKETS.plannedTickets].map(t => t.id),
  });
  expect(sinds[0].body.opzoeken).toEqual(['t1', 't2', 't3']);
  expect(sinds[0].body.actief).toEqual(['t1', 't2', 't3', 'p1', 'p2', 'g1']);
});
