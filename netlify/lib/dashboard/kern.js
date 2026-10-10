// Kernwaarden (de zes tegels) van het performance-dashboard voor één periode. Pure functie op
// genormaliseerde Rapport[] (geen I/O); hergebruikt de blokken tijd, kwaliteit en onderdelen zodat
// een tegel en zijn detailblok nooit uiteen kunnen lopen.
import { gemiddeldeDuur, opTijd } from './tijd.js';
import { firstTimeFix, herhaalbezoeken } from './kwaliteit.js';
import { waardeTotaal } from './onderdelen.js';

// `rapporten` = de geselecteerde rapporten (periode + filters), `alle` = de volledige, ongefilterde lijst
// (een eerder bezoek mag buiten de periode en buiten het filter liggen).
// -> { interventies:{n}, gemDuurMin:{waarde,n}, opTijd:{pct,n,teVroeg,opTijd,teLaat},
//      firstTimeFix:{pct,n,ftf}, herhaalbezoeken:{aantal}, onderdelenWaarde:{waarde} }
// `pct` en `gemDuurMin.waarde` zijn bewust null zonder gegevens (de ring toont dan "geen gegevens").
export function berekenKern({ rapporten = [], alle = rapporten, herhaalDagen = 30 } = {}) {
  const interventies = rapporten.filter(r => r.interventieType === 'Interventie');
  const tijd = opTijd(rapporten);
  const ftf = firstTimeFix(rapporten);
  return {
    interventies: { n: interventies.length },
    gemDuurMin: {
      waarde: gemiddeldeDuur(rapporten),
      n: interventies.filter(r => typeof r.werktijdMin === 'number').length,
    },
    opTijd: { pct: tijd.pct, n: tijd.n, teVroeg: tijd.teVroeg, opTijd: tijd.opTijd, teLaat: tijd.teLaat },
    firstTimeFix: { pct: ftf.pct, n: ftf.n, ftf: ftf.ftf }, // ftf = teller (aantal first-time-fix), n = noemer
    herhaalbezoeken: { aantal: herhaalbezoeken(alle, rapporten, herhaalDagen).length },
    onderdelenWaarde: { waarde: waardeTotaal(rapporten).waarde },
  };
}
