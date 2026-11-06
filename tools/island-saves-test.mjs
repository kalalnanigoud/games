// Checks Creature Island's cloud saves end to end without a Cloudflare account:
//   1. server/island-saves.js (the Worker) against a real SQLite database dressed up as Cloudflare D1:
//      explorer accounts (name + 4-digit PIN), the wrong-PIN pause, sessions, saves made before accounts,
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
const env = { DB: fakeD1(sqlite, () => broken), PIN_PEPPER: 'test-pepper-' + newKey() };
let clock = Date.parse('2026-11-01T10:00:00Z');
const realNow = Date.now;
Date.now = () => clock;
let ipN = 0;
const freshIp = () => `198.51.100.${(ipN++ % 250) + 1}`; // keeps the per-address limits out of the way
const call = (method, p, { key, body, origin, ip = freshIp(), raw, e = env } = {}) => worker.fetch(new Request('https://saves.test' + p, {
  method,
  headers: { ...(key ? { authorization: 'Bearer ' + key } : {}), ...(origin ? { origin } : {}), ...(ip ? { 'cf-connecting-ip': ip } : {}), ...(body || raw ? { 'content-type': 'application/json' } : {}) },
  body: raw ?? (body ? JSON.stringify(body) : undefined),
}), e);
const CODE_RE = /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/; // 31 characters, no O/0/I/1/L
const explorer = (name, level = 1) => ({ kind: 'island-explorer', v: 1, name, level, team: [{ sp: 'mossip', lv: level }] });

let r = await call('GET', '/');
assert.deepEqual(await r.json(), { ok: true, service: 'island-saves', version: 2, storage: true, accounts: true });
r = await call('OPTIONS', '/login', { origin: 'https://kalalnanigoud.github.io' });
assert.equal(r.status, 204, 'preflight from the live site');
assert.match(r.headers.get('access-control-allow-methods'), /POST/);
assert.equal((await call('POST', '/login', { origin: 'https://evil.example', body: { name: 'x', pin: '0000' } })).status, 403, 'other websites are refused');

// Creating an account.
assert.equal((await call('POST', '/account', { body: { name: 'Nani', pin: '4826' }, e: { DB: env.DB } })).status, 503, 'no PIN secret: accounts stay off');
for (const [body, why] of [[{ name: 'ab', pin: '1234' }, 'too short'], [{ name: 'x'.repeat(21), pin: '1234' }, 'too long'], [{ name: 'bad<name>', pin: '1234' }, 'odd characters'], [{ name: 'Nani', pin: '123' }, '3 digits'], [{ name: 'Nani', pin: '12345' }, '5 digits'], [{ name: 'Nani', pin: 'abcd' }, 'not digits']]) {
  assert.equal((await call('POST', '/account', { body })).status, 400, `refused: ${why}`);
}
assert.equal((await call('POST', '/account', { raw: 'null' })).status, 400, 'a null body is refused, not a crash');
r = await call('POST', '/account', { body: { name: '  Nani   Goud ', pin: '4826' } });
assert.equal(r.status, 200);
const nani = await r.json();
assert.equal(nani.name, 'Nani Goud', 'names are tidied');
assert.match(nani.token, /^s1\.[a-f0-9]{64}$/);
assert.equal((await call('POST', '/account', { body: { name: 'nani goud', pin: '1111' } })).status, 409, 'names are unique, whatever the case');

