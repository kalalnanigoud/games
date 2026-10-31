// Word Spies: two teams race to find their agents on a grid of 25 words.
// Each team's spymaster sees the secret key and gives one-word clues with a number;
// teammates reveal words. Hitting the other team's word or a bystander ends your turn,
// and the assassin loses the game on the spot.
import { esc, log, addFx, rand, shuffle } from '../js/util.js';
import { injectCSS, morph } from '../js/fx.js';
import { sound } from '../js/sound.js';
import { icon } from '../js/icons.js';
import { portrait } from '../js/avatar.js';
import { levelOption, levelOf } from '../js/levels.js';

const browser = typeof document !== 'undefined';

// Themes double as the computer spymaster's clues: it clues a theme that covers its own words.
const THEMES = Object.fromEntries(`
ocean: whale ship wave pirate shell anchor fish island coral sailor shark beach
space: star moon rocket planet alien comet astronaut orbit galaxy satellite
music: piano guitar drum band note concert violin opera rock jazz
kitchen: knife oven spoon pan fork cook plate kettle fridge
farm: cow pig horse tractor barn chicken hay sheep corn duck
winter: snow ice sled scarf glove penguin skate frost
royal: king queen crown castle throne knight palace prince
sports: ball goal team coach match racket net court medal swim
forest: tree bear wolf owl mushroom leaf deer cabin moss
money: bank coin gold cash safe card price market
city: bus taxi bridge tower park subway traffic street
school: book pencil teacher class test desk library chalk
weather: rain storm cloud thunder wind rainbow fog sun
medicine: doctor nurse pill hospital heart needle bandage
time: clock watch hour calendar alarm history future
fire: flame smoke dragon candle match volcano fireworks torch
fruit: apple orange lemon cherry grape banana peach plum
travel: plane map passport train hotel suitcase ticket camera
movie: actor star screen popcorn director ticket hero villain
magic: wizard wand spell witch potion unicorn ghost fairy
garden: rose seed bee fence flower worm shovel hose
cars: wheel engine tire horn key race garage truck
light: lamp bulb sun candle torch laser shadow mirror
home: door window roof bed chair table key wall
insects: bee ant spider fly butterfly worm cricket
desert: camel sand cactus pyramid oasis snake sun
party: cake balloon gift dance mask candle band
cold: ice snow penguin fridge frost igloo
water: rain river wave ice swim bottle fish bath
night: moon star owl bat dream ghost shadow sleep
paper: book map card ticket kite letter note
army: soldier tank shield sword flag captain knight
circus: clown lion tent elephant horse ring juggler
birds: owl duck chicken penguin eagle wing feather nest
round: ball coin moon wheel ring orange plate clock
sweet: cake honey candy banana peach cherry chocolate`.trim().split('\n').map((l) => { const [t, w] = l.split(':'); return [t.trim(), w.trim().split(/\s+/)]; }));
const WORDS = [...new Set(Object.values(THEMES).flat())];
const themesOf = (w) => Object.keys(THEMES).filter((t) => THEMES[t].includes(w));
const TEAM = { r: 'Red', b: 'Blue' };
const other = (t) => (t === 'r' ? 'b' : 'r');

/* ---------------- rules ---------------- */

function setup(players, opts = {}) {
  if (players.length < 4 || players.length > 8) throw Error('Word Spies needs 4–8 players.');
  const first = rand(2) ? 'r' : 'b';
  const seats = shuffle(players.slice());
  const key = shuffle([...Array(9).fill(first), ...Array(8).fill(other(first)), ...Array(7).fill('n'), 'x']);
  const s = {
    phase: 'clue', over: false, winners: [], turn: first, clue: null, left: 0, clues: [], log: [],
    players: seats.map((p, i) => ({ id: p.id, name: p.name, team: i % 2 ? 'b' : 'r', spy: i < 2 })),
    words: shuffle(WORDS.slice()).slice(0, 25), key, open: Array(25).fill(false),
    level: levelOf(opts), // how sharp the computer players are; public, so it is in every view
  };
  log(s, `${TEAM[first]} team starts and has 9 agents to find. ${TEAM[other(first)]} has 8.`);
  return s;
}
const spyOf = (s, t) => s.players.find((p) => p.team === t && p.spy);
const agentsLeft = (s, t) => s.key.filter((k, i) => k === t && !s.open[i]).length;
function win(s, t, why) {
  Object.assign(s, { over: true, phase: 'over', winner: t, winners: s.players.filter((p) => p.team === t).map((p) => p.id) });
  log(s, why);
}
function endTurn(s, why) {
  if (why) log(s, why);
  s.turn = other(s.turn); s.phase = 'clue'; s.clue = null; s.left = 0;
}
function clueProblem(s, word) {
  if (!/^[a-z][a-z-]{1,19}$/.test(word)) return 'A clue is one word (letters only).';
  for (let i = 0; i < 25; i++) {
    const w = s.words[i];
    if (w === word || (!s.open[i] && word.length >= 3 && (w.includes(word) || word.includes(w)))) return `“${word}” is too close to a word on the board.`;
  }
  return null;
}

function act(s, pid, a) {
  if (s.over) throw Error('The game is over.');
  const me = s.players.find((p) => p.id === pid);
  if (!me) throw Error('You are not playing in this game.');
  if (!a || typeof a !== 'object') throw Error('Choose something to do.');
  if (a.type === 'think') return;
  if (me.team !== s.turn) throw Error(`It is the ${TEAM[s.turn]} team’s turn.`);
  if (a.type === 'clue') {
    if (s.phase !== 'clue' || !me.spy) throw Error('Only your spymaster gives the clue.');
    const word = String(a.word || '').trim().toLowerCase(), n = Number(a.n);
    const problem = clueProblem(s, word);
    if (problem) throw Error(problem);
    if (!Number.isInteger(n) || n < 1 || n > 9) throw Error('Pick a number from 1 to 9.');
    s.clue = { word, n, team: me.team }; s.left = n + 1; s.phase = 'guess';
    s.clues.push({ team: me.team, word, n });
    log(s, `${me.name} (${TEAM[me.team]} spymaster): “${word.toUpperCase()}”, ${n}.`);
    addFx(s, { kind: 'sound', sound: 'card' });
    return;
  }
  if (s.phase !== 'guess' || me.spy) throw Error(me.spy ? 'Spymasters can’t touch the board. Let your team guess.' : 'Wait for your spymaster’s clue.');
  if (a.type === 'pass') return endTurn(s, `${me.name} ended the ${TEAM[me.team]} turn.`);
  if (a.type !== 'guess') throw Error('Unknown action.');
  const i = a.card;
  if (!Number.isInteger(i) || i < 0 || i > 24 || s.open[i]) throw Error('Pick a hidden word.');
  s.open[i] = true;
  const k = s.key[i], word = s.words[i].toUpperCase();
  addFx(s, { kind: 'pulse', at: 'spy-card-' + i, sound: k === me.team ? 'chime' : k === 'x' ? 'bad' : 'flip' });
  if (k === 'x') return win(s, other(me.team), `${me.name} found the assassin (${word})! ${TEAM[other(me.team)]} team wins.`);
  if (agentsLeft(s, 'r') === 0) return win(s, 'r', `Red team found all its agents and wins!`);
  if (agentsLeft(s, 'b') === 0) return win(s, 'b', `Blue team found all its agents and wins!`);
  if (k === me.team) {
    log(s, `${me.name} found a ${TEAM[k]} agent: ${word}.`);
    if (--s.left <= 0) endTurn(s, 'Out of guesses for this clue.');
  } else endTurn(s, `${me.name} picked ${word}: ${k === 'n' ? 'an innocent bystander' : 'a ' + TEAM[k] + ' agent'}. Turn over.`);
}

