import { test } from 'node:test';
import assert from 'node:assert/strict';
import { voorstellen, berekenKlant } from '../netlify/lib/dashboard/klant.js';
import { berekenLoonkost } from '../public/js/kern/loonkost.js';
import { datumInBrussel } from '../netlify/lib/bevestigingslink.js';

let teller = 0;
// Een genormaliseerd Rapport (vorm uit gemeenschappelijk.js) met de velden die klant.js leest.
const rap = (extra = {}) => ({
  id: `r${++teller}`, datum: '2026-10-05', technieker: 'Tim', type: 'Single', interventieType: 'Interventie',
  servicetype: '2e-lijn', werktijdMin: 60, aanrijtijdMin: null, onderdelen: [], alLangs: null, partner: null, regio: null, ...extra,
});
const bevatNaN = v => (typeof v === 'number' ? Number.isNaN(v) : v && typeof v === 'object' ? Object.values(v).some(bevatNaN) : false);

const NU = '2026-10-10T12:00:00.000Z';
const basis = { rapporten: [], register: { versie: 1, status: {} }, activiteit: [], activiteitVanaf: null, van: '2026-10-01', tot: '2026-10-09', vorigeVan: '2026-09-22', vorigeTot: '2026-09-30', nu: NU };
const reg = status => ({ versie: 1, status });
const plus = (iso, min) => new Date(new Date(iso).getTime() + min * 60000).toISOString();

test('voorstel [RF5]: 22:30Z op 5/10 valt op 6/10 in Brussel', () => {
  const register = reg({ t1: { klant: '2026-10-05T22:30:00.000Z' } });
  assert.equal(voorstellen(register, { van: '2026-10-06', tot: '2026-10-09', nu: NU }).length, 1);
  assert.equal(voorstellen(register, { van: '2026-10-01', tot: '2026-10-05', nu: NU }).length, 0);
  assert.equal(voorstellen(register, { van: '2026-10-06', tot: '2026-10-09', nu: NU })[0].datum, '2026-10-06');
});

test('voorstel: snelheid vanaf het verzendtijdstip van de bevestigende doelgroep', () => {
  const verstuurd = '2026-10-05T09:00:00.000Z';
  const register = reg({
    a: { klant: verstuurd, bevestigd: { door: 'klant', tijdstip: plus(verstuurd, 180) } },
    b: { klant: verstuurd, bevestigd: { door: null, tijdstip: plus(verstuurd, 60) } },
    c: { klant: verstuurd, bevestigd: { door: 'installateur', tijdstip: plus(verstuurd, 60) } },
  });
  const [a, b, c] = voorstellen(register, { van: '2026-10-01', tot: '2026-10-09', nu: NU });
  assert.deepEqual(a, { ticketId: 'a', verstuurd, datum: '2026-10-05', bevestigdOp: plus(verstuurd, 180), door: 'klant', snelheidMin: 180, lopend: false });
  assert.equal(b.snelheidMin, null);
  assert.equal(b.bevestigdOp, plus(verstuurd, 60));
  assert.equal(c.snelheidMin, null);
});

test('voorstel: verstuurd is het vroegste tijdstip van alle doelgroepen', () => {
  const register = reg({ a: { klant: '2026-10-05T10:00:00.000Z', contact: '2026-10-05T08:00:00.000Z' }, leeg: {} });
  const lijst = voorstellen(register, { van: '2026-10-01', tot: '2026-10-09', nu: NU });
  assert.equal(lijst.length, 1);
  assert.equal(lijst[0].verstuurd, '2026-10-05T08:00:00.000Z');
});

test('bevestiging: mediaan, buckets en bevestigd via de knop', () => {
  const t0 = '2026-10-05T09:00:00.000Z';
  const register = reg({
    a: { klant: t0, bevestigd: { door: 'klant', tijdstip: plus(t0, 180) } },
    b: { klant: t0, bevestigd: { door: 'klant', tijdstip: plus(t0, 30) } },
    c: { klant: t0, bevestigd: { door: null, tijdstip: plus(t0, 600) } },
  });
  const k = berekenKlant({ ...basis, register });
  assert.equal(k.bevestiging.n, 3);
  assert.equal(k.bevestiging.nMetSnelheid, 2);
  assert.equal(k.bevestiging.mediaanMin, 105);
  assert.equal(k.bevestiging.gemiddeldeMin, 105);
  assert.deepEqual(k.bevestiging.buckets, [
    { label: '<1u', n: 1 }, { label: '1–4u', n: 1 }, { label: '4–24u', n: 0 }, { label: '1–3d', n: 0 }, { label: '>3d', n: 0 },
  ]);
  assert.deepEqual(k.bevestigdViaKnop, { n: 3, bevestigd: 3, pct: 100 });
});

