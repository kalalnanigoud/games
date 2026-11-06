// Bingo, the pen-and-paper way: everyone has a 5×5 card holding 1–25 in their own order. Players take turns
// calling one number; everyone crosses it off. Every finished row, column or diagonal crosses one letter of
// B-I-N-G-O, and the first to cross all five wins (players who get there on the same call share the win).
import { esc, log, addFx, shuffle, PLAYER_COLORS } from '../js/util.js';
import { injectCSS, morph } from '../js/fx.js';
import { sound } from '../js/sound.js';
import { icon } from '../js/icons.js';
import { portrait } from '../js/avatar.js';
import { levelOption, levelOf } from '../js/levels.js';

const N = 25, NEED = 5, LETTERS = 'BINGO';
// The 12 lines of a 5×5 card, as cell indexes: 5 rows, 5 columns, 2 diagonals.
const LINES = [
  ...[0, 1, 2, 3, 4].map((r) => [0, 1, 2, 3, 4].map((c) => r * 5 + c)),
  ...[0, 1, 2, 3, 4].map((c) => [0, 1, 2, 3, 4].map((r) => r * 5 + c)),
  [0, 6, 12, 18, 24], [4, 8, 12, 16, 20],
];
const linesDone = (card, called) => LINES.filter((l) => l.every((i) => called.has(card[i])));
const isPerm = (a) => Array.isArray(a) && a.length === N && new Set(a).size === N && a.every((x) => Number.isInteger(x) && x >= 1 && x <= N);

function setup(players, opts = {}) {
  const order = players.map((p) => p.id);
  const start = Math.floor(Math.random() * order.length);
  const s = {
    phase: 'setup', over: false, winners: [], log: [], level: levelOf(opts),
    players: players.map((p, i) => ({ id: p.id, name: p.name, seat: i, ready: false, lines: 0, card: shuffle(Array.from({ length: N }, (_, k) => k + 1)) })),
    order: [...order.slice(start), ...order.slice(0, start)], turn: 0, called: [], last: null, by: null,
  };
  log(s, 'Arrange your card (tap two numbers to swap them) or shuffle it, then press Ready.');
  return s;
}

const player = (s, pid) => s.players.find((p) => p.id === pid);
const caller = (s) => s.order[s.turn % s.order.length];

function act(s, pid, a) {
  const me = player(s, pid);
  if (!me) throw Error('Only players at the table can do that.');
  if (!a || typeof a !== 'object') throw Error('Unknown move.');
  if (s.over) throw Error('The game is over.');
  if (s.phase === 'setup') {
    if (me.ready) throw Error('You are ready. Waiting for the others.');
    if (a.type === 'swap') {
      if (![a.i, a.j].every((x) => Number.isInteger(x) && x >= 0 && x < N) || a.i === a.j) throw Error('Pick two different squares.');
      [me.card[a.i], me.card[a.j]] = [me.card[a.j], me.card[a.i]];
      return;
    }
    if (a.type === 'arrange') { if (!isPerm(a.cells)) throw Error('A card holds each number from 1 to 25 once.'); me.card = [...a.cells]; return; }
    if (a.type === 'shuffle') { me.card = shuffle(me.card.slice()); return; }
    if (a.type === 'ready') {
      me.ready = true;
      if (s.players.every((p) => p.ready)) {
        s.phase = 'play';
        log(s, `Everyone is ready. ${player(s, caller(s)).name} calls first.`);
        addFx(s, { kind: 'sound', sound: 'turn' });
      }
      return;
    }
    throw Error('Arrange your card and press Ready.');
  }
  if (a.type !== 'call') throw Error('Call a number on your turn.');
  if (caller(s) !== pid) throw Error(`It's ${player(s, caller(s)).name}'s turn to call.`);
  const n = a.n;
  if (!Number.isInteger(n) || n < 1 || n > N) throw Error('Call a number from 1 to 25.');
  if (s.called.includes(n)) throw Error(`${n} has already been called.`);
  s.called.push(n); s.last = n; s.by = pid;
  const called = new Set(s.called);
  log(s, `${me.name} calls ${n}.`);
  addFx(s, { kind: 'sound', sound: 'place' });
  for (const p of s.players) {
    const lines = Math.min(NEED, linesDone(p.card, called).length);
    if (lines > p.lines) {
      addFx(s, { kind: 'float', at: `bg-p-${p.id}`, text: LETTERS.slice(p.lines, lines).split('').join(' '), color: '#ffd76a' });
      if (lines < NEED) log(s, `${p.name} has ${LETTERS.slice(0, lines)}.`);
    }
    p.lines = lines;
  }
  const done = s.players.filter((p) => p.lines >= NEED);
  if (done.length) {
    s.over = true; s.phase = 'over'; s.winners = done.map((p) => p.id);
    log(s, `BINGO! ${done.map((p) => p.name).join(' and ')} ${done.length > 1 ? 'share the win' : 'wins'}.`);
    return;
  }
  if (s.called.length >= N) { s.over = true; s.phase = 'over'; s.winners = []; log(s, 'Every number is called.'); return; } // can't happen: 25 calls finish every line
  s.turn = (s.turn + 1) % s.order.length;
}

