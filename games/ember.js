import { cooperative, action, distance, finish, glyph, chip } from './coop-kit.js';
import { rand, esc } from '../js/util.js';
const names=['River Camp','Pine Ridge','Fox Hollow','East Grove','Cedar Pass','Watchtower','Fernwood','Deer Meadow','Creek Bend','Oak Stand','Owl Nest','North Trail','Willow Village','Moss Hill','Badger Den','Ash Village'];
const animalSites=[2,7,10,14];

/* ===================== art (presentation only) ===================== */

const ANIMALS = ['Fox', 'Deer', 'Owl', 'Badger']; // in animalSites order
const f1 = (n) => +n.toFixed(1);

// Shared gradients for the forest scenes (drawn once per render by coop-kit).
const defs = '<linearGradient id="cem-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a2152"/><stop offset=".5" stop-color="#6a3a62"/><stop offset=".62" stop-color="#c0603e"/><stop offset="1" stop-color="#d0703e"/></linearGradient>' +
  '<linearGradient id="cem-ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a663f"/><stop offset="1" stop-color="#172d20"/></linearGradient>' +
  '<linearGradient id="cem-pine" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a7a4e"/><stop offset="1" stop-color="#173a28"/></linearGradient>' +
  '<radialGradient id="cem-glow"><stop offset="0" stop-color="#ffb050" stop-opacity=".9"/><stop offset="1" stop-color="#ff7a30" stop-opacity="0"/></radialGradient>' +
  '<linearGradient id="cem-fire" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe48a"/><stop offset=".5" stop-color="#ff9a3a"/><stop offset="1" stop-color="#e2452a"/></linearGradient>' +
  '<linearGradient id="cem-river" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#86dcec"/><stop offset="1" stop-color="#2a76a0"/></linearGradient>' +
  '<radialGradient id="cem-vig" cx=".5" cy=".45" r=".75"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".45"/></radialGradient>';

const BASE = '<rect width="100" height="100" fill="url(#cem-sky)"/><path d="M0 50q20-9 40-4t35-2 25 4v52H0z" fill="#3a3358" opacity=".85"/><path d="M0 62q25-8 50-2t50-2v42H0z" fill="url(#cem-ground)"/>';
const pine = (x, y, h) => `<path d="M${x} ${f1(y - h)}L${f1(x + h * .3)} ${f1(y - h * .45)}H${f1(x + h * .16)}L${f1(x + h * .38)} ${f1(y - h * .1)}H${f1(x - h * .38)}L${f1(x - h * .16)} ${f1(y - h * .45)}H${f1(x - h * .3)}z" fill="url(#cem-pine)"/>` +
  `<rect x="${f1(x - h * .05)}" y="${f1(y - h * .1)}" width="${f1(h * .1)}" height="${f1(h * .14)}" fill="#5a3b26"/>`;
const oak = (x, y, r) => `<rect x="${f1(x - r * .12)}" y="${f1(y - r * .9)}" width="${f1(r * .24)}" height="${f1(r * .9)}" fill="#5a3b26"/><circle cx="${x}" cy="${f1(y - r * 1.5)}" r="${r}" fill="#3f7a45"/><circle cx="${f1(x - r * .35)}" cy="${f1(y - r * 1.8)}" r="${f1(r * .55)}" fill="#5a9a55"/>`;
const cottage = (x, w) => `<path d="M${x} 74V60h${w}v14z" fill="#c99a6a"/><path d="M${x - 3} 61l${w / 2 + 3} -12 ${w / 2 + 3} 12z" fill="#8a3f2a"/><rect x="${f1(x + w * .2)}" y="64" width="${f1(w * .25)}" height="10" fill="#5a3a22"/><rect x="${f1(x + w * .6)}" y="63" width="${f1(w * .22)}" height="5" fill="#ffd27a"/>`;
const pawPrint = (x, y) => `<ellipse cx="${x}" cy="${y}" rx="2.4" ry="1.9"/><circle cx="${x - 2.3}" cy="${y - 2.9}" r=".95"/><circle cx="${x}" cy="${y - 3.6}" r=".95"/><circle cx="${x + 2.3}" cy="${y - 2.9}" r=".95"/>`;

