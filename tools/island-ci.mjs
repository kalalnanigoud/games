// Creature Island in real browsers: four explorers over real PeerJS/WebRTC (a local broker, no internet),
// one of them on a phone-sized touch screen. Everyone moves at once and every screen agrees with the host;
// a fifth person watches until a seat frees; a reload gets the same explorer back; a cloud save goes
// through the real save Worker (on a local database); the leave prompt guards unsaved progress.
//   node tools/island-ci.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright';
import worker from '../server/island-saves.js';
import { fakeD1 } from './fake-d1.mjs';
const require = createRequire(import.meta.url);
const { createServer } = require('../serve.js');
const root = fileURLToPath(new URL('../', import.meta.url));
const server = createServer(root);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const broker = fork(fileURLToPath(new URL('./peer-test-server.mjs', import.meta.url)), [], { cwd: root, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
const brokerPort = await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(Error('broker did not start')), 20000);
  broker.once('message', (m) => { clearTimeout(t); resolve(m.port); });
});
const out = new URL('../test-results/', import.meta.url);
await fs.mkdir(out, { recursive: true });
const peerSource = await fs.readFile(new URL('../node_modules/peerjs/dist/peerjs.min.js', import.meta.url), 'utf8');
const localPeer = peerSource + `\n;{const Original=globalThis.Peer;globalThis.Peer=class extends Original{constructor(id,opts){if(id&&typeof id==='object'){opts=id;id=undefined;}super(id,{...opts,host:'127.0.0.1',port:${brokerPort},path:'/',secure:false,config:{iceServers:[]}});}};}`;

// The save service: the real Worker on an in-memory SQLite database dressed as Cloudflare D1.
const db = new DatabaseSync(':memory:');
const D1 = fakeD1(db);
const CONFIG = (await fs.readFile(new URL('../js/config.js', import.meta.url), 'utf8'));
const saveUrl = /islandSaves:\s*'([^']+)'/.exec(CONFIG)?.[1] || 'https://island-saves.test';

const errors = [], contexts = [];
let browser;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(page, fn, arg, timeout = 20000) {
  const end = Date.now() + timeout;
  do { if (await page.evaluate(fn, arg).catch(() => false)) return; await wait(120); } while (Date.now() < end);
  throw Error('Timed out: ' + fn.toString().slice(0, 160));
}
async function open(opts = {}) {
  const context = await browser.newContext(opts);
  contexts.push(context);
  await context.route(/https:\/\/(unpkg\.com|cdn\.jsdelivr\.net)\/.*peerjs.*\.js/, (r) => r.fulfill({ contentType: 'text/javascript', body: localPeer }));
  await context.route(/https:\/\/fonts\./, (r) => r.abort());
  await context.route(saveUrl.replace(/\/+$/, '') + '/**', async (route) => {
    const req = route.request();
    const res = await worker.fetch(new Request(req.url(), { method: req.method(), headers: req.headers(), body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method()) ? undefined : req.postData() }), { DB: D1 });
    route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) });
  });
  await context.addInitScript(() => localStorage.setItem('gn-help-island', '1'));
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(base);
  return page;
}
const S = (page) => page.evaluate(async () => { const { S } = await import('/js/state.js'); return { token: S.token, code: S.code, players: S.players, started: S.started, status: S.status }; });
const islandReady = (page) => waitFor(page, async () => { const m = await import('/games/island.js'); return !!m.debug.client?.state.ready; });
const pick = async (page) => {
  await page.waitForSelector('.isl-pick [data-pick="new"]');
  await page.click('.isl-pick [data-pick="new"]');
  await islandReady(page);
};

