// Checks Creature Island's world without a browser: four explorers at once, the story from the first
// companion to the final boss, befriending, gates, saves (what is captured, what is refused on load),
// and that a player's own screen predicts their movement exactly as the host moves them.
import assert from 'node:assert/strict';
import { seededRandom } from './seed.mjs';
import { World, BITS, stepBody, newBody, validateExplorer, objective, catchChance, npcPos } from '../games/island-sim.js';
import { island, reachable, SPAWN, ARENAS, VILLAGE, LOST_AT, LUNA_AT, TRACKS, W } from '../games/island-map.js';
import { TILE, SPECIES, STARTERS, CATCH_HP } from '../games/island-data.js';

Math.random = seededRandom('island-test-v1');
const T = TILE;
const sent = new Map();
const w = new World({ send: (pid, msg) => { if (!sent.has(pid)) sent.set(pid, []); sent.get(pid).push(msg); } });
const ids = ['A', 'B', 'C', 'D'];
w.room(ids.map((id) => ({ id, name: 'Explorer ' + id, connected: true })));
assert.equal(w.players.size, 4);
assert.deepEqual([...w.players.values()].map((p) => p.seat).sort(), [0, 1, 2, 3], 'four seats, four colours');
for (const id of ids) w.message(id, { k: 'cmd', c: 'new', look: { skin: 1, hair: 2 }, tag: 'tag-' + id });
assert.ok([...w.players.values()].every((p) => p.ready), 'everyone is on the island');
w.room([...ids, 'E'].map((id) => ({ id, name: id, connected: true })));
w.message('E', { k: 'cmd', c: 'load', rec: { kind: 'island-explorer', v: 1 }, tag: 'tag-A' });
assert.ok(!w.players.get('E').ready, 'the same explorer can’t be on the island twice');
w.room(ids.map((id) => ({ id, name: 'Explorer ' + id, connected: true })));
assert.equal(w.players.size, 4, 'someone who leaves the table leaves the island');

const P = (id) => w.players.get(id);
const steps = (n, inputs = () => [0, 0, 0]) => {
  for (let i = 0; i < n; i++) {
    for (const id of ids) { const p = P(id); if (p?.ready) w.message(id, { k: 'in', s: p.lastSeq + 1 + p.input.length, i: [inputs(id, i)] }); }
    w.step();
  }
};
const lastOf = (id, k) => (sent.get(id) || []).filter((m) => m.k === k).pop();
const events = (id) => (sent.get(id) || []).flatMap((m) => m.ev || []);
const place = (id, x, y) => Object.assign(P(id).body, { x: x * T, y: y * T });

// The first companion, chosen in conversation with the elder.
place('A', 68, 66.6);
steps(1, (id) => (id === 'A' ? [0, 0, BITS.interact] : [0, 0, 0]));
steps(2);
assert.ok(events('A').some((e) => e[0] === 'dlg' && e[1].npc === 'elder'), 'talking to the elder opens a conversation');
w.message('A', { k: 'cmd', c: 'choose', npc: 'elder', id: 'mossip' });
assert.equal(P('A').ex.team[0].sp, 'mossip');
assert.equal(P('A').ex.quests.starter, 9);
assert.ok(P('A').comp && w.ents.get(P('A').comp).companion, 'the companion follows');
for (const [id, sp] of [['B', 'emberkit'], ['C', 'dewpaw'], ['D', 'mossip']]) { place(id, 68, 66.6); P(id).dlg = { npc: 'elder', choices: STARTERS }; w.message(id, { k: 'cmd', c: 'choose', npc: 'elder', id: sp }); }
assert.ok(ids.every((id) => P(id).ex.team.length === 1));

