// The host's Creature Island: one shared world for up to four explorers, stepped 20 times a second on the
// host's device. Players send inputs and requests; the world decides everything (movement, hits, catches,
// quests) and sends each player what is near them. Nothing here touches storage: a player's explorer is
// only captured (snapshot) when they ask to save, and only replaced when they load one at the start.
import {
  TILE, TICK, MAX_LV, TEAM_MAX, RANCH_MAX, CATCH_HP, SPECIES, MURKS, ABILITIES, ITEMS, GEAR, SHOP, PLAYER, QUESTS,
  BOSSES, STARTERS, NPCS, CONTENT_VERSION, SEATS, xpToNext, creatureMax, creatureAtk, playerMax, typeMult,
} from './island-data.js';
import { island, W, H, GATES, TELEPORTS, SPAWN, ARENAS, VILLAGE, RAID_FROM, LOST_AT, LUNA_AT, TRACKS, SPAWNS, zoneAt, fits, slide, inRect } from './island-map.js';

export const BITS = { attack: 1, dodge: 2, ability: 4, interact: 8, catch: 16 };
export const FACE = [[0, 1], [0, -1], [-1, 0], [1, 0]]; // down, up, left, right
const T = TILE;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const angTo = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
export const dirOf = (dx, dy) => (Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 2 : 3) : dy < 0 ? 1 : 0);
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return Math.abs(d); };
const inVillage = (x, y) => inRect(x, y, VILLAGE);
const areaOf = (x) => (x >= 128 * T ? 'cave' : 'overworld');
const NEAR = 1050; // how far around each player the world is sent to them
const INTERACT = 58;

// One explorer's body: what both the host and the player's own screen (to move without waiting) step the
// same way from the same inputs. inp = [dx, dy, bits], dx/dy from -100 to 100.
export function newBody(x, y) { return { x, y, dir: 0, kx: 0, ky: 0, dT: 0, dCd: 0, ddx: 0, ddy: 0, sT: 0, sCd: 0, down: 0, mul: 1, moving: false }; }
export function stepBody(b, inp, open) {
  const dt = TICK;
  b.dCd = Math.max(0, b.dCd - dt); b.sCd = Math.max(0, b.sCd - dt); b.sT = Math.max(0, b.sT - dt);
  b.swung = false; b.dodged = false;
  let mx = b.kx * dt, my = b.ky * dt;
  b.kx *= 0.78; b.ky *= 0.78;
  if (Math.abs(b.kx) < 4) b.kx = 0;
  if (Math.abs(b.ky) < 4) b.ky = 0;
  if (!b.down) {
    let dx = clamp(inp[0] | 0, -100, 100) / 100, dy = clamp(inp[1] | 0, -100, 100) / 100;
    const m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; }
    const bits = inp[2] | 0;
    if (bits & BITS.dodge && b.dCd <= 0 && b.dT <= 0) {
      let [ex, ey] = m > 0.2 ? [dx, dy] : FACE[b.dir];
      const l = Math.hypot(ex, ey) || 1;
      b.ddx = ex / l; b.ddy = ey / l; b.dT = PLAYER.dodge; b.dCd = PLAYER.dodgeCd * (b.mul > 1 ? 0.8 : 1); b.dodged = true;
    }
    if (bits & BITS.attack && b.sCd <= 0 && b.dT <= 0) { b.sT = 0.2; b.sCd = PLAYER.swing; b.swung = true; }
    if (b.dT > 0) {
      mx += b.ddx * PLAYER.dodgeSpeed * dt; my += b.ddy * PLAYER.dodgeSpeed * dt;
      b.dT = Math.max(0, b.dT - dt);
    } else {
      const sp = PLAYER.speed * b.mul * (b.sT > 0 ? 0.55 : 1);
      mx += dx * sp * dt; my += dy * sp * dt;
      if (m > 0.15) b.dir = dirOf(dx, dy);
    }
  }
  b.moving = Math.hypot(mx, my) > 0.4;
  if (mx || my) slide(b, mx, my, PLAYER.r, open);
}

// ---------------- explorers: new, validated, captured ----------------

let uidN = 0;
const newUid = () => (Date.now().toString(36).slice(-5) + (uidN++).toString(36) + Math.random().toString(36).slice(2, 6));
export function newExplorer(name, look) {
  return {
    name: String(name || 'Explorer').slice(0, 20), look: cleanLook(look), lv: 1, xp: 0, hp: playerMax(1, null), shells: 30,
    inv: { sunberry: 2 }, gear: ['staff'], equip: { weapon: 'staff', charm: null }, team: [], ranch: [], active: 0,
    dex: { seen: [], caught: [] }, quests: { starter: 1 }, flags: [], chests: [], time: 0, loc: null,
  };
}
const cleanLook = (l) => ({ skin: clamp(l?.skin | 0, 0, 3), hair: clamp(l?.hair | 0, 0, 5) });
const knownFlags = new Set(['bridge', 'mirebrute', 'quartzhulk', 'raid', 'peak', 'tempestra', 'champion']);
// A save from a player's device is checked field by field: unknown things are dropped, numbers are kept
// in range, and a place that can't be stood on becomes the village square.
export function validateExplorer(rec, name) {
  if (!rec || typeof rec !== 'object' || rec.kind !== 'island-explorer') throw new Error('That is not a Creature Island save.');
  if (rec.v !== 1) throw new Error('This save comes from a newer version of the game. Reload the page to update.');
  const num = (v, a, b, d = a) => (Number.isFinite(v) ? clamp(Math.round(v), a, b) : d);
  const ex = newExplorer(name || rec.name, rec.look);
  ex.lv = num(rec.lv, 1, MAX_LV, 1);
  ex.xp = num(rec.xp, 0, xpToNext(ex.lv) - 1, 0);
  ex.shells = num(rec.shells, 0, 999999, 0);
  ex.inv = {};
  for (const [k, n] of Object.entries(rec.inv || {})) if (ITEMS[k] && num(n, 0, 99) > 0) ex.inv[k] = num(n, 0, 99);
  ex.gear = [...new Set(['staff', ...(Array.isArray(rec.gear) ? rec.gear : []).filter((g) => GEAR[g])])];
  ex.equip = { weapon: ex.gear.includes(rec.equip?.weapon) && GEAR[rec.equip.weapon].kind === 'weapon' ? rec.equip.weapon : 'staff', charm: ex.gear.includes(rec.equip?.charm) && GEAR[rec.equip.charm].kind === 'charm' ? rec.equip.charm : null };
  const mon = (m) => {
    if (!m || !SPECIES[m.sp]) return null;
    const lv = num(m.lv, 1, MAX_LV, 1);
    return { uid: /^[a-z0-9]{4,24}$/.test(m.uid || '') ? m.uid : newUid(), sp: m.sp, lv, xp: num(m.xp, 0, xpToNext(lv) - 1, 0), hp: num(m.hp, 0, creatureMax(m.sp, lv), creatureMax(m.sp, lv)) };
  };
  const seen = new Set();
  const uniq = (m) => m && !seen.has(m.uid) && seen.add(m.uid);
  ex.team = (Array.isArray(rec.team) ? rec.team : []).map(mon).filter(uniq).slice(0, TEAM_MAX);
  ex.ranch = (Array.isArray(rec.ranch) ? rec.ranch : []).map(mon).filter(uniq).slice(0, RANCH_MAX);
  ex.active = num(rec.active, 0, Math.max(0, ex.team.length - 1), 0);
  const sp = (list) => [...new Set((Array.isArray(list) ? list : []).filter((s) => SPECIES[s]))];
  ex.dex = { seen: sp(rec.dex?.seen), caught: sp(rec.dex?.caught) };
  ex.quests = {};
  for (const [q, s] of Object.entries(rec.quests || {})) if (QUESTS[q] && [1, 2, 9].includes(s)) ex.quests[q] = s;
  if (!ex.team.length && !ex.ranch.length && ex.quests.starter !== 9) ex.quests.starter = 1;
  ex.flags = [...new Set((Array.isArray(rec.flags) ? rec.flags : []).filter((f) => knownFlags.has(f)))];
  const chestIds = new Set(island().chests.map((c) => c.id));
  ex.chests = [...new Set((Array.isArray(rec.chests) ? rec.chests : []).filter((c) => chestIds.has(c)))];
  ex.time = num(rec.time, 0, 1e8, 0);
  ex.hp = num(rec.hp, 0, playerMax(ex.lv, ex.equip.charm), playerMax(ex.lv, ex.equip.charm));
  if (ex.hp <= 0) ex.hp = playerMax(ex.lv, ex.equip.charm);
  const x = rec.loc?.x, y = rec.loc?.y;
  ex.loc = Number.isFinite(x) && Number.isFinite(y) && fits(x, y, PLAYER.r, { bridge: 1, cave: 1, storm: 1 }) ? { x, y } : null;
  return ex;
}

// ---------------- the world ----------------

export class World {
  constructor({ send, now = () => Date.now() } = {}) {
    this.send = send || (() => {});
    this.now = now;
    this.t = 0; this.tick = 0; this.nextId = 1;
    this.players = new Map();
    this.ents = new Map();
    this.open = {};
    this.raid = null;
    this.bossDue = {};
    this.worldVer = 1;
    this.lastW = new Map();
    island();
  }
  id() { return this.nextId++; }

  // ---- the room: who is at the table ----
  room(list) {
    const seen = new Set();
    list.forEach((r, seat) => {
      seen.add(r.id);
      let p = this.players.get(r.id);
      if (!p) { p = this.addPlayer(r.id, r.name, seat); }
      if (p.name !== r.name || p.connected !== r.connected) this.worldVer++;
      p.name = r.name; p.connected = r.connected;
      if (!r.connected) p.input.length = 0;
    });
    for (const [id, p] of this.players) if (!seen.has(id)) this.removePlayer(p);
    // Seat colours stay unique: someone who arrives takes the first free one.
    const used = new Set();
    for (const p of this.players.values()) { if (used.has(p.seat)) p.seat = [0, 1, 2, 3].find((s) => !used.has(s)) ?? p.seat; used.add(p.seat); }
  }
  addPlayer(id, name, seat) {
    const used = new Set([...this.players.values()].map((p) => p.seat));
    const p = {
      id, name, seat: used.has(seat) ? [0, 1, 2, 3].find((s) => !used.has(s)) ?? seat : seat, connected: true, ready: false, tag: '',
      ex: null, body: newBody(SPAWN[0] * T, SPAWN[1] * T), input: [], lastSeq: -1, lastIn: [0, 0, 0],
      hp: 0, iT: 0, shield: 0, downT: 0, chan: null, comp: null, cds: {}, switchAt: 0, focus: 0, focusT: 0,
      prog: 0, savedProg: 0, lastSave: 0, meVer: 1, sentMe: 0, sentW: 0, nodes: {}, dlg: null, events: [], zone: 'village', escort: 0, full: true,
    };
    this.players.set(id, p);
    this.worldVer++;
    return p;
  }
  removePlayer(p) {
    if (p.comp) this.ents.delete(p.comp);
    for (const e of this.ents.values()) if (e.only === p.id) this.ents.delete(e.id);
    this.players.delete(p.id);
    this.worldVer++;
  }
  readyPlayers() { return [...this.players.values()].filter((p) => p.ready); }

  // ---- messages from a player's screen ----
  message(pid, d) {
    const p = this.players.get(pid);
    if (!p || !d || typeof d !== 'object') return;
    if (d.k === 'in') return this.takeInputs(p, d);
    // A screen (re)joining starts counting its inputs from zero again, e.g. after a reload.
    if (d.k === 'join') {
      p.full = true; p.sentMe = 0; p.sentW = 0; p.lastSeq = -1; p.input.length = 0;
      this.flushPersonal(p, true);
      // Someone back after a dropped connection carries on with the same explorer, where they stood.
      if (p.ready) { this.personal(p, ['ready']); this.personal(p, ['warp', Math.round(p.body.x), Math.round(p.body.y)]); }
      return;
    }
    if (d.k === 'cmd' && typeof d.c === 'string') {
      try { this.command(p, d); } catch (e) { this.personal(p, ['toast', e.message || 'That didn’t work.']); }
    }
  }
  takeInputs(p, d) {
    if (!p.ready || !Array.isArray(d.i) || !Number.isSafeInteger(d.s)) return;
    d.i.slice(0, 8).forEach((inp, k) => {
      const seq = d.s + k;
      if (seq <= p.lastSeq || !Array.isArray(inp)) return;
      if (p.input.length && seq <= p.input[p.input.length - 1][0]) return;
      p.input.push([seq, clamp(inp[0] | 0, -100, 100), clamp(inp[1] | 0, -100, 100), inp[2] & 31]);
    });
    if (p.input.length > 12) p.input.splice(0, p.input.length - 12);
  }

  // ---- one step of the world ----
  step() {
    this.t += TICK; this.tick++;
    for (const p of this.players.values()) if (p.ready) this.stepPlayer(p);
    for (const e of [...this.ents.values()]) this.stepEnt(e);
    if (this.tick % 20 === 0) this.everySecond();
    const sendNow = this.tick % 2 === 0;
    for (const p of this.players.values()) if (p.ready && (sendNow || p.local)) this.sendFrame(p);
    for (const p of this.players.values()) this.flushPersonal(p);
  }

