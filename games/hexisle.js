// Isle of Hexes — settle a hex island, trade with rivals and race to 10 victory points.
// Rules, bot and rendering all live in this one module (see GAME_GUIDE.md).

import { esc, rand, shuffle, d6, log, addFx } from '../js/util.js';
import { injectCSS, dieHTML, rollDice, changed } from '../js/fx.js';
import { sound } from '../js/sound.js';

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

function setup(players) {
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
function bot(s, pid) {
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
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" class="hexisle-seat"><defs><radialGradient id="hx-sw${seat}" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="${P.hi}"/><stop offset=".55" stop-color="${P.c}"/><stop offset="1" stop-color="${P.lo}"/></radialGradient></defs><circle cx="12" cy="12" r="10.5" fill="url(#hx-sw${seat})" stroke="#1a0f07" stroke-width="1.2"/>${SYM[seat % 4](12, 12.3, 4.2, P.ink)}</svg>`;
};

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
    <linearGradient id="hx-pineg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3d8f3c"/><stop offset=".5" stop-color="#2a6e2d"/><stop offset="1" stop-color="#174a1d"/></linearGradient>
    <linearGradient id="hx-clay" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e58a55"/><stop offset="1" stop-color="#93421c"/></linearGradient>
    <linearGradient id="hx-robg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5a5466"/><stop offset=".45" stop-color="#2a2633"/><stop offset="1" stop-color="#0d0b12"/></linearGradient>
    ${grads}${seats}
    <filter id="hx-blur6" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="7"/></filter>
    <filter id="hx-blur3" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3"/></filter>
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

const COVER = `<svg viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="hxc-sea" cx=".5" cy=".5" r=".75"><stop offset="0" stop-color="#46acd9"/><stop offset=".6" stop-color="#1c6ca5"/><stop offset="1" stop-color="#0b3561"/></radialGradient>
    <radialGradient id="hxc-sun" cx=".85" cy=".1" r=".5"><stop offset="0" stop-color="#fff3c4" stop-opacity=".75"/><stop offset="1" stop-color="#fff3c4" stop-opacity="0"/></radialGradient>
    <linearGradient id="hxc-bev" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".7"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".5"/></linearGradient>
    <filter id="hxc-b"><feGaussianBlur stdDeviation="5"/></filter>
  </defs>
  <rect width="320" height="200" fill="url(#hxc-sea)"/>
  <rect width="320" height="200" fill="url(#hxc-sun)"/>
  <g stroke="#fff" stroke-width="1.6" fill="none" opacity=".45" stroke-linecap="round">
    <path d="M22,40 q8,-6 16,0 t16,0"/><path d="M262,160 q8,-6 16,0 t16,0"/><path d="M30,168 q7,-5 14,0 t14,0"/><path d="M268,44 q7,-5 14,0 t14,0"/><path d="M246,110 q6,-4 12,0"/><path d="M56,100 q6,-4 12,0"/>
  </g>
  <g filter="url(#hxc-b)" opacity=".9">${[[0, 0], [-58, 0], [58, 0], [-29, -50], [29, -50], [-29, 50], [29, 50]].map(([x, y]) => `<polygon points="${hexPts(40, 160 + x, 104 + y)}" fill="#e9d59c"/>`).join('')}</g>
  ${[[0, 0, 'mountains'], [-58, 0, 'forest'], [58, 0, 'fields'], [-29, -50, 'pasture'], [29, -50, 'forest'], [-29, 50, 'hills'], [29, 50, 'pasture']].map(([x, y, t]) => {
    const cx = 160 + x, cy = 100 + y, [a, , c] = TCOL[t];
    return `<polygon points="${hexPts(33, cx, cy + 4)}" fill="${c}"/><polygon points="${hexPts(32, cx, cy)}" fill="${a}"/><polygon points="${hexPts(30.5, cx, cy)}" fill="none" stroke="url(#hxc-bev)" stroke-width="2.4"/>`
      + (t === 'forest' ? [[-12, -6], [8, -10], [-4, 10], [14, 8]].map(([dx, dy]) => `<path d="M${cx + dx},${cy + dy - 16} l7,13 h-14z" fill="#2a6a2c" stroke="#174a1d" stroke-width=".6"/><path d="M${cx + dx},${cy + dy - 22} l5,9 h-10z" fill="#3c8a3a"/>`).join('') : '')
      + (t === 'mountains' ? `<path d="M${cx - 22},${cy + 14} L${cx - 6},${cy - 16} L${cx + 6},${cy + 14}Z" fill="#c3c8cf"/><path d="M${cx - 6},${cy - 16} L${cx + 22},${cy + 14} L${cx + 6},${cy + 14}Z" fill="#6c737d"/><path d="M${cx - 6},${cy - 16} l-6,11 4,-2 2,3 3,-4 4,2z" fill="#fff"/><path d="M${cx + 6},${cy + 14} L${cx + 14},${cy - 4} L${cx + 26},${cy + 14}Z" fill="#8a9099"/>` : '')
      + (t === 'fields' ? [-12, -4, 4, 12].map((dx) => `<path d="M${cx + dx - 6},${cy + 22} C${cx + dx - 2},${cy + 6} ${cx + dx + 2},${cy - 10} ${cx + dx + 6},${cy - 24}" stroke="#c99224" stroke-width="3" fill="none" opacity=".6"/>`).join('') : '')
      + (t === 'pasture' ? [[-10, -4], [8, 6]].map(([dx, dy]) => `<g fill="#fffdf4"><circle cx="${cx + dx}" cy="${cy + dy}" r="4"/><circle cx="${cx + dx + 4}" cy="${cy + dy - 1}" r="4"/></g><circle cx="${cx + dx + 9}" cy="${cy + dy - 2}" r="2.4" fill="#3a332c"/>`).join('') : '')
      + (t === 'hills' ? `<path d="M${cx - 18},${cy + 12} c4,-14 14,-16 20,0z M${cx},${cy + 2} c4,-14 14,-16 20,0z" fill="#93421c" opacity=".7"/>` : '');
  }).join('')}
  <g><circle cx="160" cy="100" r="11" fill="#000" opacity=".3" transform="translate(0,2)"/><circle cx="160" cy="100" r="11" fill="#f6e8c6" stroke="#6e4f24" stroke-width="1.2"/><text x="160" y="104.5" text-anchor="middle" font-family="Georgia,serif" font-weight="800" font-size="12" fill="#b8231a">8</text></g>
  <g transform="translate(196,152)"><path d="M-12,8 L-9,-8 L6,-8 L9,8Z" fill="#c23a26" stroke="#5a1408"/><path d="M-9,-8 L-2,-14 L13,-14 L6,-8Z" fill="#e05a3a" stroke="#5a1408"/><path d="M6,-8 L13,-14 L15,2 L9,8Z" fill="#7c1a0d" stroke="#5a1408"/></g>
  <g transform="translate(64,150)"><path d="M-16,0 H16 L11,8 H-11Z" fill="#7a4a24" stroke="#3a2210"/><path d="M0,-2 V-30" stroke="#3a2210" stroke-width="1.6"/><path d="M1,-29 L16,-6 H1Z" fill="#fbf1da" stroke="#8a7a5a" stroke-width=".8"/><path d="M-1,-25 L-12,-6 H-1Z" fill="#efe2c2" stroke="#8a7a5a" stroke-width=".8"/>
    <path d="M-20,11 q6,-4 12,0 t12,0 t12,0" stroke="#fff" stroke-width="1.4" fill="none" opacity=".6"/></g>
  <g transform="translate(258,78)"><ellipse cx="0" cy="0" rx="7" ry="2.5" fill="#000" opacity=".3"/><path d="M-6,0 C-7,-6 -5,-11 -3,-14 C-6,-17 -5,-22 0,-23 C5,-22 6,-17 3,-14 C5,-11 7,-6 6,0Z" fill="#2a2633" stroke="#000"/></g>
</svg>`;

const CSS = `
.hexisle { --hx-gap: 12px; }
.hexisle-main { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.hexisle-felt { padding: 10px; }
.hexisle-bar { display: flex; align-items: center; gap: 12px; margin: 0 4px 8px; min-height: 54px; }
.hexisle-bar .hexisle-says { flex: 1; min-width: 0; }
.hexisle-bar .status { line-height: 1.25; }
.hexisle-bar .status .hexisle-seat { vertical-align: -4px; margin-right: 6px; }
.hexisle-hint { font-size: .86rem; color: #e3f3e8; opacity: .88; margin-top: 2px; }
.hexisle-dice { flex: none; gap: 10px; padding: 4px 8px; }
.hexisle-dice.idle { opacity: .45; }
.hexisle-sum { font-family: var(--font-display); font-weight: 800; font-size: 1.3rem; color: var(--gold); text-shadow: 0 2px 0 #000; min-width: 1.4em; text-align: center; }
.hexisle-sum.seven { color: #ff8a7a; }
.hexisle-board svg { width: 100%; height: auto; max-height: max(440px, calc(100vh - 250px)); display: block; touch-action: manipulation; user-select: none; -webkit-user-select: none; }
.hexisle-wave { animation: hexisle-wave 5.5s ease-in-out infinite; }
@keyframes hexisle-wave { 0%, 100% { transform: translateX(-5px); opacity: .18; } 50% { transform: translateX(6px); opacity: .6; } }
.hexisle-glint { animation: hexisle-glint 7s ease-in-out infinite; }
@keyframes hexisle-glint { 0%, 100% { opacity: .05; } 50% { opacity: .22; } }
.hexisle-drop { animation: hexisle-drop .75s cubic-bezier(.3,1.5,.5,1) both; transform-box: fill-box; transform-origin: 50% 100%; }
@keyframes hexisle-drop { 0% { transform: translateY(-70px) scale(1.15); opacity: 0; } 35% { opacity: 1; } 62% { transform: translateY(0) scale(1.12, .84); } 80% { transform: translateY(-6px) scale(.97, 1.04); } 100% { transform: none; } }
.hexisle-flash { animation: hexisle-flash 1.9s ease-out both; pointer-events: none; }
@keyframes hexisle-flash { 0% { opacity: 0; } 12% { opacity: .8; } 30% { opacity: .15; } 48% { opacity: .65; } 100% { opacity: 0; } }
.hexisle-tokpop { animation: hexisle-tokpop .9s cubic-bezier(.3,1.6,.5,1) both; transform-box: fill-box; transform-origin: center; }
@keyframes hexisle-tokpop { 0% { transform: scale(1); } 30% { transform: scale(1.35); } 100% { transform: scale(1); } }
.hexisle-spot { pointer-events: none; animation: hexisle-spot 1.4s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
@keyframes hexisle-spot { 50% { transform: scale(1.25); opacity: .75; } }
.hexisle-hit { cursor: pointer; fill: transparent; }
.hexisle-hexhit { cursor: pointer; fill: rgba(255, 240, 170, .08); stroke: rgba(255, 236, 160, .9); stroke-width: 3; stroke-dasharray: 8 6; }
.hexisle-robbed { opacity: .82; }
.hexisle-robber { pointer-events: none; }

.hexisle-bankrow { display: flex; align-items: flex-end; justify-content: center; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
.hexisle-bankrow .hexisle-lbl { font-family: var(--font-display); font-size: .72rem; color: #cfe9d9; letter-spacing: .08em; text-transform: uppercase; align-self: center; margin-right: 2px; }
.hexisle-stack { position: relative; width: 34px; height: 46px; }
.hexisle-stack > div { position: absolute; inset: 0; }
.hexisle-stack > div:nth-child(1) { transform: translate(3px, -3px) rotate(4deg); }
.hexisle-stack > div:nth-child(2) { transform: translate(1.5px, -1.5px) rotate(2deg); }
.hexisle-stack .hexisle-cnt { position: absolute; left: 50%; bottom: -9px; transform: translateX(-50%); z-index: 2; background: rgba(15, 10, 5, .85); color: #f6ead2; border-radius: 8px; padding: 0 5px; font-size: .7rem; font-weight: 800; line-height: 1.35; border: 1px solid rgba(242, 193, 78, .4); }

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
  background: radial-gradient(circle at 50% 50%, #f2c14e 0 16%, #8a2a1a 17% 24%, transparent 25%), repeating-linear-gradient(45deg, rgba(255,255,255,.07) 0 3px, transparent 3px 7px), linear-gradient(160deg, #8a3020, #3d120a); }
.hexisle-devback { background: radial-gradient(circle at 50% 50%, #f2c14e 0 14%, #2a1a5a 15% 22%, transparent 23%), repeating-linear-gradient(-45deg, rgba(255,255,255,.07) 0 3px, transparent 3px 7px), linear-gradient(160deg, #4a3a9a, #1a1040); }

.hexisle-dock { display: flex; flex-direction: column; gap: 12px; }
.hexisle-dock h4 { margin: 0; font-family: var(--font-display); color: var(--gold); font-size: .82rem; letter-spacing: .08em; text-transform: uppercase; }
.hexisle-hand { display: flex; gap: 8px; flex-wrap: wrap; align-items: flex-end; }
.hexisle-slot { display: flex; flex-direction: column; align-items: center; gap: 5px; }
.hexisle-slot .hexisle-card { transition: transform .2s var(--ease); }
.hexisle-slot.zero .hexisle-card { opacity: .32; filter: grayscale(.7); }
.hexisle-num { position: absolute; top: -9px; right: -9px; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center;
  background: radial-gradient(circle at 35% 30%, #fff6d0, #e9b947 60%, #a87418); color: #3a2405; border: 1px solid #6b440c;
  font-family: var(--font-display); font-weight: 800; font-size: .85rem; box-shadow: 0 2px 4px rgba(0,0,0,.5); }
.hexisle-step { display: flex; gap: 4px; }
.hexisle-step button { min-height: 34px; min-width: 27px; width: 27px; padding: 0; border-radius: 8px; font-size: 1.05rem; }
.hexisle-sel { position: absolute; left: -8px; bottom: -8px; min-width: 26px; height: 22px; padding: 0 4px; border-radius: 11px; display: grid; place-items: center;
  background: radial-gradient(circle at 35% 30%, #ffb9ad, #d4412c 65%, #8a1c0e); color: #fff; border: 1px solid #5a1008; font-weight: 800; font-size: .78rem; box-shadow: 0 2px 4px rgba(0,0,0,.5); }
.hexisle-have { font-size: .68rem; color: var(--muted); font-weight: 700; }
.hexisle-slot.zero .hexisle-num { filter: grayscale(1); opacity: .7; }
.hexisle-side .hexisle-card { width: 51px; height: 71px; }
.hexisle-side .hexisle-hand { gap: 6px; justify-content: space-between; }
.hexisle-modal .hexisle-hand { justify-content: space-between; gap: 4px; }
.hexisle-modal .hexisle-card { width: 50px; height: 68px; }
.hexisle-pickn { font-family: var(--font-display); font-weight: 800; color: var(--gold); min-width: 1.2em; text-align: center; }

.hexisle-devs { display: flex; gap: 8px; flex-wrap: wrap; }
.hexisle-dev { position: relative; width: 64px; height: 88px; border-radius: 9px; padding: 4px; flex: none; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px;
  background: radial-gradient(ellipse at 30% 10%, rgba(255,255,255,.25), transparent 60%), linear-gradient(160deg, #4a3a9a, #1a1040);
  border: 2px solid #f2d68a; box-shadow: 0 0 0 1px #000, 0 5px 10px rgba(0,0,0,.45); color: #fbefd0; text-align: center; }
.hexisle-dev svg { width: 64%; height: auto; }
.hexisle-dev b { font-size: .56rem; line-height: 1.05; letter-spacing: .03em; text-transform: uppercase; font-family: var(--font-display); }
.hexisle-dev-knight { background: radial-gradient(ellipse at 30% 10%, rgba(255,255,255,.25), transparent 60%), linear-gradient(160deg, #5a5f72, #1e2230); }
.hexisle-dev-vp { background: radial-gradient(ellipse at 30% 10%, rgba(255,255,255,.25), transparent 60%), linear-gradient(160deg, #2f7a4e, #0f3a22); }
button.hexisle-devbtn { padding: 0; min-height: 0; background: none; border: none; box-shadow: none; border-radius: 9px; position: relative; }
button.hexisle-devbtn:disabled { opacity: .6; filter: grayscale(.3); }
.hexisle-devbtn .hexisle-tag { position: absolute; left: 50%; bottom: -8px; transform: translateX(-50%); white-space: nowrap; font-size: .6rem; font-weight: 800; padding: 1px 6px; border-radius: 8px; background: #1a0f07; color: var(--gold); border: 1px solid rgba(242,193,78,.5); }
.hexisle-devbtn.ready .hexisle-dev { box-shadow: 0 0 0 1px #000, 0 0 14px rgba(255, 220, 120, .8); }

.hexisle-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: stretch; }
.hexisle-actions > button { flex: 1 1 auto; }
.hexisle-builds { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.hexisle-builds button { display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 6px 4px 7px; min-height: 76px; font-size: .78rem; }
.hexisle-builds button.on { background: linear-gradient(180deg, #fff0b8 0%, #f6cd63 30%, #dba339 70%, #b57a1c 100%); color: #3a2405; text-shadow: none; }
.hexisle-builds svg.hexisle-piece { width: 30px; height: 26px; }
.hexisle-cost { display: flex; gap: 1px; justify-content: center; flex-wrap: wrap; }
.hexisle-cost .hexisle-card.mini { width: 13px; height: 18px; border-width: 1px; border-radius: 3px; box-shadow: 0 1px 2px rgba(0,0,0,.6); }
.hexisle-row2 { display: flex; gap: 8px; flex-wrap: wrap; }
.hexisle-row2 > button { flex: 1 1 120px; }

.hexisle-offer { border-radius: 12px; padding: 10px; background: rgba(0,0,0,.28); box-shadow: inset 0 0 0 1px rgba(242,193,78,.35); display: flex; flex-direction: column; gap: 8px; }
.hexisle-offer .hexisle-swap { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.hexisle-mcards { display: flex; gap: 3px; flex-wrap: wrap; }
.hexisle-mcards .hexisle-card.mini { width: 24px; height: 33px; }
.hexisle-reply { display: flex; align-items: center; gap: 8px; padding: 4px 0; border-top: 1px dashed rgba(242,200,130,.2); }

.hexisle-chip { display: block; position: relative; }
.hexisle-chiptop { display: flex; align-items: center; gap: 8px; }
.hexisle-chiptop .hexisle-seat { flex: none; }
.hexisle-chip .hexisle-pname { font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0; }
.hexisle-chip .hexisle-stats { margin: 3px 0 0 34px; }
.hexisle-chip .hexisle-badges { margin-left: 34px; }
.hexisle-stats { display: flex; gap: 10px; font-size: .8rem; color: var(--muted); flex-wrap: wrap; }
.hexisle-stats span { display: inline-flex; align-items: center; gap: 3px; }
.hexisle-stats svg { width: 14px; height: 14px; }
.hexisle-vp { flex: none; font-family: var(--font-display); font-weight: 800; font-size: 1.4rem; color: var(--gold); line-height: 1; text-shadow: 0 2px 0 #000; white-space: nowrap; }
.hexisle-vp small { font-size: .55rem; letter-spacing: .1em; color: var(--muted); margin-left: 2px; }
.hexisle-badges { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 3px; }
.hexisle-badge { font-size: .62rem; font-weight: 800; padding: 1px 7px; border-radius: 10px; color: #3a2405; background: linear-gradient(180deg, #fff0b8, #e3ae3f); border: 1px solid #7a5010; }
.hexisle-players { display: flex; flex-direction: column; gap: 8px; }
.hexisle-players h3, .hexisle-logbox h3 { margin: 0 0 2px; color: var(--gold); font-size: .95rem; }
.hexisle-wait { font-size: .7rem; color: var(--gold); font-weight: 800; }

.hexisle-modal h3 { color: var(--gold); margin: 0 0 8px; }
.hexisle-still, .hexisle-still .modal { animation: none; }
.hexisle-modal::before { display: none; }
.hexisle-modal { box-shadow: inset 0 0 0 1.5px rgba(242, 200, 130, .25), inset 0 1px 0 rgba(255, 220, 170, .18), 0 20px 50px rgba(0, 0, 0, .6); }
.hexisle-tabs { display: flex; gap: 6px; margin-bottom: 10px; }
.hexisle-tabs button { flex: 1; }
.hexisle-tabs button.on { background: linear-gradient(180deg, #fff0b8 0%, #f6cd63 30%, #dba339 70%, #b57a1c 100%); color: #3a2405; text-shadow: none; }
.hexisle-pick { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; margin: 6px 0 12px; }
.hexisle-pick button { padding: 6px 2px; min-height: 0; display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: .72rem; background: rgba(0,0,0,.25); box-shadow: inset 0 0 0 1px rgba(242,193,78,.2); }
.hexisle-pick button.on { box-shadow: inset 0 0 0 2px var(--gold), 0 0 12px rgba(242,193,78,.5); background: rgba(242,193,78,.15); }
.hexisle-pick .hexisle-card { width: 44px; height: 60px; }
.hexisle-pick .hexisle-card b { display: none; }
.hexisle-lbl2 { font-size: .8rem; color: var(--muted); font-weight: 800; text-transform: uppercase; letter-spacing: .06em; }

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
  .hexisle-players { order: -1; }
  .hexisle-dock { order: 1; }
  .hexisle-logbox { order: 3; }
  .hexisle-side .hexisle-card { width: 58px; height: 80px; }
  .hexisle-players .hexisle-plist { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .hexisle-board svg { max-height: none; }
}
@media (max-width: 480px) {
  .hexisle-felt { padding: 4px; border-width: 6px; }
  .hexisle-bar { margin: 2px 2px 4px; gap: 6px; min-height: 46px; }
  .hexisle-bar .status { font-size: .95rem; }
  .hexisle-hint { font-size: .78rem; }
  .hexisle-card, .hexisle-side .hexisle-card { width: 54px; height: 75px; }
  .hexisle-hand { gap: 6px; justify-content: space-between; }
  .hexisle-builds { gap: 5px; }
  .hexisle-builds button { font-size: .68rem; min-height: 72px; padding: 5px 2px; }
  .hexisle-felt .winner-banner { font-size: 1.15rem; padding: 8px 4px 2px; }
  .hexisle-cost { gap: 0; }
  .hexisle-cost .hexisle-card.mini { width: 12px; height: 17px; }
  .hexisle-players .pchip { padding: 6px 7px; gap: 6px; }
  .hexisle-chip .hexisle-pname { font-size: .82rem; }
  .hexisle-chiptop { gap: 6px; }
  .hexisle-chiptop .hexisle-seat { width: 22px; height: 22px; }
  .hexisle-chip .hexisle-stats, .hexisle-chip .hexisle-badges { margin-left: 0; }
  .hexisle-vp { font-size: 1.2rem; }
  .hexisle-dice .die3d { --die: 28px !important; }
  .hexisle-dice { gap: 7px; padding: 2px; }
  .hexisle-stats { gap: 6px; font-size: .72rem; }
  .hexisle-stack { width: 28px; height: 38px; }
  .hexisle-bankrow { gap: 6px; }
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

function boardSVG(v, T, me) {
  const out = [`<svg viewBox="-320 -296 640 592" xmlns="http://www.w3.org/2000/svg" class="hexisle-svg" role="img" aria-label="Island board">`, boardDefs(),
    `<defs><clipPath id="hx-clip"><polygon points="${hexPts(57.5)}"/></clipPath></defs>`];
  out.push(`<rect x="-316" y="-292" width="632" height="584" rx="44" fill="url(#hx-sea)" stroke="url(#hx-wood)" stroke-width="8"/>
    <rect x="-310" y="-286" width="620" height="572" rx="39" fill="none" stroke="#000" stroke-opacity=".35" stroke-width="3"/>
    <ellipse class="hexisle-glint" cx="-150" cy="-190" rx="120" ry="40" fill="#fff"/><ellipse class="hexisle-glint" style="animation-delay:-3s" cx="170" cy="200" rx="110" ry="34" fill="#fff"/>`);
  out.push(`<g stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round">${SEA_SPOTS.map(([x, y], i) =>
    `<path class="hexisle-wave" style="animation-delay:${(-i * 0.73).toFixed(2)}s" d="M${(x - 16).toFixed(0)},${y.toFixed(0)} q8,-6 16,0 t16,0"/>`).join('')}</g>`);
  out.push(`<g filter="url(#hx-blur6)" opacity=".6">${HEXES.map((h) => `<polygon points="${hexPts(84, h.x, h.y)}" fill="#7fd3ec"/>`).join('')}</g>`);
  out.push(`<g filter="url(#hx-blur3)">${HEXES.map((h) => `<polygon points="${hexPts(69, h.x, h.y)}" fill="#ecd9a2"/>`).join('')}</g>`);
  out.push(v.harbors.map(harborSVG).join(''));
  out.push(`<g opacity=".5" filter="url(#hx-blur3)">${HEXES.map((h) => `<polygon points="${hexPts(60, h.x + 2, h.y + 9)}" fill="#1a0f05"/>`).join('')}</g>`);
  const fl = ui.flash && Date.now() - ui.flash.at < 2900 ? ui.flash : null;
  HEXES.forEach((h, i) => {
    const hx = v.hexes[i];
    const flashing = fl && fl.hexes.includes(i);
    const fdelay = fl ? 1050 - (Date.now() - fl.at) : 0;
    out.push(`<g transform="translate(${h.x.toFixed(1)},${h.y.toFixed(1)})">
      <polygon points="${hexPts(58.5, 0, 6)}" fill="${TCOL[hx.t][2]}"/>
      <polygon points="${hexPts(58.5)}" fill="url(#hx-t-${hx.t})" data-a="hex-${i}"/>
      <g clip-path="url(#hx-clip)">${terrainArt(hx.t)}</g>
      <polygon points="${hexPts(58.5)}" fill="url(#hx-sheen)"/>
      <polygon points="${hexPts(57)}" fill="none" stroke="url(#hx-bevel)" stroke-width="3"/>
      ${i === v.robber ? `<polygon points="${hexPts(58.5)}" fill="#120a1a" opacity=".28"/>` : ''}
      ${flashing ? `<polygon class="hexisle-flash" style="animation-delay:${fdelay}ms" points="${hexPts(58)}" fill="#fff4b8"/>` : ''}
      ${hx.n ? `<g${flashing ? ` class="hexisle-tokpop" style="animation-delay:${fdelay}ms"` : ''}>${tokenSVG(hx.n)}</g>` : ''}
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
  // legal targets
  T.h.forEach((i) => out.push(`<polygon class="hexisle-hexhit pulse-glow" data-hit="h:${i}" points="${hexPts(54, HEXES[i].x, HEXES[i].y)}"/>`));
  T.e.forEach((e) => {
    const A = VERTS[EDGES[e].a], B = VERTS[EDGES[e].b], E = EDGES[e];
    const ax = A.x + (B.x - A.x) * 0.28, ay = A.y + (B.y - A.y) * 0.28, bx = B.x - (B.x - A.x) * 0.28, by = B.y - (B.y - A.y) * 0.28;
    const ln = `x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke-linecap="round"`;
    out.push(`<g class="pulse-glow" pointer-events="none"><g class="hexisle-spot"><line ${ln} stroke="#2a1606" stroke-width="13" opacity=".55"/><line ${ln} stroke="#ffc93c" stroke-width="9.5"/><line ${ln} stroke="#fffdf0" stroke-width="4.5"/></g></g>
      <circle class="hexisle-hit" data-hit="e:${e}" cx="${E.x.toFixed(1)}" cy="${E.y.toFixed(1)}" r="28"/>`);
  });
  T.v.forEach((vi) => {
    const V = VERTS[vi];
    out.push(`<g class="pulse-glow" pointer-events="none"><g class="hexisle-spot"><circle cx="${V.x}" cy="${V.y}" r="10.5" fill="#ffc93c" stroke="#2a1606" stroke-width="2.5"/><circle cx="${V.x}" cy="${V.y}" r="5" fill="#fffdf0"/></g></g>
      <circle class="hexisle-hit" data-hit="v:${vi}" cx="${V.x}" cy="${V.y}" r="30"/>`);
  });
  T.c.forEach((vi) => {
    const V = VERTS[vi];
    out.push(`<g class="pulse-glow"><circle class="hexisle-spot" cx="${V.x}" cy="${V.y - 2}" r="19" fill="none" stroke="#fff3c0" stroke-width="3.5"/></g>
      <circle class="hexisle-hit" data-hit="c:${vi}" cx="${V.x}" cy="${V.y}" r="30"/>`);
  });
  T.s.forEach(([vi, idx]) => {
    const V = VERTS[vi];
    out.push(`<g class="pulse-glow"><circle class="hexisle-spot" cx="${V.x}" cy="${V.y - 2}" r="19" fill="none" stroke="#ff9a7a" stroke-width="3.5"/></g>
      <circle class="hexisle-hit" data-hit="s:${idx}" cx="${V.x}" cy="${V.y}" r="30"/>`);
  });
  void me;
  out.push('</svg>');
  return out.join('');
}

