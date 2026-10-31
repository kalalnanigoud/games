import { cooperative, action, distance, finish, glyph, chip, colour, layer } from './coop-kit.js';
import { rand, esc } from '../js/util.js';
const names=['Landing','Mosaic Hall','West Steps','Moon Well','Courtyard','Echo Vault','Sun Shrine','Aqueduct','Old Library','Stone Gate','Jade Chamber','Deep Stairs','Observatory','Root Garden','Royal Crypt','Star Altar'];
const relics=[5,10,15];
const goalFor=(s,p)=>{const unclaimed=relics.filter(i=>s.rooms[i].relic);if(!unclaimed.length)return 0;return unclaimed.sort((a,b)=>distance(p.pos,a)-distance(p.pos,b))[0];};

/* ===================== art (presentation only) ===================== */

// Shared gradients for the room scenes (drawn once per render by coop-kit).
const defs = '<linearGradient id="ctm-wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#617c7c"/><stop offset="1" stop-color="#2a3d42"/></linearGradient>' +
  '<linearGradient id="ctm-jade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3f9a80"/><stop offset="1" stop-color="#163d35"/></linearGradient>' +
  '<linearGradient id="ctm-floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3d5357"/><stop offset="1" stop-color="#16242a"/></linearGradient>' +
  '<linearGradient id="ctm-water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4fe6d6" stop-opacity=".8"/><stop offset=".35" stop-color="#139aa3" stop-opacity=".88"/><stop offset="1" stop-color="#05424d" stop-opacity=".96"/></linearGradient>' +
  '<linearGradient id="ctm-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff4c2"/><stop offset=".45" stop-color="#ffcf5c"/><stop offset="1" stop-color="#a86f12"/></linearGradient>' +
  '<radialGradient id="ctm-glow"><stop offset="0" stop-color="#ffe9a0" stop-opacity=".9"/><stop offset="1" stop-color="#ffe9a0" stop-opacity="0"/></radialGradient>' +
  '<linearGradient id="ctm-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a2034"/><stop offset="1" stop-color="#1b5a6a"/></linearGradient>' +
  '<linearGradient id="ctm-shaft" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c8fff6" stop-opacity=".34"/><stop offset="1" stop-color="#c8fff6" stop-opacity="0"/></linearGradient>' +
  '<radialGradient id="ctm-vig" cx=".5" cy=".45" r=".75"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".45"/></radialGradient>';

const BLOCKS = '<path d="M0 25h100M0 50h100M28 0v25M74 0v25M10 25v25M52 25v25M90 25v25M36 50v24M80 50v24" stroke="#0c1a1e" stroke-opacity=".4" stroke-width="1.2" fill="none"/>';
const base = (wall = 'url(#ctm-wall)') => `<rect width="100" height="100" fill="${wall}"/>${BLOCKS}<path d="M0 74h100v26H0z" fill="url(#ctm-floor)"/><path d="M0 74.5h100" stroke="#bfe0d8" stroke-opacity=".22"/>`;
const column = (x, y1 = 16, y2 = 74, w = 9) => `<rect x="${x}" y="${y1}" width="${w}" height="${y2 - y1}" fill="#7f9796"/><rect x="${x + w * .62}" y="${y1}" width="${w * .38}" height="${y2 - y1}" fill="#5a7071"/>` +
  `<rect x="${x - 2}" y="${y1 - 4}" width="${w + 4}" height="4.5" rx="1" fill="#a9c0ba"/><rect x="${x - 2}" y="${y2 - 3}" width="${w + 4}" height="3" fill="#90a8a2"/>`;
const torch = (x, y) => `<circle cx="${x}" cy="${y - 4}" r="10" fill="url(#ctm-glow)" opacity=".6"/><path d="M${x - 2.5} ${y}h5l-1 6h-3z" fill="#6b4a2e"/>` +
  `<path d="M${x} ${y - 7}q3.5 3.5 0 7q-3.5-3.5 0-7z" fill="#ffb84d"/><path d="M${x} ${y - 4.5}q1.6 1.8 0 4q-1.6-2.2 0-4z" fill="#fff0b8"/>`;
const stars = (list) => `<g fill="#e9fff9">${list.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('')}</g>`;
const spark = (x, y, r) => `<path d="M${x} ${y - r}L${x + r * .28} ${y - r * .28} ${x + r} ${y} ${x + r * .28} ${y + r * .28} ${x} ${y + r} ${x - r * .28} ${y + r * .28} ${x - r} ${y} ${x - r * .28} ${y - r * .28}z" fill="#fffbe6"/>`;
const books = (y, seed) => { let out = '', x = 15, k = seed; while (x < 84) { const w = 3 + (k % 3), h = 9 + (k * 7) % 5; out += `<rect x="${x}" y="${y - h}" width="${w}" height="${h}" fill="${['#8a3b2e', '#2e6a6a', '#c09040', '#5a4a8a', '#7a5a3a', '#3f7a4a'][k % 6]}"/>`; x += w + .8; k++; } return out; };

