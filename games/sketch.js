// Sketch Party: each turn one player draws a secret word while everyone else races to guess it.
//
// Strokes are sent in short chunks while you draw. Time-based events (hints, the end of a turn)
// are triggered by any player's screen sending { type: 'clock' }; the host's own clock decides.
// The game keeps its DOM between updates (keepDom), so the canvas and the guess box never reset.
import { esc, log, addFx, rand, shuffle, PLAYER_COLORS } from '../js/util.js';
import { injectCSS, floatText, morph } from '../js/fx.js';
import { sound } from '../js/sound.js';
import { icon } from '../js/icons.js';
import { portrait } from '../js/avatar.js';
import { levelOption, levelOf } from '../js/levels.js';

const browser = typeof document !== 'undefined';
const W = 1000, H = 750;
const COLORS = ['#1d1714', '#ffffff', '#e0523f', '#f08a24', '#f2c14e', '#3fa36b', '#3d7fd9', '#7b4fd6', '#d6559b', '#8a5a33'];
const COLOR_NAMES = ['Black', 'Eraser (white)', 'Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple', 'Pink', 'Brown'];
const SIZES = [6, 14, 32];
const CHOOSE_MS = 15000, REVEAL_MS = 6000;

const WORDS = `apple,banana,house,tree,car,bicycle,airplane,boat,fish,cat,dog,horse,cow,pig,chicken,duck,rabbit,mouse,elephant,giraffe,lion,
tiger,monkey,snake,turtle,frog,butterfly,spider,bee,snail,octopus,shark,whale,dolphin,penguin,owl,bird,dragon,unicorn,robot,
ghost,pirate,king,queen,wizard,clown,astronaut,doctor,chef,guitar,piano,drum,trumpet,violin,microphone,headphones,camera,
television,computer,phone,clock,glasses,hat,shoe,sock,shirt,dress,crown,ring,umbrella,backpack,key,lock,door,window,ladder,
bridge,castle,tent,lighthouse,rocket,train,bus,truck,tractor,helicopter,submarine,sun,moon,star,cloud,rain,snow,rainbow,
lightning,tornado,volcano,mountain,island,river,beach,desert,forest,cactus,flower,rose,mushroom,leaf,pumpkin,carrot,corn,pizza,
burger,sandwich,cake,cookie,donut,ice cream,popcorn,cheese,egg,bread,coffee,milk,candle,lamp,book,pencil,scissors,paint brush,
envelope,gift,balloon,kite,ball,football,basketball,trophy,medal,dice,puzzle,swing,slide,bed,chair,table,sofa,bath,toothbrush,
soap,mirror,fridge,spoon,fork,knife,cup,bottle,bucket,hammer,saw,shovel,broom,magnet,battery,light bulb,anchor,compass,map,flag,
sword,shield,bow,arrow,treasure,skeleton,heart,snowman,igloo,fire,bubble,spaceship,planet,alien,eye,nose,ear,hand,foot,tooth,
brain,smile,sleep,dance,swim,jump,laugh,sneeze,fishing,camping,skiing,surfing,waterfall,windmill,train track,hot dog,cupcake,
lollipop,watermelon,cherry,grapes,lemon,strawberry,snowflake,tooth fairy,mermaid,vampire,zombie,knight,ninja,pyramid,statue,
fountain,ferris wheel,roller coaster,bear,wolf,fox,deer,zebra,kangaroo,koala,panda,camel,hippo,rhino,crocodile,gorilla,squirrel,
hedgehog,bat,parrot,flamingo,peacock,swan,eagle,crab,lobster,jellyfish,starfish,seahorse,ant,ladybug,caterpillar,worm,scorpion,
sheep,goat,donkey,llama,sloth,otter,beaver,raccoon,skunk,chameleon,lizard,dinosaur,mosquito,dragonfly,goldfish,puppy,kitten,
polar bear,orange,pear,pineapple,coconut,avocado,broccoli,potato,tomato,onion,garlic,peas,peanut,pretzel,pancake,waffle,taco,
burrito,sushi,noodles,spaghetti,soup,salad,french fries,chocolate,candy,honey,pie,muffin,croissant,toast,cereal,milkshake,
lemonade,tea,popsicle,birthday cake,sausage,cucumber,mango,peach,blueberry,ice cube,candy cane,gingerbread man,toothpaste,comb,
hairbrush,towel,pillow,blanket,alarm clock,wallet,belt,tie,scarf,gloves,boots,sandals,jacket,pajamas,button,zipper,paper clip,
stapler,ruler,eraser,crayon,notebook,calculator,keyboard,laptop,remote control,radio,telescope,microscope,binoculars,flashlight,
lantern,hourglass,calendar,newspaper,stamp,postcard,suitcase,passport,ticket,coin,piggy bank,bandage,thermometer,toolbox,wrench,
screwdriver,nail,rope,chain,net,cage,basket,barrel,box,trash can,vacuum,iron,washing machine,oven,microwave,toaster,kettle,
teapot,frying pan,plate,bowl,chopsticks,straw,fan,chimney,fireplace,sink,shower,bunk bed,rocking chair,bench,hammock,seesaw,
sandbox,trampoline,skateboard,scooter,roller skates,ice skates,sled,snowball,surfboard,canoe,sailboat,ship,raft,parachute,
hot air balloon,motorcycle,ambulance,fire truck,police car,taxi,van,crane,bulldozer,wheel,traffic light,stop sign,road,tunnel,
barn,fence,gate,mailbox,doghouse,birdhouse,nest,treehouse,skyscraper,hospital,school,museum,library,zoo,circus,stadium,airport,
palace,ocean,wave,lake,pond,cave,cliff,iceberg,jungle,hill,sunset,comet,galaxy,earthquake,storm,wind,puddle,icicle,seashell,rock,
sand castle,coral,palm tree,pine tree,acorn,sunflower,tulip,daisy,grass,bush,log,campfire,princess,prince,fairy,giant,troll,elf,
witch,superhero,cowboy,firefighter,police officer,nurse,farmer,teacher,painter,singer,baby,scarecrow,magician,genie,phoenix,yeti,
mummy,monster,gnome,viking,caveman,explorer,detective,lifeguard,juggler,wand,potion,crystal ball,treasure chest,snow globe,
black hole,time machine,mustache,beard,lips,tongue,finger,thumb,knee,muscle,footprint,fingerprint,run,sing,cry,yawn,clap,climb,
fly,crawl,kick,dig,cook,read,write,hug,wink,shout,whisper,snore,shiver,bowling,golf,tennis,baseball,hockey,boxing,karate,yoga,
archery,diving,hiking,gardening,shopping,selfie,picnic,party,wedding,birthday,parade,fireworks,concert,magic trick,tug of war,
hide and seek,high five,thumbs up,piggyback,sleepwalking,snow angel,jump rope`
  .split(',').map((w) => w.trim()).filter(Boolean);

/* ---------------- doodles the computer can draw ---------------- */
// Point lists in the 1000 x 750 canvas. Computer guessers recognise these strokes, the way a
// person recognises a drawing; for human drawings they guess from the letter hints instead.
const ring = (cx, cy, rx, ry = rx, from = 0, to = 2 * Math.PI, n = 22) =>
  Array.from({ length: n + 1 }, (_, i) => { const a = from + ((to - from) * i) / n; return [Math.round(cx + rx * Math.cos(a)), Math.round(cy + ry * Math.sin(a))]; }).flat();
const S = (c, w, p) => ({ c, w, p });
const DOODLES = {
  sun: [S(4, 2, ring(500, 375, 130)), ...Array.from({ length: 8 }, (_, k) => { const a = (k * Math.PI) / 4; return S(3, 1, [500 + 170 * Math.cos(a), 375 + 170 * Math.sin(a), 500 + 250 * Math.cos(a), 375 + 250 * Math.sin(a)].map(Math.round)); })],
  house: [S(9, 1, [300, 600, 700, 600, 700, 360, 300, 360, 300, 600]), S(2, 1, [260, 380, 500, 170, 740, 380]), S(0, 1, [450, 600, 450, 470, 550, 470, 550, 600]), S(6, 1, [340, 420, 410, 420, 410, 480, 340, 480, 340, 420])],
  tree: [S(9, 2, [470, 680, 470, 460, 530, 460, 530, 680]), S(5, 2, ring(500, 320, 190, 170))],
  fish: [S(6, 2, ring(460, 375, 220, 120)), S(6, 2, [680, 375, 820, 270, 820, 480, 680, 375]), S(0, 1, ring(340, 345, 18))],
  star: [S(4, 2, [500, 120, 565, 300, 760, 300, 605, 415, 665, 610, 500, 500, 335, 610, 395, 415, 240, 300, 435, 300, 500, 120])],
  moon: [S(4, 2, [...ring(500, 375, 220, 220, -Math.PI / 2, Math.PI / 2), ...ring(440, 375, 150, 220, Math.PI / 2, -Math.PI / 2)])],
  heart: [S(2, 2, Array.from({ length: 33 }, (_, i) => { const t = (i / 32) * 2 * Math.PI; return [Math.round(500 + 16 * Math.sin(t) ** 3 * 16), Math.round(360 - (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * 16)]; }).flat())],
  flower: [S(5, 2, [500, 700, 500, 400]), ...[0, 1, 2, 3, 4].map((k) => { const a = (k * 2 * Math.PI) / 5 - Math.PI / 2; return S(8, 1, ring(Math.round(500 + 85 * Math.cos(a)), Math.round(300 + 85 * Math.sin(a)), 60)); }), S(4, 2, ring(500, 300, 45))],
  cloud: [S(6, 1, [...ring(380, 400, 110, 90, Math.PI / 2, Math.PI * 1.5), ...ring(500, 300, 140, 120, Math.PI, Math.PI * 2), ...ring(640, 400, 110, 90, -Math.PI / 2, Math.PI / 2), 380, 490])],
  apple: [S(2, 2, ring(500, 410, 200, 190)), S(9, 2, [500, 220, 520, 140]), S(5, 1, [520, 170, 600, 130, 640, 170, 560, 200, 520, 170])],
  boat: [S(9, 2, [250, 480, 750, 480, 660, 600, 340, 600, 250, 480]), S(0, 1, [500, 480, 500, 140]), S(2, 1, [510, 160, 700, 420, 510, 420, 510, 160])],
  cup: [S(6, 2, [380, 250, 620, 250, 590, 600, 410, 600, 380, 250]), S(6, 2, ring(650, 410, 70, 90, -Math.PI / 2, Math.PI / 2))],
  key: [S(4, 2, ring(330, 375, 90)), S(4, 2, [420, 375, 760, 375]), S(4, 2, [690, 375, 690, 450]), S(4, 2, [620, 375, 620, 440])],
  umbrella: [S(7, 2, [...ring(500, 380, 260, 200, Math.PI, 2 * Math.PI), 240, 380]), S(0, 2, [500, 380, 500, 620, ...ring(460, 620, 40, 40, 0, Math.PI, 8)])],
  mountain: [S(9, 2, [150, 620, 380, 260, 520, 470, 640, 330, 850, 620, 150, 620]), S(1, 1, [325, 345, 380, 260, 435, 345])],
  rainbow: [S(2, 2, ring(500, 600, 330, 330, Math.PI, 2 * Math.PI)), S(4, 2, ring(500, 600, 280, 280, Math.PI, 2 * Math.PI)), S(5, 2, ring(500, 600, 230, 230, Math.PI, 2 * Math.PI)), S(6, 2, ring(500, 600, 180, 180, Math.PI, 2 * Math.PI))],
  car: [S(2, 2, [200, 500, 200, 400, 340, 400, 420, 300, 620, 300, 700, 400, 800, 400, 800, 500, 200, 500]), S(0, 2, ring(320, 520, 60)), S(0, 2, ring(680, 520, 60))],
  eye: [S(0, 2, [...ring(500, 470, 300, 220, -Math.PI * 0.82, -Math.PI * 0.18), ...ring(500, 280, 300, 220, Math.PI * 0.18, Math.PI * 0.82)]), S(6, 2, ring(500, 375, 80)), S(0, 2, ring(500, 375, 30))],
  snowman: [S(0, 1, ring(500, 560, 140)), S(0, 1, ring(500, 330, 100)), S(0, 1, ring(500, 175, 70)), S(3, 2, [500, 175, 580, 190])],
  ladder: [S(9, 2, [400, 680, 400, 80]), S(9, 2, [600, 680, 600, 80]), ...[160, 280, 400, 520, 640].map((y) => S(9, 1, [400, y, 600, y]))],
};

/* ---------------- rules ---------------- */

const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
function close(a, b) {
  if (Math.abs(a.length - b.length) > 1 || b.length < 4) return false;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length] === 1;
}
const fits = (w, mask) => w.length === mask.length && [...mask].every((m, i) => (m === '_' ? w[i] !== ' ' : m === w[i]));
const say = (s, item) => { s.feed.push(item); if (s.feed.length > 50) s.feed.splice(0, s.feed.length - 50); };
const drawerOf = (s) => s.players[s.turn];
const named = (s, id) => s.players.find((p) => p.id === id)?.name || '?';

