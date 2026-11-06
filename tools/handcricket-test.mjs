// Hand Cricket (games/handcricket.js): the odd–eve toss, bat or bowl, simultaneous secret picks, runs and
// OUTs, innings ends (wickets, balls, a chase reached), tie and win results, secrecy, timeouts, options,
// and that a Hard computer beats an Easy one.
//   node tools/handcricket-test.mjs
import assert from 'node:assert/strict';
import hc from '../games/handcricket.js';
import { seededRandom } from './seed.mjs';

Math.random = seededRandom('handcricket-test');
const players = () => [{ id: 'A', name: 'Asha' }, { id: 'B', name: 'Ravi' }];
const clone = (x) => JSON.parse(JSON.stringify(x));
const other = (id) => (id === 'A' ? 'B' : 'A');
// Play the toss so that `bat` bats first.
function toPlay(s, bat = 'A') {
  hc.act(s, s.caller, { type: 'call', parity: 'odd' });
  hc.act(s, 'A', { type: 'pick', n: 1 }); hc.act(s, 'B', { type: 'pick', n: 2 }); // 3: odd, the caller wins
  assert.equal(s.tossWinner, s.caller);
  hc.act(s, s.caller, { type: 'choose', choice: s.caller === bat ? 'bat' : 'bowl' });
  assert.equal(s.innings[0].bat, bat);
}
const ball = (s, b, w) => { const inn = s.innings[s.inn]; hc.act(s, inn.bat, { type: 'pick', n: b }); hc.act(s, inn.bowl, { type: 'pick', n: w }); };

