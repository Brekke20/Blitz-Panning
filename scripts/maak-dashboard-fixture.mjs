// Schrijft het dashboard-antwoord van de testset naar e2e/fixtures/dashboard.json (invoer voor de e2e-tests).
// Gebruik: node scripts/maak-dashboard-fixture.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { berekenDashboard } from '../netlify/lib/dashboard-metrics.js';
import { maakTestset } from '../tests/fixtures/dashboard-testset.mjs';

const doel = join(dirname(fileURLToPath(import.meta.url)), '..', 'e2e', 'fixtures', 'dashboard.json');
mkdirSync(dirname(doel), { recursive: true });
writeFileSync(doel, `${JSON.stringify(berekenDashboard(maakTestset()), null, 2)}\n`);
console.log(`Geschreven: ${doel}`);
