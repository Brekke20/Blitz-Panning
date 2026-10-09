// tests/gebruikers-lib.test.mjs — netlify/lib/gebruikers.js + blob-wijzig.js
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { maakNepStore } from './nep-blobs.mjs';
import { wijzigBlob } from '../netlify/lib/blob-wijzig.js';
import {
  ROLLEN_LIJST, leesGebruikers, publiek, beheerWeergave, normaliseerEmail, normaliseerNaam,
  valideerNieuweGebruiker, pasWijzigingToe, zohoNaamBezet, kanWijzigen, wijzigGebruikers, nieuwId, leesLaatsteLogins, schrijfLaatsteLogin,
} from '../netlify/lib/gebruikers.js';

const basis = { email: 'Tim@Blitz.be', naam: ' Tim Janssens ', rol: 'planner' };

test('ROLLEN_LIJST', () => {
  assert.deepEqual(ROLLEN_LIJST, ['beheerder', 'planner', 'technieker', 'sales']);
});

test('valideerNieuweGebruiker: weigert ongeldige invoer', () => {
  assert.ok(valideerNieuweGebruiker({ ...basis, email: 'geen-adres' }).fout);
  assert.ok(valideerNieuweGebruiker({ ...basis, email: '' }).fout);
  assert.ok(valideerNieuweGebruiker({ ...basis, rol: 'baas' }).fout);
  assert.ok(valideerNieuweGebruiker({ ...basis, naam: '   ' }).fout);
  assert.ok(valideerNieuweGebruiker({ ...basis, rol: 'technieker' }).fout);
  assert.ok(valideerNieuweGebruiker({ ...basis, rol: 'technieker', zohoNaam: '  ' }).fout);
  assert.ok(valideerNieuweGebruiker({ ...basis, rol: 'sales' }).fout);
  assert.ok(valideerNieuweGebruiker(null).fout);
  assert.ok(valideerNieuweGebruiker({ ...basis, naam: 'x'.repeat(101) }).fout);
});

test('valideerNieuweGebruiker: normaliseert en bewaart enkel relevante velden', () => {
  const r = valideerNieuweGebruiker(basis);
  assert.equal(r.fout, undefined);
  assert.deepEqual(r.waarden, { email: 'tim@blitz.be', naam: 'Tim Janssens', rol: 'planner' });
  const t = valideerNieuweGebruiker({ ...basis, rol: 'technieker', zohoNaam: ' Tim J ', salesNaam: 'x', magAlleSales: true });
  assert.deepEqual(t.waarden, { email: 'tim@blitz.be', naam: 'Tim Janssens', rol: 'technieker', zohoNaam: 'Tim J' });
  const s = valideerNieuweGebruiker({ ...basis, rol: 'sales', salesNaam: 'Ward Houwen', magAlleSales: true });
  assert.deepEqual(s.waarden, { email: 'tim@blitz.be', naam: 'Tim Janssens', rol: 'sales', salesNaam: 'Ward Houwen', magAlleSales: true });
  const s2 = valideerNieuweGebruiker({ ...basis, rol: 'sales', salesNaam: 'Ward Houwen' });
  assert.equal(s2.waarden.magAlleSales, false);
});

test('normaliseerEmail en normaliseerNaam', () => {
  assert.equal(normaliseerEmail('  A@B.Be '), 'a@b.be');
  assert.equal(normaliseerNaam(' Tim  Janssens '), 'tim janssens');
});

const volleGebruiker = {
  id: 'u-1', email: 'a@b.be', naam: 'A', rol: 'beheerder', actief: true,
  wachtwoordHash: 'scrypt$geheim', herstelcodes: ['h1'], sessieVersie: 4, moetWachtwoordWijzigen: true,
  aangemaakt: '2026-10-01T00:00:00.000Z', zohoNaam: 'Z', salesNaam: 'S', magAlleSales: true,
};

test('publiek bevat nooit hashes of sessieVersie', () => {
  const p = publiek(volleGebruiker);
  assert.deepEqual(Object.keys(p).sort(), ['email', 'id', 'magAlleSales', 'naam', 'rol', 'salesNaam', 'zohoNaam']);
  const json = JSON.stringify(p);
  for (const verboden of ['wachtwoordHash', 'herstelcodes', 'sessieVersie', 'geheim']) assert.ok(!json.includes(verboden));
  assert.deepEqual(publiek({ id: 'u-2', email: 'x@y.be', naam: 'X', rol: 'planner' }), { id: 'u-2', email: 'x@y.be', naam: 'X', rol: 'planner' });
});

