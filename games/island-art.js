// Creature Island art: every character, creature, boss, prop, item and icon, drawn procedurally with Canvas 2D.
// createArt(res) returns getters for lazily cached sprites rendered at `res` device px per world px.
// Style: warm gradients lit from the top-left, a soft rim light, and a navy outline added around each silhouette.
// No images, fonts or emoji; avoids ctx.filter, letterSpacing, reset() and roundRect so Safari 15 draws it the same.

const OUT = '#1b2440';
const TAU = Math.PI * 2;
const INK = 'rgba(27,36,64,0.9)';
const CREAM = '#fff8e6';

// ---------- colour ----------
const RGB = new Map();
function rgb(h) {
  let v = RGB.get(h);
  if (v) return v;
  let s = h.slice(1);
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  const n = parseInt(s, 16);
  v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  RGB.set(h, v);
  return v;
}
function mix(a, b, t) {
  const A = rgb(a), B = rgb(b);
  let o = '#';
  for (let i = 0; i < 3; i++) o += Math.round(A[i] + (B[i] - A[i]) * t).toString(16).padStart(2, '0');
  return o;
}
const lt = (c, t = 0.35) => mix(c, '#fff8ea', t);
const dk = (c, t = 0.3) => mix(c, '#222a4c', t);
const al = (c, a) => { const v = rgb(c); return `rgba(${v[0]},${v[1]},${v[2]},${a})`; };

// FLIP is -1 while a mirrored view is drawn, so highlights stay on the top-left of the finished sprite.
let FLIP = 1;

// ---------- paths ----------
function E(c, x, y, rx, ry = rx, rot = 0) { c.beginPath(); c.ellipse(x, y, Math.max(rx, 0.01), Math.max(ry, 0.01), rot, 0, TAU); }
function P(c, a, close = true) {
  c.beginPath(); c.moveTo(a[0], a[1]);
  for (let i = 2; i < a.length; i += 2) c.lineTo(a[i], a[i + 1]);
  if (close) c.closePath();
}
// Smooth curve through the points of a flat [x, y, x, y...] list (Catmull-Rom as Béziers).
function S(c, a, close = true, k = 1, move = true) {
  const n = a.length / 2;
  const q = (i) => { i = close ? (i + n) % n : Math.max(0, Math.min(n - 1, i)); return i * 2; };
  if (move) { c.beginPath(); c.moveTo(a[0], a[1]); } else c.lineTo(a[0], a[1]);
  const m = close ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const p0 = q(i - 1), p1 = q(i), p2 = q(i + 1), p3 = q(i + 2);
    c.bezierCurveTo(a[p1] + (a[p2] - a[p0]) / 6 * k, a[p1 + 1] + (a[p2 + 1] - a[p0 + 1]) / 6 * k,
      a[p2] - (a[p3] - a[p1]) / 6 * k, a[p2 + 1] - (a[p3 + 1] - a[p1 + 1]) / 6 * k, a[p2], a[p2 + 1]);
  }
  if (close) c.closePath();
}
function RR(c, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  c.beginPath(); c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
// Scalloped edge along an ellipse from angle a0 to a1 (bumps bulge outward); continues the current path.
function scallop(c, cx, cy, rx, ry, a0, a1, n, amp, move) {
  const pt = (a, k) => [cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k];
  const s = pt(a0, 1);
  if (move) { c.beginPath(); c.moveTo(s[0], s[1]); } else c.lineTo(s[0], s[1]);
  for (let i = 0; i < n; i++) {
    const a = a0 + (a1 - a0) * (i + 0.5) / n, b = a0 + (a1 - a0) * (i + 1) / n;
    const m = pt(a, 1 + amp), e = pt(b, 1);
    c.quadraticCurveTo(m[0], m[1], e[0], e[1]);
  }
}
// Leaf/petal shape from (x0,y0) to (x1,y1) with half-width w.
function leafPath(c, x0, y0, x1, y1, w, bend = 0) {
  const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
  const mx = (x0 + x1) / 2 + nx * bend, my = (y0 + y1) / 2 + ny * bend;
  c.beginPath(); c.moveTo(x0, y0);
  c.quadraticCurveTo(mx + nx * w * 1.25, my + ny * w * 1.25, x1, y1);
  c.quadraticCurveTo(mx - nx * w * 1.25, my - ny * w * 1.25, x0, y0);
  c.closePath();
}
// Flame tongue rising from (x, y) to height h, width w, leaning by `lean`.
function flamePath(c, x, y, w, h, lean = 0) {
  c.beginPath(); c.moveTo(x, y + w * 0.15);
  c.bezierCurveTo(x - w * 1.1, y - h * 0.05, x - w * 0.7, y - h * 0.62, x + lean, y - h);
  c.bezierCurveTo(x + w * 0.35 + lean * 0.3, y - h * 0.6, x + w * 1.15, y - h * 0.25, x, y + w * 0.15);
  c.closePath();
}
function star(c, x, y, r, r2, n = 5, rot = -Math.PI / 2) {
  c.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = rot + i * Math.PI / n, rr = i % 2 ? r2 : r;
    if (i) c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); else c.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  c.closePath();
}
function bolt(c, x, y, s, rot = 0) {
  c.save(); c.translate(x, y); c.rotate(rot); c.scale(s, s);
  P(c, [1.5, -5, -2.2, 0.6, 0.2, 0.6, -1.4, 5, 2.4, -1, 0, -1, 1.5, -5]);
  c.restore();
}

// ---------- fills ----------
// Radial fill lit from the top-left for a part centred at (x, y) with radius r.
function G(c, x, y, r, col, hi = 0.42, lo = 0.3) {
  const g = c.createRadialGradient(x - r * 0.42 * FLIP, y - r * 0.5, r * 0.06, x - r * 0.12 * FLIP, y - r * 0.12, r * 1.3);
  g.addColorStop(0, lt(col, hi)); g.addColorStop(0.5, col); g.addColorStop(1, dk(col, lo));
  return g;
}
function L(c, x0, y0, x1, y1, ...stops) {
  const g = c.createLinearGradient(x0, y0, x1, y1);
  stops.forEach((s, i) => g.addColorStop(i / Math.max(1, stops.length - 1), s));
  return g;
}
function RG(c, x, y, r, ...stops) {
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  stops.forEach((s, i) => g.addColorStop(i / Math.max(1, stops.length - 1), s));
  return g;
}
const F = (c, s) => { c.fillStyle = s; c.fill(); };
function K(c, w = 1, col = INK) { c.lineWidth = w; c.strokeStyle = col; c.lineJoin = 'round'; c.lineCap = 'round'; c.stroke(); }
// Fill the current path with a lit gradient and ink its edge.
function FK(c, col, x, y, r, w = 1) { F(c, G(c, x, y, r, col)); if (w) K(c, w); }
function ball(c, x, y, rx, ry, col, w = 1, rot = 0) { E(c, x, y, rx, ry, rot); FK(c, col, x, y, Math.max(rx, ry), w); }
// A thick rounded stroke with an inked edge (arms, stalks, stems).
function limb(c, a, w, col, smooth = false) {
  if (smooth) S(c, a, false); else P(c, a, false);
  c.lineCap = 'round'; c.lineJoin = 'round';
  c.lineWidth = w + 1.8; c.strokeStyle = INK; c.stroke();
  c.lineWidth = w; c.strokeStyle = col; c.stroke();
}
function shine(c, x, y, rx, ry, a = 0.55, rot = 0) { E(c, x, y, rx, ry, rot); F(c, `rgba(255,255,255,${a})`); }
function glow(c, x, y, r, col, a = 0.6) { c.beginPath(); c.arc(x, y, r, 0, TAU); c.fillStyle = RG(c, x, y, r, al(col, a), al(col, a * 0.35), al(col, 0)); c.fill(); }

// Eyes: big and glossy. st = open | closed (sleep arcs) | happy (^ arcs) | hurt (> <) | swirl | angry (open with a brow).
function eye(c, x, y, rx, ry, iris = '#2a2140', st = 'open', side = 1) {
  const w = Math.max(0.85, rx * 0.5);
  if (st === 'closed') { c.beginPath(); c.arc(x, y - ry * 0.35, rx * 1.05, 0.12 * Math.PI, 0.88 * Math.PI); K(c, w); return; }
  if (st === 'happy') { c.beginPath(); c.arc(x, y + ry * 0.45, rx * 1.05, 1.15 * Math.PI, 1.85 * Math.PI); K(c, w); return; }
  if (st === 'hurt') { P(c, [x - rx * side, y - ry * 0.7, x + rx * 0.9 * side, y, x - rx * side, y + ry * 0.7], false); K(c, w); return; }
  if (st === 'swirl') {
    c.beginPath();
    for (let t = 0; t <= 3.2 * Math.PI; t += 0.3) { const r = 0.2 + t * rx * 0.11; const px = x + Math.cos(t) * r, py = y + Math.sin(t) * r * (ry / rx); if (t) c.lineTo(px, py); else c.moveTo(px, py); }
    K(c, Math.max(0.7, rx * 0.34)); return;
  }
  E(c, x, y, rx, ry); F(c, L(c, x, y - ry, x, y + ry, '#121830', iris));
  E(c, x - rx * 0.3 * FLIP, y - ry * 0.36, rx * 0.46, ry * 0.36); F(c, '#ffffff');
  E(c, x + rx * 0.38 * FLIP, y + ry * 0.44, rx * 0.2, ry * 0.16); F(c, 'rgba(255,255,255,0.8)');
  if (st === 'angry') { P(c, [x - rx * 1.25 * side, y - ry * 1.35, x + rx * 1.05 * side, y - ry * 0.75], false); K(c, w * 1.1); }
}
function blush(c, x, y, rx = 1.9, ry = 1.1, a = 0.38) { E(c, x, y, rx, ry); F(c, `rgba(255,110,130,${a})`); }

// ---------- sprite building ----------
// Three scratch canvases are reused (grown, never shrunk) so building sprites allocates only the result canvas.
const SCR = [];
function scratch(i, W, H) {
  let s = SCR[i];
  if (!s) s = SCR[i] = document.createElement('canvas');
  if (s.width < W || s.height < H) { s.width = Math.max(s.width, W); s.height = Math.max(s.height, H); }
  const c = s.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
  c.clearRect(0, 0, W, H);
  return s;
}
// Copy the W×H top-left region of a scratch canvas.
const blit = (dst, src, W, H, dx = 0, dy = 0) => dst.drawImage(src, 0, 0, W, H, dx, dy, W, H);
// spec: { w, h, ax, ay, body(ctx), under?(ctx), over?(ctx), flip?, outline?, light?, ow? } — all in world px,
// drawing functions get a context whose origin is the anchor.
function make(res, spec) {
  const W = Math.ceil(spec.w * res) + 2, H = Math.ceil(spec.h * res) + 2;
  const ax = spec.flip ? spec.w - spec.ax : spec.ax;
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const o = out.getContext('2d');
  const T = (x) => x.setTransform(spec.flip ? -res : res, 0, 0, res, 1 + ax * res, 1 + spec.ay * res);
  FLIP = spec.flip ? -1 : 1;
  try {
    // The body goes first (onto scratch) so it can record glow spots for the under/over layers.
    let b = null;
    if (spec.body) {
      b = scratch(0, W, H);
      const bc = b.getContext('2d');
      T(bc); spec.body(bc); bc.setTransform(1, 0, 0, 1, 0, 0);
      if (spec.light !== false) edgeLight(b, W, H, res, spec.light || 1);
    }
    if (spec.under) { o.save(); T(o); spec.under(o); o.restore(); }
    if (b) {
      if (spec.outline !== false) outline(o, b, W, H, res, spec.ow || 1.1);
      blit(o, b, W, H);
    }
    if (spec.over) { o.save(); T(o); spec.over(o); o.restore(); }
  } finally { FLIP = 1; }
  return { img: out, w: W / res, h: H / res, ax: ax + 1 / res, ay: spec.ay + 1 / res };
}
// Navy outline: the silhouette, tinted, stamped in a ring around itself.
function outline(dst, src, W, H, res, wpx) {
  const t = scratch(1, W, H), c = t.getContext('2d');
  blit(c, src, W, H);
  c.globalCompositeOperation = 'source-in'; c.fillStyle = OUT; c.fillRect(0, 0, W, H);
  const r = Math.max(1, wpx * res);
  const n = r < 1.6 ? 8 : r < 4.6 ? 12 : 16;
  for (let i = 0; i < n; i++) { const a = i / n * TAU; blit(dst, t, W, H, Math.cos(a) * r, Math.sin(a) * r); }
  if (r > 4.6) for (let i = 0; i < 6; i++) { const a = (i + 0.5) / 6 * TAU; blit(dst, t, W, H, Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55); }
}
// Rim light along the top-left edge of the silhouette and a soft core shade along the bottom-right.
function edgeLight(b, W, H, res, k) {
  const bc = b.getContext('2d');
  const strip = (col, dx, dy, a) => {
    const m = scratch(2, W, H), mc = m.getContext('2d');
    blit(mc, b, W, H);
    mc.globalCompositeOperation = 'source-in'; mc.fillStyle = col; mc.fillRect(0, 0, W, H);
    mc.globalCompositeOperation = 'destination-out'; blit(mc, b, W, H, dx, dy);
    bc.globalCompositeOperation = 'source-atop'; bc.globalAlpha = a; blit(bc, m, W, H);
    bc.globalAlpha = 1; bc.globalCompositeOperation = 'source-over';
  };
  const d = Math.max(0.8, 0.9 * res);
  strip('#fff4d6', d, d, 0.3 * k);
  strip('#1b2440', -d * 1.8, -d * 1.8, 0.2 * k);
}

// ---------- people ----------
const SKIN = ['#ffe0c4', '#f0bd93', '#c48656', '#85553a'];
const OUTFITS = [['#ff6b6b', 'circle'], ['#4dabf7', 'triangle'], ['#ffd43b', 'square'], ['#b197fc', 'diamond']];
const HAIRS = [['spiky', '#7c4a2b'], ['ponytail', '#2d3152'], ['buns', '#e2703a'], ['bob', '#f0c35a'], ['swept', '#d7d0f0'], ['curly', '#4b2e24']];

function emblem(c, shape, x, y, r, sx = 1) {
  c.save(); c.translate(x, y); c.scale(sx, 1); c.beginPath();
  if (shape === 'circle') c.arc(0, 0, r, 0, TAU);
  else if (shape === 'triangle') { c.moveTo(0, -r * 1.12); c.lineTo(r * 1.08, r * 0.78); c.lineTo(-r * 1.08, r * 0.78); c.closePath(); }
  else if (shape === 'square') c.rect(-r * 0.86, -r * 0.86, r * 1.72, r * 1.72);
  else { c.moveTo(0, -r * 1.22); c.lineTo(r * 0.98, 0); c.lineTo(0, r * 1.22); c.lineTo(-r * 0.98, 0); c.closePath(); }
  c.restore();
  F(c, CREAM); K(c, 0.85);
}
function hairFill(c, col) { F(c, G(c, -3 * FLIP, -6, 13, col, 0.38, 0.32)); K(c, 1); }
function hairShine(c, x, y, r, a0, a1) { c.beginPath(); c.arc(x, y, r, a0, a1); K(c, 1.3, 'rgba(255,255,255,0.42)'); }

// Hair cap for the front view: over the skull, down to the temples, closed along a fringe from right to left.
function capFront(c, fringe, smooth) {
  c.beginPath(); c.moveTo(-11.1, 3.2);
  c.bezierCurveTo(-12.3, -8.4, -6.6, -11.5, 0, -11.5);
  c.bezierCurveTo(6.6, -11.5, 12.3, -8.4, 11.1, 3.2);
  if (smooth) {
    for (let i = 0; i + 3 < fringe.length; i += 2) {
      const mx = (fringe[i] + fringe[i + 2]) / 2, my = (fringe[i + 1] + fringe[i + 3]) / 2;
      c.quadraticCurveTo(fringe[i], fringe[i + 1], mx, my);
    }
    c.lineTo(fringe[fringe.length - 2], fringe[fringe.length - 1]);
  } else for (let i = 0; i < fringe.length; i += 2) c.lineTo(fringe[i], fringe[i + 1]);
  c.closePath();
}
// Side view cap, facing left: forehead hairline at the left, nape at the right.
function capSide(c, fringe) {
  c.beginPath(); c.moveTo(-9.4, -1.4);
  c.bezierCurveTo(-9.8, -9.6, 2.8, -13.2, 9.2, -6.6);
  c.bezierCurveTo(12.6, -2, 12.2, 5.4, 8.6, 8.8);
  c.quadraticCurveTo(6, 7.6, 4.8, 4.4);
  c.quadraticCurveTo(3.6, -0.6, 0.6, -1.4);
  for (let i = 0; i < fringe.length; i += 2) c.lineTo(fringe[i], fringe[i + 1]);
  c.closePath();
}

// Each style: back(c, view) drawn behind the head, front(c, view) drawn over it. Head-local coords, head rx 10.6 ry 9.8.
const STYLES = {
  spiky: {
    back() {},
    front(c, v, col) {
      const tufts = v === 'side' ? [[2, -10.5, 8, -14.6, 7.6, -8], [5.5, -9, 12.4, -10.4, 9.4, -4.6], [-3, -10.6, 0.6, -15.2, 3.4, -10.4]]
        : [[-5, -9.6, -2.6, -15.4, 0.4, -10.8], [-0.6, -10.8, 3.4, -15.6, 5.2, -9.8], [4.6, -9.6, 9.2, -12.6, 8.4, -6.6]];
      for (const t of tufts) { P(c, t); hairFill(c, col); }
      if (v === 'front') capFront(c, [10.6, -0.6, 8.6, -4.2, 6.8, -1.2, 4.6, -4.8, 2.4, -1.4, 0.2, -5, -2.3, -1.6, -4.6, -4.8, -6.8, -1.3, -8.8, -4.4, -10.6, -0.6]);
      else if (v === 'side') capSide(c, [-1.6, -4.4, -3.6, -1.6, -5.2, -5, -7.4, -2.4, -8.6, -5.4]);
      else {
        c.beginPath(); c.moveTo(-11.4, 1); c.bezierCurveTo(-11.8, -9, -6, -11.4, 0, -11.4); c.bezierCurveTo(6, -11.4, 11.8, -9, 11.4, 1);
        const z = [9.6, 8.2, 7, 5.6, 4.6, 9.4, 2.2, 6.2, 0, 9.8, -2.2, 6.2, -4.6, 9.4, -7, 5.6, -9.6, 8.2];
        for (let i = 0; i < z.length; i += 2) c.lineTo(z[i], z[i + 1]);
        c.closePath();
      }
      hairFill(c, col);
      hairShine(c, -1, 1, 8.2, Math.PI * 1.15, Math.PI * 1.42);
    },
  },
  ponytail: {
    back(c, v, col) {
      if (v === 'front') { S(c, [7.5, 3, 12.6, 6, 13.6, 13.4, 10, 15.8, 9.4, 10, 6.4, 6], true); hairFill(c, col); }
      if (v === 'side') { S(c, [7.6, -5.4, 14.4, -3.6, 17.2, 4.4, 15, 12.6, 12.6, 7.2, 9.6, 1.6], true); hairFill(c, col); ball(c, 8.8, -4, 1.8, 2.2, '#ff8fa3', 0.8); }
    },
    front(c, v, col) {
      if (v === 'front') capFront(c, [10.6, 0.4, 9.4, -2.8, 5.6, -4.6, 1.2, -3, -2.6, -4.8, -7.4, -2.6, -10.4, 1], true);
      else if (v === 'side') capSide(c, [-1.4, -3.4, -5.6, -2.2, -9.4, -1.4]);
      else { E(c, 0, -0.8, 11.3, 10.5); }
      hairFill(c, col);
      hairShine(c, -1, 1, 8.2, Math.PI * 1.15, Math.PI * 1.42);
      if (v === 'back') {
        S(c, [-2.6, -6, 2.6, -6, 4.2, 4, 1.8, 15.4, -1.2, 15.6, -3.8, 4], true); hairFill(c, col);
        ball(c, 0, -6, 2.6, 1.8, '#ff8fa3', 0.8);
      }
    },
  },
  buns: {
    back(c, v, col) {
      if (v === 'front') { ball(c, -8.4, -9.4, 4.4, 4.2, col); ball(c, 8.4, -9.4, 4.4, 4.2, col); }
      if (v === 'side') { ball(c, 3, -11.4, 4.6, 4.4, col); }
    },
    front(c, v, col) {
      if (v === 'front') capFront(c, [10.6, 1, 9.8, -2.6, 5, -1.9, 0, -2.2, -5, -1.9, -9.8, -2.6, -10.6, 1], true);
      else if (v === 'side') capSide(c, [-1, -2.6, -5.4, -2, -9.4, -1.4]);
      else E(c, 0, -0.8, 11.3, 10.5);
      hairFill(c, col);
      hairShine(c, -1, 1, 8.2, Math.PI * 1.15, Math.PI * 1.42);
      if (v === 'back') { ball(c, -8.4, -9.4, 4.4, 4.2, col); ball(c, 8.4, -9.4, 4.4, 4.2, col); }
      if (v !== 'side') for (const s of [-1, 1]) { c.beginPath(); c.arc(s * 8.4, -9.4, 4.6, s < 0 ? 0.1 : 2.1, s < 0 ? 1.05 : 3.05); K(c, 1.2, '#ff8fa3'); }
    },
  },
  bob: {
    back() {},
    front(c, v, col) {
      if (v === 'front') {
        c.beginPath(); c.moveTo(-12, 8.6);
        c.bezierCurveTo(-13.4, -6, -7, -11.6, 0, -11.6); c.bezierCurveTo(7, -11.6, 13.4, -6, 12, 8.6);
        c.quadraticCurveTo(10.4, 9.8, 9.2, 8.2); c.lineTo(9.4, 0.6);
        c.quadraticCurveTo(8.6, -2.4, 6, -2.2); c.quadraticCurveTo(3, -1.2, 0, -2.4); c.quadraticCurveTo(-3, -1.2, -6, -2.2);
        c.quadraticCurveTo(-8.6, -2.4, -9.4, 0.6); c.lineTo(-9.2, 8.2); c.quadraticCurveTo(-10.4, 9.8, -12, 8.6); c.closePath();
      } else if (v === 'side') {
        c.beginPath(); c.moveTo(-9.6, -0.6);
        c.bezierCurveTo(-10, -10.4, 3, -13.6, 9.6, -6.8); c.bezierCurveTo(13.4, -2, 12.8, 6, 10.6, 9.4);
        c.quadraticCurveTo(6.6, 10.6, 2.6, 9); c.quadraticCurveTo(4.6, 4, 2.2, -1); c.lineTo(-3, -2.6); c.lineTo(-9.6, -0.6); c.closePath();
      } else { c.beginPath(); c.moveTo(-12, 8.6); c.bezierCurveTo(-13.4, -6, -7, -11.8, 0, -11.8); c.bezierCurveTo(7, -11.8, 13.4, -6, 12, 8.6); c.quadraticCurveTo(0, 11.6, -12, 8.6); c.closePath(); }
      hairFill(c, col);
      hairShine(c, -1, 0, 9, Math.PI * 1.12, Math.PI * 1.42);
    },
  },
  swept: {
    back(c, v, col) {
      if (v === 'front') for (const s of [-1, 1]) { S(c, [s * 9.6, -2, s * 12.8, 3, s * 13.4, 9.6, s * 12.2, 15.6, s * 10.6, 13.2, s * 9.4, 16, s * 8.2, 9], true); hairFill(c, col); }
      if (v === 'side') { S(c, [4, -8, 11.6, -6.4, 13.6, 4, 13.4, 13.6, 11.2, 11.6, 9.2, 15.2, 7, 9, 3, 4], true); hairFill(c, col); }
    },
    front(c, v, col) {
      if (v === 'front') capFront(c, [10.8, 2.2, 9.6, -1.4, 7, -3.4, 2.6, -4.4, -2.4, -2.6, -6.6, -0.6, -9.6, 0.6, -11, 3], true);
      else if (v === 'side') capSide(c, [-0.4, -2.6, -4, -0.6, -7.4, 0.2, -9.4, -1.4]);
      else { c.beginPath(); c.moveTo(-12.6, 13); c.bezierCurveTo(-14, -6, -7, -11.8, 0, -11.8); c.bezierCurveTo(7, -11.8, 14, -6, 12.6, 13); c.quadraticCurveTo(10, 16.4, 7.6, 13.6); c.quadraticCurveTo(4, 16.8, 0, 14.2); c.quadraticCurveTo(-4, 16.8, -7.6, 13.6); c.quadraticCurveTo(-10, 16.4, -12.6, 13); c.closePath(); }
      hairFill(c, col);
      hairShine(c, -1, 1, 8.4, Math.PI * 1.15, Math.PI * 1.45);
      if (v === 'back') { c.beginPath(); c.moveTo(-4, 4); c.quadraticCurveTo(-4.6, 10, -3.6, 15); c.moveTo(4, 4); c.quadraticCurveTo(4.6, 10, 3.6, 15); K(c, 0.8, al(dk(col, 0.4), 0.7)); }
    },
  },
  curly: {
    back() {},
    front(c, v, col) {
      if (v === 'front') {
        scallop(c, 0, -0.6, 12.2, 11.4, Math.PI * 0.95, Math.PI * 2.05, 9, 0.13, true);
        c.lineTo(10.2, 1.4); scallop(c, 0, 4.2, 9.6, 6.4, -Math.PI * 0.08, -Math.PI * 0.92, 6, -0.12, false); c.closePath();
      } else if (v === 'side') {
        scallop(c, 1.4, -0.6, 12, 11.2, Math.PI * 1.05, Math.PI * 2.32, 8, 0.13, true);
        c.lineTo(4, 4); c.lineTo(0.6, -1.6); scallop(c, -4.6, 2.2, 5.2, 4.6, -Math.PI * 0.2, -Math.PI * 0.95, 3, -0.15, false); c.closePath();
      } else { scallop(c, 0, -0.6, 12.2, 11.4, 0, TAU, 12, 0.12, true); c.closePath(); }
      hairFill(c, col);
      hairShine(c, -1.4, 0, 9, Math.PI * 1.15, Math.PI * 1.4);
    },
  },
  bun: { // elder: hair pulled back into a bun
    back(c, v, col) { if (v === 'front') ball(c, 0, -11.4, 5.2, 4.2, col); if (v === 'side') ball(c, 7.4, -9, 4.8, 4.6, col); },
    front(c, v, col) {
      if (v === 'front') capFront(c, [10.8, 2.4, 9.6, -2.8, 5, -5.6, 0, -4.8, -5, -5.6, -9.6, -2.8, -10.8, 2.4], true);
      else if (v === 'side') capSide(c, [-1.6, -4, -6.4, -4.4, -9.4, -1.4]);
      else E(c, 0, -0.8, 11.2, 10.4);
      hairFill(c, col);
      c.beginPath(); c.moveTo(-6, -8); c.quadraticCurveTo(0, -11, 6, -8); K(c, 0.7, al(dk(col, 0.35), 0.7));
      if (v === 'back') { ball(c, 0, -7.6, 5.4, 4.6, col); c.beginPath(); c.arc(0, -7.6, 2.6, 0.4, 4.4); K(c, 0.7, al(dk(col, 0.35), 0.8)); }
    },
  },
  short: { // merchant / fisher: neat short crop
    back() {},
    front(c, v, col) {
      if (v === 'front') capFront(c, [10.8, 1.4, 9.4, -3.6, 4, -5.2, -1.6, -4.4, -6.4, -5.4, -9.8, -3, -10.8, 1.4], true);
      else if (v === 'side') capSide(c, [-1.4, -4.8, -6.4, -4.8, -9.4, -1.4]);
      else { c.beginPath(); c.moveTo(-11.2, 3); c.bezierCurveTo(-12, -9, -6, -11.4, 0, -11.4); c.bezierCurveTo(6, -11.4, 12, -9, 11.2, 3); c.quadraticCurveTo(0, 9, -11.2, 3); c.closePath(); }
      hairFill(c, col);
      hairShine(c, -1, 1, 8.2, Math.PI * 1.18, Math.PI * 1.42);
    },
  },
};

function hat(c, h, v) {
  if (!h) return;
  const [kind, col] = h;
  const sx = v === 'side' ? -1 : 0; // side views push brims toward the face (left)
  if (kind === 'leaf') {
    const lean = v === 'side' ? -2 : 0;
    leafPath(c, -12 + lean, -6.4, 12.6 + lean, -8.6, 5.2, -1.4); FK(c, col, 0, -10, 12);
    c.beginPath(); c.moveTo(-11 + lean, -6.6); c.quadraticCurveTo(0, -10.6, 12 + lean, -8.6); K(c, 0.8, al(dk(col, 0.45), 0.9));
    for (const t of [-6, -1, 4]) { c.beginPath(); c.moveTo(t + lean, -8.6 - t * 0.04); c.lineTo(t + 2.4 + lean, -12); K(c, 0.6, al(dk(col, 0.4), 0.7)); }
    limb(c, [0.6 + lean, -12, 1.6 + lean, -15.4, 3.8 + lean, -16.4], 1.1, dk(col, 0.25), true);
  } else if (kind === 'cap') {
    if (v === 'front') { E(c, 0, -5.4, 9.6, 3.2); FK(c, dk(col, 0.12), 0, -5.4, 9); }
    if (v === 'side') { E(c, -10, -4.2, 6.4, 2.4, 0.1); FK(c, dk(col, 0.12), -10, -4.2, 6); }
    c.beginPath(); c.moveTo(-10.6, -3.6); c.bezierCurveTo(-11.4, -12.6, 11.4, -12.6, 10.6, -3.6); c.quadraticCurveTo(0, -6.4, -10.6, -3.6); c.closePath();
    FK(c, col, -2, -8, 11);
    ball(c, 0, -12, 1.4, 1, lt(col, 0.3), 0.7);
    if (v === 'back') { RR(c, -3, -5.6, 6, 2.2, 1); F(c, dk(col, 0.3)); K(c, 0.7); }
    else { E(c, v === 'side' ? -2 : 0, -8, 2.2, 1.9); F(c, CREAM); K(c, 0.7); }
  } else if (kind === 'bucket') {
    E(c, 0, -5.2, 14.2, 4.6); FK(c, dk(col, 0.08), 0, -5.2, 14);
    c.beginPath(); c.moveTo(-9.2, -5.4); c.bezierCurveTo(-9.6, -15.4, 9.6, -15.4, 9.2, -5.4); c.quadraticCurveTo(0, -3.4, -9.2, -5.4); c.closePath();
    FK(c, col, -2, -10, 10);
    c.beginPath(); c.moveTo(-9.2, -7.4); c.quadraticCurveTo(0, -5.4, 9.2, -7.4); K(c, 1.6, al('#8a5a3a', 0.95));
    if (v !== 'back') { leafPath(c, 5 + sx * 9, -8.2, 9.6 + sx * 9, -13.6, 1.4); FK(c, '#e76f51', 7, -11, 4, 0.7); }
  } else if (kind === 'band') {
    c.beginPath(); c.moveTo(-11, -2.6); c.quadraticCurveTo(0, -7.6, 11, -2.6); K(c, 2.8, INK); c.beginPath(); c.moveTo(-11, -2.6); c.quadraticCurveTo(0, -7.6, 11, -2.6); K(c, 1.6, col);
    if (v !== 'front') { limb(c, [9.6, -2, 13.4, 1.4, 14.4, 4.8], 1.4, col, true); limb(c, [9.8, -2, 13.8, -0.6, 16, 1.2], 1.4, col, true); }
  } else if (kind === 'ranger') {
    E(c, sx * 1.2, -5.6, 14.8, 4.4); FK(c, dk(col, 0.06), 0, -5.6, 14);
    c.beginPath(); c.moveTo(-8.4, -5.8); c.lineTo(-7.2, -13.6); c.quadraticCurveTo(-3.6, -12.4, 0, -14.6); c.quadraticCurveTo(3.6, -12.4, 7.2, -13.6); c.lineTo(8.4, -5.8); c.quadraticCurveTo(0, -4.2, -8.4, -5.8); c.closePath();
    FK(c, col, -2, -10, 10);
    c.beginPath(); c.moveTo(-8.2, -7.4); c.quadraticCurveTo(0, -5.8, 8.2, -7.4); K(c, 1.5, '#d9b26a');
    if (v !== 'back') { leafPath(c, 6.4 + sx * 12, -8, 12.4 + sx * 14, -17, 1.6, 1.2); FK(c, '#f4f1e8', 8, -12, 5, 0.7); }
  }
}

// Face, head-local. View front or side (left).
function face(c, H, v, p) {
  const st = p.eyes || H.eyes || 'open';
  const iris = H.iris || '#4a3020';
  if (v === 'front') {
    if (st === 'kind') { eye(c, -3.9, 2.4, 1.6, 2, iris, 'happy'); eye(c, 3.9, 2.4, 1.6, 2, iris, 'happy'); }
    else { eye(c, -3.9, 2.2, 1.75, 2.35, iris, st, 1); eye(c, 3.9, 2.2, 1.75, 2.35, iris, st, -1); }
    if (H.glasses) { c.beginPath(); c.arc(-3.9, 2.6, 2.7, 0, TAU); c.moveTo(6.6, 2.6); c.arc(3.9, 2.6, 2.7, 0, TAU); c.moveTo(-1.2, 2.2); c.lineTo(1.2, 2.2); K(c, 0.7, '#8a6a3a'); }
    blush(c, -6.7, 5.4); blush(c, 6.7, 5.4);
    mouth(c, 0, 6.4, p.mouth || 'smile');
  } else {
    if (st === 'kind') eye(c, -6.2, 2.4, 1.4, 2, iris, 'happy');
    else eye(c, -6.2, 2.2, 1.5, 2.3, iris, st, 1);
    if (H.glasses) { c.beginPath(); c.moveTo(-8.8, 1.2); c.lineTo(-6.4, 1.2); c.lineTo(1.5, 0.6); K(c, 0.7, '#8a6a3a'); }
    blush(c, -6.6, 5.4, 1.6);
    mouth(c, -8.1, 6.4, p.mouth || 'smile', 0.8);
  }
  if (H.mustache) {
    const x = v === 'side' ? -8 : 0, sc = v === 'side' ? 0.6 : 1;
    S(c, [x - 4.2 * sc, 6.2, x - 1.6 * sc, 4.4, x, 5.2, x + 1.6 * sc, 4.4, x + 4.2 * sc, 6.2, x + 1.4 * sc, 6.4, x, 5.8, x - 1.4 * sc, 6.4], true);
    FK(c, H.mustache, x, 5, 4, 0.8);
  }
  if (H.beard) {
    const x = v === 'side' ? -4 : 0;
    if (v === 'side') S(c, [-10, 5, -7, 8.6, -3.4, 13.8, 0.6, 10.6, 2.6, 6.2, -2, 5.6, -6, 6.6], true);
    else S(c, [-8.4, 4, -6, 9.8, -2.4, 14.6, 2.4, 14.6, 6, 9.8, 8.4, 4, 4, 6.4, 0, 7.2, -4, 6.4], true);
    FK(c, H.beard, x, 8, 8, 0.9);
    c.beginPath(); c.moveTo(x - 1.6, 9.4); c.quadraticCurveTo(x, 10.4, x + 1.6, 9.4); K(c, 0.6, al(dk(H.beard, 0.4), 0.8));
  }
}
function mouth(c, x, y, m, s = 1) {
  if (m === 'smile') { c.beginPath(); c.arc(x, y - 0.8 * s, 1.35 * s, 0.18 * Math.PI, 0.82 * Math.PI); K(c, 0.85); }
  else if (m === 'open') { c.beginPath(); c.moveTo(x - 1.7 * s, y - 0.6); c.quadraticCurveTo(x, y + 2.8 * s, x + 1.7 * s, y - 0.6); c.closePath(); F(c, '#7a2b3a'); K(c, 0.8); }
  else if (m === 'o') { E(c, x, y, 1.1 * s, 1.35 * s); F(c, '#7a2b3a'); K(c, 0.8); }
  else if (m === 'grit') { RR(c, x - 1.8 * s, y - 1, 3.6 * s, 1.9, 0.8); F(c, '#ffffff'); K(c, 0.8); }
  else { c.beginPath(); c.moveTo(x - 1.2 * s, y); c.lineTo(x + 1.2 * s, y); K(c, 0.85); }
}

function headDraw(c, H, v, p, withBack = true) {
  const st = STYLES[H.hair[0]], col = H.hair[1];
  if (v === 'front') {
    if (withBack) st.back(c, 'front', col);
    ball(c, -10.1, 1.3, 2.2, 2.6, H.skin, 0.9); ball(c, 10.1, 1.3, 2.2, 2.6, H.skin, 0.9);
    E(c, 0, 0, 10.6, 9.8); FK(c, H.skin, -1.5, -1, 11.5);
    face(c, H, 'front', p);
    st.front(c, 'front', col);
  } else if (v === 'side') {
    if (withBack) st.back(c, 'side', col);
    E(c, 0, 0, 10.3, 9.8); FK(c, H.skin, -2, -1, 11.5);
    face(c, H, 'side', p);
    ball(c, 3.2, 2.2, 1.7, 2.2, dk(H.skin, 0.06), 0.9);
    c.beginPath(); c.arc(3.4, 2.3, 0.9, -1.2, 1.6); K(c, 0.6, al(dk(H.skin, 0.45), 0.8));
    st.front(c, 'side', col);
  } else {
    ball(c, -10.1, 1.3, 2.2, 2.6, H.skin, 0.9); ball(c, 10.1, 1.3, 2.2, 2.6, H.skin, 0.9);
    E(c, 0, 0, 10.6, 9.8); FK(c, H.skin, -1.5, -1, 11.5);
    st.front(c, 'back', col);
  }
  hat(c, H.hat, v);
}

