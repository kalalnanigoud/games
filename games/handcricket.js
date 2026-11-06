// Hand Cricket, the school-yard odd–eve game for two. A toss first: one player calls Odd or Even, both throw
// out 1–6 fingers and the parity of the sum decides; the winner chooses to bat or bowl. Then every ball the
// batter and the bowler secretly pick 1–6 at the same moment: the same number is OUT, otherwise the batter
// scores their own number. The second innings chases the first score + 1.
import { esc, log, addFx, rand, PLAYER_COLORS } from '../js/util.js';
import { injectCSS, morph } from '../js/fx.js';
import { sound } from '../js/sound.js';
import { icon } from '../js/icons.js';
import { portrait } from '../js/avatar.js';
import { levelOption, levelOf } from '../js/levels.js';

const OVERS = [1, 2, 5], WICKETS = [1, 2, 3];
const NUMS = [1, 2, 3, 4, 5, 6];
const isNum = (n) => Number.isInteger(n) && n >= 1 && n <= 6;

function setup(players, opts = {}) {
  if (players.length !== 2) throw Error('Hand Cricket is for exactly two players.');
  const overs = OVERS.includes(Number(opts.overs)) ? Number(opts.overs) : 1;
  const wickets = WICKETS.includes(Number(opts.wickets)) ? Number(opts.wickets) : 1;
  const caller = players[rand(2)].id;
  const s = {
    phase: 'call', over: false, winners: [], log: [], level: levelOf(opts), overs, wickets,
    players: players.map((p, i) => ({ id: p.id, name: p.name, seat: i })),
    caller, call: null, picks: {}, toss: null, tossWinner: null,
    inn: 0, innings: [], balls: [], result: '',
  };
  for (const p of s.players) s.picks[p.id] = null;
  log(s, `${s.players.find((p) => p.id === caller).name} calls the toss: Odd or Even?`);
  return s;
}

const player = (s, pid) => s.players.find((p) => p.id === pid);
const other = (s, pid) => s.players.find((p) => p.id !== pid).id;
const nameOf = (s, pid) => player(s, pid)?.name || '?';
const totalBalls = (s) => s.overs * 6;
const target = (s) => (s.innings[0] ? s.innings[0].runs + 1 : null);
const clearPicks = (s) => { for (const p of s.players) s.picks[p.id] = null; };

function startInnings(s, bat) {
  s.innings.push({ bat, bowl: other(s, bat), runs: 0, wkts: 0, balls: 0 });
  s.inn = s.innings.length - 1;
  clearPicks(s);
}

function finish(s) {
  const [a, b] = s.innings;
  s.over = true; s.phase = 'over';
  if (b.runs > a.runs) {
    s.winners = [b.bat];
    const left = s.wickets - b.wkts;
    s.result = `${nameOf(s, b.bat)} wins by ${left} wicket${left === 1 ? '' : 's'}!`;
  } else if (b.runs === a.runs) {
    s.winners = [a.bat, b.bat];
    s.result = `It's a tie: both scored ${a.runs}.`;
  } else {
    s.winners = [a.bat];
    const by = a.runs - b.runs;
    s.result = `${nameOf(s, a.bat)} wins by ${by} run${by === 1 ? '' : 's'}!`;
  }
  log(s, s.result);
}

function bowlBall(s) {
  const inn = s.innings[s.inn];
  const b = s.picks[inn.bat], w = s.picks[inn.bowl];
  const out = b === w;
  inn.balls++;
  if (out) inn.wkts++; else inn.runs += b;
  s.balls.push({ inn: s.inn, bat: inn.bat, bowl: inn.bowl, b, w, out });
  clearPicks(s);
  log(s, out ? `${nameOf(s, inn.bat)} ${b}, ${nameOf(s, inn.bowl)} ${w}: OUT! (${inn.runs}/${inn.wkts})` : `${nameOf(s, inn.bat)} ${b}, ${nameOf(s, inn.bowl)} ${w}: +${b} (${inn.runs}/${inn.wkts})`);
  addFx(s, out ? { kind: 'shake', at: 'hc-score', sound: 'bad' } : { kind: 'float', at: 'hc-score', text: `+${b}`, color: '#ffd76a', sound: b >= 4 ? 'coin' : 'place' });
  const t = target(s);
  if (s.inn === 1 && inn.runs >= t) return finish(s);
  if (inn.wkts >= s.wickets || inn.balls >= totalBalls(s)) {
    if (s.inn === 1) return finish(s);
    const nt = inn.runs + 1;
    log(s, `Innings break. ${nameOf(s, inn.bowl)} needs ${nt} run${nt === 1 ? '' : 's'} from ${totalBalls(s)} balls.`);
    addFx(s, { kind: 'sound', sound: 'turn' });
    startInnings(s, inn.bowl);
  }
}

