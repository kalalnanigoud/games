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
//
// Forgotten PINs: an account gets a one-time recovery code (like K7QM-2XPA-9TNE, about 60 bits) when it is
// made, stored only as an HMAC with the same secret. POST /recover swaps a name + code + new PIN for a new
// PIN, a fresh code and a new session, and ends every older session. Wrong codes are limited per network
// only: they don't pause the name, and a pause from wrong PINs doesn't stop the right code (it lifts it),
// so nobody can keep an owner out by guessing badly on purpose. Accounts made before this get a code from
// POST /recovery while signed in.

const MAX_SAVE = 64 * 1024; // a full explorer is a few kilobytes
const MIN_GAP_MS = 2000; // one save per explorer every two seconds at most
const PER_MINUTE = 40; // requests per address per minute, counted in memory only
const SIGN_INS_PER_MINUTE = 12; // sign-ins and new accounts per address per minute, in memory only
const SESSION_MS = 365 * 24 * 3600 * 1000;
const DEFAULT_ORIGINS = 'https://kalalnanigoud.github.io';

// Each Worker stays self-contained for the dashboard/deploy script. Enforce byte
// limits while streaming, before buffering an arbitrarily large request.
async function boundedText(request, limit) {
  if (Number(request.headers.get('content-length')) > limit) {
    await request.body?.cancel();
    return null;
  }
  if (!request.body) return '';
  const reader = request.body.getReader(), decoder = new TextDecoder();
  let size = 0, text = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return text + decoder.decode();
      if ((size += value.byteLength) > limit) { await reader.cancel(); return null; }
      text += decoder.decode(value, { stream: true });
    }
  } finally { reader.releaseLock(); }
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS explorers (id TEXT PRIMARY KEY, rev INTEGER NOT NULL, data TEXT NOT NULL, saved_at INTEGER NOT NULL, created_at INTEGER NOT NULL, prev_data TEXT, prev_rev INTEGER)`,
  `CREATE TABLE IF NOT EXISTS accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, display TEXT NOT NULL, salt TEXT NOT NULL, pin_hash TEXT NOT NULL, fails INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, rec_hash TEXT)`,
  `CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, account_id INTEGER NOT NULL, expires_at INTEGER NOT NULL)`,
];
// Columns added since the first deploy: an existing table gets them the first time a query needs one.
const MIGRATIONS = [`ALTER TABLE accounts ADD COLUMN rec_hash TEXT`];
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 31 letters and digits, none that look alike (no O/0, I/1/L)

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
// 12 characters from 31, drawn without bias (60 bits), shown as XXXX-XXXX-XXXX.
function newCode() {
  let out = '';
  while (out.length < 12) for (const b of crypto.getRandomValues(new Uint8Array(24))) if (b < 248 && out.length < 12) out += CODE_ALPHABET[b % 31];
  return out.replace(/(.{4})(?=.)/g, '$1-');
}
const cleanCode = (raw) => { const c = String(raw ?? '').toUpperCase().replace(/[\s-]/g, ''); return c.length === 12 && [...c].every((ch) => CODE_ALPHABET.includes(ch)) ? c : null; };
async function codeHash(env, salt, code) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.PIN_PEPPER), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('recovery:' + salt + ':' + code)));
}

// Runs a query, creating the tables (or adding a newer column) the first time the database needs it.
async function withTables(env, run) {
  try { return await run(); } catch (e) {
    const msg = String(e?.message || e);
    if (/no such table/i.test(msg)) for (const sql of SCHEMA) await env.DB.prepare(sql).run();
    else if (/no such column/i.test(msg)) {
      for (const sql of MIGRATIONS) try { await env.DB.prepare(sql).run(); } catch (e2) { if (!/duplicate column/i.test(String(e2?.message || e2))) throw e2; }
    } else throw e;
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
    if (!['/explorer', '/account', '/login', '/session', '/claim', '/recover', '/recovery'].includes(path)) return fail(404, 'not-found', 'Unknown address.');
    if (tooBusy(request, now)) return fail(429, 'busy', 'Too many requests from this network. Wait a minute and try again.');
    if (!env.DB) return fail(503, 'setup', 'The save service has no database attached yet (binding DB).');
    const DB = env.DB;
    const readBody = async (max = 4096) => {
      const text = await boundedText(request, max);
      if (text === null) return null;
      try { const v = JSON.parse(text); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; }
    };
    // Salt is already a random credential generation: recovery rotates it.
    // The conditional INSERT closes the gap between checking a PIN and minting
    // its session without adding a schema migration or invalidating old sessions.
    const newSession = async (accountId, salt) => {
      const token = 's1.' + randomHex(32);
      const r = await DB.prepare('INSERT INTO sessions (token_hash, account_id, expires_at) SELECT ?, id, ? FROM accounts WHERE id = ? AND salt = ?').bind(await sha256hex(token), now + SESSION_MS, accountId, salt).run();
      return r.meta?.changes ? token : null;
    };
    // Each PIN try is counted before it is checked, in one statement that also starts
    // a pause on every fifth miss: tries sent all at once can't slip past the limit.
    // Resolves to { resp } (paused already) or { wrong(message) } to answer a miss.
    const countTry = async (acct) => {
      const tryRow = await DB.prepare(`UPDATE accounts SET fails = fails + 1,
          locked_until = CASE WHEN (fails + 1) % 5 = 0 THEN ? + CASE WHEN fails + 1 >= 15 THEN 86400000 WHEN fails + 1 >= 10 THEN 3600000 ELSE 900000 END ELSE locked_until END
          WHERE id = ? AND locked_until <= ? RETURNING fails, locked_until`).bind(now, acct.id, now).first();
      const pause = (until) => fail(423, 'locked', `Too many wrong tries for this name. Try again ${until - now > 3600000 ? 'tomorrow' : `in ${Math.ceil((until - now) / 60000)} minutes`}.`, { retryAt: until });
      if (!tryRow) {
        // Paused, perhaps by a try that arrived a moment ago: read when the pause ends.
        const l = await DB.prepare('SELECT locked_until FROM accounts WHERE id = ?').bind(acct.id).first();
        return { resp: pause(Math.max(Number(l?.locked_until) || 0, now + 60000)) };
      }
      return { wrong: (message) => (Number(tryRow.locked_until) > now ? pause(Number(tryRow.locked_until)) : fail(401, 'wrong', message, { left: 5 - (Number(tryRow.fails) % 5) })) };
    };
    // Who is asking: a signed-in account (session token) or, for saves made before accounts, a browser key.
    const whoIs = async () => {
      const auth = request.headers.get('authorization') || '';
      const session = /^Bearer (s1\.[a-f0-9]{64})$/.exec(auth)?.[1];
      if (session) {
        const tokenHash = await sha256hex(session);
        const row = await withTables(env, () => DB.prepare('SELECT s.account_id AS id, a.display AS name FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ? AND s.expires_at > ?').bind(tokenHash, now).first());
        return row ? { id: 'a:' + row.id, account: row.id, name: row.name, tokenHash } : null;
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
        const salt = randomHex(16), code = newCode();
        // The code goes in with the account (the column is added first if this database predates it).
        const row = await withTables(env, async () => DB.prepare('INSERT INTO accounts (name, display, salt, pin_hash, created_at, rec_hash) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (name) DO NOTHING RETURNING id')
          .bind(name.toLowerCase(), name, salt, await pinHash(env, salt, b.pin), now, await codeHash(env, salt, cleanCode(code))).first());
        if (!row) return fail(409, 'taken', 'That name is taken. Choose another, or sign in if it’s yours.');
        return json(200, { token: await newSession(row.id, salt), name, code, recovery: true });
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
        const miss = await countTry(acct);
        if (miss.resp) return miss.resp;
        if (!same(await pinHash(env, acct.salt, b.pin), acct.pin_hash)) return miss.wrong('That name and PIN don’t match.');
        await DB.prepare('UPDATE accounts SET fails = 0, locked_until = 0 WHERE id = ? AND salt = ?').bind(acct.id, acct.salt).run();
        await DB.prepare('DELETE FROM sessions WHERE account_id = ? AND expires_at <= ?').bind(acct.id, now).run();
        const rec = await withTables(env, () => DB.prepare('SELECT rec_hash IS NOT NULL AS has FROM accounts WHERE id = ?').bind(acct.id).first());
        const token = await newSession(acct.id, acct.salt);
        if (!token) return wrong();
        return json(200, { token, name: acct.display, recovery: !!rec?.has });
      }

      if (path === '/recover' && method === 'POST') {
        if (tooBusy(request, now, 'signIn', SIGN_INS_PER_MINUTE)) return fail(429, 'busy', 'Too many tries from this network. Wait a minute and try again.');
        if (!env.PIN_PEPPER) return fail(503, 'setup', 'Explorer accounts aren’t switched on for this save service yet (secret PIN_PEPPER).');
        const b = await readBody();
        const name = cleanName(b?.name), code = cleanCode(b?.code);
        const wrong = () => fail(401, 'wrong', 'That name and recovery code don’t match.');
        if (!validPin(b?.newPin)) return fail(400, 'pin', 'The new PIN must be exactly 4 digits.');
        if (!name || !code) return wrong();
        const acct = await withTables(env, () => DB.prepare('SELECT id, display, salt, rec_hash FROM accounts WHERE name = ?').bind(name.toLowerCase()).first());
        if (!acct) return wrong();
        // Not counted against the name, and not stopped by a PIN pause: a code has about 60 bits, so the
        // per-network limit is enough, and anyone who knows a name could otherwise keep its owner locked
        // out of recovery too, just by sending wrong PINs or codes.
        const mine = await codeHash(env, acct.salt, code);
        if (!acct.rec_hash || !same(mine, acct.rec_hash)) return wrong();
        const fresh = newCode(), salt = randomHex(16);
        // Rotate credentials, revoke sessions and issue the replacement atomically.
        // Later statements only act if this request installed its unique salt.
        const token = 's1.' + randomHex(32);
        const [r] = await DB.batch([
          DB.prepare('UPDATE accounts SET salt = ?, pin_hash = ?, rec_hash = ?, fails = 0, locked_until = 0 WHERE id = ? AND salt = ? AND rec_hash = ?')
            .bind(salt, await pinHash(env, salt, b.newPin), await codeHash(env, salt, cleanCode(fresh)), acct.id, acct.salt, acct.rec_hash),
          DB.prepare('DELETE FROM sessions WHERE account_id = ? AND EXISTS (SELECT 1 FROM accounts WHERE id = ? AND salt = ?)').bind(acct.id, acct.id, salt),
          DB.prepare('INSERT INTO sessions (token_hash, account_id, expires_at) SELECT ?, id, ? FROM accounts WHERE id = ? AND salt = ?').bind(await sha256hex(token), now + SESSION_MS, acct.id, salt),
        ]);
        if (!r.meta?.changes) return wrong();
        return json(200, { token, name: acct.display, code: fresh, recovery: true });
      }

      if (path === '/session' && method === 'DELETE') {
        const token = /^Bearer (s1\.[a-f0-9]{64})$/.exec(request.headers.get('authorization') || '')?.[1];
        if (token) await withTables(env, async () => DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256hex(token)).run());
        return json(200, { ok: true });
      }

      const who = await whoIs();
      if (!who) return fail(401, 'signin', 'Sign in to your explorer account to use cloud saves.');

      if (path === '/recovery' && method === 'POST') {
        // A signed-in account asks for a (new) recovery code; the old one stops working.
        if (!who.account) return fail(401, 'signin', 'Sign in first.');
        if (!env.PIN_PEPPER) return fail(503, 'setup', 'Explorer accounts aren’t switched on for this save service yet (secret PIN_PEPPER).');
        const acct = await DB.prepare('SELECT salt FROM accounts WHERE id = ?').bind(who.account).first();
        if (!acct) return fail(401, 'signin', 'Sign in first.');
        const code = newCode();
        const r = await withTables(env, async () => DB.prepare('UPDATE accounts SET rec_hash = ? WHERE id = ? AND salt = ? AND EXISTS (SELECT 1 FROM sessions WHERE token_hash = ? AND account_id = ? AND expires_at > ?)')
          .bind(await codeHash(env, acct.salt, cleanCode(code)), who.account, acct.salt, who.tokenHash, who.account, now).run());
        if (!r.meta?.changes) return fail(401, 'signin', 'Your account changed during this request. Sign in again.');
        return json(200, { code, recovery: true });
      }

      if (path === '/claim' && method === 'POST') {
        // Moves a save made in this browser before accounts into the signed-in account (if it has none).
        if (!who.account) return fail(401, 'signin', 'Sign in first.');
        const b = await readBody();
        const key = typeof b?.key === 'string' && /^[a-f0-9]{64}$/.test(b.key) ? b.key : null;
        if (!key) return fail(400, 'bad-request', 'No browser key given.');
        const old = await sha256hex(key);
        const r = await withTables(env, () => DB.prepare('UPDATE explorers SET id = ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM explorers WHERE id = ?)').bind(who.id, old, who.id).run());
        if (r.meta?.changes) return json(200, { moved: true });
        if (b.replace === true) {
          // The browser's older explorer becomes the account's; the account's current save is kept as prev_*.
          // One batch (atomic on D1): the swap, then the browser's row goes, only if the swap happened.
          const [swap] = await DB.batch([
            DB.prepare('UPDATE explorers SET prev_data = data, prev_rev = rev, data = (SELECT data FROM explorers WHERE id = ?1), rev = rev + 1, saved_at = ?2 WHERE id = ?3 AND EXISTS (SELECT 1 FROM explorers WHERE id = ?1)').bind(old, now, who.id),
            DB.prepare('DELETE FROM explorers WHERE id = ?1 AND (SELECT data FROM explorers WHERE id = ?2) = data').bind(old, who.id),
          ]);
          if (swap.meta?.changes) {
            const row = await DB.prepare('SELECT rev FROM explorers WHERE id = ?').bind(who.id).first();
            return json(200, { replaced: true, rev: Number(row?.rev), savedAt: now });
          }
        }
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
        const body = await boundedText(request, MAX_SAVE + 1024);
        if (body === null) return fail(413, 'too-large', 'This save is too large to store.');
        let msg;
        try { msg = JSON.parse(body); } catch { return fail(400, 'bad-request', 'The save could not be read.'); }
        const data = msg?.data;
        if (!data || typeof data !== 'object' || Array.isArray(data) || data.kind !== 'island-explorer') return fail(400, 'bad-request', 'That is not an explorer save.');
        const text = JSON.stringify(data);
        if (new TextEncoder().encode(text).byteLength > MAX_SAVE) return fail(413, 'too-large', 'This save is too large to store.');
        const rev = Number.isSafeInteger(msg.rev) && msg.rev >= 0 ? msg.rev : -1;
        if (rev < 0) return fail(400, 'bad-request', 'The save has no revision.');
        const force = msg.force === true;

        const row = await withTables(env, () => DB.prepare('SELECT rev, saved_at FROM explorers WHERE id = ?').bind(id).first());
        if (row && now - Number(row.saved_at) < MIN_GAP_MS) return fail(429, 'too-soon', 'Saved a moment ago. Wait a second and try again.');
        if (!row) {
          // A browser key (from before accounts) may keep updating its own save, but can't start a new one:
          // otherwise anyone could fill the database with made-up keys and no account.
          if (who.legacy) return fail(403, 'signin', 'Sign in to your explorer account to save.');
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
      return fail(503, 'storage', 'The save service could not reach its storage. It may have reached its free daily limit. Your game is still running: try again later.');
    }
  },
};