  stepPlayer(p) {
    const b = p.body;
    // Inputs arrive in bursts; one per step keeps both sides moving identically. A long queue catches up.
    let n = p.input.length > 3 ? 2 : p.input.length ? 1 : 0;
    if (!p.connected) { n = 0; p.input.length = 0; }
    const ex = p.ex;
    b.mul = ex.equip.charm === 'feather' ? 1.12 : 1;
    b.down = p.downT > 0 ? 1 : 0;
    // No input yet: hold still rather than guess, so the body stays exactly where the player's own screen
    // expects it after their last input (their device replays the rest).
    p.starve = n ? 0 : (p.starve || 0) + 1;
    if (p.starve > 3) b.moving = false;
    for (let i = 0; i < n; i++) {
      const [seq, dx, dy, bits] = p.input.shift();
      p.lastSeq = seq;
      stepBody(b, [dx, dy, bits], this.open);
      if (b.down) { if (bits & BITS.interact) this.personal(p, ['toast', 'You’re knocked out. A friend can revive you, or return to the village.']); continue; }
      if (b.dodged) { p.iT = Math.max(p.iT, 0.3); this.chan(p, null); }
      if (b.swung) this.swing(p);
      if (bits & BITS.ability) this.ability(p);
      if (bits & BITS.interact) this.interact(p);
      if (bits & BITS.catch) this.throwCharm(p);
      if ((dx || dy) && p.chan && Math.hypot(b.x - p.chan.x, b.y - p.chan.y) > 12) this.chan(p, null);
    }
    p.iT = Math.max(0, p.iT - TICK);
    p.shield = Math.max(0, p.shield - TICK * 3);
    ex.time += TICK;
    // Reviving a friend takes a moment of standing still beside them.
    if (p.chan) {
      const f = this.players.get(p.chan.who);
      if (!f || !f.downT || dist(f.body, b) > INTERACT + 10) this.chan(p, null);
      else if ((p.chan.left -= TICK) <= 0) {
        this.chan(p, null);
        f.downT = 0; f.hp = Math.round(this.maxHp(f) * 0.4); f.iT = 1.5; f.body.down = 0;
        this.event(f.body, ['float', f.body.x, f.body.y - 40, 'Revived!', '#8ce99a']);
        this.personal(f, ['toast', `${p.name} revived you!`]);
        this.bump(f);
      }
    }
    if (p.downT > 0 && (p.downT -= TICK) <= 0) this.respawn(p);
    for (const tp of TELEPORTS) if (inRect(b.x, b.y, tp.rect)) { this.warp(p, tp.to[0] * T, tp.to[1] * T); break; }
    const z = zoneAt(b.x, b.y);
    if (z !== p.zone) { p.zone = z; this.worldVer++; }
  }
  chan(p, c) { p.chan = c; }
  warp(p, x, y) {
    Object.assign(p.body, { x, y, kx: 0, ky: 0, dT: 0 });
    const c = this.ents.get(p.comp);
    if (c) { c.x = x - 20; c.y = y + 10; }
    const esc = this.ents.get(p.escort);
    if (esc) { esc.x = x + 20; esc.y = y + 10; }
    this.personal(p, ['warp', Math.round(x), Math.round(y)]);
  }
  respawn(p) {
    p.downT = 0; p.body.down = 0; p.hp = this.maxHp(p); p.iT = 2; this.chan(p, null);
    const v = villageSpot(p.seat);
    this.warp(p, v.x, v.y);
    this.personal(p, ['toast', 'You wake up in Brightwater Village, rested.']);
    this.bump(p);
  }
  maxHp(p) { return playerMax(p.ex.lv, p.ex.equip.charm); }
  bump(p, progress = false) { p.meVer++; if (progress) p.prog++; }

  // ---- fighting ----
  enemiesNear(x, y, r, area) {
    const out = [];
    for (const e of this.ents.values()) {
      if ((e.type !== 'c' && e.type !== 'b') || e.companion || e.hp <= 0 || e.only || e.escort) continue;
      if (areaOf(e.x) !== area) continue;
      if (Math.hypot(e.x - x, e.y - y) <= r + (e.r || 12)) out.push(e);
    }
    return out;
  }
  swing(p) {
    const b = p.body, area = areaOf(b.x);
    const reach = PLAYER.reach;
    // Aim at the nearest enemy roughly in front, so taps feel right on a phone.
    const face = Math.atan2(FACE[b.dir][1], FACE[b.dir][0]);
    let aim = face;
    const near = this.enemiesNear(b.x, b.y, reach + 26, area).filter((e) => angDiff(angTo(b, e), face) < 1.25).sort((a, c) => dist(a, b) - dist(c, b))[0];
    if (near) aim = angTo(b, near);
    const dmg = GEAR[p.ex.equip.weapon].dmg + 1.2 * (p.ex.lv - 1);
    this.event(b, ['swing', p.id, +aim.toFixed(2)]);
    for (const e of this.enemiesNear(b.x, b.y, reach, area)) {
      if (angDiff(angTo(b, e), aim) > PLAYER.arc && dist(e, b) > e.r + 6) continue;
      this.hurt(e, dmg, 'none', { pid: p.id, knock: 150, ang: angTo(b, e) });
      p.focus = e.id; p.focusT = this.t + 6;
    }
  }
  ability(p) {
    const c = this.ents.get(p.comp);
    if (!c) return this.personal(p, ['toast', p.ex.team.length ? 'Your companion needs to rest first. Heal it or choose another.' : 'You have no companion yet.']);
    const ab = SPECIES[c.sp].ability, def = ABILITIES[ab];
    const ready = p.cds[c.uid] || 0;
    if (this.t < ready) return;
    p.cds[c.uid] = this.t + def.cd;
    this.bump(p);
    const area = areaOf(c.x);
    const target = this.enemiesNear(c.x, c.y, 280, area).sort((a, e) => dist(a, c) - dist(e, c))[0];
    const ang = target ? angTo(c, target) : Math.atan2(FACE[p.body.dir][1], FACE[p.body.dir][0]);
    const atk = this.compAtk(p, c) * def.power;
    const el = SPECIES[c.sp].el;
    const src = { pid: p.id, ally: true };
    const ring = (r, mult, extra = {}) => { for (const e of this.enemiesNear(c.x, c.y, r, area)) this.hurt(e, atk * mult, el, { ...src, ...extra, ang: angTo(c, e) }); };
    this.event(c, ['abil', ab, Math.round(c.x), Math.round(c.y), +ang.toFixed(2), target ? Math.round(dist(c, target)) : 120]);
    c.anim = 'attack'; c.animT = 0.4;
    switch (ab) {
      case 'leafstorm': ring(78, 1); break;
      case 'quake': ring(105, 1, { stun: 0.9, knock: 120 }); break;
      case 'flameburst': for (const e of this.enemiesNear(c.x, c.y, 100, area)) if (angDiff(angTo(c, e), ang) < 0.85) this.hurt(e, atk, el, { ...src, ang }); break;
      case 'bubblering': p.shield = 30; ring(70, 1, { knock: 300 }); break;
      case 'thornvolley': for (const d of [-0.25, 0, 0.25]) this.shoot(c, 'thorn', ang + d, 340, atk, el, 'ally', p.id); break;
      case 'healspores': {
        for (const f of this.readyPlayers()) if (dist(f.body, c) < 150 && !f.downT) { f.hp = Math.min(this.maxHp(f), f.hp + Math.round(this.maxHp(f) * (f === p ? 0.25 : 0.15))); this.bump(f); }
        c.hp = Math.min(c.max, c.hp + Math.round(c.max * 0.25));
        this.event(c, ['float', c.x, c.y - 30, 'Healed', '#8ce99a']);
        break;
      }
      case 'clawcrush': if (target && dist(target, c) < 120) this.hurt(target, atk, el, { ...src, knock: 200, ang }); break;
      case 'thunderdive': if (target) { c.x = target.x - Math.cos(ang) * 20; c.y = target.y - Math.sin(ang) * 20; this.hurt(target, atk, el, { ...src, stun: 0.4, ang }); } break;
      case 'tidalwave': this.shoot(c, 'wave', ang, 300, atk, el, 'ally', p.id, { r: 30, pierce: true, knock: 260, life: 0.9 }); break;
      case 'staticfield': {
        const at2 = target || { x: c.x + Math.cos(ang) * 90, y: c.y + Math.sin(ang) * 90 };
        const z = { id: this.id(), type: 'z', kind: 'static', x: at2.x, y: at2.y, r: 70, life: 3, tickT: 0, dmg: atk, el, from: 'ally', owner: p.id };
        this.ents.set(z.id, z);
        break;
      }
      case 'moonbeam': {
        for (const e of this.enemiesNear(c.x, c.y, 360, area)) {
          const d = dist(e, c), a = angTo(c, e);
          if (Math.abs(Math.sin(a - ang) * d) < 26 + e.r && Math.cos(a - ang) > 0) this.hurt(e, atk, el, { ...src, ang });
        }
        break;
      }
    }
  }
  compAtk(p, c) { return creatureAtk(c.sp, c.lv) * (p.ex.equip.charm === 'leafcharm' ? 1.2 : 1); }
  shoot(from, kind, ang, speed, dmg, el, side, owner, extra = {}) {
    const x = { id: this.id(), type: 'x', kind, x: from.x, y: from.y - 10, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, life: 1.4, dmg, el, from: side, owner, r: 10, hit: [], ...extra };
    this.ents.set(x.id, x);
    return x;
  }
  // Something takes damage. src: { pid, ally, knock, ang, stun, slow }.
  hurt(e, amount, el, src = {}) {
    if (e.hp <= 0) return;
    const elDef = e.type === 'p' ? 'none' : e.el;
    let mult = typeMult(el, elDef);
    let dmg = Math.max(1, Math.round(amount * mult * (0.9 + Math.random() * 0.2)));
    if (e.type === 'p') {
      const p = this.players.get(e.pid);
      if (!p || p.iT > 0 || p.downT > 0) return;
      if (p.shield > 0) { const s = Math.min(p.shield, dmg); p.shield -= s; dmg -= s; if (!dmg) { this.event(p.body, ['float', p.body.x, p.body.y - 40, 'Blocked', '#a5d8ff']); return; } }
      p.hp = Math.max(0, p.hp - dmg);
      p.iT = 0.45;
      if (src.knock) { p.body.kx += Math.cos(src.ang) * src.knock; p.body.ky += Math.sin(src.ang) * src.knock; }
      this.event(p.body, ['hit', Math.round(p.body.x), Math.round(p.body.y - 20), dmg, 0, 'p']);
      if (p.hp <= 0) {
        p.downT = PLAYER.downFor; p.body.down = 1; this.chan(p, null);
        this.event(p.body, ['float', p.body.x, p.body.y - 44, 'Knocked out!', '#ffa8a8']);
        this.personal(p, ['down', PLAYER.downFor]);
      }
      this.bump(p);
      return;
    }
    e.hp = Math.max(0, e.hp - dmg);
    this.event(e, ['hit', Math.round(e.x), Math.round(e.y - (e.type === 'b' ? 50 : 18)), dmg, mult > 1 ? 1 : mult < 1 ? -1 : 0, e.companion ? 'a' : 'e']);
    if (src.pid) { (e.hitBy ||= []).includes(src.pid) || e.hitBy.push(src.pid); }
    if (e.type === 'c' && !e.companion) {
      if (src.knock && !e.big) { e.kx = (e.kx || 0) + Math.cos(src.ang) * src.knock; e.ky = (e.ky || 0) + Math.sin(src.ang) * src.knock; }
      if (src.stun) e.stun = Math.max(e.stun || 0, src.stun);
      e.animT = 0.25; e.anim = 'hurt';
      if (e.state === 'wander' || e.state === 'flee') {
        const sp = SPECIES[e.sp];
        if (sp?.temper === 'shy' && !e.murk) { e.state = 'flee'; e.t = 3; if (e.sp === 'puffcap' && Math.random() < 0.35) this.startAttack(e); }
        else if (src.pid) { e.angry = true; e.target = this.players.get(src.pid)?.body ? 'p:' + src.pid : null; e.state = 'chase'; }
      }
      if (e.bound) { e.bound = null; }
    }
    if (e.hp <= 0) this.faint(e);
  }
  faint(e) {
    e.state = 'faint'; e.t = e.type === 'b' ? 1.6 : 0.8; e.anim = 'faint';
    if (e.companion) {
      const p = this.players.get(e.owner);
      const m = p?.ex.team.find((x) => x.uid === e.uid);
      if (m) m.hp = 0;
      if (p) { this.personal(p, ['toast', `${SPECIES[e.sp].name} fainted. Heal it with a Revive Seed or at the healer, or pick another companion.`]); p.comp = null; this.bump(p, true); }
      this.ents.delete(e.id);
      this.event(e, ['faint', e.id]);
      return;
    }
    if (e.type === 'b') return this.bossDown(e);
    // Everyone who helped gets the reward.
    const credit = (e.hitBy || []).map((id) => this.players.get(id)).filter((p) => p?.ready);
    const xp = Math.round((8 + 4 * e.lv) * (e.murk ? 1.2 : 1));
    for (const p of credit) {
      p.ex.shells += 2 + Math.floor(e.lv / 2);
      this.gainXp(p, xp);
      const drop = Math.random();
      if (drop < 0.12) this.give(p, 'sunberry', 1);
      else if (drop < 0.17) this.give(p, 'charm', 1);
      this.personal(p, ['float', Math.round(e.x), Math.round(e.y - 30), `+${xp} XP`, '#ffd43b']);
      this.bump(p, true);
    }
    if (e.raid && this.raid) this.raid.left = this.raid.left.filter((id) => id !== e.id);
  }
  gainXp(p, xp) {
    const ex = p.ex;
    ex.xp += Math.round(xp * 0.6);
    while (ex.lv < MAX_LV && ex.xp >= xpToNext(ex.lv)) {
      ex.xp -= xpToNext(ex.lv); ex.lv++;
      p.hp = this.maxHp(p);
      this.personal(p, ['lvl', 'you', p.name, ex.lv]);
      this.event(p.body, ['float', p.body.x, p.body.y - 50, `Level ${ex.lv}!`, '#ffd43b']);
      this.worldVer++;
    }
    if (ex.lv >= MAX_LV) ex.xp = 0;
    const c = this.ents.get(p.comp);
    const m = c && ex.team.find((x) => x.uid === c.uid);
    if (m) {
      m.xp += xp;
      while (m.lv < MAX_LV && m.xp >= xpToNext(m.lv)) {
        m.xp -= xpToNext(m.lv); m.lv++;
        c.lv = m.lv; c.max = creatureMax(m.sp, m.lv); c.hp = m.hp = c.max;
        this.personal(p, ['lvl', 'comp', SPECIES[m.sp].name, m.lv]);
        this.event(c, ['float', c.x, c.y - 36, `Level ${m.lv}!`, '#ffd43b']);
      }
      if (m.lv >= MAX_LV) m.xp = 0;
    }
  }
  give(p, item, n) {
    p.ex.inv[item] = Math.min(99, (p.ex.inv[item] || 0) + n);
    this.personal(p, ['got', item, n]);
  }
  takeItem(p, item, n) {
    if ((p.ex.inv[item] || 0) < n) return false;
    p.ex.inv[item] -= n;
    if (!p.ex.inv[item]) delete p.ex.inv[item];
    return true;
  }

