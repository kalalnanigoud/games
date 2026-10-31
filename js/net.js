// Rooms and networking. The host's browser holds the real game state; other players connect to it
// through WebRTC (PeerJS), send actions and receive their own view (after the first one, only what
// changed). Also the host-side rules: computer players and stand-ins, turn timers, spectators,
// voice chat membership, tournaments, connection pings, and handing the room to a backup host.

import CONFIG from './config.js';
import { toast, randomCode, uid, sha256hex } from './util.js';
import { createVoice } from './voice.js';
import { createTour, currentMatch, recordResult } from './tour.js';
import { diff, apply } from './patch.js';
import { rememberPlayed } from './library.js';
import { MAX_ROOM, MAX_WATCHERS, BOT_NAMES, S, VERSION, getGame, gameReady, loadGame, defaultTimer, defaultOpts, validOpts, validTourDraft, seated, isWatching, adoptToken, myId, playerName, isBot, newerVersion, saveSession, queueSessionSave, flushSessionSave, clearSession } from './state.js';
import { render, renderTopbar, paintNet } from './ui.js';

const TAKEOVER_MS = 15000; // how long the backup host waits for the host to come back before taking over
const STAND_IN_MS = 20000; // how long a dropped player's seat waits before a computer plays for them
const PING_MS = 5000;
const BACKUP_MS = 1000;

export let peer = null;
export let hostConn = null;
export const conns = new Map(); // player id -> DataConnection (host only)
export let retryTimer = null;
export let retries = 0;
export let botTimer = null;
export let botFails = 0;
export let turnTimer = null; // host: fires when the current move's time runs out
export let timedGame = null; // host: the game state the running clock belongs to
export let clockSkew = 0; // client: host clock minus our clock
let pingTimer = null, backupTimer = null, viewSeq = 0;

// debug 0: failed retries are expected while a host refreshes, so keep them out of the console.
export const peerOptions = () => ({ config: { iceServers: CONFIG.iceServers }, debug: 0 });
export const roomPeerId = (code) => CONFIG.roomPrefix + code;
export const voice = createVoice({ toast, onChange: () => renderTopbar(), onLost: () => leaveVoice() });
// "Could not connect to peer X": which PeerJS id the broker couldn't find.
const missingPeer = (err) => /Could not connect to peer (\S+)/.exec(err?.message || '')?.[1] || '';

export function resume(session) {
  if (session.role !== 'local' && !requireMultiplayer()) return;
  adoptToken(session.token);
  if (session.secret) {
    S.secret = session.secret;
    sessionStorage.setItem('gn-secret', S.secret);
  }
  if (session.role === 'client') joinRoom(session.code);
  else if (session.role === 'host') hostRoom(session.gameId, session);
  else localRoom(session.gameId, session);
}

export function cleanup() {
  flushSessionSave();
  voice.leave();
  S.voice = [];
  clearTimeout(botTimer);
  clearTimeout(retryTimer);
  clearTimeout(turnTimer);
  clearTimeout(backupTimer);
  clearInterval(pingTimer);
  turnTimer = backupTimer = pingTimer = null;
  timedGame = null;
  Object.assign(S, { timer: null, net: {}, relay: false, successor: null, lostAt: 0 });
  retries = 0;
  const previous = [...conns.values()];
  conns.clear();
  for (const c of previous) try { c.close(); } catch {}
  const oldHost = hostConn;
  hostConn = null;
  if (oldHost) try { oldHost.close(); } catch {}
  const oldPeer = peer;
  peer = null;
  if (oldPeer) try { oldPeer.destroy(); } catch {}
}

export function leave() {
  if (S.role === 'host' && S.started && !confirm('Leave and close this room for everyone?')) return;
  cleanup();
  clearSession();
  Object.assign(S, { screen: 'home', role: null, code: null, players: [], started: false, game: null, view: null, status: '', tour: null, backup: null, update: null });
  history.replaceState(null, '', location.pathname);
  render();
}

// Game code loads on demand. Once it is here, bring the room up to date.
function whenLoaded() {
  if (!S.gameId || gameReady(S.gameId)) return;
  const id = S.gameId;
  loadGame(id).then(() => {
    if (!S.role || S.gameId !== id) return;
    // Clients already received their private view; they have no authoritative game.
    if (S.role === 'client') render(); else broadcast();
  })
    .catch(() => toast('Could not load the game. Check your connection and reload.'));
}

/* ---------------- host ---------------- */

