// Game Night: lobby, rooms and peer-to-peer multiplayer.
//
// The host's browser holds the real game state. Other players connect to the
// host through WebRTC (PeerJS), send actions, and receive the updated state.
// No game server is needed, so the whole site can live on free static hosting.

import CONFIG from './config.js';
import { GAMES, getGame } from '../games/index.js';
import { esc, toast, randomCode, uid } from './util.js';
import { snapshot, flip, playFx, changed, confetti } from './fx.js';
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
};
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

const peerOptions = () => ({ config: { iceServers: CONFIG.iceServers }, debug: 1 });
const roomPeerId = (code) => CONFIG.roomPrefix + code;
const myId = () => (S.role === 'local' ? S.viewAs : S.token);
const playerName = (id) => S.players.find((p) => p.id === id)?.name ?? '???';

/* ---------------- session persistence ---------------- */

// Saved in sessionStorage (survives a refresh of this tab) and localStorage
// (lets you resume after closing the browser).
function saveSession() {
  if (!S.role) return;
  const data = S.role === 'client'
    ? { role: 'client', code: S.code, token: S.token }
    : { role: S.role, code: S.code, token: S.token, gameId: S.gameId, players: S.players, started: S.started, game: S.game, viewAs: S.viewAs };
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
    game: resume?.game || null,
    screen: resume?.started ? 'game' : 'lobby',
    status: 'connecting',
  });
  const me = S.players.find((p) => p.id === S.token);
  if (me) me.name = S.name;
  refreshLocalView();
  render();
  openHostPeer(!!resume);
}

