// Mosaic Palace — draft glazed tiles from porcelain coasters and set them into
// your palace wall. 2–4 players.
//
// Rules (setup / act / endRound) run on the host only. The render side is a
// small presenter: each new view is drawn with FLIP glides (every tile has a
// stable data-k), and the automatic wall tiling at the end of a round is
// replayed as a timed sequence of frames rebuilt from state.tiling:
// pattern line -> wall (+score floats), leftovers -> lid, floor penalties,
// then the refill from the bag. Views that arrive while a sequence plays are
// queued and shown in order, so sounds and floats always match the board.

import { esc, rand, shuffle, log, uid, PLAYER_COLORS } from '../js/util.js';
import { injectCSS, snapshot, flip, fly, floatText, pulse, shake } from '../js/fx.js';
import { sound } from '../js/sound.js';
import { icon } from '../js/icons.js';
import { portrait } from '../js/avatar.js';

/* =====================================================================
   Rules
   ===================================================================== */

const MARKER = 100; // the first-player tile (real tiles are 0..99)
const PEN = [1, 1, 2, 2, 2, 3, 3];
const NAMES = ['Cobalt', 'Amber', 'Terracotta', 'Onyx', 'Turquoise'];
const colorOf = (t) => (t / 20) | 0;
const wallCol = (r, k) => (k + r) % 5; // column of colour k in wall row r
const wallColor = (r, c) => (c - r + 5) % 5; // colour of wall cell (r, c)
const seatOf = (s, pid) => s.players.findIndex((p) => p.id === pid);
const clone = (o) => JSON.parse(JSON.stringify(o));
const tilesOf = (arr) => arr.filter((t) => t !== MARKER);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function newBoard() {
  return {
    lines: [[], [], [], [], []],
    wall: Array.from({ length: 5 }, () => [null, null, null, null, null]),
    floor: [],
    score: 0,
  };
}

// '' when colour k may go on pattern line r, otherwise the reason it can't.
function canPlace(b, r, k) {
  const line = b.lines[r];
  if (line.length >= r + 1) return 'That pattern line is full.';
  if (line.length && colorOf(line[0]) !== k) return 'That line already holds another colour.';
  if (b.wall[r][wallCol(r, k)] !== null) return `Your wall already has ${NAMES[k]} in that row.`;
  return '';
}

// Points for the tile just placed at (r, c).
function tileScore(wall, r, c) {
  let h = 1, v = 1;
  for (let x = c - 1; x >= 0 && wall[r][x] !== null; x--) h++;
  for (let x = c + 1; x < 5 && wall[r][x] !== null; x++) h++;
  for (let y = r - 1; y >= 0 && wall[y][c] !== null; y--) v++;
  for (let y = r + 1; y < 5 && wall[y][c] !== null; y++) v++;
  if (h === 1 && v === 1) return 1;
  return (h > 1 ? h : 0) + (v > 1 ? v : 0);
}

const floorPenalty = (n) => PEN.slice(0, Math.min(7, n)).reduce((a, b) => a + b, 0);

function wallBonus(wall) {
  let rows = 0, cols = 0, colours = 0;
  for (let r = 0; r < 5; r++) if (wall[r].every((x) => x !== null)) rows++;
  for (let c = 0; c < 5; c++) if (wall.every((row) => row[c] !== null)) cols++;
  for (let k = 0; k < 5; k++) if (wall.every((row, r) => row[wallCol(r, k)] !== null)) colours++;
  return { rows, cols, colours, pts: rows * 2 + cols * 7 + colours * 10 };
}

// Fill every factory with 4 tiles. Returns true if the lid was poured back into the bag.
function fillFactories(s) {
  let fromLid = false;
  for (const f of s.factories) {
    while (f.length < 4) {
      if (!s.bag.length) {
        if (!s.lid.length) return fromLid;
        s.bag = shuffle(s.lid);
        s.lid = [];
        fromLid = true;
      }
      f.push(s.bag.pop());
    }
  }
  return fromLid;
}

function doTake(s, seat, a) {
  const b = s.boards[seat];
  const name = s.players[seat].name;
  const fromCentre = a.src === 'c';
  const source = fromCentre ? s.centre : s.factories[a.src];
  const got = source.filter((t) => t !== MARKER && colorOf(t) === a.color);
  const rest = source.filter((t) => t !== MARKER && colorOf(t) !== a.color);
  const n = got.length;
  let marker = false;
  if (fromCentre) {
    marker = s.centre.includes(MARKER);
    s.centre = rest;
    if (marker) {
      s.nextStart = seat;
      if (b.floor.length >= 7) s.lid.push(b.floor.pop());
      b.floor.push(MARKER);
    }
  } else {
    s.factories[a.src] = [];
    s.centre.push(...rest);
  }
  let placed = 0, floorN = marker ? 1 : 0, lidN = 0;
  if (a.line >= 0) {
    const line = b.lines[a.line];
    while (got.length && line.length < a.line + 1) { line.push(got.shift()); placed++; }
  }
  for (const t of got) {
    if (b.floor.length < 7) { b.floor.push(t); floorN++; } else { s.lid.push(t); lidN++; }
  }
  s.ev = { seq: s.seq, p: seat, src: a.src, color: a.color, n, line: a.line, placed, floorN, lidN, marker };
  const where = fromCentre ? 'the centre' : `coaster ${a.src + 1}`;
  const dest = a.line >= 0 ? `line ${a.line + 1}` : 'the floor';
  const spill = a.line >= 0 && n - placed ? ` (${n - placed} to the floor)` : '';
  log(s, `${name} takes ${n} ${NAMES[a.color]} from ${where} → ${dest}${spill}${marker ? ', and the first-player tile' : ''}.`);
}

function endRound(s) {
  const np = s.players.length;
  const pre = { boards: clone(s.boards), lid: s.lid.slice(), bag: s.bag.length, centre: s.centre.slice() };
  const rows = [[], [], [], [], []];
  const gain = Array(np).fill(0);
  for (let r = 0; r < 5; r++) {
    for (let p = 0; p < np; p++) {
      const b = s.boards[p];
      const line = b.lines[r];
      if (line.length !== r + 1) continue;
      const t = line[0];
      const c = wallCol(r, colorOf(t));
      b.wall[r][c] = t;
      const g = tileScore(b.wall, r, c);
      b.score += g;
      gain[p] += g;
      const d = line.slice(1);
      s.lid.push(...d);
      b.lines[r] = [];
      rows[r].push({ p, c, t, d, g, s: b.score });
    }
  }
  const floor = [];
  const lost = Array(np).fill(0);
  for (let p = 0; p < np; p++) {
    const b = s.boards[p];
    if (!b.floor.length) continue;
    const before = b.score;
    b.score = Math.max(0, b.score - floorPenalty(b.floor.length));
    const t = tilesOf(b.floor);
    s.lid.push(...t);
    b.floor = [];
    lost[p] = before - b.score;
    floor.push({ p, pen: lost[p], t, s: b.score });
  }
  s.centre = [MARKER];
  s.tiling = { seq: ++s.tilingSeq, round: s.round, pre, rows, floor, fromLid: false };
  log(s, `Round ${s.round} tiled — ` + s.players.map((pl, p) => `${pl.name} ${gain[p] ? '+' + gain[p] : '+0'}${lost[p] ? ' −' + lost[p] : ''} = ${s.boards[p].score}`).join(', ') + '.');

  const rowDone = s.boards.some((b) => b.wall.some((row) => row.every((x) => x !== null)));
  if (rowDone) return finish(s, 'A palace row is complete — final scoring!');
  if (s.round >= 40) return finish(s, 'The palace season is over — final scoring!');

  s.round++;
  if (s.nextStart >= 0) s.start = s.nextStart;
  s.nextStart = -1;
  s.cur = s.start;
  s.tiling.fromLid = fillFactories(s);
  if (s.factories.every((f) => !f.length)) return finish(s, 'No tiles are left to draft — final scoring!');
  if (s.tiling.fromLid) log(s, 'The bag ran dry, so the lid was poured back in.');
  log(s, `— Round ${s.round} — ${s.players[s.cur].name} holds the first-player tile and starts.`);
}

function finish(s, why) {
  log(s, why);
  s.final = s.boards.map((b, p) => {
    const w = wallBonus(b.wall);
    const base = b.score;
    b.score += w.pts;
    if (w.pts) {
      const parts = [];
      if (w.rows) parts.push(`${plural(w.rows, 'row')} +${w.rows * 2}`);
      if (w.cols) parts.push(`${plural(w.cols, 'column')} +${w.cols * 7}`);
      if (w.colours) parts.push(`${plural(w.colours, 'colour set')} +${w.colours * 10}`);
      log(s, `${s.players[p].name}: ${parts.join(', ')}.`);
    }
    return { p, base, rows: w.rows, cols: w.cols, colours: w.colours, bonus: w.pts, total: b.score };
  });
  const best = Math.max(...s.boards.map((b) => b.score));
  let cands = s.final.filter((f) => f.total === best);
  const bestRows = Math.max(...cands.map((f) => f.rows));
  cands = cands.filter((f) => f.rows === bestRows);
  s.winners = cands.map((f) => s.players[f.p].id);
  s.over = true;
  s.phase = 'over';
  s.cur = -1;
  const names = cands.map((f) => s.players[f.p].name);
  log(s, `${names.join(' & ')} ${names.length > 1 ? 'share the victory' : 'wins'} with ${best} points!`);
}

/* =====================================================================
   Bot
   ===================================================================== */

function botMove(v, pid) {
  const seat = seatOf(v, pid);
  const b = v.boards[seat];
  const srcs = [];
  v.factories.forEach((f, i) => { if (f.length) srcs.push([i, f]); });
  if (tilesOf(v.centre).length) srcs.push(['c', v.centre]);
  const avail = [0, 0, 0, 0, 0];
  for (const [, ts] of srcs) for (const t of ts) if (t !== MARKER) avail[colorOf(t)]++;

  // Probably the last round? (someone has 4 tiles in a row and is working on the 5th)
  const endSoon = v.round >= 7 || v.boards.some((bd) => bd.wall.some((row, r) => {
    const cnt = row.filter((x) => x !== null).length;
    return cnt === 5 || (cnt === 4 && bd.lines[r].length > 0);
  }));

  // Wall as it will look once the already-full lines are tiled.
  const pend = b.wall.map((row) => row.slice());
  b.lines.forEach((ln, r) => { if (ln.length === r + 1) pend[r][wallCol(r, colorOf(ln[0]))] = ln[0]; });
  const fl = b.floor.length;
  const floorCost = (k) => { let c = 0; for (let i = 0; i < k; i++) c += fl + i < 7 ? PEN[fl + i] : 0; return c; };

  const evaluate = (line, k, cnt, marker) => {
    const mk = marker ? 1 : 0;
    const markerVal = marker && !endSoon ? 0.7 : 0;
    if (line < 0) return -floorCost(cnt + mk) - 1.5 + markerVal;
    const ln = b.lines[line], cap = line + 1, have = ln.length, free = cap - have;
    const put = Math.min(cnt, free), over = cnt - put, done = have + put === cap;
    const c = wallCol(line, k);
    const w = pend.map((row) => row.slice());
    w[line][c] = 1;
    const adj = tileScore(w, line, c);
    let rowN = 0, colN = 0, kN = 0;
    for (let x = 0; x < 5; x++) {
      if (w[line][x] !== null) rowN++;
      if (w[x][c] !== null) colN++;
      if (w[x][wallCol(x, k)] !== null) kN++;
    }
    const sets = (rowN === 5 ? 2 : rowN * 0.15) + (colN === 5 ? 7 : colN * 0.5) + (kN === 5 ? 10 : kN * 0.55);
    let val = 0;
    if (done) {
      val += adj + sets + 1.4 + (over === 0 ? 0.7 : 0);
    } else {
      const need = free - put;
      let f = (adj + sets * 0.8 + 1) * (put / cap) * 0.8;
      if (endSoon) f *= 0.12;
      val += f;
      if (avail[k] - cnt < need) val -= 0.3 + 0.15 * need; // can't finish it this round
      if (have === 0) val -= 0.12 * line * (endSoon ? 3 : 1); // opening a long line ties it up
    }
    return val - floorCost(over + mk) + markerVal;
  };

  let best = null, bestV = -Infinity;
  for (const [src, ts] of srcs) {
    const marker = src === 'c' && ts.includes(MARKER);
    for (let k = 0; k < 5; k++) {
      const cnt = ts.filter((t) => t !== MARKER && colorOf(t) === k).length;
      if (!cnt) continue;
      for (let line = -1; line < 5; line++) {
        if (line >= 0 && canPlace(b, line, k)) continue;
        const val = evaluate(line, k, cnt, marker) + Math.random() * 0.25;
        if (val > bestV) { bestV = val; best = { type: 'take', src, color: k, line }; }
      }
    }
  }
  return best;
}

/* =====================================================================
   Art: tile motifs, icons, cover
   ===================================================================== */

const svgURL = (s) => `url("data:image/svg+xml,${encodeURIComponent(s.replace(/\s+/g, ' '))}")`;
const SV = "xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'";
const ring = (stroke, op) => `<rect x='8.5' y='8.5' width='83' height='83' rx='14' fill='none' stroke='${stroke}' stroke-opacity='${op}' stroke-width='2.4'/>`;
const rotG = (inner, n, step, off = 0) => Array.from({ length: n }, (_, i) => `<g transform='rotate(${off + i * step} 50 50)'>${inner}</g>`).join('');
function starPath(cx, cy, ro, ri, n = 8, rot = -90) {
  let d = '';
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? ri : ro;
    const a = ((rot + (i * 180) / n) * Math.PI) / 180;
    d += (i ? 'L' : 'M') + (cx + r * Math.cos(a)).toFixed(2) + ' ' + (cy + r * Math.sin(a)).toFixed(2);
  }
  return d + 'Z';
}
const corners = (fill, r, op = 0.8) => `<g fill='${fill}' fill-opacity='${op}'><circle cx='19' cy='19' r='${r}'/><circle cx='81' cy='19' r='${r}'/><circle cx='19' cy='81' r='${r}'/><circle cx='81' cy='81' r='${r}'/></g>`;

const latticeDots = [];
for (const c1 of [-50, -25, 0, 25, 50]) for (const c2 of [50, 75, 100, 125, 150]) {
  const x = (c1 + c2) / 2, y = (c2 - c1) / 2;
  if (x > 14 && x < 86 && y > 14 && y < 86 && !(x === 50 && y === 50)) latticeDots.push(`<circle cx='${x}' cy='${y}' r='3.4'/>`);
}

