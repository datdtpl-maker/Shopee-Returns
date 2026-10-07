const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {randomUUID, createHash} = require('node:crypto');
const sharp = require('sharp');
const {ReplacementStudio} = require('../src/replacement-studio.cjs');
const {LocalDrive} = require('../src/studio-drive.cjs');
const {ReplacementManager} = require('../src/replacements.cjs');
const {prepareLocalImages} = require('../src/studio-manual.cjs');
const clone = value => structuredClone(value);
const digest = value => createHash('sha256').update(value).digest('hex');

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srm-manual-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const source = {id: 'selected-row', shop: 'shop.selected', productId: '111', modelId: '222', name: 'Tên sản phẩm gốc', price: 120000};
  const baseline = {shop: source.shop, productId: source.productId, name: source.name, category: 'Ngành hàng', images: ['https://down-vn.img.susercontent.com/correct-source'],
    variants: [{modelId: source.modelId, name: '', price: source.price, stock: 10}], fields: [{label: 'Thương hiệu', value: 'No brand', required: true, kind: 'select'}]};
  let inspectCalls = 0, sendCalls = 0, codeCalls = 0, beforeCode;
  const driveRoot = path.join(dir, 'Drive'); fs.mkdirSync(driveRoot);
  const drive = new LocalDrive(() => ({driveLocalFolder: driveRoot}));
  const replacements = {data: {links: {}}, resolve: () => source, target: row => row,
    editor: {inspect: async () => {inspectCalls++; return clone(baseline);}, validate: (_, product) => {assert.equal(product.fields['Thương hiệu'], 'No brand');}},
    makeTemplate: ReplacementManager.prototype.makeTemplate};
  const dependencies = {products: {data: {rows: [source]}}, replacements, integrations: {}, drive,
    gemini: {}, chatgpt: {generate: async () => {sendCalls++; throw Error('Manual must not submit');}}};
  const studio = new ReplacementStudio(dir, dependencies), job = studio.get(studio.create({rowIds: [source.id]})[0].id);
  Object.assign(job, {name: 'Tên bài mới', description: 'Nội dung mới đã được nhân viên xem', status: 'published', contentApproved: true, notionUrl: 'https://app.notion.com/p/' + 'a'.repeat(32)});
  const remote = {id: 'b'.repeat(32), price: source.price, article: {schemaVersion: 1, target: {shop: source.shop, productId: source.productId, name: source.name}, approved: true, images: [],
    product: {name: job.name, description: job.description, category: baseline.category, fields: {'Thương hiệu': 'No brand'}, variants: clone(baseline.variants)}}};
  studio.i.notion = async (_, method, body) => {
    assert.equal(method, 'PATCH'); assert.ok(body.code);
    remote.article = JSON.parse(body.code.rich_text.map(entry => entry.text.content).join('')); return {};
  };
  job.article = clone(remote.article); studio.save();
  studio.code = async () => {codeCalls++; if (beforeCode) await beforeCode(codeCalls); return clone(remote);};
  const files = async (prefix = 'input', shift = 0) => {
    const results = [];
    for (let index = 0; index < 5; index++) {
      const filename = path.join(dir, prefix + '-' + (index + 1) + '.png');
      await sharp({create: {width: 600, height: 650, channels: 3, background: {r: (index * 42 + shift) % 255, g: 20 + index * 13, b: 50 + index * 11}}}).png().toFile(filename); results.push(filename);
    }
    return results;
  };
  const prompt = async () => (await studio.manualPrompts(job.id)).contentDigest;
  return {dir, source, baseline, driveRoot, drive, studio, job, remote, files, prompt, counts: () => ({inspectCalls, sendCalls, codeCalls}), hook: callback => {beforeCode = callback;}};
}

test('manual prompts read the selected approved Notion content without opening Shopee or sending ChatGPT', async t => {
  const f = setup(t); f.remote.article.product.description = 'Nhân viên vừa sửa đúng bài Notion.';
  const result = await f.studio.manualPrompts(f.job.id);
  assert.equal(result.jobId, f.job.id); assert.equal(result.shop, f.source.shop); assert.equal(result.prompts.length, 5);
  assert.deepEqual(result.prompts.map(prompt => prompt.index), [1, 2, 3, 4, 5]);
  assert.deepEqual(result.prompts.map(prompt => prompt.title), ['Ảnh bìa', 'Thành phần nổi bật', 'Công dụng chính', 'Cách dùng', 'Điểm tin cậy']);
  for (const prompt of result.prompts) {assert.ok(prompt.text.includes('Nhân viên vừa sửa đúng bài Notion.')); assert.ok(prompt.text.includes(f.remote.article.product.name)); assert.ok(!prompt.text.includes('{{selected_'));}
  assert.match(result.sourceProductUrl, /portal\/product\/111\?/); assert.deepEqual(result.sourceImages, []);
  assert.equal(f.counts().inspectCalls, 0); assert.equal(f.counts().sendCalls, 0); assert.equal(f.job.manualPromptDigest, result.contentDigest);
  f.remote.article.approved = false; await assert.rejects(f.studio.manualPrompts(f.job.id), /chưa được xác nhận/);
});

