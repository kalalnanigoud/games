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
}
console.log('Cooperative victory, defeat, and role ability checks passed.');
