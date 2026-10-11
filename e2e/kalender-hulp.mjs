// Gedeelde hulpfuncties voor de kalender-, wachtrij- en indelingsspecs (etappe 4, karakterisering).
import { opslagStub } from './helpers.mjs';

export const AFSPRAAK_WO = {
  id: 'a1', titel: 'Teamoverleg', datum: '2026-10-07', uur: '14:00', einduur: '15:30',
  type: 'Afspraak', persoon: null, adres: 'Kantoor Geel', notitie: '', telefoon: '', email: '', bron: 'manueel', origResp: null,
};
export const BLOKKADE_DO = {
  id: 'b1', scope: 'global', person: null, date: '2026-10-08', kind: 'fullday', from: null, to: null, reason: 'Verlof',
};

// Nep-backend met een eigen afspraak (wo 7 okt) en een geblokkeerde dag (do 8 okt); extra's erbovenop.
export const seed = ({ afspraken = [], blokkades = [], klant = null, basis = true } = {}) => ({
  afspraken: opslagStub({ versie: 1, afspraken: [...(basis ? [AFSPRAAK_WO] : []), ...afspraken] }, 'afspraken'),
  availability: opslagStub({ versie: 1, exceptions: [...(basis ? [BLOKKADE_DO] : []), ...blokkades] }, 'exceptions'),
  ...(klant ? { klantbeschikbaarheid: opslagStub({ versie: 1, items: klant }, 'items') } : {}),
});

export const dag = (page, datum) => page.locator(`.day-col[data-date="${datum}"]`);

// Eigen afspraak voor tests die er meerdere nodig hebben.
export const afspraak = (id, datum, uur, einduur, extra = {}) => ({
  id, titel: `Afspraak ${id}`, datum, uur, einduur, type: 'Afspraak', persoon: null,
  adres: '', notitie: '', telefoon: '', email: '', bron: 'manueel', origResp: null, ...extra,
});

// Zet extra stops (tickets zonder Zoho-bron) in `planning` via kern.toestand en laat de schermen hertekenen.
// `spec`: { id, nummer, datum, uur?, assignee?, status? }. De kalender abonneert niet op `planning`, dus raken
// we ook `allPending` (zoals een echte dataload zou doen).
export async function voegStopsToe(page, specs) {
  await page.evaluate((lijst) => {
    const planning = kern.toestand.get('planning');
    for (const s of lijst) {
      const ticket = {
        id: s.id, number: s.nummer, subject: `Testticket ${s.nummer}`,
        status: s.status || 'Wachten op bevestiging planning', priority: 'medium', assignee: s.assignee || 'Tim',
        contact: '', email: '', phone: '', account: 'Testklant', address: 'Teststraat 1, 2000 Antwerpen', hasAddress: true,
        _lat: 51.2, _lon: 4.4, interventieDatum: null,
      };
      (planning[s.datum] ??= []).push({ ticket, address: ticket.address, uur: s.uur ?? null });
    }
    kern.toestand.raak('planning');
    kern.toestand.raak('allPending');
  }, specs);
}
