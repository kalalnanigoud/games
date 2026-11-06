// The site calls turnOf on a player's view as well as on the real state (the first-move card, one-device
// play), so turnOf must work on every view, including a spectator's, at every point of a game.
//   node tools/view-turnof-test.mjs
import assert from 'node:assert/strict';
import { GAMES } from '../games/index.js';
import { seededRandom } from './seed.mjs';

Math.random = seededRandom('view-turnof');
const clone = (x) => JSON.parse(JSON.stringify(x));
let games = 0;
for (const g of GAMES) {
  if (g.live) continue;
  games++;
  for (const n of [g.minPlayers, g.maxPlayers]) {
    const players = Array.from({ length: n }, (_, i) => ({ id: 'P' + i, name: 'P' + i }));
    let s = g.setup(players);
    for (let step = 0; step < 400 && !s.over; step++) {
      for (const pid of [...players.map((p) => p.id), 'watcher']) {
        assert.doesNotThrow(() => g.turnOf(clone(g.view ? g.view(s, pid) : s)), `${g.id}: turnOf on ${pid}'s view (phase ${s.phase}, step ${step})`);
      }
      const due = g.turnOf(s);
      if (!due.length) break;
      const pid = due[step % due.length], next = clone(s);
      g.act(next, pid, g.bot(clone(g.view ? g.view(s, pid) : s), pid));
      s = next;
    }
  }
}
console.log(`turnOf works on every player's and spectator's view in all ${games} turn-based games.`);
