// Antakshari, the Indian singing game, played over voice chat or in one room. Two teams take turns singing a
// song that starts with the letter on the stage; the last letter of their song is the next team's letter.
// The app never shows or stores lyrics: it only keeps the letters, the clock, the challenges and the score.
//
// Time-based steps (the singing time, the 10 s challenge window, the vote) use host Date.now() deadlines, like
// Sketch Party: any player's screen sends { type: 'clock' } when a deadline passes, and act() ignores a clock that
// is early (or stale, which is the same thing: the deadline it was sent for has already been replaced).
import { esc, log, addFx, rand, shuffle } from '../js/util.js';
import { injectCSS, morph } from '../js/fx.js';
import { sound } from '../js/sound.js';
import { icon } from '../js/icons.js';
import { portrait } from '../js/avatar.js';

const browser = typeof document !== 'undefined';
const TEAM = ['Sur', 'Taal'];                 // melody and rhythm
const TCOL = ['#ffb020', '#4cc3ff'];          // saffron and sky blue, each with its own shape below
const FRIENDLY = 'ABCDGHJKLMNPRSTY';          // letters plenty of songs start with: fresh letters come from here
const CHECK_MS = 10000, VOTE_MS = 15000;
const TRAIL_MAX = 40;

/* ---------------- rules ---------------- */

const pick = (v, list, dflt) => (list.includes(String(v)) ? String(v) : dflt);
const other = (t) => 1 - t;
const teamOf = (s, t) => s.players.filter((p) => p.team === t);
const letterOf = (x) => { if (typeof x !== 'string') return null; const l = x.trim().toUpperCase(); return /^[A-Z]$/.test(l) ? l : null; };
const freshLetter = (not) => { const pool = [...FRIENDLY].filter((l) => l !== not); return pool[rand(pool.length)]; };

function setup(players, opts = {}) {
  if (players.length < 2 || players.length > 8) throw Error('Antakshari needs 2–8 players.');
  // Deal the teams: shuffle the seats and alternate, so the teams differ by at most one player.
  const order = shuffle(players.map((_, i) => i)), flip = rand(2), team = [];
  order.forEach((seat, k) => { team[seat] = (k + flip) % 2; });
  const start = pick(opts.start, ['m', 'random'], 'm');
  const s = {
    phase: 'sing', over: false, winners: [], log: [],
    players: players.map((p, i) => ({ id: p.id, name: p.name, team: team[i] })),
    score: [0, 0], turn: rand(2), letter: start === 'random' ? freshLetter('') : 'M',
    target: Number(pick(opts.target, ['5', '10', '15'], '10')),
    singMs: Number(pick(opts.time, ['20', '30', '45'], '30')) * 1000,
    misses: 0, claim: null, ok: [], voters: [], votes: {}, challenger: null,
    until: 0, turnNo: 0, songs: 0, trail: [], trailN: 0,
  };
  log(s, `Teams are dealt. Team ${TEAM[s.turn]} sings first, starting with ${s.letter}.`);
  startSing(s);
  return s;
}

function startSing(s) {
  Object.assign(s, { phase: 'sing', claim: null, ok: [], voters: [], votes: {}, challenger: null, until: Date.now() + s.singMs });
  s.turnNo++;
}
function remember(s, ok) {
  s.trail.push({ l: s.letter, t: s.turn, ok, n: s.trailN++ });
  if (s.trail.length > TRAIL_MAX) s.trail.splice(0, s.trail.length - TRAIL_MAX);
}
// The song stands: a point, and the last letter goes to the other team.
function accept(s, why) {
  const t = s.turn, next = s.claim.next;
  remember(s, true);
  s.score[t]++; s.songs++;
  log(s, `${why || ''}Team ${TEAM[t]} sang on ${s.letter}! Team ${TEAM[other(t)]} now sings on ${next}.`);
  addFx(s, { kind: 'float', at: `ak-score-${t}`, text: '+1', color: TCOL[t], sound: 'chime' });
  if (s.score[t] >= s.target) {
    Object.assign(s, { over: true, phase: 'over', until: 0, claim: null, winners: teamOf(s, t).map((p) => p.id) });
    log(s, `Team ${TEAM[t]} reaches ${s.target} and wins!`);
    return;
  }
  s.letter = next; s.misses = 0; s.turn = other(t);
  startSing(s);
}
// No song (time ran out, the team gave up, or the table turned it down): no point, and the other team must sing
// on the same letter. When both teams miss the same letter in a row, a fresh friendly letter is dealt instead.
function miss(s, why) {
  const t = s.turn, was = s.letter;
  remember(s, false);
  s.misses++;
  log(s, `${why} Team ${TEAM[other(t)]} must sing on ${was}.`);
  addFx(s, { kind: 'shake', at: `ak-score-${t}`, sound: 'bad' });
  if (s.misses >= 2) {
    s.letter = freshLetter(was); s.misses = 0;
    log(s, `Both teams were stuck on ${was}. Fresh letter: ${s.letter}.`);
  }
  s.turn = other(t);
  startSing(s);
}
// A challenge is judged by everyone not on the singing team. If that would be one person (the challenger judging
// alone), the whole table votes instead, singers included, and they are asked to be honest. Ties accept the song.
function votersOf(s) {
  const judges = teamOf(s, other(s.turn));
  return (judges.length >= 2 ? judges : s.players).map((p) => p.id);
}
function decide(s) {
  const cast = Object.values(s.votes), yes = cast.filter((x) => x === true).length, no = cast.length - yes;
  if (no > yes) miss(s, `The table turned the song down (${no}–${yes}).`);
  else accept(s, `The song stands (${yes}–${no}). `);
}
function tick(s) {
  if (Date.now() < s.until) return; // early, or sent for a deadline that has already been replaced
  if (s.phase === 'sing') miss(s, `Time’s up for Team ${TEAM[s.turn]} on ${s.letter}.`);
  else if (s.phase === 'check') accept(s, 'Nobody challenged. ');
  else if (s.phase === 'vote') decide(s);
}

