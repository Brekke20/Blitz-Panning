// Interne sleutel voor server-naar-server-aanroepen van achtergrondfuncties (rapport-verwerk-background).
// Een Background Function heeft geen sessie van een gebruiker en is via /.netlify/functions/<naam> publiek
// bereikbaar: zonder deze controle kon iedereen verwerking laten starten. De sleutel is een HMAC van het
// rapport-id met SESSIE_GEHEIM (dat bestaat al; er is geen extra variabele om in te stellen) onder een eigen
// context-tekst, zodat hij nergens anders bruikbaar is. Alleen de server kent hem; hij zit nooit in een antwoord.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { kop } from './verzoek.js';

export const INTERN_KOP = 'X-Blitz-Intern';
const CONTEXT = 'blitz-intern/rapport-verwerk-background/v1:';

// Geeft de sleutel voor dit id, of null zonder bruikbaar geheim of id.
export function maakInternToken(id, env = process.env) {
  const geheim = env?.SESSIE_GEHEIM;
  if (typeof geheim !== 'string' || geheim === '' || typeof id !== 'string' || id === '') return null;
  return createHmac('sha256', geheim).update(CONTEXT + id).digest('hex');
}

// true enkel als het verzoek de juiste sleutel voor precies dit id draagt (constante tijd; nooit een uitzondering).
export function controleerInternToken(reqOfEvent, id, env = process.env) {
  try {
    const verwacht = maakInternToken(id, env);
    const aangeboden = kop(reqOfEvent, INTERN_KOP);
    if (verwacht === null || typeof aangeboden !== 'string') return false;
    const a = Buffer.from(aangeboden);
    const b = Buffer.from(verwacht);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
