// Cloudflare Worker that receives Game Night's anonymous crash reports (sent by js/report.js).
//
// Set up (free plan): node tools/deploy-error-reports.mjs does all of this in one go (README "Crash reports").
// By hand instead:
//   1. Cloudflare dashboard → Storage & Databases → D1 → Create database, e.g. "gn-error-reports".
//   2. Workers & Pages → Create → Worker, e.g. "gn-errors" → Deploy → Edit code → paste this file → Deploy.
//   3. Worker → Settings → Bindings → Add → D1 database, variable name DB, the database from step 1.
//   4. Worker → Settings → Variables and Secrets → add a Secret named VIEW_KEY (a long random password).
//   5. Put https://<your-worker>.workers.dev/report into errorReports in js/config.js.
// Read the latest reports at https://<your-worker>.workers.dev/recent?key=<VIEW_KEY>.
// The tables are created on first use.
//
// Nothing here stores IP addresses. Reports expire after 30 days.

const KEEP_MS = 30 * 24 * 60 * 60 * 1000;
const PER_MINUTE = 60; // a broken release can't fill the storage
// At most this many a day (set REPORTS_PER_DAY to change it). Database writes are shared by the whole
// account (100,000 a day on the free plan, cloud saves included), so crash reports must never use them up.
const PER_DAY = 2000;
const text = (value, max) => String(value ?? '').slice(0, max);
const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, data TEXT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS reports_at ON reports (at)',
  'CREATE TABLE IF NOT EXISTS report_counts (minute TEXT PRIMARY KEY, n INTEGER NOT NULL)',
];

// Runs a query, creating the tables the first time the database is used.
async function withTables(env, run) {
  try { return await run(); } catch (e) {
    if (!/no such table/i.test(String(e?.message || e))) throw e;
    for (const sql of SCHEMA) await env.DB.prepare(sql).run();
    return run();
  }
}
// Compares the reading key without giving away how much of it matched.
function sameKey(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = { 'access-control-allow-origin': '*' };
    if (!env.DB) return new Response('no database attached (binding DB)', { status: 503, headers: cors });

    if (request.method === 'POST' && url.pathname === '/report') {
      const body = await request.text();
      if (body.length > 8000) return new Response('too large', { status: 413, headers: cors });
      let r;
      try { r = JSON.parse(body); } catch { return new Response('bad report', { status: 400, headers: cors }); }
      if (!r || typeof r !== 'object' || Array.isArray(r)) return new Response('bad report', { status: 400, headers: cors });
      const now = Date.now();
      const minute = new Date(now).toISOString().slice(0, 16), day = 'day:' + minute.slice(0, 10);
      const perDay = Number(env.REPORTS_PER_DAY) > 0 ? Number(env.REPORTS_PER_DAY) : PER_DAY;
      const busy = () => new Response('busy', { status: 429, headers: cors });
      // Over a cap, a report is turned away after only reading the counters: a flood from a broken release
      // costs no database writes at all.
      const seen = await withTables(env, () => env.DB.prepare('SELECT minute, n FROM report_counts WHERE minute IN (?, ?)').bind(minute, day).all());
      const was = Object.fromEntries((seen?.results || []).map((row) => [row.minute, Number(row.n)]));
      if ((was[minute] || 0) >= PER_MINUTE || (was[day] || 0) >= perDay) return busy();
      // Counting is one atomic statement: reports arriving together each get their own numbers, so both
      // caps hold however many come at once.
      const counted = await env.DB.prepare('INSERT INTO report_counts (minute, n) VALUES (?, 1), (?, 1) ON CONFLICT (minute) DO UPDATE SET n = n + 1 RETURNING minute, n').bind(minute, day).all();
      const n = Object.fromEntries((counted?.results || []).map((row) => [row.minute, Number(row.n)]));
      if (!(n[minute] <= PER_MINUTE) || !(n[day] <= perDay)) return busy();
      const count = { n: n[minute] };
      const report = {
        version: text(r.v, 40), where: text(r.where, 40), message: text(r.message, 400), stack: text(r.stack, 2000),
        screen: text(r.screen, 20), game: text(r.game, 20), role: text(r.role, 10), started: !!r.started,
        browser: text(r.browser, 160), viewport: text(r.viewport, 20), at: new Date(now).toISOString(),
      };
      await env.DB.prepare('INSERT INTO reports (at, data) VALUES (?, ?)').bind(now, JSON.stringify(report)).run();
      // The first report of each minute tidies up: old reports, and counters from minutes gone by.
      if (count.n === 1) {
        await env.DB.prepare('DELETE FROM reports WHERE at < ?').bind(now - KEEP_MS).run();
        // ('day:…' keys sort after the plain minutes, so the first test never touches them.)
        await env.DB.prepare("DELETE FROM report_counts WHERE minute < ? OR (minute LIKE 'day:%' AND minute < ?)")
          .bind(new Date(now - 10 * 60000).toISOString().slice(0, 16), 'day:' + new Date(now - 2 * 86400000).toISOString().slice(0, 10)).run();
      }
      return new Response('ok', { headers: cors });
    }

    if (request.method === 'GET' && url.pathname === '/recent') {
      if (!env.VIEW_KEY || !sameKey(url.searchParams.get('key'), env.VIEW_KEY)) return new Response('not found', { status: 404 });
      const rows = await withTables(env, () => env.DB.prepare('SELECT data FROM reports WHERE at >= ? ORDER BY id DESC LIMIT 200').bind(Date.now() - KEEP_MS).all());
      const reports = (rows?.results || []).map((row) => JSON.parse(row.data));
      return new Response(JSON.stringify(reports, null, 2), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
    }

    return new Response('Game Night crash reports', { headers: cors });
  },
};
