// A stand-in for the parts of the Cloudflare API the setup scripts use (accounts, D1 databases, Worker
// uploads and secrets, workers.dev), plus a helper that runs a setup script against it. For tests only.
import http from 'node:http';
import { spawn } from 'node:child_process';

export async function fakeCloudflare(token, { subdomain = null } = {}) {
  const state = { dbs: [], subdomain, uploads: [], secrets: {}, enabled: {}, requests: [], deny: null };
  const ok = (res, result) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ success: true, errors: [], result })); };
  const bad = (res, status, code, message) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ success: false, errors: [{ code, message }], result: null })); };
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const p = req.url.replace(/^\/client\/v4/, '');
    state.requests.push({ method: req.method, path: p, auth: req.headers.authorization });
    if (req.headers.authorization !== 'Bearer ' + token) return bad(res, 401, 10000, 'Authentication error');
    if (state.deny && p.startsWith(state.deny)) return bad(res, 403, 10000, 'Authentication error');
    let m;
    if (req.method === 'GET' && p.startsWith('/accounts?')) return ok(res, [{ id: 'acc1', name: 'Test account' }]);
    if (req.method === 'GET' && p.startsWith('/accounts/acc1/d1/database?')) return ok(res, state.dbs);
    if (req.method === 'POST' && p === '/accounts/acc1/d1/database') {
      const db = { uuid: 'db-uuid-' + (state.dbs.length + 1), name: JSON.parse(body).name };
      state.dbs.push(db);
      return ok(res, db);
    }
    if ((m = /^\/accounts\/acc1\/workers\/scripts\/([\w-]+)\/secrets$/.exec(p))) {
      const name = m[1];
      if (!state.uploads.some((u) => u.name === name)) return bad(res, 404, 10007, 'This Worker does not exist on your account.');
      if (req.method === 'GET') return ok(res, Object.keys(state.secrets[name] || {}).map((n) => ({ name: n, type: 'secret_text' })));
      const s = JSON.parse(body);
      (state.secrets[name] ||= {})[s.name] = s.text;
      return ok(res, { name: s.name, type: s.type });
    }
    if ((m = /^\/accounts\/acc1\/workers\/scripts\/([\w-]+)$/.exec(p)) && req.method === 'PUT') {
      const form = await new Request('http://x', { method: 'PUT', headers: { 'content-type': req.headers['content-type'] }, body }).formData();
      const metadata = JSON.parse(await form.get('metadata').text());
      const file = form.get(metadata.main_module);
      state.uploads.push({ name: m[1], metadata, script: await file.text(), type: file.type });
      return ok(res, { id: m[1] });
    }
    if (req.method === 'GET' && p === '/accounts/acc1/workers/subdomain') return state.subdomain ? ok(res, { subdomain: state.subdomain }) : bad(res, 404, 10007, 'This account does not have a workers.dev subdomain');
    if (req.method === 'PUT' && p === '/accounts/acc1/workers/subdomain') { state.subdomain = JSON.parse(body).subdomain; return ok(res, { subdomain: state.subdomain }); }
    if ((m = /^\/accounts\/acc1\/workers\/scripts\/([\w-]+)\/subdomain$/.exec(p)) && req.method === 'POST') { state.enabled[m[1]] = JSON.parse(body); return ok(res, null); }
    bad(res, 404, 7003, 'No route for that URI');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { state, api: `http://127.0.0.1:${server.address().port}/client/v4`, close: () => server.close() };
}

// Where a deployed Worker would answer: runs `worker` locally, with env() for its bindings.
export async function fakeWorkerHost(worker, env) {
  const server = http.createServer(async (req, res) => {
    const out = await worker.fetch(new Request('http://live.test' + req.url, { method: req.method, headers: req.headers }), env());
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

// Runs a setup script with a token in its environment; resolves to { code, out }.
export function runScript(root, script, token, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: root, env: { ...process.env, CLOUDFLARE_API_TOKEN: token } });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ code, out }));
  });
}