test('beheerWeergave: laatsteLogin uit het argument, geen hashes', () => {
  const w = beheerWeergave(volleGebruiker, '2026-10-08T08:00:00.000Z');
  assert.equal(w.laatsteLogin, '2026-10-08T08:00:00.000Z');
  assert.equal(w.actief, true);
  assert.equal(w.aangemaakt, '2026-10-01T00:00:00.000Z');
  assert.equal(w.moetWachtwoordWijzigen, true);
  assert.ok(!('wachtwoordHash' in w) && !('herstelcodes' in w) && !('sessieVersie' in w));
  assert.equal(beheerWeergave(volleGebruiker).laatsteLogin, null);
});

test('kanWijzigen: laatste actieve beheerder is beschermd', () => {
  const een = [{ id: 'b1', rol: 'beheerder', actief: true }, { id: 'p1', rol: 'planner', actief: true }, { id: 'b2', rol: 'beheerder', actief: false }];
  assert.equal(kanWijzigen(een, 'b1', { actief: false }).ok, false);
  assert.equal(kanWijzigen(een, 'b1', { rol: 'planner' }).ok, false);
  assert.ok(kanWijzigen(een, 'b1', { actief: false }).fout);
  assert.equal(kanWijzigen(een, 'b1', { rol: 'beheerder' }).ok, true);
  assert.equal(kanWijzigen(een, 'p1', { actief: false }).ok, true);
  assert.equal(kanWijzigen(een, 'onbekend', { actief: false }).ok, false);
  const twee = [...een.slice(0, 2), { id: 'b2', rol: 'beheerder', actief: true }];
  assert.equal(kanWijzigen(twee, 'b1', { actief: false }).ok, true);
  assert.equal(kanWijzigen(twee, 'b1', { rol: 'planner' }).ok, true);
});

test('nieuwId heeft de vorm u-<12 hex> en is uniek', () => {
  const a = nieuwId(), b = nieuwId();
  assert.match(a, /^u-[0-9a-f]{12}$/);
  assert.notEqual(a, b);
});

test('leesGebruikers: [] bij ontbreken, anders de lijst', async () => {
  assert.deepEqual(await leesGebruikers(maakNepStore()), []);
  const s = maakNepStore({ gebruikers: { versie: 2, gebruikers: [{ id: 'u-1' }] } });
  assert.deepEqual(await leesGebruikers(s), [{ id: 'u-1' }]);
});

test('wijzigGebruikers: schrijft met versie + 1 en geeft de nieuwe lijst terug', async () => {
  const s = maakNepStore();
  const r = await wijzigGebruikers(s, g => [...g, { id: 'u-1' }]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.gebruikers, [{ id: 'u-1' }]);
  assert.deepEqual(await s.get('gebruikers', { type: 'json' }), { versie: 1, gebruikers: [{ id: 'u-1' }] });
  const r2 = await wijzigGebruikers(s, () => null);
  assert.equal(r2.ok, true);
  assert.equal((await s.get('gebruikers', { type: 'json' })).versie, 1, 'null = niets doen');
});

test('wijzigGebruikers: twee gelijktijdige wijzigingen eindigen met beide (controle-na-schrijven herhaalt)', async () => {
  const s = maakNepStore();
  await Promise.all([
    wijzigGebruikers(s, g => [...g, { id: 'u-a' }]),
    wijzigGebruikers(s, g => [...g, { id: 'u-b' }]),
  ]);
  const ids = (await leesGebruikers(s)).map(g => g.id).sort();
  assert.deepEqual(ids, ['u-a', 'u-b']);
});

test('wijzigBlob: geeft ok:false na het opgegeven aantal mislukte pogingen', async () => {
  const s = maakNepStore();
  const r = await wijzigBlob(s, 'x', { leeg: { versie: 0, n: 0 }, wijzig: h => ({ ...h, n: h.n + 1 }), controleer: () => false, pogingen: 3 });
  assert.equal(r.ok, false);
  assert.equal(s._schrijfacties.filter(a => a.key === 'x').length, 3);
});

test('wijzigBlob: null = niets schrijven; leeg wordt gebruikt zonder blob', async () => {
  const s = maakNepStore();
  const r = await wijzigBlob(s, 'x', { leeg: { versie: 0 }, wijzig: () => null });
  assert.deepEqual(r, { ok: true, waarde: { versie: 0 } });
  assert.equal(s._schrijfacties.length, 0);
});

