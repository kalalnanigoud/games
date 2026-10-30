// Sketch Party: each turn one player draws a secret word while everyone else races to guess it.
//
// Strokes are sent in short chunks while you draw. Time-based events (hints, the end of a turn)
// are triggered by any player's screen sending { type: 'clock' }; the host's own clock decides.
// The game keeps its DOM between updates (keepDom), so the canvas and the guess box never reset.
import { esc, log, addFx, rand, shuffle } from '../js/util.js';
import { injectCSS } from '../js/fx.js';
import { sound } from '../js/sound.js';

const browser = typeof document !== 'undefined';
const W = 1000, H = 750;
const COLORS = ['#1d1714', '#ffffff', '#e0523f', '#f08a24', '#f2c14e', '#3fa36b', '#3d7fd9', '#7b4fd6', '#d6559b', '#8a5a33'];
const COLOR_NAMES = ['Black', 'Eraser (white)', 'Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple', 'Pink', 'Brown'];
const SIZES = [6, 14, 32];
const CHOOSE_MS = 15000, REVEAL_MS = 6000;

const WORDS = `apple,banana,house,tree,car,bicycle,airplane,boat,fish,cat,dog,horse,cow,pig,chicken,duck,rabbit,mouse,elephant,giraffe,
lion,tiger,monkey,snake,turtle,frog,butterfly,spider,bee,snail,octopus,shark,whale,dolphin,penguin,owl,bird,dragon,unicorn,robot,
ghost,pirate,king,queen,wizard,clown,astronaut,doctor,chef,guitar,piano,drum,trumpet,violin,microphone,headphones,camera,television,
computer,phone,clock,glasses,hat,shoe,sock,shirt,dress,crown,ring,umbrella,backpack,key,lock,door,window,ladder,bridge,castle,tent,
lighthouse,rocket,train,bus,truck,tractor,helicopter,submarine,sun,moon,star,cloud,rain,snow,rainbow,lightning,tornado,volcano,
mountain,island,river,beach,desert,forest,cactus,flower,rose,mushroom,leaf,pumpkin,carrot,corn,pizza,burger,sandwich,cake,cookie,
donut,ice cream,popcorn,cheese,egg,bread,coffee,milk,candle,lamp,book,pencil,scissors,paint brush,envelope,gift,balloon,kite,ball,
football,basketball,trophy,medal,dice,puzzle,swing,slide,bed,chair,table,sofa,bath,toothbrush,soap,mirror,fridge,spoon,fork,knife,
cup,bottle,bucket,hammer,saw,shovel,broom,magnet,battery,light bulb,anchor,compass,map,flag,sword,shield,bow,arrow,treasure,
skeleton,heart,snowman,igloo,fire,bubble,spaceship,planet,alien,eye,nose,ear,hand,foot,tooth,brain,smile,sleep,dance,swim,jump,
laugh,sneeze,fishing,camping,skiing,surfing,waterfall,windmill,train track,hot dog,cupcake,lollipop,watermelon,cherry,grapes,
lemon,strawberry,snowflake,tooth fairy,mermaid,vampire,zombie,knight,ninja,pyramid,statue,fountain,ferris wheel,roller coaster`
  .split(',').map((w) => w.trim()).filter(Boolean);

/* ---------------- doodles the computer can draw ---------------- */
// Point lists in the 1000 x 750 canvas. Computer guessers recognise these strokes, the way a
// person recognises a drawing; for human drawings they guess from the letter hints instead.
const ring = (cx, cy, rx, ry = rx, from = 0, to = 2 * Math.PI, n = 22) =>
  Array.from({ length: n + 1 }, (_, i) => { const a = from + ((to - from) * i) / n; return [Math.round(cx + rx * Math.cos(a)), Math.round(cy + ry * Math.sin(a))]; }).flat();
