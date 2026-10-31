// Isle of Hexes — settle a hex island, trade with rivals and race to 10 victory points.
// Rules, bot and rendering all live in this one module (see GAME_GUIDE.md).

import { esc, rand, shuffle, d6, log, addFx } from '../js/util.js';
import { injectCSS, dieHTML, rollDice, changed, morph } from '../js/fx.js';
import { sound } from '../js/sound.js';
import { icon } from '../js/icons.js';
import { portrait } from '../js/avatar.js';
import { levelOption, levelOf } from '../js/levels.js';

const ID = 'hexisle';
const RES = ['lumber', 'brick', 'wool', 'grain', 'ore'];
const RES_NAME = { lumber: 'Lumber', brick: 'Brick', wool: 'Wool', grain: 'Grain', ore: 'Ore' };
const TER = { forest: 'lumber', hills: 'brick', pasture: 'wool', fields: 'grain', mountains: 'ore', desert: null };
const TER_NAME = { forest: 'Forest', hills: 'Hills', pasture: 'Pasture', fields: 'Fields', mountains: 'Mountains', desert: 'Desert' };
const COST = {
  road: { lumber: 1, brick: 1 },
  settlement: { lumber: 1, brick: 1, wool: 1, grain: 1 },
  city: { grain: 2, ore: 3 },
  dev: { wool: 1, grain: 1, ore: 1 },
};
const LIMIT = { road: 15, settlement: 5, city: 4 };
const DEV = {
  knight: { name: 'Knight', desc: 'Move the robber and steal a card.' },
  vp: { name: 'Victory Point', desc: 'Worth 1 VP. Counted automatically.' },
  road: { name: 'Road Building', desc: 'Build 2 roads for free.' },
  plenty: { name: 'Year of Plenty', desc: 'Take any 2 resources from the bank.' },
  monopoly: { name: 'Monopoly', desc: 'Take every card of one resource from all opponents.' },
};
const BANK_START = 19;
const WIN_VP = 10;
const pipsOf = (n) => (n ? 6 - Math.abs(7 - n) : 0);
const rep = (x, n) => Array.from({ length: n }, () => x);
const zeroRes = () => ({ lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0 });
const total = (res) => (res ? RES.reduce((a, r) => a + (res[r] || 0), 0) : 0);
const hasRes = (res, cost) => RES.every((r) => (res[r] || 0) >= (cost[r] || 0));

/* ---------------- geometry (pointy-top hexes, axial radius 2) ---------------- */
const HR = 60, SQ3 = Math.sqrt(3);
const HEXES = [], VERTS = [], EDGES = [], HARBOR_SPOTS = [];
(() => {
  const vIndex = new Map(), eIndex = new Map();
  const vid = (x, y) => {
    const k = Math.round(x) + ',' + Math.round(y);
    if (!vIndex.has(k)) {
      vIndex.set(k, VERTS.length);
      VERTS.push({ x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, hexes: [], adj: [], edges: [] });
    }
    return vIndex.get(k);
  };
  for (let r = -2; r <= 2; r++) for (let q = -2; q <= 2; q++) {
    if (Math.abs(q + r) > 2) continue;
    const x = HR * SQ3 * (q + r / 2), y = HR * 1.5 * r;
    const h = { q, r, x, y, v: [], e: [], nb: [] };
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 180) * (60 * i - 90);
      h.v.push(vid(x + HR * Math.cos(a), y + HR * Math.sin(a)));
    }
    HEXES.push(h);
  }
  HEXES.forEach((h, hi) => {
    h.v.forEach((v) => VERTS[v].hexes.push(hi));
    for (let i = 0; i < 6; i++) {
      const a = Math.min(h.v[i], h.v[(i + 1) % 6]), b = Math.max(h.v[i], h.v[(i + 1) % 6]);
      const k = a + '-' + b;
      if (!eIndex.has(k)) {
        const ei = EDGES.length;
        eIndex.set(k, ei);
        EDGES.push({ a, b, hexes: [], x: (VERTS[a].x + VERTS[b].x) / 2, y: (VERTS[a].y + VERTS[b].y) / 2 });
        VERTS[a].adj.push(b); VERTS[b].adj.push(a);
        VERTS[a].edges.push(ei); VERTS[b].edges.push(ei);
      }
      const ei = eIndex.get(k);
      EDGES[ei].hexes.push(hi);
      h.e.push(ei);
    }
  });
  HEXES.forEach((h, i) => HEXES.forEach((o, j) => { if (i !== j && Math.hypot(h.x - o.x, h.y - o.y) < HR * 2) h.nb.push(j); }));
  // 9 harbors spread evenly round the 30 coastal edges
  const coast = EDGES.map((e, i) => i).filter((i) => EDGES[i].hexes.length === 1)
    .sort((i, j) => Math.atan2(EDGES[i].y, EDGES[i].x) - Math.atan2(EDGES[j].y, EDGES[j].x));
  for (let k = 0; k < 9; k++) {
    const ei = coast[Math.round((k * coast.length) / 9 + 1) % coast.length];
    const e = EDGES[ei], h = HEXES[e.hexes[0]];
    const dx = e.x - h.x, dy = e.y - h.y, len = Math.hypot(dx, dy);
    HARBOR_SPOTS.push({ e: ei, nx: dx / len, ny: dy / len });
  }
})();

const validV = (v) => Number.isInteger(v) && v >= 0 && v < VERTS.length;
const validE = (e) => Number.isInteger(e) && e >= 0 && e < EDGES.length;
const validH = (h) => Number.isInteger(h) && h >= 0 && h < HEXES.length;
const curId = (s) => s.order[s.cur];
const nameOf = (s, pid) => s.ps[pid]?.name || '???';

function makeBoard() {
  const ts = shuffle([...rep('forest', 4), ...rep('hills', 3), ...rep('pasture', 4), ...rep('fields', 4), ...rep('mountains', 3), 'desert']);
  const tokens = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];
  let hexes;
  for (let tries = 0; tries < 5000; tries++) {
    shuffle(tokens);
    let k = 0;
    hexes = ts.map((t) => ({ t, n: t === 'desert' ? 0 : tokens[k++] }));
    const hot = (i) => hexes[i].n === 6 || hexes[i].n === 8;
    if (HEXES.every((h, i) => !hot(i) || h.nb.every((j) => !hot(j)))) break;
  }
  return hexes;
}

/* ---------------- rule helpers ---------------- */
function used(s, pid) {
  const u = { road: 0, settlement: 0, city: 0 };
  s.rd.forEach((o) => { if (o === pid) u.road++; });
  s.vb.forEach((b) => { if (b && b.p === pid) u[b.city ? 'city' : 'settlement']++; });
  return u;
}
function canSettle(s, pid, v, setup) {
  if (!validV(v) || s.vb[v]) return false;
  if (VERTS[v].adj.some((a) => s.vb[a])) return false;
  if (setup) return true;
  if (used(s, pid).settlement >= LIMIT.settlement) return false;
  return VERTS[v].edges.some((e) => s.rd[e] === pid);
}
function canRoad(s, pid, e) {
  if (!validE(e) || s.rd[e] !== null) return false;
  const E = EDGES[e];
  return [E.a, E.b].some((v) => {
    const b = s.vb[v];
    if (b && b.p === pid) return true;
    if (b && b.p !== pid) return false;
    return VERTS[v].edges.some((x) => x !== e && s.rd[x] === pid);
  });
}
function roadSpots(s, pid) {
  if (used(s, pid).road >= LIMIT.road) return [];
  const out = [];
  for (let e = 0; e < EDGES.length; e++) if (canRoad(s, pid, e)) out.push(e);
  return out;
}
function settleSpots(s, pid, setup) {
  const out = [];
  for (let v = 0; v < VERTS.length; v++) if (canSettle(s, pid, v, setup)) out.push(v);
  return out;
}
function harborAt(s, v) {
  return s.harbors.filter((h) => EDGES[h.e].a === v || EDGES[h.e].b === v);
}
function rates(s, pid) {
  const r = {};
  RES.forEach((x) => (r[x] = 4));
  for (const h of s.harbors) {
    const e = EDGES[h.e];
    if (![e.a, e.b].some((v) => s.vb[v] && s.vb[v].p === pid)) continue;
    if (h.t === 'any') RES.forEach((x) => (r[x] = Math.min(r[x], 3)));
    else r[h.t] = 2;
  }
  return r;
}
function vpOf(s, pid, withHidden = true) {
  let v = 0;
  s.vb.forEach((b) => { if (b && b.p === pid) v += b.city ? 2 : 1; });
  if (s.longest === pid) v += 2;
  if (s.army === pid) v += 2;
  const d = s.ps[pid].dev;
  if (withHidden && d) v += d.filter((c) => c.t === 'vp').length;
  return v;
}
function longestFor(s, pid) {
  const usedE = new Array(EDGES.length).fill(false);
  let best = 0;
  const dfs = (v, len) => {
    if (len > best) best = len;
    const b = s.vb[v];
    if (b && b.p !== pid) return; // an opponent's building breaks the road
    for (const e of VERTS[v].edges) {
      if (s.rd[e] !== pid || usedE[e]) continue;
      usedE[e] = true;
      dfs(EDGES[e].a === v ? EDGES[e].b : EDGES[e].a, len + 1);
      usedE[e] = false;
    }
  };
  for (let e = 0; e < EDGES.length; e++) {
    if (s.rd[e] !== pid) continue;
    for (const [from, to] of [[EDGES[e].a, EDGES[e].b], [EDGES[e].b, EDGES[e].a]]) {
      usedE[e] = true;
      dfs(to, 1);
      usedE[e] = false;
      void from;
    }
  }
  return best;
}
function updateLongest(s) {
  const L = {};
  s.order.forEach((p) => (L[p] = longestFor(s, p)));
  s.roadLen = L;
  const h = s.longest;
  const max = Math.max(...Object.values(L));
  let next;
  if (h && L[h] >= 5 && L[h] >= max) next = h;
  else if (max < 5) next = null;
  else {
    const tops = s.order.filter((p) => L[p] === max);
    next = tops.length === 1 ? tops[0] : h && tops.includes(h) ? h : null;
  }
  if (next === h) return;
  s.longest = next;
  if (next) {
    log(s, `${nameOf(s, next)} takes the Longest Road (${L[next]}).`);
    addFx(s, { kind: 'float', at: `p-${next}-vp`, text: '+2 VP Longest Road', color: '#ffd76a', delay: 500, sound: 'chime' });
  } else log(s, `${nameOf(s, h)} loses the Longest Road.`);
}
function updateArmy(s, pid) {
  const k = s.ps[pid].knights;
  if (k < 3 || s.army === pid) return;
  if (s.army && s.ps[s.army].knights >= k) return;
  s.army = pid;
  log(s, `${nameOf(s, pid)} takes the Largest Army (${k} knights).`);
  addFx(s, { kind: 'float', at: `p-${pid}-vp`, text: '+2 VP Largest Army', color: '#ffd76a', delay: 600, sound: 'chime' });
}
function checkWin(s) {
  if (s.over || s.phase === 'setup') return;
  const pid = curId(s);
  const vp = vpOf(s, pid);
  if (vp >= WIN_VP) {
    s.over = true;
    s.phase = 'over';
    s.winners = [pid];
    s.trade = null;
    log(s, `${nameOf(s, pid)} wins with ${vp} victory points!`);
  }
}

/* ---------------- card movement (with effects) ---------------- */
function resMap(m) {
  if (!m || typeof m !== 'object') throw new Error('Choose some cards.');
  const o = zeroRes();
  let n = 0;
  for (const r of RES) {
    const v = m[r] ?? 0;
    if (!Number.isInteger(v) || v < 0 || v > BANK_START) throw new Error('Bad card count.');
    o[r] = v;
    n += v;
  }
  return [o, n];
}
function pay(s, pid, cost, fx = true) {
  const P = s.ps[pid];
  if (!hasRes(P.res, cost)) throw new Error("You don't have enough resources.");
  let d = 0;
  for (const r of RES) {
    const n = cost[r] || 0;
    if (!n) continue;
    P.res[r] -= n;
    s.bank[r] += n;
    if (fx) { addFx(s, { from: `p-${pid}-hand`, to: `bank-${r}`, html: cardHTML(r, true), n, size: [24, 34], delay: d }); d += 90 * n; }
  }
}
function gain(s, pid, r, n, from, delay = 0) {
  const k = Math.min(n, s.bank[r]);
  if (k <= 0) return 0;
  s.bank[r] -= k;
  s.ps[pid].res[r] += k;
  addFx(s, { from: from || `bank-${r}`, to: `p-${pid}-hand`, html: cardHTML(r, true), n: k, size: [26, 36], delay, sound: 'card' });
  return k;
}

function produce(s, roll) {
  const per = [];
  const demand = zeroRes();
  s.hexes.forEach((hx, i) => {
    if (hx.n !== roll || i === s.robber) return;
    const r = TER[hx.t];
    HEXES[i].v.forEach((v) => {
      const b = s.vb[v];
      if (!b) return;
      const n = b.city ? 2 : 1;
      const g = per.find((x) => x.h === i && x.p === b.p);
      if (g) g.n += n; else per.push({ h: i, p: b.p, r, n });
      demand[r] += n;
    });
  });
  const short = RES.filter((r) => demand[r] > s.bank[r]);
  short.forEach((r) => log(s, `The bank ran out of ${RES_NAME[r].toLowerCase()} — nobody gets any.`));
  let delay = 1250;
  const got = {};
  for (const g of per) {
    if (short.includes(g.r)) continue;
    gain(s, g.p, g.r, g.n, `hex-${g.h}`, delay);
    delay += 160 + 90 * g.n;
    got[g.p] = got[g.p] || [];
    got[g.p].push(`${g.n} ${RES_NAME[g.r].toLowerCase()}`);
  }
  Object.keys(got).forEach((p) => log(s, `${nameOf(s, p)} collects ${got[p].join(', ')}.`));
  if (!per.length) log(s, 'Nothing is produced.');
}

/* ---------------- actions ---------------- */
function setupSettle(s, pid, v) {
  if (!canSettle(s, pid, v, true)) throw new Error('Too close to another building, or the spot is taken.');
  s.vb[v] = { p: pid, city: false };
  s.last = v;
  s.sub = 'road';
  addFx(s, { kind: 'sound', sound: 'build' });
  log(s, `${nameOf(s, pid)} founds a settlement.`);
  if (s.step >= s.order.length) {
    let d = 500;
    VERTS[v].hexes.forEach((h) => {
      const r = TER[s.hexes[h].t];
      if (r && gain(s, pid, r, 1, `hex-${h}`, d)) d += 220;
    });
  }
}
function setupRoad(s, pid, e) {
  if (!validE(e) || s.rd[e] !== null) throw new Error('Pick a free road spot.');
  const E = EDGES[e];
  if (E.a !== s.last && E.b !== s.last) throw new Error('The road must touch the settlement you just placed.');
  s.rd[e] = pid;
  addFx(s, { kind: 'sound', sound: 'place' });
  s.step++;
  s.last = -1;
  const n = s.order.length;
  updateLongest(s);
  if (s.step >= 2 * n) {
    s.phase = 'roll';
    s.sub = '';
    s.cur = 0;
    s.turn = 1;
    log(s, `Setup complete. ${nameOf(s, curId(s))} rolls first.`);
  } else {
    s.cur = s.step < n ? s.step : 2 * n - 1 - s.step;
    s.sub = 'settle';
  }
}
function doRoll(s, pid) {
  const a = d6(), b = d6(), sum = a + b;
  s.dice = [a, b];
  s.rollSeq++;
  s.lastRoll = sum;
  log(s, `${nameOf(s, pid)} rolled ${sum}.`);
  if (sum === 7) {
    s.discard = {};
    s.order.forEach((p) => { const n = total(s.ps[p].res); if (n > 7) s.discard[p] = Math.floor(n / 2); });
    s.after = 'main';
    s.phase = Object.keys(s.discard).length ? 'discard' : 'robber';
    addFx(s, { kind: 'shake', at: 'robber', delay: 1100, sound: 'bad' });
    if (s.phase === 'discard') log(s, `Robber! ${Object.keys(s.discard).map((p) => nameOf(s, p)).join(', ')} must discard half.`);
  } else {
    produce(s, sum);
    s.phase = 'main';
  }
}
function doDiscard(s, pid, cards) {
  const need = s.discard[pid];
  if (!need) throw new Error('You do not need to discard.');
  const [c, n] = resMap(cards);
  if (n !== need) throw new Error(`Discard exactly ${need} cards.`);
  const P = s.ps[pid];
  if (!hasRes(P.res, c)) throw new Error("You don't have those cards.");
  RES.forEach((r) => { P.res[r] -= c[r]; s.bank[r] += c[r]; });
  delete s.discard[pid];
  addFx(s, { from: `p-${pid}-hand`, to: 'hexisle-bank', html: cardBackHTML(), n: Math.min(n, 5), size: [24, 34], sound: 'card' });
  log(s, `${nameOf(s, pid)} discards ${n} cards.`);
  if (!Object.keys(s.discard).length) s.phase = 'robber';
}
function moveRobber(s, pid, h) {
  if (!validH(h)) throw new Error('Pick a hex for the robber.');
  if (h === s.robber) throw new Error('The robber must move to a different hex.');
  s.robber = h;
  addFx(s, { kind: 'sound', sound: 'place', delay: 350 });
  log(s, `${nameOf(s, pid)} moves the robber to the ${TER_NAME[s.hexes[h].t]}${s.hexes[h].n ? ' (' + s.hexes[h].n + ')' : ''}.`);
  const vict = [];
  HEXES[h].v.forEach((v) => {
    const b = s.vb[v];
    if (b && b.p !== pid && total(s.ps[b.p].res) > 0 && !vict.includes(b.p)) vict.push(b.p);
  });
  if (!vict.length) { s.phase = s.after; return; }
  if (vict.length === 1) return stealFrom(s, pid, vict[0]);
  s.victims = vict;
  s.phase = 'steal';
}
function stealFrom(s, pid, victim) {
  const V = s.ps[victim];
  const pool = [];
  RES.forEach((r) => { for (let i = 0; i < V.res[r]; i++) pool.push(r); });
  if (pool.length) {
    const r = pool[rand(pool.length)];
    V.res[r]--;
    s.ps[pid].res[r]++;
    addFx(s, { from: `p-${victim}-hand`, to: `p-${pid}-hand`, html: cardBackHTML(), size: [26, 36], sound: 'steal', delay: 700 });
    log(s, `${nameOf(s, pid)} steals a card from ${nameOf(s, victim)}.`);
  }
  s.victims = [];
  s.phase = s.after;
}
function buildRoad(s, pid, e, free) {
  if (used(s, pid).road >= LIMIT.road) throw new Error('You have no roads left.');
  if (!canRoad(s, pid, e)) throw new Error("A road must connect to your network (and can't pass an opponent's building).");
  if (!free) pay(s, pid, COST.road);
  s.rd[e] = pid;
  addFx(s, { kind: 'sound', sound: 'build', delay: free ? 0 : 250 });
  log(s, `${nameOf(s, pid)} builds a road${free ? ' (free)' : ''}.`);
  updateLongest(s);
  if (free) {
    s.free--;
    if (s.free <= 0 || !roadSpots(s, pid).length) { s.free = 0; s.phase = 'main'; }
  }
}
function buildSettlement(s, pid, v) {
  if (used(s, pid).settlement >= LIMIT.settlement) throw new Error('You have no settlements left — upgrade one to a city.');
  if (!canSettle(s, pid, v, false)) throw new Error('Settlements need a free spot next to your road, with no building next door.');
  pay(s, pid, COST.settlement);
  s.vb[v] = { p: pid, city: false };
  addFx(s, { kind: 'sound', sound: 'build', delay: 350 });
  log(s, `${nameOf(s, pid)} builds a settlement.`);
  updateLongest(s);
}
function buildCity(s, pid, v) {
  if (!validV(v) || !s.vb[v] || s.vb[v].p !== pid || s.vb[v].city) throw new Error('Pick one of your settlements to upgrade.');
  if (used(s, pid).city >= LIMIT.city) throw new Error('You have no cities left.');
  pay(s, pid, COST.city);
  s.vb[v].city = true;
  addFx(s, { kind: 'sound', sound: 'build', delay: 350 });
  log(s, `${nameOf(s, pid)} upgrades to a city.`);
}
function buyDev(s, pid) {
  if (!s.deck.length) throw new Error('The development deck is empty.');
  pay(s, pid, COST.dev);
  const t = s.deck.pop();
  s.ps[pid].dev.push({ t, turn: s.turn });
  addFx(s, { from: 'hexisle-deck', to: `p-${pid}-dev`, html: devBackHTML(), size: [30, 42], sound: 'flip', delay: 300 });
  log(s, `${nameOf(s, pid)} buys a development card.`);
}
function bankTrade(s, pid, give, get) {
  if (!RES.includes(give) || !RES.includes(get) || give === get) throw new Error('Pick two different resources.');
  const rate = rates(s, pid)[give];
  const P = s.ps[pid];
  if (P.res[give] < rate) throw new Error(`You need ${rate} ${RES_NAME[give].toLowerCase()} for that trade.`);
  if (s.bank[get] < 1) throw new Error(`The bank has no ${RES_NAME[get].toLowerCase()} left.`);
  P.res[give] -= rate;
  s.bank[give] += rate;
  addFx(s, { from: `p-${pid}-hand`, to: `bank-${give}`, html: cardHTML(give, true), n: rate, size: [24, 34], sound: 'card' });
  s.bank[get]--;
  P.res[get]++;
  addFx(s, { from: `bank-${get}`, to: `p-${pid}-hand`, html: cardHTML(get, true), size: [26, 36], delay: 120 * rate + 200, sound: 'coin' });
  log(s, `${nameOf(s, pid)} trades ${rate} ${RES_NAME[give].toLowerCase()} for 1 ${RES_NAME[get].toLowerCase()} (${rate}:1).`);
}
const resText = (m) => RES.filter((r) => m[r]).map((r) => `${m[r]} ${RES_NAME[r].toLowerCase()}`).join(', ');
function offerTrade(s, pid, give, want) {
  const [g, ng] = resMap(give), [w, nw] = resMap(want);
  if (!ng || !nw) throw new Error('Choose what you give and what you want.');
  if (RES.some((r) => g[r] && w[r])) throw new Error("You can't give and want the same resource.");
  if (!hasRes(s.ps[pid].res, g)) throw new Error("You don't have those cards.");
  const replies = {};
  s.order.forEach((p) => { if (p !== pid) replies[p] = null; });
  s.trade = { give: g, want: w, replies };
  s.tradeSeq = (s.tradeSeq || 0) + 1;
  addFx(s, { kind: 'sound', sound: 'card' });
  log(s, `${nameOf(s, pid)} offers ${resText(g)} for ${resText(w)}.`);
}
function replyTrade(s, pid, yes) {
  const tr = s.trade;
  if (!(pid in tr.replies)) throw new Error('This offer is not for you.');
  if (tr.replies[pid] !== null) throw new Error('You already answered.');
  if (yes && !hasRes(s.ps[pid].res, tr.want)) throw new Error("You don't have the cards they want.");
  tr.replies[pid] = yes ? 'yes' : 'no';
  log(s, `${nameOf(s, pid)} ${yes ? 'accepts' : 'declines'} the offer.`);
}
function acceptTrade(s, pid, other) {
  const tr = s.trade;
  if (!tr) throw new Error('There is no open offer.');
  if (tr.replies[other] !== 'yes') throw new Error('That player has not accepted.');
  const P = s.ps[pid], O = s.ps[other];
  if (!hasRes(P.res, tr.give)) throw new Error("You no longer have the cards you offered.");
  if (!hasRes(O.res, tr.want)) throw new Error(`${nameOf(s, other)} no longer has those cards.`);
  let d = 0;
  RES.forEach((r) => {
    if (tr.give[r]) { P.res[r] -= tr.give[r]; O.res[r] += tr.give[r]; addFx(s, { from: `p-${pid}-hand`, to: `p-${other}-hand`, html: cardHTML(r, true), n: tr.give[r], size: [26, 36], delay: d, sound: 'card' }); d += 140 * tr.give[r]; }
    if (tr.want[r]) { O.res[r] -= tr.want[r]; P.res[r] += tr.want[r]; addFx(s, { from: `p-${other}-hand`, to: `p-${pid}-hand`, html: cardHTML(r, true), n: tr.want[r], size: [26, 36], delay: d, sound: 'card' }); d += 140 * tr.want[r]; }
  });
  log(s, `${nameOf(s, pid)} and ${nameOf(s, other)} trade ${resText(tr.give)} for ${resText(tr.want)}.`);
  s.trade = null;
}
function playDev(s, pid, a) {
  const t = a.card;
  const P = s.ps[pid];
  if (!DEV[t] || t === 'vp') throw new Error('That card cannot be played.');
  if (s.devUsed) throw new Error('You already played a development card this turn.');
  if (s.phase === 'roll' && t !== 'knight') throw new Error('Only a Knight can be played before rolling.');
  const idx = P.dev.findIndex((c) => c.t === t && c.turn < s.turn);
  if (idx < 0) throw new Error(P.dev.some((c) => c.t === t) ? "You can't play a card on the turn you bought it." : "You don't have that card.");
  if (t === 'road' && !roadSpots(s, pid).length) throw new Error('There is nowhere to build a road.');
  if (t === 'plenty') {
    const rs = a.res;
    if (!Array.isArray(rs) || rs.length !== 2 || !rs.every((r) => RES.includes(r))) throw new Error('Pick two resources.');
    const need = zeroRes();
    rs.forEach((r) => need[r]++);
    if (!hasRes(s.bank, need)) throw new Error('The bank does not have those.');
  }
  if (t === 'monopoly' && !RES.includes(a.res)) throw new Error('Pick a resource.');
  P.dev.splice(idx, 1);
  s.devUsed = true;
  s.devSeq++;
  s.lastDev = { t, p: pid };
  addFx(s, { kind: 'sound', sound: 'flip' });
  log(s, `${nameOf(s, pid)} plays ${DEV[t].name}.`);
  if (t === 'knight') {
    P.knights++;
    updateArmy(s, pid);
    s.after = s.phase;
    s.phase = 'robber';
  } else if (t === 'road') {
    s.free = Math.min(2, LIMIT.road - used(s, pid).road);
    s.phase = 'roads';
  } else if (t === 'plenty') {
    a.res.forEach((r, i) => gain(s, pid, r, 1, null, 700 + i * 260));
  } else if (t === 'monopoly') {
    const r = a.res;
    let sum = 0, d = 700;
    s.order.forEach((o) => {
      if (o === pid) return;
      const n = s.ps[o].res[r];
      if (!n) return;
      s.ps[o].res[r] = 0;
      P.res[r] += n;
      sum += n;
      addFx(s, { from: `p-${o}-hand`, to: `p-${pid}-hand`, html: cardHTML(r, true), n, size: [26, 36], delay: d, sound: 'steal' });
      d += 120 * n + 150;
    });
    log(s, `${nameOf(s, pid)} takes ${sum} ${RES_NAME[r].toLowerCase()}.`);
  }
}
function endTurn(s, pid) {
  if (s.trade) s.trade = null;
  s.cur = (s.cur + 1) % s.order.length;
  s.turn++;
  s.phase = 'roll';
  s.devUsed = false;
  s.free = 0;
  log(s, `${nameOf(s, curId(s))}'s turn.`);
  void pid;
}
function mainAct(s, pid, a) {
  const t = a.type;
  if (s.trade && !['accept', 'cancel', 'end'].includes(t)) throw new Error('Finish or cancel your trade offer first.');
  switch (t) {
    case 'build':
      if (a.what === 'road') return buildRoad(s, pid, a.at, false);
      if (a.what === 'settlement') return buildSettlement(s, pid, a.at);
      if (a.what === 'city') return buildCity(s, pid, a.at);
      break;
    case 'buydev': return buyDev(s, pid);
    case 'bank': return bankTrade(s, pid, a.give, a.get);
    case 'offer': return offerTrade(s, pid, a.give, a.want);
    case 'accept': return acceptTrade(s, pid, a.with);
    case 'cancel':
      if (!s.trade) throw new Error('There is no open offer.');
      s.trade = null;
      log(s, `${nameOf(s, pid)} withdraws the offer.`);
      return;
    case 'play': return playDev(s, pid, a);
    case 'end': return endTurn(s, pid);
  }
  throw new Error('Unknown move.');
}
function actInner(s, pid, a) {
  if (s.over) throw new Error('The game is over.');
  if (!s.ps[pid]) throw new Error('You are not playing in this game.');
  if (!a || typeof a !== 'object' || typeof a.type !== 'string') throw new Error('Unknown move.');
  const t = a.type;
  if (s.phase === 'discard') {
    if (t !== 'discard') throw new Error('Waiting for players to discard.');
    return doDiscard(s, pid, a.cards);
  }
  if (s.phase === 'main' && s.trade && t === 'reply') return replyTrade(s, pid, !!a.yes);
  if (pid !== curId(s)) throw new Error("It's not your turn.");
  switch (s.phase) {
    case 'setup':
      if (t === 'settle' && s.sub === 'settle') return setupSettle(s, pid, a.v);
      if (t === 'road' && s.sub === 'road') return setupRoad(s, pid, a.e);
      throw new Error(s.sub === 'settle' ? 'Place a settlement first.' : 'Now place a road next to your new settlement.');
    case 'roll':
      if (t === 'roll') return doRoll(s, pid);
      if (t === 'play') return playDev(s, pid, a);
      throw new Error('Roll the dice first.');
    case 'robber':
      if (t === 'robber') return moveRobber(s, pid, a.h);
      throw new Error('Move the robber first.');
    case 'steal':
      if (t === 'steal' && s.victims.includes(a.target)) return stealFrom(s, pid, a.target);
      throw new Error('Choose who to steal from.');
    case 'roads':
      if (t === 'build' && a.what === 'road') return buildRoad(s, pid, a.at, true);
      if (t === 'skip') { s.free = 0; s.phase = 'main'; return; }
      throw new Error('Place your free roads (or skip).');
    case 'main':
      return mainAct(s, pid, a);
  }
  throw new Error('That move is not possible now.');
}

