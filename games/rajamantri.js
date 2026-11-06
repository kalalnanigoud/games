// Raja Mantri Chor Sipahi, the Indian chit game for four. Each round four folded chits are dealt: Raja (1000),
// Mantri (800), Sipahi (500) and Chor (0). The Raja and the Mantri show themselves; the Mantri must then name
// the Chor from the other two. Right: everyone keeps their chit's points. Wrong: the Mantri and the Chor swap
// (Mantri 0, Chor 800). All chits are shown, and after the last round the highest total wins.
//
// Computer levels: the Mantri's guess is a coin toss between two people whose chits it can't see, so there is
// no skill a stronger computer could use. The game therefore has no "Computer level" option.
import { esc, log, addFx, shuffle, PLAYER_COLORS } from '../js/util.js';
import { injectCSS, morph } from '../js/fx.js';
import { sound } from '../js/sound.js';
import { icon } from '../js/icons.js';
import { portrait } from '../js/avatar.js';

const browser = typeof document !== 'undefined';
const ROLES = ['raja', 'mantri', 'sipahi', 'chor'];
const POINTS = { raja: 1000, mantri: 800, sipahi: 500, chor: 0 };
const TITLE = { raja: 'Raja', mantri: 'Mantri', sipahi: 'Sipahi', chor: 'Chor' };
const MEANS = { raja: 'King', mantri: 'Minister', sipahi: 'Soldier', chor: 'Thief' };
const ROUNDS = [5, 10];
const REVEAL_MS = 5000; // how long computers let everyone look at the chits before moving on

function setup(players, opts = {}) {
  if (players.length !== 4) throw Error('Raja Mantri Chor Sipahi is for exactly four players.');
  const s = {
    phase: 'guess', over: false, winners: [], log: [],
    rounds: ROUNDS.includes(Number(opts.rounds)) ? Number(opts.rounds) : 5, round: 0,
    players: players.map((p, i) => ({ id: p.id, name: p.name, seat: i, score: 0 })),
    chits: {}, history: [], revealUntil: 0,
  };
  deal(s);
  return s;
}

const player = (s, pid) => s.players.find((p) => p.id === pid);
const holder = (s, role) => s.players.find((p) => s.chits[p.id] === role).id;
const suspects = (s) => s.players.filter((p) => s.chits[p.id] === 'sipahi' || s.chits[p.id] === 'chor').map((p) => p.id);

function deal(s) {
  s.round++;
  const roles = shuffle(ROLES.slice());
  s.chits = Object.fromEntries(s.players.map((p, i) => [p.id, roles[i]]));
  s.phase = 'guess'; s.revealUntil = 0;
  log(s, `Round ${s.round}: ${player(s, holder(s, 'raja')).name} is the Raja. ${player(s, holder(s, 'mantri')).name}, the Mantri, must find the Chor.`);
  addFx(s, { kind: 'sound', sound: 'shuffle' });
}

function resolve(s, mantri, target) {
  const chor = holder(s, 'chor'), correct = target === chor;
  const pts = Object.fromEntries(s.players.map((p) => [p.id, POINTS[s.chits[p.id]]]));
  if (!correct) { pts[mantri] = 0; pts[chor] = POINTS.mantri; }
  for (const p of s.players) {
    p.score += pts[p.id];
    if (pts[p.id]) addFx(s, { kind: 'float', at: `rm-p-${p.id}`, text: `+${pts[p.id]}`, color: '#ffd76a', delay: 250 });
  }
  s.history.push({ round: s.round, chits: { ...s.chits }, mantri, guess: target, chor, correct, pts });
  const M = player(s, mantri).name, C = player(s, chor).name, G = player(s, target).name;
  log(s, correct ? `${M} names ${G}: right! ${C} was the Chor.` : `${M} names ${G}, but ${G} is the Sipahi! ${C} was the Chor and takes the Mantri's 800.`);
  addFx(s, correct ? { kind: 'sound', sound: 'coin' } : { kind: 'sound', sound: 'bad' });
  if (s.round >= s.rounds) {
    s.over = true; s.phase = 'over';
    const best = Math.max(...s.players.map((p) => p.score));
    s.winners = s.players.filter((p) => p.score === best).map((p) => p.id);
    log(s, `${s.winners.map((id) => player(s, id).name).join(' and ')} ${s.winners.length > 1 ? 'share the win' : 'wins'} with ${best} points!`);
    return;
  }
  s.phase = 'reveal';
  s.revealUntil = Date.now() + REVEAL_MS;
}

