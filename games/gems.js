// Gem Merchants — a gem-trading engine builder for 2–4 players.
// Collect gem tokens, buy development cards that give permanent gem bonuses,
// win the favour of patrons, and reach 15 prestige (the round is then finished).

import { injectCSS, snapshot, flip } from '../js/fx.js';
import { esc, log, addFx, shuffle, rand, toast, PLAYER_COLORS } from '../js/util.js';
import { sound } from '../js/sound.js';

/* =====================================================================
   Constants
   ===================================================================== */

const COLORS = ['white', 'blue', 'green', 'red', 'black'];
const TOKENS = [...COLORS, 'gold'];
const NAME = { white: 'Diamond', blue: 'Sapphire', green: 'Emerald', red: 'Ruby', black: 'Onyx', gold: 'Gold' };
const ROMAN = ['', 'I', 'II', 'III'];
const TIER_NAME = ['', 'Mine', 'Caravan', 'Palace'];
const GOAL = 15;
const LIMIT = 10;
const MAX_RES = 3;

// Gem palette: facet shading (hsl), chip colours, pip gradient, card band and tint.
const PAL = {
  white: { h: 208, s: 34, d: 50, m: 80, l: 99, chip: ['#fbf8f0', '#e1d9c6', '#9f947c'], ins: '#5d7ea6', inl: ['#7d96b8', '#2b3d5b'], pip: ['#ffffff', '#dfe8f1', '#98abc0'], band: 'rgba(232,240,248,.94)', tint: 'rgba(190,220,255,.32)' },
  blue: { h: 219, s: 86, d: 17, m: 45, l: 78, chip: ['#4f86e8', '#2156b8', '#0f2b6e'], ins: '#f1e8d2', inl: ['#fffaf0', '#d8c7a0'], pip: ['#9cc8ff', '#2f6fe0', '#123a8c'], band: 'rgba(30,84,196,.92)', tint: 'rgba(40,110,255,.34)' },
  green: { h: 152, s: 74, d: 13, m: 36, l: 72, chip: ['#38b67a', '#16804a', '#0a4527'], ins: '#f1e8d2', inl: ['#fffaf0', '#d8c7a0'], pip: ['#98f2c4', '#1f9e63', '#0a5233'], band: 'rgba(16,124,74,.92)', tint: 'rgba(30,200,120,.32)' },
  red: { h: 352, s: 82, d: 19, m: 46, l: 78, chip: ['#ec4d61', '#b01c32', '#5e0b17'], ins: '#f1e8d2', inl: ['#fffaf0', '#d8c7a0'], pip: ['#ffa3b0', '#d8283f', '#7a0a1c'], band: 'rgba(184,22,46,.92)', tint: 'rgba(255,50,80,.32)' },
  black: { h: 228, s: 12, d: 5, m: 19, l: 64, chip: ['#5e626e', '#30323b', '#141519'], ins: '#c9ccd6', inl: ['#f3f4f8', '#a2a8b6'], pip: ['#8f95a6', '#3a3d48', '#0e0f13'], band: 'rgba(28,30,38,.94)', tint: 'rgba(0,0,10,.45)' },
  gold: { pip: ['#fff4b8', '#f2c14e', '#9a6410'] },
};
const CUT = { white: 'round', blue: 'pear', green: 'emerald', red: 'trillion', black: 'hex' };

/* =====================================================================
   Deck, nobles (original procedural design)
   Cost offsets are relative to the card's own colour: 0 = same colour,
   1..4 = the next colours round the wheel. Every colour gets the same
   structure, rotated, so the deck is balanced.
   ===================================================================== */

const TEMPLATES = {
  1: [
    [0, { 1: 1, 2: 1, 3: 1, 4: 1 }],
    [0, { 1: 1, 2: 2, 3: 1, 4: 1 }],
    [0, { 1: 1, 3: 2 }],
    [0, { 2: 3 }],
    [0, { 2: 2, 4: 2 }],
    [0, { 0: 1, 1: 3, 3: 1 }],
    [0, { 0: 1, 3: 1, 4: 2 }],
    [1, { 4: 4 }],
  ],
  2: [
    [1, { 0: 2, 2: 2, 3: 3 }],
    [1, { 1: 3, 2: 2, 4: 1 }],
    [2, { 4: 5 }],
    [2, { 0: 1, 1: 4, 3: 2 }],
    [2, { 2: 3, 3: 5 }],
    [3, { 1: 6 }],
  ],
  3: [
    [3, { 0: 2, 1: 3, 2: 4, 4: 3 }],
    [4, { 4: 6, 1: 2 }],
    [4, { 0: 3, 2: 3, 3: 5 }],
    [5, { 2: 7, 3: 3 }],
  ],
};

function buildCards() {
  const cards = [];
  for (const t of [1, 2, 3]) {
    TEMPLATES[t].forEach(([p, offs], ti) => {
      COLORS.forEach((c, ci) => {
        const cost = {};
        for (const [o, n] of Object.entries(offs)) cost[COLORS[(ci + +o) % 5]] = n;
        cards.push({ id: '', t, c, p, cost, art: (ti + ci) % 2 });
      });
    });
  }
  return cards;
}

// [name, colour indexes, headwear, female, beard]
const NOBLE_DEFS = [
  ['Duchess Amaranth', [0, 2], 'tiara', 1, 0],
  ['Lord Castellan', [1, 3], 'crown', 0, 1],
  ['Margravine Isolde', [2, 4], 'hat', 1, 0],
  ['Emir Kasimir', [3, 0], 'turban', 0, 1],
  ['Baron Thaddeus', [4, 1], 'laurel', 0, 1],
  ['Queen Seraphine', [0, 1, 2], 'crown', 1, 0],
  ['Prince Aurelio', [1, 2, 3], 'laurel', 0, 0],
  ['Countess Liora', [2, 3, 4], 'tiara', 1, 0],
  ['Viceroy Halvard', [3, 4, 0], 'hat', 0, 1],
  ['Sultana Zahra', [4, 0, 1], 'turban', 1, 0],
];
function buildNobles() {
  return NOBLE_DEFS.map(([name, idx, hw, f, beard], i) => {
    const req = {};
    idx.forEach((k) => (req[COLORS[k]] = idx.length === 2 ? 4 : 3));
    return { id: 'n' + i, name, req, hw, f, beard, bg: i % 5 };
  });
}

/* =====================================================================
   Rules helpers (work on the full state and on views)
   ===================================================================== */

const zero = (keys) => Object.fromEntries(keys.map((k) => [k, 0]));
const tokenCount = (p) => TOKENS.reduce((a, c) => a + (p.gems[c] || 0), 0);
const deckCount = (s, t) => (Array.isArray(s.decks[t]) ? s.decks[t].length : s.decks[t] || 0);
const availColors = (s) => COLORS.filter((c) => s.bank[c] > 0);

// Gems a player would hand over for a card (colour first, gold as wild), or null.
function payment(p, card) {
  if (!p || !card || card.hidden) return null;
  const pay = {};
  let gold = 0;
  for (const c of COLORS) {
    const need = Math.max(0, (card.cost[c] || 0) - p.bonus[c]);
    const use = Math.min(need, p.gems[c]);
    if (use) pay[c] = use;
    gold += need - use;
  }
  if (gold > p.gems.gold) return null;
  if (gold) pay.gold = gold;
  return pay;
}
function missing(p, card) {
  let miss = 0;
  for (const c of COLORS) miss += Math.max(0, Math.max(0, (card.cost[c] || 0) - p.bonus[c]) - p.gems[c]);
  return Math.max(0, miss - p.gems.gold);
}
function findCard(s, p, id) {
  for (const t of [1, 2, 3]) {
    const i = s.market[t].findIndex((c) => c && c.id === id);
    if (i >= 0) return { card: s.market[t][i], from: 'market', t, i };
  }
  const r = p.reserved.findIndex((c) => c.id === id);
  if (r >= 0) return { card: p.reserved[r], from: 'reserved', t: p.reserved[r].t, i: r };
  return null;
}
function canPass(s, p) {
  if (availColors(s).length) return false;
  if (p.reserved.length < MAX_RES && [1, 2, 3].some((t) => deckCount(s, t) > 0 || s.market[t].some(Boolean))) return false;
  for (const t of [1, 2, 3]) for (const c of s.market[t]) if (c && payment(p, c)) return false;
  for (const c of p.reserved) if (payment(p, c)) return false;
  return true;
}
const eligibleNobles = (s, p) => s.nobles.filter((nb) => COLORS.every((c) => p.bonus[c] >= (nb.req[c] || 0)));
const aName = (c) => (/^[AEIOU]/.test(NAME[c]) ? "an " : "a ") + NAME[c];
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
function gemList(arr) {
  const counts = {};
  arr.forEach((c) => (counts[c] = (counts[c] || 0) + 1));
  const parts = Object.entries(counts).map(([c, n]) => (n > 1 ? `${n} ${NAME[c]}` : NAME[c]));
  return parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0];
}

// Throws a friendly error when the move is illegal. Returns details for act().
function validate(s, pid, a) {
  if (s.over) throw new Error('The game is over.');
  const p = s.players[s.cur];
  if (!p || p.id !== pid) throw new Error("It's not your turn.");
  if (!a || typeof a !== 'object') throw new Error('Unknown move.');

  if (s.phase === 'discard') {
    if (a.type !== 'discard') throw new Error(`Return gems down to ${LIMIT} first.`);
    const need = tokenCount(p) - LIMIT;
    const g = a.gems && typeof a.gems === 'object' ? a.gems : {};
    let sum = 0;
    for (const k of Object.keys(g)) {
      if (!TOKENS.includes(k)) throw new Error('Unknown gem.');
      const n = g[k];
      if (!Number.isInteger(n) || n < 0) throw new Error('Bad amount.');
      if (n > p.gems[k]) throw new Error(`You don't have ${n} ${NAME[k]}.`);
      sum += n;
    }
    if (sum !== need) throw new Error(`Return exactly ${plural(need, 'gem')}.`);
    return { p };
  }
  if (s.phase === 'noble') {
    if (a.type !== 'noble') throw new Error('Choose which patron visits you first.');
    if (!(s.nobleChoices || []).includes(a.id)) throw new Error('That patron cannot visit you.');
    return { p };
  }
  if (s.phase !== 'play') throw new Error('Not now.');

  switch (a.type) {
    case 'take': {
      const g = a.gems;
      if (!Array.isArray(g) || g.length < 1 || g.length > 3) throw new Error('Pick up to 3 gems.');
      for (const c of g) {
        if (c === 'gold') throw new Error('Gold only comes from reserving a card.');
        if (!COLORS.includes(c)) throw new Error('Unknown gem.');
      }
      if (g.length === 2 && g[0] === g[1]) {
        if (s.bank[g[0]] < 4) throw new Error(`You may take 2 ${NAME[g[0]]} only when 4 or more are in the bank.`);
        return { p };
      }
      if (new Set(g).size !== g.length) throw new Error('Take different colours, or 2 of one colour.');
      for (const c of g) if (s.bank[c] < 1) throw new Error(`No ${NAME[c]} left in the bank.`);
      const want = Math.min(3, availColors(s).length);
      if (g.length !== want) throw new Error(`Take ${want} different gems.`);
      return { p };
    }
    case 'reserve': {
      if (p.reserved.length >= MAX_RES) throw new Error('You can hold only 3 reserved cards.');
      const t = a.tier;
      if (![1, 2, 3].includes(t)) throw new Error('Unknown tier.');
      if (a.deck) {
        if (deckCount(s, t) < 1) throw new Error('That deck is empty.');
        return { p };
      }
      if (!Number.isInteger(a.slot) || a.slot < 0 || a.slot > 3 || !s.market[t][a.slot]) throw new Error('There is no card there.');
      return { p };
    }
    case 'buy': {
      const f = typeof a.id === 'string' ? findCard(s, p, a.id) : null;
      if (!f) throw new Error('That card is not available to you.');
      const pay = payment(p, f.card);
      if (!pay) throw new Error(`You need ${plural(missing(p, f.card), 'more gem')} for that card.`);
      return { p, f, pay };
    }
    case 'pass':
      if (!canPass(s, p)) throw new Error('You still have a legal move.');
      return { p };
    default:
      throw new Error('Unknown move.');
  }
}

/* =====================================================================
   State changes
   ===================================================================== */

function setup(players) {
  const n = players.length;
  const per = n <= 2 ? 4 : n === 3 ? 5 : 7;
  const bank = zero(COLORS);
  COLORS.forEach((c) => (bank[c] = per));
  bank.gold = 5;
  const all = buildCards();
  const ids = shuffle(all.map((_, i) => i + 1));
  all.forEach((c, i) => (c.id = 'c' + ids[i]));
  const decks = { 1: [], 2: [], 3: [] };
  for (const t of [1, 2, 3]) decks[t] = shuffle(all.filter((c) => c.t === t));
  const market = { 1: [], 2: [], 3: [] };
  for (const t of [1, 2, 3]) for (let i = 0; i < 4; i++) market[t].push(decks[t].pop());
  const s = {
    phase: 'play',
    seed: rand(1e9),
    players: players.map((p, i) => ({
      id: p.id, name: p.name, seat: i,
      gems: zero(TOKENS), bonus: zero(COLORS), cards: [], reserved: [], nobles: [], points: 0,
    })),
    cur: 0, turnNo: 0, round: 1,
    bank, decks, market,
    nobles: shuffle(buildNobles()).slice(0, n + 1),
    nobleChoices: null, finalRound: false,
    over: false, winners: [], log: [], fx: [], fxSeq: 0,
  };
  log(s, `${players[0].name} goes first. Reaching ${GOAL} prestige ends the game after the round.`);
  return s;
}

function refill(s, t, slot, delay) {
  if (s.decks[t].length) {
    s.market[t][slot] = s.decks[t].pop();
    addFx(s, { kind: 'sound', sound: 'flip', delay });
  } else s.market[t][slot] = null;
}

function finishTurn(s, p) {
  if (tokenCount(p) > LIMIT) {
    s.phase = 'discard';
    return;
  }
  checkNobles(s, p);
}

function checkNobles(s, p) {
  const el = eligibleNobles(s, p);
  if (!el.length) return endTurn(s);
  if (el.length === 1) {
    visit(s, p, el[0].id);
    return endTurn(s);
  }
  s.phase = 'noble';
  s.nobleChoices = el.map((nb) => nb.id);
}

function visit(s, p, id) {
  const i = s.nobles.findIndex((nb) => nb.id === id);
  const nb = s.nobles.splice(i, 1)[0];
  p.nobles.push(nb);
  p.points += 3;
  addFx(s, { from: nb.id, to: `p-${p.id}-nobles`, html: nobleHTML(nb), sound: 'chime', delay: 950, duration: 1050 });
  addFx(s, { kind: 'float', at: `p-${p.id}-score`, text: '+3', color: '#ffd76a', delay: 1900 });
  log(s, `${nb.name} visits ${p.name} (+3 prestige).`);
}

function endTurn(s) {
  s.phase = 'play';
  s.nobleChoices = null;
  if (!s.finalRound) {
    const lead = s.players.find((p) => p.points >= GOAL);
    if (lead) {
      s.finalRound = true;
      log(s, `${lead.name} reached ${lead.points} prestige. Final round!`);
    }
  }
  s.cur = (s.cur + 1) % s.players.length;
  s.turnNo++;
  if (s.cur === 0) {
    if (s.finalRound) return finish(s);
    s.round++;
  }
}

function finish(s) {
  s.over = true;
  s.phase = 'over';
  const best = Math.max(...s.players.map((p) => p.points));
  const top = s.players.filter((p) => p.points === best);
  const fewest = Math.min(...top.map((p) => p.cards.length));
  const win = top.filter((p) => p.cards.length === fewest);
  s.winners = win.map((p) => p.id);
  log(s, `${win.map((p) => p.name).join(' & ')} ${win.length > 1 ? 'share the victory' : 'wins'} with ${best} prestige!`);
}

