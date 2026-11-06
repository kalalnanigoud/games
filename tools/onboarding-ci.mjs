// First-time help and controls in real browsers (Chromium; WebKit for the island practice):
//   - the island practice shows once per device, Skip works, and it can be replayed from the Guide tab,
//   - a remapped key moves the explorer, and a simulated gamepad moves it too,
//   - the touch controls are usable at 360x640 portrait and 640x360 landscape,
//   - the board-game sample shows once per game, and the Sketch Party warm-up can be skipped.
// Automation never sees first-time help unless a test sets localStorage gn-onboard-force (done here).
//   node tools/onboarding-ci.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium, webkit } from 'playwright';
import { selectCases } from './ci-select.mjs';
const selected = selectCases('ONLY', ['practice', 'controls', 'touch', 'sample', 'sketch', 'webkit']);
const only = name => selected.includes(name);
const require = createRequire(import.meta.url);
const { createServer } = require('../serve.js');
const root = fileURLToPath(new URL('../', import.meta.url));
const server = createServer(root);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const out = new URL('../test-results/', import.meta.url);
await fs.mkdir(out, { recursive: true });
const shot = (page, name) => page.screenshot({ path: fileURLToPath(new URL(name + '.png', out)) });
const peerFile = fileURLToPath(new URL('../node_modules/peerjs/dist/peerjs.min.js', import.meta.url));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [], contexts = [];

async function open(browser, opts = {}, prefs = {}) {
  const context = await browser.newContext(opts);
  contexts.push(context);
  await context.route(/https:\/\/(unpkg\.com|cdn\.jsdelivr\.net)\/.*peerjs.*\.js/, (r) => r.fulfill({ contentType: 'text/javascript', path: peerFile }));
  await context.route(/https:\/\/fonts\./, (r) => r.fulfill({ contentType: 'text/css', body: '' }));
  await context.route(/island-saves|workers\.dev/, (r) => r.abort());
  await context.addInitScript((p) => {
    // Once per tab session so a reload keeps what the page itself stored.
    if (!sessionStorage.getItem('ob-init')) { sessionStorage.setItem('ob-init', '1'); for (const [k, v] of Object.entries(p)) if (localStorage.getItem(k) == null) localStorage.setItem(k, v); }
  }, { 'gn-onboard-force': '1', 'gn-help-island': '1', 'gn-name': 'Tester', ...prefs });
  return tab(context);
}
async function tab(context) {
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|peerjs|net::ERR/i.test(m.text())) errors.push(m.text()); });
  await page.goto(base + '/');
  return page;
}
// A fresh tab on the home page (same device storage), with no unfinished game to resume.
const home = async (old) => {
  const context = old.context();
  await old.close();
  const page = await tab(context);
  await page.waitForSelector('[data-local="island"]');
  if (await page.locator('#forgetBtn').count()) { await page.click('#forgetBtn'); await page.waitForSelector('#forgetBtn', { state: 'detached' }); }
  return page;
};
async function startIsland(page) {
  await page.waitForSelector('[data-local="island"]');
  await page.click('[data-local="island"]');
  await page.click('#startBtn');
  await page.waitForSelector('.isl-pick [data-pick="new"]');
}
const islandReady = (page) => page.waitForFunction(async () => !!(await import('/games/island.js')).debug.client?.state.ready);
const body = (page) => page.evaluate(async () => { const b = (await import('/games/island.js')).debug.client.state.body; return { x: b.x, y: b.y }; });
async function playIsland(page, { practice = false } = {}) {
  await startIsland(page);
  await page.click('.isl-pick [data-pick="new"]');
  if (!practice) await islandReady(page);
}
const hold = async (page, key, ms) => { await page.keyboard.down(key); await wait(ms); await page.keyboard.up(key); };

