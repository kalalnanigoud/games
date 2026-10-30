// Screens: home, lobby, game, how-to-play guides and the top bar.

import { esc, toast, uid } from './util.js';
import { snapshot, flip, playFx, changed, confetti, wake, settleLoops } from './fx.js';
import { sound, isMuted, setMuted } from './sound.js';
import { icon } from './icons.js';
import { portrait } from './avatar.js';
import { GAME_INFO, favorites, toggleFavorite, filterGames } from './library.js';
import { standings, tourLine } from './tour.js';
import { MAX_ROOM, S, GAMES, FILES, getGame, gameReady, loadGame, defaultTimer, defaultOpts, seated, isWatching, myId, playerName, isBot, saveSession, loadSession, clearSession } from './state.js';
import { clockSkew, voice, resume, leave, hostRoom, refreshLocalView, broadcast, addBot, startGame, requestRematch, standingIn, startTour, playTour, closeTour, endGame, localRoom, joinRoom, send, joinVoice, leaveVoice, toggleWatch } from './net.js';

export const app = document.getElementById('app');
export const topinfo = document.getElementById('topinfo');
export let wasMyTurn = false;
export let lastFxSeq = null;
export let lastTickSec = 0;

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const range = (g) => (g.minPlayers === g.maxPlayers ? `${g.minPlayers}` : `${g.minPlayers}–${g.maxPlayers}`);
const spinner = '<span class="spinner" aria-hidden="true"><i></i><i></i><i></i></span>';
// Emoji in names and option labels: the screens now carry their own icons and robot portraits.
const plain = (text) => String(text).replace(/^\p{Extended_Pictographic}️?\s*|\s*\p{Extended_Pictographic}️?$/gu, '');
const loader = (text, g) => `<div class="loader">${g?.cover ? `<div class="loader-art">${g.cover}</div>` : ''}${spinner}<div>${text}</div></div>`;

/* ---------------- how to play ---------------- */
// Each game supplies howTo = { goal, turn: [[icon, title, text]], tips: [text] }.
// The guide lives outside #app so game redraws never close it.

export const seenHelp = (id) => localStorage.getItem('gn-help-' + id) === '1';
export const helpBtn = (id, cls = '') =>
  getGame(id).howTo ? `<button class="help-btn ${cls} ${seenHelp(id) ? '' : 'new'}" data-help="${id}" title="How to play" aria-label="How to play">${icon('help')}</button>` : '';
export let helpAutoShown = new Set();

