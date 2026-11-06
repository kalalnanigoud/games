// Bingo: the 75-ball game. A 5×5 card under B-I-N-G-O, a free space in the middle, and one winning pattern
// chosen in the lobby. Calling, claims, computer players and the screen come from caller-kit.js.
import { shuffle } from '../js/util.js';
import { callerGame } from './caller-kit.js';

const LETTERS = 'BINGO';
const letterOf = (n) => LETTERS[Math.floor((n - 1) / 15)];
const GOALS = { line: 'Any line', corners: 'Four corners', x: 'The X', full: 'Full card' };

// Five different numbers in each column from that letter's range (B 1–15 … O 61–75); the centre is free (0).
function makeCard() {
  const cols = Array.from({ length: 5 }, (_, c) => shuffle(Array.from({ length: 15 }, (_, i) => c * 15 + i + 1)).slice(0, 5));
  const rows = Array.from({ length: 5 }, (_, r) => cols.map((col) => col[r]));
  rows[2][2] = 0;
  return { rows };
}

function goal(card, id) {
  const R = card.rows, idx = [0, 1, 2, 3, 4];
  const diag = idx.map((i) => R[i][i]), anti = idx.map((i) => R[i][4 - i]);
  if (id === 'corners') return { sets: [[R[0][0], R[0][4], R[4][0], R[4][4]]] };
  if (id === 'x') return { sets: [[...diag, ...anti.filter((_, i) => i !== 2)]] };
  if (id === 'full') return { sets: [R.flat()] };
  return { sets: [...R, ...idx.map((c) => R.map((row) => row[c])), diag, anti] }; // any row, column or diagonal
}

const game = callerGame({
  id: 'bingo', name: 'Bingo', max: 75,
  description: 'The classic 75-ball game. Numbers are called out for everyone; mark your card and be first to shout BINGO! For 2–8.',
  options: [{ id: 'goal', label: 'Winning pattern', default: 'line', choices: Object.entries(GOALS) }],
  prizes: (opts) => {
    const g = GOALS[opts.goal] ? opts.goal : 'line';
    return [{ id: g, name: `Bingo (${GOALS[g].toLowerCase()})`, claim: 'BINGO!', short: 'Bingo', pts: 1, last: true }];
  },
  makeCard, goal,
  heads: [...LETTERS], headClass: (i) => `bingo-h${i}`,
  ballClass: (n) => `bingo-b${Math.floor((n - 1) / 15)}`,
  ballText: (n) => `<small>${letterOf(n)}</small>${n}`,
  label: (n) => `${letterOf(n)} ${n}`,
  speak: (n) => `${letterOf(n)}. ${n}`,
  boardRows: () => Array.from({ length: 5 }, (_, r) => Array.from({ length: 15 }, (_, i) => r * 15 + i + 1)),
  howTo: {
    goal: 'Be the first to complete the winning pattern on your card and claim BINGO!',
    turn: [
      ['🎱', 'Numbers are called', 'A ball is drawn every few seconds, like “B 7” or “N 42”. The countdown ring shows when the next one comes.'],
      ['✍️', 'Mark your card', 'Tap a called number on your card to mark it (or switch on Auto-mark). The middle square is free.'],
      ['🏁', 'Claim BINGO!', 'When your marks make the pattern (any line, four corners, the X or the full card, chosen in the lobby), press BINGO!. The host checks it against the numbers called.'],
      ['🤝', 'Same number, shared win', 'Anyone else who has it on the same number can still claim before the next ball, and shares the win.'],
    ],
    tips: ['A wrong claim is a bogey: no claims for the next 3 numbers.', 'The BINGO! button lights up when your marks complete the pattern.', 'Turn on “Read numbers aloud” to hear each call.'],
  },
  cover: coverSVG(),
  style: `
.bingo-felt{--table-1:#1b1e5e;--table-2:#2a1f6e;--table-3:#120f3a;background:
  radial-gradient(120% 60% at 50% -10%,rgba(255,92,170,.28),transparent 60%),
  radial-gradient(90% 70% at 100% 110%,rgba(64,220,255,.18),transparent 60%),
  linear-gradient(180deg,#24206a,#141243)}
.bingo-felt::before{content:"";position:absolute;left:12px;right:12px;top:8px;height:6px;border-radius:6px;background:repeating-linear-gradient(90deg,#ffe58a 0 6px,transparent 6px 18px);opacity:.55;pointer-events:none}
.bingo-card{--card-w:430px;--ink-1:#ff7aa8;--ink-2:#e0246b;background:linear-gradient(180deg,#fffaf0,#f6ecd6)}
.bingo-h0{background:linear-gradient(180deg,#5b8cff,#2f56c9)}.bingo-h1{background:linear-gradient(180deg,#ff6b6b,#c92a3a)}
.bingo-h2{background:linear-gradient(180deg,#a3abc8,#5d6688)}.bingo-h3{background:linear-gradient(180deg,#4ade80,#16a34a)}
.bingo-h4{background:linear-gradient(180deg,#ffc24a,#e58a00)}
.bingo-b0{--b1:#7aa7ff;--b2:#2f56c9}.bingo-b1{--b1:#ff8a8a;--b2:#c92a3a}.bingo-b2{--b1:#e4e8f5;--b2:#8a93b3}
.bingo-b3{--b1:#6ee7a0;--b2:#16a34a}.bingo-b4{--b1:#ffd27a;--b2:#e58a00}
.cl-ball i small{display:block;font-size:.55em;line-height:1;opacity:.75}
.bingo-card .cl-cell.free{background:radial-gradient(circle at 50% 40%,#ff7aa8,#c41d5e)}
.bingo-board .cl-brow{--bcols:15}
@media (max-width:480px){.bingo-board .cl-brow span{height:20px;font-size:.62rem}}
`,
});

