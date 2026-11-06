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
