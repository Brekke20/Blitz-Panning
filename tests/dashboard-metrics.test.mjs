import { test } from 'node:test';
import assert from 'node:assert/strict';
import { berekenKern } from '../netlify/lib/dashboard/kern.js';
import { berekenDashboard } from '../netlify/lib/dashboard-metrics.js';
import { normaliseerRapport } from '../netlify/lib/dashboard/gemeenschappelijk.js';
import { maakTestset, maakRapporten, NU, XSS_NAAM } from './fixtures/dashboard-testset.mjs';

const metFilters = (extra = {}) => { const t = maakTestset(); return { ...t, filters: { ...t.filters, ...extra } }; };
const bereken = (extra = {}) => berekenDashboard(metFilters(extra));

// Alle sleutels (recursief) van een waarde.
const sleutels = (v, uit = new Set()) => {
  if (Array.isArray(v)) v.forEach(x => sleutels(x, uit));
  else if (v && typeof v === 'object') for (const [k, w] of Object.entries(v)) { uit.add(k); sleutels(w, uit); }
  return uit;
};
// Paden van alle null-waarden en de aanwezigheid van NaN/Infinity.
const nullPaden = (v, pad = '', uit = []) => {
  if (v === null) uit.push(pad);
  else if (typeof v === 'number' && !Number.isFinite(v)) uit.push(`${pad} = ${v}`);
  else if (Array.isArray(v)) v.forEach((x, i) => nullPaden(x, `${pad}[${i}]`, uit));
  else if (v && typeof v === 'object') for (const [k, w] of Object.entries(v)) nullPaden(w, pad ? `${pad}.${k}` : k, uit);
  return uit;
};

// ---- kern: vooraf berekende getallen uit de testset (zie tests/fixtures/dashboard-testset.mjs) ----

test('kern huidig: aantal, gem. duur, op tijd (verdeling), ftf, herhaal en waarde kloppen met de testset', () => {
  const { kern } = bereken();
  assert.deepEqual(kern.huidig, {
    interventies: { n: 10 },                   // h1-h5, h7-h11 (h6 en h12 zijn installaties, h13 geannuleerd)
    gemDuurMin: { waarde: 93.3, n: 9 },        // 840 min over 9 betrouwbare duren (h8 = 23u59 valt weg; h7 telt 240)
    opTijd: { pct: 70, n: 10, teVroeg: 2, opTijd: 7, teLaat: 1 }, // h5 en h10 zonder slot/aankomst tellen niet mee
    firstTimeFix: { pct: 60, n: 10, ftf: 6 },          // h1 h3 h5 h7 h10 h11
    herhaalbezoeken: { aantal: 4 },            // h3 (p4), h7 (h1), h8 (h2), h10 (h5 via adres)
    onderdelenWaarde: { waarde: 545.63 },      // 16+10+442.13 (prijslijst)+12.5+8+25+8+0+24
  });
});

test('kern vorige: de even lange periode ervoor (23 t/m 30 september)', () => {
  const d = bereken();
  assert.deepEqual(d.periode, { van: '2026-10-01', tot: '2026-10-08' });
  assert.deepEqual(d.vorige, { van: '2026-09-23', tot: '2026-09-30' });
  assert.deepEqual(d.kern.vorige, {
    interventies: { n: 7 },
    gemDuurMin: { waarde: 62.5, n: 6 },        // p8 (0 min) valt weg; 375 / 6
    opTijd: { pct: 71.4, n: 7, teVroeg: 1, opTijd: 5, teLaat: 1 }, // p7 zonder slot
    firstTimeFix: { pct: 85.7, n: 7, ftf: 6 },
    herhaalbezoeken: { aantal: 2 },            // p3 (o2 buiten de periode), p7 (p1)
    onderdelenWaarde: { waarde: 52 },
  });
});

test('kern: de vorige periode als gekozen periode geeft dezelfde cijfers (deterministisch)', () => {
  const vorige = bereken();
  const verschoven = bereken({ van: '2026-09-23', tot: '2026-09-30' });
  assert.deepEqual(verschoven.kern.huidig, vorige.kern.vorige);
});