function act(s, pid, a) {
  const v = validate(s, pid, a);
  const p = v.p;

  if (s.phase === 'discard') {
    let n = 0, k = 0;
    for (const c of TOKENS) {
      const m = a.gems[c] || 0;
      if (!m) continue;
      p.gems[c] -= m;
      s.bank[c] += m;
      n += m;
      addFx(s, { from: `p-${pid}-tok-${c}`, to: `gems-bank-${c}`, html: chipSVG(c), n: m, sound: c === 'gold' ? 'coin' : 'gem', delay: k++ * 160 });
    }
    log(s, `${p.name} returned ${plural(n, 'gem')} to the bank.`);
    s.phase = 'play';
    return checkNobles(s, p);
  }
  if (s.phase === 'noble') {
    visit(s, p, a.id);
    return endTurn(s);
  }

  if (a.type === 'take') {
    const counts = {};
    a.gems.forEach((c) => (counts[c] = (counts[c] || 0) + 1));
    let k = 0;
    for (const [c, n] of Object.entries(counts)) {
      s.bank[c] -= n;
      p.gems[c] += n;
      addFx(s, { from: `gems-bank-${c}`, to: `p-${pid}-tok-${c}`, html: chipSVG(c), n, sound: 'gem', delay: k * 170 });
      k += n;
    }
    log(s, `${p.name} took ${gemList(a.gems)}.`);
    return finishTurn(s, p);
  }

  if (a.type === 'reserve') {
    const t = a.tier;
    let card;
    if (a.deck) {
      card = s.decks[t].pop();
      card.blind = true;
    } else {
      card = s.market[t][a.slot];
      s.market[t][a.slot] = null;
    }
    p.reserved.push(card);
    const ri = p.reserved.length - 1;
    addFx(s, { from: a.deck ? `gems-deck-${t}` : card.id, to: `p-${pid}-res-${ri}`, html: a.deck ? hiddenCardHTML(t) : cardHTML(card), sound: 'card', delay: 0, duration: 800 });
    let gold = false;
    if (s.bank.gold > 0) {
      s.bank.gold--;
      p.gems.gold++;
      gold = true;
      addFx(s, { from: 'gems-bank-gold', to: `p-${pid}-tok-gold`, html: chipSVG('gold'), sound: 'coin', delay: 260 });
    }
    if (!a.deck) refill(s, t, a.slot, 520);
    log(s, a.deck
      ? `${p.name} reserved a face-down Tier ${ROMAN[t]} card${gold ? ' and took a gold' : ''}.`
      : `${p.name} reserved ${aName(card.c)} card (Tier ${ROMAN[t]})${gold ? ' and took a gold' : ''}.`);
    return finishTurn(s, p);
  }

  if (a.type === 'buy') {
    const { f, pay } = v;
    const card = f.card;
    if (f.from === 'market') s.market[f.t][f.i] = null;
    else p.reserved.splice(f.i, 1);
    addFx(s, { from: f.from === 'market' ? card.id : `p-${pid}-res-${f.i}`, to: `p-${pid}-bonus-${card.c}`, html: cardHTML(card), sound: 'card', delay: 0, duration: 850 });
    let k = 0;
    for (const c of TOKENS) {
      const n = pay[c] || 0;
      if (!n) continue;
      p.gems[c] -= n;
      s.bank[c] += n;
      addFx(s, { from: `p-${pid}-tok-${c}`, to: `gems-bank-${c}`, html: chipSVG(c), n, sound: c === 'gold' ? 'coin' : 'gem', delay: 180 + k++ * 150 });
    }
    delete card.blind;
    p.bonus[card.c]++;
    p.cards.push({ id: card.id, t: card.t, c: card.c, p: card.p });
    p.points += card.p;
    if (card.p) addFx(s, { kind: 'float', at: `p-${pid}-score`, text: `+${card.p}`, color: '#ffd76a', delay: 800 });
    if (f.from === 'market') refill(s, f.t, f.i, 560);
    log(s, `${p.name} bought ${aName(card.c)} card${card.p ? ` (+${card.p} prestige)` : ''}.`);
    return finishTurn(s, p);
  }

  if (a.type === 'pass') {
    log(s, `${p.name} has no legal move and passes.`);
    return endTurn(s);
  }
}

function turnOf(s) {
  if (s.over || !s.players[s.cur]) return [];
  return [s.players[s.cur].id];
}

function view(s, pid) {
  const v = JSON.parse(JSON.stringify(s));
  v.decks = { 1: deckCount(s, 1), 2: deckCount(s, 2), 3: deckCount(s, 3) };
  for (const p of v.players) {
    if (p.id !== pid) p.reserved = p.reserved.map((c) => (c.blind ? { id: c.id, t: c.t, hidden: true } : c));
  }
  return v;
}

/* =====================================================================
   Bot: greedy planner over the visible cards
   ===================================================================== */

function brain(v, me) {
  const lead = Math.max(...v.players.map((p) => p.points));
  const late = Math.min(1, lead / GOAL);
  const list = [];
  for (const t of [1, 2, 3]) v.market[t].forEach((c, i) => c && list.push({ card: c, where: 'market', t, i }));
  me.reserved.forEach((c, i) => !c.hidden && list.push({ card: c, where: 'reserved', t: c.t, i }));
  const nobleNeed = v.nobles.map((nb) => ({ nb, need: COLORS.reduce((a, c) => a + Math.max(0, (nb.req[c] || 0) - me.bonus[c]), 0) }));
  const totalBonus = COLORS.reduce((a, c) => a + me.bonus[c], 0);
  const demand = zero(COLORS);
  for (const e of list) for (const c of COLORS) demand[c] += Math.max(0, (e.card.cost[c] || 0) - me.bonus[c]) * (0.4 + e.card.p * 0.15);

  for (const e of list) {
    const card = e.card;
    const eff = {};
    let effTot = 0, miss = 0, scarce = 0;
    for (const c of COLORS) {
      eff[c] = Math.max(0, (card.cost[c] || 0) - me.bonus[c]);
      effTot += eff[c];
      const d = Math.max(0, eff[c] - me.gems[c]);
      miss += d;
      if (d > v.bank[c]) scarce += d - v.bank[c];
    }
    e.eff = eff;
    e.effTot = effTot;
    e.need = Math.max(0, miss - me.gems.gold);
    e.scarce = scarce;
    e.afford = !!payment(me, card);
    let val = card.p * (1.3 + 1.5 * late);
    for (const { nb, need } of nobleNeed) if ((nb.req[card.c] || 0) > me.bonus[card.c]) val += need <= 1 ? 5 : 4 / need;
    let eng = 0;
    for (const o of list) if (o !== e && (o.card.cost[card.c] || 0) > me.bonus[card.c]) eng += 0.14 + 0.05 * o.card.p;
    val += eng * Math.max(0.15, 1 - totalBonus / 12) * (1 - 0.7 * late);
    if (!card.p) val += 0.35 * Math.max(0, 1 - totalBonus / 8);
    if (e.where === 'reserved') val += 0.6;
    e.val = val;
    e.score = val / (1 + 0.5 * e.need + 0.9 * scarce);
  }
  const afford = list.filter((e) => e.afford).sort((a, b) => b.val - a.val);
  const targets = list.filter((e) => !e.afford && e.effTot <= LIMIT).sort((a, b) => b.score - a.score);
  return { late, list, afford, targets, demand, t1: targets[0] || null, t2: targets[1] || null };
}

function botTake(v, me, B) {
  const avail = availColors(v);
  if (!avail.length) return [];
  const d1 = {}, d2 = {};
  for (const c of COLORS) {
    d1[c] = B.t1 ? Math.max(0, B.t1.eff[c] - me.gems[c]) : 0;
    d2[c] = B.t2 ? Math.max(0, B.t2.eff[c] - me.gems[c]) : 0;
  }
  const w = {};
  for (const c of COLORS) w[c] = (d1[c] > 0 ? 10 + d1[c] : 0) + (d2[c] > 0 ? 3 + d2[c] * 0.5 : 0) + B.demand[c] * 0.25 - me.gems[c] * 0.3 + Math.random() * 0.2;
  const three = avail.slice().sort((a, b) => w[b] - w[a]).slice(0, Math.min(3, avail.length));
  const prog3 = three.reduce((a, c) => a + (d1[c] > 0 ? 3 : 0) + (d2[c] > 0 ? 1 : 0), 0);
  let two = null, prog2 = -1;
  for (const c of COLORS) {
    if (v.bank[c] < 4) continue;
    const pr = Math.min(2, d1[c]) * 3 + Math.min(2, d2[c]);
    if (pr > prog2) { prog2 = pr; two = c; }
  }
  const out = [];
  if (two && prog2 > prog3) out.push({ type: 'take', gems: [two, two] });
  out.push({ type: 'take', gems: three });
  if (two) out.push({ type: 'take', gems: [two, two] });
  return out;
}

function botReserve(v, me, B) {
  if (me.reserved.length >= MAX_RES || v.bank.gold < 1) return null;
  const t1 = B.t1;
  if (tokenCount(me) >= 9 && t1 && t1.where === 'market') return { type: 'reserve', tier: t1.t, slot: t1.i };
  if (me.reserved.length < 2) {
    const hv = B.targets.filter((e) => e.where === 'market' && e.card.p >= 3 && e.need <= 5).sort((a, b) => b.val - a.val)[0];
    if (hv && Math.random() < 0.1) return { type: 'reserve', tier: hv.t, slot: hv.i };
  }
  return null;
}

function botDiscard(v, me, B) {
  const excess = tokenCount(me) - LIMIT;
  const k1 = B.afford[0] || B.t1;
  const k2 = B.afford[0] ? B.t1 : B.t2;
  const units = [];
  for (const c of TOKENS) {
    for (let k = 1; k <= me.gems[c]; k++) {
      let keep = c === 'gold' ? 100 : B.demand[c] * 0.3 - k * 0.5;
      if (c !== 'gold') {
        if (k1 && k <= k1.eff[c]) keep += 20;
        if (k2 && k <= k2.eff[c]) keep += 6;
      }
      units.push({ c, keep });
    }
  }
  units.sort((a, b) => a.keep - b.keep);
  const out = {};
  for (const u of units.slice(0, excess)) out[u.c] = (out[u.c] || 0) + 1;
  return out;
}

function bot(v, pid) {
  const me = v.players.find((p) => p.id === pid);
  if (!me || v.over) return null;
  const pick = (list) => {
    for (const a of list) {
      if (!a) continue;
      try { validate(v, pid, a); return a; } catch {}
    }
    return null;
  };
  if (v.phase === 'noble') {
    const opts = (v.nobleChoices || []).map((id) => ({ type: 'noble', id }));
    return pick(opts);
  }
  const B = brain(v, me);
  if (v.phase === 'discard') {
    const naive = {};
    let left = tokenCount(me) - LIMIT;
    for (const c of TOKENS) { const n = Math.min(left, me.gems[c]); if (n) { naive[c] = n; left -= n; } }
    return pick([{ type: 'discard', gems: botDiscard(v, me, B) }, { type: 'discard', gems: naive }]);
  }
  const acts = [];
  const best = B.afford[0];
  if (best) {
    // Don't waste the turn on a weak card when a much better one is nearly in reach.
    const t = B.t1;
    const wait = t && t.need <= 3 && !t.scarce && t.val > best.val * 1.5 && tokenCount(me) <= 8;
    if (!wait) acts.push({ type: 'buy', id: best.card.id });
  }
  acts.push(botReserve(v, me, B));
  acts.push(...botTake(v, me, B));
  if (me.reserved.length < MAX_RES) {
    const m = B.list.filter((e) => e.where === 'market').sort((a, b) => b.val - a.val)[0];
    if (m) acts.push({ type: 'reserve', tier: m.t, slot: m.i });
    for (const t of [3, 2, 1]) acts.push({ type: 'reserve', tier: t, deck: true });
  }
  acts.push({ type: 'pass' });
  return pick(acts) || { type: 'pass' };
}

/* =====================================================================
   Art: procedural faceted gems, chips, card scenes, nobles, cover
   ===================================================================== */

const LIGHT = [-0.55, -0.83];
const r3 = (n) => +n.toFixed(3);
const PTS = (arr) => arr.map((p) => r3(p[0]) + ',' + r3(p[1])).join(' ');
const hsl = (h, s, l) => `hsl(${Math.round(h)},${Math.round(s)}%,${Math.round(Math.max(2, Math.min(99, l)))}%)`;

function outlineOf(cut) {
  if (cut === 'emerald') return [[-0.4, -0.96], [0.4, -0.96], [0.66, -0.7], [0.66, 0.7], [0.4, 0.96], [-0.4, 0.96], [-0.66, 0.7], [-0.66, -0.7]];
  if (cut === 'hex') return Array.from({ length: 6 }, (_, k) => { const a = (k * Math.PI) / 3; return [Math.sin(a) * 1.02, -Math.cos(a) * 1.02]; });
  const N = cut === 'trillion' ? 12 : 16;
  return Array.from({ length: N }, (_, i) => {
    const a = (i / N) * Math.PI * 2;
    if (cut === 'round') return [Math.sin(a) * 0.98, -Math.cos(a) * 0.98];
    if (cut === 'pear') return [Math.sin(a) * Math.pow(Math.sin(a / 2), 1.25) * 1.14, -Math.cos(a) * 0.99];
    const deg = (a * 180) / Math.PI;
    const phi = ((((deg % 120) + 120) % 120) - 60) * (Math.PI / 180);
    const r = (0.5 / Math.cos(phi)) * 0.84 + 0.16;
    return [Math.sin(a) * r * 1.12, -Math.cos(a) * r + 0.2];
  });
}

function sparkle(x, y, s, op = 0.95) {
  const w = s * 0.16;
  return `<polygon points="${PTS([[x, y - s], [x + w, y - w], [x + s, y], [x + w, y + w], [x, y + s], [x - w, y + w], [x - s, y], [x - w, y - w]])}" fill="#fff" opacity="${op}"/><circle cx="${r3(x)}" cy="${r3(y)}" r="${r3(s * 0.2)}" fill="#fff"/>`;
}

// A faceted gem in unit coordinates (about -1..1). pre makes the ids unique.
function gemMarkup(color, pre) {
  const P = PAL[color], cut = CUT[color], id = `${pre}-${color}`;
  let seed = 0;
  for (const ch of color + 'facet') seed = (seed * 31 + ch.charCodeAt(0)) | 0;
  seed = seed || 7;
  const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) % 10000) / 10000; };
  const shade = (b) => { b = Math.max(-1, Math.min(1, b)); return hsl(P.h, P.s, b >= 0 ? P.m + (P.l - P.m) * b : P.m + (P.m - P.d) * b); };
  const edge = color === 'white' ? 'rgba(70,100,140,.34)' : color === 'black' ? 'rgba(200,210,235,.22)' : 'rgba(255,255,255,.2)';
  const facet = (pts, b) => {
    const fill = color === 'white' && rnd() < 0.2 ? hsl([195, 288, 48, 165][Math.floor(rnd() * 4)], 70, 82) : shade(b);
    return `<polygon points="${PTS(pts)}" fill="${fill}" stroke="${edge}" stroke-width=".016" stroke-linejoin="round"/>`;
  };
  const O = outlineOf(cut);
  let c = [0, 0], T, body = '';
  if (cut === 'emerald' || cut === 'hex') {
    const rings = [1, 0.79, 0.6, 0.43].map((k) => O.map(([x, y]) => [x * k, y * k]));
    const N = O.length;
    for (let r = 0; r < 3; r++) {
      for (let j = 0; j < N; j++) {
        const A = rings[r][j], B = rings[r][(j + 1) % N], C = rings[r + 1][(j + 1) % N], D = rings[r + 1][j];
        const dx = B[0] - A[0], dy = B[1] - A[1], len = Math.hypot(dx, dy) || 1;
        const d = (dy / len) * LIGHT[0] + (-dx / len) * LIGHT[1];
        const b = r === 0 ? d * 1.05 : r === 1 ? -d * 0.6 + 0.12 : d * 0.75 + 0.3;
        body += facet([A, B, C, D], b + (rnd() - 0.5) * 0.3);
      }
    }
    T = rings[3];
  } else {
    const M = O.length / 2;
    c = cut === 'pear' ? [0, 0.28] : cut === 'trillion' ? [0, 0.22] : [0, 0];
    const k = cut === 'trillion' ? 0.45 : 0.52;
    T = Array.from({ length: M }, (_, j) => [c[0] + (O[2 * j][0] - c[0]) * k, c[1] + (O[2 * j][1] - c[1]) * k]);
    for (let j = 0; j < M; j++) {
      const t0 = T[j], t1 = T[(j + 1) % M], o0 = O[2 * j], om = O[2 * j + 1], o1 = O[(2 * j + 2) % O.length];
      for (const [a, b, e, bias, mul] of [[t0, o0, om, -0.12, 1], [t0, om, t1, 0.3, 0.6], [t1, om, o1, 0.05, 1]]) {
        const gx = (a[0] + b[0] + e[0]) / 3 - c[0], gy = (a[1] + b[1] + e[1]) / 3 - c[1], len = Math.hypot(gx, gy) || 1;
        const d = (gx * LIGHT[0] + gy * LIGHT[1]) / len;
        body += facet([a, b, e], d * mul + bias + (rnd() - 0.5) * 0.45);
      }
    }
  }
  const inner = T.map(([x, y]) => [c[0] + (x - c[0]) * 0.5 - 0.05, c[1] + (y - c[1]) * 0.5 - 0.05]);
  const sx = c[0] - 0.34, sy = c[1] - 0.4;
  return `<defs><linearGradient id="${id}-tb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${shade(0.95)}"/><stop offset=".55" stop-color="${shade(0.2)}"/><stop offset="1" stop-color="${shade(-0.3)}"/></linearGradient>` +
    `<radialGradient id="${id}-gl"><stop offset="0" stop-color="#fff" stop-opacity=".8"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>` +
    `<clipPath id="${id}-cl"><polygon points="${PTS(O)}"/></clipPath></defs>` +
    `<polygon points="${PTS(O)}" fill="${shade(-0.6)}"/>${body}` +
    `<polygon points="${PTS(T)}" fill="url(#${id}-tb)" stroke="${edge}" stroke-width=".016"/>` +
    `<polygon points="${PTS(inner)}" fill="${shade(0.7)}" opacity=".3"/>` +
    `<g clip-path="url(#${id}-cl)"><ellipse cx="${r3(sx + 0.05)}" cy="${r3(sy + 0.05)}" rx=".66" ry=".3" fill="url(#${id}-gl)" opacity=".6" transform="rotate(-38 ${r3(sx)} ${r3(sy)})"/></g>` +
    `<polygon points="${PTS(O)}" fill="none" stroke="${shade(-1)}" stroke-width=".05" stroke-linejoin="round"/>` +
    sparkle(sx, sy, 0.3);
}

