// Blokrenderers van het performance-dashboard (Taak 19): zuivere stringbouwers op de fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { renderTijd } from '../public/js/schermen/beheer-performance-tijd.js';
import { renderKwaliteit } from '../public/js/schermen/beheer-performance-kwaliteit.js';
import { renderOnderdelen } from '../public/js/schermen/beheer-performance-onderdelen.js';
import { renderKlant } from '../public/js/schermen/beheer-performance-klant.js';
import { renderSales } from '../public/js/schermen/beheer-performance-sales.js';
import { LEGE_ZIN, groepeerPerWeek, weekStart } from '../public/js/schermen/beheer-performance-blokhulp.js';
import { STANDAARD_GRENZEN } from '../public/js/kern/dashboard-grenzen.js';

const data = JSON.parse(fs.readFileSync(new URL('../e2e/fixtures/dashboard.json', import.meta.url), 'utf8'));
const ctx = { grenzen: STANDAARD_GRENZEN, techniekers: data.opties.techniekers, filters: data.filters };
const BLOKKEN = { renderTijd, renderKwaliteit, renderOnderdelen, renderKlant, renderSales };
const tel = (s, re) => (s.match(re) ?? []).length;
const ringen = h => tel(h, /<svg class="ring-svg/g);

test('elk blok: geen NaN/undefined/[object en de testnaam <img src=x> / <b> komt nooit ongeëscaped voor [RF4]', () => {
  for (const [naam, render] of Object.entries(BLOKKEN)) {
    const h = render(data, ctx);
    assert.ok(h.length > 200, `${naam} is niet leeg`);
    for (const slecht of ['NaN', 'undefined', '[object', 'null']) assert.ok(!h.includes(slecht), `${naam} bevat ${slecht}`);
    assert.ok(!h.includes('<img src=x>'), `${naam}: ongeëscapete naam`);
    assert.ok(!h.includes('<b>Bart'), `${naam}: ongeëscapete verkopersnaam`);
  }
  assert.ok(renderTijd(data, ctx).includes('&lt;img src=x&gt;'), 'de naam is wel zichtbaar, maar veilig');
  assert.ok(renderSales(data, ctx).includes('Bart &lt;b&gt;Verhaegen'));
});

test('elk blok zonder ctx en zonder data valt niet om', () => {
  for (const render of Object.values(BLOKKEN)) {
    assert.ok(render(data).length > 0);
    assert.ok(render({}, undefined).includes(LEGE_ZIN));
    assert.ok(render(undefined, {}).includes(LEGE_ZIN));
  }
});

test('lege blokken (alle lijsten leeg) tonen de lege-toestand-zin en geen lege kaart', () => {
  const leeg = {
    tijd: { duurPer: { laadpaal: [], oorzaak: [], technieker: [], bezoektype: [] }, opTijdPerTechnieker: [], opTijdTotaal: { n: 0, teVroeg: 0, opTijd: 0, teLaat: 0, pct: null }, rijtijdPerDag: [], perDagPerTechnieker: { datums: [], techniekers: [], waarden: {} } },
    kwaliteit: { ftfPerTechnieker: [], ftfPerType: [], herhaal: { dagen: 30, aantal: 0, lijst: [] }, topOorzaken: [] },
    onderdelen: { top10: [], perMaand: { maanden: [], perTechnieker: {}, perType: {}, totaal: {} }, dekking: {} },
    klant: { bevestiging: { n: 0, buckets: [] }, bevestigdViaKnop: { n: 0, pct: null }, annulaties: null, garantie: { n: 0 }, installateurAlLangs: { n: 0, ja: 0, nee: 0, onbekend: 0, perPartner: [], perRegio: [] }, dekking: {} },
    sales: { perWeek: { weken: [], verkopers: [], waarden: {} }, resultaten: { totaal: 0, perSoort: [] }, wachtend: { n: 0, buckets: [], perVerkoper: [] } },
  };
  for (const [naam, render] of Object.entries(BLOKKEN)) {
    const h = render(leeg, ctx);
    assert.ok(h.includes(LEGE_ZIN), `${naam}: lege-toestand-zin`);
    assert.ok(!h.includes('dash-kaart'), `${naam}: geen lege kaart`);
  }
});

test('Tijd: vier duurkaarten, ringen per technieker met kop en verdeling, stiptheid, lijn- en kolomgrafiek', () => {
  const h = renderTijd(data, ctx);
  for (const t of ['laadpaaltype', 'oorzaak', 'technieker', 'type bezoek']) assert.ok(h.includes(`Gemiddelde duur per ${t}`), t);
  assert.ok(h.includes('1u33 (9×)'), 'duur in formatDuur (93,3 min = 1u33) met aantal');
  assert.equal(ringen(h), 3, 'één op-tijd-ring per technieker');
  assert.equal(tel(h, /class="dash-ring-kop"/g), 3, 'elke ring heeft een zichtbare kop');
  assert.ok(h.includes('% op tijd (alle bezoeken)'));
  assert.ok(h.includes('1 te vroeg · 4 op tijd · 0 te laat'), 'verdeling per technieker');
  assert.ok(h.includes('2 te vroeg · 7 op tijd · 1 te laat'), 'verdeling in de kaart Stiptheid');
  for (const w of ['Te vroeg', 'Op tijd', 'Te laat']) assert.ok(h.includes(`>${w}<`), w);
  assert.ok(h.includes('Aanrijtijd (schatting vanaf startlocatie) en werktijd per dag'));
  assert.ok(h.includes('grafiek--lijn') && h.includes('grafiek--kolommen'));
  assert.ok(h.includes('Interventies per dag per technieker'));
});

test('Tijd: ringstatus volgt de grenzen (80 % op tijd is "Let op" bij 90/75)', () => {
  const h = renderTijd(data, ctx);
  assert.ok(h.includes('ring--aandacht') && h.includes('Let op'));
  assert.ok(h.includes('ring--slecht') || h.includes('ring--goed'));
});

test('Tijd: techniekerkleur is stabiel over de grafieken (volgorde van ctx.techniekers)', () => {
  const h = renderTijd(data, { ...ctx, techniekers: ['Sam <img src=x>', 'Tim', 'Roel'] });
  assert.ok(h.includes('swatch--1') && h.includes('swatch--3'));
});

test('Tijd: lange periode (> 19 dagen) groepeert de lijn en kolommen per week', () => {
  const datums = Array.from({ length: 40 }, (_, i) => new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10));
  const lang = {
    ...data,
    tijd: {
      ...data.tijd,
      rijtijdPerDag: datums.map(d => ({ datum: d, aanrijtijdMin: 30, werktijdMin: 60, n: 1 })),
      perDagPerTechnieker: { datums, techniekers: ['Tim'], waarden: { Tim: Object.fromEntries(datums.map(d => [d, 1])) } },
    },
  };
  const h = renderTijd(lang, ctx);
  assert.ok(h.includes('per week') && !h.includes('per dag'));
  assert.ok(h.includes('wk 31 aug'), 'weeklabel');
  assert.ok(tel(h, /class="lijn-hit"/g) <= 7, 'weinig hit-stroken, geen overlap');
});

