// Browse metadata is editorial: durations are estimates, not timers or promises.
export const GAME_INFO = {
  hexisle: { category: 'Strategy', minutes: 60, duration: '45–60', difficulty: 'Deep' },
  gems: { category: 'Strategy', minutes: 30, duration: '20–30', difficulty: 'Medium' },
  mosaic: { category: 'Strategy', minutes: 30, duration: '20–30', difficulty: 'Medium' },
  bluff: { category: 'Party', minutes: 15, duration: '10–15', difficulty: 'Easy' },
  chess: { category: 'Strategy', minutes: 30, duration: '10–30+', difficulty: 'Deep' },
  sketch: { category: 'Party', minutes: 20, duration: '10–20', difficulty: 'Easy' },
  spies: { category: 'Party', minutes: 20, duration: '15–20', difficulty: 'Medium' },
  temple: { category: 'Strategy', minutes: 30, duration: '20–30', difficulty: 'Medium', coop: true },
  ember: { category: 'Strategy', minutes: 30, duration: '20–30', difficulty: 'Medium', coop: true },
  keeper: { category: 'Adventure', minutes: 45, duration: '25–45', difficulty: 'Medium', coop: true },
  signal: { category: 'Adventure', minutes: 45, duration: '25–45', difficulty: 'Deep', coop: true },
};
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
  if (Object.hasOwn(GAME_INFO, id)) writeList('gn-recent', [id, ...recentGames().filter((x) => x !== id)].slice(0, 11));
}
export function filterGames(games, filters, saved = favorites(), recent = recentGames()) {
  const query = (filters.query || '').trim().toLowerCase();
  const result = games.filter((g) => {
    const info = GAME_INFO[g.id];
    return info && (!query || `${g.name} ${g.description} ${info.category}`.toLowerCase().includes(query))
      && (!filters.category || info.category === filters.category || (filters.category === 'Cooperative' && info.coop))
      && (!filters.players || (g.minPlayers <= +filters.players && g.maxPlayers >= +filters.players))
      && (!filters.minutes || info.minutes <= +filters.minutes)
      && (!filters.difficulty || info.difficulty === filters.difficulty)
      && (filters.collection !== 'favorites' || saved.includes(g.id))
      && (filters.collection !== 'recent' || recent.includes(g.id));
  });
  return filters.collection === 'recent' ? result.sort((a, b) => recent.indexOf(a.id) - recent.indexOf(b.id)) : result;
}