test('kern: herhaalDagen 90 vindt ook het bezoek van 43 dagen eerder (buiten alle periodes)', () => {
  assert.equal(bereken({ herhaalDagen: 30 }).kern.huidig.herhaalbezoeken.aantal, 4);
  const d90 = bereken({ herhaalDagen: 90 });
  assert.equal(d90.kern.huidig.herhaalbezoeken.aantal, 5); // + h4 (o1 op 20 augustus)
  assert.equal(d90.kwaliteit.herhaal.dagen, 90);
  assert.equal(d90.filters.herhaalDagen, 90);
});

test('berekenKern: lege invoer geeft nullen en bewuste null-percentages, nooit NaN', () => {
  const k = berekenKern({ rapporten: [], alle: [], herhaalDagen: 30 });
  assert.deepEqual(k, {
    interventies: { n: 0 }, gemDuurMin: { waarde: null, n: 0 },
    opTijd: { pct: null, n: 0, teVroeg: 0, opTijd: 0, teLaat: 0 },
    firstTimeFix: { pct: null, n: 0, ftf: 0 }, herhaalbezoeken: { aantal: 0 }, onderdelenWaarde: { waarde: 0 },
  });
});

test('berekenKern: `alle` mag buiten de selectie liggen (eerder bezoek van een andere technieker)', () => {
  const lijst = maakRapporten().map(e => normaliseerRapport(e)).filter(Boolean);
  const tim = lijst.filter(r => r.technieker === 'Tim' && r.datum >= '2026-10-01');
  assert.equal(berekenKern({ rapporten: tim, alle: lijst, herhaalDagen: 30 }).herhaalbezoeken.aantal, 2); // h7 en h10
  assert.equal(berekenKern({ rapporten: tim, alle: tim, herhaalDagen: 30 }).herhaalbezoeken.aantal, 1);   // h10 vindt h5 niet meer
});

// ---- filters ----

test('filter technieker Tim: rapportgebonden delen veranderen, register, annulaties en sales niet', () => {
  const alles = bereken();
  const tim = bereken({ technieker: 'Tim' });
  assert.deepEqual(tim.kern.huidig, {
    interventies: { n: 4 },                    // h1 h2 h7 h10
    gemDuurMin: { waarde: 120, n: 4 },         // (60+90+240+90) / 4
    opTijd: { pct: 80, n: 5, teVroeg: 1, opTijd: 4, teLaat: 0 }, // h1 h2 h6 h7 h12
    firstTimeFix: { pct: 75, n: 4, ftf: 3 },
    herhaalbezoeken: { aantal: 2 },            // h7 en h10; h10 vindt h5 (andere technieker) op de volledige lijst
    onderdelenWaarde: { waarde: 59 },          // 16+10+8+25
  });
  assert.equal(tim.tijd.dekking.rapporten, 6);
  assert.notDeepEqual(tim.tijd, alles.tijd);
  assert.notDeepEqual(tim.kwaliteit, alles.kwaliteit);
  assert.notDeepEqual(tim.onderdelen, alles.onderdelen);
  assert.equal(tim.klant.garantie.n, 4);
  assert.equal(tim.klant.garantie.garantie, 1);
  assert.equal(tim.klant.installateurAlLangs.n, 5);
  // niet gefilterd: voorstelregister, annulatielog, sales
  for (const sleutel of ['bevestiging', 'bevestigdViaKnop', 'annulaties']) {
    assert.deepEqual(tim.klant[sleutel], alles.klant[sleutel], sleutel);
  }
  assert.equal(tim.klant.dekking.voorstellen, alles.klant.dekking.voorstellen);
  assert.deepEqual(tim.sales, alles.sales);
  assert.deepEqual(tim.dekking.sales, alles.dekking.sales);
  assert.equal(tim.filters.technieker, 'Tim');
});