function view(s, pid) {
  const v = JSON.parse(JSON.stringify(s));
  const me = s.players.find((p) => p.id === pid);
  if (!s.over && !me?.spy) v.key = s.key.map((k, i) => (s.open[i] ? k : null));
  return v;
}

// Spymaster: clue the theme that covers the most of our words and none of the dangerous ones.
// Guessers: follow a theme clue; for a clue they don't know, take a guess or pass.
// That is the Normal level; Easy and Hard (v.level) play the helpers below instead.
function bot(v, pid) {
  const me = v.players.find((p) => p.id === pid);
  const idle = browser ? 0.75 : 0.3;
  const level = v.level === 'easy' || v.level === 'hard' ? v.level : 'normal';
  if (v.phase === 'clue') {
    const pick = level === 'easy' ? easyClue(v, me) : level === 'hard' ? hardClue(v, me) : null;
    if (pick) return pick;
    let best = null;
    for (const [t, list] of Object.entries(THEMES)) {
      if (clueProblem(v, t)) continue;
      const hidden = v.words.map((w, i) => (!v.open[i] && list.includes(w) ? v.key[i] : null)).filter(Boolean);
      const own = hidden.filter((k) => k === me.team).length;
      if (!own || hidden.includes('x')) continue;
      const score = own * 3 - hidden.filter((k) => k === other(me.team)).length * 3 - hidden.filter((k) => k === 'n').length;
      if (!best || score > best.score) best = { t, own, score };
    }
    if (best && best.score > 0) return { type: 'clue', word: best.t, n: best.own };
    const i = v.key.findIndex((k, j) => k === me.team && !v.open[j]);
    const fallback = themesOf(v.words[i]).find((t) => !clueProblem(v, t)) || ['thing', 'object', 'stuff'].find((t) => !clueProblem(v, t));
    return { type: 'clue', word: fallback, n: 1 };
  }
  if (Math.random() < idle) return { type: 'think' };
  if (level !== 'normal') return levelGuess(v, me, level);
  const list = THEMES[v.clue.word];
  const fits = v.words.map((w, i) => (!v.open[i] && list?.includes(w) ? i : -1)).filter((i) => i >= 0);
  const used = v.clue.n + 1 - v.left;
  if (fits.length && used < v.clue.n) return { type: 'guess', card: fits[rand(fits.length)] };
  if (!list && used === 0) { const hidden = v.open.map((o, i) => (o ? -1 : i)).filter((i) => i >= 0); return { type: 'guess', card: hidden[rand(hidden.length)] }; }
  return { type: 'pass' };
}

// What a clue points at: a theme's words or, for a word that belongs to several themes (MOON: space, night,
// round), the words of all of them. Hard spymasters clue such words; hard agents (and people) follow them.
const themeNamed = (w) => (Object.prototype.hasOwnProperty.call(THEMES, w) ? THEMES[w] : null);
const LINKED = new Map();
function pointsAt(word) {
  if (themeNamed(word)) return themeNamed(word);
  if (!LINKED.has(word)) LINKED.set(word, [...new Set(themesOf(word).flatMap((t) => THEMES[t]))]);
  return LINKED.get(word);
}
const LINKS = WORDS.filter((w) => themesOf(w).length > 1);
const under = (words, word) => { const list = pointsAt(word); return words.map((w) => list.includes(w)); };

// Easy spymaster: any theme with one of our words in it, never minding the other team's words or bystanders.
function easyClue(v, me) {
  const ok = Object.keys(THEMES).filter((t) => {
    if (clueProblem(v, t)) return false;
    const on = under(v.words, t), hidden = (k) => v.key.some((x, i) => x === k && on[i] && !v.open[i]);
    return hidden(me.team) && !hidden('x');
  });
  if (!ok.length) return null;
  const t = ok[rand(ok.length)], on = under(v.words, t);
  return { type: 'clue', word: t, n: v.key.filter((k, i) => k === me.team && on[i] && !v.open[i]).length };
}

// Hard agents read the clues so far: "MOON, 2" said that 2 of the hidden words MOON points at were the clue
// giver's. The giver's cards revealed under it since use that up, so for a word still hidden there,
// (n - revealed) / hidden is a floor on the chance that it is the giver's. Public information only: a board
// `b` has the revealed cards' colours in `known`, the clues, and `on[j]`, the words clue j points at.
function readClues(b, team) {
  const mine = Array(25).fill(0), theirs = Array(25).fill(0);
  b.clues.forEach((c, j) => {
    const on = b.on[j];
    let hidden = 0, found = 0;
    for (let i = 0; i < 25; i++) if (on[i]) { if (!b.open[i]) hidden++; else if (b.known[i] === c.team) found++; }
    const p = hidden ? Math.max(0, c.n - found) / hidden : 0, into = c.team === team ? mine : theirs;
    for (let i = 0; i < 25; i++) if (on[i] && !b.open[i] && p > into[i]) into[i] = p;
  });
  return { mine, theirs };
}
// The cards hard agents choose between (at random), or none to end the turn: the likeliest of the words the clue
// points at, then with the extra guess a word an earlier clue of theirs still points at when it is probably theirs.
function hardChoices(b, team) {
  const { mine, theirs } = readClues(b, team);
  const odds = (i) => mine[i] - theirs[i] * 1.5;
  const likeliest = (cards) => { const top = Math.max(...cards.map(odds)); return cards.filter((i) => odds(i) === top); };
  const clue = b.clues.at(-1), on = b.on.at(-1), used = clue.n + 1 - b.left;
  const hidden = [], fits = [];
  for (let i = 0; i < 25; i++) if (!b.open[i]) { hidden.push(i); if (on[i]) fits.push(i); }
  if (fits.length && used < clue.n) return likeliest(fits);
  const spare = hidden.filter((i) => mine[i] >= 0.5 && theirs[i] === 0);
  if (spare.length) return likeliest(spare);
  if (!themeNamed(clue.word) && !fits.length && used === 0) return likeliest(hidden);
  return [];
}
const board = (v, clues, known) => ({ open: v.open.slice(), known, clues, on: clues.map((c) => under(v.words, c.word)), left: v.left });

// Hard spymaster: plays each possible clue (every theme, and every word that links several themes) through its
// agents' reasoning above and gives the one they will do best with: agents found now (the last one wins the
// game), words of ours the clues will still point at for later, minus the other team's agents handed over.
// The assassin is never under the clue unless every clue for the words left risks it.
function hardClue(v, me) {
  const rival = other(me.team), hiddenOf = (t) => v.key.filter((k, i) => k === t && !v.open[i]).length;
  const base = board(v, v.clues, v.key.map((k, i) => (v.open[i] ? k : null)));
  const reveal = (b, i, left) => { const open = b.open.slice(), known = b.known.slice(); open[i] = true; known[i] = v.key[i]; return { ...b, open, known, left }; };
  // Leftovers the agents can pick up with a later extra guess.
  const later = (b) => {
    const { mine, theirs } = readClues(b, me.team);
    let sum = 0;
    for (let i = 0; i < 25; i++) if (!b.open[i] && mine[i] >= 0.5 && !theirs[i]) sum += v.key[i] === me.team ? 0.7 : v.key[i] === 'n' ? 0 : -0.7;
    return sum;
  };
  const outcome = (b, ours, rivals) => {
    const cards = hardChoices(b, me.team);
    if (!cards.length) return later(b);
    let sum = 0;
    for (const i of cards) {
      const k = v.key[i];
      if (k === me.team) sum += ours === 1 ? 20 : 1 + (b.left <= 1 ? later(reveal(b, i, 0)) : outcome(reveal(b, i, b.left - 1), ours - 1, rivals));
      else if (k === 'x' || (k === rival && rivals === 1)) sum -= 20;
      else sum += (k === 'n' ? 0 : -1.5) + later(reveal(b, i, 0));
    }
    return sum / cards.length;
  };
  const tryClue = (t, n, on) => outcome({ ...base, clues: [...base.clues, { team: me.team, word: t, n }], on: [...base.on, on], left: n + 1 }, hiddenOf(me.team), hiddenOf(rival));
  let best = null, risky = null;
  for (const t of [...Object.keys(THEMES), ...LINKS]) {
    if (clueProblem(v, t)) continue;
    const on = under(v.words, t);
    let own = 0, x = false;
    v.key.forEach((k, i) => { if (on[i] && !v.open[i]) { if (k === me.team) own++; if (k === 'x') x = true; } });
    if (!own) continue;
    const score = tryClue(t, own, on);
    if (!x && (!best || score > best.score)) best = { t, n: own, score };
    if (x && (!risky || score > risky.score)) risky = { t, n: own, score };
  }
  if (best) return { type: 'clue', word: best.t, n: best.n };
  // Every clue for our last words also points at the assassin: weigh the best of those against a clue that
  // points at nothing, after which the agents go by the earlier clues.
  const blank = ['thing', 'object', 'stuff'].find((t) => !clueProblem(v, t));
  const blankScore = blank ? tryClue(blank, 1, under(v.words, blank)) : -Infinity;
  if (risky && risky.score > blankScore) return { type: 'clue', word: risky.t, n: risky.n };
  return blank ? { type: 'clue', word: blank, n: 1 } : null;
}

