// /api/prijzen
// GET  → volledige prijslijst (publiek, seed-on-first-read)
// PUT  → prijslijst opslaan (vereist Authorization: Bearer <ADMIN_TOKEN>)

import { getStore } from '@netlify/blobs';

const BLOB_KEY = 'prijslijst';
const ALLOWED_ORIGINS = [
  'https://blitz-planning.netlify.app',
  'http://localhost:8888',
];

// ── Hardcoded defaults (seed + offline fallback) ──────────────────────────────
const DEFAULTS = {
  versie: 1,
  bijgewerkt: new Date().toISOString(),
  onderdelen: [
    // Controllers
    { id:'charx-3000',       naam:'Controller - CHARX 3000',       categorie:'controller',   tags:['controller','Phoenix Contact','3000'],              prijs:442.13, eenheid:'stuk' },
    { id:'charx-3100',       naam:'Controller - CHARX 3100',       categorie:'controller',   tags:['controller','Phoenix Contact','3100'],              prijs:693,    eenheid:'stuk' },
    { id:'charx-3050',       naam:'Controller - CHARX 3050',       categorie:'controller',   tags:['controller','Phoenix Contact','3050'],              prijs:525,    eenheid:'stuk' },
    { id:'charx-3050-slave', naam:'Controller - CHARX 3050 Slave', categorie:'controller',   tags:['controller','Phoenix Contact','3050','slave'],      prijs:498.58, eenheid:'stuk' },
    { id:'charx-3150',       naam:'Controller - CHARX 3150',       categorie:'controller',   tags:['controller','Phoenix Contact','3150'],              prijs:627.35, eenheid:'stuk' },
    { id:'charx-1000',       naam:'Controller - CHARX 1000',       categorie:'controller',   tags:['controller','Phoenix Contact','1000'],              prijs:255,    eenheid:'stuk' },
    // Energiemeters
    { id:'meter-sdm54-m',        naam:'Energiemeter - Eastron SDM54-M (Modbus)',  categorie:'energiemeter', tags:['energiemeter','Eastron','SDM54','modbus','RS485'],     prijs:160, eenheid:'stuk' },
    { id:'meter-sdm72d-m',       naam:'Energiemeter - Eastron SDM72D-M (Modbus)', categorie:'energiemeter', tags:['energiemeter','Eastron','SDM72','modbus','RS485'],     prijs:160, eenheid:'stuk' },
    { id:'meter-tcpip-direct',   naam:'Energiemeter - TCP/IP Direct',             categorie:'energiemeter', tags:['energiemeter','TCP','IP','direct'],                   prijs:400, eenheid:'stuk' },
    { id:'meter-tcpip-indirect', naam:'Energiemeter - TCP/IP Indirect',           categorie:'energiemeter', tags:['energiemeter','TCP','IP','indirect'],                 prijs:400, eenheid:'stuk' },
    // CT-klemmen
    { id:'ct-1000a', naam:'CT-klem 1000A/1A', categorie:'ct-klem', tags:['ct-klem','meetklem','1000A'], prijs:32, eenheid:'stuk' },
    { id:'ct-600a',  naam:'CT-klem 600A/1A',  categorie:'ct-klem', tags:['ct-klem','meetklem','600A'],  prijs:27, eenheid:'stuk' },
    { id:'ct-300a',  naam:'CT-klem 300A/1A',  categorie:'ct-klem', tags:['ct-klem','meetklem','300A'],  prijs:24, eenheid:'stuk' },
    { id:'ct-80a',   naam:'CT-klem 80A/1A',   categorie:'ct-klem', tags:['ct-klem','meetklem','80A'],   prijs:10, eenheid:'stuk' },
    // Overige componenten
    { id:'contactor-4p-40a', naam:'Contactor 4P 40A', categorie:'overig', tags:['contactor','4P','40A'],                        prijs:40.50, eenheid:'stuk' },
    { id:'charx-rfid',       naam:'CHARX RFID',       categorie:'overig', tags:['rfid','kaartlezer','authenticatie'],           prijs:84,    eenheid:'stuk' },
    { id:'led',              naam:'LED',               categorie:'overig', tags:['led','indicatie'],                            prijs:8,     eenheid:'stuk' },
    { id:'rcm',              naam:'RCM',               categorie:'overig', tags:['rcm','lekstroom','aardlek','veiligheid','residuele stroom'], prijs:29.50, eenheid:'stuk' },
    // Laadkabels
    { id:'kabel-7m-zwart',        naam:'Laadkabel 7m Zwart',        categorie:'kabel', tags:['kabel','laadkabel','7m','zwart'],          prijs:170, eenheid:'stuk' },
    { id:'kabel-5m-zwart',        naam:'Laadkabel 5m Zwart',        categorie:'kabel', tags:['kabel','laadkabel','5m','zwart'],          prijs:120, eenheid:'stuk' },
    { id:'kabel-5m-grijs',        naam:'Laadkabel 5m Grijs',        categorie:'kabel', tags:['kabel','laadkabel','5m','grijs'],          prijs:160, eenheid:'stuk' },
    { id:'kabel-5m-rood',         naam:'Laadkabel 5m Rood',         categorie:'kabel', tags:['kabel','laadkabel','5m','rood'],           prijs:160, eenheid:'stuk' },
    { id:'kabel-spiraal-5m-11kw', naam:'Laadkabel Spiraal 5m 11kW', categorie:'kabel', tags:['kabel','laadkabel','spiraal','5m','11kW'], prijs:184, eenheid:'stuk' },
    { id:'kabel-spiraal-5m-22kw', naam:'Laadkabel Spiraal 5m 22kW', categorie:'kabel', tags:['kabel','laadkabel','spiraal','5m','22kW'], prijs:231, eenheid:'stuk' },
    { id:'socket',                naam:'Socket',                     categorie:'kabel', tags:['socket','aansluiting'],                   prijs:88,  eenheid:'stuk' },
    // ── Meerkosten Installatie 2026 (bron: "Particuliere Installaties - Extra Kosten buiten Standaard 2026.xlsx") ──
    // Kabels & benodigdheden
    // Prijsmodel 'overschot': eerste `drempel` meter zit al in de standaardofferte,
    // enkel het aantal daarboven wordt aangerekend (aantal - drempel) * prijs, min 0.
    // Prijsmodel 'drempel': volledige aantal aan 1 tarief — welk tarief hangt af van
    // of aantal > drempel (dan `prijs`) of niet (dan `prijsOnder`).
    // VOORLOPIGE AANNAME (2026-08-12, nog te bevestigen door Brent's supervisor) — zie
    // docs/superpowers/specs/2026-08-11-installatie-extra-kosten-rapport-design.md.
    { id:'inst-elek-datakabel-boven10m',      naam:'Elektriciteitskabel + datakabel boven 10 meter', categorie:'inst-kabels', tags:['kabel','elektriciteit','data','boven 10m'],      prijs:17.72, eenheid:'meter', prijsmodel:'overschot', drempel:10 },
    { id:'inst-elekkabel-boven10m',           naam:'Elektriciteitskabel boven 10 meter',             categorie:'inst-kabels', tags:['kabel','elektriciteit','boven 10m'],              prijs:14.49, eenheid:'meter', prijsmodel:'overschot', drempel:10 },
    { id:'inst-datakabel-boven10m',           naam:'Datakabel',                                      categorie:'inst-kabels', tags:['kabel','data','cat6','boven 10m'],                prijs:4.57,  eenheid:'meter', prijsmodel:'drempel', drempel:10, prijsOnder:6.5 },
    { id:'inst-xgb5g10-datakabel-boven10m',   naam:'Elektriciteitskabel XGB5G10 + datakabel boven 10 meter', categorie:'inst-kabels', tags:['kabel','xgb5g10','data','boven 10m'],     prijs:22.65, eenheid:'meter', prijsmodel:'overschot', drempel:10 },
    { id:'inst-kabel-xgb5g10',                naam:'Kabel XGB5G10',                                  categorie:'inst-kabels', tags:['kabel','xgb5g10'],                               prijs:20.77, eenheid:'meter' },
    { id:'inst-aardingkabel',                 naam:'Aardingkabel 6mm² - 25mm²',                      categorie:'inst-kabels', tags:['kabel','aarding'],                               prijs:9.27,  eenheid:'meter' },
    // Automaten & differentieels
    { id:'inst-automaat-4p-20a',              naam:'Automaat 4P 20A',                                categorie:'inst-automaten', tags:['automaat','4p','20a'],                        prijs:39.21, eenheid:'stuk' },
    { id:'inst-automaat-4p-40a',              naam:'Automaat 4P 40A',                                categorie:'inst-automaten', tags:['automaat','4p','40a'],                        prijs:51.74, eenheid:'stuk' },
    { id:'inst-diff-30ma-40a',                naam:'Differentieel Automaat 30mA 40A',                categorie:'inst-automaten', tags:['differentieel','30ma','40a'],                 prijs:115,   eenheid:'stuk' },
    { id:'inst-automaat-4p-32a',              naam:'Automaat 4P 32A',                                categorie:'inst-automaten', tags:['automaat','4p','32a'],                        prijs:55.70, eenheid:'stuk' },
    { id:'inst-diff-typea-40a-3ka-4p-30ma',   naam:'Differentieel Type A 40A 3KA 4P 30mA',           categorie:'inst-automaten', tags:['differentieel','type a','40a','4p','30ma'],   prijs:67.05, eenheid:'stuk' },
    { id:'inst-diff-typea-63a-3ka-4p-300ma',  naam:'Differentieel Type A 63A 3KA 4P 300mA',          categorie:'inst-automaten', tags:['differentieel','type a','63a','4p','300ma'],  prijs:107.50,eenheid:'stuk' },
    { id:'inst-diff-typeb-63a-10ka-4p',       naam:'Differentieel Type B 63A 10kA 4P 30mA/300mA',    categorie:'inst-automaten', tags:['differentieel','type b','63a','4p'],          prijs:263,   eenheid:'stuk' },
    // Kasten & benodigdheden
    { id:'inst-kast-6mod',                    naam:'Zekeringskastje 6 modules',                      categorie:'inst-kasten', tags:['kast','zekeringskastje','6 modules'],            prijs:46.73, eenheid:'stuk' },
    { id:'inst-kast-9mod',                    naam:'Zekeringskastje 9 modules',                      categorie:'inst-kasten', tags:['kast','zekeringskastje','9 modules'],            prijs:53.12, eenheid:'stuk' },
    { id:'inst-kast-12mod',                   naam:'Zekeringskastje 12 modules',                     categorie:'inst-kasten', tags:['kast','zekeringskastje','12 modules'],           prijs:78.74, eenheid:'stuk' },
    { id:'inst-kast-18mod',                   naam:'Zekeringskastje 18 modules',                     categorie:'inst-kasten', tags:['kast','zekeringskastje','18 modules'],           prijs:120.48,eenheid:'stuk' },
    // Extra's
    { id:'inst-doorboring-32mm',              naam:'Standaard doorboring tot 32mm per muur',         categorie:'inst-extras', tags:['doorboring','muur'],                             prijs:16.37, eenheid:'stuk' },
    { id:'inst-diamantboring',                naam:'Diamant boring',                                 categorie:'inst-extras', tags:['boring','diamant'],                              prijs:133.38,eenheid:'stuk' },
    { id:'inst-klein-materiaal-1',            naam:'Klein materiaal (optie 1)',                      categorie:'inst-extras', tags:['klein materiaal'],                               prijs:20.52, eenheid:'stuk' },
    { id:'inst-klein-materiaal-2',            naam:'Klein materiaal (optie 2)',                      categorie:'inst-extras', tags:['klein materiaal'],                               prijs:30.78, eenheid:'stuk' },
    { id:'inst-klein-materiaal-3',            naam:'Klein materiaal (optie 3)',                      categorie:'inst-extras', tags:['klein materiaal'],                               prijs:41.04, eenheid:'stuk' },
    { id:'inst-kabelgoot-pvc-2m',             naam:'Kabelgoot PVC uv-bestendig per 2m',              categorie:'inst-extras', tags:['kabelgoot','pvc'],                               prijs:23.04, eenheid:'stuk' },
    { id:'inst-accessoires-hoeken',           naam:'Accessoires hoeken, eindstukken',                categorie:'inst-extras', tags:['kabelgoot','accessoires'],                       prijs:5.76,  eenheid:'stuk' },
    { id:'inst-wachtbuis-rood',               naam:'Rode wachtbuis extra',                           categorie:'inst-extras', tags:['wachtbuis'],                                     prijs:2.20,  eenheid:'stuk' },
    { id:'inst-connectiviteitsoplossing',     naam:'Connectiviteitsoplossing (stopcontact, automaat, uplift zekeringskast)', categorie:'inst-extras', tags:['connectiviteit'],       prijs:49.17, eenheid:'stuk' },
    { id:'inst-switch-5poorten',              naam:'Switch 5 poorten',                               categorie:'inst-extras', tags:['switch','netwerk','5 poorten'],                  prijs:102.60,eenheid:'stuk' },
    // Infra, graafwerken en buiten de standaard
    { id:'inst-paal-grondinstallatie',        naam:'Paal model installatie in de grond (aangeleverd anker, betonnen sokkel, snelbeton)', categorie:'inst-infra', tags:['paal','graafwerk','infra'], prijs:150.56, eenheid:'stuk' },
  ],
  tarieven: [
    { id:'interventie-3u', naam:'Interventie (3u, incl. aanrijtijden)',              prijs:175, eenheid:'forfait' },
    { id:'extra-uur',      naam:'Extra uur',                                         prijs:75,  eenheid:'uur'     },
    { id:'1st-line-uur',   naam:'1st line interventie per uur (excl. aanrijtijden)', prijs:115, eenheid:'uur'     },
  ],
};

