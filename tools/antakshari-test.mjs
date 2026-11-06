// Antakshari (games/antakshari.js): team dealing, the letter flow, "We sang it" validation, the challenge window
// and vote, time running out (same letter for the other team), scoring and the target, clocks that come early or
// stale, turnOf never empty, JSON-safe state, and the computer stand-in.
//   node tools/antakshari-test.mjs
import assert from 'node:assert/strict';
import ak from '../games/antakshari.js';
import { seededRandom } from './seed.mjs';

Math.random = seededRandom('antakshari-test');
const FRIENDLY = 'ABCDGHJKLMNPRSTY';
const players = (n) => Array.from({ length: n }, (_, i) => ({ id: 'P' + i, name: 'Player ' + i }));
const team = (s, t) => s.players.filter((p) => p.team === t).map((p) => p.id);
const singer = (s) => team(s, s.turn)[0];
const judges = (s) => team(s, 1 - s.turn);
const expire = (s) => { s.until = Date.now() - 1; };
const same = (s, fn) => { const before = JSON.stringify(s); fn(); assert.equal(JSON.stringify(s), before); };
const sing = (s, letter = 'A') => ak.act(s, singer(s), { type: 'sang', letter });
const acceptAll = (s) => { for (const id of judges(s)) if (s.phase === 'check') ak.act(s, id, { type: 'fair' }); };

// ---- the module: no computer seats, no difficulty levels, three lobby options ----
{
  assert.equal(ak.noBotSeats, true, 'the lobby hides Add computer');
  assert.deepEqual(ak.options.map((o) => o.id), ['target', 'time', 'start']);
  assert.ok(!ak.options.some((o) => o.id === 'level'), 'no difficulty levels for a singing game');
  assert.ok(ak.cover.startsWith('<svg viewBox="0 0 320 200"'));
  const ids = [...ak.cover.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(ids.length && ids.every((id) => id.startsWith('akc-')), 'cover ids are prefixed akc-');
  assert.ok(!ak.onTimeout && !ak.levelOption, 'the game runs its own clocks');
}

// ---- team dealing: 2–8 players, balanced, both teams present, random ----
for (let n = 2; n <= 8; n++) {
  const seen = new Set();
  for (let r = 0; r < 40; r++) {
    const s = ak.setup(players(n));
    const a = team(s, 0).length, b = team(s, 1).length;
    assert.equal(a + b, n);
    assert.ok(a >= 1 && b >= 1 && Math.abs(a - b) <= 1, `teams of ${a} and ${b} for ${n} players`);
    assert.deepEqual(s.players.map((p) => p.id), players(n).map((p) => p.id), 'players keep their seats');
    seen.add(team(s, 0).join());
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(s)));
    assert.deepEqual(JSON.parse(JSON.stringify(s)), s, 'state is plain JSON');
  }
  assert.ok(seen.size > 1, `the teams change from game to game (${n} players)`);
}
assert.throws(() => ak.setup(players(1)), /2–8/);
assert.throws(() => ak.setup(players(9)), /2–8/);

// ---- options and the first letter ----
{
  const s = ak.setup(players(4));
  assert.equal(s.letter, 'M', 'the traditional start is M');
  assert.equal(s.target, 10); assert.equal(s.singMs, 30000); assert.equal(s.phase, 'sing');
  assert.ok(s.until > Date.now() + 25000, 'a singing deadline is set');
  const o = ak.setup(players(4), { target: '5', time: '45', start: 'random' });
  assert.equal(o.target, 5); assert.equal(o.singMs, 45000); assert.ok(FRIENDLY.includes(o.letter));
  const bad = ak.setup(players(4), { target: '99', time: 'x', start: 'Q' });
  assert.equal(bad.target, 10); assert.equal(bad.singMs, 30000); assert.equal(bad.letter, 'M');
  const starts = new Set(Array.from({ length: 40 }, () => ak.setup(players(4)).turn));
  assert.equal(starts.size, 2, 'either team may sing first');
  const letters = new Set(Array.from({ length: 80 }, () => ak.setup(players(2), { start: 'random' }).letter));
  assert.ok(letters.size > 5 && [...letters].every((l) => FRIENDLY.includes(l)));
}

