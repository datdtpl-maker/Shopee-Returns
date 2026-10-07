const {_electron} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const sharp = require('sharp');
const {Store} = require('../src/core.cjs');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srm-chrome-io-')); let app;
  try {
    const store = new Store(dir); store.addProfile('Shop thật'); store.data.settings.autoScan = false; store.data.settings.intervalMinutes = 13; store.save();
    const driveFolder = path.join(dir, 'drive'); fs.mkdirSync(driveFolder);
    const buffers = await Promise.all(Array.from({length: 5}, (_, i) => sharp({create: {width: 600, height: 650, channels: 3, background: {r: 40 + i * 35, g: 50 + i * 21, b: 70 + i * 14}}}).png().toBuffer()));
    const sample = path.join(dir, 'sample.png'); fs.writeFileSync(sample, buffers[0]);
    app = await _electron.launch({args: ['.'], cwd: path.resolve(__dirname, '..'), env: {...process.env, SRM_DATA_DIR: dir, SRM_DRIVER: '1'}});
    const page = await app.firstWindow(); await page.waitForFunction(() => typeof renderStudio === 'function');
    const id = await app.evaluate(({app}, {sample, driveFolder}) => {
      const {products, studio, replacements, referenceImageIO, store, scanner} = app.srmDriver;
      scanner.scan = async () => ({rows: [{orderId: '260901TEST001', shippingText: 'Đã giao', color: 'green'}], totalOrders: 1, ignored: 0, unresolved: 0});
      globalThis.fetch = async () => ({ok: true, text: async () => 'Mã đơn hàng,Mã vận đơn\n260901TEST001,SPX111111'});
      products.ingest(store.data.profiles[0].id, {shop: 'chosen.shop', total: 1, pages: 1, rows: [{productId: '111', modelId: '222', name: 'Bài nguồn', variant: '', price: 100000, stock: 5}]});
      const job = studio.get(studio.create({rowIds: [products.data.rows[0].id]})[0].id);
      const article = {schemaVersion: 1, target: {shop: job.shop, productId: job.productId, name: job.sourceName}, approved: true, images: [], product: {name: 'Sản phẩm mới', description: 'Nội dung nhân viên đã kiểm tra', category: 'Ngành hàng', fields: {}, variants: [{modelId: job.modelId, name: '', price: job.price, stock: 5}]}};
      Object.assign(job, {notionUrl: 'https://app.notion.com/p/' + 'a'.repeat(32), contentApproved: true, status: 'published', name: article.product.name, description: article.product.description, article, baseline: {shop: job.shop, productId: job.productId, name: job.sourceName, description: 'Nội dung nguồn', category: 'Ngành hàng', hasVariants: false, required: [], fields: [], variants: [{modelId: job.modelId, name: '', price: job.price, stock: 5}], images: ['https://down-vn.img.susercontent.com/source']}});
      studio.code = async () => ({id: 'b'.repeat(32), price: job.price, article: structuredClone(article)});
      replacements.editor.validate = () => {};
      referenceImageIO.dialog = {showOpenDialog: async () => ({canceled: false, filePaths: [sample]})};
      store.data.settings.replacementStudio.driveLocalFolder = driveFolder; store.save(); studio.save(); return job.id;
    }, {sample, driveFolder});
    const prepared = await page.evaluate(id => window.srm.call('studio-image-prompts', id), id);
    const reference = await page.evaluate(id => window.srm.call('studio-image-reference-pick', id), id);
    const pairing = await page.evaluate(() => window.srm.call('studio-chrome-pair'));
    assert.equal(pairing.expiresAt, null); assert.equal(pairing.oneTime, true);
    const port = (await page.evaluate(() => window.srm.call('snapshot'))).studioChrome.port;
    const origin = 'chrome-extension://' + 'a'.repeat(32); let token;
    const call = async (route, payload) => {
      const response = await fetch('http://127.0.0.1:' + port + route, {method: 'POST', headers: {Origin: origin, 'Content-Type': 'application/json', ...(token ? {Authorization: 'Bearer ' + token} : {})}, body: JSON.stringify(payload)});
      assert.equal(response.status, 200, route); return response.json();
    };
    token = (await call('/pair', {code: pairing.code})).token;
    const identity = {tabId: 17, documentId: 'doc-integration', path: '/'}, poll = () => call('/poll', {...identity, ready: true, draft: false, generating: false, gate: null});
    await call('/resume', {...identity, ready: true, draft: false, generating: false, gate: null});
    await poll();
    await page.locator('nav [data-tab="replacements"]').click(); await page.locator('#studio-step-2').click(); await page.locator('#studio-image-job').selectOption(id);
    const run = page.evaluate(({id, reference, digest}) => window.srm.call('studio-chrome-run', id, reference, digest), {id, reference: reference.selectionId, digest: prepared.contentDigest});
    run.catch(() => {});
    for (let index = 0; index < 5; index++) {
      let command;
      for (let attempt = 0; attempt < 40 && !command; attempt++) {command = (await poll()).command; if (!command) await new Promise(resolve => setTimeout(resolve, 50));}
      assert.ok(command); assert.equal(command.index, index); assert.match(command.reference.dataUrl, /^data:image\/jpeg;base64,/);
      const event = type => call('/event', {...identity, commandId: command.id, type, phase: type});
      await event('prepared'); await event('submitted');
      await call('/image', {...identity, commandId: command.id, dataUrl: 'data:image/png;base64,' + buffers[index].toString('base64')});
      await page.waitForFunction(count => document.querySelectorAll('#studio-gallery img').length === count, index + 1);
      const state = await page.evaluate(() => window.srm.call('snapshot')), job = state.studio.jobs.find(value => value.id === id);
      assert.equal(job.imageFiles.length, index + 1); assert.equal(state.products.busy, false, 'Shopee lock is released while Chrome runs');
      assert.equal(state.settings.intervalMinutes, 13); assert.equal(job.imagesReady, false, 'no automatic Notion attachment');
      assert.ok(fs.existsSync(path.join(job.localFolder, (index + 1) + '.jpg'))); assert.ok(job.imageFiles[index].bytes < 1900000);
      assert.equal(await page.locator('#studio-attach').isHidden(), true, 'Notion attachment waits for complete set verification, even after the fifth preview arrives');
      if (index === 0) {
        const scanned = await page.evaluate(() => window.srm.call('scan'));
        assert.equal(scanned.studio.busy, true, 'returns complete while the Chrome image run remains pending');
        assert.equal(scanned.orders[0].orderId, '260901TEST001'); assert.ok(scanned.profiles[0].lastScan);
      }
      await event('complete');
    }
    const result = await run; assert.equal(result.status, 'images-ready'); assert.equal(result.imageFiles.length, 5);
    assert.equal(result.localFolder, path.join(driveFolder, 'chosen.shop', 'Sản phẩm mới'));
    assert.equal(await page.locator('#studio-go-step3').isVisible(), true);
    await page.locator('#studio-go-step3').click();
    assert.equal(await page.locator('#studio-attach').isVisible(), true);
    assert.equal((await page.evaluate(() => window.srm.call('snapshot'))).studio.busy, false);
    console.log('PASS Chrome image integration: real IPC/authenticated loopback, native sample capability, sequential compression/Drive writes/live gallery, explicit Notion gate and completed returns scan during pending images. ChatGPT, Shopee and Notion are fixtures.');
  } finally {if (app) await app.close(); assert.ok(dir.startsWith(path.join(os.tmpdir(), 'srm-chrome-io-'))); fs.rmSync(dir, {recursive: true, force: true});}
})().catch(error => {console.error(error); process.exitCode = 1;});
