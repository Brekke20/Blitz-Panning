// schermen/sales-instellingen-logica.js — pure delen van het instellingenvenster van de verkoper (Task 13b): de formulierwaarden, de
// validatie (via de gedeelde regels van het instellingenscherm en de server) en het object dat bewaard wordt. Geen DOM, geen netwerk.
// De server vervangt het HELE instellingenobject van de gebruiker bij een PUT: `bouwBewaardObject` vertrekt daarom van de ruwe, bewaarde
// instellingen zodat onbekende of niet bewerkte sleutels (kaartStijl, werkdagen, …) niet verloren gaan.
import { valideerVelden, standaardLaatsteStart } from '../kern/instellingen-regels.js';

const STANDAARD = Object.freeze({ vanTijd: '08:00', totTijd: '17:00', laatsteStart: '16:00', bezoekDuurMin: 60 });
const OPTIONELE_SLEUTELS = ['startlocatie', 'laatsteStart', 'bezoekDuurMin']; // een leeg veld betekent: niet bewaren (de standaard geldt)

const tekst = (w) => (w == null ? '' : String(w).trim());

/** De waarden voor de velden van het formulier, uit de (met standaardwaarden aangevulde) instellingen van de verkoper. */
export function formulierWaarden(instellingen) {
  const i = instellingen && typeof instellingen === 'object' ? instellingen : {};
  return {
    startlocatie: typeof i.startlocatie === 'string' ? i.startlocatie : '',
    vanTijd: i.vanTijd ?? STANDAARD.vanTijd,
    totTijd: i.totTijd ?? STANDAARD.totTijd,
    laatsteStart: i.laatsteStart ?? standaardLaatsteStart(i.vanTijd ?? STANDAARD.vanTijd, i.totTijd ?? STANDAARD.totTijd),
    bezoekDuurMin: i.bezoekDuurMin ?? STANDAARD.bezoekDuurMin,
  };
}

/**
 * invoer = { startlocatie, vanTijd, totTijd, laatsteStart, bezoekDuurMin } (alles tekst, zoals de velden het geven).
 * -> { fout } met de Nederlandse tekst van de eerste weigering, of { waarden } met enkel de ingevulde, geldige velden.
 * Begin- en eindtijd zijn verplicht; startlocatie (vrije tekst, ook enkel een postcode), laatste start en bezoekduur mogen leeg blijven.
 */
export function valideerSalesInstellingen(invoer) {
  if (invoer === null || typeof invoer !== 'object' || Array.isArray(invoer)) return { fout: 'Ongeldige instellingen.' };
  const van = tekst(invoer.vanTijd);
  const tot = tekst(invoer.totTijd);
  if (van === '') return { fout: '⚠ Begintijd moet een tijdstip zijn (uu:mm)' };
  if (tot === '') return { fout: '⚠ Eindtijd moet een tijdstip zijn (uu:mm)' };

  const laatste = tekst(invoer.laatsteStart);
  const duurTekst = tekst(invoer.bezoekDuurMin);
  // Number('') is 0 en geeft anders de fout "tussen 5 en 480": enkel omzetten als het veld ingevuld is, en enkel een geheel getal
  // (NaN geeft in valideerVelden dezelfde weigering als een getal buiten de grenzen, na de controle van de tijden).
  const duur = duurTekst === '' ? undefined : (/^\d+$/.test(duurTekst) ? Number(duurTekst) : Number.NaN);
  // Een lege laatste start geldt als de standaard min(16:00, eindtijd): die valt per definitie binnen de werkuren, dus niets te controleren.
  const r = valideerVelden({
    vanTijd: van, totTijd: tot, laatsteStart: laatste,
    startlocatie: tekst(invoer.startlocatie), bezoekDuurMin: duur,
  });
  if (r.fout) return { fout: r.fout };
  const waarden = { ...r.waarden };
  if (laatste === '') delete waarden.laatsteStart;
  return { waarden };
}

/**
 * Het volledige instellingenobject om te bewaren: de ruwe bewaarde instellingen met de bewerkte velden erover, min de sleutels
 * (startlocatie, laatsteStart, bezoekDuurMin) die de invoer leeg liet. Muteert niets.
 */
export function bouwBewaardObject(ruw, waarden, invoer) {
  const uit = { ...(ruw && typeof ruw === 'object' && !Array.isArray(ruw) ? ruw : {}), ...waarden };
  for (const sleutel of OPTIONELE_SLEUTELS) if (tekst(invoer?.[sleutel]) === '') delete uit[sleutel];
  return uit;
}
