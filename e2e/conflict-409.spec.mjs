import { test, expect, startApp } from './helpers.mjs';

// Optimistic locking: de server antwoordt 409 + zijn nieuwere stand als iemand anders net schreef.
// Afspraken en klantbeschikbaarheid: de lokale wijziging wordt over de server-stand gemerged en de PUT
// herhaald (K12). Pas bij een tweede 409 volgt een waarschuwing en wordt de server-stand getoond.

const TOEGEVOEGD_DOOR_COLLEGA = {
  id: 'srv-1', titel: 'Collega-afspraak', datum: '2026-10-06', uur: '10:00', einduur: '11:00',
  type: 'Afspraak', persoon: null, adres: '', notitie: '', telefoon: '', email: '', bron: 'manueel', origResp: null,
};

const EIGEN_AFSPRAAK = {
  id: 'eigen-1', titel: 'Eigen afspraak', datum: '2026-10-05', uur: '09:00', einduur: '10:00',
  type: 'Afspraak', persoon: null, adres: '', notitie: '', telefoon: '', email: '', bron: 'manueel', origResp: null,
};

// De 409 is hier bedoeld: de browser meldt hem als HTTP 409 en als consolefout. Precies die twee
// meldingen voor het genoemde eindpunt halen we weg (en we eisen dat ze er waren); al het andere blijft
// de vangnetcontrole laten falen.
async function verwacht409(consoleFouten, pad) {
  const isDeze = (f) => f.includes(pad) && /409/.test(f);
  await expect.poll(() => consoleFouten.filter(isDeze).length).toBe(2);
  const verwacht = consoleFouten.filter(isDeze);
  for (const f of verwacht) consoleFouten.splice(consoleFouten.indexOf(f), 1);
}

async function voegAfspraakToe(page, { titel, datum, van, tot }) {
  await page.getByRole('button', { name: '➕ Afspraak' }).click();
  const modal = page.locator('#manueel-overlay');
  await expect(modal).toHaveClass(/open/);
  await modal.getByLabel('Titel *').fill(titel);
  await modal.getByLabel('Datum *').fill(datum);
  await modal.getByLabel('Van *').fill(van);
  await modal.getByLabel('Tot *').fill(tot);
  await modal.getByRole('button', { name: 'Opslaan' }).click();
}

