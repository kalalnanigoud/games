// Browser-side check of morph() in js/fx.js. In a page served by `node serve.js`:
//   const { checkMorph } = await import('/tools/morph-check.js'); checkMorph(3000)
// For random HTML and SVG trees A and B: after el.innerHTML = A; morph(el, B), the element must look
// exactly like el.innerHTML = B, unchanged nodes must be the same objects, and typing is kept.
import { morph } from '/js/fx.js';

export function checkMorph(rounds = 3000, seed = 7) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const TAGS = ['div', 'span', 'b', 'p', 'button', 'ul', 'li', 'section'];
  const ATTRS = [['class', ['a', 'b', 'a b', 'c']], ['title', ['x', 'y']], ['data-act', ['go', 'stop']], ['style', ['color:red', 'opacity:.5']]];
  const keys = () => (rnd() < 0.35 ? ` data-k="k${Math.floor(rnd() * 6)}"` : '');
  const attrs = () => ATTRS.filter(() => rnd() < 0.4).map(([n, v]) => ` ${n}="${pick(v)}"`).join('');
  function html(depth) {
    let out = '';
    for (let i = Math.floor(rnd() * 4); i >= 0; i--) {
      const r = rnd();
      if (r < 0.25) out += pick(['hello', 'world', '3', '']);
      else if (r < 0.32 && depth < 3) out += `<svg viewBox="0 0 10 10"${keys()}>${svg(depth + 1)}</svg>`;
      else if (r < 0.37) out += `<input${keys()} value="${pick(['', 'a', 'b'])}"${rnd() < 0.3 ? ' type="checkbox" checked' : ''}>`;
      else if (depth < 4) { const t = pick(TAGS); out += `<${t}${keys()}${attrs()}>${html(depth + 1)}</${t}>`; }
    }
    return out;
  }
  function svg(depth) {
    let out = '';
    for (let i = Math.floor(rnd() * 3); i >= 0; i--) {
      const r = rnd();
      if (r < 0.4) out += `<circle${keys()} cx="${Math.floor(rnd() * 9)}" r="2" fill="${pick(['red', 'blue'])}"/>`;
      else if (r < 0.7) out += `<rect${keys()} x="1" y="${Math.floor(rnd() * 9)}" width="3" height="3"/>`;
      else if (depth < 4) out += `<g${keys()}${rnd() < 0.5 ? ' opacity=".5"' : ''}>${svg(depth + 1)}</g>`;
    }
    return out;
  }
  // morph keys on data-k, so a key may appear only once among siblings (as in the games).
  const dedupe = (text) => { const t = document.createElement('template'); t.innerHTML = text;
    const walk = (n) => { const seen = new Set(); for (const c of [...n.childNodes]) { const k = c.getAttribute?.('data-k'); if (k) { if (seen.has(k)) c.removeAttribute('data-k'); seen.add(k); } walk(c); } };
    walk(t.content); return t.innerHTML; };
  const host = document.createElement('div'); document.body.appendChild(host);
  const fails = []; let kept = 0, total = 0;
  for (let i = 0; i < rounds && fails.length < 5; i++) {
    const a = dedupe(html(0)), b = dedupe(html(0));
    host.innerHTML = a;
    const before = new Set(host.querySelectorAll('*'));
    morph(host, b);
    const ref = document.createElement('div'); ref.innerHTML = b;
    if (host.innerHTML !== ref.innerHTML) fails.push({ a, b, got: host.innerHTML, want: ref.innerHTML });
    for (const el of host.querySelectorAll('*')) { total++; if (before.has(el)) kept++; }
    // Namespaces must match the parser's: compare every element's namespace in order.
    const ns = (root) => [...root.querySelectorAll('*')].map((e) => e.namespaceURI).join();
    if (ns(host) !== ns(ref)) fails.push({ a, b, namespaces: true });
  }
  // The realistic case: a move changes a small part of a big board, so almost every node is kept.
  let similarKept = 0, similarTotal = 0;
  for (let i = 0; i < 200; i++) {
    const a = dedupe(html(0) + html(0) + html(0));
    host.innerHTML = a;
    const before = new Set(host.querySelectorAll('*'));
    const t = document.createElement('template'); t.innerHTML = a;
    const els = t.content.querySelectorAll('*');
    if (els.length) { const e = els[Math.floor(rnd() * els.length)]; e.setAttribute('class', 'changed' + i); }
    morph(host, t.innerHTML);
    if (host.innerHTML !== t.innerHTML) fails.push({ similar: true, want: t.innerHTML, got: host.innerHTML });
    for (const el of host.querySelectorAll('*')) { similarTotal++; if (before.has(el)) similarKept++; }
  }
  // A field being typed in keeps its text when the board around it updates.
  host.innerHTML = '<p>1</p><input id="typing" value="">';
  const field = host.querySelector('#typing'); field.focus(); field.value = 'half a wo';
  morph(host, '<p>2</p><input id="typing" value="">');
  const typing = host.querySelector('#typing') === field && field.value === 'half a wo' && document.activeElement === field;
  // An SVG container keeps shapes in the SVG namespace.
  const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); host.replaceChildren(svgEl);
  morph(svgEl, '<g><circle r="1"/></g>');
  const svgOk = svgEl.querySelector('circle')?.namespaceURI === 'http://www.w3.org/2000/svg';
  host.remove();
  return { rounds, fails, keptShare: total ? Math.round((kept / total) * 100) : 0, similarKeptShare: similarTotal ? Math.round((similarKept / similarTotal) * 100) : 0, typing, svgOk };
}
