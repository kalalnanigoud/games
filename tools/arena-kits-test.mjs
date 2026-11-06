import assert from 'node:assert/strict';
import { World } from '../games/island-sim.js';
import { attachArena, arenaExplorer, ARENA_KITS, ARENA } from '../games/island-arena.js';
import { playerMax, typeMult, creatureMax } from '../games/island-data.js';
import { seededRandom } from './seed.mjs';
Math.random = seededRandom('arena-kits-v2');

for (const [kit, species, charm] of [['classic', 'mossip', 'leafcharm'], ['swift', 'emberkit', 'feather'], ['guardian', 'dewpaw', 'tidecharm']]) {
  const w = new World();
  const a = attachArena(w, { kit });
  w.room(Array.from({ length: 4 }, (_, i) => ({ id: 'P' + i, name: 'Player ' + i, connected: true })));
  for (let i = 0; i < 10; i++) w.step();
  for (const p of w.readyPlayers()) {
    assert.equal(p.ex.equip.charm, charm);
    assert.equal(w.maxHp(p), playerMax(5, charm));
    assert.equal(w.unsaved(p), false);
  }
  assert.equal(w.players.get('P0').ex.team[0].sp, species);
  a.spawnWave(w.readyPlayers());
  assert.equal(a.view().theme, 'Forest swarm');
  assert.ok([...a.foes].every(id => ['murk', 'nettlebug'].includes(w.ents.get(id).sp)));
  a.clearFoes(); a.spawnWave(w.readyPlayers());
  assert.equal(a.view().theme, 'Tide rush');
  assert.ok([...a.foes].every(id => ['murk', 'clackle'].includes(w.ents.get(id).sp)));
  a.clearFoes(); a.wave = 4; a.spawnWave(w.readyPlayers());
  assert.equal(a.view().theme, 'Brute assault');
  assert.ok([...a.foes].some(id => w.ents.get(id).sp === 'murkbrute'));
  a.clearFoes(); a.spawnWave(w.readyPlayers());
  assert.equal(a.view().theme, 'Crystal storm');
  assert.ok([...a.foes].every(id => ['murk', 'gemmole', 'fizzwing'].includes(w.ents.get(id).sp)));
  a.end('time'); a.again();
  assert.equal(a.kit, kit);
  assert.equal(w.players.get('P0').ex.team[0].sp, species, 'replay preserves the selected kit');
  assert.equal(a.theme, '');
}
assert.equal(arenaExplorer('Player', 0, 'constructor').equip.charm, ARENA_KITS.classic.charm, 'unknown kits fall back safely to Starter squad');
console.log('Arena kits: four-player equipment, HP, themed waves, replay and invalid-kit checks passed.');

const party = (n, kit = 'classic') => {
  const w = new World(), a = attachArena(w, { kit });
  w.room(Array.from({ length: n }, (_, i) => ({ id: 'P' + i, name: 'Player ' + i, connected: true })));
  for (let i = 0; i < 10; i++) w.step();
  return { w, a };
};
// Solo: one second wind per run. The first knockout gets you up again a few seconds later; the second ends it.
{
  const { w, a } = party(1), p = w.players.get('P0');
  const knock = () => w.hurt({ type: 'p', pid: 'P0', hp: 1 }, 1e6, 'none');
  p.iT = 0; knock();
  assert.ok(p.downT > 0);
  for (let i = 0; i < 25; i++) w.step();
  assert.equal(a.state, 'run', 'a solo knockout is not the end of the run');
  assert.ok(p.wind && p.downT <= 4, 'a second wind is on its way');
  for (let i = 0; i < 20 * 5 && p.downT > 0; i++) w.step();
  assert.ok(p.downT === 0 && Math.abs(p.hp - w.maxHp(p) * 0.6) < 1 && p.iT > 2, 'back up with part of your health, and a moment to recover');
  assert.equal(a.winds, 0);
  p.iT = 0; knock();
  for (let i = 0; i < 25; i++) w.step();
  assert.equal(a.state, 'over', 'the second knockout ends a solo run');
  assert.equal(a.result.reason, 'down');
  a.again();
  assert.equal(a.winds, 1, 'Play again brings the second wind back');
}
// A party gets no second wind: everyone down still ends it (friends revive each other instead).
{
  const { w, a } = party(2);
  for (const p of w.readyPlayers()) Object.assign(p, { downT: 20, hp: 0 });
  for (let i = 0; i < 25; i++) w.step();
  assert.equal(a.result?.reason, 'down');
}
// Extra explorers add most of a solo wave each, and the waves level up a little more.
{
  const size = (n) => { const { w, a } = party(n); a.wave = 7; a.spawnWave(w.readyPlayers()); return { count: a.foes.size, lv: Math.max(...[...a.foes].map((id) => w.ents.get(id).lv)) }; };
  const one = size(1), four = size(4);
  assert.ok(four.count >= one.count * 2.5, `four explorers face far more foes (${one.count} -> ${four.count})`);
  assert.ok(four.lv > one.lv, 'and slightly stronger ones');
}
// Kit fairness: across fifteen waves, every starter element meets foes it is good against about as often
// (Shade murklings used to make Ember the best companion in every wave).
{
  const { w, a } = party(4);
  const sum = { ember: 0, leaf: 0, tide: 0 }; let n = 0;
  for (let wave = 0; wave < 15; wave++) {
    a.clearFoes(); a.wave = wave; a.spawnWave(w.readyPlayers());
    for (const id of a.foes) { const e = w.ents.get(id); n++; for (const el of Object.keys(sum)) sum[el] += typeMult(el, e.el); }
  }
  const avg = Object.values(sum).map((v) => v / n);
  assert.ok(Math.max(...avg) - Math.min(...avg) < 0.12, `element advantage is balanced (${avg.map((v) => v.toFixed(2))})`);
  assert.ok([...w.ents.values()].some((e) => e.sp === 'murk' && e.el !== 'shade'), 'murklings come in more than one element');
}
// Every kit has an edge the others don't: Starter squad's is stronger companions, berries and more health
// back between waves.
{
  const c = arenaExplorer('A', 0, 'classic'), s = arenaExplorer('A', 0, 'swift'), g = arenaExplorer('A', 0, 'guardian');
  assert.ok(c.team[0].lv > s.team[0].lv && c.inv.sunberry > s.inv.sunberry && c.equip.charm === 'leafcharm');
  assert.equal(c.team[0].hp, creatureMax(c.team[0].sp, c.team[0].lv));
  assert.ok(ARENA_KITS.classic.mend > 0.25);
  assert.ok(playerMax(ARENA.level, g.equip.charm) > playerMax(ARENA.level, s.equip.charm) && s.equip.charm === 'feather');
  const { w, a } = party(1, 'classic'), p = w.players.get('P0');
  p.hp = 10; a.spawnWave(w.readyPlayers());
  assert.equal(Math.round(p.hp), Math.round(10 + w.maxHp(p) * ARENA_KITS.classic.mend), 'Starter squad mends more between waves');
}
console.log('Arena balance: solo second wind, party scaling, mixed murkling elements, a distinct edge for every kit.');
