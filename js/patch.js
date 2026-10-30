// Small JSON diffs, so the host sends each player only what changed in their view.
//   diff(a, b)  -> a patch, or undefined when a and b are equal
//   apply(a, p) -> a new value equal to b (unchanged parts are shared with a, never modified)
// Patches: { v } replaces a value, { o, d } edits object keys (d = deleted keys),
// { i: [index, patch] } edits one array element, { a: [keep front, keep back, middle] } splices an array.

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const same = (x, y) => x === y || (x !== null && y !== null && typeof x === 'object' && typeof y === 'object' && diff(x, y) === undefined);

export function diff(a, b) {
  if (a === b) return undefined;
  if (isObj(a) && isObj(b)) {
    // apply() keeps a's key order and adds new keys at the end; if b's order differs, send b whole.
    const has = (x, k) => Object.prototype.hasOwnProperty.call(x, k);
    const bk = Object.keys(b), kept = bk.filter((k) => has(a, k)), ak = Object.keys(a).filter((k) => has(b, k));
    if (!kept.every((k, i) => k === ak[i] && k === bk[i])) return { v: b };
    const o = {};
    let changed = false;
    for (const k of Object.keys(b)) {
      const d = Object.prototype.hasOwnProperty.call(a, k) ? diff(a[k], b[k]) : { v: b[k] };
      if (d !== undefined) { o[k] = d; changed = true; }
    }
    const d = Object.keys(a).filter((k) => !Object.prototype.hasOwnProperty.call(b, k));
    if (!changed && !d.length) return undefined;
    return d.length ? { o, d } : { o };
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    let p = 0;
    while (p < a.length && p < b.length && same(a[p], b[p])) p++;
    if (p === a.length && p === b.length) return undefined;
    let q = 0;
    while (q < a.length - p && q < b.length - p && same(a[a.length - 1 - q], b[b.length - 1 - q])) q++;
    // One element changed in place (a player's score, one square): patch just that element.
    if (a.length === b.length && a.length - p - q === 1 && a[p] !== null && typeof a[p] === 'object') return { i: [p, diff(a[p], b[p])] };
    return { a: [p, q, b.slice(p, b.length - q)] };
  }
  return { v: b };
}

export function apply(a, p) {
  if (p === undefined) return a;
  if ('v' in p) return p.v;
  if (p.o) {
    const out = { ...a };
    for (const k of Object.keys(p.o)) out[k] = apply(a?.[k], p.o[k]);
    for (const k of p.d || []) delete out[k];
    return out;
  }
  if (p.i) { const out = a.slice(); out[p.i[0]] = apply(a[p.i[0]], p.i[1]); return out; }
  const [front, back, middle] = p.a;
  return [...a.slice(0, front), ...middle, ...a.slice(a.length - back)];
}
