// Shared presentation and turn handling for the cooperative collection.
import { esc, log, addFx, PLAYER_COLORS } from '../js/util.js';
import { injectCSS } from '../js/fx.js';
import { icon } from '../js/icons.js';
import { portrait } from '../js/avatar.js';

export const distance = (a, b, width = 4) => Math.abs(a % width - b % width) + Math.abs(Math.floor(a / width) - Math.floor(b / width));
export const action = (type, label, score, extra = {}) => ({ type, label, score, ...extra });
export function finish(s, won, reason) {
  s.over = true; s.won = won; s.phase = 'over'; s.reason = reason;
  s.winners = won ? s.players.map(p => p.id) : [];
  log(s, reason);
}

// Generic fallback cover for themes that do not draw their own (spec.cover).
const palettes = { temple: ['#072d36','#2bbab2','#e9c787'], ember: ['#152c23','#94c36e','#ffb15b'], aurora: ['#101f3e','#67cde3','#b6a1ff'], caravan: ['#251b40','#bc9ae9','#eec779'] };
export function art(kind, variant = 0) {
  const [bg, light, gold] = palettes[kind];
  const id = `coop-${kind}-${variant}`;
  const stars = Array.from({length:18},(_,i)=>`<circle cx="${(i*71+31)%320}" cy="${(i*37+13)%180}" r="${i%3===0?1.5:.7}" fill="${gold}" opacity=".6"/>`).join('');
  const tree = (x,y,n=1) => `<g transform="translate(${x} ${y}) scale(${n})"><path d="M-4 0h8v-45h-8z" fill="#765641"/><path d="M0-95L-30-43h16l-24 30h76L14-43h16z" fill="url(#${id}-light)" stroke="#c4e6a0" stroke-opacity=".3"/></g>`;
  let scene;
  if(kind==='temple') scene=`<path d="M0 160Q70 130 160 156T320 150V200H0" fill="#19899a" opacity=".6"/><path d="M52 152V70L160 20l108 50v82z" fill="#315254" stroke="${gold}" stroke-width="2"/><path d="M70 75L160 35l90 40z" fill="#839483"/><path d="M82 150V84h30v66m96 0V84h30v66" stroke="#aaad8b" stroke-width="12"/><path d="M126 155V95q34-42 68 0v60" fill="#062a30"/><path d="M160 87l17 24-17 24-17-24z" fill="${gold}" stroke="#fff5c9" stroke-width="3"/><path d="M0 174q65-18 130 0t190 0M0 188q75-18 150 0t170 0" fill="none" stroke="#7ce1db" stroke-opacity=".5"/>`;
  else if(kind==='ember') scene=`<path d="M0 175Q90 95 170 148T320 132v68H0" fill="#304a2c"/>${tree(35,175,1.2)}${tree(95,165,.85)}${tree(260,180,1.4)}<path d="M150 163v-40h59v40" fill="#ac7951" stroke="#edc484"/><path d="M137 126l43-38 43 38z" fill="#684c39"/><path d="M172 163v-26h17v26" fill="#e6bc68"/><path d="M0 190q100-55 170 10" fill="none" stroke="#74c6cb" stroke-width="15"/><path d="M235 159q-23-21-2-42-1 15 11 15 9-22 4-37 38 40 12 64z" fill="#e96b39"/><path d="M241 156q-11-17 8-28 16 15 4 28z" fill="#ffda7d"/>`;
  else if(kind==='aurora') scene=`<ellipse cx="275" cy="53" rx="63" ry="58" fill="url(#${id}-light)" opacity=".55"/><path d="M35 119l53-53h147l55 53-55 37H88z" fill="#465774" stroke="#b9d4df" stroke-width="3"/><path d="M53 116h218M100 70v82m55-82v82m55-82v82" stroke="#101d35" stroke-width="5"/>${[0,1,2,3].map(i=>`<rect x="${72+i*49}" y="88" width="30" height="18" rx="4" fill="${light}" opacity=".8"/>`).join('')}<path d="M39 119L4 140l34-5M280 119l35 21-35-5" fill="${gold}"/><circle cx="161" cy="130" r="11" fill="#94e3dc"/>`;
  else scene=`<circle cx="245" cy="48" r="28" fill="#eddda8"/><path d="M0 147l60-79 58 61 66-86 87 99 49-29v87H0" fill="#4d4161"/><path d="M0 178q110-60 320-9" stroke="#a48b76" stroke-width="20" fill="none"/><path d="M86 151v-42q47-58 94 0v42z" fill="#685c82" stroke="${gold}" stroke-width="3"/><path d="M105 148v-39q28-35 56 0v39" fill="#322543"/>${[104,164].map(x=>`<circle cx="${x}" cy="158" r="16" fill="#30243c" stroke="${gold}" stroke-width="4"/><path d="M${x-12} 158h24m-12-12v24" stroke="${gold}"/>`).join('')}<rect x="184" y="112" width="15" height="23" rx="3" fill="${gold}"/><path d="M191 110v-19" stroke="${gold}"/><path d="M215 158q-12-24 0-42 15 17 0 42" fill="#8ad0a6"/>`;
  return `<svg viewBox="0 0 320 200" role="img" aria-label="${esc({temple:'Ancient temple rising from turquoise water',ember:'Forest village beside a river and wildfire',aurora:'Illuminated starship above a distant planet',caravan:'Lantern-lit caravan beneath a moonlit mountain'}[kind])}"><defs><linearGradient id="${id}-bg" x2="0" y2="1"><stop stop-color="${bg}"/><stop offset="1" stop-color="#070f19"/></linearGradient><linearGradient id="${id}-light" x2="1" y2="1"><stop stop-color="${light}"/><stop offset="1" stop-color="${bg}"/></linearGradient></defs><rect width="320" height="200" rx="12" fill="url(#${id}-bg)"/>${stars}${scene}</svg>`;
}

/* ---------- small shared pieces the games draw with ---------- */