// One scene per room, so every space on the board reads as a place.
const ROOM = {
  hall: base() + column(13) + column(78) + '<path d="M22 22q28-14 56 0" stroke="#a9c0ba" stroke-width="3" fill="none"/><g fill="none" stroke-width="1.6"><circle cx="50" cy="42" r="12" stroke="url(#ctm-gold)"/><path d="M50 30v24M38 42h24M41.5 33.5l17 17M58.5 33.5l-17 17" stroke="#3fc9bd" stroke-opacity=".8"/></g>' +
    '<path d="M8 86l7-5 7 5-7 5zM30 86l7-5 7 5-7 5zM52 86l7-5 7 5-7 5zM74 86l7-5 7 5-7 5z" fill="#2bbab2" opacity=".55"/><path d="M19 93l7-5 7 5M41 93l7-5 7 5M63 93l7-5 7 5" fill="none" stroke="#e9c787" stroke-opacity=".55"/>',
  steps: base() + '<path d="M58 74V36q15-13 30 0v38z" fill="#0b1b20"/>' + torch(92, 46) + '<path d="M6 74V66h12v-8h12v-8h12v-8h10v32z" fill="#7f9796"/><path d="M6 66h12M18 58h12M30 50h12M42 42h10" stroke="#b4cbc4" stroke-width="1.5"/><path d="M52 42v32" stroke="#4a6061"/>',
  well: base() + '<path d="M28 0h44l14 74H14z" fill="url(#ctm-shaft)"/><ellipse cx="50" cy="3" rx="22" ry="7" fill="#091f2e"/><circle cx="57" cy="2.5" r="3.5" fill="#f4f0d2"/>' +
    '<path d="M24 62v10q26 8 52 0V62" fill="#4d6466"/><ellipse cx="50" cy="62" rx="26" ry="8" fill="#89a19c"/><ellipse cx="50" cy="61.5" rx="21" ry="5.5" fill="#0d4f5b"/><ellipse cx="56" cy="61.5" rx="4.5" ry="1.4" fill="#f4f0d2" opacity=".85"/>',
  court: base() + '<rect width="100" height="40" fill="url(#ctm-sky)"/>' + stars([[12, 9, 1], [34, 22, .8], [55, 7, 1.1], [92, 26, .9], [24, 32, .7]]) + '<circle cx="76" cy="14" r="5" fill="#f4f0d2"/><path d="M0 40h100" stroke="#a9c0ba" stroke-width="3"/>' +
    '<path d="M11 74V38l4-3 2 3 3-4 1 40z" fill="#7f9796"/>' + column(76, 38) + '<g stroke="#4fae7c" stroke-width="3" fill="none" stroke-linecap="round"><path d="M46 74q-2-18 12-28"/><path d="M46 74q-6-14-18-18"/><path d="M46 74q5-12 18-12"/></g>',
  vault: base() + '<path d="M12 74V40q38-36 76 0v34z" fill="#17292e"/><path d="M12 40q38-36 76 0" stroke="#a9c0ba" stroke-width="3.5" fill="none"/><g fill="none" stroke="#7fe3d8" stroke-opacity=".35"><path d="M30 33q20-14 40 0"/><path d="M23 39q27-21 54 0"/></g>',
  shrine: base() + '<circle cx="50" cy="34" r="22" fill="url(#ctm-glow)" opacity=".5"/><g stroke="#ffd27a" stroke-width="2.2" stroke-linecap="round" opacity=".85"><path d="M50 14V8M50 60v-6M28 34h-6M78 34h-6M34.5 18.5l-4-4M65.5 18.5l4-4M34.5 49.5l-4 4M65.5 49.5l4 4"/></g>' +
    '<circle cx="50" cy="34" r="12" fill="url(#ctm-gold)" stroke="#a86f12"/><circle cx="50" cy="34" r="6" fill="none" stroke="#a86f12" stroke-opacity=".6"/><path d="M30 74V62h40v12z" fill="#7f9796"/><path d="M27 62h46l-3-4H30z" fill="#b2c8c1"/><path d="M30 67h40" stroke="#5a7071"/>',
  aqueduct: base() + '<path d="M0 24h100v10H0z" fill="#8aa29c"/><path d="M0 19h100v5H0z" fill="#3fd0c4" opacity=".85"/>' +
    '<path d="M0 34h100v40H0z" fill="#61797a"/><path d="M5 74V54q11-14 22 0v20zM39 74V54q11-14 22 0v20zM73 74V54q11-14 22 0v20z" fill="#0e2025"/><path d="M47 25q4 12 2 49" stroke="#8ff5e6" stroke-width="3" fill="none" opacity=".6"/>',
  library: base() + '<rect x="10" y="16" width="80" height="58" rx="2" fill="#3b2c22"/><rect x="13" y="19" width="74" height="52" fill="#231912"/>' + books(35, 0) + books(53, 2) + books(71, 4) +
    '<path d="M13 36h74M13 54h74" stroke="#5c4330" stroke-width="3"/><circle cx="72" cy="49" r="3.4" fill="#e9dcc0"/><circle cx="78" cy="50" r="3" fill="#d8c8a6"/>',
  gate: base() + torch(10, 46) + torch(90, 46) + '<path d="M20 74V36q30-26 60 0v38z" fill="#4c463d"/><path d="M24 74V38q26-21 52 0v36z" fill="#6d665a"/><path d="M50 19v55" stroke="#2a2620" stroke-width="2"/>' +
    '<path d="M30 44h14M56 44h14M30 50h10M60 50h10M30 64h14M56 64h14" stroke="#3b362e" stroke-width="1.6"/><circle cx="45" cy="57" r="3.6" fill="none" stroke="url(#ctm-gold)" stroke-width="2"/><circle cx="55" cy="57" r="3.6" fill="none" stroke="url(#ctm-gold)" stroke-width="2"/><path d="M20 36q30-26 60 0" stroke="#a9c0ba" stroke-width="3" fill="none"/>',
  jade: base('url(#ctm-jade)') + '<path d="M14 74V40q36-34 72 0v34z" fill="#123a31"/><path d="M8 74l5-20 5 20zM15 74l3-10 3 10zM82 74l5-26 6 26zM76 74l3-12 3 12z" fill="#7cf0c0" opacity=".75"/><path d="M13 55l2 19M87 49l1 25" stroke="#d4fff0" stroke-opacity=".6"/>',
  deep: base() + '<path d="M24 74V22q26-16 52 0v52z" fill="#13252a"/>' + torch(13, 42) + torch(87, 42) + '<path d="M18 74h64l-6 6H24z" fill="#61797a"/><path d="M24 80h52l-5 6H29z" fill="#465d60"/><path d="M29 86h42l-4 6H33z" fill="#2c4044"/><path d="M33 92h34l-3 8H36z" fill="#0b181c"/>',
  observatory: base() + '<path d="M6 62Q8 12 50 10q42 2 44 52z" fill="#0b2236"/>' + stars([[22, 30, 1], [36, 20, .8], [64, 18, 1.1], [78, 34, .9], [30, 46, .7], [72, 50, .8]]) + '<path d="M22 30l14-10 28-2 14 16" stroke="#7fe3d8" stroke-opacity=".4" fill="none"/>' +
    '<path d="M6 62Q8 12 50 10q42 2 44 52" stroke="#a9c0ba" stroke-width="3" fill="none"/><path d="M50 58v16M42 74h16" stroke="#9fb7b1" stroke-width="3"/><circle cx="50" cy="46" r="12" fill="none" stroke="url(#ctm-gold)" stroke-width="2"/>' +
    '<ellipse cx="50" cy="46" rx="12" ry="4.5" fill="none" stroke="#ffd27a" stroke-width="1.4" transform="rotate(-25 50 46)"/><circle cx="50" cy="46" r="2.4" fill="#ffd27a"/>',
  garden: base() + '<path d="M30 0h40l14 74H16z" fill="url(#ctm-shaft)"/><g stroke="#6b4a2e" stroke-width="3" fill="none" stroke-linecap="round"><path d="M16 0q5 14-2 28"/><path d="M34 0q-4 10 3 20t-1 14"/><path d="M64 0q2 12 10 18"/><path d="M84 0q-5 16 2 32"/></g>' +
    '<g fill="#4fae7c"><path d="M22 74q-7-12 2-22 4 11-2 22z"/><path d="M72 74q8-14 19-14-6 12-19 14z"/><path d="M45 74q-3-17 8-23 2 13-8 23z"/><path d="M30 74q4-10 14-10-4 8-14 10z"/></g><g fill="#ff8fab"><circle cx="58" cy="70" r="2"/><circle cx="36" cy="71" r="1.6"/></g>',
  crypt: base() + torch(13, 38) + torch(87, 38) + '<path d="M24 74V56h52v18z" fill="#6d7d7b"/><path d="M24 56h52v4H24z" fill="#566664"/><path d="M22 56h56l-5-9H27z" fill="#9bb0a9"/><path d="M38 51.5h24M50 48.5v6" stroke="#ffd27a" stroke-width="2"/><path d="M30 65h40" stroke="#4a5856"/>',
  altar: base() + '<g stroke="#7fe3d8" stroke-opacity=".55" fill="none"><path d="M12 16l12 7 11-3 9 8M64 12l11 10-5 9M80 40l8-6"/></g>' + stars([[12, 16, 1.3], [24, 23, 1.1], [35, 20, 1.3], [44, 28, 1], [64, 12, 1.2], [75, 22, 1.4], [70, 31, 1], [88, 34, 1.1]]),
};
const KIND = ['landing', 'hall', 'steps', 'well', 'court', 'vault', 'shrine', 'aqueduct', 'library', 'gate', 'jade', 'deep', 'observatory', 'garden', 'crypt', 'altar'];