const MOTIFS = [
  // Cobalt: white floral
  `<svg ${SV}>${ring('#e6eeff', 0.5)}
    ${rotG("<path d='M50 46 C41 37 42 22 50 13 C58 22 59 37 50 46Z' fill='#f6f9ff'/>", 4, 90)}
    ${rotG("<path d='M50 45 C46.5 39 47 32 50 27 C53 32 53.5 39 50 45Z' fill='#b9ccff'/>", 4, 90, 45)}
    <circle cx='50' cy='50' r='7.5' fill='#ffd76a' stroke='#a8700f' stroke-width='1.6'/>
    ${corners('#f6f9ff', 3.2)}</svg>`,
  // Amber: sun
  `<svg ${SV}>${ring('#8a3a08', 0.35)}
    ${rotG("<path d='M50 10 L55.5 28 L44.5 28Z' fill='#a8420b'/>", 6, 60)}
    ${rotG("<path d='M50 18 L54 29 L46 29Z' fill='#c2560f'/>", 6, 60, 30)}
    <circle cx='50' cy='50' r='18.5' fill='#c4500e'/>
    <circle cx='50' cy='50' r='14' fill='#ffd04a' stroke='#a8420b' stroke-width='1.5'/>
    <circle cx='50' cy='50' r='6.5' fill='#e2781c'/></svg>`,
  // Terracotta: diamond lattice
  `<svg ${SV}><defs><clipPath id='k'><rect x='9' y='9' width='82' height='82' rx='13'/></clipPath></defs>
    <g clip-path='url(#k)' stroke='#ffe3c4' stroke-opacity='.85' stroke-width='3' fill='none'>
      ${[-75, -50, -25, 0, 25, 50, 75].map((c) => `<path d='M${c} 0 L${c + 100} 100'/>`).join('')}
      ${[25, 50, 75, 100, 125, 150, 175].map((c) => `<path d='M${c} 0 L${c - 100} 100'/>`).join('')}
    </g>
    <g fill='#ffe3c4'>${latticeDots.join('')}</g>
    <path d='M50 35 L65 50 L50 65 L35 50Z' fill='#ffe3c4'/><path d='M50 43 L57 50 L50 57 L43 50Z' fill='#b9461f'/></svg>`,
  // Onyx: gold star
  `<svg ${SV}><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#fff4c0'/><stop offset='.45' stop-color='#e8b445'/><stop offset='1' stop-color='#8c5a12'/></linearGradient></defs>
    ${ring('#e0ad45', 0.55)}
    <path d='${starPath(50, 50, 34, 26, 8, -90)}' fill='url(#g)' stroke='#6e4508' stroke-width='1.4' stroke-linejoin='round'/>
    <path d='${starPath(50, 50, 20, 15.3, 8, -90)}' fill='none' stroke='#6e4508' stroke-width='1.3' stroke-opacity='.65'/>
    <circle cx='50' cy='50' r='7' fill='#17171d' stroke='#f0c25a' stroke-width='1.8'/>
    ${corners('#e8b445', 2.6, 0.75)}</svg>`,
  // Turquoise: white waves
  `<svg ${SV}>${ring('#ffffff', 0.5)}
    <g fill='none' stroke='#ffffff' stroke-width='5' stroke-linecap='round' stroke-opacity='.95'>
      <path d='M14 33 q9 -10 18 0 t18 0 t18 0 t18 0'/>
      <path d='M14 52 q9 -10 18 0 t18 0 t18 0 t18 0'/>
      <path d='M14 71 q9 -10 18 0 t18 0 t18 0 t18 0'/>
    </g>
    <g fill='#ffffff' fill-opacity='.85'><circle cx='23' cy='21' r='2.3'/><circle cx='59' cy='21' r='2.3'/><circle cx='41' cy='83' r='2.3'/><circle cx='77' cy='83' r='2.3'/></g></svg>`,
];

const GLAZES = [
  'radial-gradient(circle at 30% 22%, #9dbcff 0%, #3a68dc 34%, #1c3c9e 68%, #0d2160 100%)',
  'radial-gradient(circle at 30% 22%, #fff6c4 0%, #ffd24a 34%, #eba21c 68%, #a9620a 100%)',
  'radial-gradient(circle at 30% 22%, #ffb895 0%, #e2663d 34%, #b2401f 68%, #742410 100%)',
  'radial-gradient(circle at 30% 22%, #74747f 0%, #2e2e38 34%, #16161c 68%, #050507 100%)',
  'radial-gradient(circle at 30% 22%, #d4fff9 0%, #55dccc 34%, #1ba99c 68%, #0a6a63 100%)',
];

// Courtyard inlay under the coasters (moon-silver lines).
const MEDALLION = svgURL(`<svg ${SV}><g fill='none' stroke='#d6e2ff' stroke-width='.7'><circle cx='50' cy='50' r='49'/><circle cx='50' cy='50' r='46.5'/>
  <path d='${starPath(50, 50, 45, 34.4, 8, -90)}'/><path d='${starPath(50, 50, 45, 34.4, 8, -67.5)}'/><circle cx='50' cy='50' r='22'/></g></svg>`);
// Ripples and a star carved into the fountain basin (the centre pool).
const ENGRAVE = svgURL(`<svg ${SV}><g fill='none' stroke='#c6d6ff' stroke-opacity='.24' stroke-width='1.1'>
  <path d='${starPath(50, 50, 48, 36.7, 8, -90)}'/><path d='${starPath(50, 50, 48, 36.7, 8, -67.5)}'/><circle cx='50' cy='50' r='20'/></g>
  <g fill='none' stroke='#ffffff' stroke-opacity='.12' stroke-width='.8' transform='translate(.7 .9)'><path d='${starPath(50, 50, 48, 36.7, 8, -90)}'/><path d='${starPath(50, 50, 48, 36.7, 8, -67.5)}'/></g></svg>`);