/* ---------------- island practice: once, Skip, replay (Chromium and WebKit) ---------------- */
async function practiceFlow(browser, label) {
  let page = await open(browser, { viewport: { width: 1100, height: 760 } });
  await startIsland(page);
  await page.click('.isl-pick [data-pick="new"]');
  await page.waitForSelector('.isl-practice');
  assert.ok(await page.isVisible('.isl-practice canvas'), `${label}: practice scene is drawn`);
  assert.match(await page.textContent('.isl-pr-say'), /Practice 1 of 4/);
  assert.equal(await page.evaluate(() => localStorage.getItem('gn-ob-island-practice')), '1', `${label}: remembered on this device`);
  // The practice explorer walks with the keys.
  const before = await page.evaluate(() => document.querySelector('.isl-practice')._p.me.x);
  await hold(page, 'KeyD', 500);
  // Software-rendered WebKit runs only a few frames a second; the held time still has to move the explorer.
  await page.waitForFunction((b) => document.querySelector('.isl-practice')._p.me.x > b + 30, before, { timeout: 8000 }).catch(() => {});
  const after = await page.evaluate(() => document.querySelector('.isl-practice')._p.me.x);
  assert.ok(after > before + 30, `${label}: practice explorer walks right (${before} -> ${after})`);
  if (label === 'chromium') await shot(page, 'onboarding-practice-desktop');
  // Walking into the ring moves on to attacking.
  await page.evaluate(() => { const p = document.querySelector('.isl-practice')._p; p.me.x = p.state.ring.x; p.me.y = p.state.ring.y; });
  await page.waitForFunction(() => document.querySelector('.isl-practice')._p.state.step === 1, null, { timeout: 5000 });
  assert.equal(await page.isVisible('.isl-practice'), true);
  await page.click('.isl-practice [data-pr="skip"]');
  await page.waitForSelector('.isl-practice', { state: 'detached' });
  await islandReady(page);
  assert.equal(await page.locator('.isl-practice').count(), 0, `${label}: the adventure starts after Skip`);
  // The world did not see the practice walk: the explorer is where a new explorer starts.
  await page.waitForSelector('.isl-bagbtn', { state: 'visible' });
  // Replay: bag -> Guide -> Replay practice.
  await page.keyboard.press('KeyB');
  await page.click('[data-tab="guide"]');
  await page.click('[data-ctl="practice"]');
  await page.waitForSelector('.isl-practice');
  const b0 = await body(page);
  await hold(page, 'KeyD', 400);
  const b1 = await body(page);
  assert.ok(Math.abs(b1.x - b0.x) < 2, `${label}: the island explorer stays put during practice`);
  await page.click('.isl-practice [data-pr="skip"]');
  await page.waitForSelector('.isl-practice', { state: 'detached' });
  console.log(`PASS ${label}: practice appears, Skip works, replay works`);
  // A second visit on this device (same storage): no practice.
  page = await home(page);
  await startIsland(page);
  await page.click('.isl-pick [data-pick="new"]');
  await islandReady(page);
  assert.equal(await page.locator('.isl-practice').count(), 0, `${label}: practice does not return on this device`);
  console.log(`PASS ${label}: practice shows once per device`);
}

