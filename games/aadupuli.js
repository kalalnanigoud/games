// Aadu Puli Attam ("goats and tigers"), the South Indian hunt game chalked on courtyards and temple steps.
// One player has 3 tigers, the other 15 goats. The goats are placed one per turn, then they move;
// the tigers step along the lines or jump over a goat to capture it. The tigers win by capturing enough
// goats; the goats win by hemming every tiger in (or by holding out long enough).
//
// RULES USED HERE
// - Sides are drawn at random at setup. The goats move first (the goat player places the first goat).
// - The tigers start on the apex (A) and the two points directly below it on the inner lines (B3, B4).
// - Placement: while goats remain in hand, the goat player's turn is to place one on any empty point.
//   Goats in hand can't move; tigers move normally during placement.
// - Movement: a goat steps along a drawn line to the adjacent empty point. A tiger steps the same way, or
//   jumps over an adjacent goat to the empty point directly beyond it on the same straight line, capturing
//   it. One jump per turn (no chains), and capturing is never forced.
// - Tigers win when they have captured `hunt` goats (lobby option 5 / 6 / 7, default 6).
// - Goats win when the tigers have no legal move on their turn.
// - Goats with no legal move on their turn (rare) lose: the tigers win.
// - Stall rule: 100 moves in a row (50 each, placements included) without a capture and the goats win:
//   the tigers went hungry. Checks run in this order after every move: capture target, no move, stall.
import { esc, log, addFx, shuffle } from '../js/util.js';
import { injectCSS, morph } from '../js/fx.js';
import { sound } from '../js/sound.js';
import { icon } from '../js/icons.js';
import { portrait } from '../js/avatar.js';
import { levelOption, levelOf } from '../js/levels.js';

/* ---------------- the board graph ----------------
   A triangle with 4 lines fanning down from the apex (the two sides and two inner lines), crossed by 4
   horizontal lines. A rectangle overlaps the top three horizontals: they run out past the triangle to the
   rectangle's two vertical sides. That gives 1 + 6 + 6 + 6 + 4 = 23 points:

                         A                      row A: apex (index 0)
        B1 ---- B2 -- B3 - B4 -- B5 ---- B6     row B: indexes 1..6   (B1, B6 on the rectangle's sides)
        |      /     /     \     \       |
        C1 -- C2 -- C3 ---- C4 -- C5 -- C6      row C: indexes 7..12
        |    /     /         \     \     |
        D1 - D2 -- D3 ------ D4 -- D5 - D6      row D: indexes 13..18
            /     /           \     \
          E1 --- E2 --------- E3 --- E4         row E: indexes 19..22 (the triangle's base)

   Points have x/y in a 100 × 88 drawing box. The apex lines are straight because each point's distance
   from the centre is proportional to its depth below the apex. Adjacency runs only along drawn lines, and
   a jump is any three consecutive points on one drawn line. */
const W = 100, H = 88, NP = 23;
const APEX_Y = 5, ROW_Y = [32, 48, 64, 81], FAN = 0.18, RECT = 44;
const KS = [-3, -1, 1, 3]; // the 4 apex lines, by slope
const PTS = [{ x: 50, y: APEX_Y, name: 'A' }];
ROW_Y.forEach((y, r) => {
  const fan = KS.map((k) => 50 + k * FAN * (y - APEX_Y));
  const xs = r < 3 ? [50 - RECT, ...fan, 50 + RECT] : fan;
  xs.forEach((x, c) => PTS.push({ x: Math.round(x * 10) / 10, y, name: 'BCDE'[r] + (c + 1) }));
});
const B = (c) => 1 + c, Cr = (c) => 7 + c, D = (c) => 13 + c, E = (k) => 19 + k;
// Every drawn straight line, as its points in order.
const LINES = [
  ...KS.map((_, k) => [0, B(k + 1), Cr(k + 1), D(k + 1), E(k)]), // 4 lines from the apex to the base
  [1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11, 12], [13, 14, 15, 16, 17, 18], [19, 20, 21, 22], // horizontals
  [B(0), Cr(0), D(0)], [B(5), Cr(5), D(5)], // the rectangle's vertical sides
];
const ADJ = Array.from({ length: NP }, () => []);
const JUMPS = Array.from({ length: NP }, () => []); // JUMPS[from] = [[over, to], ...]
for (const l of LINES) {
  for (let i = 0; i + 1 < l.length; i++) { ADJ[l[i]].push(l[i + 1]); ADJ[l[i + 1]].push(l[i]); }
  for (let i = 0; i + 2 < l.length; i++) { JUMPS[l[i]].push([l[i + 1], l[i + 2]]); JUMPS[l[i + 2]].push([l[i + 1], l[i]]); }
}
const TIGER_START = [0, 3, 4]; // A, B3, B4
const GOATS = 15, STALL = 100;
const HUNT_CHOICES = ['5', '6', '7'];

/* ---------------- rules engine (shared by act, the bots and the screen) ---------------- */
const EMPTY = 0, GOAT = 1, TIGER = 2;
const SIDE = { goat: GOAT, tiger: TIGER };
const enc = (board) => board.map((c) => (c === 'G' ? GOAT : c === 'T' ? TIGER : EMPTY));
const posOf = (s) => ({ b: enc(s.board), hand: s.hand, cap: s.captured, quiet: s.quiet, side: SIDE[s.turn] });

// Legal moves as [from, to, over]: from = -1 for a placement, over = the captured goat or -1.
function genMoves(b, side, hand) {
  const out = [];
  if (side === GOAT) {
    if (hand > 0) { for (let i = 0; i < NP; i++) if (b[i] === EMPTY) out.push([-1, i, -1]); return out; }
    for (let i = 0; i < NP; i++) if (b[i] === GOAT) for (const n of ADJ[i]) if (b[n] === EMPTY) out.push([i, n, -1]);
    return out;
  }
  for (let i = 0; i < NP; i++) {
    if (b[i] !== TIGER) continue;
    for (const [o, t] of JUMPS[i]) if (b[o] === GOAT && b[t] === EMPTY) out.push([i, t, o]);
    for (const n of ADJ[i]) if (b[n] === EMPTY) out.push([i, n, -1]);
  }
  return out;
}
function hasMove(b, side, hand) {
  if (side === GOAT && hand > 0) return true; // 23 points, at most 17 pieces while placing: always room
  for (let i = 0; i < NP; i++) {
    if (b[i] !== side) continue;
    for (const n of ADJ[i]) if (b[n] === EMPTY) return true;
    if (side === TIGER) for (const [o, t] of JUMPS[i]) if (b[o] === GOAT && b[t] === EMPTY) return true;
  }
  return false;
}
function apply(p, m) {
  const b = p.b.slice();
  let { hand, cap } = p, quiet = p.quiet + 1;
  const [from, to, over] = m;
  if (from < 0) hand--; else b[from] = EMPTY;
  b[to] = p.side;
  if (over >= 0) { b[over] = EMPTY; cap++; quiet = 0; }
  return { b, hand, cap, quiet, side: GOAT + TIGER - p.side };
}
// Who has won in position p (p.side is about to move): TIGER, GOAT or 0.
function outcome(p, hunt) {
  if (p.cap >= hunt) return TIGER;
  if (!hasMove(p.b, p.side, p.hand)) return p.side === TIGER ? GOAT : TIGER;
  if (p.quiet >= STALL) return GOAT;
  return 0;
}
// Goats a tiger could capture right now, and tigers with nowhere to go.
function danger(b) {
  const goats = new Set(); let blocked = 0;
  for (let i = 0; i < NP; i++) {
    if (b[i] !== TIGER) continue;
    let m = 0;
    for (const n of ADJ[i]) if (b[n] === EMPTY) m++;
    for (const [o, t] of JUMPS[i]) if (b[o] === GOAT && b[t] === EMPTY) { m++; goats.add(o); }
    if (!m) blocked++;
  }
  return { goats, blocked };
}

