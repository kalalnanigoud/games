// Court of Whispers — a hidden-role bluffing game of renaissance palace intrigue.
// Claim any role, call out liars, and be the last courtier with influence.
import { esc, rand, shuffle, log, addFx, PLAYER_COLORS } from '../js/util.js';
import { injectCSS } from '../js/fx.js';
import { sound } from '../js/sound.js';
import { icon as uiIcon } from '../js/icons.js';
import { portrait } from '../js/avatar.js';

/* ============================================================
   Rules data
   ============================================================ */
const ROLES = ['chancellor', 'shadow', 'corsair', 'envoy', 'duchess'];
const R = {
  chancellor: { name: 'Chancellor', color: '#8a55cf', deep: '#2a1048', ink: '#4a1f86', l1: 'LEVY: +3 COINS', l2: 'Blocks Foreign Aid', act: 'Levy: take 3 coins from the treasury.', blk: 'Blocks Foreign Aid.' },
  shadow: { name: 'Shadow', color: '#4b505e', deep: '#08080c', ink: '#1d1d24', l1: 'ASSASSINATE: PAY 3', l2: 'Rival loses a card', act: 'Assassinate: pay 3 coins; a rival loses an influence.', blk: 'Blocks nothing.' },
  corsair: { name: 'Corsair', color: '#3279c4', deep: '#0a2244', ink: '#164a85', l1: 'PLUNDER: STEAL 2', l2: 'Blocks Plunder', act: 'Plunder: take up to 2 coins from a rival.', blk: 'Blocks Plunder.' },
  envoy: { name: 'Envoy', color: '#2f9a5e', deep: '#08321d', ink: '#135a33', l1: 'EXCHANGE: DRAW 2', l2: 'Blocks Plunder', act: 'Exchange: draw 2 cards, then return any 2.', blk: 'Blocks Plunder.' },
  duchess: { name: 'Duchess', color: '#d0304a', deep: '#420712', ink: '#8f1028', l1: 'NO ACTION', l2: 'Blocks Assassination', act: 'No action of her own.', blk: 'Blocks Assassination.' },
};
const A = {
  income: { name: 'Income', sub: '+1 coin' },
  aid: { name: 'Foreign Aid', sub: '+2 coins', blockers: ['chancellor'], by: 'any' },
  coup: { name: 'Coup', sub: 'pay 7 · unstoppable', cost: 7, target: true },
  levy: { name: 'Levy', sub: '+3 coins', claim: 'chancellor' },
  assassinate: { name: 'Assassinate', sub: 'pay 3 · rival loses a card', claim: 'shadow', cost: 3, target: true, blockers: ['duchess'], by: 'target' },
  plunder: { name: 'Plunder', sub: 'steal up to 2', claim: 'corsair', target: true, blockers: ['corsair', 'envoy'], by: 'target' },
  exchange: { name: 'Exchange', sub: 'draw 2, return 2', claim: 'envoy' },
};
const WINDOWS = ['challenge', 'block', 'blockChallenge'];

/* ============================================================
   Rules helpers
   ============================================================ */
const P = (s, id) => s.players.find((p) => p.id === id);
const hidden = (p) => p.cards.filter((c) => !c.up);
const isAlive = (p) => !!p && p.cards.some((c) => !c.up);
const alive = (s) => s.players.filter(isAlive);
const COIN = '<div class="bluff-coin"></div>';
const CSIZE = [24, 24];

function addEv(s, e) {
  s.evSeq = (s.evSeq || 0) + 1;
  s.ev = (s.ev || []).concat({ ...e, seq: s.evSeq }).slice(-14);
}
function addClaim(p, role) {
  p.claims = [role, ...p.claims.filter((r) => r !== role)].slice(0, 3);
}
function coinsFly(s, from, to, n, extra = {}) {
  if (n <= 0) return;
  addFx(s, { from, to, html: COIN, n, size: CSIZE, sound: 'coin', ...extra });
}
function draw(s) {
  return { k: 'd' + s.drawSeq++, role: s.deck.shift(), up: false };
}

function openWindow(s, phase, ids) {
  s.phase = phase;
  s.respond = ids.slice();
  s.allowed = [];
  if (!s.respond.length) windowPassed(s);
}

function windowPassed(s) {
  if (s.phase === 'challenge') return claimStands(s);
  if (s.phase === 'block') return resolve(s);
  if (s.phase === 'blockChallenge') return blockStands(s);
}

function claimStands(s) {
  const pd = s.pending, def = A[pd.action];
  if (def.blockers && def.by === 'target') {
    const t = P(s, pd.target);
    if (isAlive(t)) return openWindow(s, 'block', [t.id]);
  }
  return resolve(s);
}

function blockStands(s) {
  const pd = s.pending;
  const b = P(s, pd.blocker), a = P(s, pd.actor);
  log(s, `${b.name}'s ${R[pd.blockRole].name} stands — ${a.name}'s ${A[pd.action].name} fails.`);
  addEv(s, { t: 'stopped', pid: b.id, role: pd.blockRole, action: pd.action, actor: a.id });
  return endTurn(s);
}

function reveal(s, p, c) {
  c.up = true;
  log(s, `${p.name} loses an influence, revealing the ${R[c.role].name}.`);
  addEv(s, { t: 'lose', pid: p.id, k: c.k, role: c.role });
  if (!isAlive(p)) {
    p.out = true;
    log(s, `${p.name} is banished from the court.`);
    addEv(s, { t: 'out', pid: p.id });
    if (p.coins > 0) {
      coinsFly(s, `p-${p.id}-coins`, 'treasury', p.coins, { delay: 900 });
      p.coins = 0;
    }
  }
}

function checkWin(s) {
  const al = alive(s);
  if (al.length > 1) return false;
  s.over = true;
  s.phase = 'over';
  s.respond = [];
  s.allowed = [];
  s.losses = [];
  s.after = null;
  s.exchange = null;
  s.winners = al.map((p) => p.id);
  if (al[0]) log(s, `${al[0].name} alone remains — the court is theirs!`);
  return true;
}

function processLosses(s) {
  while (s.losses.length) {
    const p = P(s, s.losses[0]);
    const h = p ? hidden(p) : [];
    if (!h.length) { s.losses.shift(); continue; }
    if (h.length === 1) {
      reveal(s, p, h[0]);
      s.losses.shift();
      if (checkWin(s)) return;
      continue;
    }
    s.phase = 'lose';
    s.respond = [p.id];
    s.allowed = [];
    return;
  }
  if (checkWin(s)) return;
  const after = s.after;
  s.after = null;
  if (after === 'stands') return claimStands(s);
  if (after === 'blocked') return blockStands(s);
  if (after === 'resolve') return resolve(s);
  return endTurn(s);
}

function endTurn(s) {
  if (checkWin(s)) return;
  s.pending = null;
  s.exchange = null;
  s.losses = [];
  s.after = null;
  s.allowed = [];
  let i = s.turn;
  for (let n = 0; n < s.players.length; n++) {
    i = (i + 1) % s.players.length;
    if (isAlive(s.players[i])) break;
  }
  s.turn = i;
  s.turnSeq++;
  s.phase = 'action';
  s.respond = [s.players[i].id];
}

function declare(s, p, a) {
  const def = A[a.action];
  if (!def) throw new Error('Unknown action.');
  if (p.coins >= 10 && a.action !== 'coup') throw new Error('With 10 or more coins you must stage a Coup.');
  if (def.cost && p.coins < def.cost) throw new Error(`${def.name} costs ${def.cost} coins.`);
  let t = null;
  if (def.target) {
    t = P(s, a.target);
    if (!t || t.id === p.id || !isAlive(t)) throw new Error('Choose a rival who is still at court.');
    if (a.action === 'plunder' && t.coins < 1) throw new Error(`${t.name} has no coins to plunder.`);
  }
  s.pending = { actor: p.id, action: a.action, target: t ? t.id : null, claim: def.claim || null, paid: 0, blocker: null, blockRole: null, challenger: null };
  const others = alive(s).filter((x) => x.id !== p.id).map((x) => x.id);

  if (a.action === 'income') {
    p.coins += 1;
    log(s, `${p.name} takes Income (+1).`);
    addEv(s, { t: 'act', pid: p.id, action: 'income' });
    coinsFly(s, 'treasury', `p-${p.id}-coins`, 1);
    addFx(s, { kind: 'float', at: `p-${p.id}-coins`, text: '+1', color: '#ffd76a', delay: 500 });
    return endTurn(s);
  }
  if (a.action === 'coup') {
    p.coins -= 7;
    log(s, `${p.name} stages a Coup against ${t.name}!`);
    addEv(s, { t: 'act', pid: p.id, action: 'coup', target: t.id });
    addEv(s, { t: 'coup', pid: t.id });
    coinsFly(s, `p-${p.id}-coins`, 'treasury', 7);
    s.losses = [t.id];
    s.after = 'end';
    return processLosses(s);
  }
  if (a.action === 'aid') {
    log(s, `${p.name} requests Foreign Aid (+2).`);
    addEv(s, { t: 'act', pid: p.id, action: 'aid' });
    return openWindow(s, 'block', others);
  }
  // role claims
  if (a.action === 'assassinate') {
    p.coins -= 3;
    s.pending.paid = 3;
    coinsFly(s, `p-${p.id}-coins`, 'treasury', 3);
  }
  addClaim(p, def.claim);
  log(s, `${p.name} claims the ${R[def.claim].name} to ${def.name}${t ? ' ' + t.name : ''}.`);
  addEv(s, { t: 'claim', pid: p.id, role: def.claim, action: a.action, target: t ? t.id : null });
  return openWindow(s, 'challenge', others);
}

function allow(s, pid) {
  s.respond = s.respond.filter((x) => x !== pid);
  if (!s.allowed.includes(pid)) s.allowed.push(pid);
  if (!s.respond.length) windowPassed(s);
}

function doBlock(s, p, role) {
  const pd = s.pending, def = A[pd.action];
  if (!def.blockers || !def.blockers.includes(role)) throw new Error('That role cannot block this action.');
  if (def.by === 'target' && pd.target !== p.id) throw new Error('Only the target may block this.');
  pd.blocker = p.id;
  pd.blockRole = role;
  addClaim(p, role);
  const a = P(s, pd.actor);
  log(s, `${p.name} claims the ${R[role].name} to block ${a.name}'s ${def.name}.`);
  addEv(s, { t: 'block', pid: p.id, role, actor: a.id, action: pd.action });
  return openWindow(s, 'blockChallenge', alive(s).filter((x) => x.id !== p.id).map((x) => x.id));
}

function doChallenge(s, ch) {
  const pd = s.pending;
  const isBlock = s.phase === 'blockChallenge';
  const claimant = P(s, isBlock ? pd.blocker : pd.actor);
  const role = isBlock ? pd.blockRole : pd.claim;
  pd.challenger = ch.id;
  s.respond = [];
  log(s, `${ch.name} challenges ${claimant.name}'s ${R[role].name}!`);
  addEv(s, { t: 'challenge', pid: ch.id, target: claimant.id, role });
  const idx = claimant.cards.findIndex((c) => !c.up && c.role === role);
  if (idx >= 0) {
    const card = claimant.cards[idx];
    s.deck.push(card.role);
    shuffle(s.deck);
    claimant.cards[idx] = draw(s);
    s.returned = [card.k];
    log(s, `${claimant.name} reveals the ${R[role].name}! It is shuffled away and replaced; ${ch.name} loses an influence.`);
    addEv(s, { t: 'proof', pid: claimant.id, role, ok: true, ch: ch.id });
    s.losses = [ch.id];
    s.after = isBlock ? 'blocked' : 'stands';
  } else {
    log(s, `${claimant.name} was bluffing — no ${R[role].name}!`);
    addEv(s, { t: 'proof', pid: claimant.id, role, ok: false, ch: ch.id });
    claimant.claims = claimant.claims.filter((r) => r !== role);
    s.losses = [claimant.id];
    if (isBlock) s.after = 'resolve';
    else {
      if (pd.paid) {
        const a = P(s, pd.actor);
        a.coins += pd.paid;
        coinsFly(s, 'treasury', `p-${a.id}-coins`, pd.paid, { delay: 1500 });
        log(s, `${a.name}'s ${pd.paid} coins are refunded.`);
        pd.paid = 0;
      }
      s.after = 'end';
    }
  }
  return processLosses(s);
}

function resolve(s) {
  const pd = s.pending;
  const a = P(s, pd.actor), t = pd.target ? P(s, pd.target) : null;
  if (!isAlive(a)) return endTurn(s);
  switch (pd.action) {
    case 'aid':
      a.coins += 2;
      log(s, `${a.name} receives Foreign Aid (+2).`);
      coinsFly(s, 'treasury', `p-${a.id}-coins`, 2);
      addFx(s, { kind: 'float', at: `p-${a.id}-coins`, text: '+2', color: '#ffd76a', delay: 600 });
      return endTurn(s);
    case 'levy':
      a.coins += 3;
      log(s, `${a.name} levies 3 coins from the treasury.`);
      coinsFly(s, 'treasury', `p-${a.id}-coins`, 3);
      addFx(s, { kind: 'float', at: `p-${a.id}-coins`, text: '+3', color: '#ffd76a', delay: 700 });
      return endTurn(s);
    case 'assassinate':
      if (!isAlive(t)) { log(s, `The Shadow finds no one to strike.`); return endTurn(s); }
      log(s, `${a.name}'s Shadow strikes ${t.name}!`);
      addEv(s, { t: 'slash', pid: t.id });
      s.losses = [t.id];
      s.after = 'end';
      return processLosses(s);
    case 'plunder': {
      if (!isAlive(t)) { log(s, `There is no one left to plunder.`); return endTurn(s); }
      const n = Math.min(2, t.coins);
      t.coins -= n;
      a.coins += n;
      log(s, `${a.name} plunders ${n} coin${n === 1 ? '' : 's'} from ${t.name}.`);
      if (n) {
        addFx(s, { from: `p-${t.id}-coins`, to: `p-${a.id}-coins`, html: COIN, n, size: CSIZE, sound: 'steal' });
        addFx(s, { kind: 'float', at: `p-${t.id}-coins`, text: '-' + n, color: '#ff8a7a', delay: 200 });
      }
      return endTurn(s);
    }
    case 'exchange': {
      const drawn = [];
      for (let i = 0; i < 2 && s.deck.length; i++) drawn.push(draw(s));
      s.exchange = { pid: a.id, drawn };
      s.phase = 'exchange';
      s.respond = [a.id];
      s.allowed = [];
      log(s, `${a.name} draws ${drawn.length} cards from the court deck.`);
      addEv(s, { t: 'draw', pid: a.id });
      return;
    }
  }
  return endTurn(s);
}

function doLose(s, p, k) {
  if (s.losses[0] !== p.id) throw new Error('You do not have to give up an influence.');
  const c = p.cards.find((x) => x.k === k && !x.up);
  if (!c) throw new Error('Choose one of your hidden cards.');
  reveal(s, p, c);
  s.losses.shift();
  return processLosses(s);
}

function doExchange(s, p, keep) {
  const ex = s.exchange;
  if (!ex || ex.pid !== p.id) throw new Error('You are not exchanging.');
  if (!Array.isArray(keep)) throw new Error('Choose the cards to keep.');
  const h = hidden(p);
  const pool = [...h, ...ex.drawn];
  const uniq = [...new Set(keep)];
  if (uniq.length !== h.length || keep.length !== h.length) throw new Error(`Keep exactly ${h.length} card${h.length > 1 ? 's' : ''}.`);
  const kept = uniq.map((k) => pool.find((c) => c.k === k));
  if (kept.some((c) => !c)) throw new Error('Keep cards from your hand or the ones you drew.');
  const back = pool.filter((c) => !uniq.includes(c.k));
  const keptDrawn = ex.drawn.filter((c) => uniq.includes(c.k));
  p.cards = p.cards.map((c) => (c.up || uniq.includes(c.k) ? c : keptDrawn.shift()));
  back.forEach((c) => s.deck.push(c.role));
  shuffle(s.deck);
  s.returned = back.map((c) => c.k);
  s.exchange = null;
  log(s, `${p.name} returns ${back.length} cards to the court deck.`);
  addEv(s, { t: 'shuffle', pid: p.id });
  return endTurn(s);
}

/* ============================================================
   Bot
   ============================================================ */
const BASEVAL = { chancellor: 5, shadow: 4.4, duchess: 4.1, corsair: 3.8, envoy: 3.1 };
function roleValue(r, coins, n) {
  let v = BASEVAL[r];
  if (r === 'shadow' && coins >= 3) v += 0.6;
  if (r === 'duchess' && n >= 4) v += 0.3;
  if (r === 'corsair' && n === 2) v += 0.6;
  return v;
}
function handValue(roles, coins, n) {
  const seen = {};
  let sum = 0;
  for (const r of roles) {
    sum += roleValue(r, coins, n) - (seen[r] ? 1.8 : 0);
    seen[r] = 1;
  }
  return sum;
}
function combos(arr, k, start = 0, cur = [], out = []) {
  if (cur.length === k) { out.push(cur.slice()); return out; }
  for (let i = start; i < arr.length; i++) { cur.push(arr[i]); combos(arr, k, i + 1, cur, out); cur.pop(); }
  return out;
}

function bot(v, pid) {
  const me = P(v, pid);
  if (!me) return { type: 'allow' };
  const mine = hidden(me).map((c) => c.role);
  const has = (r) => mine.includes(r);
  const shown = (r) => v.players.reduce((n, p) => n + p.cards.filter((c) => c.up && c.role === r).length, 0);
  const unacc = (r) => 3 - shown(r) - mine.filter((x) => x === r).length;
  const pd = v.pending;
  const al = alive(v);
  const opp = al.filter((p) => p.id !== pid);
  const n = al.length;
  const rnd = Math.random;
  const challenge = { type: 'challenge' }, pass = { type: 'allow' };

  if (v.phase === 'lose') {
    const h = hidden(me);
    let best = h[0], bestV = -Infinity;
    for (const c of h) {
      const rest = h.filter((x) => x !== c).map((x) => x.role);
      const val = handValue(rest, me.coins, n) + rnd() * 0.1;
      if (val > bestV) { bestV = val; best = c; }
    }
    return { type: 'lose', card: best.k };
  }

  if (v.phase === 'exchange') {
    const h = hidden(me);
    const pool = [...h, ...((v.exchange && v.exchange.drawn) || [])];
    let best = h, bestV = -Infinity;
    for (const c of combos(pool, h.length)) {
      const val = handValue(c.map((x) => x.role), me.coins, n) + rnd() * 0.2;
      if (val > bestV) { bestV = val; best = c; }
    }
    return { type: 'exchange', keep: best.map((c) => c.k) };
  }

  if (v.phase === 'challenge' || v.phase === 'blockChallenge') {
    const isBlock = v.phase === 'blockChallenge';
    const role = isBlock ? pd.blockRole : pd.claim;
    const claimant = P(v, isBlock ? pd.blocker : pd.actor);
    const u = unacc(role);
    if (u <= 0) return challenge; // impossible claim: we can see every copy
    // Chance the claimant really holds one of the u unaccounted copies among the cards we can't see.
    const unseen = (v.deckCount || 0) + v.players.reduce((a, p) => a + (p.id === pid ? 0 : hidden(p).length), 0);
    const h = hidden(claimant).length;
    let pNone = 1;
    for (let i = 0; i < h; i++) pNone *= Math.max(0, unseen - u - i) / Math.max(1, unseen - i);
    const pHas = 1 - pNone;
    // How often a claim like this is a bluff, before looking at the cards.
    const prior = isBlock ? (pd.action === 'assassinate' ? 0.45 : 0.3) : 0.18;
    const post = ((1 - pHas) * prior) / ((1 - pHas) * prior + pHas);
    const crowd = Math.max(1, v.respond.length);
    let p = post >= 0.55 ? 0.35 + (post - 0.55) * 1.3 : (0.015 + post * 0.05) / Math.sqrt(crowd);
    let lifeOrDeath = false;
    if (!isBlock) {
      if (pd.action === 'assassinate' && pd.target === pid) {
        if (has('duchess')) p *= 0.3; // we will simply block
        else if (mine.length === 1) { lifeOrDeath = true; p = Math.max(p, 0.04 + post * 0.85); }
        else p += 0.04;
      }
      if (pd.action === 'plunder' && pd.target === pid && !has('corsair') && !has('envoy') && me.coins >= 2) p += 0.04;
      if (pd.action === 'levy' && claimant.coins >= 4) p += 0.03;
      if (pd.action === 'exchange') p *= 0.4;
    } else if (pd.actor === pid) {
      p += pd.action === 'assassinate' ? 0.08 : 0.04;
    }
    if (mine.length === 1 && !lifeOrDeath) p *= 0.5;
    return rnd() < p ? challenge : pass;
  }

  if (v.phase === 'block') {
    const def = A[pd.action];
    const real = def.blockers.find(has);
    const actor = P(v, pd.actor);
    if (pd.action === 'aid') {
      if (real) return rnd() < 0.9 ? { type: 'block', role: real } : pass;
      const pb = 0.05 + (actor.coins >= 5 ? 0.1 : 0);
      if (unacc('chancellor') >= 1 && rnd() < pb) return { type: 'block', role: 'chancellor' };
      return pass;
    }
    if (pd.target !== pid) return pass;
    if (pd.action === 'assassinate') {
      if (has('duchess')) return { type: 'block', role: 'duchess' };
      if (unacc('duchess') >= 1) {
        if (mine.length === 1 && rnd() < 0.72) return { type: 'block', role: 'duchess' };
        if (mine.length >= 2 && rnd() < 0.16) return { type: 'block', role: 'duchess' };
      }
      return pass;
    }
    if (pd.action === 'plunder') {
      if (real) return { type: 'block', role: real };
      const opts = ['corsair', 'envoy'].filter((r) => unacc(r) >= 1).sort((a, b) => unacc(b) - unacc(a));
      if (opts.length && rnd() < (me.coins >= 4 ? 0.3 : 0.18)) return { type: 'block', role: opts[0] };
      return pass;
    }
    return pass;
  }

  if (v.phase !== 'action') return pass;

  // ---- choose an action ----
  const coins = me.coins;
  const act = (action, target) => (target ? { type: 'act', action, target: target.id } : { type: 'act', action });
  const danger = (p) => hidden(p).length * 4 + p.coins + (p.claims.includes('shadow') ? 1.5 : 0) + rnd() * 0.5;
  const byDanger = opp.slice().sort((a, b) => danger(b) - danger(a));
  if (coins >= 7) return act('coup', byDanger[0]);

  const assassTarget = () => {
    const pool = opp.filter((p) => !p.claims.includes('duchess'));
    const list = (pool.length ? pool : opp).slice().sort((a, b) => (hidden(a).length - hidden(b).length) * 3 + danger(b) - danger(a));
    return list[0];
  };
  const plunderTarget = () =>
    opp.filter((p) => p.coins >= 1)
      .map((p) => ({ p, w: Math.min(2, p.coins) * 2 + p.coins * 0.2 - (p.claims.includes('corsair') || p.claims.includes('envoy') ? 2.5 : 0) + rnd() * 0.3 }))
      .sort((a, b) => b.w - a.w)[0]?.p;

  if (has('shadow') && coins >= 3) {
    const t = assassTarget();
    if (t) return act('assassinate', t);
  }
  if (has('chancellor')) return act('levy');
  if (has('corsair')) {
    const t = plunderTarget();
    if (t && t.coins >= 2) return act('plunder', t);
  }
  if (has('envoy') && rnd() < 0.45 && !has('duchess')) return act('exchange');

  const bluffRate = [0, 0, 0.42, 0.33, 0.27, 0.22, 0.18][n] ?? 0.2;
  if (rnd() < bluffRate) {
    const opts = [];
    if (unacc('chancellor') >= 1) opts.push(['levy', 2 + unacc('chancellor')]);
    if (coins >= 3 && unacc('shadow') >= 1) opts.push(['assassinate', 0.6 + unacc('shadow') * 0.4]);
    const pt = plunderTarget();
    if (pt && pt.coins >= 2 && unacc('corsair') >= 1) opts.push(['plunder', 0.8 + unacc('corsair') * 0.4]);
    const tot = opts.reduce((a, o) => a + o[1], 0);
    let x = rnd() * tot;
    for (const [action, w] of opts) {
      x -= w;
      if (x <= 0) {
        if (action === 'assassinate') return act(action, assassTarget());
        if (action === 'plunder') return act(action, pt);
        return act(action);
      }
    }
  }
  if (has('corsair')) {
    const t = plunderTarget();
    if (t) return act('plunder', t);
  }
  if (has('envoy') && rnd() < 0.6) return act('exchange');
  const chClaims = opp.filter((p) => p.claims.includes('chancellor')).length;
  const aidOdds = unacc('chancellor') <= 0 ? 0.95 : chClaims ? 0.25 : 0.7;
  if (rnd() < aidOdds) return act('aid');
  return act('income');
}