function torso(c, v, wd = 1) {
  c.beginPath();
  if (v === 'side') {
    c.moveTo(-4.4 * wd, -19.6); c.quadraticCurveTo(0.4, -20.8, 4.6 * wd, -19.4);
    c.quadraticCurveTo(6.2 * wd, -15.6, 6.2 * wd, -8.4); c.quadraticCurveTo(0, -7, -5.8 * wd, -8.4);
    c.quadraticCurveTo(-6 * wd, -15.6, -4.4 * wd, -19.6);
  } else {
    c.moveTo(-5.6 * wd, -19.6); c.quadraticCurveTo(0, -21, 5.6 * wd, -19.6);
    c.quadraticCurveTo(7.4 * wd, -18.4, 7.3 * wd, -14.5); c.lineTo(7.9 * wd, -8.4);
    c.quadraticCurveTo(0, -6.8, -7.9 * wd, -8.4); c.lineTo(-7.3 * wd, -14.5);
    c.quadraticCurveTo(-7.4 * wd, -18.4, -5.6 * wd, -19.6);
  }
  c.closePath();
}
function arm(c, sx, sy, hx, hy, col, skin, bend = 1, glove) {
  c.beginPath(); c.moveTo(sx, sy); c.quadraticCurveTo((sx + hx) / 2 + bend * 1.3, (sy + hy) / 2, hx, hy);
  c.lineCap = 'round'; c.lineWidth = 5.6; c.strokeStyle = INK; c.stroke();
  c.lineWidth = 3.8; c.strokeStyle = col; c.stroke();
  c.lineWidth = 1.1; c.strokeStyle = al(lt(col, 0.6), 0.55);
  c.beginPath(); c.moveTo(sx - 0.7, sy + 0.2); c.quadraticCurveTo((sx + hx) / 2 + bend * 1.3 - 0.8, (sy + hy) / 2, hx - 0.7, hy - 0.8); c.stroke();
  ball(c, hx, hy, 2, 2, glove || skin, 0.9);
}
function boot(c, x, y, col, v) {
  if (v === 'side') { S(c, [x - 3.8, y - 0.4, x - 3, y - 2.8, x + 0.4, y - 3.8, x + 2.4, y - 2.4, x + 2.2, y + 0.4, x - 1, y + 0.9], true); FK(c, col, x - 1, y - 2, 4); }
  else { S(c, [x - 3, y - 0.2, x - 2.6, y - 3.4, x, y - 4, x + 2.6, y - 3.4, x + 3, y - 0.2, x, y + 1], true); FK(c, col, x, y - 2, 4); }
  E(c, x + (v === 'side' ? -0.6 : 0), y - 3.4, v === 'side' ? 2.2 : 2.4, 0.9); F(c, lt(col, 0.35));
}
function staffDraw(c, x, y, a, len = 26, grip = 0.3) {
  const dx = Math.cos(a), dy = Math.sin(a);
  const x0 = x - dx * len * grip, y0 = y - dy * len * grip, x1 = x + dx * len * (1 - grip), y1 = y + dy * len * (1 - grip);
  limb(c, [x0, y0, x1, y1], 2.4, '#a8713e');
  c.beginPath(); c.moveTo(x0 - dy * 0.5, y0 + dx * 0.5); c.lineTo(x1 - dy * 0.5, y1 + dx * 0.5); K(c, 0.7, 'rgba(255,230,180,0.55)');
  ball(c, x1, y1, 2.6, 2.6, '#c48a4f', 0.9);
  shine(c, x1 - 0.8, y1 - 0.9, 0.9, 0.7, 0.6);
  leafPath(c, x1 - dx * 3.4, y1 - dy * 3.4, x1 - dx * 3.4 - dy * 4.6 + dx, y1 - dy * 3.4 + dx * 4.6 + dy, 1.4);
  FK(c, '#6cc04a', x1, y1, 4, 0.7);
  return [x1, y1];
}
// Translucent motion arc for swings, centred at (x, y) from angle a0 to a1.
function swoosh(c, x, y, r, a0, a1, w = 6) {
  const n = 14, dir = a1 > a0 ? 1 : -1;
  c.beginPath();
  for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
  for (let i = n; i >= 0; i--) { const a = a0 + (a1 - a0) * i / n, rr = r - w * (i / n) ** 1.4; c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  c.closePath();
  const g = c.createLinearGradient(x + Math.cos(a0) * r, y + Math.sin(a0) * r, x + Math.cos(a1) * r, y + Math.sin(a1) * r);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,250,225,0.8)');
  c.fillStyle = g; c.fill();
  c.beginPath();
  for (let i = Math.floor(n * 0.4); i <= n; i++) { const a = a0 + (a1 - a0) * i / n; c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
  c.lineWidth = 1; c.strokeStyle = 'rgba(255,255,255,0.9)'; c.stroke();
  void dir;
}

// A chibi person. H: look/config. v: front | back | side (facing left). p: pose.
function human(c, H, v, p) {
  const wd = H.wide || 1, by = p.bob || 0, sk = H.skin;
  const coat = H.coat, cape = H.cape;
  const fl = p.fl || [0, 0], fr = p.fr || [0, 0];
  const staff = p.staff;
  c.save();
  if (H.scale) c.scale(H.scale, H.scale);
  if (p.rot) c.rotate(p.rot);
  if (staff && staff.layer === 'back') staffDraw(c, staff.x, staff.y + by, staff.a);
  const hx = (p.hdx || 0) + (H.hunch && v === 'side' ? -2 : 0), hy = by + (p.hdy || 0) + (H.hunch ? 1.6 : 0);
  if (v === 'front') {
    if (H.pack) pack(c, H, 'front', by);
    if (cape) { P(c, [-6.4, -19.6 + by, -9.6, -8.6 + by, -6, -7.6 + by, 6, -7.6 + by, 9.6, -8.6 + by, 6.4, -19.6 + by]); FK(c, cape, 0, -14, 10); }
    c.save(); c.translate(hx, -28.6 + hy); STYLES[H.hair[0]].back(c, 'front', H.hair[1]); c.restore();
    for (const s of [-1, 1]) {
      const f = s < 0 ? fl : fr, x = s * 3.3 + f[0];
      if (!H.dress) { RR(c, x - 2.1, -9.6 + by, 4.2, 7 + f[1] - by, 1.6); FK(c, H.pants, x, -6, 5, 0.9); }
      boot(c, x, -0.6 + f[1], H.boots, 'front');
    }
    if (H.dress) { P(c, [-6.6, -12 + by, 6.6, -12 + by, 9, -2.6, 0, -1.2, -9, -2.6]); FK(c, H.dress, -1, -8, 9); c.beginPath(); c.moveTo(-8.6, -3.4); c.quadraticCurveTo(0, -1.6, 8.6, -3.4); K(c, 1.1, al(lt(H.dress, 0.5), 0.9)); }
    c.save(); c.translate(0, by);
    torso(c, 'front', wd); FK(c, coat, -1, -15, 10);
    if (H.vest) { P(c, [-7.4 * wd, -14.5, -5.4 * wd, -19.8, -2, -19.6, -1.6, -7.2, -7.9 * wd, -8.4]); FK(c, H.vest, -5, -14, 6, 0.8); P(c, [7.4 * wd, -14.5, 5.4 * wd, -19.8, 2, -19.6, 1.6, -7.2, 7.9 * wd, -8.4]); FK(c, H.vest, 5, -14, 6, 0.8); }
    if (H.apron) { P(c, [-4.8, -16.4, 4.8, -16.4, 6.2, -7.4, -6.2, -7.4]); FK(c, H.apron, -1, -12, 7, 0.8); leafPath(c, -1.4, -10, 1.6, -14.2, 1.4); FK(c, '#5fbf6a', 0, -12, 3, 0.6); }
    P(c, [-3.2, -19.9, 3.2, -19.9, 0, -17.6]); F(c, H.trim || CREAM); K(c, 0.7);
    if (H.emblem) emblem(c, H.emblem, 0, -13.8, 2.7);
    if (!H.dress && !H.apron) { RR(c, -7.6 * wd, -10.6, 15.2 * wd, 1.9, 0.8); F(c, '#7a4a2e'); K(c, 0.7); RR(c, -1.2, -10.9, 2.4, 2.5, 0.6); F(c, '#f2c94c'); K(c, 0.6); }
    if (H.satchel) { c.beginPath(); c.moveTo(5.2, -19.4); c.quadraticCurveTo(7.4, -15, 7.6, -11.6); K(c, 1.3, '#7a4a2e'); RR(c, 5.6, -12.6, 4.8, 4.6, 1.3); FK(c, '#b0743f', 7.6, -10.6, 4, 0.9); RR(c, 5.6, -12.6, 4.8, 2.1, 1.1); F(c, '#8f5a31'); K(c, 0.7); }
    if (H.shawl) { S(c, [-8.6, -18.4, -6, -20.6, 0, -21, 6, -20.6, 8.6, -18.4, 6.4, -14, 0, -10.4, -6.4, -14], true); FK(c, H.shawl, -2, -17, 9); for (let i = -2; i <= 2; i++) { c.beginPath(); c.moveTo(i * 2.6, -12.6 + Math.abs(i) * 1.3); c.lineTo(i * 2.6, -11 + Math.abs(i) * 1.3); K(c, 0.8, lt(H.shawl, 0.5)); } }
    if (H.scarf) { c.beginPath(); c.moveTo(-5.6, -19.6); c.quadraticCurveTo(0, -17.2, 5.6, -19.6); K(c, 3.8, INK); K(c, 2.4, H.scarf); limb(c, [3.6, -18.4, 4.8, -14, 6.6, -12.4], 2, H.scarf, true); }
    const hl = p.hl || [-8.6, -11.2], hr = p.hr || [8.6, -11.2];
    arm(c, -6.3 * wd, -17.8, hl[0] * (p.hl ? 1 : wd), hl[1], H.sleeve || coat, sk, -1, H.glove);
    if (staff && staff.layer === 'mid') staffDraw(c, staff.x, staff.y, staff.a);
    arm(c, 6.3 * wd, -17.8, hr[0] * (p.hr ? 1 : wd), hr[1], H.sleeve || coat, sk, 1, H.glove);
    c.restore();
    c.save(); c.translate(hx, -28.6 + hy); if (p.hrot) c.rotate(p.hrot); headDraw(c, H, 'front', p, false); c.restore();
    if (H.held) H.held(c, 'front', by, p);
  } else if (v === 'back') {
    if (H.held && H.heldBehind) H.held(c, 'back', by, p);
    for (const s of [-1, 1]) {
      const f = s < 0 ? fl : fr, x = s * 3.3 + f[0];
      if (!H.dress) { RR(c, x - 2.1, -9.6 + by, 4.2, 7 + f[1] - by, 1.6); FK(c, H.pants, x, -6, 5, 0.9); }
      boot(c, x, -0.6 + f[1], H.boots, 'back');
    }
    if (H.dress) { P(c, [-6.6, -12 + by, 6.6, -12 + by, 9, -2.6, 0, -1.2, -9, -2.6]); FK(c, H.dress, -1, -8, 9); }
    c.save(); c.translate(0, by);
    torso(c, 'back', wd); FK(c, coat, -1, -15, 10);
    if (H.satchel) { RR(c, -10.4, -12.6, 4.8, 4.6, 1.3); FK(c, '#b0743f', -8.4, -10.6, 4, 0.9); }
    if (cape) { S(c, [-6.4, -19.8, 0, -20.8, 6.4, -19.8, 8.6, -9.6, 4, -8.2, 0, -9, -4, -8.2, -8.6, -9.6], true); FK(c, cape, -1, -15, 10); }
    if (H.satchel) { c.beginPath(); c.moveTo(-5.4, -19.4); c.lineTo(5.6, -10.6); K(c, 1.3, '#7a4a2e'); }
    if (H.shawl) { S(c, [-8.6, -18.4, -6, -20.6, 0, -21, 6, -20.6, 8.6, -18.4, 6.4, -13, 0, -8.4, -6.4, -13], true); FK(c, H.shawl, -2, -17, 9); }
    if (H.emblem) emblem(c, H.emblem, 0, -14.2, 2.8);
    if (H.scarf) { c.beginPath(); c.moveTo(-5.6, -19.6); c.quadraticCurveTo(0, -17.8, 5.6, -19.6); K(c, 3.8, INK); K(c, 2.4, H.scarf); limb(c, [-2, -19, -3.4, -14.6, -2.2, -12], 2, H.scarf, true); }
    if (H.pack) pack(c, H, 'back', 0);
    const hl = p.hl || [-8.6, -11.2], hr = p.hr || [8.6, -11.2];
    arm(c, -6.3 * wd, -17.8, hl[0] * (p.hl ? 1 : wd), hl[1], H.sleeve || coat, sk, -1, H.glove);
    arm(c, 6.3 * wd, -17.8, hr[0] * (p.hr ? 1 : wd), hr[1], H.sleeve || coat, sk, 1, H.glove);
    c.restore();
    c.save(); c.translate(hx, -28.6 + hy); if (p.hrot) c.rotate(p.hrot); headDraw(c, H, 'back', p); c.restore();
    if (H.held && !H.heldBehind) H.held(c, 'back', by, p);
  } else {
    // side, facing left
    const far = (p.farArm || [3, -11.6]), near = p.hn || [-1.8, -11.2];
    if (cape) { S(c, [2.4, -19.8 + by, 7.6, -16 + by, 10.4 + (p.capeFlap || 0), -8.4 + by, 5.6, -7.8 + by, 2, -12 + by], true); FK(c, cape, 5, -14, 8); }
    if (H.pack) pack(c, H, 'side', by);
    c.save(); c.translate(0, by); arm(c, 1.6, -17.6, far[0], far[1], dk(H.sleeve || coat, 0.22), dk(sk, 0.15), 1, H.glove && dk(H.glove, 0.15)); c.restore();
    const legs = [[fr, true], [fl, false]];
    for (const [f, isFar] of legs) {
      const x = f[0] + (isFar ? 1.2 : -0.6);
      if (!H.dress) { c.beginPath(); c.moveTo(isFar ? 1.4 : -0.8, -9 + by); c.lineTo(x, -3 + f[1]); c.lineCap = 'round'; c.lineWidth = 5.8; c.strokeStyle = INK; c.stroke(); c.lineWidth = 4; c.strokeStyle = isFar ? dk(H.pants, 0.2) : H.pants; c.stroke(); }
      boot(c, x, -0.6 + f[1], isFar ? dk(H.boots, 0.18) : H.boots, 'side');
    }
    if (H.dress) { P(c, [-5, -12 + by, 5.4, -12 + by, 7.6, -2.6, 0, -1.4, -7.4, -2.6]); FK(c, H.dress, -1, -8, 9); }
    c.save(); c.translate(hx, -28.6 + hy); STYLES[H.hair[0]].back(c, 'side', H.hair[1]); c.restore();
    c.save(); c.translate(0, by);
    torso(c, 'side', wd); FK(c, coat, -1, -15, 9);
    if (H.vest) { P(c, [-3, -19.8, 4.6 * wd, -19.4, 6.2 * wd, -8.4, -1.2, -7.6]); FK(c, H.vest, 2, -14, 7, 0.8); }
    if (H.apron) { P(c, [-5.4, -16, -2, -16.2, -1.6, -7.6, -6.4, -7.6]); FK(c, H.apron, -3, -12, 5, 0.8); }
    if (!H.dress && !H.apron) { RR(c, -5.8 * wd, -10.6, 12 * wd, 1.9, 0.8); F(c, '#7a4a2e'); K(c, 0.7); }
    if (H.satchel) { c.beginPath(); c.moveTo(-3.4, -19.4); c.lineTo(4.4, -12); K(c, 1.3, '#7a4a2e'); RR(c, 3.4, -12.8, 4.6, 4.8, 1.3); FK(c, '#b0743f', 5.4, -10.6, 4, 0.9); RR(c, 3.4, -12.8, 4.6, 2.1, 1.1); F(c, '#8f5a31'); K(c, 0.7); }
    if (H.shawl) { S(c, [-5.6, -18.6, -3, -20.8, 4, -20.8, 6.6, -18, 5, -12.4, -0.6, -11, -5.4, -14], true); FK(c, H.shawl, -1, -17, 8); }
    if (H.scarf) { c.beginPath(); c.moveTo(-4.4, -19.4); c.quadraticCurveTo(0, -17.6, 4.6, -19.4); K(c, 3.8, INK); K(c, 2.4, H.scarf); limb(c, [3.6, -19, 7.6, -17.6, 9.4, -14.6], 2, H.scarf, true); }
    c.restore();
    c.save(); c.translate(hx, -28.6 + hy); if (p.hrot) c.rotate(p.hrot); headDraw(c, H, 'side', p, false); c.restore();
    c.save(); c.translate(0, by);
    if (staff && staff.layer !== 'back' && staff.layer !== 'front') staffDraw(c, staff.x, staff.y, staff.a);
    arm(c, -0.6, -17.6, near[0], near[1], H.sleeve || coat, sk, -1, H.glove);
    // Seat emblem as a shoulder patch, so it shows in profile too.
    if (H.emblem) emblem(c, H.emblem, -0.6 + (near[0] + 0.6) * 0.22, -17.6 + (near[1] + 17.6) * 0.22, 2.2);
    c.restore();
    if (H.held) H.held(c, 'side', by, p);
  }
  if (staff && staff.layer === 'front') staffDraw(c, staff.x, staff.y + by, staff.a);
  c.restore();
}

// Toma's huge backpack of goods.
function pack(c, H, v, by) {
  const b = H.pack;
  if (v === 'front') {
    RR(c, -12, -44 + by, 24, 28, 5); FK(c, b, -4, -34, 18);
    RR(c, -13.6, -47.4 + by, 9.6, 6, 3); FK(c, '#e8c27a', -9, -45, 6);
    ball(c, 8.4, -45.8 + by, 4.6, 3.8, '#5a7dc4');
    c.beginPath(); c.moveTo(8.4, -49.6 + by); c.lineTo(8.4, -52.6 + by); K(c, 1.2, '#8a5a3a');
  } else if (v === 'back') {
    RR(c, -12.4, -40, 24.8, 31, 5); FK(c, b, -4, -30, 18);
    RR(c, -9.4, -26, 18.8, 11.4, 3); FK(c, lt(b, 0.12), -2, -22, 10);
    RR(c, -2.2, -27.6, 4.4, 4.6, 1); F(c, '#f2c94c'); K(c, 0.7);
    RR(c, -14, -45.6, 13, 7, 3.4); FK(c, '#e8c27a', -8, -43, 7);
    c.beginPath(); c.moveTo(-11.6, -45.4); c.lineTo(-11.6, -38.8); c.moveTo(-4.6, -45.4); c.lineTo(-4.6, -38.8); K(c, 0.8, '#b0874a');
    ball(c, 7.6, -43, 5, 4.2, '#5a7dc4');
    RR(c, 10.6, -36, 6, 7.6, 1.6); FK(c, '#f2c94c', 13, -33, 5); RR(c, 11.8, -34.4, 3.6, 4, 1); F(c, '#fff1b8');
    c.beginPath(); c.moveTo(-12.4, -18); c.lineTo(12.4, -18); K(c, 1.4, '#6b4429');
  } else {
    RR(c, 2.6, -42 + by, 14, 30, 5); FK(c, b, 7, -32, 16);
    RR(c, 3.4, -47.4 + by, 12, 7, 3.4); FK(c, '#e8c27a', 8, -45, 7);
    ball(c, 14.6, -38 + by, 3.6, 4.4, '#5a7dc4');
    c.beginPath(); c.moveTo(-2, -19 + by); c.quadraticCurveTo(1, -18, 3, -16 + by); K(c, 1.4, '#6b4429');
  }
}

function playerLook(look = {}) {
  const o = OUTFITS[(look.outfit | 0) & 3];
  return {
    skin: SKIN[((look.skin | 0) % 4 + 4) % 4], hair: HAIRS[((look.hair | 0) % 6 + 6) % 6],
    coat: o[0], cape: dk(o[0], 0.24), emblem: o[1], pants: '#4b5677', boots: '#7a4a2e', satchel: true, sleeve: lt(o[0], 0.08),
  };
}

const VIEW = { down: 'front', up: 'back', left: 'side', right: 'side' };
const STAFF_POSE = {
  // [hand x, hand y, staff angle, layer] per attack frame, view-local
  front: [[7.4, -23, -1.25, 'mid'], [2.6, -9.6, 1.75, 'front'], [-6.8, -9.4, 2.5, 'front']],
  back: [[7.6, -21.6, 0.9, 'front'], [3, -21, -1.65, 'back'], [-6.4, -20, -2.25, 'back']],
  side: [[3.4, -22.4, -1.05, 'mid'], [-7.2, -15, Math.PI + 0.12, 'mid'], [-6.2, -10.6, 2.3, 'mid']],
};
function playerPose(v, anim, f) {
  const p = { bob: 0, eyes: 'open', mouth: 'smile' };
  if (anim === 'idle') { p.bob = f ? 0.7 : 0; p.hdy = f ? 0.25 : 0; }
  else if (anim === 'walk') {
    const s = [1, 0, -1, 0][f]; p.bob = [0, -1, 0, -1][f];
    if (v === 'side') {
      p.fl = [-3.2 * s, s === 0 && f === 1 ? -1.6 : 0]; p.fr = [3.2 * s, s === 0 && f === 3 ? -1.6 : 0];
      p.hn = [-1.8 + 3.2 * s, -11.6]; p.farArm = [3 - 3.2 * s, -11.8]; p.capeFlap = f % 2 ? 1.2 : 0;
    } else {
      p.fl = [0, s > 0 ? 0.7 : s < 0 ? -1.8 : -0.4]; p.fr = [0, s < 0 ? 0.7 : s > 0 ? -1.8 : -0.4];
      p.hl = [-8.6, -11.2 + s * 1.3]; p.hr = [8.6, -11.2 - s * 1.3];
    }
  } else if (anim === 'attack') {
    const [x, y, a, layer] = STAFF_POSE[v][f];
    p.staff = { x, y, a, layer }; p.mouth = f === 1 ? 'grit' : 'flat'; p.eyes = 'angry';
    if (v === 'front') { p.hr = [x, y]; p.hl = [-8, -12.6]; p.bob = f === 1 ? 0.8 : -0.4; p.fl = [-0.6, f === 1 ? 0.8 : 0]; }
    else if (v === 'back') { p.hr = [x, y]; p.bob = f === 1 ? 0.8 : -0.4; }
    else { p.hn = [x, y]; p.fl = [-2.6 * (f > 0), 0]; p.fr = [2.4 * (f > 0), 0]; p.hdx = f === 1 ? -0.8 : 0.6; p.bob = f === 1 ? 0.6 : -0.3; }
  } else if (anim === 'hurt') {
    p.eyes = 'hurt'; p.mouth = 'o'; p.bob = -0.6; p.hdy = -0.4;
    if (v === 'side') { p.rot = 0.14; p.hn = [-4.2, -19]; p.farArm = [5, -20]; p.fl = [-2, 0]; p.fr = [2, 0]; }
    else { p.hl = [-10.4, -18.4]; p.hr = [10.4, -18.4]; p.hrot = 0.08; }
  }
  return p;
}

// The rolling dodge: a tucked ball of cape, boots and hair.
function dodgeBall(c, H, v, f) {
  c.save(); c.translate(0, -11.5);
  c.rotate((f ? -2.6 : -0.35) * (v === 'back' ? -1 : 1));
  E(c, 0, 0, 11.4, 10.8); FK(c, H.cape || H.coat, -2, -2, 12);
  boot(c, 5.8, 9.4, H.boots, 'side'); boot(c, 1.2, 10.4, dk(H.boots, 0.1), 'side');
  E(c, 0.4, 2.8, 8, 6.2); FK(c, H.coat, -1, 1, 8);
  if (H.emblem) emblem(c, H.emblem, 1, 2.6, 2.4);
  c.save(); c.translate(-2.6, -5.2); c.scale(0.92, 0.92);
  if (v === 'back') STYLES[H.hair[0]].front(c, 'back', H.hair[1]);
  else { E(c, 0, 0, 10.4, 9.8); FK(c, H.skin, -1.5, -1, 11); eye(c, -3.8, 2.6, 1.5, 1.2, '#4a3020', 'closed'); eye(c, 3.8, 2.6, 1.5, 1.2, '#4a3020', 'closed'); STYLES[H.hair[0]].front(c, 'front', H.hair[1]); }
  c.restore();
  ball(c, -9.4, 4.6, 2, 2, H.skin, 0.9); ball(c, 7.6, -3.4, 2, 2, H.skin, 0.9);
  c.restore();
}
function speedLines(c, v, y = -11) {
  const dx = v === 'side' ? 1 : 0, dy = v === 'front' ? -1 : v === 'back' ? 1 : 0;
  c.lineCap = 'round';
  [[-6, 1], [0, 1.2], [6, 0.9]].forEach(([o, k], i) => {
    const px = dx ? 12 + i * 1.5 : o, py = dy ? y + dy * (12 + i) : y + o;
    c.beginPath(); c.moveTo(px, py); c.lineTo(px + dx * 7 * k, py + dy * 7 * k);
    c.lineWidth = 1.6; c.strokeStyle = 'rgba(255,255,255,0.75)'; c.stroke();
  });
}
// Knocked out: sitting slumped with swirly eyes and little stars over the head.
function downPose(c, H, v) {
  const sk = H.skin;
  if (v === 'side') {
    if (H.cape) { S(c, [3, -13.6, 9.6, -6, 10, -0.8, 3.6, -0.6], true); FK(c, H.cape, 6, -6, 8); }
    for (const [x, far] of [[-9.4, true], [-11, false]]) {
      c.beginPath(); c.moveTo(0, -3.4); c.lineTo(x + 3, -2.4 + (far ? -0.8 : 0)); c.lineCap = 'round'; c.lineWidth = 5.8; c.strokeStyle = INK; c.stroke(); c.lineWidth = 4; c.strokeStyle = far ? dk(H.pants, 0.2) : H.pants; c.stroke();
      c.save(); c.translate(x, -1.2 + (far ? -0.8 : 0)); c.rotate(-0.5); boot(c, 0, 1.4, far ? dk(H.boots, 0.18) : H.boots, 'side'); c.restore();
    }
    c.save(); c.translate(0, 6); c.rotate(-0.12);
    torso(c, 'side'); FK(c, H.coat, -1, -15, 9);
    if (H.emblem) emblem(c, H.emblem, -0.6, -14, 2.4, 0.82);
    arm(c, -0.8, -17, -4.6, -6.4, H.sleeve || H.coat, sk, -1);
    c.restore();
    c.save(); c.translate(-3.6, -19.2); c.rotate(-0.42); headDraw(c, H, 'side', { eyes: 'swirl', mouth: 'o' }); c.restore();
  } else {
    if (H.cape) { P(c, [-6.6, -14, -10.4, -1.6, 10.4, -1.6, 6.6, -14]); FK(c, H.cape, 0, -8, 10); }
    for (const s of [-1, 1]) { RR(c, s * 4.6 - 2.2, -5, 4.4, 4.6, 1.8); FK(c, H.pants, s * 4.6, -3, 4, 0.9); c.save(); c.translate(s * 6.4, 1.4); c.rotate(s * 0.35); boot(c, 0, 0, H.boots, 'front'); c.restore(); }
    c.save(); c.translate(0, 6.2);
    torso(c, 'front'); FK(c, H.coat, -1, -15, 10);
    if (H.emblem) emblem(c, H.emblem, 0, -13.8, 2.7);
    RR(c, -7.6, -10.6, 15.2, 1.9, 0.8); F(c, '#7a4a2e'); K(c, 0.7);
    arm(c, -6.3, -17.6, -9.6, -7.4, H.sleeve || H.coat, sk, -1); arm(c, 6.3, -17.6, 9.6, -7.4, H.sleeve || H.coat, sk, 1);
    c.restore();
    c.save(); c.translate(1.4, -20.4); c.rotate(0.3); headDraw(c, H, 'front', { eyes: 'swirl', mouth: 'o' }); c.restore();
  }
}
function koStars(c, x, y) {
  for (let i = 0; i < 3; i++) {
    const a = i / 3 * TAU + 0.4, px = x + Math.cos(a) * 8, py = y + Math.sin(a) * 2.6;
    star(c, px, py, 2.4, 1, 5); F(c, '#ffe066'); K(c, 0.7);
  }
}

function playerSprite(res, look, dir, anim, f) {
  const H = playerLook(look), v = VIEW[dir] || 'front', flip = dir === 'right';
  if (anim === 'dodge') {
    return make(res, { w: 50, h: 54, ax: 25, ay: 40, flip, body: (c) => dodgeBall(c, H, v, f), over: (c) => speedLines(c, v) });
  }
  if (anim === 'down') {
    return make(res, { w: 42, h: 54, ax: 21, ay: 48, flip, body: (c) => downPose(c, H, v), over: (c) => koStars(c, v === 'side' ? -4 : 1, v === 'side' ? -36 : -37) });
  }
  const p = playerPose(v, anim, f);
  const big = anim === 'attack';
  return make(res, {
    w: big ? 66 : 46, h: big ? 70 : 54, ax: big ? 33 : 23, ay: big ? 50 : 49, flip,
    body: (c) => human(c, H, v, p),
    over: anim === 'attack' && f === 1 ? (c) => {
      if (v === 'front') swoosh(c, 0, -16, 24, -1.1, 1.85, 7);
      else if (v === 'back') swoosh(c, 0, -22, 24, 0.5, -1.65, 7);
      else swoosh(c, -2, -16, 24, -1.2, -Math.PI + 0.1, 7);
    } : anim === 'hurt' ? (c) => { leafPath(c, 9, -39, 11, -35, 1.3); F(c, '#bfe6ff'); K(c, 0.6); } : null,
  });
}

// ---------- NPCs ----------
const NPCS = {
  elder: {
    skin: '#f0c7a2', hair: ['bun', '#eeeaf6'], coat: '#7c86c8', dress: '#6a74b8', shawl: '#c0588f', boots: '#6b4a3a', pants: '#555', eyes: 'kind', hunch: true, glasses: true,
    held(c, v, by) {
      // In profile the stick is shorter and further forward so its curl stays clear of her face.
      const x = v === 'side' ? -9.4 : v === 'back' ? -9.6 : 9.8, top = v === 'side' ? -14.4 : -20;
      limb(c, [x, 0.6, x + 0.4, top * 0.5, x - 0.3, top + by], 2, '#8a5a34', true);
      c.beginPath(); c.arc(x + 1.8, top - 1 + by, 2.2, Math.PI * 0.9, Math.PI * 2.4); c.lineCap = 'round'; c.lineWidth = 3.8; c.strokeStyle = INK; c.stroke(); c.lineWidth = 2; c.strokeStyle = '#a06c3f'; c.stroke();
      leafPath(c, x + 3.4, top - 2 + by, x + 7.2, top - 5 + by, 1.3); FK(c, '#7cc96a', x + 5, top - 3, 3, 0.7);
      if (v !== 'back') ball(c, x, (v === 'side' ? -10.6 : -11.6) + by, 2, 2, '#f0c7a2', 0.9);
    },
  },
  healer: { skin: '#f7d2b4', hair: ['bob', '#8a4a2e'], coat: '#5cbf8e', dress: '#4fae80', apron: '#fffaf0', boots: '#8a5a3a', pants: '#555', hat: ['leaf', '#63c255'], iris: '#2f6b4a' },
  merchant: {
    skin: '#e0a476', hair: ['short', '#5a3a26'], coat: '#f1e2c2', vest: '#d4863c', pants: '#6a5c8e', boots: '#6b4429', mustache: '#5a3a26', hat: ['band', '#e0505e'], wide: 1.16, pack: '#9a693b', heldBehind: false,
  },
  kid: { skin: '#c88a5c', hair: ['buns', '#2e2238'], coat: '#3cc4b0', pants: '#4b5677', boots: '#e0505e', hat: ['cap', '#ff7b54'], scarf: '#ffd43b', scale: 0.86, satchel: false },
  fisher: {
    skin: '#e8b48c', hair: ['short', '#d8d8e0'], coat: '#f2b84b', pants: '#5b6f8f', boots: '#4f6b8a', beard: '#eef0f6', hat: ['bucket', '#7f9258'], eyes: 'kind',
    held(c, v, by) {
      if (v === 'back') { c.beginPath(); c.moveTo(9, -12 + by); c.quadraticCurveTo(14, -30, 6, -46); K(c, 2.4, INK); K(c, 1.2, '#8a5a34'); return; }
      const hx = v === 'side' ? -2 : 8.8, hy = -11.4 + by, tx = v === 'side' ? -17 : 17.4, ty = -44;
      c.beginPath(); c.moveTo(hx + (v === 'side' ? 3 : -2), hy + 4); c.quadraticCurveTo(hx + (tx - hx) * 0.4, hy - 12, tx, ty); K(c, 2.6, INK); K(c, 1.3, '#8a5a34');
      c.beginPath(); c.moveTo(tx, ty); c.quadraticCurveTo(tx + (v === 'side' ? -1 : 1), ty + 10, tx + (v === 'side' ? -0.6 : 0.6), ty + 17); K(c, 0.6, 'rgba(240,240,255,0.9)');
      E(c, tx + (v === 'side' ? -0.6 : 0.6), ty + 18.6, 1.7, 2); F(c, L(c, 0, ty + 16.6, 0, ty + 20.6, '#ff6b6b', '#ff6b6b', '#ffffff', '#ffffff')); K(c, 0.7);
      ball(c, hx, hy, 2, 2, '#e8b48c', 0.9);
    },
  },
  ranger: {
    skin: '#a8724c', hair: ['ponytail', '#a7adc2'], coat: '#4e7d68', cape: '#3f6656', pants: '#4b4f63', boots: '#4a3428', hat: ['ranger', '#7a6248'], trim: '#e3c27a', glove: '#6b4a30', iris: '#3a2a1e', satchel: true,
    held(c, v, by, p) {
      if (v === 'back') return;
      const x = v === 'side' ? -2.4 : -9, y = -10 + by;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + 2.4); K(c, 0.9);
      RR(c, x - 2.6, y + 2.2, 5.2, 7, 1.4); F(c, L(c, 0, y + 2, 0, y + 9, '#fff4b0', p.flick ? '#ffc94a' : '#ffb13b')); K(c, 0.9);
      RR(c, x - 3.2, y + 1.4, 6.4, 1.6, 0.6); F(c, '#3a3f58'); K(c, 0.6); RR(c, x - 3.2, y + 8.6, 6.4, 1.6, 0.6); F(c, '#3a3f58'); K(c, 0.6);
      ball(c, x, y, 2, 2, '#6b4a30', 0.9);
    },
    glowAt: (v) => (v === 'back' ? null : [v === 'side' ? -2.4 : -9, -4.2]),
  },
};
const NPC_BOX = { elder: [44, 56], healer: [40, 58], merchant: [44, 62], kid: [40, 52], fisher: [48, 60], ranger: [44, 60] };
function npcSprite(res, kind, dir, f) {
  const base = NPCS[kind] || NPCS.elder;
  const H = Object.assign({}, base);
  const v = VIEW[dir] || 'front', flip = dir === 'right';
  const p = { bob: f ? 0.7 : 0, hdy: f ? 0.2 : 0, flick: f };
  if (kind === 'elder') { p.hr = [9.6, -11.8]; if (v === 'side') p.hn = [-9.2, -10.8]; if (v === 'back') p.hl = [-9.4, -11.8]; }
  if (kind === 'fisher' && v === 'side') p.hn = [-2, -11.4];
  if (kind === 'ranger') { if (v === 'front') p.hl = [-9, -10]; if (v === 'side') p.hn = [-2.4, -10]; }
  const [w, h] = NPC_BOX[kind] || [44, 58];
  return make(res, {
    w, h: h + 4, ax: w / 2, ay: h - 5, flip,
    under: base.glowAt && base.glowAt(v) ? (c) => { const g = base.glowAt(v); glow(c, g[0], g[1] + p.bob, f ? 11 : 9.5, '#ffd166', 0.55); } : null,
    body: (c) => human(c, H, v, p),
  });
}
// ---------- creatures ----------
// Species draw in "standing" coordinates: feet on y = 0, facing the viewer (front), away (back) or left (side).
const lift = (p, i) => (p.anim === 'walk' && p.f === (i ? 3 : 1) ? 1.4 : 0);
const stepOf = (p) => (p.anim === 'walk' ? p.step : 0);
function stub(c, x, top, dx, lf, w, col, paw) {
  const fy = -w * 0.45 - lf;
  limb(c, [x, top, x + dx * 0.6, (top + fy) / 2, x + dx, fy], w, col, true);
  E(c, x + dx - w * 0.14, fy + w * 0.04, w * 0.72, w * 0.46); FK(c, paw || col, x + dx, fy, w * 0.7, 0.9);
}
function legs4(c, p, fx, bx, top, w, col, paw, far) {
  const s = stepOf(p) * (far ? -1 : 1);
  stub(c, fx, top, -1.8 * s, lift(p, far ? 1 : 0), w, col, paw);
  stub(c, bx, top, 1.8 * s, lift(p, far ? 0 : 1), w, col, paw);
}
function paws2(c, p, x, y, rx, ry, col) {
  const s = stepOf(p);
  ball(c, -x, y - lift(p, 0) + s * 0.5, rx, ry, col, 0.9);
  ball(c, x, y - lift(p, 1) - s * 0.5, rx, ry, col, 0.9);
}
function eyes2(c, p, x, y, rx, ry, iris, base = 'open') {
  const st = p.eyes === 'open' ? base : p.eyes;
  eye(c, -x, y, rx, ry, iris, st, 1); eye(c, x, y, rx, ry, iris, st, -1);
}
function eye1(c, p, x, y, rx, ry, iris, base = 'open') { eye(c, x, y, rx, ry, iris, p.eyes === 'open' ? base : p.eyes, -1); }
function cmouth(c, x, y, s, p, style = 'w', side = false) {
  const m = p.mouth;
  if (m === 'open' || m === 'roar') {
    const k = m === 'roar' ? 1.3 : 1, w = side ? 0.8 : 1;
    c.beginPath(); c.moveTo(x - s * 1.6 * k * w, y - s * 0.2); c.quadraticCurveTo(x, y + s * 2.8 * k, x + s * 1.6 * k * w, y - s * 0.2); c.closePath();
    F(c, '#7a2638'); K(c, 0.8);
    E(c, x, y + s * 1.25 * k, s * 0.8 * w, s * 0.45); F(c, '#ff8499');
    P(c, [x - s * 1.15 * w, y - s * 0.1, x - s * 0.75 * w, y + s * 0.8, x - s * 0.35 * w, y - s * 0.05]); F(c, '#ffffff');
    return;
  }
  if (m === 'o') { E(c, x, y + s * 0.5, s * 0.7, s * 0.85); F(c, '#7a2638'); K(c, 0.7); return; }
  if (m === 'flat') { c.beginPath(); c.moveTo(x - s * 0.8, y + s * 0.3); c.quadraticCurveTo(x, y + s * 0.6, x + s * 0.8, y + s * 0.3); K(c, 0.75); return; }
  if (style === 'w' && !side) { c.beginPath(); c.arc(x - s * 0.72, y, s * 0.72, 0.1, Math.PI - 0.1); c.moveTo(x + s * 1.44 - 0.01, y); c.arc(x + s * 0.72, y, s * 0.72, 0.1, Math.PI - 0.1); K(c, 0.8); return; }
  c.beginPath(); c.arc(x, y - s * 0.5, s * (side ? 0.8 : 1.2), 0.2 * Math.PI, 0.8 * Math.PI); K(c, 0.8);
}
function leafTail(c, x0, y0, x1, y1, w, rot, col, vein) {
  c.save(); c.translate(x0, y0); c.rotate(rot);
  const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy), nx = -dy / l, ny = dx / l, b = w * 0.45;
  leafPath(c, 0, 0, dx, dy, w, b); FK(c, col, dx * 0.4, dy * 0.4, l * 0.6);
  c.beginPath(); c.moveTo(dx * 0.04, dy * 0.04); c.quadraticCurveTo(dx / 2 + nx * b, dy / 2 + ny * b, dx * 0.94, dy * 0.94); K(c, 0.85, vein);
  for (let t = 0.28; t < 0.85; t += 0.19) {
    const k = 4 * t * (1 - t), px = dx * t + nx * b * k, py = dy * t + ny * b * k;
    for (const s of [-1, 1]) { c.beginPath(); c.moveTo(px, py); c.lineTo(px + dx / l * 2.2 + nx * s * w * 0.62, py + dy / l * 2.2 + ny * s * w * 0.62); K(c, 0.6, al(vein, 0.75)); }
  }
  c.restore();
}
function maneRing(c, cx, cy, rx, ry, col, n = 10) { scallop(c, cx, cy, rx, ry, 0, TAU, n, 0.16, true); c.closePath(); FK(c, col, cx, cy - ry * 0.3, Math.max(rx, ry)); }
function ear(c, ax, ay, bx, by, tx, ty, col, inner) {
  const gx = (ax + bx + tx) / 3, gy = (ay + by + ty) / 3;
  const ctl = (x, y) => [x + (x - gx) * 0.32, y + (y - gy) * 0.32];
  const m1 = ctl((ax + tx) / 2, (ay + ty) / 2), m2 = ctl((bx + tx) / 2, (by + ty) / 2);
  c.beginPath(); c.moveTo(ax, ay); c.quadraticCurveTo(m1[0], m1[1], tx, ty); c.quadraticCurveTo(m2[0], m2[1], bx, by); c.closePath();
  FK(c, col, gx, gy, Math.hypot(tx - gx, ty - gy) * 1.2);
  if (inner) {
    const f = (x, y, k) => [gx + (x - gx) * k, gy + (y - gy) * k + 0.8];
    const a = f(ax, ay, 0.62), b = f(bx, by, 0.62), t = f(tx, ty, 0.62);
    P(c, [a[0], a[1], t[0], t[1], b[0], b[1]]); F(c, inner);
  }
}
// Layered flame tip; records a glow spot.
function fireTip(c, x, y, s, lean = 0, glows) {
  flamePath(c, x, y, s * 0.58, s * 1.55, lean); F(c, L(c, x, y, x, y - s * 1.5, '#ff4d1f', '#ff7a1f', '#ffb52e')); K(c, 0.8);
  flamePath(c, x, y - s * 0.05, s * 0.38, s * 1.08, lean * 0.7); F(c, '#ffb52e');
  flamePath(c, x, y - s * 0.08, s * 0.2, s * 0.64, lean * 0.5); F(c, '#fff3a8');
  if (glows) glows.push([x, y - s * 0.55, s * 2.4, '#ffb347']);
}
function gem(c, x, y, w, h, rot, col) {
  c.save(); c.translate(x, y); c.rotate(rot);
  P(c, [-w / 2, 0, -w / 2, -h * 0.72, 0, -h, w / 2, -h * 0.72, w / 2, 0]); F(c, col); K(c, 0.9);
  P(c, [-w / 2, 0, -w / 2, -h * 0.72, 0, -h, -w * 0.08, 0]); F(c, L(c, 0, -h, 0, 0, lt(col, 0.55), lt(col, 0.2)));
  P(c, [w / 2, 0, w / 2, -h * 0.72, 0, -h, w * 0.08, 0]); F(c, L(c, 0, -h, 0, 0, col, dk(col, 0.25)));
  P(c, [-w / 2, 0, -w / 2, -h * 0.72, 0, -h, w / 2, -h * 0.72, w / 2, 0]); K(c, 0.9);
  c.beginPath(); c.moveTo(-w * 0.3, -h * 0.15); c.lineTo(-w * 0.3, -h * 0.66); K(c, 0.7, 'rgba(255,255,255,0.75)');
  c.restore();
}
function drop(c, x, y, r, col = '#9ff0ff') {
  c.beginPath(); c.moveTo(x, y - r * 1.9);
  c.bezierCurveTo(x + r * 0.4, y - r * 1.1, x + r, y - r * 0.4, x + r, y + r * 0.1);
  c.arc(x, y + r * 0.1, r, 0, Math.PI);
  c.bezierCurveTo(x - r, y - r * 0.4, x - r * 0.4, y - r * 1.1, x, y - r * 1.9); c.closePath();
  FK(c, col, x, y, r * 1.5, 0.7); shine(c, x - r * 0.35, y - r * 0.05, r * 0.25, r * 0.35, 0.8);
}
function bubble(c, x, y, r) {
  E(c, x, y, r, r); F(c, RG(c, x + r * 0.2, y + r * 0.25, r * 1.2, 'rgba(214,248,255,0.7)', 'rgba(150,224,252,0.85)', 'rgba(96,190,240,0.95)'));
  K(c, 0.7, 'rgba(27,60,110,0.85)'); shine(c, x - r * 0.36, y - r * 0.38, r * 0.34, r * 0.22, 0.95, -0.6);
}
function crescent(c, x, y, r, rot, col) {
  const d = r * 0.48, r2 = r * 0.84, ix = (d * d + r * r - r2 * r2) / (2 * d), iy = Math.sqrt(Math.max(0, r * r - ix * ix));
  const t1 = Math.atan2(iy, ix), p1 = Math.atan2(iy, ix - d);
  c.save(); c.translate(x, y); c.rotate(rot);
  c.beginPath(); c.arc(0, 0, r, t1, TAU - t1, false); c.arc(d, 0, r2, -p1, p1, true); c.closePath();
  c.restore();
  FK(c, col, x, y, r, 0.7);
}
const FXC = { leaf: ['#8be05f', '#d8ffb0'], ember: ['#ff8c1a', '#ffe27a'], tide: ['#6fd3ff', '#e6fbff'], spark: ['#ffe14d', '#fff8c8'], stone: ['#b38b62', '#efe0c8'], moon: ['#cbbcff', '#fff6c8'], shade: ['#7b5cc4', '#d6c8ff'], storm: ['#7fa6ff', '#eef4ff'] };
// Element burst for attacks, drawn at the origin and pointing along angle a.
function elFx(c, el, f, a, s = 1) {
  const C = FXC[el] || FXC.spark;
  c.save(); c.rotate(a); c.scale(s, s);
  if (f === 0) {
    glow(c, 0, 0, 6, C[0], 0.5);
    for (const [x, y, r] of [[-1.6, -3.4, 1.7], [2.4, 2.6, 1.3], [3.4, -1.6, 1]]) { star(c, x, y, r * 1.7, r * 0.5, 4); F(c, C[1]); }
  } else if (el === 'leaf') {
    for (const [x, y, r] of [[3, -5.5, 0.7], [9, 0.5, -0.4], [3.5, 5.5, 1.3], [12.5, -5, 0.2], [13, 5, -0.9]]) {
      c.save(); c.translate(x, y); c.rotate(r); leafPath(c, -2.6, 0, 2.6, 0, 1.4); F(c, G(c, 0, 0, 2.6, C[0])); K(c, 0.7);
      c.beginPath(); c.moveTo(-2.2, 0); c.lineTo(2.2, 0); K(c, 0.5, '#3d8a3a'); c.restore();
    }
    for (const y of [-3, 2.5]) { c.beginPath(); c.moveTo(-1, y); c.lineTo(6, y * 1.4); K(c, 0.9, 'rgba(255,255,255,0.7)'); }
  } else if (el === 'ember') {
    glow(c, 6, 0, 12, '#ffb347', 0.7);
    for (const [x, y, r, h] of [[1, -3.6, -0.55, 8], [1, 3.6, 0.55, 8], [0, 0, 0, 11]]) {
      c.save(); c.translate(x, y); c.rotate(Math.PI / 2 + r); fireTip(c, 0, 0, h / 1.6, 0); c.restore();
    }
  } else if (el === 'tide') {
    c.beginPath(); c.arc(-2, 0, 9, -0.95, 0.95); K(c, 3.4, 'rgba(27,60,110,0.85)'); c.beginPath(); c.arc(-2, 0, 9, -0.95, 0.95); K(c, 2, '#8fe0ff');
    c.beginPath(); c.arc(-2, 0, 9.4, -0.6, 0.5); K(c, 0.8, '#ffffff');
    for (const [x, y, r] of [[10, -6, 1.4], [13.5, 0, 1.8], [10, 6, 1.3], [16, -4, 1]]) { c.save(); c.translate(x, y); c.rotate(Math.PI / 2 + Math.atan2(y, x)); drop(c, 0, 0, r, '#8fe0ff'); c.restore(); }
  } else if (el === 'spark') {
    glow(c, 6, 0, 12, '#fff27a', 0.7);
    for (const [x, y, k, r] of [[5, -5, 0.8, 0.9], [9, 1, 1.05, 0.2], [4.5, 5.5, 0.75, -0.6]]) { bolt(c, x, y, k, r + Math.PI / 2); F(c, C[0]); K(c, 0.7); }
    for (const [x, y] of [[13, -4], [14, 5]]) { star(c, x, y, 2, 0.6, 4); F(c, '#ffffff'); }
  } else if (el === 'stone') {
    for (const [x, y, r] of [[8, -4, 2.2], [12, 3, 1.8], [5, 5, 1.6], [14.5, -3, 1.2]]) { P(c, [x - r, y + r * 0.3, x - r * 0.4, y - r, x + r * 0.8, y - r * 0.6, x + r, y + r * 0.5, x, y + r * 0.9]); F(c, G(c, x, y, r, C[0])); K(c, 0.7); }
    for (const [x, y, r] of [[2, -1, 3], [4, 3, 2.4]]) { E(c, x, y, r, r * 0.8); F(c, 'rgba(232,214,186,0.75)'); }
  } else {
    glow(c, 6, 0, 12, '#c9b8ff', 0.6);
    for (const [x, y, r] of [[6, -4.5, 2.6], [11, 2, 3.2], [4.5, 5, 1.8], [15, -3, 1.6]]) { star(c, x, y, r, r * 0.42, 4); F(c, C[1]); K(c, 0.6); }
    crescent(c, 9, -1, 2.4, 0.4, '#fff1b0');
  }
  c.restore();
}

