const {_electron} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const {Store} = require('../src/core.cjs');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srm-draft-delete-')); let app;
  const launch = async () => {
    app = await _electron.launch({args: ['.'], cwd: path.resolve(__dirname, '..'), env: {...process.env, SRM_DATA_DIR: dir, SRM_DRIVER: '1'}});
    const page = await app.firstWindow(); await page.waitForFunction(() => typeof renderStudio === 'function');
    await page.locator('nav [data-tab="replacements"]').click(); return page;
  };
  try {
    const store = new Store(dir); store.data.settings.autoScan = false; store.data.settings.intervalMinutes = 23; store.addProfile('Shop giữ nguyên'); store.save();
    let page = await launch();
    const ids = await app.evaluate(({app}) => {
      const {studio, products} = app.srmDriver;
      products.data.shops[app.srmDriver.store.data.profiles[0].id] = {name: 'shop.delete'};
      products.data.rows = ['111', '333', '555'].map((id, index) => ({id: 'row-' + id, shop: 'shop.delete', productId: id, modelId: '2' + id, name: 'Bài nguồn ' + id, price: 100000, stock: 5, profileId: app.srmDriver.store.data.profiles[0].id}));
      const jobs = studio.create({rowIds: products.data.rows.map(row => row.id)});
      studio.update(jobs[0].id, {name: 'Bản nháp chọn xoá', prompt: 'Nội dung nháp 1'});
      studio.update(jobs[1].id, {name: 'Bản nháp cần giữ', prompt: 'Nội dung nháp 2'});
      Object.assign(studio.get(jobs[2].id), {status: 'published', notionUrl: 'https://app.notion.com/p/' + 'b'.repeat(32), contentApproved: true}); studio.save();
      // The delete flow must never touch Shopee, Notion or Gemini.
      app.srmDriver.scanner.scan = async () => {throw Error('Forbidden scanner call');};
      studio.i.notion = async () => {throw Error('Forbidden Notion call');};
      studio.gemini.generate = async () => {throw Error('Forbidden Gemini call');};
      return jobs.map(job => job.id);
    });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.locator('#studio-job').selectOption(ids[1]); await page.locator('#studio-name').fill('Nội dung chưa lưu của bài còn lại');
    await page.locator('#studio-job').selectOption(ids[0]);
    assert.equal(await page.locator('#studio-delete-draft').isEnabled(), true);
    page.on('dialog', () => {throw Error('Draft deletion must not open a native dialog and steal Electron focus');});
    await page.locator('#studio-delete-draft').click();
    await page.waitForFunction(() => document.querySelector('#studio-job').options.length === 3);
    const snapshot = await page.evaluate(() => window.srm.call('snapshot'));
    assert.deepEqual(snapshot.studio.jobs.map(job => job.id), ids.slice(1));
    assert.equal(snapshot.settings.intervalMinutes, 23); assert.equal(snapshot.profiles[0].name, 'Shop giữ nguyên');
    assert.equal(await page.locator('#studio-job').inputValue(), ''); assert.equal(await page.locator('#studio-delete-draft').isDisabled(), true);
    await page.evaluate(() => { const el = document.getElementById('studio-legacy-source-wrap'); if (el) { el.removeAttribute('hidden'); el.open = true; el.style.setProperty('display', 'block', 'important'); } });
    const source = await page.locator('[data-studio-product="row-333"]').elementHandle();
    await page.evaluate(async () => renderStudio(await window.srm.call('snapshot')));
    assert.equal(await source.evaluate(element => element.isConnected), true, 'background snapshots must not replace the product being clicked');
    await page.locator('[data-studio-product="row-333"]').click();
    await page.waitForFunction(id=>document.querySelector('#studio-job').value===id && !document.querySelector('#studio-name').disabled, ids[1], {timeout:10000});
    await page.waitForFunction(() => !document.querySelector('#studio-delete-draft').disabled);
    await page.locator('#studio-job').selectOption(ids[2]);
    await page.waitForFunction(id => document.querySelector('#studio-job').value === id && !document.querySelector('#studio-delete-draft').disabled, ids[2]);
    assert.equal(await page.locator('#studio-delete-draft').isEnabled(), true);
    await app.evaluate(({app}) => {app.srmDriver.studio.busy = true;});
    await page.evaluate(async () => renderStudio(await window.srm.call('snapshot')));
    assert.equal(await page.locator('#studio-delete-draft').isDisabled(), true);
    await assert.rejects(page.evaluate(id => window.srm.call('studio-delete-draft', id), ids[1]), /Đang xử lý/);
    await app.evaluate(({app}) => {app.srmDriver.studio.busy = false;});
    assert.deepEqual(errors, []); await app.close(); app = null;
    page = await launch();
    const restarted = await page.evaluate(() => window.srm.call('snapshot'));
    assert.deepEqual(restarted.studio.jobs.map(job => job.id), ids.slice(1));
    assert.equal(restarted.studio.jobs[1].notionUrl, 'https://app.notion.com/p/' + 'b'.repeat(32));
    assert.equal(restarted.settings.intervalMinutes, 23);
    console.log('PASS draft delete UI: real IPC, selected unsent draft only, immediate delete/reselect without native dialogs, stable DOM through background updates, preserved other edits/history/Notion links/settings, busy/published server guards and persisted removal across restart. No provider calls.');
  } finally {
    if (app) await app.close();
    const resolved = fs.realpathSync(dir), relative = path.relative(os.tmpdir(), resolved);
    assert.ok(!path.isAbsolute(relative) && !relative.startsWith('..') && path.basename(resolved).startsWith('srm-draft-delete-'));
    fs.rmSync(resolved, {recursive: true, force: true});
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
