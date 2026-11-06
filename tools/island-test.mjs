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

// A hit during a befriend breaks the Bond Charm instead of freezing the island.
{
  const a = P('A');
  place('A', 40, 55);
  const e = w.creature('nettlebug', 3, a.body.x + 40, a.body.y);
  e.hp = Math.floor(e.max * 0.1);
  a.ex.inv.charm = 2;
  const mark = (sent.get('A') || []).length;
  w.message('A', { k: 'in', s: a.lastSeq + 1 + a.input.length, i: [[0, 0, BITS.catch]] });
  w.step();
  assert.ok(e.state === 'bound' && e.bound?.by === 'A', 'the Bond Charm is holding the creature');
  assert.equal(a.ex.inv.charm, 1, 'the charm is spent');
  w.hurt(e, 1, 'none', { pid: 'A' });
  const sane = () => [...w.ents.values()].every((x) => x.state !== 'bound' || x.bound);
  for (let i = 0; i < 120; i++) { w.step(); assert.ok(sane(), 'no creature is bound without a charm'); }
  assert.ok(e.state !== 'bound' && !e.bound, `a hit breaks the charm (state ${e.state})`);
  assert.ok((sent.get('A') || []).slice(mark).flatMap((m) => m.ev || []).some((ev) => ev[0] === 'catch' && ev[1] === e.id && ev[2] === 0), 'the thrower sees it break free');
  // A creature somehow left 'bound' with no charm recovers on its own.
  const g = w.creature('nettlebug', 3, a.body.x + 80, a.body.y, { state: 'bound' });
  for (let i = 0; i < 5; i++) w.step();
  assert.ok(!w.ents.get(g.id) || g.state !== 'bound', 'a stray bound state resets');
  for (const x of [e, g]) w.ents.delete(x.id);
}

