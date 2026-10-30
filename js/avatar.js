// Player portraits drawn from a player's ID: the same person gets the same face on every device.
// Computer players get a robot. Flat colours only, so many portraits can share a page without SVG id clashes.

const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
export const SEAT_COLORS = ['#ff8fab', '#74c0fc', '#ffd166', '#8ce99a', '#b197fc', '#ffa94d', '#63e6be', '#f783ac'];
const SKIN = ['#ffdbc4', '#f5c39e', '#e0a57a', '#c3814f', '#9a5d36', '#6e4128'];
const HAIR = ['#2b1d16', '#4a2f1f', '#7a4a26', '#c9853a', '#e8c46a', '#3b3f58', '#b84a3a', '#f0eee8'];
const SHIRT = ['#5c7cfa', '#f06595', '#20c997', '#fab005', '#845ef7', '#ff6b6b', '#339af0', '#51cf66'];

const HAIRDO = [
  (c) => `<path d="M19.5 28c-1-9 5-14.5 12.5-14.5S45.5 19 44.5 28c-2.6-4.6-6.8-7-12.5-7s-9.9 2.4-12.5 7z" fill="${c}"/>`,
  (c) => `<path d="M18 40c-2.5-6-3-11.5-1-16 2.3-6.5 8-10.5 15-10.5s12.7 4 15 10.5c2 4.5 1.5 10-1 16-1.3-5-2.4-9.5-3.2-13.5-3-2.8-6.4-4.2-10.8-4.2s-7.8 1.4-10.8 4.2C20.4 30.5 19.3 35 18 40z" fill="${c}"/>`,
  (c) => `<circle cx="32" cy="12.5" r="5.5" fill="${c}"/><path d="M19.5 28c-1-9 5-14.5 12.5-14.5S45.5 19 44.5 28c-2.6-4.6-6.8-7-12.5-7s-9.9 2.4-12.5 7z" fill="${c}"/>`,
  (c) => [[22, 21, 5], [28, 16.5, 5.5], [36, 16.5, 5.5], [42, 21, 5], [20, 27, 4], [44, 27, 4]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/>`).join(''),
  (c) => `<path d="M20 27l2-9 4 4 3-8 3 7 3-7 3 8 4-4 2 9c-3-4-7-5.8-12-5.8S23 23 20 27z" fill="${c}"/>`,
  (c, shirt) => `<path d="M18.5 26.5c0-8 6-13 13.5-13s13.5 5 13.5 13z" fill="${shirt}"/><path d="M17 26h30a2 2 0 0 1 0 4H17a2 2 0 0 1 0-4z" fill="${shirt}" opacity=".75"/>`,
];

export function portrait(p) {
  if (p?.bot) return robot(hash(p.id));
  const h = hash(p?.id || 'x');
  const pick = (list, shift) => list[(h >>> shift) % list.length];
  const bg = SEAT_COLORS[h % SEAT_COLORS.length], skin = pick(SKIN, 3), hair = pick(HAIR, 7), shirt = pick(SHIRT, 11);
  const style = (h >>> 15) % HAIRDO.length, glasses = (h >>> 19) % 4 === 0, grin = (h >>> 21) % 3;
  const mouth = grin === 0 ? '<path d="M27.5 34.5q4.5 4 9 0" fill="none" stroke="#3a2220" stroke-width="1.8" stroke-linecap="round"/>'
    : grin === 1 ? '<path d="M27 33.5h10q-1 5-5 5t-5-5z" fill="#7a2e35"/>'
    : '<circle cx="32" cy="35" r="2.2" fill="#7a2e35"/>';
  return `<svg class="portrait" viewBox="0 0 64 64" aria-hidden="true">
    <circle cx="32" cy="32" r="32" fill="${bg}"/><circle cx="22" cy="16" r="22" fill="#fff" opacity=".16"/>
    <path d="M10 64c1.5-11 10-17 22-17s20.5 6 22 17z" fill="${shirt}"/><path d="M27 47.5h10l-5 5.5z" fill="${skin}"/>
    ${style === 1 ? HAIRDO[1](hair) : ''}
    <circle cx="32" cy="29" r="13" fill="${skin}"/>
    ${style === 1 ? HAIRDO[0](hair) : HAIRDO[style](hair, shirt)}
    <circle cx="27" cy="29.5" r="1.9" fill="#2a1c1a"/><circle cx="37" cy="29.5" r="1.9" fill="#2a1c1a"/>
    <circle cx="24.5" cy="33.5" r="2.3" fill="#ff7f8f" opacity=".35"/><circle cx="39.5" cy="33.5" r="2.3" fill="#ff7f8f" opacity=".35"/>
    ${glasses ? '<g fill="none" stroke="#1d2340" stroke-width="1.6"><circle cx="27" cy="29.5" r="4"/><circle cx="37" cy="29.5" r="4"/><path d="M31 29.5h2"/></g>' : ''}
    ${mouth}
  </svg>`;
}

function robot(h) {
  const body = ['#9775fa', '#4dabf7', '#38d9a9', '#ffa94d'][h % 4];
  return `<svg class="portrait" viewBox="0 0 64 64" aria-hidden="true">
    <circle cx="32" cy="32" r="32" fill="#2b3566"/><circle cx="22" cy="16" r="22" fill="#fff" opacity=".08"/>
    <path d="M12 64c1.5-10 9-15 20-15s18.5 5 20 15z" fill="${body}"/>
    <path d="M32 11v6" stroke="#cfd6ff" stroke-width="2.2" stroke-linecap="round"/><circle cx="32" cy="10" r="2.8" fill="#ffd166"/>
    <rect x="17" y="17" width="30" height="25" rx="8" fill="${body}"/><rect x="21" y="22" width="22" height="13" rx="5" fill="#141b3d"/>
    <rect x="13.5" y="25" width="3.5" height="8" rx="1.7" fill="${body}"/><rect x="47" y="25" width="3.5" height="8" rx="1.7" fill="${body}"/>
    <circle cx="27" cy="28.5" r="2.6" fill="#7efcd4"/><circle cx="37" cy="28.5" r="2.6" fill="#7efcd4"/>
    <path d="M28 38.5h8" stroke="#141b3d" stroke-width="1.8" stroke-linecap="round"/>
  </svg>`;
}
