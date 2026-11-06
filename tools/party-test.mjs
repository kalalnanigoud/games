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
{
  // Guesses that give the word away stay private, even for short words; spacing, hyphens and accents don't matter.
  const fresh = (word) => { const s = sketch.setup(team(3)); sketch.act(s, s.drawer, { type: 'choose', i: 0 }); s.word = word; return [s, s.players.map((p) => p.id).filter((id) => id !== s.drawer)]; };
  for (const [word, guess] of [['cat', 'cats'], ['cat', 'the cat'], ['bus', 'buses'], ['sun', 'the sun'], ['apple', 'an apple'], ['apple', 'apples'], ['hot dog', 'hot dogs']]) {
    const [s, [g0, g1]] = fresh(word);
    sketch.act(s, g0, { type: 'guess', text: guess });
    assert.equal(s.feed.at(-1).k, 'close', `“${guess}” for ${word} is a private near miss`);
    assert.ok(!JSON.stringify(sketch.view(s, g1).feed).includes(guess), `“${guess}” is not shown to others`);
  }
  for (const [word, guess] of [['cat', 'dog'], ['sun', 'moon'], ['hot dog', 'hot'], ['ant', 'panda']]) {
    const [s] = fresh(word), g0 = s.players.find((p) => p.id !== s.drawer).id;
    sketch.act(s, g0, { type: 'guess', text: guess }); assert.equal(s.feed.at(-1).k, 'guess', `“${guess}” for ${word} is an ordinary miss`);
  }
  for (const [word, guess] of [['hot dog', 'hot-dog'], ['hot dog', 'HOTDOG'], ['snowman', 'snow man'], ['ice cream', 'Ice-Cream!'], ['snowman', 'snöwman'], ['cafe', 'café']]) {
    const [s, [g0]] = fresh(word);
    sketch.act(s, g0, { type: 'guess', text: guess }); assert.ok(s.guessed[g0] >= 50, `“${guess}” counts for ${word}`);
  }
  // A Hard computer guesser still uses its private near misses: told “the sun” is very close, it guesses SUN.
  const [s, [g0]] = fresh('sun');
  sketch.act(s, g0, { type: 'guess', text: 'the sun' });
  const v = json(sketch.view(s, g0)); v.level = 'hard';
  let a = { type: 'think' };
  for (let i = 0; i < 50 && a.type !== 'guess'; i++) a = sketch.bot(v, g0);
  assert.deepEqual(a, { type: 'guess', text: 'sun' });
}
{
  // Computer guessers never solve a person's drawing from the blanks alone. The drawer here is a person who
  // picked the word and hasn't drawn a line: at every level the computers stay quiet until the first letter
  // hint is out (halfway through), however long that takes, and only then guess from the letters. Multi-word
  // answers whose blank pattern fits no other word ("tug of war", "hot air balloon") get no instant guess either.
  // In Node every number of fitting words is "few enough" (the browser allows 6 to 20), so this is the strictest case.
  const real = Math.random;
  let seed = 7;
  Math.random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const guesses = (s, g, level, tries = 300) => {
    let n = 0;
    for (let i = 0; i < tries; i++) { const v = json(sketch.view(s, g)); v.level = level; if (sketch.bot(v, g).type === 'guess') n++; }
    return n;
  };
  for (const level of ['easy', 'normal', 'hard']) {
    for (const word of ['tug of war', 'hot air balloon', 'hide and seek', 'gingerbread man', 'toothbrush', 'yeti']) {
      const s = sketch.setup(team(3), { level });
      sketch.act(s, s.drawer, { type: 'choose', i: 0 });
      const letters = [...word].map((c, i) => (c === ' ' ? -1 : i)).filter((i) => i >= 0), n = letters.length >= 5 ? 2 : 1;
      Object.assign(s, { word, strokes: [], hints: [], hintPos: [letters[1], letters.at(-1)].slice(0, n) });
      const at = (f) => { // the clock f of the way through the drawing time, as the host's tick sees it
        s.started = Date.now() - f * s.drawMs; s.endsAt = s.started + s.drawMs;
        s.hintAt = [0.5, 0.75].slice(0, n).map((x) => s.started + s.drawMs * x);
        sketch.act(s, s.drawer, { type: 'clock' });
      };
      const g = s.players.find((p) => p.id !== s.drawer).id;
      for (const f of [0, 0.1, 0.25, 0.4, 0.49]) {
        at(f);
        assert.equal(s.hints.length, 0);
        assert.equal(guesses(s, g, level), 0, `${level}: no guess at “${word}” from the blanks alone, ${f * 100}% into the drawing`);
      }
      at(0.51);
      assert.equal(s.hints.length, 1, 'the first letter hint is out at half time');
      assert.ok(guesses(s, g, level) > 0, `${level}: guesses at “${word}” once a letter is shown`);
      assert.equal(s.phase, 'draw');
    }
  }
  Math.random = real;
}

