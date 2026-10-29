// Game Night: lobby, rooms and peer-to-peer multiplayer.
//
// The host's browser holds the real game state. Other players connect to the
// host through WebRTC (PeerJS), send actions, and receive the updated state.
// No game server is needed, so the whole site can live on free static hosting.

import CONFIG from './config.js';
import { GAMES, getGame } from '../games/index.js';
import { esc, toast, randomCode, uid } from './util.js';
import { snapshot, flip, playFx, changed, confetti, wake, settleLoops } from './fx.js';
import { sound, isMuted, setMuted } from './sound.js';

const MAX_ROOM = 8;
const BOT_NAMES = ['Ada', 'Bram', 'Cleo', 'Dax', 'Esme', 'Finn', 'Gus', 'Hana'];
const app = document.getElementById('app');
const topinfo = document.getElementById('topinfo');

const S = {
  screen: 'home', // home | lobby | game
  name: sessionStorage.getItem('gn-name') || localStorage.getItem('gn-name') || '',
  // Per-tab identity, so two tabs on one computer count as two players.
  token: sessionStorage.getItem('gn-token') || uid(),
  role: null, // host | client | local
  code: null,
  players: [], // [{id, name, connected}]
  gameId: GAMES[0].id,
  started: false,
  game: null, // full game state (host / local only)
  view: null, // what this device renders
  viewAs: null, // local mode: whose eyes we see through
  status: '',
  timerSec: defaultTimer(GAMES[0]), // seconds per move, 0 = off (games with onTimeout only)
  timer: null, // {deadline (host clock), total, due: [ids]} while someone is on the clock
};
function defaultTimer(g) {
  return g?.onTimeout ? g.defaultTimer || 30 : 0;
}
sessionStorage.setItem('gn-token', S.token);

function adoptToken(token) {
  if (!token) return;
  S.token = token;
  sessionStorage.setItem('gn-token', token);
}

let peer = null;
let hostConn = null;
const conns = new Map(); // player id -> DataConnection (host only)
let retryTimer = null;
let retries = 0;
let wasMyTurn = false;
let lastFxSeq = null;
let botTimer = null;
let botFails = 0;
let turnTimer = null; // host: fires when the current move's time runs out
let timedGame = null; // host: the game state the running clock belongs to
let clockSkew = 0; // client: host clock minus our clock
let lastTickSec = 0;

// debug 0: failed retries are expected while a host refreshes, so keep them out of the console.
const peerOptions = () => ({ config: { iceServers: CONFIG.iceServers }, debug: 0 });
const roomPeerId = (code) => CONFIG.roomPrefix + code;
const myId = () => (S.role === 'local' ? S.viewAs : S.token);
const playerName = (id) => S.players.find((p) => p.id === id)?.name ?? '???';

/* ---------------- how to play ---------------- */
// Each game supplies howTo = { goal, turn: [[icon, title, text]], tips: [text] }.
// The guide lives outside #app so game redraws never close it.

const seenHelp = (id) => localStorage.getItem('gn-help-' + id) === '1';
const helpBtn = (id, cls = '') =>
  getGame(id).howTo ? `<button class="help-btn ${cls} ${seenHelp(id) ? '' : 'new'}" data-help="${id}" title="How to play" aria-label="How to play">?</button>` : '';
let helpAutoShown = new Set();

function showHelp(id) {
  const g = getGame(id);
  const h = g.howTo;
  if (!h) return;
  localStorage.setItem('gn-help-' + id, '1');
  document.querySelectorAll('.help-btn.new').forEach((b) => b.dataset.help === id && b.classList.remove('new'));
  closeHelp();
  const el = document.createElement('div');
  el.className = 'modal-bg';
  el.id = 'helpModal';
  el.innerHTML = `
    <div class="modal panel help" role="dialog" aria-label="How to play ${esc(g.name)}">
      <button class="small icon help-x" aria-label="Close">✕</button>
      ${g.cover ? `<div class="help-cover">${g.cover}</div>` : ''}
      <h2 class="gold">How to play ${esc(g.name)}</h2>
      <div class="parchment help-goal"><b>🏆 Goal</b><p>${h.goal}</p></div>
      <h3 class="gold">On your turn</h3>
      <ol class="help-steps">
        ${h.turn.map(([icon, title, text]) => `<li><span class="help-ic">${icon}</span><div><b>${title}</b><p>${text}</p></div></li>`).join('')}
      </ol>
      ${h.tips?.length ? `<h3 class="gold">Good to know</h3><ul class="help-tips">${h.tips.map((t) => `<li>${t}</li>`).join('')}</ul>` : ''}
      <button class="primary help-ok" style="width:100%">Got it — let's play</button>
    </div>`;
  document.body.appendChild(el);
  el.querySelector('.help-cover svg')?.setAttribute('preserveAspectRatio', 'xMidYMid slice'); // fill the banner
  el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('.help-x, .help-ok')) closeHelp(); });
  el.querySelector('.help-ok').focus({ preventScroll: true });
  sound('flip');
}
function closeHelp() {
  document.getElementById('helpModal')?.remove();
}
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeHelp(); });
// Any "?" button anywhere opens its game's guide.
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-help]');
  if (b) { e.preventDefault(); e.stopPropagation(); showHelp(b.dataset.help); }
}, true);

