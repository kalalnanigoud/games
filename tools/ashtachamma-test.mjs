// Ashta Chamma (games/ashtachamma.js): cowrie throws and their odds, every player's 25-square path, entering,
// moving, the exact finish, castles, captures (back home + extra throw), extra throws on 4 and 8, the
// capture-before-the-inner-ring rule, lost throws, winning, illegal actions, JSON-safe state, timeouts and
// computer levels (Hard beats Easy).
//   node tools/ashtachamma-test.mjs [games=100]
import assert from 'node:assert/strict';
import game, { _internals as I } from '../games/ashtachamma.js';
import { seededRandom } from './seed.mjs';

Math.random = seededRandom('ashtachamma-test');
const players = (n) => Array.from({ length: n }, (_, i) => ({ id: 'P' + i, name: ['Ravi', 'Asha', 'Kiran', 'Meena'][i] }));
const rc = (cell) => [Math.floor(cell / 5), cell % 5];
const clone = (x) => JSON.parse(JSON.stringify(x));
// Force the next shells: k of them mouth-up (Math.random < .5 gives 0 from rand(2), so feed values).
function withShells(up, fn) {
  const real = Math.random, seq = [0, 1, 2, 3].map((i) => (i < up ? 0.9 : 0.1));
  let i = 0;
  Math.random = () => (i < seq.length ? seq[i++] : real());
  try { return fn(); } finally { Math.random = real; }
}
const throwK = (s, pid, up) => withShells(up, () => game.act(s, pid, { type: 'throw' }));
const fresh = (n = 2, turn = 0) => { const s = game.setup(players(n)); s.turn = turn; return s; };

