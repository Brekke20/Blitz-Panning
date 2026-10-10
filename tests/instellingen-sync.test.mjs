// Tests voor kern/instellingen-sync.js (logins T16): de server is de bron, localStorage de synchrone cache.
import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  synchroniseerInstellingen, bewaarOpServer, wisInstellingenCache,
  heeftVuileInstellingen, MARKER_SLEUTEL, VUIL_SLEUTEL, neemEigenOver, resterendSyncBudget, spiegelEigen, eigenSleutels,
} from '../public/js/kern/instellingen-sync.js';

const maakOpslag = (begin = {}) => {
  const m = new Map(Object.entries(begin).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  return {
    getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); },
    get length() { return m.size; }, key: i => [...m.keys()][i] ?? null,
    sleutels: () => [...m.keys()].sort(), json: k => (m.has(k) ? JSON.parse(m.get(k)) : null),
  };
};
const httpFout = status => Object.assign(new Error('HTTP ' + status), { name: 'ApiFout', status });
const netFout = () => Object.assign(new TypeError('Failed to fetch'), { vanFetch: true });

const PLANNER = { id: 'u-pl', rol: 'planner', zohoNaam: null };
const TIM = { id: 'u-tim', rol: 'technieker', zohoNaam: 'Tim' };
const TECHNIEKERS = { Tim: { gebruikerId: 'u-tim', instellingen: null }, Roel: { gebruikerId: 'u-roel', instellingen: null } };
const ovz = (eigen, techniekers = TECHNIEKERS) => ({ eigen, techniekers });
const S = (extra = {}) => ({ startlocatie: 'Server 1', duurMinuten: 90, ...extra });

// Nep-apiJson: GET ?overzicht=1 geeft `overzicht` (of gooit), PUT volgt `put` (functie(body) -> antwoord of gooit).
function nepApiJson({ overzicht, put = () => ({ versie: 1 }) } = {}) {
  const puts = [];
  const f = async (pad, opties = {}) => {
    if ((opties.methode ?? 'GET') === 'GET') {
      if (overzicht instanceof Error) throw overzicht;
      assert.equal(pad, '/api/instellingen?overzicht=1');
      return structuredClone(overzicht);
    }
    assert.equal(pad, '/api/instellingen');
    puts.push(opties.body);
    return put(opties.body);
  };
  f.puts = puts;
  return f;
}
// Nep-apiVerzoek voor bewaarOpServer: { ok, status, data }.
// Sinds merge-review I2 haalt bewaarOpServer voor een ANDERE persoon eerst het overzicht op (GET ?overzicht=1, `techniekers` = het serverrecord
// per technieker) en legt de lokale velden daarop; een mislukt antwoord (`antwoord` is een fout of niet-ok) geldt ook voor die GET.
function nepApiVerzoek(antwoord = { ok: true, status: 200, data: { versie: 1 } }, techniekers = {}) {
  const puts = [];
  const gets = [];
  const f = async (pad, opties) => {
    if (pad === '/api/instellingen?overzicht=1') {
      gets.push(pad);
      if (antwoord instanceof Error) throw antwoord;
      if (typeof antwoord !== 'function' && antwoord.ok === false) return antwoord;
      return { ok: true, status: 200, data: { eigen: {}, techniekers: structuredClone(techniekers) } };
    }
    assert.equal(pad, '/api/instellingen');
    assert.equal(opties.methode, 'PUT');
    puts.push(opties.body);
    const a = typeof antwoord === 'function' ? antwoord(opties.body) : antwoord;
    if (a instanceof Error) throw a;
    return a;
  };
  f.puts = puts;
  f.gets = gets;
  return f;
}
// Laadt de overzicht-cache van de module (techniekers-id's) voor bewaarOpServer.
const laadCache = (gebruiker, opslag, overzicht) => synchroniseerInstellingen(gebruiker, { apiJson: nepApiJson({ overzicht }), opslag });

beforeEach(() => wisInstellingenCache(maakOpslag())); // module-cache terug leeg

test('planner: de serverwaarde overschrijft de lokale waarde onder blitz_settings en zet blitz_laatste_start', async () => {
  const opslag = maakOpslag({ blitz_settings: { startlocatie: 'Lokaal' } });
  const api = nepApiJson({ overzicht: ovz({ gebruikerId: 'u-pl', versie: 3, instellingen: S({ laatsteStart: '15:30' }) }) });
  await synchroniseerInstellingen(PLANNER, { apiJson: api, opslag });
  assert.equal(opslag.json('blitz_settings').startlocatie, 'Server 1');
  assert.equal(opslag.getItem('blitz_laatste_start'), '15:30');
  assert.equal(opslag.getItem(MARKER_SLEUTEL), 'u-pl');
  assert.deepEqual(api.puts, [], 'server heeft een waarde: geen PUT');
});

test('technieker Tim: eigen serverwaarde onder blitz_settings_Tim (niet onder blitz_settings)', async () => {
  const opslag = maakOpslag({ blitz_settings_Tim: { startlocatie: 'Lokaal' } });
  await synchroniseerInstellingen(TIM, {
    apiJson: nepApiJson({ overzicht: ovz({ gebruikerId: 'u-tim', versie: 1, instellingen: S() }, { Tim: { gebruikerId: 'u-tim', instellingen: S() } }) }), opslag,
  });
  assert.equal(opslag.json('blitz_settings_Tim').startlocatie, 'Server 1');
  assert.equal(opslag.getItem('blitz_settings'), null);
});

test('techniekerinstellingen uit het overzicht komen onder hun settingsKey; een technieker met serverwaarde wint van de lokale waarde', async () => {
  const opslag = maakOpslag({ blitz_settings_Tim: { startlocatie: 'Tim lokaal' } });
  const api = nepApiJson({ overzicht: ovz({ gebruikerId: 'u-pl', versie: 1, instellingen: null }, {
    Tim: { gebruikerId: 'u-tim', instellingen: S({ startlocatie: 'Tim server' }) },
    Roel: { gebruikerId: 'u-roel', instellingen: null },
  }) });
  await synchroniseerInstellingen(PLANNER, { apiJson: api, opslag });
  assert.equal(opslag.json('blitz_settings_Tim').startlocatie, 'Tim server');
  assert.deepEqual(api.puts, [], 'niets lokaals voor Roel en Tim heeft een serverwaarde: geen PUT');
  assert.equal(opslag.getItem('blitz_settings'), null, 'niets lokaals en niets op de server: niets te schrijven');
});