function act(s, pid, a) {
  if (!player(s, pid)) throw Error('Only the four players can do that.');
  if (!a || typeof a !== 'object') throw Error('Unknown move.');
  if (s.over) throw Error('The game is over.');
  if (a.type === 'think') return; // a computer waiting while everyone looks at the chits
  if (s.phase === 'reveal') {
    if (a.type !== 'next') throw Error('Press Next for the next round.');
    return deal(s);
  }
  // phase 'guess'
  const mantri = holder(s, 'mantri');
  if (a.type !== 'guess') throw Error(pid === mantri ? 'Name the Chor.' : `${player(s, mantri).name}, the Mantri, is choosing.`);
  if (pid !== mantri) throw Error(`Only the Mantri (${player(s, mantri).name}) names the Chor.`);
  if (!suspects(s).includes(a.target)) throw Error('Name one of the two players who are neither Raja nor Mantri.');
  resolve(s, mantri, a.target);
}

function turnOf(s) {
  if (s.over) return [];
  if (s.phase === 'reveal') return s.players.map((p) => p.id); // anyone may move on
  return [holder(s, 'mantri')];
}

// You see your own chit, and the Raja and the Mantri, who show themselves. The Sipahi and the Chor stay
// hidden until the Mantri has guessed.
function view(s, pid) {
  const open = s.phase !== 'guess';
  const v = JSON.parse(JSON.stringify(s));
  v.chits = Object.fromEntries(s.players.map((p) => {
    const c = s.chits[p.id];
    return [p.id, open || p.id === pid || c === 'raja' || c === 'mantri' ? c : null];
  }));
  return v;
}

// The Mantri can't tell the two apart, so a computer guesses at random. In the reveal, it waits a few
// seconds so people can see the chits, then moves on.
function bot(v, pid) {
  if (v.phase === 'reveal') return browser && Date.now() < v.revealUntil ? { type: 'think' } : { type: 'next' };
  const sus = v.players.filter((p) => p.id !== pid && v.chits[p.id] !== 'raja').map((p) => p.id);
  return { type: 'guess', target: sus[Math.floor(Math.random() * sus.length)] };
}
// Time's up: the Mantri guesses at random, and the reveal moves on.
const onTimeout = (v, pid) => bot({ ...v, revealUntil: 0 }, pid);

// ---------------- screen ----------------
const UI = { logOpen: false };

