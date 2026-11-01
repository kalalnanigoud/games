// Sketch Party doodle warm-up: three tiny prompts on a scrap of paper before a device's first round.
// Nothing is shared with the room. Skippable at any point; shown once per device (js/onboarding.js).
import { injectCSS } from '../js/fx.js';
import { suppressed, seen, mark } from '../js/onboarding.js';

const PROMPTS = ['Draw a circle', 'Turn it into a smiley face', 'Doodle anything you like'];
const CSS = `
#skWarm { position: fixed; inset: 0; z-index: 45; display: grid; place-items: center; padding: 14px; background: rgba(8,12,30,.7); }
#skWarm .sw-card { width: min(440px, 100%); max-height: 100%; overflow-y: auto; padding: 14px; border-radius: 20px; background: var(--surface-2); color: var(--text); border: 1px solid var(--line-2); box-shadow: var(--shadow-lg); }
#skWarm h3 { margin: 0; font-family: var(--font-display); font-size: 1.15rem; }
#skWarm .sw-step { font-size: .72rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--gold); }
#skWarm .sw-paper { position: relative; margin: 10px 0; border-radius: 14px; overflow: hidden; background: #fff; }
#skWarm canvas { display: block; width: 100%; height: auto; aspect-ratio: 4/3; touch-action: none; cursor: crosshair; }
#skWarm .sw-row { display: flex; gap: 8px; justify-content: space-between; flex-wrap: wrap; }
#skWarm .sw-row button { min-height: 44px; }
#skWarm .sw-row span { display: flex; gap: 8px; }
@media (max-height: 460px) { #skWarm canvas { aspect-ratio: 16/7; } #skWarm .sw-paper { margin: 6px 0; } }
`;
export const needsWarmup = () => !suppressed() && !seen('sketch-warmup');

// Returns { close, el } (or null if one is already open). onClose() runs however it ends.
export function openWarmup(onClose) {
  if (document.getElementById('skWarm')) return null;
  injectCSS('sketch-warmup', CSS);
  mark('sketch-warmup');
  const el = document.createElement('div');
  el.id = 'skWarm';
  let i = 0, drawing = false, last = null;
  el.innerHTML = `<div class="sw-card" role="dialog" aria-modal="true" aria-labelledby="swTitle">
    <span class="sw-step"></span><h3 id="swTitle"></h3>
    <div class="sw-paper"><canvas width="480" height="360" aria-label="Warm-up drawing area"></canvas></div>
    <div class="sw-row"><button data-sw="skip" class="ghost">Skip warm-up</button><span><button data-sw="clear">Clear</button><button data-sw="next" class="primary"></button></span></div></div>`;
  const cv = el.querySelector('canvas'), g = cv.getContext('2d');
  const paint = () => {
    el.querySelector('.sw-step').textContent = `Warm-up ${i + 1} of ${PROMPTS.length}`;
    el.querySelector('h3').textContent = PROMPTS[i];
    el.querySelector('[data-sw="next"]').textContent = i === PROMPTS.length - 1 ? 'Let’s play' : 'Next';
    g.clearRect(0, 0, cv.width, cv.height);
  };
  const pt = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
  cv.addEventListener('pointerdown', (e) => {
    drawing = true; last = pt(e); cv.setPointerCapture?.(e.pointerId); e.preventDefault();
    g.fillStyle = '#2b2440'; g.beginPath(); g.arc(last[0], last[1], 3, 0, 7); g.fill();
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const p = pt(e);
    g.strokeStyle = '#2b2440'; g.lineWidth = 6; g.lineCap = g.lineJoin = 'round';
    g.beginPath(); g.moveTo(last[0], last[1]); g.lineTo(p[0], p[1]); g.stroke();
    last = p;
  });
  const up = () => { drawing = false; };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const close = () => { removeEventListener('keydown', onKey, true); if (el.isConnected) el.remove(); onClose?.(); };
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sw]');
    if (!b) return;
    if (b.dataset.sw === 'skip') close();
    else if (b.dataset.sw === 'clear') paint();
    else if (i >= PROMPTS.length - 1) close();
    else { i++; paint(); }
  });
  addEventListener('keydown', onKey, true);
  document.body.appendChild(el);
  paint();
  el.querySelector('[data-sw="next"]').focus({ preventScroll: true });
  return { close, el };
}
