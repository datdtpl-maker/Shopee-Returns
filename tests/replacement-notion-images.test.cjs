const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {createHash} = require('node:crypto');
const sharp = require('sharp');
const {uploadImage, resolveImages, attachImages} = require('../src/replacement-notion-images.cjs');
const id = '0123456789abcdef0123456789abcdef', page = 'https://www.notion.so/' + id;
async function assetFixture(t, count = 1) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srm-notion-image-')); t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const images = [];
  for (let index = 0; index < count; index++) {
    const buffer = await sharp({create: {width: 500, height: 500, channels: 3, background: index ? '#eeeeee' : '#ffffff'}}).jpeg().toBuffer();
    const filename = index + '.jpg', file = path.join(dir, filename); fs.writeFileSync(file, buffer);
    images.push({path: file, filename, hash: createHash('sha256').update(buffer).digest('hex'), bytes: buffer.length, width: 500, height: 500});
  }
  return {images};
}
test('image upload validates the JPEG/hash and sends credentials only to the exact official upload endpoint', async t => {
  const {images: [asset]} = await assetFixture(t); let calls = 0;
  const i = {secrets: () => ({notionToken: 'fixture-token'}), notion: async () => ({id: 'upload', upload_url: 'https://api.notion.com/v1/file_uploads/upload/send'}), request: async (url, opt) => {
    calls++; assert.equal(opt.headers.Authorization, 'Bearer fixture-token'); assert.equal(opt.redirect, 'error'); assert.ok(opt.body instanceof FormData); return {id: 'upload', status: 'uploaded'};
  }};
  assert.equal((await uploadImage(i, asset)).image.file_upload.id, 'upload'); assert.equal(calls, 1);
  for (const endpoint of ['https://evil.example/upload', 'https://api.notion.com/v1/file_uploads/other/send', 'https://api.notion.com:444/v1/file_uploads/upload/send', 'https://user:pass@api.notion.com/v1/file_uploads/upload/send', 'https://api.notion.com/v1/file_uploads/upload/send?elsewhere=true']) {
    i.notion = async () => ({id: 'upload', upload_url: endpoint}); await assert.rejects(uploadImage(i, asset));
  }
  assert.equal(calls, 1); fs.appendFileSync(asset.path, 'changed'); await assert.rejects(uploadImage(i, asset), /đã thay đổi/);
  fs.writeFileSync(asset.path, Buffer.from([255, 216, 255, 1])); delete asset.hash; await assert.rejects(uploadImage(i, asset), /không đọc/);
});
test('stable Notion block links resolve fresh URLs and verify the page ancestry before using the image', async () => {
  const source = page + '#' + id; let reads = 0;
  const i = {notion: async endpoint => {reads++; assert.equal(endpoint, 'blocks/' + id); return {type: 'image', parent: {type: 'page_id', page_id: id}, image: {file: {url: 'https://secure.notion-static.com/current.jpg'}}};}};
  assert.deepEqual(await resolveImages(i, [source, 'https://drive.google.com/file/d/abcdefghijk/view']), ['https://secure.notion-static.com/current.jpg', 'https://drive.google.com/file/d/abcdefghijk/view']); assert.equal(reads, 1);
  await assert.rejects(resolveImages(i, [page]), /ID khối/); i.notion = async () => ({type: 'image', archived: true}); await assert.rejects(resolveImages(i, [source]), /không còn/);
  i.notion = async () => ({type: 'image', parent: {type: 'page_id', page_id: '11111111111111111111111111111111'}, image: {file: {url: 'https://secure.notion-static.com/other.jpg'}}});
  await assert.rejects(resolveImages(i, [source]), /không thuộc/);
  await assert.rejects(resolveImages(i, ['http://example.com/image.jpg']), /HTTPS/);
});
function fakeNotion() {
  const blocks = []; let uploads = 0, appends = 0;
  const i = {secrets: () => ({notionToken: 'fixture-token'}), notion: async (endpoint, method = 'GET', body) => {
    if (endpoint === 'file_uploads') {const uploadId = 'upload-' + (++uploads); return {id: uploadId, upload_url: 'https://api.notion.com/v1/file_uploads/' + uploadId + '/send'};}
    if (endpoint === 'blocks/' + id + '/children?page_size=100') return {results: structuredClone(blocks), has_more: false};
    if (endpoint === 'blocks/' + id + '/children' && method === 'PATCH') {
      appends++; const results = body.children.map((block, index) => ({...block, id: String(blocks.length + 1 + index).padStart(32, '0'), parent: {type: 'page_id', page_id: id}}));
      blocks.push(...results); return {results: structuredClone(results)};
    }
    throw Error('Unexpected endpoint: ' + endpoint);
  }, request: async url => ({id: new URL(url).pathname.split('/')[3], status: 'uploaded'})};
  return {i, blocks, uploads: () => uploads, appends: () => appends};
}
test('publisher reuses paginated existing image markers instead of uploading or attaching duplicate images', async t => {
  const assets = await assetFixture(t), {i, blocks, uploads, appends} = fakeNotion();
  const first = await attachImages(i, page, assets); assert.match(first[0], /#[a-f\d]{32}$/); assert.equal(uploads(), 1); assert.equal(appends(), 1);
  const base = i.notion; i.notion = async (endpoint, method, body) => {
    if (endpoint.endsWith('/children?page_size=100')) return {results: [{id: 'unrelated', type: 'paragraph'}], has_more: true, next_cursor: 'next page'};
    if (endpoint.endsWith('&start_cursor=next%20page')) return {results: structuredClone(blocks), has_more: false};
    return base(endpoint, method, body);
  };
  assert.deepEqual(await attachImages(i, page, assets), first); assert.equal(uploads(), 1); assert.equal(appends(), 1);
  blocks.push({...structuredClone(blocks[0]), id: '11111111111111111111111111111111'});
  await assert.rejects(attachImages(i, page, assets), /trùng/); assert.equal(uploads(), 1);
});
test('successful append with lost response is reconciled from image markers and never appended twice', async t => {
  const assets = await assetFixture(t, 2), {i, uploads, appends} = fakeNotion(), base = i.notion;
  i.notion = async (endpoint, method, body) => {
    const value = await base(endpoint, method, body); if (method === 'PATCH') throw Error('Timeout after append'); return value;
  };
  const links = await attachImages(i, page, assets); assert.equal(links.length, 2); assert.equal(uploads(), 2); assert.equal(appends(), 1);
  assert.deepEqual(await attachImages(i, page, assets), links); assert.equal(uploads(), 2); assert.equal(appends(), 1);
});
test('partial append resumes only missing images, preserving already attached compressed files', async t => {
  const assets = await assetFixture(t, 2), {i, blocks, uploads, appends} = fakeNotion(), base = i.notion; let partial = true;
  i.notion = async (endpoint, method, body) => {
    if (method === 'PATCH' && partial) {partial = false; await base(endpoint, method, {children: [body.children[0]]}); throw Error('Partial append timeout');}
    return base(endpoint, method, body);
  };
  await assert.rejects(attachImages(i, page, assets), error => error.code === 'NOTION_IMAGE_ATTACH_UNCERTAIN'); assert.equal(blocks.length, 1);
  const links = await attachImages(i, page, assets); assert.equal(links.length, 2); assert.equal(blocks.length, 2); assert.equal(uploads(), 3); assert.equal(appends(), 2);
});

test('reconciliation after an ambiguous append never uploads missing images or repeats the append', async t => {
  const assets = await assetFixture(t), {i, uploads, appends} = fakeNotion(); let journals = 0;
  await assert.rejects(attachImages(i, page, assets, {reconcileOnly: true}), error => error.code === 'NOTION_IMAGE_ATTACH_UNCERTAIN'); assert.equal(uploads(), 0); assert.equal(appends(), 0);
  const links = await attachImages(i, page, assets, {beforeAppend: () => {journals++;}}); assert.equal(journals, 1);
  assert.deepEqual(await attachImages(i, page, assets, {reconcileOnly: true}), links); assert.equal(uploads(), 1); assert.equal(appends(), 1);
});