const S = (c, w, p) => ({ c, w, p });
const DOODLES = {
  sun: [S(4, 2, ring(500, 375, 130)), ...Array.from({ length: 8 }, (_, k) => { const a = (k * Math.PI) / 4; return S(3, 1, [500 + 170 * Math.cos(a), 375 + 170 * Math.sin(a), 500 + 250 * Math.cos(a), 375 + 250 * Math.sin(a)].map(Math.round)); })],
  house: [S(9, 1, [300, 600, 700, 600, 700, 360, 300, 360, 300, 600]), S(2, 1, [260, 380, 500, 170, 740, 380]), S(0, 1, [450, 600, 450, 470, 550, 470, 550, 600]), S(6, 1, [340, 420, 410, 420, 410, 480, 340, 480, 340, 420])],
  tree: [S(9, 2, [470, 680, 470, 460, 530, 460, 530, 680]), S(5, 2, ring(500, 320, 190, 170))],
  fish: [S(6, 2, ring(460, 375, 220, 120)), S(6, 2, [680, 375, 820, 270, 820, 480, 680, 375]), S(0, 1, ring(340, 345, 18))],
  star: [S(4, 2, [500, 120, 565, 300, 760, 300, 605, 415, 665, 610, 500, 500, 335, 610, 395, 415, 240, 300, 435, 300, 500, 120])],
  moon: [S(4, 2, [...ring(500, 375, 220, 220, -Math.PI / 2, Math.PI / 2), ...ring(440, 375, 150, 220, Math.PI / 2, -Math.PI / 2)])],
  heart: [S(2, 2, Array.from({ length: 33 }, (_, i) => { const t = (i / 32) * 2 * Math.PI; return [Math.round(500 + 16 * Math.sin(t) ** 3 * 16), Math.round(360 - (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * 16)]; }).flat())],
  flower: [S(5, 2, [500, 700, 500, 400]), ...[0, 1, 2, 3, 4].map((k) => { const a = (k * 2 * Math.PI) / 5 - Math.PI / 2; return S(8, 1, ring(Math.round(500 + 85 * Math.cos(a)), Math.round(300 + 85 * Math.sin(a)), 60)); }), S(4, 2, ring(500, 300, 45))],
  cloud: [S(6, 1, [...ring(380, 400, 110, 90, Math.PI / 2, Math.PI * 1.5), ...ring(500, 300, 140, 120, Math.PI, Math.PI * 2), ...ring(640, 400, 110, 90, -Math.PI / 2, Math.PI / 2), 380, 490])],
  apple: [S(2, 2, ring(500, 410, 200, 190)), S(9, 2, [500, 220, 520, 140]), S(5, 1, [520, 170, 600, 130, 640, 170, 560, 200, 520, 170])],
  boat: [S(9, 2, [250, 480, 750, 480, 660, 600, 340, 600, 250, 480]), S(0, 1, [500, 480, 500, 140]), S(2, 1, [510, 160, 700, 420, 510, 420, 510, 160])],
  cup: [S(6, 2, [380, 250, 620, 250, 590, 600, 410, 600, 380, 250]), S(6, 2, ring(650, 410, 70, 90, -Math.PI / 2, Math.PI / 2))],
  key: [S(4, 2, ring(330, 375, 90)), S(4, 2, [420, 375, 760, 375]), S(4, 2, [690, 375, 690, 450]), S(4, 2, [620, 375, 620, 440])],
  umbrella: [S(7, 2, [...ring(500, 380, 260, 200, Math.PI, 2 * Math.PI), 240, 380]), S(0, 2, [500, 380, 500, 620, ...ring(460, 620, 40, 40, 0, Math.PI, 8)])],
  mountain: [S(9, 2, [150, 620, 380, 260, 520, 470, 640, 330, 850, 620, 150, 620]), S(1, 1, [325, 345, 380, 260, 435, 345])],
  rainbow: [S(2, 2, ring(500, 600, 330, 330, Math.PI, 2 * Math.PI)), S(4, 2, ring(500, 600, 280, 280, Math.PI, 2 * Math.PI)), S(5, 2, ring(500, 600, 230, 230, Math.PI, 2 * Math.PI)), S(6, 2, ring(500, 600, 180, 180, Math.PI, 2 * Math.PI))],
  car: [S(2, 2, [200, 500, 200, 400, 340, 400, 420, 300, 620, 300, 700, 400, 800, 400, 800, 500, 200, 500]), S(0, 2, ring(320, 520, 60)), S(0, 2, ring(680, 520, 60))],
  eye: [S(0, 2, [...ring(500, 470, 300, 220, -Math.PI * 0.82, -Math.PI * 0.18), ...ring(500, 280, 300, 220, Math.PI * 0.18, Math.PI * 0.82)]), S(6, 2, ring(500, 375, 80)), S(0, 2, ring(500, 375, 30))],
  snowman: [S(0, 1, ring(500, 560, 140)), S(0, 1, ring(500, 330, 100)), S(0, 1, ring(500, 175, 70)), S(3, 2, [500, 175, 580, 190])],
  ladder: [S(9, 2, [400, 680, 400, 80]), S(9, 2, [600, 680, 600, 80]), ...[160, 280, 400, 520, 640].map((y) => S(9, 1, [400, y, 600, y]))],
};

/* ---------------- rules ---------------- */

const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
function close(a, b) {
  if (Math.abs(a.length - b.length) > 1 || b.length < 4) return false;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length] === 1;
}
const fits = (w, mask) => w.length === mask.length && [...mask].every((m, i) => (m === '_' ? w[i] !== ' ' : m === w[i]));
const say = (s, item) => { s.feed.push(item); if (s.feed.length > 50) s.feed.splice(0, s.feed.length - 50); };
const drawerOf = (s) => s.players[s.turn];
const named = (s, id) => s.players.find((p) => p.id === id)?.name || '?';