// Saving and loading as that account, from any device.
assert.equal((await call('GET', '/explorer')).status, 401, 'saves need an account');
assert.equal((await call('GET', '/explorer', { key: 's1.' + newKey() })).status, 401, 'a made-up session is refused');
r = await call('GET', '/explorer', { key: nani.token });
assert.equal(r.status, 404, 'a new account has no save yet');
r = await call('PUT', '/explorer', { key: nani.token, body: { rev: 0, data: explorer('Nani', 3) } });
assert.deepEqual(await r.json(), { rev: 1, savedAt: clock });
clock += 2500;
r = await call('POST', '/login', { body: { name: 'NANI GOUD', pin: '4826' } });
assert.equal(r.status, 200, 'signing in on another device');
const laptop = await r.json();
assert.notEqual(laptop.token, nani.token, 'each device gets its own session');
assert.deepEqual((await (await call('GET', '/explorer', { key: laptop.token })).json()).data, explorer('Nani', 3), 'and sees the same explorer');
assert.equal((await call('PUT', '/explorer', { key: laptop.token, body: { rev: 0, data: explorer('Nani', 9) } })).status, 409, 'a stale revision is a conflict');
assert.equal((await (await call('PUT', '/explorer', { key: laptop.token, body: { rev: 1, data: explorer('Nani', 4) } })).json()).rev, 2);
clock += 2500;
assert.equal((await call('PUT', '/explorer', { key: laptop.token, body: { rev: 2, data: explorer('Nani', 4) } })).status, 200);
assert.equal((await call('PUT', '/explorer', { key: laptop.token, body: { rev: 3, data: explorer('Nani', 5) } })).status, 429, 'one save every two seconds');
assert.equal((await (await call('GET', '/explorer?previous=1', { key: nani.token })).json()).data.level, 4, 'the save before is kept');

// Wrong PINs: a short pause after 5, longer after 10, a day after 15.
const tryPin = (pin, name = 'Nani Goud') => call('POST', '/login', { body: { name, pin } });
r = await tryPin('0000');
assert.equal(r.status, 401);
assert.deepEqual(await r.json().then((j) => [j.error, j.left]), ['wrong', 4], 'says how many tries are left');
assert.equal((await tryPin('0000', 'Nobody Here')).status, 401, 'an unknown name looks the same as a wrong PIN');
for (let i = 0; i < 3; i++) await tryPin('1111');
r = await tryPin('2222');
assert.equal(r.status, 423, 'the fifth wrong PIN pauses the name');
assert.match((await r.json()).message, /15 minutes/);
assert.equal((await tryPin('4826')).status, 423, 'even the right PIN waits out the pause');
clock += 15 * 60000 + 1000;
assert.equal((await tryPin('4826')).status, 200, 'after the pause the right PIN works');
assert.equal((await tryPin('0000')).status, 401, 'and a right PIN starts the count again');
// Many guesses at once can't slip past the limit: each try is counted before its PIN is checked.
clock += 1000;
const burst = await Promise.all(Array.from({ length: 60 }, (_, i) => tryPin(String(1000 + i)).then((x) => x.status)));
assert.ok(!burst.includes(200), 'no guess got in');
assert.equal(burst.filter((s) => s === 401).length + 1, 4, '60 guesses at once (after one earlier miss): only 4 more were checked, the fifth miss in a row starting the pause');
assert.ok(burst.filter((s) => s === 423).length >= 55);
clock += 15 * 60000 + 1000;
for (let i = 0; i < 4; i++) await tryPin('9999');
r = await tryPin('9998');
assert.match((await r.json()).message, /60 minutes|in \d+ minutes/, 'the second pause is an hour');
clock += 3600 * 1000 + 1000;
for (let i = 0; i < 4; i++) await tryPin('9999');
r = await tryPin('9997');
assert.match((await r.json()).message, /tomorrow/, 'the third is a day');
clock += 24 * 3600 * 1000 + 1000;
assert.equal((await tryPin('4826')).status, 200, 'and then it works again');

// Signing out ends that device's session only.
assert.equal((await call('DELETE', '/session', { key: laptop.token })).status, 200);
assert.equal((await call('GET', '/explorer', { key: laptop.token })).status, 401, 'a signed-out session no longer works');
assert.equal((await call('GET', '/explorer', { key: nani.token })).status, 200, 'other devices stay signed in');
clock += 366 * 24 * 3600 * 1000;
assert.equal((await call('GET', '/explorer', { key: nani.token })).status, 401, 'sessions end after a year');
clock = Date.parse('2026-11-01T12:00:00Z');