// ---- shells: values and odds ----
{
  assert.equal(I.valueOf([0, 0, 0, 0]), 8, 'none mouth-up is 8 (ashta)');
  assert.equal(I.valueOf([1, 1, 1, 1]), 4, 'all four up is 4 (chamma)');
  assert.equal(I.valueOf([1, 0, 0, 0]), 1); assert.equal(I.valueOf([1, 1, 0, 0]), 2); assert.equal(I.valueOf([0, 1, 1, 1]), 3);
  const count = { 1: 0, 2: 0, 3: 0, 4: 0, 8: 0 }, N = 16000;
  for (let k = 0; k < N; k++) {
    const s = fresh(2); s.players[0].pieces = [0, 24, 24, 24]; s.players[0].hit = true; // a piece that can always move a little
    game.act(s, 'P0', { type: 'throw' });
    assert.ok(s.shells.every((x) => x === 0 || x === 1) && s.shells.length === 4);
    count[s.value]++;
  }
  for (const [v, p] of Object.entries(I.THROW_P)) {
    const f = count[v] / N;
    assert.ok(Math.abs(f - p) < 0.02, `throw ${v}: ${f.toFixed(3)} vs ${p.toFixed(3)}`);
  }
  assert.ok(count[8] < count[1] && count[4] < count[3], '4 and 8 are the rare throws');
}
// ---- paths: 25 squares, outer anticlockwise from home, inner clockwise, centre last ----
{
  const ang = (cell) => { const [r, c] = rc(cell); return Math.atan2(2 - r, c - 2); }; // maths angle, y up
  const turn = (a, b) => { let d = ang(b) - ang(a); while (d <= -Math.PI) d += 2 * Math.PI; while (d > Math.PI) d -= 2 * Math.PI; return d; };
  const homes = [[4, 2], [2, 4], [0, 2], [2, 0]];
  I.PATHS.forEach((path, side) => {
    assert.equal(path.length, 25, 'a path has 25 squares');
    assert.equal(new Set(path).size, 25, 'every square once');
    assert.deepEqual(rc(path[0]), homes[side], 'it starts on the home square in the middle of its side');
    for (let k = 1; k < 25; k++) { const [a, b] = [rc(path[k - 1]), rc(path[k])]; assert.equal(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]), 1, 'each step goes to a neighbouring square'); }
    path.slice(0, 16).forEach((cell) => { const [r, c] = rc(cell); assert.ok(r === 0 || r === 4 || c === 0 || c === 4, 'the first 16 are the outer ring'); });
    path.slice(16, 24).forEach((cell) => { const [r, c] = rc(cell); assert.ok(r >= 1 && r <= 3 && c >= 1 && c <= 3 && cell !== 12, 'then 8 on the inner ring'); });
    for (let k = 1; k < 16; k++) assert.ok(turn(path[k - 1], path[k]) > 0, `side ${side}: the outer ring goes anticlockwise`);
    for (let k = 17; k < 24; k++) assert.ok(turn(path[k - 1], path[k]) < 0, `side ${side}: the inner ring goes clockwise`);
    assert.equal(path[24], 12, 'and ends at the centre');
  });
  assert.deepEqual([...I.SAFE].sort((a, b) => a - b), [2, 10, 12, 14, 22], 'castles: the four homes and the centre');
  const s = game.setup(players(2));
  assert.deepEqual(s.players.map((p) => p.side), [0, 2], 'two players sit opposite each other');
  assert.deepEqual(game.setup(players(4)).players.map((p) => p.side), [0, 1, 2, 3]);
}
// ---- setup and turn order ----
{
  const firsts = new Set();
  for (let i = 0; i < 60; i++) { const s = game.setup(players(3)); firsts.add(s.turn); assert.equal(s.phase, 'throw'); assert.ok(s.players.every((p) => p.pieces.every((x) => x === -1))); }
  assert.equal(firsts.size, 3, 'anyone may throw first');
  const s = fresh(3, 1);
  assert.deepEqual(game.turnOf(s), ['P1']);
}
// ---- entering and moving ----
{
  const s = fresh(2);
  throwK(s, 'P0', 2);
  assert.equal(s.phase, 'move'); assert.equal(s.throw, 2);
  assert.equal(I.legalMoves(s, s.players[0], 2).length, 4, 'any waiting piece can come in, with any throw');
  game.act(s, 'P0', { type: 'move', piece: 1 });
  assert.deepEqual(s.players[0].pieces, [-1, 0, -1, -1], 'entering puts the piece on its home square');
  assert.deepEqual(game.turnOf(s), ['P1'], 'a 2 earns no extra throw: the turn passes');
  throwK(s, 'P1', 1); game.act(s, 'P1', { type: 'move', piece: 0 });
  throwK(s, 'P0', 3);
  game.act(s, 'P0', { type: 'move', piece: 1 });
  assert.equal(s.players[0].pieces[1], 3, 'a piece moves the number thrown');
  assert.equal(I.PATHS[0][3], 3 * 5 + 4, 'along its own path');
}
// ---- exact finish ----
{
  const s = fresh(2); const p = s.players[0]; p.hit = true; p.pieces = [22, 24, 24, 24];
  throwK(s, 'P0', 3);
  assert.equal(s.phase, 'throw', 'a 3 cannot be used (it would overshoot the centre): the throw is lost');
  assert.deepEqual(game.turnOf(s), ['P1']);
  assert.match(s.log[0], /no piece can use it/);
  s.turn = 0; throwK(s, 'P0', 2);
  assert.equal(s.phase, 'move');
  game.act(s, 'P0', { type: 'move', piece: 0 });
  assert.equal(p.pieces[0], 24, 'exactly 2 reaches the centre');
  assert.ok(s.over, 'all four in the centre: the game is over'); assert.deepEqual(s.winners, ['P0']);
  assert.deepEqual(game.turnOf(s), []);
  assert.throws(() => game.act(s, 'P1', { type: 'throw' }), /over/);
  const t = fresh(2); t.players[0].hit = true; t.players[0].pieces = [21, 23, -1, -1];
  throwK(t, 'P0', 3); assert.throws(() => game.act(t, 'P0', { type: 'move', piece: 1 }), /needs exactly 1/);
}
// ---- castles: safe and shared ----
{
  const s = fresh(2); const [a, b] = s.players;
  // P1 (top, side 2) sits on P0's home square (path step 8 for P1); P0 enters onto it: no capture.
  b.pieces = [8, -1, -1, -1]; assert.equal(I.PATHS[2][8], I.PATHS[0][0]);
  throwK(s, 'P0', 1); game.act(s, 'P0', { type: 'move', piece: 0 });
  assert.deepEqual(b.pieces, [8, -1, -1, -1], 'nothing is captured on a castle');
  assert.equal(game.turnOf(s)[0], 'P1', 'and no extra throw');
  // The right-hand home (step 4 for P0) is a castle too.
  const t = fresh(2); t.players[1].pieces = [12, -1, -1, -1]; t.players[0].pieces = [2, -1, -1, -1]; assert.equal(I.PATHS[2][12], I.PATHS[0][4]);
  throwK(t, 'P0', 2); game.act(t, 'P0', { type: 'move', piece: 0 });
  assert.deepEqual(t.players[1].pieces, [12, -1, -1, -1]);
  // Your own pieces may share any square.
  const u = fresh(2); u.players[0].pieces = [1, 3, -1, -1];
  throwK(u, 'P0', 2); game.act(u, 'P0', { type: 'move', piece: 0 });
  assert.deepEqual(u.players[0].pieces, [3, 3, -1, -1]);
}
// ---- captures send pieces home and earn a throw ----
{
  const s = fresh(2); const [a, b] = s.players;
  a.pieces = [1, -1, -1, -1];
  const k2 = I.PATHS[2].indexOf(I.PATHS[0][2]); b.pieces = [k2, k2, -1, -1]; // two of Asha's pieces on (4,4), Ravi's step 2
  assert.equal(I.PATHS[2][k2], I.PATHS[0][2]);
  assert.equal(a.hit, false);
  throwK(s, 'P0', 1); game.act(s, 'P0', { type: 'move', piece: 0 });
  assert.deepEqual(b.pieces, [-1, -1, -1, -1], 'every rival piece on that square goes back off the board');
  assert.equal(a.hit, true, 'the capture is recorded (the inner ring opens)');
  assert.equal(s.phase, 'throw'); assert.deepEqual(game.turnOf(s), ['P0'], 'a capture earns another throw');
  assert.match(s.note.self, /Captured Asha’s piece! Throw again/);
  assert.match(s.log[0], /Ravi captures 2 of Asha’s pieces/);
  assert.ok(s.fx.some((f) => f.text === 'Captured!' && f.at === `ac-c-${I.PATHS[0][2]}`), 'everyone sees it');
  // Inner-ring captures work too.
  const t = fresh(2); t.players[0].hit = true; t.players[1].hit = true;
  t.players[0].pieces = [16, -1, -1, -1];
  const target = I.PATHS[0][18], kB = I.PATHS[2].indexOf(target);
  assert.ok(kB >= 16 && kB < 24); t.players[1].pieces = [kB, -1, -1, -1];
  throwK(t, 'P0', 2); game.act(t, 'P0', { type: 'move', piece: 0 });
  assert.deepEqual(t.players[1].pieces, [-1, -1, -1, -1]);
}
// ---- extra throws on 4 and 8 ----
{
  for (const [up, v] of [[4, 4], [0, 8]]) {
    const s = fresh(2); s.players[0].pieces = [0, -1, -1, -1];
    throwK(s, 'P0', up);
    assert.equal(s.throw, v); assert.equal(s.phase, 'move');
    assert.match(s.note.self, /throw again/);
    game.act(s, 'P0', { type: 'move', piece: 0 });
    assert.equal(s.players[0].pieces[0], v);
    assert.equal(s.phase, 'throw'); assert.deepEqual(game.turnOf(s), ['P0'], `a ${v} earns another throw after the move`);
    assert.match(s.note.self, new RegExp(`^${v}! Throw again`));
    throwK(s, 'P0', 1); game.act(s, 'P0', { type: 'move', piece: 0 });
    assert.deepEqual(game.turnOf(s), ['P1'], 'then a plain throw ends the turn');
  }
  // A capture with a 4 still earns just one more throw.
  const s = fresh(2); s.players[1].pieces = [I.PATHS[2].indexOf(I.PATHS[0][5]), -1, -1, -1];
  s.players[0].pieces = [1, -1, -1, -1];
  throwK(s, 'P0', 4); game.act(s, 'P0', { type: 'move', piece: 0 });
  assert.deepEqual(s.players[1].pieces, [-1, -1, -1, -1]);
  throwK(s, 'P0', 2); game.act(s, 'P0', { type: 'move', piece: 0 });
  assert.deepEqual(game.turnOf(s), ['P1'], 'one extra throw, not two');
}
// ---- capture before the inner ring ----
{
  const s = fresh(2); const a = s.players[0];
  a.pieces = [14, 15, 13, -1];
  throwK(s, 'P0', 1);
  const legal = I.legalMoves(s, a, 1).map((m) => m.piece).sort();
  assert.deepEqual(legal, [0, 2, 3], 'pieces may reach the end of the outer ring, but not turn in');
  assert.throws(() => game.act(s, 'P0', { type: 'move', piece: 1 }), /Capture a piece first/);
  game.act(s, 'P0', { type: 'move', piece: 0 });
  assert.equal(a.pieces[0], 15);
  const t = fresh(2); t.players[0].pieces = [15, 15, 15, 14];
  throwK(t, 'P0', 2);
  assert.deepEqual(game.turnOf(t), ['P1'], 'with nothing able to move, the 2 is lost');
  const u = fresh(2); u.players[0].pieces = [15, 15, 15, 14]; u.players[0].hit = true;
  throwK(u, 'P0', 2); game.act(u, 'P0', { type: 'move', piece: 0 });
  assert.equal(u.players[0].pieces[0], 17, 'after a capture the inner ring is open');
  // Safety valve: if every player is stuck at the end of the outer ring, everyone is let in.
  const w = fresh(2); w.players[0].pieces = [15, 15, 15, 15]; w.players[1].pieces = [15, 15, 15, 14];
  w.turn = 1; throwK(w, 'P1', 1); game.act(w, 'P1', { type: 'move', piece: 3 });
  assert.ok(w.players.every((p) => p.hit), 'nobody could ever move again, so the inner ring opens for all');
}
// ---- lost throws: no stall ----
{
  const s = fresh(2); s.players[0].pieces = [15, 15, 15, 15];
  throwK(s, 'P0', 1);
  assert.deepEqual(game.turnOf(s), ['P1'], 'no move: the throw is lost and the turn passes');
  assert.equal(s.phase, 'throw'); assert.equal(s.throw, null);
  assert.match(s.note.self, /lost/);
  s.turn = 0; throwK(s, 'P0', 0);
  assert.deepEqual(game.turnOf(s), ['P0'], 'a lost 8 still earns its extra throw');
}
// ---- illegal actions ----
{
  const s = fresh(2);
  assert.throws(() => game.act(s, 'P1', { type: 'throw' }), /Ravi's turn/);
  assert.throws(() => game.act(s, 'nobody', { type: 'throw' }), /players at the table/);
  assert.throws(() => game.act(s, 'P0', { type: 'move', piece: 0 }), /Throw the shells first/);
  assert.throws(() => game.act(s, 'P0', null), /Unknown move/);
  assert.throws(() => game.act(s, 'P0', { type: 'dance' }), /Throw the shells/);
  s.players[0].pieces = [0, 24, 24, 24]; s.players[0].hit = true;
  throwK(s, 'P0', 2);
  assert.throws(() => game.act(s, 'P0', { type: 'throw' }), /Move a piece with your 2 first/);
  for (const piece of [-1, 4, 1.5, '0', undefined]) assert.throws(() => game.act(s, 'P0', { type: 'move', piece }), /one of your four pieces/);
  assert.throws(() => game.act(s, 'P0', { type: 'move', piece: 1 }), /already in the centre/);
  assert.throws(() => game.act(s, 'P1', { type: 'move', piece: 0 }), /turn/);
  game.act(s, 'P0', { type: 'move', piece: 0 });
  assert.equal(s.players[0].pieces[0], 2);
}
// ---- views, JSON-safe state, timeouts and bots ----
{
  const s = fresh(3);
  for (let k = 0; k < 40; k++) { const pid = game.turnOf(s)[0]; game.act(s, pid, game.bot(game.view(s, pid), pid)); }
  assert.deepEqual(clone(s), s, 'state is plain JSON');
  const v = game.view(s, 'watcher'); assert.deepEqual(v.players, s.players, 'spectators see the whole board');
  v.players[0].pieces[0] = 99; assert.notEqual(s.players[0].pieces[0], 99, 'a view is a copy');
  const pid = game.turnOf(s)[0];
  const t = clone(s); t.phase === 'move' || throwK(t, pid, 2);
  if (t.phase === 'move' && game.turnOf(t)[0] === pid) { const a = game.onTimeout(game.view(t, pid), pid); assert.equal(a.type, 'move'); assert.doesNotThrow(() => game.act(t, pid, a)); }
  const u = fresh(2); assert.deepEqual(game.onTimeout(game.view(u, 'P0'), 'P0'), { type: 'throw' }, 'time up: the shells are thrown for you');
  // Normal and Hard take a capture when one is there.
  for (const level of ['normal', 'hard']) {
    const w = fresh(2); w.players[0].pieces = [1, 6, -1, -1]; w.players[1].pieces = [I.PATHS[2].indexOf(I.PATHS[0][3]), -1, -1, -1];
    throwK(w, 'P0', 2);
    assert.deepEqual(game.bot({ ...game.view(w, 'P0'), level }, 'P0'), { type: 'move', piece: 0 }, `${level} captures`);
  }
  // Hard moves a threatened piece onto a castle.
  const h = fresh(2); h.players[0].hit = true; h.players[0].pieces = [3, 9, -1, -1]; // step 3 is right next to the right home (step 4)
  h.players[1].pieces = [I.PATHS[2].indexOf(I.PATHS[0][1]), -1, -1, -1]; // a rival two behind it
  throwK(h, 'P0', 1);
  assert.deepEqual(game.bot({ ...game.view(h, 'P0'), level: 'hard' }, 'P0'), { type: 'move', piece: 0 }, 'Hard steps a threatened piece onto a castle');
  for (const level of ['easy', 'normal', 'hard']) assert.equal(game.view(game.setup(players(2), { level }), 'P0').level, level);
}
// ---- full games at every table size and level ----
for (let r = 0; r < 120; r++) {
  const n = 2 + (r % 3), s0 = game.setup(players(n), { level: ['easy', 'normal', 'hard'][r % 3] });
  let s = s0, steps = 0;
  while (!s.over && steps++ < 20000) { const pid = game.turnOf(s)[0]; const next = clone(s); game.act(next, pid, game.bot(clone(game.view(s, pid)), pid)); s = next; }
  assert.ok(s.over && s.winners.length === 1, 'every game ends with one winner');
  const w = s.players.find((p) => p.id === s.winners[0]); assert.ok(w.pieces.every((x) => x === 24));
}
// ---- Hard beats Easy (2 players, seats alternating, seeded) ----
{
  const N = Number(process.argv[2] || 100);
  let hard = 0, easy = 0, normalW = 0, easyN = 0;
  const play = (levels, seed) => {
    Math.random = seededRandom(seed);
    let s = game.setup(players(2)), steps = 0;
    while (!s.over && steps++ < 20000) { const pid = game.turnOf(s)[0]; const v = clone(game.view(s, pid)); const next = clone(s); game.act(next, pid, game.bot({ ...v, level: levels[pid] }, pid)); s = next; }
    return s.winners[0];
  };
  for (let r = 0; r < N; r++) {
    const levels = r % 2 ? { P0: 'easy', P1: 'hard' } : { P0: 'hard', P1: 'easy' };
    if (levels[play(levels, `ac-levels:${r}`)] === 'hard') hard++; else easy++;
    const lv2 = r % 2 ? { P0: 'easy', P1: 'normal' } : { P0: 'normal', P1: 'easy' };
    if (lv2[play(lv2, `ac-normal:${r}`)] === 'normal') normalW++; else easyN++;
  }
  const share = hard / (hard + easy);
  console.log(`Hard beat Easy ${hard}-${easy} (${Math.round(share * 100)}%); Normal beat Easy ${normalW}-${easyN} (${Math.round((100 * normalW) / (normalW + easyN))}%)`);
  assert.ok(share >= 0.62, `Hard should beat Easy in at least 62% of games, got ${hard}-${easy}`);
}

console.log('Ashta Chamma checks passed: shell odds, 25-square paths, entering, moving, exact finish, castles, captures, extra throws, capture-before-inner rule, lost throws, win, illegal actions, JSON state, timeouts, levels.');
