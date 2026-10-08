// Lees-wijzig-schrijf-controleer op één blob. Netlify Blobs kent geen transacties: twee gelijktijdige
// schrijvers kunnen elkaar overschrijven. Na het schrijven lezen we terug; staat er iets anders dan wat
// wij schreven, dan schreef een ander erover en herhalen we vanuit de verse lezing (max `pogingen`).

const gelijk = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// wijzig(huidig) -> nieuwe waarde | null (null = niets doen).
// Heeft de huidige blob een numerieke `versie`, dan schrijven we `versie + 1`.
// controleer(gelezen, geschreven) -> boolean; standaard: de teruggelezen blob is exact wat wij schreven.
export async function wijzigBlob(store, key, { leeg, wijzig, controleer = gelijk, pogingen = 3 }) {
  let waarde = null;
  for (let poging = 0; poging < pogingen; poging++) {
    const gelezen = await store.get(key, { type: 'json' });
    const huidig = gelezen ?? structuredClone(leeg);
    const nieuw = wijzig(structuredClone(huidig));
    if (nieuw == null) return { ok: true, waarde: huidig };
    if (typeof huidig?.versie === 'number') nieuw.versie = huidig.versie + 1;
    // JSON-ronde zodat de vergelijking met de teruggelezen blob niet struikelt over `undefined`
    const geschreven = JSON.parse(JSON.stringify(nieuw));
    await store.setJSON(key, geschreven);
    const terug = await store.get(key, { type: 'json' });
    waarde = terug; // bij ok:false: wat er nu werkelijk staat
    if (controleer(terug, geschreven)) return { ok: true, waarde: geschreven };
  }
  return { ok: false, waarde };
}