  // ---- befriending ----
  throwCharm(p) {
    const b = p.body;
    if (!(p.ex.inv.charm > 0)) return this.personal(p, ['toast', 'You have no Bond Charms. Toma the Merchant sells them.']);
    const target = this.enemiesNear(b.x, b.y, 150, areaOf(b.x)).filter((e) => e.type === 'c' && !e.murk && !e.bound && e.hp <= e.max * CATCH_HP)
      .sort((a, e) => dist(a, b) - dist(e, b))[0];
    if (!target) return this.personal(p, ['toast', `Weaken a wild creature to ${Math.round(CATCH_HP * 100)}% health or less, then throw a Bond Charm.`]);
    this.takeItem(p, 'charm', 1);
    this.bump(p, true);
    const chance = catchChance(target);
    target.bound = { by: p.id, t: 1.6, chance };
    target.state = 'bound'; target.anim = 'hurt';
    this.event(b, ['throw', Math.round(b.x), Math.round(b.y - 20), target.id, Math.round(chance * 100)]);
  }
  resolveCatch(e) {
    const { by, chance } = e.bound;
    e.bound = null;
    const p = this.players.get(by);
    if (!p?.ready) { e.state = 'wander'; return; }
    if (Math.random() < chance) {
      this.ents.delete(e.id);
      this.event(e, ['catch', e.id, 1, Math.round(e.x), Math.round(e.y)]);
      this.addCreature(p, e.sp, e.lv, `${SPECIES[e.sp].name} joined you!`);
      if (e.sp === 'lunahop' && p.ex.quests.tracks && p.ex.quests.tracks !== 9) {
        p.ex.quests.tracks = 9;
        this.give(p, 'charm', 3);
        if (!p.ex.gear.includes('feather')) p.ex.gear.push('feather');
        this.personal(p, ['banner', 'Quest complete', 'Glowing Tracks · Lili will be thrilled!']);
      }
    } else {
      e.state = 'chase'; e.angry = true; e.target = 'p:' + by; e.hp = Math.min(e.max, e.hp + Math.round(e.max * 0.1));
      this.event(e, ['catch', e.id, 0, Math.round(e.x), Math.round(e.y)]);
    }
  }
  addCreature(p, sp, lv, msg) {
    const m = { uid: newUid(), sp, lv, xp: 0, hp: creatureMax(sp, lv) };
    const ex = p.ex;
    if (ex.team.length < TEAM_MAX) ex.team.push(m);
    else if (ex.ranch.length < RANCH_MAX) { ex.ranch.push(m); msg += ' It went to the ranch in the village.'; }
    else msg = 'The ranch is full: let a creature go first.';
    if (!ex.dex.caught.includes(sp)) ex.dex.caught.push(sp);
    if (!ex.dex.seen.includes(sp)) ex.dex.seen.push(sp);
    this.personal(p, ['banner', msg, `${SPECIES[sp].name} · level ${lv}`]);
    this.questCheck(p);
    this.bump(p, true);
    if (!this.ents.get(p.comp)) this.summon(p);
  }

  // ---- talking, gathering, opening ----
  interact(p) {
    const b = p.body;
    // A friend who is down comes first.
    for (const f of this.readyPlayers()) if (f !== p && f.downT > 0 && dist(f.body, b) < INTERACT + 6) { this.chan(p, { who: f.id, left: PLAYER.revive, x: b.x, y: b.y }); this.personal(p, ['chan', PLAYER.revive]); return; }
    for (const e of this.ents.values()) if (e.only === p.id && e.quest === 'lost' && dist(e, b) < INTERACT + 10) return this.helpLost(p, e);
    const best = interactables(b.x, b.y, p.ex, this.t, p.nodes)[0];
    if (!best) return;
    if (best.npc) return this.talk(p, best.npc);
    if (best.node) {
      const n = best.node;
      p.nodes[n.id] = this.t + 90;
      if (n.item === 'shells') { const s = 4 + Math.floor(Math.random() * 4); p.ex.shells += s; this.personal(p, ['float', n.x, n.y - 30, `+${s} shells`, '#ffe8a3']); }
      else { this.give(p, n.item, 1); this.personal(p, ['float', n.x, n.y - 30, `+1 ${ITEMS[n.item].name}`, '#d3f9d8']); }
      this.personal(p, ['gather', n.id, 90]);
      this.questCheck(p);
      this.bump(p, true);
      return;
    }
    if (best.chest) {
      const c = best.chest;
      p.ex.chests.push(c.id);
      const got = [];
      for (const [k, n] of Object.entries(c.loot)) {
        if (k === 'shells') { p.ex.shells += n; got.push(`${n} shells`); }
        else if (k === 'gear') { if (!p.ex.gear.includes(n)) p.ex.gear.push(n); got.push(GEAR[n].name); }
        else { this.give(p, k, n); got.push(`${n} ${ITEMS[k].name}${n > 1 ? 's' : ''}`); }
      }
      this.personal(p, ['banner', 'Treasure!', got.join(' · ')]);
      this.personal(p, ['chest', c.id]);
      this.bump(p, true);
      return;
    }
    if (best.sign) return this.personal(p, ['dlg', { title: 'Signpost', lines: [best.sign], choices: [] }]);
    if (best.ranch) return this.personal(p, ['ui', 'ranch']);
  }
  helpLost(p, e) {
    if (p.ex.quests.lost !== 1) return;
    if (!this.takeItem(p, 'sunberry', 1)) return this.personal(p, ['dlg', { title: `Hurt ${SPECIES[e.sp].name}`, lines: ['It’s shivering and too weak to stand. A Sunberry would give it strength.'], choices: [] }]);
    p.ex.quests.lost = 2;
    e.state = 'escort'; e.escort = true; e.hp = Math.round(e.max * 0.5);
    p.escort = e.id;
    this.personal(p, ['dlg', { title: `Hurt ${SPECIES[e.sp].name}`, lines: ['It nibbles the Sunberry and wobbles to its feet. It looks at you hopefully.', 'Lead it to Healer Sana in the village.'], choices: [] }]);
    this.bump(p, true);
  }
  talk(p, npc) {
    const d = dialog(npc, p, this);
    p.dlg = { npc, choices: d.choices.map((c) => c.id) };
    this.personal(p, ['dlg', { npc, title: NPCS[npc].name, lines: d.lines, choices: d.choices }]);
  }

  // ---- requests from the menus ----
  command(p, d) {
    const ex = p.ex, c = d.c;
    if (c === 'new' || c === 'load') {
      if (p.ready) throw new Error('Your explorer is already on the island.');
      const tag = typeof d.tag === 'string' ? d.tag.slice(0, 40) : '';
      if (tag && this.readyPlayers().some((o) => o.tag === tag)) throw new Error('This explorer is already on the island, perhaps in another tab.');
      p.ex = c === 'new' ? newExplorer(p.name, d.look) : validateExplorer(d.rec, p.name);
      p.tag = tag;
      p.prog = 0; p.savedProg = 0; p.lastSave = c === 'load' && Number.isFinite(d.savedAt) ? d.savedAt : 0;
      if (c === 'new') p.prog = 1; // a brand-new explorer isn't saved yet
      return this.spawn(p);
    }
    if (!p.ready || !ex) throw new Error('Choose your explorer first.');
    if (c === 'save') {
      // One consistent capture, taken now. Anything that happens while it uploads stays "unsaved".
      return this.personal(p, ['snap', p.prog, this.snapshot(p)]);
    }
    if (c === 'saved') { if (Number.isSafeInteger(d.prog) && d.prog <= p.prog) { p.savedProg = Math.max(p.savedProg, d.prog); p.lastSave = this.now(); this.bump(p); } return; }
    if (c === 'respawn') { if (p.downT > 0) this.respawn(p); return; }
    if (p.downT > 0) throw new Error('You’re knocked out.');
    if (c === 'choose') return this.choose(p, d);
    if (c === 'active') {
      const i = ex.team.findIndex((m) => m.uid === d.uid);
      if (i < 0) throw new Error('That creature isn’t in your team.');
      if (ex.team[i].hp <= 0) throw new Error(`${SPECIES[ex.team[i].sp].name} has fainted and needs healing first.`);
      if (this.t < p.switchAt) throw new Error('Wait a moment before switching again.');
      p.switchAt = this.t + 1.5;
      ex.active = i;
      this.summon(p);
      this.bump(p, true);
      return;
    }
    if (c === 'use') {
      const item = ITEMS[d.item];
      if (!item || !(ex.inv[d.item] > 0)) throw new Error('You don’t have that.');
      if (item.use === 'heal') {
        if (d.on === 'me') {
          if (p.hp >= this.maxHp(p)) throw new Error('You’re already at full health.');
          p.hp = Math.min(this.maxHp(p), p.hp + item.amount);
        } else {
          const m = ex.team.find((x) => x.uid === d.on);
          if (!m) throw new Error('Pick one of your team.');
          if (m.hp <= 0) throw new Error('A fainted creature needs a Revive Seed.');
          const max = creatureMax(m.sp, m.lv);
          if (m.hp >= max) throw new Error('It’s already at full health.');
          m.hp = Math.min(max, m.hp + item.amount);
          const ce = this.ents.get(p.comp);
          if (ce?.uid === m.uid) ce.hp = m.hp;
        }
      } else if (item.use === 'revive') {
        const m = ex.team.find((x) => x.uid === d.on);
        if (!m || m.hp > 0) throw new Error('Pick a fainted creature in your team.');
        m.hp = Math.round(creatureMax(m.sp, m.lv) / 2);
        if (!this.ents.get(p.comp)) this.summon(p);
      } else throw new Error('That can’t be used here.');
      this.takeItem(p, d.item, 1);
      this.event(p.body, ['float', p.body.x, p.body.y - 44, item.name, '#8ce99a']);
      this.bump(p, true);
      return;
    }
    if (c === 'equip') {
      const g = GEAR[d.gear];
      if (!g || !ex.gear.includes(d.gear)) throw new Error('You don’t own that.');
      if (g.kind === 'weapon') ex.equip.weapon = d.gear;
      else ex.equip.charm = ex.equip.charm === d.gear ? null : d.gear;
      p.hp = Math.min(p.hp, this.maxHp(p));
      this.bump(p, true);
      return;
    }
    if (c === 'buy' || c === 'sell' || c === 'craft') {
      if (dist(p.body, npcPos('merchant')) > 160) throw new Error('Talk to Toma the Merchant to trade.');
      if (c === 'buy') {
        const it = ITEMS[d.item] || GEAR[d.item];
        if (!SHOP.includes(d.item) || !it?.price) throw new Error('Toma doesn’t sell that.');
        if (d.item === 'bigberry' && !ex.flags.includes('bridge')) throw new Error('Big Berries come in once the river bridge is mended.');
        if (GEAR[d.item] && ex.gear.includes(d.item)) throw new Error('You already have that.');
        if (ex.shells < it.price) throw new Error(`You need ${it.price} shells.`);
        ex.shells -= it.price;
        if (GEAR[d.item]) ex.gear.push(d.item); else this.give(p, d.item, 1);
      } else if (c === 'sell') {
        const it = ITEMS[d.item];
        if (!it?.sell || !this.takeItem(p, d.item, 1)) throw new Error('You have nothing like that to sell.');
        ex.shells += it.sell;
      } else {
        const g = GEAR[d.gear];
        if (!g?.craft) throw new Error('That can’t be made.');
        if (ex.gear.includes(d.gear)) throw new Error('You already have that.');
        if ((ex.inv.crystal || 0) < g.craft.crystal || ex.shells < g.craft.shells) throw new Error(`Needs ${g.craft.crystal} Glow Crystals and ${g.craft.shells} shells.`);
        this.takeItem(p, 'crystal', g.craft.crystal); ex.shells -= g.craft.shells; ex.gear.push(d.gear); ex.equip.weapon = d.gear;
        this.personal(p, ['banner', 'Forged!', `${g.name} · equipped`]);
      }
      this.bump(p, true);
      return;
    }
    if (c === 'ranch') {
      if (!island().props.some((q) => q.use === 'ranch' && Math.hypot(q.x - p.body.x, q.y - p.body.y) < 140)) throw new Error('Visit the creature ranch in the village.');
      const ti = ex.team.findIndex((m) => m.uid === d.team), ri = ex.ranch.findIndex((m) => m.uid === d.ranch);
      if (d.op === 'swap' && ti >= 0 && ri >= 0) [ex.team[ti], ex.ranch[ri]] = [ex.ranch[ri], ex.team[ti]];
      else if (d.op === 'deposit' && ti >= 0 && ex.team.length > 1) ex.ranch.push(...ex.team.splice(ti, 1));
      else if (d.op === 'withdraw' && ri >= 0 && ex.team.length < TEAM_MAX) ex.team.push(...ex.ranch.splice(ri, 1));
      else throw new Error(d.op === 'deposit' ? 'Keep at least one creature with you.' : 'That swap isn’t possible.');
      ex.active = clamp(ex.active, 0, ex.team.length - 1);
      this.summon(p);
      this.bump(p, true);
      return;
    }
    if (c === 'release') {
      const ri = ex.ranch.findIndex((m) => m.uid === d.uid);
      if (ri < 0) throw new Error('Only creatures resting at the ranch can be released.');
      ex.ranch.splice(ri, 1);
      this.bump(p, true);
      return;
    }
    throw new Error('Unknown request.');
  }
  choose(p, d) {
    if (!p.dlg || !p.dlg.choices.includes(d.id) || d.npc !== p.dlg.npc) throw new Error('That conversation has moved on.');
    if (dist(p.body, npcPos(d.npc)) > 140) throw new Error('You walked away.');
    p.dlg = null;
    const out = answer(d.npc, d.id, p, this);
    if (out) this.talkResult(p, d.npc, out);
  }
  talkResult(p, npc, out) {
    p.dlg = { npc, choices: (out.choices || []).map((c) => c.id) };
    this.personal(p, ['dlg', { npc, title: NPCS[npc].name, lines: out.lines, choices: out.choices || [], ui: out.ui }]);
  }

