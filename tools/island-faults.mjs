// Creature Island when things go wrong, in Chromium and WebKit: a slow save, a failed save (Retry is offered and
// the session keeps running), cancelling a save-and-leave, the network dropping, a Worker that fails to start
// (the world must still tick), and audio that is missing or refuses to start (no page errors).
//   node tools/island-faults.mjs        (SKIP_WEBKIT=1 skips WebKit)
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import { startEnv, soloIsland, openSave, tick, wait, waitFor, out } from './island-harness.mjs';

const env = await startEnv();
const rows = () => env.db.prepare("SELECT name FROM sqlite_master WHERE name='explorers'").get() ? env.db.prepare('SELECT COUNT(*) AS n FROM explorers').get().n : 0;
const unsaved = (page) => page.evaluate(async () => { const { debug } = await import('/games/island.js'); return !!debug.client.state.me?.unsaved; });
const ticking = async (page, label) => { const t = await tick(page); await wait(700); assert.ok((await tick(page)) > t + 5, label + ': the world keeps ticking'); };
const rej = (page) => page.evaluate(() => window.__rej || []);
let n = 0;
const fresh = (browser, opts = {}, init) => { env.fault = 'ok'; return env.open(browser, { viewport: { width: 1100, height: 700 }, ...opts }, init); };
const solo = async (page, account = true) => soloIsland(page, 'Fault Explorer ' + ++n, '4826', { account });

const tests = {
  async 'a slow save finishes, and the island keeps running meanwhile'(browser) {
    const page = await fresh(browser); await solo(page);
    env.fault = 'slow'; env.delay = 2500;
    await openSave(page);
    const before = rows();
    await page.click('[data-save="cloud"]');
    await ticking(page, 'during the save');
    assert.equal(rows(), before, 'nothing is stored before the service answers');
    await waitFor(page, async () => { const { debug } = await import('/games/island.js'); return !debug.client.state.me?.unsaved; }, null, 15000);
    assert.equal(rows(), before + 1, 'the slow save lands');
    assert.deepEqual(await rej(page), []);
  },
  async 'a failed save keeps the session running and offers Retry'(browser) {
    const page = await fresh(browser); await solo(page);
    env.fault = 'fail'; const base0 = rows();
    await openSave(page);
    await page.click('[data-save="cloud"]');
    await page.waitForSelector('[data-save="retry"]');
    assert.equal(rows(), base0, 'a failed save stores nothing');
    assert.ok(await unsaved(page), 'the explorer is still marked unsaved');
    await ticking(page, 'after the failed save');
    const x0 = await page.evaluate(async () => (await import('/games/island.js')).debug.client.state.body.x);
    await page.keyboard.press('Escape');
    await page.keyboard.down('KeyD'); await wait(700); await page.keyboard.up('KeyD');
    assert.ok((await page.evaluate(async () => (await import('/games/island.js')).debug.client.state.body.x)) - x0 > 20, 'the explorer can still move');
    await openSave(page).catch(() => {});
    await page.waitForSelector('[data-save="retry"]');
    env.fault = 'ok';
    await page.click('[data-save="retry"]');
    await waitFor(page, async () => { const { debug } = await import('/games/island.js'); return !debug.client.state.me?.unsaved; });
    assert.equal(rows(), base0 + 1, 'Retry saves once the service is back');
  },
  async 'cancelling Save and leave keeps the player on the island'(browser) {
    const page = await fresh(browser); await solo(page);
    env.fault = 'slow'; env.delay = 2000;
    await waitFor(page, async () => { const { debug } = await import('/games/island.js'); return !!debug.client.state.me?.unsaved; });
    await page.evaluate(async () => { (await import('/js/net.js')).leave(); });
    await page.click('[data-leave="save"]');
    await wait(300);
    await page.keyboard.press('Escape');
    await wait(3200);
    const s = await page.evaluate(async () => { const { debug } = await import('/games/island.js'); const { S } = await import('/js/state.js'); return { players: debug.world.players.size, started: S.started, hud: !document.querySelector('.isl-hud')?.hidden, overlay: !document.querySelector('.isl-overlay')?.hidden }; });
    assert.equal(s.started, true, 'still in the game');
    assert.equal(s.players, 1, 'the host still simulates the explorer');
    assert.ok(s.hud, 'the HUD is still there');
    await ticking(page, 'after cancelling');
  },
  async 'the network dropping mid-save is a retryable error, not a crash'(browser) {
    const page = await fresh(browser); await solo(page);
    await openSave(page);
    env.fault = 'drop'; const base0 = rows();
    await page.click('[data-save="cloud"]');
    await page.waitForSelector('[data-save="retry"]');
    assert.equal(rows(), base0);
    await ticking(page, 'offline');
    env.fault = 'ok';
    await page.context().setOffline(true);
    await page.click('[data-save="retry"]');
    await page.waitForSelector('[data-save="retry"]');
    assert.equal(rows(), base0, 'still nothing stored while the device is offline');
    await page.context().setOffline(false);
    await page.click('[data-save="retry"]');
    await waitFor(page, async () => { const { debug } = await import('/games/island.js'); return !debug.client.state.me?.unsaved; });
    assert.equal(rows(), base0 + 1, 'saved after the connection returns');
    assert.deepEqual(await rej(page), []);
  },
  async 'a Worker that throws on creation falls back to the page timer'(browser) {
    const page = await fresh(browser, {}, () => { window.Worker = class { constructor() { throw new Error('Workers are blocked'); } }; });
    await solo(page, false);
    await ticking(page, 'no Worker');
    await page.waitForSelector('.isl-hud:not([hidden])');
  },
  async 'a Worker that fails after the fact falls back to the page timer'(browser) {
    const page = await fresh(browser, {}, () => { window.Worker = class { constructor() { setTimeout(() => this.onerror?.({ preventDefault() {} }), 50); } terminate() {} }; });
    await solo(page, false);
    await ticking(page, 'async Worker error');
    await page.waitForSelector('.isl-hud:not([hidden])');
  },
  async 'a Worker that never answers falls back after its start-up timeout'(browser) {
    const page = await fresh(browser, {}, () => { window.Worker = class { terminate() {} }; });
    await solo(page, false);
    await waitFor(page, async () => { const { debug } = await import('/games/island.js'); const t = debug.world.tick; await new Promise((r) => setTimeout(r, 400)); return debug.world.tick > t + 5; }, null, 8000);
  },
  async 'no audio device: AudioContext throws'(browser) {
    const page = await fresh(browser, {}, () => { const boom = class { constructor() { throw new Error('no audio device'); } }; window.AudioContext = boom; window.webkitAudioContext = boom; });
    await solo(page, false);
    await page.keyboard.press('Space'); await page.mouse.click(300, 300);
    await page.keyboard.down('KeyD'); await wait(500); await page.keyboard.up('KeyD');
    await ticking(page, 'no AudioContext');
    assert.deepEqual(await rej(page), []);
  },
  async 'audio that refuses to resume or suspend raises no errors'(browser) {
    const page = await fresh(browser, {}, () => {
      const Base = window.AudioContext || window.webkitAudioContext;
      if (!Base) return;
      const Bad = class extends Base { resume() { return Promise.reject(new Error('NotAllowedError')); } suspend() { return Promise.reject(new Error('InvalidStateError')); } };
      window.AudioContext = Bad; window.webkitAudioContext = Bad;
    });
    await solo(page, false);
    await page.keyboard.press('Space'); await page.mouse.click(300, 300); await page.keyboard.press('KeyJ');
    await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await wait(500);
    await page.click('.isl-bagbtn'); await page.keyboard.press('Escape');
    await ticking(page, 'rejecting audio');
    assert.deepEqual(await rej(page), []);
  },
};