// Eindreview I3: dit gedrag was eerder omgekeerd ("techniekers zonder waarde blijven ongemoeid" en niets omhoog): de waarden die de
// planner op zijn toestel per technieker instelde gingen zo bij de eerste login van de technieker (gsm-waarde) of bij afmelden verloren.
test('I3 migratie: planner-toestel met lokale waarde van technieker Roel en server instellingen null: één PUT { gebruiker, instellingen } (zonder laatsteStart)', async () => {
  const opslag = maakOpslag({ blitz_settings_Roel: { startlocatie: 'Roel lokaal', maxPerDag: 4 }, blitz_laatste_start: '15:00' });
  const api = nepApiJson({ overzicht: ovz({ gebruikerId: 'u-pl', versie: 1, instellingen: null }, {
    Tim: { gebruikerId: 'u-tim', instellingen: null },
    Roel: { gebruikerId: 'u-roel', instellingen: null },
  }) });
  await synchroniseerInstellingen(PLANNER, { apiJson: api, opslag });
  assert.deepEqual(api.puts, [{ gebruiker: 'u-roel', instellingen: { startlocatie: 'Roel lokaal', maxPerDag: 4 } }]);
  assert.equal(opslag.json('blitz_settings_Roel').startlocatie, 'Roel lokaal', 'de lokale waarde blijft staan');
  assert.equal(opslag.getItem(VUIL_SLEUTEL), null);
});

test('I3 migratie: ook de beheerder uploadt; een technieker of sales uploadt nooit de waarden van collega’s', async () => {
  const techniekers = { Tim: { gebruikerId: 'u-tim', instellingen: null }, Roel: { gebruikerId: 'u-roel', instellingen: null } };
  const beheerder = maakOpslag({ blitz_settings_Roel: { startlocatie: 'R' } });
  const apiB = nepApiJson({ overzicht: ovz({ gebruikerId: 'u-b', versie: 0, instellingen: null }, techniekers) });
  await synchroniseerInstellingen({ id: 'u-b', rol: 'beheerder' }, { apiJson: apiB, opslag: beheerder });
  assert.equal(apiB.puts.length, 1);
  assert.equal(apiB.puts[0].gebruiker, 'u-roel');

  const tech = maakOpslag({ blitz_settings_Roel: { startlocatie: 'R' } });
  const apiT = nepApiJson({ overzicht: ovz({ gebruikerId: 'u-tim', versie: 0, instellingen: null }, techniekers) });
  await synchroniseerInstellingen(TIM, { apiJson: apiT, opslag: tech });
  assert.deepEqual(apiT.puts, [], 'technieker: alleen zijn eigen waarde');

  const sales = maakOpslag({ blitz_settings_Roel: { startlocatie: 'R' } });
  const apiS = nepApiJson({ overzicht: ovz({ gebruikerId: 'u-s', versie: 0, instellingen: null }, techniekers) });
  await synchroniseerInstellingen({ id: 'u-s', rol: 'sales' }, { apiJson: apiS, opslag: sales });
  assert.deepEqual(apiS.puts, []);
});

test('I3 migratie: eenmalig: na een geslaagde PUT heeft de server waarden en wint de server; mislukt de PUT dan volgt een nieuwe poging bij de volgende start', async () => {
  const opslag = maakOpslag({ blitz_settings_Roel: { startlocatie: 'Roel lokaal' } });
  const zonder = { Roel: { gebruikerId: 'u-roel', instellingen: null } };
  const faal = nepApiJson({ overzicht: ovz({ gebruikerId: 'u-pl', versie: 0, instellingen: null }, zonder), put: () => { throw httpFout(500); } });
  await synchroniseerInstellingen(PLANNER, { apiJson: faal, opslag });
  assert.equal(faal.puts.length, 1);
  assert.equal(opslag.json('blitz_settings_Roel').startlocatie, 'Roel lokaal', 'lokale waarde blijft bij een mislukking');
  const opnieuw = nepApiJson({ overzicht: ovz({ gebruikerId: 'u-pl', versie: 0, instellingen: null }, zonder) });
  await synchroniseerInstellingen(PLANNER, { apiJson: opnieuw, opslag });
  assert.equal(opnieuw.puts.length, 1, 'tweede poging');
  // Nu heeft de server een waarde: de server wint, geen PUT meer.
  const klaar = nepApiJson({ overzicht: ovz({ gebruikerId: 'u-pl', versie: 0, instellingen: null }, { Roel: { gebruikerId: 'u-roel', instellingen: S({ startlocatie: 'Roel server' }) } }) });
  await synchroniseerInstellingen(PLANNER, { apiJson: klaar, opslag });
  assert.deepEqual(klaar.puts, []);
  assert.equal(opslag.json('blitz_settings_Roel').startlocatie, 'Roel server');
});

test('I3 migratie: lege lokale waarde of een vreemde eigenaar: niets omhoog', async () => {
  const leeg = maakOpslag({ blitz_settings_Roel: {} });
  const api = nepApiJson({ overzicht: ovz({ gebruikerId: 'u-pl', versie: 0, instellingen: null }, { Roel: { gebruikerId: 'u-roel', instellingen: null } }) });
  await synchroniseerInstellingen(PLANNER, { apiJson: api, opslag: leeg });
  assert.deepEqual(api.puts, []);
  const ander = maakOpslag({ blitz_settings_Roel: { startlocatie: 'Van de ander' }, [MARKER_SLEUTEL]: 'u-ander' });
  const api2 = nepApiJson({ overzicht: ovz({ gebruikerId: 'u-pl', versie: 0, instellingen: null }, { Roel: { gebruikerId: 'u-roel', instellingen: null } }) });
  await synchroniseerInstellingen(PLANNER, { apiJson: api2, opslag: ander });
  assert.deepEqual(api2.puts, [], 'de cache van een ander is gewist vóór er iets omhoog kan');
});

