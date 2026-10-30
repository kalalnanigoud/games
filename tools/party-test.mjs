// Party games and tournaments: node tools/party-test.mjs
// Sketch Party and Word Spies rules, hidden information in each view, and js/tour.js brackets.
import assert from 'node:assert/strict';
import sketch from '../games/sketch.js';
import spies from '../games/spies.js';
import { createTour, currentMatch, recordResult, standings, tourLine } from '../js/tour.js';

const team = (n) => Array.from({ length: n }, (_, i) => ({ id: 'P' + i, name: 'Player ' + i }));
const json = (x) => JSON.parse(JSON.stringify(x));

/* ---------------- Sketch Party ---------------- */
{
  assert.throws(() => sketch.setup(team(1))); assert.throws(() => sketch.setup(team(9)));
  const s = sketch.setup(team(3), { rounds: '1', time: '60' });
  assert.equal(s.rounds, 1); assert.equal(s.drawMs, 60000); assert.equal(s.phase, 'choose');
  const drawer = s.drawer, guessers = s.players.map((p) => p.id).filter((id) => id !== drawer);
  assert.deepEqual(sketch.turnOf(s), [drawer]);
  assert.equal(sketch.view(s, guessers[0]).choices.length, 0, 'only the drawer sees the choices');
  assert.equal(sketch.view(s, drawer).choices.length, 3);
  assert.throws(() => sketch.act(s, guessers[0], { type: 'choose', i: 0 }), /drawer/);
  const word = s.choices[1];
  sketch.act(s, drawer, { type: 'choose', i: 1 });
  assert.equal(s.phase, 'draw'); assert.equal(s.word, word);
  const v = sketch.view(s, guessers[0]);
  assert.equal(v.word, ''); assert.ok(!JSON.stringify(v).includes(`"${word}"`), 'guessers never receive the word');
  assert.equal(v.mask.replace(/[^_ ]/g, '').length, word.length, 'the mask hides every letter');
  assert.equal(sketch.view(s, drawer).word, word);
  assert.deepEqual(sketch.turnOf(s).sort(), s.players.map((p) => p.id).sort(), 'everyone acts at once while drawing');
  // Strokes: validated, undone by gesture, cleared.
  for (const bad of [{ c: 99, w: 0, g: 1, p: [1, 1, 2, 2] }, { c: 0, w: 0, g: 1, p: [1, 1, 2] }, { c: 0, w: 0, g: 1, p: [1, 1, 2000, 2] }, { c: 0, w: 0, g: 1, p: [1.5, 1, 2, 2] }])
    assert.throws(() => sketch.act(s, drawer, { type: 'stroke', ...bad }));
  assert.throws(() => sketch.act(s, guessers[0], { type: 'stroke', c: 0, w: 0, g: 1, p: [1, 1, 2, 2] }), /drawer/);
  sketch.act(s, drawer, { type: 'stroke', c: 2, w: 1, g: 1, p: [10, 10, 50, 50], k: 'abc' });
  sketch.act(s, drawer, { type: 'stroke', c: 2, w: 1, g: 1, p: [50, 50, 90, 90] });
  sketch.act(s, drawer, { type: 'stroke', c: 3, w: 2, g: 2, p: [0, 0, 1000, 750] });
  sketch.act(s, drawer, { type: 'undo' }); assert.equal(s.strokes.length, 2, 'undo removes the whole last gesture');
  sketch.act(s, drawer, { type: 'undo' }); assert.equal(s.strokes.length, 0);
  // Guesses: wrong ones are public, near misses private, right ones score and end the turn.
  assert.throws(() => sketch.act(s, drawer, { type: 'guess', text: word }), /drawing/);
  sketch.act(s, guessers[0], { type: 'guess', text: 'definitely not it' });
  assert.equal(s.feed.at(-1).k, 'guess');
  const near = word.length >= 4 ? word.slice(0, -1) + (word.at(-1) === 'z' ? 'y' : 'z') : null;
  if (near && near !== word) {
    sketch.act(s, guessers[0], { type: 'guess', text: near });
    assert.equal(s.feed.at(-1).k, 'close');
    assert.ok(!sketch.view(s, guessers[1]).feed.some((f) => f.k === 'close'), 'near misses are private');
  }
  sketch.act(s, guessers[0], { type: 'guess', text: '  ' + word.toUpperCase() + '!' });
  assert.ok(s.guessed[guessers[0]] >= 50); assert.equal(sketch.view(s, guessers[0]).word, word, 'a correct guesser may see the word');
  assert.throws(() => sketch.act(s, guessers[0], { type: 'guess', text: word }), /already/);
  sketch.act(s, guessers[1], { type: 'guess', text: word });
  assert.equal(s.phase, 'reveal', 'everyone guessing ends the turn');
  assert.equal(s.players.find((p) => p.id === drawer).score, 100);
  // Clock: early ticks change nothing, late ones move on.
  const before = JSON.stringify(s);
  sketch.act(s, drawer, { type: 'clock' }); assert.equal(JSON.stringify(s), before);
  s.revealUntil = Date.now() - 1; sketch.act(s, guessers[0], { type: 'clock' });
  assert.equal(s.phase, 'choose'); assert.notEqual(s.drawer, drawer);
  s.chooseUntil = Date.now() - 1; sketch.act(s, guessers[0], { type: 'clock' });
  assert.equal(s.phase, 'draw', 'a drawer who never picks gets a random word');
  s.hintAt = s.hintAt.map(() => Date.now() - 1); sketch.act(s, drawer, { type: 'clock' });
  assert.equal(s.hints.length, s.hintAt.length, 'hints are revealed on time');
  s.endsAt = Date.now() - 1; sketch.act(s, drawer, { type: 'clock' }); assert.equal(s.phase, 'reveal');
  s.revealUntil = 0; sketch.act(s, drawer, { type: 'next' });
  sketch.act(s, s.drawer, { type: 'choose', i: 0 }); sketch.act(s, s.drawer, { type: 'skip' });
  sketch.act(s, s.drawer, { type: 'next' });
  assert.equal(s.over, true, 'one round of three drawers ends the game');
  assert.deepEqual(sketch.turnOf(s), []);
}

