/**
 * Lokale dev server — vervangt Netlify voor lokaal testen.
 * Gebruik: node dev-server.mjs
 *
 * Serveert:
 *   /          → public/index.html
 *   /api/*     → netlify/functions/*.js (als ES module)
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

  // Module cachen zodat token-cache in de functie bewaard blijft tussen requests
  const mod = await import(url.pathToFileURL(fnPath).href);

  const parsedUrl  = new URL(req.url, 'http://localhost');
  const queryStringParameters = Object.fromEntries(parsedUrl.searchParams.entries());

  const event = {
    httpMethod:            req.method,
    path:                  parsedUrl.pathname,
    headers:               req.headers,
    queryStringParameters,
    body:                  body || null,
  };

  return mod.handler(event);
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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

server.listen(PORT, () => {
  console.log(`\n🚀  Dev server draait op http://localhost:${PORT}`);
  console.log(`    Test mode:  http://localhost:${PORT}/?test`);
  console.log(`    Debug:      http://localhost:${PORT}/api/debug-ticket?id=TICKET_ID\n`);
});
