// Creature Island content: creatures, moves, items, gear, people and quests. Plain data, shared by the
// host's world (island-sim.js) and every player's screen (island-client.js).

export const CONTENT_VERSION = 1;
export const TILE = 32;
export const TICK = 0.05; // the host's world steps 20 times a second
export const MAX_LV = 30;
export const TEAM_MAX = 3;
export const RANCH_MAX = 60;
export const CATCH_HP = 0.35; // a wild creature at or below this share of its health can be befriended
export const SEATS = [
  { color: '#ff6b6b', shape: 'circle', label: 'Coral' },
  { color: '#4dabf7', shape: 'triangle', label: 'Sky' },
  { color: '#ffd43b', shape: 'square', label: 'Gold' },
  { color: '#b197fc', shape: 'diamond', label: 'Violet' },
];

// Elements: each beats the ones listed (1.5× damage); the reverse is 0.67×.
export const ELEMENTS = {
  leaf: { name: 'Leaf', color: '#51cf66', beats: ['tide', 'stone'] },
  tide: { name: 'Tide', color: '#4dabf7', beats: ['ember', 'stone'] },
  ember: { name: 'Ember', color: '#ff922b', beats: ['leaf', 'shade'] },
  spark: { name: 'Spark', color: '#ffd43b', beats: ['tide', 'storm'] },
  stone: { name: 'Stone', color: '#c4a484', beats: ['spark', 'ember', 'storm'] },
  moon: { name: 'Moon', color: '#d0bfff', beats: ['shade', 'storm'] },
  shade: { name: 'Shade', color: '#845ef7', beats: [] },
  storm: { name: 'Storm', color: '#748ffc', beats: ['tide'] },
};
export function typeMult(attacker, defender) {
  if (ELEMENTS[attacker]?.beats.includes(defender)) return 1.5;
  if (ELEMENTS[defender]?.beats.includes(attacker)) return 0.67;
  return 1;
}

// attack: how it fights as a wild creature and as a companion. lunge = a short dash bite, spit = a slow
// projectile, zap = a strike that lands where its target stood, spore = a burst around itself.
// temper: shy creatures run from you, calm ones fight back when hit, feisty ones come for you.
export const SPECIES = {
  mossip: { name: 'Mossip', el: 'leaf', hp: 46, atk: 9, spd: 120, r: 11, temper: 'calm', catch: 0.55, attack: 'lunge', ability: 'leafstorm', blurb: 'A loyal pup whose moss mane soaks up sunshine.' },
  emberkit: { name: 'Emberkit', el: 'ember', hp: 40, atk: 11, spd: 125, r: 11, temper: 'calm', catch: 0.5, attack: 'lunge', ability: 'flameburst', blurb: 'A brave kitten. Its ear tips flicker when it is happy.' },
  dewpaw: { name: 'Dewpaw', el: 'tide', hp: 50, atk: 9, spd: 115, r: 11, temper: 'calm', catch: 0.5, attack: 'spit', ability: 'bubblering', blurb: 'A playful otter pup that blows shielding bubbles.' },
  nettlebug: { name: 'Nettlebug', el: 'leaf', hp: 34, atk: 8, spd: 95, r: 10, temper: 'feisty', catch: 0.7, attack: 'lunge', ability: 'thornvolley', blurb: 'Small, round and very sure it is the biggest thing in the woods.' },
  puffcap: { name: 'Puffcap', el: 'leaf', hp: 34, atk: 6, spd: 85, r: 10, temper: 'shy', catch: 0.8, attack: 'spore', ability: 'healspores', blurb: 'A timid mushroom whose spores soothe wounds.' },
  clackle: { name: 'Clackle', el: 'tide', hp: 52, atk: 10, spd: 90, r: 12, temper: 'calm', catch: 0.6, attack: 'lunge', ability: 'clawcrush', blurb: 'Proud of its one enormous claw. Rightly so.' },
  gullwisp: { name: 'Gullwisp', el: 'spark', hp: 38, atk: 10, spd: 150, r: 11, temper: 'calm', catch: 0.6, attack: 'zap', ability: 'thunderdive', blurb: 'Rides sea winds; its wingtips crackle before a storm.' },
  ripplefin: { name: 'Ripplefin', el: 'tide', hp: 58, atk: 11, spd: 105, r: 12, temper: 'calm', catch: 0.5, attack: 'spit', ability: 'tidalwave', blurb: 'Its frills feel every ripple across Mirror Lake.' },
  gemmole: { name: 'Gemmole', el: 'stone', hp: 66, atk: 12, spd: 90, r: 13, temper: 'feisty', catch: 0.45, attack: 'lunge', ability: 'quake', blurb: 'Digs tunnels by headbutting crystal. Hard-headed in every way.' },
  fizzwing: { name: 'Fizzwing', el: 'spark', hp: 46, atk: 12, spd: 130, r: 11, temper: 'calm', catch: 0.5, attack: 'zap', ability: 'staticfield', blurb: 'Its antennae glow brighter the deeper the cave goes.' },
  cindermite: { name: 'Cindermite', el: 'ember', hp: 58, atk: 14, spd: 115, r: 12, temper: 'feisty', catch: 0.45, attack: 'spit', ability: 'flameburst', blurb: 'Basks on hot rocks near the peak and spits embers at strangers.' },
  lunahop: { name: 'Lunahop', el: 'moon', hp: 62, atk: 13, spd: 175, r: 12, temper: 'shy', catch: 0.35, attack: 'lunge', ability: 'moonbeam', rare: true, blurb: 'Rarely seen. Leaves glowing tracks on moonlit sand.' },
};
export const STARTERS = ['mossip', 'emberkit', 'dewpaw'];
// Shadowy minions of the storm: never befriended, always hostile.
export const MURKS = {
  murk: { name: 'Murkling', el: 'shade', hp: 30, atk: 9, spd: 105, r: 11, attack: 'lunge' },
  murkbrute: { name: 'Murk Brute', el: 'shade', hp: 120, atk: 15, spd: 80, r: 18, attack: 'spore', big: true },
};

