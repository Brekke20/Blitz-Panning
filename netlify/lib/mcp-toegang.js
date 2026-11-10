// MCP-leesconnector: Bearer-access-token -> gebruiker. Fail-closed zoals netlify/lib/auth.js: elke fout,
// onbekende token of ongeldige gebruiker geeft 401 invalid_token (nooit een uitzondering, nooit details).
// laatstGebruikt wordt bijgewerkt door zoekToegang (max 1x per 5 min); hier dus niet nogmaals.
import { kop } from './verzoek.js';
import { zoekToegang } from './mcp-oauth.js';
import { ROLLEN_LIJST, leesGebruikers, publiek } from './gebruikers.js';

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

    const record = (await leesGebruikers(store)).find(g => g && g.id === toegang.uid);
    if (!record || record.actief !== true || record.sessieVersie !== toegang.sessieVersie) return WEIGER();
    if (!ROLLEN_LIJST.includes(record.rol)) return WEIGER();
    // Claude kan geen wachtwoord wijzigen: leestoegang wacht tot de gebruiker dat zelf gedaan heeft.
    if (record.moetWachtwoordWijzigen === true) return WEIGER();

    return { ok: true, gebruiker: publiek(record), toegangId: toegang.id };
  } catch (e) {
    console.error('mcp-toegang: controle mislukt (' + (e?.name || 'Error') + ')');
    return WEIGER();
  }
}
