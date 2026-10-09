// schermen/afspraken-logica.js — pure delen van de eigen afspraken en de import (etappe 5b, D12/D18).
// De code is letterlijk uit index.html verhuisd (matchRespToPerson, de technieklijst, de reviewrijen van startImport en
// de duplicaatfilter van confirmImport); enkel de toestand is nu een parameter en het id komt van de aanroeper. Geen DOM, geen toestand.

// Fuzzy resp-matching: deelnaam in beide richtingen, case-insensitive
export function matchRespToPerson(resp, agents) {
  if (!resp || !agents?.length) return null;
  const r    = resp.toLowerCase().trim();
  const rParts = r.split(/\s+/);
  // Exacte match
  let hit = agents.find(a => a.toLowerCase() === r);
  if (hit) return hit;
  // Partial: resp bevat agentsnaam of omgekeerd
  hit = agents.find(a => {
    const aL = a.toLowerCase();
    return aL.includes(r) || r.includes(aL);
  });
  if (hit) return hit;
  // Woorddelen matchen (voornaam)
  hit = agents.find(a => {
    const aParts = a.toLowerCase().split(/\s+/);
    return aParts.some(ap => rParts.some(rp => ap === rp && rp.length > 2));
  });
  return hit || null;
}

// Alle bekende technieknamen (tickets, gepland, zonder datum en eigen afspraken), uniek en gesorteerd.
export function technieklijst(allTickets, allGepland, allPending, localEvents) {
  return [...new Set([
    ...allTickets.map(t => t.assignee),
    ...allGepland.map(t => t.assignee),
    ...allPending.map(t => t.assignee),
    ...localEvents.map(e => e.persoon).filter(Boolean),
  ])].filter(Boolean).sort();
}

// De reviewrijen van een import; `maakId` levert een uniek id per rij (crypto.randomUUID in de app).
export function bouwImportRijen(afspraken, agents, maakId) {
  return afspraken.map(a => {
    const matched = matchRespToPerson(a.resp, agents);
    return {
      id:       maakId(),
      titel:    a.titel || `${a.type || 'Afspraak'}: ${a.linkLabel || a.notitie || ''}`,
      datum:    a.datum || '',
      uur:      a.uur   || '',
      einduur:  a.einduur || '',
      type:     a.type  || 'Overige',
      persoon:  matched,
      notitie:  a.notitie || '',
      telefoon: a.telefoon || '',
      email:    a.email   || '',
      bron:     'import',
      origResp: a.resp   || '',
      _agents:  agents,  // tijdelijk voor de modal
    };
  });
}

// Duplicaten overslaan op basis van datum+titel+uur; rijen zonder datum vallen af; `_agents` wordt niet opgeslagen.
export function nieuweImportItems(pendingImport, localEvents) {
  return pendingImport.filter(a => {
    if (!a.datum) return false;
    return !localEvents.some(e =>
      e.datum === a.datum && e.titel === a.titel && e.uur === a.uur
    );
  }).map(({ _agents, ...rest }) => rest);
}

// Het adres zoals het in de fiche en op de kaart getoond wordt (B10): het adresveld, of voor geïmporteerde en oudere afspraken
// (zonder `bron`) de notitie, want daar staat hun adres in het notitieveld. Een handmatige afspraak zonder adres toont haar
// notitie als Notitie en geeft hier ''. Enkel voor de weergave: routes, kaart, capaciteit en export blijven `adres || notitie` gebruiken.
export function zichtbaarAdres(ev) {
  if (ev.adres) return ev.adres;
  return ev.bron !== 'manueel' && ev.notitie ? ev.notitie : '';
}