function chooseFor(s) {
  const drawer = drawerOf(s);
  const fresh = (list) => list.filter((w) => !s.used.includes(w));
  const doodle = shuffle(fresh(Object.keys(DOODLES)))[0] || 'star';
  const rest = shuffle(fresh(WORDS).filter((w) => w !== doodle)).slice(0, 2);
  Object.assign(s, { phase: 'choose', drawer: drawer.id, choices: shuffle([doodle, ...rest]), word: '', strokes: [], guessed: {}, hints: [], hintAt: [], hintPos: [], chooseUntil: Date.now() + CHOOSE_MS });
  log(s, `Round ${s.round}: ${drawer.name} is choosing a word.`);
}
function startDraw(s, word) {
  const letters = [...word].map((c, i) => (c === ' ' ? -1 : i)).filter((i) => i >= 0);
  const n = letters.length >= 5 ? 2 : letters.length >= 3 ? 1 : 0, now = Date.now();
  Object.assign(s, { phase: 'draw', word, choices: [], strokes: [], started: now, endsAt: now + s.drawMs, hintPos: shuffle(letters).slice(0, n), hintAt: [0.5, 0.75].slice(0, n).map((f) => now + s.drawMs * f), hints: [] });
  s.used.push(word);
  say(s, { k: 'sys', text: `${drawerOf(s).name} is drawing!` });
  addFx(s, { kind: 'sound', sound: 'flip' });
}
function reveal(s, why) {
  s.phase = 'reveal'; s.revealUntil = Date.now() + REVEAL_MS;
  const n = Object.keys(s.guessed).length;
  say(s, { k: 'sys', text: `${why} The word was “${s.word}”.` });
  log(s, `“${s.word}”: ${n} player${n === 1 ? '' : 's'} guessed it.`);
}
function nextTurn(s) {
  s.turn++;
  if (s.turn >= s.players.length) { s.turn = 0; s.round++; }
  if (s.round > s.rounds) {
    const best = Math.max(...s.players.map((p) => p.score));
    Object.assign(s, { phase: 'over', over: true, winners: s.players.filter((p) => p.score === best).map((p) => p.id) });
    log(s, `${s.winners.map((id) => named(s, id)).join(' & ')} won${best ? ` with ${best} points` : ''}!`);
    return;
  }
  chooseFor(s);
}
function tick(s) {
  const now = Date.now();
  if (s.phase === 'choose' && now >= s.chooseUntil) startDraw(s, s.choices[rand(s.choices.length)]);
  else if (s.phase === 'draw') {
    while (s.hints.length < s.hintAt.length && now >= s.hintAt[s.hints.length]) { s.hints.push(s.hintPos[s.hints.length]); addFx(s, { kind: 'sound', sound: 'card' }); }
    if (now >= s.endsAt) reveal(s, 'Time’s up!');
  } else if (s.phase === 'reveal' && now >= s.revealUntil) nextTurn(s);
}

function setup(players, opts = {}) {
  if (players.length < 2 || players.length > 8) throw Error('Sketch Party needs 2–8 players.');
  const s = {
    phase: 'choose', over: false, winners: [], round: 1, turn: 0, used: [], feed: [], log: [],
    rounds: [1, 2, 3].includes(Number(opts.rounds)) ? Number(opts.rounds) : 2,
    drawMs: [60, 80, 100].includes(Number(opts.time)) ? Number(opts.time) * 1000 : 80000,
    players: shuffle(players.map((p) => ({ id: p.id, name: p.name, score: 0 }))),
  };
  chooseFor(s);
  return s;
}