test('groepeerPerWeek: tot 19 punten dagen, daarboven weeksommen; weekStart = maandag', () => {
  const r = [{ waarden: [1, 2, 3] }];
  const kort = groepeerPerWeek(['2026-10-05', '2026-10-06', '2026-10-12'], r);
  assert.equal(kort.perWeek, false);
  assert.deepEqual(kort.punten, ['5 okt', '6 okt', '12 okt']);
  const d = Array.from({ length: 20 }, (_, i) => new Date(Date.UTC(2026, 9, 5 + i)).toISOString().slice(0, 10));
  const lang = groepeerPerWeek(d, [{ waarden: d.map(() => 1) }]);
  assert.equal(lang.perWeek, true);
  assert.deepEqual(lang.reeksen[0].waarden, [7, 7, 6]);
  assert.equal(weekStart('2026-10-11'), '2026-10-05');
  assert.equal(weekStart('2026-10-05'), '2026-10-05');
});

test('Kwaliteit: ringen per technieker en per type met kop, herhaaltegel, top-oorzaken', () => {
  const h = renderKwaliteit(data, ctx);
  assert.equal(ringen(h), 6, '3 techniekers + 3 types');
  assert.equal(tel(h, /class="dash-ring-kop"/g), 6);
  assert.ok(h.includes('tegel--herhaalbezoeken'));
  assert.ok(h.includes('Top-oorzaken per laadpaaltype') && h.includes('grafiek--balken'));
});

