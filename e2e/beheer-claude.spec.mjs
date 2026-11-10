// Gekoppelde Claude-toegangen: beheertab "Claude" (beheerder: alle koppelingen) en het blok in Instellingen, tab "Dit toestel"
// (andere rollen: de eigen koppeling). /api/mcp-toegangen is een stateful stub; alle gegevens zijn verzonnen.
import { test, expect, startApp, kiesHoofdtab } from './helpers.mjs';

const json = (status, obj) => ({ status, json: obj });
const T = Date.parse('2026-10-01T09:30:00.000Z');
const RIJEN = () => [
  { id: 'ta', uid: 'u-tim', gebruikerNaam: 'Tim Techniek', clientNaam: 'Claude', aangemaakt: T, laatstGebruikt: T + 3_600_000 },
  { id: 'tb', uid: 'u-pia', gebruikerNaam: 'Pia <b>Planner</b>', clientNaam: 'Claude Code', aangemaakt: T - 86_400_000, laatstGebruikt: T - 86_400_000 },
];

// Stateful stub: GET geeft de huidige lijst, DELETE?id= haalt een rij weg en houdt het id bij.
function toegangenStub(begin = RIJEN()) {
  const rijen = [...begin];
  const verwijderd = [];
  const stub = ({ methode, query }) => {
    if (methode === 'GET') return json(200, { toegangen: structuredClone(rijen) });
    if (methode === 'DELETE') {
      const id = query.get('id');
      const i = rijen.findIndex(r => r.id === id);
      if (i === -1) return json(404, { error: 'Deze koppeling bestaat niet (meer).' });
      verwijderd.push(id);
      rijen.splice(i, 1);
      return json(200, { ok: true });
    }
    return json(405, { error: 'niet toegestaan' });
  };
  stub.verwijderd = verwijderd;
  return stub;
}

async function openClaudeTab(page, stub) {
  await startApp(page, { overschrijf: { 'mcp-toegangen': stub } });
  await kiesHoofdtab(page, 'Beheer');
  await page.getByRole('tab', { name: 'Claude', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Gekoppelde Claude-toegangen' })).toBeVisible();
}

test.describe('Beheer: tab Claude (beheerder)', () => {
  test('toont het connector-adres en een rij per koppeling; namen worden als tekst getoond', async ({ page }) => {
    await openClaudeTab(page, toegangenStub());
    await expect(page.locator('#bc-adres')).toHaveValue('http://localhost:3338/api/mcp');
    await expect(page.locator('tr[data-toegang]')).toHaveCount(2);
    await expect(page.locator('tr[data-toegang="tb"]')).toContainText('Pia <b>Planner</b>');
    await expect(page.locator('tr[data-toegang="tb"] b')).toHaveCount(0);
    await expect(page.locator('tr[data-toegang="ta"]')).toContainText('Claude');
    await expect(page.getByText('Nog niemand heeft Claude gekoppeld.')).toHaveCount(0);
  });

  test('Intrekken stuurt DELETE met het juiste id en de rij verdwijnt', async ({ page, verzoeken }) => {
    const stub = toegangenStub();
    await openClaudeTab(page, stub);
    await page.locator('tr[data-toegang="ta"]').getByRole('button', { name: 'Intrekken' }).click();
    await expect(page.locator('tr[data-toegang="ta"]')).toHaveCount(0);
    await expect(page.locator('tr[data-toegang]')).toHaveCount(1);
    expect(stub.verwijderd).toEqual(['ta']);
    const dels = verzoeken.van('/api/mcp-toegangen', 'DELETE');
    expect(dels).toHaveLength(1);
  });

  test('de laatste koppeling intrekken toont de lege toestand', async ({ page }) => {
    const stub = toegangenStub([RIJEN()[0]]);
    await openClaudeTab(page, stub);
    await page.getByRole('button', { name: 'Koppeling van Tim Techniek intrekken' }).click();
    await expect(page.getByText('Nog niemand heeft Claude gekoppeld.')).toBeVisible();
    await expect(page.locator('tr[data-toegang]')).toHaveCount(0);
  });

  test('lege lijst toont de lege toestand', async ({ page }) => {
    await openClaudeTab(page, toegangenStub([]));
    await expect(page.getByText('Nog niemand heeft Claude gekoppeld.')).toBeVisible();
    await expect(page.locator('.bc table')).toHaveCount(0);
  });

  test('een mislukte intrekking toont de foutmelding en laat de rij staan', async ({ page, consoleFouten }) => {
    const stub = toegangenStub();
    const kapot = (a) => (a.methode === 'DELETE' ? json(403, { error: 'Je mag enkel je eigen koppeling intrekken.' }) : stub(a));
    await openClaudeTab(page, kapot);
    await page.locator('tr[data-toegang="tb"]').getByRole('button', { name: 'Intrekken' }).click();
    await expect(page.locator('.bc .bg-status')).toHaveText('Je mag enkel je eigen koppeling intrekken.');
    await expect(page.locator('tr[data-toegang]')).toHaveCount(2);
    await expect.poll(() => consoleFouten.filter(f => f.includes('/api/mcp-toegangen') && f.includes('403')).length).toBeGreaterThanOrEqual(1);
    consoleFouten.splice(0, consoleFouten.length, ...consoleFouten.filter(f => !(f.includes('/api/mcp-toegangen') && f.includes('403'))));
  });
});

test.describe('Instellingen: eigen koppeling (geen beheerder)', () => {
  test('een technieker ziet het blok onder Dit toestel en trekt de eigen koppeling in', async ({ page }) => {
    const stub = toegangenStub([RIJEN()[0]]);
    await startApp(page, { loginRol: 'technieker', overschrijf: { 'mcp-toegangen': stub } });
    await page.getByRole('button', { name: 'Instellingen', exact: true }).click();
    const modal = page.getByRole('dialog', { name: '⚙️ Instellingen' });
    await modal.getByRole('button', { name: 'Dit toestel', exact: true }).click();
    await expect(modal.locator('#set-claude-blok')).toBeVisible();
    await expect(modal.locator('tr[data-toegang="ta"]')).toBeVisible();
    await modal.locator('tr[data-toegang="ta"]').getByRole('button', { name: 'Intrekken' }).click();
    await expect(modal.getByText('Nog niemand heeft Claude gekoppeld.')).toBeVisible();
    expect(stub.verwijderd).toEqual(['ta']);
  });

  test('de beheerder ziet het blok niet in Instellingen (die heeft de tab Claude in Beheer)', async ({ page, verzoeken }) => {
    await startApp(page);
    await page.getByRole('button', { name: 'Instellingen', exact: true }).click();
    const modal = page.getByRole('dialog', { name: '⚙️ Instellingen' });
    await modal.getByRole('button', { name: 'Dit toestel', exact: true }).click();
    await expect(modal.locator('#set-tab-toestel')).toBeVisible();
    await expect(modal.locator('#set-claude-blok')).toBeHidden();
    expect(verzoeken.van('/api/mcp-toegangen')).toHaveLength(0);
  });
});
