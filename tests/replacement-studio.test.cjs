const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {randomUUID, createHash} = require('node:crypto');
const {ReplacementStudio, PARENT_ID, TABLE_NAME, SCHEMA} = require('../src/replacement-studio.cjs');
const {ReplacementManager, LINK_COLUMN} = require('../src/replacements.cjs');
const {Products} = require('../src/products.cjs');

const SOURCE = {id: 'source-one', shop: 'shop.one', name: 'Sản phẩm thật', productId: '111', modelId: '222', variant: '', price: 100000, stock: 20, profileId: 'profile-one', notionPageId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'};
const BASELINE = {shop: SOURCE.shop, productId: SOURCE.productId, name: SOURCE.name, description: 'Mô tả nhãn thật', category: 'Ngành đã chọn',
  hasVariants: false, images: ['https://down-vn.img.susercontent.com/source-image'], variants: [{modelId: SOURCE.modelId, name: '', price: SOURCE.price, stock: SOURCE.stock}],
  fields: [{label: 'Thương hiệu', kind: 'select', value: 'No brand', required: true}, {label: 'Ngày hết hạn', kind: 'date', value: '31/12/2026', required: true}, {label: 'Giá', kind: 'number', value: SOURCE.price}, {label: 'Kho hàng', kind: 'number', value: SOURCE.stock}]};
const clone = value => structuredClone(value);
const rich = text => [{type: 'text', text: {content: text}}];
const plain = value => value.map(item => item.text.content).join('');
const uuid = () => randomUUID().replace(/-/g, '');
function sourcePage(row) {return {id: row.notionPageId, properties: {
  'Tên shop': {rich_text: rich(row.shop)}, 'Tên sản phẩm': {title: rich(row.name)}, 'ID sản phẩm': {rich_text: rich(row.productId)}, 'Model ID': {rich_text: rich(row.modelId)},
  'Phân loại': {rich_text: rich(row.variant)}, 'Giá bán': {number: row.price}, 'Kho hàng': {number: row.stock}, [LINK_COLUMN]: {url: null},
}};}
function assets(jobId) {return {jobId, images: Array.from({length: 5}, (_, index) => ({path: path.join(os.tmpdir(), 'studio-image-' + index + '.jpg'), filename: index + '.jpg', hash: createHash('sha256').update('image' + index).digest('hex'), bytes: 10000, width: 1024, height: 1024}))};}
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srm-studio-')); t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const databaseId = uuid(), pages = new Map([[SOURCE.notionPageId, sourcePage(SOURCE)]]), blocks = new Map([[PARENT_ID, []]]), calls = [];
  let database, geminiCalls = 0, generationCalls = 0, driveCalls = 0, attachCalls = 0, inspectCalls = 0, applyCalls = 0, uploadHook;
  const normalize = id => id.replace(/-/g, ''), properties = () => Object.fromEntries(Object.entries(SCHEMA).map(([name, value]) => [name, {...clone(value), type: Object.keys(value)[0]}]));
  const products = {data: {rows: [clone(SOURCE)], shops: {[SOURCE.profileId]: {name: SOURCE.shop}}}, parse: Products.prototype.parse, save() {}};
  const i = {listPages: async id => [...pages.values()].filter(page => page.parent?.database_id === id).map(clone), notion: async (endpoint, method = 'GET', body) => {
    calls.push({endpoint, method, body: clone(body)});
    if (endpoint === 'databases' && method === 'POST') {
      database = {id: databaseId, parent: {page_id: PARENT_ID}, properties: properties()};
      blocks.get(PARENT_ID).push({id: databaseId, type: 'child_database', child_database: {title: TABLE_NAME}}); return clone(database);
    }
    if (endpoint === 'databases/' + databaseId && method === 'GET') return clone(database);
    if (endpoint === 'databases/' + databaseId && method === 'PATCH') {Object.assign(database.properties, body.properties); return clone(database);}
    if (endpoint === 'pages' && method === 'POST') {
      const id = uuid(), children = body.children.map(block => ({...clone(block), id: uuid(), parent: {type: 'page_id', page_id: id}}));
      const page = {id, url: 'https://app.notion.com/p/' + id, parent: body.parent, properties: clone(body.properties)};
      pages.set(id, page); blocks.set(id, children); return clone(page);
    }
    if (endpoint.startsWith('pages/')) {
      const id = normalize(endpoint.slice(6)), page = pages.get(id); if (!page) throw Error('Unknown page ' + id);
      if (method === 'PATCH') Object.assign(page.properties, clone(body.properties)); return clone(page);
    }
    const child = /^blocks\/([^/]+)\/children/.exec(endpoint);
    if (child) {
      const children = blocks.get(normalize(child[1])); if (!children) throw Error('Unknown children ' + child[1]);
      if (method === 'PATCH') {const added = body.children.map(block => ({...clone(block), id: uuid(), parent: {type: 'page_id', page_id: normalize(child[1])}})); children.push(...added); return {results: clone(added)};}
      return {results: clone(children), has_more: false};
    }
    if (endpoint.startsWith('blocks/') && method === 'PATCH') {
      const id = normalize(endpoint.slice(7)), block = [...blocks.values()].flat().find(item => item.id === id); if (!block) throw Error('Unknown block ' + id);
      Object.assign(block, clone(body)); return clone(block);
    }
    throw Error('Unexpected endpoint ' + method + ' ' + endpoint);
  }};
  const baseline = clone(BASELINE), editor = {inspect: async () => {inspectCalls++; return clone(baseline);}, validate: (schema, product) => {
    assert.equal(schema.category, product.category); assert.equal(product.variants.length, schema.variants.length);
    for (const field of schema.fields.filter(field => field.required)) assert.equal(product.fields[field.label], field.value);
    for (const model of schema.variants) assert.ok(product.variants.some(candidate => candidate.modelId === model.modelId));
  }, apply: async (target, template, assets) => {
    applyCalls++; return {changed: true, productId: target.productId, name: template.product.name, schema: clone(baseline), images: []};
  }};
  const replacements = {data: {links: {}}, products, i, editor, linkSourceRow: ReplacementManager.prototype.linkSourceRow, resolve(id) {const row = products.data.rows.find(item => item.id === id); if (!row) throw Error('Không tìm thấy dòng'); return row;},
    target: ReplacementManager.prototype.target, makeTemplate: ReplacementManager.prototype.makeTemplate, ensureColumn: async () => {}, save() {},
    publisher: {attachImages: async (_, url, set, options) => {
      attachCalls++; const id = url.split('/').at(-1), existing = blocks.get(id).filter(block => block.type === 'image');
      if (existing.length === 5) return existing.map(block => 'https://www.notion.so/' + id + '#' + block.id);
      if (options.reconcileOnly) throw Error('Lượt gắn ảnh chưa xác minh');
      options.beforeAppend(); if (uploadHook) await uploadHook(url);
      const children = set.images.map((_, index) => ({id: uuid(), type: 'image', image: {caption: rich('image' + index)}})); blocks.get(id).push(...children);
      return children.map(block => 'https://www.notion.so/' + id + '#' + block.id);
    }},
  };
  const gemini = {generate: async payload => {geminiCalls++; assert.deepEqual(payload.source, {name: baseline.name}); assert.ok(payload.requestedName); return {name: payload.requestedName || 'Tên theo insight', description: 'Nội dung bám nhãn và prompt đã duyệt.'};}};
  const chatgpt = {generate: async payload => {
    generationCalls++; assert.deepEqual(payload.sourceImages, baseline.images); const images = [];
    for (let index = 0; index < 5; index++) {
      const buffer = await require('sharp')({create: {width: 512, height: 512, channels: 3, background: {r: 40 * index, g: 20 * index, b: 30 * index}}}).png().toBuffer(), file = path.join(dir, 'source-' + payload.jobId + '-' + index + '.png'); fs.writeFileSync(file, buffer);
      images.push({path: file, filename: path.basename(file), hash: createHash('sha256').update(buffer).digest('hex')});
    }
    return {jobId: payload.jobId, images, conversationUrl: 'https://chatgpt.com/c/conversation'};
  }};
  const drive = {
    uploadSet: async payload => {driveCalls++; return {...clone(payload.assets), verified: true, folderUrl: 'https://drive.google.com/drive/u/2/folders/root-folder', relativeDir: 'shop.one/product/insight', localFolder: 'G:\\My Drive\\Hình ảnh Shopee\\Sản phẩm thay thế\\shop.one\\product\\insight'};},
    uploadOne: async payload => {driveCalls++; return {jobId: payload.jobId, verified: true, folderUrl: 'https://drive.google.com/drive/u/2/folders/root-folder', relativeDir: 'shop.one/product/insight', localFolder: 'G:\\My Drive\\Hình ảnh Shopee\\Sản phẩm thay thế\\shop.one\\product\\insight', image: {...clone(payload.image), filename: String(payload.index + 1) + '.png', ordinal: payload.index + 1, index: payload.index}};}
  };
  const dependencies = {products, replacements, integrations: i, gemini, chatgpt, drive}, studio = new ReplacementStudio(dir, dependencies);
  const article = job => JSON.parse(plain(blocks.get(job.notionUrl.split('/').at(-1)).find(block => block.type === 'code').code.rich_text));
  const changeArticle = (job, change) => {const code = blocks.get(job.notionUrl.split('/').at(-1)).find(block => block.type === 'code'), next = JSON.parse(plain(code.code.rich_text)); change(next); code.code.rich_text = rich(JSON.stringify(next));};
  return {dir, studio, dependencies, products, replacements, i, gemini, chatgpt, drive, pages, blocks, calls, baseline, article, changeArticle,
    counts: () => ({geminiCalls, generationCalls, driveCalls, attachCalls, inspectCalls, applyCalls}), uploadHook: fn => {uploadHook = fn;}};
}
async function written(f, rowId = SOURCE.id) {
  const job = f.studio.create({rowIds: [rowId]})[0];
  f.studio.update(job.id, {prompt: 'Viết theo nhãn thật, không thêm thành phần mới.', name: 'Tên nhân viên yêu cầu', price: 120000}); await f.studio.generate(job.id); return f.studio.get(job.id);
}
async function approved(f, rowId = SOURCE.id) {const job = await written(f, rowId); f.studio.approve(job.id); return job;}

