// Creature Island's Arena Rush in a real browser (Chromium): pick the mode in the lobby, start, see the timer
// and score card, check there is nothing to save, fight a wave, move the clock to the end through the
// world's test hook, see the end card, and play again.
//   node tools/arena-ci.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
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
const peerSource = await fs.readFile(new URL('../node_modules/peerjs/dist/peerjs.min.js', import.meta.url), 'utf8');
const localPeer = peerSource + `\n;{const Original=globalThis.Peer;globalThis.Peer=class extends Original{constructor(id,opts){if(id&&typeof id==='object'){opts=id;id=undefined;}super(id,{...opts,host:'127.0.0.1',port:${brokerPort},path:'/',secure:false,config:{iceServers:[]}});}};}`;

const errors = [];
let browser;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(page, fn, arg, timeout = 20000) {
  const end = Date.now() + timeout;
  do { if (await page.evaluate(fn, arg).catch(() => false)) return; await wait(120); } while (Date.now() < end);
  throw Error('Timed out: ' + fn.toString().slice(0, 160));
}
async function open(opts) {
  const context = await browser.newContext(opts);
  await context.route(/https:\/\/(unpkg\.com|cdn\.jsdelivr\.net)\/.*peerjs.*\.js/, (r) => r.fulfill({ contentType: 'text/javascript', body: localPeer }));
  await context.route(/https:\/\/fonts\./, (r) => r.abort());
  await context.addInitScript(() => localStorage.setItem('gn-help-island', '1'));
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(base);
  return page;
}
const arenaOf = (page) => page.evaluate(async () => { const { debug } = await import('/games/island.js'); const a = debug.world?.arena; return a ? { state: a.state, wave: a.wave, score: a.score, foes: a.foes.size } : null; });

