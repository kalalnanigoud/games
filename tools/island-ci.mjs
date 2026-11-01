// Creature Island in real browsers: four explorers over real PeerJS/WebRTC (a local broker, no internet),
// one of them on a phone-sized touch screen. Everyone moves at once and every screen agrees with the host;
// a fifth person watches until a seat frees; a reload gets the same explorer back; a cloud save goes
// through the real save Worker (on a local database); the leave prompt guards unsaved progress.
//   node tools/island-ci.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright';
import worker from '../server/island-saves.js';
import { fakeD1 } from './fake-d1.mjs';
const require = createRequire(import.meta.url);
const { createServer } = require('../serve.js');
const root = fileURLToPath(new URL('../', import.meta.url));
const server = createServer(root);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const broker = fork(fileURLToPath(new URL('./peer-test-server.mjs', import.meta.url)), [], { cwd: root, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
const brokerPort = await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(Error('broker did not start')), 20000);
  broker.once('message', (m) => { clearTimeout(t); resolve(m.port); });
});
const out = new URL('../test-results/', import.meta.url);
await fs.mkdir(out, { recursive: true });
const peerSource = await fs.readFile(new URL('../node_modules/peerjs/dist/peerjs.min.js', import.meta.url), 'utf8');
const localPeer = peerSource + `\n;{const Original=globalThis.Peer;globalThis.Peer=class extends Original{constructor(id,opts){if(id&&typeof id==='object'){opts=id;id=undefined;}super(id,{...opts,host:'127.0.0.1',port:${brokerPort},path:'/',secure:false,config:{iceServers:[]}});}};}`;

// The save service: the real Worker on an in-memory SQLite database dressed as Cloudflare D1.
const db = new DatabaseSync(':memory:');
const D1 = fakeD1(db);
const CONFIG = (await fs.readFile(new URL('../js/config.js', import.meta.url), 'utf8'));
const saveUrl = /islandSaves:\s*'([^']+)'/.exec(CONFIG)?.[1] || 'https://island-saves.test';

const errors = [], contexts = [];
let browser, saveDelay = 0, saveFail = false;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(page, fn, arg, timeout = 20000) {
  const end = Date.now() + timeout;
  do { if (await page.evaluate(fn, arg).catch(() => false)) return; await wait(120); } while (Date.now() < end);
  throw Error('Timed out: ' + fn.toString().slice(0, 160));
}
async function open(opts = {}) {
  const context = await browser.newContext(opts);
  contexts.push(context);
  await context.route(/https:\/\/(unpkg\.com|cdn\.jsdelivr\.net)\/.*peerjs.*\.js/, (r) => r.fulfill({ contentType: 'text/javascript', body: localPeer }));
  await context.route(/https:\/\/fonts\./, (r) => r.abort());
  await context.route(saveUrl.replace(/\/+$/, '') + '/**', async (route) => {
    const req = route.request();
    if (saveDelay && req.method() === 'PUT') await wait(saveDelay); // [save-flows] a slow save, for the Escape test
    if (saveFail && req.method() === 'PUT') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'storage', message: 'The save service could not reach its storage. It may have reached its free daily limit. Your game is still running: try again later.' }) });
    const res = await worker.fetch(new Request(req.url(), { method: req.method(), headers: req.headers(), body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method()) ? undefined : req.postData() }), { DB: D1, PIN_PEPPER: 'ci-pepper' });
    route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) });
  });
  await context.addInitScript(() => localStorage.setItem('gn-help-island', '1'));
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(base);
  return page;
}
const S = (page) => page.evaluate(async () => { const { S } = await import('/js/state.js'); return { token: S.token, code: S.code, players: S.players, started: S.started, status: S.status }; });
const islandReady = (page) => waitFor(page, async () => { const m = await import('/games/island.js'); return !!m.debug.client?.state.ready; });
// The start screen's explorer account: create one with a name and a 4-digit PIN.
const signUpOn = async (page, name, pin) => {
  await page.waitForSelector('[data-acct-form]');
  await page.click('[data-acct="mode-create"]');
  await page.fill('[name="acctName"]', name);
  await page.fill('[name="acctPin"]', pin);
  await page.fill('[name="acctPin2"]', pin);
  await page.click('[data-acct-form] button[type="submit"]');
  // A new account shows its recovery code once; it stays until "I've saved it".
  await page.waitForSelector('.isl-code');
  const code = (await page.textContent('.isl-code')).trim();
  assert.match(code, /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/, 'the recovery code looks like K7QM-2XPA-9TNE');
  await page.click('[data-code-done]');
  await page.waitForSelector('.isl-pick .isl-acct.signed');
  assert.equal(await page.locator('.isl-code').count(), 0, 'the code is not shown again');
  return code;
};
const pick = async (page) => {
  await page.waitForSelector('.isl-pick [data-pick="new"]');
  await page.click('.isl-pick [data-pick="new"]');
  await islandReady(page);
};

