// Aadu Puli Attam (games/aadupuli.js): the 23-point board graph, placement, tiger steps and captures,
// win conditions both ways, the stall rule, illegal actions, JSON-safe state and the computer levels.
//   node tools/aadupuli-test.mjs [games=60]
import assert from 'node:assert/strict';
import game, { AADUPULI } from '../games/aadupuli.js';
import { seededRandom } from './seed.mjs';

const { PTS, LINES, ADJ, JUMPS, TIGER_START, STALL } = AADUPULI;
Math.random = seededRandom('aadupuli-test');
const players = [{ id: 'P0', name: 'Asha' }, { id: 'P1', name: 'Ravi' }];
const clone = (x) => JSON.parse(JSON.stringify(x));
const idx = (name) => PTS.findIndex((p) => p.name === name);
const sideOf = (s, side) => s.players.find((p) => p.side === side).id;
// A fresh game with a chosen board: tigers and goats at the named points, it's `turn`'s move.
function position({ tigers, goats, hand = 0, turn = 'tiger', captured = 0, quiet = 0, hunt }) {
  const s = game.setup(players, hunt ? { hunt } : {});
  s.board = Array(23).fill(''); s.ids = Array(23).fill('');
  tigers.forEach((n, k) => { s.board[idx(n)] = 'T'; s.ids[idx(n)] = 't' + k; });
  goats.forEach((n, k) => { s.board[idx(n)] = 'G'; s.ids[idx(n)] = 'g' + k; });
  Object.assign(s, { hand, turn, captured, quiet, phase: hand > 0 ? 'place' : 'move' });
  return s;
}
const T = (s) => sideOf(s, 'tiger'), G = (s) => sideOf(s, 'goat');
const mv = (s, pid, from, to) => game.act(s, pid, { type: 'move', from: idx(from), to: idx(to) });

// ---- the board graph ----
{
  assert.equal(PTS.length, 23, '23 points');
  assert.equal(new Set(PTS.map((p) => p.name)).size, 23, 'every point has its own name');
  assert.deepEqual([1, 6, 6, 6, 4], ['A', 'B', 'C', 'D', 'E'].map((r) => PTS.filter((p) => p.name[0] === r).length), 'apex + rows of 6, 6, 6 and 4');
  let edges = 0;
  for (let i = 0; i < 23; i++) {
    assert.equal(new Set(ADJ[i]).size, ADJ[i].length, `no duplicate neighbours at ${PTS[i].name}`);
    for (const n of ADJ[i]) { assert.ok(ADJ[n].includes(i), `adjacency is symmetric (${PTS[i].name}-${PTS[n].name})`); edges++; }
    assert.ok(ADJ[i].length >= 2, `${PTS[i].name} connects to at least two points`);
  }
  assert.equal(edges / 2, 38, '38 drawn segments');
  assert.deepEqual(ADJ[0].map((i) => PTS[i].name).sort(), ['B2', 'B3', 'B4', 'B5'], 'the apex joins the four lines below it');
  // Every line is straight on the drawing, and each consecutive pair is an edge.
  for (const l of LINES) {
    const [a, b] = [PTS[l[0]], PTS[l[l.length - 1]]];
    for (const i of l) {
      const p = PTS[i], cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
      assert.ok(Math.abs(cross) / Math.hypot(b.x - a.x, b.y - a.y) < 0.15, `line ${l.map((k) => PTS[k].name).join('-')} is straight at ${p.name}`);
    }
  }
  let jumps = 0;
  for (let i = 0; i < 23; i++) for (const [o, t] of JUMPS[i]) {
    jumps++;
    assert.ok(ADJ[i].includes(o) && ADJ[o].includes(t) && t !== i, `jump ${PTS[i].name} over ${PTS[o].name} follows two edges`);
    assert.ok(LINES.some((l) => { const a = l.indexOf(i), b = l.indexOf(o), c = l.indexOf(t); return a >= 0 && b >= 0 && c >= 0 && Math.abs(a - b) === 1 && b - a === c - b; }), `jump ${PTS[i].name}-${PTS[o].name}-${PTS[t].name} lies on one straight line`);
    assert.ok(JUMPS[t].some(([o2, t2]) => o2 === o && t2 === i), 'jumps work both ways');
  }
  assert.equal(jumps, 56, '28 jump lines, each usable both ways');
  // Turning a corner at the apex is not a straight line.
  assert.ok(!JUMPS[idx('B3')].some(([o, t]) => o === 0 && t === idx('B4')), 'no jump around the apex');
}

