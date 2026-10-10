// Adapter: laat een v1-handler (event -> { statusCode, headers, body }) draaien als Netlify Functions v2
// (Request -> Response). Reden: enkel een v2-functie krijgt de volledige Netlify Blobs-omgeving (incl. de
// uncachedEdgeURL die `consistency: 'strong'` nodig heeft); connectLambda(event) in een v1-functie levert die niet.
// De bedrijfslogica van de v1-handlers blijft ongewijzigd: de adapter vertaalt enkel de in- en uitgang.
//
//   export default alsV2(beveiligV1('tickets', kern));
//
// Het resultaat heeft een eigenschap `.v1` met de oorspronkelijke handler (voor tests en dev-tools).

const GEEN_BODY = new Set([101, 204, 205, 304]);

// Request -> v1-event. Koppen kleine letters (zoals Netlify's v1), body als tekst, nooit base64.
export async function requestNaarEvent(req) {
  const url = new URL(req.url);
  const headers = {};
  req.headers.forEach((waarde, naam) => { headers[naam.toLowerCase()] = waarde; });

  const queryStringParameters = {};
  const multiValueQueryStringParameters = {};
  for (const [k, v] of url.searchParams.entries()) {
    queryStringParameters[k] = v; // bij herhaling wint de laatste, zoals in Netlify's Lambda-compat
    (multiValueQueryStringParameters[k] ??= []).push(v);
  }

  const methode = String(req.method || 'GET').toUpperCase();
  let body = null;
  if (methode !== 'GET' && methode !== 'HEAD') {
    const tekst = await req.text();
    body = tekst === '' ? null : tekst;
  }

  return {
    httpMethod: methode,
    headers,
    multiValueHeaders: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, [v]])),
    path: url.pathname,
    rawUrl: req.url,
    rawQuery: url.search.startsWith('?') ? url.search.slice(1) : url.search,
    queryStringParameters,
    multiValueQueryStringParameters,
    body,
    isBase64Encoded: false,
  };
}

function voegKopToe(headers, naam, waarde) {
  if (waarde === undefined || waarde === null) return;
  if (Array.isArray(waarde)) { for (const w of waarde) voegKopToe(headers, naam, w); return; }
  headers.append(naam, String(waarde));
}

// v1-resultaat -> Response. Meerdere Set-Cookie's en andere meervoudige koppen blijven gescheiden.
export function resultaatNaarResponse(res) {
  const status = Number(res?.statusCode);
  if (!res || typeof res !== 'object' || !Number.isInteger(status) || status < 200 || status > 599) {
    return new Response(JSON.stringify({ error: 'Ongeldig antwoord van de functie' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
  const headers = new Headers();
  for (const [naam, waarde] of Object.entries(res.headers ?? {})) voegKopToe(headers, naam, waarde);
  for (const [naam, waarde] of Object.entries(res.multiValueHeaders ?? {})) {
    // Staat dezelfde kop (ongeacht hoofdletters) al in `headers`, dan niet dubbel toevoegen.
    if (Object.keys(res.headers ?? {}).some(k => k.toLowerCase() === naam.toLowerCase())) continue;
    voegKopToe(headers, naam, waarde);
  }
  let body = res.body;
  if (body === undefined || body === null || body === '' || GEEN_BODY.has(status)) body = null;
  else if (res.isBase64Encoded === true) body = Buffer.from(String(body), 'base64');
  else if (typeof body !== 'string') body = String(body);
  return new Response(body, { status, headers });
}

export function alsV2(v1Handler) {
  if (typeof v1Handler !== 'function') throw new Error('alsV2: een functie verwacht');
  const v2 = async (req, context) => {
    const event = await requestNaarEvent(req);
    return resultaatNaarResponse(await v1Handler(event, context));
  };
  return Object.assign(v2, { v1: v1Handler });
}