function creaturePose(anim, f) {
  const p = { anim, f, bob: 0, hb: 0, sx: 1, sy: 1, step: 0, tail: 0, wing: 0, eyes: 'open', mouth: 'smile', glow: [] };
  if (anim === 'idle') { p.sy = f ? 0.965 : 1; p.sx = f ? 1.025 : 1; p.tail = f ? 1 : -0.4; p.wing = f ? 1 : -0.6; p.hb = f ? -1.8 : 0; }
  else if (anim === 'walk') { p.step = [1, 0, -1, 0][f]; p.bob = [0, -1, 0, -1][f]; p.tail = [-1, 0, 1, 0][f]; p.wing = [1, 0, -1, 0][f]; p.hb = [0, -1.2, -2.2, -1.2][f]; }
  else if (anim === 'attack') {
    p.eyes = 'angry';
    if (f === 0) { p.sy = 0.9; p.sx = 1.07; p.lean = 1; p.mouth = 'open'; p.wing = 1; p.tail = 1; }
    else { p.lunge = 1; p.sy = 1.04; p.sx = 0.98; p.mouth = 'roar'; p.wing = -1; p.tail = -1; }
  } else if (anim === 'hurt') { p.eyes = 'hurt'; p.mouth = 'o'; p.recoil = 1; p.wing = 1; p.tail = 1; }
  else { p.eyes = 'closed'; p.mouth = 'flat'; p.faint = true; p.wing = -1; }
  return p;
}
function creatureXf(c, p, v, S) {
  if (S.hover && !p.faint) c.translate(0, -S.hover + p.hb); else c.translate(0, p.bob);
  if (p.lunge) c.translate(v === 'side' ? -3 : 0, v === 'front' ? 2.4 : v === 'back' ? -2.4 : 0);
  if (p.recoil) { c.translate(v === 'side' ? 2.4 : 0, v === 'front' ? -1.6 : v === 'back' ? 1.6 : -0.6); if (v === 'side') c.rotate(0.12); }
  if (p.lean && v === 'side') { c.translate(1.4, 0); c.rotate(0.05); }
  if (p.faint) { c.translate(0, S.legH || 0); c.scale(1.07, 0.86); }
  c.scale(p.sx, p.sy);
}