test('delete draft hides only the selected unsent job, persists across restart and keeps history', t => {
  const f = setup(t), first = f.studio.create({rowIds: [SOURCE.id]})[0];
  f.studio.update(first.id, {prompt: 'Prompt cần xoá', name: 'Bản nháp cần xoá', description: 'Nội dung nháp'});
  const other = {...clone(SOURCE), id: 'source-two', productId: '333', modelId: '444'};
  f.products.data.rows.push(other); const kept = f.studio.create({rowIds: [other.id]})[0];
  const logCount = f.studio.data.logs.length, calls = f.calls.length;
  assert.equal(f.studio.snapshot().jobs.find(job => job.id === first.id).canDeleteDraft, true);
  f.studio.deleteDraft(first.id);
  assert.deepEqual(f.studio.snapshot().jobs.map(job => job.id), [kept.id]);
  assert.throws(() => f.studio.get(first.id), /Không tìm thấy/);
  assert.ok(f.studio.data.jobs.find(job => job.id === first.id).deletedAt);
  assert.ok(f.studio.data.logs.length > logCount); assert.equal(f.calls.length, calls);
  const restarted = new ReplacementStudio(f.dir, f.dependencies);
  assert.deepEqual(restarted.snapshot().jobs.map(job => job.id), [kept.id]);
  assert.notEqual(restarted.create({rowIds: [SOURCE.id]})[0].id, first.id);
});

