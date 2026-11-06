// Tambola (Housie): the 90-ball game. Each ticket is 3 rows × 9 columns with 15 numbers: five in every row,
// one to three in every column, column c holding its own tens (1–9, 10–19 … 80–90), sorted top to bottom.
// Several prizes per game, the last being Full House. Calling, claims and the screen come from caller-kit.js.
import { shuffle, rand } from '../js/util.js';
import { callerGame } from './caller-kit.js';

const colRange = (c) => (c === 0 ? [1, 9] : c === 8 ? [80, 90] : [c * 10, c * 10 + 9]);

export function makeTicket() {
  for (;;) {
    // How many numbers each column gets: one each, then six more, never above 3.
    const counts = Array(9).fill(1);
    for (let extra = 6; extra;) { const c = rand(9); if (counts[c] < 3) { counts[c]++; extra--; } }
    // Which rows they sit in: fullest columns first, each into the emptiest rows (ties broken at random).
    const used = [0, 0, 0], at = Array.from({ length: 9 }, () => []);
    for (const c of shuffle([...Array(9).keys()]).sort((a, b) => counts[b] - counts[a])) {
      const rows = shuffle([0, 1, 2]).sort((a, b) => used[a] - used[b]).slice(0, counts[c]).sort();
      rows.forEach((r) => used[r]++);
      at[c] = rows;
    }
    if (!used.every((n) => n === 5)) continue; // rare: try again
    const rows = [0, 1, 2].map(() => Array(9).fill(null));
    at.forEach((rs, c) => {
      const [lo, hi] = colRange(c);
      const nums = shuffle(Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)).slice(0, rs.length).sort((a, b) => a - b);
      rs.forEach((r, i) => { rows[r][c] = nums[i]; });
    });
    return { rows };
  }
}

function goal(card, id) {
  const R = card.rows.map((row) => row.filter((x) => x != null)), all = R.flat();
  if (id === 'early5') return { sets: [all], need: 5 };
  if (id === 'top') return { sets: [R[0]] };
  if (id === 'middle') return { sets: [R[1]] };
  if (id === 'bottom') return { sets: [R[2]] };
  if (id === 'line') return { sets: R };
  if (id === 'corners') return { sets: [[R[0][0], R[0].at(-1), R[2][0], R[2].at(-1)]] };
  return { sets: [all] }; // full house
}

const PRIZES = {
  classic: [
    { id: 'early5', name: 'Early Five', short: 'Early 5', pts: 10 },
    { id: 'top', name: 'Top Line', short: 'Top', pts: 15 },
    { id: 'middle', name: 'Middle Line', short: 'Middle', pts: 15 },
    { id: 'bottom', name: 'Bottom Line', short: 'Bottom', pts: 15 },
    { id: 'corners', name: 'Four Corners', short: 'Corners', pts: 15 },
    { id: 'full', name: 'Full House', short: 'Full House', pts: 40, last: true },
  ],
  quick: [
    { id: 'early5', name: 'Early Five', short: 'Early 5', pts: 10 },
    { id: 'line', name: 'Any Line', short: 'Line', pts: 20 },
    { id: 'full', name: 'Full House', short: 'Full House', pts: 40, last: true },
  ],
};

// Traditional calls (a family-friendly selection); every other number is read digit by digit.
const NICK = {
  1: 'Kelly’s eye', 2: 'One little duck', 3: 'Cup of tea', 4: 'Knock at the door', 5: 'Man alive', 7: 'Lucky seven',
  8: 'Garden gate', 9: 'Doctor’s orders', 10: 'A big fat ten', 11: 'Legs eleven', 12: 'One dozen', 13: 'Unlucky for some',
  16: 'Sweet sixteen', 18: 'Coming of age', 21: 'Key of the door', 22: 'Two little ducks', 26: 'Pick and mix',
  33: 'All the threes', 44: 'All the fours', 45: 'Halfway there', 50: 'Half a century', 55: 'All the fives',
  66: 'Clickety click', 77: 'Sunset strip', 89: 'Nearly there', 90: 'Top of the shop',
};
const spoken = (n) => (n < 10 ? `Single number ${n}` : `${Math.floor(n / 10)} and ${n % 10}, ${n}`);

