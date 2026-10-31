// Shared engine for the cooperative escape rooms (The Missing Keeper, Signal from Below).
//
// A game describes rooms, objects, items, puzzles and hints as data. This file runs the rules,
// builds each player's view (private clues stay private), plays computer teammates, and draws
// the point-and-click interface. Everyone explores at the same time: there are no turns.
//
// Object fields:
//   id, room, name, hot: [x, y, w, h] hotspot in the 400x250 room picture
//   when(s)         optional: only present once this returns true (reads flags/inv only)
//   look(v, pid)    -> { text: trusted HTML, art?: '<svg…>' } close-up, built from the view
//   clue(v)         optional: short journal line; examining the object adds it to the team journal
//   take            { item, label?, when?(s), msg(p) }        pick up an item
//   use             [{ item, flag, when?(s), notYet?, keep?, msg(p), effect?(s, p) }]
//   lock            { slots: [[optionHTML…]], labels?, flag, when?(s), notYet?, check(secret, value),
//                     format?(value), msg(p, value), effect?(s, p), solve?(v, pid) -> value | null }
//   go              room id: the close-up offers a way through once that room is open
// Room fields: id, name, blurb, art(v) -> SVG for the 400x250 picture, open?, and layers?(v) -> moving
// parts drawn above the picture as their own small SVGs ([{ id, box: [x, y, w, h], cls, svg }]), so a
// spinning wheel is turned by the compositor instead of repainting the whole room every frame.
import { esc, log, addFx, uid } from '../js/util.js';
import { injectCSS, morph } from '../js/fx.js';
import { teammateOption, levelOf } from '../js/levels.js';
import { sound } from '../js/sound.js';
import { icon } from '../js/icons.js';
import { portrait } from '../js/avatar.js';

const browser = typeof document !== 'undefined';
const own = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
export const PAWNS = [['#f0b54a', '●'], ['#62b8ea', '▲'], ['#e56f9f', '■'], ['#86d17e', '◆']];

export function give(s, item) { if (!s.inv.includes(item)) s.inv.push(item); }
export function openRoom(s, room) { if (!s.open.includes(room)) s.open.push(room); }
export function escape(s, text) {
  s.over = true; s.won = true; s.phase = 'over';
  s.winners = s.players.map((p) => p.id);
  s.endedAt = Date.now();
  log(s, text);
}
const clock = (ms) => { const t = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };

// Computer teammates explore, pick things up and share what they know straight away, but
// leave puzzles to the humans until the team has made no progress for a while.
// Levels (the lobby's "Computer teammates"): Steady plays as described. Learning wanders off, fiddles
// with locks it can't read yet, shares its clues late and is slow to use what the team has found.
// Expert reads the clues before anything else, skips what doesn't matter, finishes a room before
// leaving it, spreads out from its teammates and takes over puzzles sooner.
const botPatience = () => globalThis.escapeBotPatience ?? (browser ? 45000 : 0);
const botIdle = () => globalThis.escapeBotIdle ?? 0.8; // chance a bot just thinks this tick
const pick = (list) => list[Math.floor(Math.random() * list.length)];

