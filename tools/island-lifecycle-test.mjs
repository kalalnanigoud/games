// Regression checks for gameplay that crosses save/load, companion and collection boundaries.
import assert from 'node:assert/strict';
import { World, validateExplorer, npcPos } from '../games/island-sim.js';
import { creatureMax, xpToNext, TILE, TEAM_MAX, RANCH_MAX } from '../games/island-data.js';
import { island, LUNA_AT } from '../games/island-map.js';
import { seededRandom } from './seed.mjs';
Math.random = seededRandom('island-lifecycle-v1');
function fresh(rec) {
  const w = new World({ now: () => 12345 }), p = w.addPlayer('A', 'Explorer', 0);
  w.command(p, rec ? { c: 'load', rec: JSON.parse(JSON.stringify(rec)) } : { c: 'new' });
  return { w, p };
}
const save = ({ w, p }) => JSON.parse(JSON.stringify(w.snapshot(p)));
const mon = (uid, sp = 'emberkit', lv = 5) => ({ uid, sp, lv, xp: 0, hp: creatureMax(sp, lv) });
function companions(sp = 'emberkit') {
  const state = fresh(); state.p.ex.quests.starter = 9;
  state.p.ex.team = [mon('active01', sp), mon('reserve01')]; state.w.summon(state.p);
  return state;
}
const live = ({ w, p }) => w.ents.get(p.comp);
const current = ({ p }) => p.ex.team[p.ex.active];
function switchBack(s) {
  const uid = current(s).uid, other = s.p.ex.team.find(m => m.uid !== uid).uid;
  s.w.t += 2; s.w.command(s.p, { c: 'active', uid: other });
  s.w.t += 2; s.w.command(s.p, { c: 'active', uid });
}

// A snapshot contains quest state, not an in-progress shared encounter. Loading must allow a restart.
{
  const s = fresh(); s.p.ex.quests.defend = 1; s.w.raidStep([s.p]);
  assert.ok(s.w.raid); assert.equal(s.p.ex.quests.defend, 2);
  const restored = fresh(save(s));
  assert.equal(restored.p.ex.quests.defend, 2); assert.equal(restored.w.raid, null);
  restored.w.raidStep([restored.p]); assert.ok(restored.w.raid, 'saved defending explorer restarts a missing raid');
  const raid = restored.w.raid;
  const friend = restored.w.addPlayer('B', 'Friend', 1);
  restored.w.command(friend, { c: 'load', rec: save(s) });
  restored.w.raidStep([restored.p, friend]); assert.equal(restored.w.raid, raid, 'loading into an existing raid keeps that encounter');
  for (let n = 0; restored.w.raid && n < 100; n++) {
    for (const id of restored.w.raid.left) { const e = restored.w.ents.get(id); if (e?.hp > 0) restored.w.hurt(e, 9999, 'none'); }
    restored.w.raidStep([restored.p, friend]);
  }
  assert.equal(restored.w.raid, null); assert.equal(restored.p.ex.quests.defend, 9);
  assert.ok(restored.p.ex.flags.includes('raid')); assert.equal(restored.p.ex.inv.embershard, 1);
  restored.w.raidStep([restored.p]); assert.equal(restored.w.raid, null, 'completed raid never restarts');
}
{
  const s = fresh(); s.p.ex.quests.tracks = 1;
  s.p.body.x = LUNA_AT[0] * TILE; s.p.body.y = LUNA_AT[1] * TILE;
  s.w.questWorld([s.p]); assert.equal(s.p.ex.quests.tracks, 2);
  const restored = fresh(save(s)); restored.w.questWorld([restored.p]);
  const lunas = () => [...restored.w.ents.values()].filter(e => e.quest === 'luna');
  assert.equal(lunas().length, 1, 'saved tracks2 recreates the missing Lunahop');
  restored.w.questWorld([restored.p]); assert.equal(lunas().length, 1, 'existing encounter is not duplicated');
  const old = lunas()[0]; restored.w.hurt(old, 9999, 'none');
  for (let n = 0; n < 20; n++) restored.w.stepEnt(old);
  restored.w.questWorld([restored.p]); assert.equal(lunas().length, 1);
  assert.notEqual(lunas()[0].id, old.id, 'a knocked-out quest creature can be encountered again');
  const target = lunas()[0]; target.bound = { by: restored.p.id, chance: 1 };
  restored.w.resolveCatch(target); assert.equal(restored.p.ex.quests.tracks, 9);
  assert.ok(restored.p.ex.gear.includes('feather')); restored.w.questWorld([restored.p]);
  assert.equal(lunas().length, 0, 'completed quest does not create another encounter');
}

