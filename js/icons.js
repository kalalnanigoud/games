// One matching icon set for every control: 24px line icons drawn with the current text colour.
//   icon('mic') -> '<svg class="ic">…</svg>'  (decorative; give the button its own label)

const dot = (x, y, r = 1.3) => `<circle cx="${x}" cy="${y}" r="${r}" fill="currentColor" stroke="none"/>`;
const STAR = 'M12 3.6l2.5 5.3 5.8.7-4.3 4 1.1 5.8L12 16.6l-5.1 2.8L8 13.6l-4.3-4 5.8-.7z';

const PATHS = {
  dice: `<rect x="4" y="4" width="16" height="16" rx="4"/>${dot(8.5, 8.5)}${dot(15.5, 8.5)}${dot(12, 12)}${dot(8.5, 15.5)}${dot(15.5, 15.5)}`,
  users: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 19.5c.8-3.4 3.4-5.5 6.5-5.5s5.7 2.1 6.5 5.5M16 5.2a3.4 3.4 0 0 1 0 6.6M18 14.3c1.8.8 3 2.5 3.5 5.2"/>',
  userPlus: '<circle cx="10" cy="8.5" r="3.5"/><path d="M3.5 19.5c.8-3.4 3.4-5.5 6.5-5.5 1.9 0 3.6.8 4.8 2.2M18.5 13v6M15.5 16h6"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 1.5M9.5 3h5"/>',
  level: '<path d="M6 19v-4M12 19v-8M18 19V5"/>',
  star: `<path d="${STAR}"/>`,
  starFill: `<path d="${STAR}" fill="currentColor"/>`,
  mic: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5"/>',
  micOff: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5M4 4l16 16"/>',
  headset: '<path d="M4.5 15v-3a7.5 7.5 0 0 1 15 0v3"/><rect x="3.5" y="14" width="4" height="6" rx="1.5"/><rect x="16.5" y="14" width="4" height="6" rx="1.5"/>',
  hangUp: '<path d="M3 14.2c5-4.6 13-4.6 18 0l-2.3 2.6-3.7-1.5v-2.6a12 12 0 0 0-6 0v2.6l-3.7 1.5z"/>',
  volume: '<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  volumeOff: '<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4zM16 10l5 5M21 10l-5 5"/>',
  logout: '<path d="M14 4h4.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14M10 8l-4 4 4 4M6 12h10"/>',
  share: '<circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="M8.2 10.8l7.6-4.1M8.2 13.2l7.6 4.1"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  bot: `<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 8V5M9.5 16h5M3 12.5v3M21 12.5v3"/>${dot(12, 4, 1.2)}${dot(9.5, 12.5)}${dot(14.5, 12.5)}`,
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  seat: '<path d="M7 11V5.5A1.5 1.5 0 0 1 8.5 4h7A1.5 1.5 0 0 1 17 5.5V11M5 11h14v3H5zM7 14v6M17 14v6"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4"/>',
  rematch: '<path d="M4.5 11a7.5 7.5 0 0 1 13.3-4.2L20 9M20 4v5h-5M19.5 13a7.5 7.5 0 0 1-13.3 4.2L4 15M4 20v-5h5"/>',
  restart: '<path d="M4.5 12a7.5 7.5 0 1 0 2.3-5.4L4.5 9M4.5 4v5h5"/>',
  more: `${dot(5.5, 12, 1.7)}${dot(12, 12, 1.7)}${dot(18.5, 12, 1.7)}`,
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  help: `<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .9-1 1.5v.6"/>${dot(12, 16.9, 1.1)}`,
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.5 3.5 5.4 3.5 8.5s-1.1 6-3.5 8.5C9.6 18 8.5 15.1 8.5 12s1.1-6 3.5-8.5z"/>',
  phone: '<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 17.5h2"/>',
  crown: '<path d="M4 8.5l4 3.5 4-6 4 6 4-3.5-1.5 9.5h-13z"/>',
  shield: '<path d="M12 3.5l7 3v5c0 4.4-2.9 7.6-7 9-4.1-1.4-7-4.6-7-9v-5z"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  door: `<path d="M5.5 20V5.5A1.5 1.5 0 0 1 7 4h10a1.5 1.5 0 0 1 1.5 1.5V20M3 20h18"/>${dot(15, 12.5, 1.1)}`,
  chevron: '<path d="M6 9l6 6 6-6"/>',
  sparkle: '<path d="M12 3.5l2 5.5 5.5 2-5.5 2-2 5.5-2-5.5-5.5-2 5.5-2z"/>',
  wifi: `<path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.8 16a5 5 0 0 1 6.4 0"/>${dot(12, 19.3, 1.2)}`,
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3L19.5 9M19.5 4v5h-5"/>',
  book: '<path d="M12 6.5C10.5 5 8.3 4.5 4.5 4.5v13c3.8 0 6 .5 7.5 2 1.5-1.5 3.7-2 7.5-2v-13c-3.8 0-6 .5-7.5 2zM12 6.5v13"/>',
  bulb: '<path d="M9.5 17.5h5M10.5 20.5h3M12 3.5a5.5 5.5 0 0 0-3.3 9.9c.7.6 1.1 1.4 1.1 2.3v.3h4.4v-.3c0-.9.4-1.7 1.1-2.3A5.5 5.5 0 0 0 12 3.5z"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
};

export function icon(name, cls = '') {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[name] || ''}</svg>`;
}