// Extra line icons in the style of js/icons.js (24px, current colour). Unknown names fall back to icon().
const GLYPHS = {
  compass: '<circle cx="12" cy="12" r="8.5"/><path d="M15.5 8.5l-2.2 4.8-4.8 2.2 2.2-4.8z"/>',
  pick: '<path d="M4.5 10.5C8 6 14.5 4.6 19.5 6.5"/><path d="M12.3 6.2L6 20"/>',
  drop: '<path d="M12 3.5s-6 6.4-6 10.3a6 6 0 0 0 12 0C18 9.9 12 3.5 12 3.5z"/>',
  drain: '<path d="M12 3.5s-6 6.4-6 10.3a6 6 0 0 0 12 0C18 9.9 12 3.5 12 3.5z"/><path d="M9.2 14h5.6"/>',
  gate: '<path d="M4.5 20.5V9.5L12 4.5l7.5 5v11M3.5 20.5h17M8.5 20.5v-8h7v8M12 12.5v8"/>',
  anchor: '<circle cx="12" cy="5.5" r="2"/><path d="M12 7.5v13M5 13.5a7 7 0 0 0 14 0M8.5 10.5h7"/>',
  douse: '<path d="M12 2.8s-4.6 5-4.6 8.2a4.6 4.6 0 0 0 9.2 0c0-3.2-4.6-8.2-4.6-8.2z"/><path d="M3.5 20c1.4-1 2.9-1 4.3 0s2.9 1 4.3 0 2.9-1 4.3 0 2.9 1 4.3 0"/>',
  paw: '<g fill="currentColor" stroke="none"><ellipse cx="6.3" cy="10.5" rx="1.9" ry="2.4"/><ellipse cx="9.9" cy="6.6" rx="1.9" ry="2.4"/><ellipse cx="14.1" cy="6.6" rx="1.9" ry="2.4"/><ellipse cx="17.7" cy="10.5" rx="1.9" ry="2.4"/><path d="M12 11.6c-3 0-5.6 3.6-5.6 6 0 1.6 1.3 2.6 2.8 2.6 1.1 0 1.9-.6 2.8-.6s1.7.6 2.8.6c1.5 0 2.8-1 2.8-2.6 0-2.4-2.6-6-5.6-6z"/></g>',
  tent: '<path d="M2.5 20.5h19M4 20.5L12 5l8 15.5M9.5 20.5l2.5-5 2.5 5"/>',
  bucket: '<path d="M5 9h14l-1.7 10.2a1.6 1.6 0 0 1-1.6 1.3H8.3a1.6 1.6 0 0 1-1.6-1.3zM7 9a5 5 0 0 1 10 0M8.2 13h7.6"/>',
  wave: '<path d="M3 9c1.5-1.2 3-1.2 4.5 0s3 1.2 4.5 0 3-1.2 4.5 0 3 1.2 4.5 0M3 15c1.5-1.2 3-1.2 4.5 0s3 1.2 4.5 0 3-1.2 4.5 0 3 1.2 4.5 0"/>',
  flame: '<path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.3 2.3-5.4 3.6-8.3.8 1.7 1.7 2.6 2.9 3 .2-2.9 1.5-5.3 3.3-6.5-.3 2.6.6 4.4 2 6.2 1.1 1.4 1.7 3 1.7 5.1 0 3.9-2.7 6.7-7 6.7z"/>',
  wind: '<path d="M3 8.5h10.5a2.5 2.5 0 1 0-2.5-2.5M3 12.5h15a2.8 2.8 0 1 1-2.8 2.8M3 16.5h7"/>',
  relic: '<path d="M12 3l6.5 6.5L12 21 5.5 9.5zM5.5 9.5h13M9.5 9.5L12 21l2.5-11.5"/>',
  pin: '<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  wrench: '<path d="M14.5 4.5a4.5 4.5 0 0 0-4.2 6.1L4.5 16.4a2 2 0 0 0 2.8 2.8l5.8-5.8a4.5 4.5 0 0 0 6.1-4.2l-2.6 2.6-2.8-.6-.6-2.8z"/>',
  cross: '<path d="M9.5 4h5v5.5H20v5h-5.5V20h-5v-5.5H4v-5h5.5z"/>',
  journal: '<path d="M6.5 3.5h11a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5h-11zM6.5 3.5v17M10 8h5.5M10 11.5h5.5"/>',
};
export function glyph(name, cls = '') {
  if (!GLYPHS[name]) return icon(name, cls);
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${GLYPHS[name]}</svg>`;
}
// A small label on a board space: icon plus a short value ("2/4", "Fox").
export const chip = (name, text = '', cls = '') => `<span class="coop-chip ${cls}">${glyph(name)}${text === '' ? '' : `<b>${text}</b>`}</span>`;
export const colour = (i) => PLAYER_COLORS[i % PLAYER_COLORS.length];

const ROLE_GLYPH = { Explorer: 'compass', Engineer: 'wrench', Scholar: 'book', Diver: 'wave', Ranger: 'compass', Firefighter: 'douse', Medic: 'cross', Weatherkeeper: 'wind' };
const ACT_GLYPH = { move: 'compass', dig: 'pick', drain: 'drain', wait: 'anchor', rest: 'gate', water: 'douse', rescue: 'paw', deliver: 'tent', refill: 'bucket', break: 'shield' };
const LEVEL_NOTES = ['More breathing room', 'A balanced expedition', 'Stronger hazards'];
const SIZE = 16; // every co-op board is a 4 × 4 grid

/* ---------- UI memory that survives redraws ---------- */

// Drawers fold away on phones so the board gets the screen; they stay as the player left them.
const wideScreen = typeof matchMedia === 'function' ? matchMedia('(min-width: 901px)').matches : true;
const drawers = { guide: wideScreen, journal: wideScreen };

// Numbers seen at the last render, so a rise or fall flashes once ("relic recovered", "water rose").
let seen = { sig: '', round: 0, nums: new Map() };
function tracker(s) {
  const sig = s.theme + '|' + s.players.map(p => p.id).join(',');
  const fresh = seen.sig !== sig || s.phase === 'briefing' || s.round < seen.round;
  const prev = fresh ? new Map() : seen.nums, next = new Map();
  // look(key, n, dir): ' coop-gain' when n moved the good way (dir 1: up is good, -1: down is good).
  const look = (key, n, dir = 1) => {
    next.set(key, n);
    const was = prev.get(key);
    if (was == null || was === n) return '';
    return (n - was) * dir > 0 ? ' coop-gain' : ' coop-loss';
  };
  look.commit = () => { seen = { sig, round: s.round, nums: next }; };
  return look;
}

const motes = `<div class="coop-motes" aria-hidden="true">${Array.from({ length: 9 }, (_, i) =>
  `<i style="--x:${(i * 37 + 7) % 96}%;--d:${-((i * 1.7) % 9).toFixed(1)}s;--t:${8 + (i % 4) * 1.5}s;--s:${3 + (i % 3)}px"></i>`).join('')}</div>`;
const levelPips = (n) => `<span class="coop-pips" aria-hidden="true">${[0, 1, 2].map(k => `<i class="${k <= n ? 'on' : ''}"></i>`).join('')}</span>`;

/* ---------- styles ---------- */

const stone = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='64'%3E%3Cpath d='M0 32h120M0 64h120M38 0v32M98 0v32M8 32v32M68 32v32' fill='none' stroke='%23d8fff8' stroke-opacity='.045' stroke-width='2'/%3E%3C/svg%3E\")";
const surf = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='8'%3E%3Cpath d='M0 4q15-4 30 0t30 0' fill='none' stroke='%23aafff4' stroke-opacity='.75' stroke-width='1.6'/%3E%3C/svg%3E\")";
const gust = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 14 80' preserveAspectRatio='none'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='0' y2='1'%3E%3Cstop offset='0' stop-color='%23fff6e6' stop-opacity='.95'/%3E%3Cstop offset='1' stop-color='%23fff6e6' stop-opacity='0'/%3E%3C/linearGradient%3E%3C/defs%3E%3Cpath d='M7 78c-5-10 5-18 0-28s5-18 0-28c-3-8 0-14 4-18' fill='none' stroke='url(%23g)' stroke-width='2.6' stroke-linecap='round'/%3E%3C/svg%3E\")";
const pines = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='70'%3E%3Cpath d='M0 70V52l10-18 8 14 9-26 10 22 7-12 10 20 11-30 11 26 8-14 10 18 9-24 10 22 8-12 9 16 12-28 10 24 8-10 10 18 10-20V70z' fill='%23091510' opacity='.55'/%3E%3C/svg%3E\")";

const styles = `
.coop-shell { --accent: #ffd27a; --target: #fff; --target-glow: rgba(255,255,255,.5); --gain-1: rgba(255,226,140,.7); --gain-2: #ffe39a; --cool-1: rgba(160,240,255,.7);
  --loss: rgba(255,107,129,.55); --chip: rgba(8,14,32,.78); --tile-rim: rgba(255,255,255,.16); --meter-bg: rgba(8,14,32,.55); --meter-rim: rgba(255,255,255,.12);
  --hero-bg: linear-gradient(125deg, #121c40, #1d2a5a); color: var(--text); min-width: 0; }
.coop-shell * { box-sizing: border-box; }
.coop-defs { position: absolute; width: 0; height: 0; overflow: hidden; }

/* briefing: the cover, the goal and the difficulty */
.coop-hero { display: grid; grid-template-columns: minmax(0, 300px) minmax(0, 1fr); gap: 22px; align-items: center; padding: 16px; margin-bottom: 16px;
  border-radius: var(--radius); border: 1px solid var(--meter-rim); background: var(--hero-bg); box-shadow: var(--shadow); }
.coop-hero > svg { width: 100%; height: auto; aspect-ratio: 16 / 11; display: block; border-radius: 14px; box-shadow: 0 10px 24px rgba(0,0,0,.45); }
.coop-brief { min-width: 0; }
.coop-eyebrow { font-size: .72rem; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; color: var(--accent); }
.coop-hero h2 { margin: 6px 0; font-size: 1.7rem; }
.coop-hero p { margin: 0; color: #dfe6f7; line-height: 1.55; }
.coop-difficulty { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 16px; }
.coop-difficulty button { min-width: 0; min-height: 78px; padding: 10px 12px; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 3px;
  text-align: left; white-space: normal; overflow-wrap: anywhere; }
.coop-difficulty b { font-family: var(--font-display); font-weight: 600; font-size: 1.05rem; line-height: 1.15; }
.coop-difficulty small { font-size: .8rem; font-weight: 600; line-height: 1.3; opacity: .82; }
.coop-pips { display: flex; gap: 3px; margin-bottom: 2px; }
.coop-pips i { width: 14px; height: 5px; border-radius: 3px; background: currentColor; opacity: .25; }
.coop-pips i.on { opacity: 1; }
.coop-hero .coop-chooser { margin-top: 10px; font-size: .86rem; color: var(--muted); }

/* the end of the expedition */
.coop-result { display: flex; gap: 14px; align-items: center; padding: 16px 18px; margin-bottom: 16px; border-radius: var(--radius);
  border: 1px solid rgba(62,224,161,.45); background: linear-gradient(120deg, rgba(62,224,161,.16), rgba(76,184,255,.1)); box-shadow: var(--shadow); animation: coop-rise-in .5s var(--spring); }
.coop-result.loss { border-color: rgba(255,107,129,.45); background: linear-gradient(120deg, rgba(255,107,129,.16), rgba(124,108,255,.08)); }
.coop-result > .ic { width: 42px; height: 42px; flex: none; color: var(--gold); }
.coop-result.loss > .ic { color: var(--bad); }
.coop-result h2 { margin: 0 0 4px; font-size: 1.3rem; }
.coop-result p { margin: 2px 0 0; color: #dfe6f7; }
@keyframes coop-rise-in { from { opacity: 0; transform: translateY(8px) scale(.98); } }

/* the table */
.coop-felt { container: coopfelt / inline-size; overflow: hidden; }
.coop-table { position: relative; z-index: 1; display: grid; gap: 12px; grid-template-columns: minmax(0, 1fr); grid-template-areas: "hud" "status" "board" "actions" "event"; }
.coop-hud { grid-area: hud; } .coop-status { grid-area: status; } .coop-board { grid-area: board; } .coop-actions { grid-area: actions; } .coop-event { grid-area: event; }
@container coopfelt (min-width: 760px) {
  .coop-table { grid-template-columns: minmax(0, 1fr) 236px; grid-template-areas: "hud hud" "board status" "board actions" "board event"; grid-template-rows: auto auto auto 1fr; align-items: start; }
}
.coop-motes { position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: 0; }
.coop-motes i { position: absolute; left: var(--x); top: 100%; width: 8px; height: 100%; opacity: 0; animation: coop-drift var(--t, 9s) linear var(--d, 0s) infinite; }
.coop-motes i::before { content: ''; position: absolute; left: 0; top: 0; width: var(--s, 4px); height: var(--s, 4px); border-radius: 50%; }
@keyframes coop-drift { 8% { opacity: .9; } 80% { opacity: .55; } 100% { transform: translate(var(--wx, 0px), -100%); opacity: 0; } }

/* counters that belong to the world */
.coop-hud { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
@container coopfelt (min-width: 560px) { .coop-hud { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
.coop-meter { position: relative; display: grid; grid-template-columns: auto minmax(0, 1fr); grid-template-areas: "art label" "art value"; column-gap: 9px; align-items: center;
  min-height: 60px; padding: 7px 10px 7px 8px; border-radius: 14px; background: var(--meter-bg); border: 1px solid var(--meter-rim);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.07), 0 4px 10px rgba(0,0,0,.28); }
.coop-gauge { grid-area: art; display: grid; place-items: center; }
.coop-gauge svg { display: block; height: 44px; width: auto; overflow: visible; }
.coop-meter > span { grid-area: label; align-self: end; font-size: .66rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--meter-label, var(--muted)); line-height: 1.15; }
.coop-meter > b { grid-area: value; align-self: start; justify-self: start; display: inline-block; font: 600 1.15rem/1.2 var(--font-display); color: var(--accent); white-space: nowrap; }
.coop-meter.coop-gain > b { animation: coop-num .7s var(--spring) .1s; }
.coop-meter.coop-gain::after, .coop-meter.coop-loss::after { content: ''; position: absolute; inset: -1px; border-radius: inherit; pointer-events: none; opacity: 0; animation: coop-flash 1.2s ease-out .1s; }
.coop-meter.coop-gain::after { box-shadow: 0 0 0 2px var(--gain-2), 0 0 22px 4px var(--gain-1); }
.coop-meter.coop-loss::after { box-shadow: 0 0 0 2px var(--loss), 0 0 20px 2px var(--loss); }
@keyframes coop-num { 40% { transform: scale(1.35); } }
.coop-vane { transform-box: view-box; transform-origin: 22px 22px; animation: coop-sway 3.4s ease-in-out infinite; }
@keyframes coop-sway { 50% { transform: rotate(7deg); } }

/* whose turn */
.coop-status { display: flex; gap: 10px; align-items: center; padding: 9px 12px; border-radius: 14px; background: var(--meter-bg); border: 1px solid var(--meter-rim); min-width: 0; }
.coop-status > .ic { width: 30px; height: 30px; color: var(--gold); flex: none; }
.coop-face { width: 32px; height: 32px; flex: none; border-radius: 50%; box-shadow: 0 0 0 2px var(--pc, #fff), 0 2px 6px rgba(0,0,0,.45); }
.coop-face .portrait { width: 100%; height: 100%; display: block; border-radius: 50%; }
.coop-turn { min-width: 0; }
.coop-turnline { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; }
.coop-turnline .status { font-size: 1.05rem; }
.coop-roletag { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 999px; font-size: .68rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase;
  color: var(--accent); background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.12); }
.coop-roletag .ic { width: 13px; height: 13px; }
.coop-hint { margin-top: 2px; font-size: .86rem; line-height: 1.35; color: #e1e8f6; }
.coop-ability { display: block; margin-top: 2px; font-size: .78rem; line-height: 1.35; color: var(--muted); }

/* the board */
.coop-board { position: relative; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; padding: 8px; width: 100%; max-width: 640px; justify-self: center; border-radius: 20px; }
.coop-tile { position: relative; aspect-ratio: 1; min-width: 0; display: flex; flex-direction: column; padding: 5px; border-radius: 14px; background: #0b1420;
  box-shadow: 0 0 0 1px var(--tile-rim), 0 4px 10px rgba(0,0,0,.45); -webkit-user-select: none; user-select: none; transition: transform .15s var(--ease); }
@container coopfelt (max-width: 440px) { .coop-tile { aspect-ratio: 4 / 5; padding: 4px; } .coop-board { gap: 6px; padding: 6px; } }
.coop-scene { position: absolute; inset: 0; width: 100%; height: 100%; display: block; border-radius: inherit; }
.coop-tile::after { content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; z-index: 1;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.2), inset 0 0 0 1px rgba(255,255,255,.05), inset 0 -12px 18px rgba(0,0,0,.3); }
.coop-chips, .coop-pawns, .coop-name { position: relative; z-index: 2; }
.coop-chips { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 3px; min-height: 18px; }
.coop-chip { display: inline-flex; align-items: center; gap: 2px; height: 18px; padding: 0 5px 0 3px; border-radius: 999px; font: 600 .68rem/1 var(--font-display); white-space: nowrap;
  color: #fff; background: var(--chip); box-shadow: 0 1px 2px rgba(0,0,0,.5), inset 0 0 0 1px rgba(255,255,255,.14); }
.coop-chip:not(:has(b)) { padding: 0 3px; }
.coop-chip .ic { width: 12px; height: 12px; }
.coop-chip.coop-warn { background: rgba(120,20,30,.85); box-shadow: 0 1px 2px rgba(0,0,0,.5), inset 0 0 0 1px rgba(255,140,150,.6); }
.coop-chip.coop-gold { color: #3a2500; background: linear-gradient(135deg, #ffe7a0, #f4b942); }
.coop-chip.coop-ok .ic { color: var(--good); }
.coop-chip.coop-gain { animation: coop-num .7s var(--spring) .1s; }
.coop-pawns { display: flex; justify-content: center; margin-top: auto; padding-bottom: 3px; }
.coop-pawn { position: relative; width: 28px; height: 28px; flex: none; border-radius: 50%; background: #0b1420; box-shadow: 0 0 0 2px var(--pc), 0 3px 6px rgba(0,0,0,.6);
  transition: translate .25s var(--ease), scale .25s var(--ease); }
.coop-pawn + .coop-pawn { margin-left: -7px; }
.coop-pawn .portrait { width: 100%; height: 100%; display: block; border-radius: 50%; }
/* The adventurer whose turn it is stands lifted off the board. */
.coop-pawn.coop-now { z-index: 3; translate: 0 -5px; scale: 1.14; box-shadow: 0 0 0 2px var(--pc), 0 0 0 4px rgba(255,255,255,.9), 0 10px 14px rgba(0,0,0,.55); }
.coop-carry { position: absolute; right: -7px; top: -7px; display: inline-flex; align-items: center; gap: 1px; height: 16px; padding: 0 4px 0 2px; border-radius: 999px;
  font: 700 .62rem/1 var(--font-display); color: #3a2500; background: linear-gradient(135deg, #ffe7a0, #f4b942); box-shadow: 0 1px 3px rgba(0,0,0,.6); }
.coop-carry .ic { width: 10px; height: 10px; }
.coop-name { margin: 0 -5px -5px; padding: 12px 3px 4px; border-radius: 0 0 14px 14px; text-align: center; overflow-wrap: anywhere;
  font: 600 .76rem/1.1 var(--font-display); color: #fff; text-shadow: 0 1px 2px #000, 0 0 6px rgba(0,0,0,.8); background: linear-gradient(180deg, transparent, rgba(0,0,0,.5)); }
/* Narrow boards: chips keep their icon, the picture carries the detail. */
@container coopfelt (max-width: 440px) { .coop-chip.coop-gold b { display: none; } .coop-chip.coop-gold { padding: 0 3px; } .coop-chip { height: 17px; font-size: .64rem; } .coop-chip .ic { width: 11px; height: 11px; } }
@container coopfelt (max-width: 440px) { .coop-pawn { width: 23px; height: 23px; } .coop-pawn + .coop-pawn { margin-left: -8px; } .coop-name { font-size: .66rem; margin: 0 -4px -4px; padding: 10px 2px 3px; } }
/* Legal destinations: a soft rim and a slow breathing glow (opacity only). */
.coop-can { cursor: pointer; box-shadow: 0 0 0 2px var(--target), 0 4px 10px rgba(0,0,0,.45); }
.coop-can::before { content: ''; position: absolute; inset: -3px; border-radius: 17px; pointer-events: none; z-index: 3;
  box-shadow: 0 0 14px 4px var(--target-glow), inset 0 0 14px var(--target-glow); animation: coop-breathe 2.6s ease-in-out infinite; }
@keyframes coop-breathe { 50% { opacity: .25; } }
.coop-can:active { transform: scale(.97); }
@media (hover: hover) { .coop-can:hover { transform: translateY(-2px); } .coop-can:active { transform: scale(.97); } }
.coop-can:focus-visible { outline: 3px solid #fff; outline-offset: 3px; }
/* One-off responses: a flash when water drains or fire dies down (cool), a pop when a relic or animal is saved. */
.coop-flash { position: absolute; inset: 0; border-radius: inherit; pointer-events: none; z-index: 4; opacity: 0; animation: coop-flash 1.2s ease-out .15s; }
.coop-loss > .coop-flash { background: radial-gradient(circle at 50% 75%, var(--loss), transparent 75%); animation-duration: 1s; }
.coop-cool > .coop-flash { background: radial-gradient(circle at 50% 70%, var(--cool-1), transparent 72%); box-shadow: inset 0 0 0 2px var(--cool-1); }
.coop-save > .coop-flash { background: radial-gradient(circle at 50% 45%, var(--gain-1), transparent 70%); box-shadow: inset 0 0 0 2px var(--gain-2); }
.coop-save, .coop-cool { animation: coop-pop .6s var(--spring) .15s; }
.coop-burst { position: absolute; left: 50%; top: 45%; width: 70%; aspect-ratio: 1; border-radius: 50%; pointer-events: none; z-index: 4; opacity: 0;
  border: 3px solid var(--gain-2); transform: translate(-50%, -50%) scale(.2); animation: coop-burst .9s ease-out .2s; }
@keyframes coop-flash { 15% { opacity: 1; } 100% { opacity: 0; } }
@keyframes coop-pop { 40% { transform: scale(1.07); } }
@keyframes coop-burst { 10% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -50%) scale(1.5); } }
.coop-wave { animation: coop-wave 3.2s linear infinite; }
@keyframes coop-wave { to { transform: translateX(50px); } }
.coop-flick { transform-box: fill-box; transform-origin: 50% 100%; animation: coop-flick 1.3s ease-in-out infinite; }
@keyframes coop-flick { 50% { transform: scale(.92, 1.12); } }

/* what you can do */
.coop-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.coop-actions button { min-width: 0; min-height: 50px; padding: 8px 12px; display: flex; align-items: center; justify-content: flex-start; gap: 9px; text-align: left; white-space: normal;
  font-size: .86rem; line-height: 1.25; color: #fff; background: var(--act-bg); border-color: var(--act-rim); }
.coop-actions button .ic { width: 22px; height: 22px; flex: none; color: var(--accent); }
.coop-actions button:hover:not(:disabled) { background: var(--act-bg); border-color: var(--accent); filter: brightness(1.1); }
.coop-actions button:active:not(:disabled) { transform: scale(.97); }
@container coopfelt (min-width: 760px) { .coop-actions { grid-template-columns: minmax(0, 1fr); } }
.coop-event { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border-radius: 14px; font-size: .86rem; line-height: 1.45; color: #e1e8f6;
  background: var(--meter-bg); border: 1px solid var(--meter-rim); }
.coop-event > .ic { width: 22px; height: 22px; flex: none; margin-top: 1px; color: var(--accent); }
.coop-event b { display: block; font-size: .66rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: var(--accent); }

/* side: the team and the drawers */
.coop-panel h3 { display: flex; align-items: center; gap: 8px; margin: 0 0 12px; font-size: 1.05rem; }
.coop-panel h3 .ic { width: 20px; height: 20px; color: var(--brand-2); }
.coop-team { display: grid; gap: 8px; }
.coop-person { position: relative; display: flex; gap: 10px; align-items: flex-start; padding: 9px 10px 9px 12px; border-radius: 14px; overflow: hidden;
  background: rgba(255,255,255,.04); border: 1px solid var(--line); transition: transform .25s var(--ease), box-shadow .3s; }
.coop-person::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--pc); }
.coop-person.active { transform: translateY(-2px); background: rgba(255,207,92,.07); box-shadow: 0 0 0 2px var(--gold), 0 0 18px rgba(255,207,92,.3); }
.coop-person .coop-face { margin-top: 2px; }
.coop-who { flex: 1; min-width: 0; }
.coop-nameline { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; }
.coop-nameline strong { font-weight: 800; overflow-wrap: anywhere; }
.coop-role { display: flex; align-items: center; gap: 5px; margin-top: 2px; font: 600 .82rem/1.2 var(--font-display); color: var(--accent); }
.coop-role .ic { width: 15px; height: 15px; }
.coop-person small { display: flex; flex-wrap: wrap; gap: 3px 10px; margin-top: 4px; font-size: .78rem; line-height: 1.3; color: var(--muted); }
.coop-stat { display: inline-flex; align-items: center; gap: 4px; }
.coop-stat .ic { width: 13px; height: 13px; }
.coop-stat.coop-gain { animation: coop-num .7s var(--spring) .1s; }
.coop-goal { font-weight: 700; line-height: 1.5; }
.coop-roles, .coop-tips { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.coop-roles li { display: flex; gap: 10px; align-items: flex-start; padding: 8px 10px; border-radius: 12px; background: rgba(255,255,255,.04); border-left: 3px solid var(--pc); }
.coop-roles li > .ic { width: 20px; height: 20px; flex: none; margin-top: 1px; color: var(--accent); }
.coop-roles small { display: block; font-size: .82rem; line-height: 1.4; color: var(--muted); }
.coop-tips li { position: relative; padding-left: 18px; font-size: .86rem; line-height: 1.45; color: #d6def5; }
.coop-tips li::before { content: ''; position: absolute; left: 3px; top: .5em; width: 7px; height: 7px; border-radius: 2px; transform: rotate(45deg); background: var(--accent); }
.coop-side > .drawer { padding: 0; }
.coop-journal > summary .note { min-width: 0; flex: 0 1 auto; max-width: 55%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.coop-log { margin: 0; padding-left: 18px; max-height: 260px; overflow-y: auto; font-size: .84rem; line-height: 1.5; color: #d6def5; }
.coop-log li { margin-bottom: 6px; }
.coop-log li:first-child { font-weight: 800; color: #fff; }
.coop-shell button:focus-visible { outline: 3px solid #fff; outline-offset: 3px; }

/* ---- Sunken Temple: ancient stone, rising teal water, glints of gold ---- */
.coop-temple { --accent: #ffd27a; --target: #9ff8ea; --target-glow: rgba(120,255,235,.55); --gain-1: rgba(255,226,140,.75); --gain-2: #ffe39a; --cool-1: rgba(150,255,240,.7);
  --loss: rgba(40,190,230,.6); --chip: rgba(3,26,32,.8); --tile-rim: rgba(160,230,220,.22); --meter-bg: rgba(4,28,34,.62); --meter-rim: rgba(150,235,222,.18);
  --meter-label: #a6cfca; --act-bg: linear-gradient(180deg, #355257, #203a40); --act-rim: rgba(255,210,122,.32);
  --hero-bg: radial-gradient(90% 120% at 0% 0%, rgba(120,255,235,.14), transparent 60%), linear-gradient(125deg, #0b2a35, #10465a 60%, #0b2a38); }
.coop-temple .coop-felt { border-color: rgba(120,230,215,.24);
  background:
    radial-gradient(2px 2px at 13% 21%, rgba(255,220,130,.85), transparent 60%),
    radial-gradient(1.6px 1.6px at 87% 13%, rgba(255,230,160,.75), transparent 60%),
    radial-gradient(2px 2px at 71% 56%, rgba(255,220,130,.5), transparent 60%),
    radial-gradient(1.6px 1.6px at 6% 64%, rgba(255,230,160,.55), transparent 60%),
    radial-gradient(55% 35% at 24% -6%, rgba(150,255,238,.2), transparent 70%),
    radial-gradient(45% 30% at 82% -4%, rgba(150,255,238,.13), transparent 70%),
    ${stone},
    radial-gradient(120% 100% at 50% 0%, #17525c 0%, #0d3743 42%, #082430 72%, #04151b 100%); }
/* The flood in the room rises with the flood pressure. */
.coop-temple .coop-felt::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: calc(7% + var(--flood, 0) * 38%); pointer-events: none; z-index: 0;
  background: ${surf} 0 0 / 60px 8px repeat-x, linear-gradient(180deg, rgba(43,212,200,0) 2px, rgba(43,212,200,.2) 6px, rgba(16,140,150,.36) 60%, rgba(6,80,96,.55));
  transition: height .8s var(--ease); }
.coop-temple .coop-motes i::before { border: 1.5px solid rgba(190,255,245,.6); background: rgba(190,255,245,.1); }
.coop-temple .coop-board { background: linear-gradient(180deg, #2b4145, #16262a);
  box-shadow: 0 0 0 1px rgba(255,214,130,.38), 0 0 0 5px #172629, 0 0 0 6px rgba(255,214,130,.22), 0 16px 30px rgba(0,0,0,.5), inset 0 2px 0 rgba(255,255,255,.06); }

/* ---- Emberwatch: a dusk forest with ember glow, smoke and a vivid wind ---- */
.coop-ember { --accent: #ffb45e; --target: #ffe7a3; --target-glow: rgba(255,214,120,.6); --gain-1: rgba(255,230,140,.75); --gain-2: #ffe7a3; --cool-1: rgba(150,220,255,.75);
  --loss: rgba(255,100,40,.65); --chip: rgba(30,14,10,.8); --tile-rim: rgba(255,190,120,.2); --meter-bg: rgba(26,16,26,.62); --meter-rim: rgba(255,180,110,.2);
  --meter-label: #e4b9a0; --act-bg: linear-gradient(180deg, #4a3029, #2d1c1b); --act-rim: rgba(255,180,94,.34);
  --hero-bg: radial-gradient(80% 120% at 100% 100%, rgba(255,120,50,.22), transparent 60%), linear-gradient(125deg, #231a3d, #3d2445 55%, #1a2a22); }
.coop-ember .coop-felt { border-color: rgba(255,170,100,.22);
  background:
    radial-gradient(70% 40% at 88% 104%, rgba(255,120,40,.38), transparent 70%),
    radial-gradient(45% 30% at 8% 102%, rgba(255,150,60,.2), transparent 70%),
    radial-gradient(40% 18% at 70% 14%, rgba(190,170,210,.12), transparent 70%),
    radial-gradient(35% 14% at 25% 22%, rgba(190,170,210,.09), transparent 70%),
    ${pines} 0 60px / 180px 70px repeat-x,
    linear-gradient(180deg, #2a1f4e 0, #4b2a55 60px, #3a2836 130px, #18261f 260px, #0e1a15 100%); }
.coop-ember .coop-motes i::before { background: #ffc06b; box-shadow: 0 0 6px 1px rgba(255,140,60,.85); }
.coop-ember .coop-board { background: linear-gradient(180deg, #24382a, #132018);
  box-shadow: 0 0 0 1px rgba(255,180,110,.32), 0 0 0 5px #1a1612, 0 0 0 6px rgba(255,180,110,.2), 0 16px 30px rgba(0,0,0,.5), inset 0 2px 0 rgba(255,255,255,.05); }
.coop-windwrap { position: absolute; inset: 0; overflow: hidden; border-radius: inherit; pointer-events: none; z-index: 5; }
.coop-windfield { position: absolute; left: 50%; top: 50%; width: 150%; aspect-ratio: 1; transform: translate(-50%, -50%) rotate(var(--rot, 0deg)); }
.coop-windfield i { position: absolute; left: var(--x); top: 100%; width: 14px; height: 16%; opacity: 0; background: ${gust} center / 100% 100% no-repeat;
  animation: coop-gust 3.6s linear var(--d, 0s) infinite; }
@keyframes coop-gust { 12% { opacity: .85; } 70% { opacity: .5; } 100% { transform: translateY(-820%); opacity: 0; } }

@media (max-width: 640px) {
  .coop-hero { grid-template-columns: minmax(0, 1fr); padding: 12px; gap: 12px; }
  .coop-hero > svg { aspect-ratio: 16 / 9; }
  .coop-hero h2 { font-size: 1.35rem; }
  .coop-difficulty { grid-template-columns: minmax(0, 1fr); gap: 8px; }
  .coop-difficulty button { min-height: 54px; display: grid; grid-template-columns: auto minmax(0, 1fr); grid-template-areas: "pips name" "pips note"; column-gap: 12px; align-items: center; }
  .coop-difficulty .coop-pips { grid-area: pips; } .coop-difficulty b { grid-area: name; } .coop-difficulty small { grid-area: note; }
}
@media (max-width: 420px) {
  .coop-hint { font-size: .82rem; }
  .coop-actions button { padding: 8px 9px; gap: 7px; font-size: .8rem; }
  .coop-actions button .ic { width: 19px; height: 19px; }
  .coop-meter { padding: 6px 8px 6px 6px; column-gap: 7px; }
  .coop-gauge svg { height: 40px; }
}
`;

/* ---------- rendering ---------- */

// spec.place(s, i, ui) describes board space i:
//   { name, art (SVG for a 100 × 100 scene), level (water / fire), marker (relic or animal still here), chips: [chip()…], label }
// spec.gauges(s, ui) -> [{ key, label, value, n, dir, art }]: counters drawn as part of the world.
// ui.look(key, n, dir) returns ' coop-gain' / ' coop-loss' when a number moved since the last render.
function tileHTML(s, i, d, ui, spec) {
  const move = ui.targets.get(i);
  const cool = ui.look('level-' + i, d.level || 0, -1), save = ui.look('marker-' + i, d.marker ? 1 : 0, -1);
  const fx = save === ' coop-gain' ? ' coop-gain coop-save' : cool === ' coop-gain' ? ' coop-gain coop-cool' : cool || save;
  const pawns = s.players.map((q, k) => q.pos !== i ? '' :
    `<span class="coop-pawn${k === s.cur && !s.over ? ' coop-now' : ''}" data-k="pawn-${esc(q.id)}" title="${esc(q.name)} · ${esc(q.role)}" style="--pc:${colour(k)}">${portrait({ id: q.id, bot: ui.isBot(q.id) })}${spec.pawnMark?.(s, q) || ''}</span>`).join('');
  const attrs = move != null ? ` data-move="${move}" role="button" tabindex="0" aria-label="${esc(ui.choices[move].label)}"` : ` role="group" aria-label="${esc(d.label || d.name)}"`;
  return `<div class="coop-tile${move != null ? ' coop-can' : ''}${fx}" data-hazard="${d.level || 0}" data-a="room-${i}"${attrs}>` +
    `<svg class="coop-scene" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${d.art || ''}</svg>` +
    `<div class="coop-chips">${(d.chips || []).join('')}</div><div class="coop-pawns">${pawns}</div><strong class="coop-name">${esc(d.name)}</strong>` +
    `${fx ? '<i class="coop-flash"></i>' : ''}${save === ' coop-gain' ? '<i class="coop-burst"></i>' : ''}</div>`;
}

function renderGame(game, spec, el, s, ctx) {
  injectCSS('cooperative-collection', styles);
  const p = s.players[s.cur], mine = p.id === ctx.me, live = !s.over && s.phase === 'play';
  const choices = game.moves(s);
  const targets = new Map();
  if (mine && live) choices.forEach((m, i) => { if (m.type === 'move') targets.set(m.to, i); });
  const ui = { look: tracker(s), targets, choices, isBot: (id) => !!ctx.isBot?.(id) };
  const face = (q, i) => `<span class="coop-face" style="--pc:${colour(i)}">${portrait({ id: q.id, bot: ui.isBot(q.id) })}</span>`;
  const roleGlyph = (role) => glyph(ROLE_GLYPH[role] || 'star');

  const result = s.over ? `<div class="coop-result ${s.won ? '' : 'loss'}" role="status">${icon(s.won ? 'trophy' : 'rematch')}<div><h2>${s.won ? 'Together, you prevailed' : 'The expedition is over'}</h2><p>${esc(s.reason)}</p><p>${s.won ? 'Every player shares the victory.' : 'Regroup, try a different plan, and start a new game.'}</p></div></div>` : '';
  const brief = s.phase === 'briefing' ? `<div class="coop-hero">${game.cover}<div class="coop-brief"><div class="coop-eyebrow">Cooperative · ${s.players.length} adventurers</div><h2>${esc(spec.name)}</h2><p>${esc(spec.goal)}</p>` +
    `<div class="coop-difficulty">${choices.map((m, i) => `<button data-move="${i}" class="${i === 1 ? 'primary' : ''}" ${mine ? '' : 'disabled'}>${levelPips(i)}<b>${esc(m.label)}</b><small>${LEVEL_NOTES[i]}</small></button>`).join('')}</div>` +
    `<p class="coop-chooser">${mine ? 'Talk through your roles, then choose the difficulty for the team.' : `Talk through your roles. ${esc(p.name)} chooses the difficulty for the team.`}</p></div></div>` : '';

  const hud = `<div class="coop-hud">${spec.gauges(s, ui).map((g) => `<div class="coop-meter${g.n == null ? '' : ui.look('gauge-' + g.key, g.n, g.dir || 1)}" data-a="coop-${g.key}"><i class="coop-gauge" aria-hidden="true">${g.art || ''}</i><span>${esc(g.label)}</span><b>${esc(g.value)}</b></div>`).join('')}</div>`;

  let status;
  if (s.over) status = `<div class="coop-status">${s.won ? icon('trophy') : glyph(spec.eventGlyph || 'sparkle')}<div class="coop-turn"><div class="coop-turnline"><span class="status">Expedition complete</span></div><div class="coop-hint">${s.won ? 'Finished' : 'Ended'} in round ${Math.min(s.round, spec.limit)} of ${spec.limit}.</div></div></div>`;
  else {
    const hint = s.phase === 'briefing' ? (mine ? 'Choose a difficulty to begin.' : `${esc(p.name)} is choosing a difficulty.`)
      : esc(spec.hint(s, p)) + (targets.size ? ` Tap a glowing ${spec.placeWord || 'space'} to move there.` : '');
    status = `<div class="coop-status">${face(p, s.cur)}<div class="coop-turn"><div class="coop-turnline"><span class="status ${mine ? 'myturn' : ''}">${mine ? 'Your turn' : esc(p.name) + '’s turn'}</span><span class="coop-roletag">${roleGlyph(p.role)}${esc(p.role)}</span></div>` +
      `<div class="coop-hint">${hint}</div>${live ? `<small class="coop-ability">${esc(p.ability)}</small>` : ''}</div></div>`;
  }

  const board = `<div class="coop-board">${Array.from({ length: SIZE }, (_, i) => tileHTML(s, i, spec.place(s, i, ui), ui, spec)).join('')}${spec.overlay?.(s) || ''}</div>`;
  const actions = live ? `<div class="coop-actions">${choices.map((m, i) => m.type === 'move' ? '' : `<button data-move="${i}" ${mine ? '' : 'disabled'}>${glyph(ACT_GLYPH[m.type] || 'star')}<span>${esc(m.label)}</span></button>`).join('')}</div>` : '';
  const event = `<div class="coop-event">${glyph(spec.eventGlyph || 'sparkle')}<div><b>Latest event</b>${esc(s.event)}</div></div>`;

  const team = `<div class="panel coop-panel"><h3>${icon('users')}<span>Expedition team</span></h3><div class="coop-team">${s.players.map((q, i) =>
    `<div class="coop-person ${i === s.cur && !s.over ? 'active' : ''}" style="--pc:${colour(i)}" data-a="coop-p-${esc(q.id)}">${face(q, i)}<div class="coop-who">` +
    `<div class="coop-nameline"><strong>${esc(q.name)}</strong>${q.id === ctx.me ? '<span class="tag t-you">You</span>' : ''}${ui.isBot(q.id) ? '<span class="tag t-bot">Bot</span>' : ''}</div>` +
    `<div class="coop-role">${roleGlyph(q.role)}${esc(q.role)}</div>${spec.personal ? `<small>${spec.personal(s, q, ui)}</small>` : ''}</div></div>`).join('')}</div></div>`;
  const guide = `<details class="panel drawer coop-guide"${drawers.guide ? ' open' : ''}><summary>${icon('book')}<span>Field guide</span>${icon('chevron', 'chev')}</summary><div class="drawer-body">` +
    `<p class="coop-goal">${esc(spec.goal)}</p><ul class="coop-roles">${s.players.map((q, i) => `<li style="--pc:${colour(i)}">${roleGlyph(q.role)}<div><b>${esc(q.role)}</b> · ${esc(q.name)}<small>${esc(q.ability)}</small></div></li>`).join('')}</ul>` +
    `<ul class="coop-tips">${spec.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div></details>`;
  const journal = `<details class="panel drawer coop-journal"${drawers.journal ? ' open' : ''}><summary>${glyph('journal')}<span>Journal</span><span class="note">${esc(s.log[0] || '')}</span>${icon('chevron', 'chev')}</summary>` +
    `<div class="drawer-body"><ol class="coop-log">${s.log.slice(0, 14).map((line) => `<li>${esc(line)}</li>`).join('') || '<li>Your story starts here.</li>'}</ol></div></details>`;

  el.innerHTML = `<section class="coop-shell coop-${spec.theme}" style="${spec.mood?.(s) || ''}"><svg class="coop-defs" width="0" height="0" aria-hidden="true" focusable="false"><defs>${spec.defs || ''}</defs></svg>${result}${brief}` +
    `<div class="game-layout coop-layout"><div class="felt coop-felt">${motes}<div class="coop-table">${hud}${status}${board}${actions}${event}</div></div>` +
    `<aside class="side coop-side">${team}${guide}${journal}</aside></div></section>`;

  el.querySelectorAll('[data-move]').forEach((b) => {
    b.onclick = () => ctx.send(choices[Number(b.dataset.move)]);
    if (b.tagName !== 'BUTTON') b.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); b.click(); } };
  });
  // <details> toggle events do not bubble, so listen on each drawer after drawing it.
  el.querySelector('.coop-guide')?.addEventListener('toggle', (e) => { drawers.guide = e.currentTarget.open; });
  el.querySelector('.coop-journal')?.addEventListener('toggle', (e) => { drawers.journal = e.currentTarget.open; });
  ui.look.commit();
}

export function cooperative(spec) {
  const game = {
    id: spec.id, name: spec.name, description: spec.description, minPlayers: 2, maxPlayers: spec.roles.length,
    cover: spec.cover || art(spec.theme), howTo: { goal: spec.goal, turn: spec.steps.map((text,i)=>[String(i+1),['Plan together','Take one action','Face the world'][i] || 'Teamwork',text]), tips: spec.tips },
    setup(players) {
      if(players.length<2 || players.length>spec.roles.length || new Set(players.map(p=>p.id)).size!==players.length) throw Error('Invalid team.');
      const s={players:players.map((p,i)=>({...p,role:spec.roles[i][0],ability:spec.roles[i][1],pos:0})),cur:0,round:1,phase:'briefing',difficulty:1,over:false,won:false,winners:[],log:[],event:'Choose the expedition difficulty together.'};
      s.theme=spec.theme;spec.setup(s); return s;
    },
    turnOf(s) {return s.over?[]:[s.players[s.cur].id];},
    moves(s) {return s.phase==='briefing'?[0,1,2].map(level=>action('begin',['Relaxed','Standard','Daring'][level],level===1?100:0,{level})):spec.moves(s,s.players[s.cur]);},
    act(s,pid,a) {
      if(s.over || s.players[s.cur]?.id!==pid) throw Error('It is not your turn.');
      if(!a || typeof a!=='object') throw Error('Choose an action.');
      const chosen=game.moves(s).find(m=>m.type===a.type && ['to','card','level'].every(k=>m[k]===a[k]));
      if(!chosen) throw Error('That action is not available.');
      if(s.phase==='briefing') {s.difficulty=chosen.level;spec.begin?.(s);s.phase='play';s.event='The expedition begins.';log(s,`${s.players[0].name} chose ${chosen.label}.`);return;}
      const p=s.players[s.cur];spec.perform(s,p,chosen);log(s,`${p.name}: ${chosen.label}.`);
      addFx(s,{kind:'sound',sound:'place'});
      spec.check(s);if(s.over)return;
      s.cur=(s.cur+1)%s.players.length;
      if(s.cur===0){s.round++;spec.event(s);log(s,s.event);spec.check(s);}
      if(!s.over && s.round>spec.limit) finish(s,false,spec.timeout);
    },
    view(s) {return JSON.parse(JSON.stringify(s));},
    bot(s) {return game.moves(s).reduce((best,m)=>m.score>best.score?m:best);},
    render(el,s,ctx) { renderGame(game, spec, el, s, ctx); },
  };
  return game;
}