const lg = (id, stops, x2 = 0, y2 = 1) => `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a != null ? ` stop-opacity="${a}"` : ''}/>`).join('')}</linearGradient>`;
const rg = (id, stops, cx = 0.5, cy = 0.5, r = 0.5) => `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${stops.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a != null ? ` stop-opacity="${a}"` : ''}/>`).join('')}</radialGradient>`;

function chipSymbol(c) {
  const P = PAL[c];
  const ins = Array.from({ length: 8 }, (_, k) => `<rect x="45.5" y="5.5" width="9" height="11" rx="2" fill="${P.ins}" transform="rotate(${k * 45 + 22.5} 50 50)"/>`).join('');
  return rg(`gems-chg-${c}`, [[0, P.chip[0]], [0.62, P.chip[1]], [1, P.chip[2]]], 0.38, 0.32, 0.75) +
    rg(`gems-inl-${c}`, [[0, P.inl[0]], [1, P.inl[1]]], 0.4, 0.35, 0.7) +
    `<symbol id="gems-edge-${c}" viewBox="0 0 100 100"><circle cx="50" cy="54" r="45" fill="${P.chip[2]}"/><circle cx="50" cy="50" r="45" fill="${P.chip[1]}"/>${ins}<circle cx="50" cy="50" r="45" fill="none" stroke="rgba(0,0,0,.35)"/></symbol>` +
    `<symbol id="gems-tok-${c}" viewBox="0 0 100 100"><circle cx="50" cy="54.5" r="45" fill="${P.chip[2]}"/><circle cx="50" cy="50" r="45" fill="url(#gems-chg-${c})"/>${ins}` +
    `<circle cx="50" cy="50" r="45" fill="none" stroke="rgba(0,0,0,.35)"/><circle cx="50" cy="50" r="34" fill="none" stroke="${P.ins}" stroke-opacity=".7" stroke-width="1.3" stroke-dasharray="2.6 2.2"/>` +
    `<circle cx="50" cy="50" r="30.5" fill="url(#gems-inl-${c})" stroke="rgba(0,0,0,.4)"/><ellipse cx="50" cy="63" rx="20" ry="6" fill="#000" opacity=".35" filter="url(#gems-blur)"/>` +
    `<use href="#gems-g-${c}" x="18" y="15" width="64" height="64"/><path d="M13 36 A40 40 0 0 1 70 11" fill="none" stroke="#fff" stroke-opacity=".32" stroke-width="3" stroke-linecap="round"/></symbol>`;
}

const COIN = rg('gems-coin1', [[0, '#fff6c4'], [0.45, '#f4c856'], [1, '#a86f12']], 0.35, 0.3, 0.8) +
  rg('gems-coin2', [[0, '#ffe9a0'], [0.6, '#e0a83a'], [1, '#9a6410']], 0.4, 0.35, 0.75) +
  `<path id="gems-crownp" d="M33 60 L30 40 L40.5 48.5 L50 33 L59.5 48.5 L70 40 L67 60Z M33 62.5 H67 V68 H33Z"/>` +
  `<symbol id="gems-edge-gold" viewBox="0 0 100 100"><circle cx="50" cy="54" r="45" fill="#7a4c0a"/><circle cx="50" cy="50" r="45" fill="#d9a33a"/><circle cx="50" cy="50" r="42" fill="none" stroke="#9a6410" stroke-width="3.5" stroke-dasharray="1.4 1.6"/></symbol>` +
  `<symbol id="gems-tok-gold" viewBox="0 0 100 100"><circle cx="50" cy="54.5" r="45" fill="#7a4c0a"/><circle cx="50" cy="50" r="45" fill="url(#gems-coin1)"/>` +
  `<circle cx="50" cy="50" r="42" fill="none" stroke="#9a6410" stroke-width="3.5" stroke-dasharray="1.4 1.6" opacity=".85"/>` +
  `<circle cx="50" cy="50" r="35" fill="url(#gems-coin2)" stroke="#8a5a0c" stroke-width="1.6"/><circle cx="50" cy="50" r="32" fill="none" stroke="#fff1b8" stroke-opacity=".55" stroke-width=".8"/>` +
  `<use href="#gems-crownp" fill="#7a4c0a" transform="translate(1.3 1.6)"/><use href="#gems-crownp" fill="#fff4c0" transform="translate(-.8 -.8)"/><use href="#gems-crownp" fill="url(#gems-coin1)"/>` +
  `<circle cx="30" cy="40" r="2.6" fill="#fff8d8"/><circle cx="50" cy="33" r="2.8" fill="#fff8d8"/><circle cx="70" cy="40" r="2.6" fill="#fff8d8"/>` +
  `<path d="M13 36 A40 40 0 0 1 70 11" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="3" stroke-linecap="round"/>${sparkle(30, 26, 7)}</symbol>`;

