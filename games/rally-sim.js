// Pocket Rally physics and ordered checkpoints. No DOM, networking or persistence.
export const TRACK = Array.from({ length: 160 }, (_, i) => {
  const a = i / 160 * Math.PI * 2;
  return { x: 500 + Math.cos(a) * 340, y: 340 + Math.sin(a) * 230 };
});
export const ROAD = 58;
export function nearest(x, y) {
  let index = 0, distance = Infinity;
  for (let i = 0; i < TRACK.length; i++) {
    const p = TRACK[i], d = Math.hypot(x - p.x, y - p.y);
    if (d < distance) { index = i; distance = d; }
  }
  return { index, distance };
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const angleDiff = a => Math.atan2(Math.sin(a), Math.cos(a));
export class Race {
  constructor(level = 'normal') {
    this.level = ['easy', 'normal', 'hard'].includes(level) ? level : 'normal';
    this.time = 0; this.countdown = 3; this.result = null; this.paused = false;
    this.cars = ['You', 'Nova', 'Bolt', 'Comet'].map((name, i) => ({ name, x: TRACK[0].x + (i % 2 ? 15 : -15), y: TRACK[0].y - Math.floor(i / 2) * 30, angle: Math.PI / 2, speed: 0, boost: 1, lap: 0, checkpoint: 1, finished: null, offroad: false, index: 0 }));
  }
  step(dt, input = {}) {
    if (this.paused || this.result) return;
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.05);
    if (this.countdown > 0) { this.countdown = Math.max(0, this.countdown - dt); return; }
    this.time += dt;
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i]; if (c.finished !== null) continue;
      const near = nearest(c.x, c.y); c.index = near.index; c.offroad = near.distance > ROAD - 8;
      let steer = clamp(Number(input.steer) || 0, -1, 1), brake = !!input.brake, boost = !!input.boost;
      const botCap = { easy: 145, normal: 175, hard: 200 }[this.level];
      if (i) {
        const target = TRACK[(near.index + 9) % TRACK.length];
        steer = clamp(angleDiff(Math.atan2(target.y - c.y, target.x - c.x) - c.angle) * 2.5, -1, 1);
        brake = c.speed > botCap + i * 2; boost = false;
      }
      const boosting = boost && c.boost > 0 && !brake && !c.offroad;
      c.boost = clamp(c.boost + (boosting ? -0.42 : 0.16) * dt, 0, 1);
      const cap = c.offroad ? 72 : boosting ? 285 : i ? botCap + i * 2 : 215;
      c.speed = clamp(c.speed + (brake ? -280 : 165 - c.speed * 0.36) * dt, 0, 290);
      if (c.speed > cap) c.speed = Math.max(cap, c.speed - 180 * dt);
      c.angle += steer * (0.7 + c.speed / 120) * dt;
      c.x = clamp(c.x + Math.cos(c.angle) * c.speed * dt, 35, 965);
      c.y = clamp(c.y + Math.sin(c.angle) * c.speed * dt, 35, 645);
      const next = nearest(c.x, c.y), expected = c.checkpoint * 20;
      const delta = Math.abs(next.index - expected);
      if (next.distance < ROAD && Math.min(delta, TRACK.length - delta) < 5) {
        c.checkpoint = (c.checkpoint + 1) % 8;
        if (c.checkpoint === 1) c.lap++;
        if (c.lap >= 3) c.finished = this.time;
      }
    }
    if (this.cars[0].finished !== null) this.result = { time: this.cars[0].finished, place: this.order().indexOf(this.cars[0]) + 1 };
  }
  order() {
    return this.cars.slice().sort((a, b) => {
      if (a.finished !== null || b.finished !== null) return (a.finished ?? Infinity) - (b.finished ?? Infinity);
      const progress = c => c.lap * 160 + ((c.checkpoint + 7) % 8) * 20 + ((c.index - ((c.checkpoint + 7) % 8) * 20 + 160) % 160 < 30 ? (c.index + 160) % 20 : 0);
      return progress(b) - progress(a);
    });
  }
}
