// Ashta Chamma (also Chowka Bhara, Kavade): the South Indian courtyard race game on a chalk 5×5 grid, played
// with four cowrie shells. Each shell lands mouth-up or mouth-down (an independent 50% each): the number
// mouth-up is the throw (1–3, all four = 4 "chamma", none = 8 "ashta").
//
// Rules used here (one clean set):
//   - Throw, then move: each throw is used straight away to move one piece (or to bring one piece onto your
//     home square). A 4, an 8 or a capture earns one more throw after that move. A throw no piece can use
//     is lost automatically (a lost 4 or 8 still earns its extra throw).
//   - Entering: any throw may place one waiting piece on your home square (that uses the whole throw).
//   - Path (25 squares): your home (the middle of your side), anticlockwise round the outer ring (16),
//     then clockwise round the inner ring (8), then the centre. You need the exact count to reach the centre.
//   - Castles (the X squares): the 4 homes and the centre. Pieces there are safe and may share the square.
//   - Landing on rivals anywhere else captures them (all of them on that square): they go back off the board.
//   - Until you have captured at least once, your pieces can't turn into the inner ring: they wait on the
//     outer ring (a move past its last square isn't allowed). If every player is stuck that way at once, all
//     players are let in (a rare safety valve so a game can always finish).
//   - The first player with all 4 pieces in the centre wins; the game ends there.
import { esc, log, addFx, rand, PLAYER_COLORS } from '../js/util.js';
import { injectCSS, morph, changed } from '../js/fx.js';
import { sound } from '../js/sound.js';
import { icon } from '../js/icons.js';
import { portrait } from '../js/avatar.js';
import { levelOption, levelOf } from '../js/levels.js';

// ---------------- the board ----------------
// Cells are numbered r*5+c (row 0 at the top). Side 0 sits at the bottom, 1 on the right, 2 at the top, 3 on the left.
const OUTER = 16, LAST_OUTER = 15, CENTRE_STEP = 24, CENTRE = 12, OFF = -1;
// Side 0's path as [row, col]: home (4,2), anticlockwise round the outer ring, into the inner ring at (3,1),
// clockwise round it, then the centre.
const BASE_PATH = [
  [4, 2], [4, 3], [4, 4], [3, 4], [2, 4], [1, 4], [0, 4], [0, 3], [0, 2], [0, 1], [0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [4, 1], // outer ring
  [3, 1], [2, 1], [1, 1], [1, 2], [1, 3], [2, 3], [3, 3], [3, 2], // inner ring
  [2, 2], // centre
];
const turnLeft = ([r, c]) => [4 - c, r]; // a quarter turn anticlockwise: the bottom side becomes the right side
const PATHS = [0, 1, 2, 3].map((side) => BASE_PATH.map((rc) => {
  let p = rc;
  for (let k = 0; k < side; k++) p = turnLeft(p);
  return p[0] * 5 + p[1];
}));
const HOMES = PATHS.map((p) => p[0]); // [22, 14, 2, 10]
const SAFE = new Set([...HOMES, CENTRE]);
const SIDES = { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] };
// The chance of each throw: k of 4 fair shells mouth-up.
const THROW_P = { 1: 4 / 16, 2: 6 / 16, 3: 4 / 16, 4: 1 / 16, 8: 1 / 16 };
const VALUES = [1, 2, 3, 4, 8];
const BONUS = (v) => v === 4 || v === 8;
const throwName = (v) => (v === 8 ? 'Ashta' : v === 4 ? 'Chamma' : '');
const valueOf = (shells) => { const up = shells.reduce((a, b) => a + b, 0); return up === 0 ? 8 : up; };

const player = (s, pid) => s.players.find((p) => p.id === pid);
const cellOf = (p, pos) => (pos >= 0 ? PATHS[p.side][pos] : -1);

// Every legal move for player p with throw v: { piece, from, to, cell, victims: [{ pid, piece }] }.
function legalMoves(s, p, v) {
  const out = [];
  p.pieces.forEach((from, piece) => {
    let to;
    if (from === OFF) to = 0;
    else if (from >= CENTRE_STEP) return;
    else to = from + v;
    if (to > CENTRE_STEP) return; // exact count to the centre
    if (!p.hit && to > LAST_OUTER) return; // no capture yet: the inner ring is closed
    const cell = cellOf(p, to);
    const victims = [];
    if (!SAFE.has(cell)) for (const q of s.players) if (q.id !== p.id) q.pieces.forEach((pos, k) => { if (pos >= 0 && cellOf(q, pos) === cell) victims.push({ pid: q.id, piece: k }); });
    out.push({ piece, from, to, cell, victims });
  });
  return out;
}

function whyNot(s, p, piece, v) {
  const pos = p.pieces[piece];
  if (pos >= CENTRE_STEP) return 'That piece is already in the centre.';
  if (pos + v > CENTRE_STEP) return `That piece needs exactly ${CENTRE_STEP - pos} to reach the centre.`;
  if (!p.hit && pos + v > LAST_OUTER) return 'Capture a piece first: until then your pieces can’t turn into the inner ring.';
  return 'That piece can’t move now.';
}

function setup(players, opts = {}) {
  const sides = SIDES[players.length] || SIDES[4];
  const s = {
    phase: 'throw', over: false, winners: [], log: [], level: levelOf(opts),
    players: players.map((p, i) => ({ id: p.id, name: p.name, seat: i, side: sides[i], pieces: [OFF, OFF, OFF, OFF], hit: false, captures: 0 })),
    turn: rand(players.length), shells: [1, 0, 1, 0], value: null, throw: null, bonus: false, throwSeq: 0, thrower: null,
    lastMove: null, note: null, noteSeq: 0,
  };
  log(s, `${s.players[s.turn].name} throws first.`);
  return s;
}

function setNote(s, p, text, self, kind = '') {
  s.noteSeq++;
  s.note = { pid: p.id, text, self, kind, seq: s.noteSeq };
}

function nextTurn(s) {
  s.turn = (s.turn + 1) % s.players.length;
  s.phase = 'throw'; s.throw = null; s.bonus = false;
}

// The rare case where nobody can ever move again: every player waits at the end of the outer ring with no capture.
function unfreeze(s) {
  if (s.players.every((p) => !p.hit && p.pieces.every((x) => x === LAST_OUTER))) {
    for (const p of s.players) p.hit = true;
    log(s, 'Every piece is waiting at the end of the outer ring, so everyone may now turn into the inner ring.');
  }
}

function doThrow(s, p) {
  s.shells = [0, 1, 2, 3].map(() => rand(2));
  const v = valueOf(s.shells);
  s.value = v; s.throwSeq++; s.thrower = p.id;
  const bonus = BONUS(v), nm = throwName(v);
  addFx(s, { kind: 'sound', sound: 'dice' });
  const moves = legalMoves(s, p, v);
  if (!moves.length) {
    log(s, `${p.name} threw ${v}, but no piece can use it.`);
    if (bonus) {
      setNote(s, p, `${nm} ${v}! No piece can use it, but ${p.name} throws again.`, `${nm} ${v}! No piece can use it, but throw again.`, 'bonus');
      s.phase = 'throw'; s.throw = null; s.bonus = false;
    } else {
      setNote(s, p, `${p.name} threw ${v}: no move, the throw is lost.`, `${v}: no piece can move, the throw is lost.`, 'lost');
      nextTurn(s);
      unfreeze(s);
    }
    return;
  }
  s.phase = 'move'; s.throw = v; s.bonus = bonus;
  log(s, `${p.name} threw ${v}${nm ? ` (${nm})` : ''}.`);
  if (bonus) setNote(s, p, `${nm} ${v}! ${p.name} moves, then throws again.`, `${nm} ${v}! Move a piece, then throw again.`, 'bonus');
  else setNote(s, p, `${p.name} threw ${v}.`, `You threw ${v}. Tap a glowing piece.`);
}

