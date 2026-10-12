// tests/spel-voortgang.test.mjs — de clientkant van de voortgang van Blitz Run: offline met de laatst bekende stand,
// een mislukte inzending wordt één keer later opnieuw geprobeerd, nooit blokkerend. Enkel nepjes, geen netwerk.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { maakVoortgang, HERPOGING_MS, OPSLAG_VOORVOEGSEL } from '../public/js/spel/spel-voortgang.js';
import { SKINS, standaardSkin } from '../public/js/spel/skins.js';
import { ontgrendeldeSkins } from '../public/js/spel/spel-regels.js';

const NU = Date.parse('2026-10-12T10:00:00Z');
const geheugen = () => { const m = new Map(); return { lees: (k) => m.get(k) ?? null, schrijf: (k, v) => m.set(k, v), m }; };
const goud = SKINS.find(s => s.soort === 'goud' && typeof s.drempel === 'number');

// Een nep-server die doet wat /api/spel doet: max-score, ontgrendelen op drempel.
function nepServer({ faalt = false } = {}) {
  const st = { besteScore: 0, gekozenSkin: standaardSkin(), oproepen: [], faalt };
  const api = async (pad, o = {}) => {
    st.oproepen.push({ pad, methode: o.methode ?? 'GET', body: o.body });
    if (st.faalt === 'netwerk') throw new TypeError('Failed to fetch');
    if (st.faalt) return { ok: false, status: st.faalt, data: { error: 'x' } };
    if (o.methode === 'POST') {
      st.besteScore = Math.max(st.besteScore, o.body.score);
      if (o.body.gekozenSkin) st.gekozenSkin = o.body.gekozenSkin;
    }
    return { ok: true, status: 200, data: { besteScore: st.besteScore, ontgrendeld: ontgrendeldeSkins({ besteScore: st.besteScore }), gekozenSkin: st.gekozenSkin } };
  };
  return { st, api };
}
const maak = (extra = {}) => {
  const ops = geheugen();
  const geplande = [];
  const server = nepServer(extra.server);
  const v = maakVoortgang({ api: server.api, opslag: ops, gebruikerId: 'u1', nu: () => NU, uitstel: (fn, ms) => geplande.push({ fn, ms }), ...extra.opties });
  return { v, ops, server, geplande };
};

test('beginstand zonder iets: score 0, de standaardskin gekozen en ontgrendeld', () => {
  const { v } = maak();
  assert.deepEqual(v.huidig(), { besteScore: 0, ontgrendeld: [standaardSkin()], gekozenSkin: standaardSkin() });
});

test('ververs: neemt de stand van de server over en bewaart een kopie per gebruiker', async () => {
  const { v, ops, server } = maak();
  server.st.besteScore = 321;
  await v.ververs();
  assert.equal(v.huidig().besteScore, 321);
  assert.ok(ops.m.has(OPSLAG_VOORVOEGSEL + 'u1'));
  assert.ok(!ops.m.has(OPSLAG_VOORVOEGSEL + 'u2'));
});

test('offline: ververs gooit niet en de laatst bekende stand blijft; een nieuwe sessie leest de kopie', async () => {
  const eerste = maak();
  eerste.server.st.besteScore = 80;
  await eerste.v.ververs();
  const tweede = maakVoortgang({ api: async () => { throw new TypeError('offline'); }, opslag: eerste.ops, gebruikerId: 'u1', nu: () => NU });
  assert.equal(tweede.huidig().besteScore, 80);
  await assert.doesNotReject(() => tweede.ververs());
  assert.equal(tweede.huidig().besteScore, 80);
  const andere = maakVoortgang({ api: async () => { throw new Error('x'); }, opslag: eerste.ops, gebruikerId: 'u2', nu: () => NU });
  assert.equal(andere.huidig().besteScore, 0, 'een ander account op hetzelfde toestel ziet de kopie niet');
});