// Companion abilities: cd in seconds, power × the creature's attack.
export const ABILITIES = {
  leafstorm: { name: 'Leaf Storm', cd: 7, power: 1.6, desc: 'Whirling leaves hit everything around your companion.' },
  flameburst: { name: 'Flame Burst', cd: 7, power: 1.8, desc: 'A cone of fire in front of your companion.' },
  bubblering: { name: 'Bubble Ring', cd: 9, power: 0.8, desc: 'A bubble shields you and pushes enemies back.' },
  thornvolley: { name: 'Thorn Volley', cd: 6, power: 1.0, desc: 'Three thorns fly at the nearest enemies.' },
  healspores: { name: 'Healing Spores', cd: 12, power: 0, desc: 'Heals you, your companion and nearby friends.' },
  clawcrush: { name: 'Claw Crush', cd: 7, power: 2.4, desc: 'One crushing pinch on the nearest enemy.' },
  thunderdive: { name: 'Thunder Dive', cd: 7, power: 2.0, desc: 'Dives through an enemy with a crack of lightning.' },
  tidalwave: { name: 'Tidal Wave', cd: 8, power: 1.8, desc: 'A rolling wave that knocks enemies back.' },
  quake: { name: 'Quake', cd: 10, power: 2.0, desc: 'Shakes the ground around it and stuns enemies.' },
  staticfield: { name: 'Static Field', cd: 9, power: 0.5, desc: 'A crackling field that zaps and slows enemies inside.' },
  moonbeam: { name: 'Moonbeam', cd: 8, power: 2.2, desc: 'A long beam of moonlight.' },
};

export const ITEMS = {
  sunberry: { name: 'Sunberry', desc: 'Restores 35 HP to you or your companion.', price: 10, use: 'heal', amount: 35 },
  bigberry: { name: 'Big Berry', desc: 'Restores 100 HP to you or your companion.', price: 30, use: 'heal', amount: 100 },
  seed: { name: 'Revive Seed', desc: 'Wakes a fainted companion with half its HP.', price: 40, use: 'revive' },
  charm: { name: 'Bond Charm', desc: 'Throw it at a weakened wild creature to befriend it.', price: 15 },
  driftwood: { name: 'Driftwood', desc: 'Sea-smoothed wood from the beach.' },
  mushroom: { name: 'Forest Mushroom', desc: 'The merchant buys these.', sell: 6 },
  crystal: { name: 'Glow Crystal', desc: 'Hums softly. Used for crystal gear.', sell: 12 },
  tideshard: { name: 'Tide Shard', desc: 'One of the three island shards. From the Mirebrute.', key: true },
  stoneshard: { name: 'Stone Shard', desc: 'One of the three island shards. From the Quartzhulk.', key: true },
  embershard: { name: 'Ember Shard', desc: 'One of the three island shards. The village’s own.', key: true },
};
export const GEAR = {
  staff: { name: 'Wooden Staff', kind: 'weapon', dmg: 8, desc: 'A sturdy walking staff.' },
  bronzeblade: { name: 'Bronze Blade', kind: 'weapon', dmg: 12, price: 150, desc: 'Hits half again as hard as a staff.' },
  crystalblade: { name: 'Crystal Blade', kind: 'weapon', dmg: 17, craft: { crystal: 6, shells: 120 }, desc: 'Forged from Glowdeep crystal.' },
  leafcharm: { name: 'Leaf Charm', kind: 'charm', price: 120, desc: 'Your companion hits 20% harder.' },
  tidecharm: { name: 'Tide Charm', kind: 'charm', price: 120, desc: '+30 max HP.' },
  feather: { name: 'Swift Feather', kind: 'charm', desc: 'Move 12% faster and dodge more often.' },
};
export const SHOP = ['sunberry', 'charm', 'seed', 'bigberry', 'bronzeblade', 'leafcharm', 'tidecharm'];

