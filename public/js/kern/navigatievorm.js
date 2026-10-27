// kern/navigatievorm.js — de vorm van de navigatie (Open dag, taak 8a, Ruling 12): zijkolom (`kolom`) of dok onderaan (`dok`).
// Los van het toestel: apparaat.js zet `data-indeling` (gsm, tablet, computer; Route en andere schermen hangen daaraan en dat blijft zo),
// maar een smal computervenster (< 768 px) krijgt toch het dok, anders laat de 256 px brede kolom de inhoud geen plaats.
// Eén bron: `data-nav="kolom|dok"` op <html>, enkel hier gezet. css/navigatie.css (kolom, dok, body-padding), de paginakop (app.css),
// sticky-offset.js (--dok-h), schermen/dok-meer.js en de aria-orientation van de tabbalk (app.js) volgen dit attribuut.
// navigatieVorm is puur; startNavigatievorm krijgt het venster mee (enkel kern/brug.js geeft `window` door) en stuurt bij een wijziging
// `navigatievormwijziging` uit (een breedtewissel zonder indelingswissel geeft geen `apparaatwijziging`).

export const NAV_MIN_BREEDTE = 768;

export function navigatieVorm({ indeling, breedte } = {}) {
  return indeling !== 'breed' || breedte < NAV_MIN_BREEDTE ? 'dok' : 'kolom';
}

export function startNavigatievorm(venster) {
  const html = venster.document.documentElement;
  let vorige = null;
  const zet = () => {
    const vorm = navigatieVorm({ indeling: html.getAttribute('data-indeling'), breedte: venster.innerWidth });
    if (vorm === vorige) return;
    const eerste = vorige === null;
    vorige = vorm;
    html.setAttribute('data-nav', vorm);
    if (!eerste) venster.dispatchEvent(new venster.CustomEvent('navigatievormwijziging', { detail: vorm }));
  };
  zet();
  // Eerst geregistreerd (brug.js laadt als eerste module): andere luisteraars op deze gebeurtenissen zien het nieuwe attribuut al.
  venster.addEventListener('resize', zet);
  venster.addEventListener('apparaatwijziging', zet);
  return () => {
    venster.removeEventListener('resize', zet);
    venster.removeEventListener('apparaatwijziging', zet);
  };
}
