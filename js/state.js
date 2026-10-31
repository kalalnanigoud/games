// Shared room state: who is here, which game, options, identities and saved sessions.

import { CATALOG, loaders, VERSION, FILES } from '../games/catalog.js';
import { uid, reconnectSecret, sha256hex } from './util.js';

export { VERSION, FILES };
export const MAX_ROOM = 8; // seats at the table
export const MAX_WATCHERS = 8; // spectators on top of that
export const BOT_NAMES = ['Ada', 'Bram', 'Cleo', 'Dax', 'Esme', 'Finn', 'Gus', 'Hana'];

/* ---------------- games: listed from the catalog, code loaded on demand ---------------- */

export const GAMES = CATALOG;
const loaded = new Map();
// The full game module once it has loaded; until then its catalog entry (names, rules, options, flags).
export const getGame = (id) => loaded.get(id) || CATALOG.find((g) => g.id === id) || CATALOG[0];
export const gameReady = (id) => loaded.has(id);
const loading = new Map();
export function loadGame(id) {
  if (loaded.has(id)) return Promise.resolve(loaded.get(id));
  if (!loaders[id]) return Promise.reject(Error('Unknown game: ' + id));
  if (!loading.has(id)) loading.set(id, loaders[id]().then((m) => {
    // Keep showing the catalog's pre-rendered cover image rather than the module's live illustration.
    const entry = CATALOG.find((g) => g.id === id);
    if (entry?.cover) m.default.cover = entry.cover;
    loaded.set(id, m.default); loading.delete(id); return m.default;
  }, (e) => { loading.delete(id); throw e; }));
  return loading.get(id);
}

export const S = {
  screen: 'home', // home | lobby | game
  name: sessionStorage.getItem('gn-name') || localStorage.getItem('gn-name') || '',
  // Per-tab identity, so two tabs on one computer count as two players.
  token: sessionStorage.getItem('gn-token') || uid(),
  secret: sessionStorage.getItem('gn-secret') || reconnectSecret(),
  credentials: [], // host-only [public player ID, SHA-256 of their private reconnect secret] pairs
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
  opts: defaultOpts(GAMES[0]), // host-chosen game options, e.g. { clock: '5+0' } (games with options only)
  voice: [], // [player id, PeerJS id] for everyone in voice chat (kept by the host)
  tour: null, // tournament in progress (js/tour.js), kept by the host
  lobbyMode: 'game', // the host's lobby choice, shared with guests: 'game' (one game) or 'tour' (setting up a tournament)
  tourDraft: validTourDraft(), // unfinished setup, saved with the room
  successor: null, // who takes over the room if the host disappears
  backupHost: '', // host's explicitly trusted successor; empty disables migration
  backup: null, // successor only: the host's latest copy of the room
  net: {}, // round-trip time to the host in ms, per player
  relay: false, // client: our connection goes through a TURN relay
  update: null, // someone in the room runs a different version of the site: { newer: bool }
};
export function defaultTimer(g) {
  return g?.onTimeout ? g.defaultTimer || 30 : 0;
}
// A game may export options: [{ id, label, default, choices: [[value, text]] }], picked by the host in the lobby.
export function defaultOpts(g) {
  return Object.fromEntries((g?.options || []).map((o) => [o.id, o.default]));
}
export function validOpts(g, opts) {
  return Object.fromEntries((g?.options || []).map((o) => [o.id, o.choices.some(([v]) => v === opts?.[o.id]) ? opts[o.id] : o.default]));
}
export function validTourDraft(draft) {
  const known = (id) => GAMES.some((g) => g.id === id);
  const duel = GAMES.find((g) => g.id === draft?.ko);
  return {
    format: draft?.format === 'knockout' ? 'knockout' : 'series',
    picks: Array.isArray(draft?.picks) ? [...new Set(draft.picks.filter(known))] : [],
    ko: duel && duel.minPlayers <= 2 && duel.maxPlayers >= 2 ? duel.id : null,
  };
}
// Spectators sit in the room but not at the table.
export const seated = () => S.players.filter((p) => !p.watch);
export const isWatching = (id) => !!S.players.find((p) => p.id === id)?.watch;
sessionStorage.setItem('gn-token', S.token);
sessionStorage.setItem('gn-secret', S.secret);

export function adoptToken(token) {
  if (!token) return;
  S.token = token;
  sessionStorage.setItem('gn-token', token);
}

export const myId = () => (S.role === 'local' ? S.viewAs : S.token);
export const playerName = (id) => S.players.find((p) => p.id === id)?.name ?? '???';
export const isBot = (id) => !!S.players.find((p) => p.id === id)?.bot;
// Versions start with their build time, so the larger one is newer.
export const newerVersion = (a, b) => String(a) > String(b);

/* ---------------- session persistence ---------------- */

// Saved in sessionStorage (survives a refresh of this tab) and localStorage
// (lets you resume after closing the browser).
let saveTimer = null;
let saveWarned = false;
export function queueSessionSave() {
  // Throttle, rather than trailing debounce: continuous drawing still saves.
  if (!saveTimer) saveTimer = setTimeout(saveSession, 750);
}
export function saveSession() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!S.role) return;
  const data = S.role === 'client'
    ? { role: 'client', code: S.code, token: S.token, secret: S.secret }
    : { role: S.role, code: S.code, token: S.token, secret: S.secret, credentials: S.credentials, gameId: S.gameId, players: S.players, started: S.started, game: S.game, viewAs: S.viewAs, timerSec: S.timerSec, opts: S.opts, tour: S.tour };
  if (S.role === 'host') data.backupHost = S.backupHost;
  if (S.role !== 'client') {
    data.lobbyMode = S.lobbyMode === 'tour' ? 'tour' : 'game';
    data.tourDraft = validTourDraft(S.tourDraft);
  }
  data.version = 3;
  const json = JSON.stringify(data);
  for (const storage of [sessionStorage, localStorage]) {
    try { storage.setItem('gn-session', json); }
    catch (error) {
      // A full store must not prevent the move from being broadcast.
      if (!saveWarned) console.warn('Could not save this game on this device.', error);
      saveWarned = true;
    }
  }
}
export function flushSessionSave() { if (saveTimer) saveSession(); }
addEventListener('pagehide', flushSessionSave);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSessionSave(); });
export const parse = (s) => {
  try {
    const v = JSON.parse(s);
    // Old online sessions used public IDs as credentials and cannot be resumed safely.
    if (v && v.role !== 'local' && v.version !== 2 && v.version !== 3) return null;
    // Ignore sessions for games that no longer exist.
    if (v && v.role !== 'client' && !GAMES.some((g) => g.id === v.gameId)) return null;
    // Version 2 hosts stored the secrets themselves; keep only their fingerprints from now on.
    if (v && v.version === 2 && Array.isArray(v.credentials)) { v.credentials = v.credentials.map(([id, secret]) => [id, sha256hex(secret)]); v.version = 3; }
    return v;
  } catch { return null; }
};
export const loadTabSession = () => parse(sessionStorage.getItem('gn-session'));
export const loadSession = () => loadTabSession() || parse(localStorage.getItem('gn-session'));
export const clearSession = () => { clearTimeout(saveTimer); saveTimer = null; sessionStorage.removeItem('gn-session'); localStorage.removeItem('gn-session'); };