// Agents at the Easy and Hard levels, from public information only (the board, revealed cards and the clues).
// Easy agents often tap any hidden word.
function levelGuess(v, me, level) {
  const used = v.clue.n + 1 - v.left, list = themeNamed(v.clue.word);
  const guess = (cards) => ({ type: 'guess', card: cards[rand(cards.length)] });
  if (level === 'easy') {
    const hidden = v.open.map((o, i) => (o ? -1 : i)).filter((i) => i >= 0);
    const fits = list ? hidden.filter((i) => list.includes(v.words[i])) : [];
    if (fits.length && used < v.clue.n) return guess(Math.random() < 0.25 ? hidden : fits);
    if (!list && used === 0) return guess(hidden);
    return { type: 'pass' };
  }
  const cards = hardChoices(board(v, v.clues, v.key.map((k, i) => (v.open[i] ? k : null))), me.team);
  return cards.length ? guess(cards) : { type: 'pass' };
}

/* ---------------- interface ---------------- */

const UI = { pick: null, clue: '', n: 1, key: '' };
const MARK_NAME = { r: 'red agent', b: 'blue agent', n: 'bystander', x: 'assassin' };
const TCOL = { r: '#ff5a6a', b: '#4d94ff' };
// Every colour also has a shape (diamond = Red, circle = Blue, dot = bystander, cross = assassin),
// and revealed cards add a pattern (Red stripes, Blue dots).
const shape = (d) => `<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">${d}</svg>`;
const MARK = {
  r: shape('<path d="M10 1.5l8.5 8.5-8.5 8.5L1.5 10z" fill="currentColor"/>'),
  b: shape('<circle cx="10" cy="10" r="8" fill="currentColor"/>'),
  n: shape('<circle cx="10" cy="10" r="3.4" fill="currentColor"/>'),
  x: shape('<path d="M4 4l12 12M16 4L4 16" stroke="currentColor" stroke-width="3.6" stroke-linecap="round"/>'),
};
// Who was behind a revealed card: an agent in a fedora, a passer-by, or the assassin's crosshair.
const SIL = {
  r: '<svg class="spy-sil" viewBox="0 0 40 40" aria-hidden="true"><path d="M8 16.5h24l-3.4-1.4-1.5-6a2 2 0 0 0-2.5-1.5L20 8.6l-4.6-1a2 2 0 0 0-2.5 1.5l-1.5 6z"/><path d="M13 18.5c0 4.6 3 8 7 8s7-3.4 7-8z"/><path d="M5 40c1-7 7-11.5 15-11.5S34 33 35 40z"/></svg>',
  n: '<svg class="spy-sil" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="17" r="7.5"/><path d="M6 40c1-7 6.5-11.5 14-11.5S33 33 34 40z"/></svg>',
  x: '<svg class="spy-sil" viewBox="0 0 40 40" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><circle cx="20" cy="20" r="12"/><circle cx="20" cy="20" r="3" fill="currentColor"/><path d="M20 3v8M20 29v8M3 20h8M29 20h8"/></svg>',
};
SIL.b = SIL.r;
const SPY_IC = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 11.5h18M6.5 11.5l1.2-5.2A1.5 1.5 0 0 1 9.6 5.2L12 6l2.4-.8a1.5 1.5 0 0 1 1.9 1.1l1.2 5.2"/><circle cx="8" cy="16.5" r="2.6"/><circle cx="16" cy="16.5" r="2.6"/><path d="M10.6 16.3c.9-.6 1.9-.6 2.8 0"/></svg>';
// The rosters and the mission log fold away on phones so the board gets the screen; they stay as the player left them.
const wide = () => (typeof matchMedia === 'function' ? matchMedia('(min-width: 901px)').matches : true);
let teamsOpen = wide(), logOpen = wide();
let prev = null; // the last board this screen drew: fresh reveals flip, a team that found an agent flashes

