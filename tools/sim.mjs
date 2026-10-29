// Plays full games with bots in Node to catch rule bugs.
//   node tools/sim.mjs <gameId> [players=3] [runs=20]
// Every bot move is checked by act(); a thrown error, a stuck game, or a
// non-JSON state fails the run.

import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [id, nArg = '3', runsArg = '20'] = process.argv.slice(2);
if (!id) {
  console.log('usage: node tools/sim.mjs <gameId> [players] [runs]');
  process.exit(1);
}
const n = +nArg, runs = +runsArg;
const mod = (await import(pathToFileURL(path.resolve('games', id + '.js')).href)).default;
const MAX_STEPS = 20000;

let failures = 0;
const lengths = [];
for (let r = 0; r < runs; r++) {
  const players = Array.from({ length: n }, (_, i) => ({ id: 'P' + i, name: 'Player ' + i }));
  let s = mod.setup(players);
  let steps = 0;
  try {
    while (!s.over) {
      if (++steps > MAX_STEPS) throw new Error('game did not finish in ' + MAX_STEPS + ' moves');
      const due = mod.turnOf(s);
      if (!due || !due.length) throw new Error('nobody can act but the game is not over');
      const pid = due[Math.floor(Math.random() * due.length)];
      const view = JSON.parse(JSON.stringify(mod.view ? mod.view(s, pid) : s));
      const action = mod.bot(view, pid);
      if (!action) throw new Error(`bot ${pid} returned no action (phase: ${s.phase})`);
      const next = JSON.parse(JSON.stringify(s));
      try {
        mod.act(next, pid, action);
      } catch (e) {
        throw new Error(`bot ${pid} made an illegal move ${JSON.stringify(action)}: ${e.message} (phase: ${s.phase})`);
      }
      s = JSON.parse(JSON.stringify(next));
    }
    lengths.push(steps);
  } catch (e) {
    failures++;
    console.log(`run ${r + 1}: FAIL after ${steps} moves — ${e.message}`);
    if (failures >= 3) break;
  }
}
const avg = lengths.length ? Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length) : 0;
console.log(`${id}, ${n} players: ${lengths.length}/${runs} games finished, avg ${avg} moves, ${failures} failures`);
process.exit(failures ? 1 : 0);
