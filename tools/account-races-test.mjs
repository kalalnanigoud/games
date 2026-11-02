// Real Worker/SQLite interleavings and browser save contexts; no external requests.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import worker from '../server/island-saves.js';
import reports from '../server/error-reports.js';
import { fakeD1 } from './fake-d1.mjs';
import * as cloud from '../games/island-cloud.js';
import { createSaveCentre } from '../games/save-centre.js';

const db = new DatabaseSync(':memory:'), base = fakeD1(db);
let pause = null;
const env = { PIN_PEPPER: 'local-test-only', DB: { ...base, prepare(sql) {
  const st = base.prepare(sql), original = st.first;
  st.first = async () => {
    const row = await original();
    if (pause && sql.startsWith(pause.sql)) { const p = pause; pause = null; p.enter(); await p.release; }
    return row;
  };
  return st;
} } };
function intercept(sql) {
  let enter, release;
  const started = new Promise(r => { enter = r; }), done = new Promise(r => { release = r; });
  pause = { sql, enter, release: done };
  return { started, release };
}
const call = (method, path, body, token) => worker.fetch(new Request('https://test.invalid' + path, {
  method, headers: token ? { authorization: 'Bearer ' + token } : {}, body: body ? JSON.stringify(body) : undefined,
}), env);
const create = async name => (await call('POST', '/account', { name, pin: '1234' })).json();
const alice = await create('Alice');
const loginGate = intercept('SELECT id, display, salt, pin_hash');
const pendingLogin = call('POST', '/login', { name: 'Alice', pin: '1234' });
await loginGate.started;
const reset = await call('POST', '/recover', { name: 'Alice', code: alice.code, newPin: '5678' });
assert.equal(reset.status, 200);
const fresh = await reset.json();
loginGate.release();
assert.equal((await pendingLogin).status, 401, 'an old checked PIN cannot mint a session after recovery');
assert.equal((await call('GET', '/explorer', null, alice.token)).status, 401);
assert.equal((await call('GET', '/explorer', null, fresh.token)).status, 404, 'replacement session remains authorized');

const bea = await create('Beatrice');
const codeGate = intercept('SELECT salt FROM accounts WHERE id');
const pendingCode = call('POST', '/recovery', {}, bea.token);
await codeGate.started;
const recovered = await call('POST', '/recover', { name: 'Beatrice', code: bea.code, newPin: '5678' });
assert.equal(recovered.status, 200);
const recovery = await recovered.json();
codeGate.release();
assert.equal((await pendingCode).status, 401, 'stale code generation cannot overwrite the recovered account');
assert.equal((await call('POST', '/recover', { name: 'Beatrice', code: recovery.code, newPin: '9999' })).status, 200, 'returned recovery code still works');
const cy = await create('Cyrus');
const competing = await Promise.all([0, 1].map(() => call('POST', '/recover', { name: 'Cyrus', code: cy.code, newPin: '5678' })));
assert.deepEqual(competing.map(r => r.status).sort(), [200, 401], 'one recovery code has exactly one winner');

// Cross-tab saves exercise the actual client against the actual Worker.
const one = await create('FirstAccount'), two = await create('SecondAccount');
const rec = name => ({ kind: 'island-explorer', v: 1, name });
await call('PUT', '/explorer', { rev: 0, data: rec('First') }, one.token);
await call('PUT', '/explorer', { rev: 0, data: rec('Second') }, two.token);
db.prepare('UPDATE explorers SET saved_at = saved_at - 3000').run();
const store = new Map();
globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
globalThis.document = { getElementById: () => ({}) };
const select = (a, name) => { store.set('island-session', JSON.stringify({ token: a.token, name })); cloud.account(); };
let uploads = 0, confirmed = 0;
globalThis.fetch = async (url, opts) => { if (opts.method === 'PUT') uploads++; return worker.fetch(new Request(url, opts), env); };
const noop = () => {};
const centre = snapshot => createSaveCentre({ icons: {}, ready: () => true, paint: noop, repaintOverlay: noop,
  snapshot: snapshot || (async () => ({ rec: rec('First'), snap: 1 })), confirmSaved: async () => { confirmed++; return true; }, chime: noop });
select(one, 'FirstAccount');
const c = centre(); c.adopt({ rev: 1, data: rec('First'), savedAt: 1 });
select(two, 'SecondAccount');
assert.equal((await c.saveCloud()).ok, false);
assert.equal(c.s.save.state, 'account', 'account change requires an explicit decision');
assert.equal(uploads, 0);
assert.equal((await (await call('GET', '/explorer', null, two.token)).json()).data.name, 'Second');

select(one, 'FirstAccount');
let releaseSnapshot;
const delayed = centre(() => new Promise(r => { releaseSnapshot = r; })); delayed.adopt({ rev: 1, data: rec('First') });
const saving = delayed.saveCloud();
select(two, 'SecondAccount');
releaseSnapshot({ rec: rec('First'), snap: 2 });
assert.equal((await saving).ok, false); assert.equal(uploads, 0, 'account switch during snapshot prevents upload');

select(one, 'FirstAccount');
let respond, sent;
const requestStarted = new Promise(r => { sent = r; });
globalThis.fetch = async (_url, opts) => { assert.equal(opts.headers.authorization, 'Bearer ' + one.token); sent(); return new Promise(r => { respond = r; }); };
const inFlight = centre(); inFlight.adopt({ rev: 1, data: rec('First') });
const savingResponse = inFlight.saveCloud(); await requestStarted;
select(two, 'SecondAccount');
respond(Response.json({ rev: 2, savedAt: 2 }));
assert.equal((await savingResponse).ok, false); assert.equal(confirmed, 0, 'stale response cannot acknowledge current gameplay');
assert.equal(cloud.account().token, two.token);

select(one, 'FirstAccount');
let respondUnauthorized;
globalThis.fetch = async () => new Promise(r => { respondUnauthorized = r; });
const loading = cloud.loadExplorer();
select(two, 'SecondAccount');
respondUnauthorized(Response.json({ error: 'signin' }, { status: 401 }));
await assert.rejects(loading, e => e.code === 'account-changed');
assert.equal(cloud.account().token, two.token, 'a late unauthorized response cannot sign out the new account');

async function oversized(target, path, token) {
  let consumed = 0, cancelled = false;
  const bytes = 1024 * 1024, chunk = new Uint8Array(16384).fill(32);
  const body = new ReadableStream({ pull(c) { if (consumed >= bytes) return c.close(); consumed += chunk.length; c.enqueue(chunk); }, cancel() { cancelled = true; } });
  const response = await target.fetch(new Request('https://test.invalid' + path, { method: path === '/explorer' ? 'PUT' : 'POST', duplex: 'half', body, headers: token ? { authorization: 'Bearer ' + token } : {} }), env);
  assert.equal(response.status, path === '/account' ? 400 : 413);
  assert.ok(consumed < bytes, 'oversized request stops before buffering the entire stream');
  assert.equal(cancelled, true);
}
await oversized(worker, '/explorer', two.token);
await oversized(worker, '/account');
await oversized(reports, '/report');
db.close();
console.log('Account regressions passed: concurrent recovery/login, single-use codes, cross-tab save identity, delayed snapshots/responses, bounded streams.');