function act(s, pid, a) {
  const me = player(s, pid);
  if (!me) throw Error('Only the two players can do that.');
  if (!a || typeof a !== 'object') throw Error('Unknown move.');
  if (s.over) throw Error('The match is over.');
  if (s.phase === 'call') {
    if (pid !== s.caller) throw Error(`${nameOf(s, s.caller)} calls the toss.`);
    if (a.type !== 'call' || !['odd', 'even'].includes(a.parity)) throw Error('Call Odd or Even.');
    s.call = a.parity; s.phase = 'toss'; clearPicks(s);
    log(s, `${me.name} calls ${a.parity === 'odd' ? 'Odd' : 'Even'}. Both throw a number for the toss.`);
    return;
  }
  if (s.phase === 'choose') {
    if (pid !== s.tossWinner) throw Error(`${nameOf(s, s.tossWinner)} won the toss and chooses.`);
    if (a.type !== 'choose' || !['bat', 'bowl'].includes(a.choice)) throw Error('Choose to bat or to bowl.');
    s.phase = 'play';
    startInnings(s, a.choice === 'bat' ? pid : other(s, pid));
    log(s, `${me.name} chooses to ${a.choice}. ${nameOf(s, s.innings[0].bat)} bats first.`);
    addFx(s, { kind: 'sound', sound: 'turn' });
    return;
  }
  // 'toss' and 'play': both pick at the same time.
  if (a.type !== 'pick') throw Error(s.phase === 'toss' ? 'Pick a number for the toss.' : 'Pick a number from 1 to 6.');
  if (!isNum(a.n)) throw Error('Pick a number from 1 to 6.');
  if (s.picks[pid] != null) throw Error('You have picked. Waiting for the other player.');
  s.picks[pid] = a.n;
  if (s.players.some((p) => s.picks[p.id] == null)) return;
  if (s.phase === 'toss') {
    const ca = s.picks[s.caller], ot = s.picks[other(s, s.caller)], sum = ca + ot;
    const parity = sum % 2 ? 'odd' : 'even';
    const winner = parity === s.call ? s.caller : other(s, s.caller);
    s.toss = { call: s.call, caller: s.caller, a: ca, b: ot, sum, winner };
    s.tossWinner = winner; s.phase = 'choose'; clearPicks(s);
    log(s, `Toss: ${ca} + ${ot} = ${sum}, ${parity === 'odd' ? 'Odd' : 'Even'}. ${nameOf(s, winner)} wins the toss.`);
    addFx(s, { kind: 'sound', sound: 'flip' });
    return;
  }
  bowlBall(s);
}

function turnOf(s) {
  if (s.over) return [];
  if (s.phase === 'call') return [s.caller];
  if (s.phase === 'choose') return [s.tossWinner];
  // The site also calls this on a player's view, which has only who has picked (picked), never the numbers.
  const hasPicked = (id) => (s.picks ? s.picks[id] != null : !!s.picked?.[id]);
  return s.players.filter((p) => !hasPicked(p.id)).map((p) => p.id);
}

// Nobody sees the other player's number for the current ball (or toss) until both have picked:
// the view only says who has picked, and gives you back your own number.
function view(s, pid) {
  const v = JSON.parse(JSON.stringify(s));
  v.picked = Object.fromEntries(s.players.map((p) => [p.id, s.picks[p.id] != null]));
  v.myPick = player(s, pid) ? s.picks[pid] : null;
  delete v.picks;
  return v;
}

// ---------------- computer players ----------------
// Easy throws any number, though like most beginners it often throws the same number again.
// Normal leans a little towards big shots when batting.
// Hard watches the other player: it estimates what they will throw from how often they throw each number
// and how often they repeat themselves. As batter it goes big but avoids what the bowler is likely to throw,
// and takes exactly the runs it needs when a chase is close; as bowler it throws what the batter is likely to.
const weighted = (w) => {
  const sum = w.reduce((a, b) => a + b, 0);
  let r = Math.random() * sum;
  for (let i = 0; i < w.length; i++) { r -= w[i]; if (r < 0) return i + 1; }
  return w.length;
};
const anyNum = () => 1 + Math.floor(Math.random() * 6);
const argmaxPick = (w) => { const top = Math.max(...w); const best = NUMS.filter((n, i) => w[i] >= top - 1e-9); return best[Math.floor(Math.random() * best.length)]; };
// Everything a player has thrown in a role (bat or bowl), oldest first.
const thrown = (v, pid, asBatter) => v.balls.filter((b) => (asBatter ? b.bat === pid : b.bowl === pid)).map((b) => (asBatter ? b.b : b.w));

// The chance that a player with this history throws each number next. prior: a starting guess (weights).
function predict(seq, prior) {
  const recent = seq.slice(-12), ps = prior.reduce((a, b) => a + b, 0), k = 3; // a firm prior: chance alone barely moves it
  const base = NUMS.map((n, i) => (recent.filter((x) => x === n).length + (k * 6 * prior[i]) / ps) / (recent.length + k * 6));
  // Repeats beyond the 1 in 6 that chance gives.
  let rep = 0, tr = 0;
  for (let i = Math.max(1, seq.length - 12); i < seq.length; i++) { tr++; if (seq[i] === seq[i - 1]) rep++; }
  const r = (rep + 1) / (tr + 6), extra = Math.max(0, (r - 1 / 6) / (5 / 6)), last = seq[seq.length - 1];
  return NUMS.map((n, i) => (n === last ? extra : 0) + (1 - extra) * base[i]);
}

function hardPick(v, pid) {
  const inn = v.innings[v.inn];
  const batting = inn.bat === pid, opp = batting ? inn.bowl : inn.bat;
  const need = v.inn === 1 ? v.innings[0].runs + 1 - inn.runs : Infinity;
  if (batting) {
    const p = predict(thrown(v, opp, false), [1, 1, 1, 1, 1, 1]);
    // Expected value of each number: its runs (or the match, in a close chase) times the chance it isn't matched.
    const val = NUMS.map((n, i) => (need <= 6 && n >= need ? 12 : n) * (1 - p[i]));
    return Math.random() < 0.9 ? argmaxPick(val) : weighted(val.map((x) => x * x * x));
  }
  // Bowling: batters love big shots until they show otherwise; in a close chase they must hit at least the need.
  const p = predict(thrown(v, opp, true), [0.6, 0.7, 0.8, 1, 1.2, 1.4]);
  const w = NUMS.map((n, i) => p[i] * (need <= 6 && n >= need ? 2 : need <= 6 ? 0.5 : 1));
  return Math.random() < 0.75 ? argmaxPick(w) : weighted(w.map((x) => x * x));
}

