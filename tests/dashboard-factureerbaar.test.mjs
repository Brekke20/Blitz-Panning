import { test } from 'node:test';
import assert from 'node:assert/strict';
import { berekenFactureerbaar } from '../netlify/lib/dashboard/factureerbaar.js';
import { berekenDashboard } from '../netlify/lib/dashboard-metrics.js';
import { normaliseerRapport } from '../netlify/lib/dashboard/gemeenschappelijk.js';
import { berekenLoonkost } from '../public/js/kern/loonkost.js';
import { waardeTotaal } from '../netlify/lib/dashboard/onderdelen.js';

let teller = 0;
// Een genormaliseerd Rapport (vorm uit gemeenschappelijk.js) met de velden die factureerbaar.js leest.
const rap = (extra = {}) => ({
  id: `r${++teller}`, datum: '2026-10-05', technieker: 'Tim', techniekers: ['Tim'], type: 'Single', interventieType: 'Interventie',
  servicetype: '1e-lijn', werktijdMin: 60, aanrijtijdMin: null, onderdelen: [], ...extra,
});
const deel = (extra = {}) => ({ sleutel: 'led', naam: 'LED-module', aantal: 1, prijs: 8, prijsBron: 'rapport', factureren: true, ...extra });

test('leeg: alles 0, geen null of NaN', () => {
  const f = berekenFactureerbaar([]);
  assert.deepEqual(f, {
    onderdelen: 0, loon: 0, totaal: 0, minuten: 0, nietAangerekend: { minuten: 0, rapporten: 0 },
    dekking: { rapporten: 0, zonderPrijs: 0, zonderWerktijd: 0, nietAangerekendeOnderdelen: 0 },
  });
});

test('onderdelen: prijs x aantal; een regel met factureren:false telt niet mee en komt in de dekking', () => {
  const f = berekenFactureerbaar([rap({ werktijdMin: null, onderdelen: [deel({ aantal: 2, prijs: 10 }), deel({ sleutel: 'gratis', naam: 'Kleinmateriaal', prijs: 5, factureren: false })] })]);
  assert.equal(f.onderdelen, 20);
  assert.equal(f.dekking.nietAangerekendeOnderdelen, 1);
  assert.equal(f.dekking.zonderPrijs, 0);
});

test('onderdelen zonder prijs tellen voor 0 en staan in dekking.zonderPrijs; een niet-aangerekende regel zonder prijs niet', () => {
  const f = berekenFactureerbaar([rap({ werktijdMin: null, onderdelen: [
    deel({ prijs: 0, prijsBron: 'geen', aantal: 3 }), deel({ prijs: 0, prijsBron: 'geen', factureren: false }), deel({ prijs: 7, prijsBron: 'prijslijst' }),
  ] })]);
  assert.equal(f.onderdelen, 7);
  assert.equal(f.dekking.zonderPrijs, 1);
});

test('1e lijn: 115 per gestart uur op werktijd + aanrijtijd; de minuten zijn die som', () => {
  const f = berekenFactureerbaar([rap({ servicetype: '1e-lijn', werktijdMin: 70, aanrijtijdMin: 20 })]);
  assert.equal(f.loon, 230); // 90 min = 2 gestarte uren
  assert.equal(f.minuten, 90);
  assert.equal(f.totaal, 230);
});

test('2e lijn: 175 en 75 per extra uur boven 3 uur', () => {
  assert.equal(berekenFactureerbaar([rap({ servicetype: '2e-lijn', werktijdMin: 120, aanrijtijdMin: 30 })]).loon, 175);
  assert.equal(berekenFactureerbaar([rap({ servicetype: '2e-lijn', werktijdMin: 240, aanrijtijdMin: 30 })]).loon, 175 + 75 * 2); // 4,5 u -> 2 extra uren
});

test('servicetype leeg (oud rapport): zoals het archief het 1e-lijn-/garantietarief per gestart uur', () => {
  const f = berekenFactureerbaar([rap({ servicetype: '', werktijdMin: 30 })]);
  assert.equal(f.loon, berekenLoonkost('', 30, 0).bruto);
  assert.equal(f.loon, 115);
});

test('garantie: geen loon, wel onderdelen; de uren staan onder "niet aangerekend"', () => {
  const f = berekenFactureerbaar([rap({ servicetype: 'garantie', werktijdMin: 60, aanrijtijdMin: 30, onderdelen: [deel({ prijs: 40 })] })]);
  assert.equal(f.loon, 0);
  assert.equal(f.onderdelen, 40);
  assert.equal(f.totaal, 40);
  assert.equal(f.minuten, 0);
  assert.deepEqual(f.nietAangerekend, { minuten: 90, rapporten: 1 });
});