const CR = {};
CR.mossip = {
  size: 30, el: 'leaf', legH: 3.6, portrait: [0, -15, 23],
  draw(c, v, p) {
    const M = '#8ad15f', C = '#fff1cf', MN = '#3e9c4d', T = '#5cba47', V = '#2c7a39', IN = '#ffd3ad', IR = '#3b2a18';
    const tr = p.tail * 0.16 - (p.faint ? 0.9 : 0);
    const sprout = (x, y) => { leafPath(c, x, y, x - 4.2, y - 3.4, 1.5); FK(c, T, x - 2, y - 2, 3, 0.8); leafPath(c, x, y, x + 3.4, y - 4.4, 1.5); FK(c, lt(T, 0.12), x + 2, y - 2, 3, 0.8); };
    if (v === 'front') {
      leafTail(c, 4, -8, 15.5, -23, 4.6, tr, T, V);
      ball(c, 0, -7.6, 7.6, 6.2, M);
      E(c, 0, -5.8, 4.4, 4.4); F(c, G(c, 0, -5.8, 5, C));
      paws2(c, p, 3.6, -1.7, 2.7, 2, C);
      maneRing(c, 0, -11.4, 10, 4.8, MN);
      ear(c, -8, -19, -3, -22.6, -10.2, -29.2, M, IN); ear(c, 8, -19, 3, -22.6, 10.2, -29.2, M, IN);
      ball(c, 0, -16.6, 8.8, 7.6, M);
      for (const s of [-1, 1]) { P(c, [s * 8.2, -17.2, s * 11.8, -13.6, s * 7.6, -11.8]); FK(c, M, s * 9, -14, 3, 0.8); }
      ball(c, 0, -12.2, 4.6, 3, C, 0.8);
      E(c, 0, -13.7, 1.45, 1.05); F(c, '#3a2a3a'); shine(c, -0.4, -14, 0.5, 0.3, 0.7);
      cmouth(c, 0, -12.1, 0.8, p, 'w');
      eyes2(c, p, 3.8, -17.6, 1.95, 2.55, IR);
      blush(c, -6.1, -13.8, 1.5, 0.9); blush(c, 6.1, -13.8, 1.5, 0.9);
      sprout(0, -23.8);
    } else if (v === 'side') {
      leafTail(c, 7.6, -9, 18.4, -22, 4.6, tr, T, V);
      if (!p.faint) legs4(c, p, -3.2, 5.8, -6, 2.8, dk(M, 0.18), dk(C, 0.12), true);
      ball(c, 1.8, -8.4, 8.6, 5.6, M);
      c.save(); E(c, 1.8, -8.4, 8.6, 5.6); c.clip(); E(c, 0.6, -3.8, 7.4, 3.4); F(c, C); c.restore();
      if (!p.faint) legs4(c, p, -4.6, 4.4, -5.6, 2.9, M, C, false);
      maneRing(c, -4, -12, 5.4, 6, MN, 8);
      ear(c, -4.8, -21.2, -0.8, -20.4, -0.8, -28, dk(M, 0.18));
      ear(c, -8.6, -20.6, -4, -21.8, -5.4, -29.8, M, IN);
      ball(c, -6.2, -16, 7.8, 7.2, M);
      ball(c, -13, -13, 4.4, 2.9, C, 0.8);
      E(c, -17, -13.8, 1.35, 1.1); F(c, '#3a2a3a');
      cmouth(c, -13.6, -11.2, 0.8, p, 'w', true);
      eye1(c, p, -9.2, -16.8, 1.75, 2.45, IR);
      blush(c, -9.4, -13, 1.3, 0.8);
      sprout(-5.6, -23.2);
    } else {
      paws2(c, p, 3.8, -1.5, 2.7, 1.9, dk(M, 0.08));
      ball(c, 0, -8, 8, 6.4, M);
      E(c, 0, -9.8, 3.4, 3.4); F(c, al(MN, 0.5));
      ear(c, -8, -19, -3, -22.6, -10.2, -29.2, M); ear(c, 8, -19, 3, -22.6, 10.2, -29.2, M);
      ball(c, 0, -16.8, 8.6, 7.4, M);
      maneRing(c, 0, -11.2, 9.8, 4.2, MN);
      sprout(0, -24);
      leafTail(c, 0.6, -4.4, 7.8, -20.4, 4.8, tr, T, V);
    }
  },
};
CR.emberkit = {
  size: 30, el: 'ember', legH: 3.4, portrait: [0, -15, 23],
  draw(c, v, p) {
    const M = '#ff8a3d', D = '#d64e28', C = '#ffe3b4', IN = '#ffc0a0', IR = '#8a3a12', N = '#e0506a';
    const ts = p.tail * 1.4 - (p.faint ? 3 : 0);
    const stripes = (a) => { for (let i = 0; i < a.length; i += 4) { c.beginPath(); c.moveTo(a[i], a[i + 1]); c.lineTo(a[i + 2], a[i + 3]); K(c, 1.3, D); } };
    const whisk = (x, y, s) => { c.beginPath(); c.moveTo(x, y); c.lineTo(x + 4.6 * s, y - 0.9); c.moveTo(x, y + 1); c.lineTo(x + 4.6 * s, y + 1.8); K(c, 0.55, 'rgba(255,246,222,0.95)'); };
    if (v === 'front') {
      limb(c, [4, -6, 11.8, -8.6, 10.6 + ts, -17.4], 2.6, M, true);
      fireTip(c, 10.6 + ts, -17.2, 3.6, ts * 0.3, p.glow);
      ball(c, 0, -7, 6.8, 5.6, M);
      E(c, 0, -5.8, 3.8, 4); F(c, G(c, 0, -5.8, 4, C));
      paws2(c, p, 3.3, -1.6, 2.5, 1.9, C);
      for (const s of [-1, 1]) { ear(c, s * 8.8, -18.4, s * 3.4, -22.8, s * 9.8, -27.8, M, IN); fireTip(c, s * 9.5, -26.2, 2.3, s * 0.8, p.glow); }
      ball(c, 0, -16, 9.4, 8, M);
      for (const s of [-1, 1]) { P(c, [s * 9, -16.6, s * 12.4, -12.8, s * 8.4, -11.2]); FK(c, M, s * 9.6, -13.6, 3, 0.8); }
      stripes([-2.8, -23.2, -2.3, -20.8, 0, -24, 0, -21.2, 2.8, -23.2, 2.3, -20.8]);
      ball(c, 0, -12, 4.2, 2.7, C, 0.8);
      P(c, [-1.3, -13.9, 1.3, -13.9, 0, -12.5]); F(c, N); K(c, 0.6);
      cmouth(c, 0, -12.2, 0.85, p, 'w');
      whisk(-4.4, -12.6, -1); whisk(4.4, -12.6, 1);
      eyes2(c, p, 4.1, -16.6, 2.1, 2.6, IR);
      blush(c, -6.6, -13.2, 1.5, 0.9); blush(c, 6.6, -13.2, 1.5, 0.9);
    } else if (v === 'side') {
      limb(c, [7.4, -8.6, 13.8, -10.6, 13.2 + ts, -19.4], 2.6, M, true);
      fireTip(c, 13.2 + ts, -19.2, 3.6, ts * 0.3, p.glow);
      if (!p.faint) legs4(c, p, -3, 5.2, -5.6, 2.6, dk(M, 0.18), dk(C, 0.12), true);
      ball(c, 1.6, -7.8, 8.2, 5.2, M);
      c.save(); E(c, 1.6, -7.8, 8.2, 5.2); c.clip(); E(c, 0.6, -3.6, 7, 3); F(c, C); c.restore();
      stripes([2, -12.8, 2.5, -10.6, 5, -12.4, 5.4, -10.4]);
      if (!p.faint) legs4(c, p, -4.2, 4, -5.2, 2.7, M, C, false);
      ear(c, -4.4, -21.2, -0.6, -20, -1, -27.6, dk(M, 0.18)); fireTip(c, -1.2, -26.2, 2.1, 0.4, p.glow);
      ear(c, -8.8, -20.6, -4, -21.8, -6.8, -28.8, M, IN); fireTip(c, -7, -27.2, 2.3, -0.2, p.glow);
      ball(c, -5.6, -15.4, 8.6, 7.6, M);
      P(c, [-0.4, -15.4, 3.4, -11.8, -1.2, -10.2]); FK(c, M, 0, -12, 3, 0.8);
      stripes([-6.8, -22.6, -6.3, -20.4, -4, -22.4, -3.8, -20.4]);
      ball(c, -12.2, -12.4, 3.4, 2.5, C, 0.8);
      P(c, [-15.6, -13.8, -13.6, -14, -14.6, -12.6]); F(c, N); K(c, 0.6);
      eye1(c, p, -8.8, -15.9, 1.9, 2.5, IR);
      cmouth(c, -13, -11.4, 0.8, p, 'w', true);
      whisk(-12.4, -12.6, -1);
      blush(c, -9.4, -12.4, 1.4, 0.8);
    } else {
      paws2(c, p, 3.4, -1.5, 2.5, 1.9, dk(M, 0.08));
      ball(c, 0, -7.4, 7.4, 6, M);
      for (const y of [-10.6, -8, -5.4]) { c.beginPath(); c.arc(0, y + 6, 6.6, -2.1, -1.04); K(c, 1.2, D); }
      for (const s of [-1, 1]) { ear(c, s * 8.8, -18.4, s * 3.4, -22.8, s * 9.8, -27.8, M); fireTip(c, s * 9.5, -26.2, 2.3, s * 0.8, p.glow); }
      ball(c, 0, -16, 9.2, 7.8, M);
      stripes([-3, -21.8, -2.4, -19, 0, -22.6, 0, -19.6, 3, -21.8, 2.4, -19]);
      limb(c, [0, -3.4, 5, -7.6, 2 + ts, -14.8], 2.6, M, true);
      fireTip(c, 2 + ts, -14.6, 3.6, ts * 0.3, p.glow);
    }
  },
};
CR.dewpaw = {
  size: 30, el: 'tide', legH: 3, portrait: [0, -16, 23],
  draw(c, v, p) {
    const M = '#3fa9dc', D = '#2a76b0', C = '#fff1da', IR = '#1f2e5a', NS = '#26304e';
    const ts = p.tail - (p.faint ? 1 : 0);
    const dots = (x, y, s) => { for (const [dx, dy] of [[1.4, 0], [2.6, 0.7], [1.8, 1.6]]) { E(c, x + dx * s, y + dy, 0.38, 0.38); F(c, al(NS, 0.7)); } };
    const collar = (pts) => { for (let i = 0; i < pts.length; i += 3) bubble(c, pts[i], pts[i + 1], pts[i + 2]); };
    if (v === 'front') {
      S(c, [4.4, -3.4, 10, -2.6, 14.6, -6 + ts, 15.6, -10 + ts, 12.8, -8.4 + ts * 0.6, 8.6, -6.8], true); FK(c, D, 11, -6, 6);
      paws2(c, p, 4, -1.4, 3, 1.9, dk(M, 0.12));
      S(c, [0, -15.2, 6.4, -12.6, 7.8, -6, 5, -1.6, -5, -1.6, -7.8, -6, -6.4, -12.6], true); FK(c, M, -1, -9, 9);
      E(c, 0, -6.2, 4.8, 4.4); F(c, G(c, 0, -6.2, 5, C));
      ball(c, -1.9, -8.8, 2.2, 1.8, M, 0.8); ball(c, 1.9, -8.8, 2.2, 1.8, M, 0.8);
      for (const s of [-1, 1]) { ball(c, s * 7.4, -22.6, 2.5, 2.3, M); E(c, s * 7.4, -22.4, 1.2, 1.1); F(c, D); }
      ball(c, 0, -18.2, 8.8, 7.4, M);
      ball(c, 0, -15, 4.9, 3.2, C, 0.8);
      E(c, 0, -16.3, 1.8, 1.2); F(c, NS); shine(c, -0.5, -16.7, 0.6, 0.35, 0.7);
      dots(-1.6, -15.4, -1); dots(1.6, -15.4, 1);
      cmouth(c, 0, -14.6, 0.85, p, 'w');
      eyes2(c, p, 3.9, -19.4, 1.85, 2.4, IR);
      blush(c, -6.3, -15.8, 1.4, 0.85);  blush(c, 6.3, -15.8, 1.4, 0.85);
      drop(c, 0, -23.2, 1.3, '#a8f1ff');
      collar([-6.9, -12.4, 1.8, -3.5, -11.5, 2, 0, -11.2, 2.1, 3.5, -11.5, 2, 6.9, -12.4, 1.8]);
    } else if (v === 'side') {
      S(c, [8.6, -8.8, 15, -7.4, 20.6, -3.8 + ts * 0.6, 19.6, -1.6, 13, -2.4, 8.6, -3.6], true); FK(c, D, 14, -5, 6);
      if (!p.faint) legs4(c, p, -4.4, 6.4, -4.4, 2.6, dk(M, 0.2), dk(M, 0.26), true);
      E(c, 2.2, -6.8, 10.2, 5.2); FK(c, M, 1, -8, 10);
      c.save(); E(c, 2.2, -6.8, 10.2, 5.2); c.clip(); E(c, 0.6, -2.8, 9, 2.8); F(c, C); c.restore();
      if (!p.faint) legs4(c, p, -5.6, 5, -4, 2.7, M, dk(M, 0.08), false);
      ball(c, -4.6, -19.2, 2.3, 2.1, M);
      ball(c, -8, -13.6, 7.4, 6.6, M);
      ball(c, -13.2, -11.8, 3.8, 2.8, C, 0.8);
      E(c, -16.6, -12.6, 1.5, 1.1); F(c, NS);
      dots(-14.2, -11.6, -1);
      eye1(c, p, -9.8, -14.8, 1.7, 2.3, IR);
      cmouth(c, -13.8, -10.6, 0.8, p, 'w', true);
      blush(c, -10.4, -11.4, 1.3, 0.8);
      drop(c, -8.8, -19.6, 1.2, '#a8f1ff');
      collar([-3, -12, 2, -2, -8.4, 1.7, -3.8, -15.4, 1.5]);
    } else {
      paws2(c, p, 4, -1.4, 3, 1.9, dk(M, 0.12));
      ball(c, 0, -8.4, 7.8, 7.2, M);
      for (const s of [-1, 1]) ball(c, s * 7.4, -22.6, 2.5, 2.3, M);
      ball(c, 0, -18, 8.6, 7.2, M);
      collar([-6.9, -12.2, 1.8, -3.5, -11.2, 2, 0, -10.9, 2.1, 3.5, -11.2, 2, 6.9, -12.2, 1.8]);
      S(c, [-2.6, -4.8, 2.6, -4.8, 3.8 + ts * 0.6, 0.2, 0.6 + ts * 0.6, 3.4, -3.2, 0.2], true); FK(c, D, 0, -1, 4);
    }
  },
};
CR.nettlebug = {
  size: 26, el: 'leaf', legH: 2.6, portrait: [0, -11, 22],
  draw(c, v, p) {
    const SH = '#6cc24a', V = '#2d7433', TH = '#f2f7c2', HD = '#4c5a32', LG = '#3a4a2a', IR = '#26240f', MD = '#ecd99a';
    const s = stepOf(p);
    const thorn = (x, y, a, l = 2.8) => { const nx = Math.cos(a), ny = Math.sin(a); P(c, [x - ny * 1.3, y + nx * 1.3, x + nx * l, y + ny * l, x + ny * 1.3, y - nx * 1.3]); F(c, TH); K(c, 0.7); };
    const ring = (cx, cy, rx, ry, angs) => { for (const a of angs) thorn(cx + Math.cos(a) * rx * 0.96, cy + Math.sin(a) * ry * 0.96, a); };
    const veins = (cx, cy, h) => {
      c.beginPath(); c.moveTo(cx, cy - h); c.lineTo(cx, cy + h * 0.7); K(c, 0.9, V);
      for (const k of [-1, 1]) for (const t of [-0.6, -0.2, 0.2]) { c.beginPath(); c.moveTo(cx, cy + t * h + 1.4); c.quadraticCurveTo(cx + k * 4, cy + t * h - 0.4, cx + k * 8, cy + t * h - 2.6); K(c, 0.7, al(V, 0.8)); }
    };
    if (v === 'front') {
      if (!p.faint) for (const k of [-1, 1]) {
        limb(c, [k * 6, -4, k * 9.6, -3.4, k * (11 + k * s * 0.6), -0.7 - lift(p, k < 0 ? 0 : 1)], 1.3, LG);
        limb(c, [k * 8, -8, k * 12, -8.4, k * 13.2, -5 - lift(p, k < 0 ? 1 : 0)], 1.3, LG);
      }
      ring(0, -12.4, 11.2, 9.2, [-2.75, -2.3, -1.85, -1.29, -0.84, -0.39]);
      E(c, 0, -12.4, 11.2, 9.2); FK(c, SH, -2, -15, 11);
      veins(0, -13.4, 8);
      shine(c, -4.8, -17.4, 3, 1.5, 0.35, -0.5);
      ball(c, 0, -6, 7, 5.2, HD);
      eyes2(c, p, 3.1, -6.6, 2, 2.5, IR, 'angry');
      for (const k of [-1, 1]) limb(c, [k * 2.8, -2.4, k * 1.8, -0.6, k * 0.5, -0.9], 1, MD, true);
      cmouth(c, 0, -3.6, 0.6, p, 'smile');
    } else if (v === 'side') {
      const legsRow = (far) => { for (let i = 0; i < 3; i++) { const x = -4.6 + i * 5 + (far ? 1.6 : 0), sw = s * (i % 2 ? 1 : -1) * (far ? -1 : 1) * 1.3; limb(c, [x, -4, x - 1.2 + sw, -2.4, x - 1.8 + sw, -0.6 - lift(p, (i + (far ? 1 : 0)) % 2)], 1.2, far ? dk(LG, 0.25) : LG); } };
      if (!p.faint) legsRow(true);
      for (const [x, y, a] of [[-6, -12.4, -2.3], [-1.6, -16.2, -1.9], [3.6, -17.2, -1.5], [8.6, -15.2, -1.1], [11.8, -10.6, -0.6]]) thorn(x, y, a);
      c.beginPath(); c.moveTo(-8.6, -4.4); c.bezierCurveTo(-9.6, -19.8, 13.8, -21.2, 13.2, -4.4); c.quadraticCurveTo(2, -2.4, -8.6, -4.4); c.closePath(); FK(c, SH, 0, -12, 11);
      for (const t of [-2, 2.6, 7.4]) { c.beginPath(); c.moveTo(t - 3, -5); c.quadraticCurveTo(t, -12, t + 2.6, -16.4); K(c, 0.7, al(V, 0.8)); }
      shine(c, -2.4, -15, 3.4, 1.4, 0.35, -0.4);
      ball(c, -9.4, -5.8, 5.2, 4.6, HD);
      eye1(c, p, -11, -6.6, 1.8, 2.3, IR, 'angry');
      limb(c, [-13.2, -3.8, -15.2, -2.6, -14.2, -1.6], 1, MD, true);
      if (!p.faint) legsRow(false);
    } else {
      if (!p.faint) for (const k of [-1, 1]) {
        limb(c, [k * 6, -4, k * 9.6, -3.4, k * (11 + k * s * 0.6), -0.7 - lift(p, k < 0 ? 0 : 1)], 1.3, LG);
        limb(c, [k * 8, -9, k * 12, -9.6, k * 13.2, -6.4 - lift(p, k < 0 ? 1 : 0)], 1.3, LG);
      }
      ring(0, -11.8, 11.2, 9.6, [-2.8, -2.35, -1.9, -1.24, -0.79, -0.34]);
      E(c, 0, -11.8, 11.2, 9.6); FK(c, SH, -2, -15, 11);
      c.beginPath(); c.moveTo(0, -21.2); c.lineTo(0, -2.4); K(c, 1.1, V);
      for (const k of [-1, 1]) for (const y of [-17, -12.6, -8.2]) { c.beginPath(); c.moveTo(0, y + 1.6); c.quadraticCurveTo(k * 4.4, y - 0.2, k * 8.6, y - 2.6); K(c, 0.7, al(V, 0.8)); }
      shine(c, -4.8, -17, 3, 1.5, 0.35, -0.5);
    }
  },
};
CR.puffcap = {
  size: 26, el: 'leaf', legH: 1.8, portrait: [0, -13, 27],
  draw(c, v, p) {
    const CAP = '#ee6a50', SP = '#fff3dc', ST = '#fff0d6', GL = '#efcfa8', LF = '#68be4a', IR = '#3a2418';
    const tilt = p.anim === 'walk' ? [0.08, 0, -0.08, 0][p.f] : 0;
    c.save(); c.rotate(tilt);
    const cap = (cx, w, spots) => {
      E(c, cx, -11.2, w - 1.2, 2.8); F(c, GL); K(c, 0.8);
      for (let i = -3; i <= 3; i++) { c.beginPath(); c.moveTo(cx + i * 1.6, -11.4); c.lineTo(cx + i * 2.4, -9); K(c, 0.5, al('#b98a5e', 0.7)); }
      c.beginPath(); c.moveTo(cx - w, -11); c.bezierCurveTo(cx - w, -21.2, cx - 6, -25, cx, -25); c.bezierCurveTo(cx + 6, -25, cx + w, -21.2, cx + w, -11);
      c.quadraticCurveTo(cx, -8.6, cx - w, -11); c.closePath(); FK(c, CAP, cx - 3, -18, w);
      for (const [x, y, rx, ry] of spots) { E(c, cx + x, y, rx, ry); F(c, G(c, cx + x, y, rx, SP, 0.3, 0.15)); K(c, 0.6); }
      shine(c, cx - 5, -20.4, 3.2, 1.4, 0.4, -0.6);
      limb(c, [cx, -24.6, cx + 0.4, -27.4], 1, '#5aa83e');
      leafPath(c, cx + 0.4, -27.4, cx - 3.8, -29.2, 1.4); FK(c, LF, cx - 2, -28, 3, 0.8);
      leafPath(c, cx + 0.4, -27.4, cx + 4, -30.2, 1.4); FK(c, lt(LF, 0.15), cx + 2, -29, 3, 0.8);
    };
    if (v === 'front') {
      if (!p.faint) paws2(c, p, 3, -1.2, 2.3, 1.6, GL);
      ball(c, 0, -6, 6.2, 6, ST);
      ball(c, -6.4, -5.6, 1.6, 1.4, ST, 0.8); ball(c, 6.4, -5.6, 1.6, 1.4, ST, 0.8);
      eyes2(c, p, 2.5, -5.8, 1.5, 1.95, IR);
      blush(c, -4.3, -3.6, 1.5, 0.85, 0.55); blush(c, 4.3, -3.6, 1.5, 0.85, 0.55);
      cmouth(c, 0, -3.2, 0.6, p, 'smile');
      cap(0, 12.6, [[-6, -16.6, 2.4, 1.9], [0.8, -21, 2.8, 2], [6.6, -15.4, 2, 1.6], [-1.6, -13.6, 1.5, 1.1], [8.6, -19.6, 1.3, 1]]);
    } else if (v === 'side') {
      if (!p.faint) { const s = stepOf(p); ball(c, 1.6 + s, -1.2 - lift(p, 1), 2.3, 1.5, dk(GL, 0.1), 0.9); ball(c, -1.6 - s, -1.2 - lift(p, 0), 2.4, 1.6, GL, 0.9); }
      ball(c, 0, -6, 6, 6, ST);
      ball(c, 3.4, -4.2, 1.3, 1.1, dk(ST, 0.1), 0.8);
      eye1(c, p, -3.4, -5.8, 1.4, 1.9, IR);
      blush(c, -4.6, -3.6, 1.2, 0.8, 0.55);
      cmouth(c, -5, -3.2, 0.55, p, 'smile', true);
      cap(-1, 12.2, [[-5, -16.8, 2.2, 1.8], [2, -21, 2.6, 1.9], [7, -15.6, 2, 1.6], [-0.6, -13.6, 1.4, 1.1]]);
    } else {
      if (!p.faint) paws2(c, p, 3, -1.2, 2.3, 1.6, dk(GL, 0.08));
      ball(c, 0, -6, 6.2, 6, ST);
      ball(c, -6.4, -5.6, 1.6, 1.4, ST, 0.8); ball(c, 6.4, -5.6, 1.6, 1.4, ST, 0.8);
      cap(0, 12.6, [[-5.6, -15.6, 2.3, 1.8], [1.4, -20.4, 3, 2.1], [7, -16, 1.8, 1.5], [-1.2, -13.4, 1.6, 1.1], [-8.4, -19, 1.2, 1]]);
    }
    c.restore();
  },
};
CR.clackle = {
  size: 30, el: 'tide', legH: 3, portrait: [0, -12, 28],
  draw(c, v, p) {
    const SH = '#ff7b8b', DK = '#d9475f', BL = '#ffd6c8', IR = '#2a1a2a', BAR = '#f6efe2';
    const s = stepOf(p);
    const pincer = (x, y, r, rot, col, mx = 1) => {
      c.save(); c.translate(x, y); c.scale(mx, 1); c.rotate(rot);
      c.beginPath(); c.moveTo(-r * 0.9, 0);
      c.bezierCurveTo(-r * 0.9, -r * 1.05, r * 0.6, -r * 1.25, r * 1.3, -r * 0.4);
      c.quadraticCurveTo(r * 0.7, -r * 0.2, r * 0.25, -r * 0.02);
      c.quadraticCurveTo(r * 0.75, r * 0.05, r * 1.12, r * 0.32);
      c.bezierCurveTo(r * 0.7, r * 0.95, -r * 0.6, r * 0.95, -r * 0.9, 0);
      c.closePath(); FK(c, col, -r * 0.2, -r * 0.3, r * 1.3);
      shine(c, -r * 0.2, -r * 0.55, r * 0.36, r * 0.18, 0.5, -0.25);
      for (const [px, py] of [[-r * 0.35, r * 0.4], [r * 0.15, r * 0.5]]) { E(c, px, py, r * 0.1, r * 0.08); F(c, al(DK, 0.7)); }
      c.restore();
    };
    const legsSide = (k, col) => { for (let i = 0; i < 3; i++) { const lf = lift(p, (i + (k > 0 ? 1 : 0)) % 2), sx = (i % 2 ? s : -s) * 0.8; limb(c, [k * (6.2 + i * 1.3), -6.4 + i * 1.1, k * (10.6 + i * 1.4), -8.6 + i * 1.6 - lf, k * (12.2 + i * 1.2) + sx, -0.6 - lf], 1.7, col); } };
    if (v === 'front') {
      if (!p.faint) { legsSide(-1, DK); legsSide(1, DK); }
      for (const k of [-1, 1]) limb(c, [k * 3.4, -12.6, k * 4.2, -18], 1.8, SH);
      E(c, 0, -8.8, 10.6, 6.6); FK(c, SH, -2, -11, 11);
      E(c, 0, -6.4, 6.6, 3.2); F(c, al(BL, 0.75));
      c.beginPath(); c.arc(0, -4, 9.4, -2.5, -0.64); K(c, 0.7, al(DK, 0.75));
      ball(c, -5.6, -12.4, 1.3, 1.1, BAR, 0.7); ball(c, 5.2, -13.2, 1, 0.9, BAR, 0.7); ball(c, -2, -14.2, 0.8, 0.7, BAR, 0.6);
      for (const k of [-1, 1]) ball(c, k * 4.4, -19.6, 2.9, 2.9, SH);
      eyes2(c, p, 4.4, -19.8, 1.9, 2.3, IR);
      cmouth(c, 0, -7, 0.8, p, 'smile');
      blush(c, -5.6, -7.4, 1.4, 0.8); blush(c, 5.6, -7.4, 1.4, 0.8);
      limb(c, [-8.2, -9.4, -11, -11.8], 2.2, SH); pincer(-12.2, -13.6, 2.9, -1.2, SH, -1);
      limb(c, [8.2, -9.6, 11.6, -12.8], 3.2, SH); pincer(13.4, -16.6, 5.6, -1.95, SH);
    } else if (v === 'side') {
      if (!p.faint) for (let i = 0; i < 3; i++) { const sx = (i % 2 ? -s : s), lf = lift(p, (i + 1) % 2), bx = -1.6 + i * 3.6, tx = -5 + i * 7 + sx; limb(c, [bx, -6, (bx + tx) / 2 + (tx - bx) * 0.2, -9.4 - lf, tx, -1.4 - lf], 1.4, dk(DK, 0.22)); }
      limb(c, [2, -10, 4, -13.6], 2, dk(SH, 0.2)); pincer(4.6, -16, 2.5, -1.5, dk(SH, 0.2));
      limb(c, [0.6, -13.4, 0.8, -18], 1.7, dk(SH, 0.2)); ball(c, 0.9, -19.4, 2.4, 2.4, dk(SH, 0.2));
      E(c, 1.4, -8.4, 8.6, 6.4); FK(c, SH, 0, -10, 9);
      ball(c, 3.6, -12.4, 1.2, 1, BAR, 0.7); ball(c, 6.6, -9.6, 0.9, 0.8, BAR, 0.6);
      limb(c, [-2.6, -13.4, -3.4, -18.4], 1.8, SH); ball(c, -3.6, -20, 2.8, 2.8, SH);
      eye1(c, p, -4, -20.2, 1.8, 2.2, IR);
      cmouth(c, -5.6, -7.2, 0.75, p, 'smile', true);
      blush(c, -4.4, -8.4, 1.2, 0.7);
      if (!p.faint) for (let i = 0; i < 4; i++) { const sx = (i % 2 ? s : -s) * 1.1, lf = lift(p, i % 2), bx = -4.6 + i * 3, tx = -11.4 + i * 7.4 + sx; limb(c, [bx, -4.8, (bx + tx) / 2 + (tx - bx) * 0.22, -8 - lf, tx, -0.6 - lf], 1.6, DK); }
      limb(c, [-5.2, -8.4, -9.2, -10.6], 3.2, SH); pincer(-12.8, -12.6, 5.6, -0.4, SH, -1);
    } else {
      if (!p.faint) { legsSide(-1, DK); legsSide(1, DK); }
      for (const k of [-1, 1]) { limb(c, [k * 3.4, -12.6, k * 4.2, -18], 1.8, SH); ball(c, k * 4.4, -19.6, 2.8, 2.8, SH); shine(c, k * 4.4 - 0.8, -20.6, 1, 0.7, 0.5); }
      E(c, 0, -8.8, 10.6, 6.8); FK(c, SH, -2, -11, 11);
      for (const r of [4, 7.4]) { c.beginPath(); c.arc(0, -4.6, r, -2.6, -0.54); K(c, 0.8, al(DK, 0.75)); }
      ball(c, 4.6, -12.6, 1.3, 1.1, BAR, 0.7); ball(c, -5.4, -11.2, 1, 0.9, BAR, 0.7); ball(c, 1.4, -14.4, 0.8, 0.7, BAR, 0.6);
      limb(c, [8.2, -9.4, 11, -11.8], 2.2, SH); pincer(12.2, -13.6, 2.9, -1.2, SH);
      limb(c, [-8.2, -9.6, -11.6, -12.8], 3.2, SH); pincer(-13.4, -16.6, 5.6, -1.95, SH, -1);
    }
  },
};
CR.gullwisp = {
  size: 30, el: 'spark', hover: 7, legH: 0, portrait: [0, -17, 26],
  draw(c, v, p) {
    const W = '#f7f9ff', WS = '#c8d2ea', Y = '#ffd43b', YD = '#f2a51f', B = '#ff9f43', IR = '#24304f';
    const up = p.faint ? -1 : p.wing;
    const wing = (x, y, k, ang, col) => {
      c.save(); c.translate(x, y); c.scale(k, 1); c.rotate(ang);
      S(c, [0, -1.4, 5, -4.2, 10, -5.2, 14.6, -4.6, 13, -2.4, 13.6, -0.4, 11, 0.4, 11, 2.4, 8, 2, 5.6, 3.4, 2, 3], true); FK(c, col, 5, -2, 9);
      P(c, [9.8, -5.1, 14.8, -4.6, 12.8, -2.3, 13.8, -0.3, 11, 0.5, 11.2, 2.4, 9.2, 1.6, 10.6, -1.6]); F(c, L(c, 9.6, 0, 14.6, 0, YD, Y)); K(c, 0.7);
      for (const t of [4, 7]) { c.beginPath(); c.moveTo(t, -2.6); c.lineTo(t + 1.2, 1.6); K(c, 0.5, al(WS, 0.9)); }
      c.restore();
    };
    const crest = (x, y) => { P(c, [x - 1.6, y, x + 0.4, y - 5.2, x, y - 2.6, x + 2.8, y - 3.8, x + 1.4, y + 0.2]); F(c, L(c, x, y - 5, x, y, Y, YD)); K(c, 0.8); };
    if (v === 'front') {
      const wa = -0.42 * up;
      wing(-5.2, -10.4, -1, wa, W); wing(5.2, -10.4, 1, wa, W);
      if (!p.faint) { limb(c, [-2, -3, -2.3, -0.8], 1, B); limb(c, [2, -3, 2.3, -0.8], 1, B); }
      ball(c, 0, -9.6, 7.4, 7.8, W);
      E(c, 0, -6.8, 4.6, 3.8); F(c, 'rgba(255,251,236,0.9)');
      crest(-0.4, -16.6);
      eyes2(c, p, 2.9, -11.4, 1.75, 2.25, IR);
      if (p.mouth === 'roar' || p.mouth === 'open') { P(c, [-2, -9, 2, -9, 0, -7.6]); FK(c, B, 0, -8.6, 2.4, 0.8); P(c, [-1.6, -7.2, 1.6, -7.2, 0, -5.6]); FK(c, dk(B, 0.15), 0, -6.6, 2, 0.8); }
      else { P(c, [-1.8, -9, 1.8, -9, 0, -6.2]); FK(c, B, 0, -8.2, 2.4, 0.8); }
      blush(c, -4.6, -8.4, 1.3, 0.8); blush(c, 4.6, -8.4, 1.3, 0.8);
    } else if (v === 'side') {
      c.save(); c.translate(3.6, -12.4); c.scale(0.8, 0.8); wing(0, 0, 1, -1.5 - 0.35 * up, dk(W, 0.16)); c.restore();
      P(c, [5.6, -9.6, 13.2, -8, 11.4, -6.8, 13.2, -5, 6, -6.2]); FK(c, W, 9, -7, 5, 0.9);
      P(c, [11, -7.6, 13.2, -8, 11.4, -6.8, 13.2, -5, 11.6, -5.4]); F(c, Y);
      ball(c, 0.6, -9.4, 8, 6.8, W);
      ball(c, -4.4, -11.8, 5.4, 5.2, W, 0);
      c.beginPath(); c.arc(-4.4, -11.8, 5.4, Math.PI * 0.7, Math.PI * 1.75); K(c, 1);
      crest(-4.6, -16.4);
      eye1(c, p, -6.4, -12.4, 1.6, 2.2, IR);
      if (p.mouth === 'roar' || p.mouth === 'open') { P(c, [-9.2, -12.4, -13, -11.6, -9.4, -11]); FK(c, B, -10.4, -11.6, 2, 0.8); P(c, [-9.4, -10.6, -12.4, -9.6, -9.4, -9.4]); FK(c, dk(B, 0.15), -10, -10, 2, 0.8); }
      else { P(c, [-9.2, -12.2, -13.2, -10.8, -9.2, -9.6]); FK(c, B, -10.4, -11, 2, 0.8); }
      blush(c, -6.8, -9.6, 1.1, 0.7);
      c.save(); c.translate(2, -11); c.scale(0.82, 0.82); wing(0, 0, 1, up > 0.3 ? -1.05 : up < -0.3 ? 0.35 : -0.35, W); c.restore();
      if (!p.faint) { limb(c, [0, -3, -0.6, -0.8], 1, B); limb(c, [2.6, -3, 2.2, -0.8], 1, dk(B, 0.15)); }
    } else {
      const wa = -0.42 * up;
      wing(-5.2, -10.4, -1, wa, W); wing(5.2, -10.4, 1, wa, W);
      if (!p.faint) { limb(c, [-2, -3, -2.3, -0.8], 1, B); limb(c, [2, -3, 2.3, -0.8], 1, B); }
      ball(c, 0, -9.6, 7.4, 7.8, W);
      for (const y of [-11, -8]) { c.beginPath(); c.arc(0, y + 5, 5, -2.3, -0.84); K(c, 0.7, al(WS, 0.95)); }
      crest(-0.4, -16.6);
      P(c, [-3, -4.6, 0, 0.4, 3, -4.6, 0, -3]); FK(c, W, 0, -3, 4, 0.9);
      P(c, [-1.4, -1.8, 0, 0.4, 1.4, -1.8]); F(c, Y);
    }
  },
};
CR.ripplefin = {
  size: 34, el: 'tide', legH: 2.4, portrait: [0, -12, 30],
  draw(c, v, p) {
    const M = '#7f87f0', BL = '#d6daff', FR = '#d68cff', FT = '#ff9fd6', FN = 'rgba(186,196,255,0.82)', IR = '#231c4a';
    const ts = p.tail - (p.faint ? 1 : 0);
    const frill = (x, y, a, len, dark) => {
      const x1 = x + Math.cos(a) * len, y1 = y + Math.sin(a) * len;
      leafPath(c, x, y, x1, y1, 1.9, 0.5); F(c, L(c, x, y, x1, y1, dark ? dk(FR, 0.2) : FR, dark ? dk(FT, 0.2) : FT)); K(c, 0.8);
      for (let t = 0.4; t < 0.95; t += 0.22) { const px = x + (x1 - x) * t, py = y + (y1 - y) * t; for (const d of [1.25, -1.25]) { c.beginPath(); c.moveTo(px, py); c.lineTo(px + Math.cos(a + d) * 1.5, py + Math.sin(a + d) * 1.5); K(c, 0.55, al(FT, 0.95)); } }
    };
    const spots = (pts) => { for (let i = 0; i < pts.length; i += 2) { E(c, pts[i], pts[i + 1], 0.8, 0.65); F(c, al(lt(M, 0.5), 0.9)); } };
    if (v === 'front') {
      S(c, [9, -7.6, 13.6, -12.6 + ts, 16.8, -12.4 + ts, 15.6, -8.2 + ts], true); F(c, FN); K(c, 0.7);
      S(c, [5, -4, 11, -5, 15.4, -9 + ts, 13.8, -10.6 + ts, 10, -8, 5.6, -7.6], true); FK(c, M, 10, -7, 6);
      for (const k of [-1, 1]) { limb(c, [k * 6, -4.4, k * 8.6, -2.6, k * 9.4 + k * stepOf(p) * 0.5, -1 - lift(p, k < 0 ? 0 : 1)], 2.4, M); for (const t of [-1, 0, 1]) ball(c, k * 9.4 + t * 1.1, -0.4 - lift(p, k < 0 ? 0 : 1), 0.7, 0.6, lt(M, 0.2), 0.5); }
      E(c, 0, -6.4, 8.4, 5.6); FK(c, M, -1, -8, 9);
      E(c, 0, -4.8, 5.6, 3.2); F(c, G(c, 0, -4.8, 5.6, BL));
      for (const k of [-1, 1]) for (const a of [-0.8, -0.25, 0.3]) frill(k * 8.8, -15.2, k > 0 ? a : Math.PI - a, 7);
      E(c, 0, -13.6, 11, 7.6); FK(c, M, -2, -16, 11);
      spots([-3, -19, 2.4, -19.6, 0, -17.8, -6.6, -17.6, 6.8, -17.2]);
      eyes2(c, p, 5.6, -14.6, 1.95, 2.35, IR);
      if (p.mouth === 'smile') { c.beginPath(); c.moveTo(-4.2, -10.8); c.quadraticCurveTo(0, -8.2, 4.2, -10.8); K(c, 0.85); } else cmouth(c, 0, -10.6, 1, p);
      blush(c, -7.8, -11.4, 1.6, 0.9); blush(c, 7.8, -11.4, 1.6, 0.9);
    } else if (v === 'side') {
      S(c, [12, -9.4, 18, -13.6, 24.8, -13.6 + ts, 25.8, -10 + ts, 24.2, -6.4 + ts, 18, -3, 12, -4.4], true); F(c, FN); K(c, 0.7);
      S(c, [9.6, -8.6, 17, -9.6, 24.4, -11 + ts, 24, -8.6 + ts, 16.6, -4.8, 9.6, -4], true); FK(c, M, 16, -7, 8);
      S(c, [-3, -10.2, 4, -13.8, 11, -11.2, 11, -9.6, 4, -10.6, -3, -9.4], true); F(c, FN); K(c, 0.7);
      if (!p.faint) legs4(c, p, -3.6, 8, -4.4, 2.3, dk(M, 0.2), dk(M, 0.2), true);
      E(c, 2.6, -6.4, 10.8, 4.8); FK(c, M, 1, -8, 10);
      c.save(); E(c, 2.6, -6.4, 10.8, 4.8); c.clip(); E(c, 1, -2.6, 10, 2.6); F(c, BL); c.restore();
      if (!p.faint) legs4(c, p, -4.6, 7, -4, 2.4, M, M, false);
      for (const a of [-1.4, -0.85, -0.3]) frill(-4.4, -14, a, 6.2, true);
      E(c, -8.6, -10.6, 7.8, 6.2); FK(c, M, -10, -12, 8);
      spots([-8, -15.2, -5.4, -14, -10.6, -15]);
      for (const a of [-1.25, -0.7, -0.15]) frill(-4, -12.2, a, 6.6);
      eye1(c, p, -11.2, -11.8, 1.75, 2.2, IR);
      if (p.mouth === 'smile') { c.beginPath(); c.moveTo(-15.8, -8.6); c.quadraticCurveTo(-13.6, -7.2, -11.2, -7.8); K(c, 0.85); } else cmouth(c, -13.6, -8.2, 0.9, p, 'w', true);
      blush(c, -11, -8.8, 1.3, 0.75);
    } else {
      for (const k of [-1, 1]) for (const a of [-0.8, -0.25, 0.3]) frill(k * 8.4, -16, k > 0 ? a : Math.PI - a, 6.6);
      E(c, 0, -15, 10.4, 6.8); FK(c, M, -2, -17, 10);
      for (const k of [-1, 1]) stub(c, k * 7, -5, k * 1.2, lift(p, k < 0 ? 0 : 1), 2.4, M);
      S(c, [3, -6.4, 9.6, -6, 14.6, -9 + ts, 15.8, -5.6 + ts, 12, -2.6, 5, -2.6], true); F(c, FN); K(c, 0.7);
      E(c, 0, -8, 8, 6.6); FK(c, M, -1, -10, 8);
      c.beginPath(); c.moveTo(0, -13.6); c.quadraticCurveTo(0.6, -9, 0, -3.4); K(c, 1.6, al(dk(M, 0.2), 0.6));
      spots([-3.4, -10, 3.6, -9, -2.6, -5.6, 4, -5]);
      S(c, [2.4, -5.4, 8, -4.6, 13 + ts, -6.8, 13.6 + ts, -4.4, 8.6, -2, 2.4, -2], true); FK(c, M, 8, -4, 6);
    }
  },
};
CR.gemmole = {
  size: 34, el: 'stone', legH: 2.4, portrait: [0, -12, 28],
  draw(c, v, p) {
    const M = '#8c6349', MZ = '#ebbd98', N = '#ff8ea2', CL = '#f6ead2', CRY = '#4fd8c8', IR = '#2a1a12';
    const claws = (x, y, k, rot) => {
      c.save(); c.translate(x, y); c.rotate(rot); c.scale(k, 1);
      for (const t of [-1.7, 0, 1.7]) { P(c, [t - 0.9, 1.4, t + 0.2, 4.6, t + 0.9, 1.4]); F(c, '#fffaf0'); K(c, 0.6); }
      E(c, 0, 0, 3.7, 2.8); FK(c, CL, -1, -1, 4, 0.9); c.restore();
    };
    const whisk = (x, y, k) => { c.beginPath(); c.moveTo(x, y); c.lineTo(x + k * 4.6, y - 1.2); c.moveTo(x, y + 1); c.lineTo(x + k * 4.6, y + 1.2); K(c, 0.55, 'rgba(60,36,24,0.7)'); };
    if (v === 'front') {
      gem(c, -6.8, -15.4, 4.4, 8, -0.6, CRY); gem(c, 6.8, -15.4, 4.4, 8, 0.6, CRY); gem(c, -2.6, -18.4, 4.6, 9.8, -0.2, CRY); gem(c, 3, -18.8, 5, 11, 0.16, CRY);
      if (!p.faint) paws2(c, p, 4.6, -1.2, 3, 1.8, dk(M, 0.1));
      ball(c, 0, -10.2, 11.2, 9.4, M);
      E(c, 0, -6.6, 7.4, 5.6); F(c, al(lt(M, 0.3), 0.75));
      claws(-7.8, -4.4, -1, 0.3); claws(7.8, -4.4, 1, -0.3);
      ball(c, 0, -9, 5.6, 4.2, MZ, 0.8);
      ball(c, 0, -11, 2.5, 1.8, N, 0.8);
      cmouth(c, 0, -8.6, 0.8, p, 'w');
      whisk(-4.4, -9.6, -1); whisk(4.4, -9.6, 1);
      eyes2(c, p, 4.9, -14, 1.55, 2, IR);
      blush(c, -7, -11.2, 1.4, 0.8); blush(c, 7, -11.2, 1.4, 0.8);
    } else if (v === 'side') {
      gem(c, -1, -16.6, 4, 8, -0.4, CRY); gem(c, 3.8, -17.8, 4.8, 10.6, 0.05, CRY); gem(c, 8.6, -15.4, 4.2, 8.6, 0.55, CRY); gem(c, 11.4, -11.4, 3.2, 6.2, 1, CRY);
      if (!p.faint) legs4(c, p, -3.6, 7.4, -4, 3, dk(M, 0.2), dk(M, 0.22), true);
      ball(c, 2, -9.4, 11, 8.6, M);
      ball(c, 12.8, -5.4, 2, 1.6, dk(M, 0.12), 0.8);
      if (!p.faint) legs4(c, p, -4.6, 6.2, -3.6, 3.1, dk(M, 0.06), dk(M, 0.1), false);
      ball(c, -9.6, -8.2, 4.6, 3.4, MZ, 0.8);
      ball(c, -13.6, -8.8, 1.9, 1.6, N, 0.8);
      whisk(-10.6, -7.6, -1);
      eye1(c, p, -6.4, -12.6, 1.45, 1.9, IR);
      cmouth(c, -10.6, -6.4, 0.7, p, 'w', true);
      claws(-8, -2.6, -1, 0.15);
      blush(c, -7.4, -9.4, 1.2, 0.7);
    } else {
      if (!p.faint) paws2(c, p, 4.6, -1.2, 3, 1.8, dk(M, 0.1));
      ball(c, 0, -10, 11.2, 9.6, M);
      ball(c, 0, -2.4, 2, 1.6, dk(M, 0.12), 0.8);
      gem(c, -6.4, -9.4, 4.6, 9, -0.45, CRY); gem(c, 6.4, -9.4, 4.6, 9, 0.45, CRY); gem(c, 0, -11.4, 5.8, 12.6, 0, CRY);
      gem(c, -3.2, -4.6, 3.6, 6, -0.2, CRY); gem(c, 3.4, -4.8, 3.6, 6.4, 0.25, CRY);
    }
  },
};
CR.fizzwing = {
  size: 32, el: 'spark', hover: 8, legH: 0, portrait: [0, -21, 28],
  draw(c, v, p) {
    const Y = '#ffd84a', YC = '#fff4b8', V = '#9a7bff', VL = '#cbb8ff', VD = '#6a4ed0', A = '#5a4a8a', IR = '#2a2050';
    const up = p.faint ? -1 : p.wing;
    const upper = (k, ang, col) => {
      c.save(); c.scale(k, 1); c.rotate(ang);
      S(c, [0, -1, 4, -7.6, 10, -10.8, 14.8, -9.6, 15.6, -4.4, 11.6, 0.6, 5, 1.4], true); FK(c, col, 7, -6, 10);
      S(c, [3, -5.6, 9.6, -9.4, 13.8, -8.4, 14.4, -5, 9.6, -2.4], true); F(c, al(lt(col, 0.35), 0.6));
      ball(c, 10.2, -5.4, 2.5, 2.5, Y, 0.7); E(c, 10.4, -5.2, 1.1, 1.1); F(c, VD);
      c.restore();
    };
    const lower = (k, ang, col) => { c.save(); c.scale(k, 1); c.rotate(ang); S(c, [0, 0.6, 6, 1.4, 10.6, 4.6, 9.8, 8.8, 5.4, 9.2, 1.4, 4.6], true); FK(c, col, 5, 4, 7); E(c, 6.6, 5.4, 1.4, 1.4); F(c, YC); c.restore(); };
    const fuzz = (cx, cy, rx, ry) => { scallop(c, cx, cy, rx, ry, 0, TAU, 12, 0.07, true); c.closePath(); FK(c, Y, cx - 1, cy - 1, Math.max(rx, ry)); };
    const abdomen = (x, y, rx, ry) => {
      E(c, x, y, rx, ry); FK(c, V, x, y, Math.max(rx, ry));
      c.save(); E(c, x, y, rx, ry); c.clip(); for (const t of [-0.35, 0.25]) { c.fillStyle = Y; c.fillRect(x - rx, y + t * ry * 2 - 0.9, rx * 2, 1.8); } c.restore();
      E(c, x, y, rx, ry); K(c, 0.9);
    };
    const antenna = (x0, y0, x1, y1, bend) => {
      c.beginPath(); c.moveTo(x0, y0); c.quadraticCurveTo((x0 + x1) / 2 + bend, (y0 + y1) / 2 - 2, x1, y1); K(c, 2.2, INK); K(c, 1, A);
      for (let t = 0.35; t < 0.95; t += 0.2) { const px = x0 + (x1 - x0) * t + bend * 4 * t * (1 - t) * 0.5, py = y0 + (y1 - y0) * t - 2 * 4 * t * (1 - t) * 0.5; c.beginPath(); c.moveTo(px - 1.1, py - 0.9); c.lineTo(px + 1.1, py + 0.9); K(c, 0.6, A); }
      ball(c, x1, y1, 1.7, 1.7, YC, 0.7); p.glow.push([x1, y1, 5.5, '#fff08a']);
    };
    if (v === 'front') {
      c.save(); c.translate(0, -12);
      lower(-1, 0.18 * up, VL); lower(1, 0.18 * up, VL); upper(-1, -0.28 * up, V); upper(1, -0.28 * up, V);
      c.restore();
      abdomen(0, -5.2, 4.2, 4.4);
      antenna(-2.4, -17.6, -7.6, -24.6, -2); antenna(2.4, -17.6, 7.6, -24.6, 2);
      fuzz(0, -12.4, 7, 6.6);
      scallop(c, 0, -7.2, 6, 1.8, 0, Math.PI, 6, 0.3, true); c.closePath(); FK(c, YC, 0, -7.2, 6, 0.8);
      eyes2(c, p, 3, -12.8, 2, 2.5, IR);
      cmouth(c, 0, -9.6, 0.7, p, 'smile');
      blush(c, -4.8, -10, 1.3, 0.8); blush(c, 4.8, -10, 1.3, 0.8);
      if (!p.faint) for (const k of [-1, 1]) limb(c, [k * 1.6, -2, k * 2.2, 0], 0.8, A);
    } else if (v === 'side') {
      c.save(); c.translate(1.2, -12.4); upper(1, -1.05 - 0.35 * up, dk(V, 0.16)); c.restore();
      abdomen(5.6, -8, 4.6, 3.8);
      fuzz(-0.6, -12, 6.6, 6.4);
      antenna(-3, -17.4, -9.6, -23.4, -1.5);
      eye1(c, p, -3.8, -12.6, 1.8, 2.4, IR);
      cmouth(c, -5.6, -9.6, 0.65, p, 'smile', true);
      blush(c, -4.6, -10, 1.2, 0.7);
      c.save(); c.translate(1.6, -12.6); lower(1, 0.25 - 0.2 * up, VL); upper(1, -0.55 - 0.55 * up, V); c.restore();
      if (!p.faint) limb(c, [-1, -6.2, -1.6, -3.8], 0.8, A);
    } else {
      antenna(-2.4, -17.6, -7.6, -24.6, -2); antenna(2.4, -17.6, 7.6, -24.6, 2);
      c.save(); c.translate(0, -12);
      lower(-1, 0.18 * up, VL); lower(1, 0.18 * up, VL); upper(-1, -0.28 * up, V); upper(1, -0.28 * up, V);
      c.restore();
      fuzz(0, -12.4, 7, 6.6);
      abdomen(0, -5, 4.2, 4.6);
    }
  },
};
CR.cindermite = {
  size: 32, el: 'ember', legH: 2.2, portrait: [0, -10, 27],
  draw(c, v, p) {
    const M = '#a3302b', BE = '#ff8a3a', IR = '#3a0f0a', CK = '#5c1717';
    const ts = p.tail - (p.faint ? 1 : 0);
    const spot = (x, y, r) => { E(c, x, y, r, r * 0.85); F(c, RG(c, x - r * 0.2, y - r * 0.2, r * 1.1, '#fff4b0', '#ffc23a', '#ff7a1a')); K(c, 0.6, al(CK, 0.9)); p.glow.push([x, y, r * 3.2, '#ffa53a']); };
    const crack = (a) => { P(c, a, false); K(c, 0.6, al(CK, 0.85)); };
    if (v === 'front') {
      limb(c, [4.6, -4.4, 11, -6, 13.4 + ts, -10.4], 3, M, true); fireTip(c, 13.6 + ts, -10.6, 2.4, 0.3, p.glow);
      if (!p.faint) for (const k of [-1, 1]) { const lf = lift(p, k < 0 ? 0 : 1); limb(c, [k * 5.6, -5, k * 9.4, -6, k * 10.6, -1.6 - lf], 2.4, M); for (const t of [-1.2, 0, 1.2]) ball(c, k * 10.6 + t, -0.8 - lf, 0.75, 0.6, M, 0.5); }
      ball(c, 0, -6.4, 7.4, 5.2, M);
      E(c, 0, -4.6, 4.6, 2.6); F(c, G(c, 0, -4.6, 4.6, BE));
      fireTip(c, 0, -16.4, 1.9, 0, p.glow);
      S(c, [0, -17.2, 7.4, -16, 11, -12.4, 9.4, -8.6, 0, -7.4, -9.4, -8.6, -11, -12.4, -7.4, -16], true); FK(c, M, -2, -13, 10);
      crack([-7.6, -10.2, -6, -11.4, -6.6, -13]); crack([7.2, -9.8, 5.6, -11, 7, -12.4]);
      spot(-3.4, -15, 1.2); spot(3.2, -15.2, 1.3); spot(-4.8, -6.6, 1.1); spot(4.6, -6.2, 1.2);
      eyes2(c, p, 5.4, -12.4, 1.95, 2.35, IR);
      if (p.mouth === 'smile') { c.beginPath(); c.moveTo(-4.6, -9.4); c.quadraticCurveTo(0, -6.8, 4.6, -9.4); K(c, 0.85); } else cmouth(c, 0, -9.2, 1, p);
      blush(c, -7.2, -10, 1.4, 0.8); blush(c, 7.2, -10, 1.4, 0.8);
    } else if (v === 'side') {
      S(c, [8.6, -8, 15, -8.8, 20, -11.8 + ts, 21.8, -16 + ts, 22.8, -12.6 + ts, 19.6, -7.2, 14, -4, 8.6, -3.8], true); FK(c, M, 15, -8, 8);
      fireTip(c, 22.2 + ts, -15.4, 2.3, 0.4, p.glow);
      if (!p.faint) { limb(c, [-3.6, -4, -6, -3, -6.6, -0.8 - lift(p, 1)], 2.2, dk(M, 0.2)); limb(c, [6, -4, 8.2, -3, 8.8, -0.8 - lift(p, 0)], 2.2, dk(M, 0.2)); }
      E(c, 2, -5.6, 10.4, 4.4); FK(c, M, 0, -7, 10);
      c.save(); E(c, 2, -5.6, 10.4, 4.4); c.clip(); E(c, 1, -2, 9.4, 2.4); F(c, BE); c.restore();
      spot(-1, -9.2, 1.2); spot(3.6, -9.6, 1.4); spot(8, -8.8, 1.2);
      if (!p.faint) { const s = stepOf(p); limb(c, [-4.6, -3.6, -6.6 - s * 1.5, -2.4, -7.4 - s * 1.5, -0.6 - lift(p, 0)], 2.4, M); limb(c, [5, -3.6, 7 + s * 1.5, -2.4, 7.8 + s * 1.5, -0.6 - lift(p, 1)], 2.4, M); }
      fireTip(c, -7.6, -12.4, 2.2, 0.4, p.glow);
      ball(c, -9.4, -7.6, 6.8, 5.4, M);
      spot(-8.4, -11.6, 1.1);
      crack([-5, -6, -4, -7.4, -4.6, -9]);
      eye1(c, p, -11.6, -8.6, 1.75, 2.2, IR);
      if (p.mouth === 'smile') { c.beginPath(); c.moveTo(-15.8, -5.8); c.quadraticCurveTo(-13.4, -4.4, -11, -5); K(c, 0.85); } else cmouth(c, -13.4, -5.6, 0.9, p, 'w', true);
      blush(c, -11.4, -6, 1.2, 0.7);
    } else {
      if (!p.faint) for (const k of [-1, 1]) {
        limb(c, [k * 5, -11, k * 8.6, -11.8, k * 10, -8.4], 2.3, M);
        limb(c, [k * 5, -4.4, k * 8.6, -4.4, k * 10.2, -1 - lift(p, k < 0 ? 0 : 1)], 2.4, M);
      }
      fireTip(c, 0, -19.6, 2.4, 0, p.glow);
      ball(c, 0, -15.2, 8, 5.8, M);
      ball(c, 0, -8, 6.6, 7.6, M);
      spot(0, -11.6, 1.3); spot(-2.6, -7.6, 1.1); spot(2.6, -6.8, 1.2); spot(-3.6, -16.4, 1); spot(3.8, -16.6, 1.1);
      limb(c, [0, -1.6, 3, 1.4, 7.6 + ts, 0.6, 9.4 + ts, -2.6], 3, M, true);
      fireTip(c, 9.6 + ts, -2.8, 2.2, 0.3, p.glow);
    }
  },
};
CR.lunahop = {
  size: 36, el: 'moon', legH: 1.6, portrait: [0, -19, 26],
  aura(c, v) { glow(c, v === 'side' ? 1 : 0, -16, 21, '#c9b8ff', 0.42); },
  draw(c, v, p) {
    const M = '#dcd6f8', ML = '#f6f4ff', IN = '#a493ea', MOON = '#ffe08a', ST = '#fffbe6', IR = '#4a3a9a', N = '#ff9fc2';
    const hop = p.anim === 'walk' ? [0, 3.4, 2.2, 0][p.f] : 0;
    const air = hop > 0;
    c.translate(0, -hop);
    const speck = (x, y, r = 1) => { star(c, x, y, r * 1.6, r * 0.45, 4); F(c, ST); };
    const sway = p.faint ? 0.6 : p.anim === 'walk' ? hop * 0.06 : p.tail * 0.05;
    const earF = (x, y, rot, col, inner) => {
      c.save(); c.translate(x, y + 7.6); c.rotate(rot); c.translate(0, -7.6);
      E(c, 0, 0, 2.9, 8.2); FK(c, col, -1, -3, 8);
      if (inner) { E(c, 0.2, 0.8, 1.5, 6); F(c, L(c, 0, -5, 0, 6, inner, lt(inner, 0.3))); speck(0.2, -2.4, 0.6); speck(-0.2, 2, 0.5); }
      c.restore();
    };
    if (v === 'front') {
      paws2(c, p, 4.8, -1.6, 3.6, 2.1, ML);
      ball(c, 0, -9.6, 7.6, 7.2, M);
      E(c, 0, -8.2, 4.8, 5); F(c, G(c, 0, -8.2, 5, ML));
      ball(c, -2.6, -4.4, 1.9, 1.6, ML, 0.8); ball(c, 2.6, -4.4, 1.9, 1.6, ML, 0.8);
      earF(-4.2, -31, -0.16 - sway, M, IN); earF(4.2, -31, 0.16 + sway, M, IN);
      ball(c, 0, -19, 8.2, 7.2, M);
      for (const s of [-1, 1]) { P(c, [s * 7.8, -19, s * 10.6, -15.4, s * 7, -14.2]); FK(c, M, s * 8.4, -16, 3, 0.8); }
      crescent(c, 0, -23.6, 2.3, -0.5, MOON);
      eyes2(c, p, 3.6, -19.2, 1.95, 2.5, IR);
      ball(c, 0, -16.2, 0.95, 0.7, N, 0.6);
      cmouth(c, 0, -15.6, 0.75, p, 'w');
      blush(c, -5.6, -16.2, 1.4, 0.8); blush(c, 5.6, -16.2, 1.4, 0.8);
      speck(-4.6, -11.6, 1); speck(5, -7.6, 0.8); speck(-2.2, -5.6, 0.6); speck(6.6, -21.4, 0.7);
    } else if (v === 'side') {
      ball(c, 9.6, -9.6, 3.4, 3.2, ML);
      earF(0.6, -28.6, 0.6 + sway, dk(M, 0.14));
      ball(c, 2.4, -9.4, 8.2, 6.8, M);
      c.beginPath(); c.arc(4.4, -6.4, 4.6, -2.4, -0.2); K(c, 0.7, al(IN, 0.7));
      if (air) { c.save(); c.translate(5.6, -2.6); c.rotate(0.5); ball(c, 0, 0, 5.2, 1.9, ML); c.restore(); ball(c, -7.4, -4, 2, 1.6, ML, 0.8); }
      else { ball(c, 1.4, -1.6, 5.4, 2, ML); ball(c, -5.2, -1.8, 2, 1.6, ML, 0.8); }
      ball(c, -4.4, -18, 7.2, 6.6, M);
      earF(-1.4, -28.2, 0.44 + sway, M, IN);
      crescent(c, -6.6, -22.4, 2, -0.8, MOON);
      eye1(c, p, -7, -18.4, 1.75, 2.4, IR);
      ball(c, -11.2, -16.4, 0.9, 0.7, N, 0.6);
      cmouth(c, -10.4, -15, 0.7, p, 'w', true);
      blush(c, -7.6, -15.6, 1.2, 0.7);
      speck(3.6, -12.4, 1); speck(7.6, -7, 0.8); speck(-1.6, -21.4, 0.7);
    } else {
      paws2(c, p, 4.8, -1.6, 3.6, 2.1, ML);
      ball(c, 0, -9.6, 7.8, 7.4, M);
      earF(-4.2, -31, -0.16 - sway, M); earF(4.2, -31, 0.16 + sway, M);
      ball(c, 0, -19, 8.2, 7.2, M);
      ball(c, 0, -6, 3.6, 3.4, ML);
      speck(-4.4, -12.6, 1); speck(4.8, -9, 0.8); speck(-2, -20.6, 0.8); speck(3.6, -23, 0.6);
    }
  },
};

function creatureSprite(res, id, dir, anim, f) {
  const S = CR[id], p = creaturePose(anim, f);
  const v0 = VIEW[dir] || 'front', v = p.faint ? 'side' : v0, flip = dir === 'right';
  const sz = S.size, hov = S.hover || 0;
  let w = Math.round(sz * 1.8 + 8), h = Math.round(sz * 1.5 + hov + (v === 'back' ? 15 : 12));
  if (p.faint) w += 10;
  if (anim === 'attack') { w += 30; h += 24; }
  const ay = h - (anim === 'attack' && v === 'front' ? 28 : v === 'back' ? 11 : 8);
  const fxAt = f === 0
    ? { front: [0, -sz * 0.32], back: [0, -sz * 0.86], side: [-sz * 0.5, -sz * 0.42] }[v]
    : { front: [0, 3], back: [0, -sz - 1], side: [-sz * 0.6, -sz * 0.36] }[v];
  const fxA = { front: Math.PI / 2, back: -Math.PI / 2, side: Math.PI }[v];
  return make(res, {
    w, h, ax: w / 2, ay, flip,
    body: (c) => { creatureXf(c, p, v, S); S.draw(c, v, p); },
    under: S.aura ? (c) => { creatureXf(c, p, v, S); S.aura(c, v, p); } : null,
    over: (c) => {
      c.save(); creatureXf(c, p, v, S);
      if (p.glow.length) { c.globalCompositeOperation = 'lighter'; for (const [x, y, r, col] of p.glow) glow(c, x, y, r, col, p.faint ? 0.18 : 0.42); c.globalCompositeOperation = 'source-over'; }
      c.restore();
      if (anim === 'attack') { c.save(); c.translate(fxAt[0] + (S.hover && v !== 'side' ? 0 : 0), fxAt[1] - (S.hover || 0)); elFx(c, S.el, f, fxA, sz / 30); c.restore(); }
    },
  });
}

