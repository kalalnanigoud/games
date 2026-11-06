// Bingo (games/bingo.js), the pen-and-paper game: 1–25 cards, arranging and Ready, turn-by-turn calls,
// B-I-N-G-O lines, shared wins, secrecy, timeouts and computer players.
//   node tools/bingo-test.mjs
import assert from 'node:assert/strict';
import bingo from '../games/bingo.js';
import { seededRandom } from './seed.mjs';

Math.random = seededRandom('bingo-test');
const players = (n) => Array.from({ length: n }, (_, i) => ({ id: 'P' + i, name: 'Player ' + i }));
const isPerm = (a) => a.length === 25 && [...a].sort((x, y) => x - y).every((x, i) => x === i + 1);
const readyAll = (s) => { for (const p of s.players) bingo.act(s, p.id, { type: 'ready' }); };
const callNext = (s, n) => bingo.act(s, s.order[s.turn], { type: 'call', n });

// ---- setup: every card holds 1–25 once; everyone arranges at once; nobody sees anyone else's card ----
{
  const s = bingo.setup(players(4));
  assert.equal(s.phase, 'setup');
  assert.ok(s.players.every((p) => isPerm(p.card)), 'each card holds every number from 1 to 25 once');
  assert.deepEqual(bingo.turnOf(s).sort(), ['P0', 'P1', 'P2', 'P3'], 'everyone arranges at the same time');
  const v = bingo.view(s, 'P1');
  assert.ok(v.players.find((p) => p.id === 'P1').card, 'you see your own card');
  assert.ok(v.players.filter((p) => p.id !== 'P1').every((p) => p.card === null), "but not anyone else's");
  assert.ok(bingo.view(s, 'watcher').players.every((p) => p.card === null), 'spectators see no cards during play');
  assert.doesNotThrow(() => JSON.stringify(s));
  assert.throws(() => bingo.act(s, 'P0', { type: 'call', n: 3 }), /Arrange your card/);
  assert.throws(() => bingo.act(s, 'stranger', { type: 'ready' }), /players at the table/);
}
// ---- arranging: swap two squares, set a whole order, shuffle; nothing invalid; locked once Ready ----
{
  const s = bingo.setup(players(2)), me = s.players[0], before = [...me.card];
  bingo.act(s, 'P0', { type: 'swap', i: 0, j: 24 });
  assert.deepEqual([me.card[0], me.card[24]], [before[24], before[0]], 'a swap exchanges two squares');
  for (const bad of [{ i: 0, j: 0 }, { i: -1, j: 3 }, { i: 2, j: 25 }, { i: 'a', j: 1 }]) assert.throws(() => bingo.act(s, 'P0', { type: 'swap', ...bad }), /two different squares/);
  const order = Array.from({ length: 25 }, (_, i) => 25 - i);
  bingo.act(s, 'P0', { type: 'arrange', cells: order }); assert.deepEqual(me.card, order, 'a whole order can be set');
  for (const bad of [[1, 2, 3], [...order.slice(1), 1], [...order.slice(0, 24), 26], 'nope']) assert.throws(() => bingo.act(s, 'P0', { type: 'arrange', cells: bad }), /each number from 1 to 25/);
  bingo.act(s, 'P0', { type: 'shuffle' }); assert.ok(isPerm(me.card), 'a shuffle keeps every number');
  bingo.act(s, 'P0', { type: 'ready' });
  assert.throws(() => bingo.act(s, 'P0', { type: 'swap', i: 1, j: 2 }), /ready/);
  assert.deepEqual(bingo.turnOf(s), ['P1'], 'only the players still arranging');
  assert.equal(s.phase, 'setup');
  bingo.act(s, 'P1', { type: 'ready' });
  assert.equal(s.phase, 'play', 'the game starts when everyone is ready');
  assert.match(s.log[0], /calls first/);
}
// ---- the first caller is random ----
{
  const firsts = new Set();
  for (let i = 0; i < 60; i++) firsts.add(bingo.setup(players(4)).order[0]);
  assert.equal(firsts.size, 4, 'any seat can call first');
}
// ---- calling: one number per turn, in turn order, from those not yet called ----
{
  const s = bingo.setup(players(3)); readyAll(s);
  const [first, second] = s.order;
  assert.deepEqual(bingo.turnOf(s), [first]);
  assert.throws(() => bingo.act(s, second, { type: 'call', n: 5 }), /turn to call/);
  for (const n of [0, 26, 2.5, '7']) assert.throws(() => bingo.act(s, first, { type: 'call', n }), /from 1 to 25/);
  bingo.act(s, first, { type: 'call', n: 13 });
  assert.deepEqual(s.called, [13]); assert.equal(s.last, 13); assert.equal(s.by, first);
  assert.deepEqual(bingo.turnOf(s), [second], 'the turn passes on');
  assert.throws(() => bingo.act(s, second, { type: 'call', n: 13 }), /already been called/);
}
// ---- lines: each finished row, column or diagonal crosses a letter; five wins ----
{
  const s = bingo.setup(players(2));
  const a = s.players[0], b = s.players[1];
  a.card = Array.from({ length: 25 }, (_, i) => i + 1); // rows 1–5, 6–10 …
  b.card = Array.from({ length: 25 }, (_, i) => 25 - i);
  readyAll(s);
  for (const n of [1, 2, 3, 4, 5]) callNext(s, n);
  assert.equal(a.lines, 1, 'a full row is one line (B)');
  assert.equal(b.lines, 1, 'the same five numbers are a row on the other card too');
  for (const n of [6, 11, 16, 21]) callNext(s, n); // first column completes on 21
  assert.equal(a.lines, 2, 'a column is a line (I)');
  for (const n of [7, 13, 19, 25]) callNext(s, n); // main diagonal 1,7,13,19,25
  assert.equal(a.lines, 3, 'a diagonal is a line (N)');
  assert.equal(s.over, false);
  for (const n of [8, 9]) callNext(s, n); // row 6–10 completes: 6,7,8,9,10? 10 missing
  callNext(s, 10);
  assert.equal(a.lines, 4, 'G');
  for (const n of [12, 14]) callNext(s, n);
  assert.equal(s.over, false);
  callNext(s, 15); // row 11–15 completes: the fifth line
  assert.equal(a.lines, 5);
  assert.equal(s.over, true); assert.ok(s.winners.includes('P0'));
  assert.deepEqual(bingo.turnOf(s), [], 'nobody moves after a win');
  assert.throws(() => bingo.act(s, 'P1', { type: 'call', n: 20 }), /over/);
  assert.ok(bingo.view(s, 'P1').players.every((p) => p.card), 'every card is shown at the end');
}
{
  // Two players with the same card finish on the same call: they share the win.
  const s = bingo.setup(players(3));
  const same = Array.from({ length: 25 }, (_, i) => i + 1);
  s.players[0].card = [...same]; s.players[2].card = [...same];
  // Player 1's card has 22–25 down its main diagonal, which blocks 8 of its 12 lines: at most 3 when the others finish.
  const slow = [...same]; for (const [i, j] of [[0, 21], [6, 22], [18, 23]]) [slow[i], slow[j]] = [slow[j], slow[i]];
  s.players[1].card = slow;
  readyAll(s);
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25]) { if (s.over) break; callNext(s, n); }
  assert.ok(s.over);
  assert.deepEqual([...s.winners].sort(), ['P0', 'P2'], 'same call, shared win (and only them)');
  assert.equal(s.called.at(-1), 21);
}
// ---- timeouts and computer players: always a legal move ----
{
  const s = bingo.setup(players(2));
  assert.deepEqual(bingo.onTimeout(bingo.view(s, 'P0'), 'P0'), { type: 'ready' }, 'time up while arranging: the card is accepted');
  readyAll(s);
  const pid = s.order[s.turn], a = bingo.onTimeout(bingo.view(s, pid), pid);
  assert.equal(a.type, 'call'); assert.doesNotThrow(() => bingo.act(s, pid, a));
  // A Normal computer finishes a line when it can.
  const t = bingo.setup(players(2)); t.players[0].card = Array.from({ length: 25 }, (_, i) => i + 1); readyAll(t);
  if (t.order[0] !== 'P0') callNext(t, 25);
  t.called.push(1, 2, 3, 4); // four of the top row already called
  assert.deepEqual(bingo.bot({ ...bingo.view(t, 'P0'), level: 'normal' }, 'P0'), { type: 'call', n: 5 }, 'it calls the number that finishes a line');
}
for (let r = 0; r < 200; r++) {
  const s = bingo.setup(players(2 + (r % 7)), { level: ['easy', 'normal', 'hard'][r % 3] });
  let steps = 0;
  while (!s.over && steps++ < 300) { const pid = bingo.turnOf(s)[0]; bingo.act(s, pid, bingo.bot(bingo.view(s, pid), pid)); }
  assert.ok(s.over && s.winners.length >= 1, 'every game ends with a winner');
  assert.ok(s.called.length <= 25);
}

console.log('Bingo checks passed: 1–25 cards, arranging and Ready, secrecy, random first caller, turn-by-turn calls, B-I-N-G-O lines, shared wins, timeouts, computer calls.');
