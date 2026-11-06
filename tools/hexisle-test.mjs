// Scenario tests for games/hexisle.js (Isle of Hexes).  node tools/hexisle-test.mjs
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const g = (await import(pathToFileURL(path.resolve('games', 'hexisle.js')).href)).default;

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL:', msg); } else console.log('ok  ', msg); };
const clone = (x) => JSON.parse(JSON.stringify(x));
const P = (n) => Array.from({ length: n }, (_, i) => ({ id: 'P' + i, name: 'N' + i }));
const RES = ['lumber', 'brick', 'wool', 'grain', 'ore'];
const hand = (m = {}) => Object.fromEntries(RES.map((r) => [r, m[r] || 0]));
const err = (fn) => { try { fn(); return ''; } catch (e) { return e.message; } };
const botAt = (s, pid, level) => g.bot({ ...clone(g.view(s, pid)), level }, pid);
// Plays the snake setup with Normal bots; returns the state on the first roll and who placed each settlement.
function throughSetup(n) {
  const s = g.setup(P(n));
  const settlers = [];
  while (s.phase === 'setup') {
    const pid = g.turnOf(s)[0];
    const a = botAt(s, pid, 'normal');
    if (a.type === 'settle') settlers.push(pid);
    g.act(s, pid, a);
  }
  return { s, settlers };
}
// The current player's main phase, with a chosen hand for everyone.
function mainPhase(n, hands = []) {
  const { s } = throughSetup(n);
  s.phase = 'main';
  s.order.forEach((p, i) => (s.ps[p].res = hand(hands[i])));
  return s;
}

// 1. Random first player, rematches included; snake setup from any start.
{
  const firsts = new Set();
  for (let i = 0; i < 200; i++) {
    const s = g.setup(P(3));
    firsts.add(s.order[0]);
    const rot = s.order.indexOf('P0');
    if (s.order.join() !== ['P0', 'P1', 'P2'].map((_, k) => 'P' + ((k + 3 - rot) % 3)).join() || s.cur !== 0) { ok(false, `order is a rotation of the seats: ${s.order}`); break; }
    if (!s.log[0].includes(s.ps[s.order[0]].name + ' places the first settlement')) { ok(false, 'welcome log names the first player'); break; }
    if (!['P0', 'P1', 'P2'].every((p, k) => s.ps[p].seat === k)) { ok(false, 'seats (colours) stay as in the lobby'); break; }
  }
  ok(firsts.size === 3, `every seat can go first over 200 setups (${[...firsts].sort()})`);
  for (const n of [2, 3, 4]) for (let k = 0; k < 6; k++) {
    const { s, settlers } = throughSetup(n);
    const want = [...s.order, ...s.order.slice().reverse()];
    if (settlers.join() !== want.join() || g.turnOf(s)[0] !== s.order[0] || s.phase !== 'roll') { ok(false, `${n}p snake setup from ${s.order[0]}: ${settlers}`); break; }
    if (k === 5) ok(true, `${n}p snake setup runs 1→last→1 from a random start, then the first player rolls`);
  }
}

// 2. Trade offers to players are capped per turn; the count resets next turn; old saves without the counter load.
{
  const s = mainPhase(3, [{ lumber: 2, brick: 2 }, { ore: 3 }, { wool: 2 }]);
  const me = s.order[0];
  const offer = { type: 'offer', give: hand({ lumber: 1 }), want: hand({ ore: 1 }) };
  for (let i = 0; i < 3; i++) { g.act(s, me, offer); g.act(s, me, { type: 'cancel' }); }
  const msg = err(() => g.act(s, me, offer));
  ok(/3 trade offers/.test(msg) && !s.trade, `the 4th offer in a turn is refused kindly: "${msg}"`);
  g.act(s, me, { type: 'end' });
  const next = s.order[1];
  s.phase = 'main';
  ok(!err(() => g.act(s, next, { type: 'offer', give: hand({ ore: 1 }), want: hand({ wool: 1 }) })) && s.trade, 'the next player can offer again');
  const old = mainPhase(2, [{ lumber: 2 }, { ore: 2 }]);
  delete old.offers;
  ok(!err(() => g.act(old, old.order[0], { type: 'offer', give: hand({ lumber: 1 }), want: hand({ ore: 1 }) })) && old.offers === 1, 'a saved game without the offer counter still trades');
}