// Four people moving at once, in every direction, for a minute of play.
for (const id of ids) place(id, 64 + ids.indexOf(id), 69.5);
const dirs = { A: [100, 0], B: [-100, 0], C: [0, 100], D: [0, -100] };
const start = Object.fromEntries(ids.map((id) => [id, { x: P(id).body.x, y: P(id).body.y }]));
steps(30, (id) => [...dirs[id], 0]);
for (const id of ids) {
  const moved = Math.hypot(P(id).body.x - start[id].x, P(id).body.y - start[id].y);
  assert.ok(moved > 120, `${id} moved on their own (${Math.round(moved)} px)`);
}
const f = lastOf('A', 'f');
assert.ok(f.e.some((e) => e[0] === 'p'), 'frames show the other explorers');
assert.ok(f.e.some((e) => e[0] === 'c' && e[9] & 4), 'and companions');
steps(1200, () => [Math.round((Math.random() - 0.5) * 200), Math.round((Math.random() - 0.5) * 200), Math.random() < 0.05 ? BITS.attack : Math.random() < 0.02 ? BITS.dodge : 0]);
assert.ok(w.ents.size < 200, 'the world stays tidy');

// Prediction: the player's own device steps the same body from the same inputs and gets the same place.
{
  const open = { ...w.open };
  const hostBody = newBody(60 * T, 70 * T), mine = newBody(60 * T, 70 * T);
  const inputs = Array.from({ length: 400 }, (_, i) => [Math.round(Math.sin(i / 9) * 100), Math.round(Math.cos(i / 13) * 100), i % 37 === 0 ? BITS.dodge : i % 11 === 0 ? BITS.attack : 0]);
  for (const inp of inputs) stepBody(hostBody, inp, open);
  for (const inp of inputs) stepBody(mine, inp, open);
  assert.deepEqual([mine.x, mine.y, mine.dT, mine.dCd], [hostBody.x, hostBody.y, hostBody.dT, hostBody.dCd], 'prediction matches the host exactly');
}

// Befriending: weaken a wild creature, then throw a Bond Charm.
{
  const a = P('A');
  place('A', 40, 55);
  const e = w.creature('nettlebug', 3, a.body.x + 40, a.body.y);
  e.hp = Math.floor(e.max * CATCH_HP);
  assert.ok(catchChance(e) >= SPECIES.nettlebug.catch, 'the catch chance is shown from the creature’s health');
  const before = a.ex.team.length + a.ex.ranch.length, charms = a.ex.inv.charm;
  let tries = 0;
  while (a.ex.team.length + a.ex.ranch.length === before && tries++ < 30) {
    if (!w.ents.get(e.id)) break;
    e.hp = Math.floor(e.max * 0.1); e.state = 'wander'; e.bound = null;
    Object.assign(e, { x: a.body.x + 40, y: a.body.y });
    a.ex.inv.charm = 5;
    w.message('A', { k: 'in', s: a.lastSeq + 1, i: [[0, 0, BITS.catch]] });
    w.step();
    for (let i = 0; i < 40; i++) w.step();
  }
  assert.ok(a.ex.team.length + a.ex.ranch.length > before, 'a weakened creature can be befriended');
  assert.ok(a.ex.dex.caught.includes('nettlebug'));
  void charms;
}

