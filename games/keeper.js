// The Missing Keeper: a cooperative escape room in an abandoned clocktower.
// Rooms, puzzles and art live here; rules, views, bots and the interface come from escape-kit.js.
import { escapeRoom, give, openRoom, escape } from './escape-kit.js';
import { rand, shuffle } from '../js/util.js';

/* ---------------- puzzle helpers ---------------- */

const NUMERALS = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
const roman = (n) => NUMERALS.reduce((out, [v, l]) => { while (n >= v) { out += l; n -= v; } return out; }, '');
const unroman = (r) => { let n = 0, i = 0; for (const [v, l] of NUMERALS) while (r.startsWith(l, i)) { n += v; i += l.length; } return n; };
const WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const SYMS = ['Sun', 'Moon', 'Star', 'Bell', 'Key', 'Feather'];
const GLASS = ['#f0b43c', '#7fa8e8', '#f5e27a', '#d97a4a', '#9be0c0', '#c792e6'];
const pad = (m) => String(m).padStart(2, '0');

// Six engraved symbols, drawn as paths so they read clearly at any size.
function sym(i, x, y, r, fill, stroke = '#2a1806') {
  const st = `fill="${fill}" stroke="${stroke}" stroke-width="${Math.max(1, r * 0.08)}" stroke-linejoin="round"`;
  const P = (a, b) => `${(x + a * r).toFixed(1)} ${(y + b * r).toFixed(1)}`;
  if (i === 0) return `<g>${Array.from({ length: 8 }, (_, k) => { const a = (k * Math.PI) / 4; return `<path d="M${P(Math.cos(a) * 0.62, Math.sin(a) * 0.62)}L${P(Math.cos(a) * 0.98, Math.sin(a) * 0.98)}" stroke="${fill}" stroke-width="${r * 0.16}" stroke-linecap="round"/>`; }).join('')}<circle cx="${x}" cy="${y}" r="${r * 0.46}" ${st}/></g>`;
  if (i === 1) return `<path d="M${P(0.35, -0.8)}A${r * 0.85} ${r * 0.85} 0 1 0 ${P(0.35, 0.8)}A${r * 0.68} ${r * 0.68} 0 0 1 ${P(0.35, -0.8)}Z" ${st}/>`;
  if (i === 2) return `<polygon points="${Array.from({ length: 10 }, (_, k) => { const a = -Math.PI / 2 + (k * Math.PI) / 5, rr = k % 2 ? 0.4 : 0.96; return P(Math.cos(a) * rr, Math.sin(a) * rr).replace(' ', ','); }).join(' ')}" ${st}/>`;
  if (i === 3) return `<g><path d="M${P(-0.62, 0.48)}Q${P(-0.6, -0.78)} ${P(0, -0.82)}Q${P(0.6, -0.78)} ${P(0.62, 0.48)}L${P(0.84, 0.62)}H${(x - 0.84 * r).toFixed(1)}Z" ${st}/><circle cx="${x}" cy="${y + r * 0.78}" r="${r * 0.17}" ${st}/></g>`;
  if (i === 4) return `<g><circle cx="${x - r * 0.5}" cy="${y}" r="${r * 0.38}" ${st}/><circle cx="${x - r * 0.5}" cy="${y}" r="${r * 0.14}" fill="${stroke}"/><path d="M${P(-0.14, -0.1)}H${(x + r * 0.95).toFixed(1)}V${(y + r * 0.1).toFixed(1)}H${(x + r * 0.8).toFixed(1)}V${(y + r * 0.42).toFixed(1)}H${(x + r * 0.62).toFixed(1)}V${(y + r * 0.1).toFixed(1)}H${(x + r * 0.45).toFixed(1)}V${(y + r * 0.32).toFixed(1)}H${(x + r * 0.3).toFixed(1)}V${(y + r * 0.1).toFixed(1)}H${(x - r * 0.14).toFixed(1)}Z" ${st}/></g>`;
  return `<g><path d="M${P(-0.72, 0.82)}Q${P(-0.62, -0.42)} ${P(0.78, -0.88)}Q${P(0.5, 0.42)} ${P(-0.72, 0.82)}Z" ${st}/><path d="M${P(-0.72, 0.82)}L${P(0.5, -0.55)}" stroke="${stroke}" stroke-width="${r * 0.08}"/></g>`;
}
const symOption = (i) => `<span class="kp-opt"><svg viewBox="-20 -20 40 40">${sym(i, 0, 0, 17, GLASS[i])}</svg><small>${SYMS[i]}</small></span>`;

