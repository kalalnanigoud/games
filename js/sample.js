// A one-move sample the first time someone plays each board game on a device, built from the game's own
// howTo (the same data as its "How to play" guide), so every board game gets it with no per-game code.
// It watches the game area, floats above the board without covering a window, and goes away on "Got it"
// or when the turn moves on. Once per game per device (js/onboarding.js).
import { esc } from './util.js';
import { injectCSS } from './fx.js';
import { S, getGame, myId } from './state.js';
import { suppressed, seen, mark } from './onboarding.js';

const BOARD = new Set(['hexisle', 'gems', 'mosaic', 'bluff', 'chess']);
const CSS = `
#obSample { margin: 0 0 10px; padding: 10px 14px; border-radius: 16px; background: var(--surface-2); color: var(--text); border: 2px solid var(--gold); animation: ob-in .25s ease; }
#obSample b.ob-h { display: block; font-family: var(--font-display); font-size: 1.05rem; margin-bottom: 6px; }
#obSample ol { list-style: none; margin: 0 0 8px; padding: 0; display: grid; gap: 6px; }
#obSample li { display: flex; gap: 9px; align-items: flex-start; font-size: .86rem; line-height: 1.35; }
#obSample li .ob-ic { flex: none; width: 26px; text-align: center; font-size: 1.15rem; }
#obSample li p { margin: 2px 0 0; }
#obSample .ob-foot { display: flex; gap: 8px; justify-content: flex-end; }
#obSample .ob-foot button { min-height: 40px; }
@media (min-width: 601px) { #obSample ol { grid-template-columns: 1fr 1fr; gap: 14px; } }
@media (max-width: 600px) { #obSample li:nth-child(n+2) { display: none; } #obSample { padding: 8px 12px; margin-bottom: 8px; } #obSample ol { margin-bottom: 6px; } #obSample b.ob-h { margin-bottom: 4px; } }
@keyframes ob-in { from { opacity: 0; transform: translateY(-6px); } }
@media (prefers-reduced-motion: reduce) { #obSample { animation: none; } }
`;

function check() {
  if (suppressed()) return;
  const card = document.getElementById('obSample');
  const box = document.getElementById('gamebox');
  const id = box?.dataset.game;
  const g = id && BOARD.has(id) ? getGame(id) : null;
  let mine = false;
  try { mine = !!g?.turnOf && S.screen === 'game' && !!S.view && !S.view.over && g.turnOf(S.view).includes(myId()); } catch {}
  // The sample goes away when the turn moves on, or the game is left.
  if (card && (card.dataset.g !== id || !mine)) { card.remove(); return; }
  if (card || !mine || !g.howTo?.turn?.length || seen('sample-' + id) || document.querySelector('.modal-bg')) return;
  mark('sample-' + id);
  injectCSS('onboarding', CSS);
  const el = document.createElement('div');
  el.id = 'obSample'; el.dataset.g = id; el.setAttribute('role', 'region'); el.setAttribute('aria-label', 'Your first move');
  el.innerHTML = `<b class="ob-h">Your first move</b><ol>${g.howTo.turn.slice(0, 2).map(([ic, title, text]) => `<li><span class="ob-ic">${ic}</span><div><b>${title}</b><p>${text}</p></div></li>`).join('')}</ol>
    <div class="ob-foot"><button data-help="${esc(id)}" class="ghost">All the rules</button><button class="primary" data-ob-ok>Got it</button></div>`;
  el.addEventListener('click', (e) => { if (e.target.closest('[data-ob-ok]')) el.remove(); });
  box.before(el);
}

let timer = 0;
new MutationObserver(() => { if (!timer) timer = setTimeout(() => { timer = 0; try { check(); } catch (e) { console.warn('sample', e); } }, 300); })
  .observe(document.getElementById('app') || document.body, { childList: true, subtree: true });
