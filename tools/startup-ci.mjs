import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import { startEnv, waitFor, wait } from './island-harness.mjs';
const env = await startEnv({ withBroker: true });
const peerCDN = /https:\/\/(unpkg\.com|cdn\.jsdelivr\.net)\/.*peerjs.*\.js/;
try {
  for (const [name, engine] of [['Chromium', chromium], ['WebKit', webkit]]) {
    const browser = await engine.launch(); env.browsers.push(browser);
    for (const denial of ['methods', 'properties']) {
      const page = await env.open(browser, {}, (kind) => {}, );
      // Reload after installing the denial, so module initialization also runs without storage.
      await page.context().addInitScript((kind) => {
        const deny = () => { throw new DOMException('Storage disabled', 'SecurityError'); };
        if (kind === 'methods') for (const method of ['getItem', 'setItem', 'removeItem']) Storage.prototype[method] = deny;
        else for (const key of ['sessionStorage', 'localStorage']) Object.defineProperty(window, key, { get: deny });
      }, denial);
      await page.reload();
      await page.waitForSelector('#quickBtn');
      await page.fill('#nameIn', 'No storage');
      await page.click('[data-local="rally"]'); await page.click('#startBtn');
      await page.waitForSelector('.rally canvas');
      await page.click('#ghMenuBtn'); await page.click('#ghSound');
      await page.keyboard.press('Escape');
      await page.evaluate(async () => (await import('/js/net.js')).leave());
      await page.waitForSelector('#quickBtn');
      assert.equal(await page.locator('#nameIn').inputValue(), 'No storage', 'name remains usable during this visit');
      await page.context().close();
    }
    const page = await env.open(browser);
    assert.equal(await page.evaluate(() => typeof globalThis.Peer), 'undefined', 'home does not request optional PeerJS');
    let release;
    const gate = new Promise(r => { release = r; });
    await page.route(peerCDN, async r => { await gate; await r.abort(); });
    await page.fill('#nameIn', 'Startup'); await page.click('[data-host="island"]');
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('Loading online play'));
    await page.click('[data-local="rally"]'); await page.click('#startBtn');
    await page.waitForSelector('.rally canvas');
    release();
    await wait(200);
    assert.equal(await page.evaluate(async () => (await import('/js/state.js')).S.role), 'local', 'pending online request cannot replace solo play');
    await page.evaluate(async () => (await import('/js/net.js')).leave());
    await page.unroute(peerCDN);
    // Primary failure deterministically tries the fallback, using the local test broker.
    await page.route('https://unpkg.com/**', r => r.abort());
    await page.click('[data-host="island"]');
    await waitFor(page, async () => (await import('/js/state.js')).S.status === 'online');
    await page.evaluate(async () => (await import('/js/net.js')).leave());
    await page.context().close();
    // Both CDNs fail: retain the home screen, show recovery, then permit a retry.
    const failed = await env.open(browser);
    await failed.route(peerCDN, r => r.abort());
    await failed.fill('#nameIn', 'Retry'); await failed.click('[data-host="island"]');
    await failed.waitForFunction(() => document.getElementById('toast').textContent.includes('Could not load online play'));
    assert.equal(await failed.evaluate(async () => (await import('/js/state.js')).S.role), null);
    assert.ok(await failed.locator('#quickBtn').isVisible());
    await failed.unroute(peerCDN); await failed.click('[data-host="island"]');
    await waitFor(failed, async () => (await import('/js/state.js')).S.status === 'online');
    await failed.evaluate(async () => (await import('/js/net.js')).leave());
    // Repeat input stops on suspension, blur, modal sampling and destruction.
    const touch = await failed.evaluate(async () => {
      const { createInput, bindTouch, touchHTML } = await import('/games/island-input.js');
      const root = document.createElement('div'); root.innerHTML = touchHTML({}); document.body.appendChild(root);
      const inp = createInput(); bindTouch(inp, root);
      const button = root.querySelector('.isl-attack');
      const press = () => button.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, pointerType: 'touch' }));
      const results = [];
      for (const action of ['suspend', 'blur', 'modal', 'destroy']) {
        press(); results.push(!!button._rep);
        if (action === 'suspend') document.dispatchEvent(new Event('gn-input-suspend'));
        if (action === 'blur') dispatchEvent(new Event('blur'));
        if (action === 'modal') { const el = document.createElement('div'); el.className = 'modal-bg'; document.body.appendChild(el); inp.sample(); el.remove(); }
        if (action === 'destroy') inp.destroy();
        results.push(button._rep === null && inp.bits === 0 && !button.classList.contains('down'));
      }
      root.remove(); return results;
    });
    assert.ok(touch.every(Boolean), 'touch repeat and held input clean up on all interruption paths');
    await failed.context().close();
    console.log(`PASS ${name}: denied storage reads/writes/getters, solo boot without PeerJS, delayed online cancellation, CDN fallback/failure/retry, touch teardown`);
  }
  assert.deepEqual(env.errors, []);
  assert.equal(env.saves, 0);
} finally { await env.close(); }