function act(s, pid, a) {
  if (s.over) throw Error('The game is over.');
  const me = s.players.find((p) => p.id === pid);
  if (!me) throw Error('Only players at the table can do that.');
  if (!a || typeof a !== 'object') throw Error('Unknown move.');
  const singer = me.team === s.turn;
  switch (a.type) {
    case 'think': return;
    case 'clock': return tick(s);
    case 'sang': {
      if (s.phase !== 'sing') throw Error('Wait for the next song.');
      if (!singer) throw Error(`It’s Team ${TEAM[s.turn]}’s turn to sing.`);
      const next = letterOf(a.letter);
      if (!next) throw Error('Type one letter from A to Z: the last letter of your song.');
      Object.assign(s, { phase: 'check', claim: { by: pid, next }, ok: [], until: Date.now() + CHECK_MS });
      log(s, `${me.name}: Team ${TEAM[s.turn]} sang on ${s.letter}, ending in ${next}.`);
      addFx(s, { kind: 'sound', sound: 'card' });
      return;
    }
    case 'stuck':
      if (s.phase !== 'sing') throw Error('Wait for the next song.');
      if (!singer) throw Error(`It’s Team ${TEAM[s.turn]}’s turn to sing.`);
      return miss(s, `${me.name}: Team ${TEAM[s.turn]} can’t find a song on ${s.letter}.`);
    case 'fair':
      if (s.phase !== 'check') throw Error('There is no song to accept right now.');
      if (singer) throw Error('The other team decides whether to challenge your song.');
      if (s.ok.includes(pid)) throw Error('You have already accepted this song.');
      s.ok.push(pid);
      if (teamOf(s, other(s.turn)).every((p) => s.ok.includes(p.id))) accept(s, `Team ${TEAM[other(s.turn)]} accepted the song. `);
      return;
    case 'challenge':
      if (s.phase !== 'check') throw Error('There is no song to challenge right now.');
      if (singer) throw Error('You can’t challenge your own team’s song.');
      Object.assign(s, { phase: 'vote', challenger: pid, voters: votersOf(s), votes: {}, until: Date.now() + VOTE_MS });
      if (s.voters.includes(pid)) s.votes[pid] = false;
      log(s, `${me.name} challenges Team ${TEAM[s.turn]}’s song on ${s.letter}! Vote now.`);
      addFx(s, { kind: 'pulse', at: 'ak-medal', sound: 'flip' });
      return;
    case 'vote':
      if (s.phase !== 'vote') throw Error('There is no vote right now.');
      if (!s.voters.includes(pid)) throw Error('You don’t vote on this challenge.');
      if (pid in s.votes) throw Error('You have already voted.');
      if (typeof a.ok !== 'boolean') throw Error('Vote “Real song” or “Not a song”.');
      s.votes[pid] = a.ok;
      if (s.voters.every((id) => id in s.votes)) decide(s);
      return;
  }
  throw Error('Unknown move.');
}

function turnOf(s) {
  if (s.over) return [];
  if (s.phase === 'sing') return teamOf(s, s.turn).map((p) => p.id);
  if (s.phase === 'check') return teamOf(s, other(s.turn)).filter((p) => !s.ok.includes(p.id)).map((p) => p.id);
  if (s.phase === 'vote') return s.voters.filter((id) => !(id in s.votes));
  return [];
}

// Nothing is secret. hostNow lets every screen line its clock up with the host's.
function view(s) {
  const v = JSON.parse(JSON.stringify(s));
  v.hostNow = Date.now();
  return v;
}

// Singing can't be simulated, so the lobby offers no computer players (noBotSeats). This bot exists for the
// rules simulator and for stand-ins: in Node it "sings" at once with a random last letter, never challenges and
// votes to accept. In a browser (a stand-in for someone who dropped out) it only accepts songs and moves the
// clock on, so a computer never claims a song for a real team.
function bot(v) {
  if (browser) {
    if (Date.now() >= v.until) return { type: 'clock' };
    return v.phase === 'check' ? { type: 'fair' } : { type: 'think' };
  }
  if (v.phase === 'sing') return { type: 'sang', letter: String.fromCharCode(65 + rand(26)) };
  if (v.phase === 'check') return { type: 'fair' };
  return { type: 'vote', ok: true };
}

/* ---------------- screen ---------------- */

const shape = (d, cls = 'ak-sym') => `<svg class="${cls}" viewBox="0 0 20 20" aria-hidden="true" focusable="false">${d}</svg>`;
// Every team colour also has a shape: Sur is a round note, Taal a diamond.
const SYM = [
  shape('<circle cx="10" cy="10" r="8.6" fill="currentColor"/><path d="M11.6 4.6v7.1a2.3 2.3 0 1 1-1.5-2.1V4.6z" fill="#2a1240"/>'),
  shape('<path d="M10 1.2l8.8 8.8-8.8 8.8L1.2 10z" fill="currentColor"/><path d="M6.6 10h6.8M10 6.6v6.8" stroke="#2a1240" stroke-width="1.8" stroke-linecap="round"/>'),
];
const HAND = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11"/><path d="M11 10V4a1.5 1.5 0 0 1 3 0v6"/><path d="M14 10V5.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-.5a6 6 0 0 1-4.8-2.4L3.4 16a1.6 1.6 0 0 1 2.4-2.1L8 16"/></svg>';
const wide = () => (typeof matchMedia === 'function' ? matchMedia('(min-width: 901px)').matches : true);
const UI = { v: null, ctx: null, root: null, offset: 0, hostNow: 0, clockSent: 0, turnKey: '', entering: false, letter: '', logOpen: wide(), focus: false };

const amPlayer = () => !!UI.v?.players.some((p) => p.id === UI.ctx?.me);
const total = (v) => (v.phase === 'sing' ? v.singMs : v.phase === 'check' ? CHECK_MS : v.phase === 'vote' ? VOTE_MS : 1);