// One scene per space, so every square of the forest reads as a place.
const SCENE = {
  camp: BASE + '<path d="M0 76q25-6 50 0t50 0v24H0z" fill="url(#cem-river)"/><path d="M8 84h16M56 88h22M30 94h14" stroke="#e0f8ff" stroke-opacity=".5" stroke-linecap="round"/>' +
    '<path d="M16 72l15-24 15 24z" fill="#e8b04a"/><path d="M31 48v24" stroke="#8a5a2b"/><path d="M26 72l5-9 5 9z" fill="#5a3a1a"/><path d="M52 70l12-18 12 18z" fill="#d96a4a"/><path d="M60 70l4-7 4 7z" fill="#5a2a1a"/>' +
    '<circle cx="86" cy="66" r="10" fill="url(#cem-glow)" opacity=".7"/><path d="M82 70h8" stroke="#6b4a2e" stroke-width="2.4" stroke-linecap="round"/><path d="M86 61q3 3 0 8q-3-4 0-8z" fill="#ffb84d"/>' +
    '<rect x="4" y="60" width="9" height="12" rx="2" fill="#6b4a2e"/><ellipse cx="8.5" cy="60" rx="4.5" ry="1.6" fill="#6fd3e6"/><path d="M4 64h9M4 68h9" stroke="#3b2a1e"/>',
  ridge: BASE + '<path d="M0 60l28-14 30 9 42-12v57H0z" fill="#2a4a33"/>' + pine(18, 62, 28) + pine(40, 58, 34) + pine(66, 57, 30) + pine(86, 62, 24),
  hollow: BASE + pine(12, 62, 22) + pine(90, 64, 20) + '<path d="M8 76q8-32 42-33t42 33z" fill="#5a4330"/><path d="M16 66q10-18 34-20" stroke="#7a5d42" stroke-width="2" fill="none"/><ellipse cx="50" cy="70" rx="15" ry="10" fill="#1a120c"/>',
  grove: BASE + oak(24, 66, 11) + oak(54, 62, 14) + oak(82, 68, 10),
  pass: BASE + '<path d="M0 76V38l18-10 12 22 4 26zM100 76V34l-16-8-14 22-4 28z" fill="#5a5466"/><path d="M0 38l18-10 12 22M100 34l-16-8-14 22" stroke="#8a84a0" stroke-width="1.5" fill="none"/>' +
    '<path d="M40 100l7-38h6l7 38z" fill="#8a6a44" opacity=".7"/>' + pine(14, 30, 16) + pine(86, 28, 16),
  tower: BASE + pine(14, 64, 24) + pine(88, 66, 20) + '<path d="M38 74l8-40M62 74l-8-40M41 62h18M43 50h14M40 74l20-24M60 74L40 50" stroke="#7a5a3a" stroke-width="2.4"/>' +
    '<rect x="39" y="22" width="22" height="13" fill="#a8743f"/><rect x="43" y="25" width="14" height="6" fill="#ffd27a"/><path d="M36 23l14-10 14 10z" fill="#6b3f2a"/>',
  fern: BASE + '<path d="M0 0h100v28q-25 8-50 0T0 28z" fill="#1f3d2a"/><path d="M20 18v48M44 20v44M78 16v50" stroke="#3b2a1e" stroke-width="5"/>' +
    '<g stroke="#6fbf6a" stroke-width="3" fill="none" stroke-linecap="round"><path d="M8 78q8-14 22-16"/><path d="M30 78q6-16 20-20"/><path d="M62 78q-2-14 12-20"/><path d="M80 78q2-12 14-14"/></g>',
  meadow: BASE + pine(10, 60, 16) + pine(92, 60, 18) + '<path d="M0 66q50-8 100 0v34H0z" fill="#4c7a3e"/><g fill="#ffd166"><circle cx="14" cy="82" r="1.6"/><circle cx="30" cy="90" r="1.4"/><circle cx="76" cy="86" r="1.6"/><circle cx="88" cy="94" r="1.3"/></g>' +
    '<g fill="#ff8fab"><circle cx="22" cy="94" r="1.4"/><circle cx="64" cy="92" r="1.5"/><circle cx="84" cy="80" r="1.3"/></g>',
  creek: BASE + pine(12, 62, 22) + oak(82, 64, 10) + '<path d="M28 58q22 8 8 20t30 24" stroke="url(#cem-river)" stroke-width="10" fill="none" stroke-linecap="round"/><path d="M30 60q18 7 6 18" stroke="#e0f8ff" stroke-opacity=".5" fill="none"/>' +
    '<path d="M18 80v-8M21 80v-10M60 76v-7" stroke="#7fbf6a" stroke-width="1.6" stroke-linecap="round"/>',
  oaks: BASE + oak(20, 68, 12) + oak(48, 64, 16) + oak(80, 66, 13),
  owl: BASE + '<circle cx="50" cy="20" r="24" fill="#2f5a36"/><circle cx="34" cy="16" r="13" fill="#3f7a45"/><circle cx="67" cy="18" r="14" fill="#3f7a45"/>' +
    '<path d="M38 76V32q0-8 12-8t12 8v44z" fill="#5a3b26"/><path d="M38 76q-6 0-10 4M62 76q6 0 10 4M62 40l14-8" stroke="#5a3b26" stroke-width="4" fill="none"/><ellipse cx="50" cy="51" rx="9" ry="11" fill="#1a120c"/>',
  trail: BASE + pine(14, 62, 26) + pine(86, 60, 28) + '<path d="M34 100l12-40h8l12 40z" fill="#8a6a44" opacity=".75"/><path d="M68 74V56" stroke="#6b4a2e" stroke-width="2.4"/><path d="M62 56h14l3 3-3 3H62z" fill="#a8743f"/>',
  willow: BASE + cottage(12, 24) + cottage(54, 22) + '<path d="M88 74V40" stroke="#5a3b26" stroke-width="3"/><path d="M88 40q-14 4-16 26M88 40q-6 8-6 26M88 40q6 8 6 26M88 40q12 4 12 24" stroke="#7fb06a" stroke-width="2.2" fill="none"/>',
  hill: BASE + pine(90, 60, 18) + '<path d="M8 76q4-20 22-20t20 20zM44 76q6-28 28-28t26 28z" fill="#6a6a78"/><path d="M12 66q8-8 18-6M50 60q10-10 22-8" stroke="#7fbf6a" stroke-width="4" fill="none" stroke-linecap="round"/>',
  den: BASE + pine(12, 62, 22) + '<path d="M10 76q12-28 40-28t40 28z" fill="#6a4e36"/><ellipse cx="50" cy="72" rx="13" ry="7" fill="#1a120c"/><path d="M84 76v-7M88 76v-9" stroke="#7fbf6a" stroke-width="1.6" stroke-linecap="round"/>',
  ash: BASE + cottage(36, 22) + cottage(70, 20) + '<path d="M16 74V44" stroke="#5a3b26" stroke-width="3"/><circle cx="16" cy="38" r="12" fill="#6a8a4a"/><circle cx="12" cy="34" r="6" fill="#86a65a"/>',
};
const KIND = ['camp', 'ridge', 'hollow', 'grove', 'pass', 'tower', 'fern', 'meadow', 'creek', 'oaks', 'owl', 'trail', 'willow', 'hill', 'den', 'ash'];

