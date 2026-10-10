// /api/dashboard — performance-dashboard. De rechtentabel laat beheerder, planner en sales toe; de rol bepaalt het deel:
//   beheerder -> alles; planner -> enkel het techniekers-deel (geen `sales`); sales met magAlleSales (sales manager) -> enkel het
//   sales-deel (geen techniekerdata of kosten; filters technieker/type/herhaal doen er niet toe); gewone sales -> 403.
//   Bij planner en sales manager staat `deel` ('techniekers' | 'sales') in het antwoord.
//   GET ?van=<YYYY-MM-DD>&tot=<YYYY-MM-DD>&technieker=<naam>&type=<type>&herhaal=<dagen>
//     -> berekenDashboard(...) JSON, aangevuld met `dekking.fouten` (bronnen die faalden) en `bronnen`
//        ({ actief, archief, archiefJaren, activiteitAfgekapt }).
// Zonder van/tot: de laatste 30 dagen. Ongeldige datum, van na tot of een periode langer dan 800 dagen: 400.
// Een falende hoofdbron (rapportlijst) geeft 503 opslag-storing; een falende nevenbron blijft 200 met `dekking.fouten`.
// Enkel tellingen en rapportvelden in het antwoord. Het log en de gebruikers staan altijd in de ECHTE store.
import { getStore } from '@netlify/blobs';
import { beveiligV2 } from '../lib/beveiligd.js';
import { maakCors } from '../lib/http.js';
import { authStore, OPSLAG_STORING } from '../lib/auth-antwoord.js';
import { isTestVerzoek, winkelNaam, zorgVoorTestkopie } from '../lib/testmodus.js';
import { datumInBrussel } from '../lib/bevestigingslink.js';
import { berekenDashboard } from '../lib/dashboard-metrics.js';
import { leesBronnen } from '../lib/dashboard-bronnen.js';
import { dagenTussen, vorigePeriode } from '../lib/dashboard/gemeenschappelijk.js';

const CORS = Object.freeze(maakCors({
  methoden: 'GET, OPTIONS', headers: 'Content-Type, X-Blitz, X-Blitz-Test', inhoudType: 'application/json',
}));
const DATUM_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAGEN = 800;
const STANDAARD_DAGEN = 30;
const MAX_TEKST = 100;
const MAX_HERHAAL = 90; // gelijk aan TERUGBLIK_DAGEN in dashboard-bronnen.js: verder terug lezen we geen rapporten, dus meer zou stil ondertellen

const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Cache-Control': 'no-store' } });

// Echte kalenderdag (2026-13-01 en 2026-02-30 vallen af); Date.parse geeft NaN voor een onmogelijke maand.
const echteDatum = t => DATUM_RE.test(t) && !Number.isNaN(Date.parse(`${t}T00:00:00Z`))
  && new Date(`${t}T00:00:00Z`).toISOString().slice(0, 10) === t;
const dagMin = (datum, n) => new Date(Date.parse(`${datum}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);
const leesTekst = (params, naam) => (params.get(naam) ?? '').slice(0, MAX_TEKST);

// Welk deel van het dashboard deze gebruiker mag zien (null = niets).
function deelVoor(gebruiker) {
  if (gebruiker?.rol === 'beheerder') return 'alles';
  if (gebruiker?.rol === 'planner') return 'techniekers';
  if (gebruiker?.rol === 'sales' && gebruiker.magAlleSales === true) return 'sales';
  return null;
}

export function maakHandler({ getStore: haalStore, auth, nu } = {}) {
  const kern = async (req, _context, gebruiker) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const deel = deelVoor(gebruiker);
    if (!deel) return json(403, { error: 'Je hebt hier geen toegang toe.', code: 'geen-recht' });
    const params = new URL(req.url).searchParams;
    const nuMs = nu ? nu() : Date.now();
    const vandaag = datumInBrussel(new Date(nuMs).toISOString());
    const tot = params.get('tot') || vandaag;
    const van = params.get('van') || (echteDatum(tot) ? dagMin(tot, STANDAARD_DAGEN - 1) : '');
    if (!echteDatum(van) || !echteDatum(tot)) return json(400, { error: 'Ongeldige datum: gebruik het formaat JJJJ-MM-DD.' });
    if (van > tot) return json(400, { error: 'De begindatum ligt na de einddatum.' });
    if (dagenTussen(van, tot) + 1 > MAX_DAGEN) return json(400, { error: `De periode mag hoogstens ${MAX_DAGEN} dagen lang zijn.` });
    const herhaalTekst = params.get('herhaal') ?? '';
    const herhaal = /^\d{1,3}$/.test(herhaalTekst) ? Number(herhaalTekst) : NaN;
    const filters = {
      van, tot, technieker: leesTekst(params, 'technieker'), type: leesTekst(params, 'type'),
      herhaalDagen: Number.isInteger(herhaal) && herhaal > 0 && herhaal <= MAX_HERHAAL ? herhaal : undefined,
    };

    const testModus = isTestVerzoek(req);
    let bronnen;
    try {
      if (testModus) await zorgVoorTestkopie(haalStore);
      const store = haalStore({ name: winkelNaam(req), consistency: 'strong' });
      bronnen = await leesBronnen({ store, echteStore: authStore(haalStore), testModus }, { van, tot, vorigeVan: vorigePeriode(van, tot).van, deel });
    } catch (e) {
      console.error('dashboard: lezen mislukt (' + (e?.name || 'Error') + ': ' + String(e?.message || '').slice(0, 120) + ')');
      return json(503, OPSLAG_STORING);
    }
    try {
      const { fouten, rapportBronnen, activiteitAfgekapt, ...invoer } = bronnen;
      const d = berekenDashboard({ ...invoer, filters, nu: new Date(nuMs).toISOString(), deel });
      if (deel === 'sales') return json(200, { ...d, dekking: { ...d.dekking, fouten } });
      return json(200, {
        ...d,
        // activiteitAfgekapt ook bij klant: de annulatievergelijking is dan onderteld (de oudste items vallen weg).
        dekking: { ...d.dekking, klant: { ...d.dekking.klant, activiteitAfgekapt }, fouten },
        bronnen: { ...rapportBronnen, activiteitAfgekapt },
      });
    } catch (e) {
      console.error('dashboard: berekenen mislukt (' + (e?.name || 'Error') + ')');
      return json(500, { error: 'Het dashboard kon niet berekend worden.' });
    }
  };
  return beveiligV2('dashboard', kern, auth ? { auth } : undefined);
}

export default maakHandler({ getStore });

export const config = { path: '/api/dashboard' };
