// Loginpogingen reserveren VOOR de (dure) wachtwoordcontrole, zodat een parallelle stoot verzoeken de
// vergrendeling niet kan omzeilen. Gedeeld door auth-login en auth-wachtwoord ("huidig wachtwoord").
import { wijzigPogingen, isVergrendeld, registreerMislukt, wisPogingen } from './vergrendeling.js';
import { maakSerieel } from './serieel.js';

// Duur per soort (gelijk aan vergrendeling.js): login 15 min, herstel (en setupcode) 1 uur.
const VERGRENDELING_MS = { login: 15 * 60 * 1000, herstel: 60 * 60 * 1000 };

// Schrijfacties op de pogingenblob lopen binnen één instantie na elkaar (zie serieel.js).
const serieel = maakSerieel();

// -> { toegelaten: true, nieuweVergrendeling }   (nieuweVergrendeling: DEZE poging haalt de limiet; wachtwoord
//                                                   wordt nog gecontroleerd, bij mislukking blijft de vergrendeling)
//  | { toegelaten: false, tot: ms }                (al vergrendeld vóór deze poging, of opslag onbereikbaar)
// Fail closed: kan de poging niet bewaard worden (ok:false of fout), dan telt dat als vergrendeld.
export async function reserveerPoging(store, email, nuMs, soort = 'login') {
  let reeds = false;
  let nieuweVergrendeling = false;
  try {
    const r = await serieel(() => wijzigPogingen(store, staat => {
      reeds = false;
      nieuweVergrendeling = false;
      if (isVergrendeld(staat, soort, email, nuMs).vergrendeld) { reeds = true; return null; }
      const m = registreerMislukt(staat, soort, email, nuMs);
      nieuweVergrendeling = m.vergrendeldNu;
      return m.staat;
    }));
    if (!r.ok) return { toegelaten: false, tot: nuMs + VERGRENDELING_MS[soort] };
    if (reeds) return { toegelaten: false, tot: isVergrendeld(r.staat, soort, email, nuMs).tot ?? nuMs + VERGRENDELING_MS[soort] };
    return { toegelaten: true, nieuweVergrendeling };
  } catch (e) {
    console.error('login-poging: teller niet bewaard (' + (e?.name || 'Error') + ')');
    return { toegelaten: false, tot: nuMs + VERGRENDELING_MS[soort] };
  }
}

// Na een geslaagde controle: teller wissen (best-effort, de gebruiker is al geslaagd).
export async function wisPoging(store, email, soort = 'login') {
  try {
    await serieel(() => wijzigPogingen(store, staat => wisPogingen(staat, soort, email)));
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