test('manual import compresses five static images into app-owned files, preserving slot order and correct Drive provenance', async t => {
  const f = setup(t), files = await f.files(), contentDigest = await f.prompt();
  const result = await f.studio.importLocalImages(f.job.id, files, contentDigest);
  assert.equal(result.status, 'images-ready'); assert.equal(result.imageSource, 'manual'); assert.equal(f.counts().sendCalls, 0); assert.equal(f.counts().inspectCalls, 1);
  assert.equal(f.job.generatedAssets.images.length, 5); assert.equal(new Set(f.job.generatedAssets.images.map(image => image.hash)).size, 5);
  assert.ok(f.job.localFolder.startsWith(path.join(f.driveRoot, f.source.shop, f.job.name)));
  const manifest = JSON.parse(fs.readFileSync(path.join(f.job.localFolder, 'srm-manifest.json'), 'utf8'));
  assert.equal(manifest.jobId, f.job.id); assert.equal(manifest.shop, f.source.shop); assert.equal(manifest.productId, f.source.productId); assert.equal(manifest.productName, f.job.name);
  for (let index = 0; index < 5; index++) {
    const image = f.job.generatedAssets.images[index], original = fs.readFileSync(files[index]);
    assert.equal(image.sourceHash, digest(original)); assert.equal(image.sourceFilename, path.basename(files[index])); assert.ok(image.path.startsWith(path.join(f.studio.dir, 'assets', f.job.id)));
    assert.ok(image.bytes < 1900000); const metadata = await sharp(image.path).metadata(); assert.equal(metadata.format, 'jpeg'); assert.ok(metadata.width >= 500 && metadata.height >= 500);
    assert.equal(digest(fs.readFileSync(path.join(f.job.localFolder, (index + 1) + '.jpg'))), image.hash);
  }
  assert.equal(result.imageFiles[0].path, undefined); assert.match(f.job.imageContentDigest, /^[a-f\d]{64}$/); assert.match(f.job.imageSourceDigest, /^[a-f\d]{64}$/);
});

test('an invalid fifth image leaves no authoritative assets or partial imported set', async t => {
  const f = setup(t), files = await f.files(), contentDigest = await f.prompt(); fs.writeFileSync(files[4], '<html>not an image</html>');
  await assert.rejects(f.studio.importLocalImages(f.job.id, files, contentDigest), /hỏng|điểm ảnh/);
  assert.equal(f.job.generatedAssets, undefined); assert.equal(f.job.driveAssets, undefined); assert.equal(f.job.imageSource, undefined); assert.equal(f.job.status, 'published');
  assert.equal(fs.existsSync(path.join(f.studio.dir, 'assets')), false); assert.equal(fs.readdirSync(f.driveRoot).length, 0); assert.equal(f.counts().inspectCalls, 0);
});

test('small images, animated images, directories and duplicate compressed images are rejected', async t => {
  const f = setup(t), files = await f.files();
  await assert.rejects(prepareLocalImages(files.slice(0, 4)), /đúng 5/);
  await assert.rejects(prepareLocalImages([f.dir, ...files.slice(1)]), /file thường/);
  await sharp({create: {width: 499, height: 600, channels: 3, background: '#ffffff'}}).png().toFile(files[4]);
  await assert.rejects(prepareLocalImages(files), /tối thiểu 500/);
  await assert.rejects(prepareLocalImages([files[0], files[0], files[0], files[0], files[0]]), /ảnh trùng/);
  const animated = path.join(f.dir, 'animated.webp');
  await sharp(Buffer.concat([Buffer.alloc(600 * 600 * 3, 40), Buffer.alloc(600 * 600 * 3, 100)]), {raw: {width: 600, height: 1200, channels: 3, pageHeight: 600}}).webp({loop: 0, delay: [100, 100]}).toFile(animated);
  await assert.rejects(prepareLocalImages([animated, ...files.slice(0, 4)]), /tĩnh/);
});