/* ---------------- side panel & dock ---------------- */
const ui = { key: '', mode: null, modal: null, tab: 'bank', bGive: null, bGet: null, give: zeroRes(), want: zeroRes(), disc: zeroRes(), plenty: [], prevKeys: null, flash: null };

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

function chipsHTML(v, me) {
  const due = turnOf(v);
  return v.order.map((p) => {
    const P = v.ps[p];
    const vp = vpOf(v, p, true);
    const badges = [v.longest === p ? '<span class="hexisle-badge">Longest Road</span>' : '', v.army === p ? '<span class="hexisle-badge">Largest Army</span>' : '',
      v.phase === 'discard' && v.discard[p] ? '<span class="hexisle-wait">discarding…</span>' : '',
      v.trade && v.trade.replies[p] === 'yes' ? '<span class="hexisle-wait">accepted</span>' : ''].join('');
    return `<div class="pchip hexisle-chip${due.includes(p) && !v.over ? ' turn' : ''}">
      <div class="hexisle-chiptop">${seatSVG(P.seat, 26)}<span class="hexisle-pname">${esc(P.name)}${p === me ? ' <span class="muted small">(you)</span>' : ''}</span>
        <span class="hexisle-vp" data-a="p-${p}-vp">${vp}<small>VP</small></span></div>
      <div class="hexisle-stats"><span data-a="p-${p}-hand" title="Resource cards">${SMALL.cards}${P.nRes}</span><span data-a="p-${p}-dev" title="Development cards">${SMALL.dev}${P.nDev}</span><span title="Knights played">${SMALL.sword}${P.knights}</span><span title="Longest road">${SMALL.road}${v.roadLen[p] || 0}</span></div>
      ${badges ? `<div class="hexisle-badges">${badges}</div>` : ''}</div>`;
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
      return `<button class="hexisle-devbtn${ok ? ' ready pulse-glow' : ''}" data-dev="${c.t}" data-i="${i}" ${ok ? '' : 'disabled'} title="${esc(DEV[c.t].desc)}">${devCardHTML(c.t)}${tag ? `<span class="hexisle-tag">${tag}</span>` : ''}</button>`;
    }).join('')}</div>`;
  }
  const discBar = disc ? `<div class="hexisle-row2"><button class="primary" id="hx-disc" ${total(ui.disc) === disc ? '' : 'disabled'}>Discard ${total(ui.disc)} / ${disc}</button></div>` : '';
  return `<div><h4>Your hand</h4></div><div class="hexisle-hand">${slots}</div>${discBar}${devs ? `<h4>Development cards</h4>${devs}` : ''}`;
}

function offerHTML(v, me) {
  const tr = v.trade, cur = curId(v);
  let body = `<div class="hexisle-swap"><b>${esc(nameOf(v, cur))}</b> gives <span class="hexisle-mcards">${miniCards(tr.give)}</span> for <span class="hexisle-mcards">${miniCards(tr.want)}</span></div>`;
  if (me === cur) {
    body += Object.keys(tr.replies).map((p) => {
      const r = tr.replies[p];
      return `<div class="hexisle-reply">${seatSVG(v.ps[p].seat, 20)}<span class="grow">${esc(nameOf(v, p))}</span>${r === 'yes' ? `<button class="good small" data-with="${esc(p)}">Trade</button>` : `<span class="muted small">${r === 'no' ? 'declined' : 'thinking…'}</span>`}</div>`;
    }).join('');
    body += '<div class="hexisle-row2"><button class="bad small" id="hx-cancel">Cancel offer</button></div>';
  } else if (tr.replies[me] === null) {
    const can = hasRes(v.ps[me].res, tr.want);
    body += `<div class="hexisle-row2"><button class="good" id="hx-yes" ${can ? '' : 'disabled'}>${can ? 'Accept' : "Can't afford"}</button><button class="bad" id="hx-no">Decline</button></div>`;
  } else if (tr.replies[me]) body += `<div class="muted small">You ${tr.replies[me] === 'yes' ? 'accepted' : 'declined'}.</div>`;
  return `<div class="hexisle-offer"><h4>Trade offer</h4>${body}</div>`;
}

function actionsHTML(v, me) {
  const P = v.ps[me], cur = curId(v), mine = cur === me && !v.over;
  if (v.over) return '';
  if (v.trade) return offerHTML(v, me);
  if (!mine) return '';
  if (v.phase === 'roll') {
    return `<div class="hexisle-actions"><button class="primary" id="hx-roll">🎲 Roll dice</button>${canPlay(v, me, 'knight') ? '<button id="hx-knight">Play Knight</button>' : ''}</div>`;
  }
  if (v.phase === 'roads') return '<div class="hexisle-actions"><button id="hx-skip">Skip remaining roads</button></div>';
  if (v.phase === 'steal') return `<div class="hexisle-actions">${v.victims.map((p, i) => `<button class="bad" data-steal="${i}">Rob ${esc(nameOf(v, p))} (${v.ps[p].nRes})</button>`).join('')}</div>`;
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
    <div class="hexisle-row2">${ui.mode ? '<button id="hx-cancelmode">Cancel build</button>' : '<button id="hx-trade">⇄ Trade</button>'}<button class="primary" id="hx-end">End turn</button></div>`;
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
  return `<div class="modal-bg${again ? ' hexisle-still' : ''}" id="hx-modalbg"><div class="modal panel hexisle-modal">${body}</div></div>`;
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
  if (rolled && v.lastRoll !== 7) ui.flash = { at: Date.now(), hexes: v.hexes.map((h, i) => (h.n === v.lastRoll && i !== v.robber ? i : -1)).filter((i) => i >= 0) };
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
  const curP = v.ps[curId(v)];
  const sum = v.dice[0] + v.dice[1];
  const banner = v.over ? `<div class="winner-banner">🏆 ${esc(nameOf(v, v.winners[0]))} wins with ${vpOf(v, v.winners[0])} VP!</div>` : '';
  el.innerHTML = `<div class="game-layout hexisle">
    <div class="hexisle-main">
      <div class="felt hexisle-felt">
        ${banner}
        <div class="hexisle-bar">
          <div class="hexisle-says">${st ? `<div class="status${mine || due.includes(me) ? ' myturn' : ''}">${v.over ? '' : seatSVG(curP.seat, 20)}${st}</div>` : ''}${hint ? `<div class="hexisle-hint">${hint}</div>` : ''}</div>
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
      <div class="panel hexisle-players"><h3>Players</h3><div class="hexisle-plist">${chipsHTML(v, me)}</div></div>
      ${P ? `<div class="panel hexisle-dock">${actionsHTML(v, me)}${handHTML(v, me)}</div>` : ''}
      <div class="parchment hexisle-logbox"><div class="log">${v.log.map((l) => `<div>${esc(l)}</div>`).join('')}</div></div>
    </div>
  </div>${modalHTML(v, me)}`;

  if (rolled) { const tray = el.querySelector('.hexisle-dice'); if (tray) rollDice(tray); }
  if (devPlayed) showDevPlayed(el, v);

  const send = (a) => ctx.send(a);
  const svg = el.querySelector('.hexisle-svg');
  svg?.addEventListener('click', (e) => {
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
  });
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
  setup,
  act(s, pid, a) { actInner(s, pid, a); checkWin(s); },
  turnOf,
  view,
  bot,
  render,
};
