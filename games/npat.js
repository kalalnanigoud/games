// Name, Place, Animal, Thing: the pen-and-paper word race. Each round a letter is drawn and everyone writes a
// person's first name, a place, an animal and a thing starting with it, all at once, against the clock. The
// first to fill all four may shout Stop, and everyone else gets five seconds to finish. Answers stay secret
// until the round ends. Words in the built-in lists count at once; anything else goes to a quick thumbs-up
// vote by the other players. A valid answer nobody else wrote scores 10, a shared one 5, a blank or wrong one 0.
//
// Time-based events (the end of the round, the last chance, the vote, the score sheet) are triggered by any
// player's screen sending { type: 'clock' } once a deadline has passed; the host's own clock decides.
import { esc, log, addFx, rand, shuffle, PLAYER_COLORS } from '../js/util.js';
import { injectCSS, morph } from '../js/fx.js';
import { sound } from '../js/sound.js';
import { icon } from '../js/icons.js';
import { portrait } from '../js/avatar.js';
import { levelOption, levelOf } from '../js/levels.js';
import { NAMES, PLACES, PLACE_ALIASES, ANIMALS, THINGS, makeIndex, byLetter, firstLetter, squash, wordShaped } from './word-lists.js';

const browser = typeof document !== 'undefined';
const CATS = ['name', 'place', 'animal', 'thing'];
const LABEL = { name: 'Name', place: 'Place', animal: 'Animal', thing: 'Thing' };
const LISTS = { name: NAMES, place: PLACES, animal: ANIMALS, thing: THINGS };
// Q, X and Z are left out: too few everyday words start with them.
const LETTERS = 'abcdefghijklmnoprstuvwy';
const LAST_MS = 5000, VOTE_MS = 15000, RESULTS_MS = 15000, MAXLEN = 30;

let IDX = null, BY = null;
const index = () => IDX || (IDX = {
  name: makeIndex(NAMES), place: makeIndex(PLACES, PLACE_ALIASES),
  animal: makeIndex(ANIMALS, {}, { plural: true }), thing: makeIndex(THINGS, {}, { plural: true }),
});
const words = (cat, letter) => (BY || (BY = Object.fromEntries(CATS.map((c) => [c, byLetter(LISTS[c])]))))[cat][letter] || [];

const player = (s, pid) => s.players.find((p) => p.id === pid);
const named = (s, pid) => player(s, pid)?.name || '?';
const writing = (s) => s.phase === 'play' || s.phase === 'last';
const blankSheet = () => ({ name: '', place: '', animal: '', thing: '' });
const clean = (t) => String(t ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAXLEN);
const startsRight = (text, letter) => !!text && firstLetter(text) === letter;
const filled = (sheet) => CATS.filter((c) => sheet?.[c]).length;

/* ---------------- rules ---------------- */

function setup(players, opts = {}) {
  if (players.length < 2 || players.length > 8) throw Error('Name, Place, Animal, Thing needs 2–8 players.');
  const rounds = [5, 10].includes(Number(opts.rounds)) ? Number(opts.rounds) : 5;
  const time = [45, 60, 90].includes(Number(opts.time)) ? Number(opts.time) : 60;
  const s = {
    phase: 'play', over: false, winners: [], log: [], level: levelOf(opts),
    rounds, timeMs: time * 1000, round: 0, letters: shuffle(LETTERS.split('')).slice(0, rounds), letter: '',
    players: players.map((p, i) => ({ id: p.id, name: p.name, seat: i, score: 0, salt: rand(1e9) })),
    cur: {}, done: {}, stopper: null, started: 0, endsAt: 0, vote: null, sheet: null, last: null, history: [], ready: {}, resultsAt: 0, resultsUntil: 0,
  };
  startRound(s);
  return s;
}

function startRound(s) {
  s.round++;
  s.letter = s.letters[s.round - 1];
  const now = Date.now();
  Object.assign(s, { phase: 'play', cur: Object.fromEntries(s.players.map((p) => [p.id, blankSheet()])), done: {}, stopper: null, started: now, endsAt: now + s.timeMs, vote: null, sheet: null, ready: {} });
  log(s, `Round ${s.round} of ${s.rounds}: the letter is ${s.letter.toUpperCase()}.`);
  addFx(s, { kind: 'sound', sound: 'flip' });
}

function setAnswer(s, pid, cat, text) {
  if (!CATS.includes(cat)) throw Error('Pick Name, Place, Animal or Thing.');
  if (typeof text !== 'string') throw Error('Type a word.');
  s.cur[pid][cat] = clean(text);
}
function applyAnswers(s, pid, answers) {
  if (answers == null) return;
  if (typeof answers !== 'object' || Array.isArray(answers)) throw Error('Those answers could not be read.');
  for (const [cat, text] of Object.entries(answers)) setAnswer(s, pid, cat, text);
}

// The round is over: answers in the lists count at once, the rest go to a vote (if anyone can vote on them).
function endRound(s) {
  const sheet = {}, items = [];
  const ix = index();
  for (const p of s.players) {
    sheet[p.id] = {};
    for (const cat of CATS) {
      const text = s.cur[p.id]?.[cat] || '';
      let e;
      if (!text) e = { text, why: 'blank' };
      else if (!startsRight(text, s.letter)) e = { text, why: 'letter' };
      else {
        const hit = ix[cat].find(text);
        if (hit) e = { text, why: 'list', key: squash(hit) };
        else {
          const key = squash(text);
          e = { text, why: 'vote', key };
          let item = items.find((it) => it.cat === cat && it.key === key);
          if (!item) items.push(item = { cat, key, text, by: [], votes: {} });
          item.by.push(p.id);
        }
      }
      sheet[p.id][cat] = e;
    }
  }
  s.sheet = sheet;
  s.cur = {};
  const open = items.filter((it) => s.players.some((p) => !it.by.includes(p.id)));
  for (const it of items) if (!open.includes(it)) for (const pid of it.by) sheet[pid][it.cat].why = 'voted'; // everyone wrote it: nobody left to ask
  if (open.length) {
    s.phase = 'vote';
    s.vote = { until: Date.now() + VOTE_MS, items: open };
    log(s, `Time to vote on ${open.length} answer${open.length === 1 ? '' : 's'} that aren't in the book.`);
    addFx(s, { kind: 'sound', sound: 'card' });
  } else score(s);
}

// Votes are counted: the majority decides and a tie lets the word in. Anyone who hasn't voted when the
// time is up counts as a thumbs up, so the vote never holds the game back.
function resolveVote(s) {
  for (const it of s.vote?.items || []) {
    const voters = s.players.filter((p) => !it.by.includes(p.id));
    const no = voters.filter((p) => it.votes[p.id] === false).length, yes = voters.length - no;
    it.ok = yes >= no;
    for (const pid of it.by) s.sheet[pid][it.cat].why = it.ok ? 'voted' : 'rejected';
  }
  score(s);
}

