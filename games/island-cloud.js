// Creature Island cloud saves. A player's explorer (their character, creatures, items and story progress)
// goes to the Worker in server/island-saves.js only when they choose Save; live play never calls it.
// Saves belong to an explorer account, a name and a 4-digit PIN, so a player can continue on any device.
// Signing in gives this device a session token (kept in the browser until Sign out); the PIN itself is
// never kept. A save made in this browser before accounts existed moves into the account on sign-in.

import CONFIG from '../js/config.js';
import { sha256hex } from '../js/util.js';

const SESSION_NAME = 'island-session';
const LEGACY_KEY = 'island-explorer-key'; // before accounts: a private random key per browser
const TIMEOUT_MS = 15000;
let memorySession = null; // a browser that can't keep anything (some private modes) stays signed in for this visit only

export const cloudAvailable = () => !!CONFIG.islandSaves;

// { token, name, recovery } while signed in (recovery: the account has a recovery code), else null.
export function account() {
  let s = memorySession;
  try { s = JSON.parse(localStorage.getItem(SESSION_NAME) || 'null') || memorySession; } catch {}
  return s && /^s1\.[a-f0-9]{64}$/.test(s.token || '') && typeof s.name === 'string' ? s : null;
}
function keep(s) {
  memorySession = s;
  try { if (s) localStorage.setItem(SESSION_NAME, JSON.stringify(s)); else localStorage.removeItem(SESSION_NAME); } catch {}
}
// False when sign-in can't outlive this visit, so the game can say so.
export function keyIsKept() {
  try { localStorage.setItem('island-probe', '1'); localStorage.removeItem('island-probe'); return true; } catch { return false; }
}
// Tells the host "this is the same explorer" (one explorer can't be on the island twice) without any secret.
export const explorerTag = () => { const a = account(); return a ? sha256hex('island-account:' + a.name.toLowerCase()).slice(0, 32) : ''; };

export class CloudError extends Error {
  constructor(code, message, extra = {}) { super(message); this.code = code; Object.assign(this, extra); }
}

async function call(method, path, body, { signedIn = true, bearer = '' } = {}) {
  if (!cloudAvailable()) throw new CloudError('setup', 'Cloud saves aren’t set up on this site yet.');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new CloudError('offline', 'You’re offline. Your game is still running: try again once you’re connected.');
  }
  const me = account();
  if (signedIn && !me) throw new CloudError('signin', 'Sign in to your explorer account to save your adventure.');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(CONFIG.islandSaves.replace(/\/+$/, '') + path, {
      method,
      headers: { ...(bearer ? { authorization: 'Bearer ' + bearer } : me ? { authorization: 'Bearer ' + me.token } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
      cache: 'no-store',
    });
  } catch {
    throw ctl.signal.aborted
      ? new CloudError('timeout', 'The save service didn’t answer in time. Your game is still running: try again.')
      : new CloudError('network', 'Couldn’t reach the save service. Check your connection and try again.');
  } finally {
    clearTimeout(timer);
  }
  let out = null;
  try { out = await res.json(); } catch {}
  if (res.ok && out) return out;
  // A session that has run out (or was signed out elsewhere) is forgotten here too.
  if (out?.error === 'signin' && signedIn) keep(null);
  if (out?.error) throw new CloudError(out.error, out.message || 'The save service refused this request.', { status: res.status, rev: out.rev, savedAt: out.savedAt, retryAt: out.retryAt, left: out.left });
  // Cloudflare answers with its own page when the free daily request limit is used up.
  throw new CloudError('unavailable', `The save service is unavailable right now (error ${res.status}); it may have reached its free daily limit. Your game is still running: try again later.`, { status: res.status });
}

// Accounts. All resolve to { name } once this device is signed in; a new account, a recovery and a "Get a
// recovery code" also give { code }: the one-time recovery code, which the caller must show once.
const enter = (out) => { keep({ token: out.token, name: out.name, recovery: !!out.recovery }); return { name: out.name, code: out.code || '' }; };
export async function signUp(name, pin) { return enter(await call('POST', '/account', { name, pin }, { signedIn: false })); }
export async function signIn(name, pin) { return enter(await call('POST', '/login', { name, pin }, { signedIn: false })); }
// Forgot the PIN: the recovery code sets a new one, ends every older session and gives a fresh code.
export async function recover(name, code, newPin) { return enter(await call('POST', '/recover', { name, code, newPin }, { signedIn: false })); }
// For a signed-in account made before codes existed (or that lost its code): a new code, replacing the old.
export async function getRecoveryCode() {
  const out = await call('POST', '/recovery', {});
  const me = account();
  if (me) keep({ ...me, recovery: true });
  return out.code;
}export async function signOut() {
  const me = account();
  keep(null);
  if (me) try { await fetch(CONFIG.islandSaves.replace(/\/+$/, '') + '/session', { method: 'DELETE', headers: { authorization: 'Bearer ' + me.token } }); } catch {}
}
const legacyKey = () => { let key = null; try { key = localStorage.getItem(LEGACY_KEY); } catch {} return /^[a-f0-9]{64}$/.test(key || '') ? key : null; };
const dropKey = () => { try { localStorage.removeItem(LEGACY_KEY); } catch {} };
export const hasLegacy = () => !!legacyKey();
// A save made in this browser before accounts: move it into the signed-in account (if that has none yet).
// Resolves to true when one was moved. When the account already has a save, the browser's key is kept and
// it resolves to { conflict: { theirs, old } } (each { rev, savedAt, data } or null) for the player to choose.
export async function claimLegacy() {
  const key = legacyKey();
  if (!key || !account()) return false;
  try {
    const out = await call('POST', '/claim', { key });
    dropKey();
    return !!out.moved;
  } catch (e) {
    if (e.code === 'none') dropKey();
    if (e.code !== 'has-save') return false;
    const [theirs, old] = await Promise.all([loadExplorer().catch(() => null), call('GET', '/explorer', null, { signedIn: false, bearer: key }).catch(() => null)]);
    return { conflict: { theirs, old } };
  }
}
// "Use this browser's older explorer instead": the Worker swaps them and keeps the account's save as the earlier one.
export async function replaceWithLegacy() {
  const key = legacyKey();
  if (!key) throw new CloudError('none', 'Nothing was saved in this browser.');
  const out = await call('POST', '/claim', { key, replace: true });
  dropKey();
  return out;
}
// "Discard the browser's save": the only path that forgets the key.
export const discardLegacy = dropKey;

// { rev, savedAt, data } for the signed-in account's explorer, or null when it has never been saved.
export async function loadExplorer() {
  try { return await call('GET', '/explorer'); }
  catch (e) { if (e.code === 'none') return null; throw e; }
}

// Resolves to { rev, savedAt } once the service has stored it. rev is the revision this device last
// loaded or saved (0 for a new explorer); a mismatch rejects with code 'conflict' unless force is set,
// which only an explicit "Replace it" choice should do.
export const saveExplorer = (data, rev, force = false) => call('PUT', '/explorer', { rev, data, force });
