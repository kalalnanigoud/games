// Signal from Below: a cooperative mystery aboard a deserted underwater research station.
// Each diver's wrist terminal holds a different archive fragment, so the team must talk.
// Rules, views, bots and the interface come from escape-kit.js.
import { escapeRoom, give, openRoom, escape } from './escape-kit.js';
import { rand, shuffle } from '../js/util.js';

/* ---------------- puzzle data ---------------- */

const BREAKERS = [['Pumps', '▲'], ['Lights', '●'], ['Air', '■'], ['Heat', '◆'], ['Lab wing', '★']];
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const DIR_NAMES = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const PATTERNS = ['SSS', 'SSL', 'SLS', 'SLL', 'LSS', 'LSL', 'LLS', 'LLL'];
const pulseText = (p) => p.split('').map((c) => (c === 'S' ? '•' : '▬')).join(' ');
const ranges = Array.from({ length: 8 }, (_, i) => `${(i + 1) * 100} m`);

function majority(recs) {
  return recs[0].map((_, g) => {
    const seen = recs.map((r) => r[g]);
    return seen.find((p) => seen.filter((x) => x === p).length >= 2);
  });
}

/* ---------------- art ---------------- */

const DEFS = `<defs>
  <linearGradient id="sg-wall" x2="0" y2="1"><stop stop-color="#1c3440"/><stop offset="1" stop-color="#0c1b24"/></linearGradient>
  <linearGradient id="sg-panel" x2="0" y2="1"><stop stop-color="#4f6670"/><stop offset="1" stop-color="#26363e"/></linearGradient>
  <linearGradient id="sg-steel" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#c9d6dc"/><stop offset=".4" stop-color="#7d939c"/><stop offset="1" stop-color="#34464e"/></linearGradient>
  <linearGradient id="sg-sea" x2="0" y2="1"><stop stop-color="#0d4a64"/><stop offset=".55" stop-color="#062a3c"/><stop offset="1" stop-color="#020d16"/></linearGradient>
  <linearGradient id="sg-water" x2="0" y2="1"><stop stop-color="#1d8fa8"/><stop offset="1" stop-color="#063244"/></linearGradient>
  <linearGradient id="sg-yellow" x2="0" y2="1"><stop stop-color="#ffd25a"/><stop offset="1" stop-color="#c47e10"/></linearGradient>
  <linearGradient id="sg-floor" x2="0" y2="1"><stop stop-color="#2b3a40"/><stop offset="1" stop-color="#11191d"/></linearGradient>
  <radialGradient id="sg-screen"><stop stop-color="#1b5a52"/><stop offset="1" stop-color="#03181a"/></radialGradient>
  <radialGradient id="sg-amber"><stop stop-color="#ffb347" stop-opacity=".55"/><stop offset="1" stop-color="#ff8a00" stop-opacity="0"/></radialGradient>
  <radialGradient id="sg-cyan"><stop stop-color="#7ff6ff" stop-opacity=".45"/><stop offset="1" stop-color="#2ad4e8" stop-opacity="0"/></radialGradient>
  <radialGradient id="sg-red"><stop stop-color="#ff4a3a" stop-opacity=".6"/><stop offset="1" stop-color="#ff2a1a" stop-opacity="0"/></radialGradient>
</defs>`;
const rivets = (x, y, w, h) => [[x + 5, y + 5], [x + w - 5, y + 5], [x + 5, y + h - 5], [x + w - 5, y + h - 5]].map(([a, b]) => `<circle cx="${a}" cy="${b}" r="1.8" fill="#a9bcc4" opacity=".7"/>`).join('');
const box = (x, y, w, h, fill = 'url(#sg-panel)') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${fill}" stroke="#0a1418" stroke-width="2.5"/>${rivets(x, y, w, h)}`;
const halo = (x, y, r, c = 'cyan') => `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#sg-${c})"/>`;
function shell() {
  return `${DEFS}<rect width="400" height="250" fill="url(#sg-wall)"/>${Array.from({ length: 9 }, (_, i) => `<path d="M${i * 50} 0V212" stroke="#071116" stroke-width="2" opacity=".7"/><path d="M${i * 50 + 4} 0V212" stroke="#4a6772" stroke-opacity=".25"/>`).join('')}
    <path d="M0 14H400M0 198H400" stroke="#071116" stroke-width="5"/><path d="M0 212H400V250H0Z" fill="url(#sg-floor)"/>${Array.from({ length: 20 }, (_, i) => `<path d="M${i * 20} 212V250" stroke="#0a1114" stroke-width="2"/>`).join('')}`;
}
const dark = (lit) => (lit ? '' : `<rect width="400" height="250" fill="#00060a" opacity=".5"/>${halo(380, 22, 90, 'red')}<circle cx="380" cy="22" r="7" fill="#ff5a4a"/>`);
// Short pulses are dots and long pulses are wide bars, laid out in 20-unit cells.
const pulses = (p, x, y, s = 1, c = '#7ff6ff') => p.split('').map((ch, i) => (ch === 'S' ? `<circle cx="${x + (i * 20 + 8) * s}" cy="${y}" r="${3.6 * s}" fill="${c}"/>` : `<rect x="${x + (i * 20 + 1) * s}" y="${y - 3.2 * s}" width="${15 * s}" height="${6.4 * s}" rx="${3.2 * s}" fill="${c}"/>`)).join('');

function dock(v) {
  const f = v.flags, lit = !!f.power;
  const crate = `${box(30, 150, 72, 60, '#5b4a2c')}<path d="M30 170H102M30 190H102" stroke="#2a2010" stroke-width="2"/><text x="66" y="185" font-size="9" text-anchor="middle" fill="#f2c14e" font-family="monospace" font-weight="700">MERIDIAN</text>${f['took:crate'] ? '<path d="M30 150l10-14h72l-10 14z" fill="#6b5a3a" stroke="#2a2010" stroke-width="2"/>' : ''}`;
  const terminal = `${box(118, 58, 76, 64)}<rect x="126" y="66" width="60" height="40" rx="3" fill="#120c02"/>${halo(156, 86, 50, 'amber')}<text x="156" y="82" font-size="7" text-anchor="middle" fill="#ffb347" font-family="monospace">POWER</text><text x="156" y="92" font-size="7" text-anchor="middle" fill="#ffb347" font-family="monospace">${lit ? 'RESTORED' : 'OFFLINE'}</text><rect x="140" y="110" width="32" height="6" rx="2" fill="#1a262c"/>`;
  const suits = `<path d="M210 44H290" stroke="#8fa3ab" stroke-width="5"/>${[226, 250, 274].map((x, i) => `<path d="M${x} 44v10" stroke="#9ab" stroke-width="3"/>${i === 1 ? `<path d="M${x - 14} 56h28l-4 70h-20z" fill="#d9802a" stroke="#4a2a08" stroke-width="2"/><circle cx="${x}" cy="66" r="9" fill="#9fd8e6" stroke="#2a4a56" stroke-width="2"/>` : `<path d="M${x - 5} 56q5 6 10 0" stroke="#9ab" stroke-width="2" fill="none"/>`}`).join('')}<text x="250" y="146" font-size="7" text-anchor="middle" fill="#9ab" font-family="monospace">DIVE RACK</text>`;
  const hatch = `${box(300, 118, 82, 92)}${f.hatch ? '<rect x="308" y="126" width="66" height="76" rx="4" fill="#061014"/><rect x="318" y="150" width="46" height="30" rx="3" fill="#1a262c" stroke="#3a5560"/><path d="M308 126l-14 8v76l14-8z" fill="url(#sg-steel)"/>' : `<circle cx="341" cy="164" r="22" fill="none" stroke="url(#sg-steel)" stroke-width="6"/><path d="M341 142v44M319 164h44" stroke="#8fa3ab" stroke-width="4"/><path d="M352 130l16 10" stroke="#ff9a3a" stroke-width="3"/><text x="341" y="202" font-size="7" text-anchor="middle" fill="#ffcf6a" font-family="monospace">JAMMED</text>`}`;
  const pool = `<ellipse cx="210" cy="222" rx="74" ry="22" fill="url(#sg-water)" stroke="#5a7480" stroke-width="4"/><path d="M168 216q42-18 84 0" fill="url(#sg-yellow)" stroke="#5a3a08" stroke-width="2"/><circle cx="210" cy="206" r="7" fill="#9fd8e6" stroke="#5a3a08" stroke-width="2"/><path d="M150 228q30-6 60 0t60 0" stroke="#bff" stroke-opacity=".4" fill="none"/>`;
  return `${shell()}${halo(210, 200, 120)}${crate}${terminal}${suits}${hatch}${pool}${dark(lit)}`;
}

