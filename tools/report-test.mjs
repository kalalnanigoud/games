// Checks server/error-reports.js (the crash-report Worker) on a real SQLite database dressed up as
// Cloudflare D1, and tools/deploy-error-reports.mjs against a stand-in for the Cloudflare API.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import worker from '../server/error-reports.js';
import { fakeD1 } from './fake-d1.mjs';
import { fakeCloudflare, fakeWorkerHost, runScript } from './fake-cloudflare.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const db = new DatabaseSync(':memory:');
const env = { DB: fakeD1(db), VIEW_KEY: 'secret-view-key' };
let clock = Date.parse('2026-10-31T12:00:30Z');
const realNow = Date.now;
Date.now = () => clock;
const post = (body) => worker.fetch(new Request('https://w.test/report', { method: 'POST', body }), env);
const recent = (key) => worker.fetch(new Request('https://w.test/recent' + (key ? '?key=' + key : '')), env);

const good = { v: '202610310721-abc', where: 'render', message: 'x is undefined', stack: 'at render (games/gems.js:12:3)', screen: 'game', game: 'gems', role: 'host', started: true,
  browser: 'Mozilla/5.0', viewport: '375x812', name: 'Nani', code: 'ABCDE' };
assert.equal((await post(JSON.stringify(good))).status, 200, 'a report is stored (and the tables are created on first use)');
clock += 5;
assert.equal((await post(JSON.stringify({ ...good, message: 'second problem' }))).status, 200);
assert.equal((await post('x'.repeat(9000))).status, 413, 'oversized reports are refused');
assert.equal((await post('not json')).status, 400, 'malformed reports are refused');
for (const odd of ['null', '[]', '42', '"text"', 'true']) assert.equal((await post(odd)).status, 400, `${odd} is refused, not a crash`);
assert.equal((await recent()).status, 404, 'reading needs the key');
assert.equal((await recent('wrong')).status, 404);
assert.equal((await recent('secret-view-ke')).status, 404, 'a nearly right key is still wrong');
let list = await (await recent('secret-view-key')).json();
assert.equal(list.length, 2);
assert.equal(list[0].message, 'second problem', 'newest first');
assert.equal(list[0].game, 'gems');
assert.ok(!('name' in list[0]) && !('code' in list[0]) && !JSON.stringify(list).includes('ABCDE'), 'only the allowed fields are kept');

// The cap holds when reports arrive all at once: each is counted in one atomic step.
clock = Date.parse('2026-10-31T12:01:10Z');
const burst = await Promise.all(Array.from({ length: 100 }, () => post(JSON.stringify(good)).then((r) => r.status)));
assert.equal(burst.filter((s) => s === 200).length, 60, '100 reports at once: exactly 60 are stored');
assert.equal(burst.filter((s) => s === 429).length, 40, 'and the rest are told to slow down');
clock += 60000;
assert.equal((await post(JSON.stringify(good))).status, 200, 'the next minute starts afresh');

// Reports expire after 30 days, and old minute counters are tidied away.
clock += 31 * 24 * 3600 * 1000;
assert.equal((await post(JSON.stringify({ ...good, message: 'a month later' }))).status, 200);
list = await (await recent('secret-view-key')).json();
assert.deepEqual(list.map((r) => r.message), ['a month later'], 'reports older than 30 days are gone');
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM report_counts').get().n, 1, 'old per-minute counters are removed');
assert.ok(!JSON.stringify(db.prepare('SELECT * FROM reports').all()).match(/\d+\.\d+\.\d+\.\d+/), 'no IP addresses are stored');
assert.equal((await worker.fetch(new Request('https://w.test/report', { method: 'POST', body: '{}' }), {})).status, 503, 'no database bound');
Date.now = realNow;

// The one-command setup.
const TOKEN = 'test-token-' + crypto.randomBytes(6).toString('hex');
const cf = await fakeCloudflare(TOKEN, { subdomain: 'test-games' });
const liveDb = new DatabaseSync(':memory:');
const live = await fakeWorkerHost(worker, () => ({ DB: fakeD1(liveDb), VIEW_KEY: cf.state.secrets['gn-errors']?.VIEW_KEY }));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reports-deploy-'));
const configCopy = path.join(tmp, 'config.js');
fs.writeFileSync(configCopy, fs.readFileSync(path.join(root, 'js/config.js'), 'utf8').replace(/errorReports:\s*'[^']*'/, "errorReports: ''"));
const deploy = (...extra) => runScript(root, 'tools/deploy-error-reports.mjs', TOKEN, ['--api', cf.api, '--config', configCopy, '--check-url', live.url, ...extra]);

let run = await deploy();
assert.equal(run.code, 0, run.out);
assert.ok(!run.out.includes(TOKEN), 'the token is never printed');
assert.deepEqual(cf.state.dbs.map((d) => d.name), ['gn-error-reports'], 'creates the database');
const up = cf.state.uploads[0];
assert.equal(up.name, 'gn-errors');
assert.deepEqual(up.metadata.bindings, [{ type: 'd1', name: 'DB', id: 'db-uuid-1' }], 'binds the database as DB');
assert.deepEqual(up.metadata.keep_bindings, ['secret_text'], 'keeps secrets already on the Worker');
assert.equal(up.script, fs.readFileSync(path.join(root, 'server/error-reports.js'), 'utf8'), 'uploads the Worker as it is');
const key = cf.state.secrets['gn-errors']?.VIEW_KEY;
assert.ok(key && key.length >= 32, 'sets a long random reading key');
assert.ok(run.out.includes(`/recent?key=${key}`), 'and shows the reading link once');
assert.deepEqual(cf.state.enabled['gn-errors'], { enabled: true, previews_enabled: false });
assert.match(fs.readFileSync(configCopy, 'utf8'), new RegExp(`errorReports: '${live.url}/report'`), 'writes the address into config.js');
assert.match(run.out, /it works/, 'and checks the database and the key end to end');

run = await deploy();
assert.equal(run.code, 0, run.out);
assert.equal(cf.state.secrets['gn-errors'].VIEW_KEY, key, 'a second run keeps the reading key');
assert.ok(!run.out.includes(key), 'and doesn’t show it again');
assert.equal(cf.state.dbs.length, 1, 'and reuses the database');
run = await deploy('--new-key');
assert.notEqual(cf.state.secrets['gn-errors'].VIEW_KEY, key, '--new-key replaces a lost key');
assert.equal((await runScript(root, 'tools/deploy-error-reports.mjs', TOKEN, ['--config', configCopy, '--check'])).code, 0, '--check confirms the address');
cf.state.deny = '/accounts/acc1/d1';
cf.state.dbs = [];
run = await deploy();
assert.equal(run.code, 1);
assert.match(run.out, /D1 · Edit/, 'a token without D1 rights is told which permission to add');
cf.close(); live.close();
console.log('Crash-report checks passed: storage, size and format limits (null and other non-objects refused), allowed fields only, newest first, private reading, a per-minute cap that holds under 100 simultaneous reports, 30-day expiry; one-command setup (database, Worker, reading key kept or replaced, config, missing permissions).');
