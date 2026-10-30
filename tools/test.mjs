// Run all command-line checks from any directory: node tools/test.mjs [runs=50]
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';
import { GAMES } from '../games/index.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const runs = Number(process.argv[2] || 50);
if (!Number.isInteger(runs) || runs < 1) throw new Error('Runs must be a positive integer.');
const run = (...args) => {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
};
// The catalog (names, covers, version) is generated from the game files. Locally it is rebuilt;
// on GitHub (CI=true) a stale catalog fails the run, because the live site would serve it.
run('tools/build-catalog.mjs', ...(process.env.CI ? ['--check'] : []));
run('--check', 'serve.js');
for (const dir of ['js', 'games', 'tools']) {
  for (const file of readdirSync(new URL(`../${dir}/`, import.meta.url))) {
    if (/\.(js|mjs|cjs)$/.test(file)) run('--check', `${dir}/${file}`);
  }
}
for (const file of ['server-test.cjs', 'platform-test.mjs', 'reliability-test.mjs', 'gems-check.mjs', 'bluff-test.mjs', 'mosaic-test.mjs', 'coop-test.mjs', 'escape-test.mjs', 'chess-test.mjs', 'party-test.mjs']) run(`tools/${file}`);
for (const g of GAMES) for (let n = g.minPlayers; n <= g.maxPlayers; n++) run('tools/sim.mjs', g.id, String(n), String(runs));
console.log('All command-line checks passed. Browser checks: /tools/browser-test.html and /tools/local-boot-test.html');