function score(s) {
  const totals = Object.fromEntries(s.players.map((p) => [p.id, 0]));
  for (const cat of CATS) {
    const count = {};
    for (const p of s.players) { const e = s.sheet[p.id][cat]; if (e.why === 'list' || e.why === 'voted') count[e.key] = (count[e.key] || 0) + 1; }
    for (const p of s.players) {
      const e = s.sheet[p.id][cat];
      e.pts = e.why === 'list' || e.why === 'voted' ? (count[e.key] > 1 ? 5 : 10) : 0;
      totals[p.id] += e.pts;
    }
  }
  for (const p of s.players) {
    p.score += totals[p.id];
    if (totals[p.id]) addFx(s, { kind: 'float', at: `np-p-${p.id}`, text: '+' + totals[p.id], color: '#ffd76a' });
  }
  s.last = { round: s.round, letter: s.letter, sheet: s.sheet, totals, items: s.vote?.items || [] };
  s.history.push({ round: s.round, letter: s.letter, pts: totals });
  const best = Math.max(...Object.values(totals));
  const tops = s.players.filter((p) => totals[p.id] === best && best > 0);
  log(s, `Round ${s.round} (${s.letter.toUpperCase()}): ${tops.length ? `${tops.map((p) => p.name).join(' & ')} scored best with ${best}` : 'nobody scored'}.`);
  s.vote = null;
  addFx(s, { kind: 'sound', sound: 'coin' });
  if (s.round >= s.rounds) {
    const top = Math.max(...s.players.map((p) => p.score));
    Object.assign(s, { phase: 'over', over: true, winners: s.players.filter((p) => p.score === top).map((p) => p.id) });
    log(s, `${s.winners.map((id) => named(s, id)).join(' & ')} ${s.winners.length > 1 ? 'share the win' : 'wins'} with ${top} points!`);
    return;
  }
  const now = Date.now();
  Object.assign(s, { phase: 'results', ready: {}, resultsAt: now, resultsUntil: now + RESULTS_MS });
}

function allDone(s) { if (s.players.every((p) => s.done[p.id])) endRound(s); }

function tick(s) {
  const now = Date.now();
  if (writing(s) && now >= s.endsAt) endRound(s);
  else if (s.phase === 'vote' && now >= s.vote.until) resolveVote(s);
  else if (s.phase === 'results' && now >= s.resultsUntil) startRound(s);
}

function act(s, pid, a) {
  if (s.over) throw Error('The game is over.');
  const me = player(s, pid);
  if (!me) throw Error('You are not playing in this game.');
  if (!a || typeof a !== 'object') throw Error('Choose something to do.');
  switch (a.type) {
    case 'think': return;
    case 'clock': return tick(s); // early or stale clocks change nothing
    case 'answer': case 'fill': {
      if (!writing(s)) return; // a last keystroke that arrives after the bell is simply too late
      if (s.done[pid]) {
        const same = a.type === 'answer' ? s.cur[pid][a.cat] === clean(a.text) : CATS.every((c) => !(c in (a.answers || {})) || s.cur[pid][c] === clean(a.answers[c]));
        if (same) return;
        throw Error('You have already handed in your answers.');
      }
      if (a.type === 'answer') setAnswer(s, pid, a.cat, a.text); else applyAnswers(s, pid, a.answers);
      return;
    }
    case 'stop': case 'done': {
      if (!writing(s)) throw Error('The round is over.');
      if (s.done[pid]) throw Error('You have already handed in your answers.');
      const before = { ...s.cur[pid] };
      applyAnswers(s, pid, a.answers);
      if (a.type === 'stop' && !CATS.every((c) => startsRight(s.cur[pid][c], s.letter))) {
        s.cur[pid] = before;
        throw Error(`Fill in all four with words starting with ${s.letter.toUpperCase()} before you shout Stop.`);
      }
      s.done[pid] = true;
      if (a.type === 'stop' && s.phase === 'play' && s.players.some((p) => !s.done[p.id])) {
        s.phase = 'last'; s.stopper = pid; s.endsAt = Math.min(s.endsAt, Date.now() + LAST_MS);
        log(s, `${me.name} shouted STOP! Five seconds left.`);
        addFx(s, { kind: 'sound', sound: 'turn' });
        addFx(s, { kind: 'pulse', at: `np-p-${pid}` });
      }
      return allDone(s);
    }
    case 'vote': {
      if (s.phase !== 'vote') throw Error('There is nothing to vote on right now.');
      const it = Number.isInteger(a.item) ? s.vote.items[a.item] : null;
      if (!it) throw Error('Pick one of the answers.');
      if (it.by.includes(pid)) throw Error('You can’t vote on your own answer.');
      if (typeof a.ok !== 'boolean') throw Error('Vote thumbs up or thumbs down.');
      it.votes[pid] = a.ok;
      if (s.vote.items.every((x) => s.players.every((p) => x.by.includes(p.id) || p.id in x.votes))) resolveVote(s);
      return;
    }
    case 'ready': {
      if (s.phase !== 'results') throw Error('Not yet.');
      s.ready[pid] = true;
      if (s.players.every((p) => s.ready[p.id])) startRound(s);
      return;
    }
  }
  throw Error('Unknown action.');
}

const toVote = (s, pid) => (s.vote?.items || []).map((it, i) => [it, i]).filter(([it]) => !it.by.includes(pid) && !(pid in it.votes));
function turnOf(s) {
  if (s.over) return [];
  if (writing(s)) return s.players.filter((p) => !s.done[p.id]).map((p) => p.id);
  if (s.phase === 'vote') return s.players.filter((p) => toVote(s, p.id).length).map((p) => p.id);
  if (s.phase === 'results') return s.players.filter((p) => !s.ready[p.id]).map((p) => p.id);
  return [];
}

// While the round runs you see only your own answers (others show how many boxes they've filled);
// the coming letters and other players' computer salts stay with the host.
function view(s, pid) {
  const v = JSON.parse(JSON.stringify(s));
  delete v.letters;
  v.players = v.players.map((p) => (p.id === pid ? p : { ...p, salt: 0 }));
  v.progress = Object.fromEntries(s.players.map((p) => [p.id, filled(s.cur[p.id])]));
  v.cur = s.cur[pid] ? { [pid]: { ...s.cur[pid] } } : {};
  v.hostNow = Date.now();
  return v;
}

/* ---------------- computer players ---------------- */

// Each computer plans its round from a private seed: which boxes it fills, with what, and when (as a share of
// the round). Easy leaves many blanks and writes slowly, choosing the most obvious words (often shared).
// Hard fills all four quickly with rarer words, so they're more often unique, and often shouts Stop.
const PLAN = {
  easy: { blank: 0.45, from: 0.35, to: 0.95, pool: (w) => w.slice(0, 4), stop: 0 },
  normal: { blank: 0.18, from: 0.18, to: 0.75, pool: (w) => w.slice(0, 8), stop: 0.15 },
  hard: { blank: 0, from: 0.1, to: 0.5, pool: (w) => (w.length > 6 ? w.slice(3) : w), stop: 0.5 },
};
function prng(seed) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => { h += 0x6D2B79F5; let n = h; n = Math.imul(n ^ n >>> 15, n | 1); n ^= n + Math.imul(n ^ n >>> 7, n | 61); return ((n ^ n >>> 14) >>> 0) / 4294967296; };
}
const levelName = (l) => (l === 'easy' || l === 'hard' ? l : 'normal');
function plan(v, pid) {
  const me = v.players.find((p) => p.id === pid), P = PLAN[levelName(v.level)];
  const r = prng(`${me?.salt}:${pid}:${v.round}:${v.letter}`);
  const out = {};
  for (const cat of CATS) {
    const pool = P.pool(words(cat, v.letter));
    const skip = r() < P.blank, pick = pool[Math.floor(r() * pool.length)], at = P.from + r() * (P.to - P.from);
    out[cat] = !skip && pick ? { text: pick[0].toUpperCase() + pick.slice(1), at } : null;
  }
  const full = CATS.every((c) => out[c]);
  return { out, full, stop: full && r() < P.stop, doneAt: Math.max(...CATS.map((c) => out[c]?.at || 0)) + 0.04 };
}
// A computer's thumbs: up if the word is in any of the lists (or looks like a name or place, which no list
// can hold them all of); Easy computers sometimes vote the other way.
function judge(item, level) {
  const ix = index();
  let ok = CATS.some((c) => ix[c].has(item.text)) || ((item.cat === 'name' || item.cat === 'place') && wordShaped(item.text));
  if (levelName(level) === 'easy' && Math.random() < 0.25) ok = !ok;
  return ok;
}
const deadlineOf = (v) => (writing(v) ? v.endsAt : v.phase === 'vote' ? v.vote?.until : v.phase === 'results' ? v.resultsUntil : 0);