function setup(players, opts) {
  const order = players.map((p) => p.id);
  const hexes = makeBoard();
  const types = shuffle(['any', 'any', 'any', 'any', ...RES]);
  const ps = {};
  players.forEach((p, i) => (ps[p.id] = { name: p.name, seat: i, res: zeroRes(), dev: [], knights: 0 }));
  const bank = {};
  RES.forEach((r) => (bank[r] = BANK_START));
  const s = {
    phase: 'setup', sub: 'settle', order, cur: 0, step: 0, last: -1, turn: 0,
    hexes, robber: hexes.findIndex((h) => h.t === 'desert'),
    harbors: HARBOR_SPOTS.map((h, i) => ({ e: h.e, t: types[i] })),
    vb: new Array(VERTS.length).fill(null), rd: new Array(EDGES.length).fill(null),
    ps, bank,
    deck: shuffle([...rep('knight', 14), ...rep('vp', 5), ...rep('road', 2), ...rep('plenty', 2), ...rep('monopoly', 2)]),
    dice: [3, 4], rollSeq: 0, lastRoll: 0, devUsed: false, discard: {}, after: 'main', victims: [], free: 0,
    trade: null, tradeSeq: 0, longest: null, army: null, roadLen: {}, devSeq: 0, lastDev: null,
    log: [], fx: [], fxSeq: 0, over: false, winners: [],
    level: levelOf(opts), // computer difficulty, public: every view carries it to the bots
  };
  log(s, `Welcome to the Isle of Hexes! ${nameOf(s, order[0])} places the first settlement.`);
  return s;
}

function turnOf(s) {
  if (s.over) return [];
  if (s.phase === 'discard') return s.order.filter((p) => s.discard[p] > 0);
  if (s.phase === 'main' && s.trade) {
    const pend = s.order.filter((p) => s.trade.replies[p] === null);
    if (pend.length) return pend;
  }
  return [curId(s)];
}

function view(s, pid) {
  const v = JSON.parse(JSON.stringify(s));
  v.deckCount = s.deck.length;
  v.deck = null;
  for (const p of s.order) {
    const P = v.ps[p];
    P.nRes = total(s.ps[p].res);
    P.nDev = s.ps[p].dev.length;
    if (p !== pid && !s.over) { P.res = null; P.dev = null; }
  }
  return v;
}

/* ---------------- bot ---------------- */
function produces(s, pid) {
  const have = new Set();
  s.vb.forEach((b, v) => { if (b && b.p === pid) VERTS[v].hexes.forEach((h) => { const r = TER[s.hexes[h].t]; if (r) have.add(r); }); });
  return have;
}
function spotValue(s, v, pid, have, harborBias = 1) {
  let pips = 0;
  const kinds = new Set();
  for (const h of VERTS[v].hexes) {
    const r = TER[s.hexes[h].t];
    if (!r) continue;
    let p = pipsOf(s.hexes[h].n);
    if (h === s.robber) p *= 0.4;
    pips += p;
    kinds.add(r);
  }
  let sc = pips + kinds.size * 1.1;
  if (have) for (const r of kinds) if (!have.has(r)) sc += 1.3;
  for (const hb of harborAt(s, v)) sc += harborBias * (hb.t === 'any' ? 1.2 : kinds.has(hb.t) || (have && have.has(hb.t)) ? 2.2 : 0.4);
  return sc;
}
function missing(res, cost) {
  const m = zeroRes();
  RES.forEach((r) => (m[r] = Math.max(0, (cost[r] || 0) - (res[r] || 0))));
  return m;
}
// Best free settlement spot reachable by building one road from edge e.
function roadValue(s, pid, e, have) {
  const E = EDGES[e];
  let best = 0;
  for (const v of [E.a, E.b]) {
    if (canSettle(s, pid, v, true)) best = Math.max(best, spotValue(s, v, pid, have));
    for (const w of VERTS[v].adj) if (canSettle(s, pid, w, true)) best = Math.max(best, 0.55 * spotValue(s, w, pid, have));
  }
  return best;
}
function bestRoad(s, pid, mustAim) {
  const spots = roadSpots(s, pid);
  if (!spots.length) return null;
  const have = produces(s, pid);
  let best = null, bs = -1;
  for (const e of spots) {
    let sc = roadValue(s, pid, e, have);
    if (sc <= 0 && mustAim) continue;
    // extending our longest road is a small bonus
    s.rd[e] = pid;
    sc += 0.3 * longestFor(s, pid);
    s.rd[e] = null;
    sc += Math.random() * 0.3;
    if (sc > bs) { bs = sc; best = e; }
  }
  return best;
}
function needWeights(s, pid) {
  const res = s.ps[pid].res;
  const w = {};
  RES.forEach((r) => (w[r] = 1));
  const u = used(s, pid);
  const targets = [];
  if (u.settlement > 0 && u.city < LIMIT.city) targets.push(COST.city);
  if (u.settlement < LIMIT.settlement) targets.push(COST.settlement);
  targets.push(COST.dev);
  targets.forEach((c, i) => RES.forEach((r) => { if ((c[r] || 0) > res[r]) w[r] += 1.2 / (i + 1); }));
  RES.forEach((r) => { if (res[r] >= 4) w[r] -= 0.5; });
  return w;
}
function botSetup(s, pid) {
  if (s.sub === 'settle') {
    const have = produces(s, pid);
    const bias = Math.random() < 0.5 ? 1 : 0.2; // sometimes keen on a harbor
    let best = null, bs = -1;
    for (const v of settleSpots(s, pid, true)) {
      const sc = spotValue(s, v, pid, s.step >= s.order.length ? have : null, bias) + Math.random() * 0.6;
      if (sc > bs) { bs = sc; best = v; }
    }
    return { type: 'settle', v: best };
  }
  const have = produces(s, pid);
  let best = null, bs = -1;
  for (const e of VERTS[s.last].edges) {
    if (s.rd[e] !== null) continue;
    const far = EDGES[e].a === s.last ? EDGES[e].b : EDGES[e].a;
    let sc = Math.random() * 0.3;
    for (const w of VERTS[far].adj) if (w !== s.last && canSettle(s, pid, w, true)) sc = Math.max(sc, spotValue(s, w, pid, have));
    if (sc > bs) { bs = sc; best = e; }
  }
  return { type: 'road', e: best };
}
function robberOnMe(s, pid) {
  return HEXES[s.robber].v.some((v) => s.vb[v] && s.vb[v].p === pid);
}
const canPlay = (s, pid, t) => !s.devUsed && (s.ps[pid].dev || []).some((c) => c.t === t && c.turn < s.turn);
function botRobber(s, pid) {
  const vps = {};
  s.order.forEach((p) => (vps[p] = vpOf(s, p, p === pid)));
  const top = Math.max(...s.order.filter((p) => p !== pid).map((p) => vps[p]));
  let best = -1, bs = -1;
  HEXES.forEach((h, i) => {
    if (i === s.robber) return;
    let sc = 0, mine = false;
    h.v.forEach((v) => {
      const b = s.vb[v];
      if (!b) return;
      if (b.p === pid) { mine = true; return; }
      const lead = vps[b.p] === top ? 1.8 : 1;
      sc += (b.city ? 2 : 1) * pipsOf(s.hexes[i].n) * lead * (s.ps[b.p].nRes > 0 ? 1.2 : 1);
    });
    if (mine) sc -= 100;
    sc += Math.random() * 0.5;
    if (sc > bs) { bs = sc; best = i; }
  });
  return { type: 'robber', h: best };
}
function botTrade(s, pid, targets) {
  const res = s.ps[pid].res;
  const rt = rates(s, pid);
  const maxMiss = total(res) > 7 ? 3 : 2; // a big hand risks the robber, so spend it
  for (const cost of targets) {
    const miss = missing(res, cost);
    const nMiss = total(miss);
    if (nMiss === 0 || nMiss > maxMiss) continue;
    const need = RES.find((r) => miss[r] > 0 && s.bank[r] > 0);
    if (!need) continue;
    const order = RES.slice().sort((a, b) => (res[b] - (cost[b] || 0) - rt[b]) - (res[a] - (cost[a] || 0) - rt[a]));
    for (const g of order) {
      if (g === need) continue;
      if (res[g] - (cost[g] || 0) >= rt[g]) return { type: 'bank', give: g, get: need };
    }
  }
  return null;
}
function botMain(s, pid) {
  if (s.trade) return { type: 'cancel' };
  const P = s.ps[pid], res = P.res;
  const u = used(s, pid);
  const have = produces(s, pid);
  // development cards
  if (canPlay(s, pid, 'knight') && (robberOnMe(s, pid) || (P.knights + 1 >= 3 && s.army !== pid && (!s.army || s.ps[s.army].knights < P.knights + 1)))) return { type: 'play', card: 'knight' };
  if (canPlay(s, pid, 'road') && u.road <= LIMIT.road - 2 && bestRoad(s, pid, true) !== null) return { type: 'play', card: 'road' };
  if (canPlay(s, pid, 'plenty')) {
    const goal = u.settlement > 0 && u.city < LIMIT.city ? COST.city : COST.settlement;
    const miss = missing(res, goal);
    const pick = [];
    RES.forEach((r) => { for (let i = 0; i < miss[r]; i++) pick.push(r); });
    while (pick.length < 2) pick.push(RES.slice().sort((a, b) => res[a] - res[b])[0]);
    const take = pick.slice(0, 2);
    const need = zeroRes();
    take.forEach((r) => need[r]++);
    if (hasRes(s.bank, need)) return { type: 'play', card: 'plenty', res: take };
  }
  if (canPlay(s, pid, 'monopoly')) {
    const others = s.order.filter((p) => p !== pid).reduce((a, p) => a + (s.ps[p].nRes || 0), 0);
    if (others >= 6) {
      const w = needWeights(s, pid);
      const r = RES.slice().sort((a, b) => w[b] - w[a])[0];
      return { type: 'play', card: 'monopoly', res: r };
    }
  }
  // city
  if (hasRes(res, COST.city) && u.city < LIMIT.city) {
    let best = null, bs = -1;
    s.vb.forEach((b, v) => { if (b && b.p === pid && !b.city) { const sc = spotValue(s, v, pid, null, 0); if (sc > bs) { bs = sc; best = v; } } });
    if (best !== null) return { type: 'build', what: 'city', at: best };
  }
  // settlement
  const spots = u.settlement < LIMIT.settlement ? settleSpots(s, pid, false) : [];
  if (spots.length && hasRes(res, COST.settlement)) {
    let best = spots[0], bs = -1;
    for (const v of spots) { const sc = spotValue(s, v, pid, have); if (sc > bs) { bs = sc; best = v; } }
    return { type: 'build', what: 'settlement', at: best };
  }
  // a road toward the best free spot
  const aim = !spots.length && u.settlement < LIMIT.settlement && u.road < LIMIT.road;
  let aimRoad = null;
  if (aim) aimRoad = bestRoad(s, pid, true);
  if (aimRoad !== null && hasRes(res, COST.road)) return { type: 'build', what: 'road', at: aimRoad };
  // development card (unless it would spoil a nearly finished city or settlement)
  if (hasRes(res, COST.dev) && s.deckCount > 0) {
    const after = { ...res };
    RES.forEach((r) => (after[r] -= COST.dev[r] || 0));
    const nearCity = u.settlement > 0 && total(missing(res, COST.city)) <= 1 && total(missing(after, COST.city)) > total(missing(res, COST.city));
    const nearSettle = spots.length && total(missing(res, COST.settlement)) <= 1 && total(missing(after, COST.settlement)) > total(missing(res, COST.settlement));
    if (!nearCity && !nearSettle) return { type: 'buydev' };
  }
  // a plain road (for reach, Longest Road, or to spend a big hand)
  if (hasRes(res, COST.road) && u.road < LIMIT.road && (spots.length < 2 || total(res) > 7 || (s.roadLen[pid] || 0) >= 4)) {
    const e = bestRoad(s, pid, false);
    if (e !== null) return { type: 'build', what: 'road', at: e };
  }
  // bank / harbor trades toward a build
  const targets = [];
  if (u.settlement > 0 && u.city < LIMIT.city) targets.push(COST.city);
  if (spots.length) targets.push(COST.settlement);
  if (aimRoad !== null) targets.push(COST.road);
  if (s.deckCount > 0) targets.push(COST.dev);
  if (!spots.length && aimRoad === null && u.road < LIMIT.road && roadSpots(s, pid).length) targets.push(COST.road);
  const tr = botTrade(s, pid, targets);
  if (tr) return tr;
  return { type: 'end' };
}
function botDiscard(s, pid) {
  const n = s.discard[pid];
  const res = { ...s.ps[pid].res };
  const w = needWeights(s, pid);
  const out = zeroRes();
  for (let i = 0; i < n; i++) {
    let best = null, bs = -Infinity;
    for (const r of RES) {
      if (res[r] <= 0) continue;
      const sc = res[r] - 1.5 * w[r] + Math.random() * 0.2;
      if (sc > bs) { bs = sc; best = r; }
    }
    res[best]--;
    out[best]++;
  }
  return { type: 'discard', cards: out };
}
function botReply(s, pid) {
  const tr = s.trade;
  const res = s.ps[pid].res;
  if (!hasRes(res, tr.want)) return { type: 'reply', yes: false };
  const prop = curId(s);
  if (vpOf(s, prop, false) >= WIN_VP - 2) return { type: 'reply', yes: false };
  const w = needWeights(s, pid);
  const after = { ...res };
  RES.forEach((r) => (after[r] += tr.give[r] - tr.want[r]));
  const gainV = RES.reduce((a, r) => a + tr.give[r] * w[r], 0);
  const lossV = RES.reduce((a, r) => a + tr.want[r] * w[r], 0);
  // finishing a build with the trade is very attractive
  const done = [COST.city, COST.settlement, COST.dev].some((c) => !hasRes(res, c) && hasRes(after, c));
  return { type: 'reply', yes: done ? gainV >= lossV * 0.8 : gainV > lossV + 0.2 };
}
// Normal level: the original computer player.
function botNormal(s, pid) {
  const due = turnOf(s);
  if (!due.includes(pid)) return null;
  if (s.phase === 'discard') return botDiscard(s, pid);
  if (s.phase === 'main' && s.trade && s.trade.replies[pid] === null) return botReply(s, pid);
  switch (s.phase) {
    case 'setup': return botSetup(s, pid);
    case 'roll':
      if (canPlay(s, pid, 'knight') && robberOnMe(s, pid)) return { type: 'play', card: 'knight' };
      return { type: 'roll' };
    case 'robber': return botRobber(s, pid);
    case 'steal': {
      const t = s.victims.slice().sort((a, b) => (vpOf(s, b, false) * 2 + (s.ps[b].nRes || 0)) - (vpOf(s, a, false) * 2 + (s.ps[a].nRes || 0)))[0];
      return { type: 'steal', target: t };
    }
    case 'roads': {
      const e = bestRoad(s, pid, false);
      return e === null ? { type: 'skip' } : { type: 'build', what: 'road', at: e };
    }
    case 'main': return botMain(s, pid);
  }
  return { type: 'end' };
}

/* ---- Easy: no plan. Settles almost anywhere, builds whatever it happens to afford at a random
   spot, never trades with the bank and often just ends its turn. ---- */
const pick = (a) => a[rand(a.length)];
function botEasy(s, pid) {
  if (!turnOf(s).includes(pid)) return null;
  const P = s.ps[pid];
  if (s.phase === 'discard') {
    const res = { ...P.res }, out = zeroRes();
    for (let i = 0; i < s.discard[pid]; i++) { const r = pick(RES.filter((x) => res[x] > 0)); res[r]--; out[r]++; }
    return { type: 'discard', cards: out };
  }
  if (s.phase === 'main' && s.trade && s.trade.replies[pid] === null) return { type: 'reply', yes: hasRes(P.res, s.trade.want) && Math.random() < 0.5 };
  switch (s.phase) {
    case 'setup':
      if (s.sub === 'settle') return Math.random() < 0.3 ? botSetup(s, pid) : { type: 'settle', v: pick(settleSpots(s, pid, true)) };
      return { type: 'road', e: pick(VERTS[s.last].edges.filter((e) => s.rd[e] === null)) ?? null };
    case 'roll': return { type: 'roll' };
    case 'robber': return Math.random() < 0.5 ? botRobber(s, pid) : { type: 'robber', h: pick(HEXES.map((_, i) => i).filter((i) => i !== s.robber)) };
    case 'steal': return { type: 'steal', target: pick(s.victims) };
    case 'roads': { const sp = roadSpots(s, pid); return sp.length ? { type: 'build', what: 'road', at: pick(sp) } : { type: 'skip' }; }
    case 'main': {
      if (s.trade) return { type: 'cancel' };
      if (Math.random() < 0.3) return { type: 'end' };
      const res = P.res, u = used(s, pid), opts = [];
      const towns = []; s.vb.forEach((b, v) => { if (b && b.p === pid && !b.city) towns.push(v); });
      if (hasRes(res, COST.city) && u.city < LIMIT.city && towns.length) opts.push({ type: 'build', what: 'city', at: pick(towns) });
      const spots = hasRes(res, COST.settlement) && u.settlement < LIMIT.settlement ? settleSpots(s, pid, false) : [];
      if (spots.length) opts.push({ type: 'build', what: 'settlement', at: pick(spots) });
      const roads = hasRes(res, COST.road) ? roadSpots(s, pid) : [];
      if (roads.length) opts.push({ type: 'build', what: 'road', at: pick(roads) });
      if (hasRes(res, COST.dev) && s.deckCount > 0) opts.push({ type: 'buydev' });
      if (canPlay(s, pid, 'knight')) opts.push({ type: 'play', card: 'knight' });
      return opts.length ? pick(opts) : { type: 'end' };
    }
  }
  return { type: 'end' };
}

/* ---- Hard: plans its island. Judges spots by expected production (weighted by what each resource
   builds), looks two roads ahead, trades with the bank to finish builds and to keep its hand under
   the robber's limit, blocks the leader, and keeps the right cards when it must discard. ---- */
