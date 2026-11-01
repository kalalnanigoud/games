import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import { startEnv, wait, waitFor, out } from './island-harness.mjs';
import { fileURLToPath } from 'node:url';
const env = await startEnv();
try {
  for (const [name, engine] of [['Chromium', chromium], ['WebKit', webkit]]) {
    const browser = await engine.launch(); env.browsers.push(browser);
    for (const phone of [false, true]) {
      const page = await env.open(browser, { viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 900 }, hasTouch: phone });
      await page.click('[data-local="rally"]'); await page.click('#startBtn');
      await page.waitForSelector('.rally canvas');
      await waitFor(page, async () => (await import('/games/rally.js')).debug.race.countdown === 0);
      const before = await page.evaluate(async () => (await import('/games/rally.js')).debug.race.cars[0].angle);
      if (phone) { const b = page.locator('[data-drive="right"]'); const box = await b.boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await wait(350); await page.mouse.up(); }
      else { await page.keyboard.down('ArrowRight'); await wait(350); await page.keyboard.up('ArrowRight'); }
      const state = await page.evaluate(async () => { const r = (await import('/games/rally.js')).debug.race; return { angle: r.cars[0].angle, paused: r.paused, countdown: r.countdown, time: r.time }; });
      assert.ok(state.angle > before, `steering changes heading (${JSON.stringify({ before, ...state })})`);
      await page.click('[data-pause]');
      const t = await page.evaluate(async () => (await import('/games/rally.js')).debug.race.time);
      await wait(200);
      assert.equal(await page.evaluate(async () => (await import('/games/rally.js')).debug.race.time), t);
      await page.click('[data-resume]');
      await page.evaluate(async () => { const { debug } = await import('/games/rally.js'); debug.race.result = { time: 60, place: 2 }; });
      await page.click('[data-again]');
      assert.equal(await page.evaluate(async () => (await import('/games/rally.js')).debug.race.cars[0].lap), 0);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'fits viewport');
      await page.screenshot({ path: fileURLToPath(new URL(`rally-${name}-${phone ? 'phone' : 'desktop'}.png`, out)) });
      await page.evaluate(async () => (await import('/js/net.js')).leave());
      await page.waitForSelector('[data-local="rally"]');
      await page.context().close();
      console.log(`PASS ${name} ${phone ? 'phone' : 'desktop'}: solo launch, controls, pause, finish/retry, layout and exit`);
    }
  }
  assert.equal(env.saves, 0, 'short races never write adventure saves');
  assert.deepEqual(env.errors, []);
} finally { await env.close(); }
