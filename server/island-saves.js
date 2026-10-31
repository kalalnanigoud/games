// Cloudflare Worker that keeps Creature Island explorers: each player's own saved character, creatures,
// items and story progress. The game only calls it when a player signs in, chooses Save or loads their
// explorer; live play, movement and lobbies never touch it.
//
// Set up (free plan): node tools/deploy-island-saves.mjs does all of this in one go (README "Cloud saves").
// By hand instead:
//   1. Cloudflare dashboard → Storage & Databases → D1 → Create database, name it "island-saves".
//   2. Workers & Pages → Create → Worker, name it "island-saves" → Deploy → Edit code → paste this file → Deploy.
//   3. Worker → Settings → Bindings → Add → D1 database, variable name DB, the database from step 1.
//   4. Worker → Settings → Variables and Secrets → add a Secret named PIN_PEPPER (a long random value).
//   5. Put https://island-saves.<your-subdomain>.workers.dev into islandSaves in js/config.js and push.
// The tables are created on first use. Free limits apply (D1: 5 GB stored, 100,000 writes a day; Workers:
// 100,000 requests a day); past them a save fails with a clear message and the game keeps running.
//
// Who owns a save: an explorer account, a name and a 4-digit PIN, so a player can continue on any device.
// A PIN is stored only as a keyed fingerprint (HMAC with the PIN_PEPPER secret), so a copy of the database
// alone can't be used to work PINs out. Because 4 digits are only 10,000 possibilities, each name is
// paused after a few wrong PINs (5 → 15 minutes, 10 → an hour, 15 and more → a day). Signing in gives the
// device a session token, stored here only as its SHA-256. Saves made before accounts (keyed by a private
// browser key) still load, and move into an account when its owner signs in on that browser.
// No IP addresses are stored.

