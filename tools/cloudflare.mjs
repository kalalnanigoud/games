// What the one-command Cloudflare setups share (tools/deploy-island-saves.mjs, tools/deploy-error-reports.mjs):
// the hidden token prompt, Cloudflare API calls with plain-language errors, choosing the account, a D1
// database, uploading a Worker, its workers.dev address, and writing an address into js/config.js.
// The token is only ever sent to api.cloudflare.com. If you choose to, it is remembered on this computer
// (outside the project, encrypted for your Windows user), so later runs don't ask for it again.
import fs from 'node:fs';
import os from 'node:os';
import readline from 'node:readline';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
export const flag = (name) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : undefined; };
export const has = (name) => args.includes('--' + name);
export const root = new URL('../', import.meta.url);
const API = (flag('api') || 'https://api.cloudflare.com/client/v4').replace(/\/+$/, ''); // --api: tests only
export const CONFIG_FILE = flag('config') ? pathToFileURL(path.resolve(flag('config'))) : new URL('js/config.js', root); // --config: tests only
export const PERMISSIONS = 'Account · Workers Scripts · Edit, Account · D1 · Edit, Account · Account Settings · Read';

// ---- the remembered token ----
// Windows: encrypted with DPAPI for the signed-in Windows user (PowerShell's SecureString), so the file is
// useless to anyone else or on another computer. Elsewhere: a file only your user can read.
// The token goes to PowerShell on standard input, never on a command line.
const TOKEN_FILE = path.join(process.env.GAMENIGHT_TOKEN_DIR || path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'gamenight'), 'cloudflare-token');
const WINDOWS = process.platform === 'win32';
function powershell(script, input) {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { input, encoding: 'utf8' });
  if (r.status !== 0) throw new Error((r.stderr || '').trim().split('\n')[0] || 'PowerShell failed');
  return r.stdout.trim();
}
export function rememberToken(value) {
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
  const data = WINDOWS ? powershell('$t = [Console]::In.ReadToEnd().Trim(); ConvertTo-SecureString $t -AsPlainText -Force | ConvertFrom-SecureString', value) : value;
  fs.writeFileSync(TOKEN_FILE, data, { mode: 0o600 });
  return TOKEN_FILE;
}
export function rememberedToken() {
  try {
    const data = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    if (!data) return '';
    return WINDOWS ? powershell('$s = [Console]::In.ReadToEnd().Trim() | ConvertTo-SecureString; [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))', data) : data;
  } catch { return ''; }
}
// Forgetting empties the file (it holds nothing afterwards).
export function forgetToken() { try { if (fs.existsSync(TOKEN_FILE)) fs.writeFileSync(TOKEN_FILE, ''); } catch {} }

export const say = (msg) => console.log(msg);
export function stop(msg) { console.error('\n✖ ' + msg); process.exit(1); }

export function ask(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
    if (hidden && process.stdin.isTTY) {
      rl._writeToOutput = (s) => { if (s.startsWith(question)) process.stdout.write(question); else if (s !== '\r\n' && s !== '\n') process.stdout.write('*'); };
    }
    rl.question(question, (answer) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(answer.trim()); });
  });
}

let token = '';
export async function cf(method, p, body, { allow404 = false } = {}) {
  const init = { method, headers: { authorization: 'Bearer ' + token } };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) { init.body = JSON.stringify(body); init.headers['content-type'] = 'application/json'; }
  let res;
  try { res = await fetch(API + p, init); } catch (e) { stop(`Could not reach Cloudflare (${e.cause?.code || e.message}). Check your internet connection.`); }
  let out = null;
  try { out = await res.json(); } catch {}
  // Something that doesn't exist yet (a workers.dev subdomain, a new Worker's secrets) answers 404 or 10007.
  if (allow404 && (res.status === 404 || out?.errors?.some((e) => e.code === 10007))) return null;
  if (!res.ok || !out?.success) {
    const err = new Error((out?.errors || []).map((e) => `${e.message}${e.code ? ` (code ${e.code})` : ''}`).join('; ') || `HTTP ${res.status}`);
    err.status = res.status;
    err.codes = (out?.errors || []).map((e) => e.code);
    throw err;
  }
  return out.result;
}
const permissionHint = (what) => `The token isn't allowed to ${what}. Edit it in Cloudflare (My Profile → API Tokens) to include: ${PERMISSIONS}.`;
export async function step(label, what, run) {
  process.stdout.write(`• ${label}… `);
  try { const r = await run(); say('done'); return r; } catch (e) {
    say('failed');
    if (e.status === 401 || e.status === 403 || e.codes?.some((c) => c === 10000 || c === 9109)) stop(permissionHint(what) + `\n  Cloudflare said: ${e.message}`);
    stop(`Could not ${what}: ${e.message}`);
  }
}

