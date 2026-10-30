// kern/gegevens-stand.js: de tekst van de balk "Gegevens van HH:MM — Zoho even niet bereikbaar" uit de kop van /api/tickets.
process.env.TZ = 'Europe/Brussels';
import test from 'node:test';
import assert from 'node:assert/strict';
import { verouderdTekst, verouderdVanKoppen } from '../public/js/kern/gegevens-stand.js';

const NU = Date.parse('2026-10-28T10:00:00.000Z'); // 11:00 in Brussel (wintertijd)
const koppen = obj => new Headers(obj);

test('verouderdTekst: het tijdstip van de momentopname = nu min de leeftijd, in lokale tijd (HH:MM, 24 uur)', () => {
  assert.equal(verouderdTekst(0, NU), 'Gegevens van 11:00 — Zoho even niet bereikbaar');
  assert.equal(verouderdTekst(600, NU), 'Gegevens van 10:50 — Zoho even niet bereikbaar');
  assert.equal(verouderdTekst(11 * 3600 + 5 * 60, NU), 'Gegevens van 23:55 — Zoho even niet bereikbaar'); // de dag ervoor, 24-uursklok
  assert.equal(verouderdTekst(11 * 3600, NU), 'Gegevens van 00:00 — Zoho even niet bereikbaar');
});

test('verouderdTekst: een onbekende leeftijd geeft een tekst zonder tijdstip', () => {
  for (const x of [null, NaN, undefined]) assert.equal(verouderdTekst(x, NU), 'Gegevens niet actueel — Zoho even niet bereikbaar');
});

test('verouderdVanKoppen: enkel bij X-Blitz-Verouderd: 1 (een gewone momentopname of live lading toont geen balk)', () => {
  assert.deepEqual(verouderdVanKoppen(koppen({ 'X-Blitz-Verouderd': '1', 'X-Blitz-Leeftijd': '600' }), NU), { tekst: 'Gegevens van 10:50 — Zoho even niet bereikbaar' });
  assert.equal(verouderdVanKoppen(koppen({ 'X-Blitz-Bron': 'snapshot', 'X-Blitz-Leeftijd': '600' }), NU), null); // geen vlag
  assert.equal(verouderdVanKoppen(koppen({}), NU), null);
  assert.equal(verouderdVanKoppen(koppen({ 'X-Blitz-Verouderd': '0' }), NU), null);
  assert.equal(verouderdVanKoppen(null, NU), null);
  assert.equal(verouderdVanKoppen({}, NU), null);
});

test('verouderdVanKoppen: een ontbrekende of rare leeftijd geeft de tekst zonder tijdstip', () => {
  for (const l of [undefined, 'abc', '-5']) {
    const k = koppen(l === undefined ? { 'X-Blitz-Verouderd': '1' } : { 'X-Blitz-Verouderd': '1', 'X-Blitz-Leeftijd': l });
    assert.equal(verouderdVanKoppen(k, NU).tekst, 'Gegevens niet actueel — Zoho even niet bereikbaar', String(l));
  }
});
