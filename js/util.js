export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const rand = (n) => Math.floor(Math.random() * n);
export const d6 = () => 1 + rand(6);

export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const randomCode = (len = 5) => Array.from({ length: len }, () => CODE_CHARS[rand(CODE_CHARS.length)]).join('');

let toastTimer;
export function toast(msg, kind = 'error') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'show ' + (kind === 'info' ? 'info' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ''), 2800);
}

// Push a line to a game's log (newest first, capped).
export function log(state, msg) {
  state.log = state.log || [];
  state.log.unshift(msg);
  if (state.log.length > 40) state.log.length = 40;
}

export const DIE_FACES = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

// Standard player colours shared by games that don't define their own.
export const PLAYER_COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#facc15', '#a855f7', '#f97316', '#14b8a6', '#ec4899'];