function bot(v, pid) {
  const think = { type: 'think' };
  if (browser && deadlineOf(v) && Date.now() > deadlineOf(v) + 300) return { type: 'clock' };
  if (v.phase === 'vote') {
    const [it, i] = toVote(v, pid)[0] || [];
    return it ? { type: 'vote', item: i, ok: judge(it, v.level) } : think;
  }
  if (v.phase === 'results') return !browser || Date.now() - v.resultsAt > 4000 ? { type: 'ready' } : think;
  if (!writing(v)) return think;
  const p = plan(v, pid), mine = v.cur[pid] || blankSheet();
  const answers = Object.fromEntries(CATS.filter((c) => p.out[c]).map((c) => [c, p.out[c].text]));
  if (!browser) return { type: p.stop && v.phase === 'play' ? 'stop' : 'done', answers };
  // On screen: write the planned words one at a time as their moment comes, then hand in (or shout Stop).
  const frac = (Date.now() - v.started) / v.timeMs;
  if (v.phase === 'last') return { type: 'done', answers: Object.fromEntries(Object.entries(answers).filter(([c]) => p.out[c].at <= frac + 0.12)) };
  const next = CATS.find((c) => p.out[c] && p.out[c].at <= frac && mine[c] !== p.out[c].text);
  if (next) return { type: 'answer', cat: next, text: p.out[next].text };
  if (p.full && frac >= p.doneAt && CATS.every((c) => mine[c] === p.out[c].text)) return { type: p.stop ? 'stop' : 'done', answers };
  return think;
}

// Time's up for a person: what they've written is handed in, a pending vote is a thumbs up, and the
// score sheet moves on.
function onTimeout(v, pid) {
  if (writing(v)) return { type: 'done' };
  if (v.phase === 'vote') { const [, i] = toVote(v, pid)[0] || []; return i == null ? { type: 'think' } : { type: 'vote', item: i, ok: true }; }
  if (v.phase === 'results') return { type: 'ready' };
  return { type: 'think' };
}

/* ---------------- screen ---------------- */

const ic = (d, cls = 'ic') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;
const CAT_IC = {
  name: ic('<circle cx="12" cy="8" r="3.6"/><path d="M4.8 20c.9-4 3.6-6.3 7.2-6.3s6.3 2.3 7.2 6.3"/>'),
  place: ic('<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>'),
  animal: ic('<circle cx="7" cy="9" r="1.9"/><circle cx="11" cy="5.8" r="1.9"/><circle cx="15.6" cy="6.6" r="1.9"/><circle cx="18.4" cy="10.6" r="1.9"/><path d="M8.6 17.4c0-2.8 2-5.4 4.4-5.4s4.2 2.2 4.2 4.6c0 2-1.4 3-3 2.6-1-.3-1.6-.3-2.6.1-1.8.6-3-.3-3-1.9z"/>'),
  thing: ic('<path d="M12 3.5l7.5 4v9L12 20.5l-7.5-4v-9z"/><path d="M4.5 7.5L12 11.5l7.5-4M12 11.5v9"/>'),
};
const UP = ic('<path d="M7 11v9H4.5V11zM7 11l4-7.5c1.6 0 2.6 1.2 2.2 2.8L12.6 9.5h5.6a2 2 0 0 1 2 2.4l-1.3 6.4a2 2 0 0 1-2 1.7H7"/>');
const DOWN = ic('<path d="M7 13V4H4.5v9zM7 13l4 7.5c1.6 0 2.6-1.2 2.2-2.8l-.6-3.2h5.6a2 2 0 0 0 2-2.4l-1.3-6.4a2 2 0 0 0-2-1.7H7"/>');
const STOP_IC = ic('<path d="M8.2 3.5h7.6l4.7 4.7v7.6l-4.7 4.7H8.2l-4.7-4.7V8.2z"/><path d="M12 8v5M12 16.2v.3"/>');
// Point badges: a star for 10 (yours alone), two rings for 5 (shared), a dash for nothing.
const BADGE = {
  10: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.2l2.3 4.9 5.3.6-3.9 3.6 1 5.3L10 14l-4.7 2.6 1-5.3-3.9-3.6 5.3-.6z" fill="currentColor"/></svg>',
  5: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="7.5" cy="10" r="4.6" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="12.5" cy="10" r="4.6" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>',
  0: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 10h10" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
};
const WHY = { list: '', voted: 'voted in', rejected: 'voted out', letter: 'wrong letter', blank: '' };

const UI = { rk: '', drafts: blankSheet(), sent: blankSheet(), timers: {}, v: null, ctx: null, root: null, offset: 0, hostNow: 0, clockSent: 0, logOpen: false, histOpen: false };
const amPlayer = () => !!UI.v?.players.some((p) => p.id === UI.ctx?.me);
const canWrite = () => UI.v && writing(UI.v) && !UI.v.over && amPlayer() && !UI.v.done[UI.ctx.me];
const hostTime = () => Date.now() + UI.offset;

function flush(cat) {
  clearTimeout(UI.timers[cat]);
  if (!canWrite() || UI.drafts[cat] === UI.sent[cat]) return;
  UI.sent[cat] = UI.drafts[cat];
  UI.ctx.send({ type: 'answer', cat, text: UI.drafts[cat] });
}
const flushAll = () => CATS.forEach(flush);
function queue(cat) {
  clearTimeout(UI.timers[cat]);
  const soon = UI.v.phase === 'last' || UI.v.endsAt - hostTime() < 4000;
  UI.timers[cat] = setTimeout(() => flush(cat), soon ? 120 : 600);
}

function clockFace() {
  const v = UI.v;
  if (!v || !UI.root) return;
  const until = deadlineOf(v), total = writing(v) ? (v.phase === 'last' ? LAST_MS : v.timeMs) : v.phase === 'vote' ? VOTE_MS : RESULTS_MS;
  const ms = until ? until - hostTime() : 0;
  UI.root.querySelectorAll('.np-clock').forEach((c) => {
    const left = Math.max(0, Math.ceil(ms / 1000)), text = v.over || !until ? '' : String(left);
    const t = c.querySelector('.np-time');
    if (t.textContent !== text) t.textContent = text;
    c.classList.toggle('low', writing(v) && left <= 10);
    c.style.setProperty('--p', v.over ? '0' : Math.max(0, Math.min(1, ms / total)).toFixed(3));
  });
  const n = UI.root.querySelector('.np-autonext');
  if (n && v.phase === 'results') n.textContent = `Next round in ${Math.max(0, Math.ceil(ms / 1000))} s`;
}

if (browser) setInterval(() => {
  const v = UI.v;
  if (!v || !UI.root?.isConnected) return;
  clockFace();
  const until = deadlineOf(v);
  if (writing(v) && until - hostTime() < 1200) flushAll(); // the bell is about to ring: send what's typed
  if (!v.over && amPlayer() && until && hostTime() > until + 300 && Date.now() - UI.clockSent > 1500) {
    UI.clockSent = Date.now();
    flushAll();
    UI.ctx.send({ type: 'clock' });
  }
}, 250);

