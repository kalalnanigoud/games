// Regression checks for the real platform functions, with transport and DOM replaced by test doubles.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { GAMES, getGame } from '../games/index.js';
import { uid, randomCode, reconnectSecret } from '../js/util.js';
import { createTour, currentMatch, recordResult, standings, tourLine } from '../js/tour.js';
// Voice chat needs a microphone and WebRTC; record what the platform asks of it instead.
const voiceCalls = [];
const createVoice = () => ({ active: false, muted: false, sync(list) { voiceCalls.push(list); }, leave() {}, answer() {}, toggleMute() {} });
const storage = () => { const data = new Map(); return { getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,v), removeItem: k => data.delete(k) }; };
const tasks = new Map(); let nextTimer = 0;
const context = { GAMES, getGame, uid, randomCode, reconnectSecret, console, structuredClone, createVoice, createTour, currentMatch, recordResult, standings, tourLine, confirm: () => true,
  sessionStorage: storage(), localStorage: storage(), document: { getElementById: () => ({}), addEventListener() {} },
  addEventListener() {}, setInterval() {}, setTimeout(fn) { tasks.set(++nextTimer, fn); return nextTimer; }, clearTimeout(id) { tasks.delete(id); },
  toast() {}, history: { replaceState() {} }, location: {pathname:'/'},
};
vm.createContext(context);
const src = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n').replace(/^import .*;\r?\n/gm, '');
vm.runInContext(src.slice(0, src.indexOf('/* ---------------- boot')) + '\n' + src.slice(src.indexOf('function requireMultiplayer()'), src.indexOf('\n{\n  // A refresh')) + `
render = () => {};
globalThis.test = { S, conns, onHostMessage, onConnClosed, saveSession, resume, parse, cleanup, localRoom, hostRoom, joinRoom, broadcast, requireMultiplayer,
  startGame, armTimer, scheduleBots, onClientMessage, setWatch, applyAction, startTour, playTour, closeTour, get timer() { return turnTimer; } };
`, context);
const t = context.test;
const secret = reconnectSecret(), otherSecret = reconnectSecret();
assert.match(secret,/^[a-f0-9]{64}$/); assert.notEqual(secret,otherSecret);
const conn = () => ({open:true,sent:[],send(msg){this.sent.push(structuredClone(msg));},close(){this.open=false;t.onConnClosed(this);}});
t.S.role='host'; t.S.players=[{id:t.S.token,name:'Host',connected:true}];
const first=conn(); t.onHostMessage(first,{t:'hello',token:'guest',secret,name:'Guest'});
assert.equal(first.pid,'guest'); assert.equal(t.S.players.length,2);
const sync=first.sent.find(m=>m.t==='sync');
assert.ok(sync); assert.ok(!JSON.stringify(sync).includes(secret));
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
// Arriving after the start makes you a spectator: you see the game but cannot move or take a seat mid-game.
const late=conn(); t.onHostMessage(late,{t:'hello',token:'late',secret:otherSecret,name:'Late'});
assert.equal(late.pid,'late'); assert.equal(t.S.players.find(p=>p.id==='late').watch,true); assert.ok(late.sent.some(m=>m.t==='sync'&&m.started&&m.view));
const watched=JSON.stringify(t.S.game); t.onHostMessage(late,{t:'action',action:{type:'take',gems:['white','black','red']}});
assert.equal(JSON.stringify(t.S.game),watched); assert.match(late.sent.at(-1).msg,/watching/);
t.onHostMessage(late,{t:'watch',on:false}); assert.match(late.sent.at(-1).msg,/game ends/); assert.equal(t.S.players.find(p=>p.id==='late').watch,true);
t.S.players.push({id:'bot',name:'Bot',bot:true});
const botThief=conn();t.onHostMessage(botThief,{t:'hello',token:'bot',secret});assert.equal(botThief.sent[0].fatal,true);
t.saveSession();
const saved=JSON.parse(context.sessionStorage.getItem('gn-session'));
assert.equal(saved.version,2); assert.equal(saved.credentials[0][1],secret);
assert.equal(t.parse(JSON.stringify({...saved,version:1})),null);
assert.ok(t.parse(JSON.stringify({...saved,role:'local',version:1})));
// Restored host credential list authorizes the existing guest after a host refresh.
t.cleanup();t.S.credentials=JSON.parse(JSON.stringify(saved.credentials));
const restored=conn();t.onHostMessage(restored,{t:'hello',token:'guest',secret});assert.equal(restored.pid,'guest');
// No Peer library: online requests preserve the current session; local games remain available.
assert.equal(t.requireMultiplayer(),false);
const role=t.S.role;t.joinRoom('ABCDE');t.hostRoom('gems');assert.equal(t.S.role,role);
// Between games, spectators keep out of the deal, and the host's game options reach setup().
t.S.started=false; t.S.gameId='chess'; t.S.players=[{id:t.S.token,name:'Host',connected:true},{id:'guest',name:'Guest',connected:true},{id:'late',name:'Late',connected:true,watch:true}];
t.S.opts={clock:'3+2'}; t.startGame(); assert.deepEqual(t.S.game.players.map(p=>p.id).sort(),[t.S.token,'guest'].sort()); assert.equal(t.S.game.clock.inc,2000);
t.S.started=false; assert.equal(t.setWatch('late',false),null); assert.equal(t.S.players.find(p=>p.id==='late').watch,undefined);
t.S.opts={clock:'bogus'}; t.S.players.pop(); t.startGame(); assert.equal(t.S.opts.clock,'10+5','unknown options fall back to the default');
// Voice chat: the host keeps the member list, shares it in every sync, and drops people who leave.
t.S.started=false; t.S.voice=[];
const talker=conn(); t.onHostMessage(talker,{t:'hello',token:'talker',secret:otherSecret,name:'Talker'});
t.onHostMessage(talker,{t:'voice',on:true,peer:'not a valid id!'}); assert.deepEqual(JSON.parse(JSON.stringify(t.S.voice)),[],'bad PeerJS ids are ignored');
t.onHostMessage(talker,{t:'voice',on:true,peer:'abc-123'}); assert.deepEqual(JSON.parse(JSON.stringify(t.S.voice)),[['talker','abc-123']]);
assert.deepEqual(talker.sent.at(-1).voice,[['talker','abc-123']],'the member list travels with every sync');
t.onHostMessage(talker,{t:'voice',on:false}); assert.deepEqual(JSON.parse(JSON.stringify(t.S.voice)),[]);
t.onHostMessage(talker,{t:'voice',on:true,peer:'abc-123'}); talker.close(); assert.deepEqual(JSON.parse(JSON.stringify(t.S.voice)),[],'leaving the room leaves voice');
t.S.players=t.S.players.filter(p=>p.id!=='talker');
// Tournaments: a knockout seats each pair in turn, scores results, and ends with a champion.
t.S.gameId='chess'; t.S.players=[{id:t.S.token,name:'Host',connected:true},{id:'guest',name:'Guest',connected:true},{id:'B1',name:'Bot',connected:true,bot:true}];
t.startTour('knockout',['chess']);
assert.equal(t.S.started,true); assert.equal(t.S.tour.gameNo,1);
let rounds=0;
while(!t.S.tour.done && rounds++<6){
  const seats=t.S.game.players.map(p=>p.id), loser=t.S.game.players.find(p=>p.color==='w'), winner=t.S.game.players.find(p=>p!==loser);
  assert.equal(seats.length,2); assert.ok(t.S.players.filter(p=>p.watch).every(p=>!seats.includes(p.id)),'only the match pair is seated');
  assert.equal(t.applyAction(loser.id,{type:'resign'}),null);
  assert.equal(t.S.tour.recorded,t.S.tour.gameNo,'the result is recorded once');
  if(!t.S.tour.done) t.playTour();
}
assert.equal(t.S.tour.done,true); assert.equal(t.S.tour.champions.length,1);
assert.ok(t.S.players.every(p=>!p.watch),'everyone gets their seat back afterwards');
t.S.started=false; t.closeTour(); assert.equal(t.S.tour,null);
// A series moves through its game list.
t.S.players=[{id:t.S.token,name:'Host',connected:true},{id:'guest',name:'Guest',connected:true}];
t.startTour('series',['chess','gems']); assert.equal(t.S.gameId,'chess');
t.applyAction(t.S.game.players[0].id,{type:'resign'}); t.playTour(); assert.equal(t.S.gameId,'gems');
t.S.started=false; t.closeTour();
t.cleanup();tasks.clear();t.localRoom('hexisle');t.startGame(); assert.ok(t.timer); assert.ok(tasks.has(t.timer));
const localSaved=JSON.parse(context.sessionStorage.getItem('gn-session'));
t.cleanup();t.localRoom('hexisle',localSaved);assert.ok(t.timer,'resumed local game restarts clock');
// A pending bot move must not survive leaving a room.
t.S.players[0].bot=true;t.S.game.over=false;t.scheduleBots();assert.ok(tasks.size>0);
t.cleanup();assert.equal(tasks.size,0);
console.log('Platform regression checks passed: identity, secret privacy, valid reconnect, stale connections, rules enforcement, saved credentials, legacy sessions, local fallback, timers, spectators, game options, voice chat membership and tournaments.');