/* ============================================================
   Art: shared SVG defs, role portraits, card faces and backs
   ============================================================ */
const f1 = (x) => (Math.round(x * 10) / 10).toString();
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
  const r = ch(n >> 16), g = ch((n >> 8) & 255), b = ch(n & 255);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}
function rays(cx, cy, n, len, w) {
  let d = '';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    d += `M${cx} ${cy}L${f1(cx + Math.cos(a - w) * len)} ${f1(cy + Math.sin(a - w) * len)}L${f1(cx + Math.cos(a + w) * len)} ${f1(cy + Math.sin(a + w) * len)}Z`;
  }
  return d;
}
function blob(cx, cy, r, n, amp, seed = 1) {
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const rr = r + Math.sin(i * 2.7 + seed) * amp;
    return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr];
  });
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const m0 = mid(pts[0], pts[1]);
  let d = `M${f1(m0[0])} ${f1(m0[1])}`;
  for (let i = 1; i <= n; i++) {
    const p = pts[i % n], m = mid(p, pts[(i + 1) % n]);
    d += `Q${f1(p[0])} ${f1(p[1])} ${f1(m[0])} ${f1(m[1])}`;
  }
  return d + 'Z';
}

const ICON = {
  chancellor: '<path d="M3 18.5 4.6 7.5l4.6 4.6L12 4l2.8 8.1 4.6-4.6L21 18.5Z"/><rect x="3.5" y="19.2" width="17" height="2.6" rx=".8"/><circle cx="12" cy="3.2" r="1.4"/>',
  shadow: '<path d="M12 1.2 14.3 4v10.4H9.7V4Z"/><rect x="5.6" y="14.3" width="12.8" height="2.3" rx="1.1"/><rect x="10.7" y="16.6" width="2.6" height="4.3"/><circle cx="12" cy="21.8" r="1.7"/>',
  corsair: '<circle cx="12" cy="4" r="2.3" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M10.9 6.1h2.2V20.5h-2.2z"/><path d="M7.4 8.4h9.2v2h-9.2z"/><path d="M4.2 13.6c.4 4.6 3.8 7.4 7.8 7.4s7.4-2.8 7.8-7.4" fill="none" stroke="currentColor" stroke-width="2.1"/><path d="m2.4 15 2.3-3.6 1.8 3.6zM21.6 15l-2.3-3.6-1.8 3.6z"/>',
  envoy: '<path d="M21.6 2.1C13.3 2.7 7.3 8.6 5.6 17.7c2.9-2.6 5.9-4 9.2-7.8-1.9.5-3.5.8-4.8 1 2.6-1.9 5.1-3.4 7.1-5.1-1.6.1-3 .4-4.2.7 3-2.3 5.8-3.6 8.7-4.4Z"/><path d="M5.6 17.7 3 22.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  duchess: '<path d="M12 2.6c4 0 6.6 2.9 6.2 6.4-.4 3.5-3.4 5.2-6.2 5.2S6.2 12.5 5.8 9C5.4 5.5 8 2.6 12 2.6Z"/><path d="M12 6.3c2 0 2.9 1.8 1.8 3.2-1 1.2-3 .7-3-.8 0-1 .8-1.4 1.5-1.2" fill="none" stroke="rgba(0,0,0,.45)" stroke-width="1.2" stroke-linecap="round"/><path d="M12 14v8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 18.3c2-2.3 5.1-2.5 6.7-1.3-1.6 2.2-4.5 2.7-6.7 1.3ZM12 17c-1.8-2-4.6-2.2-6-1.1 1.4 1.9 4 2.4 6 1.1Z"/>',
  income: '<circle cx="12" cy="12" r="8.6"/><circle cx="12" cy="12" r="6" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="1.3"/><path d="M12 8.2v7.6M9.8 10.2h4.4" stroke="rgba(0,0,0,.4)" stroke-width="1.5" fill="none"/>',
  aid: '<circle cx="8.6" cy="13.6" r="6.4"/><circle cx="15.4" cy="10.4" r="6.4" stroke="rgba(0,0,0,.35)" stroke-width="1.2"/><circle cx="15.4" cy="10.4" r="4.2" fill="none" stroke="rgba(0,0,0,.3)" stroke-width="1"/>',
  coup: '<g fill="none" stroke="currentColor" stroke-linecap="round"><path d="M3 3 15 15M21 3 9 15" stroke-width="2.3"/><path d="M12.4 17.6 17.6 12.4M6.4 12.4l5.2 5.2" stroke-width="2.1"/><path d="M15.6 15.6 19 19M8.4 15.6 5 19" stroke-width="2.8"/></g><circle cx="20" cy="20" r="1.8"/><circle cx="4" cy="20" r="1.8"/>',
  scroll: '<path d="M6 3h11a3 3 0 0 1 3 3v1h-3v12a2 2 0 0 1-2 2H5a3 3 0 0 1-3-3v-1h3V5a2 2 0 0 1 1-2Z"/><path d="M8 7h7M8 10.5h7M8 14h5" stroke="rgba(0,0,0,.45)" stroke-width="1.3" fill="none"/>',
};
const icon = (k, cls = '') => `<svg class="bluff-ic ${cls}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${ICON[k]}</svg>`;

const BG = {
  chancellor: ['#a476e0', '#5a2f94', '#1f0c38'], shadow: ['#646a7c', '#262a33', '#060609'], corsair: ['#5aa0e0', '#1f5590', '#081a36'],
  envoy: ['#6cc08a', '#22704a', '#072616'], duchess: ['#ea6276', '#9a1a30', '#33040e'],
};
const ROBE = { chancellor: ['#8a56c8', '#33155e'], shadow: ['#34363f', '#08080b'], corsair: ['#2f66a6', '#0c2446'], envoy: ['#33915e', '#0d321d'], duchess: ['#d22e48', '#560818'] };

const DEFS = `<svg class="bluff-defs" width="0" height="0" aria-hidden="true" focusable="false" style="position:absolute;width:0;height:0;overflow:hidden"><defs>
<linearGradient id="bw-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff3c4"/><stop offset=".22" stop-color="#ebc25a"/><stop offset=".48" stop-color="#a8741d"/><stop offset=".72" stop-color="#f4d272"/><stop offset="1" stop-color="#8a5a12"/></linearGradient>
<linearGradient id="bw-goldtext" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff6d4"/><stop offset=".55" stop-color="#f2c14e"/><stop offset="1" stop-color="#c08a26"/></linearGradient>
<linearGradient id="bw-steel" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7d8693"/><stop offset=".45" stop-color="#f4f7fb"/><stop offset=".56" stop-color="#bfc7d1"/><stop offset="1" stop-color="#555d68"/></linearGradient>
<radialGradient id="bw-skin" cx=".44" cy=".38" r=".7"><stop offset="0" stop-color="#f8e0c6"/><stop offset=".68" stop-color="#e0ae86"/><stop offset="1" stop-color="#a86e4a"/></radialGradient>
<radialGradient id="bw-skin2" cx=".44" cy=".38" r=".7"><stop offset="0" stop-color="#e6b98e"/><stop offset=".68" stop-color="#b9804f"/><stop offset="1" stop-color="#7a4a26"/></radialGradient>
<radialGradient id="bw-skin3" cx=".5" cy=".6" r=".7"><stop offset="0" stop-color="#d6b49a"/><stop offset=".7" stop-color="#9a7660"/><stop offset="1" stop-color="#4a3428"/></radialGradient>
<radialGradient id="bw-vig" cx=".5" cy=".4" r=".72"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".62"/></radialGradient>
<linearGradient id="bw-parch" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbf0d6"/><stop offset="1" stop-color="#e0c690"/></linearGradient>
<radialGradient id="bw-wax" cx=".38" cy=".34" r=".72"><stop offset="0" stop-color="#e8505c"/><stop offset=".55" stop-color="#a0141f"/><stop offset="1" stop-color="#520610"/></radialGradient>
<radialGradient id="bw-backbg" cx=".5" cy=".48" r=".7"><stop offset="0" stop-color="#7a1a2c"/><stop offset=".6" stop-color="#4a0b18"/><stop offset="1" stop-color="#22040a"/></radialGradient>
<pattern id="bw-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><rect width="1.1" height="4" fill="#000"/></pattern>
<pattern id="bw-lattice" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M0 10 10 0 20 10 10 20Z" fill="none" stroke="#e9bf55" stroke-opacity=".34" stroke-width="1"/><circle cx="10" cy="10" r="1.7" fill="#e9bf55" fill-opacity=".4"/><circle cx="0" cy="0" r="1.2" fill="#e9bf55" fill-opacity=".3"/><circle cx="20" cy="0" r="1.2" fill="#e9bf55" fill-opacity=".3"/><circle cx="0" cy="20" r="1.2" fill="#e9bf55" fill-opacity=".3"/><circle cx="20" cy="20" r="1.2" fill="#e9bf55" fill-opacity=".3"/></pattern>
<clipPath id="bw-arch" clipPathUnits="userSpaceOnUse"><path d="M18 198V76A82 64 0 0 1 182 76V198Z"/></clipPath>
<clipPath id="bw-archm" clipPathUnits="userSpaceOnUse"><path d="M14 268V72A86 62 0 0 1 186 72V268Z"/></clipPath>
${ROLES.map((r) => `<radialGradient id="bw-bg-${r}" cx=".5" cy=".36" r=".78"><stop offset="0" stop-color="${BG[r][0]}"/><stop offset=".55" stop-color="${BG[r][1]}"/><stop offset="1" stop-color="${BG[r][2]}"/></radialGradient>
<linearGradient id="bw-robe-${r}" x1="0" y1="0" x2=".3" y2="1"><stop offset="0" stop-color="${ROBE[r][0]}"/><stop offset="1" stop-color="${ROBE[r][1]}"/></linearGradient>
<linearGradient id="bw-band-${r}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(R[r].color, 0.25)}"/><stop offset=".5" stop-color="${R[r].color}"/><stop offset="1" stop-color="${shade(R[r].color, -0.45)}"/></linearGradient>`).join('')}
</defs></svg>`;

function head({ cy = 106, rx = 23, ry = 28, skin = 'bw-skin', neck = true } = {}) {
  return `${neck ? `<path d="M89 ${cy + 16}L89 ${cy + 46}C94 ${cy + 52} 106 ${cy + 52} 111 ${cy + 46}L111 ${cy + 16}Z" fill="url(#${skin})" stroke="#3a2010" stroke-width="1"/>
<path d="M89 ${cy + 28}C95 ${cy + 36} 105 ${cy + 36} 111 ${cy + 28}L111 ${cy + 40}C104 ${cy + 46} 96 ${cy + 46} 89 ${cy + 40}Z" fill="#2a1408" opacity=".3"/>` : ''}
<ellipse cx="${100 - rx + 1}" cy="${cy + 3}" rx="4.5" ry="7.5" fill="url(#${skin})" stroke="#3a2010" stroke-width="1"/>
<ellipse cx="${100 + rx - 1}" cy="${cy + 3}" rx="4.5" ry="7.5" fill="url(#${skin})" stroke="#3a2010" stroke-width="1"/>
<ellipse cx="100" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#${skin})" stroke="#3a2010" stroke-width="1.3"/>
<path d="M${100 - rx + 3} ${cy + 6}C${100 - rx + 6} ${cy + ry - 2} ${100 + rx - 6} ${cy + ry - 2} ${100 + rx - 3} ${cy + 6}C${100 + rx - 8} ${cy + ry + 2} ${100 - rx + 8} ${cy + ry + 2} ${100 - rx + 3} ${cy + 6}Z" fill="#5a2a10" opacity=".12"/>`;
}
function eyes({ cy = 103, look = 0, lids = false, lash = false, brow = '#4a2a14' } = {}) {
  const e = (x) => `<path d="M${x - 5.5} ${cy}Q${x} ${cy - 4.2} ${x + 5.5} ${cy}Q${x} ${cy + 3.2} ${x - 5.5} ${cy}Z" fill="#fbf6ee" stroke="#3a2010" stroke-width=".8"/>
<circle cx="${x + look}" cy="${cy - 0.2}" r="2.3" fill="#3a2414"/><circle cx="${x + look - 0.7}" cy="${cy - 1}" r=".7" fill="#fff"/>
${lids ? `<path d="M${x - 5.9} ${cy - 0.3}Q${x} ${cy - 4.6} ${x + 5.9} ${cy - 0.3}Q${x} ${cy - 1.2} ${x - 5.9} ${cy - 0.3}Z" fill="#d9a47c" stroke="#3a2010" stroke-width=".8"/>` : ''}
${lash ? `<path d="M${x - 6} ${cy - 0.5}Q${x} ${cy - 5} ${x + 6.5} ${cy - 1.5}" fill="none" stroke="#1a0a05" stroke-width="1.7" stroke-linecap="round"/>` : ''}`;
  return e(91) + e(109) + `<path d="M84.5 ${cy - 6.5}Q91 ${cy - 10} 97 ${cy - 6.8}M103 ${cy - 6.8}Q109 ${cy - 10} 115.5 ${cy - 6.5}" fill="none" stroke="${brow}" stroke-width="2.2" stroke-linecap="round"/>`;
}
const nose = (cy = 104) => `<path d="M100.5 ${cy}Q98 ${cy + 9} 99 ${cy + 12}Q101 ${cy + 13.5} 104 ${cy + 11.5}" fill="none" stroke="#8a5434" stroke-width="1.4" stroke-linecap="round"/>`;
const cheeks = (cy = 114) => `<circle cx="87" cy="${cy}" r="5.5" fill="#e0735e" opacity=".2"/><circle cx="113" cy="${cy}" r="5.5" fill="#e0735e" opacity=".2"/>`;
const bust = (fill, stroke) => {
  const d = 'M14 280V214C20 172 54 154 100 152C146 154 180 172 186 214V280Z';
  return `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/><path d="${d}" fill="url(#bw-hatch)" opacity=".22"/>`;
};