// Saving captures one consistent moment; loading checks everything.
{
  const a = P('A');
  a.ex.inv.sunberry = 7;
  w.message('A', { k: 'cmd', c: 'save' });
  const snap = events('A').filter((e) => e[0] === 'snap').pop();
  assert.ok(snap, 'a save request returns a snapshot');
  const [, prog, rec, snapId] = snap;
  void prog;
  assert.equal(rec.kind, 'island-explorer');
  assert.equal(rec.inv.sunberry, 7);
  assert.ok(JSON.stringify(rec).length < 20000, 'a save is small');
  assert.equal(lastOf('A', 'me')?.unsaved ?? true, true);
  w.message('A', { k: 'cmd', c: 'saved', snap: snapId });
  assert.deepEqual(events('A').filter((e) => e[0] === 'saved').pop(), ['saved', snapId, true], 'the host confirms the save covers everything');
  assert.equal(a.prog, a.savedProg, 'confirmed saves clear the unsaved marker');
  a.ex.shells += 5; w.bump(a, true);
  assert.ok(a.prog > a.savedProg, 'progress after the snapshot stays unsaved');
  // Standing somewhere else than the save counts as unsaved too (a reload would put you back there).
  w.message('A', { k: 'cmd', c: 'save' });
  const again = events('A').filter((e) => e[0] === 'snap').pop();
  w.message('A', { k: 'cmd', c: 'saved', snap: again[3] });
  assert.equal(w.unsaved(a), false);
  a.body.x += 30;
  assert.equal(w.unsaved(a), false, 'a step or two away is still where you saved');
  a.body.x += 70;
  assert.equal(w.unsaved(a), true, 'walking off is unsaved');
  for (let i = 0; i < 25; i++) w.step();
  assert.equal(lastOf('A', 'me').unsaved, true, 'and the bag shows it');
  a.body.x -= 100;
  w.message('A', { k: 'cmd', c: 'saved', snap: 999 });
  assert.deepEqual(events('A').filter((e) => e[0] === 'saved').pop(), ['saved', 999, false], 'an unknown snapshot confirms nothing');
  const back = validateExplorer(JSON.parse(JSON.stringify(rec)), 'Explorer A');
  assert.equal(back.team.length, rec.team.length);
  assert.equal(back.inv.sunberry, 7);
  const forged = validateExplorer({ ...rec, lv: 999, shells: -5, inv: { sunberry: 5000, rocket: 3 }, team: [{ sp: 'dragon', lv: 5 }, { sp: 'mossip', lv: 80, hp: 1e9 }], flags: ['champion', 'hacked'], loc: { x: 0, y: 0 } }, 'X');
  assert.equal(forged.lv, 30);
  assert.equal(forged.shells, 0);
  assert.deepEqual(forged.inv, { sunberry: 99 });
  assert.deepEqual(forged.team.map((m) => [m.sp, m.lv]), [['mossip', 30]]);
  assert.ok(forged.team[0].hp <= 1000, 'numbers are kept in range');
  assert.deepEqual(forged.flags, ['champion']);
  assert.equal(forged.loc, null, 'a place in the sea becomes the village');
  assert.throws(() => validateExplorer({ kind: 'island-explorer', v: 2 }), /newer version/);
  assert.throws(() => validateExplorer({ kind: 'nope' }), /not a Creature Island save/);
}

// Gates open in story order and stay open.
{
  const none = reachable(Math.floor(SPAWN[0]), Math.floor(SPAWN[1]), {});
  const at = ([x, y]) => none[Math.floor(y) * W + Math.floor(x)];
  assert.ok(!at(ARENAS.mirebrute.at) && !at([145, 90]) && !at(ARENAS.tempestra.at), 'the lake, cave and peak start closed');
  assert.ok(at(LOST_AT) && at(LUNA_AT), 'the woods and shore are open');
  P('A').ex.flags.push('bridge');
  w.refreshGates();
  assert.ok(w.open.bridge);
  P('A').ex.flags.splice(P('A').ex.flags.indexOf('bridge'), 1);
  w.refreshGates();
  assert.ok(w.open.bridge, 'a gate never closes on someone');
}

// Every boss can be beaten by the party, and pays everyone who fought.
for (const [kind, flag] of [['mirebrute', 'mirebrute'], ['quartzhulk', 'quartzhulk'], ['tempestra', 'tempestra']]) {
  const [ax, ay] = ARENAS[kind].at;
  ids.forEach((id, i) => { place(id, ax - 1.5 + i, ay + 2); P(id).ex.quests[{ mirebrute: 'marsh', quartzhulk: 'cave', tempestra: 'peak' }[kind]] = 1; });
  w.open = { bridge: true, cave: true, storm: true };
  steps(25);
  const boss = [...w.ents.values()].find((e) => e.type === 'b' && e.kind === kind);
  assert.ok(boss, `${kind} appears when the party arrives`);
  let guard = 0;
  while (w.ents.get(boss.id) && boss.state !== 'faint' && guard++ < 4000) {
    for (const id of ids) { const p = P(id); if (p.downT) w.respawn(p); place(id, boss.x / T + (ids.indexOf(id) - 1.5) * 0.8, boss.y / T + 1.6); p.hp = 999; }
    steps(1, () => [0, -40, BITS.attack]);
    if (guard % 10 === 0) w.hurt(boss, 40, 'none', { pid: 'A' });
  }
  assert.equal(boss.state, 'faint', `${kind} can be defeated`);
  steps(5);
  assert.ok(ids.every((id) => P(id).ex.flags.includes(flag)), `${kind}: every explorer in the fight gets the credit`);
}
assert.ok(P('B').ex.inv.tideshard && P('B').ex.inv.stoneshard, 'boss shards');
assert.ok(P('C').ex.flags.includes('champion'), 'beating the storm completes the story');

