// Checks server/error-reports.js (the crash-report Worker) against an in-memory stand-in for Cloudflare KV.
import assert from 'node:assert/strict';
import worker from '../server/error-reports.js';

const store = new Map();
const KV = {
  async get(k) { return store.has(k) ? store.get(k) : null; },
  async put(k, v) { store.set(k, v); },
  async list({ prefix, limit }) { return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).sort().slice(0, limit).map((name) => ({ name })) }; },
};
const env = { REPORTS: KV, VIEW_KEY: 'secret-view-key' };
const post = (body) => worker.fetch(new Request('https://w.test/report', { method: 'POST', body }), env);
const recent = (key) => worker.fetch(new Request('https://w.test/recent' + (key ? '?key=' + key : '')), env);

const good = { v: '202610310721-abc', where: 'render', message: 'x is undefined', stack: 'at render (games/gems.js:12:3)', screen: 'game', game: 'gems', role: 'host', started: true,
  browser: 'Mozilla/5.0', viewport: '375x812', name: 'Nani', code: 'ABCDE' };
assert.equal((await post(JSON.stringify(good))).status, 200);
await new Promise((r) => setTimeout(r, 5));
assert.equal((await post(JSON.stringify({ ...good, message: 'second problem' }))).status, 200);
assert.equal((await post('x'.repeat(9000))).status, 413, 'oversized reports are refused');
assert.equal((await post('not json')).status, 400, 'malformed reports are refused');
assert.equal((await recent()).status, 404, 'reading needs the key');
assert.equal((await recent('wrong')).status, 404);
const list = await (await recent('secret-view-key')).json();
assert.equal(list.length, 2);
assert.equal(list[0].message, 'second problem', 'newest first');
assert.equal(list[0].game, 'gems');
assert.ok(!('name' in list[0]) && !('code' in list[0]) && !JSON.stringify(list).includes('ABCDE'), 'only the allowed fields are kept');
for (let i = 0; i < 70; i++) await post(JSON.stringify(good));
assert.equal((await post(JSON.stringify(good))).status, 429, 'a per-minute cap protects the storage');
console.log('Crash-report worker checks passed: storage, size and format limits, allowed fields only, newest first, private reading, per-minute cap.');
