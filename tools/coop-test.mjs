import assert from 'node:assert/strict';
import {GAMES} from '../games/index.js';
const games=GAMES.filter(g=>['temple','ember'].includes(g.id));
for(const g of games){
 for(let n=g.minPlayers;n<=g.maxPlayers;n++)for(let level=0;level<3;level++){
  let wins=0;
  for(let run=0;run<50;run++){
   const s=g.setup(Array.from({length:n},(_,i)=>({id:'P'+i,name:'Player '+i})));
   assert.throws(()=>g.act(s,'P1',{type:'begin',level}));
   assert.throws(()=>g.act(s,'P0',{type:'begin',level:9}));
   g.act(s,'P0',{type:'begin',level});
   let turns=0;
   while(!s.over){
    const pid=g.turnOf(s)[0], before=JSON.stringify(s);
    assert.throws(()=>g.act(s,pid,{type:'invalid'}));assert.equal(JSON.stringify(s),before);
    const view=g.view(s,pid);view.players[0].name='Mutated';assert.notEqual(s.players[0].name,'Mutated');
    g.act(s,pid,g.bot(g.view(s,pid),pid));
    assert.ok(++turns<1000);assert.deepEqual(JSON.parse(JSON.stringify(s)),s);
   }
   assert.equal(g.turnOf(s).length,0);assert.equal(s.winners.length,s.won?n:0);assert.throws(()=>g.act(s,'P0',{type:'rest'}));
   if(s.won)wins++;
  }
  console.log(`${g.id} ${n}p level ${level}: ${wins}/50 victories; all checks passed`);
 }
}

// Deterministic outcomes and role abilities, beyond bot-game coverage.
const fresh=(id,n=2)=>{const g=games.find(g=>g.id===id);const s=g.setup(Array.from({length:n},(_,i)=>({id:String.fromCharCode(65+i),name:String.fromCharCode(65+i)})));g.act(s,'A',{type:'begin',level:1});return [g,s];};
{
 const [g,s]=fresh('temple');s.recovered=3;s.players[0].pos=1;
 g.act(s,'A',{type:'move',to:0});assert.equal(s.won,true);assert.deepEqual(s.winners,['A','B']);
 const [h,t]=fresh('temple');t.cur=1;t.pressure=29;h.act(t,'B',{type:'move',to:1});assert.equal(t.won,false);assert.equal(t.over,true);
}
{
 const [g,s]=fresh('ember');s.rescued=3;s.players[0].carry=1;g.act(s,'A',{type:'deliver'});assert.equal(s.won,true);
 const [h,t]=fresh('ember',3);t.cur=1;t.players[1].pos=3;t.tiles[3].fire=3;h.act(t,'B',{type:'water'});assert.equal(t.tiles[3].fire,1);assert.equal(t.players[1].water,2);
 // Steady teammates build a firebreak when the next wind blows fire into a village one level from burning...
 const [e,u]=fresh('ember',3);u.cur=1;u.players[1].pos=0;u.players[1].water=4;u.tiles.forEach(x=>x.fire=0);u.tiles[8].fire=1;u.tiles[12].fire=2;u.wind=2;
 const steady=()=>e.bot({...e.view(u,'B'),level:'normal'},'B');
 assert.equal(steady().type,'break');e.act(u,'B',steady());assert.equal(u.breaks,1);
 // ...but not once the next spreads are all prevented, nor when the wind blows the fire away from the villages.
 u.cur=1;u.breaks=2;assert.notEqual(steady().type,'break');
 u.breaks=0;u.wind=0;u.tiles[12].fire=0;assert.notEqual(steady().type,'break');
}
console.log('Cooperative victory, defeat, and role ability checks passed.');