test('een kapotte kopie wordt genegeerd', () => {
  const ops = geheugen();
  ops.schrijf(OPSLAG_VOORVOEGSEL + 'u1', '{kapot');
  const v = maakVoortgang({ api: async () => { throw new Error('x'); }, opslag: ops, gebruikerId: 'u1', nu: () => NU });
  assert.equal(v.huidig().besteScore, 0);
  const slecht = { lees: () => { throw new Error('geblokkeerd'); }, schrijf: () => { throw new Error('geblokkeerd'); } };
  assert.doesNotThrow(() => maakVoortgang({ api: async () => ({ ok: true, data: {} }), opslag: slecht }).meld(5));
});

test('meld: lokaal meteen bijgewerkt, daarna naar de server; geeft een nieuw record en nieuwe skins door', async () => {
  const { v, server } = maak();
  const r = v.meld(40);
  assert.equal(r.nieuweBeste, true);
  assert.equal(v.huidig().besteScore, 40, 'meteen lokaal, zonder te wachten op de server');
  assert.equal(await r.verzonden, true);
  assert.deepEqual(server.st.oproepen.at(-1), { pad: '/api/spel', methode: 'POST', body: { score: 40, gekozenSkin: standaardSkin() } });
  assert.equal(v.meld(10).nieuweBeste, false);
});

test('meld: een score op de drempel ontgrendelt lokaal een score-skin (en meldt ze)', { skip: !goud }, async () => {
  const { v } = maak();
  const r = v.meld(goud.drempel);
  assert.ok(r.nieuweSkins.includes(goud.id));
  assert.equal(v.kiesSkin(goud.id), true);
  assert.equal(v.huidig().gekozenSkin, goud.id);
});

test('kiesSkin: een vergrendelde of onbekende skin wordt geweigerd', { skip: !goud }, () => {
  const { v } = maak();
  assert.equal(v.kiesSkin(goud.id), false);
  assert.equal(v.kiesSkin('bestaat-niet'), false);
  assert.equal(v.huidig().gekozenSkin, standaardSkin());
});

test('een mislukte inzending wordt bewaard en precies één keer later opnieuw geprobeerd', async () => {
  const { v, server, geplande, ops } = maak({ server: { faalt: 'netwerk' } });
  const r = v.meld(55);
  assert.equal(await r.verzonden, false);
  assert.equal(v.heeftWachtend(), true);
  assert.equal(geplande.length, 1);
  assert.equal(geplande[0].ms, HERPOGING_MS);
  assert.ok(JSON.parse(ops.m.get(OPSLAG_VOORVOEGSEL + 'u1')).wachtend.score === 55, 'ook over een herstart heen bewaard');
  // de verbinding is terug: de herpoging slaagt
  server.st.faalt = false;
  await geplande[0].fn();
  assert.equal(v.heeftWachtend(), false);
  assert.equal(server.st.besteScore, 55);
});

test('een tweede mislukking plant geen derde poging (één herpoging); het wachtende blijft voor het volgende openen', async () => {
  const { v, server, geplande } = maak({ server: { faalt: 'netwerk' } });
  await v.meld(10).verzonden;
  assert.equal(geplande.length, 1);
  await geplande[0].fn();
  assert.equal(geplande.length, 1);
  assert.equal(v.heeftWachtend(), true);
  server.st.faalt = false;
  await v.ververs();
  assert.equal(v.heeftWachtend(), false);
  assert.equal(server.st.besteScore, 10);
});

test('meerdere mislukte spelletjes worden samengevoegd tot één inzending met de hoogste score', async () => {
  const { v, server, geplande } = maak({ server: { faalt: 500 } });
  await v.meld(30).verzonden;
  await v.meld(90).verzonden;
  await v.meld(60).verzonden;
  assert.equal(geplande.length, 1, 'niet voor elke mislukking een nieuwe timer');
  server.st.faalt = false;
  server.st.oproepen.length = 0;
  await geplande[0].fn();
  assert.equal(server.st.oproepen.filter(o => o.methode === 'POST').length, 1);
  assert.equal(server.st.besteScore, 90);
});

test('een definitieve weigering (4xx) wordt niet eindeloos herhaald', async () => {
  const { v, geplande } = maak({ server: { faalt: 400 } });
  assert.equal(await v.meld(5).verzonden, true);
  assert.equal(v.heeftWachtend(), false);
  assert.equal(geplande.length, 0);
});

