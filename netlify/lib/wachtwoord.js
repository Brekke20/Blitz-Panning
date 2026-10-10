// Wachtwoord-bouwstenen: scrypt-hash, beleid en generatoren (enkel node:crypto).
import { scrypt, scryptSync, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

export const MIN_LENGTE = 10;
export const MAX_LENGTE = 200;

const N = 16384, R = 8, P = 1;
const SLEUTEL_BYTES = 64;
const SALT_BYTES = 16;
const MAXMEM = 64 * 1024 * 1024;
const PREFIX = `scrypt$${N}$${R}$${P}$`;

const WACHTWOORD_ALFABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'; // zonder 0 O 1 l I
const HERSTEL_ALFABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // A-Z zonder I L O, plus 2-9

export function beleidsFout(wachtwoord) {
  if (typeof wachtwoord !== 'string') return 'Wachtwoord ontbreekt.';
  if (wachtwoord.length < MIN_LENGTE) return `Het wachtwoord moet minstens ${MIN_LENGTE} tekens bevatten.`;
  if (wachtwoord.length > MAX_LENGTE) return `Het wachtwoord mag maximaal ${MAX_LENGTE} tekens bevatten.`;
  if (wachtwoord.trim() === '') return 'Het wachtwoord mag niet enkel uit spaties bestaan.';
  return null;
}

export async function hashWachtwoord(wachtwoord) {
  const salt = randomBytes(SALT_BYTES);
  const hash = await scryptAsync(wachtwoord, salt, SLEUTEL_BYTES, { N, r: R, p: P, maxmem: MAXMEM });
  return `${PREFIX}${salt.toString('base64')}$${hash.toString('base64')}`;
}

// Gooit nooit: elke onverwachte invoer of kapotte hash geeft false.
export async function verifieerWachtwoord(wachtwoord, hash) {
  try {
    if (typeof wachtwoord !== 'string' || typeof hash !== 'string') return false;
    if (wachtwoord.length > MAX_LENGTE) return false; // geen scrypt op megabyte-invoer
    if (!hash.startsWith(PREFIX)) return false; // enkel de vaste kostparameters (geen DoS via absurde N)
    const delen = hash.split('$');
    if (delen.length !== 6) return false;
    const salt = Buffer.from(delen[4], 'base64');
    const verwacht = Buffer.from(delen[5], 'base64');
    if (salt.length !== SALT_BYTES || verwacht.length !== SLEUTEL_BYTES) return false;
    const afgeleid = await scryptAsync(wachtwoord, salt, SLEUTEL_BYTES, { N, r: R, p: P, maxmem: MAXMEM });
    return afgeleid.length === verwacht.length && timingSafeEqual(afgeleid, verwacht);
  } catch {
    return false;
  }
}

// Geldige hash van een willekeurig, onbekend wachtwoord: voor "schijn-verificatie"
// zodat een onbekend e-mailadres even lang duurt als een bekend.
export const SCHIJN_HASH = (() => {
  const salt = Buffer.alloc(SALT_BYTES, 7);
  const hash = scryptSync(randomBytes(32).toString('hex'), salt, SLEUTEL_BYTES, { N, r: R, p: P, maxmem: MAXMEM });
  return `${PREFIX}${salt.toString('base64')}$${hash.toString('base64')}`;
})();

function willekeurigeTekens(alfabet, aantal) {
  let uit = '';
  for (let i = 0; i < aantal; i++) uit += alfabet[randomInt(alfabet.length)];
  return uit;
}

export function genereerWachtwoord() {
  return willekeurigeTekens(WACHTWOORD_ALFABET, 12);
}

export function genereerHerstelcodes(aantal = 10) {
  const codes = new Set();
  while (codes.size < aantal) {
    codes.add(`${willekeurigeTekens(HERSTEL_ALFABET, 4)}-${willekeurigeTekens(HERSTEL_ALFABET, 4)}`);
  }
  return [...codes];
}

export function normaliseerHerstelcode(invoer) {
  const schoon = String(invoer ?? '').replace(/[\s-]/g, '').toUpperCase();
  return schoon.length === 8 ? `${schoon.slice(0, 4)}-${schoon.slice(4)}` : schoon;
}