// ---------- murkling ----------
function murklingSprite(res, anim, f) {
  const B = '#4a3b7c', BD = '#211a40', RIM = '#a08cff';
  let sx = 1, sy = 1, lean = 0, dy = 0, eyes = 'open', mouth = 'w';
  if (anim === 'idle') { sx = f ? 1.06 : 1; sy = f ? 0.93 : 1; }
  else if (anim === 'walk') { sx = [1.08, 0.94, 1.08, 0.94][f]; sy = [0.92, 1.07, 0.92, 1.07][f]; lean = [-0.1, 0, 0.1, 0][f]; dy = [0, -1.5, 0, -1.5][f]; }
  else if (anim === 'attack') { eyes = 'angry'; mouth = 'fang'; if (f === 0) { sx = 0.88; sy = 1.16; } else { sx = 1.2; sy = 0.84; dy = 1; } }
  else if (anim === 'hurt') { eyes = 'hurt'; mouth = 'o'; sx = 1.12; sy = 0.86; lean = 0.12; }
  const glows = [];
  const body = (c) => {
    if (anim === 'faint') {
      S(c, [-17, -1, -14, -4.6, -6, -6.4, 2, -6.8, 10, -5.6, 16, -3, 17.4, 0, 12, 1.8, 0, 2.4, -10, 1.8], true);
      F(c, L(c, 0, -7, 0, 2, '#5a4a8e', B, BD)); K(c, 1);
      for (const [x, y, r] of [[-7, -3.6, 1.4], [6, -4.2, 1], [11, -2.4, 0.8]]) { E(c, x, y, r, r); F(c, 'rgba(200,186,255,0.5)'); K(c, 0.5, 'rgba(27,36,64,0.6)'); }
      for (const x of [-4.6, 3]) { c.beginPath(); c.arc(x, -3.6, 1.8, 0.15 * Math.PI, 0.85 * Math.PI); K(c, 1, '#ffe48a'); }
      return;
    }
    c.translate(0, dy); c.rotate(lean); c.scale(sx, sy);
    S(c, [-12.4, -1, -13, -8, -10, -16.4, -4, -21.6, 3, -22, 9.6, -17, 13, -8, 12.6, -1, 9.6, 0.6, 8, -1.2, 6, 1.4, 3, -0.4, 0, 1, -3, -0.4, -6, 1.4, -8.2, -1.2, -10, 0.6], true);
    F(c, RG(c, -3.6, -15, 20, '#6a58a8', B, BD)); K(c, 1);
    // violet rim light so it reads on dark cave floors
    c.save(); S(c, [-12.4, -1, -13, -8, -10, -16.4, -4, -21.6, 3, -22, 9.6, -17, 13, -8, 12.6, -1, 0, 1], true); c.clip();
    c.beginPath(); c.arc(1.6, -6.4, 15.6, Math.PI * 1.02, Math.PI * 1.62); K(c, 1.6, al(RIM, 0.75)); c.restore();
    S(c, [2, -21.6, 4.6, -25.6, 7.4, -24.4, 5.6, -22.6, 5.6, -19.6], true); F(c, B); K(c, 0.9);
    shine(c, -5.6, -16.4, 2.6, 1.5, 0.3, -0.6);
    for (const s of [-1, 1]) {
      const x = s * 4.6, y = -11.6;
      if (eyes === 'hurt') { P(c, [x - 2 * s, y - 2.2, x + 1.8 * s, y, x - 2 * s, y + 2.2], false); K(c, 1.4, '#ffe66b'); continue; }
      E(c, x, y, 2.7, 3.5, -0.18 * s); F(c, RG(c, x - 0.5, y - 0.8, 3.6, '#fffbe0', '#ffe66b', '#ff9e3d')); K(c, 0.9);
      if (eyes === 'angry') { P(c, [x - 3.4 * s, y - 4.2, x + 3 * s, y - 2.2, x + 3 * s, y - 5.6, x - 3.4 * s, y - 5.6]); F(c, B); }
      glows.push([x, y, 6, '#ffd86b']);
    }
    if (mouth === 'fang') { P(c, [-5, -5.6, 5, -5.6, 3.4, -2, 0, -1, -3.4, -2]); F(c, '#140f2a'); K(c, 0.8); P(c, [-3.6, -5.6, -2.6, -3.6, -1.6, -5.6]); F(c, '#fff'); P(c, [1.6, -5.6, 2.6, -3.6, 3.6, -5.6]); F(c, '#fff'); }
    else if (mouth === 'o') { E(c, 0, -5, 1.6, 1.8); F(c, '#140f2a'); }
    else { c.beginPath(); c.moveTo(-2.6, -5.6); c.quadraticCurveTo(-1.3, -4.2, 0, -5.4); c.quadraticCurveTo(1.3, -4.2, 2.6, -5.6); K(c, 0.9, '#ffe9a8'); }
  };
  return make(res, {
    w: 44, h: 42, ax: 22, ay: 34, body,
    over: (c) => {
      c.save(); if (anim !== 'faint') { c.translate(0, dy); c.rotate(lean); c.scale(sx, sy); }
      c.globalCompositeOperation = 'lighter'; for (const [x, y, r, col] of glows) glow(c, x, y, r, col, 0.35); c.restore();
      if (anim === 'hurt') for (const [x, y, r] of [[-14, -16, 1.6], [14, -14, 1.3], [-10, -22, 1]]) { E(c, x, y, r, r); F(c, B); K(c, 0.7); }
      if (anim === 'faint') for (const [x, y] of [[-3, -10], [5, -12]]) { E(c, x, y, 1, 1); K(c, 0.6, 'rgba(200,186,255,0.7)'); }
    },
  });
}

// ---------- bosses ----------
function bossPose(anim, f) {
  const p = { anim, f, bob: 0, sx: 1, sy: 1, eyes: 'open', glow: [], step: 0, wing: 0 };
  if (anim === 'idle') { p.bob = f ? 1.6 : 0; p.sy = f ? 0.985 : 1; p.sx = f ? 1.01 : 1; p.puff = f; p.wing = f ? -0.06 : 0.02; p.pulse = f; }
  else if (anim === 'walk') { p.step = [1, 0, -1, 0][f]; p.bob = [0, -3.4, 0, -3.4][f]; p.wing = [-0.26, 0, 0.22, 0][f]; }
  else if (anim === 'windup') { p.wind = 1; p.eyes = 'blaze'; p.puff = 2; p.pulse = 2; p.wing = -0.42; }
  else if (anim === 'attack') { p.atk = f + 1; p.eyes = 'blaze'; p.wing = f ? 0.34 : -0.1; p.pulse = 2; }
  else if (anim === 'hurt') { p.eyes = 'hurt'; p.hurt = 1; p.wing = -0.18; }
  else { p.eyes = 'closed'; p.faint = 1; p.wing = 0.5; }
  return p;
}
// Lightning polyline with a glow, from (x0,y0) to (x1,y1).
function zap(c, x0, y0, x1, y1, n = 6, jag = 5, w = 2.4, seed = 1) {
  const pts = [x0, y0], dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy), nx = -dy / l, ny = dx / l;
  for (let i = 1; i < n; i++) { const t = i / n, o = Math.sin(i * 2.7 + seed * 1.3) * jag * (i % 2 ? 1 : -1); pts.push(x0 + dx * t + nx * o, y0 + dy * t + ny * o); }
  pts.push(x1, y1);
  c.save(); c.globalCompositeOperation = 'lighter';
  P(c, pts, false); c.lineJoin = 'miter'; c.lineWidth = w * 4; c.strokeStyle = 'rgba(255,230,120,0.22)'; c.stroke();
  c.restore();
  P(c, pts, false); c.lineJoin = 'round'; c.lineCap = 'round';
  c.lineWidth = w + 1.6; c.strokeStyle = INK; c.stroke();
  c.lineWidth = w; c.strokeStyle = '#ffe14d'; c.stroke();
  c.lineWidth = w * 0.35; c.strokeStyle = '#ffffff'; c.stroke();
}
function splash(c, x, y, col, k = 1) {
  for (const [dx, dy, r] of [[-22, -10, 3], [-14, -18, 2.4], [16, -14, 2.6], [24, -6, 2], [-28, -2, 1.8], [6, -20, 2]]) { c.save(); c.translate(x + dx * k, y + dy * k); c.rotate(Math.atan2(dy, dx) + Math.PI / 2); drop(c, 0, 0, r * k, col); c.restore(); }
  E(c, x, y, 30 * k, 5 * k); K(c, 2.6, INK); E(c, x, y, 30 * k, 5 * k); K(c, 1.4, lt(col, 0.3));
}
function rockPoly(c, pts, col, hi = 0.3) {
  P(c, pts); let sx = 0, sy = 0, r = 0; const n = pts.length / 2;
  for (let i = 0; i < pts.length; i += 2) { sx += pts[i]; sy += pts[i + 1]; }
  sx /= n; sy /= n; for (let i = 0; i < pts.length; i += 2) r = Math.max(r, Math.hypot(pts[i] - sx, pts[i + 1] - sy));
  F(c, G(c, sx, sy, r, col, hi, 0.34)); K(c, 1.1);
}

const BOSSES = {};
BOSSES.mirebrute = {
  box: [204, 142, 110, 122], portrait: [-22, -58, 66],
  xf(c, p) {
    if (p.faint) { c.scale(1.12, 0.7); return; }
    c.translate(0, p.bob);
    if (p.wind) { c.translate(44, 0); c.rotate(0.13); c.translate(-44, 0); c.scale(0.95, 1.1); }
    if (p.atk === 1) c.translate(-5, 0);
    if (p.atk === 2) c.scale(1.12, 0.8);
    if (p.hurt) { c.translate(46, 0); c.rotate(-0.07); c.translate(-42, 0); }
    if (p.anim === 'walk') { c.translate(46, 0); c.rotate(p.step * 0.03); c.translate(-46, 0); }
    c.scale(p.sx, p.sy);
  },
  draw(c, p) {
    const B = '#6b8a3e', BL = '#8fb153', BELLY = '#d6d197', MUD = '#80603e', MUD2 = '#5a3f27', MOSS = '#9cc25a', EYE = '#e9ff70', R = '#6f9a3a', CAT = '#8a5a32';
    const wind = p.wind, atk = p.atk, faint = p.faint, s = p.step;
    c.save();
    // reeds growing from its back
    const droop = faint ? 1 : 0;
    for (const [x, y, h, lean, cat] of [[16, -62, 34, -4, 1], [24, -60, 42, 2, 1], [33, -56, 30, 9, 0], [40, -50, 36, 12, 1], [10, -66, 24, -10, 0]]) {
      const tx = x + lean + droop * 18, ty = y - h * (1 - droop * 0.45);
      c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + lean * 0.2, y - h * 0.6, tx, ty); K(c, 3.8, INK); K(c, 2.2, R);
      if (cat) { const cx = x + (tx - x) * 0.82, cy = y + (ty - y) * 0.82; E(c, cx, cy, 2.6, 6.4, Math.atan2(tx - x, -(ty - y))); FK(c, CAT, cx, cy, 6, 1); }
    }
    for (const [x, y, h, lean] of [[20, -60, 30, -12], [36, -54, 28, 16]]) { leafPath(c, x, y, x + lean + droop * 14, y - h * (1 - droop * 0.4), 2, lean * 0.25); FK(c, '#86b74c', x, y - h / 2, h / 2); }
    // hind leg
    ball(c, 38, -20, 21, 16, dk(B, 0.06), 1.1);
    for (const t of [-1, 0, 1]) ball(c, 54 + t * 5, -2.6 + Math.abs(t) * 0.6, 3.6, 2.6, BL, 1);
    ball(c, 50, -6, 8, 5, B, 1.1);
    // body
    const bodyPts = [-50, -20, -55, -40, -46, -62, -22, -78, 8, -80, 36, -70, 53, -50, 55, -28, 44, -8, 10, -3, -30, -5];
    S(c, bodyPts, true); F(c, G(c, -12, -52, 62, B, 0.32, 0.3)); K(c, 1.2);
    c.save(); S(c, bodyPts, true); c.clip();
    E(c, -16, -14, 40, 18); F(c, G(c, -16, -16, 40, BELLY, 0.3, 0.2));
    for (const [x, y, r] of [[-30, -60, 9], [40, -34, 8], [-4, -70, 7], [22, -44, 6]]) { scallop(c, x, y, r, r * 0.7, 0, TAU, 7, 0.2, true); c.closePath(); F(c, al(MOSS, 0.85)); }
    for (const [x, y, r] of [[-38, -48, 2.4], [-18, -56, 2], [6, -60, 2.6], [30, -58, 1.8], [44, -42, 2.2], [-6, -46, 1.6]]) { E(c, x, y, r, r * 0.8); F(c, al(dk(B, 0.35), 0.7)); }
    c.restore();
    // mud armour plates
    const plate = (x, y, rx, ry, rot) => {
      c.save(); c.translate(x, y); c.rotate(rot);
      S(c, [-rx, ry * 0.3, -rx * 0.8, -ry * 0.7, -rx * 0.1, -ry, rx * 0.7, -ry * 0.8, rx, ry * 0.1, rx * 0.6, ry * 0.85, -rx * 0.4, ry * 0.9], true); FK(c, MUD, -rx * 0.3, -ry * 0.4, rx, 1.1);
      P(c, [-rx * 0.5, -ry * 0.6, -rx * 0.1, -ry * 0.05, rx * 0.35, ry * 0.2, rx * 0.5, ry * 0.6], false); K(c, 0.9, MUD2);
      shine(c, -rx * 0.35, -ry * 0.55, rx * 0.35, ry * 0.18, 0.3, -0.2);
      c.restore();
    };
    plate(16, -68, 16, 8.4, 0.18); plate(38, -52, 12, 9, 0.75); plate(-10, -74, 11, 5.6, -0.12); plate(46, -30, 8, 7, 1.2);
    // throat sac and mouth
    const puff = p.puff === 2 ? 1.7 : p.puff ? 1.2 : 1;
    E(c, -24, -25, 19 * Math.min(puff, 1.25), 8 * puff); F(c, G(c, -26, -28, 20, '#e6dfa6', 0.35, 0.2)); K(c, 1);
    for (const t of [-6, 0, 6]) { c.beginPath(); c.moveTo(-24 + t * 1.8, -25 - 3 * puff); c.quadraticCurveTo(-24 + t * 2, -25, -24 + t * 1.8, -25 + 3 * puff); K(c, 0.7, 'rgba(140,130,80,0.6)'); }
    if (atk || p.hurt === 2) {
      const open = atk === 2 ? 14 : 18;
      c.beginPath(); c.moveTo(-54, -42); c.quadraticCurveTo(-24, -34, 10, -44); c.quadraticCurveTo(-14, -42 + open * 1.4, -54, -42 + open * 0.4); c.closePath(); F(c, '#4a1a24'); K(c, 1.2);
      E(c, -24, -36 + open * 0.55, 15, 5); F(c, '#ff8fa0');
    } else {
      c.beginPath(); c.moveTo(-54, -42); c.quadraticCurveTo(-24, -30, 10, -44); K(c, 2.6, INK); c.beginPath(); c.moveTo(-50, -40); c.quadraticCurveTo(-24, -31, 6, -42.4); K(c, 0.8, al(lt(B, 0.4), 0.7));
    }
    if (atk === 1) { // tongue lash
      limb(c, [-46, -36, -66, -34, -84, -30], 5, '#ff8fa0', true);
      ball(c, -86, -30, 6, 5.4, '#ff7a90', 1.1); shine(c, -88, -32, 2, 1.2, 0.6);
    }
    if (faint) { limb(c, [-40, -36, -48, -28, -54, -26], 4, '#ff8fa0', true); }
    for (const [x, y] of [[-47, -53], [-39, -56]]) { E(c, x, y, 1.6, 1.1); F(c, al(dk(B, 0.5), 0.9)); }
    // bulging eyes
    const bulge = (x, y, r) => {
      ball(c, x, y, r, r * 0.9, B, 1.1);
      if (p.eyes === 'closed') { c.beginPath(); c.arc(x, y - r * 0.2, r * 0.6, 0.15 * Math.PI, 0.85 * Math.PI); K(c, 2); return; }
      if (p.eyes === 'hurt') { P(c, [x - r * 0.55, y - r * 0.5, x + r * 0.4, y, x - r * 0.55, y + r * 0.45], false); K(c, 2); return; }
      const er = r * (p.eyes === 'blaze' ? 0.74 : 0.66);
      E(c, x - 1, y + 0.6, er, er * 0.84); F(c, RG(c, x - 2.4, y - 1.4, er * 1.2, '#fbffd8', EYE, '#8fbf1e')); K(c, 1.1);
      E(c, x - 1.8, y + 1, er * (p.eyes === 'blaze' ? 0.5 : 0.58), er * 0.18); F(c, '#1d2a10');
      shine(c, x - er * 0.5, y - er * 0.35, er * 0.22, er * 0.16, 0.9);
      c.save(); E(c, x - 1, y + 0.6, er + 0.6, er * 0.84 + 0.6); c.clip();
      P(c, [x - er - 2, y - er * 0.5, x + er + 2, y - er * 0.05, x + er + 2, y - er - 4, x - er - 2, y - er - 4]); F(c, dk(B, 0.08)); c.restore();
      c.beginPath(); c.moveTo(x - er - 0.6, y - er * 0.5); c.lineTo(x + er + 0.6, y - er * 0.05); K(c, 1.4);
      p.glow.push([x - 1, y, r * (p.eyes === 'blaze' ? 2.8 : 2.1), '#d8ff6a']);
    };
    bulge(-34, -66, 11.4); bulge(-6, -76, 9.6);
    // front arms
    const arm = (x0, y0, x1, y1, col) => {
      limb(c, [x0, y0, (x0 + x1) / 2 - 7, (y0 + y1) / 2, x1, y1 - 5], 10, col, true);
      for (const t of [-1, 0, 1]) ball(c, x1 + t * 5.6, y1 - 1.4 + Math.abs(t) * 0.4, 3.8, 2.6, lt(col, 0.18), 1);
      ball(c, x1, y1 - 4.4, 7.4, 5, col, 1.1);
    };
    const lift1 = p.anim === 'walk' && p.f === 1 ? 5 : wind ? 14 : 0, lift2 = p.anim === 'walk' && p.f === 3 ? 5 : wind ? 10 : 0;
    arm(4, -22, 8 + s * 2, -2 - lift2, dk(B, 0.08));
    arm(-36, -26, -48 - s * 2, -2 - lift1, B);
    c.restore();
  },
  over(c, p) {
    if (p.atk === 2) splash(c, -10, 0, '#8a6a44', 1.5);
    if (p.wind) for (const [x, y, a] of [[-66, -82, -2.4], [-60, -96, -2], [-46, -104, -1.6]]) { c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * 8, y + Math.sin(a) * 8); K(c, 2.6, INK); c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * 8, y + Math.sin(a) * 8); K(c, 1.4, '#fff3b0'); }
    if (p.hurt) for (const [x, y, r] of [[-60, -70, 3.4], [58, -64, 2.8], [-52, -88, 2.2]]) { E(c, x, y, r, r * 0.8); FK(c, '#80603e', x, y, r, 0.9); }
    if (p.faint) for (const [x, y, r] of [[-40, -54, 2.6], [-48, -66, 1.8], [-36, -74, 1.3]]) { E(c, x, y, r, r); K(c, 1, 'rgba(255,255,255,0.8)'); }
  },
};
BOSSES.quartzhulk = {
  box: [184, 234, 92, 196], portrait: [-6, -108, 62],
  xf(c, p) {
    if (p.faint) { c.translate(0, 26); c.rotate(-0.1); c.scale(1.05, 0.8); return; }
    c.translate(0, p.bob);
    if (p.anim === 'walk') c.rotate(p.step * 0.035);
    if (p.atk === 1) { c.translate(-8, 4); c.rotate(-0.1); }
    if (p.atk === 2) { c.translate(-4, 2); c.rotate(-0.05); }
    if (p.hurt) { c.translate(6, 0); c.rotate(0.07); }
    if (p.wind) c.translate(0, -3);
    c.scale(p.sx, p.sy);
  },
  draw(c, p) {
    const ST = '#7c7a9b', SL = '#aeacca', SD = '#55536f', MOSS = '#86b66c', TEAL = '#4fe0d0', LAV = '#c3a2ff';
    const wind = p.wind, atk = p.atk, faint = p.faint, s = p.step;
    const cluster = (x, y, rot, k, cols) => { c.save(); c.translate(x, y); c.rotate(rot); c.scale(k, k); gem(c, -5, 2, 6, 15, -0.38, cols[0]); gem(c, 5.4, 2, 6, 13, 0.42, cols[1]); gem(c, 0, 0, 7.6, 22, 0.02, cols[2]); c.restore(); };
    const lump = (x, y, rx, ry, col, seed = 0) => {
      const pts = [];
      for (let i = 0; i < 9; i++) { const a = i / 9 * TAU + seed, k = 0.88 + 0.12 * Math.sin(i * 2.3 + seed * 3); pts.push(x + Math.cos(a) * rx * k, y + Math.sin(a) * ry * k); }
      S(c, pts, true, 0.75); F(c, G(c, x, y, Math.max(rx, ry), col, 0.34, 0.36)); K(c, 1.1);
    };
    const rockLimb = (x0, y0, x1, y1, w, col) => {
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.lineCap = 'round';
      c.lineWidth = w + 2.4; c.strokeStyle = INK; c.stroke(); c.lineWidth = w; c.strokeStyle = col; c.stroke();
      c.beginPath(); c.moveTo(x0 - w * 0.22, y0 - w * 0.18); c.lineTo(x1 - w * 0.22, y1 - w * 0.18); c.lineWidth = w * 0.28; c.strokeStyle = al(lt(col, 0.35), 0.7); c.stroke();
    };
    const arm = (sx, sy, fx, fy, col, out, near) => {
      const ex = (sx + fx) / 2 + out * 9, ey = (sy + fy) / 2 + 2;
      rockLimb(sx, sy, ex, ey, 13, col); rockLimb(ex, ey, fx, fy - 6, 15, col);
      lump(ex, ey, 8, 7, dk(col, 0.04), 1);
      lump(fx, fy, 17, 14.5, col, 2);
      for (const t of [-0.5, 0, 0.5]) { c.beginPath(); c.moveTo(fx + t * 15 - 2, fy - 12); c.quadraticCurveTo(fx + t * 15, fy - 7, fx + t * 15 - 1, fy - 3); K(c, 1, al(SD, 0.9)); }
      gem(c, fx + 7, fy - 11, 4.4, 9, 0.55, near ? TEAL : LAV);
      lump(sx, sy, 14, 12, lt(col, 0.05), 3);
    };
    const pose = wind ? [[-30, -160], [26, -162]] : atk === 1 ? [[-46, -16], [-4, -14]] : atk === 2 ? [[-52, -12], [30, -14]]
      : faint ? [[-62, -26], [52, -28]] : p.anim === 'walk' ? [[-58, -18 - (s > 0 ? 5 : 0)], [56, -20 - (s < 0 ? 5 : 0)]] : [[-58, -18 + p.bob * 0.3], [56, -20 + p.bob * 0.3]];
    const [na, fa] = pose;
    arm(36, -100, fa[0], fa[1], dk(ST, 0.14), 1, false);
    // legs
    const lL = p.anim === 'walk' && s > 0 ? 6 : 0, lR = p.anim === 'walk' && s < 0 ? 6 : 0;
    lump(15, -15 - lR, 13, 15, dk(ST, 0.12), 4); lump(-17, -16 - lL, 14, 16, ST, 5);
    for (const [x, y] of [[-17, -2 - lL], [15, -1 - lR]]) { RR(c, x - 13, y - 5, 26, 7, 3); F(c, G(c, x, y - 2, 13, SD, 0.3, 0.3)); K(c, 1); }
    // torso: a rugged boulder
    const tor = [-46, -100, -30, -118, -4, -124, 24, -120, 48, -102, 46, -74, 36, -46, 22, -30, -20, -28, -38, -46, -48, -74];
    S(c, tor, true, 0.7); F(c, G(c, -8, -82, 60, ST, 0.32, 0.36)); K(c, 1.3);
    c.save(); S(c, tor, true, 0.7); c.clip();
    S(c, [-48, -102, -28, -122, 4, -128, 30, -122, 50, -104, 18, -98, -16, -98], true, 0.7); F(c, al(SL, 0.85));
    for (const [x, y, r] of [[-30, -110, 8], [10, -118, 7], [36, -104, 6]]) { scallop(c, x, y, r, r * 0.5, 0, TAU, 6, 0.25, true); c.closePath(); F(c, al(MOSS, 0.8)); }
    for (const a of [[-34, -88, -24, -72, -30, -54], [32, -90, 24, -74, 30, -50], [-8, -38, 2, -46, 14, -40], [12, -96, 6, -86]]) { P(c, a, false); K(c, 1.2, al(SD, 0.95)); }
    E(c, 8, -40, 26, 9); F(c, al(SD, 0.25));
    c.restore();
    for (const [x, y, r, col] of [[-28, -60, 0.4, TEAL], [30, -66, -0.4, LAV], [22, -42, 0.2, TEAL]]) gem(c, x, y, 3.4, 7, r, col);
    // glowing core with rays
    const cr = p.pulse === 2 ? 11.6 : p.pulse ? 10.4 : 9.8, coreCol = faint ? '#5a6a86' : '#8ffaff';
    P(c, [-20, -68, -13, -82, 1, -82, 8, -68, 1, -54, -13, -54]); F(c, G(c, -6, -68, 15, SD, 0.2, 0.3)); K(c, 1.2);
    for (const [x0, y0, x1, y1] of [[-20, -68, -13, -82], [1, -82, 8, -68], [1, -54, -13, -54]]) { c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); K(c, 1.6, al(TEAL, faint ? 0.25 : 0.8)); }
    E(c, -6, -68, cr, cr); F(c, RG(c, -8, -70, cr * 1.1, '#ffffff', coreCol, faint ? '#34405a' : '#21a7c0')); K(c, 1.1);
    if (!faint) { star(c, -8, -70, cr * 0.62, cr * 0.18, 4, 0); F(c, 'rgba(255,255,255,0.9)'); p.glow.push([-6, -68, cr * (p.pulse === 2 ? 4.2 : 3.2), '#7ff6ff']); }
    // shoulders, crystals and head
    cluster(-42, -110, -0.5, 1.05, [LAV, TEAL, TEAL]);
    cluster(42, -108, 0.45, 1.15, [TEAL, LAV, LAV]);
    const hx = -8, hy = wind ? -122 : -118;
    lump(hx, hy, 15, 12, SL, 6);
    cluster(hx + 3, hy - 10, 0.12, 0.6, [TEAL, LAV, TEAL]);
    S(c, [hx - 14, hy - 3, hx - 4, hy - 7, hx + 10, hy - 6, hx + 14, hy - 1, hx + 6, hy + 3, hx - 10, hy + 3], true); F(c, '#2d2b44'); K(c, 1);
    for (const ex of [hx - 6.4, hx + 5]) {
      if (p.eyes === 'closed') { c.beginPath(); c.moveTo(ex - 3, hy - 0.6); c.lineTo(ex + 3, hy - 0.4); K(c, 1.2, '#5a6080'); continue; }
      if (p.eyes === 'hurt') { P(c, [ex - 3, hy - 3, ex + 2, hy - 0.6, ex - 3, hy + 1.6], false); K(c, 1.3, '#bffcff'); continue; }
      const b = p.eyes === 'blaze';
      P(c, [ex - 3.8, hy - 2.6, ex + 3.6, hy - 1.8, ex + 3, hy + 0.8, ex - 3.4, hy + 0.4]); F(c, RG(c, ex, hy - 1, 4, '#ffffff', b ? '#dffcff' : '#9ffcff', '#3fd0e0'));
      p.glow.push([ex, hy - 1, b ? 10 : 7, '#7ff6ff']);
    }
    arm(-38, -102, na[0], na[1], ST, -1, true);
  },
  over(c, p) {
    if (p.atk === 1) {
      for (const [x, y, r, a] of [[-76, -22, 4, 0], [-64, -38, 3, 0.6], [-22, -32, 3.4, 1.1], [-84, -8, 2.6, 0.4], [10, -26, 2.6, 2]]) { c.save(); c.translate(x, y); c.rotate(a); rockPoly(c, [-r, 0, -r * 0.3, -r, r, -r * 0.4, r * 0.8, r * 0.7, -r * 0.4, r * 0.8], '#8a88a8'); c.restore(); }
      for (const a of [[-62, 2, -74, 6, -84, 4], [-30, 3, -20, 7, -10, 6], [-46, 3, -48, 9]]) { P(c, a, false); K(c, 2.2, INK); P(c, a, false); K(c, 0.9, '#bffcff'); }
    }
    if (p.atk === 2) for (const [x, y, r] of [[-62, -6, 7], [-46, -10, 5], [34, -4, 6]]) { E(c, x, y, r, r * 0.7); F(c, 'rgba(220,214,240,0.65)'); }
    if (p.wind) for (const [x, y] of [[-46, -184], [36, -186], [-6, -190]]) { star(c, x, y, 4, 1.2, 4); F(c, '#dffcff'); }
    if (p.hurt) { c.save(); c.translate(-64, -124); c.rotate(-0.6); gem(c, 0, 0, 4, 9, 0, '#4fe0d0'); c.restore(); }
  },
};
const TEMP_HEAD = { idle: [-44, -140, 0], windup: [-32, -158, -0.3], atk1: [-58, -126, 0.35], atk2: [-48, -136, 0.12], faint: [-62, -92, 0.5], hurt: [-32, -148, -0.2] };
const tempHead = (p) => TEMP_HEAD[p.wind ? 'windup' : p.atk ? 'atk' + p.atk : p.faint ? 'faint' : p.hurt ? 'hurt' : 'idle'];
const TLEAD = [0, -8, 24, -42, 58, -62, 98, -58];
const TTRAIL = [[98, -58], [94, -38], [84, -22], [70, -8], [54, 2], [36, 8], [18, 12], [0, 12]];
function bez3(t, a) { const u = 1 - t; return [u * u * u * a[0] + 3 * u * u * t * a[2] + 3 * u * t * t * a[4] + t * t * t * a[6], u * u * u * a[1] + 3 * u * u * t * a[3] + 3 * u * t * t * a[5] + t * t * t * a[7]]; }
function tempWingPath(c) {
  c.beginPath(); c.moveTo(0, -8);
  let prev = [0, -8];
  for (let i = 1; i <= 7; i++) {
    const q = bez3(i / 7, TLEAD), m = bez3((i - 0.5) / 7, TLEAD), dx = q[0] - prev[0], dy = q[1] - prev[1], l = Math.hypot(dx, dy) || 1;
    c.quadraticCurveTo(m[0] + dy / l * 7, m[1] - dx / l * 7, q[0], q[1]); prev = q;
  }
  for (let i = 0; i < TTRAIL.length - 1; i++) { const [x0, y0] = TTRAIL[i], [x1, y1] = TTRAIL[i + 1]; c.quadraticCurveTo((x0 + x1) / 2 + 8, (y0 + y1) / 2 + 12, x1, y1); }
  c.closePath();
}
BOSSES.tempestra = {
  box: [276, 284, 138, 216], portrait: [-50, -146, 68],
  xf(c, p) {
    if (p.faint) { c.translate(0, 50); c.scale(1.04, 0.86); return; }
    c.translate(0, p.bob - (p.anim === 'walk' ? [3, 0, -3, 0][p.f] : 0));
    if (p.hurt) { c.translate(8, -2); c.rotate(0.06); }
    if (p.atk === 1) c.translate(-6, 6);
  },
  draw(c, p) {
    const CL = '#353d66', CL2 = '#4f5b90', CL3 = '#7280b8', CLD = '#22284a', BELLY = '#8a95c4', BK = '#97a3cc', Y = '#ffe14d', EYE = '#c9f8ff';
    const atk = p.atk, faint = p.faint, wingRot = p.wing, open = (atk || p.wind) ? 1 : 0;
    c.save(); if (faint) c.globalAlpha = 0.93;
    const veinCol = faint ? '#7a7a90' : Y;
    const wing = (k, col, far) => {
      c.save(); c.translate(k * 14, -106); c.scale(k, 1); c.rotate(wingRot);
      tempWingPath(c); F(c, L(c, 0, -62, 0, 16, lt(col, 0.1), col, dk(col, 0.32)));
      c.save(); tempWingPath(c); c.clip();
      for (let i = 1; i <= 7; i++) { const q = bez3(i / 7.6, TLEAD); E(c, q[0] + 2, q[1] + 9, 11 - i * 0.7, 7.4 - i * 0.45); F(c, al(CL3, far ? 0.3 : 0.5)); }
      for (let i = 1; i < TTRAIL.length - 1; i++) { const [x, y] = TTRAIL[i]; E(c, x - 3, y + 4, 9, 5); F(c, al(CLD, 0.5)); }
      c.restore();
      tempWingPath(c); K(c, 1.2);
      for (let i = 1; i < TTRAIL.length - 2; i++) { const [x0, y0] = TTRAIL[i]; c.beginPath(); c.moveTo(x0, y0); c.quadraticCurveTo(x0 - 10, y0 - 8, x0 - 22, y0 - 8); K(c, 0.9, al(dk(col, 0.45), 0.85)); }
      const vein = [6, -6, 22, -15, 34, -12, 50, -27, 62, -24, 80, -42, 94, -48];
      P(c, vein, false); K(c, 2.8, INK); P(c, vein, false); K(c, 1.5, far ? mix(veinCol, CL, 0.25) : veinCol); P(c, vein, false); K(c, 0.5, faint ? '#9a9ab0' : '#ffffff');
      const br = [50, -27, 58, -12, 72, -10];
      P(c, br, false); K(c, 2.2, INK); P(c, br, false); K(c, 1.1, faint ? '#7a8aa0' : '#9fe8ff');
      if (!faint) { const cr = Math.cos(wingRot), sr = Math.sin(wingRot); p.glow.push([k * (14 + 50 * cr + 27 * sr), -106 + 50 * sr - 27 * cr, 18, '#ffe66b']); }
      c.restore();
    };
    wing(1, dk(CL, 0.12), true);
    // serpent tail
    S(c, [4, -78, 32, -66, 46, -42, 34, -18, 8, -12, 2, -18, 22, -26, 32, -42, 20, -60, -2, -66], true); F(c, L(c, 0, -78, 0, -12, CL2, CL, CLD)); K(c, 1.2);
    c.beginPath(); c.moveTo(30, -60); c.quadraticCurveTo(40, -44, 30, -26); K(c, 1, al(CL3, 0.7));
    c.save(); c.translate(2, -14); c.rotate(-0.3); P(c, [-2, -4, -10, 1, -6, 1.6, -12, 7, -1, 0.6, -4.6, 0]); F(c, faint ? '#8a8aa0' : Y); K(c, 0.9); c.restore();
    // cloud body
    scallop(c, 0, -88, 32, 25, 0, TAU, 12, 0.11, true); c.closePath(); F(c, G(c, -8, -96, 34, CL2, 0.28, 0.34)); K(c, 1.3);
    c.save(); scallop(c, 0, -88, 32, 25, 0, TAU, 12, 0.11, true); c.clip();
    scallop(c, -4, -70, 24, 11, 0, TAU, 8, 0.12, true); F(c, al(BELLY, 0.9));
    for (const [x, y, r] of [[-16, -106, 9], [6, -110, 8], [22, -100, 7]]) { E(c, x, y, r, r * 0.6); F(c, al(CL3, 0.45)); }
    c.restore();
    for (const x of [-11, 9]) { limb(c, [x, -66, x - 2, -58, x - 5, -54], 2.6, CLD); for (const t of [-2.2, 0, 2.2]) { c.beginPath(); c.moveTo(x - 5, -54); c.lineTo(x - 5 + t, -50.6); K(c, 1.1, '#d3dcf6'); } }
    bolt(c, -4, -90, 1.9, 0.15); F(c, faint ? '#8a8aa0' : Y); K(c, 0.8);
    if (!faint) p.glow.push([-4, -90, 14, '#ffe66b']);
    wing(-1, CL, false);
    // neck with a cloud mane
    const [hx, hy, hr] = tempHead(p);
    const nk = [-8, -102, (hx - 8) / 2 + 2, (hy - 102) / 2 - 4, hx + 8, hy + 6];
    for (let i = 0; i < 4; i++) { const t = (i + 0.5) / 4, x = nk[0] + (nk[4] - nk[0]) * t + 7 + Math.sin(t * Math.PI) * 3, y = nk[1] + (nk[5] - nk[1]) * t - 3; scallop(c, x, y, 6.6, 5.4, 0, TAU, 6, 0.18, true); c.closePath(); F(c, G(c, x - 2, y - 2, 7, CL, 0.25, 0.3)); K(c, 1); }
    S(c, nk, false); c.lineCap = 'round'; c.lineWidth = 19; c.strokeStyle = INK; c.stroke(); c.lineWidth = 16.4; c.strokeStyle = CL2; c.stroke();
    S(c, [nk[0] - 3, nk[1] + 3, nk[2] - 4, nk[3] + 4, nk[4] - 3, nk[5] + 3], false); c.lineWidth = 5; c.strokeStyle = al(BELLY, 0.9); c.stroke();
    c.save(); c.translate(hx, hy); c.rotate(hr);
    for (const [x, y, l, a] of [[4, -9, 34, -1.3], [8, -7, 32, -0.8], [12, -2, 27, -0.32], [12, 4, 20, 0.15]]) {
      c.save(); c.translate(x, y); c.rotate(a);
      P(c, [0, -3, l * 0.38, -5, l * 0.32, -1, l * 0.72, -4.4, l * 0.62, -0.6, l, -2.6, l * 0.6, 3.4, l * 0.66, 0.8, l * 0.3, 4, l * 0.34, 1.4, 0, 3.4]);
      F(c, L(c, 0, 0, l, 0, faint ? '#8a8aa0' : '#fff6b8', faint ? '#6a6a80' : Y)); K(c, 1);
      if (!faint) p.glow.push([hx + x + Math.cos(a + hr) * l * 0.6, hy + y + Math.sin(a + hr) * l * 0.6, p.wind ? 18 : 12, '#ffe66b']);
      c.restore();
    }
    S(c, [-12, -9, 2, -13, 13, -8, 17, 2, 10, 10, -4, 10, -12, 3], true); F(c, G(c, -2, -4, 17, CL3, 0.32, 0.3)); K(c, 1.2);
    scallop(c, 11, 6, 6, 4.6, 0, TAU, 5, 0.2, true); c.closePath(); F(c, CL); K(c, 0.9);
    const o = open * 7;
    if (open) { P(c, [-9, 1.4, -32, 2.4, -31, 4 + o * 1.4, -9, 4]); F(c, '#2a1030'); if (!faint) { glow(c, -18, 3 + o * 0.6, 7, '#fff27a', 0.8); p.glow.push([hx - 18, hy + 4, 12, '#fff27a']); } }
    c.beginPath(); c.moveTo(-9, 3); c.quadraticCurveTo(-20, 4 + o, -31, 4 + o * 1.4); c.quadraticCurveTo(-22, 8.4 + o, -8, 8.4); c.closePath(); F(c, G(c, -18, 5 + o, 10, dk(BK, 0.12), 0.3, 0.3)); K(c, 1);
    c.beginPath(); c.moveTo(-8, -8); c.quadraticCurveTo(-25, -9.4, -37, -0.6); c.quadraticCurveTo(-36, 3.6, -32, 3.4); c.quadraticCurveTo(-22, 0.6, -9, 2.4); c.closePath(); F(c, G(c, -20, -4, 14, BK, 0.42, 0.3)); K(c, 1.1);
    c.beginPath(); c.moveTo(-12, -5.4); c.quadraticCurveTo(-24, -6, -33, -0.6); K(c, 0.9, al(lt(BK, 0.5), 0.8));
    E(c, -24, -4.6, 1.2, 0.7); F(c, CLD);
    P(c, [-15, -7.6, 2, -12, 4.4, -7.6, -13, -3.6]); F(c, CLD); K(c, 0.9);
    if (p.eyes === 'closed') { c.beginPath(); c.arc(-5, -2.6, 3.4, 0.15 * Math.PI, 0.85 * Math.PI); K(c, 1.5); }
    else if (p.eyes === 'hurt') { P(c, [-8, -5.6, -2.4, -2.8, -8, -0.4], false); K(c, 1.6, EYE); }
    else {
      P(c, [-11, -3, -2, -6.2, 1.6, -2.6, -4.6, -0.2]); F(c, RG(c, -4, -3, 6, '#ffffff', EYE, '#4fc8ff')); K(c, 0.9);
      p.glow.push([hx - 4, hy - 3, p.eyes === 'blaze' ? 14 : 9, '#9fe8ff']);
    }
    c.restore();
    c.restore();
  },
  under(c, p) { if (!p.faint) glow(c, 0, -104, 116, '#7a86c8', 0.16); },
  over(c, p) {
    const dy = p.bob - (p.anim === 'walk' ? [3, 0, -3, 0][p.f] : 0);
    if (p.wind) { const [hx, hy] = TEMP_HEAD.windup; c.save(); c.translate(hx + 14, hy - 10 + dy); for (const [a, r] of [[-1.9, 34], [-1.2, 38], [-2.5, 30], [-0.6, 30]]) zap(c, Math.cos(a) * 16, Math.sin(a) * 16, Math.cos(a) * r, Math.sin(a) * r, 3, 3, 1.6, a); c.restore(); }
    if (p.atk === 1) zap(c, -98, -122 + dy, -114, -2, 7, 7, 3.4, 2);
    if (p.atk === 2) { zap(c, -74, -156, -88, -4, 6, 6, 2.6, 4); zap(c, 62, -156, 80, -4, 6, 6, 2.6, 7); for (const y of [-62, -42]) { c.beginPath(); c.moveTo(-122, y); c.quadraticCurveTo(-100, y - 6, -80, y); K(c, 1.8, 'rgba(230,240,255,0.85)'); } }
    if (p.hurt) for (const [x, y, r] of [[62, -144, 7], [-84, -124, 6], [32, -60, 5]]) { scallop(c, x, y, r, r * 0.7, 0, TAU, 6, 0.15, true); c.closePath(); F(c, 'rgba(78,90,140,0.8)'); K(c, 0.9); }
    if (p.faint) for (const [x, y, r] of [[-40, -62, 6], [30, -72, 7], [72, -48, 5]]) { scallop(c, x, y, r, r * 0.7, 0, TAU, 6, 0.15, true); c.closePath(); F(c, 'rgba(120,130,170,0.4)'); }
  },
};
function bossSprite(res, kind, anim, f, flip) {
  const Bs = BOSSES[kind], p = bossPose(anim, f), [w, h, ax, ay] = Bs.box;
  return make(res, {
    w, h, ax, ay, flip, ow: 1.35,
    under: Bs.under ? (c) => Bs.under(c, p) : null,
    body: (c) => { c.save(); Bs.xf(c, p); Bs.draw(c, p); c.restore(); },
    over: (c) => {
      c.save(); Bs.xf(c, p); c.globalCompositeOperation = 'lighter';
      for (const [x, y, r, col] of p.glow) glow(c, x, y, r, col, p.eyes === 'blaze' ? 0.5 : 0.38);
      c.restore();
      if (Bs.over) Bs.over(c, p);
    },
  });
}