function doMove(s, p, m) {
  p.pieces[m.piece] = m.to;
  s.lastMove = { pid: p.id, piece: m.piece, from: m.from, to: m.to };
  const used = s.throw;
  s.throw = null;
  const victims = m.victims.map(({ pid, piece }) => { const q = player(s, pid); q.pieces[piece] = OFF; return q; });
  if (m.from === OFF) { log(s, `${p.name} brings a piece onto the board.`); addFx(s, { kind: 'sound', sound: 'place' }); }
  else if (m.to === CENTRE_STEP) {
    log(s, `${p.name} brings a piece to the centre (${p.pieces.filter((x) => x === CENTRE_STEP).length}/4).`);
    addFx(s, { kind: 'float', at: `ac-c-${CENTRE}`, text: 'Home!', color: '#ffe08a', sound: 'chime' });
  } else addFx(s, { kind: 'sound', sound: 'place' });
  if (victims.length) {
    p.hit = true; p.captures += victims.length;
    const names = [...new Set(victims.map((q) => q.name))].join(' and ');
    const what = victims.length > 1 ? `${victims.length} of ${names}’s pieces` : `${names}’s piece`;
    log(s, `${p.name} captures ${what}!`);
    addFx(s, { kind: 'float', at: `ac-c-${m.cell}`, text: 'Captured!', color: '#ffd76a', sound: 'steal' });
    for (const q of new Set(victims)) addFx(s, { kind: 'shake', at: `ac-p-${q.id}` });
  }
  if (p.pieces.every((x) => x === CENTRE_STEP)) {
    s.over = true; s.phase = 'over'; s.winners = [p.id];
    log(s, `${p.name} brings all four pieces to the centre and wins!`);
    setNote(s, p, `${p.name} wins!`, 'All four pieces home: you win!', 'win');
    return;
  }
  if (victims.length || s.bonus) {
    s.phase = 'throw'; s.bonus = false;
    if (victims.length) {
      const names = [...new Set(victims.map((q) => q.name))].join(' and ');
      setNote(s, p, `${p.name} captured ${names}’s piece! ${p.name} throws again.`, `Captured ${names}’s piece! Throw again.`, 'capture');
    } else setNote(s, p, `${used}! ${p.name} throws again.`, `${used}! Throw again.`, 'bonus');
    return;
  }
  nextTurn(s);
  unfreeze(s);
}

function act(s, pid, a) {
  const me = player(s, pid);
  if (!me) throw Error('Only players at the table can do that.');
  if (!a || typeof a !== 'object') throw Error('Unknown move.');
  if (s.over) throw Error('The game is over.');
  const cur = s.players[s.turn];
  if (cur.id !== pid) throw Error(`It's ${cur.name}'s turn.`);
  if (a.type === 'throw') {
    if (s.phase !== 'throw') throw Error(`Move a piece with your ${s.throw} first.`);
    doThrow(s, me);
    return;
  }
  if (a.type === 'move') {
    if (s.phase !== 'move') throw Error('Throw the shells first.');
    const i = a.piece;
    if (!Number.isInteger(i) || i < 0 || i > 3) throw Error('Pick one of your four pieces.');
    const m = legalMoves(s, me, s.throw).find((x) => x.piece === i);
    if (!m) throw Error(whyNot(s, me, i, s.throw));
    doMove(s, me, m);
    return;
  }
  throw Error('Throw the shells, then move a piece.');
}

function turnOf(s) {
  return s.over ? [] : [s.players[s.turn].id];
}

// Nothing is secret in this game: everyone sees the whole board.
const view = (s) => JSON.parse(JSON.stringify(s));

// ---------------- computer players ----------------
// Chance that one throw (Normal) or a throw plus the extra throw a 4 or 8 brings (Hard) moves a piece d squares.
const REACH1 = Object.fromEntries(VALUES.map((v) => [v, THROW_P[v]]));
const REACH2 = { ...REACH1 };
for (const a of [4, 8]) for (const b of VALUES) REACH2[a + b] = (REACH2[a + b] || 0) + THROW_P[a] * THROW_P[b];

// How likely the rivals can land on `cell` on their next turn (0 on castles).
function danger(s, p, cell, reach) {
  if (SAFE.has(cell)) return 0;
  let safe = 1;
  for (const q of s.players) {
    if (q.id === p.id) continue;
    const ds = new Set();
    for (const pos of q.pieces) {
      if (pos < 0 || pos >= CENTRE_STEP) continue;
      for (const d of Object.keys(reach)) {
        const to = pos + +d;
        if (to > CENTRE_STEP || (!q.hit && to > LAST_OUTER)) continue;
        if (cellOf(q, to) === cell) ds.add(+d);
      }
    }
    let pr = 0;
    for (const d of ds) pr += reach[d];
    safe *= 1 - Math.min(1, pr);
  }
  return 1 - safe;
}
// How likely p's piece at path step `pos` can capture someone with its next throw.
function huntChance(s, p, pos) {
  if (pos < 0 || pos >= CENTRE_STEP) return 0;
  let pr = 0;
  for (const v of VALUES) {
    const to = pos + v;
    if (to > CENTRE_STEP || (!p.hit && to > LAST_OUTER)) continue;
    const cell = cellOf(p, to);
    if (SAFE.has(cell)) continue;
    if (s.players.some((q) => q.id !== p.id && q.pieces.some((x) => x >= 0 && cellOf(q, x) === cell))) pr += THROW_P[v];
  }
  return pr;
}
const progress = (q, pos) => (pos < 0 ? 0 : pos + 1);

// One move per distinct starting square (pieces waiting together, or sharing a square, are interchangeable).
function distinctMoves(s, p, v) {
  const seen = new Set();
  return legalMoves(s, p, v).filter((m) => (seen.has(m.from) ? false : (seen.add(m.from), true)));
}

function normalPick(s, p, moves) {
  const caps = moves.filter((m) => m.victims.length);
  if (caps.length) return caps.reduce((a, b) => (score(b) > score(a) ? b : a));
  function score(m) { return m.victims.reduce((t, { pid, piece }) => t + player(s, pid).pieces[piece], 0) + m.victims.length * 30; }
  const enter = moves.find((m) => m.from === OFF);
  if (enter) return enter;
  const safeOnes = moves.filter((m) => danger(s, p, m.cell, REACH1) === 0);
  const pool = safeOnes.length ? safeOnes : moves;
  return pool.reduce((a, b) => (b.from > a.from ? b : a));
}