test('resterendSyncBudget: totale opstart ≤ 8 s: een trage auth-ik laat minder over, nooit minder dan 1 s of meer dan 7 s', () => {
  assert.equal(resterendSyncBudget(0), 7000);
  assert.equal(resterendSyncBudget(300), 7000);
  assert.equal(resterendSyncBudget(5000), 3000);
  assert.equal(resterendSyncBudget(7900), 1000);
  assert.equal(resterendSyncBudget(20000), 1000);
  assert.equal(resterendSyncBudget(undefined), 7000);
});

test('server null + lokale waarde + geen marker: één PUT met de lokale waarde (met laatsteStart) en marker = mijn id', async () => {
  const opslag = maakOpslag({ blitz_settings: { startlocatie: 'Lokaal', duurMinuten: 60 }, blitz_laatste_start: '15:00' });
  const api = nepApiJson({ overzicht: ovz({ gebruikerId: 'u-pl', versie: 0, instellingen: null }) });
  await synchroniseerInstellingen(PLANNER, { apiJson: api, opslag });
  assert.deepEqual(api.puts, [{ instellingen: { startlocatie: 'Lokaal', duurMinuten: 60, laatsteStart: '15:00' } }]);
  assert.equal(opslag.getItem(MARKER_SLEUTEL), 'u-pl');
  assert.equal(opslag.json('blitz_settings').startlocatie, 'Lokaal', 'lokale waarde blijft staan');
});

test('server null + marker is mijn id: ook geüpload', async () => {
  const opslag = maakOpslag({ blitz_settings: { startlocatie: 'Lokaal' }, [MARKER_SLEUTEL]: 'u-pl' });
  const api = nepApiJson({ overzicht: ovz({ gebruikerId: 'u-pl', versie: 0, instellingen: null }) });
  await synchroniseerInstellingen(PLANNER, { apiJson: api, opslag });
  assert.equal(api.puts.length, 1);
});

test('server null + marker van een ander: geen PUT, de lokale waarde van de ander is weg (ook de techniekersleutels en de vuil-markering)', async () => {
  const opslag = maakOpslag({
    blitz_settings: { startlocatie: 'Van de ander' }, blitz_settings_Tim: { startlocatie: 'Tim van de ander' }, blitz_laatste_start: '14:00',
    [MARKER_SLEUTEL]: 'u-ander', [VUIL_SLEUTEL]: { Tim: true }, blitz_theme: 'dark',
  });
  const api = nepApiJson({ overzicht: ovz({ gebruikerId: 'u-pl', versie: 0, instellingen: null }) });
  await synchroniseerInstellingen(PLANNER, { apiJson: api, opslag });
  assert.deepEqual(api.puts, []);
  assert.equal(opslag.getItem('blitz_settings'), null);
  assert.equal(opslag.getItem('blitz_settings_Tim'), null);
  assert.equal(opslag.getItem('blitz_laatste_start'), null);
  assert.equal(opslag.getItem(VUIL_SLEUTEL), null);
  assert.equal(opslag.getItem(MARKER_SLEUTEL), 'u-pl');
  assert.equal(opslag.getItem('blitz_theme'), 'dark', 'niet-instellingen blijven staan');
});

test('server heeft waarde + marker van een ander: de serverwaarde komt in de plaats, geen PUT', async () => {
  const opslag = maakOpslag({ blitz_settings: { startlocatie: 'Van de ander' }, [MARKER_SLEUTEL]: 'u-ander' });
  const api = nepApiJson({ overzicht: ovz({ gebruikerId: 'u-pl', versie: 2, instellingen: S() }) });
  await synchroniseerInstellingen(PLANNER, { apiJson: api, opslag });
  assert.equal(opslag.json('blitz_settings').startlocatie, 'Server 1');
  assert.deepEqual(api.puts, []);
});

test('mislukt het overzicht (netwerk of 503): opslag ongewijzigd en geen gooi', async () => {
  for (const fout of [netFout(), httpFout(503), httpFout(500)]) {
    const begin = { blitz_settings: { startlocatie: 'Lokaal' }, blitz_laatste_start: '15:00', [MARKER_SLEUTEL]: 'u-pl' };
    const opslag = maakOpslag(begin);
    await synchroniseerInstellingen(PLANNER, { apiJson: nepApiJson({ overzicht: fout }), opslag });
    assert.deepEqual(opslag.sleutels(), Object.keys(begin).sort());
    assert.equal(opslag.json('blitz_settings').startlocatie, 'Lokaal');
    assert.equal(opslag.getItem(MARKER_SLEUTEL), 'u-pl');
  }
});

test('een onverwacht antwoord (geen eigen-blok) wijzigt niets', async () => {
  const opslag = maakOpslag({ blitz_settings: { startlocatie: 'Lokaal' } });
  await synchroniseerInstellingen(PLANNER, { apiJson: nepApiJson({ overzicht: { fout: 1 } }), opslag });
  assert.deepEqual(opslag.sleutels(), ['blitz_settings']);
});

test('sales (overzicht zonder techniekers) werkt', async () => {
  const opslag = maakOpslag();
  await synchroniseerInstellingen({ id: 'u-sa', rol: 'sales' }, {
    apiJson: nepApiJson({ overzicht: { eigen: { gebruikerId: 'u-sa', versie: 1, instellingen: S() } } }), opslag,
  });
  assert.equal(opslag.json('blitz_settings').startlocatie, 'Server 1');
});

