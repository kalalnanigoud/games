// Tambola and its number-calling engine (games/caller-kit.js): tickets, calling, pacing, claims, bogeys,
// shared and late prizes, secrecy and the end. (Bingo is turn-based now: tools/bingo-test.mjs.)
//   node tools/caller-test.mjs
import assert from 'node:assert/strict';
import tambola, { makeTicket } from '../games/tambola.js';
import { seededRandom } from './seed.mjs';

Math.random = seededRandom('caller-test');
const players = (n) => Array.from({ length: n }, (_, i) => ({ id: 'P' + i, name: 'Player ' + i }));
const clone = (x) => JSON.parse(JSON.stringify(x));
const nums = (card) => card.rows.flat().filter((x) => x);
// Draw the given numbers next, in order, by moving them to the end of the hidden deck.
const rig = (s, list) => { const u = [...new Set(list)]; s.deck = s.deck.filter((x) => !u.includes(x)).concat([...u].reverse()); };
const call = (g, s, pid = 'P0') => g.act(s, pid, { type: 'call', n: s.calls.length });


// ---- Tambola tickets: 3×9, 15 numbers, 5 per row, 1–3 per column, column ranges, sorted down each column ----
for (let i = 0; i < 2000; i++) {
  const { rows } = makeTicket();
  assert.equal(rows.length, 3); assert.ok(rows.every((r) => r.length === 9));
  assert.ok(rows.every((r) => r.filter((x) => x != null).length === 5), 'five numbers in every row');
  for (let c = 0; c < 9; c++) {
    const col = rows.map((r) => r[c]).filter((x) => x != null);
    const [lo, hi] = c === 0 ? [1, 9] : c === 8 ? [80, 90] : [c * 10, c * 10 + 9];
    assert.ok(col.length >= 1 && col.length <= 3, 'one to three numbers in every column');
    assert.ok(col.every((x) => x >= lo && x <= hi), 'each column holds its own tens');
    assert.deepEqual(col, [...col].sort((a, b) => a - b), 'sorted top to bottom');
    assert.equal(new Set(col).size, col.length);
  }
  assert.equal(new Set(rows.flat().filter((x) => x != null)).size, 15, 'fifteen different numbers');
}

// ---- views: the ball order and other players' cards stay hidden; spectators see no card ----
{
  const s = tambola.setup(players(3));
  const v = tambola.view(s, 'P1');
  assert.equal(v.deck, undefined, 'the order of the balls is secret');
  assert.ok(v.players.find((p) => p.id === 'P1').card, 'you see your own ticket');
  assert.ok(v.players.filter((p) => p.id !== 'P1').every((p) => p.card === null), "but not anyone else's");
  assert.ok(tambola.view(s, 'watcher').players.every((p) => p.card === null), 'spectators see no tickets');
  assert.equal(v.left, 90);
  assert.ok(tambola.turnOf(s).length === 3 && tambola.simultaneous, 'everyone plays at once');
  assert.doesNotThrow(() => JSON.stringify(s));
}


// ---- calling: one ball per call number, however many screens ask ----
{
  const s = tambola.setup(players(3));
  call(tambola, s, 'P0'); assert.equal(s.calls.length, 1);
  tambola.act(s, 'P1', { type: 'call', n: 0 }); tambola.act(s, 'P2', { type: 'call', n: 0 });
  assert.equal(s.calls.length, 1, 'a stale ask changes nothing');
  tambola.act(s, 'P1', { type: 'call', n: 'x' }); assert.equal(s.calls.length, 1);
  assert.throws(() => tambola.act(s, 'stranger', { type: 'call', n: 1 }), /players at the table/);
  assert.throws(() => tambola.act(s, 'P0', { type: 'dance' }), /Unknown/);
  const before = clone(s); tambola.act(s, 'P0', { type: 'wait' }); assert.deepEqual(s, before, 'waiting changes nothing');
}
// ---- pacing: on the host's clock, an early ask is ignored ----
{
  globalThis.callerPaced = true;
  const s = tambola.setup(players(2));
  assert.ok(s.nextAt > Date.now(), 'a short wait before the first ball');
  call(tambola, s); assert.equal(s.calls.length, 0, 'too early');
  s.nextAt = Date.now() - 1; call(tambola, s); assert.equal(s.calls.length, 1);
  assert.ok(s.nextAt >= Date.now() + 7500 && s.nextAt <= Date.now() + 8100, 'normal pace is about 8 s');
  assert.equal(tambola.setup(players(2), { pace: 'quick' }).paceMs, 5000);
  assert.equal(tambola.setup(players(2), { pace: 'relaxed' }).paceMs, 12000);
  assert.deepEqual(tambola.bot(tambola.view(s, 'P1'), 'P1'), { type: 'wait' }, 'computers wait for the clock too');
  delete globalThis.callerPaced;
}
// ---- claims: a true claim wins, a false one is a bogey, the same number shares, a later one is too late ----
{
  const s = tambola.setup(players(3), { prizes: 'quick' });
  const [a, b, c] = s.players;
  const top = a.card.rows[0].filter((x) => x != null);
  rig(s, top);
  assert.throws(() => tambola.act(s, 'P0', { type: 'claim', prize: 'line' }), /No numbers/);
  for (let i = 0; i < 4; i++) call(tambola, s);
  tambola.act(s, 'P1', { type: 'claim', prize: 'line' });
  assert.equal(b.lock, s.calls.length + 3, 'a wrong claim is a bogey for three numbers');
  assert.throws(() => tambola.act(s, 'P1', { type: 'claim', prize: 'line' }), /Bogey/);
  assert.match(s.log[0], /Bogey/);
  call(tambola, s);
  tambola.act(s, 'P0', { type: 'claim', prize: 'line' });
  assert.deepEqual(s.prizes.find((p) => p.id === 'line').winners, ['P0']); assert.equal(a.score, 20);
  assert.throws(() => tambola.act(s, 'P0', { type: 'claim', prize: 'line' }), /already have/);
  c.card.rows[1] = [...a.card.rows[0]]; // player 2 has a line on the same number too
  tambola.act(s, 'P2', { type: 'claim', prize: 'line' });
  assert.deepEqual(s.prizes.find((p) => p.id === 'line').winners, ['P0', 'P2'], 'both share on the same number');
  call(tambola, s);
  b.card.rows[2] = [...a.card.rows[0]];
  assert.throws(() => tambola.act(s, 'P1', { type: 'claim', prize: 'line' }), /already gone to Player 0 and Player 2/, 'after the next number it is too late');
}