export function hostRoom(gameId, resume = null) {
  if (!requireMultiplayer()) return;
  cleanup();
  Object.assign(S, {
    role: 'host',
    credentials: resume?.credentials || [],
    code: resume?.code || randomCode(),
    gameId: resume?.gameId || gameId,
    players: resume?.players?.map((p) => ({ ...p, connected: p.id === S.token || !!p.bot })) || [{ id: S.token, name: S.name, connected: true }],
    started: resume?.started || false,
    timerSec: resume?.timerSec ?? defaultTimer(getGame(resume?.gameId || gameId)),
    opts: validOpts(getGame(resume?.gameId || gameId), resume?.opts),
    tour: resume?.tour || null,
    lobbyMode: resume?.lobbyMode === 'tour' ? 'tour' : 'game',
    tourDraft: validTourDraft(resume?.tourDraft),
    timer: null,
    game: resume?.game || null,
    screen: resume?.started ? 'game' : 'lobby',
    status: 'connecting',
    backup: null,
    backupHost: resume?.backupHost || '',
  });
  const me = S.players.find((p) => p.id === S.token);
  if (me) { me.name = S.name; me.connected = true; delete me.away; delete me.standIn; }
  // Everyone else counts as away until they reconnect (a computer stands in after a while).
  if (S.started) {
    for (const p of S.players) if (!p.bot && p.id !== S.token) p.away ??= Date.now();
    setTimeout(scheduleBots, STAND_IN_MS + 100);
  }
  refreshLocalView();
  armTimer();
  render();
  scheduleBots();
  whenLoaded();
  openHostPeer(!!resume, resume?.takeover ? 15 : 8);
}

// Reconnect to the matchmaking server after a drop. Bound to one Peer object so a
// timer from a room you already left can never touch the next room.
export function keepAlive(p) {
  p.on('disconnected', () => {
    if (p !== peer || p.destroyed) return;
    S.status = 'reconnecting';
    render();
    setTimeout(() => {
      if (p === peer && !p.destroyed && p.disconnected) try { p.reconnect(); } catch {}
    }, 1500);
  });
}

export function openHostPeer(isResume, attempts = 8) {
  const p = (peer = new Peer(roomPeerId(S.code), peerOptions()));
  p.on('open', () => {
    if (p !== peer) return;
    retries = 0;
    S.status = 'online';
    saveSession();
    render();
    clearInterval(pingTimer);
    pingTimer = setInterval(ping, PING_MS);
  });
  p.on('connection', (conn) => {
    if (p !== peer) return conn.close();
    conn.on('data', (msg) => { if (p === peer && S.role === 'host') onHostMessage(conn, msg); });
    conn.on('close', () => onConnClosed(conn));
    conn.on('error', () => onConnClosed(conn));
  });
  p.on('call', (call) => (p === peer ? voice.answer(call) : call.close()));
  keepAlive(p);
  p.on('error', (err) => {
    if (p !== peer) return;
    if (err.type === 'unavailable-id') {
      p.destroy();
      if (isResume && retries++ < attempts) {
        // The broker may still remember our old connection for a few seconds.
        S.status = 'reclaiming room…';
        render();
        retryTimer = setTimeout(() => openHostPeer(true, attempts), 3000);
      } else if (isResume) {
        // Someone else is hosting this room now (a backup host took over): join it as a player.
        toast('Someone else is hosting this room now. Rejoining as a player…', 'info');
        joinRoom(S.code);
      } else {
        S.code = randomCode();
        openHostPeer(false);
      }
    } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
      S.status = 'offline';
      render();
      toast('Lost connection to the matchmaking server. Retrying…');
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => { if (p !== peer) return; p.destroy(); openHostPeer(true, attempts); }, 4000);
    } else if (err.type === 'peer-unavailable') {
      voice.unreachable(missingPeer(err)); // a voice member who just left
    } else {
      console.warn(err);
    }
  });
}

const ownConn = (conn) => conn.pid && conns.get(conn.pid) === conn;

// One device can't flood the host: each connection gets a steady allowance of messages, far above
// real play (Sketch Party's drawing sends about three a second), and oversized messages are dropped.
const RATE = { burst: 60, perSecond: 20 }, MAX_MESSAGE = 100000;
function withinAllowance(conn, msg) {
  const now = Date.now();
  const b = conn._allowance || (conn._allowance = { tokens: RATE.burst, at: now });
  b.tokens = Math.min(RATE.burst, b.tokens + ((now - b.at) / 1000) * RATE.perSecond);
  b.at = now;
  let size = 0;
  try { size = JSON.stringify(msg).length; } catch { return false; }
  if (b.tokens >= 1 && size <= MAX_MESSAGE) { b.tokens -= 1; return true; }
  if (!conn._slowWarned && conn.open) { conn._slowWarned = true; conn.send({ t: 'error', msg: 'Too many messages from this device. Slow down a little.' }); }
  return false;
}