export function escapeRoom(spec) {
  const objects = Object.fromEntries(spec.objects.map((o) => [o.id, o]));
  const rooms = Object.fromEntries(spec.rooms.map((r) => [r.id, r]));
  const frags = Object.fromEntries((spec.fragments || []).map((f) => [f.id, f]));
  const present = (s, o) => s.open.includes(o.room) && (!o.when || o.when(s));
  const lockReady = (s, L) => !s.flags[L.flag] && (!L.when || L.when(s));
  const objective = (s) => spec.objectives.find((ob) => !ob.done(s));
  const progress = (s) => { s.progressAt = Date.now(); s.wrong = 0; };

  const game = {
    id: spec.id, name: spec.name, description: spec.description, cover: spec.cover, howTo: spec.howTo,
    minPlayers: 1, maxPlayers: 4, simultaneous: true,
    options: [...(spec.options || []), teammateOption()],

    setup(players, opts) {
      if (!players.length || players.length > 4 || new Set(players.map((p) => p.id)).size !== players.length) throw Error('Escape rooms need 1–4 players.');
      const start = spec.rooms[0].id;
      const s = {
        gid: uid(), phase: 'play', over: false, won: false, winners: [], level: levelOf(opts),
        players: players.map((p, i) => ({ id: p.id, name: p.name, seat: i, room: start })),
        open: [start, ...spec.rooms.filter((r) => r.open).map((r) => r.id)].filter((r, i, a) => a.indexOf(r) === i),
        flags: {}, inv: [], seen: [], shared: [], owner: {}, hintTier: {}, hints: [], hintsUsed: 0,
        attempts: 0, wrong: 0, started: Date.now(), progressAt: Date.now(), endedAt: 0, log: [], secret: {},
      };
      // Private archive fragments are dealt round the table, so a lone player holds them all.
      (spec.fragments || []).forEach((f, i) => { s.owner[f.id] = s.players[i % s.players.length].id; });
      spec.setup(s);
      log(s, spec.opening);
      return s;
    },

    turnOf: (s) => (s.over ? [] : s.players.map((p) => p.id)),

    act(s, pid, a) {
      if (s.over) throw Error('This adventure is over. Start a new game to play again.');
      const p = s.players.find((q) => q.id === pid);
      if (!p) throw Error('You are not part of this team.');
      if (!a || typeof a !== 'object') throw Error('Choose something to do.');
      if (a.type === 'think') return;
      if (a.type === 'go') {
        if (!own(rooms, a.room)) throw Error('There is no such place.');
        if (!s.open.includes(a.room)) throw Error(`The way to the ${rooms[a.room].name} is still locked.`);
        p.room = a.room;
        return;
      }
      if (a.type === 'share') {
        if (!own(frags, a.frag) || s.owner[a.frag] !== pid) throw Error('That clue is not on your wrist terminal.');
        if (s.shared.includes(a.frag)) throw Error('Your team can already read that.');
        s.shared.push(a.frag);
        log(s, `${p.name} shared “${frags[a.frag].title}” with the team.`);
        addFx(s, { kind: 'sound', sound: 'card' });
        return;
      }
      if (a.type === 'hint') {
        const ob = objective(s);
        const tier = ob ? s.hintTier[ob.id] || 0 : 0;
        if (!ob || tier >= ob.hints.length) throw Error('There are no more hints for this step.');
        s.hints.push({ ob: ob.id, text: ob.hints[tier](s) });
        s.hintTier[ob.id] = tier + 1;
        s.hintsUsed++;
        log(s, `${p.name} asked for a hint (${tier + 1} of ${ob.hints.length}).`);
        addFx(s, { kind: 'sound', sound: 'chime' });
        return;
      }
      if (!['look', 'take', 'use', 'code'].includes(a.type)) throw Error('That is not something you can do here.');
      const o = own(objects, a.obj) ? objects[a.obj] : null;
      if (!o || !present(s, o)) throw Error('There is nothing like that here.');
      if (o.room !== p.room) throw Error(`Go to the ${rooms[o.room].name} first.`);
      const anchor = 'esc-obj-' + o.id;

      if (a.type === 'look') {
        if (s.seen.includes(o.id)) return;
        s.seen.push(o.id);
        if (o.clue) log(s, `${p.name} examined the ${o.name}. Added to the journal.`);
        return;
      }
      if (a.type === 'take') {
        const t = o.take;
        if (!t || s.flags['took:' + o.id] || (t.when && !t.when(s))) throw Error('There is nothing to take.');
        s.flags['took:' + o.id] = true;
        give(s, t.item);
        progress(s);
        log(s, t.msg(p));
        addFx(s, { from: anchor, to: 'esc-inv', html: itemTile(t.item), size: [54, 54], sound: 'gem' });
        return;
      }
      if (a.type === 'use') {
        if (!own(spec.items, a.item) || !s.inv.includes(a.item)) throw Error('Your team is not carrying that.');
        const u = (o.use || []).find((x) => x.item === a.item && !s.flags[x.flag]);
        if (!u) throw Error(`The ${spec.items[a.item].name.toLowerCase()} doesn't help with the ${o.name.toLowerCase()}.`);
        if (u.when && !u.when(s)) throw Error(u.notYet || 'Not yet.');
        s.flags[u.flag] = true;
        if (!u.keep) s.inv = s.inv.filter((x) => x !== a.item);
        progress(s);
        log(s, u.msg(p));
        addFx(s, { from: 'esc-inv', to: anchor, html: itemTile(a.item), size: [54, 54], sound: 'build' });
        u.effect?.(s, p);
        return;
      }
      // code
      const L = o.lock;
      if (!L) throw Error('There is nothing to unlock there.');
      if (s.flags[L.flag]) throw Error('That is already open.');
      if (L.when && !L.when(s)) throw Error(L.notYet || 'Nothing happens yet.');
      const v = a.value;
      if (!Array.isArray(v) || v.length !== L.slots.length || v.some((x, i) => !Number.isInteger(x) || x < 0 || x >= L.slots[i].length)) throw Error('Set every dial first.');
      const shown = L.format ? L.format(v) : v.join(' ');
      if (!L.check(s.secret, v)) {
        s.attempts++; s.wrong++;
        log(s, `${p.name} tried ${shown} on the ${o.name.toLowerCase()}. Nothing happened.`);
        addFx(s, { kind: 'shake', at: 'esc-lock-' + o.id, sound: 'bad' });
        return;
      }
      s.flags[L.flag] = true;
      progress(s);
      log(s, L.msg(p, shown));
      addFx(s, { kind: 'pulse', at: anchor, sound: 'chime' });
      L.effect?.(s, p);
    },

    view(s, pid) {
      const v = JSON.parse(JSON.stringify(s));
      delete v.secret;
      v.facts = spec.facts(s);
      v.frags = (spec.fragments || []).map((f) => {
        const mine = s.owner[f.id] === pid, open = s.shared.includes(f.id);
        const base = { id: f.id, title: f.title, owner: s.owner[f.id], shared: open };
        return mine || open ? { ...base, text: f.text(s.secret), data: f.data(s.secret) } : base;
      });
      delete v.owner;
      return v;
    },

    bot(v, pid) {
      if (v.level === 'hard') return expert(v, pid);
      if (v.level === 'easy') return learner(v, pid);
      const p = v.players.find((q) => q.id === pid);
      if (!p || v.over || Math.random() < botIdle()) return { type: 'think' };
      const mine = v.frags.find((f) => f.owner === pid && !f.shared);
      if (mine) return { type: 'share', frag: mine.id };
      const patient = Date.now() - v.progressAt < botPatience();
      const tasks = [];
      for (const o of spec.objects) {
        if (!present(v, o)) continue;
        if (!patient) {
          if (o.lock && lockReady(v, o.lock)) {
            const value = o.lock.solve?.(v, pid);
            if (value) tasks.push([3, o.room, { type: 'code', obj: o.id, value }]);
          }
          for (const u of o.use || []) if (!v.flags[u.flag] && v.inv.includes(u.item) && (!u.when || u.when(v))) tasks.push([3, o.room, { type: 'use', obj: o.id, item: u.item }]);
        }
        if (o.take && !v.flags['took:' + o.id] && (!o.take.when || o.take.when(v))) tasks.push([2, o.room, { type: 'take', obj: o.id }]);
        if (!v.seen.includes(o.id)) tasks.push([1, o.room, { type: 'look', obj: o.id }]);
      }
      if (!tasks.length) return { type: 'think' };
      const best = Math.max(...tasks.map((t) => t[0]));
      const top = tasks.filter((t) => t[0] === best);
      const here = top.filter((t) => t[1] === p.room);
      const [, room, action] = (here.length ? here : top)[Math.floor(Math.random() * (here.length || top.length))];
      return room === p.room ? action : { type: 'go', room };
    },

    render(el, v, ctx) { draw(el, v, ctx); },
  };

  /* ---------------- computer teammate levels ---------------- */
  // Both only read the bot's own view: public facts, the journal, the team's items and the fragments it
  // holds or that were shared. A lock's solve() returns null until those clues are in that view.
  const usable = (v, u) => !v.flags[u.flag] && v.inv.includes(u.item) && (!u.when || u.when(v));
  const canTake = (v, o) => o.take && !v.flags['took:' + o.id] && (!o.take.when || o.take.when(v));
  const think = { type: 'think' };

  // Expert: clues first (they unlock the puzzles), then items; ignores the scenery; solves and uses
  // things as soon as it can; does everything in a room before walking on, and heads for rooms
  // nobody else on the team is in.
  function expert(v, pid) {
    const p = v.players.find((q) => q.id === pid);
    if (!p || v.over || Math.random() < botIdle()) return think;
    const mine = v.frags.find((f) => f.owner === pid && !f.shared);
    if (mine) return { type: 'share', frag: mine.id };
    const patient = Date.now() - v.progressAt < botPatience() / 3;
    const tasks = [], idle = [];
    for (const o of spec.objects) {
      if (!present(v, o)) continue;
      if (!patient) {
        if (o.lock && lockReady(v, o.lock)) {
          const value = o.lock.solve?.(v, pid);
          if (value) tasks.push([4, o.room, { type: 'code', obj: o.id, value }]);
        }
        for (const u of o.use || []) if (usable(v, u)) tasks.push([4, o.room, { type: 'use', obj: o.id, item: u.item }]);
      }
      const unseen = !v.seen.includes(o.id);
      if (unseen && o.clue) tasks.push([3, o.room, { type: 'look', obj: o.id }]);
      if (canTake(v, o)) tasks.push([2, o.room, { type: 'take', obj: o.id }]);
      if (unseen && !o.clue && o.room === p.room) idle.push({ type: 'look', obj: o.id });
    }
    const others = (room) => v.players.filter((q) => q.id !== pid && q.room === room).length;
    // Progress waiting in a room no teammate is in comes first; otherwise finish this room.
    const urgent = tasks.filter((t) => t[0] === 4 && (t[1] === p.room || !others(t[1])));
    const here = (urgent.length ? urgent : tasks).filter((t) => t[1] === p.room);
    if (here.length) {
      const best = Math.max(...here.map((t) => t[0]));
      return pick(here.filter((t) => t[0] === best))[2];
    }
    const away = urgent.length ? urgent : tasks;
    if (away.length) {
      const score = {};
      for (const [pr, room] of away) { const sc = (score[room] ||= { best: 0, n: 0 }); sc.best = Math.max(sc.best, pr); sc.n++; }
      const rank = (r) => [score[r].best, -others(r), score[r].n];
      const better = (a, b) => { const x = rank(a), y = rank(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
      const rooms = Object.keys(score);
      const top = rooms.filter((r) => !rooms.some((q) => better(q, r)));
      return { type: 'go', room: pick(top) };
    }
    // Nothing useful left for now: look around while waiting for the team.
    return idle.length ? pick(idle) : think;
  }

  // Learning: wanders between rooms, shares its fragments late, tries combinations it can't know yet,
  // and often forgets to use a clue or item the team already has.
  function learner(v, pid) {
    const p = v.players.find((q) => q.id === pid);
    if (!p || v.over || Math.random() < botIdle()) return think;
    const mine = v.frags.find((f) => f.owner === pid && !f.shared);
    if (mine && Math.random() < 0.4) return { type: 'share', frag: mine.id };
    const elsewhere = v.open.filter((r) => r !== p.room && own(rooms, r));
    if (elsewhere.length && Math.random() < 0.25) return { type: 'go', room: pick(elsewhere) };
    const patient = Date.now() - v.progressAt < botPatience() * 2;
    if (!patient && Math.random() < 0.3) {
      const locks = spec.objects.filter((o) => o.lock && o.room === p.room && present(v, o) && lockReady(v, o.lock));
      if (locks.length) {
        const o = pick(locks);
        return { type: 'code', obj: o.id, value: o.lock.slots.map((opts) => Math.floor(Math.random() * opts.length)) };
      }
    }
    const solves = !patient && Math.random() < 0.4, uses = !patient && Math.random() < 0.6;
    const tasks = [];
    for (const o of spec.objects) {
      if (!present(v, o)) continue;
      if (solves && o.lock && lockReady(v, o.lock)) {
        const value = o.lock.solve?.(v, pid);
        if (value) tasks.push([3, o.room, { type: 'code', obj: o.id, value }]);
      }
      if (uses) for (const u of o.use || []) if (usable(v, u)) tasks.push([3, o.room, { type: 'use', obj: o.id, item: u.item }]);
      if (canTake(v, o)) tasks.push([2, o.room, { type: 'take', obj: o.id }]);
      if (!v.seen.includes(o.id)) tasks.push([1, o.room, { type: 'look', obj: o.id }]);
    }
    if (!tasks.length) return think;
    const best = Math.max(...tasks.map((t) => t[0]));
    const top = tasks.filter((t) => t[0] === best);
    const here = top.filter((t) => t[1] === p.room);
    const [, room, action] = pick(here.length ? here : top);
    return room === p.room ? action : { type: 'go', room };
  }

  /* ---------------- interface ---------------- */

  // Local to this device and kept across redraws (an escape room re-renders whenever anyone acts):
  // which close-up is open and how its dials are set, which drawers are open, and when each item,
  // clue, solved lock and goal first appeared here (for short one-off success flashes).
  const UI = { gid: null, open: null, dials: {}, close: null, shown: null, scroll: 0, born: {}, primed: false, journal: wide(), team: wide() };
  if (browser) addEventListener('keydown', (e) => { if (e.key === 'Escape' && UI.close && document.body.contains(document.querySelector(`.esc-${spec.id} .esc-modal`))) UI.close(); });
  const itemTile = (id) => `<div class="esc-flyitem esc-fly-${spec.id}"><svg viewBox="0 0 40 40">${spec.items[id].icon}</svg></div>`;
  // An item icon's soft drop shadow, drawn from offset copies of its own shapes instead of a live CSS
  // drop-shadow() filter. size 1: the 40px inventory tile, 3: the 120px close-up. Built once per item.
  const shades = {};
  const shaded = (id, size) => (shades[id + size] ??= size === 1 ? shadow(spec.items[id].icon, 2, 1.1, 0.6, 3) : shadow(spec.items[id].icon, 2, 2.6 / 3, 0.7, 4));
  const introKey = (v) => 'esc-intro-' + v.gid;
  const introSeen = (v) => { try { return sessionStorage.getItem(introKey(v)) === '1'; } catch { return true; } };
  // When a lock on this object was opened, or an item used on it, in ms ago (Infinity if long ago or never).
  const solvedAge = (v, o, age) => Math.min(o.lock && v.flags[o.lock.flag] ? age('f:' + o.lock.flag) : Infinity,
    ...(o.use || []).filter((u) => v.flags[u.flag]).map((u) => age('f:' + u.flag)));

  function draw(el, v, ctx) {
    injectCSS('escape-kit', STYLE);
    if (spec.css) injectCSS(spec.id, spec.css);
    // A drawer the player has just folded may not have reported it yet: the drawer itself knows best.
    const drawers = [el.querySelector('.esc-journal'), el.querySelector('.esc-team')];
    if (drawers[0]) UI.journal = drawers[0].open;
    if (drawers[1]) UI.team = drawers[1].open;
    if (UI.gid !== v.gid) { UI.gid = v.gid; UI.open = !v.over && !introSeen(v) ? 'story:intro' : null; UI.dials = {}; UI.ended = v.over; UI.born = {}; UI.primed = false; UI.shown = null; }
    if (v.over && !UI.ended) { UI.ended = true; UI.open = null; scrollTo?.({ top: 0, behavior: 'smooth' }); } // show the ending
    const redraw = () => draw(el, v, ctx);
    const me = v.players.find((p) => p.id === ctx.me) || v.players[0];
    const room = rooms[me.room];
    const ob = objective(v);
    const stuck = !v.over && (v.wrong >= 3 || Date.now() - v.progressAt > 180000);
    const here = spec.objects.filter((o) => o.room === room.id && present(v, o));
    const myFrags = v.frags.filter((f) => f.owner === me.id);
    const theirs = v.frags.filter((f) => f.owner !== me.id && !f.shared);
    const journal = v.seen.map((id) => objects[id]).filter((o) => o?.clue);
    const sharedFrags = v.frags.filter((f) => f.shared);
    const hints = ob ? v.hints.filter((h) => h.ob === ob.id) : [];

    // Things that are new since this device last drew get a short flash; whatever was already
    // there when we arrived does not. Times survive redraws, so a flash continues where it was.
    const now = Date.now();
    const age = (key) => { if (!own(UI.born, key)) UI.born[key] = UI.primed ? now : 0; return UI.born[key] ? now - UI.born[key] : Infinity; };
    const flash = (key, ms = FLASH) => { const a = age(key); return a < ms ? a : null; };
    Object.keys(v.flags).forEach((f) => v.flags[f] && age('f:' + f));
    v.inv.forEach((id) => age('i:' + id));
    v.hints.forEach((h, i) => age('h:' + i));
    const entries = [...journal.map((o) => ['obj:' + o.id, o.name]), ...sharedFrags.map((f) => ['frag:' + f.id, f.title])];
    entries.forEach(([k]) => age('j:' + k));
    const latest = entries.reduce((best, e) => (!best || UI.born['j:' + e[0]] >= UI.born['j:' + best[0]] ? e : best), null);
    const goalFlash = flash('g:' + (v.over ? 'over' : ob?.id));
    UI.primed = true;

    const still = !!UI.open && UI.shown === UI.open; // the same close-up as last time: don't pop it in again
    const face = (p, cls = '', attrs = '', mark = false) => {
      if (!p) return '';
      const [c, m] = PAWNS[p.seat % 4];
      return `<span class="esc-face ${cls}" style="--pc:${c}" ${attrs}>${portrait({ id: p.id, bot: !!ctx.isBot?.(p.id) })}${mark ? `<i class="esc-mark" aria-hidden="true">${m}</i>` : ''}</span>`;
    };
    // Ids let a redraw find each hotspot (and its glints) again, so its glow keeps breathing undisturbed.
    const hotspot = (o) => {
      const [x, y, w, h] = o.hot, fresh = !v.seen.includes(o.id), picked = UI.open === 'obj:' + o.id;
      return `<g class="esc-hot ${fresh ? 'esc-fresh' : ''} ${picked ? 'esc-picked' : ''}" id="esc-hot-${o.id}" data-obj="${o.id}" data-a="esc-obj-${o.id}" role="button" tabindex="0" aria-label="${esc(o.name)}"><rect class="esc-hit" x="${x}" y="${y}" width="${w}" height="${h}" rx="9"/>${
        fresh || picked ? `<path class="esc-rim" d="${corners(x, y, w, h)}"/>` : ''}</g>`;
    };
    // What moves on a hotspot (the breathing halo and glint of something nobody has examined, the
    // burst and tick of a fresh success) is drawn above the picture as small separate SVGs, so the
    // compositor animates them without repainting the room (see .esc-glints).
    const glints = (o, i) => {
      const [x, y, w, h] = o.hot, fresh = !v.seen.includes(o.id), sa = solvedAge(v, o, age);
      const cx = x + w / 2, cy = y + h / 2, sx = x + w - 9, sy = y + 9;
      return `${fresh ? `${overlay(`esc-aura-${o.id}`, 'esc-aura', [x - 2, y - 2, w + 4, h + 4], `<path d="${corners(x, y, w, h)}"/>`, `animation-delay:${(-i * 0.45).toFixed(2)}s`)}${
        overlay(`esc-spark-${o.id}`, 'esc-spark', [sx - 8, sy - 8, 16, 16], `<path d="${sparkle(sx, sy, 6.5)}"/>`, `animation-delay:${(-i * 0.3).toFixed(2)}s`)}` : ''}${
        sa < FLASH ? `${overlay(`esc-burst-${o.id}`, 'esc-burst', [x - 3, y - 3, w + 6, h + 6], `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12"/>`, `--ago:${sa}ms`, now - sa)}${
          overlay(`esc-tick-${o.id}`, 'esc-tick', [cx - 15, cy - 15, 30, 30], `<circle cx="${cx}" cy="${cy}" r="13"/><path d="M${cx - 6} ${cy + 0.5}l4.2 4.3 7.8-8.6"/>`, `--ago:${sa}ms`, now - sa)}` : ''}`;
    };
    // A flash's element carries data-ago (when it was born): see paint().
    const ago = (a) => (a != null ? ` style="--ago:${a}ms" data-ago="${now - a}"` : '');
    const steps = spec.objectives.map((o) => (o.done(v) ? 'on' : o === ob ? 'now' : ''));
    const stepNo = ob ? spec.objectives.indexOf(ob) + 1 : steps.length;
    const tier = ob ? v.hintTier[ob.id] || 0 : 0;

    paint(el, `<div class="esc-root esc-${spec.id}" style="--accent:${spec.theme.accent};--glow:${spec.theme.glow};--deep:${spec.theme.deep}">
      ${v.over ? ending(v) : ''}
      <div class="esc-bar" id="esc-bar">
        <div class="esc-goal ${v.over ? 'esc-done' : ''} ${goalFlash != null ? 'esc-goalnew' : ''}" id="esc-goal-${v.over ? 'over' : ob?.id}"${ago(goalFlash)}>
          <span class="esc-goal-ic">${v.over ? icon('trophy') : svgIc(IC.goal)}</span>
          <span class="esc-goal-txt"><small>${v.over ? 'Complete' : `Current goal · step ${stepNo} of ${steps.length}`}</small><b>${esc(v.over ? spec.doneLabel : ob?.label || '')}</b></span>
          <span class="esc-steps" aria-hidden="true">${steps.map((c) => `<i class="${c}"></i>`).join('')}</span>
        </div>
        <div class="esc-stat">${icon('timer')}<span><small>Time</small><b class="esc-clock" data-start="${v.started}" data-end="${v.endedAt || ''}">${clock((v.endedAt || Date.now()) - v.started)}</b></span></div>
        <button class="esc-stat esc-hintstat" data-jump aria-label="${v.hintsUsed} hint${v.hintsUsed === 1 ? '' : 's'} used. Show the hints">${icon('bulb')}<span><small>Hints</small><b>${v.hintsUsed}</b></span></button>
        <button class="small esc-storybtn" data-open="story:intro">${icon('book')}Story</button>
      </div>
      <div class="game-layout" id="esc-layout">
        <div class="esc-main felt esc-felt">
          <nav class="esc-tabs" aria-label="Rooms">${spec.rooms.map((r) => {
            const open = v.open.includes(r.id);
            return `<button class="esc-tab ${r.id === room.id ? 'here' : ''} ${open ? '' : 'locked'}" data-go="${r.id}" ${open && !v.over ? '' : 'disabled'} aria-label="${esc(open ? r.name : r.name + ' (locked)')}">
              <span>${esc(r.name)}</span><span class="esc-dots">${open ? '' : svgIc(IC.lock, 'esc-lockic')}${v.players.filter((p) => p.room === r.id).map((p) => face(p, 'esc-pawn esc-mini', `data-k="esc-pawn-${p.id}" title="${esc(p.name)}"`)).join('')}</span></button>`;
          }).join('')}</nav>
          <div class="esc-scene" data-a="esc-scene">
            <svg viewBox="0 0 400 250" role="group" aria-label="${esc(room.name)}">${room.art(v)}
              ${here.map(hotspot).join('')}
            </svg>
            <div class="esc-glints" aria-hidden="true">${(room.layers?.(v) || []).map((l) => overlay('esc-layer-' + l.id, l.cls || '', l.box, l.svg)).join('')}${here.map(glints).join('')}</div>
            <div class="esc-folk" aria-hidden="true">${v.players.filter((p) => p.room === room.id).map((p) => face(p, '', `title="${esc(p.name)}"`)).join('')}</div>
          </div>
          <div class="esc-where">${svgIc(IC.pin)}<span><b>${esc(room.name)}</b> · ${esc(room.blurb)}</span></div>
          <div class="esc-objs">${here.map((o, i) => { const fresh = !v.seen.includes(o.id); return `<button class="small ${fresh ? 'fresh' : ''} ${UI.open === 'obj:' + o.id ? 'esc-picked' : ''}" data-obj="${o.id}" ${fresh ? `style="--i:${i}"` : ''}>${fresh ? icon('sparkle') : ''}${esc(o.name)}</button>`; }).join('')}</div>
          <div class="panel esc-invpanel" data-a="esc-inv"><h3 class="gold">${svgIc(IC.bag)}<span>Shared inventory</span>${v.inv.length ? `<span class="esc-count">${v.inv.length}</span>` : ''}</h3><div class="esc-inv">${v.inv.length ? v.inv.map((id) => { const got = flash('i:' + id); return `<button class="esc-item ${got != null ? 'esc-got' : ''} ${UI.open === 'item:' + id ? 'esc-picked' : ''}" data-k="esc-item-${id}" data-open="item:${id}"${ago(got)}><svg viewBox="0 0 40 40" aria-hidden="true">${shaded(id, 1)}${spec.items[id].icon}</svg><span>${esc(spec.items[id].name)}</span></button>`; }).join('') : '<p class="muted small">Nothing yet. Anything someone picks up appears here for the whole team.</p>'}</div></div>
        </div>
        <div class="side">
          ${spec.fragments ? `<div class="panel esc-frags"><h3 class="gold">${svgIc(IC.wrist)}<span>${esc(spec.fragLabel)}</span></h3>
            ${myFrags.length ? myFrags.map((f) => `<button class="esc-note ${f.shared ? '' : 'mine'}" data-open="frag:${f.id}"><b>${esc(f.title)}</b><span>${f.shared ? 'Shared with the team' : 'Only you can read this. Tap to open.'}</span></button>`).join('') : '<p class="muted small">Your terminal recovered nothing. Ask your teammates what they see.</p>'}
            ${theirs.map((f) => { const p = v.players.find((q) => q.id === f.owner); return `<div class="esc-other">${face(p, 'esc-sm')}<span><b>${esc(p?.name)}</b> holds “${esc(f.title)}”</span></div>`; }).join('')}</div>` : ''}
          <div class="panel esc-hintpanel"><div class="row"><h3 class="gold grow" style="margin:0">${icon('help')}<span>Hints</span>${ob && tier ? `<small class="esc-tier">${tier} of ${ob.hints.length}</small>` : ''}</h3>${ob && !v.over ? `<button class="small ${stuck ? 'pulse-glow' : ''}" data-hint ${tier >= ob.hints.length ? 'disabled' : ''}>${icon('bulb')}Ask for a hint</button>` : ''}</div>
            ${hints.length ? `<ol class="esc-hints">${hints.map((h) => { const k = v.hints.indexOf(h), n = flash('h:' + k); return `<li id="esc-hint-${k}" ${n != null ? `class="esc-newhint"${ago(n)}` : ''}>${h.text}</li>`; }).join('')}</ol>` : `<p class="muted small" style="margin:8px 0 0">${stuck ? 'Feeling stuck? Hints start gentle and get more specific.' : 'Stuck? Hints start gentle and get more specific.'}</p>`}</div>
          <details class="panel drawer esc-journal" ${UI.journal ? 'open' : ''}><summary>${icon('book')}<span>Team journal</span>${entries.length ? `<span class="esc-count">${entries.length}</span>` : ''}<span class="note">${esc(latest ? latest[1] : 'No clues yet')}</span>${icon('chevron', 'chev')}</summary>
            <div class="drawer-body">${journal.length || sharedFrags.length ? `${journal.map((o) => { const n = flash('j:obj:' + o.id); return `<button class="esc-entry ${n != null ? 'esc-got' : ''}" id="esc-j-obj-${o.id}" data-open="obj:${o.id}"${ago(n)}><b>${esc(o.name)}</b> <i>${esc(rooms[o.room].name)}</i><span>${o.clue(v)}</span></button>`; }).join('')}
              ${sharedFrags.map((f) => { const n = flash('j:frag:' + f.id); return `<button class="esc-entry esc-shared ${n != null ? 'esc-got' : ''}" id="esc-j-frag-${f.id}" data-open="frag:${f.id}"${ago(n)}><b>${esc(f.title)}</b> <i>shared by ${esc(v.players.find((p) => p.id === f.owner)?.name)}</i></button>`; }).join('')}` : '<p class="muted small">Clues anyone examines are written here, so the whole team can read them from any room.</p>'}</div></details>
          <details class="panel drawer esc-team" ${UI.team ? 'open' : ''}><summary>${icon('users')}<span>The team</span><span class="note">${esc(v.log[0] || '')}</span>${icon('chevron', 'chev')}</summary>
            <div class="drawer-body"><div class="esc-people">${v.players.map((p) => `<div class="esc-person">${face(p, '', '', true)}<span class="grow"><b>${esc(p.name)}</b>${p.id === ctx.me ? '<span class="tag t-you">You</span>' : ''}${ctx.isBot?.(p.id) ? `<span class="tag t-bot">${icon('bot')}Bot</span>` : ''}<small>${svgIc(IC.pin)}${esc(rooms[p.room].name)}</small></span></div>`).join('')}</div>
              <div class="log esc-log">${v.log.slice(0, 8).map((l) => `<div>${esc(l)}</div>`).join('')}</div></div></details>
        </div>
      </div>
      ${UI.open ? closeup(v, ctx, me, age, still, ago) : ''}
    </div>`);
    UI.shown = UI.open;

    const open = (key) => {
      UI.open = key;
      sound('flip');
      redraw();
      const [kind, id] = key.split(':');
      if (kind === 'obj' && !v.seen.includes(id) && objects[id]?.room === me.room && !v.over) ctx.send({ type: 'look', obj: id });
    };
    el.querySelectorAll('[data-obj]').forEach((b) => {
      b.onclick = () => open('obj:' + b.dataset.obj);
      b.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open('obj:' + b.dataset.obj); } };
    });
    el.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => open(b.dataset.open)));
    el.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => { UI.open = null; sound('place'); ctx.send({ type: 'go', room: b.dataset.go }); redraw(); }));
    // Redraws keep these elements, so every handler is a property (replaced, never stacked).
    const hintBtn = el.querySelector('[data-hint]');
    if (hintBtn) hintBtn.onclick = () => ctx.send({ type: 'hint' });
    const jump = el.querySelector('[data-jump]');
    if (jump) jump.onclick = () => el.querySelector('.esc-hintpanel')?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    // <details> toggle events don't bubble: each drawer reports its own state.
    const journalEl = el.querySelector('.esc-journal'), teamEl = el.querySelector('.esc-team');
    if (journalEl) journalEl.ontoggle = () => { UI.journal = journalEl.open; };
    if (teamEl) teamEl.ontoggle = () => { UI.team = teamEl.open; };
    const close = () => {
      if (UI.open === 'story:intro') try { sessionStorage.setItem(introKey(v), '1'); } catch {}
      UI.open = null; redraw();
    };
    UI.close = UI.open ? close : null;
    el.querySelectorAll('[data-close]').forEach((b) => (b.onclick = close));
    const modal = el.querySelector('.esc-modal');
    if (modal) modal.onclick = (e) => { if (e.target.classList.contains('esc-modal')) close(); };
    // A long close-up keeps its scroll position when someone else's move redraws the room: the
    // kept box simply stays where it was. A different close-up starts at the top.
    const box = el.querySelector('.esc-close');
    if (box) {
      const kept = box === UI.box;
      if (!still) { if (kept && UI.scroll) box.scrollTop = 0; UI.scroll = 0; } else if (!kept && UI.scroll) box.scrollTop = UI.scroll;
      box.onscroll = () => { UI.scroll = box.scrollTop; };
    }
    UI.box = box;
    el.querySelectorAll('[data-dial]').forEach((b) => (b.onclick = () => {
      const [id, i, d] = b.dataset.dial.split(':');
      const n = objects[id].lock.slots[i].length;
      UI.dials[id][i] = (UI.dials[id][i] + Number(d) + n) % n;
      sound('click');
      redraw();
    }));
    el.querySelectorAll('[data-try]').forEach((b) => (b.onclick = () => ctx.send({ type: 'code', obj: b.dataset.try, value: UI.dials[b.dataset.try].slice() })));
    el.querySelectorAll('[data-take]').forEach((b) => (b.onclick = () => ctx.send({ type: 'take', obj: b.dataset.take })));
    el.querySelectorAll('[data-use]').forEach((b) => (b.onclick = () => { const [obj, item] = b.dataset.use.split(':'); ctx.send({ type: 'use', obj, item }); }));
    el.querySelectorAll('[data-share]').forEach((b) => (b.onclick = () => ctx.send({ type: 'share', frag: b.dataset.share })));
    el.querySelectorAll('[data-walk]').forEach((b) => (b.onclick = () => { const [roomId, then] = b.dataset.walk.split('|'); UI.open = then || null; sound('place'); ctx.send({ type: 'go', room: roomId }); redraw(); }));
  }

  function closeup(v, ctx, me, age, still, ago) {
    const [kind, id] = UI.open.split(':');
    let title = '', body = '', ic = '';
    if (kind === 'story') {
      title = spec.intro.title; ic = icon('book');
      body = `<div class="esc-closeart">${spec.cover}</div>${spec.intro.text.map((t) => `<p>${t}</p>`).join('')}
        <p class="muted small">Explore at your own pace: everyone can move and act at the same time. Tap anything in a room to look closer.</p>
        <button class="primary" data-close style="width:100%">${v.seen.length || v.inv.length ? 'Back to the investigation' : 'Begin'}</button>`;
    } else if (kind === 'item' && own(spec.items, id) && v.inv.includes(id)) {
      const it = spec.items[id];
      title = it.name; ic = svgIc(IC.bag);
      body = `<div class="esc-itembig"><svg viewBox="0 0 40 40">${shaded(id, 3)}${it.icon}</svg></div><p class="esc-text">${it.text}</p><p class="muted small">To use it, open the thing you want to use it on.</p>`;
    } else if (kind === 'frag' && own(frags, id)) {
      const f = v.frags.find((x) => x.id === id);
      if (!f?.text) { UI.open = null; return ''; }
      title = f.title; ic = svgIc(IC.wrist);
      body = `<div class="esc-wrist">${f.text}</div>${f.owner === me.id && !f.shared
        ? `<p class="muted small">Only you can see this. Read it aloud to your team, or put it in the shared journal.</p><button class="primary" data-share="${f.id}" style="width:100%">Share with the team</button>` : '<p class="muted small">Your whole team can read this in the journal.</p>'}`;
    } else if (kind === 'obj' && own(objects, id) && present(v, objects[id])) {
      const o = objects[id];
      const info = o.look(v, me.id);
      const nearby = o.room === me.room && !v.over;
      title = o.name; ic = icon('search');
      let act = '';
      // A short "it worked" note while the success is fresh (the dials or button it replaces are gone).
      const sa = solvedAge(v, o, age), ta = v.flags['took:' + o.id] ? age('f:took:' + o.id) : Infinity;
      if (Math.min(sa, ta) < 8000) act += `<div class="esc-win"${ago(Math.min(sa, ta))}>${icon('check')}<span>${sa <= ta ? (o.lock && v.flags[o.lock.flag] ? 'Solved!' : 'It worked!') : 'Added to the shared inventory'}</span></div>`;
      if (nearby) {
        if (o.take && !v.flags['took:' + o.id] && (!o.take.when || o.take.when(v))) act += `<button class="primary" data-take="${o.id}" style="width:100%">${esc(o.take.label || 'Take the ' + spec.items[o.take.item].name.toLowerCase())}</button>`;
        const L = o.lock;
        if (L && lockReady(v, L)) {
          const vals = (UI.dials[o.id] ||= L.slots.map(() => 0));
          act += `<div class="esc-dials" data-a="esc-lock-${o.id}">${L.slots.map((opts, i) => `<div class="esc-dial">${L.labels ? `<span>${L.labels[i]}</span>` : ''}
            <button class="small" data-dial="${o.id}:${i}:1" aria-label="Next value">${icon('up')}</button><div class="esc-val">${opts[vals[i]]}</div><button class="small" data-dial="${o.id}:${i}:-1" aria-label="Previous value">${icon('chevron')}</button></div>`).join('')}</div>
            <button class="primary" data-try="${o.id}" style="width:100%">${esc(L.verb || 'Try it')}</button>`;
        } else if (L && !v.flags[L.flag] && L.notYet) act += `<p class="esc-note-line">${svgIc(IC.lock)}<span>${esc(L.notYet)}</span></p>`;
        if (v.inv.length) act += `<div class="esc-use"><small>Use an item here</small><div class="row">${v.inv.map((it) => `<button class="small" data-use="${o.id}:${it}"><svg viewBox="0 0 40 40" aria-hidden="true">${spec.items[it].icon}</svg>${esc(spec.items[it].name)}</button>`).join('')}</div></div>`;
        if (o.go && v.open.includes(o.go)) act += `<button class="esc-walk" data-walk="${o.go}" style="width:100%">${icon('door')}${esc(o.goLabel || 'Go to the ' + rooms[o.go].name)}</button>`;
      } else if (!v.over) {
        act += `<p class="muted small">This is in the ${esc(rooms[o.room].name)}. Go there to touch it.</p><button class="esc-walk" data-walk="${o.room}|obj:${o.id}" style="width:100%">${icon('door')}Go to the ${esc(rooms[o.room].name)}</button>`;
      }
      body = `${info.art ? `<div class="esc-closeart">${info.art}</div>` : ''}<div class="esc-text">${info.text}</div>${act}`;
    } else { UI.open = null; return ''; }
    return `<div class="modal-bg esc-modal ${still ? 'esc-still' : ''}"><div class="modal panel esc-close" role="dialog" aria-label="${esc(title)}">
      <button class="icon-btn esc-x" data-close aria-label="Close">${icon('close')}</button><h3 class="gold">${ic}<span>${esc(title)}</span></h3>${body}</div></div>`;
  }

  function ending(v) {
    const e = spec.ending(v);
    return `<div class="esc-ending" role="status"><div class="esc-closeart">${e.art || spec.cover}</div><div>
      <div class="winner-banner">${icon('trophy')} ${esc(e.title)}</div>${e.text.map((t) => `<p>${t}</p>`).join('')}
      <div class="esc-endstats"><span>${icon('timer')}${clock(v.endedAt - v.started)}</span><span>${icon('bulb')}${v.hintsUsed} hint${v.hintsUsed === 1 ? '' : 's'}</span><span>${svgIc(IC.lock)}${v.attempts} wrong tr${v.attempts === 1 ? 'y' : 'ies'}</span></div>
      <p class="muted small">Every player shares the escape. Start a new game for a fresh set of codes.</p></div></div>`;
  }

  return game;
}

