// Picks the version for a deploy, so every deploy of the site gets a new one:
//   - the first two numbers come from "version" in package.json and are changed by hand:
//     a big update 1.3.0 -> 2.0.0, a small update 1.3.0 -> 1.4.0;
//   - the last number counts deploys: one more than the latest git tag v<major>.<minor>.*, or 0 for the
//     first deploy of that major.minor (1.3.0, 1.3.1, 1.3.2 ... shown as v1.3, v1.3.1, v1.3.2).
// It writes the version into package.json and rebuilds games/catalog.js, so the site shows it, and prints it.
// On GitHub it also writes version=<x.y.z> to $GITHUB_OUTPUT. The deploy job tags the commit afterwards.
//   node tools/release-version.mjs            set it (used by the deploy job)
//   node tools/release-version.mjs --dry-run  only print what the next deploy would be
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const file = new URL('../package.json', import.meta.url);
const text = fs.readFileSync(file, 'utf8');
const pkg = JSON.parse(text);
const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(pkg.version || '');
if (!m) { console.error('package.json needs a "version" like "1.3.0".'); process.exit(1); }
const [major, minor] = [Number(m[1]), Number(m[2])];

function nextVersion(major, minor, tags) {
  const patches = tags.map((t) => new RegExp(`^v${major}\\.${minor}\\.(\\d+)$`).exec(t.trim())?.[1]).filter(Boolean).map(Number);
  return `${major}.${minor}.${patches.length ? Math.max(...patches) + 1 : 0}`;
}

const tags = execFileSync('git', ['tag', '--list', `v${major}.${minor}.*`], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
const version = nextVersion(major, minor, tags);
if (process.argv.includes('--dry-run')) {
  console.log(`Next deploy: v${version}${tags.length ? ` (after ${tags.length} earlier deploy${tags.length === 1 ? '' : 's'} of ${major}.${minor})` : ` (the first deploy of ${major}.${minor})`}.`);
  process.exit(0);
}
pkg.version = version;
fs.writeFileSync(file, text.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`));
execFileSync(process.execPath, ['tools/build-catalog.mjs'], { cwd: root, stdio: 'inherit' });
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
console.log(`Release version: ${version}`);