// Saves made before accounts (a private browser key) still work, and move into an account on sign-in.
const legacyKey = newKey();
assert.equal((await call('PUT', '/explorer', { key: legacyKey, body: { rev: 0, data: explorer('Old save', 7) } })).status, 200, 'the current site keeps saving until it updates');
const bea = await (await call('POST', '/account', { body: { name: 'Bea', pin: '7310' } })).json();
r = await call('POST', '/claim', { key: bea.token, body: { key: legacyKey } });
assert.deepEqual(await r.json(), { moved: true });
assert.equal((await (await call('GET', '/explorer', { key: bea.token })).json()).data.name, 'Old save', 'the old save is now the account’s');
assert.equal((await call('GET', '/explorer', { key: legacyKey })).status, 404, 'and no longer under the browser key');
const legacy2 = newKey();
await call('PUT', '/explorer', { key: legacy2, body: { rev: 0, data: explorer('Another', 2) } });
assert.equal((await call('POST', '/claim', { key: bea.token, body: { key: legacy2 } })).status, 409, 'an account’s own save is never replaced by a claim');
assert.equal((await call('POST', '/claim', { key: legacy2, body: { key: legacy2 } })).status, 401, 'claiming needs an account');
let legacy4;
{
  // Replace: the browser's older explorer becomes the account's, the account's current save is kept as the earlier one.
  const dana = await (await call('POST', '/account', { body: { name: 'Dana', pin: '1357' } })).json();
  await call('PUT', '/explorer', { key: dana.token, body: { rev: 0, data: explorer('Dana now', 6) } });
  const legacy5 = newKey();
  await call('PUT', '/explorer', { key: legacy5, body: { rev: 0, data: explorer('Dana older', 2) } });
  clock += 2500;
  r = await call('POST', '/claim', { key: dana.token, body: { key: legacy5, replace: true } });
  const rep = await r.json();
  assert.deepEqual([r.status, rep.replaced, rep.rev], [200, true, 2]);
  const now1 = await (await call('GET', '/explorer', { key: dana.token })).json();
  assert.equal(now1.data.name, 'Dana older', 'the browser’s save is now the account’s');
  assert.equal((await (await call('GET', '/explorer?previous=1', { key: dana.token })).json()).data.name, 'Dana now', 'and the account’s save is kept as the earlier one');
  assert.equal((await call('GET', '/explorer', { key: legacy5 })).status, 404, 'the browser key no longer holds a save');
  assert.equal((await call('POST', '/claim', { key: dana.token, body: { key: legacy5, replace: true } })).status, 409, 'replacing with nothing left changes nothing');
  assert.equal((await (await call('GET', '/explorer', { key: dana.token })).json()).data.name, 'Dana older');
  assert.equal((await call('POST', '/claim', { key: legacy5, body: { key: legacy5, replace: true } })).status, 401, 'replace needs an account');
  // Replace on an account with no save just moves.
  const cy = await (await call('POST', '/account', { body: { name: 'Cyra', pin: '2468' } })).json();
  const legacy3 = newKey();
  await call('PUT', '/explorer', { key: legacy3, body: { rev: 0, data: explorer('Third', 3) } });
  assert.deepEqual(await (await call('POST', '/claim', { key: cy.token, body: { key: legacy3, replace: true } })).json(), { moved: true });
  // Keeping it for later: a plain claim that conflicts leaves the browser's save where it is.
  legacy4 = newKey();
  await call('PUT', '/explorer', { key: legacy4, body: { rev: 0, data: explorer('Fourth', 4) } });
  assert.equal((await call('POST', '/claim', { key: cy.token, body: { key: legacy4 } })).status, 409);
  assert.equal((await (await call('GET', '/explorer', { key: legacy4 })).json()).data.name, 'Fourth', 'the browser’s save is untouched by a conflict');
  assert.equal((await (await call('GET', '/explorer', { key: cy.token })).json()).data.name, 'Third');
  // The swap is one batch: if it fails, neither save changes.
  broken = true;
  clock += 2500;
  assert.equal((await call('POST', '/claim', { key: cy.token, body: { key: legacy4, replace: true } })).status, 503);
  broken = false;
  assert.equal((await (await call('GET', '/explorer', { key: cy.token })).json()).data.name, 'Third', 'a failed replace changes nothing');
  assert.equal((await (await call('GET', '/explorer', { key: legacy4 })).json()).data.name, 'Fourth');
}

