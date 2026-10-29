// netlify.toml: de time-out van de functie `tickets` (review I-S2-1: 20 s, release A).
// Geen TOML-bibliotheek in het project: een kleine lezer die enkel `[sectie]`-kopjes en `sleutel = waarde` kent (genoeg voor dit bestand).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const wortel = join(import.meta.dirname, '..');

function leesToml(tekst) {
  const secties = {};
  let huidig = null;
  for (const ruw of tekst.split(/\r?\n/)) {
    const regel = ruw.replace(/\s+#.*$/, '').trim();
    if (!regel || regel.startsWith('#')) continue;
    const kop = regel.match(/^\[([^\[\]]+)\]$/);
    if (kop) { huidig = kop[1].trim(); secties[huidig] ??= {}; continue; }
    if (regel.startsWith('[[')) { huidig = null; continue; }
    const sleutelWaarde = regel.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (sleutelWaarde && huidig) secties[huidig][sleutelWaarde[1]] = sleutelWaarde[2].trim();
  }
  return secties;
}

const toml = leesToml(readFileSync(join(wortel, 'netlify.toml'), 'utf8'));

test('netlify.toml: [functions.tickets] heeft timeout = 20', () => {
  assert.ok(toml['functions.tickets'], 'sectie [functions.tickets] ontbreekt');
  assert.equal(toml['functions.tickets'].timeout, '20');
});

test('netlify.toml: de lezer ziet de bestaande time-outs (26 s voor rapport) ook', () => {
  assert.equal(toml['functions.rapport'].timeout, '26');
});

test('netlify.toml: elke functiesectie verwijst naar een bestaand functiebestand', () => {
  for (const sectie of Object.keys(toml).filter(s => s.startsWith('functions.'))) {
    const naam = sectie.slice('functions.'.length);
    assert.doesNotThrow(() => readFileSync(join(wortel, 'netlify', 'functions', naam + '.js')), `${sectie}: geen netlify/functions/${naam}.js`);
  }
});