test('delete draft refuses publishing, generating and busy jobs without side effects', t => {
  const f = setup(t), id = f.studio.create({rowIds: [SOURCE.id]})[0].id, job = f.studio.get(id), initial = clone(job);
  for (const patch of [{status: 'publishing'}, {status: 'generating'}]) {
    for (const field of Object.keys(job)) delete job[field]; Object.assign(job, clone(initial), patch);
    assert.equal(f.studio.publicJob(job).canDeleteDraft, false);
    assert.throws(() => f.studio.deleteDraft(id), /đang bận xử lý/);
    assert.equal(job.deletedAt, undefined);
  }
  for (const field of Object.keys(job)) delete job[field]; Object.assign(job, clone(initial));
  f.studio.busy = true; assert.throws(() => f.studio.deleteDraft(id), /Đang xử lý/); f.studio.busy = false;
  assert.equal(f.studio.get(id).deletedAt, undefined); assert.equal(f.calls.length, 0);
});
async function published(f, rowId = SOURCE.id) {const job = await written(f, rowId); await f.studio.publish(job.id); return job;}

test('one draft per distinct shop and product; reselecting preserves edits and duplicate model rows do not duplicate jobs', t => {
  const f = setup(t); f.products.data.rows.push({...clone(SOURCE), id: 'second-model', modelId: '333'});
  const jobs = f.studio.create({rowIds: [SOURCE.id, 'second-model', SOURCE.id]}); assert.equal(jobs.length, 1);
  f.studio.update(jobs[0].id, {prompt: 'Bản nháp nhân viên đang chỉnh', price: 333333, name: 'Tên bản nháp đang sửa'});
  const before = clone(f.studio.get(jobs[0].id));
  assert.equal(f.studio.create({rowIds: [SOURCE.id], insights: 20})[0].id, jobs[0].id); assert.equal(f.studio.data.jobs.length, 1); assert.deepEqual(f.studio.get(jobs[0].id), before);
  f.products.data.rows.push({...clone(SOURCE), id: 'second-shop', shop: 'shop.two'});
  f.studio.create({rowIds: ['second-shop']}); assert.equal(f.studio.data.jobs.length, 2);
  assert.throws(() => f.studio.create({rowIds: []}), /sản phẩm nguồn/);
  assert.throws(() => f.studio.update(jobs[0].id, {insight: 'Sinh thêm insight'}), /không hợp lệ/);
  assert.equal(f.studio.get(jobs[0].id).insight, SOURCE.name);
});

test('legacy insight jobs remain intact after restart and selecting a product reuses the existing active article', t => {
  const f = setup(t), first = f.studio.create({rowIds: [SOURCE.id]})[0], original = f.studio.get(first.id);
  original.insight = 'Insight 1'; original.prompt = 'Prompt cũ không sửa'; original.imageContentDigest = 'a'.repeat(64);
  const second = {...clone(original), id: randomUUID(), index: 2, insight: 'Insight 2', notionUrl: 'https://app.notion.com/p/' + uuid(), prompt: 'Bản nháp cũ 2'};
  const third = {...clone(original), id: randomUUID(), index: 3, insight: 'Insight 3', notionUrl: 'https://app.notion.com/p/' + uuid(), prompt: 'Bài cũ 3'};
  f.studio.data.jobs.push(second, third); f.products.data.rows[0].replacementUrl = third.notionUrl; f.studio.save();
  const before = clone(f.studio.data.jobs), restarted = new ReplacementStudio(f.dir, f.dependencies);
  assert.equal(restarted.create({rowIds: [SOURCE.id]})[0].id, third.id); assert.deepEqual(restarted.data.jobs, before); assert.equal(restarted.data.jobs.length, 3);
  delete f.products.data.rows[0].replacementUrl; assert.equal(restarted.create({rowIds: [SOURCE.id]})[0].id, first.id); assert.deepEqual(restarted.data.jobs, before);
});

test('loading historical articles for the same source keeps all old jobs and selecting never creates another', async t => {
  const f = setup(t), first = await published(f), pageId = first.notionUrl.split('/').at(-1), page = f.pages.get(pageId), code = f.blocks.get(pageId);
  first.insight = 'Insight 1'; page.properties['Insight'].rich_text = rich(first.insight);
  const oldIds = [first.id];
  for (let index = 2; index <= 3; index++) {
    const legacyId = randomUUID(), remoteId = uuid(), legacy = clone(page); legacy.id = remoteId; legacy.url = 'https://app.notion.com/p/' + remoteId; legacy.properties['Mã tác vụ'].rich_text = rich(legacyId); legacy.properties['Insight'].rich_text = rich('Insight ' + index);
    f.pages.set(remoteId, legacy); f.blocks.set(remoteId, code.map(block => ({...clone(block), id: uuid(), parent: {type: 'page_id', page_id: remoteId}}))); oldIds.push(legacyId);
  }
  await f.studio.load(); assert.equal(f.studio.data.jobs.length, 3); assert.deepEqual(f.studio.data.jobs.map(job => job.id).sort(), oldIds.sort());
  const before = clone(f.studio.data.jobs), writes = f.calls.filter(call => call.method !== 'GET').length;
  assert.equal(f.studio.create({rowIds: [SOURCE.id]})[0].id, first.id); assert.deepEqual(f.studio.data.jobs, before); assert.equal(f.calls.filter(call => call.method !== 'GET').length, writes);
});

test('Gemini API writing uses requested title and prompt without opening Shopee; explicit publish confirms employee edits', async t => {
  const f = setup(t), job = f.studio.create({rowIds: [SOURCE.id], insights: 1})[0];
  f.replacements.editor.inspect = async () => {throw Error('Shopee must not open for writing or publishing');};
  f.replacements.editor.validate = () => {throw Error('Shopee schema must not be required for writing or publishing');};
  assert.throws(() => f.studio.approve(job.id), /viết bài/); await assert.rejects(f.studio.publish(job.id), /chưa hoàn chỉnh/);
  await assert.rejects(f.studio.generate(job.id), /Prompt/);
  f.studio.update(job.id, {prompt: 'Prompt nhân viên', price: 123456}); await assert.rejects(f.studio.generate(job.id), /Tên sản phẩm mới/);
  f.studio.update(job.id, {name: 'Tên nhân viên yêu cầu'}); await f.studio.generate(job.id);
  const generated = f.studio.get(job.id); assert.deepEqual(generated.article.images, []); assert.equal(generated.article.product.variants, undefined); assert.equal(generated.baseline, undefined); assert.equal(generated.contentApproved, false);
  f.studio.update(job.id, {name: 'Nhân viên sửa tên', description: 'Nội dung nhân viên sửa trước khi gửi.', price: 234567});
  await f.studio.publish(job.id); assert.equal(generated.contentApproved, true); assert.equal(generated.article.approved, true); assert.equal(generated.status, 'published');
  assert.equal(f.article(generated).product.name, 'Nhân viên sửa tên'); assert.equal(f.article(generated).product.description, 'Nội dung nhân viên sửa trước khi gửi.');
  assert.equal(f.pages.get(generated.notionUrl.split('/').at(-1)).properties['Giá bán'].number, 234567); assert.equal(f.counts().generationCalls, 0); assert.equal(f.counts().inspectCalls, 0);
});