// Recovery codes: one-time, counted like PINs, ending old sessions.
const recoverCodes = [];
{
  assert.match(nani.code, CODE_RE);
  assert.equal(nani.recovery, true);
  assert.notEqual(nani.code, (await (await call('POST', '/account', { body: { name: 'Codey', pin: '1212' } })).json()).code, 'every account has its own code');
  const eli = await (await call('POST', '/account', { body: { name: 'Eli', pin: '1122' } })).json();
  recoverCodes.push(eli.code);
  assert.match(eli.code, CODE_RE);
  await call('PUT', '/explorer', { key: eli.token, body: { rev: 0, data: explorer('Eli', 2) } });
  const rec = (name, code, newPin = '3344') => call('POST', '/recover', { body: { name, code, newPin } });
  assert.equal((await call('POST', '/recover', { raw: 'null' })).status, 400, 'a null body is refused');
  assert.equal((await rec('Eli', eli.code, '12')).status, 400, 'the new PIN must be 4 digits');
  r = await rec('Eli', 'AAAA-AAAA-AAAA');
  assert.deepEqual([r.status, (await r.json()).left], [401, undefined], 'a wrong code is refused without counting against the name');
  assert.equal((await rec('Eli', 'not a code')).status, 401, 'a malformed code looks like a wrong one');
  assert.equal((await rec('Nobody Here', eli.code)).status, 401, 'an unknown name looks the same');
  clock += 2500;
  r = await rec('eli', eli.code.toLowerCase().replace(/-/g, ''), '3344');
  assert.equal(r.status, 200, 'the code works in lower case and without dashes');
  const back = await r.json();
  recoverCodes.push(back.code);
  assert.match(back.code, CODE_RE);
  assert.notEqual(back.code, eli.code, 'recovering issues a new code');
  assert.equal((await call('GET', '/explorer', { key: eli.token })).status, 401, 'the old sessions are ended');
  assert.equal((await (await call('GET', '/explorer', { key: back.token })).json()).data.name, 'Eli', 'the new session has the explorer');
  assert.equal((await call('POST', '/login', { body: { name: 'Eli', pin: '1122' } })).status, 401, 'the old PIN is gone');
  assert.equal((await call('POST', '/login', { body: { name: 'Eli', pin: '3344' } })).status, 200, 'the new PIN works');
  assert.equal((await rec('Eli', eli.code)).status, 401, 'the old code works once only');
  // Nobody can lock an owner out on purpose: wrong codes never pause the name or its PIN...
  const burst2 = await Promise.all(Array.from({ length: 60 }, (_, i) => rec('Eli', `DDDD-DDDD-${String(2000 + i).replace(/[01]/g, '2')}`.slice(0, 14)).then((x) => x.status)));
  assert.ok(burst2.every((s) => s === 401), 'wrong codes are refused, and never pause the name');
  assert.equal((await call('POST', '/login', { body: { name: 'Eli', pin: '3344' } })).status, 200, 'the right PIN still works after wrong codes');
  // ...and a pause from wrong PINs doesn't stop the right code, which lifts the pause.
  for (let i = 0; i < 15; i++) await call('POST', '/login', { body: { name: 'Eli', pin: '0001' } });
  assert.equal((await call('POST', '/login', { body: { name: 'Eli', pin: '3344' } })).status, 423, 'wrong PINs pause sign-in, even with the right PIN');
  assert.equal((await rec('Eli', 'CCCC-CCCC-CCCC')).status, 401, 'a wrong code is still refused during the pause');
  clock += 2500;
  r = await rec('Eli', back.code, '5566');
  assert.equal(r.status, 200, 'the right code works while sign-in is paused');
  const third = await r.json();
  recoverCodes.push(third.code);
  assert.equal((await call('POST', '/login', { body: { name: 'Eli', pin: '5566' } })).status, 200, 'and recovering lifts the pause');
  // "Get a recovery code" for a signed-in account: needs a session, replaces the old code.
  assert.equal((await call('POST', '/recovery')).status, 401, 'needs an account');
  assert.equal((await call('POST', '/recovery', { key: newKey() })).status, 401, 'a made-up session is refused');
  r = await call('POST', '/recovery', { key: third.token });
  const fresh = await r.json();
  recoverCodes.push(fresh.code);
  assert.match(fresh.code, CODE_RE);
  assert.equal((await rec('Eli', third.code)).status, 401, 'the code it replaced stops working');
  assert.equal((await rec('Eli', fresh.code, '7788')).status, 200);
  assert.equal((await call('POST', '/login', { body: { name: 'Eli', pin: '7788' } })).status, 200);
}
{
  // A database made before recovery codes: its accounts table has no rec_hash. It keeps working, and the
  // column is added the first time something needs it.
  const old = new DatabaseSync(':memory:');
  const oldEnv = { DB: fakeD1(old), PIN_PEPPER: env.PIN_PEPPER };
  const oc = (method, p, o = {}) => call(method, p, { ...o, e: oldEnv });
  const mem = await (await oc('POST', '/account', { body: { name: 'Old Timer', pin: '4321' } })).json();
  old.exec('ALTER TABLE accounts DROP COLUMN rec_hash');
  const cols = () => old.prepare("SELECT name FROM pragma_table_info('accounts')").all().map((c) => c.name);
  assert.ok(!cols().includes('rec_hash'));
  clock += 2500;
  assert.equal((await oc('PUT', '/explorer', { key: mem.token, body: { rev: 0, data: explorer('Timer', 3) } })).status, 200, 'saving works on the old table');
  assert.ok(!cols().includes('rec_hash'), 'and does not touch the new column');
  r = await oc('POST', '/recover', { body: { name: 'Old Timer', code: 'ABCD-EFGH-JKMN', newPin: '1111' } });
  assert.equal(r.status, 401, 'an old account has no code to recover with');
  assert.ok(cols().includes('rec_hash'), 'the column was added when needed');
  assert.equal((await (await oc('POST', '/login', { body: { name: 'Old Timer', pin: '4321' } })).json()).recovery, false, 'sign-in says there is no code yet');
  const got = await (await oc('POST', '/recovery', { key: mem.token })).json();
  assert.match(got.code, CODE_RE);
  r = await oc('POST', '/recover', { body: { name: 'Old Timer', code: got.code, newPin: '2222' } });
  assert.equal(r.status, 200);
  assert.equal((await (await oc('POST', '/login', { body: { name: 'Old Timer', pin: '2222' } })).json()).recovery, true);
  // Two instances adding the column at once is fine.
  const old2 = new DatabaseSync(':memory:');
  const env2 = { DB: fakeD1(old2), PIN_PEPPER: env.PIN_PEPPER };
  await call('POST', '/account', { body: { name: 'Racer', pin: '4321' }, e: env2 });
  old2.exec('ALTER TABLE accounts DROP COLUMN rec_hash');
  const both = await Promise.all([1, 2, 3].map(() => call('POST', '/recover', { body: { name: 'Racer', code: 'ABCD-EFGH-JKMN', newPin: '1111' }, e: env2 }).then((x) => x.status)));
  assert.deepEqual(both, [401, 401, 401], 'racing migrations don’t break anything');
}

