// The island itself: ground tiles, solid scenery, gathering spots, chests, gates, cave and peak.
// Built the same way on every device from fixed numbers, so nothing about the map travels over the network.
import { TILE } from './island-data.js';

export const W = 160, H = 100; // tiles; the main island fills x 0–127, Glowdeep Cave lies apart at x 128–159
export const G = { VOID: 0, SEA: 1, SHALLOW: 2, SAND: 3, GRASS: 4, FOREST: 5, PATH: 6, PLAZA: 7, TALL: 8, WATER: 9, CAVE: 10, CAVEWALL: 11, ROCK: 12, CLIFF: 13, BRIDGE: 14, DOCK: 15, MARSH: 16 };
const SOLID_GROUND = new Set([G.VOID, G.SEA, G.SHALLOW, G.WATER, G.CAVEWALL, G.CLIFF]);
export const ZONES = ['none', 'village', 'meadow', 'woods', 'shore', 'lake', 'marsh', 'cave', 'peak', 'cliffs'];
const Z = Object.fromEntries(ZONES.map((z, i) => [z, i]));

// Gates open for the whole island while any explorer on it has earned them.
export const GATES = {
  bridge: { rect: [107, 48, 2, 5], flag: 'bridge', name: 'the river bridge' },
  cave: { rect: [54, 15, 5, 2], flag: 'mirebrute', name: 'the rockslide at Glowdeep Cave' },
  storm: { rect: [74, 13, 7, 2], flag: 'peak', name: 'the storm barrier' },
};
export const TELEPORTS = [
  { rect: [55, 13.4, 3, 1.1], to: [145.5, 92.5], area: 'cave', label: 'Into Glowdeep Cave' },
  { rect: [143.5, 96.2, 4, 1], to: [56.5, 17.6], area: 'overworld', label: 'Back outside' },
];
export const SPAWN = [64, 69.5];
export const ARENAS = {
  mirebrute: { at: [95, 20.5], r: 6 },
  quartzhulk: { at: [145.5, 13], r: 8 },
  tempestra: { at: [77, 7], r: 5.5 },
};
export const VILLAGE = [49, 59, 33, 27]; // x, y, w, h (tiles): safe from wild creatures
export const RAID_FROM = [[64, 58.5], [48.5, 70], [81, 69.5], [64.5, 85]];
export const LOST_AT = [24, 34];

// Spawn tables per zone: [species, weight], level range, how many may roam near each explorer.
export const SPAWNS = {
  meadow: { list: [['puffcap', 3], ['nettlebug', 3]], lv: [2, 4], max: 4 },
  woods: { list: [['nettlebug', 4], ['puffcap', 3], ['mossip', 1]], lv: [3, 6], max: 6 },
  shore: { list: [['clackle', 4], ['gullwisp', 3], ['dewpaw', 0.6]], lv: [4, 7], max: 5 },
  lake: { list: [['ripplefin', 4], ['gullwisp', 2], ['dewpaw', 1]], lv: [7, 10], max: 5 },
  marsh: { list: [['ripplefin', 2], ['nettlebug', 2], ['murk', 1]], lv: [8, 11], max: 4 },
  cave: { list: [['gemmole', 4], ['fizzwing', 3], ['emberkit', 0.6]], lv: [10, 14], max: 6 },
  peak: { list: [['cindermite', 4], ['murk', 3], ['fizzwing', 1]], lv: [14, 18], max: 5 },
};

function rng(seed) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
export function noise(x, y, s) {
  const fx = x / s, fy = y / s, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
const segDist = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
};
const lineDist = (x, y, pts) => { let d = 1e9; for (let i = 1; i < pts.length; i++) d = Math.min(d, segDist(x, y, ...pts[i - 1], ...pts[i])); return d; };
// A point on the island's oval at a compass angle (degrees, 90 = due south) and fraction of its radius.
const ring = (deg, f) => [64 + 58 * f * Math.cos((deg * Math.PI) / 180), 50 + 44 * f * Math.sin((deg * Math.PI) / 180)];

