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

// Private reconnect credentials must never be used as public player IDs.
export const reconnectSecret = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');

// SHA-256 of a string, as hex. The host keeps only these fingerprints of reconnect secrets, so a copy
// of the room handed to a backup host can check returning players without being able to impersonate them.
const K256 = Array.from({ length: 64 }, (_, i) => {
  const primes = [];
  for (let n = 2; primes.length < 64; n++) if (primes.every((p) => n % p)) primes.push(n);
  return Math.floor((Math.cbrt(primes[i]) % 1) * 2 ** 32) >>> 0;
});
export function sha256hex(text) {
  const bytes = new TextEncoder().encode(String(text));
  const len = bytes.length, total = Math.ceil((len + 9) / 64) * 64;
  const m = new Uint8Array(total);
  m.set(bytes); m[len] = 0x80;
  const bits = len * 8;
  for (let i = 0; i < 8; i++) m[total - 1 - i] = Math.floor(bits / 2 ** (8 * i)) & 0xff;
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Uint32Array(64), rot = (x, n) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < total; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = (m[o + i * 4] << 24) | (m[o + i * 4 + 1] << 16) | (m[o + i * 4 + 2] << 8) | m[o + i * 4 + 3];
    for (let i = 16; i < 64; i++) {
      const s0 = rot(w[i - 15], 7) ^ rot(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = rot(w[i - 2], 17) ^ rot(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, k] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (k + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + w[i]) >>> 0;
      const t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      k = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    [a, b, c, d, e, f, g, k].forEach((x, i) => (h[i] = (h[i] + x) >>> 0));
  }
  return h.map((x) => x.toString(16).padStart(8, '0')).join('');
}

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

// Queue a visual effect every player sees once (played by js/fx.js playFx).
export function addFx(state, item) {
  state.fxSeq = (state.fxSeq || 0) + 1;
  state.fx = (state.fx || []).concat({ ...item, seq: state.fxSeq }).slice(-40);
}

export const DIE_FACES = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

// Standard player colours shared by games that don't define their own.
export const PLAYER_COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#facc15', '#a855f7', '#f97316', '#14b8a6', '#ec4899'];
