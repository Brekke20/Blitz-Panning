// tests/beheer-themas-logica.test.mjs — schermen/beheer-themas-logica.js: statusteksten, kaartgegevens, periode-invoer, uploadcontrole.
process.env.TZ = 'Europe/Brussels';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  statusVan, kaartVan, periodeUitInvoer, controleerUpload, foutRegels, downloadNaam, downloadTekst, MAANDEN,
} from '../public/js/schermen/beheer-themas-logica.js';
import { MAX_PAKKET_BYTES } from '../public/js/kern/themapakket-validatie.js';

const HALLOWEEN = { id: 'halloween', naam: 'Halloween', aan: true, periode: { van: { maand: 10, dag: 1 }, tot: { maand: 10, dag: 31 } }, periodeOverride: null, pakketHash: 'a' };
const KERST = { id: 'kerst', naam: 'Kerst', aan: true, periode: { van: { maand: 12, dag: 1 }, tot: { maand: 1, dag: 6 } }, periodeOverride: null, pakketHash: 'b' };
const SINT = { id: 'sinterklaas', naam: 'Sinterklaas', aan: true, periode: { van: { maand: 12, dag: 1 }, tot: { maand: 12, dag: 6 } }, periodeOverride: null, pakketHash: 'c' };
const PASEN = { id: 'pasen', naam: 'Pasen', aan: true, periode: { basis: 'pasen', van: -7, tot: 1 }, periodeOverride: null, pakketHash: 'd' };
const ALLE = [HALLOWEEN, KERST, SINT, PASEN];
const dag = (iso) => new Date(`${iso}T12:00:00+02:00`);

test('statusVan: actief, binnenkort, later, uit en overschaduwd, elk met een Nederlandse tekst', () => {
  assert.deepEqual(statusVan(HALLOWEEN, ALLE, dag('2026-10-15')), { soort: 'actief', tekst: 'Nu actief' });
  assert.deepEqual(statusVan(KERST, ALLE, dag('2026-11-20')), { soort: 'binnenkort', tekst: 'Begint over 11 dagen' });
  assert.deepEqual(statusVan(KERST, ALLE, dag('2026-11-30')), { soort: 'binnenkort', tekst: 'Begint morgen' });
  assert.deepEqual(statusVan(KERST, ALLE, dag('2026-10-15')), { soort: 'later', tekst: 'Later dit jaar' });
  assert.deepEqual(statusVan({ ...HALLOWEEN, aan: false }, ALLE, dag('2026-10-15')), { soort: 'uit', tekst: 'Uit' });
  // Sinterklaas (6 dagen) gaat voor Kerst (37 dagen): Kerst loopt, maar Sinterklaas wint
  assert.deepEqual(statusVan(KERST, ALLE, dag('2026-12-03')), { soort: 'overschaduwd', tekst: 'Loopt, maar Sinterklaas gaat voor' });
  assert.deepEqual(statusVan(SINT, ALLE, dag('2026-12-03')), { soort: 'actief', tekst: 'Nu actief' });
});

test('statusVan: uit gaat voor alles, ook als de periode loopt', () => {
  assert.equal(statusVan({ ...SINT, aan: false }, ALLE, dag('2026-12-03')).soort, 'uit');
});

test('statusVan: na het einde komt het volgend jaar; over de jaarwissel loopt Kerst nog in januari', () => {
  assert.deepEqual(statusVan(HALLOWEEN, ALLE, dag('2026-11-05')), { soort: 'later', tekst: 'Volgend jaar' });
  assert.equal(statusVan(KERST, ALLE, dag('2027-01-03')).soort, 'actief');
  // 14 dagen is de grens van "binnenkort", 15 dagen nog niet
  assert.equal(statusVan(HALLOWEEN, ALLE, dag('2026-09-17')).soort, 'binnenkort');
  assert.equal(statusVan(HALLOWEEN, ALLE, dag('2026-09-16')).soort, 'later');
});

