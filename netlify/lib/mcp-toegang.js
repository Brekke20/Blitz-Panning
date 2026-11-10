// MCP-leesconnector: Bearer-access-token -> gebruiker. Fail-closed zoals netlify/lib/auth.js: elke fout,
// onbekende token of ongeldige gebruiker geeft 401 invalid_token (nooit een uitzondering, nooit details).
// De gebruikerscontrole zelf (actief, sessieVersie, rol, moetWachtwoordWijzigen) is geldigeGebruiker uit mcp-oauth.js, dezelfde
// als bij het verversen. laatstGebruikt (max 1x per 5 min) wordt pas na een geslaagde controle bijgewerkt (markeerGebruikt).
import { kop } from './verzoek.js';
import { zoekToegang, geldigeGebruiker, markeerGebruikt } from './mcp-oauth.js';
import { publiek } from './gebruikers.js';

const WEIGER = () => ({ ok: false, status: 401, code: 'invalid_token' });

async function standaardGetStore(opties) {
  const { getStore } = await import('@netlify/blobs');
  return getStore(opties);
}

export async function vereisMcpGebruiker(req, { getStore = standaardGetStore, nu = Date.now() } = {}) {
  try {
    const auth = kop(req, 'authorization');
    const m = typeof auth === 'string' ? /^Bearer\s+(\S+)$/i.exec(auth.trim()) : null;
    if (!m) return WEIGER();

    const store = await getStore({ name: 'blitz-data', consistency: 'strong' });
    const toegang = await zoekToegang(store, m[1], nu);
    if (!toegang) return WEIGER();

    const record = await geldigeGebruiker(store, toegang);
    if (!record) return WEIGER();
    await markeerGebruikt(store, toegang, nu);

    return { ok: true, gebruiker: publiek(record), toegangId: toegang.id };
  } catch (e) {
    console.error('mcp-toegang: controle mislukt (' + (e?.name || 'Error') + ')');
    return WEIGER();
  }
}
