// Atlas: the travelling word chain. Players take turns naming a place (a country, an Indian state or union
// territory, or a city) that starts with the last letter of the place before it: Delhi, India, Amsterdam,
// Madrid… No place may be named twice. Run out of time, pass, or name a "place" the table votes down and you
// lose a life. The last traveller with lives left wins.
//
// The turn clock is the host's: any player's screen sends { type: 'clock' } once a deadline has passed.
import { esc, log, addFx, rand, PLAYER_COLORS } from '../js/util.js';
import { injectCSS, morph } from '../js/fx.js';
import { sound } from '../js/sound.js';
import { icon } from '../js/icons.js';
import { portrait } from '../js/avatar.js';
import { levelOption, levelOf } from '../js/levels.js';
import { PLACES, PLACE_ALIASES, NAMES, ANIMALS, THINGS, makeIndex, byLetter, firstLetter, squash, wordShaped } from './word-lists.js';

const browser = typeof document !== 'undefined';
const VOTE_MS = 15000, MAX_CHAIN = 120, MAXLEN = 40;
const START = 'abcdegikmnprstv'; // first letters with plenty of places
let IX = null, BY = null, OTHER = null, AK = null;
const aliasKeys = () => AK || (AK = new Set(Object.keys(PLACE_ALIASES).map(squash)));
const places = () => IX || (IX = makeIndex(PLACES, PLACE_ALIASES));
const byFirst = () => BY || (BY = byLetter(PLACES));
const notPlace = () => OTHER || (OTHER = [makeIndex(NAMES), makeIndex(ANIMALS, {}, { plural: true }), makeIndex(THINGS, {}, { plural: true })]);

const player = (s, pid) => s.players.find((p) => p.id === pid);
const named = (s, pid) => player(s, pid)?.name || '?';
const current = (s) => s.players[s.turn];
const alive = (s) => s.players.filter((p) => p.lives > 0);
const clean = (t) => String(t ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAXLEN);
const titled = (t) => t.replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
// How many places in the atlas start with a letter and haven't been named yet.
const remaining = (used, letter, without = '') => (byFirst()[letter] || []).filter((p) => { const k = squash(p); return k !== without && !used.includes(k); }).length;
// The next letter is the last letter of the place. If the atlas has no unnamed places left for it, the
// letter before it is used instead, and so on (so a game can never get stuck on a dead letter).
function nextLetter(used, text, without = '') {
  const s = squash(text);
  for (let i = s.length - 1; i >= 0; i--) if (remaining(used, s[i], without) > 0) return { letter: s[i], shifted: i !== s.length - 1 };
  return null;
}

/* ---------------- rules ---------------- */

function setup(players, opts = {}) {
  if (players.length < 2 || players.length > 8) throw Error('Atlas needs 2–8 players.');
  const lives = [1, 3, 5].includes(Number(opts.lives)) ? Number(opts.lives) : 3;
  const time = [10, 15, 20].includes(Number(opts.time)) ? Number(opts.time) : 15;
  const s = {
    phase: 'play', over: false, winners: [], log: [], level: levelOf(opts), lives, timeMs: time * 1000,
    players: players.map((p, i) => ({ id: p.id, name: p.name, seat: i, lives, places: 0, salt: rand(1e9) })),
    turn: rand(players.length), letter: START[rand(START.length)], chain: [], used: [], turnNo: 1, endsAt: 0, turnAt: 0, vote: null, event: null,
  };
  startTurn(s);
  log(s, `The journey starts with ${s.letter.toUpperCase()}. ${current(s).name} goes first.`);
  return s;
}

function startTurn(s) {
  const now = Date.now();
  s.turnAt = now; s.endsAt = now + s.timeMs; s.phase = 'play'; s.vote = null;
}
function advance(s) {
  const n = s.players.length;
  for (let k = 1; k <= n; k++) { const i = (s.turn + k) % n; if (s.players[i].lives > 0) { s.turn = i; break; } }
  s.turnNo++;
  startTurn(s);
}
function event(s, kind, pid, text) { s.event = { seq: (s.event?.seq || 0) + 1, kind, pid, text }; }

function finish(s, why) {
  const best = Math.max(...s.players.map((p) => p.lives));
  const tops = s.players.filter((p) => p.lives === best);
  // Still level on lives: whoever named more places wins.
  const most = Math.max(...tops.map((p) => p.places));
  Object.assign(s, { phase: 'over', over: true, vote: null, winners: tops.filter((p) => p.places === most).map((p) => p.id) });
  log(s, `${why} ${s.winners.map((id) => named(s, id)).join(' & ')} ${s.winners.length > 1 ? 'share the win' : 'wins'}!`);
}

function accept(s, pid, shown, key, how) {
  const me = player(s, pid);
  s.chain.push({ text: shown, by: pid, how });
  s.used.push(key);
  if (squash(shown) !== key) s.used.push(squash(shown));
  me.places++;
  addFx(s, { kind: 'sound', sound: 'place' });
  addFx(s, { kind: 'float', at: `at-p-${pid}`, text: '✓', color: '#7be3a8' });
  const next = nextLetter(s.used, shown);
  event(s, 'ok', pid, shown);
  if (!next) { log(s, `${me.name} named ${shown}.`); return finish(s, 'The atlas is used up!'); }
  s.letter = next.letter;
  log(s, `${me.name} named ${shown}${how === 'vote' ? ' (voted in)' : ''}. Next: ${s.letter.toUpperCase()}${next.shifted ? ' (no places left for its last letter)' : ''}.`);
  if (s.chain.length >= MAX_CHAIN) return finish(s, `${MAX_CHAIN} places named: the journey is over.`);
  advance(s);
}

