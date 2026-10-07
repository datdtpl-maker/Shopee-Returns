const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {randomUUID, createHash} = require('node:crypto');
const sharp = require('sharp');
const {ReplacementStudio} = require('../src/replacement-studio.cjs');
const {LocalDrive} = require('../src/studio-drive.cjs');
const clone = value => structuredClone(value);
const hash = buffer => createHash('sha256').update(buffer).digest('hex');
const raster = index => sharp({create: {width: 600, height: 650, channels: 3, background: {r: 20 + index * 41, g: 30 + index * 29, b: 40 + index * 12}}}).png().toBuffer();

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srm-streaming-')); t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const row = {id: 'source-row', shop: 'selected.shop', productId: '111', modelId: '222', name: 'Bài nguồn thật', price: 123000}, driveRoot = path.join(dir, 'Drive'); fs.mkdirSync(driveRoot);
  const drive = new LocalDrive(() => ({driveLocalFolder: driveRoot})), replacements = {data: {links: {}}, resolve: () => row, editor: {inspect: async () => {throw Error('Streaming must never read Shopee');}, validate: () => {}}};
  const studio = new ReplacementStudio(dir, {products: {data: {rows: [row]}}, replacements, drive, integrations: {}, gemini: {}, chatgpt: {generate: async () => {throw Error('Streaming must not use CDP');}}});
  const job = studio.get(studio.create({rowIds: [row.id]})[0].id), remote = {id: 'a'.repeat(32), price: row.price, article: {schemaVersion: 1, target: {shop: row.shop, productId: row.productId, name: row.name}, approved: true, images: [],
    product: {name: 'Tên bài mới', description: 'Nội dung mới đã duyệt', category: 'Ngành hàng', fields: {}, variants: [{modelId: row.modelId, name: '', price: row.price, stock: 20}]}}};
  Object.assign(job, {notionUrl: 'https://app.notion.com/p/' + 'b'.repeat(32), name: remote.article.product.name, description: remote.article.product.description, article: clone(remote.article), contentApproved: true, status: 'published',
    baseline: {shop: row.shop, productId: row.productId, name: row.name, images: ['https://down-vn.img.susercontent.com/source-sample']}});
  studio.code = async () => clone(remote); job.manualPromptDigest = studio.imageDigest(job, remote.article); studio.save();
  const reference = {name: 'sample.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,reference'}, args = {jobId: job.id, shop: row.shop, productId: row.productId, productName: job.name};
  return {dir, studio, job, row, remote, drive, driveRoot, reference, args};
}

test('CDP saves genuine numbered PNGs by shop/product, streams previews, and retains separate compressed publishing copies', async t => {
  const f=setup(t), notifications=[];
  const bridge={generate:async payload=>{
    for(let index=0;index<5;index++) {
      if(index) assert.equal((await sharp(path.join(f.job.localFolder,index+'.png')).metadata()).format,'png');
      await payload.onImage({jobId:f.job.id,index,buffer:await raster(index)});
      assert.equal(f.studio.publicJob(f.job).imageFiles[index].filename,(index+1)+'.png');
    }
  }};
  const result=await f.studio.chromeImages(f.job.id,{bridge,transport:'chrome-cdp',reference:f.reference,contentDigest:f.job.manualPromptDigest,onImage:(_,image)=>notifications.push(image.ordinal)});
  assert.equal(result.localFolder,path.join(f.driveRoot,'selected.shop','Tên bài mới'));
  assert.deepEqual(fs.readdirSync(result.localFolder).sort(),['1.png','2.png','3.png','4.png','5.png','srm-manifest.json']);
  assert.deepEqual(notifications,[1,2,3,4,5]);assert.equal(result.status,'images-ready');assert.equal(result.imageSource,'chrome-cdp');
  for(let i=0;i<5;i++) {
    const png=f.job.driveAssets.images[i], jpg=f.job.generatedAssets.images[i];
    assert.equal((await sharp(png.path).metadata()).format,'png');assert.equal(hash(fs.readFileSync(png.path)),png.hash);
    assert.equal((await sharp(jpg.path).metadata()).format,'jpeg');assert.ok(jpg.bytes<1900000);
  }
  f.studio.replacements.publisher={attachImages:async (_integration,_url,assets)=>{
    assert.equal(assets,f.job.generatedAssets,'publish compressed copies, keep originals in Drive');
    for(const image of assets.images)assert.equal((await sharp(image.path).metadata()).format,'jpeg');
    throw Error('Stop before external Notion write');
  }};
  await assert.rejects(f.studio.attach(f.job.id),/Stop before external Notion write/);
});