function pickFor(v, pid, level) {
  if (v.phase === 'toss') return anyNum();
  const batting = v.innings[v.inn].bat === pid;
  if (level === 'easy') {
    const mine = thrown(v, pid, batting);
    return mine.length && Math.random() < 0.35 ? mine[mine.length - 1] : anyNum();
  }
  if (level === 'hard') return hardPick(v, pid);
  return batting ? weighted([0.8, 0.9, 1, 1.1, 1.2, 1.3]) : anyNum();
}

function bot(v, pid) {
  const level = v.level === 'easy' || v.level === 'hard' ? v.level : 'normal';
  if (v.phase === 'call') return { type: 'call', parity: Math.random() < 0.5 ? 'odd' : 'even' };
  if (v.phase === 'choose') {
    // Hard chases (it knows exactly what it needs); Normal likes to bat; Easy flips a coin.
    const choice = level === 'hard' ? 'bowl' : level === 'normal' ? 'bat' : Math.random() < 0.5 ? 'bat' : 'bowl';
    return { type: 'choose', choice };
  }
  return { type: 'pick', n: pickFor(v, pid, level) };
}
// Time's up: a gentle default. Odd for the toss call, bat if you won it, any number otherwise.
function onTimeout(v) {
  if (v.phase === 'call') return { type: 'call', parity: 'odd' };
  if (v.phase === 'choose') return { type: 'choose', choice: 'bat' };
  return { type: 'pick', n: anyNum() };
}

// ---------------- screen ----------------
const UI = { logOpen: false };

// A hand throwing n: 1–4 raised fingers, 5 an open hand, 6 a thumbs-up (the school-yard way).
// paint(kind) gives each part its look: CSS classes in the game, plain fills on the cover.
const CLASSES = (k) => `class="${{ skin: 'hc-skin', fold: 'hc-skin hc-fold', line: 'hc-nail', cuff: 'hc-cuff' }[k]}"`;
function handShapes(n, paint = CLASSES) {
  const up = { 1: [1, 0, 0, 0], 2: [1, 1, 0, 0], 3: [1, 1, 1, 0], 4: [1, 1, 1, 1], 5: [1, 1, 1, 1] }[n] || [0, 0, 0, 0];
  const xs = [15, 23.5, 32, 40.5], tops = [8, 3, 6, 13], S = paint('skin'), L = paint('line');
  const fingers = xs.map((x, i) => (up[i]
    ? `<rect ${S} x="${x}" y="${tops[i]}" width="8" height="${36 - tops[i]}" rx="4"/><path ${L} d="M${x + 2} ${tops[i] + 4.5}h4"/>`
    : `<rect ${S} x="${x}" y="22" width="8" height="12" rx="4"/>`)).join('');
  const thumbBehind = n === 5 ? `<rect ${S} x="4" y="26" width="8.5" height="22" rx="4.25" transform="rotate(-38 8 44)"/>`
    : n === 6 ? `<rect ${S} x="7" y="4" width="9.5" height="34" rx="4.75"/><path ${L} d="M9.5 9h4.5"/>` : '';
  const thumbFolded = n >= 0 && n <= 4 ? `<rect ${paint('fold')} x="12" y="37" width="22" height="8" rx="4"/>` : '';
  const knuckles = n === 6 || n === 0 ? `<path ${L} d="M23.5 33v-3M32 33v-3M40.5 33v-3"/>` : '';
  return `${thumbBehind}${fingers}<rect ${S} x="12" y="27" width="38" height="29" rx="11"/>${knuckles}${thumbFolded}<rect ${paint('cuff')} x="17" y="54" width="28" height="10" rx="3"/>`;
}
const hand = (n, cls = '') => `<svg class="hc-hand ${cls}" viewBox="0 0 60 66" aria-hidden="true">${handShapes(n)}</svg>`;
const FIST = hand(0);
const BAT = '<svg class="hc-role-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l2-2" stroke="#3b2414" stroke-width="3" stroke-linecap="round"/><rect x="9" y="1.5" width="6" height="15" rx="2.5" transform="rotate(45 12 9)" fill="#f2cf8d" stroke="#8a5a2b" stroke-width="1.2"/></svg>';
const BALL = '<svg class="hc-role-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="#d9363e" stroke="#7a1218" stroke-width="1.2"/><path d="M7 5.5q5 6.5 0 13M17 5.5q-5 6.5 0 13" fill="none" stroke="#fff" stroke-width="1.1" stroke-dasharray="1.6 1.4"/></svg>';

const oversOf = (b) => `${Math.floor(b / 6)}.${b % 6}`;
const ballChip = (b, k) => `<span class="hc-ball ${b.out ? 'out' : ''}" data-k="hc-b-${k}"><b>${b.b}</b><i>vs</i><b>${b.w}</b><em>${b.out ? 'OUT' : '+' + b.b}</em></span>`;

