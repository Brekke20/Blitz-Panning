// Herstel van het beheerderswachtwoord: eenmalige herstelcodes en de Netlify-noodsleutel.
//
// Herstelcodes worden NOOIT leesbaar bewaard. Een code heeft maar ~40 bits entropie; een snelle hash (sha256)
// zou bij een gelekte blob offline te kraken zijn. Daarom bewaren we elke code als gezouten scrypt-hash
// (zelfde parameters als wachtwoorden) en vergelijken we tegen ALLE hashes met timingSafeEqual
// (verifieerWachtwoord), zonder vroegtijdig stoppen, altijd evenveel werk (aangevuld met schijn-hashes).
// De noodsleutel heeft ≥ 32 tekens entropie van Brent zelf: daar volstaat sha256 + timingSafeEqual.
import { createHash, timingSafeEqual } from 'node:crypto';
import { hashWachtwoord, verifieerWachtwoord, genereerHerstelcodes, normaliseerHerstelcode, SCHIJN_HASH } from './wachtwoord.js';
import { wijzigBlob } from './blob-wijzig.js';
import { maakSerieel } from './serieel.js';

export const AANTAL_CODES = 10;
export const MIN_NOODSLEUTEL = 32;
const MAX_BEWIJS = 200;
const NOODROUTE = 'herstel-noodroute';

// Schrijfacties op `gebruikers` door setup en herstel lopen binnen één instantie na elkaar
// (twee gelijktijdige setups of herstellen met dezelfde code mogen niet allebei slagen).
export const serieelGebruikers = maakSerieel();
// Idem voor het in beslag nemen van de noodsleutel.
const serieelNoodroute = maakSerieel();

const sha256 = tekst => createHash('sha256').update(tekst).digest();

export async function maakHerstelcodes() {
  const codes = genereerHerstelcodes(AANTAL_CODES);
  const hashes = await Promise.all(codes.map(c => hashWachtwoord(c)));
  return { codes, hashes };
}

// beheerder = record met `herstelcodes: [hash]`. Gooit nooit.
// -> { ok: true, resterend: [hash], gebruikt: hash } | { ok: false }
export async function gebruikHerstelcode(beheerder, invoer) {
  try {
    const hashes = Array.isArray(beheerder?.herstelcodes)
      ? beheerder.herstelcodes.filter(h => typeof h === 'string')
      : [];
    const code = typeof invoer === 'string' ? normaliseerHerstelcode(invoer) : '';
    // Altijd minstens AANTAL_CODES verificaties (ook voor onbekende of reeds opgebruikte situaties).
    const kandidaten = [...hashes];
    while (kandidaten.length < AANTAL_CODES) kandidaten.push(SCHIJN_HASH);
    const uitslag = await Promise.all(kandidaten.map(h => verifieerWachtwoord(code, h)));
    const i = uitslag.findIndex((juist, idx) => juist && idx < hashes.length);
    if (i < 0) return { ok: false };
    return { ok: true, resterend: hashes.filter((_, idx) => idx !== i), gebruikt: hashes[i] };
  } catch {
    return { ok: false };
  }
}

const geldigeSleutel = env => {
  const s = env?.BEHEER_HERSTELSLEUTEL;
  return typeof s === 'string' && s.trim().length >= MIN_NOODSLEUTEL ? s.trim() : null;
};

// Is `invoer` kandidaat voor de noodsleutelroute (lang genoeg om een sleutel te zijn)?
export const lijktOpNoodsleutel = invoer => typeof invoer === 'string' && invoer.trim().length >= MIN_NOODSLEUTEL;

// -> { ok: true, hash } | { ok: false }. Gooit als de opslag niet bereikbaar is.
export async function controleerNoodsleutel(invoer, env, store) {
  const sleutel = geldigeSleutel(env);
  if (sleutel === null || typeof invoer !== 'string' || invoer.length > MAX_BEWIJS) return { ok: false };
  const hash = sha256(invoer.trim());
  if (!timingSafeEqual(hash, sha256(sleutel))) return { ok: false };
  const gebruikt = await store.get(NOODROUTE, { type: 'json' });
  if (typeof gebruikt?.hash === 'string' && gebruikt.hash.length === 64
    && timingSafeEqual(Buffer.from(gebruikt.hash, 'hex'), hash)) return { ok: false };
  return { ok: true, hash: hash.toString('hex') };
}

// Neemt de noodsleutel in beslag (eenmalig gebruik). true = gelukt, false = reeds gebruikt of niet te bewaren.
export async function gebruikNoodsleutel(store, hash, iso) {
  let reeds = false;
  const r = await serieelNoodroute(() => wijzigBlob(store, NOODROUTE, {
    leeg: {},
    wijzig: blob => {
      reeds = blob?.hash === hash;
      return reeds ? null : { hash, gebruiktOp: iso };
    },
  }));
  return r.ok && !reeds && r.waarde?.hash === hash;
}