// Sunken Temple: original role names, the Tinkerer's brace, and wading through deep water.
{
 const g=games.find(g=>g.id==='temple');
 assert.deepEqual(['Explorer','Engineer','Scholar','Diver'].map(r=>g.roleInfo(r).name),['Pathfinder','Tinkerer','Scholar','Swimmer']);
 assert.doesNotMatch(g.roleInfo('Engineer').ability,/two/i,'the Tinkerer does not fix two at once');
 // No borrowed names anywhere a player can read: rules, roles, board, actions, journal, through whole bot games.
 for(let n=2;n<=4;n++){
  const s=g.setup(Array.from({length:n},(_,i)=>({id:'P'+i,name:'Player '+i})),{level:'hard'});
  const words=(st)=>{const text=g.textOf(st);assert.doesNotMatch(text,/Explorer|Engineer|Diver|Forbidden|[Ll]anding/,`temple ${n}p shows an old name`);return text;};
  const rules=words(s);for(const r of ['Pathfinder','Tinkerer','Scholar','Swimmer'].slice(0,n))assert.ok(rules.includes(r),`the ${r} appears in the rules`);
  assert.match(JSON.stringify(g.howTo),/boat/);assert.doesNotMatch(JSON.stringify(g.howTo)+g.description,/Explorer|Engineer|Diver|Forbidden|landing/);
  g.act(s,'P0',{type:'begin',level:2});
  while(!s.over){const pid=g.turnOf(s)[0];g.act(s,pid,g.bot(g.view(s,pid),pid));words(s);}
 }
 // Braced rooms shrug off every tremor.
 const [h,t]=fresh('temple');t.players[1].pos=6;t.cur=1;
 assert.ok(h.moves(t).some(m=>m.type==='brace'),'the Tinkerer can brace');assert.ok(!h.moves({...t,cur:0}).some(m=>m.type==='brace'),'only the Tinkerer braces');
 t.rooms.forEach((r,i)=>{r.braced=i!==6;});h.act(t,'B',{type:'brace'});assert.equal(t.rooms[6].braced,true);
 assert.equal(t.rooms.reduce((a,r)=>a+r.water,0),0);assert.match(t.event,/held by braces/);
 // Deep water takes two actions to wade into; the Swimmer swims straight in.
 const [w,u]=fresh('temple',4);u.rooms[1].water=3;
 w.act(u,'A',{type:'move',to:1});assert.equal(u.players[0].pos,0,'the first action only wades');assert.equal(u.players[0].wade,1);
 u.cur=3;w.act(u,'D',{type:'move',to:1});assert.equal(u.players[3].pos,1,'the Swimmer is not slowed');
 u.cur=0;w.act(u,'A',{type:'move',to:1});assert.equal(u.players[0].pos,1,'the second action arrives');
}

// Hazards grow with the team, and firebreaks or forecasts never cancel every spread.
const roundHazard=(id,n,level)=>{
 const g=games.find(g=>g.id===id);const s=g.setup(Array.from({length:n},(_,i)=>({id:'P'+i,name:'P'+i})));g.act(s,'P0',{type:'begin',level});
 for(let k=0;k<n;k++){const p=s.players[s.cur];g.act(s,p.id,id==='temple'?{type:'rest'}:{type:'refill'});}
 if(id==='temple'){const [,floods,pressure]=s.event.match(/floods (\d+) chambers.*rises by (\d+)/).map(Number);return floods+pressure;}
 return Number(s.event.match(/(\d+) fire spread/)[1]);
};
for(const id of ['temple','ember'])for(let level=0;level<3;level++){
 const by=[2,3,4].map(n=>roundHazard(id,n,level));
 assert.ok(by[0]<by[1]&&by[1]<=by[2]&&by[0]<by[2],`${id} level ${level}: hazards grow with the team ${by}`);
 assert.ok(by[0]>=1,`${id} level ${level}: there is always some threat`);
 if(level)assert.ok([2,3,4].every((n,k)=>roundHazard(id,n,level)>roundHazard(id,n,level-1)),`${id}: level ${level} is fiercer than level ${level-1}`);
}
{
 const [g,s]=fresh('ember',4);s.breaks=99;assert.match(g.textOf(s),/Next wind · \d+ spreads?/,'the HUD shows the coming spreads');
 const due=Number(g.textOf({...s,breaks:0}).match(/Next wind · (\d+) spread/)[1]), held=Number(g.textOf(s).match(/Next wind · (\d+) spread/)[1]);
 assert.ok(held>=1&&held>=due/2,`firebreaks hold back at most half the spreads (${held} of ${due} still spread)`);
}

// Daring is harder than Standard for the same teammates (seeded, so the numbers are stable).
{
 const {seededRandom}=await import('./seed.mjs');const keep=Math.random;
 for(const g of games){
  const wins=[1,2].map(level=>{let won=0;for(let r=0;r<40;r++){Math.random=seededRandom(`coop-difficulty:${g.id}:${level}:${r}`);
   const s=g.setup(Array.from({length:3},(_,i)=>({id:'P'+i,name:'P'+i})),{level:'hard'});g.act(s,'P0',{type:'begin',level});
   while(!s.over){const pid=g.turnOf(s)[0];g.act(s,pid,g.bot(g.view(s,pid),pid));}if(s.won)won++;}return won;});
  assert.ok(wins[1]<wins[0],`${g.id}: Expert teammates should win less on Daring than on Standard (${wins})`);
  console.log(`${g.id}: Expert teammates (3p) win ${wins[0]}/40 on Standard, ${wins[1]}/40 on Daring`);
 }
 Math.random=keep;
}
console.log('Cooperative role names, hazard scaling and difficulty checks passed.');
