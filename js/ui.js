// Screens: home, lobby, game, how-to-play guides and the top bar.

import { esc, toast, uid } from './util.js';
import { snapshot, flip, playFx, changed, confetti, wake, settleLoops, morph } from './fx.js';
import { sound, isMuted, setMuted } from './sound.js';
import { icon } from './icons.js';
import { portrait } from './avatar.js';
import { openModal, closeModal } from './dialog.js';
import { report } from './report.js';
import { GAME_INFO, favorites, toggleFavorite, filterGames } from './library.js';
import { standings, tourLine } from './tour.js';
import { MAX_ROOM, S, GAMES, FILES, getGame, gameReady, loadGame, defaultTimer, defaultOpts, seated, isWatching, myId, playerName, isBot, saveSession, loadSession, clearSession } from './state.js';
import { clockSkew, voice, resume, leave, hostRoom, refreshLocalView, broadcast, addBot, fitTable, startGame, requestRematch, standingIn, startTour, playTour, closeTour, endGame, localRoom, joinRoom, send, joinVoice, leaveVoice, toggleWatch } from './net.js';

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

export function showHelp(id, opener = document.activeElement) {
  const g = getGame(id);
  const h = g.howTo;
  if (!h) return;
  localStorage.setItem('gn-help-' + id, '1');
  document.querySelectorAll('.help-btn.new').forEach((b) => b.dataset.help === id && b.classList.remove('new'));
  closeHelp();
  const el = document.createElement('div');
  el.className = 'modal-bg';
  el.id = 'helpModal';
  // The close button and "Got it" stay put; only the rules in between scroll.
  el.innerHTML = `
    <div class="modal panel help" role="dialog" aria-modal="true" aria-labelledby="helpTitle">
      <button class="icon-btn help-x" aria-label="Close">${icon('close')}</button>
      <div class="help-body">
        ${g.cover ? `<div class="help-cover">${g.cover}</div>` : ''}
        <h2 id="helpTitle">How to play ${esc(g.name)}</h2>
        <div class="parchment help-goal"><b>${icon('trophy')} Goal</b><p>${h.goal}</p></div>
        <h3>On your turn</h3>
        <ol class="help-steps">
          ${h.turn.map(([ic, title, text]) => `<li><span class="help-ic">${ic}</span><div><b>${title}</b><p>${text}</p></div></li>`).join('')}
        </ol>
        ${h.tips?.length ? `<h3>Good to know</h3><ul class="help-tips">${h.tips.map((t) => `<li>${t}</li>`).join('')}</ul>` : ''}
      </div>
      <div class="help-foot"><button class="primary help-ok">Got it — let's play</button></div>
    </div>`;
  openModal(el, '.help-ok', opener);
  el.querySelector('.help-cover svg')?.setAttribute('preserveAspectRatio', 'xMidYMid slice'); // fill the banner
  el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('.help-x, .help-ok')) closeHelp(); });
  sound('flip');
}
export function closeHelp() {
  closeModal(document.getElementById('helpModal'));
}
addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeHelp(); closeMenu(); closePicker(); } });
// Any "?" button anywhere opens its game's guide. Guides only ever open on request:
// until a game's guide has been read once, its "?" button carries a gentle highlight instead.
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-help]');
  if (b) { e.preventDefault(); e.stopPropagation(); closeMenu(); showHelp(b.dataset.help, b); }
}, true);

/* ---------------- rendering ---------------- */

let lastScreenKey = '';
export function render() {
  if (S.screen !== 'game') menuOpen = false;
  if (S.screen !== 'lobby') closePicker();
  renderTopbar();
  renderUpdateBar();
  if (S.screen === 'home') renderHome();
  else if (S.screen === 'lobby') renderLobby();
  else renderGame();
  // A new screen (or the next game of a tournament) opens at the top, not at the scroll depth of the
  // button that led to it. The first draw is left to the browser's own scroll restoring.
  const screenKey = S.screen + (S.screen === 'game' ? ':' + S.gameId : '');
  if (screenKey !== lastScreenKey) {
    if (lastScreenKey) window.scrollTo(0, 0);
    lastScreenKey = screenKey;
  }
}

// Voice controls: in the top bar on the home and lobby screens, in the game bar during a game.
function voiceHTML() {
  if (S.role !== 'host' && S.role !== 'client') return '';
  const talking = S.voice.length;
  return voice.active
    ? `<button class="small voice-on ${voice.muted ? 'muted' : ''}" id="micBtn" title="${voice.muted ? 'Unmute' : 'Mute'} your microphone" aria-label="${voice.muted ? 'Unmute' : 'Mute'} your microphone">${icon(voice.muted ? 'micOff' : 'mic')}<span class="count">${talking}</span></button><button class="icon-btn" id="voiceOff" title="Leave voice chat" aria-label="Leave voice chat">${icon('hangUp')}</button>`
    : `<button class="small" id="voiceBtn" title="Join voice chat${talking ? ' (' + talking + ' talking)' : ''}" aria-label="Join voice chat">${icon('headset')}${talking ? `<span class="count">${talking}</span>` : ''}</button>`;
}
function onVoiceClick(e) {
  const b = e.target.closest('#voiceBtn, #micBtn, #voiceOff');
  if (!b) return;
  if (b.id === 'voiceBtn') joinVoice();
  else if (b.id === 'micBtn') voice.toggleMute();
  else leaveVoice();
}
const toggleSound = () => { setMuted(!isMuted()); renderTopbar(); if (!isMuted()) sound('chime'); };