// What's stored: no PINs, no tokens, no keys, no recovery codes.
const dump = JSON.stringify([...sqlite.prepare('SELECT * FROM accounts').all(), ...sqlite.prepare('SELECT * FROM sessions').all(), ...sqlite.prepare('SELECT id FROM explorers').all()]);
for (const secret of [nani.token, laptop.token, bea.token, legacyKey, legacy2, env.PIN_PEPPER, nani.code, ...recoverCodes, ...recoverCodes.map((c) => c.replace(/-/g, ''))]) assert.ok(!dump.includes(secret), 'nothing secret is stored');
// A 4-digit PIN can turn up inside a random hash, salt or timestamp by chance, so look for PINs outside those.
const plain = dump.replace(/[a-f0-9]{16,}/g, '').replace(/\d{10,}/g, '');
for (const pin of ['4826', '7310']) assert.ok(!plain.includes(pin), 'no PIN is stored');
assert.ok(dump.includes(sha(legacy4)), 'browser keys only as their SHA-256');

broken = true;
clock += 2500;
r = await call('PUT', '/explorer', { key: bea.token, body: { rev: 1, data: explorer('Old save', 8) } });
assert.equal(r.status, 503);
assert.match((await r.json()).message, /free daily limit/);
broken = false;
assert.equal((await (await call('GET', '/explorer', { key: bea.token })).json()).data.level, 7, 'a failed write keeps the last good save');
let busy = 0;
for (let i = 0; i < 45; i++) if ((await call('GET', '/explorer', { key: bea.token, ip: '203.0.113.9' })).status === 429) busy++;
assert.ok(busy > 0 && busy <= 5, 'one network address is limited per minute');
busy = 0;
for (let i = 0; i < 15; i++) if ((await call('POST', '/login', { body: { name: 'Someone', pin: '1234' }, ip: '203.0.113.77' })).status === 429) busy++;
assert.ok(busy > 0, 'sign-ins from one address are limited more tightly');
Date.now = realNow;