const PORTRAIT = {
  chancellor: () => `
<path d="${rays(100, 102, 18, 140, 0.075)}" fill="#f7da7c" opacity=".15"/>
<circle cx="100" cy="100" r="60" fill="#f7da7c" opacity=".08"/>
${bust('url(#bw-robe-chancellor)', '#1a0a2a')}
<path d="M100 196V280" stroke="#e9bf55" stroke-width="6"/><path d="M100 196V280" stroke="#5a3a08" stroke-width="1" stroke-dasharray="3 5"/>
${head({ cy: 112 })}
<path d="M78 98C70 106 70 124 76 134C78 122 79 110 82 102ZM122 98C130 106 130 124 124 134C122 122 121 110 118 102Z" fill="#ece6da" stroke="#8a8274" stroke-width=".8"/>
${eyes({ cy: 107, lids: true, brow: '#e2dccf' })}
${nose(108)}${cheeks(117)}
<path d="M79 118C80 144 90 158 100 160C110 158 120 144 121 118C116 128 110 132 100 132C90 132 84 128 79 118Z" fill="#ece6da" stroke="#8a8274" stroke-width="1"/>
<path d="M86 132C88 142 94 150 100 152M114 132C112 142 106 150 100 152M92 134C94 144 97 150 100 155M108 134C106 144 103 150 100 155" fill="none" stroke="#a8a090" stroke-width=".8"/>
<path d="M87 125C93 120 98 122 100 123.5C102 122 107 120 113 125C107 127.5 103 127 100 126C97 127 93 127.5 87 125Z" fill="#dcd5c7" stroke="#8a8274" stroke-width=".8"/>
<path d="M38 188C52 164 78 158 100 166C122 158 148 164 162 188C150 202 122 194 100 206C78 194 50 202 38 188Z" fill="#f7f2e8" stroke="#9a9080" stroke-width="1"/>
<g fill="#16120e">${[[52, 186], [66, 177], [82, 172], [118, 172], [134, 177], [148, 186], [70, 191], [130, 191], [92, 182], [108, 182], [100, 194]].map(([x, y]) => `<path d="M${x} ${y - 3.5}L${x + 1.7} ${y + 2}L${x} ${y + 1}L${x - 1.7} ${y + 2}Z"/>`).join('')}</g>
<path d="M60 186C74 208 126 208 140 186" fill="none" stroke="#4a2c06" stroke-width="5.5"/>
<path d="M60 186C74 208 126 208 140 186" fill="none" stroke="url(#bw-gold)" stroke-width="3.6" stroke-dasharray="4.5 1.8"/>
<circle cx="100" cy="207" r="9" fill="url(#bw-gold)" stroke="#4a2c06" stroke-width="1.2"/><circle cx="100" cy="207" r="4" fill="#7a2fc0" stroke="#2a1606" stroke-width=".8"/>
<path d="M73 90L70 62L85 76L100 50L115 76L130 62L127 90Z" fill="url(#bw-gold)" stroke="#4a2c06" stroke-width="1.5" stroke-linejoin="round"/>
<path d="M78 86L77 70L87 80M100 58V80M122 86L123 70L113 80" fill="none" stroke="#fff3c0" stroke-width="1" opacity=".6"/>
<rect x="71" y="84" width="58" height="11" rx="2.5" fill="url(#bw-gold)" stroke="#4a2c06" stroke-width="1.3"/>
<circle cx="86" cy="89.5" r="3" fill="#d0304a" stroke="#4a0610" stroke-width=".7"/><ellipse cx="100" cy="89.5" rx="4" ry="3.4" fill="#3279c4" stroke="#0b2546" stroke-width=".7"/><circle cx="114" cy="89.5" r="3" fill="#2f9a5e" stroke="#0b3520" stroke-width=".7"/>
<g fill="#fffaf0" stroke="#8a7a5a" stroke-width=".6"><circle cx="70" cy="61" r="3"/><circle cx="100" cy="48.5" r="3.4"/><circle cx="130" cy="61" r="3"/></g>
<g transform="rotate(-16 66 168)">
<rect x="30" y="158" width="76" height="20" rx="3" fill="url(#bw-parch)" stroke="#6a4a20" stroke-width="1.3"/>
<path d="M40 164.5H96M40 169H92M40 173.5H86" stroke="#7a5a30" stroke-width="1" opacity=".55"/>
<ellipse cx="30" cy="168" rx="5.5" ry="11" fill="#e8d4a4" stroke="#6a4a20" stroke-width="1.2"/>
<ellipse cx="106" cy="168" rx="5.5" ry="11" fill="#e8d4a4" stroke="#6a4a20" stroke-width="1.2"/><ellipse cx="106" cy="168" rx="2" ry="5" fill="#b89860"/>
<rect x="62" y="156.5" width="6" height="23" fill="#7a1a8a"/><path d="M63 179L60 190L64 187L67 191L68 179Z" fill="#6a126a"/>
<path d="${blob(65, 179, 5.6, 10, 0.7)}" fill="url(#bw-wax)" stroke="#4a0610" stroke-width=".8"/>
</g>`,

  shadow: () => `
<path d="M60 44A20 20 0 1 0 60 84A22 22 0 0 1 60 44Z" fill="#efeadb" opacity=".88"/>
<g fill="#e8ecff" opacity=".75"><circle cx="150" cy="44" r="1.3"/><circle cx="166" cy="72" r="1"/><circle cx="136" cy="30" r=".9"/><circle cx="34" cy="114" r="1"/><circle cx="170" cy="40" r=".8"/></g>
<path d="M16 280V220C22 170 46 148 64 136C56 104 66 66 100 54C134 66 144 104 136 136C154 148 178 170 184 220V280Z" fill="url(#bw-robe-shadow)" stroke="#000" stroke-width="1.5"/>
<path d="M16 280V220C22 170 46 148 64 136C56 104 66 66 100 54C134 66 144 104 136 136C154 148 178 170 184 220V280Z" fill="url(#bw-hatch)" opacity=".32"/>
<path d="M64 136C80 152 120 152 136 136M100 54C82 62 72 84 72 106M100 54C118 62 128 84 128 106M44 170C60 190 70 230 66 280M156 170C140 190 130 230 134 280" fill="none" stroke="#4a4e5a" stroke-width="1.2" opacity=".75"/>
<path d="M76 134C68 104 78 76 100 70C122 76 132 104 124 134C116 144 84 144 76 134Z" fill="#040405"/>
${head({ cy: 110, rx: 21, ry: 26, skin: 'bw-skin3', neck: false })}
<path d="M79 104C82 84 118 84 121 104C112 94 88 94 79 104Z" fill="#000" opacity=".6"/>
<path d="M74 106C80 96 94 97 100 103C106 97 120 96 126 106C124 117 110 120 100 112C90 120 76 117 74 106Z" fill="#efebe2" stroke="#1a1006" stroke-width="1.2"/>
<path d="M74 106C80 96 94 97 100 103C106 97 120 96 126 106" fill="none" stroke="url(#bw-gold)" stroke-width="1.8"/>
<path d="M82 107Q89 101 96 107Q89 111 82 107ZM104 107Q111 101 118 107Q111 111 104 107Z" fill="#060606"/>
<circle cx="90" cy="106.4" r="1.3" fill="#d6e2ff"/><circle cx="112" cy="106.4" r="1.3" fill="#d6e2ff"/>
<path d="M78 117C88 128 112 128 122 117L124 138C112 146 88 146 76 138Z" fill="#17171b" stroke="#000" stroke-width="1"/>
<path d="M82 126C92 132 108 132 118 126M80 133C92 139 108 139 120 133" fill="none" stroke="#30303a" stroke-width="1"/>
<g transform="rotate(36 100 166)">
<path d="M95.5 64L100 46L104.5 64L104.5 156L95.5 156Z" fill="url(#bw-steel)" stroke="#1a1d22" stroke-width="1"/>
<path d="M100 50V156" stroke="#fff" stroke-opacity=".55" stroke-width=".8"/>
<path d="M100 46L102.4 55L100 60L97.6 55Z" fill="#c0283f" opacity=".85"/>
<path d="M78 156C86 150 114 150 122 156C114 162 86 162 78 156Z" fill="url(#bw-gold)" stroke="#4a2c06" stroke-width="1"/>
<circle cx="78" cy="156" r="3.4" fill="url(#bw-gold)" stroke="#4a2c06" stroke-width=".8"/><circle cx="122" cy="156" r="3.4" fill="url(#bw-gold)" stroke="#4a2c06" stroke-width=".8"/>
<rect x="95.5" y="160" width="9" height="28" rx="2.5" fill="#5a1220" stroke="#200408" stroke-width="1"/>
<path d="M95.5 166L104.5 170M95.5 172L104.5 176M95.5 178L104.5 182" stroke="#2a0810" stroke-width="1.2"/>
<circle cx="100" cy="193" r="6.5" fill="url(#bw-gold)" stroke="#4a2c06" stroke-width="1"/><circle cx="100" cy="193" r="2.4" fill="#c0283f"/>
</g>`,

  corsair: () => `
<path d="M8 150Q26 142 44 150T80 150T116 150T152 150T188 150T224 150" fill="none" stroke="#a8d4f5" stroke-opacity=".3" stroke-width="2"/>
<path d="M-10 164Q8 156 26 164T62 164T98 164T134 164T170 164T206 164" fill="none" stroke="#a8d4f5" stroke-opacity=".2" stroke-width="2"/>
<g fill="#d6ebff" opacity=".2"><path d="M24 138H60L55 145H29Z"/><path d="M35 137V108M48 137V112" stroke="#d6ebff" stroke-width="1.4"/><path d="M36 110L36 132L46 130ZM49 114L49 132L58 131Z"/></g>
${bust('url(#bw-robe-corsair)', '#06142a')}
<path d="M80 156L100 204L90 280L58 280C58 220 66 178 80 156Z" fill="#173e6e" stroke="url(#bw-gold)" stroke-width="2"/>
<path d="M120 156L100 204L110 280L142 280C142 220 134 178 120 156Z" fill="#173e6e" stroke="url(#bw-gold)" stroke-width="2"/>
<path d="M86 152L100 200L114 152C108 158 92 158 86 152Z" fill="#f2ede2" stroke="#9a9280" stroke-width=".8"/>
<path d="M92 156C94 168 106 168 108 156L104 178L100 172L96 178Z" fill="#e8e0cc" stroke="#9a9280" stroke-width=".8"/>
<g fill="url(#bw-gold)" stroke="#4a2c06" stroke-width=".6"><circle cx="70" cy="186" r="3"/><circle cx="66" cy="202" r="3"/><circle cx="130" cy="186" r="3"/><circle cx="134" cy="202" r="3"/></g>
${head({ cy: 110, skin: 'bw-skin2' })}
<path d="M77 100C72 110 72 126 78 134L82 104ZM123 100C128 110 128 126 122 134L118 104Z" fill="#2a1a0e"/>
<path d="M124 110C134 118 138 132 132 146C128 136 126 124 121 116Z" fill="#2a1a0e"/>
<path d="M78 116C80 136 92 145 100 145C108 145 120 136 122 116C117 128 110 131 100 131C90 131 83 128 78 116Z" fill="#2a1a0e" opacity=".9"/>
${eyes({ cy: 106, look: 0.6, brow: '#2a1a0e' })}
<path d="M76 99L124 112" stroke="#111" stroke-width="1.8"/>
<path d="M103 103C107 99 116 100 118 105C117 112 107 112 103 106Z" fill="#141414" stroke="#000" stroke-width=".8"/>
${nose(107)}
<path d="M90 125C95 122 98 123 100 124C102 123 105 122 110 125C105 127 102 127 100 126.5C98 127 95 127 90 125Z" fill="#2a1a0e"/>
<path d="M93 129.5Q100 133 108 128" fill="none" stroke="#7a3a2a" stroke-width="1.8" stroke-linecap="round"/>
<circle cx="77.5" cy="120" r="3.2" fill="none" stroke="url(#bw-gold)" stroke-width="1.8"/>
<path d="M75 90C74 64 126 64 125 90Z" fill="#181a21" stroke="#000" stroke-width="1"/>
<path d="M48 90C60 72 84 82 100 78C116 82 140 72 152 90C138 101 118 96 100 103C82 96 62 101 48 90Z" fill="#1e2129" stroke="url(#bw-gold)" stroke-width="2.4"/>
<path d="M60 90C74 86 88 92 100 92C112 92 126 86 140 90" fill="none" stroke="#3a3e4a" stroke-width="1.2"/>
<circle cx="100" cy="88" r="3.4" fill="url(#bw-gold)" stroke="#4a2c06" stroke-width=".6"/>
<path d="M116 76C128 54 152 42 172 46C156 52 140 64 124 82Z" fill="#f5f0e6" stroke="#9a907a" stroke-width=".8"/>
<path d="M118 80C132 60 150 50 170 47" fill="none" stroke="#9a907a" stroke-width=".8"/>
<path d="M128 70l6-1M136 62l6-1M144 56l6 0M152 51l6 0" stroke="#c8c0aa" stroke-width=".8"/>
<g transform="translate(150 116)">
<circle cx="0" cy="0" r="6.5" fill="none" stroke="#3a2406" stroke-width="5"/><circle cx="0" cy="0" r="6.5" fill="none" stroke="url(#bw-gold)" stroke-width="3"/>
<rect x="-15" y="9" width="30" height="6" rx="2.5" fill="url(#bw-gold)" stroke="#3a2406" stroke-width="1"/>
<rect x="-3" y="6" width="6" height="54" rx="1.5" fill="url(#bw-gold)" stroke="#3a2406" stroke-width="1"/>
<path d="M-26 40C-24 56-11 63 0 63C11 63 24 56 26 40" fill="none" stroke="#3a2406" stroke-width="7.5" stroke-linecap="round"/>
<path d="M-26 40C-24 56-11 63 0 63C11 63 24 56 26 40" fill="none" stroke="url(#bw-gold)" stroke-width="5" stroke-linecap="round"/>
<path d="M-26 37L-34 47L-21 47ZM26 37L34 47L21 47Z" fill="url(#bw-gold)" stroke="#3a2406" stroke-width="1"/>
</g>`,

  envoy: () => `
<g fill="none" stroke="#c9f0d4" stroke-opacity=".16" stroke-width="1.1"><ellipse cx="100" cy="96" rx="78" ry="56"/><ellipse cx="100" cy="96" rx="40" ry="56"/><path d="M22 96H178M30 68C70 60 130 60 170 68M30 124C70 132 130 132 170 124M100 40V152"/></g>
<g transform="translate(160 46)" opacity=".45"><path d="M0-15L3-3L15 0L3 3L0 15L-3 3L-15 0L-3-3Z" fill="#f2cf6d"/><circle r="3" fill="#0b3520"/></g>
${bust('url(#bw-robe-envoy)', '#06200f')}
<path d="M54 176L156 236L148 250L44 190Z" fill="url(#bw-gold)" opacity=".88" stroke="#4a2c06" stroke-width="1"/>
${head({ cy: 108 })}
<path d="M74 150C78 138 122 138 126 150L120 168C112 160 88 160 80 168Z" fill="#1f6a40" stroke="url(#bw-gold)" stroke-width="1.6"/>
<path d="M77 96C68 104 68 122 76 132C80 126 78 118 82 112C78 108 80 100 84 96ZM123 96C132 104 132 122 124 132C120 126 122 118 118 112C122 108 120 100 116 96Z" fill="#6a3a1a" stroke="#3a1e0a" stroke-width=".8"/>
${eyes({ cy: 104, look: 1.4 })}
${nose(105)}${cheeks(115)}
<path d="M92 122.5Q100 127 108 122.5" fill="none" stroke="#8a3a2a" stroke-width="1.8" stroke-linecap="round"/>
<path d="M70 92C64 72 88 58 108 60C132 62 144 76 134 92C120 84 84 84 70 92Z" fill="#1a4a2e" stroke="#06200f" stroke-width="1.2"/>
<path d="M72 92C86 85 116 85 132 92L131 97C116 90 86 90 73 97Z" fill="#0e2e1b" stroke="#06200f" stroke-width=".8"/>
<path d="M126 80C134 66 146 60 156 60C148 66 138 74 128 84Z" fill="#e8f4ea" stroke="#9ab4a0" stroke-width=".7"/>
<circle cx="126" cy="82" r="4" fill="url(#bw-gold)" stroke="#4a2c06" stroke-width=".8"/>
<path d="M146 192C142 154 148 104 174 66C172 104 164 146 152 192Z" fill="#fbf8f0" stroke="#9a907a" stroke-width="1"/>
<path d="M149 192C150 152 156 108 173 68" fill="none" stroke="#9a907a" stroke-width="1"/>
<path d="M152 160l8-8M153 146l9-9M155 132l9-9M158 118l9-9M161 104l8-9M164 90l7-8" stroke="#cfc6b0" stroke-width=".8"/>
<path d="M146 192L149 204L152 192Z" fill="#26221c"/>
<g transform="rotate(-9 58 168)">
<rect x="26" y="150" width="64" height="40" rx="2" fill="url(#bw-parch)" stroke="#6a4a20" stroke-width="1.2"/>
<path d="M26 150L58 174L90 150" fill="none" stroke="#6a4a20" stroke-width="1.2"/>
<path d="M26 190L50 170M90 190L66 170" fill="none" stroke="#a88a58" stroke-width=".8"/>
<path d="${blob(58, 174, 10, 12, 1.2)}" fill="url(#bw-wax)" stroke="#4a0610" stroke-width=".8"/>
<circle cx="58" cy="174" r="6" fill="none" stroke="#5a0610" stroke-width="1"/>
<path d="M55 177.5L61 170.5" stroke="#ffb0b0" stroke-opacity=".55" stroke-width="1.4" stroke-linecap="round"/>
</g>`,

  duchess: () => `
<g fill="#f7c66b" opacity=".1">${[[36, 52], [164, 52], [28, 128], [172, 128], [100, 30]].map(([x, y]) => `<path d="M${x} ${y - 12}C${x + 5} ${y - 5} ${x + 5} ${y} ${x} ${y + 3}C${x - 5} ${y} ${x - 5} ${y - 5} ${x} ${y - 12}ZM${x} ${y + 3}C${x + 8} ${y + 2} ${x + 12} ${y + 8} ${x + 9} ${y + 13}C${x + 5} ${y + 10} ${x + 3} ${y + 7} ${x} ${y + 3}ZM${x} ${y + 3}C${x - 8} ${y + 2} ${x - 12} ${y + 8} ${x - 9} ${y + 13}C${x - 5} ${y + 10} ${x - 3} ${y + 7} ${x} ${y + 3}Z"/>`).join('')}</g>
<ellipse cx="100" cy="64" rx="17" ry="12" fill="#2a140c" stroke="#120804" stroke-width="1"/>
<path d="M14 280V218C22 180 56 164 84 162C92 172 108 172 116 162C144 164 178 180 186 218V280Z" fill="url(#bw-robe-duchess)" stroke="#2a0408" stroke-width="1.5"/>
<path d="M14 280V218C22 180 56 164 84 162C92 172 108 172 116 162C144 164 178 180 186 218V280Z" fill="url(#bw-hatch)" opacity=".2"/>
<path d="M91 118L91 150C86 156 84 160 84 162C92 172 108 172 116 162C116 160 114 156 109 150L109 118Z" fill="url(#bw-skin)" stroke="#3a2010" stroke-width="1"/>
<path d="M78 163C90 180 110 180 122 163" fill="none" stroke="#fbf1e2" stroke-width="3.4" stroke-dasharray="2.4 1.6"/>
<path d="M89 146C94 156 106 156 111 146" fill="none" stroke="#fffaf0" stroke-width="3.6" stroke-linecap="round" stroke-dasharray=".1 4.6"/>
<circle cx="100" cy="157" r="3.4" fill="#fffaf0" stroke="#bfb6a0" stroke-width=".6"/>
${head({ cy: 102, rx: 20, ry: 25, neck: false })}
<path d="M78 110C70 80 86 68 100 68C114 68 130 80 122 110C120 92 112 82 100 82C88 82 80 92 78 110Z" fill="#2e160d" stroke="#120804" stroke-width="1"/>
<path d="M84 90C90 82 96 80 100 82M100 82C106 80 112 82 116 90" fill="none" stroke="#5a3020" stroke-width="1" opacity=".8"/>
<path d="M80 82L86 70L92 76L100 62L108 76L114 70L120 82C110 77 90 77 80 82Z" fill="url(#bw-gold)" stroke="#4a2c06" stroke-width="1"/>
<circle cx="100" cy="70" r="2.8" fill="#d0304a" stroke="#4a0610" stroke-width=".6"/><circle cx="86" cy="71" r="1.6" fill="#fffaf0"/><circle cx="114" cy="71" r="1.6" fill="#fffaf0"/>
${eyes({ cy: 100, lash: true, look: -0.6, brow: '#2a140c' })}
${nose(101)}${cheeks(111)}
<path d="M93.5 117.5Q97 115.5 100 116.6Q103 115.5 106.5 117.5Q100 122.5 93.5 117.5Z" fill="#b8182e" stroke="#6a0a18" stroke-width=".6"/>
<circle cx="110.5" cy="111" r=".9" fill="#2a140c"/>
<g fill="#fffaf0" stroke="#bfb6a0" stroke-width=".5"><circle cx="80" cy="113" r="2.4"/><circle cx="120" cy="113" r="2.4"/></g>
<g transform="translate(58 194)">
<path d="M0 0L-40-23A46 46 0 0 1 40-23Z" fill="#f4e6cf" stroke="#4a2c06" stroke-width="1.2"/>
${[0, 2, 4, 6].map((i) => { const a1 = ((210 + i * 15) * Math.PI) / 180, a2 = ((225 + i * 15) * Math.PI) / 180; return `<path d="M0 0L${f1(Math.cos(a1) * 46)} ${f1(Math.sin(a1) * 46)}A46 46 0 0 1 ${f1(Math.cos(a2) * 46)} ${f1(Math.sin(a2) * 46)}Z" fill="#e3c9a2"/>`; }).join('')}
<path d="M-40-23A46 46 0 0 1 40-23L31.2-18A36 36 0 0 0-31.2-18Z" fill="#b8182e" opacity=".88"/>
<g stroke="url(#bw-gold)" stroke-width="1.2">${[210, 225, 240, 255, 270, 285, 300, 315, 330].map((d) => { const a = (d * Math.PI) / 180; return `<path d="M0 0L${f1(Math.cos(a) * 46)} ${f1(Math.sin(a) * 46)}"/>`; }).join('')}</g>
<path d="M-40-23A46 46 0 0 1 40-23" fill="none" stroke="#4a2c06" stroke-width="1.2"/>
<circle r="4.5" fill="url(#bw-gold)" stroke="#4a2c06" stroke-width=".8"/>
</g>
<g transform="translate(148 168) scale(1.45)">
<path d="M0 12C2 22-2 30 0 40" stroke="#2f5a2a" stroke-width="2.6" fill="none"/>
<path d="M-9 12C-21 10-28 17-30 24C-19 25-11 21-9 12ZM9 13C21 13 25 21 27 27C16 26 10 21 9 13Z" fill="#2f6a3a" stroke="#123a18" stroke-width=".8"/>
<path d="M-20 21L-10 14M18 21L10 15" stroke="#5a9a5a" stroke-width=".7"/>
<path d="M-15 2C-18-8-10-16 0-15C10-16 18-8 15 2C13 10 7 15 0 15C-7 15-13 10-15 2Z" fill="#8a1024"/>
<path d="M-14 1C-14-7-7-10 0-6C-4-2-6 4-4 11C-10 10-14 6-14 1Z" fill="#c0283f" stroke="#5a0812" stroke-width=".8"/>
<path d="M14 1C14-7 7-10 0-6C4-2 6 4 4 11C10 10 14 6 14 1Z" fill="#cc3550" stroke="#5a0812" stroke-width=".8"/>
<path d="M-5 11C-2 14 2 14 5 11C7 5 5-1 0-4C-5-1-7 5-5 11Z" fill="#dc4560" stroke="#5a0812" stroke-width=".8"/>
<path d="M-8-5C-7-13 7-13 8-5C4-9-4-9-8-5Z" fill="#e65a72" stroke="#5a0812" stroke-width=".8"/>
<path d="M-3.5-6C-3-9.5 3-9.5 3.5-6C2.5-4-1-4-1-6.2" fill="none" stroke="#5a0812" stroke-width="1"/>
<path d="M-11-2C-10-6-7-8-4-7M6 3C7 6 6 8 4 9" fill="none" stroke="#ff9aaa" stroke-width=".9" opacity=".7"/>
</g>`,
};

const CORNER = '<path d="M13 36C13 21 21 13 36 13" fill="none" stroke="url(#bw-gold)" stroke-width="2.2"/><circle cx="19.5" cy="19.5" r="3" fill="url(#bw-gold)" stroke="#4a2c06" stroke-width=".6"/>';
const CORNERS = `<g>${CORNER}</g><g transform="matrix(-1 0 0 1 200 0)">${CORNER}</g><g transform="matrix(1 0 0 -1 0 280)">${CORNER}</g><g transform="matrix(-1 0 0 -1 200 280)">${CORNER}</g>`;
const ARCH = 'M18 198V76A82 64 0 0 1 182 76V198Z';
const ARCH_M = 'M14 268V72A86 62 0 0 1 186 72V268Z';

function cardBanner(role) {
  const r = R[role], dark = shade(r.color, -0.55), NAME = r.name.toUpperCase();
  const fit = NAME.length > 8 ? ' textLength="146" lengthAdjust="spacingAndGlyphs"' : '';
  return `<path d="M6 197H26V221H6L13 209Z" fill="${dark}" stroke="#1a0c04" stroke-width="1"/><path d="M194 197H174V221H194L187 209Z" fill="${dark}" stroke="#1a0c04" stroke-width="1"/>
<path d="M20 191H180V218H20Z" fill="url(#bw-band-${role})" stroke="url(#bw-gold)" stroke-width="2"/>
<path d="M22 194.5H178M22 214.5H178" stroke="#f6d77a" stroke-opacity=".45" stroke-width=".8"/>
<text x="100" y="211.6" text-anchor="middle" font-family="Cinzel, Georgia, serif" font-weight="800" font-size="19" letter-spacing="2.4" fill="#1a0c04" opacity=".55"${fit}>${NAME}</text>
<text x="100" y="210.2" text-anchor="middle" font-family="Cinzel, Georgia, serif" font-weight="800" font-size="19" letter-spacing="2.4" fill="url(#bw-goldtext)"${fit}>${NAME}</text>
<rect x="28" y="225" width="144" height="41" rx="5" fill="url(#bw-parch)" stroke="#6a4a20" stroke-width="1.2"/>
<text x="100" y="242" text-anchor="middle" font-family="Cinzel, Georgia, serif" font-weight="800" font-size="11.5" fill="${r.ink}"${r.l1.length > 15 ? ' textLength="132" lengthAdjust="spacingAndGlyphs"' : ''}>${r.l1}</text>
<text x="100" y="258.5" text-anchor="middle" font-family="Nunito, system-ui, sans-serif" font-weight="800" font-style="italic" font-size="11.5" fill="#5a4020">${r.l2}</text>`;
}
function miniMedal(role) {
  const r = R[role];
  return `<circle cx="100" cy="234" r="34" fill="#1a0c04" opacity=".55"/><circle cx="100" cy="232" r="32" fill="url(#bw-band-${role})" stroke="url(#bw-gold)" stroke-width="5"/>
<g transform="translate(72 204) scale(2.333)" fill="#fff4d6" color="#fff4d6">${ICON[role]}</g>`;
}

const FACE_CACHE = {};
function faceSVG(role, mini = false) {
  const key = role + (mini ? 'm' : '');
  if (FACE_CACHE[key]) return FACE_CACHE[key];
  const r = R[role];
  const arch = mini ? ARCH_M : ARCH;
  return (FACE_CACHE[key] = `<svg class="bluff-svg" viewBox="0 0 200 280" role="img" aria-label="${r.name}">
<rect width="200" height="280" rx="14" fill="#120904"/>
<rect x="4" y="4" width="192" height="272" rx="11" fill="${r.deep}"/>
<rect x="4" y="4" width="192" height="272" rx="11" fill="url(#bw-hatch)" opacity=".2"/>
<g clip-path="url(#${mini ? 'bw-archm' : 'bw-arch'})"><rect width="200" height="280" fill="url(#bw-bg-${role})"/>${PORTRAIT[role]()}<rect width="200" height="280" fill="url(#bw-hatch)" opacity=".09"/><rect width="200" height="280" fill="url(#bw-vig)"/></g>
<path d="${arch}" fill="none" stroke="#2a1606" stroke-width="5"/><path d="${arch}" fill="none" stroke="url(#bw-gold)" stroke-width="2.6"/>
${mini ? miniMedal(role) : cardBanner(role)}
<rect x="5.5" y="5.5" width="189" height="269" rx="11" fill="none" stroke="url(#bw-gold)" stroke-width="5"/>
<rect x="11" y="11" width="178" height="258" rx="7" fill="none" stroke="#f6d77a" stroke-opacity=".5" stroke-width="1"/>
${CORNERS}</svg>`);
}

const BACK_SVG = `<svg class="bluff-svg" viewBox="0 0 200 280" role="img" aria-label="Hidden card">
<rect width="200" height="280" rx="14" fill="#120904"/>
<rect x="4" y="4" width="192" height="272" rx="11" fill="url(#bw-backbg)"/>
<rect x="4" y="4" width="192" height="272" rx="11" fill="url(#bw-lattice)"/>
<rect x="5.5" y="5.5" width="189" height="269" rx="11" fill="none" stroke="url(#bw-gold)" stroke-width="5"/>
<rect x="16" y="16" width="168" height="248" rx="8" fill="none" stroke="#f2cf6d" stroke-opacity=".75" stroke-width="1.6"/>
<rect x="22" y="22" width="156" height="236" rx="6" fill="none" stroke="#f2cf6d" stroke-opacity=".4" stroke-width="1" stroke-dasharray="3 3"/>
${CORNERS}
<path d="M100 40C112 56 112 66 100 76C88 66 88 56 100 40ZM100 240C112 224 112 214 100 204C88 214 88 224 100 240Z" fill="url(#bw-gold)" opacity=".7"/>
<path d="M100 140L58 232L74 236L100 166L126 236L142 232Z" fill="#6a0a16" stroke="url(#bw-gold)" stroke-width="1.4"/>
<circle cx="100" cy="143" r="44" fill="#000" opacity=".35"/>
<path d="${blob(100, 140, 41, 16, 2.2, 0.4)}" fill="url(#bw-wax)" stroke="#3a0408" stroke-width="1.2"/>
<circle cx="100" cy="140" r="30" fill="none" stroke="#4a0610" stroke-width="3" opacity=".75"/>
<circle cx="99.2" cy="139" r="30" fill="none" stroke="#ff9a9a" stroke-width="1" opacity=".28"/>
<path d="M78 137C82 127 94 127 100 134C106 127 118 127 122 137C121 148 108 151 100 144C92 151 79 148 78 137ZM85 138Q90 133 95 138Q90 141 85 138ZM105 138Q110 133 115 138Q110 141 105 138Z" fill="#6e0812" fill-rule="evenodd" stroke="#ff9a9a" stroke-opacity=".35" stroke-width="1"/>
<path d="M88 124L90 114L95 119L100 110L105 119L110 114L112 124Z" fill="#6e0812" stroke="#ff9a9a" stroke-opacity=".35" stroke-width="1"/>
<path d="M76 158Q100 166 124 158" fill="none" stroke="#ff9a9a" stroke-opacity=".25" stroke-width="1"/>
</svg>`;

const CRACK = `<div class="bluff-lost"><svg viewBox="0 0 200 280" preserveAspectRatio="none"><g class="ck">
<path d="M128 4L112 58L134 86L96 136L118 170L84 222L100 276" stroke="#1a0404" stroke-width="6"/>
<path d="M128 4L112 58L134 86L96 136L118 170L84 222L100 276" stroke="#fff0dc" stroke-width="2.4"/>
<path d="M134 86L170 104L188 98M96 136L58 150L30 140M118 170L150 196" stroke="#1a0404" stroke-width="4.5"/>
<path d="M134 86L170 104L188 98M96 136L58 150L30 140M118 170L150 196" stroke="#fff0dc" stroke-width="1.6"/>
</g></svg><span class="bluff-lost-x">LOST</span></div>`;

/* ============================================================
   Cover art: a candlelit throne room. The Duchess whispers behind her fan, the Chancellor
   flashes a role card with a smirk, and a masked Shadow points at him ("Liar!") while he
   hides a dagger behind his back. Self-contained ids (cwc-…): covers appear several times.
   ============================================================ */
