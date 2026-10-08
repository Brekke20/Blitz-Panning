// Kleurgrenzen en statusregels van de ringen in het performance-dashboard. Pure functies, geen I/O.
// groen = drempel voor groen, oranje = drempel voor oranje; null = neutraal (geen kleur);
// richting 'hoog' = hoog is goed, 'laag' = laag is goed.
export const RING_METRICS = ['opTijd', 'firstTimeFix', 'bevestigdViaKnop', 'garantie', 'metInstallateur'];

export const STANDAARD_GRENZEN = {
  opTijd:           { groen: 90,   oranje: 75,   richting: 'hoog' },
  firstTimeFix:     { groen: 80,   oranje: 65,   richting: 'hoog' },
  bevestigdViaKnop: { groen: null, oranje: null, richting: 'hoog' },
  garantie:         { groen: null, oranje: null, richting: 'laag' },
  // Sleutel van de ring "Installateur al langs geweest" (sleutel behouden, enkel het label verschilt).
  metInstallateur:  { groen: null, oranje: null, richting: 'hoog' },
};

const RICHTINGEN = ['hoog', 'laag'];
const isGeldigGetal = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100;

// Vult ontbrekende sleutels aan met de standaard en controleert de rest.
// -> { ok: true, waarde: grenzen } | { ok: false, fout: string }
export function valideerGrenzen(invoer) {
  if (!invoer || typeof invoer !== 'object' || Array.isArray(invoer)) {
    return { ok: false, fout: 'Grenzen moeten een object zijn.' };
  }
  const waarde = {};
  for (const sleutel of RING_METRICS) {
    const standaard = STANDAARD_GRENZEN[sleutel];
    const rij = invoer[sleutel];
    if (rij === undefined) { waarde[sleutel] = { ...standaard }; continue; }
    if (!rij || typeof rij !== 'object' || Array.isArray(rij)) {
      return { ok: false, fout: `Grenzen van ${sleutel} moeten een object zijn.` };
    }
    const richting = rij.richting === undefined ? standaard.richting : rij.richting;
    if (!RICHTINGEN.includes(richting)) return { ok: false, fout: `Ongeldige richting bij ${sleutel}.` };
    const groen = rij.groen ?? null;
    const oranje = rij.oranje ?? null;
    if ((groen === null) !== (oranje === null)) {
      return { ok: false, fout: `Bij ${sleutel} moeten groen en oranje samen leeg zijn of samen een getal hebben.` };
    }
    if (groen !== null) {
      if (!isGeldigGetal(groen) || !isGeldigGetal(oranje)) {
        return { ok: false, fout: `Grenzen bij ${sleutel} moeten getallen van 0 tot 100 zijn.` };
      }
      if (richting === 'hoog' && groen < oranje) {
        return { ok: false, fout: `Bij ${sleutel} (hoog is goed) mag groen niet lager zijn dan oranje.` };
      }
      if (richting === 'laag' && groen > oranje) {
        return { ok: false, fout: `Bij ${sleutel} (laag is goed) mag groen niet hoger zijn dan oranje.` };
      }
    }
    waarde[sleutel] = { groen, oranje, richting };
  }
  return { ok: true, waarde };
}

// 'goed' | 'aandacht' | 'slecht' | 'neutraal' (geen grenzen) | null (geen gegevens).
// Beslist op het afgeronde getal dat de ring toont (89,6 toont 90 en is groen).
export function statusVoor(sleutel, pct, grenzen = STANDAARD_GRENZEN) {
  if (pct === null || pct === undefined || typeof pct !== 'number' || !Number.isFinite(pct)) return null;
  const g = grenzen?.[sleutel];
  if (!g || g.groen === null || g.groen === undefined || g.oranje === null || g.oranje === undefined) return 'neutraal';
  const r = Math.round(pct);
  if (g.richting === 'laag') return r <= g.groen ? 'goed' : r <= g.oranje ? 'aandacht' : 'slecht';
  return r >= g.groen ? 'goed' : r >= g.oranje ? 'aandacht' : 'slecht';
}
