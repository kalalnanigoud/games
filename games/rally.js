import { Race, TRACK, ROAD } from './rally-sim.js';
import { injectCSS } from '../js/fx.js';
import { levelOption } from '../js/levels.js';
import { uid } from '../js/util.js';

const COLORS = ['#ffcb47', '#70d7ff', '#ff789d', '#c1a4ff'];
export const COVER = `<svg viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="ry-sky" x2="0" y2="1"><stop stop-color="#124d62"/><stop offset="1" stop-color="#10233f"/></linearGradient></defs><rect width="320" height="200" fill="url(#ry-sky)"/><ellipse cx="160" cy="105" rx="117" ry="62" fill="#426f58" stroke="#d8d4bc" stroke-width="45"/><ellipse cx="160" cy="105" rx="117" ry="62" fill="none" stroke="#283647" stroke-width="36"/><ellipse cx="160" cy="105" rx="117" ry="62" fill="none" stroke="#f1d373" stroke-width="2" stroke-dasharray="12 10"/><g transform="translate(227 58) rotate(27)"><rect x="-24" y="-12" width="48" height="24" rx="8" fill="#ffcc48"/><rect x="-8" y="-9" width="20" height="18" rx="4" fill="#1a3148"/></g><g transform="translate(104 160) rotate(-17)"><rect x="-21" y="-11" width="42" height="22" rx="7" fill="#69ceff"/><rect x="-7" y="-8" width="18" height="16" rx="3" fill="#1a3148"/></g><path d="M28 24h48v24H28z" fill="#fff"/><path d="M28 24h12v12H28zm24 0h12v12H52zM40 36h12v12H40zm24 0h12v12H64z" fill="#172438"/><text x="160" y="112" text-anchor="middle" fill="#fff1bd" font-family="sans-serif" font-weight="bold" font-size="20">POCKET RALLY</text></svg>`;
let race = null, mounted = null, stop = null;
export const debug = { get race() { return race; } };
const fmt = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

function mount(box, ctx, level) {
  if (mounted === box && box.querySelector('.rally')) return;
  stop?.(); mounted = box;
  const canDrive = ctx.isHost && ctx.players.some(p => p.id === ctx.me && !p.watch);
  race ||= new Race(level);
  box.innerHTML = `<div class="rally"><div class="rally-top"><b>Pocket Rally <small>Seabreeze Circuit</small></b><span class="rally-status" role="status"></span></div><canvas aria-label="Top-down racing track"></canvas><div class="rally-message"></div><div class="rally-controls"><button data-drive="left" aria-label="Steer left">◀</button><button data-drive="right" aria-label="Steer right">▶</button><button data-drive="brake">Brake</button><button data-drive="boost">Boost</button><button data-pause>Pause</button></div><p class="rally-help">Auto-accelerate · A/D or ←/→ steer · ↓ brake · Space boost · P pause</p></div>`;
  const root = box.firstChild, canvas = root.querySelector('canvas'), g = canvas.getContext('2d', { alpha: false });
  canvas.width = 1000; canvas.height = 680;
  const keys = new Set(), touches = new Map(); let frame = 0, last = 0;
  const clear = () => { keys.clear(); touches.clear(); };
  const pause = () => { if (!race.result) race.paused = !race.paused; clear(); };
  const key = e => {
    if (!root.isConnected || e.target?.matches('input,textarea,select') || document.querySelector('.modal-bg')) { if (e.type === 'keyup') keys.delete(e.code); return; }
    if (!['KeyA','KeyD','ArrowLeft','ArrowRight','ArrowDown','KeyS','Space','KeyP'].includes(e.code)) return;
    if (['Space'].includes(e.code) && e.target?.closest('button')) return;
    e.preventDefault();
    if (e.type === 'keyup') keys.delete(e.code);
    else if (e.code === 'KeyP' && !e.repeat) pause(); else keys.add(e.code);
  };
  const blur = () => { clear(); if (!race.result) race.paused = true; };
  const visibility = () => { if (document.hidden) blur(); };
  root.querySelectorAll('[data-drive]').forEach(b => {
    b.onpointerdown = e => { if (!canDrive) return; e.preventDefault(); b.setPointerCapture(e.pointerId); touches.set(e.pointerId, b.dataset.drive); };
    b.onpointerup = b.onpointercancel = b.onlostpointercapture = e => touches.delete(e.pointerId);
  });
  root.querySelector('[data-pause]').onclick = pause;
  root.querySelector('.rally-message').onclick = e => {
    if (e.target.closest('[data-again]')) { race = new Race(level); clear(); }
    if (e.target.closest('[data-resume]')) { race.paused = false; clear(); }
  };
  addEventListener('keydown', key); addEventListener('keyup', key); addEventListener('blur', blur); document.addEventListener('visibilitychange', visibility);
  const active = a => [...touches.values()].includes(a);
  let previousMessage = '';
  function loop(now) {
    if (!root.isConnected) return stop();
    const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
    const overlay = !!document.querySelector('.modal-bg');
    if (overlay) clear();
    if (canDrive && !overlay) race.step(dt, { steer: Number(keys.has('KeyD') || keys.has('ArrowRight') || active('right')) - Number(keys.has('KeyA') || keys.has('ArrowLeft') || active('left')), brake: keys.has('ArrowDown') || keys.has('KeyS') || active('brake'), boost: keys.has('Space') || active('boost') });
    draw(g, race);
    const c = race.cars[0], place = race.order().indexOf(c) + 1;
    root.querySelector('.rally-status').textContent = `Lap ${Math.min(3, c.lap + 1)}/3 · ${place}/4 · ${fmt(race.time)} · Boost ${Math.round(c.boost * 100)}%`;
    const message = !canDrive ? '<b>This is a solo race.</b>' : race.result ? `<b>Finished ${race.result.place}/4 · ${fmt(race.result.time)}</b><button data-again>Race again</button>` : race.paused ? '<b>Paused</b><button data-resume>Resume</button>' : race.countdown > 0 ? `<b>${Math.ceil(race.countdown)}</b>` : '';
    if (message !== previousMessage) { root.querySelector('.rally-message').innerHTML = message; previousMessage = message; }
    root.querySelector('.rally-message').hidden = !message;
    root.querySelector('[data-pause]').textContent = race.paused ? 'Resume' : 'Pause';
    frame = requestAnimationFrame(loop);
  }
  stop = () => { cancelAnimationFrame(frame); clear(); removeEventListener('keydown', key); removeEventListener('keyup', key); removeEventListener('blur', blur); document.removeEventListener('visibilitychange', visibility); mounted = null; };
  if (ctx.live && canDrive) frame = requestAnimationFrame(loop); else draw(g, race);
}