const PEDESTAL = '<path d="M35 74l3-5h24l3 5z" fill="#8fa8a2"/><rect x="40" y="59" width="20" height="10" fill="#6f8786"/><rect x="40" y="59" width="6" height="10" fill="#8aa29c"/><path d="M38 59h24l-2-3H40z" fill="#b2c8c1"/>';
const RELIC_ART = {
  5: '<path d="M50 30c4.2 0 6.6 3.2 6.6 7 0 2.6-1.3 4.5-3.2 5.6l3.8 3.4-2.2 8.5H45l-2.2-8.5 3.8-3.4c-1.9-1.1-3.2-3-3.2-5.6 0-3.8 2.4-7 6.6-7z" fill="url(#ctm-gold)" stroke="#7a5310" stroke-width=".8"/>' +
    '<circle cx="47.6" cy="37" r="1.1" fill="#4a2f05"/><circle cx="52.4" cy="37" r="1.1" fill="#4a2f05"/><path d="M48 40.5q2 1.2 4 0" stroke="#4a2f05" stroke-width=".9" fill="none"/><path d="M50 31.5l1.4 2-1.4 2-1.4-2z" fill="#3fe0c8"/>',
  10: '<path d="M39 35q11-9 22 0v8q0 10-11 13-11-3-11-13z" fill="#43c99a" stroke="url(#ctm-gold)" stroke-width="2"/><path d="M43 41l5 1.2M57 41l-5 1.2" stroke="#0f3b2c" stroke-width="2" stroke-linecap="round"/>' +
    '<path d="M46 49q4 2.5 8 0" stroke="#ffd27a" stroke-width="1.6" fill="none" stroke-linecap="round"/><path d="M50 30v-3" stroke="#ffd27a" stroke-width="2"/>',
  15: '<path d="M50 30l4.3 8.8 9.7 1.4-7 6.8 1.7 9.6L50 52l-8.7 4.6 1.7-9.6-7-6.8 9.7-1.4z" fill="url(#ctm-gold)" stroke="#7a5310" stroke-width=".8"/><circle cx="50" cy="44.5" r="3.2" fill="#3fe0c8"/>',
};
const EMPTY = '<path d="M50 38l2.2 5.3 5.3 2.2-5.3 2.2L50 53l-2.2-5.3-5.3-2.2 5.3-2.2z" fill="none" stroke="#ffe7a3" stroke-opacity=".75" stroke-width="1.2"/>';
const WATER_TOP = [100, 72, 56, 40, 24];
const VIGNETTE = '<rect width="100" height="100" fill="url(#ctm-vig)"/>';
// Waves roll in layers of their own (coop-kit layer()), so the compositor moves them without repainting the room.
// Nothing still in the scene overlaps a wave band except the surface line, which reads the same under it.
const AQUEDUCT_WAVE = layer('coop-wave', '', '<path d="M-50 19.5q12.5-2 25 0t25 0t25 0t25 0t25 0t25 0t25 0t25 0V22H-50z" fill="#c8fff6" opacity=".5"/>');