export function onHostMessage(conn, msg) {
  if (!msg || typeof msg !== 'object') return;
  if (!withinAllowance(conn, msg)) return;
  if (msg.t === 'hello') {
    if (typeof msg.token !== 'string' || !/^[a-zA-Z0-9]{1,80}$/.test(msg.token) ||
        typeof msg.secret !== 'string' || !/^[a-f0-9]{64}$/.test(msg.secret)) return reject(conn, 'Invalid player credentials.');
    if (conn.pid && conn.pid !== msg.token) return reject(conn, 'This connection already belongs to another player.');
    const name = String(msg.name || 'Player').slice(0, 20);
    const proof = sha256hex(msg.secret);
    let p = S.players.find((x) => x.id === msg.token);
    if (p && (p.id === S.token || p.bot || !S.credentials.some(([id, check]) => id === p.id && check === proof))) {
      return reject(conn, 'Cannot reconnect: invalid player credentials.');
    }
    let seatedOut = false;
    if (!p) {
      // Someone arriving after the start, or when the chosen game's table is full, joins as a spectator.
      const watching = S.started || !!S.tour || seated().length >= seatLimit();
      if (watching && S.players.length >= MAX_ROOM + MAX_WATCHERS) return reject(conn, 'Room is full.');
      seatedOut = watching && !S.started;
      p = { id: String(msg.token), name, connected: true, ...(watching ? { watch: true } : {}) };
      S.players.push(p);
      S.credentials.push([p.id, proof]);
    }
    if (p.standIn) notice(`👋 ${name} is back. The computer hands their seat back.`);
    p.name = name;
    p.connected = true;
    delete p.away; delete p.standIn;
    if (typeof msg.v === 'string' && msg.v !== VERSION && newerVersion(msg.v, VERSION)) S.update = { newer: true };
    const old = conns.get(p.id);
    conn.pid = p.id;
    conn.base = undefined; // their next view is sent in full
    conns.set(p.id, conn);
    if (old && old !== conn) try { old.close(); } catch {}
    saveSession();
    broadcast();
    if (seatedOut && conn.open) conn.send({ t: 'notice', msg: S.tour ? 'This tournament already has its entrants. You can watch until it finishes.' : `${getGame(S.gameId).name} seats ${seatLimit()}, so you're watching for now. Tap "Take a seat" if one frees up.` });
  } else if (!ownConn(conn)) {
    return;
  } else if (msg.t === 'action') {
    const err = applyAction(conn.pid, msg.action);
    if (err) conn.open && conn.send({ t: 'error', msg: err });
  } else if (msg.t === 'voice') {
    if (msg.on && (typeof msg.peer !== 'string' || msg.peer !== conn.peer)) return;
    setVoiceMember(conn.pid, msg.on ? msg.peer : null);
  } else if (msg.t === 'watch') {
    const err = setWatch(conn.pid, !!msg.on);
    if (err) conn.open && conn.send({ t: 'error', msg: err });
  } else if (msg.t === 'pong' && typeof msg.ts === 'number') {
    S.net[conn.pid] = Math.max(1, Date.now() - msg.ts);
  } else if (msg.t === 'resync') {
    conn.base = undefined;
    broadcast();
  } else if (msg.t === 'rematch' && S.started && S.game?.over) {
    notice(`🔁 ${playerName(conn.pid)} would like a rematch!`);
  }
}

// Who is in voice chat. Everyone gets the list and links up with the others.
export function setVoiceMember(pid, peerId) {
  S.voice = S.voice.filter(([id]) => id !== pid);
  if (peerId) S.voice.push([pid, peerId]);
  broadcast();
}

// Switch a room member between playing and watching (only between games).
export function setWatch(pid, on) {
  const p = S.players.find((x) => x.id === pid);
  if (!p || p.bot) return 'Only people can watch.';
  if (S.started) return 'Wait until this game ends to change seats.';
  if (S.tour) return 'Tournament seats are assigned by the bracket. Wait until the tournament closes to change seats.';
  if (!on && seated().length >= seatLimit()) return `The table is full: ${getGame(S.gameId).name} seats ${seatLimit()}.`;
  if (on) p.watch = true; else delete p.watch;
  saveSession();
  broadcast();
  return null;
}

export function reject(conn, msg) {
  conn.send({ t: 'error', msg, fatal: true });
  setTimeout(() => conn.close(), 500);
}