function hardScore(s, p, m) {
  let sc = 0;
  const gain = m.from === OFF ? 1 : m.to - m.from;
  sc += gain * 1.2;
  if (m.to === CENTRE_STEP) sc += 30;
  // Captures: the rival's lost progress, plus the extra throw; the first one also opens the inner ring.
  for (const { pid, piece } of m.victims) sc += 22 + player(s, pid).pieces[piece] * 1.6;
  if (m.victims.length && !p.hit) sc += 35;
  // Try the move on a copy to weigh the risk where the piece lands against the risk where it stood.
  const t = JSON.parse(JSON.stringify(s)), tp = player(t, p.id);
  tp.pieces[m.piece] = m.to;
  for (const { pid, piece } of m.victims) player(t, pid).pieces[piece] = OFF;
  if (m.victims.length) tp.hit = true;
  if (m.to < CENTRE_STEP) sc -= danger(t, tp, m.cell, REACH2) * (progress(tp, m.to) + 14);
  if (m.from >= 0) sc += danger(s, p, cellOf(p, m.from), REACH2) * (progress(p, m.from) + 14);
  // Other pieces left in danger now that the rivals' pieces may have moved home (after a capture, fewer threats).
  tp.pieces.forEach((pos, k) => { if (k !== m.piece && pos >= 0 && pos < CENTRE_STEP) sc -= 0.3 * danger(t, tp, cellOf(tp, pos), REACH2) * (pos + 6); });
  if (SAFE.has(m.cell) && m.to < CENTRE_STEP) sc += 2.5;
  // Hunting: a piece sitting just behind a rival may capture next turn.
  if (m.to < CENTRE_STEP) sc += huntChance(t, tp, m.to) * (p.hit ? 10 : 22);
  if (!p.hit) {
    // Without a capture, pieces at the end of the outer ring are stuck: keep some back to hunt.
    if (m.to > 11 && m.from >= 0) sc -= (m.to - 11) * 1.4;
    if (m.from === OFF) sc += 3;
  } else if (m.from === OFF) sc += p.pieces.filter((x) => x >= 0 && x < CENTRE_STEP).length < 2 ? 5 : 1;
  return sc;
}

function choose(v, pid, level) {
  const p = player(v, pid);
  const moves = distinctMoves(v, p, v.throw);
  if (!moves.length) return 0;
  if (level === 'easy') return moves[Math.floor(Math.random() * moves.length)].piece;
  if (level === 'hard') {
    let best = moves[0], top = -Infinity;
    for (const m of moves) { const sc = hardScore(v, p, m) + Math.random() * 0.01; if (sc > top) { top = sc; best = m; } }
    return best.piece;
  }
  return normalPick(v, p, moves).piece;
}

function bot(v, pid) {
  if (v.phase === 'throw') return { type: 'throw' };
  return { type: 'move', piece: choose(v, pid, v.level) };
}
// Time's up: throw for you, or make the move a Normal computer would.
function onTimeout(v, pid) {
  if (v.phase === 'throw') return { type: 'throw' };
  return { type: 'move', piece: choose(v, pid, 'normal') };
}

// ---------------- screen ----------------
const UI = { logOpen: false, rulesOpen: false };
const M = 11, C = (100 - 2 * M) / 5; // board margin (the yards) and cell size, in % of the board's width
const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
const SHAPES = ['circle', 'square', 'triangle', 'diamond'];
const colorOf = (p) => PLAYER_COLORS[p.seat % PLAYER_COLORS.length];

function shapeSVG(seat, color) {
  const k = seat % 4;
  const body = [
    '<circle cx="20" cy="20" r="15.5"/>',
    '<rect x="5" y="5" width="30" height="30" rx="7"/>',
    '<path d="M20 3.5 L36.5 33 Q37 35.5 34.5 35.5 H5.5 Q3 35.5 3.5 33 Z"/>',
    '<path d="M20 2.5 L37.5 20 L20 37.5 L2.5 20 Z"/>',
  ][k];
  const shine = ['<ellipse cx="15" cy="13" rx="7" ry="4.5"/>', '<rect x="10" y="9" width="13" height="6" rx="3"/>', '<ellipse cx="17" cy="19" rx="4" ry="5"/>', '<ellipse cx="16" cy="14" rx="5" ry="3.5"/>'][k];
  return `<svg viewBox="0 0 40 40" aria-hidden="true"><g transform="translate(0 2.2)" fill="rgba(0,0,0,.35)">${body}</g>
    <g fill="${color}" stroke="rgba(0,0,0,.45)" stroke-width="1.6" stroke-linejoin="round">${body}</g>
    <g fill="none" stroke="rgba(0,0,0,.22)" stroke-width="3" transform="translate(20 20) scale(.72) translate(-20 -20)" stroke-linejoin="round">${body}</g>
    <g fill="#fff" opacity=".55">${shine}</g></svg>`;
}

// A cowrie shell: mouth-up shows the toothed slit; mouth-down shows the glossy speckled back.
function shellSVG(up) {
  if (up) return `<svg viewBox="0 0 64 44" aria-hidden="true"><ellipse cx="32" cy="25" rx="27" ry="17" fill="rgba(0,0,0,.25)"/>
    <ellipse cx="32" cy="22" rx="27" ry="18" fill="#f6ecd6" stroke="#b79a6c" stroke-width="1.4"/>
    <ellipse cx="32" cy="22" rx="21" ry="12.5" fill="#efe0c0"/>
    <path d="M9 22 Q20 17.5 32 21 Q44 24.5 55 20" fill="none" stroke="#5a3b1c" stroke-width="3.4" stroke-linecap="round"/>
    <g stroke="#8a6438" stroke-width="1.6" stroke-linecap="round">${[14, 19, 24, 29, 34, 39, 44, 49].map((x, i) => `<path d="M${x} ${17.5 + (i % 2)} v-3.5 M${x + 1} ${24 + (i % 2)} v3.5"/>`).join('')}</g>
    <ellipse cx="22" cy="12" rx="9" ry="3" fill="#fff" opacity=".6"/></svg>`;
  return `<svg viewBox="0 0 64 44" aria-hidden="true"><ellipse cx="32" cy="25" rx="27" ry="17" fill="rgba(0,0,0,.25)"/>
    <ellipse cx="32" cy="22" rx="27" ry="18" fill="#d9b27a" stroke="#8d6235" stroke-width="1.4"/>
    <ellipse cx="32" cy="20" rx="22" ry="13" fill="#e9c993"/>
    <g fill="#9b6a3a" opacity=".55"><circle cx="20" cy="18" r="2.2"/><circle cx="28" cy="13" r="1.6"/><circle cx="37" cy="17" r="2.4"/><circle cx="45" cy="23" r="1.8"/><circle cx="26" cy="26" r="1.7"/><circle cx="40" cy="28" r="1.4"/><circle cx="33" cy="22" r="1.2"/></g>
    <path d="M10 27 Q32 36 54 27" fill="none" stroke="#a87a45" stroke-width="2" opacity=".6"/>
    <ellipse cx="24" cy="11" rx="11" ry="3.6" fill="#fff" opacity=".7"/></svg>`;
}