export default game;

/* Cover art: a neon bingo hall. A caller in a bow tie spins the ball cage under a marquee while a player
   stamps the last number on her card and throws an arm up (self-contained ids, prefixed bgc-). */
function coverSVG() {
  const bulbs = Array.from({ length: 15 }, (_, i) => `<circle cx="${70 + i * 12.9}" cy="16" r="2.6" fill="#ffe58a"/>`).join('');
  const cageBalls = [[-10, 6, '#5b8cff'], [6, 10, '#ff6b6b'], [12, -4, '#4ade80'], [-4, -8, '#ffc24a'], [0, 2, '#e4e8f5']]
    .map(([x, y, c]) => `<circle cx="${x}" cy="${y}" r="5" fill="${c}"/><circle cx="${x - 1.5}" cy="${y - 1.6}" r="1.4" fill="#fff" opacity=".8"/>`).join('');
  const ball = (x, y, r, c, t, l) => `<g transform="translate(${x} ${y})"><circle r="${r}" fill="${c}"/><circle r="${r * 0.62}" fill="#fff"/><circle cx="${-r * 0.35}" cy="${-r * 0.4}" r="${r * 0.22}" fill="#fff" opacity=".7"/>
    <text y="${-r * 0.1}" text-anchor="middle" font-family="Fredoka,sans-serif" font-weight="700" font-size="${r * 0.34}" fill="#14203f">${l}</text>
    <text y="${r * 0.36}" text-anchor="middle" font-family="Fredoka,sans-serif" font-weight="700" font-size="${r * 0.5}" fill="#14203f">${t}</text></g>`;
  const card = Array.from({ length: 25 }, (_, i) => {
    const r = Math.floor(i / 5), c = i % 5, x = 214 + c * 15, y = 122 + r * 11;
    const dab = [0, 6, 12, 18, 24, 2, 11].includes(i);
    return `<rect x="${x}" y="${y}" width="13" height="9.5" rx="2" fill="#fff"/>${dab ? `<circle cx="${x + 6.5}" cy="${y + 4.75}" r="4.2" fill="#e0246b" opacity=".8"/>` : ''}`;
  }).join('');
  return `<svg viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgc-wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b1f78"/><stop offset="1" stop-color="#120f3a"/></linearGradient>
    <radialGradient id="bgc-glow" cx=".5" cy=".1" r=".8"><stop offset="0" stop-color="#ff5caa" stop-opacity=".55"/><stop offset="1" stop-color="#ff5caa" stop-opacity="0"/></radialGradient>
    <linearGradient id="bgc-sign" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff7aa8"/><stop offset="1" stop-color="#c41d5e"/></linearGradient>
    <linearGradient id="bgc-table" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7b4a2e"/><stop offset="1" stop-color="#4a2a18"/></linearGradient>
    <linearGradient id="bgc-podium" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3b3f9a"/><stop offset=".5" stop-color="#5a60c8"/><stop offset="1" stop-color="#3b3f9a"/></linearGradient>
    <radialGradient id="bgc-cage" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#fff" stop-opacity=".25"/><stop offset="1" stop-color="#9ad8ff" stop-opacity=".06"/></radialGradient>
  </defs>
  <rect width="320" height="200" fill="url(#bgc-wall)"/>
  <rect width="320" height="200" fill="url(#bgc-glow)"/>
  <g opacity=".18" fill="#fff">${Array.from({ length: 9 }, (_, i) => `<rect x="${i * 38 - 6}" y="40" width="14" height="110" rx="7"/>`).join('')}</g>
  <!-- marquee -->
  <rect x="62" y="8" width="196" height="40" rx="12" fill="#1a1450" stroke="#ffe58a" stroke-width="2"/>
  ${bulbs}${bulbs.replace(/cy="16"/g, 'cy="40"')}
  <text x="160" y="38" text-anchor="middle" font-family="Fredoka,sans-serif" font-weight="700" font-size="24" letter-spacing="6" fill="url(#bgc-sign)" stroke="#fff" stroke-width=".6">BINGO</text>
  <!-- floating called balls -->
  ${ball(32, 70, 15, '#5b8cff', 7, 'B')}${ball(286, 66, 14, '#4ade80', 55, 'G')}${ball(214, 70, 11, '#ffc24a', 68, 'O')}
  <!-- caller at the podium with the cage -->
  <g transform="translate(78 92)">
    <ellipse cx="0" cy="96" rx="58" ry="8" fill="#000" opacity=".25"/>
    <path d="M-30 30 q30 -18 60 0 v62 h-60z" fill="#232a6b"/>
    <path d="M-8 30 l8 10 l8 -10z" fill="#fff"/><path d="M-7 40 l7 -4 l7 4 l-7 4z" fill="#ff5caa"/>
    <circle cx="0" cy="8" r="18" fill="#f1c39b"/><path d="M-18 4 q2 -22 22 -20 q16 2 15 18 q-6 -10 -20 -9 q-12 1 -17 11z" fill="#3a2418"/>
    <circle cx="-6" cy="9" r="2" fill="#2a1a10"/><circle cx="7" cy="9" r="2" fill="#2a1a10"/><path d="M-6 17 q6 6 12 0" stroke="#7a3a2a" stroke-width="2" fill="none" stroke-linecap="round"/>
    <path d="M24 40 q18 -6 30 -22" stroke="#f1c39b" stroke-width="7" fill="none" stroke-linecap="round"/>
  </g>
  <g transform="translate(140 104)">
    <rect x="-12" y="22" width="24" height="44" rx="4" fill="url(#bgc-podium)"/>
    <circle r="24" fill="url(#bgc-cage)" stroke="#cfe9ff" stroke-width="2"/>
    <path d="M-24 0 h48 M0 -24 v48 M-17 -17 l34 34 M17 -17 l-34 34" stroke="#cfe9ff" stroke-width="1" opacity=".55"/>
    ${cageBalls}
    <path d="M24 0 h10 v-12" stroke="#cfe9ff" stroke-width="3" fill="none" stroke-linecap="round"/>
  </g>
  <!-- table and a player stamping her card -->
  <rect x="180" y="150" width="140" height="50" fill="url(#bgc-table)"/>
  <rect x="180" y="150" width="140" height="4" fill="#a8704a"/>
  <g transform="translate(268 70)">
    <path d="M-28 58 q28 -26 56 0 v20 h-56z" fill="#16a3a3"/>
    <circle cx="0" cy="28" r="17" fill="#c98a5e"/><path d="M-19 30 q-4 -28 19 -28 q22 0 19 28 q-4 -18 -19 -18 q-15 0 -19 18z" fill="#1d1d3a"/>
    <circle cx="-6" cy="30" r="2" fill="#1a0f08"/><circle cx="6" cy="30" r="2" fill="#1a0f08"/><path d="M-7 37 q7 8 14 0z" fill="#7a2a2a"/>
    <path d="M24 66 q16 -30 6 -56" stroke="#c98a5e" stroke-width="7" fill="none" stroke-linecap="round"/>
    <path d="M-22 66 q-14 -2 -20 -12" stroke="#c98a5e" stroke-width="7" fill="none" stroke-linecap="round"/>
    <rect x="-50" y="44" width="10" height="16" rx="3" fill="#ff5caa" transform="rotate(-18 -45 52)"/>
  </g>
  <g transform="rotate(-4 250 150)"><rect x="210" y="118" width="80" height="62" rx="6" fill="#fffaf0"/>${card}</g>
  <!-- sparkles -->
  <g fill="#ffe58a"><path d="M300 24 l2 6 l6 2 l-6 2 l-2 6 l-2 -6 l-6 -2 l6 -2z"/><path d="M22 120 l1.5 4 l4 1.5 l-4 1.5 l-1.5 4 l-1.5 -4 l-4 -1.5 l4 -1.5z"/></g>
</svg>`;
}