// ---------- props ----------
// Soft contact shadow, pushed a little toward the bottom-right (light comes from the top-left).
function shade(c, x, y, rx, ry, a = 0.26) {
  c.save(); c.translate(x, y); c.scale(1, ry / rx);
  c.beginPath(); c.arc(0, 0, rx, 0, TAU);
  c.fillStyle = RG(c, 0, 0, rx, `rgba(18,24,52,${a})`, `rgba(18,24,52,${a * 0.75})`, 'rgba(18,24,52,0)'); c.fill();
  c.restore();
}
function lump(c, x, y, rx, ry, col, seed = 0, k = 0.75) {
  const pts = [];
  for (let i = 0; i < 9; i++) { const a = i / 9 * TAU + seed, q = 0.88 + 0.12 * Math.sin(i * 2.3 + seed * 3); pts.push(x + Math.cos(a) * rx * q, y + Math.sin(a) * ry * q); }
  S(c, pts, true, k); F(c, G(c, x, y, Math.max(rx, ry), col, 0.34, 0.36)); K(c, 1);
}
// A rock that sits on the ground: flat-ish bottom at y, dome above.
function stone(c, x, y, w, h, col, seed = 0, moss) {
  const pts = [x - w * 0.5, y, x - w * 0.52, y - h * 0.45, x - w * 0.3, y - h * 0.9, x + w * 0.05, y - h, x + w * 0.38, y - h * 0.82, x + w * 0.52, y - h * 0.4, x + w * 0.46, y, x, y + h * 0.06];
  for (let i = 2; i < pts.length - 2; i += 2) { pts[i] += Math.sin(i * 1.7 + seed) * w * 0.03; pts[i + 1] += Math.cos(i * 2.1 + seed) * h * 0.03; }
  S(c, pts, true, 0.8); F(c, G(c, x - w * 0.1, y - h * 0.55, Math.max(w, h) * 0.6, col, 0.36, 0.38)); K(c, 1);
  c.beginPath(); c.moveTo(x - w * 0.28, y - h * 0.72); c.quadraticCurveTo(x - w * 0.05, y - h * 0.9, x + w * 0.18, y - h * 0.8); K(c, Math.max(0.8, h * 0.07), 'rgba(255,255,255,0.35)');
  c.beginPath(); c.moveTo(x + w * 0.1, y - h * 0.45); c.lineTo(x + w * 0.2, y - h * 0.25); c.lineTo(x + w * 0.16, y - h * 0.08); K(c, 0.7, al(dk(col, 0.4), 0.8));
  if (moss) { c.save(); S(c, pts, true, 0.8); c.clip(); scallop(c, x - w * 0.08, y - h * 1.02, w * 0.4, h * 0.26, 0, TAU, 7, 0.25, true); F(c, al(moss, 0.92)); c.restore(); S(c, pts, true, 0.8); K(c, 1); }
}
function leafBlob(c, x, y, r, col, seed = 0) {
  scallop(c, x, y, r, r * 0.92, seed, TAU + seed, 9, 0.09, true); c.closePath(); FK(c, col, x, y, r, 1);
  for (const [dx, dy] of [[-0.42, -0.3], [-0.05, -0.55], [-0.5, 0.15], [0.2, -0.2]]) {
    const px = x + dx * r, py = y + dy * r;
    c.beginPath(); c.arc(px, py + 1.6, 1.8, 1.15 * Math.PI, 1.85 * Math.PI); K(c, 0.75, al(lt(col, 0.5), 0.9));
  }
}
function trunk(c, h, w, col) {
  c.beginPath(); c.moveTo(-w * 1.8, 0.4); c.quadraticCurveTo(-w * 0.9, -1.4, -w, -h * 0.35); c.lineTo(-w * 0.8, -h);
  c.lineTo(w * 0.8, -h); c.lineTo(w, -h * 0.35); c.quadraticCurveTo(w * 0.9, -1.4, w * 1.8, 0.4); c.quadraticCurveTo(0, 1.6, -w * 1.8, 0.4); c.closePath();
  F(c, L(c, -w, 0, w, 0, lt(col, 0.18), col, dk(col, 0.3))); K(c, 1);
  for (const t of [-0.4, 0.15, 0.5]) { c.beginPath(); c.moveTo(w * t, -h * 0.15); c.quadraticCurveTo(w * (t + 0.15), -h * 0.5, w * t * 0.8, -h * 0.9); K(c, 0.7, al(dk(col, 0.4), 0.7)); }
}
function plankRow(c, x, y, w, h, col, dir = 'h') {
  RR(c, x, y, w, h, 0.8); F(c, dir === 'h' ? L(c, 0, y, 0, y + h, lt(col, 0.16), col, dk(col, 0.15)) : L(c, x, 0, x + w, 0, lt(col, 0.16), col, dk(col, 0.15)));
  c.lineWidth = 0.6; c.strokeStyle = al(dk(col, 0.35), 0.6);
  c.beginPath();
  if (dir === 'h') { c.moveTo(x + w * 0.15, y + h * 0.45); c.quadraticCurveTo(x + w * 0.5, y + h * 0.3, x + w * 0.85, y + h * 0.55); }
  else { c.moveTo(x + w * 0.45, y + h * 0.1); c.quadraticCurveTo(x + w * 0.3, y + h * 0.5, x + w * 0.55, y + h * 0.9); }
  c.stroke();
}
function windowLit(c, x, y, w, h, frame = '#7a4a2e') {
  RR(c, x - 1.2, y - 1.2, w + 2.4, h + 2.4, 1.6); F(c, frame); K(c, 0.9);
  RR(c, x, y, w, h, 1); F(c, L(c, x, y, x + w, y + h, '#fff6c8', '#ffd779', '#f2a64a'));
  c.beginPath(); c.moveTo(x + w / 2, y); c.lineTo(x + w / 2, y + h); c.moveTo(x, y + h / 2); c.lineTo(x + w, y + h / 2); K(c, 1.1, frame);
  c.beginPath(); c.moveTo(x + 1.2, y + h * 0.4); c.lineTo(x + w * 0.4, y + 1.2); K(c, 0.8, 'rgba(255,255,255,0.7)');
}
function flowerBox(c, x, y, w, cols) {
  RR(c, x, y, w, 3.6, 1); FK(c, '#a8713e', x + w / 2, y + 1.6, w / 2, 0.8);
  for (let i = 0; i < 4; i++) { const fx = x + 2 + i * (w - 4) / 3; leafBlob(c, fx, y - 0.6, 1.9, '#5cb84a', i); ball(c, fx + 0.4, y - 1.8, 1.2, 1.2, cols[i % cols.length], 0.6); }
}
function shingles(c, pts, col, rows, x0, x1, y0, y1) {
  P(c, pts); F(c, L(c, 0, y0, 0, y1, lt(col, 0.22), col, dk(col, 0.18))); K(c, 1.1);
  c.save(); P(c, pts); c.clip();
  for (let i = 1; i <= rows; i++) {
    const y = y0 + (y1 - y0) * i / (rows + 0.4);

    c.beginPath(); c.moveTo(x0 - 10, y);
    for (let x = x0 - 10; x < x1 + 10; x += 7) c.quadraticCurveTo(x + 3.5, y + 3.4, x + 7, y);
    K(c, 0.9, al(dk(col, 0.35), 0.75));
  }
  c.restore();
}
function cottage(c, roof, o = {}) {
  const W = o.w || 44, H = o.wallH || 40, RH = o.roofH || 46, ov = 8;
  // foundation and wall
  RR(c, -W - 2, -9, W * 2 + 4, 9, 2); F(c, L(c, 0, -9, 0, 0, '#c2b8a8', '#8f8678')); K(c, 1);
  for (let x = -W + 4; x < W; x += 10) { c.beginPath(); c.moveTo(x, -9); c.lineTo(x + (x % 20 ? 2 : -2), 0); K(c, 0.6, 'rgba(60,54,70,0.5)'); }
  RR(c, -W, -H - 6, W * 2, H, 1.5); F(c, L(c, -W, -H, W, 0, '#fff6e2', '#f2e2c4', '#dcc6a2')); K(c, 1.1);
  for (const x of [-W + 2.5, W - 2.5, (o.beam ?? -W * 0.42)]) { RR(c, x - 2.2, -H - 6, 4.4, H, 0.6); F(c, '#8a5a36'); K(c, 0.7); }
  RR(c, -W, -H * 0.62 - 6, W * 2, 3.6, 0.6); F(c, '#8a5a36'); K(c, 0.7);
  // roof (front slope, seen from above)
  const ry = -H - 6, top = ry - RH;
  const pts = [-W - ov, ry + 3, -W + 6, top, W - 6, top, W + ov, ry + 3];
  shingles(c, pts, roof, 4, -W - ov, W + ov, top, ry + 3);
  P(c, [-W + 4, top - 2, W - 4, top - 2, W - 6, top + 4, -W + 6, top + 4]); F(c, dk(roof, 0.25)); K(c, 0.9);
  c.beginPath(); c.moveTo(-W - ov + 2, ry + 1); c.lineTo(W + ov - 2, ry + 1); K(c, 1.4, al(lt(roof, 0.5), 0.6));
  return { ry, top };
}
function door(c, x, w, h, col = '#9a5f34') {
  c.beginPath(); c.moveTo(x - w / 2, -8); c.lineTo(x - w / 2, -h + w / 2); c.arc(x, -h + w / 2, w / 2, Math.PI, 0); c.lineTo(x + w / 2, -8); c.closePath();
  F(c, L(c, x - w / 2, 0, x + w / 2, 0, lt(col, 0.15), col, dk(col, 0.25))); K(c, 1.1);
  for (const t of [-0.2, 0.2]) { c.beginPath(); c.moveTo(x + t * w, -9); c.lineTo(x + t * w, -h + w * 0.3); K(c, 0.7, al(dk(col, 0.4), 0.8)); }
  ball(c, x + w * 0.3, -h * 0.5, 1.1, 1.1, '#f2c94c', 0.6);
  RR(c, x - w / 2 - 2, -8.6, w + 4, 3, 1); F(c, '#b9ae9e'); K(c, 0.7);
}