// The token, then the account to deploy to. Returns the account's API path, e.g. /accounts/abc123.
export async function login(title) {
  say(title + '\n');
  if (has('forget-token')) { forgetToken(); say('  Forgot the token saved on this computer.'); }
  const fromEnv = (process.env.CLOUDFLARE_API_TOKEN || '').trim();
  const saved = fromEnv || has('forget-token') ? '' : rememberedToken();
  const typeIt = () => ask('Paste your Cloudflare API token (hidden): ', true);
  token = fromEnv || saved || await typeIt();
  if (!token) stop('No token given.');
  let typed = !fromEnv && !saved;
  if (saved) say('  Using the token saved on this computer (run with --forget-token to remove it).');
  let accounts = null;
  if (saved) {
    // A remembered token that was rolled or deleted: ask for the new one instead of failing.
    try { accounts = await cf('GET', '/accounts?per_page=50'); }
    catch (e) {
      if (!(e.status === 401 || e.status === 403 || e.codes?.some((c) => c === 10000 || c === 9109))) stop(`Could not list your Cloudflare accounts: ${e.message}`);
      say('  The saved token no longer works (it may have been rolled). Paste the new one.');
      forgetToken();
      token = await typeIt();
      if (!token) stop('No token given.');
      typed = true;
    }
  }
  if (!accounts) accounts = await step('Finding your account', 'list your Cloudflare accounts', () => cf('GET', '/accounts?per_page=50'));
  else say('• Finding your account… done');
  if (typed && process.stdin.isTTY) {
    const yes = /^y(es)?$/i.test(await ask(`  Remember this token on this computer, so you don't paste it again? It is kept encrypted for your ${WINDOWS ? 'Windows' : ''} user only. (y/N): `));
    if (yes) {
      try { say(`  Saved (encrypted) in ${rememberToken(token)}. Run with --forget-token to remove it.`); }
      catch (e) { say(`  Couldn't save it (${e.message}); you'll be asked again next time.`); }
    }
  }
  let account = flag('account') ? accounts.find((a) => a.id === flag('account')) || { id: flag('account'), name: flag('account') } : accounts[0];
  if (!flag('account') && accounts.length > 1) {
    accounts.forEach((a, i) => say(`  ${i + 1}. ${a.name} (${a.id})`));
    account = accounts[Number(await ask('Which account? Number: ')) - 1];
  }
  if (!account) stop('This token cannot see any Cloudflare account. ' + permissionHint('list your accounts'));
  say(`  Account: ${account.name}`);
  return `/accounts/${account.id}`;
}

// A D1 database by name, created if it isn't there yet. Returns its id.
export async function database(A, name) {
  const db = await step('Setting up the D1 database', 'create a D1 database', async () => {
    const found = (await cf('GET', `${A}/d1/database?name=${encodeURIComponent(name)}&per_page=50`)).find((d) => d.name === name);
    return found || cf('POST', `${A}/d1/database`, { name });
  });
  const id = db.uuid || db.id;
  if (!id) stop('Cloudflare did not return the database id.');
  return id;
}

// Uploads server/<file> as the Worker <name> with these bindings. Secrets already set on the Worker are kept.
export function uploadWorker(A, name, file, bindings) {
  return step('Uploading the Worker', 'upload a Worker', () => {
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify({ main_module: file, compatibility_date: '2025-09-01', bindings, keep_bindings: ['secret_text'] })], { type: 'application/json' }));
    form.append(file, new Blob([fs.readFileSync(new URL('server/' + file, root), 'utf8')], { type: 'application/javascript+module' }), file);
    return cf('PUT', `${A}/workers/scripts/${name}`, form);
  });
}

// Switches on https://<name>.<subdomain>.workers.dev (creating the account's subdomain the first time).
export async function workersDev(A, name) {
  let sub = (await step('Looking up your workers.dev subdomain', 'read your workers.dev subdomain', () => cf('GET', `${A}/workers/subdomain`, undefined, { allow404: true })))?.subdomain;
  if (!sub) {
    say(`  Your account has no workers.dev subdomain yet. It becomes part of the address, e.g. ${name}.<subdomain>.workers.dev.`);
    const wanted = (flag('subdomain') || await ask('  Choose one (letters, numbers and dashes): ')).toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(wanted)) stop('That subdomain is not valid.');
    sub = (await step('Creating the subdomain', 'create a workers.dev subdomain', () => cf('PUT', `${A}/workers/subdomain`, { subdomain: wanted })))?.subdomain || wanted;
  }
  await step('Switching on the workers.dev address', 'switch on the workers.dev address', () => cf('POST', `${A}/workers/scripts/${name}/subdomain`, { enabled: true, previews_enabled: false }));
  return flag('check-url') || `https://${name}.${sub}.workers.dev`; // --check-url: tests only
}

export function readConfig(key) { return new RegExp(`${key}:\\s*'([^']*)'`).exec(fs.readFileSync(CONFIG_FILE, 'utf8'))?.[1] || ''; }
export function writeConfig(key, value) {
  const text = fs.readFileSync(CONFIG_FILE, 'utf8'), re = new RegExp(`${key}:\\s*'[^']*'`);
  if (!re.test(text)) stop(`Could not find ${key} in ${CONFIG_FILE.pathname}. Add  ${key}: '${value}',  to it yourself.`);
  fs.writeFileSync(CONFIG_FILE, text.replace(re, `${key}: '${value}'`));
  say(`• Wrote ${value} into js/config.js`);
}
// A brand-new workers.dev address can take a few minutes to start answering: try for about two.
export async function retry(probe) {
  let last = '';
  for (let i = 0; i < 30; i++) {
    try { const r = await probe(); if (r === true) return ''; last = r; } catch (e) { last = e.cause?.code || e.message; }
    await new Promise((r) => setTimeout(r, i < 5 ? 2000 : 4000));
  }
  return last;
}
export function finish(problem, url, what, again) {
  say(problem ? `\n✔ Deployed to ${url}. It isn't answering yet (${problem}); new addresses can take a few minutes: run ${again} later.` : `\n✔ ${what} at ${url}`);
  say('  Commit and push js/config.js to switch it on for everyone.');
  say('  If this token was shared anywhere (a chat, an email), roll it now: Cloudflare → My Profile → API Tokens → Roll.');
}
