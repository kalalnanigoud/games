// Creature Island: Arena Rush. A five-minute survival run in Glowdeep Cave's stone chamber, alone or with
// friends: waves of murklings and wild creatures rush in, you fight with your companion, and the team
// scores for every foe and every cleared wave. Nothing is saved: explorers are made fresh for the run and
// leaving just ends it. The host's World (island-sim.js) calls into an Arena through a few hooks
// (step, second, respawn, command, unsaved, view); everything about the mode lives here.
import { TILE, STARTERS, playerMax, creatureMax } from './island-data.js';
import { newExplorer } from './island-sim.js';
import { fits } from './island-map.js';
import { esc } from '../js/util.js';

const T = TILE;
export const ARENA = {
  at: [145, 12.5], r: 8.8, // tiles: the Quartzhulk's chamber; the rock ring is a wall, and this circle seals its one way out
  dur: 300, intro: 5, level: 5,
};
const POOL = [['nettlebug', 1], ['clackle', 2], ['gullwisp', 3], ['gemmole', 4], ['fizzwing', 5], ['ripplefin', 6], ['cindermite', 7]];
// Each kit has its own edge, so none is simply better. Starter squad: mixed companions a level up that hit
// harder (Leaf Charm), extra berries, and more health back between waves (mend). Swift striker moves and
// dodges faster. Bubble guardian has more HP.
export const ARENA_KITS = {
  classic: { name: 'Starter squad', charm: 'leafcharm', berries: 2, compLv: 1, mend: 0.45 },
  swift: { name: 'Swift striker', sp: 'emberkit', charm: 'feather' },
  guardian: { name: 'Bubble guardian', sp: 'dewpaw', charm: 'tidecharm' },
};
// Every other murkling takes on the wave's element (the rest stay Shade), so no companion wins every wave.
const THEMES = [
  { name: 'Forest swarm', species: ['nettlebug'], el: 'stone' },
  { name: 'Tide rush', species: ['clackle', 'gullwisp', 'ripplefin'], el: 'tide' },
  { name: 'Crystal storm', species: ['gemmole', 'fizzwing', 'cindermite'], el: 'stone' },
];
const BLOCKED = new Set(['new', 'load', 'save', 'saved', 'buy', 'sell', 'craft', 'ranch', 'release', 'respawn']);
const spotFor = (seat) => { const a = (seat / 4) * Math.PI * 2 + 0.6; return { x: ARENA.at[0] * T + Math.cos(a) * 52, y: ARENA.at[1] * T + Math.sin(a) * 52 }; };

export function arenaExplorer(name, seat, kitId = 'classic') {
  const kit = Object.hasOwn(ARENA_KITS, kitId) ? ARENA_KITS[kitId] : ARENA_KITS.classic;
  const ex = newExplorer(name, { skin: seat, hair: seat + 1 });
  if (kit.charm) { ex.gear.push(kit.charm); ex.equip.charm = kit.charm; }
  ex.lv = ARENA.level; ex.hp = playerMax(ex.lv, kit.charm); ex.shells = 0; ex.inv = { sunberry: 3 + (kit.berries || 0) };
  const sp = kit.sp || STARTERS[seat % STARTERS.length], lv = ex.lv + (kit.compLv || 0);
  ex.team = [{ uid: 'arena' + seat + Math.random().toString(36).slice(2, 7), sp, lv, xp: 0, hp: creatureMax(sp, lv) }];
  ex.quests = { starter: 9 };
  ex.loc = spotFor(seat);
  return ex;
}

export class Arena {
  constructor(world, o = {}) {
    this.w = world;
    this.dur = o.dur || ARENA.dur;
    this.gap = o.gap || 20;
    this.kit = Object.hasOwn(ARENA_KITS, o.kit) ? o.kit : 'classic';
    world.arena = this;
    world.open.arena = [ARENA.at[0], ARENA.at[1], ARENA.r]; // a circular wall: see solidTile in island-map.js
    world.worldVer++;
    this.reset();
  }
  reset() {
    this.state = 'wait'; // wait for the first explorer, run, over
    this.t0 = 0; this.shift = 0;
    this.score = 0; this.kills = 0; this.wave = 0; this.nextWave = ARENA.intro; this.cleared = true;
    this.foes = new Set();
    this.winds = 1; // a solo explorer's one second wind per run
    this.result = null;
    this.theme = '';
  }
  get elapsed() { return this.state === 'wait' ? 0 : this.w.t - this.t0 + this.shift; }
  // For tests and the browser check: move the clock on without playing the minutes.
  skip(sec) { this.shift += sec; }