// Tier scenes (viewBox 0 0 100 140)
const SCENES =
  /* 1a: lantern-lit mine at dusk */
  lg('gems-s1a-sky', [[0, '#24173a'], [0.42, '#6e3552'], [0.72, '#d97a45'], [1, '#f7c56c']]) +
  lg('gems-s1a-hill', [[0, '#6a452d'], [1, '#1e120a']]) +
  rg('gems-s1a-glow', [[0, '#ffe08a', 1], [0.35, '#ffa040', 0.55], [1, '#ff7a1a', 0]]) +
  `<symbol id="gems-scene-1a" viewBox="0 0 100 140" preserveAspectRatio="xMidYMid slice"><rect width="100" height="140" fill="url(#gems-s1a-sky)"/>` +
  `<circle cx="26" cy="72" r="10" fill="#ffe7b0" opacity=".75"/><circle cx="26" cy="72" r="18" fill="#ffd590" opacity=".18"/>` +
  `<path d="M0 80 L12 64 L22 72 L36 52 L50 68 L62 56 L78 70 L90 60 L100 66 V106 H0Z" fill="#4a2a44" opacity=".9"/>` +
  `<path d="M0 92 L18 82 L30 88 L46 76 L60 86 L74 78 L100 90 V112 H0Z" fill="#3a2234"/>` +
  `<path d="M0 106 C18 94 36 82 58 78 C78 75 92 84 100 90 V140 H0Z" fill="url(#gems-s1a-hill)"/>` +
  `<circle cx="66" cy="106" r="26" fill="url(#gems-s1a-glow)"/><path d="M57 120 V104 Q66 92 75 104 V120Z" fill="#120804"/>` +
  `<path d="M58.6 105 Q66 95 73.4 105" fill="none" stroke="#ffb54d" stroke-width="1" opacity=".8"/>` +
  `<rect x="54" y="100" width="3.6" height="21" fill="#8b5a2b" stroke="#3a2210" stroke-width=".5"/><rect x="74.4" y="100" width="3.6" height="21" fill="#8b5a2b" stroke="#3a2210" stroke-width=".5"/>` +
  `<rect x="52" y="97" width="28" height="4" rx=".8" fill="#9c6a35" stroke="#3a2210" stroke-width=".5"/>` +
  `<circle cx="66" cy="102.5" r="4.5" fill="#ffd27a" opacity=".4"/><circle cx="66" cy="102.5" r="1.6" fill="#fff4c0"/>` +
  `<path d="M63 120 L53 140 M69 120 L79 140" stroke="#2a180c" stroke-width="1.4"/><path d="M60.6 125 H71.4 M58.8 130 H73.2 M56.6 135 H75.4" stroke="#4a2c16" stroke-width="1.2"/>` +
  `<path d="M32 122 H50 L47.5 131 H34.5Z" fill="#4a3426" stroke="#1c120a" stroke-width=".7"/><path d="M34 122 L37 117 L40 121 L43 116.5 L46 120.5 L48.5 122Z" fill="#5fd0ff"/><path d="M37 117 L40 121 L43 116.5Z" fill="#ff5e7e"/><path d="M43 116.5 L46 120.5 L48.5 122 L46.6 118Z" fill="#6aff9a"/>` +
  `<circle cx="37" cy="132" r="2.2" fill="#1c120a"/><circle cx="45" cy="132" r="2.2" fill="#1c120a"/>` +
  `<path d="M0 134 C22 129 42 133 62 130 C80 128 92 131 100 129 V140 H0Z" fill="#170d07"/></symbol>` +
  /* 1b: crystal cavern */
  rg('gems-s1b-bg', [[0, '#2f6a7a'], [0.5, '#173540'], [1, '#070d12']], 0.62, 0.66, 0.75) +
  lg('gems-s1b-c1', [[0, '#e6fdff'], [0.45, '#5fd6e8'], [1, '#1b6a8a']], 1, 1) +
  lg('gems-s1b-c2', [[0, '#f6e2ff'], [0.45, '#b27ae8'], [1, '#43247e']], 1, 1) +
  rg('gems-s1b-glow', [[0, '#9ff3ff', 0.75], [1, '#9ff3ff', 0]]) +
  `<symbol id="gems-scene-1b" viewBox="0 0 100 140" preserveAspectRatio="xMidYMid slice"><rect width="100" height="140" fill="url(#gems-s1b-bg)"/>` +
  `<circle cx="64" cy="104" r="40" fill="url(#gems-s1b-glow)"/>` +
  `<path d="M0 0 H100 V40 L94 34 L90 46 L84 36 L78 44 L72 34 L64 42 L58 30 L50 40 L44 32 L36 44 L30 34 L24 46 L16 36 L8 48 L0 40Z" fill="#0b0709"/>` +
  `<path d="M0 40 C10 60 6 90 12 140 H0Z" fill="#0d080b"/><path d="M100 40 C88 64 96 96 90 140 H100Z" fill="#0d080b"/>` +
  `<path d="M58 124 L60 96 L64.5 88 L69 96 L69 124Z" fill="url(#gems-s1b-c1)"/><path d="M60 96 L64.5 88 L64.5 124 L58 124Z" fill="#fff" opacity=".28"/>` +
  `<path d="M70 126 L73 102 L77 97 L80 103 L79 126Z" fill="url(#gems-s1b-c2)"/><path d="M73 102 L77 97 L76.5 126 L70 126Z" fill="#fff" opacity=".25"/>` +
  `<path d="M48 126 L50.6 110 L54 106 L56.6 111 L56 126Z" fill="url(#gems-s1b-c2)"/><path d="M50.6 110 L54 106 L53.4 126 L48 126Z" fill="#fff" opacity=".22"/>` +
  `<path d="M80 128 L83 116 L86 114 L88 118 L87 128Z" fill="url(#gems-s1b-c1)"/><path d="M38 128 L40 120 L43 118 L45 121 L44 128Z" fill="url(#gems-s1b-c1)"/>` +
  `<path d="M0 124 C30 118 70 118 100 126 V140 H0Z" fill="#0d1418"/><ellipse cx="64" cy="127" rx="26" ry="3" fill="#9ff3ff" opacity=".25"/>` +
  sparkle(66, 92, 3) + sparkle(78, 100, 2) + sparkle(46, 110, 1.6) + `</symbol>` +
  /* 2a: desert caravan */
  lg('gems-s2a-sky', [[0, '#1c2350'], [0.4, '#6a3a6a'], [0.68, '#e8783a'], [0.8, '#ffcf7a']]) +
  rg('gems-s2a-sun', [[0, '#fff6c8', 1], [0.35, '#ffd27a', 0.8], [1, '#ff9a3a', 0]]) +
  `<path id="gems-camel" d="M2 9 C2 6 4 5 6 5.5 C7.5 3 10 2.5 12 4.5 C13.5 2.5 16 3 17 5.5 C18.5 6 19 5 19.5 3.5 L20 1.5 C20.5 .6 22 .6 22.6 1.4 L23.4 2.6 L22 2.8 L21.4 6 C21 8 20 9.5 18.5 10 L18.6 18 L17.4 18 L17 11 L15.4 11 L15.2 18 L14 18 L13.6 11 C11 11.5 8.5 11.5 6.5 11 L6 18 L4.8 18 L4.8 11.2 L3.6 18 L2.4 18 L3 10.2 C2.4 10 2 9.6 2 9Z M10.4 3.6 L11 -1.6 L13.2 -1.6 L13.4 3.6Z M12.2 -1.4 m-1.4 0 a1.4 1.4 0 1 0 2.8 0 a1.4 1.4 0 1 0 -2.8 0"/>` +
  `<symbol id="gems-scene-2a" viewBox="0 0 100 140" preserveAspectRatio="xMidYMid slice"><rect width="100" height="140" fill="url(#gems-s2a-sky)"/>` +
  `<circle cx="66" cy="92" r="34" fill="url(#gems-s2a-sun)"/><circle cx="66" cy="92" r="12" fill="#fff3c0"/>` +
  `<path d="M0 98 C20 90 40 94 60 92 C80 90 92 94 100 92 V140 H0Z" fill="#c86a34"/>` +
  `<path d="M0 110 C24 100 46 102 62 106 C78 110 90 104 100 102 V140 H0Z" fill="#9a4a22"/>` +
  `<use href="#gems-camel" fill="#2a1206" transform="translate(40 92.5) scale(.5)"/><use href="#gems-camel" fill="#2a1206" transform="translate(53 94) scale(.5)"/><use href="#gems-camel" fill="#2a1206" transform="translate(66 96.5) scale(.46)"/>` +
  `<path d="M0 126 C30 114 60 120 100 112 V140 H0Z" fill="#5e2a12"/><path d="M8 126 C30 118 60 122 96 116" fill="none" stroke="#e89a5a" stroke-width=".6" opacity=".5"/>` +
  `<circle cx="18" cy="30" r=".6" fill="#fff"/><circle cx="34" cy="18" r=".5" fill="#fff"/><circle cx="82" cy="24" r=".6" fill="#fff"/><circle cx="60" cy="12" r=".5" fill="#fff"/></symbol>` +
  /* 2b: merchant ship at sunset */
  lg('gems-s2b-sky', [[0, '#0c1838'], [0.45, '#2c4a7a'], [0.7, '#e7a06a'], [0.76, '#f6c98a']]) +
  lg('gems-s2b-sea', [[0, '#2a5a7a'], [1, '#08182a']]) +
  lg('gems-s2b-sail', [[0, '#fff6e0'], [1, '#d6aa72']], 1, 0) +
  `<symbol id="gems-scene-2b" viewBox="0 0 100 140" preserveAspectRatio="xMidYMid slice"><rect width="100" height="140" fill="url(#gems-s2b-sky)"/>` +
  `<circle cx="28" cy="98" r="9" fill="#ffe2a8"/><circle cx="28" cy="98" r="20" fill="#ffcf8a" opacity=".2"/>` +
  `<rect y="104" width="100" height="36" fill="url(#gems-s2b-sea)"/><path d="M22 106 H34 L32 116 H24Z M24 120 H32 L31 128 H25Z" fill="#ffd89a" opacity=".35"/>` +
  `<path d="M44 102 L84 102 L79 111 L49 111Z" fill="#2a160c"/><path d="M78 95 L86 95 L84 102 L78 102Z" fill="#2a160c"/><path d="M44 102 L38 98 L46 100Z" fill="#2a160c"/>` +
  `<path d="M55 102 V62 M65 102 V54 M75 102 V64" stroke="#2a160c" stroke-width="1.2"/>` +
  `<path d="M58 58 Q65 61 72 58 L73 73 Q65 76 57 73Z M57 77 Q65 80 73 77 L74 93 Q65 96 56 93Z" fill="url(#gems-s2b-sail)" stroke="#8a6a42" stroke-width=".4"/>` +
  `<path d="M50 66 Q55 68 60 66 L60.6 78 Q55 80 49.4 78Z M49.4 82 Q55 84 60.6 82 L61 95 Q55 97 49 95Z" fill="url(#gems-s2b-sail)" stroke="#8a6a42" stroke-width=".4"/>` +
  `<path d="M70 68 Q75 70 80 68 L80.4 80 Q75 82 69.6 80Z M69.6 84 Q75 86 80.4 84 L80.8 95 Q75 97 69.2 95Z" fill="url(#gems-s2b-sail)" stroke="#8a6a42" stroke-width=".4"/>` +
  `<path d="M65 54 L72 56 L65 58Z" fill="#d8283f"/>` +
  `<path d="M6 116 q4 -2 8 0 q4 2 8 0 M52 118 q4 -2 8 0 q4 2 8 0 M18 128 q4 -2 8 0 q4 2 8 0 M66 132 q4 -2 8 0 q4 2 8 0" fill="none" stroke="#9fd0ff" stroke-width=".7" opacity=".5"/>` +
  `<circle cx="20" cy="22" r=".6" fill="#fff"/><circle cx="80" cy="30" r=".5" fill="#fff"/><circle cx="52" cy="16" r=".5" fill="#fff"/></symbol>` +
  /* 3a: moonlit palace */
  lg('gems-s3a-sky', [[0, '#070a24'], [0.45, '#1e1a52'], [0.72, '#5a2f6e'], [0.88, '#b0597a']]) +
  lg('gems-s3a-pal', [[0, '#2a1a4a'], [1, '#0e0820']]) +
  rg('gems-s3a-moon', [[0, '#fff6dc', 0.9], [1, '#fff6dc', 0]]) +
  `<symbol id="gems-scene-3a" viewBox="0 0 100 140" preserveAspectRatio="xMidYMid slice"><rect width="100" height="140" fill="url(#gems-s3a-sky)"/>` +
  [[14, 40], [30, 52], [44, 36], [86, 58], [92, 40], [56, 48], [22, 64], [8, 56]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r=".7" fill="#fff" opacity=".85"/>`).join('') +
  `<circle cx="76" cy="46" r="20" fill="url(#gems-s3a-moon)" opacity=".45"/><circle cx="76" cy="46" r="8" fill="#fff4d6"/>` +
  `<g fill="url(#gems-s3a-pal)"><rect x="16" y="98" width="68" height="18"/><rect x="40" y="82" width="20" height="16"/><path d="M38 84 C38 72 46 66 50 56 C54 66 62 72 62 84Z"/><rect x="49.4" y="50" width="1.2" height="7"/>` +
  `<path d="M20 98 C20 91 24 88 26 83 C28 88 32 91 32 98Z M68 98 C68 91 72 88 74 83 C76 88 80 91 80 98Z"/>` +
  `<rect x="11" y="72" width="4" height="44"/><path d="M10 73 C10 69 13 66 13 63 C13 66 16 69 16 73Z"/><rect x="85" y="72" width="4" height="44"/><path d="M84 73 C84 69 87 66 87 63 C87 66 90 69 90 73Z"/></g>` +
  `<g fill="#ffcf6a"><path d="M47 116 V108 Q50 103 53 108 V116Z"/><path d="M22 112 V106 Q24 103 26 106 V112Z M30 112 V106 Q32 103 34 106 V112Z M66 112 V106 Q68 103 70 106 V112Z M74 112 V106 Q76 103 78 106 V112Z"/><rect x="46" y="88" width="2" height="4" rx="1"/><rect x="52" y="88" width="2" height="4" rx="1"/></g>` +
  `<rect y="116" width="100" height="14" fill="#1a1d4a"/><g opacity=".22" fill="#ffcf6a"><path d="M47 116 V122 Q50 126 53 122 V116Z"/><rect x="16" y="116" width="68" height="3"/></g>` +
  `<path d="M0 130 H100 V140 H0Z" fill="#0a0618"/><ellipse cx="5" cy="112" rx="4" ry="18" fill="#0a0618"/><ellipse cx="95" cy="112" rx="4" ry="18" fill="#0a0618"/></symbol>` +
  /* 3b: golden citadel */
  lg('gems-s3b-sky', [[0, '#2a0f0a'], [0.4, '#8a3a1e'], [0.68, '#e88a3a'], [0.85, '#ffd98a']]) +
  lg('gems-s3b-cas', [[0, '#3a1a0a'], [1, '#140804']]) +
  `<symbol id="gems-scene-3b" viewBox="0 0 100 140" preserveAspectRatio="xMidYMid slice"><rect width="100" height="140" fill="url(#gems-s3b-sky)"/>` +
  `<g fill="#fff6d0" opacity=".1"><path d="M58 84 L20 30 L34 28Z"/><path d="M58 84 L60 26 L74 28Z"/><path d="M58 84 L96 40 L100 52Z"/></g>` +
  `<ellipse cx="24" cy="58" rx="16" ry="3.4" fill="#ffe8c0" opacity=".3"/><ellipse cx="80" cy="50" rx="14" ry="2.8" fill="#ffe8c0" opacity=".28"/>` +
  `<path d="M0 100 L16 84 L28 92 L44 78 L60 90 L76 80 L100 94 V120 H0Z" fill="#8a4a3a" opacity=".7"/>` +
  `<g fill="url(#gems-s3b-cas)"><path d="M30 140 L36 96 L44 90 L76 90 L84 100 L92 140Z"/><rect x="40" y="78" width="40" height="14"/><rect x="54" y="58" width="10" height="32"/><path d="M53 58 L59 42 L65 58Z"/>` +
  `<rect x="40" y="68" width="7" height="22"/><path d="M39 68 L43.5 57 L48 68Z"/><rect x="73" y="66" width="7" height="24"/><path d="M72 66 L76.5 55 L81 66Z"/>` +
  `<path d="M40 78 h3 v-2 h3 v2 h3 v-2 h3 v2 h3 v-2 h3 v2 h3 v-2 h3 v2 h3 v-2 h3 v2 h3 v-2 h4 v2 Z"/></g>` +
  `<path d="M59 42 V36 L66 38 L59 40" fill="#d8283f" stroke="#140804" stroke-width=".4"/><path d="M43.5 57 V52 L49 53.6 L43.5 55" fill="#2f6fe0"/><path d="M76.5 55 V50 L82 51.6 L76.5 53" fill="#1f9e63"/>` +
  `<g fill="#ffd36a"><rect x="58" y="64" width="2" height="3.4" rx="1"/><rect x="58" y="72" width="2" height="3.4" rx="1"/><rect x="43" y="72" width="1.6" height="3" rx=".8"/><rect x="75.6" y="70" width="1.6" height="3" rx=".8"/><rect x="50" y="82" width="1.6" height="3" rx=".8"/><rect x="66" y="82" width="1.6" height="3" rx=".8"/></g>` +
  `<path d="M14 40 q2 -2 4 0 q2 -2 4 0 M84 30 q1.6 -1.6 3.2 0 q1.6 -1.6 3.2 0" fill="none" stroke="#2a0f0a" stroke-width=".7"/></symbol>`;

const METAL = ['', '#dca660', '#dfe6f0', '#f4cd62'];
const BACKS = [1, 2, 3].map((t) => {
  const g = [null, ['#1f6a4a', '#0d3a28', '#062019'], ['#2a4f9a', '#142a5e', '#0a1634'], ['#8a1f3e', '#4e0c22', '#2a0512']][t];
  const m = METAL[t];
  const gem = ['', 'green', 'blue', 'red'][t];
  const corners = [[13, 13], [87, 13], [13, 127], [87, 127]].map(([x, y]) => `<path d="M${x} ${y - 3.4} L${x + 3.4} ${y} L${x} ${y + 3.4} L${x - 3.4} ${y}Z" fill="${m}" opacity=".85"/>`).join('');
  const dots = Array.from({ length: t }, (_, i) => `<path d="M${50 + (i - (t - 1) / 2) * 7} 27 l2.4 2.4 l-2.4 2.4 l-2.4 -2.4Z" fill="${m}"/>`).join('');
  return lg(`gems-bk${t}`, [[0, g[0]], [0.55, g[1]], [1, g[2]]], 1, 1) +
    `<pattern id="gems-lat${t}" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M5 0 L10 5 L5 10 L0 5Z" fill="none" stroke="${m}" stroke-opacity=".2" stroke-width=".7"/><circle cx="5" cy="5" r=".8" fill="${m}" fill-opacity=".3"/></pattern>` +
    rg(`gems-bkm${t}`, [[0, g[0]], [1, g[2]]], 0.4, 0.35, 0.7) +
    `<symbol id="gems-back-${t}" viewBox="0 0 100 140" preserveAspectRatio="xMidYMid slice"><rect width="100" height="140" fill="url(#gems-bk${t})"/><rect width="100" height="140" fill="url(#gems-lat${t})"/>` +
    `<rect width="100" height="140" fill="url(#gems-vign)"/><rect x="7" y="7" width="86" height="126" rx="7" fill="none" stroke="${m}" stroke-width="1.6" stroke-opacity=".9"/>` +
    `<rect x="10.5" y="10.5" width="79" height="119" rx="5" fill="none" stroke="${m}" stroke-width=".6" stroke-opacity=".6"/>${corners}${dots}` +
    `<circle cx="50" cy="68" r="19" fill="url(#gems-bkm${t})" stroke="${m}" stroke-width="2"/><circle cx="50" cy="68" r="15.6" fill="none" stroke="${m}" stroke-width=".6" stroke-dasharray="1.6 1.4"/>` +
    `<use href="#gems-g-${gem}" x="38" y="53" width="24" height="24"/>` +
    `<text x="50" y="104" text-anchor="middle" font-family="Cinzel, Georgia, serif" font-weight="800" font-size="15" fill="${m}" stroke="#000" stroke-opacity=".35" stroke-width=".6">${ROMAN[t]}</text>` +
    `<path d="M30 112 H70 M36 115 H64" stroke="${m}" stroke-opacity=".5" stroke-width=".6"/></symbol>`;
}).join('');

/* Noble cameo portraits */
const NOBLE_BG = [['#8fb4e0', '#3c5f94', '#162644'], ['#e8946a', '#a4472a', '#3e160b'], ['#a6cba2', '#4f7c58', '#1a3020'], ['#c29ad8', '#6a3f8c', '#26123a'], ['#9da2ae', '#40434e', '#121317']];
function laurel() {
  const P0 = [35.5, 31.5], P1 = [49, 13.5], P2 = [67.5, 29];
  let s = `<path d="M${P0} Q${P1} ${P2}" fill="none" stroke="#8a5a10" stroke-width=".8"/>`;
  for (let i = 1; i <= 9; i++) {
    const t = i / 10;
    const x = (1 - t) ** 2 * P0[0] + 2 * (1 - t) * t * P1[0] + t * t * P2[0];
    const y = (1 - t) ** 2 * P0[1] + 2 * (1 - t) * t * P1[1] + t * t * P2[1];
    const dx = 2 * (1 - t) * (P1[0] - P0[0]) + 2 * t * (P2[0] - P1[0]);
    const dy = 2 * (1 - t) * (P1[1] - P0[1]) + 2 * t * (P2[1] - P1[1]);
    const base = Math.atan2(dy, dx);
    for (const side of [-1, 1]) {
      const a = base + side * 0.6 + Math.PI;
      const cx = x + Math.cos(a) * 2.6, cy = y + Math.sin(a) * 2.6;
      s += `<ellipse cx="${r3(cx)}" cy="${r3(cy)}" rx="3" ry="1.2" fill="url(#gems-ngold)" stroke="#6a4510" stroke-width=".3" transform="rotate(${r3((a * 180) / Math.PI)} ${r3(cx)} ${r3(cy)})"/>`;
    }
  }
  return s;
}
const NOBLE_DEFS_SVG =
  NOBLE_BG.map((g, i) => rg(`gems-nbg${i}`, [[0, g[0]], [0.55, g[1]], [1, g[2]]], 0.62, 0.38, 0.85)).join('') +
  lg('gems-ivory', [[0, '#fffaf0'], [0.6, '#eadcc0'], [1, '#c4ae86']], 1, 1) +
  lg('gems-ivory2', [[0, '#f2e6cc'], [1, '#b89e74']], 1, 1) +
  lg('gems-ngold', [[0, '#fff3b0'], [0.5, '#e9b949'], [1, '#9a6a14']], 0.6, 1) +
  lg('gems-silk', [[0, '#d0668a'], [1, '#5a1032']], 1, 1) +
  lg('gems-velvet', [[0, '#5a3a80'], [1, '#1a0a2a']], 1, 1) +
  rg('gems-nhalo', [[0, '#fff', 0.32], [1, '#fff', 0]]) +
  rg('gems-vign', [[0.55, '#000', 0], [1, '#000', 0.45]], 0.5, 0.5, 0.75) +
  `<pattern id="gems-nlat" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0 4 L4 0 L8 4 L4 8Z" fill="none" stroke="#fff" stroke-opacity=".07" stroke-width=".5"/><circle cx="4" cy="4" r=".6" fill="#fff" opacity=".12"/></pattern>` +
  `<path id="gems-prof" d="M62.6 73.4 C69.4 65.6 71.6 54.4 70 44 C68 30.4 58.4 21.4 48.4 21.6 C40.4 21.8 35.2 27.6 35.2 34.8 C35.2 37 34.8 39 34.2 41 C32.8 43.4 30.6 46 30.8 48.4 C31.2 49.8 33 50.2 34 50.6 C33.4 52 33.6 53.2 34.6 53.8 C33.8 54.8 34 56.4 35 57 C34.6 59.6 35.6 62.4 38.6 63.6 C41 64.4 43 64.6 44.4 65.6 C44.8 68.8 45 71 45 74 C37 77 26 82 20 101 L86 101 C83.6 88 74.6 78.8 62.6 73.4Z"/>` +
  `<g id="gems-face"><path d="M37.2 41.4 Q39 40.3 40.8 41.3 Q39 42.2 37.2 41.4Z" fill="#7a5a3a" opacity=".55"/><path d="M36.6 38.4 Q39 37.2 42 38.2" fill="none" stroke="#9a7a58" stroke-width=".7" opacity=".6"/>` +
  `<path d="M34.6 55.3 Q35.6 55.6 36.6 55.2" fill="none" stroke="#9a7a58" stroke-width=".6" opacity=".7"/><path d="M45 64.6 C50 62.6 56 58.6 60 52.6" fill="none" stroke="#b8a07a" stroke-width=".6" opacity=".6"/></g>` +
  `<g id="gems-hair-f"><path d="M35.6 33.4 C35.8 25 42 20.4 49 20.4 C58 20.4 66.4 25 69.2 33 C71.2 40 70.2 48 68.2 54.4 C66.4 60 63.4 64 61.2 66 C62 58 61 50.4 58 44.4 C55 38.4 50 34.4 44 32.8 C41 32.2 38 32.8 35.6 33.4Z"/><circle cx="70" cy="27.6" r="7.4"/>` +
  `<path d="M44 27 C50 24 58 25 64 30 M48 31 C54 29 60 31 65 37 M60 44 C62 50 63 56 62 62 M66 23 C70 22 74 25 75 29" fill="none" stroke="#8a6a44" stroke-opacity=".4" stroke-width=".7"/></g>` +
  `<g id="gems-hair-m"><path d="M36.2 31.4 C37.2 24.4 43 20.4 49.6 20.4 C58 20.4 65 24.6 68 32 C69.6 37 69.6 43 68.2 48.6 C66.4 46.4 64.6 44.6 62.6 43.4 C60.4 37.4 55 33.4 48 31.8 C43.4 30.8 39.4 30.8 36.2 31.4Z"/>` +
  `<ellipse cx="59.4" cy="47.4" rx="2.6" ry="3.6" fill="url(#gems-ivory)" stroke="#a08868" stroke-width=".5"/><path d="M41 27 C47 24.4 55 25 61 29 M45 30 C51 28.6 57 30 62 34" fill="none" stroke="#8a6a44" stroke-opacity=".4" stroke-width=".7"/></g>` +
  `<path id="gems-beard" d="M60.4 50.4 C61.4 56.4 58.4 62.4 52.4 65.4 C47.4 67.4 41.4 66.9 38.8 63.8 C36.8 62.2 35.8 60 35.6 57.8 C38.2 59.2 41.2 59.6 44.2 58.6 C50.2 56.6 55.4 53.4 60.4 50.4Z"/>` +
  `<g id="gems-hw-crown"><path d="M36.6 29.6 L35.4 15.5 L41.6 21.4 L46.8 11 L52 20.2 L58 12.6 L60.2 21.8 L66.4 17.6 L65.6 28.8 C56 26 46 26.4 36.6 29.6Z" fill="url(#gems-ngold)" stroke="#6a4510" stroke-width=".6"/>` +
  `<path d="M36.4 29.4 C46 26.2 56 25.8 65.8 28.6 L66 32 C56 29.2 46 29.6 36.8 33Z" fill="#b8841f" stroke="#6a4510" stroke-width=".5"/>` +
  `<circle cx="35.4" cy="15.5" r="1.3" fill="#fff6dc"/><circle cx="46.8" cy="11" r="1.4" fill="#fff6dc"/><circle cx="58" cy="12.6" r="1.3" fill="#fff6dc"/><circle cx="66.4" cy="17.6" r="1.2" fill="#fff6dc"/></g>` +
  `<g id="gems-hw-tiara"><path d="M37 30.6 C44 25 56 24 66.4 27.6 L65.8 30 C56 27 45 27.8 38 32.6Z" fill="url(#gems-ngold)" stroke="#6a4510" stroke-width=".5"/>` +
  `<path d="M46.6 26.2 L50.6 15 L54.6 25.6Z M41 28 L42.6 22.6 L44.6 27.2Z M57 26.2 L59 21.4 L60.6 26.6Z" fill="url(#gems-ngold)" stroke="#6a4510" stroke-width=".45"/></g>` +
  `<g id="gems-hw-turban"><path d="M33.4 33.6 C30.6 22 38 12.4 50 11 C62.4 9.8 72.4 16.4 72.8 28.4 C72.9 33.4 71.2 37.6 69 40.6 C64 35.4 56 32.2 48 31.2 C42 30.6 37 31.8 33.4 33.6Z" fill="url(#gems-silk)" stroke="#2a1a10" stroke-width=".6"/>` +
  `<path d="M35 27 C44 21 58 20 70 25 M34.6 31 C44 25.6 58 25 71 30 M38 19 C46 15 58 15 68 19" fill="none" stroke="#fff" stroke-opacity=".3" stroke-width="1"/>` +
  `<path d="M40.6 22 C36.6 13 38.6 6 44.6 1.6 C43.2 8.6 44.2 14.6 43.4 22Z" fill="url(#gems-ivory)" stroke="#8a7050" stroke-width=".4"/></g>` +
  `<g id="gems-hw-hat"><path d="M29.4 32 C30.6 21.4 44 15.6 58.4 16 C68.6 16.4 75.6 21.2 75.6 27.4 C75.6 30.4 72.4 31.4 68.4 30.4 C58 27.8 44 28.8 29.4 34.6Z" fill="url(#gems-velvet)" stroke="#12081a" stroke-width=".6"/>` +
  `<path d="M30 33 C44 27.6 58 26.8 70 29.6" fill="none" stroke="url(#gems-ngold)" stroke-width="1.6"/>` +
  `<path d="M60 19 C66 7.4 80 1.6 94 4.4 C84 7 75 12 64.4 21Z" fill="url(#gems-ivory)" stroke="#8a7050" stroke-width=".4"/><path d="M63 19 C70 11 80 7 90 5.6" fill="none" stroke="#a89070" stroke-width=".4"/></g>` +
  `<g id="gems-hw-laurel">${laurel()}</g>`;
