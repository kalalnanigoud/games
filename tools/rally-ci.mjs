import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import { startEnv, wait, waitFor, out } from './island-harness.mjs';
import { fileURLToPath } from 'node:url';
const env = await startEnv({ withBroker: true });
try {
  for (const [name, engine] of [['Chromium', chromium], ['WebKit', webkit]]) {
    const browser = await engine.launch(); env.browsers.push(browser);
    for (const phone of [false, true]) {
      const page = await env.open(browser, { viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 900 }, hasTouch: phone });
      assert.equal(await page.locator('[data-host="rally"]').count(), 0, 'solo race offers no online host action');
      await page.evaluate(async () => (await import('/js/net.js')).hostRoom('rally'));
      assert.equal(await page.evaluate(async () => (await import('/js/state.js')).S.role), null, 'direct host request is rejected');
      await page.fill('#nameIn', 'Driver');
      await page.click('[data-host="island"]');
      await page.click('[data-pick]');
      assert.equal(await page.locator('[data-game="rally"]').count(), 0, 'online picker excludes solo race');
      await page.click('#pickerModal .picker-x');
      await page.evaluate(async () => (await import('/js/net.js')).leave());
      await page.bringToFront();
      await page.click('[data-local="rally"]'); await page.click('#startBtn');
      await page.waitForSelector('.rally canvas');
      try { await waitFor(page, async () => (await import('/games/rally.js')).debug.race.countdown === 0); }
      catch (error) {
        console.error('Countdown diagnostics', await page.evaluate(async () => {
          const r = (await import('/games/rally.js')).debug.race;
          return { countdown: r?.countdown, paused: r?.paused, visibility: document.visibilityState, focused: document.hasFocus(), overlay: !!document.querySelector('.modal-bg, .gh-sheet') };
        }));
        throw error;
      }
      const before = await page.evaluate(async () => (await import('/games/rally.js')).debug.race.cars[0].angle);
      if (phone) { const b = page.locator('[data-drive="right"]'); const box = await b.boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await wait(350); await page.mouse.up(); }
      else { await page.keyboard.down('ArrowRight'); await wait(350); await page.keyboard.up('ArrowRight'); }
      const state = await page.evaluate(async () => { const r = (await import('/games/rally.js')).debug.race; return { angle: r.cars[0].angle, paused: r.paused, countdown: r.countdown, time: r.time }; });
      assert.ok(state.angle > before, `steering changes heading (${JSON.stringify({ before, ...state })})`);
      // A menu suspends a solo race and discards previously held steering.
      await page.keyboard.down('ArrowRight');
      await page.click('#ghMenuBtn');
      const menuTime = await page.evaluate(async () => (await import('/games/rally.js')).debug.race.time);
      await wait(220);
      assert.equal(await page.evaluate(async () => (await import('/games/rally.js')).debug.race.time), menuTime, 'menu stops simulation');
      assert.equal(await page.locator('.gh-menu[role="dialog"][aria-modal="true"]').count(), 1);
      for (let i = 0; i < 10; i++) {
        await page.keyboard.press(i % 2 ? 'Shift+Tab' : 'Tab');
        assert.ok(await page.evaluate(() => !!document.activeElement.closest('.gh-menu')), 'focus remains in menu');
      }
      await page.evaluate(async () => (await import('/js/ui.js')).render());
      assert.equal(await page.locator('#app').getAttribute('inert'), '', 'background remains inert after redraw');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.gh-sheet').count(), 0);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'ghMenuBtn', 'focus returns to opener');
      const heading = await page.evaluate(async () => (await import('/games/rally.js')).debug.race.cars[0].angle);
      await wait(180);
      assert.equal(await page.evaluate(async () => (await import('/games/rally.js')).debug.race.cars[0].angle), heading, 'held steering was cleared');
      await page.keyboard.up('ArrowRight');
      await page.click('[data-pause]');
      const t = await page.evaluate(async () => (await import('/games/rally.js')).debug.race.time);
      await wait(200);
      assert.equal(await page.evaluate(async () => (await import('/games/rally.js')).debug.race.time), t);
      await page.click('[data-resume]');
      if (!phone) {
        // Pause clicked twice keeps focus; Space must then boost rather than press Pause again.
        await page.click('[data-pause]'); await page.click('[data-pause]');
        const charge = await page.evaluate(async () => (await import('/games/rally.js')).debug.race.cars[0].boost);
        await page.keyboard.down('Space'); await wait(300); await page.keyboard.up('Space');
        const after = await page.evaluate(async () => { const r = (await import('/games/rally.js')).debug.race; return { paused: r.paused, boost: r.cars[0].boost }; });
        assert.equal(after.paused, false, 'Space on the focused Pause button does not pause');
        assert.ok(after.boost < charge, `Space boosts after clicking Pause (${charge} -> ${after.boost})`);
      }
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