/* ---------------- Word Spies ---------------- */
{
  assert.throws(() => spies.setup(team(3)));
  const s = spies.setup(team(4));
  assert.equal(s.words.length, 25); assert.equal(new Set(s.words).size, 25);
  assert.deepEqual(['r', 'b', 'n', 'x'].map((k) => s.key.filter((x) => x === k).length).sort(), [1, 7, 8, 9]);
  assert.equal(s.key.filter((k) => k === s.turn).length, 9, 'the starting team has 9 contacts');
  const spy = s.players.find((p) => p.spy && p.team === s.turn), agent = s.players.find((p) => !p.spy && p.team === s.turn);
  const rival = s.players.find((p) => !p.spy && p.team !== s.turn);
  assert.ok(spies.view(s, agent.id).key.every((k) => k === null), 'decoders cannot see the key');
  assert.deepEqual(spies.view(s, spy.id).key, s.key, 'handlers can');
  assert.deepEqual(spies.turnOf(s), [spy.id]);
  assert.throws(() => spies.act(s, agent.id, { type: 'clue', word: 'ocean', n: 2 }), /handler/);
  assert.throws(() => spies.act(s, rival.id, { type: 'pass' }), /turn/);
  assert.throws(() => spies.act(s, spy.id, { type: 'clue', word: s.words[0], n: 1 }), /close/);
  assert.throws(() => spies.act(s, spy.id, { type: 'clue', word: 'two words', n: 1 }), /one word/);
  assert.throws(() => spies.act(s, spy.id, { type: 'clue', word: 'zzz', n: 0 }), /number/);
  spies.act(s, spy.id, { type: 'clue', word: 'zzz', n: 2 });
  assert.equal(s.left, 3);
  assert.throws(() => spies.act(s, spy.id, { type: 'guess', card: 0 }), /Handlers/);
  const mine = s.key.findIndex((k) => k === s.turn);
  spies.act(s, agent.id, { type: 'guess', card: mine });
  assert.equal(s.turn, agent.team, 'your own contact: keep guessing'); assert.equal(s.left, 2);
  assert.equal(spies.view(s, agent.id).key[mine], agent.team, 'revealed cards show their colour');
  assert.throws(() => spies.act(s, agent.id, { type: 'guess', card: mine }), /hidden/);
  const bystander = s.key.indexOf('n');
  spies.act(s, agent.id, { type: 'guess', card: bystander });
  assert.notEqual(s.turn, agent.team, 'a civilian ends the turn'); assert.equal(s.phase, 'clue');
  const t = spies.setup(team(4)), tspy = t.players.find((p) => p.spy && p.team === t.turn), tagent = t.players.find((p) => !p.spy && p.team === t.turn);
  spies.act(t, tspy.id, { type: 'clue', word: 'zzz', n: 1 });
  spies.act(t, tagent.id, { type: 'guess', card: t.key.indexOf('x') });
  assert.equal(t.over, true); assert.notEqual(t.winner, tagent.team, 'the Mole loses the game');
  assert.ok(t.winners.every((id) => t.players.find((p) => p.id === id).team === t.winner));
  assert.match(t.log[0], /Mole/);
  // Bot teams always finish, and computer handlers only give legal clues.
  for (let n = 4; n <= 8; n++) for (let r = 0; r < 20; r++) {
    let g = spies.setup(team(n)), steps = 0;
    while (!g.over) { const ids = spies.turnOf(g), pid = ids[r % ids.length]; spies.act(g, pid, spies.bot(json(spies.view(g, pid)), pid)); g = json(g); assert.ok(++steps < 2000); }
  }
  // A board of our choosing: the listed cards are face down with the given keys, every other card is face up.
  const FILL = 'whale ship piano guitar knife oven cow pig snow king queen ball goal bank coin bus taxi book pencil chalk tower park'.split(' ');
  const board = (cards) => {
    const g = spies.setup(team(4)), me = g.players.find((p) => p.spy && p.team === g.turn), opp = g.turn === 'r' ? 'b' : 'r';
    const keys = { own: g.turn, opp, n: 'n', x: 'x' }, list = Object.entries(cards);
    g.words = [...list.map(([w]) => w), ...FILL].slice(0, 25);
    g.key = g.words.map((w, i) => (i < list.length ? keys[list[i][1]] : 'n')); g.open = g.words.map((w, i) => i >= list.length);
    return [g, me];
  };
  // Clues: only a board word or the same word plus s/es/ing/ed/er is too close; a word hiding inside another is fine.
  const [c, cspy] = board({ ice: 'own', ant: 'own', knight: 'opp', dance: 'n', swim: 'n', x0: 'x' });
  const clue = (word) => spies.act(json(c), cspy.id, { type: 'clue', word, n: 1 });
  for (const ok of ['juice', 'police', 'giant', 'night', 'whales', 'diced']) assert.doesNotThrow(() => clue(ok), `“${ok}” is a fair clue`);
  for (const bad of ['ice', 'ices', 'ants', 'knights', 'dancing', 'danced', 'swimmer', 'whale']) assert.throws(() => clue(bad), /too close/, `“${bad}” is too close`);
  for (const bad of ['sea-creature', 'ice cream', 'sea creature']) assert.throws(() => clue(bad), /one word/);
  // Normal handler with no good theme: its fallback never covers the Mole and prefers sparing the other team.
  const fallback = (cards) => { const [g, sp] = board(cards); g.level = 'normal'; return spies.bot(json(spies.view(g, sp.id)), sp.id); };
  const a1 = fallback({ star: 'own', moon: 'x', actor: 'n', screen: 'n', director: 'n' }); // STAR: space, movie, night; MOON: space, night
  assert.deepEqual(a1, { type: 'clue', word: 'movie', n: 1 }, 'not SPACE or NIGHT, which point at the Mole');
  const a2 = fallback({ owl: 'own', moon: 'x', bear: 'opp', eagle: 'n', nest: 'n', wing: 'n' }); // OWL: forest, night, birds
  assert.deepEqual(a2, { type: 'clue', word: 'birds', n: 1 }, 'not NIGHT (the Mole) or FOREST (their BEAR)');
}
{
  // Word Spies has names of its own: handlers, decoders, contacts, civilians and the Mole. No player-visible text
  // (description, rules, cover, log, error messages, rendered screens and their aria-labels) uses the old terms.
  // The state keeps its old field names (`spy`, keys 'n' and 'x'), so rooms on an older version play on.
  const OLD = /spymaster|assassin|bystander|innocent|\bagents?\b/i;
  const rules = [spies.description, JSON.stringify(spies.howTo)].join('\n');
  for (const term of ['handler', 'decoder', 'contact', 'civilian', 'Mole']) assert.ok(rules.includes(term), `the rules talk about ${term}s`);
  // render() with a minimal fake element: morph() parses the markup into a <template>, which is where it's caught.
  const screen = (g, pid) => {
    let html = '';
    const stub = new Proxy({}, { get: (o, k) => (k in o ? o[k] : k === 'querySelector' ? () => stub : k === 'querySelectorAll' ? () => [] : undefined), set: (o, k, x) => ((o[k] = x), true) });
    const el = { childNodes: [], firstChild: null, querySelector: () => stub, querySelectorAll: () => [], contains: () => false };
    Object.assign(globalThis, {
      SVGElement: class {}, SVGForeignObjectElement: class {},
      document: { head: { appendChild() {} }, activeElement: null, createElement: (tag) => (tag === 'template' ? { set innerHTML(h) { html = h; }, content: { childNodes: [], firstChild: null } } : { dataset: {} }) },
    });
    const players = g.players.map((p) => ({ id: p.id, name: p.name }));
    try { spies.render(el, json(spies.view(g, pid)), { me: pid, players, name: (id) => id, isBot: () => false, send() {}, isHost: true, local: false }); }
    finally { delete globalThis.document; delete globalThis.SVGElement; delete globalThis.SVGForeignObjectElement; }
    assert.ok(html.length > 1000, 'render() produced the board');
    return html;
  };
  const shown = [rules, spies.cover];
  const g = spies.setup(team(6));
  const handler = g.players.find((p) => p.spy && p.team === g.turn), decoder = g.players.find((p) => !p.spy && p.team === g.turn);
  const seats = [...g.players.map((p) => p.id), 'watcher'];
  const errors = (fn) => { try { fn(); } catch (e) { shown.push(e.message); } };
  for (const pid of seats) shown.push(screen(g, pid));
  errors(() => spies.act(g, decoder.id, { type: 'clue', word: 'ocean', n: 1 }));
  errors(() => spies.act(g, decoder.id, { type: 'guess', card: 0 }));
  spies.act(g, handler.id, { type: 'clue', word: 'zzz', n: 2 });
  errors(() => spies.act(g, handler.id, { type: 'guess', card: 0 }));
  for (const pid of seats) shown.push(screen(g, pid));
  const html = screen(g, decoder.id);
  assert.match(screen(g, handler.id), /You are the handler/); assert.match(html, /You are a decoder/); assert.match(html, />Handler</);
  spies.act(g, decoder.id, { type: 'guess', card: g.key.indexOf(g.turn) });
  spies.act(g, decoder.id, { type: 'guess', card: g.key.indexOf('n') });
  spies.act(g, g.players.find((p) => p.spy && p.team === g.turn).id, { type: 'clue', word: 'zzz', n: 1 });
  spies.act(g, g.players.find((p) => !p.spy && p.team === g.turn).id, { type: 'guess', card: g.key.indexOf('x') });
  assert.equal(g.over, true);
  for (const pid of seats) shown.push(screen(g, pid));
  const over = shown.at(-1);
  for (const label of ['red contact', 'blue contact', 'civilian', 'the Mole']) assert.ok(over.includes(label), `the cards' labels name the ${label}`);
  const log = g.log.join('\n');
  for (const term of ['contacts to find', 'handler', 'civilian', 'Mole']) assert.ok(log.includes(term), `the log mentions “${term}”`);
  // Full bot games, for every log line a game can write (contacts reached, wins, the Mole).
  for (let n = 4; n <= 8; n++) for (let r = 0; r < 10; r++) {
    let b = spies.setup(team(n));
    while (!b.over) { const ids = spies.turnOf(b), pid = ids[r % ids.length]; spies.act(b, pid, spies.bot(json(spies.view(b, pid)), pid)); }
    shown.push(...b.log);
  }
  shown.push(log);
  for (const text of shown) assert.doesNotMatch(text, OLD, `old term in: ${text.match(new RegExp(`.{0,60}(${OLD.source}).{0,60}`, 'i'))?.[0]}`);
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
console.log('Party game and tournament checks passed: Sketch Party rules and privacy, no computer guesses from the blanks alone, Word Spies rules, key secrecy and its own names, bot teams, series and knockout brackets.');
