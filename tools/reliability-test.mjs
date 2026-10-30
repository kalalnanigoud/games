import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import { CATALOG } from '../games/catalog.js';
import { createVoice } from '../js/voice.js';
import { GAME_INFO, filterGames, toggleFavorite, favorites, rememberPlayed, recentGames } from '../js/library.js';

const storage = () => ({ data: new Map(), writes: 0, getItem(k) { return this.data.get(k) ?? null; }, setItem(k,v) { this.writes++; this.data.set(k,v); }, removeItem(k) { this.data.delete(k); } });
globalThis.localStorage = storage();
assert.ok(CATALOG.every((g) => GAME_INFO[g.id]), 'every game has browse metadata');
assert.ok(filterGames(CATALOG,{category:'Party'}).every((g) => GAME_INFO[g.id].category==='Party'));
assert.ok(filterGames(CATALOG,{players:8}).every((g) => g.maxPlayers>=8));
assert.equal(filterGames(CATALOG,{query:'no such game'}).length,0);
assert.ok(filterGames(CATALOG,{minutes:15}).every((g) => GAME_INFO[g.id].minutes<=15));
toggleFavorite('gems'); assert.deepEqual(favorites(),['gems']);
assert.deepEqual(filterGames(CATALOG,{collection:'favorites'}).map((g)=>g.id),['gems']);
toggleFavorite('gems'); assert.deepEqual(favorites(),[]);
rememberPlayed('gems'); rememberPlayed('chess'); rememberPlayed('gems'); assert.deepEqual(recentGames(),['gems','chess']);
localStorage.setItem('gn-favorites','bad json'); assert.deepEqual(favorites(),[]);

// Actual persistence module, with controllable timers and instrumented stores.
const timers = new Map(), listeners = {}; let timerId = 0;
const context = {
  CATALOG, loaders:{}, VERSION:'test', FILES:[], uid:()=> 'test', reconnectSecret:()=> 'secret', sha256hex:()=> '',
  sessionStorage:storage(), localStorage:storage(), console:{warn(){}},
  setTimeout(fn) { timers.set(++timerId,fn); return timerId; }, clearTimeout(id) { timers.delete(id); },
  addEventListener(name,fn) { listeners[name]=fn; }, document:{visibilityState:'visible',addEventListener(name,fn){listeners[name]=fn;}},
};
vm.createContext(context);
const source=fs.readFileSync(new URL('../js/state.js',import.meta.url),'utf8').replace(/\r\n/g,'\n').replace(/^import .*;\n/gm,'').replace(/^export \{.*\};\n/gm,'').replace(/^export /gm,'');
vm.runInContext(source+'\nglobalThis.test={S,saveSession,queueSessionSave,flushSessionSave,clearSession};',context);
const t=context.test;
t.S.role='local'; t.S.game={strokes:Array.from({length:500},(_,i)=>({color:'red',points:Array(40).fill(i)}))};
context.localStorage.writes=0;
let start=performance.now(); for(let i=0;i<100;i++) t.saveSession(); const immediateMs=performance.now()-start;
assert.equal(context.localStorage.writes,100);
context.localStorage.writes=0;
start=performance.now(); for(let i=0;i<100;i++) t.queueSessionSave(); t.flushSessionSave(); const batchedMs=performance.now()-start;
assert.equal(context.localStorage.writes,1); assert.equal(timers.size,0);
t.queueSessionSave(); context.document.visibilityState='hidden'; listeners.visibilitychange(); assert.equal(context.localStorage.writes,2);
t.queueSessionSave(); listeners.pagehide(); assert.equal(context.localStorage.writes,3);
t.queueSessionSave(); t.clearSession(); assert.equal(timers.size,0); assert.equal(context.localStorage.getItem('gn-session'),null);
context.localStorage.setItem=()=> {throw Error('Quota exceeded');};
assert.doesNotThrow(()=>t.saveSession(),'storage failures must not stop play');
console.log(`Persistence benchmark (synthetic drawing state, 100 requests): ${immediateMs.toFixed(1)} ms / 100 snapshots -> ${batchedMs.toFixed(1)} ms / 1 snapshot. This measures serialization and mocked writes, not browser disk latency.`);

// Actual voice module: use fake media only, never request a real microphone.
const children=[];
globalThis.document={body:{appendChild(){}},createElement(tag){const node={children:[],dataset:{},appendChild(n){this.children.push(n);},remove(){children.splice(children.indexOf(this),1);},play:()=>Promise.resolve()}; if(tag==='div')node.children=children; return node;}};
let stopped=0;
const stream={getTracks:()=>[{stop(){stopped++;}}],getAudioTracks:()=>[{enabled:true}]};
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:async()=>stream}}});
const voice=createVoice({toast(){},onChange(){}});
const call=(peer)=>({peer,events:{},answered:false,closed:false,on(e,fn){this.events[e]=fn;},answer(s){this.answered=s===stream;},close(){this.closed=true;this.events.close?.();}});
await voice.join();
const stranger=call('stranger'); voice.answer(stranger); assert.equal(stranger.answered,false);
const early=call('friend'); voice.answer(early); assert.equal(early.answered,false);
const peer={id:'z-self',call(){throw Error('Unexpected outgoing call');}};
voice.sync([['me','z-self'],['friend','friend']],peer);
assert.equal(early.answered,true,'a call that arrived before its authorized roster can connect');
assert.equal(stranger.answered,false,'unlisted callers never receive audio');
voice.sync([['me','z-self']],peer); assert.equal(early.closed,true,'revoked members are disconnected');
voice.leave(); assert.equal(stranger.closed,true); assert.equal(stopped,1);
let resolveMedia;
navigator.mediaDevices.getUserMedia=()=>new Promise((resolve)=>{resolveMedia=resolve;});
const joining=voice.join(); voice.leave(); resolveMedia(stream); assert.equal(await joining,false); assert.equal(voice.active,false); assert.equal(stopped,2);
console.log('Reliability checks passed: library filters, local preferences, bounded saves, lifecycle flush, quota failure, authorized voice, roster race, revocation, canceled microphone request.');