const SPOTS = {
  crown: [[43.4, 30.2, 1.5], [51.2, 28.6, 1.7], [59.2, 29.2, 1.5]],
  tiara: [[50.6, 21.6, 2], [42.8, 26.4, 1.1], [58.8, 24.8, 1.1]],
  turban: [[41.4, 24.4, 2.4]],
  hat: [[49, 26.4, 1.9]],
  laurel: [],
};
const jewel = (x, y, c, r) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${PAL[c].pip[1]}" stroke="#4a2a05" stroke-width=".45"/><circle cx="${r3(x - r * 0.35)}" cy="${r3(y - r * 0.35)}" r="${r3(r * 0.34)}" fill="#fff" opacity=".85"/>`;

function nobleArt(nb) {
  const js = COLORS.filter((c) => nb.req[c]);
  const spots = SPOTS[nb.hw].map((s, i) => jewel(s[0], s[1], js[i % js.length], s[2])).join('');
  const deco = nb.f
    ? `<path d="M45 72 C50.6 75.6 57.6 75 62.8 71.8" fill="none" stroke="url(#gems-ngold)" stroke-width="1.3"/>${jewel(53.8, 76.6, js[js.length - 1], 2.3)}`
    : `<path d="M45 76 C40 80 34 86 30 96" fill="none" stroke="#8a6a44" stroke-opacity=".35" stroke-width="1"/><circle cx="44" cy="88" r="4" fill="url(#gems-ngold)" stroke="#6a4510" stroke-width=".5"/>${jewel(44, 88, js[js.length - 1], 2.5)}`;
  return `<svg class="gems-portrait" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true">` +
    `<rect width="100" height="100" fill="url(#gems-nbg${nb.bg})"/><rect width="100" height="100" fill="url(#gems-nlat)"/><ellipse cx="62" cy="50" rx="40" ry="46" fill="url(#gems-nhalo)"/>` +
    `<g transform="translate(14 6)"><use href="#gems-prof" fill="#000" opacity=".42" transform="translate(1.5 1.7)"/><use href="#gems-prof" fill="url(#gems-ivory)"/><use href="#gems-face"/>` +
    `<use href="#gems-hair-${nb.f ? 'f' : 'm'}" fill="url(#gems-ivory2)"/>${nb.beard ? '<use href="#gems-beard" fill="url(#gems-ivory2)"/>' : ''}` +
    `<use href="#gems-hw-${nb.hw}"/>${spots}${deco}</g></svg>`;
}

