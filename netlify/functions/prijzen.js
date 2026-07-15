// /api/prijzen
// GET  → volledige prijslijst (publiek, seed-on-first-read)
// PUT  → prijslijst opslaan (vereist Authorization: Bearer <ADMIN_TOKEN>)

import { getStore } from '@netlify/blobs';

const BLOB_KEY = 'prijslijst';

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
    { id:'led',              naam:'LED',              categorie:'overig', tags:['led','indicatie'],                             prijs:8,     eenheid:'stuk' },
    { id:'rcm',              naam:'RCM',              categorie:'overig', tags:['rcm','lekstroom','aardlek','veiligheid','residuele stroom'], prijs:29.50, eenheid:'stuk' },
    // Laadkabels
    { id:'kabel-7m-zwart',       naam:'Laadkabel 7m Zwart',         categorie:'kabel', tags:['kabel','laadkabel','7m','zwart'],         prijs:170, eenheid:'stuk' },
    { id:'kabel-5m-zwart',       naam:'Laadkabel 5m Zwart',         categorie:'kabel', tags:['kabel','laadkabel','5m','zwart'],         prijs:120, eenheid:'stuk' },
    { id:'kabel-5m-grijs',       naam:'Laadkabel 5m Grijs',         categorie:'kabel', tags:['kabel','laadkabel','5m','grijs'],         prijs:160, eenheid:'stuk' },
    { id:'kabel-5m-rood',        naam:'Laadkabel 5m Rood',          categorie:'kabel', tags:['kabel','laadkabel','5m','rood'],          prijs:160, eenheid:'stuk' },
    { id:'kabel-spiraal-5m-11kw',naam:'Laadkabel Spiraal 5m 11kW',  categorie:'kabel', tags:['kabel','laadkabel','spiraal','5m','11kW'],prijs:184, eenheid:'stuk' },
    { id:'kabel-spiraal-5m-22kw',naam:'Laadkabel Spiraal 5m 22kW',  categorie:'kabel', tags:['kabel','laadkabel','spiraal','5m','22kW'],prijs:231, eenheid:'stuk' },
    { id:'socket',               naam:'Socket',                      categorie:'kabel', tags:['socket','aansluiting'],                  prijs:88,  eenheid:'stuk' },
  ],
  tarieven: [
    { id:'interventie-3u', naam:'Interventie (3u, incl. aanrijtijden)',             prijs:175, eenheid:'forfait' },
    { id:'extra-uur',      naam:'Extra uur',                                        prijs:75,  eenheid:'uur'     },
    { id:'1st-line-uur',   naam:'1st line interventie per uur (excl. aanrijtijden)',prijs:115, eenheid:'uur'     },
  ],
};

function headers(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    ...extra,
  };
}

function validate(body) {
  if (!Array.isArray(body.onderdelen)) return 'onderdelen must be an array';
  if (!Array.isArray(body.tarieven))   return 'tarieven must be an array';
  for (const o of body.onderdelen) {
    if (!o.id || !o.naam)                     return `onderdeel mist id of naam: ${JSON.stringify(o)}`;
    if (typeof o.prijs !== 'number' || o.prijs < 0) return `ongeldige prijs voor ${o.id}`;
  }
  for (const t of body.tarieven) {
    if (!t.id || !t.naam)                     return `tarief mist id of naam: ${JSON.stringify(t)}`;
    if (typeof t.prijs !== 'number' || t.prijs < 0) return `ongeldige prijs voor ${t.id}`;
  }
  return null;
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: headers() };
  }

  const store = getStore('prijzen');

  // ── GET ──────────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    try {
      let data = await store.get(BLOB_KEY, { type: 'json' });
      if (!data) {
        // Eerste keer: seed met defaults
        data = { ...DEFAULTS, bijgewerkt: new Date().toISOString() };
        await store.setJSON(BLOB_KEY, data);
      }
      return { statusCode: 200, headers: headers(), body: JSON.stringify(data) };
    } catch (err) {
      // Blob niet bereikbaar → stuur defaults terug met warning header
      return {
        statusCode: 200,
        headers: headers({ 'X-Prijzen-Source': 'defaults' }),
        body: JSON.stringify({ ...DEFAULTS, bijgewerkt: new Date().toISOString() }),
      };
    }
  }

  // ── PUT ──────────────────────────────────────────────────────────────────────
  if (event.httpMethod === 'PUT') {
    // Auth
    const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    const expected = process.env.ADMIN_TOKEN || '';
    if (!expected || token !== expected) {
      return { statusCode: 401, headers: headers(), body: JSON.stringify({ error: 'Ongeldig wachtwoord' }) };
    }

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return { statusCode: 400, headers: headers(), body: JSON.stringify({ error: 'Ongeldige JSON' }) };
    }

    const validErr = validate(body);
    if (validErr) {
      return { statusCode: 400, headers: headers(), body: JSON.stringify({ error: validErr }) };
    }

    // Optimistic locking: als client een versie meestuurde en de server heeft al een hogere → 409
    try {
      const current = await store.get(BLOB_KEY, { type: 'json' });
      if (current && typeof body.versie === 'number' && body.versie < current.versie) {
        return {
          statusCode: 409,
          headers: headers(),
          body: JSON.stringify({ error: 'Prijslijst werd ondertussen aangepast door iemand anders. Herlaad en probeer opnieuw.', serverVersie: current.versie }),
        };
      }

      // Backup van vorige versie (max 5 bewaard)
      if (current) {
        await store.setJSON(`${BLOB_KEY}-backup-${current.versie}`, current);
      }
    } catch { /* blob niet bereikbaar, ga toch door */ }

    const nieuweVersie = (typeof body.versie === 'number' ? body.versie : 0) + 1;
    const opslaan = {
      versie: nieuweVersie,
      bijgewerkt: new Date().toISOString(),
      onderdelen: body.onderdelen,
      tarieven: body.tarieven,
    };

    try {
      await store.setJSON(BLOB_KEY, opslaan);
      return { statusCode: 200, headers: headers(), body: JSON.stringify(opslaan) };
    } catch (err) {
      return { statusCode: 500, headers: headers(), body: JSON.stringify({ error: 'Opslaan mislukt: ' + err.message }) };
    }
  }

  return { statusCode: 405, headers: headers(), body: JSON.stringify({ error: 'Method not allowed' }) };
}