test('schrijfLaatsteLogin: schrijft enkel login-laatst, nooit gebruikers', async () => {
  const s = maakNepStore({ gebruikers: { versie: 3, gebruikers: [{ id: 'u-1' }] } });
  await schrijfLaatsteLogin(s, 'u-1', '2026-10-08T08:00:00.000Z');
  assert.ok(s._schrijfacties.length > 0);
  assert.ok(s._schrijfacties.every(a => a.key === 'login-laatst'));
  assert.deepEqual(await leesLaatsteLogins(s), { 'u-1': '2026-10-08T08:00:00.000Z' });
  assert.deepEqual(await s.get('gebruikers', { type: 'json' }), { versie: 3, gebruikers: [{ id: 'u-1' }] });
});

test('schrijfLaatsteLogin: twee gelijktijdige schrijfacties voor verschillende gebruikers bewaren beide', async () => {
  const s = maakNepStore();
  await Promise.all([
    schrijfLaatsteLogin(s, 'u-1', '2026-10-08T08:00:00.000Z'),
    schrijfLaatsteLogin(s, 'u-2', '2026-10-08T09:00:00.000Z'),
  ]);
  assert.deepEqual(await leesLaatsteLogins(s), { 'u-1': '2026-10-08T08:00:00.000Z', 'u-2': '2026-10-08T09:00:00.000Z' });
});

test('leesLaatsteLogins: {} zonder blob', async () => {
  assert.deepEqual(await leesLaatsteLogins(maakNepStore()), {});
});

// ---- Zoho-naam op elk account (beheerder, planner, technieker; nooit sales) ----
test('valideerNieuweGebruiker: beheerder en planner mogen een zohoNaam hebben (optioneel); sales nooit', () => {
  for (const rol of ['beheerder', 'planner']) {
    assert.deepEqual(valideerNieuweGebruiker({ ...basis, rol, zohoNaam: ' Brent C ' }).waarden, { email: 'tim@blitz.be', naam: 'Tim Janssens', rol, zohoNaam: 'Brent C' });
    assert.equal(valideerNieuweGebruiker({ ...basis, rol, zohoNaam: '   ' }).waarden.zohoNaam, undefined);
    assert.equal(valideerNieuweGebruiker({ ...basis, rol }).fout, undefined);
  }
  const s = valideerNieuweGebruiker({ ...basis, rol: 'sales', salesNaam: 'W', zohoNaam: 'Tim' });
  assert.equal(s.waarden.zohoNaam, undefined);
  assert.ok(valideerNieuweGebruiker({ ...basis, rol: 'planner', zohoNaam: 'x'.repeat(101) }).fout);
});

test('pasWijzigingToe: een planner houdt zijn zohoNaam; een zohoNaam toevoegen, wijzigen of wissen staat in gewijzigd; sales verliest hem', () => {
  const planner = { id: 'u-p', email: 'p@b.be', naam: 'Pia', rol: 'planner', actief: true, sessieVersie: 1 };
  const metNaam = pasWijzigingToe(planner, { zohoNaam: 'Pia Z' });
  assert.equal(metNaam.nieuw.zohoNaam, 'Pia Z');
  assert.deepEqual(metNaam.gewijzigd, ['zohoNaam']);
  assert.equal(metNaam.nieuw.sessieVersie, 1);
  assert.deepEqual(pasWijzigingToe(metNaam.nieuw, { naam: 'Pia 2' }).nieuw.zohoNaam, 'Pia Z');
  const gewist = pasWijzigingToe(metNaam.nieuw, { zohoNaam: '' });
  assert.equal(gewist.nieuw.zohoNaam, undefined);
  assert.deepEqual(gewist.gewijzigd, ['zohoNaam']);
  const naarSales = pasWijzigingToe(metNaam.nieuw, { rol: 'sales', salesNaam: 'S' });
  assert.equal(naarSales.nieuw.zohoNaam, undefined);
});

test('zohoNaamBezet: genormaliseerd (hoofdletters, spaties), behalve het eigen account', () => {
  const lijst = [
    { id: 'a', naam: 'A', rol: 'technieker', zohoNaam: 'Tim  Van Dijk' },
    { id: 'b', naam: 'B', rol: 'planner' },
    { id: 'c', naam: 'C', rol: 'beheerder', zohoNaam: 'Brent' },
  ];
  assert.equal(zohoNaamBezet(lijst, ' tim van dijk', 'x')?.id, 'a');
  assert.equal(zohoNaamBezet(lijst, 'Brent', 'x')?.id, 'c');
  assert.equal(zohoNaamBezet(lijst, 'Brent', 'c'), null);
  assert.equal(zohoNaamBezet(lijst, 'Nieuw', 'x'), null);
  assert.equal(zohoNaamBezet(lijst, '', 'x'), null);
  assert.equal(zohoNaamBezet(undefined, 'Tim', 'x'), null);
});