test('CDP failures proven before submission permit retry; submitted failure keeps history', async t=>{
  const f=setup(t), config={transport:'chrome-cdp',reference:f.reference,contentDigest:f.job.manualPromptDigest};
  await assert.rejects(f.studio.chromeImages(f.job.id,{...config,bridge:{generate:async()=>{throw Object.assign(Error('No composer'),{code:'CHATGPT_NOT_READY'});}}}));
  assert.equal(f.job.status,'published');assert.equal(f.job.chromeImageAttempted,undefined);
  await assert.rejects(f.studio.chromeImages(f.job.id,{...config,bridge:{generate:async()=>{throw Object.assign(Error('Send timed out'),{code:'CHATGPT_IMAGE_UNCERTAIN',submitted:true});}}}));
  assert.equal(f.job.status,'images-uncertain');assert.equal(f.job.chromeImageAttempted,true);
});

test('streaming commits and shows each compressed image in its slot before the next image starts', async t => {
  const f = setup(t), notified = []; let generateCalls = 0;
  const bridge = {generate: async payload => {
    generateCalls++; assert.equal(payload.jobId, f.job.id); assert.equal(payload.reference, f.reference); assert.equal(payload.prompts.length, 5);
    for (let index = 0; index < 5; index++) {
      const before = f.studio.publicJob(f.job); assert.equal(before.imageFiles.length, index);
      if (index) {
        const persisted = JSON.parse(fs.readFileSync(f.studio.file, 'utf8')).jobs.find(job => job.id === f.job.id);
        assert.equal(persisted.generatedAssets.images.length, index); assert.ok(fs.existsSync(path.join(f.job.localFolder, index + '.jpg')));
      }
      await payload.onImage({jobId: f.job.id, contentDigest: payload.contentDigest, index, buffer: await raster(index)});
      assert.equal(f.studio.publicJob(f.job).imageFiles.length, index + 1);
      const manifest = JSON.parse(fs.readFileSync(path.join(f.job.localFolder, 'srm-manifest.json'), 'utf8'));
      assert.equal(manifest.status, index === 4 ? 'ready' : 'partial'); assert.equal(manifest.images[index].filename, (index + 1) + '.jpg');
    }
  }};
  const result = await f.studio.chromeImages(f.job.id, {bridge, reference: f.reference, contentDigest: f.job.manualPromptDigest, onImage: (job, image) => notified.push({length: job.imageFiles.length, ordinal: image.ordinal})});
  assert.equal(generateCalls, 1); assert.equal(result.status, 'images-ready'); assert.equal(result.imageSource, 'chrome-extension'); assert.equal(f.job.driveAssets.verified, true);
  assert.deepEqual(notified, [1, 2, 3, 4, 5].map(ordinal => ({length: ordinal, ordinal})));
  assert.deepEqual(result.imageFiles.map(image => image.index), [0, 1, 2, 3, 4]);
  for (const image of f.job.generatedAssets.images) {assert.ok(image.bytes < 1900000); assert.equal((await sharp(image.path).metadata()).format, 'jpeg'); assert.equal(hash(fs.readFileSync(path.join(f.job.localFolder, image.ordinal + '.jpg'))), image.hash);}
});

test('failed later generation preserves streamed images and refuses to automatically repeat the request', async t => {
  const f = setup(t); let calls = 0;
  const bridge = {generate: async payload => {calls++; await payload.onImage({index: 0, buffer: await raster(0)}); throw Error('Disconnected after image one');}};
  await assert.rejects(f.studio.chromeImages(f.job.id, {bridge, reference: f.reference, contentDigest: f.job.manualPromptDigest}), /Disconnected/);
  assert.equal(f.job.status, 'images-uncertain'); assert.equal(f.studio.publicJob(f.job).imageFiles.length, 1); assert.ok(fs.existsSync(path.join(f.job.localFolder, '1.jpg')));
  await assert.rejects(f.studio.chromeImages(f.job.id, {bridge, reference: f.reference, contentDigest: f.job.manualPromptDigest}), error => error.code === 'STUDIO_IMAGES_UNCERTAIN'); assert.equal(calls, 1);
});

test('duplicate generated images stop before a second Drive slot is saved', async t => {
  const f = setup(t), buffer = await raster(0), bridge = {generate: async payload => {await payload.onImage({index: 0, buffer}); await payload.onImage({index: 1, buffer});}};
  await assert.rejects(f.studio.chromeImages(f.job.id, {bridge, reference: f.reference, contentDigest: f.job.manualPromptDigest}), error => error.code === 'STUDIO_CHROME_IMAGE_MISMATCH');
  assert.equal(f.job.generatedAssets.images.length, 1); assert.ok(!fs.existsSync(path.join(f.job.localFolder, '2.jpg')));
});