test('changing prompt resets written content and does not submit a Notion page', async t => {
  const f = setup(t), job = await approved(f); f.studio.update(job.id, {prompt: 'Prompt mới'});
  assert.equal(job.status, 'draft'); assert.equal(job.article, undefined); assert.equal(job.baseline, undefined);
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 0);
});

test('step 2 hydrates required Shopee fields and variants while retaining edited text and Notion price', async t => {
  const f = setup(t), job = await published(f);
  assert.equal(f.counts().inspectCalls, 0); assert.equal(job.baseline, undefined); assert.equal(f.article(job).product.category, undefined);
  f.changeArticle(job, article => {article.product.name = 'Tên nhân viên sửa ở Notion'; article.product.description = 'Mô tả nhân viên sửa ở Notion';});
  f.pages.get(job.notionUrl.split('/').at(-1)).properties['Giá bán'].number = 234567;
  await assert.rejects(f.studio.activate(job.id), /Cần đủ bài/);
  await f.studio.images(job.id); const full = f.article(job);
  assert.equal(f.counts().inspectCalls, 1); assert.equal(full.product.name, 'Tên nhân viên sửa ở Notion'); assert.equal(full.product.description, 'Mô tả nhân viên sửa ở Notion');
  assert.equal(full.product.category, BASELINE.category); assert.equal(full.product.fields['Ngày hết hạn'], '31/12/2026'); assert.equal(full.product.fields['Thương hiệu'], 'No brand');
  assert.deepEqual(full.product.variants, [{modelId: SOURCE.modelId, name: '', price: 234567, stock: SOURCE.stock}]); assert.equal(full.product.fields['Giá'], 234567); assert.equal(full.product.fields['Kho hàng'], SOURCE.stock); assert.equal(job.price, 234567);
  await f.studio.attach(job.id); assert.deepEqual(await f.studio.activate(job.id), {rowId: SOURCE.id, url: job.notionUrl});
});

test('missing live Shopee schema blocks image generation without changing the text-only Notion article', async t => {
  const f = setup(t), job = await published(f), before = f.article(job), writes = f.calls.filter(call => call.method !== 'GET').length;
  f.replacements.editor.inspect = async () => {throw Error('Đăng nhập Shopee trước khi tạo ảnh');};
  await assert.rejects(f.studio.images(job.id), /Đăng nhập/); assert.equal(f.counts().generationCalls, 0); assert.deepEqual(f.article(job), before); assert.equal(f.calls.filter(call => call.method !== 'GET').length, writes);
});

test('employee edits while opening Shopee block schema hydration without overwriting the Notion article', async t => {
  const f = setup(t), job = await published(f), inspect = f.replacements.editor.inspect, writes = f.calls.filter(call => call.method !== 'GET').length;
  f.replacements.editor.inspect = async target => {f.changeArticle(job, article => {article.product.description = 'Nhân viên sửa trong lúc mở form';}); return inspect(target);};
  await assert.rejects(f.studio.images(job.id), /đã được sửa khi đọc form/); assert.equal(f.counts().generationCalls, 0); assert.equal(f.calls.filter(call => call.method !== 'GET').length, writes); assert.equal(f.article(job).product.description, 'Nhân viên sửa trong lúc mở form'); assert.equal(f.article(job).product.category, undefined);
  await f.studio.images(job.id); assert.equal(f.article(job).product.description, 'Nhân viên sửa trong lúc mở form'); assert.equal(f.counts().generationCalls, 1);
});

test('schema hydration response timeout recovers the existing JSON block without overwriting later employee edits', async t => {
  const f = setup(t), job = await published(f), notion = f.i.notion; let once = true;
  f.i.notion = async (...args) => {const result = await notion(...args); if (args[0].startsWith('blocks/') && args[1] === 'PATCH' && args[2]?.code && once) {once = false; throw Error('schema patch response timeout');} return result;};
  await assert.rejects(f.studio.images(job.id), /timeout/); assert.equal(f.counts().generationCalls, 0); assert.equal(f.article(job).product.category, BASELINE.category);
  f.changeArticle(job, article => {article.product.description = 'Nhân viên sửa sau khi schema đã lên Notion';});
  await f.studio.images(job.id); assert.equal(f.counts().generationCalls, 1); assert.equal(f.article(job).product.description, 'Nhân viên sửa sau khi schema đã lên Notion'); assert.equal(f.calls.filter(call => call.endpoint.startsWith('blocks/') && call.method === 'PATCH' && call.body?.code).length, 1);
});

test('legacy full-schema jobs still publish without a browser and retain protected attributes', async t => {
  const f = setup(t), id = f.studio.create({rowIds: [SOURCE.id]})[0].id, job = f.studio.get(id);
  job.baseline = clone(BASELINE); job.article = f.replacements.makeTemplate(SOURCE, BASELINE); job.article.images = []; delete job.article.imageFolder;
  Object.assign(job, {name: 'Tên bài cũ', description: 'Nội dung bài cũ', status: 'generated'}); f.studio.applyContent(job);
  f.replacements.editor.inspect = async () => {throw Error('Không mở Shopee khi đẩy bài cũ');};
  await f.studio.publish(id); assert.equal(f.article(job).product.fields['Thương hiệu'], 'No brand'); assert.equal(job.contentApproved, true); assert.equal(f.counts().inspectCalls, 0);
});