// The animals waiting for rescue, in animalSites order.
const ANIMAL_ART = [
  // fox, sitting in front of its hollow
  '<path d="M60 74q14 0 14-12q-2 8-12 6z" fill="#e8742a"/><path d="M73 63q1 4-3 6l-2-3z" fill="#fff3e0"/><path d="M40 74q-2-14 8-20 10-2 14 6l2 14z" fill="#f08a3a"/>' +
    '<path d="M44 74q0-10 6-14q3 6 0 14z" fill="#fff3e0"/><path d="M38 52l2-9 4 5h6l4-5 2 9q-2 7-9 7t-9-7z" fill="#f08a3a"/><path d="M41 54q6 6 12 0q-2 5-6 5t-6-5z" fill="#fff3e0"/>' +
    '<circle cx="44" cy="52" r="1.1" fill="#1a120c"/><circle cx="50" cy="52" r="1.1" fill="#1a120c"/><circle cx="47" cy="57.5" r="1" fill="#1a120c"/><path d="M45 74v-4M52 74v-4" stroke="#7a3a12" stroke-width="2"/>',
  // deer, standing in the meadow
  '<ellipse cx="54" cy="60" rx="14" ry="7" fill="#a8703f"/><path d="M44 64v12M48 65v11M60 65v11M64 64v12" stroke="#7a4a26" stroke-width="2.4" stroke-linecap="round"/>' +
    '<path d="M40 60q-2-10 2-16l6 2q-2 6 0 14z" fill="#a8703f"/><ellipse cx="40" cy="44" rx="6" ry="4" fill="#b87d48" transform="rotate(-20 40 44)"/><path d="M44 40l5-3-2 5z" fill="#b87d48"/>' +
    '<path d="M42 40q-2-8 2-12M42 34l-4-3M44 32l3-3M38 40q-6-6-4-12M35 32l-3-1" stroke="#e9d2a6" stroke-width="1.6" fill="none" stroke-linecap="round"/><circle cx="38" cy="43" r="1" fill="#1a120c"/>' +
    '<ellipse cx="68" cy="57" rx="2" ry="3" fill="#fff3e0"/><circle cx="52" cy="57" r="1" fill="#f5e0c0"/><circle cx="57" cy="56" r="1" fill="#f5e0c0"/>',
  // owl, peering out of the hollow
  '<ellipse cx="50" cy="52" rx="7.5" ry="9.5" fill="#a87a4a"/><ellipse cx="50" cy="55" rx="4.5" ry="5.5" fill="#e8d2a6"/><path d="M43.5 44l1-5 3 3zM56.5 44l-1-5-3 3z" fill="#a87a4a"/>' +
    '<circle cx="47" cy="48.5" r="2.8" fill="#fff8e0"/><circle cx="53" cy="48.5" r="2.8" fill="#fff8e0"/><circle cx="47" cy="48.5" r="1.4" fill="#1a120c"/><circle cx="53" cy="48.5" r="1.4" fill="#1a120c"/><path d="M49 51.5h2l-1 2z" fill="#e8a23a"/>',
  // badger, nosing out of its den
  '<ellipse cx="56" cy="68" rx="14" ry="6.5" fill="#6d6d78"/><path d="M46 72v4M52 73v3M62 73v3M68 72v4" stroke="#2a2a30" stroke-width="2.4" stroke-linecap="round"/>' +
    '<path d="M30 68L42 61q6 0 6 5t-6 6z" fill="#f2f2f2"/><path d="M32 66.6L43 62.4l1 2.6-10 3.4z" fill="#1a1a1e"/><circle cx="30.8" cy="68" r="1.2" fill="#1a1a1e"/><circle cx="39" cy="64" r=".7" fill="#fff"/>',
];
const PRINTS = `<g fill="#f6e2c0" opacity=".55">${pawPrint(36, 72)}${pawPrint(52, 66)}${pawPrint(68, 72)}</g>`;

