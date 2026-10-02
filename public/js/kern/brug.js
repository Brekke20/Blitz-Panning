// kern/brug.js — de ENIGE module die `window` aanraakt. Moet de eerste kern-module zijn die laadt
// (staat in index.html vóór app-dialog.js en vóór app.js); modules draaien na het parsen, vóór DOMContentLoaded, in documentvolgorde.
// Het klassieke script bestaat niet meer: app.js is een module en importeert wat het nodig heeft.
import * as tijd from './tijd.js';
import * as ui from './ui.js';
import * as selecties from './selecties.js';
import * as api from './api.js';
import { installeerFetchTimeout } from './netwerk.js';
import { toestand } from './toestand.js';
import * as routeTijden from '../schermen/route-tijden.js';
import * as routeKaart from '../schermen/route-kaart.js';
import * as route from '../schermen/route.js';
import * as capaciteit from '../schermen/capaciteit.js';
import * as wachtrij from '../schermen/wachtrij.js';
import * as kalender from '../schermen/kalender.js';
import * as ingepland from '../schermen/ingepland.js';
import * as ticketdetailLogica from '../schermen/ticketdetail-logica.js';
import * as ticketdetail from '../schermen/ticketdetail.js';
import * as voorstel from '../schermen/voorstel.js';
import * as annuleren from '../schermen/annuleren.js';
import * as klantbeschikbaarheid from '../schermen/klantbeschikbaarheid.js';
import * as beschikbaarheid from '../schermen/beschikbaarheid.js';
import * as afspraken from '../schermen/afspraken.js';
import * as instellingen from '../schermen/instellingen.js';
import * as fotos from '../schermen/fotos.js';
import * as rapportVerzenden from '../schermen/rapport-verzenden.js';
import * as planacties from '../schermen/planacties.js';
import { _rapportArchief, _archiefVersie } from '../rapport-archief.js';
import { openPrijsBeheer, closePrijsBeheer, prijsReset, prijsOpslaan } from '../prijzen.js';

installeerFetchTimeout(window); // N6: time-outs op /api, buitenste laag boven de ?test-header-patch
window.kern = { tijd, ui, selecties, toestand, api };
window.kern.route = { ...routeTijden, ...routeKaart, ...route };
window.kern.capaciteit = { ...capaciteit };
window.kern.wachtrij = { ...wachtrij };
window.kern.kalender = { ...kalender };
window.kern.ingepland = { ...ingepland };
window.kern.ticketdetailLogica = { ...ticketdetailLogica };
window.kern.ticketdetail = { ...ticketdetail };
window.kern.voorstel = { ...voorstel };
window.kern.annuleren = { ...annuleren };
window.kern.klantbeschikbaarheid = { ...klantbeschikbaarheid };
window.kern.beschikbaarheid = { ...beschikbaarheid };
window.kern.afspraken = { ...afspraken };
window.kern.instellingen = { ...instellingen };
window.kern.fotos = { ...fotos };
window.kern.rapportVerzenden = { ...rapportVerzenden };
window.kern.planacties = { ...planacties };
window.kern.prijzen = { openPrijsBeheer, closePrijsBeheer, prijsReset, prijsOpslaan }; // enkel de venster-knoppen; PRIJZEN is een live `let` in prijzen.js
window.kern.rapportArchief = { lijst: () => _rapportArchief, versie: () => _archiefVersie }; // live bindings van rapport-archief.js (voor specs)