test('draft publication creates separate table once and one image-free article, retaining remote edits on retry', async t => {
  const f = setup(t), job = await published(f);
  assert.equal(f.calls.filter(call => call.endpoint === 'databases' && call.method === 'POST').length, 1);
  assert.equal(f.calls.find(call => call.endpoint === 'databases' && call.method === 'POST').body.parent.page_id, PARENT_ID);
  assert.deepEqual(f.article(job).images, []); assert.equal(f.blocks.get(job.notionUrl.split('/').at(-1)).filter(block => block.type === 'image').length, 0);
  assert.equal(f.pages.get(SOURCE.notionPageId).properties[LINK_COLUMN].url, null);
  f.changeArticle(job, article => {article.product.description = 'Nhân viên đã sửa mô tả trực tiếp Notion.';});
  await f.studio.publish(job.id); assert.equal(job.article.product.description, 'Nhân viên đã sửa mô tả trực tiếp Notion.');
  assert.equal(f.calls.filter(call => call.endpoint === 'pages' && call.method === 'POST').length, 1);
  const updated = f.studio.update(job.id, {name: 'Đã cho phép sửa'}); assert.equal(updated.name, 'Đã cho phép sửa');
});

test('timed-out explicit publication recovers by unique job ID without separate approval or duplicate pages', async t => {
  const f = setup(t), job = await written(f), notion = f.i.notion;
  let once = true; f.i.notion = async (...args) => {const result = await notion(...args); if (args[0] === 'pages' && args[1] === 'POST' && once) {once = false; throw Error('response timeout');} return result;};
  await assert.rejects(f.studio.publish(job.id), /timeout/); assert.equal(job.status, 'publish-uncertain');
  const restarted = new ReplacementStudio(f.dir, f.dependencies); await restarted.publish(job.id);
  assert.equal(restarted.get(job.id).status, 'published'); assert.equal(f.calls.filter(call => call.endpoint === 'pages' && call.method === 'POST').length, 1);
});

test('unknown publication outcome without remote proof never replays create', async t => {
  const f = setup(t), job = await approved(f), notion = f.i.notion; let attempts = 0;
  f.i.notion = async (...args) => {if (args[0] === 'pages' && args[1] === 'POST') {attempts++; throw Error('network timeout');} return notion(...args);};
  await assert.rejects(f.studio.publish(job.id), /timeout/); await assert.rejects(f.studio.publish(job.id), /không tự tạo bài thứ hai/); assert.equal(attempts, 1);
});

test('failed local Drive save retries saved generation checkpoint without submitting ChatGPT twice', async t => {
  const f = setup(t), job = await published(f), upload = f.drive.uploadSet; let once = true;
  f.drive.uploadSet = async payload => {if (once) {once = false; throw Error('Drive local chưa kết nối');} return upload(payload);};
  await assert.rejects(f.studio.images(job.id), /Drive local/); assert.equal(job.generatedAssets.images.length, 5);
  await f.studio.images(job.id); assert.equal(f.counts().generationCalls, 1); assert.equal(job.status, 'images-ready');
  for (const image of job.generatedAssets.images) {assert.ok(image.bytes < 1900000); assert.equal((await require('sharp')(image.path).metadata()).format, 'jpeg');}
  assert.equal(f.studio.snapshot().jobs[0].imageFiles[0].path, undefined); assert.match(f.studio.snapshot().jobs[0].localFolder, /^G:/);
});

test('partial, cross-task or duplicate images are rejected and uncertain image generation is not replayed', async t => {
  const f = setup(t), job = await published(f); let attempts = 0;
  f.chatgpt.generate = async payload => {attempts++; return {...assets(payload.jobId), images: assets(payload.jobId).images.slice(0, 4)};};
  await assert.rejects(f.studio.images(job.id), /đủ 5 ảnh/); assert.equal(job.status, 'images-uncertain');
  const restarted = new ReplacementStudio(f.dir, f.dependencies); await assert.rejects(restarted.images(job.id), /không tự gửi lại/); assert.equal(attempts, 1);
  const g = setup(t), other = await published(g); g.chatgpt.generate = async () => assets('wrong-job');
  await assert.rejects(g.studio.images(other.id), /không thuộc tác vụ/);
  const bad = assets(job.id); bad.images[1].hash = bad.images[0].hash; assert.throws(() => f.studio.checkFive(bad), /5 ảnh khác nhau/);
});

test('attachments are idempotent, use employee content edits made before generation and activate exact source only', async t => {
  const f = setup(t), job = await published(f);
  f.changeArticle(job, article => {article.product.description = 'Nhân viên đã sửa trước khi tạo ảnh, cần giữ nguyên.';});
  await f.studio.images(job.id);
  await f.studio.attach(job.id); assert.equal(job.imagesReady, true); assert.equal(f.article(job).product.description, 'Nhân viên đã sửa trước khi tạo ảnh, cần giữ nguyên.');
  assert.equal(f.article(job).images.length, 5); assert.equal(f.pages.get(SOURCE.notionPageId).properties[LINK_COLUMN].url, job.notionUrl);
  await f.studio.attach(job.id); assert.equal(f.counts().attachCalls, 1);
  const blocks = f.blocks.get(job.notionUrl.split('/').at(-1)); assert.equal(blocks.filter(block => block.type === 'image').length, 5);
  assert.equal(blocks.filter(block => block.type === 'paragraph' && plain(block.paragraph.rich_text).includes('SRM_LOCAL_DRIVE:')).length, 1);
  assert.deepEqual(await f.studio.activate(job.id), {rowId: SOURCE.id, url: job.notionUrl});
  assert.equal(f.calls.some(call => call.endpoint.startsWith('https://banhang.shopee')), false);
});