function chooseFor(s) {
  const drawer = drawerOf(s);
  const fresh = (list) => list.filter((w) => !s.used.includes(w));
  const doodle = shuffle(fresh(Object.keys(DOODLES)))[0] || 'star';
  const rest = shuffle(fresh(WORDS).filter((w) => w !== doodle)).slice(0, 2);
  Object.assign(s, { phase: 'choose', drawer: drawer.id, choices: shuffle([doodle, ...rest]), word: '', strokes: [], guessed: {}, hints: [], hintAt: [], hintPos: [], chooseUntil: Date.now() + CHOOSE_MS });
  log(s, `Round ${s.round}: ${drawer.name} is choosing a word.`);
}
function startDraw(s, word) {
  const letters = [...word].map((c, i) => (c === ' ' ? -1 : i)).filter((i) => i >= 0);
  const n = letters.length >= 5 ? 2 : letters.length >= 3 ? 1 : 0, now = Date.now();
  Object.assign(s, { phase: 'draw', word, choices: [], strokes: [], started: now, endsAt: now + s.drawMs, hintPos: shuffle(letters).slice(0, n), hintAt: [0.5, 0.75].slice(0, n).map((f) => now + s.drawMs * f), hints: [] });
  s.used.push(word);
  say(s, { k: 'sys', text: `${drawerOf(s).name} is drawing!` });
  addFx(s, { kind: 'sound', sound: 'flip' });
}
function reveal(s, why) {
  s.phase = 'reveal'; s.revealUntil = Date.now() + REVEAL_MS;
  const n = Object.keys(s.guessed).length;
  say(s, { k: 'sys', text: `${why} The word was “${s.word}”.` });
  log(s, `“${s.word}”: ${n} player${n === 1 ? '' : 's'} guessed it.`);
}
function nextTurn(s) {
  s.turn++;
  if (s.turn >= s.players.length) { s.turn = 0; s.round++; }
  if (s.round > s.rounds) {
    const best = Math.max(...s.players.map((p) => p.score));
    Object.assign(s, { phase: 'over', over: true, winners: s.players.filter((p) => p.score === best).map((p) => p.id) });
    log(s, `${s.winners.map((id) => named(s, id)).join(' & ')} won${best ? ` with ${best} points` : ''}!`);
    return;
  }
  chooseFor(s);
}
function tick(s) {
  const now = Date.now();
  if (s.phase === 'choose' && now >= s.chooseUntil) startDraw(s, s.choices[rand(s.choices.length)]);
  else if (s.phase === 'draw') {
    while (s.hints.length < s.hintAt.length && now >= s.hintAt[s.hints.length]) { s.hints.push(s.hintPos[s.hints.length]); addFx(s, { kind: 'sound', sound: 'card' }); }
    if (now >= s.endsAt) reveal(s, 'Time’s up!');
  } else if (s.phase === 'reveal' && now >= s.revealUntil) nextTurn(s);
}

function setup(players, opts = {}) {
  if (players.length < 2 || players.length > 8) throw Error('Sketch Party needs 2–8 players.');
  const s = {
    phase: 'choose', over: false, winners: [], round: 1, turn: 0, used: [], feed: [], log: [],
    rounds: [1, 2, 3].includes(Number(opts.rounds)) ? Number(opts.rounds) : 2,
    drawMs: [60, 80, 100].includes(Number(opts.time)) ? Number(opts.time) * 1000 : 80000,
    players: shuffle(players.map((p) => ({ id: p.id, name: p.name, score: 0 }))),
    level: levelOf(opts), // how sharp the computer guessers are; public, so it is in every view
  };
  chooseFor(s);
  return s;
}

function act(s, pid, a) {
  if (s.over) throw Error('The game is over.');
  const me = s.players.find((p) => p.id === pid);
  if (!me) throw Error('You are not playing in this game.');
  if (!a || typeof a !== 'object') throw Error('Choose something to do.');
  const drawing = s.phase === 'draw', isDrawer = pid === s.drawer;
  switch (a.type) {
    case 'think': return;
    case 'clock': return tick(s);
    case 'next': if (s.phase !== 'reveal') throw Error('Not yet.'); return nextTurn(s);
    case 'choose':
      if (s.phase !== 'choose' || !isDrawer) throw Error('Only the drawer chooses the word.');
      if (!Number.isInteger(a.i) || !s.choices[a.i]) throw Error('Pick one of the words.');
      return startDraw(s, s.choices[a.i]);
    case 'stroke': {
      if (!drawing || !isDrawer) throw Error('Only the drawer can draw.');
      const p = a.p;
      if (!Number.isInteger(a.c) || !COLORS[a.c] || !Number.isInteger(a.w) || !SIZES[a.w] || !Number.isInteger(a.g) || a.g < 0) throw Error('Bad brush.');
      if (!Array.isArray(p) || p.length < 2 || p.length > 600 || p.length % 2 || p.some((x, i) => !Number.isInteger(x) || x < 0 || x > (i % 2 ? H : W))) throw Error('Bad stroke.');
      if (s.strokes.length >= 2000) throw Error('The canvas is full. Clear it to keep drawing.');
      s.strokes.push({ c: a.c, w: a.w, g: a.g, p, ...(typeof a.k === 'string' && /^\w{1,12}$/.test(a.k) ? { k: a.k } : {}) });
      return;
    }
    case 'undo': {
      if (!drawing || !isDrawer) throw Error('Only the drawer can undo.');
      const g = s.strokes.at(-1)?.g;
      s.strokes = s.strokes.filter((x) => x.g !== g);
      return;
    }
    case 'clear':
      if (!drawing || !isDrawer) throw Error('Only the drawer can clear.');
      s.strokes = [];
      return;
    case 'skip':
      if (!drawing || !isDrawer) throw Error('Only the drawer can give up.');
      return reveal(s, `${me.name} gave up.`);
    case 'guess': {
      if (!drawing) throw Error('Wait for the next drawing.');
      if (isDrawer) throw Error('You are the one drawing!');
      if (s.guessed[pid]) throw Error('You already guessed it.');
      const text = norm(a.text).slice(0, 40);
      if (!text) throw Error('Type a guess.');
      if (text === s.word) {
        const left = Math.max(0, s.endsAt - Date.now());
        const pts = Math.max(50, Math.round((300 * left) / s.drawMs / 10) * 10);
        s.guessed[pid] = pts;
        me.score += pts;
        drawerOf(s).score += 50;
        say(s, { k: 'right', pid, text: `${me.name} guessed the word! +${pts}` });
        addFx(s, { kind: 'sound', sound: 'chime' });
        if (Object.keys(s.guessed).length >= s.players.length - 1) reveal(s, 'Everyone got it!');
      } else if (close(text, s.word)) say(s, { k: 'close', pid, to: pid, text: `“${text}” is very close!` });
      else say(s, { k: 'guess', pid, text });
      return;
    }
  }
  throw Error('Unknown action.');
}

function view(s, pid) {
  const v = JSON.parse(JSON.stringify(s));
  const knows = pid === s.drawer || s.guessed[pid] || s.phase === 'reveal' || s.over;
  if (pid !== s.drawer) v.choices = [];
  v.mask = [...s.word].map((c, i) => (c === ' ' ? ' ' : knows || s.hints.includes(i) ? c : '_')).join('');
  if (!knows) v.word = '';
  delete v.hintPos;
  v.used = s.used.length; // the list itself would reveal the current word
  v.feed = s.feed.filter((f) => !f.to || f.to === pid);
  v.hostNow = Date.now();
  return v;
}