// ── bewaarOpServer ──
test('eigen persoon ("all" of eigen zohoNaam): PUT zonder gebruiker-veld, mét laatsteStart', async () => {
  const opslag = maakOpslag();
  await laadCache(PLANNER, opslag, ovz({ gebruikerId: 'u-pl', versie: 0, instellingen: null }));
  const api = nepApiVerzoek();
  assert.deepEqual(await bewaarOpServer('all', S({ laatsteStart: '15:00' }), PLANNER, { apiVerzoek: api, opslag }), { ok: true });
  assert.deepEqual(api.puts, [{ instellingen: S({ laatsteStart: '15:00' }) }]);

  const api2 = nepApiVerzoek();
  assert.equal((await bewaarOpServer('Tim', S({ laatsteStart: '15:00' }), TIM, { apiVerzoek: api2, opslag })).ok, true);
  assert.deepEqual(api2.puts, [{ instellingen: S({ laatsteStart: '15:00' }) }]);
});

test('planner bewaart voor Roel: PUT met gebruiker = id van Roel, zonder laatsteStart; 200 geeft ok', async () => {
  const opslag = maakOpslag();
  await laadCache(PLANNER, opslag, ovz({ gebruikerId: 'u-pl', versie: 0, instellingen: null }));
  const api = nepApiVerzoek();
  const r = await bewaarOpServer('Roel', S({ laatsteStart: '15:00' }), PLANNER, { apiVerzoek: api, opslag });
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(api.puts, [{ gebruiker: 'u-roel', instellingen: S() }]);
  assert.equal('laatsteStart' in api.puts[0].instellingen, false);
});

test('server 403: geen-recht en géén vuil-markering', async () => {
  const opslag = maakOpslag();
  await laadCache(PLANNER, opslag, ovz({ gebruikerId: 'u-pl', versie: 0, instellingen: null }));
  const r = await bewaarOpServer('Roel', S(), PLANNER, { apiVerzoek: nepApiVerzoek({ ok: false, status: 403, data: { code: 'geen-recht' } }), opslag });
  assert.deepEqual(r, { ok: false, reden: 'geen-recht' });
  assert.equal(opslag.getItem(VUIL_SLEUTEL), null);
});

test('server onbereikbaar (gooit of 503): netwerk en vuil-markering van die persoon; een geslaagde PUT wist ze', async () => {
  const opslag = maakOpslag();
  await laadCache(PLANNER, opslag, ovz({ gebruikerId: 'u-pl', versie: 0, instellingen: null }));
  let r = await bewaarOpServer('Roel', S(), PLANNER, { apiVerzoek: nepApiVerzoek(netFout()), opslag });
  assert.deepEqual(r, { ok: false, reden: 'netwerk' });
  assert.deepEqual(opslag.json(VUIL_SLEUTEL), { Roel: true });
  r = await bewaarOpServer('all', S(), PLANNER, { apiVerzoek: nepApiVerzoek({ ok: false, status: 503, data: {} }), opslag });
  assert.deepEqual(r, { ok: false, reden: 'netwerk' });
  assert.deepEqual(opslag.json(VUIL_SLEUTEL), { Roel: true, all: true });
  r = await bewaarOpServer('Roel', S(), PLANNER, { apiVerzoek: nepApiVerzoek(), opslag });
  assert.equal(r.ok, true);
  assert.deepEqual(opslag.json(VUIL_SLEUTEL), { all: true });
  await bewaarOpServer('all', S(), PLANNER, { apiVerzoek: nepApiVerzoek(), opslag });
  assert.equal(opslag.getItem(VUIL_SLEUTEL), null, 'lege markering verdwijnt');
});

test('onbekende persoon zonder account: geen-account zonder PUT', async () => {
  const opslag = maakOpslag();
  await laadCache(PLANNER, opslag, ovz({ gebruikerId: 'u-pl', versie: 0, instellingen: null }));
  const api = nepApiVerzoek();
  assert.deepEqual(await bewaarOpServer('Onbekend', S(), PLANNER, { apiVerzoek: api, opslag }), { ok: false, reden: 'geen-account' });
  assert.deepEqual(api.puts, []);
  assert.equal(opslag.getItem(VUIL_SLEUTEL), null);
});

test('een door de server geweigerde waarde (400) is geen netwerkprobleem: reden ongeldig, geen vuil-markering', async () => {
  const opslag = maakOpslag();
  await laadCache(PLANNER, opslag, ovz({ gebruikerId: 'u-pl', versie: 0, instellingen: null }));
  const r = await bewaarOpServer('all', S(), PLANNER, { apiVerzoek: nepApiVerzoek({ ok: false, status: 400, data: { error: 'x' } }), opslag });
  assert.deepEqual(r, { ok: false, reden: 'ongeldig' });
  assert.equal(opslag.getItem(VUIL_SLEUTEL), null);
});

test('overzicht nog niet geladen (offline start): andere persoon wordt vuil gemarkeerd i.p.v. "geen-account"', async () => {
  const opslag = maakOpslag();
  const api = nepApiVerzoek();
  const r = await bewaarOpServer('Roel', S(), PLANNER, { apiVerzoek: api, opslag });
  assert.deepEqual(r, { ok: false, reden: 'netwerk' });
  assert.deepEqual(api.puts, []);
  assert.deepEqual(opslag.json(VUIL_SLEUTEL), { Roel: true });
});

// ── vuil-markering bij de synchronisatie ──
test('vuile persoon: de lokale waarde gaat EERST omhoog (PUT vóór de serverwaarden in de opslag komen) en de markering verdwijnt', async () => {
  const opslag = maakOpslag({
    blitz_settings_Roel: { startlocatie: 'Roel lokaal', laatsteStart: '15:00' }, [VUIL_SLEUTEL]: { Roel: true }, [MARKER_SLEUTEL]: 'u-pl',
  });
  let gezienBijPut = null;
  const api = nepApiJson({
    overzicht: ovz({ gebruikerId: 'u-pl', versie: 4, instellingen: S({ startlocatie: 'Eigen server' }) }, {
      Roel: { gebruikerId: 'u-roel', instellingen: S({ startlocatie: 'Roel server' }) },
    }),
    put: () => { gezienBijPut = { eigen: opslag.getItem('blitz_settings'), roel: opslag.json('blitz_settings_Roel').startlocatie }; return { versie: 5 }; },
  });
  await synchroniseerInstellingen(PLANNER, { apiJson: api, opslag });
  // I2: de body vertrekt van het serverrecord uit het overzicht (hier duurMinuten 90); enkel de lokale velden komen erbovenop; laatsteStart (lokaal 15:00) gaat niet mee.
  assert.deepEqual(api.puts, [{ gebruiker: 'u-roel', instellingen: { startlocatie: 'Roel lokaal', duurMinuten: 90 } }]);
  assert.equal(gezienBijPut.eigen, null, 'tijdens de PUT stond er nog niets van de server in de opslag');
  assert.equal(gezienBijPut.roel, 'Roel lokaal');
  assert.equal(opslag.json('blitz_settings_Roel').startlocatie, 'Roel lokaal', 'de lokale waarde blijft (zij is nu ook de serverwaarde)');
  assert.equal(opslag.json('blitz_settings').startlocatie, 'Eigen server', 'de rest wordt wel gesynchroniseerd');
  assert.equal(opslag.getItem(VUIL_SLEUTEL), null);
});

