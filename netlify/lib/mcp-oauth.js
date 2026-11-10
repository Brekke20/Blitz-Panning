// OAuth-kern voor de MCP-leesconnector: clientregistratie, autorisatiecode (PKCE S256),
// access- en refresh-tokens. Tokens worden enkel als SHA-256-hash bewaard. `nu` is in milliseconden.
// Blobs (allemaal onder `mcp-`): client-<id>, code-<hash>, acc-<hash>, ref-<hash>, toegang-<id> (eenmaal geschreven, nooit herschreven: zo kan intrekken niet ongedaan gemaakt worden),
// gebruikt-<id> (laatstGebruikt, hoogstens eens per 5 min geschreven).
// Netlify Blobs kent geen atomaire "lees en verwijder": een code die op exact hetzelfde moment twee keer
// wordt ingewisseld kan in theorie twee keer slagen (smal venster; PKCE-verifier is nog steeds vereist).

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

export const ACCESS_TTL_S = 3600;
export const REFRESH_TTL_S = 30 * 24 * 3600;
export const CODE_TTL_S = 60;
export const GEBRUIKT_THROTTLE_MS = 5 * 60 * 1000;

const hash = t => createHash('sha256').update(String(t)).digest('hex');
const nieuwToken = () => randomBytes(32).toString('base64url');
const FOUT = () => ({ fout: 'invalid_grant' });

const VASTE_REDIRECTS = new Set([
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
]);

function redirectToegestaan(uri) {
  if (typeof uri !== 'string') return false;
  if (VASTE_REDIRECTS.has(uri)) return true;
  let u;
  try { u = new URL(uri); } catch { return false; }
  return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')
    && u.port !== '' && !u.username && !u.password && !u.hash;
}

export async function registreerClient(store, { redirect_uris, client_name } = {}) {
  if (!Array.isArray(redirect_uris) || !redirect_uris.length || !redirect_uris.every(redirectToegestaan)) {
    return { fout: 'invalid_redirect_uri' };
  }
  const naam = typeof client_name === 'string' ? client_name.slice(0, 100) : '';
  const client = { client_id: randomUUID(), redirect_uris: [...redirect_uris], client_name: naam };
  await store.setJSON(`mcp-client-${client.client_id}`, client);
  return client;
}

export async function maakCode(store, { clientId, redirectUri, codeChallenge, uid, sessieVersie }, nu = Date.now()) {
  const code = nieuwToken();
  await store.setJSON(`mcp-code-${hash(code)}`, {
    clientId, redirectUri, codeChallenge, uid, sessieVersie, verlooptOp: nu + CODE_TTL_S * 1000,
  });
  return code;
}

