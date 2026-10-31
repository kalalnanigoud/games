// Checks Creature Island's cloud saves end to end without a Cloudflare account:
//   1. server/island-saves.js (the Worker) against a real SQLite database dressed up as Cloudflare D1,
//   2. games/island-cloud.js (what the game calls) talking to that Worker,
//   3. tools/deploy-island-saves.mjs against a stand-in for the Cloudflare API.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import worker from '../server/island-saves.js';
import { fakeD1 } from './fake-d1.mjs';
import { fakeCloudflare, fakeWorkerHost, runScript } from './fake-cloudflare.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const newKey = () => crypto.randomBytes(32).toString('hex');

/* ---------------- 1. the Worker ---------------- */

const sqlite = new DatabaseSync(':memory:');
let broken = false;
const env = { DB: fakeD1(sqlite, () => broken) };
let clock = Date.now();
const realNow = Date.now;
Date.now = () => clock;
const call = (method, p, { key, body, origin, ip, raw } = {}) => worker.fetch(new Request('https://saves.test' + p, {
  method,
  headers: { ...(key ? { authorization: 'Bearer ' + key } : {}), ...(origin ? { origin } : {}), ...(ip ? { 'cf-connecting-ip': ip } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
  body: raw ?? (body ? JSON.stringify(body) : undefined),
}), env);
const explorer = (name, level = 1) => ({ kind: 'island-explorer', v: 1, name, level, team: [{ sp: 'mossip', lv: level }] });

let r = await call('GET', '/');
assert.deepEqual(await r.json(), { ok: true, service: 'island-saves', version: 1, storage: true });
r = await call('OPTIONS', '/explorer', { origin: 'https://kalalnanigoud.github.io' });
assert.equal(r.status, 204, 'preflight from the live site');
assert.equal(r.headers.get('access-control-allow-origin'), 'https://kalalnanigoud.github.io');
assert.match(r.headers.get('access-control-allow-headers'), /authorization/);
assert.equal((await call('GET', '/explorer', { origin: 'https://evil.example', key: newKey() })).status, 403, 'other websites are refused');
assert.equal((await call('OPTIONS', '/explorer', { origin: 'http://localhost:8080' })).status, 204, 'local development is allowed');
assert.equal((await call('GET', '/explorer')).status, 401, 'a key is required');
assert.equal((await call('GET', '/explorer', { key: 'short' })).status, 401);

const keyA = newKey(), keyB = newKey();
r = await call('GET', '/explorer', { key: keyA });
assert.equal(r.status, 404, 'a new device has no save (and the table is created on first use)');
assert.equal((await r.json()).error, 'none');

assert.equal((await call('PUT', '/explorer', { key: keyA, body: { rev: 0, data: { kind: 'something-else' } } })).status, 400, 'only explorer saves');
assert.equal((await call('PUT', '/explorer', { key: keyA, body: { data: explorer('Ann') } })).status, 400, 'a revision is required');
assert.equal((await call('PUT', '/explorer', { key: keyA, raw: '{nope' })).status, 400);
assert.equal((await call('PUT', '/explorer', { key: keyA, body: { rev: 0, data: { ...explorer('Ann'), pad: 'x'.repeat(70000) } } })).status, 413, 'size limit');

r = await call('PUT', '/explorer', { key: keyA, body: { rev: 0, data: explorer('Ann', 3) } });
assert.equal(r.status, 200);
assert.deepEqual(await r.json(), { rev: 1, savedAt: clock });
r = await call('GET', '/explorer', { key: keyA });
assert.deepEqual(await r.json(), { rev: 1, savedAt: clock, data: explorer('Ann', 3) });
assert.equal((await call('PUT', '/explorer', { key: keyA, body: { rev: 1, data: explorer('Ann', 4) } })).status, 429, 'one save every two seconds');
clock += 2500;
r = await call('PUT', '/explorer', { key: keyA, body: { rev: 0, data: explorer('Ann', 9) } });
assert.equal(r.status, 409, 'a stale revision is a conflict, not an overwrite');
assert.deepEqual(await r.json().then((j) => [j.error, j.rev]), ['conflict', 1]);
r = await call('PUT', '/explorer', { key: keyA, body: { rev: 1, data: explorer('Ann', 4) } });
assert.equal((await r.json()).rev, 2);
assert.equal((await (await call('GET', '/explorer', { key: keyA })).json()).data.level, 4);
assert.equal((await (await call('GET', '/explorer?previous=1', { key: keyA })).json()).data.level, 3, 'the save before is kept');
clock += 2500;
r = await call('PUT', '/explorer', { key: keyA, body: { rev: 0, data: explorer('Ann', 5), force: true } });
assert.equal((await r.json()).rev, 3, 'an explicit replace overwrites');
assert.equal((await call('GET', '/explorer', { key: keyB })).status, 404, 'each key has its own save');

const rows = sqlite.prepare('SELECT * FROM explorers').all();
assert.equal(rows.length, 1);
assert.equal(rows[0].id, sha(keyA), 'stored under the key’s SHA-256');
assert.ok(!JSON.stringify(rows).includes(keyA), 'the key itself is never stored');

broken = true;
clock += 2500;
r = await call('PUT', '/explorer', { key: keyA, body: { rev: 3, data: explorer('Ann', 6) } });
assert.equal(r.status, 503);
assert.match((await r.json()).message, /free daily limit/);
broken = false;
assert.equal((await (await call('GET', '/explorer', { key: keyA })).json()).data.level, 5, 'a failed write keeps the last good save');
assert.equal((await worker.fetch(new Request('https://saves.test/explorer', { headers: { authorization: 'Bearer ' + keyA } }), {})).status, 503, 'no database bound');
let busy = 0;
for (let i = 0; i < 45; i++) if ((await call('GET', '/explorer', { key: keyB, ip: '203.0.113.9' })).status === 429) busy++;
assert.ok(busy > 0 && busy <= 5, 'one network address is limited per minute');
Date.now = realNow;

/* ---------------- 2. the game's save client ---------------- */

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { default: CONFIG } = await import('../js/config.js');
const cloud = await import('../games/island-cloud.js');
CONFIG.islandSaves = '';
await assert.rejects(cloud.loadExplorer(), (e) => e.code === 'setup', 'not set up yet');
CONFIG.islandSaves = 'https://saves.test/';
const clientDb = new DatabaseSync(':memory:');
const clientEnv = { DB: fakeD1(clientDb) };
let mode = 'worker';
globalThis.fetch = async (url, init) => {
  if (mode === 'down') throw new TypeError('fetch failed');
  if (mode === 'cloudflare-page') return new Response('<html>Error 1027</html>', { status: 429, headers: { 'content-type': 'text/html' } });
  return worker.fetch(new Request(url, init), clientEnv);
};
const key = cloud.explorerKey();
assert.match(key, /^[a-f0-9]{64}$/);
assert.equal(cloud.explorerKey(), key, 'the key stays the same');
assert.equal(store.get('island-explorer-key'), key, 'and is kept on this device');
assert.ok(cloud.keyIsKept());
assert.ok(!cloud.explorerTag().includes(key.slice(0, 16)), 'the tag the host sees is not the key');
assert.equal(await cloud.loadExplorer(), null, 'no save yet');
const saved = await cloud.saveExplorer(explorer('Bo', 2), 0);
assert.equal(saved.rev, 1);
assert.deepEqual((await cloud.loadExplorer()).data, explorer('Bo', 2));
await new Promise((res) => setTimeout(res, 2100));
await assert.rejects(cloud.saveExplorer(explorer('Bo', 3), 0), (e) => e.code === 'conflict' && e.rev === 1);
assert.equal((await cloud.saveExplorer(explorer('Bo', 3), 1)).rev, 2);
mode = 'down';
await assert.rejects(cloud.saveExplorer(explorer('Bo', 4), 2), (e) => e.code === 'network' && /save to a file/.test(e.message));
mode = 'cloudflare-page';
await assert.rejects(cloud.loadExplorer(), (e) => e.code === 'unavailable' && /daily limit/.test(e.message));
mode = 'worker';
assert.equal((await cloud.loadExplorer()).rev, 2, 'failed attempts changed nothing');

/* ---------------- 3. the deploy script ---------------- */

const TOKEN = 'test-token-' + crypto.randomBytes(6).toString('hex');
const cf = await fakeCloudflare(TOKEN);
const cfState = cf.state;
// Where the deployed Worker would answer: the real Worker on another SQLite database.
const liveDb = new DatabaseSync(':memory:');
const live = await fakeWorkerHost(worker, () => ({ DB: fakeD1(liveDb) }));
const liveBase = live.url;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'island-deploy-'));
const configCopy = path.join(tmp, 'config.js');
fs.writeFileSync(configCopy, fs.readFileSync(path.join(root, 'js/config.js'), 'utf8').replace(/islandSaves:\s*'[^']*'/, "islandSaves: ''"));
const deploy = (...extra) => runScript(root, 'tools/deploy-island-saves.mjs', TOKEN, ['--api', cf.api, '--config', configCopy, ...extra]);

let run = await deploy('--subdomain', 'test-games', '--check-url', liveBase);
assert.equal(run.code, 0, run.out);
assert.ok(!run.out.includes(TOKEN), 'the token is never printed');
assert.ok(cfState.requests.every((q) => q.auth === 'Bearer ' + TOKEN), 'every request carries the token');
assert.deepEqual(cfState.dbs.map((d) => d.name), ['island-saves'], 'creates the database');
const up = cfState.uploads[0];
assert.equal(up.metadata.main_module, 'island-saves.js');
assert.deepEqual(up.metadata.bindings, [{ type: 'd1', name: 'DB', id: 'db-uuid-1' }], 'binds the database as DB');
assert.equal(up.script, fs.readFileSync(path.join(root, 'server/island-saves.js'), 'utf8'), 'uploads the Worker as it is');
assert.equal(up.type, 'application/javascript+module');
assert.equal(cfState.subdomain, 'test-games', 'creates the workers.dev subdomain when the account has none');
assert.deepEqual(cfState.enabled['island-saves'], { enabled: true, previews_enabled: false });
assert.match(fs.readFileSync(configCopy, 'utf8'), new RegExp(`islandSaves: '${liveBase}'`), 'writes the address into config.js');
assert.match(run.out, /it works/, 'and checks that it answers');
assert.ok(liveDb.prepare("SELECT name FROM sqlite_master WHERE name = 'explorers'").get(), 'the check created the table');

const before = cfState.requests.length;
run = await deploy('--check-url', liveBase);
assert.equal(run.code, 0, run.out);
const again = cfState.requests.slice(before);
assert.ok(!again.some((q) => q.method === 'POST' && q.path === '/accounts/acc1/d1/database'), 'a second run reuses the database');
assert.ok(!again.some((q) => q.method === 'PUT' && q.path.endsWith('/workers/subdomain')), 'and the subdomain');
assert.equal(cfState.uploads.length, 2, 'and updates the same Worker');

assert.equal((await deploy('--check')).code, 0, '--check confirms the address in config.js');

cfState.dbs = [];
cfState.deny = '/accounts/acc1/d1';
run = await deploy('--check-url', liveBase);
assert.equal(run.code, 1);
assert.match(run.out, /D1 · Edit/, 'a token without D1 rights is told which permission to add');
assert.ok(!run.out.includes(TOKEN));

cf.close(); live.close();
// The copy of config.js stays in the system temp folder (a few hundred bytes).
console.log('Island save checks passed: Worker (keys, revisions, conflicts, size and rate limits, failed writes keep the last save, only key hashes stored), game save client (errors, conflicts, offline), deploy script (creates, reuses, binds, writes config, explains missing permissions).');