const FRIEZE = svgURL(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 12'><path d='M0 6 L6 1 L12 6 L18 1 L24 6 M0 11 L6 6 L12 11 L18 6 L24 11' fill='none' stroke='#4f63a8' stroke-opacity='.4' stroke-width='1'/><circle cx='12' cy='3.5' r='1' fill='#d4a24a' fill-opacity='.75'/></svg>`);
// Factory coasters are glazed porcelain plates: cobalt brushwork on the rim, a faint rosette in the well.
const PLATE = svgURL(`<svg ${SV}><circle cx='50' cy='50' r='48.6' fill='none' stroke='#2747a8' stroke-width='1.4'/>
  <circle cx='50' cy='50' r='46.6' fill='none' stroke='#2747a8' stroke-opacity='.45' stroke-width='.5'/>
  ${rotG("<path d='M50 4.4 C52.3 7 52.3 9.4 50 11.8 C47.7 9.4 47.7 7 50 4.4Z' fill='#2f56c4' fill-opacity='.82'/>", 16, 22.5)}
  ${rotG("<circle cx='50' cy='7.6' r='1.15' fill='#2f56c4' fill-opacity='.55'/>", 16, 22.5, 11.25)}
  <circle cx='50' cy='50' r='37.4' fill='none' stroke='#2747a8' stroke-opacity='.65' stroke-width='.8'/></svg>`);
const ROSETTE = svgURL(`<svg ${SV}><g fill='none' stroke='#2f56c4' stroke-opacity='.3' stroke-width='2.2'>${rotG("<path d='M50 50 C44 40 44 26 50 18 C56 26 56 40 50 50Z'/>", 8, 45)}<circle cx='50' cy='50' r='7'/></g></svg>`);
// A faint star-lattice inlay for the courtyard floor (the felt).
const LATTICE = svgURL(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><g fill='none' stroke='#c8d6ff' stroke-opacity='.075' stroke-width='1'>
  <path d='${starPath(32, 32, 14, 10.7, 8, -90)}'/><path d='M0 0 L19 19 M64 0 L45 19 M0 64 L19 45 M64 64 L45 45 M32 0 V12 M32 64 V52 M0 32 H12 M64 32 H52'/></g>
  <g fill='#dfe7ff' fill-opacity='.09'><circle cx='0' cy='0' r='2.2'/><circle cx='64' cy='0' r='2.2'/><circle cx='0' cy='64' r='2.2'/><circle cx='64' cy='64' r='2.2'/><circle cx='32' cy='32' r='2'/></g></svg>`);

const LAUREL = `<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="#f2c14e" stroke="#7a5010" stroke-width=".35">
  <ellipse cx="6.4" cy="17.4" rx="1.5" ry="2.9" transform="rotate(-42 6.4 17.4)"/><ellipse cx="4.6" cy="12.8" rx="1.45" ry="2.8" transform="rotate(-12 4.6 12.8)"/>
  <ellipse cx="5.2" cy="8" rx="1.35" ry="2.6" transform="rotate(20 5.2 8)"/><ellipse cx="7.7" cy="4.3" rx="1.15" ry="2.2" transform="rotate(48 7.7 4.3)"/>
  <ellipse cx="17.6" cy="17.4" rx="1.5" ry="2.9" transform="rotate(42 17.6 17.4)"/><ellipse cx="19.4" cy="12.8" rx="1.45" ry="2.8" transform="rotate(12 19.4 12.8)"/>
  <ellipse cx="18.8" cy="8" rx="1.35" ry="2.6" transform="rotate(-20 18.8 8)"/><ellipse cx="16.3" cy="4.3" rx="1.15" ry="2.2" transform="rotate(-48 16.3 4.3)"/></g>
  <path d="M7.5 20.6 Q12 22.4 16.5 20.6" stroke="#f2c14e" stroke-width="1.3" fill="none" stroke-linecap="round"/><circle cx="12" cy="12" r="2.3" fill="#f2c14e"/></svg>`;
const CHEV = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M3.2 1.6 L7 5 L3.2 8.4" fill="none" stroke="#5d6a99" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const BAG = `<svg viewBox="0 0 60 60" aria-hidden="true"><defs><radialGradient id="mosaic-bagg" cx=".36" cy=".38" r=".75"><stop offset="0" stop-color="#c2564a"/><stop offset=".6" stop-color="#8a2b22"/><stop offset="1" stop-color="#4e130e"/></radialGradient></defs>
  <path d="M19 23 C9 30 7 49 15 54.5 C23 59 37 59 45 54.5 C53 49 51 30 41 23 Z" fill="url(#mosaic-bagg)"/>
  <path d="M16 40 C20 46 40 46 44 40" fill="none" stroke="#e8c46a" stroke-opacity=".5" stroke-width="1.2" stroke-dasharray="2 2"/>
  <path d="M21 23 C24 17 36 17 39 23 L37 15.5 C33 11.5 27 11.5 23 15.5 Z" fill="#6e221a"/>
  <path d="M23 15.5 C27 12.8 33 12.8 37 15.5" fill="none" stroke="#a8473a" stroke-width="1.2"/>
  <path d="M19.5 23 Q30 27.5 40.5 23" stroke="#e8c46a" stroke-width="2.6" fill="none" stroke-linecap="round"/>
  <path d="M40 24 L45 34 M40 24 L42 35" stroke="#e8c46a" stroke-width="1.4" stroke-linecap="round"/><circle cx="45" cy="34.5" r="1.8" fill="#f2c14e"/><circle cx="42" cy="35.5" r="1.8" fill="#f2c14e"/>
  <ellipse cx="24" cy="33" rx="5" ry="8" fill="#fff" fill-opacity=".1" transform="rotate(20 24 33)"/></svg>`;

/* Cover art: a moonlit palace courtyard. A master tiler on a stool presses a glowing tile into an
   unfinished mosaic arch while an apprentice holds up a porcelain plate of fresh tiles
   (self-contained "mzc-" ids). */
function buildCover() {
  const g = (id, a, b, c) => `<linearGradient id="mzc-${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset=".55" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient>`;
  const hl = '<path d="M3 4.4 Q4.6 2.3 9.5 2.5" stroke="#fff" stroke-opacity=".7" stroke-width="1" fill="none" stroke-linecap="round"/>';
  const base = (k) => `<rect x=".7" y=".7" width="18.6" height="18.6" rx="3.4" fill="url(#mzc-g${k})"/><rect x=".7" y=".7" width="18.6" height="18.6" rx="3.4" fill="none" stroke="#000" stroke-opacity=".35" stroke-width=".6"/>`;
  const sym = [
    `${base(0)}<g fill="#f4f7ff"><ellipse cx="10" cy="5.5" rx="1.9" ry="3"/><ellipse cx="10" cy="14.5" rx="1.9" ry="3"/><ellipse cx="5.5" cy="10" rx="3" ry="1.9"/><ellipse cx="14.5" cy="10" rx="3" ry="1.9"/></g><circle cx="10" cy="10" r="1.6" fill="#ffd76a"/>`,
    `${base(1)}<g stroke="#9c3d0a" stroke-width="1.3" stroke-linecap="round"><path d="M10 2.6v2.4M10 15v2.4M2.6 10h2.4M15 10h2.4M4.8 4.8l1.7 1.7M13.5 13.5l1.7 1.7M15.2 4.8l-1.7 1.7M6.5 13.5l-1.7 1.7"/></g><circle cx="10" cy="10" r="3.7" fill="#c8530f"/><circle cx="10" cy="10" r="2" fill="#ffd34d"/>`,
    `${base(2)}<path d="M10 3 L17 10 L10 17 L3 10Z M10 6.6 L13.4 10 L10 13.4 L6.6 10Z" fill="none" stroke="#ffe6c9" stroke-width="1.1"/><path d="M3.2 3.2l2 2M16.8 3.2l-2 2M3.2 16.8l2-2M16.8 16.8l-2-2" stroke="#ffe6c9" stroke-width="1"/>`,
    `${base(3)}<path d="${starPath(10, 10, 6.8, 5.2, 8, -90)}" fill="url(#mzc-gold)" stroke="#5a3806" stroke-width=".4"/><circle cx="10" cy="10" r="1.6" fill="#141418"/>`,
    `${base(4)}<path d="M3.6 7.2 q1.6 -1.8 3.2 0 t3.2 0 t3.2 0 t3.2 0 M3.6 10.6 q1.6 -1.8 3.2 0 t3.2 0 t3.2 0 t3.2 0 M3.6 14 q1.6 -1.8 3.2 0 t3.2 0 t3.2 0 t3.2 0" stroke="#fff" stroke-width="1.15" fill="none" stroke-linecap="round"/>`,
  ].map((body, k) => `<symbol id="mzc-t${k}" viewBox="0 0 20 20">${body}${hl}</symbol>`).join('');
  let pat = '';
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) pat += `<use href="#mzc-t${(c - r + 5) % 5}" x="${c * 20}" y="${r * 20}" width="20" height="20"/>`;
  let frieze = '';
  for (let i = 0; i < 41; i++) frieze += `<use href="#mzc-t${(i * 2) % 5}" x="${i * 8}" y="92.6" width="7" height="7"/>`;
  // Unfinished cells of the arch mosaic (on the 20px grid that starts at 110, 30); the first is the one being set.
  const holes = [[170, 110], [190, 110], [190, 90], [190, 130], [190, 70]]
    .map(([x, y], i) => `<rect x="${x}" y="${y}" width="20" height="20" fill="#141b46"/><rect x="${x + 1.2}" y="${y + 1.2}" width="17.6" height="17.6" rx="2.6" fill="none" stroke="${i ? '#000' : '#ffd76a'}" stroke-opacity="${i ? 0.45 : 0.9}" stroke-width="${i ? 1 : 1.2}"/>`).join('');
  const stars = [[16, 14, 0.9], [44, 30, 0.6], [78, 10, 0.8], [112, 24, 0.55], [138, 8, 0.75], [196, 14, 0.7], [214, 36, 0.5], [300, 12, 0.85], [306, 56, 0.5], [8, 50, 0.6], [176, 26, 0.45], [236, 10, 0.6], [292, 74, 0.4]]
    .map(([x, y, o]) => `<circle cx="${x}" cy="${y}" r="1" fill="#fff" opacity="${o}"/>`).join('');
  const spark = (x, y, r, o = 0.95) => `<path d="M${x} ${y - r} L${+(x + r * 0.22).toFixed(1)} ${+(y - r * 0.22).toFixed(1)} L${x + r} ${y} L${+(x + r * 0.22).toFixed(1)} ${+(y + r * 0.22).toFixed(1)} L${x} ${y + r} L${+(x - r * 0.22).toFixed(1)} ${+(y + r * 0.22).toFixed(1)} L${x - r} ${y} L${+(x - r * 0.22).toFixed(1)} ${+(y - r * 0.22).toFixed(1)}Z" fill="#fff" opacity="${o}"/>`;
  const floorLines = [-100, -40, 20, 80, 140, 200, 260, 320, 380, 440].map((X) => `<path d="M${(160 + (X - 160) * 0.54).toFixed(1)} 168 L${X} 200"/>`).join('');
  const sideArch = (x) => `<path d="M${x} 170 L${x} 128 C${x} 113 ${x + 11} 105 ${x + 22} 100 C${x + 33} 105 ${x + 44} 113 ${x + 44} 128 L${x + 44} 170Z" fill="#0f1640" stroke="#dfe6f8" stroke-width="2.2"/>` +
    `<path d="M${x + 3.5} 170 L${x + 3.5} 129 C${x + 3.5} 116 ${x + 13} 109 ${x + 22} 104.6" fill="none" stroke="#d4a24a" stroke-width=".8" opacity=".8"/>` +
    `<circle cx="${x + 22}" cy="128" r="13" fill="url(#mzc-lamp)" opacity=".7"/><path d="M${x + 22} 104 v14" stroke="#8a6a2a" stroke-width=".7"/><path d="M${x + 19} 118 h6 l1.4 4 l-1.4 5 h-6 l-1.4 -5z" fill="url(#mzc-gold)"/><rect x="${x + 20.2}" y="121" width="3.6" height="4.4" fill="#fff4c2"/>`;
  const column = (x) => `<rect x="${x}" y="104" width="8" height="66" fill="url(#mzc-col)"/><rect x="${x + 1.6}" y="104" width="1.4" height="66" fill="#fff" opacity=".4"/>` +
    `<rect x="${x - 2}" y="100" width="12" height="4.5" rx="1" fill="#dfe6f8"/><rect x="${x - 1.5}" y="166" width="11" height="4" fill="#dfe6f8"/>`;
  return `<svg viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="A master tiler sets a glowing tile into a palace mosaic by moonlight while an apprentice holds up a plate of tiles">
  <defs>
    <linearGradient id="mzc-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b1238"/><stop offset=".45" stop-color="#1d2672"/><stop offset="1" stop-color="#3b3f96"/></linearGradient>
    <radialGradient id="mzc-moonglow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#eef2ff" stop-opacity=".55"/><stop offset=".35" stop-color="#b9c8ff" stop-opacity=".2"/><stop offset="1" stop-color="#b9c8ff" stop-opacity="0"/></radialGradient>
    <mask id="mzc-moonm"><rect width="320" height="200" fill="#000"/><circle cx="262" cy="34" r="14" fill="#fff"/><circle cx="268.5" cy="29.5" r="12" fill="#000"/></mask>
    <linearGradient id="mzc-wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b9c4e6"/><stop offset=".6" stop-color="#8c99c8"/><stop offset="1" stop-color="#5d6aa2"/></linearGradient>
    <linearGradient id="mzc-marble" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6f8ff"/><stop offset=".6" stop-color="#d9e0f4"/><stop offset="1" stop-color="#a9b5da"/></linearGradient>
    <radialGradient id="mzc-lamp" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff3c4" stop-opacity=".95"/><stop offset=".3" stop-color="#ffc861" stop-opacity=".5"/><stop offset="1" stop-color="#ff9a2a" stop-opacity="0"/></radialGradient>
    <linearGradient id="mzc-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff1b0"/><stop offset=".5" stop-color="#e0aa3e"/><stop offset="1" stop-color="#8a5a10"/></linearGradient>
    <linearGradient id="mzc-col" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#eef2ff"/><stop offset=".45" stop-color="#cdd6ef"/><stop offset="1" stop-color="#8f9cc8"/></linearGradient>
    <linearGradient id="mzc-shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b1238" stop-opacity=".45"/><stop offset=".45" stop-color="#0b1238" stop-opacity=".05"/><stop offset="1" stop-color="#0b1238" stop-opacity=".45"/></linearGradient>
    <linearGradient id="mzc-floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7180bd"/><stop offset="1" stop-color="#2a3471"/></linearGradient>
    <linearGradient id="mzc-robe" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffbd5a"/><stop offset="1" stop-color="#d4681c"/></linearGradient>
    <linearGradient id="mzc-tunic" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3cc4b0"/><stop offset="1" stop-color="#17786e"/></linearGradient>
    <radialGradient id="mzc-plate" cx=".38" cy=".32" r=".75"><stop offset="0" stop-color="#ffffff"/><stop offset=".6" stop-color="#e9eefb"/><stop offset="1" stop-color="#b9c4e0"/></radialGradient>
    <radialGradient id="mzc-tileglow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffffff" stop-opacity=".95"/><stop offset=".35" stop-color="#bcd2ff" stop-opacity=".55"/><stop offset="1" stop-color="#7aa2ff" stop-opacity="0"/></radialGradient>
    <radialGradient id="mzc-vig" cx=".5" cy=".45" r=".78"><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#050a24" stop-opacity=".6"/></radialGradient>
    ${g('g0', '#7ea6ff', '#2a55c8', '#0f276a')}${g('g1', '#fff2a8', '#f4b62c', '#a9640a')}${g('g2', '#ffaa86', '#d6582f', '#7e2812')}${g('g3', '#62626e', '#24242c', '#060608')}${g('g4', '#c2fff6', '#33c6b7', '#0a716a')}
    ${sym}
    <pattern id="mzc-tiles" width="100" height="100" patternUnits="userSpaceOnUse" x="110" y="30">${pat}</pattern>
    <clipPath id="mzc-arch"><path d="M110 170 L110 98 C110 66 135 50 160 38 C185 50 210 66 210 98 L210 170 Z"/></clipPath>
  </defs>
  <rect width="320" height="200" fill="url(#mzc-sky)"/>${stars}
  <circle cx="262" cy="34" r="56" fill="url(#mzc-moonglow)"/><rect width="320" height="200" fill="#fff8e2" mask="url(#mzc-moonm)"/>
  <g fill="#2a3486"><path d="M14 92 V80 C14 64 36 54 44 50 C52 54 74 64 74 80 V92Z"/><path d="M44 50 V40"/><rect x="80" y="46" width="7" height="46"/><path d="M78.5 52 L83.5 36 L88.5 52Z"/><rect x="77.5" y="58" width="12" height="3" rx="1"/>
    <path d="M236 92 V82 C236 68 254 60 264 56 C274 60 292 68 292 82 V92Z"/><rect x="298" y="52" width="7" height="40"/><path d="M296.5 58 L301.5 42 L306.5 58Z"/></g>
  <path d="M44 50 V41" stroke="#3a4390" stroke-width="1.4"/><circle cx="44" cy="39.5" r="1.8" fill="#d4a24a"/><circle cx="264" cy="54" r="1.6" fill="#d4a24a"/>
  <rect y="90" width="320" height="80" fill="url(#mzc-wall)"/><rect y="87.6" width="320" height="3.6" fill="#e6ecfb"/><rect y="91" width="320" height="10" fill="#1b2560"/>${frieze}<rect y="100.6" width="320" height="1.4" fill="url(#mzc-gold)"/>
  ${sideArch(20)}${sideArch(256)}${column(80)}${column(232)}
  <path d="M98 170 L98 96 C98 60 128 42 160 27 C192 42 222 60 222 96 L222 170 Z" fill="url(#mzc-marble)" stroke="#5d6aa2" stroke-width="1"/>
  <path d="M104 170 L104 97 C104 63 131 46 160 32.6 C189 46 216 63 216 97 L216 170" fill="none" stroke="#2f56c4" stroke-width="2.4" stroke-dasharray="0 4.6" stroke-linecap="round"/>
  <g clip-path="url(#mzc-arch)"><rect x="100" y="28" width="120" height="145" fill="#141b46"/><rect x="110" y="30" width="100" height="145" fill="url(#mzc-tiles)"/>${holes}<rect x="100" y="28" width="120" height="145" fill="url(#mzc-shade)"/>
    <circle cx="160" cy="62" r="46" fill="url(#mzc-lamp)" opacity=".55"/></g>
  <path d="M110 170 L110 98 C110 66 135 50 160 38 C185 50 210 66 210 98 L210 170" fill="none" stroke="url(#mzc-gold)" stroke-width="2.4"/>
  <circle cx="160" cy="62" r="30" fill="url(#mzc-lamp)"/>
  <line x1="160" y1="38" x2="160" y2="50" stroke="#8a6a2a" stroke-width="1"/><path d="M155 50 L160 45 L165 50Z" fill="url(#mzc-gold)"/>
  <path d="M153 50.5 L167 50.5 L171 58 L168 70 L152 70 L149 58Z" fill="url(#mzc-gold)" stroke="#5a360c" stroke-width=".8"/>
  <path d="M154.5 58 L165.5 58 L164 68 L156 68Z" fill="#fff4c2"/><path d="M160 58 V68 M155 63 H165" stroke="#c48a2a" stroke-width=".7"/><path d="M156 70 L164 70 L160 74.5Z" fill="url(#mzc-gold)"/>
  <path d="M232 0 L320 0 L320 40 L150 200 L60 200Z" fill="#e8eeff" opacity=".05"/>
  <rect y="168" width="320" height="32" fill="url(#mzc-floor)"/><rect y="168" width="320" height="1.6" fill="#e6ecfb" opacity=".8"/>
  <g stroke="#e6ecff" stroke-opacity=".2" stroke-width=".8" fill="none">${floorLines}<path d="M0 175 H320 M0 184 H320 M0 195 H320"/></g>
  <ellipse cx="160" cy="182" rx="70" ry="8" fill="#ffc861" opacity=".14"/>
  <g>
    <rect x="212" y="170.5" width="31" height="4.4" rx="1.2" fill="#b07a46" stroke="#5a3416" stroke-width=".6"/><rect x="214.5" y="174.6" width="4" height="15" fill="#7a4a24"/><rect x="236.5" y="174.6" width="4" height="15" fill="#7a4a24"/><rect x="214.5" y="182" width="26" height="2.4" fill="#8a5a2e"/>
    <ellipse cx="228" cy="190.5" rx="17" ry="2.6" fill="#000" opacity=".3"/>
    <ellipse cx="222" cy="170.4" rx="4.4" ry="1.9" fill="#3a2412"/><ellipse cx="234" cy="170.4" rx="4.4" ry="1.9" fill="#3a2412"/>
    <path d="M214 170 C214 145 218 128 228 128 C238 128 242 145 242 170Z" fill="url(#mzc-robe)"/><path d="M228 129 V170" stroke="#fff1b0" stroke-width="1.2" opacity=".75"/>
    <path d="M215.6 150 Q228 154 240.4 150 L240.8 155 Q228 159 215.2 155Z" fill="#2a3f9e"/>
    <path d="M236.5 134 C242.5 141 243.5 149 240.5 155.5" stroke="#e98a2c" stroke-width="5.6" fill="none" stroke-linecap="round"/><circle cx="240.4" cy="157" r="3.1" fill="#b97a4c"/>
    <path d="M241 159 l2.6 6.2" stroke="#6b4424" stroke-width="1.6" stroke-linecap="round"/><path d="M242.4 164.6 l5.2 1.8 l-3 4.2z" fill="#cdd6ef" stroke="#6b7aa8" stroke-width=".5"/>
    <circle cx="181" cy="120" r="17" fill="url(#mzc-tileglow)"/>
    <path d="M220 134 C211 130.5 199 126.5 190 122" stroke="#f29a3a" stroke-width="5.8" fill="none" stroke-linecap="round"/>
    <use href="#mzc-t0" x="175" y="114" width="12" height="12" transform="rotate(-8 181 120)"/><circle cx="189" cy="121.5" r="3.4" fill="#b97a4c"/>
    ${spark(170, 108, 4.4)}${spark(193, 106, 3)}${spark(172, 133, 2.6, 0.8)}
    <rect x="224.5" y="122.5" width="7" height="6.5" fill="#a86a40"/><circle cx="228" cy="117.5" r="9.4" fill="#b97a4c"/>
    <path d="M220 121 C221 129 235 129 236 121 C233.5 125.6 222.5 125.6 220 121Z" fill="#2b1d16"/>
    <circle cx="222.6" cy="120.6" r="1.8" fill="#ff7f8f" opacity=".35"/>
    <path d="M221.6 116.6 q1.8 -1.8 3.6 0 M228 116.6 q1.8 -1.8 3.6 0" fill="none" stroke="#2a1c1a" stroke-width="1.3" stroke-linecap="round"/>
    <path d="M224.6 121.4 q2.4 1.6 4.8 0" stroke="#f3d2b8" stroke-width="1" fill="none" stroke-linecap="round"/>
    <ellipse cx="228" cy="109.6" rx="11.2" ry="6.6" fill="#eef3ff"/><path d="M217.6 111 Q228 104 238.4 111 M218.6 107.6 Q228 101.4 237.4 107.6" fill="none" stroke="#b8c4e4" stroke-width="1"/>
    <path d="M226 103.6 l2 -3.6 l2 3.6z" fill="#d23b4b"/><circle cx="228" cy="106.4" r="1.6" fill="#3ee0a1"/>
  </g>
  <g>
    <ellipse cx="88" cy="186.5" rx="16" ry="2.6" fill="#000" opacity=".3"/>
    <ellipse cx="82" cy="185" rx="4.2" ry="1.9" fill="#3a2412"/><ellipse cx="94" cy="185" rx="4.2" ry="1.9" fill="#3a2412"/>
    <path d="M74.5 184.5 C74.5 160 79 146 88 146 C97 146 101.5 160 101.5 184.5Z" fill="url(#mzc-tunic)"/><path d="M76 164 Q88 167 100 164 L100.3 168 Q88 171 75.7 168Z" fill="#f2c14e"/>
    <path d="M96 152 C102 145.5 105.5 138.5 106.6 131" stroke="#2fb3a0" stroke-width="5" fill="none" stroke-linecap="round"/>
    <path d="M80.5 152 C84 141 91.5 132.5 99.5 128.5" stroke="#2fb3a0" stroke-width="5" fill="none" stroke-linecap="round"/>
    <rect x="85" y="141.5" width="6" height="5.5" fill="#d9a27a"/><circle cx="88" cy="136" r="8.8" fill="#f5c39e"/>
    <path d="M79.6 134.5 C79 126 85 123.5 88 123.5 C92.5 123.5 97 126.5 96.4 134 C95 130 92 128.6 88 128.6 C84 128.6 81 130.5 79.6 134.5Z" fill="#3b2418"/>
    <path d="M82.4 127.6 l1.4 -6.4 h8.4 l1.4 6.4z" fill="#d23b4b"/><path d="M92.2 121.6 q3.6 1.2 3.8 5.6" stroke="#f2c14e" stroke-width="1" fill="none"/><circle cx="96" cy="127.4" r="1.3" fill="#f2c14e"/>
    <circle cx="83.2" cy="139.2" r="1.9" fill="#ff7f8f" opacity=".4"/><circle cx="93.6" cy="139.2" r="1.9" fill="#ff7f8f" opacity=".4"/>
    <circle cx="85.4" cy="135.4" r="1.25" fill="#2a1c1a"/><circle cx="91.4" cy="135.4" r="1.25" fill="#2a1c1a"/><circle cx="85.8" cy="134.9" r=".4" fill="#fff"/><circle cx="91.8" cy="134.9" r=".4" fill="#fff"/>
    <path d="M85.4 139.4 q3 3.4 6 0z" fill="#7a2e35"/>
    <g transform="rotate(-14 113 121)">
      <ellipse cx="113" cy="124" rx="17" ry="12.5" fill="#000" opacity=".25"/>
      <ellipse cx="113" cy="121" rx="17" ry="12.5" fill="url(#mzc-plate)" stroke="#2747a8" stroke-width="1.3"/>
      <ellipse cx="113" cy="121" rx="12.6" ry="9" fill="none" stroke="#2747a8" stroke-opacity=".55" stroke-width=".7"/>
      ${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => { const a = (i * Math.PI) / 6; return `<circle cx="${(113 + 14.8 * Math.cos(a)).toFixed(1)}" cy="${(121 + 10.8 * Math.sin(a)).toFixed(1)}" r=".9" fill="#2f56c4"/>`; }).join('')}
      <use href="#mzc-t1" x="105.4" y="113.6" width="7.4" height="7.4"/><use href="#mzc-t1" x="113.2" y="113.2" width="7.4" height="7.4"/><use href="#mzc-t4" x="105.8" y="121" width="7.4" height="7.4"/><use href="#mzc-t2" x="113.4" y="120.8" width="7.4" height="7.4"/>
    </g>
    <circle cx="106.8" cy="131.4" r="3" fill="#f5c39e"/><circle cx="100" cy="128.4" r="3" fill="#f5c39e"/>
  </g>
  ${spark(134, 84, 3, 0.8)}${spark(286, 112, 2.6, 0.7)}${spark(42, 70, 2.4, 0.7)}
  <rect width="320" height="200" fill="url(#mzc-vig)"/>
</svg>`;
}

