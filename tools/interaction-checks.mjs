import assert from 'node:assert/strict';

// Runs against the real UI in both Chromium and WebKit. No synthetic renderer:
// room updates go through the same broadcast/render path used during play.
export async function checkInteractions(page, label) {
  await page.click('[data-local="spies"]');
  await page.click('#addBtn'); await page.click('#addBtn'); await page.click('#startBtn');
  await page.locator('#spyClue').waitFor();
  await page.fill('#spyClue','ocean');
  await page.evaluate(()=>document.querySelector('#spyClue').setSelectionRange(2,4));
  await page.evaluate(async()=>{const {S}=await import('/js/state.js');S.players[1].connected=false;(await import('/js/net.js')).broadcast();});
  assert.deepEqual(await page.evaluate(()=>({id:document.activeElement.id,value:document.querySelector('#spyClue').value,selection:[document.activeElement.selectionStart,document.activeElement.selectionEnd]})),{id:'spyClue',value:'ocean',selection:[2,4]},`${label}: room updates preserve typing and selection`);

  await page.click('.game-head [data-help]');
  for(const key of ['Tab','Tab','Shift+Tab','Shift+Tab']) {
    await page.keyboard.press(key);
    assert.ok(await page.evaluate(()=>!!document.activeElement.closest('#helpModal')),`${label}: ${key} stays in help`);
  }
  assert.ok(await page.evaluate(()=>document.querySelector('#app').inert));
  // The opener can be replaced during an update behind the dialog.
  await page.evaluate(async()=>{const {S}=await import('/js/state.js');S.players[1].connected=true;(await import('/js/net.js')).broadcast();});
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#helpModal').count(),0);
  assert.equal(await page.evaluate(()=>document.querySelector('#app').inert),false);
  assert.equal(await page.evaluate(()=>document.activeElement.dataset.help),'spies');

  await page.click('#ghMenuBtn'); await page.focus('#ghSound');
  await page.evaluate(async()=>(await import('/js/ui.js')).renderTopbar());
  assert.equal(await page.evaluate(()=>document.activeElement.id),'ghSound',`${label}: status refresh preserves menu focus`);
  await page.evaluate(async()=>{const {S}=await import('/js/state.js');S.players[1].connected=false;(await import('/js/net.js')).broadcast();});
  assert.equal(await page.evaluate(()=>document.activeElement.id),'ghSound',`${label}: full room redraw preserves menu focus`);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'ghMenuBtn');
  await page.evaluate(async()=>(await import('/js/net.js')).leave());

  await page.click('[data-local="gems"]'); await page.click('[data-mode="tour"]');
  for(let i=0;i<3;i++)await page.click('#botBtn');
  await page.check('[data-tg="sketch"]'); await page.check('[data-tg="spies"]');
  await page.reload(); await page.locator('#tourStart').waitFor();
  assert.deepEqual(await page.evaluate(async()=>{const {S}=await import('/js/state.js');return {mode:S.lobbyMode,players:S.players.length,picks:S.tourDraft.picks};}),{mode:'tour',players:5,picks:['sketch','spies']});
  assert.equal(await page.locator('[data-tg="sketch"]').isChecked(),true);
  assert.equal(await page.locator('#tourStart').isEnabled(),true);
  await page.click('[data-format="knockout"]'); await page.check('[data-ko="chess"]');
  await page.reload(); await page.locator('[data-ko="chess"]').waitFor();
  assert.equal(await page.locator('[data-ko="chess"]').isChecked(),true,`${label}: knockout choice persists`);
  await page.click('[data-mode="game"]'); await page.click('#pickGame');
  await page.focus('.picker-x'); await page.keyboard.press('Shift+Tab');
  assert.ok(await page.evaluate(()=>!!document.activeElement.closest('#pickerModal')));
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'pickGame');
  assert.equal(await page.evaluate(()=>document.querySelector('#app').inert),false);
  await page.evaluate(async()=>(await import('/js/net.js')).leave());
  await checkQuickPlay(page, label);
  // Keep the existing suite's collection assertions independent of this exercise.
  await page.evaluate(()=>{localStorage.removeItem('gn-recent');localStorage.removeItem('gn-quick');});
  console.log(`PASS ${label}: draft refresh, typing/menu focus, modal containment and focus restoration`);
}