function render(el, v, ctx) {
  injectCSS('spies', STYLE);
  const key = v.words.join();
  if (UI.key !== key) Object.assign(UI, { key, pick: null, clue: '', n: 1 });
  const me = v.players.find((p) => p.id === ctx.me);
  const myTurn = !v.over && me && me.team === v.turn;
  const guessing = myTurn && v.phase === 'guess' && !me.spy, cluing = myTurn && v.phase === 'clue' && me.spy;
  if (!guessing || v.open[UI.pick]) UI.pick = null;
  const spy = spyOf(v, v.turn);
  // Agents still hidden. Guessers' copy of the key only shows revealed cards, so count from the team sizes:
  // the team that gave the first clue started with 9 agents, the other with 8.
  const first = v.clues.length ? v.clues[0].team : v.turn;
  const hiddenOf = (t) => (t === first ? 9 : 8) - v.key.filter((k, i) => v.open[i] && k === t).length;
  const left = { r: hiddenOf('r'), b: hiddenOf('b') };
  const same = prev?.key === key;
  const found = { r: same && left.r < prev.left.r, b: same && left.b < prev.left.b };
  // A counter that flashed last time too gets the twin keyframes (spy-again), so the kept counter flashes again.
  const again = { r: found.r && prev.found.r && !prev.again.r, b: found.b && prev.found.b && !prev.again.b };
  const flipIn = new Set(same ? v.open.map((o, i) => (o && !prev.open[i] ? i : -1)).filter((i) => i >= 0) : []);
  const newClue = same && v.clues.length > prev.clues;
  prev = { key, left, open: v.open.slice(), clues: v.clues.length, found, again };
  const face = (p, t) => `<span class="spy-face" style="--tc:${TCOL[t]}">${portrait({ id: p.id, bot: !!ctx.isBot?.(p.id) })}</span>`;
  const guesses = (n) => `${n} guess${n === 1 ? '' : 'es'} left`;

  // ---- the operations desk: both teams' counters around whose turn it is ----
  const score = (t) => `<div class="spy-score ${t} ${!v.over && v.turn === t ? 'on' : ''} ${v.over && v.winner === t ? 'win' : ''} ${found[t] ? (again[t] ? 'spy-scored spy-again' : 'spy-scored') : ''}" data-a="spy-left-${t}" title="${left[t]} ${TEAM[t]} agent${left[t] === 1 ? '' : 's'} still hidden">`
    + `<i>${MARK[t]}</i><b>${left[t]}</b><small>${TEAM[t]}<span> left</span></small></div>`;
  const status = v.over ? `${TEAM[v.winner]} team wins!`
    : v.phase === 'clue' ? (cluing ? 'Your team is waiting for your clue' : `${face(spy, v.turn)}<span>${esc(spy.name)} (${TEAM[v.turn]} spymaster) is thinking of a clue…</span>`)
    : `<span>${guessing ? 'Your team is guessing' : `${TEAM[v.turn]} team is guessing`}</span>`;
  const slip = !v.over && v.phase === 'guess' && v.clue
    ? `<div class="spy-slip ${newClue ? 'new' : ''}"><span class="spy-slipword">${esc(v.clue.word.toUpperCase())}</span><span class="spy-n">${v.clue.n}</span></div>`
      + `<div class="spy-guesses"><span class="spy-pips" aria-hidden="true">${Array.from({ length: v.clue.n + 1 }, (_, j) => `<i class="${j < v.left ? 'on' : ''}"></i>`).join('')}</span>${guesses(v.left)}</div>` : '';
  const turn = v.over ? `${icon('trophy')}Mission complete` : `<span class="spy-radar"></span>${MARK[v.turn]}${TEAM[v.turn]} turn`;
  const role = me ? `<span class="spy-role ${me.team}">${me.spy ? SPY_IC : icon('users')}${me.spy ? 'You are the spymaster' : 'You are an agent'} · ${TEAM[me.team]}</span>` : `<span class="spy-role">${icon('eye')}Watching</span>`;
  const hint = v.over ? (me ? (me.team === v.winner ? 'Well played, agent. The whole key is shown.' : 'Better luck next mission. The whole key is shown.') : 'The whole key is shown.')
    : cluing ? 'Give a one-word clue and how many of your words it covers.'
    : guessing ? (UI.pick == null ? 'Tap a word, then tap it again to reveal it.' : 'Tap it again, or press Reveal.')
    : me && me.team === v.turn ? (me.spy ? 'Your team is guessing. No hints now!' : 'Wait for your spymaster’s clue.')
    : me ? `The ${TEAM[v.turn]} team is playing.` : '';

  const board = v.words.map((w, i) => {
    const k = v.key[i], open = v.open[i];
    const cls = ['spy-card', open ? 'open ' + k : '', !open && k ? 'known ' + k : '', guessing && !open ? 'can' : '', UI.pick === i ? 'pick' : '', flipIn.has(i) ? 'spy-flip' : '', w.length >= 8 ? 'long' : ''].filter(Boolean).join(' ');
    return `<button class="${cls}" data-card="${i}" data-a="spy-card-${i}" style="--i:${i}" ${guessing && !open ? '' : 'tabindex="-1"'} aria-label="${esc(w)}${k ? ', ' + MARK_NAME[k] : ''}${open ? ', revealed' : ''}">${open ? SIL[k] : ''}${k ? `<i>${MARK[k]}</i>` : ''}<span>${esc(w)}</span></button>`;
  }).join('');

  // ---- side: rosters with faces, and the mission log ----
  const team = (t) => `<div class="spy-team ${t}"><h3>${MARK[t]}${TEAM[t]}<span class="spy-teamleft">${left[t]} left</span></h3>${v.players.filter((p) => p.team === t).map((p) => `<div class="spy-member ${p.id === ctx.me ? 'me' : ''}">${face(p, t)}<span class="spy-mname">${esc(p.name)}</span>${p.spy ? `<span class="tag spy-tag">${SPY_IC}Spymaster</span>` : ''}${p.id === ctx.me ? '<span class="tag t-you">You</span>' : ''}</div>`).join('')}</div>`;
  const last = v.clues.at(-1);
  const clues = v.clues.length ? v.clues.slice().reverse().map((c) => `<span class="spy-clueline ${c.team}">${MARK[c.team]}<b>${esc(c.word.toUpperCase())}</b><em>${c.n}</em></span>`).join('') : '<p class="muted small" style="margin:0">No clues yet.</p>';

  const active = typeof document !== 'undefined' ? document.activeElement : null;
  const typing = active && active.id === 'spyClue' && el.contains(active) ? [active.selectionStart, active.selectionEnd] : null;
  // The drawers stay as the player left them, even if this update comes before their toggle event.
  teamsOpen = el.querySelector('.spy-teams')?.open ?? teamsOpen;
  logOpen = el.querySelector('.spy-logbook')?.open ?? logOpen;
  // Only what changed is redrawn: the cards, their breathing rims and the radar sweep are kept between updates.
  morph(el, `<div class="spy-root"><div class="game-layout spy-layout">
    <div class="spy-main felt spy-felt">
      ${v.over ? `<div class="winner-banner">${icon('trophy')}${me ? (me.team === v.winner ? 'Your team wins!' : `${TEAM[v.winner]} team wins`) : `${TEAM[v.winner]} team wins`}</div>` : ''}
      <div class="spy-hud">${score('r')}<div class="spy-bar ${v.over ? v.winner : v.turn}"><span class="spy-turn">${turn}</span><span class="spy-status">${status}</span>${slip}</div>${score('b')}</div>
      <div class="spy-rolebar">${role}${hint ? `<span class="spy-hint">${hint}</span>` : ''}</div>
      <div class="spy-board ${me?.spy && !v.over ? 'spymaster' : ''}">${board}</div>
      ${cluing ? `<form class="panel spy-clue"><label class="grow"><small>One-word clue</small><input id="spyClue" maxlength="20" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(UI.clue)}" placeholder="e.g. ocean"></label>
        <label><small>Words</small><select id="spyN">${Array.from({ length: 9 }, (_, i) => `<option ${UI.n === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></label><button class="primary">${icon('check')}Give clue</button></form>
        <p class="spy-note"><span>Your words have the</span><i class="${v.turn}">${MARK[v.turn]}</i><span>mark. Avoid the</span><i class="x">${MARK.x}</i><span>assassin!</span></p>` : ''}
      ${guessing ? `<div class="row spy-actions"><button class="primary grow ${UI.pick == null ? '' : 'spy-ready'}" id="spyGo" ${UI.pick == null ? 'disabled' : ''}>${icon('eye')}${UI.pick == null ? 'Tap a word, then reveal it' : `Reveal ${esc(v.words[UI.pick].toUpperCase())}`}</button><button id="spyPass">End turn</button></div>` : ''}
    </div>
    <div class="side spy-side">
      <details class="panel drawer spy-teams" ${teamsOpen ? 'open' : ''}><summary>${icon('users')}<span>Agents</span><span class="note">${v.players.length} players</span>${icon('chevron', 'chev')}</summary>
        <div class="drawer-body">${team('r')}${team('b')}</div></details>
      <details class="panel drawer spy-logbook" ${logOpen ? 'open' : ''}><summary>${icon('book')}<span>Mission log</span><span class="note">${last ? esc(last.word.toUpperCase()) + ' ' + last.n : ''}</span>${icon('chevron', 'chev')}</summary>
        <div class="drawer-body"><div class="spy-clues">${clues}</div><div class="parchment log">${v.log.slice(0, 8).map((l) => `<div>${esc(l)}</div>`).join('')}</div></div></details>
    </div>
  </div></div>`);

  // Kept elements keep their handlers, so they are set as properties (replaced, not stacked, on each update).
  const teamsEl = el.querySelector('.spy-teams'), logEl = el.querySelector('.spy-logbook');
  teamsEl.ontoggle = () => { teamsOpen = teamsEl.open; };
  logEl.ontoggle = () => { logOpen = logEl.open; };
  el.querySelectorAll('[data-card]').forEach((b) => (b.onclick = () => {
    if (!guessing) return;
    const i = +b.dataset.card;
    if (v.open[i]) return;
    if (UI.pick === i) { UI.pick = null; return ctx.send({ type: 'guess', card: i }); } // a second tap confirms
    UI.pick = i; sound('click'); render(el, v, ctx);
  }));
  const go = el.querySelector('#spyGo'), pass = el.querySelector('#spyPass');
  if (go) go.onclick = () => { const i = UI.pick; UI.pick = null; ctx.send({ type: 'guess', card: i }); };
  if (pass) pass.onclick = () => ctx.send({ type: 'pass' });
  const form = el.querySelector('.spy-clue');
  if (form) {
    const input = form.querySelector('#spyClue'), sel = form.querySelector('#spyN');
    input.oninput = () => (UI.clue = input.value);
    sel.onchange = () => (UI.n = +sel.value);
    form.onsubmit = (e) => { e.preventDefault(); ctx.send({ type: 'clue', word: input.value, n: +sel.value }); };
    // An update while the spymaster is typing shouldn't knock them out of the box.
    if (typing) { input.focus({ preventScroll: true }); try { input.setSelectionRange(...typing); } catch {} }
  }
}

/* Cover art: a night-time operations room. Two spymasters in trench coats face a glowing word grid;
   Red holds up the clue, Blue points at a card (self-contained ids, prefixed spc-). */
function coverSVG() {
  const stops = (list) => list.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}"${a === 1 ? '' : ` stop-opacity="${a}"`}/>`).join('');
  const lg = (id, list, extra = 'x1="0" y1="0" x2="0" y2="1"') => `<linearGradient id="${id}" ${extra}>${stops(list)}</linearGradient>`;
  const rg = (id, list) => `<radialGradient id="${id}">${stops(list)}</radialGradient>`;
  const FONT = 'font-family="Fredoka,Nunito,sans-serif" font-weight="700" text-anchor="middle"';
  // city skyline in the window, with a few lit windows
  const towers = [[18, 70, 22], [42, 54, 18], [62, 80, 26], [90, 46, 15], [107, 66, 22], [196, 62, 20], [218, 42, 17], [237, 74, 24], [263, 52, 18], [283, 68, 22]];
  const city = towers.map(([x, y, w]) => {
    let lit = '';
    for (let yy = y + 6; yy < 108; yy += 8) for (let xx = x + 3; xx < x + w - 3; xx += 6) if ((xx * 7 + yy * 3) % 11 < 3) lit += `<rect x="${xx}" y="${yy}" width="2.4" height="3.2" fill="#ffd98a" opacity=".8"/>`;
    return `<rect x="${x}" y="${y}" width="${w}" height="${112 - y}" fill="#0a1236"/>${lit}`;
  }).join('');
  const stars = [[30, 20], [70, 30], [128, 16], [150, 40], [176, 22], [200, 34], [290, 22], [302, 46], [120, 52]].map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i % 3 ? 0.8 : 1.1}" fill="#fff" opacity=".7"/>`).join('');
  // the glowing board: 5 x 4 word cards, a few already revealed
  const GRID = ['hrhbh', 'bhnhr', 'hhhbt', 'rhnhh'];
  const cards = GRID.flatMap((row, r) => [...row].map((k, c) => {
    const x = +(106 + c * 22.4).toFixed(1), y = 58 + r * 17.5;
    const base = `<rect x="${x}" y="${y}" width="18.4" height="13.5" rx="2.4" fill="${{ r: '#ff4d5e', b: '#3d8bff', n: '#b9b6a8' }[k] || '#eaf6ff'}" opacity="${k === 'h' || k === 't' ? 0.92 : 1}"/>`;
    const mark = k === 'r' ? `<path d="M${x + 9.2} ${y + 3}l3.6 3.75-3.6 3.75-3.6-3.75z" fill="#fff"/>`
      : k === 'b' ? `<circle cx="${x + 9.2}" cy="${y + 6.75}" r="3" fill="#fff"/>`
      : k === 'n' ? '' : `<rect x="${x + 4}" y="${y + 5.6}" width="10.4" height="2.4" rx="1" fill="#1b2347" opacity=".45"/>`;
    const ring = k === 't' ? `<rect x="${x - 1.5}" y="${y - 1.5}" width="21.4" height="16.5" rx="3.5" fill="none" stroke="#ffd166" stroke-width="1.6"/>` : '';
    return base + mark + ring;
  })).join('');
  const coat = (dir, cx, grad, lapel, belt, skin, hatTop, hatBrim, band) => {
    const X = (d) => cx + dir * d; // mirror around the figure's centre line
    return `<path d="M${X(-40)} 200L${X(-31)} 138C${X(-28)} 122 ${X(-16)} 113 ${cx} 113C${X(16)} 113 ${X(27)} 122 ${X(30)} 138L${X(39)} 200z" fill="url(#${grad})"/>`
      + `<path d="M${X(-15)} 116L${X(-2)} 146L${X(-6)} 113zM${X(15)} 116L${X(2)} 146L${X(6)} 113z" fill="${lapel}"/><path d="M${cx} 146V200" stroke="${belt}" stroke-width="1.5"/>`
      + `<rect x="${cx - 34}" y="160" width="68" height="7" rx="2" fill="${belt}"/><rect x="${cx - 5}" y="159" width="10" height="9" rx="2" fill="none" stroke="#ffd166" stroke-width="1.6"/>`
      + `<rect x="${cx - 5}" y="104" width="11" height="12" rx="4" fill="${skin}" opacity=".85"/><circle cx="${X(1)}" cy="98" r="12.5" fill="${skin}"/>`
      + `<path d="M${X(-12)} 108L${X(-8)} 122L${X(-2)} 112zM${X(14)} 108L${X(10)} 122L${X(4)} 112z" fill="${lapel}"/>`
      + `<rect x="${dir > 0 ? cx + 2 : cx - 13}" y="94" width="11" height="5" rx="2" fill="#0b0b14"/><path d="M${dir > 0 ? cx + 5 : cx - 10} 95.5h4" stroke="#fff" stroke-opacity=".6" stroke-width="1"/>`
      + `<path d="M${dir > 0 ? cx + 5 : cx - 11} 105q3 1.6 6-.6" fill="none" stroke="#3a2220" stroke-width="1.4" stroke-linecap="round"/>`
      + `<path d="M${cx - 12} 89C${cx - 12} 76 ${cx + 12} 76 ${cx + 12} 89z" fill="${hatTop}"/><rect x="${cx - 12}" y="85" width="24" height="4" fill="${band}"/><ellipse cx="${cx}" cy="89.5" rx="20" ry="4.2" fill="${hatBrim}"/>`;
  };
  return `<svg viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Two spymasters in trench coats face a glowing grid of word cards"><defs>` +
    lg('spc-sky', [[0, '#050920'], [0.6, '#0f1a4c'], [1, '#1d2c70']], 'gradientUnits="userSpaceOnUse" x1="0" y1="8" x2="0" y2="112"') +
    lg('spc-wall', [[0, '#0d1538'], [1, '#060a1f']]) +
    rg('spc-red', [[0, '#ff4d5e', 0.5], [1, '#ff4d5e', 0]]) +
    rg('spc-blue', [[0, '#3d8bff', 0.55], [1, '#3d8bff', 0]]) +
    lg('spc-screen', [[0, '#7fe3ff', 0.34], [1, '#3d8bff', 0.14]]) +
    lg('spc-beam', [[0, '#8be6ff', 0.05], [1, '#8be6ff', 0.36]]) +
    lg('spc-coatR', [[0, '#b52a45'], [1, '#5c1026']]) +
    lg('spc-coatB', [[0, '#3566d1'], [1, '#142a66']]) +
    lg('spc-desk', [[0, '#1c2864'], [1, '#0a1134']]) +
    `<filter id="spc-blur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="8"/></filter></defs>` +
    // the room: a big night window over the city
    `<rect width="320" height="200" fill="url(#spc-wall)"/><rect x="14" y="8" width="292" height="104" rx="6" fill="url(#spc-sky)"/>${stars}` +
    `<path d="M248 21a11 11 0 1 0 9.5 16.5a9 9 0 1 1-9.5-16.5z" fill="#fff4cf"/>` +
    `<path d="M70 112L34 8H50z M250 112L292 8H306V14z" fill="#8be6ff" opacity=".06"/>${city}` +
    `<path d="M14 60H306M111 8V112M209 8V112" stroke="#050817" stroke-width="3.5"/><rect x="14" y="8" width="292" height="104" rx="6" fill="none" stroke="#1d2a60" stroke-width="3"/>` +
    // team lamps either side, floor
    `<circle cx="16" cy="130" r="96" fill="url(#spc-red)"/><circle cx="304" cy="130" r="96" fill="url(#spc-blue)"/>` +
    `<path d="M0 164H320V200H0z" fill="#050817" opacity=".85"/><path d="M40 178H280M20 192H300" stroke="#8be6ff" stroke-opacity=".08"/>` +
    // the console projecting the glowing grid
    `<path d="M130 164H190L224 133H96z" fill="url(#spc-beam)"/>` +
    `<rect x="92" y="44" width="136" height="94" rx="14" fill="#5cc8ff" opacity=".28" filter="url(#spc-blur)"/>` +
    `<rect x="98" y="50" width="124" height="82" rx="8" fill="url(#spc-screen)" stroke="#8be6ff" stroke-width="1.4"/>${cards}` +
    `<path d="M102 54h12M102 54v8M218 54h-12M218 54v8M102 128h12M102 128v-8M218 128h-12M218 128v-8" stroke="#bff1ff" stroke-width="1.2" opacity=".8"/>` +
    `<path d="M98 164H222L236 200H84z" fill="url(#spc-desk)"/><path d="M98 164H222" stroke="#8be6ff" stroke-opacity=".75" stroke-width="1.5"/>` +
    `<circle cx="118" cy="184" r="2.6" fill="#ff4d5e"/><circle cx="202" cy="184" r="2.6" fill="#4d94ff"/>` +
    `<g transform="rotate(-5 160 178)"><rect x="140" y="171" width="40" height="13" rx="1.5" fill="#f2d48a"/><rect x="140" y="168.5" width="14" height="4" rx="1" fill="#f2d48a"/><text x="160" y="180.4" ${FONT} font-size="5.6" fill="#c0392b" letter-spacing=".4">TOP SECRET</text></g>` +
    // Red spymaster raises the clue card
    coat(1, 60, 'spc-coatR', '#d8455e', '#4a0d1d', '#e0a57a', '#2a1020', '#1c0b16', '#ff4d5e') +
    `<path d="M80 132Q98 124 104 104" stroke="url(#spc-coatR)" stroke-width="11" stroke-linecap="round" fill="none"/><circle cx="105" cy="100" r="5" fill="#e0a57a"/>` +
    `<g transform="rotate(-10 117 86)"><rect x="98" y="74" width="38" height="22" rx="3" fill="#fffdf3"/><text x="113" y="89" ${FONT} font-size="8.5" fill="#1b2347">MOON</text>` +
    `<circle cx="130.5" cy="85" r="5.5" fill="#ff4d5e"/><text x="130.5" y="88" ${FONT} font-size="7.5" fill="#fff">2</text></g>` +
    // Blue spymaster points at a card
    coat(-1, 260, 'spc-coatB', '#4f84ec', '#0d1d4a', '#9a5d36', '#16224a', '#0a1230', '#4d94ff') +
    `<path d="M240 132Q226 122 220 108" stroke="url(#spc-coatB)" stroke-width="11" stroke-linecap="round" fill="none"/><circle cx="218" cy="105" r="5" fill="#9a5d36"/>` +
    `<path d="M216 102L211.5 97.5" stroke="#9a5d36" stroke-width="3.2" stroke-linecap="round"/><circle cx="208" cy="99" r="7" fill="#ffd166" opacity=".25"/>` +
    `</svg>`;
}