// ---- Tambola prizes: Early Five, lines, corners, Full House, and the quick set ----
{
  const s = tambola.setup(players(2));
  assert.deepEqual(s.prizes.map((p) => p.id), ['early5', 'top', 'middle', 'bottom', 'corners', 'full']);
  const [a] = s.players, R = a.card.rows.map((r) => r.filter((x) => x != null));
  rig(s, [...R[0], ...R[2]]);
  for (let i = 0; i < 4; i++) call(tambola, s);
  tambola.act(s, 'P0', { type: 'claim', prize: 'early5' });
  assert.ok(a.lock > 0, 'four is not Early Five');
  for (let i = 0; i < 3; i++) call(tambola, s); // the bogey wears off after three numbers
  tambola.act(s, 'P0', { type: 'claim', prize: 'early5' });
  tambola.act(s, 'P0', { type: 'claim', prize: 'top' });
  for (let i = 0; i < 3; i++) call(tambola, s);
  tambola.act(s, 'P0', { type: 'claim', prize: 'bottom' });
  tambola.act(s, 'P0', { type: 'claim', prize: 'corners' });
  assert.equal(a.score, 10 + 15 + 15 + 15);
  assert.equal(s.over, false);
  const v = tambola.view(s, 'P1');
  assert.ok(v.players.find((p) => p.id === 'P0').togo > 0, 'everyone sees how far each player is from the next open prize (Middle Line)');
  tambola.act(s, 'P0', { type: 'claim', prize: 'middle' });
  assert.equal(a.lock, s.calls.length + 3, 'claiming an incomplete Middle Line is a bogey');
  const q = tambola.setup(players(2), { prizes: 'quick' });
  assert.deepEqual(q.prizes.map((p) => p.id), ['early5', 'line', 'full']);
}
{
  // Full House ends the game after the last-call window; most points wins.
  const s = tambola.setup(players(2));
  const [a, b] = s.players;
  rig(s, nums(a.card));
  for (let i = 0; i < 15; i++) call(tambola, s);
  for (const p of ['early5', 'top', 'middle', 'bottom', 'corners', 'full']) tambola.act(s, 'P0', { type: 'claim', prize: p });
  assert.equal(a.score, 10 + 15 * 4 + 40);
  assert.equal(s.ending, true);
  call(tambola, s);
  assert.equal(s.over, true); assert.deepEqual(s.winners, ['P0']);
  assert.equal(b.score, 0);
}
{
  // Every ball called with nobody claiming: the game still ends.
  const s = tambola.setup(players(2));
  while (!s.over) call(tambola, s);
  assert.equal(s.calls.length, 90); assert.deepEqual(s.winners, []);
}

// ---- computer players claim what they have, at their level ----
{
  const s = tambola.setup(players(2), { level: 'hard' });
  rig(s, nums(s.players[1].card).slice(0, 5));
  for (let i = 0; i < 5; i++) call(tambola, s);
  assert.deepEqual(tambola.bot(tambola.view(s, 'P1'), 'P1'), { type: 'claim', prize: 'early5' }, 'a hard computer claims at once');
  const a = tambola.bot(tambola.view(s, 'P0'), 'P0');
  assert.equal(a.type, 'call', 'with nothing to claim it asks for the next number');
}

console.log('Tambola checks passed: cards and tickets, secrecy, calling and pacing, claims, bogeys, shared and late prizes, game end, computer claims.');