test('source identity change blocks attachment before writes and distinct source products have separate articles', async t => {
  const f = setup(t), first = await published(f); await f.studio.images(first.id);
  f.products.data.rows[0].shop = 'different.shop'; const writes = f.calls.filter(call => call.method !== 'GET').length;
  await assert.rejects(f.studio.attach(first.id), /Sản phẩm nguồn đã thay đổi/); assert.equal(f.calls.filter(call => call.method !== 'GET').length, writes);
  f.products.data.rows[0].shop = SOURCE.shop; await f.studio.attach(first.id);
  const row = {...clone(SOURCE), id: 'second-product', productId: '444', modelId: '555', name: 'Bài Shopee thứ hai', notionPageId: uuid()};
  f.products.data.rows.push(row); f.pages.set(row.notionPageId, sourcePage(row)); Object.assign(f.baseline, {productId: row.productId, name: row.name, variants: [{modelId: row.modelId, name: '', price: row.price, stock: row.stock}]});
  const second = await published(f, row.id); await f.studio.images(second.id); await f.studio.attach(second.id);
  assert.notEqual(second.notionUrl, first.notionUrl); assert.equal(f.pages.get(row.notionPageId).properties[LINK_COLUMN].url, second.notionUrl); assert.equal(f.pages.get(SOURCE.notionPageId).properties[LINK_COLUMN].url, first.notionUrl);
  await f.studio.activate(first.id); assert.equal(f.pages.get(SOURCE.notionPageId).properties[LINK_COLUMN].url, first.notionUrl);
  assert.equal(f.pages.size, 4);
});

test('image append timeout only reconciles saved markers and never appends a duplicate image set', async t => {
  const f = setup(t), job = await published(f); await f.studio.images(job.id);
  const attach = f.replacements.publisher.attachImages; let once = true;
  f.replacements.publisher.attachImages = async (...args) => {const result = await attach(...args); if (once) {once = false; throw Error('response timeout');} return result;};
  await assert.rejects(f.studio.attach(job.id), /timeout/); assert.equal(job.imageAppendAttempted, true);
  await f.studio.attach(job.id); assert.equal(job.status, 'attached'); assert.equal(f.blocks.get(job.notionUrl.split('/').at(-1)).filter(block => block.type === 'image').length, 5);
});

test('load supports another machine, preserves local drafts and prevents identity collision', async t => {
  const f = setup(t), job = await published(f); await f.studio.images(job.id); await f.studio.attach(job.id);
  const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srm-studio-other-')); t.after(() => fs.rmSync(otherDir, {recursive: true, force: true}));
  const other = new ReplacementStudio(otherDir, f.dependencies); const local = other.create({rowIds: [SOURCE.id], insights: 1})[0];
  other.update(local.id, {prompt: 'Bản nháp local đang viết'}); await other.load();
  assert.equal(other.get(local.id).prompt, 'Bản nháp local đang viết'); assert.equal(other.get(job.id).imagesReady, true);
  assert.deepEqual(await other.activate(job.id), {rowId: SOURCE.id, url: job.notionUrl});
  const loaded = other.get(job.id); loaded.shop = 'other.shop'; await assert.rejects(other.load(), /danh tính khác/);
});

test('restart marks submitted image generation uncertain and interrupted writing as local draft', async t => {
  const f = setup(t), job = await approved(f); job.status = 'generating-images'; f.studio.save();
  const restored = new ReplacementStudio(f.dir, f.dependencies); assert.equal(restored.get(job.id).status, 'images-uncertain');
  restored.get(job.id).status = 'generating'; restored.save(); assert.equal(new ReplacementStudio(f.dir, f.dependencies).get(job.id).status, 'draft');
});

test('wrong remote job identity and ambiguous code prevent activation', async t => {
  const f = setup(t), job = await published(f); await f.studio.images(job.id); await f.studio.attach(job.id);
  const page = f.pages.get(job.notionUrl.split('/').at(-1)); page.properties['Model ID'].rich_text = rich('different-model');
  await assert.rejects(f.studio.activate(job.id), /Model ID/); page.properties['Model ID'].rich_text = rich(SOURCE.modelId);
  const blocks = f.blocks.get(job.notionUrl.split('/').at(-1)); blocks.push({...clone(blocks.find(block => block.type === 'code')), id: uuid()});
  await assert.rejects(f.studio.activate(job.id), /đúng một JSON/);
});

test('multi-model price changes are blocked at live schema hydration before creating images or rewriting Notion', async t => {
  const f = setup(t); f.baseline.hasVariants = true; f.baseline.variants.push({modelId: '333', name: 'Phân loại hai', price: 110000, stock: 10});
  const id = f.studio.create({rowIds: [SOURCE.id]})[0].id; f.studio.update(id, {prompt: 'Viết bài', name: 'Tên nhân viên yêu cầu', price: 222222}); await f.studio.generate(id); await f.studio.publish(id); const job = f.studio.get(id);
  const before = f.article(job), writes = f.calls.filter(call => call.method !== 'GET').length;
  await assert.rejects(f.studio.images(job.id), /nhiều phân loại/); assert.deepEqual(f.article(job), before); assert.equal(f.counts().generationCalls, 0); assert.equal(f.calls.filter(call => call.method !== 'GET').length, writes);
});

test('remote source-product uniqueness blocks a second local job from publishing duplicate content', async t => {
  const f = setup(t), first = await published(f), otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srm-studio-duplicate-')); t.after(() => fs.rmSync(otherDir, {recursive: true, force: true}));
  const studio = new ReplacementStudio(otherDir, f.dependencies), job = studio.create({rowIds: [SOURCE.id], insights: 1})[0];
  studio.update(job.id, {prompt: 'Bài từ máy thứ hai', name: 'Tên nhân viên yêu cầu'}); await studio.generate(job.id); studio.approve(job.id);
  await assert.rejects(studio.publish(job.id), /đã có bài trên Notion/); assert.equal(f.pages.size, 2); assert.equal(first.notionUrl, f.studio.get(first.id).notionUrl);
});

test('failed regeneration cannot approve stale content, and snapshot logs redact provider secrets', async t => {
  const f = setup(t), job = await approved(f); f.gemini.generate = async () => {throw Error('Lỗi API ntn_secretABC Bearer abc-secret');};
  await assert.rejects(f.studio.generate(job.id), /Lỗi API/); assert.equal(job.contentApproved, false); assert.throws(() => f.studio.approve(job.id), /hoàn chỉnh/);
  const snapshot = JSON.stringify(f.studio.snapshot()); assert.equal(snapshot.includes('ntn_secretABC'), false); assert.equal(snapshot.includes('abc-secret'), false);
});

