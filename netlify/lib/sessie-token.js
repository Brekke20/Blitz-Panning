// Sessietoken: base64url(JSON{uid,sv,exp}) + '.' + base64url(HMAC-SHA256), plus cookiehulp.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSIE_LEVENSDUUR_S = 2592000; // 30 dagen
export const VERLENG_ONDER_S = 1296000;     // verlengen als er minder dan 15 dagen resten
export const COOKIE_NAAM = 'blitz_sessie';

function handtekening(payloadB64, geheim) {
  return createHmac('sha256', geheim).update(payloadB64).digest('base64url');
}

export function ondertekenToken({ uid, sv, exp }, geheim) {
  if (typeof geheim !== 'string' || geheim === '') throw new Error('SESSIE_GEHEIM ontbreekt');
  const payloadB64 = Buffer.from(JSON.stringify({ uid, sv, exp })).toString('base64url');
  return `${payloadB64}.${handtekening(payloadB64, geheim)}`;
}

// Geeft { uid, sv, exp } of null (rommel, foute handtekening, vervallen).
export function controleerToken(token, geheim, nuS) {
  try {
    if (typeof token !== 'string' || typeof geheim !== 'string' || geheim === '') return null;
    const delen = token.split('.');
    if (delen.length !== 2 || !delen[0] || !delen[1]) return null;
    const [payloadB64, sigB64] = delen;
    const verwacht = Buffer.from(handtekening(payloadB64, geheim));
    const gekregen = Buffer.from(sigB64);
    if (verwacht.length !== gekregen.length || !timingSafeEqual(verwacht, gekregen)) return null;
    const p = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
    if (typeof p.uid !== 'string' || p.uid === '') return null;
    if (!Number.isInteger(p.sv) || !Number.isInteger(p.exp)) return null;
    if (p.exp <= nuS) return null;
    return { uid: p.uid, sv: p.sv, exp: p.exp };
  } catch {
    return null;
  }
}

export function maakSessieCookie(token, { secure = true } = {}) {
  return `${COOKIE_NAAM}=${token}; HttpOnly;${secure ? ' Secure;' : ''} SameSite=Lax; Path=/; Max-Age=${SESSIE_LEVENSDUUR_S}`;
}

export function wisSessieCookie({ secure = true } = {}) {
  return `${COOKIE_NAAM}=; HttpOnly;${secure ? ' Secure;' : ''} SameSite=Lax; Path=/; Max-Age=0`;
}