export function showHelp(id) {
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
      <button class="icon-btn help-x" aria-label="Close">${icon('close')}</button>
      ${g.cover ? `<div class="help-cover">${g.cover}</div>` : ''}
      <h2>How to play ${esc(g.name)}</h2>
      <div class="parchment help-goal"><b>${icon('trophy')} Goal</b><p>${h.goal}</p></div>
      <h3>On your turn</h3>
      <ol class="help-steps">
        ${h.turn.map(([ic, title, text]) => `<li><span class="help-ic">${ic}</span><div><b>${title}</b><p>${text}</p></div></li>`).join('')}
      </ol>
      ${h.tips?.length ? `<h3>Good to know</h3><ul class="help-tips">${h.tips.map((t) => `<li>${t}</li>`).join('')}</ul>` : ''}
      <button class="primary help-ok" style="width:100%">Got it — let's play</button>
    </div>`;
  document.body.appendChild(el);
  el.querySelector('.help-cover svg')?.setAttribute('preserveAspectRatio', 'xMidYMid slice'); // fill the banner
  el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('.help-x, .help-ok')) closeHelp(); });
  el.querySelector('.help-ok').focus({ preventScroll: true });
  sound('flip');
}
export function closeHelp() {
  document.getElementById('helpModal')?.remove();
}
addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeHelp(); closeMenu(); } });
// Any "?" button anywhere opens its game's guide.
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-help]');
  if (b) { e.preventDefault(); e.stopPropagation(); closeMenu(); showHelp(b.dataset.help); }
}, true);

// First visit to a game's lobby: open its guide once, while nobody is on the clock.
export function maybeAutoHelp() {
  const id = S.gameId;
  if (seenHelp(id) || helpAutoShown.has(id) || !getGame(id).howTo) return;
  helpAutoShown.add(id);
  setTimeout(() => { if (S.screen === 'lobby' && S.gameId === id && !seenHelp(id)) showHelp(id); }, 900);
}

/* ---------------- rendering ---------------- */

export function render() {
  renderTopbar();
  renderUpdateBar();
  if (S.screen === 'home') renderHome();
  else if (S.screen === 'lobby') renderLobby();
  else renderGame();
}

export function renderTopbar() {
  const online = S.status === 'online' || S.status === 'one device';
  const talking = S.voice.length;
  topinfo.innerHTML = `
    ${S.code ? `<span class="room-pill"><span class="wide">Room</span><b>${esc(S.code)}</b></span>` : ''}
    ${S.role ? `<span class="net-pill"><span class="dot ${online ? 'on' : 'off'}" id="netDot"></span><span class="status-text">${esc(S.status)}</span></span>` : ''}
    ${S.role === 'host' || S.role === 'client' ? (voice.active
      ? `<button class="small voice-on ${voice.muted ? 'muted' : ''}" id="micBtn" title="${voice.muted ? 'Unmute' : 'Mute'} your microphone" aria-label="${voice.muted ? 'Unmute' : 'Mute'} your microphone">${icon(voice.muted ? 'micOff' : 'mic')}<span class="count">${talking}</span></button><button class="icon-btn" id="voiceOff" title="Leave voice chat" aria-label="Leave voice chat">${icon('hangUp')}</button>`
      : `<button class="small" id="voiceBtn" title="Join voice chat${talking ? ' (' + talking + ' talking)' : ''}" aria-label="Join voice chat">${icon('headset')}${talking ? `<span class="count">${talking}</span>` : ''}</button>`) : ''}
    <button class="icon-btn" id="muteBtn" title="Sound on/off" aria-label="${isMuted() ? 'Turn sound on' : 'Turn sound off'}">${icon(isMuted() ? 'volumeOff' : 'volume')}</button>
    ${S.role ? `<button class="small" id="leaveBtn" aria-label="Leave">${icon('logout')}<span class="wide">Leave</span></button>` : ''}`;
  topinfo.querySelector('#muteBtn').onclick = () => { setMuted(!isMuted()); renderTopbar(); if (!isMuted()) sound('chime'); };
  const lb = topinfo.querySelector('#leaveBtn');
  if (lb) lb.onclick = leave;
  topinfo.querySelector('#voiceBtn')?.addEventListener('click', joinVoice);
  topinfo.querySelector('#micBtn')?.addEventListener('click', () => voice.toggleMute());
  topinfo.querySelector('#voiceOff')?.addEventListener('click', leaveVoice);
  paintNet();
}

/* ---------------- connection quality ---------------- */

const quality = (ms) => (ms == null ? '' : ms < 150 ? 'q-good' : ms < 400 ? 'q-ok' : 'q-bad');
// Round-trip times arrive every few seconds; update the dots in place instead of redrawing.
export function paintNet() {
  if (typeof document === 'undefined') return;
  const mine = S.role === 'client' ? S.net[S.token] : null;
  const top = document.getElementById('netDot');
  if (top && S.role === 'client' && S.status === 'online') {
    top.classList.remove('q-good', 'q-ok', 'q-bad');
    if (mine != null) top.classList.add(quality(mine));
    top.title = mine != null ? `Connection to the host: ${mine} ms${S.relay ? ' (through a relay)' : ''}` : 'Connected';
  }
  document.querySelectorAll('[data-net]').forEach((d) => {
    const ms = d.dataset.net === S.hostId || (S.role === 'host' && d.dataset.net === S.token) ? null : S.net[d.dataset.net];
    d.classList.remove('q-good', 'q-ok', 'q-bad');
    if (ms != null && d.classList.contains('on')) { d.classList.add(quality(ms)); d.title = `${ms} ms to the host`; }
  });
}

/* ---------------- update banner ---------------- */

// Someone in the room runs a different version of the site. Refresh the cached files, then reload.
export function renderUpdateBar() {
  let bar = document.getElementById('updateBar');
  if (!S.update || !S.role) { bar?.remove(); return; }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'updateBar';
    document.body.prepend(bar);
  }
  const text = S.update.newer ? 'A newer version of Game Night is available.' : 'This room is running an older version of Game Night. Ask the host to reload.';
  if (bar.dataset.text === text) return;
  bar.dataset.text = text;
  bar.innerHTML = `<span>${icon('refresh')} ${esc(text)}</span>${S.update.newer ? '<button class="small primary">Update now</button>' : ''}`;
  bar.querySelector('button')?.addEventListener('click', async (e) => {
    e.target.disabled = true; e.target.textContent = 'Updating…';
    // Fetch every file fresh so the reload can't pick up the old ones from the browser cache.
    await Promise.allSettled(FILES.map((file) => fetch(file, { cache: 'reload' })));
    location.reload();
  });
}

/* ---------------- home ---------------- */

const libraryFilters = { query: '', category: '', players: '', minutes: '', difficulty: '', collection: '' };
const FILTERS = [
  ['category', 'Type', [['', 'All types'], ...['Party', 'Strategy', 'Adventure', 'Cooperative'].map((x) => [x, x])]],
  ['players', 'Players', [['', 'Any group'], ...Array.from({ length: 8 }, (_, i) => [i + 1, `${i + 1} player${i ? 's' : ''}`])]],
  ['minutes', 'Estimated time', [['', 'Any length'], [15, 'Up to 15 min'], [30, 'Up to 30 min'], [60, 'Up to 60 min']]],
  ['difficulty', 'Difficulty', [['', 'Any level'], ...['Easy', 'Medium', 'Deep'].map((x) => [x, x])]],
  ['collection', 'Collection', [['', 'All games'], ['favorites', 'Favorites'], ['recent', 'Recently played']]],
];

function gameCard(g, saved) {
  const info = GAME_INFO[g.id];
  const fav = saved.includes(g.id);
  return `<article class="game-card">
    <div class="cover">${g.cover || ''}
      <div class="cover-tools">${helpBtn(g.id, 'on-cover') || '<span></span>'}
        <button class="cover-btn favorite" data-favorite="${g.id}" aria-label="Favorite ${esc(g.name)}" aria-pressed="${fav}" title="${fav ? 'Remove from favorites' : 'Add to favorites'}">${icon(fav ? 'starFill' : 'star')}</button></div>
    </div>
    <div class="body">
      <div class="cat cat-${info.category}">${info.category}${info.coop ? ' · <span class="coop">Co-op</span>' : ''}</div>
      <h3>${esc(g.name)}</h3>
      <div class="game-meta"><span>${icon('users')}${range(g)} players</span><span>${icon('clock')}${info.duration} min</span><span>${icon('level')}${info.difficulty}</span></div>
      <p>${esc(g.description)}</p>
      <div class="card-actions"><button class="primary" data-host="${g.id}">${icon('globe')}Host online</button><button data-local="${g.id}" title="Pass one device around, or play against computer players">${icon('phone')}One device</button></div>
    </div></article>`;
}

export function renderHome() {
  const session = loadSession();
  const roomParam = new URLSearchParams(location.search).get('room') || '';
  app.innerHTML = `
    <section class="home-hero">
      <div class="hero-copy">
        <span class="eyebrow">${icon('sparkle')} Free · no sign-up · any device</span>
        <h1>Game night, <span class="hl">anywhere.</span></h1>
        <p>Party games, strategy and cooperative adventures for friends near and far. Host a room, share the code, and play together.</p>
      </div>
      <div class="panel hero-card">
        <div class="field"><label for="nameIn">Your name</label>
          <input id="nameIn" maxlength="20" placeholder="What should friends call you?" value="${esc(S.name)}" autocomplete="nickname" /></div>
        <div class="field"><label for="codeIn">Join a friend's table</label>
          <div class="join-row">
            <input id="codeIn" class="code" maxlength="6" placeholder="CODE" value="${esc(roomParam)}" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="go" aria-label="Room code" />
            <button class="primary" id="joinBtn">Join</button>
          </div></div>
        ${session ? `<div class="resume-row"><span class="grow">Unfinished: <b>${session.role === 'client' ? 'room ' + esc(session.code) : esc(getGame(session.gameId)?.name || 'game')}</b></span><button class="primary small" id="resumeBtn">${icon('play')}Resume</button><button class="icon-btn ghost" id="forgetBtn" title="Forget" aria-label="Forget this game">${icon('close')}</button></div>` : ''}
      </div>
    </section>
    <section>
      <div class="library-head"><h2 class="section-title">Pick a game</h2><p id="libraryCount" class="muted small" role="status" aria-live="polite"></p></div>
      <div class="library-tools">
        <label class="library-search">${icon('search')}<input type="search" data-filter="query" placeholder="Search games" aria-label="Search games" /></label>
        ${FILTERS.map(([key, title, options]) => `<label class="pill-select"><span class="sr">${title}</span><select data-filter="${key}" aria-label="${title}">${options.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select>${icon('chevron')}</label>`).join('')}
        <button id="clearFilters" class="small ghost">${icon('close')}Clear filters</button>
      </div>
      <div id="libraryResults" class="games-grid"></div>
    </section>`;

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
  const results = app.querySelector('#libraryResults');
  const drawLibrary = () => {
    const saved = favorites();
    const games = filterGames(GAMES, libraryFilters, saved);
    app.querySelector('#libraryCount').textContent = `${games.length} of ${GAMES.length} games · times are estimates`;
    results.innerHTML = games.map((g) => gameCard(g, saved)).join('')
      || `<div class="panel library-empty">${icon('search')}<h3>No games match yet</h3><p class="muted">Try a different group size or clear your filters. Tap the star on a game to save a favorite.</p></div>`;
  };
  app.querySelectorAll('[data-filter]').forEach((input) => {
    input.value = libraryFilters[input.dataset.filter];
    input.closest('.pill-select')?.classList.toggle('set', !!input.value);
    input.addEventListener(input.type === 'search' ? 'input' : 'change', () => {
      libraryFilters[input.dataset.filter] = input.value;
      input.closest('.pill-select')?.classList.toggle('set', !!input.value);
      drawLibrary();
    });
  });
  app.querySelector('#clearFilters').onclick = () => {
    Object.keys(libraryFilters).forEach((key) => { libraryFilters[key] = ''; });
    app.querySelectorAll('[data-filter]').forEach((input) => { input.value = ''; input.closest('.pill-select')?.classList.remove('set'); });
    drawLibrary();
  };
  results.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.favorite) {
      const id = b.dataset.favorite;
      toggleFavorite(id); drawLibrary();
      if (favorites().includes(id)) sound('chime');
      (results.querySelector(`[data-favorite="${id}"]`) || app.querySelector('[data-filter="collection"]')).focus({ preventScroll: true });
    }
    if (b.dataset.host && needName()) hostRoom(b.dataset.host);
    if (b.dataset.local) { S.name = nameIn.value.trim(); localRoom(b.dataset.local); }
  });
  drawLibrary();
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
export function renderJoining() {
  const lost = S.status === 'not found';
  app.innerHTML = `
    <div class="panel center-card">
      <span class="eyebrow">Room code</span>
      <div class="roomcode">${esc(S.code)}</div>
      ${lost ? `
        <h3 style="margin:0">No open room with this code</h3>
        <p class="muted" style="margin:0">Check the code with your friend. Their game page must stay open while you join.</p>
        <div class="row" style="justify-content:center"><button class="primary" id="retryBtn">${icon('refresh')}Try again</button><button id="backBtn">Back</button></div>`
      : `${spinner}
        <p class="muted" style="margin:0">Looking for the room… <span class="small">(${esc(S.status)})</span></p>
        ${S.status === 'cannot reach host' ? '<p class="small" style="margin:0">A connection to the host could not be established. Check that their room is still open, then try switching between Wi-Fi and mobile data. You can also play together on one device.</p>' : ''}
        <div class="row" style="justify-content:center"><button id="backBtn">Cancel</button></div>`}
    </div>`;
  const retry = app.querySelector('#retryBtn');
  if (retry) retry.onclick = () => joinRoom(S.code);
  app.querySelector('#backBtn').onclick = leave;
}

/* ---------------- lobby ---------------- */

// Drawer open/closed state survives the lobby's frequent redraws.
const drawers = {};
const wideScreen = () => typeof matchMedia === 'function' && matchMedia('(min-width: 961px)').matches;
function drawer(id, ic, title, body, note = '') {
  if (!(id in drawers)) drawers[id] = id === 'game' || (wideScreen() && id !== 'tour');
  return `<details class="panel drawer" data-drawer="${id}" ${drawers[id] ? 'open' : ''}><summary>${icon(ic)}<span>${title}</span>${note ? `<span class="note">${note}</span>` : ''}${icon('chevron', 'chev')}</summary><div class="drawer-body">${body}</div></details>`;
}

// Seats sit on an ellipse around the game, clockwise: even counts from the top-left corner, odd ones from the head.
function seatPos(i, n) {
  const a = ((-90 + (360 * i) / n + (n % 2 ? 0 : -180 / n)) * Math.PI) / 180;
  return `--x:${(50 + 50 * Math.cos(a)).toFixed(2)}%;--y:${(50 + 50 * Math.sin(a)).toFixed(2)}%`;
}
const seenSeats = new Set();

function seatHTML(p, i, n, isHost) {
  const host = p.id === (S.hostId || S.token) && S.role !== 'local';
  const inVoice = S.voice.some(([id]) => id === p.id);
  const state = p.bot ? 'bot ready' : p.connected ? 'ready' : 'away';
  const fresh = !seenSeats.has(p.id) ? 'fresh' : '';
  seenSeats.add(p.id);
  const tags = [
    p.id === S.token && S.role !== 'local' ? '<span class="tag t-you">You</span>' : '',
    p.standIn ? '<span class="tag t-warn" title="A computer is playing this seat until they reconnect">Stand-in</span>' : '',
    p.id === S.successor ? `<span class="tag t-good" title="Takes over the room if the host leaves">${icon('shield')}Backup host</span>` : '',
  ].join('');
  const label = p.bot ? 'Computer' : p.connected ? 'Ready' : 'Away';
  const kick = isHost && p.id !== S.token && (S.role === 'local' || !p.connected || p.bot);
  return `<div class="seat ${state} ${fresh}" style="${seatPos(i, n)}" data-seat="${esc(p.id)}">
    <div class="seat-avatar">${portrait(p)}<span class="ready-ring"></span>
      ${host ? `<span class="seat-badge crown" title="Host">${icon('crown')}</span>` : ''}
      ${inVoice ? `<span class="seat-badge mic" title="In voice chat">${icon('mic')}</span>` : ''}</div>
    <div class="seat-name">${p.bot ? '' : `<span class="dot ${p.connected ? 'on' : 'off'}" data-net="${esc(p.id)}"></span>`}<span>${esc(plain(p.name))}</span></div>
    <div class="seat-state">${label}</div>
    ${tags ? `<div class="seat-tags">${tags}</div>` : ''}
    ${kick ? `<button class="seat-kick" data-kick="${esc(p.id)}" aria-label="Remove ${esc(p.name)}" title="Remove ${esc(p.name)}">${icon('close')}</button>` : ''}
  </div>`;
}

function openSeatHTML(i, n, action) {
  const pos = seatPos(i, n);
  if (!action) return `<div class="seat open" style="${pos}"><div class="seat-avatar">${icon('userPlus')}</div><div class="seat-name">Open seat</div><div class="seat-state" style="color:var(--muted)">Waiting…</div></div>`;
  return `<button class="seat open" style="${pos}" data-open="${action}"><span class="seat-avatar">${icon(action === 'bot' ? 'bot' : 'plus')}</span><span class="seat-name">Open seat</span><span class="seat-state" style="color:var(--muted)">${action === 'bot' ? 'Add computer' : 'Add player'}</span></button>`;
}

export function renderLobby() {
  if (S.role === 'client' && !S.synced) return renderJoining();
  maybeAutoHelp();
  const g = getGame(S.gameId);
  const info = GAME_INFO[g.id];
  const isHost = S.role === 'host' || S.role === 'local';
  const link = S.code ? `${location.origin}${location.pathname}?room=${S.code}` : '';
  const table = seated();
  const n = table.length;
  const canStart = n >= g.minPlayers && n <= g.maxPlayers;
  const me = S.players.find((p) => p.id === S.token);
  const watchers = S.players.filter((p) => p.watch);
  const seats = Math.min(MAX_ROOM, Math.max(2, g.maxPlayers, n));
  const full = S.players.length >= MAX_ROOM;
  const openAction = !isHost || full ? '' : S.role === 'local' ? 'player' : g.bot ? 'bot' : '';
  const hostName = playerName(S.hostId);

  const seatList = [
    ...table.map((p, i) => seatHTML(p, i, seats, isHost)),
    ...Array.from({ length: seats - n }, (_, k) => openSeatHTML(n + k, seats, openAction)),
  ].join('');

  const settings = isHost ? `
    <select id="gameSel" class="game-pick" aria-label="Game" ${S.tour && !S.tour.done ? 'disabled' : ''}>
      ${GAMES.map((x) => `<option value="${x.id}" ${x.id === S.gameId ? 'selected' : ''}>${esc(x.name)} (${range(x)})</option>`).join('')}
    </select>
    ${(g.options || []).map((o) => `
    <label class="opt-row"><span>${esc(plain(o.label))}</span>
      <select data-opt="${o.id}">${o.choices.map(([v, t]) => `<option value="${esc(v)}" ${S.opts[o.id] === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`).join('')}
    ${g.onTimeout ? `
    <label class="opt-row"><span>${icon('timer')}Time per move</span>
      <select id="timerSel">${[0, 15, 30, 45, 60, 90].map((t) => `<option value="${t}" ${t === S.timerSec ? 'selected' : ''}>${t ? t + ' seconds' : 'No timer'}</option>`).join('')}</select></label>` : ''}`
    : `<ul class="summary-list">
      <li><span>Game</span><b>${esc(g.name)}</b></li>
      ${S.timerSec ? `<li><span>Time per move</span><b>${S.timerSec} seconds</b></li>` : ''}
      ${(g.options || []).map((o) => `<li><span>${esc(plain(o.label))}</span><b>${esc(o.choices.find(([v]) => v === S.opts?.[o.id])?.[1] || '')}</b></li>`).join('')}
    </ul>`;
  if (S.tour) drawers.tour = drawers.tour || !S.tour.done;
  const tour = tourPanel(isHost);

  app.innerHTML = `
    <div class="lobby">
      <section class="panel stage">
        <header class="stage-head">
          <div class="grow">
            <span class="eyebrow">${S.role === 'local' ? `${icon('phone')} One device` : `${icon('users')} Lobby`}</span>
            <h2>${esc(g.name)}</h2>
            <div class="game-meta"><span>${icon('users')}${range(g)} players</span>${info ? `<span>${icon('clock')}${info.duration} min</span><span>${icon('level')}${info.difficulty}</span>` : ''}</div>
          </div>
          ${helpBtn(g.id)}
        </header>
        ${S.code ? `<div class="room-chip">
          <span class="eyebrow">Room code</span><span class="roomcode">${esc(S.code)}</span>
          ${S.role === 'host' ? `<input readonly value="${esc(link)}" class="link-in" id="linkIn" aria-label="Invite link" />
          <button class="primary small" id="shareBtn">${icon(navigator.share ? 'share' : 'copy')}${navigator.share ? 'Invite' : 'Copy link'}</button>` : ''}
        </div>` : ''}
        <div class="table" aria-label="Seats">
          <div class="table-ring"><div class="table-top">${g.cover ? `<div class="table-cover">${g.cover}</div>` : ''}</div>${seatList}</div>
        </div>
        ${watchers.length ? `<div class="watchers">${icon('eye')}<span>Watching</span>${watchers.map((p) => `<span title="${esc(p.name)}">${portrait(p)}</span>`).join('')}<span>${esc(watchers.map((p) => p.name).join(', '))}</span></div>` : ''}
        <div class="stage-actions">
          ${S.role === 'local' ? `<div class="add-row"><input id="addName" maxlength="20" placeholder="Add a player's name" aria-label="New player's name" /><button id="addBtn">${icon('userPlus')}Add</button></div>` : ''}
          ${isHost && g.bot ? `<button id="botBtn" ${full ? 'disabled' : ''}>${icon('bot')}Add a computer player</button>` : ''}
          ${S.role !== 'local' && me && !S.tour ? `<button id="watchBtn">${icon(me.watch ? 'seat' : 'eye')}${me.watch ? 'Take a seat and play' : 'Just watch this game'}</button>` : ''}
        </div>
      </section>
      <aside class="lobby-side">
        ${drawer('game', 'sliders', isHost ? 'Game settings' : 'This game', settings + (g.howTo && !isHost ? `<button class="small" data-help="${g.id}">${icon('help')}How to play while you wait</button>` : ''))}
        ${tour ? drawer('tour', 'trophy', 'Tournament', tour, S.tour ? (S.tour.done ? 'Finished' : 'In progress') : '') : ''}
        ${S.role === 'host' ? drawer('backup', 'shield', 'Backup host', `
          <select id="backupHost" aria-label="Trusted backup host"><option value="">Off — keep hidden information on this device</option>
            ${S.players.filter((p) => p.id !== S.token && !p.bot).map((p) => `<option value="${esc(p.id)}" ${p.id === S.backupHost ? 'selected' : ''}>${esc(p.name)}${p.connected ? '' : ' (disconnected)'}</option>`).join('')}
          </select>
          <p class="small muted">Optional: this person can continue hosting if you disconnect. Their device receives the entire game, including secret cards and puzzle answers. Choose someone you trust. Turning this off stops future backups; it cannot erase a copy already received.</p>`, S.backupHost ? 'On' : 'Off') : ''}
      </aside>
      <div class="start-bar">
        ${isHost ? `<button class="primary start-btn" id="startBtn" ${canStart ? '' : 'disabled'}>${canStart ? `${icon('play')}Start game` : n < g.minPlayers ? `Waiting for ${plural(g.minPlayers - n, 'more player')}…` : `Too many players (max ${g.maxPlayers})`}</button>`
        : S.status === 'online' ? `<div class="waiting-pill">${spinner}<span>Waiting for ${esc(hostName)} to start ${esc(g.name)}…</span></div>`
        : `<div class="waiting-pill"><span>Status: ${esc(S.status)}</span><button class="small" id="retryBtn">${icon('refresh')}Retry</button></div>`}
      </div>
    </div>`;

  app.querySelectorAll('details[data-drawer]').forEach((d) => d.addEventListener('toggle', () => { drawers[d.dataset.drawer] = d.open; }));
  if (S.role === 'host') {
    app.querySelector('#backupHost').onchange = (e) => { S.backupHost = e.target.value; saveSession(); broadcast(); };
    app.querySelector('#shareBtn').onclick = async () => {
      if (navigator.share) {
        try { await navigator.share({ title: 'Join my game', text: `Join my ${g.name} game! Code: ${S.code}`, url: link }); } catch {}
      } else {
        try { await navigator.clipboard.writeText(link); toast('Link copied!', 'info'); } catch { app.querySelector('#linkIn').select(); }
      }
    };
  }
  const addLocal = (name) => {
    if (S.players.length >= MAX_ROOM) return toast('Room is full.');
    S.players.push({ id: 'L' + uid(), name: name || `Player ${S.players.length + 1}`, connected: true });
    sound('click');
    saveSession();
    render();
  };
  if (isHost) {
    app.querySelector('#gameSel').onchange = (e) => { S.gameId = e.target.value; S.timerSec = defaultTimer(getGame(S.gameId)); S.opts = defaultOpts(getGame(S.gameId)); loadGame(S.gameId).catch(() => {}); saveSession(); broadcast(); };
    loadGame(S.gameId).catch(() => {}); // download it while people gather
    app.querySelectorAll('[data-opt]').forEach((sel) => (sel.onchange = () => { S.opts = { ...S.opts, [sel.dataset.opt]: sel.value }; saveSession(); broadcast(); }));
    const timerSel = app.querySelector('#timerSel');
    if (timerSel) timerSel.onchange = (e) => { S.timerSec = +e.target.value; saveSession(); broadcast(); };
    app.querySelector('#startBtn').onclick = startGame;
    const pick = (mode) => startTour(mode, [...app.querySelectorAll('[data-tg]:checked')].map((c) => c.dataset.tg));
    app.querySelector('#tourSeries')?.addEventListener('click', () => pick('series'));
    app.querySelector('#tourKnock')?.addEventListener('click', () => startTour('knockout', [S.gameId]));
    app.querySelector('#tourGo')?.addEventListener('click', playTour);
    app.querySelector('#tourClose')?.addEventListener('click', closeTour);
    const botBtn = app.querySelector('#botBtn');
    if (botBtn) botBtn.onclick = addBot;
    app.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => (b.dataset.open === 'bot' ? addBot() : addLocal(''))));
    app.querySelectorAll('[data-kick]').forEach((b) => (b.onclick = () => {
      S.players = S.players.filter((p) => p.id !== b.dataset.kick);
      S.credentials = S.credentials.filter(([id]) => id !== b.dataset.kick);
      seenSeats.delete(b.dataset.kick);
      saveSession();
      broadcast();
    }));
  }
  if (S.role === 'local') {
    const addIn = app.querySelector('#addName');
    const add = () => { addLocal(addIn.value.trim().slice(0, 20)); app.querySelector('#addName')?.focus(); };
    app.querySelector('#addBtn').onclick = add;
    addIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  }
  const watchBtn = app.querySelector('#watchBtn');
  if (watchBtn) watchBtn.onclick = () => toggleWatch(!me.watch);
  const retryBtn = app.querySelector('#retryBtn');
  if (retryBtn) retryBtn.onclick = () => joinRoom(S.code);
}

/* ---------------- game ---------------- */

export let lastGameKey = '';
let lastView = null, lastRoomKey = '';
// The game menu (secondary controls) stays open across redraws until dismissed.
let menuOpen = false, menuHTML = '';
function closeMenu() {
  if (!menuOpen) return;
  menuOpen = false;
  document.querySelector('.gh-menu')?.remove();
  document.getElementById('ghMenuBtn')?.setAttribute('aria-expanded', 'false');
}
document.addEventListener('click', (e) => { if (menuOpen && !e.target.closest('.gh-menu, #ghMenuBtn')) closeMenu(); });

export function renderGame() {
  const g = getGame(S.gameId);
  if (!S.view || !gameReady(S.gameId)) {
    app.innerHTML = loader(`Setting up ${esc(g.name)}…`, g); lastGameKey = '';
    // Guests wait for the host's next update; the host and one-device play rebuild their view now.
    if (!gameReady(S.gameId)) loadGame(S.gameId).then(() => { if (S.role !== 'client') refreshLocalView(); render(); }, () => toast('Could not load the game. Check your connection and reload.'));
    return;
  }
  // Redrawing a big board costs phone battery: skip it when nothing visible changed
  // (reconnects, repeated syncs).
  const roomKey = JSON.stringify([S.gameId, myId(), S.role, S.players, S.tour]);
  // Delta application preserves the view reference when nothing changed. Avoid
  // serializing a large drawing/board again just for a room or voice update.
  if (S.view === lastView && roomKey === lastRoomKey && app.querySelector('#gamebox')) { tickTimer(); return; }
  const key = roomKey + JSON.stringify(S.view);
  lastView = S.view; lastRoomKey = roomKey;
  if (key === lastGameKey && app.querySelector('#gamebox')) { tickTimer(); return; }
  lastGameKey = key;
  const isHost = S.role === 'host' || S.role === 'local';
  const turn = g.turnOf ? g.turnOf(S.view) : [];
  // In simultaneous games everyone can always act, so there is no "your turn" moment.
  const myTurn = turn.includes(myId()) && !g.simultaneous;
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
  const watching = S.players.filter((p) => p.watch).length;
  const tourReady = S.tour && S.view.over && S.tour.recorded === S.tour.gameNo;
  menuHTML = [
    S.role === 'local' && humans.length > 1 ? `<label>Playing as<select id="viewAs">${humans.map((p) => `<option value="${esc(p.id)}" ${p.id === S.viewAs ? 'selected' : ''}>${esc(p.name)}${turn.includes(p.id) ? ' ◀' : ''}</option>`).join('')}</select></label>` : '',
    isHost && !S.tour && !S.view.over ? `<button id="restartBtn">${icon('restart')}New game</button>` : '',
    isHost ? `<button id="lobbyBtn">${icon('door')}Back to the lobby</button>` : '',
  ].filter(Boolean).join('');
  const menu = (anim) => `<div class="gh-menu ${anim ? 'anim' : ''}" role="menu">${menuHTML}</div>`;
  const head = `
    <div class="game-head">
      <div class="gh-title"><h2>${esc(g.name)}</h2>
        ${isWatching(myId()) ? `<span class="tag">${icon('eye')}Watching</span>` : watching ? `<span class="tag t-bot" title="Spectators">${icon('eye')}${watching}</span>` : ''}</div>
      <div id="turnTimer" class="turn-timer" hidden></div>
      ${isHost && S.tour && tourReady ? `<button class="small primary" id="tourNext">${S.tour.done ? `${icon('trophy')}Results` : 'Next game ▸'}</button>` : ''}
      ${isHost && !S.tour && S.view.over ? `<button class="small primary" id="rematchBtn">${icon('rematch')}Rematch</button>` : ''}
      ${!isHost && S.view.over && !S.tour && !isWatching(myId()) ? `<button class="small" id="askRematch">${icon('rematch')}Ask for a rematch</button>` : ''}
      ${helpBtn(g.id)}
      ${menuHTML ? `<button class="icon-btn" id="ghMenuBtn" aria-label="Game menu" title="Game menu" aria-haspopup="menu" aria-expanded="${menuOpen}">${icon('more')}</button>` : ''}
      ${menuOpen && menuHTML ? menu(false) : ''}
      ${S.tour ? `<div class="tour-bar">${icon('trophy')}<span>${esc(tourLine(S.tour, (id) => getGame(id).name))}${S.tour.mode === 'series' || S.tour.done ? ' · ' + standings(S.tour).map((p) => `${esc(p.name)} ${p.wins}`).join(' · ') : ''}</span></div>` : ''}
    </div>`;
  if (!menuHTML) menuOpen = false;
  // Games that manage their own DOM (keepDom) keep #gamebox between updates, so inputs keep focus.
  const keep = g.keepDom && app.querySelector('#gamebox')?.dataset.game === g.id && app.querySelector('.game-head');
  if (keep) app.querySelector('.game-head').outerHTML = head;
  else app.innerHTML = head + `<div id="gamebox" data-game="${g.id}"></div>`;

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
    if (S.view.won === false) sound('bad');
    // Let the game finish its own end-of-game animation first.
    let waited = 0;
    const celebrate = () => {
      if (g.isAnimating?.() && (waited += 300) < 20000) return setTimeout(celebrate, 300);
      if (S.view.won !== false) { confetti(); sound('win'); }
    };
    celebrate();
  }

  tickTimer();
  // CSS animations start a frame after insertion; then pause new loops if the player is idle.
  requestAnimationFrame(settleLoops);
  const headEl = app.querySelector('.game-head');
  headEl.addEventListener('change', (e) => {
    if (e.target.id === 'viewAs') { S.viewAs = e.target.value; closeMenu(); saveSession(); refreshLocalView(); render(); }
  });
  headEl.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'ghMenuBtn') {
      if (menuOpen) return closeMenu();
      menuOpen = true;
      b.setAttribute('aria-expanded', 'true');
      b.insertAdjacentHTML('afterend', menu(true));
      headEl.querySelector('.gh-menu button, .gh-menu select')?.focus({ preventScroll: true });
    } else if (b.id === 'askRematch') { b.disabled = true; requestRematch(); }
    else if (b.id === 'rematchBtn') startGame(true);
    else if (b.id === 'tourNext') {
      if (!S.tour.done) return playTour();
      S.started = false; S.game = null; S.screen = 'lobby'; saveSession(); broadcast();
    } else if (b.id === 'restartBtn') {
      closeMenu();
      if (!S.view.over && !confirm('Restart the game from the beginning?')) return;
      startGame();
    } else if (b.id === 'lobbyBtn') { closeMenu(); endGame(); }
  });
}

