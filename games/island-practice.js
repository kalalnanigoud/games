// Creature Island practice: a skippable, one-minute training yard before a player's first adventure
// (move, attack, dodge, befriend a training creature). It runs on this device only: nothing is sent to the
// island, nothing is saved, and the world behind it carries on untouched.
import { createArt } from './island-art.js';
import { PLAYER, TICK } from './island-data.js';
import { dirOf, FACE } from './island-sim.js';
import { createInput, bindTouch, touchHTML, actionOf, MOVES, ACTION_BITS, keysFor, openControls } from './island-input.js';
import { suppressed, seen, mark } from '../js/onboarding.js';
import { injectCSS } from '../js/fx.js';
import { esc } from '../js/util.js';
import { sound } from '../js/sound.js';

export const shouldPractice = () => !suppressed() && !seen('island-practice');

const DIRS = ['down', 'up', 'left', 'right'];
const STEPS = 4;
const CSS = `
.isl-practice { position: absolute; inset: 0; z-index: 9; overflow: hidden; background: #3f8a4c; touch-action: none; }
.isl-practice canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.isl-pr-top { position: absolute; left: 10px; right: 10px; top: 10px; display: flex; gap: 8px; align-items: flex-start; pointer-events: none; }
.isl-pr-top > * { pointer-events: auto; }
.isl-pr-say { flex: 1; min-width: 0; padding: 9px 13px 10px; border-radius: 16px; background: rgba(13,20,44,.86); border: 1px solid rgba(255,255,255,.12); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px); }
.isl-pr-say small { display: flex; align-items: center; gap: 5px; font-weight: 800; font-size: .7rem; letter-spacing: .08em; text-transform: uppercase; color: #ffe066; }
.isl-pr-say small i { width: 8px; height: 8px; border-radius: 50%; background: rgba(255,255,255,.25); }
.isl-pr-say small i.on { background: #ffe066; }
.isl-pr-say p { margin: 3px 0 0; font-weight: 700; font-size: .92rem; line-height: 1.35; color: #fff; }
.isl-pr-say p.good { color: #b2f2bb; }
.isl-pr-say kbd { display: inline-block; min-width: 18px; padding: 0 5px; border-radius: 5px; background: rgba(255,255,255,.18); font: 800 .78rem var(--font-body); text-align: center; }
.isl-pr-btns { display: flex; flex-direction: column; gap: 6px; }
.isl-pr-btns button { min-height: 44px; min-width: 76px; background: rgba(13,20,44,.86); border: 1px solid rgba(255,255,255,.18); color: #fff; }
.isl-prdone { position: absolute; inset: 0; display: grid; place-items: center; padding: 16px; background: rgba(8,12,30,.5); z-index: 3; }
.isl-prdone .isl-card { text-align: center; }
.isl-prdone .isl-row { justify-content: center; }
.isl-practice .isl-touch { z-index: 2; }
@media (max-height: 460px) and (orientation: landscape) { .isl-pr-say p { font-size: .84rem; } .isl-pr-say { padding: 6px 11px 7px; } .isl-pr-btns button { min-height: 40px; } }
`;