test('filter type: Dual 1 en "Onbekend" (leeg laadpaaltype)', () => {
  assert.deepEqual(bereken({ type: 'Dual 1' }).kern.huidig.interventies, { n: 4 }); // h3 h4 h9 h11 (h12 is een installatie)
  assert.equal(bereken({ type: 'Dual 1' }).tijd.dekking.rapporten, 5);
  assert.equal(bereken({ type: 'Onbekend' }).tijd.dekking.rapporten, 1);          // h5
  assert.equal(bereken({ type: 'Dual 1', technieker: 'Tim' }).tijd.dekking.rapporten, 1); // h12
  assert.equal(bereken({ type: 'bestaat-niet' }).tijd.dekking.rapporten, 0);
});

test('opties: gelijk met en zonder filter, uit de ongefilterde lijst, gesorteerd', () => {
  const alles = bereken();
  assert.deepEqual(alles.opties, { techniekers: ['Roel', XSS_NAAM, 'Tim'], types: ['Dual 1', 'Onbekend', 'Single'] });
  assert.deepEqual(bereken({ technieker: 'Tim' }).opties, alles.opties);
  assert.deepEqual(bereken({ technieker: 'Tim', type: 'Dual 1', van: '2026-10-08', tot: '2026-10-08' }).opties, alles.opties);
  assert.deepEqual(bereken({ technieker: 'bestaat-niet' }).opties, alles.opties);
});

test('de volgorde van de invoerlijst verandert niets aan het resultaat', () => {
  assert.deepEqual(berekenDashboard({ ...metFilters(), rapporten: maakRapporten().reverse() }), bereken());
});

// ---- de blokken ----

test('structuur: versie, periodes, filters, alle zes blokken en de dekking', () => {
  const d = bereken();
  assert.equal(d.versie, 1);
  assert.equal(d.gegenereerd, NU);
  assert.deepEqual(d.filters, { van: '2026-10-01', tot: '2026-10-08', technieker: '', type: '', herhaalDagen: 30 });
  for (const b of ['kern', 'tijd', 'kwaliteit', 'onderdelen', 'klant', 'sales', 'dekking', 'opties']) assert.ok(d[b], b);
  assert.deepEqual(Object.keys(d.dekking), ['tijd', 'kwaliteit', 'onderdelen', 'klant', 'sales']);
  assert.deepEqual(d.dekking.tijd, d.tijd.dekking);
  assert.equal(d.dekking.tijd.rapporten, 12);
  assert.equal(d.dekking.tijd.zonderSlot, 2);            // h5 en h10
  assert.equal(d.dekking.tijd.duurOnbetrouwbaar, 1);     // h8
  assert.equal(d.dekking.onderdelen.zonderPrijs, 1);     // h9
  assert.equal(d.dekking.kwaliteit.herhaalZonderSleutel, 0); // h5 en h10 delen het adres
  assert.deepEqual(d.dekking.sales, { verkopers: 2, bezoeken: 4 });
  assert.equal(d.dekking.klant.annulatiesVanaf, '2026-09-01');
});

test('tijd en kwaliteit: duur per groep en top-oorzaken over de gekozen periode', () => {
  const d = bereken();
  const firmware = d.tijd.duurPer.oorzaak.find(g => g.sleutel === 'Firmware');
  assert.equal(firmware.n, 4);                              // h1 (60), h2 (90), h9 (75), h11 (45); h8 heeft geen betrouwbare duur
  assert.equal(firmware.gemMin, 67.5);
  assert.deepEqual(d.kwaliteit.topOorzaken.slice(0, 3).map(o => [o.oorzaak, o.n]), [['Firmware', 5], ['Bekabeling', 3], ['Controller', 2]]);
});

test('onderdelen: prijs uit de prijslijst bij een lege rapportprijs, vrije regels samengevoegd', () => {
  const d = bereken();
  const controller = d.onderdelen.top10.find(o => o.sleutel === 'charx-3000');
  assert.equal(controller.waarde, 442.13);
  const zekering = d.onderdelen.top10.find(o => o.naam.trim().toLowerCase() === 'zekering');
  assert.equal(zekering.aantal, 3);                          // 1 + 2
  assert.equal(zekering.waarde, 37.5);
  assert.equal(d.onderdelen.top10.find(o => o.sleutel === 'led').aantal, 7); // 2 + 1 + 1 + 3
});

