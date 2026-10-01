// Privé hulp voor e2e/productie/vangnet-zelftest.spec.mjs, en enkel daarvoor: geeft de bewust uitgelokte,
// geblokkeerde verzoeken terug en leegt ze, zodat het auto-vangnet daarna slaagt. Een test die dit
// gebruikt, moet eerst op de inhoud asserteren. Elk ander bestand dat dit (of de waarnemer) raakt,
// laat tests/e2e-import-guard.test.mjs falen.
import { waarnemer } from '../productie-waarnemer.mjs';

export function neemGeblokkeerdeProbesOver(page, verzoeken) {
  const w = waarnemer(page.context());
  const uit = {
    buitenHost: [...verzoeken.buitenHost],
    ongeoorloofd: [...w.ongeoorloofd],
    websockets: [...w.websockets],
    schrijven: w.schrijven.map(r => ({ ...r })),
  };
  verzoeken.buitenHost.length = 0;
  w.ongeoorloofd.length = 0;
  w.websockets.length = 0;
  w.schrijven.length = 0;
  return uit;
}