test('statusVan: een override van de beheerder telt', () => {
  const verschoven = { ...HALLOWEEN, periodeOverride: { van: { maand: 5, dag: 1 }, tot: { maand: 5, dag: 20 } } };
  assert.equal(statusVan(verschoven, [verschoven], dag('2026-05-10')).soort, 'actief');
  // mei is dit jaar voorbij: de volgende start valt in het volgende jaar
  assert.equal(statusVan(verschoven, [verschoven], dag('2026-10-15')).tekst, 'Volgend jaar');
});

test('statusVan: Pasen 2026 begint op 29 maart (Pasen 5 april min 7)', () => {
  assert.deepEqual(statusVan(PASEN, ALLE, dag('2026-03-20')), { soort: 'binnenkort', tekst: 'Begint over 9 dagen' });
  assert.equal(statusVan(PASEN, ALLE, dag('2026-04-02')).soort, 'actief');
});

test('kaartVan: naam, status, venstertekst en of de periode aangepast is', () => {
  const k = kaartVan(HALLOWEEN, ALLE, dag('2026-10-15'));
  assert.equal(k.id, 'halloween');
  assert.equal(k.naam, 'Halloween');
  assert.equal(k.aan, true);
  assert.equal(k.status.soort, 'actief');
  assert.equal(k.periodeTekst, '1 tot 31 oktober');
  assert.equal(k.aangepast, false);
  const a = kaartVan({ ...HALLOWEEN, periodeOverride: { van: { maand: 10, dag: 5 }, tot: { maand: 11, dag: 2 } } }, ALLE, dag('2026-10-15'));
  assert.equal(a.periodeTekst, '5 oktober tot 2 november');
  assert.equal(a.aangepast, true);
  assert.equal(kaartVan(PASEN, ALLE, dag('2026-03-20')).periodeTekst, '29 maart tot 6 april 2026');
  // Pasen is dit jaar al voorbij: de tekst toont de komende uitvoering (Pasen 2027 is 28 maart)
  assert.equal(kaartVan(PASEN, ALLE, dag('2026-10-15')).periodeTekst, '21 maart tot 29 maart 2027');
});

test('periodeUitInvoer: vaste periode uit twee datums, ook over de jaarwissel', () => {
  assert.deepEqual(periodeUitInvoer({ soort: 'vast', vanDatum: { maand: 10, dag: 1 }, totDatum: { maand: 10, dag: 31 } }),
    { van: { maand: 10, dag: 1 }, tot: { maand: 10, dag: 31 } });
  // "van" na "tot" is geldig: over de jaarwissel
  assert.deepEqual(periodeUitInvoer({ soort: 'vast', vanDatum: { maand: '12', dag: '1' }, totDatum: { maand: '1', dag: '6' } }),
    { van: { maand: 12, dag: 1 }, tot: { maand: 1, dag: 6 } });
  assert.deepEqual(periodeUitInvoer({ soort: 'vast', vanDatum: '2026-12-01', totDatum: '01-06' }),
    { van: { maand: 12, dag: 1 }, tot: { maand: 1, dag: 6 } });
});

test('periodeUitInvoer: dagen ten opzichte van Pasen', () => {
  assert.deepEqual(periodeUitInvoer({ soort: 'pasen', vanDagen: '-7', totDagen: '1' }), { basis: 'pasen', van: -7, tot: 1 });
  assert.deepEqual(periodeUitInvoer({ soort: 'pasen', vanDagen: 0, totDagen: 0 }), { basis: 'pasen', van: 0, tot: 0 });
});