// Computer guessers recognise their own doodles stroke by stroke and otherwise guess from the letter hints.
// That is the Normal level. Easy guessers (v.level) pause more, need more of the picture and often name the
// wrong thing; Hard ones guess more often, spot a doodle from its first line and rule out every wrong guess.
// The drawing is the same at every level.
const IDLE = { easy: [0.85, 0.6], normal: [0.75, 0.4], hard: [0.6, 0.2] };
function bot(v, pid) {
  const level = v.level === 'easy' || v.level === 'hard' ? v.level : 'normal';
  const think = { type: 'think' }, idle = IDLE[level][browser ? 0 : 1];
  const deadline = v.phase === 'choose' ? v.chooseUntil : v.phase === 'reveal' ? v.revealUntil : v.phase === 'draw' ? Math.min(v.endsAt, v.hintAt[v.hints.length] ?? Infinity) : Infinity;
  const due = Date.now() >= deadline;
  if (v.phase === 'choose') {
    const i = v.choices.findIndex((w) => DOODLES[w]);
    return { type: 'choose', i: i >= 0 ? i : rand(v.choices.length) };
  }
  if (v.phase === 'reveal') return browser ? (due ? { type: 'clock' } : think) : { type: 'next' };
  if (pid === v.drawer) {
    const D = DOODLES[v.word];
    if (D && v.strokes.length < D.length) return browser && Math.random() < 0.3 ? think : { type: 'stroke', ...D[v.strokes.length], g: v.strokes.length + 1 };
    return browser ? (due ? { type: 'clock' } : think) : { type: 'skip' };
  }
  if (v.guessed[pid] || Math.random() < idle) return due ? { type: 'clock' } : think;
  if (level !== 'normal') return levelGuess(v, pid, level) || (due ? { type: 'clock' } : think);
  for (const [w, D] of Object.entries(DOODLES))
    if (v.strokes.length >= 2 && v.strokes.length <= D.length && v.strokes.every((st, i) => st.p.join() === D[i].p.join())) return { type: 'guess', text: w };
  const tried = new Set(v.feed.filter((f) => f.pid === pid).map((f) => f.text));
  const options = WORDS.filter((w) => fits(w, v.mask) && !tried.has(w));
  if (options.length && options.length <= (browser ? 12 : 1000)) return { type: 'guess', text: options[rand(options.length)] };
  return due ? { type: 'clock' } : think;
}

// A guess at the Easy or Hard level, or null to wait. Only what every guesser sees: the strokes, the letter
// hints, the guesses so far this turn, and the near misses shown to this player.
function levelGuess(v, pid, level) {
  const n = v.strokes.length;
  const turn = v.feed.slice(v.feed.map((f) => f.k).lastIndexOf('sys') + 1); // since "… is drawing!"
  const looks = (D, from) => n >= from && n <= D.length && v.strokes.every((st, i) => st.p.join() === D[i].p.join());
  const pick = (list) => ({ type: 'guess', text: list[rand(list.length)] });
  if (level === 'hard') {
    const near = turn.filter((f) => f.k === 'close' && f.to === pid).map((f) => /“(.+)”/.exec(f.text)?.[1]).filter(Boolean);
    const wrong = new Set([...turn.filter((f) => f.k === 'guess').map((f) => f.text), ...near]);
    for (const [w, D] of Object.entries(DOODLES)) if (!wrong.has(w) && looks(D, 1)) return { type: 'guess', text: w };
    const options = WORDS.filter((w) => fits(w, v.mask) && !wrong.has(w) && near.every((g) => close(g, w)));
    return options.length && options.length <= (browser ? 20 : 1000) ? pick(options) : null;
  }
  const tried = new Set(turn.filter((f) => f.pid === pid && f.k === 'guess').map((f) => f.text));
  for (const [w, D] of Object.entries(DOODLES)) {
    if (tried.has(w) || !looks(D, Math.max(2, Math.min(3, D.length)))) continue;
    const mixUps = Object.keys(DOODLES).filter((d) => d !== w && !tried.has(d));
    return Math.random() < 0.4 && mixUps.length ? pick(mixUps) : { type: 'guess', text: w };
  }
  const options = WORDS.filter((w) => fits(w, v.mask) && !tried.has(w));
  if (!options.length || options.length > (browser ? 6 : 1000)) return null;
  // Easy guessers often miss the letters already shown.
  const careless = WORDS.filter((w) => fits(w, v.mask.replace(/[^ ]/g, '_')) && !tried.has(w));
  return pick(Math.random() < 0.4 && careless.length ? careless : options);
}

/* ---------------- interface ---------------- */

// A few line icons this game needs that the shared set doesn't have (same style as js/icons.js).
const ic = (d) => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;
const IC = {
  pencil: ic('<path d="M4.5 19.5l1-4.2L15.6 5.2a2 2 0 0 1 2.8 0l.4.4a2 2 0 0 1 0 2.8L8.7 18.5z"/><path d="M13.8 7l3.2 3.2"/>'),
  undo: ic('<path d="M9 14.5L4.5 10 9 5.5"/><path d="M4.5 10H14a5.5 5.5 0 0 1 0 11h-2.5"/>'),
  trash: ic('<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5M10 11v5M14 11v5"/>'),
  flag: ic('<path d="M6 21V4"/><path d="M6 4.5c4.5-2 7.5 2 12 0V13c-4.5 2-7.5-2-12 0"/>'),
  eraser: ic('<path d="M9 20h11"/><path d="M4.8 14.8l9.4-9.4a2 2 0 0 1 2.8 0l2.6 2.6a2 2 0 0 1 0 2.8L12 18.4a3 3 0 0 1-2.1.9H8.6a3 3 0 0 1-2.1-.9l-1.7-1.7a2 2 0 0 1 0-2.8z"/><path d="M9.6 10l5.4 5.4"/>'),
};
const TICKER = 4; // the latest guesses stay beside the guess box; older ones fold into a drawer
// The guess history folds away on phones so the canvas gets the screen; it stays as the player left it.
let historyOpen = typeof matchMedia === 'function' ? matchMedia('(min-width: 901px)').matches : true;

const UI = { gid: null, v: null, ctx: null, color: 0, size: 1, gesture: 0, drawing: false, pending: null, local: [], sentAt: 0, offset: 0, hostNow: 0, clockSent: 0, root: null,
  scoreKey: null, scores: {}, until: {}, rises: {}, mask: '', maskKey: null };
const amDrawer = () => UI.v && UI.v.phase === 'draw' && UI.v.drawer === UI.ctx.me && !UI.v.over;
const amPlayer = () => UI.v?.players.some((p) => p.id === UI.ctx.me);
const deadline = (v) => (v.phase === 'choose' ? v.chooseUntil : v.phase === 'draw' ? v.endsAt : v.phase === 'reveal' ? v.revealUntil : 0);

function paint() {
  const cv = UI.root?.querySelector('canvas');
  if (!cv || !UI.v) return;
  const g = cv.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  g.lineCap = 'round'; g.lineJoin = 'round';
  const ink = (st) => {
    const p = st.p;
    g.strokeStyle = COLORS[st.c]; g.lineWidth = SIZES[st.w];
    g.beginPath(); g.moveTo(p[0], p[1]);
    if (p.length === 2) g.lineTo(p[0] + 0.1, p[1]);
    for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]);
    g.stroke();
  };
  const shown = UI.v.phase === 'choose' ? [] : UI.v.strokes;
  const done = new Set(shown.map((s) => s.k).filter(Boolean));
  UI.local = UI.local.filter((s) => !done.has(s.k));
  shown.forEach(ink);
  if (amDrawer()) { UI.local.forEach(ink); if (UI.pending?.length >= 2) ink({ c: UI.color, w: UI.size, p: UI.pending }); }
}

function flush(final) {
  const p = UI.pending;
  if (!p || p.length < 2 || !amDrawer()) return;
  if (!final && p.length < 4) return;
  const k = Math.random().toString(36).slice(2, 10);
  const stroke = { type: 'stroke', c: UI.color, w: UI.size, g: UI.gesture, p: p.length === 2 ? [p[0], p[1], p[0], p[1]] : p.slice(), k };
  UI.local.push(stroke);
  UI.ctx.send(stroke);
  UI.pending = final ? null : p.slice(-2); // the next chunk continues from here
  UI.sentAt = Date.now();
}
const point = (e) => {
  const cv = UI.root.querySelector('canvas'), r = cv.getBoundingClientRect();
  return [Math.round(Math.min(W, Math.max(0, ((e.clientX - r.left) / r.width) * W))), Math.round(Math.min(H, Math.max(0, ((e.clientY - r.top) / r.height) * H)))];
};

// The countdown: the number in the middle and the ring around it that runs down.
function clockFace() {
  const v = UI.v;
  if (!v || !UI.root) return;
  const msLeft = deadline(v) - (Date.now() + UI.offset);
  const total = v.phase === 'choose' ? CHOOSE_MS : v.phase === 'draw' ? v.drawMs : REVEAL_MS;
  UI.root.querySelectorAll('.sk-time').forEach((t) => {
    const left = Math.max(0, Math.ceil(msLeft / 1000)), text = v.over ? '' : String(left), low = v.phase === 'draw' && left <= 10;
    if (t.textContent !== text) t.textContent = text;
    t.classList.toggle('low', low);
    const ring = t.closest('.sk-clock');
    if (ring) { ring.classList.toggle('low', low); ring.style.setProperty('--p', v.over ? '0' : Math.max(0, Math.min(1, msLeft / total)).toFixed(3)); }
  });
}

if (browser) {
  addEventListener('pointermove', (e) => {
    if (!UI.drawing) return;
    const [x, y] = point(e), p = UI.pending;
    if (Math.hypot(x - p.at(-2), y - p.at(-1)) < 5) return;
    p.push(x, y);
    if (p.length >= 280 || Date.now() - UI.sentAt > 350) flush(false);
    paint();
  });
  const up = () => { if (!UI.drawing) return; UI.drawing = false; flush(true); paint(); };
  addEventListener('pointerup', up);
  addEventListener('pointercancel', up);
  // Clocks: count down locally and ask the host to move on when a deadline passes.
  setInterval(() => {
    const v = UI.v;
    if (!v || !UI.root?.isConnected) return;
    const now = Date.now() + UI.offset;
    const until = deadline(v);
    clockFace();
    const next = v.phase === 'draw' ? Math.min(v.endsAt, v.hintAt[v.hints.length] ?? Infinity) : until;
    if (!v.over && amPlayer() && next && now > next + 250 && Date.now() - UI.clockSent > 1500) { UI.clockSent = Date.now(); UI.ctx.send({ type: 'clock' }); }
  }, 250);
}