function generator(v) {
  const f = v.flags, lit = !!f.power;
  const gen = `${box(20, 40, 150, 170)}<rect x="40" y="58" width="110" height="130" rx="50" fill="url(#sg-steel)" stroke="#0a1418" stroke-width="3"/>${[0, 1, 2, 3].map((i) => `<rect x="52" y="${78 + i * 24}" width="86" height="8" rx="4" fill="${lit ? '#4ff0ff' : '#1b2a30'}"/>`).join('')}${lit ? halo(95, 120, 90) : ''}<path d="M0 60H20M0 190H20M170 70H186M170 180H400" stroke="#2a3a40" stroke-width="10"/>`;
  const socket = `${box(190, 86, 48, 66)}<rect x="202" y="98" width="24" height="40" rx="3" fill="#061014" stroke="#9ab"/>${f.fuse ? '<rect x="206" y="102" width="16" height="32" rx="3" fill="#e8d6a0" stroke="#5a4a20"/><rect x="206" y="102" width="16" height="6" fill="url(#sg-steel)"/><rect x="206" y="128" width="16" height="6" fill="url(#sg-steel)"/>' : ''}<text x="214" y="148" font-size="6" text-anchor="middle" fill="#cde" font-family="monospace">FUSE</text>`;
  const panel = `${box(258, 38, 128, 154)}<text x="322" y="54" font-size="8" text-anchor="middle" fill="#cde" font-family="monospace">BREAKERS</text>${BREAKERS.map(([n, m], i) => `<rect x="${268 + i * 23}" y="64" width="16" height="66" rx="3" fill="#0a1418"/><rect x="${270 + i * 23}" y="${lit ? 68 : 100}" width="12" height="26" rx="2" fill="url(#sg-steel)"/><text x="${276 + i * 23}" y="146" font-size="10" text-anchor="middle" fill="#ffe39a">${m}</text><circle cx="${276 + i * 23}" cy="160" r="4" fill="${lit ? '#5f5' : '#333'}"/>`).join('')}`;
  const clip = `<path d="M218 166v8" stroke="#9ab" stroke-width="2"/><rect x="198" y="172" width="40" height="36" rx="2" fill="#e8e2cf" stroke="#5a5a50"/><rect x="210" y="169" width="16" height="6" rx="1" fill="#8a8a90"/>${[0, 1, 2, 3].map((i) => `<path d="M204 ${182 + i * 6}h${i % 2 ? 22 : 28}" stroke="#333" stroke-opacity=".5" stroke-width="1.6"/>`).join('')}`;
  return `${shell()}${gen}${socket}${panel}${clip}${dark(lit)}`;
}

function comms(v) {
  const recorder = `${box(18, 82, 116, 116)}${[0, 1, 2].map((k) => `<rect x="28" y="${92 + k * 32}" width="96" height="24" rx="3" fill="url(#sg-screen)"/><path d="M32 ${104 + k * 32}q6-8 12 0t12 0 12 0 12 0 12 0 12 0 12 0" stroke="#7ff6ff" fill="none" stroke-width="1.5" opacity=".8"/>`).join('')}<text x="76" y="194" font-size="7" text-anchor="middle" fill="#cde" font-family="monospace">SIGNAL RECORDER</text>`;
  const decoder = `${box(148, 106, 116, 98)}<rect x="160" y="116" width="92" height="26" rx="3" fill="#061014"/><text x="206" y="133" font-size="9" text-anchor="middle" fill="${v.flags.decoded ? '#7f7' : '#7ff6ff'}" font-family="monospace">${v.flags.decoded ? 'DECODED' : '_ _ _ _'}</text>${Array.from({ length: 8 }, (_, i) => `<rect x="${164 + (i % 4) * 21}" y="${150 + Math.floor(i / 4) * 22}" width="16" height="16" rx="3" fill="url(#sg-steel)"/><text x="${172 + (i % 4) * 21}" y="${162 + Math.floor(i / 4) * 22}" font-size="9" text-anchor="middle" fill="#0a1418" font-family="monospace">${i + 1}</text>`).join('')}`;
  const crewlog = `${box(278, 98, 104, 100)}<rect x="288" y="108" width="84" height="56" rx="3" fill="#120c02"/>${halo(330, 136, 50, 'amber')}${[0, 1, 2, 3, 4].map((i) => `<path d="M294 ${118 + i * 9}h${50 + (i * 13) % 22}" stroke="#ffb347" stroke-width="2" opacity=".7"/>`).join('')}<circle cx="330" cy="180" r="9" fill="#0a1418" stroke="#9ab" stroke-width="2"/><path d="M327 175v10l8-5z" fill="#ffb347"/>`;
  const port = `<circle cx="200" cy="50" r="38" fill="url(#sg-sea)" stroke="url(#sg-steel)" stroke-width="8"/>${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => { const a = (i * Math.PI) / 4; return `<circle cx="${(200 + 42 * Math.cos(a)).toFixed(1)}" cy="${(50 + 42 * Math.sin(a)).toFixed(1)}" r="2" fill="#a9bcc4"/>`; }).join('')}<path d="M182 56q10-8 22 0q-12 7-22 0zM204 56l7-5v10z" fill="#5fd8c0" opacity=".85"/><circle cx="214" cy="34" r="2" fill="#bff" opacity=".6"/><circle cx="208" cy="26" r="1.4" fill="#bff" opacity=".6"/>`;
  return `${shell()}${halo(200, 150, 150)}${port}${recorder}${decoder}${crewlog}`;
}