/* ---------------- state ---------------- */
function setup(players, opts = {}) {
  if (players.length !== 2) throw Error('Aadu Puli Attam is for exactly two players.');
  const tigerSeat = Math.floor(Math.random() * 2);
  const hunt = HUNT_CHOICES.includes(String(opts.hunt)) ? +opts.hunt : 6;
  const board = Array(NP).fill(''), ids = Array(NP).fill('');
  TIGER_START.forEach((i, k) => { board[i] = 'T'; ids[i] = 't' + k; });
  const s = {
    phase: 'place', over: false, winners: [], log: [], level: levelOf(opts), hunt,
    players: players.map((p, i) => ({ id: p.id, name: p.name, seat: i, side: i === tigerSeat ? 'tiger' : 'goat' })),
    board, ids, hand: GOATS, captured: 0, turn: 'goat', quiet: 0, moves: 0, last: null, reason: '',
  };
  const t = s.players[tigerSeat], g = s.players[1 - tigerSeat];
  log(s, `${t.name} plays the tigers, ${g.name} the goats. The goats place first.`);
  return s;
}
const bySide = (s, side) => s.players.find((p) => p.side === side);

function act(s, pid, a) {
  const me = s.players.find((p) => p.id === pid);
  if (!me) throw Error('Only the two players at the board can move.');
  if (s.over) throw Error('The game is over.');
  if (!a || typeof a !== 'object') throw Error('Unknown move.');
  if (me.side !== s.turn) throw Error(`Wait: it's the ${s.turn === 'tiger' ? 'tigers' : 'goats'}' turn.`);
  const isPt = (i) => Number.isInteger(i) && i >= 0 && i < NP;
  const p = posOf(s);
  let m;
  if (a.type === 'place') {
    if (me.side !== 'goat') throw Error('Only goats are placed. Move a tiger along a line.');
    if (s.hand <= 0) throw Error('All your goats are on the board: move one along a line.');
    if (!isPt(a.to)) throw Error('Pick a point on the board.');
    if (s.board[a.to]) throw Error('That point is taken.');
    m = [-1, a.to, -1];
  } else if (a.type === 'move') {
    if (!isPt(a.from) || !isPt(a.to)) throw Error('Pick a point on the board.');
    const mine = me.side === 'tiger' ? 'T' : 'G';
    if (me.side === 'goat' && s.hand > 0) throw Error(`Place all your goats first (${s.hand} left).`);
    if (s.board[a.from] !== mine) throw Error(me.side === 'tiger' ? 'Pick one of your tigers.' : 'Pick one of your goats.');
    if (s.board[a.to]) throw Error('That point is taken.');
    if (ADJ[a.from].includes(a.to)) m = [a.from, a.to, -1];
    else {
      const j = JUMPS[a.from].find(([, t]) => t === a.to);
      if (!j) throw Error('Move along a drawn line to the next point.');
      if (me.side !== 'tiger') throw Error('Goats move one step at a time.');
      if (s.board[j[0]] !== 'G') throw Error('A tiger can only jump straight over a goat.');
      m = [a.from, a.to, j[0]];
    }
  } else throw Error('Unknown move.');

  const [from, to, over] = m;
  const next = apply(p, m);
  s.moves++; s.quiet = next.quiet; s.hand = next.hand; s.captured = next.cap;
  s.last = { from, to, over };
  if (from < 0) {
    s.board[to] = 'G'; s.ids[to] = 'g' + (GOATS - s.hand - 1);
    log(s, `${me.name} places a goat on ${PTS[to].name}.`);
    addFx(s, { kind: 'sound', sound: 'place' });
  } else {
    s.board[to] = s.board[from]; s.ids[to] = s.ids[from]; s.board[from] = ''; s.ids[from] = '';
    if (over >= 0) {
      s.board[over] = ''; s.ids[over] = '';
      log(s, `${me.name}'s tiger jumps ${PTS[from].name} → ${PTS[to].name} and captures a goat (${s.captured}/${s.hunt})!`);
      addFx(s, { from: `apu-pt-${over}`, to: 'apu-cap', html: `<div class="apu-ghost">${GOAT_SVG}</div>`, sound: 'steal', delay: 380 });
      addFx(s, { kind: 'float', at: 'apu-cap', text: '+1', color: '#ffb347', delay: 900 });
    } else {
      log(s, `${me.name} moves a ${me.side} ${PTS[from].name} → ${PTS[to].name}.`);
      addFx(s, { kind: 'sound', sound: 'click' });
    }
  }
  s.turn = me.side === 'tiger' ? 'goat' : 'tiger';
  s.phase = s.hand > 0 ? 'place' : 'move';
  if (s.phase === 'move' && s.hand === 0 && from < 0) log(s, 'All the goats are on the board. Now they move.');
  const win = outcome(next, s.hunt);
  if (win) {
    const side = win === TIGER ? 'tiger' : 'goat', w = bySide(s, side);
    s.reason = win === TIGER
      ? (next.cap >= s.hunt ? `The tigers captured ${s.hunt} goats.` : 'The goats have no move left.')
      : (!hasMove(next.b, TIGER, 0) ? 'Every tiger is hemmed in!' : `${STALL} moves without a capture: the tigers went hungry.`);
    s.over = true; s.phase = 'over'; s.winners = [w.id];
    log(s, `${s.reason} ${w.name} (${side === 'tiger' ? 'tigers' : 'goats'}) wins!`);
  }
}

const turnOf = (s) => (s.over ? [] : [bySide(s, s.turn).id]);
// Nothing is secret in this game.
const view = (s) => JSON.parse(JSON.stringify(s));