/* ---------------- controls: remap, gamepad ---------------- */
async function controlsFlow(browser) {
  let page = await open(browser, { viewport: { width: 1100, height: 760 } }, { 'gn-ob-island-practice': '1' });
  await playIsland(page);
  await page.keyboard.press('KeyB');
  await page.click('[data-tab="guide"]');
  await page.click('[data-ctl="keys"]');
  await page.waitForSelector('#ctlModal');
  await shot(page, 'onboarding-controls');
  await page.click('.ctl-key[data-a="right"][data-i="0"]');
  await page.keyboard.press('KeyH');
  assert.equal((await page.textContent('.ctl-key[data-a="right"][data-i="0"]')).trim(), 'H', 'the key button shows the new key');
  await page.click('#ctlModal .help-ok');
  await page.waitForSelector('#ctlModal', { state: 'detached' });
  assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('gn-island-keys'))).right[0], 'KeyH', 'a device preference, not a save');
  await page.keyboard.press('Escape');
  await wait(200);
  let a = await body(page);
  await hold(page, 'KeyD', 700);
  let b = await body(page);
  assert.ok(Math.abs(b.x - a.x) < 4, `the old key no longer walks right (${a.x} -> ${b.x})`);
  await hold(page, 'KeyH', 900);
  const c = await body(page);
  assert.ok(c.x > b.x + 40, `the remapped key walks right (${b.x} -> ${c.x})`);
  await page.reload();
  assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('gn-island-keys'))).right[0], 'KeyH', 'remap survives a reload');
  console.log('PASS a remapped key moves the explorer');

  // A simulated controller (navigator.getGamepads stub): stick moves, Start opens the menu, B closes it.
  const pad = await open(browser, { viewport: { width: 1100, height: 760 } }, { 'gn-ob-island-practice': '1' });
  await pad.addInitScript(() => {
    const p = { connected: true, id: 'stub', index: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    window.__pad = p; navigator.getGamepads = () => [p];
  });
  await pad.reload();
  await playIsland(pad);
  a = await body(pad);
  await pad.evaluate(() => { window.__pad.axes[0] = 1; });
  await wait(900);
  await pad.evaluate(() => { window.__pad.axes[0] = 0; });
  b = await body(pad);
  assert.ok(b.x > a.x + 40, `the controller stick walks right (${a.x} -> ${b.x})`);
  const press = async (i) => { await pad.evaluate((n) => { window.__pad.buttons[n] = { pressed: true, value: 1 }; }, i); await wait(160); await pad.evaluate((n) => { window.__pad.buttons[n] = { pressed: false, value: 0 }; }, i); await wait(120); };
  await press(9);
  assert.equal(await pad.isVisible('.isl-panel'), true, 'Start opens the menu');
  await press(1);
  assert.equal(await pad.isVisible('.isl-panel'), false, 'B closes it');
  await pad.evaluate(() => { window.__sw = new Promise((res) => { const f = async () => { const b = (await import('/games/island.js')).debug.client.state.body; b.sT > 0 ? res(true) : setTimeout(f, 8); }; f(); }); });
  await press(0);
  assert.equal(await Promise.race([pad.evaluate(() => window.__sw), wait(1500).then(() => false)]), true, 'A swings the staff');
  console.log('PASS a simulated gamepad moves, attacks and opens the menu');
}