const CREST = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9 L7.5 12.5 L12 5 L16.5 12.5 L21 9 L19 19 H5Z" fill="url(#gems-ngold)" stroke="#5a3a0a" stroke-width="1.1" stroke-linejoin="round"/><circle cx="12" cy="15" r="1.8" fill="#d8283f"/></svg>`;

let defsHTML = null;
function ensureDefs() {
  if (document.getElementById('gems-defs')) return;
  if (!defsHTML) {
    defsHTML = `<svg id="gems-defs" xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true"><defs>` +
      `<filter id="gems-blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.4"/></filter>` +
      COLORS.map((c) => `<symbol id="gems-g-${c}" viewBox="-1.15 -1.15 2.3 2.3">${gemMarkup(c, 'gems-gm')}</symbol><symbol id="gems-sh-${c}" viewBox="-1.15 -1.15 2.3 2.3"><polygon points="${PTS(outlineOf(CUT[c]))}" fill="currentColor"/></symbol>`).join('') +
      `<symbol id="gems-sh-gold" viewBox="-1.15 -1.15 2.3 2.3"><circle r="1" fill="currentColor"/></symbol>` +
      COLORS.map(chipSymbol).join('') + COIN + SCENES + NOBLE_DEFS_SVG + BACKS +
      `</defs></svg>`;
  }
  const d = document.createElement('div');
  d.innerHTML = defsHTML;
  document.body.appendChild(d.firstElementChild);
}

/* Cover art: a glowing treasure chest spilling gems (self-contained ids) */
function coverSVG() {
  const gem = (c, x, y, s, rot = 0) => `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})">${gemMarkup(c, 'gmc')}</g>`;
  const glow = (x, y, r, col, o = 0.55) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${col}" opacity="${o}" filter="url(#gmc-blur)"/>`;
  const coin = (x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})"><ellipse cx="0" cy="2.4" rx="11" ry="4.2" fill="#7a4c0a"/><ellipse cx="0" cy="0" rx="11" ry="4.2" fill="url(#gmc-coin)" stroke="#9a6410" stroke-width=".6"/><ellipse cx="0" cy="0" rx="7" ry="2.5" fill="none" stroke="#fff3b8" stroke-opacity=".6" stroke-width=".6"/></g>`;
  const stack = (x, y, n) => Array.from({ length: n }, (_, i) => coin(x + (i % 2 ? 0.8 : -0.6), y - i * 3.2)).join('');
  const sp = (x, y, s) => sparkle(x, y, s);
  return `<svg viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice"><defs>` +
    rg('gmc-bg', [[0, '#4a2a62'], [0.45, '#1e0f30'], [1, '#07040c']], 0.5, 0.42, 0.75) +
    rg('gmc-glow', [[0, '#fff3b0', 0.95], [0.35, '#ffc24a', 0.6], [1, '#ff8a1a', 0]]) +
    rg('gmc-coin', [[0, '#fff6c4'], [0.5, '#f2c14e'], [1, '#a86f12']], 0.4, 0.3, 0.8) +
    lg('gmc-wood', [[0, '#8a5530'], [1, '#3a1f0c']]) +
    lg('gmc-lid', [[0, '#5a1424'], [1, '#2a0610']]) +
    lg('gmc-band', [[0, '#ffe9a0'], [0.5, '#d8a23a'], [1, '#8a5a10']], 1, 0) +
    lg('gmc-ray', [[0, '#fff6d0', 0.35], [1, '#fff6d0', 0]], 0, 0) +
    rg('gmc-velvet', [[0, '#6a1028'], [1, '#14040a']], 0.5, 0.2, 0.8) +
    `<filter id="gmc-blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9"/></filter></defs>` +
    `<rect width="320" height="200" fill="url(#gmc-bg)"/>` +
    `<g opacity=".6"><path d="M160 96 L96 -10 L130 -10Z" fill="url(#gmc-ray)"/><path d="M160 96 L148 -10 L176 -10Z" fill="url(#gmc-ray)"/><path d="M160 96 L196 -10 L232 -10Z" fill="url(#gmc-ray)"/><path d="M160 96 L40 0 L64 -10Z" fill="url(#gmc-ray)"/><path d="M160 96 L262 -10 L290 0Z" fill="url(#gmc-ray)"/></g>` +
    `<ellipse cx="160" cy="206" rx="230" ry="62" fill="url(#gmc-velvet)"/>` +
    `<circle cx="160" cy="92" r="96" fill="url(#gmc-glow)" opacity=".38"/>` +
    `<path d="M108 98 L114 50 Q160 34 206 50 L212 98Z" fill="url(#gmc-lid)" stroke="#2a0a10" stroke-width="2"/><path d="M114 50 Q160 34 206 50" fill="none" stroke="url(#gmc-band)" stroke-width="5"/>` +
    `<path d="M126 52 L122 98 M194 52 L198 98" stroke="url(#gmc-band)" stroke-width="5"/>` +
    `<ellipse cx="160" cy="100" rx="56" ry="14" fill="url(#gmc-glow)"/>` +
    gem('blue', 136, 92, 12, -20) + gem('green', 182, 90, 12, 14) + gem('white', 159, 86, 13) +
    `<path d="M104 100 H216 L210 160 H110Z" fill="url(#gmc-wood)" stroke="#1e0e05" stroke-width="2"/>` +
    `<path d="M104 100 H216 L215 110 H105Z" fill="url(#gmc-band)"/><path d="M124 100 L126 160 M196 100 L194 160" stroke="url(#gmc-band)" stroke-width="6"/>` +
    `<path d="M108 124 H212" stroke="#2a1508" stroke-width="1.2" opacity=".6"/><path d="M109 140 H211" stroke="#2a1508" stroke-width="1.2" opacity=".6"/>` +
    `<rect x="150" y="112" width="20" height="22" rx="3" fill="url(#gmc-band)" stroke="#5a3a0a" stroke-width="1.2"/><circle cx="160" cy="121" r="3" fill="#2a1508"/><path d="M158.6 122 L157.6 129 H162.4 L161.4 122Z" fill="#2a1508"/>` +
    stack(62, 170, 6) + stack(84, 176, 4) + stack(252, 172, 7) + stack(232, 178, 3) +
    coin(112, 182, 1) + coin(206, 186, 0.9) + coin(282, 186, 0.8) + coin(40, 186, 0.8) +
    glow(118, 160, 26, '#3d7fff') + glow(206, 158, 26, '#2fe08a') + glow(146, 180, 20, '#ff3a5a') + glow(176, 182, 18, '#9aa4c0', 0.35) + glow(160, 132, 30, '#cfe8ff', 0.4) +
    gem('blue', 118, 160, 19, -14) + gem('green', 206, 158, 20, 10) + gem('red', 144, 178, 16, 8) + gem('black', 178, 180, 14, -8) + gem('white', 160, 140, 24) +
    sp(96, 70, 7) + sp(226, 60, 6) + sp(178, 128, 5) + sp(128, 146, 4) + sp(262, 140, 5) + sp(52, 128, 4) + sp(290, 96, 3) + sp(30, 70, 3) +
    `</svg>`;
}

/* =====================================================================
   HTML pieces
   ===================================================================== */

const chipSVG = (c) => `<svg class="gems-chip" viewBox="0 0 100 100"><use href="#gems-tok-${c}"/></svg>`;
const edgeSVG = (c) => `<svg class="gems-chip" viewBox="0 0 100 100"><use href="#gems-edge-${c}"/></svg>`;
const pipHTML = (c, n, cls = 'gems-pip') => `<span class="${cls} gems-c-${c}"><svg viewBox="0 0 100 100" aria-hidden="true"><use href="#gems-sh-${c}"/></svg><b>${n}</b></span>`;
const backArt = (t) => `<svg class="gems-art" viewBox="0 0 100 140" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><use href="#gems-back-${t}"/></svg>`;

function cardHTML(card, o = {}) {
  const pts = card.p ? `<span class="gems-pts">${card.p}</span>` : '<span></span>';
  const pips = COLORS.filter((c) => card.cost[c]).map((c) => pipHTML(c, card.cost[c])).join('');
  const front = `<div class="gems-face gems-front"><svg class="gems-art" viewBox="0 0 100 140" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><use href="#gems-scene-${card.t}${card.art ? 'b' : 'a'}"/></svg>` +
    `<div class="gems-tint"></div><div class="gems-band">${pts}<svg class="gems-bonus" viewBox="0 0 100 100" aria-hidden="true"><use href="#gems-g-${card.c}"/></svg></div><div class="gems-cost">${pips}</div></div>`;
  const back = o.back ? `<div class="gems-face gems-backface">${backArt(card.t)}</div>` : '';
  return `<div class="gems-card gems-t${card.t} gems-b-${card.c} ${o.cls || ''}" ${o.attrs || ''}><div class="gems-flipper">${front}${back}</div></div>`;
}
const hiddenCardHTML = (t, o = {}) => `<div class="gems-card gems-t${t} gems-hidden ${o.cls || ''}" ${o.attrs || ''}><div class="gems-flipper"><div class="gems-face">${backArt(t)}</div></div></div>`;

function nobleHTML(nb, o = {}) {
  const req = COLORS.filter((c) => nb.req[c]).map((c) => pipHTML(c, nb.req[c], 'gems-nb')).join('');
  return `<div class="gems-noble ${o.cls || ''}" ${o.attrs || ''}>${nobleArt(nb)}<span class="gems-npts">3</span><div class="gems-nreq">${req}</div></div>`;
}

function deckStyle(n, t) {
  const d = Math.min(6, Math.ceil(n / 5));
  const parts = [];
  for (let k = 1; k <= d; k++) parts.push(`${r3(k * 1.1)}px ${r3(k * 1.6)}px 0 ${k % 2 ? ['', '#4a2c12', '#3a4250', '#6a4a0a'][t] : METAL[t]}`);
  parts.push(`${r3(d * 1.1 + 2)}px ${r3(d * 1.6 + 5)}px 10px rgba(0,0,0,.5)`);
  return `box-shadow:${parts.join(',')}`;
}
function bonusStyle(n) {
  const parts = [];
  for (let k = 1; k <= Math.min(n - 1, 5); k++) parts.push(`0 ${-k * 3}px 0 -1px var(--${k % 2 ? 'p3' : 'p1'})`);
  parts.push('0 2px 3px rgba(0,0,0,.55)');
  return `box-shadow:${parts.join(',')}`;
}

/* =====================================================================
   Rendering
   ===================================================================== */

const ui = { key: null, sel: [], disc: {}, modal: null, shown: false };
let last = null;
let renders = 0;
let prevSeed = null;
let prevMarket = new Set();
let prevRes = new Set();
let prevSel = [];

function rerender() {
  if (!last || !last.el.isConnected) return;
  const before = snapshot(last.el);
  render(last.el, last.v, last.ctx);
  flip(last.el, before);
}

function render(el, v, ctx) {
  injectCSS('gems', CSS);
  ensureDefs();
  renders++;
  last = { el, v, ctx };
  const meP = v.players.find((p) => p.id === ctx.me) || null;
  const cur = v.players[v.cur];
  const myTurn = !!meP && !v.over && cur && cur.id === meP.id;
  const key = `${v.seed}|${v.turnNo}|${v.phase}|${ctx.me}`;
  if (ui.key !== key) {
    ui.key = key;
    ui.sel = [];
    ui.disc = {};
  }
  if (!myTurn || v.phase !== 'play') ui.sel = [];
  const canPlay = myTurn && v.phase === 'play';

  // Which market cards are new since the last render (they deal in from the deck)?
  const initial = prevSeed !== v.seed;
  const marketIds = [1, 2, 3].flatMap((t) => v.market[t].filter(Boolean).map((c) => c.id));
  const fresh = new Set(initial ? [] : marketIds.filter((id) => !prevMarket.has(id)));
  const resIds = v.players.flatMap((p) => p.reserved.map((c) => c.id));
  const freshRes = new Set(initial ? [] : resIds.filter((id) => !prevRes.has(id)));

  // ---- nobles ----
  const choices = v.phase === 'noble' && myTurn ? v.nobleChoices || [] : [];
  const nobles = v.nobles.map((nb) => `<div class="gems-nwrap">${nobleHTML(nb, {
    cls: choices.includes(nb.id) ? 'pulse-glow gems-choose' : choices.length ? 'gems-dim' : '',
    attrs: `data-k="${nb.id}" data-act="noble" data-id="${nb.id}" role="button" tabindex="0" aria-label="${esc(nb.name)}"`,
  })}<div class="gems-nname">${esc(nb.name)}</div></div>`).join('');

  // ---- tiers ----
  const tiers = [3, 2, 1].map((t) => {
    const n = v.decks[t];
    const deck = `<div class="gems-deck gems-t${t} ${n ? '' : 'gems-dempty'}" data-act="deck" data-t="${t}" data-a="gems-deck-${t}" role="button" tabindex="0" aria-label="Tier ${ROMAN[t]} deck, ${n} cards" style="${n ? deckStyle(n, t) : ''}">${n ? backArt(t) : ''}<span class="gems-dcount">${n}</span></div>`;
    const slots = v.market[t].map((c, i) => {
      if (!c) return '<div class="gems-slot"></div>';
      let cls = '', dd = '';
      if (initial) { cls = 'gems-deal'; dd = `--dd:${(0.2 + ((3 - t) * 4 + i) * 0.08).toFixed(2)}s;`; }
      else if (fresh.has(c.id)) { cls = 'gems-deal'; dd = '--dd:.42s;'; }
      if (canPlay && payment(meP, c)) cls += ' gems-can pulse-glow';
      return cardHTML(c, { back: true, cls, attrs: `data-k="${c.id}" data-noenter data-act="card" data-id="${c.id}" role="button" tabindex="0" aria-label="${NAME[c.c]} card, ${c.p} prestige" style="--slot:${i};${dd}"` });
    }).join('');
    return `<div class="gems-tier">${deck}${slots}</div>`;
  }).join('');

  // ---- bank ----
  const bank = TOKENS.map((c) => {
    const total = v.bank[c];
    const selN = ui.sel.filter((x) => x === c).length;
    const left = total - selN;
    const layers = Math.min(left, 6);
    let h = '';
    for (let i = 0; i < layers; i++) h += `<span class="gems-layer" style="--i:${i}">${i === layers - 1 ? chipSVG(c) : edgeSVG(c)}</span>`;
    const had = prevSel.filter((x) => x === c).length;
    const lift = Array.from({ length: selN }, (_, j) => `<span class="gems-lift ${j >= had ? 'gems-lnew' : ''}" style="--j:${j}">${chipSVG(c)}</span>`).join('');
    const cls = [selN ? 'gems-psel' : '', canPlay && c !== 'gold' && left > 0 ? 'gems-pick' : '', total ? '' : 'gems-pempty'].join(' ');
    return `<div class="gems-pile gems-pile-${c} ${cls}" data-act="bank" data-c="${c}" role="button" tabindex="0" aria-label="${NAME[c]}: ${left} in the bank" style="--top:${Math.max(0, layers - 1)}">` +
      `<div class="gems-stack">${layers ? '' : '<span class="gems-ghostchip"></span>'}${h}<span class="gems-anchor" data-a="gems-bank-${c}"></span>${lift}</div><span class="gems-count">${left}</span></div>`;
  }).join('');

  // ---- players (you first) ----
  const order = meP ? [...v.players.slice(meP.seat), ...v.players.slice(0, meP.seat)] : v.players;
  const panels = order.map((p) => panelHTML(v, p, ctx, meP, canPlay, freshRes)).join('');

  el.innerHTML = `<div class="game-layout gems-layout">
    <div class="felt gems-felt"><div class="gems-table">
      ${statusHTML(v, ctx, meP, myTurn)}
      <div class="gems-nobles">${nobles}</div>
      <div class="gems-tiers">${tiers}</div>
      <div class="gems-bank">${bank}</div>
      ${trayHTML(v, meP, myTurn)}
    </div></div>
    <div class="side gems-side">${panels}
      <div class="parchment gems-ledger"><h4>Ledger</h4><div class="log">${(v.log || []).map((l) => `<div>${esc(l)}</div>`).join('')}</div></div>
    </div>
  </div>${modalHTML(v, meP, myTurn)}`;

  prevSel = ui.sel.slice();
  prevSeed = v.seed;
  prevMarket = new Set(marketIds);
  prevRes = new Set(resIds);
  if (ui.modal) ui.shown = true;

  el.onclick = (e) => onClick(e);
  el.onkeydown = (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"]')) { e.preventDefault(); e.target.click(); }
    if (e.key === 'Escape' && ui.modal) { ui.modal = null; rerender(); }
  };
}

function statusHTML(v, ctx, meP, myTurn) {
  if (v.over) {
    const ws = v.winners.map((id) => v.players.find((p) => p.id === id)?.name || '?');
    const ranked = [...v.players].sort((a, b) => b.points - a.points || a.cards.length - b.cards.length);
    return `<div class="gems-status gems-over"><div class="winner-banner">🏆 ${esc(ws.join(' & '))} ${ws.length > 1 ? 'share the win' : 'wins'}!</div>
      <div class="gems-standings">${ranked.map((p, i) => `<span class="${v.winners.includes(p.id) ? 'gems-win' : ''}"><b>${i + 1}.</b> ${esc(p.name)} <em>${p.points}★</em> <small>${plural(p.cards.length, 'card')}</small></span>`).join('')}</div></div>`;
  }
  const cur = v.players[v.cur];
  const col = PLAYER_COLORS[cur.seat % PLAYER_COLORS.length];
  let hint;
  if (!myTurn) hint = `${esc(cur.name)} is ${ctx.isBot(cur.id) ? 'thinking' : 'choosing'}…`;
  else if (v.phase === 'discard') hint = `You hold ${tokenCount(meP)} gems. Return ${tokenCount(meP) - LIMIT} to the bank.`;
  else if (v.phase === 'noble') hint = 'Several patrons admire you. Choose who visits.';
  else hint = 'Take 3 different gems, 2 of one colour, reserve or buy';
  return `<div class="gems-status"><div class="gems-turnline"><span class="swatch" style="background:${col}"></span>` +
    `<span class="status ${myTurn ? 'myturn' : ''}">${myTurn ? 'Your turn' : esc(cur.name) + "'s turn"}</span>` +
    `${v.finalRound ? '<span class="gems-flag">Final round</span>' : ''}<span class="gems-round">Round ${v.round}</span></div>` +
    `<div class="gems-hint">${hint}</div></div>`;
}

function trayHTML(v, meP, myTurn) {
  if (v.over || !meP) return '';
  if (!myTurn) return `<div class="gems-tray gems-tray-idle">Tap any card or patron to inspect it.</div>`;
  if (v.phase === 'discard') {
    const need = tokenCount(meP) - LIMIT;
    const chosen = Object.values(ui.disc).reduce((a, b) => a + b, 0);
    const mine = TOKENS.filter((c) => meP.gems[c] - (ui.disc[c] || 0) > 0)
      .map((c) => `<div class="gems-tok gems-pick" data-act="disc-add" data-c="${c}" role="button" tabindex="0" aria-label="Return one ${NAME[c]}">${chipSVG(c)}<b>${meP.gems[c] - (ui.disc[c] || 0)}</b></div>`).join('');
    const back = TOKENS.filter((c) => ui.disc[c])
      .map((c) => `<div class="gems-tok gems-back" data-act="disc-rem" data-c="${c}" role="button" tabindex="0" aria-label="Keep one ${NAME[c]}">${chipSVG(c)}<b>${ui.disc[c]}</b></div>`).join('');
    const line = chosen < need ? `Too many gems! Tap gems to return <b>${need - chosen}</b> more.` : 'Ready. Send them back to the bank:';
    return `<div class="gems-tray gems-tray-disc"><div class="gems-tline">${line}</div>` +
      `<div class="gems-trow">${mine}</div>${back ? `<div class="gems-trow"><span class="gems-tlabel">Returning</span>${back}</div>` : ''}` +
      `<div class="gems-trow"><button class="primary" data-act="disc-go" ${chosen === need ? '' : 'disabled'}>Return ${plural(need, 'gem')}</button>${chosen ? '<button data-act="disc-clear">Reset</button>' : ''}</div></div>`;
  }
  if (v.phase === 'noble') {
    const list = (v.nobleChoices || []).map((id) => v.nobles.find((n) => n.id === id)).filter(Boolean);
    return `<div class="gems-tray"><div class="gems-tline">Choose the patron who visits you (+3 prestige):</div><div class="gems-trow">${list.map((nb) => `<button class="gems-nbtn" data-act="noble" data-id="${nb.id}">${esc(nb.name)}</button>`).join('')}</div></div>`;
  }
  if (canPass(v, meP)) return `<div class="gems-tray"><span>No legal move is possible.</span><button class="primary" data-act="pass">Pass</button></div>`;
  const sel = ui.sel;
  if (!sel.length) return `<div class="gems-tray gems-tray-idle">Tap gems in the bank to pick them, or tap a card to buy or reserve it.</div>`;
  const want = Math.min(3, availColors(v).length);
  const double = sel.length === 2 && sel[0] === sel[1];
  const ready = double || sel.length === want;
  let label = 'Take';
  if (!ready) label = `Pick ${want - sel.length} more`;
  const over = tokenCount(meP) + sel.length - LIMIT;
  const tip = sel.length === 1 && v.bank[sel[0]] >= 4 ? `<span class="gems-ttip">Tap ${NAME[sel[0]]} again to take 2</span>` : '';
  return `<div class="gems-tray gems-tray-sel"><span class="gems-tlabel">Taking</span><span class="gems-tchips">${sel.map((c) => chipSVG(c)).join('')}</span>` +
    `<span class="gems-tname">${gemList(sel)}</span>${tip}${over > 0 ? `<span class="gems-warn">You'll return ${over}</span>` : ''}` +
    `<span class="gems-tbtns"><button class="primary" data-act="take" ${ready ? '' : 'disabled'}>${label}</button><button data-act="clear">Clear</button></span></div>`;
}

function panelHTML(v, p, ctx, meP, canPlay, freshRes) {
  const isMe = meP && p.id === meP.id;
  const isCur = !v.over && v.players[v.cur].id === p.id;
  const col = PLAYER_COLORS[p.seat % PLAYER_COLORS.length];
  const tokens = tokenCount(p);
  const bonus = COLORS.map((c) => {
    const n = p.bonus[c];
    return `<div class="gems-bst gems-c-${c} ${n ? '' : 'gems-zero'}" data-a="p-${p.id}-bonus-${c}" style="${n ? bonusStyle(n) : ''}" title="${NAME[c]} bonus: ${n}"><svg viewBox="0 0 100 100" aria-hidden="true"><use href="#gems-sh-${c}"/></svg><b>${n || ''}</b></div>`;
  }).join('') + `<div class="gems-bcount" title="Cards bought"><b>${p.cards.length}</b><small>cards</small></div>`;
  const toks = TOKENS.map((c) => `<div class="gems-ptok ${p.gems[c] ? '' : 'gems-zero'}" data-a="p-${p.id}-tok-${c}" title="${NAME[c]}: ${p.gems[c]}">${chipSVG(c)}<b>${p.gems[c]}</b></div>`).join('');
  const res = p.reserved.map((c, i) => {
    const can = isMe && canPlay && !c.hidden && payment(p, c);
    const attrs = `data-k="r-${c.id}" data-noenter data-a="p-${p.id}-res-${i}" data-act="res" data-id="${c.id}" data-owner="${p.id}" role="button" tabindex="0"`;
    const inner = c.hidden ? hiddenCardHTML(c.t) : cardHTML(c, { cls: can ? 'gems-can pulse-glow' : '' });
    return `<div class="gems-res ${freshRes.has(c.id) ? 'gems-arrive' : ''}" ${attrs}>${inner}</div>`;
  }).join('');
  return `<div class="panel gems-pp ${isCur ? 'gems-turn' : ''} ${isMe ? 'gems-me' : ''}" data-k="pp-${p.id}">
    <div class="gems-pphead"><span class="swatch" style="background:${col}"></span><span class="gems-ppname">${esc(p.name)}</span>${isMe ? '<span class="tag">YOU</span>' : ''}
      <span class="gems-pptok ${tokens > LIMIT ? 'gems-over10' : ''}" title="Gems held">${tokens}/${LIMIT}</span>
      <span class="gems-ppnob ${p.nobles.length ? '' : 'gems-zero'}" data-a="p-${p.id}-nobles" title="Patrons: ${p.nobles.map((n) => esc(n.name)).join(', ') || 'none'}">${CREST}<b>${p.nobles.length}</b></span>
      <span class="gems-ppscore" data-a="p-${p.id}-score" title="Prestige">${p.points}<small>★</small></span></div>
    <div class="gems-ppmat"><div class="gems-pprow gems-ppbonus" data-a="p-${p.id}-cards">${bonus}</div>
    <div class="gems-pprow gems-pptoks" data-a="p-${p.id}-gems">${toks}</div></div>
    ${res ? `<div class="gems-ppres" data-a="p-${p.id}-res"><span class="gems-reslbl">Reserved</span>${res}</div>` : ''}
  </div>`;
}

function locate(v, id) {
  for (const t of [1, 2, 3]) {
    const i = v.market[t].findIndex((c) => c && c.id === id);
    if (i >= 0) return { card: v.market[t][i], where: 'market', t, i };
  }
  for (const p of v.players) {
    const i = p.reserved.findIndex((c) => c.id === id);
    if (i >= 0) return { card: p.reserved[i], where: 'reserved', owner: p, t: p.reserved[i].t, i };
  }
  return null;
}

function modalHTML(v, meP, myTurn) {
  const m = ui.modal;
  if (!m) return '';
  const still = ui.shown ? 'gems-still' : '';
  const turnReason = !meP ? 'You are watching this game.' : v.over ? 'The game is over.' : !myTurn ? "It's not your turn." : v.phase !== 'play' ? 'Finish your turn first.' : '';
  const wrap = (art, body) => `<div class="modal-bg gems-mbg ${still}" data-act="close"><div class="modal panel gems-modal" data-act="noop" role="dialog" aria-modal="true">` +
    `<div class="gems-mart">${art}</div><div class="gems-minfo">${body}</div><button class="small gems-mclose" data-act="close" aria-label="Close">✕</button></div></div>`;

  if (m.kind === 'noble') {
    const nb = v.nobles.find((n) => n.id === m.id);
    if (!nb) { ui.modal = null; return ''; }
    const need = meP ? COLORS.filter((c) => nb.req[c]).map((c) => `<div class="gems-crow">${pipHTML(c, nb.req[c], 'gems-pip gems-pipx')}<span>${NAME[c]} bonus</span><span class="${meP.bonus[c] >= nb.req[c] ? 'gems-ok' : 'gems-no'}">you have ${meP.bonus[c]}</span></div>`).join('') : '';
    return wrap(nobleHTML(nb), `<div class="gems-mtitle">${esc(nb.name)}</div><div class="gems-msub">A patron worth 3 prestige. Visits automatically at the end of your turn once your card bonuses meet the requirement.</div>${need}`);
  }

  if (m.kind === 'deck') {
    const n = v.decks[m.t];
    let reason = turnReason || (n < 1 ? 'This deck is empty.' : meP.reserved.length >= MAX_RES ? 'You already hold 3 reserved cards.' : '');
    return wrap(n ? hiddenCardHTML(m.t) : '<div class="gems-slot"></div>',
      `<div class="gems-mtitle">Tier ${ROMAN[m.t]} deck</div><div class="gems-msub">${plural(n, 'card')} left. Reserve the top card face-down: only you will see it.</div>` +
      `<div class="gems-mbtns"><button class="primary" data-act="reserve" data-t="${m.t}" data-deck="1" ${reason ? 'disabled' : ''}>Reserve blind${v.bank.gold > 0 ? ' +1 gold' : ''}</button></div>` +
      (reason ? `<div class="gems-mreason">${reason}</div>` : ''));
  }

  const f = locate(v, m.id);
  if (!f || f.card.hidden) { ui.modal = null; return ''; }
  const card = f.card;
  const othersRes = f.where === 'reserved' && (!meP || f.owner.id !== meP.id);
  const pay = meP ? payment(meP, card) : null;
  let buyReason = turnReason || (othersRes ? `Reserved by ${esc(f.owner.name)}.` : !pay ? `You need ${plural(missing(meP, card), 'more gem')}.` : '');
  let resReason = f.where !== 'market' ? null : turnReason || (meP.reserved.length >= MAX_RES ? 'You already hold 3 reserved cards.' : '');
  const rows = meP ? COLORS.filter((c) => card.cost[c]).map((c) => {
    const cost = card.cost[c], bon = Math.min(cost, meP.bonus[c]), due = cost - bon, have = meP.gems[c];
    return `<div class="gems-crow">${pipHTML(c, cost, 'gems-pip gems-pipx')}<span class="gems-cname">${NAME[c]}</span>` +
      `${bon ? `<span class="gems-cbon">−${bon} bonus</span>` : ''}` +
      (!due ? '<span class="gems-ok">free</span>'
        : have >= due ? `<span class="gems-ok">pay ${due}</span>`
        : pay ? `<span class="gems-gold">pay ${due} (${have ? have + ' + ' : ''}${due - have} gold)</span>`
        : `<span class="gems-no">pay ${due} (have ${have})</span>`) + `</div>`;
  }).join('') : '';
  const payLine = pay ? `<div class="gems-mpay"><span>You pay</span>${TOKENS.filter((c) => pay[c]).map((c) => `<span class="gems-mpc">${chipSVG(c)}<b>${pay[c]}</b></span>`).join('') || '<em>nothing</em>'}</div>` : '';
  const who = f.where === 'reserved' ? `<div class="gems-msub">Reserved by ${meP && f.owner.id === meP.id ? 'you' : esc(f.owner.name)}</div>` : '';
  return wrap(cardHTML(card),
    `<div class="gems-mtitle">${NAME[card.c]} ${TIER_NAME[card.t]} <small>Tier ${ROMAN[card.t]}</small></div>` +
    `<div class="gems-msub">${card.p ? `<b>${card.p} prestige</b> · ` : ''}+1 ${NAME[card.c]} bonus on every future purchase</div>${who}` +
    `<div class="gems-mcost">${rows}</div>${payLine}` +
    `<div class="gems-mbtns"><button class="primary" data-act="buy" data-id="${card.id}" ${buyReason ? 'disabled' : ''}>Buy</button>` +
    (resReason !== null ? `<button data-act="reserve" data-t="${f.t}" data-slot="${f.i}" ${resReason ? 'disabled' : ''}>Reserve${v.bank.gold > 0 ? ' +1 gold' : ''}</button>` : '') + `</div>` +
    ((buyReason || resReason) && !(turnReason && othersRes) ? `<div class="gems-mreason">${buyReason ? 'Buy: ' + buyReason : ''}${resReason && resReason !== buyReason ? `<br>Reserve: ${resReason}` : ''}</div>` : ''));
}

function send(ctx, action) {
  const n = renders;
  ctx.send(action);
  if (renders === n) rerender();
}

function onClick(e) {
  const t = e.target.closest('[data-act]');
  if (!t || !last) return;
  const { v, ctx } = last;
  const act = t.dataset.act;
  const meP = v.players.find((p) => p.id === ctx.me);
  const myTurn = !!meP && !v.over && v.players[v.cur].id === meP.id;
  switch (act) {
    case 'noop':
      return;
    case 'close':
      ui.modal = null;
      return rerender();
    case 'bank':
      return pickGem(t.dataset.c, v, meP, myTurn, t);
    case 'clear':
      ui.sel = [];
      sound('click');
      return rerender();
    case 'take': {
      const gems = ui.sel.slice();
      ui.sel = [];
      return send(ctx, { type: 'take', gems });
    }
    case 'card':
      ui.modal = { kind: 'card', id: t.dataset.id };
      ui.shown = false;
      sound('click');
      return rerender();
    case 'res': {
      const f = locate(v, t.dataset.id);
      if (f && f.card.hidden) return toast(`${f.owner.name} reserved this card face-down.`, 'info');
      ui.modal = { kind: 'card', id: t.dataset.id };
      ui.shown = false;
      sound('click');
      return rerender();
    }
    case 'deck':
      ui.modal = { kind: 'deck', t: +t.dataset.t };
      ui.shown = false;
      sound('click');
      return rerender();
    case 'noble': {
      const id = t.dataset.id;
      if (myTurn && v.phase === 'noble' && (v.nobleChoices || []).includes(id)) {
        ui.modal = null;
        return send(ctx, { type: 'noble', id });
      }
      ui.modal = { kind: 'noble', id };
      ui.shown = false;
      sound('click');
      return rerender();
    }
    case 'buy':
      ui.modal = null;
      return send(ctx, { type: 'buy', id: t.dataset.id });
    case 'reserve': {
      ui.modal = null;
      const tier = +t.dataset.t;
      return send(ctx, t.dataset.deck ? { type: 'reserve', tier, deck: true } : { type: 'reserve', tier, slot: +t.dataset.slot });
    }
    case 'disc-add': {
      const c = t.dataset.c;
      const need = tokenCount(meP) - LIMIT;
      const chosen = Object.values(ui.disc).reduce((a, b) => a + b, 0);
      if (chosen >= need) return toast(`That's enough. Tap Return.`, 'info');
      if (meP.gems[c] - (ui.disc[c] || 0) < 1) return;
      ui.disc[c] = (ui.disc[c] || 0) + 1;
      sound('click');
      return rerender();
    }
    case 'disc-rem': {
      const c = t.dataset.c;
      if (ui.disc[c]) ui.disc[c]--;
      if (!ui.disc[c]) delete ui.disc[c];
      sound('click');
      return rerender();
    }
    case 'disc-clear':
      ui.disc = {};
      return rerender();
    case 'disc-go': {
      const gems = { ...ui.disc };
      ui.disc = {};
      return send(ctx, { type: 'discard', gems });
    }
    case 'pass':
      return send(ctx, { type: 'pass' });
  }
}

function pickGem(c, v, meP, myTurn, el) {
  const nope = (msg) => { el.animate?.([0, -6, 6, -4, 4, 0].map((x) => ({ transform: `translateX(${x}px)` })), { duration: 360 }); toast(msg, 'info'); };
  if (!meP) return;
  if (!myTurn) return nope("It's not your turn.");
  if (v.phase === 'discard') return nope('Return gems to the bank first.');
  if (v.phase === 'noble') return nope('Choose a patron first.');
  if (c === 'gold') return nope('Gold only comes from reserving a card.');
  const sel = ui.sel;
  if (sel.includes(c)) {
    if (sel.length === 1 && v.bank[c] >= 4) ui.sel = [c, c];
    else if (sel.length === 2 && sel[0] === sel[1]) ui.sel = [];
    else ui.sel = sel.filter((x) => x !== c);
  } else {
    if (v.bank[c] < 1) return nope(`No ${NAME[c]} left in the bank.`);
    if (sel.length === 2 && sel[0] === sel[1]) ui.sel = [c];
    else if (sel.length >= 3) return nope('You can take at most 3 different gems.');
    else ui.sel = [...sel, c];
  }
  sound('click');
  rerender();
}

/* =====================================================================
   CSS
   ===================================================================== */

const COLOR_VARS = TOKENS.map((c) => {
  const p = PAL[c].pip;
  const light = c === 'white' || c === 'gold';
  return `.gems-c-${c}{--p1:${p[0]};--p2:${p[1]};--p3:${p[2]};--pi:${light ? (c === 'gold' ? '#4a3000' : '#1f3048') : '#fff'};--ps:${light ? 'rgba(255,255,255,.75)' : '#000'};--pw:${light ? 'rgba(40,60,90,.2)' : 'rgba(255,255,255,.28)'}}`;
}).join('\n') + '\n' + COLORS.map((c) => `.gems-b-${c}{--band:${PAL[c].band};--tint:${PAL[c].tint}}`).join('\n');

const CSS = `
${COLOR_VARS}
.gems-layout { align-items: start; }
.gems-felt { container: gemsfelt / inline-size; padding: 12px 14px 14px; }
@media (max-width: 900px) { .gems-felt { padding: 8px; } }
.gems-table { display: grid; gap: 12px 14px; justify-content: center; grid-template-columns: minmax(0, 600px) 84px;
  grid-template-areas: "status status" "nobles nobles" "tiers bank" "tray tray"; }
.gems-status { grid-area: status; } .gems-nobles { grid-area: nobles; } .gems-tiers { grid-area: tiers; } .gems-bank { grid-area: bank; } .gems-tray { grid-area: tray; }

/* status */
.gems-status { display: flex; flex-direction: column; align-items: center; gap: 2px; text-align: center; }
.gems-turnline { display: flex; align-items: center; justify-content: center; gap: 8px; flex-wrap: wrap; }
.gems-hint { font-size: .9rem; color: #e2f1e7; font-style: italic; text-shadow: 0 1px 2px rgba(0,0,0,.7); }
.gems-round { font-size: .72rem; color: #cfe6d8; opacity: .7; letter-spacing: .06em; text-transform: uppercase; }
.gems-flag { font: 800 .68rem/1 var(--font-display); letter-spacing: .08em; text-transform: uppercase; padding: 5px 9px; border-radius: 20px;
  background: linear-gradient(#ffe48a, #c98a1e); color: #3a2405; box-shadow: 0 0 14px rgba(255,200,80,.6); animation: gems-flag 1.6s ease-in-out infinite; }
@keyframes gems-flag { 50% { box-shadow: 0 0 22px rgba(255,210,90,.95); } }
.gems-over .winner-banner { padding: 4px; }
.gems-standings { display: flex; flex-wrap: wrap; gap: 6px 12px; justify-content: center; font-size: .9rem; }
.gems-standings span { background: rgba(0,0,0,.28); padding: 4px 10px; border-radius: 20px; }
.gems-standings em { font-style: normal; font-family: var(--font-display); font-weight: 800; color: var(--gold); }
.gems-standings small { color: var(--muted); }
.gems-standings .gems-win { box-shadow: 0 0 0 1.5px var(--gold), 0 0 12px rgba(242,193,78,.5); }

/* nobles */
.gems-nobles { display: flex; justify-content: center; gap: 14px; padding: 4px 4px 0; }
.gems-nwrap { flex: 0 1 92px; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 5px; }
.gems-noble { position: relative; width: 100%; aspect-ratio: 1 / 1.06; container-type: inline-size; border-radius: 9px; overflow: hidden; cursor: pointer; background: #222;
  box-shadow: 0 0 0 1px #2a1a05, 0 0 0 3px #d8a640, 0 0 0 4px #6a4510, 0 7px 14px rgba(0,0,0,.55); }
.gems-noble::after { content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; box-shadow: inset 0 0 0 1px rgba(255,240,200,.4), inset 0 0 16px rgba(0,0,0,.55); }
.gems-portrait { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.gems-npts, .gems-pts { font-family: var(--font-display); font-weight: 800; line-height: 1; background: linear-gradient(180deg, #fffbe6 0%, #ffe08a 45%, #d39a2a 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent; filter: drop-shadow(0 1px 0 rgba(0,0,0,.95)) drop-shadow(0 0 2px rgba(0,0,0,.85)); }
.gems-npts { position: absolute; top: 4cqw; left: 7cqw; font-size: 26cqw; }
.gems-nreq { position: absolute; left: 6cqw; bottom: 6cqw; display: flex; flex-direction: column; gap: 2.5cqw; }
.gems-nb { position: relative; width: 18cqw; height: 21cqw; border-radius: 3cqw; display: grid; place-items: center;
  background: linear-gradient(160deg, var(--p1), var(--p2) 50%, var(--p3)); box-shadow: 0 1px 2px rgba(0,0,0,.75), inset 0 0 0 1px rgba(255,255,255,.4); }
.gems-nb svg { position: absolute; width: 80%; height: 80%; color: var(--pw); }
.gems-nb b { position: relative; font: 800 14cqw/1 var(--font-display); color: var(--pi); text-shadow: 0 0 2px var(--ps), 0 1px 1px var(--ps); }
.gems-nname { font: 600 .66rem/1.15 var(--font-display); color: #f3e6c4; text-align: center; text-shadow: 0 1px 2px #000; max-width: 100%; }
.gems-dim { filter: grayscale(.6) brightness(.7); }
.gems-choose { box-shadow: 0 0 0 2px #fff3b0, 0 0 0 4px #e9b949, 0 0 18px 4px rgba(255,220,120,.7); }

/* tiers & cards */
.gems-tiers { display: grid; gap: 10px; align-content: start; }
.gems-tier { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; --tg: 10px; --dfix: 0px; }
.gems-card, .gems-slot { aspect-ratio: 5 / 7; }
.gems-card { position: relative; container-type: inline-size; border-radius: 8% / 5.7%; perspective: 800px; cursor: pointer; -webkit-user-select: none; user-select: none; transition: transform .2s var(--ease); }
@media (hover: hover) { .gems-tier .gems-card:hover, .gems-res:hover .gems-card { transform: translateY(-3px); } }
.gems-flipper { position: absolute; inset: 0; border-radius: inherit; transform-style: preserve-3d; }
.gems-face { position: absolute; inset: 0; border-radius: inherit; overflow: hidden; -webkit-backface-visibility: hidden; backface-visibility: hidden; background: #161210;
  box-shadow: 0 1px 1px rgba(0,0,0,.7), 0 5px 12px rgba(0,0,0,.45); }
.gems-backface { transform: rotateY(180deg); }
.gems-art { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.gems-face::after { content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; z-index: 3;
  box-shadow: inset 0 0 0 1px rgba(0,0,0,.7), inset 0 0 0 2.4cqw var(--fr1), inset 0 0 0 3.8cqw var(--fr2), inset 0 0 0 4.5cqw rgba(0,0,0,.45), inset 0 0 6cqw 6cqw rgba(0,0,0,.3); }
.gems-face::before { content: ''; position: absolute; inset: 2.4cqw; border-radius: 5cqw; pointer-events: none; z-index: 4;
  box-shadow: inset 1px 1px 0 rgba(255,255,255,.55), inset -1px -1px 0 rgba(0,0,0,.35); }
.gems-t1 { --fr1: #e9bb7c; --fr2: #7a4a1f; }
.gems-t2 { --fr1: #eef2f8; --fr2: #66707e; }
.gems-t3 { --fr1: #ffe7a0; --fr2: #9a6a14; }
.gems-tint { position: absolute; inset: 0; background: linear-gradient(180deg, transparent 35%, var(--tint) 100%); }
.gems-band { position: absolute; left: 0; right: 0; top: 0; height: 30cqw; z-index: 1; display: flex; align-items: center; justify-content: space-between; padding: 2cqw 8cqw 0 10cqw;
  background: linear-gradient(180deg, rgba(255,255,255,.38), rgba(255,255,255,0) 60%), var(--band);
  box-shadow: 0 1px 0 rgba(255,230,170,.55), 0 3px 6px rgba(0,0,0,.35); }
.gems-pts { font-size: 25cqw; }
.gems-bonus { width: 24cqw; height: 24cqw; filter: drop-shadow(0 .8cqw .8cqw rgba(0,0,0,.65)); }
.gems-cost { position: absolute; left: 7cqw; bottom: 7cqw; z-index: 1; display: flex; flex-direction: column; gap: 2cqw; }
.gems-pip { position: relative; width: 22cqw; height: 22cqw; border-radius: 50%; display: grid; place-items: center;
  background: radial-gradient(circle at 34% 30%, var(--p1), var(--p2) 58%, var(--p3)); box-shadow: 0 .8cqw 1.6cqw rgba(0,0,0,.7), inset 0 0 0 .8cqw rgba(255,255,255,.3); }
.gems-pip svg { position: absolute; left: 14%; top: 14%; width: 72%; height: 72%; color: var(--pw); }
.gems-pip b { position: relative; font: 800 15cqw/1 var(--font-display); color: var(--pi); text-shadow: 0 0 2px var(--ps), 0 1px 1px var(--ps); }
.gems-pipx { width: 28px; height: 28px; flex: none; box-shadow: 0 1px 3px rgba(0,0,0,.7), inset 0 0 0 1.5px rgba(255,255,255,.3); }
.gems-pipx b { font-size: 15px; }
.gems-slot { border-radius: 8% / 5.7%; border: 2px dashed rgba(255,255,255,.14); background: rgba(0,0,0,.14); }
.gems-can .gems-face { box-shadow: 0 0 0 2px #ffe27a, 0 0 16px 3px rgba(255,214,90,.6), 0 5px 12px rgba(0,0,0,.45); }

/* deck */
.gems-deck { position: relative; border-radius: 8% / 5.7%; cursor: pointer; background: #111; }
.gems-deck > svg { border-radius: inherit; }
.gems-deck::after { content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; box-shadow: inset 0 0 0 1px rgba(0,0,0,.7), inset 0 0 0 3px var(--fr2), inset 1px 1px 0 3px rgba(255,255,255,.18); }
.gems-dcount { position: absolute; left: 50%; bottom: 7%; transform: translateX(-50%); font: 800 .8rem/1 var(--font-display); color: #fff3c8; white-space: nowrap;
  background: rgba(0,0,0,.65); border: 1px solid var(--fr1); border-radius: 20px; padding: 3px 7px; box-shadow: 0 2px 4px rgba(0,0,0,.5); }
.gems-dempty { background: rgba(0,0,0,.14); border: 2px dashed rgba(255,255,255,.14); }
.gems-dempty::after { display: none; }

/* deal from the deck with a 3D flip */
.gems-deal { z-index: 5; animation: gems-deal .6s cubic-bezier(.25,.8,.25,1) var(--dd, .4s) both; }
.gems-deal.pulse-glow { animation: gems-deal .6s cubic-bezier(.25,.8,.25,1) var(--dd, .4s) both, pulseglow 1.4s ease-in-out calc(var(--dd, .4s) + .9s) infinite; }
.gems-deal > .gems-flipper { animation: gems-flip .55s ease-in-out calc(var(--dd, .4s) + .32s) both; }
@keyframes gems-deal { from { transform: translateX(calc(-1 * ((var(--slot) + 1) * (100% + var(--tg)) + var(--dfix)))); } }
@keyframes gems-flip { from { transform: rotateY(180deg); } 50% { transform: rotateY(90deg) scale(1.1); } to { transform: rotateY(0deg); } }
.gems-arrive { animation: gems-arrive .35s ease-out .8s both; }
@keyframes gems-arrive { from { opacity: 0; transform: scale(.6); } }

/* bank */
.gems-bank { display: flex; flex-direction: column; align-items: center; justify-content: space-between; gap: 4px; --chip: 50px; padding: 8px 2px; border-radius: 16px;
  background: radial-gradient(ellipse at 50% 30%, rgba(255,255,255,.07), rgba(0,0,0,.28)); box-shadow: inset 0 2px 10px rgba(0,0,0,.5), 0 1px 0 rgba(255,255,255,.07); }
.gems-pile { position: relative; cursor: pointer; padding: 3px 8px 2px; border-radius: 14px; touch-action: manipulation; -webkit-tap-highlight-color: transparent; transition: background .2s; }
.gems-stack { position: relative; width: var(--chip); height: calc(var(--chip) + 15px); }
.gems-layer, .gems-anchor, .gems-lift, .gems-ghostchip { position: absolute; left: 0; width: var(--chip); height: var(--chip); }
.gems-layer { bottom: calc(var(--i) * 3px); filter: drop-shadow(0 2px 1.5px rgba(0,0,0,.5)); }
.gems-chip { width: 100%; height: 100%; display: block; overflow: visible; }
.gems-anchor { bottom: calc(var(--top) * 3px); pointer-events: none; }
.gems-lift { bottom: calc(var(--top) * 3px + 16px + var(--j) * 9px); z-index: 2; animation: gems-bob 1.5s ease-in-out infinite; animation-delay: calc(var(--j) * -.45s);
  filter: drop-shadow(0 0 3px #fff6c8) drop-shadow(0 0 9px rgba(255,204,70,.95)) drop-shadow(0 12px 7px rgba(0,0,0,.55)); }
.gems-lift::before { content: ''; position: absolute; inset: -3px; border-radius: 50%; border: 2px solid #ffe7a0; box-shadow: 0 0 10px rgba(255,214,90,.9), inset 0 0 8px rgba(255,214,90,.6); }
.gems-lift.gems-lnew { animation: gems-pop .38s cubic-bezier(.3,1.4,.5,1), gems-bob 1.5s ease-in-out .38s infinite; }
@keyframes gems-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
@keyframes gems-pop { 0% { transform: translateY(14px) scale(.9); } 60% { transform: translateY(-8px) scale(1.08); } 100% { transform: none; } }
.gems-ghostchip { bottom: 0; border-radius: 50%; border: 2px dashed rgba(255,255,255,.22); }
.gems-count { position: absolute; right: 1px; bottom: 0; min-width: 22px; height: 22px; padding: 0 5px; border-radius: 11px; z-index: 3;
  font: 800 12px/20px var(--font-display); text-align: center; color: #ffeebf; background: radial-gradient(circle at 40% 30%, #4a3018, #1a0f07); border: 1px solid #c8953a; box-shadow: 0 2px 4px rgba(0,0,0,.6); }
.gems-pick { background: radial-gradient(ellipse at 50% 60%, rgba(255,240,180,.1), transparent 70%); }
@media (hover: hover) { .gems-pick:hover { background: radial-gradient(ellipse at 50% 60%, rgba(255,240,180,.22), transparent 70%); } }
.gems-pick:active .gems-stack { transform: scale(.95); }
.gems-psel { background: radial-gradient(ellipse at 50% 70%, rgba(255,226,122,.35), transparent 72%); }
.gems-pempty .gems-count { opacity: .6; }

/* tray */
.gems-tray { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 8px 10px; min-height: 54px; padding: 8px 12px; border-radius: 14px;
  background: rgba(0,0,0,.26); box-shadow: inset 0 2px 8px rgba(0,0,0,.45), 0 1px 0 rgba(255,255,255,.06); color: #eaf4ee; font-size: .9rem; text-align: center; }
.gems-tray-idle { color: #cfe3d6; font-style: italic; font-size: .85rem; }
.gems-tray-disc, .gems-tray > .gems-tline { flex-direction: column; }
.gems-tray-disc { display: flex; }
.gems-tline { width: 100%; }
.gems-trow { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; align-items: center; }
.gems-tlabel { font: 800 .72rem/1 var(--font-display); letter-spacing: .08em; text-transform: uppercase; color: var(--gold); }
.gems-tchips { display: flex; gap: 2px; }
.gems-tchips .gems-chip { width: 34px; height: 34px; filter: drop-shadow(0 0 5px rgba(255,236,150,.8)); animation: gems-bob 1.5s ease-in-out infinite; }
.gems-tname { font-weight: 800; }
.gems-ttip { font-size: .78rem; color: #cfe3d6; font-style: italic; }
.gems-warn { color: #ffd2a0; font-weight: 800; font-size: .82rem; }
.gems-tbtns { display: flex; gap: 8px; }
.gems-tok { position: relative; width: 44px; height: 44px; cursor: pointer; }
.gems-tok .gems-chip { filter: drop-shadow(0 2px 2px rgba(0,0,0,.5)); }
.gems-tok b { position: absolute; right: -5px; bottom: -3px; min-width: 19px; height: 19px; border-radius: 10px; background: #1a0f07; border: 1px solid #c8953a; font: 800 11px/17px var(--font-display); color: #ffeebf; }
.gems-tok.gems-back .gems-chip { filter: drop-shadow(0 0 6px rgba(255,140,110,.9)); }
.gems-nbtn { font-family: var(--font-display); }

/* players */
.gems-pp { padding: 12px 13px 11px; transition: box-shadow .3s; }
.gems-pp.gems-turn { box-shadow: 0 0 0 2px var(--gold), 0 0 22px rgba(242,193,78,.5), inset 0 1px 0 rgba(255,220,170,.18), inset 0 0 30px rgba(0,0,0,.35); }
.gems-pphead, .gems-ppmat, .gems-ppres { position: relative; z-index: 1; }
.gems-ppmat { margin-top: 7px; padding: 3px 6px 7px; border-radius: 11px; background: linear-gradient(180deg, rgba(0,0,0,.3), rgba(0,0,0,.18));
  box-shadow: inset 0 2px 7px rgba(0,0,0,.55), 0 1px 0 rgba(255,220,170,.1); }
.gems-pphead { display: flex; align-items: center; gap: 7px; min-height: 28px; }
.gems-ppname { font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.gems-pptok { margin-left: auto; font-size: .74rem; color: var(--muted); white-space: nowrap; background: rgba(0,0,0,.25); padding: 2px 7px; border-radius: 10px; }
.gems-pptok.gems-over10 { color: #2c0703; background: var(--bad); font-weight: 800; }
.gems-ppnob { display: inline-flex; align-items: center; gap: 1px; font: 800 .9rem/1 var(--font-display); color: #f3dca0; }
.gems-ppnob svg { width: 20px; height: 20px; }
.gems-ppnob.gems-zero { opacity: .35; filter: grayscale(.6); }
.gems-ppscore { font: 800 1.6rem/1 var(--font-display); color: var(--gold); text-shadow: 0 2px 0 #2a1706, 0 0 12px rgba(242,193,78,.35); min-width: 1.7em; text-align: right; white-space: nowrap; }
.gems-ppscore small { font-size: .55em; vertical-align: super; margin-left: 1px; }
.gems-pprow { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); justify-items: center; align-items: end; gap: 2px; }
.gems-ppbonus { margin-top: 2px; min-height: 40px; }
.gems-bst { position: relative; width: 30px; height: 22px; border-radius: 4px 4px 2px 2px; display: grid; place-items: center;
  background: linear-gradient(170deg, var(--p1), var(--p2) 55%, var(--p3)); border: 1px solid rgba(0,0,0,.5); }
.gems-bst svg { position: absolute; width: 17px; height: 17px; color: var(--pw); }
.gems-bst b { position: relative; font: 800 13px/1 var(--font-display); color: var(--pi); text-shadow: 0 0 2px var(--ps), 0 1px 1px var(--ps); }
.gems-bst.gems-zero { background: transparent; border: 1.5px dashed rgba(255,255,255,.25); opacity: .5; filter: none; }
.gems-bst.gems-zero svg { color: rgba(255,255,255,.25); }
.gems-bcount { display: flex; flex-direction: column; align-items: center; line-height: 1; }
.gems-bcount b { font: 800 14px/1 var(--font-display); color: #f3dca0; }
.gems-bcount small { font-size: 9px; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }
.gems-pptoks { margin-top: 5px; }
.gems-ptok { position: relative; width: 34px; height: 34px; }
.gems-ptok .gems-chip { filter: drop-shadow(0 2px 2px rgba(0,0,0,.55)); }
.gems-ptok b { position: absolute; right: -7px; bottom: -3px; min-width: 18px; height: 18px; border-radius: 9px; background: #1a0f07; border: 1px solid #c8953a;
  font: 800 11px/16px var(--font-display); color: #ffeebf; text-align: center; }
.gems-zero { opacity: .32; filter: grayscale(.7); }
.gems-ppres { display: flex; gap: 8px; margin-top: 10px; align-items: center; }
.gems-reslbl { font: 800 .62rem/1.1 var(--font-display); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); writing-mode: vertical-rl; transform: rotate(180deg); }
.gems-res { width: 56px; cursor: pointer; }
.gems-ledger h4 { margin: 0 0 6px; font: 800 .8rem/1 var(--font-display); letter-spacing: .14em; text-transform: uppercase; color: #6b4a22; }
.gems-ledger .log { max-height: 220px; }

/* modal */
.gems-mbg.gems-still, .gems-mbg.gems-still .modal { animation: none; }
.gems-modal { display: flex; gap: 18px; align-items: center; max-width: 560px; position: relative; }
.gems-mart { flex: 0 0 172px; position: relative; z-index: 1; }
.gems-mart .gems-card, .gems-mart .gems-noble, .gems-mart .gems-slot { width: 100%; }
.gems-mart .gems-card { cursor: default; }
.gems-minfo { flex: 1; min-width: 0; position: relative; z-index: 1; }
.gems-mtitle { font: 800 1.2rem/1.2 var(--font-display); color: var(--gold); padding-right: 36px; }
.gems-mtitle small { font-size: .7rem; color: var(--muted); letter-spacing: .08em; }
.gems-msub { color: var(--muted); font-size: .86rem; margin: 3px 0 8px; }
.gems-msub b { color: var(--text); }
.gems-mcost { display: flex; flex-direction: column; gap: 4px; }
.gems-crow { display: flex; align-items: center; gap: 8px; font-size: .86rem; }
.gems-cname { min-width: 5.2em; font-weight: 700; }
.gems-cbon { color: #9fd8ff; font-size: .8rem; }
.gems-ok { color: var(--good); font-weight: 800; margin-left: auto; }
.gems-no { color: var(--bad); font-weight: 800; margin-left: auto; }
.gems-gold { color: var(--gold); font-weight: 800; margin-left: auto; }
.gems-mpay { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 10px; padding: 6px 10px; border-radius: 10px; background: rgba(0,0,0,.25); font-size: .82rem; color: var(--muted); }
.gems-mpc { position: relative; width: 28px; height: 28px; display: inline-block; }
.gems-mpc b { position: absolute; right: -6px; bottom: -3px; min-width: 16px; height: 16px; border-radius: 8px; background: #1a0f07; border: 1px solid #c8953a; font: 800 10px/14px var(--font-display); color: #ffeebf; text-align: center; }
.gems-mbtns { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
.gems-mbtns button { flex: 1; min-width: 110px; }
.gems-mreason { font-size: .8rem; color: #ffc9b8; margin-top: 7px; }
.gems-mclose { position: absolute; top: 10px; right: 10px; min-width: 36px; z-index: 2; }
@media (max-width: 520px) {
  .gems-modal { flex-direction: column; align-items: stretch; gap: 10px; }
  .gems-mart { flex: none; width: 128px; margin: 0 auto; }
}

/* narrow felt: stack the bank under the market */
@container gemsfelt (max-width: 719px) {
  .gems-table { grid-template-columns: minmax(0, 600px); grid-template-areas: "status" "nobles" "tiers" "bank" "tray"; gap: 10px; }
  .gems-bank { flex-direction: row; justify-content: space-evenly; --chip: 44px; padding: 6px 2px 5px; }
  .gems-pile { padding: 2px 3px; }
}
@container gemsfelt (max-width: 479px) {
  .gems-tier { grid-template-columns: 30px repeat(4, minmax(0, 1fr)); gap: 5px; --tg: 5px; --dfix: calc(15px - 50%); }
  .gems-tiers { gap: 7px; }
  .gems-bank { --chip: 38px; gap: 0; }
  .gems-pile { padding: 2px 1px; }
  .gems-count { min-width: 19px; height: 19px; font-size: 11px; line-height: 17px; padding: 0 4px; right: -3px; }
  .gems-dcount { font-size: .66rem; padding: 2px 4px; }
  .gems-nobles { gap: 9px; }
  .gems-nname { display: none; }
  .gems-hint { font-size: .82rem; }
  .gems-tray { padding: 8px; }
}
`;

export default {
  id: 'gems',
  name: 'Gem Merchants',
  emoji: '💎',
  description: 'Trade sparkling gems, buy mines, caravans and palaces that pay you forever, and court royal patrons. First to 15 prestige ends the round.',
  minPlayers: 2,
  maxPlayers: 4,
  cover: coverSVG(),
  setup,
  act,
  turnOf,
  view,
  bot,
  render,
};
