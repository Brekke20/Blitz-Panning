// Systeemstatus voor de beheerpagina: Zoho-verbinding, recente clientfouten en mislukte rapportuploads.
// Antwoordt nooit met tokens of ruwe foutmeldingen van Zoho: de foutstring is altijd een vaste, korte tekst.
const MAX_FOUTEN = 20;
const MAX_MISLUKT = 100;
const MAX_TEKST = 500;

const tekst = w => (w == null ? '' : String(w).slice(0, MAX_TEKST));

async function leesJson(store, sleutel) {
  try { return await store.get(sleutel, { type: 'json' }); } catch { return null; }
}

async function zohoStatus(zoho, test, tijdstip) {
  if (test) return { ok: true, test: true, tijdstip };
  try {
    await zoho.haalToken();
    return { ok: true, tijdstip };
  } catch (e) {
    const geweigerd = typeof e?.message === 'string' && e.message.startsWith('Token refresh mislukt');
    return {
      ok: false,
      fout: geweigerd ? 'Zoho weigerde het vernieuwen van de toegangstoken.' : 'Zoho is niet bereikbaar.',
      tijdstip,
    };
  }
}

function recenteFouten(blob) {
  const lijst = Array.isArray(blob?.fouten) ? blob.fouten : [];
  return lijst
    .filter(f => f && typeof f === 'object')
    .map(f => ({ tijdstip: tekst(f.tijdstip), ticketId: tekst(f.ticketId), stap: tekst(f.stap), fout: tekst(f.fout) }))
    .sort((a, b) => (Date.parse(b.tijdstip) || 0) - (Date.parse(a.tijdstip) || 0))
    .slice(0, MAX_FOUTEN);
}

// Leest tolerant: het veld `verwerking` bestaat pas sinds de upload-fix; zonder het veld is er niets mislukt.
function mislukteRapporten(blob) {
  const lijst = Array.isArray(blob?.rapports) ? blob.rapports : [];
  return lijst
    .filter(r => r && typeof r === 'object' && r.verwerking?.status === 'mislukt')
    .slice(0, MAX_MISLUKT)
    .map(r => ({
      id: tekst(r.id), ticketNumber: tekst(r.ticketNumber), technieker: tekst(r.technieker), datum: tekst(r.datum),
      laatsteFout: r.verwerking.laatsteFout == null ? null : tekst(r.verwerking.laatsteFout),
    }));
}

// `store` = de store van het verzoek (foutenlog en rapportlijst); `zoho` = maakZoho()-object (enkel haalToken).
// Bij `test` wordt Zoho niet aangeroepen.
export async function verzamelStatus({ store, zoho, test = false, nu = () => Date.now() } = {}) {
  const tijdstip = new Date(nu()).toISOString();
  const [zohoRes, foutenlog, rapportlijst] = await Promise.all([
    zohoStatus(zoho, test, tijdstip),
    leesJson(store, 'foutenlog'),
    leesJson(store, 'rapportlijst'),
  ]);
  return {
    zoho: zohoRes,
    foutenlog: recenteFouten(foutenlog),
    rapporten: { mislukt: mislukteRapporten(rapportlijst) },
  };
}
