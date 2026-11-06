// Number-calling games (Bingo, Tambola), built from a small spec: how a card is dealt, which prizes there are
// and when a card completes one, how a ball is labelled and read out, plus art.
//
// How a game runs:
// - The host's state holds the shuffled balls (hidden from every view), the numbers called so far and when the
//   next call is due. Any player's screen, and any computer player, asks for the next call when it is due
//   ({ type: 'call', n }); the first ask for call n draws a ball, the rest change nothing.
// - Players mark their card on their own device (tap, or auto-mark). A claim is checked by the host against the
//   numbers actually called, so marks never travel over the network.
// - Everyone who rightly claims a prize before the next number is called shares it, so a prize isn't won by
//   whoever taps fastest. A wrong claim is a "bogey": no claims for the next few numbers.
// - The last prize (Bingo, or Tambola's Full House) leaves a short window for anyone else on the same number,
//   then the game ends. Most points wins.
import { esc, log, addFx, shuffle, PLAYER_COLORS } from '../js/util.js';
import { injectCSS, morph } from '../js/fx.js';
import { sound } from '../js/sound.js';
import { icon } from '../js/icons.js';
import { portrait } from '../js/avatar.js';
import { levelOption, levelOf } from '../js/levels.js';

const browser = typeof document !== 'undefined';
// Calls are paced by the clock on the host; Node simulations call as fast as moves are played.
const paced = () => globalThis.callerPaced ?? browser;
// Long enough to find the number on a ticket, mark it and claim (5.5 s felt too fast in play).
export const PACES = { relaxed: 12000, normal: 8000, quick: 5000 };
const READY_MS = 4000; // before the first ball
const LAST_CALL_MS = 4000; // after the last prize, for anyone else on the same number
const BOGEY_CALLS = 3;
// How often a computer player notices that a prize is complete on a given number.
const NOTICE = { easy: 0.2, normal: 0.75, hard: 1 };

const paceOption = { id: 'pace', label: 'Calling pace', default: 'normal', choices: [['relaxed', 'Relaxed (12 s)'], ['normal', 'Normal (8 s)'], ['quick', 'Quick (5 s)']] };