function render(el, v, ctx) {
  injectCSS('handcricket', STYLE);
  const me = v.players.find((p) => p.id === ctx.me);
  const meId = me ? me.id : null;
  const due = v.over ? [] : v.phase === 'call' ? [v.caller] : v.phase === 'choose' ? [v.tossWinner] : v.players.filter((p) => !v.picked[p.id]).map((p) => p.id);
  const myMove = !!meId && due.includes(meId);
  const inn = v.innings[v.inn] || null;
  const tgt = v.innings[0] && v.inn === 1 ? v.innings[0].runs + 1 : null;
  const total = v.overs * 6;
  const N = (id) => esc(v.players.find((p) => p.id === id)?.name || '?');
  const you = (id) => (id === meId ? 'You' : N(id));
  const color = (p) => PLAYER_COLORS[p.seat % PLAYER_COLORS.length];
  const face = (p) => `<span class="hc-face" style="--pc:${color(p)}">${portrait({ id: p.id, bot: !!ctx.isBot?.(p.id) })}</span>`;
  const lastBall = v.balls[v.balls.length - 1] || null;
  const innBalls = inn ? v.balls.filter((b) => b.inn === v.inn) : [];
  const shown = innBalls.length ? innBalls : v.balls.filter((b) => b.inn === v.inn - 1);

  // ---- status / hint ----
  let status, hint = '';
  if (v.over) status = v.winners.length === 2 ? "It's a tie!" : v.winners.includes(meId) ? 'You win the match!' : `${N(v.winners[0])} wins the match!`;
  else if (v.phase === 'call') { status = myMove ? 'You call the toss: Odd or Even?' : `${N(v.caller)} is calling the toss…`; hint = 'Then both throw a number; the sum decides.'; }
  else if (v.phase === 'toss') {
    status = myMove ? 'Toss: throw a number' : meId ? `Waiting for ${N(due[0])}…` : 'Both are throwing for the toss…';
    hint = `${you(v.caller)} called ${v.call === 'odd' ? 'Odd' : 'Even'}. If the sum is ${v.call === 'odd' ? 'odd' : 'even'}, ${v.caller === meId ? 'you win' : N(v.caller) + ' wins'} the toss.`;
  } else if (v.phase === 'choose') { status = myMove ? 'You won the toss! Bat or bowl?' : `${N(v.tossWinner)} won the toss and is choosing…`; hint = 'Bowling first means you chase a known target.'; }
  else {
    const batting = inn.bat === meId;
    status = myMove ? (batting ? 'You are batting: throw a number' : 'You are bowling: throw a number') : meId ? `Waiting for ${N(due[0])}…` : `${N(inn.bat)} bats, ${N(inn.bowl)} bowls`;
    hint = batting ? 'A different number from the bowler scores that many runs. The same number is OUT!' : meId ? 'Match the batter’s number to take a wicket.' : '';
  }

  // ---- scoreboard ----
  const left = inn ? total - inn.balls : total;
  const need = tgt != null ? tgt - inn.runs : null;
  const rrr = need != null && left > 0 ? (need / (left / 6)).toFixed(1) : null;
  const board = inn ? `<div class="hc-board" data-a="hc-score">
      <div class="hc-board-top"><span>${v.inn === 0 ? '1st innings' : '2nd innings'}</span><span>${BAT}${N(inn.bat)}</span></div>
      <div class="hc-runs"><b>${inn.runs}</b><span>/</span><b>${inn.wkts}</b></div>
      <div class="hc-board-row"><span><small>Overs</small>${oversOf(inn.balls)} / ${v.overs}</span><span><small>Wickets</small>${inn.wkts} / ${v.wickets}</span>${tgt != null ? `<span><small>Target</small>${tgt}</span>` : `<span><small>Balls left</small>${left}</span>`}</div>
      ${tgt != null && !v.over ? `<div class="hc-chase">Need <b>${Math.max(0, need)}</b> from <b>${left}</b> ball${left === 1 ? '' : 's'}${rrr != null ? ` · Req. rate <b>${rrr}</b>` : ''}</div>` : ''}
    </div>` : `<div class="hc-board hc-board-toss" data-a="hc-score"><div class="hc-board-top"><span>The toss</span><span>${v.overs} over${v.overs > 1 ? 's' : ''} · ${v.wickets} wicket${v.wickets > 1 ? 's' : ''}</span></div>
      ${v.toss ? `<div class="hc-tossres">${v.toss.a} + ${v.toss.b} = <b>${v.toss.sum}</b> <span class="tag t-good">${v.toss.sum % 2 ? 'Odd' : 'Even'}</span></div><div class="hc-chase">${you(v.toss.winner)} won the toss</div>` : v.call ? `<div class="hc-tossres">${you(v.caller)} called <b>${v.call === 'odd' ? 'Odd' : 'Even'}</b></div>` : '<div class="hc-tossres">Odd or Even?</div>'}</div>`;

  // ---- the two players facing each other ----
  const side = (p) => {
    const role = inn ? (inn.bat === p.id ? 'bat' : 'bowl') : null;
    const waiting = !v.over && (v.phase === 'toss' || v.phase === 'play');
    const picked = waiting && v.picked[p.id];
    let shownHand = '';
    const mine = p.id === meId && v.myPick != null;
    if (mine) shownHand = `<div class="hc-throw mine">${hand(v.myPick)}<b>${v.myPick}</b></div>`;
    else if (picked) shownHand = `<div class="hc-throw ready">${FIST}<b>${icon('check')}</b></div>`;
    else if (waiting) shownHand = '<div class="hc-throw think"><span class="hc-dots"><i></i><i></i><i></i></span></div>';
    else if (v.phase === 'choose' && v.toss) { const n = p.id === v.toss.caller ? v.toss.a : v.toss.b; shownHand = `<div class="hc-throw">${hand(n)}<b>${n}</b></div>`; }
    return `<div class="hc-side ${due.includes(p.id) ? 'turn' : ''} ${v.winners.includes(p.id) ? 'win' : ''}" data-a="hc-p-${p.id}">
      ${face(p)}<div class="hc-side-name"><b>${esc(p.name)}</b>${p.id === meId ? '<span class="tag t-you">You</span>' : ''}</div>
      <div class="hc-role">${role === 'bat' ? `${BAT}<span>Batting</span>` : role === 'bowl' ? `${BALL}<span>Bowling</span>` : v.phase === 'call' && p.id === v.caller ? '<span>Calling</span>' : v.toss && p.id === v.tossWinner ? '<span>Won the toss</span>' : '<span>&nbsp;</span>'}</div>
      ${shownHand}
    </div>`;
  };
  const order = inn ? [inn.bat, inn.bowl].map((id) => v.players.find((p) => p.id === id)) : v.players;
  const flash = lastBall && innBalls.length ? `<div class="hc-clash hc-pop${v.balls.length % 2} ${lastBall.out ? 'out' : ''}" aria-live="polite">
      <div class="hc-clash-h">${hand(lastBall.b, 'l')}<small>${N(lastBall.bat)}</small></div>
      <div class="hc-verdict">${lastBall.out ? 'OUT!' : '+' + lastBall.b}</div>
      <div class="hc-clash-h">${hand(lastBall.w, 'r')}<small>${N(lastBall.bowl)}</small></div></div>`
    : v.inn === 1 && !innBalls.length && v.innings[0] ? `<div class="hc-clash"><div class="hc-verdict small">Target ${v.innings[0].runs + 1}</div></div>` : '';

  // ---- controls ----
  let controls = '';
  if (myMove && v.phase === 'call') controls = `<div class="hc-two"><button class="primary" data-call="odd"><b>Odd</b><small>1 · 3 · 5</small></button><button class="primary" data-call="even"><b>Even</b><small>2 · 4 · 6</small></button></div>`;
  else if (myMove && v.phase === 'choose') controls = `<div class="hc-two"><button class="primary" data-choose="bat">${BAT}<b>Bat</b></button><button class="primary" data-choose="bowl">${BALL}<b>Bowl</b></button></div>`;
  else if (meId && !v.over && (v.phase === 'toss' || v.phase === 'play')) {
    controls = `<div class="hc-pad ${myMove ? 'live' : 'done'}">${NUMS.map((n) => `<button class="hc-num ${v.myPick === n ? 'sel' : ''} ${myMove ? 'pulse-glow' : ''}" data-n="${n}" aria-label="Throw ${n}" ${myMove ? '' : 'disabled'}>${hand(n)}<b>${n}</b></button>`).join('')}</div>`;
  } else if (!meId && !v.over) controls = `<div class="panel hc-watch">${icon('eye')}<span>You are watching. Numbers show once both have thrown.</span></div>`;

  const recent = shown.slice(-6).map((b, i) => ballChip(b, `${b.inn}-${shown.length - Math.min(6, shown.length) + i}`)).join('');
  const innSummary = v.innings.map((x, i) => `<div class="hc-inn ${i === v.inn && !v.over ? 'now' : ''}"><span>${i === 0 ? '1st' : '2nd'}</span><b>${N(x.bat)}</b><em>${x.runs}/${x.wkts}</em><small>${oversOf(x.balls)} ov</small></div>`).join('');
  UI.logOpen = el.querySelector('.hc-logbox')?.open ?? UI.logOpen;

  morph(el, `<div class="hc-root"><div class="game-layout">
    <div class="felt hc-felt">
      ${v.over ? `<div class="winner-banner">${icon('trophy')}${esc(v.result)}</div>` : ''}
      <p class="hc-status">${status}</p>
      ${board}
      <div class="hc-face-off">${side(order[0])}<span class="hc-vs">vs</span>${side(order[1])}</div>
      ${flash}
      ${hint ? `<p class="hc-hint">${hint}</p>` : ''}
      ${controls}
      ${recent ? `<div class="hc-recent"><small>${innBalls.length ? 'This innings' : 'Last innings'}</small><div>${recent}</div></div>` : ''}
    </div>
    <div class="side">
      <div class="panel hc-card"><h3>${icon('book')}Scorecard</h3>${innSummary || '<p class="muted small" style="margin:0">The toss comes first.</p>'}
        <p class="muted small hc-rules">${v.overs} over${v.overs > 1 ? 's' : ''} (${total} balls) and ${v.wickets} wicket${v.wickets > 1 ? 's' : ''} an innings.</p></div>
      <details class="panel drawer hc-logbox" ${UI.logOpen ? 'open' : ''}><summary>${icon('book')}<span>Ball by ball</span>${icon('chevron', 'chev')}</summary>
        <div class="drawer-body"><div class="parchment log">${v.log.slice(0, 14).map((l) => `<div>${esc(l)}</div>`).join('')}</div></div></details>
    </div>
  </div></div>`);

  const lb = el.querySelector('.hc-logbox'); if (lb) lb.ontoggle = () => { UI.logOpen = lb.open; };
  el.querySelectorAll('[data-n]').forEach((b) => (b.onclick = () => { if (!myMove) return; sound('click'); ctx.send({ type: 'pick', n: +b.dataset.n }); }));
  el.querySelectorAll('[data-call]').forEach((b) => (b.onclick = () => ctx.send({ type: 'call', parity: b.dataset.call })));
  el.querySelectorAll('[data-choose]').forEach((b) => (b.onclick = () => ctx.send({ type: 'choose', choice: b.dataset.choose })));
}