/* ---------------- computer players ----------------
   Easy: random moves (a tiger takes a capture it sees about half the time).
   Normal: a 2-ply look (my move, the reply) with a little noise; tigers always capture when they can, and goats
     never leave a goat to be taken, except that now and then (SLIP) Normal goats overlook the tigers and make a
     random move. Perfectly careful goats almost never lose on this board, so the slips are what give a
     player hunting with the tigers a fair game at Normal. The turn timer's move never slips.
   Hard: iterative-deepening alpha-beta, up to 6 plies within a node budget. */
const WIN = 100000;
function evaluate(p) { // from the tigers' point of view
  let mob = 0, trapped = 0, mask = 0;
  for (let i = 0; i < NP; i++) {
    if (p.b[i] !== TIGER) continue;
    let m = 0;
    for (const n of ADJ[i]) if (p.b[n] === EMPTY) m++;
    for (const [o, t] of JUMPS[i]) if (p.b[o] === GOAT && p.b[t] === EMPTY) { m++; mask |= 1 << o; }
    mob += m; if (!m) trapped++;
  }
  let caps = 0; for (let x = mask; x; x &= x - 1) caps++;
  let sc = 100 * p.cap + 5 * mob - 22 * trapped;
  if (p.side === TIGER) sc += caps ? 80 + 14 * (caps - 1) : 0; // a capture is on
  else sc += caps >= 2 ? 55 + 14 * (caps - 2) : caps * 12;     // the goats can cover one threat, not two
  sc -= Math.max(0, p.quiet - STALL + 40) * 2;                  // time is running out for hungry tigers
  return sc;
}
const ABORT = { abort: true };
function search(p, depth, alpha, beta, ply, ctx) {
  ctx.nodes++;
  if (p.cap >= ctx.hunt) return WIN - ply;
  const moves = genMoves(p.b, p.side, p.hand);
  if (!moves.length) return p.side === TIGER ? -WIN + ply : WIN - ply;
  if (p.quiet >= STALL) return -WIN + ply;
  if (depth <= 0) return evaluate(p);
  if (ctx.nodes > ctx.budget) throw ABORT;
  const tiger = p.side === TIGER;
  let kids = moves.map((m) => apply(p, m));
  if (depth >= 2) {
    const sc = kids.map((k) => evaluate(k));
    const idx = kids.map((_, i) => i).sort((a, b) => (tiger ? sc[b] - sc[a] : sc[a] - sc[b]));
    kids = idx.map((i) => kids[i]);
  }
  let best = tiger ? -Infinity : Infinity;
  for (const k of kids) {
    const v = search(k, depth - 1, alpha, beta, ply + 1, ctx);
    if (tiger) { if (v > best) best = v; if (v > alpha) alpha = v; } else { if (v < best) best = v; if (v < beta) beta = v; }
    if (alpha >= beta) break;
  }
  return best;
}
const SLIP = 0.07;
function pickMove(p, hunt, level, careful = false) {
  let moves = genMoves(p.b, p.side, p.hand);
  if (moves.length <= 1) return moves[0];
  const rnd = (a) => a[Math.floor(Math.random() * a.length)];
  const tiger = p.side === TIGER;
  if (level === 'easy') {
    const caps = moves.filter((m) => m[2] >= 0);
    return caps.length && Math.random() < 0.5 ? rnd(caps) : rnd(moves);
  }
  if (level === 'normal' && !tiger && !careful && Math.random() < SLIP) return rnd(moves);
  if (level !== 'hard') {
    if (tiger && moves.some((m) => m[2] >= 0)) moves = moves.filter((m) => m[2] >= 0);
    const ctx = { nodes: 0, budget: Infinity, hunt };
    let best = null, top = -Infinity;
    for (const m of moves) {
      const v = search(apply(p, m), 1, -Infinity, Infinity, 1, ctx);
      const sc = (tiger ? v : -v) + Math.random() * 6;
      if (sc > top) { top = sc; best = m; }
    }
    return best;
  }
  // Hard: deepen until the budget runs out; keep the best move of the deepest finished search.
  const ctx = { nodes: 0, budget: 24000, hunt };
  let order = moves.map((m) => ({ m, v: 0, j: Math.random() }));
  let best = order[0].m;
  for (let depth = 1; depth <= 6; depth++) {
    try {
      let alpha = -Infinity, beta = Infinity;
      for (const o of order) {
        const bound = tiger ? alpha : beta;
        const v = search(apply(p, o.m), depth - 1, alpha, beta, 1, ctx);
        // A move that fails low only proves it is no better than the best so far: rank it just below.
        o.v = (tiger ? v : -v) - ((tiger ? v <= bound : v >= bound) ? 0.01 : 0);
        if (tiger) alpha = Math.max(alpha, v); else beta = Math.min(beta, v);
      }
    } catch (e) {
      if (e !== ABORT) throw e;
      break;
    }
    order.sort((a, b) => b.v - a.v || b.j - a.j);
    best = order[0].m;
    if (order[0].v >= WIN - 50) break; // a forced win was found
  }
  return best;
}
function toAction(m) {
  return m[0] < 0 ? { type: 'place', to: m[1] } : { type: 'move', from: m[0], to: m[1] };
}
function bestMove(v, level, careful) {
  const m = pickMove(posOf(v), v.hunt, level, careful);
  return m ? toAction(m) : null;
}
const bot = (v) => bestMove(v, v.level);
// Time's up: the Normal computer's move is played for you.
const onTimeout = (v) => bestMove(v, 'normal', true);