// ---- singing: only the singing team, one letter A–Z ----
{
  const s = ak.setup(players(4));
  assert.deepEqual(ak.turnOf(s).sort(), team(s, s.turn).sort(), 'the singing team can act');
  assert.throws(() => ak.act(s, judges(s)[0], { type: 'sang', letter: 'A' }), /turn to sing/);
  assert.throws(() => ak.act(s, 'watcher', { type: 'sang', letter: 'A' }), /players at the table/);
  assert.throws(() => ak.act(s, singer(s), null), /Unknown move/);
  assert.throws(() => ak.act(s, singer(s), { type: 'dance' }), /Unknown move/);
  for (const letter of ['', ' ', 'AB', '1', 'é', 'म', '?', null, 5, undefined, ['A']])
    assert.throws(() => ak.act(s, singer(s), { type: 'sang', letter }), /one letter from A to Z/, `rejects ${JSON.stringify(letter)}`);
  assert.throws(() => ak.act(s, singer(s), { type: 'fair' }), /no song to accept/);
  assert.throws(() => ak.act(s, singer(s), { type: 'challenge' }), /no song to challenge/);
  assert.throws(() => ak.act(s, singer(s), { type: 'vote', ok: true }), /no vote/);
  ak.act(s, team(s, s.turn)[1], { type: 'sang', letter: ' r ' });
  assert.equal(s.phase, 'check'); assert.equal(s.claim.next, 'R', 'lower case and spaces are fine');
  assert.throws(() => sing(s, 'B'), /Wait for the next song/);
}

// ---- the letter flow: accepted songs pass the last letter across and score ----
{
  const s = ak.setup(players(6));
  const t0 = s.turn;
  sing(s, 'a');
  assert.deepEqual(ak.turnOf(s).sort(), judges(s).sort(), 'the other team may challenge now');
  assert.ok(s.until > Date.now() + 8000 && s.until <= Date.now() + 10000, 'a 10 s window');
  assert.throws(() => ak.act(s, singer(s), { type: 'challenge' }), /own team/);
  assert.throws(() => ak.act(s, singer(s), { type: 'fair' }), /other team decides/);
  const [j1, j2, j3] = judges(s);
  ak.act(s, j1, { type: 'fair' });
  assert.throws(() => ak.act(s, j1, { type: 'fair' }), /already accepted/);
  assert.deepEqual(ak.turnOf(s).sort(), [j2, j3].sort(), 'those who accepted drop out of turnOf');
  ak.act(s, j2, { type: 'fair' }); ak.act(s, j3, { type: 'fair' });
  assert.equal(s.phase, 'sing'); assert.equal(s.turn, 1 - t0); assert.equal(s.letter, 'A');
  assert.deepEqual(s.score, t0 ? [0, 1] : [1, 0]);
  assert.deepEqual(s.trail.map((e) => [e.l, e.t, e.ok]), [['M', t0, true]]);
  sing(s, 'R'); acceptAll(s);
  sing(s, 'k'); acceptAll(s);
  assert.deepEqual([...s.trail.map((e) => e.l), s.letter], ['M', 'A', 'R', 'K'], 'M → A → R → K');
  assert.equal(s.score[t0] + s.score[1 - t0], 3); assert.equal(s.songs, 3);
}

// ---- the challenge window closes by itself: the song stands ----
{
  const s = ak.setup(players(4)), t = s.turn;
  sing(s, 'T');
  same(s, () => ak.act(s, singer(s), { type: 'clock' })); // early: ignored
  expire(s); ak.act(s, singer(s), { type: 'clock' });
  assert.equal(s.phase, 'sing'); assert.equal(s.letter, 'T'); assert.equal(s.score[t], 1); assert.equal(s.turn, 1 - t);
  assert.match(s.log[0], /sang on M/);
}