const H_WEIGHT = { lumber: 1.1, brick: 1.15, wool: 0.85, grain: 1.05, ore: 1.05 };
function prodOf(s, pid) {
  const p = zeroRes();
  s.vb.forEach((b, v) => {
    if (!b || b.p !== pid) return;
    for (const h of VERTS[v].hexes) { const r = TER[s.hexes[h].t]; if (r) p[r] += pipsOf(s.hexes[h].n) * (b.city ? 2 : 1) * (h === s.robber ? 0.3 : 1); }
  });
  return p;
}
function hardSpot(s, v, pid, prod) {
  let sc = 0;
  const nums = new Set();
  for (const h of VERTS[v].hexes) {
    const r = TER[s.hexes[h].t];
    if (!r) continue;
    const p = pipsOf(s.hexes[h].n) * (h === s.robber ? 0.3 : 1);
    // A resource we barely produce is worth more than one we already have plenty of.
    sc += p * H_WEIGHT[r] * (prod[r] < 1 ? 1.45 : prod[r] < 4 ? 1.1 : 0.85);
    nums.add(s.hexes[h].n);
  }
  sc += nums.size * 0.4;
  for (const hb of harborAt(s, v)) {
    if (hb.t === 'any') sc += 1;
    else sc += Math.min(3, (prod[hb.t] || 0) * 0.45 + (VERTS[v].hexes.some((h) => TER[s.hexes[h].t] === hb.t) ? 1.2 : 0));
  }
  return sc;
}
// Best spot reachable from edge e: one road away counts fully, two roads away a little less.
function hardRoadValue(s, pid, e, prod) {
  const E = EDGES[e];
  let best = 0;
  for (const v of [E.a, E.b]) {
    if (s.vb[v] && s.vb[v].p !== pid) continue;
    if (canSettle(s, pid, v, true)) best = Math.max(best, hardSpot(s, v, pid, prod));
    for (const w of VERTS[v].adj) {
      if (canSettle(s, pid, w, true)) best = Math.max(best, 0.62 * hardSpot(s, w, pid, prod));
      for (const x of VERTS[w].adj) if (x !== v && canSettle(s, pid, x, true)) best = Math.max(best, 0.3 * hardSpot(s, x, pid, prod));
    }
  }
  return best;
}
function hardBestRoad(s, pid, mustAim) {
  const spots = roadSpots(s, pid);
  if (!spots.length) return null;
  const prod = prodOf(s, pid);
  const base = longestFor(s, pid);
  let best = null, bs = -Infinity;
  for (const e of spots) {
    let sc = hardRoadValue(s, pid, e, prod);
    if (sc <= 0 && mustAim) continue;
    s.rd[e] = pid;
    const len = longestFor(s, pid);
    s.rd[e] = null;
    // Racing for the Longest Road matters once someone is close to it.
    const rival = Math.max(0, ...s.order.filter((p) => p !== pid).map((p) => s.roadLen[p] || 0));
    sc += (len - base) * (len >= 4 && len >= rival ? 1.2 : 0.3);
    sc += Math.random() * 0.05;
    if (sc > bs) { bs = sc; best = e; }
  }
  return best;
}
function hardSetup(s, pid) {
  const prod = s.step >= s.order.length ? prodOf(s, pid) : zeroRes();
  if (s.sub === 'settle') {
    let best = null, bs = -Infinity;
    for (const v of settleSpots(s, pid, true)) {
      let sc = hardSpot(s, v, pid, prod);
      // First round: also count the best spot still likely to be free for our second settlement.
      if (s.step < s.order.length) {
        const kinds = new Set(VERTS[v].hexes.map((h) => TER[s.hexes[h].t]).filter(Boolean));
        sc += kinds.size * 0.5 + (kinds.has('lumber') && kinds.has('brick') ? 1 : 0);
      } else {
        const after = zeroRes();
        RES.forEach((r) => (after[r] = prod[r]));
        VERTS[v].hexes.forEach((h) => { const r = TER[s.hexes[h].t]; if (r) after[r] += pipsOf(s.hexes[h].n); });
        sc += RES.filter((r) => after[r] > 0).length * 0.9; // covering all five resources is strong
      }
      sc += Math.random() * 0.05;
      if (sc > bs) { bs = sc; best = v; }
    }
    return { type: 'settle', v: best };
  }
  let best = null, bs = -Infinity;
  for (const e of VERTS[s.last].edges) {
    if (s.rd[e] !== null) continue;
    const sc = hardRoadValue(s, pid, e, prod) + Math.random() * 0.05;
    if (sc > bs) { bs = sc; best = e; }
  }
  return { type: 'road', e: best };
}
function hardRobber(s, pid) {
  const vps = {};
  s.order.forEach((p) => (vps[p] = vpOf(s, p, p === pid)));
  const top = Math.max(...s.order.filter((p) => p !== pid).map((p) => vps[p]));
  let best = -1, bs = -Infinity;
  HEXES.forEach((h, i) => {
    if (i === s.robber) return;
    let sc = 0, mine = 0;
    const pips = pipsOf(s.hexes[i].n);
    h.v.forEach((v) => {
      const b = s.vb[v];
      if (!b) return;
      if (b.p === pid) { mine += b.city ? 2 : 1; return; }
      const lead = vps[b.p] === top ? 1.6 + 0.15 * vps[b.p] : 1;
      sc += (b.city ? 2 : 1) * pips * lead + ((s.ps[b.p].nRes || 0) > 0 ? 1.5 : 0);
    });
    sc -= mine * (pips + 2) * 3;
    sc += Math.random() * 0.05;
    if (sc > bs) { bs = sc; best = i; }
  });
  return { type: 'robber', h: best };
}
// What the hard bot is saving for, nearest first.
function hardTargets(s, pid) {
  const res = s.ps[pid].res, u = used(s, pid);
  const t = [];
  if (u.settlement > 0 && u.city < LIMIT.city) t.push(COST.city);
  if (u.settlement < LIMIT.settlement && settleSpots(s, pid, false).length) t.push(COST.settlement);
  if (u.settlement < LIMIT.settlement && u.road < LIMIT.road && hardBestRoad(s, pid, true) !== null) t.push(COST.road);
  if (s.deckCount > 0) t.push(COST.dev);
  return t.sort((a, b) => total(missing(res, a)) - total(missing(res, b)));
}
function hardDiscard(s, pid) {
  const res = { ...s.ps[pid].res };
  const out = zeroRes();
  const goals = hardTargets(s, pid);
  for (let i = 0; i < s.discard[pid]; i++) {
    let best = null, bs = Infinity;
    for (const r of RES) {
      if (res[r] <= 0) continue;
      res[r]--;
      // keep the hand closest to the cheapest goals
      const sc = goals.reduce((a, c, k) => a + total(missing(res, c)) / (k + 1), 0) - res[r] * 0.05;
      res[r]++;
      if (sc < bs) { bs = sc; best = r; }
    }
    res[best]--;
    out[best]++;
  }
  return { type: 'discard', cards: out };
}
function hardTrade(s, pid) {
  const res = s.ps[pid].res, rt = rates(s, pid);
  const goals = hardTargets(s, pid);
  for (const cost of goals) {
    const miss = missing(res, cost), nMiss = total(miss);
    if (nMiss === 0) continue;
    // What we could pay without touching this goal's own cards.
    const spare = RES.reduce((a, r) => a + Math.floor(Math.max(0, res[r] - (cost[r] || 0)) / rt[r]), 0);
    if (spare < nMiss) continue;
    const need = RES.filter((r) => miss[r] > 0 && s.bank[r] > 0).sort((a, b) => miss[b] - miss[a])[0];
    if (!need) continue;
    const give = RES.filter((r) => r !== need && res[r] - (cost[r] || 0) >= rt[r])
      .sort((a, b) => (res[b] - (cost[b] || 0)) / rt[b] - (res[a] - (cost[a] || 0)) / rt[a])[0];
    if (give) return { type: 'bank', give, get: need };
  }
  return null;
}
function hardMain(s, pid) {
  if (s.trade) return { type: 'cancel' };
  const P = s.ps[pid], res = P.res;
  const u = used(s, pid);
  const prod = prodOf(s, pid);
  if (canPlay(s, pid, 'knight') && (robberOnMe(s, pid) || (P.knights + 1 >= 3 && s.army !== pid && (!s.army || s.ps[s.army].knights < P.knights + 1)))) return { type: 'play', card: 'knight' };
  if (canPlay(s, pid, 'road') && u.road <= LIMIT.road - 2 && hardBestRoad(s, pid, true) !== null) return { type: 'play', card: 'road' };
  if (canPlay(s, pid, 'plenty')) {
    const goal = hardTargets(s, pid)[0] || COST.city;
    const miss = missing(res, goal), take = [];
    RES.forEach((r) => { for (let i = 0; i < miss[r]; i++) take.push(r); });
    while (take.length < 2) take.push(RES.slice().sort((a, b) => prod[a] - prod[b] || res[a] - res[b])[0]);
    const pickd = take.slice(0, 2), need = zeroRes();
    pickd.forEach((r) => need[r]++);
    if (hasRes(s.bank, need)) return { type: 'play', card: 'plenty', res: pickd };
  }
  if (canPlay(s, pid, 'monopoly')) {
    const others = s.order.filter((p) => p !== pid).reduce((a, p) => a + (s.ps[p].nRes || 0), 0);
    if (others >= 5) {
      // Name what we produce least: rivals are most likely to hold it and we need it most.
      const r = RES.slice().sort((a, b) => prod[a] - prod[b] - (needWeights(s, pid)[b] - needWeights(s, pid)[a]) * 0.5)[0];
      return { type: 'play', card: 'monopoly', res: r };
    }
  }
  if (hasRes(res, COST.city) && u.city < LIMIT.city) {
    let best = null, bs = -1;
    s.vb.forEach((b, v) => { if (b && b.p === pid && !b.city) { const sc = hardSpot(s, v, pid, zeroRes()); if (sc > bs) { bs = sc; best = v; } } });
    if (best !== null) return { type: 'build', what: 'city', at: best };
  }
  const spots = u.settlement < LIMIT.settlement ? settleSpots(s, pid, false) : [];
  if (spots.length && hasRes(res, COST.settlement)) {
    let best = spots[0], bs = -Infinity;
    for (const v of spots) { const sc = hardSpot(s, v, pid, prod); if (sc > bs) { bs = sc; best = v; } }
    return { type: 'build', what: 'settlement', at: best };
  }
  const aimRoad = !spots.length && u.settlement < LIMIT.settlement && u.road < LIMIT.road ? hardBestRoad(s, pid, true) : null;
  if (aimRoad !== null && hasRes(res, COST.road)) return { type: 'build', what: 'road', at: aimRoad };
  const tr = hardTrade(s, pid);
  if (tr) return tr;
  if (hasRes(res, COST.dev) && s.deckCount > 0) {
    const after = { ...res };
    RES.forEach((r) => (after[r] -= COST.dev[r] || 0));
    const near = [COST.city, COST.settlement].some((c) => (c !== COST.city || u.settlement > 0) && (c !== COST.settlement || spots.length) && total(missing(res, c)) <= 2 && total(missing(after, c)) > total(missing(res, c)));
    if (!near || total(res) > 7) return { type: 'buydev' };
  }
  // A plain road for the Longest Road race, or to spend a hand the robber would halve.
  if (hasRes(res, COST.road) && u.road < LIMIT.road && (total(res) > 7 || (s.roadLen[pid] || 0) >= 4)) {
    const e = hardBestRoad(s, pid, false);
    if (e !== null) return { type: 'build', what: 'road', at: e };
  }
  // Over the robber's limit: swap the biggest pile for what we lack most.
  if (total(res) > 7) {
    const rt = rates(s, pid);
    const give = RES.filter((r) => res[r] >= rt[r]).sort((a, b) => res[b] / rt[b] - res[a] / rt[a])[0];
    const get = give && RES.filter((r) => r !== give && s.bank[r] > 0).sort((a, b) => res[a] + prod[a] * 0.1 - (res[b] + prod[b] * 0.1))[0];
    if (give && get && total(res) - rt[give] + 1 >= 4) return { type: 'bank', give, get };
  }
  return { type: 'end' };
}
function botHard(s, pid) {
  if (!turnOf(s).includes(pid)) return null;
  if (s.phase === 'discard') return hardDiscard(s, pid);
  if (s.phase === 'main' && s.trade && s.trade.replies[pid] === null) return botReply(s, pid);
  switch (s.phase) {
    case 'setup': return hardSetup(s, pid);
    case 'roll':
      if (canPlay(s, pid, 'knight') && robberOnMe(s, pid)) return { type: 'play', card: 'knight' };
      return { type: 'roll' };
    case 'robber': return hardRobber(s, pid);
    case 'steal': {
      const t = s.victims.slice().sort((a, b) => (vpOf(s, b, false) * 2 + (s.ps[b].nRes || 0)) - (vpOf(s, a, false) * 2 + (s.ps[a].nRes || 0)))[0];
      return { type: 'steal', target: t };
    }
    case 'roads': {
      const e = hardBestRoad(s, pid, false);
      return e === null ? { type: 'skip' } : { type: 'build', what: 'road', at: e };
    }
    case 'main': return hardMain(s, pid);
  }
  return { type: 'end' };
}
function bot(s, pid) {
  if (s.level === 'easy') return botEasy(s, pid);
  if (s.level === 'hard') return botHard(s, pid);
  return botNormal(s, pid);
}

