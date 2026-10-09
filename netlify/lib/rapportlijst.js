// Gedeelde logica voor de rapportlijst (blob 'rapportlijst' in de store 'blitz-data').
// Pure functies (geen I/O) + wijzigLijst, dat enkel store.get/setJSON gebruikt. Gebruikt door
// rapport-archief.js en de functies van de achtergrond-upload.

export const LIJST_KEY = 'rapportlijst';
export const MAX_RAPPORTEN = 500;
export const LEGE_LIJST = { versie: 0, rapports: [] };

// Bepaalt de definitieve zohoUploaded/geannuleerd-velden voor een binnenkomende POST t.o.v.
// een eventuele bestaande dedup-match (zelfde ticketId+datum).
// `bestaandeEntry` is de huidige entry op dupIdx (of null bij een nieuw rapport), `zelfdeItem`
// geeft aan of het binnenkomende `id` gelijk is aan dat van de bestaande entry (zelfde
// wachtrij-item dat zichzelf opnieuw bevestigt, i.p.v. een ander item dat via ticket+datum botst).
export function bepaalDedupVelden(bestaandeEntry, zelfdeItem, body) {
  const alGeupload = !!(zelfdeItem && bestaandeEntry?.zohoUploaded === true);
  return {
    zohoUploaded: body.zohoUploaded === true || alGeupload,
    // Een reeds bevestigde Zoho-upload kan nooit met terugwerkende kracht "geannuleerd" worden
    // door een racende/verlate cancel-POST -- zie rapport.js's pasMarkeringToe() voor de
    // omgekeerde volgorde (upload-bevestiging ná een eerder geschreven cancel).
    geannuleerd: alGeupload ? false : body.geannuleerd === true,
  };
}

// Kopie van rapportData zonder de zware velden (HTML, handtekeningen en inline foto's; oude
// entries bevatten soms nog `fotos` als base64).
export function stripZwareVelden(rapportData) {
  if (!rapportData) return rapportData ?? null;
  const { _html, handtekeningTech, handtekeningKlant, fotos, ...rest } = rapportData;
  return rest;
}

// Bouwt een lijst-entry uit een POST-body. `licht: true` laat de zware velden uit rapportData weg.
export function bouwEntry(body, { nu = new Date(), licht = false } = {}) {
  const rapportData = body.rapportData || null;
  return {
    id:              String(body.id || crypto.randomUUID()),
    datum:           String(body.datum           || ''),
    aangemaakt:      nu.toISOString(),
    technieker:      String(body.technieker       || ''),
    ticketId:        String(body.ticketId         || ''),
    ticketNumber:    String(body.ticketNumber     || ''),
    klant:           String(body.klant            || ''),
    adres:           String(body.adres            || ''),
    nieuwInter:      body.nieuwInter === 'ja' ? 'ja' : 'nee',
    hersteld:        body.hersteld   === 'ja' ? 'ja' : 'nee',
    servicetype:     String(body.servicetype      || ''),
    facturatie:      String(body.facturatie       || ''),
    prioriteit:      String(body.prioriteit       || ''),
    interventieType: String(body.interventieType  || 'Interventie'),
    totaalOnderdelen: parseFloat(body.totaalOnderdelen) || 0,
    // Bewaar het volledige R-object om rapport te kunnen hergeneren
    rapportData:     licht ? stripZwareVelden(rapportData) : rapportData,
    // (T20) Gezet door outboxCancelItem() (public/js/outbox.js) wanneer een technieker een
    // reeds-gearchiveerd, nog-niet-naar-Zoho-verstuurd rapport annuleert. De definitieve waarde
    // (samen met zohoUploaded) wordt gezet in voegToeOfWerkBij, zie bepaalDedupVelden.
    geannuleerd:     false,
  };
}