test('vuile persoon waarvan de PUT opnieuw mislukt: lokale waarde blijft staan, markering blijft, serverwaarde schrijft niets', async () => {
  const opslag = maakOpslag({ blitz_settings_Roel: { startlocatie: 'Roel lokaal' }, [VUIL_SLEUTEL]: { Roel: true } });
  const api = nepApiJson({
    overzicht: ovz({ gebruikerId: 'u-pl', versie: 4, instellingen: null }, { Roel: { gebruikerId: 'u-roel', instellingen: S({ startlocatie: 'Roel server' }) } }),
    put: () => { throw netFout(); },
  });
  await synchroniseerInstellingen(PLANNER, { apiJson: api, opslag });
  assert.equal(opslag.json('blitz_settings_Roel').startlocatie, 'Roel lokaal');
  assert.deepEqual(opslag.json(VUIL_SLEUTEL), { Roel: true });
});

test('vuile eigen persoon: lokale waarde (met laatsteStart) gaat omhoog en wint van de server', async () => {
  const opslag = maakOpslag({ blitz_settings: { startlocatie: 'Lokaal' }, blitz_laatste_start: '15:00', [VUIL_SLEUTEL]: { all: true } });
  const api = nepApiJson({ overzicht: ovz({ gebruikerId: 'u-pl', versie: 2, instellingen: S({ laatsteStart: '12:00' }) }) });
  await synchroniseerInstellingen(PLANNER, { apiJson: api, opslag });
  assert.deepEqual(api.puts, [{ instellingen: { startlocatie: 'Lokaal', laatsteStart: '15:00' } }]);
  assert.equal(opslag.json('blitz_settings').startlocatie, 'Lokaal');
  assert.equal(opslag.getItem('blitz_laatste_start'), '15:00');
});

test('vuile persoon die intussen geen recht (403) meer heeft: markering verdwijnt, de serverwaarde geldt', async () => {
  const opslag = maakOpslag({ blitz_settings_Roel: { startlocatie: 'Roel lokaal' }, [VUIL_SLEUTEL]: { Roel: true } });
  const api = nepApiJson({
    overzicht: ovz({ gebruikerId: 'u-pl', versie: 4, instellingen: null }, { Roel: { gebruikerId: 'u-roel', instellingen: S({ startlocatie: 'Roel server' }) } }),
    put: () => { throw httpFout(403); },
  });
  await synchroniseerInstellingen(PLANNER, { apiJson: api, opslag });
  assert.equal(opslag.getItem(VUIL_SLEUTEL), null);
  assert.equal(opslag.json('blitz_settings_Roel').startlocatie, 'Roel server');
});

test('synchronisatie met een mislukte migratie-PUT gooit niet en laat de lokale waarde staan', async () => {
  const opslag = maakOpslag({ blitz_settings: { startlocatie: 'Lokaal' } });
  const api = nepApiJson({ overzicht: ovz({ gebruikerId: 'u-pl', versie: 0, instellingen: null }), put: () => { throw netFout(); } });
  await synchroniseerInstellingen(PLANNER, { apiJson: api, opslag });
  assert.equal(opslag.json('blitz_settings').startlocatie, 'Lokaal');
});

// ── wisInstellingenCache ──
test('wisInstellingenCache wist blitz_settings*, blitz_laatste_start, de marker en de vuil-markering — niets anders', () => {
  const opslag = maakOpslag({
    blitz_settings: {}, blitz_settings_Tim: {}, blitz_laatste_start: '15:00', [MARKER_SLEUTEL]: 'u1', [VUIL_SLEUTEL]: { Tim: true },
    blitz_theme: 'dark', blitz_eigenaar: 'u1', blitz_verbruik_wachtrij: '[]', blitz_active_person: 'Tim',
  });
  wisInstellingenCache(opslag);
  assert.deepEqual(opslag.sleutels(), ['blitz_active_person', 'blitz_eigenaar', 'blitz_theme', 'blitz_verbruik_wachtrij']);
});

test('wisInstellingenCache vergeet ook de overzicht-cache: daarna kent bewaarOpServer Roel niet meer (offline: netwerk)', async () => {
  const opslag = maakOpslag();
  await laadCache(PLANNER, opslag, ovz({ gebruikerId: 'u-pl', versie: 0, instellingen: null }));
  wisInstellingenCache(opslag);
  const api = nepApiVerzoek();
  const r = await bewaarOpServer('Roel', S(), PLANNER, { apiVerzoek: api, opslag });
  assert.deepEqual(api.puts, []);
  assert.equal(r.reden, 'netwerk');
});

// ── Fix-ronde 1: tijdsbudget, vreemde marker offline, write-ahead, serialisatie, wees-markering, heeftVuileInstellingen ──
const nooitKlaar = () => new Promise(() => {});

test('tijdsbudget: een GET die nooit antwoordt eindigt na het budget; geen gooi, niets geschreven, geen marker', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const opslag = maakOpslag({ blitz_settings: { startlocatie: 'Lokaal' } });
    const klaar = synchroniseerInstellingen(PLANNER, { apiJson: nooitKlaar, opslag });
    let afgerond = false;
    klaar.then(() => { afgerond = true; });
    mock.timers.tick(6999);
    await Promise.resolve(); await Promise.resolve();
    assert.equal(afgerond, false, 'binnen het budget nog niet klaar');
    mock.timers.tick(1);
    assert.equal(await klaar, false);
    assert.deepEqual(opslag.sleutels(), ['blitz_settings']);
  } finally { mock.timers.reset(); }
});