function coverSVG() {
  const stop = ([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}"${a < 1 ? ` stop-opacity="${a}"` : ''}/>`;
  const lg = (id, stops, x2 = 0, y2 = 1) => `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops.map(stop).join('')}</linearGradient>`;
  const rg = (id, stops, cx = 0.5, cy = 0.5, r = 0.5) => `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${stops.map(stop).join('')}</radialGradient>`;
  const glow = (x, y, r, col, o) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${col}" opacity="${o}" filter="url(#cwc-blur)"/>`;
  const spark = (x, y, s, col = '#fff3c8') => `<path d="M${x} ${f1(y - s)}L${f1(x + s * 0.26)} ${f1(y - s * 0.26)}L${f1(x + s)} ${y}L${f1(x + s * 0.26)} ${f1(y + s * 0.26)}L${x} ${f1(y + s)}L${f1(x - s * 0.26)} ${f1(y + s * 0.26)}L${f1(x - s)} ${y}L${f1(x - s * 0.26)} ${f1(y - s * 0.26)}Z" fill="${col}"/>`;
  const edgeY = (x) => 148 - 20 * (x / 320) * (1 - x / 320); // the table's front edge
  const coin = (x, y) => `<ellipse cx="${x}" cy="${y + 1.8}" rx="7" ry="2.8" fill="#7a4c0a"/><ellipse cx="${x}" cy="${y}" rx="7" ry="2.8" fill="url(#cwc-gold)" stroke="#9a6410" stroke-width=".5"/>`;
  const stack = (x, y, n) => Array.from({ length: n }, (_, i) => coin(x + (i % 2 ? 0.6 : -0.4), y - i * 2.6)).join('');
  const sconce = (x) => `${glow(x, 50, 12, '#ffc860', 0.6)}<path d="M${x - 6} 66h12l-3 4h-6z" fill="url(#cwc-gold)"/><rect x="${x - 2}" y="55" width="4" height="11" rx="1" fill="#f3e6c8"/>` +
    `<path d="M${x} 46c2.6 3.4 2.8 6 0 8.4c-2.8-2.4-2.6-5 0-8.4z" fill="url(#cwc-flame)"/>`;
  // the Duchess's pearls follow her neckline
  const pearls = Array.from({ length: 6 }, (_, i) => {
    const t = 0.15 + i * 0.14, x = (1 - t) ** 2 * 51 + 2 * t * (1 - t) * 66 + t * t * 81, y = (1 - t) ** 2 * 122 + 2 * t * (1 - t) * 133 + t * t * 122;
    return `<circle cx="${f1(x)}" cy="${f1(y)}" r="1.5" fill="#fffaf0"/>`;
  }).join('');
  // her fan: a half-open sector pivoting in her hand, ribs fanning out
  const fanR = 17, fx = 70, fy = 115, at = (deg, r = fanR) => [f1(fx + r * Math.cos((deg * Math.PI) / 180)), f1(fy - r * Math.sin((deg * Math.PI) / 180))];
  const [ax, ay] = at(20), [bx, by] = at(160);
  const ribs = Array.from({ length: 8 }, (_, i) => { const [x, y] = at(20 + i * 20); return `M${fx} ${fy}L${x} ${y}`; }).join('');
  const fringe = Array.from({ length: 20 }, (_, i) => { const x = 8 + i * 16, y = f1(edgeY(x) + 1.5); return `<path d="M${x - 3} ${y}l3 6l3-6z" fill="#f0bf56" opacity=".85"/>`; }).join('');
  const stars = [[130, 48], [150, 34], [172, 60], [194, 74], [128, 92], [146, 70], [188, 30]].map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i % 3 ? 0.8 : 1.1}" fill="#fff" opacity=".8"/>`).join('');
  const scallops = Array.from({ length: 8 }, (_, i) => `Q${300 - i * 40} 27 ${280 - i * 40} 13`).join('');
  return `<svg viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" role="img" aria-label="A masked courtier points at a smirking Chancellor while a Duchess whispers behind her fan"><defs>` +
    lg('cwc-wall', [[0, '#170d33'], [0.55, '#2a1038'], [1, '#3e0f24']]) +
    lg('cwc-win', [[0, '#4d68c0'], [0.6, '#1f2c6a'], [1, '#101739']]) +
    lg('cwc-curt', [[0, '#3a0610'], [0.3, '#8f1a2e'], [0.55, '#4e0b18'], [0.8, '#a2223a'], [1, '#3a0610']], 1, 0) +
    lg('cwc-val', [[0, '#a3223a'], [1, '#560b1a']]) +
    lg('cwc-gold', [[0, '#fff2c0'], [0.45, '#efbe52'], [1, '#a8741d']], 1, 1) +
    lg('cwc-wax', [[0, '#d8c6a2'], [0.4, '#fff8e8'], [1, '#b49a72']], 1, 0) +
    lg('cwc-gown', [[0, '#ff5d72'], [1, '#9c1030']]) +
    lg('cwc-robe', [[0, '#a476ea'], [1, '#3a1a70']]) +
    lg('cwc-cloak', [[0, '#3c4260'], [1, '#0e1020']]) +
    lg('cwc-hair', [[0, '#ffffff'], [1, '#d4cbe8']]) +
    lg('cwc-fan', [[0, '#fff0f5'], [1, '#f59ab8']]) +
    lg('cwc-steel', [[0, '#8a93a2'], [0.45, '#f6f8fc'], [1, '#5d6574']], 1, 0) +
    lg('cwc-card', [[0, '#9d6ee6'], [1, '#3e1b78']]) +
    lg('cwc-back', [[0, '#8a1f34'], [1, '#3e0714']]) +
    lg('cwc-mask', [[0, '#fffdf6'], [1, '#d8cbb0']]) +
    rg('cwc-glow', [[0, '#ffd27a', 0.55], [0.3, '#ff9e40', 0.2], [0.75, '#ff7a20', 0]], 0.5, 0.62, 0.62) +
    rg('cwc-velvet', [[0, '#b3304b'], [0.55, '#62102a'], [1, '#2a0612']], 0.5, 0.1, 0.85) +
    rg('cwc-flame', [[0, '#fffbe6'], [0.35, '#ffd760'], [0.75, '#ff8a20'], [1, '#ff5a10', 0]], 0.5, 0.72, 0.7) +
    rg('cwc-halo', [[0, '#ffe7a0', 0.75], [1, '#ff9a30', 0]]) +
    rg('cwc-skin', [[0, '#fbe0c8'], [1, '#e0a983']], 0.4, 0.35, 0.75) +
    rg('cwc-skin2', [[0, '#f0c39c'], [1, '#c08158']], 0.4, 0.35, 0.75) +
    rg('cwc-vig', [[0.6, '#000', 0], [1, '#000', 0.55]], 0.5, 0.45, 0.75) +
    `<filter id="cwc-blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5"/></filter></defs>` +
    // the hall: night window with moon and stars, pilasters with sconces, crimson drapes
    `<rect width="320" height="200" fill="url(#cwc-wall)"/>` +
    `<path d="M118 120V60A42 40 0 0 1 202 60V120Z" fill="url(#cwc-win)"/>${stars}<circle cx="184" cy="46" r="7.5" fill="#f6f1dc"/><circle cx="187" cy="44" r="6.5" fill="#2a3a80" opacity=".45"/>` +
    `<path d="M160 20V120M118 78H202M139 26V120M181 26V120" stroke="#170d33" stroke-width="2.2" fill="none"/>` +
    `<path d="M118 120V60A42 40 0 0 1 202 60V120" fill="none" stroke="#e8c46a" stroke-width="2.4" opacity=".55"/>` +
    `<rect x="94" y="0" width="14" height="150" fill="#251238"/><rect x="212" y="0" width="14" height="150" fill="#251238"/>` +
    `<path d="M96 0V150M214 0V150" stroke="#ffffff" stroke-opacity=".06" stroke-width="2"/>` +
    sconce(101) + sconce(219) +
    `<path d="M0 0H42C35 46 48 96 26 150H0Z" fill="url(#cwc-curt)"/><path d="M320 0H278C285 46 272 96 294 150H320Z" fill="url(#cwc-curt)"/>` +
    `<path d="M0 92Q20 100 40 90M320 92Q300 100 280 90" fill="none" stroke="url(#cwc-gold)" stroke-width="2.2"/><circle cx="36" cy="92" r="3" fill="url(#cwc-gold)"/><circle cx="284" cy="92" r="3" fill="url(#cwc-gold)"/>` +
    `<path d="M0 0H320V13${scallops}Z" fill="url(#cwc-val)"/><path d="M320 13${scallops}" fill="none" stroke="url(#cwc-gold)" stroke-width="1.6"/>` +
    `<rect width="320" height="200" fill="url(#cwc-glow)"/>` +
    // the Duchess (left): powdered hair, a plume, eyes sliding toward the Chancellor, fan over her lips
    `<path d="M28 152C28 128 44 116 66 116C88 116 102 128 104 152Z" fill="url(#cwc-gown)"/>` +
    `<path d="M50 119Q66 133 82 119" fill="none" stroke="#ffe3ec" stroke-width="3" stroke-linecap="round"/>${pearls}` +
    `<path d="M70 58C74 44 84 38 93 35C87 44 81 52 75 60Z" fill="#ffc9d8"/><path d="M72 57C77 48 84 42 90 38" fill="none" stroke="#ff8fb0" stroke-width=".8"/>` +
    `<ellipse cx="66" cy="76" rx="18" ry="21" fill="url(#cwc-hair)"/><circle cx="66" cy="56" r="7" fill="url(#cwc-hair)"/>` +
    `<circle cx="50" cy="94" r="6" fill="#e6e0f2"/><circle cx="82" cy="94" r="6" fill="#e6e0f2"/>` +
    `<path d="M76 64l7-4v8zM76 64l-6-4v8z" fill="#ff4d6d"/><circle cx="76" cy="64" r="1.8" fill="#c8223e"/>` +
    `<rect x="61" y="104" width="10" height="14" rx="4" fill="#e9b892"/><circle cx="66" cy="95" r="14" fill="url(#cwc-skin)"/>` +
    `<path d="M52 90Q55 77 66 79Q77 77 80 90Q74 84 66 85Q58 84 52 90Z" fill="url(#cwc-hair)"/>` +
    `<path d="M59 88.4q3.5-2.4 7-.4M69 88q3.5-2 7 .4" fill="none" stroke="#7a5a4a" stroke-width="1.1" stroke-linecap="round"/>` +
    `<ellipse cx="63.3" cy="94.2" rx="1.7" ry="2.1" fill="#2a1c1a"/><ellipse cx="73.3" cy="94.2" rx="1.7" ry="2.1" fill="#2a1c1a"/>` +
    `<path d="M59.5 92.2q3.4-2.3 6.8 0M69.5 92.2q3.4-2.3 6.8 0" fill="none" stroke="#2a1c1a" stroke-width="1.2" stroke-linecap="round"/>` +
    `<circle cx="58" cy="99" r="2.8" fill="#ff7f8f" opacity=".38"/><circle cx="77.5" cy="97.5" r=".8" fill="#3a2220"/>` +
    `<path d="M88 129C84 123 79 119 73 117" fill="none" stroke="#c8223e" stroke-width="6.5" stroke-linecap="round"/>` +
    `<path d="M${fx} ${fy}L${ax} ${ay}A${fanR} ${fanR} 0 0 0 ${bx} ${by}Z" fill="url(#cwc-fan)"/><path d="${ribs}" stroke="#e0789a" stroke-width=".7" opacity=".75"/>` +
    `<path d="M${ax} ${ay}A${fanR} ${fanR} 0 0 0 ${bx} ${by}" fill="none" stroke="#fff" stroke-width="1.2" stroke-dasharray="2 1.4" opacity=".8"/><circle cx="${fx}" cy="${fy + 1}" r="3.6" fill="#e9b892"/>` +
    // her whisper drifts toward the Chancellor's ear
    `<g fill="none" stroke="#ffe7a8" stroke-width="1.5" stroke-linecap="round"><path d="M91 102q3-4 6 0t6 0" opacity=".9"/><path d="M107 97q3-4 6 0t6 0" opacity=".7"/><path d="M123 92q3-4 6 0t6 0" opacity=".5"/></g>` +
    `<circle cx="102" cy="94" r="1" fill="#ffe7a8" opacity=".7"/><circle cx="118" cy="88" r=".9" fill="#ffe7a8" opacity=".5"/>` +
    // the Chancellor (centre): ermine collar, crown, sly lidded eyes, flashing his card
    `<path d="M124 152C124 128 140 116 160 116C180 116 196 128 196 152Z" fill="url(#cwc-robe)"/><path d="M160 130V152" stroke="#efbe52" stroke-width="1.6" opacity=".6"/>` +
    `<rect x="154" y="104" width="12" height="14" rx="4" fill="#c98a5e"/>` +
    `<path d="M137 121Q160 137 183 121Q178 114 160 116Q142 114 137 121Z" fill="#f6f2ea"/><path d="M149 122.5v3M160 126v3M171 122.5v3" stroke="#1d1a24" stroke-width="1.6" stroke-linecap="round"/>` +
    `<ellipse cx="145.5" cy="97" rx="2.6" ry="4" fill="#d9a074"/><ellipse cx="174.5" cy="97" rx="2.6" ry="4" fill="#d9a074"/><circle cx="160" cy="95" r="15" fill="url(#cwc-skin2)"/>` +
    `<path d="M146 81L147 70L153 76L160 66L167 76L173 70L174 81Z" fill="url(#cwc-gold)"/><rect x="146" y="80" width="28" height="6" rx="2" fill="url(#cwc-gold)"/>` +
    `<circle cx="160" cy="83" r="2" fill="#e8304a"/><circle cx="151" cy="83" r="1.4" fill="#4cb8ff"/><circle cx="169" cy="83" r="1.4" fill="#4cb8ff"/>` +
    `<path d="M150 89.5q4-2.6 8-.6M163 88q4-3 8 .4" fill="none" stroke="#3b2418" stroke-width="1.6" stroke-linecap="round"/>` +
    `<circle cx="155.6" cy="94" r="1.6" fill="#2a1c1a"/><circle cx="167.6" cy="94" r="1.6" fill="#2a1c1a"/><path d="M151.5 92.6h7M163.5 92.6h7" stroke="#3b2418" stroke-width="1.7" stroke-linecap="round"/>` +
    `<circle cx="150" cy="99.5" r="3" fill="#ff7f8f" opacity=".3"/><circle cx="170" cy="99.5" r="3" fill="#ff7f8f" opacity=".3"/>` +
    `<path d="M150 102q5-3.5 10-.5q5-3 10 .5q-5 3.5-10 1.2q-5 2.3-10-1.2z" fill="#3b2418"/><path d="M156 106.4q5 2.6 9-1.4" fill="none" stroke="#7a2e35" stroke-width="1.5" stroke-linecap="round"/>` +
    `<path d="M155 108.5Q160 120 165 108.5Q160 111 155 108.5Z" fill="#3b2418"/>` +
    `<path d="M182 124C192 116 196 102 197 88L207 89C207 104 200 120 190 132Z" fill="url(#cwc-robe)"/><path d="M196.5 90L207.5 91" stroke="#f6f2ea" stroke-width="4" stroke-linecap="round"/>` +
    `<circle cx="204" cy="64" r="27" fill="url(#cwc-halo)"/>` +
    `<g transform="translate(204 64) rotate(10)"><rect x="-12" y="-17" width="24" height="34" rx="2.6" fill="url(#cwc-card)" stroke="url(#cwc-gold)" stroke-width="1.4"/>` +
    `<path d="M-8 9V-5A8 7 0 0 1 8-5V9Z" fill="#d7bcff" opacity=".3"/><path d="M-6.5 3L-7-7L-3-3.5L0-9.5L3-3.5L7-7L6.5 3Z" fill="url(#cwc-gold)"/>` +
    `<rect x="-10" y="9.5" width="20" height="5" rx="1" fill="#3a1a6e" stroke="url(#cwc-gold)" stroke-width=".6"/></g>` +
    `<circle cx="201.5" cy="85" r="5.6" fill="#d9a074"/><path d="M197.5 82.5q2-3 5.5-2.4" fill="none" stroke="#b07a52" stroke-width="1.2" stroke-linecap="round"/>` +
    spark(223, 48, 4.5) + spark(187, 44, 3) + spark(225, 78, 2.6) +
    // the Shadow (right): hooded, masked, eyes aglow, pointing at the card, a dagger hidden behind him
    `<path d="M226 152C226 126 242 114 264 114C286 114 300 128 302 152Z" fill="url(#cwc-cloak)"/>` +
    `<g transform="translate(290 138) rotate(-10)"><path d="M0-30L2.8-24V-2H-2.8V-24Z" fill="url(#cwc-steel)" stroke="#3a3e46" stroke-width=".5"/><rect x="-7" y="-2.5" width="14" height="3" rx="1.4" fill="url(#cwc-gold)"/><rect x="-1.6" y=".5" width="3.2" height="7" fill="#5a1220"/></g>` +
    `<circle cx="290" cy="144" r="4.4" fill="#d6b49a"/>` + spark(286, 108, 3, '#ffffff') +
    `<path d="M246 106C243 82 252 70 264 70C276 70 285 82 282 106C280 117 272 121 264 121C256 121 248 117 246 106Z" fill="#2b2f47"/>` +
    `<path d="M249.5 100C248.5 84 255 75 264 75" fill="none" stroke="#7a80a6" stroke-width="1" opacity=".6"/>` +
    `<ellipse cx="264" cy="99" rx="12" ry="14" fill="#0d0e1a"/>` +
    `<path d="M252 95C256 89 262 90 264 93C266 90 272 89 276 95C274 101 267 102 264 99C261 102 254 101 252 95Z" fill="url(#cwc-mask)" stroke="#e8c46a" stroke-width=".8"/>` +
    `<path d="M254.8 95.4q3.7-3.2 7.4 0q-3.7 2.2-7.4 0zM265.8 95.4q3.7-3.2 7.4 0q-3.7 2.2-7.4 0z" fill="#0d0e1a"/>` +
    glow(257.6, 95, 2.6, '#ffb840', 0.85) + glow(268.6, 95, 2.6, '#ffb840', 0.85) +
    `<circle cx="257.6" cy="95" r="1.15" fill="#ffe7a8"/><circle cx="268.6" cy="95" r="1.15" fill="#ffe7a8"/>` +
    `<path d="M259 108.5q5 3 10 0" fill="none" stroke="#c9a0a0" stroke-width="1.2" stroke-linecap="round" opacity=".7"/>` +
    `<path d="M244 124C236 120 231 112 229 104L221 107C223 117 230 127 240 134Z" fill="url(#cwc-cloak)"/>` +
    `<circle cx="225" cy="101" r="4.6" fill="#d6b49a"/><path d="M223 98.5L216.5 92" stroke="#d6b49a" stroke-width="3.2" stroke-linecap="round"/>` +
    `<circle cx="285" cy="70" r="8" fill="#ff4d5e" stroke="#fff" stroke-width="1.2"/><rect x="283.9" y="64.6" width="2.2" height="6.6" rx="1.1" fill="#fff"/><circle cx="285" cy="74.4" r="1.3" fill="#fff"/>` +
    // the velvet table with gold fringe, cards, coins and a candle in front
    `<path d="M0 148Q160 138 320 148V200H0Z" fill="url(#cwc-velvet)"/>${fringe}<path d="M0 148Q160 138 320 148" fill="none" stroke="url(#cwc-gold)" stroke-width="2.4"/>` +
    `<g transform="translate(102 174) rotate(-18)"><rect x="-13" y="-18" width="26" height="36" rx="2.6" fill="url(#cwc-back)" stroke="url(#cwc-gold)" stroke-width="1.2"/><circle r="5" fill="#c8223e" stroke="#5a0610"/></g>` +
    `<g transform="translate(126 178) rotate(-4)"><rect x="-13" y="-18" width="26" height="36" rx="2.6" fill="url(#cwc-back)" stroke="url(#cwc-gold)" stroke-width="1.2"/><circle r="5" fill="#c8223e" stroke="#5a0610"/></g>` +
    `<g transform="translate(214 176) rotate(14)"><rect x="-13" y="-18" width="26" height="36" rx="2.6" fill="#b81e3a" stroke="url(#cwc-gold)" stroke-width="1.2"/><path d="M0 6L-9-3A9 9 0 0 1 9-3Z" fill="#ffd1dc"/><path d="M0 6V12" stroke="url(#cwc-gold)" stroke-width="1.6"/></g>` +
    stack(244, 184, 4) + stack(260, 189, 2) + coin(84, 190) +
    `<ellipse cx="160" cy="183" rx="21" ry="5" fill="#000" opacity=".35"/><path d="M142 180C142 173 178 173 178 180C178 185 142 185 142 180Z" fill="url(#cwc-gold)"/>` +
    `<circle cx="160" cy="138" r="30" fill="url(#cwc-halo)"/>` +
    `<rect x="154" y="150" width="12" height="28" fill="url(#cwc-wax)"/><path d="M154 152C152 160 156 163 155 170H158V152Z" fill="#fff3dc"/><ellipse cx="160" cy="150" rx="6" ry="2" fill="#fff8ea"/>` +
    `<path d="M160 150V145" stroke="#2a1a0a" stroke-width="1.2"/><path d="M160 123C167 133 168 141 160 148C152 141 153 133 160 123Z" fill="url(#cwc-flame)"/><path d="M160 134C162.4 138 162.4 142 160 145C157.6 142 157.6 138 160 134Z" fill="#fffef0"/>` +
    `<rect width="320" height="200" fill="url(#cwc-vig)"/></svg>`;
}
const COVER = coverSVG();

/* ============================================================
   CSS
   ============================================================ */
const DAMASK = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='72' height='72'%3E%3Cg fill='none' stroke='%23f2c14e' stroke-width='1.1'%3E%3Cpath d='M36 6C44 16 44 24 36 31C28 24 28 16 36 6Z'/%3E%3Cpath d='M36 31C48 31 54 41 50 50C44 46 40 40 36 31ZM36 31C24 31 18 41 22 50C28 46 32 40 36 31Z'/%3E%3Ccircle cx='36' cy='57' r='3'/%3E%3Cpath d='M0 36C6 32 10 32 14 36C10 40 6 40 0 36ZM58 36C62 32 66 32 72 36C66 40 62 40 58 36Z'/%3E%3C/g%3E%3C/svg%3E\")";
const CROWN_URI = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cg fill='%23825010'%3E%3Cpath d='M3 18.5 4.6 7.5l4.6 4.6L12 4l2.8 8.1 4.6-4.6L21 18.5Z'/%3E%3Crect x='3.5' y='19.2' width='17' height='2.6'/%3E%3C/g%3E%3C/svg%3E\")";
const INK = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='i'%3E%3CfeTurbulence baseFrequency='.8' numOctaves='2' seed='3'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -2.4 2.05'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23i)'/%3E%3C/svg%3E\")";

const STYLE = `
.bluff { --bl-gold: #f2c14e; --glass: linear-gradient(180deg, rgba(26,20,56,.74), rgba(12,9,30,.64)); }
.bluff .bluff-board { min-width: 0; }
/* A candlelit court: crimson velvet with a faint damask, warm light pooling around the stage. */
.bluff-table.felt {
  background:
    var(--grain),
    radial-gradient(58% 44% at 50% 46%, rgba(255,176,110,.2), transparent 72%),
    radial-gradient(125% 95% at 50% 38%, #8c1e35 0%, #60102a 45%, #2e0717 100%);
  background-blend-mode: soft-light, normal, normal;
  border: 1px solid rgba(255,196,160,.2);
  box-shadow: inset 0 1px 0 rgba(255,225,200,.12), inset 0 0 80px rgba(14,0,10,.55), var(--shadow-lg);
  padding: 18px 16px 14px;
}
.bluff-table::before { content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; opacity: .07; background-image: ${DAMASK}; background-size: 72px 72px; }
.bluff-table::after { content: ''; position: absolute; inset: 7px; border-radius: 17px; pointer-events: none; border: 1px solid rgba(255,214,170,.14); }
.bluff-table > * { position: relative; z-index: 1; }
/* candlelight: three warm pools that flicker slowly (opacity only) */
.bluff-table > .bluff-glow { position: absolute; z-index: 0; inset: 0; border-radius: inherit; pointer-events: none;
  background:
    radial-gradient(40% 28% at 50% 44%, rgba(255,186,110,.2), transparent 72%),
    radial-gradient(34% 26% at 6% 0%, rgba(255,196,120,.16), transparent 72%),
    radial-gradient(34% 26% at 94% 0%, rgba(255,196,120,.16), transparent 72%);
  animation: bluff-candle 5s ease-in-out infinite alternate; }
@keyframes bluff-candle { 0% { opacity: .68; } 35% { opacity: 1; } 60% { opacity: .82; } 100% { opacity: .96; } }
.bluff-refbtn { position: absolute !important; z-index: 4 !important; top: 10px; right: 10px; min-height: 40px; padding: 4px 13px 4px 11px; gap: 6px; border-radius: 999px;
  font-family: var(--font-display); font-weight: 600; font-size: .84rem; color: #fff; background: rgba(14,10,34,.58); border-color: rgba(255,255,255,.2); box-shadow: 0 4px 12px rgba(0,0,0,.35); }
.bluff-refbtn:hover:not(:disabled) { background: rgba(14,10,34,.85); }
.bluff-refbtn .ic { width: 18px; height: 18px; color: var(--gold); }
.bluff-ic { display: block; }

/* ---- cards ---- */
.bluff-card { position: relative; width: var(--cw, 60px); aspect-ratio: 5 / 7; flex: none; perspective: 900px; transition: translate .25s var(--ease), scale .25s var(--ease); }
.bluff-card-in { position: absolute; inset: 0; transform-style: preserve-3d; }
.bluff-card.down .bluff-card-in { transform: rotateY(180deg); }
.bluff-face { position: absolute; inset: 0; backface-visibility: hidden; -webkit-backface-visibility: hidden; border-radius: 7% / 5%; overflow: hidden;
  box-shadow: 0 calc(var(--cw, 60px) * .05) calc(var(--cw, 60px) * .12) rgba(0,0,0,.55), 0 1px 2px rgba(0,0,0,.6); transition: box-shadow .25s; }
.bluff-face.back { transform: rotateY(180deg); }
.bluff-face > svg { width: 100%; height: 100%; display: block; }
.bluff-card.flipin .bluff-card-in { animation: bluff-flip .85s var(--fd, 0ms) cubic-bezier(.3,.7,.3,1.1) both; }
@keyframes bluff-flip { 0% { transform: rotateY(180deg) scale(1); } 45% { transform: rotateY(95deg) scale(1.16); } 100% { transform: rotateY(0) scale(1); } }
.bluff-lost { position: absolute; inset: 0; pointer-events: none; overflow: hidden; background: radial-gradient(ellipse at 50% 42%, rgba(30,0,4,0), rgba(14,0,2,.42)); }
.bluff-lost svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.bluff-lost .ck path { fill: none; stroke-linejoin: round; stroke-linecap: round; }
.bluff-lost-x { position: absolute; left: -26%; top: 9%; width: 84%; text-align: center; transform: rotate(-38deg); font: 700 calc(var(--cw, 60px) * .1)/1.5 var(--font-display); letter-spacing: .16em; color: #fff0f2;
  background: linear-gradient(180deg, #ff5a70, #b3163a); border-top: 1px solid #ffb3c0; border-bottom: 1px solid #4a0618; box-shadow: 0 2px 6px rgba(0,0,0,.6); text-shadow: 0 1px 1px rgba(0,0,0,.6); white-space: nowrap; }
.bluff-card.mini .bluff-lost-x { display: none; }
.bluff-card.lost .bluff-face.front > svg { filter: grayscale(.5) brightness(.76) sepia(.25); }
.bluff-card.lostnew .bluff-face.front > svg { animation: bluff-dim .7s var(--cd, 0ms) both; }
.bluff-card.lostnew .bluff-lost { animation: bluff-fadein .5s var(--cd, 0ms) both; }
.bluff-card.lostnew .bluff-lost .ck path { stroke-dasharray: 420; animation: bluff-crack .55s var(--cd, 0ms) ease-out both; }
.bluff-card.lostnew .bluff-lost-x { animation: bluff-lostx .45s calc(var(--cd, 0ms) + 350ms) cubic-bezier(.3,1.4,.5,1) both; }
@keyframes bluff-dim { from { filter: none; } to { filter: grayscale(.5) brightness(.76) sepia(.25); } }
@keyframes bluff-fadein { from { opacity: 0; } }
@keyframes bluff-crack { from { stroke-dashoffset: 420; } to { stroke-dashoffset: 0; } }
@keyframes bluff-lostx { from { opacity: 0; transform: translate(-40%, -40%) rotate(-38deg); } }
.bluff-banished { position: absolute; left: 50%; top: 46%; transform: translate(-50%, -50%) rotate(-8deg); z-index: 3; font: 700 11px var(--font-display); letter-spacing: .14em; text-transform: uppercase; white-space: nowrap;
  color: #ffe2e7; padding: 3px 10px; border-radius: 8px; background: linear-gradient(180deg, #7a1230, #320616); border: 1px solid rgba(255,107,129,.75); box-shadow: 0 4px 10px rgba(0,0,0,.6); pointer-events: none; }
.bluff-banished.new { animation: bluff-badge .5s var(--bd, 0ms) cubic-bezier(.3,1.5,.5,1) both; }
@keyframes bluff-badge { from { opacity: 0; transform: translate(-50%, -50%) rotate(-8deg) scale(2.4); } }
/* the last courtier standing: a gold rim and a slow breathing halo */
.bluff-seat.win, .bluff-mine.win { border-color: var(--gold); box-shadow: 0 0 0 2px var(--gold), 0 0 28px rgba(255,207,92,.45); }
.bluff-seat.win::before, .bluff-mine.win::before { content: ''; position: absolute; inset: -3px; border-radius: inherit; pointer-events: none; box-shadow: 0 0 40px 8px rgba(255,214,110,.5); animation: bluff-breathe 2.6s ease-in-out infinite; }
@keyframes bluff-breathe { 50% { opacity: .3; } }
.bluff-ribbon { position: absolute; left: -6%; right: -6%; bottom: 10%; z-index: 3; text-align: center; font: 700 calc(var(--cw) * .1) var(--font-display); letter-spacing: .1em; padding: 2px 0;
  color: #3a2405; background: linear-gradient(180deg, #fff0b8, #ffcf5c 60%, #e0a23a); box-shadow: 0 3px 8px rgba(0,0,0,.5); border-top: 1px solid #fff6d0; border-bottom: 1px solid #9a6a14; pointer-events: none; }
.bluff-ribbon.red { color: #fff0f2; background: linear-gradient(180deg, #ff6b81, #d0304a 60%, #8f1028); border-top-color: #ffb3c0; border-bottom-color: #4a0618; text-shadow: 0 1px 1px rgba(0,0,0,.6); }
.bluff-newtag { position: absolute; top: -8px; left: 50%; transform: translateX(-50%); z-index: 3; font: 800 10px var(--font-body); letter-spacing: .08em; text-transform: uppercase; padding: 1px 8px; border-radius: 999px; background: var(--good); color: #05271a; box-shadow: 0 2px 5px rgba(0,0,0,.5); white-space: nowrap; }
/* cards you can pick: a warm rim; the card you choose lifts off the table; pressing dips it */
.bluff-card.pick { cursor: pointer; }
.bluff-card.pick .bluff-face { box-shadow: 0 0 0 2px rgba(255,224,138,.8), 0 6px 14px rgba(0,0,0,.5); }
.bluff-card.pick:active { scale: .97; }
.bluff-card.pick.glow::after { content: ''; position: absolute; inset: -3px; z-index: 2; border-radius: 9% / 6.5%; pointer-events: none;
  box-shadow: 0 0 0 2px rgba(255,170,140,.9), 0 0 22px 4px rgba(255,120,90,.6); animation: bluff-breathe 2.6s ease-in-out infinite; }
.bluff-card.chosen, .bluff-card.doomed { translate: 0 -10px; scale: 1.04; }
.bluff-card.chosen:active, .bluff-card.doomed:active { scale: 1.01; }
.bluff-card.chosen .bluff-face { box-shadow: 0 0 0 3px #ffe08a, 0 0 22px rgba(255,210,110,.8), 0 16px 24px rgba(0,0,0,.55); }
.bluff-card.doomed .bluff-face { box-shadow: 0 0 0 3px #ff8a7a, 0 0 22px rgba(255,90,70,.8), 0 16px 24px rgba(0,0,0,.55); }
.bluff-card.doomed::after { display: none; }
.bluff-card.tapped.chosen, .bluff-card.tapped.doomed { animation: bluff-lift .32s var(--spring); }
.bluff-card.tapped.dropped { animation: bluff-drop .28s var(--ease); }
@keyframes bluff-lift { from { translate: 0 0; scale: .97; } }
@keyframes bluff-drop { from { translate: 0 -10px; scale: 1.04; } }
.bluff-card.dropped .bluff-face > svg { filter: saturate(.5) brightness(.58); }

/* ---- seats: glass plaques with the player's colour along the top ---- */
.bluff-opps { display: flex; flex-wrap: wrap; justify-content: center; align-items: flex-start; gap: 12px; padding: 12px 0 0; --scw: 50px; }
.bluff-seat { position: relative; width: 156px; padding: 13px 8px 8px; border-radius: 16px; display: flex; flex-direction: column; align-items: center; gap: 7px;
  background: linear-gradient(var(--pc), var(--pc)) top / 100% 3px no-repeat, var(--glass); border: 1px solid rgba(255,255,255,.1);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.06), 0 8px 18px rgba(0,0,0,.38); transition: box-shadow .3s, opacity .4s, filter .4s, transform .15s var(--ease); }
.bluff-seat.turn { border-color: rgba(255,207,92,.75); box-shadow: 0 0 0 2px var(--gold), 0 0 24px rgba(255,207,92,.35), 0 8px 18px rgba(0,0,0,.38); }
.bluff-seat.out { background: rgba(10,8,24,.5); border-color: rgba(255,255,255,.06); box-shadow: none; }
.bluff-seat.out .bluff-seat-head, .bluff-seat.out .bluff-seat-foot { opacity: .55; }
.bluff-seat.out .bluff-av .portrait { filter: grayscale(.85) brightness(.75); }
/* A rival you can target: a soft coral rim plus a slow breathing glow (opacity only). */
.bluff-seat.pickable { cursor: pointer; border-color: rgba(255,190,160,.9); box-shadow: 0 0 0 2px #ff9f7f, 0 8px 18px rgba(0,0,0,.38); }
.bluff-seat.pickable::before { content: ''; position: absolute; inset: -2px; border-radius: inherit; pointer-events: none; box-shadow: 0 0 22px 5px rgba(255,130,95,.6); animation: bluff-breathe 2.6s ease-in-out infinite; }
.bluff-seat.pickable:active { transform: scale(.97); }
.bluff-seat.pickable::after { content: 'Tap to target'; position: absolute; top: -11px; left: 50%; transform: translateX(-50%); font: 800 10px var(--font-body); letter-spacing: .06em; text-transform: uppercase; white-space: nowrap; padding: 2px 9px; border-radius: 999px;
  background: linear-gradient(135deg, #ff9a76, #e8486a); color: #fff; box-shadow: 0 2px 6px rgba(0,0,0,.5); }
/* coins just landed in this purse: one warm flash */
.bluff-seat.gain, .bluff-mine.gain { animation: bluff-gain 1.2s ease-out .75s; }
@keyframes bluff-gain { 20% { box-shadow: 0 0 0 2px #fff3b0, 0 0 30px 6px rgba(255,214,90,.6); } }
.bluff-seat.gain .bluff-ccount, .bluff-mine.gain .bluff-ccount { display: inline-block; animation: bluff-pop .5s var(--spring) .85s; }
@keyframes bluff-pop { 40% { transform: scale(1.4); } }
.bluff-seat-head { display: flex; align-items: center; gap: 7px; width: 100%; min-width: 0; }
.bluff-av { position: relative; width: 30px; height: 30px; border-radius: 50%; flex: none; box-shadow: 0 0 0 2px var(--pc, #fff), 0 2px 6px rgba(0,0,0,.45); }
.bluff-av .portrait { width: 100%; height: 100%; display: block; border-radius: 50%; }
.bluff-seat-name { font: 600 13.5px var(--font-display); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text); min-width: 0; }
.bluff-seat-cards { position: relative; display: flex; gap: 6px; justify-content: center; --cw: var(--scw); min-height: calc(var(--scw) * 1.4); }
.bluff-seat-cards .bluff-card.extra { margin-left: -4px; }
.bluff-seat-foot { display: flex; align-items: flex-end; justify-content: space-between; width: 100%; gap: 4px; min-height: 26px; }
/* response badges: allowed, deciding, losing a card, exchanging, winner */
.bluff-flag { position: absolute; top: -11px; right: -9px; z-index: 3; min-width: 28px; height: 28px; padding: 0 6px; border-radius: 14px; display: inline-flex; align-items: center; justify-content: center; gap: 3px;
  font: 700 15px/1 var(--font-display); border: 2px solid #1a1236; box-shadow: 0 3px 8px rgba(0,0,0,.5); }
.bluff-flag .ic { width: 15px; height: 15px; stroke-width: 2.6; }
.bluff-flag.ok { background: var(--good); color: #05271a; }
.bluff-flag.wait { background: #2b3772; color: #fff; }
.bluff-flag.wait i { width: 4px; height: 4px; border-radius: 50%; background: #dfe4ff; animation: bluff-dot 1.2s ease-in-out infinite; }
.bluff-flag.wait i:nth-child(2) { animation-delay: .15s; }
.bluff-flag.wait i:nth-child(3) { animation-delay: .3s; }
@keyframes bluff-dot { 0%, 60%, 100% { transform: translateY(0); opacity: .55; } 30% { transform: translateY(-3px); opacity: 1; } }
.bluff-flag.swap .ic { animation: bluff-spin 2.4s linear infinite; }
.bluff-flag.bad { background: var(--bad); color: #fff; }
.bluff-flag.bad b { display: inline-block; animation: bluff-bob 1.1s ease-in-out infinite; }
.bluff-flag.win { background: linear-gradient(135deg, #fff0b8, var(--gold)); color: #3b2a00; }
.bluff-flag.bluff-flag-inline { position: static; margin-left: 2px; }
@keyframes bluff-bob { 50% { transform: translateY(-2px) scale(1.15); } }
.bluff-says { position: absolute; top: -13px; left: 50%; transform: translateX(-50%); z-index: 2; display: flex; align-items: center; gap: 4px; padding: 2px 10px 2px 3px; border-radius: 20px; white-space: nowrap;
  font: 600 11.5px var(--font-display); color: #fff; text-shadow: 0 1px 1px rgba(0,0,0,.55);
  background: linear-gradient(180deg, rgba(255,255,255,.24), rgba(0,0,0,.16)), var(--rc); border: 1.5px solid rgba(255,255,255,.5); box-shadow: 0 4px 10px rgba(0,0,0,.45); animation: bluff-says .4s cubic-bezier(.3,1.5,.5,1); }
.bluff-says .bluff-ic { width: 16px; height: 16px; padding: 2px; border-radius: 50%; background: rgba(0,0,0,.25); }
.bluff-says.blk { border-color: #fff; box-shadow: 0 0 0 2px rgba(255,255,255,.22), 0 4px 10px rgba(0,0,0,.45); }
@keyframes bluff-says { from { transform: translateX(-50%) scale(.4); opacity: 0; } }

/* ---- coins ---- */
.bluff-coin { display: block; width: 24px; height: 24px; border-radius: 50%; position: relative;
  background: radial-gradient(circle at 36% 30%, #fff8d2 0 9%, #f8d872 24%, #dca434 58%, #a9731a 82%, #7d5210 100%);
  box-shadow: inset 0 0 0 1.5px #7d5210, inset 0 0 0 3px #f6d374, inset 0 0 0 4px rgba(125,82,16,.55), 0 2px 4px rgba(0,0,0,.55); }
.bluff-coin::after { content: ''; position: absolute; inset: 27%; background: ${CROWN_URI} center / contain no-repeat; opacity: .85; filter: drop-shadow(0 1px 0 rgba(255,240,190,.75)); }
.bluff-purse { display: flex; align-items: flex-end; gap: 5px; --cs: 18px; --co: 3px; }
.bluff-stacks { display: flex; gap: 2px; align-items: flex-end; }
.bluff-stack { position: relative; width: var(--cs); height: calc(var(--cs) * .72 + 4 * var(--co) + 3px); }
.bluff-stack.empty { width: var(--cs); opacity: .35; }
.bluff-stack.empty::before { content: ''; position: absolute; left: 0; bottom: 0; width: var(--cs); height: calc(var(--cs) * .72); border-radius: 50%; border: 1.5px dashed rgba(255,214,140,.7); }
.bluff-sc { position: absolute; left: 0; width: var(--cs); height: calc(var(--cs) * .72); border-radius: 50%;
  background: radial-gradient(ellipse at 40% 35%, #fff6c8 0 10%, #f5d36a 30%, #d39b2c 70%, #a8741a 100%);
  box-shadow: inset 0 0 0 1px #8a5a12, inset 0 0 0 2.5px rgba(255,240,190,.45), 0 1.5px 0 #b07818, 0 3px 0 #5a3a08, 0 4px 3px rgba(0,0,0,.45); }
.bluff-sc:nth-child(1) { bottom: 0; } .bluff-sc:nth-child(2) { bottom: var(--co); } .bluff-sc:nth-child(3) { bottom: calc(var(--co) * 2); }
.bluff-sc:nth-child(4) { bottom: calc(var(--co) * 3); } .bluff-sc:nth-child(5) { bottom: calc(var(--co) * 4); }
.bluff-ccount { font: 700 16px/1 var(--font-display); color: var(--gold); text-shadow: 0 1px 0 rgba(0,0,0,.7), 0 0 8px rgba(255,207,92,.45); padding-bottom: 1px; }
.bluff-purse.big { --cs: 26px; --co: 4px; gap: 8px; }
.bluff-purse.big .bluff-ccount { font-size: 24px; }
.bluff-claims { display: flex; gap: 3px; align-items: center; }
.bluff-medal { width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; color: #fff; flex: none;
  background: radial-gradient(circle at 35% 28%, rgba(255,255,255,.42), transparent 52%), var(--rc); box-shadow: inset 0 0 0 1px rgba(255,255,255,.35), 0 2px 4px rgba(0,0,0,.45); }
.bluff-medal .bluff-ic { width: 13px; height: 13px; }

/* ---- centre ---- */
.bluff-center { display: grid; grid-template-columns: 120px minmax(0, 1fr) 120px; align-items: center; gap: 14px; margin: 18px 0 12px; }
.bluff-treasury, .bluff-deck { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.bluff-tray { position: relative; width: 108px; height: 70px; border-radius: 50%;
  background: radial-gradient(ellipse at 50% 38%, #4a0c1e, #1a040c 72%);
  box-shadow: inset 0 8px 16px rgba(0,0,0,.85), inset 0 -2px 6px rgba(255,180,120,.14), 0 0 0 2px rgba(255,214,150,.5), 0 0 0 5px rgba(14,8,28,.5), 0 10px 18px rgba(0,0,0,.55); }
.bluff-tray .bluff-coin { position: absolute; width: 24px; height: 24px; }
.bluff-lbl { font: 600 10.5px var(--font-display); letter-spacing: .12em; text-transform: uppercase; color: rgba(255,236,226,.75); text-align: center; text-shadow: 0 1px 2px rgba(0,0,0,.8); }
.bluff-pile { position: relative; width: var(--pw); height: calc(var(--pw) * 1.4 + 10px); --pw: 56px; }
.bluff-pile .bluff-card { position: absolute; left: 0; --cw: var(--pw); }
.bluff-stage { display: flex; flex-direction: column; align-items: center; gap: 9px; min-height: 112px; justify-content: center; min-width: 0; }
.bluff-plate { display: flex; align-items: center; gap: 10px; padding: 8px 14px 8px 8px; border-radius: 16px; max-width: 100%; flex-wrap: wrap; justify-content: center;
  background: var(--glass); border: 1px solid rgba(255,255,255,.12); box-shadow: inset 0 1px 0 rgba(255,255,255,.06), 0 10px 22px rgba(0,0,0,.42); }
.bluff-plate .bluff-card { --cw: 44px; }
.bluff-pl-row { display: flex; align-items: center; gap: 9px; min-width: 0; }
.bluff-pl-txt { min-width: 0; }
.bluff-pl-txt b { display: block; font: 600 15px/1.2 var(--font-display); color: var(--text); }
.bluff-pl-txt b em { font-style: normal; }
.bluff-pl-txt small { display: block; color: var(--muted); font-size: 12px; font-weight: 700; line-height: 1.3; }
.bluff-pl-ic { width: 44px; height: 44px; border-radius: 14px; display: grid; place-items: center; flex: none; color: #fff;
  background: radial-gradient(circle at 30% 22%, rgba(255,255,255,.42), transparent 55%), var(--rc, #e2a232); box-shadow: inset 0 0 0 1.5px rgba(255,255,255,.28), 0 4px 10px rgba(0,0,0,.45); }
.bluff-pl-ic .bluff-ic { width: 26px; height: 26px; filter: drop-shadow(0 1px 1px rgba(0,0,0,.45)); }
.bluff-vs { font: 700 12px var(--font-display); letter-spacing: .06em; color: #ffd0d8; padding: 2px 9px; border-radius: 999px; background: rgba(255,107,129,.2); border: 1px solid rgba(255,107,129,.5); }
.bluff-candle { width: 38px; height: 54px; flex: none; }
.bluff-candle .fl { transform-origin: 50% 90%; animation: bluff-flicker 1.6s ease-in-out infinite; }
@keyframes bluff-flicker { 0%,100% { transform: scale(1) rotate(0); } 30% { transform: scale(1.06,.94) rotate(-3deg); } 60% { transform: scale(.95,1.07) rotate(2deg); } }
.bluff-track { display: flex; flex-wrap: wrap; gap: 5px; justify-content: center; align-items: center; }
.bluff-track-lbl { font: 800 10px var(--font-body); letter-spacing: .12em; text-transform: uppercase; color: rgba(255,236,226,.7); margin-right: 2px; }
.bluff-tk { display: inline-flex; align-items: center; gap: 4px; padding: 2px 9px 2px 3px; border-radius: 20px; font-size: 12px; font-weight: 800; background: rgba(12,9,30,.55); border: 1px solid rgba(255,255,255,.12); color: var(--text); transition: background .3s; }
.bluff-tk i { width: 17px; height: 17px; border-radius: 50%; display: grid; place-items: center; font-style: normal; box-sizing: border-box; }
.bluff-tk i .ic { width: 11px; height: 11px; stroke-width: 3; }
.bluff-tkface { width: 18px; height: 18px; flex: none; border-radius: 50%; box-shadow: 0 0 0 1.5px var(--pc, #fff); }
.bluff-tkface .portrait { width: 100%; height: 100%; display: block; border-radius: 50%; }
.bluff-tk.ok { background: rgba(62,224,161,.16); border-color: rgba(62,224,161,.5); }
.bluff-tk.ok i { background: var(--good); color: #05271a; animation: bluff-tick .35s cubic-bezier(.3,1.6,.5,1); }
.bluff-tk.wait i { border: 2px solid rgba(255,207,92,.8); border-top-color: transparent; animation: bluff-spin 1s linear infinite; }
@keyframes bluff-spin { to { transform: rotate(360deg); } }
@keyframes bluff-tick { from { transform: scale(0); } }

/* ---- my seat ---- */
.bluff-mine { display: flex; align-items: center; justify-content: center; gap: 22px; padding: 16px 16px 12px; border-radius: 20px; margin-top: 6px;
  background: linear-gradient(var(--pc, #7c6cff), var(--pc, #7c6cff)) top / 100% 3px no-repeat, linear-gradient(180deg, rgba(26,20,56,.58), rgba(12,9,30,.52));
  border: 1px solid rgba(255,255,255,.1); transition: box-shadow .3s; }
.bluff-mine.turn { border-color: rgba(255,207,92,.75); box-shadow: 0 0 0 2px var(--gold), 0 0 26px rgba(255,207,92,.3); }
.bluff-mine.out .bluff-mine-info { opacity: .6; }
.bluff-mine-info { display: flex; flex-direction: column; gap: 9px; align-items: flex-start; min-width: 130px; }
.bluff-mine-name { display: flex; align-items: center; gap: 8px; font: 600 16px var(--font-display); color: var(--text); }
.bluff-mine-name .bluff-av { width: 32px; height: 32px; }
.bluff-secret { font-size: 11px; color: var(--muted); font-weight: 700; display: flex; align-items: center; gap: 5px; }
.bluff-secret .ic { width: 14px; height: 14px; }
.bluff-hand { display: flex; gap: 14px; --cw: 130px; align-items: flex-end; }
.bluff-hand.ex { gap: 10px; --cw: 112px; }

/* ---- controls ---- */
.bluff-ctrl { margin-top: 12px; display: flex; flex-direction: column; justify-content: center; gap: 10px; min-height: 96px; }
.bluff-hint { text-align: center; font: 600 16px/1.3 var(--font-display); color: var(--gold); text-shadow: 0 1px 0 rgba(0,0,0,.6), 0 0 14px rgba(255,207,92,.3); }
.bluff-hint small { display: block; font: 700 12.5px var(--font-body); color: #ddd3ec; text-shadow: none; margin-top: 2px; }
.bluff-hint.wait { color: #f1e6f6; }
.bluff-groups { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 4fr); gap: 10px; }
.bluff-group { padding: 10px 8px 8px; border-radius: 16px; background: rgba(12,9,30,.42); border: 1px solid rgba(255,255,255,.08); min-width: 0; }
.bluff-glabel { font: 800 10.5px var(--font-body); letter-spacing: .14em; text-transform: uppercase; color: rgba(255,236,226,.7); margin: 0 0 11px 4px; }
.bluff-btns { display: grid; gap: 11px 7px; grid-template-columns: 1fr; }
.bluff-group.claims .bluff-btns { grid-template-columns: 1fr 1fr; }
button.bluff-act { position: relative; display: flex; align-items: center; gap: 10px; padding: 6px 10px 6px 6px; min-height: 56px; text-align: left; border-radius: 14px; width: 100%; }
/* role tiles: rounded, glossy, in the role's colour (no more gold rings) */
.bluff-act-ic { width: 40px; height: 40px; flex: none; border-radius: 12px; display: grid; place-items: center; color: #fff;
  background: radial-gradient(circle at 30% 22%, rgba(255,255,255,.4), transparent 55%), var(--rc);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.26), inset 0 -6px 10px rgba(0,0,0,.18), 0 3px 8px rgba(0,0,0,.35); }
.bluff-act-ic .bluff-ic { width: 22px; height: 22px; filter: drop-shadow(0 1px 1px rgba(0,0,0,.5)); }
.bluff-act-l { min-width: 0; }
.bluff-act-l b { display: block; font: 600 14px/1.15 var(--font-display); }
.bluff-act-l small { display: block; font-size: 11px; font-weight: 700; color: var(--muted); line-height: 1.2; }
.bluff-tag { position: absolute; top: -8px; right: 8px; z-index: 2; font: 800 9px/1.6 var(--font-body); letter-spacing: .08em; text-transform: uppercase; padding: 0 7px; border-radius: 999px; text-shadow: none; box-shadow: 0 2px 5px rgba(0,0,0,.45); }
.bluff-tag.held { background: #0f3d31; color: #9ff3cf; border: 1px solid rgba(62,224,161,.6); }
.bluff-tag.bluff { background: #4a1530; color: #ffc2cc; border: 1px solid rgba(255,107,129,.6); }
button:disabled .bluff-tag { opacity: .75; }
.bluff-resp { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
.bluff-resp button { min-height: 56px; min-width: 150px; font-family: var(--font-display); font-weight: 600; font-size: 17px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 8px 20px; border-radius: 16px; }
.bluff-resp button .ic, .bluff-resp button .bluff-ic { width: 22px; height: 22px; }
.bluff-resp button.blockbtn, .bluff-resp button.blockbtn:hover:not(:disabled) { color: #fff; text-shadow: 0 1px 1px rgba(0,0,0,.55); border-color: rgba(255,255,255,.32);
  background: linear-gradient(180deg, rgba(255,255,255,.22), rgba(0,0,0,.18)), var(--rc); box-shadow: inset 0 1px 0 rgba(255,255,255,.35), 0 6px 16px rgba(0,0,0,.4); }
.bluff-resp button.blockbtn:hover:not(:disabled) { filter: brightness(1.08); }
.bluff-resp button .bluff-tag { position: static; margin-left: 2px; }
.bluff-winner { text-align: center; padding: 6px 0 2px; }
.bluff-winner .winner-banner { padding: 6px; }
.bluff-winner .winner-banner .ic { width: 1em; height: 1em; vertical-align: -.12em; }

/* ---- side ---- */
.bluff-side .status { line-height: 1.3; }
.bluff-round { margin: 4px 0 12px; }
.bluff-refside { min-height: 40px; }
.bluff-ledger { display: flex; flex-direction: column; gap: 6px; }
.bluff-lrow { display: flex; align-items: center; gap: 10px; padding: 6px 10px 6px 6px; border-radius: 12px; background: rgba(255,255,255,.04); border: 1px solid var(--line); }
.bluff-lrow .bluff-medal { border-radius: 9px; }
.bluff-lrow .bluff-medal .bluff-ic { width: 16px; height: 16px; }
.bluff-lrow .nm { flex: 1; min-width: 0; font: 600 13.5px var(--font-display); color: var(--text); }
.bluff-lrow .ab { display: block; font: 600 11px var(--font-body); color: var(--muted); }
.bluff-pips { display: flex; gap: 4px; }
.bluff-pips i { width: 14px; height: 19px; border-radius: 4px; border: 1.5px dashed var(--line-2); }
.bluff-pips i.rev { border: 1.5px solid var(--bad); background: linear-gradient(135deg, transparent 44%, var(--bad) 44% 56%, transparent 56%), rgba(255,107,129,.18); }
.bluff-pips i.mine { border: 1.5px solid var(--gold); background: radial-gradient(circle, var(--gold) 0 3px, transparent 3.5px), rgba(255,207,92,.16); }
.bluff-legend { display: flex; gap: 12px; font-size: 11px; color: var(--muted); margin-top: 2px; flex-wrap: wrap; }
.bluff-legend span { display: inline-flex; align-items: center; gap: 4px; }
.bluff-legend .bluff-pips i { width: 10px; height: 13px; }
.bluff-side .drawer > summary .note { min-width: 0; max-width: 55%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bluff-chronicle[open] > summary .note { visibility: hidden; }
.bluff-log { max-height: 260px; color: var(--muted); }
.bluff-log div { border-bottom-color: var(--line); }
.bluff-log div:first-child { color: var(--text); }
.bluff-log b { font-weight: 800; }

/* ---- overlays ---- */
.bluff-ov { position: fixed; left: 0; top: 0; z-index: 126; pointer-events: none; }
.bluff-bannerwrap { position: fixed; transform: translate(-50%, -50%); filter: drop-shadow(0 12px 24px rgba(0,0,0,.65)); animation: bluff-banner 2.1s cubic-bezier(.2,.8,.2,1) both; }
.bluff-banner { width: min(540px, 92vw); display: flex; align-items: center; gap: 14px; padding: 12px 40px 12px 30px;
  background: linear-gradient(180deg, rgba(255,255,255,.18), rgba(0,0,0,.28)), linear-gradient(90deg, var(--rd), var(--rc) 50%, var(--rd));
  clip-path: polygon(0 0, 100% 0, 95% 50%, 100% 100%, 0 100%, 5% 50%);
  border-top: 2px solid rgba(255,236,190,.85); border-bottom: 2px solid rgba(255,236,190,.85); }
.bluff-banner .bb-medal { width: 62px; height: 62px; flex: none; border-radius: 18px; display: grid; place-items: center; color: #fff;
  background: radial-gradient(circle at 30% 22%, rgba(255,255,255,.45), transparent 55%), var(--rc); box-shadow: inset 0 0 0 2px rgba(255,255,255,.35), 0 0 22px rgba(255,220,140,.45); }
.bluff-banner .bb-medal .bluff-ic { width: 36px; height: 36px; filter: drop-shadow(0 2px 2px rgba(0,0,0,.6)); }
.bluff-banner .bb-t { min-width: 0; }
.bluff-banner .bb-who { font: 800 13px var(--font-body); letter-spacing: .14em; text-transform: uppercase; color: #fff4e6; text-shadow: 0 1px 2px #000; }
.bluff-banner .bb-big { font: 700 clamp(24px, 6.4vw, 36px)/1.05 var(--font-display); letter-spacing: .06em; text-transform: uppercase;
  background: linear-gradient(180deg, #fffbe8, #ffcf5c 60%, #f0a63a); -webkit-background-clip: text; background-clip: text; color: transparent; filter: drop-shadow(0 2px 0 rgba(0,0,0,.55)); }
.bluff-banner .bb-sub { font: 700 13.5px var(--font-body); color: #fff4e6; text-shadow: 0 1px 2px #000; }
@keyframes bluff-banner { 0% { opacity: 0; transform: translate(-50%, -50%) scale(.55) rotateX(70deg); } 13% { opacity: 1; transform: translate(-50%, -50%) scale(1.06); } 20% { transform: translate(-50%, -50%) scale(1); } 82% { opacity: 1; transform: translate(-50%, -50%) scale(1); } 100% { opacity: 0; transform: translate(-50%, -78%) scale(.96); } }
.bluff-stamp { position: fixed; transform: translate(-50%, -50%); text-align: center; animation: bluff-stamp 1.5s cubic-bezier(.2,.8,.2,1) both; }
.bluff-stamp b { display: block; font: 700 clamp(40px, 11vw, 84px)/1.08 var(--font-display); letter-spacing: .04em; padding: 0 .28em; color: var(--ink, #e02a2e);
  border: 7px double currentColor; border-radius: 14px; transform: rotate(-9deg); background: rgba(255,240,220,.07);
  -webkit-mask-image: ${INK}; mask-image: ${INK}; -webkit-mask-size: 160px; mask-size: 160px; text-shadow: 0 0 2px currentColor; }
.bluff-stamp small { display: inline-block; margin-top: 16px; font: 800 15px var(--font-body); color: #fff; text-shadow: 0 2px 4px #000; background: rgba(14,10,34,.82); padding: 5px 14px; border-radius: 12px; border: 1px solid rgba(255,255,255,.18); }
@keyframes bluff-stamp { 0% { opacity: 0; transform: translate(-50%, -50%) scale(2.8); } 13% { opacity: 1; transform: translate(-50%, -50%) scale(.9); } 20% { transform: translate(-50%, -50%) scale(1.05); } 27% { transform: translate(-50%, -50%) scale(1); } 82% { opacity: 1; transform: translate(-50%, -50%) scale(1); } 100% { opacity: 0; transform: translate(-50%, -50%) scale(1.04); } }
.bluff-proof { position: fixed; transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center; gap: 12px; }
.bluff-proof .bluff-card { --cw: min(150px, 34vw); }
.bluff-proof .bluff-card-in { animation: bluff-flip .9s .2s cubic-bezier(.3,.7,.3,1.1) both; }
.bluff-proof::before { content: ''; position: absolute; left: 50%; top: 42%; width: 340px; height: 340px; transform: translate(-50%, -50%); border-radius: 50%; background: radial-gradient(circle, rgba(255,220,140,.55), transparent 62%); animation: bluff-fadein .5s both; z-index: -1; }
.bluff-proof-cap { font: 600 17px var(--font-display); color: var(--gold); text-shadow: 0 2px 6px #000; background: rgba(14,10,34,.88); padding: 6px 16px; border-radius: 14px; border: 1px solid rgba(255,207,92,.5); white-space: nowrap; animation: bluff-fadein .4s .5s both; }
.bluff-slash { position: fixed; transform: translate(-50%, -50%); }
.bluff-slash svg { width: 100%; height: 100%; overflow: visible; display: block; }
.bluff-slash .sl { fill: none; stroke-linecap: round; stroke-dasharray: 320; stroke-dashoffset: 320; animation: bluff-slashline .3s .12s ease-out forwards, bluff-out .5s .8s forwards; }
.bluff-slash .dg { animation: bluff-dagger .42s cubic-bezier(.5,0,.3,1) forwards; opacity: 0; }
.bluff-slash .fl { animation: bluff-flash .7s .2s ease-out both; }
@keyframes bluff-slashline { to { stroke-dashoffset: 0; } }
@keyframes bluff-out { to { opacity: 0; } }
@keyframes bluff-dagger { 0% { opacity: 0; transform: translate(70px, -70px) rotate(0deg); } 20% { opacity: 1; } 80% { opacity: 1; } 100% { opacity: 0; transform: translate(-70px, 70px) rotate(-20deg); } }
@keyframes bluff-flash { 0% { opacity: 0; } 30% { opacity: .85; } 100% { opacity: 0; } }
.bluff-seal { position: fixed; transform: translate(-50%, -50%); width: 120px; height: 120px; animation: bluff-seal 1.6s cubic-bezier(.2,.8,.2,1) both; filter: drop-shadow(0 8px 14px rgba(0,0,0,.7)); }
.bluff-seal svg { width: 100%; height: 100%; display: block; }
@keyframes bluff-seal { 0% { opacity: 0; transform: translate(-50%, -50%) scale(3) rotate(-30deg); } 16% { opacity: 1; transform: translate(-50%, -50%) scale(.9) rotate(-8deg); } 24% { transform: translate(-50%, -50%) scale(1.04) rotate(-8deg); } 80% { opacity: 1; transform: translate(-50%, -50%) scale(1) rotate(-8deg); } 100% { opacity: 0; transform: translate(-50%, -50%) scale(.9) rotate(-8deg); } }
.bluff-tagov { position: fixed; transform: translate(-50%, -50%) rotate(-8deg); font: 700 18px var(--font-display); letter-spacing: .14em; color: #ffe2e7; padding: 5px 16px; border-radius: 10px; white-space: nowrap;
  background: linear-gradient(180deg, #5a0c22, #1e0410); border: 2px solid var(--bad); box-shadow: 0 8px 20px rgba(0,0,0,.7); animation: bluff-stamp 2s cubic-bezier(.2,.8,.2,1) both; }
.bluff-tagov.good { color: #e8fff4; border-color: var(--good); background: linear-gradient(180deg, #0f3d31, #06180f); }

/* ---- reference modal ---- */
.bluff-ref { max-width: 560px; position: relative; }
.bluff-ref h2 { margin: 0; padding-right: 48px; }
.bluff-refx { position: absolute; top: 12px; right: 12px; z-index: 2; }
.bluff-ref-grid { display: grid; gap: 10px; margin: 12px 0; }
.bluff-ref-role { display: flex; gap: 12px; align-items: center; padding: 8px 10px 8px 8px; border-radius: 14px; background: rgba(255,255,255,.04); border: 1px solid var(--line); box-shadow: inset 3px 0 0 var(--rc, transparent); }
.bluff-ref-role .bluff-card { --cw: 76px; }
.bluff-ref-role h3 { margin: 0 0 2px; font-size: 1.05rem; }
.bluff-ref-role p { margin: 0; font-size: .88rem; color: var(--text); }
.bluff-ref-role p.b { color: var(--muted); }
.bluff-ref ul { margin: 6px 0 10px; padding-left: 18px; font-size: .9rem; color: var(--text); }
.bluff-ref li { margin: 3px 0; }

/* ---- responsive ---- */
@media (min-width: 640px) {
  .bluff-opps.n3 .bluff-seat:nth-child(1), .bluff-opps.n3 .bluff-seat:nth-child(3) { margin-top: 22px; }
  .bluff-opps.n4 .bluff-seat:nth-child(1), .bluff-opps.n4 .bluff-seat:nth-child(4) { margin-top: 24px; }
  .bluff-opps.n5 .bluff-seat:nth-child(1), .bluff-opps.n5 .bluff-seat:nth-child(5) { margin-top: 30px; }
  .bluff-opps.n5 .bluff-seat:nth-child(2), .bluff-opps.n5 .bluff-seat:nth-child(4) { margin-top: 10px; }
  .bluff-opps.n1 .bluff-seat, .bluff-opps.n2 .bluff-seat { width: 180px; --scw: 58px; }
}
@media (max-width: 1100px) and (min-width: 901px) {
  .bluff-seat { width: 136px; } .bluff-opps { --scw: 44px; gap: 10px; }
  .bluff-center { grid-template-columns: 96px minmax(0, 1fr) 96px; }
  .bluff-groups { grid-template-columns: 1fr; }
}
@media (max-width: 900px) {
  .bluff-table::after { border-radius: 11px; }
}
@media (max-width: 639px) {
  .bluff-table.felt { padding: 10px 8px 10px; }
  .bluff-refbtn { top: 4px; right: 4px; width: 36px; height: 36px; min-height: 36px; padding: 0; }
  .bluff-refbtn span { display: none; }
  .bluff-opps { --scw: 32px; gap: 6px; padding-top: 42px; }
  .bluff-seat { width: calc((100% - 12px) / 3); padding: 12px 4px 5px; gap: 5px; border-radius: 12px; }
  .bluff-opps.n1 .bluff-seat, .bluff-opps.n2 .bluff-seat { width: calc((100% - 6px) / 2); --scw: 44px; }
  .bluff-opps.n4 .bluff-seat { width: calc((100% - 6px) / 2); }
  .bluff-seat-head { gap: 5px; }
  .bluff-av { width: 26px; height: 26px; box-shadow: 0 0 0 2px var(--pc, #fff), 0 2px 4px rgba(0,0,0,.45); }
  .bluff-seat-name { font-size: 11.5px; }
  .bluff-seat-cards { gap: 4px; }
  .bluff-seat-foot { min-height: 20px; }
  .bluff-purse { --cs: 13px; --co: 2px; gap: 3px; }
  .bluff-ccount { font-size: 13px; }
  .bluff-medal { width: 15px; height: 15px; } .bluff-medal .bluff-ic { width: 10px; height: 10px; }
  .bluff-claims { gap: 2px; }
  .bluff-flag { top: -10px; right: -6px; min-width: 24px; height: 24px; padding: 0 5px; font-size: 13px; }
  .bluff-flag .ic { width: 13px; height: 13px; }
  .bluff-says { top: -11px; font-size: 9.5px; padding: 1px 7px 1px 2px; } .bluff-says .bluff-ic { width: 13px; height: 13px; }
  .bluff-seat.pickable::after { font-size: 9px; padding: 1px 6px; }
  .bluff-center { grid-template-columns: 62px minmax(0, 1fr) 62px; gap: 6px; margin: 14px 0 8px; }
  .bluff-tray { width: 58px; height: 40px; box-shadow: inset 0 5px 10px rgba(0,0,0,.85), 0 0 0 1.5px rgba(255,214,150,.5), 0 0 0 3.5px rgba(14,8,28,.5), 0 6px 12px rgba(0,0,0,.55); }
  .bluff-tray .bluff-coin { width: 15px; height: 15px; }
  .bluff-lbl { font-size: 8.5px; letter-spacing: .08em; }
  .bluff-pile { --pw: 38px; }
  .bluff-stage { min-height: 90px; gap: 6px; }
  .bluff-plate { padding: 6px 8px; gap: 6px; flex-direction: column; }
  .bluff-plate .bluff-card { --cw: 32px; }
  .bluff-pl-row { gap: 7px; }
  .bluff-pl-txt b { font-size: 12.5px; } .bluff-pl-txt small { font-size: 11px; }
  .bluff-pl-ic { width: 32px; height: 32px; border-radius: 10px; } .bluff-pl-ic .bluff-ic { width: 19px; height: 19px; }
  .bluff-candle { width: 26px; height: 38px; }
  .bluff-tk { font-size: 10.5px; padding: 1px 6px 1px 2px; gap: 3px; } .bluff-tk i { width: 14px; height: 14px; } .bluff-tk i .ic { width: 9px; height: 9px; } .bluff-tkface { width: 15px; height: 15px; }
  .bluff-track-lbl { width: 100%; text-align: center; margin: 0; }
  .bluff-mine { flex-direction: column; gap: 10px; padding: 12px 8px 10px; }
  .bluff-mine-info { flex-direction: row; align-items: center; justify-content: center; flex-wrap: wrap; gap: 10px 14px; min-width: 0; width: 100%; }
  .bluff-mine-name { font-size: 14px; }
  .bluff-mine-name .bluff-av { width: 30px; height: 30px; }
  .bluff-purse.big { --cs: 20px; --co: 3px; } .bluff-purse.big .bluff-ccount { font-size: 19px; }
  .bluff-secret { display: none; }
  .bluff-hand { --cw: 112px; gap: 12px; }
  .bluff-hand.ex { --cw: 72px; gap: 6px; }
  .bluff-groups { grid-template-columns: 1fr; gap: 8px; }
  .bluff-group.common .bluff-btns { grid-template-columns: 1fr 1fr 1fr; }
  .bluff-group.common button.bluff-act { flex-direction: column; text-align: center; gap: 3px; padding: 6px 4px; }
  .bluff-group.common .bluff-act-ic { width: 32px; height: 32px; border-radius: 10px; } .bluff-group.common .bluff-act-ic .bluff-ic { width: 18px; height: 18px; }
  button.bluff-act { gap: 7px; padding: 5px 6px 5px 5px; }
  .bluff-act-ic { width: 34px; height: 34px; border-radius: 10px; } .bluff-act-ic .bluff-ic { width: 19px; height: 19px; }
  .bluff-act-l b { font-size: 12.5px; } .bluff-act-l small { font-size: 10px; }
  .bluff-tag { font-size: 8px; padding: 0 5px; top: -7px; right: 5px; }
  .bluff-resp button { min-width: 0; flex: 1 1 40%; font-size: 15px; padding: 8px 10px; }
  .bluff-hint { font-size: 14px; }
  .bluff-banner { padding: 10px 26px 10px 20px; gap: 10px; }
  .bluff-banner .bb-medal { width: 46px; height: 46px; border-radius: 14px; } .bluff-banner .bb-medal .bluff-ic { width: 26px; height: 26px; }
  .bluff-banner .bb-who { font-size: 11px; } .bluff-banner .bb-sub { font-size: 12px; }
  .bluff-proof-cap { font-size: 14px; white-space: normal; text-align: center; max-width: 86vw; }
  .bluff-seal { width: 90px; height: 90px; }
}
@media (max-width: 360px) {
  .bluff-hand { --cw: 100px; }
  .bluff-group.claims .bluff-btns { grid-template-columns: 1fr; }
}
`;

/* ============================================================
   Rendering
   ============================================================ */
let ui = { gid: null, turnSeq: null, me: null, phase: null, pick: null, sel: null, ex: null };
let last = null;
let evGid = null, evSeen = 0, fxBusy = 0;
const upAt = new Map(); // card key -> ms when its reveal animation starts (0 = no animation)
const handAt = new Map(); // viewer|key -> ms when first seen in that viewer's hand
const handInit = new Set();
const outAt = new Map(); // pid -> ms when the "Banished" badge lands
const GAP = { claim: 500, act: 400, block: 500, challenge: 1050, slash: 800, coup: 700, lose: 500, out: 900, stopped: 500, draw: 0, shuffle: 0 };

const short = (name) => String(name || '?').replace(/[^\p{L}\p{N}\s'.-]/gu, '').trim().split(/\s+/)[0].slice(0, 9) || '?';
const COIN_HUE = '#e2a232'; // Income, Foreign Aid and the winner's medal: the colour of the coins
let prevCoins = new Map(); // game id | player id -> coins at the last render, for the "gain" flash
// The ledger and chronicle fold away on phones so the table gets the screen; they stay as the player left them.
const WIDE = typeof matchMedia === 'function' ? matchMedia('(min-width: 901px)').matches : true;
let ledgerOpen = WIDE, chronOpen = WIDE;

function prepEvents(v, now) {
  const list = v.ev || [];
  const max = list.length ? Math.max(...list.map((e) => e.seq)) : 0;
  if (v.gid !== evGid) {
    evGid = v.gid;
    upAt.clear();
    handAt.clear();
    handInit.clear();
    outAt.clear();
    for (const p of v.players) for (const c of p.cards) if (c.up || v.over) upAt.set(c.k, 0);
    evSeen = max;
    return [];
  }
  const fresh = list.filter((e) => e.seq > evSeen);
  evSeen = Math.max(evSeen, max);
  // Effects play one after another, even when moves arrive faster than the animations,
  // but never lag more than a few seconds behind the table.
  let t = Math.min(Math.max(0, fxBusy - now), 3200);
  for (const e of fresh) {
    e.at = t;
    if (e.t === 'lose' && !upAt.has(e.k)) upAt.set(e.k, now + t);
    if (e.t === 'out') outAt.set(e.pid, now + t + 700);
    t += e.t === 'proof' ? (e.ok ? 2100 : 1300) : GAP[e.t] ?? 200;
  }
  if (fresh.length) fxBusy = now + t;
  for (const p of v.players) for (const c of p.cards) if (c.up && !upAt.has(c.k)) upAt.set(c.k, now);
  // Game over: the survivors' secrets turn face-up once the last effects have played.
  if (v.over) for (const p of v.players) for (const c of p.cards) if (!c.up && !upAt.has(c.k)) upAt.set(c.k, now + t + 300);
  return fresh;
}

function cardHTML(c, o = {}) {
  const now = o.now || performance.now();
  const showFront = !!c.role && (c.up || o.mine || o.reveal);
  const cls = ['bluff-card'];
  let fd = null, cd = null;
  if (!showFront) cls.push('down');
  if (c.up) {
    cls.push('lost');
    const t0 = upAt.get(c.k);
    if (t0) {
      const d = t0 - now;
      if (!o.mine && d > -1700) { cls.push('flipin'); fd = d; cd = d + 650; }
      else if (o.mine && d > -1200) cd = d;
    }
    if (cd != null) cls.push('lostnew');
  } else if (showFront && o.reveal && !o.mine) {
    const t0 = upAt.get(c.k); // end-of-game reveal of a still-hidden card
    if (t0 && t0 - now > -1700) { cls.push('flipin'); fd = t0 - now; }
  } else if (showFront && o.newAt) {
    const d = o.newAt - now + 120;
    if (d > -900) { cls.push('flipin'); fd = d; }
  }
  if (o.cls) cls.push(o.cls);
  const style = (fd != null ? `--fd:${Math.round(fd)}ms;` : '') + (cd != null ? `--cd:${Math.round(cd)}ms;` : '') + (o.style || '');
  const front = showFront ? `<div class="bluff-face front">${faceSVG(c.role, o.mini)}${c.up ? CRACK : ''}</div>` : '';
  const back = !showFront || fd != null ? `<div class="bluff-face back">${BACK_SVG}</div>` : '';
  return `<div class="${cls.join(' ')}" data-k="${esc(c.k)}"${o.noenter ? ' data-noenter' : ''}${o.attrs ? ' ' + o.attrs : ''}${style ? ` style="${style}"` : ''}><div class="bluff-card-in">${front}${back}</div>${o.ribbon || ''}${o.tag || ''}</div>`;
}
const staticCard = (role, cw, mini = false) => `<div class="bluff-card" style="--cw:${cw}"><div class="bluff-card-in"><div class="bluff-face front">${faceSVG(role, mini)}</div></div></div>`;

function purseHTML(p, big = false) {
  const n = p.coins;
  const stacks = [];
  for (let left = Math.min(n, 15); left > 0; left -= 5) stacks.push(Math.min(5, left));
  const st = stacks.length ? stacks.map((c) => `<div class="bluff-stack">${'<i class="bluff-sc"></i>'.repeat(c)}</div>`).join('') : '<div class="bluff-stack empty"></div>';
  return `<div class="bluff-purse${big ? ' big' : ''}" data-a="p-${esc(p.id)}-coins" title="${n} coin${n === 1 ? '' : 's'}"><div class="bluff-stacks">${st}</div><b class="bluff-ccount">${n}</b></div>`;
}
const claimsHTML = (p) => `<div class="bluff-claims" title="Roles claimed">${p.claims.map((r) => `<span class="bluff-medal" style="--rc:${R[r].color}" title="Claimed ${R[r].name}">${icon(r)}</span>`).join('')}</div>`;
// The lobby portrait (a robot for computer players), ringed in the seat colour.
const avatarHTML = (p, color, ctx) => `<div class="bluff-av" style="--pc:${color}" title="${esc(p.name)}">${portrait({ id: p.id, bot: !!ctx?.isBot?.(p.id) })}</div>`;
// A tiny face for the "who still has to answer" chips under the stage.
const seatColor = (v, id) => PLAYER_COLORS[Math.max(0, v.players.findIndex((p) => p.id === id)) % PLAYER_COLORS.length];
const tinyFace = (v, id, ctx) => `<span class="bluff-tkface" style="--pc:${seatColor(v, id)}">${portrait({ id, bot: !!ctx?.isBot?.(id) })}</span>`;
const DOTS = '<i></i><i></i><i></i>';

function flagHTML(v, pid) {
  if (v.over) return v.winners.includes(pid) ? `<span class="bluff-flag win" title="Rules the court">${uiIcon('crown')}</span>` : '';
  if (WINDOWS.includes(v.phase)) {
    if (v.allowed.includes(pid)) return `<span class="bluff-flag ok" title="Allowed">${uiIcon('check')}</span>`;
    if (v.respond.includes(pid)) return `<span class="bluff-flag wait" title="Deciding">${DOTS}</span>`;
  }
  if (v.phase === 'lose' && v.respond.includes(pid)) return '<span class="bluff-flag bad" title="Giving up an influence"><b>!</b></span>';
  if (v.phase === 'exchange' && v.respond.includes(pid)) return `<span class="bluff-flag wait swap" title="Exchanging cards">${uiIcon('refresh')}</span>`;
  return '';
}
function saysHTML(v, pid) {
  const pd = v.pending;
  if (!pd || v.over) return '';
  if (pd.blocker === pid) return `<div class="bluff-says blk" style="--rc:${R[pd.blockRole].color}">${icon(pd.blockRole)}<span>${R[pd.blockRole].name}</span></div>`;
  if (pd.actor === pid && pd.claim && !pd.blocker) return `<div class="bluff-says" style="--rc:${R[pd.claim].color}">${icon(pd.claim)}<span>${R[pd.claim].name}</span></div>`;
  return '';
}

function seatHTML(v, p, st) {
  const idx = v.players.indexOf(p);
  const color = PLAYER_COLORS[idx % PLAYER_COLORS.length];
  const pickable = st.pickable.includes(p.id);
  const cls = ['bluff-seat'];
  if (!v.over && v.players[v.turn].id === p.id) cls.push('turn');
  if (p.out) cls.push('out');
  if (pickable) cls.push('pickable');
  if (v.over && v.winners.includes(p.id)) cls.push('win');
  if (st.gained.has(p.id)) cls.push('gain');
  const ex = v.exchange && v.exchange.pid === p.id ? v.exchange.drawn : [];
  const cards = p.cards.map((c) => cardHTML(c, { now: st.now, mini: true, cls: 'mini', reveal: v.over })).join('') + ex.map((c) => cardHTML(c, { now: st.now, mini: true, cls: 'mini extra' })).join('');
  const ob = outAt.get(p.id);
  const badge = p.out && !v.over ? `<span class="bluff-banished${ob && ob - st.now > -600 ? ' new' : ''}"${ob ? ` style="--bd:${Math.round(ob - st.now)}ms"` : ''}>Banished</span>` : '';
  return `<div class="${cls.join(' ')}" data-a="p-${esc(p.id)}-seat" style="--pc:${color}"${pickable ? ` data-do="target" data-pid="${esc(p.id)}" role="button" tabindex="0" aria-label="Target ${esc(p.name)}"` : ''}>
${flagHTML(v, p.id)}${saysHTML(v, p.id)}
<div class="bluff-seat-head">${avatarHTML(p, color, st.ctx)}<div class="bluff-seat-name">${esc(p.name)}</div></div>
<div class="bluff-seat-cards" data-a="p-${esc(p.id)}-hand">${cards}${badge}</div>
<div class="bluff-seat-foot">${purseHTML(p)}${claimsHTML(p)}</div>
</div>`;
}

const CANDLE = `<svg class="bluff-candle" viewBox="0 0 40 56" aria-hidden="true"><defs><radialGradient id="bw-cfl" cx=".5" cy=".7" r=".7"><stop offset="0" stop-color="#fffbe6"/><stop offset=".4" stop-color="#ffd760"/><stop offset=".8" stop-color="#ff8a20"/><stop offset="1" stop-color="#ff5a10" stop-opacity="0"/></radialGradient></defs>
<circle cx="20" cy="15" r="14" fill="#ffc860" opacity=".2"/><rect x="15" y="22" width="10" height="26" rx="1.5" fill="#f3e6c8"/><path d="M15 24c-1.5 5 1.5 6 .5 11H18V24Z" fill="#fffaf0"/>
<path d="M7 50c0-4 26-4 26 0s-26 4-26 0Z" fill="url(#bw-gold)"/><path d="M20 22v-4" stroke="#2a1a0a" stroke-width="1.2"/>
<path class="fl" d="M20 4c4.5 6.5 5 11 0 15.5C15 15 15.5 10.5 20 4Z" fill="url(#bw-cfl)"/></svg>`;

function stageHTML(v, me, ctx) {
  const pd = v.pending;
  const nm = (id) => (id === me ? 'You' : esc(short(P(v, id)?.name)));
  if (v.over) {
    const w = P(v, v.winners[0]);
    return `<div class="bluff-plate"><div class="bluff-pl-row"><div class="bluff-pl-ic" style="--rc:${COIN_HUE}">${icon('chancellor')}</div><div class="bluff-pl-txt"><b>${w ? nm(w.id) : 'Nobody'} ${w && w.id === me ? 'rule' : 'rules'} the court</b><small>The whispers fall silent.</small></div></div></div>`;
  }
  if (!pd) {
    const a = v.players[v.turn];
    return `<div class="bluff-plate"><div class="bluff-pl-row">${CANDLE}<div class="bluff-pl-txt"><b>${a.id === me ? (ui.pick ? 'Choose a rival' : 'Your move') : `${esc(short(a.name))}'s move`}</b><small>${a.id === me ? (ui.pick ? `Tap a glowing rival to ${A[ui.pick].name}.` : a.coins >= 10 ? 'You must stage a Coup.' : 'Choose an action below.') : 'weighing their options…'}</small></div></div></div>`;
  }
  const def = A[pd.action];
  const tgt = pd.target ? ` → ${nm(pd.target)}` : '';
  let h = '<div class="bluff-plate"><div class="bluff-pl-row">';
  h += pd.claim ? staticCard(pd.claim, 'var(--pcw, 44px)', true) : `<div class="bluff-pl-ic" style="--rc:${pd.action === 'coup' ? '#c8283a' : COIN_HUE}">${icon(pd.action)}</div>`;
  h += `<div class="bluff-pl-txt"><b>${nm(pd.actor)}${pd.claim ? ` · <em style="color:${shade(R[pd.claim].color, 0.35)}">${R[pd.claim].name}</em>` : ''}</b><small>${def.name}${tgt} · ${def.sub}</small></div></div>`;
  if (pd.blocker) {
    h += `<span class="bluff-vs">BLOCKED</span><div class="bluff-pl-row">${staticCard(pd.blockRole, 'var(--pcw, 44px)', true)}<div class="bluff-pl-txt"><b>${nm(pd.blocker)} · <em style="color:${shade(R[pd.blockRole].color, 0.35)}">${R[pd.blockRole].name}</em></b><small>claims a block</small></div></div>`;
  }
  h += '</div>';
  if (WINDOWS.includes(v.phase)) {
    const ids = [...v.allowed, ...v.respond];
    const lbl = v.phase === 'block' ? (def.by === 'target' ? 'Block?' : 'Anyone may block') : 'Challenge?';
    h += `<div class="bluff-track"><span class="bluff-track-lbl">${lbl}</span>${ids.map((id) => {
      const ok = v.allowed.includes(id);
      return `<span class="bluff-tk ${ok ? 'ok' : 'wait'}"><i>${ok ? uiIcon('check') : ''}</i>${tinyFace(v, id, ctx)}${id === me ? 'You' : esc(short(P(v, id)?.name))}</span>`;
    }).join('')}</div>`;
  } else if (v.phase === 'lose') {
    h += `<div class="bluff-track"><span class="bluff-tk wait"><i></i>${tinyFace(v, v.respond[0], ctx)}${nm(v.respond[0])} ${v.respond[0] === me ? 'must' : 'must'} give up a card</span></div>`;
  } else if (v.phase === 'exchange') {
    h += `<div class="bluff-track"><span class="bluff-tk wait"><i></i>${tinyFace(v, v.respond[0], ctx)}${nm(v.respond[0])} ${v.respond[0] === me ? 'are' : 'is'} choosing cards</span></div>`;
  }
  return h;
}

function treasuryHTML() {
  const spots = [[14, 22], [38, 12], [62, 18], [26, 36], [50, 32], [72, 38], [40, 24], [58, 4], [20, 6]];
  return `<div class="bluff-treasury"><div class="bluff-tray" data-a="treasury">${spots.map(([x, y]) => `<i class="bluff-coin" style="left:${x}%;top:${y}%"></i>`).join('')}</div><div class="bluff-lbl">Treasury</div></div>`;
}
function deckHTML(v, now) {
  const n = v.deckCount;
  let h = '';
  const layers = Math.min(n, 4);
  for (let i = layers - 1; i >= 0; i--) {
    const k = i < 2 ? `d${v.drawSeq + i}` : `deck-${i}`;
    h += cardHTML({ k, role: null, up: false }, { now, noenter: true, style: `bottom:${(layers - 1 - i) * 3}px` });
  }
  for (const k of v.returned || []) h += cardHTML({ k, role: null, up: false }, { now, style: `bottom:${Math.max(0, layers - 1) * 3 + 2}px` });
  return `<div class="bluff-deck"><div class="bluff-pile" data-a="deck">${h}</div><div class="bluff-lbl">Court deck · ${n}</div></div>`;
}

function mineHTML(v, meP, st) {
  const me = meP.id;
  const idx = v.players.indexOf(meP);
  const color = PLAYER_COLORS[idx % PLAYER_COLORS.length];
  const myAct = v.respond.includes(me);
  const losing = v.phase === 'lose' && myAct;
  const exch = v.phase === 'exchange' && myAct && v.exchange;
  let cards;
  const key = (k) => me + '|' + k;
  const seenNow = (k) => {
    if (!handInit.has(me)) return 0;
    if (!handAt.has(key(k))) handAt.set(key(k), st.now);
    return handAt.get(key(k));
  };
  const pool = [...meP.cards, ...(exch ? v.exchange.drawn : [])];
  pool.forEach((c) => seenNow(c.k));
  if (!handInit.has(me)) { pool.forEach((c) => handAt.set(key(c.k), 0)); handInit.add(me); }
  if (exch) {
    const drawnKeys = v.exchange.drawn.map((c) => c.k);
    cards = pool.filter((c) => !c.up).map((c) => {
      const kept = ui.ex.includes(c.k);
      return cardHTML(c, { now: st.now, mine: true, newAt: handAt.get(key(c.k)), cls: 'pick ' + (kept ? 'chosen' : 'dropped') + (st.tapped === c.k ? ' tapped' : ''), attrs: `data-do="ex" data-k="${esc(c.k)}" role="button" tabindex="0"`,
        ribbon: kept ? '<span class="bluff-ribbon">KEEP</span>' : '<span class="bluff-ribbon red">RETURN</span>', tag: drawnKeys.includes(c.k) ? '<span class="bluff-newtag">Drawn</span>' : '' });
    }).join('') + meP.cards.filter((c) => c.up).map((c) => cardHTML(c, { now: st.now, mine: true })).join('');
  } else {
    cards = meP.cards.map((c) => {
      if (losing && !c.up) {
        const doomed = ui.sel === c.k;
        return cardHTML(c, { now: st.now, mine: true, newAt: handAt.get(key(c.k)), cls: 'pick glow' + (doomed ? ' doomed' : '') + (st.tapped === c.k ? ' tapped' : ''), attrs: `data-do="sel" data-k="${esc(c.k)}" role="button" tabindex="0"`, ribbon: doomed ? '<span class="bluff-ribbon red">REVEAL</span>' : '' });
      }
      return cardHTML(c, { now: st.now, mine: true, newAt: handAt.get(key(c.k)) });
    }).join('');
  }
  const turn = !v.over && v.players[v.turn].id === me;
  return `<div class="bluff-mine${turn ? ' turn' : ''}${meP.out ? ' out' : ''}${v.over && v.winners.includes(me) ? ' win' : ''}${st.gained.has(me) ? ' gain' : ''}" data-a="p-${esc(me)}-seat" style="--pc:${color}">${saysHTML(v, me)}
<div class="bluff-mine-info">
<div class="bluff-mine-name">${avatarHTML(meP, color, st.ctx)}<span>${esc(meP.name)}</span><span class="tag t-you">You</span>${flagHTML(v, me).replace('bluff-flag', 'bluff-flag bluff-flag-inline')}</div>
${purseHTML(meP, true)}
${meP.claims.length ? `<div class="bluff-secret">Claimed: ${claimsHTML(meP)}</div>` : ''}
<div class="bluff-secret">${uiIcon('eye')}Only you see your hidden cards</div>
</div>
<div class="bluff-hand${exch ? ' ex' : ''}" data-a="p-${esc(me)}-hand">${cards}</div>
</div>`;
}

const ALLOW_BTN = `<button class="good" data-do="allow">${uiIcon('check')}Allow</button>`;
const CHALLENGE_BTN = `<button class="bad" data-do="challenge">${icon('coup', 'ic')}Challenge!</button>`;

function controlsHTML(v, meP, ctx) {
  const me = ctx.me;
  const pd = v.pending;
  const nm = (id) => esc(P(v, id)?.name || '?');
  if (v.over) {
    const w = P(v, v.winners[0]);
    return `<div class="bluff-winner"><div class="winner-banner">${uiIcon('crown')} ${w ? (w.id === me ? 'You rule' : esc(w.name) + ' rules') : 'Nobody rules'} the Court</div><div class="bluff-hint wait"><small>Every secret is now revealed. The host can start a new game.</small></div></div>`;
  }
  if (!meP) return `<div class="bluff-hint wait">You are watching the court.</div>`;
  if (meP.out) return `<div class="bluff-hint wait">You have been banished.<small>Watch the intrigue unfold — your cards are revealed to all.</small></div>`;
  const myAct = v.respond.includes(me);
  if (!myAct) return `<div class="bluff-hint wait">${waitingText(v, me)}</div>`;

  if (v.phase === 'action') {
    const coins = meP.coins;
    const mine = hidden(meP).map((c) => c.role);
    const rivals = alive(v).filter((p) => p.id !== me);
    if (ui.pick) {
      return `<div class="bluff-hint">Tap a rival's seat to ${A[ui.pick].name}<small>${ui.pick === 'plunder' ? 'Only rivals with coins can be plundered.' : 'They will lose an influence.'}</small></div><div class="bluff-resp"><button data-do="cancel">${uiIcon('close')}Cancel</button></div>`;
    }
    const must = coins >= 10;
    const btn = (action) => {
      const def = A[action];
      const role = def.claim;
      let ok = !must || action === 'coup';
      if (def.cost && coins < def.cost) ok = false;
      if (action === 'plunder' && !rivals.some((p) => p.coins > 0)) ok = false;
      const held = role && mine.includes(role);
      const color = role ? R[role].color : action === 'coup' ? '#c8283a' : COIN_HUE;
      return `<button class="bluff-act" data-do="${def.target ? 'pick' : 'act'}" data-action="${action}"${ok ? '' : ' disabled'} style="--rc:${color}">
<span class="bluff-act-ic">${icon(role || action)}</span><span class="bluff-act-l"><b>${def.name}</b><small>${role ? R[role].name + ' · ' : ''}${def.sub}</small></span>
${role ? `<span class="bluff-tag ${held ? 'held' : 'bluff'}">${held ? 'Held' : 'Bluff'}</span>` : ''}</button>`;
    };
    const hint = must ? 'You hold 10+ coins — you must stage a Coup!' : 'Your move: choose an action';
    const sub = must ? '' : coins < 7 ? `Coup needs 7 coins (you have ${coins}). Claims can be challenged — bluff boldly, or play it safe.` : 'You can afford a Coup. Claims can be challenged.';
    return `<div class="bluff-hint">${hint}${sub ? `<small>${sub}</small>` : ''}</div>
<div class="bluff-groups">
<div class="bluff-group common"><div class="bluff-glabel">Common</div><div class="bluff-btns">${btn('income')}${btn('aid')}${btn('coup')}</div></div>
<div class="bluff-group claims"><div class="bluff-glabel">Claim a role</div><div class="bluff-btns">${btn('levy')}${btn('assassinate')}${btn('plunder')}${btn('exchange')}</div></div>
</div>`;
  }
  const mine = hidden(meP).map((c) => c.role);
  const tagFor = (r) => `<span class="bluff-tag ${mine.includes(r) ? 'held' : 'bluff'}">${mine.includes(r) ? 'Held' : 'Bluff'}</span>`;
  if (v.phase === 'challenge') {
    const def = A[pd.action];
    const vsYou = pd.target === me;
    return `<div class="bluff-hint">${nm(pd.actor)} claims the ${R[pd.claim].name} to ${def.name}${pd.target ? (vsYou ? ' you' : ' ' + nm(pd.target)) : ''}.<small>Challenge if you think it's a bluff. Whoever is wrong loses an influence.${vsYou && def.blockers ? ' Allowing lets you block next.' : ''}</small></div>
<div class="bluff-resp">${ALLOW_BTN}${CHALLENGE_BTN}</div>`;
  }
  if (v.phase === 'block') {
    const def = A[pd.action];
    const msg = pd.action === 'aid' ? `${nm(pd.actor)} wants Foreign Aid (+2).` : pd.action === 'assassinate' ? `${nm(pd.actor)}'s Shadow is coming for you!` : `${nm(pd.actor)} will plunder up to 2 of your coins.`;
    return `<div class="bluff-hint">${msg}<small>Block by claiming ${def.blockers.map((r) => 'the ' + R[r].name).join(' or ')} — or let it happen.</small></div>
<div class="bluff-resp">${ALLOW_BTN}${def.blockers.map((r) => `<button class="blockbtn" data-do="block" data-role="${r}" style="--rc:${R[r].color}">${icon(r)} Block as ${R[r].name}${tagFor(r)}</button>`).join('')}</div>`;
  }
  if (v.phase === 'blockChallenge') {
    return `<div class="bluff-hint">${nm(pd.blocker)} claims the ${R[pd.blockRole].name} to block${pd.actor === me ? ' your' : ' ' + nm(pd.actor) + "'s"} ${A[pd.action].name}.<small>Challenge the block if you think it's a bluff.</small></div>
<div class="bluff-resp">${ALLOW_BTN}${CHALLENGE_BTN}</div>`;
  }
  if (v.phase === 'lose') {
    const sel = ui.sel && meP.cards.find((c) => c.k === ui.sel);
    return `<div class="bluff-hint">You must give up an influence<small>Tap the card to reveal. It stays face-up and no longer counts.</small></div>
<div class="bluff-resp"><button class="bad" data-do="lose"${sel ? '' : ' disabled'}>${sel ? `Reveal the ${R[sel.role].name}` : 'Choose a card'}</button></div>`;
  }
  if (v.phase === 'exchange') {
    const need = hidden(meP).length;
    const n = ui.ex.length;
    return `<div class="bluff-hint">Keep ${need} card${need > 1 ? 's' : ''}, return the rest<small>Tap cards to toggle KEEP / RETURN. Returned cards are shuffled into the deck.</small></div>
<div class="bluff-resp"><button class="primary" data-do="exchange"${n === need ? '' : ' disabled'}>${n === need ? `${uiIcon('check')}Confirm exchange` :`Select ${need - n > 0 ? need - n + ' more' : n - need + ' fewer'}`}</button></div>`;
  }
  return '';
}

function waitingText(v, me) {
  const pd = v.pending;
  const nm = (id) => esc(P(v, id)?.name || '?');
  const names = (ids) => ids.map((id) => (id === me ? 'you' : esc(short(P(v, id)?.name)))).join(', ');
  switch (v.phase) {
    case 'action': return `${nm(v.respond[0])} is choosing an action…`;
    case 'challenge': return `Waiting on ${names(v.respond)} to allow or challenge…`;
    case 'block': return pd.action === 'aid' ? `Waiting on ${names(v.respond)} — anyone may block with a Chancellor…` : `Waiting on ${names(v.respond)} to decide whether to block…`;
    case 'blockChallenge': return `Waiting on ${names(v.respond)} to accept or challenge the block…`;
    case 'lose': return `${nm(v.respond[0])} must give up an influence…`;
    case 'exchange': return `${nm(v.respond[0])} is exchanging cards with the court deck…`;
  }
  return '';
}

function statusText(v, me) {
  const pd = v.pending;
  const nm = (id) => esc(P(v, id)?.name || '?');
  if (v.over) { const w = P(v, v.winners[0]); return w ? (w.id === me ? 'You rule the court!' : `${esc(w.name)} rules the court!`) : 'The court is empty.'; }
  const mine = v.respond.includes(me);
  switch (v.phase) {
    case 'action': return mine ? 'Your move — choose an action' : `${nm(v.respond[0])}'s move`;
    case 'challenge': return mine ? `Challenge ${nm(pd.actor)}'s ${R[pd.claim].name}?` : `${nm(pd.actor)} claims the ${R[pd.claim].name}`;
    case 'block': return mine ? (pd.action === 'aid' ? `Block ${nm(pd.actor)}'s Foreign Aid?` : `${nm(pd.actor)} targets you — block?`) : 'Waiting for blocks';
    case 'blockChallenge': return mine ? `Challenge ${nm(pd.blocker)}'s block?` : `${nm(pd.blocker)} blocks as ${R[pd.blockRole].name}`;
    case 'lose': return mine ? 'Give up an influence' : `${nm(v.respond[0])} loses an influence`;
    case 'exchange': return mine ? 'Exchange your cards' : `${nm(v.respond[0])} is exchanging`;
  }
  return '';
}

function ledgerHTML(v, meP) {
  const mine = meP ? hidden(meP).map((c) => c.role) : [];
  return `<div class="bluff-ledger">${ROLES.map((r) => {
    const rev = v.players.reduce((n, p) => n + p.cards.filter((c) => c.up && c.role === r).length, 0);
    const my = v.over ? 0 : mine.filter((x) => x === r).length;
    const pips = Array.from({ length: 3 }, (_, i) => `<i class="${i < rev ? 'rev' : i < rev + my ? 'mine' : ''}"></i>`).join('');
    return `<div class="bluff-lrow"><span class="bluff-medal" style="--rc:${R[r].color};width:26px;height:26px">${icon(r)}</span><span class="nm">${R[r].name}<span class="ab">${R[r].l1.charAt(0) + R[r].l1.slice(1).toLowerCase()} · ${R[r].l2.toLowerCase()}</span></span><span class="bluff-pips" title="${rev} revealed, ${my} yours">${pips}</span></div>`;
  }).join('')}</div>
<div class="bluff-legend"><span><span class="bluff-pips"><i class="rev"></i></span>revealed</span><span><span class="bluff-pips"><i class="mine"></i></span>in your hand</span><span><span class="bluff-pips"><i></i></span>unknown</span></div>`;
}

function logHTML(v) {
  const rx = new RegExp(`\\b(${ROLES.map((r) => R[r].name).join('|')})\\b`, 'g');
  const byName = Object.fromEntries(ROLES.map((r) => [R[r].name, shade(R[r].color, 0.4)]));
  return (v.log || []).map((l) => `<div>${esc(l).replace(rx, (m) => `<b style="color:${byName[m]}">${m}</b>`)}</div>`).join('');
}

function render(el, v, ctx) {
  injectCSS('bluff', STYLE);
  last = { el, v, ctx };
  const now = performance.now();
  const fresh = prepEvents(v, now);
  const me = ctx.me;
  const meP = P(v, me);

  if (ui.gid !== v.gid || ui.turnSeq !== v.turnSeq || ui.me !== me || ui.phase !== v.phase) {
    ui = { gid: v.gid, turnSeq: v.turnSeq, me, phase: v.phase, pick: null, sel: null, ex: null };
  }
  const myAct = !v.over && v.respond.includes(me);
  if (!(v.phase === 'action' && myAct)) ui.pick = null;
  if (v.phase === 'lose' && myAct) { if (ui.sel && !meP.cards.some((c) => c.k === ui.sel && !c.up)) ui.sel = null; } else ui.sel = null;
  if (v.phase === 'exchange' && myAct && v.exchange) {
    const poolKeys = [...hidden(meP), ...v.exchange.drawn].map((c) => c.k);
    if (!ui.ex) ui.ex = hidden(meP).map((c) => c.k);
    ui.ex = ui.ex.filter((k) => poolKeys.includes(k));
  } else ui.ex = null;

  const myIdx = v.players.findIndex((p) => p.id === me);
  const opps = myIdx < 0 ? v.players.slice() : [...v.players.slice(myIdx + 1), ...v.players.slice(0, myIdx)];
  const pickable = ui.pick ? opps.filter((p) => isAlive(p) && (ui.pick !== 'plunder' || p.coins > 0)).map((p) => p.id) : [];
  // Whose purse grew since the last render? Their seat glows once as the coins land.
  const gained = new Set(v.players.filter((p) => { const had = prevCoins.get(v.gid + '|' + p.id); return had != null && p.coins > had; }).map((p) => p.id));
  prevCoins = new Map(v.players.map((p) => [v.gid + '|' + p.id, p.coins]));
  // The card just tapped lifts (or drops) with a short spring; other redraws leave it still.
  const tapped = ui.tapped;
  ui.tapped = null;
  const st = { now, pickable, ctx, gained, tapped };
  const sMine = myAct;
  const revealed = v.players.reduce((n, p) => n + p.cards.filter((c) => c.up).length, 0);

  el.innerHTML = `${DEFS}
<div class="game-layout bluff">
  <div class="bluff-board">
    <div class="felt bluff-table" data-a="table">
      <div class="bluff-glow" aria-hidden="true"></div>
      <button class="small bluff-refbtn" data-do="ref" title="Role reference" aria-label="Role reference">${uiIcon('book')}<span>Roles</span></button>
      <div class="bluff-opps n${opps.length}">${opps.map((p) => seatHTML(v, p, st)).join('')}</div>
      <div class="bluff-center">${treasuryHTML()}<div class="bluff-stage">${stageHTML(v, me, ctx)}</div>${deckHTML(v, now)}</div>
      ${meP ? mineHTML(v, meP, st) : ''}
      <div class="bluff-ctrl">${controlsHTML(v, meP, ctx)}</div>
    </div>
  </div>
  <div class="side bluff-side">
    <div class="panel bluff-statuspanel"><div class="status${sMine ? ' myturn' : ''}">${statusText(v, me)}</div>
      <div class="small muted bluff-round">${v.over ? 'All cards are now face-up.' : `Round ${Math.max(1, Math.ceil(v.turnSeq / Math.max(1, v.players.length)))} · ${alive(v).length} courtiers remain`}</div>
      <button class="small bluff-refside" data-do="ref">${uiIcon('book')}Role reference</button></div>
    <details class="panel drawer bluff-ledgerbox" ${ledgerOpen ? 'open' : ''}><summary>${uiIcon('eye')}<span>Court Ledger</span><span class="note">${revealed} of 15 revealed</span>${uiIcon('chevron', 'chev')}</summary>
      <div class="drawer-body">${ledgerHTML(v, meP)}</div></details>
    <details class="panel drawer bluff-chronicle" ${chronOpen ? 'open' : ''}><summary>${uiIcon('clock')}<span>Chronicle</span><span class="note">${esc(v.log?.[0] || '')}</span>${uiIcon('chevron', 'chev')}</summary>
      <div class="drawer-body"><div class="log bluff-log">${logHTML(v)}</div></div></details>
  </div>
</div>`;
  // <details> toggle events don't bubble, so listen on each drawer after it is drawn.
  el.querySelector('.bluff-ledgerbox')?.addEventListener('toggle', (e) => { ledgerOpen = e.currentTarget.open; });
  el.querySelector('.bluff-chronicle')?.addEventListener('toggle', (e) => { chronOpen = e.currentTarget.open; });

  el.onclick = (e) => {
    const t = e.target.closest('[data-do]');
    if (!t || t.disabled || !el.contains(t)) return;
    const d = t.dataset.do;
    if (d === 'ref') { sound('click'); openRef(); return; }
    if (d === 'act') { sound('click'); ctx.send({ type: 'act', action: t.dataset.action }); return; }
    if (d === 'pick') {
      sound('click');
      const action = t.dataset.action;
      const cands = alive(v).filter((p) => p.id !== me && (action !== 'plunder' || p.coins > 0));
      if (cands.length === 1) { ctx.send({ type: 'act', action, target: cands[0].id }); return; }
      ui.pick = action;
      return rerender();
    }
    if (d === 'cancel') { sound('click'); ui.pick = null; return rerender(); }
    if (d === 'target') { if (!ui.pick) return; const action = ui.pick; ui.pick = null; sound('click'); ctx.send({ type: 'act', action, target: t.dataset.pid }); return; }
    if (d === 'allow') { sound('click'); ctx.send({ type: 'allow' }); return; }
    if (d === 'challenge') { ctx.send({ type: 'challenge' }); return; }
    if (d === 'block') { sound('click'); ctx.send({ type: 'block', role: t.dataset.role }); return; }
    if (d === 'sel') { sound('click'); ui.sel = ui.tapped = t.dataset.k; return rerender(); }
    if (d === 'lose') { if (ui.sel) { sound('click'); ctx.send({ type: 'lose', card: ui.sel }); } return; }
    if (d === 'ex') {
      sound('click');
      const k = t.dataset.k;
      const need = hidden(meP).length;
      ui.tapped = k;
      if (ui.ex.includes(k)) ui.ex = ui.ex.filter((x) => x !== k);
      else { ui.ex = ui.ex.concat(k); if (ui.ex.length > need) ui.ex = ui.ex.slice(ui.ex.length - need); }
      return rerender();
    }
    if (d === 'exchange') { if (ui.ex && ui.ex.length === hidden(meP).length) { sound('click'); ctx.send({ type: 'exchange', keep: ui.ex }); } return; }
  };
  el.onkeydown = (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"][data-do]')) { e.preventDefault(); e.target.click(); }
  };

  if (fresh.length) playEvents(fresh, v, me);
}
function rerender() {
  if (last && last.el.isConnected) render(last.el, last.v, last.ctx);
}

/* ---------- event playback (banners, stamps, slashes) ---------- */
function tableRect() {
  const t = document.querySelector('.bluff-table');
  const vw = innerWidth, vh = innerHeight;
  if (!t) return { x: vw / 2, y: vh / 2 };
  const r = t.getBoundingClientRect();
  const top = Math.max(r.top, 60), bottom = Math.min(r.bottom, vh);
  const left = Math.max(r.left, 0), right = Math.min(r.right, vw);
  if (bottom - top < 160) return { x: vw / 2, y: vh / 2 };
  return { x: (left + right) / 2, y: (top + bottom) / 2 };
}
function anchorRect(name) {
  const el = document.querySelector(`[data-a="${CSS.escape(name)}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
}
function spawn(cls, html, x, y, ms, style = '') {
  const d = document.createElement('div');
  d.className = 'bluff-ov';
  d.innerHTML = `<div class="${cls}" style="left:${x}px;top:${y}px;${style}">${html}</div>`;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), ms);
  return d;
}
let bannerEl = null;
function banner({ color, icon: ic, who, big, sub }) {
  if (bannerEl) bannerEl.remove();
  const c = tableRect();
  bannerEl = spawn('bluff-bannerwrap', `<div class="bluff-banner" style="--rc:${color};--rd:${shade(color, -0.6)}"><div class="bb-medal">${icon(ic)}</div><div class="bb-t"><div class="bb-who">${who}</div><div class="bb-big">${big}</div>${sub ? `<div class="bb-sub">${sub}</div>` : ''}</div></div>`, c.x, c.y, 2150);
}
function stamp(text, sub, ink) {
  if (bannerEl) { bannerEl.remove(); bannerEl = null; }
  const c = tableRect();
  spawn('bluff-stamp', `<b>${text}</b>${sub ? `<small>${sub}</small>` : ''}`, c.x, c.y, 1600, `--ink:${ink}`);
}
function shakeEl(el, amp = 10) {
  el?.animate([0, -amp, amp, -amp * 0.7, amp * 0.7, -amp * 0.3, 0].map((x) => ({ transform: `translateX(${x}px)` })), { duration: 480, easing: 'ease-out' });
}
function playEvents(list, v, me) {
  const nm = (id) => (id === me ? 'You' : esc(P(v, id)?.name || '?'));
  for (const e of list) {
    setTimeout(() => {
      try { playEv(e, v, me, nm); } catch (err) { console.warn('bluff fx', err); }
    }, e.at || 0);
  }
}
function playEv(e, v, me, nm) {
  const you = e.pid === me;
  switch (e.t) {
    case 'claim': {
      const def = A[e.action];
      banner({ color: R[e.role].color, icon: e.role, who: `${nm(e.pid)} ${you ? 'claim' : 'claims'}`, big: R[e.role].name, sub: `${def.name}${e.target ? ' → ' + nm(e.target) : ''} · ${def.sub}` });
      sound('card');
      setTimeout(() => sound('turn'), 120);
      break;
    }
    case 'act': {
      const def = A[e.action];
      if (e.action === 'coup') {
        banner({ color: '#a8202c', icon: 'coup', who: `${nm(e.pid)} ${you ? 'stage' : 'stages'} a`, big: 'Coup', sub: `against ${nm(e.target)} · unstoppable` });
        sound('bad');
      } else {
        banner({ color: COIN_HUE, icon: e.action, who: `${nm(e.pid)} ${you ? 'take' : 'takes'}`, big: def.name, sub: e.action === 'aid' ? '+2 coins · a Chancellor may block' : '+1 coin · cannot be stopped' });
        sound('card');
      }
      break;
    }
    case 'block':
      banner({ color: R[e.role].color, icon: e.role, who: `${nm(e.pid)} ${you ? 'block' : 'blocks'} with the`, big: R[e.role].name, sub: `stopping ${e.actor === me ? 'your' : nm(e.actor) + "'s"} ${A[e.action].name}` });
      sound('build');
      setTimeout(() => sound('place'), 120);
      break;
    case 'challenge': {
      stamp('CHALLENGE!', `${nm(e.pid)} ${you ? 'doubt' : 'doubts'} ${e.target === me ? 'you' : nm(e.target)}`, '#e02a2e');
      sound('place');
      setTimeout(() => sound('bad'), 140);
      setTimeout(() => shakeEl(document.querySelector('.bluff-table'), 12), 180);
      break;
    }
    case 'proof': {
      const c = tableRect();
      if (e.ok) {
        const html = `<div class="bluff-card" style="--cw:min(150px,34vw)"><div class="bluff-card-in"><div class="bluff-face front">${faceSVG(e.role)}</div><div class="bluff-face back">${BACK_SVG}</div></div></div><div class="bluff-proof-cap">${nm(e.pid)} ${you ? 'had' : 'had'} the ${R[e.role].name}!</div>`;
        const ov = spawn('bluff-proof', html, c.x, c.y, 2300);
        sound('flip');
        setTimeout(() => sound('chime'), 500);
        const deck = anchorRect('deck');
        if (deck) {
          setTimeout(() => {
            const inner = ov.firstElementChild;
            inner.animate([{ transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }, { transform: `translate(calc(-50% + ${deck.x - c.x}px), calc(-50% + ${deck.y - c.y}px)) scale(.3)`, opacity: 0.2 }], { duration: 550, easing: 'cubic-bezier(.5,0,.3,1)', fill: 'forwards' });
            sound('shuffle');
          }, 1650);
        }
      } else {
        stamp('BLUFF!', `${nm(e.pid)} had no ${R[e.role].name}`, '#b05cd6');
        sound('bad');
        setTimeout(() => shakeEl(document.querySelector(`[data-a="p-${CSS.escape(e.pid)}-seat"]`), 9), 150);
      }
      break;
    }
    case 'slash': {
      const r = anchorRect(`p-${e.pid}-seat`);
      if (!r) break;
      const sz = Math.max(r.w, r.h) * 1.25;
      spawn('bluff-slash', `<svg viewBox="0 0 200 200">
<defs><radialGradient id="bw-slfl" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ff3a3a" stop-opacity=".7"/><stop offset="1" stop-color="#ff0000" stop-opacity="0"/></radialGradient></defs>
<circle class="fl" cx="100" cy="100" r="100" fill="url(#bw-slfl)"/>
<path class="sl" d="M175 22L25 178" stroke="#ff2a2a" stroke-width="16" opacity=".55"/>
<path class="sl" d="M175 22L25 178" stroke="#fff6f0" stroke-width="5"/>
<path class="sl" d="M150 14L40 132" stroke="#ff6a6a" stroke-width="3" style="animation-delay:.2s,.85s"/>
<g class="dg"><g transform="translate(100 100) rotate(-135) scale(1.6)" fill="#e8ecf2" stroke="#2a2e35" stroke-width=".8"><path d="M0-34L4-26V6H-4V-26Z"/><rect x="-12" y="6" width="24" height="5" rx="2" fill="#e2ac3e"/><rect x="-3" y="11" width="6" height="14" fill="#5a1220"/><circle cy="28" r="4" fill="#e2ac3e"/></g></g>
</svg>`, r.x, r.y, 1500, `width:${sz}px;height:${sz}px`);
      sound('steal');
      setTimeout(() => sound('bad'), 180);
      setTimeout(() => shakeEl(document.querySelector(`[data-a="p-${CSS.escape(e.pid)}-seat"]`), 10), 220);
      break;
    }
    case 'coup': {
      const r = anchorRect(`p-${e.pid}-seat`);
      if (!r) break;
      setTimeout(() => {
        spawn('bluff-seal', `<svg viewBox="0 0 120 120"><path d="${blob(60, 60, 50, 18, 3, 1.3)}" fill="url(#bw-wax)" stroke="#3a0408" stroke-width="2"/><circle cx="60" cy="60" r="38" fill="none" stroke="#5a0610" stroke-width="3"/><circle cx="59" cy="59" r="38" fill="none" stroke="#ff9a9a" stroke-opacity=".3" stroke-width="1"/>
<g transform="translate(42 26) scale(1.5)" fill="#6a0812" stroke="#ff9a9a" stroke-opacity=".4" stroke-width=".6">${ICON.chancellor}</g>
<text x="60" y="88" text-anchor="middle" font-family="Cinzel, Georgia, serif" font-weight="800" font-size="17" letter-spacing="2" fill="#ffd9cf">COUP</text></svg>`, r.x, r.y, 1700);
        sound('place');
        setTimeout(() => sound('build'), 90);
        shakeEl(document.querySelector(`[data-a="p-${CSS.escape(e.pid)}-seat"]`), 12);
      }, 250);
      break;
    }
    case 'lose':
      setTimeout(() => sound('flip'), 0);
      setTimeout(() => sound('bad'), 650);
      break;
    case 'out': {
      const r = anchorRect(`p-${e.pid}-seat`);
      setTimeout(() => {
        if (r) spawn('bluff-tagov', you ? 'YOU ARE BANISHED' : 'BANISHED', r.x, r.y, 2100);
        sound('bad');
      }, 700);
      break;
    }
    case 'stopped': {
      const r = anchorRect(`p-${e.pid}-seat`);
      if (r) spawn('bluff-tagov good', 'BLOCKED', r.x, r.y, 2100);
      sound('build');
      break;
    }
    case 'draw':
    case 'shuffle':
      sound('shuffle');
      break;
  }
}

/* ---------- role reference modal ---------- */
function openRef() {
  if (document.querySelector('.bluff-refbg')) return;
  const bg = document.createElement('div');
  bg.className = 'modal-bg bluff-refbg';
  bg.innerHTML = `<div class="modal panel bluff-ref" role="dialog" aria-label="Court roles">
<button class="icon-btn bluff-refx" data-close aria-label="Close">${uiIcon('close')}</button>
<h2>The Court</h2>
<p class="small muted" style="margin:6px 0 0">15 cards: three of each role. Claim any role — truthfully or not.</p>
<div class="bluff-ref-grid">${ROLES.map((r) => `<div class="bluff-ref-role" style="--rc:${R[r].color}">${staticCard(r, '76px')}<div><h3 style="color:${shade(R[r].color, 0.4)}">${R[r].name}</h3><p>${R[r].act}</p><p class="b">${R[r].blk}</p></div></div>`).join('')}</div>
<h3 class="gold">Common actions</h3>
<ul><li><b>Income</b> — take 1 coin. Can't be blocked or challenged.</li><li><b>Foreign Aid</b> — take 2 coins. Anyone claiming the Chancellor may block.</li><li><b>Coup</b> — pay 7: a rival loses an influence. Unstoppable. Mandatory with 10+ coins.</li></ul>
<h3 class="gold">Challenges</h3>
<ul><li>Any claim (action or block) may be challenged by any other player.</li><li>If the claimer has the card, the challenger loses an influence; the card is shuffled away and replaced.</li><li>If not, the claimer loses an influence and the claim fails.</li><li>Assassination coins are spent even if blocked, but refunded if the Shadow is exposed.</li></ul>
<p class="small muted">Lose both influences and you are banished. The last courtier standing wins.</p>
</div>`;
  bg.addEventListener('click', (e) => {
    if (e.target === bg || e.target.closest('[data-close]')) { sound('click'); bg.remove(); }
  });
  document.body.appendChild(bg);
}

/* ============================================================
   Module
   ============================================================ */
export default {
  id: 'bluff',
  name: 'Court of Whispers',
  emoji: '🎭',
  description: 'A candlelit court of masks and lies. Claim any role, call out liars, and be the last courtier with influence left.',
  minPlayers: 2,
  maxPlayers: 6,
  cover: COVER,
  howTo: {
    goal: 'Be the <b>last courtier standing</b>. Everyone starts with 2 secret role cards (your "influence") and 2 coins. Lose both cards and you are out.',
    turn: [
      ['🪙', 'Take a safe action', '<b>Income</b> +1 coin (can\'t be stopped) or <b>Foreign Aid</b> +2 coins (a Chancellor can block it).'],
      ['🎭', 'Or claim a role (you may bluff!)', '<b>Chancellor</b> Levy +3 coins · <b>Shadow</b> pay 3 to make a rival lose a card · <b>Corsair</b> steal up to 2 coins · <b>Envoy</b> swap cards with the deck. You don\'t need to really hold the card.'],
      ['⚔️', 'Or launch a Coup', 'Pay 7 coins: a rival loses a card, and nobody can stop it. With 10+ coins you must Coup.'],
      ['❗', 'Others respond', 'Anyone can <b>Challenge</b> a claim. If the claimer had the card, the challenger loses a card; if not, the bluffer loses one. Some actions can be <b>blocked</b> by claiming a role too.'],
    ],
    tips: [
      '<b>Blocks:</b> Duchess blocks the Shadow · Chancellor blocks Foreign Aid · Corsair or Envoy block a Corsair\'s steal. Blocks can be challenged as well.',
      'When you lose a card, you choose which one to reveal. Revealed cards are out of play for good.',
      'Watch the Court Ledger: if all 3 copies of a role are revealed, nobody can truly hold it.',
      'Your action buttons say <b>HELD</b> or <b>BLUFF</b> so you always know which claims are honest.',
    ],
  },

  setup(players) {
    const deck = shuffle(ROLES.flatMap((r) => [r, r, r]));
    const s = {
      gid: Math.random().toString(36).slice(2, 10),
      phase: 'action',
      players: players.map((pl, i) => ({ id: pl.id, name: pl.name, coins: 2, out: false, claims: [], cards: [0, 1].map((j) => ({ k: `h${i}${j}`, role: deck.pop(), up: false })) })),
      deck,
      drawSeq: 0,
      turn: rand(players.length),
      turnSeq: 1,
      pending: null,
      respond: [],
      allowed: [],
      losses: [],
      after: null,
      exchange: null,
      returned: [],
      log: [],
      fx: [],
      fxSeq: 0,
      ev: [],
      evSeq: 0,
      over: false,
      winners: [],
    };
    s.respond = [s.players[s.turn].id];
    log(s, `The court assembles by candlelight. ${s.players[s.turn].name} speaks first.`);
    return s;
  },

  act(s, pid, a) {
    if (s.over) throw new Error('The game is over.');
    const p = P(s, pid);
    if (!p) throw new Error('You are not seated at this court.');
    if (!a || typeof a !== 'object') throw new Error('Unknown move.');
    if (!s.respond.includes(pid)) {
      throw new Error(s.phase === 'action' ? 'It is not your turn.' : WINDOWS.includes(s.phase) && s.allowed.includes(pid) ? 'You have already responded.' : 'You cannot act right now.');
    }
    s.returned = [];
    switch (s.phase) {
      case 'action':
        if (a.type !== 'act') throw new Error('Choose an action.');
        return declare(s, p, a);
      case 'challenge':
      case 'blockChallenge':
        if (a.type === 'allow') return allow(s, pid);
        if (a.type === 'challenge') return doChallenge(s, p);
        throw new Error('Allow or challenge the claim.');
      case 'block':
        if (a.type === 'allow') return allow(s, pid);
        if (a.type === 'block') return doBlock(s, p, a.role);
        throw new Error('Allow it, or block it.');
      case 'lose':
        if (a.type !== 'lose') throw new Error('Choose an influence to give up.');
        return doLose(s, p, a.card);
      case 'exchange':
        if (a.type !== 'exchange') throw new Error('Choose which cards to keep.');
        return doExchange(s, p, a.keep);
    }
    throw new Error('Nothing to do right now.');
  },

  turnOf(s) {
    return s.over ? [] : (s.respond || []).slice();
  },

  view(s, pid) {
    const v = JSON.parse(JSON.stringify(s));
    v.deckCount = s.deck.length;
    v.deck = [];
    if (!s.over) {
      for (const p of v.players) if (p.id !== pid) for (const c of p.cards) if (!c.up) c.role = null;
      if (v.exchange && v.exchange.pid !== pid) for (const c of v.exchange.drawn) c.role = null;
    }
    return v;
  },

  bot,
  render,
};
