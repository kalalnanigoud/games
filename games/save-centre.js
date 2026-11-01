// The explorer account and Save centre for games that keep a persistent character in the cloud (Creature
// Island today). It owns the sign-in, create-account, forgot-PIN and recovery-code screens, the Save tab
// (Save adventure, Load adventure, the last cloud save, a failed save's reason and Retry), and the rules
// about when saving is safe. The game gives it a few hooks (see createSaveCentre) and paints its HTML.
// Cloudflare is the only place an adventure is saved; nothing here ever saves by itself.
import { cloudAvailable, loadExplorer, saveExplorer, account, accountContext, accountMatches, requireAccount, explorerContext, signIn, signUp, signOut, recover, getRecoveryCode, claimLegacy, replaceWithLegacy, discardLegacy, CloudError } from './island-cloud.js';
import { esc, toast } from '../js/util.js';

export const fmtTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
export const ago = (ms) => { const s = (Date.now() - ms) / 1000; return s < 90 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`; };

// o: { icons: { cloud, check }, ready() -> in a game?, paint() -> repaint the panel, repaintOverlay() -> repaint
//   the overlay from scratch, snapshot() -> { rec, snap }, confirmSaved(snap, leaving) -> upToDate,
//   isUnsaved(), unsavedText(), lastSave() -> ms, explorerName(), loadRecord(rec, savedAt, found) -> send it
//   to the host, pickerCheck() -> the start screen looks for the account's explorer again, closePanel(),
//   signedOut(), chime() }
export function createSaveCentre(o) {
  const s = {
    acct: { mode: 'signin', name: '', error: '', busy: false }, acctOpen: false, code: null,
    legacy: null, legacyLater: false,
    rev: 0, name: '', fromCloud: false, replaceOk: false, conflict: null, save: null, cloudSavedAt: 0, context: accountContext(),
  };
  const IC = o.icons;
  const refresh = () => { o.repaintOverlay(); o.paint(); };
  // True while one of this module's screens is covering the game.
  const modal = () => !!(s.code || (s.acctOpen && o.ready()));

  /* ---------------- explorer accounts ---------------- */
  // PINs and recovery codes are read from the form when it's sent and never kept.
  function accountRow() {
    const me = account();
    if (!me) return `<div class="isl-acct signed"><span>Sign in to save your adventure and continue on any device.</span><button class="small primary" data-acct="open">Sign in</button></div>`;
    return `<div class="isl-acct signed"><span>${IC.cloud}Signed in as <b>${esc(me.name)}</b></span><button class="small ghost" data-acct="signout">Sign out</button></div>
      ${me.recovery ? '' : `<div class="isl-acct signed"><span>No recovery code yet: without one a forgotten PIN can’t be reset.</span><button class="small" data-acct="getcode">Get a recovery code</button></div>`}`;
  }
  function accountHTML(inGame) {
    const a = s.acct, create = a.mode === 'create', reset = a.mode === 'recover';
    const field = (name, label, auto, extra = '') => `<input name="${name}" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" placeholder="${label}" autocomplete="${auto}" aria-label="${label}" ${extra}>`;
    const nameIn = '<input name="acctName" maxlength="20" placeholder="Explorer name" autocomplete="username" autocapitalize="off" spellcheck="false" aria-label="Explorer name">';
    const title = reset ? 'Reset your PIN' : create ? 'Create your explorer account' : 'Sign in to your explorer account';
    const hint = reset ? 'Enter your explorer name, the recovery code you saved when you made your account, and a new 4-digit PIN. You’ll get a new recovery code.'
      : create ? 'Pick a name and a 4-digit PIN. Use them on any device to continue your explorer. You’ll get a recovery code to keep, in case you forget the PIN.'
      : 'Your name and 4-digit PIN bring your saved explorer to any device.';
    return `<form class="isl-acct" data-acct-form>
      <h4>${title}</h4>
      <p class="small muted">${hint}</p>
      <div class="isl-acct-fields ${create || reset ? 'three' : ''}">
        ${nameIn}
        ${field('acctPin', reset ? 'New PIN' : create ? 'New PIN' : 'PIN', create || reset ? 'new-password' : 'current-password')}
        ${create || reset ? field('acctPin2', 'Repeat PIN', 'new-password') : ''}
      </div>
      ${reset ? '<div class="isl-acct-fields one"><input name="acctCode" maxlength="16" placeholder="Recovery code (K7QM-2XPA-9TNE)" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Recovery code"></div>' : ''}
      ${a.error ? `<p class="isl-save-state bad">${esc(a.error)}</p>` : ''}
      <div class="isl-row"><button class="primary" type="submit" ${a.busy ? 'disabled' : ''}>${a.busy ? 'One moment…' : reset ? 'Reset PIN and sign in' : create ? 'Create account' : 'Sign in'}</button>
        <button type="button" class="ghost small" data-acct="${create || reset ? 'mode-signin' : 'mode-create'}">${reset ? 'Back to sign in' : create ? 'I already have an account' : 'New? Create an account'}</button>
        ${a.mode === 'signin' ? '<button type="button" class="ghost small" data-acct="mode-recover">Forgot PIN?</button>' : ''}
        ${inGame ? '<button type="button" class="ghost small" data-acct="close">Not now</button>' : ''}</div>
    </form>`;
  }
  // Shown once, right after an account is made, a PIN is reset, or "Get a recovery code" is used.
  function codeHTML() {
    const c = s.code;
    return `<div class="isl-card isl-codecard"><h2>Your recovery code</h2>
      <p>If you forget your PIN, this code is the only way back into <b>${esc(c.name)}</b>. It is shown just once: write it down or keep it somewhere safe.</p>
      <div class="isl-code" aria-label="Recovery code">${esc(c.code)}</div>
      ${c.hint ? `<p class="small muted">${esc(c.hint)}</p>` : ''}
      <div class="isl-row"><button data-code="copy">${c.copied ? 'Copied' : 'Copy'}</button><button class="primary" data-code-done>I’ve saved it</button></div></div>`;
  }
  // The card that covers the game for these screens, or '' when none is open.
  function overlayHTML() {
    if (s.code) return codeHTML();
    return s.acctOpen && o.ready() ? `<div class="isl-card">${accountHTML(true)}</div>` : '';
  }
  const showCode = (name, code) => { s.code = { name, code, copied: false, hint: '' }; };
  async function submit(form) {
    const a = s.acct, mode = a.mode;
    const name = form.acctName.value.trim(), pin = form.acctPin.value, pin2 = form.acctPin2?.value, code = form.acctCode?.value || '';
    a.name = name;
    a.error = name.length < 3 ? 'Enter your explorer name (at least 3 letters).'
      : mode === 'recover' && code.replace(/[\s-]/g, '').length !== 12 ? 'Enter the 12-character recovery code (like K7QM-2XPA-9TNE).'
      : !/^\d{4}$/.test(pin) ? 'The PIN is 4 digits.'
      : mode !== 'signin' && pin !== pin2 ? 'The two PINs don’t match.' : '';
    if (a.error) return o.repaintOverlay();
    a.busy = true; o.repaintOverlay();
    try {
      const out = await (mode === 'create' ? signUp(name, pin) : mode === 'recover' ? recover(name, code, pin) : signIn(name, pin));
      a.busy = false; a.error = ''; a.mode = 'signin';
      toast(mode === 'create' ? `Account created. Welcome, ${out.name}!` : mode === 'recover' ? `New PIN set. Signed in as ${out.name}.` : `Signed in as ${out.name}.`, 'info');
      if (out.code) showCode(out.name, out.code);
      await afterSignIn();
    } catch (e) {
      a.busy = false;
      a.error = e.code === 'wrong' ? `${mode === 'recover' ? 'That name and recovery code don’t match.' : 'That name and PIN don’t match.'}${e.left ? ` ${e.left} ${e.left === 1 ? 'try' : 'tries'} left before a short pause.` : ''}`
        : e.code === 'not-found' ? 'Explorer accounts aren’t available on the save service yet. You can still play without an account, but nothing will be kept.'
        : e.message || 'That didn’t work.';
    }
    refresh();
  }
  async function getCode() {
    try { const code = await getRecoveryCode(); showCode(account()?.name || '', code); }
    catch (e) { toast(e.message || 'Couldn’t get a recovery code.'); }
    refresh();
  }
  async function copyCode() {
    const c = s.code;
    if (!c) return;
    try { await navigator.clipboard.writeText(c.code); c.copied = true; c.hint = ''; } catch { c.hint = 'Couldn’t copy automatically: select the code and copy it yourself.'; }
    o.repaintOverlay();
  }
  // A save from before accounts: moved in, or (when the account already has one) offered as a choice.
  async function tryClaim() {
    const r = await claimLegacy();
    if (r === true) toast('The explorer saved in this browser is now in your account.', 'info');
    s.legacy = r?.conflict && !s.legacyLater ? r.conflict : null;
  }
  // What the account holds now, so saving over a different explorer asks first.
  async function resync() {
    const context = accountContext(), found = await loadExplorer(context);
    requireAccount(context);
    s.context = context; s.rev = found?.rev || 0; s.name = found?.data?.name || ''; s.cloudSavedAt = found?.savedAt || 0;
    s.fromCloud = false; s.replaceOk = false; s.conflict = null;
  }
  async function afterSignIn() {
    await tryClaim();
    await resync();
    if (!o.ready()) return o.pickerCheck();
    s.acctOpen = false; o.repaintOverlay(); o.paint();
  }
  async function legacyChoice(what) {
    if (what === 'keep') { s.legacyLater = true; s.legacy = null; return refresh(); }
    if (what === 'discard') {
      if (!confirm('Discard the explorer saved in this browser? It will no longer be offered here, and this can’t be undone.')) return;
      discardLegacy(); s.legacy = null; return refresh();
    }
    if (!confirm('Use this browser’s older explorer instead? It becomes your account’s saved explorer. The one in your account now is kept as the earlier save.')) return;
    s.legacy.busy = true; refresh();
    try {
      await replaceWithLegacy();
      s.legacy = null;
      toast('The older explorer from this browser is now your account’s.', 'info');
      if (o.ready()) await resync(); else await o.pickerCheck();
    } catch (e) { s.legacy.busy = false; s.legacy.error = e.message || 'That didn’t work.'; }
    refresh();
  }
  function legacyHTML() {
    const L = s.legacy;
    if (!L || !account()) return '';
    const line = (x) => x?.data ? `${esc(x.data.name || 'Explorer')}, level ${x.data.lv ?? 1}${x.savedAt ? `, saved ${ago(x.savedAt)}` : ''}` : 'a saved explorer';
    return `<div class="isl-legacy"><p class="isl-save-state warn"><span>This browser holds an older explorer, and your account already has one.<br>In your account: <b>${line(L.theirs)}</b><br>In this browser: <b>${line(L.old)}</b></span></p>
      ${L.error ? `<p class="isl-save-state bad">${esc(L.error)}</p>` : ''}
      <div class="isl-col"><button data-legacy="use" ${L.busy ? 'disabled' : ''}>${L.busy ? 'One moment…' : 'Use this browser’s older explorer instead'}</button><button data-legacy="keep" ${L.busy ? 'disabled' : ''}>Keep it for later</button><button class="bad" data-legacy="discard" ${L.busy ? 'disabled' : ''}>Discard the browser’s save</button></div></div>`;
  }
  async function signOutNow() {
    // Local sign-out is immediate; a late revoke response must not clear a newer sign-in.
    signOut();
    Object.assign(s, { rev: 0, name: '', fromCloud: false, replaceOk: false, conflict: null, legacy: null, legacyLater: false, cloudSavedAt: 0, save: null, code: null });
    o.signedOut();
    toast('Signed out.', 'info');
    refresh();
  }

  /* ---------------- saving and loading ---------------- */
  // The explorer the account holds is now the one in the game (after a load or "Continue").
  function adopt(found) {
    const context = explorerContext(found) || s.context;
    if (!accountMatches(context)) return false;
    s.context = context; s.rev = found.rev; s.name = found.data?.name || ''; s.fromCloud = true; s.replaceOk = false; s.conflict = null; s.cloudSavedAt = found.savedAt || s.cloudSavedAt;
    return true;
  }
  // Resolves to { ok, upToDate }. A failure keeps the session running and the last good save untouched.
  async function saveCloud(force = false, { leaving = false } = {}) {
    if (s.save?.state === 'saving' || s.save?.state === 'loading') return { ok: false };
    // A new explorer replaces the cloud save only when the player says so.
    if (accountMatches(s.context) && !force && s.rev && !s.fromCloud && !s.replaceOk) { s.save = { state: 'replace' }; o.paint(); return { ok: false }; }
    const operation = s.save = { state: 'saving' }; o.paint(); o.repaintOverlay();
    try {
      if (!accountMatches(s.context)) {
        await resync();
        s.save = { state: 'account' }; refresh();
        return { ok: false };
      }
      const context = s.context;
      const { rec, snap } = await o.snapshot();
      requireAccount(context);
      // rev is the revision this explorer came from or last saved; a newer one stored from elsewhere is a
      // conflict, which only an explicit Replace (force) overwrites.
      const out = await saveExplorer(rec, s.rev, force, context);
      requireAccount(context);
      const upToDate = await o.confirmSaved(snap, leaving);
      requireAccount(context);
      s.rev = out.rev; s.fromCloud = true; s.name = rec.name; s.conflict = null; s.cloudSavedAt = out.savedAt || Date.now();
      s.save = null;
      toast('Adventure saved.', 'info');
      o.chime();
      refresh();
      return { ok: true, upToDate };
    } catch (e) {
      if (s.save !== operation) return { ok: false };
      if (e.code === 'conflict') {
        // Keep the newer save's details apart: this explorer's own revision doesn't change, so saving again
        // without choosing Replace conflicts again rather than quietly overwriting.
        s.conflict = { rev: e.rev, savedAt: e.savedAt };
        s.save = { state: 'conflict', msg: `${e.message}${e.savedAt ? ` (saved ${ago(e.savedAt)})` : ''} To keep that save instead, leave without saving and continue it next time.` };
      } else s.save = { state: 'error', retry: 'save', msg: e.message || 'Saving failed.' };
      refresh();
      return { ok: false };
    }
  }
  // "Load adventure": the saved explorer replaces the one in the game, after a confirm.
  async function loadAdventure() {
    if (s.save?.state === 'saving' || s.save?.state === 'loading') return;
    if (!confirm('Load your saved adventure? It replaces your explorer here, and any progress that isn’t saved is lost.')) return;
    const operation = s.save = { state: 'loading' }; o.paint();
    try {
      const context = accountContext(), found = await loadExplorer(context);
      requireAccount(context);
      if (s.save !== operation) return;
      if (!found) throw new CloudError('none', 'There’s no saved adventure in your account yet.');
      s.save = null;
      o.loadRecord(found.data, found.savedAt, found);
    } catch (e) { if (s.save === operation) s.save = { state: 'error', retry: 'load', msg: e.message || 'Loading failed.' }; }
    o.paint();
  }

  function saveHTML() {
    const me = account(), cloud = cloudAvailable(), changed = !accountMatches(s.context), v = changed && s.save?.state !== 'saving' ? null : s.save;
    if (!cloud) return `<p class="isl-save-state warn">Saving isn’t set up on this site, so nothing is kept when you leave.</p>
      <p class="small muted">Your adventure lasts only until you close or leave this game.</p>`;
    if (!me) return `<p class="isl-save-state warn">Nothing is kept without an account: when you leave, this adventure is gone.</p>
      ${accountRow()}
      <p class="small muted">Sign in, or create an account (a name and a 4-digit PIN), to save your adventure to the cloud and continue it on any device. Nothing is saved until you choose to.</p>`;
    const unsaved = o.isUnsaved();
    const status = changed && !v ? '<p class="isl-save-state warn">The explorer account changed. Review it before saving this explorer to that account.</p>'
      : v?.state === 'saving' ? `<p class="isl-save-state">${IC.cloud}<span>Saving…</span></p>`
      : v?.state === 'loading' ? `<p class="isl-save-state">${IC.cloud}<span>Loading your adventure…</span></p>`
      : v?.state === 'error' ? `<p class="isl-save-state bad">${esc(v.msg)}</p><p class="small muted">${v.retry === 'load' ? 'Your explorer here is unchanged.' : 'Your game is still running, and your last saved adventure is unchanged.'}</p><div class="isl-row"><button class="primary" data-save="retry">Retry</button><button data-save="cancel">Dismiss</button></div>`
      : v?.state === 'conflict' ? `<p class="isl-save-state bad">${esc(v.msg)}</p><div class="isl-row"><button class="primary" data-save="force">Replace it with this explorer</button><button data-save="cancel">Cancel</button></div>`
      : v?.state === 'replace' ? `<p class="isl-save-state">Saving will replace <b>${esc(s.name || 'your saved explorer')}</b> in the cloud with ${esc(o.explorerName())}.</p><div class="isl-row"><button class="primary" data-save="replace">Replace and save</button><button data-save="cancel">Cancel</button></div>`
      : v?.state === 'account' ? `<p class="isl-save-state warn">The account changed to <b>${esc(me.name)}</b>. Save this explorer to that account${s.rev ? `, replacing <b>${esc(s.name || 'its saved explorer')}</b>` : ''}?</p><div class="isl-row"><button class="primary" data-save="replace">Save to this account</button><button data-save="cancel">Cancel</button></div>`
      : unsaved ? `<p class="isl-save-state warn">${o.unsavedText()}</p>`
      : `<p class="isl-save-state good">${IC.check}<span>Everything is saved${o.lastSave() ? ` (${fmtTime(o.lastSave())})` : ''}.</span></p>`;
    return `${status}
      <p class="small muted">${changed ? 'Choose Save adventure to review the current account.' : s.cloudSavedAt ? `Last cloud save: ${fmtTime(s.cloudSavedAt)} (${ago(s.cloudSavedAt)}).` : 'No cloud save yet.'}</p>
      ${accountRow()}
      ${legacyHTML()}
      ${!v || v.state === 'done' ? `<div class="isl-row"><button class="primary" data-save="cloud">${IC.cloud}Save adventure</button><button data-save="load" ${changed || s.rev || s.cloudSavedAt ? '' : 'disabled'}>Load adventure</button></div>` : ''}
      <p class="small muted">Saves keep your explorer: level, creatures, items and story. Nothing is saved until you choose to. Your adventure is saved to your explorer account (a name and a 4-digit PIN), so you can continue on any device.</p>
      <p class="small muted">Load adventure replaces the explorer you’re playing with your last cloud save.</p>
      <p class="small muted">Friends save their own explorers from their own menus.</p>`;
  }

  // Handles a click on one of this module's buttons (by its data-* attributes); true when it did.
  function click(d) {
    if (d.save === 'cloud') { saveCloud(); return true; }
    if (d.save === 'retry') { const again = s.save?.retry; s.save = null; again === 'load' ? loadAdventure() : saveCloud(); return true; }
    if (d.save === 'load') { loadAdventure(); return true; }
    if (d.save === 'force') { s.save = null; saveCloud(true); return true; }
    if (d.save === 'replace') { s.replaceOk = true; s.save = null; saveCloud(); return true; }
    if (d.save === 'cancel') { s.save = null; o.paint(); return true; }
    if (d.acct === 'open') { s.acctOpen = true; s.acct.error = ''; o.closePanel(); o.repaintOverlay(); return true; }
    if (d.acct === 'close') { s.acctOpen = false; o.repaintOverlay(); return true; }
    if (d.acct === 'mode-create' || d.acct === 'mode-signin' || d.acct === 'mode-recover') { s.acct.mode = d.acct.slice(5); s.acct.error = ''; o.repaintOverlay(); return true; }
    if (d.acct === 'signout') { signOutNow(); return true; }
    if (d.acct === 'getcode') { o.closePanel(); getCode(); return true; }
    if (d.legacy) { legacyChoice(d.legacy); return true; }
    if (d.code === 'copy') { copyCode(); return true; }
    if (d.codeDone != null) { s.code = null; refresh(); return true; }
    return false;
  }

  return { s, modal, accountRow, accountHTML, overlayHTML, saveHTML, legacyHTML, submit, click, tryClaim, resync, adopt, saveCloud, loadAdventure };
}