/* =====================================================================
   CSS
   ===================================================================== */

const STYLE = `
.mosaic-root { --mz-cell: 8.1cqw; --mz-gap: .8cqw; }
/* Moonlit palace courtyard: deep indigo night, a silver moon glow and a faint star-lattice inlay. */
.mosaic-felt.felt { padding: 12px;
  background:
    radial-gradient(48% 38% at 88% -6%, rgba(228, 236, 255, .34), rgba(170, 190, 255, .1) 45%, transparent 70%),
    radial-gradient(90% 55% at 50% 112%, rgba(90, 120, 220, .26), transparent 65%),
    ${LATTICE} center top / 64px 64px repeat,
    radial-gradient(120% 100% at 50% 0%, #2c3d86 0%, #1d2a66 42%, #141e4c 72%, #0c1434 100%);
  border-color: rgba(180, 200, 255, .22); }
.mosaic-stage { container-type: inline-size; position: relative; }
.mosaic-stage-in { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; justify-items: center; align-items: center; }
.mosaic-tablewrap { width: 100%; max-width: 480px; }
.mosaic-mine { width: 100%; max-width: 560px; }
@container (min-width: 760px) {
  .mosaic-stage-in { grid-template-columns: minmax(0, 1fr) minmax(0, 1.08fr); gap: 18px; }
  .mosaic-tablewrap, .mosaic-mine { max-width: none; }
}
.mosaic-raise { z-index: 5; }

/* status bar */
.mosaic-bar { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; padding: 10px 12px; border-radius: 16px;
  background: linear-gradient(180deg, rgba(8, 12, 38, .62), rgba(8, 12, 38, .44)); border: 1px solid rgba(190, 205, 255, .14);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .06), 0 6px 18px rgba(0, 0, 0, .2); }
.mosaic-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.mosaic-chip { position: relative; display: inline-flex; align-items: center; gap: 7px; padding: 3px 12px 3px 3px; border-radius: 999px; max-width: 100%;
  background: rgba(255, 255, 255, .06); border: 1px solid var(--line); font-size: .84rem; font-weight: 700; transition: box-shadow .3s; }
.mosaic-ava { width: 28px; height: 28px; border-radius: 50%; flex: none; box-shadow: 0 0 0 2px var(--pc, #fff), 0 1px 4px rgba(0, 0, 0, .45); }
.mosaic-ava .portrait { width: 100%; height: 100%; display: block; border-radius: 50%; }
.mosaic-cn { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 8.5em; }
.mosaic-chip b { font-family: var(--font-display); font-weight: 700; color: var(--gold); font-size: 1rem; }
.mosaic-chip.mosaic-me { background: rgba(76, 184, 255, .1); border-color: rgba(76, 184, 255, .32); }
.mosaic-chip.mosaic-on { box-shadow: 0 0 0 2px var(--gold), 0 0 14px rgba(255, 207, 92, .45); }
/* A short flash when this player's score goes up. */
.mosaic-chip.mosaic-scored { animation: mosaicScored 1.2s ease-out .45s; }
@keyframes mosaicScored { 20% { box-shadow: 0 0 0 2px #fff3b0, 0 0 24px 5px rgba(255, 214, 90, .55); } }
.mosaic-chip .mosaic-fp { width: 16px; height: 16px; border-radius: 4px; display: grid; place-items: center; font-family: var(--font-display); font-size: .62rem; font-weight: 700;
  color: #7a5410; background: linear-gradient(145deg, #fffdf2, #e9dcb4); box-shadow: 0 1px 2px rgba(0, 0, 0, .5); }
.mosaic-line2 { display: flex; align-items: center; gap: 6px 12px; flex-wrap: wrap; min-height: 36px; }
.mosaic-line2 .status { margin: 0; white-space: nowrap; display: inline-flex; align-items: center; gap: 7px; }
.mosaic-hintx { font-size: .9rem; color: #dfe5ff; flex: 1; min-width: 12em; line-height: 1.3; }
.mosaic-hintx b { color: #ffe39a; }
.mosaic-line2 button.small { min-height: 36px; }
.mosaic-bar .winner-banner { padding: 4px 0; font-size: 1.35rem; }
.mosaic-bar .winner-banner .ic { width: 1em; height: 1em; vertical-align: -.12em; }
.mosaic-spark { display: inline-grid; place-items: center; color: #cfe0ff; animation: mosaicSpin 2.4s linear infinite; }
@keyframes mosaicSpin { to { transform: rotate(360deg); } }

/* table */
.mosaic-table { position: relative; width: 100%; aspect-ratio: 1; container-type: inline-size; }
.mosaic-medal { position: absolute; left: 50%; top: 50%; width: 92cqw; height: 92cqw; transform: translate(-50%, -50%); background: ${MEDALLION} center / contain no-repeat; opacity: .13; pointer-events: none; }
.mosaic-ring { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); border-radius: 50%; pointer-events: none;
  border: .3cqw dashed rgba(200, 215, 255, .26); box-shadow: 0 0 0 1.4cqw rgba(140, 160, 255, .05), inset 0 0 0 1.4cqw rgba(140, 160, 255, .05); }
.mosaic-fac { position: absolute; transform: translate(-50%, -50%); border-radius: 50%; }
/* Factory coasters: glazed porcelain plates with cobalt brushwork, a sunken well and a glossy highlight. */
.mosaic-coaster { position: absolute; inset: 0; border-radius: 50%;
  background: ${PLATE} center / 100% 100% no-repeat, radial-gradient(circle at 34% 28%, #ffffff 0%, #f1f4fc 38%, #d9e0f0 78%, #b9c4de 100%);
  box-shadow: 0 1.3cqw 2cqw rgba(0, 4, 24, .55), 0 .5cqw 0 #7f8db4, inset 0 .35cqw .3cqw rgba(255, 255, 255, .95), inset 0 -.6cqw 1cqw rgba(40, 60, 130, .35); }
.mosaic-coaster::before { content: ''; position: absolute; inset: 14%; border-radius: 50%;
  background: ${ROSETTE} center / 62% 62% no-repeat, radial-gradient(circle at 50% 36%, #fbfcff, #e8edf8 62%, #d2daee);
  box-shadow: inset 0 .7cqw 1.3cqw rgba(40, 60, 130, .38), inset 0 -.25cqw .35cqw rgba(255, 255, 255, .8), 0 .2cqw .1cqw rgba(255, 255, 255, .7); }
.mosaic-coaster::after { content: ''; position: absolute; inset: 3% 22% 60% 14%; border-radius: 50%; pointer-events: none; transform: rotate(-18deg);
  background: radial-gradient(ellipse at 50% 35%, rgba(255, 255, 255, .85), rgba(255, 255, 255, 0) 70%); }
.mosaic-fac.mosaic-empty .mosaic-coaster { filter: brightness(.68) saturate(.8); }
/* Plates you can take from: a warm rim plus a slow breathing glow behind (opacity only). */
.mosaic-fac::before { content: ''; position: absolute; inset: -1.2cqw; border-radius: 50%; pointer-events: none; opacity: 0; }
.mosaic-fac.mosaic-can .mosaic-coaster { box-shadow: 0 0 0 .45cqw rgba(255, 215, 106, .9), 0 1.3cqw 2cqw rgba(0, 4, 24, .55), 0 .5cqw 0 #7f8db4,
  inset 0 .35cqw .3cqw rgba(255, 255, 255, .95), inset 0 -.6cqw 1cqw rgba(40, 60, 130, .35); }
.mosaic-fac.mosaic-can::before { opacity: 1; box-shadow: 0 0 3.4cqw 1.2cqw rgba(255, 206, 84, .5); animation: mosaicBreathe 2.6s ease-in-out infinite; }
@keyframes mosaicBreathe { 50% { opacity: .3; } }
/* The plate you picked from lifts off the table; pressing a plate dips it. */
.mosaic-fac.mosaic-selsrc { z-index: 3; animation: mosaicPlateUp .3s cubic-bezier(.3,1.4,.5,1) forwards; }
@keyframes mosaicPlateUp { to { transform: translate(-50%, -50%) translateY(-1.1cqw) scale(1.04); } }
.mosaic-fac.mosaic-selsrc .mosaic-coaster { box-shadow: 0 0 0 .55cqw #ffd76a, 0 0 3.2cqw rgba(255, 215, 106, .8), 0 2.6cqw 3cqw rgba(0, 4, 24, .55), 0 .5cqw 0 #7f8db4,
  inset 0 .35cqw .3cqw rgba(255, 255, 255, .95), inset 0 -.6cqw 1cqw rgba(40, 60, 130, .35); }
.mosaic-fac:has(> button.mosaic-hit:active) { transform: translate(-50%, -50%) scale(.97); }
.mosaic-num { position: absolute; left: 50%; bottom: -2.3cqw; transform: translateX(-50%); font-family: var(--font-display); font-weight: 700; font-size: 2.1cqw; line-height: 1;
  color: rgba(215, 225, 255, .6); text-shadow: 0 1px 0 rgba(0, 0, 0, .6); pointer-events: none; }

button.mosaic-hit { position: absolute; width: 50%; height: 50%; min-height: 0; min-width: 0; padding: 0; margin: 0; border: 0; border-radius: 28%;
  background: transparent; box-shadow: none; cursor: pointer; z-index: 8; transition: background .15s; }
button.mosaic-hit:hover:not(:disabled) { filter: none; background: rgba(255, 232, 160, .12); }
button.mosaic-hit:active:not(:disabled) { transform: none; box-shadow: none; background: rgba(255, 232, 160, .2); }
button.mosaic-hit:focus-visible { outline: 2px solid var(--gold); outline-offset: -2px; }

/* tiles */
.mosaic-tk { position: absolute; }
.mosaic-tile, .mosaic-marker { --u: 1cqw; position: absolute; inset: 0; border-radius: 17%; }
.fx-ghost .mosaic-tile, .fx-ghost .mosaic-marker { --u: 3.6px; }
.mosaic-tile { background: var(--motif) center / 100% 100% no-repeat, var(--glaze);
  box-shadow: inset 0 0 0 calc(var(--u) * .14) rgba(255,255,255,.22), inset calc(var(--u) * .22) calc(var(--u) * .3) calc(var(--u) * .16) rgba(255,255,255,.5),
    inset calc(var(--u) * -.28) calc(var(--u) * -.42) calc(var(--u) * .5) rgba(0,0,0,.45), 0 calc(var(--u) * .22) 0 rgba(0,0,0,.32), 0 calc(var(--u) * .55) calc(var(--u) * .9) rgba(0,0,0,.48); }
.mosaic-tile::before { content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
  background: linear-gradient(135deg, rgba(255,255,255,.34) 0%, rgba(255,255,255,0) 36%, rgba(0,0,0,0) 64%, rgba(0,0,0,.24) 100%); }
.mosaic-tile::after { content: ''; position: absolute; left: 9%; top: 6%; width: 50%; height: 28%; border-radius: 50%; pointer-events: none;
  background: radial-gradient(ellipse at 45% 45%, rgba(255,255,255,.92), rgba(255,255,255,.18) 58%, rgba(255,255,255,0) 72%); transform: rotate(-16deg); opacity: .75; }
.mosaic-tilt { transform: rotate(var(--rot, 0deg)); }
${GLAZES.map((gz, k) => `.mosaic-c${k} { --glaze: ${gz}; --motif: ${svgURL(MOTIFS[k])}; }`).join('\n')}
.mosaic-c3.mosaic-tile::after { opacity: .5; }
.mosaic-lift { animation: mosaicLift .32s cubic-bezier(.3,1.5,.5,1) forwards; z-index: 4; }
@keyframes mosaicLift { to { transform: translateY(-15%) scale(1.12) rotate(var(--rot, 0deg)); filter: drop-shadow(0 0 calc(var(--u) * .9) rgba(255,220,110,.95)) brightness(1.08); } }
.mosaic-dim { opacity: .6; filter: saturate(.7) brightness(.9); }
.mosaic-glint { animation: mosaicGlint 1.1s .44s ease-out both; }
@keyframes mosaicGlint { 0% { filter: brightness(1); } 22% { filter: brightness(1.85) drop-shadow(0 0 calc(var(--u) * 1.3) rgba(255,230,140,.95)); transform: scale(1.16); } 100% { filter: brightness(1); transform: scale(1); } }
.mosaic-marker { display: grid; place-items: center; background: radial-gradient(circle at 32% 26%, #fffef6, #f3e7c8 48%, #cdb47c 100%);
  box-shadow: inset calc(var(--u) * .22) calc(var(--u) * .3) calc(var(--u) * .16) rgba(255,255,255,.8), inset calc(var(--u) * -.28) calc(var(--u) * -.42) calc(var(--u) * .5) rgba(110,80,30,.45),
    0 calc(var(--u) * .22) 0 rgba(0,0,0,.3), 0 calc(var(--u) * .55) calc(var(--u) * .9) rgba(0,0,0,.45); }
.mosaic-marker::before { content: ''; position: absolute; inset: 13%; border-radius: 50%; border: calc(var(--u) * .3) solid #c99a3a; box-shadow: inset 0 0 0 calc(var(--u) * .18) rgba(255,255,255,.7); }
.mosaic-marker span { position: relative; font-family: var(--font-display); font-weight: 700; font-size: calc(var(--u) * 4.4); line-height: 1; color: #9a6a14; text-shadow: 0 1px 0 #fff6d8, 0 -1px 0 rgba(90,55,10,.45); }

/* centre pool: a moonlit fountain basin with a marble rim */
.mosaic-pool { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); border-radius: 50%;
  background:
    radial-gradient(22% 12% at 64% 28%, rgba(230, 238, 255, .3), transparent 100%),
    radial-gradient(circle at 50% 50%, rgba(0, 0, 0, 0) 0 64%, rgba(200, 220, 255, .3) 65.5%, rgba(0, 0, 0, 0) 67.5%),
    radial-gradient(circle at 40% 32%, #3f5cab 0%, #2b418c 40%, #1e2f6d 78%, #16245a 100%);
  box-shadow: 0 1.2cqw 2.2cqw rgba(0, 4, 24, .55), 0 0 0 .8cqw #e2e8f6, 0 0 0 1.15cqw #95a3c9, 0 0 0 1.4cqw rgba(255, 255, 255, .3),
    inset 0 1cqw 2.4cqw rgba(0, 0, 20, .55), inset 0 -.3cqw .6cqw rgba(180, 200, 255, .25); }
.mosaic-pool::before { content: ''; position: absolute; inset: 9%; background: ${ENGRAVE} center / contain no-repeat; pointer-events: none; }
.mosaic-pool::after { content: ''; position: absolute; inset: -2.2cqw; border-radius: 50%; pointer-events: none; opacity: 0; }
.mosaic-pool.mosaic-can { box-shadow: 0 1.2cqw 2.2cqw rgba(0, 4, 24, .55), 0 0 0 .8cqw #e2e8f6, 0 0 0 1.15cqw #95a3c9, 0 0 0 1.7cqw rgba(255, 215, 106, .85),
    inset 0 1cqw 2.4cqw rgba(0, 0, 20, .55), inset 0 -.3cqw .6cqw rgba(180, 200, 255, .25); }
.mosaic-pool.mosaic-can::after { opacity: 1; box-shadow: 0 0 3.4cqw 1cqw rgba(255, 206, 84, .45); animation: mosaicBreathe 2.6s ease-in-out infinite; }
.mosaic-pool:has(> button.mosaic-hit:active) { transform: translate(-50%, -50%) scale(.985); }
.mosaic-cnt { position: absolute; z-index: 9; font-family: var(--font-display); font-weight: 700; font-size: 2.5cqw; line-height: 1; padding: .45cqw .9cqw; border-radius: 99px;
  color: #fff; background: linear-gradient(180deg, #2c3c7c, #141d45); border: .25cqw solid rgba(255, 215, 106, .8); box-shadow: 0 .3cqw .6cqw rgba(0, 0, 0, .5); pointer-events: none; }
.mosaic-poolcap { position: absolute; left: 50%; bottom: 13%; transform: translateX(-50%); font-family: var(--font-display); font-size: 2.2cqw; letter-spacing: .14em;
  color: rgba(210, 225, 255, .55); text-transform: uppercase; pointer-events: none; white-space: nowrap; }

/* corners: round, bag, lid */
.mosaic-corner { position: absolute; width: 12cqw; height: 12cqw; }
.mosaic-roundb { left: 1.5%; top: 1.5%; border-radius: 50%; display: grid; place-content: center; text-align: center; color: #4a2c06;
  background: radial-gradient(circle at 35% 30%, #fff3c4, #e8b74e 45%, #b07a1e 80%, #7a5010);
  box-shadow: 0 .8cqw 1.4cqw rgba(0, 0, 0, .5), inset 0 .3cqw .2cqw rgba(255, 255, 255, .6), inset 0 -.4cqw .6cqw rgba(90, 50, 0, .45), 0 0 0 .3cqw #1c2853, 0 0 0 .6cqw rgba(255, 215, 106, .45); }
.mosaic-roundb small { display: block; font-size: 1.7cqw; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; line-height: 1; }
.mosaic-roundb b { display: block; font-family: var(--font-display); font-weight: 700; font-size: 5cqw; line-height: 1; }
.mosaic-bag { right: 1.5%; top: 1.5%; }
.mosaic-bag svg { width: 100%; height: 100%; filter: drop-shadow(0 .8cqw .7cqw rgba(0, 0, 0, .5)); }
.mosaic-lid { right: 1.5%; bottom: 1.5%; border-radius: 1.8cqw; background: linear-gradient(160deg, #3c4f94, #25336e 70%, #1b2656);
  box-shadow: 0 .8cqw 1.4cqw rgba(0, 0, 0, .55), 0 0 0 .25cqw rgba(255, 207, 92, .6), inset 0 .25cqw 0 rgba(200, 215, 255, .35), inset 0 -.3cqw .4cqw rgba(0, 0, 0, .35); }
.mosaic-lidin { position: absolute; inset: 1.1cqw; border-radius: 1.1cqw; background: radial-gradient(circle at 50% 40%, #1a2452, #0e1533); box-shadow: inset 0 .6cqw 1cqw rgba(0, 0, 0, .75); }
.mosaic-lid .mosaic-tile { --u: .42cqw; }
.mosaic-cornum { position: absolute; left: 50%; bottom: -1.6cqw; transform: translateX(-50%); z-index: 2; font-family: var(--font-display); font-weight: 700; font-size: 2.4cqw; line-height: 1;
  padding: .5cqw 1cqw; border-radius: 99px; color: #fff; background: linear-gradient(180deg, #2c3c7c, #141d45); border: .22cqw solid rgba(255, 215, 106, .8); white-space: nowrap; }
.mosaic-cornum i { font-style: normal; font-family: var(--font-body); font-size: 1.8cqw; letter-spacing: .06em; text-transform: uppercase; opacity: .75; margin-right: .5cqw; }

/* player boards: moonlit marble with cobalt inlay */
.mosaic-bwrap { container-type: inline-size; width: 100%; position: relative; }
.mosaic-board { --sh: inset 0 .35cqw .25cqw rgba(255,255,255,.9), inset 0 -.7cqw 1.2cqw rgba(60,80,140,.28), inset 0 0 0 .5cqw #8f9cc6, inset 0 0 0 .78cqw #f5f7fd,
    inset 0 0 0 1.05cqw rgba(60,80,150,.35), 0 1.4cqw 2.4cqw rgba(0,4,24,.5), 0 .45cqw 0 #56638f;
  position: relative; padding: 2.4cqw 2.9cqw 3cqw; border-radius: 3.4cqw; color: #26346a; background-color: #e6eaf4;
  background-image: var(--grain), radial-gradient(ellipse at 28% 0%, #ffffff 0%, #eef1f9 40%, #dbe1ef 80%, #c8d0e4 100%);
  background-blend-mode: multiply, normal; box-shadow: var(--sh); transition: box-shadow .4s; }
.mosaic-board::before { content: ''; position: absolute; inset: 1.7cqw; border-radius: 2.3cqw; border: .22cqw solid rgba(60, 85, 160, .22); pointer-events: none; }
.mosaic-board.mosaic-turn { box-shadow: var(--sh), 0 0 0 .55cqw rgba(255, 207, 92, .95), 0 0 3.6cqw rgba(255, 207, 92, .55); }
.mosaic-bhead { display: flex; align-items: center; gap: 2.2cqw; min-height: 9cqw; margin: 0 .3cqw 1.8cqw; position: relative; padding-bottom: 1.4cqw;
  background: ${FRIEZE} left bottom / 4.8cqw 2.4cqw repeat-x; }
.mosaic-face { width: 8.6cqw; height: 8.6cqw; flex: none; border-radius: 50%; box-shadow: 0 0 0 .5cqw var(--pc, #fff), 0 .4cqw 1cqw rgba(20, 30, 70, .35); }
.mosaic-face .portrait { width: 100%; height: 100%; display: block; border-radius: 50%; }
.mosaic-mini .mosaic-face { width: 10.5cqw; height: 10.5cqw; box-shadow: 0 0 0 .7cqw var(--pc, #fff), 0 .4cqw 1cqw rgba(20, 30, 70, .35); }
.mosaic-bname { flex: 1; font-family: var(--font-display); font-weight: 700; font-size: 4.4cqw; line-height: 1.1; color: #22306a; min-width: 0;
  text-shadow: 0 .2cqw 0 rgba(255, 255, 255, .85); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.mosaic-bname small { display: block; font-family: var(--font-body); font-size: 2.5cqw; font-weight: 800; color: #6774a3; letter-spacing: .12em; text-transform: uppercase; line-height: 1.2; }
.mosaic-score { display: inline-flex; align-items: center; gap: .8cqw; padding: .9cqw 2.6cqw .9cqw 1.5cqw; border-radius: 99px; flex: none;
  background: linear-gradient(180deg, #2f4082, #19234f); box-shadow: inset 0 .3cqw 0 rgba(200, 215, 255, .28), inset 0 -.3cqw .5cqw rgba(0, 0, 0, .4), 0 .4cqw .8cqw rgba(20, 30, 70, .35), 0 0 0 .3cqw #c9a24a; }
.mosaic-score.mosaic-scored { animation: mosaicScoredPill 1.2s ease-out .45s; }
@keyframes mosaicScoredPill { 20% { box-shadow: inset 0 .3cqw 0 rgba(200, 215, 255, .28), 0 0 0 .3cqw #ffe9a0, 0 0 4cqw 1.2cqw rgba(255, 214, 90, .7); } }
.mosaic-score svg { width: 5.6cqw; height: 5.6cqw; display: block; }
.mosaic-score b { display: inline-block; font-family: var(--font-display); font-weight: 700; font-size: 5.4cqw; line-height: 1; color: #ffd76a; text-shadow: 0 .25cqw 0 rgba(0, 0, 0, .6); min-width: 2ch; text-align: center; }
.mosaic-bbody { display: grid; grid-template-columns: repeat(5, var(--mz-cell)) 5.2cqw repeat(5, var(--mz-cell)); grid-template-rows: repeat(5, var(--mz-cell)); gap: var(--mz-gap); position: relative; }
.mosaic-line { grid-column: 1 / 6; display: flex; flex-direction: row-reverse; gap: var(--mz-gap); position: relative; border-radius: 1.4cqw; }
.mosaic-slot, .mosaic-cell, .mosaic-fslot { position: relative; width: var(--mz-cell); height: var(--mz-cell); flex: none; border-radius: 1.5cqw; }
.mosaic-slot > .mosaic-tk, .mosaic-cell > .mosaic-tk, .mosaic-fslot > .mosaic-tk { inset: 4%; }
.mosaic-line[data-dest]::before { content: ''; position: absolute; top: -.45cqw; bottom: -.45cqw; left: 0; right: -.4cqw; }
.mosaic-slot { background: linear-gradient(145deg, #a4afcc, #c5cde2); box-shadow: inset .35cqw .45cqw .7cqw rgba(30, 45, 100, .5), inset -.2cqw -.25cqw .3cqw rgba(255, 255, 255, .65); }
/* Lines (and the floor) that can take the lifted tiles: a crisp gold rim, a soft breathing halo, a dip when pressed. */
.mosaic-line.mosaic-legal, .mosaic-floor.mosaic-legal { cursor: pointer; transition: transform .12s var(--ease); }
.mosaic-line.mosaic-legal:active, .mosaic-floor.mosaic-legal:active { transform: scale(.98); }
.mosaic-line.mosaic-legal::after, .mosaic-floor.mosaic-legal::after { content: ''; position: absolute; pointer-events: none; border-radius: 1.9cqw;
  background: rgba(255, 214, 102, .2); box-shadow: 0 0 0 .32cqw rgba(255, 206, 84, .95); }
.mosaic-line.mosaic-legal::after, .mosaic-line > .mosaic-halo { top: -.5cqw; bottom: -.5cqw; right: -.5cqw; width: calc(var(--w) + 1cqw); }
.mosaic-floor.mosaic-legal::after, .mosaic-floor > .mosaic-halo { inset: 0; }
.mosaic-halo { position: absolute; pointer-events: none; border-radius: 1.9cqw; box-shadow: 0 0 2.8cqw .6cqw rgba(255, 206, 84, .7); animation: mosaicBreathe 2.6s ease-in-out infinite; }
.mosaic-tile.mosaic-ghost { opacity: .4; box-shadow: none; filter: saturate(.8); outline: .28cqw dashed rgba(30, 48, 120, .85); outline-offset: -.28cqw; animation: mosaicGhostT 2.2s ease-in-out infinite; }
.mosaic-tile.mosaic-ghost::after { display: none; }
@keyframes mosaicGhostT { 50% { opacity: .58; } }
@keyframes mosaicGhost { 50% { opacity: .78; } }
.mosaic-over { position: absolute; right: calc(var(--w) + 1.4cqw); top: 50%; transform: translateY(-50%); white-space: nowrap; font-size: 2.5cqw; font-weight: 800; line-height: 1;
  color: #fff; background: linear-gradient(180deg, #e0566c, #a82e44); border-radius: 99px; padding: .6cqw 1.1cqw; box-shadow: 0 .25cqw .5cqw rgba(0, 0, 0, .4); }
.mosaic-arrow { grid-column: 6; display: grid; place-items: center; }
.mosaic-arrow svg { width: 3.4cqw; height: 3.4cqw; opacity: .38; }
.mosaic-arrow.mosaic-ready svg { opacity: 1; filter: drop-shadow(0 0 .7cqw rgba(255, 190, 60, .95)); }
.mosaic-arrow.mosaic-ready path { stroke: #d08a10; }
.mosaic-wall { grid-column: 7 / 12; grid-row: 1 / 6; display: grid; grid-template-columns: repeat(5, var(--mz-cell)); grid-template-rows: repeat(5, var(--mz-cell)); gap: var(--mz-gap); position: relative; }
.mosaic-wall::before { content: ''; position: absolute; inset: -1cqw; border-radius: 2cqw; background: linear-gradient(145deg, rgba(60, 80, 150, .22), rgba(255, 255, 255, .3));
  box-shadow: inset .3cqw .4cqw .6cqw rgba(40, 55, 110, .35), 0 .2cqw 0 rgba(255, 255, 255, .7); }
.mosaic-cell { background: linear-gradient(145deg, #b7c1da, #d5dbeb); box-shadow: inset .3cqw .4cqw .6cqw rgba(35, 50, 100, .45), inset -.2cqw -.2cqw .3cqw rgba(255, 255, 255, .65); }
.mosaic-hint { position: absolute; inset: 9%; border-radius: 1.2cqw; background: var(--motif) center / 100% 100% no-repeat, var(--glaze); opacity: .34; filter: saturate(.55) brightness(1.04); }
.mosaic-cell.mosaic-target { box-shadow: inset .3cqw .4cqw .6cqw rgba(35, 50, 100, .45), 0 0 0 .3cqw rgba(255, 206, 84, .95), 0 0 2cqw rgba(255, 206, 84, .75); }
.mosaic-cell.mosaic-target .mosaic-hint { opacity: .8; filter: none; animation: mosaicGhost 2.2s ease-in-out infinite; }
.mosaic-floorrow { display: flex; align-items: center; justify-content: space-between; gap: 2cqw; margin-top: 2.8cqw; }
.mosaic-floor { display: flex; gap: var(--mz-gap); padding: .9cqw; margin: -.9cqw; border-radius: 2cqw; position: relative;
  background: rgba(170, 60, 90, .1); box-shadow: inset .25cqw .35cqw .6cqw rgba(90, 30, 60, .28), 0 .15cqw 0 rgba(255, 255, 255, .6); }
.mosaic-fslot { background: linear-gradient(145deg, #b3a8c6, #d2c9de); box-shadow: inset .35cqw .45cqw .7cqw rgba(70, 30, 70, .45), inset -.2cqw -.25cqw .3cqw rgba(255, 255, 255, .55); display: grid; place-items: center; }
.mosaic-fslot > span { font-family: var(--font-display); font-weight: 700; font-size: 2.9cqw; color: rgba(150, 30, 60, .7); text-shadow: 0 .15cqw 0 rgba(255, 255, 255, .55); }
.mosaic-flabel { display: flex; flex-direction: column; align-items: flex-end; line-height: 1.05; font-size: 2.5cqw; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: #5d6a99; }
.mosaic-flabel b { font-family: var(--font-display); font-weight: 700; font-size: 5cqw; letter-spacing: 0; color: #c0392b; text-shadow: 0 .2cqw 0 rgba(255, 255, 255, .7); }
.mosaic-flabel b.mosaic-zero { color: #8a93b4; opacity: .8; }
.mosaic-drop { margin-bottom: .8cqw; padding: .5cqw 1.1cqw; border-radius: 99px; font-size: 2.3cqw; letter-spacing: .02em; text-transform: none; white-space: nowrap;
  color: #fff; background: linear-gradient(180deg, #e0566c, #a82e44); box-shadow: 0 .25cqw .5cqw rgba(0, 0, 0, .35); }
.mosaic-mini .mosaic-bname { font-size: 5cqw; }
.mosaic-mini .mosaic-bhead { cursor: pointer; }
.mosaic-mini.mosaic-collapsed .mosaic-bhead { margin-bottom: 0; }
.mosaic-chev { display: inline-block; vertical-align: middle; width: 3.6cqw; height: 3.6cqw; margin-left: 1.2cqw; color: #6774a3; transition: transform .2s; }
.mosaic-chev .ic { display: block; width: 100%; height: 100%; }
.mosaic-collapsed .mosaic-chev { transform: rotate(-90deg); }

/* side */
.mosaic-opps h3 { margin: 0 0 12px; display: flex; align-items: center; gap: 7px; font-family: var(--font-body); font-weight: 800; color: var(--muted); font-size: .74rem; letter-spacing: .12em; text-transform: uppercase; }
.mosaic-opps h3 .ic { width: 16px; height: 16px; color: var(--brand-2); }
.mosaic-opps .mosaic-list { display: flex; flex-direction: column; gap: 14px; align-items: center; }
.mosaic-opps .mosaic-bwrap { max-width: 290px; }
.mosaic-results h3 { margin: 0 0 10px; display: flex; align-items: center; gap: 8px; color: var(--gold); font-size: 1.05rem; }
.mosaic-results h3 .ic { width: 20px; height: 20px; }
.mosaic-results table { width: 100%; border-collapse: collapse; font-size: .86rem; }
.mosaic-results th { font-size: .7rem; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); font-weight: 800; padding: 4px; }
.mosaic-results td { padding: 6px 4px; text-align: center; border-top: 1px solid var(--line); }
.mosaic-results td:first-child, .mosaic-results th:first-child { text-align: left; }
.mosaic-results tr.mosaic-win td { color: var(--gold); font-weight: 800; }
.mosaic-results td b { font-family: var(--font-display); font-weight: 700; font-size: 1.05rem; }
.mosaic-rp { display: inline-flex; align-items: center; gap: 7px; max-width: 100%; }
.mosaic-rp > span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.mosaic-results .mosaic-face { width: 24px; height: 24px; box-shadow: 0 0 0 2px var(--pc, #fff); }
.mosaic-rp .ic { width: 14px; height: 14px; flex: none; color: var(--gold); }
/* drawers: chronicle and rules */
.mosaic-chron > summary > span:not(.note), .mosaic-rules > summary > span { white-space: nowrap; }
.mosaic-chron > summary .note { min-width: 0; max-width: 58%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mosaic-chron[open] > summary .note { visibility: hidden; }
.mosaic-chron .log { max-height: 220px; color: var(--muted); }
.mosaic-chron .log div { border-bottom-color: var(--line); }
.mosaic-chron .log div:first-child { color: var(--text); }
.mosaic-rules ul { margin: 0; padding-left: 18px; color: var(--muted); font-size: .88rem; }
.mosaic-rules li { margin: 4px 0; }
.mosaic-rules b { color: var(--text); }

@media (max-width: 480px) {
  .mosaic-felt.felt { padding: 6px; }
  .mosaic-bar { padding: 8px; margin-bottom: 8px; border-radius: 13px; }
  .mosaic-chip { font-size: .78rem; padding-right: 9px; gap: 5px; }
  .mosaic-ava { width: 24px; height: 24px; }
  .mosaic-cn { max-width: 6.5em; }
  .mosaic-stage-in { gap: 10px; }
}
`;