export function onConnClosed(conn) {
  if (!conn.pid || conns.get(conn.pid) !== conn) return;
  conns.delete(conn.pid);
  const p = S.players.find((x) => x.id === conn.pid);
  if (p) {
    p.connected = false;
    // Mid-game, a computer takes the seat if they're not back soon.
    if (S.started && !p.watch) { p.away = Date.now(); setTimeout(scheduleBots, STAND_IN_MS + 100); }
  }
  delete S.net[conn.pid];
  S.voice = S.voice.filter(([id]) => id !== conn.pid);
  broadcast();
}

export function applyAction(pid, action) {
  if (!S.started || !action) return 'Game not running.';
  if (!gameReady(S.gameId)) return 'The game is still loading.';
  if (isWatching(pid)) return 'You are watching this game.';
  const g = getGame(S.gameId);
  const before = JSON.stringify(S.game);
  const next = structuredClone(S.game);
  try {
    g.act(next, pid, action);
  } catch (e) {
    return e.message || String(e);
  }
  // A move that changed nothing (a bot pausing to think) needs no save or resend.
  if (JSON.stringify(next) === before) { scheduleBots(); return null; }
  S.game = next;
  if (S.tour && !S.tour.done && S.game.over && S.tour.gameNo && S.tour.recorded !== S.tour.gameNo) {
    notice('🏆 ' + recordResult(S.tour, S.game));
    if (S.tour.done) restoreSeats();
  }
  if (S.role === 'local') followTurn();
  if (S.game.over) saveSession(); else queueSessionSave();
  broadcast();
  return null;
}

// One-device mode: hand the screen to the next human who must act.
export function followTurn() {
  if (!gameReady(S.gameId)) return;
  const g = getGame(S.gameId);
  const t = (g.turnOf?.(S.game) || []).filter((id) => !isBot(id));
  if (t.length && !t.includes(S.viewAs)) S.viewAs = t[0];
  if (!S.viewAs || isBot(S.viewAs)) S.viewAs = S.players.find((p) => !p.bot)?.id;
}

// A person who dropped out mid-game and hasn't come back: a computer plays their seat meanwhile.
export const standingIn = (id) => {
  const p = S.players.find((x) => x.id === id);
  return S.role === 'host' && !!p && !p.bot && !p.watch && !p.connected && !!p.away && Date.now() - p.away >= STAND_IN_MS;
};

// The host's browser plays for the bots (and stand-ins), using only what that seat could see.
export function scheduleBots() {
  clearTimeout(botTimer);
  if (!S.started || S.role === 'client' || !S.game || S.game.over || !gameReady(S.gameId)) return;
  const g = getGame(S.gameId);
  if (!g.bot || !g.turnOf) return;
  const due = (g.turnOf(S.game) || []).filter((id) => isBot(id) || standingIn(id));
  if (!due.length) return;
  botTimer = setTimeout(() => {
    const id = due[Math.floor(Math.random() * due.length)];
    const p = S.players.find((x) => x.id === id);
    if (!isBot(id) && !standingIn(id)) return scheduleBots(); // they came back in the meantime
    if (!isBot(id) && !p.standIn) { p.standIn = true; notice(`🤖 A computer is playing for ${p.name} until they reconnect.`); }
    let action = null;
    try {
      action = g.bot(g.view ? g.view(S.game, id) : S.game, id);
    } catch (e) {
      console.warn('bot crashed', e);
    }
    const err = action ? applyAction(id, action) : 'no action';
    if (err) {
      console.warn('bot move rejected:', err, action);
      if (++botFails < 25) scheduleBots();
    } else botFails = 0;
  }, due.length > 1 ? 350 + Math.random() * 300 : 850 + Math.random() * 650); // several bots answering at once: move quicker
}

export function viewFor(pid) {
  if (!S.started || !S.game || !gameReady(S.gameId)) return null; // guests have no game state of their own
  const g = getGame(S.gameId);
  return g.view ? g.view(S.game, pid) : S.game;
}
export function refreshLocalView() {
  S.view = viewFor(myId());
}

/* ---------------- turn timer (host) ---------------- */

// Start the clock whenever the game moves on and a human must act.
// The clock only restarts when the game state changes, not on reconnects.
export function armTimer() {
  const g = getGame(S.gameId);
  const due = S.started && S.game && !S.game.over && S.timerSec && g.onTimeout && gameReady(S.gameId)
    ? (g.turnOf(S.game) || []).filter((id) => !isBot(id)) : [];
  if (!due.length) {
    clearTimeout(turnTimer);
    turnTimer = null;
    timedGame = null;
    S.timer = null;
    return;
  }
  if (timedGame === S.game && S.timer) return;
  timedGame = S.game;
  const total = S.timerSec * 1000;
  S.timer = { deadline: Date.now() + total, total, due };
  clearTimeout(turnTimer);
  turnTimer = setTimeout(expireTimer, total + 200);
}

