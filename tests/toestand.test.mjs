// tests/toestand.test.mjs — unit-tests voor kern/toestand.js
import { test, mock } from 'node:test';
import { strict as assert } from 'node:assert';
import { SLEUTELS, maakToestand, toestand } from '../public/js/kern/toestand.js';

const tick = () => Promise.resolve();

test('SLEUTELS en beginwaarden', () => {
  assert.equal(SLEUTELS.length, 10);
  const t = maakToestand();
  assert.deepEqual(t.get('allTickets'), []);
  assert.deepEqual(t.get('allPending'), []);
  assert.deepEqual(t.get('allGepland'), []);
  assert.deepEqual(t.get('planning'), {});
  assert.deepEqual(t.get('localEvents'), []);
  assert.deepEqual(t.get('avExceptions'), []);
  assert.deepEqual(t.get('klantBeschikbaarheid'), {});
  assert.deepEqual(t.get('voorstelStatus'), {});
  assert.equal(t.get('settings'), null);
  assert.equal(t.get('activeAssigneeFilter'), 'all');
  assert.ok(toestand.get);
});

test('bundelen: 3 sets op twee sleutels -> 1 aanroep met de juiste sleutels', async () => {
  const t = maakToestand();
  const calls = [];
  t.abonneer(['allTickets', 'planning'], (g) => calls.push([...g].sort()));
  t.set('allTickets', [1]);
  t.set('allTickets', [2]);
  t.set('planning', [3]);
  assert.equal(calls.length, 0);
  await tick();
  assert.deepEqual(calls, [['allTickets', 'planning']]);
});

test('abonnee wordt niet gebeld voor andere sleutels', async () => {
  const t = maakToestand();
  let n = 0;
  t.abonneer(['planning'], () => n++);
  t.set('allTickets', [1]);
  await tick();
  assert.equal(n, 0);
});

test('identieke primitieve verwittigt niet; identiek object via raak wel', async () => {
  const t = maakToestand();
  let n = 0;
  t.abonneer(['activeAssigneeFilter', 'allTickets'], () => n++);
  t.set('activeAssigneeFilter', 'all');
  await tick();
  assert.equal(n, 0);
  t.set('activeAssigneeFilter', 'Tim');
  await tick();
  assert.equal(n, 1);
  const lijst = t.get('allTickets');
  t.set('allTickets', lijst); // zelfde array: objecten verwittigen altijd
  await tick();
  assert.equal(n, 2);
  lijst.push(1);
  t.raak('allTickets');
  await tick();
  assert.equal(n, 3);
  assert.equal(t.get('allTickets'), lijst); // live referentie
});

test('patch maakt een nieuw object', async () => {
  const t = maakToestand({ klantBeschikbaarheid: { a: 1 } });
  const oud = t.get('klantBeschikbaarheid');
  let n = 0;
  t.abonneer(['klantBeschikbaarheid'], () => n++);
  t.patch('klantBeschikbaarheid', { b: 2 });
  assert.notEqual(t.get('klantBeschikbaarheid'), oud);
  assert.deepEqual(t.get('klantBeschikbaarheid'), { a: 1, b: 2 });
  assert.deepEqual(oud, { a: 1 });
  await tick();
  assert.equal(n, 1);
});

test('onbekende sleutel gooit', () => {
  const t = maakToestand();
  assert.throws(() => t.set('nope', 1), /nope/);
  assert.throws(() => t.get('nope'), /nope/);
  assert.throws(() => t.raak('nope'), /nope/);
  assert.throws(() => t.abonneer(['nope'], () => {}), /nope/);
});

test('transactie spoelt synchroon aan het einde, niet eerder (ook genest)', async () => {
  const t = maakToestand();
  let n = 0;
  t.abonneer(['allTickets', 'planning'], () => n++);
  t.transactie(() => {
    t.set('allTickets', [1]);
    t.transactie(() => {
      t.set('planning', [2]);
    });
    assert.equal(n, 0);
  });
  assert.equal(n, 1);
  await tick();
  assert.equal(n, 1);
});

test('transactie spoelt ook bij een fout, en gooit de fout opnieuw', async () => {
  const t = maakToestand();
  let n = 0;
  t.abonneer(['allTickets'], () => n++);
  assert.throws(() => t.transactie(() => { t.set('allTickets', [1]); throw new Error('boem'); }), /boem/);
  assert.equal(n, 1);
  // diepte is hersteld: nieuwe set bundelt weer via microtask
  t.set('allTickets', [2]);
  assert.equal(n, 1);
  await tick();
  assert.equal(n, 2);
});

test('transactie geeft de returnwaarde terug', () => {
  const t = maakToestand();
  assert.equal(t.transactie(() => 42), 42);
});

test('spoel() spoelt meteen', () => {
  const t = maakToestand();
  let n = 0;
  t.abonneer(['allTickets'], () => n++);
  t.set('allTickets', [1]);
  t.spoel();
  assert.equal(n, 1);
});

test('abonnee die een andere sleutel schrijft -> tweede ronde', async () => {
  const t = maakToestand();
  const log = [];
  t.abonneer(['allTickets'], () => { log.push('A'); t.set('planning', [1]); });
  t.abonneer(['planning'], (g) => log.push('B:' + [...g].join()));
  t.set('allTickets', [1]);
  await tick();
  assert.deepEqual(log, ['A', 'B:planning']);
});