const FLAMES = [[], [[76, 80, 12]], [[20, 82, 14], [56, 80, 16], [86, 84, 12]], [[10, 86, 18], [32, 80, 22], [56, 84, 24], [80, 80, 20], [44, 68, 14], [70, 66, 12]]];
const flame = (x, y, h, fill, delay) => `<path class="coop-flick" style="animation-delay:-${delay}s" d="M${f1(x - h * .42)} ${y}C${f1(x - h * .55)} ${f1(y - h * .5)} ${f1(x - h * .1)} ${f1(y - h * .62)} ${x} ${f1(y - h * 1.25)}C${f1(x + h * .15)} ${f1(y - h * .62)} ${f1(x + h * .55)} ${f1(y - h * .5)} ${f1(x + h * .42)} ${y}z" fill="${fill}"/>`;
function fire(level, i, wind) {
  if (!level) return '';
  const dx = [0, 7, 0, -7][wind], dy = [-4, 0, 3, 0][wind];
  const smoke = level >= 2 ? `<g fill="#4a4055" opacity="${level === 3 ? .7 : .45}">${[0, 1, 2].map((k) => `<circle cx="${40 + k * (8 + dx)}" cy="${(level === 3 ? 30 : 36) - k * (6 - dy)}" r="${9 + k * 2}"/>`).join('')}</g>` : '';
  return `<rect width="100" height="100" fill="#ff5a1a" opacity="${[0, .1, .18, .28][level]}"/>${level === 3 ? '<rect y="58" width="100" height="42" fill="#120806" opacity=".4"/>' : ''}${smoke}` +
    `<ellipse cx="50" cy="98" rx="70" ry="${[0, 16, 26, 40][level]}" fill="url(#cem-glow)"/>` +
    FLAMES[level].map(([x, y, h], k) => flame(x, y, h, 'url(#cem-fire)', ((i + k) * .37 % 1.3).toFixed(2)) + flame(x, y, h * .5, '#fff0b0', ((i + k) * .37 % 1.3).toFixed(2))).join('');
}

function tileArt(s, i) {
  const t = s.tiles[i], site = animalSites.indexOf(i);
  let out = SCENE[KIND[i]];
  if (site >= 0) out += t.animal ? ANIMAL_ART[site] : PRINTS;
  return out + fire(t.fire, i, s.wind) + '<rect width="100" height="100" fill="url(#cem-vig)"/>';
}