const PROPS = {
  oak: { w: 82, h: 98, ax: 41, ay: 90, sh: [7, 0, 30, 9], body(c, v) {
    trunk(c, 40, 6, '#8a5a36');
    const B = v ? [[-22, -50, 15, 0], [21, -50, 15, 0], [0, -44, 15, 1], [-10, -66, 19, 1], [13, -70, 16, 1], [-1, -80, 12, 2]]
      : [[-21, -46, 15, 0], [20, -48, 15, 0], [0, -42, 14, 1], [-12, -63, 18, 1], [13, -63, 17, 1], [0, -74, 15, 2]];
    const C = ['#3f9a46', '#52b04c', '#6cc55a'];
    B.forEach(([x, y, r, t], i) => leafBlob(c, x, y, r, C[t], i));
    if (v) for (const [x, y] of [[-16, -52], [8, -60], [18, -46], [-4, -72], [-22, -66]]) { ball(c, x, y, 2.4, 2.4, '#ff5f5f', 0.8); shine(c, x - 0.8, y - 0.9, 0.8, 0.6, 0.8); }
  } },
  pine: { w: 64, h: 100, ax: 32, ay: 94, sh: [6, 0, 24, 8], body(c) {
    trunk(c, 18, 4, '#7a4a2e');
    const tiers = [[-16, 26, 22], [-34, 22, 22], [-52, 17, 21], [-68, 12, 20]];
    tiers.forEach(([y, hw, th], i) => {
      const col = mix('#2f7d4f', '#4fa265', i / 3);
      c.beginPath(); c.moveTo(0, y - th - 4);
      c.quadraticCurveTo(hw * 0.4, y - th * 0.55, hw, y);
      for (let i = 0; i < 5; i++) { const xa = hw - i * hw * 0.4, xb = hw - (i + 1) * hw * 0.4; c.quadraticCurveTo((xa + xb) / 2, y + 4.6, xb, y); }
      c.quadraticCurveTo(-hw * 0.4, y - th * 0.55, 0, y - th - 4); c.closePath();
      F(c, L(c, -hw, y - th, hw, y, lt(col, 0.2), col, dk(col, 0.25))); K(c, 1);
      c.beginPath(); c.moveTo(-hw * 0.55, y - 3); c.quadraticCurveTo(-hw * 0.3, y - th * 0.45, 0, y - th - 1); K(c, 0.9, al(lt(col, 0.45), 0.7));
    });
  } },
  palm: { w: 80, h: 100, ax: 34, ay: 92, sh: [14, 0, 26, 8], body(c) {
    const pts = []; for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push(Math.sin(t * 1.5) * 12, -t * 64); }
    for (let i = 0; i < 8; i++) { const x = pts[i * 2], y = pts[i * 2 + 1], x2 = pts[i * 2 + 2], y2 = pts[i * 2 + 3], w = 5.4 - i * 0.28; P(c, [x - w, y, x2 - w + 0.6, y2, x2 + w - 0.6, y2, x + w, y]); F(c, L(c, x - w, 0, x + w, 0, '#d6a870', i % 2 ? '#b98652' : '#c4935c', '#8a5e36')); K(c, 0.9); }
    const tx = pts[16], ty = pts[17];
    const frond = (a, l, droop) => {
      const x1 = tx + Math.cos(a) * l, y1 = ty + Math.sin(a) * l + droop;
      const mx = tx + Math.cos(a) * l * 0.5, my = ty + Math.sin(a) * l * 0.5 - 6;
      c.beginPath(); c.moveTo(tx, ty); c.quadraticCurveTo(mx, my - 3, x1, y1); c.quadraticCurveTo(mx + 2, my + 6, tx, ty + 2); c.closePath(); FK(c, '#4fb04a', mx, my, l * 0.6, 1);
      for (let t = 0.2; t < 0.95; t += 0.14) { const px = tx + (x1 - tx) * t, py = ty + (y1 - ty) * t - Math.sin(t * Math.PI) * 6; c.beginPath(); c.moveTo(px, py); c.lineTo(px + Math.cos(a + 1.3) * 4.6, py + Math.sin(a + 1.3) * 4.6 + 2); K(c, 0.8, '#2f7d3a'); }
      c.beginPath(); c.moveTo(tx, ty); c.quadraticCurveTo(mx, my - 1, x1, y1); K(c, 0.8, '#8fd46a');
    };
    for (const [a, l, d] of [[-2.9, 30, 10], [-0.25, 32, 10], [-2.2, 26, -2], [-0.95, 26, -2], [-1.6, 20, -4], [2.7, 24, 14], [0.45, 26, 14]]) frond(a, l, d);
    for (const [x, y] of [[-3, 2], [3, 3], [0, 5]]) ball(c, tx + x, ty + y, 3, 3, '#7a5230', 0.9);
  } },
  bush: { w: 44, h: 38, ax: 22, ay: 32, sh: [4, 0, 18, 6], body(c) {
    leafBlob(c, -9, -9, 9, '#3f9a46', 1); leafBlob(c, 9, -9, 9, '#45a04a', 2); leafBlob(c, 0, -15, 11, '#5cb84f', 3);
  } },
  flowers: { w: 34, h: 24, ax: 17, ay: 18, ow: 0.6, sh: [1, 0, 14, 4, 0.14], body(c, v) {
    const pal = [['#ff8fb1', '#ffe066'], ['#ffd43b', '#ff8c42'], ['#9db4ff', '#ffffff']][v % 3];
    for (const [x, y, h, a] of [[-10, 0, 7, -0.3], [-4, 0, 9, 0.1], [3, 0, 8, -0.15], [10, 0, 7, 0.3], [-7, -4, 6, 0.2], [6, -4, 6, -0.2]]) { leafPath(c, x, y, x + Math.sin(a) * h, y - h, 1.2); F(c, '#5cb84a'); K(c, 0.6); }
    for (const [x, y, r] of [[-9, -7, 2.6], [-2, -10, 2.8], [5, -8, 2.6], [11, -6, 2.3], [-5, -4, 2.2], [3, -3, 2.1]]) {
      for (let i = 0; i < 5; i++) { const a = i / 5 * TAU - Math.PI / 2; E(c, x + Math.cos(a) * r * 0.62, y + Math.sin(a) * r * 0.62, r * 0.52, r * 0.52); F(c, G(c, x, y, r, pal[0], 0.35, 0.15)); K(c, 0.55); }
      E(c, x, y, r * 0.38, r * 0.38); F(c, pal[1]); K(c, 0.5);
    }
  } },
  rock: { w: 28, h: 22, ax: 14, ay: 17, sh: [3, 0, 12, 4], body(c, v) { stone(c, 0, 0, 20, 13, '#a2a2b6', v); } },
  boulder: { w: 54, h: 48, ax: 27, ay: 41, sh: [6, 0, 24, 7], body(c, v) { stone(c, 0, 0, 44, 36, '#9c9cb2', v + 1, '#7fb35a'); stone(c, 16, 0.6, 14, 9, '#8e8ea6', 3); } },
  berrybush: { w: 44, h: 38, ax: 22, ay: 32, sh: [4, 0, 18, 6], body(c, v) {
    leafBlob(c, -9, -9, 9, '#3a8f45', 1); leafBlob(c, 9, -9, 9, '#3f9548', 2); leafBlob(c, 0, -15, 11, '#4faa4c', 3);
    if (!v) for (const [x, y] of [[-10, -12], [-7, -9], [4, -19], [7, -16], [11, -10], [-2, -12], [14, -7], [-13, -6]]) { ball(c, x, y, 2.2, 2.2, '#e8334f', 0.8); shine(c, x - 0.7, y - 0.8, 0.7, 0.55, 0.85); }
    else for (const [x, y] of [[-6, -11], [8, -14]]) { ball(c, x, y, 1.3, 1.3, '#9ccf5a', 0.6); }
  } },
  mushrooms: { w: 32, h: 28, ax: 16, ay: 22, sh: [3, 0, 13, 4], body(c) {
    const m = (x, h, r, col) => { RR(c, x - r * 0.3, -h, r * 0.6, h, r * 0.25); FK(c, '#fff0d6', x, -h / 2, r, 0.8); c.beginPath(); c.moveTo(x - r, -h); c.quadraticCurveTo(x - r, -h - r * 1.15, x, -h - r * 1.15); c.quadraticCurveTo(x + r, -h - r * 1.15, x + r, -h); c.quadraticCurveTo(x, -h + r * 0.3, x - r, -h); c.closePath(); FK(c, col, x - r * 0.3, -h - r * 0.6, r, 0.9); E(c, x - r * 0.35, -h - r * 0.62, r * 0.22, r * 0.16); F(c, CREAM); E(c, x + r * 0.35, -h - r * 0.4, r * 0.16, r * 0.12); F(c, CREAM); };
    m(6, 7, 4, '#d9a06a'); m(-4, 11, 6.4, '#e0604f'); m(9, 4, 3, '#c97a4a');
  } },
  reeds: { w: 34, h: 44, ax: 17, ay: 38, sh: [2, 0, 12, 3.4, 0.18], under(c) { E(c, 0, 0.4, 12, 2.4); K(c, 0.9, 'rgba(230,250,255,0.7)'); }, body(c) {
    for (const [x, h, a, col] of [[-8, 26, -0.25, '#4f9a3a'], [-3, 32, -0.05, '#5fae44'], [2, 28, 0.12, '#56a540'], [7, 24, 0.3, '#4f9a3a'], [-11, 18, -0.4, '#6cbf4e'], [10, 16, 0.45, '#6cbf4e']]) { leafPath(c, x - 1, 0, x + Math.sin(a) * h, -h, 1.4, a * 3); FK(c, col, x, -h / 2, h / 2, 0.8); }
    for (const [x, h] of [[-5, 30], [4, 26]]) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x + 1, -h); K(c, 2.6, INK); K(c, 1.2, '#6f9a3a'); E(c, x + 1, -h + 5, 2, 5); FK(c, '#8a5a32', x + 1, -h + 5, 5, 0.9); }

  } },
  lily: { w: 30, h: 22, ax: 15, ay: 13, sh: [1, 1.4, 12, 4, 0.16], body(c) {
    c.beginPath(); c.ellipse(0, 0, 11, 6, 0, 0.35, TAU - 0.1); c.lineTo(0, 0); c.closePath(); F(c, G(c, -3, -2, 12, '#5fbf5a', 0.3, 0.25)); K(c, 1);
    for (const a of [1, 1.9, 2.8, 3.7, 4.6, 5.5]) { c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(a) * 9, Math.sin(a) * 5); K(c, 0.6, 'rgba(40,110,50,0.6)'); }
    for (const a of [-2.4, -1.6, -0.8, -2, -1.2]) { leafPath(c, 2, -1.4, 2 + Math.cos(a) * 6, -1.4 + Math.sin(a) * 6, 1.6); FK(c, '#ff9ec4', 2, -4, 5, 0.7); }
    ball(c, 2, -2.2, 1.4, 1.2, '#ffe066', 0.6);
  } },
  shell: { w: 20, h: 18, ax: 10, ay: 13, sh: [1, 0, 7, 2.4], body(c, v) {
    if (v % 2 === 0) {
      c.beginPath(); c.moveTo(0, -1); for (let i = 0; i <= 6; i++) { const a = Math.PI + i / 6 * Math.PI; c.quadraticCurveTo(Math.cos(a - 0.26) * 8, -1 + Math.sin(a - 0.26) * 8.4, Math.cos(a) * 7, -1 + Math.sin(a) * 7.2); }
      c.closePath(); F(c, G(c, -2, -5, 8, '#ffb3a0', 0.4, 0.25)); K(c, 0.9);
      for (let i = 1; i < 6; i++) { const a = Math.PI + i / 6 * Math.PI; c.beginPath(); c.moveTo(0, -1); c.lineTo(Math.cos(a) * 6.4, -1 + Math.sin(a) * 6.6); K(c, 0.6, 'rgba(190,100,90,0.7)'); }
      RR(c, -2.4, -2.2, 4.8, 2.4, 1); FK(c, '#f59a86', 0, -1, 3, 0.7);
    } else {
      S(c, [-7, -2, -3, -7, 3, -7.4, 7, -3, 4, 0.6, -3, 0.6], true); F(c, G(c, -1, -4, 8, '#fbe3c0', 0.4, 0.25)); K(c, 0.9);
      c.beginPath(); for (let t = 0; t < 4 * Math.PI; t += 0.3) { const r = 0.3 + t * 0.32; c.lineTo(2 + Math.cos(t) * r, -3.4 + Math.sin(t) * r * 0.8); } K(c, 0.7, '#e08a4a');
      for (const x of [-4, -1.6]) { c.beginPath(); c.moveTo(x, -6); c.lineTo(x - 1, 0); K(c, 0.7, '#e08a4a'); }
    }
  } },
  driftwood: { w: 46, h: 22, ax: 23, ay: 15, sh: [3, 0, 19, 4], body(c) {
    S(c, [-18, -4, -14, -8, 6, -8.6, 16, -7, 19, -3.4, 15, -0.6, -4, 0, -16, -0.4], true); F(c, L(c, 0, -9, 0, 0, '#e0d2bc', '#c4b298', '#9e8c74')); K(c, 1);
    limb(c, [6, -8, 10, -12.6, 14, -13.4], 2.2, '#cbb9a0', true);
    for (const [x0, x1, y] of [[-14, 2, -5.6], [-8, 12, -3.2]]) { c.beginPath(); c.moveTo(x0, y); c.quadraticCurveTo((x0 + x1) / 2, y - 1, x1, y); K(c, 0.6, 'rgba(110,94,74,0.7)'); }
    E(c, -4, -4.6, 1.8, 1.2); K(c, 0.7, 'rgba(110,94,74,0.8)');
  } },
  crystal: { w: 32, h: 36, ax: 16, ay: 27, sh: [3, 0, 12, 4], body(c, v, f) {
    stone(c, 0, 0, 20, 7, '#6f6f8a', 2);
    const col = v ? '#7e9aa6' : '#4fe0d0';
    if (v) { gem(c, -4, -3, 4, 6, -0.3, col); gem(c, 3, -3, 4.4, 5, 0.25, col); gem(c, 0, -4, 4.4, 7, 0, col); for (const x of [-1, 2]) { c.beginPath(); c.moveTo(x, -9); c.lineTo(x + 1.6, -7); K(c, 0.7, 'rgba(40,50,70,0.7)'); } }
    else { gem(c, -5, -3, 5, 13, -0.35, col); gem(c, 5, -3, 5, 11, 0.38, '#8ffcef'); gem(c, 0, -4, 6.4, 19, 0, col); }
  }, over(c, v, f) {
    if (v) return;
    c.save(); c.globalCompositeOperation = 'lighter'; glow(c, 0, -12, f ? 18 : 14, '#5ff0e0', f ? 0.42 : 0.32); c.restore();
    star(c, f ? 6 : -6, f ? -20 : -16, 2.6, 0.7, 4); F(c, '#ffffff');
  }, under(c, v, f) { if (!v) { c.save(); c.scale(1, 0.4); glow(c, 0, 0, f ? 18 : 15, '#5ff0e0', 0.35); c.restore(); } } },
  stalagmite: { w: 30, h: 46, ax: 15, ay: 40, sh: [4, 0, 12, 4], body(c) {
    c.beginPath(); c.moveTo(-11, 0); c.quadraticCurveTo(-8, -14, -2, -34); c.quadraticCurveTo(0, -37, 1.6, -34); c.quadraticCurveTo(7, -14, 11, 0); c.quadraticCurveTo(0, 2, -11, 0); c.closePath();
    F(c, L(c, -10, 0, 10, 0, '#aaa0b8', '#8a8098', '#5e566e')); K(c, 1);
    for (const [y, w] of [[-8, 8.6], [-17, 6], [-25, 3.8]]) { c.beginPath(); c.moveTo(-w, y + 1); c.quadraticCurveTo(0, y + 2.6, w, y + 0.6); K(c, 0.7, 'rgba(60,52,76,0.7)'); }
    c.beginPath(); c.moveTo(-4, -26); c.quadraticCurveTo(-6, -12, -7, -2); K(c, 1, 'rgba(255,255,255,0.3)');
    stone(c, 9, 0.4, 9, 6, '#7e7690', 2);
  } },
  cavecrystal: { w: 76, h: 74, ax: 38, ay: 60, sh: [4, 0, 22, 6], body(c, v, f) {
    stone(c, 0, 0, 40, 12, '#5f5f7a', 4);
    gem(c, -12, -4, 7, 18, -0.5, '#b892ff'); gem(c, 13, -4, 7, 20, 0.45, '#4fe0d0'); gem(c, -5, -6, 8, 30, -0.15, '#4fe0d0');
    gem(c, 6, -6, 8.6, 38, 0.08, '#7ff6ea'); gem(c, 18, -2, 5, 11, 0.9, '#b892ff'); gem(c, -18, -2, 5, 10, -0.9, '#4fe0d0');
  }, under(c, v, f) { glow(c, 0, -20, f ? 34 : 28, '#5ff0e0', f ? 0.3 : 0.22); }, over(c, v, f) {
    c.save(); c.globalCompositeOperation = 'lighter'; glow(c, 4, -26, f ? 22 : 17, '#9ffcff', 0.3); c.restore();
    for (const [x, y, r] of f ? [[-10, -30, 2.6], [14, -40, 2], [20, -18, 1.6]] : [[8, -46, 2.4], [-16, -20, 1.8], [-2, -38, 1.4]]) { star(c, x, y, r, r * 0.3, 4); F(c, '#ffffff'); }
  } },
  house: { w: 124, h: 114, ax: 62, ay: 104, sh: [10, -2, 52, 14, 0.3], body(c, v) {
    const roof = ['#e0574f', '#4f86d1', '#5aa64e'][v % 3];
    RR(c, 22, -96, 10, 22, 1.5); F(c, L(c, 22, 0, 32, 0, '#c2b8a8', '#8f8678')); K(c, 1); RR(c, 20.6, -98, 12.8, 4, 1); F(c, '#a89e90'); K(c, 0.8);
    cottage(c, roof, { w: 44, wallH: 40, roofH: 44, beam: 999 });
    door(c, -8, 13, 30);
    windowLit(c, -36, -40, 14, 12); flowerBox(c, -37.4, -26.6, 16.8, ['#ff8fb1', '#ffd43b']);
    windowLit(c, 14, -40, 14, 12); flowerBox(c, 12.6, -26.6, 16.8, ['#9db4ff', '#ff8fb1']);
    windowLit(c, -6, -76, 12, 10);
    RR(c, 30, -16, 8, 8, 1.4); FK(c, '#a8713e', 34, -12, 5, 0.8);
  } },
  elderhouse: { w: 156, h: 136, ax: 78, ay: 124, sh: [12, -2, 64, 16, 0.3], body(c) {
    const roof = '#8e5aa8';
    RR(c, 34, -118, 12, 26, 1.5); F(c, L(c, 34, 0, 46, 0, '#c2b8a8', '#8f8678')); K(c, 1); RR(c, 32.4, -120, 15.2, 4, 1); F(c, '#a89e90'); K(c, 0.8);
    const { top } = cottage(c, roof, { w: 58, wallH: 46, roofH: 52, beam: 999 });
    // dormer
    RR(c, -12, top + 6, 24, 20, 2); F(c, '#f2e2c4'); K(c, 1); windowLit(c, -6, top + 10, 12, 11);
    P(c, [-16, top + 8, 0, top - 6, 16, top + 8]); F(c, G(c, 0, top, 16, dk(roof, 0.05), 0.3, 0.25)); K(c, 1);
    // porch
    for (const x of [-20, 20]) { RR(c, x - 2, -40, 4, 32, 1); FK(c, '#9a6a3e', x, -24, 4, 0.8); }
    P(c, [-26, -38, -22, -48, 22, -48, 26, -38]); F(c, G(c, 0, -44, 24, roof, 0.3, 0.2)); K(c, 1);
    door(c, 0, 16, 34, '#7e4a2a');
    windowLit(c, -48, -46, 16, 14); flowerBox(c, -49.6, -30.6, 19.2, ['#ff8fb1', '#ffd43b']);
    windowLit(c, 32, -46, 16, 14); flowerBox(c, 30.4, -30.6, 19.2, ['#9db4ff', '#ffffff']);
    // banner pole with a leaf crest
    limb(c, [-66, 0, -66, -112], 2.2, '#8a5a36'); ball(c, -66, -113, 2.2, 2.2, '#f2c94c', 0.8);
    P(c, [-64.6, -108, -46, -108, -46, -80, -55.3, -86, -64.6, -80]); F(c, L(c, -64, -108, -46, -80, '#3fb9a8', '#2d8f86')); K(c, 1);
    leafPath(c, -55.3, -88, -55.3, -103, 3.4); FK(c, '#ffd75a', -55, -96, 6, 0.8);
    c.beginPath(); c.moveTo(-55.3, -89); c.lineTo(-55.3, -102); K(c, 0.6, '#c99a2a');
  } },
  healerhut: { w: 122, h: 118, ax: 61, ay: 104, sh: [10, -2, 50, 14, 0.3], body(c) {
    c.beginPath(); c.moveTo(-40, -8); c.lineTo(-40, -40); c.quadraticCurveTo(0, -48, 40, -40); c.lineTo(40, -8); c.quadraticCurveTo(0, -2, -40, -8); c.closePath();
    F(c, L(c, -40, 0, 40, 0, '#fff0d4', '#ead4a8', '#c9ad7e')); K(c, 1.1);
    for (const x of [-26, -10, 10, 26]) { c.beginPath(); c.moveTo(x, -44 + Math.abs(x) * 0.1); c.lineTo(x, -6 + Math.abs(x) * 0.08); K(c, 0.6, 'rgba(150,110,70,0.45)'); }
    RR(c, -44, -9, 88, 7, 3); F(c, L(c, 0, -9, 0, -2, '#c2b8a8', '#8f8678')); K(c, 1);
    c.beginPath(); c.moveTo(-50, -34); c.bezierCurveTo(-50, -70, -24, -94, 0, -94); c.bezierCurveTo(24, -94, 50, -70, 50, -34); c.quadraticCurveTo(0, -28, -50, -34); c.closePath(); F(c, G(c, -10, -66, 50, '#3f9a46', 0.3, 0.3)); K(c, 1.1);
    const rows = [[-38, 48, 13], [-55, 40, 12], [-71, 29, 11], [-84, 16, 9]];
    rows.forEach(([y, hw, lh], i) => {
      const col = mix('#3f9a46', '#6cc55a', i / 3);
      for (let k = -hw; k <= hw; k += 9) { const x = k + (i % 2) * 4.5; if (Math.abs(x) > hw) continue; leafPath(c, x, y - lh, x + x * 0.08, y + 4, 5.6); FK(c, col, x, y - lh / 2, lh, 0.9); c.beginPath(); c.moveTo(x, y - lh + 2); c.lineTo(x + x * 0.07, y + 2); K(c, 0.6, al(dk(col, 0.4), 0.8)); }
    });
    limb(c, [0, -92, 1.4, -100, 5, -102], 1.6, '#5aa83e', true); leafPath(c, 5, -102, 11, -104, 2); FK(c, '#7cc96a', 8, -103, 3, 0.8);
    c.beginPath(); c.moveTo(-11, -8); c.lineTo(-11, -24); c.arc(0, -24, 11, Math.PI, 0); c.lineTo(11, -8); c.closePath(); F(c, L(c, -11, 0, 11, 0, '#a8713e', '#8a5a36')); K(c, 1.1);
    c.beginPath(); c.arc(0, -24, 7, Math.PI, 0); K(c, 0.7, 'rgba(60,36,20,0.6)'); ball(c, 6, -18, 1.1, 1.1, '#f2c94c', 0.6);
    windowLit(c, -32, -34, 11, 10); windowLit(c, 21, -34, 11, 10);
    // leaf sign on a post
    limb(c, [48, 0, 48, -40], 2.4, '#8a5a36');
    c.beginPath(); c.moveTo(38, -38); c.lineTo(38, -36); c.moveTo(58, -38); c.lineTo(58, -36); K(c, 0.8);
    RR(c, 36, -36, 24, 18, 3); FK(c, '#c99560', 46, -28, 13, 1);
    leafPath(c, 42, -22, 54, -32, 3.6); FK(c, '#5fbf5a', 48, -27, 6, 0.8); c.beginPath(); c.moveTo(43, -22.6); c.lineTo(53, -31.4); K(c, 0.6, '#2f7d3a');
    drop(c, 41.6, -30, 1.6, '#8fe0ff');
    for (const x of [-30, 22]) { RR(c, x, -12, 8, 6, 1.4); FK(c, '#d9784a', x + 4, -9, 4, 0.8); leafBlob(c, x + 4, -14, 4, '#5cb84a', x); }
  } },
  shop: { w: 118, h: 96, ax: 59, ay: 86, sh: [8, -2, 50, 11, 0.28], body(c) {
    for (const x of [-46, 46]) { RR(c, x - 2.4, -74, 4.8, 74, 1.2); FK(c, '#9a6a3e', x, -36, 5, 0.9); }
    RR(c, -44, -32, 88, 30, 2); F(c, L(c, 0, -32, 0, -2, '#c99560', '#a8713e', '#80522e')); K(c, 1.1);
    for (const x of [-22, 0, 22]) { c.beginPath(); c.moveTo(x, -31); c.lineTo(x, -3); K(c, 0.7, 'rgba(70,40,20,0.6)'); }
    RR(c, -48, -36, 96, 6, 2); FK(c, '#d9a870', 0, -34, 40, 1);
    // goods
    const basket = (x, col) => { RR(c, x - 8, -42, 16, 7, 2); FK(c, '#c48a4f', x, -39, 8, 0.9); for (const [dx, dy] of [[-4, -43], [0, -44.6], [4, -43], [-2, -46], [2, -46.4]]) ball(c, x + dx, dy, 2.4, 2.2, col, 0.7); };
    basket(-30, '#ff6b6b'); basket(-10, '#ffb347');
    for (const [x, h, col] of [[8, 10, '#5ec8e6'], [14, 8, '#7ed957'], [20, 11, '#b197fc']]) { RR(c, x - 2.6, -36 - h, 5.2, h, 2); FK(c, col, x, -36 - h / 2, 5, 0.8); RR(c, x - 1.2, -38 - h, 2.4, 2.4, 0.6); F(c, '#8a5a36'); K(c, 0.6); shine(c, x - 1, -33 - h * 0.6, 0.7, h * 0.22, 0.6); }
    for (const [x, y] of [[32, -38], [36, -40], [34, -42.4]]) { c.save(); c.translate(x, y); c.scale(0.55, 0.55); PROPS.shell.body(c, 0); c.restore(); }
    // striped awning
    const aw = [-54, -62, -44, -82, 44, -82, 54, -62];
    P(c, aw); F(c, '#fff3e0'); K(c, 1.1);
    c.save(); P(c, aw); c.clip();
    for (let i = -6; i < 6; i++) { if (i % 2) continue; P(c, [i * 9.4, -82, (i + 1) * 9.4, -82, (i + 1) * 11.6, -62, i * 11.6, -62]); F(c, '#ff6f6f'); }
    c.fillStyle = 'rgba(255,255,255,0.2)'; c.fillRect(-60, -82, 120, 6); c.restore();
    P(c, aw); K(c, 1.1);
    c.beginPath(); c.moveTo(-54, -62); for (let i = 0; i < 12; i++) { const x = -54 + i * 9; c.quadraticCurveTo(x + 4.5, -55.6, x + 9, -62); } c.lineTo(54, -62); c.closePath();
    F(c, '#ff6f6f'); K(c, 1);
    for (const x of [-30, -6, 18]) { c.beginPath(); c.moveTo(x, -62); c.lineTo(x, -54); K(c, 0.7); ball(c, x, -52, 2.4, 2.6, x === -6 ? '#ffd43b' : '#7ed957', 0.8); }
  } },
  ranch: { w: 70, h: 62, ax: 35, ay: 54, sh: [5, 0, 28, 6], body(c) {
    for (const x of [-22, 22]) { RR(c, x - 2.4, -48, 4.8, 48, 1.2); FK(c, '#8a5a36', x, -24, 5, 0.9); }
    RR(c, -30, -50, 60, 30, 3); F(c, L(c, 0, -50, 0, -20, '#e0b07a', '#c48a4f')); K(c, 1.2);
    for (const y of [-40, -30]) { c.beginPath(); c.moveTo(-29, y); c.lineTo(29, y); K(c, 0.6, 'rgba(110,70,40,0.5)'); }
    RR(c, -27, -47, 54, 24, 2); K(c, 0.8, 'rgba(110,70,40,0.6)');
    // picture: paw print, a small round creature, a little fence
    E(c, -15, -31, 4.6, 3.8); FK(c, '#7a4a2e', -15, -31, 4.6, 0.7);
    for (const [x, y] of [[-20, -37], [-16.6, -39.6], [-12.6, -39.2], [-9.6, -36]]) { E(c, x, y, 1.6, 1.9); FK(c, '#7a4a2e', x, y, 2, 0.6); }
    ear(c, 2, -38, 6, -40, 1, -45, '#8ad15f'); ear(c, 14, -38, 10, -40, 15, -45, '#8ad15f');
    ball(c, 8, -34, 7, 6, '#8ad15f', 0.8); E(c, 5.4, -35, 1, 1.3); F(c, '#2a2140'); E(c, 10.6, -35, 1, 1.3); F(c, '#2a2140'); ball(c, 8, -31.6, 2.4, 1.5, '#fff1cf', 0.6);
    for (const x of [18, 22, 26]) { c.beginPath(); c.moveTo(x, -26); c.lineTo(x, -33); K(c, 1, '#7a4a2e'); } c.beginPath(); c.moveTo(16.6, -31); c.lineTo(27.4, -31); c.moveTo(16.6, -28); c.lineTo(27.4, -28); K(c, 0.8, '#7a4a2e');
    ball(c, -24, -46, 1, 1, '#d9d0c0', 0.5); ball(c, 24, -46, 1, 1, '#d9d0c0', 0.5);
  } },
  well: { w: 52, h: 62, ax: 26, ay: 54, sh: [5, 0, 22, 6], body(c) {
    for (const x of [-16, 16]) { RR(c, x - 2, -48, 4, 30, 1); FK(c, '#8a5a36', x, -34, 4, 0.8); }
    P(c, [-22, -44, 0, -56, 22, -44, 18, -42, 0, -51, -18, -42]); F(c, G(c, 0, -50, 22, '#c0574f', 0.3, 0.25)); K(c, 1);
    c.beginPath(); c.moveTo(-16, -42); c.lineTo(16, -42); K(c, 2.6, INK); K(c, 1.4, '#7a4a2e');
    c.beginPath(); c.moveTo(4, -42); c.lineTo(4, -30); K(c, 0.7, '#d9c09a');
    RR(c, 1.4, -31, 5.2, 4.6, 1); FK(c, '#a8713e', 4, -29, 3, 0.7);
    RR(c, -19, -22, 38, 20, 3); F(c, L(c, -19, 0, 19, 0, '#c8c2d2', '#a29cb0', '#7a7490')); K(c, 1.1);
    for (const [y, o] of [[-16, 0], [-9, 5]]) for (let x = -19 + o; x < 19; x += 10) { c.beginPath(); c.moveTo(x, y - 6); c.lineTo(x, y + 1); K(c, 0.6, 'rgba(60,54,80,0.55)'); }
    c.beginPath(); c.moveTo(-19, -15); c.lineTo(19, -15); c.moveTo(-19, -8.4); c.lineTo(19, -8.4); K(c, 0.6, 'rgba(60,54,80,0.55)');
    E(c, 0, -22, 19, 5.4); F(c, '#b7b1c4'); K(c, 1); E(c, 0, -22, 14.6, 3.6); F(c, L(c, 0, -26, 0, -18, '#1e3a5a', '#2f6d8f')); K(c, 0.8);
    shine(c, -4, -22.6, 4, 0.8, 0.4);
  } },
  fenceH: { w: 34, h: 26, ax: 17, ay: 20, outline: false, sh: [0, 0.6, 15, 2.6, 0.16], body(c) {
    for (const y of [-14, -8]) { c.beginPath(); c.rect(-16.6, y - 1.5, 33.2, 3); F(c, L(c, 0, y - 1.5, 0, y + 1.5, '#d9a870', '#a8713e')); c.beginPath(); c.moveTo(-16.6, y - 1.5); c.lineTo(16.6, y - 1.5); c.moveTo(-16.6, y + 1.5); c.lineTo(16.6, y + 1.5); K(c, 0.9); }
    for (const x of [-8, 8]) { RR(c, x - 2.4, -18, 4.8, 18, 1.2); FK(c, '#9a6a3e', x - 1, -10, 5, 1); P(c, [x - 2.4, -17.4, x, -19.6, x + 2.4, -17.4]); F(c, '#b98652'); K(c, 0.9); }
  } },
  fenceV: { w: 18, h: 50, ax: 9, ay: 44, outline: false, sh: [1, -16, 4, 16, 0.14], body(c) {
    c.beginPath(); c.rect(-1.6, -42.6, 3.2, 33.2); F(c, L(c, -1.6, 0, 1.6, 0, '#d9a870', '#a8713e')); c.beginPath(); c.moveTo(-1.6, -42.6); c.lineTo(-1.6, -9.4); c.moveTo(1.6, -42.6); c.lineTo(1.6, -9.4); K(c, 0.9);
    for (const y of [-24, -8]) { RR(c, -2.6, y - 14, 5.2, 14, 1.2); FK(c, '#9a6a3e', -1, y - 7, 5, 1); E(c, 0, y - 14, 2.6, 1.3); F(c, '#b98652'); K(c, 0.8); }
  } },
  sign: { w: 30, h: 36, ax: 15, ay: 30, sh: [3, 0, 10, 3], body(c) {
    RR(c, -1.8, -22, 3.6, 22, 1); FK(c, '#8a5a36', 0, -11, 3, 0.9);
    P(c, [-11, -27, 8, -27, 12, -21.5, 8, -16, -11, -16]); F(c, L(c, 0, -27, 0, -16, '#e0b07a', '#c48a4f')); K(c, 1.1);
    for (const [x0, x1, y] of [[-8, 4, -23.4], [-8, 1, -19.6]]) { c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); K(c, 1.1, 'rgba(110,70,40,0.7)'); }
  } },
  lantern: { w: 42, h: 58, ax: 17, ay: 52, sh: [4, 0, 8, 3], body(c, v, f) {
    RR(c, -2, -44, 4, 44, 1); FK(c, '#6b4a3a', -1, -22, 4, 0.9); RR(c, -3.6, -4, 7.2, 4, 1); FK(c, '#5a4a52', 0, -2, 4, 0.8);
    limb(c, [0, -42, 7, -44, 8, -41], 1.4, '#3a3f58');
    RR(c, 4.2, -40, 7.6, 10, 2); F(c, L(c, 0, -40, 0, -30, '#fff6c8', f ? '#ffd166' : '#ffb84a')); K(c, 1);
    P(c, [3.4, -40, 8, -43.4, 12.6, -40]); F(c, '#3a3f58'); K(c, 0.8); RR(c, 3.6, -30.6, 8.8, 2, 0.8); F(c, '#3a3f58'); K(c, 0.7);
    c.beginPath(); c.moveTo(8, -39.4); c.lineTo(8, -31); K(c, 0.6, 'rgba(90,60,30,0.6)');
    flamePath(c, 8, -32.4, 1.4, f ? 5.4 : 4.4, f ? 0.4 : -0.3); F(c, '#fff3a8');
  }, over(c, v, f) { c.save(); c.globalCompositeOperation = 'lighter'; glow(c, 8, -35, f ? 17 : 14, '#ffd166', f ? 0.5 : 0.42); c.restore(); },
  under(c, v, f) { c.save(); c.translate(8, 0); c.scale(1, 0.35); glow(c, 0, 0, f ? 20 : 17, '#ffcf6b', 0.3); c.restore(); } },
  campfire: { w: 56, h: 46, ax: 28, ay: 32, sh: [0, 0, 16, 5, 0.2], body(c, v, f) {
    for (let i = 0; i < 9; i++) { const a = i / 9 * TAU; if (Math.sin(a) > 0.3) continue; stone(c, Math.cos(a) * 12, Math.sin(a) * 4.6 + 1.6, 6.6, 4.6, '#9c98a8', i); }
    limb(c, [-9, -1, 9, -5], 3.4, '#8a5a36'); limb(c, [-9, -5, 9, -1], 3.4, '#7a4a2e');
    for (const [x, y] of [[-9, -1], [9, -1]]) { E(c, x, y - 0.2, 1.7, 1.7); F(c, '#d9a870'); K(c, 0.6); }
    const L4 = [[[0, 15, 0], [-4, 10, -1.4], [4.4, 10.6, 1.2]], [[0.6, 17, 1.6], [-4.4, 9.4, -0.6], [4, 12, 2]], [[-0.4, 14, -1.6], [-4, 11.4, -2], [4.6, 9.6, 0.6]], [[0, 16.4, 0.8], [-3.6, 12, -1], [4.2, 10, 1.8]]][f % 4];
    for (const [x, h, lean] of L4) { flamePath(c, x, -3, h * 0.3, h, lean); F(c, L(c, 0, -3, 0, -3 - h, '#ff4d1f', '#ff8a1f', '#ffc23a')); K(c, 0.8); }
    for (const [x, h, lean] of L4) { flamePath(c, x, -3.4, h * 0.17, h * 0.62, lean * 0.6); F(c, '#fff1a0'); }
  }, under(c, v, f) { c.save(); c.scale(1, 0.4); glow(c, 0, 0, f % 2 ? 26 : 23, '#ffb347', 0.4); c.restore(); },
  over(c, v, f) {
    c.save(); c.globalCompositeOperation = 'lighter'; glow(c, 0, -9, f % 2 ? 17 : 15, '#ffb347', 0.45); c.restore();
    for (const [x, y] of [[[-5, -22], [6, -26]], [[3, -24], [-7, -28]], [[-2, -28], [8, -22]], [[6, -20], [-4, -25]]][f % 4]) { E(c, x, y, 0.9, 0.9); F(c, '#ffd166'); }
  } },
  chest: { w: 32, h: 36, ax: 16, ay: 26, sh: [2, 0, 13, 4], body(c, v) {
    const W = '#a8713e', G0 = '#f2c94c';
    RR(c, -12, -13, 24, 13, 1.6); F(c, L(c, 0, -13, 0, 0, lt(W, 0.15), W, dk(W, 0.2))); K(c, 1.1);
    for (const x of [-8, 8]) { RR(c, x - 1.4, -13, 2.8, 13, 0.5); F(c, G0); K(c, 0.7); }
    if (!v) {
      c.beginPath(); c.moveTo(-12.6, -12); c.lineTo(-12.6, -17); c.quadraticCurveTo(0, -25, 12.6, -17); c.lineTo(12.6, -12); c.closePath(); F(c, L(c, 0, -22, 0, -12, lt(W, 0.25), W)); K(c, 1.1);
      for (const x of [-8, 8]) { c.beginPath(); c.moveTo(x, -12); c.lineTo(x, -18.6 - (8 - Math.abs(x)) * 0.1 - 2.4); K(c, 2.8, INK); K(c, 1.6, G0); }
      RR(c, -2.4, -15, 4.8, 5.4, 1); FK(c, G0, 0, -12.5, 3, 0.8); E(c, 0, -12.6, 0.7, 1); F(c, '#5a3a1a');
    } else {
      P(c, [-12.6, -13, -11, -27, 11, -27, 12.6, -13]); F(c, L(c, 0, -27, 0, -13, dk(W, 0.3), dk(W, 0.1))); K(c, 1.1);
      for (const x of [-7.4, 7.4]) { c.beginPath(); c.moveTo(x * 1.08, -13); c.lineTo(x, -27); K(c, 2.6, INK); K(c, 1.4, G0); }
      E(c, 0, -13, 11.4, 2.6); F(c, '#3a2414'); K(c, 0.8);
      for (const [x, y] of [[-4, -14], [0, -15], [4, -14], [-1.6, -13]]) ball(c, x, y, 2, 1.4, G0, 0.6);
    }
  }, over(c, v) { if (v) { c.save(); c.globalCompositeOperation = 'lighter'; glow(c, 0, -16, 12, '#ffd75a', 0.45); c.restore(); star(c, 5, -22, 2.4, 0.7, 4); F(c, '#ffffff'); } } },
  boulderpile: { w: 106, h: 76, ax: 53, ay: 66, sh: [8, 0, 48, 10], body(c) {
    stone(c, -26, 0, 40, 34, '#8f8ca2', 1); stone(c, 24, 0, 44, 38, '#8a879e', 2); stone(c, 0, -2, 38, 30, '#9a97ad', 3);
    stone(c, -12, -26, 34, 30, '#a3a0b6', 4, '#7fb35a'); stone(c, 16, -30, 30, 26, '#9693aa', 5); stone(c, 2, -50, 24, 18, '#aaa7bd', 6, '#7fb35a');
    stone(c, -42, 1, 12, 8, '#87849a', 7); stone(c, 44, 1.4, 12, 8, '#87849a', 8);
  } },
  stormgate: { w: 120, h: 92, ax: 60, ay: 76, outline: true, sh: [0, 0, 50, 8, 0.32], body(c, v, f) {
    for (const x of [-46, 46]) {
      P(c, [x - 7, 0, x - 6, -54, x - 3, -60, x + 4, -59, x + 7, -52, x + 7, 0]); F(c, L(c, x - 7, 0, x + 7, 0, '#a8a4bc', '#7e7a96', '#5a566e')); K(c, 1.1);
      for (const y of [-16, -32, -46]) { c.beginPath(); c.moveTo(x - 6, y); c.lineTo(x + 6, y + 1); K(c, 0.7, 'rgba(50,46,70,0.6)'); }
      gem(c, x, -58, 4, 8, 0, '#ffe14d');
    }
    const rot = f ? 0.5 : 0;
    c.save(); c.beginPath(); c.rect(-40, -70, 80, 72); c.clip();
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * TAU + rot, r = 18 + (i % 3) * 6, x = Math.cos(a) * r * 1.3, y = -30 + Math.sin(a) * r * 0.9;
      scallop(c, x, y, 13 - (i % 3), 10, 0, TAU, 7, 0.14, true); c.closePath(); F(c, G(c, x - 3, y - 3, 13, i % 2 ? '#3d4470' : '#4f5a8c', 0.3, 0.35)); K(c, 0.9);
    }
    scallop(c, 0, -30, 16, 14, rot, TAU + rot, 8, 0.15, true); c.closePath(); F(c, RG(c, 0, -30, 16, '#8a7cff', '#4c4a8a', '#2a2c52')); K(c, 0.9);
    c.lineWidth = 1.4; c.strokeStyle = 'rgba(200,210,255,0.75)';
    for (let k = 0; k < 3; k++) { c.beginPath(); for (let t = 0; t < 5; t += 0.2) { const a = t + k * 2.1 + rot * 2, r = 3 + t * 6.4; const x = Math.cos(a) * r * 1.25, y = -30 + Math.sin(a) * r * 0.85; if (t) c.lineTo(x, y); else c.moveTo(x, y); } c.stroke(); }
    c.restore();
  }, over(c, v, f) {
    zap(c, f ? -22 : 14, -62, f ? -8 : 26, -2, 5, 5, 1.8, f + 1);
    zap(c, f ? 20 : -30, -56, f ? 30 : -18, -12, 4, 4, 1.4, f + 5);
    c.save(); c.globalCompositeOperation = 'lighter'; glow(c, 0, -30, 40, '#8a7cff', f ? 0.3 : 0.24); c.restore();
  } },
  shrine: { w: 80, h: 98, ax: 40, ay: 80, sh: [6, 0, 36, 8], body(c, v) {
    RR(c, -34, -10, 68, 10, 2); F(c, L(c, 0, -10, 0, 0, '#b8b4c8', '#86829a')); K(c, 1.1);
    RR(c, -28, -20, 56, 11, 2); F(c, L(c, 0, -20, 0, -9, '#c8c4d6', '#9894ac')); K(c, 1.1);
    P(c, [-26, -20, -20, -34, 20, -34, 26, -20]); F(c, L(c, 0, -34, 0, -20, '#d8d4e4', '#aaa6bc')); K(c, 1.1);
    for (const x of [-30, 30]) { c.beginPath(); c.moveTo(x, -6); c.lineTo(x + (x < 0 ? 4 : -4), -2); K(c, 0.7, 'rgba(60,54,80,0.5)'); }
    const SOCK = [[-12, 'tide'], [0, 'stone'], [12, 'ember']];
    for (const [x, kind] of SOCK) {
      E(c, x, -27, 4.6, 2.4); F(c, '#57536c'); K(c, 0.8);
      if (v) { c.save(); c.translate(x, -27); c.scale(0.72, 0.72); SHARD[kind](c, true); c.restore(); }
    }
    for (const [x, y] of [[-24, -14], [22, -14]]) { c.beginPath(); c.arc(x, y, 2, 0, TAU); K(c, 0.8, 'rgba(80,74,100,0.6)'); }
  }, over(c, v) {
    if (!v) return;
    c.save(); c.globalCompositeOperation = 'lighter';
    for (const [x, col] of [[-12, '#6fd3ff'], [0, '#ffc46b'], [12, '#ff8c42']]) glow(c, x, -34, 12, col, 0.5);
    P(c, [-14, -36, 14, -36, 6, -76, -6, -76]); c.fillStyle = L(c, 0, -36, 0, -76, 'rgba(255,240,200,0.45)', 'rgba(255,240,200,0)'); c.fill();
    c.restore();
  } },
  log: { w: 106, h: 47, ax: 53, ay: 37, sh: [6, 0, 50, 8], body(c) {
    RR(c, -44, -26, 90, 24, 11); F(c, L(c, 0, -26, 0, -2, '#b07a48', '#8a5a36', '#5e3c22')); K(c, 1.1);
    for (const [x0, x1, y] of [[-30, 10, -20], [-16, 30, -13], [-36, -6, -8], [12, 38, -7]]) { c.beginPath(); c.moveTo(x0, y); c.quadraticCurveTo((x0 + x1) / 2, y - 1.6, x1, y); K(c, 0.8, 'rgba(60,36,20,0.6)'); }
    scallop(c, 8, -25, 14, 3.4, Math.PI, TAU, 5, 0.6, true); c.closePath(); F(c, '#7fb35a'); K(c, 0.8);
    E(c, -44, -14, 6.6, 12); F(c, G(c, -46, -17, 10, '#e8c28a', 0.3, 0.2)); K(c, 1.1);
    for (const r of [8.6, 5.6, 2.6]) { E(c, -44, -14, r * 0.55, r); K(c, 0.6, 'rgba(140,90,50,0.7)'); }
    limb(c, [22, -24, 26, -32, 31, -34], 3, '#8a5a36', true); leafPath(c, 31, -34, 36, -37, 1.6); FK(c, '#6cc04a', 33, -35, 3, 0.7);
  } },
  stump: { w: 34, h: 30, ax: 17, ay: 22, sh: [3, 0, 14, 4], body(c) {
    c.beginPath(); c.moveTo(-13, 0); c.quadraticCurveTo(-10, -2, -10, -14); c.lineTo(10, -14); c.quadraticCurveTo(10, -2, 13, 0); c.quadraticCurveTo(0, 2, -13, 0); c.closePath(); F(c, L(c, -10, 0, 10, 0, '#a8713e', '#8a5a36', '#5e3c22')); K(c, 1);
    for (const x of [-5, 1, 6]) { c.beginPath(); c.moveTo(x, -12); c.lineTo(x + 0.6, -2); K(c, 0.7, 'rgba(60,36,20,0.6)'); }
    E(c, 0, -14, 10, 4); F(c, '#e8c28a'); K(c, 1);
    for (const r of [7, 4.2, 1.6]) { E(c, 0.4, -14, r, r * 0.4); K(c, 0.6, 'rgba(140,90,50,0.7)'); }
  } },
  crate: { w: 30, h: 32, ax: 15, ay: 24, sh: [3, 0, 13, 4], body(c) {
    P(c, [-11, -18, -6, -23, 13, -23, 11, -18]); F(c, '#d9a870'); K(c, 1);
    P(c, [11, -18, 13, -23, 13, -4, 11, 0]); F(c, '#8a5a36'); K(c, 1);
    RR(c, -11, -18, 22, 18, 1); F(c, L(c, 0, -18, 0, 0, '#c99560', '#a8713e')); K(c, 1.1);
    for (const y of [-12, -6]) { c.beginPath(); c.moveTo(-11, y); c.lineTo(11, y); K(c, 0.6, 'rgba(90,56,30,0.6)'); }
    c.beginPath(); c.moveTo(-9, -16); c.lineTo(9, -2); K(c, 2.6, INK); K(c, 1.4, '#b98652');
    for (const [x, y] of [[-9, -16], [9, -16], [-9, -2], [9, -2]]) { E(c, x, y, 0.7, 0.7); F(c, '#5a4a52'); }
  } },
  barrel: { w: 26, h: 34, ax: 13, ay: 26, sh: [2, 0, 10, 3.4], body(c) {
    c.beginPath(); c.moveTo(-8.6, -1); c.quadraticCurveTo(-11, -11, -8.6, -21); c.lineTo(8.6, -21); c.quadraticCurveTo(11, -11, 8.6, -1); c.quadraticCurveTo(0, 1.4, -8.6, -1); c.closePath();
    F(c, L(c, -10, 0, 10, 0, '#c99560', '#a8713e', '#6e4426')); K(c, 1);
    for (const x of [-4.4, 0, 4.4]) { c.beginPath(); c.moveTo(x, -20); c.quadraticCurveTo(x * 1.25, -11, x, -1.4); K(c, 0.6, 'rgba(80,48,26,0.6)'); }
    for (const y of [-17, -5]) { c.beginPath(); c.moveTo(-10, y); c.quadraticCurveTo(0, y + 1.6, 10, y); K(c, 2.6, INK); K(c, 1.4, '#7c7890'); }
    E(c, 0, -21, 8.6, 2.8); F(c, '#d9a870'); K(c, 1); E(c, 0, -21, 6, 1.8); K(c, 0.6, 'rgba(120,80,40,0.6)');
  } },
  tallgrass: { w: 38, h: 54, ax: 19, ay: 46, sh: [0, -2, 16, 4, 0.18], body(c, v, f) {
    const sway = [0, 1.8, -1.4][f % 3];
    const rows = [[-26, '#3d9444', 15], [-18, '#47a04a', 16], [-10, '#55b052', 17], [-2, '#63bd58', 16]];
    rows.forEach(([by, col, hh], r) => {
      for (let i = 0; i < 7; i++) {
        const x = -14 + i * 4.6 + (r % 2) * 2.3 + Math.sin(i * 7.1 + r) * 1.2, h = hh + Math.sin(i * 3.3 + r * 1.7) * 3;
        const lean = Math.sin(i * 1.9 + r) * 2 + sway * (h / 16);
        c.beginPath(); c.moveTo(x - 1.9, by); c.quadraticCurveTo(x - 1.2 + lean * 0.3, by - h * 0.6, x + lean, by - h); c.quadraticCurveTo(x + 1.4 + lean * 0.3, by - h * 0.55, x + 1.9, by); c.closePath();
        F(c, L(c, 0, by - h, 0, by, lt(col, 0.3), col, dk(col, 0.2))); K(c, 0.65, al(dk(col, 0.5), 0.9));
      }
    });
  } },
  footprint: { w: 14, h: 12, ax: 7, ay: 6, outline: false, light: false, body(c) {
    const col = 'rgba(140,100,52,0.42)';
    E(c, 0, 1.2, 2.6, 2.1); F(c, col);
    for (const [x, y] of [[-2.8, -1.6], [-1, -3], [1, -3], [2.8, -1.6]]) { E(c, x, y, 0.95, 1.15); F(c, col); }
  } },
  bridge: { w: 32, h: 32, ax: 16, ay: 32, tile: true, outline: false, light: false, body(c) {
    const cols = ['#b98652', '#a8763f', '#c4935c', '#ad7b46'];
    c.fillStyle = '#4a3020'; c.fillRect(-16.5, -32.5, 33, 33);
    for (let i = 0; i < 4; i++) { plankRow(c, -16.5, -32 + i * 8 + 0.5, 33, 7, cols[i]); for (const x of [-13, 13]) { E(c, x, -32 + i * 8 + 4, 0.8, 0.8); F(c, '#5a4a52'); } }
  } },
  dock: { w: 32, h: 32, ax: 16, ay: 32, tile: true, outline: false, light: false, body(c) {
    const cols = ['#9c7450', '#8a6444', '#a67c56'];
    c.fillStyle = '#3e2a1c'; c.fillRect(-16.5, -32.5, 33, 33);
    for (let i = 0; i < 3; i++) { plankRow(c, -16 + i * 10.67 + 0.4, -32.5, 9.9, 33, cols[i], 'v'); for (const y of [-28, -4]) { E(c, -16 + i * 10.67 + 5.3, y, 0.8, 0.8); F(c, '#4a4050'); } }
    c.fillStyle = 'rgba(30,20,14,0.25)'; c.fillRect(-16.5, -17, 33, 2);
  } },
  cracked: { w: 32, h: 32, ax: 16, ay: 32, tile: true, outline: false, light: false, body(c) {
    const crack = (a, w) => { P(c, a, false); c.lineJoin = 'round'; c.lineWidth = w + 1.2; c.strokeStyle = 'rgba(255,255,255,0.22)'; c.stroke(); P(c, a.map((v, i) => v + (i % 2 ? 0.7 : 0.5)), false); c.lineWidth = w; c.strokeStyle = 'rgba(24,26,44,0.72)'; c.stroke(); };
    crack([-14, -27, -6, -20, -4, -12, 3, -8, 8, -2], 1.4); crack([-6, -20, 2, -24, 9, -29], 1); crack([3, -8, 10, -12, 14, -10], 0.9); crack([-4, -12, -12, -8, -14, -2], 0.9);
    for (const [x, y, r] of [[6, -18, 1.4], [-10, -15, 1], [11, -6, 1.2]]) { P(c, [x - r, y, x, y - r, x + r, y + r * 0.4]); F(c, 'rgba(30,32,52,0.4)'); }
  } },
};
const SHARD = {
  tide(c, lit) { drop(c, 0, -4, 3.4, lit ? '#8fe8ff' : '#5cc8f0'); },
  stone(c) { P(c, [0, -11, 4, -7, 4, -1, 0, 2, -4, -1, -4, -7]); F(c, L(c, -4, -11, 4, 2, '#ffe0a0', '#d9a35a', '#a8743a')); K(c, 0.9); P(c, [0, -11, 0, 2], false); K(c, 0.6, 'rgba(255,255,255,0.6)'); },
  ember(c) { flamePath(c, 0, 1, 3.6, 12, 0.6); F(c, L(c, 0, 1, 0, -11, '#ff5a1f', '#ff9b2f', '#ffd75a')); K(c, 0.9); flamePath(c, 0, 0, 1.8, 6, 0.3); F(c, '#fff1a0'); },
};
function propSprite(res, kind, v, f) {
  const P0 = PROPS[kind], sh = P0.sh, m = P0.tile ? 0 : 4;
  return make(res, {
    w: P0.w + m * 2, h: P0.h + m * 2, ax: P0.ax + m, ay: P0.ay + m, outline: P0.outline !== false, light: P0.light, ow: P0.ow,
    under: (c) => { if (sh) shade(c, sh[0], sh[1], sh[2], sh[3], sh[4] ?? 0.26); if (P0.under) P0.under(c, v, f); },
    body: (c) => P0.body(c, v, f),
    over: P0.over ? (c) => P0.over(c, v, f) : null,
  });
}

// ---------- items (≈16 world px, centred on (0, -6)) ----------
const ITEMS = {
  sunberry(c) {
    leafPath(c, 1, -12, 6.4, -14.6, 1.8); FK(c, '#5cb84a', 4, -13, 3, 0.8);
    ball(c, 0, -6, 6, 5.8, '#ffb52e'); shine(c, -2.2, -8.4, 1.8, 1.2, 0.75);
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; E(c, Math.cos(a) * 2.6, -6 + Math.sin(a) * 2.6, 0.45, 0.45); F(c, 'rgba(200,90,20,0.55)'); }
    limb(c, [0, -11.4, 0.6, -13.4], 1, '#6b4a2e');
  },
  bigberry(c) {
    for (const [x, y, r] of [[-3.4, -4.6, 4.4], [3.6, -4.2, 4.2], [0, -9.4, 4.6]]) { ball(c, x, y, r, r * 0.96, '#ff5f7a'); shine(c, x - r * 0.38, y - r * 0.4, r * 0.3, r * 0.2, 0.8); }
    leafPath(c, 0, -13.6, -5, -15.4, 1.8); FK(c, '#5cb84a', -2, -14, 3, 0.8); leafPath(c, 0, -13.6, 5, -15.6, 1.8); FK(c, '#6cc55a', 2, -14, 3, 0.8);
    star(c, 5.6, -11.6, 2, 0.6, 4); F(c, '#ffffff');
  },
  charm(c) {
    limb(c, [-1.6, 0.4, -2.6, 4], 1.4, '#ff6b8a'); limb(c, [1.6, 0.4, 2.6, 4], 1.4, '#ff6b8a');
    ball(c, 0, -6.4, 6.6, 6.6, '#3fb9a8');
    c.beginPath(); for (let t = 0; t <= TAU + 0.01; t += 0.1) { const r = 2.2 + 2.4 * Math.abs(Math.cos(t * 2)); const x = Math.cos(t) * r, y = -6.4 + Math.sin(t) * r; if (t) c.lineTo(x, y); else c.moveTo(x, y); }
    c.closePath(); K(c, 2.4, INK); K(c, 1.3, '#ffd75a');
    ball(c, 0, -6.4, 1.8, 1.8, '#ff8fb1', 0.7); shine(c, -2.6, -9.2, 1.6, 1, 0.55);
    RR(c, -1.6, -14.6, 3.2, 2.6, 1); F(c, '#ffd75a'); K(c, 0.7);
  },
  seed(c) {
    c.beginPath(); c.moveTo(0, -11); c.bezierCurveTo(5.8, -9, 6.4, -2, 0, 0); c.bezierCurveTo(-6.4, -2, -5.8, -9, 0, -11); c.closePath(); FK(c, '#d9a35a', -1, -6, 6);
    c.beginPath(); c.moveTo(0, -10); c.quadraticCurveTo(1.6, -5, 0, -1); K(c, 0.7, 'rgba(120,70,30,0.6)');
    limb(c, [0, -10.4, 0.4, -13.4], 1.1, '#4f9a3a'); leafPath(c, 0.4, -13.4, -4.4, -15.4, 1.6); FK(c, '#7ed957', -2, -14, 3, 0.7); leafPath(c, 0.4, -13.4, 5, -16, 1.6); FK(c, '#8be05f', 2, -14, 3, 0.7);
    star(c, -5, -3, 1.8, 0.5, 4); F(c, '#ffffff');
  },
  shells(c) {
    c.save(); c.translate(-3.4, 1); c.scale(0.68, 0.68); PROPS.shell.body(c, 1); c.restore();
    c.save(); c.translate(3.6, 0.6); c.scale(0.66, 0.66); PROPS.shell.body(c, 0); c.restore();
    c.save(); c.translate(0, -4.4); c.scale(0.72, 0.72); PROPS.shell.body(c, 0); c.restore();
  },
  driftwood(c) { c.save(); c.translate(0, -2); c.rotate(-0.35); c.scale(0.42, 0.62); PROPS.driftwood.body(c); c.restore(); },
  mushroom(c) {
    RR(c, -1.8, -7, 3.6, 7, 1.4); FK(c, '#fff0d6', 0, -3.5, 3, 0.8);
    c.beginPath(); c.moveTo(-7, -6.4); c.quadraticCurveTo(-7, -14, 0, -14); c.quadraticCurveTo(7, -14, 7, -6.4); c.quadraticCurveTo(0, -4.4, -7, -6.4); c.closePath(); FK(c, '#ee6a50', -2, -11, 7);
    for (const [x, y, r] of [[-3, -10.4, 1.5], [2.4, -11.6, 1.2], [4, -8, 0.9]]) { E(c, x, y, r, r * 0.8); F(c, CREAM); }
  },
  crystal(c) { gem(c, -3.6, -1, 3.8, 9, -0.35, '#4fe0d0'); gem(c, 3.6, -1, 3.8, 8, 0.4, '#8ffcef'); gem(c, 0, -0.4, 5, 14, 0, '#4fe0d0'); },
  tideshard(c) {
    c.beginPath(); c.moveTo(0, -14); c.bezierCurveTo(3, -10, 6, -6.4, 5.4, -3); c.quadraticCurveTo(4, 1, 0, 1); c.quadraticCurveTo(-4, 1, -5.4, -3); c.bezierCurveTo(-6, -6.4, -3, -10, 0, -14); c.closePath();
    F(c, L(c, -5, -14, 5, 1, '#d6f7ff', '#5cc8f0', '#2a76b0')); K(c, 1);
    P(c, [0, -14, -1.6, -4, 0, 1, 1.8, -4], true); F(c, 'rgba(255,255,255,0.28)');
    c.beginPath(); c.moveTo(-3.2, -6); c.quadraticCurveTo(0, -4.4, 3.2, -6); K(c, 0.7, 'rgba(255,255,255,0.7)');
  },
  stoneshard(c) { c.save(); c.translate(0, 0.6); c.scale(1.2, 1.2); SHARD.stone(c); c.restore(); star(c, 4.4, -11, 1.6, 0.5, 4); F(c, '#ffffff'); },
  embershard(c) { c.save(); c.translate(0, 1); c.scale(1.15, 1.15); SHARD.ember(c); c.restore(); },
  staff(c) { staffDraw(c, -1, -5, -0.85, 18, 0.5); },
  bronzeblade(c) { blade(c, '#e0a85a', '#a86a2e'); },
  crystalblade(c) { blade(c, '#8ffcef', '#2bb5c9'); },
  leafcharm(c) {
    c.beginPath(); c.moveTo(-5, -14); c.quadraticCurveTo(0, -10, 5, -14); K(c, 1.6, INK); K(c, 0.8, '#d9b56a');
    leafPath(c, 0, -11.4, 0, 0, 4.6); FK(c, '#6cc55a', -1, -6, 6);
    c.beginPath(); c.moveTo(0, -10.6); c.lineTo(0, -1.4); K(c, 0.8, '#2f7d3a');
    for (const y of [-8, -5]) for (const s of [-1, 1]) { c.beginPath(); c.moveTo(0, y); c.lineTo(s * 2.6, y - 1.8); K(c, 0.6, '#2f7d3a'); }
    ball(c, 0, -12, 1.4, 1.4, '#ffd75a', 0.6);
  },
  tidecharm(c) {
    c.beginPath(); c.moveTo(-5, -14); c.quadraticCurveTo(0, -10, 5, -14); K(c, 1.6, INK); K(c, 0.8, '#d9b56a');
    ball(c, 0, -5.6, 5.6, 5.6, '#4f9fe0');
    c.beginPath(); c.moveTo(-4, -5); c.quadraticCurveTo(-2, -8, 0, -5); c.quadraticCurveTo(2, -2, 4, -5); K(c, 1.1, '#e6fbff');
    shine(c, -2, -8.4, 1.4, 0.9, 0.6); ball(c, 0, -12, 1.4, 1.4, '#ffd75a', 0.6);
  },
  feather(c) {
    c.save(); c.translate(0, -6); c.rotate(0.6);
    c.beginPath(); c.moveTo(0, 8); c.quadraticCurveTo(-4.6, 0, -1, -8); c.quadraticCurveTo(4.2, -2, 0.6, 7); c.closePath(); F(c, L(c, 0, -8, 0, 8, '#ffe066', '#ffffff', '#e8eefc')); K(c, 0.9);
    P(c, [-1, -8, -3.4, -3.4, -1.2, -4, -2.2, -1], false); K(c, 0.7, '#f2a51f');
    c.beginPath(); c.moveTo(0.4, 8.6); c.quadraticCurveTo(-0.4, 0, -0.8, -7.4); K(c, 0.7, 'rgba(120,130,170,0.9)');
    c.restore();
  },
};
function blade(c, col, edge) {
  c.save(); c.translate(0, -6); c.rotate(-0.78);
  P(c, [-1.8, -3, -1.8, -12, 0, -14.6, 1.8, -12, 1.8, -3]); F(c, L(c, -1.8, 0, 1.8, 0, lt(col, 0.5), col, edge)); K(c, 0.9);
  c.beginPath(); c.moveTo(0, -4); c.lineTo(0, -13); K(c, 0.6, 'rgba(255,255,255,0.7)');
  leafPath(c, -5.4, -2.4, 5.4, -2.4, 1.6); FK(c, '#6cc04a', 0, -2.4, 5, 0.8);
  RR(c, -1.1, -2, 2.2, 6, 0.8); FK(c, '#7a4a2e', 0, 1, 2, 0.8);
  ball(c, 0, 4.8, 1.6, 1.6, '#f2c94c', 0.7);
  c.restore();
}

