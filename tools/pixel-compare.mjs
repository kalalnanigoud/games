// Pixel comparison of game boards between two copies of the site (for example the committed version
// and work in progress), to prove a speed change didn't change the look.
//
//   node tools/pixel-compare.mjs shoot <siteDir> <shotsDir> [gameIds...]
//   node tools/pixel-compare.mjs diff <beforeShots> <afterShots> <reportDir>
//
// shoot: plays each game with seeded computer moves to fixed positions and screenshots the board from
// the first seat at phone (375px) and desktop (1280px) widths. Each position is drawn over the previous
// one, as in real play, so a game that redraws only what changed is compared through that path.
// Finite animations are finished and endless ones paused at their start, so shots are repeatable.
// diff: compares matching shots pixel by pixel and writes report.html with before/after/diff images.
// Uses Playwright; set CHROME_PATH to use an installed Chrome instead of Playwright's own browser.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const [mode, a, b, c, ...rest] = process.argv.slice(2);
const launch = () => chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const ALL = ['hexisle', 'gems', 'mosaic', 'bluff', 'chess', 'sketch', 'spies', 'temple', 'ember', 'keeper', 'signal'];
const CHECKPOINTS = [0, 4, 12, 30];
const WIDTHS = { phone: { width: 375, height: 812 }, desktop: { width: 1280, height: 900 } };

async function serve(root) {
  const port = 8150 + Math.floor(Math.random() * 400);
  const server = spawn(process.execPath, ['serve.js'], { cwd: root, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base)).ok) return { base, server }; } catch {} await new Promise((r) => setTimeout(r, 200)); }
  throw Error('server did not start in ' + root);
}

async function shoot(root, out, ids) {
  fs.mkdirSync(out, { recursive: true });
  const { base, server } = await serve(path.resolve(root));
  const browser = await launch();
  try {
    for (const id of ids) for (const [label, viewport] of Object.entries(WIDTHS)) {
      const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
      await page.route(/https:\/\/fonts\./, (route) => route.fulfill({ contentType: 'text/css', body: '' }));
      await page.goto(base + '/tools/browser-test.html');
      const count = await page.evaluate(async ({ id, checkpoints }) => {
        globalThis.escapeBotPatience = 0;
        const { seededRandom } = await import('/tools/seed.mjs');
        Math.random = seededRandom('pixel:' + id);
        const g = (await import(`/games/${id}.js`)).default;
        const n = id === 'spies' ? 4 : Math.max(2, g.minPlayers);
        const players = Array.from({ length: n }, (_, i) => ({ id: 'P' + i, name: 'Player ' + (i + 1) }));
        const clone = (x) => JSON.parse(JSON.stringify(x));
        let s = g.setup(players, Object.fromEntries((g.options || []).map((o) => [o.id, o.default])));
        const states = [];
        for (let step = 0; step <= checkpoints.at(-1); step++) {
          if (checkpoints.includes(step)) states.push(clone(s));
          if (s.over) { while (states.length < checkpoints.length) states.push(clone(s)); break; }
          const due = g.turnOf(s); if (!due.length) break;
          const pid = due[0];
          const action = g.bot(clone(g.view ? g.view(s, pid) : s), pid);
          const next = clone(s); g.act(next, pid, action); s = next;
        }
        document.querySelector('main').style.display = 'none';
        const app = document.createElement('main'); app.id = 'app'; document.body.appendChild(app);
        app.innerHTML = `<div id="gamebox" data-game="${id}"></div>`;
        const ctx = { me: 'P0', players, name: (x) => players.find((p) => p.id === x)?.name || '?', isBot: (x) => x !== 'P0', send: () => {}, isHost: true, local: false };
        window.__shot = (i) => {
          const box = document.querySelector('#gamebox');
          g.render(box, clone(g.view ? g.view(states[i], 'P0') : states[i]), ctx);
          document.querySelectorAll('.modal-bg').forEach((m) => { if (!box.contains(m)) m.remove(); });
          for (const anim of document.getAnimations()) {
            try { if (anim.effect?.getComputedTiming?.().iterations === Infinity) { anim.pause(); anim.currentTime = 0; } else anim.finish(); } catch {}
          }
          window.scrollTo(0, 0);
        };
        // Some games run their own timed sequences (Mosaic's tiling); wait for those to end.
        window.__busy = () => { try { return !!g.isAnimating?.(); } catch { return false; } };
        return states.length;
      }, { id, checkpoints: CHECKPOINTS });
      for (let i = 0; i < count; i++) {
        await page.evaluate((i) => window.__shot(i), i);
        for (let t = 0; t < 120 && (await page.evaluate(() => window.__busy())); t++) await page.waitForTimeout(100);
        await page.evaluate(() => { for (const anim of document.getAnimations()) { try { if (anim.effect?.getComputedTiming?.().iterations === Infinity) { anim.pause(); anim.currentTime = 0; } else anim.finish(); } catch {} } });
        await page.waitForTimeout(120);
        await page.locator('#gamebox').screenshot({ path: path.join(out, `${id}-${label}-${CHECKPOINTS[i]}.png`), animations: 'disabled' });
      }
      await page.close();
      console.log(`shot ${id} ${label}: ${count} positions`);
    }
  } finally { await browser.close(); server.kill(); }
}