const ROADS = [
  [[64, 62], [64, 50], [61, 36], [60, 30], [57.5, 20], [56.5, 16]], // north road to the cave
  [[60.5, 30], [66, 25], [72, 20], [77, 16], [77, 13]], // up to the storm pass
  [[58, 70.5], [48, 69.8], [38, 63], [30, 55], [26, 46], [24, 38]], // west into the woods
  [[70, 70.5], [82, 69], [94, 62], [104, 56], [108, 53.5]], // east to the river
  [[108, 47.6], [104, 45.5], [97.5, 43]], // past the bridge to the lake dock
  [[64.5, 76], [64.5, 88]], // south to the shore
];
const RIVER = [[89.5, 47.2], [98, 48.6], [104, 49.6], [110, 51], [117, 52.5], [127, 54]];
const RIDGE = [[81, 12], [82, 24], [80.5, 34], [83, 42], [87.5, 46], [91, 47.4]];
const CAVE_PATH = [[145.5, 98], [145, 88], [139, 78], [138, 74], [146, 66], [152, 60], [147, 52], [140, 45], [143, 37], [150, 30], [148, 22], [145.5, 13]];
const CAVE_ROOMS = [[145, 90, 4.5], [138.5, 75, 5.5], [152, 60, 5.5], [140.5, 44, 4.5], [150, 29, 4.5], [145.5, 13, 8.5]];
export const TRACKS = Array.from({ length: 16 }, (_, i) => {
  const [x, y] = ring(100 + (40 * i) / 15, 0.935);
  return [Math.round(x * TILE), Math.round((y + Math.sin(i * 1.3) * 0.6) * TILE)];
});
export const LUNA_AT = [TRACKS[15][0] / TILE, TRACKS[15][1] / TILE];