// First visit to a game's lobby: open its guide once, while nobody is on the clock.
function maybeAutoHelp() {
  const id = S.gameId;
  if (seenHelp(id) || helpAutoShown.has(id) || !getGame(id).howTo) return;
  helpAutoShown.add(id);
  setTimeout(() => { if (S.screen === 'lobby' && S.gameId === id && !seenHelp(id)) showHelp(id); }, 900);
}

/* ---------------- session persistence ---------------- */

// Saved in sessionStorage (survives a refresh of this tab) and localStorage
// (lets you resume after closing the browser).
function saveSession() {
  if (!S.role) return;
  const data = S.role === 'client'
    ? { role: 'client', code: S.code, token: S.token }
    : { role: S.role, code: S.code, token: S.token, gameId: S.gameId, players: S.players, started: S.started, game: S.game, viewAs: S.viewAs, timerSec: S.timerSec };
  const json = JSON.stringify(data);
  sessionStorage.setItem('gn-session', json);
  localStorage.setItem('gn-session', json);
}
const parse = (s) => {
  try {
    const v = JSON.parse(s);
    // Ignore sessions for games that no longer exist.
    if (v && v.role !== 'client' && !GAMES.some((g) => g.id === v.gameId)) return null;
    return v;
  } catch { return null; }
};
const loadTabSession = () => parse(sessionStorage.getItem('gn-session'));
const loadSession = () => loadTabSession() || parse(localStorage.getItem('gn-session'));
const clearSession = () => { sessionStorage.removeItem('gn-session'); localStorage.removeItem('gn-session'); };

function resume(session) {
  adoptToken(session.token);
  if (session.role === 'client') joinRoom(session.code);
  else if (session.role === 'host') hostRoom(session.gameId, session);
  else localRoom(session.gameId, session);
}

function cleanup() {
  clearTimeout(retryTimer);
  clearTimeout(turnTimer);
  turnTimer = null;
  timedGame = null;
  S.timer = null;
  retries = 0;
  for (const c of conns.values()) try { c.close(); } catch {}
  conns.clear();
  if (hostConn) try { hostConn.close(); } catch {}
  hostConn = null;
  if (peer) try { peer.destroy(); } catch {}
  peer = null;
}

function leave() {
  if (S.role === 'host' && S.started && !confirm('Leave and close this room for everyone?')) return;
  cleanup();
  clearSession();
  Object.assign(S, { screen: 'home', role: null, code: null, players: [], started: false, game: null, view: null, status: '' });
  history.replaceState(null, '', location.pathname);
  render();
}

/* ---------------- host ---------------- */

function hostRoom(gameId, resume = null) {
  cleanup();
  Object.assign(S, {
    role: 'host',
    code: resume?.code || randomCode(),
    gameId: resume?.gameId || gameId,
    players: resume?.players?.map((p) => ({ ...p, connected: p.id === S.token })) || [{ id: S.token, name: S.name, connected: true }],
    started: resume?.started || false,
    timerSec: resume?.timerSec ?? defaultTimer(getGame(resume?.gameId || gameId)),
    timer: null,
    game: resume?.game || null,
    screen: resume?.started ? 'game' : 'lobby',
    status: 'connecting',
  });
  const me = S.players.find((p) => p.id === S.token);
  if (me) me.name = S.name;
  refreshLocalView();
  render();
  scheduleBots();
  openHostPeer(!!resume);
}

// Reconnect to the matchmaking server after a drop. Bound to one Peer object so a
// timer from a room you already left can never touch the next room.
function keepAlive(p) {
  p.on('disconnected', () => {
    if (p !== peer || p.destroyed) return;
    S.status = 'reconnecting';
    render();
    setTimeout(() => {
      if (p === peer && !p.destroyed && p.disconnected) try { p.reconnect(); } catch {}
    }, 1500);
  });
}