// The village raid comes in three waves and gives the Ember Shard.
{
  ids.forEach((id, i) => { place(id, 62 + i, 70); P(id).ex.quests.defend = 1; P(id).hp = 999; });
  steps(25);
  assert.ok(w.raid, 'murklings attack when an explorer on that quest is in the village');
  let guard = 0;
  while (w.raid && guard++ < 3000) {
    for (const id of w.raid.left) { const m = w.ents.get(id); if (m && m.hp > 0) w.hurt(m, 999, 'none', { pid: 'D' }); }
    for (const id of ids) { P(id).hp = 999; if (P(id).downT) w.respawn(P(id)); }
    steps(5);
  }
  assert.equal(w.raid, null, 'the raid ends');
  assert.ok(ids.every((id) => P(id).ex.inv.embershard === 1 && P(id).ex.quests.defend === 9));
}

// The tracker always has somewhere to point.
assert.equal(objective({ quests: { starter: 1 }, flags: [], dex: { caught: [] }, inv: {} }).quest, 'starter');
assert.ok(objective({ quests: { starter: 9 }, flags: [], dex: { caught: [] }, inv: {} }).at, 'after the first companion, Captain Ash is next');

// A player who drops out keeps their explorer; one who leaves for good frees the seat.
w.room(ids.map((id) => ({ id, name: 'Explorer ' + id, connected: id !== 'B' })));
const bEx = P('B').ex;
steps(20);
w.room(ids.map((id) => ({ id, name: 'Explorer ' + id, connected: true })));
assert.equal(P('B').ex, bEx, 'reconnecting gets the same explorer back');
assert.ok(island().nodes.length >= 30 && TRACKS.length === 16);
assert.ok(VILLAGE[2] > 0 && npcPos('elder').x > 0);
// Save and leave: the world keeps running during the upload, so the host only lets a player go when the
// confirmed save has everything; then their explorer leaves the island at once.
{
  const d = P('D');
  w.message('D', { k: 'cmd', c: 'save' });
  const s1 = events('D').filter((e) => e[0] === 'snap').pop();
  d.ex.shells += 51; w.bump(d, true); // shared rewards keep arriving during the upload
  w.message('D', { k: 'cmd', c: 'saved', snap: s1[3], leaving: true });
  assert.deepEqual(events('D').filter((e) => e[0] === 'saved').pop(), ['saved', s1[3], false], 'newer progress: not up to date');
  assert.ok(d.ready, 'so the explorer stays on the island');
  w.message('D', { k: 'cmd', c: 'save' });
  const s2 = events('D').filter((e) => e[0] === 'snap').pop();
  assert.equal(s2[2].shells, d.ex.shells, 'a fresh save has the new shells');
  w.message('D', { k: 'cmd', c: 'saved', snap: s2[3], leaving: true });
  assert.deepEqual(events('D').filter((e) => e[0] === 'saved').pop(), ['saved', s2[3], true]);
  assert.ok(!d.ready && !d.comp, 'up to date: the explorer leaves the island before anything else changes');
  const shells = d.ex.shells;
  steps(40);
  assert.equal(d.ex.shells, shells, 'and earns nothing more');
}
console.log('Creature Island checks passed: four explorers at once, first companion, befriending, exact movement prediction, saves (one consistent capture, unsaved tracking including moving away, save-and-leave only when the save has everything, forged saves cleaned), gates in story order, all three bosses, the village raid, reconnecting.');