function gear(cx, cy, r, n, fill, cls = '') {
  const pts = [];
  for (let i = 0; i < n * 4; i++) {
    const a = (i / (n * 4)) * Math.PI * 2, rr = i % 4 < 2 ? r : r * 0.82;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`);
  }
  const spokes = [0, 1, 2, 3].map((k) => { const a = (k * Math.PI) / 2 + 0.4; return `<path d="M${cx} ${cy}L${(cx + r * 0.62 * Math.cos(a)).toFixed(1)} ${(cy + r * 0.62 * Math.sin(a)).toFixed(1)}" stroke="#3b2510" stroke-width="${r * 0.12}" stroke-linecap="round"/>`; }).join('');
  return `<g class="${cls}" style="transform-origin:${cx}px ${cy}px"><polygon points="${pts.join(' ')}" fill="${fill}" stroke="#2a1a0a" stroke-width="1.5"/><circle cx="${cx}" cy="${cy}" r="${r * 0.66}" fill="#00000030"/>${spokes}<circle cx="${cx}" cy="${cy}" r="${r * 0.66}" fill="none" stroke="#fff3" stroke-width="1"/><circle cx="${cx}" cy="${cy}" r="${r * 0.18}" fill="#3b2510" stroke="#d9b56a" stroke-width="1"/></g>`;
}

function tally(n, x, y, scale = 1) {
  let out = '';
  for (let g = 0; g < Math.ceil(n / 5); g++) {
    const left = n - g * 5, gx = x + (g % 5) * 30 * scale, gy = y + Math.floor(g / 5) * 34 * scale;
    for (let k = 0; k < Math.min(4, left); k++) out += `<path d="M${gx + k * 6 * scale} ${gy}l${scale} ${24 * scale}" stroke="#f3efe3" stroke-width="${2.4 * scale}" stroke-linecap="round" opacity=".92"/>`;
    if (left >= 5) out += `<path d="M${gx - 3 * scale} ${gy + 20 * scale}L${gx + 23 * scale} ${gy + 4 * scale}" stroke="#f3efe3" stroke-width="${2.4 * scale}" stroke-linecap="round" opacity=".92"/>`;
  }
  return out;
}

/* ---------------- art ---------------- */

const DEFS = `<defs>
  <linearGradient id="kp-plank" x2="1"><stop stop-color="#3b2414"/><stop offset=".5" stop-color="#5a3820"/><stop offset="1" stop-color="#3b2414"/></linearGradient>
  <linearGradient id="kp-wall" x2="0" y2="1"><stop stop-color="#2a1a10"/><stop offset="1" stop-color="#4a2f1c"/></linearGradient>
  <linearGradient id="kp-floor" x2="0" y2="1"><stop stop-color="#5b3a22"/><stop offset="1" stop-color="#2a170b"/></linearGradient>
  <linearGradient id="kp-wood" x2="0" y2="1"><stop stop-color="#8a5a32"/><stop offset="1" stop-color="#4c2e17"/></linearGradient>
  <linearGradient id="kp-brass" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff0b0"/><stop offset=".35" stop-color="#e0b04c"/><stop offset="1" stop-color="#7a5212"/></linearGradient>
  <linearGradient id="kp-iron" x2="0" y2="1"><stop stop-color="#6a6a70"/><stop offset="1" stop-color="#2c2c32"/></linearGradient>
  <linearGradient id="kp-green" x2="0" y2="1"><stop stop-color="#1c3328"/><stop offset="1" stop-color="#2c4a36"/></linearGradient>
  <linearGradient id="kp-night" x2="0" y2="1"><stop stop-color="#0d1430"/><stop offset="1" stop-color="#2b3560"/></linearGradient>
  <radialGradient id="kp-candle"><stop stop-color="#ffd890" stop-opacity=".55"/><stop offset="1" stop-color="#ffb040" stop-opacity="0"/></radialGradient>
  <radialGradient id="kp-face"><stop stop-color="#fff6d8"/><stop offset=".75" stop-color="#e9d6a0"/><stop offset="1" stop-color="#b08a48"/></radialGradient>
  <radialGradient id="kp-bronze" cx=".35" cy=".3"><stop stop-color="#e8c27a"/><stop offset=".5" stop-color="#9a6a2a"/><stop offset="1" stop-color="#3e2a10"/></radialGradient>
  <linearGradient id="kp-paper" x2="0" y2="1"><stop stop-color="#f7ecd2"/><stop offset="1" stop-color="#dcc592"/></linearGradient>
</defs>`;
const planks = (from = 0, to = 400, y1 = 0, y2 = 210) => Array.from({ length: Math.ceil((to - from) / 26) }, (_, i) => `<path d="M${from + i * 26} ${y1}V${y2}" stroke="#1a0d05" stroke-opacity=".45"/>`).join('');
const glow = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#kp-candle)"/>`;
const candle = (x, y) => `${glow(x, y - 10, 46)}<rect x="${x - 4}" y="${y - 8}" width="8" height="16" rx="2" fill="#f3e6c4"/><path d="M${x} ${y - 18}q4 5 0 9q-4-4 0-9z" fill="#ffd36a"/><rect x="${x - 8}" y="${y + 7}" width="16" height="4" rx="2" fill="url(#kp-brass)"/>`;

function workshop(v) {
  const f = v.flags;
  const door = `<path d="M14 218V92Q45 52 76 92V218Z" fill="url(#kp-wood)" stroke="#1d0f06" stroke-width="3"/>${[0, 1, 2].map((i) => `<path d="M${22 + i * 18} 80V214" stroke="#2a170a" stroke-width="2" opacity=".6"/>`).join('')}
    <path d="M14 120H76M14 186H76" stroke="#5c5c64" stroke-width="7"/><circle cx="62" cy="152" r="6" fill="none" stroke="url(#kp-brass)" stroke-width="3"/><rect x="38" y="96" width="14" height="8" rx="2" fill="url(#kp-brass)"/>`;
  const rack = `<rect x="88" y="42" width="54" height="78" rx="3" fill="#6b4a2c" stroke="#2a170a" stroke-width="2"/>${Array.from({ length: 24 }, (_, i) => `<circle cx="${94 + (i % 6) * 9}" cy="${50 + Math.floor(i / 6) * 18}" r="1.3" fill="#2a170a"/>`).join('')}
    <path d="M96 52v36" stroke="#5c5c64" stroke-width="3"/><rect x="91" y="48" width="12" height="8" rx="1" fill="url(#kp-iron)"/>
    <path d="M110 50l6 34M116 50l-6 34" stroke="#8a8a90" stroke-width="2"/><circle cx="113" cy="50" r="3" fill="none" stroke="#8a8a90" stroke-width="2"/>
    ${f['took:rack'] ? '<path d="M122 92h14l-2 22h-10z" fill="none" stroke="#2a170a" stroke-dasharray="3 2"/>' : '<path d="M122 92h14l-2 22h-10z" fill="#b84a2c" stroke="#3a1508" stroke-width="1.5"/><path d="M136 96l8-10" stroke="#9a9aa0" stroke-width="3" stroke-linecap="round"/><rect x="125" y="88" width="8" height="5" rx="1" fill="#2a170a"/>'}`;
  const painting = `<rect x="150" y="36" width="84" height="70" rx="3" fill="url(#kp-brass)" stroke="#4a3008" stroke-width="2"/><rect x="157" y="42" width="70" height="52" fill="#2b3560"/><rect x="157" y="72" width="70" height="22" fill="#3b4a3a"/>
    <path d="M186 94V58l6-8 6 8v36z" fill="#4c3a2c" stroke="#1d140c"/><circle cx="192" cy="64" r="4" fill="#f6e7b8"/><path d="M180 58h24" stroke="#1d140c" stroke-width="2"/>
    <circle cx="214" cy="50" r="4" fill="#f6efc8"/><rect x="170" y="97" width="44" height="7" rx="1" fill="#e9d6a0" stroke="#6a4a14" stroke-width=".8"/><text x="192" y="102.6" font-size="4.6" text-anchor="middle" fill="#3b2a17" font-family="Georgia">RAISED ${v.facts.roman}</text>`;
  const clip = `<g transform="rotate(4 268 74)"><rect x="248" y="46" width="40" height="54" fill="url(#kp-paper)" stroke="#8a6a3a"/><rect x="252" y="51" width="32" height="6" fill="#3b2a17" opacity=".75"/>${[0, 1, 2, 3, 4, 5].map((i) => `<path d="M252 ${63 + i * 6}h${i % 2 ? 26 : 32}" stroke="#3b2a17" stroke-opacity=".45" stroke-width="2"/>`).join('')}</g><circle cx="268" cy="47" r="2.5" fill="#c33"/>`;
  const bench = `<rect x="80" y="152" width="160" height="10" rx="2" fill="url(#kp-wood)" stroke="#2a170a" stroke-width="2"/><path d="M88 162v46M232 162v46M84 196h152" stroke="#4c2e17" stroke-width="7"/>
    <g transform="rotate(-6 118 146)"><rect x="98" y="139" width="40" height="14" fill="url(#kp-paper)" stroke="#8a6a3a"/><path d="M102 144h30M102 148h22" stroke="#3b2a17" stroke-opacity=".5"/></g>${candle(146, 142)}`;
  const box = f.toolbox
    ? `<rect x="170" y="128" width="52" height="24" rx="2" fill="#52565e" stroke="#1d1d22" stroke-width="2"/><path d="M170 128l6-20h52l-6 20z" fill="#3a3c42" stroke="#1d1d22" stroke-width="2"/><rect x="174" y="131" width="44" height="6" fill="#1d1d22"/>`
    : `<rect x="170" y="124" width="52" height="28" rx="2" fill="url(#kp-iron)" stroke="#1d1d22" stroke-width="2"/><path d="M170 132h52" stroke="#1d1d22" stroke-width="2"/><rect x="186" y="126" width="20" height="12" rx="2" fill="url(#kp-brass)" stroke="#4a3008"/>${[0, 1, 2, 3].map((i) => `<rect x="${188 + i * 4.4}" y="129" width="3.4" height="6" fill="#3b2510"/>`).join('')}`;
  const stairs = `${Array.from({ length: 7 }, (_, i) => `<path d="M${296 + i * 14} ${214 - i * 15}h${110 - i * 14}v15h-${110 - i * 14}z" fill="${i % 2 ? '#5b3a22' : '#4a2f1c'}" stroke="#1d0f06"/>`).join('')}
    <rect x="320" y="28" width="60" height="88" rx="4" fill="#20140b" stroke="#1d0f06" stroke-width="3"/>
    ${f.stairs ? `<rect x="324" y="32" width="52" height="84" fill="#f1c36a" opacity=".55"/>${glow(350, 80, 60)}<path d="M324 32l-14 6v84l14-6z" fill="url(#kp-wood)"/>` : `<rect x="324" y="32" width="52" height="84" rx="2" fill="url(#kp-wood)"/><path d="M324 60h52M324 90h52" stroke="#2a170a" stroke-width="2"/><circle cx="368" cy="76" r="4" fill="url(#kp-brass)"/><path d="M368 79v6" stroke="#1d0f06" stroke-width="2"/>`}`;
  return `${DEFS}<rect width="400" height="250" fill="url(#kp-wall)"/>${planks(0, 300)}<path d="M0 208H400V250H0Z" fill="url(#kp-floor)"/>${[0, 1, 2].map((i) => `<path d="M0 ${216 + i * 12}H400" stroke="#1a0d05" stroke-opacity=".5"/>`).join('')}
    ${glow(190, 70, 120)}${door}${rack}${painting}${clip}${bench}${box}${stairs}<path d="M0 0H400V10H0Z" fill="#1d0f06"/>`;
}

function study(v) {
  const f = v.flags;
  const books = Array.from({ length: 4 }, (_, row) => Array.from({ length: 9 }, (_, k) => {
    const special = row === 2 && k >= 2 && k < 6;
    const c = ['#7a2e2a', '#2e4a6a', '#3e5a2e', '#6a4a2a', '#5a2e5a'][(row * 3 + k) % 5];
    return `<rect x="${26 + k * 10.5}" y="${special ? 128 : 36 + row * 46 + (k % 3) * 3}" width="9" height="${special ? 36 : 38 - (k % 3) * 3}" rx="1" fill="${special ? 'url(#kp-brass)' : c}" stroke="#140a04"/>`;
  }).join('')).join('');
  const shelf = `<g ${f.shelf ? 'transform="translate(-6 0) skewY(-3)"' : ''}><rect x="18" y="26" width="104" height="190" rx="3" fill="url(#kp-wood)" stroke="#1d0f06" stroke-width="3"/>${[72, 118, 164, 210].map((y) => `<rect x="20" y="${y}" width="100" height="6" fill="#3b2414"/>`).join('')}${books}</g>
    ${f.shelf ? '<rect x="118" y="30" width="10" height="186" fill="#0b0604"/>' : ''}`;
  const win = v.facts.window;
  const windowArt = `<path d="M164 132V54Q200 6 236 54V132Z" fill="#141a2c" stroke="#d9a84a" stroke-width="5"/><path d="M168 130V56Q200 14 232 56V130Z" fill="url(#kp-night)" opacity=".9"/>
    ${win.map((s, i) => `<rect x="182" y="${38 + i * 23}" width="36" height="20" rx="3" fill="${GLASS[s]}" opacity=".55" stroke="#140a04" stroke-width="2"/>${sym(s, 200, 48 + i * 23, 8, GLASS[s])}`).join('')}${glow(200, 80, 70)}`;
  const desk = `<rect x="136" y="166" width="110" height="10" rx="2" fill="url(#kp-wood)" stroke="#1d0f06" stroke-width="2"/><path d="M144 176v38M238 176v38" stroke="#4c2e17" stroke-width="8"/><rect x="150" y="178" width="82" height="20" fill="#4c2e17" stroke="#1d0f06"/><circle cx="191" cy="188" r="2.5" fill="url(#kp-brass)"/>
    <path d="M176 164l14-10 0 10zM190 154l14 10h-14z" fill="url(#kp-paper)" stroke="#6a4a24"/><path d="M190 154v10" stroke="#6a4a24"/>${candle(226, 156)}<rect x="160" y="158" width="7" height="8" rx="2" fill="#141414"/>`;
  const ladder = `<path d="M254 0V214M282 0V214" stroke="#6b4a2c" stroke-width="5"/>${Array.from({ length: 9 }, (_, i) => `<path d="M254 ${16 + i * 24}H282" stroke="#8a5a32" stroke-width="4"/>`).join('')}<rect x="244" y="0" width="48" height="8" fill="#0b0604"/>`;
  const fire = `<rect x="294" y="108" width="94" height="108" fill="#6a625a" stroke="#2c2620" stroke-width="2"/>${Array.from({ length: 12 }, (_, i) => `<rect x="${296 + (i % 4) * 23}" y="${110 + Math.floor(i / 4) * 34}" width="21" height="14" fill="#7a7068" opacity=".55"/>`).join('')}
    <rect x="288" y="102" width="106" height="10" fill="#4c4640" stroke="#2c2620"/><path d="M310 216V150Q341 128 372 150V216Z" fill="#120a06"/><path d="M314 214q14-10 28-2q14-10 26 2z" fill="#4a4440"/>
    ${f['took:fireplace'] ? '' : '<path d="M330 206l22-16" stroke="#5c5c64" stroke-width="5" stroke-linecap="round"/><rect x="349" y="184" width="10" height="8" rx="2" fill="#6a6a70" transform="rotate(-36 354 188)"/>'}`;
  return `${DEFS}<rect width="400" height="250" fill="url(#kp-green)"/>${Array.from({ length: 16 }, (_, i) => `<path d="M${i * 26} 0V210" stroke="#d9c27a" stroke-opacity=".06" stroke-width="10"/>`).join('')}
    <path d="M0 210H400V250H0Z" fill="url(#kp-floor)"/><ellipse cx="200" cy="232" rx="150" ry="14" fill="#6a2a24" opacity=".75"/>${shelf}${windowArt}${desk}${ladder}${fire}`;
}

function gearroom(v) {
  const f = v.flags, running = f.gearSet && f.oiled && f.wound;
  const spin = running ? 'kp-spin' : '';
  const pend = `<path d="M63 20V172" stroke="${f.oiled ? 'url(#kp-brass)' : '#7a4a2a'}" stroke-width="4"/><circle cx="63" cy="190" r="22" fill="${f.oiled ? 'url(#kp-brass)' : '#8a4a24'}" stroke="#2a170a" stroke-width="2"/>${f.oiled ? '' : '<circle cx="56" cy="184" r="5" fill="#5a2a10" opacity=".7"/><circle cx="70" cy="196" r="4" fill="#5a2a10" opacity=".7"/>'}`;
  const train = `${gear(152, 82, 42, 12, 'url(#kp-brass)', spin)}${gear(222, 56, 28, 9, 'url(#kp-brass)', spin ? 'kp-spin-r' : '')}${gear(262, 112, 30, 10, 'url(#kp-brass)', spin)}
    ${f.gearSet ? gear(206, 122, 22, 8, 'url(#kp-brass)', spin ? 'kp-spin-r' : '') : '<circle cx="206" cy="122" r="22" fill="none" stroke="#e9d6a0" stroke-width="2" stroke-dasharray="4 4" opacity=".6"/><circle cx="206" cy="122" r="4" fill="#2a170a" stroke="#d9b56a"/>'}`;
  const weights = `<rect x="330" y="40" width="26" height="18" rx="3" fill="url(#kp-iron)" stroke="#1d1d22"/><rect x="338" y="44" width="10" height="10" fill="#141418" stroke="#d9b56a"/>
    ${[318, 368].map((x) => { const y = f.wound ? 92 : 172; return `<path d="M${x} 58V${y}" stroke="#8a8a90" stroke-width="2" stroke-dasharray="3 2"/><rect x="${x - 11}" y="${y}" width="22" height="40" rx="3" fill="url(#kp-iron)" stroke="#1d1d22" stroke-width="2"/>`; }).join('')}`;
  const chalk = `<rect x="196" y="180" width="96" height="52" rx="3" fill="#2a2420"/><text x="202" y="192" font-size="8" fill="#f3efe3" font-style="italic" font-family="Georgia" opacity=".9">stopped at…</text><g opacity=".85">${tally(v.facts.minute, 204, 198, 0.42)}</g>`;
  const hatch = `<rect x="300" y="0" width="90" height="24" fill="${f.belfry ? '#f1c36a' : '#2a170a'}" stroke="#1d0f06" stroke-width="2"/>${f.belfry ? glow(345, 10, 60) : '<path d="M306 12h78" stroke="#5c5c64" stroke-width="4"/><rect x="338" y="6" width="14" height="12" rx="2" fill="url(#kp-iron)"/>'}`;
  return `${DEFS}<rect width="400" height="250" fill="#1d120a"/>${planks(0, 400, 0, 250)}<path d="M0 30H400M0 160H120" stroke="#2a170a" stroke-width="12"/><path d="M0 236H400V250H0Z" fill="#140a04"/>
    ${glow(200, 110, 140)}${pend}${train}${weights}${chalk}${hatch}`;
}

function belfry(v) {
  const f = v.flags;
  const nums = Array.from({ length: 12 }, (_, i) => { const a = ((i + 1) / 12) * Math.PI * 2 - Math.PI / 2; return `<text x="${(200 - 72 * Math.cos(a)).toFixed(1)}" y="${(116 + 72 * Math.sin(a)).toFixed(1)}" font-size="13" text-anchor="middle" fill="#3b2a17" opacity=".55" font-family="Georgia" transform="scale(1 1)">${roman(i + 1)}</text>`; }).join('');
  const face = `<circle cx="200" cy="112" r="92" fill="url(#kp-face)" opacity=".9" stroke="url(#kp-brass)" stroke-width="6"/><circle cx="200" cy="112" r="92" fill="#ffefb8" opacity=".25"/>${nums}
    <path d="M200 112L${f.freed ? '168 86' : '232 70'}" stroke="#2a1806" stroke-width="5" stroke-linecap="round"/><path d="M200 112L${f.freed ? '200 40' : '150 150'}" stroke="#2a1806" stroke-width="3" stroke-linecap="round"/><circle cx="200" cy="112" r="7" fill="url(#kp-brass)" stroke="#2a1806"/>`;
  const bell = `<path d="M296 52H396" stroke="#4c2e17" stroke-width="10"/><path d="M346 56v10" stroke="#2a170a" stroke-width="4"/><path d="M312 160Q314 70 346 66Q378 70 380 160L392 170H300Z" fill="url(#kp-bronze)" stroke="#2a1806" stroke-width="2"/><circle cx="346" cy="172" r="7" fill="#5a3a14"/>`;
  const letter = `<g transform="rotate(-5 330 34)"><rect x="310" y="18" width="42" height="32" fill="url(#kp-paper)" stroke="#8a6a3a"/><path d="M314 26h32M314 32h26M314 38h30M314 44h18" stroke="#3b2a17" stroke-opacity=".45" stroke-width="1.6"/></g><circle cx="330" cy="20" r="2" fill="#555"/>`;
  const hidden = f.freed
    ? `<rect x="20" y="88" width="76" height="148" fill="#f1c36a" opacity=".7"/>${glow(58, 160, 80)}<path d="M20 88l-12 8v148l12-8z" fill="url(#kp-wood)"/>
      <g><circle cx="58" cy="138" r="13" fill="#e9c9a0" stroke="#3b2a17"/><path d="M45 132q13-14 26 0" fill="#ddd" stroke="#888"/><path d="M38 236V170q0-18 20-18t20 18v66z" fill="#3a3a4a" stroke="#1d1d22" stroke-width="2"/><circle cx="54" cy="138" r="1.5" fill="#222"/><circle cx="62" cy="138" r="1.5" fill="#222"/><path d="M54 145q4 3 8 0" stroke="#3b2a17" fill="none"/><rect x="66" y="176" width="16" height="22" rx="2" fill="url(#kp-brass)" opacity=".9"/></g>`
    : `<rect x="20" y="88" width="76" height="148" fill="url(#kp-plank)" stroke="#1d0f06" stroke-width="2"/>${planks(20, 96, 88, 236)}`;
  return `${DEFS}<rect width="400" height="250" fill="url(#kp-night)"/>${Array.from({ length: 30 }, (_, i) => `<circle cx="${(i * 97) % 400}" cy="${(i * 53) % 90}" r="${i % 4 ? 0.8 : 1.4}" fill="#fff" opacity=".7"/>`).join('')}
    ${[0, 1, 2, 3, 4, 5].map((i) => `<path d="M0 ${40 + i * 30}H400" stroke="#2a1a10" stroke-width="10" opacity=".85"/>`).join('')}<path d="M0 236H400V250H0Z" fill="#1d0f06"/>${hidden}${glow(200, 112, 130)}${face}${bell}${letter}`;
}

/* ---------------- close-ups ---------------- */

const frame = (inner, bg = '#1d120a') => `<svg viewBox="0 0 400 220">${DEFS}<rect width="400" height="220" fill="${bg}"/>${inner}</svg>`;
const closeups = {
  painting: (v) => frame(`<rect x="70" y="14" width="260" height="170" rx="6" fill="url(#kp-brass)" stroke="#4a3008" stroke-width="3"/><rect x="84" y="26" width="232" height="130" fill="url(#kp-night)"/><rect x="84" y="112" width="232" height="44" fill="#3b4a3a"/>
    <path d="M182 156V64l18-26 18 26v92z" fill="#4c3a2c" stroke="#1d140c" stroke-width="2"/><circle cx="200" cy="80" r="12" fill="#f6e7b8" stroke="#3b2a17" stroke-width="2"/><path d="M200 80v-8M200 80l6 3" stroke="#3b2a17" stroke-width="2"/><path d="M166 64h68" stroke="#1d140c" stroke-width="4"/>
    ${Array.from({ length: 14 }, (_, i) => `<circle cx="${96 + i * 16}" cy="${40 + (i * 7) % 28}" r="1.2" fill="#fff"/>`).join('')}<circle cx="282" cy="46" r="10" fill="#f6efc8"/>
    <rect x="110" y="168" width="180" height="46" rx="4" fill="#e9d6a0" stroke="#6a4a14" stroke-width="2"/><circle cx="118" cy="176" r="2" fill="#6a4a14"/><circle cx="282" cy="176" r="2" fill="#6a4a14"/><circle cx="118" cy="206" r="2" fill="#6a4a14"/><circle cx="282" cy="206" r="2" fill="#6a4a14"/>
    <text x="200" y="186" font-size="12" text-anchor="middle" fill="#3b2a17" font-family="Georgia" letter-spacing="2">HALLOWAY TOWER</text><text x="200" y="205" font-size="14" font-weight="700" text-anchor="middle" fill="#3b2a17" font-family="Georgia" letter-spacing="1">RAISED ${v.facts.roman}</text>`),
  clipping: (v) => frame(`<g transform="rotate(-2 200 110)"><rect x="60" y="10" width="280" height="200" fill="url(#kp-paper)" stroke="#8a6a3a" stroke-width="2"/><text x="200" y="34" font-size="11" text-anchor="middle" fill="#3b2a17" font-family="Georgia" letter-spacing="3">THE HALLOWAY GAZETTE</text>
    <path d="M76 42H324" stroke="#3b2a17"/><text x="200" y="66" font-size="19" font-weight="800" text-anchor="middle" fill="#2a1a0a" font-family="Georgia">KEEPER MISSING</text><text x="200" y="84" font-size="11" text-anchor="middle" fill="#3b2a17" font-family="Georgia" font-style="italic">Great clock falls silent</text>
    <foreignObject x="80" y="92" width="240" height="110"><div xmlns="http://www.w3.org/1999/xhtml" style="font:11.5px/1.45 Georgia,serif;color:#2a1a0a">Elias Thorne, keeper of Halloway Tower, has not been seen since the night of the storm. Neighbours say the great bell struck <b>${WORDS[v.facts.hour]}</b> times, and then the clock stopped for good. The tower door has been locked ever since.</div></foreignObject></g>`, '#2a1d12'),
  window: (v) => frame(`<path d="M130 214V80Q200 -6 270 80V214Z" fill="#141a2c" stroke="#d9a84a" stroke-width="7"/><path d="M138 210V82Q200 6 262 82V210Z" fill="url(#kp-night)"/>
    ${v.facts.window.map((s, i) => `<rect x="162" y="${58 + i * 37}" width="76" height="33" rx="6" fill="${GLASS[s]}" opacity=".45" stroke="#140a04" stroke-width="3"/>${sym(s, 200, 74.5 + i * 37, 13, GLASS[s])}`).join('')}${glow(200, 120, 120)}
    <text x="84" y="40" font-size="11" fill="#e9d6a0" font-family="Georgia">top</text><text x="72" y="206" font-size="11" fill="#e9d6a0" font-family="Georgia">bottom</text><path d="M100 46v150" stroke="#e9d6a0" stroke-dasharray="3 4" opacity=".5"/>`, '#0b0f1e'),
  tally: (v) => frame(`<rect x="20" y="14" width="360" height="192" rx="6" fill="#2a2420" stroke="#4c2e17" stroke-width="8"/><text x="44" y="52" font-size="22" fill="#f3efe3" font-style="italic" font-family="Georgia" opacity=".9">stopped at…</text>${tally(v.facts.minute, 52, 74, 1.5)}`),
  clockface: (v) => frame(`<circle cx="200" cy="110" r="100" fill="url(#kp-face)" stroke="url(#kp-brass)" stroke-width="8"/>${Array.from({ length: 12 }, (_, i) => { const a = ((i + 1) / 12) * Math.PI * 2 - Math.PI / 2; return `<text x="${(200 + 78 * Math.cos(a)).toFixed(1)}" y="${(116 + 78 * Math.sin(a)).toFixed(1)}" font-size="16" text-anchor="middle" fill="#3b2a17" font-family="Georgia" font-weight="700">${roman(i + 1)}</text>`; }).join('')}
    ${Array.from({ length: 60 }, (_, i) => { const a = (i / 60) * Math.PI * 2; return `<path d="M${(200 + 94 * Math.cos(a)).toFixed(1)} ${(110 + 94 * Math.sin(a)).toFixed(1)}L${(200 + (i % 5 ? 90 : 86) * Math.cos(a)).toFixed(1)} ${(110 + (i % 5 ? 90 : 86) * Math.sin(a)).toFixed(1)}" stroke="#3b2a17" stroke-width="${i % 5 ? 1 : 2.4}"/>`; }).join('')}
    <path d="M200 110L${v.flags.freed ? '160 80' : '236 60'}" stroke="#2a1806" stroke-width="7" stroke-linecap="round"/><path d="M200 110L${v.flags.freed ? '200 28' : '144 160'}" stroke="#2a1806" stroke-width="4" stroke-linecap="round"/><circle cx="200" cy="110" r="9" fill="url(#kp-brass)" stroke="#2a1806" stroke-width="2"/>`, '#141a2c'),
  keeper: () => frame(`<rect width="400" height="220" fill="#3a2414"/>${glow(200, 90, 160)}<circle cx="200" cy="78" r="40" fill="#e9c9a0" stroke="#3b2a17" stroke-width="3"/><path d="M160 66q40-46 80 0" fill="#e8e8e8" stroke="#9a9a9a" stroke-width="2"/><path d="M168 84q-6 26 32 34q38-8 32-34" fill="#eee" opacity=".85"/>
    <circle cx="186" cy="78" r="9" fill="none" stroke="url(#kp-brass)" stroke-width="2.5"/><circle cx="214" cy="78" r="9" fill="none" stroke="url(#kp-brass)" stroke-width="2.5"/><path d="M195 78h10" stroke="#d9a84a" stroke-width="2"/><circle cx="186" cy="78" r="2.4" fill="#222"/><circle cx="214" cy="78" r="2.4" fill="#222"/>
    <path d="M120 220V170q0-40 80-40t80 40v50z" fill="#3a3a4a" stroke="#1d1d22" stroke-width="3"/><path d="M200 132v88" stroke="#1d1d22" stroke-width="2"/><circle cx="232" cy="168" r="10" fill="url(#kp-brass)" stroke="#4a3008"/><path d="M232 162v6l4 2" stroke="#3b2a17" stroke-width="1.5" fill="none"/>`),
};

/* ---------------- items ---------------- */

const items = {
  brasskey: { name: 'Study key', text: 'A brass key whose bow is shaped like a clock hand. The tag reads <i>Study</i>.',
    icon: `<circle cx="11" cy="20" r="7" fill="none" stroke="#e0b04c" stroke-width="4"/><path d="M18 20h18M30 20v6M35 20v5" stroke="#e0b04c" stroke-width="4" stroke-linecap="round"/><path d="M9 14l4 6-4 6" fill="none" stroke="#7a5212" stroke-width="1.5"/>` },
  oilcan: { name: 'Oil can', text: 'A dented can of clock oil. Still sloshes when you shake it.',
    icon: `<path d="M8 34h20l-3-18H11z" fill="#b84a2c" stroke="#3a1508" stroke-width="1.5"/><path d="M26 20l10-12" stroke="#a0a0a8" stroke-width="3" stroke-linecap="round"/><rect x="13" y="11" width="10" height="5" rx="1" fill="#2a170a"/><path d="M12 24h12" stroke="#ffd6b0" stroke-opacity=".5" stroke-width="2"/>` },
  gear: { name: 'Spare gear', text: 'A heavy brass gear with eight teeth, polished from years of use.',
    icon: gear(20, 20, 16, 8, '#e0b04c') },
  crank: { name: 'Winding crank', text: 'A scorched iron crank with a square socket: made to wind something big.',
    icon: `<path d="M8 32L26 14" stroke="#7a7a82" stroke-width="5" stroke-linecap="round"/><rect x="24" y="6" width="10" height="10" rx="2" fill="#4a4a52" stroke="#1d1d22" stroke-width="1.5" transform="rotate(45 29 11)"/><circle cx="8" cy="32" r="4" fill="#5a3a20"/>` },
  towerkey: { name: 'Tower key', text: 'Elias’s own key to the tower, heavy and warm from his pocket.',
    icon: `<circle cx="10" cy="20" r="8" fill="none" stroke="#f2d27a" stroke-width="4"/><circle cx="10" cy="20" r="2.5" fill="#f2d27a"/><path d="M18 20h19M31 20v8M36 20v6M26 20v5" stroke="#f2d27a" stroke-width="4" stroke-linecap="round"/>` },
};

/* ---------------- cover and atmosphere ---------------- */

// A faint brass gear watermark for the felt around the scene (a data URI, so no ids to clash).
const FELT_GEARS = (() => {
  const ring = (cx, cy, r, n) => {
    const pts = Array.from({ length: n * 4 }, (_, i) => { const a = (i / (n * 4)) * Math.PI * 2, rr = i % 4 < 2 ? r : r * 0.84; return `${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`; });
    return `<polygon points="${pts.join(' ')}"/><circle cx="${cx}" cy="${cy}" r="${r * 0.58}"/><circle cx="${cx}" cy="${cy}" r="${r * 0.14}"/>`;
  };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" fill="none" stroke="#f2c879" stroke-opacity=".09" stroke-width="2.4" stroke-linejoin="round">${ring(140, 96, 80, 16)}${ring(42, 200, 40, 10)}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
})();

// Cover: two friends climb into the clock room with a lantern and find the great clock stopped,
// moonlight glowing through its face. Self-contained "kpc-" ids: covers appear several times on a page.
function coverArt() {
  const stop = (o, c, a = 1) => `<stop offset="${o}" stop-color="${c}"${a < 1 ? ` stop-opacity="${a}"` : ''}/>`;
  const at = (r, a) => [(214 + r * Math.cos(a)).toFixed(1), (82 + r * Math.sin(a)).toFixed(1)];
  const line = (r1, r2, a) => { const [x1, y1] = at(r1, a), [x2, y2] = at(r2, a); return `M${x1} ${y1}L${x2} ${y2}`; };
  const spokes = Array.from({ length: 12 }, (_, i) => line(10, 58, (i / 12) * Math.PI * 2 + Math.PI / 12)).join('');
  const ticks = Array.from({ length: 12 }, (_, i) => `<path d="${line(i % 3 ? 49 : 44, 55, (i / 12) * Math.PI * 2)}" stroke-width="${i % 3 ? 2.2 : 3.6}"/>`).join('');
  const bolts = Array.from({ length: 16 }, (_, i) => { const [x, y] = at(62, (i / 16) * Math.PI * 2); return `<circle cx="${x}" cy="${y}" r="1.5"/>`; }).join('');
  const glint = (x, y, r, o = 1) => `<path d="M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z" fill="#fff6d8" opacity="${o}"/>`;
  const dots = (list, fill, o) => list.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" opacity="${o}"/>`).join('');
  const planks = [-80, -10, 60, 130, 200, 270, 340, 410].map((x) => `M${x} 200L${(x + (160 - x) * 0.35).toFixed(1)} 172`).join('');
  return `<svg viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Two friends with a lantern find the great clock stopped in the moonlit tower"><defs>
    <linearGradient id="kpc-wall" x1="0" y1="0" x2="0" y2="1">${stop(0, '#151a44')}${stop(0.6, '#1d1b4a')}${stop(1, '#2a1f42')}</linearGradient>
    <radialGradient id="kpc-glass" cx=".62" cy=".28" r=".8">${stop(0, '#fbfcff')}${stop(0.22, '#d9e2ff')}${stop(0.6, '#7d8fd8')}${stop(1, '#3d4a9a')}</radialGradient>
    <radialGradient id="kpc-lamp">${stop(0, '#ffd27a', 0.85)}${stop(0.35, '#ffa64a', 0.32)}${stop(1, '#ff8a3a', 0)}</radialGradient>
    <linearGradient id="kpc-brass" x1="0" y1="0" x2="1" y2="1">${stop(0, '#fff0b0')}${stop(0.35, '#e0b04c')}${stop(1, '#7a5212')}</linearGradient>
    <linearGradient id="kpc-floor" x1="0" y1="0" x2="0" y2="1">${stop(0, '#3a2830')}${stop(1, '#1a1424')}</linearGradient>
    <linearGradient id="kpc-beam" x1="0" y1="0" x2="0" y2="1">${stop(0, '#dfe6ff', 0.2)}${stop(1, '#dfe6ff', 0)}</linearGradient>
    <linearGradient id="kpc-coatA" x1="0" y1="0" x2="1" y2="1">${stop(0, '#3fd0c0')}${stop(1, '#16707c')}</linearGradient>
    <linearGradient id="kpc-coatB" x1="0" y1="0" x2="1" y2="1">${stop(0, '#ffe07a')}${stop(1, '#f09a24')}</linearGradient>
    <filter id="kpc-blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5"/></filter></defs>
    <rect width="320" height="200" fill="url(#kpc-wall)"/>
    <path d="M24 0V172M62 0V172M100 0V172M138 0V172M290 0V172" stroke="#0c0f2c" stroke-width="2" opacity=".5"/>
    <circle cx="117" cy="126" r="122" fill="url(#kpc-lamp)"/>
    ${gear(48, 40, 26, 12, 'url(#kpc-brass)')}${gear(86, 18, 15, 9, 'url(#kpc-brass)')}${gear(300, 46, 22, 10, 'url(#kpc-brass)')}
    <circle cx="214" cy="82" r="72" fill="#0c0e2a"/><circle cx="214" cy="82" r="60" fill="url(#kpc-glass)"/>
    <circle cx="238" cy="56" r="15" fill="#fff" opacity=".85" filter="url(#kpc-blur)"/><circle cx="238" cy="56" r="9" fill="#fffef6"/>
    ${dots([[194, 44, 0.9], [186, 62, 0.8], [254, 98, 0.9], [232, 114, 0.8], [178, 92, 0.8], [206, 30, 0.7]], '#fff', 0.85)}
    <path d="M226 42c-3-4-8-5-12-2 2 0 4 1.5 4 3.2 1.6-.8 3.2 0 4 1.6.8-1.6 2.4-2.6 4-2.8zm0 0c3-4 8-5 12-2-2 0-4 1.5-4 3.2-1.6-.8-3.2 0-4 1.6-.8-1.6-2.4-2.6-4-2.8z" fill="#141838"/>
    <g stroke="#161a46" stroke-linecap="round" fill="none" opacity=".8"><path d="${spokes}" stroke-width="2"/><circle cx="214" cy="82" r="34" stroke-width="2"/>${ticks}</g>
    <g stroke="#10132f" stroke-linecap="round" opacity=".78"><path d="M214 82L188 66" stroke-width="5.5"/><path d="M214 82L247 49" stroke-width="3.4"/></g>
    <circle cx="214" cy="82" r="62" fill="none" stroke="url(#kpc-brass)" stroke-width="6"/><g fill="#fff3c0" opacity=".8">${bolts}</g>
    <circle cx="214" cy="82" r="7" fill="url(#kpc-brass)" stroke="#3b2510" stroke-width="1.5"/>
    <path d="M170 118L198 136L150 200H70Z" fill="url(#kpc-beam)"/>
    <path d="M0 6H320" stroke="#120e26" stroke-width="12"/><path d="M0 52L62 0" stroke="#22183a" stroke-width="9"/>
    <path d="M30 6V148" stroke="#c99a5a" stroke-width="2.4"/><path d="M26 146h8l-1.2 14h-5.6z" fill="#e2525c"/><path d="M27.5 160l-1 6M30 160v7M32.5 160l1 6" stroke="#e2525c" stroke-width="1.4"/>
    <path d="M0 172H320V200H0Z" fill="url(#kpc-floor)"/><path d="M0 172H320" stroke="#4a3436" stroke-width="2"/>
    <path d="${planks}M0 184H320" stroke="#120c1c" stroke-width="1.4" opacity=".7"/>
    <ellipse cx="118" cy="190" rx="90" ry="12" fill="#ffb050" opacity=".16"/>
    ${gear(298, 152, 30, 13, 'url(#kpc-brass)')}${gear(268, 186, 14, 9, 'url(#kpc-brass)')}
    <ellipse cx="152" cy="199" rx="30" ry="5" fill="#05060f" opacity=".45"/>
    <path d="M134 134q18-18 36 0l-3 16h-30z" fill="#e8a21e"/>
    <path d="M126 200C126 174 134 154 152 150C170 154 178 174 178 200Z" fill="url(#kpc-coatB)"/>
    <path d="M152 156V200" stroke="#c98a14" stroke-width="1.5" opacity=".7"/><path d="M134 184h11M160 184h11" stroke="#c98a14" stroke-width="1.6"/>
    <rect x="147.5" y="163" width="9" height="3.4" rx="1.7" fill="#9a5a10"/><rect x="147.5" y="175" width="9" height="3.4" rx="1.7" fill="#9a5a10"/><rect x="147.5" y="187" width="9" height="3.4" rx="1.7" fill="#9a5a10"/>
    <rect x="146" y="136" width="11" height="13" rx="4" fill="#a86a40"/><circle cx="139" cy="128" r="3.2" fill="#b07040"/>
    <circle cx="152" cy="126" r="14.5" fill="#c3814f"/>
    ${dots([[140, 119, 6.5], [145, 112.5, 7], [153, 110, 7], [161, 112.5, 6.2], [166.5, 116.5, 4.2], [137.5, 127, 4.5]], '#2b1d16', 1)}
    <ellipse cx="156" cy="124.5" rx="1.8" ry="2.2" fill="#1a1010"/><ellipse cx="163.5" cy="123.5" rx="1.8" ry="2.2" fill="#1a1010"/>
    <circle cx="156.6" cy="123.7" r=".65" fill="#fff"/><circle cx="164.1" cy="122.7" r=".65" fill="#fff"/>
    <circle cx="165.5" cy="129" r="2.6" fill="#ff7f8f" opacity=".35"/><circle cx="148" cy="131" r="2.6" fill="#ff7f8f" opacity=".25"/>
    <path d="M155 131.5q4.2 4.6 8.6 0z" fill="#5a1e24"/>
    <path d="M164 160C172 146 180 134 188 124L195 129C189 140 180 154 171 166Z" fill="url(#kpc-coatB)"/><path d="M187.6 124.4l7.6 4.7-1.9 3-7.6-4.7z" fill="#c98a14"/>
    <circle cx="193" cy="122" r="4.8" fill="#c3814f"/><path d="M195 119.6l6.8-7.4" stroke="#c3814f" stroke-width="3.4" stroke-linecap="round"/>
    <ellipse cx="86" cy="199" rx="34" ry="5" fill="#05060f" opacity=".45"/>
    <path d="M54 200C54 170 64 146 86 141C108 146 116 170 116 200Z" fill="url(#kpc-coatA)"/>
    <path d="M86 152V200" stroke="#0f4a52" stroke-width="1.5" opacity=".6"/><path d="M62 160C60 172 60 186 61 200" stroke="#fff" stroke-opacity=".18" stroke-width="3" fill="none"/>
    <circle cx="81" cy="163" r="1.8" fill="#0f4a52"/><circle cx="81" cy="176" r="1.8" fill="#0f4a52"/><circle cx="81" cy="189" r="1.8" fill="#0f4a52"/>
    <rect x="81" y="128" width="11" height="13" rx="4" fill="#d89a72"/>
    <path d="M71 140q15 9 30 0l-1 7q-14 8-28 0z" fill="#ffcf5c"/><path d="M76 145l-5 19 6 1.5 4-18z" fill="#f0b440"/>
    <circle cx="73" cy="120" r="3.6" fill="#e6ae86"/><circle cx="87" cy="118" r="15.5" fill="#f2c29c"/>
    <path d="M72 108q-4 10 0 20q2-7 4-9z" fill="#5a3420"/>
    <path d="M71 110C70 94 80 86 89 86C99 86 106 94 105 106C95 99 81 101 71 110Z" fill="#e2525c"/><path d="M70 108q18-11 36-4l1 6q-18-8-37 4z" fill="#c23a48"/>
    <path d="M80 97q2 5 1 10M88 94v10M96 95q-1 5-1 9" stroke="#c23a48" stroke-width="1.2" opacity=".6" fill="none"/><circle cx="90" cy="85" r="5.5" fill="#ffd3d8"/>
    <path d="M89 111.5q3-2 6 0M97 110.5q3-2 6 0" stroke="#5a3420" stroke-width="1.4" fill="none" stroke-linecap="round"/>
    <ellipse cx="92" cy="116" rx="1.8" ry="2.2" fill="#2a1c1a"/><ellipse cx="100" cy="115" rx="1.8" ry="2.2" fill="#2a1c1a"/>
    <circle cx="92.6" cy="115.2" r=".65" fill="#fff"/><circle cx="100.6" cy="114.2" r=".65" fill="#fff"/>
    <circle cx="102" cy="121.5" r="3" fill="#ff7f8f" opacity=".4"/><circle cx="83" cy="123" r="3" fill="#ff7f8f" opacity=".3"/>
    <ellipse cx="97.5" cy="125" rx="2.2" ry="2.7" fill="#7a2e35"/>
    <path d="M100 150C106 136 110 124 113 114L121 116C119 128 114 142 108 154Z" fill="url(#kpc-coatA)"/><path d="M112.6 114.4l8.6 2.1-.9 3.4-8.6-2.1z" fill="#0f4a52"/>
    <path d="M111.5 114a5.5 5.5 0 0 1 11 0" fill="none" stroke="#e0b04c" stroke-width="1.8"/><circle cx="117" cy="109.5" r="5" fill="#f2c29c"/>
    <circle cx="117" cy="126" r="16" fill="#ffe3a0" opacity=".5" filter="url(#kpc-blur)"/>
    <path d="M110 118h14l-3-4h-8z" fill="url(#kpc-brass)"/><rect x="111" y="118" width="12" height="16" rx="2.5" fill="#fff1c4"/>
    <path d="M117 121q4.2 5 0 10q-4.2-5 0-10z" fill="#ff9f3a"/><path d="M117 124q1.8 2.5 0 5q-1.8-2.5 0-5z" fill="#fff6d0"/>
    <path d="M111 118v16M123 118v16" stroke="#c99a45" stroke-width="1.6"/><rect x="109" y="134" width="16" height="4" rx="2" fill="url(#kpc-brass)"/>
    ${dots([[132, 96, 1.1], [101, 86, 0.8], [140, 112, 1.3], [128, 80, 0.7], [97, 140, 0.9], [146, 98, 0.8], [112, 70, 1]], '#ffe9b0', 0.75)}
    ${glint(155, 66, 5, 0.9)}${glint(196, 24, 3.5, 0.8)}${glint(262, 150, 4, 0.7)}${glint(132, 104, 3, 0.8)}
  </svg>`;
}

/* ---------------- the tower ---------------- */

const seenAll = (v, ...ids) => ids.every((id) => v.seen.includes(id));
const shelfAnswer = (win) => win.slice().reverse();
const restarted = (s) => s.flags.gearSet && s.flags.oiled && s.flags.wound;
function repair(s) {
  if (!restarted(s) || s.flags.belfry) return;
  s.flags.belfry = true;
  openRoom(s, 'belfry');
}

export default escapeRoom({
  id: 'keeper', name: 'The Missing Keeper',
  description: 'Locked inside an abandoned clocktower, search its rooms, repair the great clock and find out what happened to its keeper. A cooperative escape room for 1–4.',
  theme: { accent: '#f2c879', glow: '#ffe3a3', deep: '#140b05' },
  css: `.kp-opt{display:flex;flex-direction:column;align-items:center;gap:1px}.kp-opt svg{width:30px!important;height:30px!important}
    .kp-opt small{font:600 .56rem var(--font-body);color:var(--muted);letter-spacing:.04em}
    .kp-spin{animation:kpSpin 14s linear infinite}.kp-spin-r{animation:kpSpin 10s linear infinite reverse}@keyframes kpSpin{to{transform:rotate(360deg)}}
    /* Halloway Tower at night: candlelight from below, brass clockwork and a starry sky around the scene. */
    .esc-keeper{--accent-2:#ff9f5a;--win:#ffd36b;--ink-on:#3b2400;--acc-soft:rgba(242,200,121,.12);--acc-line:rgba(242,200,121,.42);--acc-line-2:rgba(242,200,121,.2);
      --acc-glow:rgba(255,190,90,.55);--glass-1:rgba(38,38,92,.82);--glass-2:rgba(22,22,60,.9);--item-1:#3a3474;--item-2:#16163e}
    .esc-keeper .esc-felt{border-color:rgba(242,200,121,.24);background:${FELT_GEARS} right -90px top -80px / 300px 300px no-repeat,
      radial-gradient(1.5px 1.5px at 7% 9%,rgba(255,244,214,.75),transparent 60%),radial-gradient(1.2px 1.2px at 19% 4%,rgba(255,244,214,.5),transparent 60%),
      radial-gradient(1.6px 1.6px at 36% 7%,rgba(255,244,214,.55),transparent 60%),radial-gradient(1.2px 1.2px at 58% 3%,rgba(220,230,255,.6),transparent 60%),
      radial-gradient(1.4px 1.4px at 74% 11%,rgba(255,244,214,.5),transparent 60%),radial-gradient(1.2px 1.2px at 93% 6%,rgba(220,230,255,.55),transparent 60%),
      radial-gradient(1.3px 1.3px at 3% 44%,rgba(255,244,214,.4),transparent 60%),radial-gradient(1.3px 1.3px at 98% 36%,rgba(255,244,214,.4),transparent 60%),
      radial-gradient(75% 45% at 50% 106%,rgba(255,166,64,.3),transparent 70%),radial-gradient(45% 30% at 10% 0%,rgba(170,190,255,.16),transparent 70%),
      linear-gradient(180deg,#131a46 0%,#191c4c 45%,#231a3e 100%)}
    .esc-keeper .esc-scene{border-color:rgba(224,176,76,.6);box-shadow:0 14px 30px rgba(2,4,16,.55),0 0 0 4px rgba(16,14,40,.6),0 0 38px rgba(255,180,80,.16)}
    .esc-keeper .esc-val{color:#ffd98a;border-color:rgba(224,176,76,.75);background:radial-gradient(circle at 50% 30%,#2a2a62,#0d0f2e);
      box-shadow:inset 0 3px 8px rgba(0,0,0,.75),0 0 0 3px rgba(224,176,76,.12),0 0 14px rgba(255,190,90,.12)}
    .esc-keeper .esc-goal-ic{background:radial-gradient(circle at 40% 30%,#fff4cc,#ffc65c 55%,#e08a2a)}`,
  doneLabel: 'You escaped Halloway Tower',
  cover: coverArt(),
  intro: {
    title: 'The Missing Keeper',
    text: [
      'For a hundred years the great clock of <b>Halloway Tower</b> has kept time for the town. Three nights ago, during a storm, it fell silent, and its keeper, <b>Elias Thorne</b>, vanished.',
      'You came looking for him. The moment you stepped inside, the oak door swung shut behind you and bolted itself. Elias filled this tower with clever mechanisms, and now one of them has you.',
      'Search every room. Examine paintings, read his notes, and repair what is broken. Somewhere in this tower is the way out, and maybe Elias himself.',
    ],
  },
  opening: 'The tower door slammed shut behind you. The workshop smells of oil and candle wax.',
  howTo: {
    goal: 'Work together to find out what happened to the clockmaker Elias Thorne, and escape Halloway Tower. Everyone wins together. There is no time limit, and the clock records how long you took.',
    turn: [
      ['🔎', 'Explore at the same time', 'There are no turns. Tap anything in a room (or its button below the picture) to see a close-up. Glowing corners and twinkles show what nobody has examined yet.'],
      ['🚪', 'Split up', 'Use the room tabs to move between rooms. Teammates can search different floors at once. Everyone’s portrait on the room tabs shows where they are.'],
      ['🎒', 'Share everything', 'Items anyone picks up go into the shared inventory. To use one, open the object and choose the item. Clues anyone examines are copied into the team journal.'],
      ['🔐', 'Crack the mechanisms', 'Locks use dials: set each one with ▲ ▼ and press Try it. Wrong guesses cost nothing except pride.'],
    ],
    tips: [
      'Many puzzles need clues from two different rooms. Read the journal and talk to each other.',
      'Hints come in steps: a gentle nudge first, the full answer last. The hint button glows when you seem stuck.',
      'Codes change every game. Play solo, or add computer teammates. They explore and share clues, and only solve puzzles after the team has been stuck for a while.',
    ],
  },
  rooms: [
    { id: 'workshop', name: 'Workshop', blurb: 'The ground floor, where Elias built and mended his mechanisms.', art: workshop },
    { id: 'study', name: 'Study', blurb: 'Elias’s private room above the workshop, lit by a stained-glass window.', art: study },
    { id: 'gears', name: 'Gear Loft', blurb: 'The heart of the clock: gears, weights and a long pendulum.', art: gearroom },
    { id: 'belfry', name: 'Belfry', blurb: 'The top of the tower, behind the great clock face, beside the bell.', art: belfry },
  ],
  items,
  setup(s) {
    s.secret = {
      year: [1842, 1857, 1868, 1879, 1883, 1896, 1904, 1912][rand(8)],
      window: shuffle([0, 1, 2, 3, 4, 5]).slice(0, 4),
      hour: 1 + rand(12),
      minute: [10, 15, 20, 25, 35, 40, 45][rand(7)],
    };
  },
  facts: (s) => ({ roman: roman(s.secret.year), window: s.secret.window, hour: s.secret.hour, minute: s.secret.minute }),
  objects: [
    /* Workshop */
    { id: 'frontdoor', room: 'workshop', name: 'Front door', hot: [12, 56, 66, 164],
      look: () => ({ text: '<p>Heavy oak banded with iron, bolted from a mechanism you can’t see. There is no handle on this side, only a brass plate:</p><span class="esc-paper">Opens only to the Keeper’s own key.</span>' }),
      use: [{ item: 'towerkey', flag: 'escaped', msg: (p) => `${p.name} turned the Keeper’s key in the front door.`,
        effect: (s) => escape(s, 'The bolts slid back, and the team walked out into the dawn with Elias Thorne.') }] },
    { id: 'rack', room: 'workshop', name: 'Tool rack', hot: [86, 40, 60, 84],
      look: (v) => ({ text: v.flags['took:rack'] ? '<p>Files, a hammer and pliers. There’s a pale outline where the oil can used to hang.</p>' : '<p>Files, a hammer, pliers and a dented <b>oil can</b> that still sloshes when you tap it.</p>' }),
      take: { item: 'oilcan', label: 'Take the oil can', msg: (p) => `${p.name} took the oil can from the tool rack.` } },
    { id: 'painting', room: 'workshop', name: 'Painting of the tower', hot: [148, 34, 88, 74],
      look: (v) => ({ art: closeups.painting(v), text: '<p>An oil painting of Halloway Tower on the night it was finished. A brass plaque is screwed to the frame.</p>' }),
      clue: (v) => `Plaque: “Halloway Tower · raised ${v.facts.roman}”.` },
    { id: 'clipping', room: 'workshop', name: 'Newspaper clipping', hot: [244, 42, 48, 62],
      look: (v) => ({ art: closeups.clipping(v), text: '<p>Pinned to the wall, still damp at the edges. Someone circled one sentence in pencil.</p>' }),
      clue: (v) => `The night Elias vanished, the bell struck ${WORDS[v.facts.hour]} times, then the clock stopped.` },
    { id: 'note', room: 'workshop', name: 'Note on the workbench', hot: [94, 130, 48, 24],
      look: () => ({ text: '<span class="esc-paper">Apprentice: the toolbox is locked with the year this tower was raised, same as always. Keep the study key in there, and stop leaving it on the stairs!<br>— E.T.</span>' }),
      clue: () => 'The toolbox code is the year the tower was raised. The study key is inside.' },
    { id: 'toolbox', room: 'workshop', name: 'Keeper’s toolbox', hot: [166, 108, 60, 46],
      look: (v) => ({ text: v.flags.toolbox ? '<p>The lid is open. Nothing left but sawdust and a ring of polish where the study key lay.</p>' : '<p>A sturdy iron toolbox with a four-wheel brass combination lock.</p>' }),
      lock: { slots: [0, 1, 2, 3].map(() => Array.from({ length: 10 }, (_, d) => String(d))), flag: 'toolbox', verb: 'Open the toolbox',
        check: (sec, val) => val.join('') === String(sec.year), format: (val) => val.join(''),
        msg: (p, code) => `${p.name} opened the toolbox with ${code}. Inside: the study key.`, effect: (s) => give(s, 'brasskey'),
        solve: (v) => (seenAll(v, 'painting', 'note') ? String(unroman(v.facts.roman)).split('').map(Number) : null) } },
    { id: 'stairdoor', room: 'workshop', name: 'Door at the top of the stairs', hot: [316, 24, 68, 96], go: 'study', goLabel: 'Climb to the study',
      look: (v) => ({ text: v.flags.stairs ? '<p>The door stands open. Warm light spills down from the study above.</p>' : '<p>Locked. The keyhole is shaped like the hand of a clock.</p>' }),
      use: [{ item: 'brasskey', flag: 'stairs', msg: (p) => `${p.name} unlocked the stair door. The study and the gear loft are open.`,
        effect: (s) => { openRoom(s, 'study'); openRoom(s, 'gears'); } }] },

    /* Study */
    { id: 'bookshelf', room: 'study', name: 'Bookshelf', hot: [16, 24, 110, 194],
      look: (v) => ({ text: v.flags.shelf ? '<p>The shelf has swung out on a hidden hinge. The spare gear you found was behind it.</p>' : '<p>Four books on the middle shelf have brass spines that turn with a click, each one showing a symbol. Something behind the shelf seems to be waiting for the right combination.</p>' }),
      lock: { slots: [0, 1, 2, 3].map(() => SYMS.map((_, i) => symOption(i))), labels: ['1st book', '2nd book', '3rd book', '4th book'], flag: 'shelf', verb: 'Turn the spines',
        check: (sec, val) => shelfAnswer(sec.window).every((x, i) => x === val[i]), format: (val) => val.map((i) => SYMS[i]).join(', '),
        msg: (p) => `${p.name} turned the book spines. The bookshelf swung open, revealing a spare brass gear!`, effect: (s) => give(s, 'gear'),
        solve: (v) => (seenAll(v, 'window', 'journal') ? shelfAnswer(v.facts.window) : null) } },
    { id: 'window', room: 'study', name: 'Stained-glass window', hot: [162, 18, 76, 116],
      look: (v) => ({ art: closeups.window(v), text: '<p>Four coloured panes, one above the other, each with a symbol set in lead.</p>' }),
      clue: (v) => `From top to bottom: ${v.facts.window.map((i) => SYMS[i]).join(', ')}.` },
    { id: 'journal', room: 'study', name: 'Keeper’s journal', hot: [170, 148, 44, 22],
      look: () => ({ text: `<span class="esc-paper">My study window keeps my secrets, but read it the way the bell rope hangs: <b>from the bottom up</b>.</span>
        <span class="esc-paper">The storm is rattling the tower again. If the clock stops, remember the three cures: <b>oil</b> for the pendulum, the <b>spare gear</b> for the train, and the <b>crank</b> for the weights. When it runs, the belfry hatch unbolts.</span>
        <span class="esc-paper">Tonight I must climb up and free the jammed escapement myself. If the panel behind the face shuts on me, I will leave word.</span>` }),
      clue: () => 'Read the window from the bottom up. A stopped clock needs oil (pendulum), the spare gear (gear train) and the crank (weights).' },
    { id: 'fireplace', room: 'study', name: 'Fireplace', hot: [290, 102, 104, 116],
      look: (v) => ({ text: v.flags['took:fireplace'] ? '<p>Cold ashes, already raked through.</p>' : '<p>Cold ashes. Half buried in them is a scorched iron <b>winding crank</b>, as if someone dropped it in a hurry.</p>' }),
      take: { item: 'crank', label: 'Pull out the winding crank', msg: (p) => `${p.name} pulled a winding crank out of the fireplace ashes.` } },
    { id: 'ladder', room: 'study', name: 'Ladder to the gear loft', hot: [248, 0, 40, 150], go: 'gears', goLabel: 'Climb to the gear loft',
      look: () => ({ text: '<p>A ladder disappears through the ceiling. Above it you can hear… nothing. The clock is silent.</p>' }) },

    /* Gear loft */
    { id: 'pendulum', room: 'gears', name: 'Pendulum', hot: [30, 18, 66, 206],
      look: (v) => ({ text: v.flags.oiled ? '<p>Freshly oiled and free to swing.</p>' : '<p>The pendulum is stiff with rust. Its pivot won’t budge.</p>' }),
      use: [{ item: 'oilcan', flag: 'oiled', msg: (p) => `${p.name} oiled the pendulum's pivot. It swings freely now.`, effect: repair }] },
    { id: 'train', room: 'gears', name: 'Gear train', hot: [108, 26, 188, 128],
      look: (v) => ({ text: v.flags.gearSet ? '<p>All four gears mesh tooth to tooth.</p>' : '<p>Three brass gears and an empty axle where a small gear is missing. Without it, nothing can turn.</p>' }),
      use: [{ item: 'gear', flag: 'gearSet', msg: (p) => `${p.name} slid the spare gear onto the empty axle.`, effect: repair }] },
    { id: 'weights', room: 'gears', name: 'Clock weights', hot: [304, 34, 80, 190],
      look: (v) => ({ text: v.flags.wound ? '<p>The weights hang high on their chains, ready to drive the clock.</p>' : '<p>Two iron weights rest on the floor, their chains slack. A square winding socket sits above them.</p>' }),
      use: [{ item: 'crank', flag: 'wound', msg: (p) => `${p.name} wound the clock weights up with the crank.`, effect: repair }] },
    { id: 'tally', room: 'gears', name: 'Chalk marks', hot: [194, 176, 100, 58],
      look: (v) => ({ art: closeups.tally(v), text: '<p>Chalked on a plank beside the minute wheel, in Elias’s hand.</p>' }),
      clue: () => 'Elias chalked “stopped at…” and a row of tally marks (open to count them).' },
    { id: 'hatch', room: 'gears', name: 'Belfry hatch', hot: [298, 0, 94, 30], go: 'belfry', goLabel: 'Climb into the belfry',
      look: (v) => ({ text: v.flags.belfry ? '<p>The hatch has unbolted itself. Cold night air pours down from the belfry.</p>' : '<p>Bolted from above. A rod connects the bolt to the clockwork: it will only open when the clock runs again.</p>' }) },

    /* Belfry */
    { id: 'clockface', room: 'belfry', name: 'Back of the clock face', hot: [106, 18, 188, 188],
      look: (v) => ({ art: closeups.clockface(v), text: v.flags.freed ? '<p>The hands rest where you set them. Below, the hidden panel stands open.</p>' : '<p>Through a maintenance gap you can reach the great hands. Set the hour and the minutes by hand.</p>' }),
      lock: { slots: [Array.from({ length: 12 }, (_, i) => String(i + 1)), Array.from({ length: 12 }, (_, i) => pad(i * 5))], labels: ['Hour', 'Minutes'], flag: 'freed', verb: 'Set the hands',
        check: (sec, val) => val[0] + 1 === sec.hour && val[1] * 5 === sec.minute, format: (val) => `${val[0] + 1}:${pad(val[1] * 5)}`,
        msg: (p, t) => `${p.name} set the clock to ${t}. The bell tolled, and a hidden panel slid open. Elias Thorne is alive!`,
        solve: (v) => (seenAll(v, 'clipping', 'tally', 'letter') ? [v.facts.hour - 1, v.facts.minute / 5] : null) } },
    { id: 'letter', room: 'belfry', name: 'Letter on the beam', hot: [304, 14, 54, 40],
      look: () => ({ text: '<span class="esc-paper">Whoever finds this: I am shut in behind the clock face. The panel opens only when the hands show the moment I was trapped. <b>The bell told the town the hour. My chalk marks hold the minutes.</b><br>Please hurry. — E.T.</span>' }),
      clue: () => 'Set the hands to the moment Elias was trapped: the bell’s count is the hour, the chalk marks are the minutes.' },
    { id: 'bell', room: 'belfry', name: 'Great bell', hot: [296, 60, 100, 118],
      look: () => ({ text: '<p>Green bronze, taller than any of you. An inscription runs around the rim: <i>I keep the hours so you may keep your days.</i></p>' }) },
    { id: 'keeper', room: 'belfry', name: 'Elias Thorne', hot: [16, 86, 84, 150], when: (s) => s.flags.freed,
      look: (v) => ({ art: closeups.keeper(), text: v.flags['took:keeper'] ? '<p>“The front door will answer to that key. Let’s go home.”</p>' : '<p>“Three days I’ve been in there, living on rainwater and repair biscuits! The panel sealed when the escapement jammed.” He presses something heavy into your hand. “My tower key. The front door answers to nothing else.”</p>' }),
      take: { item: 'towerkey', label: 'Accept the tower key', msg: (p) => `Elias gave ${p.name} his tower key.` } },
  ],
  objectives: [
    { id: 'toolbox', label: 'Open the Keeper’s toolbox', done: (s) => !!s.flags.toolbox,
      hints: [() => 'Read the note on the workbench in the workshop.', () => 'The painting’s plaque shows the year the tower was raised, written in Roman numerals.', (s) => `The toolbox code is <b>${s.secret.year}</b>.`] },
    { id: 'stairs', label: 'Get through the stair door', done: (s) => !!s.flags.stairs,
      hints: [() => 'The toolbox held a key. It is in your shared inventory.', () => 'Open the door at the top of the stairs and choose the study key under “Use an item here”.'] },
    { id: 'clock', label: 'Restart the great clock', done: restarted,
      hints: [() => 'Elias’s journal in the study explains what a stopped clock needs.', () => 'Three repairs in the gear loft: the oil can (workshop tool rack) on the pendulum, the winding crank (study fireplace) on the weights, and a spare gear (hidden behind the study bookshelf) on the gear train.',
        (s) => `The bookshelf opens when the spines match the window read from the bottom up: <b>${shelfAnswer(s.secret.window).map((i) => SYMS[i]).join(', ')}</b>.`] },
    { id: 'time', label: 'Find Elias Thorne', done: (s) => !!s.flags.freed,
      hints: [() => 'Read the letter on the beam in the belfry.', () => 'The newspaper clipping in the workshop says how many times the bell struck. The chalk tally in the gear loft counts the minutes.', (s) => `Set the clock’s hands to <b>${s.secret.hour}:${pad(s.secret.minute)}</b>.`] },
    { id: 'escape', label: 'Escape the tower', done: (s) => !!s.flags.escaped,
      hints: [() => 'Talk to Elias in the belfry.', () => 'Use the tower key on the front door in the workshop.'] },
  ],
  ending: (v) => ({
    title: 'The Keeper is found',
    art: closeups.keeper(),
    text: [
      'The great bell rings out over Halloway for the first time in three nights. Down in the workshop, the front door’s bolts slide back, and you step into a cold, bright dawn with Elias Thorne leaning on your shoulders.',
      `“The storm jammed the escapement,” he explains, “and my own safety panel sealed me in behind the face. I built it to open only at the moment the clock stopped, so nobody could set it off by accident. I never thought I’d be on the wrong side of it.” He looks up at the tower, ticking again. “Thank you${v.players.length > 1 ? ', all of you' : ''}.”`,
    ],
  }),
});