test('Kwaliteit: herhaallijst met "Open rapport"-knoppen (id), leesbaar toestel/adres, nooit de technische sleutel', () => {
  const h = renderKwaliteit(data, ctx);
  assert.equal(tel(h, /data-actie="dashboard-open-rapport" data-arg="h10"/g), 1);
  assert.equal(tel(h, /data-actie="dashboard-open-rapport" data-arg="h5"/g), 1, 'vorig rapport');
  assert.equal(tel(h, /data-actie="dashboard-open-rapport"/g), 8, '4 herhaalbezoeken × (dit + vorig)');
  assert.ok(h.includes('Serienummer CHARX-1002'));
  assert.ok(h.includes('Dorpsstraat 12, 3500 Hasselt'), 'adres uit het rapport bij een rapport zonder serienummer');
  assert.ok(h.includes('Klant h8'));
  assert.ok(!h.includes('adres:') && !h.includes('serie:') && !h.includes('dorpsstraat123500'), 'technische sleutel nooit zichtbaar');
});

test('Kwaliteit: herhaallijst van een oudere server (zonder serienummer/adres) toont toch geen technische sleutel', () => {
  const oud = structuredClone(data);
  for (const x of oud.kwaliteit.herhaal.lijst) { delete x.serienummer; delete x.adres; }
  const h = renderKwaliteit(oud, ctx);
  assert.ok(h.includes('Serienummer CHARX-1002') && h.includes('Adres onbekend'));
  assert.ok(!h.includes('adres:') && !h.includes('serie:'));
});

test('Kwaliteit: lijst is begrensd en meldt de rest', () => {
  const veel = structuredClone(data);
  veel.kwaliteit.herhaal.aantal = 55;
  veel.kwaliteit.herhaal.lijst = Array.from({ length: 55 }, (_, i) => ({ ...data.kwaliteit.herhaal.lijst[0], id: `x${i}`, vorigeId: `y${i}` }));
  const h = renderKwaliteit(veel, ctx);
  assert.equal(tel(h, /class="herhaal-rij"/g), 20);
  assert.ok(h.includes('nog 35 andere herhaalbezoeken'));
});

test('Onderdelen: top 10 met waarde ernaast; één maand = enkel tabellen, geen kolomgrafiek', () => {
  const h = renderOnderdelen(data, ctx);
  assert.ok(h.includes('Top 10 onderdelen') && h.includes('7× · € 56,00'));
  assert.ok(h.includes('Controller - CHARX 3000') && h.includes('€ 442,13'));
  assert.ok(!h.includes('grafiek--kolommen'), 'één maand: geen grafiek');
  assert.equal(tel(h, /<details class="tabel-twin" open>/g), 2, 'twee tabellen, per technieker en per type');
  assert.ok(h.includes('Verbruik per maand per technieker') && h.includes('Verbruik per maand per laadpaaltype'));
  assert.ok(h.includes('zonder prijs'), 'dekking: onderdeel zonder prijs');
});

test('Onderdelen: meerdere maanden = twee kolomgrafieken (geen schakelaar)', () => {
  const meer = structuredClone(data);
  const m = meer.onderdelen.perMaand;
  m.maanden = ['2026-09', '2026-10'];
  for (const groep of [m.perTechnieker, m.perType, m.totaal]) {
    if (groep['2026-10']) { groep['2026-09'] = { aantal: 1, waarde: 2 }; continue; }
    for (const k of Object.keys(groep)) groep[k]['2026-09'] = { aantal: 1, waarde: 2 };
  }
  const h = renderOnderdelen(meer, ctx);
  assert.equal(tel(h, /grafiek--kolommen/g), 2);
  assert.ok(h.includes('sep 2026') && h.includes('okt 2026'));
  assert.ok(!h.includes('NaN'));
});