const EMBLEM = {
  raja: '<path d="M8 30 L6 13 L14 20 L20 9 L26 20 L34 13 L32 30z" fill="#ffd45c" stroke="#8a5a00" stroke-width="1.6" stroke-linejoin="round"/><rect x="8" y="29" width="24" height="5" rx="2" fill="#e0a020" stroke="#8a5a00" stroke-width="1.4"/><circle cx="20" cy="24" r="2.4" fill="#d6246a"/><circle cx="6" cy="12" r="2" fill="#ffd45c"/><circle cx="20" cy="8" r="2" fill="#ffd45c"/><circle cx="34" cy="12" r="2" fill="#ffd45c"/>',
  mantri: '<rect x="9" y="9" width="20" height="24" rx="2" fill="#fdf3d8" stroke="#2b7d73" stroke-width="1.6"/><path d="M13 15h12M13 20h12M13 25h8" stroke="#2b7d73" stroke-width="1.6" stroke-linecap="round"/><rect x="7" y="6" width="24" height="5" rx="2.5" fill="#4cc3b5" stroke="#2b7d73" stroke-width="1.4"/><rect x="7" y="31" width="24" height="5" rx="2.5" fill="#4cc3b5" stroke="#2b7d73" stroke-width="1.4"/><path d="M33 4 L25 26 L27 27 L35 6z" fill="#fff" stroke="#2b7d73" stroke-width="1.2"/>',
  sipahi: '<path d="M20 5 L33 10 V20 C33 28 27 33 20 36 C13 33 7 28 7 20 V10z" fill="#5b8cff" stroke="#1f3f86" stroke-width="1.6" stroke-linejoin="round"/><path d="M20 11 L22.5 17 H29 L24 21 L26 28 L20 24 L14 28 L16 21 L11 17 H17.5z" fill="#fff"/>',
  chor: '<path d="M12 14 Q20 6 28 14 L32 30 Q20 38 8 30z" fill="#8a6db1" stroke="#3e2a5e" stroke-width="1.6"/><path d="M14 13 Q20 9 26 13" stroke="#3e2a5e" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M10 18 H30 V24 H10z" fill="#1d1430"/><circle cx="15.5" cy="21" r="2" fill="#fff"/><circle cx="24.5" cy="21" r="2" fill="#fff"/><text x="20" y="33" text-anchor="middle" font-family="Fredoka,sans-serif" font-weight="700" font-size="7" fill="#fff">?</text>',
};
const emblem = (role) => `<svg class="rm-emb" viewBox="0 0 40 40" aria-hidden="true">${EMBLEM[role]}</svg>`;
const chitFace = (role, extra = '') => `<div class="rm-chit up rm-${role}">${emblem(role)}<b>${TITLE[role]}</b><small>${MEANS[role]} · ${POINTS[role]}</small>${extra}</div>`;
const chitBack = '<div class="rm-chit down"><svg class="rm-emb" viewBox="0 0 40 40" aria-hidden="true"><path d="M8 8h24v24H8z" fill="none" stroke="#c9a46a" stroke-width="1.6" stroke-dasharray="3 2"/><text x="20" y="27" text-anchor="middle" font-family="Fredoka,sans-serif" font-weight="700" font-size="18" fill="#8a6a3a">?</text></svg><b>Folded</b><small>Hidden chit</small></div>';