// The selected colour and brush are marked in place, so the palette isn't rebuilt (and the lift can animate).
function syncTools() {
  const t = UI.root?.querySelector('[data-r="tools"]');
  if (!t) return;
  t.querySelectorAll('[data-do^="color:"]').forEach((b) => { const on = +b.dataset.do.slice(6) === UI.color; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  t.querySelectorAll('[data-do^="size:"]').forEach((b) => { const on = +b.dataset.do.slice(5) === UI.size; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  t.querySelector('.sk-sizes')?.style.setProperty('--brush', COLORS[UI.color]);
}

// Built once; later updates only rewrite the regions inside, so the canvas and the guess box are never replaced.
function skeleton(el) {
  el.innerHTML = `<div class="sk-root"><div class="sk-grid">
    <div class="sk-boardcol felt sk-felt">
      <div class="sk-top" data-r="top"></div>
      <div class="sk-easel"><div class="sk-board"><canvas width="${W}" height="${H}" aria-label="Drawing canvas"></canvas><div class="sk-over" data-r="over"></div></div></div>
      <div class="sk-tools" data-r="tools"></div>
    </div>
    <div class="sk-side">
      <div class="panel sk-chat"><div class="sk-feed" data-r="feed" aria-live="polite"></div>
        <form class="sk-guess"><input maxlength="40" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send" aria-label="Your guess"><button class="primary">Guess</button></form></div>
      <div class="panel sk-scores"><h3 class="gold">${icon('trophy')}Scores</h3><div class="sk-scorelist" data-r="scores"></div></div>
      <details class="panel drawer sk-history" ${historyOpen ? 'open' : ''}><summary>${icon('book')}<span>Earlier guesses</span><span class="note" data-r="hnote"></span>${icon('chevron', 'chev')}</summary>
        <div class="drawer-body"><div class="sk-hist" data-r="history"></div></div></details>
    </div>
  </div></div>`;
  UI.root = el;
  const cv = el.querySelector('canvas');
  cv.addEventListener('pointerdown', (e) => {
    if (!amDrawer()) return;
    e.preventDefault();
    UI.gesture++; UI.drawing = true; UI.pending = point(e); UI.sentAt = Date.now();
    el.querySelector('.sk-easel')?.classList.remove('ready');
    paint();
  });
  el.querySelector('.sk-guess').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = el.querySelector('.sk-guess input'), text = input.value.trim();
    if (!text) return;
    input.value = '';
    UI.ctx.send({ type: 'guess', text });
  });
  const hist = el.querySelector('.sk-history');
  hist.addEventListener('toggle', () => {
    historyOpen = hist.open;
    if (hist.open) { const h = hist.querySelector('[data-r="history"]'); h.scrollTop = h.scrollHeight; }
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-do]');
    if (!b) return;
    const [kind, arg] = b.dataset.do.split(':');
    if (kind === 'color') { UI.color = +arg; sound('click'); return syncTools(); }
    if (kind === 'size') { UI.size = +arg; sound('click'); return syncTools(); }
    if (kind === 'skip' && !confirm('Give up on this drawing?')) return;
    if (kind === 'clear' && !confirm('Clear the whole drawing?')) return;
    if (kind === 'choose') b.classList.add('sk-chosen'); // the word you picked lifts while the host answers
    UI.ctx.send(kind === 'choose' ? { type: 'choose', i: +arg } : { type: kind });
  });
}

function draw() {
  const v = UI.v, ctx = UI.ctx, el = UI.root, me = ctx.me, now = Date.now();
  const drawer = v.players.find((p) => p.id === v.drawer), isDrawer = me === v.drawer, player = amPlayer();
  // A region is rewritten only when its markup changes, so effects already playing aren't restarted.
  // `patch` regions are morphed: only the parts that changed are redrawn (the portraits and letter tiles stay).
  const region = (r, html, patch) => {
    const n = el.querySelector(`[data-r="${r}"]`);
    if (!n || n._skHtml === html) return false;
    n._skHtml = html;
    if (patch) morph(n, html); else n.innerHTML = html;
    return true;
  };
  const col = (id) => PLAYER_COLORS[Math.max(0, v.players.findIndex((p) => p.id === id)) % PLAYER_COLORS.length];
  const face = (id, cls = '') => `<span class="sk-face ${cls}" style="--pc:${col(id)}">${portrait({ id, bot: !!ctx.isBot?.(id) })}</span>`;
  const nameOf = (id) => esc(v.players.find((p) => p.id === id)?.name || '?');
  const hot = (k) => (UI.until[k] || 0) > now;

  // A score that rose since the last update flashes for a moment and floats its "+N".
  const scoreKey = v.players.map((p) => p.id).join(), risen = [];
  if (UI.scoreKey === scoreKey) for (const p of v.players) { const had = UI.scores[p.id]; if (had != null && p.score > had) { UI.until['s' + p.id] = now + 1500; UI.rises[p.id] = (UI.rises[p.id] || 0) + 1; risen.push([p.id, p.score - had]); } }
  UI.scoreKey = scoreKey; UI.scores = Object.fromEntries(v.players.map((p) => [p.id, p.score]));
  // Letters that just appeared (a hint, or the whole word once you guess it) pop in.
  const maskKey = v.used + ':' + v.phase;
  if (UI.maskKey !== maskKey) {
    for (const k of Object.keys(UI.until)) if (k[0] === 'm') delete UI.until[k];
  } else if (v.phase === 'draw' && UI.mask.length === v.mask.length) {
    [...v.mask].forEach((c, i) => { if (c !== '_' && c !== ' ' && UI.mask[i] === '_') UI.until['m' + i] = now + 1200; });
  }
  UI.maskKey = maskKey; UI.mask = v.mask;

  // ---- top bar: who draws, the word, the clock ----
  const tiles = [...v.mask].map((c, i) => (c === ' ' ? '<i class="gap"></i>'
    : `<b class="${[c === '_' ? '' : 'on', hot('m' + i) ? 'pop' : ''].join(' ').trim()}" style="--d:${i * 45}ms">${c === '_' ? '' : esc(c)}</b>`)).join('');
  const round = `<span class="sk-round">Round ${Math.min(v.round, v.rounds)} of ${v.rounds}</span>`;
  const doing = v.phase === 'choose' ? (isDrawer ? 'Your turn to draw' : `${esc(drawer.name)} is up`)
    : v.phase === 'draw' ? (isDrawer ? 'You are drawing' : `${esc(drawer.name)} is drawing`) : `${isDrawer ? 'You' : esc(drawer.name)} drew`;
  const who = v.over ? `<div class="sk-who"><span class="sk-face sk-trophy">${icon('trophy')}</span><span class="sk-whotext">${round}<b>Game over</b></span></div>`
    : `<div class="sk-who">${face(drawer.id)}<span class="sk-whotext">${round}<b>${doing}</b></span></div>`;
  const word = v.over ? `<span class="winner-banner">${icon('trophy')}${v.winners.map(nameOf).join(' & ')} ${v.winners.length > 1 ? 'win' : 'wins'}!</span>`
    : v.phase === 'choose' ? `<span class="sk-say">${isDrawer ? 'Choose a word to draw' : esc(drawer.name) + ' is choosing a word…'}</span>`
    : isDrawer && v.phase === 'draw' ? `<span class="sk-label">Draw</span><span class="sk-letters mine">${tiles}</span>`
    : `<span class="sk-label">${v.phase === 'reveal' ? 'The word was' : v.guessed[me] ? 'You got it!' : 'Guess'}</span><span class="sk-letters">${tiles}</span><small>${v.phase === 'draw' && !v.word ? v.mask.replace(/ /g, '').length + ' letters' : ''}</small>`;
  if (region('top', `${who}<div class="sk-word">${word}</div>${v.over ? '' : '<div class="sk-clock"><span class="sk-time"></span></div>'}`, true)) clockFace();

  // ---- over the canvas: choosing, the reveal, final scores ----
  const ranked = v.players.slice().sort((a, b) => b.score - a.score), got = Object.entries(v.guessed);
  region('over', v.over
    ? `<div class="sk-card sk-finalcard"><div class="sk-cardtitle">${icon('trophy')}Final scores</div>${ranked.map((p, i) => `<div class="sk-final ${v.winners.includes(p.id) ? 'win' : ''}"><span class="sk-rank">${i + 1}</span>${face(p.id)}<span class="grow">${esc(p.name)}</span><b>${p.score}</b></div>`).join('')}</div>`
    : v.phase === 'choose' ? (isDrawer
      ? `<div class="sk-card sk-choosecard"><p><span class="sk-pickhint">Pick one to draw. </span>Don’t say it out loud!</p><div class="sk-choices">${v.choices.map((w, i) => `<button class="sk-pick" data-do="choose:${i}" style="--r:${[-2.5, 1.5, -1][i % 3]}deg;--t:${['#ff6fae', '#ffd166', '#4cb8ff'][i % 3]}">${IC.pencil}<span>${esc(w)}</span></button>`).join('')}</div></div>`
      : `<div class="sk-card sk-waitcard">${face(drawer.id, 'big')}<p>${esc(drawer.name)} is picking something to draw…</p></div>`)
    : v.phase === 'reveal' ? `<div class="sk-card sk-revealcard"><small>The word was</small><p class="sk-big">${esc(v.word)}</p>${got.length
      ? `<div class="sk-gotlist">${got.map(([id, pts]) => `<div class="sk-gotrow">${face(id)}<span class="grow">${nameOf(id)}</span><b>+${pts}</b></div>`).join('')}<div class="sk-gotrow artist">${face(drawer.id)}<span class="grow">${esc(drawer.name)} <small>drew it</small></span><b>+${got.length * 50}</b></div></div>`
      : '<div class="sk-nobody">Nobody guessed it.</div>'}</div>` : '');

  // ---- under the canvas: the palette, or a hint ----
  const tip = v.over ? 'Thanks for playing!' : !player ? 'You are watching.' : isDrawer ? '' : 'Type your guesses below. Wrong guesses are shown to everyone. Close guesses only to you.';
  region('tools', isDrawer && v.phase === 'draw' && !v.over
    ? `<div class="sk-palette"><div class="sk-colors">${COLORS.map((c, i) => `<button class="sk-swatch${i === 1 ? ' eraser' : ''}" style="--c:${c}" data-do="color:${i}" aria-label="${COLOR_NAMES[i]}" title="${COLOR_NAMES[i]}">${i === 1 ? IC.eraser : ''}</button>`).join('')}</div>
      <div class="sk-tooldeck"><div class="sk-sizes">${SIZES.map((sz, i) => `<button class="sk-size" data-do="size:${i}" aria-label="Brush size ${i + 1}" title="Brush size ${i + 1}"><i style="width:${6 + i * 6}px;height:${6 + i * 6}px"></i></button>`).join('')}</div>
      <div class="sk-acts"><button class="sk-act" data-do="undo" aria-label="Undo" title="Undo">${IC.undo}<span>Undo</span></button><button class="sk-act" data-do="clear" aria-label="Clear" title="Clear the drawing">${IC.trash}<span>Clear</span></button><button class="sk-act bad" data-do="skip" aria-label="Give up" title="Give up">${IC.flag}<span>Give up</span></button></div></div></div>`
    : tip ? `<p class="sk-tip">${icon(v.over ? 'trophy' : !player ? 'eye' : 'bulb')}<span>${tip}</span></p>` : '');
  syncTools();

  // ---- guesses: the latest few beside the guess box, the rest in the drawer ----
  const line = (f) => {
    const pc = f.pid ? ` style="--pc:${col(f.pid)}"` : '';
    if (f.k === 'guess') return `<div class="sk-msg guess"${pc}><b>${nameOf(f.pid)}:</b> ${esc(f.text)}</div>`;
    if (f.k === 'right') return `<div class="sk-msg right"${pc}>${icon('check')}${esc(f.text)}</div>`;
    if (f.k === 'close') return `<div class="sk-msg close">${icon('sparkle')}${esc(f.text)}</div>`;
    return `<div class="sk-msg ${esc(f.k)}">${esc(f.text)}</div>`;
  };
  const older = v.feed.slice(0, Math.max(0, v.feed.length - TICKER));
  region('feed', v.feed.slice(-TICKER).map(line).join('') || '<div class="muted small sk-empty">Guesses appear here.</div>');
  if (region('history', older.map(line).join('') || '<p class="muted small sk-empty">Older guesses collect here.</p>')) { const h = el.querySelector('[data-r="history"]'); h.scrollTop = h.scrollHeight; }
  region('hnote', older.length ? String(older.length) : '');

  // ---- scores ----
  region('scores', ranked.map((p) => {
    const drawingNow = p.id === v.drawer && !v.over, gotIt = v.guessed[p.id];
    const cls = ['sk-player', drawingNow && 'drawing', gotIt && 'got', p.id === me && 'me', hot('s' + p.id) && (UI.rises[p.id] % 2 ? 'sk-scored' : 'sk-scored sk-again')].filter(Boolean).join(' ');
    return `<div class="${cls}" data-k="sk-p-${esc(p.id)}" style="--pc:${col(p.id)}">${face(p.id)}<span class="sk-pname">${esc(p.name)}</span>${p.id === me ? '<span class="tag t-you">You</span>' : ''}`
      + `${drawingNow ? `<span class="sk-badge draw" title="Drawing">${IC.pencil}</span>` : gotIt ? `<span class="sk-badge ok" title="Guessed it">${icon('check')}</span>` : ''}<b class="sk-pts">${p.score}</b></div>`;
  }).join(''), true);
  for (const [id, d] of risen) {
    const r = [...el.querySelectorAll('.sk-player')].find((n) => n.dataset.k === 'sk-p-' + id)?.querySelector('.sk-pts')?.getBoundingClientRect();
    if (r && r.width) floatText(r, '+' + d, '#3ee0a1');
  }

  const form = el.querySelector('.sk-guess'), input = form.querySelector('input'), canGuess = player && !isDrawer && v.phase === 'draw' && !v.guessed[me] && !v.over;
  input.disabled = !canGuess; form.querySelector('button').disabled = !canGuess;
  input.placeholder = canGuess ? 'Type your guess' : isDrawer && v.phase === 'draw' ? 'You are drawing' : v.guessed[me] ? 'You got it!' : 'Wait for the next drawing';
  form.classList.toggle('can', !!canGuess);
  el.querySelector('canvas').classList.toggle('mine', amDrawer());
  el.querySelector('.sk-easel').classList.toggle('ready', amDrawer() && !v.strokes.length && !UI.local.length && !UI.drawing);
  paint();
}

function render(el, v, ctx) {
  injectCSS('sketch', STYLE);
  if (v.hostNow && v.hostNow !== UI.hostNow) { UI.hostNow = v.hostNow; UI.offset = v.hostNow - Date.now(); }
  if (!el.querySelector('.sk-root') || UI.root !== el) skeleton(el);
  const fresh = UI.gid !== v.players.map((p) => p.id).join() + v.used + v.phase;
  UI.gid = v.players.map((p) => p.id).join() + v.used + v.phase;
  if (fresh && v.phase !== 'draw') { UI.local = []; UI.pending = null; UI.drawing = false; }
  UI.v = v; UI.ctx = ctx;
  draw();
}

/* Cover art: an art party. One friend draws a cat at the easel, tongue out in concentration,
   while two others shout their guesses (self-contained ids, prefixed skc-). */
function coverSVG() {
  const f = (n) => +n.toFixed(1);
  const stops = (list) => list.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}"${a === 1 ? '' : ` stop-opacity="${a}"`}/>`).join('');
  const lg = (id, list, x2 = 0, y2 = 1) => `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops(list)}</linearGradient>`;
  const rg = (id, list) => `<radialGradient id="${id}">${stops(list)}</radialGradient>`;
  const spark = (x, y, s, c = '#fff') => `<path d="M${x} ${y - s}Q${x} ${y} ${x + s} ${y}Q${x} ${y} ${x} ${y + s}Q${x} ${y} ${x - s} ${y}Q${x} ${y} ${x} ${y - s}z" fill="${c}"/>`;
  const arm = (d, grad, w = 9) => `<path d="${d}" stroke="url(#${grad})" stroke-width="${w}" stroke-linecap="round" fill="none"/>`;
  // bunting along a sagging string
  const bz = (t) => [320 * t, (1 - t) ** 2 * 10 + 2 * t * (1 - t) * 46 + t * t * 8];
  const FLAG = ['#ff6fae', '#ffd166', '#3ee0a1', '#4cb8ff', '#ff9f43', '#b197fc'];
  const flags = Array.from({ length: 14 }, (_, i) => {
    const t = (i + 0.5) / 14, [ax, ay] = bz(t - 0.026), [bx, by] = bz(t + 0.026), [mx, my] = bz(t);
    return `<path d="M${f(ax)} ${f(ay)}L${f(bx)} ${f(by)}L${f(mx)} ${f(my + 15)}z" fill="${FLAG[i % 6]}"/>`;
  }).join('');
  const confetti = [[30, 92, '#ffd166', 30], [66, 40, '#4cb8ff', -20], [112, 30, '#ff6fae', 50], [178, 40, '#3ee0a1', -35], [292, 40, '#ff6fae', 60], [300, 128, '#4cb8ff', 25], [18, 128, '#3ee0a1', -15], [140, 26, '#ff9f43', 70], [214, 100, '#b197fc', -50], [252, 136, '#ffd166', 20]]
    .map(([x, y, c, r]) => `<rect x="${x - 3.5}" y="${y - 1.5}" width="7" height="3" rx="1" fill="${c}" transform="rotate(${r} ${x} ${y})"/>`).join('')
    + [[50, 30, '#ff6fae'], [96, 50, '#ffd166'], [272, 44, '#ff9f43'], [306, 96, '#b197fc'], [16, 66, '#3ee0a1'], [206, 36, '#4cb8ff']].map(([x, y, c]) => `<circle cx="${x}" cy="${y}" r="2" fill="${c}"/>`).join('');
  const puffs = [[216, 114, 5.5], [221, 108, 6], [230, 105, 6.5], [239, 108, 6], [244, 114, 5.5]].map(([x, y, r]) => `<circle cx="${x - 6}" cy="${y}" r="${r}" fill="#2b1d16"/>`).join('');
  const FONT = 'font-family="Fredoka,Nunito,sans-serif" font-weight="700" text-anchor="middle"';
  return `<svg viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Friends shout guesses while an artist draws a cat on an easel"><defs>` +
    lg('skc-wall', [[0, '#231a6e'], [0.5, '#4f2fae'], [0.82, '#a8479f'], [1, '#e0628f']]) +
    lg('skc-floor', [[0, '#33206f'], [1, '#170f45']]) +
    lg('skc-paper', [[0, '#ffffff'], [1, '#eef0ff']]) +
    rg('skc-spot', [[0, '#fff3c8', 0.6], [0.5, '#ffb3d9', 0.22], [1, '#ff8ac0', 0]]) +
    lg('skc-wood', [[0, '#ffc977'], [1, '#f08a3c']], 1, 0) +
    lg('skc-teal', [[0, '#4ff0b4'], [1, '#17a978']]) +
    lg('skc-pink', [[0, '#ff86bd'], [1, '#e0458a']]) +
    lg('skc-blue', [[0, '#62c4ff'], [1, '#3a78e0']]) +
    `</defs><rect width="320" height="200" fill="url(#skc-wall)"/>` +
    // pinned doodles on the studio wall
    `<g transform="rotate(-7 42 62)"><rect x="28" y="46" width="30" height="34" rx="2" fill="#fffaf0"/><circle cx="43" cy="62" r="7" fill="none" stroke="#ff9f43" stroke-width="2.2"/><path d="M43 50.5v-3M43 73.5v3M31.5 62h-3M54.5 62h3" stroke="#ff9f43" stroke-width="2" stroke-linecap="round"/><rect x="38" y="43" width="10" height="5" rx="1" fill="#ff6fae" opacity=".85"/></g>` +
    `<g transform="rotate(6 280 64)"><rect x="266" y="48" width="28" height="32" rx="2" fill="#fffaf0"/><path d="M280 73c-8-5-10-9-10-12a4.6 4.6 0 0 1 10-2 4.6 4.6 0 0 1 10 2c0 3-2 7-10 12z" fill="#ff5d73"/><rect x="275" y="45" width="10" height="5" rx="1" fill="#3ee0a1" opacity=".85"/></g>` +
    `<path d="M0 10Q160 46 320 8" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="1"/>${flags}${confetti}` +
    // floor, rug and the light on the easel
    `<path d="M0 164H320V200H0z" fill="url(#skc-floor)"/><ellipse cx="160" cy="187" rx="132" ry="13" fill="#46308f" opacity=".8"/>` +
    `<circle cx="160" cy="88" r="92" fill="url(#skc-spot)"/>` +
    // the easel and its paper, with a cat half drawn
    `<path d="M160 34V190" stroke="#c96a2c" stroke-width="5" stroke-linecap="round"/><path d="M151 32L120 188M169 32L200 188" stroke="url(#skc-wood)" stroke-width="7" stroke-linecap="round"/>` +
    `<rect x="151" y="29" width="18" height="9" rx="3" fill="#ffb35a"/><rect x="114" y="45" width="96" height="78" rx="4" fill="#120b3a" opacity=".3"/><rect x="112" y="42" width="96" height="78" rx="4" fill="url(#skc-paper)"/>` +
    `<g fill="none" stroke="#1d1714" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="160" cy="86" r="19"/><path d="M146.5 74L147 59L157 68M163 68L173 59L173.5 74"/>` +
    `<path d="M154 95q3 3 6 0q3 3 6 0"/><path d="M175 89L193 85M175 94L193 97M145 94L128 97M145 89L138 87.5"/></g>` +
    `<circle cx="153" cy="83" r="2.6" fill="#1d1714"/><circle cx="167" cy="83" r="2.6" fill="#1d1714"/><path d="M157 89h6l-3 3.4z" fill="#ff6fae"/>` +
    spark(196, 54, 5, '#ffd166') + `<path d="M120 54q4-6 8 0t8 0" fill="none" stroke="#4cb8ff" stroke-width="2.2" stroke-linecap="round"/>` +
    `<rect x="108" y="120" width="104" height="7" rx="3" fill="url(#skc-wood)"/><rect x="170" y="115" width="18" height="5" rx="2" fill="#4cb8ff"/><rect x="190" y="116" width="14" height="4" rx="2" fill="#ffd166"/>` +
    // the artist: smock, beret, palette, tongue out, marker on the paper
    arm('M68 150Q56 154 50 160', 'skc-teal') + `<circle cx="47" cy="162" r="5" fill="#f5c39e"/>` +
    `<path d="M24 160C24 148 40 141 55 145C68 149 71 160 62 165C56 168 59 173 52 175C38 179 24 173 24 160z" fill="#ffe4bd"/><circle cx="53" cy="166.5" r="3" fill="#33206f"/>` +
    `<circle cx="35" cy="155" r="4" fill="#ff5d73"/><circle cx="44" cy="149.5" r="3.6" fill="#ffd166"/><circle cx="54" cy="151.5" r="3.4" fill="#3ee0a1"/><circle cx="33" cy="166" r="3.6" fill="#4cb8ff"/>` +
    `<path d="M58 200C58 158 70 134 89 134C108 134 119 158 119 200z" fill="url(#skc-teal)"/><path d="M78 140L89 155L100 140" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="2"/>` +
    `<circle cx="78" cy="174" r="4" fill="#ff6fae"/><circle cx="102" cy="184" r="3" fill="#ffd166"/><circle cx="92" cy="167" r="2.4" fill="#4cb8ff"/>` +
    `<rect x="83" y="118" width="12" height="18" rx="5" fill="#dba57c"/><circle cx="89" cy="106" r="16" fill="#f5c39e"/>` +
    `<path d="M73 110C71 94 81 87 91 88C99 89 104 94 105 99C98 95 89 96 83 103C80 107 78 112 76 116z" fill="#3b2418"/>` +
    `<ellipse cx="87" cy="91" rx="17" ry="6.5" fill="#ff5d73" transform="rotate(-10 87 91)"/><circle cx="84" cy="84" r="2.4" fill="#ff5d73"/>` +
    `<circle cx="94" cy="105" r="2" fill="#2a1c1a"/><circle cx="101.5" cy="104.5" r="1.8" fill="#2a1c1a"/><circle cx="98" cy="111" r="3" fill="#ff7f8f" opacity=".45"/>` +
    `<path d="M94 114q4 2.6 8.5-.6" fill="none" stroke="#3a2220" stroke-width="1.6" stroke-linecap="round"/><ellipse cx="101.5" cy="115" rx="2" ry="1.7" fill="#ff7f8f"/>` +
    arm('M105 144Q123 134 127 104', 'skc-teal') + `<circle cx="128" cy="100" r="5.2" fill="#f5c39e"/>` +
    `<path d="M127 100L136 90" stroke="#ff6fae" stroke-width="4.6" stroke-linecap="round"/><path d="M136 90L138.2 87.6" stroke="#1d1714" stroke-width="2.6" stroke-linecap="round"/>` + spark(142, 81, 4) +
    // a friend jumping: "CAT!"
    arm('M208 152Q194 136 197 114', 'skc-pink', 8.5) + arm('M240 152Q254 136 251 114', 'skc-pink', 8.5) +
    `<circle cx="197" cy="111" r="5" fill="#9a5d36"/><circle cx="251" cy="111" r="5" fill="#9a5d36"/>` +
    `<path d="M200 200C200 162 208 144 224 144C240 144 248 162 248 200z" fill="url(#skc-pink)"/><path d="M216 148l8 9 8-9" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="2"/>` +
    `<rect x="219" y="130" width="10" height="16" rx="4" fill="#87502d"/><circle cx="224" cy="124" r="15" fill="#9a5d36"/>${puffs}` +
    `<path d="M215 123q3-3 6 0M227 123q3-3 6 0" fill="none" stroke="#1d1210" stroke-width="1.8" stroke-linecap="round"/>` +
    `<path d="M218 128.5h12q-1 7.5-6 7.5t-6-7.5z" fill="#5a1e2a"/><ellipse cx="224" cy="133.4" rx="3" ry="1.6" fill="#ff7f8f"/>` +
    `<circle cx="214.5" cy="129" r="2.6" fill="#ff7f8f" opacity=".4"/><circle cx="233.5" cy="129" r="2.6" fill="#ff7f8f" opacity=".4"/>` +
    `<path d="M198 52h52a12 12 0 0 1 12 12v2a12 12 0 0 1-12 12h-20l-8 9-1-9h-23a12 12 0 0 1-12-12v-2a12 12 0 0 1 12-12z" fill="#fff"/>` +
    `<text x="224" y="71" ${FONT} font-size="15" fill="#ff3d7f">CAT!</text>` +
    // another friend, thinking hard: "FISH?"
    `<path d="M262 200C262 170 270 156 284 156C298 156 306 170 306 200z" fill="url(#skc-blue)"/><rect x="279" y="142" width="9" height="16" rx="4" fill="#e9c0a4"/>` +
    `<circle cx="283" cy="138" r="13.5" fill="#ffdbc4"/><path d="M269 142C267 126 276 122 284 122C293 122 299 128 298 142C296 134 292 130 286 130C280 130 274 134 269 142z" fill="#e8c46a"/>` +
    `<circle cx="277" cy="139" r="1.8" fill="#2a1c1a"/><circle cx="286" cy="139" r="1.8" fill="#2a1c1a"/><path d="M274 134l5-1.5M284 132.5l5 1" stroke="#a07a2a" stroke-width="1.4" stroke-linecap="round"/>` +
    `<ellipse cx="281" cy="146.5" rx="2.2" ry="2.6" fill="#7a2e35"/>` + arm('M270 184Q261 167 271 153', 'skc-blue', 8) + `<circle cx="272" cy="151" r="4.6" fill="#ffdbc4"/>` +
    `<path d="M265 80h26a9 9 0 0 1 9 9v2a9 9 0 0 1-9 9h-8l-4 8-2-8h-12a9 9 0 0 1-9-9v-2a9 9 0 0 1 9-9z" fill="#fff" opacity=".95"/>` +
    `<text x="278" y="94.5" ${FONT} font-size="10.5" fill="#3a78e0">FISH?</text>` +
    spark(268, 44, 4, '#ffd166') + spark(184, 46, 3) + spark(36, 112, 3, '#ffd166') +
    `</svg>`;
}