function turnOf(s) {
  if (s.over) return [];
  if (s.phase === 'setup') return s.players.filter((p) => !p.ready).map((p) => p.id);
  return [caller(s)];
}

// Your own card is yours alone (its order is your strategy); others show only their letters.
function view(s, pid) {
  return {
    ...s, order: [...s.order], called: [...s.called], log: [...s.log], winners: [...s.winners],
    players: s.players.map((p) => ({ id: p.id, name: p.name, seat: p.seat, ready: p.ready, lines: p.lines, card: p.id === pid || s.over ? [...p.card] : null })),
  };
}

// A computer calls the number that does the most for its own card: finishing lines first, then filling the
// lines it is closest to. Easy often calls at random; Hard also avoids spreading its calls across lines.
function score(card, called, n) {
  const i = card.indexOf(n);
  let v = 0;
  for (const l of LINES) {
    if (!l.includes(i)) continue;
    const have = l.filter((k) => called.has(card[k])).length;
    v += have === 4 ? 100 : have * have + 1;
  }
  return v;
}
function bestCall(v, pid, level = 'normal') {
  const me = v.players.find((p) => p.id === pid), called = new Set(v.called);
  const open = Array.from({ length: N }, (_, k) => k + 1).filter((n) => !called.has(n));
  if (!me?.card || level === 'easy' && Math.random() < 0.6) return open[Math.floor(Math.random() * open.length)];
  let best = open[0], top = -Infinity;
  for (const n of open) {
    let sc = score(me.card, called, n) + Math.random() * (level === 'hard' ? 0.1 : 2);
    if (level === 'hard') { const next = new Set(called).add(n); sc += 3 * open.filter((m) => m !== n && score(me.card, next, m) >= 100).length; } // set up the next finish
    if (sc > top) { top = sc; best = n; }
  }
  return best;
}
function bot(v, pid) {
  if (v.phase === 'setup') return { type: 'ready' };
  return { type: 'call', n: bestCall(v, pid, v.level) };
}
// Time's up: a card is accepted as it is, and a call is made for you (the number that helps your card most).
function onTimeout(v, pid) {
  if (v.phase === 'setup') return { type: 'ready' };
  return { type: 'call', n: bestCall(v, pid, 'normal') };
}

// ---------------- screen ----------------
const UI = { pick: null, key: '', logOpen: false };

function letters(lines, big) {
  return `<span class="bg-letters ${big ? 'big' : ''}" aria-label="${lines} of 5 letters">${LETTERS.split('').map((ch, i) => `<i class="${i < lines ? 'on' : ''}">${ch}</i>`).join('')}</span>`;
}

