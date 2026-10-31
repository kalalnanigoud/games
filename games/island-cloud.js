// Creature Island cloud saves. A player's explorer (their character, creatures, items and story progress)
// goes to the Worker in server/island-saves.js only when they choose Save; live play never calls it.
// This device keeps a private random key that proves the save is theirs; the service stores only its
// SHA-256, and the host only ever sees a separate fingerprint (explorerTag).

import CONFIG from '../js/config.js';
import { reconnectSecret, sha256hex } from '../js/util.js';

const KEY_NAME = 'island-explorer-key';
const TIMEOUT_MS = 15000;
let memoryKey = null; // a browser that can't keep anything (some private modes) gets a key for this visit only

export const cloudAvailable = () => !!CONFIG.islandSaves;

export function explorerKey() {
  try {
    let k = localStorage.getItem(KEY_NAME);
    if (!/^[a-f0-9]{64}$/.test(k || '')) { k = memoryKey || reconnectSecret(); localStorage.setItem(KEY_NAME, k); }
    return k;
  } catch {
    return (memoryKey ||= reconnectSecret());
  }
}
// False when the key can't outlive this visit, so the game can say so before anyone relies on it.
export function keyIsKept() {
  try { return localStorage.getItem(KEY_NAME) === explorerKey(); } catch { return false; }
}
// Tells the host "this is the same explorer" (one explorer can't be on the island twice) without the key.
export const explorerTag = () => sha256hex('island-explorer-tag:' + explorerKey()).slice(0, 32);

export class CloudError extends Error {
  constructor(code, message, extra = {}) { super(message); this.code = code; Object.assign(this, extra); }
}

async function call(method, path, body) {
  if (!cloudAvailable()) throw new CloudError('setup', 'Cloud saves aren’t set up on this site yet. Save to a file instead.');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new CloudError('offline', 'You’re offline. Your game is still running: try again once you’re connected, or save to a file.');
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(CONFIG.islandSaves.replace(/\/+$/, '') + path, {
      method,
      headers: { authorization: 'Bearer ' + explorerKey(), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
      cache: 'no-store',
    });
  } catch {
    throw ctl.signal.aborted
      ? new CloudError('timeout', 'The save service didn’t answer in time. Your game is still running: try again, or save to a file.')
      : new CloudError('network', 'Couldn’t reach the save service. Check your connection and try again, or save to a file.');
  } finally {
    clearTimeout(timer);
  }
  let out = null;
  try { out = await res.json(); } catch {}
  if (res.ok && out) return out;
  if (out?.error) throw new CloudError(out.error, out.message || 'The save service refused this request.', { status: res.status, rev: out.rev, savedAt: out.savedAt });
  // Cloudflare answers with its own page when the free daily request limit is used up.
  throw new CloudError('unavailable', `The save service is unavailable right now (error ${res.status}); it may have reached its free daily limit. Your game is still running: try again later, or save to a file.`, { status: res.status });
}

// { rev, savedAt, data } for this device's explorer, or null when it has never been saved.
export async function loadExplorer() {
  try { return await call('GET', '/explorer'); }
  catch (e) { if (e.code === 'none') return null; throw e; }
}

// Resolves to { rev, savedAt } once the service has stored it. rev is the revision this device last
// loaded or saved (0 for a new explorer); a mismatch rejects with code 'conflict' unless force is set,
// which only an explicit "Replace it" choice should do.
export const saveExplorer = (data, rev, force = false) => call('PUT', '/explorer', { rev, data, force });
