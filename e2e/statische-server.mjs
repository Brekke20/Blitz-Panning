// Statische server voor de e2e-suite: serveert enkel public/ op poort 3338.
// Geen SPA-fallback (een fout pad moet opvallen) en geen echte /api: elk /api-verzoek dat hier
// toch aankomt (de page.route-vangnet in helpers.mjs is het eerste slot) krijgt 599.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const PUBLIC = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..', 'public');
const POORT = 3338;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};

http.createServer((req, res) => {
  const pad = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (pad.startsWith('/api/')) {
    res.writeHead(599, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'niet gestubd' }));
  }
  const bestand = path.normalize(path.join(PUBLIC, pad === '/' ? 'index.html' : pad));
  if (!bestand.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(bestand, (err, data) => {
    if (err) { res.writeHead(404); return res.end('niet gevonden'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(bestand)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(POORT, () => console.log(`e2e statische server op http://localhost:${POORT}`));