// ---------- element badges ----------
const ELEMENTS = {
  leaf: ['#4fbf4a', (c) => { leafPath(c, -8.6, 7, 8.6, -8.6, 7.4, 0); }, (c) => { c.beginPath(); c.moveTo(-5.6, 5.2); c.quadraticCurveTo(-0.4, 0.4, 5.2, -5.4); for (const t of [-2.6, 0.2]) { c.moveTo(t, -t - 0.2); c.lineTo(t - 0.4, -t - 3.6); c.moveTo(t, -t - 0.2); c.lineTo(t + 3.4, -t + 0.2); } K(c, 1.3, CREAM); }],
  tide: ['#3f9fe6', (c) => { c.beginPath(); c.moveTo(0, -10.4); c.bezierCurveTo(4, -5.4, 8.4, -1, 8.4, 3); c.arc(0, 3, 8.4, 0, Math.PI); c.bezierCurveTo(-8.4, -1, -4, -5.4, 0, -10.4); c.closePath(); }, (c) => { c.beginPath(); c.moveTo(-5, 3); c.quadraticCurveTo(-2.4, -0.6, 0, 3); c.quadraticCurveTo(2.4, 6.4, 5, 3); K(c, 1.5, CREAM); }],
  ember: ['#ff7a2f', (c) => { flamePath(c, 0, 9, 8, 20, 1.6); }, (c) => { flamePath(c, 0, 6, 3.4, 9.6, 0.6); F(c, '#fff1a0'); }],
  spark: ['#f5c518', (c) => { star(c, 0, 0, 10.4, 5.6, 8, -Math.PI / 2); }, (c) => { bolt(c, 0, 0, 1.15, 0.2); F(c, '#fffbe0'); K(c, 0.7); }],
  stone: ['#b07a4a', (c) => { P(c, [0, -10, 8.8, -5, 8.8, 5, 0, 10, -8.8, 5, -8.8, -5]); }, (c) => { P(c, [-3.6, -3.4, 0, -5.4, 3.8, -2.6, 3, 2.6, -2, 3.6, -4.2, 0.6]); K(c, 1.3, CREAM); c.beginPath(); c.moveTo(0, -5.4); c.lineTo(-0.4, 0.4); c.lineTo(3, 2.6); K(c, 0.9, CREAM); }],
  moon: ['#9d8ee6', (c) => { c.beginPath(); c.arc(0, 0, 9.4, 0, TAU); }, (c) => { crescent(c, -0.6, 0, 5.6, -0.4, CREAM); star(c, 4, -4, 1.8, 0.5, 4); F(c, CREAM); }],
  shade: ['#5b3f8c', (c) => { P(c, [0, -10.6, 9.4, 0, 0, 10.6, -9.4, 0]); }, (c) => { E(c, 0, 0, 5.4, 3.2); F(c, CREAM); E(c, 0, 0, 2, 2.6); F(c, '#2a1a44'); E(c, -0.6, -0.8, 0.7, 0.7); F(c, '#ffffff'); }],
  storm: ['#5a6a9c', (c) => { scallop(c, 0, 1, 9.6, 7.4, Math.PI * 0.85, Math.PI * 2.15, 4, 0.28, true); c.closePath(); }, (c) => { bolt(c, 0, 1.4, 1.05, 0.15); F(c, '#ffe14d'); K(c, 0.7); }],
};
function badge(c, el) {
  const B = ELEMENTS[el] || ELEMENTS.spark;
  B[1](c); F(c, G(c, 0, 0, 10, B[0], 0.4, 0.32)); K(c, 1.3);
  c.save(); B[1](c); c.clip(); E(c, -3, -5.4, 7.4, 3.6, -0.5); F(c, 'rgba(255,255,255,0.22)'); c.restore();
  B[2](c);
}

// ---------- icons (PNG data URLs for the DOM HUD) ----------
function iconURL(kind, px) {
  const n = px * 2, cv = document.createElement('canvas');
  cv.width = cv.height = n;
  const x = cv.getContext('2d');
  const place = (s, cx, cy, worldSize) => {
    const k = n / worldSize; // sprite was rendered at k device px per world px
    x.drawImage(s.img, n / 2 - (s.ax + cx) * k, n / 2 - (s.ay + cy) * k, s.w * k, s.h * k);
  };
  const [type, id] = kind.includes(':') ? kind.split(':') : ['item', kind];
  if (type === 'item' && ITEMS[id]) {
    const k = n / 21;
    place(make(k, { w: 22, h: 22, ax: 11, ay: 17, body: (c) => ITEMS[id](c) }), 0, -6, 21);
  } else if (type === 'sp' && CR[id]) {
    const [cx, cy, size] = CR[id].portrait, k = n / size;
    place(creatureSprite(k, id, 'down', 'idle', 0), cx, cy, size);
  } else if (type === 'el') {
    const k = n / 24;
    place(make(k, { w: 24, h: 24, ax: 12, ay: 12, ow: 0.9, body: (c) => badge(c, id) }), 0, 0, 24);
  } else if (type === 'npc' && NPCS[id]) {
    const sc = NPCS[id].scale || 1, size = 30 * sc, k = n / size;
    place(npcSprite(k, id, 'down', 0), 0, -29 * sc, size);
  } else if (type === 'boss' && BOSSES[id]) {
    const [cx, cy, size] = BOSSES[id].portrait, k = n / size;
    place(bossSprite(k, id, 'idle', 0, false), cx, cy, size);
  } else {
    const k = n / 24;
    place(make(k, { w: 24, h: 24, ax: 12, ay: 12, body: (c) => { ball(c, 0, 0, 8, 8, '#8f9bd0'); star(c, 0, 0, 5, 2, 4); F(c, CREAM); } }), 0, 0, 24);
  }
  return cv.toDataURL('image/png');
}

// ---------- cover illustration (SVG, 320×200) ----------
function coverSVG() {
  const defs = [], ids = new Map();
  const n = (v) => Math.round(v * 10) / 10;
  const rg = (col, hi = 0.45, lo = 0.3) => {
    const key = col + hi + lo;
    if (!ids.has(key)) { const id = 'ci' + ids.size; ids.set(key, id); defs.push(`<radialGradient id="${id}" cx="0.36" cy="0.3" r="0.8"><stop offset="0" stop-color="${lt(col, hi)}"/><stop offset="0.55" stop-color="${col}"/><stop offset="1" stop-color="${dk(col, lo)}"/></radialGradient>`); }
    return `url(#${ids.get(key)})`;
  };
  const lg = (id, x2, y2, stops) => { defs.push(`<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</linearGradient>`); return `url(#${id})`; };
  const radial = (id, stops) => { defs.push(`<radialGradient id="${id}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</radialGradient>`); return `url(#${id})`; };
  const O = (w = 1.1) => `stroke="${OUT}" stroke-width="${w}"`;
  const ell = (cx, cy, rx, ry, fill, w = 1.1, extra = '') => `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(rx)}" ry="${n(ry)}" fill="${fill}" ${w ? O(w) : ''} ${extra}/>`;
  const path = (d, fill, w = 1.1, extra = '') => `<path d="${d}" fill="${fill}" ${w ? O(w) : ''} ${extra}/>`;
  const line = (d, col, w) => `<path d="${d}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const scD = (cx, cy, rx, ry, k, amp, a0 = 0, a1 = TAU) => {
    let d = `M${n(cx + Math.cos(a0) * rx)} ${n(cy + Math.sin(a0) * ry)}`;
    for (let i = 0; i < k; i++) { const a = a0 + (a1 - a0) * (i + 0.5) / k, b = a0 + (a1 - a0) * (i + 1) / k; d += ` Q${n(cx + Math.cos(a) * rx * (1 + amp))} ${n(cy + Math.sin(a) * ry * (1 + amp))} ${n(cx + Math.cos(b) * rx)} ${n(cy + Math.sin(b) * ry)}`; }
    return d + ' Z';
  };
  const leafD = (x0, y0, x1, y1, w) => { const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy), nx = -dy / l * w * 1.25, ny = dx / l * w * 1.25, mx = (x0 + x1) / 2, my = (y0 + y1) / 2; return `M${n(x0)} ${n(y0)} Q${n(mx + nx)} ${n(my + ny)} ${n(x1)} ${n(y1)} Q${n(mx - nx)} ${n(my - ny)} ${n(x0)} ${n(y0)} Z`; };
  const flameD = (x, y, w, h, lean = 0) => `M${n(x)} ${n(y + w * 0.15)} C${n(x - w * 1.1)} ${n(y - h * 0.05)} ${n(x - w * 0.7)} ${n(y - h * 0.62)} ${n(x + lean)} ${n(y - h)} C${n(x + w * 0.35 + lean * 0.3)} ${n(y - h * 0.6)} ${n(x + w * 1.15)} ${n(y - h * 0.25)} ${n(x)} ${n(y + w * 0.15)} Z`;
  const eyes = (xs, y, rx, ry, iris = '#241a30') => xs.map((x) => `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${rx}" ry="${ry}" fill="${iris}"/><ellipse cx="${n(x - rx * 0.32)}" cy="${n(y - ry * 0.36)}" rx="${n(rx * 0.46)}" ry="${n(ry * 0.36)}" fill="#fff"/><circle cx="${n(x + rx * 0.38)}" cy="${n(y + ry * 0.44)}" r="${n(rx * 0.2)}" fill="#fff" opacity="0.85"/>`).join('');
  const blushes = (xs, y, rx = 1.9) => xs.map((x) => `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${rx}" ry="${n(rx * 0.58)}" fill="#ff6e82" opacity="0.38"/>`).join('');
  const emb = (shape, x, y, r) => {
    const d = shape === 'circle' ? `M${x - r} ${y} a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0 Z`
      : shape === 'triangle' ? `M${x} ${n(y - r * 1.12)} L${n(x + r * 1.08)} ${n(y + r * 0.78)} L${n(x - r * 1.08)} ${n(y + r * 0.78)} Z`
        : `M${n(x - r * 0.86)} ${n(y - r * 0.86)} h${n(r * 1.72)} v${n(r * 1.72)} h${n(-r * 1.72)} Z`;
    return path(d, CREAM, 0.8);
  };
  const HAIR = {
    spiky: path('M-5 -9.6 L-2.6 -15.4 L0.4 -10.8 Z M-0.6 -10.8 L3.4 -15.6 L5.2 -9.8 Z M4.6 -9.6 L9.2 -12.6 L8.4 -6.6 Z', '#7c4a2b') + 'M-11.1 3.2 C-12.3 -8.4 -6.6 -11.5 0 -11.5 C6.6 -11.5 12.3 -8.4 11.1 3.2 L10.6 -0.6 L8.6 -4.2 L6.8 -1.2 L4.6 -4.8 L2.4 -1.4 L0.2 -5 L-2.3 -1.6 L-4.6 -4.8 L-6.8 -1.3 L-8.8 -4.4 L-10.6 -0.6 Z',
    ponytail: 'M-11.1 3.2 C-12.3 -8.4 -6.6 -11.5 0 -11.5 C6.6 -11.5 12.3 -8.4 11.1 3.2 Q10.6 -1.4 9.4 -2.8 Q7.5 -4 5.6 -4.6 Q3.4 -3.8 1.2 -3 Q-0.7 -3.9 -2.6 -4.8 Q-5 -3.7 -7.4 -2.6 Q-8.9 -0.8 -10.4 1 Z',
    buns: 'M-11.1 3.2 C-12.3 -8.4 -6.6 -11.5 0 -11.5 C6.6 -11.5 12.3 -8.4 11.1 3.2 L10.6 1 Q10.2 -2.6 9.8 -2.6 Q5 -1.9 0 -2.2 Q-5 -1.9 -9.8 -2.6 L-10.6 1 Z',
  };
  const kid = (x, y, s, o) => {
    const parts = HAIR[o.hair].split(/(?=M-11\.1 3\.2)/);
    const capD = parts.length > 1 ? parts[1] : parts[0], tufts = parts.length > 1 ? parts[0] : '';
    const arm = (sx, sy, hx, hy) => { const d = `M${sx} ${sy} Q${n((sx + hx) / 2 + (hx > 0 ? 1.3 : -1.3))} ${n((sy + hy) / 2)} ${hx} ${hy}`; return line(d, OUT, 5.8) + line(d, lt(o.coat, 0.08), 3.8) + ell(hx, hy, 2, 2, rg(o.skin), 0.9); };
    const L = o.arm === 'wave' ? [-11.6, -29] : [-8.6, -11.2], R = o.arm === 'point' ? [14, -25] : [8.6, -11.2];
    let g = `<g transform="translate(${x} ${y}) scale(${s})">`;
    if (o.hair === 'ponytail') g += path('M7 -31 C15 -31 17.6 -21 14.6 -12.6 C12 -16 10 -20 6.4 -23 Z', rg(o.hairCol, 0.38, 0.32));
    g += path('M-6.4 -19.6 L-9.8 -8.2 L9.8 -8.2 L6.4 -19.6 Z', rg(dk(o.coat, 0.24)));
    for (const lx of [-5.4, 1.2]) g += `<rect x="${lx}" y="-9.6" width="4.2" height="7.4" rx="1.6" fill="#4b5677" ${O(0.9)}/>`;
    for (const bx of [-3.4, 3.4]) g += ell(bx, -1.8, 3.1, 2.3, rg('#7a4a2e'), 0.9);
    g += path('M-5.6 -19.6 Q0 -21 5.6 -19.6 Q7.4 -18.4 7.3 -14.5 L7.9 -8.4 Q0 -6.8 -7.9 -8.4 L-7.3 -14.5 Q-7.4 -18.4 -5.6 -19.6 Z', rg(o.coat));
    g += `<rect x="-7.6" y="-10.6" width="15.2" height="1.9" rx="0.8" fill="#7a4a2e" ${O(0.6)}/><rect x="-1.2" y="-10.9" width="2.4" height="2.5" rx="0.6" fill="#f2c94c" ${O(0.5)}/>`;
    g += path('M-3.2 -19.9 L3.2 -19.9 L0 -17.6 Z', CREAM, 0.6) + emb(o.emblem, 0, -13.8, 2.7);
    g += line('M5.2 -19.4 Q7.4 -15 7.6 -11.6', '#7a4a2e', 1.3) + `<rect x="5.6" y="-12.6" width="4.8" height="4.6" rx="1.3" fill="${rg('#b0743f')}" ${O(0.8)}/>`;
    g += arm(-6.3, -17.8, ...L) + arm(6.3, -17.8, ...R);
    g += '<g transform="translate(0 -28.6)">';
    if (o.hair === 'buns') for (const bx of [-8.4, 8.4]) g += ell(bx, -9.4, 4.4, 4.2, rg(o.hairCol, 0.38, 0.32));
    for (const ex of [-10.1, 10.1]) g += ell(ex, 1.3, 2.2, 2.6, rg(o.skin), 0.9);
    g += ell(0, 0, 10.6, 9.8, rg(o.skin, 0.3, 0.22));
    g += eyes([-3.9, 3.9], 2.2, 1.75, 2.35, '#3a2618') + blushes([-6.7, 6.7], 5.4);
    g += path('M-1.8 5.4 Q0 8.2 1.8 5.4 Z', '#7a2b3a', 0.8);
    if (tufts) g += tufts.replace('#7c4a2b', rg(o.hairCol, 0.38, 0.32));
    g += path(capD, rg(o.hairCol, 0.38, 0.32)) + line('M-6.9 -5.9 A8.2 8.2 0 0 1 -2.8 -8.2', 'rgba(255,255,255,0.45)', 1.3);
    return g + '</g></g>';
  };
  const mossip = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})">${path(leafD(4, -8, 15.5, -23, 4.6), rg('#5cba47'))}${line('M5 -9 Q12 -13 14.6 -21.8', '#2c7a39', 0.85)}
    ${ell(0, -7.6, 7.6, 6.2, rg('#8ad15f'))}${ell(0, -5.8, 4.4, 4.4, rg('#fff1cf'), 0)}${ell(-3.6, -1.7, 2.7, 2, rg('#fff1cf'), 0.9)}${ell(3.6, -1.7, 2.7, 2, rg('#fff1cf'), 0.9)}
    ${path(scD(0, -11.4, 10, 4.8, 10, 0.16), rg('#3e9c4d'))}${path('M-8 -19 Q-11 -25 -10.2 -29.2 Q-5 -26 -3 -22.6 Z', rg('#8ad15f'))}${path('M8 -19 Q11 -25 10.2 -29.2 Q5 -26 3 -22.6 Z', rg('#8ad15f'))}
    ${path('M-7.6 -20 Q-9.2 -24 -9 -26.6 Q-6 -24.4 -4.6 -22 Z', '#ffd3ad', 0)}${path('M7.6 -20 Q9.2 -24 9 -26.6 Q6 -24.4 4.6 -22 Z', '#ffd3ad', 0)}
    ${ell(0, -16.6, 8.8, 7.6, rg('#8ad15f'))}${ell(0, -12.2, 4.6, 3, rg('#fff1cf'), 0.8)}${ell(0, -13.7, 1.45, 1.05, '#3a2a3a', 0)}
    ${eyes([-3.8, 3.8], -17.6, 1.95, 2.55, '#3b2a18')}${blushes([-6.1, 6.1], -13.8, 1.5)}${line('M-1.4 -12 Q-0.7 -11 0 -12 Q0.7 -11 1.4 -12', OUT, 0.8)}
    ${path(leafD(0, -23.8, -4.2, -27.2, 1.5), rg('#5cba47'), 0.8)}${path(leafD(0, -23.8, 3.4, -28.2, 1.5), rg('#6cc55a'), 0.8)}</g>`;
  const emberkit = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})">${line('M4 -6 Q11.8 -8.6 10.6 -17.4', OUT, 4.4)}${line('M4 -6 Q11.8 -8.6 10.6 -17.4', '#ff8a3d', 2.6)}
    ${path(flameD(10.6, -17.2, 2.1, 5.6, 0.4), '#ff6a1f', 0.8)}${path(flameD(10.6, -17.4, 1.2, 3.6, 0.2), '#fff1a0', 0)}
    ${ell(0, -7, 6.8, 5.6, rg('#ff8a3d'))}${ell(0, -5.8, 3.8, 4, rg('#ffe3b4'), 0)}${ell(-3.3, -1.6, 2.5, 1.9, rg('#ffe3b4'), 0.9)}${ell(3.3, -1.6, 2.5, 1.9, rg('#ffe3b4'), 0.9)}
    ${path('M-8.8 -18.4 Q-10.6 -24 -9.8 -27.8 Q-5.6 -25.6 -3.4 -22.8 Z', rg('#ff8a3d'))}${path('M8.8 -18.4 Q10.6 -24 9.8 -27.8 Q5.6 -25.6 3.4 -22.8 Z', rg('#ff8a3d'))}
    ${path(flameD(-9.5, -26.2, 1.3, 3.6, -0.8), '#ffb52e', 0.7)}${path(flameD(9.5, -26.2, 1.3, 3.6, 0.8), '#ffb52e', 0.7)}
    ${ell(0, -16, 9.4, 8, rg('#ff8a3d'))}${line('M-2.8 -23.2 L-2.3 -20.8 M0 -24 L0 -21.2 M2.8 -23.2 L2.3 -20.8', '#d64e28', 1.3)}
    ${ell(0, -12, 4.2, 2.7, rg('#ffe3b4'), 0.8)}${path('M-1.3 -13.9 L1.3 -13.9 L0 -12.5 Z', '#e0506a', 0.6)}
    ${eyes([-4.1, 4.1], -16.6, 2.1, 2.6, '#8a3a12')}${blushes([-6.6, 6.6], -13.2, 1.5)}${line('M-1.6 -12.1 Q-0.8 -11 0 -12.1 Q0.8 -11 1.6 -12.1', OUT, 0.8)}
    ${line('M-4.4 -12.6 L-9 -13.4 M-4.4 -11.6 L-9 -10.8 M4.4 -12.6 L9 -13.4 M4.4 -11.6 L9 -10.8', '#fff6de', 0.55)}</g>`;
  const dewpaw = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})">${path('M4.4 -3.4 Q10 -2.6 14.6 -6 Q15.6 -10 12.8 -8.4 Q8.6 -6.8 6 -7 Z', rg('#2a76b0'))}
    ${ell(-4, -1.4, 3, 1.9, rg('#3592c4'), 0.9)}${ell(4, -1.4, 3, 1.9, rg('#3592c4'), 0.9)}
    ${path('M0 -15.2 Q6.4 -14 7.8 -6 Q7.4 -1.6 0 -1.6 Q-7.4 -1.6 -7.8 -6 Q-6.4 -14 0 -15.2 Z', rg('#3fa9dc'))}${ell(0, -6.2, 4.8, 4.4, rg('#fff1da'), 0)}
    ${ell(-7.4, -22.6, 2.5, 2.3, rg('#3fa9dc'))}${ell(7.4, -22.6, 2.5, 2.3, rg('#3fa9dc'))}${ell(0, -18.2, 8.8, 7.4, rg('#3fa9dc'))}
    ${ell(0, -15, 4.9, 3.2, rg('#fff1da'), 0.8)}${ell(0, -16.3, 1.8, 1.2, '#26304e', 0)}${eyes([-3.9, 3.9], -19.4, 1.85, 2.4, '#1f2e5a')}${blushes([-6.3, 6.3], -15.8, 1.4)}
    ${line('M-1.4 -14.6 Q-0.7 -13.6 0 -14.6 Q0.7 -13.6 1.4 -14.6', OUT, 0.8)}
    ${[[-6.9, -12.4, 1.8], [-3.5, -11.5, 2], [0, -11.2, 2.1], [3.5, -11.5, 2], [6.9, -12.4, 1.8]].map(([bx, by, r]) => ell(bx, by, r, r, '#bfefff', 0.7, 'opacity="0.95"') + ell(bx - r * 0.36, by - r * 0.38, r * 0.34, r * 0.22, '#fff', 0)).join('')}</g>`;
  const gull = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})">${path('M-4 -1 Q-10 -8 -16 -6 Q-12 -3 -13 0 Q-8 0 -4 2 Z', rg('#f7f9ff'))}${path('M4 -1 Q10 -8 16 -6 Q12 -3 13 0 Q8 0 4 2 Z', rg('#f7f9ff'))}
    ${path('M-16 -6 L-12.6 -3.4 L-14 -1.6 L-13 0 Z', '#ffd43b', 0.6)}${path('M16 -6 L12.6 -3.4 L14 -1.6 L13 0 Z', '#ffd43b', 0.6)}${ell(0, 0, 5, 5.2, rg('#f7f9ff'))}
    ${eyes([-1.9, 1.9], -0.8, 1.1, 1.4, '#24304f')}${path('M-1.2 1 L1.2 1 L0 3 Z', '#ff9f43', 0.6)}</g>`;
  // ---- scene ----
  let s = '';
  s += `<rect width="320" height="200" fill="${lg('cvSky', 0, 1, [[0, '#53bdf0'], [0.5, '#a6e1fb'], [0.72, '#ffe9c4']])}"/>`;
  s += `<circle cx="58" cy="40" r="60" fill="${radial('cvSun', [[0, '#fffbe0', 0.75], [0.3, '#fff3c0', 0.35], [1, '#fff1b0', 0]])}"/>`;
  s += `<g opacity="0.35">${Array.from({ length: 12 }, (_, i) => { const a = i / 12 * TAU + 0.13, b = a + 0.09; return `<path d="M58 40 L${n(58 + Math.cos(a) * 46)} ${n(40 + Math.sin(a) * 46)} L${n(58 + Math.cos(b) * 46)} ${n(40 + Math.sin(b) * 46)} Z" fill="#fff6c8"/>`; }).join('')}</g>`;
  s += `<circle cx="58" cy="40" r="14" fill="${radial('cvSunC', [[0, '#fffef4'], [0.45, '#fff2a0'], [0.85, '#ffd84a'], [1, '#ffc23a']])}"/>`;
  for (const [cx, cy, k] of [[124, 34, 1], [186, 56, 0.8], [18, 72, 0.7]]) s += `<g opacity="0.92" transform="translate(${cx} ${cy}) scale(${k})"><ellipse cx="0" cy="0" rx="20" ry="7" fill="#fff"/><ellipse cx="-8" cy="-4" rx="9" ry="7" fill="#fff"/><ellipse cx="6" cy="-6" rx="10" ry="8" fill="#fff"/><ellipse cx="0" cy="3" rx="20" ry="3" fill="#dfeffa"/></g>`;
  // far hills and the stormy peak
  s += path('M150 112 Q180 96 206 104 Q232 96 260 102 Q292 92 320 100 L320 118 L150 118 Z', '#9bb3d6', 0);
  s += path('M196 118 L232 78 L246 66 L258 50 L268 42 L278 52 L292 68 L306 76 L320 84 L320 118 Z', lg('cvPeak', 0.4, 1, [[0, '#7c8fba'], [1, '#4a587c']]), 1.1);
  s += path('M268 42 L278 52 L292 68 L306 76 L320 84 L320 118 L262 118 L272 92 L266 70 Z', 'rgba(36,44,80,0.28)', 0);
  s += path('M268 42 L262 52 L256 50 L252 58 L258 60 L268 50 Z', 'rgba(220,230,250,0.55)', 0);
  s += line('M262 54 L254 66 L246 72 L236 84', '#b3c3e2', 1.3) + line('M272 92 L266 70 L268 50', 'rgba(36,44,80,0.45)', 1) + line('M240 96 L250 88 M222 106 L232 100 M284 84 L290 96 M300 92 L306 104', 'rgba(36,44,80,0.4)', 1);
  s += `<circle cx="266" cy="30" r="44" fill="${radial('cvStorm', [[0, '#3d4470', 0.5], [1, '#3d4470', 0]])}"/>`;
  for (const [cx, cy, rx, ry, col] of [[246, 30, 18, 9, '#4c578a'], [286, 28, 20, 10, '#4c578a'], [266, 22, 22, 12, '#3a4270'], [262, 34, 26, 8, '#2f3660']]) s += path(scD(cx, cy, rx, ry, 8, 0.14), rg(col, 0.25, 0.3), 1);
  s += `<circle cx="276" cy="52" r="14" fill="#fff27a" opacity="0.22"/>`;
  s += path('M280 36 L286 36 L281 44 L287 44 L280 53 L285 53 L272 66 L276 55 L271 55 L275 46 L270 46 Z', '#ffe14d', 0.9) + line('M281 39 L278 45 L282 46 L276 56', 'rgba(255,255,255,0.85)', 0.7);
  s += path('M250 20 Q258 12 266 18 Q274 12 282 20 Q274 18 266 23 Q258 18 250 20 Z', '#232a4c', 0) + `<circle cx="264" cy="18.6" r="0.9" fill="#c9f8ff"/><circle cx="268" cy="18.6" r="0.9" fill="#c9f8ff"/>`;
  for (const [x0, y0] of [[244, 40], [252, 44], [282, 40], [292, 42], [298, 36]]) s += line(`M${x0} ${y0} l-3 9`, 'rgba(90,106,154,0.55)', 1);
  // sea
  s += `<rect y="104" width="320" height="40" fill="${lg('cvSea', 0, 1, [[0, '#7fdcf3'], [0.4, '#45bde6'], [1, '#2a98cc']])}"/>`;
  s += line('M0 104.4 L320 104.4', 'rgba(255,255,255,0.7)', 0.8);
  for (const [x, y, w] of [[96, 110, 10], [130, 114, 6], [170, 109, 8], [60, 116, 7], [200, 116, 6], [24, 110, 5]]) s += line(`M${x} ${y} h${w}`, 'rgba(255,255,255,0.75)', 1);
  s += path('M20 105 Q34 96 48 105 Z', '#6cbf58', 0.8) + line('M36 102 Q37 94 40 90', '#8a5a36', 1.2) + path('M40 90 Q34 88 31 91 M40 90 Q46 87 49 90 M40 90 Q38 85 35 84 M40 90 Q43 85 46 85', 'none', 0, 'stroke="#3f9a46" stroke-width="1.6" stroke-linecap="round"');
  // beach and island
  s += path('M0 130 C40 122 90 124 130 127 C170 130 220 124 260 126 C290 127 310 124 320 125 L320 200 L0 200 Z', lg('cvSand', 0, 1, [[0, '#fbe8bd'], [1, '#efd39a']]), 1);
  s += line('M0 129 C40 121 90 123 130 126 C170 129 220 123 260 125 C290 126 310 123 320 124', 'rgba(255,255,255,0.85)', 1.6);
  s += path('M0 148 C30 136 70 138 104 142 C140 146 170 139 200 136 C240 133 280 139 320 134 L320 200 L0 200 Z', lg('cvGrass', 0, 1, [[0, '#8dd466'], [1, '#56b247']]), 1.1);
  // village cottage and a far tree line
  s += path(scD(274, 130, 16, 6, 6, 0.3), rg('#4fa84a', 0.3, 0.3), 0.9) + path(scD(300, 128, 14, 6, 5, 0.3), rg('#45a046', 0.3, 0.3), 0.9);
  s += `<rect x="226" y="117" width="22" height="13" rx="1" fill="${rg('#f6ead4', 0.2, 0.2)}" ${O(0.9)}/>` + path('M222 118 L228 108 L246 108 L252 118 Z', rg('#e0574f', 0.35, 0.25), 0.9);
  s += `<rect x="234" y="122" width="5" height="8" rx="2" fill="#9a5f34" ${O(0.6)}/><rect x="228.6" y="120" width="4" height="3.6" fill="#ffd779" ${O(0.5)}/><rect x="241.4" y="120" width="4" height="3.6" fill="#ffd779" ${O(0.5)}/>`;
  // winding path
  s += path('M118 200 C136 182 146 170 166 160 C182 152 198 146 212 141 L222 142 C208 148 196 156 186 164 C172 176 174 188 198 200 Z', lg('cvPath', 0, 1, [[0, '#f8e4b2'], [1, '#ecd09a']]), 0, `stroke="#d4b47a" stroke-width="1.2"`);
  for (const [x, y, r] of [[160, 172, 1.6], [176, 166, 1.2], [150, 186, 1.4], [196, 152, 1]]) s += ell(x, y, r * 1.4, r, '#d9c49a', 0.6);
  // big palm on the left
  const trunk = []; for (let i = 0; i < 9; i++) { const t = i / 8; trunk.push([22 + Math.sin(t * 1.4) * 22, 196 - t * 104]); }
  for (let i = 0; i < 8; i++) { const [x0, y0] = trunk[i], [x1, y1] = trunk[i + 1], w = 6 - i * 0.35; s += path(`M${n(x0 - w)} ${n(y0)} L${n(x1 - w + 0.6)} ${n(y1)} L${n(x1 + w - 0.6)} ${n(y1)} L${n(x0 + w)} ${n(y0)} Z`, rg(i % 2 ? '#b98652' : '#c99a62', 0.3, 0.25), 0.9); }
  const [tx, ty] = trunk[8];
  for (const [a, l, d] of [[-2.95, 36, 12], [-0.2, 38, 14], [-2.3, 30, -2], [-0.9, 30, -2], [-1.6, 24, -4], [2.6, 28, 16], [0.5, 30, 16]]) {
    const x1 = tx + Math.cos(a) * l, y1 = ty + Math.sin(a) * l + d, mx = tx + Math.cos(a) * l * 0.5, my = ty + Math.sin(a) * l * 0.5 - 7;
    s += path(`M${n(tx)} ${n(ty)} Q${n(mx)} ${n(my - 3)} ${n(x1)} ${n(y1)} Q${n(mx + 2)} ${n(my + 7)} ${n(tx)} ${n(ty + 2)} Z`, rg('#4fb04a', 0.35, 0.3), 1);
    s += line(`M${n(tx)} ${n(ty)} Q${n(mx)} ${n(my - 1)} ${n(x1)} ${n(y1)}`, '#8fd46a', 0.9);
  }
  for (const [x, y] of [[-3, 3], [3, 4], [0, 6.4]]) s += ell(tx + x, ty + y, 3.4, 3.4, rg('#7a5230'), 0.9);
  // bushes and flowers
  for (const [x, y, r, col] of [[70, 150, 9, '#45a04a'], [84, 148, 11, '#5cb84f'], [292, 150, 10, '#45a04a'], [306, 152, 9, '#5cb84f']]) s += path(scD(x, y, r, r * 0.85, 8, 0.12), rg(col, 0.35, 0.3), 1);
  for (const [x, y, col] of [[66, 160, '#ff8fb1'], [74, 163, '#ffd43b'], [252, 152, '#9db4ff'], [260, 155, '#ff8fb1'], [104, 160, '#ffd43b']]) s += ell(x, y, 2.4, 2.4, rg(col, 0.4, 0.2), 0.7) + ell(x, y, 0.9, 0.9, '#fff3c0', 0);
  // flying gullwisp
  s += gull(144, 70, 0.9) + gull(176, 82, 0.55);
  // tall grass with a lunahop peeking out
  const bladeFill = (col) => { const id = 'cvB' + col.slice(1); if (!ids.has(id)) { ids.set(id, id); defs.push(`<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${lt(col, 0.4)}"/><stop offset="0.5" stop-color="${col}"/><stop offset="1" stop-color="${dk(col, 0.2)}"/></linearGradient>`); } return `url(#${id})`; };
  const blades = (x0, x1, by, h, col, seed) => { let o = ''; for (let x = x0, i = 0; x < x1; x += 4.4, i++) { const hh = h + Math.sin(i * 2.3 + seed) * 4, lean = Math.sin(i * 1.7 + seed) * 3; o += path(`M${n(x - 2.4)} ${by} Q${n(x - 1.2 + lean * 0.3)} ${n(by - hh * 0.6)} ${n(x + lean)} ${n(by - hh)} Q${n(x + 1.6 + lean * 0.3)} ${n(by - hh * 0.55)} ${n(x + 2.4)} ${by} Z`, bladeFill(col), 0, `stroke="${dk(col, 0.55)}" stroke-width="0.55" stroke-linejoin="round"`); } return o; };
  s += blades(258, 322, 182, 18, '#47a04a', 1);
  s += `<g transform="translate(290 182)">${ell(-4.4, -30, 3.2, 9, rg('#dcd6f8', 0.35, 0.3), 1.1, 'transform="rotate(-10 -4.4 -30)"')}${ell(4.4, -30, 3.2, 9, rg('#dcd6f8', 0.35, 0.3), 1.1, 'transform="rotate(12 4.4 -30)"')}
    ${ell(-4.4, -29, 1.6, 6.4, '#a493ea', 0, 'transform="rotate(-10 -4.4 -29)"')}${ell(4.4, -29, 1.6, 6.4, '#a493ea', 0, 'transform="rotate(12 4.4 -29)"')}
    ${ell(0, -16, 9, 8, rg('#dcd6f8', 0.35, 0.28))}${eyes([-3.6, 3.6], -15.6, 2, 2.6, '#4a3a9a')}${path('M-1.6 -22.2 A2.4 2.4 0 1 0 1.8 -19.8 A1.9 1.9 0 1 1 -1.6 -22.2 Z', '#ffe08a', 0.6)}</g>`;
  s += `<circle cx="290" cy="166" r="22" fill="${radial('cvMoon', [[0, '#c9b8ff', 0.35], [1, '#c9b8ff', 0]])}"/>`;
  s += blades(256, 324, 194, 20, '#5cb84f', 4) + blades(254, 326, 202, 18, '#6cc554', 7);
  // explorers and companions on the path
  s += mossip(98, 190, 1.05) + emberkit(150, 184, 0.95);
  s += kid(128, 188, 1.12, { coat: '#ff6b6b', emblem: 'circle', hair: 'spiky', hairCol: '#7c4a2b', skin: '#ffe0c4', arm: 'wave' });
  s += kid(176, 176, 1, { coat: '#4dabf7', emblem: 'triangle', hair: 'ponytail', hairCol: '#2d3152', skin: '#85553a', arm: 'point' });
  s += kid(218, 190, 1.12, { coat: '#ffd43b', emblem: 'square', hair: 'buns', hairCol: '#e2703a', skin: '#c48656', arm: 'down' });
  s += dewpaw(244, 194, 1.05);
  // foreground framing grass and a soft vignette
  s += blades(-4, 70, 204, 14, '#4a9f45', 9) + blades(-4, 60, 208, 12, '#5cb84f', 3);
  s += `<rect width="320" height="200" fill="${radial('cvVig', [[0.6, '#0b1024', 0], [1, '#0b1024', 0.35]])}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200"><defs>${defs.join('')}</defs><g stroke-linejoin="round" stroke-linecap="round">${s}</g></svg>`;
}
export const COVER_SVG = coverSVG();


// ---------- public API ----------
export const FRAMES = {
  player: { idle: 2, walk: 4, attack: 3, dodge: 2, hurt: 1, down: 1 },
  creature: { idle: 2, walk: 4, attack: 2, hurt: 1, faint: 1 },
  boss: { idle: 2, walk: 4, windup: 1, attack: 2, hurt: 1, faint: 1 },
  murkling: { idle: 2, walk: 4, attack: 2, hurt: 1, faint: 1 },
  npc: 2,
  prop: { campfire: 4, lantern: 2, crystal: 2, cavecrystal: 2, stormgate: 2, tallgrass: 3 },
};

export function createArt(res) {
  res = Math.max(0.5, Math.min(6, +res || 1));
  const cache = new Map(), icons = new Map();
  const get = (key, fn) => { let s = cache.get(key); if (!s) { s = fn(); cache.set(key, s); } return s; };
  const fr = (n, f) => (((f | 0) % n) + n) % n;
  const dirOf = (d) => (d === 'up' || d === 'left' || d === 'right' ? d : 'down');
  const animOf = (table, a, dflt = 'idle') => (table[a] ? a : dflt);
  return {
    res,
    frames: FRAMES,
    player(look = {}, dir = 'down', anim = 'idle', frame = 0) {
      const a = animOf(FRAMES.player, anim), f = fr(FRAMES.player[a], frame), d = dirOf(dir);
      const l = { skin: ((look.skin | 0) % 4 + 4) % 4, hair: ((look.hair | 0) % 6 + 6) % 6, outfit: ((look.outfit | 0) % 4 + 4) % 4 };
      return get(`p|${l.skin}|${l.hair}|${l.outfit}|${d}|${a}|${f}`, () => playerSprite(res, l, d, a, f));
    },
    npc(kind, dir = 'down', frame = 0) {
      const k = NPCS[kind] ? kind : 'elder', f = fr(FRAMES.npc, frame), d = dirOf(dir);
      return get(`n|${k}|${d}|${f}`, () => npcSprite(res, k, d, f));
    },
    creature(sp, dir = 'down', anim = 'idle', frame = 0) {
      const s = CR[sp] ? sp : 'mossip', a = animOf(FRAMES.creature, anim), f = fr(FRAMES.creature[a], frame), d = dirOf(dir);
      return get(`c|${s}|${d}|${a}|${f}`, () => creatureSprite(res, s, d, a, f));
    },
    boss(kind, anim = 'idle', frame = 0, flip = false) {
      const k = BOSSES[kind] ? kind : 'mirebrute', a = animOf(FRAMES.boss, anim), f = fr(FRAMES.boss[a], frame);
      return get(`b|${k}|${a}|${f}|${flip ? 1 : 0}`, () => bossSprite(res, k, a, f, !!flip));
    },
    murkling(anim = 'idle', frame = 0) {
      const a = animOf(FRAMES.murkling, anim), f = fr(FRAMES.murkling[a], frame);
      return get(`m|${a}|${f}`, () => murklingSprite(res, a, f));
    },
    prop(kind, variant = 0, frame = 0) {
      const k = PROPS[kind] ? kind : 'rock', n = FRAMES.prop[k] || 1, f = fr(n, frame), v = Math.max(0, variant | 0);
      return get(`o|${k}|${v}|${f}`, () => propSprite(res, k, v, f));
    },
    item(kind) {
      const k = ITEMS[kind] ? kind : 'sunberry';
      return get(`i|${k}`, () => make(res, { w: 30, h: 27, ax: 15, ay: 19, under: (c) => { E(c, 0, 2.6, 6.5, 2.2); F(c, 'rgba(20,24,48,0.22)'); }, body: (c) => ITEMS[k](c) }));
    },
    icon(kind, px = 32) {
      const n = Math.max(8, Math.min(512, Math.round(px) || 32)), key = `${kind}|${n}`;
      let u = icons.get(key);
      if (!u) { u = iconURL(String(kind), n); icons.set(key, u); }
      return u;
    },
  };
}