test('klant: bevestiging, % via de knop, annulaties, garantie en installateur al langs geweest', () => {
  const { klant } = bereken();
  assert.equal(klant.dekking.voorstellen, 4);               // A B C G
  assert.equal(klant.dekking.lopend, 1);                    // C
  assert.deepEqual(klant.bevestigdViaKnop, { n: 3, bevestigd: 3, pct: 100 });
  assert.equal(klant.bevestiging.n, 3);
  assert.equal(klant.bevestiging.nMetSnelheid, 2);          // G (oude link) heeft geen snelheid
  assert.equal(klant.bevestiging.mediaanMin, 75);           // 30 en 120
  assert.deepEqual(klant.annulaties, { aantal: 2, vorige: 1, beschikbaar: true, vanaf: '2026-09-01' }); // 'login' telt niet
  assert.equal(klant.garantie.n, 10);
  assert.equal(klant.garantie.garantie, 4);
  assert.equal(klant.garantie.pct, 40);
  assert.deepEqual([klant.installateurAlLangs.n, klant.installateurAlLangs.ja, klant.installateurAlLangs.nee, klant.installateurAlLangs.onbekend], [10, 7, 3, 2]);
  assert.equal(klant.installateurAlLangs.pct, 70);
});

test('klant: gekozen periode = vorige periode telt de verlopen en de na 24u bevestigde voorstellen', () => {
  const { klant } = bereken({ van: '2026-09-23', tot: '2026-09-30' });
  assert.deepEqual(klant.bevestigdViaKnop, { n: 2, bevestigd: 1, pct: 50 }); // D verlopen, E bevestigd
  assert.equal(klant.bevestiging.buckets.find(b => b.label === '1–3d').n, 1); // 1440 min
});

test('sales: bezoeken per verkoper per week, resultaten en wachtende leads (enkel tellingen)', () => {
  const { sales } = bereken();
  assert.deepEqual(sales.perWeek.weken, ['2026-09-28', '2026-10-05']);
  assert.deepEqual(sales.perWeek.verkopers, ['An Janssens', 'Bart <b>Verhaegen']);
  assert.deepEqual(sales.perWeek.waarden['An Janssens'], { '2026-09-28': 1, '2026-10-05': 1 });
  assert.equal(sales.resultaten.totaal, 4);                 // het slotresultaat van l1 staat al in bezoeken
  assert.deepEqual(sales.resultaten.perSoort.map(s => [s.soort, s.n, s.pct]),
    [['offerte', 1, 25], ['verkocht', 1, 25], ['geen-interesse', 1, 25], ['opnieuw', 1, 25]]);
  assert.equal(sales.wachtend.n, 2);                        // l2 en l3
  assert.equal(sales.wachtend.oudsteDagen, 10);
  assert.deepEqual(sales.wachtend.buckets.map(b => b.n), [1, 1, 0, 0]);
});

// ---- privacy, XSS, grootte ----

test('geen persoonsgegevens van leads, geen zware velden en geen gebruikersnamen uit het log in het resultaat', () => {
  const d = bereken();
  const json = JSON.stringify(d);
  for (const sleutel of ['gsm', 'email', 'geimporteerdOp']) assert.ok(!sleutels(d).has(sleutel), `sleutel ${sleutel}`);
  assert.ok(!sleutels(d.sales).has('naam'), 'sales bevat geen sleutel naam');
  for (const waarde of ['Lead Naam', '0475123', 'voorbeeld.test', 'Leadstraat']) assert.ok(!json.includes(waarde), waarde);
  assert.ok(!json.includes('zwaar') && !json.includes('base64'), 'zware velden van oude entries');
  assert.ok(!json.includes('Planner Piet'), 'gebruikersnaam uit het activiteitenlog');
  assert.ok(!json.includes('2026-10-02T08:00:00.000Z'), 'ruw verzendtijdstip van een voorstel');
});

