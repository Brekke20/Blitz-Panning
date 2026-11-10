// OAuth 2.1-endpoints van de MCP-leesconnector (Claude): metadata, dynamische clientregistratie, authorize
// (Blitz-login + toestemmingsscherm) en token. De kern (codes, tokens, intrekken) staat in netlify/lib/mcp-oauth.js.
//   GET  /.well-known/oauth-protected-resource[/api/mcp]   GET /.well-known/oauth-authorization-server
//   POST /api/mcp-oauth/register   GET|POST /api/mcp-oauth/authorize   POST /api/mcp-oauth/token
// Rij 'open' in rechten.js: geen sessie nodig voor metadata/registratie/token; authorize controleert zelf de sessie
// (vereisGebruiker). Beveiliging authorize:
//   - redirect_uri moet letterlijk een geregistreerde URI van de client zijn; anders een 400-pagina, NOOIT een redirect.
//   - elke validatiefout geeft een 400-pagina (geen redirect met error=...).
//   - POST is beschermd door een HMAC-ondertekend consent-veld (SESSIE_GEHEIM, eigen domeinprefix zodat het nooit als
//     sessietoken geldig is) dat uid, sessieVersie en alle parameters bindt en na 10 min vervalt. Een gewoon formulier kan
//     geen X-Blitz sturen; het consent-veld is de CSRF-bescherming.
//   - HTML: alles ge-escaped, CSP met nonce, frame-ancestors 'none' + X-Frame-Options DENY, no-store, no-referrer.
import { getStore } from '@netlify/blobs';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { registreerClient, maakCode, wisselCode, ververs } from '../lib/mcp-oauth.js';
import { vereisGebruiker as standaardVereisGebruiker } from '../lib/auth.js';
import { controleerToken, COOKIE_NAAM } from '../lib/sessie-token.js';
import { leesCookie } from '../lib/verzoek.js';
import { logActiviteit } from '../lib/activiteit.js';
import { beveiligV2 } from '../lib/beveiligd.js';
import { maakCors } from '../lib/http.js';

const MAX_BODY = 10 * 1024;
const MAX_REDIRECTS = 5;
const MAX_STATE = 1000;
const CONSENT_TTL_MS = 10 * 60 * 1000;
const CONSENT_DOMEIN = 'blitz-mcp-consent-v1:';
const CLIENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43,128}$/;
const CORS_ORIGINS = new Set(['https://claude.ai', 'https://claude.com']);

// ---- hulp ----
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const hmac = (geheim, tekst) => createHmac('sha256', geheim).update(tekst).digest('base64url');
const geheimVan = env => (typeof env.SESSIE_GEHEIM === 'string' && env.SESSIE_GEHEIM !== '' ? env.SESSIE_GEHEIM : null);

function apiCors(req) {
  const origin = req.headers.get('origin');
  return {
    ...maakCors({ methoden: 'POST, OPTIONS', headers: 'Content-Type, Authorization', origin: CORS_ORIGINS.has(origin) ? origin : 'https://claude.ai' }),
    Vary: 'Origin',
  };
}
const METADATA_CORS = maakCors({ methoden: 'GET, OPTIONS', headers: 'Content-Type, MCP-Protocol-Version' });

function json(status, obj, cors) {
  return new Response(JSON.stringify(obj), {
    status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Pragma: 'no-cache' },
  });
}

// Body lezen met een harde grens op de gelezen bytes (niet enkel Content-Length). null = te groot.
async function leesBody(req) {
  const cl = Number(req.headers.get('content-length'));
  if (Number.isFinite(cl) && cl > MAX_BODY) return null;
  if (!req.body) return '';
  const lezer = req.body.getReader();
  const delen = [];
  let totaal = 0;
  for (;;) {
    const { done, value } = await lezer.read();
    if (done) break;
    totaal += value.byteLength;
    if (totaal > MAX_BODY) { try { await lezer.cancel(); } catch { /* negeren */ } return null; }
    delen.push(Buffer.from(value));
  }
  return Buffer.concat(delen).toString('utf8');
}

// Form-urlencoded of JSON -> plat object met enkel tekstwaarden. null = onleesbaar.
function ontleedVelden(tekst, inhoudType) {
  if (/application\/json/i.test(inhoudType || '')) {
    let o;
    try { o = JSON.parse(tekst); } catch { return null; }
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
    return Object.fromEntries(Object.entries(o).filter(([, w]) => typeof w === 'string'));
  }
  return Object.fromEntries(new URLSearchParams(tekst));
}