  spawn(p) {
    const ex = p.ex;
    p.ready = true;
    const at2 = ex.loc || villageSpot(p.seat);
    p.body = newBody(at2.x, at2.y);
    p.hp = ex.hp; p.downT = 0; p.iT = 2; p.input.length = 0; p.nodes = {};
    this.summon(p);
    if (ex.quests.lost === 2) this.spawnEscort(p);
    this.questCheck(p);
    this.refreshGates();
    this.worldVer++;
    this.bump(p);
    p.full = true;
    this.personal(p, ['ready']);
    this.personal(p, ['warp', Math.round(at2.x), Math.round(at2.y)]);
  }
  summon(p) {
    const old = this.ents.get(p.comp);
    if (old) this.ents.delete(old.id);
    p.comp = null;
    const ex = p.ex;
    let i = ex.active;
    if (!ex.team[i] || ex.team[i].hp <= 0) i = ex.team.findIndex((m) => m.hp > 0);
    if (i < 0) return;
    ex.active = i;
    const m = ex.team[i];
    const c = { id: this.id(), type: 'c', companion: true, owner: p.id, uid: m.uid, sp: m.sp, lv: m.lv, hp: m.hp, max: creatureMax(m.sp, m.lv), el: SPECIES[m.sp].el, r: SPECIES[m.sp].r, x: p.body.x - 24, y: p.body.y + 8, dir: 0, anim: 'idle', state: 'follow', atkCd: 0, t: 0, kx: 0, ky: 0 };
    if (!fits(c.x, c.y, 8, this.open)) { c.x = p.body.x; c.y = p.body.y; }
    this.ents.set(c.id, c);
    p.comp = c.id;
  }
  spawnEscort(p) {
    const sp = rescueSpecies(p.ex);
    const e = this.creature(sp, 3, p.body.x + 24, p.body.y + 10, { only: p.id, quest: 'lost', state: 'escort', escort: true });
    e.hp = Math.round(e.max * 0.5);
    p.escort = e.id;
  }
  snapshot(p) {
    const ex = p.ex;
    // Companion health lives on the creature while it's out.
    const c = this.ents.get(p.comp);
    const team = ex.team.map((m) => ({ ...m, hp: c && c.uid === m.uid ? Math.round(c.hp) : m.hp }));
    const b = p.body;
    const safe = p.downT > 0 || !fits(b.x, b.y, PLAYER.r, { bridge: 1, cave: 1, storm: 1 });
    return {
      kind: 'island-explorer', v: 1, content: CONTENT_VERSION, name: ex.name, look: ex.look, lv: ex.lv, xp: ex.xp,
      hp: p.downT > 0 ? this.maxHp(p) : Math.round(p.hp), shells: ex.shells, inv: { ...ex.inv }, gear: [...ex.gear], equip: { ...ex.equip },
      team, ranch: ex.ranch.map((m) => ({ ...m })), active: ex.active, dex: { seen: [...ex.dex.seen], caught: [...ex.dex.caught] },
      quests: { ...ex.quests }, flags: [...ex.flags], chests: [...ex.chests], time: Math.round(ex.time),
      loc: safe ? { x: SPAWN[0] * T, y: SPAWN[1] * T } : { x: Math.round(b.x), y: Math.round(b.y) }, savedAt: this.now(),
    };
  }

  // ---- quests ----
  questCheck(p) {
    const ex = p.ex, q = ex.quests;
    if (q.supplies === 1 && (ex.inv.sunberry || 0) >= 5) q.supplies = 2;
    else if (q.supplies === 2 && (ex.inv.sunberry || 0) < 5) q.supplies = 1;
    if (q.bridge === 1 && (ex.inv.driftwood || 0) >= 4) q.bridge = 2;
    else if (q.bridge === 2 && (ex.inv.driftwood || 0) < 4) q.bridge = 1;
    const shards = ['tideshard', 'stoneshard', 'embershard'].every((s) => ex.inv[s] > 0);
    if (shards && !ex.flags.includes('peak') && ex.flags.includes('raid')) { ex.flags.push('peak'); this.refreshGates(); }
  }
  flag(p, f) { if (!p.ex.flags.includes(f)) { p.ex.flags.push(f); this.refreshGates(); this.bump(p, true); } }
  refreshGates() {
    for (const [id, g] of Object.entries(GATES)) {
      if (this.open[id]) continue; // once open, a gate stays open so nobody is ever shut in
      const who = this.readyPlayers().find((p) => p.ex.flags.includes(g.flag));
      if (who) this.openGate(id, who);
    }
  }
  openGate(id, who) {
    if (this.open[id]) return;
    this.open[id] = true;
    this.worldVer++;
    const msg = { bridge: 'The river bridge is mended: Mirror Lake is open!', cave: 'The rockslide is cleared: Glowdeep Cave is open!', storm: 'The storm barrier parts: Stormcrown Peak is open!' }[id];
    for (const p of this.readyPlayers()) this.personal(p, ['banner', msg, who && who !== p ? `Thanks to ${who.name}` : '']);
  }