/* ---------------- 2. the game's save client ---------------- */

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { default: CONFIG } = await import('../js/config.js');
const cloud = await import('../games/island-cloud.js');
CONFIG.islandSaves = '';
await assert.rejects(cloud.signIn('Nobody', '1234'), (e) => e.code === 'setup', 'not set up yet');
CONFIG.islandSaves = 'https://saves.test/';
const clientDb = new DatabaseSync(':memory:');
const clientEnv = { DB: fakeD1(clientDb), PIN_PEPPER: 'client-pepper' };
let mode = 'worker';
globalThis.fetch = async (url, init) => {
  if (mode === 'down') throw new TypeError('fetch failed');
  if (mode === 'cloudflare-page') return new Response('<html>Error 1027</html>', { status: 429, headers: { 'content-type': 'text/html' } });
  return worker.fetch(new Request(url, init), clientEnv);
};
assert.equal(cloud.account(), null, 'not signed in at first');
assert.equal(cloud.explorerTag(), '', 'no account, no tag');
await assert.rejects(cloud.loadExplorer(), (e) => e.code === 'signin', 'cloud saves need an account');
// A save from before accounts, made in this browser with the old key.
const oldKey = newKey();
store.set('island-explorer-key', oldKey);
await worker.fetch(new Request('https://saves.test/explorer', { method: 'PUT', headers: { authorization: 'Bearer ' + oldKey, 'content-type': 'application/json' }, body: JSON.stringify({ rev: 0, data: explorer('Bo', 2) }) }), clientEnv);
await assert.rejects(cloud.signIn('Bobo', '5555'), (e) => e.code === 'wrong', 'no such account yet');
const signedUp = await cloud.signUp('Bobo', '5555');
assert.equal(signedUp.name, 'Bobo');
assert.match(signedUp.code, CODE_RE, 'a new account gets a recovery code to show once');
assert.equal(cloud.account().name, 'Bobo');
assert.equal(cloud.account().recovery, true);
// Random keys, session tokens and timestamps can contain "5555" by chance, so leave those out of the search.
const kept = JSON.stringify([...store]).replace(/[a-f0-9]{32,}/g, '').replace(/\d{10,}/g, '');
assert.ok(!kept.includes('5555') && !JSON.stringify([...store]).includes(signedUp.code), 'the PIN and the recovery code are never kept on the device');
assert.equal(await cloud.claimLegacy(), true, 'the browser’s old save moves into the account');
assert.equal(store.has('island-explorer-key'), false, 'and the old key is forgotten');
let found = await cloud.loadExplorer();
assert.deepEqual(found.data, explorer('Bo', 2));
await new Promise((res) => setTimeout(res, 2100));
await assert.rejects(cloud.saveExplorer(explorer('Bo', 3), 0), (e) => e.code === 'conflict' && e.rev === 1);
assert.equal((await cloud.saveExplorer(explorer('Bo', 3), 1)).rev, 2);
assert.match(cloud.explorerTag(), /^[a-f0-9]{32}$/);
{
  // A browser save and an account that already has one: the key stays, and the player chooses.
  const k2 = newKey();
  store.set('island-explorer-key', k2);
  await worker.fetch(new Request('https://saves.test/explorer', { method: 'PUT', headers: { authorization: 'Bearer ' + k2, 'content-type': 'application/json' }, body: JSON.stringify({ rev: 0, data: explorer('Browser one', 1) }) }), clientEnv);
  const c = await cloud.claimLegacy();
  assert.equal(c.conflict?.theirs?.data.name, 'Bo', 'the conflict shows the account’s save');
  assert.equal(c.conflict?.old?.data.name, 'Browser one', 'and the browser’s');
  assert.equal(store.get('island-explorer-key'), k2, 'and the browser’s key is kept');
  assert.equal(cloud.hasLegacy(), true);
  assert.ok((await cloud.claimLegacy()).conflict, 'still a conflict next time (keep it for later)');
  const rep = await cloud.replaceWithLegacy();
  assert.equal(rep.replaced, true);
  assert.equal(store.has('island-explorer-key'), false, 'replacing uses the key up');
  assert.equal((await cloud.loadExplorer()).data.name, 'Browser one');
  // Discard is the only way to drop the key without moving it.
  const k3 = newKey();
  store.set('island-explorer-key', k3);
  await worker.fetch(new Request('https://saves.test/explorer', { method: 'PUT', headers: { authorization: 'Bearer ' + k3, 'content-type': 'application/json' }, body: JSON.stringify({ rev: 0, data: explorer('Browser two', 1) }) }), clientEnv);
  assert.ok((await cloud.claimLegacy()).conflict && store.get('island-explorer-key') === k3);
  cloud.discardLegacy();
  assert.equal(cloud.hasLegacy(), false);
  assert.equal(await cloud.claimLegacy(), false, 'nothing left to claim');
}
await cloud.signOut();
assert.equal(cloud.account(), null, 'signed out');
await assert.rejects(cloud.loadExplorer(), (e) => e.code === 'signin');
await cloud.signIn('bobo', '5555');
assert.equal((await cloud.loadExplorer()).rev, 3, 'signing in again brings the explorer back');
await assert.rejects(cloud.signIn('Bobo', '0000'), (e) => e.code === 'wrong' && e.left === 4);
{
  // Forgot the PIN: the recovery code sets a new one, signs in, and gives a fresh code.
  await cloud.signOut();
  const rc = await cloud.recover('BOBO', signedUp.code, '6666');
  assert.deepEqual([rc.name, cloud.account().name, cloud.account().recovery], ['Bobo', 'Bobo', true]);
  assert.match(rc.code, CODE_RE);
  assert.notEqual(rc.code, signedUp.code);
  assert.equal((await cloud.loadExplorer()).rev, 3, 'recovering brings the explorer back');
  await assert.rejects(cloud.signIn('Bobo', '5555'), (e) => e.code === 'wrong', 'the old PIN is gone');
  await assert.rejects(cloud.recover('Bobo', signedUp.code, '7777'), (e) => e.code === 'wrong', 'a code works once');
  await assert.rejects(cloud.recover('Bobo', 'AAAA-AAAA-AAAA', '7777'), (e) => e.code === 'wrong' && e.left === undefined, 'a wrong code is refused without a countdown, since it never pauses the name');
  await cloud.signIn('Bobo', '6666');
  const fresh = await cloud.getRecoveryCode();
  assert.match(fresh, CODE_RE);
  await cloud.signOut();
  await assert.rejects(cloud.recover('Bobo', rc.code, '8888'), (e) => e.code === 'wrong', '"Get a recovery code" replaces the old code');
  assert.equal((await cloud.recover('Bobo', fresh, '8888')).name, 'Bobo');
  await assert.rejects(cloud.getRecoveryCode().then(() => cloud.signOut()).then(() => cloud.getRecoveryCode()), (e) => e.code === 'signin', 'a new code needs a session');
  await cloud.signIn('Bobo', '8888');
}
mode = 'down';
await assert.rejects(cloud.saveExplorer(explorer('Bo', 4), 2), (e) => e.code === 'network' && /Check your connection/.test(e.message) && !/file/i.test(e.message), 'a failed save explains itself and offers no file');
mode = 'cloudflare-page';
await assert.rejects(cloud.loadExplorer(), (e) => e.code === 'unavailable' && /daily limit/.test(e.message));
mode = 'worker';
assert.equal((await cloud.loadExplorer()).rev, 3, 'failed attempts changed nothing');

