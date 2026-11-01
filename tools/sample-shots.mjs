// Screenshots of the first-move sample in every board game at desktop and phone width (a look-and-see helper):
//   node tools/sample-shots.mjs   -> test-results/sample-<game>-<desktop|phone>.png
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
const require = createRequire(import.meta.url);
const { createServer } = require('../serve.js');
const server = createServer(fileURLToPath(new URL('../', import.meta.url)));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const peer = fileURLToPath(new URL('../node_modules/peerjs/dist/peerjs.min.js', import.meta.url));
const b = await chromium.launch();
for (const [label, vp, mobile] of [['desktop', { width: 1280, height: 860 }, false], ['phone', { width: 390, height: 844 }, true]]) {
  for (const id of ['hexisle', 'gems', 'mosaic', 'bluff', 'chess']) {
    const ctx = await b.newContext({ viewport: vp, hasTouch: mobile, isMobile: mobile });
    await ctx.route(/unpkg|jsdelivr/, (r) => r.fulfill({ contentType: 'text/javascript', path: peer }));
    await ctx.route(/fonts\./, (r) => r.fulfill({ contentType: 'text/css', body: '' }));
    await ctx.addInitScript(() => { localStorage.setItem('gn-onboard-force', '1'); localStorage.setItem('gn-name', 'T'); });
    const p = await ctx.newPage();
    await p.goto(base + '/');
    await p.click(`[data-local="${id}"]`); await p.click('[data-kick]'); await p.click('#botBtn'); await p.click('#startBtn');
    const ok = await p.waitForSelector('#obSample', { timeout: 15000 }).then(() => true, () => false);
    await p.waitForTimeout(600);
    await p.screenshot({ path: fileURLToPath(new URL(`../test-results/sample-${id}-${label}.png`, import.meta.url)) });
    console.log(id, label, ok ? 'sample shown' : 'NO SAMPLE');
    await ctx.close();
  }
}
await b.close(); server.close();