// Home page: Quick Play skips the lobby, and Continue only shows for a signed-in explorer with a cloud save.
const gameState = (page) => page.evaluate(async () => { const { S } = await import('/js/state.js'); return { screen: S.screen, role: S.role, game: S.gameId, bots: S.players.filter((p) => p.bot).length, players: S.players.length }; });
// The game's code loads on demand, so the screen changes a moment after the click.
const inGame = async (page) => { for (let i = 0; i < 100; i++) { if ((await gameState(page)).screen === 'game') return; await page.waitForTimeout(100); } };
async function checkQuickPlay(page, label) {
  const leave = () => page.evaluate(async () => (await import('/js/net.js')).leave());
  await page.waitForSelector('#quickBtn');
  // The 5 min filter finds only the island (its Arena Rush option); 15 min still holds the short party games too.
  await page.selectOption('[data-filter="minutes"]', '5');
  assert.deepEqual(await page.locator('.game-card [data-host]').evaluateAll((b) => b.map((x) => x.dataset.host)), ['island'], `${label}: 5 min filter`);
  await page.click('#clearFilters');
  assert.equal(await page.locator('#continueBtn').isVisible(), false, `${label}: no Continue without an account`);
  assert.equal(await page.locator('#quickGame').inputValue(), 'island', `${label}: Quick Play defaults to Creature Island`);
  await page.click('#quickBtn');
  await inGame(page);
  assert.deepEqual(await gameState(page), { screen: 'game', role: 'local', game: 'island', bots: 0, players: 1 }, `${label}: Quick Play starts the island at once`);
  await leave();
  await page.selectOption('#quickGame', 'gems');
  await page.click('#quickBtn');
  await inGame(page);
  assert.deepEqual(await gameState(page), { screen: 'game', role: 'local', game: 'gems', bots: 2, players: 3 }, `${label}: a board game gets computer players, no lobby`);
  await leave();
  await page.reload(); await page.waitForSelector('#quickGame');
  assert.equal(await page.locator('#quickGame').inputValue(), 'gems', `${label}: Quick Play remembers the chosen game`);

  // Signed in with a cloud save: Continue opens the island and presses "Continue as ..." itself.
  const worker = /island-saves\..*workers\.dev/;
  await page.route(worker, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ rev: 2, savedAt: Date.now(), data: { kind: 'island-explorer', v: 1, name: 'Mira', lv: 3, team: [], ranch: [], quests: {} } }) }));
  await page.evaluate(() => localStorage.setItem('island-session', JSON.stringify({ token: 's1.' + 'a'.repeat(64), name: 'mira' })));
  await page.reload(); await page.waitForSelector('#continueBtn:not([hidden])');
  assert.match(await page.locator('#continueBtn').innerText(), /Mira/, `${label}: Continue names the saved explorer`);
  // (The world's own start-up is the island suites' concern; here, check the start screen got its answer.)
  await page.evaluate(() => document.addEventListener('click', (e) => { if (e.target.closest('[data-pick="cloud"]')) window.__picked = true; }, true));
  await page.click('#continueBtn');
  await inGame(page);
  await page.waitForFunction(() => window.__picked === true, null, { timeout: 15000 }).catch(() => assert.fail(`${label}: Continue did not choose the saved explorer on the island's start screen`));
  assert.equal((await gameState(page)).role, 'local', `${label}: Continue plays solo on this device`);
  await leave();
  await page.unroute(worker);
  await page.evaluate(() => { localStorage.removeItem('island-session'); localStorage.removeItem('gn-quick'); });
  await page.reload(); await page.waitForSelector('#quickBtn');
  console.log(`PASS ${label}: Quick Play and Continue`);
}
