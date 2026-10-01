process.env.TZ = 'Europe/Brussels';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localISO } from '../public/js/kern/tijd.js';
import {
  TIMELINE_PX_PER_MIN, TIMELINE_MIN_BLOCK_PX, WERKUUR_START, WERKUUR_EIND,
  isBuitenWerkuren, timelineTopHeight, bepaalLanes, bouwTijdlijnItems,
  zichtbareDagen, maandRaster, autoScrollSleutel,
} from '../public/js/schermen/kalender-logica.js';

const isos = dagen => dagen.map(localISO);

test('constanten', () => {
  assert.equal(TIMELINE_PX_PER_MIN, 1.3);
  assert.equal(TIMELINE_MIN_BLOCK_PX, 155);
  assert.equal(WERKUUR_START, 510);
  assert.equal(WERKUUR_EIND, 1020);
});

// ── isBuitenWerkuren ──
test('isBuitenWerkuren: grenzen en ongeldige invoer', () => {
  assert.equal(isBuitenWerkuren('08:29'), true);
  assert.equal(isBuitenWerkuren('08:30'), false);
  assert.equal(isBuitenWerkuren('16:59'), false);
  assert.equal(isBuitenWerkuren('17:00'), true);
  assert.equal(isBuitenWerkuren('00:00'), true);
  assert.equal(isBuitenWerkuren('24:00'), false);
  assert.equal(isBuitenWerkuren('12:60'), false);
  assert.equal(isBuitenWerkuren('abc'), false);
  assert.equal(isBuitenWerkuren(''), false);
  assert.equal(isBuitenWerkuren(undefined), false);
});

// ── timelineTopHeight ──
test('timelineTopHeight: gewoon blok', () => {
  const { top, height } = timelineTopHeight(540, 660, 0, 1872); // 09:00–11:00
  assert.ok(Math.abs(top - 702) < 1e-9);
  assert.ok(Math.abs(height - 156) < 1e-9);
});

test('timelineTopHeight: minimumhoogte 155', () => {
  const { height } = timelineTopHeight(600, 630, 0, 1872); // 30 min = 39 px
  assert.equal(height, 155);
});

test('timelineTopHeight: laat blok blijft binnen de tijdlijn', () => {
  const { top, height } = timelineTopHeight(1410, 1440, 0, 1872); // 23:30
  assert.equal(height, 155);
  assert.ok(Math.abs(top - (1872 - 155)) < 1e-9);
});

test('timelineTopHeight: einde na middernacht wordt op 24:00 geknipt; start voor dagstart geeft top 0', () => {
  assert.equal(timelineTopHeight(0, 2000, 60, null).height, 1440 * TIMELINE_PX_PER_MIN);
  assert.equal(timelineTopHeight(0, 2000, 60, null).top, 0);
});

test('timelineTopHeight: zonder totalHeight geen correctie', () => {
  assert.ok(Math.abs(timelineTopHeight(1410, 1440, 0, null).top - 1410 * 1.3) < 1e-9);
});

// ── bepaalLanes ──
test('bepaalLanes: geen overlap = elk een eigen cluster met 1 laan', () => {
  const items = bepaalLanes([{ startMin: 480, endMin: 600 }, { startMin: 700, endMin: 820 }]);
  assert.deepEqual(items.map(i => [i.lane, i.laneCount]), [[0, 1], [0, 1]]);
});

test('bepaalLanes: twee overlappende = lanen 0 en 1, laneCount 2', () => {
  const items = bepaalLanes([{ startMin: 600, endMin: 720 }, { startMin: 660, endMin: 780 }]);
  assert.deepEqual(items.map(i => [i.lane, i.laneCount]), [[0, 2], [1, 2]]);
});

test('bepaalLanes: kort blok dat visueel (minimumhoogte) overlapt telt mee', () => {
  // 13:17–13:53 wordt ~119 min hoog getekend en loopt over het blok van 14:23
  const items = bepaalLanes([{ startMin: 797, endMin: 833 }, { startMin: 863, endMin: 983 }]);
  assert.deepEqual(items.map(i => [i.lane, i.laneCount]), [[0, 2], [1, 2]]);
});

