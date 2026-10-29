// Animation toolkit shared by all games.
//
// 1. FLIP: give an element data-k="unique-key". When the game re-renders and
//    the same key appears somewhere else, it glides from the old spot to the
//    new one. New keys pop in.
//    (SVG: put data-k on an element WITHOUT a transform="" attribute; position
//    it with x/y/cx/cy, or wrap it in an outer <g transform> without data-k.)
//
// 2. Effects: in act(), call addFx(state, {...}) to queue a visual effect that
//    every player sees once, e.g. a gem flying from the bank to a player:
//      addFx(s, { from: 'bank-red', to: 'p-' + pid + '-gems', html: gemHTML('red'), n: 2, sound: 'gem' })
//    from/to name elements marked data-a="bank-red" etc. Other kinds:
//      { kind: 'float', at: 'anchor', text: '+3', color: '#ffd76a' }   rising text
//      { kind: 'shake', at: 'anchor' }                                  wobble
//      { kind: 'pulse', at: 'anchor' }                                  bump
//      { kind: 'sound', sound: 'dice' }
//      { kind: 'confetti' }
//    Optional on any: delay (ms), sound, duration.
//
// 3. Helpers: dieHTML(), rollDice(), confetti(), changed(), injectCSS().

import { sound } from './sound.js';

const EASE = 'cubic-bezier(.2,.8,.2,1)';
const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export { addFx } from './util.js';

export function snapshot(root) {
  const m = new Map();
  root.querySelectorAll('[data-k],[data-a]').forEach((el) => {
    const rect = el.getBoundingClientRect();
    if (el.dataset.k) m.set('k:' + el.dataset.k, { rect, el });
    if (el.dataset.a) m.set('a:' + el.dataset.a, { rect, el });
  });
  return m;
}

function svgScale(el) {
  const ctm = el.ownerSVGElement?.getScreenCTM?.() || el.getScreenCTM?.();
  return ctm ? [ctm.a || 1, ctm.d || 1] : [1, 1];
}

export function flip(root, before) {
  if (!before || !before.size || reduced) return;
  root.querySelectorAll('[data-k]').forEach((el) => {
    const b = before.get('k:' + el.dataset.k);
    if (b) {
      const r = el.getBoundingClientRect();
      let dx = b.rect.left + b.rect.width / 2 - (r.left + r.width / 2);
      let dy = b.rect.top + b.rect.height / 2 - (r.top + r.height / 2);
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      let restore = null;
      if (el instanceof SVGElement) {
        const [sx, sy] = svgScale(el);
        dx /= sx; dy /= sy;
      } else {
        // Lift gliding HTML pieces above neighbouring containers.
        const prev = [el.style.position, el.style.zIndex];
        if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
        el.style.zIndex = '60';
        restore = () => { [el.style.position, el.style.zIndex] = prev; };
      }
      const a = el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], { duration: 560, easing: EASE });
      if (restore) a.onfinish = a.oncancel = restore;
    } else if (!('noenter' in el.dataset)) {
      el.animate(
        [{ opacity: 0, transform: 'scale(0.4)' }, { opacity: 1, transform: 'scale(1)' }],
        { duration: 420, easing: 'cubic-bezier(.3,1.5,.5,1)', delay: 80 + Math.random() * 120, fill: 'backwards' }
      );
    }
  });
}

const find = (root, name) => root.querySelector(`[data-a="${CSS.escape(name)}"]`) || root.querySelector(`[data-k="${CSS.escape(name)}"]`);
const rectOf = (root, before, name, preferBefore) => {
  const old = before?.get('a:' + name) || before?.get('k:' + name);
  const now = find(root, name);
  if (preferBefore && old) return old.rect;
  if (now) return now.getBoundingClientRect();
  return old?.rect || null;
};

