const {_electron} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const sharp = require('sharp');
const {Store} = require('../src/core.cjs');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srm-manual-ui-')); let app;
  try {
    const store = new Store(dir); store.addProfile('Shop ảnh'); store.data.settings.autoScan = false; store.data.settings.intervalMinutes = 17; store.save();
    const files = [];
    for (let i = 0; i < 5; i++) {const file = path.join(dir, 'download-' + i + '.png'); fs.writeFileSync(file, await sharp({create: {width: 1024, height: 1024, channels: 3, background: {r: i * 40, g: 70 + i * 20, b: 40}}}).png().toBuffer()); files.push(file);}
    app = await _electron.launch({args: ['.'], cwd: path.resolve(__dirname, '..'), env: {...process.env, SRM_DATA_DIR: dir, SRM_DRIVER: '1'}});
    const page = await app.firstWindow(); await page.waitForFunction(() => !!window.srm && typeof renderStudio === 'function');
    const errors = []; page.on('pageerror', failure => errors.push(failure.message));
    const driveFolder = path.join(dir, 'drive'); fs.mkdirSync(driveFolder);
    const ids = await app.evaluate(({app}, {driveFolder, files}) => {
      const {store, products, studio, replacements, replacementEditor, integrations, manualImageIO, chatgpt} = app.srmDriver;
      globalThis.manualCalls = {opened: 0, picked: 0, browserReads: 0, uploaded: 0, links: []};
      const profileId = store.data.profiles[0].id;
      products.ingest(profileId, {shop: 'shop.anh', total: 2, pages: 1, scannedAt: new Date().toISOString(), rows: [
        {productId: '111', modelId: '222', name: 'Sản phẩm Alpha', variant: '', price: 100000, stock: 20},
        {productId: '333', modelId: '444', name: 'Sản phẩm Beta', variant: '', price: 110000, stock: 10},
      ]});
      studio.create({rowIds: products.data.rows.map(row => row.id)});
      studio.data.databaseId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const remote = new Map(), blocks = new Map();
      for (const [index, job] of studio.data.jobs.entries()) {
        const baseline = {shop: job.shop, productId: job.productId, name: job.sourceName, description: 'Nhãn thật', category: 'Ngành cũ', hasVariants: false, required: [], images: ['https://down-vn.img.susercontent.com/product-image'], fields: [], variants: [{modelId: job.modelId, name: '', price: job.price, stock: 20}]};
        baseline.fields = [{label: 'Tên sản phẩm', kind: 'text', value: job.sourceName}, {label: 'Mô tả sản phẩm', kind: 'textarea', value: baseline.description}, {label: 'Ngành hàng', kind: 'category', value: baseline.category}, {label: 'Giá', kind: 'number', value: job.price}, {label: 'Kho hàng', kind: 'number', value: 20}];
        const row = studio.row(job), article = replacements.makeTemplate(row, baseline);
        article.product.name = 'Tên mới ' + (index + 1); article.product.description = 'Bài mẫu đúng sản phẩm ' + (index + 1); article.images = []; article.approved = true;
        Object.assign(job, {name: article.product.name, description: article.product.description, contentApproved: true, notionUrl: 'https://app.notion.com/p/' + String(index + 1).padStart(32, 'b'), status: 'published', article, baseline});
        remote.set(job.id, structuredClone(article)); blocks.set(job.id, String(index + 1).padStart(32, 'c'));
      }
      integrations.notion = async (endpoint, method = 'GET', body) => {
        const job = studio.data.jobs.find(j => endpoint.includes(j.notionUrl.split('/').at(-1)) || endpoint.includes(blocks.get(j.id)));
        if (!job) throw Error('Unexpected Notion endpoint');
        if (endpoint.startsWith('pages/')) return {id: job.notionUrl.split('/').at(-1), parent: {database_id: studio.data.databaseId}, properties: studio.props(job)};
        if (endpoint.includes('/children')) return {results: [{id: blocks.get(job.id), type: 'code', code: {language: 'json', rich_text: [{text: {content: JSON.stringify(remote.get(job.id))}}]}}], has_more: false};
        if (endpoint.startsWith('blocks/') && method === 'PATCH') {remote.set(job.id, JSON.parse(body.code.rich_text.map(x => x.text.content).join(''))); return {};}
        throw Error('Unexpected Notion operation');
      };
      replacements.publisher = {attachImages: async (_, url, assets, options) => {
        globalThis.manualCalls.uploaded++; options.beforeAppend();
        return assets.images.map((_, i) => 'https://www.notion.so/' + url.split('/').at(-1) + '#' + String(i + 1).padStart(32, 'd'));
      }};
      studio.linkSource = async job => {globalThis.manualCalls.links.push(job.id);};
      const forbidden = async () => {globalThis.manualCalls.browserReads++; throw Error('Manual prompt/import must not open an automation browser');};
      replacementEditor.inspect = forbidden; chatgpt.open = async () => {globalThis.manualCalls.opened++; return {message:'Isolated Chrome launch stub'};}; chatgpt.test = forbidden; chatgpt.generate = forbidden;
      manualImageIO.openChrome = async () => {globalThis.manualCalls.opened++; return {message: 'Chrome normal launch stub'};};
      manualImageIO.dialog = {showOpenDialog: async () => {const file = files[globalThis.manualCalls.picked++ % 5]; return {canceled: false, filePaths: [file]};}};
      store.data.settings.replacementStudio.driveLocalFolder = driveFolder; store.save(); studio.save();
      // Manual work must stay available while an independent returns/product scan is running.
      products.busy = true;
      return studio.data.jobs.map(job => job.id);
    }, {driveFolder, files});
    await page.reload(); await page.locator('nav [data-tab="replacements"]').click(); await page.locator('#studio-step-2').click();
    await page.locator('#studio-image-job').selectOption(ids[0]);
    assert.equal(await page.locator('#studio-images').isVisible(), false, 'CDP controls are hidden');
    assert.equal(await page.locator('#studio-manual-fallback').evaluate(element => element.open), false, 'manual import is a collapsed fallback');
    await page.locator('#studio-manual-fallback').evaluate(element => { element.hidden = false; });
    await page.locator('#studio-manual-fallback summary').click();
    assert.equal(await page.locator('#studio-import-images').isDisabled(), true);
    assert.equal(await page.locator('#studio-manual-title').isVisible(), false, 'manual prompt section is hidden');
    await page.locator('#studio-manual-prompts').evaluate(btn => btn.click());
    await page.waitForFunction(() => document.querySelector('#studio-image-prompt-text').value.includes('Tên mới 1'));
    await page.locator('#studio-normal-chatgpt').evaluate(button => button.click());
    await page.waitForFunction(() => !document.querySelector('#studio-normal-chatgpt').disabled);
    assert.equal(await app.evaluate(() => globalThis.manualCalls.opened), 1);
    for (let i = 0; i < 5; i++) {
      await page.locator('[data-studio-image-slot="' + i + '"]').click();
      await page.waitForFunction(count => document.querySelector('#studio-import-count').textContent.startsWith(count + '/5'), i + 1);
    }
    assert.equal(await page.locator('#studio-gallery img').count(), 5);
    assert.equal(await page.locator('#studio-import-images').isEnabled(), true);
    await page.locator('#studio-image-job').selectOption(ids[1]);
    assert.equal(await page.locator('#studio-image-prompt-text').inputValue(), '', 'prompt does not leak into another job');
    assert.equal(await page.locator('#studio-gallery img').count(), 0, 'selections belong to their source article');
    await page.locator('#studio-image-job').selectOption(ids[0]); assert.equal(await page.locator('#studio-gallery img').count(), 5);
    await page.locator('#studio-import-images').click(); await page.waitForFunction(() => !document.querySelector('#studio-go-step3').hidden, null, {timeout: 10000});
    await page.locator('#studio-go-step3').click();
    await page.waitForFunction(() => !document.querySelector('#studio-attach').disabled, null, {timeout: 10000});
    const saved = (await page.evaluate(() => window.srm.call('snapshot'))).studio.jobs.find(job => job.id === ids[0]);
    assert.equal(saved.imageSource, 'manual'); assert.equal(saved.imageFiles.length, 5);
    assert.ok(saved.localFolder.startsWith(path.join(dir, 'drive', 'shop.anh')));
    assert.ok(saved.imageFiles.every(image => image.bytes < 1900000));
    assert.equal(await app.evaluate(() => globalThis.manualCalls.browserReads), 0);
    assert.equal((await page.evaluate(() => window.srm.call('snapshot'))).settings.intervalMinutes, 17);
    await app.evaluate(({app}) => {app.srmDriver.products.busy = false;});
    await page.locator('#studio-attach').click(); await page.waitForFunction(() => document.querySelector('#studio-ready-status').textContent.includes('Đã có bài và 5 ảnh'), null, {timeout: 10000});
    assert.equal(await app.evaluate(() => globalThis.manualCalls.uploaded), 1); assert.deepEqual(await app.evaluate(() => globalThis.manualCalls.links), [ids[0]]);
    assert.equal(await page.locator('#studio-import-images').isDisabled(), true);
    for (const width of [1440, 780, 390]) {
      await app.evaluate(({BrowserWindow}, width) => {const window = BrowserWindow.getAllWindows()[0]; window.setMinimumSize(360, 500); window.setSize(width, 1000);}, width);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'manual images fit viewport ' + width);
    }
    if (process.env.SRM_MANUAL_SCREENSHOT) {await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setSize(1440, 1050)); await page.screenshot({path: process.env.SRM_MANUAL_SCREENSHOT, fullPage: true});}
    assert.deepEqual(errors, []);
    console.log('PASS manual image UI: real IPC and local compression/Drive writes, per-job prompt and file selection, clipboard, normal-browser launcher, no CDP/browser reads, Notion attach/link and unchanged scan interval.');
  } finally {if (app) await app.close(); assert.ok(dir.startsWith(path.join(os.tmpdir(), 'srm-manual-ui-'))); fs.rmSync(dir, {recursive: true, force: true});}
})().catch(error => {console.error(error.message); process.exitCode = 1;});
