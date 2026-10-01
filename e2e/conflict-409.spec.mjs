import { test, expect, startApp } from './helpers.mjs';

// Optimistic locking: de server antwoordt 409 + zijn nieuwere stand als iemand anders net schreef.
// Deze tests leggen vast wat de app NU doet (niet wat misschien beter zou zijn):
//   - afspraken: de server-stand vervangt de lokale, geen merge, geen nieuwe poging;
//   - klantbeschikbaarheid: lokale wijziging wordt over de server-stand gemerged en de PUT herhaald.

const TOEGEVOEGD_DOOR_COLLEGA = {
  id: 'srv-1', titel: 'Collega-afspraak', datum: '2026-10-06', uur: '10:00', einduur: '11:00',
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
  test('afspraken: server-stand vervangt de lokale, zonder nieuwe poging', async ({ page, verzoeken, consoleFouten }) => {
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

    // De melding, en de kalender toont de server-stand.
    await expect(page.getByText('⚠ Iemand anders wijzigde dit net. De afspraken zijn opnieuw geladen.')).toBeVisible();
    await expect(page.getByText('✓ Afspraak opgeslagen')).toHaveCount(0);
    await expect(dinsdag.getByText('Collega-afspraak')).toBeVisible();
    // De lokale wijziging is NIET gemerged en NIET opnieuw geprobeerd: ze is weg.
    await expect(page.getByText('Eigen wijziging')).toHaveCount(0);
    const verstuurd = verzoeken.van('/api/afspraken', 'PUT');
    expect(verstuurd).toHaveLength(1);
    expect(verstuurd[0].body.versie).toBe(0);
    expect(verstuurd[0].body.afspraken.map(a => a.titel)).toEqual(['Eigen wijziging']);

    // Daarna werkt opslaan weer, op de server-versie, en de collega-afspraak blijft behouden.
    await voegAfspraakToe(page, { titel: 'Tweede poging', datum: '2026-10-05', van: '14:00', tot: '15:00' });
    await expect(page.getByText('✓ Afspraak opgeslagen')).toBeVisible();
    await expect(page.locator('.day-col[data-date="2026-10-05"]').getByText('Tweede poging')).toBeVisible();
    await expect(dinsdag.getByText('Collega-afspraak')).toBeVisible();
    const alle = verzoeken.van('/api/afspraken', 'PUT');
    expect(alle).toHaveLength(2);
    expect(alle[1].body.versie).toBe(5);
    expect(alle[1].body.afspraken.map(a => a.titel)).toEqual(['Collega-afspraak', 'Tweede poging']);
    await verwacht409(consoleFouten, '/api/afspraken');
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