// Counters drawn as things in the forest: paw tokens, village shields, a wind vane, a setting sun.
const PAW = '<ellipse cx="6.3" cy="10.5" rx="1.9" ry="2.4"/><ellipse cx="9.9" cy="6.6" rx="1.9" ry="2.4"/><ellipse cx="14.1" cy="6.6" rx="1.9" ry="2.4"/><ellipse cx="17.7" cy="10.5" rx="1.9" ry="2.4"/><path d="M12 11.6c-3 0-5.6 3.6-5.6 6 0 1.6 1.3 2.6 2.8 2.6 1.1 0 1.9-.6 2.8-.6s1.7.6 2.8.6c1.5 0 2.8-1 2.8-2.6 0-2.4-2.6-6-5.6-6z"/>';
function pawGauge(s) {
  const carried = s.players.reduce((n, p) => n + p.carry, 0);
  return `<svg viewBox="0 0 44 44">${[0, 1, 2, 3].map((k) => {
    const x = 11 + (k % 2) * 22, y = 11 + Math.floor(k / 2) * 22;
    const col = k < s.rescued ? '#8ce99a' : k < s.rescued + carried ? '#ffd27a' : 'rgba(255,255,255,.22)';
    return `<circle cx="${x}" cy="${y}" r="9.5" fill="${k < s.rescued ? 'rgba(140,233,154,.18)' : 'rgba(255,255,255,.04)'}" stroke="${col}" stroke-width="1.4"${k >= s.rescued && k < s.rescued + carried ? ' stroke-dasharray="3 2"' : ''}/>` +
      `<g transform="translate(${x - 7} ${y - 7.5}) scale(.58)" fill="${col}">${PAW}</g>`;
  }).join('')}</svg>`;
}
const shieldGauge = (n) => `<svg viewBox="0 0 48 44">${Array.from({ length: 8 }, (_, k) => {
  const x = 2 + (k % 4) * 11.5, y = 6 + Math.floor(k / 4) * 18, on = k < n;
  return `<path d="M${x + 4.5} ${y}l4.5 2v4c0 3.4-2 5.6-4.5 6.8C${x + 2} ${f1(y + 11.6)} ${x} ${f1(y + 9.4)} ${x} ${y + 6}V${y + 2}z" fill="${on ? '#8ce99a' : 'rgba(255,255,255,.05)'}" stroke="${on ? '#d3ffd9' : 'rgba(255,130,120,.5)'}" stroke-width="1"/>` +
    (on ? '' : `<path d="M${x + 3} ${y + 3}l2.5 3-2 2 2.5 3" stroke="rgba(255,130,120,.7)" stroke-width=".9" fill="none"/>`);
}).join('')}</svg>`;
const vane = (w) => '<svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="19" fill="rgba(0,0,0,.25)" stroke="rgba(255,220,180,.35)" stroke-width="1.2"/><path d="M22 3.5v4M22 36.5v4M3.5 22h4M36.5 22h4" stroke="rgba(255,220,180,.5)" stroke-width="1.4"/>' +
  `<g transform="rotate(${w * 90} 22 22)"><g class="coop-vane"><path d="M22 6.5l6.5 11h-4v12h-5v-12h-4z" fill="#ffb45e" stroke="#fff1d6" stroke-width=".8"/><path d="M19.5 29.5h5l1.6 6.5h-8.2z" fill="#c98a5e"/></g></g>` +
  '<circle cx="22" cy="22" r="2" fill="#fff1d6"/><text x="22" y="2.6" text-anchor="middle" font-size="6" font-weight="800" fill="#ffd9b0" font-family="Nunito, sans-serif">N</text></svg>';
const mix = (a, b, t) => '#' + [0, 2, 4].map((k) => Math.round(parseInt(a.slice(1 + k, 3 + k), 16) * (1 - t) + parseInt(b.slice(1 + k, 3 + k), 16) * t).toString(16).padStart(2, '0')).join('');
function dusk(frac) {
  const p = Math.max(0, Math.min(1, frac)), y = f1(9 + 24 * p);
  return `<svg viewBox="0 0 44 44"><rect x="1" y="1" width="42" height="42" rx="10" fill="${mix('#f0a050', '#1d1840', p)}"/><circle cx="22" cy="${y}" r="10" fill="#ffd27a" opacity=".25"/><circle cx="22" cy="${y}" r="6.5" fill="${mix('#ffe08a', '#ff7a4a', p)}"/>` +
    (p > .5 ? '<g fill="#fff8e0"><circle cx="9" cy="9" r=".9"/><circle cx="34" cy="7" r="1"/><circle cx="38" cy="16" r=".7"/></g>' : '') +
    '<path d="M1 31q10-5 21-2t21-1v4.5c0 5.5-4.5 9.5-10 9.5H11c-5.5 0-10-4-10-9.5z" fill="#16261d"/><path d="M8 31l3-7 3 7zM30 30l3.5-8 3.5 8z" fill="#0d1a13"/></svg>';
}

/* Cover: at dusk, a ranger runs a rescued fox past the fire line toward camp while a firefighter
   sprays the flames and an owl flees on the wind. Ids are prefixed emc- (covers repeat on a page). */
