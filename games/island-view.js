// Drawing Creature Island: soft terrain baked into chunks, animated water, scenery and creatures sorted by
// depth, attack warnings, effects, cave darkness and the storm on the peak. Pure drawing: the client tells
// it what to show (island-client.js).
import { TILE, SPECIES, SEATS, CATCH_HP } from './island-data.js';
import { island, W, H, G, GATES, hash, noise } from './island-map.js';
import { createArt } from './island-art.js';

const T = TILE;
const CH = 8; // tiles per terrain chunk
const SUB = 4; // colour cells per tile in the soft ground map
const PAL = {
  [G.VOID]: [11, 8, 18], [G.SEA]: [31, 95, 153], [G.SHALLOW]: [78, 176, 214], [G.SAND]: [240, 219, 160], [G.GRASS]: [122, 196, 92],
  [G.FOREST]: [80, 152, 74], [G.PATH]: [206, 168, 117], [G.PLAZA]: [201, 195, 184], [G.TALL]: [104, 182, 80], [G.WATER]: [74, 163, 214],
  [G.CAVE]: [76, 64, 94], [G.CAVEWALL]: [43, 34, 56], [G.ROCK]: [166, 156, 150], [G.CLIFF]: [142, 128, 118], [G.BRIDGE]: [74, 163, 214],
  [G.DOCK]: [74, 163, 214], [G.MARSH]: [126, 152, 92],
};
const WATERY = new Set([G.SEA, G.SHALLOW, G.WATER]);
const WALLS = new Set([G.CLIFF, G.CAVEWALL, G.VOID]);
// Built ground keeps straight edges: no wobble into or out of it.
const CRISP = new Set([G.CLIFF, G.CAVEWALL, G.VOID, G.PLAZA, G.DOCK]);
const FLAT = new Set(['flowers', 'lily', 'cracked', 'shell', 'footprint', 'bridge', 'driftwood']);
const DIRS = ['down', 'up', 'left', 'right'];
const P_ANIM = ['idle', 'walk', 'attack', 'dodge', 'hurt', 'down'];
const C_ANIM = ['idle', 'walk', 'attack', 'hurt', 'faint', 'attack'];
const B_ANIM = ['idle', 'walk', 'windup', 'attack', 'hurt', 'faint'];
const FPS = { idle: 2.2, walk: 8, attack: 10, dodge: 10, hurt: 1, down: 1, faint: 1, windup: 1 };

const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; };
const rgb = ([r, g, b], k = 1) => `rgb(${Math.round(Math.min(255, r * k))},${Math.round(Math.min(255, g * k))},${Math.round(Math.min(255, b * k))})`;

let groundCanvas = null;
// The colour of one kind of ground at a point (tile units): deeper water away from the shore, wet sand.
function groundColour(m, g, wx, wy) {
  let col = PAL[g];
  if (g === G.SEA || g === G.SHALLOW) {
    const depth = Math.min(1, Math.max(0, (Math.hypot((wx - 64) / 58, (wy - 50) / 44) - 1.0) * 4.5));
    col = [col[0] * (1 - depth * 0.45) + 12 * depth, col[1] * (1 - depth * 0.38) + 10 * depth, col[2] * (1 - depth * 0.18)];
  } else if (g === G.WATER) {
    const k = 1.04 - Math.max(0, 1 - Math.hypot((wx - 98) / 12, (wy - 34) / 8)) * 0.18;
    col = [col[0] * k, col[1] * k, col[2] * k];
  } else if (g === G.SAND) {
    let wet = 0;
    for (const [dx, dy] of [[0.8, 0], [-0.8, 0], [0, 0.8], [0, -0.8]]) { const n = m.ground[Math.floor(wy + dy) * W + Math.floor(wx + dx)]; if (n === G.SEA || n === G.SHALLOW || n === G.WATER) wet++; }
    const k = 1 - wet * 0.05;
    col = [col[0] * k, col[1] * k, col[2] * k];
  } else if (g === G.FOREST) {
    const k = 0.92 + noise(wx * 0.5, wy * 0.5, 2) * 0.12;
    col = [col[0] * k, col[1] * k, col[2] * k];
  }
  return col;
}
// The whole island's ground, 4 colour cells per tile, drawn smoothly scaled up. Natural ground blends
// between neighbouring tiles along wobbly curves (a sharpened blend at a noise-warped point), so shores and
// paths are round rather than stepped; built ground (stone, docks, cliffs) keeps its straight edges.
function softGround() {
  if (groundCanvas) return groundCanvas;
  const m = island();
  const c = mk(W * SUB, H * SUB), x2 = c.getContext('2d');
  const img = x2.createImageData(W * SUB, H * SUB), d = img.data;
  const acc = [0, 0, 0];
  for (let sy = 0; sy < H * SUB; sy++) for (let sx = 0; sx < W * SUB; sx++) {
    const wx = (sx + 0.5) / SUB, wy = (sy + 0.5) / SUB;
    const own = m.ground[Math.floor(wy) * W + Math.floor(wx)];
    let col;
    if (CRISP.has(own)) col = groundColour(m, own, wx, wy);
    else {
      const u = wx + (noise(wx * 0.9, wy * 0.9, 1) - 0.5) * 0.9 - 0.5, v = wy + (noise(wx * 0.9 + 40, wy * 0.9, 1) - 0.5) * 0.9 - 0.5;
      const ix = Math.floor(u), iy = Math.floor(v), fx = u - ix, fy = v - iy;
      acc[0] = acc[1] = acc[2] = 0;
      let sum = 0;
      for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) {
        const tx = ix + a, ty = iy + b;
        if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
        const g = m.ground[ty * W + tx];
        if (CRISP.has(g)) continue;
        let w = (a ? fx : 1 - fx) * (b ? fy : 1 - fy);
        w = w * w * w * w;
        const cc = groundColour(m, g, wx, wy);
        acc[0] += cc[0] * w; acc[1] += cc[1] * w; acc[2] += cc[2] * w; sum += w;
      }
      col = sum > 0 ? [acc[0] / sum, acc[1] / sum, acc[2] / sum] : groundColour(m, own, wx, wy);
    }
    const k = 0.95 + noise(wx * 3, wy * 3, 1) * 0.09;
    const i = (sy * W * SUB + sx) * 4;
    d[i] = Math.min(255, col[0] * k); d[i + 1] = Math.min(255, col[1] * k); d[i + 2] = Math.min(255, col[2] * k); d[i + 3] = 255;
  }
  x2.putImageData(img, 0, 0);
  return (groundCanvas = c);
}

const gAt = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? G.VOID : island().ground[y * W + x]);