test('content changes during streaming preserve saved previews and block further image writes', async t => {
  const f = setup(t), bridge = {generate: async payload => {
    await payload.onImage({index: 0, buffer: await raster(0)}); f.remote.article.product.description = 'Nhân viên sửa giữa lượt';
    await payload.onImage({index: 1, buffer: await raster(1)});
  }};
  await assert.rejects(f.studio.chromeImages(f.job.id, {bridge, reference: f.reference, contentDigest: f.job.manualPromptDigest}), error => error.code === 'STUDIO_IMAGE_CONTENT_CHANGED');
  assert.equal(f.job.generatedAssets.images.length, 1); assert.equal(f.remote.article.product.description, 'Nhân viên sửa giữa lượt'); assert.ok(!fs.existsSync(path.join(f.job.localFolder, '2.jpg')));
});

test('wrong index, task identity or digest never commits a stream image', async t => {
  for (const mismatch of [{index: 1}, {index: 0, jobId: randomUUID()}, {index: 0, contentDigest: 'a'.repeat(64)}]) {
    const f = setup(t), bridge = {generate: async payload => payload.onImage({...mismatch, buffer: await raster(0)})};
    await assert.rejects(f.studio.chromeImages(f.job.id, {bridge, reference: f.reference, contentDigest: f.job.manualPromptDigest}), error => error.code === 'STUDIO_CHROME_IMAGE_MISMATCH');
    assert.equal(f.job.generatedAssets, undefined); assert.equal(fs.readdirSync(f.driveRoot).length, 0);
  }
});

test('LocalDrive partial slot retries are idempotent and cannot replace a recorded hash', async t => {
  const f = setup(t), processed = await require('../src/replacement-images.cjs').processImage(await raster(0)), file = path.join(f.dir, 'first.jpg'); fs.writeFileSync(file, processed.buffer);
  const image = {path: file, hash: processed.hash}, first = await f.drive.uploadOne({...f.args, index: 0, image});
  const again = await f.drive.uploadOne({...f.args, index: 0, image, relativeDir: first.relativeDir}); assert.equal(again.image.hash, first.image.hash); assert.equal(again.complete, false);
  const changed = await require('../src/replacement-images.cjs').processImage(await raster(1)); fs.writeFileSync(file, changed.buffer);
  await assert.rejects(f.drive.uploadOne({...f.args, index: 0, image: {path: file, hash: changed.hash}, relativeDir: first.relativeDir}), /hiện có đã khác|Không ghi đè/);
  assert.equal(hash(fs.readFileSync(first.image.path)), processed.hash);
});

test('a Drive error after receiving one stream image retains app-owned image and does not consume image two', async t => {
  const f = setup(t); let second = false; f.drive.uploadOne = async () => {throw Error('Drive disconnected');};
  const bridge = {generate: async payload => {await payload.onImage({index: 0, buffer: await raster(0)}); second = true; await payload.onImage({index: 1, buffer: await raster(1)});}};
  await assert.rejects(f.studio.chromeImages(f.job.id, {bridge, reference: f.reference, contentDigest: f.job.manualPromptDigest}), /Drive disconnected/);
  assert.equal(second, false); assert.equal(f.job.generatedAssets.images.length, 1); assert.equal(f.studio.publicJob(f.job).imageFiles.length, 1); assert.equal(f.job.driveAssets, undefined);
});

test('streaming refuses missing schema without reading the Shopee profile', async t => {
  const f = setup(t); delete f.job.baseline; let called = false;
  await assert.rejects(f.studio.chromeImages(f.job.id, {bridge: {generate: () => {called = true;}}, reference: f.reference, contentDigest: f.job.manualPromptDigest}), /Chuẩn bị form/);
  assert.equal(called, false); assert.equal(f.job.chromeImageAttempted, undefined);
});

test('prepared prompt digest must still match before any bridge request starts', async t => {
  const f = setup(t); let called = false;
  await assert.rejects(f.studio.chromeImages(f.job.id, {bridge: {generate: () => {called = true;}}, reference: f.reference, contentDigest: '0'.repeat(64)}), error => error.code === 'STUDIO_IMAGE_CONTENT_CHANGED');
  assert.equal(called, false); assert.equal(f.job.chromeImageAttempted, undefined);
});

