import { test, expect, kiesHoofdtab } from './helpers.mjs';
import { ROLLEN, startRol, labelsVan } from './kliktest-hulp.mjs';

// Kliktest, deel 1 (taak 13): per rol en variant, op pc (zijkolom) en gsm (dok met "Meer"):
//  - precies de verwachte tabbladen zijn zichtbaar (niet meer, niet minder; op gsm in het dok plus achter "Meer");
//  - elk tabblad is aan te klikken zoals een gebruiker dat doet: het juiste paneel wordt actief, de paginatitel klopt (pc) en er is geen
//    consolefout of onverwacht verzoek (dat bewaakt de fixture in helpers.mjs zelf);
//  - Beheer heeft per rol precies de verwachte subtabs en elke subtab opent zijn paneel.
// De verwachte lijsten staan in e2e/kliktest-hulp.mjs (ROLLEN) en zijn de verwachting uit de code, geen afleiding ervan.

const VERWACHT_GSM = (rol) => rol.tabs.filter((naam) => naam !== 'Route'); // Route is alleen-groot: niet op een gsm
// Een tab kan een teller dragen ("Ingepland 3"): daarom een patroon op het begin van de naam.
const tabNaam = (naam) => new RegExp(`^${naam}(\\s|$)`);
const dokLabels = (page) => labelsVan(page.locator('.tabs-inner .tab:visible'));

async function bladLabels(page) {
  await page.locator('.dok-meer').click();
  await expect(page.locator('.dok-meer-overlay')).toHaveClass(/open/);
  const labels = await page.locator('.dok-meer-blad button').evaluateAll((els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  await page.keyboard.press('Escape');
  await expect(page.locator('.dok-meer-overlay')).not.toHaveClass(/open/);
  return labels;
}

for (const vp of ['pc', 'gsm']) {
  test.describe(`kliktest tabbladen op ${vp}`, () => {
    for (const rol of ROLLEN) {
      test(`${rol.naam}: tabbladen, klikken en Beheer-subtabs`, async ({ page }) => {
        await startRol(page, rol, vp);
        const verwacht = vp === 'pc' ? rol.tabs : VERWACHT_GSM(rol);

        // 1. precies de verwachte tabbladen
        if (vp === 'pc') {
          expect(await dokLabels(page), 'zichtbare tabbladen in de zijkolom').toEqual(verwacht);
          await expect(page.locator('.dok-meer')).toBeHidden();
        } else {
          const inDok = await dokLabels(page);
          if (verwacht.length > 5) {
            await expect(page.locator('.dok-meer')).toBeVisible();
            expect(inDok, 'het dok toont de eerste vier').toEqual(verwacht.slice(0, 4));
            expect(await bladLabels(page), 'achter Meer staat de rest').toEqual(verwacht.slice(4));
          } else {
            await expect(page.locator('.dok-meer')).toBeHidden();
            expect(inDok, 'het dok toont alle tabbladen').toEqual(verwacht);
          }
          await expect(page.getByRole('tab', { name: 'Route', exact: true })).toHaveCount(0); // Route is nooit zichtbaar op een gsm
        }

        // 2. elk tabblad aanklikken
        for (const naam of verwacht) {
          await kiesHoofdtab(page, tabNaam(naam));
          const tab = page.locator('.tabs-inner .tab.active');
          await expect(tab, `${naam} is het enige actieve tabblad`).toHaveCount(1);
          expect((await labelsVan(tab))[0]).toBe(naam);
          await expect(tab).toHaveAttribute('aria-selected', 'true');
          const id = (await tab.getAttribute('id')).replace(/^tab-/, '');
          await expect(page.locator(`#view-${id}`), `het paneel van ${naam}`).toHaveClass(/\bactive\b/);
          await expect(page.locator('.view.active'), 'precies één paneel is actief').toHaveCount(1);
          if (vp === 'pc') await expect(page.locator('#paginatitel')).toHaveText(naam);
        }

        // 3. Beheer-subtabs
        if (rol.beheer.length > 0) {
          await kiesHoofdtab(page, tabNaam('Beheer'));
          const balk = page.locator('.beheer-tabs');
          await expect(balk).toBeVisible();
          const labels = await balk.getByRole('tab').evaluateAll((els) => els.map((e) => e.textContent.trim()));
          expect(labels, 'subtabs van Beheer').toEqual(rol.beheer);
          // Beheer laadt zijn eerste subtab bij het openen: wacht tot dat klaar is, anders klikt de test op een knop die nog vervangen wordt.
          await expect(balk.getByRole('tab', { name: rol.beheer[0], exact: true })).toHaveAttribute('aria-selected', 'true');
          await expect(page.locator('#beheer-paneel')).not.toHaveAttribute('aria-busy', 'true');
          for (const naam of rol.beheer) {
            const sub = balk.getByRole('tab', { name: naam, exact: true });
            await sub.click();
            await expect(sub).toHaveAttribute('aria-selected', 'true');
            const paneel = page.locator('#beheer-paneel');
            await expect(paneel).toHaveAttribute('aria-labelledby', await sub.getAttribute('id'));
            await expect(paneel).not.toHaveAttribute('aria-busy', 'true');
            await expect(paneel, `${naam} heeft inhoud`).not.toBeEmpty();
          }
        } else {
          await expect(page.getByRole('tab', { name: 'Beheer', exact: true })).toHaveCount(0);
        }
      });
    }
  });
}