/* =====================================================================
   Presenter: draws views and replays the wall tiling as a sequence
   ===================================================================== */

const GEO = { 5: { fs: 27, R: 36.5, pool: 41 }, 7: { fs: 25, R: 37.3, pool: 45 }, 9: { fs: 23.2, R: 38.2, pool: 48 } };
const FPOS = [[14, 14], [52, 14], [14, 52], [52, 52]];
const PT = 7.2; // pool tile size (cqw)
const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const UI = {
  el: null, ctx: null, gid: null,
  real: null, // newest real view that has been presented
  frame: null, // what is on screen: { v, fx, raise, fresh }
  queue: [], busy: false, timers: [],
  tseq: 0, eseq: 0, keys: new Set(), sel: null, collapsed: {}, draws: 0,
};
// Side drawers: the chronicle folds away on phones so the table gets the screen; both stay as the player left them.
let chronOpen = typeof matchMedia === 'function' ? matchMedia('(min-width: 901px)').matches : true;
let rulesOpen = false;
let prevScores = new Map(); // game id + player id -> score at the last draw, for the "scored" flash

const isBotId = (id) => !!(UI.ctx && typeof UI.ctx.isBot === 'function' && UI.ctx.isBot(id));
const seatColor = (seat) => PLAYER_COLORS[seat % PLAYER_COLORS.length];
const faceHTML = (v, seat, cls = 'mosaic-face') => `<span class="${cls}" style="--pc:${seatColor(seat)}">${portrait({ id: v.players[seat].id, bot: isBotId(v.players[seat].id) })}</span>`;
const scoredNow = (v, seat) => {
  const had = prevScores.get(v.gid + '|' + v.players[seat].id);
  return had != null && v.boards[seat].score > had;
};

