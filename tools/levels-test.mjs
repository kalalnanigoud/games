// Computer difficulty levels (js/levels.js): for every game with a 'level' option (chess has its own),
//   - the chosen level is stored at setup and shown in every player's view,
//   - head-to-head games: a Hard computer beats an Easy one in most decided games (seats rotate),
//   - co-op games: Hard teammates win more often than Easy ones, or escape in fewer moves.
// Deterministic: seeded random choices. Usage: node tools/levels-test.mjs [games=40] [gameIds...]
import assert from 'node:assert/strict';
import { GAMES } from '../games/index.js';
import { seededRandom } from './seed.mjs';
import { teammateOption } from '../js/levels.js';

globalThis.escapeBotPatience = 0;
const N = Number(process.argv[2] || 40);
const ONLY = process.argv.slice(3);
// Co-op games (computers are teammates) use teammateOption(); everything else plays head to head.
const TEAMMATES = teammateOption().label;
// Games with hidden roles or bluffing have more luck in them; hard must still clearly lead.
const NEEDED = { bluff: 0.55, spies: 0.6, sketch: 0.6, default: 0.62 };
const MAX_STEPS = 20000;
const clone = (x) => JSON.parse(JSON.stringify(x));

function play(g, players, levelFor, opts) {
  let s = g.setup(players, opts);
  let steps = 0;
  while (!s.over && steps++ < MAX_STEPS) {
    const due = g.turnOf(s);
    if (!due.length) break;
    const pid = due[Math.floor(Math.random() * due.length)];
    const v = clone(g.view ? g.view(s, pid) : s);
    const a = g.bot({ ...v, level: levelFor(pid, s) }, pid);
    const next = clone(s);
    g.act(next, pid, a);
    s = next;
  }
  return { s, steps };
}

let checked = 0;
for (const g of GAMES) {
  const opt = (g.options || []).find((o) => o.id === 'level');
  if (!opt || g.id === 'chess' || (ONLY.length && !ONLY.includes(g.id))) continue;
  checked++;
  assert.deepEqual(opt.choices.map(([id]) => id), ['easy', 'normal', 'hard'], `${g.id}: levels are easy, normal, hard`);
  assert.equal(opt.default, 'normal', `${g.id}: Normal is the default`);
  const coop = opt.label === TEAMMATES;
  const n = coop ? Math.min(3, g.maxPlayers) : g.id === 'spies' ? 4 : Math.max(2, g.minPlayers);
  const players = Array.from({ length: n }, (_, i) => ({ id: 'P' + i, name: 'Player ' + i }));
  for (const level of ['easy', 'normal', 'hard']) {
    const s = g.setup(players, { level });
    const v = g.view ? g.view(s, 'P0') : s;
    assert.equal(v.level, level, `${g.id}: the ${level} level reaches the players' view`);
  }
  if (coop) {
    const result = {};
    for (const level of ['easy', 'hard']) {
      let wins = 0, steps = 0;
      for (let r = 0; r < N; r++) {
        Math.random = seededRandom(`levels:${g.id}:${level}:${r}`);
        const out = play(g, players, () => level, { level });
        if (out.s.over && out.s.won !== false && (!out.s.winners || out.s.winners.length)) wins++;
        steps += out.steps;
      }
      result[level] = { wins, steps: Math.round(steps / N) };
    }
    const better = result.hard.wins > result.easy.wins || (result.hard.wins === result.easy.wins && result.hard.steps < result.easy.steps * 0.9);
    assert.ok(better, `${g.id}: Expert teammates should do better than Learning ones ${JSON.stringify(result)}`);
    console.log(`${g.id}: teammates Learning ${result.easy.wins}/${N} wins, ${result.easy.steps} moves · Expert ${result.hard.wins}/${N} wins, ${result.hard.steps} moves`);
  } else {
    let hard = 0, easy = 0;
    for (let r = 0; r < N; r++) {
      Math.random = seededRandom(`levels:${g.id}:${r}`);
      // Rotate who is hard: seats alternate, so neither level always moves first. In team games
      // (Word Spies, which deals teams at setup) the whole of one team is hard, alternating teams.
      let levelOfSeat;
      const levelFor = (pid, state) => {
        if (!levelOfSeat) {
          const teamOf = (id) => state.players?.find?.((p) => p.id === id)?.team;
          const teams = [...new Set(players.map((p) => teamOf(p.id)).filter(Boolean))].sort();
          const hard = (p, i) => (teams.length === 2 ? teams.indexOf(teamOf(p.id)) === r % 2 : (i + r) % 2 === 0);
          levelOfSeat = Object.fromEntries(players.map((p, i) => [p.id, hard(p, i) ? 'hard' : 'easy']));
        }
        return levelOfSeat[pid];
      };
      const { s } = play(g, players, levelFor, { level: 'normal' });
      if (!levelOfSeat) continue; // no moves were made
      const winners = s.winners || [];
      if (!winners.length || winners.length === players.length) continue; // a draw
      const hardWon = winners.some((id) => levelOfSeat[id] === 'hard'), easyWon = winners.some((id) => levelOfSeat[id] === 'easy');
      if (hardWon && !easyWon) hard++; else if (easyWon && !hardWon) easy++;
    }
    const share = hard / Math.max(1, hard + easy), need = NEEDED[g.id] ?? NEEDED.default;
    assert.ok(share >= need, `${g.id}: Hard should beat Easy in at least ${Math.round(need * 100)}% of decided games, got ${hard}-${easy}`);
    console.log(`${g.id}: Hard beat Easy ${hard}-${easy} (${Math.round(share * 100)}%)`);
  }
}
console.log(`Difficulty level checks passed for ${checked} game${checked === 1 ? '' : 's'}.`);
