// Word Spies: two teams race to find their agents on a grid of 25 words.
// Each team's spymaster sees the secret key and gives one-word clues with a number;
// teammates reveal words. Hitting the other team's word or a bystander ends your turn,
// and the assassin loses the game on the spot.
import { esc, log, addFx, rand, shuffle } from '../js/util.js';
import { injectCSS } from '../js/fx.js';
import { sound } from '../js/sound.js';

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

function setup(players) {
  if (players.length < 4 || players.length > 8) throw Error('Word Spies needs 4–8 players.');
  const first = rand(2) ? 'r' : 'b';
  const seats = shuffle(players.slice());
  const key = shuffle([...Array(9).fill(first), ...Array(8).fill(other(first)), ...Array(7).fill('n'), 'x']);
  const s = {
    phase: 'clue', over: false, winners: [], turn: first, clue: null, left: 0, clues: [], log: [],
    players: seats.map((p, i) => ({ id: p.id, name: p.name, team: i % 2 ? 'b' : 'r', spy: i < 2 })),
    words: shuffle(WORDS.slice()).slice(0, 25), key, open: Array(25).fill(false),
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
function bot(v, pid) {
  const me = v.players.find((p) => p.id === pid);
  const idle = browser ? 0.75 : 0.3;
  if (v.phase === 'clue') {
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
  const list = THEMES[v.clue.word];
  const fits = v.words.map((w, i) => (!v.open[i] && list?.includes(w) ? i : -1)).filter((i) => i >= 0);
  const used = v.clue.n + 1 - v.left;
  if (fits.length && used < v.clue.n) return { type: 'guess', card: fits[rand(fits.length)] };
  if (!list && used === 0) { const hidden = v.open.map((o, i) => (o ? -1 : i)).filter((i) => i >= 0); return { type: 'guess', card: hidden[rand(hidden.length)] }; }
  return { type: 'pass' };
}

/* ---------------- interface ---------------- */

const UI = { pick: null, clue: '', n: 1, key: '' };
const MARK = { r: '◆', b: '●', n: '·', x: '✖' };
const MARK_NAME = { r: 'red agent', b: 'blue agent', n: 'bystander', x: 'assassin' };

function render(el, v, ctx) {
  injectCSS('spies', STYLE);
  const key = v.words.join();
  if (UI.key !== key) Object.assign(UI, { key, pick: null, clue: '', n: 1 });
  const me = v.players.find((p) => p.id === ctx.me);
  const myTurn = !v.over && me && me.team === v.turn;
  const guessing = myTurn && v.phase === 'guess' && !me.spy, cluing = myTurn && v.phase === 'clue' && me.spy;
  if (!guessing || v.open[UI.pick]) UI.pick = null;
  const spy = spyOf(v, v.turn);
  const status = v.over ? `${TEAM[v.winner]} team wins!`
    : v.phase === 'clue' ? (cluing ? 'Your team is waiting for your clue' : `${esc(spy.name)} (${TEAM[v.turn]} spymaster) is thinking of a clue…`)
    : guessing ? `Your clue: <b>${esc(v.clue.word.toUpperCase())}</b> ${v.clue.n} · ${v.left} guess${v.left === 1 ? '' : 'es'} left`
    : `${TEAM[v.turn]} team is guessing <b>${esc(v.clue.word.toUpperCase())}</b> ${v.clue.n}`;
  const team = (t) => `<div class="spy-team ${t}"><h3>${TEAM[t]} · ${agentsLeft(v, t)} left</h3>${v.players.filter((p) => p.team === t).map((p) => `<div class="spy-member ${p.id === ctx.me ? 'me' : ''}">${p.spy ? '🕵️ ' : ''}${esc(p.name)}${p.spy ? ' <small>spymaster</small>' : ''}${p.id === ctx.me ? ' <small>· you</small>' : ''}</div>`).join('')}</div>`;

  el.innerHTML = `<div class="spy-root">
    ${v.over ? `<div class="winner-banner">${me ? (me.team === v.winner ? 'Your team wins!' : `${TEAM[v.winner]} team wins`) : `${TEAM[v.winner]} team wins`}</div>` : ''}
    <div class="spy-bar ${v.turn}"><span class="spy-turn">${v.over ? '🏁' : v.turn === 'r' ? '◆ Red turn' : '● Blue turn'}</span><span class="grow">${status}</span>${me ? `<span class="spy-role">${me.spy ? '🕵️ You are the spymaster' : 'You are an agent'} · ${TEAM[me.team]}</span>` : '<span class="spy-role">👀 Watching</span>'}</div>
    <div class="game-layout">
      <div class="spy-main">
        <div class="spy-board ${me?.spy && !v.over ? 'spymaster' : ''}">${v.words.map((w, i) => {
          const k = v.key[i], open = v.open[i];
          const cls = ['spy-card', open ? 'open ' + k : '', !open && k ? 'known ' + k : '', guessing && !open ? 'can' : '', UI.pick === i ? 'pick' : ''].filter(Boolean).join(' ');
          return `<button class="${cls}" data-card="${i}" data-a="spy-card-${i}" ${guessing && !open ? '' : 'tabindex="-1"'} aria-label="${esc(w)}${k ? ', ' + MARK_NAME[k] : ''}${open ? ', revealed' : ''}">${k ? `<i>${MARK[k]}</i>` : ''}<span>${esc(w)}</span></button>`;
        }).join('')}</div>
        ${cluing ? `<form class="panel spy-clue"><label class="grow"><small>One-word clue</small><input id="spyClue" maxlength="20" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(UI.clue)}" placeholder="e.g. ocean"></label>
          <label><small>Words</small><select id="spyN">${Array.from({ length: 9 }, (_, i) => `<option ${UI.n === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></label><button class="primary">Give clue</button></form>
          <p class="muted small">Your words have the ${v.turn === 'r' ? '◆' : '●'} mark. Avoid the ✖ assassin!</p>` : ''}
        ${guessing ? `<div class="row spy-actions"><button class="primary grow" id="spyGo" ${UI.pick == null ? 'disabled' : ''}>${UI.pick == null ? 'Tap a word, then reveal it' : `Reveal ${esc(v.words[UI.pick].toUpperCase())}`}</button><button id="spyPass">End turn</button></div>` : ''}
      </div>
      <div class="side">
        ${team('r')}${team('b')}
        <div class="panel"><h3 class="gold" style="margin:0 0 6px">Clues</h3>${v.clues.length ? v.clues.slice().reverse().map((c) => `<div class="spy-clueline ${c.team}">${MARK[c.team]} ${esc(c.word.toUpperCase())} <b>${c.n}</b></div>`).join('') : '<p class="muted small" style="margin:0">No clues yet.</p>'}</div>
        <div class="parchment log">${v.log.slice(0, 6).map((l) => `<div>${esc(l)}</div>`).join('')}</div>
      </div>
    </div></div>`;

  el.querySelectorAll('[data-card]').forEach((b) => (b.onclick = () => {
    if (!guessing) return;
    const i = +b.dataset.card;
    if (v.open[i]) return;
    if (UI.pick === i) { UI.pick = null; return ctx.send({ type: 'guess', card: i }); } // a second tap confirms
    UI.pick = i; sound('click'); render(el, v, ctx);
  }));
  el.querySelector('#spyGo')?.addEventListener('click', () => { const i = UI.pick; UI.pick = null; ctx.send({ type: 'guess', card: i }); });
  el.querySelector('#spyPass')?.addEventListener('click', () => ctx.send({ type: 'pass' }));
  const form = el.querySelector('.spy-clue');
  if (form) {
    const input = form.querySelector('#spyClue'), sel = form.querySelector('#spyN');
    input.oninput = () => (UI.clue = input.value);
    sel.onchange = () => (UI.n = +sel.value);
    form.onsubmit = (e) => { e.preventDefault(); ctx.send({ type: 'clue', word: input.value, n: +sel.value }); };
  }
}

const STYLE = `
.spy-bar{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;padding:10px 14px;margin-bottom:12px;border-radius:12px;background:rgba(0,0,0,.35);border-left:5px solid #888}
.spy-bar.r{border-color:#e0604a}.spy-bar.b{border-color:#4b8fe8}
.spy-turn{font-family:var(--font-display);font-weight:800}.spy-bar.r .spy-turn{color:#ff9b88}.spy-bar.b .spy-turn{color:#8fc0ff}
.spy-role{font-size:.8rem;color:var(--muted)}
.spy-board{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;padding:12px;border-radius:16px;background:radial-gradient(120% 90% at 50% 0%,#24407e,#132453 60%,#0b1636);border:1px solid rgba(160,190,255,.22);box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 16px 34px rgba(2,4,16,.5)}
.spy-card{position:relative;min-height:66px;padding:6px 4px;border-radius:10px;font-family:var(--font-display);font-weight:800;font-size:.82rem;letter-spacing:.03em;text-transform:uppercase;color:#1b2347;text-shadow:none;background:linear-gradient(180deg,#ffffff,#e4e9fa);border:1px solid #b9c3e8;box-shadow:0 3px 0 #9aa6d6,0 6px 12px rgba(2,4,16,.35);transition:transform .15s;overflow-wrap:anywhere;line-height:1.1}
.spy-card span{position:relative;z-index:1}
.spy-card i{position:absolute;top:4px;right:6px;font-style:normal;font-size:.95rem;line-height:1}
.spy-card.can:hover{transform:translateY(-2px)}
.spy-card.pick{box-shadow:0 0 0 3px var(--gold),0 3px 0 #9aa6d6,0 0 18px rgba(242,193,78,.6)}
.spy-card.known.r{box-shadow:inset 0 0 0 4px #e0604a,0 3px 0 #9aa6d6}.spy-card.known.b{box-shadow:inset 0 0 0 4px #4b8fe8,0 3px 0 #9aa6d6}
.spy-card.known.x{box-shadow:inset 0 0 0 4px #1d1714,0 3px 0 #9aa6d6}.spy-card.known.r i{color:#c0402c}.spy-card.known.b i{color:#2a6ac8}.spy-card.known.x i{color:#000}
.spy-card.open{color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.6);box-shadow:inset 0 2px 8px rgba(0,0,0,.4)}
.spy-card.open span{opacity:.75}
.spy-card.open.r{background:repeating-linear-gradient(45deg,#d0503c 0 10px,#bf4431 10px 20px)}
.spy-card.open.b{background:repeating-linear-gradient(-45deg,#3d7fd9 0 10px,#336fc4 10px 20px)}
.spy-card.open.n{background:#aab2cf;color:#1b2347;text-shadow:none}
.spy-card.open.x{background:#1d1714}
.spy-card.open i{color:#fff;font-size:1.3rem}
.spy-clue{display:flex;flex-wrap:wrap;gap:8px;align-items:end;margin-top:12px}
.spy-clue label{display:flex;flex-direction:column;gap:4px}.spy-clue small{color:var(--muted);font-size:.7rem;letter-spacing:.1em;text-transform:uppercase}
.spy-clue input{min-width:0;width:100%}
.spy-actions{margin-top:12px}
.spy-team{padding:12px 14px;border-radius:12px;background:rgba(0,0,0,.3);border-left:5px solid}
.spy-team.r{border-color:#e0604a}.spy-team.b{border-color:#4b8fe8}
.spy-team h3{margin:0 0 6px;font-size:.95rem}.spy-team.r h3{color:#ff9b88}.spy-team.b h3{color:#8fc0ff}
.spy-member{font-size:.9rem;padding:2px 0}.spy-member.me{font-weight:800}.spy-member small{color:var(--muted)}
.spy-clueline{font-size:.9rem;padding:2px 0}.spy-clueline.r{color:#ff9b88}.spy-clueline.b{color:#8fc0ff}
@media(max-width:640px){.spy-board{gap:4px;padding:6px;border-width:4px}.spy-card{min-height:54px;font-size:.58rem;padding:4px 2px;letter-spacing:0}.spy-card i{font-size:.7rem;top:2px;right:3px}}
`;

export default {
  id: 'spies', name: 'Word Spies',
  description: 'Two teams, 25 words, one secret key. Spymasters give one-word clues and teammates hunt for their agents. Avoid the assassin! For 4–8.',
  minPlayers: 4, maxPlayers: 8,
  cover: `<svg viewBox="0 0 320 200" role="img" aria-label="A grid of word cards with red and blue agent markers"><defs><linearGradient id="spy-cv" x2="0" y2="1"><stop stop-color="#2c4a3a"/><stop offset="1" stop-color="#0f1c15"/></linearGradient></defs>
    <rect width="320" height="200" fill="url(#spy-cv)"/>${Array.from({ length: 15 }, (_, i) => { const x = 28 + (i % 5) * 54, y = 30 + Math.floor(i / 5) * 50, k = 'rbnrbnxrbnbrnrb'[i];
      return `<rect x="${x}" y="${y}" width="48" height="40" rx="6" fill="${k === 'r' ? '#d0503c' : k === 'b' ? '#3d7fd9' : k === 'x' ? '#1d1714' : '#eadcb4'}" stroke="#6b4a24" stroke-width="1.5"/>${k === 'n' ? `<rect x="${x + 8}" y="${y + 17}" width="32" height="5" rx="2" fill="#8a6a3a"/>` : `<text x="${x + 24}" y="${y + 27}" text-anchor="middle" font-size="16" fill="#fff">${{ r: '◆', b: '●', x: '✖' }[k]}</text>`}`; }).join('')}
    <g transform="translate(250 150)"><circle r="26" fill="#1d1714" stroke="#f2c14e" stroke-width="3"/><path d="M-16-4h32l-4-10h-24z" fill="#f2c14e"/><rect x="-20" y="-6" width="40" height="5" fill="#f2c14e"/><circle cx="-8" cy="8" r="5" fill="none" stroke="#f2c14e" stroke-width="2.5"/><circle cx="8" cy="8" r="5" fill="none" stroke="#f2c14e" stroke-width="2.5"/></g></svg>`,
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