// The chalk lines: a static drawing (it never changes, so it is kept between renders).
function boardSVG() {
  const lines = [];
  const chalk = (d, w = 1.1, o = 0.9) => `<path d="${d}" stroke="#f6f1e7" stroke-width="${w}" stroke-opacity="${o}" fill="none" stroke-linecap="round"/>`;
  for (let i = 0; i <= 5; i++) {
    const x = i * 20;
    lines.push(chalk(`M${x} 0 V100`, 1.1), chalk(`M${x + 0.5} 0.4 V99.6`, 0.45, 0.4), chalk(`M0 ${x} H100`, 1.1), chalk(`M0.4 ${x - 0.5} H99.6`, 0.45, 0.4));
  }
  const cross = (r, c) => { const x = c * 20, y = r * 20; return chalk(`M${x + 2.5} ${y + 2.5} L${x + 17.5} ${y + 17.5} M${x + 17.5} ${y + 2.5} L${x + 2.5} ${y + 17.5}`, 1.4, 0.75); };
  for (const [r, c] of [[4, 2], [2, 4], [0, 2], [2, 0], [2, 2]]) lines.push(cross(r, c));
  // The centre: a small kolam flower over its cross.
  const petals = Array.from({ length: 8 }, (_, i) => { const a = (i * Math.PI) / 4, x = 50 + Math.cos(a) * 5.2, y = 50 + Math.sin(a) * 5.2; return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="2.2"/>`; }).join('');
  lines.push(`<g fill="none" stroke="#ffe08a" stroke-width=".7" stroke-opacity=".85">${petals}<circle cx="50" cy="50" r="2.4"/></g>`);
  // Direction marks: anticlockwise round the outer ring, clockwise round the inner ring.
  const chev = (cx, cy, deg, col) => `<path d="M-2 -2.4 L1.6 0 L-2 2.4" transform="translate(${cx} ${cy}) rotate(${deg})" stroke="${col}" stroke-width=".9" stroke-opacity=".6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  const W = '#f6f1e7', Y = '#ffd25c';
  lines.push(chev(30, 95, 0, W), chev(70, 95, 0, W), chev(95, 70, -90, W), chev(95, 30, -90, W), chev(70, 5, 180, W), chev(30, 5, 180, W), chev(5, 30, 90, W), chev(5, 70, 90, W));
  lines.push(chev(30, 50, -90, Y), chev(50, 30, 0, Y), chev(70, 50, 90, Y), chev(50, 70, 180, Y));
  // Corner dots, the way a chalk board is often finished.
  for (const [x, y] of [[10, 10], [90, 10], [10, 90], [90, 90]]) lines.push(`<g fill="#f6f1e7" opacity=".35"><circle cx="${x}" cy="${y}" r="1"/><circle cx="${x - 3}" cy="${y}" r=".6"/><circle cx="${x + 3}" cy="${y}" r=".6"/><circle cx="${x}" cy="${y - 3}" r=".6"/><circle cx="${x}" cy="${y + 3}" r=".6"/></g>`);
  return `<svg class="ac-chalk" viewBox="-1 -1 102 102" preserveAspectRatio="none" aria-hidden="true">${lines.join('')}</svg>`;
}
const BOARD_SVG = boardSVG();

function render(el, v, ctx) {
  injectCSS('ashtachamma', STYLE);
  const me = v.players.find((p) => p.id === ctx.me);
  const persp = me && !ctx.local ? me.side : 0; // your side at the bottom (one-device play keeps the board still)
  const cur = v.players[v.turn];
  const myTurn = !v.over && me && cur.id === me.id;
  const canThrow = myTurn && v.phase === 'throw';
  const moves = myTurn && v.phase === 'move' ? legalMoves(v, me, v.throw) : [];
  const legal = new Map(moves.map((m) => [m.piece, m]));
  const dests = new Set(moves.map((m) => m.cell));
  const nameOf = (id) => v.players.find((p) => p.id === id)?.name || '';

  // Cell placement on screen (rotated so the viewer's home is at the bottom).
  const disp = (cell) => { let r = Math.floor(cell / 5), c = cell % 5; for (let k = 0; k < persp; k++) [r, c] = [c, 4 - r]; return [r, c]; };
  const centreOf = (cell) => { const [r, c] = disp(cell); return [M + (c + 0.5) * C, M + (r + 0.5) * C]; };
  const homeOwner = new Map(v.players.map((p) => [HOMES[p.side], p]));

  // Cells.
  const cells = [];
  for (let cell = 0; cell < 25; cell++) {
    const [r, c] = disp(cell), owner = homeOwner.get(cell);
    const myPiece = moves.find((m) => m.from >= 0 && cellOf(me, m.from) === cell);
    const ring = cell === CENTRE ? 'centre' : r === 0 || r === 4 || c === 0 || c === 4 ? 'outer' : 'inner';
    const cls = ['ac-cell', `ac-${ring}`, SAFE.has(cell) ? 'ac-safe' : '', owner ? 'ac-home' : '', myPiece ? 'ac-tap' : '', dests.has(cell) ? 'ac-dest' : ''].filter(Boolean).join(' ');
    cells.push(`<div class="${cls}" data-a="ac-c-${cell}" ${myPiece ? `data-piece="${myPiece.piece}" role="button" aria-label="Move the piece here by ${v.throw}"` : ''} style="left:${M + c * C}%;top:${M + r * C}%;${owner ? `--hc:${hexA(colorOf(owner), 0.3)};--hl:${colorOf(owner)}` : ''}">${owner ? `<span class="ac-homemark">${shapeSVG(owner.seat, colorOf(owner))}</span>` : ''}</div>`);
  }

  // Tokens: grouped by square, waiting ones in each player's yard just outside their home.
  const groups = new Map(), tokens = [];
  for (const p of v.players) p.pieces.forEach((pos, i) => { if (pos >= 0) { const cell = cellOf(p, pos); if (!groups.has(cell)) groups.set(cell, []); groups.get(cell).push([p, i]); } });
  const tok = (p, i, x, y, size, extra = '') => {
    const m = me && p.id === me.id ? legal.get(i) : null;
    const last = v.lastMove && v.lastMove.pid === p.id && v.lastMove.piece === i;
    const pos = p.pieces[i];
    const where = pos === OFF ? 'waiting' : pos === CENTRE_STEP ? 'in the centre' : pos > LAST_OUTER ? 'on the inner ring' : 'on the outer ring';
    tokens.push(`<button class="ac-tok ${m ? 'ac-can' : ''} ${last ? 'ac-last' : ''} ${extra}" data-k="ac-${esc(p.id)}-${i}" ${m ? `data-piece="${i}"` : 'tabindex="-1"'} style="left:${(x - size / 2).toFixed(2)}%;top:${(y - size / 2).toFixed(2)}%;width:${size}%;--pc:${colorOf(p)}" aria-label="${esc(p.name)}'s ${SHAPES[p.seat % 4]} piece, ${where}${m ? `: move ${v.throw}` : ''}">${shapeSVG(p.seat, colorOf(p))}</button>`);
  };
  for (const [cell, list] of groups) {
    list.sort((a, b) => a[0].seat - b[0].seat || a[1] - b[1]);
    const n = list.length, [cx, cy] = centreOf(cell);
    const g = n === 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4, size = [0, 10.5, 7.4, 5.1, 3.8][g], step = [0, 0, 3.9, 4.6, 3.6][g];
    list.forEach(([p, i], k) => {
      const gx = k % g, gy = Math.floor(k / g), rows = Math.ceil(n / g);
      const rowLen = gy === rows - 1 ? n - gy * g : g;
      tok(p, i, cx + (gx - (rowLen - 1) / 2) * step, cy + (gy - (rows - 1) / 2) * step, size);
    });
  }
  const yards = [];
  for (const p of v.players) {
    const ds = (p.side - persp + 4) % 4, waiting = p.pieces.map((x, i) => [x, i]).filter(([x]) => x === OFF).map(([, i]) => i);
    const [hx, hy] = centreOf(HOMES[p.side]);
    const out = M / 2 + 0.4;
    const along = (k) => (k - 1.5) * 7.4;
    const at = (k) => (ds === 0 ? [hx + along(k), 100 - out] : ds === 2 ? [hx - along(k), out] : ds === 1 ? [100 - out, hy - along(k)] : [out, hy + along(k)]);
    waiting.forEach((i, k) => { const [x, y] = at(k); tok(p, i, x, y, 6.6, 'ac-wait'); });
    const enter = me && p.id === me.id && moves.find((m) => m.from === OFF);
    const horiz = ds === 0 || ds === 2;
    const [yx, yy] = at(1.5);
    yards.push(`<div class="ac-yard ${enter ? 'ac-tap ac-enter' : ''}" data-a="ac-y-${esc(p.id)}" ${enter ? `data-piece="${enter.piece}" role="button" aria-label="Bring a piece onto your home square"` : ''} style="left:${yx - (horiz ? 15.5 : M / 2)}%;top:${yy - (horiz ? M / 2 : 15.5)}%;width:${horiz ? 31 : M}%;height:${horiz ? M : 31}%;--pc:${colorOf(p)}"></div>`);
  }

  // Shells, throw and messages.
  const rolled = changed('ashtachamma-throw', v.throwSeq) && v.throwSeq > 0;
  const val = v.value;
  const shells = v.shells.map((up, i) => `<span class="ac-shell ${up ? 'up' : 'down'}" data-i="${i}">${shellSVG(up)}</span>`).join('');
  const note = v.note ? (v.note.pid === ctx.me ? v.note.self : v.note.text) : '';
  const status = v.over ? (v.winners.includes(ctx.me) ? 'You win! All four pieces reached the centre.' : `${esc(nameOf(v.winners[0]))} wins!`)
    : canThrow ? 'Your turn: throw the shells.'
    : myTurn ? (moves.every((m) => m.from === OFF) ? `Tap a glowing waiting piece to bring it onto your home square.` : `Tap a glowing piece to move it ${v.throw}${moves.some((m) => m.from === OFF) ? ', or a waiting one to bring it in' : ''}.`)
    : v.phase === 'throw' ? `${esc(cur.name)} is throwing…` : `${esc(cur.name)} is moving ${v.throw}…`;
  const hint = !v.over && me && !me.hit && me.pieces.some((x) => x >= 8) ? '<p class="ac-hint">Capture a piece to open the inner ring.</p>' : '';

  const doneCount = (p) => p.pieces.filter((x) => x === CENTRE_STEP).length;
  const waitCount = (p) => p.pieces.filter((x) => x === OFF).length;
  const playersHTML = v.players.map((p) => {
    const turn = !v.over && cur.id === p.id;
    return `<div class="ac-player ${p.id === ctx.me ? 'me' : ''} ${turn ? 'turn' : ''} ${v.winners.includes(p.id) ? 'win' : ''}" data-a="ac-p-${esc(p.id)}" style="--pc:${colorOf(p)}">
      <span class="ac-face">${portrait({ id: p.id, bot: !!ctx.isBot?.(p.id) })}</span>
      <span class="ac-pname"><b><i class="ac-mini">${shapeSVG(p.seat, colorOf(p))}</i>${esc(p.name)}</b>
        <small><span class="ac-pips">${p.pieces.map((x) => `<i class="${x === CENTRE_STEP ? 'done' : x === OFF ? 'wait' : 'out'}"></i>`).join('')}</span>${doneCount(p)}/4 home · ${waitCount(p)} waiting</small></span>
      <span class="ac-ptags">${p.id === ctx.me ? '<span class="tag t-you">You</span>' : ''}${turn ? `<span class="tag t-good">${v.phase === 'throw' ? 'Throwing' : `Moving ${v.throw}`}</span>` : ''}${p.hit ? `<span class="tag">${icon('check')}Inner ring</span>` : '<span class="tag t-warn">Needs a capture</span>'}</span></div>`;
  }).join('');

  if (el.querySelector('.ac-logbox')) UI.logOpen = el.querySelector('.ac-logbox').open;
  if (el.querySelector('.ac-rules')) UI.rulesOpen = el.querySelector('.ac-rules').open;
  const big = val == null ? '' : `<span class="ac-val ${BONUS(val) ? 'bonus' : ''}"><b>${val}</b>${throwName(val) ? `<small>${throwName(val)}</small>` : ''}</span>`;
  const noteKind = v.note?.kind || '';

  morph(el, `<div class="ac-root"><div class="game-layout">
    <div class="felt ac-felt">
      <div class="ac-top">
        <div class="ac-tray ${canThrow ? 'ac-ready' : ''}" data-a="ac-tray" ${canThrow ? 'role="button" aria-label="Throw the shells"' : ''}>
          <div class="ac-shells" aria-label="${val == null ? 'No throw yet' : `Shells: ${v.shells.filter(Boolean).length} mouth-up, throw ${val}`}">${shells}</div>${big}
        </div>
        <div class="ac-say">
          ${v.over ? `<div class="winner-banner">${icon('trophy')}${status}</div>`
            : `<p class="ac-status">${canThrow && v.note?.pid === ctx.me && /again/.test(note) ? esc(note) : status}</p>
          <div class="ac-slot">${canThrow ? `<button class="primary ac-throw" id="acThrow">${icon('dice')}Throw shells</button>`
            : note ? `<p class="ac-note ${noteKind} ${v.noteSeq % 2 ? 'a' : 'b'}" aria-live="polite">${esc(note)}</p>` : ''}</div>`}
        </div>
      </div>
      <div class="ac-wrap ${myTurn && v.phase === 'move' ? 'ac-moving' : ''}" style="--me:${me ? colorOf(me) : '#ffd76a'}">
        <div class="ac-floor" style="left:${M}%;top:${M}%;width:${100 - 2 * M}%;height:${100 - 2 * M}%">${BOARD_SVG}</div>
        ${cells.join('')}${yards.join('')}${tokens.join('')}
      </div>
      ${hint}
    </div>
    <div class="side">
      <div class="panel ac-players">${playersHTML}</div>
      <details class="panel drawer ac-rules" ${UI.rulesOpen ? 'open' : ''}><summary>${icon('book')}<span>Throws &amp; rules</span>${icon('chevron', 'chev')}</summary>
        <div class="drawer-body"><div class="ac-table">
          <span><b>1</b>1 shell up</span><span><b>2</b>2 up</span><span><b>3</b>3 up</span><span class="bonus"><b>4</b>all up: Chamma, throw again</span><span class="bonus"><b>8</b>none up: Ashta, throw again</span>
        </div><ul class="ac-list"><li>Any throw brings a waiting piece onto your home square.</li><li>Round the outer ring anticlockwise, then the inner ring clockwise, then the centre (exact count).</li><li>X squares are castles: safe, and shared.</li><li>Land on a rival elsewhere to send it back and throw again.</li><li>Capture once before your pieces may enter the inner ring.</li></ul></div></details>
      <details class="panel drawer ac-logbox" ${UI.logOpen ? 'open' : ''}><summary>${icon('book')}<span>Game log</span>${icon('chevron', 'chev')}</summary>
        <div class="drawer-body"><div class="parchment log">${v.log.slice(0, 12).map((l) => `<div>${esc(l)}</div>`).join('')}</div></div></details>
    </div>
  </div></div>`);

  const lb = el.querySelector('.ac-logbox'); if (lb) lb.ontoggle = () => { UI.logOpen = lb.open; };
  const rb = el.querySelector('.ac-rules'); if (rb) rb.ontoggle = () => { UI.rulesOpen = rb.open; };
  el.querySelectorAll('[data-piece]').forEach((b) => (b.onclick = () => { sound('click'); ctx.send({ type: 'move', piece: +b.dataset.piece }); }));
  el.querySelectorAll('.ac-tok:not([data-piece]), .ac-cell:not([data-piece]), .ac-yard:not([data-piece])').forEach((b) => (b.onclick = null));
  const go = () => ctx.send({ type: 'throw' });
  const tb = el.querySelector('#acThrow'); if (tb) tb.onclick = go;
  const tray = el.querySelector('.ac-tray'); tray.onclick = canThrow ? go : null;
  if (rolled) {
    el.querySelectorAll('.ac-shell').forEach((sh, i) => {
      if (!sh.animate) return;
      const dx = (i - 1.5) * 22 + (Math.random() * 20 - 10), spin = (Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 360);
      sh.animate([
        { transform: `translate(${dx}px,-46px) rotate(${spin}deg) scaleX(1)`, opacity: 0.4 },
        { transform: `translate(${dx / 2}px,-22px) rotate(${spin / 2}deg) scaleX(-1)`, opacity: 1, offset: 0.4 },
        { transform: 'translate(0,0) rotate(0deg) scaleX(1)', offset: 0.72 },
        { transform: 'translate(0,-6px) rotate(6deg) scaleX(.85)', offset: 0.84 },
        { transform: 'none' },
      ], { duration: 760 + i * 90, easing: 'ease-out' });
    });
    const bv = el.querySelector('.ac-val'); if (bv?.animate) bv.animate([{ transform: 'scale(.3)', opacity: 0 }, { transform: 'scale(.3)', opacity: 0, offset: 0.6 }, { transform: 'scale(1.2)', opacity: 1, offset: 0.85 }, { transform: 'scale(1)' }], { duration: 1050, easing: 'ease-out' });
  }
}

const STYLE = `
.ac-felt{display:flex;flex-direction:column;align-items:center;gap:12px;background:
  radial-gradient(90% 55% at 50% 0%,rgba(255,190,110,.20),transparent 60%),
  radial-gradient(3px 3px at 20% 30%,rgba(255,255,255,.05),transparent),radial-gradient(2px 2px at 70% 60%,rgba(0,0,0,.12),transparent),
  linear-gradient(180deg,#7b2f1d,#4c1a10)}
.ac-felt .winner-banner{display:flex;align-items:center;gap:10px}.ac-felt .winner-banner .ic{width:1em;height:1em}
.ac-top{display:flex;align-items:center;justify-content:center;gap:14px;width:min(100%,560px);flex-wrap:wrap}
.ac-tray{position:relative;display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:18px;min-height:64px;
  background:repeating-linear-gradient(90deg,rgba(120,80,30,.18) 0 3px,transparent 3px 9px),repeating-linear-gradient(0deg,rgba(255,255,255,.06) 0 2px,transparent 2px 7px),linear-gradient(180deg,#d9b36a,#b48a45);
  box-shadow:inset 0 2px 0 rgba(255,255,255,.35),inset 0 -3px 0 rgba(0,0,0,.18),0 8px 18px rgba(0,0,0,.35);border:2px solid #8a6230}
.ac-tray.ac-ready{cursor:pointer}
.ac-tray.ac-ready::after{content:"";position:absolute;inset:-5px;border-radius:22px;border:3px solid #ffe08a;opacity:0;animation:ac-breathe 1.6s ease-in-out infinite;pointer-events:none}
.ac-tray.ac-ready:active{transform:scale(.97)}
.ac-shells{display:flex;gap:4px}
.ac-shell{display:block;width:46px;height:32px;will-change:transform}.ac-shell svg{display:block;width:100%;height:100%}
.ac-val{display:flex;flex-direction:column;align-items:center;min-width:48px;line-height:1}
.ac-val b{font:700 2.1rem var(--font-display);color:#3a2208}
.ac-val small{font:700 .72rem var(--font-display);color:#5a3410;text-transform:uppercase;letter-spacing:.04em}
.ac-val.bonus b{color:#b3261e}
.ac-say{display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:6px;min-width:0;flex:1 1 220px;height:96px}
.ac-say .winner-banner{margin:0}
.ac-slot{display:flex;align-items:center;min-height:46px;max-width:100%}
.ac-status{margin:0;font-weight:800;color:#fff4e6;line-height:1.3;max-height:2.6em;overflow:hidden}
.ac-note{margin:0;padding:5px 12px;max-height:44px;overflow:hidden;line-height:1.25;border-radius:999px;background:rgba(0,0,0,.25);color:#ffe9c7;font-weight:700;font-size:.9rem}
.ac-note.bonus,.ac-note.capture{background:#ffd76a;color:#3a1c00}
.ac-note.lost{background:rgba(0,0,0,.32);color:#ffc9b8}
.ac-note.a{animation:ac-pop .45s ease-out}.ac-note.b{animation:ac-pop2 .45s ease-out}
@keyframes ac-pop{0%{transform:scale(.8);opacity:0}70%{transform:scale(1.06)}100%{transform:none;opacity:1}}
@keyframes ac-pop2{0%{transform:scale(.8);opacity:0}70%{transform:scale(1.06)}100%{transform:none;opacity:1}}
.ac-throw{min-height:44px}.ac-throw .ic{width:1.1em;height:1.1em}
.ac-wrap{position:relative;width:min(100%,560px);aspect-ratio:1;border-radius:18px;background:radial-gradient(70% 70% at 50% 50%,rgba(0,0,0,0),rgba(0,0,0,.18))}
.ac-floor{position:absolute;border-radius:6px;background:
  radial-gradient(120% 90% at 30% 20%,rgba(255,255,255,.07),transparent 55%),
  repeating-radial-gradient(circle at 37% 61%,rgba(0,0,0,.05) 0 1px,transparent 1px 5px),
  linear-gradient(135deg,#8a3422,#6a2416);box-shadow:inset 0 0 0 3px rgba(0,0,0,.18),inset 0 10px 30px rgba(0,0,0,.25),0 10px 26px rgba(0,0,0,.35)}
.ac-chalk{position:absolute;inset:0;width:100%;height:100%}
.ac-cell{position:absolute;width:${C}%;height:${C}%;box-sizing:border-box}
.ac-cell.ac-inner{background:rgba(255,210,92,.05)}
.ac-cell.ac-home{background:radial-gradient(circle at 50% 50%,var(--hc),transparent 75%)}
.ac-homemark{position:absolute;right:6%;bottom:6%;width:22%;opacity:.55}.ac-homemark svg{display:block;width:100%}
.ac-cell.ac-dest::before{content:"";position:absolute;inset:16%;border-radius:50%;border:2.5px dashed var(--me);opacity:.85}
.ac-tap{cursor:pointer;z-index:1}
.ac-yard{position:absolute;border-radius:12px}
.ac-yard.ac-enter{background:rgba(255,255,255,.08);box-shadow:inset 0 0 0 2px var(--pc)}
.ac-yard.ac-enter::after{content:"";position:absolute;inset:-3px;border-radius:14px;border:2px solid #ffe08a;opacity:0;animation:ac-breathe 1.6s ease-in-out infinite;pointer-events:none}
.ac-tok:hover:not(:disabled){background:none;box-shadow:none}
.ac-tok{position:absolute;z-index:2;aspect-ratio:1;height:auto;min-height:0;min-width:0;padding:0;margin:0;border:0;background:none;box-shadow:none;transition:none;pointer-events:none;border-radius:50%}
.ac-tok svg{display:block;width:100%;height:100%;overflow:visible}
.ac-tok.ac-can{pointer-events:auto;cursor:pointer;z-index:3}
.ac-tok.ac-can::before{content:"";position:absolute;inset:-14%;border-radius:50%;background:radial-gradient(circle,rgba(255,236,150,.8) 30%,rgba(255,236,150,0) 70%);opacity:.4;animation:ac-breathe 1.4s ease-in-out infinite;z-index:-1}
.ac-tok.ac-can:active{transform:scale(.94)}
.ac-tok.ac-last::after{content:"";position:absolute;inset:-6%;border-radius:50%;border:2px solid rgba(255,255,255,.75)}
.ac-tok.ac-can::after{content:"";position:absolute;left:50%;bottom:-14%;width:30%;height:10%;margin-left:-15%;border-radius:50%;background:#ffe08a}
@keyframes ac-breathe{0%,100%{opacity:.25}50%{opacity:.95}}
.ac-hint{margin:0;padding:6px 12px;border-radius:12px;background:rgba(0,0,0,.25);color:#ffe9c7;font-weight:700;font-size:.9rem}
.ac-player{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:4px 10px;padding:7px 8px;border-radius:12px}
.ac-player.me{background:rgba(255,255,255,.06)}.ac-player.turn{background:rgba(255,215,106,.14)}.ac-player.win{background:rgba(255,215,106,.24)}
.ac-face{display:block;width:40px;height:40px;border-radius:50%;overflow:hidden;box-shadow:0 0 0 3px var(--pc);grid-row:span 2}.ac-face svg{display:block;width:100%;height:100%}
.ac-pname{display:flex;flex-direction:column;gap:2px;min-width:0}
.ac-pname b{display:flex;align-items:center;gap:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ac-mini{display:inline-block;width:18px;height:18px;flex:none}.ac-mini svg{display:block;width:100%;height:100%}
.ac-pname small{display:flex;align-items:center;gap:6px;color:var(--muted)}
.ac-pips{display:inline-flex;gap:3px}.ac-pips i{width:9px;height:9px;border-radius:50%;border:1.5px solid var(--pc)}
.ac-pips i.out{background:var(--pc);opacity:.6}.ac-pips i.done{background:var(--pc)}
.ac-ptags{display:flex;flex-wrap:wrap;gap:4px}.ac-ptags .ic{width:.9em;height:.9em}
.ac-table{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px}
.ac-table span{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:10px;background:rgba(255,255,255,.06);font-size:.85rem}
.ac-table span.bonus{grid-column:span 2;background:rgba(255,215,106,.14)}
.ac-table b{display:grid;place-items:center;min-width:26px;height:26px;border-radius:50%;background:#e9c993;color:#3a2208;font:700 .95rem var(--font-display)}
.ac-list{margin:0;padding-left:18px;font-size:.88rem;line-height:1.45}
@media (max-width:480px){.ac-shell{width:38px;height:27px}.ac-tray{padding:8px 10px;gap:6px}.ac-val b{font-size:1.8rem}.ac-top{gap:10px}.ac-say{flex-basis:100%;align-items:center;text-align:center;height:92px}.ac-slot{justify-content:center;width:100%}.ac-throw{width:100%}}
`;

/* Cover art: a family on a woven mat in a courtyard, a grandmother, a girl throwing cowrie shells and her
   father, around a chalk 5×5 grid on the red floor, with pieces on it and shells tumbling (ids prefixed acc-). */
function coverSVG() {
  // The chalk grid on the floor, drawn in perspective from its four corners.
  const P = { tl: [110, 120], tr: [214, 120], bl: [78, 192], br: [246, 192] };
  const at = (u, w) => {
    const top = [P.tl[0] + (P.tr[0] - P.tl[0]) * u, P.tl[1]], bot = [P.bl[0] + (P.br[0] - P.bl[0]) * u, P.bl[1]];
    return [top[0] + (bot[0] - top[0]) * w, top[1] + (bot[1] - top[1]) * w];
  };
  const pt = (u, w) => at(u, w).map((n) => n.toFixed(1)).join(' ');
  let grid = '';
  for (let i = 0; i <= 5; i++) grid += `<path d="M${pt(i / 5, 0)} L${pt(i / 5, 1)}" /><path d="M${pt(0, i / 5)} L${pt(1, i / 5)}" />`;
  const cross = (r, c) => `<path d="M${pt(c / 5 + 0.02, r / 5 + 0.03)} L${pt((c + 1) / 5 - 0.02, (r + 1) / 5 - 0.03)} M${pt((c + 1) / 5 - 0.02, r / 5 + 0.03)} L${pt(c / 5 + 0.02, (r + 1) / 5 - 0.03)}"/>`;
  const castles = [[4, 2], [2, 4], [0, 2], [2, 0], [2, 2]].map(([r, c]) => cross(r, c)).join('');
  const piece = (r, c, col, shape) => { const [x, y] = at((c + 0.5) / 5, (r + 0.5) / 5); const s = 3 + (r + 0.5) * 0.55;
    return shape === 0 ? `<ellipse cx="${x.toFixed(1)}" cy="${(y - 1).toFixed(1)}" rx="${s}" ry="${(s * 0.7).toFixed(1)}" fill="${col}" stroke="#2a0d06" stroke-width=".8"/>`
      : `<rect x="${(x - s).toFixed(1)}" y="${(y - s * 0.8).toFixed(1)}" width="${2 * s}" height="${(1.4 * s).toFixed(1)}" rx="1.5" fill="${col}" stroke="#2a0d06" stroke-width=".8"/>`; };
  const shell = (x, y, rot, up, sc = 1) => `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${sc})"><ellipse rx="6" ry="4" fill="${up ? '#f6ecd6' : '#dcb57c'}" stroke="#8d6235" stroke-width=".7"/>${up ? '<path d="M-4.5 0 Q0 -1 4.5 .3" stroke="#5a3b1c" stroke-width="1.2" fill="none" stroke-linecap="round"/>' : '<ellipse cx="-1.5" cy="-1.4" rx="2.6" ry="1" fill="#fff" opacity=".65"/><circle cx="1.8" cy=".8" r=".8" fill="#9b6a3a" opacity=".6"/>'}</g>`;
  return `<svg viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="acc-wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3c77a"/><stop offset="1" stop-color="#d9964c"/></linearGradient>
    <linearGradient id="acc-floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9a3a24"/><stop offset="1" stop-color="#6a2215"/></linearGradient>
    <linearGradient id="acc-mat" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#c99a4f"/><stop offset=".5" stop-color="#e2bd72"/><stop offset="1" stop-color="#c3924a"/></linearGradient>
    <radialGradient id="acc-sun" cx=".78" cy=".1" r=".6"><stop offset="0" stop-color="#fff3c4" stop-opacity=".8"/><stop offset="1" stop-color="#fff3c4" stop-opacity="0"/></radialGradient>
    <linearGradient id="acc-sari" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2e9e8f"/><stop offset="1" stop-color="#1c6b61"/></linearGradient>
    <linearGradient id="acc-kurta" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f1f3fb"/><stop offset="1" stop-color="#c9cde0"/></linearGradient>
    <linearGradient id="acc-frock" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff7aa8"/><stop offset="1" stop-color="#d43d74"/></linearGradient>
  </defs>
  <rect width="320" height="200" fill="url(#acc-wall)"/><rect width="320" height="200" fill="url(#acc-sun)"/>
  <!-- courtyard: pillars, a doorway and a hanging bell-lamp -->
  <rect x="0" y="0" width="320" height="10" fill="#8a4a22"/>
  <g fill="#b46a34"><rect x="18" y="10" width="16" height="96"/><rect x="286" y="10" width="16" height="96"/></g>
  <g fill="#e6a85d"><rect x="14" y="10" width="24" height="8" rx="2"/><rect x="282" y="10" width="24" height="8" rx="2"/></g>
  <path d="M136 106 V44 q24 -26 48 0 V106z" fill="#5e2d16"/><path d="M142 106 V48 q18 -18 36 0 V106z" fill="#3a1a0c"/>
  <g fill="#2e9e8f"><path d="M110 10 q8 12 16 0z"/><path d="M134 10 q8 12 16 0z"/><path d="M158 10 q8 12 16 0z"/><path d="M182 10 q8 12 16 0z"/><path d="M206 10 q8 12 16 0z"/></g>
  <g fill="#ffd25c"><path d="M122 10 q8 10 16 0z"/><path d="M146 10 q8 10 16 0z"/><path d="M170 10 q8 10 16 0z"/><path d="M194 10 q8 10 16 0z"/></g>
  <rect x="0" y="104" width="320" height="96" fill="url(#acc-floor)"/><rect x="0" y="104" width="320" height="3" fill="#b85a36"/>
  <!-- the mat -->
  <path d="M8 200 L36 140 H284 L312 200z" fill="url(#acc-mat)"/>
  <g stroke="#9c7234" stroke-width="1" opacity=".5">${Array.from({ length: 14 }, (_, i) => `<path d="M${36 + i * 19} 140 L${8 + i * 23} 200"/>`).join('')}</g>
  <path d="M36 140 H284" stroke="#7a2e1d" stroke-width="3"/><path d="M8 200 L36 140 M312 200 L284 140" stroke="#7a2e1d" stroke-width="3"/>
  <!-- the chalk board drawn on the floor -->
  <path d="M${pt(0, 0)} L${pt(1, 0)} L${pt(1, 1)} L${pt(0, 1)}z" fill="#8c3321" stroke="#6a2215" stroke-width="2"/>
  <g stroke="#f8f2e6" stroke-width="1.5" stroke-linecap="round" fill="none" opacity=".92">${grid}</g>
  <g stroke="#f8f2e6" stroke-width="1.1" fill="none" opacity=".7">${castles}</g>
  ${piece(4, 3, '#ef4444', 0)}${piece(3, 4, '#ef4444', 0)}${piece(1, 0, '#3b82f6', 1)}${piece(0, 1, '#3b82f6', 1)}${piece(2, 1, '#22c55e', 0)}${piece(4, 0, '#facc15', 1)}
  <!-- grandmother, left, in a sari with jasmine in her bun -->
  <g transform="translate(52 96)">
    <path d="M-26 52 q4 -34 26 -36 q24 2 28 36z" fill="url(#acc-sari)"/>
    <path d="M-6 18 q14 4 30 34 l-8 2 q-12 -22 -22 -28z" fill="#ffd25c" opacity=".85"/>
    <circle cx="0" cy="2" r="14" fill="#a86a42"/>
    <path d="M-14 0 q0 -16 14 -16 q15 0 14 16 q-4 -9 -14 -9 q-10 0 -14 9z" fill="#e8e4dc"/>
    <circle cx="13" cy="-6" r="6" fill="#e8e4dc"/><g fill="#fff"><circle cx="17" cy="-10" r="1.6"/><circle cx="19" cy="-6" r="1.6"/><circle cx="18" cy="-2" r="1.6"/></g>
    <circle cx="-5" cy="3" r="1.6" fill="#2a160c"/><circle cx="5" cy="3" r="1.6" fill="#2a160c"/><path d="M-4 9 q4 3 8 0" stroke="#5a2a1a" stroke-width="1.4" fill="none" stroke-linecap="round"/>
    <circle cx="0" cy="-3" r="1.2" fill="#d6246a"/>
    <path d="M20 34 q14 2 22 12" stroke="#a86a42" stroke-width="6" fill="none" stroke-linecap="round"/>
  </g>
  <!-- the girl in the middle, throwing the shells -->
  <g transform="translate(160 92)">
    <path d="M-18 48 q2 -28 18 -30 q17 2 19 30z" fill="url(#acc-frock)"/>
    <circle cx="0" cy="4" r="13" fill="#c98a5e"/>
    <path d="M-13 4 q-1 -17 13 -17 q14 0 13 17 q-4 -10 -13 -10 q-9 0 -13 10z" fill="#1d1018"/>
    <path d="M-12 6 q-6 10 -2 20" stroke="#1d1018" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M12 6 q6 10 2 20" stroke="#1d1018" stroke-width="4" fill="none" stroke-linecap="round"/>
    <circle cx="-5" cy="5" r="1.8" fill="#1a0f08"/><circle cx="5" cy="5" r="1.8" fill="#1a0f08"/><ellipse cx="0" cy="11" rx="3" ry="2.4" fill="#7a2a2a"/>
    <path d="M16 26 q14 -8 18 -28" stroke="#c98a5e" stroke-width="5.5" fill="none" stroke-linecap="round"/>
    <path d="M-16 26 q-8 6 -6 16" stroke="#c98a5e" stroke-width="5.5" fill="none" stroke-linecap="round"/>
  </g>
  ${shell(196, 58, -20, true, 1.1)}${shell(212, 72, 30, false, 1.05)}${shell(184, 44, 50, false, 1)}${shell(206, 40, -60, true, 0.95)}
  <g stroke="#fff" stroke-width="1.2" stroke-linecap="round" opacity=".7"><path d="M190 34 l-3 -5"/><path d="M218 50 l5 -3"/><path d="M222 66 l5 1"/></g>
  <!-- father, right, in a kurta, cheering -->
  <g transform="translate(266 94)">
    <path d="M-28 54 q2 -36 28 -38 q27 2 29 38z" fill="url(#acc-kurta)"/>
    <circle cx="0" cy="2" r="15" fill="#9a5d36"/>
    <path d="M-15 0 q0 -17 15 -17 q16 0 15 17 q-3 -8 -15 -9 q-12 1 -15 9z" fill="#1a1012"/>
    <path d="M-8 9 q8 6 16 0" stroke="#1a1012" stroke-width="3" fill="none" stroke-linecap="round"/>
    <circle cx="-5" cy="2" r="1.7" fill="#1a0f08"/><circle cx="5" cy="2" r="1.7" fill="#1a0f08"/><path d="M-4 12 q4 4 8 0" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round"/>
    <path d="M-24 30 q-14 -14 -10 -34" stroke="#9a5d36" stroke-width="6" fill="none" stroke-linecap="round"/>
  </g>
  <!-- shells already on the floor -->
  ${shell(124, 182, 15, false, 1.2)}${shell(206, 184, -25, true, 1.2)}
  <g fill="#fff3c4"><path d="M296 120 l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 l5 -2z"/><path d="M24 124 l1.5 4 l4 1.5 l-4 1.5 l-1.5 4 l-1.5 -4 l-4 -1.5 l4 -1.5z"/></g>
</svg>`;
}

export default {
  id: 'ashtachamma', name: 'Ashta Chamma',
  description: 'The South Indian courtyard race: throw four cowrie shells, race your pieces round a chalk 5×5 board to the centre, and send rivals home. You must capture before you may turn inward! For 2–4.',
  minPlayers: 2, maxPlayers: 4,
  options: [levelOption()],
  cover: coverSVG(),
  defaultTimer: 25,
  howTo: {
    goal: 'Be the first to bring all four of your pieces into the centre square.',
    turn: [
      ['🐚', 'Throw the shells', 'Tap Throw. The number of shells landing mouth-up is your throw: 1, 2 or 3. All four up is 4 (Chamma); none up is 8 (Ashta). A 4 or an 8 earns another throw.'],
      ['👆', 'Move one piece', 'Use each throw at once: tap a glowing piece to move it that many squares, or tap your yard to bring a waiting piece onto your home square (any throw does it).'],
      ['🔄', 'Go round, then in', 'Pieces travel anticlockwise round the outer ring, then clockwise round the inner ring, then into the centre. You need the exact number to reach the centre.'],
      ['⚔️', 'Capture', 'Land on a rival’s piece (not on an X castle) to send it back off the board and throw again. Until you have captured once, your pieces must wait on the outer ring.'],
    ],
    tips: [
      'The X squares (the four homes and the centre) are castles: nothing can be captured there, and pieces may share them.',
      'A 2 is the most likely throw, then 1 or 3; 4 and 8 come only once in 16 throws each.',
      'Keep a piece just behind a rival to hunt it, and don’t rush every piece to the end of the outer ring before you have captured.',
      'If no piece can use a throw, it is lost and play moves on by itself.',
    ],
  },
  setup, act, turnOf, view, bot, onTimeout, render,
};

// For tests.
export const _internals = { PATHS, SAFE, HOMES, legalMoves, valueOf, danger, THROW_P };