function act(s, pid, a) {
  if (s.over) throw Error('The game is over.');
  const me = s.players.find((p) => p.id === pid);
  if (!me) throw Error('You are not playing in this game.');
  if (!a || typeof a !== 'object') throw Error('Choose something to do.');
  const drawing = s.phase === 'draw', isDrawer = pid === s.drawer;
  switch (a.type) {
    case 'think': return;
    case 'clock': return tick(s);
    case 'next': if (s.phase !== 'reveal') throw Error('Not yet.'); return nextTurn(s);
    case 'choose':
      if (s.phase !== 'choose' || !isDrawer) throw Error('Only the drawer chooses the word.');
      if (!Number.isInteger(a.i) || !s.choices[a.i]) throw Error('Pick one of the words.');
      return startDraw(s, s.choices[a.i]);
    case 'stroke': {
      if (!drawing || !isDrawer) throw Error('Only the drawer can draw.');
      const p = a.p;
      if (!Number.isInteger(a.c) || !COLORS[a.c] || !Number.isInteger(a.w) || !SIZES[a.w] || !Number.isInteger(a.g) || a.g < 0) throw Error('Bad brush.');
      if (!Array.isArray(p) || p.length < 2 || p.length > 600 || p.length % 2 || p.some((x, i) => !Number.isInteger(x) || x < 0 || x > (i % 2 ? H : W))) throw Error('Bad stroke.');
      if (s.strokes.length >= 2000) throw Error('The canvas is full. Clear it to keep drawing.');
      s.strokes.push({ c: a.c, w: a.w, g: a.g, p, ...(typeof a.k === 'string' && /^\w{1,12}$/.test(a.k) ? { k: a.k } : {}) });
      return;
    }
    case 'undo': {
      if (!drawing || !isDrawer) throw Error('Only the drawer can undo.');
      const g = s.strokes.at(-1)?.g;
      s.strokes = s.strokes.filter((x) => x.g !== g);
      return;
    }
    case 'clear':
      if (!drawing || !isDrawer) throw Error('Only the drawer can clear.');
      s.strokes = [];
      return;
    case 'skip':
      if (!drawing || !isDrawer) throw Error('Only the drawer can give up.');
      return reveal(s, `${me.name} gave up.`);
    case 'guess': {
      if (!drawing) throw Error('Wait for the next drawing.');
      if (isDrawer) throw Error('You are the one drawing!');
      if (s.guessed[pid]) throw Error('You already guessed it.');
      const text = norm(a.text).slice(0, 40);
      if (!text) throw Error('Type a guess.');
      if (text === s.word) {
        const left = Math.max(0, s.endsAt - Date.now());
        const pts = Math.max(50, Math.round((300 * left) / s.drawMs / 10) * 10);
        s.guessed[pid] = pts;
        me.score += pts;
        drawerOf(s).score += 50;
        say(s, { k: 'right', pid, text: `${me.name} guessed the word! +${pts}` });
        addFx(s, { kind: 'sound', sound: 'chime' });
        if (Object.keys(s.guessed).length >= s.players.length - 1) reveal(s, 'Everyone got it!');
      } else if (close(text, s.word)) say(s, { k: 'close', pid, to: pid, text: `“${text}” is very close!` });
      else say(s, { k: 'guess', pid, text });
      return;
    }
  }
  throw Error('Unknown action.');
}

function view(s, pid) {
  const v = JSON.parse(JSON.stringify(s));
  const knows = pid === s.drawer || s.guessed[pid] || s.phase === 'reveal' || s.over;
  if (pid !== s.drawer) v.choices = [];
  v.mask = [...s.word].map((c, i) => (c === ' ' ? ' ' : knows || s.hints.includes(i) ? c : '_')).join('');
  if (!knows) v.word = '';
  delete v.hintPos;
  v.used = s.used.length; // the list itself would reveal the current word
  v.feed = s.feed.filter((f) => !f.to || f.to === pid);
  v.hostNow = Date.now();
  return v;
}

function bot(v, pid) {
  const think = { type: 'think' }, idle = browser ? 0.75 : 0.4;
  const deadline = v.phase === 'choose' ? v.chooseUntil : v.phase === 'reveal' ? v.revealUntil : v.phase === 'draw' ? Math.min(v.endsAt, v.hintAt[v.hints.length] ?? Infinity) : Infinity;
  const due = Date.now() >= deadline;
  if (v.phase === 'choose') {
    const i = v.choices.findIndex((w) => DOODLES[w]);
    return { type: 'choose', i: i >= 0 ? i : rand(v.choices.length) };
  }
  if (v.phase === 'reveal') return browser ? (due ? { type: 'clock' } : think) : { type: 'next' };
  if (pid === v.drawer) {
    const D = DOODLES[v.word];
    if (D && v.strokes.length < D.length) return browser && Math.random() < 0.3 ? think : { type: 'stroke', ...D[v.strokes.length], g: v.strokes.length + 1 };
    return browser ? (due ? { type: 'clock' } : think) : { type: 'skip' };
  }
  if (v.guessed[pid] || Math.random() < idle) return due ? { type: 'clock' } : think;
  for (const [w, D] of Object.entries(DOODLES))
    if (v.strokes.length >= 2 && v.strokes.length <= D.length && v.strokes.every((st, i) => st.p.join() === D[i].p.join())) return { type: 'guess', text: w };
  const tried = new Set(v.feed.filter((f) => f.pid === pid).map((f) => f.text));
  const options = WORDS.filter((w) => fits(w, v.mask) && !tried.has(w));
  if (options.length && options.length <= (browser ? 12 : 1000)) return { type: 'guess', text: options[rand(options.length)] };
  return due ? { type: 'clock' } : think;
}

/* ---------------- interface ---------------- */

const UI = { gid: null, v: null, ctx: null, color: 0, size: 1, gesture: 0, drawing: false, pending: null, local: [], sentAt: 0, offset: 0, hostNow: 0, clockSent: 0, root: null };
const amDrawer = () => UI.v && UI.v.phase === 'draw' && UI.v.drawer === UI.ctx.me && !UI.v.over;
const amPlayer = () => UI.v?.players.some((p) => p.id === UI.ctx.me);

