// schermen/voorstel-register.js (B1): het voorstelregister bewaren zonder verlies. Nooit echte aanroepen: api.zetFetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { zetFetch } from '../public/js/kern/api.js';
import { bewaarVoorstelRegister, registerEntry, doelgroepenVoorAdressen } from '../public/js/schermen/voorstel-register.js';

test.afterEach(() => zetFetch(null));

const antwoord = (obj, status = 200) => new Response(JSON.stringify(obj), { status });
const T = '2026-10-05T07:00:00.000Z';
const basis = { ticketId: 'p1', doelgroepen: ['contact', 'klant'], tijdstip: T, tijdslot: '09:30–12:30', tijdslotDatum: '2026-10-08' };

// Nep-fetch: geeft de antwoorden van `rij` na elkaar en onthoudt de bodies.
function nepFetch(rij) {
  const posts = [];
  zetFetch(async (pad, init) => {
    assert.equal(pad, '/api/voorstel-status');
    posts.push(JSON.parse(init.body));
    const a = rij.shift();
    if (a instanceof Error) throw a;
    return a;
  });
  return posts;
}
function maakInvoer(start = 4, herlaadUitkomst = true) {
  let versie = start;
  const staat = { herladen: 0 };
  return {
    staat,
    leesVersie: () => versie,
    herlaad: async () => { staat.herladen++; if (herlaadUitkomst) versie = start + 10; return herlaadUitkomst; },
  };
}

test('bewaarVoorstelRegister: gewone poging slaagt met één POST en de meegegeven versie', async () => {
  const posts = nepFetch([antwoord({ ok: true, versie: 5 })]);
  const inv = maakInvoer();
  const r = await bewaarVoorstelRegister({ ...basis, leesVersie: inv.leesVersie, herlaad: inv.herlaad });
  assert.deepEqual(r, { ok: true, versie: 5 });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].versie, 4);
  assert.equal(inv.staat.herladen, 0);
});

test('409 daarna succes: herlaad wordt één keer aangeroepen en poging 2 gebruikt de nieuwe versie', async () => {
  const posts = nepFetch([antwoord({ error: 'conflict', serverVersie: 9 }, 409), antwoord({ ok: true, versie: 15 })]);
  const inv = maakInvoer();
  const r = await bewaarVoorstelRegister({ ...basis, leesVersie: inv.leesVersie, herlaad: inv.herlaad });
  assert.deepEqual(r, { ok: true, versie: 15 });
  assert.equal(inv.staat.herladen, 1);
  assert.deepEqual(posts.map(p => p.versie), [4, 14]);
});

test('twee keer 409: de derde POST heeft geen versie-veld en slaagt', async () => {
  const posts = nepFetch([antwoord({ error: 'c' }, 409), antwoord({ error: 'c' }, 409), antwoord({ ok: true, versie: 20 })]);
  const inv = maakInvoer();
  const r = await bewaarVoorstelRegister({ ...basis, leesVersie: inv.leesVersie, herlaad: inv.herlaad });
  assert.deepEqual(r, { ok: true, versie: 20 });
  assert.equal(posts.length, 3);
  assert.equal('versie' in posts[2], false);
  assert.equal(inv.staat.herladen, 1);
});

test('herlaad mislukt na een 409: meteen de versieloze poging', async () => {
  const posts = nepFetch([antwoord({ error: 'c' }, 409), antwoord({ ok: true, versie: 7 })]);
  const inv = maakInvoer(4, false);
  const r = await bewaarVoorstelRegister({ ...basis, leesVersie: inv.leesVersie, herlaad: inv.herlaad });
  assert.deepEqual(r, { ok: true, versie: 7 });
  assert.equal(posts.length, 2);
  assert.equal('versie' in posts[1], false);
});

test('500 of netwerkfout: stopt na één POST met ok:false (reden http/netwerk)', async () => {
  let posts = nepFetch([antwoord({ error: 'kapot' }, 500)]);
  let inv = maakInvoer();
  assert.deepEqual(await bewaarVoorstelRegister({ ...basis, leesVersie: inv.leesVersie, herlaad: inv.herlaad }), { ok: false, reden: 'http', status: 500 });
  assert.equal(posts.length, 1);
  posts = nepFetch([new TypeError('Failed to fetch')]);
  inv = maakInvoer();
  assert.deepEqual(await bewaarVoorstelRegister({ ...basis, leesVersie: inv.leesVersie, herlaad: inv.herlaad }), { ok: false, reden: 'netwerk' });
  assert.equal(posts.length, 1);
  // onleesbaar antwoord bij status ok
  posts = nepFetch([new Response('<html>', { status: 200 })]);
  inv = maakInvoer();
  assert.equal((await bewaarVoorstelRegister({ ...basis, leesVersie: inv.leesVersie, herlaad: inv.herlaad })).ok, false);
  assert.equal(posts.length, 1);
});

