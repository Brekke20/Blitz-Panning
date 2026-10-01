// Privé hulp voor e2e/productie/vangnet-zelftest.spec.mjs, en enkel daarvoor: geeft de bewust uitgelokte
// meldingen terug en leegt de originelen, zodat het auto-vangnet daarna slaagt. Een test die dit
// gebruikt, moet eerst op de inhoud asserteren. Specs hebben enkel alleen-lezen weergaven; alleen hier
// komt een zelftest bij de muteerbare originelen. Elk ander bestand dat dit (of de waarnemer) raakt,
// laat tests/e2e-import-guard.test.mjs falen.
import { waarnemer, origineelVan } from '../productie-waarnemer.mjs';

export function neemGeblokkeerdeProbesOver(page, verzoeken, consoleFouten) {
  const v = origineelVan(verzoeken);
  const w = waarnemer(page.context());
  const c = consoleFouten ? origineelVan(consoleFouten) : [];
  const uit = {
    buitenHost: [...v.buitenHost],
    onverwacht: [...v.onverwacht],
    ongeoorloofd: [...w.ongeoorloofd],
    websockets: [...w.websockets],
    schrijven: w.schrijven.map(r => ({ ...r })),
    consoleFouten: [...c],
  };
  v.buitenHost.length = 0;
  v.onverwacht.length = 0;
  w.ongeoorloofd.length = 0;
  w.websockets.length = 0;
  w.schrijven.length = 0;
  c.length = 0;
  return uit;
}