try {
  // Four players share one browser here: keep pages that aren't in front animating at full speed.
  browser = await chromium.launch({ args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
  const host = await open({ viewport: { width: 1280, height: 760 } });
  const phone = await open({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const g2 = await open({ viewport: { width: 1024, height: 700 } });
  const g3 = await open({ viewport: { width: 1024, height: 700 } });
  await host.fill('#nameIn', 'Host'); await host.click('[data-host="island"]');
  await waitFor(host, async () => (await import('/js/state.js')).S.status === 'online');
  const code = (await S(host)).code;
  for (const [p, name] of [[phone, 'Phone'], [g2, 'Bea'], [g3, 'Cy']]) { await p.fill('#nameIn', name); await p.fill('#codeIn', code); await p.click('#joinBtn'); }
  await waitFor(host, async () => (await import('/js/state.js')).S.players.length === 4);
  await host.click('#startBtn');
  await Promise.all([host, phone, g2, g3].map(pick));
  const hw = () => host.evaluate(async () => { const { debug } = await import('/games/island.js'); return [...debug.world.players.values()].map((p) => ({ id: p.id, ready: p.ready, x: p.body.x, y: p.body.y, seat: p.seat })); });
  let players = await hw();
  assert.equal(players.length, 4);
  assert.ok(players.every((p) => p.ready), 'four explorers are on the island');
  assert.deepEqual(players.map((p) => p.seat).sort(), [0, 1, 2, 3], 'each has their own colour');
  console.log('PASS four explorers join one island');

  // Everyone moves at the same time, in different directions.
  const before = Object.fromEntries(players.map((p) => [p.id, p]));
  const ids = Object.fromEntries(await Promise.all([['host', host], ['phone', phone], ['g2', g2], ['g3', g3]].map(async ([k, p]) => [k, (await S(p)).token])));
  const hold = async (page, key, ms) => { await page.keyboard.down(key); await wait(ms); await page.keyboard.up(key); };
  const box = await phone.locator('.isl-stickzone').boundingBox();
  await Promise.all([
    hold(host, 'KeyD', 1400), hold(g2, 'KeyA', 1400), hold(g3, 'KeyW', 1400),
    (async () => { // the phone uses the on-screen stick
      const x = box.x + box.width * 0.4, y = box.y + box.height * 0.6;
      await phone.mouse.move(x, y); await phone.mouse.down(); await phone.mouse.move(x, y + 60, { steps: 4 }); await wait(1400); await phone.mouse.up();
    })(),
  ]);
  await wait(700);
  players = await hw();
  const moved = (k) => { const p = players.find((q) => q.id === ids[k]), b = before[ids[k]]; return [p.x - b.x, p.y - b.y]; };
  assert.ok(moved('host')[0] > 80, `host moved right ${moved('host')}`);
  assert.ok(moved('g2')[0] < -80, `Bea moved left ${moved('g2')}`);
  assert.ok(moved('g3')[1] < -80, `Cy moved up ${moved('g3')}`);
  assert.ok(moved('phone')[1] > 60, `the phone player moved down with the stick ${moved('phone')}`);
  // Each screen's own explorer agrees with the host, and each sees the others where the host has them.
  for (const [k, page] of [['phone', phone], ['g2', g2], ['g3', g3]]) {
    const mine = await page.evaluate(async () => { const { debug } = await import('/games/island.js'); const b = debug.client.state.body; return { x: b.x, y: b.y }; });
    const truth = players.find((q) => q.id === ids[k]);
    assert.ok(Math.hypot(mine.x - truth.x, mine.y - truth.y) < 24, `${k}: own position matches the host (${Math.round(mine.x - truth.x)}, ${Math.round(mine.y - truth.y)})`);
  }
  const seen = await g2.evaluate(async (hostId) => { const { debug } = await import('/games/island.js'); const f = debug.client.state.frames.at(-1); const e = f && f.ents.get('p' + hostId); return e ? [e[2], e[3]] : null; }, ids.host);
  const hostNow = players.find((q) => q.id === ids.host);
  assert.ok(seen && Math.hypot(seen[0] - hostNow.x, seen[1] - hostNow.y) < 40, 'others see the host where the host is');
  console.log('PASS four players move at once (keyboard and touch stick) and every screen agrees');

  // A fifth person watches; there's no fifth explorer.
  const fifth = await open({ viewport: { width: 800, height: 600 } });
  await fifth.fill('#nameIn', 'Dee'); await fifth.fill('#codeIn', code); await fifth.click('#joinBtn');
  await waitFor(fifth, async () => { const { S } = await import('/js/state.js'); return S.synced && S.started; });
  const fifthState = await S(fifth);
  assert.equal(fifthState.players.find((p) => p.id === fifthState.token)?.watch, true, 'the fifth person watches');
  assert.equal((await hw()).length, 4, 'and gets no explorer');
  await fifth.waitForSelector('.isl-overlay .isl-card:has-text("Watching")');
  console.log('PASS a fifth person watches instead of silently taking a seat');

  // A reload (a dropped connection) gets the same explorer back, not a new one.
  const bea = players.find((q) => q.id === ids.g2);
  await g2.reload();
  await waitFor(g2, async () => { const { S } = await import('/js/state.js'); return S.synced && S.started; }, null, 45000);
  await islandReady(g2);
  assert.equal(await g2.locator('.isl-pick').count(), 0, 'no explorer picker after reconnecting');
  const back = (await hw()).find((q) => q.id === ids.g2);
  assert.ok(Math.hypot(back.x - bea.x, back.y - bea.y) < 40, 'the explorer is where it was');
  console.log('PASS reconnecting returns the same explorer');

  // Saving to the cloud through the menu, only when asked.
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='explorers'").get() ? db.prepare('SELECT COUNT(*) AS n FROM explorers').get().n : 0, 0, 'nothing is saved until someone asks');
  await phone.click('.isl-bagbtn');
  await phone.click('.isl-tabs [data-tab="save"]');
  await phone.click('[data-save="cloud"]');
  await waitFor(phone, async () => { const { debug } = await import('/games/island.js'); return debug.client.state.me && !debug.client.state.me.unsaved; });
  const row = db.prepare('SELECT rev, data FROM explorers').get();
  assert.equal(row.rev, 1);
  assert.equal(JSON.parse(row.data).name, 'Phone');
  console.log('PASS Save adventure stores the explorer in the save service');

  // Leaving with unsaved progress asks first; Cancel keeps you on the island.
  await g3.evaluate(async () => { (await import('/js/net.js')).leave(); });
  await g3.waitForSelector('.isl-overlay:has-text("Save before you go?")');
  await g3.click('[data-leave="cancel"]');
  assert.ok((await S(g3)).started, 'Cancel keeps playing');
  await g3.evaluate(async () => { (await import('/js/net.js')).leave(); });
  await g3.click('[data-leave="go"]');
  await waitFor(host, async () => { const { debug } = await import('/games/island.js'); return debug.world.players.size === 3; });
  console.log('PASS the leave prompt guards unsaved progress, and leaving frees the seat');
  await fifth.waitForSelector('[data-seat]');
  await fifth.click('[data-seat]');
  await fifth.waitForSelector('.isl-pick [data-pick="new"]');
  await pick(fifth);
  assert.equal((await hw()).length, 4, 'the watcher took the free seat');
  console.log('PASS a watcher takes a freed seat mid-adventure');

  // Phone layout: the world fills the screen, nothing scrolls sideways.
  assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scrolling on the phone');
  const sizes = await phone.evaluate(() => { const r = document.querySelector('.isl-root').getBoundingClientRect(); return { w: r.width, h: r.height, bottom: r.bottom, vw: innerWidth, vh: innerHeight }; });
  assert.ok(sizes.w >= sizes.vw - 1 && sizes.bottom <= sizes.vh + 1 && sizes.h > sizes.vh * 0.75, `the island fills the phone screen ${JSON.stringify(sizes)}`);
  await phone.click('.isl-panel [data-panel="close"]').catch(() => {});
  await wait(400);
  await phone.screenshot({ path: fileURLToPath(new URL('island-phone.png', out)) });
  await host.screenshot({ path: fileURLToPath(new URL('island-desktop.png', out)) });
  assert.deepEqual(errors, [], 'no browser errors');
  console.log('PASS phone layout fills the screen with no sideways scrolling; no browser errors');
} catch (e) {
  console.error(e);
  console.error('Browser errors:', errors.slice(0, 8));
  process.exitCode = 1;
  for (const [i, c] of contexts.entries()) for (const p of c.pages()) await p.screenshot({ path: fileURLToPath(new URL(`island-failure-${i}.png`, out)) }).catch(() => {});
} finally {
  await browser?.close(); broker.kill(); server.close();
}