try {
  // Four players share one browser here: keep pages that aren't in front animating at full speed.
  browser = await chromium.launch({ args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
  const host = await open({ viewport: { width: 1280, height: 760 } });
  const phone = await open({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const g2 = await open({ viewport: { width: 1024, height: 700 } });
  const g3 = await open({ viewport: { width: 1024, height: 700 } });
  await host.fill('#nameIn', 'Host'); await host.click('[data-host="island"]');
  await waitFor(host, async () => (await import('/js/state.js')).S.status === 'online');
  const code = (await S(host)).code;
  for (const [p, name] of [[phone, 'Phone'], [g2, 'Bea'], [g3, 'Cy']]) { await p.fill('#nameIn', name); await p.fill('#codeIn', code); await p.click('#joinBtn'); }
  await waitFor(host, async () => (await import('/js/state.js')).S.players.length === 4);
  await host.click('#startBtn');
  await signUpOn(phone, 'Phone Explorer', '4826');
  // Without an account: a clear note that nothing is kept, and no file option anywhere.
  await host.waitForSelector('.isl-pick');
  const pickText = await host.innerText('.isl-pick');
  assert.match(pickText, /Nothing is kept without an account/);
  assert.ok(!/file/i.test(pickText) && await host.locator('.isl-pick input[type="file"]').count() === 0, 'no file saves on the start screen');
  await Promise.all([host, phone, g2, g3].map(pick));
  const hw = () => host.evaluate(async () => { const { debug } = await import('/games/island.js'); return [...debug.world.players.values()].map((p) => ({ id: p.id, ready: p.ready, x: p.body.x, y: p.body.y, seat: p.seat })); });
  let players = await hw();
  assert.equal(players.length, 4);
  assert.ok(players.every((p) => p.ready), 'four explorers are on the island');
  assert.deepEqual(players.map((p) => p.seat).sort(), [0, 1, 2, 3], 'each has their own colour');
  console.log('PASS four explorers join one island');

  // Everyone moves at the same time, in different directions.
  const before = Object.fromEntries(players.map((p) => [p.id, p]));
  const ids = Object.fromEntries(await Promise.all([['host', host], ['phone', phone], ['g2', g2], ['g3', g3]].map(async ([k, p]) => [k, (await S(p)).token])));
  const hold = async (page, key, ms) => { await page.keyboard.down(key); await wait(ms); await page.keyboard.up(key); };
  const box = await phone.locator('.isl-stickzone').boundingBox();
  await Promise.all([
    hold(host, 'KeyD', 1400), hold(g2, 'KeyA', 1400), hold(g3, 'KeyW', 1400),
    (async () => { // the phone uses the on-screen stick
      const x = box.x + box.width * 0.4, y = box.y + box.height * 0.6;
      await phone.mouse.move(x, y); await phone.mouse.down(); await phone.mouse.move(x, y + 60, { steps: 4 }); await wait(1400); await phone.mouse.up();
    })(),
  ]);
  await wait(700);
  players = await hw();
  const moved = (k) => { const p = players.find((q) => q.id === ids[k]), b = before[ids[k]]; return [p.x - b.x, p.y - b.y]; };
  assert.ok(moved('host')[0] > 80, `host moved right ${moved('host')}`);
  assert.ok(moved('g2')[0] < -80, `Bea moved left ${moved('g2')}`);
  assert.ok(moved('g3')[1] < -80, `Cy moved up ${moved('g3')}`);
  assert.ok(moved('phone')[1] > 60, `the phone player moved down with the stick ${moved('phone')}`);
  // Each screen's own explorer agrees with the host, and each sees the others where the host has them.
  for (const [k, page] of [['phone', phone], ['g2', g2], ['g3', g3]]) {
    const mine = await page.evaluate(async () => { const { debug } = await import('/games/island.js'); const b = debug.client.state.body; return { x: b.x, y: b.y }; });
    const truth = players.find((q) => q.id === ids[k]);
    assert.ok(Math.hypot(mine.x - truth.x, mine.y - truth.y) < 24, `${k}: own position matches the host (${Math.round(mine.x - truth.x)}, ${Math.round(mine.y - truth.y)})`);
  }
  const seen = await g2.evaluate(async (hostId) => { const { debug } = await import('/games/island.js'); const f = debug.client.state.frames.at(-1); const e = f && f.ents.get('p' + hostId); return e ? [e[2], e[3]] : null; }, ids.host);
  const hostNow = players.find((q) => q.id === ids.host);
  assert.ok(seen && Math.hypot(seen[0] - hostNow.x, seen[1] - hostNow.y) < 40, 'others see the host where the host is');
  console.log('PASS four players move at once (keyboard and touch stick) and every screen agrees');

  // How to play opened while walking: the explorer stops, and letting go of the key inside it counts.
  const hostX = () => host.evaluate(async () => (await import('/games/island.js')).debug.client.state.body.x);
  await host.keyboard.down('KeyD');
  await wait(300);
  await host.click('.game-head [data-help="island"]');
  await host.waitForSelector('.modal-bg');
  await host.keyboard.up('KeyD');
  const x1 = await hostX();
  await wait(500);
  const x2 = await hostX();
  assert.ok(Math.abs(x2 - x1) < 4, `the explorer stays put behind the rules (${Math.round(x2 - x1)} px)`);
  assert.deepEqual(await host.evaluate(async () => [...(await import('/games/island.js')).debug.client.state.keys]), [], 'no key is left held');
  await host.keyboard.press('Escape');
  await host.waitForSelector('.modal-bg', { state: 'detached' });
  await wait(300);
  assert.ok(Math.abs((await hostX()) - x2) < 4, 'and doesn’t walk off once the rules close');
  console.log('PASS How to play stops the explorer and never leaves a key held');

  // A fifth person watches; there's no fifth explorer.
  const fifth = await open({ viewport: { width: 800, height: 600 } });
  await fifth.fill('#nameIn', 'Dee'); await fifth.fill('#codeIn', code); await fifth.click('#joinBtn');
  await waitFor(fifth, async () => { const { S } = await import('/js/state.js'); return S.synced && S.started; });
  const fifthState = await S(fifth);
  assert.equal(fifthState.players.find((p) => p.id === fifthState.token)?.watch, true, 'the fifth person watches');
  assert.equal((await hw()).length, 4, 'and gets no explorer');
  await fifth.waitForSelector('.isl-overlay .isl-card:has-text("Watching")');
  console.log('PASS a fifth person watches instead of silently taking a seat');

  // A reload (a dropped connection) gets the same explorer back, not a new one.
  const bea = players.find((q) => q.id === ids.g2);
  await g2.reload();
  await waitFor(g2, async () => { const { S } = await import('/js/state.js'); return S.synced && S.started; }, null, 45000);
  await islandReady(g2);
  assert.equal(await g2.locator('.isl-pick').count(), 0, 'no explorer picker after reconnecting');
  const back = (await hw()).find((q) => q.id === ids.g2);
  assert.ok(Math.hypot(back.x - bea.x, back.y - bea.y) < 40, 'the explorer is where it was');
  console.log('PASS reconnecting returns the same explorer');

  // Saving to the cloud through the menu, only when asked.
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='explorers'").get() ? db.prepare('SELECT COUNT(*) AS n FROM explorers').get().n : 0, 0, 'nothing is saved until someone asks');
  await phone.click('.isl-bagbtn');
  await phone.click('.isl-tabs [data-tab="save"]');
  await phone.click('[data-save="cloud"]');
  await waitFor(phone, async () => { const { debug } = await import('/games/island.js'); return debug.client.state.me && !debug.client.state.me.unsaved; });
  const row = db.prepare('SELECT rev, data FROM explorers').get();
  assert.equal(row.rev, 1);
  assert.equal(JSON.parse(row.data).name, 'Phone');
  console.log('PASS Save adventure stores the explorer in the save service');

  // Another tab saves a newer copy of this explorer. Saving here conflicts; Cancel then Save must conflict
  // again rather than quietly overwrite it, and only "Replace it" does.
  const phoneKey = await phone.evaluate(() => JSON.parse(localStorage.getItem('island-session')).token);
  assert.ok(!(await phone.evaluate(() => JSON.stringify(localStorage))).includes('4826'), 'the PIN is never kept in the browser');
  // Any other device: the same name and PIN bring back the same explorer.
  const login = await worker.fetch(new Request(saveUrl.replace(/\/+$/, '') + '/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'phone explorer', pin: '4826' }) }), { DB: D1, PIN_PEPPER: 'ci-pepper' });
  const other = await login.json();
  const fromElsewhere = await worker.fetch(new Request(saveUrl.replace(/\/+$/, '') + '/explorer', { headers: { authorization: 'Bearer ' + other.token } }), { DB: D1, PIN_PEPPER: 'ci-pepper' });
  assert.equal((await fromElsewhere.json()).data.name, 'Phone', 'signing in elsewhere loads the same explorer');
  console.log('PASS an explorer account (name + PIN) works from any device, and the PIN is never stored');
  const rowNow = () => { const r = db.prepare('SELECT rev, data FROM explorers').get(); return { rev: r.rev, name: JSON.parse(r.data).name }; };
  await wait(2100);
  const elsewhere = await worker.fetch(new Request(saveUrl.replace(/\/+$/, '') + '/explorer', { method: 'PUT', headers: { authorization: 'Bearer ' + phoneKey, 'content-type': 'application/json' }, body: JSON.stringify({ rev: 1, data: { kind: 'island-explorer', v: 1, name: 'Other tab', lv: 9 } }) }), { DB: D1, PIN_PEPPER: 'ci-pepper' });
  assert.equal((await elsewhere.json()).rev, 2);
  await wait(2100);
  await phone.click('[data-save="cloud"]');
  await phone.waitForSelector('[data-save="force"]');
  await phone.click('[data-save="cancel"]');
  await wait(2100);
  await phone.click('[data-save="cloud"]');
  await phone.waitForSelector('[data-save="force"]');
  assert.deepEqual(rowNow(), { rev: 2, name: 'Other tab' }, 'Cancel, then Save again, conflicts again instead of overwriting the newer save');
  await wait(2100);
  await phone.click('[data-save="force"]');
  await waitFor(phone, () => !document.querySelector('[data-save="force"]') && !!document.querySelector('[data-save="cloud"]'));
  assert.deepEqual(rowNow(), { rev: 3, name: 'Phone' }, 'only Replace overwrites it');
  console.log('PASS a save conflict is only overwritten by an explicit Replace');

  // Leaving with unsaved progress asks first; Cancel keeps you on the island.
  await g3.evaluate(async () => { (await import('/js/net.js')).leave(); });
  await g3.waitForSelector('.isl-overlay:has-text("Save before you go?")');
  assert.ok(await g3.locator('[data-leave="signin"]').count() === 1 && !/file/i.test(await g3.innerText('.isl-overlay')), 'without an account the prompt says nothing is kept and offers sign-in, not a file');
  await g3.click('[data-leave="cancel"]');
  assert.ok((await S(g3)).started, 'Cancel keeps playing');
  await g3.evaluate(async () => { (await import('/js/net.js')).leave(); });
  await g3.click('[data-leave="go"]');
  await waitFor(host, async () => { const { debug } = await import('/games/island.js'); return debug.world.players.size === 3; });
  console.log('PASS the leave prompt guards unsaved progress, and leaving frees the seat');
  await fifth.waitForSelector('[data-seat]');
  await fifth.click('[data-seat]');
  await fifth.waitForSelector('.isl-pick [data-pick="new"]');
  await pick(fifth);
  assert.equal((await hw()).length, 4, 'the watcher took the free seat');
  console.log('PASS a watcher takes a freed seat mid-adventure');

  // [save-flows] Cancelling "Save and leave" mid-upload keeps the explorer on the island.
  {
    const phoneId = ids.phone;
    const hostSees = () => host.evaluate(async (id) => { const p = (await import('/games/island.js')).debug.world.players.get(id); return p ? { ready: p.ready, parked: !!p.parked } : null; }, phoneId);
    await host.evaluate(async (id) => { const w = (await import('/games/island.js')).debug.world; w.bump(w.players.get(id), true); }, phoneId);
    await waitFor(phone, async () => (await import('/games/island.js')).debug.client.state.me?.unsaved === true);
    await wait(2100);
    saveDelay = 1500;
    await phone.evaluate(async () => { (await import('/js/net.js')).leave(); });
    await phone.waitForSelector('.isl-overlay:has-text("Save before you go?")');
    await phone.click('[data-leave="save"]');
    await phone.waitForSelector('.isl-overlay:has-text("Saving…")');
    await phone.keyboard.press('Escape');
    await phone.waitForSelector('.isl-overlay', { state: 'hidden' });
    await wait(saveDelay + 2500); // the save lands, then the host would have parked a leaving explorer
    saveDelay = 0;
    assert.deepEqual(await hostSees(), { ready: true, parked: false }, 'Escape during the upload: the explorer is still simulated');
    assert.ok((await S(phone)).started && await phone.locator('.isl-pick').count() === 0, 'and the screen stays in the game');
    assert.equal(await phone.evaluate(async () => (await import('/games/island.js')).debug.client.state.leave), null);
    // Safety net: if the host does park an explorer that is still on screen, the screen asks for it back.
    await host.evaluate(async (id) => { const w = (await import('/games/island.js')).debug.world; w.park(w.players.get(id)); }, phoneId);
    await waitFor(host, async (id) => (await import('/games/island.js')).debug.world.players.get(id).ready === true, phoneId, 8000);
    console.log('PASS Escape during Save and leave keeps the explorer on the island (and a stray park is undone)');
  }

  // [save-flows] A browser's older save and an account that already has one: the key stays until the player discards it.
  {
    const lk = '1'.repeat(64);
    const apiUrl = saveUrl.replace(/\/+$/, '');
    const put = await worker.fetch(new Request(apiUrl + '/explorer', { method: 'PUT', headers: { authorization: 'Bearer ' + lk, 'content-type': 'application/json' }, body: JSON.stringify({ rev: 0, data: { kind: 'island-explorer', v: 1, name: 'Old Browser', lv: 2 } }) }), { DB: D1, PIN_PEPPER: 'ci-pepper' });
    assert.equal(put.status, 200);
    await fifth.evaluate((k) => localStorage.setItem('island-explorer-key', k), lk);
    await fifth.click('.isl-bagbtn');
    await fifth.click('.isl-tabs [data-tab="save"]');
    await fifth.click('[data-acct="open"]');
    await fifth.fill('[name="acctName"]', 'Phone Explorer');
    await fifth.fill('[name="acctPin"]', '4826');
    await fifth.click('[data-acct-form] button[type="submit"]');
    await fifth.waitForSelector('.isl-overlay', { state: 'hidden' });
    await fifth.click('.isl-bagbtn');
    await fifth.waitForSelector('[data-legacy="use"]');
    assert.equal(await fifth.evaluate(() => localStorage.getItem('island-explorer-key')), lk, 'the conflict leaves the browser’s key in place');
    await fifth.click('[data-legacy="keep"]');
    assert.equal(await fifth.locator('[data-legacy]').count(), 0, 'Keep it for later hides the choice');
    assert.equal(await fifth.evaluate(() => localStorage.getItem('island-explorer-key')), lk, 'and keeps the key');
    assert.equal((await worker.fetch(new Request(apiUrl + '/explorer', { headers: { authorization: 'Bearer ' + lk } }), { DB: D1, PIN_PEPPER: 'ci-pepper' })).status, 200, 'and the save on the server');
    console.log('PASS a legacy conflict keeps the browser’s key until it is discarded');
  }

  // The Save centre: a failed save shows its reason and Retry, Load adventure swaps the explorer mid-session.
  {
    const apiUrl = saveUrl.replace(/\/+$/, '');
    const phoneId = ids.phone;
    const hostP = () => host.evaluate(async (id) => { const p = (await import('/games/island.js')).debug.world.players.get(id); return { ready: p.ready, parked: !!p.parked, shells: p.ex.shells, comp: p.comp }; }, phoneId);
    const tab = async () => { await phone.evaluate(() => { const b = document.querySelector('.isl-panel [data-tab="save"]'); if (b) b.click(); else { document.querySelector('.isl-bagbtn').click(); document.querySelector('.isl-tabs [data-tab="save"]').click(); } }); await phone.waitForSelector('.isl-panel-body[data-tab="save"]'); };
    await phone.keyboard.press('Escape');
    await tab();
    const text = await phone.innerText('.isl-panel');
    assert.ok(/Last cloud save/.test(text) && await phone.locator('[data-save="cloud"]').count() === 1 && await phone.locator('[data-save="load"]').count() === 1, 'the Save tab has Save adventure, Load adventure and the last cloud save');
    assert.ok(!/file/i.test(text), 'and no file option');
    const rowNow = () => db.prepare('SELECT rev, data FROM explorers WHERE id = (SELECT \'a:\' || id FROM accounts WHERE name = ?)').get('phone explorer');
    const revBefore = rowNow().rev;
    // A failed save: the reason and Retry show; the session keeps running; the last good save stays.
    await host.evaluate(async (id) => { const w = (await import('/games/island.js')).debug.world; const p = w.players.get(id); p.ex.shells += 3; w.bump(p, true); }, phoneId);
    await wait(2100);
    saveFail = true;
    await phone.click('[data-save="cloud"]');
    await phone.waitForSelector('.isl-panel .isl-save-state.bad');
    assert.match(await phone.innerText('.isl-panel .isl-save-state.bad'), /free daily limit/);
    assert.equal(await phone.locator('[data-save="retry"]').count(), 1, 'Retry is offered');
    assert.ok(!/file/i.test(await phone.innerText('.isl-panel')), 'and no file fallback');
    assert.equal(rowNow().rev, revBefore, 'the last good save stays');
    const t1 = await host.evaluate(async () => (await import('/games/island.js')).debug.world.tick);
    await wait(500);
    assert.ok((await host.evaluate(async () => (await import('/games/island.js')).debug.world.tick)) > t1 + 5 && (await hostP()).ready, 'the session keeps running');
    saveFail = false;
    await wait(2100);
    await phone.click('[data-save="retry"]');
    await waitFor(phone, async () => { const { debug } = await import('/games/island.js'); return debug.client.state.me && !debug.client.state.me.unsaved; });
    assert.equal(rowNow().rev, revBefore + 1, 'Retry saves');
    console.log('PASS a failed save shows its reason and Retry; the session and the last good save are untouched');

    // Load adventure: confirm first; Cancel changes nothing; OK replaces the explorer with the saved one.
    const saved = JSON.parse(rowNow().data);
    await host.evaluate(async (id) => { const w = (await import('/games/island.js')).debug.world; const p = w.players.get(id); p.ex.shells += 40; w.bump(p, true); }, phoneId);
    await waitFor(phone, async () => (await import('/games/island.js')).debug.client.state.me?.unsaved === true);
    await tab();
    let asked = '';
    phone.once('dialog', (d) => { asked = d.message(); d.dismiss(); });
    await phone.click('[data-save="load"]');
    await wait(500);
    assert.match(asked, /replaces your explorer here.*isn’t saved is lost/, 'Load adventure asks first');
    assert.equal((await hostP()).shells, saved.shells + 40, 'Cancel changes nothing');
    await host.evaluate(async (id) => { window.__oldEx = (await import('/games/island.js')).debug.world.players.get(id).ex; }, phoneId);
    phone.once('dialog', (d) => d.accept());
    await phone.click('[data-save="load"]');
    await waitFor(host, async ([id, shells]) => (await import('/games/island.js')).debug.world.players.get(id).ex.shells === shells, [phoneId, saved.shells], 8000);
    const after = await hostP();
    assert.ok(after.ready && !after.parked && await host.evaluate(async (id) => (await import('/games/island.js')).debug.world.players.get(id).ex !== window.__oldEx, phoneId), 'the explorer was removed and added again, still on the island');
    await waitFor(phone, async () => { const { debug } = await import('/games/island.js'); return debug.client.state.me && !debug.client.state.me.unsaved && !document.querySelector('.isl-overlay:not([hidden])'); });
    assert.equal(await phone.locator('.isl-pick').count(), 0, 'and the screen stays in the game');
    console.log('PASS Load adventure replaces the explorer mid-session, after a confirm');

    // Recovery: a person without an account sees the note; creating one shows the code once; Forgot PIN? uses it.
    await g2.click('.isl-bagbtn');
    await g2.click('.isl-tabs [data-tab="save"]');
    const noAcct = await g2.innerText('.isl-panel');
    assert.ok(/Nothing is kept without an account/.test(noAcct) && await g2.locator('[data-save="cloud"]').count() === 0 && !/file/i.test(noAcct), 'the Save tab says nothing is kept and offers no save');
    await g2.click('[data-acct="open"]');
    await g2.click('[data-acct="mode-create"]');
    await g2.fill('[name="acctName"]', 'Bea Explorer');
    await g2.fill('[name="acctPin"]', '1590');
    await g2.fill('[name="acctPin2"]', '1590');
    await g2.click('[data-acct-form] button[type="submit"]');
    await g2.waitForSelector('.isl-code');
    const code1 = (await g2.textContent('.isl-code')).trim();
    await g2.click('[data-code="copy"]');
    await g2.click('[data-code-done]');
    await g2.waitForSelector('.isl-overlay', { state: 'hidden' });
    assert.equal(await g2.locator('.isl-code').count(), 0);
    await g2.click('.isl-bagbtn');
    await g2.click('.isl-tabs [data-tab="save"]');
    await g2.click('[data-acct="signout"]');
    await g2.click('[data-acct="open"]');
    await g2.click('[data-acct="mode-recover"]');
    await g2.fill('[name="acctName"]', 'bea explorer');
    await g2.fill('[name="acctCode"]', code1.toLowerCase());
    await g2.fill('[name="acctPin"]', '7421');
    await g2.fill('[name="acctPin2"]', '7421');
    await g2.click('[data-acct-form] button[type="submit"]');
    await g2.waitForSelector('.isl-code');
    const code2 = (await g2.textContent('.isl-code')).trim();
    assert.notEqual(code2, code1, 'a recovery gives a fresh code');
    await g2.click('[data-code-done]');
    const login = (pin) => worker.fetch(new Request(apiUrl + '/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'bea explorer', pin }) }), { DB: D1, PIN_PEPPER: 'ci-pepper' }).then((x) => x.status);
    assert.deepEqual([await login('7421'), await login('1590')], [200, 401], 'the new PIN works and the old one doesn’t');
    console.log('PASS the recovery code is shown once and Forgot PIN? sets a new PIN with it');

    // An account that has no code yet (made before codes) gets "Get a recovery code".
    await phone.evaluate(() => { const s = JSON.parse(localStorage.getItem('island-session')); s.recovery = false; localStorage.setItem('island-session', JSON.stringify(s)); });
    await phone.keyboard.press('Escape');
    await tab();
    await phone.click('.isl-tabs [data-tab="team"]'); await phone.click('.isl-tabs [data-tab="save"]');
    await phone.click('[data-acct="getcode"]');
    await phone.waitForSelector('.isl-code');
    await phone.click('[data-code-done]');
    await tab();
    assert.equal(await phone.locator('[data-acct="getcode"]').count(), 0, 'the button goes once a code was shown');
    console.log('PASS an older account can get a recovery code from the Save tab');
  }

  // Phone layout: the world fills the screen, nothing scrolls sideways.
  assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scrolling on the phone');
  const sizes = await phone.evaluate(() => { const r = document.querySelector('.isl-root').getBoundingClientRect(); return { w: r.width, h: r.height, bottom: r.bottom, vw: innerWidth, vh: innerHeight }; });
  assert.ok(sizes.w >= sizes.vw - 1 && sizes.bottom <= sizes.vh + 1 && sizes.h > sizes.vh * 0.75, `the island fills the phone screen ${JSON.stringify(sizes)}`);
  await phone.click('.isl-panel [data-panel="close"]').catch(() => {});
  await wait(400);
  await phone.screenshot({ path: fileURLToPath(new URL('island-phone.png', out)) });
  await host.screenshot({ path: fileURLToPath(new URL('island-desktop.png', out)) });
  assert.deepEqual(errors, [], 'no browser errors');
  console.log('PASS phone layout fills the screen with no sideways scrolling; no browser errors');
  await webkitSolo();
} catch (e) {
  console.error(e);
  console.error('Browser errors:', errors.slice(0, 8));
  process.exitCode = 1;
  for (const [i, c] of contexts.entries()) for (const p of c.pages()) await p.screenshot({ path: fileURLToPath(new URL(`island-failure-${i}.png`, out)) }).catch(() => {});
} finally {
  await browser?.close(); broker.kill(); server.close();
}

// WebKit, one explorer alone on the host's device: the world's ticker must start (WebKit reports a failed
// Worker only after the fact), and moving, talking and saving to the cloud must work. Set SKIP_WEBKIT=1 to skip.
async function webkitSolo() {
  if (process.env.SKIP_WEBKIT) return console.log('SKIP WebKit solo (SKIP_WEBKIT is set)');
  const { webkit } = await import('playwright');
  const wk = await webkit.launch().catch((e) => { throw Error('WebKit is not available (run: npx playwright install webkit, or set SKIP_WEBKIT=1): ' + e.message); });
  const wkErrors = [];
  try {
    const context = await wk.newContext({ viewport: { width: 1100, height: 700 } });
    await context.route(/https:\/\/(unpkg\.com|cdn\.jsdelivr\.net)\/.*peerjs.*\.js/, (r) => r.fulfill({ contentType: 'text/javascript', body: localPeer }));
    await context.route(/https:\/\/fonts\./, (r) => r.abort());
    await context.route(saveUrl.replace(/\/+$/, '') + '/**', async (route) => {
      const req = route.request();
      const res = await worker.fetch(new Request(req.url(), { method: req.method(), headers: req.headers(), body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method()) ? undefined : req.postData() }), { DB: D1, PIN_PEPPER: 'ci-pepper' });
      route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) });
    });
    await context.addInitScript(() => localStorage.setItem('gn-help-island', '1'));
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', (e) => wkErrors.push(e.message));
    await page.goto(base);
    await page.fill('#nameIn', 'Solo');
    await page.click('[data-local="island"]');
    await page.click('#startBtn');
    await signUpOn(page, 'Webkit Explorer', '3917');
    await pick(page);
    const tick = () => page.evaluate(async () => (await import('/games/island.js')).debug.world.tick);
    const t1 = await tick();
    await wait(1000);
    assert.ok((await tick()) > t1 + 10, 'WebKit: the host world keeps ticking');
    await page.waitForSelector('.isl-hud:not([hidden])');
    console.log('PASS WebKit: the world ticks and the HUD shows');

    const x = () => page.evaluate(async () => (await import('/games/island.js')).debug.client.state.body.x);
    const x0 = await x();
    await page.keyboard.down('KeyD'); await wait(900); await page.keyboard.up('KeyD');
    // Software-rendered WebKit can run only a few frames a second; the held time still has to move the explorer.
    await waitFor(page, async (x0) => (await import('/games/island.js')).debug.client.state.body.x - x0 > 40, x0, 8000).catch(() => {});
    assert.ok((await x()) - x0 > 40, 'WebKit: the explorer moves');
    await page.evaluate(async () => { // stand beside Elder Maru
      const { debug } = await import('/games/island.js'), { TILE: T } = await import('/games/island-data.js');
      const p = [...debug.world.players.values()][0]; p.body.x = 68 * T; p.body.y = 65.6 * T + 20;
    });
    await wait(400);
    await page.keyboard.press('KeyE');
    await page.waitForSelector('.isl-dialog:not([hidden]) .isl-dlg-head:has-text("Maru")');
    console.log('PASS WebKit: moving and talking to the elder work');

    await page.keyboard.press('Escape');
    const before = db.prepare('SELECT COUNT(*) AS n FROM explorers').get().n;
    await page.click('.isl-bagbtn');
    await page.click('.isl-tabs [data-tab="save"]');
    await page.click('[data-save="cloud"]');
    await waitFor(page, async () => { const { debug } = await import('/games/island.js'); return debug.client.state.me && !debug.client.state.me.unsaved; });
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM explorers').get().n, before + 1, 'WebKit: the cloud save is stored');
    console.log('PASS WebKit: Save adventure reaches the save service');
    assert.deepEqual(wkErrors, [], 'WebKit: no page errors');
  } catch (e) {
    for (const p of wk.contexts().flatMap((c) => c.pages())) await p.screenshot({ path: fileURLToPath(new URL('island-failure-webkit.png', out)) }).catch(() => {});
    console.error('WebKit errors:', wkErrors.slice(0, 8));
    throw e;
  } finally { await wk.close(); }
}