test('installatie: geen loon, wel onderdelen; de uren staan onder "niet aangerekend"', () => {
  const f = berekenFactureerbaar([rap({ interventieType: 'Installatie', servicetype: '2e-lijn', werktijdMin: 120, onderdelen: [deel({ prijs: 12 })] })]);
  assert.equal(f.loon, 0);
  assert.equal(f.totaal, 12);
  assert.equal(f.minuten, 0);
  assert.deepEqual(f.nietAangerekend, { minuten: 120, rapporten: 1 });
});

test('werktijd ontbreekt (of onbetrouwbaar = null): geen loon en geen uren, wel onderdelen; telt in dekking.zonderWerktijd', () => {
  const f = berekenFactureerbaar([
    rap({ werktijdMin: null, aanrijtijdMin: 45, onderdelen: [deel({ prijs: 9 })] }),
    rap({ werktijdMin: 60 }),
  ]);
  assert.equal(f.loon, 115);
  assert.equal(f.minuten, 60);
  assert.equal(f.onderdelen, 9);
  assert.equal(f.dekking.zonderWerktijd, 1);
  assert.equal(f.dekking.rapporten, 2);
});

test('een garantie- of installatierapport zonder werktijd telt niet als "zonder werktijd" (er viel toch geen loon)', () => {
  const f = berekenFactureerbaar([rap({ servicetype: 'garantie', werktijdMin: null }), rap({ interventieType: 'Installatie', werktijdMin: null })]);
  assert.equal(f.dekking.zonderWerktijd, 0);
});

test('totaal = loon + onderdelen, afgerond op centen', () => {
  const f = berekenFactureerbaar([rap({ onderdelen: [deel({ prijs: 0.1 }), deel({ sleutel: 'b', prijs: 0.2 })] })]);
  assert.equal(f.onderdelen, 0.3);
  assert.equal(f.totaal, 115.3);
});

test('het bestaande "waarde onderdelen" blijft alles tellen (ook niet aangerekend); factureerbaar laat die weg', () => {
  const lijst = [rap({ onderdelen: [deel({ prijs: 10 }), deel({ sleutel: 'b', prijs: 4, factureren: false })] })];
  assert.equal(waardeTotaal(lijst).waarde, 14);
  assert.equal(berekenFactureerbaar(lijst).onderdelen, 10);
});

// Pariteit met de factureerbaar-regel van het rapportarchief (public/js/rapport-archief.js, regel 179-186):
// zelfde invoer, zelfde bedrag. Kopie van die formule; verandert de regel daar, dan moet deze test het merken.
function archiefFactureerbaar({ start, stop, aanrijtijdMin, servicetype, interventieType, onderdelen }) {
  const calc = (s, e) => { if (!s || !e) return 0; const [sh, sm] = s.split(':').map(Number); const [eh, em] = e.split(':').map(Number); let d = (eh * 60 + em) - (sh * 60 + sm); if (d < 0) d += 1440; return d > 0 ? d : 0; };
  const wMin = calc(start, stop);
  const aMin = parseInt(aanrijtijdMin) || 0;
  const { bruto } = wMin > 0 ? berekenLoonkost(servicetype, wMin, aMin) : { bruto: 0 };
  const loon = (servicetype === 'garantie' || interventieType === 'Installatie') ? 0 : bruto;
  const ond = onderdelen.filter(p => p.naam && p.factureren !== false).reduce((s, p) => s + (parseFloat(p.prijs) || 0) * (parseInt(p.aantal) || 1), 0);
  return loon + ond;
}

test('pariteit: het dashboard rekent per rapport hetzelfde bedrag uit als het rapportarchief', () => {
  const gevallen = [
    { start: '09:00', stop: '10:20', aanrijtijdMin: '25', servicetype: '1e-lijn', interventieType: 'Interventie', onderdelen: [{ id: 'vrij-a', naam: 'Kabel', prijs: '12.5', aantal: '2' }] },
    { start: '08:00', stop: '12:30', aanrijtijdMin: '40', servicetype: '2e-lijn', interventieType: 'Interventie', onderdelen: [{ id: 'vrij-a', naam: 'Kabel', prijs: '30', aantal: 1, factureren: false }, { id: 'vrij-b', naam: 'Relais', prijs: 8, aantal: 1 }] },
    { start: '09:00', stop: '10:00', aanrijtijdMin: '', servicetype: 'garantie', interventieType: 'Interventie', onderdelen: [{ id: 'vrij-a', naam: 'Print', prijs: 60, aantal: 1 }] },
    { start: '09:00', stop: '11:00', aanrijtijdMin: '10', servicetype: '2e-lijn', interventieType: 'Installatie', onderdelen: [] },
    { start: '', stop: '', aanrijtijdMin: '30', servicetype: '1e-lijn', interventieType: 'Interventie', onderdelen: [{ id: 'vrij-a', naam: 'Sticker', prijs: 2, aantal: 5 }] },
    { start: '23:30', stop: '00:45', aanrijtijdMin: '15', servicetype: '1e-lijn', interventieType: 'Interventie', onderdelen: [] },
  ];
  for (const g of gevallen) {
    const entry = { id: 'x', datum: '2026-10-05', technieker: 'Tim', servicetype: g.servicetype, interventieType: g.interventieType, rapportData: { start: g.start, stop: g.stop, aanrijtijdMin: g.aanrijtijdMin, onderdelen: g.onderdelen } };
    const f = berekenFactureerbaar([normaliseerRapport(entry)]);
    assert.equal(f.totaal, archiefFactureerbaar(g), JSON.stringify(g));
  }
});

