// Name, Place, Animal, Thing (games/npat.js): letters, secret answers, Stop and the last chance, scoring
// (unique 10, shared 5, blank 0), forgiving matching, the vote on new words, clocks, timeouts, secrecy,
// spectators and the computer levels.
//   node tools/npat-test.mjs
import assert from 'node:assert/strict';
import npat from '../games/npat.js';
import { NAMES, PLACES, ANIMALS, THINGS, byLetter } from '../games/word-lists.js';
import { seededRandom } from './seed.mjs';

Math.random = seededRandom('npat-test');
const players = (n) => Array.from({ length: n }, (_, i) => ({ id: 'P' + i, name: 'Player ' + i }));
const clone = (x) => JSON.parse(JSON.stringify(x));
const CATS = ['name', 'place', 'animal', 'thing'];
// A game whose first letter is fixed, for predictable answers.
function game(n = 3, letter = 'm', opts = {}) {
  const s = npat.setup(players(n), opts);
  s.letters[0] = letter; s.letter = letter;
  return s;
}
const fill = (s, pid, answers) => npat.act(s, pid, { type: 'fill', answers });
const doneAll = (s) => { for (const p of s.players) if (!s.done[p.id]) npat.act(s, p.id, { type: 'done' }); };
const sheet = (s, pid, cat) => s.last.sheet[pid][cat];