function observation(v) {
  const f = v.flags;
  const dome = `<path d="M0 170V60Q200 -40 400 60V170Z" fill="url(#sg-sea)"/>${Array.from({ length: 5 }, (_, i) => `<path d="M${60 + i * 70} 0L${30 + i * 80} 170" stroke="#bff" stroke-opacity=".05" stroke-width="22"/>`).join('')}
    <path d="M0 170V60Q200 -40 400 60V170" fill="none" stroke="#8fa3ab" stroke-width="10"/>${[100, 200, 300].map((x) => `<path d="M${x} ${x === 200 ? 10 : 24}V170" stroke="#8fa3ab" stroke-width="5"/>`).join('')}
    <path d="M0 160Q120 140 220 156T400 150V170H0Z" fill="#031018"/>
    ${f.rescued ? `<g><path d="M268 40v40" stroke="#bfe" stroke-width="1.5" stroke-dasharray="3 3"/><ellipse cx="268" cy="34" rx="16" ry="10" fill="url(#sg-yellow)" stroke="#5a3a08"/>${halo(268, 34, 40, 'amber')}</g>`
      : `<path d="M300 152L286 120" stroke="#9ab" stroke-width="1.2"/><ellipse cx="286" cy="116" rx="9" ry="6" fill="#c47e10" opacity=".85"/>${halo(286, 116, 26, 'amber')}`}
    <circle cx="70" cy="80" r="1.5" fill="#bff" opacity=".7"/><circle cx="76" cy="68" r="1" fill="#bff" opacity=".6"/><path d="M120 112q14-10 30 0q-16 9-30 0zM150 112l9-6v12z" fill="#2a7a8a" opacity=".55"/>`;
  const sonar = `${box(28, 150, 124, 88)}<circle cx="90" cy="194" r="36" fill="url(#sg-screen)" stroke="#9ab" stroke-width="2"/>${[12, 24, 36].map((r) => `<circle cx="90" cy="194" r="${r}" fill="none" stroke="#3fe0c0" stroke-opacity=".35"/>`).join('')}<path d="M90 158V230M54 194H126" stroke="#3fe0c0" stroke-opacity=".3"/><path d="M90 194L118 172" stroke="#7ff6ff" stroke-width="2" opacity=".7"/>`;
  const winch = `${box(248, 150, 124, 88)}<rect x="260" y="160" width="58" height="30" rx="3" fill="#061014"/><text x="289" y="179" font-size="8" text-anchor="middle" fill="${f.rescued ? '#7f7' : '#ffb347'}" font-family="monospace">${f.rescued ? 'RELEASED' : 'TETHER LOCK'}</text><rect x="330" y="${f.rescued ? 160 : 196}" width="12" height="30" rx="4" fill="url(#sg-yellow)"/><path d="M336 230V164" stroke="#0a1418" stroke-width="4"/><circle cx="276" cy="214" r="9" fill="url(#sg-steel)"/><circle cx="302" cy="214" r="9" fill="url(#sg-steel)"/>`;
  return `${DEFS}<rect width="400" height="250" fill="url(#sg-wall)"/>${dome}<path d="M0 170H400V250H0Z" fill="url(#sg-floor)"/>${sonar}${winch}`;
}

/* ---------------- close-ups ---------------- */

const frame = (inner, bg = '#06141a') => `<svg viewBox="0 0 400 220">${DEFS}<rect width="400" height="220" fill="${bg}"/>${inner}</svg>`;
const closeups = {
  recorder: (v) => frame(`<rect x="10" y="8" width="380" height="204" rx="10" fill="#0b1e24" stroke="#4f6670" stroke-width="4"/>
    ${v.facts.recordings.map((rec, k) => `<text x="22" y="${48 + k * 62}" font-size="11" fill="#cde" font-family="monospace">REC ${'ABC'[k]}</text>
      ${rec.map((p, g) => `<rect x="${72 + g * 78}" y="${26 + k * 62}" width="68" height="38" rx="6" fill="url(#sg-screen)" stroke="#2c6a70"/>${pulses(p, 76 + g * 78, 45 + k * 62)}`).join('')}`).join('')}
    <text x="200" y="208" font-size="9" text-anchor="middle" fill="#7f9aa4" font-family="monospace">• short pulse   ▬ long pulse   · four groups, repeating</text>`),
  sonar: (v) => {
    const { b, ring } = v.facts.sonar, a = (b * Math.PI) / 4 - Math.PI / 2, rr = 11 * (ring + 1);
    const bx = (200 + rr * Math.cos(a)).toFixed(1), by = (120 + rr * Math.sin(a)).toFixed(1);
    return frame(`<circle cx="200" cy="120" r="94" fill="url(#sg-screen)" stroke="url(#sg-steel)" stroke-width="6"/>${Array.from({ length: 8 }, (_, i) => `<circle cx="200" cy="120" r="${11 * (i + 1)}" fill="none" stroke="#3fe0c0" stroke-opacity="${i % 2 ? 0.45 : 0.25}"/>`).join('')}
      ${Array.from({ length: 8 }, (_, i) => { const t = (i * Math.PI) / 4 - Math.PI / 2; return `<path d="M200 120L${(200 + 88 * Math.cos(t)).toFixed(1)} ${(120 + 88 * Math.sin(t)).toFixed(1)}" stroke="#3fe0c0" stroke-opacity=".22"/>`; }).join('')}
      ${[2, 4, 6, 8].map((i) => `<text x="${(200 + 11 * i * 0.72 + 3).toFixed(1)}" y="${(120 + 11 * i * 0.72 + 3).toFixed(1)}" font-size="7" fill="#9fe" font-family="monospace" opacity=".8">${i * 100}</text>`).join('')}
      <path d="M200 4l6 8h-12z" fill="#ffe39a"/><text x="212" y="13" font-size="9" fill="#ffe39a" font-family="monospace">TOP OF SCREEN</text>
      <circle cx="${bx}" cy="${by}" r="6" fill="#ffd25a"/><circle cx="${bx}" cy="${by}" r="11" fill="none" stroke="#ffd25a" stroke-opacity=".6"/>
      <text x="310" y="196" font-size="9" fill="#9fe" font-family="monospace">rings: 100 m</text>`, '#02090c');
  },
  breakers: (v) => frame(`<rect x="20" y="10" width="360" height="200" rx="10" fill="url(#sg-panel)" stroke="#0a1418" stroke-width="4"/>${BREAKERS.map(([n, m], i) => `<rect x="${44 + i * 66}" y="34" width="44" height="110" rx="6" fill="#0a1418"/><rect x="${50 + i * 66}" y="${v.flags.power ? 40 : 92}" width="32" height="46" rx="4" fill="url(#sg-steel)"/>
    <text x="${66 + i * 66}" y="166" font-size="20" text-anchor="middle" fill="#ffe39a">${m}</text><text x="${66 + i * 66}" y="186" font-size="11" text-anchor="middle" fill="#cde" font-family="monospace">${n.toUpperCase()}</text>`).join('')}
    <text x="200" y="204" font-size="9" text-anchor="middle" fill="#9ab" font-family="monospace">${v.flags.fuse ? 'FUSE OK' : 'NO FUSE · PANEL DEAD'}</text>`),
  dome: (v) => frame(`<rect width="400" height="220" fill="url(#sg-sea)"/>${Array.from({ length: 6 }, (_, i) => `<path d="M${40 + i * 70} 0L${10 + i * 80} 220" stroke="#bff" stroke-opacity=".05" stroke-width="30"/>`).join('')}<path d="M0 196Q120 170 230 190T400 182V220H0Z" fill="#020b10"/>
    ${v.flags.rescued ? `${halo(250, 60, 80, 'amber')}<ellipse cx="250" cy="60" rx="30" ry="18" fill="url(#sg-yellow)" stroke="#5a3a08" stroke-width="2"/><circle cx="242" cy="58" r="5" fill="#9fd8e6"/><circle cx="258" cy="58" r="5" fill="#9fd8e6"/>`
      : `<path d="M300 200L280 150" stroke="#9ab" stroke-width="2"/>${halo(280, 144, 50, 'amber')}<ellipse cx="280" cy="144" rx="18" ry="11" fill="#c47e10" stroke="#5a3a08" stroke-width="2"/><circle cx="276" cy="143" r="3" fill="#ffefb0"/>`}
    <path d="M60 120q30-20 64 0q-34 18-64 0zM124 120l18-12v24z" fill="#2a7a8a" opacity=".5"/><path d="M30 60q14-8 28 0q-14 7-28 0z" fill="#5fd8c0" opacity=".5"/>`),
};

/* ---------------- items ---------------- */