function loseLife(s, pid, why) {
  const me = player(s, pid);
  me.lives = Math.max(0, me.lives - 1);
  const what = why === 'time' ? 'ran out of time' : why === 'pass' ? 'passed' : `named ${s.vote?.text || 'a place'}, but the table said no`;
  event(s, me.lives ? 'life' : 'out', pid, what);
  log(s, `${me.name} ${what} and ${me.lives ? `loses a life (${me.lives} left)` : 'is out of lives'}.`);
  addFx(s, { kind: 'sound', sound: 'bad' });
  addFx(s, { kind: 'shake', at: `at-p-${pid}` });
  if (alive(s).length <= 1) return finish(s, `${me.name} is out.`);
  advance(s); // the same letter passes to the next traveller
}

// The majority decides and a tie lets it in; anyone silent when the time is up counts as a thumbs up.
function resolveVote(s) {
  const v = s.vote, voters = s.players.filter((p) => p.id !== v.by);
  const no = voters.filter((p) => v.votes[p.id] === false).length, yes = voters.length - no;
  if (yes >= no) accept(s, v.by, v.text, v.key, 'vote');
  else loseLife(s, v.by, 'rejected');
}

const due = (s, now = Date.now()) => (s.phase === 'play' && now >= s.endsAt) || (s.phase === 'vote' && now >= s.vote.until);

function tick(s) {
  const now = Date.now();
  if (s.phase === 'play' && now >= s.endsAt) loseLife(s, current(s).id, 'time');
  else if (s.phase === 'vote' && now >= s.vote.until) resolveVote(s);
}

function act(s, pid, a) {
  if (s.over) throw Error('The game is over.');
  const me = player(s, pid);
  if (!me) throw Error('You are not playing in this game.');
  if (!a || typeof a !== 'object') throw Error('Choose something to do.');
  if (a.type === 'think') return;
  // The host's clock decides: anything that arrives after the deadline applies it, and the late move is dropped.
  if (due(s)) return tick(s);
  switch (a.type) {
    case 'clock': return; // early, or sent for a deadline that has already been replaced
    case 'place': {
      if (s.phase !== 'play') throw Error('Wait for the vote to finish.');
      if (current(s).id !== pid) throw Error(`It's ${current(s).name}'s turn.`);
      if (typeof a.text !== 'string') throw Error('Type a place.');
      const text = clean(a.text);
      if (squash(text).length < 2) throw Error('Type a place.');
      if (firstLetter(text) !== s.letter) throw Error(`It has to start with ${s.letter.toUpperCase()}.`);
      const hit = places().find(text);
      if (hit) {
        const key = squash(hit);
        if (s.used.includes(key) || s.used.includes(squash(text))) throw Error(`${hit} has already been named.`);
        // An old name or nickname is shown as said (Bombay); a slip is shown spelled right.
        const shown = aliasKeys().has(squash(text)) ? titled(text) : hit;
        return accept(s, pid, shown, key, 'list');
      }
      const key = squash(text);
      if (s.used.includes(key)) throw Error(`${titled(text)} has already been named.`);
      s.phase = 'vote';
      s.vote = { by: pid, text: titled(text), key, votes: {}, until: Date.now() + VOTE_MS };
      log(s, `${me.name} says ${titled(text)}. It isn't in the atlas, so the table votes.`);
      addFx(s, { kind: 'sound', sound: 'card' });
      return;
    }
    case 'pass': {
      if (s.phase !== 'play') throw Error('Wait for the vote to finish.');
      if (current(s).id !== pid) throw Error(`It's ${current(s).name}'s turn.`);
      return loseLife(s, pid, 'pass');
    }
    case 'vote': {
      if (s.phase !== 'vote') throw Error('There is nothing to vote on right now.');
      if (s.vote.by === pid) throw Error('You can’t vote on your own place.');
      if (typeof a.ok !== 'boolean') throw Error('Vote thumbs up or thumbs down.');
      s.vote.votes[pid] = a.ok;
      if (s.players.every((p) => p.id === s.vote.by || p.id in s.vote.votes)) resolveVote(s);
      return;
    }
  }
  throw Error('Unknown action.');
}

function turnOf(s) {
  if (s.over) return [];
  if (s.phase === 'vote') return s.players.filter((p) => p.id !== s.vote.by && !(p.id in s.vote.votes)).map((p) => p.id);
  return [current(s).id];
}

function view(s, pid) {
  const v = JSON.parse(JSON.stringify(s));
  v.players = v.players.map((p) => (p.id === pid ? p : { ...p, salt: 0 }));
  v.left = remaining(s.used, s.letter);
  v.hostNow = Date.now();
  return v;
}

/* ---------------- computer players ---------------- */

// Each computer knows only part of the atlas (decided once from its private seed), may blank on a turn,
// and takes a moment to think. Easy knows less, blanks more and is slow (it can run out of time). Hard
// knows nearly everything and picks places whose last letter leaves the next player the fewest choices.
const LEVEL = {
  easy: { know: 0.4, blank: 0.12, wait: [4000, 9000] },
  normal: { know: 0.65, blank: 0.05, wait: [2000, 5000] },
  hard: { know: 0.95, blank: 0.01, wait: [1200, 3000] },
};
function prng(seed) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => { h += 0x6D2B79F5; let n = h; n = Math.imul(n ^ n >>> 15, n | 1); n ^= n + Math.imul(n ^ n >>> 7, n | 61); return ((n ^ n >>> 14) >>> 0) / 4294967296; };
}
const levelName = (l) => (l === 'easy' || l === 'hard' ? l : 'normal');