// Time's up: make the game's timeout move for everyone still on the clock
// (falling back to what a bot would do), then tell the table.
export function expireTimer() {
  turnTimer = null;
  const g = getGame(S.gameId);
  if (!S.started || !S.game || S.game.over || !gameReady(S.gameId)) return;
  const late = (g.turnOf(S.game) || []).filter((id) => !isBot(id));
  let moved = false;
  for (const pid of late) {
    if (!(g.turnOf(S.game) || []).includes(pid)) continue;
    for (const pick of [g.onTimeout, g.bot]) {
      if (!pick) continue;
      let a = null;
      try { a = pick(JSON.parse(JSON.stringify(viewFor(pid))), pid); } catch (e) { console.warn('timeout move failed', e); }
      if (a && !applyAction(pid, a)) { moved = true; break; }
    }
    notice(`⏱ Time's up for ${playerName(pid)}`);
  }
  if (!moved) { timedGame = null; S.timer = null; broadcast(); } // nothing worked: give a fresh clock
}

export function notice(msg) {
  for (const c of conns.values()) if (c.open) c.send({ t: 'notice', msg });
  toast(msg, 'info');
}

/* ---------------- sending the room to everyone ---------------- */

// Each player gets their own view of the game. After the first full copy, only the changes are sent.
function syncFor(c, pid, now) {
  const view = viewFor(pid);
  const msg = { t: 'sync', v: VERSION, code: S.code, players: S.players, gameId: S.gameId, started: S.started, hostId: S.token, timerSec: S.timerSec, timer: S.timer, opts: S.opts, voice: S.voice, tour: S.tour, mode: S.lobbyMode, successor: S.successor, now, seq: (c.seq = (c.seq || 0) + 1) };
  if (c.base && view) { msg.from = msg.seq - 1; const patch = diff(c.base, view); if (patch !== undefined) msg.patch = patch; } else msg.view = view;
  c.base = view;
  return msg;
}

export function broadcast() {
  if (S.role !== 'client') armTimer();
  const now = Date.now();
  if (S.role === 'host') S.successor = pickSuccessor();
  for (const p of S.players) {
    if (p.id === S.token || S.role === 'local') continue;
    const c = conns.get(p.id);
    if (c && c.open) c.send(syncFor(c, p.id, now));
  }
  if (S.role === 'host') { voice.sync(S.voice, peer); queueBackup(); }
  refreshLocalView();
  render();
  scheduleBots();
}

/* ---------------- backup host ---------------- */
// The host may explicitly trust one person with a copy of the entire room.
// The copy holds only fingerprints of reconnect secrets, so it can't be used to pose as anyone.
// It includes hidden cards and puzzle answers. Migration is off until a successor is chosen.

function pickSuccessor() {
  const live = S.players.filter((p) => p.id !== S.token && !p.bot && p.connected && conns.get(p.id)?.open);
  return live.find((p) => p.id === S.backupHost)?.id || null;
}
function queueBackup() {
  if (backupTimer || !S.successor) return;
  backupTimer = setTimeout(sendBackup, BACKUP_MS);
}
export function backupData() {
  return {
    v: VERSION, code: S.code, gameId: S.gameId, players: S.players, started: S.started, game: S.game, timerSec: S.timerSec, opts: S.opts, tour: S.tour, lobbyMode: S.lobbyMode, tourDraft: validTourDraft(S.tourDraft), hostId: S.token,
    credentials: S.credentials.concat([[S.token, sha256hex(S.secret)]]), // the old host can rejoin as a player
  };
}
export function sendBackup() {
  backupTimer = null;
  const c = S.successor && conns.get(S.successor);
  if (c?.open) c.send({ t: 'backup', data: backupData() });
}
// Backup host: the host has been gone long enough. Open the room with the last copy.
export function takeOver() {
  const b = S.backup;
  S.backup = null;
  if (!b || b.code !== S.code) return;
  hostRoom(b.gameId, { ...b, takeover: true, credentials: b.credentials.filter(([id]) => id !== S.token) });
  toast('📡 The host left, so you are hosting the room now. Everyone else will reconnect.', 'info');
}

/* ---------------- connection quality ---------------- */

function ping() {
  const ts = Date.now();
  for (const c of conns.values()) if (c.open) c.send({ t: 'ping', ts, net: S.net });
  paintNet();
}