test('normaliseerRapport neemt de vlag "niet aangerekend" over; ontbrekend = aangerekend', () => {
  const r = normaliseerRapport({
    id: 'x', datum: '2026-10-05', technieker: 'Tim',
    rapportData: { onderdelen: [{ id: 'vrij-1', naam: 'A', prijs: 5, factureren: false }, { id: 'vrij-2', naam: 'B', prijs: 5 }, { id: 'vrij-3', naam: 'C', prijs: 5, factureren: true }] },
  });
  assert.deepEqual(r.onderdelen.map(o => o.factureren), [false, true, true]);
});

// ---- in berekenDashboard ----

const NU = '2026-10-10T12:00:00.000Z';
const raw = (id, technieker, rd, extra = {}) => ({
  id, datum: '2026-10-05', technieker, servicetype: '1e-lijn', interventieType: 'Interventie',
  rapportData: { type: 'Single', start: '09:00', stop: '10:00', onderdelen: [], ...rd }, ...extra,
});
const invoer = (rapporten, filters = {}, extra = {}) => ({
  rapporten, register: { versie: 0, status: {} }, activiteit: [], activiteitVanaf: null, salesBlobs: [], prijslijst: null,
  filters: { van: '2026-10-01', tot: '2026-10-09', ...filters }, nu: NU, ...extra,
});
const RAPPORTEN = [
  raw('a', 'Tim', { onderdelen: [{ id: 'vrij-1', naam: 'A', prijs: 10, aantal: 1 }] }),
  raw('b', 'Sara', { start: '09:00', stop: '11:30', onderdelen: [{ id: 'vrij-2', naam: 'B', prijs: 20, aantal: 1 }] }, { servicetype: '2e-lijn' }),
  raw('c', 'Tim', { onderdelen: [{ id: 'vrij-3', naam: 'C', prijs: 6, aantal: 1 }] }, { servicetype: 'garantie' }),
  raw('d', 'Tim', { onderdelen: [{ id: 'vrij-4', naam: 'D', prijs: 5, aantal: 1 }] }, { datum: '2026-09-01' }), // buiten de periode
];

test('berekenDashboard: blok factureerbaar volgt de periode, en dekking.factureerbaar staat ernaast', () => {
  const d = berekenDashboard(invoer(RAPPORTEN));
  assert.deepEqual(d.factureerbaar, {
    onderdelen: 36, loon: 115 + 175, totaal: 36 + 290, minuten: 60 + 150,
    nietAangerekend: { minuten: 60, rapporten: 1 },
    dekking: { rapporten: 3, zonderPrijs: 0, zonderWerktijd: 0, nietAangerekendeOnderdelen: 0 },
  });
  assert.deepEqual(d.dekking.factureerbaar, d.factureerbaar.dekking);
});

test('berekenDashboard: factureerbaar volgt het technieker- en het typefilter', () => {
  const tim = berekenDashboard(invoer(RAPPORTEN, { technieker: 'Tim' })).factureerbaar;
  assert.equal(tim.totaal, 10 + 115 + 6);
  assert.equal(tim.dekking.rapporten, 2);
  assert.equal(berekenDashboard(invoer(RAPPORTEN, { type: 'bestaat-niet' })).factureerbaar.totaal, 0);
});

test('berekenDashboard: planner (deel techniekers) krijgt het blok, de sales manager niet', () => {
  const t = berekenDashboard(invoer(RAPPORTEN, {}, { deel: 'techniekers' }));
  assert.deepEqual(t.factureerbaar, berekenDashboard(invoer(RAPPORTEN)).factureerbaar);
  const s = berekenDashboard(invoer(RAPPORTEN, {}, { deel: 'sales' }));
  assert.ok(!('factureerbaar' in s));
  assert.ok(!('factureerbaar' in s.dekking));
});
