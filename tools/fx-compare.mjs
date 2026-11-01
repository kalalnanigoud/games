// Pixel check for the "Lower effects" setting: renders Creature Island at fixed virtual times with a seeded
// Math.random (animation frames are stepped by hand), in the village, on the shore and on the stormy peak, and
// writes each canvas as a PNG plus a SHA-256 of its pixels. Run it before and after a drawing change and
// compare: node tools/fx-compare.mjs --save before.json ; node tools/fx-compare.mjs --expect before.json
// (--effects low renders the lowered version, for looking at it; it is not expected to match.)
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startEnv, pickNew, wait, out } from './island-harness.mjs';

const arg = (k) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : null; };
const mode = arg('effects') || 'normal';
const init = () => {
  let vt = 5000, queue = [], seed = 12345;
  performance.now = () => vt;
  Math.random = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  window.requestAnimationFrame = (cb) => queue.push(cb);
  window.cancelAnimationFrame = () => {};
  window.__step = (dt) => { vt += dt; const q = queue; queue = []; for (const cb of q) cb(vt); };
  window.Worker = class { constructor() { throw Error('no workers: the page timer runs the world'); } };
};
const env = await startEnv();
const hashes = {};
try {
  const browser = await chromium.launch();
  env.browsers.push(browser);
  for (const [name, size] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 760 }]]) {
    const page = await env.open(browser, { viewport: size, deviceScaleFactor: 1 }, init);
    await page.addInitScript((m) => localStorage.setItem('gn-island-effects', m), mode);
    await page.evaluate((m) => localStorage.setItem('gn-island-effects', m), mode);
    await page.fill('#nameIn', 'Solo'); await page.click('[data-local="island"]'); await page.click('#startBtn');
    await pickNew(page);
    const frames = async (n) => { for (let i = 0; i < n; i++) { await page.evaluate(() => window.__step(100)); await wait(45); } };
    for (const scene of ['village', 'shore', 'peak']) {
      await page.evaluate(async (scene) => {
        const { island, G, zoneAt, solidTile } = await import('/games/island-map.js'), { TILE: T } = await import('/games/island-data.js');
        const { debug } = await import('/games/island.js'), m = island();
        const ok = (x, y) => !solidTile(x, y, {}) && !solidTile(x + 1, y, {}) && !solidTile(x, y + 1, {});
        let best = null;
        if (scene === 'shore') { let top = 0; for (let y = 3; y < 97; y++) for (let x = 3; x < 125; x++) { if (m.ground[y * 160 + x] !== G.SAND || !ok(x, y)) continue; let w = 0; for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const g = m.ground[(y + dy) * 160 + x + dx]; if (g === G.SEA || g === G.SHALLOW) w++; } if (w > top) { top = w; best = [x, y]; } } }
        else if (scene === 'peak') { for (let y = 3; y < 97 && !best; y++) for (let x = 3; x < 125; x++) if (zoneAt((x + 0.5) * T, (y + 0.5) * T) === 'peak' && ok(x, y)) { best = [x, y]; break; } }
        if (best) for (const p of debug.world.players.values()) { p.body.x = (best[0] + 0.5) * T; p.body.y = (best[1] + 0.5) * T; }
      }, scene);
      await frames(12);
      const url = await page.evaluate(() => document.querySelector('.isl-canvas').toDataURL('image/png'));
      const buf = Buffer.from(url.split(',')[1], 'base64');
      hashes[`${name}-${scene}`] = crypto.createHash('sha256').update(buf).digest('hex');
      await fs.writeFile(new URL(`fx-${mode}-${name}-${scene}.png`, out), buf);
    }
    await page.context().close();
  }
} finally { await env.close(); }
console.log(JSON.stringify(hashes, null, 1));
if (arg('save')) await fs.writeFile(arg('save'), JSON.stringify(hashes, null, 1));
if (arg('expect')) {
  const want = JSON.parse(await fs.readFile(arg('expect'), 'utf8'));
  const bad = Object.keys(want).filter((k) => want[k] !== hashes[k]);
  console.log(bad.length ? `DIFFERENT: ${bad.join(', ')}` : 'PASS pixel-identical to the saved render');
  process.exit(bad.length ? 1 : 0);
}
