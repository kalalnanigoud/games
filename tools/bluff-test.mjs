// Scenario tests for games/bluff.js edge cases.  node tools/bluff-test.mjs
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const g = (await import(pathToFileURL(path.resolve('games', 'bluff.js')).href)).default;

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL:', msg); } else console.log('ok  ', msg); };
const throws = (fn, msg) => { try { fn(); fails++; console.log('FAIL (no throw):', msg); } catch { console.log('ok  ', msg); } };

function game(n, hands, coins = 2) {
  const s = g.setup(Array.from({ length: n }, (_, i) => ({ id: 'P' + i, name: 'N' + i })));
  // rig hands, rebuild deck so the 15-card total holds
  const all = ['chancellor', 'shadow', 'corsair', 'envoy', 'duchess'].flatMap((r) => [r, r, r]);
  s.players.forEach((p, i) => { p.coins = coins; p.cards = hands[i].map((r, j) => ({ k: `h${i}${j}`, role: r, up: false })); });
  for (const p of s.players) for (const c of p.cards) all.splice(all.indexOf(c.role), 1);
  s.deck = all;
  s.turn = 0; s.respond = ['P0']; s.phase = 'action';
  return s;
}
const total = (s) => s.deck.length + s.players.reduce((a, p) => a + p.cards.length, 0);
const hiddenN = (s, id) => s.players.find((p) => p.id === id).cards.filter((c) => !c.up).length;
const coinsOf = (s, id) => s.players.find((p) => p.id === id).coins;

// 1. Double loss: real Shadow, target bluffs Duchess, actor challenges the block.
{
  const s = game(3, [['shadow', 'envoy'], ['corsair', 'chancellor'], ['envoy', 'corsair']], 3);
  g.act(s, 'P0', { type: 'act', action: 'assassinate', target: 'P1' });
  ok(coinsOf(s, 'P0') === 0 && s.phase === 'challenge', 'assassinate pays 3 up front, opens challenge window');
  ok(JSON.stringify(g.turnOf(s).sort()) === '["P1","P2"]', 'challenge window lists all other living players');
  g.act(s, 'P1', { type: 'allow' });
  ok(s.phase === 'challenge' && s.allowed.includes('P1'), 'window waits for everyone');
  g.act(s, 'P2', { type: 'allow' });
  ok(s.phase === 'block' && JSON.stringify(g.turnOf(s)) === '["P1"]', 'only target may block assassination');
  g.act(s, 'P1', { type: 'block', role: 'duchess' });
  ok(s.phase === 'blockChallenge' && g.turnOf(s).length === 2, 'block opens a challenge window for everyone else');
  g.act(s, 'P0', { type: 'challenge' });
  ok(s.phase === 'lose' && JSON.stringify(g.turnOf(s)) === '["P1"]', 'bluffing blocker must choose a card');
  g.act(s, 'P1', { type: 'lose', card: 'h10' });
  ok(hiddenN(s, 'P1') === 0 && s.players[1].out, 'double loss: failed Duchess bluff + assassination eliminates target');
  ok(s.phase === 'action' && s.respond[0] === 'P2', 'turn passes to next living player');
  ok(total(s) === 15, 'card count conserved');
}

// 2. Bluffed Shadow exposed -> refund.
{
  const s = game(2, [['envoy', 'corsair'], ['duchess', 'chancellor']], 3);
  g.act(s, 'P0', { type: 'act', action: 'assassinate', target: 'P1' });
  g.act(s, 'P1', { type: 'challenge' });
  ok(s.phase === 'lose' && s.respond[0] === 'P0', 'exposed assassin chooses a card to lose');
  ok(coinsOf(s, 'P0') === 3, 'assassination coins refunded when the claim fails');
  g.act(s, 'P0', { type: 'lose', card: 'h00' });
  ok(s.phase === 'action' && s.respond[0] === 'P1' && hiddenN(s, 'P1') === 2, 'action fails, target untouched');
}