// The Healer's Supplies quest needs Sunberries picked after she asks, not the ones handed out at the start.
{
  const b = P('B'), q = b.ex.quests;
  assert.ok(!q.supplies && q.starter === 9);
  b.ex.inv.sunberry = 6; // 2 to start, 3 from the elder, 1 from Lili
  const hp = npcPos('healer');
  Object.assign(b.body, { x: hp.x, y: hp.y + 30 });
  b.dlg = { npc: 'healer', choices: ['supplies-start'] };
  w.message('B', { k: 'cmd', c: 'choose', npc: 'healer', id: 'supplies-start' });
  assert.equal(q.supplies, 1, 'the quest is not done the moment it starts');
  const bush = island().nodes.find((n) => n.item === 'sunberry');
  const pick = () => { b.nodes = {}; Object.assign(b.body, { x: bush.x, y: bush.y + 10 }); w.interact(b); };
  for (let i = 0; i < 4; i++) pick();
  assert.equal(q.supplies, 1, 'four picked is not enough, even with 10 in the bag');
  const rec = w.snapshot(b);
  assert.equal(validateExplorer(JSON.parse(JSON.stringify(rec)), 'B').picked, 4, 'picking progress is saved');
  pick();
  assert.equal(q.supplies, 2, 'five picked: back to the Healer');
  Object.assign(b.body, { x: hp.x, y: hp.y + 30 });
  b.dlg = { npc: 'healer', choices: ['supplies'] };
  w.message('B', { k: 'cmd', c: 'choose', npc: 'healer', id: 'supplies' });
  assert.equal(q.supplies, 9);
  assert.equal(b.ex.picked, undefined);
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

// A boss that leaves after everyone walks away takes its summoned murklings with it.
{
  const [ax, ay] = ARENAS.mirebrute.at;
  w.open = { bridge: true, cave: true, storm: true };
  ids.forEach((id, i) => { place(id, ax - 1.5 + i, ay + 2); P(id).hp = 999; });
  steps(25);
  const boss = [...w.ents.values()].find((e) => e.type === 'b' && e.kind === 'mirebrute');
  assert.ok(boss);
  Object.assign(boss, { state: 'fight', hp: Math.round(boss.max * 0.5), summonT: 0, cd: 0 });
  let guard = 0;
  while (![...w.ents.values()].some((e) => e.summoner === boss.id) && guard++ < 200) { for (const id of ids) P(id).hp = 999; steps(1); }
  assert.ok([...w.ents.values()].some((e) => e.summoner === boss.id && e.boss), 'the boss calls helpers');
  ids.forEach((id, i) => { place(id, 62 + i, 70); P(id).hp = 999; });
  steps(400, () => [0, 0, 0]);
  assert.ok(!w.ents.has(boss.id), 'the boss leaves an empty arena');
  assert.ok(![...w.ents.values()].some((e) => e.summoner === boss.id), 'and its helpers go too');
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
  assert.ok(events('D').some((e) => e[0] === 'parked'), 'the screen is told it was parked');
  // Safety net: a screen still on the island after a park asks for its explorer back.
  w.message('A', { k: 'cmd', c: 'unpark' });
  assert.ok(P('A').ready, 'unpark does nothing for someone who was never parked');
  w.message('D', { k: 'cmd', c: 'unpark' });
  assert.ok(d.ready, 'unpark puts the explorer back');
  assert.ok(!d.ex.team.some((m) => m.hp > 0) || w.ents.get(d.comp)?.companion, 'with their companion');
  assert.equal(d.ex.shells, shells, 'with everything they had');
  assert.ok(events('D').filter((e) => e[0] === 'ready').length > 0 && events('D').some((e) => e[0] === 'warp'), 'and tells the screen');
  steps(5);
  w.message('D', { k: 'cmd', c: 'unpark' });
  assert.ok(d.ready, 'a second unpark changes nothing');
  // A parked explorer can't come back while the same explorer is on the island elsewhere.
  d.tag = 'tag-A';
  w.park(d);
  assert.ok(!d.ready);
  w.message('D', { k: 'cmd', c: 'unpark' });
  assert.ok(!d.ready, 'unpark refuses when the same explorer is already on the island');
  d.tag = 'tag-D';
  w.message('D', { k: 'cmd', c: 'unpark' });
  assert.ok(d.ready);
}
// Load adventure mid-session: a ready explorer is swapped for the saved record, checked first.
{
  const a = P('A');
  w.message('A', { k: 'cmd', c: 'save' });
  const rec = events('A').filter((e) => e[0] === 'snap').pop()[2];
  const oldComp = a.comp, oldShells = rec.shells;
  a.ex.shells += 7; w.bump(a, true);
  const mark = (sent.get('A') || []).length;
  const since = () => (sent.get('A') || []).slice(mark).flatMap((m) => m.ev || []);
  w.message('A', { k: 'cmd', c: 'load', rec: { ...rec, kind: 'nope' }, tag: 'tag-A' });
  assert.ok(a.ready && a.comp === oldComp && a.ex.shells === oldShells + 7, 'a bad record changes nothing');
  w.message('A', { k: 'cmd', c: 'load', rec, savedAt: 1234, tag: 'tag-B' });
  assert.ok(a.ready && a.comp === oldComp, 'another explorer’s tag is refused');
  w.message('A', { k: 'cmd', c: 'load', rec, savedAt: 1234, tag: 'tag-A' });
  assert.ok(a.ready && a.ex.shells === oldShells && a.lastSave === 1234, 'the explorer is replaced from the saved record');
  assert.ok(a.comp && a.comp !== oldComp && !w.ents.has(oldComp) && w.ents.get(a.comp).companion, 'with a fresh companion, the old one gone');
  assert.ok(since().some((e) => e[0] === 'ready') && !since().some((e) => e[0] === 'parked'), 'the screen is told it is ready, not parked');
  assert.ok(!w.unsaved(a), 'what was just loaded counts as saved');
  w.message('A', { k: 'cmd', c: 'new', look: { skin: 0, hair: 0 } });
  assert.equal(a.ex.shells, oldShells, 'a new explorer can’t be started over a living one');
}
console.log('Creature Island checks passed: four explorers at once, first companion, befriending, exact movement prediction, saves (one consistent capture, unsaved tracking including moving away, save-and-leave only when the save has everything, forged saves cleaned), gates in story order, all three bosses, the village raid, reconnecting.');

// Arena Rush: a five-minute survival run, no saving, in a walled chamber.
{
  const { attachArena, ARENA } = await import('../games/island-arena.js');
  const msgs = new Map();
  const aw = new World({ send: (pid, msg) => { if (!msgs.has(pid)) msgs.set(pid, []); msgs.get(pid).push(msg); } });
  const arena = attachArena(aw);
  aw.room([{ id: 'A', name: 'Ann', connected: true }, { id: 'B', name: 'Bo', connected: true }]);
  const ap = (id) => aw.players.get(id);
  const aevents = (id) => (msgs.get(id) || []).flatMap((m) => m.ev || []);
  const run = (n, inp = () => [0, 0, 0]) => { for (let i = 0; i < n; i++) { for (const id of ['A', 'B']) { const p = ap(id); if (p?.ready) aw.message(id, { k: 'in', s: p.lastSeq + 1 + p.input.length, i: [inp(id, i)] }); } aw.step(); } };
  assert.equal(arena.state, 'wait');
  run(10);
  assert.ok(ap('A').ready && ap('B').ready, 'everyone is in the arena without choosing or loading anything');
  assert.equal(arena.state, 'run');
  assert.deepEqual([ap('A').ex.lv, ap('A').ex.team.length, ap('A').ex.quests.starter], [5, 1, 9], 'a fresh level-5 explorer with a companion');
  const cx = ARENA.at[0] * T, cy = ARENA.at[1] * T;
  const inArena = (p) => Math.hypot(p.body.x - cx, p.body.y - cy) < (ARENA.r + 1) * T;
  assert.ok(inArena(ap('A')) && inArena(ap('B')) && ap('A').body.x >= 128 * T, 'in the stone chamber');
  assert.equal(aw.unsaved(ap('A')), false, 'nothing is ever unsaved');
  for (const c of ['save', 'saved', 'new', 'load', 'buy', 'respawn']) {
    aw.message('A', { k: 'cmd', c, snap: 1, rec: {} });
    assert.ok(aevents('A').slice(-3).some((e) => e[0] === 'toast'), `${c} is refused in the arena`);
  }
  assert.ok(!aevents('A').some((e) => e[0] === 'snap'), 'no save capture is ever made');
  // The wall: walking at the one way out never gets past it.
  for (let i = 0; i < 400; i++) { run(1, () => [0, 100, 0]); if (i % 40 === 0) for (const id of ['A', 'B']) ap(id).hp = 1e5; }
  assert.ok(inArena(ap('A')) && ap('A').body.y < (ARENA.at[1] + ARENA.r) * T + 4, 'the way out is sealed');
  // Waves arrive on the clock and the score counts what is beaten.
  for (const id of ['A', 'B']) ap(id).hp = 1e5;
  // Isolate wave/timer assertions from combat balance while enemies accumulate.
  run(20 * 25, id => { ap(id).hp = 1e5; return [0, 0, 0]; });
  assert.ok(arena.wave >= 3, `waves come (wave ${arena.wave})`);
  const view = aw.worldView(ap('A')).arena;
  assert.ok(view.s === 'run' && view.dur === 300 && view.wave === arena.wave, 'the screen is told the clock and wave');
  assert.ok(aw.worldView(ap('A')).open.arena, 'and the wall');
  assert.ok(arena.foes.size > 0 && [...arena.foes].every((id) => aw.ents.get(id)?.hp > 0 && aw.ents.get(id).arena));
  const score0 = arena.score, kills0 = arena.kills;
  const foe = aw.ents.get([...arena.foes][0]);
  aw.hurt(foe, 9999, 'none', { pid: 'A' });
  run(2);
  assert.equal(arena.kills, kills0 + 1, 'a beaten foe counts');
  assert.ok(arena.score >= score0 + 10, 'and scores');
  const at = arena.score;
  // The clock ends the run: foes go, the result stands, then Play again starts fresh.
  arena.skip(arena.dur);
  run(25);
  assert.equal(arena.state, 'over');
  assert.equal(arena.result.reason, 'time');
  assert.ok(arena.result.score >= at + 150, 'surviving to the end adds a bonus');
  assert.equal(arena.foes.size, 0);
  assert.ok(![...aw.ents.values()].some((e) => e.arena), 'no foes are left');
  assert.equal(aw.worldView(ap('B')).arena.res.score, arena.result.score);
  aw.message('B', { k: 'cmd', c: 'again' });
  assert.deepEqual([arena.state, arena.score, arena.wave], ['run', 0, 0], 'play again starts a fresh run');
  assert.ok(ap('A').ready && ap('A').ex.lv === 5);
  // Everyone knocked out at once ends it early.
  run(25 * 20);
  for (const id of ['A', 'B']) Object.assign(ap(id), { downT: 20, hp: 0 });
  run(25);
  assert.equal(arena.state, 'over');
  assert.equal(arena.result.reason, 'down');
  assert.ok(ap('A').downT === 0 && ap('A').hp > 0, 'and everyone is back on their feet for the end card');
  assert.equal(w.arena, null, 'an adventure world is untouched');
  console.log('Arena Rush checks passed: fresh explorers, walled chamber, waves, score, clock end, play again, all-down end, nothing saved.');
}
// Balance: bosses sized to the party, the cost of a knockout, the raid, levels and companion moves.
{
  const { BOSSES, bossHp, PLAYER, respawnFee, bubbleShield, typeMult, AREA_LEVEL, recommendNote, QUESTS, xpToNext, creatureMax: cmax } = await import('../games/island-data.js');
  const { RAID_WAKE } = await import('../games/island-sim.js');
  const { inRect, fits } = await import('../games/island-map.js');
  const bw = new World({ send: () => {} });
  const mk = (id) => {
    bw.room([...bw.players.values()].map((p) => ({ id: p.id, name: p.name, connected: true })).concat([{ id, name: 'Bal ' + id, connected: true }]));
    bw.message(id, { k: 'cmd', c: 'new' });
    const p = bw.players.get(id); p.ex.quests = { starter: 9, marsh: 1 }; p.ex.lv = 8; p.hp = bw.maxHp(p);
    return p;
  };
  const go = (p, x, y) => Object.assign(p.body, { x: x * T, y: y * T });
  const sec = (n = 1) => { for (let i = 0; i < 20 * n; i++) bw.step(); };
  bw.open = { bridge: true, cave: true, storm: true };

  // Solo is the full base health; each extra explorer adds most of it again, so a party isn't easier per head.
  for (const kind of Object.keys(BOSSES)) {
    assert.equal(bossHp(kind, 1), BOSSES[kind].hp);
    const per = bossHp(kind, 4) / 4 / BOSSES[kind].hp;
    assert.ok(per >= 0.7 && per <= 0.85, `${kind}: four explorers share ${per.toFixed(2)} of a solo boss each`);
  }
  assert.ok(BOSSES.mirebrute.hp >= 1500 && BOSSES.tempestra.hp >= 3 * BOSSES.mirebrute.hp, 'bosses last minutes, not seconds');
  // One explorer walks in first: solo health. A friend joins: it grows, keeping the share already knocked off.
  const a = mk('BA'), b = mk('BB');
  const [mx, my] = ARENAS.mirebrute.at;
  go(a, mx, my + 2); go(b, 64, 70);
  sec(2);
  const boss = [...bw.ents.values()].find((e) => e.type === 'b' && e.kind === 'mirebrute');
  assert.ok(boss && boss.max === bossHp('mirebrute', 1), 'a lone explorer meets a solo-sized boss');
  boss.hp = Math.round(boss.max * 0.6); boss.state = 'intro'; boss.t = 99; // hold still for the check
  go(b, mx + 1, my + 2);
  sec(2);
  assert.equal(boss.max, bossHp('mirebrute', 2), 'a second explorer arriving rescales it');
  assert.ok(Math.abs(boss.hp / boss.max - 0.6) < 0.03, `keeping the damage already done (${(boss.hp / boss.max).toFixed(2)})`);
  assert.equal(boss.n, 2);
  // Everyone leaves: the boss goes, but remembers its wounds (healing a quarter) if you come back soon.
  go(a, 64, 70); go(b, 65, 70);
  sec(16);
  assert.ok(!bw.ents.has(boss.id), 'the boss leaves an empty arena');
  go(a, mx, my + 2);
  sec(2);
  const back = [...bw.ents.values()].find((e) => e.type === 'b' && e.kind === 'mirebrute');
  assert.ok(back && Math.abs(back.hp / back.max - 0.85) < 0.04, `a knockout costs the walk back, not the fight (${back && (back.hp / back.max).toFixed(2)})`);
  bw.ents.delete(back.id);
  delete bw.bossLeft.mirebrute;
  a.ex.quests.marsh = 9; a.ex.flags.push('mirebrute'); b.ex.quests.marsh = 9; b.ex.flags.push('mirebrute');

  // A knockout: friends can revive you, but not again straight away; heading home waits a moment and costs shells.
  go(a, 64, 70); go(b, 64.6, 70);
  sec(1);
  const knock = (p) => { p.iT = 0; p.shield = 0; bw.hurt({ type: 'p', pid: p.id, hp: 1 }, 1e6, 'none'); assert.ok(p.downT > 0); };
  const press = (p, bits) => { bw.message(p.id, { k: 'in', s: p.lastSeq + 1 + p.input.length, i: [[0, 0, bits]] }); bw.step(); };
  knock(a);
  press(b, BITS.interact);
  assert.equal(b.chan?.who, 'BA', 'a friend starts reviving');
  assert.ok(Math.abs(b.chan.left - PLAYER.revive) < 0.11 && PLAYER.revive > 1.5, 'which takes a little longer than before');
  for (let i = 0; i < 20 * PLAYER.revive + 2; i++) bw.step();
  assert.ok(!a.downT && a.hp > 0, 'revived');
  assert.ok(a.reviveAt > bw.t, 'and a revive cooldown starts');
  assert.ok(bw.personalView(a).reviveAt > 0, 'which their screen is told about');
  knock(a);
  press(b, BITS.interact);
  assert.ok(!b.chan, 'no second revive straight away');
  a.ex.shells = 100;
  bw.message('BA', { k: 'cmd', c: 'respawn' });
  assert.ok(a.downT > 0, '"Return to the village" waits a few seconds first');
  sec(PLAYER.respawnWait + 0.25);
  bw.message('BA', { k: 'cmd', c: 'respawn' });
  assert.ok(!a.downT && inRect(a.body.x, a.body.y, VILLAGE), 'then you wake in the village square');
  assert.equal(a.ex.shells, 100 - respawnFee(a.ex.lv, 100), 'for a few shells');
  assert.ok(respawnFee(8, 1000) <= 25 && respawnFee(8, 1000) > 0 && respawnFee(8, 3) === 3 && respawnFee(8, 0) === 0, 'never more than a few, or more than you have');
  knock(a); a.ex.shells = 0;
  sec(PLAYER.downFor + 1);
  assert.ok(!a.downT && a.hp === bw.maxHp(a), 'waking on your own still works with no shells');

  // The raid: knocked-out defenders wake outside the square, and murklings left in the square can win.
  for (const p of [a, b]) { p.ex.quests.defend = 1; go(p, 63 + p.seat, 70); }
  sec(1);
  assert.ok(bw.raid && bw.raid.hold === 100, 'the raid starts with the square fully defended');
  knock(a); sec(PLAYER.respawnWait + 0.25);
  bw.message('BA', { k: 'cmd', c: 'respawn' });
  assert.ok(!inRect(a.body.x, a.body.y, VILLAGE), 'during the raid you wake outside the village');
  assert.deepEqual([a.body.x / T, a.body.y / T], RAID_WAKE[a.seat]);
  assert.ok(RAID_WAKE.every(([x, y]) => fits(x * T, y * T, 9, {}) && !inRect(x * T, y * T, VILLAGE)), 'somewhere you can stand, outside the square');
  const flags = [...a.ex.flags], inv = JSON.stringify(a.ex.inv);
  for (const id of bw.raid.left) bw.ents.delete(id);
  bw.raid.left = [];
  for (let i = 0; i < 4; i++) { const m = bw.creature('murk', 12, 64.5 * T + i * 10, 71 * T, { raid: true, angry: true }); bw.raid.left.push(m.id); }
  bw.raid.wave = 1;
  go(a, 50, 40); go(b, 50, 41); // nobody is defending the square
  let held = 100, guard = 0;
  while (bw.raid && guard++ < 60) {
    sec(1);
    for (const id of bw.raid?.left || []) { const m = bw.ents.get(id); if (m) Object.assign(m, { x: 64.5 * T, y: 71 * T, state: 'wander', target: null }); }
    if (bw.raid) { assert.ok(bw.raid.hold <= held); held = bw.raid.hold; }
  }
  assert.equal(bw.raid, null, 'murklings holding the square end the raid');
  assert.ok(![...bw.ents.values()].some((e) => e.raid), 'and pull back');
  assert.ok([a, b].every((p) => p.ex.quests.defend === 1), 'the quest is just as before the raid');
  assert.deepEqual(a.ex.flags, flags); assert.equal(JSON.stringify(a.ex.inv), inv, 'nothing is lost');
  go(a, 63, 70); go(b, 64, 70);
  sec(2);
  assert.equal(bw.raid, null, 'a breather before they come again');
  sec(20);
  assert.ok(bw.raid && bw.raid.hold === 100, 'then the raid restarts cleanly');
  assert.equal(bw.worldView(a).raid.hold, 100, 'screens are shown the square’s defences');
  for (const id of bw.raid.left) bw.ents.delete(id);
  bw.raid = null;

  // Recommended levels: rising along the story, shown when you walk into an area, never a gate.
  const order = ['woods', 'shore', 'lake', 'marsh', 'cave', 'peak'];
  assert.ok(order.every((z, i) => !i || AREA_LEVEL[z] > AREA_LEVEL[order[i - 1]]));
  assert.equal(recommendNote('marsh', 3), `Recommended level ${AREA_LEVEL.marsh} · you are level 3`);
  assert.equal(recommendNote('marsh', 12), `Recommended level ${AREA_LEVEL.marsh}`);
  assert.equal(recommendNote('village', 1), '');
  const { readFileSync } = await import('node:fs');
  const client = readFileSync(new URL('../games/island-client.js', import.meta.url), 'utf8');
  assert.ok(/banner\(areaName\(z\), recommendNote\(z, /.test(client), 'the area banner shows the recommended level');
  // The story's own XP (quests and first boss wins), plus a modest number of fights along the way, reaches
  // each recommended level without grinding. Explorers keep 60% of XP.
  {
    let lv = 1, xp = 0;
    const gain = (raw) => { xp += Math.round(raw * 0.6); while (xp >= xpToNext(lv)) { xp -= xpToNext(lv); lv++; } };
    const fights = (n, wildLv) => { for (let i = 0; i < n; i++) gain(8 + 4 * wildLv); };
    fights(8, 4); fights(8, 5); gain(QUESTS.bridge.xp); gain(QUESTS.supplies.xp); gain(QUESTS.lost.xp); fights(8, 8);
    assert.ok(lv >= AREA_LEVEL.marsh, `level ${lv} for the Mirebrute`);
    gain(BOSSES.mirebrute.xp); fights(12, 12);
    assert.ok(lv >= AREA_LEVEL.cave, `level ${lv} for the Quartzhulk`);
    gain(BOSSES.quartzhulk.xp); fights(12, 13); gain(QUESTS.defend.xp);
    assert.ok(lv >= AREA_LEVEL.peak, `level ${lv} for Tempestra`);
  }
  assert.ok(Object.values(QUESTS).filter((q) => q.xp).length >= 7, 'quests give XP');
  {
    const xp0 = b.ex.xp, lv0 = b.ex.lv;
    b.ex.quests.fishing = 1; b.ex.team.push({ uid: 'ripfabcd', sp: 'ripplefin', lv: 5, xp: 0, hp: cmax('ripplefin', 5) });
    const fp = npcPos('fisher'); Object.assign(b.body, { x: fp.x, y: fp.y + 30 });
    b.dlg = { npc: 'fisher', choices: ['fishing-done'] };
    bw.message('BB', { k: 'cmd', c: 'choose', npc: 'fisher', id: 'fishing-done' });
    assert.equal(b.ex.quests.fishing, 9);
    assert.ok(b.ex.lv > lv0 || b.ex.xp > xp0, 'finishing a quest gives XP');
  }

  // Companion moves: Bubble Ring's shield grows with the companion; Static Field is trimmed.
  assert.ok(bubbleShield(5) > 30 && bubbleShield(15) > bubbleShield(5) + 30, 'Bubble Ring scales with level');
  go(b, 40, 55);
  for (const clv of [5, 15]) {
    b.ex.team = [{ uid: 'dew' + clv + 'abcd', sp: 'dewpaw', lv: clv, xp: 0, hp: cmax('dewpaw', clv) }]; b.ex.active = 0; bw.summon(b); b.cds = {};
    b.shield = 0; bw.ability(b);
    assert.equal(b.shield, bubbleShield(clv), `level ${clv} Bubble Ring shield`);
  }
  {
    b.ex.team = [{ uid: 'fizzabcd', sp: 'fizzwing', lv: 10, xp: 0, hp: cmax('fizzwing', 10) }]; b.ex.active = 0; bw.summon(b); b.cds = {};
    for (const e of [...bw.ents.values()]) if (e.type === 'c' && !e.companion) bw.ents.delete(e.id);
    const c = bw.ents.get(b.comp), dummy = bw.creature('gemmole', 10, c.x + 60, c.y, { state: 'hurt' });
    dummy.hp = dummy.max = 1e6;
    let hits = 0; const hurt = bw.hurt.bind(bw);
    bw.hurt = (e, amt, el, src) => { if (e === dummy) hits += amt; return hurt(e, amt, el, src); };
    bw.ability(b);
    const field = [...bw.ents.values()].find((z) => z.type === 'z' && z.owner === 'BB');
    assert.ok(field, 'Static Field makes a field');
    for (let i = 0; i < 80 && bw.ents.has(field.id); i++) bw.stepZone(field);
    bw.hurt = hurt;
    const total = hits / bw.compAtk(b, c);
    assert.ok(total <= 2.05 && total >= 1.5, `Static Field deals ${total.toFixed(2)}× over its life (was 3×)`);
    bw.ents.delete(dummy.id);
  }
  // Every starter has a miniboss it is at least even against.
  for (const sp of STARTERS) assert.ok(['mirebrute', 'quartzhulk'].some((k) => typeMult(SPECIES[sp].el, BOSSES[k].el) >= 1), `${sp} has a fair miniboss`);
  assert.equal(typeMult('ember', 'stone'), 1, 'Stone no longer resists Ember');
  console.log('Creature Island balance passed: party-sized bosses that rescale, boss wounds remembered, revive cooldown, respawn wait and fee, raid wake point and defences, recommended levels, story XP, Bubble Ring and Static Field.');
}
