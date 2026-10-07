const {_electron} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const sharp = require('sharp');
const {Store} = require('../src/core.cjs');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srm-cdp-io-')); let app;
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
    await app.evaluate(({app})=>{
      const {chatgpt}=app.srmDriver;
      chatgpt.test=async()=>({ready:true});
      chatgpt.generate=async payload=>{
        globalThis.cdpPayload=payload;
        return new Promise(resolve=>{globalThis.finishCdp=resolve;});
      };
    });
    await page.locator('nav [data-tab="replacements"]').click(); await page.locator('#studio-step-2').click(); await page.locator('#studio-image-job').selectOption(id);
    const run = page.evaluate(({id, reference, digest}) => window.srm.call('studio-cdp-run', id, reference, digest), {id, reference: reference.selectionId, digest: prepared.contentDigest});
    run.catch(() => {});
    for (let index = 0; index < 5; index++) {
      await page.waitForFunction(()=>window.srm);
      for(let attempt=0;attempt<100;attempt++) {
        if(await app.evaluate(()=>!!globalThis.cdpPayload))break;
        await new Promise(resolve=>setTimeout(resolve,30));
      }
      await app.evaluate(async ({app},{index,base64})=>{
        const payload=globalThis.cdpPayload;
        if(payload.prompts.length!==5 || !/^data:image\/jpeg;base64,/.test(payload.reference.dataUrl))throw Error('Wrong prompts/reference');
        if(index && app.srmDriver.studio.get(payload.jobId).chromeDriveAssets.images.length!==index)throw Error('Prior slot not saved');
        await payload.onImage({jobId:payload.jobId,contentDigest:payload.contentDigest,index,buffer:Buffer.from(base64,'base64')});
      },{index,base64:buffers[index].toString('base64')});
      await page.waitForFunction(count => document.querySelectorAll('#studio-gallery img').length === count, index + 1);
      const state = await page.evaluate(() => window.srm.call('snapshot')), job = state.studio.jobs.find(value => value.id === id);
      assert.equal(job.imageFiles.length, index + 1); assert.equal(state.products.busy, false, 'Shopee lock is released while Chrome runs');
      assert.equal(state.settings.intervalMinutes, 13); assert.equal(job.imagesReady, false, 'no automatic Notion attachment');
      assert.ok(fs.existsSync(path.join(job.localFolder, (index + 1) + '.png'))); assert.ok(job.imageFiles[index].bytes < 1900000);
      assert.equal(await page.locator('#studio-attach').isHidden(), true, 'Notion attachment waits for complete set verification, even after the fifth preview arrives');
      if (index === 0) {
        const scanned = await page.evaluate(() => window.srm.call('scan'));
        assert.equal(scanned.studio.busy, true, 'returns complete while the Chrome image run remains pending');
        assert.equal(scanned.orders[0].orderId, '260901TEST001'); assert.ok(scanned.profiles[0].lastScan);
      }
    }
    await app.evaluate(()=>globalThis.finishCdp({conversationUrl:'https://chatgpt.com/c/test-cdp'}));
    const result = await run; assert.equal(result.status, 'images-ready'); assert.equal(result.imageFiles.length, 5);
    assert.equal(result.localFolder, path.join(driveFolder, 'chosen.shop', 'Sản phẩm mới'));
    assert.equal(await page.locator('#studio-go-step3').isVisible(), true);
    await page.locator('#studio-go-step3').click();
    assert.equal(await page.locator('#studio-attach').isVisible(), true);
    assert.equal((await page.evaluate(() => window.srm.call('snapshot'))).studio.busy, false);
    console.log('PASS CDP image integration: real IPC/native sample capability, sequential PNG/Drive writes/live gallery, explicit Notion gate and completed returns scan during pending images. ChatGPT, Shopee and Notion are fixtures.');
  } finally {if (app) await app.close(); assert.ok(dir.startsWith(path.join(os.tmpdir(), 'srm-cdp-io-'))); fs.rmSync(dir, {recursive: true, force: true});}
})().catch(error => {console.error(error); process.exitCode = 1;});
