// Real PeerJS + WebRTC between isolated browser contexts, using a local broker.
// No public signaling service, microphone, or external network is needed.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import { createRequire } from 'node:module';
import { checkInteractions } from './interaction-checks.mjs';
const require = createRequire(import.meta.url);
const { createServer } = require('../serve.js');
const root = fileURLToPath(new URL('../', import.meta.url));
const server = createServer(root);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const broker = fork(fileURLToPath(new URL('./peer-test-server.mjs', import.meta.url)), [], { cwd: root, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
let brokerLog = '';
for (const stream of [broker.stdout, broker.stderr]) stream.on('data', (data) => { brokerLog = (brokerLog + data).slice(-8000); });
const brokerPort = await new Promise((resolve, reject) => {
  const fail = (reason) => { clearTimeout(timeout); reject(Error(`Local signaling broker failed: ${reason}\n${brokerLog}`)); };
  const timeout = setTimeout(() => fail('no listening address after 20 seconds'), 20000);
  broker.once('error', (error) => fail(error.message));
  broker.once('exit', (code) => fail(`exited with code ${code}`));
  broker.once('message', (message) => {
    if (!Number.isInteger(message?.port) || message.port < 1) return fail('invalid listening address');
    clearTimeout(timeout); resolve(message.port);
  });
}).catch((error) => { broker.kill(); server.close(); throw error; });
const out = new URL('../test-results/', import.meta.url);
await fs.mkdir(out, { recursive: true });
const peerSource = await fs.readFile(new URL('../node_modules/peerjs/dist/peerjs.min.js', import.meta.url), 'utf8');
const localPeer = peerSource + `\n;{const Original=globalThis.Peer;globalThis.Peer=class extends Original{constructor(id,opts){if(id&&typeof id==='object'){opts=id;id=undefined;}super(id,{...opts,host:'127.0.0.1',port:${brokerPort},path:'/',secure:false,config:{iceServers:[]}});}};}`;
const contexts = [], errors = [];
let browser;
async function waitFor(page, predicate, arg, { timeout = 15000 } = {}) {
  const deadline = Date.now() + timeout;
  do {
    if(await page.evaluate(predicate,arg))return;
    await new Promise(resolve=>setTimeout(resolve,100));
  } while(Date.now()<deadline);
  throw Error(`Timed out waiting for ${predicate.toString()}`);
}
async function openContext(engine, options={}) {
  const context=await engine.newContext(options); contexts.push(context);
  await context.tracing.start({screenshots:true,snapshots:true});
  await context.route(/https:\/\/(unpkg\.com|cdn\.jsdelivr\.net)\/.*peerjs.*\.js/,route=>route.fulfill({contentType:'text/javascript',body:localPeer}));
  await context.route(/https:\/\/fonts\./,route=>route.abort());
  await context.addInitScript(() => {
    for(const id of ['hexisle','gems','mosaic','bluff','chess','sketch','spies','temple','ember','keeper','signal'])localStorage.setItem('gn-help-'+id,'1');
  });
  const page=await context.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);
  return page;
}
const state = (page) => page.evaluate(async()=>{const {S}=await import('/js/state.js');return {role:S.role,token:S.token,code:S.code,view:S.view,started:S.started,players:S.players,successor:S.successor,backup:!!S.backup};});
const ready = (page) => waitFor(page, async()=>{const {S,gameReady}=await import('/js/state.js');return S.started&&S.view&&gameReady(S.gameId)&&document.querySelector('#gamebox');});
async function sameView(host,guest) {
  const pid=(await state(guest)).token;
  const expected=await host.evaluate(async(pid)=>{const net=await import('/js/net.js');return JSON.stringify(net.viewFor(pid));},pid);
  await waitFor(guest, async(expected)=>JSON.stringify((await import('/js/state.js')).S.view)===expected,expected);
}
try {
  assert.ok((await fetch(`http://127.0.0.1:${brokerPort}/`)).ok, `local signaling broker responds on its assigned port ${brokerPort}`);
  browser=await chromium.launch({args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
  const host=await openContext(browser,{permissions:['microphone']});
  await checkInteractions(host, 'Chromium');
  const guest=await openContext(browser,{viewport:{width:375,height:812},permissions:['microphone']});
  await host.fill('#nameIn','Host'); await host.click('[data-host="gems"]');
  await waitFor(host, async()=>(await import('/js/state.js')).S.status==='online');
  const code=(await state(host)).code;
  // Delay the actual game module on the joining phone, not the catalogue.
  await guest.route('**/games/gems.js',async(route)=>{await new Promise(r=>setTimeout(r,1000));await route.continue();});
  await guest.fill('#nameIn','Guest'); await guest.fill('#codeIn',code); await guest.click('#joinBtn');
  await waitFor(host, async()=>(await import('/js/state.js')).S.players.length===2);
  assert.equal((await state(host)).successor,null,'migration is off unless explicitly trusted');
  const guestId=(await state(guest)).token;
  await host.selectOption('#backupHost',guestId);
  if(await host.locator('#timerSel').count())await host.selectOption('#timerSel','0');
  await host.click('#startBtn'); await ready(host); await ready(guest); await sameView(host,guest);
  console.log('PASS cold client join with delayed module and private view');

  // A dropped delta must trigger full resync rather than leave a broken board.
  await host.evaluate(async()=>{
    const {conns,broadcast}=await import('/js/net.js');
    const c=[...conns.values()][0], send=c.send.bind(c); let dropped=false;
    globalThis.resyncs=0;
    c.send=(m)=>{if(m.t==='sync'&&!dropped){dropped=true;return;}if(m.t==='sync'&&'view'in m)globalThis.resyncs++;return send(m);};
    broadcast(); broadcast();
  });
  await waitFor(host,()=>globalThis.resyncs>0);
  await sameView(host,guest);
  await guest.evaluate(async()=>{const {S}=await import('/js/state.js');S.view=null;});
  await host.evaluate(async()=>(await import('/js/net.js')).broadcast());
  await ready(guest); await sameView(host,guest);
  console.log('PASS missing delta and missing base recover through full resync');

  // Exercise actions over the data channel and confirm both boards converge.
  await host.evaluate(async()=>{const {S,getGame}=await import('/js/state.js');const n=await import('/js/net.js');n.send(getGame(S.gameId).bot(S.view,S.token));});
  await sameView(host,guest);
  const beforeGuestMove=await host.evaluate(async()=>JSON.stringify((await import('/js/state.js')).S.game));
  await guest.evaluate(async()=>{const {S,getGame}=await import('/js/state.js');const n=await import('/js/net.js');n.send(getGame(S.gameId).bot(S.view,S.token));});
  await waitFor(host,async(before)=>JSON.stringify((await import('/js/state.js')).S.game)!==before,beforeGuestMove);
  await sameView(host,guest);
  await guest.reload(); await ready(guest); await sameView(host,guest);
  assert.equal((await state(guest)).token,guestId,'refresh retains the same seat');
  console.log('PASS real moves and guest refresh/reconnect');

  await host.click('#voiceBtn'); await guest.click('#voiceBtn');
  for(const page of [host,guest])await waitFor(page, async()=>(await import('/js/net.js')).voice.links===1);
  const outsider=await openContext(browser,{permissions:['microphone']});
  await outsider.fill('#nameIn','Spectator'); await outsider.fill('#codeIn',code); await outsider.click('#joinBtn');
  await ready(outsider); await sameView(host,outsider);
  const spectatorState=await state(outsider);
  assert.ok(spectatorState.players.find(p=>p.id===spectatorState.token).watch);
  await outsider.evaluate(async()=>(await import('/js/net.js')).send({type:'take',gems:['red','blue','green']}));
  await waitFor(outsider,()=>document.querySelector('#toast').textContent.includes('watching'));
  console.log('PASS late join gets a spectator view and cannot move');
  const hostPeer=await host.evaluate(async()=>(await import('/js/net.js')).peer.id);
  await outsider.evaluate(async(id)=>{
    const p=new Peer();globalThis.outsiderPeer=p;
    await new Promise((resolve,reject)=>{p.on('open',resolve);p.on('error',reject);});
    const media=await navigator.mediaDevices.getUserMedia({audio:true});globalThis.outsiderMedia=media;
    const call=p.call(id,media);globalThis.leakedAudio=false;call.on('stream',()=>{globalThis.leakedAudio=true;});
  },hostPeer);
  await new Promise(r=>setTimeout(r,2500));
  assert.equal(await outsider.evaluate(()=>globalThis.leakedAudio),false,'an unlisted caller receives no audio');
  assert.equal(await host.evaluate(async()=>(await import('/js/net.js')).voice.links),1);
  await host.click('#voiceOff');
  await waitFor(guest, async()=>(await import('/js/net.js')).voice.links===0);
  await guest.click('#voiceOff');
  await outsider.evaluate(()=>{outsiderPeer.destroy();outsiderMedia.getTracks().forEach(t=>t.stop());});
  console.log('PASS authorized voice, outsider rejection, and voice leave');

  await host.reload(); await ready(host);
  await waitFor(host, async() => {
    const { S } = await import('/js/state.js');
    const { conns } = await import('/js/net.js');
    return S.status === 'online' && [...conns.values()].filter(c => c.open).length >= 2;
  });
  await ready(guest); await sameView(host,guest);
  console.log('PASS host refresh and guest reconnect');
  await waitFor(guest, async()=>!!(await import('/js/state.js')).S.backup);
  const oldSession=await host.evaluate(async()=>{(await import('/js/state.js')).saveSession();return sessionStorage.getItem('gn-session');});
  // Inject a real transport loss without sending the application's Leave action.
  // This tests recovery after a detected disconnect, not OS/browser crash detection.
  await host.evaluate(async() => (await import('/js/net.js')).peer.destroy());
  const departed = host.context();
  await departed.tracing.stop({path:fileURLToPath(new URL('departed-host.zip',out))});
  await departed.close();
  contexts.splice(contexts.indexOf(departed),1);
  await waitFor(guest, async()=>{const {S}=await import('/js/state.js');return S.role==='host'&&S.status==='online';},null,{timeout:40000});
  await ready(guest);
  // A previous host returning uses the same production conflict/rejoin path.
  const returning=await openContext(browser);
  await returning.evaluate((session)=>{sessionStorage.setItem('gn-name','Host');sessionStorage.setItem('gn-session',session);},oldSession);
  await returning.reload();
  await waitFor(returning, async()=>{const {S}=await import('/js/state.js');return S.role==='client'&&S.synced;},null,{timeout:45000});
  await ready(returning); await sameView(guest,returning);
  console.log('PASS trusted host migration and original host returning');
  // Use the connected room to reproduce the real between-round newcomer path.
  guest.once('dialog', (dialog) => dialog.accept());
  await guest.evaluate(async() => {
    const { S } = await import('/js/state.js');
    const net = await import('/js/net.js');
    net.endGame();
    for (const p of S.players) if (p.watch) net.setWatch(p.id, false);
    await net.startTour('knockout', ['chess']);
  });
  await ready(guest);
  await guest.evaluate(async() => {
    const { S } = await import('/js/state.js');
    (await import('/js/net.js')).applyAction(S.game.players[0].id, { type: 'resign' });
  });
  guest.once('dialog', (dialog) => dialog.accept());
  await guest.evaluate(async() => (await import('/js/net.js')).endGame());
  const arrival = await openContext(browser);
  await arrival.fill('#nameIn','Between rounds'); await arrival.fill('#codeIn',code); await arrival.click('#joinBtn');
  await waitFor(arrival, async() => (await import('/js/state.js')).S.synced);
  const arrivalState = await state(arrival);
  assert.equal(arrivalState.players.find(p => p.id === arrivalState.token).watch, true);
  await guest.click('#tourGo'); await ready(guest); await ready(arrival);
  const nextMatch = await guest.evaluate(async() => {
    const { S } = await import('/js/state.js');
    const { currentMatch } = await import('/js/tour.js');
    return { actual: S.game.players.map(p => p.id).sort(), expected: currentMatch(S.tour).seats.slice().sort() };
  });
  assert.deepEqual(nextMatch.actual, nextMatch.expected);
  console.log('PASS newcomer between knockout rounds watches and the next match starts');
  assert.deepEqual(errors,[],'no uncaught browser errors');
  await guest.screenshot({path:fileURLToPath(new URL('multiplayer-phone.png',out))});
  for(const [i,c] of contexts.entries())await c.tracing.stop({path:fileURLToPath(new URL(`chromium-${i}.zip`,out))});
  await browser.close(); contexts.length=0;

  // WebKit touch checks supplement Chromium multiplayer; no claim of real iOS testing.
  browser=await webkit.launch();
  const phone=await openContext(browser,{viewport:{width:375,height:812},hasTouch:true});
  await checkInteractions(phone, 'WebKit touch');
  await phone.fill('#nameIn','Phone player'); await phone.fill('#codeIn','ABCDE');
  await phone.selectOption('[data-filter="category"]','Party');
  assert.equal(await phone.locator('.game-card').count(),3);
  await phone.click('[data-favorite="sketch"]');
  await phone.selectOption('[data-filter="collection"]','favorites');
  assert.equal(await phone.locator('.game-card').count(),1);
  assert.equal(await phone.inputValue('#nameIn'),'Phone player'); assert.equal(await phone.inputValue('#codeIn'),'ABCDE');
  await phone.reload(); await phone.selectOption('[data-filter="collection"]','favorites');
  assert.equal(await phone.locator('.game-card').count(),1,'favorite persists across reload');
  await phone.click('#clearFilters');
  await phone.fill('[data-filter="query"]','no game matches'); assert.equal(await phone.locator('.library-empty').count(),1);
  await phone.click('#clearFilters');
  assert.ok(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'phone library fits without horizontal scrolling');
  await phone.screenshot({path:fileURLToPath(new URL('library-phone.png',out)),fullPage:true});
  await phone.click('[data-local="gems"]'); await phone.click('#startBtn'); await ready(phone);
  assert.deepEqual(await phone.evaluate(async()=>(await import('/js/library.js')).recentGames()),['gems']);
  await phone.reload(); await ready(phone);
  assert.deepEqual(errors,[]);
  console.log('PASS WebKit touch library, persisted favorites, empty state, local play and refresh');
} catch(error) {
  console.error(error); process.exitCode=1;
  if(brokerLog)console.error('Broker diagnostics:\n'+brokerLog);
  for(const c of contexts)for(const p of c.pages())console.error('Room state',await p.evaluate(async()=>{const {S}=await import('/js/state.js');return {role:S.role,status:S.status,successor:S.successor,backup:!!S.backup,lostAt:S.lostAt,token:S.token};}).catch(()=>null));
  for(const [i,c]of contexts.entries())for(const [j,p]of c.pages().entries())await p.screenshot({path:fileURLToPath(new URL(`failure-${i}-${j}.png`,out))}).catch(()=>{});
} finally {
  for(const [i,c]of contexts.entries())await c.tracing.stop({path:fileURLToPath(new URL(`trace-${i}.zip`,out))}).catch(()=>{});
  await browser?.close(); broker.kill(); server.close();
}