// The sheet's own little reactions (marks, the Stop button) are set in place while typing.
function syncSheet() {
  const v = UI.v, f = UI.root?.querySelector('.np-sheet');
  if (!f || !v) return;
  for (const cat of CATS) {
    const t = UI.drafts[cat], mark = f.querySelector(`[data-mark="${cat}"]`);
    if (!mark) continue;
    const state = !t ? '' : startsRight(t, v.letter) ? 'ok' : 'bad';
    mark.className = 'np-mark ' + state;
    mark.innerHTML = state === 'ok' ? '<svg viewBox="0 0 20 20"><path d="M4.5 10.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>' : state === 'bad' ? `<b>${v.letter.toUpperCase()}?</b>` : '';
    mark.setAttribute('aria-label', state === 'ok' ? 'starts with the letter' : state === 'bad' ? `doesn't start with ${v.letter.toUpperCase()}` : '');
  }
  const stop = f.querySelector('#npStop');
  if (stop) {
    const all = CATS.every((c) => startsRight(UI.drafts[c], v.letter));
    stop.disabled = !all;
    stop.classList.toggle('np-armed', all);
    stop.querySelector('span').textContent = v.phase === 'last' ? 'Hand in' : 'Stop!';
    stop.title = all ? '' : 'Fill all four boxes to shout Stop';
  }
}

const face = (p, ctx) => `<span class="np-face" style="--pc:${PLAYER_COLORS[p.seat % PLAYER_COLORS.length]}">${portrait({ id: p.id, bot: !!ctx.isBot?.(p.id) })}</span>`;
const badge = (pts) => `<span class="np-badge p${pts}" aria-label="${pts} points">${BADGE[pts]}<b>${pts}</b></span>`;

