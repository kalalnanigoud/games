// Creature Island performance in Chromium under 4x CPU throttling (CDP Emulation.setCPUThrottlingRate):
// frame time p50/p95, JS heap and bytes on the wire per player per second, at a phone and a desktop size,
// in the village, on the shore (lots of water) and on the stormy peak (rain). Two live explorers over real
// WebRTC (a local broker), both walking. Writes test-results/perf-island.json and .md.
// Fails if p95 frame time on the throttled phone is over the budget.
//   node tools/perf-island.mjs [--sizes phone|desktop|phone,desktop] [--effects normal|low|both] [--seconds 8] [--budget 40] [--scenes village,shore,peak]
import fs from 'node:fs/promises';
import { selectCases } from './ci-select.mjs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startEnv, pickNew, wait, waitFor, out } from './island-harness.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const SECONDS = Number(arg('seconds', 8)), BUDGET = Number(arg('budget', process.env.PERF_BUDGET_MS || 40)), THROTTLE = Number(arg('throttle', 4));
const effects = selectCases('--effects', ['normal', 'low'], arg('effects', 'normal') === 'both' ? undefined : arg('effects', 'normal'));
const scenes = selectCases('--scenes', ['village', 'shore', 'peak'], arg('scenes'));
const selectedSizes = selectCases('--sizes', ['phone', 'desktop'], arg('sizes'));
const sizes = { phone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }, desktop: { viewport: { width: 1280, height: 760 } } };

const init = () => {
  // Count every byte this page sends over WebRTC data channels, and record each animation frame's duration.
  window.__tx = 0;
  const send = RTCDataChannel.prototype.send;
  RTCDataChannel.prototype.send = function (d) { window.__tx += typeof d === 'string' ? new TextEncoder().encode(d).length : (d.byteLength ?? d.size ?? 0); return send.call(this, d); };
  window.__ft = []; let last = 0;
  const loop = (t) => { if (last) window.__ft.push(t - last); last = t; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
};
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };
const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