// The same small number for the same player on the same call: a computer either notices on this number or not,
// however often it is asked.
function roll(pid, n, salt) {
  let h = 2166136261;
  for (const c of `${pid}:${n}:${salt}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

// A spec describes each prize as alternatives of numbers ({ sets: [[...], ...], need }): the prize is complete
// when, for any one set, at least `need` of its numbers (all of them, if need is left out) are "had".
// 0 is the free space and always counts.
function progress(spec, card, prizeId, has) {
  const { sets, need } = spec.goal(card, prizeId);
  let best = Infinity;
  for (const set of sets) {
    const got = set.filter((x) => x === 0 || has(x)).length;
    best = Math.min(best, Math.max(0, (need ?? set.length) - got));
  }
  return best;
}

export function callerGame(spec) {
  const T = spec.id; // CSS prefix for the game's own theme
  const complete = (card, id, called) => progress(spec, card, id, (x) => called.has(x)) === 0;
  const togo = (card, id, called) => progress(spec, card, id, (x) => called.has(x));

  // ---------------- rules ----------------
  function setup(players, opts = {}) {
    const pace = PACES[opts?.pace] ? opts.pace : 'normal';
    const s = {
      phase: 'play', over: false, winners: [], log: [], level: levelOf(opts),
      gid: shuffle('abcdefghijkmnpqrstuvwxyz23456789'.split('')).slice(0, 10).join(''),
      pace, paceMs: PACES[pace], max: spec.max,
      deck: shuffle(Array.from({ length: spec.max }, (_, i) => i + 1)),
      calls: [], nextAt: paced() ? Date.now() + READY_MS : 0, ending: false,
      prizes: spec.prizes(opts || {}).map((p) => ({ ...p, winners: [], at: null })),
      players: players.map((p, i) => ({ id: p.id, name: p.name, seat: i, score: 0, lock: 0, card: spec.makeCard() })),
    };
    log(s, `${spec.name} begins: ${s.prizes.map((p) => p.name).join(', ')}. The first number is coming up.`);
    return s;
  }

  const names = (s, ids) => ids.map((id) => s.players.find((p) => p.id === id)?.name || '?').join(' and ');

  function finish(s) {
    s.over = true; s.phase = 'over'; s.ending = false;
    const top = Math.max(0, ...s.players.map((p) => p.score));
    s.winners = top > 0 ? s.players.filter((p) => p.score === top).map((p) => p.id) : [];
    log(s, s.winners.length ? `Game over: ${names(s, s.winners)} ${s.winners.length > 1 ? 'share the win' : 'wins'} with ${top} point${top === 1 ? '' : 's'}.` : 'Game over: nobody claimed a prize.');
  }

  function call(s, a) {
    if (!Number.isInteger(a.n) || a.n !== s.calls.length) return; // another screen already asked for this call
    if (paced() && Date.now() < s.nextAt - 250) return; // not yet
    if (s.ending || !s.deck.length) return finish(s);
    const n = s.deck.pop();
    s.calls.push(n);
    s.nextAt = paced() ? Date.now() + s.paceMs : 0;
    addFx(s, { kind: 'sound', sound: 'place' });
  }

  function claim(s, me, id) {
    const prize = s.prizes.find((p) => p.id === id);
    if (!prize) throw Error('There is no such prize.');
    if (!s.calls.length) throw Error('No numbers have been called yet.');
    if (prize.winners.includes(me.id)) throw Error(`You already have ${prize.name}.`);
    if (prize.winners.length && prize.at !== s.calls.length) throw Error(`${prize.name} has already gone to ${names(s, prize.winners)}.`);
    if (me.lock > s.calls.length) {
      const n = me.lock - s.calls.length;
      throw Error(`Bogey! You can claim again after ${n} more number${n === 1 ? '' : 's'}.`);
    }
    if (!complete(me.card, prize.id, new Set(s.calls))) {
      me.lock = s.calls.length + BOGEY_CALLS;
      log(s, `Bogey! ${me.name}'s ${prize.name} claim doesn't check out: no claims for the next ${BOGEY_CALLS} numbers.`);
      addFx(s, { kind: 'shake', at: `cl-p-${me.id}` });
      addFx(s, { kind: 'sound', sound: 'bad' });
      return;
    }
    const first = !prize.winners.length;
    prize.winners.push(me.id);
    if (first) prize.at = s.calls.length;
    me.score += prize.pts;
    log(s, first ? `${me.name} claims ${prize.name}! +${prize.pts}` : `${me.name} also had ${prize.name} on the same number and shares it! +${prize.pts}`);
    addFx(s, { kind: 'float', at: `cl-p-${me.id}`, text: `+${prize.pts}`, color: '#ffd76a' });
    addFx(s, { kind: 'sound', sound: 'win' });
    if (prize.last || s.prizes.every((p) => p.winners.length)) {
      s.ending = true;
      if (paced()) s.nextAt = Date.now() + LAST_CALL_MS;
    }
  }

  function act(s, pid, a) {
    const me = s.players.find((p) => p.id === pid);
    if (!me) throw Error('Only players at the table can do that.');
    if (!a || typeof a !== 'object') throw Error('Unknown move.');
    if (a.type === 'wait') return;
    if (s.over) throw Error('The game is over.');
    if (a.type === 'call') return call(s, a);
    if (a.type === 'claim') return claim(s, me, a.prize);
    throw Error('Unknown move.');
  }

  // The prize everyone is chasing now: the first one nobody has yet, else the last.
  const headline = (s) => s.prizes.find((p) => !p.winners.length) || s.prizes.at(-1);

  function view(s, pid) {
    const { deck, ...rest } = s;
    const called = new Set(s.calls), head = headline(s);
    return {
      ...JSON.parse(JSON.stringify(rest)), left: deck.length, hostNow: Date.now(),
      players: s.players.map((p) => ({ id: p.id, name: p.name, seat: p.seat, score: p.score, lock: p.lock,
        togo: togo(p.card, head.id, called), card: p.id === pid ? JSON.parse(JSON.stringify(p.card)) : null })),
    };
  }

  function bot(v, pid) {
    const me = v.players.find((p) => p.id === pid);
    if (!me || v.over) return { type: 'wait' };
    const called = new Set(v.calls), n = v.calls.length;
    if (me.lock <= n && me.card) {
      for (const prize of v.prizes) {
        const open = !prize.winners.length || (prize.at === n && !prize.winners.includes(pid));
        if (open && complete(me.card, prize.id, called) && roll(pid, n, prize.id) < NOTICE[v.level || 'normal']) return { type: 'claim', prize: prize.id };
      }
    }
    return !paced() || Date.now() >= v.nextAt ? { type: 'call', n } : { type: 'wait' };
  }

  // ---------------- screen ----------------
  // Marks and settings live on this device only.
  const UI = { key: '', marks: new Set(), v: null, ctx: null, root: null, offset: 0, sent: 0, seen: -1, playersOpen: true, boardOpen: false, logOpen: false };
  const pref = (k, d) => { try { const x = localStorage.getItem('gn-caller-' + k); return x == null ? d : x === '1'; } catch { return d; } };
  const setPref = (k, on) => { try { localStorage.setItem('gn-caller-' + k, on ? '1' : '0'); } catch {} };
  const markKey = () => `gn-marks-${T}-${UI.key}`;
  const saveMarks = () => { try { sessionStorage.setItem(markKey(), JSON.stringify([...UI.marks])); } catch {} };
  const loadMarks = () => { try { return new Set(JSON.parse(sessionStorage.getItem(markKey()) || '[]')); } catch { return new Set(); } };

  function say(n) {
    if (!pref('voice', false) || !browser || !('speechSynthesis' in window)) return;
    try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(spec.speak(n)); u.rate = 0.95; speechSynthesis.speak(u); } catch {}
  }

  // One clock for the whole page: the countdown ring, and asking for the next call when it is due.
  let ticking = false;
  function startClock() {
    if (ticking || !browser) return;
    ticking = true;
    setInterval(() => {
      const v = UI.v;
      if (!v || !UI.root?.isConnected) return;
      const now = Date.now() + UI.offset, wait = Math.max(0, v.nextAt - now);
      const ring = UI.root.querySelector('.cl-ring');
      if (ring) {
        const total = v.ending ? LAST_CALL_MS : v.calls.length ? v.paceMs : READY_MS;
        ring.style.setProperty('--p', v.over ? 0 : Math.min(1, wait / total).toFixed(3));
        const sec = ring.querySelector('b');
        if (sec) sec.textContent = v.over ? '' : String(Math.ceil(wait / 1000));
      }
      const atTable = v.players.some((p) => p.id === UI.ctx?.me);
      if (!v.over && atTable && now > v.nextAt + 300 && Date.now() - UI.sent > 1500) { UI.sent = Date.now(); UI.ctx.send({ type: 'call', n: v.calls.length }); }
    }, 250);
  }

  function render(el, v, ctx) {
    injectCSS('caller-kit', KIT_STYLE);
    injectCSS(T, spec.style);
    startClock();
    if (UI.key !== v.gid) { UI.key = v.gid; UI.marks = loadMarks(); UI.seen = v.calls.length; }
    if (v.hostNow) UI.offset = v.hostNow - Date.now();
    UI.v = v; UI.ctx = ctx; UI.root = el;
    const me = v.players.find((p) => p.id === ctx.me);
    const card = me?.card;
    const called = new Set(v.calls), n = v.calls.length;
    const auto = pref('auto', false);
    const marked = (x) => x === 0 || (auto ? called.has(x) : UI.marks.has(x) && called.has(x));
    const fresh = n > UI.seen && UI.seen >= 0;
    if (fresh) say(v.calls.at(-1));
    UI.seen = n;
    const last = v.calls.at(-1);

    // ---- the caller: the newest ball, the countdown, the trail of recent balls ----
    const ball = (x, big) => `<span class="cl-ball ${spec.ballClass(x)} ${big ? 'big' : ''}" data-k="cl-ball-${x}" aria-hidden="true"><i>${spec.ballText(x)}</i></span>`;
    const trail = v.calls.slice(-7, -1).reverse().map((x) => ball(x, false)).join('');
    const nick = last != null ? spec.nick?.(last) : '';
    const callLine = v.over ? 'Game over' : v.ending ? 'Last call for claims on this number' : last == null ? 'The first number is coming up' : `Number ${n} of ${v.max}`;
    const caller = `<div class="cl-caller">
      <div class="cl-now ${fresh ? (n % 2 ? 'cl-pop' : 'cl-pop2') : ''}">${last != null ? ball(last, true) : `<span class="cl-ball cl-empty big"><i>?</i></span>`}</div>
      <div class="cl-callinfo"><b class="cl-label">${last != null ? esc(spec.label(last)) : 'Get ready'}</b>${nick ? `<span class="cl-nick">“${esc(nick)}”</span>` : ''}<small>${callLine}</small></div>
      ${v.over ? '' : '<div class="cl-ring" style="--p:1" title="Next number"><b></b></div>'}
      <div class="cl-trail">${trail}</div>
    </div>`;

    // ---- your card ----
    const ready = (prize) => card && progress(spec, card, prize.id, marked) === 0;
    const cells = card ? card.rows.map((row, r) => row.map((x, c) => {
      if (x == null) return `<span class="cl-cell blank" aria-hidden="true"></span>`;
      if (x === 0) return `<span class="cl-cell free on" aria-label="Free space">${icon('starFill')}<small>FREE</small></span>`;
      const on = marked(x);
      return `<button class="cl-cell ${on ? 'on' : ''} ${on && fresh && x === last ? 'cl-stamp' : ''}" data-n="${x}" data-k="cl-cell-${r}-${c}" aria-pressed="${on}" aria-label="${x}${on ? ', marked' : ''}"><span>${x}</span></button>`;
    }).join('')).join('') : '';
    const heads = spec.heads ? `<div class="cl-heads">${spec.heads.map((h, i) => `<b class="${spec.headClass?.(i) || ''}">${h}</b>`).join('')}</div>` : '';
    const cardHTML = card ? `<div class="cl-card ${T}-card" style="--cols:${card.rows[0].length}">${heads}<div class="cl-grid">${cells}</div></div>`
      : `<div class="cl-watch panel">${icon('eye')}<span>You're watching. Everyone's numbers are being called below.</span></div>`;

    // ---- claims ----
    const prizeBtn = (p) => {
      const mine = p.winners.includes(ctx.me), shareable = p.winners.length && p.at === n && !mine;
      const open = !p.winners.length || shareable;
      const can = me && !v.over && open && me.lock <= n && n > 0;
      const who = p.winners.length ? esc(names(v, p.winners)) : `${p.pts} pt${p.pts === 1 ? '' : 's'}`;
      const glow = can && ready(p);
      return `<button class="cl-prize ${v.prizes.length === 1 ? 'solo' : ''} ${p.winners.length ? 'won' : ''} ${mine ? 'mine' : ''} ${glow ? 'cl-ready' : ''}" data-prize="${p.id}" data-a="cl-prize-${p.id}" ${can ? '' : 'disabled'}>
        ${glow ? '<i class="cl-glow" aria-hidden="true"></i>' : ''}<span class="cl-pname">${p.winners.length ? icon('trophy') : ''}${esc(p.claim || p.name)}</span><small>${shareable ? 'Got it too? Claim now!' : who}</small></button>`;
    };
    const claims = `<div class="cl-claims ${v.prizes.length === 1 ? 'one' : ''}">${v.prizes.map(prizeBtn).join('')}</div>`;

    const locked = me && me.lock > n ? me.lock - n : 0;
    const hint = v.over ? (v.winners.includes(ctx.me) ? 'You win! What a card.' : v.winners.length ? `${esc(names(v, v.winners))} ${v.winners.length > 1 ? 'share the win' : 'wins'}.` : 'Nobody claimed a prize this time.')
      : !me ? 'Watching the game.'
      : locked ? `Bogey! Claims are locked for ${locked} more number${locked === 1 ? '' : 's'}.`
      : v.ending ? 'Have it too on this number? Claim before the next ball!'
      : auto ? 'Auto-mark is on: claim as soon as a prize lights up.'
      : 'Tap a called number on your card to mark it, then claim the prize.';

    // ---- side: players, the board of called numbers, settings, log ----
    const head = headline(v);
    const player = (p) => {
      const won = v.prizes.filter((x) => x.winners.includes(p.id));
      const isBot = !!ctx.isBot?.(p.id);
      return `<div class="cl-player ${p.id === ctx.me ? 'me' : ''} ${v.winners.includes(p.id) ? 'win' : ''}" data-a="cl-p-${p.id}" style="--pc:${PLAYER_COLORS[p.seat % PLAYER_COLORS.length]}">
        <span class="cl-face">${portrait({ id: p.id, bot: isBot })}</span>
        <span class="cl-pinfo"><b>${esc(p.name)}</b><small>${won.length ? won.map((x) => `<em>${esc(x.short || x.name)}</em>`).join('') : v.over ? 'No prizes' : p.togo === 0 ? `<em class="go">${esc(head.short || head.name)} ready!</em>` : `${p.togo} to go for ${esc(head.short || head.name)}`}</small></span>
        <span class="cl-tags">${p.id === ctx.me ? '<span class="tag t-you">You</span>' : ''}${p.lock > n ? '<span class="tag t-warn">Bogey</span>' : ''}</span>
        <b class="cl-score">${p.score}</b></div>`;
    };
    const players = [...v.players].sort((a, b) => b.score - a.score || a.seat - b.seat).map(player).join('');
    const board = spec.boardRows().map((row) => `<div class="cl-brow">${row.map((x) => `<span class="${called.has(x) ? 'on' : ''} ${x === last ? 'last' : ''}">${x}</span>`).join('')}</div>`).join('');
    UI.playersOpen = el.querySelector('.cl-players')?.open ?? UI.playersOpen;
    UI.boardOpen = el.querySelector('.cl-boardbox')?.open ?? UI.boardOpen;
    UI.logOpen = el.querySelector('.cl-logbox')?.open ?? UI.logOpen;
    const toggle = (id, on, ic, label) => `<button class="small cl-toggle ${on ? 'on' : ''}" data-pref="${id}" aria-pressed="${on}">${icon(ic)}${label}</button>`;

    morph(el, `<div class="cl-root ${T}-root"><div class="game-layout cl-layout">
      <div class="cl-main felt ${T}-felt">
        ${v.over ? `<div class="winner-banner">${icon('trophy')}${v.winners.includes(ctx.me) ? 'You win!' : v.winners.length ? `${esc(names(v, v.winners))} ${v.winners.length > 1 ? 'share the win' : 'wins'}` : 'No winner this time'}</div>` : ''}
        ${caller}
        <p class="cl-hint ${locked ? 'warn' : ''}">${hint}</p>
        ${cardHTML}
        ${me ? claims : ''}
        <div class="cl-prefs">${toggle('auto', auto, 'check', 'Auto-mark')}${toggle('voice', pref('voice', false), 'volume', 'Read numbers aloud')}</div>
      </div>
      <div class="side cl-side">
        <details class="panel drawer cl-players" ${UI.playersOpen ? 'open' : ''}><summary>${icon('users')}<span>Players</span><span class="note">${v.players.length}</span>${icon('chevron', 'chev')}</summary>
          <div class="drawer-body">${players}</div></details>
        ${me ? '' : `<div class="panel cl-prizelist">${claims}</div>`}
        <details class="panel drawer cl-boardbox" ${UI.boardOpen ? 'open' : ''}><summary>${icon('dice')}<span>Called numbers</span><span class="note">${n}/${v.max}</span>${icon('chevron', 'chev')}</summary>
          <div class="drawer-body"><div class="cl-board ${T}-board">${board}</div></div></details>
        <details class="panel drawer cl-logbox" ${UI.logOpen ? 'open' : ''}><summary>${icon('book')}<span>Game log</span>${icon('chevron', 'chev')}</summary>
          <div class="drawer-body"><div class="parchment log">${v.log.slice(0, 10).map((l) => `<div>${esc(l)}</div>`).join('')}</div></div></details>
      </div>
    </div></div>`);

    for (const [sel, k] of [['.cl-players', 'playersOpen'], ['.cl-boardbox', 'boardOpen'], ['.cl-logbox', 'logOpen']]) {
      const d = el.querySelector(sel);
      if (d) d.ontoggle = () => { UI[k] = d.open; };
    }
    el.querySelectorAll('.cl-cell[data-n]').forEach((b) => (b.onclick = () => {
      const x = +b.dataset.n;
      if (auto) return;
      if (!called.has(x)) { b.classList.remove('cl-no'); void b.offsetWidth; b.classList.add('cl-no'); sound('bad'); return; }
      if (UI.marks.has(x)) UI.marks.delete(x); else { UI.marks.add(x); sound('click'); }
      saveMarks();
      render(el, v, ctx);
    }));
    el.querySelectorAll('[data-prize]').forEach((b) => (b.onclick = () => { if (!b.disabled) ctx.send({ type: 'claim', prize: b.dataset.prize }); }));
    el.querySelectorAll('[data-pref]').forEach((b) => (b.onclick = () => {
      const k = b.dataset.pref, on = !pref(k, false);
      setPref(k, on);
      if (k === 'voice' && on && last != null) say(last);
      if (k === 'voice' && !on) try { speechSynthesis.cancel(); } catch {}
      sound('click');
      render(el, v, ctx);
    }));
  }

  return {
    id: spec.id, name: spec.name, description: spec.description,
    minPlayers: 2, maxPlayers: 8, simultaneous: true,
    options: [...(spec.options || []), paceOption, levelOption()],
    cover: spec.cover, howTo: spec.howTo,
    setup, act, view, bot, render,
    turnOf: (s) => (s.over ? [] : s.players.map((p) => p.id)),
  };
}

// Shared look: glossy balls, a countdown ring, paper cards with ink daubs. Each game adds its own colours.
const KIT_STYLE = `
.cl-main{display:flex;flex-direction:column;gap:14px;align-items:stretch}
.cl-caller{display:grid;grid-template-columns:auto minmax(0,1fr) auto;grid-template-areas:"now info ring" "trail trail trail";gap:10px 16px;align-items:center;padding:14px 16px;border-radius:22px;background:linear-gradient(180deg,rgba(255,255,255,.10),rgba(255,255,255,.03));border:1px solid rgba(255,255,255,.14);box-shadow:inset 0 1px 0 rgba(255,255,255,.12),0 12px 30px rgba(0,0,0,.28)}
.cl-now{grid-area:now}.cl-callinfo{grid-area:info;display:flex;flex-direction:column;gap:2px;min-width:0}.cl-ring{grid-area:ring}.cl-trail{grid-area:trail}
.cl-label{font-family:var(--font-display);font-size:2rem;line-height:1.05;color:#fff;letter-spacing:.02em}
.cl-nick{font-weight:700;color:#ffe9a8;font-size:.95rem}
.cl-callinfo small{color:rgba(255,255,255,.7);font-weight:600}
.cl-ball{--b1:#7aa7ff;--b2:#2f56c9;position:relative;display:inline-grid;place-items:center;width:44px;height:44px;border-radius:50%;flex:none;
  background:radial-gradient(circle at 32% 28%,rgba(255,255,255,.85) 0 7%,transparent 22%),radial-gradient(circle at 50% 55%,var(--b1),var(--b2) 72%);
  box-shadow:inset -4px -6px 10px rgba(0,0,0,.28),inset 3px 4px 8px rgba(255,255,255,.25),0 4px 10px rgba(0,0,0,.35)}
.cl-ball i{display:grid;place-items:center;width:62%;height:62%;border-radius:50%;background:radial-gradient(circle at 40% 35%,#fff,#e9edf5);color:#14203f;font:700 .82rem/1 var(--font-display);font-style:normal;box-shadow:inset 0 -2px 3px rgba(0,0,0,.12);text-align:center}
.cl-ball.big{width:92px;height:92px}.cl-ball.big i{font-size:1.45rem}
.cl-ball.cl-empty{--b1:#59607a;--b2:#2b3046}.cl-ball.cl-empty i{color:#59607a}
.cl-now.cl-pop .cl-ball{animation:cl-pop .55s cubic-bezier(.2,1.6,.4,1)}.cl-now.cl-pop2 .cl-ball{animation:cl-pop2 .55s cubic-bezier(.2,1.6,.4,1)}
@keyframes cl-pop{0%{transform:translateY(-26px) scale(.6) rotate(-90deg);opacity:.3}100%{transform:none;opacity:1}}
@keyframes cl-pop2{0%{transform:translateY(-26px) scale(.6) rotate(-90deg);opacity:.3}100%{transform:none;opacity:1}}
.cl-ring{--p:1;position:relative;width:54px;height:54px;border-radius:50%;display:grid;place-items:center;background:conic-gradient(#ffd76a calc(var(--p)*360deg),rgba(255,255,255,.12) 0)}
.cl-ring::before{content:"";position:absolute;inset:6px;border-radius:50%;background:#16204a}
.cl-ring b{position:relative;font:700 1.15rem var(--font-display);color:#fff}
.cl-trail{display:flex;gap:8px;min-height:44px;overflow:hidden}.cl-trail:empty{display:none}
.cl-hint{margin:0;text-align:center;font-weight:700;color:#e8ecff}.cl-hint.warn{color:#ffb4a8}
.cl-card{align-self:center;width:min(100%,var(--card-w,460px));padding:12px;border-radius:18px;background:linear-gradient(180deg,#fffaf0,#f3e9d2);box-shadow:0 16px 34px rgba(0,0,0,.35),inset 0 1px 0 #fff}
.cl-heads,.cl-grid{display:grid;grid-template-columns:repeat(var(--cols),minmax(0,1fr));gap:6px}
.cl-heads{margin-bottom:6px}.cl-heads b{display:grid;place-items:center;height:40px;border-radius:10px;font:700 1.5rem var(--font-display);color:#fff}
.cl-cell{position:relative;display:grid;place-items:center;aspect-ratio:1;min-height:40px;padding:0;border:0;border-radius:10px;background:linear-gradient(180deg,#fff,#f4efe4);color:#1d2340;font:700 1.25rem var(--font-display);box-shadow:inset 0 -2px 0 rgba(0,0,0,.08),0 1px 2px rgba(0,0,0,.12);cursor:pointer;transition:transform .12s}
.cl-cell:active{transform:scale(.95)}
.cl-cell span{position:relative;z-index:1}
.cl-cell::after{content:"";position:absolute;inset:12%;border-radius:50%;background:radial-gradient(circle at 40% 38%,var(--ink-1,#ff5c8a),var(--ink-2,#d6246a) 70%);opacity:0;transform:scale(.4);transition:opacity .15s,transform .15s}
.cl-cell.on::after{opacity:.72;transform:none}
.cl-cell.on{color:#fff}
.cl-cell.cl-stamp::after{animation:cl-stamp .35s ease-out}
@keyframes cl-stamp{0%{transform:scale(1.6);opacity:0}100%{transform:none;opacity:.72}}
.cl-cell.cl-no{animation:cl-no .3s}@keyframes cl-no{25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}
.cl-cell.blank{cursor:default;box-shadow:none}
.cl-cell.free{cursor:default;color:#fff;flex-direction:column;gap:0}
.cl-cell.free .ic{position:relative;z-index:1;width:46%;height:46%}.cl-cell.free small{position:relative;z-index:1;font-size:.55rem;letter-spacing:.1em}
.cl-claims{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px}
.cl-claims.one{grid-template-columns:minmax(0,320px);justify-content:center}
.cl-prize{position:relative;display:flex;flex-direction:column;align-items:center;gap:2px;min-height:52px;padding:8px 10px;border-radius:14px;overflow:hidden}
.cl-prize .cl-pname{display:flex;align-items:center;gap:6px;font-family:var(--font-display);font-size:1.05rem}
.cl-prize.solo .cl-pname{font-size:1.5rem;letter-spacing:.06em}
.cl-prize small{font-size:.75rem;opacity:.8;font-weight:700}
.cl-prize.won{opacity:.75}.cl-prize.mine{opacity:1;border-color:#ffd76a;color:#ffe7a0}
.cl-prize .ic{width:1em;height:1em}
.cl-prize.cl-ready{background:linear-gradient(180deg,#ffd76a,#f5a524);color:#3a2300;border-color:#ffe7a0}
.cl-glow{position:absolute;inset:-2px;border-radius:inherit;box-shadow:0 0 0 3px rgba(255,215,106,.85),0 0 22px rgba(255,215,106,.9);animation:cl-breathe 1.4s ease-in-out infinite;pointer-events:none}
@keyframes cl-breathe{0%,100%{opacity:.35}50%{opacity:1}}
.cl-prefs{display:flex;flex-wrap:wrap;justify-content:center;gap:8px}
.cl-toggle{opacity:.75}.cl-toggle.on{opacity:1;border-color:#ffd76a;color:#ffe7a0}
.cl-toggle .ic{width:1em;height:1em}
.cl-watch{display:flex;align-items:center;justify-content:center;gap:10px;margin:0}
.cl-player{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;align-items:center;gap:10px;padding:6px 8px;border-radius:12px}
.cl-player.me{background:rgba(255,255,255,.06)}.cl-player.win{background:rgba(255,215,106,.12)}
.cl-face{display:block;width:38px;height:38px;border-radius:50%;box-shadow:0 0 0 3px var(--pc);overflow:hidden}
.cl-face svg{display:block;width:100%;height:100%}
.cl-pinfo{display:flex;flex-direction:column;min-width:0}.cl-pinfo b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cl-pinfo small{display:flex;flex-wrap:wrap;gap:4px;color:var(--muted);font-size:.78rem}
.cl-pinfo em{font-style:normal;padding:0 6px;border-radius:999px;background:rgba(255,215,106,.16);color:#ffe7a0;font-weight:700}
.cl-pinfo em.go{background:rgba(110,231,160,.18);color:#9ff0c2}
.cl-tags{display:flex;gap:4px}.cl-tags .ic{width:.9em;height:.9em}
.cl-score{font:700 1.3rem var(--font-display);min-width:2ch;text-align:right}
.cl-board{display:flex;flex-direction:column;gap:3px}
.cl-brow{display:grid;grid-template-columns:repeat(var(--bcols,10),minmax(0,1fr));gap:3px}
.cl-brow span{display:grid;place-items:center;height:24px;border-radius:6px;background:rgba(255,255,255,.05);color:rgba(255,255,255,.4);font:600 .74rem var(--font-display)}
.cl-brow span.on{background:rgba(255,215,106,.22);color:#fff}.cl-brow span.last{background:#ffd76a;color:#2a1a00}
.cl-prizelist{padding:12px}
@media (max-width:480px){
  .cl-caller{grid-template-columns:auto minmax(0,1fr) auto;padding:12px;gap:8px 12px}
  .cl-ball.big{width:72px;height:72px}.cl-ball.big i{font-size:1.15rem}
  .cl-label{font-size:1.55rem}.cl-ring{width:46px;height:46px}
  .cl-ball{width:36px;height:36px}.cl-ball i{font-size:.72rem}
  .cl-trail{min-height:36px;gap:6px}
  .cl-card{padding:8px}.cl-heads,.cl-grid{gap:4px}.cl-heads b{height:34px;font-size:1.25rem}
  .cl-cell{font-size:1.05rem}
}
`;
