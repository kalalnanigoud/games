// Rule edge-case checks for games/gems.js:  node tools/gems-check.mjs
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const G = (await import(pathToFileURL(path.resolve('games', 'gems.js')).href)).default;
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } };
const throws = (fn, msg) => { try { fn(); fails++; console.log('FAIL (no throw)', msg); } catch {} };
const clone = (x) => JSON.parse(JSON.stringify(x));
const P = (n) => Array.from({ length: n }, (_, i) => ({ id: 'P' + i, name: 'N' + i }));

// Setup counts
for (const [n, per] of [[2, 4], [3, 5], [4, 7]]) {
  const s = G.setup(P(n));
  ok(s.bank.red === per && s.bank.gold === 5, `bank ${n}p`);
  ok(s.nobles.length === n + 1, `nobles ${n}p`);
  ok([1, 2, 3].every((t) => s.market[t].length === 4), 'market 4 per tier');
  ok(s.decks[1].length === 36 && s.decks[2].length === 26 && s.decks[3].length === 16, 'deck sizes');
  ok(new Set([...s.decks[1], ...s.decks[2], ...s.decks[3], ...s.market[1], ...s.market[2], ...s.market[3]].map((c) => c.id)).size === 90, '90 unique ids');
}
// Turn validation & take rules
let s = G.setup(P(2));
throws(() => G.act(clone(s), 'P1', { type: 'take', gems: ['red', 'blue', 'green'] }), 'out of turn');
throws(() => G.act(clone(s), 'P0', { type: 'take', gems: ['gold'] }), 'take gold');
throws(() => G.act(clone(s), 'P0', { type: 'take', gems: ['red', 'blue'] }), 'take 2 different when 5 colours available');
throws(() => G.act(clone(s), 'P0', { type: 'take', gems: ['red', 'red', 'blue'] }), 'dup within 3');
throws(() => G.act(clone(s), 'P0', { type: 'take', gems: ['red', 'blue', 'green', 'white'] }), 'take 4');
throws(() => G.act(clone(s), 'P0', { type: 'buy', id: s.market[3][0].id }), 'buy unaffordable');
throws(() => G.act(clone(s), 'P0', { type: 'pass' }), 'pass with legal moves');
{ const t = clone(s); t.bank.red = 3; throws(() => G.act(t, 'P0', { type: 'take', gems: ['red', 'red'] }), '2 same with <4'); }
{ const t = clone(s); G.act(t, 'P0', { type: 'take', gems: ['red', 'red'] }); ok(t.players[0].gems.red === 2 && t.bank.red === 2 && t.cur === 1, 'take 2 same'); }
{ const t = clone(s); for (const c of ['white', 'blue', 'green']) t.bank[c] = 0; G.act(t, 'P0', { type: 'take', gems: ['red', 'black'] }); ok(t.players[0].gems.black === 1, 'fewer when fewer colours'); }
// Reserve: gold, max 3, blind hidden in view, deck order hidden
{
  const t = clone(s);
  G.act(t, 'P0', { type: 'reserve', tier: 2, deck: true });
  ok(t.players[0].gems.gold === 1 && t.bank.gold === 4 && t.players[0].reserved.length === 1, 'reserve gives gold');
  const v1 = G.view(t, 'P1'), v0 = G.view(t, 'P0');
  ok(v1.players[0].reserved[0].hidden && v1.players[0].reserved[0].cost === undefined, 'blind reserve hidden from others');
  ok(!v0.players[0].reserved[0].hidden && v0.players[0].reserved[0].cost, 'owner sees blind reserve');
  ok(typeof v1.decks[1] === 'number' && !JSON.stringify(v1).includes('"decks":{"1":['), 'deck order hidden');
  t.cur = 0; t.players[0].reserved.push(t.decks[1].pop(), t.decks[1].pop());
  throws(() => G.act(t, 'P0', { type: 'reserve', tier: 1, slot: 0 }), '4th reserve');
}
// Buy with gold, discard phase, nobles
{
  const t = clone(s); const p = t.players[0]; const card = t.market[1][0];
  for (const [c, n] of Object.entries(card.cost)) p.gems[c] = n; const first = Object.keys(card.cost)[0]; p.gems[first] -= 1; p.gems.gold = 1;
  const before = { ...t.bank };
  G.act(t, 'P0', { type: 'buy', id: card.id });
  ok(p.cards.length === 1 && p.bonus[card.c] === 1 && p.gems.gold === 0 && t.bank.gold === before.gold + 1, 'buy with gold');
  ok(t.market[1][0] && t.market[1][0].id !== card.id && t.decks[1].length === 35, 'market refilled');
}
{
  const t = clone(s); const p = t.players[0]; Object.assign(p.gems, { white: 3, blue: 3, green: 2, red: 0, black: 0 });
  G.act(t, 'P0', { type: 'take', gems: ['red', 'black', 'white'] });
  ok(t.phase === 'discard' && t.cur === 0 && G.turnOf(t)[0] === 'P0', 'discard phase');
  throws(() => G.act(clone(t), 'P0', { type: 'discard', gems: { white: 2 } }), 'wrong discard count');
  throws(() => G.act(clone(t), 'P0', { type: 'take', gems: ['red'] }), 'take during discard');
  G.act(t, 'P0', { type: 'discard', gems: { white: 1 } });
  ok(t.phase === 'play', 'discard returns to play phase');
  ok(t.bank.white === s.bank.white && p.gems.white === 3, 'discard returns one white gem to bank');
  ok(t.cur === 1, 'turn passes after discard');
}
{
  const t = clone(s); const p = t.players[0];
  for (const nb of t.nobles.slice(0, 2)) for (const [c, n] of Object.entries(nb.req)) p.bonus[c] = Math.max(p.bonus[c], n);
  const el = t.nobles.filter((nb) => Object.entries(nb.req).every(([c, n]) => p.bonus[c] >= n)).length;
  G.act(t, 'P0', { type: 'take', gems: ['red', 'blue', 'green'] });
  if (el >= 2) { ok(t.phase === 'noble' && t.nobleChoices.length === el, 'noble choice'); G.act(t, 'P0', { type: 'noble', id: t.nobleChoices[1] }); }
  ok(p.nobles.length === 1 && p.points === 3 && t.cur === 1, 'one noble visits, +3');
}
// End: equal turns and tie-break
{
  const t = clone(G.setup(P(3))); t.cur = 1; t.players[1].points = 15;
  G.act(t, 'P1', { type: 'take', gems: ['red', 'blue', 'green'] });
  ok(t.finalRound && !t.over && t.cur === 2, 'final round continues');
  t.players[2].points = 15; t.players[2].cards = [{}, {}];  t.players[1].cards = [{}, {}, {}];
  G.act(t, 'P2', { type: 'take', gems: ['red', 'blue', 'green'] });
  ok(t.over && t.winners.length === 1 && t.winners[0] === 'P2', 'ends when round completes; tie -> fewer cards');
  ok(G.turnOf(t).length === 0, 'turnOf empty when over');
}
// Pass when stuck
{
  const t = clone(s); for (const c of ['white', 'blue', 'green', 'red', 'black']) t.bank[c] = 0; t.players[0].reserved = [t.decks[1].pop(), t.decks[1].pop(), t.decks[1].pop()];
  G.act(t, 'P0', { type: 'pass' }); ok(t.cur === 1, 'pass when no legal move');
  ok(G.bot(G.view(t, 'P1'), 'P1') !== null, 'bot returns action when stuck-ish');
}
console.log(fails ? `${fails} failure(s)` : 'all checks passed');
process.exit(fails ? 1 : 0);