/* ---------------- art ---------------- */
const DEFS = `<svg class="apu-defs" width="0" height="0" aria-hidden="true" focusable="false"><defs>
  <radialGradient id="apu-tg" cx=".38" cy=".3" r=".8"><stop offset="0" stop-color="#ffc25a"/><stop offset=".55" stop-color="#f08a1c"/><stop offset="1" stop-color="#b4500c"/></radialGradient>
  <radialGradient id="apu-gt" cx=".38" cy=".28" r=".85"><stop offset="0" stop-color="#ffffff"/><stop offset=".6" stop-color="#f1ece0"/><stop offset="1" stop-color="#c9bfa8"/></radialGradient>
  <linearGradient id="apu-horn" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b8a27a"/><stop offset="1" stop-color="#6e5a3a"/></linearGradient>
</defs></svg>`;
// Tiger: a round striped face with round ears. Goat: a long white face with curved horns and a beard.
const TIGER_SVG = `<svg viewBox="-20 -20 40 40" aria-hidden="true" focusable="false">
  <ellipse cx="1" cy="16.5" rx="14" ry="3.4" fill="#000" opacity=".32"/>
  <circle cx="-11" cy="-11" r="5.6" fill="#e07a18" stroke="#3a1a06" stroke-width="1.3"/><circle cx="-11" cy="-11" r="2.6" fill="#f9dcb6"/>
  <circle cx="11" cy="-11" r="5.6" fill="#e07a18" stroke="#3a1a06" stroke-width="1.3"/><circle cx="11" cy="-11" r="2.6" fill="#f9dcb6"/>
  <circle r="15.4" fill="url(#apu-tg)" stroke="#3a1a06" stroke-width="1.4"/>
  <path d="M-15 -3q5 1 7.5-2.5M-14.6 4.5q6 0 8.4-3.6M15 -3q-5 1-7.5-2.5M14.6 4.5q-6 0-8.4-3.6M-4.5-14.8q2.4 4.6.4 8.4M4.5-14.8q-2.4 4.6-.4 8.4M0-15.4v5.6" stroke="#24110a" stroke-width="2.3" fill="none" stroke-linecap="round"/>
  <ellipse cx="0" cy="6.6" rx="8.2" ry="6.2" fill="#fff5e3"/>
  <ellipse cx="-5.6" cy="-2.2" rx="2.3" ry="2.6" fill="#ffe14d" stroke="#3a1a06" stroke-width=".7"/><ellipse cx="-5.6" cy="-2" rx=".9" ry="1.9" fill="#111"/>
  <ellipse cx="5.6" cy="-2.2" rx="2.3" ry="2.6" fill="#ffe14d" stroke="#3a1a06" stroke-width=".7"/><ellipse cx="5.6" cy="-2" rx=".9" ry="1.9" fill="#111"/>
  <path d="M-2.8 3.2h5.6l-2.8 2.8z" fill="#5a2014"/><path d="M0 6v1.4M0 7.4q-2.2 2.2-4.4.8M0 7.4q2.2 2.2 4.4.8" stroke="#5a2014" stroke-width="1.1" fill="none" stroke-linecap="round"/>
  <ellipse cx="-6" cy="-9.5" rx="6" ry="2.8" fill="#fff" opacity=".25"/>
</svg>`;
const GOAT_SVG = `<svg viewBox="-20 -20 40 40" aria-hidden="true" focusable="false">
  <ellipse cx="1" cy="17" rx="12" ry="3" fill="#000" opacity=".3"/>
  <path d="M-4.5-11.5q-4-8.5-12-6.5q6 1 7.5 9z" fill="url(#apu-horn)" stroke="#3b3222" stroke-width="1.1" stroke-linejoin="round"/>
  <path d="M4.5-11.5q4-8.5 12-6.5q-6 1-7.5 9z" fill="url(#apu-horn)" stroke="#3b3222" stroke-width="1.1" stroke-linejoin="round"/>
  <path d="M-8-5q-10-3-12.5 3.5q6.5 2.5 12.5-.5z" fill="#e6dfcc" stroke="#3b3222" stroke-width="1.1" stroke-linejoin="round"/>
  <path d="M8-5q10-3 12.5 3.5q-6.5 2.5-12.5-.5z" fill="#e6dfcc" stroke="#3b3222" stroke-width="1.1" stroke-linejoin="round"/>
  <path d="M0-14c8.6 0 10.6 7.4 8.8 14.4C7.2 7 4.4 12.4 0 12.4S-7.2 7-8.8.4C-10.6-6.6-8.6-14 0-14z" fill="url(#apu-gt)" stroke="#3b3222" stroke-width="1.3"/>
  <path d="M-2.2 12.2l2.2 6 2.2-6z" fill="#ddd4c0" stroke="#3b3222" stroke-width=".9" stroke-linejoin="round"/>
  <ellipse cx="-4.4" cy="-3" rx="2.1" ry="1.7" fill="#c9a23a" stroke="#3b3222" stroke-width=".6"/><rect x="-5.6" y="-3.45" width="2.4" height=".9" rx=".4" fill="#111"/>
  <ellipse cx="4.4" cy="-3" rx="2.1" ry="1.7" fill="#c9a23a" stroke="#3b3222" stroke-width=".6"/><rect x="3.2" y="-3.45" width="2.4" height=".9" rx=".4" fill="#111"/>
  <ellipse cx="0" cy="7.2" rx="4.6" ry="3.4" fill="#f3d9d2"/><ellipse cx="-1.7" cy="6.6" rx=".8" ry="1.2" fill="#6b4a3e"/><ellipse cx="1.7" cy="6.6" rx=".8" ry="1.2" fill="#6b4a3e"/>
  <ellipse cx="-3.6" cy="-9.4" rx="4" ry="2" fill="#fff" opacity=".7"/>
</svg>`;
// The chalk drawing: each line twice (a soft wide smudge, then a crisp stroke), with a dot at every point.
const CHALK = (() => {
  const path = LINES.map((l) => 'M' + l.map((i) => `${PTS[i].x} ${PTS[i].y}`).join('L')).join('');
  const dots = PTS.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="1.15"/>`).join('');
  return `<svg class="apu-chalk" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <g fill="none" stroke-linecap="round" stroke-linejoin="round">
      <path d="${path}" stroke="#fff3e2" stroke-opacity=".18" stroke-width="2.4"/>
      <path d="${path}" stroke="#fff6ea" stroke-opacity=".82" stroke-width=".75" stroke-dasharray="9 .5 4 .4"/>
    </g>
    <g fill="#fff6ea" opacity=".9">${dots}</g>
  </svg>`;
})();
const pct = (p) => ({ l: p.x, t: (p.y / H) * 100 });

/* ---------------- screen ---------------- */
const UI = { sel: null, key: '', logOpen: false };
const SIDE_COLOR = { tiger: '#f59e0b', goat: '#ece6d6' };
const sideLabel = (side) => (side === 'tiger' ? 'Tigers' : 'Goats');

function render(el, v, ctx) {
  injectCSS('aadupuli', STYLE);
  const redraw = () => render(el, v, ctx);
  const key = v.players.map((p) => p.id + p.side).join();
  if (UI.key !== key) Object.assign(UI, { key, sel: null });
  const me = v.players.find((p) => p.id === ctx.me);
  const myTurn = !v.over && !!me && me.side === v.turn;
  const p = posOf(v);
  const moves = myTurn ? genMoves(p.b, p.side, p.hand) : [];
  const placing = myTurn && me.side === 'goat' && v.hand > 0;
  const movers = [...new Set(moves.filter((m) => m[0] >= 0).map((m) => m[0]))];
  if (UI.sel != null && !movers.includes(UI.sel)) UI.sel = null;
  if (myTurn && !placing && UI.sel == null && movers.length === 1) UI.sel = movers[0];
  const dests = placing ? moves : UI.sel != null ? moves.filter((m) => m[0] === UI.sel) : [];
  const destAt = new Map(dests.map((m) => [m[1], m]));
  const { goats: risky, blocked } = danger(p.b);
  const tigers = bySide(v, 'tiger'), goats = bySide(v, 'goat');
  const last = v.last || {};

  const points = PTS.map((pt, i) => {
    const d = destAt.get(i), { l, t } = pct(pt);
    const cls = ['apu-pt', d ? 'dest pulse-glow' : '', d && d[2] >= 0 ? 'cap' : '', i === last.to || i === last.from ? 'last' : '', i === last.over ? 'gone' : ''].filter(Boolean).join(' ');
    const what = v.board[i] === 'T' ? ', tiger' : v.board[i] === 'G' ? ', goat' : '';
    return `<button class="${cls}" data-pt="${i}" data-a="apu-pt-${i}" style="left:${l - 5.5}%;top:${t - 6.25}%" aria-label="${pt.name}${what}${d ? (d[2] >= 0 ? ', jump here to capture' : ', move here') : ''}" ${myTurn ? '' : 'tabindex="-1"'}></button>`;
  }).join('');
  const tokens = PTS.map((pt, i) => {
    const c = v.board[i];
    if (!c) return '';
    const { l, t } = pct(pt);
    const tiger = c === 'T';
    const cls = ['apu-tok', tiger ? 'tiger' : 'goat', movers.includes(i) ? 'can' : '', UI.sel === i ? 'sel' : '', !tiger && risky.has(i) ? 'risk' : '', i === last.to ? 'moved' : ''].filter(Boolean).join(' ');
    return `<div class="${cls}" data-k="apu-${v.ids[i]}" style="left:${l - 4.6}%;top:${t - (4.6 / H) * 100}%"><i class="apu-lift">${tiger ? TIGER_SVG : GOAT_SVG}</i></div>`;
  }).join('');

  const turnName = esc(bySide(v, v.turn).name);
  const status = v.over
    ? `${esc(v.reason)}`
    : myTurn
      ? (placing ? `Place a goat on any glowing point. ${v.hand} left to place.`
        : me.side === 'tiger'
          ? (UI.sel != null ? 'Tap a glowing point. Red rings capture a goat.' : 'Your tigers: tap one, then a glowing point.')
          : (UI.sel != null ? 'Tap a glowing point to step there.' : 'Your goats: tap one, then the point next to it.'))
      : v.turn === 'tiger' ? `${turnName}'s tigers are on the prowl…` : v.hand > 0 ? `${turnName} is placing a goat…` : `${turnName} is moving a goat…`;
  const banner = v.over ? `<div class="winner-banner">${icon('trophy')}${v.winners.includes(ctx.me) ? 'You win!' : esc(v.players.find((q) => q.id === v.winners[0]).name) + ' wins'} · ${v.winners[0] === tigers.id ? 'Tigers' : 'Goats'}</div>` : '';

  const chip = (q) => {
    const active = !v.over && v.turn === q.side;
    return `<div class="apu-player ${active ? 'turn' : ''} ${v.winners.includes(q.id) ? 'win' : ''}" data-a="apu-p-${q.id}">
      <span class="apu-face" style="--pc:${SIDE_COLOR[q.side]}">${portrait({ id: q.id, bot: !!ctx.isBot?.(q.id) })}<span class="apu-badge ${q.side}">${q.side === 'tiger' ? TIGER_SVG : GOAT_SVG}</span></span>
      <span class="apu-pname"><b>${esc(q.name)}</b><small>${q.side === 'tiger' ? '3 tigers' : '15 goats'}</small></span>
      ${q.id === ctx.me ? '<span class="tag t-you">You</span>' : ''}${active ? `<span class="tag t-good">${q.side === 'tiger' ? 'Hunting' : 'To move'}</span>` : ''}</div>`;
  };
  const capDots = Array.from({ length: v.hunt }, (_, k) => `<i class="${k < v.captured ? 'on' : ''}"></i>`).join('');
  const stats = `<div class="apu-stats">
    <div class="apu-stat"><span class="apu-mini goat">${GOAT_SVG}</span><b>${v.hand}</b><small>to place</small></div>
    <div class="apu-stat" data-a="apu-cap"><span class="apu-mini goat gone">${GOAT_SVG}</span><b>${v.captured}<em>/${v.hunt}</em></b><small>captured</small><span class="apu-capdots">${capDots}</span></div>
    <div class="apu-stat"><span class="apu-mini tiger">${TIGER_SVG}</span><b>${blocked}<em>/3</em></b><small>tigers blocked</small></div>
  </div>`;
  const quietPct = Math.min(100, (v.quiet / STALL) * 100);
  UI.logOpen = el.querySelector('.apu-logbox')?.open ?? UI.logOpen;

  morph(el, `${DEFS}<div class="apu-root"><div class="game-layout">
    <div class="felt apu-felt">
      ${banner}
      <div class="apu-head"><span class="apu-side-pill tiger">${TIGER_SVG}<b>${esc(tigers.name)}</b></span><span class="apu-vs">vs</span><span class="apu-side-pill goat">${GOAT_SVG}<b>${esc(goats.name)}</b></span></div>
      <div class="apu-yard"><div class="apu-board ${myTurn ? 'live' : ''}" role="group" aria-label="Aadu Puli Attam board">${CHALK}<div class="apu-pts">${points}</div><div class="apu-toks">${tokens}</div></div></div>
      ${stats}
      <div class="status apu-status ${myTurn ? 'myturn' : ''}">${status}</div>
    </div>
    <div class="side">
      <div class="panel apu-players">${chip(tigers)}${chip(goats)}</div>
      <div class="panel apu-rules"><h3>${icon('trophy')}How to win</h3>
        <p><b>Tigers:</b> capture ${v.hunt} goats by jumping over them.</p>
        <p><b>Goats:</b> hem in all three tigers, or survive ${STALL} moves in a row without a capture.</p>
        <div class="apu-quiet" title="Moves since the last capture"><span style="width:${quietPct}%"></span></div>
        <small class="muted">${v.quiet}/${STALL} moves since the last capture · Move ${v.moves}</small>
      </div>
      <details class="panel drawer apu-logbox" ${UI.logOpen ? 'open' : ''}><summary>${icon('book')}<span>Game log</span>${icon('chevron', 'chev')}</summary>
        <div class="drawer-body"><div class="parchment log">${v.log.slice(0, 12).map((l) => `<div>${esc(l)}</div>`).join('')}</div></div></details>
    </div>
  </div></div>`);

  const lb = el.querySelector('.apu-logbox'); if (lb) lb.ontoggle = () => { UI.logOpen = lb.open; };
  const board = el.querySelector('.apu-board');
  // Taps go to the nearest point (so small phones still get big targets); keyboard presses use the button.
  board.onclick = (e) => {
    if (!myTurn) return;
    let i = null;
    const btn = e.target.closest?.('[data-pt]');
    if (btn && e.detail === 0) i = +btn.dataset.pt;
    else {
      const r = board.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * W, y = ((e.clientY - r.top) / r.height) * H;
      let bestD = 9 * 9;
      PTS.forEach((pt, k) => { const d = (pt.x - x) ** 2 + (pt.y - y) ** 2; if (d < bestD) { bestD = d; i = k; } });
    }
    if (i == null) { if (UI.sel != null && !placing) { UI.sel = null; redraw(); } return; }
    const d = destAt.get(i);
    if (d) { UI.sel = null; sound('click'); ctx.send(toAction(d)); return; }
    if (movers.includes(i)) { UI.sel = UI.sel === i && movers.length > 1 ? null : i; sound('click'); redraw(); return; }
    if (UI.sel != null) { UI.sel = null; redraw(); }
  };
}

const STYLE = `
.apu-defs{position:absolute;width:0;height:0;overflow:hidden}
.apu-felt{display:flex;flex-direction:column;align-items:center;gap:12px;background:
  radial-gradient(90% 55% at 50% 0%,rgba(255,190,110,.28),transparent 65%),
  radial-gradient(60% 40% at 0% 100%,rgba(40,70,30,.45),transparent 70%),
  repeating-linear-gradient(90deg,rgba(255,255,255,.025) 0 2px,transparent 2px 46px),
  linear-gradient(180deg,#6b3524,#3b1d16)}
.apu-felt .winner-banner{display:flex;align-items:center;gap:10px}.apu-felt .winner-banner .ic{width:1em;height:1em}
.apu-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:center}
.apu-side-pill{display:inline-flex;align-items:center;gap:6px;padding:4px 12px 4px 4px;border-radius:999px;background:rgba(0,0,0,.25);font-weight:800;max-width:44vw}
.apu-side-pill b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.apu-side-pill svg{width:30px;height:30px;flex:none}
.apu-side-pill.tiger{box-shadow:inset 0 0 0 2px rgba(245,158,11,.6)}.apu-side-pill.goat{box-shadow:inset 0 0 0 2px rgba(236,230,214,.55)}
.apu-vs{font:700 .85rem var(--font-display);color:rgba(255,255,255,.6)}
.apu-yard{width:min(100%,620px);padding:3.5% 3% 2.5%;border-radius:26px;position:relative;
  background:radial-gradient(70% 60% at 45% 40%,#c25a32,#a4462a 60%,#86361f),#a4462a;
  box-shadow:inset 0 0 0 5px #7a5a44,inset 0 0 0 8px #5e4232,inset 0 10px 30px rgba(0,0,0,.35),0 18px 34px rgba(0,0,0,.4)}
.apu-yard::before{content:"";position:absolute;inset:8px;border-radius:20px;pointer-events:none;opacity:.5;
  background:radial-gradient(circle at 20% 30%,rgba(255,220,180,.12) 0 1px,transparent 2px) 0 0/23px 19px,radial-gradient(circle at 70% 60%,rgba(60,15,5,.18) 0 1.5px,transparent 2.5px) 0 0/31px 27px}
.apu-board{position:relative;width:100%;aspect-ratio:${W}/${H};touch-action:manipulation}
.apu-board.live{cursor:pointer}
.apu-chalk{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.apu-pts,.apu-toks{position:absolute;inset:0}
.apu-toks{pointer-events:none}
.apu-board .apu-pt,.apu-board .apu-pt:hover,.apu-board .apu-pt:focus,.apu-board .apu-pt:active{position:absolute;width:11%;height:12.5%;min-height:0;padding:0;border:0;border-radius:50%;
  background:none!important;box-shadow:none!important;transform:none!important;cursor:inherit;-webkit-tap-highlight-color:transparent}
.apu-pt::before{content:"";position:absolute;left:50%;top:50%;width:34%;height:30%;transform:translate(-50%,-50%);border-radius:50%;opacity:0}
.apu-pt.last::before{opacity:1;border:2px dashed rgba(255,240,200,.45);width:78%;height:70%}
.apu-pt.gone::before{opacity:1;width:46%;height:42%;border:0;background:radial-gradient(circle,rgba(40,5,0,.45),transparent 70%)}
.apu-pt.dest::before{opacity:1;width:58%;height:52%;background:radial-gradient(circle,rgba(255,236,170,.95) 0 22%,rgba(255,220,120,.35) 40%,transparent 70%);border:2px solid rgba(255,236,170,.85)}
.apu-pt.dest::after{content:"";position:absolute;left:50%;top:50%;width:90%;height:82%;transform:translate(-50%,-50%);border-radius:50%;
  background:radial-gradient(circle,rgba(255,226,140,.55),transparent 68%);animation:apu-breathe 1.8s ease-in-out infinite}
.apu-pt.dest.cap::before{border-color:#ff5a4a;background:radial-gradient(circle,rgba(255,120,90,.95) 0 22%,rgba(255,80,60,.3) 45%,transparent 70%)}
.apu-pt.dest.cap::after{background:radial-gradient(circle,rgba(255,90,70,.6),transparent 68%)}
@keyframes apu-breathe{0%,100%{opacity:.25}50%{opacity:1}}
.apu-pt:focus-visible{outline:3px solid #ffe08a;outline-offset:-4px}
.apu-tok{position:absolute;width:9.2%;aspect-ratio:1}
.apu-lift{display:block;width:100%;height:100%;transition:transform .18s cubic-bezier(.3,1.4,.5,1)}
.apu-lift svg{display:block;width:100%;height:100%;overflow:visible}
.apu-tok.can .apu-lift::before{content:"";position:absolute;inset:-6%;border-radius:50%;box-shadow:0 0 0 2px rgba(255,240,190,.8)}
.apu-tok.can .apu-lift{position:relative}
.apu-tok.sel .apu-lift{transform:translateY(-14%) scale(1.12)}
.apu-tok.sel .apu-lift::before{box-shadow:0 0 0 3px #ffe08a,0 0 14px 2px rgba(255,224,140,.7)}
.apu-tok.risk .apu-lift::after{content:"";position:absolute;right:-12%;top:-12%;width:42%;height:42%;border-radius:50%;
  background:#e2382b url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3E%3Cpath d='M6 4l2 12M10 3l1 13M14 4l-1 12' stroke='white' stroke-width='2.2' stroke-linecap='round'/%3E%3C/svg%3E") center/70% no-repeat;box-shadow:0 0 0 1.5px #fff}
.apu-tok.risk .apu-lift{position:relative}
.apu-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;width:min(100%,620px)}
.apu-stat{display:grid;grid-template-columns:auto 1fr;grid-template-rows:auto auto;column-gap:8px;align-items:center;padding:8px 10px;border-radius:14px;background:rgba(0,0,0,.28);box-shadow:inset 0 1px 0 rgba(255,255,255,.08)}
.apu-stat .apu-mini{grid-row:1/3;width:34px;height:34px}
.apu-mini svg{width:100%;height:100%;display:block}
.apu-mini.gone{opacity:.6;filter:grayscale(.4)}
.apu-stat b{font:700 1.35rem/1 var(--font-display);color:#fff}.apu-stat b em{font-style:normal;font-size:.85rem;color:rgba(255,255,255,.6)}
.apu-stat small{color:rgba(255,255,255,.72);font-weight:700;font-size:.72rem;line-height:1.15}
.apu-capdots{grid-column:1/3;display:flex;gap:3px;margin-top:5px}
.apu-capdots i{flex:1;height:5px;border-radius:3px;background:rgba(255,255,255,.15)}.apu-capdots i.on{background:#ff8a3d}
.apu-status{text-align:center;max-width:44ch}
.apu-player{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;align-items:center;gap:10px;padding:6px 8px;border-radius:12px}
.apu-player.turn{background:rgba(255,190,110,.14)}.apu-player.win{background:rgba(255,215,106,.18)}
.apu-face{position:relative;display:block;width:42px;height:42px;border-radius:50%;box-shadow:0 0 0 3px var(--pc)}
.apu-face>svg{display:block;width:100%;height:100%;border-radius:50%}
.apu-badge{position:absolute;right:-8px;bottom:-8px;width:24px;height:24px}.apu-badge svg{width:100%;height:100%;display:block}
.apu-pname{display:flex;flex-direction:column;min-width:0}.apu-pname b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.apu-pname small{color:var(--muted)}
.apu-rules h3{display:flex;align-items:center;gap:8px;margin:0 0 6px;font-size:1rem}.apu-rules h3 .ic{width:1em;height:1em}
.apu-rules p{margin:0 0 6px;font-size:.9rem}
.apu-quiet{height:7px;border-radius:4px;background:rgba(255,255,255,.12);overflow:hidden;margin:8px 0 4px}
.apu-quiet span{display:block;height:100%;background:linear-gradient(90deg,#8ce99a,#ffd166,#ff6b5a)}
.apu-ghost{width:100%;height:100%}.apu-ghost svg{width:100%;height:100%;display:block}
@media (max-width:480px){.apu-yard{padding:4% 2.5% 3%;border-radius:18px}.apu-stat{padding:6px;column-gap:5px}.apu-stat .apu-mini{width:26px;height:26px}.apu-stat b{font-size:1.1rem}.apu-stat small{font-size:.64rem}.apu-side-pill svg{width:24px;height:24px}}
`;

/* Cover: two children crouch over a chalk triangle scratched on red earth under a neem tree, one holding a
   tiger token and the other a goat, with a whitewashed village wall behind (ids prefixed apc-). */
function coverSVG() {
  // The board in a flattened perspective: map the 100×88 box into a trapezoid on the ground.
  const at = (p) => {
    const t = p.y / H, half = 46 + t * 40; // narrower at the back
    return [160 + ((p.x - 50) / 50) * half, 100 + t * 82];
  };
  const path = LINES.map((l) => 'M' + l.map((i) => at(PTS[i]).map((n) => n.toFixed(1)).join(' ')).join('L')).join('');
  const tok = (i, tiger) => {
    const [x, y] = at(PTS[i]), r = 4.6 + (PTS[i].y / H) * 2.6;
    return tiger
      ? `<g><ellipse cx="${x}" cy="${y + r * .7}" rx="${r}" ry="${r * .35}" fill="#000" opacity=".3"/><circle cx="${x - r * .72}" cy="${y - r * 1.05}" r="${r * .42}" fill="#e07a18" stroke="#3a1a06" stroke-width=".7"/><circle cx="${x + r * .72}" cy="${y - r * 1.05}" r="${r * .42}" fill="#e07a18" stroke="#3a1a06" stroke-width=".7"/><circle cx="${x}" cy="${y - r * .3}" r="${r}" fill="url(#apc-tg)" stroke="#3a1a06" stroke-width=".8"/><path d="M${x - r * .8} ${y - r * .5}h${r * .6}M${x + r * .2} ${y - r * .5}h${r * .6}M${x} ${y - r * 1.2}v${r * .6}" stroke="#24110a" stroke-width="1" stroke-linecap="round"/></g>`
      : `<g><ellipse cx="${x}" cy="${y + r * .7}" rx="${r}" ry="${r * .35}" fill="#000" opacity=".3"/><ellipse cx="${x}" cy="${y - r * .3}" rx="${r * .8}" ry="${r}" fill="#f6f1e6" stroke="#3b3222" stroke-width=".8"/><path d="M${x - r * .5} ${y - r * 1.1}q-${r * .6} -${r * .7} -${r} -${r * .2}M${x + r * .5} ${y - r * 1.1}q${r * .6} -${r * .7} ${r} -${r * .2}" stroke="#7a6444" stroke-width="1.1" fill="none" stroke-linecap="round"/></g>`;
  };
  const pieces = [[0, 1], [9, 1], [16, 1], [3, 0], [4, 0], [8, 0], [10, 0], [14, 0], [15, 0], [20, 0], [11, 0]].map(([i, t]) => tok(i, t)).join('');
  return `<svg viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="apc-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7a65a"/><stop offset="1" stop-color="#fbd9a0"/></linearGradient>
    <linearGradient id="apc-wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4ead6"/><stop offset="1" stop-color="#d9c6a4"/></linearGradient>
    <radialGradient id="apc-earth" cx=".5" cy=".35" r=".8"><stop offset="0" stop-color="#c8603a"/><stop offset=".7" stop-color="#a4462a"/><stop offset="1" stop-color="#7c311c"/></radialGradient>
    <radialGradient id="apc-leaf" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#7cc36a"/><stop offset="1" stop-color="#2f6b2c"/></radialGradient>
    <radialGradient id="apc-tg" cx=".38" cy=".3" r=".8"><stop offset="0" stop-color="#ffc25a"/><stop offset="1" stop-color="#c85a0e"/></radialGradient>
    <radialGradient id="apc-shade" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#2a0d05" stop-opacity=".35"/><stop offset="1" stop-color="#2a0d05" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="320" height="200" fill="url(#apc-sky)"/>
  <circle cx="262" cy="34" r="16" fill="#fff1c4" opacity=".9"/>
  <rect x="0" y="58" width="320" height="50" fill="url(#apc-wall)"/>
  <rect x="0" y="58" width="320" height="5" fill="#c9b08a"/>
  <path d="M206 108v-34q14-14 28 0v34z" fill="#6b3b24"/><path d="M210 108v-32q10-10 20 0v32z" fill="#8a5232"/>
  <g fill="#b4462c" opacity=".75"><rect x="0" y="100" width="320" height="8"/></g>
  <path d="M0 108h320v92H0z" fill="url(#apc-earth)"/>
  <g fill="#ffd9b8" opacity=".12">${[[30, 150], [70, 190], [120, 125], [250, 160], [290, 130], [200, 192], [12, 120]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.6"/>`).join('')}</g>
  <!-- neem tree -->
  <ellipse cx="62" cy="126" rx="70" ry="16" fill="url(#apc-shade)"/>
  <path d="M52 124q6-30 2-60q8 4 10 0q-4 32 4 60z" fill="#5e3a22"/>
  <path d="M58 76q-12-10-26-8M60 70q12-12 28-10" stroke="#5e3a22" stroke-width="4" fill="none" stroke-linecap="round"/>
  <g fill="url(#apc-leaf)"><circle cx="30" cy="52" r="26"/><circle cx="66" cy="34" r="30"/><circle cx="102" cy="54" r="24"/><circle cx="56" cy="64" r="20"/><circle cx="8" cy="34" r="20"/></g>
  <g fill="#a6dd8a" opacity=".35"><circle cx="58" cy="22" r="9"/><circle cx="22" cy="40" r="7"/><circle cx="96" cy="44" r="6"/></g>
  <!-- the chalk board -->
  <ellipse cx="160" cy="146" rx="104" ry="40" fill="#8e3a20" opacity=".45"/>
  <path d="${path}" fill="none" stroke="#fff6ea" stroke-opacity=".85" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
  ${pieces}
  <!-- left child, holding a goat -->
  <g transform="translate(46 128)">
    <ellipse cx="4" cy="54" rx="30" ry="10" fill="#f2efe6"/><path d="M-22 56q26 10 52 0" stroke="#d8d2c2" stroke-width="2" fill="none"/>
    <path d="M-16 50q-4-30 16-36q22 4 18 36z" fill="#2fa7b8"/>
    <path d="M10 22q20 0 30 6" stroke="#9a6440" stroke-width="7" fill="none" stroke-linecap="round"/>
    <ellipse cx="44" cy="28" rx="5" ry="6" fill="#f6f1e6" stroke="#3b3222" stroke-width="1"/>
    <circle cx="0" cy="0" r="15" fill="#9a6440"/>
    <path d="M-15 0q-2-20 15-20q18 0 15 18q-6-10-15-10q-10 0-15 12z" fill="#1d1018"/>
    <circle cx="5" cy="1" r="1.8" fill="#1a0f08"/><path d="M4 8q4 2 7-1" stroke="#5a2a1a" stroke-width="1.6" fill="none" stroke-linecap="round"/>
  </g>
  <!-- right child, with a tiger token, braids and a ribbon -->
  <g transform="translate(274 124)">
    <ellipse cx="-2" cy="58" rx="32" ry="10" fill="#ffb02e"/><path d="M-30 60q28 10 56 0" stroke="#e08a10" stroke-width="2" fill="none"/>
    <path d="M-18 54q-4-32 18-38q20 6 16 38z" fill="#d6246a"/>
    <path d="M-12 24q-18 2-28 10" stroke="#b07048" stroke-width="7" fill="none" stroke-linecap="round"/>
    <circle cx="-43" cy="34" r="6" fill="url(#apc-tg)" stroke="#3a1a06" stroke-width="1"/><path d="M-47 33h3M-42 33h3M-43 29v3" stroke="#24110a" stroke-width="1" stroke-linecap="round"/>
    <circle cx="0" cy="0" r="15" fill="#b07048"/>
    <path d="M-15 2q-3-22 15-22q18 0 15 22q-4-12-15-12q-11 0-15 12z" fill="#22101a"/>
    <path d="M13 4q8 16 2 30" stroke="#22101a" stroke-width="5" fill="none" stroke-linecap="round"/><circle cx="15" cy="34" r="3" fill="#ffd25c"/>
    <circle cx="-5" cy="1" r="1.8" fill="#1a0f08"/><path d="M-11 8q4 3 8 0" stroke="#5a2a1a" stroke-width="1.6" fill="none" stroke-linecap="round"/>
    <circle cx="-9" cy="-14" r="3" fill="#ff8a3d"/>
  </g>
  <g fill="#ffe7a8"><path d="M150 84l1.6 4.4 4.4 1.6-4.4 1.6-1.6 4.4-1.6-4.4-4.4-1.6 4.4-1.6z"/><path d="M186 92l1 3 3 1-3 1-1 3-1-3-3-1 3-1z"/></g>