test('raw asset checkpoint tampering blocks compression without re-submitting image prompts', async t => {
  const f = setup(t), job = await published(f), compress = f.studio.compress.bind(f.studio); let once = true;
  f.studio.compress = async selected => {if (once) {once = false; throw Error('Mô phỏng app tạm dừng trước khi nén');} return compress(selected);};
  await assert.rejects(f.studio.images(job.id), /tạm dừng/); assert.equal(job.sourceAssets.images.length, 5); assert.equal(job.generatedAssets, undefined);
  fs.appendFileSync(job.sourceAssets.images[0].path, 'tamper'); await assert.rejects(f.studio.images(job.id), /đã thay đổi/); assert.equal(f.counts().generationCalls, 1);
});

test('another machine can load an image-free article, generate its images and attach exactly one full set', async t => {
  const f = setup(t), first = await published(f), otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srm-studio-image-free-')); t.after(() => fs.rmSync(otherDir, {recursive: true, force: true}));
  const other = new ReplacementStudio(otherDir, f.dependencies); await other.load(); const job = other.get(first.id);
  assert.deepEqual(job.imageUrls, []); assert.equal(job.baseline, undefined); await other.images(job.id); await other.attach(job.id);
  assert.equal(f.counts().generationCalls, 1); assert.equal(f.counts().attachCalls, 1); assert.equal(job.imageUrls.length, 5);
  assert.equal(f.article(job).images.length, 5); assert.equal(job.status, 'attached');
  await other.attach(job.id); assert.equal(f.counts().attachCalls, 1);
});

test('content changes after image generation block image reuse and attachment across restart without overwriting Notion', async t => {
  const f = setup(t), job = await published(f); await f.studio.images(job.id); const digest = job.imageContentDigest;
  assert.match(digest, /^[a-f\d]{64}$/); const writes = f.calls.filter(call => call.method !== 'GET').length;
  f.changeArticle(job, article => {article.product.name = 'Tên mới sau khi đã tạo bộ ảnh';});
  const restarted = new ReplacementStudio(f.dir, f.dependencies);
  await assert.rejects(restarted.images(job.id), error => error.code === 'STUDIO_IMAGE_CONTENT_CHANGED');
  await assert.rejects(restarted.attach(job.id), error => error.code === 'STUDIO_IMAGE_CONTENT_CHANGED');
  assert.equal(f.counts().generationCalls, 1); assert.equal(f.counts().attachCalls, 0); assert.equal(f.calls.filter(call => call.method !== 'GET').length, writes);
  assert.equal(f.article(job).product.name, 'Tên mới sau khi đã tạo bộ ảnh'); assert.deepEqual(f.article(job).images, []);
});

test('edits during image upload are kept and stop final attachment; restoring reviewed content reconciles existing images', async t => {
  const f = setup(t), job = await published(f); await f.studio.images(job.id); const original = job.article.product.description;
  f.uploadHook(() => f.changeArticle(job, article => {article.product.description = 'Nhân viên sửa mô tả trong lúc tải ảnh.';}));
  await assert.rejects(f.studio.attach(job.id), error => error.code === 'STUDIO_IMAGE_CONTENT_CHANGED');
  assert.equal(f.article(job).product.description, 'Nhân viên sửa mô tả trong lúc tải ảnh.'); assert.deepEqual(f.article(job).images, []);
  assert.equal(f.pages.get(SOURCE.notionPageId).properties[LINK_COLUMN].url, null); assert.equal(job.imagesReady, false); assert.equal(job.imageUrls.length, 5);
  f.changeArticle(job, article => {article.product.description = original;}); await f.studio.attach(job.id);
  assert.equal(f.counts().attachCalls, 1); assert.equal(job.imagesReady, true); assert.equal(f.article(job).images.length, 5);
});

test('content digest in Notion protects activation after loading an attached article on another machine', async t => {
  const f = setup(t), job = await published(f); await f.studio.images(job.id); await f.studio.attach(job.id);
  const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srm-studio-content-digest-')); t.after(() => fs.rmSync(otherDir, {recursive: true, force: true}));
  const other = new ReplacementStudio(otherDir, f.dependencies); await other.load(); assert.equal(other.get(job.id).imageContentDigest, job.imageContentDigest);
  f.changeArticle(job, article => {article.product.description = 'Bài đã đổi sau khi bộ ảnh sẵn sàng.';});
  await assert.rejects(other.activate(job.id), error => error.code === 'STUDIO_IMAGE_CONTENT_CHANGED');
  await assert.rejects(other.load(), error => error.code === 'STUDIO_IMAGE_CONTENT_CHANGED');
  assert.equal(f.article(job).product.description, 'Bài đã đổi sau khi bộ ảnh sẵn sàng.');
});

test('importSingleImage saves numbered PNG, allows overwrite, updates chromeDriveAssets and enables ready gate on 5 images', async t => {
  const f = setup(t), job = await published(f);
  const samplePath = path.join(f.dir, 'sample.png');
  const buffer = await require('sharp')({create: {width: 600, height: 600, channels: 3, background: {r: 10, g: 20, b: 30}}}).png().toBuffer();
  fs.writeFileSync(samplePath, buffer);

  for (let index = 0; index < 5; index++) {
    const updated = await f.studio.importSingleImage(job.id, index, samplePath);
    assert.equal(updated.imageFiles.length, index + 1);
    assert.equal(updated.imageFiles[index].index, index);
    assert.equal(updated.imageFiles[index].filename, (index + 1) + '.png');
  }
  const full = f.studio.get(job.id);
  assert.equal(full.chromeDriveAssets.images.length, 5);
  assert.equal(full.status, 'images-ready');
  assert.equal(full.driveAssets.verified, true);

  // Overwrite slot 0
  const updated0 = await f.studio.importSingleImage(job.id, 0, samplePath);
  assert.equal(updated0.imageFiles[0].filename, '1.png');

  // Test clearImageLogs
  f.studio.log(job, 'Ảnh đã lưu: 1.png');
  assert.ok(f.studio.data.logs.some(l => l.message.includes('1.png')));
  f.studio.clearImageLogs(job.id);
  assert.ok(!f.studio.data.logs.some(l => l.message.includes('1.png')));
});