/* ---------------- touch layouts at two phone sizes ---------------- */
async function touchFlow(browser, [w, h, name]) {
  let page = await open(browser, { viewport: { width: w, height: h }, hasTouch: true, isMobile: true }, {});
  // Practice with touch controls first (fresh device), then the adventure.
  await startIsland(page);
  await page.click('.isl-pick [data-pick="new"]');
  await page.waitForSelector('.isl-practice');
  const inView = async (sel, scope = '') => {
    const control = page.locator(scope + ' ' + sel).first();
    await control.waitFor({ state: 'visible' });
    const r = await control.boundingBox();
    assert.ok(r, `${name}: ${sel} is on screen`);
    assert.ok(r.x >= -1 && r.y >= -1 && r.x + r.width <= w + 1 && r.y + r.height <= h + 1, `${name}: ${sel} sits inside the ${w}x${h} screen (${JSON.stringify(r)})`);
    return r;
  };
  const rects = {};
  for (const s of ['.isl-attack', '.isl-dodge', '.isl-ability', '.isl-stickzone']) rects[s] = await inView(s, '.isl-practice');
  const overlap = (p, q) => p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height;
  for (const [p, q] of [['.isl-attack', '.isl-dodge'], ['.isl-attack', '.isl-ability'], ['.isl-dodge', '.isl-ability']]) assert.ok(!overlap(rects[p], rects[q]), `${name}: ${p} and ${q} do not overlap`);
  for (const s of ['.isl-attack', '.isl-dodge', '.isl-ability']) assert.ok(rects[s].width >= 44 && rects[s].height >= 44, `${name}: ${s} is at least 44px`);
  const skip = await inView('[data-pr="skip"]', '.isl-practice');
  assert.ok(skip.height >= 40, `${name}: Skip is easy to hit`);
  assert.ok(!overlap(skip, rects['.isl-stickzone']) || skip.y + skip.height < rects['.isl-stickzone'].y + 1, `${name}: Skip is clear of the stick zone`);
  // The stick walks the practice explorer; the sword swings.
  const m0 = await page.evaluate(() => document.querySelector('.isl-practice')._p.me.x);
  const zone = rects['.isl-stickzone'], x = zone.x + zone.width * 0.4, y = zone.y + zone.height * 0.6;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 50, y, { steps: 4 }); await wait(700); await page.mouse.up();
  const m1 = await page.evaluate(() => document.querySelector('.isl-practice')._p.me.x);
  assert.ok(m1 > m0 + 20, `${name}: the stick walks the practice explorer (${m0} -> ${m1})`);
  await shot(page, `onboarding-practice-${name}`);
  await page.click('.isl-practice [data-pr="skip"]');
  await islandReady(page);
  for (const s of ['.isl-attack', '.isl-dodge', '.isl-ability', '.isl-stickzone']) rects[s] = await inView(s, '.isl-touch');
  for (const [p, q] of [['.isl-attack', '.isl-dodge'], ['.isl-attack', '.isl-ability'], ['.isl-dodge', '.isl-ability']]) assert.ok(!overlap(rects[p], rects[q]), `${name}: in the game, ${p} and ${q} do not overlap`);
  await page.waitForSelector('.isl-bagbtn', { state: 'visible' });
  const bag = await inView('.isl-bagbtn', '.isl-hud');
  assert.ok(!overlap(bag, rects['.isl-attack']) && !overlap(bag, rects['.isl-ability']), `${name}: the bag button is clear of the action buttons`);
  const b0 = await body(page);
  const z2 = rects['.isl-stickzone'], sx = z2.x + z2.width * 0.4, sy = z2.y + z2.height * 0.5;
  await page.mouse.move(sx, sy); await page.mouse.down(); await page.mouse.move(sx, sy + 50, { steps: 4 }); await wait(900); await page.mouse.up();
  const b1 = await body(page);
  assert.ok(b1.y > b0.y + 20, `${name}: the stick walks the explorer (${b0.y} -> ${b1.y})`);
  await page.evaluate(() => { window.__sw = new Promise((res) => { const f = async () => { const b = (await import('/games/island.js')).debug.client.state.body; b.sT > 0 || b.sCd > 0 ? res(true) : setTimeout(f, 8); }; f(); }); });
  const ar = rects['.isl-attack'];
  await page.touchscreen.tap(ar.x + ar.width / 2, ar.y + ar.height / 2);
  assert.equal(await Promise.race([page.evaluate(() => window.__sw), wait(1500).then(() => false)]), true, `${name}: the sword button swings`);
  await page.click('.isl-bagbtn');
  await page.waitForSelector('.isl-panel:not([hidden])');
  await wait(400);
  const panel = await page.locator('.isl-panel').boundingBox();
  assert.ok(panel.x >= -1 && panel.x + panel.width <= w + 1 && panel.y >= -1 && panel.y + panel.height <= h + 1, `${name}: the menu fits the screen (${JSON.stringify(panel)})`);
  await shot(page, `onboarding-island-${name}`);
  console.log(`PASS touch controls are usable at ${w}x${h}`);
}