// 3. Easy computer judges offers: declines lopsided ones, takes one that finishes a build.
{
  const replies = (giveH, wantH, easyHand) => {
    const out = [];
    for (let i = 0; i < 60; i++) {
      const s = mainPhase(2, [{ lumber: 3, brick: 3, wool: 3, grain: 3, ore: 3 }, easyHand]);
      g.act(s, s.order[0], { type: 'offer', give: hand(giveH), want: hand(wantH) });
      const a = botAt(s, s.order[1], 'easy');
      g.act(s, s.order[1], a);
      out.push(a.yes);
    }
    return out;
  };
  ok(replies({ lumber: 1 }, { ore: 3 }, { ore: 3 }).every((y) => !y), 'Easy never gives 3 cards for 1');
  ok(replies({ lumber: 1 }, { ore: 2 }, { ore: 3, wool: 1 }).every((y) => !y), 'Easy never gives 2 for 1 when it finishes nothing');
  const fair = replies({ lumber: 1 }, { ore: 1 }, { ore: 3 });
  ok(fair.some((y) => y) && fair.some((y) => !y), 'Easy sometimes accepts a fair 1-for-1');
  ok(replies({ grain: 1 }, { ore: 2 }, { lumber: 1, brick: 1, wool: 1, ore: 2 }).every((y) => y), 'Easy pays 2 for the 1 card that completes a settlement');
}

// 4. Easy never ends its turn while it can build, and sometimes uses the bank.
{
  let ends = 0, banks = 0, illegal = 0;
  for (let i = 0; i < 60; i++) {
    const s = mainPhase(2, [{ lumber: 1, brick: 1 }]);
    const a = botAt(s, s.order[0], 'easy');
    if (a.type === 'end') ends++;
    const b = mainPhase(2, [{ ore: 6 }]);
    const c = botAt(b, b.order[0], 'easy');
    if (c.type === 'bank') banks++;
    if (err(() => g.act(b, b.order[0], c))) illegal++;
  }
  ok(ends === 0, `Easy builds instead of ending its turn when it can afford a road (${ends} ends)`);
  ok(banks > 5 && banks < 60 && !illegal, `Easy sometimes trades with the bank (${banks}/60), always legally`);
}

// 5. Original names: rules, cover and played games use the island's own terms.
{
  const OLD = /\b(lumber|brick|wool|grain|ore|forest|hills|pasture|fields|mountains?|robber|knights?|road building|year of plenty|monopoly|longest road|largest army)\b/i;
  const rules = JSON.stringify([g.name, g.description, g.howTo, g.options]);
  ok(!OLD.test(rules), `rules and description use none of the old terms${OLD.test(rules) ? ': ' + rules.match(OLD)[0] : ''}`);
  const label = (g.cover.match(/aria-label="([^"]*)"/) || [])[1] || '';
  ok(label && !OLD.test(label), 'cover description uses the new terms');
  for (const w of ['timber', 'clay', 'fleece', 'harvest', 'iron', 'bandit', 'Ranger', 'Road Crew', 'Bountiful Season', 'Market Corner', 'Grand Highway', 'Strongest Guard']) ok(rules.includes(w), `rules mention ${w}`);
  const logs = [];
  for (let r = 0; r < 12; r++) {
    const s = g.setup(P(2 + (r % 3)), { level: ['easy', 'normal', 'hard'][r % 3] });
    for (let k = 0; !s.over && k < 20000; k++) { const due = g.turnOf(s), pid = due[k % due.length]; g.act(s, pid, botAt(s, pid, s.level)); }
    logs.push(...s.log);
  }
  const bad = logs.filter((l) => OLD.test(l));
  ok(!bad.length, `12 played games log none of the old terms${bad.length ? ': ' + bad[0] : ''}`);
  ok(logs.some((l) => /bandit/.test(l)) && logs.some((l) => /timber|clay|fleece|harvest|iron/.test(l)), 'played games log the bandit and the new resources');
  const s = mainPhase(2);
  s.phase = 'robber';
  ok(/bandit/.test(err(() => g.act(s, s.order[0], { type: 'robber', h: s.robber }))), 'errors name the bandit');
}

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
