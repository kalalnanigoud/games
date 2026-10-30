// Tournaments, run by the host on top of normal games.
//   series:   everyone plays each game in a list; every win scores a point.
//   knockout: one-on-one matches of a single game in a bracket; everyone else watches.
// Plain JSON, so the tournament is saved with the room and sent to every player.

const shuffled = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

function pairUp(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 2) out.push(ids[i + 1] ? { a: ids[i], b: ids[i + 1], w: null, draws: 0 } : { a: ids[i], b: null, w: ids[i], draws: 0 });
  return out;
}

export function createTour(mode, games, entrants) {
  if (!['series', 'knockout'].includes(mode)) throw Error('Choose a tournament type.');
  if (entrants.length < 2) throw Error('A tournament needs at least 2 players.');
  if (!games.length) throw Error('Choose at least one game.');
  return {
    mode, games: mode === 'knockout' ? games.slice(0, 1) : games.slice(),
    entrants: entrants.map((p) => ({ id: p.id, name: p.name })),
    wins: Object.fromEntries(entrants.map((p) => [p.id, 0])),
    rounds: mode === 'knockout' ? [pairUp(shuffled(entrants.map((p) => p.id)))] : null,
    idx: 0, gameNo: 0, recorded: 0, history: [], done: false, champions: [],
  };
}

const openMatch = (t) => t.rounds?.at(-1).find((m) => !m.w);

// The next game to play: which game, and who sits at the table.
export function currentMatch(t) {
  if (t.done) return null;
  if (t.mode === 'series') return { gameId: t.games[t.idx], seats: t.entrants.map((p) => p.id) };
  const m = openMatch(t);
  return m ? { gameId: t.games[0], seats: [m.a, m.b] } : null;
}

// Score a finished game. Returns a sentence for the log.
export function recordResult(t, state) {
  const name = (id) => t.entrants.find((p) => p.id === id)?.name || '?';
  const winners = (state.winners || []).filter((id) => t.wins[id] != null);
  t.recorded = t.gameNo;
  if (t.mode === 'series') {
    winners.forEach((id) => t.wins[id]++);
    t.history.push({ game: t.games[t.idx], winners });
    t.idx++;
    if (t.idx >= t.games.length) finish(t);
    return winners.length ? `${winners.map(name).join(' & ')} won game ${t.idx}.` : `Nobody won game ${t.idx}.`;
  }
  const m = openMatch(t);
  let line;
  if (winners.length === 1 && (winners[0] === m.a || winners[0] === m.b)) {
    m.w = winners[0];
    line = `${name(m.w)} beat ${name(m.w === m.a ? m.b : m.a)}.`;
  } else if (++m.draws >= 3) {
    m.w = Math.random() < 0.5 ? m.a : m.b; // three draws in a row: settle it with a coin toss
    line = `Three draws! ${name(m.w)} goes through on a coin toss.`;
  } else line = `${name(m.a)} and ${name(m.b)} drew. Rematch!`;
  if (m.w) t.wins[m.w]++;
  t.history.push({ game: t.games[0], winners, pair: [m.a, m.b] });
  const round = t.rounds.at(-1);
  if (round.every((x) => x.w)) {
    const through = round.map((x) => x.w);
    if (through.length === 1) finish(t, through);
    else t.rounds.push(pairUp(through));
  }
  return line;
}

function finish(t, champions) {
  t.done = true;
  if (!champions) {
    const best = Math.max(...Object.values(t.wins));
    champions = t.entrants.filter((p) => t.wins[p.id] === best).map((p) => p.id);
  }
  t.champions = champions;
}

export function standings(t) {
  return t.entrants.map((p) => ({ ...p, wins: t.wins[p.id] })).sort((a, b) => b.wins - a.wins);
}

// One line describing where the tournament stands.
export function tourLine(t, gameName) {
  const name = (id) => t.entrants.find((p) => p.id === id)?.name || '?';
  if (t.done) return `🏆 Champion${t.champions.length > 1 ? 's' : ''}: ${t.champions.map(name).join(' & ')}`;
  if (t.mode === 'series') return `🏆 Series · game ${t.idx + 1} of ${t.games.length}: ${gameName(t.games[t.idx])}`;
  const m = openMatch(t), round = t.rounds.length, left = t.rounds.at(-1).length;
  return `🏆 Knockout · ${left === 1 ? 'Final' : left === 2 ? 'Semi-final' : 'Round ' + round}: ${name(m.a)} vs ${name(m.b)}`;
}
