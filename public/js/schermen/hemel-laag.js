// Open dag-stijl, taak 2: de hemel achter de hele app. Zet `data-hemel` (ochtend, middag, avond of nacht; kern/hemel.js) op <html>;
// css/hemel.css tekent het verloop in #hemel. Herberekent elke 60 s (niet terwijl de pagina verborgen is) en meteen bij terugkeer
// naar de pagina, zodat de hemel na een lange afwezigheid klopt. Eenmalig geregistreerd; geen toestandsabonnement.
import { tijdstipVoor } from '../kern/hemel.js';

let gestart = false;

export function startHemel({ nu = () => new Date() } = {}) {
  if (gestart) return;
  gestart = true;
  const zet = () => {
    const t = tijdstipVoor(nu());
    const html = document.documentElement;
    if (html.getAttribute('data-hemel') !== t) html.setAttribute('data-hemel', t);
  };
  zet();
  setInterval(() => { if (!document.hidden) zet(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) zet(); });
}
