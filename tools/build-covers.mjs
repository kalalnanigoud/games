// Renders every game's cover art once into an image (covers/<id>-<hash>.webp), so pages show a picture
// instead of redrawing a complex illustration on the phone. Run after changing a cover:
//   node tools/build-covers.mjs            (then node tools/build-catalog.mjs)
// Needs a browser: Playwright's Chromium, or set CHROME_PATH to an installed Chrome.
// The image is the same artwork drawn by Chrome at 3x (960x600) with the site's styles and fonts;
// pages crop it the same way the live illustration was cropped (centred, "cover").
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { GAMES } from '../games/index.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const dir = path.join(root, 'covers');
fs.mkdirSync(dir, { recursive: true });
export const coverHash = (svg) => crypto.createHash('sha256').update(String(svg).replace(/\r\n/g, '\n')).digest('hex').slice(0, 10);
const manifestFile = path.join(dir, 'manifest.json');
const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : {};
const todo = GAMES.filter((g) => g.cover && !(manifest[g.id]?.hash === coverHash(g.cover) && fs.existsSync(path.join(dir, manifest[g.id].file))));
if (!todo.length) { console.log('Covers are up to date.'); process.exit(0); }

const port = 8120;
const server = spawn(process.execPath, ['serve.js'], { cwd: root, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' }, stdio: 'ignore' });
const base = `http://127.0.0.1:${port}`;
for (let i = 0; i < 60; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
try {
  const page = await browser.newPage({ viewport: { width: 320, height: 200 }, deviceScaleFactor: 3 });
  await page.goto(base + '/tools/browser-test.html'); // the site's stylesheet and fonts
  for (const g of todo) {
    await page.evaluate((svg) => {
      document.body.innerHTML = `<div id="art" style="position:fixed;inset:0;width:320px;height:200px;overflow:hidden;background:#0a1024">${svg}</div>`;
      const el = document.querySelector('#art > svg');
      el.setAttribute('width', '320'); el.setAttribute('height', '200');
      el.setAttribute('preserveAspectRatio', 'xMidYMid slice');
      el.style.cssText = 'display:block;width:320px;height:200px';
    }, g.cover);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    const png = await page.locator('#art').screenshot({ type: 'png' });
    // Re-encode in the page as WebP (about a fifth of the PNG's size, no visible loss at this quality).
    const webp = await page.evaluate(async (b64) => {
      const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode();
      const cv = new OffscreenCanvas(im.width, im.height); cv.getContext('2d').drawImage(im, 0, 0);
      const blob = await cv.convertToBlob({ type: 'image/webp', quality: 0.9 });
      return new Uint8Array(await blob.arrayBuffer()).reduce((s, x) => s + String.fromCharCode(x), '');
    }, png.toString('base64'));
    const hash = coverHash(g.cover), file = `${g.id}-${hash}.webp`;
    if (manifest[g.id]?.file && manifest[g.id].file !== file) fs.rmSync(path.join(dir, manifest[g.id].file), { force: true });
    fs.writeFileSync(path.join(dir, file), Buffer.from(webp, 'latin1'));
    manifest[g.id] = { hash, file, width: 960, height: 600 };
    console.log(`cover ${g.id}: ${file} (${Math.round(Buffer.byteLength(webp, 'latin1') / 1024)} KB)`);
  }
} finally { await browser.close(); server.kill(); }
fs.writeFileSync(manifestFile, JSON.stringify(Object.fromEntries(Object.entries(manifest).sort()), null, 2) + '\n');
console.log('Wrote covers/manifest.json. Now run node tools/build-catalog.mjs.');
process.exit(0);
