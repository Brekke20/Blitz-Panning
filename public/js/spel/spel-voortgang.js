// spel/spel-voortgang.js — de voortgang van "Blitz Run" (beste score, ontgrendelde skins, gekozen skin) bij het ACCOUNT:
// GET/POST /api/spel is de bron; een lokale kopie (per gebruiker) laat het spel offline met de laatst bekende stand werken.
// Een inzending die mislukt wordt bewaard en één keer later opnieuw geprobeerd (ook bij het eerstvolgende openen), nooit blokkerend.
// Puur in de zin van "alle afhankelijkheden worden meegegeven": geen window, geen globale fetch (tests geven nepjes mee).
import { ontgrendeldeSkins, schoonVoortgang, voegWachtendSamen, geldigeScore, datumBrussel } from './spel-regels.js';

export const HERPOGING_MS = 20000;
export const OPSLAG_VOORVOEGSEL = 'blitz_spel_';

// `api(pad, opties)` geeft { ok, status, data } of gooit bij een netwerkfout (kern/api.js apiVerzoek).
// `opslag`: { lees(sleutel) -> string|null, schrijf(sleutel, tekst) } (mag gooien: wordt opgevangen).
// `actieveEvenementen(datum)` -> [{ id, spelSkin? }] (standaard geen). `uitstel(fn, ms)` plant de herpoging.
export function maakVoortgang({
  api, opslag, gebruikerId = 'anoniem', actieveEvenementen = () => [], nu = () => Date.now(),
  uitstel = (fn, ms) => setTimeout(fn, ms), bijWijziging = () => {},
}) {
  const sleutel = OPSLAG_VOORVOEGSEL + String(gebruikerId);
  const evenementen = () => {
    try { const lijst = actieveEvenementen(datumBrussel(nu())); return Array.isArray(lijst) ? lijst : []; } catch { return []; }
  };
  const aanvullen = (v) => ({ ...v, ontgrendeld: ontgrendeldeSkins({ besteScore: v.besteScore, bewaard: v.ontgrendeld, evenementen: evenementen() }) });

  let voortgang = aanvullen(schoonVoortgang(null));
  let wachtend = null; // { score, gekozenSkin? } nog niet bij de server
  let herpogingGepland = false;

  try {
    const bewaard = JSON.parse(opslag.lees(sleutel));
    if (bewaard && typeof bewaard === 'object') {
      voortgang = aanvullen(schoonVoortgang(bewaard.voortgang));
      wachtend = bewaard.wachtend && typeof bewaard.wachtend === 'object' ? voegWachtendSamen(null, bewaard.wachtend) : null;
    }
  } catch { /* geen of onleesbare kopie: begin leeg */ }

  const bewaar = () => { try { opslag.schrijf(sleutel, JSON.stringify({ voortgang, wachtend })); } catch { /* geen opslag */ } };
  const zet = (v) => { voortgang = aanvullen(v); bewaar(); bijWijziging(voortgang); };
  const samenvoegen = (server) => {
    const s = schoonVoortgang(server);
    const gekozen = wachtend?.gekozenSkin ?? s.gekozenSkin;
    return { besteScore: Math.max(s.besteScore, voortgang.besteScore), ontgrendeld: [...new Set([...s.ontgrendeld, ...voortgang.ontgrendeld])], gekozenSkin: gekozen };
  };

  // Verstuurt `wachtend`. true = gelukt (of niet meer te redden: een 4xx-antwoord) ; false = tijdelijk mislukt (blijft wachten).
  async function verstuur() {
    if (!wachtend) return true;
    const inzending = { ...wachtend };
    try {
      const r = await api('/api/spel', { methode: 'POST', body: inzending });
      if (r.ok) {
        if (JSON.stringify(wachtend) === JSON.stringify(inzending)) wachtend = null;
        zet(samenvoegen(r.data));
        return true;
      }
      if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) { // de server weigert dit definitief: niet blijven proberen
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
      wachtend = voegWachtendSamen(wachtend, { score: s, gekozenSkin: voortgang.gekozenSkin });
      bewaar();
      const verzonden = verstuur().then((ok) => { if (!ok) planHerpoging(); return ok; });
      return { nieuweBeste, nieuweSkins, verzonden };
    },
    // Skin kiezen (enkel een ontgrendelde). Geeft false bij een vergrendelde of onbekende skin.
    kiesSkin(id) {
      if (!voortgang.ontgrendeld.includes(id)) return false;
      if (voortgang.gekozenSkin === id) return true;
      zet({ ...voortgang, gekozenSkin: id });
      wachtend = voegWachtendSamen(wachtend, { score: 0, gekozenSkin: id });
      bewaar();
      verstuur().then((ok) => { if (!ok) planHerpoging(); });
      return true;
    },
  };
}
