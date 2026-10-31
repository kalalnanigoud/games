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
  // Keep the existing suite's collection assertions independent of this exercise.
  await page.evaluate(()=>{localStorage.removeItem('gn-recent');});
  console.log(`PASS ${label}: draft refresh, typing/menu focus, modal containment and focus restoration`);
}
