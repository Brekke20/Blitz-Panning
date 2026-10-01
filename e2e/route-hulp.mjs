// Gedeelde hulpfuncties voor de route-specs (route, route-kaart, route-tijden).
import { expect } from './helpers.mjs';

// Instellingen van Tim vooraf zetten (zoals de gebruiker ze via Instellingen zou bewaren).
// Alleen in het hoofdvenster en alleen als er nog niets staat, zodat een herlaad ze behoudt.
// Werkdag start om 10:00 (instelling van Tim). VASTE_NU is maandag 5 okt 09:00, dus de vertrektijd van
// de route (10:00) ligt in de toekomst: de app stuurt dan een departAt mee en vraagt ook het
// drukte-detail op.
export async function zetInstellingenTim(page, instellingen) {
  await page.addInitScript((i) => {
    if (window !== window.top) return;
    if (localStorage.getItem('blitz_settings_Tim') === null) localStorage.setItem('blitz_settings_Tim', JSON.stringify(i));
  }, instellingen);
}

export const zetStartTijd = (page, vanTijd) => zetInstellingenTim(page, { vanTijd });

// Uitgangstoestand: Tim, "Plan deze week" zet #1001 en #1002 op maandag 5 okt (VASTE_NU), nog zonder
// tijdstip. Vanuit de Kalender-kolom van die dag openen we de Route-tab. Dit werkt in testmodus zonder
// extra data en geeft twee vrije, versleepbare stops (beide van Tim, geen anker).
export async function maakRouteMetStops(page) {
  await page.getByRole('tab', { name: 'Kalender' }).click();
  await page.getByRole('button', { name: '⚡ Plan deze week' }).click();
  const resultaat = page.getByRole('dialog', { name: '⚡ Planningsresultaat' });
  await expect(resultaat.getByText('Ingepland (2)', { exact: true })).toBeVisible();
  await resultaat.getByRole('button', { name: 'Sluiten' }).click();
  await expect(resultaat).toBeHidden();
  const maandag = page.locator('.day-col').filter({ hasText: '#1001' });
  await expect(maandag).toHaveCount(1);
  await maandag.getByRole('button', { name: 'Route berekenen' }).click();
  await expect(page.locator('#view-planning')).toBeVisible();
  await expect(page.getByTestId('route-datum')).toHaveValue('2026-10-05');
  await expect(page.getByTestId('route-aantal-stops')).toHaveText('2');
  // Het openen van de Route-tab berekent de route meteen; wacht tot beide stops een tijd tonen.
  await expect(page.getByTestId('route-stop-tijd')).toHaveCount(2);
}

export const stopNummers = (page) => page.getByTestId('route-stop-nummer').allTextContents();
export const stopTijden = async (page) => {
  // Eén aankomsttijd per stop: de ⏱-regel van elke kaart.
  const tijden = await page.getByTestId('route-stop').evaluateAll(els =>
    els.map(e => e.querySelector('[data-testid="route-stop-tijd"]')?.textContent.trim() ?? null));
  return tijden.map(t => t && t.replace('⏱ ', ''));
};
export const minuten = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
