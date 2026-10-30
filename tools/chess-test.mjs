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
