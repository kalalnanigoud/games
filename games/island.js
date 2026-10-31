// Creature Island: up to four friends explore one island together in real time, befriend creatures,
// raise companions and calm the storm on Stormcrown Peak. The host's device runs the world
// (island-sim.js); everyone's screen is island-client.js. Explorers are saved only when a player asks:
// to the cloud (island-cloud.js) or to a file.
import { injectCSS } from '../js/fx.js';
import { uid } from '../js/util.js';
import { TICK } from './island-data.js';
import { World } from './island-sim.js';
import { createClient } from './island-client.js';
import * as islandArt from './island-art.js';

let world = null, api = null, timer = null, client = null, clientKey = '', lastCtx = null, ticker = null;
// For the browser tests (tools/island-ci.mjs): the running world and this screen.
export const debug = { get world() { return world; }, get client() { return client; } };

function stepper() {
  if (!world) return;
  const now = performance.now();
  ticker.acc += Math.min(250, now - ticker.at);
  ticker.at = now;
  let n = 0;
  while (ticker.acc >= TICK * 1000 && n++ < 5) { ticker.acc -= TICK * 1000; world.step(); }
  if (ticker.acc > TICK * 1000) ticker.acc = 0; // after a long pause, carry on rather than race to catch up
}
// A worker's timer keeps the host's world running at full speed when its tab is in the background
// (timers on the page itself slow to once a second there). Plain setInterval if workers aren't allowed.
function startTicker() {
  ticker = { at: performance.now(), acc: 0 };
  try {
    const src = URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 25);'], { type: 'text/javascript' }));
    const wk = new Worker(src);
    URL.revokeObjectURL(src);
    wk.onmessage = stepper;
    timer = { stop: () => wk.terminate() };
  } catch {
    const id = setInterval(stepper, 25);
    timer = { stop: () => clearInterval(id) };
  }
}

function ensureClient(pid, isHost, local) {
  const key = `${pid}:${isHost}`;
  if (client && clientKey === key) return client;
  client?.destroy();
  clientKey = key;
  client = createClient({ pid, isHost, local, send: (d) => !!lastCtx?.live?.send?.(d) });
  return client;
}

export default {
  id: 'island',
  name: 'Creature Island',
  description: 'Explore a living island with up to three friends: befriend creatures, raise companions and fight side by side to calm the storm on Stormcrown Peak.',
  minPlayers: 1, maxPlayers: 4,
  live: true, dropIn: true, soloOnDevice: true, manualSave: true, simultaneous: true,
  cover: islandArt.COVER_SVG || '',
  howTo: {
    goal: 'A storm has settled on Stormcrown Peak and the island’s creatures are restless. Explore Brightwater Village, Whispering Woods, Sunsand Shore, Mirror Lake and Glowdeep Cave, gather the three island shards, and calm the storm together.',
    turn: [
      ['🧭', 'Move and explore', 'Computer: WASD or the arrow keys. Phone: put your thumb anywhere on the left half of the screen. Everyone moves at the same time and can split up; arrows at the screen edge point to your friends and to your goal (★).'],
      ['⚔️', 'Fight in real time', 'Attack with J, Space or a click (the sword button on a phone); dodge with K or Shift. Red shapes on the ground show where an attack is about to land: dodge out of them. Your companion fights beside you; L or Q (the paw) uses its special move.'],
      ['🎀', 'Befriend creatures', 'Weaken a wild creature to a third of its health: a gold ring and its chance appear over it. Then press C (Befriend) to throw a Bond Charm. Up to three travel with you; the rest wait at the village ranch.'],
      ['💬', 'Talk, gather, help', 'E (or the hand button) talks to people, picks berries and shells, opens chests and revives a knocked-out friend. Healer Sana rests everyone; Toma sells charms, berries and gear.'],
      ['💾', 'Saving', 'Nothing saves by itself. Open the bag (B) → Save and choose Save adventure, or save to a file. Each player saves their own explorer, and can bring it to any friend’s island later.'],
    ],
    tips: [
      'Elements matter: Leaf beats Tide and Stone, Tide beats Ember, Ember beats Leaf, Spark beats Tide, Stone beats Spark and Ember.',
      'A friend’s open bridge or gate opens for everyone on the island, so a new explorer can join the adventure anywhere.',
      'If the host closes their page, the island closes too: save before long breaks. Friends who drop out keep their explorer while the island stays open.',
    ],
  },

  setup() { return { sid: uid(), phase: 'explore', over: false }; },
  act() { throw new Error('Creature Island is played live.'); },
  turnOf() { return []; },
  view(state) { return state; },

  // ---- the host's world ----
  startHost(platform, state) {
    this.stopLive();
    api = platform;
    world = new World({
      send: (pid, msg) => {
        if (pid === world?.localPid) client?.receive(msg);
        else api.post(pid, msg);
      },
    });
    world.sid = state.sid;
    startTicker();
  },
  hostRoom(list) {
    if (!world) return;
    world.room(list);
    const mine = lastCtx?.me;
    world.localPid = mine;
    for (const p of world.players.values()) p.local = p.id === mine;
  },
  hostMessage(pid, d) { world?.message(pid, d); },
  guestMessage(d) { client?.receive(d); },
  stopLive() {
    timer?.stop(); timer = null;
    world = null; api = null;
    client?.destroy(); client = null; clientKey = '';
  },
  beforeExit(kind, proceed) { return client ? client.beforeExit(kind, proceed) : false; },

  render(el, view, ctx) {
    injectCSS('island', ISLAND_CSS);
    lastCtx = ctx;
    if (world) { world.localPid = ctx.me; for (const p of world.players.values()) p.local = p.id === ctx.me; }
    const c = ensureClient(ctx.me, !!ctx.isHost, !!ctx.isHost);
    c.mount(el, ctx);
  },
};