// ---- setup and options ----
{
  const s = npat.setup(players(4));
  assert.equal(s.phase, 'play'); assert.equal(s.round, 1); assert.equal(s.rounds, 5); assert.equal(s.timeMs, 60000);
  assert.ok(s.endsAt > Date.now() + 55000, 'a 60 second clock');
  assert.doesNotThrow(() => JSON.stringify(s));
  assert.deepEqual(npat.turnOf(s).sort(), ['P0', 'P1', 'P2', 'P3'], 'everyone writes at once');
  assert.equal(npat.simultaneous, true);
  const t = npat.setup(players(2), { rounds: '10', time: '90', level: 'hard' });
  assert.equal(t.rounds, 10); assert.equal(t.timeMs, 90000); assert.equal(t.level, 'hard');
  assert.equal(npat.setup(players(2), { rounds: '7', time: '5' }).rounds, 5, 'unknown options fall back');
  assert.throws(() => npat.setup(players(1)), /2–8/); assert.throws(() => npat.setup(players(9)), /2–8/);
  for (let i = 0; i < 40; i++) {
    const g = npat.setup(players(2), { rounds: '10' });
    assert.equal(new Set(g.letters).size, 10, 'no letter twice in a game');
    assert.ok(g.letters.every((c) => !'qxz'.includes(c)), 'Q, X and Z are skipped');
  }
  for (const level of ['easy', 'normal', 'hard']) assert.equal(npat.view(npat.setup(players(2), { level }), 'P0').level, level);
  assert.deepEqual(npat.options.map((o) => o.id), ['rounds', 'time', 'level']);
}
// ---- every playable letter has several words in every category ----
{
  const lists = { name: NAMES, place: PLACES, animal: ANIMALS, thing: THINGS };
  for (const cat of CATS) {
    const by = byLetter(lists[cat]);
    for (const c of 'abcdefghijklmnoprstuvwy') assert.ok((by[c] || []).length >= 5, `${cat} has at least 5 words for ${c.toUpperCase()}`);
  }
  assert.ok(NAMES.length >= 600 && PLACES.length >= 800 && ANIMALS.length >= 400 && THINGS.length >= 600, 'list sizes');
}
// ---- answers are private until the round ends; the coming letters are hidden ----
{
  const s = game(3);
  fill(s, 'P0', { name: 'Meera', place: 'Mumbai' });
  const v1 = npat.view(s, 'P1');
  assert.equal(v1.cur.P0, undefined, "others' answers are hidden");
  assert.equal(v1.progress.P0, 2, 'but you can see how many boxes they filled');
  assert.equal(v1.letters, undefined, 'the coming letters stay with the host');
  assert.equal(v1.players.find((p) => p.id === 'P0').salt, 0, "others' computer seeds are hidden");
  const v0 = npat.view(s, 'P0');
  assert.equal(v0.cur.P0.name, 'Meera', 'you see your own');
  const w = npat.view(s, 'watcher');
  assert.deepEqual(w.cur, {}, 'spectators see no answers');
  assert.ok(w.players.every((p) => p.salt === 0));
  assert.ok(!JSON.stringify(w).includes('Meera'), 'nothing leaks to a spectator');
}
// ---- validation of moves ----
{
  const s = game(2);
  assert.throws(() => npat.act(s, 'stranger', { type: 'done' }), /not playing/);
  assert.throws(() => npat.act(s, 'P0', null), /Choose/);
  assert.throws(() => npat.act(s, 'P0', { type: 'answer', cat: 'colour', text: 'Mauve' }), /Name, Place, Animal or Thing/);
  assert.throws(() => npat.act(s, 'P0', { type: 'answer', cat: 'name', text: 42 }), /Type a word/);
  assert.throws(() => npat.act(s, 'P0', { type: 'fill', answers: ['x'] }), /could not be read/);
  assert.throws(() => npat.act(s, 'P0', { type: 'fly' }), /Unknown/);
  assert.throws(() => npat.act(s, 'P0', { type: 'vote', item: 0, ok: true }), /nothing to vote/);
  assert.throws(() => npat.act(s, 'P0', { type: 'ready' }), /Not yet/);
  npat.act(s, 'P0', { type: 'answer', cat: 'name', text: '  Ma\u0007dhu   ' + 'x'.repeat(60) });
  assert.ok(s.cur.P0.name.startsWith('Madhu x') && s.cur.P0.name.length === 30, 'answers are tidied and capped at 30 characters');
  assert.throws(() => npat.act(s, 'P0', { type: 'stop' }), /all four/);
  assert.equal(s.done.P0, undefined, 'a refused Stop changes nothing');
  npat.act(s, 'P0', { type: 'done' });
  assert.throws(() => npat.act(s, 'P0', { type: 'answer', cat: 'name', text: 'Mohan' }), /already handed in/);
  assert.doesNotThrow(() => npat.act(s, 'P0', { type: 'answer', cat: 'name', text: s.cur.P0.name }), 'a repeat of what you handed in is harmless');
  assert.deepEqual(npat.turnOf(s), ['P1'], 'only those still writing');
}
// ---- Stop: all four must start with the letter; then five seconds for the rest ----
{
  const s = game(3);
  fill(s, 'P0', { name: 'Meera', place: 'Mumbai', animal: 'Monkey', thing: 'Pencil' });
  assert.throws(() => npat.act(s, 'P0', { type: 'stop' }), /starting with M/);
  npat.act(s, 'P0', { type: 'stop', answers: { thing: 'Mirror' } });
  assert.equal(s.phase, 'last'); assert.equal(s.stopper, 'P0');
  assert.ok(s.endsAt <= Date.now() + 5000, 'five seconds left');
  assert.match(s.log[0], /STOP/);
  npat.act(s, 'P1', { type: 'answer', cat: 'name', text: 'Mohan' }); // still allowed in the last chance
  assert.deepEqual(npat.turnOf(s).sort(), ['P1', 'P2']);
  const early = clone(s); npat.act(early, 'P1', { type: 'clock' }); assert.equal(early.phase, 'last', 'an early clock changes nothing');
  s.endsAt = Date.now() - 1;
  npat.act(s, 'P2', { type: 'clock' });
  assert.notEqual(s.phase, 'last', 'the round ends when the time is up');
  assert.equal(s.last.sheet.P1.name.text, 'Mohan');
  // a late keystroke after the bell is ignored, not an error
  assert.doesNotThrow(() => npat.act(s, 'P1', { type: 'answer', cat: 'place', text: 'Madrid' }));
}
// ---- the round ends when everyone hands in; scoring unique / shared / blank / wrong letter ----
{
  const s = game(3);
  fill(s, 'P0', { name: 'Meera', place: 'New York', animal: 'Monkey', thing: 'Mirror' });
  fill(s, 'P1', { name: 'meera', place: 'Madrid', animal: 'Monkeys', thing: 'Pen' });
  fill(s, 'P2', { name: 'Mohan', place: 'MUMBAI', animal: '', thing: 'mirror' });
  doneAll(s);
  assert.equal(s.phase, 'results');
  assert.equal(sheet(s, 'P0', 'name').pts, 5, 'shared names score 5 (case does not matter)');
  assert.equal(sheet(s, 'P2', 'name').pts, 10, 'a unique name scores 10');
  assert.equal(sheet(s, 'P0', 'place').why, 'letter'); assert.equal(sheet(s, 'P0', 'place').pts, 0, 'a wrong letter scores 0');
  assert.equal(sheet(s, 'P1', 'place').pts, 10); assert.equal(sheet(s, 'P2', 'place').pts, 10);
  assert.equal(sheet(s, 'P0', 'animal').pts, 5, 'Monkey and Monkeys are the same answer');
  assert.equal(sheet(s, 'P2', 'animal').why, 'blank'); assert.equal(sheet(s, 'P2', 'animal').pts, 0);
  assert.equal(sheet(s, 'P1', 'thing').pts, 0);
  assert.equal(sheet(s, 'P0', 'thing').pts, 5);
  assert.deepEqual(s.last.totals, { P0: 15, P1: 20, P2: 25 });
  assert.equal(s.players.find((p) => p.id === 'P1').score, 20);
  assert.equal(s.history.length, 1);
  assert.equal(npat.view(s, 'watcher').last.sheet.P0.name.text, 'Meera', 'answers are public once the round is over');
}
// ---- forgiving matching: accents, spaces, hyphens, aliases, spelling variants, small slips ----
{
  const s = game(2, 'b');
  fill(s, 'P0', { name: 'Bhāvna', place: 'bombay', animal: 'butter-fly', thing: 'Book Mark' });
  fill(s, 'P1', { name: 'Bhavana', place: 'Buenos  Aires', animal: 'Buffaloes', thing: 'Bicycles' });
  doneAll(s);
  assert.equal(s.phase, 'results', 'all of these are in the book: no vote needed');
  for (const pid of ['P0', 'P1']) for (const cat of CATS) assert.equal(sheet(s, pid, cat).why, 'list', `${pid} ${cat}: ${sheet(s, pid, cat).text}`);
  assert.equal(sheet(s, 'P0', 'name').pts, 5, 'Bhāvna and Bhavana (one slip) count as the same name');
}
// ---- the vote on words that aren't in the book ----
{
  const s = game(3, 'k');
  fill(s, 'P0', { name: 'Kanishka', place: 'Kolkata', animal: 'Kakapo', thing: 'Kite' });
  fill(s, 'P1', { name: 'Karan', place: 'Kochi', animal: 'Koala', thing: 'Kxqzt' });
  fill(s, 'P2', { name: 'Kanishka', place: 'Kyoto', animal: 'Kudu', thing: 'Key' });
  doneAll(s);
  assert.equal(s.phase, 'vote');
  const items = s.vote.items.map((it) => `${it.cat}:${it.text}:${it.by.join('+')}`);
  assert.deepEqual(items.sort(), ['animal:Kakapo:P0', 'name:Kanishka:P0+P2', 'thing:Kxqzt:P1'].sort(), 'one item per new word, shared words together');
  const iName = s.vote.items.findIndex((it) => it.cat === 'name'), iBird = s.vote.items.findIndex((it) => it.cat === 'animal'), iJunk = s.vote.items.findIndex((it) => it.cat === 'thing');
  assert.deepEqual(npat.turnOf(s).sort(), ['P0', 'P1', 'P2'], 'everyone has something to vote on');
  assert.throws(() => npat.act(s, 'P0', { type: 'vote', item: iName, ok: true }), /own answer/);
  assert.throws(() => npat.act(s, 'P1', { type: 'vote', item: 9, ok: true }), /Pick one/);
  assert.throws(() => npat.act(s, 'P1', { type: 'vote', item: iName, ok: 'yes' }), /thumbs/);
  assert.throws(() => npat.act(s, 'P1', { type: 'done' }), /round is over/);
  npat.act(s, 'P1', { type: 'vote', item: iName, ok: true });
  npat.act(s, 'P1', { type: 'vote', item: iBird, ok: false });
  npat.act(s, 'P2', { type: 'vote', item: iBird, ok: true }); // 1-1: a tie lets it in
  npat.act(s, 'P0', { type: 'vote', item: iJunk, ok: false });
  assert.equal(s.phase, 'vote', 'still waiting for P2 on the junk word');
  assert.deepEqual(npat.turnOf(s), ['P2']);
  npat.act(s, 'P2', { type: 'vote', item: iJunk, ok: false });
  assert.equal(s.phase, 'results', 'the vote ends as soon as every vote is in');
  assert.equal(sheet(s, 'P0', 'name').why, 'voted'); assert.equal(sheet(s, 'P0', 'name').pts, 5, 'voted in, and shared');
  assert.equal(sheet(s, 'P0', 'animal').pts, 10, 'a tie accepts');
  assert.equal(sheet(s, 'P1', 'thing').why, 'rejected'); assert.equal(sheet(s, 'P1', 'thing').pts, 0);
}
// ---- the vote never stalls: silence accepts when the time is up; a majority rejects ----
{
  const s = game(4, 's');
  fill(s, 'P0', { name: 'Sooraj', place: 'Snorpville', animal: 'Snake', thing: 'Spoon' });
  doneAll(s);
  assert.equal(s.phase, 'vote');
  const iTown = s.vote.items.findIndex((it) => it.text === 'Snorpville');
  npat.act(s, 'P1', { type: 'vote', item: iTown, ok: false });
  npat.act(s, 'P2', { type: 'vote', item: iTown, ok: false });
  npat.act(s, 'P3', { type: 'vote', item: iTown, ok: true });
  const early = clone(s); npat.act(early, 'P1', { type: 'clock' }); assert.equal(early.phase, 'vote', 'an early clock changes nothing');
  s.vote.until = Date.now() - 1;
  npat.act(s, 'P1', { type: 'clock' });
  assert.equal(s.phase, 'results');
  assert.equal(sheet(s, 'P0', 'place').why, 'rejected', '2 against 1 rejects');
  assert.equal(sheet(s, 'P0', 'name').why, 'voted', 'nobody voted on Sooraj: silence accepts');
}
// ---- a new word everyone wrote has nobody left to vote: it's accepted (and shared) ----
{
  const s = game(2, 't');
  fill(s, 'P0', { thing: 'Tiffin carrier' }); fill(s, 'P1', { thing: 'tiffin-carrier' });
  doneAll(s);
  assert.equal(s.phase, 'results');
  assert.equal(sheet(s, 'P0', 'thing').pts, 5);
}
// ---- results, next round, the end ----
{
  const s = game(2, 'p', { rounds: '5' });
  doneAll(s);
  assert.equal(s.phase, 'results');
  assert.deepEqual(npat.turnOf(s).sort(), ['P0', 'P1']);
  npat.act(s, 'P0', { type: 'ready' });
  assert.equal(s.phase, 'results');
  npat.act(s, 'P1', { type: 'ready' });
  assert.equal(s.phase, 'play'); assert.equal(s.round, 2); assert.equal(s.letter, s.letters[1]);
  doneAll(s);
  s.resultsUntil = Date.now() - 1;
  npat.act(s, 'P0', { type: 'clock' });
  assert.equal(s.round, 3, 'the score sheet moves on by itself');
  for (let r = 3; r <= 5; r++) {
    if (r === 5) fill(s, 'P1', { name: s.letter.toUpperCase() + 'xyzzy' });
    doneAll(s);
    if (s.phase === 'vote') { s.vote.until = Date.now() - 1; npat.act(s, 'P0', { type: 'clock' }); }
    if (!s.over) { npat.act(s, 'P0', { type: 'ready' }); npat.act(s, 'P1', { type: 'ready' }); }
  }
  assert.equal(s.over, true); assert.equal(s.phase, 'over');
  const top = Math.max(...s.players.map((p) => p.score));
  assert.deepEqual(s.winners, s.players.filter((p) => p.score === top).map((p) => p.id), 'most points wins; ties share');
  assert.deepEqual(npat.turnOf(s), []);
  assert.throws(() => npat.act(s, 'P0', { type: 'clock' }), /over/);
}
// ---- timeouts are gentle and always legal ----
{
  const s = game(3, 'm');
  fill(s, 'P0', { name: 'Mohan' });
  let a = npat.timeoutMove(clone(npat.view(s, 'P0')), 'P0');
  assert.equal(a.type, 'done'); npat.act(s, 'P0', a);
  assert.equal(s.cur.P0.name, 'Mohan', 'what you wrote is handed in');
  fill(s, 'P1', { name: 'Mxyz' }); fill(s, 'P2', { place: 'Mploo' });
  npat.act(s, 'P1', { type: 'done' }); npat.act(s, 'P2', { type: 'done' });
  assert.equal(s.phase, 'vote');
  for (let guard = 0; s.phase === 'vote' && guard < 10; guard++) {
    const pid = npat.turnOf(s)[0];
    a = npat.timeoutMove(clone(npat.view(s, pid)), pid);
    assert.equal(a.type, 'vote'); assert.equal(a.ok, true, 'a missed vote is a thumbs up');
    npat.act(s, pid, a);
  }
  assert.equal(s.phase, 'results');
  a = npat.timeoutMove(clone(npat.view(s, 'P0')), 'P0'); assert.equal(a.type, 'ready');
}
// ---- computers: legal moves, sensible votes, and Hard plays clearly better than Easy ----
{
  const s = game(3, 'r');
  fill(s, 'P0', { name: 'Rohan', place: 'Rajgir', animal: 'Rhinos', thing: 'Rqwxz' });
  npat.act(s, 'P0', { type: 'done' });
  for (const pid of ['P1', 'P2']) npat.act(s, pid, npat.bot(clone(npat.view(s, pid)), pid));
  assert.equal(s.phase, 'vote');
  for (let guard = 0; s.phase === 'vote' && guard < 20; guard++) { const pid = npat.turnOf(s)[0]; npat.act(s, pid, npat.bot(clone(npat.view(s, pid)), pid)); }
  assert.equal(sheet(s, 'P0', 'place').why, 'voted', 'a word-shaped place gets the computers’ thumbs up');
  assert.equal(sheet(s, 'P0', 'thing').why, 'rejected', 'keyboard mash is voted out');
  // Easy leaves more blanks than Hard
  const blanks = { easy: 0, hard: 0 };
  for (const level of ['easy', 'hard']) for (let r = 0; r < 60; r++) {
    const g = npat.setup(players(2), { level });
    const a = npat.bot(clone(npat.view(g, 'P0')), 'P0');
    blanks[level] += 4 - Object.values(a.answers || {}).filter(Boolean).length;
  }
  assert.ok(blanks.easy > 60 && blanks.hard === 0, `Easy leaves blanks (${blanks.easy}), Hard fills all four (${blanks.hard})`);
}
{
  let hard = 0, easy = 0, draws = 0;
  for (let r = 0; r < 100; r++) {
    Math.random = seededRandom(`npat-levels:${r}`);
    const hardSeat = r % 2 ? 'P0' : 'P1';
    let s = npat.setup(players(2), { level: 'normal' });
    for (let steps = 0; !s.over && steps < 5000; steps++) {
      const due = npat.turnOf(s), pid = due[Math.floor(Math.random() * due.length)];
      const v = { ...clone(npat.view(s, pid)), level: pid === hardSeat ? 'hard' : 'easy' };
      const next = clone(s); npat.act(next, pid, npat.bot(v, pid)); s = next;
    }
    assert.ok(s.over, 'every game finishes');
    if (s.winners.length !== 1) draws++; else if (s.winners[0] === hardSeat) hard++; else easy++;
  }
  const rate = hard / Math.max(1, hard + easy);
  console.log(`  Hard vs Easy over 100 games: Hard ${hard}, Easy ${easy}, shared ${draws} (Hard wins ${(rate * 100).toFixed(0)}% of decided games)`);
  assert.ok(rate >= 0.62, 'Hard wins at least 62% of decided games');
}

console.log('npat-test: all checks passed');