function choose(v, pid) {
  const me = v.players.find((p) => p.id === pid), L = LEVEL[levelName(v.level)], lvl = levelName(v.level);
  const r = prng(`${me?.salt}:${pid}:${v.turnNo}:${v.chain.length}`);
  const wait = L.wait[0] + r() * (L.wait[1] - L.wait[0]);
  if (r() < L.blank) return { wait, pick: null };
  const known = (byFirst()[v.letter] || []).filter((p) => !v.used.includes(squash(p)) && prng(`${me?.salt}:${squash(p)}`)() < L.know);
  if (!known.length) return { wait, pick: null };
  if (lvl === 'easy') return { wait, pick: known[Math.floor(r() * Math.min(known.length, 6))] }; // the first few that come to mind
  if (lvl === 'normal') return { wait, pick: known[Math.floor(r() * known.length)] };
  let best = [], top = Infinity;
  for (const p of known) {
    const k = squash(p), next = nextLetter(v.used.concat(k), p);
    const left = next ? remaining(v.used, next.letter, k) : 0;
    if (left < top) { top = left; best = [p]; } else if (left === top) best.push(p);
  }
  return { wait, pick: best[Math.floor(r() * best.length)] };
}
function judge(text, level) {
  let ok = places().has(text) || (!notPlace().some((ix) => ix.has(text)) && wordShaped(text));
  if (levelName(level) === 'easy' && Math.random() < 0.25) ok = !ok;
  return ok;
}

function bot(v, pid) {
  const think = { type: 'think' };
  const due = v.phase === 'play' ? v.endsAt : v.vote?.until;
  if (browser && due && Date.now() > due + 300) return { type: 'clock' };
  if (v.phase === 'vote') return v.vote.by !== pid && !(pid in v.vote.votes) ? { type: 'vote', ok: judge(v.vote.text, v.level) } : think;
  if (v.players[v.turn]?.id !== pid) return think;
  const { wait, pick } = choose(v, pid);
  if (!browser) return pick ? { type: 'place', text: pick } : { type: 'pass' };
  const spent = Date.now() - v.turnAt;
  if (!pick) return levelName(v.level) === 'easy' ? think : spent > Math.min(wait + 2500, v.timeMs - 1500) ? { type: 'pass' } : think; // Easy just runs out of time
  const ready = levelName(v.level) === 'easy' ? wait : Math.min(wait, v.timeMs - 2500);
  return spent >= ready ? { type: 'place', text: pick } : think;
}

// Time's up for a person: the turn is passed (a life is lost) and a pending vote is a thumbs up.
function onTimeout(v, pid) {
  if (v.phase === 'vote') return v.vote.by !== pid && !(pid in v.vote.votes) ? { type: 'vote', ok: true } : { type: 'think' };
  return v.players[v.turn]?.id === pid ? { type: 'pass' } : { type: 'think' };
}

/* ---------------- screen ---------------- */

const ic = (d) => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;
const UP = ic('<path d="M7 11v9H4.5V11zM7 11l4-7.5c1.6 0 2.6 1.2 2.2 2.8L12.6 9.5h5.6a2 2 0 0 1 2 2.4l-1.3 6.4a2 2 0 0 1-2 1.7H7"/>');
const DOWN = ic('<path d="M7 13V4H4.5v9zM7 13l4 7.5c1.6 0 2.6-1.2 2.2-2.8l-.6-3.2h5.6a2 2 0 0 0 2-2.4l-1.3-6.4a2 2 0 0 0-2-1.7H7"/>');
const PIN = ic('<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>');
const SKIP = ic('<path d="M5 6l7 6-7 6zM13 6l7 6-7 6z"/>');
const HEART = 'M10 17.2S2.6 12.6 2.6 7.4A3.9 3.9 0 0 1 10 5.2a3.9 3.9 0 0 1 7.4 2.2c0 5.2-7.4 9.8-7.4 9.8z';
// A life you have is a solid heart; a lost one is a hollow heart with a crack (shape, not just colour).
const heart = (on) => `<svg class="at-heart ${on ? 'on' : 'off'}" viewBox="0 0 20 20" aria-hidden="true">${on ? `<path d="${HEART}" fill="currentColor"/><path d="M6.2 6.6a2 2 0 0 1 2-.8" stroke="#fff" stroke-opacity=".7" stroke-width="1.4" fill="none" stroke-linecap="round"/>` : `<path d="${HEART}" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 5.6l-1.4 3.2 2.4 1.6-1.6 3.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>`}</svg>`;
const hearts = (p, max) => `<span class="at-hearts" aria-label="${p.lives} of ${max} lives">${Array.from({ length: max }, (_, i) => heart(i < p.lives)).join('')}</span>`;

const UI = { v: null, ctx: null, root: null, offset: 0, hostNow: 0, clockSent: 0, logOpen: false, draft: '', turnKey: '' };
const amPlayer = () => !!UI.v?.players.some((p) => p.id === UI.ctx?.me);
const hostTime = () => Date.now() + UI.offset;
const deadlineOf = (v) => (v.over ? 0 : v.phase === 'vote' ? v.vote.until : v.endsAt);

function clockFace() {
  const v = UI.v;
  if (!v || !UI.root) return;
  const until = deadlineOf(v), total = v.phase === 'vote' ? VOTE_MS : v.timeMs, ms = until ? until - hostTime() : 0;
  UI.root.querySelectorAll('.at-clock').forEach((c) => {
    const left = Math.max(0, Math.ceil(ms / 1000)), text = until ? String(left) : '';
    const t = c.querySelector('.at-time');
    if (t.textContent !== text) t.textContent = text;
    c.classList.toggle('low', v.phase === 'play' && left <= 5);
    c.style.setProperty('--p', until ? Math.max(0, Math.min(1, ms / total)).toFixed(3) : '0');
  });
}
if (browser) setInterval(() => {
  const v = UI.v;
  if (!v || !UI.root?.isConnected) return;
  clockFace();
  const until = deadlineOf(v);
  if (until && amPlayer() && hostTime() > until + 300 && Date.now() - UI.clockSent > 1500) { UI.clockSent = Date.now(); UI.ctx.send({ type: 'clock' }); }
}, 250);