const ISLAND_CSS = `
.isl-root [hidden] { display: none !important; }
.isl-root { position: relative; width: 100%; height: 70vh; border-radius: 18px; overflow: hidden; background: #0b1530; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; font-family: var(--font-body); color: #fff; box-shadow: var(--shadow); }
/* Phones: edge to edge under the game bar, down to the bottom of the screen (the page has 14px sides). */
@media (max-width: 640px) { #app .isl-root { width: calc(100% + 28px); margin: -12px -14px calc(-1 * max(24px, env(safe-area-inset-bottom))); border-radius: 0; box-shadow: none; } }
.isl-canvas { position: absolute; inset: 0; display: block; }
.isl-root button { touch-action: manipulation; }
.isl-root svg { width: 20px; height: 20px; flex: none; }
.isl-hud { position: absolute; inset: 0; pointer-events: none; }
.isl-hud > * { pointer-events: auto; }
.isl-bar { position: relative; height: 8px; border-radius: 6px; background: rgba(5,10,25,.7); overflow: hidden; box-shadow: inset 0 1px 2px rgba(0,0,0,.5); }
.isl-bar i { position: absolute; inset: 0 auto 0 0; border-radius: 6px; transition: width .25s ease; }
.isl-bar.hp i { background: linear-gradient(180deg, #8ce99a, #37b24d); }
.isl-bar.xp { height: 4px; margin-top: 4px; }
.isl-bar.xp i { background: linear-gradient(180deg, #ffe066, #f59f00); }
.isl-bar.boss { height: 12px; }
.isl-bar.boss i { background: linear-gradient(180deg, #ff8787, #e03131); }
.isl-me { position: absolute; left: 10px; top: 10px; width: min(230px, 46vw); padding: 9px 11px 10px; border-radius: 16px; background: rgba(13,20,44,.82); border: 1px solid rgba(255,255,255,.1); border-left: 4px solid var(--seat, #ff6b6b); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px); }
.isl-me-top { display: flex; align-items: baseline; gap: 6px; margin-bottom: 5px; }
.isl-me-name { font-family: var(--font-display); font-size: 1rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
.isl-me-lv { font-family: var(--font-display); font-size: .85rem; color: #ffe066; }
.isl-me-hp { height: 12px; }
.isl-me-hpt { position: absolute; inset: 0; font: 800 9px/12px var(--font-body); font-style: normal; text-align: center; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,.8); }
.isl-comp { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.isl-comp img { width: 34px; height: 34px; border-radius: 12px; background: radial-gradient(circle at 40% 35%, rgba(255,255,255,.25), rgba(255,255,255,.04)); }
.isl-comp small { display: block; font-size: .72rem; font-weight: 800; margin-bottom: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.isl-comp.fainted img { filter: grayscale(1) opacity(.5); }
.isl-quest { position: absolute; right: 64px; top: 10px; max-width: min(300px, 44vw); padding: 8px 12px; border-radius: 14px; background: rgba(13,20,44,.78); border: 1px solid rgba(255,212,59,.28); }
.isl-quest b { display: block; font-family: var(--font-display); font-weight: 600; font-size: .88rem; color: #ffe066; }
.isl-quest b::before { content: '★ '; }
.isl-quest span { display: block; font-size: .78rem; line-height: 1.3; color: #e9ecf5; }
.isl-friends { position: absolute; left: 10px; top: 128px; display: flex; flex-direction: column; gap: 6px; pointer-events: none !important; }
.isl-friend { display: flex; align-items: center; gap: 7px; padding: 5px 10px 5px 7px; border-radius: 12px; background: rgba(13,20,44,.7); font-size: .74rem; max-width: 190px; }
.isl-friend b { display: block; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.isl-friend small { display: block; color: #c5cbe0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.isl-friend .isl-shape { width: 14px; height: 14px; color: var(--seat); }
.isl-friend.down { background: rgba(120,20,30,.75); }
.isl-friend.away { opacity: .6; }
.isl-raid { position: absolute; left: 50%; top: 12px; transform: translateX(-50%); padding: 7px 14px; border-radius: 999px; background: rgba(95,61,196,.88); font-weight: 800; font-size: .82rem; white-space: nowrap; }
.isl-boss { position: absolute; left: 50%; top: 10px; transform: translateX(-50%); width: min(420px, 60vw); padding: 7px 12px 9px; border-radius: 14px; background: rgba(13,20,44,.85); border: 1px solid rgba(255,135,135,.35); text-align: center; }
.isl-boss b { font-family: var(--font-display); font-size: 1rem; }
.isl-boss small { margin-left: 8px; color: #ffc9c9; font-size: .74rem; }
.isl-boss .isl-bar { margin-top: 5px; }
.isl-bagbtn { position: absolute; right: 10px; top: 10px; width: 46px; height: 46px; border-radius: 15px; display: grid; place-items: center; padding: 0; background: rgba(13,20,44,.85); border: 1px solid rgba(255,255,255,.14); color: #fff; }
.isl-bagbtn svg { width: 24px; height: 24px; }
.isl-dot { display: none; position: absolute; right: 7px; top: 7px; width: 9px; height: 9px; border-radius: 50%; background: #ffa94d; box-shadow: 0 0 0 2px rgba(13,20,44,.9); }
.isl-bagbtn.unsaved .isl-dot, .isl-tabs .isl-dot { display: block; }
.isl-keyhint { position: absolute; left: 50%; bottom: 10px; transform: translateX(-50%); padding: 6px 12px; border-radius: 999px; background: rgba(13,20,44,.7); font-size: .76rem; color: #dee2f0; white-space: nowrap; pointer-events: none !important; }
.isl-keyhint:empty { display: none; }
.isl-keyhint kbd { display: inline-block; min-width: 18px; padding: 0 5px; border-radius: 5px; background: rgba(255,255,255,.16); font: 800 .72rem var(--font-body); text-align: center; }
.isl-root.touch .isl-keyhint { display: none; }
.isl-banner { position: absolute; left: 50%; top: 22%; transform: translateX(-50%); text-align: center; pointer-events: none; animation: isl-banner 2.6s ease both; text-shadow: 0 2px 10px rgba(0,0,0,.6); width: max-content; max-width: 90%; }
.isl-banner b { display: block; font-family: var(--font-display); font-size: clamp(1.3rem, 4vw, 2rem); color: #fff; }
.isl-banner span { display: block; margin-top: 2px; font-weight: 800; color: #ffe066; font-size: .95rem; }
.isl-banner.big b { font-size: clamp(1.8rem, 6vw, 2.8rem); color: #ffc9c9; letter-spacing: .02em; }
.isl-banner.area { top: 30%; animation-duration: 2.2s; }
.isl-banner.area b { font-size: clamp(1.1rem, 3.4vw, 1.6rem); font-weight: 500; letter-spacing: .08em; }
@keyframes isl-banner { 0% { opacity: 0; transform: translate(-50%, 10px) scale(.96); } 12%, 78% { opacity: 1; transform: translate(-50%, 0) scale(1); } 100% { opacity: 0; transform: translate(-50%, -6px); } }
.isl-touch { position: absolute; inset: 0; pointer-events: none; }
.isl-stickzone { position: absolute; left: 0; bottom: 0; width: 50%; height: 62%; pointer-events: auto; }
.isl-stick { position: absolute; left: 90px; top: calc(100% - 100px); width: 110px; height: 110px; margin: -55px 0 0 -55px; border-radius: 50%; background: radial-gradient(circle, rgba(255,255,255,.12), rgba(255,255,255,.04)); border: 2px solid rgba(255,255,255,.22); opacity: .55; transition: opacity .15s; }
.isl-stick.on { opacity: 1; }
.isl-stick i { position: absolute; left: 50%; top: 50%; width: 50px; height: 50px; margin: -25px 0 0 -25px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #fff, #c5cbe0); box-shadow: 0 3px 10px rgba(0,0,0,.4); }
.isl-pad { position: absolute; right: max(12px, env(safe-area-inset-right)); bottom: max(14px, env(safe-area-inset-bottom)); width: 200px; height: 200px; pointer-events: none; }
.isl-btn { position: absolute; display: grid; place-items: center; padding: 0; border-radius: 50%; pointer-events: auto; color: #fff; border: 2px solid rgba(255,255,255,.25); box-shadow: 0 4px 12px rgba(0,0,0,.35), inset 0 2px 0 rgba(255,255,255,.25); transition: transform .08s; }
.isl-btn.down { transform: scale(.92); }
.isl-btn svg { width: 26px; height: 26px; }
.isl-attack { right: 0; bottom: 0; width: 82px; height: 82px; background: radial-gradient(circle at 35% 30%, #ff8787, #e03131); }
.isl-attack svg { width: 34px; height: 34px; }
.isl-dodge { right: 94px; bottom: 4px; width: 58px; height: 58px; background: radial-gradient(circle at 35% 30%, #74c0fc, #1971c2); }
.isl-ability { right: 10px; bottom: 94px; width: 62px; height: 62px; background: radial-gradient(circle at 35% 30%, #8ce99a, #2f9e44); }
.isl-ability .isl-cd { position: absolute; inset: -2px; width: calc(100% + 4px); height: calc(100% + 4px); transform: rotate(-90deg); fill: none; stroke: rgba(13,20,44,.7); stroke-width: 34; stroke-dasharray: 0 101; }
.isl-act, .isl-catch { width: auto; min-width: 64px; height: 48px; border-radius: 16px; padding: 0 12px; display: flex; gap: 6px; font-weight: 800; font-size: .85rem; }
.isl-act { right: 84px; bottom: 76px; background: radial-gradient(circle at 35% 30%, #b197fc, #6741d9); }
.isl-catch { right: 84px; bottom: 132px; background: radial-gradient(circle at 35% 30%, #ffe066, #f08c00); color: #3b2a00; animation: isl-pulse 1.2s ease-in-out infinite; }
.isl-catch small { display: block; font-size: .7rem; }
.isl-root:not(.touch) .isl-act, .isl-root:not(.touch) .isl-catch { display: none !important; }
@keyframes isl-pulse { 50% { box-shadow: 0 0 0 6px rgba(255,212,59,.25), 0 4px 12px rgba(0,0,0,.35); } }
.isl-dialog { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); width: min(560px, calc(100% - 24px)); padding: 12px 14px 14px; border-radius: 18px; background: linear-gradient(180deg, #fffaf0, #f3e7cf); color: #2b2440; box-shadow: 0 10px 30px rgba(0,0,0,.45); border: 2px solid #e2cfa6; z-index: 5; }
.isl-root.touch .isl-dialog { bottom: auto; top: 64px; }
.isl-dlg-head { display: flex; align-items: center; gap: 10px; }
.isl-dlg-head img { width: 40px; height: 40px; border-radius: 12px; background: #e8dcc2; }
.isl-dlg-head b { flex: 1; font-family: var(--font-display); font-size: 1.05rem; color: #6b3f1d; }
.isl-dialog p { margin: 8px 2px 10px; font-size: .98rem; line-height: 1.45; }
.isl-dlg-acts { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
.isl-dlg-acts button { min-height: 42px; }
.isl-dlg-acts .isl-starter { display: flex; align-items: center; gap: 8px; padding: 6px 14px 6px 6px; background: #fff; color: #2b2440; border: 2px solid #e2cfa6; border-radius: 16px; font-weight: 800; }
.isl-dlg-acts .isl-starter img { width: 44px; height: 44px; }
.isl-dlg-acts .isl-starter:hover, .isl-dlg-acts .isl-starter:focus-visible { background: #fff3d6; color: #2b2440; border-color: #d9a441; }
.isl-x { margin-left: auto; width: 40px; height: 40px; min-width: 40px; }
.isl-dialog .isl-x { color: #6b3f1d; background: transparent; border-color: transparent; }
.isl-panel, .isl-ui { position: absolute; right: 10px; top: 64px; bottom: 10px; width: min(380px, calc(100% - 20px)); display: flex; flex-direction: column; border-radius: 18px; background: rgba(16,25,56,.97); border: 1px solid rgba(255,255,255,.12); box-shadow: 0 12px 40px rgba(0,0,0,.5); z-index: 6; overflow: hidden; animation: isl-in .18s ease; }
.isl-ui { z-index: 7; padding: 12px; overflow-y: auto; }
@media (max-width: 720px) { .isl-panel, .isl-ui { left: 0; right: 0; top: auto; bottom: 0; width: auto; max-height: 64%; border-radius: 20px 20px 0 0; padding-bottom: env(safe-area-inset-bottom); } }
@keyframes isl-in { from { opacity: 0; transform: translateY(10px); } }
.isl-tabs { display: flex; gap: 2px; padding: 6px; border-bottom: 1px solid rgba(255,255,255,.08); overflow-x: auto; flex: none; }
.isl-tabs button { position: relative; display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 44px; min-height: 44px; padding: 5px 6px; font-size: .66rem; font-weight: 800; border-radius: 12px; background: transparent; border: 0; color: #c5cbe0; }
.isl-tabs button[aria-selected="true"] { background: rgba(124,108,255,.25); color: #fff; }
.isl-tabs .isl-x { align-self: center; }
.isl-panel-body { padding: 12px 14px 16px; overflow-y: auto; flex: 1; }
.isl-panel h4, .isl-ui h4 { margin: 14px 0 6px; font-family: var(--font-display); font-weight: 500; color: #c5cbe0; font-size: .9rem; }
.isl-ui-head { display: flex; align-items: center; gap: 10px; }
.isl-ui-head b { font-family: var(--font-display); font-size: 1.15rem; }
.isl-shells { color: #ffe8a3; font-weight: 800; font-size: .9rem; }
.isl-list .isl-coin, .isl-coin { width: 16px; height: 16px; margin-left: 3px; vertical-align: -3px; flex: none; }
.isl-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.isl-list li { display: flex; align-items: center; gap: 10px; padding: 7px 9px; border-radius: 12px; background: rgba(255,255,255,.05); }
.isl-list img { width: 36px; height: 36px; flex: none; }
.isl-list span { flex: 1; min-width: 0; }
.isl-list b { display: block; font-size: .88rem; }
.isl-list small { display: block; font-size: .74rem; color: #c5cbe0; line-height: 1.3; }
.isl-list button { min-height: 40px; }
.isl-cards { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.isl-cards li { display: flex; gap: 10px; padding: 10px; border-radius: 14px; background: rgba(255,255,255,.05); border: 1px solid transparent; }
.isl-cards li.out { border-color: rgba(140,233,154,.45); background: rgba(140,233,154,.08); }
.isl-cards li.fainted img { filter: grayscale(1); opacity: .6; }
.isl-cards img { width: 56px; height: 56px; flex: none; border-radius: 14px; background: radial-gradient(circle at 40% 35%, rgba(255,255,255,.2), rgba(255,255,255,.03)); }
.isl-cards b { display: block; font-size: .95rem; }
.isl-cards b small { color: #ffe066; font-size: .78rem; }
.isl-cards small { display: block; font-size: .74rem; margin-top: 3px; line-height: 1.3; }
.isl-cards .isl-bar { margin-top: 5px; }
.isl-el { display: inline-block; margin-left: 4px; padding: 1px 7px; border-radius: 999px; font-size: .66rem; font-weight: 800; color: #10182f; background: var(--el); vertical-align: middle; }
.isl-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; align-items: center; }
.isl-row button, .isl-col button { min-height: 42px; }
.isl-col { display: grid; gap: 8px; margin-top: 12px; }
.isl-quests { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.isl-quests li { padding: 8px 10px; border-radius: 12px; background: rgba(255,255,255,.05); border-left: 3px solid #74c0fc; }
.isl-quests li.main { border-left-color: #ffd43b; }
.isl-quests b { display: flex; align-items: center; gap: 6px; font-size: .88rem; }
.isl-quests small { display: block; font-size: .76rem; color: #c5cbe0; margin-top: 2px; }
.isl-quests.done li { border-left-color: #8ce99a; opacity: .75; }
.isl-quests.done svg { width: 14px; height: 14px; color: #8ce99a; }
.isl-dex { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 6px; }
.isl-dex li { padding: 8px; border-radius: 12px; background: rgba(255,255,255,.04); text-align: center; }
.isl-dex li.caught { background: rgba(255,212,59,.1); }
.isl-dex img { width: 48px; height: 48px; }
.isl-dex b { display: block; font-size: .78rem; }
.isl-dex small { display: block; font-size: .66rem; color: #aab1c9; line-height: 1.25; }
.isl-map { border-radius: 12px; overflow: hidden; background: #1f5f99; }
.isl-map canvas { display: block; width: 100%; height: auto; image-rendering: pixelated; }
.isl-save-state { display: flex; align-items: center; gap: 8px; padding: 9px 12px; border-radius: 12px; background: rgba(255,255,255,.06); font-weight: 700; font-size: .88rem; margin: 0 0 8px; }
.isl-save-state.good { background: rgba(140,233,154,.12); color: #b2f2bb; }
.isl-save-state.warn { background: rgba(255,169,77,.14); color: #ffd8a8; }
.isl-save-state.bad { background: rgba(255,107,107,.15); color: #ffc9c9; }
.isl-overlay { position: absolute; inset: 0; display: grid; place-items: center; padding: 16px; background: rgba(8,12,30,.55); z-index: 8; overflow-y: auto; }
.isl-overlay.pass { background: transparent; pointer-events: none; place-items: end center; }
.isl-overlay.pass > * { pointer-events: auto; }
.isl-card { width: min(460px, 100%); padding: 18px 18px 20px; border-radius: 22px; background: linear-gradient(180deg, #1b2a5e, #121c42); border: 1px solid rgba(255,255,255,.12); box-shadow: 0 20px 50px rgba(0,0,0,.5); }
.isl-card h2 { margin: 0 0 6px; font-family: var(--font-display); font-size: 1.5rem; }
.isl-card h4 { margin: 14px 0 6px; font-family: var(--font-display); font-weight: 500; color: #c5cbe0; }
.isl-card p { margin: 6px 0; }
.isl-continue { display: flex; align-items: center; gap: 12px; width: 100%; padding: 10px 14px 10px 10px; margin-top: 10px; text-align: left; border-radius: 16px; background: linear-gradient(180deg, #7c6cff, #5b4bdb); color: #fff; border: 0; }
.isl-continue img { width: 52px; height: 52px; border-radius: 14px; background: rgba(255,255,255,.15); }
.isl-continue b { display: block; font-size: 1rem; }
.isl-continue small { display: block; font-size: .76rem; opacity: .9; }
.isl-newx { display: flex; gap: 12px; align-items: center; }
.isl-preview { width: 96px; height: 120px; border-radius: 16px; background: radial-gradient(circle at 50% 70%, #7ac45c, #4e9a48); flex: none; }
.isl-swatches { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.isl-sw, .isl-hair { width: 40px; height: 40px; min-width: 40px; padding: 0; border-radius: 12px; border: 2px solid rgba(255,255,255,.2); font-weight: 800; }
.isl-sw.on, .isl-hair.on { border-color: #ffd43b; box-shadow: 0 0 0 2px rgba(255,212,59,.35); }
.isl-file { display: inline-flex; align-items: center; gap: 8px; min-height: 42px; padding: 0 14px; border-radius: 12px; border: 1px solid var(--line-2, rgba(255,255,255,.2)); cursor: pointer; font-weight: 700; }
.isl-down { margin-bottom: 120px; display: grid; gap: 6px; justify-items: center; padding: 14px 18px; border-radius: 18px; background: rgba(120,20,30,.88); text-align: center; max-width: 340px; }
.isl-down b { font-family: var(--font-display); font-size: 1.3rem; }
.isl-down span { font-size: .85rem; }
.isl-down button { min-height: 42px; }
.isl-end h2 { color: #ffe066; }
@media (max-width: 720px) {
  .isl-me { left: max(8px, env(safe-area-inset-left)); top: 8px; padding: 7px 9px 8px; width: 44vw; max-width: 200px; }
  .isl-quest { right: 60px; top: 8px; width: auto; max-width: calc(56vw - 76px); padding: 6px 9px; }
  .isl-quest span { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; font-size: .72rem; }
  .isl-friends { top: 118px; }
  .isl-friend { max-width: 130px; padding: 3px 8px 3px 6px; }
  .isl-friend small { display: none; }
  .isl-friend.down small, .isl-friend.away small { display: block; }
  .isl-boss { top: auto; bottom: 230px; width: min(340px, 86vw); }
  .isl-banner { top: 26%; }
}
`;
