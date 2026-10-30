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
import { esc, log, addFx, uid } from '../js/util.js';
import { injectCSS } from '../js/fx.js';
import { sound } from '../js/sound.js';
import { icon } from '../js/icons.js';

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
const botPatience = () => globalThis.escapeBotPatience ?? (browser ? 45000 : 0);
const botIdle = () => globalThis.escapeBotIdle ?? 0.8; // chance a bot just thinks this tick

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

    setup(players) {
      if (!players.length || players.length > 4 || new Set(players.map((p) => p.id)).size !== players.length) throw Error('Escape rooms need 1–4 players.');
      const start = spec.rooms[0].id;
      const s = {
        gid: uid(), phase: 'play', over: false, won: false, winners: [],
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

  /* ---------------- interface ---------------- */

  // Which close-up is open and how the dials are set: local to this device, kept across redraws.
  const UI = { gid: null, open: null, dials: {}, close: null };
  if (browser) addEventListener('keydown', (e) => { if (e.key === 'Escape' && UI.close && document.body.contains(document.querySelector(`.esc-${spec.id} .esc-modal`))) UI.close(); });
  const itemTile = (id) => `<div class="esc-flyitem"><svg viewBox="0 0 40 40">${spec.items[id].icon}</svg></div>`;
  const pawn = (v, p, key = '') => { const [c, m] = PAWNS[p.seat % 4]; return `<span class="esc-pawn" ${key ? `data-k="${key}"` : ''} style="background:${c}" title="${esc(p.name)}">${m}</span>`; };
  const introKey = (v) => 'esc-intro-' + v.gid;
  const introSeen = (v) => { try { return sessionStorage.getItem(introKey(v)) === '1'; } catch { return true; } };

  function draw(el, v, ctx) {
    injectCSS('escape-kit', STYLE);
    if (spec.css) injectCSS(spec.id, spec.css);
    if (UI.gid !== v.gid) { UI.gid = v.gid; UI.open = !v.over && !introSeen(v) ? 'story:intro' : null; UI.dials = {}; UI.ended = v.over; }
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

    el.innerHTML = `<div class="esc-root esc-${spec.id}" style="--accent:${spec.theme.accent};--glow:${spec.theme.glow};--deep:${spec.theme.deep}">
      ${v.over ? ending(v) : ''}
      <div class="esc-bar">
        <div class="esc-goal"><small>${v.over ? 'Complete' : 'Current goal'}</small><b>${esc(v.over ? spec.doneLabel : ob?.label || '')}</b></div>
        <div class="esc-stat"><small>Time</small><b class="esc-clock" data-start="${v.started}" data-end="${v.endedAt || ''}">${clock((v.endedAt || Date.now()) - v.started)}</b></div>
        <div class="esc-stat"><small>Hints</small><b>${v.hintsUsed}</b></div>
        <button class="small" data-open="story:intro">${icon('book')}Story</button>
      </div>
      <div class="game-layout">
        <div class="esc-main">
          <nav class="esc-tabs" aria-label="Rooms">${spec.rooms.map((r) => {
            const open = v.open.includes(r.id);
            return `<button class="esc-tab ${r.id === room.id ? 'here' : ''}" data-go="${r.id}" ${open && !v.over ? '' : 'disabled'} aria-label="${esc(open ? r.name : r.name + ' (locked)')}">
              <span>${open ? '' : '🔒 '}${esc(r.name)}</span><span class="esc-dots">${v.players.filter((p) => p.room === r.id).map((p) => pawn(v, p, 'esc-pawn-' + p.id)).join('')}</span></button>`;
          }).join('')}</nav>
          <div class="esc-scene" data-a="esc-scene">
            <svg viewBox="0 0 400 250" role="group" aria-label="${esc(room.name)}">${room.art(v)}
              ${here.map((o) => { const [x, y, w, h] = o.hot; return `<g class="esc-hot" data-obj="${o.id}" data-a="esc-obj-${o.id}" role="button" tabindex="0" aria-label="${esc(o.name)}"><rect class="esc-hit" x="${x}" y="${y}" width="${w}" height="${h}" rx="9"/>${v.seen.includes(o.id) ? '' : `<circle class="esc-spark" cx="${x + w - 7}" cy="${y + 7}" r="5"/>`}</g>`; }).join('')}
              <g class="esc-folk">${v.players.filter((p) => p.room === room.id).map((p, i) => { const [c, m] = PAWNS[p.seat % 4]; return `<g><circle cx="${18 + i * 22}" cy="232" r="9" fill="${c}" stroke="#fff" stroke-width="2"/><text x="${18 + i * 22}" y="236" text-anchor="middle" font-size="10" fill="#1b1206">${m}</text></g>`; }).join('')}</g>
            </svg>
          </div>
          <div class="esc-where"><b>${esc(room.name)}</b> · ${esc(room.blurb)}</div>
          <div class="esc-objs">${here.map((o) => `<button class="small ${v.seen.includes(o.id) ? '' : 'fresh'}" data-obj="${o.id}">${esc(o.name)}</button>`).join('')}</div>
          <div class="panel esc-invpanel" data-a="esc-inv"><h3 class="gold">Shared inventory</h3><div class="esc-inv">${v.inv.length ? v.inv.map((id) => `<button class="esc-item" data-k="esc-item-${id}" data-open="item:${id}"><svg viewBox="0 0 40 40" aria-hidden="true">${spec.items[id].icon}</svg><span>${esc(spec.items[id].name)}</span></button>`).join('') : '<p class="muted small">Nothing yet. Anything someone picks up appears here for the whole team.</p>'}</div></div>
        </div>
        <div class="side">
          ${spec.fragments ? `<div class="panel"><h3 class="gold">${esc(spec.fragLabel)}</h3>
            ${myFrags.length ? myFrags.map((f) => `<button class="esc-note ${f.shared ? '' : 'mine'}" data-open="frag:${f.id}"><b>${esc(f.title)}</b><span>${f.shared ? 'Shared with the team' : 'Only you can read this. Tap to open.'}</span></button>`).join('') : '<p class="muted small">Your terminal recovered nothing. Ask your teammates what they see.</p>'}
            ${theirs.map((f) => `<div class="esc-other">${pawn(v, v.players.find((p) => p.id === f.owner))} <span><b>${esc(v.players.find((p) => p.id === f.owner)?.name)}</b> holds “${esc(f.title)}”</span></div>`).join('')}</div>` : ''}
          <div class="panel"><div class="row"><h3 class="gold grow" style="margin:0">Hints</h3>${ob && !v.over ? `<button class="small ${stuck ? 'pulse-glow' : ''}" data-hint ${(v.hintTier[ob.id] || 0) >= ob.hints.length ? 'disabled' : ''}>${icon('bulb')}Ask for a hint</button>` : ''}</div>
            ${hints.length ? `<ol class="esc-hints">${hints.map((h) => `<li>${h.text}</li>`).join('')}</ol>` : `<p class="muted small" style="margin:8px 0 0">${stuck ? 'Feeling stuck? Hints start gentle and get more specific.' : 'Stuck? Hints start gentle and get more specific.'}</p>`}</div>
          <div class="parchment esc-journal"><h3>Team journal</h3>
            ${journal.length || sharedFrags.length ? `${journal.map((o) => `<button class="esc-entry" data-open="obj:${o.id}"><b>${esc(o.name)}</b> <i>${esc(rooms[o.room].name)}</i><span>${o.clue(v)}</span></button>`).join('')}
            ${sharedFrags.map((f) => `<button class="esc-entry" data-open="frag:${f.id}"><b>${esc(f.title)}</b> <i>shared by ${esc(v.players.find((p) => p.id === f.owner)?.name)}</i></button>`).join('')}` : '<p class="small">Clues anyone examines are written here, so the whole team can read them from any room.</p>'}</div>
          <div class="panel"><h3 class="gold">The team</h3>${v.players.map((p) => `<div class="esc-person">${pawn(v, p)}<span class="grow"><b>${esc(p.name)}</b>${p.id === me.id ? ' · you' : ''}${ctx.isBot?.(p.id) ? ' · computer' : ''}<br><small>${esc(rooms[p.room].name)}</small></span></div>`).join('')}</div>
          <div class="parchment log">${v.log.slice(0, 8).map((l) => `<div>${esc(l)}</div>`).join('')}</div>
        </div>
      </div>
      ${UI.open ? closeup(v, ctx, me) : ''}
    </div>`;

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
    el.querySelector('[data-hint]')?.addEventListener('click', () => ctx.send({ type: 'hint' }));
    const close = () => {
      if (UI.open === 'story:intro') try { sessionStorage.setItem(introKey(v), '1'); } catch {}
      UI.open = null; redraw();
    };
    UI.close = UI.open ? close : null;
    el.querySelectorAll('[data-close]').forEach((b) => (b.onclick = close));
    el.querySelector('.esc-modal')?.addEventListener('click', (e) => { if (e.target.classList.contains('esc-modal')) close(); });
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

  function closeup(v, ctx, me) {
    const [kind, id] = UI.open.split(':');
    let title = '', body = '';
    if (kind === 'story') {
      title = spec.intro.title;
      body = `<div class="esc-closeart">${spec.cover}</div>${spec.intro.text.map((t) => `<p>${t}</p>`).join('')}
        <p class="muted small">Explore at your own pace: everyone can move and act at the same time. Tap anything in a room to look closer.</p>
        <button class="primary" data-close style="width:100%">${v.seen.length || v.inv.length ? 'Back to the investigation' : 'Begin'}</button>`;
    } else if (kind === 'item' && own(spec.items, id) && v.inv.includes(id)) {
      const it = spec.items[id];
      title = it.name;
      body = `<div class="esc-itembig"><svg viewBox="0 0 40 40">${it.icon}</svg></div><p class="esc-text">${it.text}</p><p class="muted small">To use it, open the thing you want to use it on.</p>`;
    } else if (kind === 'frag' && own(frags, id)) {
      const f = v.frags.find((x) => x.id === id);
      if (!f?.text) { UI.open = null; return ''; }
      title = f.title;
      body = `<div class="esc-wrist">${f.text}</div>${f.owner === me.id && !f.shared
        ? `<p class="muted small">Only you can see this. Read it aloud to your team, or put it in the shared journal.</p><button class="primary" data-share="${f.id}" style="width:100%">Share with the team</button>` : '<p class="muted small">Your whole team can read this in the journal.</p>'}`;
    } else if (kind === 'obj' && own(objects, id) && present(v, objects[id])) {
      const o = objects[id];
      const info = o.look(v, me.id);
      const nearby = o.room === me.room && !v.over;
      title = o.name;
      let act = '';
      if (nearby) {
        if (o.take && !v.flags['took:' + o.id] && (!o.take.when || o.take.when(v))) act += `<button class="primary" data-take="${o.id}" style="width:100%">${esc(o.take.label || 'Take the ' + spec.items[o.take.item].name.toLowerCase())}</button>`;
        const L = o.lock;
        if (L && lockReady(v, L)) {
          const vals = (UI.dials[o.id] ||= L.slots.map(() => 0));
          act += `<div class="esc-dials" data-a="esc-lock-${o.id}">${L.slots.map((opts, i) => `<div class="esc-dial">${L.labels ? `<span>${L.labels[i]}</span>` : ''}
            <button class="small" data-dial="${o.id}:${i}:1" aria-label="Next value">${icon('up')}</button><div class="esc-val">${opts[vals[i]]}</div><button class="small" data-dial="${o.id}:${i}:-1" aria-label="Previous value">${icon('chevron')}</button></div>`).join('')}</div>
            <button class="primary" data-try="${o.id}" style="width:100%">${esc(L.verb || 'Try it')}</button>`;
        } else if (L && !v.flags[L.flag] && L.notYet) act += `<p class="esc-note-line">${esc(L.notYet)}</p>`;
        if (v.inv.length) act += `<div class="esc-use"><small>Use an item here</small><div class="row">${v.inv.map((it) => `<button class="small" data-use="${o.id}:${it}"><svg viewBox="0 0 40 40" aria-hidden="true">${spec.items[it].icon}</svg>${esc(spec.items[it].name)}</button>`).join('')}</div></div>`;
        if (o.go && v.open.includes(o.go)) act += `<button data-walk="${o.go}" style="width:100%">${esc(o.goLabel || 'Go to the ' + rooms[o.go].name)}</button>`;
      } else if (!v.over) {
        act = `<p class="muted small">This is in the ${esc(rooms[o.room].name)}. Go there to touch it.</p><button data-walk="${o.room}|obj:${o.id}" style="width:100%">Go to the ${esc(rooms[o.room].name)}</button>`;
      }
      body = `${info.art ? `<div class="esc-closeart">${info.art}</div>` : ''}<div class="esc-text">${info.text}</div>${act}`;
    } else { UI.open = null; return ''; }
    return `<div class="modal-bg esc-modal"><div class="modal panel esc-close" role="dialog" aria-label="${esc(title)}">
      <button class="icon-btn esc-x" data-close aria-label="Close">${icon('close')}</button><h3 class="gold">${esc(title)}</h3>${body}</div></div>`;
  }

  function ending(v) {
    const e = spec.ending(v);
    return `<div class="esc-ending" role="status"><div class="esc-closeart">${e.art || spec.cover}</div><div>
      <div class="winner-banner">${esc(e.title)}</div>${e.text.map((t) => `<p>${t}</p>`).join('')}
      <div class="esc-endstats"><span>⏱ ${clock(v.endedAt - v.started)}</span><span>💡 ${v.hintsUsed} hint${v.hintsUsed === 1 ? '' : 's'}</span><span>🔐 ${v.attempts} wrong tr${v.attempts === 1 ? 'y' : 'ies'}</span></div>
      <p class="muted small">Every player shares the escape. Start a new game for a fresh set of codes.</p></div></div>`;
  }

  return game;
}

// One ticking clock for whichever escape room is on screen.
if (browser) setInterval(() => document.querySelectorAll('.esc-clock').forEach((c) => {
  if (!c.dataset.end) c.textContent = clock(Date.now() - Number(c.dataset.start));
}), 1000);

const STYLE = `
.esc-root{--accent:#e8c27a;--glow:#ffe3a3;--deep:#120c08}
.esc-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:stretch;margin-bottom:12px}
.esc-goal,.esc-stat{padding:8px 14px;border-radius:12px;background:rgba(0,0,0,.38);border:1px solid rgba(255,255,255,.12);box-shadow:inset 0 1px 0 rgba(255,255,255,.06)}
.esc-goal{flex:1;min-width:190px}
.esc-goal small,.esc-stat small{display:block;font-size:.66rem;letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}
.esc-goal b{font-family:var(--font-display);color:var(--accent);font-size:1rem}
.esc-stat b{font-family:var(--font-display);font-size:1.05rem}
.esc-bar>button{align-self:center}
.esc-tabs{display:flex;gap:6px;margin-bottom:8px}
.esc-tab{flex:1 1 0;min-width:0;display:flex;flex-direction:column;align-items:center;gap:3px;padding:6px 6px;font-size:.78rem;line-height:1.15}
.esc-tab>span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.esc-tab.here{color:#fff;text-shadow:none;background:linear-gradient(135deg,var(--brand),var(--brand-2));border-color:transparent;box-shadow:var(--glow-brand)}
.esc-dots{display:flex;gap:3px;min-height:16px}
.esc-pawn{width:16px;height:16px;border-radius:50%;display:inline-grid;place-items:center;font-size:8px;color:#1b1206;border:1.5px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.6);flex:none;text-shadow:none}
.esc-scene{position:relative;border-radius:16px;overflow:hidden;border:3px solid #1a1009;background:var(--deep);box-shadow:0 16px 34px rgba(0,0,0,.6),0 0 0 1px rgba(255,220,160,.18)}
.esc-scene svg{display:block;width:100%;height:auto;touch-action:manipulation;user-select:none;-webkit-user-select:none}
.esc-hot{cursor:pointer;outline:none}
.esc-hit{fill:transparent;stroke:transparent;stroke-width:2.5}
.esc-hot:hover .esc-hit,.esc-hot:focus-visible .esc-hit{stroke:var(--glow);stroke-dasharray:7 5;fill:rgba(255,236,180,.08)}
.esc-spark{fill:var(--glow);stroke:rgba(0,0,0,.6);stroke-width:1.5;pointer-events:none;animation:escTwinkle 1.8s ease-in-out infinite;transform-box:fill-box;transform-origin:center}
@keyframes escTwinkle{50%{opacity:.35;transform:scale(.7)}}
.esc-where{margin:8px 2px 0;font-size:.88rem;color:var(--muted)}
.esc-where b{color:var(--text);font-family:var(--font-display)}
.esc-objs{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 12px}
.esc-objs button{min-height:40px;font-size:.8rem}
.esc-objs button.fresh{box-shadow:inset 0 0 0 2px var(--accent),0 3px 0 #1f1208}
.esc-objs button.fresh::after{content:' ✦';color:var(--accent)}
.esc-invpanel h3{margin:0 0 8px}
.esc-inv{display:flex;flex-wrap:wrap;gap:8px}
.esc-item{width:76px;min-height:76px;padding:6px 4px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;font-size:.66rem;line-height:1.1;background:radial-gradient(circle at 50% 35%,#2b3b78,#121a3d);border:1px solid var(--line);border-radius:14px}
.esc-item svg{width:40px;height:40px;filter:drop-shadow(0 2px 2px rgba(0,0,0,.6))}
.esc-flyitem{width:100%;height:100%;display:grid;place-items:center;background:radial-gradient(circle,#4b3520,#1d130b);border-radius:12px;border:2px solid var(--accent)}
.esc-flyitem svg{width:80%;height:80%}
.esc-note,.esc-entry{display:block;width:100%;text-align:left;margin-top:8px;font-weight:600;font-size:.82rem;line-height:1.35;padding:8px 12px}
.esc-note b,.esc-entry b{font-weight:800}
.esc-note span,.esc-entry span{display:block;font-weight:600;opacity:.85}
.esc-note.mine{box-shadow:inset 0 0 0 2px var(--accent),0 3px 0 #1f1208}
.esc-other{display:flex;gap:8px;align-items:center;margin-top:8px;font-size:.8rem;color:var(--muted)}
.esc-journal h3{margin:0 0 4px;color:var(--ink)}
.esc-journal .esc-entry{color:var(--ink);text-shadow:none;background:rgba(255,255,255,.35);border:1px solid rgba(80,50,20,.3);box-shadow:none;min-height:40px}
.esc-journal .esc-entry i{font-weight:600;opacity:.7;font-size:.75rem}
.esc-hints{margin:8px 0 0;padding-left:20px;font-size:.86rem;line-height:1.45}
.esc-hints li{margin-bottom:6px}
.esc-person{display:flex;gap:8px;align-items:center;margin-top:8px;font-size:.88rem}
.esc-person small{color:var(--muted)}
.esc-modal{z-index:120}
.esc-close{max-width:560px;position:relative}
.esc-close h3{margin:0 44px 10px 0}
.esc-x{position:absolute;top:10px;right:10px;min-width:40px;min-height:40px}
.esc-closeart{border-radius:12px;overflow:hidden;box-shadow:0 8px 18px rgba(0,0,0,.5);margin-bottom:10px}
.esc-closeart svg{display:block;width:100%;height:auto}
.esc-text{line-height:1.55;margin:4px 0 12px}
.esc-text p{margin:.4em 0}
.esc-paper{display:block;color:var(--ink);background:linear-gradient(170deg,#f6ead0,#e4cf9f);border-radius:8px;padding:12px 14px;font-style:italic;box-shadow:inset 0 0 14px rgba(120,80,30,.35);margin:6px 0}
.esc-wrist{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.88rem;line-height:1.55;color:#bff7ef;background:linear-gradient(180deg,#06222a,#031216);border:2px solid #2b7c86;border-radius:12px;padding:12px 14px;box-shadow:inset 0 0 22px rgba(60,220,220,.18);margin-bottom:10px}
.esc-wrist b{color:#ffe39a}
.esc-dials{display:flex;justify-content:center;flex-wrap:wrap;gap:8px;margin:8px 0 12px}
.esc-dial{display:flex;flex-direction:column;align-items:center;gap:5px;min-width:56px}
.esc-dial>span{font-size:.68rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);text-align:center;max-width:84px;line-height:1.1}
.esc-dial button{min-width:52px;min-height:40px;padding:0}
.esc-val{min-width:58px;min-height:52px;padding:4px 8px;display:grid;place-items:center;font-family:var(--font-display);font-size:1.35rem;font-weight:800;color:var(--accent);background:linear-gradient(180deg,#0d0906,#2a1d12);border:2px solid #7a5530;border-radius:10px;box-shadow:inset 0 4px 10px #000,0 1px 0 rgba(255,220,160,.2)}
.esc-val svg{width:34px;height:34px;display:block}
.esc-use{margin:12px 0}
.esc-use small{display:block;color:var(--muted);margin-bottom:6px;font-size:.72rem;letter-spacing:.1em;text-transform:uppercase}
.esc-use button{display:inline-flex;align-items:center;gap:6px;min-height:40px}
.esc-use svg{width:22px;height:22px}
.esc-note-line{padding:10px 12px;border-radius:10px;background:rgba(0,0,0,.3);border-left:3px solid var(--accent);font-size:.9rem}
.esc-close>button+button{margin-top:8px}
.esc-itembig{display:grid;place-items:center;padding:16px;background:radial-gradient(circle,#2f4084,#0c1330);border-radius:16px}
.esc-itembig svg{width:120px;height:120px;filter:drop-shadow(0 6px 8px rgba(0,0,0,.7))}
.esc-ending{display:grid;grid-template-columns:minmax(0,260px) 1fr;gap:18px;align-items:center;padding:18px;margin-bottom:14px;border-radius:18px;border:2px solid var(--accent);background:linear-gradient(135deg,rgba(0,0,0,.55),rgba(0,0,0,.25));box-shadow:0 14px 30px rgba(0,0,0,.5)}
.esc-ending .winner-banner{text-align:left;padding:0 0 6px}
.esc-ending p{line-height:1.6;margin:.5em 0}
.esc-endstats{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}
.esc-endstats span{padding:6px 12px;border-radius:20px;background:rgba(0,0,0,.4);border:1px solid rgba(255,255,255,.15);font-weight:800}
@media (max-width:640px){
  .esc-ending{grid-template-columns:1fr;padding:14px}
  .esc-tab{font-size:.7rem;padding:5px 3px}
  .esc-goal{min-width:100%}
  .esc-stat{flex:1}
  .esc-val{min-width:50px;font-size:1.15rem}
  .esc-dial{min-width:50px}
  .esc-dial button{min-width:46px}
}
@media (max-width:420px){
  .esc-dials{gap:5px}
  .esc-dial,.esc-dial button{min-width:44px}
  .esc-val{min-width:44px;padding:4px 3px;font-size:1rem}
  .esc-dial>span{font-size:.6rem;max-width:52px}
}
`;