// How many can sit at the table: the chosen game's limit, or the whole room while a tournament is
// set up or played (each of its games seats its own players).
export function seatLimit() {
  return S.tour || S.lobbyMode === 'tour' ? MAX_ROOM : Math.min(MAX_ROOM, getGame(S.gameId).maxPlayers);
}
// After the host picks a game with fewer seats: computer players leave first (newest first), then the
// newest arrivals move to watching. The host keeps their seat; one-device players are never removed.
export function fitTable() {
  let over = seated().length - seatLimit();
  if (over <= 0) return;
  const g = getGame(S.gameId), gone = [], watching = [];
  for (const p of [...S.players].reverse()) if (over > 0 && p.bot && !p.watch) { gone.push(p.id); over--; }
  S.players = S.players.filter((p) => !gone.includes(p.id));
  if (S.role === 'host') for (const p of [...S.players].reverse()) {
    if (over > 0 && !p.bot && !p.watch && p.id !== S.token) { p.watch = true; watching.push(p.name); over--; }
  }
  if (watching.length) notice(`${g.name} seats ${seatLimit()}, so ${watching.join(' and ')} ${watching.length > 1 ? 'are' : 'is'} watching for now.`);
  else if (gone.length) toast(`${g.name} seats ${seatLimit()}: removed ${gone.length > 1 ? gone.length + ' computer players' : 'a computer player'}.`, 'info');
}

export function addBot() {
  if (seated().length >= seatLimit()) return toast(`The table is full: ${getGame(S.gameId).name} seats ${seatLimit()}.`);
  const used = new Set(S.players.map((p) => p.name));
  const name = (BOT_NAMES.find((n) => !used.has(n + ' 🤖')) || 'Bot' + S.players.length) + ' 🤖';
  S.players.push({ id: 'B' + uid(), name, connected: true, bot: true });
  saveSession();
  broadcast();
}

// rematch: keep everyone in their seats, and let the game know the previous result (chess swaps colours).
export function startGame(rematch = false) {
  const g = getGame(S.gameId);
  const table = seated();
  const n = table.length;
  if (n < g.minPlayers || n > g.maxPlayers) return toast(`${g.name} needs ${g.minPlayers}–${g.maxPlayers} players.`);
  if (!gameReady(S.gameId)) {
    toast(`Loading ${g.name}…`, 'info');
    const role = S.role, players = S.players, tour = S.tour, game = S.game;
    return loadGame(S.gameId).then(() => {
      if (S.role !== role || S.players !== players || S.tour !== tour || S.game !== game || S.gameId !== g.id) return;
      return tour ? playTour() : startGame(rematch);
    }, () => toast('Could not load the game. Check your connection and reload.'));
  }
  const previous = rematch && S.game?.over ? S.game : null;
  const opts = validOpts(g, S.opts);
  let game;
  try { game = g.setup(table.map((p) => ({ id: p.id, name: p.name })), opts, previous ? { previous } : {}); }
  catch (error) { toast(`Could not start ${g.name}: ${error.message || error}`); return; }
  S.opts = opts;
  S.game = game;
  // A failed load, invalid table, or failed setup must not consume a match number.
  if (S.tour && !S.tour.done) S.tour.gameNo++;
  S.started = true;
  rememberPlayed(S.gameId);
  S.screen = 'game';
  botFails = 0;
  if (S.role === 'local') { S.viewAs = null; followTurn(); }
  saveSession();
  broadcast();
}
export function requestRematch() {
  if (hostConn?.open) { hostConn.send({ t: 'rematch' }); toast('Asked the host for a rematch.', 'info'); }
}

/* ---------------- tournaments (host) ---------------- */

export function startTour(mode, games) {
  try { S.tour = createTour(mode, games, seated()); } catch (e) { return toast(e.message); }
  return playTour();
}
// Seat the next match (everyone else in the tournament watches) and start it.
export function playTour() {
  const m = S.tour && currentMatch(S.tour);
  if (!m) return;
  if (S.started && S.game && !S.game.over) return;
  if (!m.seats.every((id) => S.players.some((p) => p.id === id))) return toast('A tournament player is missing. Restore their seat or close the tournament.');
  if (S.gameId !== m.gameId) { S.gameId = m.gameId; S.opts = defaultOpts(getGame(m.gameId)); S.timerSec = defaultTimer(getGame(m.gameId)); }
  for (const p of S.players) {
    if (m.seats.includes(p.id)) delete p.watch; else p.watch = true;
  }
  return startGame();
}
export function restoreSeats() {
  for (const e of S.tour?.entrants || []) { const p = S.players.find((x) => x.id === e.id); if (p) delete p.watch; }
}
export function closeTour() {
  if (S.tour && !S.tour.done && !confirm('Cancel this tournament?')) return;
  restoreSeats();
  S.tour = null;
  S.lobbyMode = 'game';
  fitTable();
  saveSession();
  broadcast();
}

export function endGame() {
  if (!confirm('End this game and go back to the lobby?')) return;
  S.started = false;
  S.game = null;
  S.screen = 'lobby';
  saveSession();
  broadcast();
}