// The countdown ring around the letter, and the seconds under it.
function clockFace() {
  const v = UI.v, el = UI.root;
  if (!v || !el) return;
  const msLeft = v.over ? 0 : v.until - (Date.now() + UI.offset);
  const left = Math.max(0, Math.ceil(msLeft / 1000)), low = !v.over && left <= 5;
  const ring = el.querySelector('.ak-ring');
  if (ring) { ring.style.setProperty('--p', v.over ? '0' : Math.max(0, Math.min(1, msLeft / total(v))).toFixed(3)); ring.classList.toggle('low', low); }
  const t = el.querySelector('.ak-secs');
  if (t) { const text = v.over ? '' : `${left}s`; if (t.textContent !== text) t.textContent = text; t.classList.toggle('low', low); }
}
if (browser) {
  setInterval(() => {
    const v = UI.v;
    if (!v || !UI.root?.isConnected) return;
    clockFace();
    const now = Date.now() + UI.offset;
    if (!v.over && amPlayer() && v.until && now > v.until + 250 && Date.now() - UI.clockSent > 1500) { UI.clockSent = Date.now(); UI.ctx.send({ type: 'clock' }); }
  }, 250);
}

function render(el, v, ctx) {
  injectCSS('antakshari', STYLE);
  if (v.hostNow && v.hostNow !== UI.hostNow) { UI.hostNow = v.hostNow; UI.offset = v.hostNow - Date.now(); }
  UI.v = v; UI.ctx = ctx; UI.root = el;
  const me = v.players.find((p) => p.id === ctx.me);
  const turnKey = v.players.map((p) => p.id).join() + ':' + v.turnNo;
  if (UI.turnKey !== turnKey) Object.assign(UI, { turnKey, entering: false, letter: '' });
  const live = !v.over;
  const singing = live && v.phase === 'sing' && me && me.team === v.turn;
  if (!singing) UI.entering = false;
  const judging = live && v.phase === 'check' && me && me.team !== v.turn && !v.ok.includes(me.id);
  const voting = live && v.phase === 'vote' && me && v.voters.includes(me.id) && !(me.id in v.votes);
  const T = (t) => `Team ${TEAM[t]}`;
  const named = (id) => v.players.find((p) => p.id === id)?.name || '?';
  const face = (p, cls = 'ak-face') => `<span class="${cls}" style="--tc:${TCOL[p.team]}">${portrait({ id: p.id, bot: !!ctx.isBot?.(p.id) })}</span>`;
  const win = v.over ? v.score.findIndex((x) => x >= v.target) : -1;

  // ---- scoreboard ----
  const board = (t) => `<div class="ak-team t${t} ${live && v.turn === t ? 'on' : ''} ${win === t ? 'win' : ''}" data-a="ak-score-${t}">
      <span class="ak-tname">${SYM[t]}<b><span class="ak-tw">Team </span>${TEAM[t]}</b></span><b class="ak-pts">${v.score[t]}</b>
      <span class="ak-faces">${v.players.filter((p) => p.team === t).map((p) => face(p, 'ak-mini')).join('')}</span>
      ${live && v.turn === t ? `<span class="ak-now">${icon('mic')}${v.phase === 'sing' ? 'Singing' : 'Sang'}</span>` : ''}</div>`;

  // ---- the stage: who sings, the letter in the spotlight, the next letter while it is checked ----
  const caption = v.over ? (win >= 0 ? `${T(win)} wins the antakshari!` : 'Game over')
    : v.phase === 'sing' ? `${T(v.turn)}, sing a song starting with`
    : v.phase === 'check' ? `${T(v.turn)} sang on`
    : `Challenge! Was it a real song on`;
  const pop = v.trailN % 2 ? 'ak-pop2' : 'ak-pop';
  const next = v.claim && live ? `<div class="ak-next t${v.turn}"><small>ends in</small><b>${esc(v.claim.next)}</b><span>next for ${T(other(v.turn))}</span></div>` : '';
  const stage = `<div class="ak-stage">
      <p class="ak-caption">${caption}</p>
      <div class="ak-show">
        <div class="ak-ring t${v.turn}" data-a="ak-medal"><div class="ak-card"><span class="ak-letter ${pop}" aria-label="Letter ${esc(v.letter)}">${esc(v.letter)}</span></div><span class="ak-secs"></span></div>
        ${next}
      </div></div>`;

  // ---- what you can do now ----
  const tally = v.phase === 'vote' ? (() => { const c = Object.values(v.votes); const y = c.filter(Boolean).length; return `<span class="ak-tally"><b class="yes">${icon('check')}${y}</b><b class="no">${icon('close')}${c.length - y}</b><small>${c.length}/${v.voters.length} voted</small></span>`; })() : '';
  let actions = '', hint = '';
  if (v.over) hint = me ? (me.team === win ? 'What a sing-off! Your team wins.' : 'Well sung! Rematch?') : 'Thanks for watching.';
  else if (singing && UI.entering) {
    actions = `<form class="ak-form"><label><small>Last letter of your song</small><input id="akLetter" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="done" inputmode="text" aria-label="Last letter of your song" value="${esc(UI.letter)}" placeholder="?"></label>
      <button class="good" id="akConfirm" ${UI.letter ? '' : 'disabled'}>${icon('check')}Confirm</button><button type="button" class="ghost" id="akCancel">${icon('back')}Back</button></form>`;
    hint = 'One Latin letter, A to Z. Hindi, Telugu, Tamil… type the letter of the last sound.';
  } else if (singing) {
    actions = `<button class="primary ak-big" id="akSang">${icon('mic')}We sang it</button><button class="ghost" id="akStuck">We’re stuck</button>`;
    hint = `Sing a song starting with ${esc(v.letter)}, then tap “We sang it”.`;
  } else if (judging) {
    actions = `<button class="bad ak-big" id="akChallenge">${HAND}Challenge</button><button class="good" id="akFair">${icon('check')}Fair song</button>`;
    hint = 'Was that a real song starting with the letter? Challenge it, or let it stand.';
  } else if (voting) {
    actions = `<button class="good ak-big" data-vote="1">${icon('check')}Real song</button><button class="bad ak-big" data-vote="0">${icon('close')}Not a song</button>`;
    hint = `${esc(named(v.challenger))} challenged. ${me.team === v.turn ? 'Be honest! ' : ''}Ties go to the singers.`;
  } else if (v.phase === 'sing') hint = me ? `Listen! ${T(v.turn)} is singing on ${esc(v.letter)}…` : `${T(v.turn)} is singing on ${esc(v.letter)}.`;
  else if (v.phase === 'check') hint = me && me.team === v.turn ? `${T(other(v.turn))} can challenge your song…` : me ? 'You accepted. Waiting for your teammates…' : `${T(other(v.turn))} may challenge…`;
  else hint = me && me.id in v.votes ? 'Vote cast. Waiting for the others…' : `The table is voting on ${esc(named(v.challenger))}’s challenge.`;
  const role = me ? `<span class="ak-role t${me.team}">${SYM[me.team]}You are on ${T(me.team)}</span>` : `<span class="ak-role">${icon('eye')}Watching</span>`;

  // ---- the trail of letters passed: M → A → R ----
  const trail = v.trail.slice(-16).map((e) => `<span class="ak-chip t${e.t} ${e.ok ? '' : 'miss'}" data-k="ak-tr-${e.n}" title="${T(e.t)} ${e.ok ? 'sang on' : 'missed'} ${e.l}">${SYM[e.t]}<b>${e.l}</b>${e.ok ? '' : icon('close', 'ak-x')}</span>`).join('')
    + (live ? `<span class="ak-chip t${v.turn} cur" data-k="ak-tr-now">${SYM[v.turn]}<b>${esc(v.letter)}</b></span>` : '');

  // ---- side: both rosters and the log ----
  const tagFor = (p) => {
    if (!live) return v.winners.includes(p.id) ? `<span class="tag t-good">${icon('trophy')}Won</span>` : '';
    if (v.phase === 'sing' && p.team === v.turn) return `<span class="tag t-good">${icon('mic')}Singing</span>`;
    if (v.phase === 'check' && p.team !== v.turn) return v.ok.includes(p.id) ? `<span class="tag">${icon('check')}OK</span>` : '<span class="tag t-warn">Judging</span>';
    if (v.phase === 'vote' && v.voters.includes(p.id)) return p.id in v.votes ? `<span class="tag">${icon('check')}Voted</span>` : '<span class="tag t-warn">Voting</span>';
    return '';
  };
  const roster = (t) => `<div class="ak-roster t${t}"><h3>${SYM[t]}${T(t)}<span class="ak-rscore">${v.score[t]} / ${v.target}</span></h3>${v.players.filter((p) => p.team === t).map((p) => `<div class="ak-member ${p.id === ctx.me ? 'me' : ''}">${face(p)}<span class="ak-mname">${esc(p.name)}</span>${p.id === ctx.me ? '<span class="tag t-you">You</span>' : ''}${tagFor(p)}</div>`).join('')}</div>`;

  const active = browser ? document.activeElement : null;
  const typing = active && active.id === 'akLetter' && el.contains(active) ? [active.selectionStart, active.selectionEnd] : null;
  UI.logOpen = el.querySelector('.ak-logbox')?.open ?? UI.logOpen;
  const bulbs = Array.from({ length: 18 }, (_, i) => `<i style="--c:${['#ff5d8f', '#ffd166', '#3ee0a1', '#4cc3ff', '#b197fc', '#ff9f43'][i % 6]};--d:${(i % 5) * 0.37}s"></i>`).join('');

  morph(el, `<div class="ak-root"><div class="game-layout">
    <div class="felt ak-felt">
      <div class="ak-lights" aria-hidden="true">${bulbs}</div>
      ${v.over ? `<div class="winner-banner">${icon('trophy')}${me && me.team === win ? 'Your team wins!' : `${T(win)} wins!`}</div>` : ''}
      <div class="ak-board">${board(0)}<div class="ak-goal"><small>First to</small><b>${v.target}</b></div>${board(1)}</div>
      ${stage}
      <div class="ak-rolebar">${role}${tally}</div>
      ${actions ? `<div class="ak-actions">${actions}</div>` : ''}
      <p class="ak-hint" aria-live="polite">${hint}</p>
      <div class="ak-trailbox"><small>Letters so far</small><div class="ak-trail">${trail}</div></div>
    </div>
    <div class="side">
      <div class="panel ak-rosters">${roster(0)}${roster(1)}</div>
      <details class="panel drawer ak-logbox" ${UI.logOpen ? 'open' : ''}><summary>${icon('book')}<span>Song log</span>${icon('chevron', 'chev')}</summary>
        <div class="drawer-body"><div class="parchment log">${v.log.slice(0, 12).map((l) => `<div>${esc(l)}</div>`).join('')}</div></div></details>
    </div>
  </div></div>`);
  clockFace();

  const lb = el.querySelector('.ak-logbox'); if (lb) lb.ontoggle = () => { UI.logOpen = lb.open; };
  const on = (sel, fn) => { const b = el.querySelector(sel); if (b) b.onclick = fn; };
  on('#akSang', () => { sound('click'); UI.entering = true; UI.focus = true; render(el, v, ctx); });
  on('#akStuck', () => ctx.send({ type: 'stuck' }));
  on('#akCancel', () => { UI.entering = false; render(el, v, ctx); });
  on('#akChallenge', () => ctx.send({ type: 'challenge' }));
  on('#akFair', () => ctx.send({ type: 'fair' }));
  el.querySelectorAll('[data-vote]').forEach((b) => (b.onclick = () => ctx.send({ type: 'vote', ok: b.dataset.vote === '1' })));
  const form = el.querySelector('.ak-form');
  if (form) {
    const input = form.querySelector('#akLetter'), go = form.querySelector('#akConfirm');
    // Keep just the last Latin letter typed, so a new key replaces the old one.
    input.oninput = () => { UI.letter = (input.value.match(/[a-z]/gi) || []).pop()?.toUpperCase() || ''; input.value = UI.letter; go.disabled = !UI.letter; };
    form.onsubmit = (e) => { e.preventDefault(); if (UI.letter) ctx.send({ type: 'sang', letter: UI.letter }); else input.focus(); };
    // An update while someone is typing shouldn't knock them out of the box.
    if (typing) { input.focus({ preventScroll: true }); try { input.setSelectionRange(...typing); } catch {} }
    else if (UI.focus) { UI.focus = false; input.focus({ preventScroll: true }); }
  }
}

