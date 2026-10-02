// schermen/instellingen-logica.js — pure delen van het instellingenscherm (etappe 5b): de validatie van het formulier
// (letterlijk uit saveSettings: zelfde weigeringen, zelfde teksten, zelfde volgorde, zelfde terugvalregels) en de opslagsleutel.
// Geen DOM, geen toestand, geen opslag.

export function settingsKey(person) {
  return person && person !== 'all' ? `blitz_settings_${person}` : 'blitz_settings';
}

// invoer: { startlocatie, duur, max, van, tot, laatsteStart, maxReistijd, tijdslotMinuten, tijdslotTekst, routeKleur, werkdagen }
//   duur/max/maxReistijd/tijdslotMinuten zijn `+veldwaarde` (getal), van/tot/laatsteStart de ruwe tijdstrings,
//   tijdslotTekst de ruwe veldtekst (de oorspronkelijke code leidt de waarde met parseInt af), werkdagen de huidige keuze.
// standaard: DEFAULT_SETTINGS.
// Geeft { fout } met de toasttekst van de eerste weigering, anders { waarden } met de af te leiden instellingen.
export function valideerInstellingen(invoer, standaard) {
  const { duur, max, van, tot, laatsteStart, maxReistijd, tijdslotMinuten, werkdagen } = invoer;
  if (van && tot && van >= tot) return { fout: '⚠ Begintijd moet voor eindtijd liggen' };
  if (laatsteStart && (laatsteStart < (van || standaard.vanTijd) || laatsteStart > (tot || standaard.totTijd))) return { fout: '⚠ Laatste start moet tussen begin- en eindtijd liggen' };
  if (duur < 15)                return { fout: '⚠ Minimale interventieduur is 15 minuten' };
  if (max < 1)                  return { fout: '⚠ Maximaal per dag moet minstens 1 zijn' };
  if (maxReistijd < 0)          return { fout: '⚠ Max. reistijd kan niet negatief zijn' };
  // Fix 7 (finale review): ontbrekende guard voor tijdslotMinuten -- een negatieve/te kleine waarde laat tijdslotVoor()
  // omgekeerde tijdvak-labels produceren (bv. "08:00–07:30") in klant-gerichte mails. Grens = min="60" van het veld.
  if (tijdslotMinuten < 60)     return { fout: '⚠ Tijdslot moet minstens 60 minuten zijn' };
  if (!werkdagen.length)        return { fout: '⚠ Selecteer minstens één werkdag' };

  return { waarden: {
    startlocatie:    (invoer.startlocatie || '').trim() || standaard.startlocatie,
    duurMinuten:     duur || standaard.duurMinuten,
    maxPerDag:       max  || standaard.maxPerDag,
    vanTijd:         van  || standaard.vanTijd,
    totTijd:         tot  || standaard.totTijd,
    laatsteStart:    laatsteStart || standaard.laatsteStart,
    maxReistijdMin:  maxReistijd || maxReistijd === 0 ? maxReistijd : standaard.maxReistijdMin,
    tijdslotMinuten: parseInt(invoer.tijdslotTekst, 10) || standaard.tijdslotMinuten,
    routeKleur:      /^#[0-9a-f]{6}$/i.test(invoer.routeKleur) ? invoer.routeKleur : standaard.routeKleur,
  } };
}