function draw(g, r) {
  g.fillStyle = '#305f55'; g.fillRect(0, 0, 1000, 680);
  for (let i = 0; i < 45; i++) { g.fillStyle = i % 2 ? '#4a7961' : '#244e47'; g.beginPath(); g.arc((i * 193 + 25) % 1000, (i * 139 + 12) % 680, 13 + i % 9, 0, 7); g.fill(); }
  const path = () => { g.beginPath(); TRACK.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.closePath(); };
  g.lineJoin = 'round'; path(); g.strokeStyle = '#d3caaa'; g.lineWidth = ROAD * 2 + 12; g.stroke();
  path(); g.strokeStyle = '#283745'; g.lineWidth = ROAD * 2; g.stroke();
  path(); g.strokeStyle = '#e4d49d'; g.lineWidth = 2; g.setLineDash([14, 18]); g.stroke(); g.setLineDash([]);
  for (let i = 0; i < 10; i++) for (let j = 0; j < 2; j++) { g.fillStyle = (i + j) % 2 ? '#142634' : '#fff4d7'; g.fillRect(782 + i * 12, 337 + j * 12, 12, 12); }
  g.textAlign = 'center'; g.fillStyle = '#d2e5cd'; g.font = 'bold 32px sans-serif'; g.fillText('SEABREEZE', 500, 310); g.font = '18px sans-serif'; g.fillText('CIRCUIT · 3 LAPS', 500, 345);
  r.cars.forEach((c, i) => {
    g.save(); g.translate(c.x, c.y); g.rotate(c.angle);
    g.fillStyle = '#112431'; g.fillRect(-15, -13, 28, 26);
    g.fillStyle = COLORS[i]; g.beginPath(); g.roundRect(-21, -10, 42, 20, 6); g.fill();
    g.fillStyle = '#17374a'; g.fillRect(-5, -8, 15, 16); g.fillStyle = '#fff9cb'; g.fillRect(15, -7, 3, 5); g.fillRect(15, 2, 3, 5); g.restore();
    if (!i) { g.fillStyle = '#fff6c5'; g.font = 'bold 14px sans-serif'; g.fillText('YOU', c.x, c.y - 24); }
  });
}

export default {
  id: 'rally', name: 'Pocket Rally', description: 'A quick top-down race around Seabreeze Circuit. Steer, brake and boost past three computer rivals across three laps.', minPlayers: 1, maxPlayers: 1,
  live: true, manualSave: true, soloOnDevice: true, simultaneous: true, cover: COVER,
  options: [levelOption('Computer racers')],
  howTo: { goal: 'Finish three laps ahead of the computer racers.', turn: [['🏎️', 'Steer', 'Your car accelerates automatically. Steer with A/D, arrow keys, or the on-screen buttons.'], ['💨', 'Boost and brake', 'Hold Space or Boost for extra speed. Brake with Down or S before corners. Boost recharges when released.'], ['🏁', 'Follow the circuit', 'Grass slows you down. Complete checkpoints in order; cutting across the middle will not count a lap.']], tips: ['Press P to pause. Changing tabs pauses the race.', 'Races are short sessions and are not saved.'] },
  setup(players, opts) { return { sid: uid(), phase: 'race', over: false, level: opts?.level || 'normal' }; },
  act() { throw Error('Use the driving controls.'); }, turnOf() { return []; }, view(s) { return s; },
  startHost(api, state) { this.stopLive(); race = new Race(state.level); }, hostRoom() {}, hostMessage() {}, guestMessage() {},
  stopLive() { stop?.(); stop = null; race = null; mounted = null; },
  render(el, state, ctx) { injectCSS('rally', CSS); mount(el, ctx, state.level); },
};
const CSS = `.rally{background:#102b38;border-radius:18px;overflow:hidden;color:#fff}.rally canvas{display:block;width:100%;max-height:68vh;object-fit:contain;touch-action:none}.rally-top{display:flex;gap:12px;justify-content:space-between;align-items:center;padding:12px;flex-wrap:wrap}.rally-top small{display:block;font-size:.75rem;color:#b9d1cf}.rally-status{font-size:.82rem;font-variant-numeric:tabular-nums}.rally-controls{display:flex;justify-content:center;flex-wrap:wrap;gap:8px;padding:10px}.rally-controls button{min-width:52px;min-height:48px;touch-action:none;user-select:none}.rally-message{display:flex;gap:12px;align-items:center;justify-content:center;padding:12px;background:#183e4a}.rally-message[hidden]{display:none}.rally-help{text-align:center;padding:0 12px 12px;color:#c4d8d2;font-size:.8rem;margin:0}@media(max-width:480px){.rally canvas{max-height:48vh}.rally-controls{gap:6px}.rally-controls button{padding:8px;min-width:48px}}`;