const STYLE = `
.hc-felt{display:flex;flex-direction:column;align-items:center;gap:12px;background:
  radial-gradient(60% 40% at 50% 0%,rgba(255,240,180,.22),transparent 70%),
  linear-gradient(90deg,transparent 41%,rgba(214,182,120,.22) 41% 59%,transparent 59%),
  repeating-linear-gradient(180deg,#2f8a4a 0 34px,#2a7d43 34px 68px)}
.hc-felt .winner-banner{display:flex;align-items:center;gap:10px}.hc-felt .winner-banner .ic{width:1em;height:1em}
.hc-status{margin:0;font:700 1.15rem var(--font-display);color:#fff;text-align:center;text-shadow:0 2px 0 rgba(0,0,0,.25)}
.hc-hint{margin:0;color:#eafbe9;font-weight:700;text-align:center;max-width:40ch;font-size:.92rem}
.hc-board{width:min(100%,440px);padding:10px 14px 12px;border-radius:16px;background:linear-gradient(180deg,#1c2b22,#0f1a14);border:3px solid #6b4a2a;box-shadow:inset 0 2px 0 rgba(255,255,255,.08),0 12px 24px rgba(0,0,0,.35);color:#f4f7ef}
.hc-board-top{display:flex;justify-content:space-between;align-items:center;gap:8px;font-weight:800;font-size:.8rem;letter-spacing:.06em;text-transform:uppercase;color:#bfe6c4}
.hc-board-top span{display:flex;align-items:center;gap:6px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hc-role-ic{width:20px;height:20px;flex:none}
.hc-runs{display:flex;justify-content:center;align-items:baseline;gap:4px;font:700 3rem/1.1 var(--font-display);color:#ffe27a}
.hc-runs span{color:#9fb3a4;font-size:2rem}
.hc-board-row{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;text-align:center;font:700 1.05rem var(--font-display)}
.hc-board-row small{display:block;font:800 .66rem var(--font-body);letter-spacing:.08em;text-transform:uppercase;color:#9fb3a4}
.hc-chase{margin-top:8px;text-align:center;font-weight:800;color:#fff;background:rgba(255,226,122,.12);border-radius:10px;padding:5px 8px}
.hc-chase b{color:#ffe27a}
.hc-tossres{text-align:center;font:700 1.5rem var(--font-display);margin:8px 0 2px;color:#ffe27a}.hc-tossres .tag{vertical-align:middle}
.hc-face-off{display:grid;grid-template-columns:1fr auto 1fr;align-items:start;gap:8px;width:min(100%,440px)}
.hc-vs{align-self:center;font:700 1.1rem var(--font-display);color:#fff;opacity:.8}
.hc-side{display:flex;flex-direction:column;align-items:center;gap:4px;padding:10px 6px;border-radius:16px;background:rgba(0,0,0,.18);border:2px solid transparent;min-width:0}
.hc-side.turn{border-color:rgba(255,226,122,.7)}
.hc-side.win{background:rgba(255,215,106,.22)}
.hc-face{display:block;width:52px;height:52px;border-radius:50%;overflow:hidden;box-shadow:0 0 0 3px var(--pc)}.hc-face svg{display:block;width:100%;height:100%}
.hc-side-name{display:flex;align-items:center;gap:6px;max-width:100%}.hc-side-name b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hc-role{display:flex;align-items:center;gap:5px;font-size:.8rem;font-weight:800;color:#d8f5d6;min-height:20px}
.hc-throw{position:relative;display:grid;place-items:center;width:64px;height:70px}
.hc-throw .hc-hand{width:56px;height:62px}
.hc-throw b{position:absolute;right:-4px;bottom:-2px;display:grid;place-items:center;min-width:26px;height:26px;border-radius:50%;background:#ffe27a;color:#2a1a00;font:700 .95rem var(--font-display);box-shadow:0 2px 6px rgba(0,0,0,.3)}
.hc-throw b .ic{width:16px;height:16px}
.hc-throw.ready b{background:#3ee0a1}
.hc-throw.think{opacity:.8}
.hc-dots{display:flex;gap:6px}.hc-dots i{width:9px;height:9px;border-radius:50%;background:#fff;animation:hc-dot 1.2s ease-in-out infinite}
.hc-dots i:nth-child(2){animation-delay:.2s}.hc-dots i:nth-child(3){animation-delay:.4s}
@keyframes hc-dot{0%,100%{opacity:.25;transform:translateY(0)}50%{opacity:1;transform:translateY(-4px)}}
.hc-hand .hc-skin{fill:#f1c08f;stroke:#8a5a35;stroke-width:1.4}
.hc-hand .hc-fold{fill:#e7b07c}
.hc-hand .hc-nail,.hc-hand .hc-crease{fill:none;stroke:#b97f52;stroke-width:1.2;stroke-linecap:round}
.hc-hand .hc-cuff{fill:#3b6fd6;stroke:#1f3f86;stroke-width:1.2}
.hc-clash{display:flex;align-items:center;justify-content:center;gap:12px;padding:8px 14px;border-radius:18px;background:rgba(255,255,255,.12);min-height:64px}
.hc-clash.out{background:rgba(214,54,62,.35)}
.hc-pop0{animation:hc-pop .4s ease-out}.hc-pop1{animation:hc-pop2 .4s ease-out}
@keyframes hc-pop{from{transform:scale(.85);opacity:.4}to{transform:none;opacity:1}}
@keyframes hc-pop2{from{transform:scale(.85);opacity:.4}to{transform:none;opacity:1}}
.hc-clash-h{display:flex;flex-direction:column;align-items:center;gap:2px}.hc-clash-h small{font-weight:800;color:#eafbe9;max-width:9ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hc-clash .hc-hand{width:44px;height:48px}.hc-clash .hc-hand.r{transform:scaleX(-1)}
.hc-verdict{font:700 1.9rem var(--font-display);color:#ffe27a;min-width:3ch;text-align:center}
.hc-clash.out .hc-verdict{color:#fff;letter-spacing:.04em}
.hc-verdict.small{font-size:1.3rem}
.hc-pad{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;width:min(100%,520px)}
.hc-num{position:relative;display:flex;flex-direction:column;align-items:center;gap:2px;min-height:84px;padding:6px 2px 4px;border-radius:16px;border:2px solid #e9dcc0;background:linear-gradient(180deg,#fffaf0,#f1e4c8);color:#2a1a00;box-shadow:0 4px 0 #b99c6a,0 8px 14px rgba(0,0,0,.25);cursor:pointer;transition:transform .1s}
.hc-num .hc-hand{width:40px;height:44px}
.hc-num b{font:700 1.4rem/1 var(--font-display)}
.hc-num:active{transform:translateY(3px) scale(.97);box-shadow:0 1px 0 #b99c6a,0 4px 8px rgba(0,0,0,.25)}
.hc-num.sel{border-color:#ffb02e;background:linear-gradient(180deg,#fff3c4,#ffd76a);transform:translateY(-6px) scale(1.04)}
.hc-pad.done .hc-num{cursor:default}.hc-pad.done .hc-num:not(.sel){opacity:.55}
.hc-two{display:grid;grid-template-columns:1fr 1fr;gap:12px;width:min(100%,420px)}
.hc-two button{display:flex;flex-direction:column;align-items:center;gap:2px;min-height:64px;font-size:1.25rem}
.hc-two button small{font-size:.78rem;opacity:.85}.hc-two .hc-role-ic{width:26px;height:26px}
.hc-watch{display:flex;align-items:center;gap:10px;margin:0}.hc-watch .ic{width:1.2em;height:1.2em}
.hc-recent{display:flex;flex-direction:column;align-items:center;gap:6px;width:min(100%,520px)}
.hc-recent small{font-weight:800;color:#d8f5d6;text-transform:uppercase;letter-spacing:.08em;font-size:.7rem}
.hc-recent>div{display:flex;flex-wrap:wrap;justify-content:center;gap:6px}
.hc-ball{display:inline-flex;align-items:center;gap:4px;padding:4px 9px;border-radius:999px;background:rgba(255,255,255,.9);color:#1d2a20;font:700 .9rem var(--font-display)}
.hc-ball i{font:800 .7rem var(--font-body);font-style:normal;color:#6a7a6e}
.hc-ball em{font-style:normal;padding:1px 6px;border-radius:999px;background:#2f8a4a;color:#fff;font-size:.8rem}
.hc-ball.out{background:#ffe1e3}.hc-ball.out em{background:#c2262f;text-decoration:underline;text-underline-offset:2px}
.hc-card h3{display:flex;align-items:center;gap:8px;margin:0 0 8px;font-size:1rem}.hc-card h3 .ic{width:1em;height:1em}
.hc-inn{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;gap:10px;align-items:center;padding:6px 8px;border-radius:10px}
.hc-inn.now{background:rgba(62,224,161,.12)}
.hc-inn span{font-size:.75rem;font-weight:800;color:var(--muted)}.hc-inn b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hc-inn em{font:700 1.1rem var(--font-display);font-style:normal}.hc-inn small{color:var(--muted)}
.hc-rules{margin:8px 0 0}
@media (max-width:480px){.hc-pad{grid-template-columns:repeat(3,minmax(0,1fr))}.hc-num{min-height:76px}.hc-runs{font-size:2.5rem}.hc-face{width:44px;height:44px}}
`;