const later = (ms, fn) => UI.timers.push(setTimeout(fn, ms));
const alive = () => !!UI.el && UI.el.isConnected;
const fxLater = (ms, fn) => later(ms, () => alive() && fn()); // effects only while the game is on screen
const q = (name) => (alive() ? UI.el.querySelector(`[data-a="${CSS.escape(name)}"]`) : null);
const rectQ = (name) => q(name)?.getBoundingClientRect() || null;
const rot = (t) => (((t * 47) % 13) - 6) * 0.9; // gentle, stable tilt per tile

function tileDiv(t, cls = '', tilted = false) {
  if (t === MARKER) return `<div class="mosaic-marker ${cls}" title="First-player tile"><span>1</span></div>`;
  return `<div class="mosaic-tile mosaic-c${colorOf(t)}${tilted ? ' mosaic-tilt' : ''}${cls ? ' ' + cls : ''}"${tilted ? ` style="--rot:${rot(t)}deg"` : ''}></div>`;
}
function tk(t, { style = '', inner = '', noenter = false, tilted = false } = {}) {
  const key = t === MARKER ? 'marker' : 't' + t;
  return `<div class="mosaic-tk" data-k="${key}"${noenter ? ' data-noenter' : ''}${style ? ` style="${style}"` : ''}>${tileDiv(t, inner, tilted)}</div>`;
}