/* ---------------- turn timer display ---------------- */

// Updates once a second; the bar slides smoothly with a CSS transition, so the
// phone only repaints this small pill.
export function tickTimer() {
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
  if (!el.firstChild) el.innerHTML = `<i class="tt-bar"></i><span>${icon('timer')}<span class="tt-who"></span></span><b class="tt-secs"></b>`;
  el.querySelector('.tt-who').textContent = who;
  el.querySelector('.tt-secs').textContent = secs + 's';
  el.querySelector('.tt-bar').style.width = Math.max(0, (ms - 1000) / t.total) * 100 + '%';
  if (mine && secs <= 5 && secs > 0 && secs !== lastTickSec) sound('click');
  lastTickSec = secs;
}
setInterval(tickTimer, 1000);

/* ---------------- tournaments ---------------- */

// The body of the lobby's Tournament drawer ('' when there is nothing to show).
export function tourPanel(isHost) {
  const t = S.tour;
  if (!t) {
    if (!isHost) return '';
    const n = seated().length, g = getGame(S.gameId);
    const fits = GAMES.filter((x) => n >= x.minPlayers && n <= x.maxPlayers);
    const koOk = g.minPlayers <= 2 && g.maxPlayers >= 2 && n >= 3;
    return `
      <div><b>Series</b> <span class="muted small">Everyone plays each game you tick. Every win is a point.</span></div>
      <div class="tour-games">${fits.map((x) => `<label><input type="checkbox" data-tg="${x.id}"> ${esc(x.name)}</label>`).join('') || '<span class="muted small">No game fits this many players.</span>'}</div>
      <button id="tourSeries" ${fits.length ? '' : 'disabled'}>Start series</button>
      <div><b>Knockout</b> <span class="muted small">${esc(g.name)} in one-on-one matches. Everyone else watches; winners go through.</span></div>
      <button id="tourKnock" ${koOk ? '' : 'disabled'}>${koOk ? `Start knockout (${n} players)` : 'Needs 3+ players and a game for two'}</button>`;
  }
  const table = standings(t).map((p) => `<li class="${t.champions.includes(p.id) ? 'champ' : ''}"><span class="grow">${t.champions.includes(p.id) ? '🏆 ' : ''}${esc(p.name)}</span><b>${p.wins}</b></li>`).join('');
  return `
    <div><b>${esc(tourLine(t, (id) => getGame(id).name))}</b></div>
    ${t.done ? '<div class="winner-banner">Tournament complete!</div>' : ''}
    <ol class="tour-table">${table}</ol>
    ${isHost ? `<div class="row">${t.done ? '' : `<button class="primary grow" id="tourGo" ${S.started ? 'disabled' : ''}>Play the next game ▸</button>`}<button class="small" id="tourClose">${t.done ? 'Close tournament' : 'Cancel'}</button></div>` : ''}`;
}