// ---- setup ----
{
  const sides = new Set();
  for (let r = 0; r < 20; r++) {
    const s = game.setup(players);
    sides.add(T(s));
    assert.deepEqual(s.board.map((c, i) => (c === 'T' ? i : -1)).filter((i) => i >= 0), TIGER_START, 'tigers start on A, B3, B4');
    assert.equal(s.board.filter((c) => c === 'G').length, 0);
    assert.equal(s.hand, 15); assert.equal(s.turn, 'goat'); assert.equal(s.phase, 'place');
    assert.deepEqual(game.turnOf(s), [G(s)], 'the goats place first');
    assert.equal(s.hunt, 6);
    assert.doesNotThrow(() => JSON.stringify(s));
  }
  assert.equal(sides.size, 2, 'either player can be drawn as the tigers');
  assert.equal(game.setup(players, { hunt: '5' }).hunt, 5);
  assert.equal(game.setup(players, { hunt: '7' }).hunt, 7);
  assert.equal(game.setup(players, { hunt: '99' }).hunt, 6, 'unknown option falls back to 6');
  assert.equal(game.view(game.setup(players, { level: 'hard' }), 'P0').level, 'hard');
  assert.throws(() => game.setup([players[0]]), /two players/);
}

// ---- placement ----
{
  const s = game.setup(players), g = G(s), t = T(s);
  assert.throws(() => game.act(s, t, { type: 'move', from: 0, to: idx('B2') }), /goats' turn/, 'not the tigers turn');
  assert.throws(() => game.act(s, g, { type: 'place', to: 0 }), /taken/, 'cannot place on a tiger');
  assert.throws(() => game.act(s, g, { type: 'place', to: 23 }), /point on the board/);
  assert.throws(() => game.act(s, g, { type: 'place', to: 'B1' }), /point on the board/);
  assert.throws(() => game.act(s, g, { type: 'move', from: idx('B1'), to: idx('C1') }), /Place all your goats/);
  assert.throws(() => game.act(s, 'stranger', { type: 'place', to: 1 }), /players at the board/);
  assert.throws(() => game.act(s, g, { type: 'dance' }), /Unknown move/);
  assert.throws(() => game.act(s, g, null), /Unknown move/);
  game.act(s, g, { type: 'place', to: idx('E1') });
  assert.equal(s.board[idx('E1')], 'G'); assert.equal(s.hand, 14); assert.equal(s.turn, 'tiger');
  assert.throws(() => game.act(s, g, { type: 'place', to: idx('E2') }), /tigers' turn/, 'one goat per turn');
  assert.throws(() => game.act(s, t, { type: 'place', to: idx('E2') }), /Only goats are placed/);
  mv(s, t, 'A', 'B2'); // tigers move during placement
  assert.equal(s.board[idx('B2')], 'T');
  game.act(s, g, { type: 'place', to: idx('E2') });
  assert.throws(() => game.act(s, g, { type: 'place', to: idx('E3') }), /tigers' turn/);
  // Place all 15 (alternating with tiger steps back and forth) and the goats start moving.
  const s2 = game.setup(players), g2 = G(s2), t2 = T(s2);
  const spots = ['B1', 'C1', 'D1', 'B6', 'C6', 'D6', 'E1', 'E2', 'E3', 'E4', 'D2', 'D5', 'D3', 'D4', 'C2'];
  let back = false;
  for (const sp of spots) {
    game.act(s2, g2, { type: 'place', to: idx(sp) });
    if (s2.over) break;
    if (back) mv(s2, t2, 'B5', 'A'); else mv(s2, t2, 'A', 'B5');
    back = !back;
  }
  assert.equal(s2.hand, 0); assert.equal(s2.phase, 'move');
  assert.equal(s2.board.filter((c) => c === 'G').length, 15);
  assert.throws(() => game.act(s2, g2, { type: 'place', to: idx('C3') }), /All your goats are on the board/);
  assert.equal(s2.turn, 'goat');
  assert.throws(() => mv(s2, g2, 'C2', 'C4'), /one step/, 'goats step one point only');
  assert.throws(() => mv(s2, g2, 'B5', 'B6'), /your goats/, "goats can't move a tiger");
  assert.throws(() => mv(s2, g2, 'C1', 'C2'), /taken/, 'occupied target');
  mv(s2, g2, 'C2', 'C3');
  assert.equal(s2.board[idx('C3')], 'G'); assert.equal(s2.turn, 'tiger');
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(s2)));
}

// ---- tiger steps and captures ----
{
  const s = position({ tigers: ['C3', 'E1', 'E4'], goats: ['C4', 'D3', 'B3', 'C2', 'D6'] });
  const t = T(s);
  assert.throws(() => mv(s, t, 'C3', 'D4'), /drawn line/, 'no diagonal that is not drawn');
  assert.throws(() => mv(s, t, 'C3', 'C6'), /drawn line/, 'no long slides');
  assert.throws(() => mv(s, t, 'C3', 'C4'), /taken/, "can't step onto a goat");
  assert.throws(() => mv(s, t, 'C3', 'D3'), /taken/);
  assert.throws(() => mv(s, t, 'C4', 'C5'), /your tigers/, 'tigers move tigers only');
  // B3 over C3? C3 is the tiger itself. Jump over C2 lands on C1 (empty): legal.
  // Jump over D3 lands on E2 (empty): legal. Jump over B3 lands on A... B3-C3 are on the same line as A.
  const t1 = clone(s); mv(t1, t, 'C3', 'A');
  assert.equal(t1.board[idx('B3')], '', 'jumping over B3 to the apex captures it');
  assert.equal(t1.captured, 1); assert.equal(t1.quiet, 0); assert.equal(t1.board[0], 'T'); assert.equal(t1.board[idx('C3')], '');
  assert.equal(t1.last.over, idx('B3'));
  const t2 = clone(s); mv(t2, t, 'C3', 'C5'); assert.equal(t2.board[idx('C4')], ''); assert.equal(t2.captured, 1);
  const t3 = clone(s); mv(t3, t, 'C3', 'E2'); assert.equal(t3.board[idx('D3')], ''); assert.equal(t3.captured, 1);
  const t4 = clone(s); mv(t4, t, 'C3', 'C1'); assert.equal(t4.board[idx('C2')], '');
  // Landing must be empty; the goat must be there; tigers can't jump tigers.
  const s5 = position({ tigers: ['C3', 'C5', 'E4'], goats: ['C4', 'B1'] });
  assert.throws(() => mv(s5, T(s5), 'C3', 'C5'), /taken/, 'landing point must be empty');
  const s6 = position({ tigers: ['C3', 'E1', 'E4'], goats: ['B1'] });
  assert.throws(() => mv(s6, T(s6), 'C3', 'C5'), /only jump straight over a goat/, 'no capture through an empty point');
  const s7 = position({ tigers: ['C3', 'C4', 'E4'], goats: ['B1'] });
  assert.throws(() => mv(s7, T(s7), 'C3', 'C5'), /only jump straight over a goat/, "tigers don't jump tigers");
  // The apex ends every line through it, so nothing can be jumped over it.
  assert.ok(JUMPS.every((js) => js.every(([o]) => o !== 0)), 'no jump passes over the apex');
  const s8 = position({ tigers: ['B2', 'E1', 'E4'], goats: ['A', 'B3', 'B4'] });
  assert.throws(() => mv(s8, T(s8), 'B2', 'B5'), /drawn line/, 'no jump around the apex corner');
  assert.throws(() => mv(s8, T(s8), 'B2', 'B4'), /taken/);
  // Goats never jump.
  const s9 = position({ tigers: ['C3', 'E1', 'E4'], goats: ['C2', 'B1'], turn: 'goat' });
  assert.throws(() => mv(s9, G(s9), 'C2', 'C4'), /one step/);
  // Rectangle sides: B1-C1-D1 is a line, so a tiger on B1 can jump a goat on C1 to D1.
  const s10 = position({ tigers: ['B1', 'E2', 'E4'], goats: ['C1', 'E1'] });
  mv(s10, T(s10), 'B1', 'D1'); assert.equal(s10.captured, 1);
  // The outer points don't connect to the base row.
  const s11 = position({ tigers: ['D1', 'C3', 'E4'], goats: ['B6'] });
  assert.throws(() => mv(s11, T(s11), 'D1', 'E1'), /drawn line/);
}

// ---- winning: tigers by captures, goats by trapping, goats stuck, stall ----
{
  const s = position({ tigers: ['C3', 'E1', 'E4'], goats: ['C4', 'B6', 'D6'], captured: 5 });
  mv(s, T(s), 'C3', 'C5');
  assert.ok(s.over); assert.deepEqual(s.winners, [T(s)]); assert.match(s.reason, /captured 6/);
  assert.deepEqual(game.turnOf(s), []);
  assert.throws(() => mv(s, G(s), 'B6', 'B5'), /over/);
  // hunt option: 7 captures needed
  const s7 = position({ tigers: ['C3', 'E1', 'E4'], goats: ['C4', 'B6', 'D6'], captured: 5, hunt: '7' });
  mv(s7, T(s7), 'C3', 'C5'); assert.ok(!s7.over, 'with 7 to hunt, 6 is not enough');
  // Goats trap: tiger on A with B2..B5 full and the jump points (C2..C5) full too. The other tigers boxed in.
  // Tigers at A, E1, E4. A: neighbours B2-B5 goats, jumps to C2-C5 goats. E1: neighbours D2, E2 goats, jumps C3, E3 goats.
  // E4: D5, E3 goats, jumps C4 (goat), E2 (goat). The goats move C1→... leave all that intact: a goat steps B1→... wait.
  const trap = position({
    tigers: ['A', 'E1', 'E4'],
    goats: ['B2', 'B3', 'B4', 'B5', 'C2', 'C3', 'C4', 'C5', 'D2', 'E2', 'E3', 'D5', 'B1'],
    turn: 'goat',
  });
  mv(trap, G(trap), 'B1', 'C1');
  assert.ok(trap.over, 'the tigers have no move'); assert.deepEqual(trap.winners, [G(trap)]); assert.match(trap.reason, /hemmed in/);
  // Goats stuck: every goat is blocked after the tiger's move, so the tigers win.
  const stuck = position({ tigers: ['C1', 'D2', 'B6'], goats: ['D1'], captured: 0 });
  // D1's neighbours: C1 (tiger) and D2 (tiger). A tiger step elsewhere leaves the goat stuck.
  mv(stuck, T(stuck), 'B6', 'C6');
  assert.ok(stuck.over); assert.deepEqual(stuck.winners, [T(stuck)]); assert.match(stuck.reason, /no move/);
  // Stall: after STALL moves without a capture, the goats win.
  const st = position({ tigers: ['C3', 'E1', 'E4'], goats: ['B1', 'B6'], quiet: STALL - 1 });
  mv(st, T(st), 'C3', 'C4');
  assert.ok(st.over); assert.deepEqual(st.winners, [G(st)]); assert.match(st.reason, /went hungry/);
  const st2 = position({ tigers: ['C3', 'E1', 'E4'], goats: ['B1', 'B6'], quiet: STALL - 2 });
  mv(st2, T(st2), 'C3', 'C4'); assert.ok(!st2.over, 'one move short of the stall');
  // A capture resets the count.
  const st3 = position({ tigers: ['C3', 'E1', 'E4'], goats: ['C4', 'B6'], quiet: STALL - 1 });
  mv(st3, T(st3), 'C3', 'C5'); assert.ok(!st3.over); assert.equal(st3.quiet, 0);
}

// ---- bots: always legal; Normal tigers capture; Normal goats don't leave a goat hanging; timeout ----
{
  const s = position({ tigers: ['C3', 'E1', 'E4'], goats: ['C4', 'B1', 'B6'] });
  for (let r = 0; r < 10; r++) {
    const a = game.bot({ ...clone(s), level: 'normal' }, T(s));
    const n = clone(s); game.act(n, T(s), a); assert.equal(n.captured, 1, 'Normal tigers capture when they can');
  }
  const h = game.bot({ ...clone(s), level: 'hard' }, T(s)); const n = clone(s); game.act(n, T(s), h); assert.equal(n.captured, 1, 'Hard sees the free goat');
  // The first goat: many points next to the tigers would hang it. Normal goats (and the timer's move, which
  // never slips) keep it safe; Normal's occasional slip is rare.
  const g = game.setup(players);
  const hangs = (a) => { const n2 = clone(g); game.act(n2, G(g), a); const tig = AADUPULI.posOf(n2); return AADUPULI.genMoves(tig.b, 2, 0).some((m) => m[2] >= 0); };
  let slips = 0;
  for (let r = 0; r < 200; r++) {
    if (hangs(game.bot({ ...clone(g), level: 'normal' }, G(g)))) slips++;
    if (r < 20) assert.ok(!hangs(game.onTimeout(clone(g), G(g))), 'the timeout move never hangs a goat');
  }
  assert.ok(slips <= 20, `Normal goats rarely hang a goat (${slips}/200)`);
  const to = game.onTimeout(clone(g), G(g)); assert.equal(to.type, 'place');
  assert.doesNotThrow(() => game.act(clone(g), G(g), to));
}

// ---- Hard beats Easy, sides alternating ----
{
  const N = Number(process.argv[2] || 60);
  let hard = 0, easy = 0, hardT = 0, hardG = 0, moves = 0;
  const t0 = Date.now();
  for (let r = 0; r < N; r++) {
    Math.random = seededRandom(`aadupuli-levels:${r}`);
    let s = game.setup(players);
    const hardSide = r % 2 ? 'tiger' : 'goat';
    const hardId = sideOf(s, hardSide);
    let steps = 0;
    while (!s.over && steps++ < 5000) {
      const [pid] = game.turnOf(s);
      const v = clone(game.view(s, pid));
      const a = game.bot({ ...v, level: pid === hardId ? 'hard' : 'easy' }, pid);
      game.act(s, pid, a);
      s = clone(s);
    }
    assert.ok(s.over, 'every game finishes');
    moves += steps;
    if (s.winners.includes(hardId)) { hard++; if (hardSide === 'tiger') hardT++; else hardG++; } else if (s.winners.length) easy++;
  }
  const rate = hard / Math.max(1, hard + easy);
  console.log(`Hard vs Easy: Hard won ${hard}, Easy won ${easy} (${Math.round(rate * 100)}%); Hard as tigers ${hardT}/${Math.ceil(N / 2)}, as goats ${hardG}/${Math.floor(N / 2)}; avg ${Math.round(moves / N)} moves; ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  assert.ok(rate >= 0.62, 'Hard wins at least 62% of decided games');
}

// ---- Normal vs Normal finishes, Hard vs Hard finishes (a quick look at balance) ----
for (const level of ['normal', 'hard']) {
  let tig = 0, goa = 0;
  for (let r = 0; r < 10; r++) {
    Math.random = seededRandom(`aadupuli-${level}:${r}`);
    let s = game.setup(players, { level });
    while (!s.over) { const [pid] = game.turnOf(s); game.act(s, pid, game.bot(clone(game.view(s, pid)), pid)); s = clone(s); }
    if (s.winners[0] === sideOf(s, 'tiger')) tig++; else goa++;
  }
  console.log(`${level} vs ${level}: tigers ${tig}, goats ${goa}`);
}
console.log('aadupuli: all tests passed');