// ---- a challenge and its vote (teams of 3 or more: the other team votes) ----
{
  const s = ak.setup(players(8)), t = s.turn;
  sing(s, 'N');
  const [c, v2, v3, v4] = judges(s);
  ak.act(s, c, { type: 'challenge' });
  assert.equal(s.phase, 'vote');
  assert.deepEqual(s.voters.sort(), judges(s).sort(), 'everyone not on the singing team votes');
  assert.equal(s.votes[c], false, 'the challenger votes against the song');
  assert.deepEqual(ak.turnOf(s).sort(), [v2, v3, v4].sort());
  assert.throws(() => ak.act(s, singer(s), { type: 'vote', ok: true }), /don’t vote/);
  assert.throws(() => ak.act(s, c, { type: 'vote', ok: true }), /already voted/);
  assert.throws(() => ak.act(s, v2, { type: 'vote', ok: 'yes' }), /Real song/);
  assert.throws(() => ak.act(s, v2, { type: 'challenge' }), /no song to challenge/);
  ak.act(s, v2, { type: 'vote', ok: false }); ak.act(s, v3, { type: 'vote', ok: true }); ak.act(s, v4, { type: 'vote', ok: false });
  // 3–1 against: no point, and the other team must sing on the same letter
  assert.equal(s.phase, 'sing'); assert.deepEqual(s.score, [0, 0]); assert.equal(s.letter, 'M'); assert.equal(s.turn, 1 - t);
  assert.deepEqual(s.trail.at(-1), { l: 'M', t, ok: false, n: 0 });
  assert.match(s.log[0], /must sing on M/);
}
// ---- a tied vote keeps the song ----
{
  const s = ak.setup(players(4)), t = s.turn;
  sing(s, 'D');
  const [c, other] = judges(s);
  ak.act(s, c, { type: 'challenge' });
  ak.act(s, other, { type: 'vote', ok: true });
  assert.equal(s.phase, 'sing'); assert.equal(s.score[t], 1); assert.equal(s.letter, 'D'); assert.match(s.log[0], /stands \(1–1\)/);
}
// ---- the vote deadline counts the votes cast ----
{
  const s = ak.setup(players(8)), t = s.turn;
  sing(s, 'G');
  const [c, v2] = judges(s);
  ak.act(s, c, { type: 'challenge' }); ak.act(s, v2, { type: 'vote', ok: false });
  same(s, () => ak.act(s, c, { type: 'clock' }));
  expire(s); ak.act(s, c, { type: 'clock' });
  assert.equal(s.score[t], 0); assert.equal(s.letter, 'M', '2–0 against, the rest did not vote'); assert.equal(s.turn, 1 - t);
}
// ---- one-player teams: nobody judges alone, the whole table votes ----
{
  const s = ak.setup(players(2)), t = s.turn;
  sing(s, 'L');
  ak.act(s, judges(s)[0], { type: 'challenge' });
  assert.deepEqual(s.voters.sort(), ['P0', 'P1'], '1 v 1: both vote');
  assert.deepEqual(ak.turnOf(s), [singer(s)], 'the singer is asked to be honest');
  ak.act(s, singer(s), { type: 'vote', ok: false }); // owns up
  assert.equal(s.score[t], 0); assert.equal(s.letter, 'M');
  const s2 = ak.setup(players(2));
  sing(s2, 'L'); ak.act(s2, judges(s2)[0], { type: 'challenge' }); ak.act(s2, singer(s2), { type: 'vote', ok: true });
  assert.equal(s2.letter, 'L', '1–1 keeps the song');
}
{
  // 3 players: the pair's song is judged by the whole table; the solo singer's song by the pair
  for (let r = 0; r < 30; r++) {
    const s = ak.setup(players(3));
    sing(s, 'P');
    ak.act(s, judges(s)[0], { type: 'challenge' });
    if (judges(s).length === 1) assert.equal(s.voters.length, 3);
    else assert.deepEqual(s.voters.sort(), judges(s).sort());
  }
}