function render(el, v, ctx) {
  injectCSS('npat', STYLE);
  if (v.hostNow && v.hostNow !== UI.hostNow) { UI.hostNow = v.hostNow; UI.offset = v.hostNow - Date.now(); }
  UI.v = v; UI.ctx = ctx; UI.root = el;
  const me = v.players.find((p) => p.id === ctx.me);
  const L = (v.letter || '').toUpperCase();
  const rk = `${v.round}:${v.letter}:${ctx.me}:${v.players.map((p) => p.id).join()}`;
  const mine = v.cur?.[ctx.me];
  if (UI.rk !== rk) { UI.rk = rk; UI.drafts = { ...blankSheet(), ...(mine || {}) }; UI.sent = { ...UI.drafts }; Object.values(UI.timers).forEach(clearTimeout); }
  else if (mine) for (const c of CATS) if (!UI.drafts[c] && mine[c] && UI.sent[c] !== mine[c]) { UI.drafts[c] = mine[c]; UI.sent[c] = mine[c]; }
  const isWriting = writing(v) && !v.over, myDone = !!(me && v.done[me.id]), canType = isWriting && me && !myDone;

  // ---- the top bar: letter tile, round and status, clock ----
  const stopper = v.stopper ? named(v, v.stopper) : '';
  const status = v.over ? (v.winners.includes(ctx.me) ? 'You win!' : `${esc(v.winners.map((id) => named(v, id)).join(' & '))} ${v.winners.length > 1 ? 'share the win' : 'wins'}!`)
    : v.phase === 'last' ? (v.stopper === ctx.me ? 'You shouted STOP! The others have five seconds…' : `${esc(stopper)} shouted STOP! ${canType ? 'Quick, five seconds left!' : 'Five seconds left…'}`)
    : v.phase === 'play' ? (canType ? `Write a word starting with ${L} in each box.` : myDone ? 'Handed in. Waiting for the others…' : 'The players are writing…')
    : v.phase === 'vote' ? (me && toVote(v, me.id).length ? 'Are these real? Give each a thumbs up or down.' : 'The table is voting on new words…')
    : 'Round scores';
  const top = `<div class="np-top">
    <div class="np-tile" data-k="np-tile-${v.round}" aria-label="Letter ${L}"><b>${L}</b><small>${v.round}/${v.rounds}</small></div>
    <div class="np-meta"><span class="np-round">Round ${v.round} of ${v.rounds}</span><p class="np-status ${v.phase === 'last' ? 'alarm' : ''}">${status}</p></div>
    ${v.over ? '' : `<div class="np-clock" style="--p:1"><span class="np-time"></span></div>`}
  </div>`;

  // ---- main area by phase ----
  let main = '';
  if (isWriting && me) {
    const locked = myDone;
    main = `<form class="np-sheet ${locked ? 'locked' : ''} ${v.phase === 'last' && !locked ? 'np-rush' : ''}" autocomplete="off" onsubmit="return false">
      ${CATS.map((c, i) => `<label class="np-row np-c-${c}" data-k="np-row-${c}"><span class="np-cat">${CAT_IC[c]}<b>${LABEL[c]}</b></span>
        <span class="np-field"><input id="np-in-${c}" data-cat="${c}" maxlength="${MAXLEN}" autocomplete="off" autocorrect="off" autocapitalize="words" spellcheck="false" enterkeyhint="${i === 3 ? 'done' : 'next'}"
          value="${esc(UI.drafts[c])}" placeholder="${c === 'name' ? 'A first name' : c === 'place' ? 'City, country or state' : c === 'animal' ? 'Any animal' : 'An object'} with ${L}" ${locked ? 'disabled' : ''} aria-label="${LABEL[c]} starting with ${L}">
        <i class="np-mark" data-mark="${c}"></i></span></label>`).join('')}
      ${locked ? `<p class="np-handed">${icon('check')}Handed in. ${v.players.filter((p) => !v.done[p.id]).length} still writing.</p>`
        : `<div class="np-actions"><button type="button" class="ghost" id="npDone">${icon('check')}<span>Hand in</span></button><button type="button" class="primary grow" id="npStop" disabled>${STOP_IC}<span>Stop!</span></button></div>`}
    </form>`;
  } else if (isWriting) {
    main = `<div class="panel np-watch">${icon('eye')}<span>The players are writing. Answers are shown when the round ends.</span></div>`;
  } else if (v.phase === 'vote') {
    const items = v.vote.items.map((it, i) => {
      const yes = Object.values(it.votes).filter(Boolean).length, no = Object.values(it.votes).length - yes;
      const mineItem = me && it.by.includes(me.id), voted = me && me.id in it.votes ? it.votes[me.id] : null, can = me && !mineItem;
      return `<div class="np-vote np-c-${it.cat} ${can && voted == null ? 'can' : ''}" data-k="np-v-${i}">
        <span class="np-vcat">${CAT_IC[it.cat]}${LABEL[it.cat]}</span>
        <b class="np-vword">${esc(it.text)}</b>
        <span class="np-vby">${it.by.map((id) => face(player(v, id), ctx)).join('')}<small>${esc(it.by.map((id) => named(v, id)).join(', '))}</small></span>
        <span class="np-vtally" aria-label="${yes} up, ${no} down">${UP}<b>${yes}</b>${DOWN}<b>${no}</b></span>
        ${can ? `<span class="np-vbtns"><button class="np-up ${voted === true ? 'on' : ''}" data-vote="${i}" data-ok="1" aria-pressed="${voted === true}">${UP}<span>Real</span></button><button class="np-down ${voted === false ? 'on' : ''}" data-vote="${i}" data-ok="0" aria-pressed="${voted === false}">${DOWN}<span>Not real</span></button></span>`
          : mineItem ? '<span class="tag t-you">Your answer</span>' : ''}
      </div>`;
    }).join('');
    main = `<div class="np-votes"><p class="np-hint">Words that aren't in the book need a thumbs up from the table. Most votes win; a tie or no vote lets it in.</p>${items}</div>`;
  } else if (v.last) {
    const order = [...v.players].sort((a, b) => v.last.totals[b.id] - v.last.totals[a.id] || b.score - a.score);
    const cards = order.map((p) => `<div class="np-rcard ${p.id === ctx.me ? 'me' : ''}" data-k="np-r-${p.id}">
        <div class="np-rhead">${face(p, ctx)}<b>${esc(p.name)}</b><span class="np-rpts">+${v.last.totals[p.id]}</span></div>
        <div class="np-rgrid">${CATS.map((c) => { const e = v.last.sheet[p.id][c]; return `<span class="np-rcell np-c-${c} ${e.why}">${CAT_IC[c]}<em title="${esc(e.text)}">${e.text ? esc(e.text) : '—'}</em><span class="np-rfoot">${badge(e.pts)}${WHY[e.why] ? `<small>${WHY[e.why]}</small>` : ''}</span></span>`; }).join('')}</div>
      </div>`).join('');
    const ready = v.players.filter((p) => v.ready[p.id]).length;
    main = `<div class="np-results"><p class="np-hint"><span>Letter <b>${v.last.letter.toUpperCase()}</b></span>${badge(10)}<span>yours alone</span>${badge(5)}<span>shared</span>${badge(0)}<span>blank or not allowed</span></p>${cards}
      ${v.phase === 'results' ? `<div class="np-next">${me ? `<button class="primary" id="npReady" ${v.ready[me.id] ? 'disabled' : ''}>${icon('play')}${v.ready[me.id] ? 'Ready' : 'Next round'}</button>` : ''}<span class="np-autonext"></span><small>${ready}/${v.players.length} ready</small></div>` : ''}</div>`;
  }

  // ---- side: players with faces and scores, rounds, log ----
  const ranked = [...v.players].sort((a, b) => b.score - a.score);
  const players = ranked.map((p) => {
    const prog = v.progress?.[p.id] || 0;
    const st = isWriting ? (v.done[p.id] ? (v.stopper === p.id ? `<span class="tag t-warn">${STOP_IC}Stop!</span>` : `<span class="tag t-good">${icon('check')}Done</span>`)
      : `<span class="np-prog" aria-label="${prog} of 4 written">${CATS.map((c, i) => `<i class="${i < prog ? 'on' : ''}"></i>`).join('')}</span>`)
      : v.phase === 'vote' ? (toVote(v, p.id).length ? '<span class="tag">Voting…</span>' : '') : v.phase === 'results' && v.ready[p.id] ? `<span class="tag t-good">${icon('check')}Ready</span>` : '';
    return `<div class="np-player ${p.id === ctx.me ? 'me' : ''} ${v.winners.includes(p.id) ? 'win' : ''}" data-a="np-p-${p.id}" data-k="np-pl-${p.id}">
      ${face(p, ctx)}<span class="np-pname"><b>${esc(p.name)}</b>${p.id === ctx.me ? '<small>You</small>' : ctx.isBot?.(p.id) ? '<small>Computer</small>' : ''}</span>${st}<span class="np-score">${p.score}</span></div>`;
  }).join('');
  const hist = v.history.length ? `<table class="np-hist"><tr><th>Round</th>${v.players.map((p) => `<th title="${esc(p.name)}">${esc(p.name.slice(0, 6))}</th>`).join('')}</tr>${v.history.map((h) => `<tr><td><b>${h.letter.toUpperCase()}</b></td>${v.players.map((p) => `<td>${h.pts[p.id]}</td>`).join('')}</tr>`).join('')}</table>` : '<p class="muted small" style="margin:0">No rounds scored yet.</p>';
  UI.logOpen = el.querySelector('.np-logbox')?.open ?? UI.logOpen;
  UI.histOpen = el.querySelector('.np-histbox')?.open ?? UI.histOpen;

  morph(el, `<div class="np-root"><div class="game-layout">
    <div class="felt np-felt">
      ${v.over ? `<div class="winner-banner">${icon('trophy')}${status}</div>` : ''}
      ${top}
      ${main}
    </div>
    <div class="side">
      <div class="panel np-players">${players}</div>
      <div class="panel np-rules"><b>Scoring</b><span>${badge(10)}only you wrote it</span><span>${badge(5)}someone else wrote it too</span><span>${badge(0)}blank, wrong letter or voted out</span></div>
      <details class="panel drawer np-histbox" ${UI.histOpen ? 'open' : ''}><summary>${icon('star')}<span>Rounds</span><span class="note">${v.history.length}/${v.rounds}</span>${icon('chevron', 'chev')}</summary><div class="drawer-body">${hist}</div></details>
      <details class="panel drawer np-logbox" ${UI.logOpen ? 'open' : ''}><summary>${icon('book')}<span>Game log</span>${icon('chevron', 'chev')}</summary>
        <div class="drawer-body"><div class="parchment log">${v.log.slice(0, 10).map((l) => `<div>${esc(l)}</div>`).join('')}</div></div></details>
    </div>
  </div></div>`);

  const lb = el.querySelector('.np-logbox'), hb = el.querySelector('.np-histbox');
  if (lb) lb.ontoggle = () => { UI.logOpen = lb.open; };
  if (hb) hb.ontoggle = () => { UI.histOpen = hb.open; };
  el.querySelectorAll('.np-sheet input').forEach((input, i, all) => {
    const cat = input.dataset.cat;
    input.oninput = () => { UI.drafts[cat] = input.value.slice(0, MAXLEN); syncSheet(); queue(cat); };
    input.onblur = () => flush(cat);
    input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); flush(cat); (all[i + 1] || input).focus(); } };
  });
  const answers = () => Object.fromEntries(CATS.map((c) => [c, clean(UI.drafts[c])]));
  const stop = el.querySelector('#npStop'), done = el.querySelector('#npDone');
  if (stop) stop.onclick = () => { const a = answers(); CATS.forEach((c) => { clearTimeout(UI.timers[c]); UI.sent[c] = UI.drafts[c]; }); sound('click'); ctx.send({ type: v.phase === 'last' ? 'done' : 'stop', answers: a }); };
  if (done) done.onclick = () => { const a = answers(); CATS.forEach((c) => { clearTimeout(UI.timers[c]); UI.sent[c] = UI.drafts[c]; }); ctx.send({ type: 'done', answers: a }); };
  el.querySelectorAll('[data-vote]').forEach((b) => (b.onclick = () => { sound('click'); ctx.send({ type: 'vote', item: +b.dataset.vote, ok: b.dataset.ok === '1' }); }));
  const rd = el.querySelector('#npReady');
  if (rd) rd.onclick = () => ctx.send({ type: 'ready' });
  syncSheet();
  clockFace();
}