test('replaceProduct replaces product on Shopee, updates Notion, sets replaced status and note', async t => {
  const f = setup(t), job = await published(f);
  await f.studio.images(job.id);
  await f.studio.attach(job.id);
  const updated = await f.studio.replaceProduct(job.id);
  assert.equal(updated.status, 'replaced');
  assert.equal(f.counts().applyCalls, 1);
  const row = f.products.data.rows.find(r => r.productId === SOURCE.productId);
  assert.equal(row.replacementStatus, 'Đã thay thế');
  assert.equal(row.name, job.name);
  assert.equal(row.price, job.price);
  const page = f.pages.get(SOURCE.notionPageId);
  assert.equal(page.properties['Cần thay thế']?.select?.name, 'Đã thay thế');
  assert.equal(page.properties['Tên sản phẩm']?.title[0]?.text?.content, job.name);
  assert.equal(page.properties['Giá bán']?.number, job.price);
});

test('ReplacementStudio recovers from missing logs/jobs array in state.json without unshift error', async t => {
  const f = setup(t);
  // Simulate corrupt or legacy state.json without logs or jobs
  fs.writeFileSync(path.join(f.dir, 'replacement-studio', 'state.json'), JSON.stringify({version: 1}));
  const studio = new ReplacementStudio(f.dir, {
    products: f.products,
    replacements: f.replacements,
    integrations: f.integrations,
    gemini: f.gemini,
    chatgpt: f.chatgpt,
    drive: f.drive,
  });
  assert.ok(Array.isArray(studio.data.logs));
  assert.ok(Array.isArray(studio.data.jobs));
  // create and log should succeed without throwing Cannot read properties of undefined (reading 'unshift')
  const created = studio.create({rowIds: [f.products.data.rows[0].id]});
  assert.equal(created.length, 1);
  assert.doesNotThrow(() => studio.log(null, 'Kiểm tra log an toàn'));
  assert.ok(studio.data.logs.length >= 1);
  const snap = studio.snapshot();
  assert.ok(Array.isArray(snap.logs));
  assert.ok(Array.isArray(snap.jobs));
});

test('syncSourceToReplacements maps warehouse products to replacement table and preserves employee titles', async t => {
  const f = setup(t);
  const result = await f.studio.syncSourceToReplacements();
  assert.equal(result.total, 1);
  assert.equal(result.created, 1);

  // Check the created Notion page
  const pages = [...f.pages.values()].filter(p => p.parent?.database_id === f.studio.data.databaseId);
  assert.equal(pages.length, 1);
  const page = pages[0];
  assert.equal(page.properties['Sản phẩm gốc']?.rich_text[0]?.text?.content, SOURCE.name);
  assert.equal(page.properties['Sản phẩm nguồn']?.rich_text[0]?.text?.content, SOURCE.name);
  assert.equal(page.properties['ID sản phẩm']?.rich_text[0]?.text?.content, SOURCE.productId);
  assert.equal(page.properties['Tên shop']?.rich_text[0]?.text?.content, SOURCE.shop);
  assert.ok(['Chưa có', 'Chờ tên mới'].includes(page.properties['Trạng thái']?.select?.name));

  // Second sync should not duplicate
  const sync2 = await f.studio.syncSourceToReplacements();
  assert.equal(sync2.created, 0);
  assert.equal(sync2.unchanged, 1);
});

test('scanReplacements scans replacement table by Đã có status and preserves employee entered title', async t => {
  const f = setup(t);
  await f.studio.syncSourceToReplacements();
  const pages = [...f.pages.values()].filter(p => p.parent?.database_id === f.studio.data.databaseId);
  assert.equal(pages.length, 1);
  const page = pages[0];

  // Employee enters replacement title on Notion and marks status 'Đã có'
  const newTitle = 'Kem Dưỡng Phục Hồi Da Nhạy Cảm 50ml';
  page.properties['Tên sản phẩm'] = {title: [{type: 'text', text: {content: newTitle}}]};
  page.properties['Trạng thái'] = {select: {name: 'Đã có'}};

  // Tool scans replacement table
  const snapshot = await f.studio.scanReplacements();
  assert.ok(snapshot.jobs.length >= 1);
  const scannedJob = snapshot.jobs.find(j => j.productId === SOURCE.productId);
  assert.ok(scannedJob);
  assert.equal(scannedJob.name, newTitle);
  assert.equal(scannedJob.sourceName, SOURCE.name);

  // Writing with Gemini preserves exact employee entered title
  f.studio.update(scannedJob.id, {prompt: 'Viết bài bán hàng chuyên nghiệp'});
  await f.studio.generate(scannedJob.id);
  const generatedJob = f.studio.get(scannedJob.id);
  assert.equal(generatedJob.name, newTitle);
  assert.ok(generatedJob.description.length > 0);
});

test('scanReplacements detects Tên sản phẩm thay thế column and avoids code block fetch', async t => {
  const f = setup(t);
  await f.studio.syncSourceToReplacements();
  const pages = [...f.pages.values()].filter(p => p.parent?.database_id === f.studio.data.databaseId);
  assert.equal(pages.length, 1);
  const page = pages[0];

  // Employee enters replacement title in separate column without marking status
  const repTitle = 'Dung dịch nhỏ mắt eyetamin 10 ml';
  page.properties['Tên sản phẩm thay thế'] = {rich_text: [{type: 'text', text: {content: repTitle}}]};

  let codeCalled = false;
  const originalCode = f.studio.code.bind(f.studio);
  f.studio.code = async (...args) => {
    codeCalled = true;
    return originalCode(...args);
  };

  const snapshot = await f.studio.scanReplacements();
  assert.equal(codeCalled, false, 'Should not call code block fetch for pending job');
  const scannedJob = snapshot.jobs.find(j => j.productId === SOURCE.productId);
  assert.ok(scannedJob);
  assert.equal(scannedJob.name, repTitle);
  assert.equal(scannedJob.isReplacementReady, true);
});