test('tijdsbudget: het budget geldt in totaal; een hangende PUT in ronde 1 stopt de rest en een late afloop schrijft niets meer', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const opslag = maakOpslag({ blitz_settings_Roel: { startlocatie: 'Roel lokaal' }, [VUIL_SLEUTEL]: { Roel: true } });
    let laatPutKlaar;
    const api = async (pad, opties = {}) => {
      if ((opties.methode ?? 'GET') === 'GET') {
        return ovz({ gebruikerId: 'u-pl', versie: 1, instellingen: S({ startlocatie: 'Eigen server' }) }, { Roel: { gebruikerId: 'u-roel', instellingen: S({ startlocatie: 'Roel server' }) } });
      }
      return new Promise((resolve) => { laatPutKlaar = () => resolve({ versie: 9 }); }); // hangt tot het de test uitkomt
    };
    const klaar = synchroniseerInstellingen(PLANNER, { apiJson: api, opslag });
    await new Promise(r => setImmediate(r)); // GET afgehandeld, PUT hangt
    mock.timers.tick(7000);
    assert.equal(await klaar, false);
    laatPutKlaar(); // een late PUT-afloop
    await new Promise(r => setImmediate(r));
    assert.equal(opslag.getItem('blitz_settings'), null, 'de serverwaarde van mij werd niet meer in de opslag gezet');
    assert.equal(opslag.json('blitz_settings_Roel').startlocatie, 'Roel lokaal');
    assert.deepEqual(opslag.json(VUIL_SLEUTEL), { Roel: true }, 'de markering is niet door de late afloop gewist');
    assert.equal(opslag.getItem(MARKER_SLEUTEL), null, 'zonder volledige synchronisatie geen marker');
  } finally { mock.timers.reset(); }
});

test('een synchronisatie binnen het budget laat geen timer achter en geeft true', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const opslag = maakOpslag();
    const klaar = await synchroniseerInstellingen(PLANNER, { apiJson: nepApiJson({ overzicht: ovz({ gebruikerId: 'u-pl', versie: 1, instellingen: S() }) }), opslag });
    assert.equal(klaar, true);
    mock.timers.tick(20000); // zou een vergeten timer afvuren: geen effect
    assert.equal(opslag.json('blitz_settings').startlocatie, 'Server 1');
  } finally { mock.timers.reset(); }
});

test('offline start met de marker van een ander: de vreemde instellingen zijn meteen weg en de marker is de mijne (mijn offline wijziging blijft later bewaard)', async () => {
  const opslag = maakOpslag({ blitz_settings: { startlocatie: 'Van de ander' }, blitz_laatste_start: '14:00', [MARKER_SLEUTEL]: 'u-ander', [VUIL_SLEUTEL]: { all: true } });
  assert.equal(await synchroniseerInstellingen(PLANNER, { apiJson: nepApiJson({ overzicht: netFout() }), opslag }), false);
  assert.equal(opslag.getItem('blitz_settings'), null);
  assert.equal(opslag.getItem('blitz_laatste_start'), null);
  assert.equal(opslag.getItem(VUIL_SLEUTEL), null);
  assert.equal(opslag.getItem(MARKER_SLEUTEL), 'u-pl');
  // Mijn eigen offline wijziging, daarna online: niet als "van een ander" gewist.
  opslag.setItem('blitz_settings', JSON.stringify({ startlocatie: 'Mijn offline' }));
  opslag.setItem(VUIL_SLEUTEL, JSON.stringify({ all: true }));
  const api = nepApiJson({ overzicht: ovz({ gebruikerId: 'u-pl', versie: 1, instellingen: S() }) });
  await synchroniseerInstellingen(PLANNER, { apiJson: api, opslag });
  assert.equal(api.puts.length, 1);
  assert.equal(api.puts[0].instellingen.startlocatie, 'Mijn offline');
});

test('write-ahead: de vuil-markering staat er al tijdens de PUT en verdwijnt na succes', async () => {
  const opslag = maakOpslag();
  await laadCache(PLANNER, opslag, ovz({ gebruikerId: 'u-pl', versie: 0, instellingen: null }));
  let tijdensPut = null;
  const api = async () => { tijdensPut = opslag.json(VUIL_SLEUTEL); return { ok: true, status: 200, data: {} }; };
  assert.equal((await bewaarOpServer('Roel', S(), PLANNER, { apiVerzoek: api, opslag })).ok, true);
  assert.deepEqual(tijdensPut, { Roel: true });
  assert.equal(opslag.getItem(VUIL_SLEUTEL), null);
});

test('serialisatie: twee snelle opslagen voor dezelfde persoon gaan na elkaar; de tweede stuurt de actuele opslagwaarde', async () => {
  const opslag = maakOpslag();
  await laadCache(PLANNER, opslag, ovz({ gebruikerId: 'u-pl', versie: 0, instellingen: null }));
  const bodies = []; let ontgrendel;
  let eerste = true;
  const api = (pad, opties) => {
    bodies.push(opties.body.instellingen.startlocatie);
    if (eerste) { eerste = false; return new Promise((r) => { ontgrendel = () => r({ ok: true, status: 200, data: {} }); }); }
    return Promise.resolve({ ok: true, status: 200, data: {} });
  };
  const p1 = bewaarOpServer('all', S({ startlocatie: 'Een' }), PLANNER, { apiVerzoek: api, opslag });
  opslag.setItem('blitz_settings', JSON.stringify(S({ startlocatie: 'Twee' }))); // savePersonSettings schrijft eerst lokaal
  const p2 = bewaarOpServer('all', S({ startlocatie: 'Twee' }), PLANNER, { apiVerzoek: api, opslag });
  await new Promise(r => setImmediate(r));
  assert.deepEqual(bodies, ['Een'], 'de tweede wacht op de eerste');
  ontgrendel();
  assert.equal((await p1).ok, true);
  assert.equal((await p2).ok, true);
  assert.deepEqual(bodies, ['Een', 'Twee']);
  // Andere personen wachten niet op elkaar.
  const ander = [];
  const api2 = (pad, opties) => { if (!opties) return Promise.resolve({ ok: true, status: 200, data: { techniekers: {} } }); ander.push(opties.body.gebruiker ?? 'eigen'); return new Promise((r) => { vrij.push(() => r({ ok: true, status: 200, data: {} })); }); };
  const vrij = [];
  const klaar = [bewaarOpServer('all', S(), PLANNER, { apiVerzoek: api2, opslag }), bewaarOpServer('Roel', S(), PLANNER, { apiVerzoek: api2, opslag })];
  await new Promise(r => setImmediate(r));
  assert.deepEqual(ander.sort(), ['eigen', 'u-roel']);
  vrij.forEach(f => f()); // laat de ketens leeg lopen: latere tests bewaren weer voor dezelfde personen
  await Promise.all(klaar);
});