export function buildIsland() {
  const ground = new Uint8Array(W * H);
  const zone = new Uint8Array(W * H);
  const blocked = new Uint8Array(W * H); // scenery that blocks (trunks, houses, rocks)
  const at = (x, y) => y * W + x;
  const coast = new Float32Array(W * H).fill(9);

  // Land, shallows and sea.
  for (let y = 0; y < H; y++) for (let x = 0; x < 128; x++) {
    const d = Math.hypot((x + 0.5 - 64) / 58, (y + 0.5 - 50) / 44) + (noise(x, y, 7) - 0.5) * 0.12 + (noise(x, y, 3) - 0.5) * 0.04;
    coast[at(x, y)] = d;
    ground[at(x, y)] = d < 0.9 ? G.GRASS : d < 1 ? G.SAND : d < 1.07 ? G.SHALLOW : G.SEA;
  }
  const land = (x, y) => coast[at(x, y)] < 1;
  // Northern mountains with the summit plateau.
  for (let y = 0; y < 22; y++) for (let x = 0; x < 128; x++) {
    if (land(x, y) && y < 14.5 + (noise(x, y, 5) - 0.5) * 3.5) ground[at(x, y)] = G.CLIFF;
  }
  for (let y = 0; y < 16; y++) for (let x = 56; x < 100; x++) {
    if (Math.hypot((x + 0.5 - 77) / 14.5, (y + 0.5 - 6.8) / 5.6) < 1 && land(x, y)) ground[at(x, y)] = G.ROCK;
  }
  // Forest floor in the west, marsh north of the lake, the lake and its river, the ridge that walls the lake in.
  for (let y = 16; y < 72; y++) for (let x = 2; x < 50; x++) {
    if (ground[at(x, y)] === G.GRASS && x < 44 + (noise(x, y, 6) - 0.5) * 8) ground[at(x, y)] = G.FOREST;
  }
  for (let y = 14; y < 27; y++) for (let x = 82; x < 110; x++) {
    if (ground[at(x, y)] === G.GRASS && Math.hypot((x + 0.5 - 96) / 13, (y + 0.5 - 21) / 5) < 1) ground[at(x, y)] = G.MARSH;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < 128; x++) {
    if (!land(x, y)) continue;
    const lake = Math.hypot((x + 0.5 - 98) / 12, (y + 0.5 - 34) / 8) + (noise(x, y, 4) - 0.5) * 0.12;
    if (lake < 1) ground[at(x, y)] = G.WATER;
    else if (y > 40 && lineDist(x + 0.5, y + 0.5, RIVER) < 1.5 + noise(x, y, 5) * 0.5) ground[at(x, y)] = G.WATER;
    else if (y > 11 && lineDist(x + 0.5, y + 0.5, RIDGE) < 1.4 + noise(x, y, 4) * 0.9) ground[at(x, y)] = G.CLIFF;
  }
  // Roads cut through everything but water.
  for (const road of ROADS) for (let y = 0; y < H; y++) for (let x = 0; x < 128; x++) {
    const g = ground[at(x, y)];
    if (g === G.WATER || g === G.SEA || g === G.SHALLOW) continue;
    if (lineDist(x + 0.5, y + 0.5, road) < 1.15 + (noise(x, y, 3) - 0.5) * 0.3) ground[at(x, y)] = g === G.SAND ? G.SAND : G.PATH;
  }
  // The village: grass and a stone square.
  for (let y = 60; y < 84; y++) for (let x = 50; x < 80; x++) {
    if (ground[at(x, y)] === G.FOREST || ground[at(x, y)] === G.CLIFF) ground[at(x, y)] = G.GRASS;
    if (x >= 58 && x <= 70 && y >= 66 && y <= 76) ground[at(x, y)] = G.PLAZA;
  }
  // The river bridge (water until mended) and the fishing dock.
  for (let y = 46; y < 55; y++) for (let x = 106; x < 110; x++) if (ground[at(x, y)] !== G.WATER) ground[at(x, y)] = G.PATH;
  for (let y = 37; y < 44; y++) for (let x = 96; x < 98; x++) ground[at(x, y)] = y >= 42 ? G.PATH : G.DOCK;
  // Cave mouth and the storm pass.
  for (let y = 12; y < 18; y++) for (let x = 54; x < 59; x++) ground[at(x, y)] = y <= 14 ? (x >= 55 && x <= 57 ? G.CAVE : G.CLIFF) : G.PATH;
  for (let x = 53; x < 60; x++) ground[at(x, 11)] = G.CLIFF;
  for (let y = 11; y < 17; y++) for (let x = 73; x < 82; x++) ground[at(x, y)] = x <= 73 || x >= 81 ? G.CLIFF : G.ROCK;
  // Tall grass where wild creatures hide.
  const meadows = [[37, 49, 5, 4], [53, 42, 4, 5], [86, 84, 5, 2.5], [105, 25, 3, 1.6], [30, 26, 4, 3], [16, 60, 3.5, 3], [70, 37, 4, 3], [104, 63, 4, 3], [92, 53, 3, 2.5], [88, 22, 3, 1.6], [40, 82, 4, 2]];
  for (const [cx, cy, rx, ry] of meadows) for (let y = Math.floor(cy - ry); y <= cy + ry; y++) for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
    const g = ground[at(x, y)];
    if ((g === G.GRASS || g === G.FOREST || g === G.SAND || g === G.MARSH) && Math.hypot((x - cx) / rx, (y - cy) / ry) + (noise(x, y, 2) - 0.5) * 0.5 < 1) ground[at(x, y)] = G.TALL;
  }
  // Glowdeep Cave: tunnels and chambers carved out of rock.
  for (let y = 0; y < H; y++) for (let x = 128; x < W; x++) {
    const open = lineDist(x + 0.5, y + 0.5, CAVE_PATH) < 1.6 + noise(x, y, 3) * 0.9 || CAVE_ROOMS.some(([cx, cy, r]) => Math.hypot(x + 0.5 - cx, y + 0.5 - cy) < r + (noise(x, y, 3) - 0.5) * 1.6);
    if (open && x > 129 && x < W - 2 && y > 1) ground[at(x, y)] = G.CAVE;
  }
  for (let y = 0; y < H; y++) for (let x = 128; x < W; x++) {
    if (ground[at(x, y)] !== G.VOID) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 128 && nx < W && ny >= 0 && ny < H && ground[at(nx, ny)] === G.CAVE) ground[at(x, y)] = G.CAVEWALL;
    }
  }

  // Zones: which creatures roam where, and what the area is called.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const g = ground[at(x, y)];
    let z = 'none';
    if (x >= 128) z = g === G.CAVE ? 'cave' : 'none';
    else if (SOLID_GROUND.has(g)) z = g === G.CLIFF ? 'cliffs' : 'none';
    else if (x >= VILLAGE[0] && x < VILLAGE[0] + VILLAGE[2] && y >= VILLAGE[1] && y < VILLAGE[1] + VILLAGE[3]) z = 'village';
    else if (g === G.ROCK && y < 13) z = 'peak';
    else if (g === G.ROCK) z = 'cliffs';
    else if (x > 81 && y < 47 && (g === G.MARSH || y < 25)) z = 'marsh';
    else if (x > 81 && y < 50 && lineDist(x + 0.5, y + 0.5, RIVER) > 1 && y < 47 + (x - 90) * 0.25) z = 'lake';
    else if (g === G.FOREST || (x < 46 && y < 70 && y > 16 && g !== G.SAND)) z = 'woods';
    else if (g === G.SAND || coast[at(x, y)] > 0.86) z = 'shore';
    else z = 'meadow';
    zone[at(x, y)] = Z[z];
  }

  // Scenery. Each prop: { k: kind, v: variant, x, y (world px, where it meets the ground), ... }.
  const props = [];
  const nodes = []; // gathering spots: { id, k, item, x, y }
  const chests = [];
  const solidRect = (x, y, w, h) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (i >= 0 && j >= 0 && i < W && j < H) blocked[at(i, j)] = 1; };
  const put = (k, tx, ty, v = 0, solid = null, extra = {}) => {
    const p = { k, v, x: Math.round(tx * TILE), y: Math.round(ty * TILE), ...extra };
    props.push(p);
    if (solid) solidRect(...solid);
    return p;
  };
  const free = (x, y) => x >= 0 && y >= 0 && x < W && y < H && !blocked[at(x, y)] && !SOLID_GROUND.has(ground[at(x, y)]);
  const onRoad = (x, y) => ROADS.some((road) => lineDist(x + 0.5, y + 0.5, road) < 2.4);
  // The nearest free tile of the wanted ground to (tx, ty), searching outwards.
  const spot = (tx, ty, kinds) => {
    for (let d = 0; d < 7; d++) for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
      const x = Math.round(tx) + dx, y = Math.round(ty) + dy;
      if (free(x, y) && kinds.includes(ground[at(x, y)]) && !onRoad(x, y)) return [x, y];
    }
    return [Math.round(tx), Math.round(ty)];
  };
  const r = rng(20261031);

  // Village buildings and life.
  put('elderhouse', 68, 64.1, 0, [66, 62, 4, 2]);
  put('healerhut', 53.5, 69.1, 0, [52, 67, 3, 2]);
  put('shop', 74.5, 69.1, 0, [73, 68, 3, 1]);
  put('house', 52.5, 77.1, 0, [51, 75, 3, 2]);
  put('house', 77.5, 77.1, 1, [76, 75, 3, 2]);
  put('house', 58.5, 82.1, 2, [57, 80, 3, 2]);
  put('well', 64.5, 72, 0, [64, 71, 1, 1]);
  for (const [x, y] of [[58.6, 66.6], [70.4, 66.6], [58.6, 76.6], [70.4, 76.6], [62.4, 59.6], [66.2, 59.6]]) put('lantern', x, y);
  put('sign', 61.6, 61, 0, null, { sign: 'North: Glowdeep Cave and Stormcrown Peak' });
  put('sign', 49.6, 68.4, 0, null, { sign: 'West: Whispering Woods' });
  put('sign', 80.6, 68, 0, null, { sign: 'East: the river, and Mirror Lake beyond it' });
  put('sign', 66.4, 85, 0, null, { sign: 'South: Sunsand Shore' });
  // The creature ranch: a fenced pen south-east of the square, with its sign by the gap in the fence.
  for (let x = 67; x <= 74; x++) { put('fenceH', x + 0.5, 79, 0, [x, 78, 1, 1]); put('fenceH', x + 0.5, 83, 0, [x, 82, 1, 1]); }
  for (let y = 79; y <= 81; y++) { put('fenceV', 67.5, y + 0.9, 0, [67, y, 1, 1]); if (y === 79) put('fenceV', 74.5, y + 0.9, 0, [74, y, 1, 1]); }
  put('ranch', 66.2, 81.4, 0, null, { use: 'ranch' });
  put('campfire', 60.5, 79.2, 0, [60, 78, 1, 1]);
  for (const [k, x, y] of [['crate', 76.6, 67.6], ['barrel', 77.5, 67.4], ['crate', 72, 67.6], ['barrel', 51, 69], ['stump', 56, 79.4]]) put(k, x, y, 0, [Math.floor(x), Math.floor(y - 0.2), 1, 1]);
  for (let i = 0; i < 30; i++) {
    const x = 50 + r() * 30, y = 60 + r() * 24, tx = Math.floor(x), ty = Math.floor(y);
    if (ground[at(tx, ty)] === G.GRASS && free(tx, ty) && !onRoad(tx, ty)) put('flowers', x, y, Math.floor(r() * 3));
  }

  // Gates, the summit shrine.
  put('boulderpile', 56.5, 16.9, 0, null, { gate: 'cave' });
  put('stormgate', 77.5, 14.9, 0, null, { gate: 'storm' });
  put('shrine', 77, 4.2, 0, [76, 3, 2, 1]);

  // Gathering spots: each explorer picks them on their own timer.
  const node = (k, item, at2, kinds, v = 0) => {
    const [x, y] = spot(at2[0], at2[1], kinds);
    const id = k.slice(0, 2) + nodes.length;
    const n = { id, k, item, x: (x + 0.5) * TILE, y: Math.round((y + 0.8) * TILE) };
    nodes.push(n);
    props.push({ k, v, x: n.x, y: n.y, node: id });
    solidRect(x, y, 1, 1);
  };
  const WOODS = [G.FOREST], SANDY = [G.SAND], CAVE = [G.CAVE];
  for (const p of [[30, 58], [34, 53], [22, 46], [18, 40], [28, 30], [36, 40], [14, 52], [40, 58], [42, 46]]) node('berrybush', 'sunberry', p, WOODS);
  for (const p of [[26, 42], [20, 58], [38, 34], [12, 44], [33, 29], [40, 64]]) node('mushrooms', 'mushroom', p, WOODS);
  for (const deg of [32, 46, 60, 74, 106, 120, 134, 148, 20]) node('shell', 'shells', ring(deg, 0.94), SANDY, deg % 2);
  for (const deg of [26, 40, 54, 68, 82, 113, 127]) node('driftwood', 'driftwood', ring(deg, 0.945), SANDY);
  for (const p of [[139, 77], [135, 73], [155, 58], [150, 63], [143, 46], [152, 31], [137, 42], [148, 86]]) node('crystal', 'crystal', p, CAVE);

  // Chests: opened once per explorer.
  const chest = (id, at2, kinds, loot) => {
    const [x, y] = spot(at2[0], at2[1], kinds);
    const c = { id, x: (x + 0.5) * TILE, y: Math.round((y + 0.8) * TILE), loot };
    chests.push(c);
    props.push({ k: 'chest', v: 0, x: c.x, y: c.y, chest: id });
    solidRect(x, y, 1, 1);
  };
  chest('woods', [14, 56], WOODS, { gear: 'feather', shells: 20 });
  chest('east', ring(18, 0.93), SANDY, { charm: 3, shells: 30 });
  chest('meadow', [104, 23], [G.GRASS, G.MARSH, G.TALL], { seed: 2, bigberry: 2 });
  chest('marsh', [87, 19], [G.MARSH, G.GRASS], { shells: 50, seed: 1 });
  chest('glow', [140, 44], CAVE, { gear: 'leafcharm' });
  chest('deep', [151, 28], CAVE, { bigberry: 3, shells: 80 });
  chest('summit', [86, 6], [G.ROCK], { shells: 150, seed: 3 });
  chest('cliff', [68, 23], [G.GRASS, G.FOREST], { charm: 2, shells: 20 });

  // Trees, rocks and plants, scattered by area.
  const keepClear = (x, y) => {
    const near = (pt, d) => Math.hypot(x - pt[0], y - pt[1]) < d;
    return near(LOST_AT, 4.5) || near([36, 50], 3) || near([14, 56], 2.5) || near(LUNA_AT, 3) || Object.values(ARENAS).some((a) => near(a.at, a.r + 1));
  };
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < 127; x++) {
    const g = ground[at(x, y)];
    const z = ZONES[zone[at(x, y)]];
    if (g === G.WATER) { if (x > 84 && y < 43 && hash(x * 5, y * 3) < 0.05) put('lily', x + 0.5, y + 0.6); continue; }
    if (!free(x, y) || onRoad(x, y) || z === 'village' || keepClear(x, y)) continue;
    const roll = r(), jx = x + 0.25 + r() * 0.5, jy = y + 0.7 + r() * 0.25;
    if (g === G.FOREST) {
      if ((x + y) % 2 === 0 && roll < 0.44) put(r() < 0.35 ? 'pine' : 'oak', jx, jy, Math.floor(r() * 2), [x, y, 1, 1]);
      else if (roll < 0.52) put('bush', jx, jy, 0, [x, y, 1, 1]);
      else if (roll < 0.58) put('flowers', jx, jy, Math.floor(r() * 3));
    } else if (g === G.GRASS) {
      if (roll < (z === 'lake' ? 0.05 : 0.035)) put(r() < 0.55 ? 'oak' : 'pine', jx, jy, Math.floor(r() * 2), [x, y, 1, 1]);
      else if (roll < 0.065) put('flowers', jx, jy, Math.floor(r() * 3));
      else if (roll < 0.075) put('rock', jx, jy);
      else if (roll < 0.08) put('boulder', jx, jy, 0, [x, y, 1, 1]);
    } else if (g === G.SAND) {
      if (coast[at(x, y)] < 0.965 && roll < 0.03) put('palm', jx, jy, 0, [x, y, 1, 1]);
      else if (roll < 0.04) put('rock', jx, jy);
    } else if (g === G.MARSH) {
      if (roll < 0.1) put('reeds', jx, jy);
      else if (roll < 0.12) put('stump', jx, jy, 0, [x, y, 1, 1]);
    } else if (g === G.ROCK && z === 'peak') {
      if (roll < 0.045) put('boulder', jx, jy, 0, [x, y, 1, 1]);
      else if (roll < 0.1) put('cracked', x + 0.5, y + 0.5);
    }
  }
  // Reeds along the lake and river banks.
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < 127; x++) {
    if (ground[at(x, y)] !== G.GRASS && ground[at(x, y)] !== G.MARSH) continue;
    const wet = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => ground[at(x + dx, y + dy)] === G.WATER);
    if (wet && free(x, y) && hash(x, y) < 0.4 && !onRoad(x, y) && !keepClear(x, y)) put('reeds', x + 0.5, y + 0.85);
  }
  // Cave furnishings.
  for (let y = 1; y < H - 1; y++) for (let x = 129; x < W - 1; x++) {
    if (ground[at(x, y)] !== G.CAVE || !free(x, y)) continue;
    const wall = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => ground[at(x + dx, y + dy)] === G.CAVEWALL);
    const h = hash(x * 3, y * 7);
    if (Math.hypot(x - ARENAS.quartzhulk.at[0], y - ARENAS.quartzhulk.at[1]) < 7 || y > 93) continue;
    if (nodes.some((n) => Math.abs(n.x / TILE - x - 0.5) < 1.5 && Math.abs(n.y / TILE - y - 0.8) < 1.5)) continue;
    if (wall && h < 0.12) put('cavecrystal', x + 0.5, y + 0.85, 0, [x, y, 1, 1]);
    else if (wall && h < 0.26) put('stalagmite', x + 0.5, y + 0.85, 0, [x, y, 1, 1]);
  }

  // Props by 8×8-tile chunk, for drawing only what's on screen.
  const chunks = new Map();
  for (const p of props) {
    const key = Math.floor(p.x / TILE / 8) + ',' + Math.floor(p.y / TILE / 8);
    if (!chunks.has(key)) chunks.set(key, []);
    chunks.get(key).push(p);
  }
  return { ground, zone, blocked, props, chunks, nodes, chests, coast };
}