const STYLE = `
.np-felt{display:flex;flex-direction:column;gap:14px;background:
  radial-gradient(90% 55% at 15% -5%,rgba(255,200,110,.22),transparent 60%),
  radial-gradient(70% 50% at 100% 110%,rgba(80,200,190,.16),transparent 60%),
  repeating-linear-gradient(90deg,rgba(255,255,255,.025) 0 2px,transparent 2px 46px),
  linear-gradient(180deg,#1f3a5a,#122641)}
.np-felt .winner-banner{display:flex;align-items:center;gap:10px}.np-felt .winner-banner .ic{width:1em;height:1em}
.np-top{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:14px}
.np-tile{position:relative;display:grid;place-items:center;width:78px;height:78px;border-radius:16px;color:#3b2410;
  background:radial-gradient(circle at 30% 22%,rgba(255,255,255,.55),transparent 42%),linear-gradient(160deg,#f7d9a0,#d9a35c 70%,#c48a43);
  box-shadow:inset 0 -5px 0 rgba(110,60,20,.35),inset 0 2px 0 rgba(255,255,255,.6),0 10px 20px rgba(0,0,0,.35);animation:np-drop .5s cubic-bezier(.2,1.4,.4,1)}
.np-tile b{font:700 2.9rem/1 var(--font-display);text-shadow:0 1px 0 rgba(255,255,255,.5)}
.np-tile small{position:absolute;right:7px;bottom:4px;font:700 .68rem var(--font-display);opacity:.7}
@keyframes np-drop{from{transform:translateY(-24px) rotate(-12deg) scale(.7);opacity:0}to{transform:none;opacity:1}}
.np-meta{display:flex;flex-direction:column;gap:3px;min-width:0}
.np-round{font:700 .8rem var(--font-display);letter-spacing:.08em;text-transform:uppercase;color:#ffd79a}
.np-status{margin:0;font-weight:800;color:#eef4ff;line-height:1.3}
.np-status.alarm{color:#ffd0d6}
.np-clock{--p:1;position:relative;display:grid;place-items:center;width:62px;height:62px;border-radius:50%;
  background:conic-gradient(#ffd76a calc(var(--p)*360deg),rgba(255,255,255,.12) 0);transition:background .25s linear}
.np-clock::before{content:"";position:absolute;inset:6px;border-radius:50%;background:#152a46}
.np-clock.low{background:conic-gradient(#ff7a8a calc(var(--p)*360deg),rgba(255,255,255,.12) 0)}
.np-time{position:relative;font:700 1.35rem var(--font-display);color:#fff}
.np-clock.low .np-time{color:#ffc2cb}
.np-sheet{position:relative;display:flex;flex-direction:column;gap:2px;margin:0;padding:16px 16px 14px 46px;border-radius:14px;color:#22304d;
  background:linear-gradient(90deg,transparent 30px,rgba(229,72,77,.55) 30px 32px,transparent 32px),linear-gradient(180deg,#fffdf6,#fbf6e8);box-shadow:0 16px 34px rgba(0,0,0,.35)}
.np-sheet::before{content:"";position:absolute;left:10px;top:18px;bottom:18px;width:10px;background:radial-gradient(circle at 5px 5px,#152a46 4px,transparent 4.6px) 0 0/10px 46px repeat-y;opacity:.9}
.np-sheet.np-rush{animation:np-rush .9s ease-in-out 2}
@keyframes np-rush{0%,100%{transform:none}25%{transform:rotate(-.6deg)}75%{transform:rotate(.6deg)}}
.np-row{display:grid;grid-template-columns:118px minmax(0,1fr);align-items:center;gap:10px;min-height:56px;padding:6px 0;border-bottom:2px solid #d3e2f4}
.np-cat{display:flex;align-items:center;gap:8px;font:700 1.05rem var(--font-display)}
.np-cat .ic{width:30px;height:30px;padding:5px;border-radius:9px;color:#fff;flex:none}
.np-c-name .np-cat .ic,.np-c-name.np-vote .np-vcat .ic{background:#d6457a}.np-c-place .np-cat .ic,.np-c-place.np-vote .np-vcat .ic{background:#2f6fd0}
.np-c-animal .np-cat .ic,.np-c-animal.np-vote .np-vcat .ic{background:#2f9a5e}.np-c-thing .np-cat .ic,.np-c-thing.np-vote .np-vcat .ic{background:#d9822b}
.np-field{position:relative;display:block}
.np-field input{width:100%;min-height:46px;padding:8px 44px 8px 12px;border:2px solid #c8d3e8;border-radius:12px;background:rgba(255,255,255,.85);color:#1a2540;font:600 1.15rem var(--font-display);box-shadow:none}
.np-field input:focus{outline:none;border-color:#6b7cff;background:#fff;box-shadow:0 0 0 3px rgba(107,124,255,.25)}
.np-field input:disabled{background:transparent;border-color:transparent;color:#2b3554;opacity:1}
.np-mark{position:absolute;right:8px;top:50%;transform:translateY(-50%);display:grid;place-items:center;width:28px;height:28px;border-radius:50%;font-style:normal;pointer-events:none}
.np-mark svg{width:18px;height:18px}
.np-mark.ok{background:#2f9a5e;color:#fff}
.np-mark.bad{width:auto;padding:0 7px;border-radius:8px;background:#ffe2c4;color:#a14a00;font:700 .8rem var(--font-display)}
.np-actions{display:flex;gap:10px;margin-top:10px}
.np-actions button{min-height:48px;display:inline-flex;align-items:center;justify-content:center;gap:8px}
.np-actions .ghost{color:#33406a;border-color:#c8d3e8;background:#eef2fb}
.np-actions .ic{width:20px;height:20px}
#npStop{font:700 1.1rem var(--font-display);transition:transform .12s}
#npStop:active{transform:scale(.97)}
#npStop.np-armed{background:linear-gradient(180deg,#ff6a6a,#d8323f);box-shadow:0 6px 16px rgba(216,50,63,.4);position:relative}
#npStop.np-armed::after{content:"";position:absolute;inset:-4px;border-radius:inherit;border:3px solid rgba(255,120,120,.6);animation:np-breathe 1.6s ease-in-out infinite;pointer-events:none}
@keyframes np-breathe{0%,100%{opacity:.15}50%{opacity:1}}
.np-handed{display:flex;align-items:center;gap:8px;margin:10px 0 0;font-weight:800;color:#2f7a4e}.np-handed .ic{width:20px;height:20px}
.np-watch{display:flex;align-items:center;gap:10px;margin:0}
.np-hint{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;margin:0;color:#dbe6ff;font-weight:700;font-size:.92rem}
.np-votes{display:flex;flex-direction:column;gap:10px}
.np-vote{display:grid;grid-template-columns:auto minmax(0,1fr) auto;grid-template-areas:"cat word tally" "by by btns";align-items:center;gap:8px 12px;padding:12px 14px;border-radius:14px;background:#fffdf6;color:#22304d;box-shadow:0 8px 18px rgba(0,0,0,.25);position:relative}
.np-vote.can::after{content:"";position:absolute;inset:-3px;border-radius:16px;border:2px solid rgba(255,215,106,.9);animation:np-breathe 2.2s ease-in-out infinite;pointer-events:none}
.np-vcat{grid-area:cat;display:flex;align-items:center;gap:6px;font:700 .85rem var(--font-display);color:#55618a}
.np-vcat .ic{width:26px;height:26px;padding:4px;border-radius:8px;color:#fff}
.np-vword{grid-area:word;font:700 1.5rem var(--font-display);overflow-wrap:anywhere}
.np-vby{grid-area:by;display:flex;align-items:center;gap:4px;min-width:0}.np-vby .np-face{width:26px;height:26px}.np-vby small{margin-left:4px;color:#55618a;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.np-vtally{grid-area:tally;display:flex;align-items:center;gap:4px;color:#55618a}.np-vtally .ic{width:18px;height:18px}.np-vtally b{margin-right:6px}
.np-vbtns{grid-area:btns;display:flex;gap:8px}
.np-vote > .tag{grid-area:btns;justify-self:start}
.np-vbtns button{min-height:44px;min-width:44px;display:inline-flex;align-items:center;gap:6px;padding:0 12px;border-radius:12px;font-weight:800;transition:transform .12s}
.np-vbtns button:active{transform:scale(.96)}
.np-vbtns .ic{width:20px;height:20px}
.np-up{background:#e3f6ea;color:#1f6b40;border:2px solid #9fd8b4}.np-up.on{background:#2f9a5e;color:#fff;border-color:#2f9a5e}
.np-down{background:#fde7e7;color:#9a2630;border:2px solid #f0aab0}.np-down.on{background:#c93743;color:#fff;border-color:#c93743}
.np-results{display:flex;flex-direction:column;gap:10px}
.np-rcard{padding:10px 12px;border-radius:14px;background:#fffdf6;color:#22304d;box-shadow:0 8px 18px rgba(0,0,0,.25)}
.np-rcard.me{box-shadow:0 0 0 3px #8b9cff,0 8px 18px rgba(0,0,0,.25)}
.np-rhead{display:flex;align-items:center;gap:8px;margin-bottom:8px}.np-rhead b{font:700 1.05rem var(--font-display);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.np-rpts{font:700 1.2rem var(--font-display);color:#2f6fd0}
.np-rgrid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}
.np-rcell{position:relative;display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:5px 6px;padding:6px 8px;border-radius:10px;background:#f1f4fb;min-height:44px}
.np-rcell .ic{width:22px;height:22px;padding:3px;border-radius:7px;color:#fff}
.np-c-name.np-rcell .ic{background:#d6457a}.np-c-place.np-rcell .ic{background:#2f6fd0}.np-c-animal.np-rcell .ic{background:#2f9a5e}.np-c-thing.np-rcell .ic{background:#d9822b}
.np-rcell em{font-style:normal;font-weight:800;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.np-rfoot{grid-column:1/-1;display:flex;align-items:center;gap:6px;min-width:0}
.np-rcell small{font-size:.68rem;font-weight:800;color:#6a7396;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.np-rcell.rejected em,.np-rcell.letter em{text-decoration:line-through;color:#8a91ad}
.np-badge{display:inline-flex;align-items:center;gap:2px;padding:2px 6px 2px 4px;border-radius:999px;font:700 .8rem var(--font-display)}
.np-badge svg{width:14px;height:14px}
.np-badge.p10{background:#ffd76a;color:#4a3000}.np-badge.p5{background:#bfe0ff;color:#123a6a}.np-badge.p0{background:#e3e6ef;color:#5b6380}
.np-next{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.np-next button{min-height:46px;display:inline-flex;align-items:center;gap:8px}.np-next .ic{width:18px;height:18px}
.np-next small,.np-autonext{color:#c7d3f2;font-weight:700}
.np-players{display:flex;flex-direction:column;gap:4px}
.np-player{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;align-items:center;gap:10px;padding:6px 8px;border-radius:12px}
.np-player.me{background:rgba(255,255,255,.06)}.np-player.win{background:rgba(255,215,106,.16)}
.np-face{display:block;width:38px;height:38px;border-radius:50%;overflow:hidden;box-shadow:0 0 0 3px var(--pc);flex:none}.np-face svg{display:block;width:100%;height:100%}
.np-pname{display:flex;flex-direction:column;min-width:0}.np-pname b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.np-pname small{color:var(--muted)}
.np-score{font:700 1.25rem var(--font-display);min-width:2.2em;text-align:right}
.np-prog{display:flex;gap:3px}.np-prog i{width:12px;height:12px;border-radius:3px;border:2px solid rgba(255,255,255,.35)}.np-prog i.on{background:#ffd76a;border-color:#ffd76a;transform:rotate(45deg) scale(.85)}
.np-player .tag .ic{width:.9em;height:.9em}
.np-rules{display:flex;flex-direction:column;gap:6px;font-size:.88rem}.np-rules span{display:flex;align-items:center;gap:8px;color:var(--muted)}
.np-hist{width:100%;border-collapse:collapse;font-size:.85rem}.np-hist th,.np-hist td{padding:4px;text-align:center;border-bottom:1px solid rgba(255,255,255,.08)}.np-hist th{color:var(--muted);font-weight:700}
@media (max-width:600px){
  .np-top{gap:10px}.np-tile{width:64px;height:64px}.np-tile b{font-size:2.3rem}.np-clock{width:54px;height:54px}.np-time{font-size:1.15rem}
  .np-sheet{padding:12px 10px 12px 34px}.np-sheet::before{left:6px}
  .np-sheet{background:linear-gradient(90deg,transparent 24px,rgba(229,72,77,.55) 24px 26px,transparent 26px),linear-gradient(180deg,#fffdf6,#fbf6e8)}
  .np-row{grid-template-columns:1fr;gap:4px;min-height:0;padding:6px 0 8px}
  .np-cat{font-size:.95rem}.np-cat .ic{width:26px;height:26px}
  .np-rgrid{grid-template-columns:repeat(2,minmax(0,1fr))}
  .np-vote{grid-template-areas:"cat tally" "word word" "by by" "btns btns";grid-template-columns:minmax(0,1fr) auto}
  .np-vbtns button{flex:1;justify-content:center}
}
`;