// ---- HTML ----
const STIJL = `
:root{--bg:#f4f7f6;--kaart:#fff;--tekst:#14202b;--zacht:#56636f;--rand:#d5dde3;--accent:#00a87b;--accent-tekst:#fff;--fout:#b3261e}
@media (prefers-color-scheme:dark){:root{--bg:#0d1530;--kaart:#1d252d;--tekst:#eef3f6;--zacht:#a9b5c0;--rand:#2e3a46;--accent:#00dfa3;--accent-tekst:#062018;--fout:#ff8a80}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;background:var(--bg);color:var(--tekst);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{width:100%;max-width:440px;background:var(--kaart);border:1px solid var(--rand);border-radius:16px;padding:28px}
.merk{font-weight:700;color:var(--accent);letter-spacing:.02em;margin:0 0 12px}h1{font-size:1.35rem;margin:0 0 12px}p{margin:0 0 12px}.klein{color:var(--zacht);font-size:.9rem}
label{display:block;font-weight:600;margin:12px 0 4px}input{width:100%;padding:10px 12px;border:1px solid var(--rand);border-radius:10px;background:transparent;color:var(--tekst);font:inherit}
.knoppen{display:flex;gap:12px;margin-top:20px;flex-wrap:wrap}button{flex:1;min-width:120px;padding:12px 16px;border-radius:10px;border:1px solid var(--rand);background:transparent;color:var(--tekst);font:inherit;font-weight:600;cursor:pointer}
button.hoofd{background:var(--accent);border-color:var(--accent);color:var(--accent-tekst)}button:disabled{opacity:.6}.fout{color:var(--fout);min-height:1.5em}`;

function pagina(status, titel, inhoud, { script = '' } = {}) {
  const nonce = randomBytes(16).toString('base64');
  const html = `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<meta name="robots" content="noindex"><title>${esc(titel)} · Blitz Planning</title><style nonce="${nonce}">${STIJL}</style></head>`
    + `<body><main><p class="merk">Blitz Planning</p>${inhoud}</main>${script ? `<script nonce="${nonce}">${script}</script>` : ''}</body></html>`;
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'`,
    },
  });
}
const foutPagina = (status, tekst) => pagina(status, 'Koppelen niet mogelijk', `<h1>Koppelen niet mogelijk</h1><p>${esc(tekst)}</p>`);

// Statisch script (geen interpolatie): aanmelden via de gewone login, daarna dezelfde pagina herladen.
const LOGIN_SCRIPT = `
const f = document.getElementById('login');
const m = document.getElementById('melding');
f.addEventListener('submit', async (e) => {
  e.preventDefault();
  m.textContent = '';
  const knop = f.querySelector('button');
  knop.disabled = true;
  try {
    const r = await fetch('/api/auth-login', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Blitz': '1' },
      body: JSON.stringify({ email: f.email.value, wachtwoord: f.wachtwoord.value }),
    });
    if (r.ok) { location.reload(); return; }
    const d = await r.json().catch(() => ({}));
    m.textContent = d.error || 'Inloggen mislukt.';
  } catch { m.textContent = 'Geen verbinding. Probeer het opnieuw.'; }
  knop.disabled = false;
});`;

const loginPagina = () => pagina(200, 'Aanmelden', `<h1>Aanmelden om Claude te koppelen</h1>`
  + `<p class="klein">Meld je aan met je Blitz Planning-account. Claude ziet je wachtwoord nooit.</p>`
  + `<form id="login"><label for="email">E-mailadres</label><input id="email" name="email" type="email" autocomplete="username" required>`
  + `<label for="wachtwoord">Wachtwoord</label><input id="wachtwoord" name="wachtwoord" type="password" autocomplete="current-password" required>`
  + `<p id="melding" class="fout" role="alert"></p><div class="knoppen"><button class="hoofd" type="submit">Aanmelden</button></div></form>`,
{ script: LOGIN_SCRIPT });