function hintFor(v) {
  const L = v.letter.toUpperCase();
  if (v.left <= 4) return `Only ${v.left} atlas place${v.left === 1 ? '' : 's'} left for ${L}. A place the table knows can still be voted in.`;
  const tips = [
    'Places ending in A are popular: watch out for long A chains.',
    'Tricky endings like Q (Iraq), Y or U leave the next traveller few choices.',
    'Old names count too: Bombay, Madras, Calcutta, Ceylon.',
    'A place that isn’t in the atlas goes to a vote. If the table says no, you lose a life.',
    'Countries, Indian states and union territories, and cities all count.',
    'Spelling is forgiving: capitals, accents, spaces and small slips don’t matter.',
  ];
  return tips[v.turnNo % tips.length];
}

const stamp = (c, i, v, ctx) => {
  const p = player(v, c.by), t = esc(c.text), sq = c.text.length;
  const body = sq > 1 ? `<b>${esc(c.text[0])}</b>${esc(c.text.slice(1, -1))}<b class="end">${esc(c.text.slice(-1))}</b>` : t;
  return `<span class="at-stamp ${c.how === 'vote' ? 'voted' : ''}" data-k="at-c-${i}" style="--pc:${PLAYER_COLORS[(p?.seat || 0) % PLAYER_COLORS.length]}" title="${esc(p?.name || '')}">${body}</span>`;
};
const face = (p, ctx) => `<span class="at-face" style="--pc:${PLAYER_COLORS[p.seat % PLAYER_COLORS.length]}">${portrait({ id: p.id, bot: !!ctx.isBot?.(p.id) })}</span>`;