function corsHeaders(req) {
  const origin  = (req.headers.get('origin') || '');
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  };
}

function validate(body) {
  if (!Array.isArray(body.onderdelen)) return 'onderdelen must be an array';
  if (!Array.isArray(body.tarieven))   return 'tarieven must be an array';
  for (const o of body.onderdelen) {
    if (!o.id || !o.naam)                          return `onderdeel mist id of naam: ${JSON.stringify(o)}`;
    if (typeof o.prijs !== 'number' || o.prijs < 0) return `ongeldige prijs voor ${o.id}`;
  }
  for (const t of body.tarieven) {
    if (!t.id || !t.naam)                          return `tarief mist id of naam: ${JSON.stringify(t)}`;
    if (typeof t.prijs !== 'number' || t.prijs < 0) return `ongeldige prijs voor ${t.id}`;
  }
  return null;
}

export default async (req) => {
  const hdrs = corsHeaders(req);

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: hdrs });

  const store = getStore({ name: 'blitz-data', consistency: 'strong' });

  // ── GET ──────────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      let data = await store.get(BLOB_KEY, { type: 'json' });
      if (!data) {
        data = { ...DEFAULTS, bijgewerkt: new Date().toISOString() };
        await store.setJSON(BLOB_KEY, data);
      }
      return new Response(JSON.stringify(data), {
        status: 200, headers: { ...hdrs, 'Content-Type': 'application/json' },
      });
    } catch {
      return new Response(JSON.stringify({ ...DEFAULTS, bijgewerkt: new Date().toISOString() }), {
        status: 200, headers: { ...hdrs, 'Content-Type': 'application/json', 'X-Prijzen-Source': 'defaults' },
      });
    }
  }

  // ── PUT ──────────────────────────────────────────────────────────────────────
  if (req.method === 'PUT') {
    let body;
    try { body = await req.json(); }
    catch {
      return new Response(JSON.stringify({ error: 'Ongeldige JSON' }), {
        status: 400, headers: { ...hdrs, 'Content-Type': 'application/json' },
      });
    }

    const validErr = validate(body);
    if (validErr) {
      return new Response(JSON.stringify({ error: validErr }), {
        status: 400, headers: { ...hdrs, 'Content-Type': 'application/json' },
      });
    }

    if (typeof body.versie !== 'number') {
      return new Response(JSON.stringify({ error: 'versie is verplicht en moet een getal zijn' }), {
        status: 400, headers: { ...hdrs, 'Content-Type': 'application/json' },
      });
    }

    let current;
    try {
      current = await store.get(BLOB_KEY, { type: 'json' });
    } catch {
      return new Response(JSON.stringify({ error: 'Prijslijst-opslag tijdelijk niet bereikbaar, probeer opnieuw.' }), {
        status: 503, headers: { ...hdrs, 'Content-Type': 'application/json' },
      });
    }

    if (current && body.versie !== current.versie) {
      return new Response(JSON.stringify({
        error: 'Prijslijst werd ondertussen aangepast door iemand anders. Herlaad en probeer opnieuw.',
        serverVersie: current.versie,
      }), { status: 409, headers: { ...hdrs, 'Content-Type': 'application/json' } });
    }
    // Backup van vorige versie (max 5 bewaard)
    if (current) {
      try { await store.setJSON(`${BLOB_KEY}-backup-${current.versie}`, current); } catch { /* backup is best-effort */ }
    }

    const nieuweVersie = (current?.versie ?? 0) + 1;
    const opslaan = {
      versie:     nieuweVersie,
      bijgewerkt: new Date().toISOString(),
      onderdelen: body.onderdelen,
      tarieven:   body.tarieven,
    };

    try {
      await store.setJSON(BLOB_KEY, opslaan);
      return new Response(JSON.stringify(opslaan), {
        status: 200, headers: { ...hdrs, 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Opslaan mislukt: ' + err.message }), {
        status: 500, headers: { ...hdrs, 'Content-Type': 'application/json' },
      });
    }
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405, headers: { ...hdrs, 'Content-Type': 'application/json' },
  });
};

export const config = { path: '/api/prijzen' };
