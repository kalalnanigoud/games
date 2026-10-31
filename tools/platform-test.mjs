// Regression checks for the real platform functions, with transport and DOM replaced by test doubles.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { GAMES, getGame } from '../games/index.js';
import { VERSION, FILES } from '../games/catalog.js';
import CONFIG from '../js/config.js';
import { uid, randomCode, reconnectSecret, sha256hex } from '../js/util.js';
import { createTour, currentMatch, recordResult, standings, tourLine } from '../js/tour.js';
import { diff, apply } from '../js/patch.js';
// Voice chat needs a microphone and WebRTC; record what the platform asks of it instead.
const voiceCalls = [];
const createVoice = () => ({ active: false, muted: false, sync(list) { voiceCalls.push(list); }, leave() {}, answer() {}, toggleMute() {} });
const storage = () => { const data = new Map(); return { getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,v), removeItem: k => data.delete(k) }; };
const tasks = new Map(); let nextTimer = 0;
const loaders = Object.fromEntries(GAMES.map((g) => [g.id, async () => ({ default: g })]));
const context = { CATALOG: GAMES, loaders, VERSION, FILES, CONFIG, uid, randomCode, reconnectSecret, sha256hex, diff, apply, console, structuredClone, TextEncoder,
  createVoice, createTour, currentMatch, recordResult, standings, tourLine, rememberPlayed() {}, confirm: () => true,
  sessionStorage: storage(), localStorage: storage(), document: { getElementById: () => ({}), addEventListener() {} },
  addEventListener() {}, setInterval() {}, clearInterval() {}, setTimeout(fn) { tasks.set(++nextTimer, fn); return nextTimer; }, clearTimeout(id) { tasks.delete(id); },
  toast() {}, history: { replaceState() {} }, location: {pathname:'/'},
};
vm.createContext(context);
// The real room state and networking modules, with the screens replaced by no-ops.
const read = (file) => fs.readFileSync(new URL('../js/' + file, import.meta.url), 'utf8').replace(/\r\n/g, '\n').replace(/^import .*;\n/gm, '').replace(/^export \{[^}]*\};\n/gm, '').replace(/^export /gm, '');
vm.runInContext(read('state.js') + '\n' + read('net.js') + `
function render() {}
function renderTopbar() {}
function paintNet() {}
globalThis.test = { S, conns, onHostMessage, onConnClosed, saveSession, resume, parse, cleanup, localRoom, hostRoom, joinRoom, broadcast, requireMultiplayer,
  startGame, armTimer, scheduleBots, onClientMessage, setWatch, applyAction, startTour, playTour, closeTour, loadGame, viewFor, standingIn, scheduleClientRetry,
  addBot, fitTable, seatLimit,
  get timer() { return turnTimer; } };
`, context);
const t = context.test;
const json = (x) => JSON.parse(JSON.stringify(x));
// A fresh client receives a private view before its game module has downloaded.
const coldView = getGame('gems').setup([{id:'cold',name:'Cold'},{id:'host',name:'Host'}]);
t.S.role='client'; t.S.token='cold'; t.S.game=null;
const cold = {t:'sync',seq:1,gameId:'gems',started:true,view:coldView,players:[],hostId:'host'};
t.onClientMessage(cold);
await t.loadGame('gems');
await Promise.resolve();
assert.deepEqual(json(t.S.view),coldView,'lazy loading must retain the received client view');
t.onClientMessage({...cold,seq:0,view:null});
assert.deepEqual(json(t.S.view),coldView,'stale snapshots must not replace newer state');
t.onClientMessage({...cold,seq:4}); // fresh full snapshot, then simulate losing its base
t.S.view=null;
const lost = { ...cold, seq:5,from:4,patch:{}}; delete lost.view;
t.onClientMessage(lost);
assert.equal(t.S.view,null,'a delta cannot be applied to a missing base');
t.cleanup(); t.S.started=false;
for (const g of GAMES) await t.loadGame(g.id); // the site loads game code on demand
const runTask = (fn) => { for (const [id, f] of [...tasks]) if (!fn || f === fn) { tasks.delete(id); f(); } };
const secret = reconnectSecret(), otherSecret = reconnectSecret();
assert.match(secret,/^[a-f0-9]{64}$/); assert.notEqual(secret,otherSecret);
const conn = () => ({open:true,sent:[],send(msg){this.sent.push(structuredClone(msg));},close(){this.open=false;t.onConnClosed(this);}});
t.S.role='host'; t.S.players=[{id:t.S.token,name:'Host',connected:true}];
const first=conn(); t.onHostMessage(first,{t:'hello',token:'guest',secret,name:'Guest',v:VERSION});
assert.equal(first.pid,'guest'); assert.equal(t.S.players.length,2);
const sync=first.sent.find(m=>m.t==='sync');
assert.ok(sync); assert.ok(!JSON.stringify(sync).includes(secret)); assert.equal(sync.v,VERSION,'every sync says which version the host runs');
for (const [token,credential] of [['guest',otherSecret],[t.S.token,secret],['bad token',secret],['new',undefined],['__proto__',secret]]) {
  const bad=conn(); t.onHostMessage(bad,{t:'hello',token,secret:credential});
  assert.equal(bad.pid,undefined); assert.equal(bad.sent[0].fatal,true);
}
assert.equal(first.open,true);
const replacement=conn(); t.onHostMessage(replacement,{t:'hello',token:'guest',secret,name:'Guest'});
assert.equal(replacement.pid,'guest'); assert.equal(first.open,false); assert.equal(t.S.players[1].connected,true);
// Real legal/illegal actions: the old connection must not be able to move.
t.S.gameId='gems'; t.S.started=true; t.S.game=getGame('gems').setup([{id:'guest',name:'Guest'},{id:t.S.token,name:'Host'}]);
const action={type:'take',gems:['red','blue','green']};
const before=JSON.stringify(t.S.game);
t.onHostMessage(first,{t:'action',action}); assert.equal(JSON.stringify(t.S.game),before);
t.onHostMessage(replacement,{t:'action',action}); assert.notEqual(JSON.stringify(t.S.game),before);
const after=JSON.stringify(t.S.game);
t.onHostMessage(replacement,{t:'action',action}); assert.equal(JSON.stringify(t.S.game),after); assert.equal(replacement.sent.at(-1).t,'error');
// Change-only syncing: after one full view, each sync carries a patch; replaying them rebuilds the view exactly.
for (let i = 0; i < 6 && !t.S.game.over; i++) { const pid = getGame('gems').turnOf(t.S.game)[0]; t.applyAction(pid, getGame('gems').bot(t.viewFor(pid), pid)); }
const allSyncs = replacement.sent.filter((m) => m.t === 'sync');
const syncs = allSyncs.slice(allSyncs.findIndex((m) => m.view)); // before the game starts the view is empty
assert.ok('view' in syncs[0] && syncs.slice(1).every((m) => !('view' in m) && m.from === m.seq - 1), 'one full view, then only changes');
let rebuilt; for (const m of syncs) rebuilt = 'view' in m ? m.view : apply(rebuilt, m.patch);
assert.deepEqual(json(rebuilt), json(t.viewFor('guest')));
assert.ok(JSON.stringify(syncs.at(-1)).length < JSON.stringify(t.viewFor('guest')).length, 'a patch is smaller than the view');
t.onHostMessage(replacement,{t:'resync'}); assert.ok('view' in replacement.sent.at(-1), 'a client that lost track gets a full copy');
// Random JSON edits: diff and apply always agree, and never modify their inputs.
const rnd = (n) => Math.floor(Math.random() * n);
const randomValue = (d = 0) => { const k = rnd(d > 3 ? 3 : 6); return k === 0 ? rnd(5) : k === 1 ? 'abc'[rnd(3)] : k === 2 ? null : k === 3 ? Array.from({ length: rnd(5) }, () => randomValue(d + 1)) : k === 4 ? Object.fromEntries(Array.from({ length: rnd(4) }, () => ['k' + rnd(5), randomValue(d + 1)])) : rnd(2) === 0; };
const mutate = (v, d = 0) => { if (rnd(4) === 0 || d > 3) return randomValue(d); if (Array.isArray(v)) { const a = v.map((x) => (rnd(3) ? x : mutate(x, d + 1))); if (rnd(3) === 0) a.splice(rnd(a.length + 1), 0, randomValue(d)); if (rnd(3) === 0 && a.length) a.splice(rnd(a.length), 1); return a; } if (v && typeof v === 'object') { const o = { ...v }; for (const k of Object.keys(o)) if (!rnd(3)) o[k] = mutate(o[k], d + 1); if (!rnd(3)) o['n' + rnd(3)] = randomValue(d); if (!rnd(3)) delete o[Object.keys(o)[0]]; return o; } return randomValue(d); };
for (let i = 0; i < 3000; i++) { const a = randomValue(), b = mutate(a), as = JSON.stringify(a), bs = JSON.stringify(b); assert.equal(JSON.stringify(apply(a, diff(a, b))), bs); assert.equal(JSON.stringify(a), as); assert.equal(JSON.stringify(b), bs); }
// Version check: a guest with a newer copy of the site tells the host to update.
assert.equal(t.S.update, null);
const newer = conn(); t.onHostMessage(newer,{t:'hello',token:'newer',secret:otherSecret,name:'New',v:'999999999999-zzz'});
assert.equal(t.S.update.newer, true); t.S.update = null; newer.close(); t.S.players = t.S.players.filter((p) => p.id !== 'newer');
// Arriving after the start makes you a spectator: you see the game but cannot move or take a seat mid-game.
const late=conn(); t.onHostMessage(late,{t:'hello',token:'late',secret:otherSecret,name:'Late'});
assert.equal(late.pid,'late'); assert.equal(t.S.players.find(p=>p.id==='late').watch,true); assert.ok(late.sent.some(m=>m.t==='sync'&&m.started&&m.view));
const watched=JSON.stringify(t.S.game); t.onHostMessage(late,{t:'action',action:{type:'take',gems:['white','black','red']}});
assert.equal(JSON.stringify(t.S.game),watched); assert.match(late.sent.at(-1).msg,/watching/);
t.onHostMessage(late,{t:'watch',on:false}); assert.match(late.sent.at(-1).msg,/game ends/); assert.equal(t.S.players.find(p=>p.id==='late').watch,true);
assert.equal(t.S.successor, null, 'hidden state is not automatically sent to a spectator');
t.S.backupHost='late'; t.broadcast();
assert.equal(t.S.successor,'late','only the explicitly trusted person receives a backup');
t.S.backupHost=''; t.broadcast(); assert.equal(t.S.successor,null);
t.S.players.push({id:'bot',name:'Bot',bot:true});
const botThief=conn();t.onHostMessage(botThief,{t:'hello',token:'bot',secret});assert.equal(botThief.sent[0].fatal,true);
t.saveSession();
const saved=JSON.parse(context.sessionStorage.getItem('gn-session'));
assert.equal(saved.version,3); assert.equal(saved.credentials[0][1],sha256hex(secret));
assert.ok(!JSON.stringify(saved.credentials).includes(secret), 'the host keeps only fingerprints of guests’ secrets');
assert.equal(t.parse(JSON.stringify({...saved,version:1})),null);
assert.ok(t.parse(JSON.stringify({...saved,role:'local',version:1})));
assert.equal(t.parse(JSON.stringify({...saved,version:2,credentials:[['guest',secret]]})).credentials[0][1], sha256hex(secret), 'old saved rooms are upgraded');
// Restored host credential list authorizes the existing guest after a host refresh.
t.cleanup();t.S.credentials=JSON.parse(JSON.stringify(saved.credentials));
const restored=conn();t.onHostMessage(restored,{t:'hello',token:'guest',secret});assert.equal(restored.pid,'guest');
// A dropped player's seat: after a grace period, a computer plays it until they reconnect.
runTask(); // let pending timers (backups, closing rejected connections) run
while (getGame('gems').turnOf(t.S.game)[0] !== 'guest') { const pid = getGame('gems').turnOf(t.S.game)[0]; t.applyAction(pid, getGame('gems').bot(t.viewFor(pid), pid)); }
restored.close();
const guest = t.S.players.find((p) => p.id === 'guest');
assert.ok(guest.away); assert.equal(t.standingIn('guest'), false, 'not straight away');
guest.away -= 21000; assert.equal(t.standingIn('guest'), true);
t.scheduleBots(); const beforeStandIn = JSON.stringify(t.S.game); runTask();
assert.notEqual(JSON.stringify(t.S.game), beforeStandIn, 'the computer moved for them'); assert.equal(guest.standIn, true);
const back=conn(); t.onHostMessage(back,{t:'hello',token:'guest',secret,name:'Guest'});
assert.equal(guest.standIn, undefined); assert.equal(guest.away, undefined); assert.equal(t.standingIn('guest'), false, 'they get their seat back');
// Backup host: the successor receives a copy of the room; if the host vanishes, it takes the room over.
t.S.backupHost='guest'; t.broadcast(); assert.equal(t.S.successor, 'guest');
runTask(); const backup = back.sent.find((m) => m.t === 'backup');
assert.ok(backup); assert.equal(backup.data.code, t.S.code); assert.ok(!JSON.stringify(backup).includes(secret), 'the copy holds no reconnect secrets');
const oldHost = { token: t.S.token, secret: t.S.secret }, game = JSON.stringify(backup.data.game);
class FakePeer { constructor(id) { this.id = id || 'peer-' + uid(); this.handlers = {}; } on(e, f) { this.handlers[e] = f; } destroy() { this.destroyed = true; } connect() { return { on() {}, send() {}, close() {} }; } }
context.Peer = FakePeer;
t.cleanup(); Object.assign(t.S, { role: 'client', token: 'guest', secret, code: backup.data.code, hostId: backup.data.hostId, successor: 'guest', backup: null });
t.onClientMessage(backup); assert.ok(t.S.backup);
t.S.lostAt = Date.now() - 1000; t.scheduleClientRetry(); assert.equal(t.S.role, 'client', 'the backup host waits for the host to come back first');
t.S.lostAt = Date.now() - 16000; t.scheduleClientRetry();
assert.equal(t.S.role, 'host'); assert.equal(JSON.stringify(t.S.game), game, 'the game carries on where it was');
assert.equal(t.S.players.find((p) => p.id === oldHost.token).connected, false);
const returning = conn(); t.onHostMessage(returning, { t: 'hello', token: oldHost.token, secret: oldHost.secret, name: 'Host' });
assert.equal(returning.pid, oldHost.token, 'the old host can rejoin as a player');
const impostor = conn(); t.onHostMessage(impostor, { t: 'hello', token: 'late', secret: reconnectSecret() });
assert.equal(impostor.sent[0].fatal, true, 'nobody can pose as a player without their secret');
delete context.Peer;
// No Peer library: online requests preserve the current session; local games remain available.
assert.equal(t.requireMultiplayer(),false);
const role=t.S.role;t.joinRoom('ABCDE');t.hostRoom('gems');assert.equal(t.S.role,role);
// Between games, spectators keep out of the deal, and the host's game options reach setup().
t.S.started=false; t.S.gameId='chess'; t.S.players=[{id:t.S.token,name:'Host',connected:true},{id:'other',name:'Guest',connected:true},{id:'late',name:'Late',connected:true,watch:true}];
t.S.opts={clock:'3+2'}; t.startGame(); assert.deepEqual(t.S.game.players.map(p=>p.id).sort(),[t.S.token,'other'].sort()); assert.equal(t.S.game.clock.inc,2000);
// Rematch: same seats, and chess swaps colours.
const whiteBefore = t.S.game.players.find((p) => p.color === 'w').id;
t.applyAction(whiteBefore, { type: 'resign' }); t.startGame(true);
assert.notEqual(t.S.game.players.find((p) => p.color === 'w').id, whiteBefore, 'colours swap in a rematch');
// Seats follow the chosen game: chess seats two, so a third person watches until a seat frees up.
t.S.started=false; assert.match(t.setWatch('late',false),/table is full/,'a full chess table keeps a third person watching');
assert.equal(t.S.players.find(p=>p.id==='late').watch,true);
assert.equal(t.setWatch('other',true),null); assert.equal(t.setWatch('late',false),null,'a freed seat can be taken');
assert.equal(t.S.players.find(p=>p.id==='late').watch,undefined);
assert.equal(t.setWatch('late',true),null); assert.equal(t.setWatch('other',false),null);
// Joining a full table in the lobby: the newcomer watches, and is told why.
const third=conn(); t.onHostMessage(third,{t:'hello',token:'third',secret:reconnectSecret(),name:'Third'});
assert.equal(t.S.players.find(p=>p.id==='third').watch,true,'a full table seats newcomers as spectators');
assert.match(third.sent.find(m=>m.t==='notice')?.msg||'',/Chess seats 2/);
// Computer players stop at the limit; picking a game with fewer seats trims the table.
t.addBot(); assert.equal(t.S.players.filter(p=>p.bot).length,0,'no computer player past the limit');
t.S.gameId='gems'; assert.equal(t.seatLimit(),4); t.addBot(); assert.equal(t.S.players.filter(p=>p.bot).length,1);
assert.equal(t.setWatch('third',false),null);
t.S.gameId='chess'; t.fitTable();
assert.equal(t.S.players.filter(p=>p.bot).length,0,'computer players leave first');
assert.equal(t.S.players.find(p=>p.id==='third').watch,true,'then the newest arrival watches');
assert.deepEqual(t.S.players.filter(p=>!p.watch).map(p=>p.id).sort(),[t.S.token,'other'].sort(),'the host keeps their seat');
// A tournament may use the whole room; each of its games seats its own players.
t.S.lobbyMode='tour'; assert.equal(t.seatLimit(),8); t.S.lobbyMode='game';
t.S.players=t.S.players.filter(p=>p.id!=='third'); t.S.credentials=t.S.credentials.filter(([id])=>id!=='third'); third.close();
t.S.opts={clock:'bogus'}; t.S.players.pop(); t.startGame(); assert.equal(t.S.opts.clock,'10+5','unknown options fall back to the default');
// Voice chat: the host keeps the member list, shares it in every sync, and drops people who leave.
t.S.started=false; t.S.voice=[];
const talker=conn(); t.onHostMessage(talker,{t:'hello',token:'talker',secret:otherSecret,name:'Talker'});
talker.peer='abc-123';
t.onHostMessage(talker,{t:'voice',on:true,peer:'not a valid id!'}); assert.deepEqual(json(t.S.voice),[],'bad PeerJS ids are ignored');
t.onHostMessage(talker,{t:'voice',on:true,peer:'someone-else'}); assert.deepEqual(json(t.S.voice),[],'a member cannot authorize an unrelated caller');
t.onHostMessage(talker,{t:'voice',on:true,peer:'abc-123'}); assert.deepEqual(json(t.S.voice),[['talker','abc-123']]);
assert.deepEqual(talker.sent.at(-1).voice,[['talker','abc-123']],'the member list travels with every sync');
t.onHostMessage(talker,{t:'voice',on:false}); assert.deepEqual(json(t.S.voice),[]);
t.onHostMessage(talker,{t:'voice',on:true,peer:'abc-123'}); talker.close(); assert.deepEqual(json(t.S.voice),[],'leaving the room leaves voice');
t.S.players=t.S.players.filter(p=>p.id!=='talker');
// Tournaments: a knockout seats each pair in turn, scores results, and ends with a champion.
t.S.gameId='chess'; t.S.players=[{id:t.S.token,name:'Host',connected:true},{id:'pal',name:'Pal',connected:true},{id:'B1',name:'Bot',connected:true,bot:true}];
t.startTour('knockout',['chess']);
assert.equal(t.S.started,true); assert.equal(t.S.tour.gameNo,1);
let rounds=0;
while(!t.S.tour.done && rounds++<6){
  const seats=t.S.game.players.map(p=>p.id), loser=t.S.game.players.find(p=>p.color==='w');
  assert.equal(seats.length,2); assert.ok(t.S.players.filter(p=>p.watch).every(p=>!seats.includes(p.id)),'only the match pair is seated');
  assert.equal(t.applyAction(loser.id,{type:'resign'}),null);
  assert.equal(t.S.tour.recorded,t.S.tour.gameNo,'the result is recorded once');
  if(!t.S.tour.done) t.playTour();
}
assert.equal(t.S.tour.done,true); assert.equal(t.S.tour.champions.length,1);
assert.ok(t.S.players.every(p=>!p.watch),'everyone gets their seat back afterwards');
t.S.started=false; t.closeTour(); assert.equal(t.S.tour,null);
// A series moves through its game list.
t.S.players=[{id:t.S.token,name:'Host',connected:true},{id:'pal',name:'Pal',connected:true}];
t.startTour('series',['chess','gems']); assert.equal(t.S.gameId,'chess');
t.applyAction(t.S.game.players[0].id,{type:'resign'}); t.playTour(); assert.equal(t.S.gameId,'gems');
t.S.started=false; t.closeTour();
t.cleanup();tasks.clear();t.localRoom('hexisle');t.startGame(); assert.ok(t.timer); assert.ok(tasks.has(t.timer));
const localSaved=JSON.parse(context.sessionStorage.getItem('gn-session'));
t.cleanup();t.localRoom('hexisle',localSaved);assert.ok(t.timer,'resumed local game restarts clock');
// A pending bot move must not survive leaving a room.
t.S.players[0].bot=true;t.S.game.over=false;t.scheduleBots();assert.ok(tasks.size>0);
t.cleanup();assert.equal(tasks.size,0);
console.log('Platform regression checks passed: identity, secret fingerprints, valid reconnect, stale connections, rules enforcement, change-only syncs, version check, saved credentials, legacy sessions, stand-ins, backup host takeover, rematch, local fallback, timers, spectators, game options, voice chat membership and tournaments.');