  // ---- explorers ----
  join(p) {
    const w = this.w;
    p.ex = arenaExplorer(p.name, p.seat, this.kit);
    p.tag = ''; p.prog = 0; p.savedProg = 0; p.lastSave = 0;
    w.spawn(p);
    w.personal(p, ['banner', 'Arena Rush', `${ARENA_KITS[this.kit].name} · Survive ${Math.round(this.dur / 60)} minutes`]);
    if (this.state === 'wait') { this.state = 'run'; this.t0 = w.t; }
  }
  respawn(p) {
    const w = this.w;
    const wind = p.wind;
    p.downT = 0; p.body.down = 0; p.hp = wind ? Math.round(w.maxHp(p) * 0.6) : w.maxHp(p); p.iT = wind ? 3 : 2; p.wind = false; w.chan(p, null);
    if (!wind) { const s = spotFor(p.seat); w.warp(p, s.x, s.y); }
    w.personal(p, ['toast', wind ? 'Second wind! Back on your feet.' : 'Back on your feet!']);
    w.bump(p);
  }
  // Hook: commands a screen may send. Saving, shops and the ranch don't exist here.
  command(p, d) {
    if (d.c === 'again') { this.again(); return true; }
    if (BLOCKED.has(d.c)) throw new Error(d.c === 'respawn' ? 'A friend can revive you, or wait a moment.' : 'Not in Arena Rush.');
    return false;
  }
  again() {
    if (this.state !== 'over') return;
    const w = this.w;
    this.clearFoes();
    const was = [...w.players.values()].filter((p) => p.ready);
    this.reset();
    for (const p of was) { w.park(p); this.join(p); }
  }
  clearFoes() {
    for (const id of this.foes) this.w.ents.delete(id);
    for (const e of [...this.w.ents.values()]) if (e.arena) this.w.ents.delete(e.id);
    this.foes.clear();
  }

