// Lokale-dev-detectie en testgebruikers.
// Lokale dev = ENKEL de omgevingsvariabele BLITZ_LOKALE_DEV=1 (gezet door dev-server.mjs, nooit door een
// request) en GEEN Netlify-runtimevariabele. NETLIFY_DEV telt bewust niet: `netlify dev --live` is publiek bereikbaar.

const RUNTIME_VARIABELEN = ['NETLIFY', 'AWS_LAMBDA_FUNCTION_NAME', 'LAMBDA_TASK_ROOT'];

// Een gezette maar lege runtimevariabele telt ook als runtime (fail-closed).
export function heeftNetlifyRuntime(env = process.env) {
  if (!env || typeof env !== 'object') return true;
  return RUNTIME_VARIABELEN.some(naam => env[naam] !== undefined);
}

export function isLokaleDev(env = process.env) {
  if (!env || typeof env !== 'object') return false;
  return env.BLITZ_LOKALE_DEV === '1' && !heeftNetlifyRuntime(env);
}

const maak = g => Object.freeze(g);

export const TESTGEBRUIKERS = Object.freeze({
  'test-beheerder': maak({ id: 'test-beheerder', email: 'test-beheerder@lokaal.test', naam: 'Test Beheerder', rol: 'beheerder' }),
  'test-planner': maak({ id: 'test-planner', email: 'test-planner@lokaal.test', naam: 'Test Planner', rol: 'planner' }),
  'test-technieker': maak({ id: 'test-technieker', email: 'test-technieker@lokaal.test', naam: 'Test Technieker', rol: 'technieker', zohoNaam: 'Tim' }),
  'test-sales': maak({ id: 'test-sales', email: 'test-sales@lokaal.test', naam: 'Test Verkoper', rol: 'sales', salesNaam: 'Test Verkoper', magAlleSales: false }),
});