// ---- time runs out: no point, same letter for the other team; two misses deal a fresh letter ----
{
  const s = ak.setup(players(5)), t = s.turn;
  same(s, () => ak.act(s, singer(s), { type: 'clock' }));
  same(s, () => ak.act(s, judges(s)[0], { type: 'think' }));
  expire(s); ak.act(s, judges(s)[0], { type: 'clock' }); // anyone's screen may send the clock
  assert.equal(s.turn, 1 - t); assert.equal(s.letter, 'M'); assert.deepEqual(s.score, [0, 0]); assert.equal(s.phase, 'sing');
  assert.match(s.log[0], /Time’s up/);
  // a stale clock (sent for the deadline that just passed) arrives late: ignored
  same(s, () => ak.act(s, singer(s), { type: 'clock' }));
  ak.act(s, singer(s), { type: 'stuck' }); // the other team gives up too
  assert.equal(s.turn, t); assert.notEqual(s.letter, 'M'); assert.ok(FRIENDLY.includes(s.letter), 'a fresh friendly letter');
  assert.match(s.log[0], /Fresh letter/);
  assert.deepEqual(s.trail.map((e) => e.ok), [false, false]);
  assert.throws(() => ak.act(s, judges(s)[0], { type: 'stuck' }), /turn to sing/);
  // a sung song resets the miss count
  sing(s, 'E'); acceptAll(s); expire(s); ak.act(s, singer(s), { type: 'clock' });
  assert.equal(s.letter, 'E', 'one miss keeps the letter');
}

// ---- scoring and the target end the game ----
{
  const s = ak.setup(players(4), { target: '5' });
  let guard = 0;
  while (!s.over && guard++ < 50) { sing(s, 'S'); acceptAll(s); }
  assert.ok(s.over); assert.equal(s.phase, 'over');
  const w = s.score.findIndex((x) => x === 5);
  assert.ok(w >= 0 && s.score[1 - w] === 4, 'first to 5 wins');
  assert.deepEqual(s.winners.sort(), team(s, w).sort(), 'the winners are that team');
  assert.deepEqual(ak.turnOf(s), []);
  assert.throws(() => sing(s, 'A'), /over/);
  assert.throws(() => ak.act(s, 'P0', { type: 'clock' }), /over/);
}

// ---- views: nothing secret, spectators get everything, the host clock rides along ----
{
  const s = ak.setup(players(4));
  const v = ak.view(s, 'watcher');
  assert.ok(Number.isFinite(v.hostNow));
  assert.equal(v.players.length, 4); assert.ok(v.players.every((p) => p.team === 0 || p.team === 1), 'both rosters');
  v.score[0] = 99; assert.equal(s.score[0], 0, 'the view is a copy');
}

// ---- random play: every bot move is legal, turnOf is never empty, the state stays JSON ----
for (let n = 2; n <= 8; n++) {
  for (let r = 0; r < 25; r++) {
    let s = ak.setup(players(n), { target: '5' });
    let steps = 0;
    while (!s.over) {
      assert.ok(++steps < 3000, 'the game finishes');
      const due = ak.turnOf(s);
      assert.ok(due.length > 0, `someone can act (phase ${s.phase})`);
      for (const id of due) { const a = ak.bot(JSON.parse(JSON.stringify(ak.view(s, id))), id); assert.doesNotThrow(() => ak.act(JSON.parse(JSON.stringify(s)), id, a)); }
      const pid = due[Math.floor(Math.random() * due.length)];
      const x = Math.random();
      // mix in what people do: give up, challenge, vote either way, and let clocks run out
      if (x < 0.12) { expire(s); ak.act(s, pid, { type: 'clock' }); }
      else if (s.phase === 'sing' && x < 0.2) ak.act(s, pid, { type: 'stuck' });
      else if (s.phase === 'check' && x < 0.45) ak.act(s, pid, { type: 'challenge' });
      else if (s.phase === 'vote') ak.act(s, pid, { type: 'vote', ok: Math.random() < 0.5 });
      else ak.act(s, pid, ak.bot(ak.view(s, pid), pid));
      s = JSON.parse(JSON.stringify(s));
    }
    assert.ok(s.winners.length >= 1);
  }
}

console.log('antakshari-test: all passed');