function render(el, v, ctx) {
  injectCSS('atlas', STYLE);
  if (v.hostNow && v.hostNow !== UI.hostNow) { UI.hostNow = v.hostNow; UI.offset = v.hostNow - Date.now(); }
  UI.v = v; UI.ctx = ctx; UI.root = el;
  const me = v.players.find((p) => p.id === ctx.me), cur = v.players[v.turn], L = v.letter.toUpperCase();
  const myTurn = !v.over && v.phase === 'play' && cur.id === ctx.me;
  const turnKey = `${v.turnNo}:${ctx.me}`;
  const fresh = UI.turnKey !== turnKey;
  if (fresh) { UI.turnKey = turnKey; UI.draft = ''; }
  const canVote = !v.over && v.phase === 'vote' && me && v.vote.by !== me.id;

  const status = v.over ? (v.winners.includes(ctx.me) ? 'You win the journey!' : `${esc(v.winners.map((id) => named(v, id)).join(' & '))} ${v.winners.length > 1 ? 'share the win' : 'wins'}!`)
    : v.phase === 'vote' ? (canVote ? `Is ${esc(v.vote.text)} a real place?` : v.vote.by === ctx.me ? 'The table is voting on your place…' : `The table is voting on ${esc(v.vote.text)}…`)
    : myTurn ? `Your turn: name a place starting with ${L}.` : `${esc(cur.name)} is thinking of a place with ${L}…`;
  const ev = v.event;
  const evLine = ev ? `<p class="at-event ${ev.kind}" data-k="at-ev-${ev.seq}">${ev.kind === 'ok' ? PIN : heart(false)}<span><b>${esc(named(v, ev.pid))}</b> ${ev.kind === 'ok' ? `named <b>${esc(ev.text)}</b>` : esc(ev.text) + (ev.kind === 'out' ? ' and is out!' : ' and loses a life.')}</span></p>` : '';
  const SHOW = 12, shown = v.chain.slice(-SHOW);
  const chain = v.chain.length ? `${v.chain.length > SHOW ? `<span class="at-more">+${v.chain.length - SHOW}</span>` : ''}${shown.map((c, k) => stamp(c, v.chain.length - shown.length + k, v, ctx)).join('')}`
    : `<span class="at-empty">The journey begins with ${L}…</span>`;

  let action = '';
  if (myTurn) action = `<form class="at-play" autocomplete="off"><label class="at-field">${PIN}<input id="atIn" maxlength="${MAXLEN}" autocomplete="off" autocorrect="off" autocapitalize="words" spellcheck="false" enterkeyhint="go" value="${esc(UI.draft)}" placeholder="A place starting with ${L}" aria-label="A place starting with ${L}"></label>
      <button class="primary" id="atGo">${icon('check')}<span>Go</span></button><button type="button" class="ghost" id="atPass">${SKIP}<span>Pass</span></button></form>
      <p class="at-small">Passing or running out of time costs a life.</p>`;
  else if (v.phase === 'vote' && !v.over) {
    const yes = Object.values(v.vote.votes).filter(Boolean).length, no = Object.values(v.vote.votes).length - yes, mine = me && me.id in v.vote.votes ? v.vote.votes[me.id] : null;
    action = `<div class="at-vote ${canVote && mine == null ? 'can' : ''}"><span class="at-vby">${face(player(v, v.vote.by), ctx)}<small>${esc(named(v, v.vote.by))} says</small></span><b class="at-vword">${esc(v.vote.text)}</b>
      <span class="at-vtally" aria-label="${yes} up, ${no} down">${UP}<b>${yes}</b>${DOWN}<b>${no}</b></span>
      ${canVote ? `<span class="at-vbtns"><button class="at-up ${mine === true ? 'on' : ''}" data-ok="1" aria-pressed="${mine === true}">${UP}<span>Real place</span></button><button class="at-down ${mine === false ? 'on' : ''}" data-ok="0" aria-pressed="${mine === false}">${DOWN}<span>Not a place</span></button></span>` : ''}
      <small class="at-vnote">Not in the atlas. Most votes decide; a tie or a missed vote lets it in.</small></div>`;
  } else if (!v.over && !me) action = `<div class="panel at-watch">${icon('eye')}<span>You are watching the journey.</span></div>`;

  const players = v.players.map((p) => `<div class="at-player ${p.id === ctx.me ? 'me' : ''} ${!v.over && cur.id === p.id && v.phase === 'play' ? 'turn' : ''} ${p.lives ? '' : 'out'} ${v.winners.includes(p.id) ? 'win' : ''}" data-a="at-p-${p.id}" data-k="at-pl-${p.id}">
      ${face(p, ctx)}<span class="at-pname"><b>${esc(p.name)}</b>${hearts(p, v.lives)}</span>
      ${!v.over && cur.id === p.id && v.phase === 'play' ? `<span class="tag t-good">${PIN}Turn</span>` : !p.lives ? '<span class="tag t-warn">Out</span>' : p.id === ctx.me ? '<span class="tag t-you">You</span>' : ''}
      <span class="at-count" title="Places named">${p.places}</span></div>`).join('');
  const typing = typeof document !== 'undefined' && document.activeElement?.id === 'atIn' && el.contains(document.activeElement);
  UI.logOpen = el.querySelector('.at-logbox')?.open ?? UI.logOpen;

  morph(el, `<div class="at-root"><div class="game-layout">
    <div class="felt at-felt">
      ${v.over ? `<div class="winner-banner">${icon('trophy')}${status}</div>` : ''}
      <div class="at-top">
        <div class="at-seal ${myTurn ? 'mine' : ''}" data-k="at-seal-${v.letter}" aria-label="Letter ${L}"><svg class="at-rose" viewBox="0 0 100 100" aria-hidden="true"><path d="M50 4 L57 43 L96 50 L57 57 L50 96 L43 57 L4 50 L43 43z" fill="rgba(120,80,30,.18)"/><path d="M50 18 L54 46 L82 50 L54 54 L50 82 L46 54 L18 50 L46 46z" fill="rgba(120,80,30,.14)"/></svg><b>${L}</b><small>${v.left} left</small></div>
        <div class="at-meta"><p class="at-status">${status}</p><p class="at-hint">${icon('bulb')}<span>${esc(hintFor(v))}</span></p></div>
        ${v.over ? '' : '<div class="at-clock" style="--p:1"><span class="at-time"></span></div>'}
      </div>
      <div class="at-map"><div class="at-chain" aria-label="Places named so far">${chain}</div>${evLine}</div>
      ${action}
    </div>
    <div class="side">
      <div class="panel at-players">${players}</div>
      <div class="panel at-rules"><b>How it works</b><span>${PIN}Start with the last letter of the place before.</span><span>${heart(true)}Pass, time out or get voted down: lose a life.</span><span>${icon('trophy')}Last traveller with lives wins.</span></div>
      <details class="panel drawer at-logbox" ${UI.logOpen ? 'open' : ''}><summary>${icon('book')}<span>Travel log</span><span class="note">${v.chain.length} places</span>${icon('chevron', 'chev')}</summary>
        <div class="drawer-body"><div class="parchment log">${v.log.slice(0, 12).map((l) => `<div>${esc(l)}</div>`).join('')}</div></div></details>
    </div>
  </div></div>`);

  const lb = el.querySelector('.at-logbox');
  if (lb) lb.ontoggle = () => { UI.logOpen = lb.open; };
  const form = el.querySelector('.at-play');
  if (form) {
    const input = form.querySelector('#atIn');
    input.oninput = () => { UI.draft = input.value; };
    form.onsubmit = (e) => { e.preventDefault(); if (!clean(input.value)) return; sound('click'); ctx.send({ type: 'place', text: input.value }); };
    form.querySelector('#atPass').onclick = () => ctx.send({ type: 'pass' });
    if (fresh && !typing && browser && matchMedia?.('(pointer: fine)').matches) input.focus({ preventScroll: true });
  }
  el.querySelectorAll('.at-vbtns [data-ok]').forEach((b) => (b.onclick = () => { sound('click'); ctx.send({ type: 'vote', ok: b.dataset.ok === '1' }); }));
  clockFace();
}