function paint() {
  const cv = UI.root?.querySelector('canvas');
  if (!cv || !UI.v) return;
  const g = cv.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  g.lineCap = 'round'; g.lineJoin = 'round';
  const ink = (st) => {
    const p = st.p;
    g.strokeStyle = COLORS[st.c]; g.lineWidth = SIZES[st.w];
    g.beginPath(); g.moveTo(p[0], p[1]);
    if (p.length === 2) g.lineTo(p[0] + 0.1, p[1]);
    for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]);
    g.stroke();
  };
  const shown = UI.v.phase === 'choose' ? [] : UI.v.strokes;
  const done = new Set(shown.map((s) => s.k).filter(Boolean));
  UI.local = UI.local.filter((s) => !done.has(s.k));
  shown.forEach(ink);
  if (amDrawer()) { UI.local.forEach(ink); if (UI.pending?.length >= 2) ink({ c: UI.color, w: UI.size, p: UI.pending }); }
}

function flush(final) {
  const p = UI.pending;
  if (!p || p.length < 2 || !amDrawer()) return;
  if (!final && p.length < 4) return;
  const k = Math.random().toString(36).slice(2, 10);
  const stroke = { type: 'stroke', c: UI.color, w: UI.size, g: UI.gesture, p: p.length === 2 ? [p[0], p[1], p[0], p[1]] : p.slice(), k };
  UI.local.push(stroke);
  UI.ctx.send(stroke);
  UI.pending = final ? null : p.slice(-2); // the next chunk continues from here
  UI.sentAt = Date.now();
}
const point = (e) => {
  const cv = UI.root.querySelector('canvas'), r = cv.getBoundingClientRect();
  return [Math.round(Math.min(W, Math.max(0, ((e.clientX - r.left) / r.width) * W))), Math.round(Math.min(H, Math.max(0, ((e.clientY - r.top) / r.height) * H)))];
};
if (browser) {
  addEventListener('pointermove', (e) => {
    if (!UI.drawing) return;
    const [x, y] = point(e), p = UI.pending;
    if (Math.hypot(x - p.at(-2), y - p.at(-1)) < 5) return;
    p.push(x, y);
    if (p.length >= 280 || Date.now() - UI.sentAt > 350) flush(false);
    paint();
  });
  const up = () => { if (!UI.drawing) return; UI.drawing = false; flush(true); paint(); };
  addEventListener('pointerup', up);
  addEventListener('pointercancel', up);
  // Clocks: count down locally and ask the host to move on when a deadline passes.
  setInterval(() => {
    const v = UI.v;
    if (!v || !UI.root?.isConnected) return;
    const now = Date.now() + UI.offset;
    const until = v.phase === 'choose' ? v.chooseUntil : v.phase === 'draw' ? v.endsAt : v.phase === 'reveal' ? v.revealUntil : 0;
    UI.root.querySelectorAll('.sk-time').forEach((t) => {
      const left = Math.max(0, Math.ceil((until - now) / 1000));
      t.textContent = v.over ? '' : left;
      t.classList.toggle('low', v.phase === 'draw' && left <= 10);
    });
    const next = v.phase === 'draw' ? Math.min(v.endsAt, v.hintAt[v.hints.length] ?? Infinity) : until;
    if (!v.over && amPlayer() && next && now > next + 250 && Date.now() - UI.clockSent > 1500) { UI.clockSent = Date.now(); UI.ctx.send({ type: 'clock' }); }
  }, 250);
}

function skeleton(el) {
  el.innerHTML = `<div class="sk-root"><div class="sk-top" data-r="top"></div><div class="sk-grid">
    <div class="sk-boardcol"><div class="sk-board"><canvas width="${W}" height="${H}" aria-label="Drawing canvas"></canvas><div class="sk-over" data-r="over"></div></div><div class="sk-tools" data-r="tools"></div></div>
    <div class="panel sk-chat"><div class="sk-feed" data-r="feed" aria-live="polite"></div>
      <form class="sk-guess"><input maxlength="40" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send" aria-label="Your guess"><button class="primary">Guess</button></form></div>
    <div class="panel sk-scores"><h3 class="gold">Scores</h3><div data-r="scores"></div></div>
  </div></div>`;
  UI.root = el;
  const cv = el.querySelector('canvas');
  cv.addEventListener('pointerdown', (e) => {
    if (!amDrawer()) return;
    e.preventDefault();
    UI.gesture++; UI.drawing = true; UI.pending = point(e); UI.sentAt = Date.now();
    paint();
  });
  el.querySelector('.sk-guess').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = el.querySelector('.sk-guess input'), text = input.value.trim();
    if (!text) return;
    input.value = '';
    UI.ctx.send({ type: 'guess', text });
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-do]');
    if (!b) return;
    const [kind, arg] = b.dataset.do.split(':');
    if (kind === 'color') { UI.color = +arg; sound('click'); return draw(); }
    if (kind === 'size') { UI.size = +arg; sound('click'); return draw(); }
    if (kind === 'skip' && !confirm('Give up on this drawing?')) return;
    if (kind === 'clear' && !confirm('Clear the whole drawing?')) return;
    UI.ctx.send(kind === 'choose' ? { type: 'choose', i: +arg } : { type: kind });
  });
}