/* ---------------- art ---------------- */
const PCOL = [
  { name: 'Red', hi: '#ff9a82', c: '#d23b26', lo: '#7c1a0d', ink: '#fff' },
  { name: 'Blue', hi: '#9cc2ff', c: '#2e66cc', lo: '#133170', ink: '#fff' },
  { name: 'Ivory', hi: '#ffffff', c: '#e6dcc4', lo: '#94866a', ink: '#5a3d1c' },
  { name: 'Orange', hi: '#ffcb7a', c: '#ea8519', lo: '#8a4805', ink: '#fff' },
];
// Every seat also has its own emblem, so colour is never the only cue.
const SYM = [
  (x, y, k, f) => `<circle cx="${x}" cy="${y}" r="${k}" fill="${f}"/>`,
  (x, y, k, f) => `<path d="M${x},${y - k * 1.15} L${x + k * 1.1},${y + k * 0.8} L${x - k * 1.1},${y + k * 0.8}Z" fill="${f}"/>`,
  (x, y, k, f) => `<rect x="${x - k * 0.9}" y="${y - k * 0.9}" width="${k * 1.8}" height="${k * 1.8}" fill="${f}"/>`,
  (x, y, k, f) => `<path d="M${x},${y - k * 1.25} L${x + k},${y} L${x},${y + k * 1.25} L${x - k},${y}Z" fill="${f}"/>`,
];
const seatSVG = (seat, size = 22) => {
  const P = PCOL[seat % 4];
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" class="hexisle-seat" aria-hidden="true"><defs><radialGradient id="hx-sw${seat}" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="${P.hi}"/><stop offset=".55" stop-color="${P.c}"/><stop offset="1" stop-color="${P.lo}"/></radialGradient></defs><circle cx="12" cy="12" r="10.5" fill="url(#hx-sw${seat})" stroke="#0e1530" stroke-width="1.4"/>${SYM[seat % 4](12, 12.3, 4.2, P.ink)}</svg>`;
};
// A player's face, ringed in their colour, with their seat emblem pinned on (colour is never the only cue).
const botOf = (ctx, id) => !!(ctx && typeof ctx.isBot === 'function' && ctx.isBot(id));
function faceHTML(v, pid, ctx, cls = '') {
  const P = v.ps[pid];
  if (!P) return '';
  return `<span class="hexisle-face ${cls}" style="--pc:${PCOL[P.seat % 4].c}">${portrait({ id: pid, bot: botOf(ctx, pid) })}<span class="hexisle-emb">${seatSVG(P.seat, 14)}</span></span>`;
}
// Small control icons the shared set doesn't have.
const SWAP_IC = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8.5h15l-4-4M20 15.5H5l4 4"/></svg>';
const svgURL = (s) => `url("data:image/svg+xml,${encodeURIComponent(s.replace(/\s+/g, ' '))}")`;
const WAVES = svgURL(`<svg xmlns='http://www.w3.org/2000/svg' width='132' height='84' viewBox='0 0 132 84'><g fill='none' stroke='#ffffff' stroke-linecap='round' stroke-width='1.6'>
  <path d='M8 18 q6 -5 12 0 t12 0' stroke-opacity='.22'/><path d='M74 44 q6 -5 12 0 t12 0' stroke-opacity='.18'/><path d='M30 70 q5 -4 10 0 t10 0' stroke-opacity='.15'/>
  <path d='M104 12 q4 -3 8 0' stroke-opacity='.2'/></g><g fill='#ffffff'><circle cx='58' cy='22' r='1' fill-opacity='.35'/><circle cx='118' cy='64' r='1.2' fill-opacity='.3'/><circle cx='16' cy='50' r='.9' fill-opacity='.3'/></g></svg>`);

const ICON = {
  lumber: `<path d="M6,30 L34,30" stroke="#3a2210" stroke-width="2" opacity=".4"/>
    <rect x="5" y="20" width="24" height="9" rx="4.5" fill="#9b6a3c" stroke="#4a2c14" stroke-width="1.4"/>
    <rect x="11" y="11" width="24" height="9" rx="4.5" fill="#b07a46" stroke="#4a2c14" stroke-width="1.4"/>
    <circle cx="9.5" cy="24.5" r="4.3" fill="#e8c48e" stroke="#4a2c14" stroke-width="1.2"/><circle cx="9.5" cy="24.5" r="2.2" fill="none" stroke="#a77443" stroke-width="1"/>
    <circle cx="15.5" cy="15.5" r="4.3" fill="#f0cf9c" stroke="#4a2c14" stroke-width="1.2"/><circle cx="15.5" cy="15.5" r="2.2" fill="none" stroke="#a77443" stroke-width="1"/>
    <path d="M30,11 C33,7 36,8 36,5" stroke="#3f7d2c" stroke-width="2" fill="none"/><ellipse cx="35" cy="5" rx="3" ry="2" fill="#5fae3c"/>`,
  brick: `<g stroke="#5a1c08" stroke-width="1.3">
    <rect x="4" y="22" width="15" height="8" rx="1.5" fill="#c9562c"/><rect x="21" y="22" width="15" height="8" rx="1.5" fill="#b84b24"/>
    <rect x="12" y="13" width="16" height="8" rx="1.5" fill="#d96a3a"/>
    <rect x="15" y="4" width="11" height="8" rx="1.5" fill="#c9562c"/></g>
    <path d="M6,24 h11 M23,24 h11 M14,15 h12 M17,6 h7" stroke="#ffb08a" stroke-width="1.2" opacity=".7"/>`,
  wool: `<g fill="#fffdf4" stroke="#6b6255" stroke-width="1.2">
    <circle cx="13" cy="19" r="6"/><circle cx="20" cy="15" r="6.5"/><circle cx="27" cy="19" r="6"/><circle cx="16" cy="24" r="5.5"/><circle cx="24" cy="24" r="5.5"/></g>
    <path d="M14,28 v5 M19,29 v5 M23,29 v5 M27,28 v5" stroke="#3a332c" stroke-width="2.2" stroke-linecap="round"/>
    <ellipse cx="32" cy="16" rx="4.6" ry="3.6" fill="#3a332c"/><circle cx="33.3" cy="15" r=".9" fill="#fff"/><path d="M29,13.5 l-2,-2.5" stroke="#3a332c" stroke-width="2" stroke-linecap="round"/>`,
  grain: `<g stroke="#7a5510" stroke-width="1.6" fill="none" stroke-linecap="round"><path d="M20,36 C20,26 20,18 20,8"/><path d="M20,36 C17,27 13,20 10,13"/><path d="M20,36 C23,27 27,20 30,13"/></g>
    <g fill="#f4cf55" stroke="#8a6012" stroke-width="1"><ellipse cx="20" cy="8" rx="2.4" ry="4"/><ellipse cx="16.6" cy="13" rx="2.2" ry="3.6" transform="rotate(-30 16.6 13)"/><ellipse cx="23.4" cy="13" rx="2.2" ry="3.6" transform="rotate(30 23.4 13)"/>
    <ellipse cx="10" cy="13" rx="2.2" ry="3.6" transform="rotate(-35 10 13)"/><ellipse cx="30" cy="13" rx="2.2" ry="3.6" transform="rotate(35 30 13)"/><ellipse cx="13" cy="19" rx="2" ry="3.4" transform="rotate(-40 13 19)"/><ellipse cx="27" cy="19" rx="2" ry="3.4" transform="rotate(40 27 19)"/></g>
    <path d="M15,27 Q20,30 25,27" stroke="#b5401f" stroke-width="2.6" fill="none"/>`,
  ore: `<path d="M4,32 L10,17 L18,12 L26,15 L35,30 L30,34 L8,34Z" fill="#7d8896" stroke="#2c333b" stroke-width="1.4" stroke-linejoin="round"/>
    <path d="M10,17 L18,12 L17,24 L4,32Z" fill="#b8c2cf"/><path d="M17,24 L26,15 L35,30 Z" fill="#5a6470"/>
    <path d="M17,24 L8,34 L30,34 L35,30Z" fill="#69737f"/>
    <path d="M21,22 L24,14 L28,22 L24,27Z" fill="#9fd8ff" stroke="#1e5a86" stroke-width="1"/><path d="M24,14 L24,27 L21,22Z" fill="#e6f6ff"/>`,
};
const RES_COL = {
  lumber: ['#4d8b3d', '#1d4a1b'], brick: ['#de6d40', '#8a3015'], wool: ['#c5e690', '#76a640'],
  grain: ['#f7da6c', '#c38d1c'], ore: ['#aeb8c6', '#555f6c'],
};
const iconSVG = (r, cls = '') => `<svg viewBox="0 0 40 40" class="${cls}">${ICON[r]}</svg>`;
function cardHTML(r, mini = false) {
  return `<div class="hexisle-card hexisle-r-${r}${mini ? ' mini' : ''}">${iconSVG(r)}${mini ? '' : `<b>${RES_NAME[r]}</b>`}</div>`;
}
const cardBackHTML = () => '<div class="hexisle-back"></div>';
const devBackHTML = () => '<div class="hexisle-devback"></div>';

const DEV_ICON = {
  knight: `<path d="M20,4 L32,9 L32,20 C32,28 26,33 20,36 C14,33 8,28 8,20 L8,9Z" fill="#7d1f1f" stroke="#f2c14e" stroke-width="1.6"/>
    <path d="M20,8 L20,32 M13,16 L27,16" stroke="#f2c14e" stroke-width="2.4"/>`,
  vp: `<path d="M8,32 H32 M10,32 V18 M16,32 V18 M24,32 V18 M30,32 V18 M7,18 H33 L20,8Z" stroke="#f2c14e" stroke-width="2" fill="none" stroke-linejoin="round"/><circle cx="20" cy="14" r="2" fill="#f2c14e"/>`,
  road: `<path d="M6,30 L18,10" stroke="#8a5a2e" stroke-width="6" stroke-linecap="round"/><path d="M22,30 L34,10" stroke="#8a5a2e" stroke-width="6" stroke-linecap="round"/>
    <path d="M7,28 L17,11 M23,28 L33,11" stroke="#f2c14e" stroke-width="1.4" stroke-dasharray="3 3"/>`,
  plenty: `<path d="M6,14 C10,30 22,34 34,30 L30,22 C22,24 14,20 12,10Z" fill="#c8912e" stroke="#5a3a10" stroke-width="1.4"/>
    <circle cx="11" cy="10" r="4" fill="#e04a3a"/><circle cx="17" cy="9" r="3.4" fill="#f2c14e"/><ellipse cx="8" cy="15" rx="3" ry="2" fill="#6bbf4a"/><path d="M14,30 l-2,-3 M20,32 l-1,-3 M26,32 l0,-3" stroke="#5a3a10" stroke-width="1.2"/>`,
  monopoly: `<path d="M20,6 V34 M10,34 H30" stroke="#f2c14e" stroke-width="2.2"/><path d="M6,12 H34" stroke="#f2c14e" stroke-width="2"/>
    <path d="M6,12 L2,22 H10Z M34,12 L30,22 H38Z" fill="#f2c14e" opacity=".85"/><circle cx="20" cy="6" r="2.4" fill="#f2c14e"/>`,
};
function devCardHTML(t, cls = '') {
  return `<div class="hexisle-dev hexisle-dev-${t} ${cls}"><svg viewBox="0 0 40 40">${DEV_ICON[t]}</svg><b>${DEV[t].name}</b></div>`;
}

const hexPts = (r, cx = 0, cy = 0) => Array.from({ length: 6 }, (_, i) => {
  const a = (Math.PI / 180) * (60 * i - 90);
  return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
}).join(' ');

const TCOL = {
  forest: ['#5c9a42', '#2e5f25', '#1f4419'], hills: ['#d99257', '#a65a2c', '#6e3517'],
  pasture: ['#a9da68', '#68a83c', '#3f7322'], fields: ['#f6dc78', '#d9a933', '#9a7012'],
  mountains: ['#b3b8bf', '#7b828c', '#4c525a'], desert: ['#f3e1ae', '#d6b773', '#a08345'],
};

function boardDefs() {
  const grads = Object.entries(TCOL).map(([t, [a, b]]) =>
    `<linearGradient id="hx-t-${t}" x1="0" y1="0" x2=".25" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`).join('');
  const seats = PCOL.map((P, i) => `
    <linearGradient id="hx-pc${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${P.hi}"/><stop offset=".45" stop-color="${P.c}"/><stop offset="1" stop-color="${P.lo}"/></linearGradient>
    <g id="hx-house-${i}">
      <ellipse cx="3" cy="9" rx="15" ry="5" fill="#000" opacity=".4"/>
      <path d="M9,8 L15,4 L15,-6 L9,-2Z" fill="${P.lo}" stroke="#1a0d05" stroke-width="1" stroke-linejoin="round"/>
      <path d="M-9,8 L9,8 L9,-2 L0,-11 L-9,-2Z" fill="url(#hx-pc${i})" stroke="#1a0d05" stroke-width="1.1" stroke-linejoin="round"/>
      <path d="M0,-11 L6,-15 L15,-6 L9,-2Z" fill="${P.c}" stroke="#1a0d05" stroke-width="1" stroke-linejoin="round"/>
      <path d="M1,-11.4 L6,-14.4 L13,-7" stroke="${P.hi}" stroke-width="1.2" fill="none" opacity=".9"/>
      <path d="M-8,-2 L0,-10" stroke="#fff" stroke-width="1" opacity=".55"/>
      ${SYM[i](0, 2.5, 2.8, P.ink)}
    </g>
    <g id="hx-city-${i}">
      <ellipse cx="2" cy="11" rx="22" ry="6.5" fill="#000" opacity=".4"/>
      <path d="M-7,-10 L-3,-13 L6,-5 L2,-2Z" fill="${P.c}" stroke="#1a0d05" stroke-width="1" stroke-linejoin="round"/>
      <path d="M-16,10 L2,10 L2,-2 L-7,-10 L-16,-2Z" fill="url(#hx-pc${i})" stroke="#1a0d05" stroke-width="1.1" stroke-linejoin="round"/>
      <path d="M-15,-2 L-7,-9.5" stroke="#fff" stroke-width="1" opacity=".55"/>
      <path d="M12,10 L17,6 L17,-17 L12,-14Z" fill="${P.lo}" stroke="#1a0d05" stroke-width="1" stroke-linejoin="round"/>
      <path d="M2,10 L12,10 L12,-14 L2,-14Z" fill="url(#hx-pc${i})" stroke="#1a0d05" stroke-width="1.1" stroke-linejoin="round"/>
      <path d="M2,-14 L7,-27 L12,-14Z" fill="${P.c}" stroke="#1a0d05" stroke-width="1" stroke-linejoin="round"/>
      <path d="M12,-14 L7,-27 L17,-17Z" fill="${P.lo}" stroke="#1a0d05" stroke-width="1" stroke-linejoin="round"/>
      <path d="M3,-14.5 L7,-25" stroke="#fff" stroke-width="1" opacity=".6"/>
      <path d="M5,-2 v-5 a2,2 0 0 1 4,0 v5Z" fill="#2a1608" opacity=".75"/>
      <rect x="-9" y="4" width="4" height="6" rx="1" fill="#2a1608" opacity=".7"/>
      ${SYM[i](-7, -1.5, 2.6, P.ink)}
    </g>`).join('');
  return `<defs>
    <radialGradient id="hx-sea" cx=".5" cy=".45" r=".75"><stop offset="0" stop-color="#3a9ed0"/><stop offset=".55" stop-color="#1b6aa3"/><stop offset="1" stop-color="#0b3763"/></radialGradient>
    <linearGradient id="hx-wood" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9a6838"/><stop offset=".3" stop-color="#5e3a1d"/><stop offset=".55" stop-color="#8a5a30"/><stop offset=".8" stop-color="#4c2e16"/><stop offset="1" stop-color="#7a4e2a"/></linearGradient>
    <linearGradient id="hx-bevel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".75"/><stop offset=".45" stop-color="#fff" stop-opacity=".08"/><stop offset=".6" stop-color="#000" stop-opacity=".05"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></linearGradient>
    <radialGradient id="hx-sheen" cx=".35" cy=".2" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <radialGradient id="hx-tok" cx=".38" cy=".3" r=".8"><stop offset="0" stop-color="#fffaf0"/><stop offset=".6" stop-color="#f0dfb6"/><stop offset="1" stop-color="#cfb07a"/></radialGradient>
    <radialGradient id="hx-badge" cx=".4" cy=".3" r=".8"><stop offset="0" stop-color="#fff6dc"/><stop offset="1" stop-color="#e2c78d"/></radialGradient>
    <radialGradient id="hx-halo" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff8d2" stop-opacity=".95"/><stop offset=".45" stop-color="#ffd76a" stop-opacity=".55"/><stop offset="1" stop-color="#ffc93c" stop-opacity="0"/></radialGradient>
    <radialGradient id="hx-halor" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffe2d6" stop-opacity=".95"/><stop offset=".45" stop-color="#ff8a6a" stop-opacity=".55"/><stop offset="1" stop-color="#ff6b4a" stop-opacity="0"/></radialGradient>
    <linearGradient id="hx-pineg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3d8f3c"/><stop offset=".5" stop-color="#2a6e2d"/><stop offset="1" stop-color="#174a1d"/></linearGradient>
    <linearGradient id="hx-clay" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e58a55"/><stop offset="1" stop-color="#93421c"/></linearGradient>
    <linearGradient id="hx-robg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5a5466"/><stop offset=".45" stop-color="#2a2633"/><stop offset="1" stop-color="#0d0b12"/></linearGradient>
    ${grads}${seats}
    <g id="hx-pine"><ellipse cx="2" cy="0" rx="9" ry="3" fill="#000" opacity=".28"/><rect x="-1.8" y="-5" width="3.6" height="6" fill="#5b3a1e"/>
      <path d="M0,-28 L7,-17 L4,-17 L10,-9 L6,-9 L12,-2 L-12,-2 L-6,-9 L-10,-9 L-4,-17 L-7,-17Z" fill="url(#hx-pineg)" stroke="#123d17" stroke-width=".8" stroke-linejoin="round"/>
      <path d="M0,-28 L-7,-17 L-4,-17 L-10,-9 L-6,-9 L-12,-2 L-3,-2 L-2,-20Z" fill="#b6f08a" opacity=".2"/></g>
    <g id="hx-mound"><path d="M-17,0 C-13,-12 -5,-16 0,-16 C7,-16 14,-10 17,0Z" fill="url(#hx-clay)" stroke="#6e2f12" stroke-width=".8"/>
      <path d="M-17,0 C-13,-12 -5,-16 0,-16 C-6,-12 -9,-6 -10,0Z" fill="#fff" opacity=".2"/>
      <path d="M-9,-6 h6 M2,-10 h6 M-3,-3 h7 M7,-4 h5" stroke="#7a2e12" stroke-width="1.3" opacity=".55"/></g>
    <g id="hx-kiln"><ellipse cx="2" cy="1" rx="15" ry="4" fill="#000" opacity=".28"/><rect x="6" y="-25" width="5" height="12" fill="#8a3a1a" stroke="#4a1a08" stroke-width=".8"/>
      <path d="M-13,0 C-13,-18 13,-18 13,0Z" fill="#c25a2e" stroke="#5a2008" stroke-width="1"/>
      <path d="M-11,-4 h22 M-9,-9 h18 M-5,-13 h10" stroke="#7a2a10" stroke-width="1" opacity=".6"/>
      <path d="M-4,0 v-5 a4,4 0 0 1 8,0 v5Z" fill="#2a0d04"/><path d="M-2,0 v-3 a2,2 0 0 1 4,0 v3Z" fill="#ff9a3a" opacity=".9"/>
      <circle cx="9" cy="-29" r="3" fill="#eee" opacity=".55"/><circle cx="12" cy="-34" r="3.6" fill="#eee" opacity=".4"/></g>
    <g id="hx-sheep"><ellipse cx="1" cy="5" rx="9" ry="2.6" fill="#000" opacity=".25"/><path d="M-5,2 v4 M-1,3 v4 M3,3 v4 M6,2 v4" stroke="#3a332c" stroke-width="1.6" stroke-linecap="round"/>
      <g fill="#fffdf4" stroke="#8a8274" stroke-width=".7"><circle cx="-4" cy="-1" r="4.2"/><circle cx="1" cy="-3.5" r="4.6"/><circle cx="5" cy="-0.5" r="4"/><circle cx="0" cy="1.5" r="4"/></g>
      <ellipse cx="9.5" cy="-2.5" rx="3.2" ry="2.5" fill="#3a332c"/><circle cx="10.4" cy="-3.1" r=".6" fill="#fff"/></g>
    <g id="hx-stalk"><path d="M0,0 V-16 M0,0 L-5,-13 M0,0 L5,-13" stroke="#9a6a12" stroke-width="1.2" fill="none"/>
      <g fill="#ffe27a" stroke="#a87a1a" stroke-width=".6"><ellipse cx="0" cy="-17" rx="1.8" ry="3.4"/><ellipse cx="-5" cy="-14" rx="1.6" ry="3" transform="rotate(-20 -5 -14)"/><ellipse cx="5" cy="-14" rx="1.6" ry="3" transform="rotate(20 5 -14)"/></g></g>
    <g id="hx-peak"><path d="M-22,0 L-3,-34 L3,0Z" fill="#c3c8cf" stroke="#3c4249" stroke-width=".8" stroke-linejoin="round"/><path d="M-3,-34 L22,0 L3,0Z" fill="#6c737d" stroke="#3c4249" stroke-width=".8" stroke-linejoin="round"/>
      <path d="M-3,-34 L-10,-21 L-6,-23 L-3,-19 L0,-23 L5,-20Z" fill="#fff" stroke="#9aa6b5" stroke-width=".6"/><path d="M-3,-34 L-3,-19 L0,-23 L5,-20Z" fill="#dfe6ef"/></g>
    <g id="hx-cactus"><ellipse cx="1" cy="0" rx="7" ry="2" fill="#000" opacity=".25"/><path d="M-2,0 V-18 a2,2 0 0 1 4,0 V0Z M2,-9 h3 V-14 a1.5,1.5 0 0 1 3,0 V-7 H2Z M-2,-6 h-3 V-11 a1.5,1.5 0 0 0 -3,0 V-4 H-2Z" fill="#5e9a44" stroke="#2f5a22" stroke-width=".8"/></g>
    <g id="hx-robber"><ellipse cx="0" cy="0" rx="13" ry="4.5" fill="#000" opacity=".45"/>
      <path d="M-11,0 C-12,-10 -9,-19 -6,-25 C-10,-30 -9,-39 0,-41 C9,-39 10,-30 6,-25 C9,-19 12,-10 11,0Z" fill="url(#hx-robg)" stroke="#000" stroke-width="1.2"/>
      <path d="M-9,-2 C-10,-11 -7,-19 -4,-25 C-7,-30 -6,-37 -1,-39" stroke="#9a92ac" stroke-width="1.4" fill="none" opacity=".6"/>
      <ellipse cx="0" cy="-30" rx="4.6" ry="5.2" fill="#000"/><circle cx="-1.7" cy="-30.5" r=".9" fill="#ffcf5a"/><circle cx="1.7" cy="-30.5" r=".9" fill="#ffcf5a"/>
      <path d="M-6,-25 C-2,-22 2,-22 6,-25" stroke="#000" stroke-width="1.2" fill="none"/></g>
  </defs>`;
}

// Decorations drawn inside a hex (local coordinates, the number token sits at the centre).
const use = (id, x, y, k = 1) => `<use href="#${id}" transform="translate(${x},${y})${k !== 1 ? ` scale(${k})` : ''}"/>`;
function terrainArt(t) {
  switch (t) {
    case 'forest':
      return [[-4, -32, 1], [24, -26, 0.95], [-28, -20, 0.9], [-38, 8, 0.85], [38, 6, 0.9], [-24, 34, 1], [4, 44, 0.9], [28, 34, 1.05], [-12, -42, 0.7], [14, -44, 0.7]]
        .sort((a, b) => a[1] - b[1]).map(([x, y, k]) => use('hx-pine', x, y, k)).join('');
    case 'hills':
      return `<path d="M-50,-4 C-30,-14 -14,-2 0,-8 C14,-14 30,-2 50,-8" stroke="#f3b27a" stroke-width="2" fill="none" opacity=".35"/>
        ${use('hx-kiln', 2, -26)}${use('hx-mound', -32, -6, 0.9)}${use('hx-mound', 33, -4, 0.85)}${use('hx-mound', -24, 36, 1)}${use('hx-mound', 26, 38, 1.05)}${use('hx-mound', 0, 50, 0.7)}`;
    case 'pasture':
      return `<path d="M-60,-10 C-40,-26 -20,-22 0,-30 C20,-38 40,-30 60,-40 V-60 H-60Z" fill="#c4ec86" opacity=".35"/>
        <path d="M-60,30 C-30,14 -10,22 10,16 C30,10 45,20 60,12 V60 H-60Z" fill="#4f8c2a" opacity=".35"/>
        <path d="M-44,-14 h22 M-44,-8 h22 M-40,-16 v10 M-30,-16 v10" stroke="#7a5530" stroke-width="1.4" opacity=".7"/>
        <g fill="#fff6a0" opacity=".8"><circle cx="34" cy="-8" r="1.3"/><circle cx="-10" cy="44" r="1.3"/><circle cx="40" cy="30" r="1.2"/><circle cx="-36" cy="22" r="1.2"/></g>
        ${use('hx-sheep', 4, -34)}${use('hx-sheep', 30, -20, 0.9)}${use('hx-sheep', -30, 26)}${use('hx-sheep', 26, 30, 1.05)}${use('hx-sheep', -2, 44, 0.85)}`;
    case 'fields':
      return `<g stroke-width="7" fill="none" opacity=".55">${[-48, -32, -16, 0, 16, 32, 48].map((o, i) => `<path d="M${o - 30},60 C${o - 14},20 ${o + 10},-20 ${o + 26},-60" stroke="${i % 2 ? '#f9e38c' : '#c99224'}"/>`).join('')}</g>
        ${use('hx-stalk', -26, -22)}${use('hx-stalk', 24, -26, 0.9)}${use('hx-stalk', 34, 16)}${use('hx-stalk', -34, 20, 0.9)}${use('hx-stalk', -4, 48, 0.9)}${use('hx-stalk', 6, -36, 0.8)}`;
    case 'mountains':
      return `${use('hx-peak', 0, -24, 0.85)}${use('hx-peak', -30, -2, 0.95)}${use('hx-peak', 32, 2, 0.9)}${use('hx-peak', -18, 46, 0.75)}${use('hx-peak', 20, 48, 0.8)}
        <g fill="#5d646d" opacity=".8"><circle cx="-40" cy="30" r="2.5"/><circle cx="42" cy="28" r="2"/></g>`;
    case 'desert':
      return `<path d="M-60,-20 C-36,-34 -16,-14 4,-26 C24,-38 40,-24 60,-32" stroke="#fff3cf" stroke-width="3" fill="none" opacity=".6"/>
        <path d="M-60,20 C-40,8 -20,26 0,16 C20,6 40,24 60,12 V60 H-60Z" fill="#c9a35f" opacity=".45"/>
        <path d="M-60,40 C-36,30 -10,46 10,38 C30,30 44,42 60,36" stroke="#b08a48" stroke-width="2" fill="none" opacity=".6"/>
        ${use('hx-cactus', 28, -22)}${use('hx-cactus', -30, 34, 0.8)}<g fill="#e9dcc0" stroke="#9a8a6a" stroke-width=".6"><ellipse cx="-30" cy="-18" rx="4" ry="2.5"/><ellipse cx="36" cy="30" rx="3" ry="2"/></g>`;
  }
  return '';
}

function tokenSVG(n) {
  const red = n === 6 || n === 8;
  const p = pipsOf(n);
  const dots = Array.from({ length: p }, (_, i) => `<circle cx="${((i - (p - 1) / 2) * 3.6).toFixed(1)}" cy="11.5" r="1.45"/>`).join('');
  return `<g class="hexisle-token"><circle cy="3" r="21" fill="#000" opacity=".35"/><circle r="21" fill="url(#hx-tok)" stroke="#6e4f24" stroke-width="1.6"/>
    <circle r="17.5" fill="none" stroke="#b08850" stroke-width=".9" opacity=".6"/>
    <text y="5" text-anchor="middle" font-family="Cinzel, Georgia, serif" font-weight="800" font-size="${n >= 10 ? 17 : 20}" fill="${red ? '#b8231a' : '#3b2a17'}">${n}</text>
    <g fill="${red ? '#b8231a' : '#3b2a17'}">${dots}</g></g>`;
}

/* Cover art: a sunny hex island at sea. A settler hammers the roof onto a new cottage while a
   friend rows in with lumber and a sheep, waving hello (self-contained "hxc-" ids). */
function islandCover() {
  const f1 = (n) => +n.toFixed(1);
  // Squashed hex for the 3/4 view: r across, r * .56 deep, dy pushes it down (tile thickness).
  const hp = (cx, cy, r, dy = 0) => Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 90);
    return `${f1(cx + r * Math.cos(a))},${f1(cy + dy + r * Math.sin(a) * 0.56)}`;
  }).join(' ');
  const HX = [[133.2, 80, 'mountains'], [186.8, 80, 'fields'], [106.3, 106, 'forest'], [160, 106, 'pasture'], [213.7, 106, 'hills'], [133.2, 132, 'fields'], [186.8, 132, 'forest']];
  const tiles = HX.map(([x, y, t]) => {
    const [a, b, c] = TCOL[t];
    return `<polygon points="${hp(x, y, 31, 6.5)}" fill="${c}"/><polygon points="${hp(x, y, 30.2)}" fill="${a}"/>` +
      `<polygon points="${hp(x, y, 25, 2.5)}" fill="${b}" opacity=".3"/><polygon points="${hp(x, y, 28.8)}" fill="none" stroke="url(#hxc-bev)" stroke-width="2"/>`;
  }).join('');
  const pine = (x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})"><ellipse cx="1.5" cy="0" rx="6.5" ry="2" fill="#0d2a12" opacity=".3"/><rect x="-1.1" y="-4" width="2.2" height="4.5" fill="#5b3a1e"/>` +
    `<path d="M0 -21 L6.5 -12 L3.6 -12 L8.5 -4 L-8.5 -4 L-3.6 -12 L-6.5 -12Z" fill="#2f7d35" stroke="#174a1d" stroke-width=".7" stroke-linejoin="round"/><path d="M0 -21 L-6.5 -12 L-3.6 -12 L-8.5 -4 L-2.5 -4 L-1.2 -16Z" fill="#c4f59a" opacity=".25"/></g>`;
  const peak = (x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})"><path d="M-17 0 L-2 -25 L4 0Z" fill="#cdd2da"/><path d="M-2 -25 L17 0 L4 0Z" fill="#717985"/>` +
    `<path d="M-2 -25 L-7.5 -15.5 L-4.5 -17 L-2.2 -14 L.2 -17 L4.4 -14.6Z" fill="#fff"/></g>`;
  const mound = (x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})"><path d="M-11 0 C-9 -7.5 -3.5 -10 0 -10 C4.5 -10 9 -6.5 11 0Z" fill="#c95f30"/>` +
    `<path d="M-11 0 C-9 -7.5 -3.5 -10 0 -10 C-4 -7.5 -6 -4 -6.5 0Z" fill="#fff" opacity=".22"/><path d="M-5 -4 h4 M2 -6 h4 M-1 -2 h5" stroke="#7a2e12" stroke-width=".9" opacity=".6"/></g>`;
  const tuft = (x, y) => `<path d="M${x} ${y} V${y - 9} M${x} ${y} L${x - 3.5} ${y - 7} M${x} ${y} L${x + 3.5} ${y - 7}" stroke="#a8740f" stroke-width="1" fill="none" stroke-linecap="round"/>` +
    `<g fill="#ffe27a" stroke="#b8861a" stroke-width=".4"><ellipse cx="${x}" cy="${y - 10}" rx="1.4" ry="2.6"/><ellipse cx="${x - 3.8}" cy="${y - 8}" rx="1.2" ry="2.2" transform="rotate(-25 ${x - 3.8} ${y - 8})"/><ellipse cx="${x + 3.8}" cy="${y - 8}" rx="1.2" ry="2.2" transform="rotate(25 ${x + 3.8} ${y - 8})"/></g>`;
  const rows = (x, y) => `<path d="M${x - 18} ${y + 2} L${x + 12} ${y - 7} M${x - 14} ${y + 8} L${x + 18} ${y - 1} M${x - 6} ${y + 12} L${x + 18} ${y + 5}" stroke="#c99224" stroke-width="2.4" stroke-linecap="round" opacity=".55"/>`;
  const token = (x, y, n) => `<g transform="translate(${x} ${y}) scale(1 .62)"><circle cy="2.5" r="8.4" fill="#000" opacity=".3"/><circle r="8.4" fill="#f6e8c6" stroke="#6e4f24" stroke-width="1"/>` +
    `<text y="3.6" text-anchor="middle" font-family="Georgia, serif" font-weight="800" font-size="10.5" fill="${n === 6 || n === 8 ? '#b8231a' : '#3b2a17'}">${n}</text></g>`;
  const sheep = (x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})"><path d="M-4 2 v4 M3 2 v4" stroke="#3a332c" stroke-width="1.6" stroke-linecap="round"/>` +
    `<g fill="#fffdf4" stroke="#9a9284" stroke-width=".6"><circle cx="-4" cy="-1" r="4.2"/><circle cx="1" cy="-3.5" r="4.6"/><circle cx="5" cy="-.5" r="4"/><circle cx="0" cy="1.5" r="4"/></g>` +
    `<ellipse cx="9.5" cy="-3" rx="3.3" ry="2.6" fill="#3a332c"/><circle cx="10.4" cy="-3.6" r=".7" fill="#fff"/><path d="M7.6 -5.2 l-2 -1.6" stroke="#3a332c" stroke-width="1.4" stroke-linecap="round"/></g>`;
  const spark = (x, y, r, o = 0.95) => `<path d="M${x} ${y - r} L${f1(x + r * 0.22)} ${f1(y - r * 0.22)} L${x + r} ${y} L${f1(x + r * 0.22)} ${f1(y + r * 0.22)} L${x} ${y + r} L${f1(x - r * 0.22)} ${f1(y + r * 0.22)} L${x - r} ${y} L${f1(x - r * 0.22)} ${f1(y - r * 0.22)}Z" fill="#fff" opacity="${o}"/>`;
  // A cottage: walls up, half the roof tiled, the rest still bare rafters.
  const house = (x, y, s, c, hi, lo, done = true) => `<g transform="translate(${x} ${y}) scale(${s})"><ellipse cx="3" cy="9" rx="15" ry="4.5" fill="#000" opacity=".28"/>` +
    `<path d="M9 8 L15 4 L15 -6 L9 -2Z" fill="${lo}" stroke="#2a0d05" stroke-width=".7" stroke-linejoin="round"/>` +
    `<path d="M-9 8 L9 8 L9 -2 L0 -11 L-9 -2Z" fill="${c}" stroke="#2a0d05" stroke-width=".8" stroke-linejoin="round"/>` +
    `<path d="M-3 8 v-5 a2 2 0 0 1 4 0 v5Z" fill="#3a1608"/><rect x="3" y="0" width="3.6" height="3.4" rx=".6" fill="#ffe7a0"/><path d="M-8 -2 L0 -10" stroke="#fff" stroke-width=".8" opacity=".5"/>` +
    (done ? `<path d="M0 -11 L6 -15 L15 -6 L9 -2Z" fill="${c}" stroke="#2a0d05" stroke-width=".7" stroke-linejoin="round"/><path d="M1 -11.3 L6 -14.4 L13 -7" stroke="${hi}" stroke-width=".9" fill="none"/>`
      : `<path d="M6 -15 L15 -6 M3.4 -13.3 L6 -15 M7.9 -8.8 L10.5 -10.5 M12.4 -4.3 L15 -6" stroke="#c9944e" stroke-width="1.1" stroke-linecap="round"/>` +
        `<path d="M0 -11 L3.4 -13.3 L12.4 -4.3 L9 -2Z" fill="${c}" stroke="#2a0d05" stroke-width=".7" stroke-linejoin="round"/><path d="M1 -11.3 L3.4 -12.8 L11.5 -4.6" stroke="${hi}" stroke-width=".9" fill="none"/>`) + '</g>';
  const waves = [[24, 78], [52, 96], [262, 120], [286, 98], [38, 132], [252, 150], [62, 150], [292, 138], [226, 186], [176, 190]]
    .map(([x, y], i) => `<path d="M${x} ${y} q5 -3.5 10 0 t10 0" stroke="#fff" stroke-width="1.4" fill="none" stroke-linecap="round" opacity="${i % 2 ? 0.35 : 0.55}"/>`).join('');
  return `<svg viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Settlers building a cottage on a sunny hex island while a friend rows in with lumber">
  <defs>
    <linearGradient id="hxc-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#36aef0"/><stop offset=".22" stop-color="#7fd3fb"/><stop offset=".3" stop-color="#d4f3ff"/><stop offset="1" stop-color="#d4f3ff"/></linearGradient>
    <linearGradient id="hxc-sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4fcde4"/><stop offset=".3" stop-color="#22a2cf"/><stop offset=".7" stop-color="#12719f"/><stop offset="1" stop-color="#0b4b80"/></linearGradient>
    <radialGradient id="hxc-sun" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff7cc" stop-opacity=".95"/><stop offset=".4" stop-color="#ffe9a0" stop-opacity=".45"/><stop offset="1" stop-color="#ffe9a0" stop-opacity="0"/></radialGradient>
    <linearGradient id="hxc-bev" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".75"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".45"/></linearGradient>
    <linearGradient id="hxc-hull" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c88448"/><stop offset=".55" stop-color="#9a5a2a"/><stop offset="1" stop-color="#5e3216"/></linearGradient>
    <linearGradient id="hxc-blue" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5b9bf0"/><stop offset="1" stop-color="#2a5fb8"/></linearGradient>
    <linearGradient id="hxc-coral" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff9a6a"/><stop offset="1" stop-color="#e0583a"/></linearGradient>
    <filter id="hxc-b" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="5"/></filter>
    <filter id="hxc-b2" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.2"/></filter>
  </defs>
  <rect width="320" height="200" fill="url(#hxc-sky)"/>
  <circle cx="262" cy="28" r="50" fill="url(#hxc-sun)"/><circle cx="262" cy="28" r="17.5" fill="none" stroke="#fff3c0" stroke-width="1.4" opacity=".6"/><circle cx="262" cy="28" r="13.5" fill="#fff6c8"/>
  <g fill="#fff"><ellipse cx="62" cy="30" rx="22" ry="6.5"/><circle cx="52" cy="26" r="8"/><circle cx="65" cy="22" r="10"/><circle cx="77" cy="27" r="7"/></g><ellipse cx="64" cy="34" rx="20" ry="2.6" fill="#bfe8fb"/>
  <g fill="#fff" opacity=".9"><ellipse cx="190" cy="18" rx="16" ry="4.6"/><circle cx="184" cy="15" r="6"/><circle cx="194" cy="12.5" r="7"/></g>
  <path d="M100 42 q4 -4 8 0 q4 -4 8 0 M120 33 q3 -3 6 0 q3 -3 6 0 M212 44 q3.5 -3.5 7 0 q3.5 -3.5 7 0" stroke="#24496b" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M10 59 C20 50 36 50 48 59Z M280 59 c6 -5.5 18 -5.5 26 0Z" fill="#4f9fa8" opacity=".55"/>
  <path d="M232 57 h12 l-2 2.6 h-8z" fill="#6b4424"/><path d="M238 56.5 V44 L245 55Z" fill="#fff"/><path d="M237.5 56.5 V46 L232 55Z" fill="#f0f4fa"/>
  <rect y="58" width="320" height="142" fill="url(#hxc-sea)"/><rect y="58" width="320" height="1.6" fill="#effcff" opacity=".8"/>
  <g fill="#fff6d0"><ellipse cx="262" cy="64" rx="18" ry="1.2" opacity=".65"/><ellipse cx="262" cy="70" rx="12" ry="1.1" opacity=".5"/><ellipse cx="264" cy="77" rx="20" ry="1.3" opacity=".35"/><ellipse cx="260" cy="86" rx="10" ry="1" opacity=".3"/></g>
  ${waves}
  <g filter="url(#hxc-b)" opacity=".85">${HX.map(([x, y]) => `<polygon points="${hp(x, y, 50, 6)}" fill="#86eaf2"/>`).join('')}</g>
  <g filter="url(#hxc-b2)">${HX.map(([x, y]) => `<polygon points="${hp(x, y, 38, 6)}" fill="#f4e0a6"/>`).join('')}</g>
  ${tiles}
  ${peak(124, 88, 0.95)}${peak(143, 86, 0.8)}
  ${rows(187, 80)}${tuft(177, 86)}${tuft(198, 82)}${token(203, 89, 6)}
  ${pine(110, 100, 1)}${pine(96, 105, 0.95)}${pine(118, 112, 0.9)}${pine(100, 117, 0.85)}
  <ellipse cx="168" cy="118" rx="14" ry="3.5" fill="#c4ec86" opacity=".5"/>
  ${house(216, 98, 1.05, 'url(#hxc-blue)', '#9cc2ff', '#133170')}${mound(206, 115, 1)}${mound(226, 110, 0.85)}
  <path d="M134 117 L157 124.5" stroke="#2a0d05" stroke-width="6" stroke-linecap="round"/><path d="M134 117 L157 124.5" stroke="#d23b26" stroke-width="3.8" stroke-linecap="round"/><path d="M134.5 116 L156.5 123.2" stroke="#ff9a82" stroke-width="1" stroke-linecap="round"/>
  ${house(142, 108, 1.8, '#d23b26', '#ff9a82', '#7c1a0d', false)}
  ${spark(162, 92, 4.5)}
  ${rows(133, 132)}${tuft(124, 140)}${tuft(150, 145)}${token(138, 136, 8)}
  ${pine(192, 139, 0.9)}${pine(178, 143, 0.85)}${pine(203, 146, 0.8)}${pine(188, 149, 0.75)}
  <g>
    <ellipse cx="185" cy="117" rx="9" ry="2.4" fill="#000" opacity=".25"/>
    <rect x="179" y="104" width="5" height="12" rx="2" fill="#2b3566"/><rect x="186" y="104" width="5" height="12" rx="2" fill="#2b3566"/>
    <ellipse cx="181" cy="116.4" rx="3.8" ry="1.8" fill="#3a2412"/><ellipse cx="189" cy="116.4" rx="3.8" ry="1.8" fill="#3a2412"/>
    <path d="M177 106 C177 96 180 90.5 185 90.5 C190 90.5 193 96 193 106Z" fill="url(#hxc-blue)"/><path d="M185 91 V106" stroke="#1e4a94" stroke-width=".8" opacity=".6"/>
    <path d="M190 94 C195 97 196 101 192 104" stroke="#3d7fd9" stroke-width="4.4" fill="none" stroke-linecap="round"/>
    <path d="M180 93.5 C175 90.5 172 85.5 172.5 78.5" stroke="#4a8be6" stroke-width="4.6" fill="none" stroke-linecap="round"/><circle cx="172.6" cy="77" r="2.7" fill="#f1c49a"/>
    <path d="M173 77.5 L164 68.5" stroke="#9b6a3c" stroke-width="2.1" stroke-linecap="round"/><rect x="159.5" y="66.3" width="9" height="4.4" rx="1" fill="#8a929e" stroke="#4a5058" stroke-width=".5" transform="rotate(-45 164 68.5)"/>
    <path d="M155 72 q-3 7 1 13 M150.5 70 q-4 9 1 17" stroke="#fff" stroke-width="1.4" fill="none" stroke-linecap="round" opacity=".9"/>
    <rect x="182.5" y="87.5" width="5" height="4" fill="#d9a77c"/><circle cx="185" cy="83" r="7.2" fill="#f1c49a"/>
    <path d="M178.6 81 q6.4 -2.6 12.8 0 v-2.4 h-12.8z" fill="#7a4a26"/>
    <circle cx="181.6" cy="85.6" r="1.5" fill="#ff7f8f" opacity=".45"/><circle cx="189.2" cy="85.6" r="1.5" fill="#ff7f8f" opacity=".45"/>
    <circle cx="182" cy="83.2" r="1.05" fill="#2a1c1a"/><circle cx="187" cy="83.2" r="1.05" fill="#2a1c1a"/>
    <path d="M181.8 86.4 q2.6 2.4 5.2 0" stroke="#7a2e35" stroke-width="1.1" fill="none" stroke-linecap="round"/>
    <ellipse cx="185" cy="78.2" rx="10.5" ry="2.8" fill="#f2c94c" stroke="#b8862a" stroke-width=".6"/><path d="M179.5 78.2 C179.5 71.5 190.5 71.5 190.5 78.2Z" fill="#f6d667" stroke="#b8862a" stroke-width=".6"/><path d="M179.7 76.5 h10.6" stroke="#e0523f" stroke-width="1.4"/>
  </g>
  <g>
    <path d="M232 168 L304 160 L304 168 L234 177Z" fill="#b07a46"/><path d="M232 168 L304 160" stroke="#e0b07a" stroke-width="1"/><path d="M250 166 l1 9 M268 164 l1 9 M286 162 l1 8" stroke="#6e4422" stroke-width=".8" opacity=".7"/>
    <rect x="236" y="175" width="4" height="16" fill="#6b4424"/><rect x="262" y="172" width="4" height="17" fill="#6b4424"/><rect x="288" y="168" width="4" height="18" fill="#6b4424"/>
    <path d="M232 191 q4 -2.5 8 0 M258 189 q4 -2.5 8 0 M284 186 q4 -2.5 8 0" stroke="#fff" stroke-width="1.2" fill="none" opacity=".6"/>
    <path d="M248 166 C247 158 247 154 248 150 L260 150 C261 154 261 158 260 166Z" fill="#a8683a" stroke="#4a2c14" stroke-width=".7"/><path d="M247.6 154 h12.8 M247.6 162 h12.8" stroke="#3a2412" stroke-width="1.2"/>
    <rect x="270" y="150" width="15" height="13" rx="1.2" fill="#d9a35a" stroke="#6e4422" stroke-width=".7"/><path d="M270 156.5 h15 M277.5 150 v13" stroke="#8a5a2e" stroke-width=".8"/>
    <rect x="291" y="128" width="2.6" height="34" fill="#6b4424"/><circle cx="292.3" cy="128" r="8.5" fill="#6b4424"/><circle cx="292.3" cy="128" r="7" fill="#f6e8c6"/>
    <text x="292.3" y="131" text-anchor="middle" font-family="Georgia, serif" font-weight="800" font-size="7.5" fill="#3b2a17">2:1</text>
  </g>
  <g transform="translate(-6 4)">
    <path d="M42 186 q6 -3 12 0 t12 0 M30 192 q6 -3 12 0 t12 0" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round" opacity=".75"/>
    <ellipse cx="106" cy="191" rx="52" ry="5" fill="#0b3f6e" opacity=".45"/>
    <ellipse cx="106" cy="163.5" rx="46" ry="5.5" fill="#5a3416"/>
    <path d="M70 196 L93 155" stroke="#c58a4a" stroke-width="2.6" stroke-linecap="round"/><ellipse cx="69" cy="195" rx="3.4" ry="7" fill="#c58a4a" transform="rotate(30 69 195)"/>
    <path d="M60 192 q4 -3 8 0 M70 194 q3 -2 6 0" stroke="#fff" stroke-width="1.3" fill="none" stroke-linecap="round"/>
    <g transform="translate(72 151)"><rect x="4" y="-6" width="24" height="7" rx="3.5" fill="#a8743f" stroke="#4a2c14" stroke-width=".8"/><circle cx="7.5" cy="-2.5" r="3.4" fill="#ecc993" stroke="#4a2c14" stroke-width=".7"/>
      <rect x="0" y="0" width="24" height="7" rx="3.5" fill="#9b6a3c" stroke="#4a2c14" stroke-width=".8"/><circle cx="3.5" cy="3.5" r="3.4" fill="#e8c48e" stroke="#4a2c14" stroke-width=".7"/><circle cx="3.5" cy="3.5" r="1.6" fill="none" stroke="#a77443" stroke-width=".6"/></g>
    ${sheep(134, 155, 1.25)}
    <path d="M93 167 C93 151 98 145 105 145 C112 145 117 151 117 167Z" fill="url(#hxc-coral)"/><path d="M99 147 L105 154 L111 147" fill="none" stroke="#fff3d6" stroke-width="1.4" stroke-linejoin="round"/>
    <path d="M97 151 C93 155 90 158 88.5 161" stroke="#f07a52" stroke-width="5" fill="none" stroke-linecap="round"/><circle cx="88.5" cy="161.5" r="3" fill="#e0a57a"/>
    <path d="M113 150 C119 145 123 137 125.5 127" stroke="#f07a52" stroke-width="5" fill="none" stroke-linecap="round"/><circle cx="126" cy="124.5" r="3.6" fill="#e0a57a"/>
    <path d="M131.5 117.5 q4.5 4 2.5 9.5 M135.5 113 q6.5 6 3.5 14.5" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round" opacity=".9"/>
    <rect x="102" y="140" width="6" height="6" fill="#c98a5e"/><circle cx="105" cy="134" r="9.5" fill="#e0a57a"/>
    <path d="M95.6 132.5 C95.6 122.5 114.4 122.5 114.4 132.5 C110.5 129.2 99.5 129.2 95.6 132.5Z" fill="#20b0a0"/><path d="M113.6 129 l5.5 -2.6 l-1.6 5.4z" fill="#1a8f82"/>
    <circle cx="100" cy="137.6" r="2" fill="#ff7f8f" opacity=".4"/><circle cx="110.4" cy="137.6" r="2" fill="#ff7f8f" opacity=".4"/>
    <path d="M99.6 134.2 q1.8 -2 3.6 0 M106.8 134.2 q1.8 -2 3.6 0" fill="none" stroke="#2a1c1a" stroke-width="1.3" stroke-linecap="round"/>
    <path d="M101.6 138.6 q3.4 3.6 6.8 0z" fill="#7a2e35"/>
    <path d="M58 162 L154 162 L152 167.5 L60 167.5Z" fill="#f4e3c0" stroke="#6e4422" stroke-width=".6"/>
    <path d="M60 167.5 L152 167.5 C148 181 132 189.5 106 189.5 C80 189.5 64 181 60 167.5Z" fill="url(#hxc-hull)"/>
    <path d="M63 173 Q106 177.5 149 173 L147.6 177 Q106 181.5 64.6 177Z" fill="#e0523f"/><path d="M68 182 Q106 186 144 182" stroke="#3a1c08" stroke-width=".8" fill="none" opacity=".5"/>
    <path d="M150 182 q6 -3 12 0 t12 0" stroke="#fff" stroke-width="1.4" fill="none" stroke-linecap="round" opacity=".7"/>
  </g>
  ${spark(222, 66, 4)}${spark(46, 118, 3, 0.8)}${spark(276, 104, 3.2, 0.8)}
</svg>`;
}
const COVER = islandCover();