function render(el, v, ctx) {
  injectCSS('bingo', STYLE);
  const key = v.order.join() + v.players.map((p) => p.id).join();
  if (UI.key !== key) Object.assign(UI, { key, pick: null });
  const me = v.players.find((p) => p.id === ctx.me);
  const called = new Set(v.called);
  const setupPhase = v.phase === 'setup', myCall = !v.over && v.phase === 'play' && v.order[v.turn] === ctx.me;
  const arranging = setupPhase && me && !me.ready;
  if (!arranging) UI.pick = null;
  const who = v.players.find((p) => p.id === v.order[v.turn]);
  const done = me?.card ? linesDone(me.card, called) : [];
  const inLine = new Set(done.flat());
  const face = (p) => `<span class="bg-face" style="--pc:${PLAYER_COLORS[p.seat % PLAYER_COLORS.length]}">${portrait({ id: p.id, bot: !!ctx.isBot?.(p.id) })}</span>`;

  const cardHTML = me?.card ? `<div class="bg-card ${arranging ? 'arranging' : ''} ${myCall ? 'calling' : ''}">${letters(me.lines, true)}<div class="bg-grid">${me.card.map((n, i) => {
    const x = called.has(n), last = n === v.last;
    const cls = ['bg-cell', x ? 'x' : '', inLine.has(i) ? 'line' : '', last ? 'last' : '', UI.pick === i ? 'pick' : '', myCall && !x ? 'can' : ''].filter(Boolean).join(' ');
    return `<button class="${cls}" data-cell="${i}" data-k="bg-n-${n}" aria-label="${n}${x ? ', crossed' : ''}" ${arranging || (myCall && !x) ? '' : 'tabindex="-1"'}><span>${n}</span>${x ? '<svg class="bg-x" viewBox="0 0 40 40" aria-hidden="true"><path d="M9 9 L31 31 M31 9 L9 31"/></svg>' : ''}</button>`;
  }).join('')}</div></div>`
    : `<div class="panel bg-watch">${icon('eye')}<span>${setupPhase ? 'The players are arranging their cards.' : 'You are watching. Cards are shown at the end.'}</span></div>`;

  const status = v.over ? (v.winners.includes(ctx.me) ? 'BINGO! You win!' : v.winners.length ? `${esc(v.winners.map((id) => v.players.find((p) => p.id === id).name).join(' and '))} ${v.winners.length > 1 ? 'share the win' : 'wins'}!` : 'Game over')
    : setupPhase ? (arranging ? 'Arrange your card: tap two numbers to swap them, or shuffle. Then press Ready.' : me ? 'Ready! Waiting for the others…' : 'Players are getting ready…')
    : myCall ? 'Your turn: tap a number on your card to call it.'
    : `${esc(who.name)} is calling a number…`;
  const lastCall = v.last != null ? `<div class="bg-last" aria-live="polite"><b class="bg-ball">${v.last}</b><small>called by ${esc(v.players.find((p) => p.id === v.by)?.name || '')}</small></div>` : '';
  const waiting = setupPhase ? v.players.filter((p) => !p.ready) : [];

  const players = v.players.map((p) => `<div class="bg-player ${p.id === ctx.me ? 'me' : ''} ${!v.over && v.phase === 'play' && v.order[v.turn] === p.id ? 'turn' : ''} ${v.winners.includes(p.id) ? 'win' : ''}" data-a="bg-p-${p.id}">
      ${face(p)}<span class="bg-pname"><b>${esc(p.name)}</b>${setupPhase ? `<small>${p.ready ? 'Ready' : 'Arranging…'}</small>` : letters(p.lines)}</span>
      ${p.id === ctx.me ? '<span class="tag t-you">You</span>' : ''}${!v.over && v.phase === 'play' && v.order[v.turn] === p.id ? `<span class="tag t-good">${icon('mic')}Calling</span>` : ''}</div>`).join('');
  const calls = v.called.length ? v.called.map((n) => `<span class="${n === v.last ? 'last' : ''}">${n}</span>`).join('') : '<p class="muted small" style="margin:0">No numbers yet.</p>';
  const others = v.over ? v.players.filter((p) => p.id !== ctx.me && p.card).map((p) => `<div class="bg-mini"><b>${esc(p.name)}</b>${letters(p.lines)}<div class="bg-minigrid">${p.card.map((n) => `<i class="${called.has(n) ? 'x' : ''}">${n}</i>`).join('')}</div></div>`).join('') : '';
  UI.logOpen = el.querySelector('.bg-logbox')?.open ?? UI.logOpen;

  morph(el, `<div class="bg-root"><div class="game-layout">
    <div class="felt bg-felt">
      ${v.over ? `<div class="winner-banner">${icon('trophy')}${status}</div>` : ''}
      <div class="bg-head">${lastCall}<p class="bg-status">${status}</p></div>
      ${cardHTML}
      ${arranging ? `<div class="row bg-actions"><button id="bgShuffle">${icon('dice')}Shuffle</button><button class="primary grow" id="bgReady">${icon('check')}Ready</button></div>` : ''}
      ${setupPhase && me?.ready && waiting.length ? `<p class="bg-hint">Waiting for ${esc(waiting.map((p) => p.name).join(', '))}.</p>` : ''}
      ${others ? `<div class="bg-others">${others}</div>` : ''}
    </div>
    <div class="side">
      <div class="panel bg-players">${players}</div>
      <div class="panel bg-calls"><h3>${icon('mic')}Called <span class="note">${v.called.length}/25</span></h3><div class="bg-calllist">${calls}</div></div>
      <details class="panel drawer bg-logbox" ${UI.logOpen ? 'open' : ''}><summary>${icon('book')}<span>Game log</span>${icon('chevron', 'chev')}</summary>
        <div class="drawer-body"><div class="parchment log">${v.log.slice(0, 10).map((l) => `<div>${esc(l)}</div>`).join('')}</div></div></details>
    </div>
  </div></div>`);

  const lb = el.querySelector('.bg-logbox'); if (lb) lb.ontoggle = () => { UI.logOpen = lb.open; };
  el.querySelectorAll('[data-cell]').forEach((b) => (b.onclick = () => {
    const i = +b.dataset.cell;
    if (arranging) {
      if (UI.pick == null) { UI.pick = i; sound('click'); return render(el, v, ctx); }
      const j = UI.pick; UI.pick = null;
      if (j === i) return render(el, v, ctx);
      return ctx.send({ type: 'swap', i: j, j: i });
    }
    if (myCall && !called.has(me.card[i])) ctx.send({ type: 'call', n: me.card[i] });
  }));
  const sh = el.querySelector('#bgShuffle'), rd = el.querySelector('#bgReady');
  if (sh) sh.onclick = () => { UI.pick = null; ctx.send({ type: 'shuffle' }); };
  if (rd) rd.onclick = () => { UI.pick = null; ctx.send({ type: 'ready' }); };
}