test('events: een event-skin die op de datum actief is telt als ontgrendeld; de datum is die van Brussel', () => {
  const gezien = [];
  const ev = SKINS.find(s => s.soort === 'event');
  const { v } = maak({ opties: { actieveEvenementen: (d) => { gezien.push(d); return ev ? [{ id: ev.eventId }] : []; } } });
  assert.ok(gezien.every(d => d === '2026-10-12'));
  if (ev) assert.ok(v.huidig().ontgrendeld.includes(ev.id));
});

test('een actieveEvenementen die gooit stoort niets', () => {
  assert.doesNotThrow(() => maak({ opties: { actieveEvenementen: () => { throw new Error('x'); } } }));
});

// ---- I3: een geweigerde inzending mag de score nooit meer wegnemen; event-skins komen van de server ----
test('een 4xx op een inzending met skin: de score wordt nog eens enkel als score verstuurd (nooit verloren)', async () => {
  const oproepen = [];
  let st = { besteScore: 0 };
  const api = async (pad, o = {}) => {
    oproepen.push(o);
    if (o.methode !== 'POST') return { ok: true, status: 200, data: { besteScore: st.besteScore, ontgrendeld: [standaardSkin()], gekozenSkin: standaardSkin() } };
    if (o.body.gekozenSkin) return { ok: false, status: 400, data: { error: 'Deze skin is nog niet ontgrendeld.' } };
    st = { besteScore: Math.max(st.besteScore, o.body.score) };
    return { ok: true, status: 200, data: { besteScore: st.besteScore, ontgrendeld: [standaardSkin()], gekozenSkin: standaardSkin() } };
  };
  const v = maakVoortgang({ api, opslag: geheugen(), gebruikerId: 'u1', nu: () => NU, uitstel: () => {} });
  await v.meld(80).verzonden;
  assert.equal(st.besteScore, 80, 'de score bereikte de server');
  assert.equal(v.heeftWachtend(), false);
  assert.equal(v.huidig().gekozenSkin, standaardSkin());
});

test('skinGeweigerd in het antwoord: de gekozen skin valt terug op die van de server', async () => {
  const ev = SKINS.find(s => s.soort === 'event');
  const ops = geheugen();
  const api = async (pad, o = {}) => ({ ok: true, status: 200, data: { besteScore: 10, ontgrendeld: [standaardSkin()], gekozenSkin: standaardSkin(), ...(o.methode === 'POST' ? { skinGeweigerd: true } : {}) } });
  // lokale datum zegt: event actief; de server zegt van niet
  const v = maakVoortgang({ api, opslag: ops, gebruikerId: 'u1', nu: () => NU, uitstel: () => {}, actieveEvenementen: () => [{ id: ev.eventId }] });
  assert.ok(v.huidig().ontgrendeld.includes(ev.id), 'voorlopig: lokale schatting');
  assert.equal(v.kiesSkin(ev.id), true);
  await v.ververs();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(v.huidig().gekozenSkin, standaardSkin());
});

test('event-skins komen na een serverantwoord van de server: een lokale datum ontgrendelt niets meer (ook niet na herladen)', async () => {
  const ev = SKINS.find(s => s.soort === 'event');
  const ops = geheugen();
  const api = async () => ({ ok: true, status: 200, data: { besteScore: 0, ontgrendeld: [standaardSkin()], gekozenSkin: standaardSkin() } });
  const opties = { api, opslag: ops, gebruikerId: 'u1', nu: () => NU, uitstel: () => {}, actieveEvenementen: () => [{ id: ev.eventId }] };
  const v = maakVoortgang(opties);
  assert.ok(v.huidig().ontgrendeld.includes(ev.id));
  await v.ververs();
  assert.ok(!v.huidig().ontgrendeld.includes(ev.id), 'de server kent de event-skin niet');
  v.meld(0);
  assert.ok(!v.huidig().ontgrendeld.includes(ev.id), 'ook na een volgende melding niet');
  const opnieuw = maakVoortgang(opties);
  assert.ok(!opnieuw.huidig().ontgrendeld.includes(ev.id), 'ook na herladen uit de lokale kopie niet');
});