function water(level, i) {
  if (!level) return { art: '', fx: '' };
  const y = WATER_TOP[level];
  return {
    art: `<rect y="${y}" width="100" height="${100 - y}" fill="url(#ctm-water)"/>` +
      `<path d="M0 ${y + .6}h100" stroke="#dcfffa" stroke-opacity=".55"/><path d="M14 ${y + 9}h14M60 ${y + 14}h20M30 ${y + 22}h12" stroke="#c8fff6" stroke-opacity=".25" stroke-linecap="round"/>` +
      (level >= 3 ? `<g fill="none" stroke="#dcfffa" stroke-opacity=".6"><circle cx="28" cy="${y + 20}" r="1.6"/><circle cx="70" cy="${y + 32}" r="1.2"/><circle cx="62" cy="${y + 12}" r="1"/></g>` : ''),
    fx: layer('coop-wave', `animation-delay:-${(i % 5) * .6}s`, `<path d="M-50 ${y + 1}q12.5-3.5 25 0t25 0t25 0t25 0t25 0t25 0t25 0t25 0V${y + 5}H-50z" fill="#b7fff4" opacity=".35"/>`),
  };
}

function landing(s) {
  const found = Array.from({ length: s.recovered }, (_, k) => `<path d="M${24 + k * 9} 66l3.5-4.5 3.5 4.5-3.5 3.5z" fill="url(#ctm-gold)" stroke="#fff2b8" stroke-width=".6"/>`).join('');
  return '<rect width="100" height="100" fill="url(#ctm-sky)"/>' + stars([[20, 14, 1], [44, 26, .8], [86, 40, 1]]) + '<circle cx="66" cy="20" r="12" fill="#f4f0d2" opacity=".12"/><circle cx="66" cy="20" r="6" fill="#f4f0d2"/>' +
    '<path d="M0 0h100v62h-8V34Q50 0 8 34v28H0z" fill="url(#ctm-wall)"/><path d="M8 34Q50 0 92 34" stroke="#a9c0ba" stroke-width="3" fill="none"/>' +
    '<rect y="62" width="100" height="38" fill="#0e5f6c"/><path d="M0 62.5h100" stroke="#8ff5e6" stroke-opacity=".5"/><path d="M10 92h14M64 96h18" stroke="#c8fff6" stroke-opacity=".3" stroke-linecap="round"/>' +
    '<path d="M0 69h58v6H0z" fill="#9a6a3a"/><path d="M0 69h58" stroke="#d8a868"/><path d="M8 75v14M26 75v14M44 75v14" stroke="#5a3a1a" stroke-width="3"/>' +
    '<path d="M54 81q20 9 42-1l-4-7H58z" fill="#a8703a"/><path d="M58 73h34" stroke="#e8c58a" stroke-width="1.5"/><path d="M76 73V48" stroke="#5a3a1a" stroke-width="2"/><path d="M77 50l13 19H77z" fill="#e9dcc0" opacity=".9"/>' +
    '<path d="M12 69V53" stroke="#5a3a1a" stroke-width="2"/><circle cx="12" cy="50" r="11" fill="url(#ctm-glow)" opacity=".8"/><rect x="9.5" y="47" width="5" height="6" rx="1" fill="#ffd27a"/>' + found;
}

// { art, fx, top }: the still scene, its moving waves, and the vignette over both (coop-kit tileHTML).
function roomArt(s, i) {
  const r = s.rooms[i];
  if (i === 0) return { art: landing(s), fx: '', top: '' };
  let out = ROOM[KIND[i]];
  // Excavation progress shows as three gold studs on the pedestal.
  if (relics.includes(i)) out += PEDESTAL + (r.relic ? `<circle cx="50" cy="44" r="22" fill="url(#ctm-glow)"/>${RELIC_ART[i]}${spark(63, 33, 3.4)}${spark(37, 51, 2.4)}` +
    [0, 1, 2].map((k) => `<path d="M${44 + k * 6} 61.4l2.2 2.2-2.2 2.2-2.2-2.2z" fill="${k < r.work ? '#ffd27a' : '#2c3d3f'}" stroke="#fff2b8" stroke-opacity="${k < r.work ? .9 : .3}" stroke-width=".6"/>`).join('') : EMPTY);
  const w = water(r.water, i);
  return { art: out + w.art, fx: (KIND[i] === 'aqueduct' ? AQUEDUCT_WAVE : '') + w.fx, top: VIGNETTE };
}