/* ---------------- 3. the deploy script ---------------- */

const TOKEN = 'test-token-' + crypto.randomBytes(6).toString('hex');
const cf = await fakeCloudflare(TOKEN);
const cfState = cf.state;
// Where the deployed Worker would answer: the real Worker on another SQLite database, with the secret it was given.
const liveDb = new DatabaseSync(':memory:');
const live = await fakeWorkerHost(worker, () => ({ DB: fakeD1(liveDb), PIN_PEPPER: cfState.secrets['island-saves']?.PIN_PEPPER }));
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
assert.deepEqual(up.metadata.keep_bindings, ['secret_text'], 'keeps secrets already on the Worker');
assert.equal(up.script, fs.readFileSync(path.join(root, 'server/island-saves.js'), 'utf8'), 'uploads the Worker as it is');
assert.equal(up.type, 'application/javascript+module');
const pepper = cfState.secrets['island-saves']?.PIN_PEPPER;
assert.ok(pepper && pepper.length >= 32, 'sets a long random PIN secret');
assert.ok(!run.out.includes(pepper), 'and never prints it');
assert.equal(cfState.subdomain, 'test-games', 'creates the workers.dev subdomain when the account has none');
assert.deepEqual(cfState.enabled['island-saves'], { enabled: true, previews_enabled: false });
assert.match(fs.readFileSync(configCopy, 'utf8'), new RegExp(`islandSaves: '${liveBase}'`), 'writes the address into config.js');
assert.match(run.out, /it works/, 'and checks accounts and the database end to end');
assert.ok(liveDb.prepare("SELECT name FROM sqlite_master WHERE name = 'accounts'").get(), 'the check created the tables');