  // ---- creatures ----
  creature(sp, lv, x, y, extra = {}) {
    const def = SPECIES[sp] || MURKS[sp];
    const e = { id: this.id(), type: 'c', sp, lv, hp: creatureMax(sp, lv), max: creatureMax(sp, lv), el: def.el, r: def.r, x, y, home: [x, y], dir: 0, anim: 'idle', state: 'wander', t: Math.random() * 2, atkCd: 1 + Math.random(), kx: 0, ky: 0, murk: !!MURKS[sp], big: !!def.big, spawnT: this.t, ...extra };
    this.ents.set(e.id, e);
    return e;
  }
  everySecond() {
    const ready = this.readyPlayers();
    this.refreshGates();
    // Notice creatures, for the field guide.
    for (const p of ready) for (const e of this.ents.values()) {
      if (e.type === 'c' && !e.companion && !e.murk && !p.ex.dex.seen.includes(e.sp) && dist(e, p.body) < 320 && areaOf(e.x) === areaOf(p.body.x)) { p.ex.dex.seen.push(e.sp); this.bump(p, true); }
    }
    // Wild creatures appear near explorers, mostly from tall grass, and wander off when nobody is near.
    let wild = 0;
    for (const e of this.ents.values()) if (e.type === 'c' && !e.companion && !e.raid && !e.quest && !e.boss) {
      wild++;
      const near = ready.some((p) => areaOf(p.body.x) === areaOf(e.x) && dist(p.body, e) < 1150);
      e.far = near ? 0 : (e.far || 0) + 1;
      if (e.far > 5 && e.state !== 'chase') this.ents.delete(e.id);
    }
    for (const p of ready) {
      const zone = zoneAt(p.body.x, p.body.y), table = SPAWNS[zone];
      if (!table || p.downT || wild >= 40) continue;
      const near = [...this.ents.values()].filter((e) => e.type === 'c' && !e.companion && !e.raid && !e.quest && dist(e, p.body) < 760).length;
      if (near >= table.max || Math.random() < 0.35) continue;
      const pt = this.spawnPoint(p.body, zone);
      if (!pt) continue;
      let roll = Math.random() * table.list.reduce((s, [, w]) => s + w, 0), sp = table.list[0][0];
      for (const [s, w] of table.list) { if ((roll -= w) <= 0) { sp = s; break; } }
      const lv = table.lv[0] + Math.floor(Math.random() * (table.lv[1] - table.lv[0] + 1));
      const e = this.creature(sp, lv, pt.x, pt.y);
      this.event(e, ['spawn', Math.round(e.x), Math.round(e.y), pt.grass ? 1 : 0]);
      wild++;
    }
    this.bosses(ready);
    this.raidStep(ready);
    this.questWorld(ready);
  }
  spawnPoint(from, zone) {
    const m = island();
    for (let tries = 0; tries < 14; tries++) {
      const a = Math.random() * Math.PI * 2, d = 330 + Math.random() * 380;
      const x = from.x + Math.cos(a) * d, y = from.y + Math.sin(a) * d;
      const tx = Math.floor(x / T), ty = Math.floor(y / T);
      if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
      if (zoneAt(x, y) !== zone || inVillage(x, y) || !fits(x, y, 12, this.open)) continue;
      const grass = m.ground[ty * W + tx] === 8;
      if (!grass && tries < 8 && Math.random() < 0.6) continue; // prefer tall grass
      return { x, y, grass };
    }
    return null;
  }
  targetOf(e) {
    if (!e.target) return null;
    if (e.target.startsWith('p:')) { const p = this.players.get(e.target.slice(2)); return p?.ready && !p.downT ? { x: p.body.x, y: p.body.y, pid: p.id, r: PLAYER.r } : null; }
    const c = this.ents.get(+e.target.slice(2));
    return c && c.hp > 0 ? c : null;
  }
  // The nearest explorer or companion an enemy could go for.
  nearestFoe(e, r) {
    let best = null, bd = r;
    for (const p of this.players.values()) {
      if (!p.ready || p.downT || !p.connected || areaOf(p.body.x) !== areaOf(e.x)) continue;
      const d = dist(p.body, e);
      if (d < bd) { bd = d; best = 'p:' + p.id; }
    }
    for (const c of this.ents.values()) {
      if (!c.companion || areaOf(c.x) !== areaOf(e.x)) continue;
      const d = dist(c, e);
      if (d < bd * 0.8) { bd = d; best = 'c:' + c.id; }
    }
    return best;
  }
  stepEnt(e) {
    if (e.type === 'x') return this.stepShot(e);
    if (e.type === 'z') return this.stepZone(e);
    if (e.type === 'h') return this.stepStrike(e);
    if (e.type === 'b') return this.stepBoss(e);
    if (e.animT > 0 && (e.animT -= TICK) <= 0) e.anim = 'idle';
    if (e.state === 'faint') { if ((e.t -= TICK) <= 0) this.ents.delete(e.id); return; }
    if (e.companion) return this.stepCompanion(e);
    this.stepCreature(e);
  }
  moveEnt(e, ang, speed, solidVillage = !e.raid) {
    const dx = Math.cos(ang) * speed * TICK, dy = Math.sin(ang) * speed * TICK;
    const before = [e.x, e.y];
    slide(e, dx, dy, Math.min(12, e.r * 0.8), this.open);
    if (solidVillage && inVillage(e.x, e.y)) [e.x, e.y] = before;
    if (Math.abs(dx) + Math.abs(dy) > 0.2) e.dir = dirOf(dx, dy);
    if (e.anim === 'idle' || e.anim === 'walk') e.anim = e.x !== before[0] || e.y !== before[1] ? 'walk' : 'idle';
  }
  stepCreature(e) {
    const sp = SPECIES[e.sp] || MURKS[e.sp];
    if (e.kx || e.ky) {
      slide(e, e.kx * TICK, e.ky * TICK, Math.min(12, e.r * 0.8), this.open);
      e.kx *= 0.75; e.ky *= 0.75;
      if (Math.abs(e.kx) < 5) e.kx = 0;
      if (Math.abs(e.ky) < 5) e.ky = 0;
    }
    if (e.state === 'bound') { if ((e.bound.t -= TICK) <= 0) this.resolveCatch(e); return; }
    if (e.stun > 0) { e.stun -= TICK; return; }
    e.atkCd -= TICK;
    const weak = e.hp <= e.max * CATCH_HP && !e.murk;
    const speed = sp.spd * (weak ? 0.65 : 1) * (e.slow > 0 ? 0.5 : 1);
    if (e.slow > 0) e.slow -= TICK;
    if (e.state === 'escort') return this.stepEscort(e);
    if (e.state === 'hurt') { e.anim = 'faint'; return; }
    if (e.state === 'windup') {
      if ((e.t -= TICK) <= 0) this.releaseAttack(e);
      return;
    }
    if (e.state === 'lunge') {
      slide(e, Math.cos(e.ang) * speed * 3.4 * TICK, Math.sin(e.ang) * speed * 3.4 * TICK, Math.min(12, e.r * 0.8), this.open);
      if (!e.hitDone) for (const f of this.foesAt(e, e.r + 14)) { this.hurt(f, creatureAtk(e.sp, e.lv), e.el, { knock: 180, ang: e.ang }); e.hitDone = true; }
      if ((e.t -= TICK) <= 0) { e.state = 'chase'; e.anim = 'idle'; }
      return;
    }
    if (e.state === 'flee') {
      const foe = this.nearestFoe(e, 400);
      const f = foe && this.targetOfKey(foe);
      // A Lunahop runs, but slower than an explorer, so a determined chase can catch it.
      if (f) this.moveEnt(e, angTo(f, e), speed * (e.quest === 'luna' ? 0.72 : 1.05));
      if ((e.t -= TICK) <= 0) e.state = 'wander';
      return;
    }
    if (e.state === 'chase') {
      const f = this.targetOf(e);
      const home = { x: e.home[0], y: e.home[1] };
      if (!f || dist(f, e) > 520 || (!e.raid && dist(e, home) > 700)) { e.state = 'wander'; e.target = null; e.angry = false; return; }
      const range = { lunge: 74, spit: 210, zap: 230, spore: 58 }[sp.attack];
      const d = dist(f, e);
      if (d < range && e.atkCd <= 0) return this.startAttack(e, f);
      if (d > range * 0.7) this.moveEnt(e, angTo(e, f), speed);
      else e.anim = 'idle';
      return;
    }
    // wander
    if (e.raid) {
      const foe = this.nearestFoe(e, 900);
      if (foe) { e.target = foe; e.state = 'chase'; return; }
      return this.moveEnt(e, angTo(e, { x: 64.5 * T, y: 71 * T }), speed * 0.7, false);
    }
    if (sp.temper === 'feisty' || e.murk) {
      const foe = this.nearestFoe(e, 175);
      if (foe && !(this.targetOfKey(foe) && inVillage(this.targetOfKey(foe).x, this.targetOfKey(foe).y))) { e.target = foe; e.state = 'chase'; e.angry = true; this.event(e, ['alert', e.id]); return; }
    }
    if (sp.temper === 'shy' && !e.quest) {
      const foe = this.nearestFoe(e, 110);
      if (foe) { e.state = 'flee'; e.t = 2.5; return; }
    }
    if (e.quest === 'luna') {
      const foe = this.nearestFoe(e, 230);
      if (foe) { e.state = 'flee'; e.t = 2; return; }
    }
    if ((e.t -= TICK) <= 0) {
      e.t = 1.2 + Math.random() * 2.4;
      e.wAng = Math.random() < 0.4 ? null : Math.random() * Math.PI * 2;
      if (dist(e, { x: e.home[0], y: e.home[1] }) > 160) e.wAng = angTo(e, { x: e.home[0], y: e.home[1] });
    }
    if (e.wAng != null) this.moveEnt(e, e.wAng, speed * 0.35);
    else e.anim = 'idle';
  }
  targetOfKey(key) { const s = { target: key }; return this.targetOf(s); }
  foesAt(e, r) {
    const out = [];
    for (const p of this.players.values()) if (p.ready && !p.downT && dist(p.body, e) < r + PLAYER.r && areaOf(p.body.x) === areaOf(e.x)) out.push({ type: 'p', pid: p.id, x: p.body.x, y: p.body.y });
    for (const c of this.ents.values()) if (c.companion && dist(c, e) < r + c.r) out.push(c);
    return out;
  }
  hurtFoe(f, amount, el, src) { if (f.type === 'p') this.hurt({ type: 'p', pid: f.pid, hp: 1 }, amount, el, src); else this.hurt(f, amount, el, src); }
  startAttack(e, f = this.targetOf(e)) {
    const sp = SPECIES[e.sp] || MURKS[e.sp];
    const kind = sp.attack;
    const at2 = f ? { x: f.x, y: f.y } : { x: e.x + FACE[e.dir][0] * 40, y: e.y + FACE[e.dir][1] * 40 };
    e.state = 'windup'; e.t = kind === 'spore' ? 0.6 : 0.5; e.lock = at2; e.ang = angTo(e, at2); e.anim = 'attack';
    e.atkCd = 1.6 + Math.random() * 0.9;
    const dur = +e.t.toFixed(2);
    if (kind === 'lunge') this.event(e, ['tele', 'l', Math.round(e.x), Math.round(e.y), 120, 30, +e.ang.toFixed(2), dur]);
    else if (kind === 'spore') this.event(e, ['tele', 'c', Math.round(e.x), Math.round(e.y), e.big ? 80 : 58, 0, 0, dur]);
    else if (kind === 'zap') this.event(e, ['tele', 'c', Math.round(at2.x), Math.round(at2.y), 46, 0, 0, dur]);
    else this.event(e, ['tele', 'l', Math.round(e.x), Math.round(e.y), 220, 16, +e.ang.toFixed(2), dur]);
  }
  releaseAttack(e) {
    const sp = SPECIES[e.sp] || MURKS[e.sp];
    const atk = creatureAtk(e.sp, e.lv);
    e.anim = 'attack'; e.animT = 0.3;
    if (sp.attack === 'lunge') { e.state = 'lunge'; e.t = 0.22; e.hitDone = false; return; }
    e.state = 'chase';
    if (sp.attack === 'spit') this.shoot(e, e.el === 'ember' ? 'ember' : 'water', e.ang, 270, atk, e.el, 'enemy', e.id);
    else if (sp.attack === 'zap') { for (const f of this.foesNear(e.lock, 46, e)) this.hurtFoe(f, atk, e.el, { knock: 60, ang: angTo(e, f) }); this.event(e, ['abil', 'zap', Math.round(e.lock.x), Math.round(e.lock.y), 0, 0]); }
    else if (sp.attack === 'spore') { const r = e.big ? 80 : 58; for (const f of this.foesNear(e, r, e)) this.hurtFoe(f, atk, e.el, { knock: 140, ang: angTo(e, f) }); this.event(e, ['abil', e.murk ? 'murkburst' : 'spore', Math.round(e.x), Math.round(e.y), 0, r]); }
  }
  foesNear(pt, r, e) { return this.foesAt({ x: pt.x, y: pt.y, r: 0 }, r).filter(() => areaOf(pt.x) === areaOf(e.x)); }
  stepEscort(e) {
    const p = this.players.get(e.only);
    if (!p?.ready) { this.ents.delete(e.id); return; }
    const d = dist(e, p.body);
    if (d > 600 || areaOf(e.x) !== areaOf(p.body.x)) { e.x = p.body.x + 20; e.y = p.body.y + 10; }
    else if (d > 46) this.moveEnt(e, angTo(e, p.body), Math.min(170, d * 2.5), false);
    else e.anim = 'idle';
    if (dist(e, npcPos('healer')) < 90) {
      this.ents.delete(e.id);
      p.escort = 0;
      p.ex.quests.lost = 9;
      this.addCreature(p, e.sp, 5, `${SPECIES[e.sp].name} is healed and wants to stay with you!`);
      this.talkResult(p, 'healer', { lines: [`Oh, the poor little thing! There… all better. ${SPECIES[e.sp].name} has really taken to you.`, 'Look after each other out there.'] });
    }
  }
  stepCompanion(c) {
    const p = this.players.get(c.owner);
    if (!p?.ready) { this.ents.delete(c.id); return; }
    const o = p.body;
    c.atkCd -= TICK;
    if (c.kx || c.ky) { slide(c, c.kx * TICK, c.ky * TICK, 8, this.open); c.kx *= 0.7; c.ky *= 0.7; if (Math.abs(c.kx) < 5) c.kx = 0; if (Math.abs(c.ky) < 5) c.ky = 0; }
    const d = dist(c, o);
    if (d > 520 || areaOf(c.x) !== areaOf(o.x)) { c.x = o.x - 20; c.y = o.y + 8; return; }
    const sp = SPECIES[c.sp];
    // Fight what's fighting us, or what our explorer is hitting.
    let foe = null, bd = 230;
    for (const e of this.ents.values()) {
      if ((e.type !== 'c' && e.type !== 'b') || e.companion || e.hp <= 0 || e.only || e.escort || e.state === 'bound' || e.state === 'faint') continue;
      const engaged = e.type === 'b' || e.murk || e.state === 'chase' || e.state === 'windup' || e.state === 'lunge' || (e.id === p.focus && this.t < p.focusT);
      if (!engaged) continue;
      const de = dist(e, o);
      if (de < bd) { bd = de; foe = e; }
    }
    if (foe) {
      const range = { lunge: 46, spit: 190, zap: 200, spore: 54 }[sp.attack] + (foe.r || 12);
      const df = dist(foe, c);
      if (df > range * 0.85) this.moveEnt(c, angTo(c, foe), sp.spd * 1.25, false);
      else {
        c.dir = dirOf(foe.x - c.x, foe.y - c.y);
        if (c.atkCd <= 0) {
          c.atkCd = 1.15; c.anim = 'attack'; c.animT = 0.3;
          const atk = this.compAtk(p, c), ang = angTo(c, foe), src = { pid: p.id, ally: true, ang };
          if (sp.attack === 'spit') this.shoot(c, sp.el === 'ember' ? 'ember' : 'water', ang, 330, atk, sp.el, 'ally', p.id);
          else if (sp.attack === 'zap') { this.hurt(foe, atk, sp.el, src); this.event(c, ['abil', 'zap', Math.round(foe.x), Math.round(foe.y), 0, 0]); }
          else if (sp.attack === 'spore') { for (const e of this.enemiesNear(c.x, c.y, 60, areaOf(c.x))) this.hurt(e, atk, sp.el, { ...src, ang: angTo(c, e) }); this.event(c, ['abil', 'spore', Math.round(c.x), Math.round(c.y), 0, 60]); }
          else { this.hurt(foe, atk, sp.el, { ...src, knock: 90 }); c.x += Math.cos(ang) * 8; c.y += Math.sin(ang) * 8; }
        } else if (c.anim === 'walk') c.anim = 'idle';
      }
      return;
    }
    // Otherwise trot along behind.
    const [fx, fy] = FACE[o.dir];
    const spot = { x: o.x - fx * 34 - fy * 18, y: o.y - fy * 26 + Math.abs(fx) * 10 };
    const ds = dist(c, spot);
    if (ds > 14) this.moveEnt(c, angTo(c, spot), Math.min(sp.spd * 1.6, Math.max(60, ds * 4)), false);
    else { c.anim = 'idle'; c.dir = o.dir; }
  }

