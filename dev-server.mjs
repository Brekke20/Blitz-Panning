/**
 * Lokale dev server — vervangt Netlify voor lokaal testen.
 * Gebruik: node dev-server.mjs
 *
 * Serveert:
 *   /          → public/index.html
 *   /api/*     → netlify/functions/*.js (als ES module)
 *   /.netlify/functions/<naam> → idem; '-background' antwoordt meteen 202 en draait los
 *
 * Credentials worden geladen uit .env.local in dezelfde map.
 */

import http    from 'node:http';
import fs      from 'node:fs';
import path    from 'node:path';
import url     from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

// ── .env.local laden ──────────────────────────────────────────────────────────
const envFile = path.join(__dirname, '.env.local');
if (!fs.existsSync(envFile)) {
  console.error('\n❌  .env.local niet gevonden!');
  console.error('Maak het aan met:\n');
  console.error('  ZOHO_CLIENT_ID=...');
  console.error('  ZOHO_CLIENT_SECRET=...');
  console.error('  ZOHO_REFRESH_TOKEN=...');
  console.error('  TOMTOM_API_KEY=...\n');
  process.exit(1);
}
for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
  const [key, ...rest] = line.split('=');
  if (key && key.trim() && !key.trim().startsWith('#')) {
    process.env[key.trim()] = rest.join('=').trim();
  }
}
console.log('✅  .env.local geladen');

// ── Lokale dev (logins) ───────────────────────────────────────────────────────
// BLITZ_LOKALE_DEV maakt de testrol (X-Blitz-Test-Rol) en de rolwisselaar mogelijk; ENKEL hier gezet, nooit door
// een request en nooit in een Netlify-runtime. De lokale standaardwaarden voor het sessiegeheim en de
// eerste-beheerder-code gelden enkel in dev-server.mjs; .env.local wint.
process.env.BLITZ_LOKALE_DEV = '1';
process.env.SESSIE_GEHEIM ||= 'lokaal-dev-geheim-niet-voor-productie';
process.env.BEHEER_SETUP_CODE ||= 'lokaal';

// ── MIME types ─────────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.svg':  'image/svg+xml',
};

// ── Netlify function handler ────────────────────────────────────────────────────
async function callFunction(fnName, req, body) {
  const fnPath = path.join(__dirname, 'netlify', 'functions', `${fnName}.js`);
  if (!fs.existsSync(fnPath)) return { statusCode: 404, body: JSON.stringify({ error: `Functie niet gevonden: ${fnName}` }) };

  // Cache-bust op basis van bestandswijzigingstijd zodat code-wijzigingen
  // direct worden opgepikt zonder server-herstart.
  const mtime = fs.statSync(fnPath).mtimeMs;
  const mod = await import(url.pathToFileURL(fnPath).href + `?t=${mtime}`);

  const parsedUrl  = new URL(req.url, 'http://localhost');
  const queryStringParameters = Object.fromEntries(parsedUrl.searchParams.entries());

  // Classic-stijl: export async function handler(event) { ... }
  if (typeof mod.handler === 'function') {
    const event = {
      httpMethod:            req.method,
      path:                  parsedUrl.pathname,
      headers:               req.headers,
      queryStringParameters,
      body:                  body || null,
    };
    return mod.handler(event);
  }

  // Netlify Functions v2-stijl: export default async (req) => new Response(...)
  if (typeof mod.default === 'function') {
    const fetchHeaders = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v !== undefined) fetchHeaders.set(k, Array.isArray(v) ? v.join(', ') : String(v));
    }
    const init = { method: req.method, headers: fetchHeaders };
    if (body && req.method !== 'GET' && req.method !== 'HEAD') init.body = body;
    // Host uit het verzoek (incl. poort), zodat new URL(req.url).origin in functies klopt
    const request  = new Request(`http://${req.headers.host || 'localhost'}${req.url}`, init);
    const response = await mod.default(request);
    // Background Functions geven niets terug (Netlify negeert het antwoord)
    if (!response) return { statusCode: 202, body: '' };
    const resBody    = await response.text();
    const resHeaders = {};
    response.headers.forEach((v, k) => { resHeaders[k] = v; });
    return { statusCode: response.status, headers: resHeaders, body: resBody };
  }

  return { statusCode: 500, body: JSON.stringify({ error: `${fnName}.js exporteert geen 'handler' en geen 'default'` }) };
}

// ── HTTP server ────────────────────────────────────────────────────────────────
const PORT = 3333;

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  const pathname  = parsedUrl.pathname;

  // Body inlezen
  let body = '';
  for await (const chunk of req) body += chunk;

  // CORS preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Blitz, X-Blitz-Test, X-Blitz-Test-Rol');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  try {
    // API routes → Netlify functions
    if (pathname.startsWith('/api/')) {
      const fnName = pathname.slice(5).split('/')[0]; // /api/tickets → tickets
      console.log(`[API] ${req.method} /api/${fnName}`);
      const result = await callFunction(fnName, req, body || null);
      res.writeHead(result.statusCode || 200, { 'Content-Type': 'application/json', ...result.headers });
      res.end(result.body || '');
      return;
    }

    // Rechtstreekse functie-aanroep (zoals startAchtergrondtaak doet): /.netlify/functions/<naam>
    if (pathname.startsWith('/.netlify/functions/')) {
      const fnName = pathname.slice('/.netlify/functions/'.length).split('/')[0];
      console.log(`[FN] ${req.method} ${fnName}`);
      if (fnName.endsWith('-background')) {
        // Background Function: Netlify antwoordt meteen 202 en draait de functie los van het verzoek
        res.writeHead(202);
        res.end();
        callFunction(fnName, req, body || null)
          .catch(err => console.error('[BACKGROUND]', fnName, err));
        return;
      }
      const result = await callFunction(fnName, req, body || null);
      res.writeHead(result.statusCode || 200, { 'Content-Type': 'application/json', ...result.headers });
      res.end(result.body || '');
      return;
    }

    // Statische bestanden uit public/
    let filePath = path.join(__dirname, 'public', pathname === '/' ? 'index.html' : pathname);
    if (!fs.existsSync(filePath)) filePath = path.join(__dirname, 'public', 'index.html'); // SPA fallback

    const ext  = path.extname(filePath);
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    fs.createReadStream(filePath).pipe(res);

  } catch (err) {
    console.error('[ERR]', err.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message, stack: err.stack }));
  }
});

// Enkel localhost (eindreview M1): de testrol-omzeiling (BLITZ_LOKALE_DEV) mag nooit voor het netwerk bereikbaar zijn.
server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n🚀  Dev server draait op http://localhost:${PORT}`);
  console.log(`    Test mode:  http://localhost:${PORT}/?test\n`);
});