function coverSVG() {
  const fl = (x, y, h, fill) => `<path d="M${f1(x - h * .42)} ${y}C${f1(x - h * .55)} ${f1(y - h * .5)} ${f1(x - h * .1)} ${f1(y - h * .62)} ${x} ${f1(y - h * 1.25)}C${f1(x + h * .15)} ${f1(y - h * .62)} ${f1(x + h * .55)} ${f1(y - h * .5)} ${f1(x + h * .42)} ${y}z" fill="${fill}"/>`;
  const fire = (list) => list.map(([x, y, h]) => fl(x, y, h, 'url(#emc-fire)') + fl(x, y, h * .5, '#fff2b0')).join('');
  const tree = (x, y, h, c) => `<path d="M${x} ${y - h}L${f1(x + h * .3)} ${f1(y - h * .45)}H${f1(x + h * .16)}L${f1(x + h * .38)} ${f1(y - h * .08)}H${f1(x - h * .38)}L${f1(x - h * .16)} ${f1(y - h * .45)}H${f1(x - h * .3)}z" fill="${c}"/>`;
  const embers = [[180, 60], [204, 44], [226, 70], [246, 36], [262, 58], [284, 40], [300, 70], [214, 96], [192, 110], [272, 90], [236, 104], [168, 84], [292, 112], [254, 20]]
    .map(([x, y], k) => `<circle cx="${x}" cy="${y}" r="${k % 3 ? 1.2 : 1.8}" fill="#ffc06b" opacity="${k % 2 ? .7 : 1}"/>`).join('');
  const stars = [[22, 14], [44, 50], [96, 12], [120, 34], [150, 10], [12, 70], [76, 22]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r=".9" fill="#fff3e0" opacity=".7"/>`).join('');
  return '<svg viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Rangers carry a rescued fox past a wildfire line at dusk"><defs>' +
    '<linearGradient id="emc-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b1640"/><stop offset=".45" stop-color="#4b2660"/><stop offset=".75" stop-color="#b4483e"/><stop offset="1" stop-color="#f08a3c"/></linearGradient>' +
    '<linearGradient id="emc-fire" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff1a8"/><stop offset=".45" stop-color="#ffb03a"/><stop offset="1" stop-color="#e2452a"/></linearGradient>' +
    '<radialGradient id="emc-glow"><stop offset="0" stop-color="#ffb050" stop-opacity=".85"/><stop offset="1" stop-color="#ff7a30" stop-opacity="0"/></radialGradient>' +
    '<linearGradient id="emc-ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#24402c"/><stop offset="1" stop-color="#0e1b14"/></linearGradient>' +
    '<radialGradient id="emc-smoke"><stop offset="0" stop-color="#7a6a82" stop-opacity=".75"/><stop offset="1" stop-color="#7a6a82" stop-opacity="0"/></radialGradient>' +
    '<linearGradient id="emc-spray" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e8fbff"/><stop offset="1" stop-color="#7fd0f0" stop-opacity=".6"/></linearGradient></defs>' +
    // dusk sky, moon, smoke drifting west on the wind
    `<rect width="320" height="200" fill="url(#emc-sky)"/>${stars}<circle cx="60" cy="34" r="9" fill="#ffe9c0"/><circle cx="64" cy="31" r="8" fill="#2b1b4b"/>` +
    '<g><ellipse cx="250" cy="62" rx="64" ry="24" fill="url(#emc-smoke)"/><ellipse cx="186" cy="42" rx="74" ry="20" fill="url(#emc-smoke)"/><ellipse cx="116" cy="30" rx="62" ry="14" fill="url(#emc-smoke)"/></g>' +
    '<path d="M0 130q40-18 80-10t80-4 80 6 80-8V200H0z" fill="#2c2142"/>' + tree(18, 132, 30, '#1f1a33') + tree(40, 128, 38, '#1f1a33') + tree(64, 130, 26, '#1f1a33') + tree(98, 126, 32, '#1f1a33') +
    // the fire line and the burning trees
    '<ellipse cx="272" cy="150" rx="118" ry="76" fill="url(#emc-glow)"/>' + tree(246, 152, 70, '#1a1420') + tree(280, 152, 86, '#1a1420') + tree(308, 154, 66, '#1a1420') +
    fire([[268, 120, 30], [292, 104, 28], [248, 116, 22], [306, 128, 22]]) +
    '<path d="M0 152q60-10 130-4t110 2 80-4V200H0z" fill="url(#emc-ground)"/>' +
    fire([[232, 156, 22], [252, 154, 36], [276, 154, 50], [300, 156, 40], [320, 154, 30], [222, 160, 12]]) + embers +
    '<g stroke="#fff3e0" stroke-opacity=".38" stroke-width="1.6" fill="none" stroke-linecap="round"><path d="M300 78q-40-6-80 2"/><path d="M196 94q-36-6-70 0"/><path d="M118 72q-30-4-56 2"/><path d="M60 110q-20-3-40 1"/></g>' +
    // the camp they are running to
    '<path d="M10 200q40-26 110-34t120-4" stroke="#6b5338" stroke-width="12" fill="none" opacity=".55" stroke-linecap="round"/>' +
    '<path d="M0 186q30-8 60-2t50 10v6H0z" fill="#3f8fb8" opacity=".85"/><path d="M10 190h18M50 192h22" stroke="#e0f8ff" stroke-opacity=".5" stroke-linecap="round"/>' +
    '<path d="M24 168l22-32 22 32z" fill="#e8b04a"/><path d="M46 136v32" stroke="#8a5a2b" stroke-width="1.5"/><path d="M39 168l7-11 7 11z" fill="#5a3a1a"/>' +
    '<circle cx="74" cy="156" r="13" fill="url(#emc-glow)" opacity=".7"/><path d="M74 152v-7" stroke="#6b4a2e" stroke-width="1.2"/><rect x="71.5" y="152" width="5" height="7" rx="1.2" fill="#ffd27a"/>' +
    // an owl fleeing ahead of the smoke
    '<path d="M100 67q-14-12-26-6 10 2 14 10zM108 67q14-12 26-6-10 2-14 10z" fill="#8a5f36"/><ellipse cx="104" cy="69" rx="6" ry="8" fill="#a87a4a"/><ellipse cx="104" cy="71" rx="3.6" ry="4.6" fill="#e8d2a6"/>' +
    '<path d="M99.5 62l1-4 2.5 2.5zM108.5 62l-1-4-2.5 2.5z" fill="#a87a4a"/><circle cx="102" cy="65" r="2" fill="#fff8e0"/><circle cx="106" cy="65" r="2" fill="#fff8e0"/><circle cx="102" cy="65" r="1" fill="#1a120c"/><circle cx="106" cy="65" r="1" fill="#1a120c"/><path d="M103.3 67.5h1.4l-.7 1.5z" fill="#e8a23a"/>' +
    // the ranger, running west with the fox in her arms
    '<path d="M156 150l10 20" stroke="#34452a" stroke-width="7" stroke-linecap="round"/><path d="M148 150l-11 18" stroke="#46593a" stroke-width="7" stroke-linecap="round"/><ellipse cx="168" cy="171" rx="5.5" ry="3" fill="#3b2a1e"/><ellipse cx="135" cy="169" rx="5.5" ry="3" fill="#3b2a1e"/>' +
    '<path d="M141 152q-3-22 9-30 12 2 13 14l-2 16z" fill="#3f8f5a"/><path d="M147 124l6 6 5-5" stroke="#e8c14a" stroke-width="2.4" fill="none"/>' +
    '<circle cx="152" cy="113" r="9" fill="#c98a5e"/><path d="M143.5 112q-1-6 3-9" stroke="#3a2416" stroke-width="3" stroke-linecap="round" fill="none"/><circle cx="148" cy="112" r="1.1" fill="#2a1c1a"/><path d="M146.5 117.5h4" stroke="#5a2e20" stroke-width="1.3" stroke-linecap="round"/>' +
    '<ellipse cx="152" cy="106" rx="15" ry="3.4" fill="#8a6a35"/><path d="M144.5 106q0-9 7.5-9t7.5 9z" fill="#b0884a"/><path d="M144.8 103.5h14.4" stroke="#5a3a15" stroke-width="1.8"/>' +
    '<path d="M162 138q11 6 9 21-6-6-13-11z" fill="#e8742a"/><path d="M170 155q2 4-1 5l-3-3z" fill="#fff3e0"/>' +
    '<path d="M130 136q4-10 18-9 12 1 16 9-4 7-16 7t-18-7z" fill="#f08a3a"/><path d="M136 139q12 4 24-1-6 5-12 5t-12-4z" fill="#fff3e0"/>' +
    '<path d="M120 132l2-9 4 4h5l4-4 2 9q-2 6-8.5 6t-8.5-6z" fill="#f08a3a"/><path d="M122.5 134q6 5 12 0q-2 4.5-6 4.5t-6-4.5z" fill="#fff3e0"/><circle cx="125" cy="131" r="1" fill="#1a120c"/><circle cx="131" cy="131" r="1" fill="#1a120c"/><circle cx="128.5" cy="136.5" r="1" fill="#1a120c"/>' +
    '<path d="M146 128q-7 8-11 12" stroke="#3f8f5a" stroke-width="6" stroke-linecap="round"/><path d="M160 132q-6 10-15 12" stroke="#3f8f5a" stroke-width="6" stroke-linecap="round"/><circle cx="134" cy="141" r="3" fill="#c98a5e"/><circle cx="144" cy="145" r="3" fill="#c98a5e"/>' +
    // the firefighter, holding the line with the hose
    '<path d="M208 152l-6 20M216 152l6 20" stroke="#2c2c3a" stroke-width="7" stroke-linecap="round"/><ellipse cx="201" cy="173" rx="5.5" ry="3" fill="#1d1d26"/><ellipse cx="224" cy="173" rx="5.5" ry="3" fill="#1d1d26"/>' +
    '<rect x="195" y="126" width="8" height="21" rx="3" fill="#c0392b"/><path d="M201 154q-2-22 11-30 13 4 12 30z" fill="#f2b233"/><path d="M202 142h21M202 148h21" stroke="#f4f4f4" stroke-width="2" opacity=".85"/>' +
    '<path d="M198 145q-6 14 6 18t26-31" stroke="#7a2a22" stroke-width="2.4" fill="none"/>' +
    '<circle cx="213" cy="114" r="8.5" fill="#8a5636"/><circle cx="216.5" cy="113.5" r="1.1" fill="#1d1412"/><path d="M215 118.5h3.5" stroke="#3a1a14" stroke-width="1.3" stroke-linecap="round"/>' +
    '<path d="M203.5 113q0-12 9.5-12t9.5 12z" fill="#d6402f"/><path d="M202 113h23" stroke="#a02a1f" stroke-width="2.4" stroke-linecap="round"/><path d="M213 101.5v11" stroke="#ff7a5a" stroke-width="1.4"/>' +
    '<path d="M218 130l16-4M214 136l18-6" stroke="#f2b233" stroke-width="6" stroke-linecap="round"/><circle cx="235" cy="126" r="3" fill="#8a5636"/><circle cx="233" cy="130" r="3" fill="#8a5636"/><path d="M235 123l10-2 1 5-10 2z" fill="#3a3a48"/>' +
    '<path d="M246 123q22-16 42 6" stroke="url(#emc-spray)" stroke-width="5" fill="none" stroke-linecap="round" opacity=".9"/><path d="M247 125q18-9 34 8" stroke="#e8fbff" stroke-width="1.6" fill="none" opacity=".7"/>' +
    '<g fill="#e8fbff"><circle cx="284" cy="134" r="1.6"/><circle cx="290" cy="138" r="1.2"/><circle cx="278" cy="139" r="1.3"/><circle cx="292" cy="130" r="1"/></g>' +
    '<g fill="#ece6f4" opacity=".55"><circle cx="288" cy="128" r="8"/><circle cx="298" cy="121" r="6"/><circle cx="279" cy="122" r="5"/></g></svg>';
}

/* ===================== rules ===================== */

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
  hint:()=> 'Rescue animals, carry them home, and protect the villages.',

  /* ---- presentation ---- */
  cover: coverSVG(), defs, placeWord: 'place', eventGlyph: 'wind',
  mood: (s) => `--wx:${[0, 40, 0, -40][s.wind]}px`,
  gauges: (s) => [
    { key: 'animals', label: 'Animals safe', value: `${s.rescued} / 4`, n: s.rescued, art: pawGauge(s) },
    { key: 'safety', label: 'Village protection', value: `${s.safety} / 8`, n: s.safety, art: shieldGauge(s.safety) },
    { key: 'wind', label: 'Next wind', value: ['North ↑', 'East →', 'South ↓', 'West ←'][s.wind], art: vane(s.wind) },
    { key: 'round', label: 'Round', value: `${s.round} / 24`, art: dusk((s.round - 1) / 24) },
  ],
  // Gusts streak across the board in the direction the fire will spread next.
  overlay: (s) => `<div class="coop-windwrap" aria-hidden="true"><div class="coop-windfield" style="--rot:${s.wind * 90}deg">${[8, 21, 33, 46, 58, 70, 83, 94].map((x, k) => `<i style="--x:${x}%;--d:-${(k * .43 + (k % 3) * .9).toFixed(2)}s"></i>`).join('')}</div></div>`,
  place(s, i) {
    const t = s.tiles[i], site = animalSites.indexOf(i), village = i === 12 || i === 15;
    const left = t.fire ? chip('flame', `${t.fire}/3`, t.fire >= 2 ? 'coop-warn' : '') : i === 0 ? chip('bucket', 'Camp', 'coop-ok') : '<span></span>';
    const right = site >= 0 ? (t.animal ? chip('paw', ANIMALS[site], 'coop-gold') : chip('check', '', 'coop-ok')) : village ? chip('shield', '', t.fire >= 3 ? 'coop-warn' : 'coop-ok') : '';
    const label = `${t.name}${site >= 0 ? (t.animal ? `, a ${ANIMALS[site].toLowerCase()} waits for rescue` : ', animal rescued') : ''}${village ? ', a village' : ''}${i === 0 ? ', the camp' : ''}, fire ${t.fire} of 3`;
    return { name: t.name, level: t.fire, marker: site >= 0 && t.animal, chips: [left, right], label, art: tileArt(s, i) };
  },
  pawnMark: (s, p) => p.carry ? `<b class="coop-carry">${glyph('paw')}${p.carry}</b>` : '',
  personal: (s, p, ui) => `<span class="coop-stat">${glyph('pin')}${esc(names[p.pos])}</span><span class="coop-stat${ui.look('water-' + p.id, p.water)}">${glyph('drop')}Water ${p.water}/4</span>` +
    (p.carry ? `<span class="coop-stat">${glyph('paw')}Carrying ${p.carry}</span>` : ''),
});
