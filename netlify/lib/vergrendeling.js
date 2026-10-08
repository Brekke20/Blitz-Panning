// Vergrendeling na mislukte pogingen (login en herstel). Pure functies op een staat-object plus
// blob-wrappers voor `login-pogingen`.
//
// staat = { login: { [sleutelHash]: { p: [ms…], tot?: ms } }, herstel: { … } }
// De sleutel (e-mailadres) wordt gehasht: een bestaand en een onbekend adres gedragen zich identiek,
// en een aanvaller kan de blob niet laten groeien met lange of persoonlijke strings.
import { createHash } from 'node:crypto';
import { wijzigBlob } from './blob-wijzig.js';

const BLOB = 'login-pogingen';
const MIN = 60 * 1000;
const VENSTER = 15 * MIN;
const MAX_POGINGEN = 5;
const MAX_SLEUTELS = 1000; // per soort
const SOORTEN = {
  login: { duur: 15 * MIN },
  herstel: { duur: 60 * MIN },
};

const leegStaat = () => ({ login: {}, herstel: {} });

function soortCfg(soort) {
  const cfg = SOORTEN[soort];
  if (!cfg) throw new Error(`Onbekende vergrendelingssoort: ${soort}`);
  return cfg;
}

function sleutelHash(sleutel) {
  return createHash('sha256').update(String(sleutel ?? '').trim().toLowerCase()).digest('hex').slice(0, 32);
}

const laatsteActiviteit = e => Math.max(0, e.tot ?? 0, ...(e.p ?? []));

export function isVergrendeld(staat, soort, sleutel, nuMs) {
  const e = staat?.[soort]?.[sleutelHash(sleutel)];
  if (e && typeof e.tot === 'number' && e.tot > nuMs) return { vergrendeld: true, tot: e.tot };
  return { vergrendeld: false };
}

// Nieuwe staat zonder verlopen pogingen of vergrendelingen.
function opgeschoond(staat, nuMs) {
  const uit = { ...staat };
  for (const soort of Object.keys(SOORTEN)) {
    const nieuw = {};
    for (const [k, e] of Object.entries(staat?.[soort] ?? {})) {
      const p = (e.p ?? []).filter(t => nuMs - t < VENSTER);
      const tot = typeof e.tot === 'number' && e.tot > nuMs ? e.tot : undefined;
      if (p.length || tot !== undefined) nieuw[k] = tot !== undefined ? { p, tot } : { p };
    }
    uit[soort] = nieuw;
  }
  return uit;
}

export function registreerMislukt(staat, soort, sleutel, nuMs) {
  const { duur } = soortCfg(soort);
  const k = sleutelHash(sleutel);
  const nieuw = opgeschoond(staat ?? leegStaat(), nuMs);
  const kaart = nieuw[soort];
  const huidig = kaart[k] ?? { p: [] };
  if (huidig.tot !== undefined) return { staat: nieuw, vergrendeldNu: false }; // al vergrendeld: niet verlengen
  const p = [...huidig.p, nuMs];
  let vergrendeldNu = false;
  if (p.length >= MAX_POGINGEN) {
    kaart[k] = { p: [], tot: nuMs + duur };
    vergrendeldNu = true;
  } else {
    kaart[k] = { p };
  }
  const sleutels = Object.keys(kaart);
  if (sleutels.length > MAX_SLEUTELS) {
    // oudste activiteit eerst weg (lopende vergrendelingen wegen zwaar), nooit de zonet bijgewerkte sleutel
    const weg = sleutels.filter(s => s !== k).sort((a, b) => laatsteActiviteit(kaart[a]) - laatsteActiviteit(kaart[b]));
    for (const s of weg.slice(0, sleutels.length - MAX_SLEUTELS)) delete kaart[s];
  }
  return { staat: nieuw, vergrendeldNu };
}

export function wisPogingen(staat, soort, sleutel) {
  soortCfg(soort);
  const nieuw = { ...(staat ?? leegStaat()), [soort]: { ...(staat?.[soort] ?? {}) } };
  delete nieuw[soort][sleutelHash(sleutel)];
  return nieuw;
}

export async function leesPogingen(store) {
  const blob = await store.get(BLOB, { type: 'json' });
  return blob && typeof blob === 'object' ? { ...leegStaat(), ...blob } : leegStaat();
}

// Atomair lees-wijzig-schrijf (met herhaling bij een gelijktijdige schrijver): fn(staat) -> nieuwe staat | null.
export async function wijzigPogingen(store, fn) {
  const r = await wijzigBlob(store, BLOB, {
    leeg: { versie: 0, ...leegStaat() },
    wijzig: blob => { const n = fn({ ...leegStaat(), ...blob }); return n == null ? null : { ...n }; },
  });
  return { ok: r.ok, staat: { ...leegStaat(), ...(r.waarde ?? {}) } };
}

// Overschrijft de volledige staat (voor één-op-één gebruik); verkies `wijzigPogingen` bij gelijktijdig gebruik.
export async function schrijfPogingen(store, staat) {
  await wijzigBlob(store, BLOB, { leeg: { versie: 0, ...leegStaat() }, wijzig: () => ({ ...staat }) });
}