  // ---- projectiles, fields and delayed strikes ----
  stepShot(x) {
    x.x += x.vx * TICK; x.y += x.vy * TICK;
    if ((x.life -= TICK) <= 0 || !fits(x.x, x.y, 3, { ...this.open, bridge: 1 })) { this.ents.delete(x.id); return; }
    if (x.from === 'ally') {
      for (const e of this.enemiesNear(x.x, x.y, x.r, areaOf(x.x))) {
        if (x.hit.includes(e.id)) continue;
        x.hit.push(e.id);
        this.hurt(e, x.dmg, x.el, { pid: x.owner, ally: true, knock: x.knock || 60, ang: Math.atan2(x.vy, x.vx) });
        if (!x.pierce) { this.ents.delete(x.id); return; }
      }
    } else {
      for (const f of this.foesAt(x, x.r)) {
        this.hurtFoe(f, x.dmg, x.el, { knock: x.knock || 80, ang: Math.atan2(x.vy, x.vx) });
        if (x.slow && f.type === 'p') { const p = this.players.get(f.pid); if (p) p.body.kx *= 0.5; }
        this.ents.delete(x.id);
        return;
      }
    }
  }
  stepZone(z) {
    if ((z.life -= TICK) <= 0) { this.ents.delete(z.id); return; }
    if ((z.tickT -= TICK) > 0) return;
    z.tickT = 0.5;
    for (const e of this.enemiesNear(z.x, z.y, z.r, areaOf(z.x))) { this.hurt(e, z.dmg, z.el, { pid: z.owner, ally: true }); e.slow = 0.6; }
  }
  // A telegraphed strike: everyone was warned (a 'tele' event), and it lands now.
  strike(src, shape, x, y, a, b, ang, delay, dmg, el, knock = 160, extra = {}) {
    const h = { id: this.id(), type: 'h', shape, x, y, a, b, ang, at: this.t + delay, dmg, el, knock, src: src.id, ...extra };
    this.ents.set(h.id, h);
    this.event({ x, y }, ['tele', shape, Math.round(x), Math.round(y), Math.round(a), Math.round(b), +ang.toFixed(2), +delay.toFixed(2)]);
    return h;
  }
  stepStrike(h) {
    if (this.t < h.at) return;
    this.ents.delete(h.id);
    if (h.fn) return h.fn();
    const inside = (pt) => {
      const dx = pt.x - h.x, dy = pt.y - h.y, d = Math.hypot(dx, dy);
      if (h.shape === 'c') return d < h.a;
      if (h.shape === 'k') return d < h.a && angDiff(Math.atan2(dy, dx), h.ang) < h.b;
      const along = dx * Math.cos(h.ang) + dy * Math.sin(h.ang), across = -dx * Math.sin(h.ang) + dy * Math.cos(h.ang);
      return along > -10 && along < h.a && Math.abs(across) < h.b / 2 + 8;
    };
    for (const f of this.foesAt({ x: h.x, y: h.y, r: 0 }, 2000)) if (areaOf(f.x) === areaOf(h.x) && inside(f)) this.hurtFoe(f, h.dmg, h.el, { knock: h.knock, ang: h.shape === 'c' ? Math.atan2(f.y - h.y, f.x - h.x) : h.ang });
    if (h.fx) this.event(h, ['abil', h.fx, Math.round(h.x), Math.round(h.y), +h.ang.toFixed(2), Math.round(h.a)]);
  }

  // ---- bosses ----
  bosses(ready) {
    for (const [kind, arena] of Object.entries(ARENAS)) {
      const c = { x: arena.at[0] * T, y: arena.at[1] * T };
      const inside = ready.filter((p) => !p.downT && dist(p.body, c) < arena.r * T);
      let boss = [...this.ents.values()].find((e) => e.type === 'b' && e.kind === kind);
      if (!boss && inside.some((p) => !p.ex.flags.includes(kind)) && !(this.bossDue[kind] > this.t)) {
        const def = BOSSES[kind];
        const n = Math.max(1, inside.length);
        const hp = Math.round(def.hp * (0.6 + 0.4 * n));
        boss = { id: this.id(), type: 'b', kind, x: c.x, y: c.y - 20, hp, max: hp, el: def.el, r: def.r, state: 'intro', t: 1.6, anim: 'idle', flip: false, home: [c.x, c.y], cd: 1.2, phase: 1, summonT: 0, hitBy: [] };
        this.ents.set(boss.id, boss);
        for (const p of ready) if (dist(p.body, c) < (arena.r + 10) * T) this.personal(p, ['boss', kind]);
        this.worldVer++;
      }
      if (boss && boss.state !== 'faint') {
        const anyone = ready.some((p) => dist(p.body, c) < (arena.r + 5) * T && !p.downT);
        boss.empty = anyone ? 0 : (boss.empty || 0) + 1;
        if (boss.empty > 12) { this.ents.delete(boss.id); this.worldVer++; }
      }
    }
  }
  stepBoss(e) {
    const def = BOSSES[e.kind];
    if (e.animT > 0 && (e.animT -= TICK) <= 0) e.anim = 'idle';
    if (e.state === 'faint') { if ((e.t -= TICK) <= 0) this.ents.delete(e.id); return; }
    if (e.state === 'intro') { if ((e.t -= TICK) <= 0) e.state = 'fight'; return; }
    const arena = ARENAS[e.kind];
    const c = { x: arena.at[0] * T, y: arena.at[1] * T };
    const foe = this.nearestFoe(e, (arena.r + 4) * T);
    const f = foe && this.targetOfKey(foe);
    const frac = e.hp / e.max;
    e.phase = frac < 0.25 ? 3 : frac < 0.55 ? 2 : 1;
    if (e.state === 'windup') { if ((e.t -= TICK) <= 0) { e.state = 'fight'; e.anim = 'attack'; e.animT = 0.5; } return; }
    if (e.dash) {
      const step = Math.min(e.dash.left, 640 * TICK);
      slide(e, Math.cos(e.dash.ang) * step, Math.sin(e.dash.ang) * step, 24, this.open);
      e.dash.left -= step;
      if (e.dash.left <= 0) e.dash = null;
      return;
    }
    e.cd -= TICK * (e.phase === 3 ? 1.35 : 1);
    if (f) {
      e.flip = f.x > e.x;
      const d = dist(f, e);
      if (d > 140 && dist(e, c) < arena.r * T) { this.moveEnt(e, angTo(e, f), def.speed, false); e.anim = 'walk'; }
      else if (e.anim === 'walk') e.anim = 'idle';
    } else if (dist(e, c) > 30) { this.moveEnt(e, angTo(e, c), def.speed, false); e.anim = 'walk'; }
    if (e.cd > 0 || !f) return;
    const atk = def.atk;
    const targets = this.readyPlayers().filter((p) => !p.downT && dist(p.body, c) < (arena.r + 3) * T).map((p) => p.body);
    const pick = (list) => list[Math.floor(Math.random() * list.length)];
    const ang = angTo(e, f);
    const wind = (t) => { e.state = 'windup'; e.t = t; e.anim = 'windup'; };
    // Summon helpers in later phases.
    if (e.phase >= 2 && this.t > e.summonT && e.kind !== 'quartzhulk') {
      e.summonT = this.t + (e.kind === 'tempestra' ? 22 : 18);
      const alive = [...this.ents.values()].filter((x) => x.summoner === e.id && x.hp > 0).length;
      for (let i = alive; i < (e.kind === 'tempestra' ? 3 : 2); i++) {
        const a = Math.random() * Math.PI * 2;
        const m = this.creature('murk', e.kind === 'tempestra' ? 15 : 9, e.x + Math.cos(a) * 90, e.y + Math.sin(a) * 90, { summoner: e.id, boss: true, angry: true, state: 'wander' });
        this.event(m, ['spawn', Math.round(m.x), Math.round(m.y), 2]);
      }
      e.cd = 1.2;
      return;
    }
    const moves = { mirebrute: ['slam', 'spit3', 'tongue'], quartzhulk: ['pound', 'shards', 'charge', ...(e.phase >= 2 ? ['pillars'] : [])], tempestra: ['bolts', 'gust', 'dive', 'tail'] }[e.kind];
    const move = pick(moves);
    e.cd = e.phase === 3 ? 1.5 : 2.1;
    switch (move) {
      case 'slam': wind(1); this.strike(e, 'c', e.x, e.y, 112, 0, 0, 1, atk * 1.3, def.el, 320, { fx: 'slam' }); break;
      case 'spit3': wind(0.7); for (const d of [-0.32, 0, 0.32]) this.later(0.7, () => this.shoot(e, 'mud', ang + d, 270, atk * 0.8, def.el, 'enemy', e.id, { r: 14, slow: true })); this.event(e, ['tele', 'k', Math.round(e.x), Math.round(e.y), 240, 0.42, +ang.toFixed(2), 0.7]); break;
      case 'tongue': wind(0.8); this.strike(e, 'l', e.x, e.y, 280, 40, ang, 0.8, atk, def.el, -260, { fx: 'tongue' }); break;
      case 'pound': wind(1.1); this.strike(e, 'c', e.x, e.y, 140, 0, 0, 1.1, atk * 1.4, def.el, 340, { fx: 'slam' }); break;
      case 'shards': wind(0.8); this.event(e, ['tele', 'c', Math.round(e.x), Math.round(e.y), 60, 0, 0, 0.8]); this.later(0.8, () => { for (let i = 0; i < 10; i++) this.shoot(e, 'shard', (i / 10) * Math.PI * 2 + e.hp % 1, 250, atk * 0.7, def.el, 'enemy', e.id, { r: 12, life: 1.6 }); }); break;
      case 'charge': wind(0.9); this.strike(e, 'l', e.x, e.y, 380, 76, ang, 0.9, atk * 1.3, def.el, 300); this.later(0.9, () => { e.dash = { ang, left: 360 }; }); break;
      case 'pillars': wind(1.2); for (const t of targets.slice(0, 4)) this.strike(e, 'c', t.x, t.y, 62, 0, 0, 1.2, atk * 1.1, def.el, 200, { fx: 'pillar' }); break;
      case 'bolts': wind(1); for (const t of [...targets, ...Array.from({ length: e.phase >= 3 ? 4 : 2 }, () => ({ x: c.x + (Math.random() - 0.5) * arena.r * T * 1.6, y: c.y + (Math.random() - 0.5) * arena.r * T * 1.2 }))]) this.strike(e, 'c', t.x, t.y, 70, 0, 0, 1, atk * 1.2, def.el, 140, { fx: 'bolt' }); break;
      case 'gust': wind(0.8); this.strike(e, 'k', e.x, e.y, 320, 0.9, ang, 0.8, atk * 0.8, def.el, 520, { fx: 'gust' }); break;
      case 'dive': wind(1); this.strike(e, 'l', e.x, e.y, 420, 92, ang, 1, atk * 1.4, def.el, 280); this.later(1, () => { e.dash = { ang, left: 400 }; }); break;
      case 'tail': wind(0.7); this.strike(e, 'c', e.x, e.y, 124, 0, 0, 0.7, atk, def.el, 300, { fx: 'slam' }); break;
    }
  }
  later(delay, fn) { const h = { id: this.id(), type: 'h', shape: 'none', at: this.t + delay, x: -1e6, y: -1e6, a: 0, fn }; this.ents.set(h.id, h); }
  bossDown(e) {
    const def = BOSSES[e.kind];
    const arena = ARENAS[e.kind];
    const c = { x: arena.at[0] * T, y: arena.at[1] * T };
    this.bossDue[e.kind] = this.t + 30;
    for (const m of this.ents.values()) if (m.summoner === e.id) this.ents.delete(m.id);
    for (const p of this.readyPlayers()) {
      if (dist(p.body, c) > (arena.r + 8) * T) continue;
      const first = !p.ex.flags.includes(e.kind);
      p.ex.shells += first ? 120 : 30;
      this.gainXp(p, first ? 260 + 90 * Object.keys(BOSSES).indexOf(e.kind) : 80);
      if (first) {
        p.ex.flags.push(e.kind);
        if (def.shard) this.give(p, def.shard, 1);
        if (def.quest) p.ex.quests[def.quest] = 9;
        if (e.kind === 'tempestra') p.ex.flags.push('champion');
      }
      this.personal(p, ['banner', `${def.name} is calmed!`, first ? (def.shard ? `You got the ${ITEMS[def.shard].name}` : 'The storm over the island breaks. You did it!') : 'Thanks for the help!']);
      if (e.kind === 'tempestra' && first) this.personal(p, ['ending']);
      this.questCheck(p);
      this.bump(p, true);
    }
    this.refreshGates();
    this.worldVer++;
  }