test('wees-markering: een vuile persoon die niet (meer) in het overzicht staat wordt opgeruimd', async () => {
  const opslag = maakOpslag({ blitz_settings_Weg: { startlocatie: 'x' }, [VUIL_SLEUTEL]: { Weg: true, Roel: true }, blitz_settings_Roel: { startlocatie: 'Roel lokaal' } });
  const api = nepApiJson({ overzicht: ovz({ gebruikerId: 'u-pl', versie: 1, instellingen: null }, { Roel: { gebruikerId: 'u-roel', instellingen: null } }) });
  await synchroniseerInstellingen(PLANNER, { apiJson: api, opslag });
  assert.equal(opslag.getItem(VUIL_SLEUTEL), null, 'Weg is opgeruimd en Roel is opgeladen');
  assert.equal(api.puts.length, 1);
  assert.equal(api.puts[0].gebruiker, 'u-roel');
});

test('heeftVuileInstellingen: true enkel bij een niet-lege markering', () => {
  assert.equal(heeftVuileInstellingen(maakOpslag()), false);
  assert.equal(heeftVuileInstellingen(maakOpslag({ [VUIL_SLEUTEL]: {} })), false);
  assert.equal(heeftVuileInstellingen(maakOpslag({ [VUIL_SLEUTEL]: { Tim: true } })), true);
  assert.equal(heeftVuileInstellingen(maakOpslag({ [VUIL_SLEUTEL]: 'kapot{' })), false);
});

test('neemEigenOver: schrijft de eigen cache (planner: all, technieker: zohoNaam), de globale laatsteStart en wist de vuil-markering', () => {
  const opslag = maakOpslag({ [VUIL_SLEUTEL]: { all: true, Roel: true }, blitz_settings: { duurMinuten: 30 } });
  const set = S({ laatsteStart: '15:30' });
  assert.equal(neemEigenOver(set, PLANNER, { opslag }), 'all');
  assert.deepEqual(opslag.json('blitz_settings'), set);
  assert.equal(opslag.getItem('blitz_laatste_start'), '15:30');
  assert.deepEqual(opslag.json(VUIL_SLEUTEL), { Roel: true }); // enkel de eigen persoon is niet meer vuil
  assert.equal(neemEigenOver(S(), TIM, { opslag }), 'Tim');
  assert.deepEqual(opslag.json('blitz_settings_Tim'), S());
  assert.equal(opslag.getItem('blitz_laatste_start'), '15:30', 'zonder geldige laatsteStart blijft de globale waarde staan');
});

// ── merge-review I2: een planner/beheerder die voor een technieker bewaart verliest nooit velden die het formulier niet toont ──
test('I2: bewaren voor Roel legt de lokale velden op het serverrecord: laatsteStart, bezoekDuurMin en onbekende velden blijven behouden', async () => {
  const opslag = maakOpslag();
  await laadCache(PLANNER, opslag, ovz({ gebruikerId: 'u-pl', versie: 0, instellingen: null }));
  const serverRoel = S({ laatsteStart: '15:00', bezoekDuurMin: 45, kaartStijl: 'satelliet', routeKleur: '#111111' });
  const api = nepApiVerzoek(undefined, { Roel: { gebruikerId: 'u-roel', instellingen: serverRoel } });
  // lokaal (oude cache): andere startlocatie + nieuwe routekleur; zonder laatsteStart/bezoekDuurMin
  const r = await bewaarOpServer('Roel', { startlocatie: 'Nieuw', duurMinuten: 90, routeKleur: '#222222' }, PLANNER, { apiVerzoek: api, opslag });
  assert.equal(r.ok, true);
  assert.equal(api.gets.length, 1, 'eerst het actuele serverrecord ophalen');
  assert.deepEqual(api.puts, [{ gebruiker: 'u-roel', instellingen: { startlocatie: 'Nieuw', duurMinuten: 90, laatsteStart: '15:00', bezoekDuurMin: 45, kaartStijl: 'satelliet', routeKleur: '#222222' } }]);
});

test('I2: het ophalen van het serverrecord mislukt (netwerk): geen PUT (dus geen veldverlies), wel een vuil-markering', async () => {
  const opslag = maakOpslag();
  await laadCache(PLANNER, opslag, ovz({ gebruikerId: 'u-pl', versie: 0, instellingen: null }));
  const api = nepApiVerzoek(netFout());
  assert.deepEqual(await bewaarOpServer('Roel', S(), PLANNER, { apiVerzoek: api, opslag }), { ok: false, reden: 'netwerk' });
  assert.deepEqual(api.puts, []);
  assert.deepEqual(opslag.json(VUIL_SLEUTEL), { Roel: true });
});

test('I2: een eigen record (planner op all) blijft zonder extra GET en met de globale laatsteStart', async () => {
  const opslag = maakOpslag({ blitz_laatste_start: '14:30' });
  await laadCache(PLANNER, opslag, ovz({ gebruikerId: 'u-pl', versie: 0, instellingen: null }));
  const api = nepApiVerzoek();
  await bewaarOpServer('all', S(), PLANNER, { apiVerzoek: api, opslag });
  assert.equal(api.gets.length, 0);
  assert.deepEqual(api.puts, [{ instellingen: S({ laatsteStart: '14:30' }) }]);
});

