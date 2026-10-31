// Cloudflare Worker that receives Game Night's anonymous crash reports (sent by js/report.js).
//
// Set up (free plan, about five minutes; see README "Crash reports"):
//   1. Cloudflare dashboard → Storage & Databases → KV → create a namespace, e.g. "gn-error-reports".
//   2. Workers & Pages → Create → Worker → name it, e.g. "gn-errors" → Deploy → Edit code → paste this file.
//   3. Worker → Settings → Bindings → add KV namespace, variable name REPORTS, the namespace from step 1.
//   4. Worker → Settings → Variables and Secrets → add a Secret named VIEW_KEY (a long random password).
//   5. Put https://<your-worker>.workers.dev/report into errorReports in js/config.js.
// Read the latest reports at https://<your-worker>.workers.dev/recent?key=<VIEW_KEY>.
//
// Nothing here stores IP addresses. Reports expire after 30 days.

const KEEP_SECONDS = 60 * 60 * 24 * 30;
const PER_MINUTE = 60; // a broken release can't fill the storage
const text = (value, max) => String(value ?? '').slice(0, max);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = { 'access-control-allow-origin': '*' };

    if (request.method === 'POST' && url.pathname === '/report') {
      const body = await request.text();
      if (body.length > 8000) return new Response('too large', { status: 413, headers: cors });
      let r;
      try { r = JSON.parse(body); } catch { return new Response('bad report', { status: 400, headers: cors }); }
      const minute = new Date().toISOString().slice(0, 16);
      const seen = Number(await env.REPORTS.get('count:' + minute)) || 0;
      if (seen >= PER_MINUTE) return new Response('busy', { status: 429, headers: cors });
      await env.REPORTS.put('count:' + minute, String(seen + 1), { expirationTtl: 120 });
      const report = {
        version: text(r.v, 40), where: text(r.where, 40), message: text(r.message, 400), stack: text(r.stack, 2000),
        screen: text(r.screen, 20), game: text(r.game, 20), role: text(r.role, 10), started: !!r.started,
        browser: text(r.browser, 160), viewport: text(r.viewport, 20), at: new Date().toISOString(),
      };
      // Newest first when listed: keys sort by an inverted timestamp.
      const key = `r:${String(9e15 - Date.now()).padStart(16, '0')}:${crypto.randomUUID().slice(0, 8)}`;
      await env.REPORTS.put(key, JSON.stringify(report), { expirationTtl: KEEP_SECONDS });
      return new Response('ok', { headers: cors });
    }

    if (request.method === 'GET' && url.pathname === '/recent') {
      if (!env.VIEW_KEY || url.searchParams.get('key') !== env.VIEW_KEY) return new Response('not found', { status: 404 });
      const list = await env.REPORTS.list({ prefix: 'r:', limit: 200 });
      const reports = await Promise.all(list.keys.map(async (k) => JSON.parse(await env.REPORTS.get(k.name))));
      return new Response(JSON.stringify(reports, null, 2), { headers: { 'content-type': 'application/json; charset=utf-8' } });
    }

    return new Response('Game Night crash reports', { headers: cors });
  },
};