/* ---------------- local (one device) ---------------- */

export function localRoom(gameId, resume = null) {
  cleanup();
  Object.assign(S, {
    role: 'local',
    credentials: [],
    code: null,
    gameId: resume?.gameId || gameId,
    players: resume?.players || [{ id: 'L1', name: S.name || 'Player 1', connected: true }, { id: 'L2', name: 'Player 2', connected: true }],
    started: resume?.started || false,
    timerSec: resume?.timerSec ?? defaultTimer(getGame(resume?.gameId || gameId)),
    opts: validOpts(getGame(resume?.gameId || gameId), resume?.opts),
    tour: resume?.tour || null,
    lobbyMode: resume?.lobbyMode === 'tour' ? 'tour' : 'game',
    tourDraft: validTourDraft(resume?.tourDraft),
    timer: null,
    game: resume?.game || null,
    viewAs: resume?.viewAs || 'L1',
    screen: resume?.started ? 'game' : 'lobby',
    status: 'one device',
  });
  refreshLocalView();
  saveSession();
  armTimer();
  render();
  scheduleBots();
  whenLoaded();
}

/* ---------------- client ---------------- */

export function joinRoom(code) {
  if (!requireMultiplayer()) return;
  cleanup();
  Object.assign(S, { role: 'client', code: code.toUpperCase().trim(), screen: 'lobby', status: 'connecting', players: [], started: false, view: null, synced: false, backup: null });
  viewSeq = 0;
  history.replaceState(null, '', '?room=' + S.code);
  saveSession();
  render();
  openClientPeer();
}

export function openClientPeer() {
  const p = (peer = new Peer(peerOptions()));
  p.on('open', () => p === peer && connectToHost());
  p.on('call', (call) => (p === peer ? voice.answer(call) : call.close()));
  keepAlive(p);
  p.on('error', (err) => {
    if (p !== peer) return;
    if (err.type === 'peer-unavailable') {
      // Calling a voice member who just switched off lands here too. That says nothing about the host,
      // and treating it as "host not found" would tear down a working connection.
      const gone = missingPeer(err);
      if (gone && gone !== roomPeerId(S.code)) return voice.unreachable(gone);
      S.status = 'host not found';
      render();
      scheduleClientRetry();
    } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
      S.status = 'offline';
      render();
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => { if (p !== peer) return; cleanupPeerOnly(); openClientPeer(); }, 4000);
    } else console.warn(err);
  });
}

export function cleanupPeerOnly() {
  const oldHost = hostConn;
  hostConn = null;
  if (oldHost) try { oldHost.close(); } catch {}
  const oldPeer = peer;
  peer = null;
  if (oldPeer) try { oldPeer.destroy(); } catch {}
}

// Does our connection to the host go through a TURN relay? (Shown in the connection tooltip.)
function checkRelay(conn) {
  setTimeout(async () => {
    try {
      const stats = await conn.peerConnection?.getStats();
      let pair = null;
      stats?.forEach((r) => { if (r.type === 'candidate-pair' && (r.selected || r.nominated) && r.state === 'succeeded') pair = r; });
      const local = pair && stats.get(pair.localCandidateId);
      S.relay = local?.candidateType === 'relay';
      paintNet();
    } catch {}
  }, 3000);
}

export function connectToHost() {
  if (!peer || peer.destroyed) return;
  const conn = peer.connect(roomPeerId(S.code), { reliable: true });
  hostConn = conn;
  conn.on('open', () => {
    if (hostConn !== conn || S.role !== 'client') return conn.close();
    retries = 0;
    S.status = 'online';
    viewSeq = 0;
    conn.send({ t: 'hello', token: S.token, secret: S.secret, name: S.name, v: VERSION });
    if (voice.active) conn.send({ t: 'voice', on: true, peer: peer.id }); // rejoin voice after a reconnect
    checkRelay(conn);
    render();
  });
  conn.on('data', (msg) => { if (hostConn === conn && S.role === 'client') onClientMessage(msg); });
  conn.on('close', () => {
    if (hostConn !== conn) return;
    S.status = 'disconnected';
    S.lostAt ||= Date.now();
    render();
    scheduleClientRetry();
  });
  // If WebRTC can't get through (strict NAT), or the host just vanished, the connection never opens
  // and no error arrives. Give up on this attempt and try again.
  setTimeout(() => {
    if (hostConn !== conn || conn.open) return;
    if (S.status === 'connecting') S.status = 'cannot reach host';
    try { conn.close(); } catch {}
    hostConn = null;
    S.lostAt ||= Date.now();
    render();
    scheduleClientRetry();
  }, S.synced ? 8000 : 15000);
}