function openHostPeer(isResume) {
  const p = (peer = new Peer(roomPeerId(S.code), peerOptions()));
  p.on('open', () => {
    if (p !== peer) return;
    retries = 0;
    S.status = 'online';
    saveSession();
    render();
  });
  p.on('connection', (conn) => {
    if (p !== peer) return conn.close();
    conn.on('data', (msg) => onHostMessage(conn, msg));
    conn.on('close', () => onConnClosed(conn));
    conn.on('error', () => onConnClosed(conn));
  });
  keepAlive(p);
  p.on('error', (err) => {
    if (p !== peer) return;
    if (err.type === 'unavailable-id') {
      p.destroy();
      if (isResume && retries++ < 8) {
        // The broker may still remember our old connection for a few seconds.
        S.status = 'reclaiming room…';
        render();
        retryTimer = setTimeout(() => openHostPeer(true), 3000);
      } else {
        S.code = randomCode();
        openHostPeer(false);
      }
    } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
      S.status = 'offline';
      render();
      toast('Lost connection to the matchmaking server. Retrying…');
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => { if (p !== peer) return; p.destroy(); openHostPeer(true); }, 4000);
    } else if (err.type !== 'peer-unavailable') {
      console.warn(err);
    }
  });
}

function onHostMessage(conn, msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.t === 'hello') {
    const name = String(msg.name || 'Player').slice(0, 20);
    let p = S.players.find((x) => x.id === msg.token);
    if (!p) {
      if (S.started) return reject(conn, 'That game has already started.');
      if (S.players.length >= MAX_ROOM) return reject(conn, 'Room is full.');
      p = { id: String(msg.token), name, connected: true };
      S.players.push(p);
    }
    p.name = name;
    p.connected = true;
    const old = conns.get(p.id);
    if (old && old !== conn) try { old.close(); } catch {}
    conn.pid = p.id;
    conns.set(p.id, conn);
    saveSession();
    broadcast();
  } else if (msg.t === 'action' && conn.pid) {
    const err = applyAction(conn.pid, msg.action);
    if (err) conn.open && conn.send({ t: 'error', msg: err });
  }
}

function reject(conn, msg) {
  conn.send({ t: 'error', msg, fatal: true });
  setTimeout(() => conn.close(), 500);
}

function onConnClosed(conn) {
  if (!conn.pid || conns.get(conn.pid) !== conn) return;
  conns.delete(conn.pid);
  const p = S.players.find((x) => x.id === conn.pid);
  if (p) p.connected = false;
  broadcast();
}

function applyAction(pid, action) {
  if (!S.started || !action) return 'Game not running.';
  const g = getGame(S.gameId);
  const next = structuredClone(S.game);
  try {
    g.act(next, pid, action);
  } catch (e) {
    return e.message || String(e);
  }
  S.game = next;
  if (S.role === 'local') followTurn();
  saveSession();
  broadcast();
  return null;
}

const isBot = (id) => !!S.players.find((p) => p.id === id)?.bot;

// One-device mode: hand the screen to the next human who must act.
function followTurn() {
  const g = getGame(S.gameId);
  const t = (g.turnOf?.(S.game) || []).filter((id) => !isBot(id));
  if (t.length && !t.includes(S.viewAs)) S.viewAs = t[0];
  if (!S.viewAs || isBot(S.viewAs)) S.viewAs = S.players.find((p) => !p.bot)?.id;
}