/* ---------- table: coasters, centre pool, bag, lid ---------- */
function tableHTML(v, o) {
  const nf = v.factories.length;
  const g = GEO[nf] || GEO[9];
  let h = `<div class="mosaic-table${o.raise ? ' mosaic-raise' : ''}">`;
  h += `<div class="mosaic-medal"></div><div class="mosaic-ring" style="width:${2 * g.R}cqw;height:${2 * g.R}cqw"></div>`;
  h += `<div class="mosaic-corner mosaic-roundb" title="Round"><small>Round</small><b>${v.round}</b></div>`;
  h += `<div class="mosaic-corner mosaic-bag" data-a="mosaic-bag" title="Tiles left in the bag">${BAG}<b class="mosaic-cornum"><i>bag</i>${v.bag}</b></div>`;
  const lidShow = v.lid.slice(-8);
  h += `<div class="mosaic-corner mosaic-lid" data-a="mosaic-lid" title="Discarded tiles (box lid)"><div class="mosaic-lidin">${lidShow
    .map((t) => tk(t, { style: `left:${6 + ((t * 37) % 46)}%;top:${6 + ((t * 53) % 44)}%;width:42%;height:42%`, tilted: true }))
    .join('')}</div><b class="mosaic-cornum"><i>lid</i>${v.lid.length}</b></div>`;

  const P = g.pool;
  const groups = [[], [], [], [], []];
  let hasMarker = false;
  for (const t of v.centre) if (t === MARKER) hasMarker = true; else groups[colorOf(t)].push(t);
  const poolCan = o.myTurn && groups.some((x) => x.length);
  h += `<div class="mosaic-pool${poolCan && !o.sel ? ' mosaic-can' : ''}" data-a="mosaic-centre" style="width:${P}cqw;height:${P}cqw">`;
  if (!v.centre.length) h += '<span class="mosaic-poolcap">Centre</span>';
  groups.forEach((ts, k) => {
    if (!ts.length) return;
    const a = ((-90 + 72 * k) * Math.PI) / 180;
    const gx = 50 + 29 * Math.cos(a), gy = 50 + 29 * Math.sin(a);
    const m = Math.min(ts.length, 6);
    const lift = o.sel && o.sel.src === 'c' && o.sel.color === k;
    ts.forEach((t, i) => {
      const off = (Math.min(i, m - 1) - (m - 1) / 2) * 0.75;
      h += tk(t, {
        style: `left:calc(${gx.toFixed(2)}% + ${(off - PT / 2).toFixed(2)}cqw);top:calc(${gy.toFixed(2)}% - ${(off + PT / 2).toFixed(2)}cqw);width:${PT}cqw;height:${PT}cqw;z-index:${i + 1}`,
        inner: lift ? 'mosaic-lift' : '', tilted: true,
      });
    });
    if (ts.length > 1) h += `<span class="mosaic-cnt" style="left:calc(${gx.toFixed(2)}% + ${(PT / 2 - 1).toFixed(2)}cqw);top:calc(${gy.toFixed(2)}% + ${(PT / 2 - 2.6).toFixed(2)}cqw)">×${ts.length}</span>`;
    if (o.myTurn) h += `<button class="mosaic-hit" data-pick="c:${k}" aria-label="Take ${NAMES[k]} from the centre" style="left:calc(${gx.toFixed(2)}% - 7cqw);top:calc(${gy.toFixed(2)}% - 7cqw);width:14cqw;height:14cqw"></button>`;
  });
  if (hasMarker) h += tk(MARKER, { style: `left:calc(50% - ${PT / 2}cqw);top:calc(50% - ${PT / 2}cqw);width:${PT}cqw;height:${PT}cqw` });
  h += '</div>';

  v.factories.forEach((f, i) => {
    const a = ((-90 + (i * 360) / nf) * Math.PI) / 180;
    const x = 50 + g.R * Math.cos(a), y = 50 + g.R * Math.sin(a);
    const selHere = o.sel && o.sel.src === i;
    const can = o.myTurn && f.length > 0;
    h += `<div class="mosaic-fac${f.length ? '' : ' mosaic-empty'}${can && !o.sel ? ' mosaic-can' : ''}${selHere ? ' mosaic-selsrc' : ''}" data-a="mosaic-f-${i}" style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%;width:${g.fs}cqw;height:${g.fs}cqw">`;
    h += '<div class="mosaic-coaster"></div>';
    f.forEach((t, j) => {
      const lift = selHere && colorOf(t) === o.sel.color;
      h += tk(t, { style: `left:${FPOS[j][0]}%;top:${FPOS[j][1]}%;width:34%;height:34%`, inner: lift ? 'mosaic-lift' : selHere ? 'mosaic-dim' : '', noenter: true, tilted: true });
      if (can) h += `<button class="mosaic-hit" data-pick="${i}:${colorOf(t)}" aria-label="Take ${NAMES[colorOf(t)]} from coaster ${i + 1}" style="left:${(j % 2) * 50}%;top:${(j >> 1) * 50}%"></button>`;
    });
    h += `<span class="mosaic-num">${i + 1}</span></div>`;
  });
  return h + '</div>';
}

/* ---------- a player's palace board ---------- */
function boardHTML(v, seat, o) {
  const b = v.boards[seat], p = v.players[seat], P = esc(p.id);
  const sel = o.sel;
  let h = `<div class="mosaic-bwrap${o.raise ? ' mosaic-raise' : ''}"><section class="mosaic-board${o.big ? '' : ' mosaic-mini'}${o.turn ? ' mosaic-turn' : ''}${o.collapsed ? ' mosaic-collapsed' : ''}">`;
  h += `<header class="mosaic-bhead"${o.big ? '' : ` data-toggle="${P}" role="button" aria-label="Show or hide this board"`}>${faceHTML(v, seat)}
    <div class="mosaic-bname"><small>${o.self ? 'Your palace' : 'Palace of'}${o.big ? '' : `<span class="mosaic-chev">${icon('chevron')}</span>`}</small>${esc(p.name)}</div>
    <div class="mosaic-score${scoredNow(v, seat) ? ' mosaic-scored' : ''}" title="Score">${LAUREL}<b data-a="p-${P}-score">${b.score}</b></div></header>`;
  if (o.collapsed) return h + '</section></div>';
  h += '<div class="mosaic-bbody">';
  for (let r = 0; r < 5; r++) {
    const line = b.lines[r];
    const legal = sel && o.legal[r];
    const w = `calc(${r + 1} * var(--mz-cell) + ${r} * var(--mz-gap))`;
    h += `<div class="mosaic-line${legal ? ' mosaic-legal' : ''}" style="grid-row:${r + 1};--w:${w}"${legal ? ` data-dest="${r}" role="button" aria-label="Place on pattern line ${r + 1}"` : ''}>`;
    if (legal) h += '<i class="mosaic-halo" aria-hidden="true"></i>';
    let ghosts = legal ? Math.min(sel.n, r + 1 - line.length) : 0;
    for (let i = 0; i <= r; i++) {
      h += '<div class="mosaic-slot">';
      if (i < line.length) h += tk(line[i]);
      else if (ghosts > 0) { h += `<div class="mosaic-tile mosaic-c${sel.color} mosaic-ghost"></div>`; ghosts--; }
      h += '</div>';
    }
    if (legal) {
      const over = sel.n - Math.min(sel.n, r + 1 - line.length);
      if (over > 0) h += `<span class="mosaic-over" title="Falls to the floor">+${over} ▾</span>`;
    }
    h += `</div><div class="mosaic-arrow${line.length === r + 1 ? ' mosaic-ready' : ''}" style="grid-row:${r + 1}">${CHEV}</div>`;
  }
  h += '<div class="mosaic-wall">';
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const t = b.wall[r][c];
      const target = sel && o.legal[r] && wallCol(r, sel.color) === c;
      h += `<div class="mosaic-cell${target ? ' mosaic-target' : ''}" data-a="mosaic-w-${P}-${r}-${c}">${
        t !== null ? tk(t, { inner: o.fresh && o.fresh.has(t) ? 'mosaic-glint' : '' }) : `<div class="mosaic-hint mosaic-c${wallColor(r, c)}"></div>`}</div>`;
    }
  }
  h += '</div></div>';
  const pen = floorPenalty(b.floor.length);
  h += `<div class="mosaic-floorrow"><div class="mosaic-floor${sel ? ' mosaic-legal' : ''}" data-a="mosaic-floor-${P}"${sel ? ' data-dest="-1" role="button" aria-label="Drop the tiles on the floor"' : ''}>`;
  if (sel) h += '<i class="mosaic-halo" aria-hidden="true"></i>';
  for (let i = 0; i < 7; i++) h += `<div class="mosaic-fslot"><span>−${PEN[i]}</span>${i < b.floor.length ? tk(b.floor[i]) : ''}</div>`;
  const dropAll = sel ? floorPenalty(b.floor.length + sel.n + (sel.marker ? 1 : 0)) - pen : 0;
  h += `</div><div class="mosaic-flabel">${sel ? `<span class="mosaic-drop">all here −${dropAll}</span>` : ''}Floor<b${pen ? '' : ' class="mosaic-zero"'}>${pen ? '−' + pen : '0'}</b></div></div>`;
  return h + '</section></div>';
}

/* ---------- status bar, side column ---------- */
function barHTML(v, me, o) {
  const chips = v.players.map((p, i) => {
    const on = !v.over && v.phase === 'draft' && v.cur === i;
    const holds = v.boards[i].floor.includes(MARKER);
    return `<div class="mosaic-chip${on ? ' mosaic-on' : ''}${i === me ? ' mosaic-me' : ''}${scoredNow(v, i) ? ' mosaic-scored' : ''}">${faceHTML(v, i, 'mosaic-ava')}<span class="mosaic-cn">${esc(p.name)}${i === me ? ' (you)' : ''}</span>${holds ? '<span class="mosaic-fp" title="Has the first-player tile">1</span>' : ''}<b>${v.boards[i].score}</b></div>`;
  }).join('');
  let line;
  if (v.over) {
    const names = (v.winners || []).map((id) => v.players.find((p) => p.id === id)?.name || '?');
    line = `<div class="winner-banner">${icon('trophy')} ${esc(names.join(' & '))} ${names.length > 1 ? 'share the victory' : 'wins'}!</div>`;
  } else if (v.phase === 'tiling') {
    line = `<span class="status"><span class="mosaic-spark">${icon('sparkle')}</span> Tiling the walls</span><span class="mosaic-hintx">Each full pattern line sends one tile to the wall and scores it; the rest go to the lid.</span>`;
  } else if (o.mineTurn) {
    let hint;
    if (!o.myTurn) hint = 'Get ready…';
    else if (o.sel) {
      const extra = o.sel.marker ? ' + the first-player tile (−1)' : '';
      hint = `<b>${o.sel.n} ${NAMES[o.sel.color]}</b>${extra} selected — tap a glowing pattern line, or the floor.`;
    } else hint = 'Tap a colour on a coaster or in the centre. You take <b>every</b> tile of that colour.';
    line = `<span class="status myturn">Your turn</span><span class="mosaic-hintx">${hint}</span>${o.sel ? `<button class="small" data-cancel>${icon('close')}Cancel</button>` : ''}`;
  } else {
    const p = v.players[v.cur];
    const bot = UI.ctx?.isBot?.(p?.id);
    line = `<span class="status">${esc(p?.name || '')}'s turn</span><span class="mosaic-hintx">${bot ? 'Studying the coasters…' : 'Waiting for their move…'}</span>`;
  }
  return `<div class="mosaic-bar"><div class="mosaic-chips">${chips}</div><div class="mosaic-line2">${line}</div></div>`;
}

function resultsHTML(v) {
  const rows = v.final.slice().sort((a, b) => b.total - a.total || b.rows - a.rows);
  return `<div class="panel mosaic-results"><h3>${icon('trophy')}Final scores</h3><table><thead><tr><th>Player</th><th>Wall</th><th title="+2 per complete row">Rows</th><th title="+7 per complete column">Cols</th><th title="+10 per complete colour">Sets</th><th>Total</th></tr></thead><tbody>${rows
    .map((f) => {
      const p = v.players[f.p];
      const win = (v.winners || []).includes(p.id);
      const cell = (n, pts) => (n ? `+${n * pts}` : '–');
      return `<tr class="${win ? 'mosaic-win' : ''}"><td><span class="mosaic-rp">${faceHTML(v, f.p)}${win ? icon('crown') : ''}<span>${esc(p.name)}</span></span></td><td>${f.base}</td><td>${cell(f.rows, 2)}</td><td>${cell(f.cols, 7)}</td><td>${cell(f.colours, 10)}</td><td><b>${f.total}</b></td></tr>`;
    }).join('')}</tbody></table></div>`;
}

const RULES_LIST = `<ul>
  <li>On your turn take <b>all</b> tiles of one colour from a coaster (the rest slide to the centre) or from the centre.</li>
  <li>The first to take from the centre also takes the first-player tile (−1 on the floor) and starts next round.</li>
  <li>Place them on one pattern line: empty or the same colour, and not a colour already in that wall row. Extra tiles fall to the floor.</li>
  <li>When the table is empty, every full line sends one tile to the wall: 1 point alone, or the length of the connected row plus column.</li>
  <li>Floor tiles cost −1 −1 −2 −2 −2 −3 −3. The game ends after a round in which someone completes a wall row.</li>
  <li>Bonuses: +2 per row, +7 per column, +10 per colour with all 5 placed.</li></ul>`;

/* ---------- drawing ---------- */
function draw(before) {
  const el = UI.el, ctx = UI.ctx, fr = UI.frame;
  if (!el || !fr || !ctx) return;
  UI.draws++;
  const v = fr.v;
  const live = !UI.busy && v === UI.real;
  const n = v.players.length;
  const me = seatOf(v, ctx.me);
  const mine = me >= 0 ? me : 0;
  const mineTurn = me >= 0 && !v.over && v.phase === 'draft' && v.cur === me;
  const myTurn = live && mineTurn;

  let sel = null;
  if (myTurn && UI.sel) {
    const src = UI.sel.src === 'c' ? v.centre : v.factories[UI.sel.src];
    const cnt = src ? src.filter((t) => t !== MARKER && colorOf(t) === UI.sel.color).length : 0;
    if (cnt) sel = { src: UI.sel.src, color: UI.sel.color, n: cnt, marker: UI.sel.src === 'c' && v.centre.includes(MARKER) };
  }
  if (!sel && myTurn) UI.sel = null;
  const legal = sel ? [0, 1, 2, 3, 4].map((r) => !canPlace(v.boards[mine], r, sel.color)) : null;
  const raise = fr.raise || {};
  const raised = (s) => (raise.seats || []).includes(s);
  const turnSeat = !v.over && v.phase === 'draft' ? v.cur : -1;

  const others = [];
  for (let i = 1; i < n; i++) others.push((mine + i) % n);
  const oppBoards = others.map((s) => boardHTML(v, s, {
    big: false, self: false, turn: s === turnSeat, raise: raised(s), fresh: fr.fresh, collapsed: !!UI.collapsed[v.players[s].id],
  })).join('');

  el.innerHTML = `<div class="mosaic-root"><div class="game-layout">
    <div class="mosaic-main"><div class="felt mosaic-felt">
      ${barHTML(v, me, { myTurn, mineTurn, sel })}
      <div class="mosaic-stage${raise.table || raised(mine) ? ' mosaic-raise' : ''}"><div class="mosaic-stage-in">
        <div class="mosaic-tablewrap">${tableHTML(v, { myTurn, sel, raise: raise.table })}</div>
        <div class="mosaic-mine">${boardHTML(v, mine, { big: true, self: me >= 0, turn: mine === turnSeat, sel, legal, raise: raised(mine), fresh: fr.fresh })}</div>
      </div></div>
    </div></div>
    <div class="side">
      ${v.over && v.final ? resultsHTML(v) : ''}
      <div class="panel mosaic-opps"><h3>${icon('users')}Rival palaces</h3><div class="mosaic-list">${oppBoards}</div></div>
      <details class="panel drawer mosaic-chron" ${chronOpen ? 'open' : ''}><summary>${icon('book')}<span>Chronicle</span><span class="note">${esc(v.log?.[0] || '')}</span>${icon('chevron', 'chev')}</summary>
        <div class="drawer-body"><div class="log">${(v.log || []).map((m) => `<div>${esc(m)}</div>`).join('')}</div></div></details>
      <details class="panel drawer mosaic-rules" ${rulesOpen ? 'open' : ''}><summary>${icon('help')}<span>How to play</span>${icon('chevron', 'chev')}</summary>
        <div class="drawer-body">${RULES_LIST}</div></details>
    </div>
  </div></div>`;
  el.onclick = onClick;
  // <details> toggle events don't bubble, so listen on each drawer after it is drawn.
  el.querySelector('.mosaic-chron')?.addEventListener('toggle', (e) => { chronOpen = e.currentTarget.open; });
  el.querySelector('.mosaic-rules')?.addEventListener('toggle', (e) => { rulesOpen = e.currentTarget.open; });
  prevScores = new Map(v.players.map((p, i) => [v.gid + '|' + p.id, v.boards[i].score]));

  const now = new Set();
  el.querySelectorAll('[data-k]').forEach((e) => now.add(e.dataset.k));
  if (before) {
    flip(el, before);
    vanish(before, v, now);
  }
  entrance(UI.keys, now);
  UI.keys = now;
}