let cached = null;
export const island = () => (cached ||= buildIsland());

export function groundAt(x, y) { return x < 0 || y < 0 || x >= W || y >= H ? G.VOID : island().ground[y * W + x]; }
export function zoneAt(px, py) {
  const x = Math.floor(px / TILE), y = Math.floor(py / TILE);
  return x < 0 || y < 0 || x >= W || y >= H ? 'none' : ZONES[island().zone[y * W + x]];
}
// open: { bridge: true, ... }, the gates that are open on this island right now.
export function solidTile(x, y, open) {
  if (x < 0 || y < 0 || x >= W || y >= H) return true;
  const m = island(), i = y * W + x;
  for (const id in GATES) {
    const [gx, gy, gw, gh] = GATES[id].rect;
    if (x >= gx && x < gx + gw && y >= gy && y < gy + gh) {
      if (id === 'bridge') return !open?.bridge;
      if (!open?.[id]) return true;
    }
  }
  return SOLID_GROUND.has(m.ground[i]) || !!m.blocked[i];
}
// A circle of radius r at (px, py) world px overlaps nothing solid.
export function fits(px, py, r, open) {
  const x0 = Math.floor((px - r) / TILE), x1 = Math.floor((px + r) / TILE), y0 = Math.floor((py - r) / TILE), y1 = Math.floor((py + r) / TILE);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (solidTile(x, y, open)) return false;
  return true;
}
// Moves a circle by (dx, dy), sliding along walls. The same numbers give the same result on every device.
export function slide(e, dx, dy, r, open) {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 8));
  const sx = dx / steps, sy = dy / steps;
  let moved = false;
  for (let i = 0; i < steps; i++) {
    if (sx && fits(e.x + sx, e.y, r, open)) { e.x += sx; moved = true; }
    if (sy && fits(e.x, e.y + sy, r, open)) { e.y += sy; moved = true; }
  }
  return moved;
}
export const inRect = (px, py, [x, y, w, h]) => px >= x * TILE && px < (x + w) * TILE && py >= y * TILE && py < (y + h) * TILE;
export const areaName = (zone) => ({ village: 'Brightwater Village', meadow: 'Island Meadows', woods: 'Whispering Woods', shore: 'Sunsand Shore', lake: 'Mirror Lake', marsh: 'Mirelight Marsh', cave: 'Glowdeep Cave', peak: 'Stormcrown Peak', cliffs: 'Northern Cliffs' }[zone] || '');
// Every tile reachable on foot from (tx, ty) with these gates open (tests and the spawn check use it).
export function reachable(tx, ty, open) {
  const seen = new Uint8Array(W * H), queue = [ty * W + tx];
  seen[queue[0]] = 1;
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q], x = i % W, y = (i / W) | 0;
    for (const t of TELEPORTS) if (x + 0.5 >= t.rect[0] && x + 0.5 < t.rect[0] + t.rect[2] && y + 0.5 >= t.rect[1] - 0.5 && y + 0.5 < t.rect[1] + t.rect[3] + 0.5) {
      const j = Math.floor(t.to[1]) * W + Math.floor(t.to[0]);
      if (!seen[j]) { seen[j] = 1; queue.push(j); }
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, j = ny * W + nx;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H && !seen[j] && !solidTile(nx, ny, open)) { seen[j] = 1; queue.push(j); }
    }
  }
  return seen;
}
