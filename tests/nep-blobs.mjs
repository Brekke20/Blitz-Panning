// Testhulp: een in-geheugen nep van een Netlify Blobs-store (geen *.test.mjs, wordt niet als test gedraaid).
// `_data` is een Map sleutel -> tekst; `_schrijfacties` logt elke schrijf/verwijder (voor spy-controles).
export function maakNepStore(begin = {}) {
  const data = new Map();
  const schrijfacties = [];
  const tekst = w => {
    if (typeof w === 'string') return w;
    if (w instanceof ArrayBuffer) return Buffer.from(w).toString('utf8');
    if (ArrayBuffer.isView(w)) return Buffer.from(w.buffer, w.byteOffset, w.byteLength).toString('utf8');
    return JSON.stringify(w);
  };
  for (const [k, w] of Object.entries(begin)) data.set(k, tekst(w));
  return {
    _data: data,
    _schrijfacties: schrijfacties,
    async get(key, { type = 'text' } = {}) {
      if (!data.has(key)) return null;
      const t = data.get(key);
      if (type === 'json') return JSON.parse(t);
      if (type === 'arrayBuffer') {
        const b = Buffer.from(t, 'utf8');
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
      }
      return t;
    },
    async set(key, waarde) { schrijfacties.push({ op: 'set', key }); data.set(key, tekst(waarde)); },
    async setJSON(key, obj) { schrijfacties.push({ op: 'setJSON', key }); data.set(key, JSON.stringify(obj)); },
    async delete(key) { schrijfacties.push({ op: 'delete', key }); data.delete(key); },
    async list({ prefix = '' } = {}) {
      return { blobs: [...data.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })) };
    },
  };
}
