// Headless browser checks, run on GitHub after every push (see .github/workflows/test.yml):
//   npm ci && npx playwright install chromium && node tools/browser-ci.mjs
// Starts the local server, then at phone and desktop widths:
//   - loads the home page and checks it shows every game without errors,
//   - starts a one-device game against computer players,
//   - runs tools/render-audit.js for every game (render crashes, sideways overflow, tiny buttons).
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CATALOG } from '../games/catalog.js';
import fs from 'node:fs/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const PORT = 8099, base = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, ['serve.js'], { cwd: root, env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' }, stdio: 'inherit' });
const stop = (code) => { server.kill(); process.exit(code); };
for (let i = 0; i < 50; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }

const { chromium } = await import('playwright');
const browser = await chromium.launch();
await fs.mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
let failed = false;
const fail = (msg) => { failed = true; console.error('FAIL ' + msg); };

for (const [label, viewport] of [['phone', { width: 375, height: 812 }], ['desktop', { width: 1280, height: 900 }]]) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/peerjs|unpkg|jsdelivr|fonts\.g/i.test(m.text())) errors.push(m.text()); });
  await page.route(/https:\/\/(unpkg\.com|cdn\.jsdelivr\.net)\/.*peerjs.*\.js/, route => route.fulfill({ contentType: 'text/javascript', path: fileURLToPath(new URL('../node_modules/peerjs/dist/peerjs.min.js', import.meta.url)) }));
  await page.route(/https:\/\/fonts\./, route => route.fulfill({ contentType: 'text/css', body: '' }));

  await page.goto(base + '/', { waitUntil: 'networkidle' });
  const cards = await page.locator('.game-card').count();
  if (cards !== CATALOG.length) fail(`${label}: home page shows ${cards} games, expected ${CATALOG.length}`);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (wide > 1) fail(`${label}: home page scrolls sideways by ${wide}px`);
  await page.screenshot({ path: fileURLToPath(new URL(`../test-results/library-${label}.png`, import.meta.url)), fullPage: true });

  // One-device game with a computer player: the game's code loads on demand and the board renders.
  await page.evaluate(() => { localStorage.setItem('gn-help-gems', '1'); });
  await page.click('[data-local="gems"]');
  await page.click('[data-kick]');
  await page.click('#botBtn');
  await page.click('#startBtn');
  await page.waitForFunction(() => document.querySelectorAll('#gamebox [class^="gems-"]').length > 5, null, { timeout: 10000 }).catch(() => fail(`${label}: a one-device game did not start`));
  await page.evaluate(() => { sessionStorage.clear(); localStorage.removeItem('gn-session'); });

  // Every game, every player count, every seat (and a spectator).
  await page.goto(base + '/tools/browser-test.html', { waitUntil: 'networkidle' });
  const results = await page.evaluate(async (ids) => {
    globalThis.escapeBotPatience = 0;
    const { seededRandom } = await import('/tools/seed.mjs');
    Math.random = seededRandom('render-ci-v1');
    const { audit } = await import('/tools/render-audit.js');
    return audit(ids, { maxSteps: 1500, every: 25 });
  }, CATALOG.map((g) => g.id));
  await fs.writeFile(new URL(`../test-results/render-${label}.json`, import.meta.url), JSON.stringify(results, null, 2));
  for (const r of results) {
    const where = `${label} ${r.game} ${r.players}p`;
    if (r.crashes.length) fail(`${where}: ${r.crashes.join('; ')}`);
    if (r.overflow.length) fail(`${where}: sideways overflow ${r.overflow[0]}`);
    if (r.smallButtons.length) fail(`${where}: buttons smaller than 30px: ${r.smallButtons.join(', ')}`);
  }
  if (errors.length) fail(`${label}: page errors: ${[...new Set(errors)].slice(0, 5).join(' | ')}`);
  console.log(`${label}: ${results.length} game setups rendered${failed ? '' : ' cleanly'}.`);
  await page.close();
}
await browser.close();
stop(failed ? 1 : 0);
