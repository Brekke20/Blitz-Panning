// netlify/themas/pakketten.js — de voorgeladen themapakketten (de server zaait ze bij de eerste lezing in de opslag; spec §4).
// Elk pakket staat als `<id>.blitzthema.json` naast dit bestand; deze lijst is de enige plek die ze kent. Elk pakket moet door
// `valideerPakket` (public/js/kern/themapakket-validatie.js); `tests/themas-pakketten.test.mjs` dwingt dat af.
//
// ---- Afspraak voor de skin-extra's (`spelskin.extra` wijst naar een vorm in `vormen`) ----
// De vorm van een extra (hoed, muts, ...) wordt in Blitz Run getekend BOVEN OP de laadpaal, met `Path2D`. De coördinaten zijn
// eenheden van de paal, niet pixels:
//   - x: 0 = linkerkant van de paal, 100 = rechterkant (100 eenheden = de breedte `bw`);
//   - y: 0 = bovenkant van de paal, 100 = onderkant (100 eenheden = de hoogte `bh`); een hoed boven de paal heeft dus NEGATIEVE y;
//   - waarden buiten 0 tot 100 mogen (een hoedrand steekt links en rechts uit). `viewBox` omvat de hele tekening en dient enkel
//     voor een voorbeeld buiten het spel; de tekenaar in het spel negeert hem.
// Tekenen (taak 8): per deel `Path2D` van `d`, verplaatst en geschaald met `bw / 100` en `bh / 100` (bv. via `addPath` met een
// matrix `{ a: bw / 100, d: bh / 100, e: x, f: top }`, zodat enkel de meetkunde meeschaalt), daarna vullen met `vul` en/of
// strepen met `lijn`. `lijnDikte` is in SCHERMPIXELS (niet geschaald). Een deel zonder `vul` wordt niet gevuld. Enkel `path`-delen
// komen in een extra voor (de test dwingt dat af), dus er is geen omzetting van andere soorten nodig. Er is geen animatie: de oude
// canvascode liet de hoedtop en de pompon meewiebelen met de tijd; dat vervalt (een vorm is statisch).
// Bukken: `tekenPaal` geeft bij een bukkende paal al de platgedrukte `bw` en `bh` (breedte x 32/18, hoogte x 30/52) mee, dezelfde
// transformatie dus; de extra volgt de paal vanzelf, zonder aparte `bukken`-tak. (De oude code gebruikte bij bukken een grotere
// hoogtefractie voor de hoed; de nieuwe hoed is bij bukken daardoor wat platter.) Een cirkel in de oorspronkelijke tekening, zoals
// de pompon van de kerstmuts, is hier een ellips met rx = 11 en ry = 3,8 eenheden: een cirkel voor de staande paal (18 breed, 52 hoog).
import halloween from './halloween.blitzthema.json' with { type: 'json' };
import kerst from './kerst.blitzthema.json' with { type: 'json' };

export const VOORGELADEN = Object.freeze([halloween, kerst]);