test('lusbeveiliging: eigen sleutel blijven schrijven -> afgebroken na 10 rondes', async () => {
  const t = maakToestand();
  const err = mock.method(console, 'error', () => {});
  try {
    let n = 0;
    t.abonneer(['allTickets'], () => { n++; t.set('allTickets', []); });
    t.set('allTickets', []);
    await tick();
    assert.equal(n, 10);
    assert.equal(err.mock.callCount(), 1);
    assert.equal(err.mock.calls[0].arguments[0], 'toestand: renderlus afgebroken');
    assert.deepEqual(err.mock.calls[0].arguments[1], ['allTickets']);
    // resterende wijzigingen gewist: geen verdere aanroepen
    await tick();
    assert.equal(n, 10);
    // en de store werkt daarna normaal
    t.set('planning', [1]);
    await tick();
    assert.equal(n, 10);
  } finally {
    err.mock.restore();
  }
});

test('gooiende abonnee breekt een tweede niet', async () => {
  const t = maakToestand();
  const err = mock.method(console, 'error', () => {});
  try {
    let n = 0;
    t.abonneer(['allTickets'], () => { throw new Error('stuk'); });
    t.abonneer(['allTickets'], () => n++);
    t.set('allTickets', [1]);
    await tick();
    assert.equal(n, 1);
    assert.equal(err.mock.callCount(), 1);
  } finally {
    err.mock.restore();
  }
});

test('afmelden werkt', async () => {
  const t = maakToestand();
  let n = 0;
  const af = t.abonneer(['allTickets'], () => n++);
  t.set('allTickets', [1]);
  await tick();
  af();
  t.set('allTickets', [2]);
  await tick();
  assert.equal(n, 1);
});

test('zetOmhulling wikkelt de flush (eenmaal per flush)', async () => {
  const t = maakToestand();
  const log = [];
  t.zetOmhulling((flush) => { log.push('voor'); flush(); log.push('na'); });
  t.abonneer(['allTickets'], () => log.push('abonnee'));
  t.abonneer(['planning'], () => log.push('abonnee2'));
  t.set('allTickets', [1]);
  t.set('planning', [1]);
  await tick();
  assert.deepEqual(log, ['voor', 'abonnee', 'abonnee2', 'na']);
});

test('registratievolgorde bepaalt uitvoervolgorde', async () => {
  const t = maakToestand();
  const log = [];
  t.abonneer(['planning'], () => log.push(1));
  t.abonneer(['allTickets'], () => log.push(2));
  t.abonneer(['allTickets', 'planning'], () => log.push(3));
  t.set('allTickets', [1]);
  t.set('planning', [1]);
  await tick();
  assert.deepEqual(log, [1, 2, 3]);
});

test('afmelden tijdens flush: afgemelde abonnee wordt overgeslagen', async () => {
  const t = maakToestand();
  const log = [];
  let afB;
  t.abonneer(['allTickets'], () => { log.push('A'); afB(); });
  afB = t.abonneer(['allTickets'], () => log.push('B'));
  t.set('allTickets', [1]);
  await tick();
  assert.deepEqual(log, ['A']);
});

test('abonneer met een string als sleutel', async () => {
  const t = maakToestand();
  let n = 0;
  t.abonneer('allTickets', () => n++);
  t.set('allTickets', [1]);
  await tick();
  assert.equal(n, 1);
});

test('omhulling die gooit: wacht blijft niet hangen', async () => {
  const t = maakToestand();
  const err = mock.method(console, 'error', () => {});
  try {
    let n = 0;
    t.abonneer(['allTickets'], () => n++);
    t.zetOmhulling(() => { throw new Error('omhulling stuk'); });
    t.set('allTickets', [1]);
    await tick();
    assert.equal(n, 0);
    assert.equal(err.mock.callCount(), 1);
    t.zetOmhulling(null);
    t.set('planning', {});
    await tick();
    assert.equal(n, 0); // oude wijziging is gewist, niet alsnog uitgevoerd
    t.set('allTickets', [2]);
    await tick();
    assert.equal(n, 1);
  } finally {
    err.mock.restore();
  }
});

test('omhulling die de flush nooit aanroept: wacht gewist en gelogd', async () => {
  const t = maakToestand();
  const err = mock.method(console, 'error', () => {});
  try {
    t.zetOmhulling(() => {});
    t.set('allTickets', [1]);
    await tick();
    assert.equal(err.mock.callCount(), 1);
    t.zetOmhulling(null);
    let n = 0;
    t.abonneer(['allTickets'], () => n++);
    t.spoel();
    assert.equal(n, 0);
  } finally {
    err.mock.restore();
  }
});

test('omhulling wikkelt alle rondes in één keer en draait niet zonder wijziging', async () => {
  const t = maakToestand();
  let omhullingen = 0;
  const log = [];
  t.zetOmhulling((flush) => { omhullingen++; log.push('voor'); flush(); log.push('na'); });
  t.abonneer(['allTickets'], () => { log.push('A'); t.set('planning', {}); });
  t.abonneer(['planning'], () => log.push('B'));
  t.spoel();
  assert.equal(omhullingen, 0);
  t.set('allTickets', [1]);
  await tick();
  assert.equal(omhullingen, 1);
  assert.deepEqual(log, ['voor', 'A', 'B', 'na']);
  t.set('activeAssigneeFilter', 'all'); // identieke primitieve: geen wijziging
  await tick();
  assert.equal(omhullingen, 1);
});