test('Klant: bevestigingssnelheid, ring via de knop, annulatie-tegel met "sinds", garantie en installateur', () => {
  const h = renderKlant(data, ctx);
  assert.ok(h.includes('Bevestigingssnelheid') && h.includes('1u15') && h.includes('&lt;1u'));
  assert.ok(h.includes('Bevestigd via de knop'));
  assert.ok(h.includes('tegel--annulaties') && h.includes('Geteld sinds 1/9') && h.includes('vorige periode: 1'));
  assert.ok(h.includes('€ 690,00 garantie') && h.includes('€ 48,00 garantie'), 'loon en onderdelen per groep');
  assert.equal(ringen(h), 3, 'knop, garantie, installateur');
  assert.ok(h.includes('technieker- en laadpaalfilter geldt hier niet'));
});

test('Klant: "Installateur al langs geweest" = % Ja van Ja + Nee met de zin over onbekend; nergens "installateur gevuld"', () => {
  const h = renderKlant(data, ctx);
  assert.ok(h.includes('Installateur al langs geweest'));
  assert.ok(h.includes('70%') && h.includes('7 van 10'), '7 Ja van 7 + 3');
  assert.ok(h.includes('2 rapporten zonder antwoord (onbekend) tellen niet mee'));
  assert.ok(!/installateur gevuld/i.test(h));
  assert.ok(h.includes('Proxes') && h.includes('83 % (5 van 6)') && h.includes('Kempen'), 'aandeel Ja per partner en regio');
});

test('Klant: zonder annulatie-log geen cijfer maar een uitleg', () => {
  const geen = structuredClone(data);
  geen.klant.annulaties = { aantal: 0, vorige: 0, beschikbaar: false, vanaf: null };
  const h = renderKlant(geen, ctx);
  assert.ok(h.includes('geen gegevens') && h.includes('livegang van de logins'));
});

test('Sales: kolommen per verkoper per week, donut met vier legenderijen en totaal in het midden, wachtende leads', () => {
  const h = renderSales(data, ctx);
  assert.ok(h.includes('grafiek--kolommen') && h.includes('wk 28 sep'));
  assert.equal(tel(h.slice(h.indexOf('class="donut"')), /<li><span class="swatch/g) >= 4, true);
  const donut = h.slice(h.indexOf('<figure class="donut">'), h.indexOf('</figure>', h.indexOf('<figure class="donut">')));
  assert.equal(tel(donut, /<li>/g), 4, 'vier legenderijen');
  assert.ok(/swatch--1[^]*Offerte[^]*swatch--2[^]*Verkocht[^]*swatch--3[^]*Geen interesse[^]*swatch--4[^]*Opnieuw/.test(donut), 'vaste volgorde en slots');
  assert.ok(donut.includes('donut-groot') && donut.includes('>4<'), 'totaal in het midden');
  assert.ok(h.includes('Wachtende leads') && h.includes('7–14d') && h.includes('An Janssens'));
});

test('Sales: geen persoonsgegevens van klanten of leads', () => {
  const h = renderSales(data, ctx);
  assert.ok(!/@|klant|adres|telefoon|e-?mail/i.test(h.replace(/swatch|klein|class="[^"]*"/g, '')));
});

test('Klant: de ring "Bevestigd via de knop" volgt ctx.grenzen (ingestelde grens)', () => {
  const ring = h => h.slice(h.indexOf('Bevestigd via de knop')).match(/class="ring-svg ring--([a-z]+)"/)[1];
  assert.equal(ring(renderKlant(data, ctx)), 'neutraal', 'standaard geen grenzen');
  const eigen = { ...STANDAARD_GRENZEN, bevestigdViaKnop: { groen: 90, oranje: 70, richting: 'hoog' } };
  assert.equal(ring(renderKlant(data, { ...ctx, grenzen: eigen })), 'goed', '100 % >= 90');
});

test('Tijd: bij weekgroepering heet de eerste tabelkolom "Week"', () => {
  const datums = Array.from({ length: 25 }, (_, i) => new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10));
  const lang = { ...data, tijd: { ...data.tijd, rijtijdPerDag: datums.map(d => ({ datum: d, aanrijtijdMin: 30, werktijdMin: 60, n: 1 })) } };
  assert.ok(renderTijd(lang, ctx).includes('<th scope="col">Week</th>'));
  assert.ok(renderTijd(data, ctx).includes('<th scope="col">Dag</th>'));
});