const svgURL = (s) => `url("data:image/svg+xml,${encodeURIComponent(s)}")`;
// Studio wallpaper: a scatter of confetti, and a string of bunting along the top.
const CONFETTI = svgURL(`<svg xmlns='http://www.w3.org/2000/svg' width='260' height='260'><g opacity='.42'>${[[18, 30, '#ff6fae', 20], [70, 12, '#ffd166', -30], [130, 44, '#3ee0a1', 60], [200, 20, '#4cb8ff', 15], [240, 80, '#ff9f43', -45], [30, 110, '#b197fc', 35], [96, 150, '#ffd166', 75], [170, 120, '#ff6fae', -15], [224, 170, '#3ee0a1', 40], [60, 210, '#4cb8ff', -60], [140, 236, '#ff9f43', 10], [250, 236, '#ff6fae', -25]]
  .map(([x, y, c, r]) => `<rect x='${x}' y='${y}' width='9' height='4' rx='1.5' fill='${c}' transform='rotate(${r} ${x + 4.5} ${y + 2})'/>`).join('')}${[[48, 70, '#ffd166'], [160, 84, '#4cb8ff'], [210, 128, '#ff6fae'], [110, 200, '#3ee0a1'], [16, 176, '#ff9f43'], [186, 222, '#b197fc']]
  .map(([x, y, c]) => `<circle cx='${x}' cy='${y}' r='2.6' fill='${c}'/>`).join('')}<path d='M112 96q5-7 10 0t10 0' fill='none' stroke='#ff6fae' stroke-width='2.4' stroke-linecap='round'/><path d='M20 236q5-7 10 0t10 0' fill='none' stroke='#4cb8ff' stroke-width='2.4' stroke-linecap='round'/></g></svg>`);