test.describe('409-conflicten bij opslaan', () => {
  test('afspraken: lokale wijziging wordt gemerged met de server-stand en herhaald', async ({ page, verzoeken, consoleFouten }) => {
    // Eerste PUT -> 409 met server-versie 5 en een afspraak van een collega; daarna normaal.
    let puts = 0;
    let stand = { versie: 0, afspraken: [] };
    await startApp(page, {
      overschrijf: {
        afspraken: ({ methode, body }) => {
          if (methode !== 'PUT') return { status: 200, json: stand };
          puts++;
          if (puts === 1) {
            stand = { versie: 5, afspraken: [TOEGEVOEGD_DOOR_COLLEGA] };
            return { status: 409, json: { error: 'Versiematch mislukt', serverVersie: 5, data: stand } };
          }
          stand = { versie: stand.versie + 1, afspraken: body.afspraken };
          return { status: 200, json: stand };
        },
      },
    });
    await page.getByRole('tab', { name: 'Kalender' }).click();
    const dinsdag = page.locator('.day-col[data-date="2026-10-06"]');
    await expect(dinsdag.getByText('Collega-afspraak')).toHaveCount(0);

    await voegAfspraakToe(page, { titel: 'Eigen wijziging', datum: '2026-10-05', van: '14:00', tot: '15:00' });

    // Geen waarschuwing: de eigen wijziging is samengevoegd en bewaard.
    await expect(page.getByText('✓ Afspraak opgeslagen')).toBeVisible();
    await expect(page.getByText('⚠ Iemand anders wijzigde dit net. De afspraken zijn opnieuw geladen.')).toHaveCount(0);
    await expect(dinsdag.getByText('Collega-afspraak')).toBeVisible();
    await expect(page.locator('.day-col[data-date="2026-10-05"]').getByText('Eigen wijziging')).toBeVisible();
    const verstuurd = verzoeken.van('/api/afspraken', 'PUT');
    expect(verstuurd).toHaveLength(2);
    expect(verstuurd[0].body.versie).toBe(0);
    expect(verstuurd[0].body.afspraken.map(a => a.titel)).toEqual(['Eigen wijziging']);
    expect(verstuurd[1].body.versie).toBe(5);
    expect(verstuurd[1].body.afspraken.map(a => a.titel)).toEqual(['Collega-afspraak', 'Eigen wijziging']);

    // Daarna werkt opslaan weer, op de nieuwe versie, en alles blijft behouden.
    await voegAfspraakToe(page, { titel: 'Tweede poging', datum: '2026-10-05', van: '16:00', tot: '17:00' });
    await expect.poll(() => verzoeken.van('/api/afspraken', 'PUT').length).toBe(3);
    await expect(page.locator('.day-col[data-date="2026-10-05"]').getByText('Tweede poging')).toBeVisible();
    await expect(dinsdag.getByText('Collega-afspraak')).toBeVisible();
    const alle = verzoeken.van('/api/afspraken', 'PUT');
    expect(alle[2].body.versie).toBe(6);
    expect(alle[2].body.afspraken.map(a => a.titel)).toEqual(['Collega-afspraak', 'Eigen wijziging', 'Tweede poging']);
    await verwacht409(consoleFouten, '/api/afspraken');
  });

  test('afspraken: verwijderen met 409 verwijdert enkel het gekozen id', async ({ page, verzoeken, consoleFouten }) => {
    let puts = 0;
    let stand = { versie: 1, afspraken: [EIGEN_AFSPRAAK] };
    await startApp(page, {
      overschrijf: {
        afspraken: ({ methode, body }) => {
          if (methode !== 'PUT') return { status: 200, json: stand };
          puts++;
          if (puts === 1) {
            stand = { versie: 5, afspraken: [EIGEN_AFSPRAAK, TOEGEVOEGD_DOOR_COLLEGA] };
            return { status: 409, json: { error: 'Versiematch mislukt', serverVersie: 5, data: stand } };
          }
          stand = { versie: stand.versie + 1, afspraken: body.afspraken };
          return { status: 200, json: stand };
        },
      },
    });
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await expect(page.getByText('Eigen afspraak')).toBeVisible();
    await page.evaluate(() => removeLocalEvent('eigen-1'));

    await expect.poll(() => verzoeken.van('/api/afspraken', 'PUT').length).toBe(2);
    const verstuurd = verzoeken.van('/api/afspraken', 'PUT');
    expect(verstuurd[1].body.versie).toBe(5);
    expect(verstuurd[1].body.afspraken.map(a => a.titel)).toEqual(['Collega-afspraak']);
    await expect(page.locator('.day-col[data-date="2026-10-06"]').getByText('Collega-afspraak')).toBeVisible();
    await expect(page.getByText('Eigen afspraak')).toHaveCount(0);
    await verwacht409(consoleFouten, '/api/afspraken');
  });

  test('afspraken: wijzigen met 409 overschrijft op id', async ({ page, verzoeken, consoleFouten }) => {
    let puts = 0;
    let stand = { versie: 1, afspraken: [EIGEN_AFSPRAAK] };
    await startApp(page, {
      overschrijf: {
        afspraken: ({ methode, body }) => {
          if (methode !== 'PUT') return { status: 200, json: stand };
          puts++;
          if (puts === 1) {
            stand = { versie: 5, afspraken: [TOEGEVOEGD_DOOR_COLLEGA, EIGEN_AFSPRAAK] };
            return { status: 409, json: { error: 'Versiematch mislukt', serverVersie: 5, data: stand } };
          }
          stand = { versie: stand.versie + 1, afspraken: body.afspraken };
          return { status: 200, json: stand };
        },
      },
    });
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await page.evaluate(() => openManueelModalEdit(localEvents.find(e => e.id === 'eigen-1')));
    const modal = page.locator('#manueel-overlay');
    await expect(modal).toHaveClass(/open/);
    await modal.getByLabel('Titel *').fill('Eigen aangepast');
    await modal.getByRole('button', { name: 'Opslaan' }).click();

    await expect(page.getByText('✓ Afspraak bijgewerkt')).toBeVisible();
    const verstuurd = verzoeken.van('/api/afspraken', 'PUT');
    expect(verstuurd).toHaveLength(2);
    // Volgorde van de serverlijst blijft; enkel het id is vervangen, geen duplicaat.
    expect(verstuurd[1].body.afspraken.map(a => a.titel)).toEqual(['Collega-afspraak', 'Eigen aangepast']);
    await expect(page.getByText('Eigen aangepast')).toBeVisible();
    await expect(page.locator('.day-col[data-date="2026-10-06"]').getByText('Collega-afspraak')).toBeVisible();
    await verwacht409(consoleFouten, '/api/afspraken');
  });

  test('afspraken: dubbele 409 geeft een waarschuwing, de server-stand en geen derde PUT', async ({ page, verzoeken, consoleFouten }) => {
    let puts = 0;
    let stand = { versie: 0, afspraken: [] };
    await startApp(page, {
      overschrijf: {
        afspraken: ({ methode }) => {
          if (methode !== 'PUT') return { status: 200, json: stand };
          puts++;
          stand = { versie: 4 + puts, afspraken: [TOEGEVOEGD_DOOR_COLLEGA] };
          return { status: 409, json: { error: 'Versiematch mislukt', serverVersie: stand.versie, data: stand } };
        },
      },
    });
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await voegAfspraakToe(page, { titel: 'Eigen wijziging', datum: '2026-10-05', van: '14:00', tot: '15:00' });

    await expect(page.getByText('⚠ Iemand anders wijzigde dit net. De afspraken zijn opnieuw geladen.')).toBeVisible();
    await expect(page.getByText('✓ Afspraak opgeslagen')).toHaveCount(0);
    await expect(page.locator('.day-col[data-date="2026-10-06"]').getByText('Collega-afspraak')).toBeVisible();
    await expect(page.getByText('Eigen wijziging')).toHaveCount(0);
    expect(verzoeken.van('/api/afspraken', 'PUT')).toHaveLength(2);
    // Twee 409's: vier consolemeldingen.
    const isDeze = (f) => f.includes('/api/afspraken') && /409/.test(f);
    await expect.poll(() => consoleFouten.filter(isDeze).length).toBe(4);
    for (const f of consoleFouten.filter(isDeze)) consoleFouten.splice(consoleFouten.indexOf(f), 1);
  });

  test('klantbeschikbaarheid: lokale wijziging wordt gemerged met de server-stand en herhaald', async ({ page, verzoeken, consoleFouten }) => {
    const COLLEGA_ITEM = { geblokkeerd: ['2026-10-12'] };
    let puts = 0;
    let stand = { versie: 0, items: {} };
    await startApp(page, {
      overschrijf: {
        klantbeschikbaarheid: ({ methode, body }) => {
          if (methode !== 'PUT') return { status: 200, json: stand };
          puts++;
          if (puts === 1) {
            stand = { versie: 5, items: { t2: COLLEGA_ITEM } };
            return { status: 409, json: { error: 'Versiematch mislukt', serverVersie: 5, data: stand } };
          }
          stand = { versie: stand.versie + 1, items: body.items };
          return { status: 200, json: stand };
        },
      },
    });
    await page.getByRole('button', { name: 'Open ticket #1001' }).click();
    const detail = page.getByRole('dialog', { name: /Laadpaal offline na stroomuitval/ });
    await expect(detail).toBeVisible();
    await detail.getByLabel('Datum waarop de klant niet kan').fill('2026-10-09');
    await detail.getByRole('button', { name: '+ Datum toevoegen' }).click();
    await detail.getByRole('button', { name: '✓ Opslaan' }).click();

    await expect(page.getByText('✓ Klantbeschikbaarheid opgeslagen')).toBeVisible();
    await expect(page.getByText('✕ Klantbeschikbaarheid opslaan mislukt')).toHaveCount(0);
    const verstuurd = verzoeken.van('/api/klantbeschikbaarheid', 'PUT');
    expect(verstuurd).toHaveLength(2);
    // Eerste poging op de oude versie, enkel met de eigen wijziging.
    expect(verstuurd[0].body.versie).toBe(0);
    expect(Object.keys(verstuurd[0].body.items)).toEqual(['t1']);
    // Retry op de server-versie, met server-item EN eigen wijziging: niets verloren.
    expect(verstuurd[1].body.versie).toBe(5);
    expect(verstuurd[1].body.items.t1.geblokkeerd).toEqual(['2026-10-09']);
    expect(verstuurd[1].body.items.t2).toEqual(COLLEGA_ITEM);
    // En de datum blijft in het detail zichtbaar.
    await expect(detail.locator('.kb-chip')).toContainText('2026-10-09');
    await verwacht409(consoleFouten, '/api/klantbeschikbaarheid');
  });

  test('een normale opslag stuurt de versie mee en loopt op bij elke geslaagde PUT', async ({ page, verzoeken }) => {
    await startApp(page);
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await voegAfspraakToe(page, { titel: 'Eerste', datum: '2026-10-05', van: '14:00', tot: '15:00' });
    await expect(page.getByText('✓ Afspraak opgeslagen')).toBeVisible();
    await voegAfspraakToe(page, { titel: 'Tweede', datum: '2026-10-06', van: '14:00', tot: '15:00' });
    await expect(page.locator('.day-col[data-date="2026-10-06"]').getByText('Tweede')).toBeVisible();
    await expect.poll(() => verzoeken.van('/api/afspraken', 'PUT').length).toBe(2);
    const puts = verzoeken.van('/api/afspraken', 'PUT');
    expect(puts.map(p => p.body.versie)).toEqual([0, 1]);
    expect(puts[1].body.afspraken.map(a => a.titel)).toEqual(['Eerste', 'Tweede']);
  });
});