async function diff(before, after, report) {
  fs.mkdirSync(report, { recursive: true });
  const names = fs.readdirSync(before).filter((f) => f.endsWith('.png')).sort();
  const browser = await launch();
  const page = await browser.newPage();
  const rows = [];
  for (const name of names) {
    const bFile = path.join(before, name), aFile = path.join(after, name);
    if (!fs.existsSync(aFile)) { rows.push({ name, missing: true }); continue; }
    const res = await page.evaluate(async ({ bData, aData }) => {
      const load = (src) => new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = src; });
      const [bi, ai] = await Promise.all([load(bData), load(aData)]);
      const w = Math.max(bi.width, ai.width), h = Math.max(bi.height, ai.height);
      const px = (im) => { const cv = new OffscreenCanvas(w, h); const cx = cv.getContext('2d'); cx.drawImage(im, 0, 0); return cx.getImageData(0, 0, w, h).data; };
      const B = px(bi), A = px(ai);
      const out = new OffscreenCanvas(w, h), ox = out.getContext('2d'), img = ox.createImageData(w, h);
      let changed = 0;
      for (let i = 0; i < B.length; i += 4) {
        const d = Math.max(Math.abs(B[i] - A[i]), Math.abs(B[i + 1] - A[i + 1]), Math.abs(B[i + 2] - A[i + 2]), Math.abs(B[i + 3] - A[i + 3]));
        const g = (B[i] + B[i + 1] + B[i + 2]) / 3 * 0.35;
        if (d > 24) { changed++; img.data.set([255, 40, 90, 255], i); } else img.data.set([g, g, g, 255], i);
      }
      ox.putImageData(img, 0, 0);
      const blob = await out.convertToBlob({ type: 'image/png' });
      const diffData = await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(blob); });
      return { changedPct: +(changed / (w * h) * 100).toFixed(3), size: [bi.width, bi.height, ai.width, ai.height], diffData };
    }, { bData: 'data:image/png;base64,' + fs.readFileSync(bFile).toString('base64'), aData: 'data:image/png;base64,' + fs.readFileSync(aFile).toString('base64') });
    const diffName = name.replace('.png', '.diff.png');
    fs.writeFileSync(path.join(report, diffName), Buffer.from(res.diffData.split(',')[1], 'base64'));
    fs.copyFileSync(bFile, path.join(report, name.replace('.png', '.before.png')));
    fs.copyFileSync(aFile, path.join(report, name.replace('.png', '.after.png')));
    rows.push({ name, changedPct: res.changedPct, sameSize: res.size[0] === res.size[2] && res.size[1] === res.size[3], size: res.size, diffName });
  }
  await browser.close();
  fs.writeFileSync(path.join(report, 'summary.json'), JSON.stringify(rows, null, 2));
  const cell = (f) => `<img src="${f}" loading="lazy">`;
  fs.writeFileSync(path.join(report, 'report.html'), `<!doctype html><meta charset="utf-8"><title>Pixel comparison</title>
<style>body{background:#0a1024;color:#eef1ff;font:14px system-ui;margin:20px}table{border-collapse:collapse}td{vertical-align:top;padding:6px;border-top:1px solid #253}img{max-width:340px;display:block}.bad{color:#ff8fa3}.ok{color:#9ff3cf}</style>
<h1>Pixel comparison</h1><p>Red pixels in the diff column differ by more than 24/255 in some colour channel.</p><table>
<tr><th>Shot</th><th>Before</th><th>After</th><th>Diff</th></tr>
${rows.map((r) => r.missing ? `<tr><td class="bad">${r.name}: missing after</td></tr>` : `<tr><td class="${r.changedPct > 0.5 || !r.sameSize ? 'bad' : 'ok'}">${r.name}<br>${r.changedPct}% changed${r.sameSize ? '' : '<br>size ' + r.size.join('×')}</td><td>${cell(r.name.replace('.png', '.before.png'))}</td><td>${cell(r.name.replace('.png', '.after.png'))}</td><td>${cell(r.diffName)}</td></tr>`).join('')}
</table>`);
  const worst = rows.filter((r) => !r.missing).sort((x, y) => y.changedPct - x.changedPct).slice(0, 8);
  console.log(JSON.stringify({ shots: rows.length, missing: rows.filter((r) => r.missing).length, over05pct: rows.filter((r) => r.changedPct > 0.5 || r.sameSize === false).length, worst: worst.map((r) => `${r.name} ${r.changedPct}%${r.sameSize ? '' : ' (size differs)'}`) }));
}

if (mode === 'shoot') await shoot(a, b, [c, ...rest].filter(Boolean).length ? [c, ...rest].filter(Boolean) : ALL);
else if (mode === 'diff') await diff(a, b, c);
else { console.log('usage: shoot <siteDir> <shotsDir> [games...] | diff <beforeShots> <afterShots> <reportDir>'); process.exitCode = 1; }
