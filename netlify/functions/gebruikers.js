// /api/gebruikers — gebruikersbeheer (enkel beheerder) en sales-overzicht.
//   GET                    beheerder -> { gebruikers: BeheerGebruiker[] } (met laatsteLogin uit blob `login-laatst`)
//   GET ?rol=sales         beheerder, of sales met magAlleSales -> { gebruikers: PubliekeGebruiker[] } (actieve verkopers)
//   POST { actie:'maak', email, naam, rol, zohoNaam?, salesNaam?, magAlleSales?, startWachtwoord? }
//        -> 201 { gebruiker, startWachtwoord, herstelcodes? } (herstelcodes enkel bij rol beheerder, enkel nu getoond)
//   POST { actie:'reset-wachtwoord', id, startWachtwoord? } -> 200 { startWachtwoord } (verplichte wijziging, uitgelogd)
//   POST { actie:'uitloggen-overal', id } -> 200 { ok:true }
//   POST { actie:'nieuwe-herstelcodes', wachtwoord } -> 200 { herstelcodes } (eigen beheerdersaccount, eigen wachtwoord)
//   PATCH { id, naam?, rol?, actief?, zohoNaam?, salesNaam?, magAlleSales? } -> 200 { gebruiker, herstelcodes? }
// Alle schrijfacties lopen via wijzigGebruikers binnen dezelfde serieel-keten als setup en herstel; kanWijzigen
// (de laatste actieve beheerder blijft beschermd) wordt BINNEN die callback op de ontvangen lijst aangeroepen.
// Antwoorden bevatten nooit hashes, herstelcodes-hashes of sessieVersie; platte herstelcodes en startwachtwoorden
// staan enkel in het antwoord op de actie die ze aanmaakt.
import { getStore } from '@netlify/blobs';
import { beveiligV2 } from '../lib/beveiligd.js';
import { rechtenVoor } from '../lib/rechten.js';
import { maakCors } from '../lib/http.js';
import {
  hashWachtwoord, verifieerWachtwoord, beleidsFout, genereerWachtwoord,
} from '../lib/wachtwoord.js';
import {
  valideerNieuweGebruiker, leesGebruikers, wijzigGebruikers, leesLaatsteLogins, publiek, beheerWeergave,
  kanWijzigen, pasWijzigingToe, nieuwId, normaliseerEmail,
} from '../lib/gebruikers.js';
import { maakHerstelcodes, serieelGebruikers } from '../lib/herstel.js';
import { reserveerPoging, wisPoging } from '../lib/login-poging.js';
import { logActiviteit } from '../lib/activiteit.js';
import { authStore, OPSLAG_STORING } from '../lib/auth-antwoord.js';

const CORS = Object.freeze(maakCors({
  methoden: 'GET, POST, PATCH, OPTIONS', headers: 'Content-Type, X-Blitz', inhoudType: 'application/json',
}));
const VERGRENDELD_TEKST = 'Te veel mislukte pogingen. Probeer het later opnieuw.';
const GEEN_RECHT = { error: 'Je hebt hier geen toegang toe.', code: 'geen-recht' };
const NIET_GEVONDEN = { error: 'Gebruiker niet gevonden.' };

const json = (status, obj) => new Response(JSON.stringify(obj), {
  status, headers: { ...CORS, 'Cache-Control': 'no-store' },
});
const isObject = b => Boolean(b) && typeof b === 'object' && !Array.isArray(b);