try {
  browser = await chromium.launch({ args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  for (const [label, viewport, touch] of [['desktop', { width: 1280, height: 760 }, false], ['phone', { width: 390, height: 844 }, true]]) {
    const page = await open(touch ? { viewport, hasTouch: true, isMobile: true } : { viewport });
    await page.selectOption('[data-filter="minutes"]', '5');
    assert.match(await page.locator('.game-card:has([data-quick="island"]) .game-meta').innerText(), /Arena Rush.*5 min/);
    await page.click('[data-quick="island"]');
    await page.waitForSelector('.isl-arena:not([hidden])');
    assert.equal(await page.evaluate(async () => (await import('/js/state.js')).S.role), 'local');
    assert.equal(await page.evaluate(async () => (await import('/js/state.js')).S.opts.mode), 'arena');
    assert.equal(await page.locator('.isl-pick').count(), 0, 'direct launch skips the adventure picker');
    console.log(`PASS ${label}: five-minute library result launches solo Arena Rush directly`);
    await page.evaluate(async () => (await import('/js/net.js')).leave());
    await page.click('#clearFilters');
    await page.fill('#nameIn', 'Ari');
    await page.click('[data-host="island"]');
    await waitFor(page, async () => (await import('/js/state.js')).S.status === 'online');
    // The lobby offers the mode; the default is the normal adventure.
    const sel = page.locator('select[data-opt="mode"]');
    await sel.waitFor();
    assert.equal(await sel.inputValue(), 'adventure', 'adventure is the default');
    assert.deepEqual(await sel.locator('option').allInnerTexts(), ['Adventure (save when you like)', 'Arena Rush (5 min, no saving)']);
    await sel.selectOption('arena');
    await page.selectOption('select[data-opt="arenaKit"]', 'guardian');
    await page.click('#startBtn');
    await page.waitForSelector('.isl-arena:not([hidden])');
    assert.deepEqual(await page.evaluate(async () => {
      const { debug } = await import('/games/island.js');
      const p = [...debug.world.players.values()][0];
      return { charm: p.ex.equip.charm, species: p.ex.team[0].sp };
    }), { charm: 'tidecharm', species: 'dewpaw' });
    console.log(`PASS ${label}: Arena Rush starts straight into the arena, with no explorer to pick or load`);

    // Timer and score card, in the island's look.
    const hud = await page.locator('.isl-arena').innerText();
    assert.match(hud, /^[45]:\d\d/, `a timer near 5:00 (${hud})`);
    assert.match(hud, /pts/);
    assert.equal(await page.locator('.isl-quest').isVisible(), false, 'the story goal card is out of the way');
    const box = await page.locator('.isl-arena').boundingBox(), me = await page.locator('.isl-me').boundingBox(), bag = await page.locator('.isl-bagbtn').boundingBox();
    assert.ok(box.x >= me.x + me.width - 1 && box.x + box.width <= bag.x + 1, `the card sits between the explorer card and the bag button (${JSON.stringify([me.x + me.width, box.x, box.x + box.width, bag.x])})`);
    assert.ok(box.x + box.width <= viewport.width && box.y >= 0, 'and on screen');
    await page.screenshot({ path: fileURLToPath(new URL(`../test-results/arena-${label}.png`, import.meta.url)) }).catch(() => {});

    // Nothing to save: no save tab, no unsaved dot, leaving needs no prompt.
    await page.click('.isl-bagbtn');
    await page.waitForSelector('.isl-panel:not([hidden])');
    assert.equal(await page.locator('.isl-tabs button[data-tab="save"]').isVisible(), false, 'no Save tab');
    assert.equal(await page.locator('.isl-tabs button[data-tab="quests"]').isVisible(), false, 'no quest tab');
    assert.equal(await page.locator('.isl-panel [data-save]').count(), 0, 'no save buttons');
    assert.equal(await page.locator('.isl-bagbtn.unsaved').count(), 0, 'no unsaved dot');
    await page.click('.isl-panel [data-panel="close"]');
    console.log(`PASS ${label}: no save tab, button, dot or prompt`);

    // Waves come and the clock runs.
    await waitFor(page, async () => { const { debug } = await import('/games/island.js'); return debug.world.arena.wave >= 1; }, null, 15000);
    const a1 = await arenaOf(page);
    assert.ok(a1.state === 'run' && a1.foes > 0, `a wave is on (${JSON.stringify(a1)})`);
    await waitFor(page, () => /Wave \d/.test(document.querySelector('.isl-arena')?.innerText || ''));
    // Fight: beat a foe through the host and see the score rise on the card.
    const s0 = a1.score;
    await page.evaluate(async () => { const { debug } = await import('/games/island.js'); const w = debug.world; const e = w.ents.get([...w.arena.foes][0]); w.hurt(e, 9999, 'none', { pid: [...w.players.keys()][0] }); });
    await waitFor(page, async (s) => (await import('/games/island.js')).debug.world.arena.score > s, s0);
    await waitFor(page, () => !/Wave \d · 0 pts/.test(document.querySelector('.isl-arena')?.innerText || ''));
    console.log(`PASS ${label}: waves come and beating a foe scores`);

    // Move the clock to the end: the end card shows the result and a way to play again.
    await page.evaluate(async () => { const { debug } = await import('/games/island.js'); debug.world.arena.skip(299); });
    await waitFor(page, () => document.querySelector('.isl-arena')?.innerText.startsWith('0:'), null, 8000);
    await page.waitForSelector('.isl-arena-end:not([hidden]) .isl-end', { timeout: 10000 });
    const endText = await page.locator('.isl-arena-end').innerText();
    assert.match(endText, /You held the arena!/);
    assert.match(endText, /points/);
    assert.match(endText, /Nothing is saved/);
    assert.equal(await page.locator('.isl-arena-end [data-arena="again"]').isVisible(), true);
    await page.screenshot({ path: fileURLToPath(new URL(`../test-results/arena-${label}-end.png`, import.meta.url)) }).catch(() => {});
    console.log(`PASS ${label}: the run ends on the clock with a score card`);

    // Leaving needs no prompt.
    assert.equal(await page.evaluate(async () => (await import('/games/island.js')).debug.client.beforeExit('leave', () => {})), false, 'leaving ends the run without a prompt');

    // Play again starts a fresh run.
    await page.click('[data-arena="again"]');
    await page.waitForSelector('.isl-arena-end', { state: 'hidden' });
    await waitFor(page, async () => { const a = (await import('/games/island.js')).debug.world.arena; return a.state === 'run' && a.score === 0; });
    console.log(`PASS ${label}: Play again starts fresh`);
    await page.context().close();
  }
  assert.deepEqual(errors, [], 'no page errors: ' + errors.join(' | '));
  console.log('Arena Rush browser checks passed.');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser?.close();
  broker.kill();
  server.close();
}