const STYLE = `
.at-felt{display:flex;flex-direction:column;gap:14px;background:
  radial-gradient(80% 60% at 80% -10%,rgba(120,220,255,.18),transparent 60%),
  repeating-linear-gradient(0deg,rgba(255,255,255,.035) 0 1px,transparent 1px 38px),repeating-linear-gradient(90deg,rgba(255,255,255,.035) 0 1px,transparent 1px 38px),
  linear-gradient(180deg,#145a78,#0c3550)}
.at-felt .winner-banner{display:flex;align-items:center;gap:10px}.at-felt .winner-banner .ic{width:1em;height:1em}
.at-top{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:14px}
.at-seal{position:relative;display:grid;place-items:center;width:96px;height:96px;border-radius:50%;color:#5a2a0a;
  background:radial-gradient(circle at 35% 28%,#fff6dc,#f0d9a6 55%,#d9b574);box-shadow:inset 0 0 0 4px #b8873f,inset 0 0 0 7px #f3e2bb,0 10px 22px rgba(0,0,0,.35);animation:at-in .45s cubic-bezier(.2,1.4,.4,1)}
.at-seal.mine{box-shadow:inset 0 0 0 4px #b8873f,inset 0 0 0 7px #f3e2bb,0 0 0 4px rgba(255,215,106,.55),0 10px 22px rgba(0,0,0,.35)}
.at-rose{position:absolute;inset:4px;width:calc(100% - 8px);height:calc(100% - 8px)}
.at-seal b{position:relative;font:700 3.2rem/1 var(--font-display);margin-top:-6px}
.at-seal small{position:absolute;bottom:13px;font:700 .66rem var(--font-display);letter-spacing:.04em;color:#8a5a26}
@keyframes at-in{from{transform:scale(.6) rotate(-30deg);opacity:0}to{transform:none;opacity:1}}
.at-meta{display:flex;flex-direction:column;gap:6px;min-width:0}
.at-status{margin:0;font:700 1.15rem var(--font-display);color:#fff}
.at-hint{display:flex;align-items:flex-start;gap:6px;margin:0;color:#cfeaff;font-size:.88rem;font-weight:700}.at-hint .ic{flex:none;width:18px;height:18px;color:#ffd76a}
.at-clock{--p:1;position:relative;display:grid;place-items:center;width:62px;height:62px;border-radius:50%;background:conic-gradient(#7be3a8 calc(var(--p)*360deg),rgba(255,255,255,.14) 0);transition:background .25s linear}
.at-clock::before{content:"";position:absolute;inset:6px;border-radius:50%;background:#0f3e5a}
.at-clock.low{background:conic-gradient(#ff7a8a calc(var(--p)*360deg),rgba(255,255,255,.14) 0)}
.at-time{position:relative;font:700 1.35rem var(--font-display);color:#fff}
.at-map{display:flex;flex-direction:column;gap:10px;padding:16px;border-radius:16px;color:#3b2a14;
  background:radial-gradient(120% 90% at 50% 0%,#fbf1d8,#efdcae 70%,#e2c78b);box-shadow:inset 0 0 0 2px rgba(150,110,50,.35),inset 0 0 30px rgba(150,100,40,.25),0 14px 28px rgba(0,0,0,.3)}
.at-chain{display:flex;flex-wrap:wrap;align-items:center;gap:8px 8px;min-height:44px}
.at-stamp{display:inline-flex;align-items:baseline;padding:6px 10px;border-radius:10px;background:#fffaf0;border:2px dashed color-mix(in srgb,var(--pc) 70%,#8a6a3a);font:600 1rem var(--font-display);color:#3b2a14;box-shadow:0 3px 0 rgba(120,80,30,.25);animation:at-stamp .4s cubic-bezier(.2,1.5,.4,1)}
.at-stamp b{color:#9a4a10}.at-stamp b.end{color:#fff;background:#c2410c;border-radius:5px;padding:0 3px;margin-left:1px}
.at-stamp:last-of-type{border-style:solid;transform:rotate(-2deg) scale(1.06)}
.at-stamp.voted{background:#fff2d6}
@keyframes at-stamp{from{transform:scale(1.6) rotate(8deg);opacity:0}to{opacity:1}}
.at-more{font:700 .85rem var(--font-display);color:#8a5a26;padding:4px 8px;border-radius:8px;background:rgba(150,110,50,.15)}
.at-empty{font-weight:700;color:#8a6a3a}
.at-event{display:flex;align-items:center;gap:8px;margin:0;padding:8px 10px;border-radius:10px;font-weight:700;animation:at-flash .5s ease-out}
.at-event .ic,.at-event .at-heart{width:20px;height:20px;flex:none}
.at-event.ok{background:rgba(47,154,94,.14);color:#1f5a38}.at-event.life,.at-event.out{background:rgba(201,55,67,.13);color:#8a1f2a}
@keyframes at-flash{from{transform:translateY(-6px);opacity:0}to{transform:none;opacity:1}}
.at-play{display:flex;gap:8px;margin:0}
.at-field{position:relative;flex:1;min-width:0;display:block}
.at-field .ic{position:absolute;left:12px;top:50%;transform:translateY(-50%);width:20px;height:20px;color:#c2410c}
.at-field input{width:100%;min-height:52px;padding:8px 12px 8px 40px;border:2px solid #ffd76a;border-radius:14px;background:#fffaf0;color:#2a1a08;font:600 1.2rem var(--font-display);box-shadow:0 0 0 4px rgba(255,215,106,.25)}
.at-field input:focus{outline:none;border-color:#ffb020;box-shadow:0 0 0 4px rgba(255,176,32,.35)}
.at-play button{min-height:52px;display:inline-flex;align-items:center;gap:6px}.at-play .ic{width:20px;height:20px}
.at-small{margin:-6px 0 0;color:#b9dcf2;font-size:.82rem;font-weight:700}
.at-watch{display:flex;align-items:center;gap:10px;margin:0}
.at-vote{position:relative;display:grid;grid-template-columns:auto minmax(0,1fr) auto;grid-template-areas:"by word tally" "btns btns btns" "note note note";align-items:center;gap:10px 12px;padding:14px;border-radius:16px;background:#fffaf0;color:#2a1a08;box-shadow:0 10px 22px rgba(0,0,0,.3)}
.at-vote.can::after{content:"";position:absolute;inset:-3px;border-radius:18px;border:2px solid rgba(255,215,106,.9);animation:at-breathe 2.2s ease-in-out infinite;pointer-events:none}
@keyframes at-breathe{0%,100%{opacity:.15}50%{opacity:1}}
.at-vby{grid-area:by;display:flex;align-items:center;gap:6px}.at-vby small{font-weight:800;color:#7a5a30}
.at-vword{grid-area:word;font:700 1.6rem var(--font-display);overflow-wrap:anywhere}
.at-vtally{grid-area:tally;display:flex;align-items:center;gap:4px;color:#7a5a30}.at-vtally .ic{width:18px;height:18px}.at-vtally b{margin-right:6px}
.at-vbtns{grid-area:btns;display:flex;gap:8px}
.at-vbtns button{flex:1;min-height:46px;display:inline-flex;align-items:center;justify-content:center;gap:6px;border-radius:12px;font-weight:800;transition:transform .12s}
.at-vbtns button:active{transform:scale(.96)}.at-vbtns .ic{width:20px;height:20px}
.at-up{background:#e3f6ea;color:#1f6b40;border:2px solid #9fd8b4}.at-up.on{background:#2f9a5e;color:#fff;border-color:#2f9a5e}
.at-down{background:#fde7e7;color:#9a2630;border:2px solid #f0aab0}.at-down.on{background:#c93743;color:#fff;border-color:#c93743}
.at-vnote{grid-area:note;color:#7a5a30;font-weight:700}
.at-players{display:flex;flex-direction:column;gap:4px}
.at-player{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;align-items:center;gap:10px;padding:6px 8px;border-radius:12px}
.at-player.me{background:rgba(255,255,255,.06)}.at-player.turn{background:rgba(123,227,168,.14)}.at-player.win{background:rgba(255,215,106,.16)}
.at-player.out{opacity:.55}.at-player.out .at-face{filter:grayscale(1)}
.at-face{display:block;width:38px;height:38px;border-radius:50%;overflow:hidden;box-shadow:0 0 0 3px var(--pc);flex:none}.at-face svg{display:block;width:100%;height:100%}
.at-pname{display:flex;flex-direction:column;gap:2px;min-width:0}.at-pname b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.at-hearts{display:flex;gap:2px}.at-heart{width:18px;height:18px}.at-heart.on{color:#ff5d7a}.at-heart.off{color:rgba(255,255,255,.45)}
.at-count{font:700 1.1rem var(--font-display);min-width:1.8em;text-align:right;color:#ffe3a3}
.at-player .tag .ic{width:.9em;height:.9em}
.at-rules{display:flex;flex-direction:column;gap:6px;font-size:.88rem}.at-rules span{display:flex;align-items:center;gap:8px;color:var(--muted)}.at-rules .ic,.at-rules .at-heart{width:18px;height:18px;flex:none}
@media (max-width:600px){
  .at-top{gap:10px}.at-seal{width:78px;height:78px}.at-seal b{font-size:2.5rem}.at-seal small{bottom:9px;font-size:.6rem}
  .at-clock{width:54px;height:54px}.at-time{font-size:1.15rem}.at-status{font-size:1rem}.at-hint{font-size:.8rem}
  .at-map{padding:12px}.at-stamp{font-size:.9rem;padding:5px 8px}
  .at-play{flex-wrap:wrap}.at-field{flex-basis:100%}.at-play button{flex:1;justify-content:center}
  .at-vote{grid-template-areas:"by tally" "word word" "btns btns" "note note";grid-template-columns:minmax(0,1fr) auto}
}
`;

