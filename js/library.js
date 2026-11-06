// Browse metadata is editorial: durations are estimates, not timers or promises.
export const GAME_INFO = {
  rally: { category: 'Arcade', minutes: 3, duration: '1–3', difficulty: 'Easy' },
  hexisle: { category: 'Strategy', minutes: 60, duration: '45–60', difficulty: 'Deep' },
  gems: { category: 'Strategy', minutes: 30, duration: '20–30', difficulty: 'Medium' },
  mosaic: { category: 'Strategy', minutes: 30, duration: '20–30', difficulty: 'Medium' },
  bluff: { category: 'Party', minutes: 15, duration: '10–15', difficulty: 'Easy' },
  chess: { category: 'Strategy', minutes: 30, duration: '10–30+', difficulty: 'Deep' },
  sketch: { category: 'Party', minutes: 15, duration: '5–25', difficulty: 'Easy' },
  spies: { category: 'Party', minutes: 20, duration: '15–20', difficulty: 'Medium' },
  bingo: { category: 'Party', minutes: 5, duration: '3–8', difficulty: 'Easy' },
  tambola: { category: 'Party', minutes: 10, duration: '8–12', difficulty: 'Easy' },
  temple: { category: 'Strategy', minutes: 30, duration: '20–30', difficulty: 'Medium', coop: true },
  ember: { category: 'Strategy', minutes: 30, duration: '20–30', difficulty: 'Medium', coop: true },
  keeper: { category: 'Adventure', minutes: 25, duration: '15–30', difficulty: 'Medium', coop: true },
  signal: { category: 'Adventure', minutes: 25, duration: '15–30', difficulty: 'Deep', coop: true },
  island: { category: 'Adventure', minutes: 75, duration: '30–95', difficulty: 'Medium', coop: true, quick: { minutes: 5, option: 'mode', value: 'arena', label: 'Arena Rush' } }, // a lobby option makes it a 5 min run
};
// Quick Play: games that are good on your own. The island is a solo adventure; the board games have
// computer players, and `seats` is the table size Quick Play fills (you plus computers).
export const QUICK_GAMES = [
  { id: 'island', seats: 1 }, { id: 'rally', seats: 1 }, { id: 'gems', seats: 3 }, { id: 'mosaic', seats: 3 },
  { id: 'bluff', seats: 3 }, { id: 'hexisle', seats: 3 }, { id: 'chess', seats: 2 },
];
export const QUICK_DEFAULT = 'island';
export const quickChoice = () => {
  let id = null;
  try { id = localStorage.getItem('gn-quick'); } catch {}
  return QUICK_GAMES.some((q) => q.id === id) ? id : QUICK_DEFAULT;
};
export const setQuickChoice = (id) => { try { localStorage.setItem('gn-quick', id); } catch {} };
const readList = (key) => {
  try { const list = JSON.parse(localStorage.getItem(key)); return Array.isArray(list) ? [...new Set(list.filter((id) => Object.hasOwn(GAME_INFO, id)))] : []; }
  catch { return []; }
};
const writeList = (key, list) => { try { localStorage.setItem(key, JSON.stringify(list)); } catch {} };
export const favorites = () => readList('gn-favorites');
export const recentGames = () => readList('gn-recent');
export function toggleFavorite(id) {
  const ids = favorites();
  writeList('gn-favorites', ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
}
export function rememberPlayed(id) {
  if (Object.hasOwn(GAME_INFO, id)) writeList('gn-recent', [id, ...recentGames().filter((x) => x !== id)].slice(0, 12));
}
export function filterGames(games, filters, saved = favorites(), recent = recentGames()) {
  const query = (filters.query || '').trim().toLowerCase();
  const result = games.filter((g) => {
    const info = GAME_INFO[g.id];
    return info && (!query || `${g.name} ${g.description} ${info.category}`.toLowerCase().includes(query))
      && (!filters.category || info.category === filters.category || (filters.category === 'Cooperative' && info.coop))
      && (!filters.players || (g.minPlayers <= +filters.players && g.maxPlayers >= +filters.players))
      && (!filters.minutes || info.minutes <= +filters.minutes || info.quick?.minutes <= +filters.minutes)
      && (!filters.difficulty || info.difficulty === filters.difficulty)
      && (filters.collection !== 'favorites' || saved.includes(g.id))
      && (filters.collection !== 'recent' || recent.includes(g.id));
  });
  return filters.collection === 'recent' ? result.sort((a, b) => recent.indexOf(a.id) - recent.indexOf(b.id)) : result;
}