const CSS = `
.hexisle { --hx-gap: 12px; }
.hexisle-main { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
/* Sunny island at sea: turquoise shallows under a warm sun, with drifting wave glints. */
.hexisle-felt { padding: 12px;
  background:
    radial-gradient(55% 42% at 94% -6%, rgba(255, 242, 190, .62), rgba(255, 214, 120, .22) 42%, transparent 72%),
    radial-gradient(70% 50% at -4% 108%, rgba(120, 245, 225, .28), transparent 62%),
    ${WAVES} 0 0 / 132px 84px repeat,
    linear-gradient(180deg, #33b9d2 0%, #1c93c0 32%, #116da3 66%, #0b4b82 100%);
  border-color: rgba(170, 240, 255, .32);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .28), inset 0 0 60px rgba(0, 30, 70, .32), var(--shadow-lg); }
.hexisle-bar { display: flex; align-items: center; gap: 12px; margin: 0 0 10px; min-height: 58px; padding: 7px 8px 7px 12px; border-radius: 16px;
  background: linear-gradient(180deg, rgba(5, 26, 60, .66), rgba(5, 26, 60, .5)); border: 1px solid rgba(255, 255, 255, .13);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .08), 0 6px 18px rgba(0, 25, 60, .22); }
.hexisle-bar .hexisle-says { flex: 1; min-width: 0; }
.hexisle-bar .status { line-height: 1.25; display: flex; align-items: center; gap: 9px; }
.hexisle-hint { font-size: .86rem; color: #d3f1ff; margin-top: 3px; }
.hexisle-dice { flex: none; gap: 10px; padding: 6px 10px; border-radius: 13px; background: rgba(0, 10, 32, .42); box-shadow: inset 0 2px 8px rgba(0, 0, 0, .35), 0 1px 0 rgba(255, 255, 255, .08); }
.hexisle-dice.idle { opacity: .5; }
.hexisle-sum { font-family: var(--font-display); font-weight: 700; font-size: 1.35rem; color: var(--gold); text-shadow: 0 2px 6px rgba(0, 0, 0, .5); min-width: 1.4em; text-align: center; }
.hexisle-sum.seven { color: #ff8a7a; }
.hexisle-felt .winner-banner.hexisle-win { display: flex; align-items: center; gap: 12px; margin: 0; padding: 2px 0; text-align: left; font-size: 1.45rem; line-height: 1.2; }
.hexisle-win .ic { width: 1em; height: 1em; vertical-align: -.12em; }
.hexisle-win .hexisle-face { width: 40px; height: 40px; }
.hexisle-board svg { width: 100%; height: auto; max-height: max(440px, calc(100vh - 250px)); display: block; touch-action: manipulation; user-select: none; -webkit-user-select: none; }
/* The board's layers share exactly the box the single board SVG had, so each maps the viewBox the same way. */
.hexisle-stage { position: relative; width: 100%; aspect-ratio: 640 / 592; max-height: max(440px, calc(100vh - 250px)); container-type: size;
  touch-action: manipulation; user-select: none; -webkit-user-select: none; }
.hexisle-board .hexisle-stage > svg, .hexisle-stage > .hexisle-bake { position: absolute; left: 0; top: 0; width: 100%; height: 100%; max-height: none; display: block; }
.hexisle-stage > .hexisle-bake { object-fit: contain; }
.hexisle-stage > :not(.hexisle-marks) { pointer-events: none; }
/* Waves drift by board units: min(...) is one viewBox unit in px. */
.hexisle-wave { animation: hexisle-wave 5.5s ease-in-out infinite; }
@keyframes hexisle-wave { 0%, 100% { transform: translateX(calc(-5 * min(100cqw / 640, 100cqh / 592))); opacity: .18; } 50% { transform: translateX(calc(6 * min(100cqw / 640, 100cqh / 592))); opacity: .6; } }
.hexisle-glint { animation: hexisle-glint 7s ease-in-out infinite; }
@keyframes hexisle-glint { 0%, 100% { opacity: .05; } 50% { opacity: .22; } }
.hexisle-drop { animation: hexisle-drop .75s cubic-bezier(.3,1.5,.5,1) both; transform-box: fill-box; transform-origin: 50% 100%; }
@keyframes hexisle-drop { 0% { transform: translateY(-70px) scale(1.15); opacity: 0; } 35% { opacity: 1; } 62% { transform: translateY(0) scale(1.12, .84); } 80% { transform: translateY(-6px) scale(.97, 1.04); } 100% { transform: none; } }
.hexisle-flash { animation: hexisle-flash 1.9s ease-out both; pointer-events: none; }
@keyframes hexisle-flash { 0% { opacity: 0; } 12% { opacity: .8; } 30% { opacity: .15; } 48% { opacity: .65; } 100% { opacity: 0; } }
.hexisle-tokpop { animation: hexisle-tokpop .9s cubic-bezier(.3,1.6,.5,1) both; transform-box: fill-box; transform-origin: center; }
.hexisle-tokpop.hexisle-alt { animation-name: hexisle-tokpop2; } /* the next roll's pop restarts on a kept token */
@keyframes hexisle-tokpop { 0% { transform: scale(1); } 30% { transform: scale(1.35); } 100% { transform: scale(1); } }
@keyframes hexisle-tokpop2 { 0% { transform: scale(1); } 30% { transform: scale(1.35); } 100% { transform: scale(1); } }
/* Legal targets: a crisp rim per spot, one soft halo layer breathing behind them (opacity only). */
.hexisle-halos { pointer-events: none; animation: hexisle-breathe 2.6s ease-in-out infinite; }
@keyframes hexisle-breathe { 50% { opacity: .3; } }
.hexisle-mark { pointer-events: none; transform-box: fill-box; transform-origin: center; transition: transform .12s var(--ease); }
.hexisle-hit { cursor: pointer; fill: transparent; }
.hexisle-hit:active + .hexisle-mark { transform: scale(.82); }
.hexisle-hexhit { cursor: pointer; fill: rgba(255, 244, 190, .05); stroke: rgba(255, 242, 180, .95); stroke-width: 3; stroke-dasharray: 8 6;
  transform-box: fill-box; transform-origin: center; transition: transform .12s var(--ease), fill .15s; }
.hexisle-hexhit:active { transform: scale(.96); fill: rgba(255, 244, 190, .24); }
.hexisle-robbed { opacity: .82; }
.hexisle-robber { pointer-events: none; }

.hexisle-bankrow { display: flex; align-items: flex-end; justify-content: center; gap: 10px; flex-wrap: wrap; width: fit-content; max-width: 100%; margin: 10px auto 0; padding: 8px 14px 13px; border-radius: 16px;
  background: rgba(5, 26, 60, .46); border: 1px solid rgba(255, 255, 255, .12); box-shadow: inset 0 1px 0 rgba(255, 255, 255, .06); }
.hexisle-bankrow .hexisle-lbl { font-family: var(--font-display); font-weight: 600; font-size: .74rem; color: #bfe9ff; letter-spacing: .12em; text-transform: uppercase; align-self: center; margin-right: 2px; }
.hexisle-stack { position: relative; width: 34px; height: 46px; }
.hexisle-stack > div { position: absolute; inset: 0; }
.hexisle-stack > div:nth-child(1) { transform: translate(3px, -3px) rotate(4deg); }
.hexisle-stack > div:nth-child(2) { transform: translate(1.5px, -1.5px) rotate(2deg); }
.hexisle-stack .hexisle-cnt { position: absolute; left: 50%; bottom: -9px; transform: translateX(-50%); z-index: 2; background: #121a40; color: #fff; border-radius: 8px; padding: 0 6px;
  font-family: var(--font-display); font-size: .72rem; font-weight: 600; line-height: 1.4; border: 1px solid rgba(255, 255, 255, .35); box-shadow: 0 2px 4px rgba(0, 0, 0, .35); }

.hexisle-card { position: relative; width: 58px; height: 80px; border-radius: 9px; flex: none;
  background: radial-gradient(ellipse at 30% 15%, rgba(255,255,255,.35), transparent 55%), linear-gradient(160deg, var(--c1), var(--c2));
  border: 2px solid #fbf3df; box-shadow: 0 0 0 1px rgba(0,0,0,.55), 0 5px 10px rgba(0,0,0,.45), inset 0 0 10px rgba(0,0,0,.25);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; color: #fff; }
.hexisle-card::before { content: ''; position: absolute; inset: 3px; border-radius: 6px; border: 1px solid rgba(255,255,255,.4); pointer-events: none; }
.hexisle-card svg { width: 74%; height: auto; filter: drop-shadow(0 2px 1px rgba(0,0,0,.35)); }
.hexisle-card b { font-size: .58rem; letter-spacing: .06em; text-transform: uppercase; text-shadow: 0 1px 2px #000, 0 0 4px rgba(0,0,0,.6); }
.hexisle-card.mini { width: 100%; height: 100%; border-width: 1.5px; border-radius: 5px; }
.hexisle-card.mini::before { display: none; }
.hexisle-card.mini svg { width: 82%; }
.hexisle-r-lumber { --c1: ${RES_COL.lumber[0]}; --c2: ${RES_COL.lumber[1]}; }
.hexisle-r-brick { --c1: ${RES_COL.brick[0]}; --c2: ${RES_COL.brick[1]}; }
.hexisle-r-wool { --c1: ${RES_COL.wool[0]}; --c2: ${RES_COL.wool[1]}; }
.hexisle-r-grain { --c1: ${RES_COL.grain[0]}; --c2: ${RES_COL.grain[1]}; }
.hexisle-r-ore { --c1: ${RES_COL.ore[0]}; --c2: ${RES_COL.ore[1]}; }
.hexisle-back, .hexisle-devback { width: 100%; height: 100%; border-radius: 5px; border: 1.5px solid #fbf3df; box-shadow: 0 0 0 1px rgba(0,0,0,.6), 0 3px 6px rgba(0,0,0,.4);
  background: radial-gradient(circle at 50% 50%, #ffd76a 0 16%, #0f4c7a 17% 24%, transparent 25%), repeating-linear-gradient(45deg, rgba(255,255,255,.08) 0 3px, transparent 3px 7px), linear-gradient(160deg, #2a8fc4, #0d3e6e); }
.hexisle-devback { background: radial-gradient(circle at 50% 50%, #f2c14e 0 14%, #2a1a5a 15% 22%, transparent 23%), repeating-linear-gradient(-45deg, rgba(255,255,255,.07) 0 3px, transparent 3px 7px), linear-gradient(160deg, #4a3a9a, #1a1040); }

.hexisle-dock { display: flex; flex-direction: column; gap: 12px; }
.hexisle-dock h4, .hexisle-offer h4 { margin: 0; display: flex; align-items: center; gap: 6px; font-family: var(--font-body); font-weight: 800; color: var(--muted); font-size: .74rem; letter-spacing: .12em; text-transform: uppercase; }
.hexisle-offer h4 .ic { width: 16px; height: 16px; color: var(--gold); }
.hexisle-hand { display: flex; gap: 8px; flex-wrap: wrap; align-items: flex-end; }
.hexisle-slot { display: flex; flex-direction: column; align-items: center; gap: 5px; }
.hexisle-slot .hexisle-card { transition: transform .2s var(--ease); }
.hexisle-slot.zero .hexisle-card { opacity: .32; filter: grayscale(.7); }
.hexisle-num { position: absolute; top: -9px; right: -9px; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center;
  background: linear-gradient(180deg, #2c3d82, #141d45); color: #fff; border: 2px solid #fff;
  font-family: var(--font-display); font-weight: 700; font-size: .85rem; box-shadow: 0 2px 5px rgba(0,0,0,.45); }
.hexisle-step { display: flex; gap: 3px; }
.hexisle-step button { min-height: 38px; min-width: 32px; width: 32px; padding: 0; border-radius: 9px; font-size: 1.15rem; }
.hexisle-sel { position: absolute; left: -8px; bottom: -8px; min-width: 26px; height: 22px; padding: 0 4px; border-radius: 11px; display: grid; place-items: center;
  background: linear-gradient(180deg, #ff8a9c, #d9405a); color: #fff; border: 2px solid #fff; font-weight: 800; font-size: .78rem; box-shadow: 0 2px 5px rgba(0,0,0,.45); }
.hexisle-have { font-size: .68rem; color: var(--muted); font-weight: 700; }
.hexisle-slot.zero .hexisle-num { filter: grayscale(1); opacity: .7; }
.hexisle-side .hexisle-card { width: 51px; height: 71px; }
.hexisle-side .hexisle-hand { gap: 6px; justify-content: space-between; }
.hexisle-modal .hexisle-hand { justify-content: space-between; gap: 4px; }
.hexisle-modal .hexisle-card { width: 50px; height: 68px; }
.hexisle-pickn { font-family: var(--font-display); font-weight: 700; color: var(--gold); min-width: 1.2em; text-align: center; }

.hexisle-devs { display: flex; gap: 8px; flex-wrap: wrap; padding-top: 4px; }
.hexisle-dev { position: relative; width: 64px; height: 88px; border-radius: 9px; padding: 4px; flex: none; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px;
  background: radial-gradient(ellipse at 30% 10%, rgba(255,255,255,.25), transparent 60%), linear-gradient(160deg, #4a3a9a, #1a1040);
  border: 2px solid #f2d68a; box-shadow: 0 0 0 1px #000, 0 5px 10px rgba(0,0,0,.45); color: #fbefd0; text-align: center; }
.hexisle-dev svg { width: 64%; height: auto; }
.hexisle-dev b { font-size: .56rem; line-height: 1.05; letter-spacing: .03em; text-transform: uppercase; font-family: var(--font-display); }
.hexisle-dev-knight { background: radial-gradient(ellipse at 30% 10%, rgba(255,255,255,.25), transparent 60%), linear-gradient(160deg, #5a5f72, #1e2230); }
.hexisle-dev-vp { background: radial-gradient(ellipse at 30% 10%, rgba(255,255,255,.25), transparent 60%), linear-gradient(160deg, #2f7a4e, #0f3a22); }
button.hexisle-devbtn { padding: 0; min-height: 0; background: none; border: none; box-shadow: none; border-radius: 9px; position: relative; transition: transform .2s var(--ease); }
button.hexisle-devbtn:hover:not(:disabled) { background: none; }
button.hexisle-devbtn:disabled { opacity: .6; filter: grayscale(.3); }
button.hexisle-devbtn:active:not(:disabled) { transform: translateY(-2px) scale(.97); }
@media (hover: hover) { button.hexisle-devbtn.ready:hover { transform: translateY(-4px); } }
.hexisle-devbtn .hexisle-tag { position: absolute; left: 50%; bottom: -8px; transform: translateX(-50%); z-index: 2; white-space: nowrap; font-size: .6rem; font-weight: 800; padding: 1px 7px; border-radius: 8px;
  background: #141d45; color: var(--gold); border: 1px solid rgba(255, 207, 92, .5); }
/* Cards you can play now: a warm rim with a slow breath, like the reference game. */
.hexisle-devbtn.ready .hexisle-dev { box-shadow: 0 0 0 2px #ffe27a, 0 5px 12px rgba(0,0,0,.45); }
.hexisle-devbtn.ready::after { content: ''; position: absolute; inset: -2px; border-radius: 11px; pointer-events: none; z-index: 1;
  box-shadow: 0 0 16px 4px rgba(255, 214, 90, .55); animation: hexisle-breathe 2.6s ease-in-out infinite; }

.hexisle-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: stretch; }
.hexisle-actions > button { flex: 1 1 auto; }
.hexisle-actions button:has(> svg) { display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
.hexisle-actions button > svg:not(.ic), .hexisle-row2 button > svg:not(.ic) { width: 18px; height: 18px; flex: none; }
.hexisle-rollbtn { position: relative; min-height: 52px; font-family: var(--font-display); font-size: 1.12rem; font-weight: 600; }
.hexisle-rollbtn .ic { width: 22px; height: 22px; }
.hexisle-rollbtn::after { content: ''; position: absolute; inset: -3px; border-radius: 15px; pointer-events: none; box-shadow: 0 0 20px 4px rgba(124, 108, 255, .55); animation: hexisle-breathe 2.6s ease-in-out infinite; }
.hexisle-rob { display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
.hexisle-rob .hexisle-face { margin-left: -4px; }
.hexisle-builds { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.hexisle-builds button { display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 6px 4px 7px; min-height: 76px; font-size: .78rem;
  transition: transform .2s var(--ease), background-color .15s, border-color .15s, box-shadow .2s; }
.hexisle-builds button:not(:disabled) { border-color: rgba(255, 207, 92, .34); }
/* The piece you are placing lifts off the tray. */
.hexisle-builds button.on { transform: translateY(-5px); color: #fff; border-color: var(--gold);
  background: linear-gradient(180deg, rgba(255, 207, 92, .3), rgba(255, 207, 92, .1));
  box-shadow: 0 0 0 1px var(--gold), 0 12px 24px rgba(0, 0, 0, .4), 0 0 20px rgba(255, 207, 92, .3); }
.hexisle-builds button.on:active { transform: translateY(-3px) scale(.97); }
.hexisle-builds svg.hexisle-piece { width: 30px; height: 26px; }
.hexisle-cost { display: flex; gap: 1px; justify-content: center; flex-wrap: wrap; }
.hexisle-cost .hexisle-card.mini { width: 13px; height: 18px; border-width: 1px; border-radius: 3px; box-shadow: 0 1px 2px rgba(0,0,0,.6); }
.hexisle-row2 { display: flex; gap: 8px; flex-wrap: wrap; }
.hexisle-row2 > button { flex: 1 1 120px; }
.hexisle-dock .hexisle-row2 > button { white-space: nowrap; }
.hexisle-row2 button:has(> svg) { display: inline-flex; align-items: center; justify-content: center; gap: 8px; }

.hexisle-offer { border-radius: 14px; padding: 12px; background: rgba(8, 14, 40, .45); border: 1px solid rgba(255, 207, 92, .35); display: flex; flex-direction: column; gap: 8px; }
.hexisle-offer .hexisle-swap { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.hexisle-mcards { display: flex; gap: 3px; flex-wrap: wrap; }
.hexisle-mcards .hexisle-card.mini { width: 24px; height: 33px; }
.hexisle-reply { display: flex; align-items: center; gap: 8px; padding: 7px 0 2px; border-top: 1px solid var(--line); }

/* Player faces: portrait ringed in the seat colour, seat emblem pinned on. */
.hexisle-face { position: relative; width: 30px; height: 30px; flex: none; border-radius: 50%; box-shadow: 0 0 0 2px var(--pc, #fff), 0 2px 6px rgba(0, 0, 0, .4); }
.hexisle-face .portrait { width: 100%; height: 100%; display: block; border-radius: 50%; }
.hexisle-emb { position: absolute; right: -5px; bottom: -4px; width: 15px; height: 15px; line-height: 0; }
.hexisle-emb svg { width: 100%; height: 100%; display: block; }
.hexisle-face.sm { width: 26px; height: 26px; }
.hexisle-face.sm .hexisle-emb { width: 13px; height: 13px; right: -4px; bottom: -3px; }
.hexisle-players { display: flex; flex-direction: column; gap: 10px; }
.hexisle-plist { display: flex; flex-direction: column; gap: 8px; }
.hexisle-players h3 { margin: 0; display: flex; align-items: center; gap: 7px; font-family: var(--font-body); font-weight: 800; color: var(--muted); font-size: .74rem; letter-spacing: .12em; text-transform: uppercase; }
.hexisle-players h3 .ic { width: 16px; height: 16px; color: var(--brand-2); }
.hexisle-chip { display: block; position: relative; padding: 0; min-width: 0; }
.hexisle-chipin { position: relative; overflow: hidden; border-radius: 11px; padding: 11px 11px 9px; }
.hexisle-chipin::before { content: ''; position: absolute; left: 0; right: 0; top: 0; height: 3px; background: var(--pc); opacity: .9; }
.hexisle-chip.hexisle-me { background: rgba(76, 184, 255, .08); border-color: rgba(76, 184, 255, .32); }
/* The turn ring and the "scored" flash are glows drawn once on pseudo-elements; only their opacity changes. */
.hexisle-chip.turn { box-shadow: none; }
.hexisle-chip::before, .hexisle-chip::after { content: ''; position: absolute; inset: -1px; border-radius: 12px; pointer-events: none; opacity: 0; }
.hexisle-chip::after { box-shadow: 0 0 0 2px var(--gold), 0 0 18px rgba(255, 207, 92, .35); transition: opacity .3s; }
.hexisle-chip.turn::after { opacity: 1; }
.hexisle-chip::before { box-shadow: 0 0 0 2px #fff3b0, 0 0 28px 6px rgba(255, 214, 90, .55); }
.hexisle-chip.hexisle-scored::before { animation: hexisle-scored 1.2s ease-out .5s; }
.hexisle-chip.hexisle-scored.hexisle-alt::before { animation-name: hexisle-scored2; }
@keyframes hexisle-scored { 20% { opacity: 1; } }
@keyframes hexisle-scored2 { 20% { opacity: 1; } }
.hexisle-scored .hexisle-vp { animation: hexisle-vpop .7s var(--spring) .5s; }
.hexisle-scored.hexisle-alt .hexisle-vp { animation-name: hexisle-vpop2; }
@keyframes hexisle-vpop { 30% { transform: scale(1.35); } }
@keyframes hexisle-vpop2 { 30% { transform: scale(1.35); } }
.hexisle-chiptop { display: flex; align-items: center; gap: 8px; }
.hexisle-chiptop .hexisle-seat { flex: none; }
.hexisle-chip .hexisle-pname { font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0; }
.hexisle-chip .hexisle-stats { margin: 4px 0 0 38px; }
.hexisle-chip .hexisle-badges { margin-left: 38px; }
.hexisle-stats { display: flex; gap: 10px; font-size: .8rem; font-weight: 700; color: var(--muted); flex-wrap: wrap; }
.hexisle-stats span { display: inline-flex; align-items: center; gap: 3px; }
.hexisle-stats svg { width: 14px; height: 14px; }
.hexisle-vp { flex: none; display: inline-block; font-family: var(--font-display); font-weight: 700; font-size: 1.45rem; color: var(--gold); line-height: 1; text-shadow: 0 0 14px rgba(255, 207, 92, .35); white-space: nowrap; }
.hexisle-vp small { font-family: var(--font-body); font-weight: 800; font-size: .52rem; letter-spacing: .1em; color: var(--muted); margin-left: 2px; }
.hexisle-badges { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 4px; }
.hexisle-badge { display: inline-flex; align-items: center; gap: 4px; font-size: .64rem; font-weight: 800; letter-spacing: .03em; padding: 2px 8px 2px 5px; border-radius: 999px;
  color: var(--gold); background: rgba(255, 207, 92, .14); border: 1px solid rgba(255, 207, 92, .35); }
.hexisle-badge svg { width: 13px; height: 13px; flex: none; }
.hexisle-wait { font-size: .7rem; color: var(--gold); font-weight: 800; }

/* Island log drawer */
.hexisle-logbox > summary > span:not(.note) { white-space: nowrap; }
.hexisle-logbox > summary .note { min-width: 0; max-width: 60%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hexisle-logbox[open] > summary .note { visibility: hidden; }
.hexisle-logbox .log { max-height: 220px; color: var(--muted); }
.hexisle-logbox .log div { border-bottom-color: var(--line); }
.hexisle-logbox .log div:first-child { color: var(--text); }

.hexisle-modal { position: relative; }
.hexisle-modal h3 { color: var(--text); margin: 0 0 10px; padding-right: 48px; }
.hexisle-x { position: absolute; top: 12px; right: 12px; z-index: 2; }
.hexisle-still, .hexisle-still .modal { animation: none; }
.hexisle-modal::before { display: none; }
.hexisle-tabs { display: flex; gap: 6px; margin-bottom: 12px; padding: 4px; border-radius: 14px; background: rgba(5, 10, 30, .42); border: 1px solid var(--line); }
.hexisle-tabs button { flex: 1; background: transparent; border-color: transparent; box-shadow: none; color: var(--muted); }
.hexisle-tabs button.on { color: #fff; background: linear-gradient(135deg, var(--brand), #6a7dff 50%, var(--brand-2) 130%); box-shadow: var(--glow-brand); }
.hexisle-pick { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; margin: 6px 0 12px; }
.hexisle-pick button { padding: 8px 2px 6px; min-height: 0; display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: .72rem;
  background: rgba(255, 255, 255, .04); border-color: var(--line); box-shadow: none; transition: transform .2s var(--ease), background-color .15s, border-color .15s, box-shadow .2s; }
.hexisle-pick button.on { transform: translateY(-4px); border-color: var(--gold); background: rgba(255, 207, 92, .14);
  box-shadow: 0 0 0 1px var(--gold), 0 10px 20px rgba(0, 0, 0, .35), 0 0 16px rgba(255, 207, 92, .35); }
.hexisle-pick .hexisle-card { width: 44px; height: 60px; }
.hexisle-pick .hexisle-card b { display: none; }
.hexisle-lbl2 { font-size: .74rem; color: var(--muted); font-weight: 800; text-transform: uppercase; letter-spacing: .1em; }

.hexisle-show { position: fixed; z-index: 125; pointer-events: none; perspective: 900px; width: 120px; height: 166px; }
.hexisle-show .in { position: relative; width: 100%; height: 100%; transform-style: preserve-3d; animation: hexisle-flip 2.4s cubic-bezier(.3,.9,.3,1) forwards; }
.hexisle-show .in > div { position: absolute; inset: 0; backface-visibility: hidden; -webkit-backface-visibility: hidden; }
.hexisle-show .front { transform: rotateY(0deg); }
.hexisle-show .backf { transform: rotateY(180deg); }
.hexisle-show .hexisle-dev { width: 100%; height: 100%; border-width: 3px; border-radius: 14px; }
.hexisle-show .hexisle-dev b { font-size: .85rem; }
.hexisle-show .hexisle-dev i { font-style: normal; font-size: .62rem; opacity: .9; padding: 0 6px; }
.hexisle-show .hexisle-devback { border-radius: 14px; border-width: 3px; }
@keyframes hexisle-flip {
  0% { transform: translateY(40px) rotateY(180deg) scale(.6); opacity: 0; }
  15% { transform: translateY(0) rotateY(180deg) scale(1); opacity: 1; }
  40% { transform: rotateY(0deg) scale(1.08); }
  80% { transform: rotateY(0deg) scale(1); opacity: 1; }
  100% { transform: translateY(-50px) rotateY(0deg) scale(.9); opacity: 0; }
}

@media (max-width: 900px) {
  .hexisle-side { display: contents; }
  .hexisle-players { order: -1; padding: 10px; }
  .hexisle-players h3 { display: none; }
  .hexisle-dock { order: 1; }
  .hexisle-logbox { order: 3; }
  .hexisle-side .hexisle-card { width: 58px; height: 80px; }
  .hexisle-players .hexisle-plist { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .hexisle-board svg, .hexisle-stage { max-height: none; }
}
@media (max-width: 480px) {
  .hexisle-felt { padding: 6px; }
  .hexisle-bar { margin: 0 0 6px; gap: 6px; min-height: 50px; padding: 5px 6px 5px 8px; border-radius: 13px; }
  .hexisle-bar .status { font-size: .95rem; gap: 7px; }
  .hexisle-hint { font-size: .78rem; }
  .hexisle-card, .hexisle-side .hexisle-card { width: 54px; height: 75px; }
  .hexisle-hand { gap: 6px; justify-content: space-between; }
  .hexisle-builds { gap: 5px; }
  .hexisle-builds button { font-size: .68rem; min-height: 72px; padding: 5px 2px; }
  .hexisle-felt .winner-banner.hexisle-win { font-size: 1.1rem; gap: 8px; }
  .hexisle-win .hexisle-face { width: 32px; height: 32px; }
  .hexisle-cost { gap: 0; }
  .hexisle-cost .hexisle-card.mini { width: 12px; height: 17px; }
  .hexisle-players { padding: 8px; }
  .hexisle-players .hexisle-chipin { padding: 9px 7px 6px; }
  .hexisle-chip .hexisle-pname { font-size: .82rem; }
  .hexisle-chiptop { gap: 6px; }
  .hexisle-chip .hexisle-face { width: 26px; height: 26px; }
  .hexisle-chip .hexisle-face .hexisle-emb { width: 13px; height: 13px; right: -4px; bottom: -3px; }
  .hexisle-chip .tag.t-you { display: none; }
  .hexisle-chip .hexisle-stats, .hexisle-chip .hexisle-badges { margin-left: 0; }
  .hexisle-vp { font-size: 1.2rem; }
  .hexisle-dice .die3d { --die: 28px !important; }
  .hexisle-dice { gap: 7px; padding: 4px 6px; }
  .hexisle-stats { gap: 6px; font-size: .72rem; }
  .hexisle-stack { width: 28px; height: 38px; }
  .hexisle-bankrow { gap: 6px; padding: 6px 8px 12px; margin-top: 8px; }
  .hexisle-bankrow .hexisle-lbl { display: none; }
}
`;