const BUNTING = svgURL(`<svg xmlns='http://www.w3.org/2000/svg' width='96' height='22'><path d='M0 3H96' stroke='#fff' stroke-opacity='.5' stroke-width='1.2'/>${['#ff6fae', '#ffd166', '#3ee0a1', '#4cb8ff'].map((c, k) => `<path d='M${k * 24 + 2} 3h20l-10 16z' fill='${c}'/><path d='M${k * 24 + 5} 3h7l-3.5 6z' fill='#fff' opacity='.3'/>`).join('')}</svg>`);

const STYLE = `
/* Art-party studio: a violet room strung with bunting and confetti. The paper itself stays clean white. */
.sk-grid{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:18px;align-items:start}
.sk-boardcol{min-width:0}
.sk-side{display:flex;flex-direction:column;gap:14px;min-width:0}
.sk-felt{padding:28px 16px 16px;border-color:rgba(255,170,220,.25);
  background:${CONFETTI} 0 0/260px 260px,
    radial-gradient(60% 45% at 0% 0%,rgba(255,111,174,.3),transparent 70%),
    radial-gradient(55% 45% at 100% 0%,rgba(76,184,255,.26),transparent 70%),
    radial-gradient(60% 50% at 100% 100%,rgba(255,207,92,.16),transparent 70%),
    radial-gradient(55% 50% at 0% 100%,rgba(62,224,161,.16),transparent 70%),
    linear-gradient(165deg,#3d2a9a 0%,#2c2a8c 45%,#1d2468 100%)}
.sk-felt::before{content:'';position:absolute;left:24px;right:24px;top:1px;height:22px;background:${BUNTING} 0 0/96px 22px repeat-x;pointer-events:none}

/* top bar */
.sk-top{display:grid;grid-template-columns:minmax(0,auto) minmax(0,1fr) auto;gap:12px;align-items:center;margin-bottom:14px;padding:8px 10px 8px 8px;border-radius:18px;background:rgba(14,12,52,.6);border:1px solid rgba(255,255,255,.12);box-shadow:inset 0 1px 0 rgba(255,255,255,.06)}
.sk-who{display:flex;align-items:center;gap:10px;min-width:0;max-width:230px}
.sk-whotext{display:flex;flex-direction:column;min-width:0;line-height:1.15}
.sk-whotext b{font:600 .98rem/1.25 var(--font-display);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sk-round{font-size:.66rem;letter-spacing:.1em;text-transform:uppercase;color:#c9c2ff;font-weight:800;white-space:nowrap}
.sk-face{position:relative;display:block;width:30px;height:30px;flex:none;border-radius:50%;box-shadow:0 0 0 2px var(--pc,#fff),0 2px 6px rgba(0,0,0,.4)}
.sk-face .portrait{width:100%;height:100%;display:block;border-radius:50%}
.sk-top .sk-face{width:38px;height:38px;box-shadow:0 0 0 3px var(--pc,#fff),0 3px 8px rgba(0,0,0,.45)}
.sk-trophy{display:grid;place-items:center;background:linear-gradient(135deg,#ffd166,#ff9f43);color:#3b2400;--pc:#ffe7a0}
.sk-trophy .ic{width:20px;height:20px}
.sk-word{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:6px 10px;text-align:center;min-width:0}
.sk-word .winner-banner{padding:0;font-size:1.25rem;display:inline-flex;align-items:center;gap:8px}
.sk-word .winner-banner .ic{width:1em;height:1em}
.sk-say{font:600 1.02rem/1.25 var(--font-display);color:#fff}
.sk-label{font-size:.68rem;letter-spacing:.12em;text-transform:uppercase;color:#c9c2ff;font-weight:800}
.sk-letters{display:inline-flex;flex-wrap:wrap;gap:4px;justify-content:center}
.sk-letters b{--tc:#ff6fae;display:inline-grid;place-items:center;width:24px;height:32px;border-radius:8px;background:rgba(255,255,255,.1);box-shadow:inset 0 -3px 0 var(--tc);font:700 1.15rem/1 var(--font-display);color:var(--ink);text-transform:uppercase}
.sk-letters b:nth-child(4n+2){--tc:#ffd166}.sk-letters b:nth-child(4n+3){--tc:#3ee0a1}.sk-letters b:nth-child(4n){--tc:#4cb8ff}
.sk-letters b.on{background:#fff;box-shadow:inset 0 -3px 0 var(--tc),0 3px 8px rgba(0,0,0,.3)}
.sk-letters.mine b{background:linear-gradient(180deg,#fff9e0,#ffe08a)}
.sk-letters b.pop{animation:sk-letter .5s var(--spring) var(--d,0ms) backwards}
@keyframes sk-letter{from{transform:translateY(-12px) scale(.4) rotate(-14deg);opacity:0}}
.sk-letters i.gap{width:10px}
.sk-word small{color:#c9c2ff;font-weight:700;font-size:.78rem}
.sk-word small:empty{display:none}
.sk-clock{--p:1;--ring:#ffd166;position:relative;width:52px;height:52px;border-radius:50%;display:grid;place-items:center;background:conic-gradient(var(--ring) calc(var(--p) * 360deg),rgba(255,255,255,.15) 0)}
/* The ring is redrawn four times a second as it runs down; its soft shadow sits on a pseudo-element that stays put, so it isn't repainted with it. */
.sk-clock::before{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;box-shadow:0 4px 12px rgba(0,0,0,.35)}
.sk-clock.low{--ring:#ff6b81}
.sk-clock .sk-time{display:grid;place-items:center;width:42px;height:42px;border-radius:50%;background:#fff;color:var(--ink);font:700 1.15rem/1 var(--font-display)}
.sk-clock .sk-time:empty{visibility:hidden}
.sk-clock .sk-time.low{background:#ffe3e8;color:#c2183c;animation:sk-tick 1s ease-in-out infinite}
@keyframes sk-tick{50%{transform:scale(1.1)}}

/* the easel: a bright frame, two strips of tape, clean white paper */
.sk-easel{position:relative;padding:6px;border-radius:24px;background:linear-gradient(135deg,#ff6fae,#b46cff 35%,#7c6cff 62%,#4cb8ff);box-shadow:inset 0 0 0 1px rgba(255,255,255,.25),0 18px 36px rgba(8,6,40,.5)}
.sk-easel::before,.sk-easel::after{content:'';position:absolute;top:-7px;width:64px;height:17px;border-radius:3px;pointer-events:none;z-index:3;opacity:.9;box-shadow:0 2px 4px rgba(0,0,0,.25)}
.sk-easel::before{left:24px;transform:rotate(-7deg);background:repeating-linear-gradient(90deg,#ffd166 0 6px,#ffe9a6 6px 12px)}
.sk-easel::after{right:24px;transform:rotate(6deg);background:repeating-linear-gradient(90deg,#3ee0a1 0 6px,#a6f5d6 6px 12px)}
.sk-board{position:relative;border-radius:18px;overflow:hidden;background:#fff}
.sk-board canvas{display:block;width:100%;height:auto;aspect-ratio:4/3;touch-action:none;background:#fff}
.sk-board canvas.mine{cursor:crosshair}
/* Your turn and the paper is still empty: a soft rim breathes around it. */
.sk-easel.ready .sk-board::after{content:'';position:absolute;inset:0;z-index:1;border-radius:inherit;pointer-events:none;box-shadow:inset 0 0 0 3px rgba(255,207,92,.9),inset 0 0 32px rgba(255,190,80,.45);animation:sk-breathe 2.6s ease-in-out infinite}
@keyframes sk-breathe{50%{opacity:.3}}
.sk-over{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none;padding:12px;background:radial-gradient(circle at 50% 50%,rgba(40,24,110,.05),rgba(40,24,110,.3))}
.sk-over:empty{display:none}
.sk-card{pointer-events:auto;max-width:94%;max-height:100%;overflow-y:auto;text-align:center;padding:16px 20px;border-radius:20px;color:var(--ink);background:linear-gradient(180deg,#ffffff,#eef0ff);box-shadow:0 0 0 1px rgba(27,35,71,.08),0 16px 36px rgba(20,14,70,.4);animation:sk-cardin .4s var(--spring)}
@keyframes sk-cardin{from{transform:translateY(14px) scale(.92);opacity:0}}
.sk-card p{margin:0 0 12px;font-weight:700}
.sk-cardtitle{display:flex;align-items:center;justify-content:center;gap:8px;font:700 1.2rem/1.2 var(--font-display);color:#9a6300;margin-bottom:8px}
.sk-cardtitle .ic{width:22px;height:22px}
.sk-revealcard small{font-size:.7rem;letter-spacing:.12em;text-transform:uppercase;color:#6b7299;font-weight:800}
.sk-big{margin:2px 0 10px !important;font:700 2rem/1.15 var(--font-display);text-transform:capitalize;background:linear-gradient(90deg,#ff3d7f,#7c4dff 55%,#2f8fff);-webkit-background-clip:text;background-clip:text;color:transparent}
.sk-choices{display:flex;flex-wrap:wrap;gap:12px;justify-content:center;padding:4px 2px 8px}
.sk-pick{position:relative;display:inline-flex;align-items:center;gap:8px;min-height:48px;padding:8px 18px 8px 8px;border:0;border-radius:15px;color:var(--ink);background:#fff;font:600 1.08rem/1.1 var(--font-display);text-transform:capitalize;box-shadow:0 0 0 2px var(--t),0 5px 0 rgba(27,35,71,.14),0 10px 18px rgba(20,14,70,.2);transform:rotate(var(--r,0deg));transition:transform .22s var(--spring)}
.sk-pick .ic{width:30px;height:30px;padding:6px;border-radius:10px;background:var(--t);color:#1b2347}
.sk-pick::after{content:'';position:absolute;inset:-5px;border-radius:19px;pointer-events:none;box-shadow:0 0 0 2px var(--t),0 0 18px 3px var(--t);opacity:.6;animation:sk-breathe 2.4s ease-in-out infinite}
.sk-pick:hover:not(:disabled){background-color:#fff}
@media(hover:hover){.sk-pick:hover:not(:disabled){transform:rotate(0) translateY(-3px)}}
.sk-pick:active:not(:disabled){transform:rotate(var(--r,0deg)) scale(.97)}
.sk-pick.sk-chosen,.sk-pick.sk-chosen:active:not(:disabled){transform:translateY(-8px) scale(1.06);z-index:2}
.sk-pick.sk-chosen::after{animation:none;opacity:1}
.sk-waitcard{display:flex;flex-direction:column;align-items:center;gap:12px}
.sk-waitcard p{margin:0}
.sk-face.big{width:58px;height:58px;box-shadow:0 0 0 3px var(--pc),0 6px 14px rgba(20,14,70,.3);animation:sk-bob 1.8s ease-in-out infinite}
@keyframes sk-bob{50%{transform:translateY(-5px) rotate(-4deg)}}
.sk-gotlist{display:flex;flex-direction:column;gap:6px;text-align:left;min-width:min(240px,100%)}
.sk-gotrow,.sk-final{display:flex;align-items:center;gap:10px;padding:5px 12px 5px 6px;border-radius:12px;background:rgba(124,108,255,.09);font-weight:700}
.sk-gotrow .sk-face,.sk-final .sk-face{width:28px;height:28px}
.sk-gotrow b{font:700 1.05rem/1 var(--font-display);color:#139a66}
.sk-gotrow.artist{background:rgba(255,207,92,.2)}.sk-gotrow.artist b{color:#9a6300}
.sk-gotrow small{color:#6b7299;font-weight:700}
.sk-nobody{color:#6b7299;font-weight:700}
.sk-finalcard{min-width:min(280px,94%)}
.sk-final{text-align:left;margin-top:6px}
.sk-final b{font:700 1.05rem/1 var(--font-display);color:#5b4bd6}
.sk-final.win{background:linear-gradient(90deg,rgba(255,207,92,.4),rgba(255,207,92,.12));box-shadow:0 0 0 2px #ffcf5c}
.sk-final.win b{color:#8a5600}
.sk-rank{width:20px;text-align:center;font:700 .95rem/1 var(--font-display);color:#6b7299}
.sk-final.win .sk-rank{color:#b7832a}

/* the palette */
.sk-tools{margin-top:14px}
.sk-palette{display:flex;flex-direction:column;gap:12px;padding:12px;border-radius:20px;background:rgba(14,12,52,.55);border:1px solid rgba(255,255,255,.1)}
.sk-colors{display:flex;flex-wrap:wrap;gap:8px;justify-content:center}
.sk-swatch{position:relative;width:42px;height:42px;min-height:42px;padding:0;border-radius:50%;border:3px solid rgba(255,255,255,.92);background:radial-gradient(circle at 34% 30%,rgba(255,255,255,.55),rgba(255,255,255,0) 42%),var(--c);box-shadow:0 3px 0 rgba(0,0,0,.25),0 6px 12px rgba(0,0,0,.3);color:#5b6390;transition:transform .22s var(--spring),box-shadow .2s}
.sk-swatch:hover:not(:disabled){background-color:var(--c);border-color:#fff}
.sk-swatch.eraser{background:repeating-conic-gradient(#ffffff 0 25%,#e3e7f7 0 50%) 0 0/12px 12px}
.sk-swatch .ic{width:20px;height:20px}
.sk-swatch.on{transform:translateY(-6px) scale(1.12);box-shadow:0 0 0 3px var(--gold),0 10px 18px rgba(0,0,0,.45);z-index:1}
.sk-swatch:active:not(:disabled){transform:scale(.94)}
.sk-swatch.on:active:not(:disabled){transform:translateY(-4px) scale(1.04)}
.sk-tooldeck{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px}
.sk-sizes,.sk-acts{display:flex;gap:8px;align-items:center}
.sk-size{width:46px;height:46px;min-height:46px;padding:0;display:grid;place-items:center;border:0;border-radius:14px;background:#fff;box-shadow:0 3px 0 rgba(0,0,0,.22);transition:transform .22s var(--spring),box-shadow .2s}
.sk-size:hover:not(:disabled){background-color:#fff}
.sk-size i{display:block;border-radius:50%;background:var(--brush,#1d1714);box-shadow:0 0 0 1.5px rgba(27,35,71,.25)}
.sk-size.on{transform:translateY(-5px);box-shadow:0 0 0 3px var(--gold),0 8px 14px rgba(0,0,0,.4)}
.sk-size:active:not(:disabled){transform:scale(.94)}
.sk-size.on:active:not(:disabled){transform:translateY(-3px) scale(.98)}
.sk-act{min-height:44px;padding:6px 14px;border-radius:14px;font-size:.9rem}
.sk-act .ic{width:20px;height:20px}
.sk-tip{display:flex;align-items:center;justify-content:center;gap:8px;margin:0;padding:10px 14px;border-radius:16px;background:rgba(14,12,52,.5);border:1px solid rgba(255,255,255,.08);color:#ddd8ff;font-size:.88rem;text-align:center}
.sk-tip .ic{width:18px;height:18px;color:var(--gold)}

/* guesses */
.sk-chat{padding:14px}
.sk-feed{display:flex;flex-direction:column;justify-content:flex-end;gap:5px;height:128px;overflow:hidden;font-size:.88rem;line-height:1.35;-webkit-mask-image:linear-gradient(transparent,#000 22px);mask-image:linear-gradient(transparent,#000 22px)}
.sk-msg{flex:none;padding:5px 10px;border-radius:12px;background:rgba(255,255,255,.05);overflow-wrap:anywhere}
.sk-msg .ic{width:15px;height:15px;margin-right:6px;vertical-align:-.2em}
.sk-msg b{color:var(--pc,#fff);color:color-mix(in srgb,var(--pc,#fff) 55%,#fff)}
.sk-msg.right{background:linear-gradient(90deg,rgba(62,224,161,.28),rgba(62,224,161,.08));color:#bff8e0;font-weight:800}
.sk-msg.close{background:rgba(255,207,92,.14);color:#ffe3a0;font-style:italic;font-weight:700}
.sk-msg.sys{background:none;color:var(--muted);font-style:italic;padding:2px 10px}
.sk-feed .sk-msg:last-child{animation:sk-msgin .35s var(--spring)}
@keyframes sk-msgin{from{transform:translateY(8px);opacity:0}}
.sk-empty{margin:0;padding:4px 2px}
.sk-guess{position:relative;display:flex;gap:8px;margin-top:10px}
.sk-guess input{flex:1;min-width:0}
.sk-guess.can::after{content:'';position:absolute;inset:-4px;border-radius:16px;pointer-events:none;box-shadow:0 0 0 2px rgba(255,207,92,.6),0 0 16px 2px rgba(255,207,92,.3);animation:sk-breathe 2.6s ease-in-out infinite}
.sk-guess.can:focus-within::after{display:none}
.sk-history .drawer-body{padding-top:0}
.sk-hist{display:flex;flex-direction:column;gap:5px;max-height:240px;overflow-y:auto;font-size:.86rem;line-height:1.35;padding-right:2px}

/* scores */
.sk-scores{padding:14px}
.sk-scores h3{display:flex;align-items:center;gap:8px;margin:0 0 8px}
.sk-scorelist{display:flex;flex-direction:column;gap:4px}
.sk-player{position:relative;display:flex;align-items:center;gap:9px;min-height:44px;padding:6px 10px 6px 7px;border-radius:14px;font-size:.92rem}
.sk-player.drawing{background:rgba(255,207,92,.1);box-shadow:inset 0 0 0 1px rgba(255,207,92,.35)}
.sk-player.me .sk-pname{font-weight:800}
.sk-pname{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sk-badge{display:grid;place-items:center;width:24px;height:24px;border-radius:50%;flex:none}
.sk-badge .ic{width:14px;height:14px}
.sk-badge.draw{background:var(--gold);color:#3b2a00}
.sk-badge.ok{background:var(--good);color:#05271a}
.sk-pts{display:inline-block;min-width:2.4em;text-align:right;font:700 1.15rem/1 var(--font-display);color:var(--gold)}
/* A correct guess: the row flashes and the score pops. The rows are kept between updates, so every other
   rise uses twin keyframes (sk-again): a row that scores again while still flashing flashes again. */
.sk-player.sk-scored::after{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:linear-gradient(90deg,rgba(62,224,161,.38),rgba(62,224,161,.06));box-shadow:inset 0 0 0 1.5px rgba(62,224,161,.85);opacity:0;animation:sk-flash 1.3s ease-out}
@keyframes sk-flash{15%{opacity:1}}
.sk-player.sk-scored .sk-pts{animation:sk-pop .6s var(--spring)}
@keyframes sk-pop{40%{transform:scale(1.4);color:#9ff3cf}}
.sk-player.sk-again::after{animation-name:sk-flash2}
.sk-player.sk-again .sk-pts{animation-name:sk-pop2}
@keyframes sk-flash2{15%{opacity:1}}
@keyframes sk-pop2{40%{transform:scale(1.4);color:#9ff3cf}}

@media(max-width:900px){.sk-grid{grid-template-columns:minmax(0,1fr);gap:14px}.sk-felt{padding:24px 8px 10px}.sk-felt::before{left:16px;right:16px}.sk-feed{height:112px}}
@media(max-width:560px){
  .sk-top{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"who clock" "word word";gap:8px 10px;padding:8px}
  .sk-who{grid-area:who;max-width:none}.sk-word{grid-area:word}.sk-clock{grid-area:clock}
  .sk-colors{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));justify-items:center;gap:8px 4px}
  .sk-palette{padding:10px 8px}
  .sk-sizes,.sk-acts{gap:6px}
  .sk-act{width:44px;padding:0}.sk-act span{display:none}
  .sk-easel{padding:5px;border-radius:20px}.sk-board{border-radius:15px}
  .sk-easel::before,.sk-easel::after{width:46px;height:15px;top:-6px}
  .sk-big{font-size:1.6rem}
  .sk-card{padding:12px 14px}
  .sk-cardtitle{font-size:1.05rem;margin-bottom:4px}
  .sk-final,.sk-gotrow{padding:3px 10px 3px 4px}.sk-final{margin-top:4px}
  .sk-gotlist{gap:4px}
  .sk-final .sk-face,.sk-gotrow .sk-face{width:24px;height:24px}
  /* The word choices must all fit the short phone board without scrolling (the top bar already says
     "Choose a word to draw"). */
  .sk-choosecard p{font-size:.9rem;margin-bottom:8px}.sk-pickhint{display:none}
  .sk-choices{gap:7px;padding:2px 2px 4px}
  .sk-pick{min-height:38px;padding:4px 14px 4px 5px;gap:6px;font-size:1rem}.sk-pick .ic{width:26px;height:26px;padding:5px;border-radius:8px}
}
@media(max-width:400px){
  .sk-letters{gap:3px}.sk-letters b{width:19px;height:27px;font-size:1rem;border-radius:6px}
  .sk-clock{width:46px;height:46px}.sk-clock .sk-time{width:37px;height:37px;font-size:1rem}
  .sk-size{width:42px;height:42px;min-height:42px}.sk-act{width:42px}
  .sk-swatch{width:40px;height:40px;min-height:40px}
  .sk-over{padding:8px}.sk-choosecard{padding:8px 12px}.sk-choosecard p{margin-bottom:6px}.sk-choices{gap:6px;padding:0 2px 2px}
}
`;