export function scheduleClientRetry() {
  clearTimeout(retryTimer);
  if (S.role !== 'client') return;
  if (S.lostAt && S.backup && S.successor === S.token && Date.now() - S.lostAt >= TAKEOVER_MS) return takeOver();
  // A room we were in may just be refreshing, so keep trying for a minute.
  // A code that never answered is probably mistyped: stop after ~15 seconds.
  if (retries++ > (S.synced ? 20 : 4)) { S.status = S.synced ? 'gave up — tap Retry' : 'not found'; render(); return; }
  retryTimer = setTimeout(() => {
    if (peer && !peer.destroyed && peer.open) connectToHost();
    else { cleanupPeerOnly(); openClientPeer(); }
  }, 3000);
}

export function onClientMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.t === 'sync') {
    S.status = 'online';
    S.lostAt = 0;
    retries = 0;
    clearTimeout(retryTimer);
    let view = S.view;
    if (!Number.isSafeInteger(msg.seq) || msg.seq <= viewSeq) return;
    if ('view' in msg) view = msg.view;
    else if (msg.from === viewSeq && S.view != null && msg.gameId === S.gameId) view = apply(S.view, msg.patch);
    else { hostConn?.open && hostConn.send({ t: 'resync' }); return; } // missed an update: ask for a full copy
    viewSeq = msg.seq;
    if (msg.started && (!S.started || S.gameId !== msg.gameId)) rememberPlayed(msg.gameId);
    Object.assign(S, { players: msg.players, gameId: msg.gameId, started: msg.started, view, hostId: msg.hostId, synced: true, timerSec: msg.timerSec || 0, timer: msg.timer || null, opts: msg.opts || {}, voice: msg.voice || [], tour: msg.tour || null, lobbyMode: msg.mode === 'tour' ? 'tour' : 'game', successor: msg.successor || null });
    S.update = msg.v && msg.v !== VERSION ? { newer: newerVersion(msg.v, VERSION) } : null;
    if (S.successor !== S.token) S.backup = null;
    voice.sync(S.voice, peer);
    if (msg.now) clockSkew = msg.now - Date.now();
    S.screen = S.started ? 'game' : 'lobby';
    if (S.started) whenLoaded();
    render();
  } else if (msg.t === 'ping') {
    hostConn?.open && hostConn.send({ t: 'pong', ts: msg.ts });
    if (msg.net && typeof msg.net === 'object') { S.net = msg.net; paintNet(); }
  } else if (msg.t === 'backup' && S.successor === S.token && msg.data && typeof msg.data === 'object' && msg.data.code === S.code && msg.data.hostId === S.hostId) {
    S.backup = msg.data;
  } else if (msg.t === 'notice') {
    toast(msg.msg, 'info');
  } else if (msg.t === 'error') {
    toast(msg.msg);
    if (msg.fatal) { cleanup(); clearSession(); S.screen = 'home'; S.role = null; render(); }
  }
}

/* ---------------- actions from the UI ---------------- */

export function send(action) {
  if (S.role === 'client') {
    if (!hostConn || !hostConn.open) return toast('Not connected to the host yet.');
    hostConn.send({ t: 'action', action });
  } else {
    // Apply it once the tap handler has finished (still before the screen updates), as a guest's move
    // is: it has to travel to the host. A game that redraws its own screen right after sending would
    // otherwise paint its old view over the new position, since the board is kept between updates.
    const pid = myId();
    queueMicrotask(() => {
      const err = applyAction(pid, action);
      if (err) toast(err);
    });
  }
}

/* ---------------- voice chat ---------------- */

export async function joinVoice() {
  if (!peer?.open || !peer.id) return toast('Wait until you are connected to the room.');
  if (!(await voice.join())) return;
  if (S.role === 'host') setVoiceMember(S.token, peer.id);
  else if (hostConn?.open) hostConn.send({ t: 'voice', on: true, peer: peer.id });
}

export function leaveVoice() {
  voice.leave();
  if (S.role === 'host') setVoiceMember(S.token, null);
  else if (hostConn?.open) hostConn.send({ t: 'voice', on: false });
}

// Lobby button: switch between playing and watching.
export function toggleWatch(on) {
  if (S.role === 'client') { if (hostConn?.open) hostConn.send({ t: 'watch', on }); else toast('Not connected to the host yet.'); }
  else { const err = setWatch(S.token, on); if (err) toast(err); }
}

export function requireMultiplayer() {
  if (typeof Peer !== 'undefined') return true;
  toast('Online play is unavailable. Check your connection and reload, or choose One device.', 'info');
  return false;
}