// Team HP is authoritative through every route which can mutate a live companion or replace it.
{
  const s = companions(), max = live(s).max, version = s.p.meVer;
  s.w.hurt(live(s), 40, 'none'); const damaged = live(s).hp;
  assert.ok(damaged > 0 && damaged < max); assert.equal(current(s).hp, damaged);
  assert.ok(s.p.meVer > version, 'nonlethal companion damage refreshes the personal view');
  assert.equal(save(s).team[0].hp, damaged);
  s.w.command(s.p, { c: 'use', item: 'sunberry', on: current(s).uid });
  assert.equal(live(s).hp, Math.min(max, damaged + 35)); assert.equal(current(s).hp, live(s).hp);
  const healed = live(s).hp; switchBack(s); assert.equal(live(s).hp, healed, 'ordinary switching preserves damage/healing');
  s.w.park(s.p); s.w.unpark(s.p); assert.equal(live(s).hp, healed, 'parking does not restore HP');
  const restored = fresh(save(s)); assert.equal(live(restored).hp, healed);
  s.w.gainXp(s.p, xpToNext(current(s).lv));
  assert.equal(current(s).hp, live(s).max); assert.equal(live(s).hp, current(s).hp, 'level-up restores the one HP value');
  s.w.hurt(live(s), 9999, 'none'); assert.equal(current(s).hp, 0); assert.equal(s.p.comp, null);
  s.p.ex.inv.seed = 1; s.w.command(s.p, { c: 'use', item: 'seed', on: current(s).uid });
  assert.equal(live(s).hp, Math.round(live(s).max / 2)); assert.equal(current(s).hp, live(s).hp);
  s.w.hurt(live(s), 10, 'none'); const healer = npcPos('healer'); Object.assign(s.p.body, healer);
  s.w.talk(s.p, 'healer'); assert.equal(current(s).hp, live(s).max); assert.equal(live(s).hp, current(s).hp);
}
{
  const s = companions('puffcap'); s.w.hurt(live(s), 20, 'none'); const before = live(s).hp;
  s.w.ability(s.p); const after = Math.min(live(s).max, before + Math.round(live(s).max * .25));
  assert.equal(live(s).hp, after); assert.equal(current(s).hp, after, 'healing spores update the same HP record');
  switchBack(s); assert.equal(live(s).hp, after, 'switching preserves self-healing abilities');
}

// Legacy ranch overflow remains recoverable; new deposits must never create it.
{
  const s = companions(); s.p.ex.ranch = Array.from({ length: RANCH_MAX }, (_, i) => mon('ranch' + i));
  const ranch = island().props.find(p => p.use === 'ranch'); Object.assign(s.p.body, { x: ranch.x, y: ranch.y });
  const before = save(s);
  assert.throws(() => s.w.command(s.p, { c: 'ranch', op: 'deposit', team: 'active01' }), /ranch is full/i);
  assert.deepEqual(save(s), before, 'refused full deposit does not remove or alter creatures');
  // Reachable old-version maximum: team1 and ranch62, all63 creatures survive repeated loads.
  const legacy = { ...before, team: [mon('active01')], ranch: Array.from({ length: RANCH_MAX + TEAM_MAX - 1 }, (_, i) => mon('legacy' + i)) };
  const restored = fresh(legacy), again = fresh(save(restored));
  assert.equal(again.p.ex.ranch.length, 62); assert.equal(again.p.ex.team.length, 1);
  assert.deepEqual(new Set(again.p.ex.ranch.map(m => m.uid)), new Set(legacy.ranch.map(m => m.uid)));
  Object.assign(again.p.body, { x: ranch.x, y: ranch.y });
  again.w.command(again.p, { c: 'ranch', op: 'withdraw', ranch: 'legacy61' });
  assert.equal(again.p.ex.ranch.length, 61); assert.ok(again.p.ex.team.some(m => m.uid === 'legacy61'));
  assert.throws(() => again.w.command(again.p, { c: 'ranch', op: 'deposit', team: 'legacy61' }), /ranch is full/i);
  const oversized = { ...legacy, ranch: [...legacy.ranch, mon('unexpected1')] }, original = again.p.ex;
  assert.throws(() => again.w.command(again.p, { c: 'load', rec: oversized }), /too many creatures/);
  assert.equal(again.p.ex, original, 'oversized load is refused before replacing the living explorer');
  assert.equal(oversized.ranch.length, 63, 'rejected source record is untouched');
  // Filtering invalid/duplicate records remains compatible with normal validation.
  assert.equal(validateExplorer({ ...legacy, ranch: [...legacy.ranch, legacy.ranch[0], { sp: 'invalid' }] }).ranch.length, 62);
}
console.log('Island lifecycle regressions passed: raid/Lunahop recovery, single companion HP, bounded lossless ranch migration.');
