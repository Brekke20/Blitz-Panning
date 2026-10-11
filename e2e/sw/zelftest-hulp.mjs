// Privé hulp voor e2e/sw/vangnet-zelftest.spec.mjs, en enkel daarvoor: neemt de bewust uitgelokte meldingen van de sloten over
// (productie-vangnet + SW-waarnemer) en leegt de originelen, zodat het auto-vangnet daarna slaagt. Een test die dit gebruikt,
// moet eerst op de inhoud asserteren. Elk ander bestand dat dit raakt, laat tests/e2e-import-guard.test.mjs falen.
import { neemOvertredingenOver } from '../sw-waarnemer.mjs';
import { neemGeblokkeerdeProbesOver } from '../productie/zelftest-hulp.mjs';

export function neemSwProbesOver(page, verzoeken, consoleFouten) {
  const basis = neemGeblokkeerdeProbesOver(page, verzoeken, consoleFouten);
  return { ...basis, swOvertredingen: neemOvertredingenOver(page.context()) };
}
