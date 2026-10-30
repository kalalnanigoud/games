// Screens: home, lobby, game, how-to-play guides and the top bar.

import { esc, toast, uid } from './util.js';
import { snapshot, flip, playFx, changed, confetti, wake, settleLoops } from './fx.js';
import { sound, isMuted, setMuted } from './sound.js';
import { standings, tourLine } from './tour.js';
import { MAX_ROOM, S, GAMES, FILES, getGame, gameReady, loadGame, defaultTimer, defaultOpts, seated, isWatching, myId, playerName, isBot, saveSession, loadSession, clearSession } from './state.js';
import { clockSkew, voice, resume, leave, hostRoom, refreshLocalView, broadcast, addBot, startGame, requestRematch, standingIn, startTour, playTour, closeTour, endGame, localRoom, joinRoom, send, joinVoice, leaveVoice, toggleWatch } from './net.js';

export const app = document.getElementById('app');
export const topinfo = document.getElementById('topinfo');
export let wasMyTurn = false;
export let lastFxSeq = null;
export let lastTickSec = 0;

/* ---------------- how to play ---------------- */
// Each game supplies howTo = { goal, turn: [[icon, title, text]], tips: [text] }.
// The guide lives outside #app so game redraws never close it.

export const seenHelp = (id) => localStorage.getItem('gn-help-' + id) === '1';
export const helpBtn = (id, cls = '') =>
  getGame(id).howTo ? `<button class="help-btn ${cls} ${seenHelp(id) ? '' : 'new'}" data-help="${id}" title="How to play" aria-label="How to play">?</button>` : '';
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
export function closeHelp() {
  document.getElementById('helpModal')?.remove();
}
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeHelp(); });
// Any "?" button anywhere opens its game's guide.
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-help]');
  if (b) { e.preventDefault(); e.stopPropagation(); showHelp(b.dataset.help); }
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
  topinfo.innerHTML = `
    ${S.code ? `<span>Room <b class="gold">${esc(S.code)}</b></span>` : ''}
    ${S.role ? `<span><span class="dot ${online ? 'on' : 'off'}" id="netDot"></span> <span class="status-text">${esc(S.status)}</span></span>` : ''}
    ${S.role === 'host' || S.role === 'client' ? (voice.active
      ? `<button class="small voice-on ${voice.muted ? 'muted' : ''}" id="micBtn" title="${voice.muted ? 'Unmute' : 'Mute'} your microphone">${voice.muted ? '🔇' : '🎙'} ${S.voice.length}</button><button class="small icon" id="voiceOff" title="Leave voice chat">📵</button>`
      : `<button class="small icon" id="voiceBtn" title="Join voice chat${S.voice.length ? ' (' + S.voice.length + ' talking)' : ''}">🎙${S.voice.length ? '<sup>' + S.voice.length + '</sup>' : ''}</button>`) : ''}
    <button class="small icon" id="muteBtn" title="Sound on/off">${isMuted() ? '🔇' : '🔊'}</button>
    ${S.role ? '<button class="small" id="leaveBtn">Leave</button>' : ''}`;
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
  bar.innerHTML = `<span>🔄 ${esc(text)}</span>${S.update.newer ? '<button class="small primary">Update now</button>' : ''}`;
  bar.querySelector('button')?.addEventListener('click', async (e) => {
    e.target.disabled = true; e.target.textContent = 'Updating…';
    // Fetch every file fresh so the reload can't pick up the old ones from the browser cache.
    await Promise.allSettled(FILES.map((file) => fetch(file, { cache: 'reload' })));
    location.reload();
  });
}