const STYLE = `
/* Night-time operations room: midnight glass over a blueprint grid, a red lamp on one side and a blue one on the other. */
.spy-layout{align-items:start}
.spy-felt{padding:14px 16px 16px;border-color:rgba(120,200,255,.22);
  background:
    radial-gradient(55% 60% at 0% 45%,rgba(255,80,100,.2),transparent 70%),
    radial-gradient(55% 60% at 100% 45%,rgba(70,150,255,.24),transparent 70%),
    radial-gradient(80% 45% at 50% 0%,rgba(120,220,255,.12),transparent 70%),
    repeating-linear-gradient(0deg,rgba(140,200,255,.055) 0 1px,transparent 1px 26px),
    repeating-linear-gradient(90deg,rgba(140,200,255,.055) 0 1px,transparent 1px 26px),
    linear-gradient(180deg,#0c1534 0%,#080e26 65%,#060a1d 100%)}
.spy-felt .winner-banner{display:flex;align-items:center;justify-content:center;gap:10px;padding:2px 0 12px}
.spy-felt .winner-banner .ic{width:1em;height:1em}

/* the desk: counters and the current clue */
.spy-hud{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:stretch}
.spy-score{--tc:#ff5a6a;--tl:#ffb3ba;position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;min-width:84px;padding:8px 10px;border-radius:16px;background:rgba(5,9,28,.65);border:1px solid rgba(255,255,255,.08);transition:border-color .3s}
.spy-score.b{--tc:#4d94ff;--tl:#b8d4ff}
.spy-score i{display:block;width:16px;height:16px;color:var(--tc)}
.spy-score i svg,.spy-card i svg,.spy-note i svg{display:block;width:100%;height:100%}
.spy-score b{display:inline-block;font:700 1.9rem/1 var(--font-display);color:var(--tl)}
.spy-score small{font-size:.62rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);white-space:nowrap}
/* The glow of the team whose turn it is switches at once, as it always has: the counters are kept between
   updates now, and a transition would repaint the blurred shadow on every frame of the fade. */
.spy-score.on{border-color:var(--tc);box-shadow:0 0 0 1px var(--tc),0 0 24px -4px var(--tc)}
.spy-score.win{border-color:var(--gold);background:linear-gradient(180deg,rgba(255,207,92,.22),rgba(5,9,28,.65));box-shadow:0 0 0 1px var(--gold),0 0 24px -4px var(--gold)}
/* A team found one of its agents: its counter flashes and the number pops. The counter is kept between
   updates, so a second find in a row switches to twin keyframes (spy-again) to play the flash again. */
.spy-score.spy-scored b{animation:spy-pop .7s var(--spring) .15s}
.spy-score.spy-scored::after{content:'';position:absolute;inset:-3px;border-radius:18px;pointer-events:none;box-shadow:0 0 0 2px var(--tc),0 0 28px 6px var(--tc);opacity:0;animation:spy-flash 1.3s ease-out .1s}
.spy-score.spy-again b{animation-name:spy-pop2}
.spy-score.spy-again::after{animation-name:spy-flash2}
@keyframes spy-pop{40%{transform:scale(1.45)}}
@keyframes spy-pop2{40%{transform:scale(1.45)}}
@keyframes spy-flash{20%{opacity:.85}}
@keyframes spy-flash2{20%{opacity:.85}}
.spy-bar{--tc:#8a93b5;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;min-width:0;padding:9px 12px;border-radius:16px;text-align:center;background:rgba(5,9,28,.6);border:1px solid rgba(255,255,255,.08);box-shadow:inset 0 3px 0 var(--tc)}
.spy-bar.r{--tc:#ff5a6a}.spy-bar.b{--tc:#4d94ff}
.spy-turn{display:inline-flex;align-items:center;gap:7px;font:700 .76rem/1 var(--font-display);letter-spacing:.12em;text-transform:uppercase;color:#cfd8ff}
.spy-bar.r .spy-turn{color:#ff9ba5}.spy-bar.b .spy-turn{color:#9cc3ff}
.spy-turn svg{width:13px;height:13px;flex:none}.spy-turn .ic{width:16px;height:16px;color:var(--gold)}
.spy-status{display:flex;align-items:center;justify-content:center;gap:8px;font-size:.9rem;font-weight:700;color:#e3e9ff;min-width:0}
.spy-status .spy-face{width:28px;height:28px}
.spy-radar{position:relative;width:18px;height:18px;flex:none;border-radius:50%;overflow:hidden;border:1.5px solid rgba(140,230,255,.6);background:rgba(140,230,255,.08)}
.spy-radar::before{content:'';position:absolute;inset:0;background:conic-gradient(from 0deg,rgba(140,230,255,.9),rgba(140,230,255,0) 30%);animation:spy-sweep 3s linear infinite}
@keyframes spy-sweep{to{transform:rotate(1turn)}}
.spy-slip{display:inline-flex;align-items:center;gap:10px;max-width:100%;padding:5px 6px 5px 14px;border-radius:12px;background:linear-gradient(180deg,#fffef8,#ece7d6);color:var(--ink);box-shadow:inset 0 1px 0 #fff,0 3px 0 rgba(0,0,0,.35),0 0 20px rgba(140,230,255,.15)}
.spy-slip.new{animation:spy-slipin .5s var(--spring)}
@keyframes spy-slipin{from{transform:translateY(-8px) rotate(-4deg) scale(.9);opacity:0}}
.spy-slipword{font:700 1.2rem/1 var(--font-display);letter-spacing:.08em;overflow-wrap:anywhere}
.spy-n{display:grid;place-items:center;flex:none;min-width:30px;height:30px;border-radius:9px;background:var(--tc);color:#fff;font:700 1.05rem/1 var(--font-display)}
.spy-guesses{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:4px 8px;font-size:.74rem;font-weight:800;color:#aebbe6}
.spy-pips{display:flex;flex-wrap:wrap;justify-content:center;gap:4px}
.spy-pips i{width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,.16)}
.spy-pips i.on{background:var(--tc);box-shadow:0 0 6px var(--tc)}
.spy-rolebar{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;margin:12px 2px}
.spy-role{display:inline-flex;align-items:center;gap:6px;padding:4px 12px 4px 9px;border-radius:999px;font-size:.78rem;font-weight:800;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);color:#dfe6ff}
.spy-role.r{border-color:rgba(255,90,106,.55);color:#ffc2c8}.spy-role.b{border-color:rgba(77,148,255,.6);color:#c2d9ff}
.spy-role .ic{width:16px;height:16px}
.spy-hint{font-size:.86rem;color:#aebbe6}

/* the board: a light table with corner brackets */
.spy-board{position:relative;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:9px;padding:14px;border-radius:20px;background:linear-gradient(180deg,rgba(16,30,72,.9),rgba(7,14,40,.92));border:1px solid rgba(120,200,255,.28);box-shadow:inset 0 0 40px rgba(60,160,255,.14),inset 0 1px 0 rgba(255,255,255,.06),0 18px 36px rgba(2,4,16,.55)}
.spy-board::before{content:'';position:absolute;inset:5px;border-radius:15px;pointer-events:none;opacity:.6;
  background:linear-gradient(#8be6ff,#8be6ff) 0 0/16px 2px no-repeat,linear-gradient(#8be6ff,#8be6ff) 0 0/2px 16px no-repeat,
    linear-gradient(#8be6ff,#8be6ff) 100% 0/16px 2px no-repeat,linear-gradient(#8be6ff,#8be6ff) 100% 0/2px 16px no-repeat,
    linear-gradient(#8be6ff,#8be6ff) 0 100%/16px 2px no-repeat,linear-gradient(#8be6ff,#8be6ff) 0 100%/2px 16px no-repeat,
    linear-gradient(#8be6ff,#8be6ff) 100% 100%/16px 2px no-repeat,linear-gradient(#8be6ff,#8be6ff) 100% 100%/2px 16px no-repeat}
.spy-card{position:relative;container-type:inline-size;display:grid;place-items:center;min-width:0;width:100%;aspect-ratio:2/1.1;min-height:0;padding:0 3px;border:0;border-radius:11px;color:var(--ink);text-shadow:none;
  background:linear-gradient(180deg,#ffffff 0%,#edf1fc 60%,#dfe5f7 100%);
  box-shadow:inset 0 1px 0 #fff,inset 0 -2px 0 rgba(27,35,71,.08),0 3px 0 #7f8cc4,0 7px 14px rgba(2,4,16,.45);
  transition:transform .2s var(--ease);-webkit-user-select:none;user-select:none}
.spy-card:hover:not(:disabled){background-color:transparent}
.spy-card span{position:relative;z-index:1;max-width:100%;font:600 clamp(.56rem,14.5cqw,1.02rem)/1.05 var(--font-display);letter-spacing:.04em;text-transform:uppercase;overflow-wrap:anywhere}
.spy-card.long span{font-size:clamp(.5rem,12cqw,.92rem);letter-spacing:.01em}
.spy-card i{position:absolute;top:5px;right:6px;z-index:1;display:block;width:13px;height:13px}
@media(hover:hover){.spy-card.can:hover{transform:translateY(-3px)}}
/* Words you may reveal: a soft scanner rim that breathes in a slow wave across the grid. */
.spy-card.can::after{content:'';position:absolute;inset:-2px;border-radius:13px;pointer-events:none;box-shadow:0 0 0 1.5px rgba(140,225,255,.75),0 0 14px 2px rgba(100,200,255,.4);animation:spy-breathe 2.8s ease-in-out infinite;animation-delay:calc(var(--i,0) * -.11s)}
@keyframes spy-breathe{50%{opacity:.2}}
.spy-card.can:active:not(:disabled){transform:scale(.97)}
/* The word you picked lifts off the table; a second tap reveals it. */
.spy-card.pick{transform:translateY(-7px) scale(1.05);z-index:2;box-shadow:inset 0 1px 0 #fff,0 0 0 3px var(--gold),0 9px 0 -3px #7f8cc4,0 16px 26px rgba(2,4,16,.55)}
.spy-card.pick::after{animation:none;opacity:1;box-shadow:0 0 0 2px rgba(255,207,92,.9),0 0 22px 6px rgba(255,207,92,.45)}
.spy-card.pick:active:not(:disabled){transform:translateY(-4px) scale(1.01)}
/* The spymaster's key */
.spy-card.known.r{background:repeating-linear-gradient(45deg,rgba(255,90,106,.14) 0 6px,transparent 6px 12px),linear-gradient(180deg,#fff1f2,#ffdadd);box-shadow:inset 0 0 0 3px #ff5a6a,0 3px 0 #c6475a,0 7px 14px rgba(2,4,16,.45)}
.spy-card.known.b{background:radial-gradient(circle,rgba(77,148,255,.24) 1.4px,transparent 1.9px) 0 0/9px 9px,linear-gradient(180deg,#eef5ff,#d6e6ff);box-shadow:inset 0 0 0 3px #4d94ff,0 3px 0 #3a6fc4,0 7px 14px rgba(2,4,16,.45)}
.spy-card.known.n{background:linear-gradient(180deg,#f6f5f0,#e3e1d8)}
.spy-card.known.x{background:linear-gradient(180deg,#2a2d3a,#15171f);color:#fff;box-shadow:inset 0 0 0 3px #ff6b81,0 3px 0 #000,0 7px 14px rgba(2,4,16,.5)}
.spy-card.known.r i{color:#e5384a}.spy-card.known.b i{color:#2f7cf0}.spy-card.known.n i{color:#9aa0b8}.spy-card.known.x i{color:#ff6b81}
/* Revealed: who was behind the card, with the team's pattern */
.spy-card.open{color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.5);transform:none;box-shadow:inset 0 2px 10px rgba(0,0,0,.35),0 1px 0 rgba(255,255,255,.08)}
.spy-card.open span{align-self:end;margin-bottom:6%;opacity:.92;font-size:clamp(.5rem,11cqw,.82rem)}
.spy-card.open.r{background:repeating-linear-gradient(45deg,#e84855 0 9px,#d13a48 9px 18px)}
.spy-card.open.b{background:radial-gradient(circle,rgba(255,255,255,.28) 1.6px,transparent 2.2px) 0 0/10px 10px,linear-gradient(180deg,#3d8bff,#2867d6)}
.spy-card.open.n{background:linear-gradient(180deg,#d9d6cb,#bdb9ab);color:#2a2f45;text-shadow:none}
.spy-card.open.x{background:radial-gradient(circle at 50% 45%,#3a1d26,#0d0e14 70%);color:#ffd0d8}
.spy-card.open i{color:#fff;width:14px;height:14px}
.spy-card.open.n i{color:#5b6078}.spy-card.open.x i{color:#ff6b81}
.spy-sil{position:absolute;left:0;top:7%;width:100%;height:58%;fill:currentColor;opacity:.32;pointer-events:none}
.spy-card.open.x .spy-sil{opacity:.9;color:#ff6b81}
/* A fresh reveal: the paper face folds away and the agent appears. The face shows only while it folds; once
   edge-on it is gone (opacity 0) instead of held there, so no 3D layer is left on the card until the next update. */
.spy-card.spy-flip::before{content:'';position:absolute;inset:0;z-index:3;border-radius:inherit;pointer-events:none;background:linear-gradient(180deg,#ffffff,#dfe5f7);opacity:0;animation:spy-flip .45s cubic-bezier(.5,0,.75,.4)}
@keyframes spy-flip{from{opacity:1}to{opacity:1;transform:perspective(500px) rotateY(90deg)}}
.spy-card.spy-flip > *{animation:spy-flipin .4s var(--spring) .38s backwards}
@keyframes spy-flipin{from{transform:scale(.5);opacity:0}}

/* the clue transmitter */
.spy-clue{position:relative;display:flex;flex-wrap:wrap;gap:10px;align-items:end;margin-top:14px;padding:14px;background:linear-gradient(180deg,rgba(20,34,80,.94),rgba(12,22,58,.94));border-color:rgba(120,200,255,.3)}
.spy-clue::after{content:'';position:absolute;inset:-3px;border-radius:21px;pointer-events:none;box-shadow:0 0 0 2px rgba(255,207,92,.6),0 0 22px 2px rgba(255,207,92,.3);animation:spy-breathe 2.8s ease-in-out infinite}
.spy-clue:focus-within::after{animation:none;opacity:.45}
.spy-clue label{display:flex;flex-direction:column;gap:4px}
.spy-clue label.grow{flex:1 1 190px}
.spy-clue button{flex:1 0 auto}
.spy-clue small{color:var(--muted);font-size:.7rem;letter-spacing:.1em;text-transform:uppercase;font-weight:800}
.spy-clue input{min-width:0;width:100%;font-family:var(--font-display);letter-spacing:.05em}
.spy-note{display:flex;flex-wrap:wrap;align-items:center;gap:5px;margin:10px 2px 0;font-size:.86rem;color:var(--muted)}
.spy-note i{display:inline-block;width:13px;height:13px}
.spy-note i.r{color:#ff5a6a}.spy-note i.b{color:#4d94ff}.spy-note i.x{color:#ff6b81}
.spy-actions{margin-top:14px}
#spyGo.spy-ready{box-shadow:inset 0 1px 0 rgba(255,255,255,.28),0 0 0 2px var(--gold),var(--glow-brand)}

/* side: rosters and the mission log */
.spy-side .drawer-body{gap:10px}
.spy-team{--tc:#ff5a6a;--tl:#ffb3ba;padding:10px 12px;border-radius:14px;background:rgba(6,10,30,.35);border:1px solid rgba(255,255,255,.06);box-shadow:inset 3px 0 0 var(--tc)}
.spy-team.b{--tc:#4d94ff;--tl:#b8d4ff}
.spy-team h3{display:flex;align-items:center;gap:7px;margin:0 0 6px;font-size:.98rem;color:var(--tl)}
.spy-team h3 svg{width:13px;height:13px;flex:none;color:var(--tc)}
.spy-teamleft{margin-left:auto;font-family:var(--font-body);font-size:.75rem;font-weight:800;color:var(--muted)}
.spy-member{display:flex;align-items:center;gap:8px;min-height:38px;padding:3px 0;font-size:.9rem}
.spy-member.me .spy-mname{font-weight:800}
.spy-mname{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.spy-face{display:block;width:30px;height:30px;flex:none;border-radius:50%;box-shadow:0 0 0 2px var(--tc),0 2px 6px rgba(0,0,0,.4)}
.spy-face .portrait{width:100%;height:100%;display:block;border-radius:50%}
.spy-tag{background:rgba(255,255,255,.08);color:#e3e9ff;border-color:rgba(255,255,255,.18)}
.spy-clues{display:flex;flex-wrap:wrap;gap:6px}
.spy-clueline{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:10px;font-size:.85rem;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08)}
.spy-clueline svg{width:11px;height:11px;flex:none}
.spy-clueline.r{color:#ffb3ba}.spy-clueline.r svg{color:#ff5a6a}.spy-clueline.b{color:#b8d4ff}.spy-clueline.b svg{color:#4d94ff}
.spy-clueline b{font-family:var(--font-display);font-weight:600;letter-spacing:.05em}
.spy-clueline em{font-style:normal;font-weight:800;color:#fff}

@media(max-width:900px){.spy-felt{padding:10px}}
@media(max-width:640px){
  .spy-hud{gap:6px}
  .spy-score{min-width:56px;padding:6px;border-radius:13px}
  .spy-score b{font-size:1.45rem}
  .spy-score small{font-size:.58rem;letter-spacing:.06em}.spy-score small span{display:none}
  .spy-bar{padding:7px 8px;gap:5px}
  .spy-status{font-size:.8rem;gap:6px}
  .spy-status .spy-face{width:24px;height:24px}
  .spy-slip{gap:8px;padding:4px 5px 4px 10px}.spy-slipword{font-size:1rem}.spy-n{min-width:26px;height:26px;font-size:.95rem}
  .spy-rolebar{margin:10px 0}
  .spy-board{gap:5px;padding:7px;border-radius:14px}
  .spy-board::before{inset:2px;border-radius:12px}
  .spy-card{border-radius:8px;aspect-ratio:auto;height:50px;padding:0 2px}
  .spy-card.can::after{border-radius:10px}
  .spy-card i{top:3px;right:3px;width:9px;height:9px}
  .spy-card.open i{width:10px;height:10px}
}
`;