const items = {
  crowbar: { name: 'Crowbar', text: 'A short red pry bar from the supply crate. Good for persuading jammed metal.',
    icon: '<path d="M10 34L28 10q3-4 6-1" fill="none" stroke="#d8402c" stroke-width="5" stroke-linecap="round"/><path d="M8 32l-2 4 5-1" stroke="#7d939c" stroke-width="3" fill="none"/>' },
  fuse: { name: 'Power fuse', text: 'A heavy ceramic fuse rated for the main generator. It looks unused.',
    icon: '<rect x="13" y="6" width="14" height="28" rx="3" fill="#e8d6a0" stroke="#5a4a20" stroke-width="1.5"/><rect x="13" y="6" width="14" height="6" fill="#9aaab0"/><rect x="13" y="28" width="14" height="6" fill="#9aaab0"/><path d="M20 14v12" stroke="#c47e10" stroke-width="2"/>' },
};

/* ---------------- cover ---------------- */

// Cover: two divers follow the beacon down a dim station corridor. Its pulses glow along the floor
// and ripple out of the far hatch, under a red emergency lamp. Self-contained "sgc-" ids.
function coverArt() {
  const stop = (o, c, a = 1) => `<stop offset="${o}" stop-color="${c}"${a < 1 ? ` stop-opacity="${a}"` : ''}/>`;
  const f1 = (n) => n.toFixed(1);
  const X = 196, Y = 96; // vanishing point: the far hatch
  const frame = (s) => { const w = 180 * s, h = 118 * s, c = 0.34 * h; return [[X - w + c, Y - h], [X + w - c, Y - h], [X + w, Y - h + c], [X + w, Y + h - c], [X + w - c, Y + h], [X - w + c, Y + h], [X - w, Y + h - c], [X - w, Y - h + c]]; };
  const pts = (list) => list.map(([a, b]) => `${f1(a)},${f1(b)}`).join(' ');
  const S = [1, 0.74, 0.55, 0.41, 0.31, 0.235, 0.18];
  const shade = ['#0a1c28', '#0b2330', '#0d2a38', '#0f3240', '#123a49', '#154553', '#19515f'];
  const ribs = S.map((s, i) => `<polygon points="${pts(frame(s))}" fill="${shade[i]}" stroke="#3a5864" stroke-width="${f1(1 + 5 * s)}" stroke-linejoin="round"/><polygon points="${pts(frame(s * 0.975))}" fill="none" stroke="#7fa0aa" stroke-opacity=".35" stroke-width="${f1(0.4 + 0.8 * s)}" stroke-linejoin="round"/>`).join('');
  const near = frame(1), far = frame(0.18);
  const lerp = (p, q, u) => [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u];
  const grate = Array.from({ length: 9 }, (_, k) => { const a = lerp(near[5], near[4], k / 8), b = lerp(far[5], far[4], k / 8); return `M${f1(a[0])} ${f1(a[1])}L${f1(b[0])} ${f1(b[1])}`; }).join('');
  const floorRibs = S.map((s) => { const q = frame(s); return `<path d="M${f1(q[5][0])} ${f1(q[5][1])}H${f1(q[4][0])}" stroke="#3a5864" stroke-width="${f1(1 + 4 * s)}"/>`; }).join('');
  const taper = (a, b, wa, wb, fill) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), nx = -dy / L, ny = dx / L;
    return `<polygon points="${pts([[a[0] + nx * wa, a[1] + ny * wa], [b[0] + nx * wb, b[1] + ny * wb], [b[0] - nx * wb, b[1] - ny * wb], [a[0] - nx * wa, a[1] - ny * wa]])}" fill="${fill}"/>`; };
  const chamfer = (s, k) => { const q = frame(s); return lerp(q[k], q[k + 1], 0.5); };
  const lights = [[0.74, 0.28], [0.55, 0.07], [0.41, 0.32], [0.31, 0.4]].map(([s, o]) => `<rect x="${f1(X - 26 * s)}" y="${f1(Y - 118 * s + 2 * s)}" width="${f1(52 * s)}" height="${f1(4 * s)}" rx="${f1(2 * s)}" fill="#9ff8ff" opacity="${o}"/>`).join('');
  const trail = [[0.66, 'd'], [0.55, 'l'], [0.465, 'd'], [0.395, 'd'], [0.335, 'l'], [0.285, 'd'], [0.245, 'l']].map(([s, k]) => {
    const y = Y + 112 * s, q = s * 1.6;
    return k === 'd' ? `<ellipse cx="${X}" cy="${f1(y)}" rx="${f1(4 * q)}" ry="${f1(1.6 * q)}"/>` : `<rect x="${f1(X - 7 * q)}" y="${f1(y - 1.6 * q)}" width="${f1(14 * q)}" height="${f1(3.2 * q)}" rx="${f1(1.6 * q)}"/>`;
  }).join('');
  const dots = (list, attrs) => list.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" ${attrs}/>`).join('');
  const glint = (x, y, r, o = 1) => `<path d="M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z" fill="#e8ffff" opacity="${o}"/>`;
  return `<svg viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Two divers follow a glowing signal down a dark underwater station corridor"><defs>
    <radialGradient id="sgc-haze">${stop(0, '#a8ffff', 0.55)}${stop(0.35, '#2ad4e8', 0.2)}${stop(1, '#2ad4e8', 0)}</radialGradient>
    <radialGradient id="sgc-red">${stop(0, '#ff4a4a', 0.62)}${stop(1, '#ff2a2a', 0)}</radialGradient>
    <linearGradient id="sgc-steel" x1="0" y1="0" x2="1" y2="1">${stop(0, '#d6e2e8')}${stop(0.45, '#7d939c')}${stop(1, '#34464e')}</linearGradient>
    <linearGradient id="sgc-floor" x1="0" y1="0" x2="0" y2="1">${stop(0, '#0c1f28')}${stop(1, '#07141a')}</linearGradient>
    <linearGradient id="sgc-suitA" x1="0" y1="0" x2="1" y2="1">${stop(0, '#ffa24f')}${stop(1, '#d9531e')}</linearGradient>
    <linearGradient id="sgc-suitB" x1="0" y1="0" x2="1" y2="1">${stop(0, '#ffe27a')}${stop(1, '#e09a1a')}</linearGradient>
    <radialGradient id="sgc-glass" cx=".35" cy=".3" r=".75">${stop(0, '#eaffff', 0.4)}${stop(0.5, '#7fe8f0', 0.14)}${stop(1, '#0a3a4a', 0.45)}</radialGradient>
    <linearGradient id="sgc-beam" gradientUnits="userSpaceOnUse" x1="152" y1="127" x2="212" y2="86">${stop(0, '#fff4c0', 0.6)}${stop(1, '#fff4c0', 0)}</linearGradient>
    <radialGradient id="sgc-hatch">${stop(0, '#f2ffff')}${stop(0.35, '#8ff6f6')}${stop(0.8, '#1a8f9e')}${stop(1, '#0a3a48')}</radialGradient>
    <radialGradient id="sgc-term">${stop(0, '#9dffd8', 0.8)}${stop(0.45, '#3fe0a1', 0.3)}${stop(1, '#3fe0a1', 0)}</radialGradient>
    <filter id="sgc-blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.5"/></filter></defs>
    <rect width="320" height="200" fill="#061520"/>${ribs}
    <polygon points="${pts([near[5], near[4], far[4], far[5]])}" fill="url(#sgc-floor)" opacity=".9"/>${floorRibs}
    <path d="${grate}" stroke="#040c10" stroke-width="1.2" opacity=".7"/>
    ${lights}
    ${taper(chamfer(1, 1), chamfer(0.18, 1), 6, 1.2, '#2c4752')}${taper([chamfer(1, 1)[0] - 1, chamfer(1, 1)[1] - 3], [chamfer(0.18, 1)[0], chamfer(0.18, 1)[1] - 0.6], 1.2, 0.25, '#7fa0aa')}
    ${taper([chamfer(1, 1)[0] - 6, chamfer(1, 1)[1] + 14], [chamfer(0.18, 1)[0] - 1, chamfer(0.18, 1)[1] + 2.6], 4, 0.8, '#5a1e26')}
    ${taper(chamfer(1, 5), chamfer(0.18, 5), 5, 1, '#2c4752')}
    <text x="67" y="74" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="6" font-weight="700" letter-spacing="1" fill="#7ff6ff" opacity=".55">COMMS</text><path d="M93 70.5l4 2-4 2z" fill="#7ff6ff" opacity=".55"/>
    <circle cx="286" cy="86" r="14" fill="#ff9ad8" opacity=".14" filter="url(#sgc-blur)"/><circle cx="286" cy="86" r="10" fill="#03121c" stroke="url(#sgc-steel)" stroke-width="3.2"/>
    <path d="M282 87q4-6 8 0z" fill="#ff9ad8" opacity=".85"/><path d="M283 87v4M286 87v5M289 87v4" stroke="#ff9ad8" stroke-width=".9" opacity=".7"/><path d="M279.5 80.5a9 9 0 0 1 7-3.5" stroke="#fff" stroke-opacity=".4" stroke-width="1.4" fill="none"/>
    <circle cx="106" cy="40" r="84" fill="url(#sgc-red)"/><circle cx="145" cy="64" r="20" fill="url(#sgc-red)" opacity=".7"/>
    <rect x="99" y="35" width="14" height="9" rx="3" fill="#2a0c10" stroke="#5a1a20"/><ellipse cx="106" cy="40" rx="5" ry="3.2" fill="#ff6a6a"/><ellipse cx="145" cy="64" rx="2.4" ry="1.6" fill="#ff6a6a"/>
    <circle cx="${X}" cy="${Y}" r="130" fill="url(#sgc-haze)"/>
    <circle cx="${X}" cy="${Y}" r="20" fill="url(#sgc-hatch)" stroke="#6f8f9a" stroke-width="3"/>
    <g stroke="#0a3a48" stroke-width="2.2" fill="none" opacity=".75"><circle cx="${X}" cy="${Y}" r="8"/><path d="M${X} ${Y - 10}v20M${X - 10} ${Y}h20"/></g>
    <g fill="none" stroke="#5ff0d0" stroke-linecap="round">${[[30, 2, 0.6], [46, 1.8, 0.45], [66, 1.6, 0.3], [92, 1.4, 0.2], [124, 1.2, 0.12]].map(([r, w, o]) => `<circle cx="${X}" cy="${Y}" r="${r}" stroke-width="${w}" opacity="${o}"/>`).join('')}</g>
    <g fill="#7ff6ff" filter="url(#sgc-blur)" opacity=".85">${trail}</g><g fill="#d8ffff">${trail}</g>
    <polygon points="150.3,124.6 196.3,69 221.7,105 153.7,129.4" fill="url(#sgc-beam)"/><circle cx="206" cy="90" r="16" fill="#fff4c0" opacity=".12" filter="url(#sgc-blur)"/>
    <ellipse cx="196" cy="182" rx="64" ry="6" fill="#7ff6ff" opacity=".08"/>
    <ellipse cx="88" cy="199" rx="38" ry="5" fill="#000" opacity=".4"/>
    <rect x="42" y="146" width="18" height="48" rx="8" fill="url(#sgc-steel)"/><rect x="47" y="140" width="8" height="8" rx="2" fill="#8fa3ab"/>
    <path d="M52 200C52 170 62 150 88 145C114 150 124 170 124 200Z" fill="url(#sgc-suitA)"/><path d="M58 178h60" stroke="#e8f0f2" stroke-width="3.5" opacity=".75"/>
    <rect x="77" y="156" width="22" height="13" rx="3" fill="#24343c" stroke="#0d1a20"/><circle cx="83" cy="162.5" r="1.7" fill="#3fe0a1"/><circle cx="89" cy="162.5" r="1.7" fill="#ffd25a"/><circle cx="95" cy="162.5" r="1.7" fill="#ff5a64"/>
    <ellipse cx="88" cy="143" rx="22" ry="6.5" fill="url(#sgc-steel)" stroke="#34464e"/>
    <circle cx="78.5" cy="121" r="2.8" fill="#cf9168"/><circle cx="90" cy="119" r="13" fill="#e0a57a"/><path d="M77 116q2-14 15-14q11 1 13 11q-8-6-15-4q-7 1-13 7z" fill="#3b2418"/>
    <ellipse cx="94.5" cy="118" rx="1.6" ry="2" fill="#1a1010"/><ellipse cx="101" cy="117.2" rx="1.6" ry="2" fill="#1a1010"/>
    <path d="M95 125q3.5 2.6 7.5-.4" stroke="#7a2e35" stroke-width="1.6" fill="none" stroke-linecap="round"/><circle cx="102.5" cy="121.5" r="2.4" fill="#ff7f8f" opacity=".35"/>
    <circle cx="88" cy="116" r="22" fill="url(#sgc-glass)" stroke="#cfeef2" stroke-width="2.4"/><rect x="82" y="91" width="12" height="5" rx="2" fill="#8fa3ab"/>
    <path d="M72 108q5-12 18-15" stroke="#fff" stroke-opacity=".6" stroke-width="2.6" fill="none" stroke-linecap="round"/><circle cx="104" cy="104" r="1.8" fill="#fff" opacity=".55"/>
    <path d="M104 152C114 148 122 144 128 138L133 145C127 152 118 158 108 162Z" fill="url(#sgc-suitA)"/>
    <g transform="rotate(-36 140 136)"><rect x="128" y="131.5" width="24" height="9" rx="3" fill="url(#sgc-steel)" stroke="#34464e"/><rect x="150" y="129.5" width="5" height="13" rx="1.5" fill="#fff6c8"/></g>
    <circle cx="131" cy="141" r="6" fill="#2a3a44"/>
    <ellipse cx="242" cy="199" rx="32" ry="4.5" fill="#000" opacity=".4"/>
    <rect x="262" y="150" width="15" height="42" rx="6.5" fill="url(#sgc-steel)"/>
    <path d="M214 200C214 176 222 158 240 154C258 158 266 176 266 200Z" fill="url(#sgc-suitB)"/><path d="M218 180h44" stroke="#e8f0f2" stroke-width="3.2" opacity=".75"/>
    <ellipse cx="240" cy="152" rx="18" ry="5.5" fill="url(#sgc-steel)" stroke="#34464e"/>
    <circle cx="249" cy="132.5" r="2.4" fill="#8a5230"/><circle cx="239" cy="131" r="11" fill="#9a5d36"/>
    ${dots([[233, 123, 5], [240, 120.5, 5.5], [246.5, 123.5, 4.6], [240, 113.5, 4]], 'fill="#1d1412"')}
    <ellipse cx="233" cy="132" rx="1.5" ry="1.8" fill="#120a08"/><ellipse cx="239.5" cy="132.5" rx="1.5" ry="1.8" fill="#120a08"/>
    <path d="M232.5 137.5q3.5 2.6 7 0" stroke="#5a1e24" stroke-width="1.4" fill="none" stroke-linecap="round"/><circle cx="230.5" cy="135.5" r="2.2" fill="#ff7f8f" opacity=".35"/>
    <circle cx="240" cy="130" r="18" fill="url(#sgc-glass)" stroke="#cfeef2" stroke-width="2.2"/><path d="M227 122q4-10 14-12" stroke="#fff" stroke-opacity=".55" stroke-width="2.2" fill="none" stroke-linecap="round"/>
    <path d="M234 167Q223 161 220 150" stroke="#f0ae2c" stroke-width="9" stroke-linecap="round" fill="none"/><circle cx="220" cy="148" r="4.6" fill="#2a3a44"/>
    <circle cx="215" cy="146" r="18" fill="url(#sgc-term)"/>
    <rect x="207" y="140" width="16" height="11" rx="2.5" fill="#06221c" stroke="#3fe0a1" stroke-width="1.4"/><rect x="209.5" y="142.5" width="11" height="6" rx="1" fill="#3fe0a1" opacity=".9"/><circle cx="215" cy="145.5" r="1.8" fill="none" stroke="#06221c" stroke-width=".9"/>
    <path d="M204 139q-5 6.5 0 13M199 135q-8 10.5 0 21" stroke="#3fe0a1" stroke-width="1.6" fill="none" stroke-linecap="round" opacity=".7"/>
    ${dots([[108, 88, 2.4], [112, 76, 1.6], [109, 64, 2], [252, 104, 2], [256, 93, 1.4], [253, 84, 1.1]], 'fill="#bff8ff" fill-opacity=".15" stroke="#bff8ff" stroke-width="1"')}
    ${dots([[30, 60, 0.9], [160, 30, 0.7], [270, 40, 0.9], [300, 150, 0.8], [140, 170, 0.7], [20, 120, 0.8], [230, 60, 0.6], [60, 30, 0.7]], 'fill="#dff" opacity=".35"')}
    ${glint(211, 81, 4, 0.9)}${glint(160, 120, 2.6, 0.7)}
  </svg>`;
}