test('lopend: niet bevestigd en jonger dan 14 dagen valt buiten de noemer', () => {
  const nu = '2026-10-25T12:00:00.000Z';
  const register = reg({
    vers: { klant: '2026-10-20T09:00:00.000Z' },            // 5 dagen oud: lopend
    oud: { klant: '2026-10-05T09:00:00.000Z' },             // 20 dagen oud: in de noemer
    klaar: { klant: '2026-10-21T09:00:00.000Z', bevestigd: { door: 'klant', tijdstip: '2026-10-21T10:00:00.000Z' } },
  });
  const lijst = voorstellen(register, { van: '2026-10-01', tot: '2026-10-25', nu });
  assert.deepEqual(lijst.map(v => [v.ticketId, v.lopend]), [['oud', false], ['vers', true], ['klaar', false]]);
  const k = berekenKlant({ ...basis, register, van: '2026-10-01', tot: '2026-10-25', nu });
  assert.deepEqual(k.bevestigdViaKnop, { n: 2, bevestigd: 1, pct: 50 });
  assert.equal(k.dekking.voorstellen, 3);
  assert.equal(k.dekking.lopend, 1);
});

test('leeg register [RF1]', () => {
  const k = berekenKlant(basis);
  assert.deepEqual(k.bevestigdViaKnop, { n: 0, bevestigd: 0, pct: null });
  assert.equal(k.bevestiging.mediaanMin, null);
  assert.equal(k.bevestiging.gemiddeldeMin, null);
  assert.equal(k.bevestiging.n, 0);
  assert.equal(k.bevestiging.buckets.length, 5);
  assert.deepEqual(k.garantie, { n: 0, garantie: 0, pct: null, onderdelenWaarde: { garantie: 0, overig: 0 }, loon: { garantie: 0, overig: 0 }, zonderWerktijd: 0 });
  assert.deepEqual(k.installateurAlLangs, { n: 0, ja: 0, nee: 0, onbekend: 0, pct: null, perPartner: [], perRegio: [] });
  assert.equal(bevatNaN(k), false);
});

const log = (op, actie = 'annulatie') => ({ op, gebruikerId: 'u1', naam: 'X', actie, onderwerp: 'T1', details: '' });

test('annulaties: enkel actie annulatie, per Brusselse datum, vorige periode en beschikbaarheid', () => {
  const activiteit = [
    log('2026-10-03T10:00:00.000Z'),
    log('2026-10-05T22:30:00.000Z'),       // 6/10 in Brussel
    log('2026-09-25T10:00:00.000Z'),       // vorige periode
    log('2026-10-04T10:00:00.000Z', 'login'),
    log('2026-10-04T11:00:00.000Z', 'rapport'),
  ];
  const k = berekenKlant({ ...basis, activiteit, activiteitVanaf: '2026-09-01T08:00:00.000Z' });
  assert.deepEqual(k.annulaties, { aantal: 2, vorige: 1, beschikbaar: true, vanaf: '2026-09-01' });
  assert.equal(k.dekking.annulatiesVanaf, '2026-09-01');
  // item van 5/10 22:30Z valt op 6/10: niet in een periode die op 5/10 eindigt
  const k2 = berekenKlant({ ...basis, activiteit, activiteitVanaf: '2026-09-01T08:00:00.000Z', van: '2026-10-04', tot: '2026-10-05' });
  assert.equal(k2.annulaties.aantal, 0);
  const k3 = berekenKlant({ ...basis, activiteit, activiteitVanaf: '2026-09-01T08:00:00.000Z', van: '2026-10-06', tot: '2026-10-06' });
  assert.equal(k3.annulaties.aantal, 1);
});

