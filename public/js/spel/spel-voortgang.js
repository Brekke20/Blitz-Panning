// spel/spel-voortgang.js — de voortgang van "Blitz Run" (beste score, ontgrendelde skins, gekozen skin) bij het ACCOUNT:
// GET/POST /api/spel is de bron; een lokale kopie (per gebruiker) laat het spel offline met de laatst bekende stand werken.
// Een inzending die mislukt wordt bewaard en één keer later opnieuw geprobeerd (ook bij het eerstvolgende openen), nooit blokkerend.
// Puur in de zin van "alle afhankelijkheden worden meegegeven": geen window, geen globale fetch (tests geven nepjes mee).
import { SKINS, standaardSkin } from './skins.js';
import { ontgrendeldeSkins, schoonVoortgang, voegWachtendSamen, geldigeScore, naNieuweSchaal, onbekendeThemaIds, isThemaSkinId, SCORE_SCHAAL, SCORE_DELER } from './spel-regels.js';

export const HERPOGING_MS = 20000;
export const OPSLAG_VOORVOEGSEL = 'blitz_spel_';

// `api(pad, opties)` geeft { ok, status, data } of gooit bij een netwerkfout (kern/api.js apiVerzoek).
// `opslag`: { lees(sleutel) -> string|null, schrijf(sleutel, tekst) } (mag gooien: wordt opgevangen).
// `skins()` -> de volledige skinlijst (basis plus de themaskins van de nu bekende pakketten; standaard enkel de basis); wordt bij elk gebruik
// opnieuw gevraagd, want de pakketten kunnen later binnenkomen. `actieveThemas(datum: Date)` -> [{ id }] (standaard geen): de lokale schatting
// van de actieve themas. `uitstel(fn, ms)` plant de herpoging.
export function maakVoortgang({
  api, opslag, gebruikerId = 'anoniem', skins = () => SKINS, actieveThemas = () => [], nu = () => Date.now(),
  uitstel = (fn, ms) => setTimeout(fn, ms), bijWijziging = () => {},
}) {
  const sleutel = OPSLAG_VOORVOEGSEL + String(gebruikerId);
  const lijst = () => {
    try { const l = skins(); return Array.isArray(l) && l.length ? l : SKINS; } catch { return SKINS; }
  };
  const actieveIds = () => {
    try { const l = actieveThemas(new Date(nu())); return Array.isArray(l) ? l.map(t => t?.id).filter(i => typeof i === 'string') : []; } catch { return []; }
  };
  // Zolang de server nog niet antwoordde (offline eerste keer), telt de lokale datum voor themaskins als voorlopige schatting.
  // Na het eerste antwoord komen de themaskins enkel nog van de server (`vanServer`): een verkeerde toestelklok ontgrendelt niets.
  // Een geldig thema-id dat de lijst (nog) niet kent, blijft in `ontgrendeld` staan: het pakket kan later binnenkomen.
  let vanServer = false;
  const aanvullen = (v, rauw = v.ontgrendeld) => {
    const skinLijst = lijst();
    const open = ontgrendeldeSkins({ besteScore: v.besteScore, bewaard: v.ontgrendeld, actieveThemaIds: vanServer ? [] : actieveIds(), skins: skinLijst });
    return { ...v, ontgrendeld: [...open, ...onbekendeThemaIds(rauw, skinLijst)] };
  };

  // Een gekozen themaskin waarvan het pakket nu niet in de skinlijst zit (normaal: in november de Halloween-skin, want de cache bewaart enkel
  // actieve themas en die binnen 14 dagen) blijft de keuze van de speler: `schoonVoortgang` zou ze naar de standaardskin terugzetten en die
  // terugval zou dan met de volgende inzending de keuze op de server overschrijven. Het tekenen valt zelf terug (`skinVan` in spel-ui.js).
  // Enkel een geldig thema-id dat ook in de (rauwe) ontgrendelde lijst staat telt.
  const behoudKeuze = (gekozen, rauwGekozen, rauwOntgrendeld, skinLijst) => (
    isThemaSkinId(rauwGekozen) && !skinLijst.some(k => k.id === rauwGekozen) && Array.isArray(rauwOntgrendeld) && rauwOntgrendeld.includes(rauwGekozen)
      ? rauwGekozen : gekozen);

  let voortgang = aanvullen(schoonVoortgang(null, lijst()));
  let wachtend = null; // { score, gekozenSkin? } nog niet bij de server
  let herpogingGepland = false;

  try {
    const bewaard = JSON.parse(opslag.lees(sleutel));
    if (bewaard && typeof bewaard === 'object') {
      vanServer = bewaard.vanServer === true;
      // Een lokale kopie zonder `schaal: 2` komt uit v2.1.0 (oude, 4x snellere scoretelling): omrekenen, anders blijft ze de serverscore overschaduwen.
      const nieuweSchaal = bewaard.schaal === SCORE_SCHAAL;
      const rauw = Array.isArray(bewaard.voortgang?.ontgrendeld) ? bewaard.voortgang.ontgrendeld : [];
      const skinLijst = lijst();
      voortgang = aanvullen(schoonVoortgang(nieuweSchaal ? bewaard.voortgang : naNieuweSchaal(bewaard.voortgang), skinLijst), rauw);
      voortgang = { ...voortgang, gekozenSkin: behoudKeuze(voortgang.gekozenSkin, bewaard.voortgang?.gekozenSkin, rauw, skinLijst) };
      wachtend = bewaard.wachtend && typeof bewaard.wachtend === 'object' ? voegWachtendSamen(null, bewaard.wachtend) : null;
      if (wachtend && !nieuweSchaal) wachtend = { ...wachtend, score: Math.floor((Number(wachtend.score) || 0) / SCORE_DELER) };
    }
  } catch { /* geen of onleesbare kopie: begin leeg */ }

  const bewaar = () => { try { opslag.schrijf(sleutel, JSON.stringify({ voortgang, wachtend, vanServer, schaal: SCORE_SCHAAL })); } catch { /* geen opslag */ } };
  const zet = (v) => { voortgang = aanvullen(v); bewaar(); bijWijziging(voortgang); };
  // Voegt een serverantwoord in: de ontgrendelde skins (ook de themaskins) komen van de server, de score-skins volgen de
  // hoogste score. Een gekozen skin die de server weigerde (`skinGeweigerd`) of die niet open is, valt terug op die van de server.
  const samenvoegen = (server) => {
    const skinLijst = lijst();
    const s = schoonVoortgang(server, skinLijst);
    const besteScore = Math.max(s.besteScore, voortgang.besteScore);
    const rauw = Array.isArray(server?.ontgrendeld) ? server.ontgrendeld : [];
    const ontgrendeld = [...ontgrendeldeSkins({ besteScore, bewaard: s.ontgrendeld, actieveThemaIds: [], skins: skinLijst }), ...onbekendeThemaIds(rauw, skinLijst)];
    const gewenst = server?.skinGeweigerd ? undefined : wachtend?.gekozenSkin;
    const kiesbaar = (id) => skinLijst.some(k => k.id === id) && ontgrendeld.includes(id);
    // De keuze van de server: een bewaarde themakeuze zonder pakket (`behoudKeuze`) blijft staan, anders enkel een kiesbare skin.
    const serverKeuze = behoudKeuze(s.gekozenSkin, server?.gekozenSkin, rauw, skinLijst);
    const gekozen = gewenst !== undefined && kiesbaar(gewenst) ? gewenst : (serverKeuze !== s.gekozenSkin || kiesbaar(serverKeuze) ? serverKeuze : standaardSkin());
    vanServer = true;
    return { besteScore, ontgrendeld, gekozenSkin: gekozen };
  };

  const isDefinitief = (status) => status >= 400 && status < 500 && status !== 408 && status !== 429;

  // Verstuurt `wachtend`. true = gelukt (of niet meer te redden: een 4xx-antwoord) ; false = tijdelijk mislukt (blijft wachten).
  async function verstuur() {
    if (!wachtend) return true;
    const inzending = { ...wachtend };
    try {
      let r = await api('/api/spel', { methode: 'POST', body: inzending });
      // Een score mag nooit verloren gaan door een skin-keuze: weigert de server (4xx) een inzending met skin, probeer nog eens enkel de score.
      if (!r.ok && isDefinitief(r.status) && inzending.gekozenSkin !== undefined) {
        r = await api('/api/spel', { methode: 'POST', body: { score: inzending.score } });
        if (r.ok && r.data && typeof r.data === 'object') r = { ...r, data: { ...r.data, skinGeweigerd: true } };
      }
      if (r.ok) {
        const zelfde = JSON.stringify(wachtend) === JSON.stringify(inzending);
        const stand = samenvoegen(r.data);
        if (zelfde) wachtend = null;
        zet(stand);
        return true;
      }
      if (isDefinitief(r.status)) { // de server weigert dit definitief (bv. een ongeldige score): niet blijven proberen
        if (JSON.stringify(wachtend) === JSON.stringify(inzending)) wachtend = null;
        bewaar();
        return true;
      }
    } catch { /* offline of time-out */ }
    return false;
  }

  function planHerpoging() {
    if (herpogingGepland) return;
    herpogingGepland = true;
    uitstel(async () => { herpogingGepland = false; await verstuur(); }, HERPOGING_MS);
  }

  return {
    huidig: () => voortgang,
    heeftWachtend: () => wachtend !== null,
    // Bij het openen: eerst een eventuele wachtende inzending, daarna de stand van de server. Gooit nooit.
    async ververs() {
      try {
        await verstuur();
        const r = await api('/api/spel');
        if (r.ok) zet(samenvoegen(r.data));
      } catch { /* offline: de lokale stand blijft */ }
      return voortgang;
    },
    // Na een afgelopen spel. Geeft { nieuweBeste, nieuweSkins } terug; de server-inzending loopt op de achtergrond (belofte `verzonden`).
    meld(score) {
      const s = geldigeScore(score) ?? 0;
      const vorigeSkins = voortgang.ontgrendeld;
      const nieuweBeste = s > voortgang.besteScore;
      zet({ ...voortgang, besteScore: Math.max(voortgang.besteScore, s) });
      const nieuweSkins = voortgang.ontgrendeld.filter(id => !vorigeSkins.includes(id));
      // De skin gaat enkel mee als de client hem kent (kan tekenen): een bewaarde themakeuze zonder pakket blijft op de server staan en wordt
      // nooit door een terugval overschreven. Een keuze van de speler zelf (`kiesSkin`) is altijd een bekende skin en gaat dus gewoon mee.
      const bekend = lijst().some(k => k.id === voortgang.gekozenSkin);
      wachtend = voegWachtendSamen(wachtend, bekend ? { score: s, gekozenSkin: voortgang.gekozenSkin } : { score: s });
      bewaar();
      const verzonden = verstuur().then((ok) => { if (!ok) planHerpoging(); return ok; });
      return { nieuweBeste, nieuweSkins, verzonden };
    },
    // Skin kiezen (enkel een ontgrendelde). Geeft false bij een vergrendelde of onbekende skin.
    kiesSkin(id) {
      if (!voortgang.ontgrendeld.includes(id) || !lijst().some(k => k.id === id)) return false;
      if (voortgang.gekozenSkin === id) return true;
      zet({ ...voortgang, gekozenSkin: id });
      wachtend = voegWachtendSamen(wachtend, { score: 0, gekozenSkin: id });
      bewaar();
      verstuur().then((ok) => { if (!ok) planHerpoging(); });
      return true;
    },
  };
}