test('bepaalLanes: drie keten-overlappende blokken vormen een cluster', () => {
  const items = bepaalLanes([
    { startMin: 480, endMin: 600 },
    { startMin: 540, endMin: 660 },
    { startMin: 650, endMin: 770 },
  ]);
  // A en C raken elkaar niet, maar B verbindt ze: één cluster met 2 lanen, C hergebruikt laan 0
  assert.deepEqual(items.map(i => [i.lane, i.laneCount]), [[0, 2], [1, 2], [0, 2]]);
});

test('bepaalLanes: geeft dezelfde items terug (muteert) en verwerkt een lege lijst', () => {
  const invoer = [{ startMin: 480, endMin: 600 }];
  assert.equal(bepaalLanes(invoer), invoer);
  assert.deepEqual(bepaalLanes([]), []);
});

// ── bouwTijdlijnItems ──
const opties = { duurVoor: id => (id === 1 ? 90 : 120), tijdslotMinuten: 180, duurMinuten: 120 };

test('bouwTijdlijnItems: ticket met uur en eigen duur, ticket zonder uur uitgesloten', () => {
  const dayStops = [{ uur: '09:00', ticket: { id: 1 } }, { ticket: { id: 2 } }, { uur: '', ticket: { id: 3 } }];
  const r = bouwTijdlijnItems({ dayStops, dayEvents: [], dayReports: [] }, opties);
  assert.equal(r.length, 1);
  assert.deepEqual([r[0].type, r[0].startMin, r[0].endMin], ['ticket', 540, 630]);
  assert.equal(r[0].stop, dayStops[0]);
});

test('bouwTijdlijnItems: afspraak zonder einduur = 60 min bij tijdslot 180; met einduur exact', () => {
  const dayEvents = [{ uur: '10:00' }, { uur: '10:00', einduur: '11:30' }, { titel: 'zonder uur' }];
  const r = bouwTijdlijnItems({ dayStops: [], dayEvents, dayReports: [] }, opties);
  assert.equal(r.length, 2);
  assert.deepEqual([r[0].type, r[0].startMin, r[0].endMin], ['event', 600, 660]);
  assert.deepEqual([r[1].startMin, r[1].endMin], [600, 690]);
});

test('bouwTijdlijnItems: afspraak-terugval volgt tijdslotMinuten / 3, zonder tijdslot 60', () => {
  const dayEvents = [{ uur: '10:00' }];
  const r1 = bouwTijdlijnItems({ dayStops: [], dayEvents, dayReports: [] }, { ...opties, tijdslotMinuten: 240 });
  assert.equal(r1[0].endMin, 680);
  const r2 = bouwTijdlijnItems({ dayStops: [], dayEvents, dayReports: [] }, { ...opties, tijdslotMinuten: undefined });
  assert.equal(r2[0].endMin, 660);
});

test('bouwTijdlijnItems: rapport zonder stop = start + duurMinuten, met stop exact, zonder start uitgesloten', () => {
  const dayReports = [
    { rapportData: { start: '13:00' } },
    { rapportData: { start: '13:00', stop: '14:15' } },
    { rapportData: {} },
    {},
  ];
  const r = bouwTijdlijnItems({ dayStops: [], dayEvents: [], dayReports }, opties);
  assert.equal(r.length, 2);
  assert.deepEqual([r[0].type, r[0].startMin, r[0].endMin], ['report', 780, 900]);
  assert.deepEqual([r[1].startMin, r[1].endMin], [780, 855]);
});

test('bouwTijdlijnItems: volgorde tickets, afspraken, rapporten', () => {
  const r = bouwTijdlijnItems({
    dayStops: [{ uur: '09:00', ticket: { id: 1 } }],
    dayEvents: [{ uur: '10:00' }],
    dayReports: [{ rapportData: { start: '11:00' } }],
  }, opties);
  assert.deepEqual(r.map(i => i.type), ['ticket', 'event', 'report']);
});

// ── zichtbareDagen ── (2026-10-07 is een woensdag)
const wd = [1, 2, 3, 4, 5];

