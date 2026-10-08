// Sales-planner (server): grafstenen. Een weggeklikte lead laat enkel HMAC-hashes van zijn herkenningssleutels na
// (nooit naam, e-mail of gsm in leesbare vorm), zodat een latere export hem kan herkennen ("eerder verwijderd").
// De sleutel wordt afgeleid van SESSIE_GEHEIM; wijzigt dat geheim, dan passen oude grafstenen niet meer (aanvaard).
import { createHmac } from 'node:crypto';
import { herkenningssleutels } from '../../public/js/sales/herkenning.js';

const AFLEIDING = 'blitz-sales-grafsteen-v1';
const HASH_LENGTE = 32; // hex-tekens

const heeftGeheim = geheim => typeof geheim === 'string' && geheim !== '';

/** HMAC-SHA256 (K = HMAC(geheim, AFLEIDING)) over `<gebruikerId>|<sleutel>`; 32 hex-tekens. Gooit zonder geheim. */
export function hashSleutel(sleutel, gebruikerId, geheim) {
  if (!heeftGeheim(geheim)) throw new Error('Geheim ontbreekt voor het hashen van grafstenen');
  const K = createHmac('sha256', geheim).update(AFLEIDING).digest();
  return createHmac('sha256', K).update(`${gebruikerId}|${sleutel}`).digest('hex').slice(0, HASH_LENGTE);
}

/** De `hash`-functie voor `voegSamen` (Task 2). */
export const hashVoor = (gebruikerId, geheim) => sleutel => hashSleutel(sleutel, gebruikerId, geheim);

/**
 * -> { h: string[], op: ISO } | null. Null zonder geheim of zonder enige herkenningssleutel: dan wordt er geen grafsteen
 * bewaard (de aanroeper logt hooguit een waarschuwing zonder persoonsgegevens; de verwijdering zelf slaagt).
 */
export function maakGrafsteen(lead, { gebruikerId, nu, geheim } = {}) {
  if (!heeftGeheim(geheim)) return null;
  const sleutels = herkenningssleutels(lead);
  if (!sleutels.length) return null;
  const h = [...new Set(sleutels.map(s => hashSleutel(s, gebruikerId, geheim)))];
  return { h, op: new Date(nu).toISOString() };
}

const tijd = op => { const t = Date.parse(op); return Number.isNaN(t) ? -Infinity : t; };

/** Voegt een grafsteen toe aan de lijst (nieuwe lijst). Overlappende hashes: samenvoegen (h-vereniging, nieuwste `op`). */
export function voegGrafsteenToe(grafstenen, grafsteen) {
  const lijst = (Array.isArray(grafstenen) ? grafstenen : []).map(g => structuredClone(g));
  if (!grafsteen || !Array.isArray(grafsteen.h)) return lijst;
  const nieuw = { h: [...grafsteen.h], op: grafsteen.op };
  const overlapt = g => Array.isArray(g?.h) && g.h.some(x => nieuw.h.includes(x));
  const resultaat = [];
  let samengevoegd = false;
  for (const g of lijst) {
    if (!overlapt(g)) { resultaat.push(g); continue; }
    for (const x of g.h) if (!nieuw.h.includes(x)) nieuw.h.push(x);
    if (tijd(g.op) > tijd(nieuw.op)) nieuw.op = g.op;
    if (!samengevoegd) { resultaat.push(nieuw); samengevoegd = true; }
  }
  if (!samengevoegd) resultaat.push(nieuw);
  return resultaat;
}