function draw() {
  const v = UI.v, ctx = UI.ctx, el = UI.root, me = ctx.me;
  const drawer = v.players.find((p) => p.id === v.drawer), isDrawer = me === v.drawer, player = amPlayer();
  const region = (r, html) => { const n = el.querySelector(`[data-r="${r}"]`); if (n.innerHTML !== html) n.innerHTML = html; };
  const word = v.mask.split('').map((c) => (c === ' ' ? '<i class="gap"></i>' : `<b>${c === '_' ? '' : esc(c)}</b>`)).join('');
  region('top', `<div class="sk-round">Round ${Math.min(v.round, v.rounds)} of ${v.rounds}</div>
    <div class="sk-word">${v.over ? '<span class="winner-banner">Final scores</span>'
      : v.phase === 'choose' ? `<span>${isDrawer ? 'Choose a word to draw' : esc(drawer.name) + ' is choosing a word…'}</span>`
      : isDrawer && v.phase === 'draw' ? `<span class="sk-label">Draw</span><span class="sk-letters mine">${word}</span>`
      : `<span class="sk-label">${v.phase === 'reveal' ? 'The word was' : v.guessed[me] ? 'You got it!' : 'Guess'}</span><span class="sk-letters">${word}</span><small>${v.phase === 'draw' && !v.word ? v.mask.replace(/ /g, '').length + ' letters' : ''}</small>`}</div>
    <div class="sk-clock"><span class="sk-time"></span></div>`);
  region('over', v.over ? `<div class="sk-card">${v.players.slice().sort((a, b) => b.score - a.score).map((p, i) => `<div class="sk-final ${v.winners.includes(p.id) ? 'win' : ''}">${i + 1}. ${esc(p.name)} <b>${p.score}</b></div>`).join('')}</div>`
    : v.phase === 'choose' ? `<div class="sk-card">${isDrawer ? `<p>Pick one to draw. Don’t say it out loud!</p><div class="sk-choices">${v.choices.map((w, i) => `<button class="primary" data-do="choose:${i}">${esc(w)}</button>`).join('')}</div>` : `<p>${esc(drawer.name)} is picking something to draw…</p>`}</div>`
    : v.phase === 'reveal' ? `<div class="sk-card"><p class="sk-big">${esc(v.word)}</p>${Object.keys(v.guessed).length ? Object.entries(v.guessed).map(([id, pts]) => `<div>✓ ${esc(v.players.find((p) => p.id === id)?.name)} +${pts}</div>`).join('') : '<div>Nobody guessed it.</div>'}</div>` : '');
  region('tools', isDrawer && v.phase === 'draw' && !v.over
    ? `<div class="sk-colors">${COLORS.map((c, i) => `<button class="sk-swatch ${UI.color === i ? 'on' : ''}" style="--c:${c}" data-do="color:${i}" aria-label="${COLOR_NAMES[i]}" title="${COLOR_NAMES[i]}">${i === 1 ? '⌫' : ''}</button>`).join('')}</div>
      <div class="row">${SIZES.map((sz, i) => `<button class="small sk-size ${UI.size === i ? 'on' : ''}" data-do="size:${i}" aria-label="Brush size ${i + 1}"><i style="width:${6 + i * 6}px;height:${6 + i * 6}px"></i></button>`).join('')}
      <button class="small" data-do="undo">↶ Undo</button><button class="small" data-do="clear">Clear</button><button class="small bad" data-do="skip">Give up</button></div>`
    : `<p class="muted small sk-tip">${v.over ? 'Thanks for playing!' : !player ? 'You are watching.' : isDrawer ? '' : 'Type your guesses below. Wrong guesses are shown to everyone. Close guesses only to you.'}</p>`);
  region('feed', v.feed.map((f) => `<div class="sk-msg ${f.k}">${f.k === 'guess' ? `<b>${esc(v.players.find((p) => p.id === f.pid)?.name)}:</b> ` : ''}${esc(f.text)}</div>`).join('') || '<div class="muted small">Guesses appear here.</div>');
  const feed = el.querySelector('[data-r="feed"]'); feed.scrollTop = feed.scrollHeight;
  region('scores', v.players.slice().sort((a, b) => b.score - a.score).map((p) => `<div class="sk-player ${p.id === v.drawer && !v.over ? 'drawing' : ''}"><span class="grow">${p.id === v.drawer && !v.over ? '✏️ ' : v.guessed[p.id] ? '✓ ' : ''}${esc(p.name)}${p.id === me ? ' · you' : ''}</span><b>${p.score}</b></div>`).join(''));
  const input = el.querySelector('.sk-guess input'), canGuess = player && !isDrawer && v.phase === 'draw' && !v.guessed[me] && !v.over;
  input.disabled = !canGuess; el.querySelector('.sk-guess button').disabled = !canGuess;
  input.placeholder = canGuess ? 'Type your guess' : isDrawer && v.phase === 'draw' ? 'You are drawing' : v.guessed[me] ? 'You got it!' : 'Wait for the next drawing';
  el.querySelector('canvas').classList.toggle('mine', amDrawer());
  paint();
}