const STYLE = `
.ak-felt{display:flex;flex-direction:column;gap:12px;overflow:hidden;padding-top:34px;border-color:rgba(255,190,120,.22);background:
  radial-gradient(70% 45% at 50% 36%,rgba(255,214,140,.20),transparent 70%),
  radial-gradient(60% 40% at 0% 100%,rgba(255,93,143,.18),transparent 70%),
  radial-gradient(60% 40% at 100% 100%,rgba(76,195,255,.16),transparent 70%),
  linear-gradient(180deg,#3b1563 0%,#26104b 55%,#170a31 100%)}
.ak-felt .winner-banner{display:flex;align-items:center;justify-content:center;gap:10px;margin:0}.ak-felt .winner-banner .ic{width:1em;height:1em}
.ak-lights{position:absolute;left:0;right:0;top:0;height:30px;display:flex;justify-content:space-around;padding:0 8px;pointer-events:none;
  background:linear-gradient(rgba(20,10,30,.9),rgba(20,10,30,.9)) 0 7px/100% 2px no-repeat}
.ak-lights i{position:relative;display:block;width:10px;height:14px;margin-top:9px;border-radius:50% 50% 45% 45%;background:radial-gradient(circle at 35% 30%,#fff 0 18%,var(--c) 45%);box-shadow:0 0 0 1px rgba(0,0,0,.25)}
.ak-lights i:nth-child(odd){margin-top:12px}
.ak-lights i::before{content:"";position:absolute;left:2px;top:-3px;width:6px;height:4px;border-radius:2px;background:#3a2a40}
.ak-lights i::after{content:"";position:absolute;left:-10px;top:-8px;width:30px;height:30px;border-radius:50%;background:radial-gradient(circle,var(--c),transparent 65%);opacity:.45;animation:ak-twinkle 2.2s ease-in-out var(--d) infinite}
@keyframes ak-twinkle{50%{opacity:.12}}
.ak-board{position:relative;z-index:2;display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);gap:10px;align-items:stretch}
.ak-team{position:relative;display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"name pts" "faces pts" "now pts";align-items:center;gap:4px 8px;padding:10px 12px;border-radius:16px;
  background:linear-gradient(180deg,rgba(255,255,255,.10),rgba(255,255,255,.03));border:2px solid color-mix(in srgb,var(--tc) 45%,transparent);box-shadow:inset 0 1px 0 rgba(255,255,255,.1)}
.ak-team.t0{--tc:${TCOL[0]}}.ak-team.t1{--tc:${TCOL[1]}}
.ak-team::after{content:"";position:absolute;inset:-6px;border-radius:20px;border:3px solid var(--tc);opacity:0;pointer-events:none}
.ak-team.on::after{animation:ak-breathe 1.8s ease-in-out infinite}
.ak-team.win{background:linear-gradient(180deg,color-mix(in srgb,var(--tc) 35%,transparent),rgba(255,255,255,.04))}
@keyframes ak-breathe{0%,100%{opacity:.15}50%{opacity:.8}}
.ak-tname{grid-area:name;display:flex;align-items:center;gap:6px;min-width:0;color:var(--tc)}.ak-tname b{font:700 1rem var(--font-display);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ak-sym{flex:none;width:18px;height:18px;color:var(--tc)}
.ak-pts{grid-area:pts;font:700 2.6rem/1 var(--font-display);color:#fff;text-shadow:0 3px 0 rgba(0,0,0,.25);min-width:1.2em;text-align:center}
.ak-faces{grid-area:faces;display:flex;flex-wrap:wrap;gap:3px}
.ak-mini{display:block;width:24px;height:24px;border-radius:50%;overflow:hidden;box-shadow:0 0 0 2px var(--tc)}.ak-mini svg,.ak-face svg{display:block;width:100%;height:100%}
.ak-now{grid-area:now;display:inline-flex;align-items:center;gap:4px;font-weight:800;font-size:.75rem;color:#1a0b2e;background:var(--tc);border-radius:99px;padding:2px 8px;justify-self:start}.ak-now .ic{width:.9em;height:.9em}
.ak-goal{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:6px 10px;border-radius:14px;background:#1c0b36;color:#ffe7b0;box-shadow:inset 0 1px 0 rgba(255,255,255,.08)}
.ak-goal small{font-size:.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.06em;opacity:.8}.ak-goal b{font:700 1.5rem var(--font-display)}
.ak-stage{position:relative;text-align:center;padding:4px 0 18px}
.ak-stage::before{content:"";position:absolute;left:50%;top:-14px;width:340px;height:274px;transform:translateX(-50%);pointer-events:none;
  background:linear-gradient(180deg,rgba(255,240,200,.30),rgba(255,240,200,0) 85%);clip-path:polygon(42% 0,58% 0,100% 100%,0 100%)}
.ak-stage::after{content:"";position:absolute;left:50%;bottom:0;width:300px;height:40px;transform:translateX(-50%);border-radius:50%;background:radial-gradient(closest-side,rgba(255,226,160,.35),transparent);pointer-events:none}
.ak-caption{position:relative;margin:0 0 10px;font:600 1.1rem var(--font-display);color:#fff3d6}
.ak-show{position:relative;z-index:1;display:flex;align-items:center;justify-content:center;gap:14px}
.ak-ring{--p:1;--ring:var(--tc);position:relative;display:grid;place-items:center;width:178px;height:178px;border-radius:50%;
  background:conic-gradient(var(--ring) calc(var(--p) * 360deg),rgba(255,255,255,.13) 0);box-shadow:0 14px 30px rgba(0,0,0,.4)}
.ak-ring.t0{--tc:${TCOL[0]}}.ak-ring.t1{--tc:${TCOL[1]}}.ak-ring.low{--ring:#ff6b81}
.ak-card{display:grid;place-items:center;width:150px;height:150px;border-radius:50%;background:radial-gradient(circle at 38% 30%,#fffdf4,#ffe9bf 60%,#f4c97a);box-shadow:inset 0 -6px 12px rgba(160,90,20,.3),inset 0 4px 0 rgba(255,255,255,.8)}
.ak-letter{display:block;font:700 6.2rem/1 var(--font-display);color:#c2185b;text-shadow:0 3px 0 #ffd0e0,0 6px 12px rgba(120,20,60,.25)}
.ak-pop{animation:ak-pop .5s cubic-bezier(.3,1.6,.5,1)}.ak-pop2{animation:ak-pop2 .5s cubic-bezier(.3,1.6,.5,1)}
@keyframes ak-pop{from{transform:scale(.3) rotate(-12deg);opacity:0}}@keyframes ak-pop2{from{transform:scale(.3) rotate(-12deg);opacity:0}}
.ak-secs{position:absolute;bottom:-8px;left:50%;transform:translateX(-50%);min-width:48px;padding:3px 10px;border-radius:99px;background:#1a0b2e;color:#fff;font:700 1rem var(--font-display);box-shadow:0 0 0 2px var(--ring)}
.ak-secs:empty{display:none}.ak-secs.low{color:#ffd0d8;animation:ak-tick 1s ease-in-out infinite}
@keyframes ak-tick{50%{transform:translateX(-50%) scale(1.12)}}
.ak-next{display:flex;flex-direction:column;align-items:center;gap:2px;padding:10px 12px;border-radius:16px;background:linear-gradient(180deg,#fffaf0,#f2e2c4);color:#3a1a40;box-shadow:0 10px 22px rgba(0,0,0,.35);transform:rotate(3deg);animation:ak-in .4s ease-out}
.ak-next small{font-weight:800;font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;color:#8a5a2a}.ak-next b{font:700 2.8rem/1 var(--font-display);color:#5a2a8a}.ak-next span{font-size:.72rem;font-weight:700;color:#6a4a6a;max-width:9ch}
@keyframes ak-in{from{transform:translateX(-30px) rotate(-8deg);opacity:0}}
.ak-rolebar{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:10px}
.ak-role{display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:99px;background:rgba(255,255,255,.08);font-weight:800;font-size:.85rem}
.ak-role.t0{--tc:${TCOL[0]};color:var(--tc)}.ak-role.t1{--tc:${TCOL[1]};color:var(--tc)}.ak-role .ic{width:1em;height:1em}
.ak-tally{display:inline-flex;align-items:center;gap:8px;font-weight:800}.ak-tally b{display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:99px}
.ak-tally .yes{background:rgba(62,224,161,.2);color:#8ff5c8}.ak-tally .no{background:rgba(255,107,129,.2);color:#ffb3c0}.ak-tally .ic{width:.9em;height:.9em}.ak-tally small{color:rgba(255,255,255,.7)}
.ak-actions{display:flex;flex-wrap:wrap;justify-content:center;gap:10px}
.ak-actions button{min-height:48px;font-size:1.02rem;display:inline-flex;align-items:center;gap:8px}.ak-actions .ic{width:1.1em;height:1.1em}
.ak-actions button:active{transform:scale(.97)}
.ak-big{min-width:170px;justify-content:center}
.ak-form{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:center;gap:10px}
.ak-form label{display:flex;flex-direction:column;align-items:center;gap:4px}.ak-form small{color:#ffe7b0;font-weight:700}
.ak-form input{width:72px;height:64px;padding:0;text-align:center;font:700 2.4rem var(--font-display);text-transform:uppercase;border-radius:14px;border:3px solid #ffd166;background:#fffaf0;color:#5a2a8a}
.ak-hint{margin:0;text-align:center;color:#f2e8ff;font-weight:700}
.ak-trailbox{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border-radius:16px;background:rgba(10,4,24,.35)}
.ak-trailbox>small{font-weight:800;font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;color:rgba(255,255,255,.65)}
.ak-trail{display:flex;flex-wrap:wrap;gap:6px 20px;align-items:center}
.ak-chip{position:relative;display:inline-flex;align-items:center;gap:3px;height:34px;padding:0 8px;border-radius:10px;background:color-mix(in srgb,var(--tc) 22%,#1a0b2e);border:2px solid color-mix(in srgb,var(--tc) 60%,transparent);animation:ak-in .35s ease-out}
.ak-chip.t0{--tc:${TCOL[0]}}.ak-chip.t1{--tc:${TCOL[1]}}
.ak-chip b{font:700 1.1rem var(--font-display);color:#fff}.ak-chip .ak-sym{width:13px;height:13px}
.ak-chip+.ak-chip::before{content:"→";position:absolute;left:-17px;top:50%;transform:translateY(-50%);color:rgba(255,255,255,.55);font-weight:800}
.ak-chip.miss{opacity:.6}.ak-chip.miss b{text-decoration:line-through;text-decoration-thickness:2px}.ak-chip .ak-x{width:12px;height:12px;color:#ff8a9c}
.ak-chip.cur{background:#fffaf0;border-color:var(--tc)}.ak-chip.cur b{color:#5a2a8a}
.ak-rosters{display:flex;flex-direction:column;gap:14px}
.ak-roster h3{display:flex;align-items:center;gap:8px;margin:0 0 6px;font-size:1rem;color:var(--tc)}.ak-roster.t0{--tc:${TCOL[0]}}.ak-roster.t1{--tc:${TCOL[1]}}
.ak-roster .ak-sym{width:18px;height:18px}.ak-rscore{margin-left:auto;color:var(--muted);font-size:.85rem}
.ak-member{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;align-items:center;gap:8px;padding:5px 6px;border-radius:12px}
.ak-member.me{background:rgba(255,255,255,.06)}
.ak-face{display:block;width:36px;height:36px;border-radius:50%;overflow:hidden;box-shadow:0 0 0 3px var(--tc)}
.ak-mname{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700}
.ak-member .tag .ic{width:.9em;height:.9em}
@media (max-width:520px){
  .ak-felt{gap:10px;padding-top:30px}
  .ak-board{gap:6px}.ak-team{padding:8px;gap:3px 6px}.ak-pts{font-size:2rem}.ak-tname b{font-size:.88rem}
  .ak-tw{display:none}.ak-goal{padding:4px 6px}.ak-goal b{font-size:1.2rem}
  .ak-ring{width:148px;height:148px}.ak-card{width:124px;height:124px}.ak-letter{font-size:5rem}
  .ak-next{padding:8px 10px}.ak-next b{font-size:2.2rem}
  .ak-caption{font-size:1rem}.ak-big{min-width:0;flex:1 1 140px}
  .ak-mini{width:20px;height:20px}
}
`;