export function fly(fromRect, toRect, html, { duration = 750, delay = 0, size = null, arc = 70, onEnd } = {}) {
  if (!fromRect || !toRect) return;
  const g = document.createElement('div');
  g.className = 'fx-ghost';
  g.innerHTML = html;
  const w = size ? size[0] : Math.max(18, fromRect.width);
  const h = size ? size[1] : Math.max(18, fromRect.height);
  g.style.width = w + 'px';
  g.style.height = h + 'px';
  document.body.appendChild(g);
  const x0 = fromRect.left + fromRect.width / 2 - w / 2, y0 = fromRect.top + fromRect.height / 2 - h / 2;
  const x1 = toRect.left + toRect.width / 2 - w / 2, y1 = toRect.top + toRect.height / 2 - h / 2;
  const endScale = Math.max(0.35, Math.min(1, Math.min(toRect.width / w, toRect.height / h)));
  const mx = (x0 + x1) / 2, my = Math.min(y0, y1) - arc;
  const a = g.animate(
    [
      { transform: `translate(${x0}px, ${y0}px) scale(.9)`, opacity: 0 },
      { transform: `translate(${x0}px, ${y0 - 8}px) scale(1.15)`, opacity: 1, offset: 0.12 },
      { transform: `translate(${mx}px, ${my}px) scale(1.12) rotate(8deg)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${x1}px, ${y1}px) scale(${endScale})`, opacity: 1, offset: 0.9 },
      { transform: `translate(${x1}px, ${y1}px) scale(${endScale * 0.8})`, opacity: 0 },
    ],
    { duration: reduced ? 1 : duration, delay, easing: 'cubic-bezier(.45,.05,.35,1)', fill: 'both' }
  );
  a.onfinish = () => { g.remove(); onEnd?.(); };
}

export function pulse(el) {
  el?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 320, easing: 'ease-out' });
}
export function shake(el) {
  el?.animate(
    [0, -8, 8, -6, 6, -3, 0].map((x) => ({ transform: `translateX(${x}px)` })),
    { duration: 420, easing: 'ease-out' }
  );
}
export function floatText(rect, text, color = '#ffd76a', delay = 0) {
  if (!rect) return;
  const d = document.createElement('div');
  d.className = 'fx-float';
  d.textContent = text;
  d.style.color = color;
  d.style.left = rect.left + rect.width / 2 + 'px';
  d.style.top = rect.top + rect.height / 2 + 'px';
  document.body.appendChild(d);
  d.animate(
    [
      { transform: 'translate(-50%, -50%) scale(.6)', opacity: 0 },
      { transform: 'translate(-50%, -80%) scale(1.15)', opacity: 1, offset: 0.2 },
      { transform: 'translate(-50%, -260%) scale(1)', opacity: 0 },
    ],
    { duration: 1400, delay, easing: 'ease-out', fill: 'both' }
  ).onfinish = () => d.remove();
}

// Play effects with seq greater than lastSeq. Returns the new lastSeq.
export function playFx(root, before, list, lastSeq) {
  if (!list || !list.length) return 0; // fresh game: play everything from the first move
  const max = Math.max(...list.map((f) => f.seq));
  if (lastSeq == null || max < lastSeq) return max; // first view, or new game
  const fresh = list.filter((f) => f.seq > lastSeq);
  let auto = 0;
  for (const f of fresh) {
    const delay = f.delay ?? auto;
    auto = delay + 140;
    const kind = f.kind || 'fly';
    if (kind === 'fly') {
      const from = rectOf(root, before, f.from, true);
      const to = rectOf(root, before, f.to, false);
      const html = f.html || (before?.get('a:' + f.from) || before?.get('k:' + f.from))?.el?.outerHTML || '<div></div>';
      const n = Math.min(f.n || 1, 8);
      for (let i = 0; i < n; i++) {
        const d = delay + i * 110;
        setTimeout(() => f.sound && sound(f.sound), d);
        fly(from, to, html, { delay: d, size: f.size, duration: f.duration, onEnd: () => pulse(find(root, f.to)) });
      }
      auto = delay + n * 110 + 100;
    } else if (kind === 'float') {
      setTimeout(() => { floatText(rectOf(root, before, f.at, false), f.text, f.color); f.sound && sound(f.sound); }, delay);
    } else if (kind === 'shake') {
      setTimeout(() => { shake(find(root, f.at)); f.sound && sound(f.sound); }, delay);
    } else if (kind === 'pulse') {
      setTimeout(() => { pulse(find(root, f.at)); f.sound && sound(f.sound); }, delay);
    } else if (kind === 'sound') {
      setTimeout(() => sound(f.sound), delay);
    } else if (kind === 'confetti') {
      setTimeout(confetti, delay);
    }
  }
  return max;
}