/* ---------------- board rendering ---------------- */
const SEA_SPOTS = (() => {
  const out = [];
  const dirs = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  let q = -3, r = 3;
  for (let d = 0; d < 6; d++) for (let k = 0; k < 3; k++) {
    out.push([HR * SQ3 * (q + r / 2), HR * 1.5 * r]);
    q += dirs[d][0]; r += dirs[d][1];
  }
  out.push([-282, -258], [282, -258], [-282, 258], [282, 258], [-300, 0], [300, 0], [-150, -276], [150, 276]);
  const badges = HARBOR_SPOTS.map((h) => [EDGES[h.e].x + h.nx * 36, EDGES[h.e].y + h.ny * 36]);
  return out.filter(([x, y]) => Math.abs(x) < 300 && Math.abs(y) < 282 && badges.every(([bx, by]) => Math.hypot(bx - x, by - y) > 48));
})();

function roadSVG(e, seat) {
  const P = PCOL[seat % 4];
  const A = VERTS[EDGES[e].a], B = VERTS[EDGES[e].b];
  const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L;
  let nx = -uy, ny = ux;
  if (ny > 0.01 || (Math.abs(ny) <= 0.01 && nx > 0)) { nx = -nx; ny = -ny; }
  const s = 12, w = 5.5;
  const p1 = [A.x + ux * s, A.y + uy * s], p2 = [B.x - ux * s, B.y - uy * s];
  const q = (p, k, ox = 0, oy = 0) => `${(p[0] + nx * k + ox).toFixed(1)},${(p[1] + ny * k + oy).toFixed(1)}`;
  return `<polygon points="${q(p1, w, 2, 4)} ${q(p2, w, 2, 4)} ${q(p2, -w, 2, 4)} ${q(p1, -w, 2, 4)}" fill="#000" opacity=".4"/>
    <polygon points="${q(p1, w)} ${q(p2, w)} ${q(p2, -w)} ${q(p1, -w)}" fill="${P.c}" stroke="#1a0d05" stroke-width="1.3" stroke-linejoin="round"/>
    <polygon points="${q(p1, w - 0.8)} ${q(p2, w - 0.8)} ${q(p2, 0)} ${q(p1, 0)}" fill="${P.hi}" opacity=".55"/>
    <polygon points="${q(p1, -1.5)} ${q(p2, -1.5)} ${q(p2, -w + 0.8)} ${q(p1, -w + 0.8)}" fill="${P.lo}" opacity=".6"/>`;
}

function harborSVG(hb, i) {
  const sp = HARBOR_SPOTS[i], E = EDGES[hb.e];
  const bx = E.x + sp.nx * 36, by = E.y + sp.ny * 36;
  const piers = [E.a, E.b].map((vi) => {
    const V = VERTS[vi];
    const sx = V.x + sp.nx * 4, sy = V.y + sp.ny * 4;
    const ex = bx + (sx - bx) * 0.25, ey = by + (sy - by) * 0.25;
    return `<line x1="${sx.toFixed(1)}" y1="${sy.toFixed(1)}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}" stroke="#3a2412" stroke-width="8" stroke-linecap="round"/>
      <line x1="${sx.toFixed(1)}" y1="${sy.toFixed(1)}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}" stroke="#b5865a" stroke-width="5" stroke-dasharray="3.5 1.8"/>`;
  }).join('');
  const any = hb.t === 'any';
  const inner = any
    ? `<text x="${bx.toFixed(1)}" y="${(by + 3).toFixed(1)}" text-anchor="middle" font-family="Cinzel, Georgia, serif" font-weight="800" font-size="12" fill="#3b2a17">3:1</text>
       <text x="${bx.toFixed(1)}" y="${(by + 11).toFixed(1)}" text-anchor="middle" font-family="Nunito, sans-serif" font-weight="800" font-size="6" fill="#6a4a22" letter-spacing=".5">ANY</text>
       <path d="M${bx - 4},${by - 10} h8 M${bx},${by - 12} v6" stroke="#6a4a22" stroke-width="1.4"/>`
    : `<svg x="${(bx - 9).toFixed(1)}" y="${(by - 15).toFixed(1)}" width="18" height="18" viewBox="0 0 40 40">${ICON[hb.t]}</svg>
       <text x="${bx.toFixed(1)}" y="${(by + 11).toFixed(1)}" text-anchor="middle" font-family="Cinzel, Georgia, serif" font-weight="800" font-size="9.5" fill="#3b2a17">2:1</text>`;
  return `<g class="hexisle-harbor">${piers}
    <circle cx="${bx.toFixed(1)}" cy="${(by + 3).toFixed(1)}" r="17" fill="#000" opacity=".35"/>
    <circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="17" fill="#6b4424" stroke="#2a1608" stroke-width="1.5"/>
    <circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="14" fill="url(#hx-badge)" stroke="#3a2412" stroke-width=".8"/>${inner}</g>`;
}

