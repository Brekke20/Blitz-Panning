// Start de Background Function 'rapport-verwerk-background' voor één rapport (fire-and-forget).
// Netlify antwoordt op een background-aanroep meteen met 202. Slaagt de start niet, dan blijft de
// entry op 'wacht' staan en pikt het vangnet (scheduled function) hem op: nooit gooien.

export async function startAchtergrondtaak({ origin, id, testModus = false, fetch: doFetch = globalThis.fetch, timeoutMs = 5000 }) {
  try {
    const headers = { 'Content-Type': 'application/json' };
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