const MAX_SAVE = 64 * 1024; // a full explorer is a few kilobytes
const MIN_GAP_MS = 2000; // one save per explorer every two seconds at most
const PER_MINUTE = 40; // requests per address per minute, counted in memory only
const SIGN_INS_PER_MINUTE = 12; // sign-ins and new accounts per address per minute, in memory only
const SESSION_MS = 365 * 24 * 3600 * 1000;
const DEFAULT_ORIGINS = 'https://kalalnanigoud.github.io';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS explorers (id TEXT PRIMARY KEY, rev INTEGER NOT NULL, data TEXT NOT NULL, saved_at INTEGER NOT NULL, created_at INTEGER NOT NULL, prev_data TEXT, prev_rev INTEGER)`,
  `CREATE TABLE IF NOT EXISTS accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, display TEXT NOT NULL, salt TEXT NOT NULL, pin_hash TEXT NOT NULL, fails INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, account_id INTEGER NOT NULL, expires_at INTEGER NOT NULL)`,
];

const counters = { all: new Map(), signIn: new Map() }; // address -> [window start, count]; never stored
function tooBusy(request, now, kind = 'all', limit = PER_MINUTE) {
  const ip = request.headers.get('cf-connecting-ip') || '';
  if (!ip) return false;
  const map = counters[kind];
  if (map.size > 5000) map.clear();
  const w = map.get(ip);
  if (!w || now - w[0] > 60000) { map.set(ip, [now, 1]); return false; }
  return ++w[1] > limit;
}

function allowedOrigin(origin, env) {
  if (!origin) return true; // not a browser (the deploy check, curl)
  if (/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) return true; // local development
  return String(env.ALLOWED_ORIGINS || DEFAULT_ORIGINS).split(',').map((s) => s.trim()).includes(origin);
}

const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256hex = async (text) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
const randomHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
async function pinHash(env, salt, pin) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.PIN_PEPPER), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(salt + ':' + pin)));
}
function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
// Explorer names: 3–20 letters, numbers, spaces, - or _. Compared without regard to case.
function cleanName(raw) {
  const name = String(raw ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');
  return name.length >= 3 && name.length <= 20 && /^[\p{L}\p{N} _-]+$/u.test(name) ? name : null;
}
const validPin = (pin) => typeof pin === 'string' && /^\d{4}$/.test(pin);

// Runs a query, creating the tables the first time the database is used.
async function withTables(env, run) {
  try { return await run(); } catch (e) {
    if (!/no such table/i.test(String(e?.message || e))) throw e;
    for (const sql of SCHEMA) await env.DB.prepare(sql).run();
    return run();
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin') || '';
    const cors = {
      'access-control-allow-origin': origin || '*',
      'access-control-allow-methods': 'GET, PUT, POST, DELETE, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-max-age': '86400',
      vary: 'origin',
    };
    const json = (status, body) => new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status, headers: { ...cors, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
    const fail = (status, error, message, extra = {}) => json(status, { error, message, ...extra });

    if (!allowedOrigin(origin, env)) return new Response('origin not allowed', { status: 403 });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    const path = url.pathname, method = request.method;
    const now = Date.now();
    if (path === '/' && method === 'GET') return json(200, { ok: true, service: 'island-saves', version: 2, storage: !!env.DB, accounts: !!env.PIN_PEPPER });
    if (!['/explorer', '/account', '/login', '/session', '/claim'].includes(path)) return fail(404, 'not-found', 'Unknown address.');
    if (tooBusy(request, now)) return fail(429, 'busy', 'Too many requests from this network. Wait a minute and try again.');
    if (!env.DB) return fail(503, 'setup', 'The save service has no database attached yet (binding DB).');
    const DB = env.DB;
    const readBody = async (max = 4096) => {
      const text = await request.text();
      if (text.length > max) return null;
      try { const v = JSON.parse(text); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; }
    };
    const newSession = async (accountId) => {
      const token = 's1.' + randomHex(32);
      await DB.prepare('INSERT INTO sessions (token_hash, account_id, expires_at) VALUES (?, ?, ?)').bind(await sha256hex(token), accountId, now + SESSION_MS).run();
      return token;
    };
    // Who is asking: a signed-in account (session token) or, for saves made before accounts, a browser key.
    const whoIs = async () => {
      const auth = request.headers.get('authorization') || '';
      const session = /^Bearer (s1\.[a-f0-9]{64})$/.exec(auth)?.[1];
      if (session) {
        const tokenHash = await sha256hex(session);
        const row = await withTables(env, () => DB.prepare('SELECT s.account_id AS id, a.display AS name FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ? AND s.expires_at > ?').bind(tokenHash, now).first());
        return row ? { id: 'a:' + row.id, account: row.id, name: row.name } : null;
      }
      const legacy = /^Bearer ([a-f0-9]{64})$/.exec(auth)?.[1];
      return legacy ? { id: await sha256hex(legacy), legacy: true } : null;
    };

    try {
      if (path === '/account' && method === 'POST') {
        if (tooBusy(request, now, 'signIn', SIGN_INS_PER_MINUTE)) return fail(429, 'busy', 'Too many tries from this network. Wait a minute and try again.');
        if (!env.PIN_PEPPER) return fail(503, 'setup', 'Explorer accounts aren’t switched on for this save service yet (secret PIN_PEPPER).');
        const b = await readBody();
        const name = cleanName(b?.name);
        if (!name) return fail(400, 'name', 'Choose a name of 3 to 20 letters or numbers (spaces, - and _ are fine).');
        if (!validPin(b?.pin)) return fail(400, 'pin', 'The PIN must be exactly 4 digits.');
        const salt = randomHex(16);
        const row = await withTables(env, async () => DB.prepare('INSERT INTO accounts (name, display, salt, pin_hash, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (name) DO NOTHING RETURNING id')
          .bind(name.toLowerCase(), name, salt, await pinHash(env, salt, b.pin), now).first());
        if (!row) return fail(409, 'taken', 'That name is taken. Choose another, or sign in if it’s yours.');
        return json(200, { token: await newSession(row.id), name });
      }

      if (path === '/login' && method === 'POST') {
        if (tooBusy(request, now, 'signIn', SIGN_INS_PER_MINUTE)) return fail(429, 'busy', 'Too many tries from this network. Wait a minute and try again.');
        if (!env.PIN_PEPPER) return fail(503, 'setup', 'Explorer accounts aren’t switched on for this save service yet (secret PIN_PEPPER).');
        const b = await readBody();
        const name = cleanName(b?.name);
        const wrong = () => fail(401, 'wrong', 'That name and PIN don’t match.');
        if (!name || !validPin(b?.pin)) return wrong();
        const acct = await withTables(env, () => DB.prepare('SELECT id, display, salt, pin_hash, locked_until FROM accounts WHERE name = ?').bind(name.toLowerCase()).first());
        if (!acct) return wrong();
        // Each try is counted before the PIN is checked, in one statement that also starts a pause on every
        // fifth miss: tries sent all at once can't slip past the limit.
        const tryRow = await DB.prepare(`UPDATE accounts SET fails = fails + 1,
            locked_until = CASE WHEN (fails + 1) % 5 = 0 THEN ? + CASE WHEN fails + 1 >= 15 THEN 86400000 WHEN fails + 1 >= 10 THEN 3600000 ELSE 900000 END ELSE locked_until END
            WHERE id = ? AND locked_until <= ? RETURNING fails, locked_until`).bind(now, acct.id, now).first();
        const pause = (until) => fail(423, 'locked', `Too many wrong PINs for this name. Try again ${until - now > 3600000 ? 'tomorrow' : `in ${Math.ceil((until - now) / 60000)} minutes`}.`, { retryAt: until });
        if (!tryRow) {
          // Paused, perhaps by a try that arrived a moment ago: read when the pause ends.
          const l = await DB.prepare('SELECT locked_until FROM accounts WHERE id = ?').bind(acct.id).first();
          return pause(Math.max(Number(l?.locked_until) || 0, now + 60000));
        }
        if (!same(await pinHash(env, acct.salt, b.pin), acct.pin_hash)) {
          return Number(tryRow.locked_until) > now ? pause(Number(tryRow.locked_until)) : fail(401, 'wrong', 'That name and PIN don’t match.', { left: 5 - (Number(tryRow.fails) % 5) });
        }
        await DB.prepare('UPDATE accounts SET fails = 0, locked_until = 0 WHERE id = ?').bind(acct.id).run();
        await DB.prepare('DELETE FROM sessions WHERE account_id = ? AND expires_at <= ?').bind(acct.id, now).run();
        return json(200, { token: await newSession(acct.id), name: acct.display });
      }

      if (path === '/session' && method === 'DELETE') {
        const token = /^Bearer (s1\.[a-f0-9]{64})$/.exec(request.headers.get('authorization') || '')?.[1];
        if (token) await withTables(env, async () => DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256hex(token)).run());
        return json(200, { ok: true });
      }

      const who = await whoIs();
      if (!who) return fail(401, 'signin', 'Sign in to your explorer account to use cloud saves.');

      if (path === '/claim' && method === 'POST') {
        // Moves a save made in this browser before accounts into the signed-in account (if it has none).
        if (!who.account) return fail(401, 'signin', 'Sign in first.');
        const b = await readBody();
        const key = typeof b?.key === 'string' && /^[a-f0-9]{64}$/.test(b.key) ? b.key : null;
        if (!key) return fail(400, 'bad-request', 'No browser key given.');
        const old = await sha256hex(key);
        const r = await withTables(env, () => DB.prepare('UPDATE explorers SET id = ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM explorers WHERE id = ?)').bind(who.id, old, who.id).run());
        if (r.meta?.changes) return json(200, { moved: true });
        const has = await DB.prepare('SELECT 1 AS x FROM explorers WHERE id = ?').bind(who.id).first();
        return has ? fail(409, 'has-save', 'This account already has a saved explorer.') : fail(404, 'none', 'Nothing was saved in this browser.');
      }

      if (path !== '/explorer') return fail(405, 'method', 'Not supported.');
      const id = who.id;
      if (method === 'GET') {
        const previous = url.searchParams.get('previous') === '1';
        const row = await withTables(env, () => DB.prepare(previous
          ? 'SELECT prev_rev AS rev, saved_at, prev_data AS data FROM explorers WHERE id = ?'
          : 'SELECT rev, saved_at, data FROM explorers WHERE id = ?').bind(id).first());
        if (!row || row.data == null) return fail(404, 'none', previous ? 'There is no earlier save.' : 'No saved explorer yet.');
        // The data was checked as JSON when it was written, so it goes back out as it is.
        return json(200, `{"rev":${Number(row.rev)},"savedAt":${Number(row.saved_at)},"data":${row.data}}`);
      }

      if (method === 'PUT') {
        const body = await request.text();
        if (body.length > MAX_SAVE + 1024) return fail(413, 'too-large', 'This save is too large to store.');
        let msg;
        try { msg = JSON.parse(body); } catch { return fail(400, 'bad-request', 'The save could not be read.'); }
        const data = msg?.data;
        if (!data || typeof data !== 'object' || Array.isArray(data) || data.kind !== 'island-explorer') return fail(400, 'bad-request', 'That is not an explorer save.');
        const text = JSON.stringify(data);
        if (text.length > MAX_SAVE) return fail(413, 'too-large', 'This save is too large to store.');
        const rev = Number.isSafeInteger(msg.rev) && msg.rev >= 0 ? msg.rev : -1;
        if (rev < 0) return fail(400, 'bad-request', 'The save has no revision.');
        const force = msg.force === true;

        const row = await withTables(env, () => DB.prepare('SELECT rev, saved_at FROM explorers WHERE id = ?').bind(id).first());
        if (row && now - Number(row.saved_at) < MIN_GAP_MS) return fail(429, 'too-soon', 'Saved a moment ago. Wait a second and try again.');
        if (!row) {
          const r = await DB.prepare('INSERT INTO explorers (id, rev, data, saved_at, created_at) VALUES (?, 1, ?, ?, ?) ON CONFLICT(id) DO NOTHING').bind(id, text, now, now).run();
          if (!r.meta?.changes) return fail(409, 'conflict', 'This explorer was just saved from somewhere else.');
          return json(200, { rev: 1, savedAt: now });
        }
        if (!force && rev !== Number(row.rev)) {
          return fail(409, 'conflict', 'This explorer was saved from another tab or device since it was loaded here.', { rev: Number(row.rev), savedAt: Number(row.saved_at) });
        }
        // The old save moves to prev_* in the same statement, so a failed write keeps it as the current one.
        const r = await DB.prepare('UPDATE explorers SET prev_data = data, prev_rev = rev, data = ?, rev = rev + 1, saved_at = ? WHERE id = ? AND rev = ?').bind(text, now, id, Number(row.rev)).run();
        if (!r.meta?.changes) return fail(409, 'conflict', 'This explorer was just saved from somewhere else.');
        return json(200, { rev: Number(row.rev) + 1, savedAt: now });
      }
      return fail(405, 'method', 'Use GET or PUT.');
    } catch (e) {
      console.error('island-saves storage error', String(e?.message || e));
      return fail(503, 'storage', 'The save service could not reach its storage. It may have reached its free daily limit. Your game is still running: try again later, or save to a file.');
    }
  },
};
