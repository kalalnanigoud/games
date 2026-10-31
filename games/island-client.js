// A player's screen for Creature Island: their own explorer moves the moment they press (and is quietly
// corrected by the host), everyone else glides between the host's updates, and the HUD, menus,
// conversations and save choices sit around the world without covering it.
import { TILE, TICK, SPECIES, ITEMS, GEAR, SHOP, SEATS, QUESTS, QUEST_ORDER, STARTERS, ABILITIES, NPCS, ELEMENTS, BOSSES, CATCH_HP, TEAM_MAX } from './island-data.js';
import { stepBody, newBody, BITS, objective, interactables } from './island-sim.js';
import { island, zoneAt, areaName, TRACKS, G, W } from './island-map.js';
import { createView, minimap } from './island-view.js';
import { cloudAvailable, explorerTag, keyIsKept, loadExplorer, saveExplorer, account, signIn, signUp, signOut, claimLegacy } from './island-cloud.js';
import { esc, toast } from '../js/util.js';
import { sound } from '../js/sound.js';
import { morph } from '../js/fx.js';

const T = TILE;
const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
const IC = {
  bag: svg('<path d="M6 8h12l-1 12H7L6 8z"/><path d="M9 8a3 3 0 0 1 6 0"/>'),
  team: svg('<circle cx="9" cy="9" r="3"/><circle cx="17" cy="10" r="2.5"/><path d="M3 19c1-3.5 3.5-5 6-5s5 1.5 6 5M15 15c2.5-.5 4.5.8 5.5 3.5"/>'),
  quest: svg('<path d="M6 3h9l3 3v15H6z"/><path d="M9 9h6M9 13h6M9 17h4"/>'),
  guide: svg('<path d="M4 5c3-1.5 5.5-1.5 8 0v15c-2.5-1.5-5-1.5-8 0zM20 5c-3-1.5-5.5-1.5-8 0v15c2.5-1.5 5-1.5 8 0z"/>'),
  map: svg('<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>'),
  save: svg('<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  sword: svg('<path d="M14.5 3H21v6.5L10 20.5 3.5 14z"/><path d="M5 19l-2 2M8 16l-3-3"/>'),
  dodge: svg('<path d="M4 12a8 8 0 0 1 14-5"/><path d="M18 3v4h-4"/><path d="M20 12a8 8 0 0 1-14 5"/><path d="M6 21v-4h4"/>'),
  paw: svg('<circle cx="7" cy="9" r="2"/><circle cx="12" cy="6.5" r="2"/><circle cx="17" cy="9" r="2"/><path d="M8 17c0-3 2-5 4-5s4 2 4 5c0 2-2 2.5-4 2.5S8 19 8 17z"/>'),
  hand: svg('<path d="M8 13V5a1.5 1.5 0 0 1 3 0v6M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11V5.5a1.5 1.5 0 0 1 3 0V14c0 4-2.5 7-6 7-2.5 0-4-1-5.5-3L3 14.5a1.5 1.5 0 0 1 2.3-1.9L8 15"/>'),
  heart: svg('<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>'),
  file: svg('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M12 11v6M9 14l3 3 3-3"/>'),
  upload: svg('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M12 18v-6M9 15l3-3 3 3"/>'),
  cloud: svg('<path d="M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z"/>'),
  check: svg('<path d="M5 12l5 5 9-10"/>'),
  charm: svg('<circle cx="12" cy="13" r="6"/><path d="M12 7V3M9 4h6M9 13h6M12 10v6"/>'),
};
const fmtTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const ago = (ms) => { const s = (Date.now() - ms) / 1000; return s < 90 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`; };
const pct = (a, b) => `${Math.max(0, Math.min(100, (a / Math.max(1, b)) * 100)).toFixed(1)}%`;

export function createClient(opts) {
  // opts: { pid, isHost, local, send(d) -> bool, name(id) }
  const st = {
    pid: opts.pid, ready: false, joining: false, me: null, w: { open: {}, roster: [], boss: null, raid: null },
    body: null, prev: { x: 0, y: 0 }, vis: { x: 0, y: 0 }, history: [], seq: 0, buf: [], acc: 0, last: 0,
    frames: [], offset: null, cam: { x: 64 * T, y: 69.5 * T }, nodes: {}, dlg: null, dlgLine: 0, panel: null, tab: 'team', ui: null,
    picker: { state: cloudAvailable() ? 'checking' : 'choose', cloud: null, error: '', look: { skin: 0, hair: 0 } },
    acct: { mode: 'signin', name: '', error: '', busy: false }, acctOpen: false,
    cloudRev: 0, cloudName: '', fromCloud: false, replaceOk: false, save: null, snapWait: null,
    keys: new Set(), bits: 0, joy: null, holdAttack: null, banners: [], bannerEl: null, zone: '', zonesSeen: new Set(),
    downAt: 0, ending: false, leave: null, boss: null, bossHp: 0, hudCache: {}, spectator: false,
  };
  let root = null, view = null, raf = 0, ctx = null, resizeObs = null, disposed = false;
  const nowSec = () => performance.now() / 1000;
  const serverNow = () => nowSec() + (st.offset ?? 0);
  const open = () => st.w.open || {};
  // Unsaved: what the host last said, or, exactly right now, standing away from where the save was made.
  const movedSinceSave = () => {
    if (st.downT > 0) return false; // knocked out: a reload puts you in the village, which the host already counts
    const s = st.me?.savedLoc, b = st.body;
    return !!s && !!b && ((b.x >= 128 * T) !== (s.x >= 128 * T) || Math.hypot(b.x - s.x, b.y - s.y) > 64);
  };
  const isUnsaved = () => !!st.me && (st.me.unsaved || movedSinceSave());
  const unsavedText = () => (st.me?.unsaved && st.me.unsavedWhy === 'progress' ? 'You have progress that isn’t saved yet.' : 'You’ve moved since your last save; saving keeps where you are now.');

  /* ---------------- messages from the host ---------------- */
  function receive(msg) {
    if (disposed || !msg) return;
    if (msg.k === 'f') onFrame(msg);
    else if (msg.k === 'me') onMe(msg);
    else if (msg.k === 'w') { st.w = msg; paintHud(); }
    else if (msg.k === 'ev') for (const e of msg.ev) onEvent(e);
  }
  function onFrame(msg) {
    const n = nowSec();
    const sample = msg.st - n;
    st.offset = st.offset == null ? sample : Math.max(sample, st.offset - 0.0008);
    const ents = new Map();
    for (const e of msg.e) ents.set(e[0] + e[1], e);
    st.frames.push({ st: msg.st, ents });
    while (st.frames.length > 12) st.frames.shift();
    reconcile(msg);
    if (msg.ev) for (const e of msg.ev) onEvent(e);
    st.lastFrame = n;
  }
  function reconcile(msg) {
    const m = msg.me;
    st.hp = m[12]; st.max = m[13]; st.chan = m[15]; st.downT = m[16]; st.shield = m[17];
    if (!st.body) { st.body = newBody(m[0] / 10, m[1] / 10); st.prev = { x: st.body.x, y: st.body.y }; }
    const base = Object.assign(newBody(m[0] / 10, m[1] / 10), { dir: m[2], kx: m[3], ky: m[4], dT: m[5], dCd: m[6], ddx: m[7], ddy: m[8], sT: m[9], sCd: m[10], down: m[11], mul: st.body.mul });
    st.history = st.history.filter((h) => h[0] > msg.ack);
    for (const h of st.history) stepBody(base, h[1], open());
    const dx = st.body.x - base.x, dy = st.body.y - base.y;
    if (Math.hypot(dx, dy) > 140) { st.vis.x = st.vis.y = 0; st.prev = { x: base.x, y: base.y }; }
    else { st.vis.x += dx; st.vis.y += dy; st.prev.x -= dx; st.prev.y -= dy; }
    base.moving = st.body.moving;
    st.body = base;
  }
  function onMe(msg) {
    const first = !st.me;
    st.me = msg;
    st.body && (st.body.mul = msg.equip?.charm === 'feather' ? 1.12 : 1);
    const base = serverNow();
    st.nodes = Object.fromEntries(Object.entries(msg.nodes || {}).map(([id, left]) => [id, base + left]));
    if (first) paintPanel();
    paintHud();
    if (st.panel) paintPanel(true);
  }
  function onEvent(e) {
    const [k] = e;
    const now = nowSec();
    switch (k) {
      case 'toast': toast(e[1], 'info'); break;
      case 'banner': banner(e[1], e[2]); sound('chime'); break;
      case 'dlg': openDialog(e[1]); break;
      case 'snap': if (st.snapWait) { const w = st.snapWait; st.snapWait = null; w(e[1], e[2], e[3]); } break;
      case 'saved': if (st.ackWait?.snap === e[1]) { const w = st.ackWait; st.ackWait = null; w.resolve(!!e[2]); } break;
      case 'ready': st.ready = true; st.joining = false; paintOverlay(); paintHud(); break;
      case 'warp': if (st.body) { st.body.x = e[1]; st.body.y = e[2]; } else st.body = newBody(e[1], e[2]); st.prev = { x: e[1], y: e[2] }; st.vis = { x: 0, y: 0 }; st.history = []; st.cam = { x: e[1], y: e[2] - 20 }; break;
      case 'down': st.downAt = now; paintOverlay(); sound('bad'); break;
      case 'lvl': banner(e[1] === 'you' ? `Level ${e[3]}!` : `${e[2]} reached level ${e[3]}!`, e[1] === 'you' ? 'You feel stronger' : 'Your companion grew stronger'); sound('win'); break;
      case 'boss': { const b = BOSSES[e[1]]; banner(b.name, b.title, true); sound('turn'); break; }
      case 'ending': st.ending = true; paintOverlay(); sound('win'); break;
      case 'ui': openUi(e[1]); break;
      case 'got': break;
      case 'gather': sound('coin'); break;
      case 'chest': sound('gem'); break;
      case 'chan': break;
      default:
        view?.addEffect(e, now);
        if (k === 'catch') sound(e[2] ? 'win' : 'bad');
        else if (k === 'hit' && e[5] === 'p') sound('card');
        else if (k === 'throw') sound('flip');
        else if (k === 'abil' && (e[1] === 'bolt')) view?.lightning();
    }
  }

  /* ---------------- sending ---------------- */
  const send = (d) => opts.send(d);
  const cmd = (c, extra = {}) => { if (!send({ k: 'cmd', c, ...extra })) toast('Not connected to the host right now.'); };

  /* ---------------- input ---------------- */
  const KEYMAP = { KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right' };
  const ACTKEYS = { KeyJ: BITS.attack, Space: BITS.attack, KeyK: BITS.dodge, ShiftLeft: BITS.dodge, ShiftRight: BITS.dodge, KeyL: BITS.ability, KeyQ: BITS.ability, KeyE: BITS.interact, Enter: BITS.interact, KeyC: BITS.catch };
  function typing(e) { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); }
  const modalOpen = () => !!document.querySelector('.modal-bg');
  function onKey(e) {
    if (!root?.isConnected) return;
    const down = e.type === 'keydown';
    // Letting go of a key always counts, even inside a dialog, so nothing stays held behind it.
    if (!down && KEYMAP[e.code]) { st.keys.delete(KEYMAP[e.code]); return; }
    if (typing(e) || modalOpen()) return;
    if (KEYMAP[e.code]) { st.keys.add(KEYMAP[e.code]); e.preventDefault(); return; }
    if (!down) return;
    if (e.code === 'Escape') { if (st.leave) return closeLeave(); if (st.dlg) return closeDialog(); if (st.ui) return closeUi(); if (st.panel) return togglePanel(null); return; }
    // Enter and Space on a focused button press that button, not the game.
    if ((e.code === 'Enter' || e.code === 'Space') && e.target?.closest?.('button, a, label')) return;
    if (st.dlg && (e.code === 'KeyE' || e.code === 'Enter' || e.code === 'Space')) { e.preventDefault(); return advanceDialog(); }
    if (e.code === 'KeyB' || e.code === 'KeyI') { e.preventDefault(); return togglePanel(st.panel ? null : 'team'); }
    if (e.code === 'KeyM') return togglePanel(st.panel === 'map' ? null : 'map');
    if (/^Digit[1-3]$/.test(e.code) && st.me) { const m = st.me.team[+e.code.slice(5) - 1]; if (m && !m.out) cmd('active', { uid: m.uid }); return; }
    if (ACTKEYS[e.code]) { st.bits |= ACTKEYS[e.code]; e.preventDefault(); }
  }
  function sampleInput() {
    // A window over the game (How to play, the site's dialogs) stops your explorer and lets go of keys.
    if (modalOpen()) { st.keys.clear(); st.bits = 0; if (st.joy) st.joy.dx = st.joy.dy = 0; return [0, 0, 0]; }
    let dx = 0, dy = 0;
    if (st.joy?.on) { dx = st.joy.dx; dy = st.joy.dy; }
    else {
      if (st.keys.has('left')) dx -= 100;
      if (st.keys.has('right')) dx += 100;
      if (st.keys.has('up')) dy -= 100;
      if (st.keys.has('down')) dy += 100;
      if (dx && dy) { dx *= 0.7071; dy *= 0.7071; }
    }
    if (st.dlg || st.leave || st.ui || st.acctOpen) { dx = 0; dy = 0; st.bits = 0; }
    const bits = st.bits;
    st.bits = 0;
    return [Math.round(dx), Math.round(dy), bits];
  }

  /* ---------------- the loop ---------------- */
  function loop() {
    raf = 0;
    if (disposed || !root?.isConnected) return stop();
    const n = nowSec();
    const dt = Math.min(0.25, n - (st.last || n));
    st.last = n;
    if (st.ready && st.body) {
      st.acc += dt;
      let steps = 0;
      while (st.acc >= TICK && steps++ < 5) {
        st.acc -= TICK;
        const inp = sampleInput();
        st.prev = { x: st.body.x, y: st.body.y };
        stepBody(st.body, inp, open());
        if (st.body.swung) sound('place');
        if (st.body.moving && Math.random() < 0.18) view.dust(st.body.x, st.body.y, n, zoneAt(st.body.x, st.body.y) === 'marsh' ? 'rgba(120,160,170,.6)' : undefined);
        st.history.push([st.seq, inp]);
        st.buf.push(inp);
        st.seq++;
        if (st.history.length > 80) st.history.shift();
        if (opts.local || st.buf.length >= 2) {
          send({ k: 'in', s: st.seq - st.buf.length, i: st.buf });
          st.buf = [];
        }
      }
      if (st.acc > TICK) st.acc = 0;
    }
    st.vis.x *= 0.82; st.vis.y *= 0.82;
    const a = Math.min(1, st.acc / TICK);
    const me = st.body ? { kind: 'p', mine: true, id: st.pid, x: st.prev.x + (st.body.x - st.prev.x) * a + st.vis.x, y: st.prev.y + (st.body.y - st.prev.y) * a + st.vis.y } : null;
    // The camera eases after you, leaning a little ahead of where you walk.
    if (me) {
      const lead = st.body.moving ? 26 : 0, f = [[0, 1], [0, -1], [-1, 0], [1, 0]][st.body.dir];
      const tx = me.x + f[0] * lead, ty = me.y - 20 + f[1] * lead;
      st.cam.x += (tx - st.cam.x) * Math.min(1, dt * 7); st.cam.y += (ty - st.cam.y) * Math.min(1, dt * 7);
    }
    // One bad frame must not stop the island: report it once and keep going.
    try { drawScene(n, me); paintContext(me); paintBoss(); }
    catch (e) { if (!st.drawError) { st.drawError = true; console.error(e); } }
    raf = requestAnimationFrame(loop);
  }
  function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; }

  function interpolated() {
    const rt = serverNow() - (opts.local ? 0.055 : 0.11);
    const fr = st.frames;
    if (!fr.length) return { list: [], shots: [], zones: [] };
    let i = fr.length - 1;
    while (i > 0 && fr[i - 1].st > rt) i--;
    const f1 = fr[i], f0 = i > 0 ? fr[i - 1] : f1;
    const span = f1.st - f0.st;
    const a = span > 0 ? Math.max(0, Math.min(1, (rt - f0.st) / span)) : 1;
    const roster = new Map((st.w.roster || []).map((r) => [r.id, r]));
    const list = [], shots = [], zones = [];
    for (const [key, e] of f1.ents) {
      const o = f0.ents.get(key) || e;
      if (e[0] === 'x') { const dtv = Math.max(0, Math.min(0.25, rt - f1.st)); shots.push({ kind: e[2], x: e[3] + e[5] * dtv, y: e[4] + e[6] * dtv, vx: e[5], vy: e[6] }); continue; }
      if (e[0] === 'z') { zones.push({ kind: e[2], x: e[3], y: e[4], r: e[5] }); continue; }
      if (e[0] === 'p') {
        const r = roster.get(e[1]);
        list.push({ kind: 'p', id: e[1], x: o[2] + (e[2] - o[2]) * a, y: o[3] + (e[3] - o[3]) * a, dir: e[4], anim: e[5], hp: e[6], seat: e[7], flags: e[8], name: r?.name || '', look: r?.look, seed: e[1].length });
      } else if (e[0] === 'c') {
        list.push({ kind: 'c', id: e[1], sp: e[2], x: o[3] + (e[3] - o[3]) * a, y: o[4] + (e[4] - o[4]) * a, dir: e[5], anim: e[6], hp: e[7], lv: e[8], flags: e[9], seat: e[10] });
      } else if (e[0] === 'b') {
        list.push({ kind: 'b', id: e[1], boss: e[2], x: o[3] + (e[3] - o[3]) * a, y: o[4] + (e[4] - o[4]) * a, anim: e[5], hp: e[6] / 10, flip: e[7] });
      }
    }
    return { list, shots, zones };
  }

  function drawScene(n, me) {
    if (!view) return;
    const { list, shots, zones } = interpolated();
    const b = st.body;
    if (me && b) {
      me.dir = b.dir; me.seat = st.me?.seat ?? 0; me.look = st.me?.look; me.flags = (st.downT > 0 ? 0 : 0) | (st.shield > 0 ? 4 : 0);
      me.anim = st.downT > 0 ? 5 : b.dT > 0 ? 3 : b.sT > 0 ? 2 : b.moving ? 1 : 0;
      me.sT = b.sT; me.hp = st.max ? (st.hp / st.max) * 100 : 100;
    }
    const camZone = zoneAt(st.cam.x, st.cam.y);
    const q = st.me?.quests || {};
    const npcs = {};
    for (const [id, nn] of Object.entries(NPCS)) npcs[id] = { x: nn.at[0] * T, y: nn.at[1] * T, dir: nn.dir, mark: npcMark(id) };
    const lights = [];
    if (st.cam.x > 128 * T) {
      const m = island(), cx = Math.floor(st.cam.x / T / 8), cy = Math.floor(st.cam.y / T / 8);
      for (let j = cy - 2; j <= cy + 2; j++) for (let i = cx - 3; i <= cx + 3; i++) for (const p of m.chunks.get(i + ',' + j) || []) if (p.k === 'cavecrystal' || (p.k === 'crystal' && !((st.nodes[p.node] || 0) > serverNow()))) lights.push(p);
    }
    const arrows = [];
    if (me) {
      for (const e of st.w.roster || []) {
        if (e.id === st.pid || !e.ready) continue;
        const ent = list.find((x) => x.kind === 'p' && x.id === e.id);
        if (ent) arrows.push({ x: ent.x, y: ent.y, color: SEATS[e.seat]?.color || '#fff', shape: SEATS[e.seat]?.shape });
      }
      const obj = st.me && objective(st.me);
      if (obj?.at && Math.abs(obj.at[0] - me.x) + Math.abs(obj.at[1] - me.y) > 200 && (obj.at[0] >= 128 * T) === (me.x >= 128 * T)) arrows.push({ x: obj.at[0], y: obj.at[1], color: '#ffd43b', star: true });
    }
    view.draw({
      now: n, cam: st.cam, me: st.ready ? me : null, myId: st.pid, ents: list, shots, zones, npcs,
      open: open(), nodes: st.nodes, chests: st.me?.chests || [], champion: (st.me?.flags || []).includes('champion'),
      tracks: q.tracks === 1 || q.tracks === 2 ? TRACKS : null, cave: st.cam.x > 128 * T, storm: camZone === 'peak' && !(st.me?.flags || []).includes('tempestra') && !list.some((e) => e.kind === 'b' && e.anim === 5),
      zoneAt, lights, arrows,
    });
    const boss = list.find((e) => e.kind === 'b');
    st.boss = boss || null;
    // Area names, the first time you walk into each one.
    if (me) {
      const z = zoneAt(me.x, me.y);
      if (z !== st.zone) { st.zone = z; if (z && z !== 'none' && z !== 'cliffs' && !st.zonesSeen.has(z)) { st.zonesSeen.add(z); banner(areaName(z), '', false, true); } }
    }
  }
  function npcMark(id) {
    const me = st.me;
    if (!me) return '';
    const q = me.quests, f = me.flags;
    const want = {
      elder: q.starter !== 9 || (f.includes('quartzhulk') && !q.defend) || (f.includes('raid') && !q.peak) || (q.collector === 1 && me.dex.caught.length >= 6) || (!q.collector && q.starter === 9),
      healer: q.supplies === 2 || q.lost === 2 || (!q.supplies && q.starter === 9),
      kid: q.starter === 9 && (!q.lost || (q.lost === 9 && !q.tracks)),
      ranger: q.starter === 9 && ((!q.bridge && !f.includes('bridge')) || q.bridge === 2 || (f.includes('mirebrute') && !q.cave)),
      fisher: f.includes('bridge') && ((!q.marsh && !f.includes('mirebrute')) || !q.fishing || (q.fishing === 1 && me.team.concat(me.ranch).some((m) => m.sp === 'ripplefin'))),
      merchant: false,
    }[id];
    return want ? '!' : '';
  }

  /* ---------------- HUD ---------------- */
  function el(sel) { return root?.querySelector(sel); }
  function setText(sel, text) { const e = el(sel); if (e && e.textContent !== text) e.textContent = text; }
  function setStyle(sel, prop, v) { const e = el(sel); if (e && e.style[prop] !== v) e.style[prop] = v; }
  function paintHud() {
    if (!root) return;
    const me = st.me;
    const hud = el('.isl-hud');
    hud.hidden = !st.ready || !me;
    if (!me || !st.ready) return;
    const art = view.art();
    const seat = SEATS[me.seat] || SEATS[0];
    const card = el('.isl-me');
    card.style.setProperty('--seat', seat.color);
    setText('.isl-me-name', me.name);
    setText('.isl-me-lv', `Lv ${me.lv}`);
    const hp = st.hp ?? me.hp, max = st.max ?? me.max;
    setStyle('.isl-me-hp i', 'width', pct(hp, max));
    setText('.isl-me-hpt', `${Math.max(0, Math.round(hp))}/${max}`);
    setStyle('.isl-me-xp i', 'width', pct(me.xp, me.next));
    const comp = me.team.find((m) => m.out) || null;
    const ce = el('.isl-comp');
    ce.hidden = !me.team.length;
    if (comp) {
      const key = comp.sp;
      if (st.hudCache.comp !== key) { st.hudCache.comp = key; el('.isl-comp-face').src = art.icon('sp:' + comp.sp, 44); }
      setText('.isl-comp-name', `${SPECIES[comp.sp].name} · Lv ${comp.lv}`);
      setStyle('.isl-comp-hp i', 'width', pct(comp.hp, comp.max));
      ce.classList.remove('fainted');
    } else if (me.team.length) { setText('.isl-comp-name', 'Companion resting'); ce.classList.add('fainted'); setStyle('.isl-comp-hp i', 'width', '0%'); }
    // The goal.
    const obj = objective(me);
    setText('.isl-quest b', obj.name);
    setText('.isl-quest span', obj.text);
    // Friends: where they are, and whether they're in trouble.
    const fr = (st.w.roster || []).filter((r) => r.id !== st.pid);
    const key = JSON.stringify(fr.map((r) => [r.id, r.name, r.seat, r.ready, r.connected, r.zone, r.down, r.lv]));
    if (st.hudCache.friends !== key) {
      st.hudCache.friends = key;
      el('.isl-friends').innerHTML = fr.map((r) => `<div class="isl-friend ${r.down ? 'down' : ''} ${r.connected ? '' : 'away'}" style="--seat:${SEATS[r.seat]?.color}">${shapeSvg(SEATS[r.seat]?.shape)}<span><b>${esc(r.name)}</b><small>${!r.connected ? 'reconnecting…' : !r.ready ? 'choosing an explorer' : r.down ? 'knocked out!' : esc(areaName(r.zone) || '')}${r.ready ? ` · Lv ${r.lv}` : ''}</small></span></div>`).join('');
    }
    const raid = st.w.raid;
    const re = el('.isl-raid');
    re.hidden = !raid;
    if (raid) setText('.isl-raid', raid.wave ? `Murkling raid · wave ${raid.wave} of 3 · ${raid.left} left` : 'Murklings are coming!');
    el('.isl-bagbtn').classList.toggle('unsaved', isUnsaved());
    paintOverlay();
  }
  function paintBoss() {
    const be = el('.isl-boss');
    if (!be) return;
    const b = st.boss;
    // Only near the fight: a boss across the map isn't your problem yet.
    const near = b && st.body && Math.hypot(b.x - st.body.x, b.y - st.body.y) < 640;
    be.hidden = !near || b.anim === 5;
    if (!near) return;
    if (!b) return;
    const def = BOSSES[b.boss];
    if (st.hudCache.boss !== b.boss) { st.hudCache.boss = b.boss; be.querySelector('b').textContent = def.name; be.querySelector('small').textContent = def.title; }
    const w = pct(b.hp, 100);
    const bar = be.querySelector('i');
    if (bar.style.width !== w) bar.style.width = w;
  }
  // The context buttons: talk, gather, open, revive, befriend.
  function paintContext(me) {
    if (!root || !st.ready || !me || !st.me) return;
    const sn = serverNow();
    let label = '', kind = '';
    const friend = (st.frames[st.frames.length - 1] ? [...st.frames[st.frames.length - 1].ents.values()] : []).find((e) => e[0] === 'p' && e[5] === 5 && Math.hypot(e[2] - me.x, e[3] - me.y) < 64);
    const lost = (st.frames[st.frames.length - 1] ? [...st.frames[st.frames.length - 1].ents.values()] : []).find((e) => e[0] === 'c' && e[9] & 16 && Math.hypot(e[3] - me.x, e[4] - me.y) < 70);
    if (friend) { label = 'Revive'; kind = 'heart'; }
    else if (lost) { label = 'Help it'; kind = 'heart'; }
    else {
      const it = interactables(me.x, me.y, st.me, sn, st.nodes)[0];
      if (it) { label = it.label; kind = it.npc ? 'talk' : 'hand'; }
    }
    if (st.downT > 0) label = '';
    let catchLabel = '';
    if ((st.me.inv.charm || 0) > 0 && st.downT <= 0) {
      const weak = (st.frames[st.frames.length - 1] ? [...st.frames[st.frames.length - 1].ents.values()] : []).filter((e) => e[0] === 'c' && e[9] & 1 && !(e[9] & 2) && !(e[9] & 4) && Math.hypot(e[3] - me.x, e[4] - me.y) < 150);
      if (weak.length) { const e = weak[0]; catchLabel = `${Math.round(Math.max(0.1, Math.min(0.95, (SPECIES[e[2]]?.catch || 0) + (CATCH_HP - e[7] / 100) * 1.2)) * 100)}%`; }
    }
    const key = label + '|' + catchLabel;
    if (st.hudCache.ctx === key) return;
    st.hudCache.ctx = key;
    const act = el('.isl-act'), cat = el('.isl-catch');
    act.hidden = !label; cat.hidden = !catchLabel;
    if (label) act.innerHTML = `${kind === 'heart' ? IC.heart : kind === 'talk' ? IC.quest : IC.hand}<span>${esc(label)}</span>`;
    if (catchLabel) cat.innerHTML = `${IC.charm}<span>Befriend<small>${catchLabel}</small></span>`;
    const hint = el('.isl-keyhint');
    if (hint) hint.innerHTML = `${label ? `<kbd>E</kbd> ${esc(label)}` : '<kbd>E</kbd> talk / gather'}${catchLabel ? ` · <kbd>C</kbd> befriend ${catchLabel}` : ''}`;
  }
  const shapeSvg = (shape) => {
    const p = { circle: '<circle cx="8" cy="8" r="6"/>', triangle: '<path d="M8 1.8l6.5 11.4h-13z"/>', square: '<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/>', diamond: '<path d="M8 1l7 7-7 7-7-7z"/>' }[shape] || '';
    return `<svg class="isl-shape" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor" stroke="rgba(0,0,0,.35)">${p}</svg>`;
  };
  function banner(title, sub = '', big = false, area = false) {
    // A new place name replaces one that's waiting or showing: only where you are now matters.
    if (area) {
      st.banners = st.banners.filter((b) => !b.area);
      if (st.bannerEl?.area) { st.banners.unshift({ title, sub, big, area }); clearTimeout(st.bannerTimer); return nextBanner(); }
    }
    st.banners.push({ title, sub, big, area });
    if (!st.bannerEl) nextBanner();
  }
  function nextBanner() {
    const b = st.banners.shift();
    const be = el('.isl-banner');
    if (!b || !be) { st.bannerEl = null; if (be) be.hidden = true; return; }
    st.bannerEl = b;
    be.hidden = false;
    be.className = 'isl-banner' + (b.big ? ' big' : '') + (b.area ? ' area' : '');
    be.innerHTML = `<b>${esc(b.title)}</b>${b.sub ? `<span>${esc(b.sub)}</span>` : ''}`;
    be.style.animation = 'none'; void be.offsetWidth; be.style.animation = '';
    st.bannerTimer = setTimeout(nextBanner, b.area ? 2200 : 2600);
  }

  /* ---------------- conversations ---------------- */
  function openDialog(d) {
    st.dlg = d; st.dlgLine = 0;
    paintDialog();
    sound('click');
  }
  function paintDialog() {
    const box = el('.isl-dialog');
    if (!box) return;
    const d = st.dlg;
    box.hidden = !d;
    if (!d) return;
    const last = st.dlgLine >= d.lines.length - 1;
    const art = view.art();
    box.innerHTML = `
      <div class="isl-dlg-head">${d.npc ? `<img alt="" src="${art.icon('npc:' + d.npc, 40)}">` : ''}<b>${esc(d.title || '')}</b><button class="icon-btn isl-x" data-dlg="close" aria-label="Close">${IC.close}</button></div>
      <p>${esc(d.lines[st.dlgLine] || '')}</p>
      <div class="isl-dlg-acts">${last ? d.choices.map((c) => `<button class="${STARTERS.includes(c.id) ? 'isl-starter' : 'primary'}" data-choice="${esc(c.id)}">${STARTERS.includes(c.id) ? `<img alt="" src="${art.icon('sp:' + c.id, 44)}">` : ''}<span>${esc(c.label)}</span></button>`).join('') || `<button data-dlg="close">Goodbye</button>` : `<button class="primary" data-dlg="next">Next ▸</button>`}</div>`;
  }
  function advanceDialog() {
    if (!st.dlg) return;
    if (st.dlgLine < st.dlg.lines.length - 1) { st.dlgLine++; paintDialog(); }
    else if (!st.dlg.choices.length) closeDialog();
  }
  function closeDialog() {
    const ui = st.dlg?.ui;
    st.dlg = null; paintDialog();
    if (ui) openUi(ui);
  }
  function choose(id) {
    const d = st.dlg;
    if (!d) return;
    st.dlg = null; paintDialog();
    cmd('choose', { npc: d.npc, id });
  }

  /* ---------------- shop and ranch ---------------- */
  function openUi(kind) { st.ui = kind; paintUi(); }
  function closeUi() { st.ui = null; paintUi(); }
  function paintUi() {
    const box = el('.isl-ui');
    if (!box) return;
    box.hidden = !st.ui || !st.me;
    if (!st.ui || !st.me) return;
    const me = st.me, art = view.art();
    if (st.ui === 'shop') {
      const row = (id) => {
        const it = ITEMS[id] || GEAR[id], owned = GEAR[id] && me.gear.includes(id);
        const locked = id === 'bigberry' && !me.flags.includes('bridge');
        return `<li><img alt="" src="${art.icon(id, 36)}"><span><b>${esc(it.name)}</b><small>${esc(it.desc)}</small></span><button class="small ${owned || locked ? '' : 'primary'}" data-buy="${id}" ${owned || locked || me.shells < it.price ? 'disabled' : ''}>${owned ? 'Owned' : locked ? 'Soon' : `${it.price}<img class="isl-coin" alt=" shells" src="${art.icon("shells", 16)}">`}</button></li>`;
      };
      const sells = ['mushroom', 'crystal'].filter((k) => me.inv[k] > 0);
      box.innerHTML = `<div class="isl-ui-head"><b>Toma’s Goods</b><span class="isl-shells">${me.shells} shells</span><button class="icon-btn isl-x" data-ui="close" aria-label="Close">${IC.close}</button></div>
        <ul class="isl-list">${SHOP.map(row).join('')}</ul>
        ${sells.length ? `<h4>Sell</h4><ul class="isl-list">${sells.map((k) => `<li><img alt="" src="${art.icon(k, 36)}"><span><b>${esc(ITEMS[k].name)} ×${me.inv[k]}</b><small>${ITEMS[k].sell} shells each</small></span><button class="small" data-sell="${k}">Sell one</button></li>`).join('')}</ul>` : ''}`;
    } else if (st.ui === 'ranch') {
      const mon = (m, where) => `<li><img alt="" src="${art.icon('sp:' + m.sp, 36)}"><span><b>${esc(SPECIES[m.sp].name)}</b><small>Lv ${m.lv} · ${ELEMENTS[SPECIES[m.sp].el].name}</small></span>${where === 'team'
        ? `<button class="small" data-ranch="deposit" data-uid="${m.uid}" ${me.team.length <= 1 ? 'disabled' : ''}>Leave here</button>`
        : `<button class="small primary" data-ranch="withdraw" data-uid="${m.uid}" ${me.team.length >= TEAM_MAX ? 'disabled' : ''}>Take along</button><button class="small ghost" data-release="${m.uid}" title="Let it go back to the wild">Release</button>`}</li>`;
      box.innerHTML = `<div class="isl-ui-head"><b>Creature Ranch</b><span class="isl-shells">${me.team.length}/${TEAM_MAX} with you</span><button class="icon-btn isl-x" data-ui="close" aria-label="Close">${IC.close}</button></div>
        <h4>With you</h4><ul class="isl-list">${me.team.map((m) => mon(m, 'team')).join('')}</ul>
        <h4>Resting at the ranch</h4>${me.ranch.length ? `<ul class="isl-list">${me.ranch.map((m) => mon(m, 'ranch')).join('')}</ul>` : '<p class="small muted">Creatures you befriend when your team is full come here.</p>'}`;
    }
  }

  /* ---------------- the bag menu ---------------- */
  function togglePanel(tab) {
    st.panel = tab;
    if (tab) st.tab = tab;
    paintPanel();
    sound('click');
  }
  function paintPanel(soft = false) {
    const box = el('.isl-panel');
    if (!box) return;
    box.hidden = !st.panel || !st.me;
    if (!st.panel || !st.me) return;
    if (soft && box.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
    const me = st.me, art = view.art(), tab = st.tab;
    const tabs = [['team', IC.team, 'Team'], ['bag', IC.bag, 'Bag'], ['quests', IC.quest, 'Quests'], ['guide', IC.guide, 'Guide'], ['map', IC.map, 'Map'], ['save', IC.save, 'Save']];
    let body = '';
    if (tab === 'team') {
      body = me.team.length ? `<ul class="isl-cards">${me.team.map((m) => {
        const sp = SPECIES[m.sp], ab = ABILITIES[sp.ability];
        return `<li class="${m.out ? 'out' : ''} ${m.hp <= 0 ? 'fainted' : ''}"><img alt="" src="${art.icon('sp:' + m.sp, 56)}">
          <div class="grow"><b>${esc(sp.name)} <small>Lv ${m.lv}</small> <span class="isl-el" style="--el:${ELEMENTS[sp.el].color}">${esc(ELEMENTS[sp.el].name)}</span></b>
            <div class="isl-bar hp"><i style="width:${pct(m.hp, m.max)}"></i></div><small>${m.hp}/${m.max} HP · ${m.xp}/${m.next} XP</small>
            <small class="muted">${esc(ab.name)}: ${esc(ab.desc)}</small>
            <div class="isl-row">${m.out ? '<span class="tag t-good">With you</span>' : `<button class="small" data-active="${m.uid}" ${m.hp <= 0 ? 'disabled' : ''}>Bring out</button>`}
              ${m.hp <= 0 ? `<button class="small" data-use="seed" data-on="${m.uid}" ${me.inv.seed ? '' : 'disabled'}>Revive Seed (${me.inv.seed || 0})</button>` : ['sunberry', 'bigberry'].filter((k) => me.inv[k]).map((k) => `<button class="small" data-use="${k}" data-on="${m.uid}" ${m.hp >= m.max ? 'disabled' : ''}>${esc(ITEMS[k].name)} (${me.inv[k]})</button>`).join('')}</div></div></li>`;
      }).join('')}</ul><p class="small muted">Up to ${TEAM_MAX} travel with you; any others wait at the ranch in the village. Keys 1–3 switch.</p>`
        : '<p class="muted">Talk to Elder Maru in the village to choose your first companion.</p>';
    } else if (tab === 'bag') {
      const items = Object.entries(me.inv).filter(([, n]) => n > 0);
      body = `<p class="isl-shells">${me.shells} shells</p>
        <ul class="isl-list">${items.map(([k, n]) => `<li><img alt="" src="${art.icon(k, 36)}"><span><b>${esc(ITEMS[k].name)} ×${n}</b><small>${esc(ITEMS[k].desc)}</small></span>${ITEMS[k].use === 'heal' ? `<button class="small" data-use="${k}" data-on="me" ${(st.hp ?? me.hp) >= me.max ? 'disabled' : ''}>Use on you</button>` : ''}</li>`).join('') || '<li class="muted">Empty</li>'}</ul>
        <h4>Gear</h4><ul class="isl-list">${me.gear.map((gid) => { const gr = GEAR[gid], on = me.equip.weapon === gid || me.equip.charm === gid; return `<li><img alt="" src="${art.icon(gid, 36)}"><span><b>${esc(gr.name)}</b><small>${esc(gr.desc)}${gr.dmg ? ` · ${gr.dmg} damage` : ''}</small></span><button class="small ${on ? 'good' : ''}" data-equip="${gid}" ${on && gr.kind === 'weapon' ? 'disabled' : ''}>${on ? (gr.kind === 'weapon' ? 'Equipped' : 'Take off') : 'Equip'}</button></li>`; }).join('')}</ul>`;
    } else if (tab === 'quests') {
      const active = QUEST_ORDER.filter((q) => me.quests[q] && me.quests[q] !== 9), done = QUEST_ORDER.filter((q) => me.quests[q] === 9);
      body = `<ul class="isl-quests">${active.map((q) => `<li class="${QUESTS[q].main ? 'main' : ''}"><b>${esc(QUESTS[q].name)}</b><small>${esc(QUESTS[q].steps[me.quests[q]] || '')}</small></li>`).join('') || `<li><b>${esc(objective(me).name)}</b><small>${esc(objective(me).text)}</small></li>`}</ul>
        ${done.length ? `<h4>Done</h4><ul class="isl-quests done">${done.map((q) => `<li><b>${IC.check}${esc(QUESTS[q].name)}</b></li>`).join('')}</ul>` : ''}
        <p class="small muted">Played ${Math.floor(me.time / 3600)} h ${Math.floor((me.time % 3600) / 60)} min.</p>`;
    } else if (tab === 'guide') {
      body = `<p class="small muted">${me.dex.caught.length} befriended · ${me.dex.seen.length} seen of ${Object.keys(SPECIES).length}</p><ul class="isl-dex">${Object.keys(SPECIES).map((sp) => {
        const seen = me.dex.seen.includes(sp), caught = me.dex.caught.includes(sp);
        return `<li class="${caught ? 'caught' : seen ? 'seen' : ''}"><img alt="" src="${art.icon('sp:' + sp, 48)}" ${seen ? '' : 'style="filter:brightness(0) opacity(.35)"'}><b>${seen ? esc(SPECIES[sp].name) : '???'}</b><small>${caught ? esc(SPECIES[sp].blurb) : seen ? 'Seen, not yet befriended' : 'Not seen yet'}</small></li>`;
      }).join('')}</ul>`;
    } else if (tab === 'map') {
      body = `<div class="isl-map"><canvas></canvas></div><p class="small muted">${IC.quest} your goal · shapes are your friends</p>`;
    } else if (tab === 'save') body = saveHTML();
    // Kept nodes (morph): the panel refreshes as health and items change without losing your place.
    if (soft && tab === 'map') return drawMap(box.querySelector('canvas'));
    morph(box, `<div class="isl-tabs" role="tablist">${tabs.map(([id, ic, label]) => `<button role="tab" aria-selected="${id === tab}" data-tab="${id}" title="${label}">${ic}<span>${label}</span>${id === 'save' && isUnsaved() ? '<i class="isl-dot"></i>' : ''}</button>`).join('')}<button class="icon-btn isl-x" data-panel="close" aria-label="Close">${IC.close}</button></div><div class="isl-panel-body" data-tab="${tab}">${body}</div>`);
    if (tab === 'map') drawMap(box.querySelector('canvas'));
  }
  let mapBase = null;
  function drawMap(c) {
    mapBase ||= minimap(2);
    const inCave = (st.body?.x || 0) >= 128 * T;
    const sx = inCave ? 128 * 2 : 0, sw = inCave ? 32 * 2 : 128 * 2, sh = 100 * 2;
    c.width = sw * 2; c.height = sh * 2;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(mapBase, sx, 0, sw, sh, 0, 0, sw * 2, sh * 2);
    const k = (2 * 2) / T;
    const dot = (x, y, col, r = 5) => { g.fillStyle = col; g.strokeStyle = '#0b1530'; g.lineWidth = 2; g.beginPath(); g.arc((x - sx * T / 2) * k, y * k, r, 0, 7); g.fill(); g.stroke(); };
    const obj = st.me && objective(st.me);
    if (obj?.at) dot(obj.at[0], obj.at[1], '#ffd43b', 6);
    for (const e of st.frames[st.frames.length - 1]?.ents.values() || []) if (e[0] === 'p') dot(e[2], e[3], SEATS[e[7]]?.color || '#fff');
    if (st.body) dot(st.body.x, st.body.y, '#ffffff', 6);
  }
  function saveHTML() {
    const me = st.me, s = st.save;
    const cloud = cloudAvailable();
    const status = s?.state === 'saving' ? `<p class="isl-save-state">${IC.cloud}<span>Saving…</span></p>`
      : s?.state === 'error' ? `<p class="isl-save-state bad">${esc(s.msg)}</p><div class="isl-row"><button class="primary" data-save="retry">Try again</button><button data-save="file">Save to a file instead</button></div>`
      : s?.state === 'conflict' ? `<p class="isl-save-state bad">${esc(s.msg)}</p><div class="isl-row"><button class="primary" data-save="force">Replace it with this explorer</button><button data-save="cancel">Cancel</button></div>`
      : s?.state === 'replace' ? `<p class="isl-save-state">Saving will replace <b>${esc(st.cloudName || 'your saved explorer')}</b> in the cloud with ${esc(me.name)}.</p><div class="isl-row"><button class="primary" data-save="replace">Replace and save</button><button data-save="cancel">Cancel</button></div>`
      : isUnsaved() ? `<p class="isl-save-state warn">${unsavedText()}</p>`
      : `<p class="isl-save-state good">${IC.check}<span>Everything is saved${me.lastSave ? ` (${fmtTime(me.lastSave)})` : ''}.</span></p>`;
    return `${status}
      ${cloud ? accountRow() : ''}
      ${!s || s.state === 'done' ? `<div class="isl-row">${cloud && account() ? `<button class="primary" data-save="cloud">${IC.cloud}Save adventure</button>` : ''}<button class="${cloud && account() ? '' : 'primary'}" data-save="file">${IC.file}Save to a file</button></div>` : ''}
      <p class="small muted">Saves keep your explorer: level, creatures, items and story. Nothing is saved until you choose to. ${cloud ? `Cloud saves belong to your explorer account (a name and a 4-digit PIN), so you can continue on any device${keyIsKept() ? '' : '. This browser can’t keep you signed in (private browsing?): save to a file too'}.` : 'Cloud saves aren’t set up on this site, so keep the file somewhere safe.'}</p>
      <p class="small muted">Friends save their own explorers from their own menus.</p>`;
  }

  /* ---------------- explorer accounts ---------------- */
  // The PIN is read from the form when it's sent and never kept.
  function accountRow() {
    const me = account();
    return me
      ? `<div class="isl-acct signed"><span>${IC.cloud}Signed in as <b>${esc(me.name)}</b></span><button class="small ghost" data-acct="signout">Sign out</button></div>`
      : `<div class="isl-acct signed"><span>Sign in to save to the cloud and continue on any device.</span><button class="small primary" data-acct="open">Sign in</button></div>`;
  }
  function accountHTML(inGame) {
    const a = st.acct, create = a.mode === 'create';
    const pin = (name, label, auto) => `<input name="${name}" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" placeholder="${label}" autocomplete="${auto}" aria-label="${label}">`;
    return `<form class="isl-acct" data-acct-form>
      <h4>${create ? 'Create your explorer account' : 'Sign in to your explorer account'}</h4>
      <p class="small muted">${create ? 'Pick a name and a 4-digit PIN. Use them on any device to continue your explorer. Remember the PIN: it can’t be reset.' : 'Your name and 4-digit PIN bring your saved explorer to any device.'}</p>
      <div class="isl-acct-fields ${create ? 'three' : ''}">
        <input name="acctName" maxlength="20" placeholder="Explorer name" autocomplete="username" autocapitalize="off" spellcheck="false" aria-label="Explorer name">
        ${pin('acctPin', create ? 'New PIN' : 'PIN', create ? 'new-password' : 'current-password')}
        ${create ? pin('acctPin2', 'Repeat PIN', 'new-password') : ''}
      </div>
      ${a.error ? `<p class="isl-save-state bad">${esc(a.error)}</p>` : ''}
      <div class="isl-row"><button class="primary" type="submit" ${a.busy ? 'disabled' : ''}>${a.busy ? 'One moment…' : create ? 'Create account' : 'Sign in'}</button>
        <button type="button" class="ghost small" data-acct="${create ? 'mode-signin' : 'mode-create'}">${create ? 'I already have an account' : 'New? Create an account'}</button>
        ${inGame ? '<button type="button" class="ghost small" data-acct="close">Not now</button>' : ''}</div>
    </form>`;
  }
  async function submitAccount(form) {
    const a = st.acct, create = a.mode === 'create';
    const name = form.acctName.value.trim(), pin = form.acctPin.value, pin2 = form.acctPin2?.value;
    a.name = name;
    a.error = name.length < 3 ? 'Enter your explorer name (at least 3 letters).' : !/^\d{4}$/.test(pin) ? 'The PIN is 4 digits.' : create && pin !== pin2 ? 'The two PINs don’t match.' : '';
    if (a.error) return repaintOverlay();
    a.busy = true; repaintOverlay();
    try {
      await (create ? signUp(name, pin) : signIn(name, pin));
      a.busy = false; a.error = ''; a.mode = 'signin';
      toast(create ? `Account created. Welcome, ${name}!` : `Signed in as ${account()?.name || name}.`, 'info');
      await afterSignIn();
    } catch (e) {
      a.busy = false;
      a.error = e.code === 'wrong' ? `That name and PIN don’t match.${e.left ? ` ${e.left} ${e.left === 1 ? 'try' : 'tries'} left before a short pause.` : ''}`
        : e.code === 'not-found' ? 'Explorer accounts aren’t available on the save service yet. Play without an account for now and save to a file.'
        : e.message || 'That didn’t work.';
    }
    repaintOverlay(); paintPanel();
  }
  async function afterSignIn() {
    if (await claimLegacy()) toast('The explorer saved in this browser is now in your account.', 'info');
    if (!st.ready) return checkCloud();
    // Signed in while playing: find out what the account holds, so saving over a different explorer asks first.
    try { const found = await loadExplorer(); st.cloudRev = found?.rev || 0; st.cloudName = found?.data?.name || ''; } catch { st.cloudRev = 0; }
    st.fromCloud = false; st.replaceOk = false; st.conflict = null;
    st.acctOpen = false; repaintOverlay(); paintPanel();
  }
  async function doSignOut() {
    await signOut();
    st.cloudRev = 0; st.cloudName = ''; st.fromCloud = false; st.replaceOk = false; st.conflict = null;
    st.picker.cloud = null;
    toast('Signed out.', 'info');
    repaintOverlay(); paintPanel();
  }
  function repaintOverlay() { const box = el('.isl-overlay'); if (box) delete box.dataset.html; paintOverlay(); }

  /* ---------------- saving ---------------- */
  function snapshot() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { st.snapWait = null; reject(new Error('The host didn’t answer. Check your connection and try again.')); }, 6000);
      st.snapWait = (prog, rec, snap) => { clearTimeout(timer); resolve({ prog, rec, snap }); };
      if (!send({ k: 'cmd', c: 'save' })) { clearTimeout(timer); st.snapWait = null; reject(new Error('Not connected to the host right now. Try again in a moment.')); }
    });
  }
  // Tells the host the save is stored; resolves to whether that save covers everything (false if the
  // world moved on during the upload, or the host didn't answer).
  function confirmSaved(snap, leaving = false) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { if (st.ackWait?.snap === snap) st.ackWait = null; resolve(false); }, 6000);
      st.ackWait = { snap, resolve: (v) => { clearTimeout(timer); resolve(v); } };
      if (!send({ k: 'cmd', c: 'saved', snap, leaving })) { clearTimeout(timer); st.ackWait = null; resolve(false); }
    });
  }
  // Resolves to { ok, upToDate }.
  async function saveCloud(force = false, { leaving = false } = {}) {
    if (st.save?.state === 'saving') return { ok: false };
    // A new explorer, or one loaded from a file, replaces the cloud save only when the player says so.
    if (!force && st.cloudRev && !st.fromCloud && !st.replaceOk) { st.save = { state: 'replace' }; paintPanel(); return { ok: false }; }
    st.save = { state: 'saving' }; paintPanel(); paintOverlay();
    try {
      const { rec, snap } = await snapshot();
      // cloudRev is the revision this explorer came from or last saved; a newer one stored from elsewhere
      // is a conflict, which only an explicit Replace (force) overwrites.
      const out = await saveExplorer(rec, st.cloudRev, force);
      st.cloudRev = out.rev; st.fromCloud = true; st.cloudName = rec.name; st.conflict = null;
      const upToDate = await confirmSaved(snap, leaving);
      st.save = null;
      toast('Adventure saved.', 'info');
      sound('chime');
      paintPanel(); paintOverlay();
      return { ok: true, upToDate };
    } catch (e) {
      if (e.code === 'conflict') {
        // Keep the newer save's details apart: this explorer's own revision doesn't change, so saving again
        // without choosing Replace conflicts again rather than quietly overwriting.
        st.conflict = { rev: e.rev, savedAt: e.savedAt };
        st.save = { state: 'conflict', msg: `${e.message}${e.savedAt ? ` (saved ${ago(e.savedAt)})` : ''} To keep that save instead, leave without saving and continue it next time.` };
      } else st.save = { state: 'error', msg: e.message || 'Saving failed.' };
      paintPanel(); paintOverlay();
      return { ok: false };
    }
  }
  async function saveFile({ leaving = false } = {}) {
    try {
      const { rec, snap } = await snapshot();
      const blob = new Blob([JSON.stringify({ kind: 'island-explorer-file', v: 1, savedAt: Date.now(), data: rec }, null, 1)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `creature-island-${(rec.name || 'explorer').replace(/[^\w-]+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      const upToDate = await confirmSaved(snap, leaving);
      st.save = null;
      toast('Saved to a file. Keep it somewhere safe.', 'info');
      paintPanel();
      return { ok: true, upToDate };
    } catch (e) { st.save = { state: 'error', msg: e.message || 'Saving failed.' }; paintPanel(); return { ok: false }; }
  }

  /* ---------------- start: continue, new or from a file ---------------- */
  async function checkCloud() {
    if (!cloudAvailable() || !account()) { st.picker.state = 'choose'; st.picker.cloud = null; return paintOverlay(); }
    st.picker.state = 'checking'; st.picker.error = ''; paintOverlay();
    try {
      if (await claimLegacy()) toast('The explorer saved in this browser is now in your account.', 'info');
      const found = await loadExplorer();
      st.picker.cloud = found;
      if (found) { st.cloudRev = found.rev; st.cloudName = found.data?.name || ''; }
    } catch (e) { st.picker.error = e.message; }
    st.picker.state = 'choose';
    paintOverlay();
  }
  function startExplorer(kind, rec = null, savedAt = 0) {
    st.joining = true; paintOverlay();
    const tag = explorerTag();
    if (kind === 'new') { st.fromCloud = false; st.replaceOk = false; send({ k: 'cmd', c: 'new', look: st.picker.look, tag }); }
    else { st.fromCloud = kind === 'cloud'; st.replaceOk = false; send({ k: 'cmd', c: 'load', rec, savedAt, tag }); }
    setTimeout(() => { if (st.joining && !st.ready) { st.joining = false; paintOverlay(); } }, 5000);
  }
  function loadFile(file) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const j = JSON.parse(String(r.result));
        const rec = j.kind === 'island-explorer-file' ? j.data : j;
        if (rec?.kind !== 'island-explorer') throw new Error();
        startExplorer('file', rec, j.savedAt || 0);
      } catch { toast('That file isn’t a Creature Island save.'); }
    };
    r.readAsText(file);
  }

  /* ---------------- overlays: picker, knocked out, leaving, the end ---------------- */
  function paintOverlay() {
    const box = el('.isl-overlay');
    if (!box) return;
    let html = '';
    if (st.leave) html = leaveHTML();
    else if (st.spectator) html = spectatorHTML();
    else if (st.ready && st.acctOpen) html = `<div class="isl-card">${accountHTML(true)}</div>`;
    else if (!st.ready) html = pickerHTML();
    else if (st.ending) html = `<div class="isl-card isl-end"><h2>The storm is calmed!</h2><p>Sunlight spills over Stormcrown Peak for the first time in weeks. The island’s creatures, and its people, will remember this.</p><p class="small muted">Keep exploring: befriend every kind and find every treasure. Remember to save.</p><div class="isl-row"><button class="primary" data-end="ok">Keep exploring</button></div></div>`;
    else if (st.downT > 0) html = `<div class="isl-down"><b>Knocked out</b><span>A friend can revive you: they stand beside you and press ${matchMedia('(pointer: coarse)').matches ? 'Revive' : 'E'}.</span><button data-respawn>Return to the village</button></div>`;
    if (box.dataset.html === html) return;
    box.dataset.html = html;
    box.innerHTML = html;
    box.hidden = !html;
    box.classList.toggle('pass', st.ready && st.downT > 0 && !st.leave && !st.ending && !st.acctOpen);
    const nameIn = box.querySelector('[name="acctName"]');
    if (nameIn) nameIn.value = st.acct.name || '';
    if (!st.ready && !st.leave) drawPreview();
  }
  function pickerHTML() {
    const p = st.picker;
    if (st.joining) return `<div class="isl-card"><h2>Creature Island</h2><p class="muted">Joining the island…</p></div>`;
    const c = p.cloud?.data;
    const skins = ['#f6d7c3', '#e2b48f', '#b9825a', '#7a4e2f'];
    return `<div class="isl-card isl-pick">
      <h2>Creature Island</h2>
      <p class="muted small">Explore together, befriend creatures, calm the storm. Your explorer is yours: it comes with you to any friend’s island.</p>
      ${cloudAvailable() ? (account() ? accountRow() : accountHTML(false)) : ''}
      ${p.state === 'checking' ? `<p class="isl-save-state">${IC.cloud}<span>Looking for your saved explorer…</span></p>` : ''}
      ${p.error ? `<p class="isl-save-state bad">${esc(p.error)}</p><div class="isl-row"><button data-pick="recheck">Try again</button></div>` : ''}
      ${c ? `<button class="isl-continue" data-pick="cloud"><img alt="" src="${view.art().icon(c.team?.[0]?.sp ? 'sp:' + c.team[0].sp : 'charm', 52)}"><span><b>Continue as ${esc(c.name || 'your explorer')}</b><small>Level ${c.lv} · ${(c.team?.length || 0) + (c.ranch?.length || 0)} creatures · ${Object.values(c.quests || {}).filter((s) => s === 9).length} quests done · saved ${ago(p.cloud.savedAt)}</small></span></button>` : ''}
      <h4>${c ? 'Or start a new explorer' : cloudAvailable() && !account() ? 'Or play without an account' : 'Your explorer'}</h4>
      <div class="isl-newx"><canvas class="isl-preview" width="96" height="120" aria-hidden="true"></canvas>
        <div class="grow"><div class="isl-swatches" role="group" aria-label="Skin">${skins.map((col, i) => `<button class="isl-sw ${p.look.skin === i ? 'on' : ''}" data-skin="${i}" style="background:${col}" aria-label="Skin ${i + 1}"></button>`).join('')}</div>
          <div class="isl-swatches" role="group" aria-label="Hair">${[0, 1, 2, 3, 4, 5].map((i) => `<button class="isl-hair ${p.look.hair === i ? 'on' : ''}" data-hair="${i}" aria-label="Hair ${i + 1}">${i + 1}</button>`).join('')}</div>
          <button class="${c ? '' : 'primary'}" data-pick="new">Start a new explorer</button></div></div>
      ${c ? '<p class="small muted">Your saved explorer stays saved unless you save a new one over it.</p>' : ''}
      <div class="isl-row"><label class="isl-file">${IC.upload}<span>Load from a file</span><input type="file" accept=".json,application/json" hidden></label></div>
      ${cloudAvailable() && !account() ? '<p class="small muted">Without an account you can save to a file, and sign in later from the bag’s Save tab.</p>' : ''}
      ${cloudAvailable() && !keyIsKept() ? '<p class="small isl-save-state warn">This browser can’t keep you signed in (private browsing?). Save to a file as well.</p>' : ''}
    </div>`;
  }
  function drawPreview() {
    const c = el('.isl-preview');
    if (!c || !view) return;
    const art = view.art(), g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    const s = art.player({ ...st.picker.look, outfit: st.me?.seat ?? seatGuess() }, 'down', 'idle', 0);
    const k = Math.min(c.width / (s.w + 8), c.height / (s.h + 8));
    g.fillStyle = 'rgba(10,20,30,.25)'; g.beginPath(); g.ellipse(c.width / 2, c.height - 12, 22, 7, 0, 0, 7); g.fill();
    g.drawImage(s.img, c.width / 2 - s.ax * k, c.height - 12 - s.ay * k, s.w * k, s.h * k);
  }
  const seatGuess = () => Math.max(0, (st.w.roster || []).findIndex((r) => r.id === st.pid) >= 0 ? (st.w.roster.find((r) => r.id === st.pid).seat) : 0);
  function spectatorHTML() {
    const free = (st.w.roster || []).length < 4;
    return `<div class="isl-card"><h2>Watching</h2><p class="muted">Creature Island is for up to four explorers at once, and every seat is taken right now.</p>${free ? '<div class="isl-row"><button class="primary" data-seat>Take the free seat</button></div>' : '<p class="small muted">You can take a seat as soon as someone leaves.</p>'}</div>`;
  }
  function leaveHTML() {
    const L = st.leave;
    const others = opts.isHost ? (st.w.roster || []).filter((r) => r.id !== st.pid && r.unsaved).map((r) => r.name) : [];
    const what = L.kind === 'leave' ? (opts.isHost ? 'Leaving closes the island for everyone.' : 'You can come back any time with your saved explorer.') : 'This ends the adventure for everyone.';
    if (L.state === 'saving') return `<div class="isl-card"><h2>Saving…</h2><p class="muted">One moment.</p></div>`;
    const mine = st.ready && isUnsaved();
    return `<div class="isl-card"><h2>${mine ? 'Save before you go?' : 'Close the island?'}</h2>
      <p>${mine ? unsavedText() + ' ' : ''}${esc(what)}</p>
      ${others.length ? `<p class="isl-save-state warn">${esc(others.join(', '))} ${others.length > 1 ? 'have' : 'has'} unsaved progress too. Give them a moment to save from their menus.</p>` : ''}
      ${L.error ? `<p class="isl-save-state bad">${esc(L.error)}</p>` : ''}
      ${mine && cloudAvailable() && st.cloudRev && !st.fromCloud ? `<p class="small muted">Saving replaces ${esc(st.cloudName || 'the explorer saved')} in the cloud.</p>` : ''}
      <div class="isl-col">${mine && L.conflict ? `<button class="primary" data-leave="force">Replace the newer save and leave</button>` : ''}${mine ? `<button class="${L.conflict ? '' : 'primary'}" data-leave="save">${L.error ? 'Try saving again' : !cloudAvailable() || !account() ? 'Save to a file and leave' : st.cloudRev && !st.fromCloud ? 'Replace and leave' : 'Save and leave'}</button><button class="bad" data-leave="go">Leave without saving</button>` : `<button class="primary" data-leave="go">${L.kind === 'leave' ? 'Leave' : 'Continue'}</button>`}<button data-leave="cancel">Cancel</button></div></div>`;
  }
  function beforeExit(kind, proceed) {
    if (!root?.isConnected) return false;
    const mine = st.ready && isUnsaved();
    const friends = opts.isHost && (st.w.roster || []).some((r) => r.id !== st.pid && r.unsaved);
    if (!mine && !friends) return false;
    st.leave = { kind, proceed, state: 'ask', error: '' };
    st.panel = null; paintPanel();
    paintOverlay();
    return true;
  }
  function closeLeave() { st.leave = null; paintOverlay(); }
  async function leaveSave(force = false) {
    const L = st.leave;
    L.state = 'saving'; L.error = ''; L.conflict = false; paintOverlay();
    // "Replace and leave" was the button the player pressed when a different explorer is in the cloud.
    if (st.cloudRev && !st.fromCloud) st.replaceOk = true;
    const r = cloudAvailable() && account() ? await saveCloud(force, { leaving: true }) : await saveFile({ leaving: true });
    if (st.leave !== L) return;
    // The world keeps running while a save uploads. Leave only once the host confirms the save has
    // everything (it then takes the explorer off the island, so nothing more can be earned or lost).
    if (r.ok && r.upToDate) { st.leave = null; paintOverlay(); L.proceed(); return; }
    L.state = 'ask';
    L.conflict = st.save?.state === 'conflict';
    L.error = r.ok ? 'Something changed while that was saving, so the save doesn’t have everything yet. Save again, or leave without saving.' : st.save?.msg || 'Saving failed.';
    st.save = null;
    paintOverlay();
  }

  /* ---------------- mounting ---------------- */
  function mount(box, c) {
    ctx = c;
    if (root?.isConnected && box.contains(root)) { update(c); return; }
    disposed = false;
    box.innerHTML = `<div class="isl-root">
      <canvas class="isl-canvas"></canvas>
      <div class="isl-hud" hidden>
        <div class="isl-me"><div class="isl-me-top"><b class="isl-me-name"></b><span class="isl-me-lv"></span></div><div class="isl-bar hp isl-me-hp"><i></i><em class="isl-me-hpt"></em></div><div class="isl-bar xp isl-me-xp"><i></i></div>
          <div class="isl-comp"><img class="isl-comp-face" alt=""><div class="grow"><small class="isl-comp-name"></small><div class="isl-bar hp isl-comp-hp"><i></i></div></div></div></div>
        <div class="isl-quest"><b></b><span></span></div>
        <div class="isl-friends"></div>
        <div class="isl-raid" hidden></div>
        <div class="isl-boss" hidden><b></b><small></small><div class="isl-bar boss"><i></i></div></div>
        <button class="isl-bagbtn" aria-label="Team, bag, quests, map and save">${IC.bag}<i class="isl-dot"></i></button>
        <div class="isl-keyhint"></div>
      </div>
      <div class="isl-banner" hidden></div>
      <div class="isl-touch" hidden>
        <div class="isl-stickzone"><div class="isl-stick"><i></i></div></div>
        <div class="isl-pad">
          <button class="isl-btn isl-attack" aria-label="Attack">${IC.sword}</button>
          <button class="isl-btn isl-dodge" aria-label="Dodge">${IC.dodge}</button>
          <button class="isl-btn isl-ability" aria-label="Companion ability">${IC.paw}<svg class="isl-cd" viewBox="0 0 36 36"><circle cx="18" cy="18" r="16"/></svg></button>
          <button class="isl-btn isl-act" hidden></button>
          <button class="isl-btn isl-catch" hidden></button>
        </div>
      </div>
      <div class="isl-dialog" hidden></div>
      <div class="isl-ui" hidden></div>
      <div class="isl-panel" hidden></div>
      <div class="isl-overlay" hidden></div>
    </div>`;
    root = box.querySelector('.isl-root');
    view = createView(root.querySelector('.isl-canvas'));
    layout();
    resizeObs = new ResizeObserver(() => layout());
    resizeObs.observe(root);
    addEventListener('resize', layout);
    addEventListener('keydown', onKey);
    addEventListener('keyup', onKey);
    addEventListener('blur', clearKeys);
    addEventListener('beforeunload', onUnload);
    bindUi();
    update(c);
    // Look for a saved explorer only in a real game (not a preview with no room behind it).
    if (!st.ready && st.picker.state === 'checking') { if (c.live) checkCloud(); else { st.picker.state = 'choose'; paintOverlay(); } }
    if (!raf) raf = requestAnimationFrame(loop);
    send({ k: 'join' });
  }
  function update(c) {
    ctx = c;
    const seated = (c.players || []).some((p) => p.id === st.pid && !p.watch);
    st.spectator = !seated && !!c.live;
    paintOverlay();
  }
  function layout() {
    if (!root) return;
    const top = root.getBoundingClientRect().top + scrollY;
    const h = Math.max(300, innerHeight - Math.max(0, top - scrollY) - (innerWidth <= 640 ? 0 : 16));
    root.style.height = h + 'px';
    const r = root.getBoundingClientRect();
    view.resize(r.width, r.height, devicePixelRatio || 1);
    const touch = matchMedia('(pointer: coarse)').matches || st.touchSeen;
    el('.isl-touch').hidden = !touch;
    root.classList.toggle('touch', !!touch);
  }
  function clearKeys() { st.keys.clear(); if (st.joy) st.joy.on = false; }
  function onUnload(e) { if (st.ready && isUnsaved()) { e.preventDefault(); e.returnValue = ''; } }
  function bindUi() {
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    // Joystick: put a thumb anywhere on the left side of the screen.
    const zone = el('.isl-stickzone'), stick = el('.isl-stick'), knob = stick.querySelector('i');
    zone.addEventListener('pointerdown', (e) => {
      st.touchSeen = true;
      const r = zone.getBoundingClientRect();
      st.joy = { on: true, id: e.pointerId, ox: e.clientX, oy: e.clientY, dx: 0, dy: 0 };
      stick.style.left = (e.clientX - r.left) + 'px'; stick.style.top = (e.clientY - r.top) + 'px';
      stick.classList.add('on');
      zone.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    });
    zone.addEventListener('pointermove', (e) => {
      if (!st.joy?.on || e.pointerId !== st.joy.id) return;
      let dx = e.clientX - st.joy.ox, dy = e.clientY - st.joy.oy;
      const d = Math.hypot(dx, dy), max = 46;
      if (d > max) { dx *= max / d; dy *= max / d; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const k = d < 8 ? 0 : 100 / max;
      st.joy.dx = dx * k; st.joy.dy = dy * k;
    });
    const end = (e) => { if (st.joy && e.pointerId === st.joy.id) { st.joy.on = false; st.joy.dx = st.joy.dy = 0; knob.style.transform = ''; stick.classList.remove('on'); } };
    zone.addEventListener('pointerup', end); zone.addEventListener('pointercancel', end);
    const press = (sel, bit, repeat = 0) => {
      const b = el(sel);
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault(); st.touchSeen = true;
        st.bits |= bit;
        b.classList.add('down');
        if (repeat) { clearInterval(b._rep); b._rep = setInterval(() => (st.bits |= bit), repeat); }
        if (navigator.userActivation?.hasBeenActive) try { navigator.vibrate?.(8); } catch {}
      });
      const up = () => { b.classList.remove('down'); clearInterval(b._rep); };
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
    };
    press('.isl-attack', BITS.attack, 360);
    press('.isl-dodge', BITS.dodge);
    press('.isl-ability', BITS.ability);
    press('.isl-act', BITS.interact);
    press('.isl-catch', BITS.catch);
    root.addEventListener('click', onClick);
    root.addEventListener('submit', (e) => { if (e.target.matches('[data-acct-form]')) { e.preventDefault(); submitAccount(e.target); } });
    root.addEventListener('input', (e) => { if (e.target.name === 'acctName') st.acct.name = e.target.value; });
    root.addEventListener('change', (e) => { if (e.target.matches('.isl-file input') && e.target.files?.[0]) loadFile(e.target.files[0]); });
    // Clicking the world on a computer swings your staff.
    root.querySelector('.isl-canvas').addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse' && e.button === 0 && st.ready) st.bits |= BITS.attack; });
  }
  function onClick(e) {
    const b = e.target.closest('button');
    if (!b || !root.contains(b)) return;
    const d = b.dataset;
    if (b.classList.contains('isl-bagbtn')) return togglePanel(st.panel ? null : st.tab || 'team');
    if (d.tab) return togglePanel(d.tab);
    if (d.panel === 'close') return togglePanel(null);
    if (d.dlg === 'next') return advanceDialog();
    if (d.dlg === 'close') return closeDialog();
    if (d.choice) return choose(d.choice);
    if (d.ui === 'close') return closeUi();
    if (d.buy) return cmd('buy', { item: d.buy });
    if (d.sell) return cmd('sell', { item: d.sell });
    if (d.ranch) return cmd('ranch', d.ranch === 'deposit' ? { op: 'deposit', team: d.uid } : { op: 'withdraw', ranch: d.uid });
    if (d.release) { if (confirm('Let this creature go back to the wild? You can’t undo this.')) cmd('release', { uid: d.release }); return; }
    if (d.active) return cmd('active', { uid: d.active });
    if (d.use) return cmd('use', { item: d.use, on: d.on });
    if (d.equip) return cmd('equip', { gear: d.equip });
    if (d.save === 'cloud') return saveCloud();
    if (d.save === 'retry') { st.save = null; return saveCloud(); }
    if (d.save === 'file') { st.save = null; return saveFile(); }
    if (d.save === 'force') { st.save = null; return saveCloud(true); }
    if (d.save === 'replace') { st.replaceOk = true; st.save = null; return saveCloud(); }
    if (d.save === 'cancel') { st.save = null; return paintPanel(); }
    if (d.acct === 'open') { st.acctOpen = true; st.acct.error = ''; st.panel = null; paintPanel(); return repaintOverlay(); }
    if (d.acct === 'close') { st.acctOpen = false; return repaintOverlay(); }
    if (d.acct === 'mode-create' || d.acct === 'mode-signin') { st.acct.mode = d.acct.slice(5); st.acct.error = ''; return repaintOverlay(); }
    if (d.acct === 'signout') return doSignOut();
    if (d.pick === 'recheck') return checkCloud();
    if (d.pick === 'cloud' && st.picker.cloud) return startExplorer('cloud', st.picker.cloud.data, st.picker.cloud.savedAt);
    if (d.pick === 'new') return startExplorer('new');
    if (d.skin != null) { st.picker.look.skin = +d.skin; delete el('.isl-overlay').dataset.html; return paintOverlay(); }
    if (d.hair != null) { st.picker.look.hair = +d.hair; delete el('.isl-overlay').dataset.html; return paintOverlay(); }
    if (d.respawn != null) return cmd('respawn');
    if (d.end) { st.ending = false; return paintOverlay(); }
    if (d.seat != null) return ctx?.live?.takeSeat?.();
    if (d.leave === 'cancel') return closeLeave();
    if (d.leave === 'go') { const L = st.leave; st.leave = null; paintOverlay(); return L?.proceed(); }
    if (d.leave === 'save') return leaveSave();
    if (d.leave === 'force') return leaveSave(true);
  }
  function destroy() {
    disposed = true;
    stop();
    resizeObs?.disconnect();
    removeEventListener('resize', layout);
    removeEventListener('keydown', onKey);
    removeEventListener('keyup', onKey);
    removeEventListener('blur', clearKeys);
    removeEventListener('beforeunload', onUnload);
    root = null; view = null;
  }
  return { receive, mount, update, destroy, beforeExit, state: st };
}