function render(el, v, ctx) {
  injectCSS('sketch', STYLE);
  if (v.hostNow && v.hostNow !== UI.hostNow) { UI.hostNow = v.hostNow; UI.offset = v.hostNow - Date.now(); }
  if (!el.querySelector('.sk-root') || UI.root !== el) skeleton(el);
  const fresh = UI.gid !== v.players.map((p) => p.id).join() + v.used + v.phase;
  UI.gid = v.players.map((p) => p.id).join() + v.used + v.phase;
  if (fresh && v.phase !== 'draw') { UI.local = []; UI.pending = null; UI.drawing = false; }
  UI.v = v; UI.ctx = ctx;
  draw();
}

const STYLE = `
.sk-top{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;margin-bottom:10px;padding:8px 14px;border-radius:12px;background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.1)}
.sk-round{font-size:.75rem;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
.sk-word{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:8px;text-align:center;min-width:0}
.sk-word .winner-banner{padding:0;font-size:1.2rem}
.sk-label{font-size:.75rem;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
.sk-letters{display:inline-flex;flex-wrap:wrap;gap:4px;justify-content:center}
.sk-letters b{display:inline-grid;place-items:end center;width:20px;height:28px;border-bottom:3px solid var(--gold);font-family:var(--font-display);font-size:1.2rem;color:var(--text);text-transform:uppercase}
.sk-letters.mine b{color:var(--gold)}
.sk-letters i.gap{width:12px}
.sk-word small{color:var(--muted)}
.sk-clock .sk-time{display:inline-grid;place-items:center;min-width:48px;height:48px;border-radius:50%;font-family:var(--font-display);font-weight:800;font-size:1.15rem;background:#f4ecd8;color:#1d1714;box-shadow:0 0 0 3px var(--gold),0 4px 10px rgba(0,0,0,.4)}
.sk-clock .sk-time:empty{visibility:hidden}
.sk-clock .sk-time.low{background:#ff9a8c;box-shadow:0 0 0 3px var(--bad)}
.sk-grid{display:grid;grid-template-columns:minmax(0,1fr) 320px;grid-template-areas:"board chat" "board scores";gap:14px;align-items:start}
.sk-boardcol{grid-area:board;min-width:0}.sk-chat{grid-area:chat}.sk-scores{grid-area:scores}
.sk-board{position:relative;border-radius:14px;overflow:hidden;border:8px solid #6d4426;box-shadow:0 14px 30px rgba(0,0,0,.5),inset 0 0 0 1px #2a170a;background:#fff}
.sk-board canvas{display:block;width:100%;height:auto;aspect-ratio:4/3;touch-action:none;background:#fff}
.sk-board canvas.mine{cursor:crosshair}
.sk-over{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none;padding:12px}
.sk-over:empty{display:none}
.sk-card{pointer-events:auto;max-width:92%;text-align:center;padding:18px 22px;border-radius:14px;color:var(--ink);background:linear-gradient(170deg,#fbf0d4,#e4cf9f);box-shadow:0 12px 30px rgba(0,0,0,.45)}
.sk-card p{margin:0 0 10px}
.sk-big{font-family:var(--font-display);font-size:1.8rem;font-weight:800;text-transform:capitalize}
.sk-choices{display:flex;flex-wrap:wrap;gap:8px;justify-content:center}
.sk-choices button{text-transform:capitalize}
.sk-final{font-size:1.05rem;padding:3px 0}.sk-final.win{font-weight:800;color:#7a4c08}
.sk-tools{margin-top:10px;display:flex;flex-direction:column;gap:8px}
.sk-colors{display:flex;flex-wrap:wrap;gap:6px}
.sk-swatch{width:40px;height:40px;min-height:40px;padding:0;border-radius:50%;background:var(--c);border:3px solid #2a170a;box-shadow:0 2px 0 #1f1208;color:#555;font-size:1rem;text-shadow:none}
.sk-swatch.on{box-shadow:0 0 0 3px var(--gold),0 2px 0 #1f1208;transform:scale(1.08)}
.sk-size{min-width:44px}.sk-size i{display:inline-block;border-radius:50%;background:currentColor}
.sk-size.on{box-shadow:inset 0 0 0 2px var(--gold),0 3px 0 #1f1208}
.sk-tip{margin:0}
.sk-feed{height:230px;overflow-y:auto;font-size:.88rem;line-height:1.4;padding-right:4px}
.sk-msg{padding:3px 0;border-bottom:1px dashed rgba(242,200,130,.15);overflow-wrap:anywhere}
.sk-msg.right{color:var(--good);font-weight:800}.sk-msg.close{color:var(--gold);font-style:italic}.sk-msg.sys{color:var(--muted);font-style:italic}
.sk-guess{display:flex;gap:6px;margin-top:10px}.sk-guess input{flex:1;min-width:0}
.sk-scores h3{margin:0 0 6px}
.sk-player{display:flex;gap:8px;padding:5px 0;font-size:.92rem}.sk-player.drawing{color:var(--gold);font-weight:800}
@media(max-width:900px){.sk-grid{grid-template-columns:1fr;grid-template-areas:"board" "chat" "scores"}.sk-feed{height:150px}}
@media(max-width:480px){.sk-top{grid-template-columns:1fr auto;padding:8px 10px}.sk-round{grid-column:1/-1}.sk-letters b{width:16px;font-size:1rem}.sk-board{border-width:5px}.sk-swatch{width:36px;height:36px;min-height:36px}}
`;