export default {
  id: 'sketch', name: 'Sketch Party',
  description: 'Take turns drawing a secret word while everyone else races to guess it. Fast, silly fun for 2–8 players.',
  minPlayers: 2, maxPlayers: 8, simultaneous: true, keepDom: true,
  options: [
    { id: 'rounds', label: '🔁 Rounds', default: '2', choices: [['1', '1 round'], ['2', '2 rounds'], ['3', '3 rounds']] },
    { id: 'time', label: '⏱ Drawing time', default: '80', choices: [['60', '60 seconds'], ['80', '80 seconds'], ['100', '100 seconds']] },
    levelOption(),
  ],
  cover: coverSVG(),
  howTo: {
    goal: 'Score the most points over all the rounds by guessing other people’s drawings quickly, and by drawing so well that others guess yours.',
    turn: [
      ['✏️', 'Take turns drawing', 'Each round everyone draws once. The drawer secretly picks one of three words and draws it. No letters or numbers!'],
      ['⌨️', 'Everyone else guesses', 'Type guesses in the box. Wrong guesses are shown to everyone; near misses are shown only to you.'],
      ['💡', 'Hints appear', 'Halfway through and again near the end, a letter of the word is revealed.'],
      ['🏅', 'Scoring', 'Guess faster for more points (up to 300). The drawer earns 50 for every player who guesses.'],
    ],
    tips: ['The host picks the number of rounds and the drawing time in the lobby.', 'Use the white brush as an eraser, Undo to remove your last line, and Give up if a drawing goes wrong.', 'Computer players can draw a few simple pictures, and guess from the hints.'],
  },
  setup, act, view, bot, render,
  turnOf: (s) => (s.over ? [] : s.phase === 'choose' ? [s.drawer] : s.players.map((p) => p.id)),
};