// Counters drawn as things in the temple: a shelf of relics, a flood tube, the boat, an hourglass.
const RELIC_MINI = [
  'M8 1c2.2 0 3.4 1.7 3.4 3.7 0 1.4-.7 2.4-1.7 3l2 1.8-1.1 4.5H5.4L4.3 9.5l2-1.8c-1-.6-1.7-1.6-1.7-3C4.6 2.7 5.8 1 8 1z',
  'M2 4.5Q8-.5 14 4.5v4q0 5.5-6 7.5-6-2-6-7.5z',
  'M8 .8l2.1 4.5 4.9.6-3.6 3.4.9 4.9L8 11.8l-4.3 2.4.9-4.9L1 5.9l4.9-.6z',
];
const relicGauge = (s) => `<svg viewBox="0 0 54 44"><rect x="1" y="34" width="52" height="5" rx="2" fill="#4d6a68"/><rect x="1" y="34" width="52" height="1.6" fill="#8fb3ae"/>${relics.map((room, k) => {
  const found = !s.rooms[room].relic;
  return `<g transform="translate(${2 + k * 17} 17)">${found ? '<circle cx="8" cy="8" r="10" fill="#ffd27a" opacity=".22"/>' : ''}<path d="${RELIC_MINI[k]}" fill="${found ? '#ffcf5c' : 'rgba(255,255,255,.04)'}" stroke="${found ? '#fff2b8' : '#8fb3ae'}" stroke-width="1.2"${found ? '' : ' stroke-dasharray="2 1.6"'}/></g>`;
}).join('')}</svg>`;
function floodGauge(pressure) {
  const p = Math.max(0, Math.min(1, pressure / 30)), h = 35 * p, y = 39.5 - h;
  return `<svg viewBox="0 0 26 44"><rect x="5" y="2" width="16" height="40" rx="8" fill="#062028" stroke="#8fb3ae" stroke-width="1.5"/><rect x="7.5" y="4.5" width="11" height="7" rx="3" fill="#ff6b81" opacity=".3"/>` +
    (h > .5 ? `<rect x="7.5" y="${y.toFixed(1)}" width="11" height="${h.toFixed(1)}" rx="${Math.min(5.5, h / 2).toFixed(1)}" fill="${p >= .8 ? '#5fd4ec' : '#2bd4c8'}"/><path d="M8.5 ${(y + 1).toFixed(1)}h9" stroke="#e3fffb" stroke-opacity=".85"/>` : '') +
    '<path d="M2 27.8h3.5M2 16.2h3.5M20.5 27.8H24M20.5 16.2H24" stroke="#8fb3ae"/><path d="M10 6.5v28" stroke="#fff" stroke-opacity=".12" stroke-width="1.5"/></svg>';
}
const dockGauge = (s) => {
  let k = 0;
  const heads = s.players.map((q, j) => q.pos === 0 ? `<circle cx="${9 + 6.5 * k++}" cy="25.5" r="3.2" fill="${colour(j)}" stroke="#0b1420"/>` : '').join('');
  return `<svg viewBox="0 0 46 44"><path d="M2 37q21 7 42 0" fill="none" stroke="#5fe0d2" stroke-opacity=".5"/><path d="M34 28V7" stroke="#6b4a2e" stroke-width="1.6"/><path d="M33 9L21 25h12z" fill="#e9dcc0"/>${heads}<path d="M5 28h36l-4 8H9z" fill="#a8703a"/><path d="M5 28h36" stroke="#e8c58a" stroke-width="1.4"/></svg>`;
};
function hourglass(frac) {
  const p = Math.max(0, Math.min(1, frac));
  return `<svg viewBox="0 0 28 44"><path d="M7 4.5c0 10 6.5 12 6.5 17.5S7 29.5 7 39.5h14c0-10-6.5-12-6.5-17.5S21 14.5 21 4.5z" fill="rgba(160,240,230,.08)" stroke="#9fd8d0" stroke-width="1.4"/>` +
    (p < 1 ? `<path d="M${(8.4 + 4.6 * p).toFixed(1)} ${(7 + 13 * p).toFixed(1)}H${(19.6 - 4.6 * p).toFixed(1)}L14 21.5z" fill="#ffd27a"/><path d="M14 21.5V39" stroke="#ffd27a" stroke-width=".8"/>` : '') +
    `<path d="M7.6 39.5Q14 ${(39.5 - 15 * p).toFixed(1)} 20.4 39.5z" fill="#ffd27a"/><path d="M5 3h18M5 41h18" stroke="#c9a463" stroke-width="3" stroke-linecap="round"/></svg>`;
}

// The flood across the room (0..1) follows the flood pressure. When it changes, the water glides to its new
// height by a transform the compositor runs, rather than by animating its height (layout and paint every frame).
const floodOf = (s) => Math.min(1, s.pressure / 30).toFixed(2);
let shownFlood = null;
function riseFlood(el, s) {
  const f = +floodOf(s), was = shownFlood;
  shownFlood = s.phase === 'briefing' ? null : f;
  const pool = el.querySelector('.coop-flood');
  if (was == null || was === f || !pool?.animate) return;
  // The layer is (45 + 38f)% of the room tall, and its surface moved by 38% × (f - was) of the room.
  pool.animate([{ transform: `translateY(${((f - was) * 38 / (45 + 38 * f) * 100).toFixed(3)}%)` }, { transform: 'none' }], { duration: 800, easing: 'cubic-bezier(.2, .8, .2, 1)' });
}

/* Cover: two explorers wade out of the flooding temple; one lifts the golden idol while a third hauls
   them in from the boat. Ids are prefixed tmc- because covers appear several times on one page. */