/* Cover art: two young explorers on a hilltop over a sea of map. One holds up a big compass and calls
   "Oslo!" while the other unrolls a scroll of stamps: Delhi → Iraq → Quito → Oslo. A dotted route links
   pins across the map (self-contained ids, prefixed atc-). */
function coverSVG() {
  const pin = (x, y, c) => `<g transform="translate(${x} ${y})"><path d="M0 0 c-6 -8 -9 -12 -9 -17 a9 9 0 0 1 18 0 c0 5 -3 9 -9 17z" fill="${c}"/><circle cx="0" cy="-17" r="3.4" fill="#fff"/></g>`;
  const stampT = (x, y, t, rot) => `<g transform="translate(${x} ${y}) rotate(${rot})"><rect x="-24" y="-10" width="48" height="20" rx="4" fill="#fffaf0" stroke="#c2410c" stroke-width="1.4" stroke-dasharray="3 2"/>
    <text x="0" y="4.5" text-anchor="middle" font-family="Fredoka,sans-serif" font-weight="700" font-size="11" fill="#3b2a14">${t}</text></g>`;
  return `<svg viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="atc-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1d6f93"/><stop offset="1" stop-color="#0c3550"/></linearGradient>
    <radialGradient id="atc-sun" cx=".8" cy=".1" r=".6"><stop offset="0" stop-color="#ffe7a8" stop-opacity=".6"/><stop offset="1" stop-color="#ffe7a8" stop-opacity="0"/></radialGradient>
    <linearGradient id="atc-map" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbf1d8"/><stop offset="1" stop-color="#e2c78b"/></linearGradient>
    <linearGradient id="atc-hill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4fae6a"/><stop offset="1" stop-color="#2a6e44"/></linearGradient>
    <radialGradient id="atc-compass" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#fff6dc"/><stop offset="1" stop-color="#d9b574"/></radialGradient>
  </defs>
  <rect width="320" height="200" fill="url(#atc-sky)"/><rect width="320" height="200" fill="url(#atc-sun)"/>
  <!-- the map spread like a sea of land below -->
  <path d="M0 96 Q80 84 160 92 T320 88 V200 H0z" fill="url(#atc-map)"/>
  <g fill="#cfe3c0" opacity=".9"><path d="M20 120 q20 -14 44 -4 q14 8 4 20 q-22 10 -40 2z"/><path d="M118 108 q30 -8 52 4 q8 14 -12 20 q-26 4 -40 -8z"/><path d="M230 112 q26 -10 50 2 q10 16 -14 22 q-30 2 -36 -10z"/></g>
  <path d="M44 132 C80 150 110 104 146 118 S210 150 250 124" stroke="#9a4a10" stroke-width="2.2" stroke-dasharray="5 5" fill="none"/>
  ${pin(44, 134, '#d6457a')}${pin(146, 120, '#2f6fd0')}${pin(250, 126, '#2f9a5e')}
  <path d="M0 200 V168 Q60 140 130 158 Q170 168 190 200z" fill="url(#atc-hill)"/>
  <!-- explorer 1: compass held high -->
  <g transform="translate(70 128)">
    <path d="M-20 44 q20 -26 40 0 v10 h-40z" fill="#d9822b"/>
    <path d="M14 26 q14 -16 12 -40" stroke="#c98a5e" stroke-width="7" fill="none" stroke-linecap="round"/>
    <circle cx="0" cy="12" r="15" fill="#c98a5e"/><path d="M-16 8 q2 -20 16 -20 q16 0 16 20 l-4 -2 q-12 -10 -24 0z" fill="#3a2414"/>
    <path d="M-20 4 h40 l-6 -8 h-28z" fill="#e8c27a"/><rect x="-12" y="-12" width="24" height="9" rx="4" fill="#e8c27a"/>
    <circle cx="-5" cy="13" r="1.8" fill="#1a0f08"/><circle cx="5" cy="13" r="1.8" fill="#1a0f08"/><ellipse cx="0" cy="21" rx="4" ry="3.4" fill="#7a2a2a"/>
  </g>
  <g transform="translate(98 86)"><circle r="16" fill="url(#atc-compass)" stroke="#b8873f" stroke-width="3"/><path d="M0 -11 L4 0 L0 11 L-4 0z" fill="#c2410c"/><path d="M0 -11 L4 0 L-4 0z" fill="#7a2a0a"/><circle r="2" fill="#3b2a14"/></g>
  <g transform="translate(112 44)"><path d="M-30 -14 h60 a8 8 0 0 1 8 8 v12 a8 8 0 0 1 -8 8 h-38 l-10 10 l2 -10 h-14 a8 8 0 0 1 -8 -8 v-12 a8 8 0 0 1 8 -8z" fill="#fff"/>
    <text x="0" y="6" text-anchor="middle" font-family="Fredoka,sans-serif" font-weight="700" font-size="17" fill="#2f6fd0">Oslo!</text></g>
  <!-- explorer 2: unrolling the scroll of stamps -->
  <g transform="translate(284 100)">
    <path d="M-20 42 q20 -26 40 0 v12 h-40z" fill="#2f6fd0"/>
    <path d="M-16 44 q-14 6 -22 22 M16 44 q4 10 2 22" stroke="#8a5a3a" stroke-width="6" fill="none" stroke-linecap="round"/>
    <circle cx="0" cy="10" r="15" fill="#8a5a3a"/><path d="M-15 14 q-4 -26 15 -26 q19 0 15 26 l-3 -10 q-12 -8 -24 0z" fill="#140c1c"/>
    <circle cx="-5" cy="11" r="1.8" fill="#1a0f08"/><circle cx="5" cy="11" r="1.8" fill="#1a0f08"/><path d="M-4 18 q4 4 8 0" stroke="#5a2a1a" stroke-width="1.8" fill="none" stroke-linecap="round"/>
  </g>
  <g transform="translate(172 168) rotate(-4)"><rect x="0" y="-18" width="138" height="36" rx="3" fill="url(#atc-map)"/><circle cx="0" cy="0" r="18" fill="#e2c78b"/><circle cx="138" cy="0" r="18" fill="#d9b574"/>
    ${stampT(30, 0, 'Delhi', -3)}${stampT(80, 0, 'Iraq', 2)}${stampT(124, -1, 'Quito', -2)}</g>
  <g fill="#ffd76a"><path d="M298 22 l2 6 l6 2 l-6 2 l-2 6 l-2 -6 l-6 -2 l6 -2z"/><path d="M22 26 l1.5 4 l4 1.5 l-4 1.5 l-1.5 4 l-1.5 -4 l-4 -1.5 l4 -1.5z"/><path d="M200 30 l1.2 3 l3 1.2 l-3 1.2 l-1.2 3 l-1.2 -3 l-3 -1.2 l3 -1.2z"/></g>
</svg>`;
}

