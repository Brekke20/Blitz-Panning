// Gedeelde CORS-sets en antwoordhulpen voor v1- (statusCode-object) en v2-handlers (Response).
// De sets zijn letterlijk dezelfde als in de functies voor de migratie (etappe 6, Z7).

// Sleutelvolgorde: ACAO, Methods, Headers, Content-Type; enkel wat gegeven is.
export function maakCors({ methoden, headers, inhoudType, origin = '*' } = {}) {
  const cors = { 'Access-Control-Allow-Origin': origin };
  if (methoden)   cors['Access-Control-Allow-Methods'] = methoden;
  if (headers)    cors['Access-Control-Allow-Headers'] = headers;
  if (inhoudType) cors['Content-Type'] = inhoudType;
  return cors;
}

export const CORS_V1 = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
});

// ---- v1 ----
export function v1Json(statusCode, obj, headers) {
  return { statusCode, headers, body: JSON.stringify(obj) };
}

export function v1Opties(headers) {
  return { statusCode: 204, headers };
}

// null = doorgaan; anders het antwoord (OPTIONS -> 204, niet toegestaan -> 405 JSON).
export function v1Methode(event, toegestaan, headers) {
  if (event.httpMethod === 'OPTIONS') return v1Opties(headers);
  if (!toegestaan.includes(event.httpMethod)) return v1Json(405, { error: 'Method not allowed' }, headers);
  return null;
}

// ---- v2 ----
export function v2Json(status, obj, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

export function v2Opties(cors) {
  return new Response(null, { status: 204, headers: cors });
}

// null = doorgaan; anders het antwoord (OPTIONS -> 204, niet toegestaan -> 405 als tekst).
export function v2Methode(req, toegestaan, cors) {
  if (req.method === 'OPTIONS') return v2Opties(cors);
  if (!toegestaan.includes(req.method)) {
    return new Response('Method Not Allowed', { status: 405, headers: cors });
  }
  return null;
}
