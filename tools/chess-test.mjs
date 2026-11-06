// Chess rules checks: node tools/chess-test.mjs
// Perft counts from well-known positions, then scripted games through act().
import assert from 'node:assert/strict';
import chess, { rules } from '../games/chess.js';
const { fromFEN, fen, perft, legal, play, san } = rules;

const P = (f) => fromFEN(f);
const start = P('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
assert.equal(fen(start), 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
for (const [f, counts] of [
  ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', [20, 400, 8902]],
  ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]], // castling, pins, en passant
  ['8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812]],
  ['rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]], // promotions
]) counts.forEach((n, d) => assert.equal(perft(P(f), d + 1), n, `perft ${d + 1} of ${f}`));
console.log('Chess perft counts match for 4 reference positions.');

const sanOf = (f, from, to, promo) => { const p = P(f), ms = legal(p); return san(p, ms.find((m) => m.from === from && m.to === to && (m.promo || null) === (promo || null)), ms); };
const sq = (n) => (8 - Number(n[1])) * 8 + 'abcdefgh'.indexOf(n[0]);
assert.equal(sanOf('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', sq('e1'), sq('g1')), 'O-O');
assert.equal(sanOf('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', sq('e5'), sq('d6')), 'exd6');
assert.equal(sanOf('k7/8/8/8/8/8/4K3/R6R w - - 0 1', sq('a1'), sq('d1')), 'Rad1');
assert.equal(sanOf('7k/P7/8/8/8/8/8/K7 w - - 0 1', sq('a7'), sq('a8'), 'q'), 'a8=Q+');

// Scripted games through act().
const game = () => { const s = chess.setup([{ id: 'A', name: 'Ana' }, { id: 'B', name: 'Ben' }]); s.players[0].color = 'w'; s.players[1].color = 'b'; return s; };
const mv = (s, pid, a, b, promo) => chess.act(s, pid, { type: 'move', from: sq(a), to: sq(b), promo });
{
  const s = game();
  assert.throws(() => mv(s, 'B', 'e7', 'e5'), /not your move/);
  assert.throws(() => mv(s, 'A', 'e2', 'e5'), /not legal/);
  mv(s, 'A', 'f2', 'f3'); mv(s, 'B', 'e7', 'e5'); mv(s, 'A', 'g2', 'g4'); mv(s, 'B', 'd8', 'h4');
  assert.equal(s.over, true); assert.deepEqual(s.winners, ['B']); assert.equal(s.result, '0-1');
  assert.deepEqual(s.sans, ['f3', 'e5', 'g4', 'Qh4#']);
  assert.deepEqual(chess.turnOf(s), []);
}
{
  const s = game();
  chess.act(s, 'A', { type: 'offer' });
  assert.throws(() => chess.act(s, 'A', { type: 'accept' }), /no draw offer/);
  mv(s, 'A', 'e2', 'e4');
  chess.act(s, 'B', { type: 'accept' });
  assert.equal(s.over, true); assert.deepEqual(s.winners, []); assert.equal(s.result, '½-½');
}
{
  const s = game();
  chess.act(s, 'B', { type: 'offer' }); mv(s, 'A', 'e2', 'e4');
  assert.equal(s.drawOffer, null, 'playing on declines the offer');
  chess.act(s, 'B', { type: 'resign' }); assert.deepEqual(s.winners, ['A']);
}
{
  // Promotion needs a choice, stalemate ends in a draw, and pieces keep their identities.
  const s = game(); Object.assign(s, fromFEN('7k/P7/8/8/8/8/8/K7 w - - 0 1'));
  assert.throws(() => mv(s, 'A', 'a7', 'a8'), /promote/);
  const id = s.ids[sq('a7')];
  mv(s, 'A', 'a7', 'a8', 'q'); assert.equal(s.board[sq('a8')], 'Q'); assert.equal(s.ids[sq('a8')], id);
  const t = game(); Object.assign(t, fromFEN('k7/8/1Q6/8/8/8/8/7K w - - 0 1'));
  mv(t, 'A', 'b6', 'c7'); assert.equal(t.over, true); assert.match(t.reason, /Stalemate/);
}
{
  // En passant removes the passed pawn; castling through check is refused.
  const s = game(); Object.assign(s, fromFEN('4k3/3p4/8/4P3/8/8/8/4K3 b - - 0 1'));
  mv(s, 'B', 'd7', 'd5'); mv(s, 'A', 'e5', 'd6'); assert.equal(s.board[sq('d5')], '.'); assert.deepEqual(s.taken.w, ['p']);
  const c = fromFEN('4k3/8/8/8/8/8/5r2/R3K2R w KQ - 0 1');
  assert.ok(!legal(c).some((m) => m.flag === 'O-O'), 'cannot castle while in check');
  const d = fromFEN('4k3/8/8/8/8/8/6r1/R3K2R w KQ - 0 1');
  assert.ok(!legal(d).some((m) => m.flag === 'O-O') && legal(d).some((m) => m.flag === 'O-O-O'));
  assert.equal(play(d, legal(d).find((m) => m.flag === 'O-O-O')).board.slice(56), '..KR...R');
}
// Bots play every game to a legal end, and the state stays plain JSON.
let ends = {};
for (let r = 0; r < 30; r++) {
  let s = chess.setup([{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }]), n = 0;
  while (!s.over) { const pid = chess.turnOf(s)[0]; chess.act(s, pid, chess.bot(chess.view(s, pid), pid)); s = JSON.parse(JSON.stringify(s)); assert.ok(++n < 3000); }
  const kind = s.reason.split(/[.!:]/)[0]; ends[kind] = (ends[kind] || 0) + 1;
}
console.log('Chess scripted games passed. Bot games ended by:', JSON.stringify(ends));

// Clocks: White's starts after the first move, time is spent only on your own turn, increments
// are added, a flag fall loses (or draws against a lone king), and early flag claims change nothing.
{
  const clocked = (clock) => { const s = chess.setup([{ id: 'A', name: 'Ana' }, { id: 'B', name: 'Ben' }], { clock }); s.players[0].color = 'w'; s.players[1].color = 'b'; return s; };
  assert.equal(clocked('none').clock, null);
  assert.equal(clocked('bogus').clock.name, '10+5');
  const s = clocked('3+2');
  assert.deepEqual(s.clock.left, { w: 180000, b: 180000 });
  mv(s, 'A', 'e2', 'e4');
  assert.equal(s.clock.left.w, 180000, 'no time spent before the first move');
  s.clock.since -= 5000; mv(s, 'B', 'e7', 'e5');
  assert.ok(Math.abs(s.clock.left.b - 177000) < 100, 'Black spent ~5 s and gained 2 s');
  const before = JSON.stringify(s);
  chess.act(s, 'B', { type: 'flag' });
  assert.equal(JSON.stringify(s), before, 'an early flag claim changes nothing');
  s.clock.since -= 181000 + 2000;
  chess.act(s, 'B', { type: 'flag' });
  assert.equal(s.over, true); assert.deepEqual(s.winners, ['B']); assert.match(s.reason, /ran out of time/); assert.equal(s.clock.left.w, 0);
  const late = clocked('1+0'); mv(late, 'A', 'e2', 'e4'); late.clock.since -= 61000;
  mv(late, 'B', 'e7', 'e5'); assert.deepEqual(late.winners, ['A'], 'a move after the flag falls loses on time'); assert.deepEqual(late.sans, ['e4']);
  const bare = clocked('1+0'); Object.assign(bare, fromFEN('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1')); bare.clock.since = Date.now() - 61000;
  chess.act(bare, 'A', { type: 'flag' }); assert.equal(bare.result, '½-½', 'a lone king cannot win on time');
  assert.ok(typeof chess.view(s, 'A').hostNow === 'number' && chess.view(clocked('none'), 'A').hostNow === undefined);
}
console.log('Chess clock checks passed.');

// A timeout asks whether mate is possible, including help from the flagging side's pieces.
// First demonstrate an actual legal mate by a lone bishop using the opponent's pawn as a blocker.
{
  const initial = fromFEN('8/7p/8/8/8/B7/p1K5/k7 b - - 0 1');
  const h6 = legal(initial).find(m => san(initial, m) === 'h6'); assert.ok(h6);
  const next = play(initial, h6), mate = legal(next).find(m => san(next, m) === 'Bb2#'); assert.ok(mate);
  const end = play(next, mate); assert.ok(rules.inCheck(end)); assert.equal(legal(end).length, 0);
}
for (const [fenText, draw, why] of [
  ['8/7p/8/8/8/B7/p1K5/k7 b - - 0 1', false, 'bishop can mate using opponent pawns'],
  ['4k3/8/8/8/8/8/8/4KB2 b - - 0 1', true, 'lone bishop against bare king'],
  ['4k3/p7/8/8/8/8/8/4K1N1 b - - 0 1', false, 'knight can mate using an opponent pawn'],
  ['4k3/8/8/8/8/8/8/4K1N1 b - - 0 1', true, 'lone knight against bare king'],
  ['4k2q/8/8/8/8/8/8/4K1N1 b - - 0 1', true, 'an enemy queen cannot help a lone knight mate'],
  ['4k3/8/8/8/8/8/8/4KNN1 b - - 0 1', false, 'two knights can mate although they cannot force it'],
  ['2b1k3/8/8/8/8/8/8/4KB2 b - - 0 1', true, 'only bishops on the same square color'],
  ['2b1k3/8/8/8/8/8/8/2B1K3 b - - 0 1', false, 'opposite bishops can help create mate'],
  ['4k3/8/8/8/8/8/8/2B1KB2 b - - 0 1', false, 'opposite bishops can mate a bare king'],
  ['4k3/8/8/8/8/8/6B1/4KB2 b - - 0 1', true, 'multiple promoted bishops on one square color'],
  ['4k2r/8/8/8/8/8/8/4KB2 b - - 0 1', true, 'an enemy rook cannot help a lone bishop mate'],
]) {
  // Test the same material rule for either prospective winner, via both timeout entry paths.
  for (const mirror of [false, true]) {
    const position = fromFEN(fenText);
    if (mirror) { position.board = [...position.board].map(p => p === '.' ? p : p === p.toLowerCase() ? p.toUpperCase() : p.toLowerCase()).join(''); position.turn = 'w'; }
    for (const lateMove of [false, true]) {
      const s = game(); Object.assign(s, position); s.clock.left = { w: 1, b: 1 }; s.clock.since = Date.now() - 100;
      const loser = s.players.find(p => p.color === s.turn), winner = s.players.find(p => p !== loser);
      const m = legal(position)[0]; assert.ok(m, 'fixture has a legal move');
      chess.act(s, loser.id, lateMove ? { type: 'move', from: m.from, to: m.to, promo: m.promo } : { type: 'flag' });
      assert.equal(s.result === '½-½', draw, why); assert.deepEqual(s.winners, draw ? [] : [winner.id], why);
    }
  }
}
console.log('Chess timeout material regressions passed (bishop blockers, knights, both colors and timeout paths).');

// Stockfish levels: a pending draw offer from the human must not drop the computer to Easy, and
// an engine that fails to load says so once in the log. A fresh copy of chess.js is loaded with a
// stand-in browser and Worker, which answers every search with a2a3 (a move Easy never prefers).
{
  const posted = [];
  let worker = null;
  globalThis.document = {}; globalThis.localStorage = { getItem: () => null }; globalThis.addEventListener = () => {};
  globalThis.Worker = class {
    constructor() { worker = this; }
    postMessage(m) { posted.push(m); if (m.startsWith('go')) this.onmessage({ data: 'bestmove a2a3' }); }
  };
  const realInterval = globalThis.setInterval; globalThis.setInterval = () => 0;
  const { default: sf } = await import('../games/chess.js?engine');
  globalThis.setInterval = realInterval;
  const vsBot = (level) => { const s = sf.setup([{ id: 'A', name: 'Ana' }, { id: 'B', name: 'Bot' }], { level }); s.players[0].color = 'b'; s.players[1].color = 'w'; return s; };
  for (const level of ['club', 'strong', 'master']) {
    const s = vsBot(level);
    sf.act(s, 'A', { type: 'offer' });
    posted.length = 0;
    assert.deepEqual(sf.bot(sf.view(s, 'B'), 'B'), { type: 'wait' }, `${level}: the engine is asked despite the draw offer`);
    assert.ok(posted.some((m) => m.startsWith('go')), `${level}: a search was started`);
    const a = sf.bot(sf.view(s, 'B'), 'B');
    assert.deepEqual([a.from, a.to], [sq('a2'), sq('a3')], `${level}: the engine's move is played, not Easy's`);
    sf.act(s, 'B', a); assert.equal(s.drawOffer, null);
  }
  // Clearly behind, the computer still accepts the offer.
  const behind = vsBot('master'); Object.assign(behind, fromFEN('q3k3/8/8/8/8/8/8/4K3 w - - 0 1'));
  sf.act(behind, 'A', { type: 'offer' });
  assert.deepEqual(sf.bot(sf.view(behind, 'B'), 'B'), { type: 'accept' });
  // When the engine fails, Easy plays and the log explains it once.
  worker.onerror();
  const s = vsBot('club'), note = /couldn't load, so the computer is playing at Easy/;
  sf.act(s, 'B', sf.bot(sf.view(s, 'B'), 'B')); sf.act(s, 'A', sf.bot(sf.view(s, 'A'), 'A')); sf.act(s, 'B', sf.bot(sf.view(s, 'B'), 'B'));
  assert.equal(s.log.filter((l) => note.test(l)).length, 1, 'one engine notice');
  delete globalThis.document; delete globalThis.localStorage; delete globalThis.addEventListener; delete globalThis.Worker;
}
console.log('Chess engine checks passed (draw offers keep the chosen level; a missing engine is logged once).');

