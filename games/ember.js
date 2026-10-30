import { cooperative, action, distance, finish, tile } from './coop-kit.js';
import { rand } from '../js/util.js';
const names=['River Camp','Pine Ridge','Fox Hollow','East Grove','Cedar Pass','Watchtower','Fernwood','Deer Meadow','Creek Bend','Oak Stand','Owl Nest','North Trail','Willow Village','Moss Hill','Badger Den','Ash Village'];
const animalSites=[2,7,10,14];
export default cooperative({
  id:'ember',theme:'ember',name:'Emberwatch',description:'Read the wind, contain spreading fire, and bring woodland animals safely to the river camp.',
  goal:'Rescue four woodland animals to River Camp while protecting both villages from the wildfire.',limit:24,timeout:'Night fell before the rescue was complete. The remaining forest paths became impassable.',
  roles:[['Ranger','Move up to two forest spaces.'],['Firefighter','Extinguish two fire levels for one water.'],['Medic','Rescue animals even in heavy fire.'],['Weatherkeeper','Shelter the forest from one spreading fire.']],
  steps:['Identify animal locations and the current wind direction.','Move, fight fire, refill at camp, rescue an animal, or deliver carried animals.','The wind spreads fire after every team round. Villages at fire level 3 lose protection.'],
  tips:['Carry animals back to River Camp to count them as rescued.','Water is personal: refill at camp or use a turn to collect one water from the rain barrel.','Firebreaks reduce the next fire spread. Keep villages below fire level 3.'],
  setup(s){s.tiles=names.map((name,i)=>({name,fire:[3,6,11].includes(i)?1:0,animal:animalSites.includes(i)}));s.players.forEach(p=>{p.water=3;p.carry=0;});s.rescued=0;s.safety=8;s.wind=0;s.breaks=0;},
  moves(s,p){const m=[],here=s.tiles[p.pos];const targets=p.carry?[0]:animalSites.filter(i=>s.tiles[i].animal);const target=targets.sort((a,b)=>distance(p.pos,a)-distance(p.pos,b))[0]??0;
    for(let to=0;to<16;to++)if(to!==p.pos&&distance(p.pos,to)<=(p.role==='Ranger'?2:1))m.push(action('move',`Travel to ${names[to]}`,30+10*(distance(p.pos,target)-distance(to,target)),{to}));
    if(here.fire&&p.water)m.push(action('water',`Fight fire (${here.fire}/3)`,[12,15].includes(p.pos)&&here.fire>=2?110:here.animal&&here.fire>=2?100:25));
    if(here.animal&&(here.fire<2||p.role==='Medic'))m.push(action('rescue','Rescue the animal here',95));
    if(p.pos===0&&p.carry)m.push(action('deliver',`Deliver ${p.carry} rescued animal${p.carry>1?'s':''}`,120));
    if(p.water<4)m.push(action('refill',p.pos===0?'Refill water to 4':'Collect 1 water',p.water===0&&here.fire?105:5));
    m.push(action('break',p.role==='Weatherkeeper'?'Forecast: prevent two fire spreads':'Build a firebreak (prevent one spread)',s.rescued===4?100:0));return m;},
  perform(s,p,a){if(a.type==='move')p.pos=a.to;if(a.type==='water'){s.tiles[p.pos].fire=Math.max(0,s.tiles[p.pos].fire-(p.role==='Firefighter'?2:1));p.water--;}if(a.type==='rescue'){s.tiles[p.pos].animal=false;p.carry++;}if(a.type==='deliver'){s.rescued+=p.carry;p.carry=0;}if(a.type==='refill')p.water=p.pos===0?4:Math.min(4,p.water+1);if(a.type==='break')s.breaks+=p.role==='Weatherkeeper'?2:1;},
  event(s){const burning=s.tiles.map((t,i)=>t.fire?i:-1).filter(i=>i>0);let n=Math.max(0,1+s.difficulty-s.breaks);s.breaks=0;const offsets=[-4,1,4,-1];for(let k=0;k<n;k++){const source=burning.length?burning[rand(burning.length)]:6;let to=source+offsets[s.wind];if(to<=0||to>=16||distance(source,to)!==1)to=source;s.tiles[to].fire=Math.min(3,s.tiles[to].fire+1);}const damage=[12,15].filter(i=>s.tiles[i].fire>=3).length;s.safety-=damage;s.event=`${['North','East','South','West'][s.wind]} wind: ${n} fire spread${n===1?'':'s'}.${damage?' Villages lost '+damage+' protection.':''}`;s.wind=(s.wind+1)%4;},
  check(s){if(s.safety<=0)finish(s,false,'Both villages exhausted their protection. The rescue team withdrew.');else if(s.rescued===4)finish(s,true,'All four animals are safe at River Camp, and the villages still stand.');},
  meters:s=>[['Animals safe',`${s.rescued} / 4`],['Village protection',`${s.safety} / 8`],['Next wind',['North ↑','East →','South ↓','West ←'][s.wind]]],
  hint:()=> 'Rescue animals, carry them home, and protect the villages.',personal:(s,p)=>`${names[p.pos]} · Water ${p.water}/4 · Carrying ${p.carry}`,
  board:s=>`<div class="coop-board">${s.tiles.map((r,i)=>tile(s,i,r.name,i===0?'≈':r.animal?'♧':[12,15].includes(i)?'⌂':'♠',`${r.animal?'Animal · ':''}Fire ${r.fire}/3`,r.fire)).join('')}</div>`,
});