</svg>`;
}

export default {
  id: 'aadupuli', name: 'Aadu Puli Attam',
  description: 'Goats and Tigers, the hunt game chalked on South Indian courtyards: three tigers pounce, fifteen goats crowd them in. Who traps whom?',
  minPlayers: 2, maxPlayers: 2,
  options: [levelOption(), { id: 'hunt', label: 'Tigers win after', default: '6', choices: HUNT_CHOICES.map((n) => [n, `${n} captures`]) }],
  cover: coverSVG(),
  defaultTimer: 45,
  howTo: {
    goal: 'Tigers: capture 6 goats (the host can pick 5 or 7). Goats: trap all three tigers so none can move.',
    turn: [
      ['🎲', 'Sides', 'Sides are drawn at random. The tigers start on the top point and the two points just below it. The goats move first.'],
      ['🐐', 'Place the goats', 'Until all 15 goats are on the board, the goat player places one on any empty point each turn. The tigers move on their turns meanwhile.'],
      ['➖', 'Move along the lines', 'Pieces step along a drawn line to the next empty point. Once all goats are placed, the goats move this way too.'],
      ['🐅', 'Pounce', 'A tiger captures by jumping over a goat next to it, in a straight line, to the empty point just beyond. One jump per turn, and capturing is never forced.'],
      ['⏳', 'Hungry tigers', '100 moves in a row (50 each) without a capture and the goats win. A player with no legal move on their turn loses.'],
    ],
    tips: [
      'Goats: fill the corners and edges first and keep goats in solid rows. A goat with an empty point behind it can be jumped.',
      'Goats in danger show a red claw badge.',
      'Tigers: stay in the open middle and keep your tigers apart. Two threats at once usually wins a goat.',
      'The tigers are strongest while goats are still being placed, so hunt early.',
    ],
  },
  setup, act, turnOf, view, bot, onTimeout, render,
};
// Exposed for tests (tools/aadupuli-test.mjs).
export const AADUPULI = { PTS, LINES, ADJ, JUMPS, TIGER_START, STALL, genMoves, pickMove, posOf, outcome };