test('changed Notion content after prompt preparation blocks import before assets or Shopee access', async t => {
  const f = setup(t), files = await f.files(), contentDigest = await f.prompt(); f.remote.article.product.name = 'Nhân viên đã đổi tên';
  await assert.rejects(f.studio.importLocalImages(f.job.id, files, contentDigest), error => error.code === 'STUDIO_IMAGE_CONTENT_CHANGED');
  assert.equal(f.job.generatedAssets, undefined); assert.equal(f.counts().inspectCalls, 0); assert.equal(f.remote.article.product.name, 'Nhân viên đã đổi tên');
});

test('edits during hydration are preserved and block committing imported assets', async t => {
  const f = setup(t), files = await f.files(), contentDigest = await f.prompt();
  f.hook(count => {if (count === 3) f.remote.article.product.description = 'Sửa trong khi chuẩn bị nhập ảnh';});
  await assert.rejects(f.studio.importLocalImages(f.job.id, files, contentDigest), error => error.code === 'STUDIO_IMAGE_CONTENT_CHANGED');
  assert.equal(f.job.generatedAssets, undefined); assert.equal(fs.existsSync(path.join(f.studio.dir, 'assets')), false); assert.equal(f.remote.article.product.description, 'Sửa trong khi chuẩn bị nhập ảnh');
});

test('uncertain automatic generation can import manually without touching the existing request journal or resending', async t => {
  const f = setup(t), files = await f.files(); f.job.status = 'images-uncertain'; f.job.conversationUrl = 'https://chatgpt.com/c/previous-request';
  const journal = path.join(f.dir, 'request-journal.json'), previous = JSON.stringify({status: 'uncertain', request: randomUUID()}); fs.writeFileSync(journal, previous);
  const contentDigest = await f.prompt(); await f.studio.importLocalImages(f.job.id, files, contentDigest);
  assert.equal(f.counts().sendCalls, 0); assert.equal(fs.readFileSync(journal, 'utf8'), previous); assert.equal(f.job.conversationUrl, 'https://chatgpt.com/c/previous-request'); assert.equal(f.job.imageSource, 'manual');
});

test('failed Drive save resumes the same manual checkpoint and rejects a different set without overwriting', async t => {
  const f = setup(t), files = await f.files(), contentDigest = await f.prompt(), upload = f.drive.uploadSet.bind(f.drive); let once = true;
  f.drive.uploadSet = async payload => {if (once) {once = false; throw Error('Drive local chưa kết nối');} return upload(payload);};
  await assert.rejects(f.studio.importLocalImages(f.job.id, files, contentDigest), /Drive local/);
  const saved = clone(f.job.generatedAssets), stats = saved.images.map(image => fs.statSync(image.path).mtimeMs);
  const different = await f.files('different', 30);
  await assert.rejects(f.studio.importLocalImages(f.job.id, different, contentDigest), error => error.code === 'STUDIO_LOCAL_IMAGE_EXISTS');
  assert.deepEqual(f.job.generatedAssets, saved); assert.deepEqual(saved.images.map(image => fs.statSync(image.path).mtimeMs), stats);
  await f.studio.importLocalImages(f.job.id, files, contentDigest); assert.equal(f.job.status, 'images-ready');
  await f.studio.importLocalImages(f.job.id, files, contentDigest); assert.deepEqual(f.job.generatedAssets, saved); assert.deepEqual(saved.images.map(image => fs.statSync(image.path).mtimeMs), stats);
  assert.equal(f.counts().sendCalls, 0); assert.equal(fs.readdirSync(f.job.localFolder).filter(name => name.endsWith('.jpg')).length, 5);
});

test('existing automatic or attached remote assets are never replaced by manual import', async t => {
  const f = setup(t), files = await f.files(), contentDigest = await f.prompt();
  const previous = {jobId: f.job.id, images: [{hash: 'a'.repeat(64), path: path.join(f.dir, 'old.jpg')}]}; f.job.sourceAssets = clone(previous);
  await assert.rejects(f.studio.importLocalImages(f.job.id, files, contentDigest), error => error.code === 'STUDIO_LOCAL_IMAGE_EXISTS'); assert.deepEqual(f.job.sourceAssets, previous);
  delete f.job.sourceAssets; f.remote.article.images = ['https://example.com/previous.jpg'];
  await assert.rejects(f.studio.importLocalImages(f.job.id, files, contentDigest), error => error.code === 'STUDIO_LOCAL_IMAGE_EXISTS'); assert.equal(f.job.generatedAssets, undefined);
});

