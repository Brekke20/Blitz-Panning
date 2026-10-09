// Sales-planner (server): welk verkoperblob hoort bij dit verzoek? Dezelfde regels als public/js/sales/toegang.js
// (`magLezen`/`magSchrijven`), plus de opzoeking in de gebruikerslijst. Een weigering verraadt het bestaan van een id niet:
// voor sales is een onbekend id hetzelfde antwoord (403) als een niet-verkoper, zoals in instellingen.js.

export const TEST_VERKOPER_ID = 'test-sales';

const GEEN_RECHT = Object.freeze({ ok: false, status: 403, fout: 'Je hebt hier geen toegang toe.', code: 'geen-recht' });
const NIET_GEVONDEN = Object.freeze({ ok: false, status: 404, fout: 'Verkoper niet gevonden.' });
const GEBLOKKEERD = Object.freeze({ ok: false, status: 403, fout: 'Deze verkoper is geblokkeerd: de gegevens zijn alleen te lezen.', code: 'geblokkeerd' });
const goed = doelId => ({ ok: true, doelId });

/**
 * -> { ok:true, doelId } | { ok:false, status:403|404, fout, code? }
 * - sales: `doel` moet een ACTIEVE verkoper zijn (`actief === true`, zoals de login); een geblokkeerde verkoper telt als onbekend;
 * - beheerder: een geblokkeerde verkoper is nog te LEZEN (de beheerder kan de gegevens inzien, bv. bij een verzoek van een klant), maar niet te
 *   schrijven (403, code 'geblokkeerd'): wie niet meer inlogt heeft geen planning meer om te wijzigen (de opruiming wist na 12 maanden);
 * - sales: het eigen id (ook als `gevraagdId` gelijk is); een ander id enkel om te LEZEN, enkel met magAlleSales en enkel
 *   naar een gebruiker met rol 'sales' (anders 403, ook bij een onbekend id);
 * - beheerder: elk id van een gebruiker met rol 'sales' (404 anders, ook zonder id), lezen én schrijven;
 *   'test-sales' is altijd geldig bij een testverzoek (de testgebruikers staan niet in het echte gebruikersblob);
 * - alle andere rollen: 403.
 */
export async function bepaalDoel({ gebruiker, gevraagdId, schrijven = false, leesGebruikers, testVerzoek = false }) {
  const rol = gebruiker?.rol;
  const eigenId = typeof gebruiker?.id === 'string' ? gebruiker.id : '';
  const gevraagd = typeof gevraagdId === 'string' && gevraagdId !== '' ? gevraagdId : null;
  const zoekVerkoper = async id => {
    const doel = (await leesGebruikers()).find(g => g && g.id === id);
    return doel && doel.rol === 'sales' ? doel : null;
  };
  const verkoperMetId = async id => (await zoekVerkoper(id))?.actief === true; // voor sales: een geblokkeerde verkoper is geen doel meer

  if (rol === 'sales') {
    if (!eigenId) return GEEN_RECHT;
    if (gevraagd === null || gevraagd === eigenId) return goed(eigenId);
    if (schrijven || gebruiker.magAlleSales !== true) return GEEN_RECHT;
    if (testVerzoek && gevraagd === TEST_VERKOPER_ID) return goed(gevraagd);
    return (await verkoperMetId(gevraagd)) ? goed(gevraagd) : GEEN_RECHT;
  }
  if (rol === 'beheerder') {
    const id = gevraagd ?? eigenId;
    if (!id) return NIET_GEVONDEN;
    if (testVerzoek && id === TEST_VERKOPER_ID) return goed(id);
    const doel = await zoekVerkoper(id);
    if (!doel) return NIET_GEVONDEN;
    if (doel.actief !== true && schrijven) return GEBLOKKEERD;
    return goed(id);
  }
  return GEEN_RECHT;
}
