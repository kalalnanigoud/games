// One command for everything: node tools/test-all.mjs [--only name,name] [--skip-webkit] [--perf]
// Runs each suite in turn, keeps its output in test-results/<name>.log, prints a summary table and exits
// nonzero if any suite failed. Needs only node (npm is not required).
import { spawn } from 'node:child_process';
import { mkdirSync, createWriteStream, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const outDir = fileURLToPath(new URL('../test-results/', import.meta.url));
mkdirSync(outDir, { recursive: true });
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const env = { ...process.env, ...(args.includes('--skip-webkit') ? { SKIP_WEBKIT: '1' } : {}) };
const web = env.SKIP_WEBKIT ? 'Chromium' : 'Chromium + WebKit';
const suites = [
  { name: 'command-line', what: 'catalog, syntax, simulations, levels, island, saves, reports', file: 'tools/test.mjs', args: ['10'] },
  { name: 'browser-ci', what: 'every game at phone and desktop sizes', file: 'tools/browser-ci.mjs' },
  { name: 'multiplayer-ci', what: `real WebRTC rooms, ${web}`, file: 'tools/multiplayer-ci.mjs' },
  { name: 'island-ci', what: `Creature Island, four live players, ${web}`, file: 'tools/island-ci.mjs' },
  { name: 'arena-ci', what: 'Arena Rush: lobby option, timer, score, no saving', file: 'tools/arena-ci.mjs' },
  { name: 'island-faults', what: `slow/failed/cancelled saves, dropped network, Worker and audio failures, ${web}`, file: 'tools/island-faults.mjs' },
  ...(args.includes('--perf') ? [{ name: 'perf-island', what: 'frame time, heap and wire bytes under 4x CPU throttling', file: 'tools/perf-island.mjs' }] : []),
].filter((s) => !only || only.includes(s.name));

const run = (s) => new Promise((resolve) => {
  const log = createWriteStream(outDir + s.name + '.log');
  const t0 = Date.now();
  const p = spawn(process.execPath, [s.file, ...(s.args || [])], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const pipe = (d) => { log.write(d); if (process.env.VERBOSE) process.stdout.write(d); };
  p.stdout.on('data', pipe); p.stderr.on('data', pipe);
  p.on('error', (e) => { log.write(String(e)); resolve({ code: 1, secs: (Date.now() - t0) / 1000 }); });
  p.on('close', (code) => { log.end(() => resolve({ code: code ?? 1, secs: (Date.now() - t0) / 1000 })); });
});

const rows = [];
for (const s of suites) {
  process.stdout.write(`running ${s.name}... `);
  const r = await run(s);
  const text = readFileSync(outDir + s.name + '.log', 'utf8');
  const passes = (text.match(/^PASS /gm) || []).length;
  rows.push({ ...s, ...r, passes });
  console.log(r.code === 0 ? 'ok' : 'FAILED');
  if (r.code !== 0) console.log(text.split('\n').slice(-25).join('\n'));
}
const pad = (v, n) => String(v).padEnd(n);
console.log('\n' + pad('suite', 16) + pad('result', 8) + pad('time', 8) + pad('PASS lines', 12) + 'covers');
for (const r of rows) console.log(pad(r.name, 16) + pad(r.code === 0 ? 'pass' : 'FAIL', 8) + pad(r.secs.toFixed(0) + 's', 8) + pad(r.passes || '-', 12) + r.what);
const failed = rows.filter((r) => r.code !== 0);
console.log(failed.length ? `\n${failed.length} of ${rows.length} suites failed: ${failed.map((r) => r.name).join(', ')} (logs in test-results/)` : `\nAll ${rows.length} suites passed.`);
process.exit(failed.length ? 1 : 0);
