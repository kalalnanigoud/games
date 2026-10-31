// Anonymous crash reports, off until js/config.js has an errorReports address (see README).
// A report holds only the error, where it happened (screen, game, role), the site version and the
// browser: never names, room codes, chat or game contents. Each problem is sent once per visit,
// at most five per visit.
import CONFIG from './config.js';
import { S, VERSION } from './state.js';

const sent = new Set();
let count = 0;
const LIMIT = 5;

// Keep file names and line numbers, drop the site address and anything after a "?".
const tidy = (text) => String(text || '').replace(/https?:\/\/[^\s)]+?\/((?:js|games)\/[\w.-]+)(\?[^\s):]*)?/g, '$1').slice(0, 1800);

export function report(error, where = 'app') {
  const endpoint = CONFIG.errorReports;
  if (!endpoint || count >= LIMIT || typeof navigator === 'undefined') return;
  const message = tidy(error?.message || error);
  const stack = tidy(error?.stack || '');
  const key = message + '|' + stack.split('\n')[1];
  if (!message || sent.has(key)) return;
  sent.add(key);
  count++;
  const body = JSON.stringify({
    v: VERSION, where, message, stack,
    screen: S.screen, game: S.gameId, role: S.role, started: !!S.started,
    browser: navigator.userAgent.slice(0, 160), viewport: `${innerWidth}x${innerHeight}`, at: new Date().toISOString(),
  });
  // A plain-text beacon needs no extra permission request from the browser and survives page exits.
  try { if (!navigator.sendBeacon?.(endpoint, new Blob([body], { type: 'text/plain' }))) fetch(endpoint, { method: 'POST', body, keepalive: true }).catch(() => {}); }
  catch {}
}

if (typeof window !== 'undefined') {
  addEventListener('error', (e) => report(e.error || e.message, 'error'));
  addEventListener('unhandledrejection', (e) => report(e.reason, 'promise'));
}