export default {
  id: 'spies', name: 'Word Spies',
  description: 'Two teams, 25 words, one secret key. Spymasters give one-word clues and teammates hunt for their agents. Avoid the assassin! For 4–8.',
  minPlayers: 4, maxPlayers: 8,
  options: [levelOption()],
  cover: coverSVG(),
  howTo: {
    goal: 'Be the first team to find all of your agents on the board, without ever touching the assassin.',
    turn: [
      ['🕵️', 'Spymasters see the key', 'One player on each team sees which words belong to Red (◆), Blue (●), bystanders (·) and the assassin (✖).'],
      ['💬', 'Give a one-word clue', 'The spymaster types one word and a number, e.g. “OCEAN 3”, meaning three of your words relate to the ocean. The clue can’t be a word on the board.'],
      ['👆', 'Teammates guess', 'Tap a word and confirm to reveal it. Your agent: keep going (up to the number + 1). A bystander or the other team’s agent ends your turn.'],
      ['✖', 'The assassin', 'Reveal the assassin and your team loses immediately.'],
    ],
    tips: ['The first two seats are the spymasters; teams alternate around the table.', 'Talk it over with your teammates before revealing (voice chat helps!).', 'You can end your turn early to play it safe.'],
  },
  setup, act, view, bot, render,
  turnOf: (s) => (s.over ? [] : s.phase === 'clue' ? [spyOf(s, s.turn).id] : s.players.filter((p) => p.team === s.turn && !p.spy).map((p) => p.id)),
};