const game = callerGame({
  id: 'tambola', name: 'Tambola', max: 90,
  description: 'Housie night! Numbers 1 to 90 are called for everyone. Race for Early Five, the lines, the corners and the Full House. For 2–8.',
  options: [{ id: 'prizes', label: 'Prizes', default: 'classic', choices: [['classic', 'Classic (6 prizes)'], ['quick', 'Quick (3 prizes)']] }],
  prizes: (opts) => PRIZES[opts.prizes] || PRIZES.classic,
  makeCard: makeTicket, goal,
  ballClass: (n) => `tambola-b${Math.min(8, Math.floor(n / 10))}`,
  ballText: (n) => String(n),
  label: (n) => String(n),
  nick: (n) => NICK[n] || '',
  speak: (n) => (NICK[n] ? `${NICK[n]}, ${n}` : spoken(n)),
  boardRows: () => Array.from({ length: 9 }, (_, r) => Array.from({ length: 10 }, (_, i) => r * 10 + i + 1)),
  howTo: {
    goal: 'Score the most points by claiming prizes on your ticket. The game ends with the Full House.',
    turn: [
      ['🎟️', 'Your ticket', '15 numbers in 3 rows of five. Each column holds its own tens: 1–9, 10–19 … 80–90.'],
      ['📣', 'Numbers are called', 'A number from 1 to 90 every few seconds, often with its traditional call: “Legs eleven, 11!”'],
      ['✍️', 'Mark and claim', 'Tap called numbers to mark them (or switch on Auto-mark), then claim a prize: Early Five (any 5), Top, Middle or Bottom Line, Four Corners (first and last of the top and bottom rows) and Full House.'],
      ['🤝', 'Shared prizes', 'Everyone who has a prize on the same number can claim it before the next call and shares it.'],
    ],
    tips: ['A wrong claim is a bogey: no claims for the next 3 numbers.', 'A prize lights up when your marks complete it.', 'Choose Quick prizes in the lobby for a shorter game: Early Five, Any Line and Full House.'],
  },
  cover: coverSVG(),
  style: `
.tambola-felt{background:
  radial-gradient(110% 55% at 50% -12%,rgba(255,170,60,.30),transparent 60%),
  radial-gradient(80% 60% at 0% 110%,rgba(255,80,120,.20),transparent 60%),
  linear-gradient(180deg,#5a1a3c,#2a0d26)}
.tambola-felt::before{content:"";position:absolute;left:0;right:0;top:6px;height:12px;pointer-events:none;opacity:.7;
  background:radial-gradient(circle at 9px 6px,#ffb02e 0 4px,transparent 5px) 0 0/18px 12px repeat-x}
.tambola-card{--card-w:620px;--ink-1:#2fc3a0;--ink-2:#0c8a6e;position:relative;background:linear-gradient(180deg,#fff8e6,#f7e7c2);border:2px dashed rgba(196,98,0,.45);outline:3px solid #f59e0b;outline-offset:3px}
.tambola-card .cl-grid{gap:5px}
.tambola-card .cl-cell{aspect-ratio:auto;height:54px;min-height:0;font-size:1.25rem}
.tambola-card .cl-cell.blank{background:repeating-linear-gradient(135deg,rgba(196,98,0,.10) 0 6px,rgba(196,98,0,.03) 6px 12px)}
.tambola-b0{--b1:#ff8a8a;--b2:#c92a3a}.tambola-b1{--b1:#ffb36b;--b2:#d9661b}.tambola-b2{--b1:#ffe07a;--b2:#d4a00e}
.tambola-b3{--b1:#9be86f;--b2:#3f9a1d}.tambola-b4{--b1:#6ee7c8;--b2:#0f9a7a}.tambola-b5{--b1:#7ad3ff;--b2:#1d7fc4}
.tambola-b6{--b1:#a5a8ff;--b2:#4a4fd0}.tambola-b7{--b1:#e19bff;--b2:#9b38c9}.tambola-b8{--b1:#ff9bd2;--b2:#c42a85}
.tambola-board .cl-brow{--bcols:10}
@media (max-width:480px){
  .tambola-card{outline-width:2px;outline-offset:2px}
  .tambola-card .cl-grid{gap:3px}
  .tambola-card .cl-cell{height:44px;font-size:.95rem;border-radius:7px}
}
`,
});

export default game;

/* Cover art: Housie on a festival night. Under strings of lights and a marigold garland, a grandmother holds up
   the “22” card (two little ducks) while two cousins check their tickets (self-contained ids, prefixed tbc-). */