  // ---- the village raid and quest happenings ----
  raidStep(ready) {
    const inV = ready.filter((p) => inVillage(p.body.x, p.body.y));
    if (!this.raid) {
      const due = inV.filter((p) => p.ex.quests.defend === 1);
      if (!due.length) return;
      this.raid = { wave: 0, left: [], gap: 3, quiet: 0 };
      for (const p of ready) if (p.ex.quests.defend === 1) { p.ex.quests.defend = 2; this.bump(p); }
      for (const p of ready) this.personal(p, ['banner', 'Murklings attack the village!', 'Drive them out: three waves are coming']);
      this.worldVer++;
      return;
    }
    const r = this.raid;
    r.quiet = inV.length ? 0 : r.quiet + 1;
    if (r.quiet > 40) {
      for (const id of r.left) this.ents.delete(id);
      for (const p of ready) if (p.ex.quests.defend === 2) { p.ex.quests.defend = 1; this.bump(p); }
      this.raid = null; this.worldVer++;
      return;
    }
    r.left = r.left.filter((id) => this.ents.get(id)?.hp > 0);
    if (r.left.length) return;
    if (r.wave >= 3) {
      for (const p of ready) if (p.ex.quests.defend === 2 || (p.ex.quests.defend === 1 && inVillage(p.body.x, p.body.y))) {
        p.ex.quests.defend = 9;
        this.give(p, 'embershard', 1);
        p.ex.shells += 150;
        this.gainXp(p, 300);
        this.flag(p, 'raid');
        this.personal(p, ['banner', 'The village is safe!', 'Elder Maru gives you the Ember Shard']);
        this.questCheck(p);
        this.bump(p, true);
      }
      this.raid = null; this.worldVer++;
      return;
    }
    if ((r.gap -= 1) > 0) return;
    r.wave++; r.gap = 3;
    const count = [0, 4, 6, 5][r.wave] + Math.max(0, ready.length - 1);
    for (let i = 0; i < count; i++) {
      const [x, y] = RAID_FROM[i % RAID_FROM.length];
      const m = this.creature('murk', 11 + r.wave, (x + (Math.random() - 0.5) * 2) * T, (y + (Math.random() - 0.5) * 2) * T, { raid: true, angry: true });
      r.left.push(m.id);
    }
    if (r.wave === 3) { const [x, y] = RAID_FROM[0]; r.left.push(this.creature('murkbrute', 14, x * T, y * T, { raid: true, angry: true }).id); }
    for (const p of ready) this.personal(p, ['toast', `Wave ${r.wave} of 3!`]);
    this.worldVer++;
  }
  questWorld(ready) {
    for (const p of ready) {
      const q = p.ex.quests;
      // The hurt creature waits in the western clearing for whoever is looking for it.
      if (q.lost === 1 && dist(p.body, { x: LOST_AT[0] * T, y: LOST_AT[1] * T }) < 700 && ![...this.ents.values()].some((e) => e.only === p.id && e.quest === 'lost')) {
        const e = this.creature(rescueSpecies(p.ex), 3, LOST_AT[0] * T, LOST_AT[1] * T, { only: p.id, quest: 'lost', state: 'hurt' });
        e.hp = Math.round(e.max * 0.2);
      }
      if (q.lost === 2 && !this.ents.get(p.escort)) this.spawnEscort(p);
      // Following the glowing tracks to their end startles a Lunahop.
      if (q.tracks === 1 && dist(p.body, { x: LUNA_AT[0] * T, y: LUNA_AT[1] * T }) < 110 && ![...this.ents.values()].some((e) => e.quest === 'luna')) {
        q.tracks = 2;
        const e = this.creature('lunahop', 9, LUNA_AT[0] * T - 40, LUNA_AT[1] * T - 30, { quest: 'luna', home: [LUNA_AT[0] * T, LUNA_AT[1] * T - 30] });
        this.event(e, ['spawn', Math.round(e.x), Math.round(e.y), 3]);
        this.personal(p, ['banner', 'A Lunahop!', 'Weaken it, then throw a Bond Charm before it escapes']);
        this.bump(p);
      }
    }
    for (const e of this.ents.values()) {
      if (e.quest !== 'luna') continue;
      const near = ready.some((p) => dist(p.body, e) < 900);
      e.far = near ? 0 : (e.far || 0) + 1;
      if (e.far > 20) {
        this.ents.delete(e.id);
        for (const p of ready) if (p.ex.quests.tracks === 2) { p.ex.quests.tracks = 1; this.personal(p, ['toast', 'The Lunahop slipped away. Its tracks glow again on the shore.']); this.bump(p); }
      }
    }
  }

  // ---- what each player is sent ----
  event(at2, ev) { for (const p of this.players.values()) if (p.ready && dist(p.body, at2) < NEAR + 200 && areaOf(p.body.x) === areaOf(at2.x)) p.events.push(ev); }
  // Most events ride along with the next frame; replies to a request (a save, a conversation) go at once.
  personal(p, ev) {
    p.events.push(ev);
    if (!p.ready || ['dlg', 'snap', 'ready', 'ui', 'warp', 'toast', 'boss', 'ending'].includes(ev[0])) this.send(p.id, { k: 'ev', ev: p.events.splice(0) });
  }
  sendFrame(p) {
    const b = p.body, area = areaOf(b.x);
    const e = [];
    for (const o of this.players.values()) {
      if (!o.ready || o === p || areaOf(o.body.x) !== area || dist(o.body, b) > NEAR) continue;
      e.push(['p', o.id, Math.round(o.body.x), Math.round(o.body.y), o.body.dir, playerAnim(o), Math.round((o.hp / this.maxHp(o)) * 100), o.seat, (o.iT > 0 ? 1 : 0) | (o.chan ? 2 : 0) | (o.shield > 0 ? 4 : 0)]);
    }
    for (const x of this.ents.values()) {
      if (x.type === 'h') continue;
      if (x.only && x.only !== p.id) continue;
      if (areaOf(x.x) !== area || Math.abs(x.x - b.x) > NEAR || Math.abs(x.y - b.y) > NEAR) continue;
      if (x.type === 'c') {
        const owner = x.companion ? this.players.get(x.owner) : null;
        e.push(['c', x.id, x.sp, Math.round(x.x), Math.round(x.y), x.dir, ANIM_C[x.state === 'windup' ? 'windup' : x.anim] ?? 0, Math.round((x.hp / x.max) * 100), x.lv,
          (!x.companion && !x.murk && x.hp <= x.max * CATCH_HP && !x.quest?.startsWith('l') ? 1 : 0) | (x.state === 'bound' ? 2 : 0) | (x.companion ? 4 : 0) | (x.angry || x.murk ? 8 : 0) | (x.quest === 'lost' ? 16 : 0) | (x.quest === 'luna' && x.hp <= x.max * CATCH_HP ? 1 : 0),
          owner ? owner.seat : -1]);
      } else if (x.type === 'b') {
        e.push(['b', x.id, x.kind, Math.round(x.x), Math.round(x.y), ANIM_B[x.state === 'faint' ? 'faint' : x.anim] ?? 0, Math.round((x.hp / x.max) * 1000), x.flip ? 1 : 0]);
      } else if (x.type === 'x') {
        e.push(['x', x.id, x.kind, Math.round(x.x), Math.round(x.y), Math.round(x.vx), Math.round(x.vy)]);
      } else if (x.type === 'z') {
        e.push(['z', x.id, x.kind, Math.round(x.x), Math.round(x.y), x.r]);
      }
    }
    const me = [Math.round(b.x * 10), Math.round(b.y * 10), b.dir, Math.round(b.kx), Math.round(b.ky), +b.dT.toFixed(3), +b.dCd.toFixed(3), +b.ddx.toFixed(4), +b.ddy.toFixed(4), +b.sT.toFixed(3), +b.sCd.toFixed(3), p.downT > 0 ? 1 : 0, Math.round(p.hp), this.maxHp(p), p.iT > 0 ? 1 : 0, p.chan ? +p.chan.left.toFixed(2) : 0, Math.round(p.downT), Math.round(p.shield)];
    const msg = { k: 'f', t: this.tick, st: +this.t.toFixed(2), ack: p.lastSeq, me, e };
    if (p.events.length) msg.ev = p.events.splice(0);
    this.send(p.id, msg);
  }
  flushPersonal(p, force = false) {
    if (p.ready && (force || p.meVer !== p.sentMe) && (force || this.tick % 3 === 0)) {
      p.sentMe = p.meVer;
      this.send(p.id, { k: 'me', ...this.personalView(p) });
    }
    if (force || p.sentW !== this.worldVer) {
      if (!force && this.tick % 5 !== 0) return;
      p.sentW = this.worldVer;
      this.send(p.id, { k: 'w', ...this.worldView(p) });
    }
  }
  personalView(p) {
    const ex = p.ex;
    const c = this.ents.get(p.comp);
    const nodes = {};
    for (const [id, t] of Object.entries(p.nodes)) if (t > this.t) nodes[id] = +(t - this.t).toFixed(1); else delete p.nodes[id];
    return {
      st: +this.t.toFixed(2), name: ex.name, look: ex.look, seat: p.seat, lv: ex.lv, xp: ex.xp, next: xpToNext(ex.lv), hp: Math.round(p.hp), max: this.maxHp(p), shells: ex.shells,
      inv: ex.inv, gear: ex.gear, equip: ex.equip,
      team: ex.team.map((m) => ({ uid: m.uid, sp: m.sp, lv: m.lv, xp: m.xp, next: xpToNext(m.lv), hp: c && c.uid === m.uid ? Math.round(c.hp) : m.hp, max: creatureMax(m.sp, m.lv), cd: Math.max(0, +((p.cds[m.uid] || 0) - this.t).toFixed(1)), out: !!c && c.uid === m.uid })),
      ranch: ex.ranch.map((m) => ({ uid: m.uid, sp: m.sp, lv: m.lv })), active: ex.active,
      dex: ex.dex, quests: ex.quests, flags: ex.flags, chests: ex.chests, nodes, unsaved: p.prog > p.savedProg, lastSave: p.lastSave, time: Math.round(ex.time),
    };
  }
  worldView(p) {
    const boss = [...this.ents.values()].find((e) => e.type === 'b' && areaOf(e.x) === areaOf(p.body.x) && dist(e, p.body) < 1400);
    return {
      open: { ...this.open },
      roster: [...this.players.values()].map((o) => ({ id: o.id, name: o.name, seat: o.seat, ready: o.ready, connected: o.connected, lv: o.ex?.lv || 0, look: o.ex?.look || null, zone: o.zone, down: o.downT > 0, unsaved: o.ready && o.prog > o.savedProg })),
      boss: boss ? { kind: boss.kind } : null,
      raid: this.raid ? { wave: this.raid.wave, left: this.raid.left.length } : null,
    };
  }
}

const ANIM_C = { idle: 0, walk: 1, attack: 2, hurt: 3, faint: 4, windup: 5 };
const ANIM_B = { idle: 0, walk: 1, windup: 2, attack: 3, hurt: 4, faint: 5 };
function playerAnim(p) {
  const b = p.body;
  if (p.downT > 0) return 5;
  if (b.dT > 0) return 3;
  if (b.sT > 0) return 2;
  if (p.iT > 0.3) return 4;
  return b.moving ? 1 : 0;
}
export function catchChance(e) {
  const base = SPECIES[e.sp]?.catch ?? 0;
  return clamp(base + (CATCH_HP - e.hp / e.max) * 1.2, 0.1, 0.95);
}
export const npcPos = (id) => ({ x: NPCS[id].at[0] * T, y: NPCS[id].at[1] * T });
// Where each seat stands in the village square, so friends don't start on top of each other.
const villageSpot = (seat) => { const [dx, dy] = [[0, 0], [1.6, 0.2], [-1.6, 0.2], [0, -1.3]][seat] || [0, 0]; return { x: (SPAWN[0] + dx) * T, y: (SPAWN[1] + dy) * T }; };
export const rescueSpecies = (ex) => {
  const mine = ex.team.concat(ex.ranch).map((m) => m.sp);
  return STARTERS.find((s) => !mine.includes(s)) || 'puffcap';
};

// Things an explorer could use here, nearest first (the host acts on the first; screens label the button).
export function interactables(x, y, ex, now, nodes = {}) {
  const m = island(), out = [];
  const consider = (o, px, py, r = INTERACT) => { const d = Math.hypot(px - x, py - y); if (d < r) out.push({ ...o, d }); };
  for (const [id, n] of Object.entries(NPCS)) consider({ npc: id, label: 'Talk' }, n.at[0] * T, n.at[1] * T, INTERACT + 8);
  const cx = Math.floor(x / T / 8), cy = Math.floor(y / T / 8);
  for (let j = cy - 1; j <= cy + 1; j++) for (let i = cx - 1; i <= cx + 1; i++) for (const p of m.chunks.get(i + ',' + j) || []) {
    if (p.node) { const n = m.nodes.find((q) => q.id === p.node); if (!((nodes[n.id] || 0) > now)) consider({ node: n, label: n.item === 'shells' ? 'Pick up' : 'Gather' }, n.x, n.y - 8); }
    else if (p.chest && ex && !ex.chests.includes(p.chest)) consider({ chest: m.chests.find((c) => c.id === p.chest), label: 'Open' }, p.x, p.y - 8);
    else if (p.sign) consider({ sign: p.sign, label: 'Read' }, p.x, p.y - 8, 44);
    else if (p.use === 'ranch') consider({ ranch: true, label: 'Ranch' }, p.x, p.y - 8);
  }
  return out.sort((a, b) => a.d - b.d);
}