// Voegt `entry` toe aan de lijst of werkt de bestaande entry voor hetzelfde ticket op dezelfde
// datum bij (1 ticket = 1 interventie). `vervangenId` is het id van de vervangen entry als dat
// verschilt van het nieuwe id, anders null.
export function voegToeOfWerkBij(rapports, entry, body, { eigenFilter = () => true } = {}) {
  // eigenFilter: een technieker dedupt enkel op zijn EIGEN entries (logins); standaard geen beperking.
  const dupIdx = entry.ticketId
    ? rapports.findIndex(r => r.ticketId === entry.ticketId && r.datum === entry.datum && eigenFilter(r))
    : -1;

  // zohoUploaded/geannuleerd: enkel overerven van de bestaande entry als dit hetzelfde
  // wachtrij-item is dat zichzelf opnieuw bevestigt (zelfde id) — bv. na een mislukte
  // confirm-call. Botst een ANDER item via dedup, dan begint dat item altijd fris, zodat het
  // zelf een verse PDF naar Zoho stuurt i.p.v. stil te veronderstellen dat het al gebeurd is.
  const zelfdeItem = dupIdx >= 0 && entry.id === rapports[dupIdx].id;
  const nieuw = { ...entry, ...bepaalDedupVelden(dupIdx >= 0 ? rapports[dupIdx] : null, zelfdeItem, body) };

  let lijst;
  let vervangenId = null;
  if (dupIdx >= 0) {
    lijst = [...rapports];
    // Bewust het id van de HUIDIGE POST behouden (entry wordt als laatste gespreid) en NIET dat
    // van de oude entry: het antwoord rapporteert entry.id, en de client zoekt dit rapport later
    // terug via GET ?id=<dat id>. Zou het opgeslagen id afwijken, dan vindt die lookup niets en
    // valt de dubbele-Zoho-upload-bescherming stil weg voor dat wachtrij-item.
    if (rapports[dupIdx].id !== nieuw.id) vervangenId = rapports[dupIdx].id;
    lijst[dupIdx] = { ...rapports[dupIdx], ...nieuw };
  } else {
    lijst = [nieuw, ...rapports];
  }
  return { rapports: lijst.slice(0, MAX_RAPPORTEN), vervangenId };
}

// Verwerkingsstatus van een entry; oude entries zonder `verwerking` worden afgeleid.
export function effectieveStatus(entry) {
  return entry?.verwerking?.status
    ?? (entry?.zohoUploaded ? 'in-zoho' : (entry?.geannuleerd ? 'geannuleerd' : 'onbekend'));
}

// Read-modify-write op de lijst met read-back-controle (@netlify/blobs heeft geen conditionele
// writes). `mutatie({ versie, rapports })` geeft null (niets te doen) of
// { rapports, controle(rapports): boolean, resultaat? }. Bij een mislukte controle (een
// gelijktijdige schrijver overschreef ons) opnieuw vanaf het lezen, tot `pogingen`.
// Fouten bij lezen/schrijven worden doorgegooid.
export async function wijzigLijst(store, mutatie, { pogingen = 3 } = {}) {
  for (let poging = 0; poging < pogingen; poging++) {
    const huidig = (await store.get(LIJST_KEY, { type: 'json' })) ?? LEGE_LIJST;
    const wijziging = mutatie({ versie: huidig.versie, rapports: huidig.rapports });
    if (!wijziging) return { ok: true, versie: huidig.versie, ongewijzigd: true };

    const nieuw = { versie: huidig.versie + 1, rapports: wijziging.rapports };
    await store.setJSON(LIJST_KEY, nieuw);

    const terug = await store.get(LIJST_KEY, { type: 'json' });
    if (wijziging.controle(terug?.rapports ?? [])) {
      const uitkomst = { ok: true, versie: nieuw.versie };
      if (wijziging.resultaat !== undefined) uitkomst.resultaat = wijziging.resultaat;
      return uitkomst;
    }
  }
  return { ok: false };
}

// "Opnieuw versturen": enkel een mislukt rapport gaat terug naar 'wacht' (pogingen opnieuw vanaf 0).
// Andere statussen blijven onaangeroerd (zetten:false), zodat een dubbele klik of een verlate
// aanvraag een lopende of voltooide verwerking nooit omgooit.
export function zetOpnieuw(rapports, id, nu = new Date()) {
  const idx = rapports.findIndex(r => r.id === id);
  if (idx < 0) return { rapports, gevonden: false, zetten: false };
  if (effectieveStatus(rapports[idx]) !== 'mislukt') return { rapports, gevonden: true, zetten: false };
  const lijst = [...rapports];
  lijst[idx] = {
    ...rapports[idx],
    verwerking: { status: 'wacht', pogingen: 0, volgendePoging: null, laatsteFout: null, bijgewerkt: nu.toISOString() },
  };
  return { rapports: lijst, gevonden: true, zetten: true };
}