// opts: { icons, look, finishLabel, onDone(how) } how = 'done' | 'skip'
export function startPractice(root, opts) {
  injectCSS('island-practice', CSS);
  mark('island-practice');
  const IC = opts.icons;
  const el = document.createElement('div');
  el.className = 'isl-practice';
  el.innerHTML = `<canvas aria-hidden="true"></canvas>
    <div class="isl-touch" hidden>${touchHTML(IC)}</div>
    <div class="isl-pr-top"><div class="isl-pr-say" role="status" aria-live="polite"><small></small><p></p></div>
      <div class="isl-pr-btns"><button data-pr="controls" class="small">Controls</button><button data-pr="skip" class="small">Skip</button></div></div>`;
  root.appendChild(el);
  const cv = el.querySelector('canvas'), g = cv.getContext('2d');
  const say = el.querySelector('.isl-pr-say'), sayH = say.querySelector('small'), sayP = say.querySelector('p');
  const inp = createInput({
    onPad: (a) => {
      if (a === 'menu') { finish('skip'); return true; }
      return false;
    },
  });
  bindTouch(inp, el);
  const catchBtn = el.querySelector('.isl-catch');
  catchBtn.innerHTML = `${IC.charm}<span>Befriend</span>`;
  let art = null, res = 0, Z = 1, W = 0, H = 0, dpr = 1, raf = 0, closed = false, last = 0, acc = 0, t = 0;
  let rect = { x0: 0, y0: 0, x1: 0, y1: 0 }; // where explorers can stand, in world units
  const me = { x: 0, y: 0, dir: 0, sT: 0, sCd: 0, dT: 0, dCd: 0, ddx: 0, ddy: 0, moving: false, seed: 0 };
  const floats = [];
  const S = { step: 0, since: 0, msg: '', msgGood: false, rings: [], ok: 0, swings: 0, ring: null, dummy: null, pet: null, done: false, doneAt: 0, props: null };
  const touchMode = () => root.classList.contains('touch') || inp.touchSeen;
  const k = (a) => keysFor(a).map((x) => `<kbd>${esc(x)}</kbd>`).join(' or ');

  function say_(step) {
    const touch = touchMode();
    const text = [
      touch ? 'Drag on the left side of the screen to walk into the glowing ring.' : `Walk into the glowing ring: ${['up', 'left', 'down', 'right'].map((a) => `<kbd>${esc(keysFor(a)[0] || '—')}</kbd>`).join(' ')}, or a controller’s stick.`,
      touch ? 'Tap the red sword button to hit the practice murkling three times.' : `Hit the practice murkling three times: ${k('attack')} or click.`,
      touch ? 'Red rings show where an attack will land. Tap the blue button to roll out of them.' : `Red rings show where an attack will land. Press ${k('dodge')} to roll out of it.`,
      touch ? 'Walk up to the little creature, then tap the gold Befriend button.' : `Walk up to the little creature, then press ${k('catch')} to befriend it.`,
    ][step];
    return text;
  }
  function paintSay() {
    sayH.innerHTML = Array.from({ length: STEPS }, (_, i) => `<i class="${i <= S.step ? 'on' : ''}"></i>`).join('') + `<span>&nbsp;Practice ${Math.min(S.step + 1, STEPS)} of ${STEPS}</span>`;
    sayP.className = S.msgGood ? 'good' : '';
    sayP.innerHTML = S.msg || say_(Math.min(S.step, STEPS - 1));
  }
  const flash = (msg, good = false, ms = 1800) => { S.msg = msg; S.msgGood = good; S.msgAt = t + ms / 1000; paintSay(); };

  /* ---------------- layout ---------------- */
  function resize() {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    dpr = Math.min(2, devicePixelRatio || 1);
    const w = r.width, h = r.height;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    Z = Math.max(0.75, Math.min(2.2, Math.min(w, h) / ((w < 520 ? 10.5 : 12) * 32)));
    W = w / Z; H = h / Z;
    const rr = Math.round(Math.min(2.5, Z * dpr) * 4) / 4;
    if (rr !== res) { res = rr; art = createArt(res); }
    const landscape = w > h, touch = touchMode();
    const top = (landscape ? 84 : 118) / Z, bottom = (touch ? (landscape ? 70 : 230) : 40) / Z;
    rect = { x0: 36 / Z, x1: W - 36 / Z, y0: top, y1: Math.max(top + 90 / Z, H - bottom) };
    if (!S.props) { me.x = (rect.x0 + rect.x1) / 2; me.y = (rect.y0 + rect.y1) / 2; S.since = t; beginStep(0); }
    const pk = W + 'x' + H;
    if (S.pk !== pk) S.props = [['pine', 0.04, 0.5], ['bush', 0.12, 0.92], ['rock', 0.9, 0.58], ['flowers', 0.2, 0.5], ['bush', 0.93, 0.9], ['pine', 0.97, 0.52], ['flowers', 0.78, 0.96], ['rock', 0.45, 0.97]].map(([kind, fx, fy]) => ({ kind, x: fx * W, y: Math.max(top + 24 / Z, fy * H) })).filter((p) => !touch || p.y < rect.y1 + 20 / Z);
    S.pk = pk;
    el.querySelector('.isl-touch').hidden = !touch;
    el.querySelector('[data-pr="controls"]').hidden = touch;
  }
  const spot = (minFrom = 0, from = me) => {
    for (let i = 0; i < 30; i++) {
      const x = rect.x0 + 20 + Math.random() * (rect.x1 - rect.x0 - 40), y = rect.y0 + 20 + Math.random() * (rect.y1 - rect.y0 - 40);
      if (Math.hypot(x - from.x, y - from.y) >= minFrom) return { x, y };
    }
    return { x: rect.x1 - 30, y: rect.y0 + 30 };
  };

  /* ---------------- the four lessons ---------------- */
  function beginStep(n) {
    S.step = n; S.msg = ''; S.msgGood = false; S.since = t;
    if (n === 0) S.ring = spot(Math.min(160, (rect.x1 - rect.x0) * 0.5));
    if (n === 1) S.dummy = { ...spot(110), hp: 3, hurt: 0, kx: 0, ky: 0, gone: 0 };
    if (n === 2) { S.dummy = { ...spot(120), hp: 3, hurt: 0, kx: 0, ky: 0, gone: 0, wind: 0 }; S.rings = []; S.ok = 0; S.nextRing = t + 1.4; S.dodgedSince = false; }
    if (n === 3) { S.dummy = null; S.pet = { ...spot(120), dir: 0, tx: 0, ty: 0, moveAt: 0, happy: 0 }; }
    catchBtn.hidden = n !== 3;
    paintSay();
  }
  function advance() { sound('win'); if (S.step + 1 >= STEPS) { S.done = true; S.doneAt = t; } else beginStep(S.step + 1); }

  function stepMe([ix, iy, bits]) {
    me.sCd = Math.max(0, me.sCd - TICK); me.dCd = Math.max(0, me.dCd - TICK); me.sT = Math.max(0, me.sT - TICK);
    me.swung = false; me.dodged = false;
    let dx = ix / 100, dy = iy / 100;
    const m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; }
    if (bits & ACTION_BITS.dodge && me.dCd <= 0 && me.dT <= 0) {
      const [ex, ey] = m > 0.2 ? [dx, dy] : FACE[me.dir], l = Math.hypot(ex, ey) || 1;
      me.ddx = ex / l; me.ddy = ey / l; me.dT = PLAYER.dodge; me.dCd = PLAYER.dodgeCd; me.dodged = true; sound('flip');
    }
    if (bits & ACTION_BITS.attack && me.sCd <= 0 && me.dT <= 0) { me.sT = 0.2; me.sCd = PLAYER.swing; me.swung = true; sound('place'); }
    let mx, my;
    if (me.dT > 0) { mx = me.ddx * PLAYER.dodgeSpeed * TICK; my = me.ddy * PLAYER.dodgeSpeed * TICK; me.dT = Math.max(0, me.dT - TICK); }
    else { const sp = PLAYER.speed * (me.sT > 0 ? 0.55 : 1); mx = dx * sp * TICK; my = dy * sp * TICK; if (m > 0.15) me.dir = dirOf(dx, dy); }
    me.moving = Math.hypot(mx, my) > 0.4;
    me.x = Math.max(rect.x0, Math.min(rect.x1, me.x + mx)); me.y = Math.max(rect.y0, Math.min(rect.y1, me.y + my));
    S.bits = bits;
  }
  const float = (x, y, text, col = '#fff') => floats.push({ x, y, text, col, t0: t });
  function hitDummy() {
    const d = S.dummy;
    if (!d || d.hp <= 0) return;
    const dist = Math.hypot(d.x - me.x, d.y - me.y), f = FACE[me.dir];
    let da = Math.abs(Math.atan2(d.y - me.y, d.x - me.x) - Math.atan2(f[1], f[0]));
    if (da > Math.PI) da = 2 * Math.PI - da;
    if (dist > PLAYER.reach + 12 || da > PLAYER.arc) return;
    d.hp--; d.hurt = 0.3; d.kx = (d.x - me.x) / (dist || 1) * 160; d.ky = (d.y - me.y) / (dist || 1) * 160;
    float(d.x, d.y - 30, '1', '#ffe066'); sound('card');
    if (d.hp <= 0) { d.gone = 0.6; if (S.step === 1) { flash('Nice swing!', true); setTimeout(() => !closed && advance(), 700); } }
  }
  function tick(inputs) {
    stepMe(inputs);
    const bits = inputs[2];
    if (S.step === 0 && S.ring && Math.hypot(S.ring.x - me.x, S.ring.y - me.y) < 26) { S.ring = null; flash('That’s walking!', true); setTimeout(() => !closed && advance(), 600); }
    if (S.step === 1 && me.swung) hitDummy();
    const d = S.dummy;
    if (d) { d.hurt = Math.max(0, d.hurt - TICK); if (d.gone) d.gone = Math.max(0, d.gone - TICK); d.x = Math.max(rect.x0, Math.min(rect.x1, d.x + d.kx * TICK)); d.y = Math.max(rect.y0, Math.min(rect.y1, d.y + d.ky * TICK)); d.kx *= 0.78; d.ky *= 0.78; }
    if (S.step === 2) {
      if (me.dodged) S.dodgedSince = true;
      if (!S.rings.length && t >= S.nextRing && S.ok < 2) {
        S.rings.push({ x: me.x, y: me.y, r: 58, t0: t, land: t + 1.0 }); S.dodgedSince = false; d.wind = 0.9;
        flash('Incoming! Get out of the red ring.', false, 1100);
      }
      for (const r of S.rings) if (t >= r.land) {
        const inside = Math.hypot(me.x - r.x, me.y - r.y) < r.r - 4;
        r.hit = true; r.t1 = t; sound(inside ? 'bad' : 'chime');
        if (inside) { flash('That one landed (it doesn’t hurt here). Dodge out of the way next time.', false, 2200); float(me.x, me.y - 40, 'Oops', '#ff8787'); }
        else if (S.dodgedSince) { S.ok++; flash(S.ok >= 2 ? 'Perfect dodging!' : 'Dodged it! One more.', true, 1500); float(me.x, me.y - 40, 'Dodged!', '#b2f2bb'); }
        else flash('Safe, but that was a walk. Try the dodge roll.', false, 2200);
      }
      S.rings = S.rings.filter((r) => !r.t1 || t - r.t1 < 0.4);
      if (!S.rings.length && S.ok >= 2 && !S.passed) { S.passed = true; setTimeout(() => !closed && (S.passed = false, advance()), 900); }
      else if (!S.rings.length && S.ok < 2 && !S.rings.some((r) => !r.t1) && S.nextRing <= t) S.nextRing = t + 1.2;
      if (d.wind) d.wind = Math.max(0, d.wind - TICK);
    }
    const p = S.pet;
    if (p && S.step === 3) {
      if (!p.happy && t >= p.moveAt) { const s = spot(0, p); p.tx = s.x; p.ty = s.y; p.moveAt = t + 1.5 + Math.random() * 1.5; }
      if (!p.happy) {
        const dx = p.tx - p.x, dy = p.ty - p.y, l = Math.hypot(dx, dy);
        p.moving = l > 4;
        if (p.moving) { p.x += dx / l * 38 * TICK; p.y += dy / l * 38 * TICK; p.dir = dirOf(dx, dy); }
      }
      if (bits & ACTION_BITS.catch && !p.happy) {
        if (Math.hypot(p.x - me.x, p.y - me.y) < 90) { p.happy = t; sound('win'); flash('Mossip is your friend!', true, 3000); for (let i = 0; i < 4; i++) float(p.x - 18 + i * 12, p.y - 34 - (i % 2) * 8, '♥', '#ff8fa3'); setTimeout(() => !closed && advance(), 1500); }
        else flash('Get a little closer first.', false, 1400);
      }
    }
    if (S.msgAt && t > S.msgAt) { S.msgAt = 0; S.msg = ''; S.msgGood = false; paintSay(); }
  }

  /* ---------------- drawing ---------------- */
  const frame = (n, fps, off = 0) => Math.floor((t + off) * fps) % n;
  function draw() {
    if (!art) return;
    g.setTransform(dpr * Z, 0, 0, dpr * Z, 0, 0);
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, '#6bb85a'); grd.addColorStop(1, '#4a9a4c');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,.045)';
    for (let y = 0; y < H; y += 32) for (let x = ((y / 32) % 2) * 32; x < W; x += 64) g.fillRect(x, y, 32, 32);
    // the yard: a lighter patch of ground where you may walk
    g.fillStyle = 'rgba(214,196,142,.28)';
    g.beginPath(); g.roundRect?.(rect.x0 - 22, rect.y0 - 22, rect.x1 - rect.x0 + 44, rect.y1 - rect.y0 + 44, 28); g.fill();
    if (S.step === 0 && S.ring) {
      const a = 0.55 + 0.35 * Math.sin(t * 5);
      g.strokeStyle = `rgba(255,224,102,${a.toFixed(2)})`; g.lineWidth = 3;
      g.beginPath(); g.ellipse(S.ring.x, S.ring.y, 26, 19, 0, 0, 7); g.stroke();
      g.fillStyle = `rgba(255,224,102,${(a * 0.25).toFixed(2)})`; g.fill();
    }
    for (const r of S.rings) {
      const p = r.t1 ? 1 : Math.min(1, (t - r.t0) / (r.land - r.t0));
      g.fillStyle = `rgba(255,70,70,${r.t1 ? 0.5 * (1 - (t - r.t1) / 0.4) : 0.12 + 0.2 * p})`;
      g.strokeStyle = 'rgba(255,100,100,.85)'; g.lineWidth = 3;
      g.beginPath(); g.ellipse(r.x, r.y, r.r, r.r * 0.72, 0, 0, 7); g.fill(); g.stroke();
      if (!r.t1) { g.beginPath(); g.ellipse(r.x, r.y, r.r * p, r.r * 0.72 * p, 0, 0, 7); g.stroke(); }
    }
    const list = [];
    for (const pr of S.props) list.push({ y: pr.y, f: () => blit(art.prop(pr.kind, 0, 0), pr.x, pr.y) });
    list.push({ y: me.y, f: drawMe });
    const d = S.dummy;
    if (d && !(d.gone === 0 && d.hp <= 0)) list.push({ y: d.y, f: () => drawDummy(d) });
    if (S.pet) list.push({ y: S.pet.y, f: () => drawPet(S.pet) });
    list.sort((a, b) => a.y - b.y).forEach((o) => o.f());
    for (const f of floats) {
      const a = (t - f.t0) / 1.0;
      if (a >= 1) continue;
      g.globalAlpha = 1 - a * a; g.fillStyle = f.col; g.font = '800 15px Nunito, sans-serif'; g.textAlign = 'center';
      g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 3; g.strokeText(f.text, f.x, f.y - a * 24); g.fillText(f.text, f.x, f.y - a * 24);
      g.globalAlpha = 1;
    }
    while (floats.length && t - floats[0].t0 > 1) floats.shift();
  }
  function blit(s, x, y, alpha = 1) {
    if (!s) return;
    if (alpha !== 1) g.globalAlpha = alpha;
    g.drawImage(s.img, x - s.ax, y - s.ay, s.w, s.h);
    g.globalAlpha = 1;
  }
  const shadow = (x, y, rx) => { g.fillStyle = 'rgba(10,20,30,.26)'; g.beginPath(); g.ellipse(x, y, rx, rx * 0.42, 0, 0, 7); g.fill(); };
  function drawMe() {
    shadow(me.x, me.y, 11);
    const anim = me.dT > 0 ? 'dodge' : me.sT > 0 ? 'attack' : me.moving ? 'walk' : 'idle';
    const n = { dodge: 2, attack: 3, walk: 4, idle: 2 }[anim];
    const f = anim === 'attack' ? Math.min(2, Math.floor((0.2 - me.sT) / 0.2 * 3)) : anim === 'walk' ? frame(4, 8) : anim === 'dodge' ? frame(2, 10) : frame(n, 2.2);
    blit(art.player({ ...(opts.look || {}), outfit: 0 }, DIRS[me.dir], anim, f), me.x, me.y);
  }
  function drawDummy(d) {
    shadow(d.x, d.y, 12);
    const alpha = d.hp <= 0 ? d.gone / 0.6 : 1;
    const anim = d.hurt > 0 ? 'hurt' : d.wind > 0 ? 'attack' : 'idle';
    blit(art.murkling(anim, anim === 'idle' ? frame(2, 2.2) : frame(2, 8)), d.x, d.y, alpha);
    if (S.step === 1 && d.hp > 0) { g.fillStyle = 'rgba(5,10,25,.7)'; g.fillRect(d.x - 16, d.y - 46, 32, 5); g.fillStyle = '#b197fc'; g.fillRect(d.x - 16, d.y - 46, 32 * d.hp / 3, 5); }
  }
  function drawPet(p) {
    shadow(p.x, p.y, 12);
    if (!p.happy) { g.strokeStyle = `rgba(255,212,59,${(0.45 + 0.35 * Math.sin(t * 5)).toFixed(2)})`; g.lineWidth = 2.5; g.beginPath(); g.ellipse(p.x, p.y, 19, 9, 0, 0, 7); g.stroke(); }
    const hop = p.happy ? Math.abs(Math.sin(t * 9)) * 7 : 0;
    blit(art.creature('mossip', DIRS[p.dir], p.moving ? 'walk' : 'idle', p.moving ? frame(4, 9) : frame(2, 2.2)), p.x, p.y - hop);
  }

  /* ---------------- the loop and the exits ---------------- */
  function loop() {
    raf = 0;
    if (closed) return;
    if (!root.isConnected) return close();
    const now = performance.now() / 1000, dt = Math.min(0.25, now - (last || now));
    last = now; t += dt; acc += dt;
    resize();
    let n = 0;
    while (acc >= TICK && n++ < 5) { acc -= TICK; if (!S.done) tick(inp.sample()); else inp.sample(); }
    if (acc > TICK) acc = 0;
    if (S.done && !el.querySelector('.isl-prdone') && t - S.doneAt > 0.7) showDone();
    try { draw(); } catch (e) { if (!S.err) { S.err = 1; console.error(e); } }
    raf = requestAnimationFrame(loop);
  }
  function showDone() {
    const box = document.createElement('div');
    box.className = 'isl-prdone';
    box.innerHTML = `<div class="isl-card"><h2>You’re ready!</h2><p class="muted">Walk, swing, roll and befriend: that’s Creature Island. You can replay this practice, or change your keys, from the bag’s Guide tab.</p><div class="isl-row"><button class="primary" data-pr="done">${esc(opts.finishLabel || 'Start the adventure')}</button></div></div>`;
    el.appendChild(box);
    box.querySelector('button').focus({ preventScroll: true });
    el.querySelector('.isl-pr-btns').hidden = true;
  }
  function onKey(e) {
    if (closed) return;
    if (e.type === 'keyup') { inp.release(e.code); return; }
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) || document.querySelector('.modal-bg')) return;
    if (e.code === 'Escape') return finish('skip');
    if ((e.code === 'Enter' || e.code === 'Space') && t?.closest?.('button')) return;
    const a = actionOf(e.code);
    if (MOVES.has(a)) { inp.keys.add(a); e.preventDefault(); }
    else if (ACTION_BITS[a]) { inp.bits |= ACTION_BITS[a]; e.preventDefault(); }
  }
  function close() {
    if (closed) return;
    closed = true;
    if (raf) cancelAnimationFrame(raf);
    removeEventListener('keydown', onKey); removeEventListener('keyup', onKey); removeEventListener('blur', blur);
    inp.destroy(); el.remove();
  }
  const blur = () => inp.clear();
  function finish(how) { if (closed) return; close(); opts.onDone?.(how); }
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pr]');
    if (!b) return;
    if (b.dataset.pr === 'skip') finish('skip');
    else if (b.dataset.pr === 'done') finish('done');
    else if (b.dataset.pr === 'controls') { b.blur(); openControls(el); }
  });
  cv.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse' && e.button === 0) inp.bits |= ACTION_BITS.attack; });
  addEventListener('keydown', onKey); addEventListener('keyup', onKey); addEventListener('blur', blur);
  paintSay();
  raf = requestAnimationFrame(loop);
  el.tabIndex = -1;
  document.activeElement?.blur?.(); // a focused button behind this must not catch Space or Enter
  el._p = { close, state: S, me, inp }; // for the browser tests
  return el._p;
}