export default {
  id: 'sketch', name: 'Sketch Party',
  description: 'Take turns drawing a secret word while everyone else races to guess it. Fast, silly fun for 2–8 players.',
  minPlayers: 2, maxPlayers: 8, simultaneous: true, keepDom: true,
  options: [
    { id: 'rounds', label: '🔁 Rounds', default: '2', choices: [['1', '1 round'], ['2', '2 rounds'], ['3', '3 rounds']] },
    { id: 'time', label: '⏱ Drawing time', default: '80', choices: [['60', '60 seconds'], ['80', '80 seconds'], ['100', '100 seconds']] },
  ],
  cover: `<svg viewBox="0 0 320 200" role="img" aria-label="A sketchbook with a doodled sun and house"><defs><linearGradient id="sk-cv" x2="0" y2="1"><stop stop-color="#4a2c19"/><stop offset="1" stop-color="#22140a"/></linearGradient></defs>
    <rect width="320" height="200" fill="url(#sk-cv)"/><g transform="rotate(-4 160 100)"><rect x="52" y="26" width="216" height="150" rx="8" fill="#fffdf6" stroke="#2a170a" stroke-width="3"/>${Array.from({ length: 9 }, (_, i) => `<circle cx="${70 + i * 23}" cy="26" r="5" fill="none" stroke="#777" stroke-width="2.5"/>`).join('')}
    <circle cx="214" cy="70" r="20" fill="none" stroke="#f2a33c" stroke-width="5"/>${Array.from({ length: 8 }, (_, k) => { const a = (k * Math.PI) / 4; return `<path d="M${(214 + 28 * Math.cos(a)).toFixed(1)} ${(70 + 28 * Math.sin(a)).toFixed(1)}L${(214 + 38 * Math.cos(a)).toFixed(1)} ${(70 + 38 * Math.sin(a)).toFixed(1)}" stroke="#f2a33c" stroke-width="4" stroke-linecap="round"/>`; }).join('')}
    <path d="M92 150V110h60v40M84 114l38-32 38 32" fill="none" stroke="#8a5a33" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/><path d="M114 150v-22h16v22" fill="none" stroke="#3d7fd9" stroke-width="4"/>
    <path d="M178 156q20-14 40 0t40 0" fill="none" stroke="#3fa36b" stroke-width="5" stroke-linecap="round"/></g>
    <g transform="rotate(38 262 150)"><rect x="236" y="144" width="70" height="12" rx="3" fill="#f2c14e" stroke="#6b440c" stroke-width="2"/><path d="M236 144l-14 6 14 6z" fill="#e9c9a0" stroke="#6b440c" stroke-width="2"/><path d="M222 150l5-2v4z" fill="#333"/></g>
    <g font-family="Georgia" font-weight="700" font-size="14" fill="#f6ead2"><text x="20" y="190">?</text><text x="296" y="40">?</text></g></svg>`,
  howTo: {
    goal: 'Score the most points over all the rounds by guessing other people’s drawings quickly, and by drawing so well that others guess yours.',
    turn: [
      ['✏️', 'Take turns drawing', 'Each round everyone draws once. The drawer secretly picks one of three words and draws it. No letters or numbers!'],
      ['⌨️', 'Everyone else guesses', 'Type guesses in the box. Wrong guesses are shown to everyone; near misses are shown only to you.'],
      ['💡', 'Hints appear', 'Halfway through and again near the end, a letter of the word is revealed.'],
      ['🏅', 'Scoring', 'Guess faster for more points (up to 300). The drawer earns 50 for every player who guesses.'],
    ],
    tips: ['The host picks the number of rounds and the drawing time in the lobby.', 'Use the white brush as an eraser, Undo to remove your last line, and Give up if a drawing goes wrong.', 'Computer players can draw a few simple pictures, and guess from the hints.'],
  },
  setup, act, view, bot, render,
  turnOf: (s) => (s.over ? [] : s.phase === 'choose' ? [s.drawer] : s.players.map((p) => p.id)),
};