/* The blurred shallows, beach and tile shadows never change (the hexes always sit in the same
   places), so they are blurred once into bitmaps instead of by live SVG filters on every paint.
   1 bitmap pixel per board unit: the content is soft, so scaling it up looks the same. */
const BAKES = {};
// Software canvases: a GPU canvas would get a compositor layer of its own and push the board above it
// into layers too, which changes how its text is smoothed.
const CPU = { willReadFrequently: true };
// Some browsers (older Safari) ignore canvas filters; there the blur is done in script instead.
let canvasBlur = null;
function hasCanvasBlur() {
  if (canvasBlur === null) {
    const x = Object.assign(document.createElement('canvas'), { width: 9, height: 9 }).getContext('2d', CPU);
    x.filter = 'blur(2px)';
    x.fillRect(5, 0, 4, 9);
    canvasBlur = x.getImageData(3, 4, 1, 1).data[3] > 0; // blurred: the edge has spread to here
  }
  return canvasBlur;
}
// One box-blur pass over `lines` lines of `len` values (radius r, outside counts as transparent).
function boxPass(src, dst, lines, len, lineStep, step, r) {
  const k = 1 / (2 * r + 1);
  for (let l = 0; l < lines; l++) {
    const o = l * lineStep;
    let acc = 0;
    for (let i = 0; i <= r && i < len; i++) acc += src[o + i * step];
    for (let i = 0; i < len; i++) {
      dst[o + i * step] = acc * k;
      if (i + r + 1 < len) acc += src[o + (i + r + 1) * step];
      if (i - r >= 0) acc -= src[o + (i - r) * step];
    }
  }
}
// Three box blurs in a row give a Gaussian blur of standard deviation sigma, closely enough for soft shapes.
function blurMask(a, w, h, sigma) {
  let wl = Math.floor(Math.sqrt(4 * sigma * sigma + 1));
  if (wl % 2 === 0) wl--;
  const m = Math.round((12 * sigma * sigma - 3 * wl * wl - 12 * wl - 9) / (-4 * wl - 4));
  const tmp = new Float32Array(a.length);
  for (let i = 0; i < 3; i++) {
    const r = ((i < m ? wl : wl + 2) - 1) / 2;
    boxPass(a, tmp, h, w, w, 1, r); // rows
    boxPass(tmp, a, w, h, 1, w, r); // columns
  }
  return a;
}
function bakeCanvas(kind) {
  if (BAKES[kind]) return BAKES[kind];
  const W = 640, H = 592;
  const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const g = c.getContext('2d', CPU);
  // One path for all 19 hexes, so they blur (and fade) as one shape, like a filtered SVG group.
  const path = (x, r, dx, dy) => {
    x.beginPath();
    for (const h of HEXES) {
      hexPts(r, h.x + dx, h.y + dy).split(' ').forEach((p, i) => { const [px, py] = p.split(',').map(Number); x[i ? 'lineTo' : 'moveTo'](px + 320, py + 296); });
      x.closePath();
    }
  };
  const layer = (r, dx, dy, color, blur, alpha) => {
    g.save();
    g.globalAlpha = alpha;
    if (hasCanvasBlur()) {
      g.filter = `blur(${blur}px)`;
      g.fillStyle = color;
      path(g, r, dx, dy);
      g.fill();
    } else {
      // Draw the shape's mask, blur it, and paint it in the colour.
      const t = Object.assign(document.createElement('canvas'), { width: W, height: H }), x = t.getContext('2d', CPU);
      path(x, r, dx, dy);
      x.fill();
      const img = x.getImageData(0, 0, W, H), d = img.data;
      const a = new Float32Array(W * H);
      for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
      blurMask(a, W, H, blur);
      const [cr, cg, cb] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
      for (let i = 0; i < a.length; i++) { d[i * 4] = cr; d[i * 4 + 1] = cg; d[i * 4 + 2] = cb; d[i * 4 + 3] = a[i]; }
      x.putImageData(img, 0, 0);
      g.drawImage(t, 0, 0);
    }
    g.restore();
  };
  if (kind === 'shore') { layer(84, 0, 0, '#7fd3ec', 7, 0.6); layer(69, 0, 0, '#ecd9a2', 3, 1); }
  else layer(60, 2, 9, '#1a0f05', 3, 0.5);
  return (BAKES[kind] = c);
}
// Each board shows the bitmaps in two canvas layers, copied from the baked ones (a cheap copy, no image
// encoding). Redraws keep the canvases, so this happens once per board. "contain" maps them like the viewBox.
const painted = new WeakSet();
function paintBakes(el) {
  for (const cv of el.querySelectorAll('canvas.hexisle-bake')) {
    if (painted.has(cv)) continue;
    painted.add(cv);
    const kind = cv.dataset.bake;
    const paint = () => { const x = cv.getContext('2d', CPU); x.clearRect(0, 0, cv.width, cv.height); x.drawImage(bakeCanvas(kind), 0, 0); };
    cv.oncontextrestored = () => { delete BAKES[kind]; paint(); }; // the GPU dropped the bitmaps: bake again
    paint();
  }
}
const BAKE_DIV = (kind) => `<canvas class="hexisle-bake hexisle-${kind}" data-bake="${kind}" width="640" height="592" aria-hidden="true"></canvas>`;

/* The board is a stack of layers that share one viewBox: sea, glints, waves, shore, harbors, tile
   shadows, the island itself, then target halos and tap targets. The endless glints, waves and the
   halo breathing each animate a whole layer's opacity/transform, which the compositor does on its
   own, so the island is not repainted 60 times a second. */
const VB = '-320 -296 640 592';
const layerSVG = (cls, body, attrs = ' aria-hidden="true"') => `<svg viewBox="${VB}" xmlns="http://www.w3.org/2000/svg" class="${cls}"${attrs}>${body}</svg>`;
const SEA_LAYERS = [
  layerSVG('hexisle-sea', `<rect x="-316" y="-292" width="632" height="584" rx="44" fill="url(#hx-sea)" stroke="url(#hx-wood)" stroke-width="8"/>
    <rect x="-310" y="-286" width="620" height="572" rx="39" fill="none" stroke="#000" stroke-opacity=".35" stroke-width="3"/>`),
  layerSVG('hexisle-glint', '<ellipse cx="-150" cy="-190" rx="120" ry="40" fill="#fff"/>'),
  layerSVG('hexisle-glint', '<ellipse cx="170" cy="200" rx="110" ry="34" fill="#fff"/>', ' style="animation-delay:-3s" aria-hidden="true"'),
  ...SEA_SPOTS.map(([x, y], i) => layerSVG('hexisle-wave',
    `<path d="M${(x - 16).toFixed(0)},${y.toFixed(0)} q8,-6 16,0 t16,0" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>`,
    ` style="animation-delay:${(-i * 0.73).toFixed(2)}s" aria-hidden="true"`)),
  BAKE_DIV('shore'),
].join('');

function boardSVG(v, T, me) {
  const out = ['<div class="hexisle-stage">', SEA_LAYERS, layerSVG('hexisle-harbors', v.harbors.map(harborSVG).join('')), BAKE_DIV('shade'),
    `<svg viewBox="${VB}" xmlns="http://www.w3.org/2000/svg" class="hexisle-svg" role="img" aria-label="Island board">`, boardDefs(),
    `<defs><clipPath id="hx-clip"><polygon points="${hexPts(57.5)}"/></clipPath></defs>`];
  const fl = ui.flash && Date.now() - ui.flash.at < 2900 ? ui.flash : null;
  // Kept nodes keep their running animation, so the delay is the one they were created with.
  const fdelay = fl ? fl.delay : 0;
  HEXES.forEach((h, i) => {
    const hx = v.hexes[i];
    const flashing = fl && fl.hexes.includes(i);
    out.push(`<g transform="translate(${h.x.toFixed(1)},${h.y.toFixed(1)})">
      <polygon points="${hexPts(58.5, 0, 6)}" fill="${TCOL[hx.t][2]}"/>
      <polygon points="${hexPts(58.5)}" fill="url(#hx-t-${hx.t})" data-a="hex-${i}"/>
      <g clip-path="url(#hx-clip)">${terrainArt(hx.t)}</g>
      <polygon points="${hexPts(58.5)}" fill="url(#hx-sheen)"/>
      <polygon points="${hexPts(57)}" fill="none" stroke="url(#hx-bevel)" stroke-width="3"/>
      ${i === v.robber ? `<polygon id="hx-robshade" points="${hexPts(58.5)}" fill="#120a1a" opacity=".28"/>` : ''}
      ${flashing ? `<polygon id="hx-flash-${i}-${fl.seq}" class="hexisle-flash" style="animation-delay:${fdelay}ms" points="${hexPts(58)}" fill="#fff4b8"/>` : ''}
      ${hx.n ? `<g${flashing ? ` class="hexisle-tokpop${fl.seq % 2 ? ' hexisle-alt' : ''}" style="animation-delay:${fdelay}ms"` : ''}>${tokenSVG(hx.n)}</g>` : ''}
    </g>`);
  });
  // roads, then buildings, then the robber
  const keys = new Set();
  const isNew = (k) => { keys.add(k); return ui.prevKeys && !ui.prevKeys.has(k); };
  v.rd.forEach((o, e) => {
    if (o === null) return;
    const k = `rd-${e}`;
    out.push(`<g data-k="${k}" data-noenter><g class="${isNew(k) ? 'hexisle-drop' : ''}">${roadSVG(e, v.ps[o].seat)}</g></g>`);
  });
  const blds = v.vb.map((b, i) => [b, i]).filter(([b]) => b).sort((a, b) => VERTS[a[1]].y - VERTS[b[1]].y);
  for (const [b, i] of blds) {
    const k = `pc-${i}${b.city ? 'c' : ''}`;
    out.push(`<g data-k="${k}" data-noenter><g class="${isNew(k) ? 'hexisle-drop' : ''}"><use href="#hx-${b.city ? 'city' : 'house'}-${v.ps[b.p].seat}" transform="translate(${VERTS[i].x},${VERTS[i].y}) scale(1.35)"/></g></g>`);
  }
  ui.prevKeys = keys;
  const rh = HEXES[v.robber];
  out.push(`<use data-k="robber" class="hexisle-robber" href="#hx-robber" x="${(rh.x + 30).toFixed(1)}" y="${(rh.y + 16).toFixed(1)}"/>`);
  // Legal targets: a crisp rim on each spot, plus one soft halo layer that breathes (opacity only).
  // The hit area comes first so pressing it can dip the marker drawn right after it.
  const halos = [], marks = [];
  T.h.forEach((i) => {
    const H = HEXES[i];
    halos.push(`<polygon points="${hexPts(55, H.x, H.y)}" fill="#fff3b8" fill-opacity=".07" stroke="#ffd76a" stroke-opacity=".42" stroke-width="7" stroke-linejoin="round"/>`);
    marks.push(`<polygon class="hexisle-hexhit" data-hit="h:${i}" points="${hexPts(54, H.x, H.y)}"/>`);
  });
  T.e.forEach((e) => {
    const A = VERTS[EDGES[e].a], B = VERTS[EDGES[e].b], E = EDGES[e];
    const ax = A.x + (B.x - A.x) * 0.28, ay = A.y + (B.y - A.y) * 0.28, bx = B.x - (B.x - A.x) * 0.28, by = B.y - (B.y - A.y) * 0.28;
    const ln = `x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke-linecap="round"`;
    halos.push(`<line ${ln} stroke="#ffe08a" stroke-width="26" stroke-opacity=".28"/><line ${ln} stroke="#fff3c0" stroke-width="16" stroke-opacity=".45"/>`);
    marks.push(`<circle class="hexisle-hit" data-hit="e:${e}" cx="${E.x.toFixed(1)}" cy="${E.y.toFixed(1)}" r="28"/>
      <g class="hexisle-mark"><line ${ln} stroke="#0e1530" stroke-width="13" opacity=".5"/><line ${ln} stroke="#ffc93c" stroke-width="9.5"/><line ${ln} stroke="#fffdf0" stroke-width="4.5"/></g>`);
  });
  T.v.forEach((vi) => {
    const V = VERTS[vi];
    halos.push(`<circle cx="${V.x}" cy="${V.y}" r="21" fill="url(#hx-halo)"/>`);
    marks.push(`<circle class="hexisle-hit" data-hit="v:${vi}" cx="${V.x}" cy="${V.y}" r="30"/>
      <g class="hexisle-mark"><circle cx="${V.x}" cy="${V.y}" r="10.5" fill="#ffc93c" stroke="#0e1530" stroke-width="2.5"/><circle cx="${V.x}" cy="${V.y}" r="5" fill="#fffdf0"/></g>`);
  });
  T.c.forEach((vi) => {
    const V = VERTS[vi];
    halos.push(`<circle cx="${V.x}" cy="${V.y - 2}" r="30" fill="url(#hx-halo)"/>`);
    marks.push(`<circle class="hexisle-hit" data-hit="c:${vi}" cx="${V.x}" cy="${V.y}" r="30"/>
      <g class="hexisle-mark"><circle cx="${V.x}" cy="${V.y - 2}" r="19" fill="none" stroke="#0e1530" stroke-opacity=".45" stroke-width="6"/><circle cx="${V.x}" cy="${V.y - 2}" r="19" fill="none" stroke="#fff3c0" stroke-width="3.5"/></g>`);
  });
  T.s.forEach(([vi, idx]) => {
    const V = VERTS[vi];
    halos.push(`<circle cx="${V.x}" cy="${V.y - 2}" r="30" fill="url(#hx-halor)"/>`);
    marks.push(`<circle class="hexisle-hit" data-hit="s:${idx}" cx="${V.x}" cy="${V.y}" r="30"/>
      <g class="hexisle-mark"><circle cx="${V.x}" cy="${V.y - 2}" r="19" fill="none" stroke="#0e1530" stroke-opacity=".45" stroke-width="6"/><circle cx="${V.x}" cy="${V.y - 2}" r="19" fill="none" stroke="#ff9a7a" stroke-width="3.5"/></g>`);
  });
  out.push('</svg>');
  if (halos.length) out.push(layerSVG('hexisle-halos', halos.join('')));
  if (marks.length) out.push(layerSVG('hexisle-marks', marks.join('')));
  void me;
  out.push('</div>');
  return out.join('');
}

/* ---------------- side panel & dock ---------------- */
const ui = { key: '', mode: null, modal: null, tab: 'bank', bGive: null, bGet: null, give: zeroRes(), want: zeroRes(), disc: zeroRes(), plenty: [], prevKeys: null, flash: null };
let prevVP = new Map(); // player id -> VP at the last render, for the "scored" flash
const scoreAlt = {}; // player id -> which of the two flash animations plays next
let logOpen = typeof matchMedia === 'function' ? matchMedia('(min-width: 901px)').matches : true;

const SMALL = {
  cards: '<svg viewBox="0 0 16 16"><rect x="2" y="3" width="8" height="11" rx="1.5" fill="#c9b18c" transform="rotate(-10 6 8)"/><rect x="6" y="2" width="8" height="11" rx="1.5" fill="#f1e2bf" stroke="#6b4a2a" stroke-width=".8"/></svg>',
  dev: '<svg viewBox="0 0 16 16"><rect x="3" y="1.5" width="10" height="13" rx="1.6" fill="#4a3a9a" stroke="#f2d68a" stroke-width="1"/><circle cx="8" cy="8" r="2.2" fill="#f2c14e"/></svg>',
  sword: '<svg viewBox="0 0 16 16"><path d="M12.5,1.5 L14.5,3.5 L6,12 L4,10Z" fill="#d8dde4" stroke="#4a5058" stroke-width=".7"/><path d="M3,9 L7,13 M2.5,12 L4,13.5" stroke="#9a6a2a" stroke-width="2" stroke-linecap="round"/></svg>',
  road: '<svg viewBox="0 0 16 16"><path d="M2,12 L14,4" stroke="#8a5a2e" stroke-width="4" stroke-linecap="round"/><path d="M3,11.3 L13,4.7" stroke="#e6c48e" stroke-width="1" stroke-linecap="round"/></svg>',
};

function statusOf(v, me) {
  const cur = curId(v), cn = esc(nameOf(v, cur)), mine = cur === me;
  const P = v.ps[me];
  if (v.over) return ['', ''];
  switch (v.phase) {
    case 'setup':
      if (!mine) return [`${cn} is settling…`, 'Setup runs in snake order: 1→last, then back again.'];
      if (v.sub === 'settle') return ['Place a settlement', v.step >= v.order.length ? 'Your second settlement collects its neighbouring resources.' : 'Tap a glowing corner. Buildings need at least one road gap.'];
      return ['Place a road', 'Tap a glowing edge next to your new settlement.'];
    case 'roll':
      if (!mine) return [`${cn} is about to roll…`, 'Hexes matching the roll produce for adjacent buildings.'];
      return ['Your turn — roll the dice', P && canPlay(v, me, 'knight') ? 'You may play a Knight before rolling.' : 'Settlements collect 1 card, cities collect 2.'];
    case 'discard':
      if (v.discard[me]) return [`Discard ${v.discard[me]} cards`, 'A 7 was rolled and you hold more than 7 cards.'];
      return ['Robber! Waiting for discards…', esc(Object.keys(v.discard).map((p) => nameOf(v, p)).join(', ')) + ' must discard half.'];
    case 'robber':
      return mine ? ['Move the robber', 'Tap a hex to block it — then steal from a neighbour.'] : [`${cn} is moving the robber…`, ''];
    case 'steal':
      return mine ? ['Choose who to rob', 'Tap a glowing building or a name below.'] : [`${cn} is choosing a victim…`, ''];
    case 'roads':
      return mine ? [`Place ${v.free} free road${v.free > 1 ? 's' : ''}`, 'Road Building: tap a glowing edge.'] : [`${cn} is building roads…`, ''];
    case 'main':
      if (v.trade && v.trade.replies[me] === null) return [`${cn} offers you a trade`, 'Accept or decline below.'];
      if (!mine) return [`${cn}'s turn`, v.trade ? 'A trade offer is on the table.' : ''];
      if (ui.mode) return [`Build a ${ui.mode}`, 'Tap a glowing spot, or Cancel.'];
      if (v.trade) return ['Your offer is on the table', 'Trade with a player who accepted, or cancel.'];
      return ['Build, trade or end turn', `You have ${vpOf(v, me)} VP — first to ${WIN_VP} on their turn wins.`];
  }
  return ['', ''];
}

function chipsHTML(v, me, ctx) {
  const due = turnOf(v);
  return v.order.map((p) => {
    const P = v.ps[p];
    const vp = vpOf(v, p, true);
    const had = prevVP.get(p);
    const scored = had != null && vp > had; // one-off flash when this player's points go up
    // Redraws keep the chip, so a second flash in a row switches animation name to play again.
    if (scored) scoreAlt[p] = !scoreAlt[p];
    const badges = [v.longest === p ? `<span class="hexisle-badge">${SMALL.road}Longest Road</span>` : '', v.army === p ? `<span class="hexisle-badge">${SMALL.sword}Largest Army</span>` : '',
      v.phase === 'discard' && v.discard[p] ? '<span class="hexisle-wait">discarding…</span>' : '',
      v.trade && v.trade.replies[p] === 'yes' ? '<span class="hexisle-wait">accepted</span>' : ''].join('');
    return `<div class="pchip hexisle-chip${due.includes(p) && !v.over ? ' turn' : ''}${p === me ? ' hexisle-me' : ''}${scored ? ` hexisle-scored${scoreAlt[p] ? ' hexisle-alt' : ''}` : ''}" style="--pc:${PCOL[P.seat % 4].c}"><div class="hexisle-chipin">
      <div class="hexisle-chiptop">${faceHTML(v, p, ctx)}<span class="hexisle-pname">${esc(P.name)}</span>${p === me ? '<span class="tag t-you">You</span>' : ''}
        <span class="hexisle-vp" data-a="p-${p}-vp">${vp}<small>VP</small></span></div>
      <div class="hexisle-stats"><span data-a="p-${p}-hand" title="Resource cards">${SMALL.cards}${P.nRes}</span><span data-a="p-${p}-dev" title="Development cards">${SMALL.dev}${P.nDev}</span><span title="Knights played">${SMALL.sword}${P.knights}</span><span title="Longest road">${SMALL.road}${v.roadLen[p] || 0}</span></div>
      ${badges ? `<div class="hexisle-badges">${badges}</div>` : ''}</div></div>`;
  }).join('');
}

const miniCards = (m) => RES.flatMap((r) => rep(cardHTML(r, true), m[r] || 0)).join('');
const costHTML = (c) => `<span class="hexisle-cost">${miniCards(c)}</span>`;
const pieceIcon = (kind, seat) => {
  if (kind === 'road') { const P = PCOL[seat % 4]; return `<svg class="hexisle-piece" viewBox="0 0 30 26"><path d="M5,20 L25,8" stroke="#1a0d05" stroke-width="8" stroke-linecap="round"/><path d="M5,20 L25,8" stroke="${P.c}" stroke-width="5.6" stroke-linecap="round"/><path d="M5.5,18.6 L24.5,7.2" stroke="${P.hi}" stroke-width="1.6" stroke-linecap="round" opacity=".8"/></svg>`; }
  if (kind === 'dev') return `<svg class="hexisle-piece" viewBox="0 0 30 26"><rect x="8" y="1.5" width="15" height="22" rx="2.5" fill="#4a3a9a" stroke="#f2d68a" stroke-width="1.4"/><circle cx="15.5" cy="12.5" r="3.5" fill="#f2c14e"/></svg>`;
  return `<svg class="hexisle-piece" viewBox="-20 -30 40 46"><use href="#hx-${kind === 'city' ? 'city' : 'house'}-${seat % 4}"/></svg>`;
};

function handHTML(v, me) {
  const P = v.ps[me];
  const disc = v.phase === 'discard' && v.discard[me];
  const slots = RES.map((r) => {
    const n = P.res[r];
    const step = disc ? `<div class="hexisle-step"><button class="small" data-disc="${r}" data-d="-1" ${ui.disc[r] ? '' : 'disabled'} aria-label="Keep one ${RES_NAME[r]}">−</button><button class="small" data-disc="${r}" data-d="1" ${ui.disc[r] < n ? '' : 'disabled'} aria-label="Discard one ${RES_NAME[r]}">+</button></div>` : '';
    return `<div class="hexisle-slot${n ? '' : ' zero'}"><div class="hexisle-card hexisle-r-${r}">${iconSVG(r)}<b>${RES_NAME[r]}</b><span class="hexisle-num">${n}</span>${disc && ui.disc[r] ? `<span class="hexisle-sel">−${ui.disc[r]}</span>` : ''}</div>${step}</div>`;
  }).join('');
  let devs = '';
  if (P.dev && P.dev.length) {
    const canNow = (c) => turnOf(v).includes(me) && curId(v) === me && !v.devUsed && !v.trade && c.t !== 'vp' && c.turn < v.turn && (v.phase === 'main' || (v.phase === 'roll' && c.t === 'knight'));
    devs = `<div class="hexisle-devs">${P.dev.map((c, i) => {
      const ok = canNow(c);
      const tag = c.t === 'vp' ? '+1 VP' : c.turn >= v.turn ? 'new' : ok ? 'play' : '';
      return `<button class="hexisle-devbtn${ok ? ' ready' : ''}" data-dev="${c.t}" data-i="${i}" ${ok ? '' : 'disabled'} title="${esc(DEV[c.t].desc)}">${devCardHTML(c.t)}${tag ? `<span class="hexisle-tag">${tag}</span>` : ''}</button>`;
    }).join('')}</div>`;
  }
  const discBar = disc ? `<div class="hexisle-row2"><button class="primary" id="hx-disc" ${total(ui.disc) === disc ? '' : 'disabled'}>Discard ${total(ui.disc)} / ${disc}</button></div>` : '';
  return `<div><h4>Your hand</h4></div><div class="hexisle-hand">${slots}</div>${discBar}${devs ? `<h4>Development cards</h4>${devs}` : ''}`;
}