/* ---------------- Word Spies ---------------- */
{
  assert.throws(() => spies.setup(team(3)));
  const s = spies.setup(team(4));
  assert.equal(s.words.length, 25); assert.equal(new Set(s.words).size, 25);
  assert.deepEqual(['r', 'b', 'n', 'x'].map((k) => s.key.filter((x) => x === k).length).sort(), [1, 7, 8, 9]);
  assert.equal(s.key.filter((k) => k === s.turn).length, 9, 'the starting team has 9 agents');
  const spy = s.players.find((p) => p.spy && p.team === s.turn), agent = s.players.find((p) => !p.spy && p.team === s.turn);
  const rival = s.players.find((p) => !p.spy && p.team !== s.turn);
  assert.ok(spies.view(s, agent.id).key.every((k) => k === null), 'agents cannot see the key');
  assert.deepEqual(spies.view(s, spy.id).key, s.key, 'spymasters can');
  assert.deepEqual(spies.turnOf(s), [spy.id]);
  assert.throws(() => spies.act(s, agent.id, { type: 'clue', word: 'ocean', n: 2 }), /spymaster/);
  assert.throws(() => spies.act(s, rival.id, { type: 'pass' }), /turn/);
  assert.throws(() => spies.act(s, spy.id, { type: 'clue', word: s.words[0], n: 1 }), /close/);
  assert.throws(() => spies.act(s, spy.id, { type: 'clue', word: 'two words', n: 1 }), /one word/);
  assert.throws(() => spies.act(s, spy.id, { type: 'clue', word: 'zzz', n: 0 }), /number/);
  spies.act(s, spy.id, { type: 'clue', word: 'zzz', n: 2 });
  assert.equal(s.left, 3);
  assert.throws(() => spies.act(s, spy.id, { type: 'guess', card: 0 }), /Spymasters/);
  const mine = s.key.findIndex((k) => k === s.turn);
  spies.act(s, agent.id, { type: 'guess', card: mine });
  assert.equal(s.turn, agent.team, 'your own agent: keep guessing'); assert.equal(s.left, 2);
  assert.equal(spies.view(s, agent.id).key[mine], agent.team, 'revealed cards show their colour');
  assert.throws(() => spies.act(s, agent.id, { type: 'guess', card: mine }), /hidden/);
  const bystander = s.key.indexOf('n');
  spies.act(s, agent.id, { type: 'guess', card: bystander });
  assert.notEqual(s.turn, agent.team, 'a bystander ends the turn'); assert.equal(s.phase, 'clue');
  const t = spies.setup(team(4)), tspy = t.players.find((p) => p.spy && p.team === t.turn), tagent = t.players.find((p) => !p.spy && p.team === t.turn);
  spies.act(t, tspy.id, { type: 'clue', word: 'zzz', n: 1 });
  spies.act(t, tagent.id, { type: 'guess', card: t.key.indexOf('x') });
  assert.equal(t.over, true); assert.notEqual(t.winner, tagent.team, 'the assassin loses the game');
  assert.ok(t.winners.every((id) => t.players.find((p) => p.id === id).team === t.winner));
  // Bot teams always finish, and computer spymasters only give legal clues.
  for (let n = 4; n <= 8; n++) for (let r = 0; r < 20; r++) {
    let g = spies.setup(team(n)), steps = 0;
    while (!g.over) { const ids = spies.turnOf(g), pid = ids[r % ids.length]; spies.act(g, pid, spies.bot(json(spies.view(g, pid)), pid)); g = json(g); assert.ok(++steps < 2000); }
  }
}