test('zichtbareDagen: week = vijf werkdagen, met weekOffset', () => {
  const today = new Date(2026, 9, 7);
  assert.deepEqual(isos(zichtbareDagen(today, { werkdagen: wd, tabletStaand: false, weekOffset: 0, dagOffset: 0 })),
    ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']);
  assert.deepEqual(isos(zichtbareDagen(today, { werkdagen: wd, tabletStaand: false, weekOffset: 1, dagOffset: 0 })),
    ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']);
});

test('zichtbareDagen: andere werkdagen (ma, wo, za) en geen werkdagen', () => {
  const today = new Date(2026, 9, 7);
  assert.deepEqual(isos(zichtbareDagen(today, { werkdagen: [1, 3, 6], tabletStaand: false, weekOffset: 0, dagOffset: 0 })),
    ['2026-10-05', '2026-10-07', '2026-10-10']);
  assert.deepEqual(zichtbareDagen(today, { werkdagen: [], tabletStaand: false, weekOffset: 0, dagOffset: 0 }), []);
  assert.deepEqual(zichtbareDagen(today, { werkdagen: undefined, tabletStaand: true, weekOffset: 0, dagOffset: 0 }), []);
});

test('zichtbareDagen: tablet staand = 3 werkdagen vanaf vandaag', () => {
  const today = new Date(2026, 9, 7);
  assert.deepEqual(isos(zichtbareDagen(today, { werkdagen: wd, tabletStaand: true, weekOffset: 0, dagOffset: 0 })),
    ['2026-10-07', '2026-10-08', '2026-10-09']);
});

test('zichtbareDagen: tablet staand met positieve offset slaat het weekend over', () => {
  const today = new Date(2026, 9, 7);
  assert.deepEqual(isos(zichtbareDagen(today, { werkdagen: wd, tabletStaand: true, weekOffset: 0, dagOffset: 1 })),
    ['2026-10-08', '2026-10-09', '2026-10-12']);
});

test('zichtbareDagen: tablet staand met negatieve offset', () => {
  const today = new Date(2026, 9, 7);
  assert.deepEqual(isos(zichtbareDagen(today, { werkdagen: wd, tabletStaand: true, weekOffset: 0, dagOffset: -1 })),
    ['2026-10-06', '2026-10-07', '2026-10-08']);
  assert.deepEqual(isos(zichtbareDagen(today, { werkdagen: wd, tabletStaand: true, weekOffset: 0, dagOffset: -3 })),
    ['2026-10-02', '2026-10-05', '2026-10-06']);
});

test('zichtbareDagen: tablet staand en vandaag geen werkdag = eerstvolgende werkdag', () => {
  const zaterdag = new Date(2026, 9, 10);
  assert.deepEqual(isos(zichtbareDagen(zaterdag, { werkdagen: wd, tabletStaand: true, weekOffset: 0, dagOffset: 0 })),
    ['2026-10-12', '2026-10-13', '2026-10-14']);
});

test('zichtbareDagen: muteert today niet', () => {
  const today = new Date(2026, 9, 10);
  zichtbareDagen(today, { werkdagen: wd, tabletStaand: true, weekOffset: 0, dagOffset: 2 });
  assert.equal(localISO(today), '2026-10-10');
});

// ── maandRaster ──
test('maandRaster: oktober 2026 telt 42 dagen en start op maandag 28 september', () => {
  const r = maandRaster(new Date(2026, 9, 15));
  assert.equal(r.length, 42);
  assert.equal(localISO(r[0]), '2026-09-28');
  assert.equal(localISO(r[41]), '2026-11-08');
  assert.equal(r[0].getDay(), 1);
});

test('maandRaster: een maand die op maandag begint start op de 1e (juni 2026)', () => {
  const r = maandRaster(new Date(2026, 5, 1));
  assert.equal(localISO(r[0]), '2026-06-01');
});

test('maandRaster: een maand die op zondag begint start zes dagen eerder (februari 2026)', () => {
  const r = maandRaster(new Date(2026, 1, 20));
  assert.equal(localISO(r[0]), '2026-01-26');
});

test('maandRaster: elke datum staat op middernacht', () => {
  for (const d of maandRaster(new Date(2026, 9, 1))) assert.equal(d.getHours(), 0);
});

// ── autoScrollSleutel ──
test('autoScrollSleutel: weekstart en weergave', () => {
  assert.equal(autoScrollSleutel(new Date(2026, 9, 5), 'week'), '2026-10-05|week');
  assert.equal(autoScrollSleutel(new Date(2026, 9, 5), 'month'), '2026-10-05|month');
});

// ── Zomertijd-einde: zondag 25 oktober 2026 (03:00 → 02:00, Europe/Brussels) ──
// De week van 19–25 oktober bevat een dag van 25 uur; dagen tellen moet op kalenderdatums, niet op 24-uursblokken.
test('DST: zichtbareDagen over het einde van de zomertijd, week met en zonder zondag', () => {
  const woensdag = new Date(2026, 9, 21);
  assert.deepEqual(isos(zichtbareDagen(woensdag, { werkdagen: [1, 2, 3, 4, 5], tabletStaand: false, weekOffset: 0, dagOffset: 0 })),
    ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']);
  assert.deepEqual(isos(zichtbareDagen(woensdag, { werkdagen: [1, 2, 3, 4, 5, 6, 0], tabletStaand: false, weekOffset: 0, dagOffset: 0 })),
    ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
  // Zelf op de DST-zondag: nog dezelfde week; een week verder begint op maandag 26 oktober.
  const zondag = new Date(2026, 9, 25);
  assert.deepEqual(isos(zichtbareDagen(zondag, { werkdagen: [1, 2, 3, 4, 5], tabletStaand: false, weekOffset: 0, dagOffset: 0 })),
    ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']);
  assert.deepEqual(isos(zichtbareDagen(zondag, { werkdagen: [1, 2, 3, 4, 5], tabletStaand: false, weekOffset: 1, dagOffset: 0 })),
    ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']);
  assert.deepEqual(isos(zichtbareDagen(woensdag, { werkdagen: [1, 2, 3, 4, 5], tabletStaand: false, weekOffset: 1, dagOffset: 0 })),
    ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']);
});

test('DST: zichtbareDagen tablet staand slaat het weekend over rond de omschakeling', () => {
  const vrijdag = new Date(2026, 9, 23);
  const o = dagOffset => isos(zichtbareDagen(vrijdag, { werkdagen: [1, 2, 3, 4, 5], tabletStaand: true, weekOffset: 0, dagOffset }));
  assert.deepEqual(o(0), ['2026-10-23', '2026-10-26', '2026-10-27']);
  assert.deepEqual(o(1), ['2026-10-26', '2026-10-27', '2026-10-28']);
  assert.deepEqual(o(-1), ['2026-10-22', '2026-10-23', '2026-10-26']);
  // Vandaag is de DST-zondag (geen werkdag): eerstvolgende werkdag is maandag 26 oktober.
  const zondag = new Date(2026, 9, 25);
  assert.deepEqual(isos(zichtbareDagen(zondag, { werkdagen: [1, 2, 3, 4, 5], tabletStaand: true, weekOffset: 0, dagOffset: 0 })),
    ['2026-10-26', '2026-10-27', '2026-10-28']);
});

test('DST: maandRaster oktober en november 2026 telt elke kalenderdag precies één keer, op middernacht', () => {
  for (const [ref, eerste, laatste] of [[new Date(2026, 9, 1), '2026-09-28', '2026-11-08'], [new Date(2026, 10, 15), '2026-10-26', '2026-12-06']]) {
    const r = maandRaster(ref);
    assert.equal(r.length, 42);
    assert.equal(localISO(r[0]), eerste);
    assert.equal(localISO(r[41]), laatste);
    r.forEach((d, i) => {
      assert.equal(d.getHours(), 0);
      assert.equal(d.getMinutes(), 0);
      const verwacht = new Date(r[0].getFullYear(), r[0].getMonth(), r[0].getDate() + i);
      assert.equal(localISO(d), localISO(verwacht));
    });
    // Geen dubbele of ontbrekende datums, ook niet bij de omschakeling.
    assert.equal(new Set(isos(r)).size, 42);
  }
  const okt = isos(maandRaster(new Date(2026, 9, 1)));
  assert.ok(okt.includes('2026-10-25') && okt.includes('2026-10-26'));
  assert.equal(okt.indexOf('2026-10-26') - okt.indexOf('2026-10-25'), 1);
});

test('DST: bepaalLanes rekent in minuten en is dus onafhankelijk van de 25-uur-dag', () => {
  // Blokken rond het dubbele uur 02:00–03:00 en de late avond van zondag 25 oktober.
  const items = [
    { startMin: 2 * 60 + 30, endMin: 3 * 60 + 30 },
    { startMin: 3 * 60,      endMin: 4 * 60 },
    { startMin: 22 * 60,     endMin: 22 * 60 + 30 },
  ];
  bepaalLanes(items);
  assert.deepEqual(items.map(i => [i.lane, i.laneCount]), [[0, 2], [1, 2], [0, 1]]);
});