test('tampered app-owned manual checkpoints cannot be overwritten on retry', async t => {
  const f = setup(t), files = await f.files(), contentDigest = await f.prompt(); await f.studio.importLocalImages(f.job.id, files, contentDigest);
  const file = f.job.generatedAssets.images[4].path; fs.appendFileSync(file, 'tampered'); const changed = fs.readFileSync(file);
  await assert.rejects(f.studio.importLocalImages(f.job.id, files, contentDigest), /đã thay đổi/); assert.deepEqual(fs.readFileSync(file), changed);
});

test('the existing image-save action resumes manual assets without submitting a new ChatGPT request', async t => {
  const f = setup(t), files = await f.files(), contentDigest = await f.prompt(), upload = f.drive.uploadSet.bind(f.drive); let once = true;
  f.drive.uploadSet = async payload => {if (once) {once = false; throw Error('Drive unavailable');} return upload(payload);};
  await assert.rejects(f.studio.importLocalImages(f.job.id, files, contentDigest), /Drive unavailable/);
  const saved = clone(f.job.generatedAssets); await f.studio.images(f.job.id);
  assert.equal(f.job.status, 'images-ready'); assert.equal(f.job.imageSource, 'manual'); assert.equal(f.counts().sendCalls, 0); assert.deepEqual(f.job.generatedAssets, saved);
});

test('manual import hydrates a text-only approved article using current Notion content and price', async t => {
  const f = setup(t), files = await f.files();
  f.remote.article.product = {name: 'Tên sửa mới trong Notion', description: 'Mô tả sửa mới trong Notion'}; f.remote.price = 234567;
  const contentDigest = await f.prompt(); await f.studio.importLocalImages(f.job.id, files, contentDigest);
  assert.equal(f.job.article.product.name, 'Tên sửa mới trong Notion'); assert.equal(f.job.article.product.description, 'Mô tả sửa mới trong Notion');
  assert.equal(f.job.article.product.variants[0].price, 234567); assert.equal(f.job.price, 234567); assert.equal(f.job.article.product.fields['Thương hiệu'], 'No brand');
  assert.equal(f.counts().sendCalls, 0); assert.equal(f.job.generatedAssets.images.length, 5);
});

test('source files exceeding the byte limit are rejected before decompression', async t => {
  const f = setup(t), files = await f.files(), handle = fs.openSync(files[4], 'r+');
  try {fs.ftruncateSync(handle, 25 * 1024 * 1024 + 1);} finally {fs.closeSync(handle);}
  await assert.rejects(prepareLocalImages(files), /25 MB/); assert.equal(f.job.generatedAssets, undefined);
});

test('an imported file may not be a symbolic link', async t => {
  const f = setup(t), files = await f.files(), link = path.join(f.dir, 'linked-image.png');
  try {fs.symlinkSync(files[4], link, 'file');} catch (error) {if (error.code === 'EPERM') {t.skip('Windows account has no symlink privilege'); return;} throw error;}
  await assert.rejects(prepareLocalImages([...files.slice(0, 4), link]), /liên kết ngoài/);
});

test('updateImagePrompt and resetImagePrompt modify and restore custom prompts per slot', async t => {
  const f = setup(t);
  const initial = await f.studio.manualPrompts(f.job.id);
  assert.equal(initial.prompts.length, 5);

  // Update prompt for slot 2 (Prompt 3)
  const updated = await f.studio.updateImagePrompt(f.job.id, 2, 'Prompt tùy chỉnh cho ảnh 3');
  assert.equal(updated.ok, true);
  assert.equal(f.job.customPrompts[2], 'Prompt tùy chỉnh cho ảnh 3');

  // Verify manualPrompts returns the custom prompt for slot 2
  const afterUpdate = await f.studio.manualPrompts(f.job.id);
  assert.equal(afterUpdate.prompts[2].text, 'Prompt tùy chỉnh cho ảnh 3');
  assert.equal(afterUpdate.prompts[0].text, initial.prompts[0].text);

  // Reset slot 2 back to default
  const resetRes = await f.studio.resetImagePrompt(f.job.id, 2);
  assert.equal(resetRes.ok, true);
  assert.equal(resetRes.prompts[2].text, initial.prompts[2].text);

  const afterReset = await f.studio.manualPrompts(f.job.id);
  assert.equal(afterReset.prompts[2].text, initial.prompts[2].text);
});