// 3. Real Duchess block, actor challenges and loses; coins stay spent.
{
  const s = game(2, [['shadow', 'corsair'], ['duchess', 'chancellor']], 3);
  g.act(s, 'P0', { type: 'act', action: 'assassinate', target: 'P1' });
  g.act(s, 'P1', { type: 'allow' });
  g.act(s, 'P1', { type: 'block', role: 'duchess' });
  g.act(s, 'P0', { type: 'challenge' });
  ok(s.players[1].cards.every((c) => c.k !== 'h10') && s.players[1].cards.filter((c) => !c.up).length === 2, 'proven Duchess is replaced with a fresh card');
  ok(s.returned.includes('h10'), 'returned card key recorded for the glide');
  ok(s.phase === 'lose' && s.respond[0] === 'P0', 'challenger loses an influence');
  g.act(s, 'P0', { type: 'lose', card: 'h01' });
  ok(coinsOf(s, 'P0') === 0 && hiddenN(s, 'P1') === 2 && s.phase === 'action' && s.respond[0] === 'P1', 'block stands, coins not refunded');
  ok(total(s) === 15, 'card count conserved after proof');
}

// 4. Target challenges real Shadow, loses one, then can still block.
{
  const s = game(3, [['shadow', 'corsair'], ['duchess', 'chancellor'], ['envoy', 'envoy']], 3);
  g.act(s, 'P0', { type: 'act', action: 'assassinate', target: 'P1' });
  g.act(s, 'P1', { type: 'challenge' });
  ok(s.phase === 'lose' && s.respond[0] === 'P1', 'failed challenger loses');
  g.act(s, 'P1', { type: 'lose', card: 'h11' });
  ok(s.phase === 'block' && s.respond[0] === 'P1', 'surviving target still gets the block window');
  g.act(s, 'P1', { type: 'allow' });
  ok(s.players[1].out && s.phase === 'action', 'assassination lands; target out');
}

// 5. Foreign aid: anyone may block; allow by all resolves.
{
  const s = game(3, [['envoy', 'corsair'], ['duchess', 'chancellor'], ['envoy', 'duchess']]);
  g.act(s, 'P0', { type: 'act', action: 'aid' });
  ok(s.phase === 'block' && g.turnOf(s).length === 2, 'foreign aid: everyone else may block');
  throws(() => g.act(s, 'P1', { type: 'challenge' }), 'cannot challenge an unclaimed action');
  g.act(s, 'P1', { type: 'allow' });
  throws(() => g.act(s, 'P1', { type: 'allow' }), 'cannot respond twice');
  g.act(s, 'P2', { type: 'allow' });
  ok(coinsOf(s, 'P0') === 4 && s.phase === 'action' && s.respond[0] === 'P1', 'aid resolves once everyone allows');
  g.act(s, 'P1', { type: 'act', action: 'aid' });
  g.act(s, 'P2', { type: 'block', role: 'chancellor' });
  ok(s.phase === 'blockChallenge', 'block ends window immediately');
  g.act(s, 'P0', { type: 'allow' });
  g.act(s, 'P1', { type: 'allow' });
  ok(coinsOf(s, 'P1') === 2 && s.respond[0] === 'P2', 'unchallenged block stops aid');
}

// 6. Mandatory coup at 10+; coup cost check; plunder empty target.
{
  const s = game(3, [['envoy', 'corsair'], ['duchess', 'chancellor'], ['envoy', 'duchess']], 10);
  throws(() => g.act(s, 'P0', { type: 'act', action: 'income' }), '10+ coins forces a coup');
  g.act(s, 'P0', { type: 'act', action: 'coup', target: 'P2' });
  ok(coinsOf(s, 'P0') === 3 && s.phase === 'lose' && s.respond[0] === 'P2', 'coup costs 7, target chooses a loss');
  g.act(s, 'P2', { type: 'lose', card: 'h21' });
  s.players[1].coins = 6;
  throws(() => g.act(s, 'P1', { type: 'act', action: 'coup', target: 'P0' }), 'coup needs 7 coins');
  s.players[0].coins = 0;
  throws(() => g.act(s, 'P1', { type: 'act', action: 'plunder', target: 'P0' }), 'cannot plunder a player with no coins');
  throws(() => g.act(s, 'P1', { type: 'act', action: 'assassinate', target: 'P1' }), 'cannot target yourself');
}