const STYLE = `
.bg-felt{display:flex;flex-direction:column;gap:14px;align-items:center;background:
  radial-gradient(110% 60% at 50% -10%,rgba(255,196,92,.22),transparent 60%),
  linear-gradient(180deg,#2b2f7a,#171a4a)}
.bg-felt .winner-banner{display:flex;align-items:center;gap:10px}.bg-felt .winner-banner .ic{width:1em;height:1em}
.bg-head{display:flex;align-items:center;justify-content:center;gap:14px;min-height:64px;flex-wrap:wrap;text-align:center}
.bg-status{margin:0;font-weight:800;color:#eef1ff;max-width:34ch}
.bg-last{display:flex;flex-direction:column;align-items:center;gap:2px}
.bg-ball{display:grid;place-items:center;width:58px;height:58px;border-radius:50%;font:700 1.6rem var(--font-display);color:#2a1a00;
  background:radial-gradient(circle at 34% 30%,#fff7d6 0 12%,transparent 30%),radial-gradient(circle at 50% 55%,#ffd76a,#e0a020 75%);box-shadow:inset -3px -5px 8px rgba(0,0,0,.25),0 6px 14px rgba(0,0,0,.35)}
.bg-last small{color:rgba(255,255,255,.7);font-weight:700;font-size:.75rem}
.bg-card{width:min(100%,420px);padding:14px;border-radius:20px;background:linear-gradient(180deg,#fffdf5,#f3ead3);
  background-image:repeating-linear-gradient(180deg,transparent 0 27px,rgba(70,110,200,.10) 27px 28px),linear-gradient(180deg,#fffdf5,#f3ead3);box-shadow:0 18px 36px rgba(0,0,0,.35)}
.bg-letters{display:flex;gap:4px}.bg-letters i{display:grid;place-items:center;width:22px;height:22px;border-radius:6px;font:700 .82rem var(--font-display);font-style:normal;color:rgba(255,255,255,.55);background:rgba(255,255,255,.08);position:relative}
.bg-letters i.on{color:#2a1a00;background:#ffd76a}
.bg-letters i.on::after{content:"";position:absolute;left:3px;right:3px;top:50%;height:2px;background:#c2410c;transform:rotate(-14deg)}
.bg-letters.big{justify-content:center;gap:8px;margin-bottom:10px}
.bg-letters.big i{width:52px;height:44px;font-size:1.7rem;border-radius:12px;color:#5b6aa8;background:#e7e2f5}
.bg-letters.big i.on{color:#fff;background:linear-gradient(180deg,#ff6fae,#d6246a)}
.bg-letters.big i.on::after{height:4px;left:6px;right:6px;background:#2a0f2a}
.bg-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px}
.bg-cell{position:relative;aspect-ratio:1;min-height:44px;padding:0;border:2px solid #c9c2e0;border-radius:12px;background:#fff;color:#1d2340;font:700 1.4rem var(--font-display);cursor:default;transition:transform .12s}
.bg-cell span{position:relative;z-index:1}
.bg-cell.x{color:#3d4370;background:#f1edf9}
.bg-cell.line{background:#ffe9f2;border-color:#ff9cc4}
.bg-cell .bg-x{position:absolute;inset:10%;width:80%;height:80%;z-index:2}
.bg-cell .bg-x path{fill:none;stroke:#d6246a;stroke-opacity:.7;stroke-width:3.2;stroke-linecap:round;stroke-dasharray:70;animation:bg-ink .35s ease-out}
@keyframes bg-ink{from{stroke-dashoffset:70}to{stroke-dashoffset:0}}
.bg-cell.last{box-shadow:0 0 0 3px #ffd76a}
.bg-card.arranging .bg-cell,.bg-cell.can{cursor:pointer}
.bg-card.arranging .bg-cell:active,.bg-cell.can:active{transform:scale(.95)}
.bg-cell.can{border-color:#8b9cff;box-shadow:0 0 0 2px rgba(139,156,255,.35)}
.bg-cell.pick{transform:translateY(-6px) scale(1.06);border-color:#ff6fae;box-shadow:0 10px 18px rgba(214,36,106,.3)}
.bg-actions{width:min(100%,420px);gap:10px}
.bg-actions .ic{width:1em;height:1em}
.bg-hint{margin:0;color:#e3e7ff;font-weight:700}
.bg-watch{display:flex;align-items:center;gap:10px;margin:0}
.bg-player{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;align-items:center;gap:10px;padding:6px 8px;border-radius:12px}
.bg-player.me{background:rgba(255,255,255,.06)}.bg-player.turn{background:rgba(139,156,255,.16)}.bg-player.win{background:rgba(255,215,106,.16)}
.bg-face{display:block;width:38px;height:38px;border-radius:50%;overflow:hidden;box-shadow:0 0 0 3px var(--pc)}.bg-face svg{display:block;width:100%;height:100%}
.bg-pname{display:flex;flex-direction:column;gap:3px;min-width:0}.bg-pname b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bg-pname small{color:var(--muted)}
.bg-player .tag .ic{width:.9em;height:.9em}
.bg-calls h3{display:flex;align-items:center;gap:8px;margin:0 0 8px;font-size:1rem}.bg-calls h3 .ic{width:1em;height:1em}.bg-calls .note{margin-left:auto}
.bg-calllist{display:flex;flex-wrap:wrap;gap:5px}.bg-calllist span{display:grid;place-items:center;min-width:30px;height:30px;border-radius:50%;background:rgba(255,215,106,.18);font:700 .85rem var(--font-display)}
.bg-calllist span.last{background:#ffd76a;color:#2a1a00}
.bg-others{display:flex;flex-wrap:wrap;gap:12px;justify-content:center}
.bg-mini{display:flex;flex-direction:column;gap:6px;align-items:center;padding:10px;border-radius:14px;background:rgba(255,255,255,.06)}
.bg-minigrid{display:grid;grid-template-columns:repeat(5,22px);gap:2px}.bg-minigrid i{display:grid;place-items:center;height:22px;border-radius:4px;background:#fff;color:#1d2340;font:700 .7rem var(--font-display);font-style:normal}
.bg-minigrid i.x{background:#ffd0e2;color:#9a1a50}
@media (max-width:480px){.bg-card{padding:10px}.bg-grid{gap:4px}.bg-cell{font-size:1.15rem;border-radius:10px}.bg-letters.big i{width:44px;height:38px;font-size:1.4rem}.bg-ball{width:50px;height:50px;font-size:1.35rem}}
`;

