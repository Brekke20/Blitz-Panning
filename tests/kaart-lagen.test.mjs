// De gedeelde lagenkeuze van de kaarten (route-kaart.js: voegKaartLagenToe), gebruikt door de route van de technieker en van de verkoper.
// Een nep-Leaflet: enkel wat de functie aanraakt. Verzonnen gegevens.
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { voegKaartLagenToe, KAART_LAGEN } from '../public/js/schermen/route-kaart.js';

const NAMEN = Object.values(KAART_LAGEN).map((l) => l.naam);

function nepLeaflet() {
  const lagen = [];
  globalThis.L = {
    tileLayer(url, opts) { const laag = { url, opts, kaart: null, addTo(k) { k.voegToe(this); return this; } }; lagen.push(laag); return laag; },
    control: { layers(basis, over, opts) { return { basis, over, opts, addTo(k) { k.controls.push(this); return this; } }; } },
  };
  return lagen;
}
function nepKaart() {
  const actief = new Set();
  const luisteraars = {};
  return {
    controls: [],
    voegToe(laag) { actief.add(laag); luisteraars.baselayerchange?.({ name: NAMEN.find((n) => KAART_LAGEN[Object.keys(KAART_LAGEN).find((k) => KAART_LAGEN[k].naam === n)].url === laag.url) }); },
    hasLayer: (l) => actief.has(l),
    removeLayer: (l) => { actief.delete(l); },
    on(naam, fn) { luisteraars[naam] = fn; },
    actief,
    kies(naam) { luisteraars.baselayerchange({ name: naam }); }, // de gebruiker kiest in de keuzelijst
  };
}
const naamActief = (kaart) => [...kaart.actief].map((l) => Object.values(KAART_LAGEN).find((k) => k.url === l.url).naam);

let vorigeL;
beforeEach(() => { vorigeL = globalThis.L; });
afterEach(() => { if (vorigeL === undefined) delete globalThis.L; else globalThis.L = vorigeL; });

test('alle vijf basiskaarten staan in de keuzelijst, met dezelfde namen als de technieker; de startstijl is actief', () => {
  nepLeaflet();
  const kaart = nepKaart();
  voegKaartLagenToe(kaart, { startSleutel: 'satelliet' });
  assert.deepEqual(Object.keys(kaart.controls[0].basis), NAMEN);
  assert.deepEqual(naamActief(kaart), ['Satelliet']);
  assert.equal(kaart.controls[0].opts.collapsed, false);
});

test('een onbekende, ontbrekende of prototype-sleutel geeft de standaardkaart', () => {
  for (const sleutel of [undefined, null, 'bestaatniet', 'constructor', 42]) {
    nepLeaflet();
    const kaart = nepKaart();
    voegKaartLagenToe(kaart, { startSleutel: sleutel });
    assert.deepEqual(naamActief(kaart), ['Standaard'], String(sleutel));
  }
});

test('een keuze van de gebruiker roept bijKeuze aan met de sleutel; de start en zet() doen dat nooit', () => {
  nepLeaflet();
  const kaart = nepKaart();
  const bewaard = [];
  const lagen = voegKaartLagenToe(kaart, { startSleutel: 'osm', bijKeuze: (s) => bewaard.push(s) });
  assert.deepEqual(bewaard, []); // de startlaag zelf bewaart niets
  lagen.zet('donker'); // een andere persoon bekijken: enkel tonen
  lagen.zet('bestaatniet');
  assert.deepEqual(bewaard, []);
  assert.deepEqual(naamActief(kaart), ['Standaard']); // onbekend = standaard, precies één basislaag actief
  kaart.kies('Licht');
  assert.deepEqual(bewaard, ['licht']);
});

test('zet() schakelt naar de gevraagde laag en laat precies één basislaag actief', () => {
  nepLeaflet();
  const kaart = nepKaart();
  const lagen = voegKaartLagenToe(kaart, { startSleutel: 'standaard' });
  lagen.zet('satelliet');
  assert.deepEqual(naamActief(kaart), ['Satelliet']);
  lagen.zet('licht');
  assert.deepEqual(naamActief(kaart), ['Licht']);
});

test('na een fout in zet() blijft de vlag niet hangen: een latere gebruikerskeuze wordt wel bewaard', () => {
  nepLeaflet();
  const kaart = nepKaart();
  const bewaard = [];
  const lagen = voegKaartLagenToe(kaart, { bijKeuze: (s) => bewaard.push(s) });
  const oud = kaart.removeLayer;
  kaart.removeLayer = () => { throw new Error('stuk'); };
  assert.throws(() => lagen.zet('osm'), /stuk/);
  kaart.removeLayer = oud;
  kaart.kies('Donker');
  assert.deepEqual(bewaard, ['donker']);
});