// One ticking clock for whichever escape room is on screen.
if (browser) setInterval(() => document.querySelectorAll('.esc-clock').forEach((c) => {
  if (!c.dataset.end) c.textContent = clock(Date.now() - Number(c.dataset.start));
}), 1000);

/* ---------------- drawing helpers ---------------- */

const FLASH = 2600; // how long a success flash may still be playing after a redraw (ms)
// Side panels open on wide screens and fold away on phones, so the room picture gets the screen.
function wide() { return typeof matchMedia === 'function' ? matchMedia('(min-width: 901px)').matches : true; }
// A few line icons the shared set doesn't have, drawn the same way as js/icons.js.
const IC = {
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  goal: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1.1" fill="currentColor"/>',
  bag: '<path d="M4.5 9h15l-1.3 10.3a1.5 1.5 0 0 1-1.5 1.2H7.3a1.5 1.5 0 0 1-1.5-1.2z"/><path d="M8.8 9V7.2a3.2 3.2 0 0 1 6.4 0V9"/>',
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  wrist: '<rect x="6.5" y="6.5" width="11" height="11" rx="3"/><path d="M9 6.5l.6-3.5h4.8l.6 3.5M9 17.5l.6 3.5h4.8l.6-3.5M9.5 12h1.5l1-2 1.5 4 1-2h1"/>',
};
const svgIc = (body, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
// Viewfinder corners just inside a hotspot, and a four-point glint.
function corners(x, y, w, h) {
  x += 2.5; y += 2.5; w -= 5; h -= 5;
  const c = Math.round(Math.max(6, Math.min(14, w / 4, h / 4)));
  return `M${x} ${y + c}V${y}H${x + c}M${x + w - c} ${y}H${x + w}V${y + c}M${x + w} ${y + h - c}V${y + h}H${x + w - c}M${x + c} ${y + h}H${x}V${y + h - c}`;
}
const sparkle = (x, y, r) => `M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z`;
// An SVG laid exactly over the room picture (same box, same 400x250 drawing, so it lands on the same
// pixels), holding one moving part whose own box is [x, y, w, h]: it scales and turns about that box's
// centre. Its CSS animation (opacity, transform) then runs on the compositor; the empty rest of the
// layer costs nothing to draw.
const pct = (n, of) => `${+((n / of) * 100).toFixed(4)}%`;
function overlay(id, cls, [x, y, w, h], body, style = '', born = null) {
  return `<svg id="${id}" class="${cls}" viewBox="0 0 400 250" style="transform-origin:${pct(x + w / 2, 400)} ${pct(y + h / 2, 250)}${style ? ';' + style : ''}"${born != null ? ` data-ago="${born}"` : ''}>${body}</svg>`;
}
// n×n offset copies of an icon's shapes in translucent black, spaced `step` apart, build up a soft drop
// shadow (alpha, dy down) much like a Gaussian blur, so no filter runs when the icon paints.
function shadow(body, dy, step, alpha, n) {
  const a = +(1 - Math.pow(1 - alpha, 1 / (n * n))).toFixed(4);
  body = body.replace(/\b(fill|stroke)="(?!none")[^"]*"/g, '$1="#000"'); // black, as a drop-shadow() would be
  let out = '';
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out += `<g opacity="${a}" transform="translate(${+((i - (n - 1) / 2) * step).toFixed(3)} ${+(dy + (j - (n - 1) / 2) * step).toFixed(3)})">${body}</g>`;
  return `<g class="esc-shade">${out}</g>`;
}
// Redraw only what changed (morph), but leave each success flash that is still showing on a kept element
// with the start time it was born with: changing --ago under a running animation would shift its delay.
function paint(el, html) {
  const flashes = [...el.querySelectorAll('[data-ago]')].map((n) => [n, n.getAttribute('data-ago'), n.getAttribute('style')]);
  morph(el, html);
  for (const [n, born, style] of flashes) if (n.getAttribute('data-ago') === born && n.getAttribute('style') !== style && el.contains(n)) n.setAttribute('style', style);
}

// Each game sets --accent/--glow/--deep inline, and its own atmosphere (felt, glass tint) in spec.css.
const STYLE = `
.esc-root{--accent:#e8c27a;--glow:#ffe3a3;--deep:#120c08;--accent-2:#ff9f5a;--win:#3ee0a1;--ink-on:#1b1206;
  --acc-soft:rgba(232,194,122,.12);--acc-line:rgba(232,194,122,.38);--acc-line-2:rgba(232,194,122,.2);--acc-glow:rgba(232,194,122,.5);
  --glass-1:rgba(31,44,92,.8);--glass-2:rgba(19,28,62,.88);--item-1:#2b3b78;--item-2:#121a3d}
.esc-root h3.gold{color:var(--accent)}
.esc-root button.small{min-height:40px}

/* status bar: goal, clock, hints */
.esc-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:stretch;margin-bottom:12px}
.esc-goal,.esc-stat{position:relative;display:flex;align-items:center;gap:10px;padding:8px 14px;border-radius:16px;
  background:linear-gradient(180deg,var(--glass-1),var(--glass-2));border:1px solid var(--line);box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 6px 16px rgba(2,4,16,.3)}
.esc-goal{flex:1;min-width:190px;border-color:var(--acc-line);background:radial-gradient(120% 140% at 0% 0%,var(--acc-soft),transparent 60%),linear-gradient(180deg,var(--glass-1),var(--glass-2))}
.esc-goal-txt,.esc-stat>span{display:flex;flex-direction:column;min-width:0}
.esc-goal-txt{flex:1}
.esc-goal small,.esc-stat small{font-size:.64rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);line-height:1.35}
.esc-goal b{font-family:var(--font-display);font-weight:600;color:var(--accent);font-size:1.04rem;line-height:1.25}
.esc-stat b{font-family:var(--font-display);font-weight:600;font-size:1.08rem;line-height:1.25}
.esc-stat>.ic{width:20px;height:20px;color:var(--accent)}
.esc-goal-ic{flex:none;width:38px;height:38px;border-radius:50%;display:grid;place-items:center;color:var(--ink-on);
  background:radial-gradient(circle at 35% 30%,var(--glow),var(--accent) 70%);box-shadow:0 0 0 3px var(--acc-soft),0 4px 12px rgba(0,0,0,.35)}
.esc-goal-ic .ic{width:21px;height:21px}
.esc-steps{display:flex;gap:4px;flex:none;align-self:center}
.esc-steps i{width:12px;height:5px;border-radius:3px;background:rgba(255,255,255,.14)}
.esc-steps i.on{background:var(--accent)}
.esc-steps i.now{background:var(--glow);box-shadow:0 0 0 1px var(--acc-line)}
.esc-goalnew::after{content:'';position:absolute;inset:-1px;border-radius:inherit;pointer-events:none;box-shadow:0 0 0 2px var(--glow),0 0 26px var(--acc-glow);
  opacity:0;animation:escFlash 1.8s ease-out both;animation-delay:calc(.15s - var(--ago,0ms))}
.esc-goalnew b{animation:escRise .5s var(--ease) both;animation-delay:calc(.15s - var(--ago,0ms))}
.esc-goalnew .esc-goal-ic{animation:escPop .7s var(--spring) both;animation-delay:calc(.15s - var(--ago,0ms))}
.esc-bar button.esc-stat{min-height:0;justify-content:flex-start;gap:10px;font:inherit;color:inherit;text-align:left;cursor:pointer}
.esc-bar button.esc-stat:hover:not(:disabled){background:linear-gradient(180deg,var(--glass-1),var(--glass-2));border-color:var(--acc-line)}
.esc-bar>.esc-storybtn{align-self:center}
@keyframes escFlash{15%{opacity:1}100%{opacity:0}}
@keyframes escRise{from{opacity:0;transform:translateY(6px)}}
@keyframes escPop{40%{transform:scale(1.25) rotate(-8deg)}}

/* the stage: room tabs, picture, objects and inventory on the game's own felt */
.esc-felt{padding:12px;min-width:0}
.esc-tabs{display:flex;gap:6px;margin-bottom:10px}
.esc-tab{flex:1 1 0;min-width:0;min-height:54px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:6px;
  font-family:var(--font-display);font-weight:600;font-size:.84rem;line-height:1.15;background:rgba(8,14,38,.55);border-color:var(--line);border-radius:14px}
.esc-tab>span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.esc-tab.here{color:#fff;text-shadow:none;background:linear-gradient(135deg,var(--brand),var(--brand-2));border-color:transparent;box-shadow:var(--glow-brand)}
.esc-tab.locked{background:rgba(4,8,24,.5);border-style:dashed}
.esc-dots{display:flex;align-items:center;justify-content:center;min-height:20px}
.esc-lockic{width:15px;height:15px;color:var(--accent-2)}
.esc-face{position:relative;display:inline-block;flex:none;width:30px;height:30px;border-radius:50%;background:#1c2853;box-shadow:0 0 0 2px var(--pc,#fff),0 2px 6px rgba(0,0,0,.45)}
.esc-face .portrait{display:block;width:100%;height:100%;border-radius:50%}
.esc-face.esc-mini{width:20px;height:20px;box-shadow:0 0 0 1.5px var(--pc,#fff),0 1px 3px rgba(0,0,0,.55)}
.esc-face.esc-mini+.esc-face.esc-mini{margin-left:-4px}
.esc-face.esc-sm{width:24px;height:24px}
.esc-mark{position:absolute;right:-5px;bottom:-4px;width:15px;height:15px;border-radius:50%;display:grid;place-items:center;font:700 8px/1 var(--font-body);font-style:normal;
  color:#1b1206;background:var(--pc);box-shadow:0 0 0 2px #17214a}
.esc-scene{position:relative;border-radius:16px;overflow:hidden;border:2px solid var(--acc-line);background:var(--deep);
  box-shadow:0 14px 30px rgba(2,4,16,.55),0 0 0 4px rgba(4,8,24,.4),0 0 32px var(--acc-soft)}
.esc-scene svg{display:block;width:100%;height:auto;touch-action:manipulation;user-select:none;-webkit-user-select:none}
.esc-hot{cursor:pointer;outline:none;transform-box:fill-box;transform-origin:center;transition:transform .12s var(--ease);-webkit-tap-highlight-color:transparent}
.esc-hit{fill:transparent;stroke:transparent;stroke-width:2.5;transition:fill .15s}
@media (hover:hover){.esc-hot:hover .esc-hit{stroke:var(--glow);stroke-dasharray:7 5;fill:rgba(255,244,214,.07)}}
.esc-hot:focus-visible .esc-hit{stroke:var(--glow);stroke-dasharray:7 5;fill:rgba(255,244,214,.07)}
.esc-hot:active{transform:scale(.97)}
.esc-hot:active .esc-hit{fill:rgba(255,255,255,.12)}
/* Not examined yet: viewfinder corners, a slow breathing halo (opacity only) and a glint. */
.esc-rim{fill:none;stroke-linecap:round;stroke-linejoin:round;pointer-events:none;stroke:var(--accent);stroke-width:2.2;opacity:.85}
.esc-picked .esc-hit{stroke:var(--glow);fill:rgba(255,255,255,.08)}
.esc-picked .esc-rim{stroke:var(--glow);opacity:1}
/* Whatever moves on the picture lives in .esc-glints: SVGs laid over the room picture, each animated as a
   whole (opacity, transform), which the compositor does without repainting the room. */
.esc-glints{position:absolute;inset:0;pointer-events:none}
.esc-scene .esc-glints>svg{position:absolute;inset:0;width:100%;height:100%;display:block;overflow:visible;pointer-events:none}
.esc-glints .esc-aura{opacity:.08;animation:escBreathe 2.8s ease-in-out infinite}
.esc-aura path{fill:none;stroke:var(--glow);stroke-width:6;stroke-linecap:round;stroke-linejoin:round}
@keyframes escBreathe{50%{opacity:.38}}
.esc-glints .esc-spark{animation:escTwinkle 2.4s ease-in-out infinite}
.esc-spark path{fill:var(--glow);stroke:rgba(0,0,0,.45);stroke-width:1}
@keyframes escTwinkle{50%{opacity:.45;transform:scale(.7) rotate(25deg)}}
/* Just solved: a ring bursts outwards and a tick pops up, once. */
.esc-glints .esc-burst{opacity:0;animation:escBurst 1.3s ease-out both;animation-delay:calc(.1s - var(--ago,0ms))}
.esc-burst rect{fill:none;stroke:var(--win);stroke-width:4}
@keyframes escBurst{0%{opacity:0;transform:scale(.94)}20%{opacity:1}100%{opacity:0;transform:scale(1.07)}}
.esc-glints .esc-tick{animation:escTick 2.5s ease-out both;animation-delay:calc(.1s - var(--ago,0ms))}
.esc-tick circle{fill:var(--win);stroke:#fff;stroke-width:2}
.esc-tick path{fill:none;stroke:var(--ink-on);stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
@keyframes escTick{0%{opacity:0;transform:scale(.3)}12%{opacity:1;transform:scale(1.15)}22%{transform:scale(1)}75%{opacity:1}100%{opacity:0}}
.esc-folk{position:absolute;left:8px;bottom:8px;display:flex;gap:6px;pointer-events:none}
.esc-folk .esc-face{width:28px;height:28px;box-shadow:0 0 0 2px var(--pc),0 3px 8px rgba(0,0,0,.65)}
.esc-where{display:flex;gap:8px;align-items:flex-start;margin:10px 2px 0;font-size:.88rem;line-height:1.4;color:var(--muted)}
.esc-where>.ic{color:var(--accent);margin-top:1px;width:17px;height:17px}
.esc-where b{color:var(--text);font-family:var(--font-display);font-weight:600}
.esc-objs{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 12px}
.esc-objs button{position:relative;min-height:40px;padding:6px 14px;font-size:.82rem;border-radius:999px;background:rgba(10,16,42,.7);border-color:var(--line-2);
  transition:transform .2s var(--ease),background-color .15s,border-color .15s,box-shadow .2s}
.esc-objs button .ic{width:15px;height:15px;color:var(--accent)}
.esc-objs button.fresh{border-color:var(--acc-line);box-shadow:inset 0 0 0 1px var(--acc-soft),0 2px 6px rgba(2,4,16,.25)}
.esc-objs button.fresh::after{content:'';position:absolute;inset:-3px;border-radius:inherit;pointer-events:none;box-shadow:0 0 12px 2px var(--acc-glow);opacity:.15;
  animation:escBreathe2 2.8s ease-in-out infinite;animation-delay:calc(var(--i,0) * -.45s)}
@keyframes escBreathe2{50%{opacity:.8}}
.esc-objs button.esc-picked{transform:translateY(-4px) scale(1.04);background:var(--surface-3);border-color:var(--glow);box-shadow:0 0 0 1px var(--glow),0 10px 20px rgba(2,4,16,.45)}
.esc-invpanel{padding:12px 14px 14px;background:rgba(6,10,30,.5);border-color:var(--acc-line-2);box-shadow:inset 0 1px 0 rgba(255,255,255,.05)}
.esc-root h3{display:flex;align-items:center;gap:8px;font-size:1rem}
.esc-root h3 .ic{width:20px;height:20px}
.esc-invpanel h3{margin:0 0 10px}
.esc-count{display:inline-grid;place-items:center;min-width:22px;height:22px;padding:0 6px;border-radius:11px;font:700 .74rem/1 var(--font-display);color:var(--ink-on);background:var(--accent)}
.esc-inv{display:flex;flex-wrap:wrap;gap:10px}
.esc-item{position:relative;width:80px;min-height:82px;padding:8px 4px 6px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;
  font-size:.68rem;line-height:1.1;background:radial-gradient(circle at 50% 30%,var(--item-1),var(--item-2));border:1px solid var(--acc-line);border-radius:16px;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.1),0 4px 10px rgba(2,4,16,.35);transition:transform .2s var(--ease),box-shadow .2s}
.esc-item svg{width:40px;height:40px;overflow:visible} /* its drop shadow is drawn into the icon: see shadow() */
.esc-item.esc-picked{transform:translateY(-6px) scale(1.05);box-shadow:0 0 0 2px var(--glow),0 12px 22px rgba(2,4,16,.55)}
.esc-item.esc-got::after,.esc-entry.esc-got::after{content:'';position:absolute;inset:-4px;border-radius:19px;pointer-events:none;box-shadow:0 0 0 2px var(--glow),0 0 22px 6px var(--acc-glow);
  opacity:0;animation:escFlash 1.8s ease-out both;animation-delay:calc(.8s - var(--ago,0ms))}
.esc-item.esc-got svg{animation:escPop .7s var(--spring) both;animation-delay:calc(.8s - var(--ago,0ms))}
.esc-entry.esc-got::after{inset:-1px;border-radius:inherit;animation-delay:calc(.1s - var(--ago,0ms))}
.esc-flyitem{width:100%;height:100%;display:grid;place-items:center;background:radial-gradient(circle at 50% 35%,#2f3f80,#111a3e);border-radius:14px;border:2px solid #ffe3a3;box-shadow:0 0 18px rgba(255,214,120,.55)}
.esc-flyitem svg{width:80%;height:80%}

/* side column: navy glass with the game's accent */
.esc-root .side>.panel{padding:14px 16px;border-color:var(--acc-line-2);
  background:radial-gradient(130% 70% at 50% -10%,var(--acc-soft),transparent 60%),linear-gradient(180deg,var(--glass-1),var(--glass-2))}
.esc-root .side>.drawer{padding:0}
.esc-root .drawer>summary{min-height:52px;padding:10px 14px;gap:10px}
.esc-root .drawer>summary>.ic:first-child{color:var(--accent)}
.esc-root .drawer>summary>span:not(.note){flex:none}
.esc-root .drawer>summary .note{min-width:0;flex:0 1 auto;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.esc-root .drawer-body{padding:0 14px 14px;gap:8px}
.esc-note,.esc-entry{position:relative;display:block;width:100%;min-height:44px;text-align:left;margin-top:8px;padding:9px 12px;font-weight:600;font-size:.84rem;line-height:1.4;
  border-radius:12px;background:rgba(8,12,34,.5);border:1px solid var(--line);box-shadow:none}
.esc-note b,.esc-entry b{font-weight:800;color:var(--text)}
.esc-note span,.esc-entry span{display:block;font-weight:600;color:#c3cbee;margin-top:2px}
.esc-note.mine{border-color:var(--acc-line);box-shadow:inset 0 0 0 1px var(--acc-soft),0 0 18px var(--acc-soft)}
.esc-note.mine b::before{content:'';display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:7px;vertical-align:1px;background:var(--accent-2);box-shadow:0 0 8px var(--accent-2)}
.esc-entry{margin-top:0;border-left:3px solid var(--accent)}
.esc-entry.esc-shared{border-left-color:var(--accent-2)}
.esc-entry i{font-style:normal;font-weight:800;font-size:.66rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-left:4px}
.esc-other{display:flex;gap:9px;align-items:center;margin-top:10px;font-size:.82rem;color:var(--muted)}
.esc-other b{color:var(--text)}
.esc-tier{margin-left:4px;font:700 .7rem var(--font-body);color:var(--muted);letter-spacing:.04em}
.esc-hints{list-style:none;counter-reset:hint;display:grid;gap:8px;margin:10px 0 0;padding:0;font-size:.88rem;line-height:1.45}
.esc-hints li{counter-increment:hint;position:relative;padding:8px 12px 8px 40px;border-radius:12px;background:rgba(8,12,34,.5);border:1px solid var(--line)}
.esc-hints li::before{content:counter(hint);position:absolute;left:10px;top:8px;width:21px;height:21px;border-radius:50%;display:grid;place-items:center;
  font:700 .72rem/1 var(--font-display);color:var(--ink-on);background:var(--accent)}
.esc-hints li b{color:var(--glow)}
/* The hint button's "you seem stuck" glow: the same soft halo as pulse-glow's drop-shadow, drawn once and
   faded in and out with opacity instead of filtering the button every frame. */
.esc-root button.pulse-glow{animation:none;position:relative}
.esc-root button.pulse-glow::after{content:'';position:absolute;inset:-1px;border-radius:inherit;pointer-events:none;box-shadow:0 0 7px rgba(255,224,140,.8);
  opacity:0;animation:escGlow 2.2s ease-in-out infinite}
@keyframes escGlow{50%{opacity:1}}
.esc-newhint{animation:escRise .5s var(--ease) both;animation-delay:calc(0ms - var(--ago,0ms))}
.esc-people{display:grid;gap:12px}
.esc-person{display:flex;gap:11px;align-items:center;font-size:.9rem}
.esc-person .grow{display:flex;flex-wrap:wrap;align-items:center;gap:2px 6px;line-height:1.3}
.esc-person small{flex-basis:100%;display:flex;align-items:center;gap:4px;color:var(--muted);font-size:.78rem}
.esc-person small .ic{width:13px;height:13px;color:var(--accent)}
.esc-log{max-height:160px;padding:6px 12px;border-radius:12px;font-size:.8rem;color:#c3cbee;background:rgba(4,8,26,.45);border:1px solid var(--line)}
.esc-log div{border-bottom:1px solid rgba(150,172,255,.1)}
.esc-log div:last-child{border-bottom:0}
.esc-log div:first-child{color:var(--text)}

/* close-ups */
.esc-modal{z-index:120}
.esc-modal.esc-still,.esc-modal.esc-still>.modal{animation:none}
.esc-root .modal.esc-close{max-width:560px;position:relative;border-color:var(--acc-line);
  background:radial-gradient(120% 45% at 50% 0%,var(--acc-soft),transparent 70%),linear-gradient(180deg,#1a2552,#141d44)}
.esc-close h3{margin:0 46px 12px 0;color:var(--accent);font-size:1.15rem}
.esc-close h3 .ic{opacity:.9;flex:none}
.esc-x{position:absolute;top:10px;right:10px}
.esc-closeart{position:relative;border-radius:14px;overflow:hidden;box-shadow:0 10px 22px rgba(0,0,0,.5),0 0 0 1px var(--acc-line);margin-bottom:12px}
.esc-close .esc-closeart{animation:escLift .5s var(--spring) both .04s}
.esc-still .esc-closeart{animation:none}
@keyframes escLift{from{opacity:.3;transform:translateY(12px) scale(.96)}}
.esc-closeart svg{display:block;width:100%;height:auto}
.esc-text{line-height:1.55;margin:4px 0 12px}
.esc-text p{margin:.4em 0}
.esc-paper{display:block;color:var(--ink);background:linear-gradient(170deg,#f6ead0,#e4cf9f);border-radius:10px;padding:12px 14px;font-style:italic;box-shadow:inset 0 0 14px rgba(120,80,30,.35),0 4px 10px rgba(0,0,0,.25);margin:6px 0}
.esc-wrist{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.88rem;line-height:1.55;color:#bff7ef;background:linear-gradient(180deg,#06222a,#031216);border:2px solid #2b7c86;border-radius:12px;padding:12px 14px;box-shadow:inset 0 0 22px rgba(60,220,220,.18);margin-bottom:10px}
.esc-wrist b{color:#ffe39a}
.esc-win{display:flex;align-items:center;justify-content:center;gap:10px;margin:2px 0 12px;padding:10px 14px;border-radius:14px;font:600 1.02rem/1.2 var(--font-display);
  color:var(--text);background:radial-gradient(120% 160% at 50% 0%,rgba(255,255,255,.1),transparent 60%),rgba(8,12,34,.55);border:1px solid var(--win);
  box-shadow:0 0 20px rgba(0,0,0,.25);animation:escWin .55s var(--spring) both;animation-delay:calc(0ms - var(--ago,0ms))}
.esc-win .ic{width:26px;height:26px;padding:4px;border-radius:50%;color:var(--ink-on);background:var(--win)}
@keyframes escWin{from{opacity:0;transform:scale(.85)}}
.esc-dials{display:flex;justify-content:center;align-items:flex-end;flex-wrap:wrap;gap:8px;margin:8px 0 14px;padding:12px 8px;border-radius:16px;background:rgba(4,8,26,.45);border:1px solid var(--line)}
.esc-dial{display:flex;flex-direction:column;align-items:center;gap:6px;min-width:56px}
.esc-dial>span{font-size:.66rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);text-align:center;max-width:84px;line-height:1.15}
.esc-dial button{min-width:52px;min-height:40px;padding:0;border-radius:12px}
.esc-dial button .ic{width:20px;height:20px}
.esc-val{min-width:58px;min-height:54px;padding:4px 8px;display:grid;place-items:center;font-family:var(--font-display);font-size:1.4rem;font-weight:700;color:var(--accent);
  background:linear-gradient(180deg,#060a20,#141d48);border:2px solid var(--acc-line);border-radius:12px;box-shadow:inset 0 4px 10px rgba(0,0,0,.7),0 1px 0 rgba(255,255,255,.08)}
.esc-val svg{width:34px;height:34px;display:block}
.esc-use{margin:12px 0}
.esc-use small{display:block;color:var(--muted);margin-bottom:6px;font-size:.7rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase}
.esc-use button{display:inline-flex;align-items:center;gap:6px;min-height:40px}
.esc-use svg{width:22px;height:22px}
.esc-note-line{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:12px;background:rgba(4,8,26,.45);border:1px solid var(--line);border-left:3px solid var(--accent-2);font-size:.9rem}
.esc-note-line .ic{color:var(--accent-2);margin-top:1px}
.esc-close>button+button{margin-top:8px}
.esc-itembig{display:grid;place-items:center;padding:18px;background:radial-gradient(circle at 50% 40%,var(--item-1),var(--item-2));border:1px solid var(--acc-line);border-radius:18px;box-shadow:inset 0 0 30px rgba(0,0,0,.35)}
.esc-itembig svg{width:120px;height:120px;overflow:visible}

/* the ending */
.esc-ending{display:grid;grid-template-columns:minmax(0,280px) 1fr;gap:20px;align-items:center;padding:18px;margin-bottom:14px;border-radius:22px;border:1px solid var(--acc-line);
  background:radial-gradient(90% 120% at 0% 0%,var(--acc-soft),transparent 60%),linear-gradient(180deg,var(--glass-1),var(--glass-2));box-shadow:var(--shadow-lg),0 0 40px var(--acc-soft)}
.esc-ending .winner-banner{display:flex;align-items:center;gap:10px;text-align:left;padding:0 0 6px}
.esc-ending .winner-banner .ic{width:1em;height:1em}
.esc-ending p{line-height:1.6;margin:.5em 0}
.esc-endstats{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}
.esc-endstats span{display:inline-flex;align-items:center;gap:7px;padding:6px 13px;border-radius:999px;background:rgba(4,8,26,.5);border:1px solid var(--acc-line-2);font-weight:800}
.esc-endstats .ic{width:17px;height:17px;color:var(--accent)}

@media (max-width:900px){
  .esc-felt{padding:8px}
}
@media (max-width:640px){
  .esc-ending{grid-template-columns:1fr;padding:14px}
  .esc-tab{font-size:.72rem;padding:5px 3px;min-height:50px;border-radius:12px}
  .esc-goal{min-width:100%}
  .esc-stat{flex:1;padding:6px 10px}
  .esc-scene{border-radius:12px}
  .esc-folk{left:6px;bottom:6px;gap:4px}
  .esc-folk .esc-face{width:22px;height:22px}
  .esc-val{min-width:50px;font-size:1.15rem}
  .esc-dial{min-width:50px}
  .esc-dial button{min-width:46px}
  .esc-item{width:74px;min-height:78px}
}
@media (max-width:420px){
  .esc-dials{gap:5px;padding:10px 4px}
  .esc-dial,.esc-dial button{min-width:44px}
  .esc-val{min-width:44px;padding:4px 3px;font-size:1rem}
  .esc-dial>span{font-size:.6rem;max-width:52px}
  .esc-steps{display:none}
}
`;
