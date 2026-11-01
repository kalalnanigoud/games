// Creature Island controls: the keymap (remappable, kept on this device as a preference, never in a save),
// keyboard, gamepad and touch input for the explorer, and the Controls panel. island-client.js and the
// practice scene both read the explorer's input from here.
import { BITS } from './island-sim.js';
import { TICK } from './island-data.js';
import { injectCSS } from '../js/fx.js';
import { openModal, closeModal } from '../js/dialog.js';
import { esc, toast } from '../js/util.js';
import { icon } from '../js/icons.js';

const PREF = 'gn-island-keys';
export const ACTIONS = [['up', 'Move up'], ['down', 'Move down'], ['left', 'Move left'], ['right', 'Move right'], ['attack', 'Attack'], ['dodge', 'Dodge'], ['ability', 'Companion move'], ['interact', 'Talk or gather'], ['catch', 'Befriend'], ['menu', 'Bag and menu']];
const DEFAULTS = { up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'], attack: ['KeyJ', 'Space'], dodge: ['KeyK', 'ShiftLeft'], ability: ['KeyL', 'KeyQ'], interact: ['KeyE', 'Enter'], catch: ['KeyC', null], menu: ['KeyB', 'KeyI'] };
export const MOVES = new Set(['up', 'down', 'left', 'right']);
export const ACTION_BITS = { attack: BITS.attack, dodge: BITS.dodge, ability: BITS.ability, interact: BITS.interact, catch: BITS.catch };
const RESERVED = (c) => c === 'Escape' || c === 'Tab' || c === 'KeyM' || /^(Digit[1-3]|F\d+)$/.test(c);
const norm = (c) => (c === 'ShiftRight' ? 'ShiftLeft' : c === 'NumpadEnter' ? 'Enter' : c);

let binds = null, map = null;
const listeners = new Set();
export function keyBinds() {
  if (binds) return binds;
  binds = JSON.parse(JSON.stringify(DEFAULTS));
  try {
    const s = JSON.parse(localStorage.getItem(PREF) || 'null');
    if (s && typeof s === 'object') for (const [a, ks] of Object.entries(s)) if (DEFAULTS[a] && Array.isArray(ks)) binds[a] = [0, 1].map((i) => (typeof ks[i] === 'string' && ks[i].length < 24 && !RESERVED(ks[i]) ? ks[i] : null));
  } catch {}
  return binds;
}
function changed() {
  map = null;
  try {
    if (JSON.stringify(binds) === JSON.stringify(DEFAULTS)) localStorage.removeItem(PREF); else localStorage.setItem(PREF, JSON.stringify(binds));
  } catch {}
  for (const f of listeners) f();
}
// Gives one key to an action's slot (0 or 1); any other action that had the key lets go of it.
export function setKey(action, slot, code) {
  code = norm(code);
  const b = keyBinds();
  for (const a of Object.keys(b)) b[a] = b[a].map((k) => (k === code ? null : k));
  b[action][slot] = code;
  changed();
}
export function resetKeys() { binds = JSON.parse(JSON.stringify(DEFAULTS)); changed(); }
export const actionOf = (code) => (map ||= (() => { const m = {}; for (const [a, ks] of Object.entries(keyBinds())) for (const k of ks) if (k) m[k] ||= a; return m; })())[norm(code)] || null;
export const keyLabel = (code) => (!code ? '—' : /^Key[A-Z]$/.test(code) ? code.slice(3) : /^Digit\d$/.test(code) ? code.slice(5) : { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'Space', ShiftLeft: 'Shift', ControlLeft: 'Ctrl', ControlRight: 'Ctrl', AltLeft: 'Alt', AltRight: 'Alt', Enter: 'Enter', Backspace: 'Backspace', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: '’' }[code] || code.replace(/^(Numpad|Bracket)/, '$1 '));
export const keysFor = (action) => keyBinds()[action].filter(Boolean).map(keyLabel);

/* ---------------- gamepad ---------------- */
// Standard layout: stick or d-pad moves; A attack, B dodge, X talk/gather, Y befriend, bumpers companion move, Start menu.
const PAD = { 0: 'attack', 7: 'attack', 1: 'dodge', 2: 'interact', 3: 'catch', 4: 'ability', 5: 'ability', 9: 'menu' };
const DEAD = 0.28;
function readPad() {
  let gp = null;
  try { gp = [...(navigator.getGamepads?.() || [])].find((p) => p && p.connected !== false); } catch {}
  if (!gp) return null;
  const on = (i) => { const b = gp.buttons?.[i]; return !!b && (b.pressed || b.value > 0.5); };
  let x = gp.axes?.[0] || 0, y = gp.axes?.[1] || 0;
  const m = Math.hypot(x, y);
  if (m < DEAD) x = y = 0; else { const k = Math.min(1, (m - DEAD) / (1 - DEAD)) / m; x *= k; y *= k; }
  if (on(14)) x = -1; if (on(15)) x = 1; if (on(12)) y = -1; if (on(13)) y = 1;
  const held = new Set();
  for (const [i, a] of Object.entries(PAD)) if (on(+i)) held.add(a);
  return { x, y, held };
}

/* ---------------- one explorer's input ---------------- */
// hooks.onPad(action) -> true when the screen used the press itself (closing a window, advancing a conversation),
// so it doesn't also reach the world.
export function createInput(hooks = {}) {
  const inp = { keys: new Set(), bits: 0, joy: null, touchSeen: false, padHeld: new Set(), padAt: {} };
  const resets = new Set(), cleanups = new Set();
  const clear = () => inp.clear();
  listeners.add(clear);
  const onPadOn = () => { try { toast('Controller connected.', 'info'); } catch {} };
  addEventListener('gamepadconnected', onPadOn);
  // A key held and let go between two frames (a slow device, a stalled first frame) still walks as long as it was held.
  const since = {}, credit = {}, draining = {};
  inp.hold = (a) => { if (!inp.keys.has(a)) { inp.keys.add(a); since[a] = performance.now(); } };
  inp.clear = () => { inp.keys.clear(); for (const a of MOVES) { credit[a] = 0; draining[a] = false; } inp.bits = 0; if (inp.joy) { inp.joy.on = false; inp.joy.dx = inp.joy.dy = 0; } for (const reset of resets) reset(); };
  inp.onClear = (fn) => resets.add(fn);
  inp.onDestroy = (fn) => cleanups.add(fn);
  const visibility = () => { if (document.hidden) clear(); };
  addEventListener('blur', clear);
  document.addEventListener('visibilitychange', visibility);
  document.addEventListener('gn-input-suspend', clear);
  inp.release = (code) => { const a = actionOf(code); if (MOVES.has(a)) { if (inp.keys.delete(a)) credit[a] = Math.min(0.75, (credit[a] || 0) + (performance.now() - (since[a] || 0)) / 1000); return true; } return false; };
  inp.destroy = () => { clear(); for (const cleanup of cleanups) cleanup(); resets.clear(); cleanups.clear(); listeners.delete(clear); removeEventListener('gamepadconnected', onPadOn); removeEventListener('blur', clear); document.removeEventListener('visibilitychange', visibility); document.removeEventListener('gn-input-suspend', clear); };
  // Where the explorer is headed, and what was pressed since the last look: [dx, dy, bits] (-100 to 100).
  inp.sample = () => {
    if (document.hidden || document.querySelector('.modal-bg, .gh-sheet')) { clear(); return [0, 0, 0]; }
    let dx = 0, dy = 0;
    const pad = readPad(), now = performance.now();
    if (inp.joy?.on) { dx = inp.joy.dx; dy = inp.joy.dy; }
    else {
      // Held time not yet seen by a step counts only when frames fell well behind (over two steps), so normal play is unchanged.
      const on = (a) => {
        if (inp.keys.has(a)) { since[a] = now; return true; }
        if (!draining[a]) { if ((credit[a] || 0) >= 2 * TICK) draining[a] = true; else credit[a] = 0; } // small leftovers never add up into a step
        if (!draining[a]) return false;
        credit[a] -= TICK;
        if (credit[a] <= 0) { credit[a] = 0; draining[a] = false; }
        return true;
      };
      if (on('left')) dx -= 100;
      if (on('right')) dx += 100;
      if (on('up')) dy -= 100;
      if (on('down')) dy += 100;
      if (dx && dy) { dx *= 0.7071; dy *= 0.7071; }
      if (!dx && !dy && pad) { dx = pad.x * 100; dy = pad.y * 100; }
    }
    const held = pad?.held || new Set();
    for (const a of held) {
      const fresh = !inp.padHeld.has(a);
      if (fresh) inp.padAt[a] = now;
      else if (a !== 'attack' || now - inp.padAt[a] < 360) continue;
      else inp.padAt[a] = now;
      if (fresh && hooks.onPad?.(a)) continue;
      if (ACTION_BITS[a]) inp.bits |= ACTION_BITS[a];
    }
    inp.padHeld = held;
    const bits = inp.bits;
    inp.bits = 0;
    return [Math.round(dx), Math.round(dy), bits];
  };
  return inp;
}

/* ---------------- touch: a stick under the left thumb, buttons under the right ---------------- */
export const touchHTML = (IC) => `<div class="isl-stickzone"><div class="isl-stick"><i></i></div></div>
        <div class="isl-pad">
          <button class="isl-btn isl-attack" aria-label="Attack">${IC.sword}</button>
          <button class="isl-btn isl-dodge" aria-label="Dodge">${IC.dodge}</button>
          <button class="isl-btn isl-ability" aria-label="Companion ability">${IC.paw}<svg class="isl-cd" viewBox="0 0 36 36"><circle cx="18" cy="18" r="16"/></svg></button>
          <button class="isl-btn isl-act" hidden></button>
          <button class="isl-btn isl-catch" hidden></button>
        </div>`;
export function bindTouch(inp, scope) {
  const q = (s) => scope.querySelector(s);
  const zone = q('.isl-stickzone'), stick = q('.isl-stick'), knob = stick.querySelector('i');
  inp.onClear(() => { knob.style.transform = ''; stick.classList.remove('on'); });
  zone.addEventListener('pointerdown', (e) => {
    inp.touchSeen = true;
    const r = zone.getBoundingClientRect();
    inp.joy = { on: true, id: e.pointerId, ox: e.clientX, oy: e.clientY, dx: 0, dy: 0 };
    stick.style.left = (e.clientX - r.left) + 'px'; stick.style.top = (e.clientY - r.top) + 'px';
    stick.classList.add('on');
    zone.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });
  zone.addEventListener('pointermove', (e) => {
    if (!inp.joy?.on || e.pointerId !== inp.joy.id) return;
    let dx = e.clientX - inp.joy.ox, dy = e.clientY - inp.joy.oy;
    const d = Math.hypot(dx, dy), max = 46;
    if (d > max) { dx *= max / d; dy *= max / d; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const k = d < 8 ? 0 : 100 / max;
    inp.joy.dx = dx * k; inp.joy.dy = dy * k;
  });
  const end = (e) => { if (inp.joy && e.pointerId === inp.joy.id) { inp.joy.on = false; inp.joy.dx = inp.joy.dy = 0; knob.style.transform = ''; stick.classList.remove('on'); } };
  zone.addEventListener('pointerup', end); zone.addEventListener('pointercancel', end);
  const press = (sel, bit, repeat = 0) => {
    const b = q(sel);
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault(); inp.touchSeen = true;
      inp.bits |= bit;
      b.classList.add('down');
      if (repeat) { clearInterval(b._rep); b._rep = setInterval(() => (inp.bits |= bit), repeat); }
      if (navigator.userActivation?.hasBeenActive) try { navigator.vibrate?.(8); } catch {}
    });
    const up = () => { b.classList.remove('down'); clearInterval(b._rep); b._rep = null; };
    inp.onClear(up);
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
  };
  press('.isl-attack', BITS.attack, 360);
  press('.isl-dodge', BITS.dodge);
  press('.isl-ability', BITS.ability);
  press('.isl-act', BITS.interact);
  press('.isl-catch', BITS.catch);
}