function offerHTML(v, me, ctx) {
  const tr = v.trade, cur = curId(v);
  let body = `<div class="hexisle-swap">${faceHTML(v, cur, ctx, 'sm')}<b>${esc(nameOf(v, cur))}</b> gives <span class="hexisle-mcards">${miniCards(tr.give)}</span> for <span class="hexisle-mcards">${miniCards(tr.want)}</span></div>`;
  if (me === cur) {
    body += Object.keys(tr.replies).map((p) => {
      const r = tr.replies[p];
      return `<div class="hexisle-reply">${faceHTML(v, p, ctx, 'sm')}<span class="grow">${esc(nameOf(v, p))}</span>${r === 'yes' ? `<button class="good small" data-with="${esc(p)}">Trade</button>` : `<span class="muted small">${r === 'no' ? 'declined' : 'thinking…'}</span>`}</div>`;
    }).join('');
    body += '<div class="hexisle-row2"><button class="bad small" id="hx-cancel">Cancel offer</button></div>';
  } else if (tr.replies[me] === null) {
    const can = hasRes(v.ps[me].res, tr.want);
    body += `<div class="hexisle-row2"><button class="good" id="hx-yes" ${can ? '' : 'disabled'}>${can ? 'Accept' : "Can't afford"}</button><button class="bad" id="hx-no">Decline</button></div>`;
  } else if (tr.replies[me]) body += `<div class="muted small">You ${tr.replies[me] === 'yes' ? 'accepted' : 'declined'}.</div>`;
  return `<div class="hexisle-offer"><h4>${SWAP_IC}Trade offer</h4>${body}</div>`;
}

function actionsHTML(v, me, ctx) {
  const P = v.ps[me], cur = curId(v), mine = cur === me && !v.over;
  if (v.over) return '';
  if (v.trade) return offerHTML(v, me, ctx);
  if (!mine) return '';
  if (v.phase === 'roll') {
    return `<div class="hexisle-actions"><button class="primary hexisle-rollbtn" id="hx-roll">${icon('dice')}Roll dice</button>${canPlay(v, me, 'knight') ? `<button id="hx-knight">${SMALL.sword}Play Knight</button>` : ''}</div>`;
  }
  if (v.phase === 'roads') return '<div class="hexisle-actions"><button id="hx-skip">Skip remaining roads</button></div>';
  if (v.phase === 'steal') return `<div class="hexisle-actions">${v.victims.map((p, i) => `<button class="bad hexisle-rob" data-steal="${i}">${faceHTML(v, p, ctx, 'sm')}Rob ${esc(nameOf(v, p))} (${v.ps[p].nRes})</button>`).join('')}</div>`;
  if (v.phase !== 'main') return '';
  const u = used(v, me), seat = P.seat;
  const can = {
    road: hasRes(P.res, COST.road) && u.road < LIMIT.road && roadSpots(v, me).length > 0,
    settlement: hasRes(P.res, COST.settlement) && u.settlement < LIMIT.settlement && settleSpots(v, me, false).length > 0,
    city: hasRes(P.res, COST.city) && u.city < LIMIT.city && u.settlement > 0,
    dev: hasRes(P.res, COST.dev) && v.deckCount > 0,
  };
  const left = { road: LIMIT.road - u.road, settlement: LIMIT.settlement - u.settlement, city: LIMIT.city - u.city, dev: v.deckCount };
  const label = { road: 'Road', settlement: 'Settlement', city: 'City', dev: 'Dev card' };
  const tiles = ['road', 'settlement', 'city', 'dev'].map((k) => `<button data-build="${k}" class="${ui.mode === k ? 'on' : ''}" ${can[k] || ui.mode === k ? '' : 'disabled'}>
      ${pieceIcon(k, seat)}<span>${label[k]} <span class="muted small">${left[k]}</span></span>${costHTML(COST[k])}</button>`).join('');
  return `<div class="hexisle-builds">${tiles}</div>
    <div class="hexisle-row2">${ui.mode ? `<button id="hx-cancelmode">${icon('close')}Cancel build</button>` : `<button id="hx-trade">${SWAP_IC}Trade</button>`}<button class="primary" id="hx-end">End turn</button></div>`;
}

function stepper(kind, r, n, max) {
  return `<div class="hexisle-slot${n ? '' : ' zero'}"><div class="hexisle-card hexisle-r-${r}">${iconSVG(r)}<b>${RES_NAME[r]}</b><span class="hexisle-num">${n}</span></div><div class="hexisle-step"><button class="small" data-st="${kind}" data-r="${r}" data-d="-1" ${n ? '' : 'disabled'}>−</button><button class="small" data-st="${kind}" data-r="${r}" data-d="1" ${n < max ? '' : 'disabled'}>+</button></div>${kind === 'give' ? `<span class="hexisle-have">of ${max}</span>` : ''}</div>`;
}
function modalHTML(v, me) {
  const P = v.ps[me];
  if (!ui.modal || !P) { ui.shown = null; return ''; }
  let body = '';
  if (ui.modal === 'trade') {
    const rt = rates(v, me);
    const tabs = `<div class="hexisle-tabs"><button class="small ${ui.tab === 'bank' ? 'on' : ''}" data-tab="bank">Bank &amp; harbors</button><button class="small ${ui.tab === 'players' ? 'on' : ''}" data-tab="players">Players</button></div>`;
    if (ui.tab === 'bank') {
      if (ui.bGive && P.res[ui.bGive] < rt[ui.bGive]) ui.bGive = null;
      if (ui.bGet && (ui.bGet === ui.bGive || v.bank[ui.bGet] < 1)) ui.bGet = null;
      body = `${tabs}<div class="hexisle-lbl2">You give</div><div class="hexisle-pick">${RES.map((r) => `<button data-bg="${r}" class="${ui.bGive === r ? 'on' : ''}" ${P.res[r] >= rt[r] ? '' : 'disabled'}>${cardHTML(r)}<span>${rt[r]}:1 · ${P.res[r]}</span></button>`).join('')}</div>
        <div class="hexisle-lbl2">You get</div><div class="hexisle-pick">${RES.map((r) => `<button data-bt="${r}" class="${ui.bGet === r ? 'on' : ''}" ${r !== ui.bGive && v.bank[r] > 0 ? '' : 'disabled'}>${cardHTML(r)}<span>bank ${v.bank[r]}</span></button>`).join('')}</div>
        <div class="hexisle-row2"><button class="primary" id="hx-banktrade" ${ui.bGive && ui.bGet ? '' : 'disabled'}>${ui.bGive && ui.bGet ? `Trade ${rt[ui.bGive]} ${RES_NAME[ui.bGive]} → 1 ${RES_NAME[ui.bGet]}` : 'Pick what to give and get'}</button><button id="hx-close">Close</button></div>`;
    } else {
      RES.forEach((r) => { ui.give[r] = Math.min(ui.give[r], P.res[r]); });
      const ok = total(ui.give) > 0 && total(ui.want) > 0 && !RES.some((r) => ui.give[r] && ui.want[r]);
      body = `${tabs}<div class="hexisle-lbl2">You give</div><div class="hexisle-hand">${RES.map((r) => stepper('give', r, ui.give[r], P.res[r])).join('')}</div>
        <div class="hexisle-lbl2" style="margin-top:10px">You want</div><div class="hexisle-hand">${RES.map((r) => stepper('want', r, ui.want[r], 9)).join('')}</div>
        <div class="hexisle-row2" style="margin-top:12px"><button class="primary" id="hx-offer" ${ok ? '' : 'disabled'}>Offer to everyone</button><button id="hx-close">Close</button></div>`;
    }
    body = `<h3>Trade</h3>${body}`;
  } else if (ui.modal === 'plenty') {
    body = `<h3>Year of Plenty</h3><p class="muted small">Take any 2 resources from the bank.</p>
      <div class="hexisle-pick">${RES.map((r) => `<button data-pl="${r}" ${v.bank[r] > ui.plenty.filter((x) => x === r).length ? '' : 'disabled'}>${cardHTML(r)}<span>${RES_NAME[r]}</span></button>`).join('')}</div>
      <div class="row"><span class="hexisle-lbl2">Chosen:</span><span class="hexisle-mcards">${ui.plenty.map((r) => cardHTML(r, true)).join('')}</span></div>
      <div class="hexisle-row2" style="margin-top:12px"><button class="primary" id="hx-plenty" ${ui.plenty.length === 2 ? '' : 'disabled'}>Take them</button><button id="hx-plclear">Clear</button><button id="hx-close">Close</button></div>`;
  } else if (ui.modal === 'mono') {
    body = `<h3>Monopoly</h3><p class="muted small">Name a resource: every opponent hands you all of theirs.</p>
      <div class="hexisle-pick">${RES.map((r) => `<button data-mono="${r}">${cardHTML(r)}<span>${RES_NAME[r]}</span></button>`).join('')}</div>
      <div class="hexisle-row2"><button id="hx-close">Close</button></div>`;
  }
  const again = ui.shown === ui.modal;
  ui.shown = ui.modal;
  return `<div class="modal-bg${again ? ' hexisle-still' : ''}" id="hx-modalbg"><div class="modal panel hexisle-modal"><button class="icon-btn hexisle-x" data-close aria-label="Close">${icon('close')}</button>${body}</div></div>`;
}

function showDevPlayed(el, v) {
  const L = v.lastDev;
  const b = el.querySelector('.hexisle-board');
  if (!L || !b || typeof document === 'undefined') return;
  const r = b.getBoundingClientRect();
  const d = document.createElement('div');
  d.className = 'hexisle-show';
  const top = Math.max(10, Math.min(innerHeight - 180, r.top + r.height / 2 - 83));
  d.style.left = r.left + r.width / 2 - 60 + 'px';
  d.style.top = top + 'px';
  d.innerHTML = `<div class="in"><div class="front"><div class="hexisle-dev hexisle-dev-${L.t}"><svg viewBox="0 0 40 40">${DEV_ICON[L.t]}</svg><b>${DEV[L.t].name}</b><i>${esc(nameOf(v, L.p))}</i></div></div><div class="backf"><div class="hexisle-devback"></div></div></div>`;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 2500);
}

function render(el, v, ctx) {
  injectCSS(ID, CSS);
  const me = ctx.me;
  const P = v.ps[me];
  const due = turnOf(v);
  const mine = !v.over && curId(v) === me;
  const key = `${me}|${v.turn}|${v.phase}|${v.sub}|${v.over}`;
  if (key !== ui.key) {
    ui.key = key;
    ui.mode = null;
    ui.disc = zeroRes();
    ui.plenty = [];
    if (!(ui.modal === 'trade' && v.phase === 'main' && mine)) ui.modal = null;
  }
  if (!mine || v.phase !== 'main' || v.trade) ui.mode = null;
  if (ui.modal === 'trade' && (v.trade || !mine)) ui.modal = null;
  if (P && ui.mode && !hasRes(P.res, COST[ui.mode])) ui.mode = null;

  const rolled = changed('hexisle-roll', v.rollSeq) && v.rollSeq > 0;
  if (rolled && v.lastRoll !== 7) ui.flash = { at: Date.now(), seq: v.rollSeq, delay: null, hexes: v.hexes.map((h, i) => (h.n === v.lastRoll && i !== v.robber ? i : -1)).filter((i) => i >= 0) };
  // The flash starts 1.05 s after the roll. Its nodes are kept between redraws (and keep their running
  // animation), so the delay is fixed when they are first drawn.
  const fl = ui.flash && Date.now() - ui.flash.at < 2900 ? ui.flash : null;
  if (fl && (fl.delay == null || (fl.hexes.length && !el.querySelector(`#hx-flash-${fl.hexes[0]}-${fl.seq}`)))) fl.delay = 1050 - (Date.now() - fl.at);
  const devPlayed = changed('hexisle-dev', v.devSeq) && v.devSeq > 0;

  const T = { v: [], e: [], h: [], c: [], s: [] };
  if (P && due.includes(me) && !v.over) {
    if (v.phase === 'setup') {
      if (v.sub === 'settle') T.v = settleSpots(v, me, true);
      else if (v.last >= 0) T.e = VERTS[v.last].edges.filter((e) => v.rd[e] === null);
    } else if (v.phase === 'robber') T.h = HEXES.map((_, i) => i).filter((i) => i !== v.robber);
    else if (v.phase === 'roads') T.e = roadSpots(v, me);
    else if (v.phase === 'steal') HEXES[v.robber].v.forEach((vi) => { const b = v.vb[vi]; if (b && v.victims.includes(b.p)) T.s.push([vi, v.victims.indexOf(b.p)]); });
    else if (v.phase === 'main' && !v.trade) {
      if (ui.mode === 'road') T.e = roadSpots(v, me);
      if (ui.mode === 'settlement') T.v = settleSpots(v, me, false);
      if (ui.mode === 'city') v.vb.forEach((b, i) => { if (b && b.p === me && !b.city) T.c.push(i); });
    }
  }

  const [st, hint] = statusOf(v, me);
  const sum = v.dice[0] + v.dice[1];
  const banner = v.over ? `<div class="winner-banner hexisle-win">${faceHTML(v, v.winners[0], ctx)}<span>${icon('trophy')} ${esc(nameOf(v, v.winners[0]))} wins with ${vpOf(v, v.winners[0])} VP!</span></div>` : '';
  // Redraw only what changed: morph keeps every node that is already right.
  morph(el, `<div class="game-layout hexisle">
    <div class="hexisle-main">
      <div class="felt hexisle-felt">
        <div class="hexisle-bar">
          <div class="hexisle-says">${banner}${st ?`<div class="status${mine || due.includes(me) ? ' myturn' : ''}">${v.over ? '' : faceHTML(v, curId(v), ctx, 'sm')}<span>${st}</span></div>` : ''}${hint ? `<div class="hexisle-hint">${hint}</div>` : ''}</div>
          <div class="dice-tray hexisle-dice${v.rollSeq ? '' : ' idle'}">${dieHTML(v.dice[0], 34)}${dieHTML(v.dice[1], 34)}<span class="hexisle-sum${sum === 7 ? ' seven' : ''}">${v.rollSeq ? sum : ''}</span></div>
        </div>
        <div class="board-wrap hexisle-board">${boardSVG(v, T, me)}</div>
        <div class="hexisle-bankrow" data-a="hexisle-bank"><span class="hexisle-lbl">Bank</span>
          ${RES.map((r) => `<div class="hexisle-stack" data-a="bank-${r}" title="${RES_NAME[r]}">${cardHTML(r, true)}${cardHTML(r, true)}${cardHTML(r, true)}<span class="hexisle-cnt">${v.bank[r]}</span></div>`).join('')}
          <div class="hexisle-stack" data-a="hexisle-deck" title="Development cards">${devBackHTML()}${devBackHTML()}${devBackHTML()}<span class="hexisle-cnt">${v.deckCount}</span></div>
        </div>
      </div>
    </div>
    <div class="side hexisle-side">
      <div class="panel hexisle-players"><h3>${icon('users')}Players</h3><div class="hexisle-plist">${chipsHTML(v, me, ctx)}</div></div>
      ${P ? `<div class="panel hexisle-dock">${actionsHTML(v, me, ctx)}${handHTML(v, me)}</div>` : ''}
      <details class="panel drawer hexisle-logbox" ${logOpen ? 'open' : ''}><summary>${icon('book')}<span>Island log</span><span class="note">${esc(v.log[0] || '')}</span>${icon('chevron', 'chev')}</summary>
        <div class="drawer-body"><div class="log">${v.log.map((l) => `<div>${esc(l)}</div>`).join('')}</div></div></details>
    </div>
  </div>${modalHTML(v, me)}`);
  paintBakes(el);

  // The log folds away on phones so the island gets the screen; it stays as the player left it.
  // Handlers are properties: the nodes are kept between redraws, so listeners would pile up.
  const logbox = el.querySelector('.hexisle-logbox');
  if (logbox) logbox.ontoggle = (e) => { logOpen = e.currentTarget.open; };
  prevVP = new Map(v.order.map((p) => [p, vpOf(v, p, true)]));
  if (rolled) { const tray = el.querySelector('.hexisle-dice'); if (tray) rollDice(tray); }
  if (devPlayed) showDevPlayed(el, v);

  const send = (a) => ctx.send(a);
  const hits = el.querySelector('.hexisle-marks');
  if (hits) hits.onclick = (e) => {
    const t = e.target.closest('[data-hit]');
    if (!t) return;
    const [k, val] = t.dataset.hit.split(':');
    const n = +val;
    sound('click');
    if (k !== 'e' || v.phase !== 'main') ui.mode = null;
    if (k === 'v') send(v.phase === 'setup' ? { type: 'settle', v: n } : { type: 'build', what: 'settlement', at: n });
    else if (k === 'e') send(v.phase === 'setup' ? { type: 'road', e: n } : { type: 'build', what: 'road', at: n });
    else if (k === 'c') send({ type: 'build', what: 'city', at: n });
    else if (k === 'h') send({ type: 'robber', h: n });
    else if (k === 's') send({ type: 'steal', target: v.victims[n] });
  };
  const on = (sel, fn) => el.querySelectorAll(sel).forEach((b) => (b.onclick = (e) => { sound('click'); fn(b, e); }));
  const rerender = () => render(el, v, ctx);
  on('#hx-roll', () => send({ type: 'roll' }));
  on('#hx-knight', () => send({ type: 'play', card: 'knight' }));
  on('#hx-end', () => { ui.mode = null; send({ type: 'end' }); });
  on('#hx-skip', () => send({ type: 'skip' }));
  on('[data-steal]', (b) => send({ type: 'steal', target: v.victims[+b.dataset.steal] }));
  on('[data-build]', (b) => {
    const k = b.dataset.build;
    if (k === 'dev') { ui.mode = null; send({ type: 'buydev' }); return; }
    ui.mode = ui.mode === k ? null : k;
    rerender();
    const bd = ui.mode && el.querySelector('.hexisle-board');
    if (bd) {
      const r = bd.getBoundingClientRect();
      if (r.top < 40 || r.bottom > innerHeight) bd.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });
  on('#hx-cancelmode', () => { ui.mode = null; rerender(); });
  on('#hx-trade', () => { ui.modal = 'trade'; rerender(); });
  on('#hx-close', () => { ui.modal = null; rerender(); });
  on('.hexisle-x', () => { ui.modal = null; rerender(); });
  const bg = el.querySelector('#hx-modalbg');
  if (bg) bg.onclick = (e) => { if (e.target === bg) { ui.modal = null; rerender(); } };
  const mod = el.querySelector('.hexisle-modal');
  if (mod) {
    if (bg.classList.contains('hexisle-still')) mod.scrollTop = ui.mscroll || 0;
    else ui.mscroll = 0;
    mod.onscroll = () => { ui.mscroll = mod.scrollTop; };
  }
  on('[data-tab]', (b) => { ui.tab = b.dataset.tab; rerender(); });
  on('[data-bg]', (b) => { ui.bGive = b.dataset.bg; if (ui.bGet === ui.bGive) ui.bGet = null; rerender(); });
  on('[data-bt]', (b) => { ui.bGet = b.dataset.bt; rerender(); });
  on('#hx-banktrade', () => { const a = { type: 'bank', give: ui.bGive, get: ui.bGet }; send(a); });
  on('[data-st]', (b) => {
    const m = b.dataset.st === 'give' ? ui.give : ui.want;
    const r = b.dataset.r;
    m[r] = Math.max(0, m[r] + +b.dataset.d);
    if (m[r]) (b.dataset.st === 'give' ? ui.want : ui.give)[r] = 0;
    rerender();
  });
  on('#hx-offer', () => { const a = { type: 'offer', give: { ...ui.give }, want: { ...ui.want } }; ui.modal = null; ui.give = zeroRes(); ui.want = zeroRes(); send(a); });
  on('[data-with]', (b) => send({ type: 'accept', with: b.dataset.with }));
  on('#hx-cancel', () => send({ type: 'cancel' }));
  on('#hx-yes', () => send({ type: 'reply', yes: true }));
  on('#hx-no', () => send({ type: 'reply', yes: false }));
  on('[data-disc]', (b) => { const r = b.dataset.disc; ui.disc[r] = Math.max(0, Math.min(P.res[r], ui.disc[r] + +b.dataset.d)); rerender(); });
  on('#hx-disc', () => { const c = { ...ui.disc }; ui.disc = zeroRes(); send({ type: 'discard', cards: c }); });
  on('[data-dev]', (b) => {
    const t = b.dataset.dev;
    if (t === 'plenty') { ui.modal = 'plenty'; ui.plenty = []; rerender(); return; }
    if (t === 'monopoly') { ui.modal = 'mono'; rerender(); return; }
    send({ type: 'play', card: t });
  });
  on('[data-pl]', (b) => { if (ui.plenty.length < 2) ui.plenty.push(b.dataset.pl); rerender(); });
  on('#hx-plclear', () => { ui.plenty = []; rerender(); });
  on('#hx-plenty', () => { const rs = ui.plenty.slice(); ui.modal = null; ui.plenty = []; send({ type: 'play', card: 'plenty', res: rs }); });
  on('[data-mono]', (b) => { ui.modal = null; send({ type: 'play', card: 'monopoly', res: b.dataset.mono }); });
}

export default {
  id: ID,
  name: 'Isle of Hexes',
  emoji: '🏝️',
  description: 'Settle a sun-drenched hex island, haggle for lumber and ore, and race your rivals to 10 victory points with roads, cities and clever cards.',
  minPlayers: 2,
  maxPlayers: 4,
  cover: COVER,
  options: [levelOption()],
  setup,
  act(s, pid, a) { actInner(s, pid, a); checkWin(s); },
  turnOf,
  view,
  bot,
  render,
  defaultTimer: 30,
  onTimeout,
  howTo: {
    goal: 'Be the first to reach <b>10 victory points</b> on your own turn. Settlements are worth 1, cities 2, plus bonus cards and awards.',
    turn: [
      ['🏠', 'Start: place 2 settlements', 'Everyone places a settlement and a road, twice (the order snakes back). Your second settlement gives you its neighbouring resources.'],
      ['🎲', 'Roll the dice', 'Every tile showing that number produces: each settlement on its corner gets 1 card, each city 2. Red 6s and 8s roll most often.'],
      ['🔨', 'Build', '<b>Road</b> lumber + brick · <b>Settlement</b> lumber + brick + wool + grain (at least 2 roads apart from any building) · <b>City</b> upgrade 2 grain + 3 ore · <b>Development card</b> wool + grain + ore.'],
      ['🤝', 'Trade', 'With the bank 4 : 1, or 3 : 1 / 2 : 1 at a harbor you have built on. Or post an offer to the other players.'],
      ['⏭️', 'End your turn', 'Tap End turn. If a turn timer is on, your turn ends by itself when it runs out.'],
    ],
    tips: [
      '<b>Rolled a 7?</b> Anyone holding more than 7 cards discards half. The roller moves the hooded robber to a tile (it stops producing) and steals a card from someone there.',
      '<b>Development cards:</b> Knight (move the robber), Road Building, Year of Plenty, Monopoly, or a hidden Victory Point. Play one per turn, not on the turn you bought it.',
      '<b>Longest Road</b> (5+ connected roads) and <b>Largest Army</b> (3+ knights) are each worth 2 points.',
      'Spread your settlements over different resources and numbers so you collect cards on many rolls.',
    ],
  },
};

// What happens when a player's move timer runs out (the platform falls back to
// the bot's choice if this move turns out to be illegal).
function onTimeout(v, pid) {
  if (v.phase === 'main') {
    if (v.trade && v.trade.replies?.[pid] === null) return { type: 'reply', yes: false }; // decline the offer
    return { type: 'end' }; // ends the turn (an open offer of their own is dropped)
  }
  if (v.phase === 'roads') return { type: 'skip' };
  if (v.phase === 'roll') return { type: 'roll' };
  return botNormal(v, pid); // setup placement, discarding, robber, steal: let the computer choose (as before, whatever the computer level)
}
