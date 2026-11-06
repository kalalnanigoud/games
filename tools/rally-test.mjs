import assert from 'node:assert/strict';
import { Race, TRACK } from '../games/rally-sim.js';
import { debug } from '../games/rally.js';
for (const fps of [4, 10, 60]) {
  const clock = new Race();
  for (let i = 0; i < fps * 4; i++) clock.advance(1 / fps, { brake: true });
  assert.equal(clock.countdown, 0, fps + ' fps: countdown completes in real elapsed time');
  assert.ok(clock.time > 0.9 && clock.time <= 1.01, fps + ' fps: race clock stays near one second');
  clock.paused = true; const before = clock.time;
  clock.advance(0.25); assert.equal(clock.time, before, 'paused time never catches up');
}
const stalled = new Race(); stalled.countdown = 0; stalled.advance(30, { brake: true });
assert.ok(stalled.time <= 0.251, 'long stalls have bounded catch-up');
const r = new Race();
r.step(0.05); assert.equal(r.time, 0, 'countdown blocks driving');
r.countdown = 0;
const p = r.cars[0], start = p.y;
for (let i = 0; i < 20; i++) r.step(0.05);
assert.ok(p.y > start, 'car accelerates');
const boost = p.boost;
r.step(0.05, { boost: true }); assert.ok(p.boost < boost);
const v = p.speed;
r.step(0.05, { brake: true }); assert.ok(p.speed < v);
r.paused = true; const snapshot = JSON.stringify(r.cars);
r.step(0.05, { steer: 1 }); assert.equal(JSON.stringify(r.cars), snapshot);
r.paused = false;
// Jumping directly across the finish line cannot complete a lap.
p.x = TRACK[0].x; p.y = TRACK[0].y; p.speed = 0;
r.step(0); assert.equal(p.lap, 0);
for (let lap = 0; lap < 3; lap++) for (const checkpoint of [1,2,3,4,5,6,7,0]) {
  Object.assign(p, TRACK[checkpoint * 20], { speed: 0 }); r.step(0);
}
assert.equal(p.lap, 3); assert.ok(r.result); assert.equal(r.result.place, 1);
const times = {};
for (const level of ['easy', 'normal', 'hard']) {
  const race = new Race(level); race.countdown = 0;
  for (let i = 0; i < 5000 && race.cars.some((c, n) => n && c.finished === null); i++) race.step(0.05, { brake: true });
  assert.ok(race.cars.slice(1).every(c => c.finished !== null), `${level}: all computer cars can finish`);
  times[level] = race.cars[1].finished;
}
assert.ok(times.hard < times.normal && times.normal < times.easy, 'computer difficulty changes completion time');
console.log('Rally physics, boost/brake, pause, ordered checkpoints, finish and racer difficulty passed.', times);
// Space boosts mid-race even when an on-screen control kept focus after a click; otherwise it presses the button.
const el = (...inside) => ({ closest: sel => sel.split(',').some(s => inside.includes(s.trim())) || null });
const pauseBtn = el('button', '.rally-controls'), resumeBtn = el('button', '.rally-message');
assert.equal(debug.spaceForButton(pauseBtn, true), false, 'focused Pause does not swallow Space while racing');
assert.equal(debug.spaceForButton(pauseBtn, false), true, 'paused: Space presses the focused Resume control');
assert.equal(debug.spaceForButton(resumeBtn, false), true, 'paused/finished message buttons stay keyboard-operable');
assert.equal(debug.spaceForButton(el('button'), true), true, 'other page buttons keep Space');
assert.equal(debug.spaceForButton(el(), true), false); assert.equal(debug.spaceForButton(null, true), false);
console.log('Rally Space-on-focused-button checks passed.');

// Balance, with the deterministic sim: the player is driven by the same autopilot the computer racers use.
{
  const { autopilot, CAR, BOTS } = await import('../games/rally-sim.js');
  const drive = (level, driver) => {
    const race = new Race(level); race.countdown = 0; let off = 0;
    for (let i = 0; i < 4000 && !race.result; i++) { race.step(0.05, driver(race.cars[0])); off += race.cars[0].offroad; }
    return { ...race.result, off };
  };
  // A simple driver: follows the road, never boosts or brakes (a few steering styles).
  const simple = [[9, 2.5], [7, 3], [12, 2]].map(([ahead, gain]) => c => ({ ...autopilot(c, { ahead, gain }), boost: false, brake: false }));
  const good = c => autopilot(c, { boost: true, brake: true });
  for (const d of simple) {
    assert.equal(drive('easy', d).place, 1, 'a never-boost driver beats Easy');
    assert.equal(drive('normal', d).place, 2, 'and places 2nd on Normal');
  }
  assert.ok(simple.filter(d => drive('hard', d).place >= 3).length >= 2, 'and usually loses on Hard');
  for (const level of ['easy', 'normal', 'hard']) assert.equal(drive(level, good).place, 1, `a good driver using boost wins ${level}`);
  assert.ok(BOTS.hard.caps.every(v => v > CAR.cruise) && BOTS.hard.boost > 0, 'Hard racers are faster than your cruise and boost');
  assert.ok(drive('hard', simple[0]).time - drive('hard', good).time > 2.5, 'boosting well is worth seconds, not tenths');
  // Holding boost into the tight ends runs wide onto the grass; lifting for them is faster.
  const hold = drive('hard', c => ({ ...autopilot(c), boost: true, brake: false }));
  assert.ok(hold.off > 0 && hold.time > drive('hard', good).time, 'the tightest corner needs a lift at full boost');
  // Racers behind you catch up a little; racers ahead don't.
  const race = new Race('normal'); race.countdown = 0;
  race.cars[0].run = 40; assert.ok(race.botCap(1) > BOTS.normal.caps[0] && race.botCap(1) <= BOTS.normal.caps[0] * (1 + BOTS.normal.catchUp) + 1e-9, 'mild catch-up');
  race.cars[0].run = -40; assert.equal(race.botCap(1), BOTS.normal.caps[0]);
  // An emptied tank has to refill before boosting again, so tapping can't stretch it.
  const tap = new Race(); tap.countdown = 0; const me = tap.cars[0];
  Object.assign(me, { boost: 0.01, empty: false });
  tap.step(0.05, { boost: true }); tap.step(0.05, { boost: true }); assert.ok(me.empty);
  const b = me.boost; tap.step(0.05, { boost: true }); assert.ok(me.boost > b, 'an empty tank refills even while Boost is held');
  console.log('Rally balance passed: never-boost driver 1st on Easy, 2nd on Normal, loses on Hard; a good driver wins Hard; full boost needs a lift.');
}