/* ---------------- the Controls panel ---------------- */
const CSS = `
.ctl-rows { display: grid; gap: 6px; margin: 10px 0; }
.ctl-row { display: grid; grid-template-columns: 1fr 92px 92px; gap: 6px; align-items: center; }
.ctl-row > span { font-weight: 800; font-size: .92rem; }
.ctl-key { min-height: 40px; padding: 0 8px; font-weight: 800; font-size: .88rem; }
.ctl-key.listening { outline: 2px solid var(--accent, #7c6cff); outline-offset: 1px; }
.ctl-note { margin: 6px 0 0; font-size: .82rem; }
.ctl-foot { display: flex; gap: 8px; flex-wrap: wrap; }
.ctl-foot .grow { flex: 1; }
.ctl-foot .help-ok { width: auto; min-width: 96px; }
@media (max-width: 420px) { .ctl-row { grid-template-columns: 1fr 78px 78px; } }
/* Touch layouts: short landscape phones keep the buttons clear of the top bar, and the stick zone out of the buttons. */
@media (max-height: 460px) and (orientation: landscape) {
  .isl-pad { width: 176px; height: 176px; }
  .isl-attack { width: 72px; height: 72px; }
  .isl-dodge { right: 82px; width: 52px; height: 52px; }
  .isl-ability { bottom: 80px; width: 54px; height: 54px; }
  .isl-act { right: 74px; bottom: 66px; }
  .isl-catch { right: 74px; bottom: 114px; }
  .isl-stickzone { width: 42%; height: 80%; }
}
`;
// Opens the Controls panel (a site dialog, so the explorer stops while it is open).
export function openControls(opener = document.activeElement, { onPractice } = {}) {
  injectCSS('island-input', CSS);
  document.getElementById('ctlModal')?.remove();
  const el = document.createElement('div');
  el.className = 'modal-bg';
  el.id = 'ctlModal';
  let cap = null;
  const rows = () => ACTIONS.map(([a, label]) => `<div class="ctl-row"><span>${label}</span>${[0, 1].map((i) => `<button class="ctl-key ${cap?.a === a && cap.i === i ? 'listening' : ''}" data-a="${a}" data-i="${i}" aria-label="${label}, key ${i + 1}: ${keyBinds()[a][i] ? keyLabel(keyBinds()[a][i]) : 'none'}">${cap?.a === a && cap.i === i ? 'Press a key' : esc(keyLabel(keyBinds()[a][i]))}</button>`).join('')}</div>`).join('');
  const paint = () => { el.querySelector('.ctl-rows').innerHTML = rows(); };
  el.innerHTML = `<div class="modal panel help ctl" role="dialog" aria-modal="true" aria-labelledby="ctlTitle">
    <button class="icon-btn help-x" aria-label="Close">${icon('close')}</button>
    <div class="help-body">
      <h2 id="ctlTitle">Controls</h2>
      <p class="small muted">Choose a key, then press the one you want. These stay on this device.</p>
      <div class="ctl-rows">${rows()}</div>
      <p class="ctl-note muted">Always: M map, 1–3 switch companion, Esc closes windows. Mouse click swings your staff.</p>
      <p class="ctl-note muted"><b>Controller:</b> stick or d-pad moves, A attack, B dodge, X talk or gather, Y befriend, bumpers companion move, Start menu.</p>
      <p class="ctl-note muted"><b>Touch:</b> the stick on the left and the buttons on the right.</p>
    </div>
    <div class="help-foot ctl-foot">${onPractice ? '<button class="ctl-practice">Replay practice</button>' : ''}<button class="ctl-reset">Reset keys</button><span class="grow"></span><button class="primary help-ok">Done</button></div>
  </div>`;
  const stop = () => { removeEventListener('keydown', grab, true); cap = null; };
  const close = () => { stop(); closeModal(el); };
  function grab(e) {
    e.preventDefault(); e.stopPropagation();
    if (e.code === 'Escape') { stop(); return paint(); }
    if (RESERVED(e.code)) return toast('That key is kept for something else. Try another.');
    setKey(cap.a, cap.i, e.code);
    stop(); paint();
  }
  el.addEventListener('click', (e) => {
    if (e.target === el || e.target.closest('.help-x, .help-ok')) return close();
    if (e.target.closest('.ctl-practice')) { close(); return onPractice(); }
    if (e.target.closest('.ctl-reset')) { stop(); resetKeys(); return paint(); }
    const k = e.target.closest('.ctl-key');
    if (k) { stop(); cap = { a: k.dataset.a, i: +k.dataset.i }; addEventListener('keydown', grab, true); paint(); el.querySelector('.listening')?.focus(); }
  });
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !cap) close(); });
  openModal(el, '.help-ok', opener);
  return { close, el };
}