const before = cfState.requests.length;
run = await deploy('--check-url', liveBase);
assert.equal(run.code, 0, run.out);
const again = cfState.requests.slice(before);
assert.ok(!again.some((q) => q.method === 'POST' && q.path === '/accounts/acc1/d1/database'), 'a second run reuses the database');
assert.ok(!again.some((q) => q.method === 'PUT' && q.path.endsWith('/workers/subdomain')), 'and the subdomain');
assert.equal(cfState.secrets['island-saves'].PIN_PEPPER, pepper, 'and keeps the PIN secret, so every PIN still works');
assert.equal(cfState.uploads.length, 2, 'and updates the same Worker');

assert.equal((await deploy('--check')).code, 0, '--check confirms the address in config.js');

cfState.dbs = [];
cfState.deny = '/accounts/acc1/d1';
run = await deploy('--check-url', liveBase);
assert.equal(run.code, 1);
assert.match(run.out, /D1 · Edit/, 'a token without D1 rights is told which permission to add');
assert.ok(!run.out.includes(TOKEN));

cf.close(); live.close();

// Remembering the token (the setup scripts offer it after you paste one): kept encrypted on Windows,
// readable only by this user elsewhere; forgetting empties it. Tried in a temporary folder.
process.env.GAMENIGHT_TOKEN_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-token-'));
const cfHelper = await import('./cloudflare.mjs');
const dummy = 'dummy-' + crypto.randomBytes(8).toString('hex');
const tokenFile = cfHelper.rememberToken(dummy);
assert.equal(cfHelper.rememberedToken(), dummy, 'a remembered token reads back');
if (process.platform === 'win32') assert.ok(!fs.readFileSync(tokenFile, 'utf8').includes(dummy), 'and on Windows it is stored encrypted');
cfHelper.forgetToken();
assert.equal(cfHelper.rememberedToken(), '', 'forgetting it leaves nothing to read');
// The copy of config.js stays in the system temp folder (a few hundred bytes).
console.log('Island save checks passed: explorer accounts (name rules, unique names, sessions per device, sign-out, a year’s session), wrong-PIN pauses that hold under 60 guesses at once, saves from before accounts and moving them in, only fingerprints stored, revisions, conflicts, size and rate limits, failed writes keep the last save; game save client (sign up, sign in and out, the PIN never kept, errors); deploy script (creates, reuses, binds, PIN secret set once and kept, writes config, explains missing permissions, remembers the token only if asked).');