/* Cover art: two school friends on a sunny ground throw out their hands at the same moment, 4 against 2;
   a chalk scoreboard reads 23/1, with a bat and stumps beside them (self-contained ids, prefixed hcc-). */
function coverSVG() {
  const paint = (cuff) => (k) => ({ skin: 'fill="#f1c08f" stroke="#8a5a35" stroke-width="1.4"', fold: 'fill="#e7b07c" stroke="#8a5a35" stroke-width="1.4"', line: 'fill="none" stroke="#b97f52" stroke-width="1.2" stroke-linecap="round"', cuff: `fill="${cuff}"` }[k]);
  const kidHand = (x, y, n, flip) => `<g transform="translate(${x} ${y}) scale(${flip ? -0.78 : 0.78} 0.78)">${handShapes(n, paint(flip ? '#e0486b' : '#3b6fd6'))}</g>`;
  return `<svg viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="hcc-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7cc8ff"/><stop offset="1" stop-color="#d4efff"/></linearGradient>
    <linearGradient id="hcc-grass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3fa25a"/><stop offset="1" stop-color="#236e3b"/></linearGradient>
    <radialGradient id="hcc-sun" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff6c2"/><stop offset="1" stop-color="#ffd25c" stop-opacity="0"/></radialGradient>
    <linearGradient id="hcc-board" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b4a36"/><stop offset="1" stop-color="#16281c"/></linearGradient>
    <linearGradient id="hcc-bat" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f6dba0"/><stop offset="1" stop-color="#c9964e"/></linearGradient>
  </defs>
  <rect width="320" height="200" fill="url(#hcc-sky)"/>
  <circle cx="270" cy="34" r="40" fill="url(#hcc-sun)"/><circle cx="270" cy="34" r="14" fill="#ffe27a"/>
  <path d="M0 108 q40 -14 80 -4 q50 -18 100 -2 q60 -14 140 0 v20 H0z" fill="#8fd18f"/>
  <rect x="0" y="118" width="320" height="82" fill="url(#hcc-grass)"/>
  <g opacity=".18" fill="#fff"><rect x="0" y="132" width="320" height="10"/><rect x="0" y="156" width="320" height="12"/><rect x="0" y="184" width="320" height="14"/></g>
  <path d="M120 200 L140 122 H180 L200 200z" fill="#d8b878" opacity=".75"/>
  <!-- school wall and scoreboard -->
  <rect x="18" y="58" width="94" height="58" rx="4" fill="#c9794a"/><g stroke="#a65e36" stroke-width="1"><path d="M18 72h94M18 86h94M18 100h94"/><path d="M40 58v14M70 58v14M96 58v14M28 72v14M56 72v14M84 72v14M40 86v14M70 86v14M96 86v14M28 100v16M56 100v16M84 100v16"/></g>
  <rect x="28" y="22" width="74" height="44" rx="5" fill="url(#hcc-board)" stroke="#6b4a2a" stroke-width="3"/>
  <text x="65" y="37" text-anchor="middle" font-family="Fredoka,sans-serif" font-weight="700" font-size="9" fill="#bfe6c4">RUNS / WKTS</text>
  <text x="65" y="59" text-anchor="middle" font-family="Fredoka,sans-serif" font-weight="700" font-size="20" fill="#ffe27a">23/1</text>
  <!-- stumps and a bat -->
  <g transform="translate(232 98)"><rect x="0" y="0" width="4" height="40" rx="1.5" fill="#f4ead2"/><rect x="8" y="0" width="4" height="40" rx="1.5" fill="#f4ead2"/><rect x="16" y="0" width="4" height="40" rx="1.5" fill="#f4ead2"/><rect x="-1" y="-3" width="11" height="3" rx="1.5" fill="#c9964e"/><rect x="10" y="-3" width="11" height="3" rx="1.5" fill="#c9964e"/></g>
  <g transform="translate(286 150) rotate(-20)"><rect x="-6" y="-46" width="12" height="40" rx="4" fill="url(#hcc-bat)" stroke="#8a5a2b" stroke-width="1.2"/><rect x="-2" y="-6" width="4" height="16" rx="2" fill="#3b2414"/></g>
  <circle cx="214" cy="178" r="6" fill="#d9363e" stroke="#7a1218" stroke-width="1"/><path d="M210 174 q4 4 0 8" stroke="#fff" stroke-width=".8" fill="none"/>
  <!-- left kid, batting cap -->
  <g transform="translate(100 120)">
    <path d="M-28 70 q0 -40 28 -44 q28 4 28 44z" fill="#3b6fd6"/><path d="M-6 28 h12 l-6 10z" fill="#fff"/>
    <circle cx="0" cy="8" r="20" fill="#a86a42"/>
    <path d="M-20 4 q2 -22 20 -22 q20 0 20 18 h-40z" fill="#1d3f86"/><path d="M18 2 q14 0 18 4 h-18z" fill="#1d3f86"/>
    <circle cx="-6" cy="10" r="2.3" fill="#1a0f08"/><circle cx="8" cy="10" r="2.3" fill="#1a0f08"/>
    <path d="M-4 19 q5 5 10 0" stroke="#5a2a1a" stroke-width="2" fill="none" stroke-linecap="round"/>
    <path d="M20 40 q14 -14 18 -42" stroke="#a86a42" stroke-width="8" fill="none" stroke-linecap="round"/>
  </g>
  ${kidHand(112, 68, 4, false)}
  <!-- right kid, pigtails -->
  <g transform="translate(212 122)">
    <path d="M-28 68 q0 -40 28 -44 q28 4 28 44z" fill="#e0486b"/>
    <circle cx="-22" cy="4" r="7" fill="#2a1430"/><circle cx="22" cy="4" r="7" fill="#2a1430"/>
    <circle cx="0" cy="8" r="19" fill="#c98a5e"/><path d="M-19 6 q-1 -24 19 -24 q20 0 19 24 q-8 -12 -19 -12 q-11 0 -19 12z" fill="#2a1430"/>
    <circle cx="-7" cy="10" r="2.2" fill="#1a0f08"/><circle cx="6" cy="10" r="2.2" fill="#1a0f08"/>
    <ellipse cx="0" cy="20" rx="4.5" ry="3.5" fill="#7a2a2a"/>
    <path d="M-20 40 q-14 -14 -18 -42" stroke="#c98a5e" stroke-width="8" fill="none" stroke-linecap="round"/>
  </g>
  ${kidHand(208, 68, 2, true)}
  <!-- the clash -->
  <g transform="translate(160 38)"><path d="M0 -14 l4 9 l10 -3 l-6 8 l8 6 l-10 1 l1 10 l-7 -7 l-7 7 l1 -10 l-10 -1 l8 -6 l-6 -8 l10 3z" fill="#fff" opacity=".9"/><text y="5" text-anchor="middle" font-family="Fredoka,sans-serif" font-weight="700" font-size="11" fill="#d6246a">+4</text></g>
  <g fill="#fff" font-family="Fredoka,sans-serif" font-weight="700" font-size="13" text-anchor="middle"><text x="104" y="84" fill="#1d3f86" stroke="#fff" stroke-width="3" paint-order="stroke">4</text><text x="216" y="84" fill="#a01e44" stroke="#fff" stroke-width="3" paint-order="stroke">2</text></g>
</svg>`;
}