function render(el, v, ctx) {
  injectCSS('rajamantri', STYLE);
  const me = v.players.find((p) => p.id === ctx.me);
  const meId = me ? me.id : null;
  const N = (id) => esc(v.players.find((p) => p.id === id)?.name || '?');
  const roleOf = (id) => v.chits[id];
  const mantri = v.players.find((p) => roleOf(p.id) === 'mantri')?.id;
  const guessing = v.phase === 'guess' && !v.over;
  const iAmMantri = guessing && meId && mantri === meId;
  const last = !guessing ? v.history[v.history.length - 1] : null;
  const myRole = meId ? roleOf(meId) : null;
  const anyBot = v.players.some((p) => ctx.isBot?.(p.id));

  let status;
  if (v.over) status = v.winners.includes(meId) ? (v.winners.length > 1 ? 'You share the win!' : 'You win!') : `${esc(v.winners.map((id) => v.players.find((p) => p.id === id).name).join(' and '))} ${v.winners.length > 1 ? 'share the win' : 'wins'}!`;
  else if (guessing) {
    status = !meId ? `${N(mantri)}, the Mantri, is looking for the Chor…`
      : myRole === 'mantri' ? 'You are the Mantri! Who is the Chor?'
      : myRole === 'raja' ? `You are the Raja. ${N(mantri)} is hunting the Chor for you.`
      : myRole === 'chor' ? `You are the Chor! Keep a straight face while ${N(mantri)} decides…`
      : `You are the Sipahi. Hope ${N(mantri)} catches the Chor!`;
  } else status = last.correct ? `${N(last.mantri)} caught the Chor, ${N(last.chor)}!` : `Wrong guess! ${N(last.chor)} was the Chor.`;
  const sub = guessing ? (iAmMantri ? 'One of these two is the Sipahi, the other is the Chor. Tap the one you think is the Chor.' : 'Raja and Mantri show their chits; the other two stay folded.')
    : last ? (last.correct ? 'Everyone keeps the points on their chit.' : `The Mantri and the Chor swap: ${N(last.mantri)} gets 0, ${N(last.chor)} takes 800.`) : '';

  const seat = (p) => {
    const role = roleOf(p.id);
    const sus = guessing && role !== 'raja' && role !== 'mantri';
    const accusable = iAmMantri && p.id !== meId && sus;
    const secretMine = guessing && p.id === meId && (role === 'sipahi' || role === 'chor');
    const pts = last ? last.pts[p.id] : null;
    const accused = last && last.guess === p.id;
    const chit = role ? chitFace(role, secretMine ? `<em class="rm-secret">${icon('eye')}Only you</em>` : '') : chitBack;
    return `<div class="rm-seat ${p.id === meId ? 'me' : ''} ${accusable ? 'can' : ''} ${v.winners.includes(p.id) ? 'win' : ''} ${guessing && p.id === mantri ? 'turn' : ''}" data-k="rm-seat-${p.id}" data-a="rm-p-${p.id}">
      <div class="rm-who"><span class="rm-face" style="--pc:${PLAYER_COLORS[p.seat % PLAYER_COLORS.length]}">${portrait({ id: p.id, bot: !!ctx.isBot?.(p.id) })}</span>
        <span class="rm-name"><b>${esc(p.name)}</b><small>${p.score} pts</small></span>${p.id === meId ? '<span class="tag t-you">You</span>' : ''}</div>
      ${chit}
      ${accusable ? `<button class="primary rm-accuse pulse-glow" data-guess="${esc(p.id)}">${icon('search')}This is the Chor</button>` : ''}
      ${accused ? `<span class="tag ${last.correct ? 't-good' : 't-warn'} rm-acc">${last.correct ? icon('check') : icon('close')}Accused</span>` : ''}
      ${pts != null ? `<span class="rm-pts ${pts ? '' : 'zero'}">+${pts}</span>` : ''}
    </div>`;
  };

  // One row per round, one column per player, so ten rounds still fit the side column on a phone.
  const head = v.players.map((p) => `<th class="${p.id === meId ? 'me' : ''}"><span>${esc(p.name)}</span></th>`).join('');
  const rows = v.history.slice().reverse().map((h) => `<tr><th>R${h.round}</th>${v.players.map((p) => `<td class="${h.guess === p.id ? 'acc' : ''}"><span class="rm-mini rm-${h.chits[p.id]}" title="${TITLE[h.chits[p.id]]}">${TITLE[h.chits[p.id]][0]}</span>${h.pts[p.id]}</td>`).join('')}</tr>`).join('');
  const totals = `<tr class="rm-totals"><th>Total</th>${v.players.map((p) => `<td class="${v.winners.includes(p.id) ? 'win' : ''}">${p.score}</td>`).join('')}</tr>`;
  const table = `<table class="rm-table"><thead><tr><th></th>${head}</tr></thead><tbody>${totals}${rows}</tbody></table>${v.history.length ? '' : '<p class="muted small" style="margin:6px 0 0">Points appear after each round.</p>'}`;
  UI.logOpen = el.querySelector('.rm-logbox')?.open ?? UI.logOpen;

  morph(el, `<div class="rm-root"><div class="game-layout">
    <div class="felt rm-felt">
      ${v.over ? `<div class="winner-banner">${icon('trophy')}${status}</div>` : ''}
      <div class="rm-head"><span class="rm-round">Round ${v.round} of ${v.rounds}</span><p class="rm-status">${v.over ? (last.correct ? `Last round: ${N(last.mantri)} caught ${N(last.chor)}.` : `Last round: ${N(last.chor)} the Chor escaped.`) : status}</p>${sub ? `<p class="rm-sub">${sub}</p>` : ''}</div>
      <div class="rm-seats">${v.players.map(seat).join('')}</div>
      ${v.phase === 'reveal' && !v.over ? `<div class="rm-next">${meId ? `<button class="primary" id="rmNext">${icon('play')}Next round</button>` : ''}<small>${anyBot ? 'The next round starts in a few seconds.' : meId ? 'Anyone can start the next round.' : 'Waiting for a player to start the next round.'}</small></div>` : ''}
      ${!meId && !v.over ? `<div class="panel rm-watch">${icon('eye')}<span>You are watching. The folded chits open after the Mantri's guess.</span></div>` : ''}
    </div>
    <div class="side">
      <div class="panel rm-scores"><h3>${icon('trophy')}Scores</h3>${table}</div>
      <div class="panel rm-legend">${ROLES.map((r) => `<div class="rm-leg rm-${r}">${emblem(r)}<b>${TITLE[r]}</b><span>${POINTS[r]}</span></div>`).join('')}</div>
      <details class="panel drawer rm-logbox" ${UI.logOpen ? 'open' : ''}><summary>${icon('book')}<span>Game log</span>${icon('chevron', 'chev')}</summary>
        <div class="drawer-body"><div class="parchment log">${v.log.slice(0, 12).map((l) => `<div>${esc(l)}</div>`).join('')}</div></div></details>
    </div>
  </div></div>`);

  const lb = el.querySelector('.rm-logbox'); if (lb) lb.ontoggle = () => { UI.logOpen = lb.open; };
  el.querySelectorAll('[data-guess]').forEach((b) => (b.onclick = () => { sound('click'); ctx.send({ type: 'guess', target: b.dataset.guess }); }));
  const nx = el.querySelector('#rmNext'); if (nx) nx.onclick = () => ctx.send({ type: 'next' });
}

const STYLE = `
.rm-felt{display:flex;flex-direction:column;align-items:center;gap:14px;background:
  radial-gradient(70% 45% at 50% 0%,rgba(255,200,90,.25),transparent 70%),
  repeating-linear-gradient(45deg,rgba(255,215,106,.05) 0 2px,transparent 2px 18px),
  repeating-linear-gradient(-45deg,rgba(255,215,106,.05) 0 2px,transparent 2px 18px),
  linear-gradient(180deg,#6d1f33,#3a0f22)}
.rm-felt .winner-banner{display:flex;align-items:center;gap:10px}.rm-felt .winner-banner .ic{width:1em;height:1em}
.rm-head{display:flex;flex-direction:column;align-items:center;gap:4px;text-align:center}
.rm-round{font:800 .72rem var(--font-body);letter-spacing:.12em;text-transform:uppercase;color:#ffd76a;background:rgba(0,0,0,.25);padding:3px 10px;border-radius:999px}
.rm-status{margin:0;font:700 1.15rem var(--font-display);color:#fff;max-width:36ch}
.rm-sub{margin:0;color:#f6dfe6;font-weight:700;font-size:.9rem;max-width:44ch}
.rm-seats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;width:100%;max-width:720px}
.rm-seat{position:relative;display:flex;flex-direction:column;align-items:center;gap:8px;padding:10px 8px 12px;border-radius:18px;background:rgba(0,0,0,.22);border:2px solid rgba(255,215,106,.18);min-width:0}
.rm-seat.me{background:rgba(255,255,255,.08)}
.rm-seat.turn{border-color:rgba(255,215,106,.8)}
.rm-seat.can{border-color:#ffd76a;background:rgba(255,215,106,.12)}
.rm-seat.win{background:rgba(255,215,106,.22)}
.rm-who{display:flex;align-items:center;gap:8px;max-width:100%;min-width:0}
.rm-seat .t-you{position:absolute;top:-10px;left:10px}.rm-name small{white-space:nowrap}
.rm-face{display:block;flex:none;width:40px;height:40px;border-radius:50%;overflow:hidden;box-shadow:0 0 0 3px var(--pc)}.rm-face svg{display:block;width:100%;height:100%}
.rm-name{display:flex;flex-direction:column;min-width:0}.rm-name b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.rm-name small{color:#f6dfe6;font-weight:700}
.rm-chit{position:relative;display:flex;flex-direction:column;align-items:center;gap:2px;width:100%;max-width:150px;padding:10px 6px 8px;border-radius:12px;color:#2a1a10;
  background:linear-gradient(180deg,#fffaf0,#f1e2c2);box-shadow:0 8px 16px rgba(0,0,0,.3),inset 0 -3px 0 rgba(0,0,0,.08);animation:rm-flip .45s ease-out}
.rm-chit::before{content:"";position:absolute;left:8px;right:8px;top:50%;border-top:1px dashed rgba(120,80,30,.25)}
.rm-chit b{font:700 1.1rem var(--font-display);position:relative}.rm-chit small{font-weight:800;font-size:.72rem;color:#6a4a2a;position:relative}
.rm-chit.down{background:repeating-linear-gradient(135deg,#f3e3c3 0 6px,#ead6ad 6px 12px);color:#6a4a2a}
.rm-emb{width:44px;height:44px;position:relative}
.rm-chit.rm-raja{box-shadow:0 0 0 3px #ffd45c,0 8px 16px rgba(0,0,0,.3)}
.rm-chit.rm-mantri{box-shadow:0 0 0 3px #4cc3b5,0 8px 16px rgba(0,0,0,.3)}
.rm-chit.rm-sipahi{box-shadow:0 0 0 3px #5b8cff,0 8px 16px rgba(0,0,0,.3)}
.rm-chit.rm-chor{box-shadow:0 0 0 3px #8a6db1,0 8px 16px rgba(0,0,0,.3)}
@keyframes rm-flip{from{transform:rotateY(80deg)}to{transform:none}}
.rm-secret{display:inline-flex;align-items:center;gap:4px;margin-top:3px;font:800 .68rem var(--font-body);font-style:normal;color:#6a2a4a;background:#ffe1ec;border-radius:999px;padding:2px 7px;position:relative}
.rm-secret .ic{width:12px;height:12px}
.rm-accuse{width:100%;min-height:44px;display:flex;align-items:center;justify-content:center;gap:6px;font-size:.9rem;padding:6px 8px}
.rm-accuse .ic{width:1em;height:1em;flex:none}
.rm-acc .ic{width:.9em;height:.9em}
.rm-pts{position:absolute;top:-10px;right:-6px;font:700 .95rem var(--font-display);color:#2a1a00;background:#ffd76a;border-radius:999px;padding:2px 9px;box-shadow:0 3px 8px rgba(0,0,0,.3)}
.rm-pts.zero{background:#e7dce2;color:#6a4a5a;text-decoration:line-through}
.rm-next{display:flex;flex-direction:column;align-items:center;gap:6px}.rm-next button{min-height:48px;min-width:180px;display:flex;align-items:center;justify-content:center;gap:8px}
.rm-next .ic{width:1em;height:1em}.rm-next small{color:#f6dfe6;font-weight:700}
.rm-watch{display:flex;align-items:center;gap:10px;margin:0}.rm-watch .ic{width:1.2em;height:1.2em;flex:none}
.rm-scores h3{display:flex;align-items:center;gap:8px;margin:0 0 8px;font-size:1rem}.rm-scores h3 .ic{width:1em;height:1em}
.rm-table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:.8rem}
.rm-table th,.rm-table td{padding:5px 3px;text-align:right;white-space:nowrap;border-bottom:1px solid var(--line)}
.rm-table th:first-child{width:46px;text-align:left;color:var(--muted);font-weight:800}
.rm-table thead th span{display:block;overflow:hidden;text-overflow:ellipsis;font-size:.74rem;color:var(--muted)}
.rm-table thead th.me span{color:#a9dcff}
.rm-table td.acc{text-decoration:underline dotted;text-underline-offset:3px}
.rm-totals td{font:700 .95rem var(--font-display)}.rm-totals td.win{color:#ffd76a}.rm-totals td.win::before{content:"★ ";font-size:.75em}
.rm-mini{display:inline-grid;place-items:center;width:16px;height:16px;margin-right:4px;border-radius:4px;font:800 .62rem var(--font-body);color:#1d1430;vertical-align:1px}
.rm-mini.rm-raja{background:#ffd45c}.rm-mini.rm-mantri{background:#4cc3b5}.rm-mini.rm-sipahi{background:#8fb0ff}.rm-mini.rm-chor{background:#bba6dc}
.rm-legend{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.rm-leg{display:flex;align-items:center;gap:6px;font-size:.85rem}.rm-leg .rm-emb{width:28px;height:28px}.rm-leg span{margin-left:auto;color:var(--muted);font-weight:700}
@media (min-width:900px){.rm-chit .rm-emb{width:58px;height:58px}.rm-chit{padding:16px 6px 12px}.rm-chit b{font-size:1.25rem}.rm-felt{padding-top:22px;padding-bottom:22px}}
@media (max-width:640px){.rm-seats{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.rm-status{font-size:1.05rem}}
`;

/* Cover art: four friends sit on a rug in a lamp-lit courtyard with folded paper chits. The Raja wears a
   paper crown, the Mantri points at a nervous suspect ("Chor?"), and the Sipahi grins with a stick
   (self-contained ids, prefixed rmc-). */
function coverSVG() {
  const kid = (x, y, s, skin, hair, shirt, face) => `<g transform="translate(${x} ${y}) scale(${s})">
    <path d="M-26 46 q0 -36 26 -40 q26 4 26 40z" fill="${shirt}"/>
    <circle cx="0" cy="-8" r="18" fill="${skin}"/>
    <path d="M-18 -10 q0 -22 18 -22 q18 0 18 22 q-6 -12 -18 -12 q-12 0 -18 12z" fill="${hair}"/>
    ${face}</g>`;
  const eyes = '<circle cx="-6" cy="-7" r="2.2" fill="#1a0f08"/><circle cx="6" cy="-7" r="2.2" fill="#1a0f08"/>';
  const chit = (x, y, r, c = '#fdf3d8') => `<g transform="translate(${x} ${y}) rotate(${r})"><rect x="-9" y="-6" width="18" height="12" rx="2" fill="${c}" stroke="#b08850" stroke-width="1"/><path d="M-9 0h18" stroke="#b08850" stroke-width=".7" stroke-dasharray="2 1.5"/></g>`;
  return `<svg viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="rmc-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a0f22"/><stop offset="1" stop-color="#7a2438"/></linearGradient>
    <radialGradient id="rmc-glow" cx=".5" cy=".55" r=".6"><stop offset="0" stop-color="#ffc45c" stop-opacity=".5"/><stop offset="1" stop-color="#ffc45c" stop-opacity="0"/></radialGradient>
    <linearGradient id="rmc-rug" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c2410c"/><stop offset="1" stop-color="#7c2d12"/></linearGradient>
    <linearGradient id="rmc-crown" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff0a8"/><stop offset="1" stop-color="#e0a020"/></linearGradient>
  </defs>
  <rect width="320" height="200" fill="url(#rmc-sky)"/>
  <g fill="#5a1628" stroke="#9a3a4a" stroke-width="2">
    <path d="M10 120 V50 q30 -36 60 0 V120z"/><path d="M90 120 V50 q30 -36 60 0 V120z"/><path d="M170 120 V50 q30 -36 60 0 V120z"/><path d="M250 120 V50 q30 -36 60 0 V120z"/>
  </g>
  <g fill="#ffd25c"><circle cx="40" cy="44" r="2"/><circle cx="120" cy="40" r="1.6"/><circle cx="280" cy="42" r="2"/><circle cx="205" cy="36" r="1.4"/></g>
  <g transform="translate(160 22)"><path d="M0 0 v10" stroke="#c9a46a" stroke-width="1.5"/><path d="M-8 10 h16 l-3 14 h-10z" fill="#ffb02e"/><ellipse cx="0" cy="18" rx="4" ry="5" fill="#fff6c2"/></g>
  <rect width="320" height="200" fill="url(#rmc-glow)"/>
  <rect x="0" y="118" width="320" height="82" fill="#3a1420"/>
  <ellipse cx="160" cy="160" rx="150" ry="38" fill="url(#rmc-rug)"/>
  <ellipse cx="160" cy="160" rx="132" ry="30" fill="none" stroke="#ffd25c" stroke-width="2" stroke-dasharray="6 4"/>
  ${chit(150, 160, -12)}${chit(172, 166, 18)}${chit(162, 150, 4, '#fff7e6')}
  <!-- the Raja, back left, with a paper crown -->
  ${kid(108, 118, 0.9, '#c98a5e', '#1d1430', '#ffd45c', `${eyes}<path d="M-6 3 q6 5 12 0" stroke="#5a2a1a" stroke-width="2" fill="none" stroke-linecap="round"/>`)}
  <path d="M93 92 L91 78 L99 84 L108 72 L117 84 L125 78 L123 92z" fill="url(#rmc-crown)" stroke="#8a5a00" stroke-width="1.2"/>
  <!-- the Mantri, back right, pointing -->
  ${kid(212, 118, 0.9, '#a86a42', '#2a1430', '#4cc3b5', `${eyes}<ellipse cx="0" cy="3" rx="4" ry="3" fill="#7a2a2a"/>`)}
  
  <g transform="translate(250 66)"><path d="M-30 6 L-38 18 L-20 10z" fill="#fff"/><rect x="-30" y="-12" width="56" height="24" rx="12" fill="#fff"/><text x="-2" y="5" text-anchor="middle" font-family="Fredoka,sans-serif" font-weight="700" font-size="14" fill="#7a2438">Chor?</text></g>
  <!-- the Sipahi, front left, with a stick -->
  ${kid(78, 158, 1, '#e0a57a', '#4a2f1f', '#5b8cff', `${eyes}<path d="M-6 2 h12 q-1 5 -6 5 t-6 -5z" fill="#7a2e35"/>`)}
  <path d="M46 196 L60 128" stroke="#8a5a2b" stroke-width="5" stroke-linecap="round"/>
  <!-- the suspect, front right, sweating -->
  ${kid(244, 160, 1, '#c3814f', '#2b1d16', '#8a6db1', '<circle cx="-6" cy="-7" r="2.6" fill="#fff"/><circle cx="6" cy="-7" r="2.6" fill="#fff"/><circle cx="-5" cy="-7" r="1.4" fill="#1a0f08"/><circle cx="7" cy="-7" r="1.4" fill="#1a0f08"/><path d="M-5 4 q2 -2 4 0 q2 2 4 0 q2 -2 3 0" stroke="#5a2a1a" stroke-width="1.6" fill="none" stroke-linecap="round"/>')}
  <path d="M262 136 q4 6 0 10 q-4 -4 0 -10z" fill="#9fe3ff"/>
  <path d="M228 140 q10 -12 22 -16" stroke="#a86a42" stroke-width="7" fill="none" stroke-linecap="round"/><path d="M250 124 l9 -3" stroke="#a86a42" stroke-width="4" stroke-linecap="round"/><path d="M228 132 q3 5 0 8 q-3 -3 0 -8z" fill="#9fe3ff"/>
  <g transform="translate(270 178) rotate(14)"><rect x="-10" y="-7" width="20" height="14" rx="2" fill="#fdf3d8" stroke="#b08850"/><text x="0" y="4" text-anchor="middle" font-family="Fredoka,sans-serif" font-weight="700" font-size="8" fill="#8a6db1">?</text></g>
</svg>`;
}

export default {
  id: 'rajamantri', name: 'Raja Mantri Chor Sipahi',
  description: 'The chit game from Indian school benches: draw a folded chit, crown the Raja, and let the Mantri name the Chor. Guess right and everyone scores; guess wrong and the Chor runs off with the Mantri’s points. For 4.',
  minPlayers: 4, maxPlayers: 4,
  options: [{ id: 'rounds', label: 'Rounds', default: '5', choices: [['5', '5 rounds'], ['10', '10 rounds']] }],
  cover: coverSVG(),
  defaultTimer: 20,
  howTo: {
    goal: 'Have the most points after the last round.',
    turn: [
      ['📜', 'Draw a chit', 'Four folded chits are dealt: Raja 1000, Mantri 800, Sipahi 500 and Chor 0. Only you see your own.'],
      ['👑', 'Raja and Mantri show themselves', 'Everyone sees who the Raja and the Mantri are. The Sipahi and the Chor stay hidden.'],
      ['🔍', 'The Mantri names the Chor', 'The Mantri picks one of the other two. Right: everyone scores their chit. Wrong: the Mantri gets 0 and the Chor takes the Mantri’s 800.'],
      ['🏆', 'Add it up', 'All chits are shown, then a new round is dealt. After the last round the highest total wins; level totals share the win.'],
    ],
    tips: ['As the Chor, keep a straight face when you play together in a room!', 'It is mostly luck, so it is quick and fair for every age.', 'Anyone can press Next to start the next round.'],
  },
  setup, act, turnOf, view, bot, onTimeout, render,
};