/* ---------------- the station ---------------- */

const frag = (v, id) => v.frags.find((f) => f.id === id && f.data);
const seen = (v, id) => v.seen.includes(id);
const breakerLine = (sec, i) => `${BREAKERS[i][1]} ${BREAKERS[i][0]}: <b>${sec.breakers[i] ? 'ON' : 'OFF'}</b>`;

export default escapeRoom({
  id: 'signal', name: 'Signal from Below',
  description: 'A deserted research station on the sea floor is broadcasting a strange signal. Restore power, compare recordings and decode the message. A cooperative mystery for 1–4 where each diver sees different clues.',
  theme: { accent: '#7fe8f0', glow: '#bff8ff', deep: '#02090c' },
  doneLabel: 'The crew of Meridian Deep is safe',
  fragLabel: 'Your wrist terminal',
  cover: coverArt(),
  css: `/* Meridian Deep: deep teal water, sonar rings and a red emergency glow around the scene. */
    .esc-signal{--accent-2:#ff5a64;--win:#3ee0a1;--ink-on:#032a2e;--acc-soft:rgba(127,232,240,.11);--acc-line:rgba(127,232,240,.4);--acc-line-2:rgba(127,232,240,.18);
      --acc-glow:rgba(90,230,240,.5);--glass-1:rgba(14,46,72,.82);--glass-2:rgba(9,26,50,.9);--item-1:#15507a;--item-2:#0a1e3a}
    .esc-signal .esc-felt{border-color:rgba(127,232,240,.2);background:
      radial-gradient(circle at 94% 104%,transparent 0 58px,rgba(63,224,192,.12) 58px 60px,transparent 60px 112px,rgba(63,224,192,.09) 112px 114px,transparent 114px 166px,rgba(63,224,192,.06) 166px 168px,transparent 168px 220px,rgba(63,224,192,.035) 220px 222px,transparent 222px),
      linear-gradient(104deg,transparent 16%,rgba(170,250,255,.05) 22%,transparent 29%,transparent 52%,rgba(170,250,255,.04) 58%,transparent 65%),
      radial-gradient(1.6px 1.6px at 14% 22%,rgba(200,255,255,.45),transparent 60%),radial-gradient(1.2px 1.2px at 31% 64%,rgba(200,255,255,.35),transparent 60%),
      radial-gradient(1.4px 1.4px at 71% 30%,rgba(200,255,255,.4),transparent 60%),radial-gradient(1.2px 1.2px at 86% 72%,rgba(200,255,255,.35),transparent 60%),
      radial-gradient(1.2px 1.2px at 52% 88%,rgba(200,255,255,.3),transparent 60%),radial-gradient(45% 35% at 0% 0%,rgba(255,70,80,.17),transparent 70%),
      radial-gradient(90% 55% at 50% -12%,rgba(70,210,230,.28),transparent 70%),linear-gradient(180deg,#0b3247 0%,#0a2338 50%,#071628 100%)}
    .esc-signal .esc-scene{border-color:rgba(127,232,240,.45);box-shadow:0 14px 30px rgba(2,4,16,.55),0 0 0 4px rgba(4,14,28,.6),0 0 38px rgba(60,210,230,.14)}
    .esc-signal .esc-val{font-family:ui-monospace,Menlo,Consolas,monospace;color:#8ffcff;text-shadow:0 0 10px rgba(127,246,255,.55);
      background:linear-gradient(180deg,#021318,#072e38);border-color:rgba(63,224,192,.55)}
    .esc-signal .esc-paper{color:#12303a;font-style:normal;background:linear-gradient(170deg,#eef7f9,#cfe2e9);box-shadow:inset 0 0 14px rgba(40,100,120,.25),0 4px 10px rgba(0,0,0,.25)}
    .esc-signal .esc-goal-ic{position:relative;background:radial-gradient(circle at 40% 30%,#e8ffff,#7fe8f0 55%,#2ab8c8)}
    .esc-signal .esc-goal:not(.esc-done) .esc-goal-ic::after{content:'';position:absolute;top:-1px;right:-1px;width:11px;height:11px;border-radius:50%;
      background:#ff5a64;box-shadow:0 0 0 2px #0b2236,0 0 10px #ff5a64;animation:sgBeacon 1.6s ease-in-out infinite}
    @keyframes sgBeacon{50%{opacity:.25}}`,
  intro: {
    title: 'Signal from Below',
    text: [
      '<b>Meridian Deep</b>, a research station 1,200 metres below the surface, went silent four days ago. Since then a single strange signal has repeated every ninety seconds on the emergency channel.',
      'Your team’s submersible has just docked in the station’s moon pool. It is dark and cold, and there is no sign of the crew of four.',
      'On the way down, each diver’s wrist terminal downloaded a different fragment of the station archive. <b>Nobody can see what the others see</b>, so talk to each other, or share fragments to the team journal. Restore power, decode the signal, and find out what happened down here.',
    ],
  },
  opening: 'Your submersible surfaced in the moon pool of Meridian Deep. Only the emergency lights are on.',
  howTo: {
    goal: 'Find out what happened to the crew of Meridian Deep and bring them home. Everyone wins together. There is no time limit, and the clock records how long you took.',
    turn: [
      ['🔦', 'Explore at the same time', 'There are no turns. Tap anything in a room (or its button below the picture) for a close-up. Glowing corners and twinkles show what nobody has examined yet.'],
      ['⌚', 'Read your wrist terminal', 'Each diver holds different archive fragments, listed beside the room. Read them aloud to your team, or press Share to copy one into the team journal.'],
      ['🎒', 'Shared inventory', 'Anything someone picks up is available to the whole team. Open an object and choose an item to use it there.'],
      ['🎛', 'Work the controls', 'Breakers, keypads and winches use dials: set each with ▲ ▼ and confirm. Wrong tries cost nothing.'],
    ],
    tips: [
      'With one player, your terminal holds every fragment. With more, the fragments are dealt out, so no one can solve everything alone.',
      'Hints come in steps: a gentle nudge first, the full answer last. The hint button glows when you seem stuck.',
      'Codes change every game. Computer teammates share their fragments straight away, and only take over a puzzle after the team has been stuck for a while.',
    ],
  },
  rooms: [
    { id: 'dock', name: 'Docking Bay', blurb: 'The moon pool where your submersible surfaced, now lit only by emergency lamps.', art: dock },
    { id: 'gen', name: 'Generator', blurb: 'The station’s power plant. The main generator is silent.', art: generator, open: true },
    { id: 'comms', name: 'Comms Room', blurb: 'Radio and recording equipment. The strange signal was captured here.', art: comms },
    { id: 'obs', name: 'Observation', blurb: 'A glass dome looking out over the trench, with sonar and the capsule winch.', art: observation },
  ],
  items,
  setup(s) {
    let breakers;
    do breakers = BREAKERS.map(() => rand(2) === 1); while (breakers.filter(Boolean).length < 2 || breakers.every(Boolean));
    const book = shuffle(PATTERNS.slice());
    const code = Array.from({ length: 4 }, () => 1 + rand(8));
    const truth = code.map((d) => book[d - 1]);
    const broken = shuffle([0, 1, 2, 3]).slice(0, 3);
    const recordings = broken.map((g) => truth.map((p, i) => (i === g ? shuffle(PATTERNS.filter((x) => x !== p))[0] : p)));
    s.secret = { breakers, book, code, recordings, sonar: { b: rand(8), ring: 2 + rand(6) }, offset: 1 + rand(7) };
  },
  facts: (s) => ({ recordings: s.secret.recordings, sonar: s.secret.sonar }),
  fragments: [
    { id: 'sheetA', title: 'Restart sheet · page 1',
      text: (sec) => `<b>MAIN POWER RESTART</b><br>1. Fit a working fuse in the generator socket.<br>2. Set the first breakers:<br>${[0, 1, 2].map((i) => breakerLine(sec, i)).join('<br>')}<br><i>(continued on page 2)</i>`,
      data: (sec) => ({ 0: sec.breakers[0], 1: sec.breakers[1], 2: sec.breakers[2] }) },
    { id: 'sheetB', title: 'Restart sheet · page 2',
      text: (sec) => `<i>(continued from page 1)</i><br>${[3, 4].map((i) => breakerLine(sec, i)).join('<br>')}<br>3. Confirm the panel. Never restart with every breaker on: the flooded section will short the grid.`,
      data: (sec) => ({ 3: sec.breakers[3], 4: sec.breakers[4] }) },
    { id: 'codebook', title: 'Pulse codebook',
      text: (sec) => `<b>BEACON PULSE CODE</b> · • short ▬ long<br>${sec.book.map((p, i) => `${i + 1} = ${pulseText(p)}`).join('<br>')}`,
      data: (sec) => ({ book: sec.book }) },
    { id: 'calib', title: 'Sonar calibration note',
      text: (sec) => `<b>MAINTENANCE NOTE</b><br>The quake knocked the sonar housing out of true. Until it is realigned, the <b>top of the sonar screen points ${DIR_NAMES[sec.offset].toUpperCase()}</b>, not north. Turn every bearing on screen to match.`,
      data: (sec) => ({ offset: sec.offset }) },
  ],
  objects: [
    /* Docking bay */
    { id: 'terminal', room: 'dock', name: 'Station terminal', hot: [116, 54, 80, 70],
      look: (v) => ({ text: `<div class="esc-wrist">MERIDIAN DEEP · DEPTH 1,200 M<br>MAIN POWER: <b>${v.flags.power ? 'RESTORED' : 'OFFLINE'}</b><br>CREW ON BOARD: <b>0 of 4</b><br>EMERGENCY BEACON: transmitting on loop<br>&gt; Restore power in the GENERATOR room. Restart procedure was sent to visiting divers’ terminals.</div>` }),
      clue: () => 'Main power is offline. The restart procedure is on the divers’ wrist terminals. Crew on board: none.' },
    { id: 'crate', room: 'dock', name: 'Supply crate', hot: [28, 134, 78, 80],
      look: (v) => ({ text: v.flags['took:crate'] ? '<p>Ration packs, a spare torch with a dead battery, and an empty crowbar clip.</p>' : '<p>Ration packs, a dead torch, and a red <b>crowbar</b> clipped inside the lid.</p>' }),
      take: { item: 'crowbar', label: 'Take the crowbar', msg: (p) => `${p.name} took a crowbar from the supply crate.` } },
    { id: 'hatch', room: 'dock', name: 'Jammed maintenance hatch', hot: [296, 114, 90, 98],
      look: (v) => ({ text: v.flags.hatch ? '<p>The hatch hangs open. The spares locker behind it is empty now.</p>' : '<p>A maintenance hatch stencilled <i>SPARES · ELECTRICAL</i>. The quake bent its frame and the wheel won’t turn.</p>' }),
      use: [{ item: 'crowbar', flag: 'hatch', msg: (p) => `${p.name} pried the jammed hatch open and found a power fuse.`, effect: (s) => give(s, 'fuse') }] },
    { id: 'suits', room: 'dock', name: 'Dive rack', hot: [206, 36, 88, 114],
      look: () => ({ text: '<p>Three hooks and a single orange suit, tagged <i>DR. A. OKAFOR</i>. Its helmet is dry. Wherever the crew went, they didn’t swim there.</p>' }),
      clue: () => 'Dr. Okafor’s dive suit is still here and dry. The crew didn’t swim out.' },
    { id: 'pool', room: 'dock', name: 'Moon pool', hot: [134, 196, 152, 50],
      look: () => ({ text: '<p>Your submersible bobs in the moon pool, its lights rippling across the ceiling. The water is very cold and very deep.</p>' }) },

    /* Generator */
    { id: 'socket', room: 'gen', name: 'Fuse socket', hot: [186, 82, 56, 74],
      look: (v) => ({ text: v.flags.fuse ? '<p>The new fuse sits snugly in its clips.</p>' : '<p>The fuse socket is empty. A burnt-out fuse lies in pieces on the floor.</p>' }),
      use: [{ item: 'fuse', flag: 'fuse', msg: (p) => `${p.name} fitted the new fuse into the generator socket.` }] },
    { id: 'breakers', room: 'gen', name: 'Breaker panel', hot: [254, 34, 136, 162],
      look: (v) => ({ art: closeups.breakers(v), text: v.flags.power ? '<p>Every indicator is green. The station hums with power.</p>' : '<p>Five heavy breakers, each marked with a symbol. The restart sheet says how each one must be set.</p>' }),
      lock: { slots: BREAKERS.map(() => ['OFF', 'ON']), labels: BREAKERS.map(([n, m]) => `${m} ${n}`), flag: 'power', verb: 'Restart the generator',
        when: (s) => !!s.flags.fuse, notYet: 'The panel is dead. The fuse socket next to it is empty.',
        check: (sec, val) => sec.breakers.every((on, i) => val[i] === (on ? 1 : 0)), format: (val) => val.map((x, i) => `${BREAKERS[i][0]} ${x ? 'on' : 'off'}`).join(', '),
        msg: (p) => `${p.name} restarted the generator! Lights flicker on, and the comms room door hisses open.`, effect: (s) => openRoom(s, 'comms'),
        solve: (v) => { const a = frag(v, 'sheetA'), b = frag(v, 'sheetB'); return a && b ? BREAKERS.map((_, i) => ({ ...a.data, ...b.data })[i] ? 1 : 0) : null; } } },
    { id: 'generator', room: 'gen', name: 'Main generator', hot: [18, 36, 156, 176],
      look: (v) => ({ text: v.flags.power ? '<p>The generator thrums steadily. Warm air starts flowing through the vents.</p>' : '<p>Silent and cold. A warning plate reads: <i>Restart only by the procedure. Fuse first, then breakers.</i></p>' }) },
    { id: 'clipboard', room: 'gen', name: 'Engineer’s clipboard', hot: [192, 162, 52, 50],
      look: () => ({ text: '<span class="esc-paper">Day 2 — Quake! Lab wing flooding. Generator tripped and the main fuse blew. Spares are behind the maintenance hatch in the docking bay. Restart sheet sent to everyone’s terminals, half a sheet each, because the uplink is a mess. — Okafor</span>' }),
      clue: () => 'The main fuse blew; spares are behind the maintenance hatch in the docking bay. The restart sheet is split across the divers’ terminals.' },

    /* Comms */
    { id: 'recorder', room: 'comms', name: 'Signal recorder', hot: [16, 78, 120, 122],
      look: (v) => ({ art: closeups.recorder(v), text: '<p>Three recordings of the same repeating signal. Interference garbled a different part of each one.</p>' }),
      clue: () => 'Three recordings (A, B, C) of the signal, four pulse groups each. Interference spoiled a different group in each recording.' },
    { id: 'decoder', room: 'comms', name: 'Decoder console', hot: [146, 102, 120, 104],
      look: (v) => ({ text: v.flags.decoded ? '<div class="esc-wrist">MESSAGE DECODED:<br>“THIS IS CAPTAIN REYES. ALL FOUR CREW IN ESCAPE CAPSULE. TETHER WINCH JAMMED. WE ARE PINNED TO THE SEABED. OBSERVATION DECK UNLOCKED FOR RESCUE. PLEASE HURRY.”</div>' : '<p>A keypad with the digits 1 to 8. The screen asks for the beacon’s four-digit code.</p>' }),
      lock: { slots: [0, 1, 2, 3].map(() => Array.from({ length: 8 }, (_, i) => String(i + 1))), flag: 'decoded', verb: 'Decode',
        check: (sec, val) => val.every((x, i) => x + 1 === sec.code[i]), format: (val) => val.map((x) => x + 1).join(''),
        msg: (p, c) => `${p.name} entered ${c}. The signal is Captain Reyes: the crew are alive in the escape capsule! The observation deck unlocks.`, effect: (s) => openRoom(s, 'obs'),
        solve: (v) => { const book = frag(v, 'codebook')?.data.book; return book && seen(v, 'recorder') ? majority(v.facts.recordings).map((p) => book.indexOf(p)) : null; } } },
    { id: 'crewlog', room: 'comms', name: 'Crew audio log', hot: [276, 94, 108, 106],
      look: () => ({ text: '<span class="esc-paper"><b>Day 1 · Captain Reyes:</b> The deep probe picked up rhythmic echoes from the trench. Probably geology. Probably.</span><span class="esc-paper"><b>Day 2 · Reyes:</b> Quake. The lab wing is flooding. Everyone into the escape capsule, now.</span><span class="esc-paper"><b>Day 3 · Dr. Okafor:</b> The capsule launched but the tether winch jammed. We’re pinned to the seabed. I’ve set the beacon to loop a coded message.</span>' }),
      clue: () => 'The crew escaped the flooding in the escape capsule, but its tether jammed. Their beacon loops a coded message.' },
    { id: 'porthole', room: 'comms', name: 'Porthole', hot: [158, 8, 84, 84],
      look: () => ({ text: '<p>Something pale and long glides past the glass, too slowly to be a fish you know. Then it’s gone.</p>' }) },

    /* Observation */
    { id: 'sonar', room: 'obs', name: 'Sonar screen', hot: [26, 146, 128, 94],
      look: (v) => ({ art: closeups.sonar(v), text: '<p>A single strong contact: the size of an escape capsule. Each ring is 100 metres.</p>' }),
      clue: () => 'One contact on the sonar, the size of an escape capsule. Each ring is 100 m.' },
    { id: 'winch', room: 'obs', name: 'Capsule winch', hot: [246, 146, 128, 94],
      look: () => ({ text: '<p>The tether winch control. To release a jammed capsule it needs the capsule’s true compass bearing and distance from the station.</p>' }),
      lock: { slots: [DIRS, ranges], labels: ['Bearing', 'Distance'], flag: 'rescued', verb: 'Release the tether',
        check: (sec, val) => val[0] === (sec.sonar.b + sec.offset) % 8 && val[1] === sec.sonar.ring, format: (val) => `${DIRS[val[0]]}, ${ranges[val[1]]}`,
        msg: (p, t) => `${p.name} released the tether at ${t}. The capsule is rising!`,
        effect: (s) => escape(s, 'The escape capsule rose towards the surface with all four crew aboard, and your submersible followed it up.'),
        solve: (v) => { const c = frag(v, 'calib'); return c && seen(v, 'sonar') ? [(v.facts.sonar.b + c.data.offset) % 8, v.facts.sonar.ring] : null; } } },
    { id: 'dome', room: 'obs', name: 'Observation dome', hot: [120, 18, 200, 112],
      look: (v) => ({ art: closeups.dome(v), text: '<p>Far out in the dark, a small amber light blinks on the seabed, on and off, in a rhythm.</p>' }) },
  ],
  objectives: [
    { id: 'fuse', label: 'Fit a new fuse in the generator', done: (s) => !!s.flags.fuse,
      hints: [() => 'The fuse socket in the generator room is empty. The engineer’s clipboard there says where the spares are.', () => 'Take the crowbar from the supply crate in the docking bay, use it on the jammed maintenance hatch, then use the fuse on the generator’s fuse socket.'] },
    { id: 'power', label: 'Restore main power', done: (s) => !!s.flags.power,
      hints: [() => 'The breaker settings are split across your wrist terminals: page 1 and page 2 of the restart sheet. Tell each other what yours says.', () => 'Page 1 covers Pumps, Lights and Air. Page 2 covers Heat and the Lab wing. Press Share on a page to copy it to the journal.',
        (s) => `Set the breakers: ${BREAKERS.map(([n], i) => `${n} <b>${s.secret.breakers[i] ? 'ON' : 'OFF'}</b>`).join(', ')}.`] },
    { id: 'decode', label: 'Decode the repeating signal', done: (s) => !!s.flags.decoded,
      hints: [() => 'Compare the three recordings on the signal recorder. Interference garbled a different group in each one.', () => 'For each of the four groups, trust the pattern that appears in at least two recordings. Then translate it with the pulse codebook, which is on someone’s wrist terminal.',
        (s) => `The decoder code is <b>${s.secret.code.join('')}</b>.`] },
    { id: 'rescue', label: 'Free the crew’s capsule', done: (s) => !!s.flags.rescued,
      hints: [() => 'The sonar screen on the observation deck shows the capsule. Count rings for the distance.', () => 'The sonar screen isn’t aligned to north. Someone’s wrist terminal has the calibration note: rotate the bearing you see so the screen’s top points the way the note says.',
        (s) => `Set the winch to <b>${DIRS[(s.secret.sonar.b + s.secret.offset) % 8]}, ${ranges[s.secret.sonar.ring]}</b>.`] },
  ],
  ending: (v) => ({
    title: 'The crew is coming home',
    art: closeups.dome(v),
    text: [
      'With a shudder the tether lets go, and the amber light lifts off the seabed. Through the dome you watch the escape capsule climb past the station, Captain Reyes waving through its tiny window. Your submersible follows it all the way up into daylight.',
      '“We spent three days listening to that beacon and hoping,” Dr. Okafor tells you on the boat. “But I keep thinking about the echoes the probe heard on day one.” She nods at the ship’s sonar. Far below, faint and slow, something in the trench is still answering the signal.',
    ],
  }),
});
