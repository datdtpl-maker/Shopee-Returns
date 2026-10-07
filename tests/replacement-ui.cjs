const {_electron} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const sharp = require('sharp');
const {Store} = require('../src/core.cjs');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srm-replacement-ui-'));
  let app;
  try {
    const store = new Store(dir); store.addProfile('Shop chính'); store.addProfile('Shop phụ'); store.data.settings.autoScan = false; store.save();
    const thumbnail = 'data:image/jpeg;base64,' + (await sharp({create: {width: 180, height: 180, channels: 3, background: '#d7eedf'}}).jpeg().toBuffer()).toString('base64');
    app = await _electron.launch({args: ['.'], cwd: path.resolve(__dirname, '..'), env: {...process.env, SRM_DATA_DIR: dir, SRM_DRIVER: '1'}});
    const page = await app.firstWindow(); await page.waitForFunction(() => !!window.srm);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const ids = await app.evaluate(({app}, previewDataUrl) => {
      const {products, store, replacements, replacementEditor} = app.srmDriver;
      for (const [index, profile] of store.data.profiles.entries()) products.ingest(profile.id, {
        shop: 'shop' + index, total: 1, pages: 1, scannedAt: new Date().toISOString(),
        rows: [{productId: String(123 + index), modelId: String(456 + index), name: (index ? 'Beta' : 'Alpha') + ' <img src=x>', variant: 'Hộp', price: 100000, stock: 20},
          ...(!index ? [{productId: '123', modelId: '999', name: 'Alpha <img src=x>', variant: 'Gói', price: 50000, stock: 12}] : [])],
      });
      globalThis.replacementCalls = {inspect: 0, templates: 0, prepare: 0, run: []}; globalThis.returnCalls = 0;
      const schema = row => ({shop: row.shop, productId: row.productId, name: row.name, category: 'Chăm sóc cá nhân', fields: [
        {label: 'Tên sản phẩm', kind: 'text', required: true, value: row.name},
        {label: 'Thương hiệu <img src=x>', kind: 'select', required: true, value: 'No brand'},
      ]});
      replacementEditor.inspect = async target => { globalThis.replacementCalls.inspect++; return schema(target); };
      replacements.loadLinks = async () => { replacements.progress = 'Đã đọc link Notion'; return replacements.snapshot(); };
      replacements.createTemplate = async id => {
        globalThis.replacementCalls.templates++;
        const row = products.data.rows.find(item => item.id === id); row.replacementUrl = 'https://app.notion.com/p/3e070655a9aa816c98f4dc2c863fa5bb'; products.save();
        return {url: row.replacementUrl, existing: false};
      };
      replacements.prepare = async (id, url) => {
        globalThis.replacementCalls.prepare++;
        const row = products.data.rows.find(item => item.id === id);
        const plan = {
          id: 'test-plan-' + globalThis.replacementCalls.prepare, rowId: id,
          target: {...schema(row), profileId: row.profileId}, schema: schema(row), articleUrl: url,
          article: {product: {name: 'Sản phẩm mới <img src=x>', description: 'Mô tả đầy đủ\nGiữ nguyên thông tin đã kiểm tra.', category: 'Chăm sóc cá nhân'}},
          diff: {changes: [{label: 'Tên sản phẩm', before: row.name, after: 'Sản phẩm mới <img src=x>'}]},
          assets: {images: [{filename: '01-preview.jpg', hash: 'a'.repeat(64), bytes: 123456, width: 1000, height: 1000, previewDataUrl},
            {filename: '<img src=x>.jpg', bytes: 190000, width: 900, height: 900, previewDataUrl: 'javascript:alert(1)'}]},
          status: 'prepared', createdAt: new Date().toISOString(), expiresAt: Date.now() + 600000,
        };
        replacements.data.plans.unshift(plan); replacements.save(); return replacements.publicPlan(plan);
      };
      replacements.run = async id => {
        const plan = replacements.data.plans.find(item => item.id === id);
        globalThis.replacementCalls.run.push(id); plan.status = 'running'; replacements.save();
        if (globalThis.holdReplacement) await new Promise(resolve => globalThis.finishReplacement = resolve);
        plan.status = 'verified'; plan.verifiedAt = new Date().toISOString(); replacements.save();
        return replacements.publicPlan(plan);
      };
      products.sync = async () => {};
      app.srmDriver.scanner.scan = async () => { globalThis.returnCalls++; return {rows: [], totalOrders: 0, ignored: 0, unresolved: 0}; };
      globalThis.fetch = async () => ({ok: true, text: async () => 'Mã đơn hàng,Mã vận đơn\n260901TEST001,SPX123'});
      return products.data.rows.map(row => row.id);
    }, thumbnail);
    await page.reload(); await page.locator('nav [data-tab="replacements"]').click();
    assert.equal(await page.locator('#crumb').innerText(), 'Sản phẩm thay thế');
    for (const id of ['replacement-shop', 'replacement-search', 'replacement-product', 'replacement-load', 'replacement-inspect', 'replacement-template', 'replacement-article-form', 'replacement-article-url', 'replacement-schema', 'replacement-history-rows']) {
      assert.equal(await page.locator('#' + id).count(), 0, 'legacy control removed: ' + id);
    }
    assert.equal(await page.locator('.replacement-history').count(), 0);
    assert.equal(await page.locator('#studio-publish-panel #replacement-preview').count(), 1, 'read-only preview belongs to step 3');
    assert.equal(await page.locator('#replacement-preview').isVisible(), false, 'no preview on step 1');
    const planId = await page.evaluate(async id => {
      const result = await window.srm.call('replacements-prepare', id, 'https://app.notion.com/p/3e070655a9aa816c98f4dc2c863fa5bb');
      render(await window.srm.call('snapshot')); selectReplacementPreview(result.id, id);
      return result.id;
    }, ids[0]);
    await page.locator('#studio-step-3').click();
    await page.locator('#replacement-preview').waitFor({state: 'visible'});
    assert.match(await page.locator('#replacement-preview-identity').innerText(), /ID sản phẩm nguồn\n123/);
    assert.equal(await page.locator('#replacement-diff-rows img').count(), 0);
    assert.equal(await page.locator('#replacement-images img').count(), 1, 'only a bounded JPEG data thumbnail is rendered');
    assert.equal(await page.locator('.replacement-image').count(), 2);
    assert.match(await page.locator('#replacement-images').innerText(), /123.456 byte/);
    assert.equal(await page.locator('#replacement-run').isEnabled(), true);
    assert.equal(await app.evaluate(() => globalThis.replacementCalls.run.length), 0, 'selection and preparation never run a Shopee update');
    assert.match(await page.locator('#replacement-validation').innerText(), /2 trường bắt buộc/);
    for (const width of [1440, 780, 390]) {
      await app.evaluate(({BrowserWindow}, width) => { const win = BrowserWindow.getAllWindows()[0]; win.setMinimumSize(360, 500); win.setSize(width, 1000); }, width);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'page fits viewport ' + width);
    }
    await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setSize(1440, 1000));
    if (process.env.SRM_REPLACEMENT_SCREENSHOT) await page.screenshot({path: process.env.SRM_REPLACEMENT_SCREENSHOT, fullPage: true});
    await page.locator('#studio-step-1').click(); assert.equal(await page.locator('#replacement-preview').isVisible(), false);
    await page.locator('#studio-step-3').click();
    await page.evaluate(({planId, rowId}) => selectReplacementPreview(planId, rowId), {planId, rowId: ids[2]});
    assert.equal(await page.locator('#replacement-run').isDisabled(), true, 'mismatched source product cannot run');
    await page.evaluate(({planId, rowId}) => selectReplacementPreview(planId, rowId), {planId, rowId: ids[0]});
    assert.equal(await page.locator('#replacement-run').isEnabled(), true);
    await app.evaluate(({app}) => {app.srmDriver.replacements.data.plans[0].target.profileId = 'different-profile';});
    await page.evaluate(async () => render(await window.srm.call('snapshot')));
    assert.equal(await page.locator('#replacement-run').isDisabled(), true, 'mismatched Shopee profile cannot run');
    await app.evaluate(({app}, profileRowId) => {
      const plan = app.srmDriver.replacements.data.plans[0];
      plan.target.profileId = app.srmDriver.products.data.rows.find(row => row.id === profileRowId).profileId;
    }, ids[0]);
    await app.evaluate(({app}) => { app.srmDriver.replacements.data.plans[0].expiresAt = Date.now() - 1; });
    await page.evaluate(async () => render(await window.srm.call('snapshot')));
    assert.equal(await page.locator('#replacement-run').isDisabled(), true);
    assert.match(await page.locator('#replacement-validation').innerText(), /hết hạn/);
    await app.evaluate(({app}) => { const plan = app.srmDriver.replacements.data.plans[0]; plan.status = 'uncertain'; plan.error = 'Lưu chưa xác minh; không tự chạy lại'; });
    await page.evaluate(async () => render(await window.srm.call('snapshot')));
    assert.equal(await page.locator('#replacement-run').isDisabled(), true);
    assert.match(await page.locator('#replacement-validation').innerText(), /không tự chạy lại/);
    await app.evaluate(({app}) => { const plan = app.srmDriver.replacements.data.plans[0]; plan.status = 'prepared'; plan.error = ''; plan.expiresAt = Date.now() + 600000; app.srmDriver.replacements.save(); });
    await page.reload(); await page.locator('nav [data-tab="replacements"]').click(); await page.locator('#studio-step-3').click();
    assert.equal(await page.locator('#replacement-run').isEnabled(), true);
    assert.equal(await app.evaluate(() => globalThis.replacementCalls.run.length), 0, 'reopening a persisted plan never saves automatically');
    await page.evaluate(() => window.srm.call('settings', {autoScan: true, intervalMinutes: 1, notionEnabled: false, telegramEnabled: false}));
    const due = (await page.evaluate(() => window.srm.call('snapshot'))).nextScan;
    await app.evaluate(() => { globalThis.holdReplacement = true; }); await page.locator('#replacement-run').click();
    await page.waitForFunction(async () => (await window.srm.call('snapshot')).products.busy);
    assert.equal(await page.locator('#studio-activate').isDisabled(), true);
    assert.equal(await page.locator('#replacement-run').isDisabled(), true);
    await app.evaluate(() => { globalThis.realNow = Date.now; Date.now = () => globalThis.realNow() + 120000; });
    await page.waitForTimeout(5500); assert.equal(await app.evaluate(() => globalThis.returnCalls), 0);
    assert.equal((await page.evaluate(() => window.srm.call('snapshot'))).nextScan, due);
    await assert.rejects(page.evaluate(() => window.srm.call('products-scan')), /bận/);
    await app.evaluate(() => { globalThis.holdReplacement = false; globalThis.finishReplacement(); });
    await page.waitForFunction(async () => (await window.srm.call('snapshot')).replacements.plans[0].status === 'verified');
    await page.waitForFunction(async () => !(await window.srm.call('snapshot')).scanning && !(await window.srm.call('snapshot')).products.busy);
    assert.equal(await app.evaluate(() => globalThis.returnCalls), 2, 'both overdue profile returns scans resume after replacement');
    await app.evaluate(() => { Date.now = globalThis.realNow; });
    assert.equal(await app.evaluate(() => globalThis.replacementCalls.run.length), 1);
    assert.equal(await page.locator('#replacement-run').isDisabled(), true);
    assert.deepEqual(errors, []);
    console.log('PASS replacement UI: legacy controls removed, step 3 preview, source/profile identity, required fields, explicit run, image metadata/thumbnails, XSS, expiry/uncertain guards, persisted preview, responsive layout and overdue returns lock.');
  } finally { if (app) await app.close(); fs.rmSync(dir, {recursive: true, force: true}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