// ---- setup and options ----
{
  const s = hc.setup(players());
  assert.equal(s.phase, 'call'); assert.equal(s.overs, 1); assert.equal(s.wickets, 1); assert.equal(s.level, 'normal');
  assert.deepEqual(hc.turnOf(s), [s.caller], 'one player calls the toss');
  assert.doesNotThrow(() => JSON.stringify(s));
  const t = hc.setup(players(), { overs: '5', wickets: '3', level: 'hard' });
  assert.equal(t.overs, 5); assert.equal(t.wickets, 3); assert.equal(hc.view(t, 'A').level, 'hard');
  const u = hc.setup(players(), { overs: '4', wickets: '9' });
  assert.equal(u.overs, 1); assert.equal(u.wickets, 1, 'unknown option values fall back to the defaults');
  assert.throws(() => hc.setup([{ id: 'A', name: 'A' }]), /exactly two/);
  assert.equal(hc.minPlayers, 2); assert.equal(hc.maxPlayers, 2); assert.equal(hc.simultaneous, true);
  const callers = new Set(); for (let i = 0; i < 40; i++) callers.add(hc.setup(players()).caller);
  assert.equal(callers.size, 2, 'either player may call the toss');
}
// ---- the toss ----
{
  const s = hc.setup(players()), c = s.caller, o = other(c);
  assert.throws(() => hc.act(s, o, { type: 'call', parity: 'odd' }), /calls the toss/);
  assert.throws(() => hc.act(s, c, { type: 'call', parity: 'maybe' }), /Odd or Even/);
  assert.throws(() => hc.act(s, c, { type: 'pick', n: 3 }), /Odd or Even/);
  assert.throws(() => hc.act(s, 'Z', { type: 'call', parity: 'odd' }), /two players/);
  hc.act(s, c, { type: 'call', parity: 'even' });
  assert.equal(s.phase, 'toss');
  assert.deepEqual(hc.turnOf(s).sort(), ['A', 'B'], 'both throw for the toss at once');
  hc.act(s, c, { type: 'pick', n: 2 });
  assert.deepEqual(hc.turnOf(s), [o]);
  assert.throws(() => hc.act(s, c, { type: 'pick', n: 4 }), /You have picked/);
  // Secrecy during the toss.
  const vo = hc.view(s, o);
  assert.equal(vo.myPick, null); assert.equal(vo.picked[c], true); assert.equal(vo.picks, undefined);
  assert.ok(!JSON.stringify(vo).includes('"picks"'), 'the raw picks never reach a view');
  assert.equal(hc.view(s, c).myPick, 2);
  hc.act(s, o, { type: 'pick', n: 3 }); // 5: odd, the Even caller loses
  assert.equal(s.toss.sum, 5); assert.equal(s.tossWinner, o); assert.equal(s.phase, 'choose');
  assert.deepEqual(hc.turnOf(s), [o]);
  assert.throws(() => hc.act(s, c, { type: 'choose', choice: 'bat' }), /won the toss/);
  assert.throws(() => hc.act(s, o, { type: 'choose', choice: 'field' }), /bat or to bowl/);
  hc.act(s, o, { type: 'choose', choice: 'bowl' });
  assert.equal(s.phase, 'play'); assert.equal(s.innings[0].bat, c, 'choosing to bowl puts the other player in to bat');
  const t = hc.setup(players()); hc.act(t, t.caller, { type: 'call', parity: 'even' });
  hc.act(t, 'A', { type: 'pick', n: 3 }); hc.act(t, 'B', { type: 'pick', n: 5 });
  assert.equal(t.tossWinner, t.caller, 'an even sum wins it for an Even call');
}
// ---- balls: picks are simultaneous and secret; same number OUT, otherwise the batter's runs ----
{
  const s = hc.setup(players()); toPlay(s, 'A');
  assert.deepEqual(hc.turnOf(s).sort(), ['A', 'B']);
  for (const n of [0, 7, 2.5, '3', null]) assert.throws(() => hc.act(s, 'A', { type: 'pick', n }), /1 to 6/);
  assert.throws(() => hc.act(s, 'A', { type: 'call', parity: 'odd' }), /1 to 6/);
  hc.act(s, 'B', { type: 'pick', n: 5 });
  for (const watcher of ['A', 'spectator']) {
    const v = hc.view(s, watcher);
    assert.equal(v.myPick, null, `${watcher} cannot see the bowler's number`);
    assert.ok(!JSON.stringify(v).includes('"picks"'));
    assert.equal(v.balls.length, 0);
  }
  assert.equal(hc.view(s, 'B').myPick, 5, 'you see your own number');
  assert.deepEqual(hc.turnOf(s), ['A']);
  hc.act(s, 'A', { type: 'pick', n: 4 });
  assert.equal(s.innings[0].runs, 4); assert.equal(s.innings[0].balls, 1);
  assert.deepEqual(s.balls.at(-1), { inn: 0, bat: 'A', bowl: 'B', b: 4, w: 5, out: false });
  assert.match(s.log[0], /Asha 4, Ravi 5: \+4/);
  assert.equal(hc.view(s, 'spectator').balls.at(-1).w, 5, 'both numbers show once both have picked');
  assert.deepEqual(hc.turnOf(s).sort(), ['A', 'B'], 'the next ball starts at once');
  ball(s, 6, 1); ball(s, 2, 3);
  assert.equal(s.innings[0].runs, 12);
  ball(s, 3, 3); // OUT: the only wicket
  assert.equal(s.innings[0].wkts, 1); assert.match(s.balls.at(-1).out ? 'OUT' : '', /OUT/);
  assert.equal(s.inn, 1, 'all wickets down: innings over');
  assert.equal(s.innings[1].bat, 'B'); assert.equal(s.innings[1].bowl, 'A');
  assert.match(s.log[0], /needs 13 runs from 6 balls/);
  // Chase: reaching the target ends the match at once.
  ball(s, 6, 2); ball(s, 6, 5);
  assert.equal(s.over, false);
  ball(s, 1, 2);
  assert.equal(s.innings[1].runs, 13); assert.equal(s.over, true);
  assert.deepEqual(s.winners, ['B']); assert.match(s.result, /Ravi wins by 1 wicket/);
  assert.deepEqual(hc.turnOf(s), []);
  assert.throws(() => hc.act(s, 'A', { type: 'pick', n: 1 }), /over/);
}
// ---- innings end on balls; a defended total; a tie; more overs and wickets ----
{
  const s = hc.setup(players()); toPlay(s, 'A');
  for (let i = 0; i < 6; i++) ball(s, 1, 2); // six singles, no wicket: the over is done
  assert.equal(s.innings[0].runs, 6); assert.equal(s.inn, 1, 'all balls bowled: innings over');
  ball(s, 2, 1); ball(s, 4, 4);
  assert.ok(s.over); assert.deepEqual(s.winners, ['A']); assert.match(s.result, /Asha wins by 4 runs/);
}
{
  const s = hc.setup(players()); toPlay(s, 'A');
  ball(s, 5, 1); ball(s, 5, 5); // 5
  for (let i = 0; i < 5; i++) ball(s, 1, 2); // 5 from 5 balls
  assert.equal(s.innings[1].runs, 5); assert.equal(s.innings[1].balls, 5); assert.equal(s.over, false);
  ball(s, 3, 3); // OUT, level scores
  assert.ok(s.over); assert.deepEqual([...s.winners].sort(), ['A', 'B'], 'level scores: a tie, shared');
  assert.match(s.result, /tie/);
}
{
  const s = hc.setup(players(), { overs: '2', wickets: '2' }); toPlay(s, 'B');
  ball(s, 4, 4); assert.equal(s.inn, 0, 'one of two wickets down: still batting');
  for (let i = 0; i < 10; i++) ball(s, 2, 1);
  assert.equal(s.inn, 0); assert.equal(s.innings[0].balls, 11);
  ball(s, 6, 1); assert.equal(s.inn, 1, '12 balls in 2 overs');
  assert.equal(s.innings[0].runs, 26);
  ball(s, 1, 1); ball(s, 2, 2); assert.ok(s.over); assert.deepEqual(s.winners, ['B']);
}
// ---- timeouts: gentle defaults that are always legal ----
{
  const s = hc.setup(players());
  assert.deepEqual(hc.onTimeout(hc.view(s, s.caller), s.caller), { type: 'call', parity: 'odd' });
  hc.act(s, s.caller, hc.onTimeout(hc.view(s, s.caller), s.caller));
  for (const p of ['A', 'B']) { const a = hc.onTimeout(hc.view(s, p), p); assert.equal(a.type, 'pick'); hc.act(s, p, a); }
  assert.deepEqual(hc.onTimeout(hc.view(s, s.tossWinner), s.tossWinner), { type: 'choose', choice: 'bat' });
  hc.act(s, s.tossWinner, { type: 'choose', choice: 'bat' });
  const a = hc.onTimeout(hc.view(s, 'A'), 'A'); assert.ok(a.n >= 1 && a.n <= 6); hc.act(s, 'A', a);
}
// ---- computer players: Hard reads habits ----
{
  const s = hc.setup(players(), { level: 'hard' }); toPlay(s, 'A');
  for (let i = 0; i < 5; i++) ball(s, 6, 1); // A loves a 6
  const v = clone(hc.view(s, 'B'));
  let sixes = 0; for (let i = 0; i < 200; i++) if (hc.bot(v, 'B').n === 6) sixes++;
  assert.ok(sixes > 120, `a Hard bowler throws the batter's favourite number (${sixes}/200)`);
  const t = hc.setup(players(), { level: 'hard' }); toPlay(t, 'A');
  for (let i = 0; i < 5; i++) ball(t, 2, 6); // the bowler always throws 6
  const w = clone(hc.view(t, 'A'));
  let avoid = 0; for (let i = 0; i < 200; i++) if (hc.bot(w, 'A').n !== 6) avoid++;
  assert.ok(avoid > 180, `a Hard batter avoids the bowler's favourite number (${avoid}/200)`);
}
// ---- every level plays legal, finished games; Hard beats Easy ----
function play(levelOf, opts) {
  let s = hc.setup(players(), opts), steps = 0;
  while (!s.over) {
    assert.ok(++steps < 2000, 'the match finishes');
    const due = hc.turnOf(s);
    const pid = due[Math.floor(Math.random() * due.length)];
    const v = clone(hc.view(s, pid));
    const a = hc.bot({ ...v, level: levelOf(pid) }, pid);
    const next = clone(s); hc.act(next, pid, a); s = next;
  }
  return s;
}
for (const level of ['easy', 'normal', 'hard']) for (const overs of ['1', '2', '5']) for (const wickets of ['1', '3']) {
  const s = play(() => level, { level, overs, wickets });
  assert.ok(s.over && s.winners.length >= 1);
}
const results = {};
for (const [label, opts] of [['1 over, 1 wicket', {}], ['2 overs, 2 wickets', { overs: '2', wickets: '2' }]]) {
  let hard = 0, easy = 0;
  for (let r = 0; r < 150; r++) {
    Math.random = seededRandom(`handcricket-levels:${label}:${r}`);
    const hardSeat = r % 2 ? 'A' : 'B';
    const s = play((pid) => (pid === hardSeat ? 'hard' : 'easy'), opts);
    if (s.winners.length !== 1) continue;
    if (s.winners[0] === hardSeat) hard++; else easy++;
  }
  results[label] = `${hard}-${easy} (${Math.round((100 * hard) / (hard + easy))}%)`;
  assert.ok(hard / (hard + easy) >= 0.62, `Hard should beat Easy in at least 62% of decided games (${label}): ${hard}-${easy}`);
}

console.log(`Hand Cricket checks passed: toss, bat or bowl, secret simultaneous picks, runs and OUTs, innings ends, chase, tie, options, timeouts, computer levels. Hard vs Easy: ${Object.entries(results).map(([k, v]) => `${k} ${v}`).join('; ')}.`);
