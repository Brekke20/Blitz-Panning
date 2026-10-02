// schermen/capaciteit.js — het aantalmodel van de planning (spec C3): hoeveel stops past er op een dag,
// wat is de eerstvolgende vrije werkdag, en de capaciteitskop van een dagkolom.
// De pure functies krijgen alles als parameter; de twee toestandslezers onderaan (capacityForDay, nextAvailableDay)
// lezen de toestand. Importeert enkel pure kern-modules, dus ook importeerbaar in node.
import { toestand } from '../kern/toestand.js';
import { strengeAfh } from '../kern/ui.js';
import { localISO } from '../kern/tijd.js';
import { blokkeringenVoor, planItemsVanTechnieker } from '../kern/selecties.js';
import { getHolidayName } from '../kern/feestdagen.js';

// Aantal geblokkeerde minuten binnen de werkdag [dagStartMin, dagEindMin]: elke uitzondering ({ from, to } als
// 'HH:MM') wordt op de werkdag geknipt, daarna gesorteerd en samengevoegd zodat overlappende blokken niet dubbel tellen.
export function blokkeerMinuten(rangeUitzonderingen, dagStartMin, dagEindMin) {
  const intervals = (rangeUitzonderingen || [])
    .map(e => {
      const [fh, fm] = e.from.split(':').map(Number);
      const [th, tm] = e.to.split(':').map(Number);
      const start = Math.max(dagStartMin, fh * 60 + fm);
      const eind  = Math.min(dagEindMin, th * 60 + tm);
      return eind > start ? [start, eind] : null;
    })
    .filter(Boolean)
    .sort((a, b) => a[0] - b[0]);

  let blockedMin = 0;
  let curEnd = -Infinity;
  for (const [start, eind] of intervals) {
    if (start >= curEnd) {
      blockedMin += eind - start;
      curEnd = eind;
    } else if (eind > curEnd) {
      blockedMin += eind - curEnd;
      curEnd = eind;
    }
    // else: volledig binnen het al geteld interval -- niets toevoegen
  }
  return blockedMin;
}

// Aantal stops dat op een dag past. `dagBlokkering`: er is een hele-dag-blokkering; `isFeestdag`: feestdag.
export function capaciteitVoorDag({ datum, isFeestdag, vanTijd, totTijd, duurMinuten, maxPerDag, dagBlokkering, rangeUitzonderingen, travelMin = 30 }) {
  if (isFeestdag) return 0;
  const [vanH, vanM] = vanTijd.split(':').map(Number);
  const [totH, totM] = totTijd.split(':').map(Number);
  const dagStart = vanH * 60 + vanM;
  const dagEind  = totH * 60 + totM;
  const totalMin = dagEind - dagStart;
  if (dagBlokkering) return 0;
  const blockedMin = blokkeerMinuten(rangeUitzonderingen, dagStart, dagEind);
  const available = Math.max(0, totalMin - blockedMin);
  const perSlot   = duurMinuten + travelMin;
  return Math.min(Math.floor(available / perSlot), maxPerDag);
}

// Eerstvolgende werkdag vanaf `van` ('YYYY-MM-DD') met vrije capaciteit; null als er binnen 60 dagen geen is.
// `nu`: Date (enkel de dag telt); `capaciteitVan(dag)` en `reedsGepland(dag)` leveren de aantallen voor 'YYYY-MM-DD'.
export function volgendeBeschikbareDag(van, { nu, werkdagen, capaciteitVan, reedsGepland }) {
  const today = new Date(nu); today.setHours(0,0,0,0);
  const d = new Date(van + 'T12:00:00');
  for (let i = 0; i < 60; i++) {
    if (d >= today) {
      const dStr = localISO(d);
      if (werkdagen.includes(d.getDay())) {
        if (capaciteitVan(dStr) - reedsGepland(dStr) > 0) return dStr;
      }
    }
    d.setDate(d.getDate() + 1);
  }
  return null;
}

// Kop van een dagkolom: `n/cap stops · ±Xu`; `vol` als het aantal de capaciteit haalt.
export function capaciteitsKop({ aantal, cap, duurMinuten, travelMin }) {
  return {
    label: `${aantal}/${cap} stops · ±${Math.round(aantal * (duurMinuten + travelMin) / 60 * 10) / 10}u`,
    vol: aantal >= cap,
  };
}

// ── Toestandslezers ──────────────────────────────────────────────────────────
// Afhankelijkheden uit het klassieke script (ingevuld door initCapaciteit); een vergeten init faalt luid.
let afh = new Proxy({}, { get() { throw new Error('capaciteit: initCapaciteit() is niet aangeroepen'); } });
export function initCapaciteit(afhankelijkheden) {
  afh = strengeAfh('capaciteit', afhankelijkheden); // { duurVoor }
}

export function capacityForDay(datum, travelMin = 30) {
  if (getHolidayName(datum)) return 0; // feestdag: nul, zonder de instellingen te lezen (zoals vroeger)
  const settings = toestand.get('settings');
  const filter = toestand.get('activeAssigneeFilter');
  const avExceptions = toestand.get('avExceptions');
  return capaciteitVoorDag({
    datum,
    vanTijd: settings.vanTijd,
    totTijd: settings.totTijd,
    duurMinuten: settings.duurMinuten,
    maxPerDag: settings.maxPerDag,
    dagBlokkering: blokkeringenVoor(avExceptions, datum, filter, 'fullday').length > 0,
    rangeUitzonderingen: blokkeringenVoor(avExceptions, datum, filter, 'range'),
    travelMin,
  });
}

export function nextAvailableDay(van) {
  const settings = toestand.get('settings');
  const filter = toestand.get('activeAssigneeFilter');
  const planning = toestand.get('planning');
  return volgendeBeschikbareDag(van, {
    nu: new Date(),
    werkdagen: settings.werkdagen,
    capaciteitVan: dag => capacityForDay(dag),
    reedsGepland: dag => planItemsVanTechnieker(planning[dag], filter)
      .reduce((sum, p) => sum + Math.ceil(afh.duurVoor(p.ticket.id) / settings.duurMinuten), 0),
  });
}