  // ---- the run ----
  step() {
    const w = this.w;
    if (w.tick % 5 === 0) for (const p of w.players.values()) if (!p.ready && p.connected) this.join(p);
    for (const id of [...this.foes]) {
      const e = w.ents.get(id);
      if (!e) this.foes.delete(id);
      else if (e.hp <= 0) { this.foes.delete(id); this.kills++; this.score += this.points(e); }
    }
  }
  points(e) { return (e.big ? 120 : 10) + e.lv * (e.big ? 6 : 3); }
  second() {
    const w = this.w;
    if (this.state !== 'run') return;
    const ready = w.readyPlayers().filter((p) => p.connected);
    const el = this.elapsed;
    if (el >= this.dur) return this.end('time');
    if (ready.length && ready.every((p) => p.downT > 0)) {
      // Alone, the first knockout of a run isn't the end: a second wind gets you up a few seconds later.
      if (ready.length === 1 && this.winds > 0 && !ready[0].wind) {
        const p = ready[0];
        this.winds--; p.wind = true; p.downT = Math.min(p.downT, 4);
        w.personal(p, ['toast', 'Second wind! You’ll be back up in a moment (once per run).']);
      } else if (!ready.some((p) => p.wind)) return this.end('down');
    }
    if (!this.foes.size && this.wave && !this.cleared) { this.cleared = true; this.score += 20 + 5 * this.wave; this.nextWave = Math.min(this.nextWave, el + 3); }
    if (el >= this.nextWave) this.spawnWave(ready);
    w.worldVer++;
  }
  spawnWave(ready) {
    const w = this.w, n = Math.max(1, ready.length);
    this.wave++; this.cleared = false;
    this.nextWave = this.elapsed + Math.max(13, this.gap - Math.floor(this.wave / 2));
    const lv = Math.min(15, Math.round(2 + this.wave * 0.9 + (n - 1) * 0.6));
    const unlocked = POOL.filter(([, from]) => from <= this.wave).map(([sp]) => sp);
    const theme = THEMES[(this.wave - 1) % THEMES.length];
    const themed = unlocked.filter(sp => theme.species.includes(sp));
    const pool = themed.length ? themed : unlocked;
    this.theme = this.wave % 5 === 0 ? 'Brute assault' : themed.length ? theme.name : 'Mixed skirmish';
    // Each extra explorer adds most of a solo wave again.
    const count = Math.max(0, Math.min(Math.round((3 + this.wave * 0.9) * (1 + 0.6 * (n - 1))), 12 + 6 * n - this.foes.size));
    const kinds = [];
    for (let i = 0; i < count; i++) kinds.push(pool.length && i % 3 === 2 ? pool[(i + this.wave) % pool.length] : 'murk');
    if (this.wave % 5 === 0) for (let i = 0; i < Math.ceil(n / 2); i++) kinds.push('murkbrute');
    let murks = 0;
    for (const sp of kinds) {
      const at = this.ringPoint(ready);
      if (!at) continue;
      const el = sp === 'murk' && murks++ % 2 ? theme.el : null;
      const e = w.creature(sp, sp === 'murkbrute' ? lv + 1 : lv, at.x, at.y, { raid: true, angry: true, arena: true, ...(el ? { el } : {}) });
      const foe = w.nearestFoe(e, 1200);
      if (foe) { e.target = foe; e.state = 'chase'; }
      this.foes.add(e.id);
      w.event(e, ['spawn', Math.round(e.x), Math.round(e.y), 3]);
    }
    for (const p of ready) {
      // Each wave a breath of rest: a bit of health back, and a fainted companion rallies.
      p.hp = Math.min(w.maxHp(p), p.hp + w.maxHp(p) * (ARENA_KITS[this.kit].mend || 0.25));
      const m = p.ex.team.find((x) => x.hp <= 0);
      if (m && !p.comp) { m.hp = Math.round(creatureMax(m.sp, m.lv) / 2); w.summon(p); }
      w.personal(p, ['banner', `Wave ${this.wave} · ${this.theme}`, `${kinds.length} coming`]);
      w.bump(p);
    }
  }
  ringPoint(ready) {
    const w = this.w;
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2, d = (5.6 + Math.random() * 2.4) * T;
      const x = ARENA.at[0] * T + Math.cos(a) * d, y = ARENA.at[1] * T + Math.sin(a) * d;
      if (fits(x, y, 14, w.open) && ready.every((p) => Math.hypot(p.body.x - x, p.body.y - y) > 150)) return { x, y };
    }
    return null;
  }
  end(reason) {
    const w = this.w;
    this.state = 'over';
    if (reason === 'time') this.score += 150;
    this.result = { reason, score: this.score, kills: this.kills, wave: this.wave, time: Math.round(Math.min(this.dur, this.elapsed)) };
    this.clearFoes();
    for (const p of w.readyPlayers()) { if (p.downT > 0) this.respawn(p); p.hp = w.maxHp(p); w.bump(p); }
    w.worldVer++;
  }
  // Hook: what each screen shows (rides along with the world view).
  view() {
    return { s: this.state, el: Math.round(this.elapsed * 10) / 10, dur: this.dur, score: this.score, kills: this.kills, wave: this.wave, theme: this.theme, kit: ARENA_KITS[this.kit].name, left: this.foes.size, res: this.result };
  }
}

export function attachArena(world, o) { return new Arena(world, o); }

