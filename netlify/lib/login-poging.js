// Loginpogingen reserveren VOOR de (dure) wachtwoordcontrole, zodat een parallelle stoot verzoeken de
// vergrendeling niet kan omzeilen. Gedeeld door auth-login en auth-wachtwoord ("huidig wachtwoord").
import { wijzigPogingen, isVergrendeld, registreerMislukt, wisPogingen } from './vergrendeling.js';

const VERGRENDELING_MS = 15 * 60 * 1000;

// Schrijfacties op de pogingenblob lopen binnen één instantie na elkaar: de blob kent geen echte
// bescherming tegen verloren updates (zie blob-wijzig.js), dus parallelle verzoeken in dezelfde instantie
// mogen elkaars telling niet overschrijven. Tussen instanties blijft enkel de terugleescontrole van wijzigBlob.
let keten = Promise.resolve();
function serieel(werk) {
  const resultaat = keten.then(werk, werk);
  keten = resultaat.then(() => {}, () => {});
  return resultaat;
}

// -> { toegelaten: true, nieuweVergrendeling }   (nieuweVergrendeling: DEZE poging haalt de limiet; wachtwoord
//                                                   wordt nog gecontroleerd, bij mislukking blijft de vergrendeling)
//  | { toegelaten: false, tot: ms }                (al vergrendeld vóór deze poging, of opslag onbereikbaar)
// Fail closed: kan de poging niet bewaard worden (ok:false of fout), dan telt dat als vergrendeld.
export async function reserveerPoging(store, email, nuMs) {
  let reeds = false;
  let nieuweVergrendeling = false;
  try {
    const r = await serieel(() => wijzigPogingen(store, staat => {
      reeds = false;
      nieuweVergrendeling = false;
      if (isVergrendeld(staat, 'login', email, nuMs).vergrendeld) { reeds = true; return null; }
      const m = registreerMislukt(staat, 'login', email, nuMs);
      nieuweVergrendeling = m.vergrendeldNu;
      return m.staat;
    }));
    if (!r.ok) return { toegelaten: false, tot: nuMs + VERGRENDELING_MS };
    if (reeds) return { toegelaten: false, tot: isVergrendeld(r.staat, 'login', email, nuMs).tot ?? nuMs + VERGRENDELING_MS };
    return { toegelaten: true, nieuweVergrendeling };
  } catch (e) {
    console.error('login-poging: teller niet bewaard (' + (e?.name || 'Error') + ')');
    return { toegelaten: false, tot: nuMs + VERGRENDELING_MS };
  }
}

// Na een geslaagde controle: teller wissen (best-effort, de gebruiker is al geslaagd).
export async function wisPoging(store, email) {
  try {
    await serieel(() => wijzigPogingen(store, staat => wisPogingen(staat, 'login', email)));
  } catch (e) {
    console.error('login-poging: teller niet gewist (' + (e?.name || 'Error') + ')');
  }
}

// 'jan@blitz.be' -> 'j***@blitz.be'; zonder '@' -> 'j***'.
export function maskeerEmail(email) {
  const s = String(email ?? '');
  const i = s.indexOf('@');
  if (i < 0) return s.slice(0, 1) + '***';
  return s.slice(0, 1) + '***@' + s.slice(i + 1, i + 1 + 100);
}
