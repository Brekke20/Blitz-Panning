// Start de Background Function 'rapport-verwerk-background' voor één rapport (fire-and-forget).
// Netlify antwoordt op een background-aanroep meteen met 202. Slaagt de start niet, dan blijft de
// entry op 'wacht' staan en pikt het vangnet (scheduled function) hem op: nooit gooien.
// De achtergrondfunctie is via haar URL publiek bereikbaar en heeft geen gebruikerssessie: de aanroep draagt
// daarom een interne sleutel (netlify/lib/intern-token.js) die de functie controleert.
import { maakInternToken, INTERN_KOP } from './intern-token.js';

export async function startAchtergrondtaak({ origin, id, testModus = false, fetch: doFetch = globalThis.fetch, timeoutMs = 5000, env = process.env }) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    // Zonder geheim (SESSIE_GEHEIM) weigert de achtergrondfunctie de aanroep; het vangnet pikt het rapport dan op.
    const token = maakInternToken(id, env);
    if (token) headers[INTERN_KOP] = token;
    else console.error('[rapport-achtergrond] geen SESSIE_GEHEIM: achtergrondtaak niet gestart (vangnet neemt over)');
    // Zonder deze header zou een testrapport tegen de echte opslag en echte Zoho verwerkt worden.
    if (testModus) headers['X-Blitz-Test'] = '1';
    const res = await doFetch(`${origin}/.netlify/functions/rapport-verwerk-background`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ id }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.status >= 200 && res.status < 300;
  } catch {
    return false;
  }
}
