// Cloudflare Worker that keeps Creature Island explorers: each player's own saved character, creatures,
// items and story progress. The game only calls it when a player chooses Save or Load; live play,
// movement and lobbies never touch it.
//
// Set up (free plan): node tools/deploy-island-saves.mjs does all of this in one go (README "Cloud saves").
// By hand instead:
//   1. Cloudflare dashboard → Storage & Databases → D1 → Create database, name it "island-saves".
//   2. Workers & Pages → Create → Worker, name it "island-saves" → Deploy → Edit code → paste this file → Deploy.
//   3. Worker → Settings → Bindings → Add → D1 database, variable name DB, the database from step 1.
//   4. Put https://island-saves.<your-subdomain>.workers.dev into islandSaves in js/config.js and push.
// The table is created on first use. Free limits apply (D1: 5 GB stored, 100,000 writes a day; Workers:
// 100,000 requests a day); past them a save fails with a clear message and the game keeps running.
//
// Who owns a save: the player's browser keeps a private random key and sends it as a bearer token. Only
// its SHA-256 is stored, so the database never holds anything that opens a save. No IP addresses are stored.

const MAX_SAVE = 64 * 1024; // a full explorer is a few kilobytes
const MIN_GAP_MS = 2000; // one save per explorer every two seconds at most
const PER_MINUTE = 40; // requests per address per minute, counted in memory only
const DEFAULT_ORIGINS = 'https://kalalnanigoud.github.io';

const SCHEMA = `CREATE TABLE IF NOT EXISTS explorers (
  id TEXT PRIMARY KEY,
  rev INTEGER NOT NULL,
  data TEXT NOT NULL,
  saved_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  prev_data TEXT,
  prev_rev INTEGER
)`;

const recent = new Map(); // address -> [window start, count]; per Worker instance, never stored
function tooBusy(request, now) {
  const ip = request.headers.get('cf-connecting-ip') || '';
  if (!ip) return false;
  if (recent.size > 5000) recent.clear();
  const w = recent.get(ip);
  if (!w || now - w[0] > 60000) { recent.set(ip, [now, 1]); return false; }
  return ++w[1] > PER_MINUTE;
}

function allowedOrigin(origin, env) {
  if (!origin) return true; // not a browser (the deploy check, curl)
  if (/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) return true; // local development
  return String(env.ALLOWED_ORIGINS || DEFAULT_ORIGINS).split(',').map((s) => s.trim()).includes(origin);
}

async function sha256hex(text) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Runs a query, creating the table the first time the database is used.
async function withTable(env, run) {
  try { return await run(); } catch (e) {
    if (!/no such table/i.test(String(e?.message || e))) throw e;
    await env.DB.prepare(SCHEMA).run();
    return run();
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin') || '';
    const cors = {
      'access-control-allow-origin': origin || '*',
      'access-control-allow-methods': 'GET, PUT, OPTIONS',
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
    const now = Date.now();
    if (url.pathname === '/' && request.method === 'GET') return json(200, { ok: true, service: 'island-saves', version: 1, storage: !!env.DB });
    if (url.pathname !== '/explorer') return fail(404, 'not-found', 'Unknown address.');
    if (tooBusy(request, now)) return fail(429, 'busy', 'Too many requests from this network. Wait a minute and try again.');
    if (!env.DB) return fail(503, 'setup', 'The save service has no database attached yet (binding DB).');

    const key = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('authorization') || '')?.[1];
    if (!key) return fail(401, 'key', 'This device has no valid explorer key.');
    const id = await sha256hex(key);

    try {
      if (request.method === 'GET') {
        const previous = url.searchParams.get('previous') === '1';
        const row = await withTable(env, () => env.DB.prepare(previous
          ? 'SELECT prev_rev AS rev, saved_at, prev_data AS data FROM explorers WHERE id = ?'
          : 'SELECT rev, saved_at, data FROM explorers WHERE id = ?').bind(id).first());
        if (!row || row.data == null) return fail(404, 'none', previous ? 'There is no earlier save.' : 'No saved explorer for this device yet.');
        // The data was checked as JSON when it was written, so it goes back out as it is.
        return json(200, `{"rev":${Number(row.rev)},"savedAt":${Number(row.saved_at)},"data":${row.data}}`);
      }

      if (request.method === 'PUT') {
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

        const row = await withTable(env, () => env.DB.prepare('SELECT rev, saved_at FROM explorers WHERE id = ?').bind(id).first());
        if (row && now - Number(row.saved_at) < MIN_GAP_MS) return fail(429, 'too-soon', 'Saved a moment ago. Wait a second and try again.');
        if (!row) {
          const r = await env.DB.prepare('INSERT INTO explorers (id, rev, data, saved_at, created_at) VALUES (?, 1, ?, ?, ?) ON CONFLICT(id) DO NOTHING')
            .bind(id, text, now, now).run();
          if (!r.meta?.changes) return fail(409, 'conflict', 'This explorer was just saved from somewhere else.');
          return json(200, { rev: 1, savedAt: now });
        }
        if (!force && rev !== Number(row.rev)) {
          return fail(409, 'conflict', 'This explorer was saved from another tab or device since it was loaded here.', { rev: Number(row.rev), savedAt: Number(row.saved_at) });
        }
        // The old save moves to prev_* in the same statement, so a failed write keeps it as the current one.
        const r = await env.DB.prepare('UPDATE explorers SET prev_data = data, prev_rev = rev, data = ?, rev = rev + 1, saved_at = ? WHERE id = ? AND rev = ?')
          .bind(text, now, id, Number(row.rev)).run();
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
