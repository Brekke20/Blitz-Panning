// Gedeelde Zoho-onderdelen: token, org-id, headers en een verzoek-helper.
// Gedrag is byte-identiek aan de vroegere losse kopieën in de functies (etappe 6, W5/W11):
// de tokencache leeft in de instantie (nooit in module-scope), het org-id wordt niet gecachet,
// en env-variabelen worden bij elke aanroep gelezen.

export const ZOHO_ACCOUNTS = 'https://accounts.zoho.eu/oauth/v2/token';
export const ZOHO_DESK     = 'https://desk.zoho.eu/api/v1';

// Lazy: lost globalThis.fetch bij elke aanroep op, zodat tests het kunnen vervangen.
export const globaleFetch = (...args) => globalThis.fetch(...args);

export function maakZoho({
  fetch = globaleFetch,
  env = process.env,
  nu = () => Date.now(),
  tokenFoutMetData = true,
  orgFoutTekst = 'Zoho org ID niet gevonden',
} = {}) {
  let cachedToken = null;
  let tokenExpiry = 0;

  async function haalToken() {
    if (cachedToken && nu() < tokenExpiry) return cachedToken;
    const params = new URLSearchParams({
      refresh_token: env.ZOHO_REFRESH_TOKEN,
      client_id:     env.ZOHO_CLIENT_ID,
      client_secret: env.ZOHO_CLIENT_SECRET,
      grant_type:    'refresh_token',
    });
    const res  = await fetch(ZOHO_ACCOUNTS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });
    const data = await res.json();
    if (!data.access_token) {
      throw new Error(tokenFoutMetData
        ? 'Token refresh mislukt: ' + JSON.stringify(data)
        : 'Token refresh mislukt');
    }
    cachedToken = data.access_token;
    tokenExpiry = nu() + 55 * 60 * 1000;
    return cachedToken;
  }

  async function haalOrgId(token) {
    const orgRes  = await fetch(`${ZOHO_DESK}/organizations`, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    });
    const orgData = await orgRes.json();
    const orgId   = orgData.data?.[0]?.id;
    if (!orgId) throw new Error(orgFoutTekst);
    return orgId;
  }

  async function haalToegang() {
    const token = await haalToken();
    const orgId = await haalOrgId(token);
    return { token, orgId };
  }

  // Sleutelvolgorde: Authorization, orgId (enkel indien gegeven), Content-Type (enkel bij json).
  function headers(token, orgId, { json = false } = {}) {
    const h = { Authorization: `Zoho-oauthtoken ${token}` };
    if (orgId) h.orgId = orgId;
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }

  // Geeft de ruwe Response terug; foutafhandeling blijft bij de aanroeper.
  // `json` wordt JSON.stringify'd (met Content-Type); `body` (bv. FormData) gaat zonder Content-Type mee.
  function verzoek(pad, { token, orgId, methode, json, body, headers: extra } = {}) {
    const opties = {};
    if (methode) opties.method = methode;
    opties.headers = { ...headers(token, orgId, { json: json !== undefined }), ...extra };
    if (json !== undefined) opties.body = JSON.stringify(json);
    else if (body !== undefined) opties.body = body;
    return fetch(ZOHO_DESK + pad, opties);
  }

  return { haalToken, haalOrgId, haalToegang, headers, verzoek };
}

// Tekst -> JSON.parse; {} bij lege of ongeldige body.
export async function leesJsonVeilig(res) {
  const tekst = await res.text();
  try { return tekst ? JSON.parse(tekst) : {}; }
  catch { return {}; }
}