/* ---------------- the player's screen ---------------- */
const clock = (sec) => { sec = Math.max(0, Math.ceil(sec)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };
// Hooked in by the client with opts.arena: shows the timer and score where the quest card sits, and the
// end card. The card's buttons are wired here, so the client needs nothing more.
export const arenaUi = {
  mount(root, st, cmd) {
    root.classList.add('arena');
    const hud = document.createElement('div');
    hud.className = 'isl-arena';
    hud.hidden = true;
    hud.innerHTML = '<b></b><span></span>';
    const end = document.createElement('div');
    end.className = 'isl-arena-end';
    end.hidden = true;
    root.append(hud, end);
    end.addEventListener('click', (e) => { if (e.target.closest('[data-arena="again"]')) cmd('again'); });
    let seen = null, at = 0, html = '';
    const tick = () => {
      if (!root.isConnected) return clearInterval(timer);
      const a = st.w?.arena;
      if (a !== seen) { seen = a; at = performance.now(); }
      hud.hidden = !a || !st.ready;
      if (!a) return;
      const left = a.s === 'run' ? a.dur - a.el - (performance.now() - at) / 1000 : a.s === 'over' ? 0 : a.dur;
      const b = hud.firstChild, s = hud.lastChild;
      const t1 = `${clock(left)}`, t2 = a.wave ? `Wave ${a.wave} · ${a.score.toLocaleString()} pts` : `${a.kit || 'Get ready'} · ${a.score} pts`;
      if (b.textContent !== t1) b.textContent = t1;
      if (s.textContent !== t2) s.textContent = t2;
      const r = a.s === 'over' && a.res;
      const h = r ? endHtml(r, st) : '';
      if (h !== html) { html = h; end.innerHTML = h; end.hidden = !h; }
    };
    const timer = setInterval(tick, 250);
    tick();
  },
};
function endHtml(r, st) {
  const names = (st.w.roster || []).filter((x) => x.ready).map((x) => esc(x.name)).join(', ');
  return `<div class="isl-card isl-end"><h2>${r.reason === 'time' ? 'You held the arena!' : 'The arena overran you'}</h2>
    <p class="isl-arena-score">${r.score.toLocaleString()} <small>points</small></p>
    ${st.w.arena?.kit ? `<p class="small muted">${esc(st.w.arena.kit)}</p>` : ''}
    <ul class="isl-list isl-arena-stats"><li><span><b>${r.kills}</b><small>foes beaten</small></span></li><li><span><b>${r.wave}</b><small>waves</small></span></li><li><span><b>${clock(r.time)}</b><small>survived</small></span></li></ul>
    ${names ? `<p class="small muted">${names}</p>` : ''}
    <p class="small muted">Nothing is saved from an Arena Rush run. Leave from the game bar, or go again.</p>
    <div class="isl-row"><button class="primary" data-arena="again">Play again</button></div></div>`;
}

export const ARENA_CSS = `
.isl-root.arena .isl-quest, .isl-root.arena .isl-down button { display: none; }
.isl-root.arena .isl-overlay:has(.isl-pick) { display: none; }
.isl-root.arena button[data-tab="save"], .isl-root.arena button[data-tab="quests"] { display: none; }
.isl-arena { position: absolute; right: 64px; top: 10px; min-width: 120px; max-width: min(300px, 44vw); padding: 8px 12px; border-radius: 14px; background: rgba(13,20,44,.78); border: 1px solid rgba(255,212,59,.28); pointer-events: none; text-align: right; z-index: 2; }
.isl-arena b { display: block; font-family: var(--font-display); font-weight: 600; font-size: 1.35rem; line-height: 1.1; color: #ffe066; font-variant-numeric: tabular-nums; }
.isl-arena span { display: block; font-size: .78rem; line-height: 1.3; color: #e9ecf5; }
.isl-arena-end { position: absolute; inset: 0; display: grid; place-items: start center; padding: 16px; background: rgba(8,12,30,.55); z-index: 9; overflow-y: auto; }
.isl-arena-end > * { margin-block: auto; } /* centred, but a tall card starts at the top (Safari) */
.isl-arena-end[hidden] { display: none; }
.isl-arena-score { margin: 4px 0 8px; font-family: var(--font-display); font-size: 2.4rem; color: #fff; line-height: 1.1; }
.isl-arena-score small { font-size: .9rem; color: #c5cbe0; font-family: var(--font-body); font-weight: 800; }
.isl-arena-stats { grid-template-columns: repeat(3, 1fr); margin: 0 0 8px; }
.isl-arena-stats li { justify-content: center; text-align: center; }
.isl-arena-stats b { font-size: 1.2rem; }
@media (max-width: 720px) { .isl-arena { right: 60px; top: 8px; max-width: calc(56vw - 76px); padding: 6px 9px; } .isl-arena b { font-size: 1.15rem; } .isl-arena span { font-size: .72rem; } }
`;
