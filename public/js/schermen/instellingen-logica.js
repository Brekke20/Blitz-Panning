// schermen/instellingen-logica.js — pure delen van het instellingenscherm (etappe 5b): de validatie van het formulier
// (letterlijk uit saveSettings: zelfde weigeringen, zelfde teksten, zelfde volgorde, zelfde terugvalregels) en de opslagsleutel.
// Geen DOM, geen toestand, geen opslag.
import { valideerVelden, isKleur } from '../kern/instellingen-regels.js';

export function settingsKey(person) {
  return person && person !== 'all' ? `blitz_settings_${person}` : 'blitz_settings';
}

// invoer: { startlocatie, duur, max, van, tot, laatsteStart, maxReistijd, tijdslotMinuten, tijdslotTekst, routeKleur, werkdagen }
//   duur/max/maxReistijd/tijdslotMinuten zijn `+veldwaarde` (getal), van/tot/laatsteStart de ruwe tijdstrings,
//   tijdslotTekst de ruwe veldtekst (de oorspronkelijke code leidt de waarde met parseInt af), werkdagen de huidige keuze.
// standaard: DEFAULT_SETTINGS.
// De regels zelf (grenzen, teksten, volgorde) staan in kern/instellingen-regels.js en gelden ook op de server. Dit scherm
// past eerst zijn formulierterugvallen toe: een leeg of NaN-veld wordt "ontbrekend" (valt na de controle terug op de standaard)
// en een ongeldige routekleur (de kleurkiezer geeft die niet) valt stil terug op de standaard.
// Geeft { fout } met de toasttekst van de eerste weigering, anders { waarden } met de af te leiden instellingen.
const getal = n => (Number.isNaN(n) ? undefined : n);

export function valideerInstellingen(invoer, standaard) {
  const { duur, max, van, tot, laatsteStart, maxReistijd, tijdslotMinuten, werkdagen } = invoer;
  const r = valideerVelden({
    vanTijd: van, totTijd: tot, laatsteStart,
    duurMinuten: getal(duur), maxPerDag: getal(max), maxReistijdMin: getal(maxReistijd), tijdslotMinuten: getal(tijdslotMinuten),
    werkdagen,
    startlocatie: invoer.startlocatie,
  }, { vanTijd: standaard.vanTijd, totTijd: standaard.totTijd });
  if (r.fout) return { fout: r.fout };
  const w = r.waarden;

  return { waarden: {
    startlocatie:    w.startlocatie ?? standaard.startlocatie,
    duurMinuten:     w.duurMinuten ?? standaard.duurMinuten,
    maxPerDag:       w.maxPerDag ?? standaard.maxPerDag,
    vanTijd:         w.vanTijd ?? standaard.vanTijd,
    totTijd:         w.totTijd ?? standaard.totTijd,
    laatsteStart:    w.laatsteStart ?? standaard.laatsteStart,
    maxReistijdMin:  w.maxReistijdMin ?? standaard.maxReistijdMin,
    tijdslotMinuten: parseInt(invoer.tijdslotTekst, 10) || standaard.tijdslotMinuten,
    routeKleur:      isKleur(invoer.routeKleur) ? invoer.routeKleur : standaard.routeKleur,
  } };
}