function coverSVG() {
  const sp = (x, y, r, o = 1) => `<path d="M${x} ${y - r}L${x + r * .25} ${y - r * .25} ${x + r} ${y} ${x + r * .25} ${y + r * .25} ${x} ${y + r} ${x - r * .25} ${y + r * .25} ${x - r} ${y} ${x - r * .25} ${y - r * .25}z" fill="#fffbe6" opacity="${o}"/>`;
  const sky = [[30, 18, .9], [62, 40, .6], [96, 14, .8], [214, 24, .7], [236, 8, .9], [298, 30, .6], [182, 10, .6], [124, 32, .5], [14, 60, .5]].map(([x, y, o]) => `<circle cx="${x}" cy="${y}" r="1" fill="#e9fff9" opacity="${o}"/>`).join('');
  return '<svg viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Explorers wade out of a flooding temple, one lifting a golden relic"><defs>' +
    '<linearGradient id="tmc-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#061827"/><stop offset=".55" stop-color="#0f4a5e"/><stop offset="1" stop-color="#2a9a98"/></linearGradient>' +
    '<linearGradient id="tmc-stone" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7f9a94"/><stop offset="1" stop-color="#38524f"/></linearGradient>' +
    '<linearGradient id="tmc-water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4fe3d4" stop-opacity=".94"/><stop offset=".4" stop-color="#1897a2"/><stop offset="1" stop-color="#063f4b"/></linearGradient>' +
    '<linearGradient id="tmc-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff6c8"/><stop offset=".45" stop-color="#ffcf5c"/><stop offset="1" stop-color="#a86f12"/></linearGradient>' +
    '<radialGradient id="tmc-glow"><stop offset="0" stop-color="#fff3b8" stop-opacity=".95"/><stop offset=".4" stop-color="#ffd27a" stop-opacity=".42"/><stop offset="1" stop-color="#ffd27a" stop-opacity="0"/></radialGradient>' +
    '<radialGradient id="tmc-door" cx=".5" cy=".85" r=".8"><stop offset="0" stop-color="#3fd6c8" stop-opacity=".6"/><stop offset="1" stop-color="#03141a"/></radialGradient>' +
    '<linearGradient id="tmc-fall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d4fff8" stop-opacity=".95"/><stop offset="1" stop-color="#4fe3d4" stop-opacity=".25"/></linearGradient>' +
    '<radialGradient id="tmc-moon"><stop offset="0" stop-color="#e9fff9" stop-opacity=".3"/><stop offset="1" stop-color="#e9fff9" stop-opacity="0"/></radialGradient></defs>' +
    // night sky over the jungle
    `<rect width="320" height="200" fill="url(#tmc-sky)"/>${sky}<circle cx="262" cy="42" r="30" fill="url(#tmc-moon)"/><circle cx="262" cy="42" r="11" fill="#f2f6e0"/><circle cx="258" cy="39" r="2" fill="#d6dcc2"/><circle cx="265.5" cy="46" r="1.6" fill="#d6dcc2"/>` +
    '<path d="M0 152V98c8-10 18-12 24-4 4-12 16-16 24-6 6-6 14-4 18 4v60z" fill="#0b3a3c"/><path d="M320 152V94c-8-10-20-12-26-2-5-10-16-12-22-2-6-4-13-1-16 6v56z" fill="#0b3a3c"/>' +
    '<g stroke="#0f4e4c" stroke-width="5" fill="none" stroke-linecap="round"><path d="M20 98q-14-8-24 2M20 98q10-14 26-10M300 96q12-10 24-2M300 96q-10-14-26-8"/></g>' +
    // the stepped temple, with carved gold and water pouring out of it
    '<path d="M60 162V118h200v44z" fill="url(#tmc-stone)"/><path d="M80 118V88h160v30z" fill="url(#tmc-stone)"/><path d="M102 88V62h116v26z" fill="url(#tmc-stone)"/><path d="M132 62V40h56v22z" fill="url(#tmc-stone)"/><path d="M124 42l36-20 36 20z" fill="#5d7b77"/>' +
    '<path d="M240 118h20v44h-20zM218 88h22v30h-22zM196 62h22v26h-22zM176 40h12v22h-12z" fill="#000" opacity=".16"/>' +
    '<path d="M60 118h200M80 88h160M102 62h116" stroke="#c4dcd2" stroke-opacity=".5" stroke-width="1.5"/><path d="M124 42h72" stroke="#ffd27a" stroke-width="2"/>' +
    '<path d="M60 140h200M80 103h160M102 75h116M92 118v22M118 118v22M202 118v22M228 118v22M100 88v15M126 88v15M194 88v15M220 88v15M118 62v13M202 62v13" stroke="#1c2f30" stroke-opacity=".45"/>' +
    '<circle cx="160" cy="51" r="9" fill="none" stroke="#ffd27a" stroke-opacity=".5"/><circle cx="160" cy="51" r="5.5" fill="url(#tmc-gold)"/>' +
    '<rect x="127" y="97" width="9" height="65" fill="#8aa39d"/><rect x="184" y="97" width="9" height="65" fill="#8aa39d"/><rect x="132" y="97" width="4" height="65" fill="#000" opacity=".16"/><rect x="189" y="97" width="4" height="65" fill="#000" opacity=".16"/>' +
    '<rect x="122" y="90" width="76" height="7" fill="#a3bcb4"/><path d="M137 93.5l3-2.6 3 2.6-3 2.6zM157 93.5l3-2.6 3 2.6-3 2.6zM177 93.5l3-2.6 3 2.6-3 2.6z" fill="url(#tmc-gold)"/>' +
    '<path d="M139 162v-49q21-18 42 0v49z" fill="url(#tmc-door)"/><path d="M141 140q19 9 38 0v22h-38z" fill="url(#tmc-fall)" opacity=".85"/>' +
    '<rect x="84" y="99" width="12" height="7" rx="2" fill="#a3bcb4"/><rect x="224" y="99" width="12" height="7" rx="2" fill="#a3bcb4"/>' +
    '<path d="M86 106h8q-2 12 1 50h-9q-3-28 0-50zM226 106h8q3 22 0 50h-9q3-38 1-50z" fill="url(#tmc-fall)" opacity=".75"/>' +
    '<g stroke="#3f9a6a" stroke-width="2.2" fill="none" stroke-linecap="round"><path d="M106 62q4 10-2 18t2 16"/><path d="M214 62q-5 12 1 20"/><path d="M83 88q-4 8 1 14"/><path d="M246 118q4 10-1 18"/></g>' +
    '<g fill="#4fae7c"><ellipse cx="104" cy="72" rx="2.6" ry="1.4"/><ellipse cx="107" cy="86" rx="2.6" ry="1.4"/><ellipse cx="216" cy="74" rx="2.6" ry="1.4"/><ellipse cx="84" cy="96" rx="2.4" ry="1.3"/></g>' +
    // loose stones tumbling from the top tier
    '<path d="M224 70l6-3 4 5-5 4zM232 84l4-1 2 3-3 3z" fill="#7f9a94"/><path d="M222 64l-3-6M236 78l-2-6" stroke="#c4dcd2" stroke-opacity=".5" stroke-linecap="round"/>' +
    // the flood
    '<path d="M0 150q20-5 40 0t40 0 40 0 40 0 40 0 40 0 40 0 40 0V200H0z" fill="url(#tmc-water)"/>' +
    '<g stroke="#d8fff8" stroke-opacity=".45" stroke-width="1.5" fill="none" stroke-linecap="round"><path d="M14 164q14-4 28 0M64 176q18-5 36 0M232 170q16-4 32 0M270 186q14-4 28 0M176 188q14-4 28 0M110 190q12-4 24 0"/></g>' +
    '<g fill="#ffcf5c"><ellipse cx="112" cy="178" rx="3" ry="1.2"/><ellipse cx="252" cy="176" rx="3" ry="1.2"/><ellipse cx="196" cy="182" rx="2.4" ry="1"/></g>' +
    // the boat, with a third explorer hauling on the rope
    '<path d="M24 160q34 14 74-2l-6-8H30z" fill="#9a6232"/><path d="M30 150h62" stroke="#e1b878" stroke-width="2"/><path d="M28 156q34 10 66 0" stroke="#6e4220" stroke-width="1.5" fill="none"/>' +
    '<path d="M48 151q-1-18 10-21 10 3 10 21z" fill="#4fbf86"/><circle cx="58" cy="122" r="7.5" fill="#8d5a3b"/><path d="M50.5 121q1-8.5 7.5-8.5t7.5 8.5q-3-4-7.5-4t-7.5 4z" fill="#241712"/>' +
    '<circle cx="60.5" cy="121.5" r="1" fill="#1d1412"/><path d="M64 136q10-2 18-8" stroke="#4fbf86" stroke-width="5" stroke-linecap="round" fill="none"/><circle cx="83" cy="127" r="3" fill="#8d5a3b"/>' +
    '<path d="M84 127q22 20 50 21" stroke="#efe0b0" stroke-width="1.6" fill="none" stroke-dasharray="3 2"/>' +
    '<path d="M92 150v-15" stroke="#6e4220" stroke-width="1.6"/><circle cx="92" cy="132" r="10" fill="url(#tmc-glow)"/><rect x="89.5" y="129" width="5" height="6" rx="1.2" fill="#ffd27a"/>' +
    // the lead explorer, waist-deep, lifting the idol
    '<ellipse cx="146" cy="161" rx="22" ry="4" fill="none" stroke="#e8fffb" stroke-opacity=".6" stroke-width="1.5"/>' +
    '<circle cx="147" cy="78" r="38" fill="url(#tmc-glow)"/><g fill="#fff3b8" opacity=".16"><path d="M147 78L118 4h14zM147 78L176 4h-14zM147 78L92 40l5-8zM147 78l55-38-5-8z"/></g>' +
    '<path d="M131 161q-1-26 15-31 16 5 15 31z" fill="#e39b45"/><path d="M146 130q16 5 15 31h-8q1-21-7-31z" fill="#000" opacity=".12"/><path d="M136 134l18 25" stroke="#6e4220" stroke-width="3"/>' +
    '<rect x="142.5" y="122" width="7" height="9" rx="3" fill="#b5764f"/>' +
    '<path d="M134 137q-8-20 4-43" stroke="#e39b45" stroke-width="7" stroke-linecap="round" fill="none"/><path d="M158 137q8-20-2-43" stroke="#e39b45" stroke-width="7" stroke-linecap="round" fill="none"/>' +
    '<circle cx="146" cy="116" r="9.5" fill="#c98a5e"/><circle cx="143" cy="114" r="1.2" fill="#2a1c1a"/><circle cx="150" cy="114" r="1.2" fill="#2a1c1a"/><path d="M142.5 119q3.5 3.2 7 0" stroke="#5a2e20" stroke-width="1.4" fill="none" stroke-linecap="round"/>' +
    '<ellipse cx="146" cy="108.5" rx="15" ry="3.6" fill="#8a5a2b"/><path d="M137.5 108.5q.5-10 8.5-10t8.5 10z" fill="#a8743a"/><path d="M137.8 106h16.4" stroke="#5a3515" stroke-width="2"/>' +
    '<path d="M147 60c5.6 0 8.8 4.2 8.8 9.3 0 3.5-1.7 6-4.3 7.5l5 4.5-3 11.3h-13l-3-11.3 5-4.5c-2.6-1.5-4.3-4-4.3-7.5 0-5.1 3.2-9.3 8.8-9.3z" fill="url(#tmc-gold)" stroke="#8a5a10"/>' +
    '<circle cx="143.8" cy="69.5" r="1.4" fill="#4a2f05"/><circle cx="150.2" cy="69.5" r="1.4" fill="#4a2f05"/><path d="M144.4 74q2.6 1.6 5.2 0" stroke="#4a2f05" stroke-width="1.1" fill="none"/><path d="M147 62.5l2 2.6-2 2.6-2-2.6z" fill="#3fe0c8"/>' +
    '<circle cx="139" cy="92" r="4" fill="#c98a5e"/><circle cx="155" cy="92" r="4" fill="#c98a5e"/>' +
    sp(166, 60, 6) + sp(127, 70, 4) + sp(160, 40, 3, .8) + sp(176, 82, 2.6, .8) +
    // the diver, holding a torch high and reaching back for the others
    '<ellipse cx="206" cy="164" rx="18" ry="3.5" fill="none" stroke="#e8fffb" stroke-opacity=".6" stroke-width="1.5"/>' +
    '<path d="M193 164q-1-22 13-27 14 5 13 27z" fill="#d9577a"/><path d="M206 137v27" stroke="#ffd0dc" stroke-opacity=".5" stroke-width="2"/><rect x="202.5" y="129" width="7" height="9" rx="3" fill="#7a4a30"/>' +
    '<path d="M216 143q10-10 10-26" stroke="#d9577a" stroke-width="6" stroke-linecap="round" fill="none"/><path d="M196 144q-12 2-20-4" stroke="#d9577a" stroke-width="6" stroke-linecap="round" fill="none"/><circle cx="175" cy="139" r="3.3" fill="#8a5636"/>' +
    '<circle cx="206" cy="123" r="8.5" fill="#8a5636"/><path d="M197.5 122q0-10 8.5-10t8.5 10q-2-5-8.5-5t-8.5 5z" fill="#1d1412"/><rect x="199" y="116" width="14" height="4.6" rx="2.3" fill="#3fd6e0" stroke="#0e3a40"/>' +
    '<circle cx="203" cy="124" r="1.1" fill="#1d1412"/><circle cx="209.5" cy="124" r="1.1" fill="#1d1412"/><ellipse cx="206" cy="128.3" rx="1.8" ry="1.3" fill="#5a2026"/>' +
    '<rect x="224.6" y="100" width="2.8" height="16" rx="1" fill="#6e4220"/><circle cx="226" cy="117" r="3.5" fill="#8a5636"/><circle cx="226" cy="95" r="16" fill="url(#tmc-glow)"/><path d="M226 86q5.5 5.5 0 12q-5.5-6.5 0-12z" fill="#ffb84d"/><path d="M226 90.5q2.2 2.6 0 6q-2.2-3.4 0-6z" fill="#fff0b8"/>' +
    '<g stroke="#e8fffb" stroke-opacity=".75" stroke-width="1.5" fill="none" stroke-linecap="round"><path d="M186 161q-4-6-2-11M228 161q4-6 2-11M126 157q-4-6-1-10M166 157q4-6 1-10"/></g>' +
    '<g fill="#e8fffb" opacity=".7"><circle cx="182" cy="147" r="1.4"/><circle cx="232" cy="147" r="1.2"/><circle cx="122" cy="146" r="1.2"/><circle cx="170" cy="145" r="1.4"/></g></svg>';
}