function pkceKlopt(verifier, challenge) {
  if (typeof verifier !== 'string' || typeof challenge !== 'string' || !verifier) return false;
  const a = Buffer.from(createHash('sha256').update(verifier).digest('base64url'));
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function geefTokens(store, toegang, nu) {
  const access = nieuwToken();
  const refresh = nieuwToken();
  const accessHash = hash(access);
  const refreshHash = hash(refresh);
  await store.setJSON(`mcp-acc-${accessHash}`, { toegangId: toegang.id, verlooptOp: nu + ACCESS_TTL_S * 1000 });
  await store.setJSON(`mcp-ref-${refreshHash}`, { toegangId: toegang.id, clientId: toegang.clientId, accessHash, verlooptOp: nu + REFRESH_TTL_S * 1000 });
  return {
    tokens: { access_token: access, refresh_token: refresh, expires_in: ACCESS_TTL_S, token_type: 'Bearer' },
    accessHash, refreshHash,
  };
}

export async function wisselCode(store, { code, clientId, redirectUri, codeVerifier } = {}, nu = Date.now()) {
  if (!code) return FOUT();
  const sleutel = `mcp-code-${hash(code)}`;
  const rec = await store.get(sleutel, { type: 'json' });
  if (!rec) return FOUT();
  await store.delete(sleutel); // eenmalig, ook bij een mislukte poging
  if (nu > rec.verlooptOp) return FOUT();
  if (rec.clientId !== clientId || rec.redirectUri !== redirectUri) return FOUT();
  if (!pkceKlopt(codeVerifier, rec.codeChallenge)) return FOUT();

  const client = await store.get(`mcp-client-${clientId}`, { type: 'json' });
  const toegang = {
    id: randomUUID(), uid: rec.uid, sessieVersie: rec.sessieVersie, clientId,
    clientNaam: client?.client_name || '', aangemaakt: nu,
  };
  await store.setJSON(`mcp-toegang-${toegang.id}`, toegang);
  return (await geefTokens(store, toegang, nu)).tokens;
}

export async function ververs(store, { refreshToken, clientId } = {}, nu = Date.now()) {
  if (!refreshToken) return FOUT();
  const sleutel = `mcp-ref-${hash(refreshToken)}`;
  const rec = await store.get(sleutel, { type: 'json' });
  if (!rec) return FOUT();
  await store.delete(sleutel); // roteren: elk refresh token werkt één keer
  if (nu > rec.verlooptOp || rec.clientId !== clientId) return FOUT();
  const toegang = await store.get(`mcp-toegang-${rec.toegangId}`, { type: 'json' });
  if (!toegang) return FOUT();

  if (rec.accessHash) await store.delete(`mcp-acc-${rec.accessHash}`);
  const { tokens, accessHash, refreshHash } = await geefTokens(store, toegang, nu);
  // Intrekken kan tussen lezen en schrijven gebeurd zijn: dan de nieuwe tokens meteen weer weg.
  if (!(await store.get(`mcp-toegang-${toegang.id}`, { type: 'json' }))) {
    await store.delete(`mcp-acc-${accessHash}`);
    await store.delete(`mcp-ref-${refreshHash}`);
    return FOUT();
  }
  return tokens;
}

export async function zoekToegang(store, accessToken, nu = Date.now()) {
  if (!accessToken) return null;
  const sleutel = `mcp-acc-${hash(accessToken)}`;
  const rec = await store.get(sleutel, { type: 'json' });
  if (!rec) return null;
  if (nu > rec.verlooptOp) { await store.delete(sleutel); return null; }
  const toegang = await store.get(`mcp-toegang-${rec.toegangId}`, { type: 'json' });
  if (!toegang) return null;
  const gebruiktSleutel = `mcp-gebruikt-${toegang.id}`;
  const vorig = (await store.get(gebruiktSleutel, { type: 'json' }))?.laatstGebruikt ?? toegang.aangemaakt;
  if (nu - vorig >= GEBRUIKT_THROTTLE_MS) {
    // best-effort, aparte blob; verdwenen toegang (intrekken ertussen) laat geen spoor na
    try {
      await store.setJSON(gebruiktSleutel, { laatstGebruikt: nu });
      if (!(await store.get(`mcp-toegang-${toegang.id}`, { type: 'json' }))) await store.delete(gebruiktSleutel);
    } catch { /* negeren */ }
  }
  return { ...toegang, laatstGebruikt: vorig };
}

export async function lijstToegangen(store) {
  const { blobs } = await store.list({ prefix: 'mcp-toegang-' });
  const uit = [];
  for (const { key } of blobs) {
    const t = await store.get(key, { type: 'json' });
    if (!t) continue;
    const g = await store.get(`mcp-gebruikt-${t.id}`, { type: 'json' });
    uit.push({ ...t, laatstGebruikt: g?.laatstGebruikt ?? t.aangemaakt });
  }
  return uit;
}

export async function trekIn(store, toegangId) {
  if (!toegangId) return false;
  const sleutel = `mcp-toegang-${toegangId}`;
  if (!(await store.get(sleutel, { type: 'json' }))) return false;
  // Zonder dit record zijn access- en refresh-token meteen waardeloos (restblobs verlopen vanzelf).
  await store.delete(sleutel);
  await store.delete(`mcp-gebruikt-${toegangId}`);
  return true;
}