function toestemmingPagina({ naam, clientNaam, redirectHost, consent }) {
  return pagina(200, 'Claude koppelen', `<h1>Claude toegang geven om te lezen?</h1>`
    + `<p>Claude kan planning, tickets en rapporten lezen die jij (${esc(naam)}) mag zien. Claude kan niets wijzigen.</p>`
    + `<p class="klein">Toepassing: ${esc(clientNaam || 'onbekend')} · terug naar ${esc(redirectHost)}</p>`
    + `<form method="post" action="/api/mcp-oauth/authorize"><input type="hidden" name="consent" value="${esc(consent)}">`
    + `<div class="knoppen"><button class="hoofd" type="submit" name="keuze" value="toestaan">Toestaan</button>`
    + `<button type="submit" name="keuze" value="weigeren">Weigeren</button></div></form>`);
}

// ---- consent-veld ----
function tekenConsent(payload, geheim) {
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${b64}.${hmac(geheim, CONSENT_DOMEIN + b64)}`;
}

function leesConsent(token, geheim, nuMs) {
  try {
    if (typeof token !== 'string') return null;
    const delen = token.split('.');
    if (delen.length !== 2 || !delen[0] || !delen[1]) return null;
    const verwacht = Buffer.from(hmac(geheim, CONSENT_DOMEIN + delen[0]));
    const gekregen = Buffer.from(delen[1]);
    if (verwacht.length !== gekregen.length || !timingSafeEqual(verwacht, gekregen)) return null;
    const p = JSON.parse(Buffer.from(delen[0], 'base64url').toString('utf8'));
    if (!p || typeof p !== 'object') return null;
    if (typeof p.u !== 'string' || !Number.isInteger(p.v) || typeof p.c !== 'string' || typeof p.r !== 'string'
      || typeof p.cc !== 'string' || typeof p.s !== 'string' || !Number.isFinite(p.exp)) return null;
    if (p.exp <= nuMs) return null;
    return p;
  } catch {
    return null;
  }
}

// ---- handler ----
export function maakHandler({ getStore: haalStore, env = process.env, nu = () => Date.now(), auth = { vereisGebruiker: standaardVereisGebruiker } } = {}) {
  const store = () => haalStore({ name: 'blitz-data', consistency: 'strong' });

  async function haalClient(s, clientId) {
    if (typeof clientId !== 'string' || !CLIENT_ID_RE.test(clientId)) return null;
    const c = await s.get(`mcp-client-${clientId}`, { type: 'json' });
    return c && Array.isArray(c.redirect_uris) ? c : null;
  }

  // Sessie + sessieVersie (uit het cookie, dat vereisGebruiker net tegen het record heeft gecontroleerd).
  // { ok, gebruiker, sv } | { ok:false, code }. Zonder geldig cookie (testseams) nooit toestemming: fail-closed.
  async function sessie(req, geheim) {
    const r = await auth.vereisGebruiker(req, { rollen: [], schrijven: false });
    if (!r || r.ok !== true || !r.gebruiker) return { ok: false, code: r?.code || 'niet-ingelogd' };
    const claims = controleerToken(leesCookie(req, COOKIE_NAAM), geheim, Math.floor(nu() / 1000));
    if (!claims || claims.uid !== r.gebruiker.id || !Number.isInteger(claims.sv)) return { ok: false, code: 'niet-ingelogd' };
    return { ok: true, gebruiker: r.gebruiker, sv: claims.sv };
  }

  function metadata(origin, pad) {
    if (pad.startsWith('/.well-known/oauth-protected-resource')) {
      return json(200, { resource: `${origin}/api/mcp`, authorization_servers: [origin] }, METADATA_CORS);
    }
    return json(200, {
      issuer: origin,
      authorization_endpoint: `${origin}/api/mcp-oauth/authorize`,
      token_endpoint: `${origin}/api/mcp-oauth/token`,
      registration_endpoint: `${origin}/api/mcp-oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['lezen'],
    }, METADATA_CORS);
  }

  async function registreer(req) {
    const cors = apiCors(req);
    const tekst = await leesBody(req);
    if (tekst === null) return json(400, { error: 'invalid_client_metadata', error_description: 'Body te groot.' }, cors);
    let body;
    try { body = JSON.parse(tekst); } catch { return json(400, { error: 'invalid_client_metadata' }, cors); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { error: 'invalid_client_metadata' }, cors);
    if (Array.isArray(body.redirect_uris) && body.redirect_uris.length > MAX_REDIRECTS) {
      return json(400, { error: 'invalid_redirect_uri', error_description: `Hoogstens ${MAX_REDIRECTS} redirect_uris.` }, cors);
    }
    const c = await registreerClient(await store(), { redirect_uris: body.redirect_uris, client_name: body.client_name });
    if (c.fout) return json(400, { error: c.fout }, cors);
    return json(201, {
      client_id: c.client_id,
      client_id_issued_at: Math.floor(nu() / 1000),
      client_name: c.client_name,
      redirect_uris: c.redirect_uris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }, cors);
  }

  async function authorizeGet(req, geheim) {
    const q = new URL(req.url).searchParams;
    const PARAMS = ['response_type', 'client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'state'];
    if (PARAMS.some(k => q.getAll(k).length > 1)) return foutPagina(400, 'Ongeldig verzoek: dubbele parameter.');
    const clientId = q.get('client_id') || '';
    const redirectUri = q.get('redirect_uri') || '';
    if (!clientId || !redirectUri) return foutPagina(400, 'Ongeldig verzoek: client_id en redirect_uri zijn verplicht.');
    const s = await store();
    const client = await haalClient(s, clientId);
    if (!client) return foutPagina(400, 'Onbekende toepassing. Koppel opnieuw vanuit Claude.');
    if (!client.redirect_uris.includes(redirectUri)) return foutPagina(400, 'Deze terugkeer-URL hoort niet bij de toepassing.');
    if (q.get('response_type') !== 'code') return foutPagina(400, 'Ongeldig verzoek: response_type moet "code" zijn.');
    if (q.get('code_challenge_method') !== 'S256') return foutPagina(400, 'Ongeldig verzoek: enkel PKCE met S256.');
    const codeChallenge = q.get('code_challenge') || '';
    if (!CHALLENGE_RE.test(codeChallenge)) return foutPagina(400, 'Ongeldig verzoek: code_challenge ontbreekt of is ongeldig.');
    const state = q.get('state') ?? '';
    if (state.length > MAX_STATE) return foutPagina(400, 'Ongeldig verzoek: state is te lang.');

    const sess = await sessie(req, geheim);
    if (!sess.ok) {
      if (sess.code === 'wachtwoord-wijzigen') {
        return pagina(403, 'Wachtwoord wijzigen', '<h1>Wijzig eerst je wachtwoord</h1><p>Wijzig eerst je wachtwoord in de tool en probeer daarna opnieuw te koppelen.</p>');
      }
      if (sess.code === 'opslag-storing') return foutPagina(503, 'De opslag is tijdelijk niet bereikbaar. Probeer het zo meteen opnieuw.');
      return loginPagina();
    }
    const consent = tekenConsent({
      u: sess.gebruiker.id, v: sess.sv, c: clientId, r: redirectUri, cc: codeChallenge, s: state, exp: nu() + CONSENT_TTL_MS,
    }, geheim);
    return toestemmingPagina({ naam: sess.gebruiker.naam, clientNaam: client.client_name, redirectHost: new URL(redirectUri).host, consent });
  }

  function terug(redirectUri, velden, state) {
    const u = new URL(redirectUri);
    for (const [k, w] of Object.entries(velden)) u.searchParams.set(k, w);
    if (state) u.searchParams.set('state', state);
    return new Response(null, {
      status: 302, headers: { Location: u.toString(), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
    });
  }

  async function authorizePost(req, geheim) {
    const tekst = await leesBody(req);
    if (tekst === null) return foutPagina(400, 'Ongeldig verzoek.');
    const velden = Object.fromEntries(new URLSearchParams(tekst));
    const p = leesConsent(velden.consent, geheim, nu());
    if (!p) return foutPagina(403, 'Deze toestemming is ongeldig of verlopen. Koppel opnieuw vanuit Claude.');
    if (velden.keuze !== 'toestaan' && velden.keuze !== 'weigeren') return foutPagina(403, 'Ongeldige keuze.');
    const sess = await sessie(req, geheim);
    if (!sess.ok || sess.gebruiker.id !== p.u || sess.sv !== p.v) {
      return foutPagina(403, 'Je sessie is verlopen of gewijzigd. Koppel opnieuw vanuit Claude.');
    }
    const s = await store();
    const client = await haalClient(s, p.c);
    if (!client || !client.redirect_uris.includes(p.r)) return foutPagina(400, 'Onbekende toepassing. Koppel opnieuw vanuit Claude.');
    if (velden.keuze === 'weigeren') return terug(p.r, { error: 'access_denied' }, p.s);

    const code = await maakCode(s, { clientId: p.c, redirectUri: p.r, codeChallenge: p.cc, uid: p.u, sessieVersie: p.v }, nu());
    await logActiviteit(s, { gebruiker: sess.gebruiker, actie: 'claude-gekoppeld', onderwerp: client.client_name || null }, { nu });
    return terug(p.r, { code }, p.s);
  }

  async function token(req) {
    const cors = apiCors(req);
    const tekst = await leesBody(req);
    if (tekst === null) return json(400, { error: 'invalid_request' }, cors);
    const v = ontleedVelden(tekst, req.headers.get('content-type'));
    if (!v) return json(400, { error: 'invalid_request' }, cors);
    let clientId = v.client_id;
    // Publieke client: client_id mag ook als gebruikersnaam in Basic-auth staan (zonder geheim).
    const basic = /^Basic\s+(\S+)$/i.exec(req.headers.get('authorization') || '');
    if (!clientId && basic) {
      try { clientId = decodeURIComponent(Buffer.from(basic[1], 'base64').toString('utf8').split(':')[0]); } catch { clientId = ''; }
    }
    const s = await store();
    let r;
    if (v.grant_type === 'authorization_code') {
      if (!v.code || !clientId || !v.redirect_uri || !v.code_verifier) return json(400, { error: 'invalid_request' }, cors);
      r = await wisselCode(s, { code: v.code, clientId, redirectUri: v.redirect_uri, codeVerifier: v.code_verifier }, nu());
    } else if (v.grant_type === 'refresh_token') {
      if (!v.refresh_token || !clientId) return json(400, { error: 'invalid_request' }, cors);
      r = await ververs(s, { refreshToken: v.refresh_token, clientId }, nu());
    } else if (!v.grant_type) {
      return json(400, { error: 'invalid_request' }, cors);
    } else {
      return json(400, { error: 'unsupported_grant_type' }, cors);
    }
    if (!r || r.fout) return json(400, { error: 'invalid_grant' }, cors);
    return json(200, { ...r, scope: 'lezen' }, cors);
  }

  return async (req) => {
    const u = new URL(req.url);
    const pad = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, '') : u.pathname;
    const isApi = pad.startsWith('/api/');
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: isApi ? apiCors(req) : METADATA_CORS });
    try {
      if (pad === '/.well-known/oauth-protected-resource' || pad === '/.well-known/oauth-protected-resource/api/mcp'
        || pad === '/.well-known/oauth-authorization-server') {
        if (req.method !== 'GET' && req.method !== 'HEAD') return json(405, { error: 'Method not allowed' }, METADATA_CORS);
        return metadata(u.origin, pad);
      }
      if (pad === '/api/mcp-oauth/register') {
        if (req.method !== 'POST') return json(405, { error: 'Method not allowed' }, apiCors(req));
        return await registreer(req);
      }
      if (pad === '/api/mcp-oauth/token') {
        if (req.method !== 'POST') return json(405, { error: 'Method not allowed' }, apiCors(req));
        return await token(req);
      }
      if (pad === '/api/mcp-oauth/authorize') {
        if (req.method !== 'GET' && req.method !== 'POST') return foutPagina(405, 'Methode niet toegestaan.');
        const geheim = geheimVan(env);
        if (!geheim) {
          console.error('mcp-oauth: SESSIE_GEHEIM ontbreekt');
          return foutPagina(500, 'Koppelen is nu niet beschikbaar.');
        }
        return await (req.method === 'GET' ? authorizeGet(req, geheim) : authorizePost(req, geheim));
      }
      return json(404, { error: 'not_found' }, isApi ? apiCors(req) : METADATA_CORS);
    } catch (e) {
      // Enkel het fouttype loggen: een Blobs-fout kan details bevatten.
      console.error('mcp-oauth: fout (' + (e?.name || 'Error') + ')');
      if (pad === '/api/mcp-oauth/authorize') return foutPagina(500, 'Er ging iets mis. Probeer het zo meteen opnieuw.');
      return json(500, { error: 'server_error' }, isApi ? apiCors(req) : METADATA_CORS);
    }
  };
}

export default beveiligV2('mcp-oauth', maakHandler({ getStore }));

export const config = {
  path: [
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/api/mcp',
    '/.well-known/oauth-authorization-server',
    '/api/mcp-oauth/*',
  ],
};
