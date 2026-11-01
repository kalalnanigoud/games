import assert from 'node:assert/strict';
import { World } from '../games/island-sim.js';
import { attachArena, arenaExplorer } from '../games/island-arena.js';
import { playerMax } from '../games/island-data.js';

for (const [kit, species, charm] of [['classic', 'mossip', null], ['swift', 'emberkit', 'feather'], ['guardian', 'dewpaw', 'tidecharm']]) {
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
assert.equal(arenaExplorer('Player', 0, 'constructor').equip.charm, null, 'unknown kits fall back safely');
console.log('Arena kits: four-player equipment, HP, themed waves, replay and invalid-kit checks passed.');
