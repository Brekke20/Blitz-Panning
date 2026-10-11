// Verzoekhulp die werkt voor zowel een v1-event ({ headers: {...} }) als een v2-Request.

export function kop(reqOfEvent, naam) {
  const headers = reqOfEvent?.headers;
  if (!headers) return undefined;
  if (typeof headers.get === 'function') return headers.get(naam) ?? undefined;
  const gezocht = String(naam).toLowerCase();
  for (const sleutel of Object.keys(headers)) {
    if (sleutel.toLowerCase() === gezocht) return headers[sleutel];
  }
  return undefined;
}

export function leesCookie(reqOfEvent, naam) {
  const cookieKop = kop(reqOfEvent, 'cookie');
  if (!cookieKop) return undefined;
  for (const deel of cookieKop.split(';')) {
    const i = deel.indexOf('=');
    if (i < 0) continue;
    if (deel.slice(0, i).trim() === naam) return deel.slice(i + 1).trim();
  }
  return undefined;
}
