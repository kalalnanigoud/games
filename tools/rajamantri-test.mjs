// Raja Mantri Chor Sipahi (games/rajamantri.js): dealing the four chits, who sees what, the Mantri's guess,
// right and wrong scoring, the reveal and Next, rounds, shared wins, timeouts and computer players.
//   node tools/rajamantri-test.mjs
import assert from 'node:assert/strict';
import rm from '../games/rajamantri.js';
import { seededRandom } from './seed.mjs';

Math.random = seededRandom('rajamantri-test');
const players = () => ['A', 'B', 'C', 'D'].map((id) => ({ id, name: 'Player ' + id }));
const clone = (x) => JSON.parse(JSON.stringify(x));
const who = (s, role) => Object.keys(s.chits).find((id) => s.chits[id] === role);
const score = (s, id) => s.players.find((p) => p.id === id).score;

// ---- setup: four players, one of each chit, options ----
{
  assert.equal(rm.minPlayers, 4); assert.equal(rm.maxPlayers, 4);
  assert.throws(() => rm.setup(players().slice(0, 3)), /exactly four/);
  const s = rm.setup(players());
  assert.equal(s.round, 1); assert.equal(s.rounds, 5); assert.equal(s.phase, 'guess');
  assert.deepEqual(Object.values(s.chits).sort(), ['chor', 'mantri', 'raja', 'sipahi']);
  assert.doesNotThrow(() => JSON.stringify(s));
  assert.equal(rm.setup(players(), { rounds: '10' }).rounds, 10);
  assert.equal(rm.setup(players(), { rounds: '7' }).rounds, 5, 'unknown values fall back to 5 rounds');
  assert.ok(!(rm.options || []).some((o) => o.id === 'level'), 'no computer level: the guess is pure luck');
  // Every seat gets every chit over many deals.
  const seen = { A: new Set(), B: new Set(), C: new Set(), D: new Set() };
  for (let i = 0; i < 80; i++) { const t = rm.setup(players()); for (const [id, c] of Object.entries(t.chits)) seen[id].add(c); }
  assert.ok(Object.values(seen).every((x) => x.size === 4), 'chits are dealt at random');
}
// ---- secrecy: own chit, plus the Raja and the Mantri; spectators see only those two ----
{
  const s = rm.setup(players());
  const raja = who(s, 'raja'), mantri = who(s, 'mantri'), chor = who(s, 'chor'), sipahi = who(s, 'sipahi');
  for (const pid of ['A', 'B', 'C', 'D']) {
    const v = rm.view(s, pid);
    assert.equal(v.chits[pid], s.chits[pid], 'you see your own chit');
    assert.equal(v.chits[raja], 'raja'); assert.equal(v.chits[mantri], 'mantri');
    for (const o of [chor, sipahi]) if (o !== pid) assert.equal(v.chits[o], null, `${pid} cannot see ${o}'s chit`);
  }
  const w = rm.view(s, 'spectator');
  assert.equal(w.chits[chor], null); assert.equal(w.chits[sipahi], null); assert.equal(w.chits[raja], 'raja');
  const json = JSON.stringify(rm.view(s, sipahi));
  assert.ok(!json.includes('"chor"'), "the Sipahi's view never says who the Chor is");
  assert.ok(!JSON.stringify(rm.view(s, mantri)).includes('"chor"') && !JSON.stringify(rm.view(s, mantri)).includes('"sipahi"'), 'nor does the Mantri’s');
}
// ---- the guess: only the Mantri, only one of the two suspects ----
{
  const s = rm.setup(players());
  const raja = who(s, 'raja'), mantri = who(s, 'mantri'), chor = who(s, 'chor'), sipahi = who(s, 'sipahi');
  assert.deepEqual(rm.turnOf(s), [mantri]);
  assert.throws(() => rm.act(s, raja, { type: 'guess', target: chor }), /Only the Mantri/);
  assert.throws(() => rm.act(s, mantri, { type: 'guess', target: raja }), /neither Raja nor Mantri/);
  assert.throws(() => rm.act(s, mantri, { type: 'guess', target: mantri }), /neither Raja nor Mantri/);
  assert.throws(() => rm.act(s, mantri, { type: 'guess', target: 'Z' }), /neither Raja nor Mantri/);
  assert.throws(() => rm.act(s, mantri, { type: 'next' }), /Name the Chor/);
  assert.throws(() => rm.act(s, 'Z', { type: 'guess', target: chor }), /four players/);
  assert.throws(() => rm.act(s, mantri, null), /Unknown move/);
  // Right guess: everyone scores their chit.
  rm.act(s, mantri, { type: 'guess', target: chor });
  assert.equal(score(s, raja), 1000); assert.equal(score(s, mantri), 800); assert.equal(score(s, sipahi), 500); assert.equal(score(s, chor), 0);
  const h = s.history[0];
  assert.equal(h.correct, true); assert.equal(h.guess, chor); assert.equal(h.chor, chor);
  assert.equal(s.phase, 'reveal');
  // The reveal: every chit is shown, to players and spectators alike.
  for (const pid of [raja, sipahi, 'spectator']) assert.deepEqual(rm.view(s, pid).chits, s.chits);
  assert.deepEqual(rm.turnOf(s).sort(), ['A', 'B', 'C', 'D'], 'anyone may move on');
  assert.throws(() => rm.act(s, raja, { type: 'guess', target: chor }), /Next/);
  rm.act(s, raja, { type: 'think' }); assert.equal(s.phase, 'reveal', 'a computer thinking changes nothing');
  rm.act(s, sipahi, { type: 'next' });
  assert.equal(s.round, 2); assert.equal(s.phase, 'guess', 'the first Next deals the next round');
  assert.deepEqual(Object.values(s.chits).sort(), ['chor', 'mantri', 'raja', 'sipahi']);
}
{
  // Wrong guess: the Mantri and the Chor swap (Mantri 0, Chor 800).
  const s = rm.setup(players());
  const raja = who(s, 'raja'), mantri = who(s, 'mantri'), chor = who(s, 'chor'), sipahi = who(s, 'sipahi');
  rm.act(s, mantri, { type: 'guess', target: sipahi });
  assert.equal(score(s, raja), 1000); assert.equal(score(s, mantri), 0); assert.equal(score(s, chor), 800); assert.equal(score(s, sipahi), 500);
  assert.equal(s.history[0].correct, false);
  assert.match(s.log[0], /Sipahi/);
}
// ---- rounds, totals and winners (ties share) ----
{
  const s = rm.setup(players(), { rounds: '5' });
  const totals = { A: 0, B: 0, C: 0, D: 0 };
  for (let r = 1; r <= 5; r++) {
    assert.equal(s.round, r);
    const mantri = who(s, 'mantri'), right = r % 2 === 1;
    const target = right ? who(s, 'chor') : who(s, 'sipahi');
    const before = { ...s.chits };
    rm.act(s, mantri, { type: 'guess', target });
    for (const [id, c] of Object.entries(before)) totals[id] += right ? { raja: 1000, mantri: 800, sipahi: 500, chor: 0 }[c] : { raja: 1000, mantri: 0, sipahi: 500, chor: 800 }[c];
    if (r < 5) { assert.equal(s.over, false); rm.act(s, 'A', { type: 'next' }); }
  }
  assert.equal(s.over, true, 'the game ends with the last guess');
  assert.deepEqual(rm.turnOf(s), []);
  for (const id of ['A', 'B', 'C', 'D']) assert.equal(score(s, id), totals[id]);
  const best = Math.max(...Object.values(totals));
  assert.deepEqual([...s.winners].sort(), Object.keys(totals).filter((id) => totals[id] === best).sort());
  assert.equal(s.history.length, 5);
  assert.deepEqual(rm.view(s, 'spectator').chits, s.chits, 'the last chits are shown at the end');
  assert.throws(() => rm.act(s, 'A', { type: 'next' }), /over/);
}
{
  // A tie at the top is shared: force a one-round game where two players finish level.
  const s = rm.setup(players(), { rounds: '5' });
  s.rounds = 1;
  const mantri = who(s, 'mantri'), raja = who(s, 'raja');
  s.players.find((p) => p.id === mantri).score = 200; // 200 + 800 = the Raja's 1000
  rm.act(s, mantri, { type: 'guess', target: who(s, 'chor') });
  assert.ok(s.over); assert.deepEqual([...s.winners].sort(), [mantri, raja].sort(), 'level totals share the win');
}
// ---- timeouts and computer players ----
{
  const s = rm.setup(players());
  const mantri = who(s, 'mantri');
  const a = rm.onTimeout(rm.view(s, mantri), mantri);
  assert.equal(a.type, 'guess'); assert.ok([who(s, 'chor'), who(s, 'sipahi')].includes(a.target));
  rm.act(s, mantri, a);
  assert.deepEqual(rm.onTimeout(rm.view(s, 'A'), 'A'), { type: 'next' }, 'time up in the reveal: move on');
  assert.deepEqual(rm.bot(rm.view(s, 'B'), 'B'), { type: 'next' }, 'outside a browser, computers move straight on');
  // A computer Mantri guesses both suspects, about half each.
  const t = rm.setup(players()), m = who(t, 'mantri'), v = rm.view(t, m);
  let chor = 0; for (let i = 0; i < 400; i++) { const g = rm.bot(clone(v), m); assert.ok([who(t, 'chor'), who(t, 'sipahi')].includes(g.target)); if (g.target === who(t, 'chor')) chor++; }
  assert.ok(chor > 150 && chor < 250, `random between the two suspects (${chor}/400)`);
}
{
  let games = 0, rights = 0, guesses = 0;
  for (let g = 0; g < 200; g++) {
    let s = rm.setup(players(), { rounds: g % 2 ? '10' : '5' }), steps = 0;
    while (!s.over) {
      assert.ok(++steps < 100, 'the game finishes');
      const due = rm.turnOf(s), pid = due[Math.floor(Math.random() * due.length)];
      const a = rm.bot(clone(rm.view(s, pid)), pid);
      const next = clone(s); rm.act(next, pid, a); s = next;
    }
    games++; guesses += s.history.length; rights += s.history.filter((h) => h.correct).length;
    assert.equal(s.history.length, s.rounds);
    assert.ok(s.winners.length >= 1);
    assert.equal(s.players.reduce((a, p) => a + p.score, 0), s.history.length * 2300, 'every round hands out 2300 points');
  }
  assert.ok(rights / guesses > 0.4 && rights / guesses < 0.6);
}

console.log('Raja Mantri Chor Sipahi checks passed: dealing, secrecy, the Mantri’s guess, right and wrong scoring, reveal and Next, rounds, shared wins, timeouts, computer guesses.');