const results = [];
const engines = [['Chromium', () => chromium.launch({ args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'] })]];
if (!process.env.SKIP_WEBKIT) engines.push(['WebKit', () => webkit.launch()]);
for (const [name, launch] of engines) {
  let browser = await launch();
  env.browsers.push(browser);
  for (const [title, fn] of Object.entries(tests)) {
    env.errors.length = 0; env.saves = 0;
    try {
      // Software-rendered WebKit on Linux can lose its web process under load; that is the browser dying, not the
      // island failing, so a test that ends in "closed" is run once more on a fresh browser. Assertions are untouched.
      for (let attempt = 0; ; attempt++) {
        try { await fn(browser); break; }
        catch (e) {
          if (attempt || name !== 'WebKit' || !/has been closed|Target crashed|Browser closed/i.test(String(e.message))) throw e;
          console.warn(`RETRY ${name}: ${title} (the browser closed under it)`);
          for (const c of env.contexts.splice(0)) await c.close().catch(() => {});
          await browser.close().catch(() => {});
          env.errors.length = 0; env.saves = 0;
          browser = await launch(); env.browsers.push(browser);
        }
      }
      assert.deepEqual(env.errors, [], 'no page errors');
      console.log(`PASS ${name}: ${title}`); results.push(true);
    } catch (e) {
      console.error(`FAIL ${name}: ${title}\n  ${String(e.message).split('\n').slice(0, 4).join('\n  ')}`, env.errors.slice(0, 4));
      results.push(false);
      for (const [i, c] of env.contexts.slice(-1).entries()) for (const p of c.pages()) await p.screenshot({ path: fileURLToPath(new URL(`fault-${name}-${results.length}-${i}.png`, out)) }).catch(() => {});
    }
    for (const c of env.contexts.splice(0)) await c.close().catch(() => {});
  }
}
await env.close();
console.log(`${results.filter(Boolean).length}/${results.length} fault checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