/* ---------------- tournaments ---------------- */
{
  const people = team(5);
  assert.throws(() => createTour('series', [], people), /at least one game/);
  assert.throws(() => createTour('knockout', ['chess'], people.slice(0, 1)), /at least 2/);
  const series = createTour('series', ['gems', 'mosaic'], people.slice(0, 3));
  assert.deepEqual(currentMatch(series), { gameId: 'gems', seats: ['P0', 'P1', 'P2'] });
  recordResult(series, { winners: ['P1'] });
  assert.equal(currentMatch(series).gameId, 'mosaic');
  recordResult(series, { winners: ['P1', 'P2'] });
  assert.equal(series.done, true); assert.deepEqual(series.champions, ['P1']);
  assert.deepEqual(standings(series).map((p) => p.wins), [2, 1, 0]);
  assert.match(tourLine(series, (id) => id), /Champion: Player 1/);

  const ko = createTour('knockout', ['chess'], people);
  assert.equal(ko.rounds[0].length, 3, '5 players: two matches and a bye');
  assert.equal(ko.rounds[0].filter((m) => m.b === null).length, 1);
  let guard = 0;
  while (!ko.done && guard++ < 20) {
    const m = currentMatch(ko);
    assert.equal(m.seats.length, 2); assert.equal(m.gameId, 'chess');
    if (guard === 1) { assert.match(recordResult(ko, { winners: [] }), /Rematch/); assert.deepEqual(currentMatch(ko).seats, m.seats, 'a draw is replayed'); }
    recordResult(ko, { winners: [m.seats[0]] });
  }
  assert.equal(ko.done, true); assert.equal(ko.champions.length, 1);
  assert.equal(ko.rounds.at(-1).length, 1, 'the bracket ends in one final');
  const draws = createTour('knockout', ['chess'], people.slice(0, 2));
  for (let i = 0; i < 3; i++) recordResult(draws, { winners: [] });
  assert.equal(draws.done, true, 'three straight draws are settled by a coin toss');
  assert.deepEqual(JSON.parse(JSON.stringify(ko)), ko, 'tournaments are plain JSON');
}
console.log('Party game and tournament checks passed: Sketch Party rules and privacy, Word Spies rules and key secrecy, bot teams, series and knockout brackets.');