test('failed Chrome request with no saved images preserves the manual import fallback', async t => {
  const f = setup(t), bridge = {generate: async () => {throw Error('Tab unavailable');}};
  await assert.rejects(f.studio.chromeImages(f.job.id, {bridge, reference: f.reference, contentDigest: f.job.manualPromptDigest}), /Tab unavailable/);
  assert.equal(f.job.generatedAssets, undefined);
  const prompts = await f.studio.manualPrompts(f.job.id), files = [];
  for (let index = 0; index < 5; index++) {const file = path.join(f.dir, 'manual-' + index + '.png'); fs.writeFileSync(file, await raster(index)); files.push(file);}
  f.studio.replacements.makeTemplate = () => clone(f.remote.article);
  await f.studio.importLocalImages(f.job.id, files, prompts.contentDigest);
  assert.equal(f.job.status, 'images-ready'); assert.equal(f.job.imageSource, 'manual'); assert.equal(f.job.chromeImageAttempted, true);
});

test('LocalDrive remembers a partial slot before interrupted copy and resumes the same folder', async t => {
  const f = setup(t), processed = await require('../src/replacement-images.cjs').processImage(await raster(0)), file = path.join(f.dir, 'first.jpg'); fs.writeFileSync(file, processed.buffer);
  const image = {path: file, hash: processed.hash}, copy = fs.copyFileSync; let attempts = 0;
  fs.copyFileSync = (...args) => {if (++attempts === 2) throw Error('copy interrupted'); return copy(...args);};
  try {await assert.rejects(f.drive.uploadOne({...f.args, index: 0, image}), /interrupted/);} finally {fs.copyFileSync = copy;}
  const folder = path.join(f.driveRoot, f.row.shop, f.job.name), intent = JSON.parse(fs.readFileSync(path.join(folder, 'srm-manifest.json'), 'utf8'));
  assert.equal(intent.status, 'copying'); assert.equal(intent.images[0].hash, image.hash);
  const resumed = await f.drive.uploadOne({...f.args, index: 0, image}); assert.equal(resumed.localFolder, folder); assert.equal(resumed.image.hash, image.hash);
  assert.equal(fs.readdirSync(path.join(f.driveRoot, f.row.shop)).length, 1);
});

test('an explicitly failed request before submit may be retried, without clearing image or request history', async t => {
  const f = setup(t); let calls = 0;
  const bridge = {generate: async payload => {
    if (++calls === 1) throw Object.assign(Error('Chrome chưa nhận lệnh'), {code: 'CHROME_IMAGE_FAILED'});
    for (let index = 0; index < 5; index++) await payload.onImage({index, buffer: await raster(index)});
  }};
  const args = {bridge, reference: f.reference, contentDigest: f.job.manualPromptDigest};
  await assert.rejects(f.studio.chromeImages(f.job.id, args), /chưa nhận/);
  assert.equal(f.job.status, 'published'); assert.equal(f.job.chromeImageAttempted, undefined); assert.equal(f.job.generatedAssets, undefined);
  await f.studio.chromeImages(f.job.id, args); assert.equal(calls, 2); assert.equal(f.job.status, 'images-ready');
});

test('restart preserves partial previews, app-owned bytes and Chrome no-repeat guard', async t => {
  const f = setup(t), bridge = {generate: async payload => {await payload.onImage({index: 0, buffer: await raster(0)}); throw Object.assign(Error('Tab changed after submit'), {code: 'CHROME_IMAGE_UNCERTAIN'});}};
  await assert.rejects(f.studio.chromeImages(f.job.id, {bridge, reference: f.reference, contentDigest: f.job.manualPromptDigest}), /Tab changed/);
  const first = clone(f.job.generatedAssets.images[0]), restored = new ReplacementStudio(f.dir, {products: f.studio.products, replacements: f.studio.replacements, drive: f.drive, integrations: {}});
  const recovered = restored.get(f.job.id); assert.equal(recovered.status, 'images-uncertain'); assert.equal(recovered.chromeImageAttempted, true); assert.deepEqual(recovered.generatedAssets.images[0], first);
  assert.equal(restored.publicJob(recovered).imageFiles[0].ordinal, 1); assert.equal(hash(fs.readFileSync(first.path)), first.hash);
  restored.code = f.studio.code; let called = false;
  await assert.rejects(restored.chromeImages(f.job.id, {bridge: {generate: () => {called = true;}}, reference: f.reference, contentDigest: recovered.manualPromptDigest}), error => error.code === 'STUDIO_IMAGES_UNCERTAIN');
  assert.equal(called, false);
});