test('annulaties: vorige periode vóór het begin van het log is niet beschikbaar', () => {
  const k = berekenKlant({ ...basis, activiteit: [log('2026-10-03T10:00:00.000Z')], activiteitVanaf: '2026-10-02T08:00:00.000Z' });
  assert.equal(k.annulaties.aantal, 1);
  assert.equal(k.annulaties.vorige, 0);
  assert.equal(k.annulaties.beschikbaar, false);
  assert.equal(k.annulaties.vanaf, datumInBrussel('2026-10-02T08:00:00.000Z'));
});

test('annulaties: leeg log en geen vanaf', () => {
  const k = berekenKlant({ ...basis, activiteit: [], activiteitVanaf: null });
  assert.deepEqual(k.annulaties, { aantal: 0, vorige: 0, beschikbaar: false, vanaf: null });
  assert.equal(k.dekking.annulatiesVanaf, null);
});

test('garantie versus overig: aandeel, waarde onderdelen en loon', () => {
  const onderdeel = { sleutel: 'led', naam: 'LED', aantal: 2, prijs: 10, prijsBron: 'rapport' };
  const k = berekenKlant({
    ...basis,
    rapporten: [
      rap({ servicetype: 'garantie', werktijdMin: 60, onderdelen: [onderdeel] }),
      rap({ servicetype: '2e-lijn', werktijdMin: 120, aanrijtijdMin: 30 }),
      rap({ servicetype: 'garantie', interventieType: 'Installatie', werktijdMin: 600 }),
      rap({ servicetype: '2e-lijn', werktijdMin: null }),
    ],
  });
  assert.equal(k.garantie.n, 3);
  assert.equal(k.garantie.garantie, 1);
  assert.equal(k.garantie.pct, 33.3);
  assert.equal(k.garantie.loon.garantie, berekenLoonkost('garantie', 60, 0).bruto);
  assert.equal(k.garantie.loon.overig, berekenLoonkost('2e-lijn', 120, 30).bruto);
  assert.deepEqual(k.garantie.onderdelenWaarde, { garantie: 20, overig: 0 });
  assert.equal(k.garantie.zonderWerktijd, 1);
});

test('garantie 1 van 2 is 50 procent', () => {
  const k = berekenKlant({ ...basis, rapporten: [rap({ servicetype: 'garantie' }), rap({ servicetype: '2e-lijn', werktijdMin: 120 })] });
  assert.equal(k.garantie.pct, 50);
});

test('installateur al langs geweest: onbekend telt niet mee, rapportveld installateur doet niets', () => {
  const lijst = [
    rap({ alLangs: true, partner: 'Proxes', regio: 'Kempen' }), rap({ alLangs: true, partner: 'Proxes', regio: 'Kempen' }),
    rap({ alLangs: true, partner: null, regio: null }),
    rap({ alLangs: false, partner: 'Proxes', regio: 'Limburg', installateur: 'Proxes' }),
    rap({ alLangs: null, partner: 'Proxes', installateur: 'Proxes' }), rap({ alLangs: null }),
  ];
  const k = berekenKlant({ ...basis, rapporten: lijst });
  const a = k.installateurAlLangs;
  assert.deepEqual([a.n, a.ja, a.nee, a.onbekend, a.pct], [4, 3, 1, 2, 75]);
  assert.deepEqual(a.perPartner, [{ label: 'Proxes', n: 3, ja: 2 }]);
  assert.deepEqual(a.perRegio, [{ label: 'Kempen', n: 2, ja: 2 }, { label: 'Limburg', n: 1, ja: 0 }]);
  assert.equal(k.dekking.alLangsOnbekend, 2);
  assert.equal(k.dekking.partnerRegioTotaal, 4);
  assert.equal(k.dekking.partnerRegioMetVeld, 3);
});

test('installateur al langs [RF1]: geen enkel bekend antwoord geeft pct null', () => {
  const k = berekenKlant({ ...basis, rapporten: [rap({ alLangs: null }), rap({ alLangs: null })] });
  assert.equal(k.installateurAlLangs.pct, null);
  assert.equal(k.installateurAlLangs.n, 0);
  assert.equal(k.installateurAlLangs.onbekend, 2);
});
