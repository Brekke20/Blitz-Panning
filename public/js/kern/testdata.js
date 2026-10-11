// kern/testdata.js — dummy-data voor de testmodus (?test): puur, geen window/DOM.
// Letterlijk uit het klassieke script van index.html (etappe 5b, taak 8); enkel `Date.now()`/`new Date()` is
// de parameter `nu` geworden, zodat de e2e-stub dezelfde data vanuit een vaste klok kan berekenen (D6).
export function maakDummyData(nu = Date.now()) {
  const DUMMY_DATA = {
    tickets: [
      { id:'t1', number:'1001', subject:'Laadpaal offline na stroomuitval', status:'Service in te plannen', priority:'high', assignee:'Tim', contact:'Jan Peeters', email:'jan@test.be', phone:'0475123456', account:'EV Park Geel', address:'Antwerpseweg 50, 2440 Geel', hasAddress:true, _lat:51.1620, _lon:4.9890, naamEindklant:'Jan Peeters', emailEindklant:'jan@test.be', telefoonEindklant:'0475123456', serienummer:'CHARX-2291', partner:'Proxes', probleemtype:'Verbindingsfout', regio:'Kempen', interventieDatum: (() => { const d = new Date(nu); d.setDate(d.getDate()-2); return d.toISOString(); })(), createdTime:'2026-06-18T08:00:00Z' },
      { id:'t2', number:'1002', subject:'Controller reageert niet op OCPP commando', status:'Service in te plannen', priority:'medium', assignee:'Tim', contact:'Marie Claes', email:'marie@test.be', phone:'0476234567', account:'Parking Hasselt', address:'Kuringersteenweg 12, 3500 Hasselt', hasAddress:true, _lat:50.9307, _lon:5.3325, naamEindklant:'Marie Claes', emailEindklant:'marie@test.be', telefoonEindklant:'0476234567', serienummer:'CHARX-1844', partner:'', probleemtype:'OCPP fout', regio:'Limburg', interventieDatum:null, createdTime:'2026-06-20T10:00:00Z' },
      { id:'t3', number:'1003', subject:'Laadstation geeft foutcode E05', status:'Service in te plannen', priority:'low', assignee:'Roel', contact:'', email:'', phone:'', account:'Residentie Turnhout', address:'', hasAddress:false, naamEindklant:'', emailEindklant:'', telefoonEindklant:'', serienummer:'', partner:'', probleemtype:'Foutcode', regio:'', interventieDatum:null, createdTime:'2026-06-21T09:00:00Z' },
    ],
    pendingTickets: [
      { id:'p1', number:'1004', subject:'Energiemeting klopt niet', status:'Wachten op bevestiging planning', priority:'medium', assignee:'Tim', contact:'Luc Wouters', email:'luc@test.be', phone:'0477345678', account:'Industrie Beringen', address:'Koerselsesteenweg 88, 3580 Beringen', hasAddress:true, _lat:51.0490, _lon:5.2260, naamEindklant:'Luc Wouters', emailEindklant:'luc@test.be', telefoonEindklant:'0477345678', serienummer:'CHARX-3301', partner:'', probleemtype:'Metering', regio:'Limburg', interventieDatum: (() => { const d = new Date(nu); d.setDate(d.getDate()+2); return d.toISOString(); })(), createdTime:'2026-06-15T08:00:00Z' },
      { id:'p2', number:'1005', subject:'Firmware update mislukt', status:'Wachten op bevestiging planning', priority:'high', assignee:'Tim', contact:'Sara Mertens', email:'sara@test.be', phone:'0478456789', account:'Kantoorpark Mechelen', address:'Battelsesteenweg 455, 2800 Mechelen', hasAddress:true, _lat:51.0259, _lon:4.4776, naamEindklant:'Sara Mertens', emailEindklant:'sara@test.be', telefoonEindklant:'0478456789', serienummer:'CHARX-2987', partner:'', probleemtype:'Firmware', regio:'', interventieDatum:null, createdTime:'2026-06-14T08:00:00Z' },
    ],
    plannedTickets: [
      { id:'g1', number:'1006', subject:'Periodiek onderhoud laadpalen', status:'Geplande service', priority:'low', assignee:'Tim', contact:'Peter Van den Berg', email:'peter@test.be', phone:'0479567890', account:'Shopping Antwerpen', address:'Groenplaats 1, 2000 Antwerpen', hasAddress:true, _lat:51.2194, _lon:4.4013, naamEindklant:'Peter Van den Berg', emailEindklant:'peter@test.be', telefoonEindklant:'0479567890', serienummer:'CHARX-0012', partner:'', probleemtype:'Onderhoud', regio:'Antwerpen', interventieDatum: (() => { const d = new Date(nu); d.setDate(d.getDate()+4); return d.toISOString(); })(), createdTime:'2026-06-10T08:00:00Z' },
    ],
  };

  // Wachttijd-testdata: 1, 10 en 25 dagen geleden (relatief t.o.v. nu).
  DUMMY_DATA.tickets.forEach((t, i) => {
    t.inPlanningSinds = new Date(nu - [1, 10, 25][i % 3] * 86400000).toISOString();
  });
  return DUMMY_DATA;
}
