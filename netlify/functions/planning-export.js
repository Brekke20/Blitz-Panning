// /api/planning-export
// Geeft alle geplande Blitz Planning-activiteit (Zoho-tickets met ingevulde
// interventiedatum + handmatige afspraken) terug als JSON, voor externe
// koppelingen (bv. de Base44-planningsapp van een collega). Read-only,
// machine-naar-machine — geen gebruikersauthenticatie, enkel een gedeelde
// API-sleutel via de Authorization-header.
// Zie docs/superpowers/specs/2026-07-27-planning-export-integratie-design.md

const DEFAULT_DUUR_MIN = 120; // zelfde standaardwaarde als DEFAULT_SETTINGS.duurMinuten in index.html

// Zet een Date (die intern altijd UTC/epoch is) om naar Brussel-lokale
// kalenderdag/-tijd, ongeacht de tijdzone waarin het serverproces zelf
// draait (Netlify Functions draaien standaard op TZ=UTC). Intl.DateTimeFormat
// met timeZone: 'Europe/Brussels' handelt zomer-/wintertijd automatisch af.
function brusselVelden(dt) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Brussels',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(dt).map(p => [p.type, p.value]));
  return {
    datum: `${parts.year}-${parts.month}-${parts.day}`,
    uur: `${parts.hour}:${parts.minute}`,
    uurNum: parseInt(parts.hour, 10),
    minNum: parseInt(parts.minute, 10),
  };
}

// Brussel-lokale kalenderdag van "gisteren", als YYYY-MM-DD-string, voor de
// afkap-vergelijking. Rekent in UTC-kalenderdagen (met het middaguur als anker
// om DST-randgevallen te vermijden) zodat er geen server-tijdzone in sluipt.
function gisterenBrusselDatum() {
  const { datum } = brusselVelden(new Date());
  const [y, m, d] = datum.split('-').map(Number);
  const anker = new Date(Date.UTC(y, m - 1, d, 12));
  anker.setUTCDate(anker.getUTCDate() - 1);
  return anker.toISOString().slice(0, 10);
}

function baseUrl(event) {
  const host = event.headers.host || event.headers.Host;
  const proto = host && host.startsWith('localhost') ? 'http' : 'https';
  return `${proto}://${host}`;
}

function checkAuth(event) {
  const header = event.headers.authorization || event.headers.Authorization || '';
  const expected = process.env.PLANNING_EXPORT_API_KEY;
  if (!expected) return false; // fail-closed: geen sleutel geconfigureerd = geen toegang
  return header === `Bearer ${expected}`;
}

export async function handler(event) {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  if (!checkAuth(event)) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    const url = baseUrl(event);

    const ticketsRes = await fetch(`${url}/api/tickets`);
    if (!ticketsRes.ok) {
      const errBody = await ticketsRes.json().catch(() => ({}));
      throw new Error(`Tickets ophalen mislukt (${ticketsRes.status}): ${JSON.stringify(errBody)}`);
    }
    const ticketsData = await ticketsRes.json();
    const alleTickets = [
      ...(ticketsData.tickets || []),
      ...(ticketsData.pendingTickets || []),
      ...(ticketsData.plannedTickets || []),
    ];

    const gisterenDatum = gisterenBrusselDatum();

    const geplandeTickets = alleTickets.filter(t => t.interventieDatum);

    const items = geplandeTickets
      .map(t => {
        const dt = new Date(t.interventieDatum);
        if (isNaN(dt.getTime())) return null;
        const { datum, uur, uurNum, minNum } = brusselVelden(dt);
        if (datum < gisterenDatum) return null;
        const eindMin = uurNum * 60 + minNum + DEFAULT_DUUR_MIN;
        const eindtijd = `${String(Math.floor(eindMin / 60) % 24).padStart(2, '0')}:${String(eindMin % 60).padStart(2, '0')}`;
        return {
          id: t.id,
          bron: 'zoho',
          ticketnummer: t.number || null,
          type: 'Interventie',
          datum,
          starttijd: uur,
          eindtijd,
          technieker: t.assignee || null,
          klant: t.account || t.naamEindklant || null,
          adres: t.address || null,
          omschrijving: t.subject || null,
          status: t.status || null,
        };
      })
      .filter(Boolean);

    items.sort((a, b) => (a.datum + a.starttijd).localeCompare(b.datum + b.starttijd));

    return { statusCode: 200, headers, body: JSON.stringify(items) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
}
