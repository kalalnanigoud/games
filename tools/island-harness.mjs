// Shared set-up for the Creature Island fault and performance checks: the site on a local server, a local
// PeerJS broker (no internet), and the real save Worker on an in-memory database. env.fault changes how the
// save service behaves: 'ok', 'slow' (delay env.delay ms), 'fail' (HTTP 500 on saves) or 'drop' (connection reset).
import fs from 'node:fs/promises';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import worker from '../server/island-saves.js';
import { fakeD1 } from './fake-d1.mjs';
const require = createRequire(import.meta.url);
const { createServer } = require('../serve.js');
export const root = fileURLToPath(new URL('../', import.meta.url));
export const out = new URL('../test-results/', import.meta.url);
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(page, fn, arg, timeout = 20000) {
  const end = Date.now() + timeout;
  do { if (await page.evaluate(fn, arg).catch(() => false)) return; await wait(120); } while (Date.now() < end);
  throw Error('Timed out: ' + fn.toString().slice(0, 160));
}

export async function startEnv({ withBroker = false } = {}) {
  const server = createServer(root);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  await fs.mkdir(out, { recursive: true });
  let broker = null, localPeer = '';
  if (withBroker) {
    broker = fork(fileURLToPath(new URL('./peer-test-server.mjs', import.meta.url)), [], { cwd: root, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    const port = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(Error('broker did not start')), 20000);
      broker.once('message', (m) => { clearTimeout(t); resolve(m.port); });
    });
    const src = await fs.readFile(new URL('../node_modules/peerjs/dist/peerjs.min.js', import.meta.url), 'utf8');
    localPeer = src + `\n;{const Original=globalThis.Peer;globalThis.Peer=class extends Original{constructor(id,opts){if(id&&typeof id==='object'){opts=id;id=undefined;}super(id,{...opts,host:'127.0.0.1',port:${port},path:'/',secure:false,config:{iceServers:[]}});}};}`;
  }
  const db = new DatabaseSync(':memory:');
  const D1 = fakeD1(db);
  const CONFIG = await fs.readFile(new URL('../js/config.js', import.meta.url), 'utf8');
  const saveUrl = (/islandSaves:\s*'([^']+)'/.exec(CONFIG)?.[1] || 'https://island-saves.test').replace(/\/+$/, '');
  const env = { base, db, saveUrl, fault: 'ok', delay: 0, saves: 0, errors: [], contexts: [], browsers: [] };
  const isRead = (m) => m === 'GET' || m === 'HEAD' || m === 'OPTIONS';
  // A new browser context wired to the local servers; page errors are collected into env.errors.
  env.open = async (browser, opts = {}, init) => {
    const context = await browser.newContext(opts);
    env.contexts.push(context);
    if (localPeer) await context.route(/https:\/\/(unpkg\.com|cdn\.jsdelivr\.net)\/.*peerjs.*\.js/, (r) => r.fulfill({ contentType: 'text/javascript', body: localPeer }));
    await context.route(/https:\/\/fonts\./, (r) => r.abort());
    await context.route(saveUrl + '/**', async (route) => {
      const req = route.request(), m = req.method();
      const write = m === 'PUT' && /\/explorer/.test(req.url()); // the save itself, not sign-in
      if (write) env.saves++;
      if (write && env.fault === 'drop') return route.abort('connectionreset');
      if (write && env.fault === 'slow') await wait(env.delay);
      if (write && env.fault === 'fail') return route.fulfill({ status: 500, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"error":"The save service is having trouble."}' });
      const res = await worker.fetch(new Request(req.url(), { method: m, headers: req.headers(), body: isRead(m) ? undefined : req.postData() }), { DB: D1, PIN_PEPPER: 'ci-pepper' });
      route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) });
    });
    await context.addInitScript(() => { localStorage.setItem('gn-help-island', '1'); window.addEventListener('unhandledrejection', (e) => (window.__rej ||= []).push(String(e.reason))); });
    if (init) await context.addInitScript(init);
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', (e) => env.errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|Load failed|status of 500/.test(m.text())) env.errors.push(m.text()); });
    await page.goto(base);
    return page;
  };
  env.close = async () => { for (const b of env.browsers) await b.close().catch(() => {}); broker?.kill(); server.close(); };
  return env;
}

// The start screen's explorer account: create one with a name and a 4-digit PIN.
export async function signUp(page, name, pin) {
  await page.waitForSelector('[data-acct-form]');
  await page.click('[data-acct="mode-create"]');
  await page.fill('[name="acctName"]', name);
  await page.fill('[name="acctPin"]', pin);
  await page.fill('[name="acctPin2"]', pin);
  await page.click('[data-acct-form] button[type="submit"]');
  await page.waitForSelector('.isl-pick .isl-acct.signed');
}
export const islandReady = (page) => waitFor(page, async () => { const m = await import('/games/island.js'); return !!m.debug.client?.state.ready; });
export async function pickNew(page) {
  await page.waitForSelector('.isl-pick [data-pick="new"]');
  await page.click('.isl-pick [data-pick="new"]');
  await islandReady(page);
}
// One explorer alone on this device (the one-device mode), signed in so it can save.
export async function soloIsland(page, name, pin, { account = true } = {}) {
  await page.fill('#nameIn', 'Solo');
  await page.click('[data-local="island"]');
  await page.click('#startBtn');
  if (account) await signUp(page, name, pin);
  await pickNew(page);
}
export const tick = (page) => page.evaluate(async () => (await import('/games/island.js')).debug.world.tick);
export const openSave = async (page) => { await page.click('.isl-bagbtn'); await page.click('.isl-tabs [data-tab="save"]'); };