/* ---------- 3D dice ---------- */
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const FACE_ROT = { 1: 'rotateX(0deg) rotateY(0deg)', 6: 'rotateY(180deg)', 3: 'rotateY(-90deg)', 4: 'rotateY(90deg)', 2: 'rotateX(-90deg)', 5: 'rotateX(90deg)' };

export function dieHTML(value = 1, size = 48) {
  const faces = [1, 2, 3, 4, 5, 6]
    .map((v) => `<div class="face f${v}">${Array.from({ length: 9 }, (_, i) => `<span${PIPS[v].includes(i) ? ' class="pip"' : ''}></span>`).join('')}</div>`)
    .join('');
  return `<div class="die3d" style="--die:${size}px"><div class="cube" data-v="${value}" style="transform:${FACE_ROT[value] || FACE_ROT[1]}">${faces}</div></div>`;
}

// Tumble every .die3d inside el and land on its current value.
export function rollDice(el, withSound = true) {
  if (withSound) sound('dice');
  el.querySelectorAll('.die3d').forEach((die, i) => {
    const cube = die.querySelector('.cube');
    const end = FACE_ROT[cube.dataset.v] || FACE_ROT[1];
    const rx = 720 + Math.floor(Math.random() * 3) * 360, ry = 360 + Math.floor(Math.random() * 3) * 360;
    cube.animate(
      [{ transform: `rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${90 * i}deg)` }, { transform: end }],
      { duration: reduced ? 1 : 1000 + i * 120, easing: 'cubic-bezier(.15,.85,.25,1)' }
    );
    die.animate(
      [
        { transform: 'rotateX(-20deg) rotateY(25deg) translateY(-60px)' },
        { transform: 'rotateX(-20deg) rotateY(25deg) translateY(0)', offset: 0.45 },
        { transform: 'rotateX(-20deg) rotateY(25deg) translateY(-16px)', offset: 0.65 },
        { transform: 'rotateX(-20deg) rotateY(25deg) translateY(0)' },
      ],
      { duration: reduced ? 1 : 1000 + i * 120, easing: 'ease-out' }
    );
  });
}

/* ---------- confetti ---------- */
export function confetti(duration = 3200) {
  if (reduced) return;
  const c = document.createElement('canvas');
  c.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:140';
  document.body.appendChild(c);
  const dpr = Math.min(2, devicePixelRatio || 1);
  c.width = innerWidth * dpr;
  c.height = innerHeight * dpr;
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  const colors = ['#f2c14e', '#ffe9a8', '#e0523f', '#3fa36b', '#3d7fd9', '#f6ead2', '#b05cd6'];
  const parts = Array.from({ length: 170 }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 120, y: innerHeight * 0.35,
    vx: (Math.random() - 0.5) * 16, vy: -Math.random() * 16 - 4,
    w: 6 + Math.random() * 7, h: 8 + Math.random() * 10, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
    c: colors[Math.floor(Math.random() * colors.length)],
  }));
  const t0 = performance.now();
  (function frame(t) {
    const el = t - t0;
    g.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += 0.38; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.r);
      g.globalAlpha = Math.max(0, 1 - el / duration);
      g.fillStyle = p.c;
      g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)));
      g.restore();
    }
    if (el < duration) requestAnimationFrame(frame);
    else c.remove();
  })(t0);
}

/* ---------- misc ---------- */
const seen = new Map();
// True when value differs from the last one seen for key (false on first sight).
export function changed(key, value) {
  const had = seen.has(key);
  const prev = seen.get(key);
  seen.set(key, value);
  return had && prev !== value;
}

const injected = new Set();
export function injectCSS(id, css) {
  if (injected.has(id)) return;
  injected.add(id);
  const s = document.createElement('style');
  s.dataset.game = id;
  s.textContent = css;
  document.head.appendChild(s);
}