// 7. Exchange, view hiding.
{
  const s = game(3, [['envoy', 'corsair'], ['duchess', 'chancellor'], ['envoy', 'duchess']]);
  g.act(s, 'P0', { type: 'act', action: 'exchange' });
  g.act(s, 'P1', { type: 'allow' });
  g.act(s, 'P2', { type: 'allow' });
  ok(s.phase === 'exchange' && s.exchange.drawn.length === 2 && total(s) === 13, 'exchange draws 2');
  const v1 = g.view(s, 'P1');
  ok(v1.exchange.drawn.every((c) => c.role === null), 'others cannot see drawn cards');
  ok(g.view(s, 'P0').exchange.drawn.every((c) => c.role), 'exchanger sees drawn cards');
  ok(v1.players[0].cards.every((c) => c.role === null) && v1.players[1].cards.every((c) => c.role), 'view hides others\' hidden cards only');
  ok(v1.deck.length === 0 && v1.deckCount === s.deck.length, 'view hides the deck');
  throws(() => g.act(s, 'P0', { type: 'exchange', keep: ['h00'] }), 'must keep exactly 2');
  throws(() => g.act(s, 'P0', { type: 'exchange', keep: ['h00', 'h00'] }), 'no duplicate keeps');
  throws(() => g.act(s, 'P0', { type: 'exchange', keep: ['h00', 'h10'] }), 'cannot keep another player\'s card');
  const d = s.exchange.drawn.map((c) => c.k);
  g.act(s, 'P0', { type: 'exchange', keep: [d[0], 'h01'] });
  ok(s.players[0].cards.map((c) => c.k).join() === `${d[0]},h01` && total(s) === 15, 'exchange keeps chosen cards, returns rest');
  ok(s.returned.length === 2 && s.phase === 'action', 'returned keys recorded, turn ends');
}

// 8. JSON-only state and bot legality across random states.
{
  let games = 0, challenges = 0, wins = 0, blocks = 0, bluffs = 0, claims = 0;
  for (let r = 0; r < 300; r++) {
    const n = 2 + (r % 5);
    let s = g.setup(Array.from({ length: n }, (_, i) => ({ id: 'P' + i, name: 'N' + i })));
    let steps = 0;
    while (!s.over && steps++ < 5000) {
      const due = g.turnOf(s);
      const pid = due[Math.floor(Math.random() * due.length)];
      const a = g.bot(JSON.parse(JSON.stringify(g.view(s, pid))), pid);
      const before = s;
      if (s.phase === 'action' && a.action && ['levy', 'assassinate', 'plunder', 'exchange'].includes(a.action)) {
        claims++;
        const role = { levy: 'chancellor', assassinate: 'shadow', plunder: 'corsair', exchange: 'envoy' }[a.action];
        if (!s.players.find((p) => p.id === pid).cards.some((c) => !c.up && c.role === role)) bluffs++;
      }
      if (a.type === 'challenge') {
        challenges++;
        const pd = s.pending;
        const isB = s.phase === 'blockChallenge';
        const cl = s.players.find((p) => p.id === (isB ? pd.blocker : pd.actor));
        if (!cl.cards.some((c) => !c.up && c.role === (isB ? pd.blockRole : pd.claim))) wins++;
      }
      if (a.type === 'block') blocks++;
      g.act(s, pid, a);
      s = JSON.parse(JSON.stringify(s));
      void before;
    }
    if (s.over) games++;
  }
  ok(games === 300, `300 random games finish (${games})`);
  console.log(`     bot stats: claims ${claims}, bluffs ${bluffs} (${Math.round((bluffs / claims) * 100)}%), challenges ${challenges}, correct ${wins} (${Math.round((wins / challenges) * 100)}%), blocks ${blocks}`);
}

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