export function renderHome() {
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
export function renderJoining() {
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
          ${S.status === 'cannot reach host' ? '<p class="small" style="margin:0">The room exists, but your networks are blocking a direct connection. Try switching between Wi-Fi and mobile data. If it keeps happening, the host can add a free TURN relay (see the README).</p>' : ''}
          <div class="row" style="justify-content:center"><button id="backBtn">Cancel</button></div>`}
      </div>
    </div>`;
  const retry = app.querySelector('#retryBtn');
  if (retry) retry.onclick = () => joinRoom(S.code);
  app.querySelector('#backBtn').onclick = leave;
}

export function renderLobby() {
  if (S.role === 'client' && !S.synced) return renderJoining();
  maybeAutoHelp();
  const g = getGame(S.gameId);
  const isHost = S.role === 'host' || S.role === 'local';
  const link = S.code ? `${location.origin}${location.pathname}?room=${S.code}` : '';
  const n = seated().length;
  const canStart = n >= g.minPlayers && n <= g.maxPlayers;
  const me = S.players.find((p) => p.id === S.token);
  const watchers = S.players.filter((p) => p.watch).length;
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
        <div class="row"><h3 class="grow gold" style="margin:0">Players (${n})${watchers ? ` · 👀 ${watchers} watching` : ''}</h3><span class="muted small">${esc(g.name)}: ${g.minPlayers}–${g.maxPlayers}</span></div>
        <ul class="plist">
          ${S.players.map((p) => `
            <li data-k="lp-${esc(p.id)}">
              <span class="dot ${p.connected ? 'on' : 'off'}" data-net="${esc(p.id)}"></span>
              <span class="grow">${esc(p.name)}</span>
              ${p.id === (S.hostId || S.token) && S.role !== 'local' ? '<span class="tag">HOST</span>' : ''}
              ${p.id === S.token && S.role !== 'local' ? '<span class="tag">YOU</span>' : ''}
              ${p.bot ? '<span class="tag">BOT</span>' : ''}
              ${p.standIn ? '<span class="tag" title="A computer is playing this seat until they reconnect">🤖 STAND-IN</span>' : ''}
              ${p.id === S.successor ? '<span class="tag" title="Takes over the room if the host leaves">BACKUP HOST</span>' : ''}
              ${p.watch ? '<span class="tag">WATCHING</span>' : ''}
              ${S.voice.some(([id]) => id === p.id) ? '<span title="In voice chat">🎙</span>' : ''}
              ${isHost && p.id !== S.token && (S.role === 'local' || !p.connected || p.bot) ? `<button class="small bad" data-kick="${esc(p.id)}">Remove</button>` : ''}
            </li>`).join('')}
        </ul>
        ${S.role === 'local' ? `
          <div class="row"><input id="addName" class="grow" maxlength="20" placeholder="Add player name" style="min-width:0" /><button id="addBtn">Add</button></div>` : ''}
        ${isHost && g.bot ? `<button id="botBtn" style="width:100%">🤖 Add a computer player</button>` : ''}
        ${S.role !== 'local' && me && !S.tour ? `<button id="watchBtn" style="width:100%">${me.watch ? '🎲 Take a seat and play' : '👀 Just watch this game'}</button>` : ''}
      </div>
      ${tourPanel(isHost)}
      ${isHost ? `
      <div class="panel stack">
        <div class="row"><h3 class="gold grow" style="margin:0">Game</h3>${g.howTo ? `<button class="small" data-help="${g.id}">? How to play</button>` : ''}</div>
        ${g.cover ? `<div class="lobby-cover">${g.cover}</div>` : ''}
        <select id="gameSel" style="width:100%" ${S.tour && !S.tour.done ? 'disabled' : ''}>
          ${GAMES.map((x) => `<option value="${x.id}" ${x.id === S.gameId ? 'selected' : ''}>${esc(x.name)} (${x.minPlayers}–${x.maxPlayers})</option>`).join('')}
        </select>
        ${(g.options || []).map((o) => `
        <label class="row" style="justify-content:space-between">
          <span>${esc(o.label)}</span>
          <select data-opt="${o.id}">${o.choices.map(([v, t]) => `<option value="${esc(v)}" ${S.opts[o.id] === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
        </label>`).join('')}
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
          ${(g?.options || []).map((o) => `<div class="muted small">${esc(o.label)}: ${esc(o.choices.find(([v]) => v === S.opts?.[o.id])?.[1] || '')}</div>`).join('')}
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
    app.querySelectorAll('[data-kick]').forEach((b) => (b.onclick = () => {
      S.players = S.players.filter((p) => p.id !== b.dataset.kick);
      S.credentials = S.credentials.filter(([id]) => id !== b.dataset.kick);
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
  const watchBtn = app.querySelector('#watchBtn');
  if (watchBtn) watchBtn.onclick = () => toggleWatch(!me.watch);
  const retryBtn = app.querySelector('#retryBtn');
  if (retryBtn) retryBtn.onclick = () => joinRoom(S.code);
}

export let lastGameKey = '';

export function renderGame() {
  const g = getGame(S.gameId);
  if (!S.view || !gameReady(S.gameId)) {
    app.innerHTML = `<div class="panel">Loading ${esc(g.name)}…</div>`; lastGameKey = '';
    // Guests wait for the host's next update; the host and one-device play rebuild their view now.
    if (!gameReady(S.gameId)) loadGame(S.gameId).then(() => { if (S.role !== 'client') refreshLocalView(); render(); }, () => toast('Could not load the game. Check your connection and reload.'));
    return;
  }
  // Redrawing a big board costs phone battery: skip it when nothing visible changed
  // (reconnects, repeated syncs).
  const key = JSON.stringify([S.gameId, myId(), S.view, S.players.map((p) => [p.id, p.name, p.connected])]);
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
  const tourReady = S.tour && S.view.over && S.tour.recorded === S.tour.gameNo;
  const head = `
    <div class="game-head">
      <h2>${esc(g.name)}</h2>
      ${helpBtn(g.id)}
      ${isWatching(myId()) ? '<span class="tag">👀 WATCHING</span>' : S.players.some((p) => p.watch) ? `<span class="muted small" title="Spectators">👀 ${S.players.filter((p) => p.watch).length}</span>` : ''}
      <div id="turnTimer" class="turn-timer" hidden></div>
      ${S.role === 'local' && humans.length > 1 ? `<label class="small muted">Playing as
        <select id="viewAs">${humans.map((p) => `<option value="${esc(p.id)}" ${p.id === S.viewAs ? 'selected' : ''}>${esc(p.name)}${turn.includes(p.id) ? ' ◀' : ''}</option>`).join('')}</select></label>` : ''}
      ${isHost ? `${S.tour ? (tourReady ? `<button class="small primary" id="tourNext">${S.tour.done ? '🏆 Results' : 'Next game ▸'}</button>` : '') : (S.view.over ? '<button class="small primary" id="rematchBtn">🔁 Rematch</button>' : '<button class="small" id="restartBtn">New game</button>')}<button class="small" id="lobbyBtn">Lobby</button>` : S.view.over && !S.tour && !isWatching(myId()) ? '<button class="small" id="askRematch">🔁 Ask for a rematch</button>' : ''}
      ${S.tour ? `<div class="tour-bar">${esc(tourLine(S.tour, (id) => getGame(id).name))}${S.tour.mode === 'series' || S.tour.done ? ' · ' + standings(S.tour).map((p) => `${esc(p.name)} ${p.wins}`).join(' · ') : ''}</div>` : ''}
    </div>`;
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
  const viewAs = app.querySelector('#viewAs');
  if (viewAs) viewAs.onchange = (e) => { S.viewAs = e.target.value; saveSession(); refreshLocalView(); render(); };
  app.querySelector('#askRematch')?.addEventListener('click', (e) => { e.target.disabled = true; requestRematch(); });
  if (isHost) {
    app.querySelector('#lobbyBtn').onclick = endGame;
    app.querySelector('#tourNext')?.addEventListener('click', () => {
      if (!S.tour.done) return playTour();
      S.started = false; S.game = null; S.screen = 'lobby'; saveSession(); broadcast();
    });
    app.querySelector('#rematchBtn')?.addEventListener('click', () => startGame(true));
    app.querySelector('#restartBtn')?.addEventListener('click', () => {
      if (!S.view.over && !confirm('Restart the game from the beginning?')) return;
      startGame();
    });
  }
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
  if (!el.firstChild) el.innerHTML = '<i class="tt-bar"></i><span class="tt-who"></span><b class="tt-secs"></b>';
  el.querySelector('.tt-who').textContent = '⏱ ' + who;
  el.querySelector('.tt-secs').textContent = secs + 's';
  el.querySelector('.tt-bar').style.width = Math.max(0, (ms - 1000) / t.total) * 100 + '%';
  if (mine && secs <= 5 && secs > 0 && secs !== lastTickSec) sound('click');
  lastTickSec = secs;
}
setInterval(tickTimer, 1000);


export function tourPanel(isHost) {
  const t = S.tour;
  if (!t) {
    if (!isHost) return '';
    const n = seated().length, g = getGame(S.gameId);
    const fits = GAMES.filter((x) => n >= x.minPlayers && n <= x.maxPlayers);
    const koOk = g.minPlayers <= 2 && g.maxPlayers >= 2 && n >= 3;
    return `<div class="panel stack">
      <h3 class="gold" style="margin:0">🏆 Tournament</h3>
      <details class="tour-setup"><summary>Set up a tournament</summary>
        <div class="stack" style="margin-top:10px">
          <div><b>Series</b> <span class="muted small">Everyone plays each game you tick. Every win is a point.</span></div>
          <div class="tour-games">${fits.map((x) => `<label><input type="checkbox" data-tg="${x.id}"> ${esc(x.name)}</label>`).join('') || '<span class="muted small">No game fits this many players.</span>'}</div>
          <button id="tourSeries" ${fits.length ? '' : 'disabled'}>Start series</button>
          <div><b>Knockout</b> <span class="muted small">${esc(g.name)} in one-on-one matches. Everyone else watches; winners go through.</span></div>
          <button id="tourKnock" ${koOk ? '' : 'disabled'}>${koOk ? `Start knockout (${n} players)` : 'Needs 3+ players and a game for two'}</button>
        </div>
      </details></div>`;
  }
  const table = standings(t).map((p) => `<li class="${t.champions.includes(p.id) ? 'champ' : ''}"><span class="grow">${t.champions.includes(p.id) ? '🏆 ' : ''}${esc(p.name)}</span><b>${p.wins}</b></li>`).join('');
  return `<div class="panel stack tour-panel">
    <h3 class="gold" style="margin:0">${esc(tourLine(t, (id) => getGame(id).name))}</h3>
    ${t.done ? '<div class="winner-banner">Tournament complete!</div>' : ''}
    <ol class="tour-table">${table}</ol>
    ${isHost ? `<div class="row">${t.done ? '' : `<button class="primary grow" id="tourGo" ${S.started ? 'disabled' : ''}>Play the next game ▸</button>`}<button class="small" id="tourClose">${t.done ? 'Close tournament' : 'Cancel'}</button></div>` : ''}
  </div>`;
}