function openHostPeer(isResume) {
  peer = new Peer(roomPeerId(S.code), peerOptions());
  peer.on('open', () => {
    retries = 0;
    S.status = 'online';
    saveSession();
    render();
  });
  peer.on('connection', (conn) => {
    conn.on('data', (msg) => onHostMessage(conn, msg));
    conn.on('close', () => onConnClosed(conn));
    conn.on('error', () => onConnClosed(conn));
  });
  peer.on('disconnected', () => {
    if (!peer || peer.destroyed) return;
    S.status = 'reconnecting';
    render();
    setTimeout(() => peer && !peer.destroyed && peer.reconnect(), 1500);
  });
  peer.on('error', (err) => {
    if (err.type === 'unavailable-id') {
      peer.destroy();
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
      retryTimer = setTimeout(() => { if (peer) peer.destroy(); openHostPeer(true); }, 4000);
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
  }, 850 + Math.random() * 650);
}

function viewFor(pid) {
  if (!S.started) return null;
  const g = getGame(S.gameId);
  return g.view ? g.view(S.game, pid) : S.game;
}
function refreshLocalView() {
  S.view = viewFor(myId());
}

function broadcast() {
  for (const p of S.players) {
    if (p.id === S.token || S.role === 'local') continue;
    const c = conns.get(p.id);
    if (c && c.open) {
      c.send({ t: 'sync', code: S.code, players: S.players, gameId: S.gameId, started: S.started, hostId: S.token, view: viewFor(p.id) });
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
    game: resume?.game || null,
    viewAs: resume?.viewAs || 'L1',
    screen: resume?.started ? 'game' : 'lobby',
    status: 'one device',
  });
  refreshLocalView();
  saveSession();
  render();
}

/* ---------------- client ---------------- */

function joinRoom(code) {
  cleanup();
  Object.assign(S, { role: 'client', code: code.toUpperCase().trim(), screen: 'lobby', status: 'connecting', players: [], started: false, view: null });
  history.replaceState(null, '', '?room=' + S.code);
  saveSession();
  render();
  openClientPeer();
}

function openClientPeer() {
  peer = new Peer(peerOptions());
  peer.on('open', connectToHost);
  peer.on('disconnected', () => peer && !peer.destroyed && setTimeout(() => peer && !peer.destroyed && peer.reconnect(), 1500));
  peer.on('error', (err) => {
    if (err.type === 'peer-unavailable') {
      S.status = 'host not found';
      render();
      scheduleClientRetry();
    } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
      S.status = 'offline';
      render();
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => { cleanupPeerOnly(); openClientPeer(); }, 4000);
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
  if (retries++ > 20) { S.status = 'gave up — tap Retry'; render(); return; }
  retryTimer = setTimeout(() => {
    if (peer && !peer.destroyed && peer.open) connectToHost();
    else { cleanupPeerOnly(); openClientPeer(); }
  }, 3000);
}

function onClientMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.t === 'sync') {
    Object.assign(S, { players: msg.players, gameId: msg.gameId, started: msg.started, view: msg.view, hostId: msg.hostId });
    S.screen = S.started ? 'game' : 'lobby';
    render();
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
          <input id="codeIn" class="code grow" maxlength="6" placeholder="CODE" value="${esc(roomParam)}" autocomplete="off" />
          <button class="primary" id="joinBtn">Join</button>
        </div>
      </div>
    </div>
    <div class="section-title">Choose a game</div>
    <div class="games-grid">
      ${GAMES.map((g) => `
        <div class="game-card">
          <div class="cover">${g.cover || ''}<span class="badge">${g.minPlayers === g.maxPlayers ? g.minPlayers : g.minPlayers + '–' + g.maxPlayers} players</span></div>
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
  codeIn.onkeydown = (e) => e.key === 'Enter' && doJoin();
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

function renderLobby() {
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
        <h3 class="gold" style="margin:0">Game</h3>
        ${g.cover ? `<div class="lobby-cover">${g.cover}</div>` : ''}
        <select id="gameSel" style="width:100%">
          ${GAMES.map((x) => `<option value="${x.id}" ${x.id === S.gameId ? 'selected' : ''}>${esc(x.name)} (${x.minPlayers}–${x.maxPlayers})</option>`).join('')}
        </select>
        <button class="primary" id="startBtn" ${canStart ? '' : 'disabled'} style="width:100%">
          ${canStart ? 'Start game' : n < g.minPlayers ? `Waiting for ${g.minPlayers - n} more player(s)…` : `Too many players (max ${g.maxPlayers})`}
        </button>
      </div>` : `
      <div class="panel" style="text-align:center">
        ${S.status === 'online' ? `Waiting for the host to start <b>${esc(g?.name || '')}</b>…` : `<div class="stack"><div>Status: ${esc(S.status)}</div><button id="retryBtn">Retry</button></div>`}
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
    app.querySelector('#gameSel').onchange = (e) => { S.gameId = e.target.value; saveSession(); broadcast(); };
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
    addIn.onkeydown = (e) => e.key === 'Enter' && add();
  }
  const retryBtn = app.querySelector('#retryBtn');
  if (retryBtn) retryBtn.onclick = () => joinRoom(S.code);
}

function renderGame() {
  const g = getGame(S.gameId);
  if (!S.view) { app.innerHTML = '<div class="panel">Loading…</div>'; return; }
  const isHost = S.role === 'host' || S.role === 'local';
  const turn = g.turnOf ? g.turnOf(S.view) : [];
  const myTurn = turn.includes(myId());
  if (myTurn && !wasMyTurn && S.role !== 'local') {
    try { navigator.vibrate?.(80); } catch {}
    sound('turn');
  }
  wasMyTurn = myTurn;
  document.title = (myTurn && S.role !== 'local' ? '🔔 Your turn — ' : '') + g.name + ' — Game Night';

  const before = snapshot(app);
  const hadModal = !!app.querySelector('.modal');
  const humans = S.players.filter((p) => !p.bot);
  app.innerHTML = `
    <div class="game-head">
      <h2>${esc(g.name)}</h2>
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

/* ---------------- boot ---------------- */

if (typeof Peer === 'undefined') {
  app.innerHTML = '<div class="panel">Could not load the multiplayer library. Check your internet connection and reload.</div>';
} else {
  // A refresh of this tab drops you straight back into your room.
  const tabSession = loadTabSession();
  if (tabSession && S.name) resume(tabSession);
  else render();
}