export const PLAYER = { hp: 100, hpPerLv: 12, speed: 150, r: 9, swing: 0.38, reach: 54, arc: 1.05, dodge: 0.26, dodgeSpeed: 430, dodgeCd: 0.85, downFor: 30, revive: 1.5 };
export const xpToNext = (lv) => Math.round(24 * Math.pow(lv, 1.5));
export const creatureMax = (sp, lv) => Math.round((SPECIES[sp] || MURKS[sp]).hp * (1 + 0.11 * (lv - 1)));
export const creatureAtk = (sp, lv) => (SPECIES[sp] || MURKS[sp]).atk * (1 + 0.09 * (lv - 1));
export const playerMax = (lv, charm) => PLAYER.hp + PLAYER.hpPerLv * (lv - 1) + (charm === 'tidecharm' ? 30 : 0);

// People of the island, where they stand (tile coordinates), and what they're about.
export const NPCS = {
  elder: { name: 'Elder Maru', at: [68, 65.6], dir: 'down' },
  healer: { name: 'Healer Sana', at: [53.5, 70.3], dir: 'down' },
  merchant: { name: 'Toma the Merchant', at: [74.5, 70.3], dir: 'down' },
  kid: { name: 'Lili', at: [60.5, 74.5], dir: 'right' },
  ranger: { name: 'Captain Ash', at: [64, 57.5], dir: 'down' },
  fisher: { name: 'Old Reed', at: [97, 42.6], dir: 'up' },
};

// Quests: stage 0 = not offered, 1 = active, 2 = ready to hand in (where needed), 9 = done.
// main: the story line, shown first in the tracker.
export const QUESTS = {
  starter: { name: 'A Companion of Your Own', main: true, giver: 'elder', steps: { 1: 'Talk to Elder Maru in the village square.' } },
  supplies: { name: 'Supplies for the Healer', giver: 'healer', need: { sunberry: 5 }, steps: { 1: 'Pick 5 Sunberries from berry bushes in Whispering Woods.', 2: 'Bring the Sunberries to Healer Sana.' } },
  bridge: { name: 'Mend the River Bridge', main: true, giver: 'ranger', need: { driftwood: 4 }, steps: { 1: 'Collect 4 Driftwood on Sunsand Shore.', 2: 'Bring the Driftwood to Captain Ash.' } },
  marsh: { name: 'Something in the Marsh', main: true, giver: 'fisher', steps: { 1: 'Defeat whatever lurks in the marsh north of Mirror Lake.' } },
  cave: { name: 'The Glow Beneath', main: true, giver: 'ranger', steps: { 1: 'Explore Glowdeep Cave and face what guards its deepest chamber.' } },
  defend: { name: 'Hold the Village', main: true, giver: 'elder', steps: { 1: 'Return to the village: murklings are coming!', 2: 'Drive the murklings out of the village.' } },
  peak: { name: 'The Storm on Stormcrown', main: true, giver: 'elder', steps: { 1: 'Climb Stormcrown Peak and calm the storm.' } },
  lost: { name: 'A Cry in the Woods', giver: 'kid', steps: { 1: 'Find the hurt creature in the woods’ western clearing.', 2: 'Lead it to Healer Sana in the village.' } },
  tracks: { name: 'Glowing Tracks', giver: 'kid', steps: { 1: 'Follow the glowing tracks along Sunsand Shore.', 2: 'Befriend the Lunahop before it slips away!' } },
  fishing: { name: 'The Lake’s Pride', giver: 'fisher', steps: { 1: 'Befriend a Ripplefin and show it to Old Reed.' } },
  collector: { name: 'Friends of Every Kind', giver: 'elder', steps: { 1: 'Befriend 6 different kinds of creatures.' } },
};
export const QUEST_ORDER = ['starter', 'bridge', 'supplies', 'marsh', 'cave', 'defend', 'peak', 'lost', 'tracks', 'fishing', 'collector'];

// Bosses: hp before scaling for the party, the shard they leave, and the flag a win sets.
export const BOSSES = {
  mirebrute: { name: 'Mirebrute', el: 'tide', hp: 900, atk: 18, r: 40, speed: 70, shard: 'tideshard', quest: 'marsh', title: 'Terror of the Marsh' },
  quartzhulk: { name: 'Quartzhulk', el: 'stone', hp: 1400, atk: 22, r: 42, speed: 62, shard: 'stoneshard', quest: 'cave', title: 'Warden of Glowdeep' },
  tempestra: { name: 'Tempestra', el: 'storm', hp: 2400, atk: 26, r: 56, speed: 90, shard: null, quest: 'peak', title: 'Heart of the Storm' },
};

export const AREAS = {
  village: 'Brightwater Village', woods: 'Whispering Woods', shore: 'Sunsand Shore', lake: 'Mirror Lake',
  marsh: 'Mirelight Marsh', cave: 'Glowdeep Cave', peak: 'Stormcrown Peak', meadow: 'Island Meadows', cliffs: 'Northern Cliffs',
};