/* Cover art: an evening antakshari. Two groups of friends sit around a harmonium and a dholak under string lights;
   one from each side is singing, notes float up, and the letter card "M" glows in the spotlight (ids prefixed akc-). */
function coverSVG() {
  const person = (x, y, sc, skin, hair, top, mood, long) => `<g transform="translate(${x} ${y}) scale(${sc})">
    <path d="M-25 48q25-36 50 0v22h-50z" fill="${top}"/><path d="M-21 42q21-26 42 0" fill="none" stroke="#fff" stroke-opacity=".22" stroke-width="2"/>
    <rect x="-5" y="18" width="10" height="10" fill="${skin}"/>
    <circle cx="0" cy="6" r="16" fill="${skin}"/>
    ${long ? `<path d="M-17 8q-3-25 17-25q20 0 17 25l-2 18q-4-14-4-22q-11-6-22 0q0 8-4 22z" fill="${hair}"/>` : `<path d="M-16 4q0-21 16-21q17 0 16 21q-5-11-16-12q-11 1-16 12z" fill="${hair}"/>`}
    <circle cx="-5.5" cy="7" r="1.9" fill="#1a0f08"/><circle cx="5.5" cy="7" r="1.9" fill="#1a0f08"/>
    ${mood === 'sing' ? '<ellipse cx="0" cy="14.5" rx="3.6" ry="4.4" fill="#6a1f2a"/>' : '<path d="M-5 13q5 5 10 0" stroke="#6a2a1a" stroke-width="1.8" fill="none" stroke-linecap="round"/>'}
    <circle cx="-9.5" cy="12" r="2.6" fill="#ff7a8a" opacity=".35"/><circle cx="9.5" cy="12" r="2.6" fill="#ff7a8a" opacity=".35"/>
  </g>`;
  const note = (x, y, s, c, r = 0) => `<g transform="translate(${x} ${y}) rotate(${r}) scale(${s})"><path d="M4 -14v12.5a4.2 3.4 -20 1 1 -2.4 -3V-14l9 -3v3.5z" fill="${c}"/></g>`;
  const wire = (t) => [320 * t, 10 + 34 * 4 * t * (1 - t) * (t < 0.5 ? 1 : 0.8)];
  const BULB = ['#ff5d8f', '#ffd166', '#3ee0a1', '#4cc3ff', '#b197fc', '#ff9f43'];
  const bulbs = Array.from({ length: 15 }, (_, i) => {
    const [x, y] = wire((i + 0.5) / 15), c = BULB[i % 6];
    return `<circle cx="${x.toFixed(1)}" cy="${(y + 6).toFixed(1)}" r="11" fill="url(#akc-glow)" opacity=".5"/><rect x="${(x - 1.5).toFixed(1)}" y="${y.toFixed(1)}" width="3" height="3" fill="#3a2a40"/><ellipse cx="${x.toFixed(1)}" cy="${(y + 7).toFixed(1)}" rx="3.6" ry="4.6" fill="${c}"/><circle cx="${(x - 1.2).toFixed(1)}" cy="${(y + 5.5).toFixed(1)}" r="1.2" fill="#fff" opacity=".8"/>`;
  }).join('');
  const wirePath = Array.from({ length: 33 }, (_, i) => wire(i / 32)).map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
  const keys = Array.from({ length: 12 }, (_, i) => `<rect x="${121 + i * 6.4}" y="143" width="5.6" height="12" rx="1" fill="#fffaf0"/>`).join('')
    + [0, 1, 3, 4, 5, 7, 8, 10].map((i) => `<rect x="${125.4 + i * 6.4}" y="143" width="3.4" height="7" rx=".8" fill="#2a1a20"/>`).join('');
  return `<svg viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="akc-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b1563"/><stop offset=".6" stop-color="#26104b"/><stop offset="1" stop-color="#170a31"/></linearGradient>
    <linearGradient id="akc-spot" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff0c8" stop-opacity=".55"/><stop offset="1" stop-color="#fff0c8" stop-opacity="0"/></linearGradient>
    <radialGradient id="akc-glow"><stop offset="0" stop-color="#fff2c0" stop-opacity=".9"/><stop offset="1" stop-color="#fff2c0" stop-opacity="0"/></radialGradient>
    <linearGradient id="akc-card" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fffdf4"/><stop offset="1" stop-color="#f4c97a"/></linearGradient>
    <linearGradient id="akc-floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a3a3a"/><stop offset="1" stop-color="#4a1a2a"/></linearGradient>
    <linearGradient id="akc-wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b8743e"/><stop offset="1" stop-color="#6a3a1a"/></linearGradient>
    <linearGradient id="akc-drum" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff6b5a"/><stop offset=".5" stop-color="#d23a3a"/><stop offset="1" stop-color="#7a1a2a"/></linearGradient>
    <radialGradient id="akc-pool" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffe2a0" stop-opacity=".45"/><stop offset="1" stop-color="#ffe2a0" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="320" height="200" fill="url(#akc-sky)"/>
  <g fill="#fff" opacity=".6"><circle cx="40" cy="44" r=".9"/><circle cx="96" cy="30" r="1.1"/><circle cx="230" cy="34" r=".9"/><circle cx="286" cy="50" r="1.1"/><circle cx="20" cy="70" r=".8"/></g>
  <path d="M138 0h44l46 150h-136z" fill="url(#akc-spot)"/>
  <path d="${wirePath}" fill="none" stroke="#1a0a24" stroke-width="1.4"/>${bulbs}
  <rect x="0" y="146" width="320" height="54" fill="url(#akc-floor)"/>
  <ellipse cx="160" cy="166" rx="150" ry="22" fill="#d9a441" opacity=".25"/><ellipse cx="160" cy="166" rx="138" ry="17" fill="none" stroke="#ffd166" stroke-opacity=".45" stroke-width="1.6" stroke-dasharray="4 3"/>
  <ellipse cx="160" cy="150" rx="70" ry="12" fill="url(#akc-pool)"/>
  <!-- the left group (saffron) -->
  ${person(34, 92, 0.95, '#c98a5e', '#1d1430', '#ff9f1c', 'smile', true)}
  ${person(82, 88, 1, '#a86a42', '#2a1430', '#ff5d8f', 'sing')}
  ${person(54, 116, 1.1, '#e0a878', '#3a1a10', '#ffb020', 'smile')}
  <!-- the right group (sky blue) -->
  ${person(240, 88, 1, '#c98a5e', '#1a1030', '#4cc3ff', 'sing', true)}
  ${person(288, 92, 0.95, '#8a5a3a', '#120a1a', '#6c7cff', 'smile')}
  ${person(266, 116, 1.1, '#d49a6a', '#2a1a20', '#2ec4b6', 'smile', true)}
  <!-- harmonium -->
  <g><path d="M114 141h92l6 6v24h-104v-24z" fill="url(#akc-wood)"/><rect x="114" y="136" width="92" height="7" rx="2" fill="#d08a4a"/>
    <path d="M118 158h84M118 164h84" stroke="#4a2410" stroke-opacity=".5"/>${keys}
    <path d="M118 126l6 10 6-10 6 10 6-10 6 10 6-10 6 10 6-10 6 10 6-10 6 10 6-10 6 10" fill="none" stroke="#e8c070" stroke-width="2" stroke-linejoin="round"/>
    <rect x="108" y="171" width="104" height="5" rx="2" fill="#4a2410"/></g>
  <!-- dholak -->
  <g transform="translate(222 172)"><path d="M-22 -10q22 -6 44 0v20q-22 6 -44 0z" fill="url(#akc-drum)"/>
    <path d="M-18 -9l8 19M-10 -10l8 20M-2 -11l8 21M6 -10l8 20" stroke="#ffe7b0" stroke-width="1.1" opacity=".8"/>
    <ellipse cx="-22" cy="0" rx="4" ry="10.5" fill="#f3e2c0" stroke="#7a1a2a"/><ellipse cx="22" cy="0" rx="4" ry="10.5" fill="#e8d0a8" stroke="#7a1a2a"/></g>
  <!-- the letter card in the spotlight -->
  <g transform="translate(160 70) rotate(-4)"><rect x="-27" y="-34" width="54" height="64" rx="9" fill="#a05a20" opacity=".35" transform="translate(3 4)"/>
    <rect x="-27" y="-34" width="54" height="64" rx="9" fill="url(#akc-card)" stroke="#ffd166" stroke-width="2.5"/>
    <text x="0" y="16" text-anchor="middle" font-family="Fredoka,Nunito,sans-serif" font-weight="700" font-size="46" fill="#c2185b">M</text></g>
  ${note(106, 66, 1, '#ffd166', -10)}${note(118, 44, 0.8, '#ff9fc0', 8)}${note(98, 40, 0.6, '#ffffff', -4)}
  ${note(212, 60, 1, '#8be6ff', 10)}${note(200, 38, 0.75, '#b197fc', -6)}${note(222, 34, 0.6, '#ffffff', 4)}
  <g fill="#ffd166"><path d="M300 74l1.6 4.4 4.4 1.6-4.4 1.6-1.6 4.4-1.6-4.4-4.4-1.6 4.4-1.6z"/><path d="M18 108l1.3 3.6 3.6 1.3-3.6 1.3-1.3 3.6-1.3-3.6-3.6-1.3 3.6-1.3z"/></g>
</svg>`;
}