test('XSS: namen uit data blijven ruwe tekst (escaping gebeurt in de client)', () => {
  const d = bereken();
  assert.ok(d.opties.techniekers.includes('Sam <img src=x>'));
  assert.ok(d.sales.perWeek.verkopers.includes('Bart <b>Verhaegen'));
  assert.ok(d.tijd.perDagPerTechnieker.techniekers.includes('Sam <img src=x>'));
});

test('grootte: de testset blijft ruim onder 200 kB', () => {
  assert.ok(JSON.stringify(bereken()).length < 200000);
});

test('grootte [RF6]: 3000 rapporten over 90 dagen blijven onder 200 kB en rekenen snel', () => {
  const techniekers = ['Tim', 'Roel', 'Sam', 'Eva', 'Jan', 'Lotte'];
  const rapporten = Array.from({ length: 3000 }, (_, i) => {
    const dag = new Date(Date.UTC(2026, 6, 10) + (i % 90) * 86400000).toISOString().slice(0, 10);
    return {
      id: `x${i}`, datum: dag, technieker: techniekers[i % 6], interventieType: i % 7 ? 'Interventie' : 'Installatie',
      ticketNumber: `#${i}`, klant: `Klant ${i}`, adres: `Straat ${i % 400} 1, 2000 Antwerpen`,
      hersteld: i % 3 ? 'ja' : 'nee', nieuwInter: i % 5 ? 'nee' : 'ja', servicetype: i % 4 ? '2e-lijn' : 'garantie',
      verwerking: { status: 'in-zoho' },
      rapportData: {
        type: `Type ${i % 12}`, start: '09:00', stop: '10:15', geplandTijdslot: { van: '08:30', tot: '10:30' }, aanrijtijdMin: 20 + (i % 30),
        oorzaakStoring: [`Oorzaak ${i % 25}`, `Oorzaak ${(i + 7) % 25}`], serienummer: `SN-${i % 700}`,
        onderdelen: [{ id: `vrij-${i % 40}`, naam: `Onderdeel ${i % 40}`, aantal: 1, prijs: 5 + (i % 9) }],
        installateurAlLangsGeweest: i % 2 ? 'Ja' : 'Nee', partner: `Partner ${i % 8}`, regio: `Regio ${i % 5}`,
      },
    };
  });
  const start = Date.now();
  const d = berekenDashboard({ ...metFilters({ van: '2026-07-10', tot: '2026-10-07' }), rapporten });
  assert.ok(Date.now() - start < 2000, 'binnen 2 s');
  assert.equal(d.tijd.dekking.rapporten, 3000);
  assert.ok(JSON.stringify(d).length < 200000, `${JSON.stringify(d).length} bytes`);
});

// ---- [RF1] lege en foute invoer ----

const TOEGESTANE_NULLS = [
  /^kern\.(huidig|vorige)\.gemDuurMin\.waarde$/, /^kern\.(huidig|vorige)\.(opTijd|firstTimeFix)\.pct$/,
  /^klant\.bevestigdViaKnop\.pct$/, /^klant\.bevestiging\.(mediaanMin|gemiddeldeMin)$/, /^klant\.installateurAlLangs\.pct$/,
  /^klant\.garantie\.pct$/, /^klant\.annulaties\.vanaf$/, /^(dekking\.klant|klant\.dekking)\.annulatiesVanaf$/,
  /^tijd\.opTijdTotaal\.pct$/, /^kwaliteit\.ftfTotaal\.pct$/,
];

test('[RF1] lege invoer: volledig gevormd resultaat, geen NaN, enkel bewuste null-percentages', () => {
  const leeg = berekenDashboard({
    rapporten: [], register: { versie: 0, status: {} }, activiteit: [], activiteitVanaf: null, salesBlobs: [], prijslijst: null,
    filters: { van: '2026-10-01', tot: '2026-10-08' }, nu: NU,
  });
  assert.deepEqual(leeg.filters, { van: '2026-10-01', tot: '2026-10-08', technieker: '', type: '', herhaalDagen: 30 });
  assert.deepEqual(leeg.opties, { techniekers: [], types: [] });
  for (const b of ['kern', 'tijd', 'kwaliteit', 'onderdelen', 'klant', 'sales', 'dekking']) assert.ok(leeg[b], b);
  assert.equal(leeg.kern.huidig.interventies.n, 0);
  assert.equal(leeg.kern.huidig.onderdelenWaarde.waarde, 0);
  assert.equal(leeg.sales.resultaten.perSoort.length, 4);
  assert.deepEqual(leeg.tijd.rijtijdPerDag, []);
  const onverwacht = nullPaden(leeg).filter(p => !TOEGESTANE_NULLS.some(re => re.test(p)));
  assert.deepEqual(onverwacht, []);
  assert.ok(!/NaN|Infinity/.test(JSON.stringify(leeg)));
  const json = JSON.stringify(leeg);
  assert.ok(json.length < 20000);
});