/* ---------------- board sample and Sketch warm-up ---------------- */
async function localGame(page, id, bot = true) {
  await page.waitForSelector(`[data-local="${id}"]`).catch(async (e) => { await shot(page, 'onboarding-debug'); throw e; });
  await page.click(`[data-local="${id}"]`);
  if (bot) { await page.click('[data-kick]'); await page.click('#botBtn'); }
  await page.click('#startBtn');
}
async function sampleFlow(browser) {
  let page = await open(browser, { viewport: { width: 1100, height: 800 } }, {});
  await localGame(page, 'chess');
  await page.waitForSelector('#obSample', { timeout: 15000 });
  assert.match(await page.textContent('#obSample'), /Pick a piece/, 'the sample is the game’s own first step');
  await shot(page, 'onboarding-sample-desktop');
  await page.click('#obSample [data-ob-ok]');
  assert.equal(await page.locator('#obSample').count(), 0, 'Got it dismisses the sample');
  page = await home(page);
  await localGame(page, 'chess');
  await page.waitForSelector('#gamebox [class]');
  await wait(2500);
  assert.equal(await page.locator('#obSample').count(), 0, 'the chess sample does not come back');
  page = await home(page);
  await localGame(page, 'gems');
  await page.waitForSelector('#obSample', { timeout: 15000 });
  assert.match(await page.evaluate(() => document.getElementById('obSample').dataset.g), /gems/, 'each game gets its own sample');
  console.log('PASS the board sample shows once per game');
  // On a phone the sample is compact and the board is still there.
  const ph = await open(browser, { viewport: { width: 375, height: 700 }, hasTouch: true, isMobile: true }, {});
  await localGame(ph, 'chess');
  await ph.waitForSelector('#obSample', { timeout: 15000 });
  const r = await ph.locator('#obSample').boundingBox();
  assert.ok(r.height < 230 && r.x >= 0 && r.x + r.width <= 376, `the phone sample is compact (${JSON.stringify(r)})`);
  await shot(ph, 'onboarding-sample-phone');
}
async function sketchFlow(browser) {
  let page = await open(browser, { viewport: { width: 1100, height: 800 } }, {});
  // The warm-up waits for a turn where you guess. Seats are shuffled at the start, so hold Math.random low for
  // that moment (the computer is seated first and draws first); it is restored after a few dozen calls.
  await page.click('[data-local="sketch"]'); await page.click('[data-kick]'); await page.click('#botBtn');
  await page.evaluate(() => { const r = Math.random; let n = 0; Math.random = () => (++n > 40 ? (Math.random = r)() : 0.1); });
  await page.click('#startBtn');
  await page.waitForSelector('#skWarm', { timeout: 15000 });
  assert.match(await page.textContent('#skWarm'), /Warm-up 1 of 3/);
  const cv = await page.locator('#skWarm canvas').boundingBox();
  await page.mouse.move(cv.x + 60, cv.y + 60); await page.mouse.down(); await page.mouse.move(cv.x + 200, cv.y + 120, { steps: 6 }); await page.mouse.up();
  const ink = await page.evaluate(() => { const c = document.querySelector('#skWarm canvas'); return c.getContext('2d').getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 === 3 && v > 0); });
  assert.ok(ink, 'the warm-up canvas takes a doodle');
  await shot(page, 'onboarding-sketch-warmup');
  await page.click('#skWarm [data-sw="next"]');
  assert.match(await page.textContent('#skWarm'), /Warm-up 2 of 3/);
  await page.click('#skWarm [data-sw="skip"]');
  assert.equal(await page.locator('#skWarm').count(), 0, 'Skip closes the warm-up');
  page = await home(page);
  await localGame(page, 'sketch');
  await page.waitForSelector('#gamebox .sk-root', { timeout: 15000 });
  await wait(1500);
  assert.equal(await page.locator('#skWarm').count(), 0, 'the warm-up does not come back');
  console.log('PASS the Sketch Party warm-up is skippable and shows once');
}

let chromiumBrowser, webkitBrowser;
try {
  if (selected.some(name => name !== 'webkit')) chromiumBrowser = await chromium.launch();
  if (only('practice')) await practiceFlow(chromiumBrowser, 'chromium');
  if (only('controls')) await controlsFlow(chromiumBrowser);
  if (only('touch')) for (const size of [[360, 640, 'portrait'], [640, 360, 'landscape']]) await touchFlow(chromiumBrowser, size);
  if (only('sample')) await sampleFlow(chromiumBrowser);
  if (only('sketch')) await sketchFlow(chromiumBrowser);
  if (only('webkit')) {
    // Software-rendered WebKit is CPU-bound: let Chromium's finished pages go before it runs.
    for (const c of contexts.splice(0)) await c.close().catch(() => {});
    await chromiumBrowser?.close().catch(() => {});
    webkitBrowser = await webkit.launch(); await practiceFlow(webkitBrowser, 'webkit'); }
  assert.deepEqual([...new Set(errors)], [], 'no page errors');
  console.log('onboarding-ci: all checks passed.');
} catch (e) {
  console.error(e, [...new Set(errors)]);
  process.exitCode = 1;
} finally {
  for (const c of contexts) await c.close().catch(() => {});
  await chromiumBrowser?.close().catch(() => {});
  await webkitBrowser?.close().catch(() => {});
  server.close();
}
