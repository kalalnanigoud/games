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
const N = TRACK.length;
// Driving model. Sideways grip limits how fast a car can turn, so the faster it goes the wider it turns:
// cruising (and the computer racers' speeds) take every corner, but a full boost into the circuit's two
// tight ends runs wide onto the grass unless the driver lifts or brakes.
export const CAR = {
  cruise: 215, // the player's top speed without boost
  boostCap: 300, boostPush: 200, // boosting: top speed, and extra acceleration
  drain: 0.34, recharge: 0.11, // boost tank per second (a full tank lasts ~3 s and refills in ~9 s)
  grip: 400, // px/s² of sideways grip
  brake: 280, offroad: 72,
};
// Computer racers' top speeds (Nova, Bolt, Comet). Hard racers are faster than your cruise and boost on
// the straights, so beating them takes boosting well. Racers behind you catch up a little.
export const BOTS = {
  easy: { caps: [146, 150, 155], boost: 0, catchUp: 0.04 },
  normal: { caps: [196, 206, 224], boost: 0, catchUp: 0.05 },
  hard: { caps: [226, 232, 238], boost: 0.55, boostBy: 25, catchUp: 0.05 },
};
// Radius of the centre line at each point, for corner speeds.
const RADIUS = TRACK.map((p, i) => {
  const a = TRACK[(i + N - 4) % N], c = TRACK[(i + 4) % N];
  const ab = Math.hypot(p.x - a.x, p.y - a.y), bc = Math.hypot(c.x - p.x, c.y - p.y), ca = Math.hypot(a.x - c.x, a.y - c.y);
  const area = Math.abs((p.x - a.x) * (c.y - a.y) - (c.x - a.x) * (p.y - a.y)) / 2;
  return area ? ab * bc * ca / (4 * area) : 1e6;
});
// The highest speed at which a car can still brake in time for every corner in the next stretch.
export function safeSpeed(index, margin = 0.92) {
  let v = Infinity;
  for (let k = 0; k < 30; k++) {
    const corner = Math.sqrt(CAR.grip * RADIUS[(index + k) % N] * margin);
    v = Math.min(v, Math.sqrt(corner * corner + 2 * CAR.brake * 0.6 * k * 11.4));
  }
  return v;
}
// A simple driver: follows the road a little ahead. With brake/boost it also lifts for corners and boosts
// when the road ahead allows. Computer racers drive with this; tests drive the player with it too.
export function autopilot(c, { boost = false, brake = false, ahead = 9, gain = 2.5, limit = Infinity } = {}) {
  const near = nearest(c.x, c.y), target = TRACK[(near.index + ahead) % N];
  const steer = clamp(angleDiff(Math.atan2(target.y - c.y, target.x - c.x) - c.angle) * gain, -1, 1);
  const safe = safeSpeed(near.index);
  return { steer, brake: brake && c.speed > Math.min(safe, limit) + 4, boost: boost && c.speed < safe - 25 };
}
export class Race {
  constructor(level = 'normal') {
    this.level = ['easy', 'normal', 'hard'].includes(level) ? level : 'normal';
    this.time = 0; this.countdown = 3; this.result = null; this.paused = false;
    this.cars = ['You', 'Nova', 'Bolt', 'Comet'].map((name, i) => ({ name, x: TRACK[0].x + (i % 2 ? 15 : -15), y: TRACK[0].y - Math.floor(i / 2) * 30, angle: Math.PI / 2, speed: 0, boost: 1, lap: 0, checkpoint: 1, finished: null, offroad: false, index: 0, run: 0 }));
  }
  // Keep elapsed race time at slow display rates while retaining small physics steps.
  // Bound catch-up after a long browser stall; hidden/paused races do not advance.
  advance(dt, input = {}) {
    let remaining = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.25);
    while (remaining > 1e-9) {
      const step = Math.min(remaining, 0.05);
      this.step(step, input);
      remaining -= step;
    }
  }
  // A racer's top speed now: its own, plus a little catch-up while it trails the player.
  botCap(i) {
    const b = BOTS[this.level], me = this.cars[0], c = this.cars[i];
    const gap = me.finished === null ? me.run - c.run : 0;
    return b.caps[i - 1] * (1 + (gap > 8 ? Math.min(b.catchUp, (gap - 8) * 0.002) : 0));
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
      let cap = CAR.cruise, boostCap = CAR.boostCap;
      if (i) {
        const bot = BOTS[this.level];
        cap = this.botCap(i); boostCap = cap + (bot.boostBy || 0);
        // Racers boost only with plenty in the tank, so they never use it as well as a good driver can.
        ({ steer, brake, boost } = autopilot(c, { boost: bot.boost > 0 && c.boost > bot.boost, brake: true }));
      }
      // An emptied tank has to refill a quarter before it boosts again, so tapping can't stretch it out.
      if (c.boost <= 0) c.empty = true; else if (c.boost >= 0.25) c.empty = false;
      const boosting = boost && !c.empty && !brake && !c.offroad;
      c.boost = clamp(c.boost + (boosting ? -CAR.drain : CAR.recharge) * dt, 0, 1);
      const top = c.offroad ? CAR.offroad : boosting ? boostCap : cap;
      c.speed = clamp(c.speed + (brake ? -CAR.brake : 165 - c.speed * 0.36 + (boosting ? CAR.boostPush : 0)) * dt, 0, 340);
      if (c.speed > top) c.speed = Math.max(top, c.speed - (c.offroad ? 420 : 180) * dt); // grass drags hard
      c.angle += steer * Math.min(0.7 + c.speed / 120, CAR.grip / Math.max(1, c.speed)) * dt;
      c.x = clamp(c.x + Math.cos(c.angle) * c.speed * dt, 35, 965);
      c.y = clamp(c.y + Math.sin(c.angle) * c.speed * dt, 35, 645);
      const next = nearest(c.x, c.y), expected = c.checkpoint * 20;
      // Distance round the circuit, for catch-up (never used for laps, which need the checkpoints).
      c.run += ((next.index - near.index + N + N / 2) % N) - N / 2;
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