/* Cover art: two friends at a table with pencils and paper cards; one calls "17!" while the other crosses it,
   and the letters B-I-N-G-O are being struck off (self-contained ids, prefixed bgc-). */
function coverSVG() {
  const grid = (x, y, crossed) => Array.from({ length: 25 }, (_, i) => {
    const r = Math.floor(i / 5), c = i % 5, cx = x + c * 12, cy = y + r * 12;
    return `<rect x="${cx}" y="${cy}" width="11" height="11" rx="1.5" fill="#fff" stroke="#c9c2e0" stroke-width=".6"/><text x="${cx + 5.5}" y="${cy + 8}" text-anchor="middle" font-family="Fredoka,sans-serif" font-weight="700" font-size="5.5" fill="#2a2f5a">${((i * 7) % 25) + 1}</text>${crossed.includes(i) ? `<path d="M${cx + 2} ${cy + 2} L${cx + 9} ${cy + 9} M${cx + 9} ${cy + 2} L${cx + 2} ${cy + 9}" stroke="#d6246a" stroke-width="1.4" stroke-linecap="round"/>` : ''}`;
  }).join('');
  const letter = (ch, i, on) => `<g transform="translate(${92 + i * 28} 16)"><rect width="24" height="24" rx="6" fill="${on ? 'url(#bgc-pink)' : '#e7e2f5'}"/><text x="12" y="18" text-anchor="middle" font-family="Fredoka,sans-serif" font-weight="700" font-size="17" fill="${on ? '#fff' : '#5b6aa8'}">${ch}</text>${on ? '<path d="M3 13 L21 10" stroke="#2a0f2a" stroke-width="2.4" stroke-linecap="round"/>' : ''}</g>`;
  return `<svg viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgc-wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b2f7a"/><stop offset="1" stop-color="#171a4a"/></linearGradient>
    <radialGradient id="bgc-lamp" cx=".5" cy=".2" r=".7"><stop offset="0" stop-color="#ffc45c" stop-opacity=".45"/><stop offset="1" stop-color="#ffc45c" stop-opacity="0"/></radialGradient>
    <linearGradient id="bgc-pink" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff6fae"/><stop offset="1" stop-color="#d6246a"/></linearGradient>
    <linearGradient id="bgc-table" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a0663f"/><stop offset="1" stop-color="#5e3a22"/></linearGradient>
    <linearGradient id="bgc-ball" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe9a8"/><stop offset="1" stop-color="#e0a020"/></linearGradient>
  </defs>
  <rect width="320" height="200" fill="url(#bgc-wall)"/><rect width="320" height="200" fill="url(#bgc-lamp)"/>
  ${[...'BINGO'].map((ch, i) => letter(ch, i, i < 3)).join('')}
  <rect x="0" y="138" width="320" height="62" fill="url(#bgc-table)"/><rect x="0" y="138" width="320" height="4" fill="#c08a5e"/>
  <!-- the caller, left -->
  <g transform="translate(78 86)">
    <path d="M-30 52 q30 -30 60 0 v14 h-60z" fill="#3ec7d6"/>
    <circle cx="0" cy="18" r="19" fill="#c98a5e"/><path d="M-19 16 q0 -24 19 -24 q20 0 19 24 q-6 -12 -19 -13 q-13 1 -19 13z" fill="#1d1430"/>
    <circle cx="-6" cy="19" r="2.2" fill="#1a0f08"/><circle cx="7" cy="19" r="2.2" fill="#1a0f08"/>
    <ellipse cx="1" cy="29" rx="5" ry="4" fill="#7a2a2a"/>
    <path d="M24 56 q18 -14 22 -34" stroke="#c98a5e" stroke-width="7" fill="none" stroke-linecap="round"/>
  </g>
  <g transform="translate(124 64)"><path d="M0 18 L-14 30 L4 22z" fill="#fff"/><circle r="20" fill="#fff"/><text y="8" text-anchor="middle" font-family="Fredoka,sans-serif" font-weight="700" font-size="22" fill="#d6246a">17!</text></g>
  <!-- the player crossing it, right -->
  <g transform="translate(246 88)">
    <path d="M-30 50 q30 -30 60 0 v14 h-60z" fill="#9b6bff"/>
    <circle cx="0" cy="16" r="18" fill="#a86a42"/><path d="M-19 20 q-3 -30 19 -30 q22 0 19 30 l-5 -12 q-14 -8 -28 0z" fill="#2a1430"/>
    <circle cx="-6" cy="17" r="2" fill="#1a0f08"/><circle cx="6" cy="17" r="2" fill="#1a0f08"/><path d="M-6 25 q6 6 12 0" stroke="#6a2a1a" stroke-width="2" fill="none" stroke-linecap="round"/>
  </g>
  <g transform="rotate(-5 60 152)">${grid(30, 124, [0, 6, 12, 18, 24, 3, 9, 16])}</g>
  <g transform="rotate(4 255 152)">${grid(224, 124, [1, 5, 11, 12, 13, 14, 20])}</g>
  <g transform="translate(290 128) rotate(35)"><rect x="-3" y="-26" width="6" height="34" rx="2" fill="#ffd25c"/><path d="M-3 8 L0 16 L3 8z" fill="#f1c39b"/><rect x="-3" y="-30" width="6" height="5" rx="1.5" fill="#ff7aa8"/></g>
  <g fill="#ffd25c"><path d="M300 30 l2 6 l6 2 l-6 2 l-2 6 l-2 -6 l-6 -2 l6 -2z"/><path d="M26 40 l1.5 4 l4 1.5 l-4 1.5 l-1.5 4 l-1.5 -4 l-4 -1.5 l4 -1.5z"/></g>
</svg>`;
}