export default {
  id: 'atlas', name: 'Atlas',
  description: 'Delhi, India, Amsterdam, Madrid… Name a place that starts with the last letter of the one before, before the clock runs out. The last traveller with lives left wins. For 2–8.',
  minPlayers: 2, maxPlayers: 8,
  options: [
    { id: 'lives', label: 'Lives', default: '3', choices: [['1', '1 life'], ['3', '3 lives'], ['5', '5 lives']] },
    { id: 'time', label: 'Time per turn', default: '15', choices: [['10', '10 seconds'], ['15', '15 seconds'], ['20', '20 seconds']] },
    levelOption(),
  ],
  cover: coverSVG(),
  howTo: {
    goal: 'Keep the journey going and be the last traveller with lives left.',
    turn: [
      ['📍', 'Name a place', 'A country, an Indian state or union territory, or a city, starting with the letter shown. The first letter is drawn at random.'],
      ['🔗', 'Chain the letters', 'The next player starts with the last letter of your place: Delhi → India → Amsterdam…'],
      ['🚫', 'No repeats', 'A place can be named only once per game.'],
      ['🗳️', 'New places get a vote', 'A place that isn’t in the built-in atlas goes to the other players. Most votes win; a tie lets it in.'],
      ['💔', 'Lose a life', 'Pass, run out of time, or have your place voted down and you lose a life. The next player tries the same letter.'],
    ],
    tips: ['Places ending in A are everywhere: A chains go on and on.', 'Trap the next player with an ending few places start with: Iraq leaves them Q!', 'If no places are left for a last letter, the letter before it is used instead.', `After ${MAX_CHAIN} places the journey ends: most lives wins (then most places named).`],
  },
  // No onTimeout: the game runs its own clocks, so the site's turn timer would only add a second countdown.
  // timeoutMove is the move made for a player whose time runs out (tests use it).
  timeoutMove: onTimeout,
  setup, act, turnOf, view, bot, render,
};