/* Cover art: three friends at a kitchen table with pencils and score sheets. A wooden letter tile "M" stands in
   the middle beside a sand timer; one friend leaps up shouting "STOP!" while the others scribble
   (self-contained ids, prefixed npc-). */
function coverSVG() {
  const sheet = (x, y, rot, lines) => `<g transform="translate(${x} ${y}) rotate(${rot})"><rect x="-34" y="-24" width="68" height="50" rx="4" fill="#fffdf6"/>
    <path d="M-26 -24 V26" stroke="#e5484d" stroke-width="1" opacity=".7"/>${[0, 1, 2, 3].map((i) => `<path d="M-34 ${-12 + i * 11} H34" stroke="#c9dcf3" stroke-width="1"/>`).join('')}
    ${lines.map((t, i) => `<text x="-22" y="${-15 + i * 11}" font-family="Fredoka,sans-serif" font-size="7.5" font-weight="600" fill="#2a3a66">${t}</text>`).join('')}</g>`;
  return `<svg viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="npc-wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#24507a"/><stop offset="1" stop-color="#122641"/></linearGradient>
    <radialGradient id="npc-lamp" cx=".5" cy="0" r=".75"><stop offset="0" stop-color="#ffd59a" stop-opacity=".55"/><stop offset="1" stop-color="#ffd59a" stop-opacity="0"/></radialGradient>
    <linearGradient id="npc-table" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b9774a"/><stop offset="1" stop-color="#6a3f24"/></linearGradient>
    <linearGradient id="npc-tile" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fbe2b0"/><stop offset=".7" stop-color="#d9a35c"/><stop offset="1" stop-color="#b9813f"/></linearGradient>
    <linearGradient id="npc-sand" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe08a"/><stop offset="1" stop-color="#e0a73a"/></linearGradient>
  </defs>
  <rect width="320" height="200" fill="url(#npc-wall)"/><rect width="320" height="200" fill="url(#npc-lamp)"/>
  <!-- left friend, scribbling -->
  <g transform="translate(58 96)">
    <path d="M-32 54 q32 -34 64 0 v12 h-64z" fill="#2f9a5e"/>
    <circle cx="0" cy="20" r="19" fill="#b77b52"/><path d="M-20 18 q2 -26 20 -26 q19 0 20 24 q-8 -12 -20 -12 q-12 0 -20 14z" fill="#22162c"/>
    <circle cx="-6" cy="22" r="2" fill="#1a0f08"/><circle cx="7" cy="22" r="2" fill="#1a0f08"/><path d="M-3 31 q4 2 7 -1" stroke="#5a2a1a" stroke-width="2" fill="none" stroke-linecap="round"/>
    <path d="M22 52 q16 -4 26 8" stroke="#b77b52" stroke-width="7" fill="none" stroke-linecap="round"/>
  </g>
  <!-- right friend, thinking with pencil at chin -->
  <g transform="translate(262 98)">
    <path d="M-32 52 q32 -34 64 0 v14 h-64z" fill="#d9822b"/>
    <circle cx="0" cy="18" r="18" fill="#e0b48c"/><path d="M-19 22 q-4 -30 19 -30 q23 0 19 30 l-4 -14 q-15 -8 -30 0z" fill="#6b3a1e"/>
    <circle cx="-6" cy="19" r="2" fill="#1a0f08"/><circle cx="6" cy="19" r="2" fill="#1a0f08"/><path d="M-4 28 h8" stroke="#5a2a1a" stroke-width="2" stroke-linecap="round"/>
    <path d="M-20 52 q-10 -14 -4 -26" stroke="#e0b48c" stroke-width="7" fill="none" stroke-linecap="round"/>
    <g transform="translate(-24 24) rotate(-30)"><rect x="-2.5" y="-18" width="5" height="22" rx="1.5" fill="#ffd25c"/><rect x="-2.5" y="-21" width="5" height="4" rx="1" fill="#ff7aa8"/></g>
    <g fill="#ffd76a"><circle cx="20" cy="-14" r="3"/><circle cx="28" cy="-24" r="4"/><circle cx="38" cy="-36" r="5"/></g>
  </g>
  <!-- middle friend, jumping up: STOP! -->
  <g transform="translate(160 70)">
    <path d="M-28 56 q28 -32 56 0 v10 h-56z" fill="#d6457a"/>
    <path d="M-22 44 q-18 -20 -10 -46" stroke="#8a5a3a" stroke-width="8" fill="none" stroke-linecap="round"/>
    <path d="M22 44 q18 -20 10 -46" stroke="#8a5a3a" stroke-width="8" fill="none" stroke-linecap="round"/>
    <circle cx="-31" cy="-4" r="6" fill="#8a5a3a"/><circle cx="31" cy="-4" r="6" fill="#8a5a3a"/>
    <circle cx="0" cy="22" r="19" fill="#8a5a3a"/><path d="M-19 20 q0 -26 19 -26 q19 0 19 26 q-3 -14 -19 -16 q-16 2 -19 16z" fill="#140c1c"/>
    <path d="M-9 20 q3 -3 6 0 M3 20 q3 -3 6 0" stroke="#1a0f08" stroke-width="2" fill="none" stroke-linecap="round"/>
    <ellipse cx="0" cy="32" rx="6" ry="5" fill="#6a1f2a"/>
  </g>
  <g transform="translate(160 20)"><path d="M-36 -12 h72 a6 6 0 0 1 6 6 v14 a6 6 0 0 1 -6 6 h-30 l-6 8 l-6 -8 h-30 a6 6 0 0 1 -6 -6 v-14 a6 6 0 0 1 6 -6z" fill="#fff"/>
    <text x="0" y="7" text-anchor="middle" font-family="Fredoka,sans-serif" font-weight="700" font-size="17" fill="#d8323f">STOP!</text></g>
  <rect x="0" y="146" width="320" height="54" fill="url(#npc-table)"/><rect x="0" y="146" width="320" height="4" fill="#d29567"/>
  ${sheet(62, 168, -6, ['Meera', 'Mumbai', 'Monkey', 'Mirror'])}
  ${sheet(258, 168, 5, ['Mohan', 'Malta', 'Moth', ''])}
  <g transform="translate(160 160)"><rect x="-22" y="-26" width="44" height="44" rx="9" fill="url(#npc-tile)"/><rect x="-22" y="12" width="44" height="6" rx="3" fill="#8a5a26" opacity=".45"/>
    <text x="0" y="8" text-anchor="middle" font-family="Fredoka,sans-serif" font-weight="700" font-size="30" fill="#3b2410">M</text></g>
  <g transform="translate(208 156)"><rect x="-11" y="-22" width="22" height="4" rx="2" fill="#6a3f24"/><rect x="-11" y="16" width="22" height="4" rx="2" fill="#6a3f24"/>
    <path d="M-8 -18 h16 l-6 16 l6 16 h-16 l6 -16z" fill="#cfe6ff" fill-opacity=".55" stroke="#9cc3ea" stroke-width="1"/>
    <path d="M-5 -14 h10 l-5 10z" fill="url(#npc-sand)"/><path d="M-7 14 h14 l-7 -7z" fill="url(#npc-sand)"/></g>
  <g transform="translate(110 176) rotate(-20)"><rect x="-3" y="-20" width="6" height="26" rx="2" fill="#ffd25c"/><path d="M-3 6 L0 13 L3 6z" fill="#f1c39b"/></g>
  <g fill="#ffd25c"><path d="M298 26 l2 6 l6 2 l-6 2 l-2 6 l-2 -6 l-6 -2 l6 -2z"/><path d="M24 30 l1.5 4 l4 1.5 l-4 1.5 l-1.5 4 l-1.5 -4 l-4 -1.5 l4 -1.5z"/></g>
</svg>`;
}

