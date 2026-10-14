import { test, expect, startApp } from './helpers.mjs';
import { seed } from './kalender-hulp.mjs';

// v2.1.5 (klantmelding #3964): een ticket met voorkeursdatum EN voorkeursuur van de klant, later dan de bekeken week,
// moet op die dag en dat uur komen, langs elk planpad: "⚡ Plan deze week" vanuit de huidige week, "⚡ Plan deze week" vanuit
// de week van de voorkeur, "+" in de wachtrij en "+ Voeg toe aan planning" in het ticketdetail. #1001 (t1) is van Tim.

const resultaat = (page) => page.getByRole('dialog', { name: '⚡ Planningsresultaat' });
const plekVan = (page, id) => page.evaluate((id) => Object.entries(kern.toestand.get('planning'))
  .flatMap(([d, stops]) => stops.filter(s => s.ticket.id === id).map(s => ({ datum: d, uur: s.uur || null }))), id);

const BLOK = (o) => ({ id: 'b' + o.date, scope: 'global', person: null, kind: 'fullday', from: null, to: null, reason: '', ...o });

const SCENARIO_S = [
  {
    naam: 'testklok ma 5 okt, voorkeur vr 23 okt',
    nu: undefined, voorkeur: '2026-10-23', label: '23 okt', weken: 2, blokkades: [],
  },
  {
    // Zoals de live melding: woensdag 14 okt, voorkeur vrijdag 30 okt 14:00 (na de overgang naar wintertijd), globale
    // blokkering di 27 okt, persoonlijke blokkeringen wo 21 okt 12-17 en do 22 okt de hele dag.
    naam: 'live-scenario wo 14 okt, voorkeur vr 30 okt',
    nu: '2026-10-14T09:00:00+02:00', voorkeur: '2026-10-30', label: '30 okt', weken: 2,
    blokkades: [
      BLOK({ date: '2026-10-27' }),
      BLOK({ date: '2026-10-21', scope: 'person', person: 'Tim', kind: 'range', from: '12:00', to: '17:00' }),
      BLOK({ date: '2026-10-22', scope: 'person', person: 'Tim' }),
    ],
  },
];

for (const sc of SCENARIO_S) {
  const klant = { t1: { voorkeur: sc.voorkeur, voorkeurTijd: '14:00', geblokkeerd: [], notitie: '' } };
  const start = (page) => startApp(page, { technieker: 'Tim', nu: sc.nu, overschrijf: seed({ klant, blokkades: sc.blokkades }) });
  const regel = new RegExp(`#1001 Laadpaal offline na stroomuitval → .*${sc.label}`);

  test.describe(`voorkeursdatum van de klant (${sc.naam})`, () => {
    test('"⚡ Plan deze week" vanuit de huidige week zet het ticket op zijn latere voorkeursdag en -uur', async ({ page }) => {
      await start(page);
      await page.getByRole('tab', { name: 'Kalender' }).click();
      await page.getByRole('button', { name: '⚡ Plan deze week' }).click();
      await expect(resultaat(page).getByText(regel)).toBeVisible();
      expect(await plekVan(page, 't1')).toEqual([{ datum: sc.voorkeur, uur: '14:00' }]);
    });

    test('"⚡ Plan deze week" vanuit de week van de voorkeur zet het ticket op zijn voorkeursdag en -uur', async ({ page }) => {
      await start(page);
      await page.getByRole('tab', { name: 'Kalender' }).click();
      for (let i = 0; i < sc.weken; i++) await page.getByRole('button', { name: 'Volgende periode' }).first().click();
      await page.getByRole('button', { name: '⚡ Plan deze week' }).click();
      await expect(resultaat(page).getByText(regel)).toBeVisible();
      expect(await plekVan(page, 't1')).toEqual([{ datum: sc.voorkeur, uur: '14:00' }]);
    });

    test('"+" in de wachtrij zet het ticket op zijn voorkeursdag en -uur, niet op de eerstvolgende vrije dag', async ({ page }) => {
      await start(page);
      const kaart = page.locator('#ticket-list .ticket').filter({ hasText: '#1001' });
      await kaart.getByRole('button', { name: 'Inplannen op eerstvolgende vrije dag' }).click();
      await expect(page.locator('#toast')).toHaveText('✓ Toegevoegd aan ' + sc.label);
      expect(await plekVan(page, 't1')).toEqual([{ datum: sc.voorkeur, uur: '14:00' }]);
    });

    test('"+ Voeg toe aan planning" in het ticketdetail volgt ook de voorkeursdag', async ({ page }) => {
      await start(page);
      await page.getByRole('button', { name: 'Open ticket #1001' }).click();
      await page.locator('#d-plan-btn').click();
      await expect(page.locator('#toast')).toHaveText('✓ Toegevoegd aan ' + sc.label);
      expect(await plekVan(page, 't1')).toEqual([{ datum: sc.voorkeur, uur: '14:00' }]);
    });
  });
}
