import assert from 'node:assert/strict';
import { World } from '../games/island-sim.js';
import { SPECIES } from '../games/island-data.js';

const w = new World();
const a = w.creature('mossip', 2, 500, 500);
const b = w.creature('mossip', 2, 620, 500);
const walks = [];
w.moveEnt = (e, angle) => walks.push([e.id, angle]);
a.t = 0; w.stepCreature(a);
assert.equal(a.wAng, 0, 'calm wildlife wanders toward its own kind');
b.x = 520; a.t = 0; w.stepCreature(a);
assert.equal(Math.abs(a.wAng), Math.PI, 'nearby creatures leave space between sprites');
b.x = 550; a.t = 0; w.stepCreature(a);
assert.equal(a.wAng, null, 'creatures pause together at a comfortable distance');

w.room([{ id: 'P', name: 'Explorer', connected: true }]);
w.message('P', { k: 'cmd', c: 'new' });
const p = w.players.get('P');
p.body.x = 500; p.body.y = 600;
a.t = 0; w.stepCreature(a);
assert.equal(a.wAng, null);
assert.equal(a.dir, 0, 'a curious creature faces the visitor');
const questions = () => p.events.filter(e => e[0] === 'float' && e[3] === '?').length;
assert.equal(questions(), 1);
a.t = 0; w.stepCreature(a);
assert.equal(questions(), 1, 'curiosity cues are rate limited');
w.t = 12; a.t = 0; w.stepCreature(a);
assert.equal(questions(), 2);

for (const override of [{ hp: a.max - 1 }, { raid: true }, { quest: 'lost' }, { boss: true }, { angry: true }]) {
  const e = { ...a, ...override, wAng: 1.234 };
  w.wildInterest(e, SPECIES.mossip);
  assert.equal(e.wAng, 1.234, 'special and injured creatures keep their existing behaviour');
}
for (const sp of ['puffcap', 'nettlebug']) {
  const e = w.creature(sp, 2, 500, 500); e.wAng = 1.234;
  w.wildInterest(e, SPECIES[sp]);
  assert.equal(e.wAng, 1.234, 'shy and feisty creatures keep their personality');
}
w.arena = {};
a.wAng = 1.234; w.wildInterest(a, SPECIES.mossip);
assert.equal(a.wAng, 1.234, 'Arena Rush is unaffected');
console.log('Wildlife checks passed: grouping, spacing, curiosity, cue cooldown and combat/quest/arena exclusions.');