export default {
  id: 'npat', name: 'Name, Place, Animal, Thing',
  description: 'A letter is drawn and the race is on: write a name, a place, an animal and a thing before the clock runs out, or shout Stop! Unique answers score double. For 2–8.',
  minPlayers: 2, maxPlayers: 8, simultaneous: true,
  options: [
    { id: 'rounds', label: 'Rounds', default: '5', choices: [['5', '5 letters'], ['10', '10 letters']] },
    { id: 'time', label: 'Time per round', default: '60', choices: [['45', '45 seconds'], ['60', '60 seconds'], ['90', '90 seconds']] },
    levelOption(),
  ],
  cover: coverSVG(),
  howTo: {
    goal: 'Score the most points over all the rounds by writing words nobody else thought of.',
    turn: [
      ['🔤', 'A letter is drawn', 'Everyone gets the same letter (never Q, X or Z) and writes at the same time.'],
      ['✍️', 'Fill four boxes', 'A first name, a place (city, country or state), an animal and a thing, each starting with the letter. Your answers are secret until the round ends.'],
      ['✋', 'Shout Stop!', 'Filled all four? Press Stop and everyone else has five seconds left. Otherwise the round ends when the clock runs out or everyone hands in.'],
      ['👍', 'Vote on new words', 'Words in the built-in lists count at once. Anything else gets a quick thumbs up or down from the others: most votes win, and a tie lets it in.'],
      ['⭐', 'Score', '10 points for a valid answer only you wrote, 5 if someone else wrote it too, 0 for a blank or a word that was voted out.'],
    ],
    tips: ['Rare words score double: everybody writes "Mumbai" for M!', 'Spelling is forgiving: capitals, accents, spaces and small slips don’t matter.', 'Stop is powerful, but only once your four words are good.'],
  },
  // No onTimeout: the game runs its own clocks, so the site's turn timer would only add a second countdown.
  // timeoutMove is the move made for a player whose time runs out (tests use it).
  timeoutMove: onTimeout,
  setup, act, turnOf, view, bot, render,
};