/* ===================== Expert teammates (computer level 'hard') ===================== */

// Expert teammates plan the whole expedition: they try every way to split the relics between them (and every
// order to visit them), take the plan that brings the last explorer home soonest, secure the flood gates only
// when the round would otherwise end at 30 (or when they have time to spare), and walk straight home.
const speedOf = (p) => (p.role === 'Explorer' ? 2 : 1);
const steps = (p, from, to) => Math.ceil(distance(from, to) / speedOf(p));
// Actions p needs in relic room i: drain it until digging is allowed, then dig the rest.
function workAt(s, p, i) {
  const r = s.rooms[i], drains = p.role === 'Diver' ? 0 : Math.ceil(Math.max(0, r.water - 2) / (p.role === 'Engineer' ? 2 : 1));
  return drains + Math.ceil((3 - r.work) / (p.role === 'Scholar' ? 2 : 1));
}
// Actions p needs to recover the relics in `list`, in that order, and reach the landing.
function tour(s, p, list) {
  let at = p.pos, t = 0;
  for (const i of list) { t += steps(p, at, i) + workAt(s, p, i); at = i; }
  return t + steps(p, at, 0);
}
const orders = (list) => (list.length < 2 ? [list] : list.flatMap((x, k) => orders(list.filter((_, j) => j !== k)).map((rest) => [x, ...rest])));
function plan(s) {
  const left = relics.filter((i) => s.rooms[i].relic), n = s.players.length;
  let best = null;
  for (let code = 0; code < n ** left.length; code++) {
    const lists = s.players.map(() => []);
    left.forEach((i, k) => lists[Math.floor(code / n ** k) % n].push(i));
    const routes = s.players.map((p, j) => orders(lists[j]).map((o) => ({ o, t: tour(s, p, o) })).reduce((a, b) => (b.t < a.t ? b : a)));
    const span = Math.max(...routes.map((r) => r.t)), sum = routes.reduce((a, r) => a + r.t, 0);
    if (!best || span < best.span || (span === best.span && sum < best.sum)) best = { span, sum, routes };
  }
  return best;
}
function expert(s, p, moves) {
  const pick = (type, to) => moves.find((m) => m.type === type && (to == null || m.to === to));
  const toward = (goal) => moves.filter((m) => m.type === 'move').reduce((a, b) => (distance(b.to, goal) < distance(a.to, goal) ? b : a));
  // The last explorer home ends the game at once, before the water rises again.
  if (s.recovered === 3 && s.players.every((q) => q === p || q.pos === 0) && pick('move', 0)) return pick('move', 0);
  // Teammates still to act this round can each secure the gates once; rest now only if they could not hold it below 30.
  const after = s.players.length - 1 - s.cur;
  if (Math.ceil((s.pressure + s.difficulty + 1 - 29) / 3) > after) return pick('rest');
  const { span, routes } = plan(s), mine = routes[s.cur], goal = mine.o[0];
  // With time to spare (nothing to dig, or already waiting at the landing), lower the pressure for the others.
  if ((mine.t < span || (p.pos === 0 && goal == null)) && s.pressure >= 3) return pick('rest');
  if (goal == null) return p.pos === 0 ? pick('wait') || pick('rest') : toward(0);
  if (p.pos === goal) return pick('dig') || pick('drain') || pick('rest');
  return toward(goal);
}