test('een fout bij de derde (versieloze) poging stopt ook: ok:false, nooit een vierde POST', async () => {
  const posts = nepFetch([antwoord({}, 409), antwoord({}, 409), antwoord({ error: 'kapot' }, 500), antwoord({ ok: true, versie: 1 })]);
  const inv = maakInvoer();
  const r = await bewaarVoorstelRegister({ ...basis, leesVersie: inv.leesVersie, herlaad: inv.herlaad });
  assert.deepEqual(r, { ok: false, reden: 'http', status: 500 });
  assert.equal(posts.length, 3);
});

test('nooit meer dan drie POSTs (ook niet als elke poging 409 geeft)', async () => {
  const posts = nepFetch([antwoord({}, 409), antwoord({}, 409), antwoord({}, 409), antwoord({}, 409)]);
  const inv = maakInvoer();
  const r = await bewaarVoorstelRegister({ ...basis, leesVersie: inv.leesVersie, herlaad: inv.herlaad });
  assert.equal(r.ok, false);
  assert.equal(posts.length, 3);
});

test('bodysleutelvolgorde: ticketId, doelgroepen, tijdstip, reset, versie, tijdslot, tijdslotDatum', async () => {
  const posts = nepFetch([antwoord({ ok: true, versie: 5 })]);
  const inv = maakInvoer();
  await bewaarVoorstelRegister({ ...basis, leesVersie: inv.leesVersie, herlaad: inv.herlaad });
  assert.deepEqual(Object.keys(posts[0]), ['ticketId', 'doelgroepen', 'tijdstip', 'reset', 'versie', 'tijdslot', 'tijdslotDatum']);
  assert.equal(posts[0].reset, true);
  // zonder tijdslot: geen tijdslotvelden
  const p2 = nepFetch([antwoord({ ok: true, versie: 6 })]);
  await bewaarVoorstelRegister({ ticketId: 'p1', doelgroepen: ['contact'], tijdstip: T, leesVersie: inv.leesVersie, herlaad: inv.herlaad });
  assert.deepEqual(Object.keys(p2[0]), ['ticketId', 'doelgroepen', 'tijdstip', 'reset', 'versie']);
});

test('registerEntry: doelgroepen met tijdstip en optioneel het tijdslot', () => {
  assert.deepEqual(registerEntry({ doelgroepen: ['contact', 'klant'], tijdstip: T, tijdslot: '09:30–12:30', tijdslotDatum: '2026-10-08' }),
    { contact: T, klant: T, tijdslot: '09:30–12:30', tijdslotDatum: '2026-10-08' });
  assert.deepEqual(registerEntry({ doelgroepen: ['klant'], tijdstip: T }), { klant: T });
  assert.deepEqual(registerEntry({ doelgroepen: ['klant'], tijdstip: T, tijdslot: '', tijdslotDatum: undefined }), { klant: T });
});

test('doelgroepenVoorAdressen: hoofdletters, ontdubbelen contact=klant, ontbrekend adres', () => {
  const t = { email: 'Luc@Test.be', emailEindklant: 'an@y.be', emailInstallateur: 'inst@z.be' };
  assert.deepEqual(doelgroepenVoorAdressen(t, ['luc@test.be', 'AN@y.be']), ['contact', 'klant']);
  assert.deepEqual(doelgroepenVoorAdressen(t, ['inst@z.be']), ['installateur']);
  assert.deepEqual(doelgroepenVoorAdressen(t, []), []);
  assert.deepEqual(doelgroepenVoorAdressen(t, ['onbekend@x.be']), []);
  // contact = klant: één adres telt maar één keer (bij contact)
  assert.deepEqual(doelgroepenVoorAdressen({ email: 'a@b.be', emailEindklant: 'A@B.be' }, ['a@b.be']), ['contact']);
  // ontbrekende velden
  assert.deepEqual(doelgroepenVoorAdressen({ emailEindklant: 'a@b.be' }, ['a@b.be']), ['klant']);
  assert.deepEqual(doelgroepenVoorAdressen(null, ['a@b.be']), []);
});