// Crisp details on top of the soft ground for one tile, in tile-local world px.
function tileDetails(g2, tx, ty) {
  const g = gAt(tx, ty), h = (n) => hash(tx * 7 + n * 13, ty * 11 + n * 5);
  const X = tx * T, Y = ty * T;
  const blade = (x, y, len, col) => { g2.strokeStyle = col; g2.lineWidth = 1.3; g2.beginPath(); g2.moveTo(x, y); g2.quadraticCurveTo(x + 1.5, y - len * 0.6, x + (h(9) - 0.5) * 4, y - len); g2.stroke(); };
  if (g === G.GRASS || g === G.TALL || g === G.FOREST) {
    const dark = g === G.FOREST ? 'rgba(30,80,40,.5)' : 'rgba(60,130,50,.55)', light = g === G.FOREST ? 'rgba(140,200,110,.35)' : 'rgba(190,235,150,.5)';
    const n = 3 + Math.floor(h(1) * 4);
    for (let i = 0; i < n; i++) blade(X + h(i + 2) * T, Y + h(i + 20) * T, 4 + h(i + 40) * 4, i % 2 ? light : dark);
    if (g === G.GRASS && h(3) < 0.08) { g2.fillStyle = h(4) < 0.5 ? '#fff6d8' : '#ffe066'; for (let i = 0; i < 3; i++) { g2.beginPath(); g2.arc(X + 8 + h(i + 5) * 16, Y + 8 + h(i + 6) * 16, 1.4, 0, 7); g2.fill(); } }
    if (g === G.FOREST && h(5) < 0.35) { g2.fillStyle = h(6) < 0.5 ? 'rgba(190,120,50,.55)' : 'rgba(150,170,60,.5)'; g2.beginPath(); g2.ellipse(X + h(7) * T, Y + h(8) * T, 2.6, 1.4, h(9) * 3, 0, 7); g2.fill(); }
  } else if (g === G.SAND) {
    g2.fillStyle = 'rgba(170,140,90,.35)';
    for (let i = 0; i < 5; i++) { g2.beginPath(); g2.arc(X + h(i + 1) * T, Y + h(i + 9) * T, 0.9, 0, 7); g2.fill(); }
    if (h(2) < 0.06) { g2.strokeStyle = 'rgba(160,130,80,.4)'; g2.lineWidth = 1; g2.beginPath(); g2.arc(X + 16, Y + 18, 7, Math.PI * 1.1, Math.PI * 1.9); g2.stroke(); }
  } else if (g === G.PATH) {
    for (let i = 0; i < 3; i++) if (h(i) < 0.5) { g2.fillStyle = 'rgba(140,110,75,.45)'; g2.beginPath(); g2.ellipse(X + h(i + 3) * T, Y + h(i + 6) * T, 2.2, 1.5, 0, 0, 7); g2.fill(); g2.fillStyle = 'rgba(255,240,210,.35)'; g2.beginPath(); g2.ellipse(X + h(i + 3) * T - 0.6, Y + h(i + 6) * T - 0.6, 1, 0.7, 0, 0, 7); g2.fill(); }
  } else if (g === G.PLAZA) {
    const off = ty % 2 ? 8 : 0;
    for (let j = 0; j < 2; j++) for (let i = -1; i < 2; i++) {
      const sx = X + i * 16 + off + (j ? 8 : 0), sy = Y + j * 16;
      const k = 0.92 + hash(tx * 4 + i, ty * 4 + j) * 0.12;
      g2.fillStyle = rgb([201, 195, 184], k);
      g2.beginPath(); roundRect(g2, Math.max(X, sx + 1), sy + 1, Math.min(X + T, sx + 15) - Math.max(X, sx + 1), 14, 3); g2.fill();
    }
    g2.strokeStyle = 'rgba(120,110,100,.25)'; g2.lineWidth = 1; g2.strokeRect(X + 0.5, Y + 0.5, T - 1, T - 1);
  } else if (g === G.CAVE) {
    g2.fillStyle = 'rgba(20,10,30,.35)';
    for (let i = 0; i < 4; i++) { g2.beginPath(); g2.arc(X + h(i) * T, Y + h(i + 4) * T, 1.2 + h(i + 8), 0, 7); g2.fill(); }
    if (h(3) < 0.05) { g2.fillStyle = 'rgba(100,240,230,.7)'; g2.beginPath(); g2.arc(X + h(5) * T, Y + h(6) * T, 1.6, 0, 7); g2.fill(); }
  } else if (g === G.ROCK) {
    g2.strokeStyle = 'rgba(90,80,80,.35)'; g2.lineWidth = 1;
    if (h(1) < 0.4) { g2.beginPath(); g2.moveTo(X + h(2) * T, Y + h(3) * T); g2.lineTo(X + h(4) * T, Y + h(5) * T); g2.lineTo(X + h(6) * T, Y + h(7) * T); g2.stroke(); }
    g2.fillStyle = 'rgba(255,255,255,.12)'; g2.beginPath(); g2.arc(X + h(8) * T, Y + h(9) * T, 2, 0, 7); g2.fill();
  } else if (g === G.MARSH) {
    if (h(1) < 0.3) { g2.fillStyle = 'rgba(70,110,110,.55)'; g2.beginPath(); g2.ellipse(X + 8 + h(2) * 16, Y + 10 + h(3) * 12, 6 + h(4) * 5, 3 + h(5) * 2, 0, 0, 7); g2.fill(); g2.fillStyle = 'rgba(200,240,240,.35)'; g2.beginPath(); g2.ellipse(X + 6 + h(2) * 16, Y + 9 + h(3) * 12, 2.5, 1, 0, 0, 7); g2.fill(); }
    for (let i = 0; i < 3; i++) blade(X + h(i + 6) * T, Y + h(i + 9) * T, 5, 'rgba(70,100,50,.5)');
  } else if (g === G.DOCK) {
    g2.fillStyle = '#a8794e'; g2.fillRect(X + 2, Y, T - 4, T);
    for (let j = 0; j < 4; j++) { g2.fillStyle = j % 2 ? '#b98a5c' : '#a57549'; g2.fillRect(X + 2, Y + j * 8 + 0.5, T - 4, 7); g2.fillStyle = 'rgba(60,35,20,.5)'; g2.fillRect(X + 2, Y + j * 8 + 7.5, T - 4, 0.8); }
    g2.fillStyle = 'rgba(40,25,15,.4)'; g2.fillRect(X + 2, Y, 1.5, T); g2.fillRect(X + T - 3.5, Y, 1.5, T);
  } else if (g === G.CLIFF || g === G.CAVEWALL) {
    const cave = g === G.CAVEWALL;
    const below = gAt(tx, ty + 1), open = !WALLS.has(below);
    const top = cave ? [52, 42, 68] : [150, 136, 124], face = cave ? [30, 22, 40] : [104, 90, 82];
    // Rock brightness follows the land, not the tile grid, so a cliff reads as one mass.
    g2.fillStyle = rgb(top, 0.94 + noise(tx * 0.7, ty * 0.7, 2) * 0.12); g2.fillRect(X, Y, T, T);
    g2.fillStyle = cave ? 'rgba(120,100,150,.18)' : 'rgba(255,250,240,.16)';
    g2.beginPath(); g2.ellipse(X + h(2) * T, Y + h(3) * T * 0.6, 6, 3, 0, 0, 7); g2.fill();
    if (!WALLS.has(gAt(tx, ty - 1))) { g2.fillStyle = cave ? 'rgba(160,140,190,.25)' : 'rgba(255,255,255,.22)'; g2.fillRect(X, Y, T, 3); }
    if (open) {
      const fh = 18;
      const grd = g2.createLinearGradient(0, Y + T - fh, 0, Y + T);
      grd.addColorStop(0, rgb(face, 1.1)); grd.addColorStop(1, rgb(face, 0.7));
      g2.fillStyle = grd;
      g2.beginPath(); g2.moveTo(X, Y + T - fh + (h(4) - 0.5) * 4); g2.lineTo(X + T, Y + T - fh + (h(5) - 0.5) * 4); g2.lineTo(X + T, Y + T); g2.lineTo(X, Y + T); g2.fill();
      g2.strokeStyle = cave ? 'rgba(10,5,20,.45)' : 'rgba(60,50,45,.4)'; g2.lineWidth = 1;
      for (let i = 0; i < 3; i++) { const sx = X + 5 + i * 10 + h(i + 6) * 4; g2.beginPath(); g2.moveTo(sx, Y + T - fh + 4); g2.lineTo(sx + 1, Y + T - 2); g2.stroke(); }
      // A soft shadow on the ground at the foot of the cliff.
      const sh = g2.createLinearGradient(0, Y + T, 0, Y + T + 10);
      sh.addColorStop(0, 'rgba(0,0,0,.28)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
      g2.fillStyle = sh; g2.fillRect(X, Y + T, T, 10);
    }
    if (!WALLS.has(gAt(tx - 1, ty))) { g2.fillStyle = 'rgba(0,0,0,.12)'; g2.fillRect(X, Y, 2, T); }
    if (!WALLS.has(gAt(tx + 1, ty))) { g2.fillStyle = 'rgba(0,0,0,.18)'; g2.fillRect(X + T - 2, Y, 2, T); }
  }
  // The cave mouth: a dark opening in the cliff.
  if (g === G.CAVE && tx < 128) {
    const grd = g2.createLinearGradient(0, Y, 0, Y + T);
    grd.addColorStop(0, '#07040c'); grd.addColorStop(1, ty === 14 ? '#3a2f4a' : '#0d0818');
    g2.fillStyle = grd; g2.fillRect(X, Y, T, T);
  }
}
function roundRect(g2, x, y, w, h, r) {
  if (w <= 0 || h <= 0) return;
  r = Math.min(r, w / 2, h / 2);
  g2.moveTo(x + r, y); g2.arcTo(x + w, y, x + w, y + h, r); g2.arcTo(x + w, y + h, x, y + h, r); g2.arcTo(x, y + h, x, y, r); g2.arcTo(x, y, x + w, y, r); g2.closePath();
}

export function createView(canvas) {
  const g = canvas.getContext('2d');
  let res = 0, art = null, zoom = 1, dpr = 1, vw = 0, vh = 0;
  const chunks = new Map(); // "cx,cy" -> canvas
  const waterTiles = new Map(); // "cx,cy" -> [[x, y, edges]]
  const lightCanvas = mk(4, 4);
  const effects = []; // { kind, t0, dur, ... }
  const floats = [];
  const particles = [];
  let flash = 0;
  const ambient = [];

  function resize(cssW, cssH, pixelRatio) {
    dpr = Math.min(2, pixelRatio || 1);
    vw = cssW; vh = cssH;
    canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px';
    // About 12 tiles across the shorter side: close enough to read faces, wide enough to see what's coming.
    // Phones get a little closer (about 10.5 tiles across) so explorers and creatures stay easy to see.
    zoom = Math.max(0.75, Math.min(2.2, Math.min(cssW, cssH) / ((cssW < 520 ? 10.5 : 12) * T)));
    if (cssW > 900) zoom = Math.max(zoom, Math.min(2, cssW / (26 * T)));
    const r = Math.round(Math.min(2.5, zoom * dpr) * 4) / 4;
    if (r !== res) { res = r; art = createArt(res); chunks.clear(); }
    lightCanvas.width = Math.ceil(cssW / 2); lightCanvas.height = Math.ceil(cssH / 2);
  }
  const worldW = () => vw / zoom, worldH = () => vh / zoom;

  function chunk(cx, cy) {
    const key = cx + ',' + cy;
    let c = chunks.get(key);
    if (c) { chunks.delete(key); chunks.set(key, c); return c; } // most recently used last
    const px = CH * T * Math.min(res, 2);
    c = mk(px, px);
    const g2 = c.getContext('2d');
    const s = px / (CH * T);
    g2.imageSmoothingEnabled = true;
    g2.drawImage(softGround(), cx * CH * SUB, cy * CH * SUB, CH * SUB, CH * SUB, 0, 0, px, px);
    g2.setTransform(s, 0, 0, s, -cx * CH * T * s, -cy * CH * T * s);
    for (let ty = cy * CH - 1; ty < cy * CH + CH + 1; ty++) for (let tx = cx * CH; tx < cx * CH + CH; tx++) tileDetails(g2, tx, ty);
    chunks.set(key, c);
    while (chunks.size > 48) chunks.delete(chunks.keys().next().value);
    return c;
  }
  function waters(cx, cy) {
    const key = cx + ',' + cy;
    if (waterTiles.has(key)) return waterTiles.get(key);
    const list = [];
    for (let ty = cy * CH; ty < cy * CH + CH; ty++) for (let tx = cx * CH; tx < cx * CH + CH; tx++) {
      if (!WATERY.has(gAt(tx, ty))) continue;
      let edges = 0;
      [[0, -1], [1, 0], [0, 1], [-1, 0]].forEach(([dx, dy], i) => { const n = gAt(tx + dx, ty + dy); if (!WATERY.has(n) && n !== G.VOID && n !== G.BRIDGE) edges |= 1 << i; });
      list.push([tx, ty, edges, hash(tx, ty)]);
    }
    waterTiles.set(key, list);
    return list;
  }

  // Sprite helpers.
  const blit = (s, x, y, alpha = 1, scale = 1) => {
    if (!s) return;
    if (alpha !== 1) g.globalAlpha = alpha;
    g.drawImage(s.img, x - s.ax * scale, y - s.ay * scale, s.w * scale, s.h * scale);
    if (alpha !== 1) g.globalAlpha = 1;
  };
  const shadow = (x, y, rx, ry = rx * 0.42, a = 0.28) => {
    g.fillStyle = `rgba(10,20,30,${a})`;
    g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, 7); g.fill();
  };
  const frame = (count, fps, t, seed = 0) => Math.floor(t * fps + seed) % Math.max(1, count);

  // ---- effects that come from world events ----
  function addEffect(ev, now) {
    const [kind] = ev;
    if (kind === 'hit') {
      const [, x, y, amount, eff, who] = ev;
      floats.push({ x, y, text: String(amount), color: who === 'p' ? '#ff8787' : eff > 0 ? '#ffe066' : eff < 0 ? '#c5c9d6' : '#ffffff', big: eff > 0, t0: now, dur: 0.8 });
      if (eff > 0) floats.push({ x, y: y - 14, text: 'Super effective!', color: '#ffe066', small: true, t0: now, dur: 0.9 });
      burst(x, y + 8, who === 'p' ? '#ff8787' : '#fff3bf', 6, now);
    } else if (kind === 'float') floats.push({ x: ev[1], y: ev[2], text: ev[3], color: ev[4] || '#fff', t0: now, dur: 1.2 });
    else if (kind === 'tele') effects.push({ kind: 'tele', shape: ev[1], x: ev[2], y: ev[3], a: ev[4], b: ev[5], ang: ev[6], t0: now, dur: ev[7] });
    else if (kind === 'swing') effects.push({ kind: 'swing', pid: ev[1], ang: ev[2], t0: now, dur: 0.2 });
    else if (kind === 'abil') effects.push({ kind: 'abil', ab: ev[1], x: ev[2], y: ev[3], ang: ev[4], r: ev[5], t0: now, dur: ev[1] === 'bolt' ? 0.5 : 0.6 });
    else if (kind === 'throw') effects.push({ kind: 'throw', x: ev[1], y: ev[2], target: ev[3], chance: ev[4], t0: now, dur: 0.45 });
    else if (kind === 'catch') { burst(ev[3], ev[4], ev[2] ? '#ffe066' : '#adb5bd', ev[2] ? 22 : 10, now, ev[2] ? 2.2 : 1); floats.push({ x: ev[3], y: ev[4] - 30, text: ev[2] ? 'Befriended!' : 'It broke free!', color: ev[2] ? '#ffe066' : '#ffc9c9', big: !!ev[2], t0: now, dur: 1.4 }); }
    else if (kind === 'spawn') { if (ev[3] === 1) leaves(ev[1], ev[2], now); else burst(ev[1], ev[2], ev[3] === 3 ? '#e5dbff' : '#9775fa', 12, now); }
    else if (kind === 'alert') effects.push({ kind: 'alert', id: ev[1], t0: now, dur: 0.9 });
    else if (kind === 'faint') burst(0, 0, '#fff', 0, now);
  }
  function burst(x, y, color, n, now, speed = 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = (40 + Math.random() * 90) * speed;
      particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30, t0: now, dur: 0.4 + Math.random() * 0.35, color, r: 1.5 + Math.random() * 2 });
    }
  }
  function leaves(x, y, now) {
    for (let i = 0; i < 8; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2;
      particles.push({ x: x + (Math.random() - 0.5) * 20, y, vx: Math.cos(a) * 60, vy: Math.sin(a) * 70, t0: now, dur: 0.7, color: i % 2 ? '#8ce99a' : '#51cf66', r: 2.2, leaf: true });
    }
  }
  const dust = (x, y, now, color = 'rgba(210,190,150,.6)') => particles.push({ x: x + (Math.random() - 0.5) * 8, y, vx: (Math.random() - 0.5) * 20, vy: -12, t0: now, dur: 0.45, color, r: 2.5, dust: true });

  // ---- one picture ----
  // s: { now, cam, me, others, ents, props state, open, zone, ... } built by the client.
  function draw(s) {
    const now = s.now;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = s.cave ? '#0b0812' : '#1f5f99';
    g.fillRect(0, 0, vw, vh);
    const ww = worldW(), wh = worldH();
    const cx0 = s.cam.x - ww / 2, cy0 = s.cam.y - wh / 2;
    g.setTransform(dpr * zoom, 0, 0, dpr * zoom, -cx0 * dpr * zoom, -cy0 * dpr * zoom);
    g.imageSmoothingEnabled = true;

    // Ground.
    const c0 = Math.floor(cx0 / (CH * T)), c1 = Math.floor((cx0 + ww) / (CH * T)), r0 = Math.floor(cy0 / (CH * T)), r1 = Math.floor((cy0 + wh) / (CH * T));
    for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
      if (cx < 0 || cy < 0 || cx * CH >= W || cy * CH >= H) continue;
      g.drawImage(chunk(cx, cy), cx * CH * T, cy * CH * T, CH * T, CH * T);
    }
    // Moving water: glints and foam along the shore.
    g.lineCap = 'round';
    for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
      if (cx < 0 || cy < 0 || cx * CH >= W || cy * CH >= H) continue;
      for (const [tx, ty, edges, h] of waters(cx, cy)) {
        const X = tx * T, Y = ty * T;
        if (h < 0.45) {
          const a = 0.12 + 0.14 * Math.sin(now * 1.8 + h * 40);
          if (a > 0.05) {
            g.strokeStyle = `rgba(230,250,255,${a.toFixed(3)})`; g.lineWidth = 1.4;
            const ox = X + 6 + h * 18 + Math.sin(now * 0.8 + h * 9) * 3, oy = Y + 8 + ((h * 97) % 1) * 16;
            g.beginPath(); g.moveTo(ox, oy); g.quadraticCurveTo(ox + 4, oy - 2, ox + 9, oy); g.stroke();
          }
        }
        if (edges) {
          const al = 0.35 + 0.3 * Math.sin(now * 2.2 + h * 30);
          g.strokeStyle = `rgba(255,255,255,${al.toFixed(3)})`; g.lineWidth = 2;
          g.beginPath();
          for (let i = 0; i < 4; i++) {
            if (!(edges & (1 << i))) continue;
            // along: where on the edge; in: how far into the water (pulses in and out like a wave)
            const along = 6 + ((h * (37 + i * 11)) % 1) * 14, inset = 4 + Math.sin(now * 1.6 + h * 12 + i) * 2.2, len = 9 + ((h * 53) % 1) * 7;
            const [ax, ay, ux, uy, nx, ny] = [[X, Y, 1, 0, 0, 1], [X + T, Y, 0, 1, -1, 0], [X, Y + T, 1, 0, 0, -1], [X, Y, 0, 1, 1, 0]][i];
            const sx = ax + ux * along + nx * inset, sy = ay + uy * along + ny * inset;
            g.moveTo(sx, sy); g.quadraticCurveTo(sx + ux * len / 2 + nx * 2.5, sy + uy * len / 2 + ny * 2.5, sx + ux * len, sy + uy * len);
          }
          g.stroke();
        }
      }
    }

    // Scenery and characters, by depth.
    const items = [];
    const m = island();
    const pc0 = Math.floor((cx0 - 96) / (CH * T)), pc1 = Math.floor((cx0 + ww + 96) / (CH * T)), pr0 = Math.floor((cy0 - 40) / (CH * T)), pr1 = Math.floor((cy0 + wh + 140) / (CH * T));
    const flats = [];
    for (let cy = pr0; cy <= pr1; cy++) for (let cx = pc0; cx <= pc1; cx++) for (const p of m.chunks.get(cx + ',' + cy) || []) {
      let v = p.v;
      if (p.gate && s.open[p.gate]) continue;
      if (p.node) {
        const busy = (s.nodes[p.node] || 0) > now;
        if (busy && p.k !== 'berrybush' && p.k !== 'crystal') continue;
        if (busy) v = 1;
      }
      if (p.chest && s.chests.includes(p.chest)) v = 1;
      if (p.k === 'shrine' && s.champion) v = 1;
      if (FLAT.has(p.k)) flats.push(p, v); else items.push({ y: p.y, k: 0, p, v });
    }
    // The river bridge: mended planks, or a broken stub at each end.
    const [bx, by, bw, bh] = GATES.bridge.rect;
    for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) if (s.open.bridge || j === 0 || j === bh - 1) blit(art.prop('bridge', 0, 0), (bx + i + 0.5) * T, (by + j + 1) * T);
    for (let i = 0; i < flats.length; i += 2) blit(art.prop(flats[i].k, flats[i + 1], 0), flats[i].x, flats[i].y);
    // Glowing tracks for the Lunahop quest.
    if (s.tracks) for (const [i, [x, y]] of s.tracks.entries()) blit(art.prop('footprint', 0, 0), x, y, 0.55 + 0.35 * Math.sin(now * 3 - i * 0.6));
    // Tall grass, drawn over the feet of whatever stands in it.
    const t0 = Math.floor(cx0 / T), t1 = Math.ceil((cx0 + ww) / T), u0 = Math.floor(cy0 / T), u1 = Math.ceil((cy0 + wh) / T) + 1;
    const tallFrames = art.frames.prop?.tallgrass || 3;
    for (let ty = u0; ty <= u1; ty++) for (let tx = t0; tx <= t1; tx++) if (gAt(tx, ty) === G.TALL) items.push({ y: (ty + 1) * T - 2, k: 1, tx, ty, f: frame(tallFrames, 1.6, now, hash(tx, ty) * 3) });

    // Telegraphs under everything that stands.
    for (const e of effects) if (e.kind === 'tele') drawTele(e, now);
    for (const z of s.zones) drawZone(z, now);

    // People of the island.
    for (const [id, n] of Object.entries(s.npcs)) items.push({ y: n.y, k: 2, id, n });
    for (const e of s.ents) items.push({ y: e.y, k: 3, e });
    if (s.me) items.push({ y: s.me.y, k: 4, e: s.me });
    items.sort((a, b) => a.y - b.y || a.k - b.k);
    for (const it of items) {
      if (it.k === 0) {
        const p = it.p;
        const pf = art.frames.prop?.[p.k] || 1;
        let a = 1;
        // See your explorer through a tree canopy.
        if (s.me && (p.k === 'oak' || p.k === 'pine' || p.k === 'palm') && s.me.y < p.y - 4 && s.me.y > p.y - 90 && Math.abs(s.me.x - p.x) < 34) a = 0.5;
        blit(art.prop(p.k, it.v, frame(pf, p.k === 'campfire' ? 8 : 2.5, now, hash(p.x, p.y) * 4)), p.x, p.y, a);
      } else if (it.k === 1) blit(art.prop('tallgrass', 0, it.f), it.tx * T + T / 2, (it.ty + 1) * T);
      else if (it.k === 2) {
        shadow(it.n.x, it.n.y, 11);
        blit(art.npc(it.id, it.n.dir, frame(2, 1.6, now, hash(it.n.x, 3) * 2)), it.n.x, it.n.y);
        if (it.n.mark) drawMark(it.n.x, it.n.y - 52, it.n.mark, now);
      } else drawEnt(it.e, now, s);
    }
    // Projectiles.
    for (const x of s.shots) drawShot(x, now);
    for (const e of effects) if (e.kind !== 'tele') drawEffect(e, now, s);
    drawParticles(now);
    drawAmbient(s, now, cx0, cy0, ww, wh);

    // Light and weather, in screen space.
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (s.cave) drawDark(s, now, cx0, cy0);
    if (s.storm) drawStorm(now);
    if (flash > 0) { g.fillStyle = `rgba(230,240,255,${flash.toFixed(3)})`; g.fillRect(0, 0, vw, vh); flash = Math.max(0, flash - 0.06); }
    g.setTransform(dpr * zoom, 0, 0, dpr * zoom, -cx0 * dpr * zoom, -cy0 * dpr * zoom);
    // Words float above everything.
    for (const e of s.ents) drawLabel(e, s);
    if (s.me) drawLabel(s.me, s);
    drawFloats(now);
    // Arrows at the screen edge to friends and to the current goal.
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const a of s.arrows) drawArrow(a, cx0, cy0, now);
    // Keep the effect lists short.
    for (const list of [effects, floats, particles]) for (let i = list.length - 1; i >= 0; i--) if (now - list[i].t0 > list[i].dur) list.splice(i, 1);
  }

  function drawEnt(e, now, s) {
    const lift = e.lift || 0;
    if (e.kind === 'p') {
      const anim = P_ANIM[e.anim] || 'idle';
      const fr = art.frames.player[anim] || 1;
      shadow(e.x, e.y, 12, 5, 0.3);
      const blink = e.flags & 1 && Math.floor(now * 14) % 2;
      blit(art.player({ skin: e.look?.skin || 0, hair: e.look?.hair || 0, outfit: e.seat }, DIRS[e.dir] || 'down', anim, anim === 'walk' ? frame(fr, 8, e.walkT || now) : anim === 'attack' ? Math.min(fr - 1, Math.floor((0.2 - (e.sT || 0)) / 0.2 * fr)) : frame(fr, FPS[anim], now, e.seed || 0)), e.x, e.y - lift, blink ? 0.45 : 1);
      if (e.flags & 4) { g.strokeStyle = 'rgba(165,216,255,.8)'; g.lineWidth = 2; g.fillStyle = 'rgba(165,216,255,.18)'; g.beginPath(); g.arc(e.x, e.y - 18, 24, 0, 7); g.fill(); g.stroke(); }
      if (e.anim === 5) { // knocked out: a pulsing ring friends can see from afar
        g.strokeStyle = `rgba(255,135,135,${(0.5 + 0.4 * Math.sin(now * 5)).toFixed(2)})`; g.lineWidth = 2.5;
        g.beginPath(); g.ellipse(e.x, e.y, 26, 11, 0, 0, 7); g.stroke();
      }
      if (e.flags & 2) { g.strokeStyle = '#8ce99a'; g.lineWidth = 3; g.beginPath(); g.arc(e.x, e.y - 50, 9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ((now * 0.66) % 1)); g.stroke(); }
      return;
    }
    if (e.kind === 'b') {
      const anim = B_ANIM[e.anim] || 'idle';
      const fr = art.frames.boss[anim] || 1;
      const def = { mirebrute: 52, quartzhulk: 50, tempestra: 70 }[e.boss] || 50;
      shadow(e.x, e.y, def, def * 0.38, 0.32);
      const fl = anim === 'windup' && Math.floor(now * 10) % 2 ? 0.75 : 1;
      blit(art.boss(e.boss, anim, frame(fr, FPS[anim] || 2, now), !!e.flip), e.x, e.y - (e.boss === 'tempestra' ? 18 + Math.sin(now * 2) * 6 : 0), anim === 'faint' ? Math.max(0, 1 - (now - (e.faintAt || now)) / 1.5) : fl);
      return;
    }
    // creatures, companions, murklings
    const anim = C_ANIM[e.anim] || 'idle';
    const murk = e.sp === 'murk' || e.sp === 'murkbrute';
    const fr = (murk ? art.frames.murkling : art.frames.creature)[anim] || 1;
    const fly = e.sp === 'gullwisp' || e.sp === 'fizzwing';
    const hop = fly ? 10 + Math.sin(now * 4 + e.id) * 3 : 0;
    const scale = e.sp === 'murkbrute' ? 1.7 : 1;
    const r = (SPECIES[e.sp]?.r || 11) * scale;
    shadow(e.x, e.y, r * 1.05, r * 0.42, fly ? 0.18 : 0.26);
    if (e.flags & 4 && e.seat >= 0) { g.strokeStyle = SEATS[e.seat].color; g.globalAlpha = 0.7; g.lineWidth = 2; g.beginPath(); g.ellipse(e.x, e.y, r + 3, (r + 3) * 0.42, 0, 0, 7); g.stroke(); g.globalAlpha = 1; }
    if (e.flags & 1) { // weakened: a gold, breathing ring says "befriend me"
      const a = 0.45 + 0.35 * Math.sin(now * 5);
      g.strokeStyle = `rgba(255,212,59,${a.toFixed(2)})`; g.lineWidth = 2.5;
      g.beginPath(); g.ellipse(e.x, e.y, r + 7, (r + 7) * 0.45, 0, 0, 7); g.stroke();
    }
    const fi = anim === 'walk' ? frame(fr, 9, now, e.id) : frame(fr, FPS[anim] || 2, now, e.id * 0.37);
    const sprite = murk ? art.murkling(anim, fi) : art.creature(e.sp, DIRS[e.dir] || 'down', anim, fi);
    if (e.flags & 2) { // bound by a charm: wiggles three times
      const k = Math.sin(now * 18) * 0.12;
      g.save(); g.translate(e.x, e.y); g.rotate(k); blit(sprite, 0, -hop, 1, scale); g.restore();
      g.fillStyle = 'rgba(255,230,120,.55)'; g.beginPath(); g.arc(e.x, e.y - r, r + 6 + Math.sin(now * 10) * 2, 0, 7); g.fill();
    } else blit(sprite, e.x, e.y - hop, e.anim === 5 && Math.floor(now * 12) % 2 ? 0.8 : 1, scale);
    if (e.flags & 16) { g.fillStyle = 'rgba(255,255,255,.85)'; g.font = '700 12px Nunito, sans-serif'; g.textAlign = 'center'; g.fillText('…', e.x, e.y - 30); }
  }
  function drawLabel(e, s) {
    if (e.kind === 'p' && !e.mine) {
      const seat = SEATS[e.seat] || SEATS[0];
      g.font = '800 11px Nunito, sans-serif';
      const label = e.name || '';
      const w = g.measureText(label).width + 22, x = e.x - w / 2, y = e.y - 62;
      g.fillStyle = 'rgba(13,20,44,.82)'; g.beginPath(); roundRect(g, x, y, w, 16, 8); g.fill();
      drawShape(seat.shape, x + 9, y + 8, 4.2, seat.color);
      g.fillStyle = '#fff'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(label, x + 16, y + 8.5);
      bar(e.x - 16, y + 18, 32, 4, e.hp / 100, e.hp > 35 ? '#69db7c' : '#ff8787');
    } else if (e.kind === 'c' && !(e.flags & 4) && e.sp !== 'murk' && e.sp !== 'murkbrute' && (e.hp < 100 || e.flags & 8)) {
      const r = SPECIES[e.sp]?.r || 11, y = e.y - r * 2.6 - 10;
      bar(e.x - 15, y, 30, 4, e.hp / 100, e.flags & 1 ? '#ffd43b' : '#ff8787');
      g.font = '800 9px Nunito, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
      g.fillStyle = 'rgba(255,255,255,.9)'; g.fillText(`Lv ${e.lv}`, e.x, y - 3);
      if (e.flags & 1 && !(e.flags & 2)) {
        const ch = Math.round(Math.max(0.1, Math.min(0.95, (SPECIES[e.sp]?.catch || 0) + (CATCH_HP - e.hp / 100) * 1.2)) * 100);
        g.font = '800 10px Nunito, sans-serif';
        const t = `Befriend ${ch}%`, w = g.measureText(t).width + 12;
        g.fillStyle = 'rgba(255,212,59,.95)'; g.beginPath(); roundRect(g, e.x - w / 2, y - 26, w, 15, 7.5); g.fill();
        g.fillStyle = '#3b2a00'; g.fillText(t, e.x, y - 15);
      }
    } else if ((e.sp === 'murk' || e.sp === 'murkbrute') && e.hp < 100) {
      bar(e.x - 15, e.y - (e.sp === 'murkbrute' ? 64 : 38), 30, 4, e.hp / 100, '#b197fc');
    } else if (e.kind === 'c' && e.flags & 4 && e.hp < 100) {
      const r = SPECIES[e.sp]?.r || 11;
      bar(e.x - 12, e.y - r * 2.6 - 6, 24, 3, e.hp / 100, '#69db7c');
    }
  }
  function bar(x, y, w, h, f, col) {
    g.fillStyle = 'rgba(13,20,44,.8)'; g.beginPath(); roundRect(g, x - 1, y - 1, w + 2, h + 2, (h + 2) / 2); g.fill();
    if (f > 0) { g.fillStyle = col; g.beginPath(); roundRect(g, x, y, Math.max(h, w * Math.min(1, f)), h, h / 2); g.fill(); }
  }
  function drawShape(shape, x, y, r, color) {
    g.fillStyle = color; g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1;
    g.beginPath();
    if (shape === 'circle') g.arc(x, y, r, 0, 7);
    else if (shape === 'triangle') { g.moveTo(x, y - r * 1.1); g.lineTo(x + r, y + r * 0.8); g.lineTo(x - r, y + r * 0.8); g.closePath(); }
    else if (shape === 'square') g.rect(x - r * 0.85, y - r * 0.85, r * 1.7, r * 1.7);
    else { g.moveTo(x, y - r * 1.2); g.lineTo(x + r, y); g.lineTo(x, y + r * 1.2); g.lineTo(x - r, y); g.closePath(); }
    g.fill(); g.stroke();
  }
  function drawMark(x, y, mark, now) {
    const bob = Math.sin(now * 3) * 2.5;
    g.fillStyle = mark === '!' ? '#ffd43b' : '#a5d8ff';
    g.strokeStyle = 'rgba(13,20,44,.9)'; g.lineWidth = 3;
    g.font = '900 20px Fredoka, Nunito, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.strokeText(mark, x, y + bob); g.fillText(mark, x, y + bob);
  }
  function drawTele(e, now) {
    const p = Math.min(1, (now - e.t0) / Math.max(0.05, e.dur));
    const fill = `rgba(255,80,60,${(0.12 + p * 0.22).toFixed(3)})`, edge = `rgba(255,120,90,${(0.55 + 0.4 * p).toFixed(3)})`;
    g.save();
    g.translate(e.x, e.y);
    g.lineWidth = 2;
    g.beginPath();
    if (e.shape === 'c') {
      g.ellipse(0, 0, e.a, e.a * 0.72, 0, 0, 7); g.fillStyle = fill; g.fill(); g.strokeStyle = edge; g.stroke();
      g.beginPath(); g.ellipse(0, 0, e.a * p, e.a * 0.72 * p, 0, 0, 7); g.fillStyle = 'rgba(255,90,70,.22)'; g.fill();
    } else if (e.shape === 'k') {
      g.rotate(e.ang); g.moveTo(0, 0); g.arc(0, 0, e.a, -e.b, e.b); g.closePath(); g.fillStyle = fill; g.fill(); g.strokeStyle = edge; g.stroke();
      g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, e.a * p, -e.b, e.b); g.closePath(); g.fillStyle = 'rgba(255,90,70,.2)'; g.fill();
    } else {
      g.rotate(e.ang); g.rect(0, -e.b / 2, e.a, e.b); g.fillStyle = fill; g.fill(); g.strokeStyle = edge; g.stroke();
      g.fillStyle = 'rgba(255,90,70,.22)'; g.fillRect(0, -e.b / 2, e.a * p, e.b);
    }
    g.restore();
  }
  function drawZone(z, now) {
    g.save();
    g.strokeStyle = 'rgba(255,230,90,.75)'; g.lineWidth = 2; g.fillStyle = 'rgba(255,230,90,.12)';
    g.beginPath(); g.ellipse(z.x, z.y, z.r, z.r * 0.7, 0, 0, 7); g.fill(); g.stroke();
    g.strokeStyle = 'rgba(255,250,200,.9)'; g.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) {
      const a = now * 3 + i * 1.6, r1 = z.r * 0.3, r2 = z.r * 0.85;
      g.beginPath(); g.moveTo(z.x + Math.cos(a) * r1, z.y + Math.sin(a) * r1 * 0.7); g.lineTo(z.x + Math.cos(a + 0.3) * (r1 + r2) / 2 + 4, z.y + Math.sin(a + 0.3) * (r1 + r2) / 2 * 0.7); g.lineTo(z.x + Math.cos(a) * r2, z.y + Math.sin(a) * r2 * 0.7); g.stroke();
    }
    g.restore();
  }
  function drawShot(x, now) {
    const ang = Math.atan2(x.vy, x.vx);
    g.save(); g.translate(x.x, x.y); g.rotate(ang);
    const glow = (r, c) => { const gr = g.createRadialGradient(0, 0, 0, 0, 0, r); gr.addColorStop(0, c); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill(); };
    if (x.kind === 'water' || x.kind === 'wave') {
      const big = x.kind === 'wave';
      glow(big ? 34 : 14, 'rgba(120,200,255,.45)');
      g.fillStyle = '#a5d8ff'; g.strokeStyle = '#1c7ed6'; g.lineWidth = 1.5;
      g.beginPath(); g.ellipse(0, 0, big ? 22 : 8, big ? 26 : 5, 0, 0, 7); g.fill(); g.stroke();
      g.fillStyle = 'rgba(255,255,255,.8)'; g.beginPath(); g.ellipse(-2, -2, big ? 6 : 2.5, big ? 8 : 1.5, 0, 0, 7); g.fill();
    } else if (x.kind === 'ember') {
      glow(16, 'rgba(255,150,60,.6)');
      g.fillStyle = '#ffd43b'; g.beginPath(); g.arc(0, 0, 5, 0, 7); g.fill();
      g.fillStyle = '#ff6b00'; g.beginPath(); g.moveTo(-12, 0); g.quadraticCurveTo(-4, -5, 4, 0); g.quadraticCurveTo(-4, 5, -12, 0); g.fill();
    } else if (x.kind === 'thorn') {
      g.fillStyle = '#2f9e44'; g.strokeStyle = '#1b2440'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(9, 0); g.lineTo(-6, -3.5); g.lineTo(-3, 0); g.lineTo(-6, 3.5); g.closePath(); g.fill(); g.stroke();
    } else if (x.kind === 'mud') {
      g.fillStyle = '#6b4f2a'; g.strokeStyle = '#3d2b14'; g.lineWidth = 1.5;
      g.beginPath(); g.arc(0, 0, 9, 0, 7); g.fill(); g.stroke();
      g.fillStyle = 'rgba(255,255,255,.25)'; g.beginPath(); g.arc(-3, -3, 3, 0, 7); g.fill();
    } else if (x.kind === 'shard') {
      glow(14, 'rgba(120,255,230,.5)');
      g.fillStyle = '#96f2d7'; g.strokeStyle = '#0ca678'; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(10, 0); g.lineTo(0, -4); g.lineTo(-7, 0); g.lineTo(0, 4); g.closePath(); g.fill(); g.stroke();
    }
    g.restore();
  }
  function drawEffect(e, now, s) {
    const p = (now - e.t0) / e.dur;
    if (p < 0 || p > 1) return;
    if (e.kind === 'swing') {
      const who = e.pid === s.myId ? s.me : s.ents.find((x) => x.kind === 'p' && x.id === e.pid);
      if (!who) return;
      g.save(); g.translate(who.x, who.y - 18);
      g.strokeStyle = `rgba(255,255,255,${(0.85 * (1 - p)).toFixed(2)})`; g.lineWidth = 5 * (1 - p) + 1.5;
      g.beginPath(); g.arc(0, 0, 40, e.ang - 1 + p * 0.4, e.ang + 1 + p * 0.4); g.stroke();
      g.strokeStyle = `rgba(255,236,150,${(0.6 * (1 - p)).toFixed(2)})`; g.lineWidth = 2;
      g.beginPath(); g.arc(0, 0, 32, e.ang - 0.8 + p * 0.4, e.ang + 0.8 + p * 0.4); g.stroke();
      g.restore();
    } else if (e.kind === 'throw') {
      const t = s.ents.find((x) => x.id === e.target);
      if (!t) return;
      const x = e.x + (t.x - e.x) * p, y = e.y + (t.y - 16 - e.y) * p - Math.sin(p * Math.PI) * 50;
      blit(art.item('charm'), x, y + 8, 1, 1.2);
      if (Math.random() < 0.6) particles.push({ x, y, vx: 0, vy: 10, t0: now, dur: 0.4, color: '#ffe066', r: 1.8 });
    } else if (e.kind === 'alert') {
      const t = s.ents.find((x) => x.id === e.id);
      if (t) drawMark(t.x, t.y - 38 - p * 6, '!', now);
    } else if (e.kind === 'abil') drawAbility(e, p, now);
  }
  function ring(x, y, r, col, w = 3) { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.ellipse(x, y, r, r * 0.72, 0, 0, 7); g.stroke(); }
  function drawAbility(e, p, now) {
    const { x, y, ang, r } = e, fade = 1 - p;
    switch (e.ab) {
      case 'leafstorm': for (let i = 0; i < 12; i++) { const a = i * 0.52 + p * 6; const rr = 30 + p * 50; leafAt(x + Math.cos(a) * rr, y - 10 + Math.sin(a) * rr * 0.7, a, fade); } break;
      case 'flameburst': for (let i = 0; i < 14; i++) { const a = ang + (i / 13 - 0.5) * 1.6, d = 20 + p * 85 * (0.6 + (i % 3) * 0.2); fireAt(x + Math.cos(a) * d, y - 10 + Math.sin(a) * d, 8 * fade + 2); } break;
      case 'bubblering': for (let i = 0; i < 10; i++) { const a = i * 0.63; const rr = 20 + p * 55; g.strokeStyle = `rgba(165,216,255,${fade.toFixed(2)})`; g.lineWidth = 1.5; g.beginPath(); g.arc(x + Math.cos(a) * rr, y - 10 + Math.sin(a) * rr * 0.7, 5, 0, 7); g.stroke(); } break;
      case 'healspores': for (let i = 0; i < 12; i++) { const a = i * 0.9; g.fillStyle = `rgba(140,233,154,${fade.toFixed(2)})`; g.beginPath(); g.arc(x + Math.cos(a) * (14 + i * 3), y - 10 - p * 50 - i * 2, 2.5, 0, 7); g.fill(); } break;
      case 'clawcrush': case 'slam': ring(x, y, (e.ab === 'slam' ? r : 40) * (0.3 + p * 0.8), `rgba(255,255,255,${(0.8 * fade).toFixed(2)})`, 4 * fade + 1); if (e.ab === 'slam' && p < 0.1) flash = Math.max(flash, 0.12); break;
      case 'quake': for (let k = 0; k < 2; k++) ring(x, y, r * (0.4 + p * 0.7 - k * 0.2), `rgba(196,164,132,${(0.9 * fade).toFixed(2)})`, 5 * fade + 1); break;
      case 'thunderdive': case 'zap': case 'bolt': {
        const top = e.ab === 'bolt' ? y - 320 : y - 80;
        g.strokeStyle = `rgba(255,244,170,${fade.toFixed(2)})`; g.lineWidth = e.ab === 'bolt' ? 5 : 3; g.beginPath(); g.moveTo(x, top);
        for (let i = 1; i <= 6; i++) g.lineTo(x + (hash(i, Math.floor(now * 20)) - 0.5) * 22, top + ((y - top) * i) / 6);
        g.stroke();
        if (e.ab === 'bolt' && p < 0.15) flash = Math.max(flash, 0.18);
        ring(x, y, 20 + p * 30, `rgba(255,244,170,${(0.7 * fade).toFixed(2)})`, 2);
        break;
      }
      case 'moonbeam': g.save(); g.translate(x, y - 14); g.rotate(ang); g.fillStyle = `rgba(208,191,255,${(0.75 * fade).toFixed(2)})`; g.fillRect(0, -10 * fade - 3, 360, 20 * fade + 6); g.fillStyle = `rgba(255,255,255,${fade.toFixed(2)})`; g.fillRect(0, -3, 360, 6); g.restore(); break;
      case 'spore': case 'murkburst': { const col = e.ab === 'spore' ? '190,240,170' : '151,117,250'; for (let i = 0; i < 14; i++) { const a = i * 0.45; const rr = r * (0.2 + p * 0.9); g.fillStyle = `rgba(${col},${(0.7 * fade).toFixed(2)})`; g.beginPath(); g.arc(x + Math.cos(a) * rr, y - 6 + Math.sin(a) * rr * 0.7, 4 + i % 3, 0, 7); g.fill(); } break; }
      case 'tongue': g.save(); g.translate(x, y - 20); g.rotate(ang); g.strokeStyle = `rgba(255,135,180,${fade.toFixed(2)})`; g.lineWidth = 10 * fade + 3; g.beginPath(); g.moveTo(0, 0); g.lineTo(r * Math.sin(p * Math.PI), 0); g.stroke(); g.restore(); break;
      case 'pillar': for (let i = 0; i < 5; i++) { const a = i * 1.26; g.fillStyle = `rgba(150,242,215,${fade.toFixed(2)})`; g.beginPath(); g.moveTo(x + Math.cos(a) * 18, y + Math.sin(a) * 10); g.lineTo(x + Math.cos(a) * 26, y - 40 * (1 - p * 0.5)); g.lineTo(x + Math.cos(a) * 34, y + Math.sin(a) * 10); g.fill(); } break;
      case 'gust': for (let i = 0; i < 8; i++) { const a = ang + (i / 7 - 0.5) * 1.6, d = 30 + p * 260; g.strokeStyle = `rgba(220,230,255,${(0.6 * fade).toFixed(2)})`; g.lineWidth = 2; g.beginPath(); g.moveTo(x + Math.cos(a) * d, y + Math.sin(a) * d); g.lineTo(x + Math.cos(a) * (d + 30), y + Math.sin(a) * (d + 30)); g.stroke(); } break;
    }
  }
  function leafAt(x, y, a, alpha) { g.save(); g.translate(x, y); g.rotate(a); g.globalAlpha = alpha; g.fillStyle = '#69db7c'; g.strokeStyle = '#2b8a3e'; g.lineWidth = 1; g.beginPath(); g.ellipse(0, 0, 6, 3, 0, 0, 7); g.fill(); g.stroke(); g.globalAlpha = 1; g.restore(); }
  function fireAt(x, y, r) { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,240,150,.95)'); gr.addColorStop(0.5, 'rgba(255,140,40,.7)'); gr.addColorStop(1, 'rgba(255,60,0,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
  function drawParticles(now) {
    for (const q of particles) {
      const p = (now - q.t0) / q.dur;
      if (p < 0 || p > 1) continue;
      const t = now - q.t0;
      const x = q.x + q.vx * t, y = q.y + q.vy * t + (q.dust || q.leaf ? 0 : 140 * t * t);
      g.globalAlpha = 1 - p;
      g.fillStyle = q.color;
      g.beginPath();
      if (q.leaf) g.ellipse(x, y, q.r * 1.4, q.r * 0.7, t * 6, 0, 7); else g.arc(x, y, q.r * (q.dust ? 1 + p : 1 - p * 0.5), 0, 7);
      g.fill();
    }
    g.globalAlpha = 1;
  }
  function drawFloats(now) {
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    for (const f of floats) {
      const p = (now - f.t0) / f.dur;
      if (p < 0 || p > 1) continue;
      const y = f.y - 24 * p - (f.big ? 6 : 0);
      g.globalAlpha = p > 0.7 ? (1 - p) / 0.3 : 1;
      g.font = `900 ${f.small ? 10 : f.big ? 17 : 14}px Fredoka, Nunito, sans-serif`;
      g.lineWidth = 3.5; g.strokeStyle = 'rgba(13,20,44,.9)'; g.strokeText(f.text, f.x, y);
      g.fillStyle = f.color; g.fillText(f.text, f.x, y);
    }
    g.globalAlpha = 1;
  }
  function drawAmbient(s, now, cx0, cy0, ww, wh) {
    // A few butterflies, fireflies and falling leaves near the camera: life only you see.
    const want = s.cave ? 10 : s.storm ? 0 : 9;
    while (ambient.length < want) ambient.push({ x: cx0 + Math.random() * ww, y: cy0 + Math.random() * wh, seed: Math.random() * 100, born: now });
    if (ambient.length > want) ambient.length = want;
    for (const a of ambient) {
      if (a.x < cx0 - 60 || a.x > cx0 + ww + 60 || a.y < cy0 - 60 || a.y > cy0 + wh + 60) { a.x = cx0 + Math.random() * ww; a.y = cy0 + Math.random() * wh; }
      const zone = s.zoneAt(a.x, a.y);
      const t = now + a.seed;
      if (s.cave || zone === 'woods' && Math.sin(a.seed) > 0.3) {
        a.x += Math.sin(t * 0.7) * 0.3; a.y += Math.cos(t * 0.5) * 0.25;
        const al = 0.4 + 0.4 * Math.sin(t * 2.5);
        const gr = g.createRadialGradient(a.x, a.y, 0, a.x, a.y, 7);
        gr.addColorStop(0, s.cave ? `rgba(150,255,240,${al.toFixed(2)})` : `rgba(255,250,170,${al.toFixed(2)})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(a.x, a.y, 7, 0, 7); g.fill();
      } else if (zone === 'meadow' || zone === 'village' || zone === 'woods' || zone === 'lake') {
        a.x += Math.cos(t * 0.6) * 0.6; a.y += Math.sin(t * 1.3) * 0.4;
        const flap = Math.abs(Math.sin(t * 12));
        const col = ['#ffd43b', '#ff8787', '#a5d8ff', '#ffffff'][Math.floor(a.seed) % 4];
        g.fillStyle = col;
        g.beginPath(); g.ellipse(a.x - 2.5 * flap, a.y, 2.6 * flap + 0.4, 2, 0, 0, 7); g.ellipse(a.x + 2.5 * flap, a.y, 2.6 * flap + 0.4, 2, 0, 0, 7); g.fill();
      } else if (zone === 'shore' && Math.sin(a.seed * 3) > 0) {
        // a gull's shadow drifting over the sand
        a.x += 0.8; a.y += Math.sin(t * 0.3) * 0.2;
        g.fillStyle = 'rgba(20,40,60,.12)';
        g.beginPath(); g.moveTo(a.x - 9, a.y); g.quadraticCurveTo(a.x - 4, a.y - 3, a.x, a.y); g.quadraticCurveTo(a.x + 4, a.y - 3, a.x + 9, a.y); g.lineTo(a.x, a.y + 2); g.fill();
      }
    }
  }
  function drawDark(s, now, cx0, cy0) {
    const L = lightCanvas, lg = L.getContext('2d');
    const k = zoom / 2;
    lg.globalCompositeOperation = 'source-over';
    lg.fillStyle = 'rgba(6,2,14,.82)';
    lg.fillRect(0, 0, L.width, L.height);
    lg.globalCompositeOperation = 'destination-out';
    const hole = (x, y, r, a = 1) => {
      const sx = (x - cx0) * k, sy = (y - cy0) * k, rr = r * k;
      if (sx < -rr || sy < -rr || sx > L.width + rr || sy > L.height + rr) return;
      const gr = lg.createRadialGradient(sx, sy, 0, sx, sy, rr);
      gr.addColorStop(0, `rgba(0,0,0,${a})`); gr.addColorStop(0.6, `rgba(0,0,0,${a * 0.6})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
      lg.fillStyle = gr; lg.beginPath(); lg.arc(sx, sy, rr, 0, 7); lg.fill();
    };
    if (s.me) hole(s.me.x, s.me.y - 16, 200);
    for (const e of s.ents) if (e.kind === 'p') hole(e.x, e.y - 16, 150, 0.9); else if (e.flags & 4) hole(e.x, e.y, 70, 0.6); else if (e.sp === 'fizzwing') hole(e.x, e.y - 10, 60, 0.7);
    const m = island();
    for (const p of s.lights) hole(p.x, p.y - 14, p.k === 'cavecrystal' ? 95 + Math.sin(now * 2 + p.x) * 8 : 60, 0.75);
    for (const x of s.shots) hole(x.x, x.y, 40, 0.6);
    void m;
    g.drawImage(L, 0, 0, vw, vh);
  }
  const rain = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), v: 0.6 + Math.random() * 0.5 }));
  let nextBolt = 0;
  function drawStorm(now) {
    g.fillStyle = 'rgba(30,40,80,.28)'; g.fillRect(0, 0, vw, vh);
    g.strokeStyle = 'rgba(200,215,255,.35)'; g.lineWidth = 1;
    g.beginPath();
    for (const r of rain) {
      const y = ((r.y + now * r.v) % 1) * vh, x = ((r.x + now * 0.08) % 1) * vw;
      g.moveTo(x, y); g.lineTo(x - 4, y + 14);
    }
    g.stroke();
    if (now > nextBolt) { nextBolt = now + 4 + Math.random() * 6; flash = 0.22; }
  }
  function drawArrow(a, cx0, cy0, now) {
    // a: { x, y (world), color, shape, label }
    const sx = (a.x - cx0) * zoom, sy = (a.y - cy0) * zoom;
    const m = 30;
    if (sx > m && sy > m && sx < vw - m && sy < vh - m) return;
    const cx = vw / 2, cy = vh / 2, dx = sx - cx, dy = sy - cy;
    const k = Math.min((vw / 2 - m) / Math.abs(dx || 1e-6), (vh / 2 - m) / Math.abs(dy || 1e-6));
    const x = cx + dx * k, y = cy + dy * k, ang = Math.atan2(dy, dx);
    g.save(); g.translate(x, y);
    g.rotate(ang);
    const bob = Math.sin(now * 4) * 2;
    g.fillStyle = a.color; g.strokeStyle = 'rgba(13,20,44,.9)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(12 + bob, 0); g.lineTo(-6 + bob, -9); g.lineTo(-2 + bob, 0); g.lineTo(-6 + bob, 9); g.closePath(); g.fill(); g.stroke();
    g.restore();
    if (a.shape) drawShape(a.shape, x - Math.cos(ang) * 16, y - Math.sin(ang) * 16, 5, a.color);
    if (a.star) { g.fillStyle = '#ffd43b'; g.font = '900 14px Fredoka, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('★', x - Math.cos(ang) * 18, y - Math.sin(ang) * 18); }
  }

  return {
    resize, draw, addEffect, dust, art: () => art, zoom: () => zoom,
    lightning() { flash = 0.25; },
    toWorld(cssX, cssY, cam) { return { x: cam.x + (cssX - vw / 2) / zoom, y: cam.y + (cssY - vh / 2) / zoom }; },
  };
}

// A small whole-island map for the menu: ground colours at 2 px per tile.
export function minimap(scale = 2) {
  const m = island();
  const c = mk(W * scale, H * scale), x = c.getContext('2d');
  const img = x.createImageData(W * scale, H * scale), d = img.data;
  for (let y = 0; y < H * scale; y++) for (let xx = 0; xx < W * scale; xx++) {
    const gnd = m.ground[Math.floor(y / scale) * W + Math.floor(xx / scale)];
    const col = PAL[gnd] || [0, 0, 0];
    const i = (y * W * scale + xx) * 4;
    d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  return c;
}