/* ===================== rules ===================== */

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
  hint:(s,p)=>s.recovered===3?'Return to the landing.':'Recover relics and keep flood pressure below 30.',
  expert,

  /* ---- presentation ---- */
  cover: coverSVG(), defs, placeWord: 'room', eventGlyph: 'wave',
  mood: (s) => `--flood:${floodOf(s)}`,
  backdrop: '<i class="coop-flood"></i>',
  drawn: riseFlood,
  gauges(s) {
    const ashore = s.players.filter((p) => p.pos === 0).length;
    return [
      { key: 'relics', label: 'Relics', value: `${s.recovered} / 3`, n: s.recovered, art: relicGauge(s) },
      { key: 'flood', label: 'Flood pressure', value: `${s.pressure} / 30`, n: s.pressure, dir: -1, art: floodGauge(s.pressure) },
      { key: 'landing', label: 'At landing', value: `${ashore} / ${s.players.length}`, n: ashore, art: dockGauge(s) },
      { key: 'round', label: 'Round', value: `${s.round} / 30`, art: hourglass((s.round - 1) / 30) },
    ];
  },
  place(s, i, ui) {
    const r = s.rooms[i], relicRoom = relics.includes(i);
    const chips = [i === 0 ? chip('anchor', 'Dry', 'coop-ok') : r.water ? chip('wave', `${r.water}/4`, r.water >= 3 ? 'coop-warn' : '') : '<span></span>'];
    if (relicRoom) chips.push(r.relic ? chip('relic', `${r.work}/3`, 'coop-gold' + ui.look('work-' + i, r.work)) : chip('check', '', 'coop-ok'));
    const label = `${r.name}${relicRoom ? (r.relic ? `, relic ${r.work} of 3 excavated` : ', relic recovered') : ''}${i === 0 ? ', the dry landing' : `, water ${r.water} of 4`}`;
    return { name: r.name, level: r.water, marker: relicRoom && r.relic, chips, label, ...roomArt(s, i) };
  },
  personal: (s, p) => `<span class="coop-stat">${glyph('pin')}${esc(names[p.pos])}</span>`,
});
