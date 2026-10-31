// Draws the app icons and the link-preview image in the site's style:
//   icons/icon.svg (favicon), icons/icon-180.png (iPhone), icons/icon-192.png and icon-512.png (Android, maskable),
//   icons/og-image.jpg (1200x630: what WhatsApp, Messenger and others show for a shared room link).
//   node tools/build-art.mjs            needs a browser: Playwright's Chromium, or set CHROME_PATH
// The preview uses the pre-rendered covers (run tools/build-covers.mjs first).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const icons = path.join(root, 'icons');

// The logo mark: a violet-to-blue dice tile with a gold centre pip (as in the site's header).
const MARK = (x, y, s) => `
  <defs><linearGradient id="mk" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b6cff"/><stop offset="1" stop-color="#4cb8ff"/></linearGradient></defs>
  <rect x="${x}" y="${y}" width="${s}" height="${s}" rx="${s * 0.29}" fill="url(#mk)"/>
  <rect x="${x}" y="${y}" width="${s}" height="${s / 2}" rx="${s * 0.29}" fill="#fff" opacity=".12"/>
  ${[[0.3, 0.3, 1], [0.7, 0.7, 1], [0.7, 0.3, 0.6], [0.3, 0.7, 0.6]].map(([px, py, o]) => `<circle cx="${x + s * px}" cy="${y + s * py}" r="${s * 0.083}" fill="#fff" opacity="${o}"/>`).join('')}
  <circle cx="${x + s / 2}" cy="${y + s / 2}" r="${s * 0.09}" fill="#ffcf5c"/>`;

// Favicon: the mark alone, crisp at any size.
fs.writeFileSync(path.join(icons, 'icon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${MARK(16, 16, 480)}</svg>\n`);
// App icon: the mark on deep navy, inside the safe zone that round Android masks keep.
const APP_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs><radialGradient id="bg" cx=".5" cy=".38" r=".75"><stop offset="0" stop-color="#26306f"/><stop offset=".6" stop-color="#121a3f"/><stop offset="1" stop-color="#0a1024"/></radialGradient>
  <radialGradient id="glow"><stop offset="0" stop-color="#7c6cff" stop-opacity=".55"/><stop offset="1" stop-color="#7c6cff" stop-opacity="0"/></radialGradient>
  <radialGradient id="shade"><stop offset="0" stop-color="#000" stop-opacity=".45"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs>
  <rect width="512" height="512" fill="url(#bg)"/><circle cx="256" cy="240" r="210" fill="url(#glow)"/>
  <ellipse cx="256" cy="402" rx="150" ry="26" fill="url(#shade)"/>
  ${MARK(111, 106, 290)}
</svg>`;

const port = 8121;
const server = spawn(process.execPath, ['serve.js'], { cwd: root, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' }, stdio: 'ignore' });
const base = `http://127.0.0.1:${port}`;
for (let i = 0; i < 60; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
try {
  for (const size of [180, 192, 512]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<body style="margin:0;background:#0a1024">${APP_ICON.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`);
    await page.screenshot({ path: path.join(icons, `icon-${size}.png`), clip: { x: 0, y: 0, width: size, height: size } });
    await page.close();
    console.log(`icons/icon-${size}.png`);
  }
  // Link preview: headline beside a fan of game covers.
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'covers/manifest.json'), 'utf8'));
  const fan = ['sketch', 'bluff', 'gems', 'keeper'].map((id) => manifest[id]?.file).filter(Boolean);
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.goto(base + '/tools/browser-test.html'); // site stylesheet and fonts
  await page.evaluate(({ mark, fan }) => {
    document.body.innerHTML = `
      <div id="og" style="position:fixed;inset:0;width:1200px;height:630px;overflow:hidden;font-family:var(--font-body);color:#eef1ff;
        background:radial-gradient(700px 420px at 12% 0%,rgba(124,108,255,.35),transparent 70%),radial-gradient(640px 420px at 100% 100%,rgba(76,184,255,.22),transparent 70%),#0a1024">
        <div style="position:absolute;left:72px;top:70px;width:560px">
          <div style="display:flex;align-items:center;gap:16px;font-family:var(--font-display);font-weight:700;font-size:34px">
            <svg viewBox="0 0 512 512" width="64" height="64">${mark}</svg>Game Night</div>
          <h1 style="font-family:var(--font-display);font-weight:700;font-size:82px;line-height:1.02;margin:46px 0 22px">Game night,<br>
            <span style="background:linear-gradient(90deg,#ffcf5c,#ff6fae 55%,#4cb8ff);-webkit-background-clip:text;background-clip:text;color:transparent">anywhere.</span></h1>
          <p style="font-size:29px;line-height:1.35;color:#c3cbea;margin:0 0 30px">Party games, strategy and co-op adventures. Tap the link to join my table.</p>
          <div style="display:flex;gap:12px;font-weight:800;font-size:20px">
            ${['Free', 'No sign-up', 'Phone or computer'].map((t) => `<span style="padding:8px 18px;border-radius:999px;background:rgba(255,255,255,.07);border:1px solid rgba(150,172,255,.3)">${t}</span>`).join('')}</div>
        </div>
        ${fan.map((f, i) => {
          const pos = [[735, 70, -9], [905, 120, 7], [705, 330, 5], [890, 350, -6]][i];
          return `<img src="/covers/${f}" style="position:absolute;left:${pos[0]}px;top:${pos[1]}px;width:300px;height:188px;object-fit:cover;border-radius:22px;
            transform:rotate(${pos[2]}deg);border:3px solid rgba(255,255,255,.18);box-shadow:0 24px 50px rgba(0,0,0,.55)">`;
        }).join('')}
      </div>`;
  }, { mark: MARK(16, 16, 480), fan });
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map((i) => i.decode().catch(() => {}))); });
  await page.waitForTimeout(200);
  await page.locator('#og').screenshot({ path: path.join(icons, 'og-image.jpg'), type: 'jpeg', quality: 88 });
  console.log('icons/og-image.jpg');
} finally { await browser.close(); server.kill(); }
process.exit(0);
