// Installatie van de echte service worker (etappe 7, N21): na het eerste bezoek staat de volledige schil in de hoofdcache en staan de
// vaste CDN-URL's in de externe cache; /api staat nergens in een cache.
import { test, expect, SHELL, CDN_VAST, CDN_LUI, CACHE_NAME, EXTERN_CACHE } from '../sw-hulp.mjs';

test('Installatie: alle SHELL-bestanden in de hoofdcache, alle CDN_VAST behalve de luie (ExcelJS) in de externe cache, geen /api', async ({ page, sw }) => {
  await sw.start();
  const urls = await sw.cacheUrls();
  expect(Object.keys(urls).sort()).toEqual([CACHE_NAME, EXTERN_CACHE].sort());
  const hoofd = urls[CACHE_NAME].map(u => new URL(u).pathname);
  for (const p of SHELL) expect(hoofd, p).toContain(p);
  // De externe cache bevat alle vaste CDN-URL's, plus hoogstens Google Fonts (stale-while-revalidate, ook gestubd); niets anders.
  for (const u of CDN_VAST.filter(x => !CDN_LUI.includes(x))) expect(urls[EXTERN_CACHE], u).toContain(u);
  // Fix-ronde 1: CDN_LUI is leeg; ExcelJS (in CDN_VAST) staat dus ook in de externe cache.
  expect(CDN_LUI).toEqual([]);
  const extra = urls[EXTERN_CACHE].filter(u => !CDN_VAST.includes(u));
  expect(extra.filter(u => !/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u)), 'onverwachte extra externe URL').toEqual([]);
  for (const lijst of Object.values(urls)) expect(lijst.filter(u => new URL(u).pathname.startsWith('/api')), '/api in een cache').toEqual([]);
});