// ── merge-review I1: Alle en de eigen Zoho-naam van een planner/beheerder zijn hetzelfde serverrecord ──
const BEHEERDER_BRENT = { id: 'u-br', rol: 'beheerder', zohoNaam: 'Brent' };

test('I1: synchronisatie zet het eigen serverrecord onder blitz_settings EN blitz_settings_Brent', async () => {
  const opslag = maakOpslag({ blitz_settings_Brent: { startlocatie: 'Oud lokaal' } });
  await synchroniseerInstellingen(BEHEERDER_BRENT, {
    apiJson: nepApiJson({ overzicht: ovz({ gebruikerId: 'u-br', versie: 2, instellingen: S({ startlocatie: 'Server Brent', laatsteStart: '15:15' }) }) }), opslag,
  });
  assert.equal(opslag.json('blitz_settings').startlocatie, 'Server Brent');
  assert.equal(opslag.json('blitz_settings_Brent').startlocatie, 'Server Brent');
  assert.equal(opslag.getItem('blitz_laatste_start'), '15:15');
});

test('I1: neemEigenOver (Beheer, voor jezelf) schrijft beide eigen sleutels en wist beide vuil-markeringen', () => {
  const opslag = maakOpslag({ [VUIL_SLEUTEL]: { all: true, Brent: true, Roel: true } });
  neemEigenOver(S({ laatsteStart: '15:30' }), BEHEERDER_BRENT, { opslag });
  assert.deepEqual(opslag.json('blitz_settings'), S({ laatsteStart: '15:30' }));
  assert.deepEqual(opslag.json('blitz_settings_Brent'), S({ laatsteStart: '15:30' }));
  assert.deepEqual(opslag.json(VUIL_SLEUTEL), { Roel: true });
});

test('I1: bewaren onder de eigen naam is een eigen PUT (zonder gebruiker-veld, met laatsteStart), zonder extra GET', async () => {
  const opslag = maakOpslag({ blitz_laatste_start: '15:00' });
  await laadCache(BEHEERDER_BRENT, opslag, ovz({ gebruikerId: 'u-br', versie: 0, instellingen: null }));
  const api = nepApiVerzoek();
  assert.equal((await bewaarOpServer('Brent', S(), BEHEERDER_BRENT, { apiVerzoek: api, opslag })).ok, true);
  assert.deepEqual(api.puts, [{ instellingen: S({ laatsteStart: '15:00' }) }]);
  assert.equal(api.gets.length, 0);
});

test('I1: spiegelEigen kopieert een lokale wijziging van Alle naar de eigen naam en omgekeerd; voor een technieker of een collega niets', () => {
  const opslag = maakOpslag({ blitz_settings: S({ startlocatie: 'Via Alle' }), blitz_settings_Roel: S({ startlocatie: 'Roel' }) });
  spiegelEigen('all', BEHEERDER_BRENT, { opslag });
  assert.equal(opslag.json('blitz_settings_Brent').startlocatie, 'Via Alle');
  opslag.setItem('blitz_settings_Brent', JSON.stringify(S({ startlocatie: 'Via naam' })));
  spiegelEigen('Brent', BEHEERDER_BRENT, { opslag });
  assert.equal(opslag.json('blitz_settings').startlocatie, 'Via naam');
  spiegelEigen('Roel', BEHEERDER_BRENT, { opslag });
  assert.equal(opslag.json('blitz_settings').startlocatie, 'Via naam', 'Roel is een collega: niets gespiegeld');
  assert.deepEqual(eigenSleutels(TIM), ['Tim']);
  assert.deepEqual(eigenSleutels(PLANNER), ['all']);
  assert.deepEqual(eigenSleutels(BEHEERDER_BRENT), ['all', 'Brent']);
});

test('I1: een vuile eigen sleutel gaat een keer omhoog en de andere eigen sleutel volgt dat record', async () => {
  const opslag = maakOpslag({ blitz_settings_Brent: { startlocatie: 'Brent lokaal' }, [VUIL_SLEUTEL]: { Brent: true }, [MARKER_SLEUTEL]: 'u-br' });
  const api = nepApiJson({ overzicht: ovz({ gebruikerId: 'u-br', versie: 1, instellingen: S({ startlocatie: 'Server' }) }) });
  await synchroniseerInstellingen(BEHEERDER_BRENT, { apiJson: api, opslag });
  assert.equal(api.puts.length, 1);
  assert.equal(api.puts[0].instellingen.startlocatie, 'Brent lokaal');
  assert.equal(opslag.json('blitz_settings').startlocatie, 'Brent lokaal', 'Alle volgt de lokale waarde die nu ook de serverwaarde is');
  assert.equal(opslag.getItem(VUIL_SLEUTEL), null);
});

test('M4: met opties.velden gaan voor een andere persoon enkel die velden uit de lokale set mee; de rest blijft zoals de server het heeft', async () => {
  const opslag = maakOpslag();
  await laadCache(PLANNER, opslag, ovz({ gebruikerId: 'u-pl', versie: 0, instellingen: null }));
  const api = nepApiVerzoek(undefined, { Roel: { gebruikerId: 'u-roel', instellingen: S({ laatsteStart: '15:00', routeKleur: '#111111' }) } });
  const oudeLokaal = { startlocatie: 'Verouderd', duurMinuten: 15, routeKleur: '#222222', drukteKleuring: false };
  const r = await bewaarOpServer('Roel', oudeLokaal, PLANNER, { apiVerzoek: api, opslag, velden: ['routeKleur', 'drukteKleuring', 'kaartStijl'] });
  assert.equal(r.ok, true);
  assert.deepEqual(api.puts, [{ gebruiker: 'u-roel', instellingen: { startlocatie: 'Server 1', duurMinuten: 90, laatsteStart: '15:00', routeKleur: '#222222', drukteKleuring: false } }]);
});