export function renderTopbar() {
  // During a game the game bar takes over: one header, with everything else in its menu.
  const inGame = S.screen === 'game' && !!S.role;
  document.body.classList.toggle('in-game', inGame);
  document.body.classList.toggle('in-room', !!S.role); // phones trim the bar so voice, sound and Leave fit
  if (inGame) {
    topinfo.innerHTML = '';
    const slot = document.getElementById('ghVoice');
    if (slot) slot.innerHTML = voiceHTML();
    const dot = document.getElementById('netDot'), status = document.getElementById('ghStatus');
    if (dot) { dot.classList.toggle('on', S.status === 'online'); dot.classList.toggle('off', S.status !== 'online'); dot.title = S.status; }
    if (status) status.textContent = S.status === 'online' ? '' : S.status;
    if (menuOpen) refreshMenu();
    paintNet();
    return;
  }
  const online = S.status === 'online' || S.status === 'one device';
  topinfo.innerHTML = `
    ${S.code ? `<span class="room-pill"><span class="wide">Room</span><b>${esc(S.code)}</b></span>` : ''}
    ${S.role ? `<span class="net-pill"><span class="dot ${online ? 'on' : 'off'}" id="netDot"></span><span class="status-text">${esc(S.status)}</span></span>` : ''}
    ${voiceHTML()}
    <button class="icon-btn" id="muteBtn" title="Sound on/off" aria-label="${isMuted() ? 'Turn sound on' : 'Turn sound off'}">${icon(isMuted() ? 'volumeOff' : 'volume')}</button>
    ${S.role ? `<button class="small" id="leaveBtn" aria-label="Leave">${icon('logout')}<span class="wide">Leave</span></button>` : ''}`;
  topinfo.querySelector('#muteBtn').onclick = toggleSound;
  const lb = topinfo.querySelector('#leaveBtn');
  if (lb) lb.onclick = leave;
  topinfo.onclick = onVoiceClick;
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
  S.lobbyMode = 'game';
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
        <button class="ghost small hero-tour" id="hostTourBtn">${icon('trophy')}Host a tournament night</button>
        ${session ? `<div class="resume-row"><span class="grow">Unfinished: <b>${session.role === 'client' ? 'room ' + esc(session.code) : esc(getGame(session.gameId)?.name || 'game')}</b></span><button class="primary small" id="resumeBtn">${icon('play')}Resume</button><button class="icon-btn ghost" id="forgetBtn" title="Forget" aria-label="Forget this game">${icon('close')}</button></div>` : ''}
      </div>
    </section>
    <section>
      <div class="library-head"><h2 class="section-title">Pick a game</h2><p id="libraryCount" class="muted small" role="status" aria-live="polite"></p></div>
      <div class="library-tools">
        <label class="library-search">${icon('search')}<input type="search" data-filter="query" placeholder="Search games" aria-label="Search games" /></label>
        <div class="filter-row">
          ${FILTERS.map(([key, title, options]) => `<label class="pill-select"><span class="sr">${title}</span><select data-filter="${key}" aria-label="${title}">${options.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select>${icon('chevron')}</label>`).join('')}
          <button id="clearFilters" class="small ghost">${icon('close')}Clear filters</button>
        </div>
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
  app.querySelector('#hostTourBtn').onclick = () => { if (!needName()) return; hostRoom(GAMES[0].id); S.lobbyMode = 'tour'; broadcast(); };
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
  if (!(id in drawers)) drawers[id] = id === 'game' || id === 'tsetup' || (wideScreen() && id !== 'tour');
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

// The lobby is in one of two modes (S.lobbyMode): one game, or a tournament across several games.
// The host's tournament picks survive the lobby's frequent redraws.
// S.tourDraft is validated and restored with the room session.
const TROPHY = `<svg viewBox="0 0 160 100" aria-hidden="true"><defs>
  <linearGradient id="tro-cup" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff1b8"/><stop offset=".5" stop-color="#ffcf5c"/><stop offset="1" stop-color="#c98a1e"/></linearGradient>
  <radialGradient id="tro-glow"><stop offset="0" stop-color="#ffcf5c" stop-opacity=".55"/><stop offset="1" stop-color="#ffcf5c" stop-opacity="0"/></radialGradient></defs>
  <rect width="160" height="100" fill="#16295e"/><circle cx="80" cy="50" r="48" fill="url(#tro-glow)"/>
  ${[[22, 18, '#ff6fae', 20], [134, 22, '#4cb8ff', -25], [30, 78, '#3ee0a1', 35], [128, 80, '#ffcf5c', -15], [48, 30, '#b197fc', 60], [116, 58, '#ff8fab', 10]].map(([x, y, c, r]) => `<rect x="${x}" y="${y}" width="7" height="4" rx="1" fill="${c}" transform="rotate(${r} ${x} ${y})"/>`).join('')}
  <path d="M60 22h40v16a20 20 0 0 1-40 0z" fill="url(#tro-cup)" stroke="#9a6a14" stroke-width="1.4"/>
  <path d="M60 27h-9a9 9 0 0 0 9 15M100 27h9a9 9 0 0 1-9 15" fill="none" stroke="#e0a83a" stroke-width="3.4" stroke-linecap="round"/>
  <path d="M66 26q6 18 14 22" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="2.4" stroke-linecap="round"/>
  <rect x="76" y="57" width="8" height="11" fill="#e0a83a"/><rect x="65" y="67" width="30" height="8" rx="2" fill="url(#tro-cup)" stroke="#9a6a14" stroke-width="1.2"/>
  <rect x="59" y="75" width="42" height="6" rx="2" fill="#2a3a78"/>
  <path d="M80 30l2.2 4.6 5 .6-3.7 3.4 1 5-4.5-2.5-4.5 2.5 1-5-3.7-3.4 5-.6z" fill="#fff8d8" opacity=".9"/>
  ${[[40, 48], [122, 40], [100, 14]].map(([x, y]) => `<path d="M${x} ${y - 5}l1.3 3.7 3.7 1.3-3.7 1.3-1.3 3.7-1.3-3.7-3.7-1.3 3.7-1.3z" fill="#fff" opacity=".85"/>`).join('')}
</svg>`;

// "Change game": every game as a cover, with games that don't fit the table marked.
function chooseGame(id) {
  if (id === S.gameId) return;
  S.gameId = id; S.timerSec = defaultTimer(getGame(id)); S.opts = defaultOpts(getGame(id));
  loadGame(id).catch(() => {});
  fitTable();
  sound('click'); saveSession(); broadcast();
}
function closePicker() { closeModal(document.getElementById('pickerModal')); }
function showPicker(event) {
  const opener = event?.currentTarget || document.activeElement;
  closePicker();
  const n = seated().length;
  const el = document.createElement('div');
  el.className = 'modal-bg';
  el.id = 'pickerModal';
  el.innerHTML = `
    <div class="modal panel picker" role="dialog" aria-modal="true" aria-labelledby="pickTitle">
      <button class="icon-btn picker-x" aria-label="Close">${icon('close')}</button>
      <div class="picker-head"><h2 id="pickTitle">Choose a game</h2><p class="muted small">${plural(n, 'player')} at the table.</p></div>
      <div class="picker-grid">${GAMES.map((x) => {
        const fits = n >= x.minPlayers && n <= x.maxPlayers, info = GAME_INFO[x.id], on = x.id === S.gameId;
        return `<button class="pick-card ${on ? 'on' : ''} ${fits ? '' : 'nofit'}" data-game="${x.id}" aria-pressed="${on}">
          <span class="pick-cover">${x.cover || ''}</span>
          <span class="pick-body"><span class="pick-name">${esc(x.name)}</span>
            <span class="pick-meta">${range(x)} players${info ? ` · ${info.duration} min` : ''}</span>
            ${fits ? '' : `<span class="pick-warn">${n < x.minPlayers ? `Needs ${range(x)} players` : S.role === 'local' ? `Seats ${range(x)}: remove ${n - x.maxPlayers}` : `Seats ${range(x)}: ${n - x.maxPlayers} will watch`}</span>`}</span></button>`;
      }).join('')}</div>
    </div>`;
  openModal(el, '.pick-card.on', opener);
  el.addEventListener('click', (e) => {
    if (e.target === el || e.target.closest('.picker-x')) return closePicker();
    const card = e.target.closest('[data-game]');
    if (card) { chooseGame(card.dataset.game); closePicker(); }
  });
}

function tourSetupHTML(n) {
  const fits = GAMES.filter((x) => n >= x.minPlayers && n <= x.maxPlayers);
  const unavailable = S.tourDraft.picks.filter((id) => !fits.some((g) => g.id === id));
  const duels = GAMES.filter((x) => x.minPlayers <= 2 && x.maxPlayers >= 2);
  const series = S.tourDraft.format === 'series';
  const chip = (x, input) => `<label class="tour-pick">${input}<span>${esc(x.name)}</span></label>`;
  return `
    <div class="seg" role="radiogroup" aria-label="Tournament format">
      <button role="radio" data-format="series" aria-checked="${series}">${icon('rematch')}Series</button>
      <button role="radio" data-format="knockout" aria-checked="${!series}">${icon('users')}Knockout</button>
    </div>
    ${series ? `
      <p class="small muted">Everyone plays each game you pick, in the order you pick them. Every win is a point; the most points takes the title.</p>
      ${unavailable.length ? `<p class="small muted">Saved picks that don't fit ${plural(n, 'player')}: ${unavailable.map((id) => esc(getGame(id).name)).join(', ')}. They stay in your draft but won't be included unless the group size changes.</p>` : ''}
      <div class="tour-picks">${fits.map((x) => chip(x, `<input type="checkbox" data-tg="${x.id}" ${S.tourDraft.picks.includes(x.id) ? 'checked' : ''}>`)).join('') || '<p class="muted small">No game fits this many players.</p>'}</div>`
    : `
      <p class="small muted">One-on-one matches of one game, in a bracket. Winners go through and everyone else watches.${n >= 3 ? '' : ' Needs at least 3 players.'}</p>
      <div class="tour-picks">${duels.map((x) => chip(x, `<input type="radio" name="tourKO" data-ko="${x.id}" ${S.tourDraft.ko === x.id ? 'checked' : ''}>`)).join('')}</div>`}`;
}
// What the tournament Start button would do, or why it can't yet.
function tourPlan(n) {
  if (S.tourDraft.format === 'series') {
    const games = S.tourDraft.picks.filter((id) => { const x = getGame(id); return n >= x.minPlayers && n <= x.maxPlayers; });
    if (n < 2) return { label: 'Waiting for more players…' };
    if (!games.length) return { label: 'Pick the games to play' };
    return { label: `Start series · ${plural(games.length, 'game')}`, go: () => startTour('series', games) };
  }
  if (n < 3) return { label: `Waiting for ${plural(3 - n, 'more player')}…` };
  if (!S.tourDraft.ko) return { label: 'Pick the game for the bracket' };
  return { label: `Start knockout · ${n} players`, go: () => startTour('knockout', [S.tourDraft.ko]) };
}

export function renderLobby() {
  if (S.role === 'client' && !S.synced) return renderJoining();

  const g = getGame(S.gameId);
  const info = GAME_INFO[g.id];
  const isHost = S.role === 'host' || S.role === 'local';
  const link = S.code ? `${location.origin}${location.pathname}?room=${S.code}` : '';
  const table = seated();
  const n = table.length;
  const t = S.tour;
  const tourMode = !!t || S.lobbyMode === 'tour';
  // The table holds as many seats as the chosen game; a tournament may use the whole room.
  const limit = tourMode ? MAX_ROOM : Math.min(MAX_ROOM, g.maxPlayers);
  const canStart = n >= g.minPlayers && n <= g.maxPlayers;
  const me = S.players.find((p) => p.id === S.token);
  const watchers = S.players.filter((p) => p.watch);
  const seats = Math.min(MAX_ROOM, Math.max(tourMode ? 4 : 2, tourMode ? n : g.maxPlayers, n));
  const full = n >= limit;
  const openAction = !isHost || full ? '' : S.role === 'local' ? 'player' : g.bot || tourMode ? 'bot' : '';
  const hostName = playerName(S.hostId);

  const seatList = [
    ...table.map((p, i) => seatHTML(p, i, seats, isHost)),
    ...Array.from({ length: seats - n }, (_, k) => openSeatHTML(n + k, seats, openAction)),
  ].join('');

  // Header: the game, the tournament being set up, or the tournament in progress.
  const head = t
    ? `<span class="eyebrow">${icon('trophy')} Tournament</span><h2>${t.done ? 'Tournament complete' : esc(plain(tourLine(t, (id) => getGame(id).name)))}</h2>
       <div class="game-meta"><span>${icon('users')}${plural(t.entrants.length, 'player')}</span><span>${icon(t.mode === 'series' ? 'rematch' : 'users')}${t.mode === 'series' ? `Series · ${plural(t.games.length, 'game')}` : 'Knockout'}</span></div>`
    : tourMode
    ? `<span class="eyebrow">${icon('trophy')} Tournament</span><h2>Tournament night</h2>
       <div class="game-meta"><span>${icon('users')}${plural(n, 'player')}</span><span>${icon('sparkle')}Several games, one champion</span></div>`
    : `<span class="eyebrow">${S.role === 'local' ? `${icon('phone')} One device` : `${icon('users')} Lobby`}</span><h2>${esc(g.name)}</h2>
       <div class="game-meta"><span>${icon('users')}${range(g)} players</span>${info ? `<span>${icon('clock')}${info.duration} min</span><span>${icon('level')}${info.difficulty}</span>` : ''}</div>`;

  const settings = isHost ? `
    <button class="game-current" data-pick ${t && !t.done ? 'disabled' : ''}>
      <span class="gc-cover">${g.cover || ''}</span>
      <span class="gc-text"><span class="eyebrow">Game</span><b>${esc(g.name)}</b></span>
      <span class="gc-change">Change</span></button>
    ${(g.options || []).map((o) => `
    <label class="opt-row"><span>${esc(plain(o.label))}</span>
      <select data-opt="${o.id}">${o.choices.map(([v, tx]) => `<option value="${esc(v)}" ${S.opts[o.id] === v ? 'selected' : ''}>${esc(tx)}</option>`).join('')}</select></label>`).join('')}
    ${g.onTimeout ? `
    <label class="opt-row"><span>${icon('timer')}Time per move</span>
      <select id="timerSel">${[0, 15, 30, 45, 60, 90].map((s) => `<option value="${s}" ${s === S.timerSec ? 'selected' : ''}>${s ? s + ' seconds' : 'No timer'}</option>`).join('')}</select></label>` : ''}`
    : `<ul class="summary-list">
      <li><span>Game</span><b>${esc(g.name)}</b></li>
      ${S.timerSec ? `<li><span>Time per move</span><b>${S.timerSec} seconds</b></li>` : ''}
      ${(g.options || []).map((o) => `<li><span>${esc(plain(o.label))}</span><b>${esc(o.choices.find(([v]) => v === S.opts?.[o.id])?.[1] || '')}</b></li>`).join('')}
    </ul>${g.howTo ? `<button class="small" data-help="${g.id}">${icon('help')}How to play while you wait</button>` : ''}`;
  if (t) drawers.tour = drawers.tour || !t.done;
  const plan = !t && tourMode && isHost ? tourPlan(n) : null;

  let start;
  if (!isHost) start = S.status === 'online'
    ? `<div class="waiting-pill">${spinner}<span>Waiting for ${esc(hostName)} to start ${t ? 'the next game' : tourMode ? 'the tournament' : esc(g.name)}…</span></div>`
    : `<div class="waiting-pill"><span>Status: ${esc(S.status)}</span><button class="small" id="retryBtn">${icon('refresh')}Retry</button></div>`;
  else if (t) start = t.done
    ? `<button class="primary start-btn" id="tourClose">${icon('check')}Close the tournament</button>`
    : `<button class="primary start-btn" id="tourGo" ${S.started ? 'disabled' : ''}>${icon('play')}Play the next game</button>`;
  else if (tourMode) start = `<button class="primary start-btn" id="tourStart" ${plan.go ? '' : 'disabled'}>${plan.go ? icon('trophy') : ''}${plan.label}</button>`;
  else start = `<button class="primary start-btn" id="startBtn" ${canStart ? '' : 'disabled'}>${canStart ? `${icon('play')}Start game` : n < g.minPlayers ? `Waiting for ${plural(g.minPlayers - n, 'more player')}…` : `Too many players: ${g.name} seats ${range(g)}`}</button>`;

  app.innerHTML = `
    <div class="lobby ${tourMode ? 'tour-mode' : ''}">
      <section class="panel stage">
        ${isHost && !t ? `<div class="mode-switch" role="tablist" aria-label="What to play">
          <button role="tab" data-mode="game" aria-selected="${!tourMode}">${icon('dice')}One game</button>
          <button role="tab" data-mode="tour" aria-selected="${tourMode}">${icon('trophy')}Tournament</button></div>` : ''}
        <header class="stage-head">
          <div class="grow">${head}</div>
          ${!tourMode ? helpBtn(g.id) : ''}
          ${isHost && !tourMode ? `<button class="small" id="pickGame">${icon('dice')}<span>Change<span class="wide"> game</span></span></button>` : ''}
        </header>
        ${S.code ? `<div class="room-chip">
          <span class="eyebrow">Room code</span><span class="roomcode">${esc(S.code)}</span>
          ${S.role === 'host' ? `<input readonly value="${esc(link)}" class="link-in" id="linkIn" aria-label="Invite link" />
          <button class="primary small" id="shareBtn">${icon(navigator.share ? 'share' : 'copy')}${navigator.share ? 'Invite' : 'Copy link'}</button>` : ''}
        </div>` : ''}
        <div class="table" aria-label="Seats">
          <div class="table-ring"><div class="table-top"><div class="table-cover">${tourMode ? TROPHY : g.cover || ''}</div></div>${seatList}</div>
        </div>
        ${watchers.length ? `<div class="watchers">${icon('eye')}<span>Watching</span>${watchers.map((p) => `<span title="${esc(p.name)}">${portrait(p)}</span>`).join('')}<span>${esc(watchers.map((p) => p.name).join(', '))}</span></div>` : ''}
      </section>
      <aside class="lobby-side">
        ${t ? drawer('tour', 'trophy', 'Standings', tourPanel(isHost), t.done ? 'Finished' : 'In progress')
          : tourMode ? drawer('tsetup', 'trophy', 'Tournament setup', isHost ? tourSetupHTML(n) : `<p class="small muted">${esc(hostName)} is choosing the games. Every win is a point; the most points takes the title.</p>`)
          : drawer('game', 'sliders', isHost ? 'Game settings' : 'This game', settings)}
        ${S.role === 'host' ? drawer('backup', 'shield', 'Backup host', `
          <select id="backupHost" aria-label="Trusted backup host"><option value="">Off — keep hidden information on this device</option>
            ${S.players.filter((p) => p.id !== S.token && !p.bot).map((p) => `<option value="${esc(p.id)}" ${p.id === S.backupHost ? 'selected' : ''}>${esc(p.name)}${p.connected ? '' : ' (disconnected)'}</option>`).join('')}
          </select>
          <p class="small muted">Optional: this person can continue hosting if you disconnect. Their device receives the entire game, including secret cards and puzzle answers. Choose someone you trust. Turning this off stops future backups; it cannot erase a copy already received.</p>`, S.backupHost ? 'On' : 'Off') : ''}
      </aside>
      <div class="lobby-actions">
        ${S.role === 'local' ? `<div class="add-row"><input id="addName" maxlength="20" placeholder="${full ? 'The table is full' : 'Add a player’s name'}" aria-label="New player's name" ${full ? 'disabled' : ''} /><button id="addBtn" ${full ? 'disabled' : ''}>${icon('userPlus')}Add</button></div>` : ''}
        ${isHost && (g.bot || tourMode) ? `<button id="botBtn" ${full ? 'disabled' : ''}>${icon('bot')}Add a computer player</button>` : ''}
        ${S.role !== 'local' && me && !t ? `<button id="watchBtn" ${me.watch && full ? 'disabled title="The table is full"' : ''}>${icon(me.watch ? 'seat' : 'eye')}${me.watch ? 'Take a seat and play' : 'Just watch this game'}</button>` : ''}
        ${full && !tourMode ? `<p class="lobby-note small muted">${icon('users')}${esc(g.name)} seats ${range(g)} players${S.role === 'local' ? '' : '. Anyone else who joins watches'}.</p>` : ''}
      </div>
      <div class="start-bar">${start}</div>
    </div>`;

  app.querySelectorAll('details[data-drawer]').forEach((d) => d.addEventListener('toggle', () => { drawers[d.dataset.drawer] = d.open; }));
  if (S.role === 'host') {
    app.querySelector('#backupHost').onchange = (e) => { S.backupHost = e.target.value; saveSession(); broadcast(); };
    app.querySelector('#shareBtn').onclick = shareRoom;
  }
  const addLocal = (name) => {
    if (seated().length >= limit) return toast(`The table is full: ${g.name} seats ${range(g)}.`);
    S.players.push({ id: 'L' + uid(), name: name || `Player ${S.players.length + 1}`, connected: true });
    sound('click');
    saveSession();
    render();
  };
  if (isHost) {
    loadGame(S.gameId).catch(() => {}); // download it while people gather
    app.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => { S.lobbyMode = b.dataset.mode; if (S.lobbyMode === 'game') fitTable(); sound('click'); saveSession(); broadcast(); }));
    app.querySelector('#pickGame')?.addEventListener('click', showPicker);
    app.querySelector('[data-pick]')?.addEventListener('click', showPicker);
    app.querySelectorAll('[data-opt]').forEach((sel) => (sel.onchange = () => { S.opts = { ...S.opts, [sel.dataset.opt]: sel.value }; saveSession(); broadcast(); }));
    const timerSel = app.querySelector('#timerSel');
    if (timerSel) timerSel.onchange = (e) => { S.timerSec = +e.target.value; saveSession(); broadcast(); };
    app.querySelector('#startBtn')?.addEventListener('click', startGame);
    // Tournament setup: picks are kept in tick order, which is the order the series plays.
    app.querySelectorAll('[data-format]').forEach((b) => (b.onclick = () => { S.tourDraft.format = b.dataset.format; saveSession(); broadcast(); }));
    app.querySelectorAll('[data-tg]').forEach((c) => (c.onchange = () => {
      S.tourDraft.picks = c.checked ? [...S.tourDraft.picks.filter((id) => id !== c.dataset.tg), c.dataset.tg] : S.tourDraft.picks.filter((id) => id !== c.dataset.tg);
      saveSession(); broadcast();
    }));
    app.querySelectorAll('[data-ko]').forEach((c) => (c.onchange = () => { S.tourDraft.ko = c.dataset.ko; saveSession(); broadcast(); }));
    app.querySelector('#tourStart')?.addEventListener('click', () => { if (!plan?.go) return; S.lobbyMode = 'game'; plan.go(); });
    app.querySelector('#tourGo')?.addEventListener('click', playTour);
    app.querySelectorAll('#tourClose, #tourCancel').forEach((b) => b.addEventListener('click', closeTour));
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
// The game menu holds everything that isn't the game itself: room, tournament, sound, rules,
// host controls and Leave. A dropdown on wide screens, a bottom sheet on phones.
// It stays open across redraws until dismissed.
let menuOpen = false;
function menuBody() {
  const g = getGame(S.gameId);
  const isHost = S.role === 'host' || S.role === 'local';
  const humans = S.players.filter((p) => !p.bot);
  const turn = S.view && g.turnOf ? g.turnOf(S.view) : [];
  const t = S.tour;
  return [
    S.code ? `<div class="gh-room"><div class="grow"><span class="eyebrow">Room code</span><b class="gh-code">${esc(S.code)}</b></div>
      <span class="net-pill small"><span class="dot ${S.status === 'online' ? 'on' : 'off'}"></span>${esc(S.status)}</span>
      ${S.role === 'host' ? `<button class="small" id="ghInvite">${icon(navigator.share ? 'share' : 'copy')}${navigator.share ? 'Invite' : 'Copy link'}</button>` : ''}</div>` : '',
    t ? `<div class="gh-tour"><div class="gh-tourline">${icon('trophy')}<b>${esc(plain(tourLine(t, (id) => getGame(id).name)))}</b></div>
      ${t.mode === 'series' || t.done ? `<ol class="tour-table">${standings(t).map((p) => `<li class="${t.champions.includes(p.id) ? 'champ' : ''}"><span class="grow">${esc(p.name)}</span><b>${p.wins}</b></li>`).join('')}</ol>` : ''}</div>` : '',
    S.role === 'local' && humans.length > 1 ? `<label>Playing as<select id="viewAs">${humans.map((p) => `<option value="${esc(p.id)}" ${p.id === S.viewAs ? 'selected' : ''}>${esc(p.name)}${turn.includes(p.id) ? ' ◀' : ''}</option>`).join('')}</select></label>` : '',
    `<button id="ghSound">${icon(isMuted() ? 'volumeOff' : 'volume')}${isMuted() ? 'Turn sound on' : 'Turn sound off'}</button>`,
    g.howTo ? `<button data-help="${g.id}">${icon('help')}How to play</button>` : '',
    isHost && !t && S.view && !S.view.over ? `<button id="restartBtn">${icon('restart')}New game</button>` : '',
    isHost ? `<button id="lobbyBtn">${icon('door')}Back to the lobby</button>` : '',
    `<hr><button id="leaveBtn" class="gh-leave">${icon('logout')}${S.role === 'local' ? 'Leave this game' : 'Leave the room'}</button>`,
  ].join('');
}
const menuMarkup = (anim) => `<div class="gh-sheet ${anim ? 'anim' : ''}"><div class="gh-scrim"></div><div class="gh-menu" role="menu" aria-label="Game menu">${menuBody()}</div></div>`;
function refreshMenu() {
  const m = document.querySelector('.gh-menu');
  if (!m) return;
  const html = menuBody();
  if (m._markup === html) return;
  const focused = m.contains(document.activeElement) ? document.activeElement.id : null;
  m.innerHTML = html;
  m._markup = html;
  if (focused) m.querySelector(`#${CSS.escape(focused)}`)?.focus({ preventScroll: true });
}
function openMenu() {
  const head = document.querySelector('.game-head');
  if (!head || menuOpen) return;
  menuOpen = true;
  document.getElementById('ghMenuBtn')?.setAttribute('aria-expanded', 'true');
  head.insertAdjacentHTML('beforeend', menuMarkup(true));
  head.querySelector('.gh-menu button, .gh-menu select')?.focus({ preventScroll: true });
}
function closeMenu() {
  if (!menuOpen) return;
  const hadFocus = !!document.activeElement?.closest('.gh-menu');
  menuOpen = false;
  document.querySelector('.gh-sheet')?.remove();
  document.getElementById('ghMenuBtn')?.setAttribute('aria-expanded', 'false');
  if (hadFocus) document.getElementById('ghMenuBtn')?.focus({ preventScroll: true });
}
document.addEventListener('click', (e) => { if (menuOpen && !e.target.closest('.gh-menu, #ghMenuBtn, #ghTourBtn')) closeMenu(); });

// The host's invite link, shared from the lobby or the game menu.
async function shareRoom() {
  const link = `${location.origin}${location.pathname}?room=${S.code}`;
  if (navigator.share) {
    try { await navigator.share({ title: 'Join my game', text: `Join my ${getGame(S.gameId).name} game! Code: ${S.code}`, url: link }); } catch {}
    return;
  }
  try { await navigator.clipboard.writeText(link); toast('Link copied!', 'info'); }
  catch { const li = document.getElementById('linkIn'); if (li) li.select(); else toast(link, 'info'); }
}

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

  const menuFocus = document.activeElement?.closest('.gh-menu') ? document.activeElement.id : null;
  const before = snapshot(app);
  const hadModal = !!app.querySelector('.modal');
  const watching = S.players.filter((p) => p.watch).length;
  const tourReady = S.tour && S.view.over && S.tour.recorded === S.tour.gameNo;
  const online = S.role === 'host' || S.role === 'client';
  // One bar for the whole game: title and connection, timer, end-of-game actions, voice, rules, menu.
  // The tournament is a chip that opens the menu, where its standings live.
  const headInner = `
      <div class="gh-title">
        ${online ? `<span class="dot ${S.status === 'online' ? 'on' : 'off'}" id="netDot" title="${esc(S.status)}"></span>` : ''}
        <h2>${esc(g.name)}</h2>
        <span class="gh-status small muted" id="ghStatus">${online && S.status !== 'online' ? esc(S.status) : ''}</span>
        ${isWatching(myId()) ? `<span class="tag">${icon('eye')}Watching</span>` : watching ? `<span class="tag t-bot" title="Spectators">${icon('eye')}${watching}</span>` : ''}</div>
      <div id="turnTimer" class="turn-timer" hidden></div>
      ${S.tour ? `<button class="small gh-tourchip" id="ghTourBtn" title="Tournament standings" aria-label="Tournament standings">${icon('trophy')}<span>${S.tour.done ? 'Results' : esc(plain(tourLine(S.tour, (id) => getGame(id).name)))}</span></button>` : ''}
      ${isHost && S.tour && tourReady ? `<button class="small primary" id="tourNext">${S.tour.done ? `${icon('trophy')}Results` : 'Next game ▸'}</button>` : ''}
      ${isHost && !S.tour && S.view.over ? `<button class="small primary" id="rematchBtn">${icon('rematch')}Rematch</button>` : ''}
      ${!isHost && S.view.over && !S.tour && !isWatching(myId()) ? `<button class="small" id="askRematch">${icon('rematch')}Ask for a rematch</button>` : ''}
      <span class="gh-voice" id="ghVoice">${voiceHTML()}</span>
      ${helpBtn(g.id)}
      <button class="icon-btn" id="ghMenuBtn" aria-label="Game menu" title="Game menu" aria-haspopup="menu" aria-expanded="${menuOpen}">${icon('more')}</button>
      ${menuOpen ? menuMarkup(false) : ''}`;
  // While the same game is on screen, its area (#gamebox) stays put and the bar is updated in place,
  // so a game that redraws only what changed (morph) isn't rebuilt from scratch by the platform.
  const keep = app.querySelector('#gamebox')?.dataset.game === g.id && app.querySelector('.game-head');
  if (keep) morph(app.querySelector('.game-head'), headInner);
  else app.innerHTML = `<div class="game-head">${headInner}</div><div id="gamebox" data-game="${g.id}"></div>`;

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
    report(e, 'render');
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
  if (menuFocus) headEl.querySelector(`.gh-menu #${CSS.escape(menuFocus)}`)?.focus({ preventScroll: true });
  // The bar is kept between updates, so its handlers are properties (set, not stacked, each render).
  headEl.onchange = (e) => {
    if (e.target.id === 'viewAs') { S.viewAs = e.target.value; closeMenu(); saveSession(); refreshLocalView(); render(); }
  };
  headEl.onclick = (e) => {
    if (e.target.closest('.gh-scrim')) return closeMenu();
    const b = e.target.closest('button');
    if (!b) return;
    onVoiceClick(e);
    if (b.id === 'ghMenuBtn' || b.id === 'ghTourBtn') { if (menuOpen) closeMenu(); else openMenu(); }
    else if (b.id === 'ghSound') toggleSound();
    else if (b.id === 'ghInvite') shareRoom();
    else if (b.id === 'leaveBtn') { closeMenu(); leave(); }
    else if (b.id === 'askRematch') { b.disabled = true; requestRematch(); }
    else if (b.id === 'rematchBtn') startGame(true);
    else if (b.id === 'tourNext') {
      if (!S.tour.done) return playTour();
      S.started = false; S.game = null; S.screen = 'lobby'; saveSession(); broadcast();
    } else if (b.id === 'restartBtn') {
      closeMenu();
      if (!S.view.over && !confirm('Restart the game from the beginning?')) return;
      startGame();
    } else if (b.id === 'lobbyBtn') { closeMenu(); endGame(); }
  };
}

/* ---------------- turn timer display ---------------- */

// Updates once a second; the bar slides smoothly with a transform transition, which the
// compositor runs without repainting the pill.
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
  el.querySelector('.tt-bar').style.transform = `scaleX(${Math.max(0, (ms - 1000) / t.total)})`;
  if (mine && secs <= 5 && secs > 0 && secs !== lastTickSec) sound('click');
  lastTickSec = secs;
}
setInterval(tickTimer, 1000);

/* ---------------- tournaments ---------------- */

// The Standings drawer while a tournament is in progress ('' when there is none).
export function tourPanel(isHost) {
  const t = S.tour;
  if (!t) return '';
  const table = standings(t).map((p) => `<li class="${t.champions.includes(p.id) ? 'champ' : ''}"><span class="grow">${t.champions.includes(p.id) ? icon('crown') + ' ' : ''}${esc(p.name)}</span><b>${p.wins}</b></li>`).join('');
  return `
    ${t.done ? `<div class="winner-banner">${icon('trophy')} ${esc(plain(tourLine(t, (id) => getGame(id).name)))}</div>` : ''}
    <ol class="tour-table">${table}</ol>
    ${isHost && !t.done ? '<button class="small" id="tourCancel">Cancel the tournament</button>' : ''}`;
}