const env = await startEnv({ withBroker: true });
const results = [];
try {
  const browser = await chromium.launch({ args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--enable-precise-memory-info'] });
  env.browsers.push(browser);
  for (const [sizeName, opts] of Object.entries(sizes).filter(([name]) => selectedSizes.includes(name))) {
    const host = await env.open(browser, opts, init);
    const guest = await env.open(browser, sizeName === 'phone' ? opts : { viewport: { width: 1024, height: 700 } }, init);
    await host.fill('#nameIn', 'Host'); await host.click('[data-host="island"]');
    await waitFor(host, async () => (await import('/js/state.js')).S.status === 'online');
    const code = await host.evaluate(async () => (await import('/js/state.js')).S.code);
    await guest.fill('#nameIn', 'Guest'); await guest.fill('#codeIn', code); await guest.click('#joinBtn');
    await waitFor(host, async () => (await import('/js/state.js')).S.players.length === 2);
    await host.click('#startBtn');
    await Promise.all([host, guest].map(pickNew));
    for (const page of [host, guest]) await (await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
    const teleport = (page, scene) => page.evaluate(async (scene) => {
      const { island, G, zoneAt, solidTile } = await import('/games/island-map.js'), { TILE: T } = await import('/games/island-data.js');
      const { debug } = await import('/games/island.js'), m = island();
      const all = [...debug.world.players.values()];
      const ok = (x, y) => !solidTile(x, y, {}) && !solidTile(x + 1, y, {}) && !solidTile(x, y + 1, {});
      let best = null;
      if (scene === 'shore') { let top = 0; for (let y = 3; y < 97; y++) for (let x = 3; x < 125; x++) { if (m.ground[y * 160 + x] !== G.SAND || !ok(x, y)) continue; let w = 0; for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const g = m.ground[(y + dy) * 160 + x + dx]; if (g === G.SEA || g === G.SHALLOW) w++; } if (w > top) { top = w; best = [x, y]; } } }
      else if (scene === 'peak') { for (let y = 3; y < 97 && !best; y++) for (let x = 3; x < 125; x++) if (zoneAt((x + 0.5) * T, (y + 0.5) * T) === 'peak' && ok(x, y)) { best = [x, y]; break; } }
      if (best) all.forEach((p, i) => { p.body.x = (best[0] + 0.5 + i) * T; p.body.y = (best[1] + 0.5) * T; });
      return !!best || scene === 'village';
    }, scene);
    const walk = async (page, ms) => { // wander in a square, attacking now and then
      const end = Date.now() + ms;
      while (Date.now() < end) for (const k of ['KeyD', 'KeyS', 'KeyA', 'KeyW']) { await page.keyboard.down(k); await wait(500); if (Math.random() < 0.5) await page.keyboard.press('KeyJ'); await page.keyboard.up(k); if (Date.now() > end) break; }
    };
    await Promise.all([walk(host, 6000), walk(guest, 6000)]); // warm-up: sprites, chunks and the JIT settle first
    for (const mode of effects) {
      for (const scene of scenes) {
        for (const page of [host, guest]) await page.evaluate(async (mode) => { (await import('/games/island-view.js')).setEffects?.(mode); }, mode);
        if (!(await teleport(host, scene))) console.log(`note: no spot found for ${scene}`);
        await wait(1500); // chunks and sprites for the new place get drawn once
        for (const page of [host, guest]) await page.evaluate(() => { window.__ft = []; window.__tx = 0; });
        const t0 = Date.now();
        await Promise.all([walk(host, SECONDS * 1000), walk(guest, SECONDS * 1000)]);
        const secs = (Date.now() - t0) / 1000;
        const grab = (page) => page.evaluate(() => ({ ft: window.__ft, tx: window.__tx, heap: performance.memory?.usedJSHeapSize || 0 }));
        const [h, g] = [await grab(host), await grab(guest)];
        const worst = (a, b, p) => Math.max(pct(a, p), pct(b, p));
        results.push({
          size: sizeName, scene, effects: mode, throttle: THROTTLE, seconds: round(secs), frames: h.ft.length,
          p50: round(worst(h.ft, g.ft, 0.5)), p95: round(worst(h.ft, g.ft, 0.95)), hostP95: round(pct(h.ft, 0.95)), guestP95: round(pct(g.ft, 0.95)),
          heapMB: round(Math.max(h.heap, g.heap) / 1048576),
          // the host sends to the one remote explorer; "per player" is that rate
          bytesPerPlayerPerSec: Math.round(h.tx / secs / 1),
          guestBytesPerSec: Math.round(g.tx / secs),
        });
        console.log(`${sizeName} ${scene} ${mode}: p50 ${results.at(-1).p50} ms, p95 ${results.at(-1).p95} ms, heap ${results.at(-1).heapMB} MB, ${results.at(-1).bytesPerPlayerPerSec} B/s per player`);
      }
    }
    for (const c of env.contexts.splice(0)) await c.close();
  }
} finally { await env.close(); }

const phone = results.filter((r) => r.size === 'phone' && r.effects === effects[0]);
const over = phone.filter((r) => r.p95 > BUDGET);
await fs.writeFile(new URL('perf-island.json', out), JSON.stringify({ when: new Date().toISOString(), budgetP95Ms: BUDGET, cpuThrottle: THROTTLE, results }, null, 1));
const md = [`# Creature Island performance`, '', `Chromium, ${THROTTLE}x CPU throttling, two live explorers over WebRTC, ${SECONDS} s per scene. Budget: p95 frame time <= ${BUDGET} ms on the throttled phone.`, '',
  '| size | scene | effects | p50 ms | p95 ms | heap MB | bytes/s per player |', '|---|---|---|---|---|---|---|',
  ...results.map((r) => `| ${r.size} | ${r.scene} | ${r.effects} | ${r.p50} | ${r.p95}${r.size === 'phone' && r.effects === effects[0] && r.p95 > BUDGET ? ' (over budget)' : ''} | ${r.heapMB} | ${r.bytesPerPlayerPerSec} |`), '',
  over.length ? `**FAILED**: p95 over ${BUDGET} ms on the throttled phone in ${over.map((r) => r.scene).join(', ')}.` : phone.length ? `Within budget on the throttled phone.` : `Desktop measurements only; phone budgets are checked in the phone jobs.`, ''].join('\n');
await fs.writeFile(new URL('perf-island.md', out), md);
console.log('\n' + md);
process.exit(over.length ? 1 : 0);