export default {
  id: 'bingo', name: 'Bingo',
  description: 'The pen-and-paper classic: arrange 1–25 on your card, take turns calling numbers, and be the first to cross off B-I-N-G-O. For 2–8.',
  minPlayers: 2, maxPlayers: 8,
  options: [levelOption()],
  cover: coverSVG(),
  defaultTimer: 30, // also the time to arrange a card before it is accepted as it is
  howTo: {
    goal: 'Be the first to finish five lines and cross off all of B-I-N-G-O.',
    turn: [
      ['✍️', 'Arrange your card', 'Your card holds every number from 1 to 25. Tap two numbers to swap them (or Shuffle) until you like it, then press Ready. Nobody else sees your card.'],
      ['📣', 'Take turns calling', 'On your turn, tap any number that hasn’t been called. Everyone crosses it off their own card.'],
      ['➖', 'Finish lines', 'Each complete row, column or diagonal crosses off the next letter of B-I-N-G-O.'],
      ['🏆', 'Shout BINGO!', 'The first to cross all five letters wins. Players who get there on the same call share the win.'],
    ],
    tips: ['Call numbers that finish your own lines, but every call helps the others too!', 'Your order is your secret: the others can’t see which numbers you need.', 'There is a short turn timer; if it runs out, a helpful number is called for you.'],
  },
  setup, act, turnOf, view, bot, onTimeout, render,
};
