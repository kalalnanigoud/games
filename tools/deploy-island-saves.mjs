// Puts Creature Island's cloud saves on your free Cloudflare account in one go:
// creates the D1 database, uploads server/island-saves.js as a Worker bound to it, gives it the secret
// that protects explorer PINs, switches on its workers.dev address, checks that it answers, and writes
// the address into js/config.js.
//
//   node tools/deploy-island-saves.mjs            asks for your API token (typed text stays hidden)
//   node tools/deploy-island-saves.mjs --check    only checks the address already in js/config.js
//
// The token comes from CLOUDFLARE_API_TOKEN or the hidden prompt. It is only sent to api.cloudflare.com
// and is never written to disk. It needs these permissions (My Profile → API Tokens → Create Token →
// Custom token): Account · Workers Scripts · Edit, Account · D1 · Edit, Account · Account Settings · Read.
// Other options: --account <id> (several accounts), --subdomain <name> (an account without a workers.dev
// subdomain yet), --name <worker> (default island-saves). Running it again updates the same Worker and
// keeps its PIN secret (a new one would make every explorer's PIN stop working).
import crypto from 'node:crypto';
import { flag, has, say, stop, cf, step, login, database, uploadWorker, workersDev, readConfig, writeConfig, retry, finish } from './cloudflare.mjs';

const NAME = flag('name') || 'island-saves';

// Answers with the database and the PIN secret: signing in as a name nobody has gets "no match" back,
// which proves the database (and its tables) works end to end.
const check = (url) => retry(async () => {
  const health = await fetch(url + '/', { cache: 'no-store' }).then((r) => r.json());
  if (!health?.ok) return 'unexpected answer';
  if (!health.storage) return 'the Worker has no database attached (binding DB)';
  if (!health.accounts) return 'the PIN secret isn’t set on the Worker yet';
  const r = await fetch(url + '/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'check-' + crypto.randomBytes(4).toString('hex'), pin: '0000' }), cache: 'no-store' });
  const out = await r.json().catch(() => null);
  return r.status === 401 && out?.error === 'wrong' ? true : out?.message || `HTTP ${r.status}`;
});

if (has('check')) {
  const url = readConfig('islandSaves').replace(/\/+$/, '');
  if (!url) stop('js/config.js has no islandSaves address yet. Run this without --check first.');
  process.stdout.write(`Checking ${url}… `);
  const problem = await check(url);
  if (problem) stop(`It isn't answering yet (${problem}).`);
  say('it works. Cloud saves are on.');
  process.exit(0);
}

const A = await login('Creature Island cloud saves → your Cloudflare account (free plan)');
const dbId = await database(A, NAME);
const secrets = await step('Checking for the PIN secret', 'read the Worker’s secrets', () => cf('GET', `${A}/workers/scripts/${NAME}/secrets`, undefined, { allow404: true }));
await uploadWorker(A, NAME, 'island-saves.js', [{ type: 'd1', name: 'DB', id: dbId }]);
if (!(secrets || []).some((s) => s.name === 'PIN_PEPPER')) {
  // Made here, set straight on the Worker, never printed or written anywhere.
  await step('Setting the PIN secret', 'set a Worker secret', () => cf('PUT', `${A}/workers/scripts/${NAME}/secrets`, { name: 'PIN_PEPPER', text: crypto.randomBytes(32).toString('base64url'), type: 'secret_text' }));
}
const url = await workersDev(A, NAME);
writeConfig('islandSaves', url);
process.stdout.write('• Checking that it answers… ');
const problem = await check(url);
say(problem ? 'not yet' : 'it works');
finish(problem, url, 'Cloud saves are ready', 'node tools/deploy-island-saves.mjs --check');