export default {
  id: 'antakshari', name: 'Antakshari',
  description: 'The classic Indian singing game for two teams: sing a song that starts with the letter on stage, and its last letter goes to the other team. Any language counts! For 2–8.',
  minPlayers: 2, maxPlayers: 8,
  noBotSeats: true, // singing can't be simulated: the lobby shows no "Add computer" button
  options: [
    { id: 'target', label: '🏆 Songs to win', default: '10', choices: [['5', '5 songs (quick)'], ['10', '10 songs'], ['15', '15 songs (long)']] },
    { id: 'time', label: '⏱ Time to sing', default: '30', choices: [['20', '20 seconds'], ['30', '30 seconds'], ['45', '45 seconds']] },
    { id: 'start', label: '🔤 First letter', default: 'm', choices: [['m', 'M (the tradition)'], ['random', 'A random letter']] },
  ],
  cover: coverSVG(),
  howTo: {
    goal: 'Be the first team to sing the target number of songs. Each song must start with the letter on stage.',
    turn: [
      ['🎤', 'Sing on the letter', 'The stage shows a letter. The singing team has 20–45 seconds to sing a bit of any song that starts with it.'],
      ['🔤', 'Pass the last letter', 'Anyone on the team taps “We sang it” and types the last letter of the song (A–Z). That is the other team’s letter.'],
      ['✋', 'Challenge it?', 'The other team has 10 seconds to challenge or accept. A challenge goes to a vote of everyone not on the singing team (the whole table if that would be one person). Most votes win; a tie keeps the song.'],
      ['⭐', 'Score or pass it on', 'A song that stands scores 1 point and its last letter goes across. If time runs out, the team is stuck, or a challenge wins, there is no point and the other team must sing on the same letter. If both teams miss it, a fresh letter is dealt.'],
    ],
    tips: [
      'Use the headset button to sing over voice chat, or play in one room with one device.',
      'Hindi, Telugu, Tamil, English… any language counts. Type the Latin letter of the last sound.',
      'Songs ending in a vowel give the next team easy letters. Aim for a tricky ending!',
      'Teams are dealt at random every game; both rosters are shown beside the stage.',
      'The app never shows lyrics: you sing from memory.',
    ],
  },
  setup, act, turnOf, view, bot, render,
};
