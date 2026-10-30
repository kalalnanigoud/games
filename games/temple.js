import { cooperative, action, distance, finish, tile } from './coop-kit.js';
import { rand } from '../js/util.js';
const names=['Landing','Mosaic Hall','West Steps','Moon Well','Courtyard','Echo Vault','Sun Shrine','Aqueduct','Old Library','Stone Gate','Jade Chamber','Deep Stairs','Observatory','Root Garden','Royal Crypt','Star Altar'];
const relics=[5,10,15];
const goalFor=(s,p)=>{const unclaimed=relics.filter(i=>s.rooms[i].relic);if(!unclaimed.length)return 0;return unclaimed.sort((a,b)=>distance(p.pos,a)-distance(p.pos,b))[0];};
export default cooperative({
  id:'temple',theme:'temple',name:'Sunken Temple',description:'Recover three ancient relics, keep the water at bay, and bring the whole expedition home.',
  goal:'Recover all three relics and bring every explorer back to the landing before the temple floods.',limit:30,timeout:'The temple disappeared beneath the water before everyone escaped.',
  roles:[['Explorer','Move up to two rooms per action.'],['Engineer','Drain two water levels at once.'],['Scholar','Uncover relics twice as quickly.'],['Diver','Excavate even in deeply flooded rooms.']],
  steps:['Choose a difficulty and agree who will recover each relic.','Move, excavate a relic, or drain the room you occupy. Each player takes one action.','After everyone acts, water rises in several rooms. Return everyone to the landing after collecting the relics.'],
  tips:['Relic rooms need three excavation points. Water level 3 or 4 stops excavation unless you are the Diver.','The landing stays dry. Draining water also lowers the shared flood pressure.','All information is shared. Coordinate routes instead of sending everyone to the same relic.'],
  setup(s){s.rooms=names.map((name,i)=>({name,water:0,work:0,relic:relics.includes(i)}));s.recovered=0;s.pressure=0;},
  moves(s,p){
    const target=goalFor(s,p), room=s.rooms[p.pos], moves=[];
    for(let to=0;to<16;to++)if(to!==p.pos&&distance(p.pos,to)<=(p.role==='Explorer'?2:1)){
      const occupied=s.players.some(q=>q.id!==p.id&&q.pos===to&&s.rooms[to].relic);
      moves.push(action('move',`Move to ${names[to]}`,30+10*(distance(p.pos,target)-distance(to,target))-(occupied?8:0),{to}));
    }
    if(room.relic&&(room.water<3||p.role==='Diver'))moves.push(action('dig',`Excavate relic (${room.work}/3)`,85));
    if(room.water>0)moves.push(action('drain',`Drain ${p.role==='Engineer'?2:1} water level${p.role==='Engineer'?'s':''}`,room.water>=3&&room.relic?95:s.pressure>13?90:15));
    if(s.recovered===3&&p.pos===0)moves.push(action('wait','Hold the landing for the team',100));
    moves.push(action('rest','Secure the flood gates (lower pressure by 3)',s.pressure>23?110:0));return moves;
  },
  perform(s,p,a){if(a.type==='move')p.pos=a.to;if(a.type==='drain'){const n=Math.min(s.rooms[p.pos].water,p.role==='Engineer'?2:1);s.rooms[p.pos].water-=n;s.pressure=Math.max(0,s.pressure-n);}if(a.type==='rest')s.pressure=Math.max(0,s.pressure-3);if(a.type==='dig'){const r=s.rooms[p.pos];r.work+=p.role==='Scholar'?2:1;if(r.work>=3){r.relic=false;s.recovered++;}}},
  event(s){const n=2+s.difficulty;for(let k=0;k<n;k++){const i=1+rand(15);s.rooms[i].water=Math.min(4,s.rooms[i].water+1);}s.pressure+=s.difficulty+1;s.event=`A deep tremor floods ${n} chambers. Flood pressure rises by ${s.difficulty+1}.`;},
  check(s){if(s.recovered===3&&s.players.every(p=>p.pos===0))finish(s,true,'Three relics recovered. Every explorer reached the landing safely.');else if(s.pressure>=30)finish(s,false,'The flood gates failed. The team had to abandon the relics.');},
  meters:s=>[['Relics',`${s.recovered} / 3`],['Flood pressure',`${s.pressure} / 30`],['At landing',`${s.players.filter(p=>p.pos===0).length} / ${s.players.length}`]],
  hint:(s,p)=>s.recovered===3?'Return to the landing.':'Recover relics and keep flood pressure below 30.',
  personal:(s,p)=>`Location: ${names[p.pos]}`,
  board:s=>`<div class="coop-board">${s.rooms.map((r,i)=>tile(s,i,r.name,i===0?'⚓':r.relic?'◆':r.work>=3?'✧':'▥',`${r.relic?'Relic '+r.work+'/3 · ':''}Water ${r.water}/4`,r.water)).join('')}</div>`,
});