test('[RF1] alleen filters en nu: ontbrekende bronnen (register, log, sales, prijslijst) breken niets', () => {
  const d = berekenDashboard({ filters: { van: '2026-10-01', tot: '2026-10-08' }, nu: NU });
  assert.equal(d.kern.huidig.interventies.n, 0);
  assert.equal(d.klant.annulaties.beschikbaar, false);
  assert.equal(d.sales.wachtend.n, 0);
  assert.deepEqual(nullPaden(d).filter(p => !TOEGESTANE_NULLS.some(re => re.test(p))), []);
});

test('onbruikbare entries in de lijst (null, tekst, geen datum, geannuleerd) worden overgeslagen', () => {
  const d = berekenDashboard({
    ...metFilters(), rapporten: [null, 'tekst', 42, {}, { id: 'x', datum: 'morgen' }, { id: 'y', datum: '2026-10-02', geannuleerd: true }, ...maakRapporten()],
  });
  assert.equal(d.tijd.dekking.rapporten, 12);
  assert.deepEqual(d.kern.huidig, bereken().kern.huidig);
});

test('ongeldige periode of herhaalDagen: duidelijke fout resp. standaard 30', () => {
  assert.throws(() => bereken({ van: '2026-13-01' }), RangeError);
  assert.throws(() => bereken({ van: '2026-10-09', tot: '2026-10-01' }), RangeError);
  assert.throws(() => bereken({ tot: undefined }), RangeError);
  assert.equal(bereken({ herhaalDagen: 0 }).filters.herhaalDagen, 30);
  assert.equal(bereken({ herhaalDagen: 'abc' }).filters.herhaalDagen, 30);
  assert.equal(bereken({ herhaalDagen: undefined }).filters.herhaalDagen, 30);
});

test('berekenDashboard verandert de invoer niet', () => {
  const invoer = maakTestset();
  const kopie = JSON.stringify(invoer);
  berekenDashboard(invoer);
  assert.equal(JSON.stringify(invoer), kopie);
});

// ---- deel: planner (techniekers) en sales manager (sales) ----
test('deel "techniekers": alles behalve sales (geen sales-sleutel, geen dekking.sales), deel staat in het antwoord', () => {
  const d = bereken({});
  const t = berekenDashboard({ ...metFilters(), deel: 'techniekers' });
  assert.equal(t.deel, 'techniekers');
  assert.ok(!('sales' in t));
  assert.ok(!('sales' in t.dekking));
  for (const k of ['kern', 'tijd', 'kwaliteit', 'onderdelen', 'klant', 'opties']) assert.deepEqual(t[k], d[k], k);
  assert.ok(!('deel' in d)); // de beheerder (alles) houdt exact het oude antwoord
});

test('deel "sales": enkel sales en dekking.sales; geen kern, tijd, kwaliteit, onderdelen, klant, opties of technieker-filters', () => {
  const d = bereken({});
  const s = berekenDashboard({ ...metFilters(), deel: 'sales' });
  assert.equal(s.deel, 'sales');
  assert.deepEqual(s.sales, d.sales);
  assert.deepEqual(Object.keys(s.dekking), ['sales']);
  assert.deepEqual(Object.keys(s.filters).sort(), ['tot', 'van']);
  for (const k of ['kern', 'tijd', 'kwaliteit', 'onderdelen', 'klant', 'opties']) assert.ok(!(k in s), k);
});