// Tiles that left the screen: back into the lid, or (when the lid was poured out) into the bag.
function vanish(before, v, now) {
  if (reduced) return;
  const lidSet = new Set(v.lid);
  const lid = rectQ('mosaic-lid'), bag = rectQ('mosaic-bag');
  for (const [key, b] of before) {
    if (!key.startsWith('k:t')) continue;
    const k = key.slice(2);
    if (now.has(k)) continue;
    const id = +k.slice(1);
    let to;
    if (lidSet.has(id)) {
      if (b.el.closest && b.el.closest('.mosaic-lid')) continue; // still in the lid, just under the pile
      to = lid;
    } else to = bag;
    if (!to || !b.rect.width) continue;
    fly(b.rect, to, b.el.innerHTML, { duration: 640, size: [b.rect.width, b.rect.height], arc: 34 });
  }
}

// Newly drawn coaster tiles fly out of the bag.
function entrance(prev, now) {
  const bag = rectQ('mosaic-bag');
  if (!bag || reduced) return;
  let i = 0;
  UI.el.querySelectorAll('.mosaic-fac [data-k]').forEach((el) => {
    if (prev.has(el.dataset.k)) return;
    const r = el.getBoundingClientRect();
    if (!r.width) return;
    const delay = 40 + i++ * 34;
    el.style.opacity = '0';
    fly(bag, r, el.innerHTML, { duration: 620, delay, size: [r.width, r.height], arc: 46 });
    setTimeout(() => { el.style.opacity = ''; }, delay + 560);
  });
}

/* ---------- effects ---------- */
function draftFx(v, ev) {
  const pid = v.players[ev.p].id;
  fxLater(470, () => sound('place'));
  if (ev.floorN > 0) fxLater(600, () => { shake(q(`mosaic-floor-${pid}`)); sound('bad'); });
}
function rowFx(V, r, items) {
  fxLater(420, () => sound('place'));
  fxLater(560, () => {
    let big = false;
    for (const it of items) {
      const pid = V.players[it.p].id;
      floatText(rectQ(`mosaic-w-${pid}-${r}-${it.c}`), '+' + it.g, '#ffd76a');
      pulse(q(`p-${pid}-score`));
      if (it.g >= 4) big = true;
    }
    sound(big ? 'chime' : 'gem');
  });
}
function floorFx(V, floor) {
  fxLater(120, () => {
    let any = false;
    for (const it of floor) {
      const pid = V.players[it.p].id;
      if (it.pen > 0) { floatText(rectQ(`mosaic-floor-${pid}`), '−' + it.pen, '#ff7a6b'); any = true; }
      shake(q(`mosaic-floor-${pid}`));
      pulse(q(`p-${pid}-score`));
    }
    sound(any ? 'bad' : 'place');
  });
}
function refillFx(V, T) {
  if (alive()) sound('shuffle');
  if (T.fromLid) fxLater(80, () => floatText(rectQ('mosaic-bag'), 'Refilled!', '#bfe9ff'));
  fxLater(420, () => sound('shuffle'));
}
function bonusFx(V) {
  if (!V.final) return;
  let any = false;
  V.final.forEach((f) => {
    const pid = V.players[f.p].id;
    const parts = [];
    if (f.rows) parts.push(`+${f.rows * 2} rows`);
    if (f.cols) parts.push(`+${f.cols * 7} columns`);
    if (f.colours) parts.push(`+${f.colours * 10} colours`);
    parts.forEach((t, j) => fxLater(250 + j * 520, () => { floatText(rectQ(`p-${pid}-score`), t, '#9ff3c0'); pulse(q(`p-${pid}-score`)); }));
    if (parts.length) any = true;
  });
  if (any) fxLater(250, () => sound('chime'));
}

/* ---------- sequencing ---------- */
function clearTimers() {
  UI.timers.forEach(clearTimeout);
  UI.timers = [];
}

function show(frame, platform) {
  const before = platform ? null : snapshot(UI.el);
  UI.frame = frame;
  draw(before);
  frame.fx?.();
}

// Rebuild the end-of-round sequence from state.tiling.
function buildFrames(V) {
  const T = V.tiling;
  const frames = [];
  let cur = {
    ...V, phase: 'tiling', cur: -1, over: false, final: null, round: T.round,
    factories: V.factories.map(() => []), centre: T.pre.centre.slice(), bag: T.pre.bag, lid: T.pre.lid.slice(), boards: clone(T.pre.boards),
  };
  frames.push({ v: cur, dur: 950 });
  const next = () => (cur = { ...cur, boards: clone(cur.boards), lid: cur.lid.slice(), centre: cur.centre.slice() });
  for (let r = 0; r < 5; r++) {
    const items = T.rows[r];
    if (!items.length) continue;
    next();
    for (const it of items) {
      const b = cur.boards[it.p];
      b.lines[r] = [];
      b.wall[r][it.c] = it.t;
      b.score = it.s;
      cur.lid.push(...it.d);
    }
    frames.push({ v: cur, dur: 820, raise: { table: true }, fresh: new Set(items.map((it) => it.t)), fx: () => rowFx(V, r, items) });
  }
  if (T.floor.length) {
    next();
    for (const it of T.floor) cur.boards[it.p].score = it.s;
    frames.push({ v: cur, dur: 820, fx: () => floorFx(V, T.floor) });
    next();
    for (const it of T.floor) { cur.boards[it.p].floor = []; cur.lid.push(...it.t); }
    if (!cur.centre.includes(MARKER)) cur.centre.push(MARKER);
    frames.push({ v: cur, dur: 700, raise: { table: true } });
  }
  frames.push({ v: V, dur: V.over ? 500 : 950, fx: V.over ? () => bonusFx(V) : () => refillFx(V, T) });
  return frames;
}

function step(frames, i, platform) {
  show(frames[i], platform);
  later(frames[i].dur, i + 1 < frames.length ? () => step(frames, i + 1, false) : pump);
}

// Show a real view. Returns true when it started a timed sequence.
function present(view, platform) {
  if (!UI.real || view.seq !== UI.real.seq) UI.sel = null;
  UI.real = view;
  const ev = view.ev && view.ev.seq > UI.eseq ? view.ev : null;
  if (view.ev) UI.eseq = Math.max(UI.eseq, view.ev.seq);
  const tl = view.tiling && view.tiling.seq > UI.tseq ? view.tiling : null;
  if (tl) UI.tseq = tl.seq;
  const fx = ev ? () => draftFx(view, ev) : null;
  const raise = ev ? { seats: [ev.p] } : null;
  if (!tl) { show({ v: view, fx, raise }, platform); return false; }
  const frames = buildFrames(view);
  frames[0].fx = fx;
  frames[0].raise = raise;
  UI.busy = true;
  step(frames, 0, platform);
  return true;
}

function pump() {
  const v = UI.queue.shift();
  if (!v) { UI.busy = false; draw(); return; }
  UI.busy = true;
  if (!present(v, false)) later(720, pump);
}

/* ---------- input ---------- */
function onClick(e) {
  const t = e.target;
  const tog = t.closest('[data-toggle]');
  if (tog) {
    const id = tog.dataset.toggle;
    UI.collapsed[id] = !UI.collapsed[id];
    sound('click');
    draw();
    return;
  }
  if (UI.busy) return;
  const v = UI.real;
  if (!v || !UI.frame || UI.frame.v !== v || v.over || v.phase !== 'draft') return;
  if (v.cur !== seatOf(v, UI.ctx.me)) return;
  if (t.closest('[data-cancel]')) { UI.sel = null; sound('click'); draw(); return; }
  const pick = t.closest('[data-pick]');
  if (pick) {
    const [s, c] = pick.dataset.pick.split(':');
    const src = s === 'c' ? 'c' : +s, color = +c;
    UI.sel = UI.sel && UI.sel.src === src && UI.sel.color === color ? null : { src, color };
    sound('click');
    draw();
    return;
  }
  const dest = t.closest('[data-dest]');
  if (dest && UI.sel) {
    const pending = UI.sel;
    UI.sel = null;
    const d0 = UI.draws;
    UI.ctx.send({ type: 'take', src: pending.src, color: pending.color, line: +dest.dataset.dest });
    if (UI.draws === d0) UI.sel = pending; // no new view yet (network) or the move was refused
    return;
  }
  const line = t.closest('.mosaic-line');
  if (line && UI.sel) { shake(line); sound('bad'); }
}

/* ---------- entry point from the platform ---------- */
function render(el, view, ctx) {
  injectCSS('mosaic', STYLE);
  UI.el = el;
  UI.ctx = ctx;
  if (view.gid !== UI.gid) {
    clearTimers();
    Object.assign(UI, {
      gid: view.gid, queue: [], busy: false, sel: null, keys: new Set(), real: view,
      tseq: view.tiling ? view.tiling.seq : 0, eseq: view.ev ? view.ev.seq : 0, frame: { v: view },
    });
    draw();
    if (view.seq === 0) sound('shuffle');
    return;
  }
  if (UI.busy) {
    const last = UI.queue.length ? UI.queue[UI.queue.length - 1] : UI.real;
    if (view.seq !== last.seq) UI.queue.push(view);
    else if (UI.queue.length) UI.queue[UI.queue.length - 1] = view;
    draw(); // same frame, fresh element
    return;
  }
  present(view, true);
}

/* =====================================================================
   Module
   ===================================================================== */

export default {
  id: 'mosaic',
  name: 'Mosaic Palace',
  description: 'Draft glazed tiles from porcelain coasters and set them into your palace wall. Chain rows, columns and colour sets — but every tile that falls to the floor costs you.',
  minPlayers: 2,
  maxPlayers: 4,
  cover: buildCover(),
  howTo: {
    goal: 'Score the most points by tiling your palace wall. The game ends after the round in which someone completes a full horizontal row of their wall.',
    turn: [
      ['🎨', 'Pick a colour', 'Take <b>all</b> tiles of one colour from a coaster (the leftovers slide into the centre), or all of one colour from the centre.'],
      ['🪜', 'Place them on one line', 'Your board has 5 staircase lines (1 to 5 tiles). The line must be empty or already hold that colour, and that colour must not be in the same wall row yet.'],
      ['⬇️', 'Extras fall to the floor', 'Tiles that don\'t fit drop to your floor strip, which costs points: −1 −1 −2 −2 −2 −3 −3.'],
      ['🧱', 'End of round: tile the wall', 'When the table is empty, each full line moves one tile onto your wall. It scores 1, or the length of the connected row plus column it joins.'],
    ],
    tips: [
      'The first player to take from the centre gets the first-player tile: −1 point, but they start the next round.',
      'End bonuses: <b>+2</b> per complete row, <b>+7</b> per complete column, <b>+10</b> for all 5 of one colour.',
      'Tiles placed next to each other score far more than scattered ones.',
      'Tap a colour to lift it: the lines where it can go light up.',
    ],
  },
  // The platform waits for this before the game-over confetti.
  isAnimating: () => !!UI.busy,

  setup(players) {
    const n = players.length;
    const nf = n <= 2 ? 5 : n === 3 ? 7 : 9;
    const start = rand(n);
    const s = {
      gid: uid(),
      players: players.map((p) => ({ id: p.id, name: p.name })),
      phase: 'draft', round: 1, start, cur: start, nextStart: -1,
      bag: shuffle(Array.from({ length: 100 }, (_, i) => i)), lid: [],
      factories: Array.from({ length: nf }, () => []),
      centre: [MARKER],
      boards: players.map(() => newBoard()),
      seq: 0, ev: null, tiling: null, tilingSeq: 0,
      log: [], over: false, winners: [], final: null,
    };
    fillFactories(s);
    log(s, `— Round 1 — ${s.players[start].name} starts. Coasters are set with ${nf * 4} tiles.`);
    return s;
  },

  act(s, pid, a) {
    if (s.over) throw new Error('The game is over.');
    if (s.phase !== 'draft') throw new Error('Please wait a moment.');
    const seat = seatOf(s, pid);
    if (seat < 0) throw new Error('You are not playing in this game.');
    if (seat !== s.cur) throw new Error("It's not your turn.");
    if (!a || a.type !== 'take') throw new Error('Unknown move.');
    const src = a.src;
    if (!(src === 'c' || (Number.isInteger(src) && src >= 0 && src < s.factories.length))) throw new Error('Pick a coaster or the centre.');
    const k = a.color;
    if (!Number.isInteger(k) || k < 0 || k > 4) throw new Error('Pick a colour.');
    const line = a.line;
    if (!Number.isInteger(line) || line < -1 || line > 4) throw new Error('Pick a pattern line or the floor.');
    const source = src === 'c' ? s.centre : s.factories[src];
    if (!source.some((t) => t !== MARKER && colorOf(t) === k)) throw new Error(`There is no ${NAMES[k]} there.`);
    if (line >= 0) {
      const why = canPlace(s.boards[seat], line, k);
      if (why) throw new Error(why);
    }
    s.seq++;
    doTake(s, seat, { src, color: k, line });
    const empty = s.factories.every((f) => !f.length) && !tilesOf(s.centre).length;
    if (empty) endRound(s);
    else s.cur = (s.cur + 1) % s.players.length;
  },

  turnOf(s) {
    if (!s || s.over || s.phase !== 'draft' || s.cur < 0) return [];
    return [s.players[s.cur].id];
  },

  view(s) {
    const v = clone(s);
    v.bag = s.bag.length; // bag order stays secret
    return v;
  },

  bot(v, pid) {
    return botMove(v, pid);
  },

  render,
};