// ---------------- conversations ----------------
const has = (ex, f) => ex.flags.includes(f);
function dialog(npc, p, w) {
  const ex = p.ex, q = ex.quests;
  const L = (lines, choices = []) => ({ lines, choices });
  switch (npc) {
    case 'elder': {
      if (q.starter !== 9) return L([`Welcome to Brightwater, ${ex.name}! A storm has sat on Stormcrown Peak for weeks, and the island’s creatures grow restless.`, 'No explorer should walk alone. Choose a companion: they will grow with you.'], STARTERS.map((s) => ({ id: s, label: `${SPECIES[s].name} (${SPECIES[s].el})` })));
      if (q.defend === 1 || q.defend === 2) return L(['The murklings are coming down from the peak! Stand with us in the square.']);
      if (has(ex, 'quartzhulk') && !q.defend) return L(['You calmed the Quartzhulk? Then the storm will send its murklings at us next.', 'Will you help us hold the village?'], [{ id: 'defend', label: 'I’ll defend the village' }]);
      if (has(ex, 'raid') && !q.peak) return L(['With the Tide, Stone and Ember Shards together, the storm barrier on the pass will part for you.', 'Climb Stormcrown Peak and calm whatever sits at the heart of the storm.'], [{ id: 'peak', label: 'I’m ready' }]);
      if (q.peak === 1) return L(['The pass north of the village leads up to the peak. Bring friends, and plenty of berries.']);
      if (has(ex, 'champion')) return L([`The skies are clear thanks to you, ${ex.name}. The island is yours to explore.`, ...(q.collector === 1 ? [collectorLine(ex)] : [])], collectorChoice(ex));
      if (!q.collector) return L(['The island has many kinds of creatures. Befriend six different kinds and come back to me.', 'Weaken one to a third of its health, then throw a Bond Charm.'], [{ id: 'collector', label: 'I’ll do it' }]);
      if (q.collector === 1) return L([collectorLine(ex)], collectorChoice(ex));
      return L(['Captain Ash at the north gate knows what to do next. And Healer Sana could use a hand.']);
    }
    case 'healer': {
      const lines = ['Let me look after you all… There! Everyone is rested and healthy.'];
      heal(p, w);
      if (q.supplies === 2) return L([...lines, 'Are those Sunberries for me?'], [{ id: 'supplies', label: 'Hand over 5 Sunberries' }]);
      if (!q.supplies && q.starter === 9) return L([...lines, 'I’m running low on Sunberries. Could you pick 5 from the bushes in Whispering Woods, west of here?'], [{ id: 'supplies-start', label: 'Sure' }]);
      if (q.supplies === 1) return L([...lines, `${ex.inv.sunberry || 0} of 5 Sunberries so far. The bushes are in the woods to the west.`]);
      return L(lines);
    }
    case 'merchant': {
      const g = GEAR.crystalblade;
      const choices = [{ id: 'shop', label: 'Let’s trade' }];
      if (!ex.gear.includes('crystalblade') && (ex.inv.crystal || 0) >= 1) choices.push({ id: 'craft', label: `Forge a Crystal Blade (${g.craft.crystal} crystals, ${g.craft.shells} shells)` });
      return L(['Toma’s travelling goods! Berries, charms, blades. I also buy mushrooms and crystals.'], choices);
    }
    case 'kid': {
      if (q.starter !== 9) return L(['Elder Maru said you might get a companion! Go see her first!']);
      if (!q.lost) return L(['I heard crying in the woods, out west past the bushes. I think a creature is hurt, but I’m not allowed in there alone…', 'Could you look? Take a Sunberry for it.'], [{ id: 'lost', label: 'I’ll find it' }]);
      if (q.lost !== 9) return L(['Did you find the poor thing? It was somewhere in the woods’ western clearing.']);
      if (!q.tracks) return L(['You found it! You’re the best!', 'Oh! Last night I saw glowing paw prints on the beach, heading west. Nobody believes me. Will you follow them?'], [{ id: 'tracks', label: 'Let’s see where they go' }]);
      if (q.tracks !== 9) return L(['The glowing tracks start on the shore south of the village and go west. Be quick and gentle!']);
      return L(['A real Lunahop! I’m telling EVERYONE.']);
    }
    case 'ranger': {
      if (q.starter !== 9) return L(['Captain Ash, island ranger. Get yourself a companion from Elder Maru before you leave the village.']);
      if (!q.bridge && !has(ex, 'bridge')) return L(['The storm washed out the river bridge to Mirror Lake. If you bring me 4 Driftwood from Sunsand Shore, I can mend it.'], [{ id: 'bridge', label: 'I’ll fetch driftwood' }]);
      if (q.bridge === 2) return L(['That’s good timber.'], [{ id: 'bridge-done', label: 'Hand over 4 Driftwood' }]);
      if (q.bridge === 1) return L([`${ex.inv.driftwood || 0} of 4 Driftwood. It washes up all along the south shore.`]);
      if (has(ex, 'mirebrute') && !q.cave) return L(['You beat the Mirebrute? Then you can handle Glowdeep. I’ve cleared the rockslide at the cave mouth, north of here.', 'Something down there glows brighter every night. Find out what.'], [{ id: 'cave', label: 'Into the cave' }]);
      if (q.cave === 1) return L(['Glowdeep Cave is north, up the road. Its deepest chamber is at the far end.']);
      if (!has(ex, 'mirebrute')) return L(['Old Reed at the lake dock has been jumpy lately. Go and see him.']);
      return L(['Stay sharp out there.']);
    }
    case 'fisher': {
      const choices = [];
      if (!q.marsh && !has(ex, 'mirebrute')) return L(['Shh! Something huge splashes about in the marsh north of the lake. It scares the fish and the Ripplefins.', 'You look brave. Would you deal with it?'], [{ id: 'marsh', label: 'I’ll take a look' }]);
      if (!q.fishing) choices.push({ id: 'fishing', label: 'Anything else?' });
      if (q.fishing === 1 && ex.team.concat(ex.ranch).some((m) => m.sp === 'ripplefin')) choices.push({ id: 'fishing-done', label: 'Show him your Ripplefin' });
      if (q.marsh === 1) return L(['It’s in the marsh, north of the water. Mind the mud.'], choices);
      return L([has(ex, 'mirebrute') ? 'The marsh is quiet again. Fish are biting!' : 'Lovely day for it.'], choices);
    }
  }
  return L(['…']);
}
function collectorLine(ex) { return `Friends of every kind: ${ex.dex.caught.length} of 6 kinds befriended.`; }
function collectorChoice(ex) { return ex.quests.collector === 1 && ex.dex.caught.length >= 6 ? [{ id: 'collector-done', label: 'Show her your friends' }] : []; }
function heal(p, w) {
  p.hp = w.maxHp(p);
  for (const m of p.ex.team) m.hp = creatureMax(m.sp, m.lv);
  const c = w.ents.get(p.comp);
  if (c) c.hp = c.max; else w.summon(p);
  w.event(p.body, ['float', p.body.x, p.body.y - 44, 'Rested', '#8ce99a']);
  w.bump(p, true);
}
function answer(npc, id, p, w) {
  const ex = p.ex, q = ex.quests;
  const done = (quest, title, lines) => { q[quest] = 9; w.personal(p, ['banner', 'Quest complete', title]); w.bump(p, true); return { lines }; };
  const start = (quest, lines) => { q[quest] = 1; w.questCheck(p); w.bump(p, true); return { lines }; };
  if (npc === 'elder' && STARTERS.includes(id) && q.starter !== 9) {
    q.starter = 9;
    w.give(p, 'charm', 3); w.give(p, 'sunberry', 3);
    w.addCreature(p, id, 5, `${SPECIES[id].name} chose you too!`);
    return { lines: [`${SPECIES[id].name} it is! Look after each other.`, 'Take these Bond Charms and Sunberries. Captain Ash, at the north edge of the village, has work for a new explorer.'] };
  }
  if (npc === 'elder' && id === 'defend' && has(ex, 'quartzhulk') && !q.defend) return start('defend', ['Thank you. Stay close to the square: they will come from every road.']);
  if (npc === 'elder' && id === 'peak' && has(ex, 'raid') && !q.peak) { q.peak = 1; w.questCheck(p); w.bump(p, true); return { lines: ['The pass is north of the village, past the road to the cave. Good luck, explorer.'] }; }
  if (npc === 'elder' && id === 'collector' && !q.collector) return start('collector', ['Wonderful. Each kind you befriend is recorded in your field guide.']);
  if (npc === 'elder' && id === 'collector-done' && q.collector === 1 && ex.dex.caught.length >= 6) { ex.shells += 200; w.give(p, 'bigberry', 3); return done('collector', 'Friends of Every Kind', ['Six kinds! You have a gift. Take these, with my thanks.']); }
  if (npc === 'healer' && id === 'supplies-start' && !q.supplies) return start('supplies', ['Thank you, dear. Berry bushes have red fruit; walk up and gather.']);
  if (npc === 'healer' && id === 'supplies' && q.supplies === 2 && w.takeItem(p, 'sunberry', 5)) { ex.shells += 60; w.give(p, 'seed', 2); return done('supplies', 'Supplies for the Healer', ['These will help so many creatures. Here: Revive Seeds, for when a companion faints.']); }
  if (npc === 'merchant' && id === 'shop') return { lines: ['Take your time!'], ui: 'shop' };
  if (npc === 'merchant' && id === 'craft') { w.command(p, { c: 'craft', gear: 'crystalblade' }); return { lines: ['Hammer, hammer… done! Mind the edge.'] }; }
  if (npc === 'kid' && id === 'lost' && !q.lost) { w.give(p, 'sunberry', 1); return start('lost', ['Thank you! Here’s a Sunberry for it. The clearing is west, in the woods.']); }
  if (npc === 'kid' && id === 'tracks' && !q.tracks) return start('tracks', ['Yay! They start on the beach south of the village and go west. Bring Bond Charms!']);
  if (npc === 'ranger' && id === 'bridge' && !q.bridge) return start('bridge', ['Good. Driftwood washes up all along Sunsand Shore, south of the village.']);
  if (npc === 'ranger' && id === 'bridge-done' && q.bridge === 2 && w.takeItem(p, 'driftwood', 4)) { ex.shells += 50; w.flag(p, 'bridge'); return done('bridge', 'Mend the River Bridge', ['Done! The bridge east of the village is fixed. Mirror Lake is that way: Old Reed fishes off the dock.']); }
  if (npc === 'ranger' && id === 'cave' && has(ex, 'mirebrute') && !q.cave) return start('cave', ['Watch for Gemmoles. They headbutt first and ask questions never.']);
  if (npc === 'fisher' && id === 'marsh' && !q.marsh) return start('marsh', ['Bless you. It’s in the marsh, north of the lake.']);
  if (npc === 'fisher' && id === 'fishing' && !q.fishing) return start('fishing', ['I’ve never seen a Ripplefin up close. Befriend one and show me, would you?']);
  if (npc === 'fisher' && id === 'fishing-done' && q.fishing === 1 && ex.team.concat(ex.ranch).some((m) => m.sp === 'ripplefin')) { w.give(p, 'bigberry', 3); return done('fishing', 'The Lake’s Pride', ['Look at those frills! Here, take some Big Berries.']); }
  return null;
}

// What the tracker shows: the most important quest and where to go.
export function objective(ex) {
  const q = ex.quests;
  const go = (quest, step, at2) => ({ quest, name: QUESTS[quest].name, text: QUESTS[quest].steps[step] || '', at: at2 });
  const npcAt = (id) => [NPCS[id].at[0] * T, NPCS[id].at[1] * T];
  if (q.starter !== 9) return go('starter', 1, npcAt('elder'));
  if (q.defend === 1 || q.defend === 2) return go('defend', q.defend, [64.5 * T, 71 * T]);
  if (q.peak === 1) return go('peak', 1, [ARENAS.tempestra.at[0] * T, ARENAS.tempestra.at[1] * T]);
  if (q.cave === 1) return go('cave', 1, [ARENAS.quartzhulk.at[0] * T, ARENAS.quartzhulk.at[1] * T]);
  if (q.marsh === 1) return go('marsh', 1, [ARENAS.mirebrute.at[0] * T, ARENAS.mirebrute.at[1] * T]);
  if (q.bridge === 2) return go('bridge', 2, npcAt('ranger'));
  if (q.bridge === 1) return go('bridge', 1, [64.5 * T, 90 * T]);
  if (q.lost === 2) return go('lost', 2, npcAt('healer'));
  if (q.lost === 1) return go('lost', 1, [LOST_AT[0] * T, LOST_AT[1] * T]);
  if (q.supplies === 2) return go('supplies', 2, npcAt('healer'));
  if (q.supplies === 1) return go('supplies', 1, [28 * T, 48 * T]);
  if (q.tracks === 1) return go('tracks', 1, TRACKS[0]);
  if (q.tracks === 2) return go('tracks', 2, [LUNA_AT[0] * T, LUNA_AT[1] * T]);
  if (q.fishing === 1) return go('fishing', 1, npcAt('fisher'));
  if (q.collector === 1) return { quest: 'collector', name: QUESTS.collector.name, text: `${QUESTS.collector.steps[1]} (${ex.dex.caught.length}/6)`, at: ex.dex.caught.length >= 6 ? npcAt('elder') : null };
  // Nothing active: point at whoever has the next part of the story.
  if (!ex.flags.includes('bridge') && !q.bridge) return { quest: null, name: 'What next?', text: 'Captain Ash at the north edge of the village needs help.', at: npcAt('ranger') };
  if (ex.flags.includes('bridge') && !q.marsh && !ex.flags.includes('mirebrute')) return { quest: null, name: 'What next?', text: 'Visit Old Reed on the Mirror Lake dock.', at: npcAt('fisher') };
  if (ex.flags.includes('mirebrute') && !q.cave) return { quest: null, name: 'What next?', text: 'Report to Captain Ash.', at: npcAt('ranger') };
  if (ex.flags.includes('quartzhulk') && !q.defend) return { quest: null, name: 'What next?', text: 'Tell Elder Maru what you found in the cave.', at: npcAt('elder') };
  if (ex.flags.includes('raid') && !q.peak) return { quest: null, name: 'What next?', text: 'Elder Maru is waiting for you.', at: npcAt('elder') };
  return { quest: null, name: 'Explore', text: 'Befriend every kind of creature and find every treasure.', at: null };
}