export default {
  id: 'handcricket', name: 'Hand Cricket',
  description: 'The school-yard odd–eve game: throw out 1 to 6 fingers at the same moment. A different number scores runs, the same number is OUT! Set a score, then chase it. For 2.',
  minPlayers: 2, maxPlayers: 2, simultaneous: true,
  options: [
    { id: 'overs', label: 'Overs per innings', default: '1', choices: [['1', '1 over (6 balls)'], ['2', '2 overs'], ['5', '5 overs']] },
    { id: 'wickets', label: 'Wickets', default: '1', choices: [['1', '1 wicket'], ['2', '2 wickets'], ['3', '3 wickets']] },
    levelOption(),
  ],
  cover: coverSVG(),
  defaultTimer: 15,
  howTo: {
    goal: 'Score more runs than the other player across two innings.',
    turn: [
      ['🪙', 'The toss', 'One player calls Odd or Even, then both throw a number from 1 to 6. If the sum matches the call, the caller wins the toss and chooses to bat or bowl.'],
      ['✋', 'Throw together', 'Every ball, the batter and the bowler each pick 1 to 6 at the same time. Nobody sees the other number until both have picked.'],
      ['🏏', 'Runs or OUT', 'Different numbers: the batter scores their own number. The same number: OUT! An innings ends when the wickets or the balls run out.'],
      ['🎯', 'The chase', 'Then the players swap. The second batter needs one more run than the first score. Level scores are a tie.'],
    ],
    tips: ['Big numbers score more, but a bowler who knows you love a 6 will throw a 6.', 'Keep an eye on the last few balls: people have habits.', 'In a close chase, any number at least as big as the runs you need wins it.'],
  },
  setup, act, turnOf, view, bot, onTimeout, render,
};
