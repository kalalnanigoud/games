// Atlas (games/atlas.js): the place chain, last-letter rule, no repeats, forgiving matching, the vote on
// places that aren't in the atlas, lives, passing, the turn clock, elimination, the end of the journey,
// timeouts, spectators and the computer levels.
//   node tools/atlas-test.mjs
import assert from 'node:assert/strict';
import atlas from '../games/atlas.js';
import { PLACES, squash } from '../games/word-lists.js';
import { seededRandom } from './seed.mjs';

Math.random = seededRandom('atlas-test');
const players = (n) => Array.from({ length: n }, (_, i) => ({ id: 'P' + i, name: 'Player ' + i }));
const clone = (x) => JSON.parse(JSON.stringify(x));
// A game where P0 starts with a chosen letter.
function game(n = 3, letter = 'd', opts = {}) {
  const s = atlas.setup(players(n), opts);
  s.turn = 0; s.letter = letter;
  return s;
}
const say = (s, text) => atlas.act(s, s.players[s.turn].id, { type: 'place', text });
const whose = (s) => s.players[s.turn].id;

// ---- setup and options ----
{
  const s = atlas.setup(players(4));
  assert.equal(s.phase, 'play'); assert.equal(s.lives, 3); assert.equal(s.timeMs, 15000);
  assert.ok(s.players.every((p) => p.lives === 3));
  assert.ok(/^[a-z]$/.test(s.letter));
  assert.deepEqual(atlas.turnOf(s), [whose(s)], 'one traveller at a time');
  assert.doesNotThrow(() => JSON.stringify(s));
  const t = atlas.setup(players(2), { lives: '5', time: '20', level: 'hard' });
  assert.equal(t.lives, 5); assert.equal(t.timeMs, 20000); assert.equal(t.level, 'hard');
  assert.equal(atlas.setup(players(2), { lives: '9', time: '3' }).lives, 3, 'unknown options fall back');
  assert.throws(() => atlas.setup(players(1)), /2–8/); assert.throws(() => atlas.setup(players(9)), /2–8/);
  const firsts = new Set(), letters = new Set();
  for (let i = 0; i < 80; i++) { const g = atlas.setup(players(4)); firsts.add(whose(g)); letters.add(g.letter); }
  assert.equal(firsts.size, 4, 'anyone may start'); assert.ok(letters.size >= 8, 'the first letter is random');
  for (const level of ['easy', 'normal', 'hard']) assert.equal(atlas.view(atlas.setup(players(2), { level }), 'P0').level, level);
  assert.deepEqual(atlas.options.map((o) => o.id), ['lives', 'time', 'level']);
  assert.ok(PLACES.length >= 800);
}
// ---- the chain: start with the last letter, no repeats, turns go round ----
{
  const s = game(3, 'd');
  assert.throws(() => atlas.act(s, 'P1', { type: 'place', text: 'Delhi' }), /turn/);
  assert.throws(() => say(s, 'Mumbai'), /start with D/);
  assert.throws(() => say(s, ' '), /Type a place/);
  assert.throws(() => atlas.act(s, 'P0', { type: 'place', text: 7 }), /Type a place/);
  assert.throws(() => atlas.act(s, 'stranger', { type: 'pass' }), /not playing/);
  say(s, 'delhi');
  assert.equal(s.chain[0].text, 'Delhi', 'shown with the atlas spelling');
  assert.equal(s.letter, 'i'); assert.equal(whose(s), 'P1');
  say(s, 'INDIA');
  assert.equal(s.letter, 'a'); assert.equal(whose(s), 'P2');
  say(s, 'Amsterdam');
  assert.equal(s.letter, 'm'); assert.equal(whose(s), 'P0', 'back to the first traveller');
  say(s, 'Madrid');
  assert.throws(() => say(s, 'Delhi'), /already been named/);
  assert.throws(() => say(s, 'dElHi'), /already been named/, 'repeats are caught whatever the case');
  assert.equal(s.players.find((p) => p.id === 'P0').places, 2);
  assert.match(s.log[0], /Madrid/);
}
// ---- forgiving matching: accents, spaces, hyphens, slips, old names ----
{
  const s = game(2, 's');
  say(s, 'são-paulo');
  assert.equal(s.chain[0].text, 'Sao Paulo'); assert.equal(s.letter, 'o');
  say(s, 'Oslo'); // → o
  say(s, 'Ootyy'); // doubled letters are forgiven
  assert.equal(s.chain.at(-1).text, 'Ooty');
  say(s, 'Yellowpine Bay'); // not in the atlas...
  assert.equal(s.phase, 'vote', '...so it goes to a vote');
  const g = game(2, 'b');
  say(g, 'Bhubaneshwar');
  assert.equal(g.chain[0].text, 'Bhubaneswar', 'a small slip in a long name still counts'); assert.equal(g.letter, 'r');
  const h = game(2, 'b');
  say(h, 'bombay');
  assert.equal(h.chain[0].text, 'Bombay', 'an old name is shown as said'); assert.equal(h.letter, 'y', 'and its own last letter counts');
  say(h, 'Yangon');
  const k = game(2, 'm'); say(k, 'Mumbai');
  k.turn = 0; k.letter = 'b';
  assert.throws(() => say(k, 'Bombay'), /already been named/, 'Bombay is Mumbai: no repeats by another name');
}
// ---- a dead letter moves back through the word ----
{
  const s = game(2, 'i');
  s.used = PLACES.filter((p) => squash(p)[0] === 'q').map(squash); // every Q place is used up
  say(s, 'Iraq');
  assert.equal(s.letter, 'a', 'no Q places left, so the letter before it is used');
  assert.match(s.log[0], /no places left/);
}
// ---- passing and running out of time cost a life; the same letter goes to the next traveller ----
{
  const s = game(3, 'k');
  atlas.act(s, 'P0', { type: 'pass' });
  assert.equal(s.players[0].lives, 2); assert.equal(whose(s), 'P1'); assert.equal(s.letter, 'k', 'the letter stays');
  assert.throws(() => atlas.act(s, 'P0', { type: 'pass' }), /turn/);
  const early = clone(s); atlas.act(early, 'P2', { type: 'clock' });
  assert.deepEqual([early.players[1].lives, whose(early)], [3, 'P1'], 'an early clock changes nothing');
  s.endsAt = Date.now() - 1;
  atlas.act(s, 'P2', { type: 'clock' }); // any player's screen may report the time
  assert.equal(s.players[1].lives, 2); assert.equal(whose(s), 'P2');
  assert.match(s.log[0], /ran out of time/);
  assert.ok(s.endsAt > Date.now() + 10000, 'a fresh clock for the next turn');
}
// ---- the vote on a place that isn't in the atlas ----
{
  const s = game(3, 'k');
  say(s, 'koregaon');
  assert.equal(s.phase, 'vote'); assert.equal(s.vote.text, 'Koregaon');
  assert.deepEqual(atlas.turnOf(s).sort(), ['P1', 'P2'], 'the others vote');
  assert.throws(() => atlas.act(s, 'P0', { type: 'vote', ok: true }), /own place/);
  assert.throws(() => atlas.act(s, 'P1', { type: 'vote', ok: 1 }), /thumbs/);
  assert.throws(() => atlas.act(s, 'P1', { type: 'pass' }), /vote/);
  atlas.act(s, 'P1', { type: 'vote', ok: true });
  atlas.act(s, 'P2', { type: 'vote', ok: false });
  assert.equal(s.phase, 'play', 'a 1–1 tie lets it in');
  assert.equal(s.chain.at(-1).text, 'Koregaon'); assert.equal(s.chain.at(-1).how, 'vote'); assert.equal(s.letter, 'n');
  s.letter = 'k';
  assert.throws(() => say(s, 'Koregaon'), /already been named/, 'a voted-in place cannot be repeated either');
  // rejected: a life is lost
  const r = game(3, 'z');
  say(r, 'Zzonkle');
  atlas.act(r, 'P1', { type: 'vote', ok: false }); atlas.act(r, 'P2', { type: 'vote', ok: false });
  assert.equal(r.players[0].lives, 2); assert.equal(whose(r), 'P1'); assert.equal(r.letter, 'z');
  assert.match(r.log[0], /table said no/);
  // silence accepts when the vote time is up
  const q = game(3, 'p');
  say(q, 'Pallavaram');
  atlas.act(q, 'P1', { type: 'vote', ok: false });
  const early = clone(q); atlas.act(early, 'P1', { type: 'clock' }); assert.equal(early.phase, 'vote');
  q.vote.until = Date.now() - 1;
  atlas.act(q, 'P2', { type: 'clock' });
  assert.equal(q.phase, 'play'); assert.equal(q.chain.at(-1).text, 'Pallavaram', '1 against, 1 silent (counted as up): a tie, so it is in');
}
// ---- elimination, skipping, and the last traveller wins ----
{
  const s = game(3, 'd', { lives: '1' });
  atlas.act(s, 'P0', { type: 'pass' });
  assert.equal(s.players[0].lives, 0); assert.match(s.log[0], /out of lives/);
  say(s, 'Delhi'); // P1
  say(s, 'Indore'); // P2
  assert.equal(whose(s), 'P1', 'travellers who are out are skipped');
  atlas.act(s, 'P1', { type: 'pass' });
  assert.equal(s.over, true); assert.deepEqual(s.winners, ['P2']);
  assert.deepEqual(atlas.turnOf(s), []);
  assert.throws(() => atlas.act(s, 'P2', { type: 'clock' }), /over/);
}
// ---- the journey has an end: most lives wins, then most places named ----
{
  const s = game(2, 'd');
  s.chain = Array.from({ length: 119 }, (_, i) => ({ text: 'X' + i, by: 'P1', how: 'list' }));
  s.players[0].lives = 2; s.players[1].lives = 2; s.players[0].places = 3; s.players[1].places = 3;
  say(s, 'Delhi');
  assert.equal(s.over, true); assert.deepEqual(s.winners, ['P0'], 'level on lives: more places named wins');
  const t = game(2, 'd');
  t.chain = Array.from({ length: 119 }, () => ({ text: 'Agra', by: 'P1', how: 'list' }));
  t.players[1].lives = 3; t.players[0].lives = 1; t.players[0].places = 9;
  say(t, 'Delhi');
  assert.deepEqual(t.winners, ['P1'], 'most lives wins');
}
// ---- views and spectators ----
{
  const s = game(3, 'c');
  const w = atlas.view(s, 'watcher');
  assert.ok(w.players.every((p) => p.salt === 0), "computer seeds are private");
  assert.equal(atlas.view(s, 'P1').players.find((p) => p.id === 'P1').salt, s.players[1].salt);
  assert.ok(w.left > 20, 'the view says how many places are left for the letter');
}
// ---- timeouts are gentle and legal ----
{
  const s = game(3, 'g');
  let a = atlas.timeoutMove(clone(atlas.view(s, 'P0')), 'P0');
  assert.equal(a.type, 'pass'); atlas.act(s, 'P0', a);
  say(s, 'Gondwanaland Town');
  for (const pid of atlas.turnOf(s)) { a = atlas.timeoutMove(clone(atlas.view(s, pid)), pid); assert.deepEqual(a, { type: 'vote', ok: true }); atlas.act(s, pid, a); }
  assert.equal(s.phase, 'play');
}
// ---- computers: legal, sensible votes, Hard sets traps, Hard beats Easy ----
{
  const s = game(3, 'p');
  say(s, 'Pqxrtzv');
  for (const pid of atlas.turnOf(s)) { const a = atlas.bot(clone({ ...atlas.view(s, pid), level: 'hard' }), pid); assert.equal(a.type, 'vote'); assert.equal(a.ok, false, 'mash is voted down'); }
  const t = game(3, 'p'); say(t, 'Patna');
  const pid = atlas.turnOf(t)[0], v = { ...atlas.view(t, pid), level: 'hard' };
  assert.equal(atlas.bot(clone(v), pid).type, 'place');
  // Hard prefers endings with few places left
  let trapHard = 0, trapEasy = 0;
  for (let r = 0; r < 60; r++) for (const level of ['easy', 'hard']) {
    const g = game(2, 'i', { level });
    g.players[0].salt = r * 7919 + 1;
    const a = atlas.bot(clone(atlas.view(g, 'P0')), 'P0');
    if (a.type !== 'place') continue;
    const next = clone(g); atlas.act(next, 'P0', a);
    if (atlas.view(next, 'P1').left <= 12) level === 'hard' ? trapHard++ : trapEasy++;
  }
  assert.ok(trapHard > trapEasy + 15, `Hard traps the next player more often (${trapHard} vs ${trapEasy})`);
}
{
  let hard = 0, easy = 0, draws = 0;
  for (let r = 0; r < 100; r++) {
    Math.random = seededRandom(`atlas-levels:${r}`);
    const hardSeat = r % 2 ? 'P0' : 'P1';
    let s = atlas.setup(players(2), { level: 'normal' });
    for (let steps = 0; !s.over && steps < 5000; steps++) {
      const due = atlas.turnOf(s), pid = due[Math.floor(Math.random() * due.length)];
      const v = { ...clone(atlas.view(s, pid)), level: pid === hardSeat ? 'hard' : 'easy' };
      const next = clone(s); atlas.act(next, pid, atlas.bot(v, pid)); s = next;
    }
    assert.ok(s.over, 'every game finishes');
    if (s.winners.length !== 1) draws++; else if (s.winners[0] === hardSeat) hard++; else easy++;
  }
  const rate = hard / Math.max(1, hard + easy);
  console.log(`  Hard vs Easy over 100 games: Hard ${hard}, Easy ${easy}, shared ${draws} (Hard wins ${(rate * 100).toFixed(0)}% of decided games)`);
  assert.ok(rate >= 0.62, 'Hard wins at least 62% of decided games');
}

// ---- late moves: once the deadline has passed, a move applies it and is itself dropped ----
{
  const s = game(3, 'd');
  s.endsAt = Date.now() - 5000; // nobody's screen has sent the clock yet
  say(s, 'Delhi');
  assert.equal(s.players[0].lives, 2, 'a place named after the time ran out loses the life');
  assert.ok(!s.chain.some((c) => c.text === 'Delhi'), 'and is not added to the chain');
  assert.equal(whose(s), 'P1');
  const q = game(3, 'p');
  say(q, 'Pallavaram');
  assert.equal(q.phase, 'vote');
  q.vote.until = Date.now() - 5000;
  atlas.act(q, 'P1', { type: 'vote', ok: false });
  assert.equal(q.chain.at(-1).text, 'Pallavaram', 'late votes are not counted: silence lets it in');
}
console.log('atlas-test: all checks passed');
