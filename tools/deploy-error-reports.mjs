// Puts Game Night's anonymous crash reports on your free Cloudflare account in one go: creates the D1
// database, uploads server/error-reports.js as a Worker bound to it, gives it a private reading key,
// switches on its workers.dev address, checks that it answers, and writes the address into js/config.js.
//
//   node tools/deploy-error-reports.mjs               asks for your API token (typed text stays hidden)
//   node tools/deploy-error-reports.mjs --check       checks the address already in js/config.js
//   node tools/deploy-error-reports.mjs --new-key     replaces a lost reading key
//
// The token comes from CLOUDFLARE_API_TOKEN or the hidden prompt, is only sent to api.cloudflare.com and is
// never written to disk. It needs the same permissions as the cloud-saves setup: Account · Workers Scripts ·
// Edit, Account · D1 · Edit, Account · Account Settings · Read. The reading key is made here, shown once,
// and stored only as a secret on the Worker. Running it again updates the Worker and keeps its key.
// Other options: --account <id>, --subdomain <name>, --name <worker> (default gn-errors).
import crypto from 'node:crypto';
import { flag, has, say, stop, cf, step, login, database, uploadWorker, workersDev, readConfig, writeConfig, retry, finish } from './cloudflare.mjs';

const NAME = flag('name') || 'gn-errors';
const DB_NAME = flag('database') || 'gn-error-reports';

// With the reading key, the list of reports proves the database and the key work end to end.
const check = (base, key) => retry(async () => {
  const r = await fetch(base + (key ? '/recent?key=' + encodeURIComponent(key) : '/'), { cache: 'no-store' });
  const body = await r.text();
  if (key) return r.ok && body.trim().startsWith('[') ? true : r.status === 404 ? 'the reading key is not accepted yet' : `HTTP ${r.status}`;
  return r.ok && /crash reports/.test(body) ? true : `HTTP ${r.status}`;
});

if (has('check')) {
  const base = readConfig('errorReports').replace(/\/report\/?$/, '');
  if (!base) stop('js/config.js has no errorReports address yet. Run this without --check first.');
  process.stdout.write(`Checking ${base}… `);
  const problem = await check(base, flag('key'));
  if (problem) stop(`It isn't answering yet (${problem}).`);
  say('it works. Crash reports are on.');
  process.exit(0);
}

const A = await login('Game Night crash reports → your Cloudflare account (free plan)');
const dbId = await database(A, DB_NAME);
// A new Worker has no reading key yet; on a second run the one it has is kept (unless --new-key).
const secrets = await step('Checking for a reading key', 'read the Worker’s secrets', () => cf('GET', `${A}/workers/scripts/${NAME}/secrets`, undefined, { allow404: true }));
await uploadWorker(A, NAME, 'error-reports.js', [{ type: 'd1', name: 'DB', id: dbId }]);
let viewKey = '';
if (has('new-key') || !(secrets || []).some((s) => s.name === 'VIEW_KEY')) {
  viewKey = crypto.randomBytes(24).toString('base64url');
  await step('Setting the private reading key', 'set a Worker secret', () => cf('PUT', `${A}/workers/scripts/${NAME}/secrets`, { name: 'VIEW_KEY', text: viewKey, type: 'secret_text' }));
}
const url = await workersDev(A, NAME);
writeConfig('errorReports', url + '/report');
process.stdout.write('• Checking that it answers… ');
const problem = await check(url, viewKey);
say(problem ? 'not yet' : 'it works');
finish(problem, url, 'Crash reports are ready', 'node tools/deploy-error-reports.mjs --check');
if (viewKey) {
  say('\n  Your private link for reading reports. It is shown only this once: keep it in a password manager.');
  say(`  ${url}/recent?key=${viewKey}`);
} else say(`\n  Read reports at ${url}/recent?key=<your reading key>. Lost the key? Run this again with --new-key.`);