function coverSVG() {
  const lights = Array.from({ length: 16 }, (_, i) => { const x = 8 + i * 20, y = 18 + Math.sin(i * 0.8) * 4 + (i % 2) * 3; return `<circle cx="${x}" cy="${y}" r="3" fill="${['#ffd25c', '#ff7a9c', '#7ad3ff', '#9be86f'][i % 4]}"/><circle cx="${x}" cy="${y}" r="6" fill="${['#ffd25c', '#ff7a9c', '#7ad3ff', '#9be86f'][i % 4]}" opacity=".18"/>`; }).join('');
  const marigolds = Array.from({ length: 22 }, (_, i) => { const x = 4 + i * 15, y = 36 + Math.sin(i * 0.55) * 6; return `<circle cx="${x}" cy="${y}" r="5.5" fill="${i % 2 ? '#ff9f1c' : '#ffc43d'}"/><circle cx="${x}" cy="${y}" r="2" fill="#d96a00"/>`; }).join('');
  const ticket = (x, y, rot, marks) => {
    const cells = Array.from({ length: 27 }, (_, i) => {
      const r = Math.floor(i / 9), c = i % 9, has = (i * 7 + r) % 9 < 5, cx = x + 3 + c * 7.6, cy = y + 4 + r * 9;
      return has ? `<rect x="${cx}" y="${cy}" width="6.6" height="7.6" rx="1.3" fill="#fff"/>${marks.includes(i) ? `<circle cx="${cx + 3.3}" cy="${cy + 3.8}" r="3" fill="#0c8a6e" opacity=".85"/>` : ''}` : `<rect x="${cx}" y="${cy}" width="6.6" height="7.6" rx="1.3" fill="#f0d9a8"/>`;
    }).join('');
    return `<g transform="rotate(${rot} ${x + 36} ${y + 16})"><rect x="${x}" y="${y}" width="74" height="34" rx="4" fill="#fff4d6" stroke="#f59e0b" stroke-width="1.6"/>${cells}</g>`;
  };
  return `<svg viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="tbc-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a0f3a"/><stop offset="1" stop-color="#1c0820"/></linearGradient>
    <radialGradient id="tbc-warm" cx=".5" cy=".55" r=".7"><stop offset="0" stop-color="#ff9f43" stop-opacity=".35"/><stop offset="1" stop-color="#ff9f43" stop-opacity="0"/></radialGradient>
    <linearGradient id="tbc-rug" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b3204a"/><stop offset="1" stop-color="#6e0f2c"/></linearGradient>
    <linearGradient id="tbc-sari" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff7a1a"/><stop offset="1" stop-color="#d43f00"/></linearGradient>
    <linearGradient id="tbc-kurta1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3ec7d6"/><stop offset="1" stop-color="#1b8a9c"/></linearGradient>
    <linearGradient id="tbc-kurta2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9b6bff"/><stop offset="1" stop-color="#5b33c9"/></linearGradient>
  </defs>
  <rect width="320" height="200" fill="url(#tbc-sky)"/>
  <rect width="320" height="200" fill="url(#tbc-warm)"/>
  <path d="M0 18 Q80 30 160 18 T320 18" stroke="#2a1430" stroke-width="1" fill="none"/>${lights}
  <path d="M0 36 Q80 48 160 36 T320 36" stroke="#3a7a20" stroke-width="2" fill="none"/>${marigolds}
  <!-- rug -->
  <path d="M0 150 L320 150 L320 200 L0 200z" fill="url(#tbc-rug)"/>
  <path d="M0 158 h320" stroke="#ffc43d" stroke-width="2" stroke-dasharray="6 5"/>
  <!-- diyas -->
  ${[[28, 168], [292, 170]].map(([x, y]) => `<g transform="translate(${x} ${y})"><path d="M-12 0 q12 12 24 0z" fill="#c2611a"/><path d="M0 -2 q-4 -8 0 -14 q4 6 0 14z" fill="#ffd25c"/><circle cy="-8" r="9" fill="#ffd25c" opacity=".2"/></g>`).join('')}
  <!-- grandmother caller, holding up 22 -->
  <g transform="translate(160 88)">
    <path d="M-34 62 q34 -40 68 0 v12 h-68z" fill="url(#tbc-sari)"/>
    <path d="M-30 50 q30 -30 50 -8" stroke="#ffd25c" stroke-width="3" fill="none"/>
    <circle cx="0" cy="12" r="20" fill="#b77a4e"/>
    <path d="M-21 10 q2 -26 21 -26 q19 0 21 26 q-6 -12 -21 -13 q-15 1 -21 13z" fill="#d9d9e3"/>
    <circle cx="0" cy="-15" r="6" fill="#d9d9e3"/>
    <circle cx="0" cy="6" r="2" fill="#c41d5e"/>
    <circle cx="-7" cy="13" r="2.2" fill="#2a1a10"/><circle cx="7" cy="13" r="2.2" fill="#2a1a10"/>
    <path d="M-7 21 q7 7 14 0" stroke="#6a2a1a" stroke-width="2.2" fill="none" stroke-linecap="round"/>
    <path d="M26 46 q20 -14 18 -46" stroke="#b77a4e" stroke-width="8" fill="none" stroke-linecap="round"/>
    <g transform="translate(46 -22) rotate(8)"><rect x="-20" y="-16" width="40" height="32" rx="6" fill="#fff8e6" stroke="#f59e0b" stroke-width="2"/>
      <text y="9" text-anchor="middle" font-family="Fredoka,sans-serif" font-weight="700" font-size="24" fill="#c42a85">22</text></g>
    <g transform="translate(-58 -20)"><path d="M0 0 q6 -8 12 0 q4 -2 6 2 l-4 2 q2 8 -8 10 q-10 0 -10 -8 q0 -4 4 -6z" fill="#ffd25c"/><circle cx="9" cy="-2" r="1.2" fill="#1a1a1a"/><path d="M16 4 l5 1" stroke="#ff8a1a" stroke-width="2"/></g>
    <g transform="translate(-40 -32) scale(.8)"><path d="M0 0 q6 -8 12 0 q4 -2 6 2 l-4 2 q2 8 -8 10 q-10 0 -10 -8 q0 -4 4 -6z" fill="#ffd25c"/><circle cx="9" cy="-2" r="1.2" fill="#1a1a1a"/><path d="M16 4 l5 1" stroke="#ff8a1a" stroke-width="2"/></g>
  </g>
  <!-- cousins with tickets -->
  <g transform="translate(70 118)">
    <path d="M-24 42 q24 -30 48 0 v10 h-48z" fill="url(#tbc-kurta1)"/>
    <circle cx="0" cy="10" r="15" fill="#c98a5e"/><path d="M-15 8 q0 -20 15 -20 q16 0 15 20 q-4 -10 -15 -11 q-11 1 -15 11z" fill="#1d1430"/>
    <circle cx="-5" cy="11" r="1.8" fill="#1a0f08"/><circle cx="5" cy="11" r="1.8" fill="#1a0f08"/><path d="M-5 17 q5 5 10 0" stroke="#6a2a1a" stroke-width="1.8" fill="none" stroke-linecap="round"/>
  </g>
  ${ticket(30, 148, -6, [0, 4, 11, 20, 25])}
  <g transform="translate(252 116)">
    <path d="M-24 44 q24 -30 48 0 v10 h-48z" fill="url(#tbc-kurta2)"/>
    <circle cx="0" cy="11" r="15" fill="#a86a42"/><path d="M-16 14 q-2 -26 16 -26 q18 0 16 26 l-4 -10 q-12 -8 -24 0z" fill="#2a1430"/>
    <circle cx="-5" cy="12" r="1.8" fill="#1a0f08"/><circle cx="5" cy="12" r="1.8" fill="#1a0f08"/><path d="M-6 18 q6 6 12 0z" fill="#7a2a2a"/>
    <path d="M20 40 q14 -18 10 -40" stroke="#a86a42" stroke-width="6" fill="none" stroke-linecap="round"/>
  </g>
  ${ticket(214, 152, 5, [2, 9, 13, 18, 22, 26])}
  <g fill="#ffd25c"><path d="M296 60 l2 6 l6 2 l-6 2 l-2 6 l-2 -6 l-6 -2 l6 -2z"/><path d="M24 72 l1.5 4 l4 1.5 l-4 1.5 l-1.5 4 l-1.5 -4 l-4 -1.5 l4 -1.5z"/></g>
</svg>`;
}
