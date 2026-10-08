import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  SESSIE_LEVENSDUUR_S, VERLENG_ONDER_S, COOKIE_NAAM,
  ondertekenToken, controleerToken, maakSessieCookie, wisSessieCookie,
} from '../netlify/lib/sessie-token.js';

const GEHEIM = 'test-geheim-van-voldoende-lengte';
const NU = 1_800_000_000;
const PAYLOAD = { uid: 'u-123', sv: 2, exp: NU + 1000 };

// Token met geldige handtekening over een willekeurige (ruwe) payload.
function tokenMetRuwePayload(inhoud) {
  const b64 = Buffer.from(inhoud).toString('base64url');
  return `${b64}.${createHmac('sha256', GEHEIM).update(b64).digest('base64url')}`;
}

test('constanten', () => {
  assert.equal(SESSIE_LEVENSDUUR_S, 2592000);
  assert.equal(VERLENG_ONDER_S, 1296000);
  assert.equal(COOKIE_NAAM, 'blitz_sessie');
});

test('roundtrip geeft uid, sv en exp terug', () => {
  const t = ondertekenToken(PAYLOAD, GEHEIM);
  assert.deepEqual(controleerToken(t, GEHEIM, NU), PAYLOAD);
});

test('gewijzigd teken in payload of handtekening geeft null', () => {
  const t = ondertekenToken(PAYLOAD, GEHEIM);
  const [p, s] = t.split('.');
  const wissel = (x, i) => x.slice(0, i) + (x[i] === 'A' ? 'B' : 'A') + x.slice(i + 1);
  assert.equal(controleerToken(`${wissel(p, 3)}.${s}`, GEHEIM, NU), null);
  assert.equal(controleerToken(`${p}.${wissel(s, 3)}`, GEHEIM, NU), null);
  assert.equal(controleerToken(`${p}.${s}x`, GEHEIM, NU), null);
});

test('payload vervangen door een andere uid met oude handtekening geeft null', () => {
  const t = ondertekenToken(PAYLOAD, GEHEIM);
  const s = t.split('.')[1];
  const vals = Buffer.from(JSON.stringify({ uid: 'admin', sv: 2, exp: NU + 1000 })).toString('base64url');
  assert.equal(controleerToken(`${vals}.${s}`, GEHEIM, NU), null);
});

test('ander geheim geeft null', () => {
  const t = ondertekenToken(PAYLOAD, GEHEIM);
  assert.equal(controleerToken(t, 'ander-geheim', NU), null);
});

test('vervallen token (exp <= nu) geeft null', () => {
  const t = ondertekenToken({ ...PAYLOAD, exp: NU }, GEHEIM);
  assert.equal(controleerToken(t, GEHEIM, NU), null);
  assert.equal(controleerToken(t, GEHEIM, NU + 1), null);
  assert.notEqual(controleerToken(t, GEHEIM, NU - 1), null);
});

test('rommel geeft null', () => {
  assert.equal(controleerToken('geenpunt', GEHEIM, NU), null);
  assert.equal(controleerToken('', GEHEIM, NU), null);
  assert.equal(controleerToken(undefined, GEHEIM, NU), null);
  assert.equal(controleerToken(null, GEHEIM, NU), null);
  assert.equal(controleerToken('a.b.c', GEHEIM, NU), null);
  assert.equal(controleerToken('.', GEHEIM, NU), null);
  assert.equal(controleerToken(12345, GEHEIM, NU), null);
});

test('geldige handtekening maar ongeldige payload geeft null', () => {
  for (const inhoud of ['niet json', '[]', 'null', '{"uid":"x"}', '{"uid":1,"sv":1,"exp":99999999999}']) {
    assert.equal(controleerToken(tokenMetRuwePayload(inhoud), GEHEIM, NU), null, inhoud);
  }
});

test('ontbrekend geheim: ondertekenen gooit, controleren geeft null', () => {
  assert.throws(() => ondertekenToken(PAYLOAD, ''));
  assert.throws(() => ondertekenToken(PAYLOAD, undefined));
  const t = ondertekenToken(PAYLOAD, GEHEIM);
  assert.equal(controleerToken(t, '', NU), null);
  assert.equal(controleerToken(t, undefined, NU), null);
});

test('maakSessieCookie bevat de vereiste attributen', () => {
  const c = maakSessieCookie('abc.def');
  assert.ok(c.startsWith('blitz_sessie=abc.def;'));
  for (const deel of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=2592000']) {
    assert.ok(c.includes(deel), deel);
  }
});

test('maakSessieCookie met secure:false laat Secure weg', () => {
  const c = maakSessieCookie('abc.def', { secure: false });
  assert.ok(!c.includes('Secure'));
  assert.ok(c.includes('HttpOnly'));
});

test('wisSessieCookie zet Max-Age=0', () => {
  const c = wisSessieCookie();
  assert.ok(c.startsWith('blitz_sessie=;'));
  assert.ok(c.includes('Max-Age=0'));
  assert.ok(c.includes('Secure'));
  assert.ok(!wisSessieCookie({ secure: false }).includes('Secure'));
});