export function maakHandler({ getStore: haalStore, nu = () => Date.now(), auth } = {}) {
  // Eén schrijfactie op `gebruikers`: serieel binnen de instantie, fail closed bij ok:false of een fout.
  async function bewaar(store, wijzig) {
    const r = await serieelGebruikers(() => wijzigGebruikers(store, wijzig));
    return r.ok ? r : null;
  }

  const weergave = async (store, g) => {
    let laatste = null;
    try { laatste = (await leesLaatsteLogins(store))[g.id] ?? null; } catch { /* best-effort */ }
    return beheerWeergave(g, laatste);
  };

  // ---------------- GET ----------------
  async function lijstOphalen(req, store, gebruiker) {
    const rollen = new URL(req.url).searchParams.getAll('rol');
    const rechten = rechtenVoor(gebruiker);
    if (rollen.length === 0) {
      if (!rechten.beheer) return json(403, GEEN_RECHT);
      const [alle, laatste] = await Promise.all([leesGebruikers(store), leesLaatsteLogins(store)]);
      return json(200, { gebruikers: alle.map(g => beheerWeergave(g, laatste[g.id] ?? null)) });
    }
    if (rollen.length !== 1 || rollen[0] !== 'sales' || !rechten.alleSales) return json(403, GEEN_RECHT);
    const alle = await leesGebruikers(store);
    return json(200, { gebruikers: alle.filter(g => g.rol === 'sales' && g.actief === true).map(publiek) });
  }

  // ---------------- POST: maak ----------------
  async function maakAan(body, store, beheerder) {
    const geldig = valideerNieuweGebruiker(body);
    if (geldig.fout) return json(400, { error: geldig.fout });
    let startWachtwoord = body.startWachtwoord;
    if (startWachtwoord == null) {
      startWachtwoord = genereerWachtwoord();
    } else {
      const fout = beleidsFout(startWachtwoord);
      if (fout) return json(400, { error: fout });
    }
    const beheerderRol = geldig.waarden.rol === 'beheerder';
    const [wachtwoordHash, herstel] = await Promise.all([
      hashWachtwoord(startWachtwoord), beheerderRol ? maakHerstelcodes() : Promise.resolve(null),
    ]);
    const nieuw = {
      id: nieuwId(), ...geldig.waarden, actief: true, wachtwoordHash, moetWachtwoordWijzigen: true,
      sessieVersie: 1, aangemaakt: new Date(nu()).toISOString(),
    };
    if (herstel) nieuw.herstelcodes = herstel.hashes;

    let dubbel = false;
    const r = await bewaar(store, lijst => {
      dubbel = lijst.some(g => g && normaliseerEmail(g.email) === nieuw.email);
      return dubbel ? null : [...lijst, nieuw];
    });
    if (dubbel) return json(409, { error: 'Er bestaat al een gebruiker met dit e-mailadres.' });
    if (!r || !r.gebruikers.some(g => g && g.id === nieuw.id)) return json(503, OPSLAG_STORING);

    await logActiviteit(store, { gebruiker: beheerder, actie: 'gebruiker-aangemaakt', onderwerp: nieuw.id, details: `rol ${nieuw.rol}` }, { nu });
    const antwoord = { gebruiker: beheerWeergave(nieuw), startWachtwoord };
    if (herstel) antwoord.herstelcodes = herstel.codes;
    return json(201, antwoord);
  }

  // ---------------- POST: reset-wachtwoord ----------------
  async function resetWachtwoord(body, store, beheerder) {
    if (typeof body.id !== 'string' || body.id === '') return json(400, { error: 'Gebruiker ontbreekt.' });
    let startWachtwoord = body.startWachtwoord;
    if (startWachtwoord == null) {
      startWachtwoord = genereerWachtwoord();
    } else {
      const fout = beleidsFout(startWachtwoord);
      if (fout) return json(400, { error: fout });
    }
    const doel = (await leesGebruikers(store)).find(g => g && g.id === body.id);
    if (!doel) return json(404, NIET_GEVONDEN);
    const nieuweHash = await hashWachtwoord(startWachtwoord);

    let gevonden = false;
    let email = null;
    const r = await bewaar(store, lijst => {
      gevonden = false;
      const i = lijst.findIndex(g => g && g.id === body.id);
      if (i < 0) return null;
      gevonden = true;
      email = lijst[i].email;
      const kopie = [...lijst];
      kopie[i] = { ...lijst[i], wachtwoordHash: nieuweHash, moetWachtwoordWijzigen: true, sessieVersie: (lijst[i].sessieVersie ?? 0) + 1 };
      return kopie;
    });
    if (!r) return json(503, OPSLAG_STORING);
    if (!gevonden) return json(404, NIET_GEVONDEN);
    const bewaard = r.gebruikers.find(g => g && g.id === body.id);
    if (!bewaard || bewaard.wachtwoordHash !== nieuweHash) return json(503, OPSLAG_STORING);

    await wisPoging(store, email); // een vergrendelde gebruiker kan met het nieuwe startwachtwoord meteen weer inloggen
    await logActiviteit(store, { gebruiker: beheerder, actie: 'wachtwoord-gereset', onderwerp: body.id }, { nu });
    return json(200, { startWachtwoord });
  }

  // ---------------- POST: uitloggen-overal ----------------
  async function uitloggenOveral(body, store, beheerder) {
    if (typeof body.id !== 'string' || body.id === '') return json(400, { error: 'Gebruiker ontbreekt.' });
    let verhoogd = null;
    const r = await bewaar(store, lijst => {
      verhoogd = null;
      const i = lijst.findIndex(g => g && g.id === body.id);
      if (i < 0) return null;
      verhoogd = (lijst[i].sessieVersie ?? 0) + 1;
      const kopie = [...lijst];
      kopie[i] = { ...lijst[i], sessieVersie: verhoogd };
      return kopie;
    });
    if (!r) return json(503, OPSLAG_STORING);
    if (verhoogd === null) return json(404, NIET_GEVONDEN);
    const bewaard = r.gebruikers.find(g => g && g.id === body.id);
    if (!bewaard || bewaard.sessieVersie !== verhoogd) return json(503, OPSLAG_STORING);
    await logActiviteit(store, { gebruiker: beheerder, actie: 'gebruiker-gewijzigd', onderwerp: body.id, details: 'overal-uitgelogd' }, { nu });
    return json(200, { ok: true });
  }

  // ---------------- POST: nieuwe-herstelcodes ----------------
  async function nieuweHerstelcodes(body, store, beheerder) {
    if (typeof body.wachtwoord !== 'string' || body.wachtwoord === '') return json(400, { error: 'Geef je huidige wachtwoord op.' });
    const record = (await leesGebruikers(store)).find(g => g && g.id === beheerder.id);
    if (!record || record.rol !== 'beheerder' || record.actief !== true || typeof record.wachtwoordHash !== 'string') {
      return json(403, GEEN_RECHT);
    }
    // Zelfde teller als inloggen: een gestolen sessie mag het wachtwoord hier niet onbeperkt kunnen raden.
    const reservering = await reserveerPoging(store, record.email, nu());
    if (!reservering.toegelaten) {
      return json(429, { error: VERGRENDELD_TEKST, opnieuwOp: new Date(reservering.tot).toISOString() });
    }
    if (!(await verifieerWachtwoord(body.wachtwoord, record.wachtwoordHash))) {
      if (reservering.nieuweVergrendeling) {
        await logActiviteit(store, { gebruiker: beheerder, actie: 'login-mislukt-reeks' }, { nu });
      }
      return json(400, { error: 'Het wachtwoord is onjuist.' }); // de poging is al geteld
    }

    const { codes, hashes } = await maakHerstelcodes();
    let intussenGewijzigd = false;
    const r = await bewaar(store, lijst => {
      intussenGewijzigd = false;
      const i = lijst.findIndex(g => g && g.id === record.id);
      const huidig = lijst[i];
      if (i < 0 || huidig.rol !== 'beheerder' || huidig.actief !== true || huidig.wachtwoordHash !== record.wachtwoordHash) {
        intussenGewijzigd = true;
        return null;
      }
      const kopie = [...lijst];
      kopie[i] = { ...huidig, herstelcodes: hashes };
      return kopie;
    });
    if (!r) return json(503, OPSLAG_STORING);
    if (intussenGewijzigd) return json(409, { error: 'Je account is intussen gewijzigd. Probeer opnieuw.' });
    const bewaard = r.gebruikers.find(g => g && g.id === record.id);
    if (!bewaard || JSON.stringify(bewaard.herstelcodes) !== JSON.stringify(hashes)) return json(503, OPSLAG_STORING);

    await wisPoging(store, record.email);
    await logActiviteit(store, { gebruiker: beheerder, actie: 'gebruiker-gewijzigd', onderwerp: record.id, details: 'nieuwe-herstelcodes' }, { nu });
    return json(200, { herstelcodes: codes });
  }

  // ---------------- PATCH ----------------
  async function wijzig(body, store, beheerder) {
    if (typeof body.id !== 'string' || body.id === '') return json(400, { error: 'Gebruiker ontbreekt.' });
    const doel = (await leesGebruikers(store)).find(g => g && g.id === body.id);
    if (!doel) return json(404, NIET_GEVONDEN);
    const voor = pasWijzigingToe(doel, body);
    if (voor.fout) return json(400, { error: voor.fout });
    // Nieuwe herstelcodes bij een promotie: async hashen, dus vóór de (synchrone) callback.
    const herstel = voor.promotie ? await maakHerstelcodes() : null;

    let weigering = null;
    let uitkomst = null;
    let eerste = null; // wat de eerste evaluatie wilde wijzigen (zie hieronder)
    const r = await bewaar(store, lijst => {
      weigering = null;
      uitkomst = null;
      const i = lijst.findIndex(g => g && g.id === body.id);
      if (i < 0) { weigering = json(404, NIET_GEVONDEN); return null; }
      const w = pasWijzigingToe(lijst[i], body);
      if (w.fout) { weigering = json(400, { error: w.fout }); return null; }
      if (w.gewijzigd.length === 0 && eerste) {
        // Herhaling na een mislukte terugleescontrole: onze eigen schrijfactie blijkt toch geland. Niet als "niets te doen" melden.
        uitkomst = eerste;
        return null;
      }
      const toegestaan = kanWijzigen(lijst, body.id, { actief: w.nieuw.actief, rol: w.nieuw.rol });
      if (!toegestaan.ok) { weigering = json(409, { error: toegestaan.fout }); return null; }
      if (w.promotie) {
        if (!herstel) { weigering = json(409, { error: 'De rol van deze gebruiker is intussen gewijzigd. Probeer opnieuw.' }); return null; }
        w.nieuw.herstelcodes = herstel.hashes;
      }
      uitkomst = { w, van: lijst[i].rol };
      if (w.gewijzigd.length === 0) return null; // niets te doen
      eerste = uitkomst;
      const kopie = [...lijst];
      kopie[i] = w.nieuw;
      return kopie;
    });
    if (weigering) return weigering;
    if (!r) return json(503, OPSLAG_STORING);
    const { w, van } = uitkomst;
    const bewaard = r.gebruikers.find(g => g && g.id === body.id);
    if (!bewaard) return json(503, OPSLAG_STORING);
    if (w.gewijzigd.length === 0) return json(200, { gebruiker: await weergave(store, bewaard) });
    if (bewaard.naam !== w.nieuw.naam || bewaard.rol !== w.nieuw.rol || bewaard.actief !== w.nieuw.actief
      || bewaard.sessieVersie !== w.nieuw.sessieVersie
      || (w.promotie && JSON.stringify(bewaard.herstelcodes) !== JSON.stringify(herstel.hashes))) return json(503, OPSLAG_STORING);

    const velden = w.gewijzigd.map(v => (v === 'rol' ? `rol ${van} naar ${w.nieuw.rol}` : v)).join(', ');
    await logActiviteit(store, {
      gebruiker: beheerder, actie: w.blokkeert ? 'gebruiker-geblokkeerd' : 'gebruiker-gewijzigd', onderwerp: body.id, details: velden,
    }, { nu });
    const antwoord = { gebruiker: await weergave(store, bewaard) };
    if (w.promotie) antwoord.herstelcodes = herstel.codes;
    return json(200, antwoord);
  }

  const kern = async (req, _context, gebruiker) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    try {
      const store = await authStore(haalStore);
      if (req.method === 'GET') return await lijstOphalen(req, store, gebruiker);

      let body;
      try { body = await req.json(); } catch { return json(400, { error: 'Ongeldige JSON' }); }
      if (!isObject(body)) return json(400, { error: 'Ongeldige invoer.' });
      if (req.method === 'PATCH') return await wijzig(body, store, gebruiker);
      switch (body.actie) {
        case 'maak': return await maakAan(body, store, gebruiker);
        case 'reset-wachtwoord': return await resetWachtwoord(body, store, gebruiker);
        case 'uitloggen-overal': return await uitloggenOveral(body, store, gebruiker);
        case 'nieuwe-herstelcodes': return await nieuweHerstelcodes(body, store, gebruiker);
        default: return json(400, { error: 'Onbekende actie.' });
      }
    } catch (e) {
      // Alleen het fouttype loggen: een Blobs-fout kan details bevatten. Fail closed: niets half bewaard gemeld.
      console.error('gebruikers: opslag mislukt (' + (e?.name || 'Error') + ')');
      return json(503, OPSLAG_STORING);
    }
  };
  return beveiligV2('gebruikers', kern, auth ? { auth } : undefined);
}

export default maakHandler({ getStore });

export const config = { path: '/api/gebruikers' };