// The host's browser plays for the bots, using only what that bot could see.
function scheduleBots() {
  clearTimeout(botTimer);
  if (!S.started || S.role === 'client' || !S.game || S.game.over) return;
  const g = getGame(S.gameId);
  if (!g.bot || !g.turnOf) return;
  const due = (g.turnOf(S.game) || []).filter(isBot);
  if (!due.length) return;
  botTimer = setTimeout(() => {
    const id = due[Math.floor(Math.random() * due.length)];
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

function viewFor(pid) {
  if (!S.started) return null;
  const g = getGame(S.gameId);
  return g.view ? g.view(S.game, pid) : S.game;
}
function refreshLocalView() {
  S.view = viewFor(myId());
}

/* ---------------- turn timer (host) ---------------- */

// Start the clock whenever the game moves on and a human must act.
// The clock only restarts when the game state changes, not on reconnects.
function armTimer() {
  const g = getGame(S.gameId);
  const due = S.started && S.game && !S.game.over && S.timerSec && g.onTimeout
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
function expireTimer() {
  turnTimer = null;
  const g = getGame(S.gameId);
  if (!S.started || !S.game || S.game.over) return;
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

function notice(msg) {
  for (const c of conns.values()) if (c.open) c.send({ t: 'notice', msg });
  toast(msg, 'info');
}

function broadcast() {
  if (S.role !== 'client') armTimer();
  const now = Date.now();
  for (const p of S.players) {
    if (p.id === S.token || S.role === 'local') continue;
    const c = conns.get(p.id);
    if (c && c.open) {
      c.send({ t: 'sync', code: S.code, players: S.players, gameId: S.gameId, started: S.started, hostId: S.token, view: viewFor(p.id), timerSec: S.timerSec, timer: S.timer, now });
    }
  }
  refreshLocalView();
  render();
  scheduleBots();
}

function addBot() {
  if (S.players.length >= MAX_ROOM) return toast('Room is full.');
  const used = new Set(S.players.map((p) => p.name));
  const name = (BOT_NAMES.find((n) => !used.has(n + ' 🤖')) || 'Bot' + S.players.length) + ' 🤖';
  S.players.push({ id: 'B' + uid(), name, connected: true, bot: true });
  saveSession();
  broadcast();
}

function startGame() {
  const g = getGame(S.gameId);
  const n = S.players.length;
  if (n < g.minPlayers || n > g.maxPlayers) return toast(`${g.name} needs ${g.minPlayers}–${g.maxPlayers} players.`);
  S.game = g.setup(S.players.map((p) => ({ id: p.id, name: p.name })));
  S.started = true;
  S.screen = 'game';
  botFails = 0;
  if (S.role === 'local') { S.viewAs = null; followTurn(); }
  saveSession();
  broadcast();
}

function endGame() {
  if (!confirm('End this game and go back to the lobby?')) return;
  S.started = false;
  S.game = null;
  S.screen = 'lobby';
  saveSession();
  broadcast();
}

/* ---------------- local (one device) ---------------- */

function localRoom(gameId, resume = null) {
  cleanup();
  Object.assign(S, {
    role: 'local',
    code: null,
    gameId: resume?.gameId || gameId,
    players: resume?.players || [{ id: 'L1', name: S.name || 'Player 1', connected: true }, { id: 'L2', name: 'Player 2', connected: true }],
    started: resume?.started || false,
    timerSec: resume?.timerSec ?? defaultTimer(getGame(resume?.gameId || gameId)),
    timer: null,
    game: resume?.game || null,
    viewAs: resume?.viewAs || 'L1',
    screen: resume?.started ? 'game' : 'lobby',
    status: 'one device',
  });
  refreshLocalView();
  saveSession();
  render();
  scheduleBots();
}

/* ---------------- client ---------------- */

function joinRoom(code) {
  cleanup();
  Object.assign(S, { role: 'client', code: code.toUpperCase().trim(), screen: 'lobby', status: 'connecting', players: [], started: false, view: null, synced: false });
  history.replaceState(null, '', '?room=' + S.code);
  saveSession();
  render();
  openClientPeer();
}

function openClientPeer() {
  const p = (peer = new Peer(peerOptions()));
  p.on('open', () => p === peer && connectToHost());
  keepAlive(p);
  p.on('error', (err) => {
    if (p !== peer) return;
    if (err.type === 'peer-unavailable') {
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

function cleanupPeerOnly() {
  if (hostConn) try { hostConn.close(); } catch {}
  hostConn = null;
  if (peer) try { peer.destroy(); } catch {}
  peer = null;
}

function connectToHost() {
  if (!peer || peer.destroyed) return;
  const conn = peer.connect(roomPeerId(S.code), { reliable: true });
  hostConn = conn;
  conn.on('open', () => {
    retries = 0;
    S.status = 'online';
    conn.send({ t: 'hello', token: S.token, name: S.name });
    render();
  });
  conn.on('data', onClientMessage);
  conn.on('close', () => {
    if (hostConn !== conn) return;
    S.status = 'disconnected';
    render();
    scheduleClientRetry();
  });
  // If WebRTC can't get through (strict NAT), the connection never opens.
  setTimeout(() => {
    if (hostConn === conn && !conn.open && S.status === 'connecting') {
      S.status = 'cannot reach host';
      render();
      scheduleClientRetry();
    }
  }, 15000);
}

function scheduleClientRetry() {
  clearTimeout(retryTimer);
  if (S.role !== 'client') return;
  // A room we were in may just be refreshing, so keep trying for a minute.
  // A code that never answered is probably mistyped: stop after ~15 seconds.
  if (retries++ > (S.synced ? 20 : 4)) { S.status = S.synced ? 'gave up — tap Retry' : 'not found'; render(); return; }
  retryTimer = setTimeout(() => {
    if (peer && !peer.destroyed && peer.open) connectToHost();
    else { cleanupPeerOnly(); openClientPeer(); }
  }, 3000);
}

function onClientMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.t === 'sync') {
    Object.assign(S, { players: msg.players, gameId: msg.gameId, started: msg.started, view: msg.view, hostId: msg.hostId, synced: true, timerSec: msg.timerSec || 0, timer: msg.timer || null });
    if (msg.now) clockSkew = msg.now - Date.now();
    S.screen = S.started ? 'game' : 'lobby';
    render();
  } else if (msg.t === 'notice') {
    toast(msg.msg, 'info');
  } else if (msg.t === 'error') {
    toast(msg.msg);
    if (msg.fatal) { cleanup(); clearSession(); S.screen = 'home'; S.role = null; render(); }
  }
}

/* ---------------- actions from the UI ---------------- */

function send(action) {
  if (S.role === 'client') {
    if (!hostConn || !hostConn.open) return toast('Not connected to the host yet.');
    hostConn.send({ t: 'action', action });
  } else {
    const err = applyAction(myId(), action);
    if (err) toast(err);
  }
}

/* ---------------- rendering ---------------- */

function render() {
  renderTopbar();
  if (S.screen === 'home') renderHome();
  else if (S.screen === 'lobby') renderLobby();
  else renderGame();
}

function renderTopbar() {
  const online = S.status === 'online' || S.status === 'one device';
  topinfo.innerHTML = `
    ${S.code ? `<span>Room <b class="gold">${esc(S.code)}</b></span>` : ''}
    ${S.role ? `<span><span class="dot ${online ? 'on' : 'off'}"></span> <span class="status-text">${esc(S.status)}</span></span>` : ''}
    <button class="small icon" id="muteBtn" title="Sound on/off">${isMuted() ? '🔇' : '🔊'}</button>
    ${S.role ? '<button class="small" id="leaveBtn">Leave</button>' : ''}`;
  topinfo.querySelector('#muteBtn').onclick = () => { setMuted(!isMuted()); renderTopbar(); if (!isMuted()) sound('chime'); };
  const lb = topinfo.querySelector('#leaveBtn');
  if (lb) lb.onclick = leave;
}

function renderHome() {
  const session = loadSession();
  const roomParam = new URLSearchParams(location.search).get('room') || '';
  app.innerHTML = `
    <div class="hero">
      <h1>Game Night</h1>
      <p>Beautiful strategy games to play with friends. Free, no sign-up, on any phone or computer.</p>
    </div>
    <div class="home-top">
      <div class="panel stack">
        <h3 class="gold">Your name</h3>
        <input id="nameIn" maxlength="20" placeholder="Enter your name" value="${esc(S.name)}" style="width:100%" />
        ${session ? `<div class="row"><span class="muted small grow">Unfinished: ${session.role === 'client' ? 'room ' + esc(session.code) : esc(getGame(session.gameId)?.name || 'game')}</span><button class="primary small" id="resumeBtn">Resume</button><button class="small icon" id="forgetBtn" title="Forget">✕</button></div>` : ''}
      </div>
      <div class="panel stack">
        <h3 class="gold">Join a friend's table</h3>
        <div class="row">
          <input id="codeIn" class="code grow" maxlength="6" placeholder="CODE" value="${esc(roomParam)}" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="go" aria-label="Room code" />
          <button class="primary" id="joinBtn">Join</button>
        </div>
      </div>
    </div>
    <div class="section-title">Choose a game</div>
    <div class="games-grid">
      ${GAMES.map((g) => `
        <div class="game-card">
          <div class="cover">${g.cover || ''}<span class="badge">${g.minPlayers === g.maxPlayers ? g.minPlayers : g.minPlayers + '–' + g.maxPlayers} players</span>${helpBtn(g.id, 'on-cover')}</div>
          <div class="body">
            <h3>${esc(g.name)}</h3>
            <p>${esc(g.description)}</p>
            <div class="row">
              <button class="primary" data-host="${g.id}">Host online</button>
              <button data-local="${g.id}" title="Pass one device around, or play against bots">One device</button>
            </div>
          </div>
        </div>`).join('')}
    </div>`;

  const nameIn = app.querySelector('#nameIn');
  const storeName = () => {
    S.name = nameIn.value.trim().slice(0, 20);
    localStorage.setItem('gn-name', S.name);
    sessionStorage.setItem('gn-name', S.name);
  };
  const needName = () => {
    storeName();
    if (!S.name) { toast('Please enter your name first.'); nameIn.focus(); return false; }
    return true;
  };
  nameIn.oninput = storeName;
  const codeIn = app.querySelector('#codeIn');
  const doJoin = () => {
    if (!needName()) return;
    const code = codeIn.value.trim().toUpperCase();
    if (code.length < 4) return toast('Enter the room code from your friend.');
    joinRoom(code);
  };
  app.querySelector('#joinBtn').onclick = doJoin;
  // Never return a value from a key handler: returning false cancels the key (no typing on iPhone).
  codeIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });
  // Keep the code tidy as people type: uppercase letters only.
  codeIn.addEventListener('input', () => {
    const v = codeIn.value.toUpperCase().replace(/[^A-Z]/g, '');
    if (v !== codeIn.value) codeIn.value = v;
  });
  app.querySelectorAll('[data-host]').forEach((b) => (b.onclick = () => needName() && hostRoom(b.dataset.host)));
  app.querySelectorAll('[data-local]').forEach((b) => (b.onclick = () => { S.name = nameIn.value.trim(); localRoom(b.dataset.local); }));
  if (session) {
    app.querySelector('#resumeBtn').onclick = () => {
      if (!needName()) return;
      resume(session);
    };
    app.querySelector('#forgetBtn').onclick = () => { clearSession(); render(); };
  }
  if (roomParam && S.name && !session) codeIn.focus();
}

// Joining, before the host has answered: no player list or game yet.
function renderJoining() {
  const lost = S.status === 'not found';
  app.innerHTML = `
    <div class="lobby stack">
      <div class="panel stack" style="text-align:center">
        <div class="muted">Room code</div>
        <div class="roomcode">${esc(S.code)}</div>
        ${lost ? `
          <h3 class="gold" style="margin:0">No open room with this code</h3>
          <p class="muted" style="margin:0">Check the code with your friend. Their game page must stay open while you join.</p>
          <div class="row" style="justify-content:center"><button class="primary" id="retryBtn">Try again</button><button id="backBtn">Back</button></div>`
        : `<p class="muted" style="margin:0">Looking for the room… <span class="small">(${esc(S.status)})</span></p>
          <div class="row" style="justify-content:center"><button id="backBtn">Cancel</button></div>`}
      </div>
    </div>`;
  const retry = app.querySelector('#retryBtn');
  if (retry) retry.onclick = () => joinRoom(S.code);
  app.querySelector('#backBtn').onclick = leave;
}

function renderLobby() {
  if (S.role === 'client' && !S.synced) return renderJoining();
  maybeAutoHelp();
  const g = getGame(S.gameId);
  const isHost = S.role === 'host' || S.role === 'local';
  const link = S.code ? `${location.origin}${location.pathname}?room=${S.code}` : '';
  const n = S.players.length;
  const canStart = n >= g.minPlayers && n <= g.maxPlayers;
  app.innerHTML = `
    <div class="lobby stack">
      ${S.code ? `
      <div class="panel stack" style="text-align:center">
        <div class="muted">Room code</div>
        <div class="roomcode">${esc(S.code)}</div>
        ${S.role === 'host' ? `
        <div class="muted small">Friends open this site and type the code, or use the link:</div>
        <div class="row" style="justify-content:center">
          <input readonly value="${esc(link)}" class="grow" id="linkIn" style="min-width:0" />
          <button class="primary" id="shareBtn">${navigator.share ? 'Share' : 'Copy'}</button>
        </div>` : ''}
      </div>` : ''}
      <div class="panel stack">
        <div class="row"><h3 class="grow gold" style="margin:0">Players (${n})</h3><span class="muted small">${esc(g.name)}: ${g.minPlayers}–${g.maxPlayers}</span></div>
        <ul class="plist">
          ${S.players.map((p) => `
            <li data-k="lp-${esc(p.id)}">
              <span class="dot ${p.connected ? 'on' : 'off'}"></span>
              <span class="grow">${esc(p.name)}</span>
              ${p.id === (S.hostId || S.token) && S.role !== 'local' ? '<span class="tag">HOST</span>' : ''}
              ${p.id === S.token && S.role !== 'local' ? '<span class="tag">YOU</span>' : ''}
              ${p.bot ? '<span class="tag">BOT</span>' : ''}
              ${isHost && p.id !== S.token && (S.role === 'local' || !p.connected || p.bot) ? `<button class="small bad" data-kick="${esc(p.id)}">Remove</button>` : ''}
            </li>`).join('')}
        </ul>
        ${S.role === 'local' ? `
          <div class="row"><input id="addName" class="grow" maxlength="20" placeholder="Add player name" style="min-width:0" /><button id="addBtn">Add</button></div>` : ''}
        ${isHost && g.bot ? `<button id="botBtn" style="width:100%">🤖 Add a computer player</button>` : ''}
      </div>
      ${isHost ? `
      <div class="panel stack">
        <div class="row"><h3 class="gold grow" style="margin:0">Game</h3>${g.howTo ? `<button class="small" data-help="${g.id}">? How to play</button>` : ''}</div>
        ${g.cover ? `<div class="lobby-cover">${g.cover}</div>` : ''}
        <select id="gameSel" style="width:100%">
          ${GAMES.map((x) => `<option value="${x.id}" ${x.id === S.gameId ? 'selected' : ''}>${esc(x.name)} (${x.minPlayers}–${x.maxPlayers})</option>`).join('')}
        </select>
        ${g.onTimeout ? `
        <label class="row" style="justify-content:space-between">
          <span>⏱ Time per move</span>
          <select id="timerSel">
            ${[0, 15, 30, 45, 60, 90].map((t) => `<option value="${t}" ${t === S.timerSec ? 'selected' : ''}>${t ? t + ' seconds' : 'No timer'}</option>`).join('')}
          </select>
        </label>` : ''}
        <button class="primary" id="startBtn" ${canStart ? '' : 'disabled'} style="width:100%">
          ${canStart ? 'Start game' : n < g.minPlayers ? `Waiting for ${g.minPlayers - n} more player(s)…` : `Too many players (max ${g.maxPlayers})`}
        </button>
      </div>` : `
      <div class="panel" style="text-align:center">
        ${S.status === 'online' ? `<div class="stack">
          <div>Waiting for the host to start <b>${esc(g?.name || '')}</b>…</div>
          ${S.timerSec ? `<div class="muted small">⏱ ${S.timerSec} seconds per move</div>` : ''}
          ${g?.howTo ? `<div><button class="small" data-help="${g.id}">? How to play while you wait</button></div>` : ''}</div>` : `<div class="stack"><div>Status: ${esc(S.status)}</div><button id="retryBtn">Retry</button></div>`}
      </div>`}
    </div>`;

  if (S.role === 'host') {
    app.querySelector('#shareBtn').onclick = async () => {
      if (navigator.share) {
        try { await navigator.share({ title: 'Join my game', text: `Join my ${g.name} game! Code: ${S.code}`, url: link }); } catch {}
      } else {
        try { await navigator.clipboard.writeText(link); toast('Link copied!', 'info'); } catch { app.querySelector('#linkIn').select(); }
      }
    };
  }
  if (isHost) {
    app.querySelector('#gameSel').onchange = (e) => { S.gameId = e.target.value; S.timerSec = defaultTimer(getGame(S.gameId)); saveSession(); broadcast(); };
    const timerSel = app.querySelector('#timerSel');
    if (timerSel) timerSel.onchange = (e) => { S.timerSec = +e.target.value; saveSession(); broadcast(); };
    app.querySelector('#startBtn').onclick = startGame;
    const botBtn = app.querySelector('#botBtn');
    if (botBtn) botBtn.onclick = addBot;
    app.querySelectorAll('[data-kick]').forEach((b) => (b.onclick = () => {
      S.players = S.players.filter((p) => p.id !== b.dataset.kick);
      saveSession();
      broadcast();
    }));
  }
  if (S.role === 'local') {
    const addIn = app.querySelector('#addName');
    const add = () => {
      const name = addIn.value.trim().slice(0, 20) || `Player ${S.players.length + 1}`;
      if (S.players.length >= MAX_ROOM) return toast('Room is full.');
      S.players.push({ id: 'L' + uid(), name, connected: true });
      saveSession();
      render();
      app.querySelector('#addName').focus();
    };
    app.querySelector('#addBtn').onclick = add;
    addIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  }
  const retryBtn = app.querySelector('#retryBtn');
  if (retryBtn) retryBtn.onclick = () => joinRoom(S.code);
}

let lastGameKey = '';

function renderGame() {
  const g = getGame(S.gameId);
  if (!S.view) { app.innerHTML = '<div class="panel">Loading…</div>'; lastGameKey = ''; return; }
  // Redrawing a big board costs phone battery: skip it when nothing visible changed
  // (reconnects, repeated syncs).
  const key = JSON.stringify([S.gameId, myId(), S.view, S.players.map((p) => [p.id, p.name, p.connected])]);
  if (key === lastGameKey && app.querySelector('#gamebox')) { tickTimer(); return; }
  lastGameKey = key;
  const isHost = S.role === 'host' || S.role === 'local';
  const turn = g.turnOf ? g.turnOf(S.view) : [];
  const myTurn = turn.includes(myId());
  if (myTurn && !wasMyTurn && S.role !== 'local') {
    // Browsers only allow vibration after the player has tapped the page.
    if (navigator.userActivation?.hasBeenActive) try { navigator.vibrate?.(80); } catch {}
    sound('turn');
    wake(); // let the "your move" glows play
  }
  wasMyTurn = myTurn;
  document.title = (myTurn && S.role !== 'local' ? '🔔 Your turn — ' : '') + g.name + ' — Game Night';

  const before = snapshot(app);
  const hadModal = !!app.querySelector('.modal');
  const humans = S.players.filter((p) => !p.bot);
  app.innerHTML = `
    <div class="game-head">
      <h2>${esc(g.name)}</h2>
      ${helpBtn(g.id)}
      <div id="turnTimer" class="turn-timer" hidden></div>
      ${S.role === 'local' && humans.length > 1 ? `<label class="small muted">Playing as
        <select id="viewAs">${humans.map((p) => `<option value="${esc(p.id)}" ${p.id === S.viewAs ? 'selected' : ''}>${esc(p.name)}${turn.includes(p.id) ? ' ◀' : ''}</option>`).join('')}</select></label>` : ''}
      ${isHost ? `<button class="small" id="restartBtn">New game</button><button class="small" id="lobbyBtn">Lobby</button>` : ''}
    </div>
    <div id="gamebox"></div>`;

  const ctx = {
    me: myId(),
    players: S.players,
    name: playerName,
    isBot,
    send,
    isHost,
    local: S.role === 'local',
  };
  const box = app.querySelector('#gamebox');
  try {
    g.render(box, S.view, ctx);
  } catch (e) {
    console.error(e);
    box.innerHTML = `<div class="panel">Display error: ${esc(e.message)}</div>`;
  }
  // A dialog that was already open shouldn't pop in again on every update.
  if (hadModal) app.querySelectorAll('.modal, .modal-bg').forEach((m) => (m.style.animation = 'none'));
  try {
    flip(app, before);
    lastFxSeq = playFx(app, before, S.view.fx, lastFxSeq);
  } catch (e) {
    console.warn('animation error', e);
  }
  if (changed('over', !!S.view.over) && S.view.over) {
    // Let the game finish its own end-of-game animation first.
    let waited = 0;
    const celebrate = () => {
      if (g.isAnimating?.() && (waited += 300) < 20000) return setTimeout(celebrate, 300);
      confetti();
      sound('win');
    };
    celebrate();
  }

  tickTimer();
  // CSS animations start a frame after insertion; then pause new loops if the player is idle.
  requestAnimationFrame(settleLoops);
  const viewAs = app.querySelector('#viewAs');
  if (viewAs) viewAs.onchange = (e) => { S.viewAs = e.target.value; saveSession(); refreshLocalView(); render(); };
  if (isHost) {
    app.querySelector('#lobbyBtn').onclick = endGame;
    app.querySelector('#restartBtn').onclick = () => {
      if (!S.view.over && !confirm('Restart the game from the beginning?')) return;
      startGame();
    };
  }
}

/* ---------------- turn timer display ---------------- */

// Updates once a second; the bar slides smoothly with a CSS transition, so the
// phone only repaints this small pill.
function tickTimer() {
  const el = document.getElementById('turnTimer');
  if (!el) return;
  const t = S.timer;
  if (!t || !S.started || S.screen !== 'game' || S.view?.over) { el.hidden = true; return; }
  const now = Date.now() + (S.role === 'client' ? clockSkew : 0);
  const ms = Math.max(0, t.deadline - now);
  const secs = Math.ceil(ms / 1000);
  const mine = t.due.includes(myId());
  const who = mine ? 'Your move' : t.due.length > 1 ? `${t.due.length} players` : playerName(t.due[0]);
  el.hidden = false;
  el.classList.toggle('low', secs <= 10);
  el.classList.toggle('mine', mine);
  if (!el.firstChild) el.innerHTML = '<i class="tt-bar"></i><span class="tt-who"></span><b class="tt-secs"></b>';
  el.querySelector('.tt-who').textContent = '⏱ ' + who;
  el.querySelector('.tt-secs').textContent = secs + 's';
  el.querySelector('.tt-bar').style.width = Math.max(0, (ms - 1000) / t.total) * 100 + '%';
  if (mine && secs <= 5 && secs > 0 && secs !== lastTickSec) sound('click');
  lastTickSec = secs;
}
setInterval(tickTimer, 1000);

/* ---------------- boot ---------------- */

if (typeof Peer === 'undefined') {
  app.innerHTML = '<div class="panel">Could not load the multiplayer library. Check your internet connection and reload.</div>';
} else {
  // A refresh of this tab drops you straight back into your room.
  const tabSession = loadTabSession();
  if (tabSession && S.name) resume(tabSession);
  else render();
}
