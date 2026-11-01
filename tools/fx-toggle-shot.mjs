// The "Lower effects" button in the island's Guide tab: cycles auto -> on -> off, remembers the choice on this
// device, and is screenshotted at phone and desktop sizes (test-results/fx-toggle-*.png).
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startEnv, pickNew, wait, out } from './island-harness.mjs';

const env = await startEnv();
try {
  const browser = await chromium.launch();
  env.browsers.push(browser);
  for (const [name, opts] of [['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }], ['desktop', { viewport: { width: 1280, height: 760 } }]]) {
    const page = await env.open(browser, { ...opts, deviceScaleFactor: 2 });
    await page.fill('#nameIn', 'Solo'); await page.click('[data-local="island"]'); await page.click('#startBtn');
    await page.waitForSelector('.isl-pick [data-pick="new"]');
    await page.click('.isl-pick [data-pick="new"]');
    // a first adventure starts with a practice: skip it if it shows
    await page.waitForSelector('.isl-bagbtn, [data-pr="skip"]', { timeout: 20000 }).catch(() => {});
    const skip = page.locator('[data-pr="skip"]').first();
    if (await skip.count()) await skip.click();
    await page.waitForSelector('.isl-bagbtn');
    await page.click('.isl-bagbtn');
    await page.click('.isl-tabs [data-tab="guide"]');
    const btn = page.locator('[data-ctl="fx"]');
    const label = () => btn.innerText();
    const stored = () => page.evaluate(() => localStorage.getItem('gn-island-effects'));
    assert.match(await label(), /Lower effects: auto \(off\)/);
    const normalWidth = await page.locator('.isl-canvas').evaluate(c => c.width);
    await btn.click(); assert.match(await label(), /Lower effects: on/); assert.equal(await stored(), 'low');
    await page.waitForFunction(() => {
      const c = document.querySelector('.isl-canvas');
      return Math.abs(c.width - c.getBoundingClientRect().width) <= 1;
    });
    const lowWidth = await page.locator('.isl-canvas').evaluate(c => c.width);
    assert.ok(Math.abs(normalWidth - lowWidth * 2) <= 1, 'low effects halves backing resolution on a 2x display');
    await page.screenshot({ path: fileURLToPath(new URL(`fx-toggle-${name}.png`, out)) });
    await btn.click(); assert.match(await label(), /Lower effects: off/); assert.equal(await stored(), 'normal');
    await page.waitForFunction(w => document.querySelector('.isl-canvas').width === w, normalWidth);
    await btn.click(); assert.match(await label(), /Lower effects: auto/); assert.equal(await stored(), null);
    const row = await page.evaluate(() => { const r = document.querySelector('[data-ctl="fx"]').parentElement.getBoundingClientRect(); const p = document.querySelector('.isl-panel').getBoundingClientRect(); return r.right <= p.right + 1 && document.documentElement.scrollWidth <= innerWidth + 1; });
    assert.ok(row, name + ': the row fits without sideways scrolling');
    console.log(`PASS ${name}: Lower effects button cycles, is remembered and fits`);
    await page.context().close();
  }
  assert.deepEqual(env.errors, []);
} finally { await env.close(); }