test('periodeUitInvoer: lege of ongeldige velden geven een Nederlandse fout, nooit een periode', () => {
  for (const invoer of [
    { soort: 'vast', vanDatum: { maand: '', dag: '' }, totDatum: { maand: 10, dag: 31 } },
    { soort: 'vast', vanDatum: { maand: 10, dag: 1 } },
    { soort: 'vast' },
    { soort: 'vast', vanDatum: { maand: 2, dag: 30 }, totDatum: { maand: 3, dag: 1 } },
    { soort: 'vast', vanDatum: { maand: 13, dag: 1 }, totDatum: { maand: 3, dag: 1 } },
    { soort: 'vast', vanDatum: 'nonsens', totDatum: '10-31' },
    { soort: 'pasen', vanDagen: '', totDagen: '1' },
    { soort: 'pasen', vanDagen: '-7' },
    { soort: 'pasen', vanDagen: 'abc', totDagen: '1' },
    { soort: 'pasen', vanDagen: '1.5', totDagen: '2' },
    { soort: 'pasen', vanDagen: '5', totDagen: '1' }, // tot voor van
    { soort: 'pasen', vanDagen: '-61', totDagen: '1' },
    { soort: 'onbekend' },
    null,
  ]) {
    const r = periodeUitInvoer(invoer);
    assert.equal(typeof r.fout, 'string', JSON.stringify(invoer));
    assert.ok(r.fout.length > 3);
    assert.equal(r.van, undefined);
  }
});

const pakket = () => JSON.parse(fs.readFileSync(new URL('../netlify/themas/halloween.blitzthema.json', import.meta.url), 'utf8'));

test('controleerUpload: een geldig pakket geeft het gevalideerde pakket', () => {
  const r = controleerUpload(JSON.stringify(pakket()));
  assert.equal(r.ok, true);
  assert.equal(r.pakket.id, 'halloween');
});

test('controleerUpload: geen JSON, geen object, te groot en ongeldige inhoud geven Nederlandse fouten', () => {
  const nietJson = controleerUpload('dit is geen json');
  assert.equal(nietJson.ok, false);
  assert.match(nietJson.fouten[0].fout, /geen geldige JSON/);
  assert.equal(controleerUpload('[1,2]').ok, false);
  assert.equal(controleerUpload('').ok, false);
  const groot = controleerUpload(' '.repeat(MAX_PAKKET_BYTES + 1) + '{}');
  assert.equal(groot.ok, false);
  assert.match(groot.fouten[0].fout, /512 kB/);
  const kapot = pakket(); kapot.periode = { van: { maand: 13, dag: 1 }, tot: { maand: 1, dag: 1 } };
  const r = controleerUpload(JSON.stringify(kapot));
  assert.equal(r.ok, false);
  assert.ok(r.fouten.some(f => f.veld.startsWith('periode')));
});

test('controleerUpload: meerbyte-tekens geven geen uitzondering', () => {
  const p = pakket();
  assert.equal(controleerUpload(JSON.stringify(p)).ok, true);
  assert.equal(typeof controleerUpload(JSON.stringify({ ...p, naam: '€'.repeat(40) })).ok, 'boolean');
});

test('foutRegels: "veld: fout" per regel, begrensd en zonder opmaak (tekst blijft ruwe tekst)', () => {
  const r = foutRegels([{ veld: 'periode.van', fout: 'Ongeldig' }, { veld: '<img src=x>', fout: 'Onbekend veld' }, { veld: '', fout: 'Alleen fout' }, { fout: 'x' }, null]);
  assert.deepEqual(r, ['periode.van: Ongeldig', '<img src=x>: Onbekend veld', 'Alleen fout', 'x']);
  assert.deepEqual(foutRegels(undefined), []);
  assert.equal(foutRegels(Array.from({ length: 500 }, (_, i) => ({ veld: `v${i}`, fout: 'f' }))).length, 51); // 50 + samenvatting
  assert.equal(foutRegels([{ veld: 'a'.repeat(1000), fout: 'f' }])[0].length <= 220, true);
});

test('downloadNaam en downloadTekst: <id>.blitzthema.json en leesbare JSON', () => {
  assert.equal(downloadNaam('halloween'), 'halloween.blitzthema.json');
  assert.equal(downloadNaam('a/b\\c'), 'a-b-c.blitzthema.json'); // een id uit de server wordt nooit een pad
  const t = downloadTekst({ id: 'x', naam: 'X' });
  assert.equal(JSON.parse(t).id, 'x');
  assert.match(t, /\n {2}"id"/);
});

test('MAANDEN: twaalf namen in het Nederlands', () => {
  assert.equal(MAANDEN.length, 12);
  assert.equal(MAANDEN[0], 'januari');
});
