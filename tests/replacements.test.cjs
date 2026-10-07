const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {Products} = require('../src/products.cjs');
const {STATUS_COLUMN, STATUS_SCHEMA, PENDING, DONE} = require('../src/replacement-status.cjs');
const {ReplacementManager, validateArticle, articleId, DATABASE_ID, LINK_COLUMN, PLAN_TTL} = require('../src/replacements.cjs');

const ARTICLE_ID = '0123456789abcdef0123456789abcdef';
const ARTICLE_URL = 'https://app.notion.com/p/' + ARTICLE_ID;
const SOURCE = {id: 'local-product', shop: 'shop', name: 'Sản phẩm nguồn', productId: '12345678', modelId: '9876543', variant: '', price: 100000, stock: 20, profileId: 'profile', notionPageId: 'product-page', sync: 'synced'};
const ARTICLE = {schemaVersion: 1, target: {shop: SOURCE.shop, productId: SOURCE.productId, name: SOURCE.name},
  product: {name: 'Sản phẩm được duyệt', description: 'Mô tả từ nhãn thật của sản phẩm.', category: 'Ngành hiện tại', fields: {'Thương hiệu': 'Nhãn hiện tại', 'Ngày hết hạn': '31/12/2027'}, variants: [{modelId: SOURCE.modelId, name: '', price: 120000, stock: 8}]},
  images: ['https://images.example.com/photo.jpg'], imageFolder: 'https://drive.google.com/drive/u/2/folders/folder-source', approved: false};
const SCHEMA = {shop: SOURCE.shop, productId: SOURCE.productId, name: SOURCE.name, description: 'Mô tả đang có.', category: 'Ngành hiện tại',
  fields: [{label: 'Thương hiệu', value: 'Nhãn hiện tại', required: true, kind: 'select'}, {label: 'Ngày hết hạn', value: '31/12/2027', required: true, kind: 'date'}],
  images: ['https://images.example.com/current.jpg'], variants: [{modelId: SOURCE.modelId, name: '', price: SOURCE.price, stock: SOURCE.stock}]};
const clone = value => structuredClone(value);
const rich = content => [{type: 'text', text: {content}}];
function page(row, url = ARTICLE_URL) {
  return {id: row.notionPageId, properties: {
    'Tên shop': {rich_text: rich(row.shop)}, 'Tên sản phẩm': {title: rich(row.name)}, 'ID sản phẩm': {rich_text: rich(row.productId)},
    'Model ID': {rich_text: rich(row.modelId)}, 'Phân loại': {rich_text: rich(row.variant)}, 'Giá bán': {number: row.price}, 'Kho hàng': {number: row.stock},
    [LINK_COLUMN]: {url},
  }};
}
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srm-replacement-')); t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const calls = [], pages = [page(SOURCE)], article = clone(ARTICLE), schema = clone(SCHEMA); let applyCalls = 0, syncFail = false, syncCalls = [];
  const products = {data: {databaseId: 'product-db', rows: [clone(SOURCE)], shops: {profile: {name: 'shop'}}}, save() {}, parse: Products.prototype.parse, store: {profile: id => {assert.equal(id, 'profile');}}, sync: async (emit, id) => {syncCalls.push(id); if (syncFail) throw Error('Notion offline'); const row = products.data.rows.find(row => row.id === id); row.sync = 'synced'; const remote = pages.find(page => page.id === row.notionPageId); if (remote) Object.assign(remote.properties, page(row).properties);}};
  const integration = {listPages: async () => clone(pages), notion: async (endpoint, method = 'GET', body) => {
    calls.push({endpoint, method, body: clone(body)});
    if (endpoint.startsWith('databases/') && method === 'GET') return {id: endpoint.slice(10), properties: {[LINK_COLUMN]: {type: 'url'}, [STATUS_COLUMN]: {type: 'select', ...clone(STATUS_SCHEMA)}}};
    if (endpoint === 'pages/' + ARTICLE_ID) return {id: ARTICLE_ID};
    if (endpoint === 'pages/product-page' && method === 'GET') return clone(pages[0]);
    if (endpoint === 'pages/product-page' && method === 'PATCH') {Object.assign(pages[0].properties, body.properties); return clone(pages[0]);}
    if (endpoint === 'pages' && method === 'POST') return {id: ARTICLE_ID, url: ARTICLE_URL};
    if (endpoint === 'blocks/' + ARTICLE_ID + '/children?page_size=100') return {results: [{id: 'code', type: 'code', code: {language: 'json', rich_text: rich(JSON.stringify(article))}}], has_more: false};
    throw Error('Unexpected Notion endpoint: ' + endpoint + ' ' + method);
  }};
  const editor = {inspect: async target => {assert.equal(target.profileId, 'profile'); return clone(schema);}, validate: (current, desired) => {
    assert.equal(current.category, desired.category);
    for (const field of current.fields.filter(field => field.required)) if (!desired.fields[field.label]) throw Error('Thiếu trường bắt buộc: ' + field.label);
    return [{label: 'Tên sản phẩm', before: current.name, after: desired.name}];
  }, apply: async (target, desired, assets, options) => {
    applyCalls++; assert.equal(assets.images.length, 1); assert.equal(options.baseline.name, SOURCE.name); options.beforeSubmit();
    return {schema: {...clone(schema), ...desired.product, fields: schema.fields.map(field => ({...field, value: desired.product.fields[field.label]}))}};
  }};
  const images = {prepareImages: async (sources, dataDir, planId) => {
    const target = path.join(dataDir, planId); fs.mkdirSync(target, {recursive: true});
    const jpeg=await require('sharp')({create:{width:500,height:500,channels:3,background:'#ffffff'}}).jpeg().toBuffer();
    return {id: planId, images: sources.map((sourceUrl, index) => {
      const filename = index + '.jpg', file = path.join(target, filename), contents = jpeg; fs.writeFileSync(file, contents);
      return {path: file, filename, hash: createHash('sha256').update(contents).digest('hex'), sourceUrl, bytes: contents.length, width: 1200, height: 1200};
    })};
  }};
  const manager = new ReplacementManager(dir, products, integration, editor, images);
  return {dir, manager, products, integration, editor, images, calls, pages, article, schema, applyCalls: () => applyCalls, syncCalls: () => syncCalls, setSyncFail: value => {syncFail = value;}};
}

test('article validates exact source identity and rejects unknown keys, malformed images and values', () => {
  assert.deepEqual(validateArticle(ARTICLE, SOURCE), ARTICLE);
  for (const field of ['shop', 'productId', 'name']) {
    const input = clone(ARTICLE); input.target[field] += '1'; assert.throws(() => validateArticle(input, SOURCE));
  }
  assert.throws(() => validateArticle({...ARTICLE, unexpected: true}), /không được hỗ trợ/);
  assert.throws(() => validateArticle({...ARTICLE, images: []}), /từng ảnh/);
  assert.throws(() => validateArticle({...ARTICLE, images: [ARTICLE.imageFolder]}), /thư mục/);
  assert.throws(() => validateArticle({...ARTICLE, images: ['http://images.example.com/a.jpg']}), /HTTPS/);
  const bad = clone(ARTICLE); bad.product.variants[0].stock = -1; assert.throws(() => validateArticle(bad), /tồn kho/);
  const poison = JSON.parse(JSON.stringify(ARTICLE).replace('"fields":{', '"fields":{"__proto__":"x",')); assert.throws(() => validateArticle(poison), /không được hỗ trợ/);
  assert.equal(articleId('https://www.notion.so/template-' + ARTICLE_ID), ARTICLE_ID);
  assert.throws(() => articleId('https://example.com/' + ARTICLE_ID), /Notion/);
});

test('Studio preview preserves fresh sold inventory while keeping approved name and price', async t => {
  const {manager, schema, article, products}=setup(t);article.approved=true;
  schema.variants[0].stock=3;schema.fields.push({label:'Kho hàng',value:'3',kind:'number'});article.product.fields['Kho hàng']=20;
  const plan=await manager.prepare(SOURCE.id,ARTICLE_URL,{preserveStock:true});
  assert.equal(plan.article.product.variants[0].stock,3);assert.equal(plan.article.product.fields['Kho hàng'],'3');
  assert.equal(plan.article.product.variants[0].price,120000);assert.equal(article.product.variants[0].stock,8);
  await manager.run(plan.id);assert.equal(products.data.rows[0].stock,3);assert.equal(products.data.rows[0].price,120000);
});

test('load adds only missing URL column and binds stable row identities without discarding local pending data', async t => {
  const {manager, integration, products, calls, pages} = setup(t), base = integration.notion;
  products.data.databaseId = ''; products.data.rows[0].sync = 'pending'; products.data.rows[0].stock = 12;
  integration.notion = async (endpoint, method, body) => {
    if (endpoint === 'databases/' + DATABASE_ID && !method) return {id: DATABASE_ID, properties: {'Tên sản phẩm': {type: 'title'}}};
    if (endpoint === 'databases/' + DATABASE_ID && method === 'PATCH') {calls.push({endpoint, method, body}); return {id: DATABASE_ID};}
    return base(endpoint, method, body);
  };
  await manager.loadLinks();
  assert.equal(products.data.databaseId, DATABASE_ID); assert.equal(products.data.rows[0].id, SOURCE.id); assert.equal(products.data.rows[0].stock, 12);
  assert.equal(products.data.rows[0].replacementUrl, ARTICLE_URL); assert.deepEqual(calls.find(call => call.method === 'PATCH').body.properties, {[LINK_COLUMN]: {url: {}}, [STATUS_COLUMN]: STATUS_SCHEMA});
  pages.push(clone(pages[0])); await assert.rejects(manager.loadLinks(), /trùng/); assert.equal(products.data.rows.length, 1);
});

test('nested paginated article reads one JSON and refuses ambiguous or invalid JSON before any browser submit', async t => {
  const {manager, integration, article, applyCalls} = setup(t), base = integration.notion;
  integration.notion = async (endpoint, method, body) => {
    if (endpoint === 'blocks/' + ARTICLE_ID + '/children?page_size=100') return {results: [{id: 'toggle', type: 'toggle', has_children: true}], has_more: true, next_cursor: 'next page'};
    if (endpoint === 'blocks/toggle/children?page_size=100') return {results: [{id: 'code', type: 'code', code: {language: 'json', rich_text: rich(JSON.stringify(article))}}], has_more: false};
    if (endpoint.endsWith('&start_cursor=next%20page')) return {results: [{id: 'paragraph', type: 'paragraph'}], has_more: false};
    return base(endpoint, method, body);
  };
  assert.deepEqual(await manager.readArticle(ARTICLE_URL), ARTICLE); assert.equal(applyCalls(), 0);
  integration.notion = async endpoint => endpoint.startsWith('pages/') ? {id: ARTICLE_ID} : {results: [1, 2].map(id => ({id, type: 'code', code: {language: 'json', rich_text: rich(JSON.stringify(article))}}))};
  await assert.rejects(manager.readArticle(ARTICLE_URL), /đúng một/);
  integration.notion = async endpoint => endpoint.startsWith('pages/') ? {id: ARTICLE_ID} : {results: [{type: 'code', code: {language: 'json', rich_text: rich('{broken')}}]};
  await assert.rejects(manager.prepare(SOURCE.id, ARTICLE_URL), /sai định dạng/); assert.equal(applyCalls(), 0);
});

test('template preserves source facts and required-field guidance, creates once and never overwrites an existing article', async t => {
  const {manager, pages, calls, schema, products} = setup(t); pages[0].properties[LINK_COLUMN].url = '';
  const created = await manager.createTemplate(SOURCE.id, schema); assert.equal(created.existing, false);
  assert.equal(created.article.product.description, SCHEMA.description); assert.equal(created.article.product.fields['Thương hiệu'], 'Nhãn hiện tại'); assert.deepEqual(created.article.images, SCHEMA.images);
  assert.equal(created.article.approved, false); assert.equal(created.article.target.name, SOURCE.name);
  const post = calls.find(call => call.endpoint === 'pages' && call.method === 'POST');
  assert.match(post.body.children[1].paragraph.rich_text[0].text.content, /Thương hiệu/);
  assert.equal((await manager.createTemplate(SOURCE.id, schema)).existing, true); assert.equal(calls.filter(call => call.endpoint === 'pages' && call.method === 'POST').length, 1);
  assert.equal(products.data.rows[0].replacementUrl, ARTICLE_URL);
});

test('uncertain template creation is journaled and never creates another page automatically', async t => {
  const {manager, integration, pages, calls} = setup(t), base = integration.notion; pages[0].properties[LINK_COLUMN].url = '';
  integration.notion = async (...args) => {if (args[0] === 'pages' && args[1] === 'POST') {calls.push({endpoint: 'pages', method: 'POST'}); throw Error('request timeout');} return base(...args);};
  await assert.rejects(manager.createTemplate(SOURCE.id, SCHEMA), /timeout/);
  await assert.rejects(manager.createTemplate(SOURCE.id, SCHEMA), /chưa xác minh/); assert.equal(calls.filter(call => call.endpoint === 'pages' && call.method === 'POST').length, 1);
});

test('preview validates required fields and prepares immutable images without submitting or exposing local paths', async t => {
  const {manager, article, applyCalls, calls} = setup(t); delete article.product.fields['Thương hiệu'];
  await assert.rejects(manager.prepare(SOURCE.id, ARTICLE_URL), /bắt buộc/); assert.equal(manager.data.plans.length, 0);
  article.product.fields['Thương hiệu'] = 'Nhãn hiện tại'; const prepared = await manager.prepare(SOURCE.id, ARTICLE_URL);
  assert.equal(prepared.status, 'prepared'); assert.equal(applyCalls(), 0); assert.equal(prepared.images[0].path, undefined); assert.match(prepared.images[0].hash, /^[a-f\d]{64}$/);
  assert.equal(calls.some(call => call.method === 'POST' || call.method === 'PATCH'), false);
});

test('expired or altered preview cannot submit and target identity must still match', async t => {
  const {manager, products, applyCalls} = setup(t), first = await manager.prepare(SOURCE.id, ARTICLE_URL);
  manager.data.plans[0].expiresAt = Date.now() - PLAN_TTL; await assert.rejects(manager.run(first.id), /hết hạn/); assert.equal(applyCalls(), 0);
  const next = await manager.prepare(SOURCE.id, ARTICLE_URL); products.data.rows[0].name += ' changed';
  await assert.rejects(manager.run(next.id), /đã thay đổi/); products.data.rows[0].name = SOURCE.name;
  fs.appendFileSync(manager.data.plans[0].assets.images[0].path, 'tamper'); await assert.rejects(manager.run(next.id), /Ảnh đã thay đổi/); assert.equal(applyCalls(), 0);
});

test('verified replacement syncs only its product rows and plan cannot run twice', async t => {
  const {manager, products, applyCalls, syncCalls} = setup(t);
  products.data.rows.push({...clone(SOURCE), id: 'unrelated', productId: '87654321', sync: 'pending'});
  const preview = await manager.prepare(SOURCE.id, ARTICLE_URL), done = await manager.run(preview.id);
  assert.equal(done.status, 'verified'); assert.equal(products.data.rows[0].name, ARTICLE.product.name); assert.equal(products.data.rows[0].stock, 8); assert.equal(products.data.rows[1].name, SOURCE.name);
  assert.deepEqual(syncCalls(), [SOURCE.id]); await assert.rejects(manager.run(preview.id), /Không tự gửi lại/); assert.equal(applyCalls(), 1);
});

test('post-submit timeout is durable uncertain and never replayed, including across restart', async t => {
  const {manager, editor, dir, products, integration, images} = setup(t); let calls = 0;
  editor.apply = async (target, article, assets, options) => {calls++; options.beforeSubmit(); throw Error('Shopee timeout after submit');};
  const preview = await manager.prepare(SOURCE.id, ARTICLE_URL); await assert.rejects(manager.run(preview.id), /timeout/); assert.equal(manager.data.plans[0].status, 'uncertain');
  const restored = new ReplacementManager(dir, products, integration, editor, images);
  await assert.rejects(restored.run(preview.id), /Không tự gửi lại/); await assert.rejects(restored.prepare(SOURCE.id, ARTICLE_URL), /chưa xác minh/); assert.equal(calls, 1);
  restored.data.plans[0].status = 'running'; restored.save(); const restarted = new ReplacementManager(dir, products, integration, editor, images); assert.equal(restarted.data.plans[0].status, 'uncertain');
});

test('Notion failure remains separate after verified Shopee save and does not resend replacement', async t => {
  const {manager, products, pages, applyCalls, setSyncFail} = setup(t); setSyncFail(true);
  const preview = await manager.prepare(SOURCE.id, ARTICLE_URL), result = await manager.run(preview.id);
  assert.equal(result.status, 'verified'); assert.equal(result.notionPending, true); assert.match(result.notionError, /offline/); assert.equal(products.data.rows[0].sync, 'pending');
  await assert.rejects(manager.run(preview.id), /Không tự gửi lại/); assert.equal(applyCalls(), 1);
  assert.equal(pages[0].properties[STATUS_COLUMN].select.name, PENDING);
  setSyncFail(false); await manager.syncPending();
  assert.equal(pages[0].properties[STATUS_COLUMN].select.name, DONE);
  assert.equal(manager.data.plans[0].notionPending, false); assert.equal(applyCalls(), 1);
});

test('replacement status uses pending links, preserves completed links, and resets for a different article', async t => {
  const {manager, products, pages, calls} = setup(t), row = products.data.rows[0];
  await manager.linkSourceRow(row, ARTICLE_URL);
  assert.equal(pages[0].properties[STATUS_COLUMN].select.name, PENDING);
  const writes = calls.filter(call => call.method === 'PATCH').length;
  await manager.linkSourceRow(row, ARTICLE_URL);
  assert.equal(calls.filter(call => call.method === 'PATCH').length, writes);
  pages[0].properties[STATUS_COLUMN] = {select: {name: DONE}};
  await manager.linkSourceRow(row, ARTICLE_URL); assert.equal(row.replacementStatus, DONE);
  const another = 'https://www.notion.so/' + 'f'.repeat(32);
  await manager.linkSourceRow(row, another); assert.equal(row.replacementStatus, PENDING);
  await manager.linkSourceRow(row, ''); assert.equal(pages[0].properties[STATUS_COLUMN].select, null);
});

test('only verified Shopee results complete replacement work; previews, failures and timeouts do not', async t => {
  const {manager, products, pages, editor} = setup(t);
  await manager.linkSourceRow(products.data.rows[0], ARTICLE_URL);
  const preview = await manager.prepare(SOURCE.id, ARTICLE_URL);
  assert.equal(pages[0].properties[STATUS_COLUMN].select.name, PENDING);
  editor.apply = async (target, article, assets, options) => {options.beforeSubmit(); throw Error('Shopee timeout');};
  await assert.rejects(manager.run(preview.id), /timeout/);
  assert.equal(pages[0].properties[STATUS_COLUMN].select.name, PENDING);
  await assert.rejects(manager.syncPlanNotion(manager.data.plans[0], products.data.rows), /Chưa xác minh/);
});

test('Notion status failure after verified Shopee is retried without re-submitting Shopee', async t => {
  const {manager, products, pages, integration, applyCalls} = setup(t), base = integration.notion;
  let denyDone = true;
  integration.notion = async (endpoint, method, body) => {
    if (denyDone && body?.properties?.[STATUS_COLUMN]?.select?.name === DONE) throw Error('Status write offline');
    return base(endpoint, method, body);
  };
  const preview = await manager.prepare(SOURCE.id, ARTICLE_URL), done = await manager.run(preview.id);
  assert.equal(done.status, 'verified'); assert.equal(done.notionPending, true);
  assert.equal(pages[0].properties[STATUS_COLUMN].select.name, PENDING);
  denyDone = false; await manager.syncPending();
  assert.equal(pages[0].properties[STATUS_COLUMN].select.name, DONE); assert.equal(applyCalls(), 1);
  const parsed = products.parse(pages[0]); assert.equal(parsed.replacementStatus, DONE); assert.equal(parsed.replacementUrl, ARTICLE_URL);
});

test('status column validation preserves existing properties and rejects mismatched types', async t => {
  const {manager, integration} = setup(t), base = integration.notion;
  integration.notion = async (endpoint, method, body) => {
    if (endpoint.startsWith('databases/') && !method) return {id: 'product-db', properties: {[LINK_COLUMN]: {type: 'url'}, [STATUS_COLUMN]: {type: 'checkbox'}}};
    return base(endpoint, method, body);
  };
  await assert.rejects(manager.ensureColumn(), /Select/);
});

function withPublisher(fixture) {
  const {manager, integration, calls, pages} = fixture, base = integration.notion, imageId = '11111111111111111111111111111111';
  let savedArticle, attachCalls = 0, createCalls = 0, failAttach = false, failCode = false, failLink = false, afterAttach;
  integration.notion = async (endpoint, method = 'GET', body) => {
    if (endpoint === 'pages' && method === 'POST') {
      createCalls++; savedArticle = JSON.parse(body.children.find(block => block.type === 'code').code.rich_text.map(item => item.text.content).join(''));
      return base(endpoint, method, body);
    }
    if (endpoint === 'blocks/' + ARTICLE_ID + '/children?page_size=100') return {results: [{id: 'unrelated', type: 'paragraph'}], has_more: true, next_cursor: 'code page'};
    if (endpoint === 'blocks/' + ARTICLE_ID + '/children?page_size=100&start_cursor=code%20page') return {results: [{id: 'template-code', type: 'code', code: {language: 'json', rich_text: rich(JSON.stringify(savedArticle))}}], has_more: false};
    if (endpoint === 'blocks/template-code' && method === 'PATCH') {
      calls.push({endpoint, method, body: clone(body)}); if (failCode) {failCode = false; throw Error('JSON patch offline');}
      savedArticle = JSON.parse(body.code.rich_text.map(item => item.text.content).join('')); return {id: 'template-code'};
    }
    if (endpoint === 'pages/product-page' && method === 'PATCH' && failLink) {failLink = false; throw Error('Link patch offline');}
    return base(endpoint, method, body);
  };
  manager.publisher = {attachImages: async (i, url, assets) => {
    attachCalls++; assert.equal(assets.images.length, 1); assert.equal(url, ARTICLE_URL);
    if (failAttach) {failAttach = false; throw Error('Image publisher offline');}
    afterAttach?.(); return [ARTICLE_URL + '#' + imageId];
  }};
  pages[0].properties[LINK_COLUMN].url = '';
  return {savedArticle: () => savedArticle, createCalls: () => createCalls, attachCalls: () => attachCalls,
    failAttach: () => {failAttach = true;}, failCode: () => {failCode = true;}, failLink: () => {failLink = true;}, afterAttach: callback => {afterAttach = callback;}};
}

test('publisher creates a template with compressed stable Notion links and resumes a failed image step on the same page', async t => {
  const fixture = setup(t), {manager, products} = fixture, publisher = withPublisher(fixture); publisher.failAttach();
  await assert.rejects(manager.createTemplate(SOURCE.id, SCHEMA), /publisher offline/);
  assert.equal(products.data.rows[0].replacementUrl, undefined); assert.equal(publisher.createCalls(), 1);
  const result = await manager.createTemplate(SOURCE.id, SCHEMA);
  assert.equal(result.existing, true); assert.equal(result.imagesReady, true); assert.match(result.article.images[0], /#[a-f\d]{32}$/);
  assert.deepEqual(publisher.savedArticle().images, result.article.images); assert.equal(publisher.createCalls(), 1); assert.equal(publisher.attachCalls(), 2);
  await manager.createTemplate(SOURCE.id, SCHEMA); assert.equal(publisher.createCalls(), 1); assert.equal(publisher.attachCalls(), 2);
});

test('publisher JSON/link failures retry idempotent patches without reattaching photos or discarding human article edits', async t => {
  const fixture = setup(t), {manager} = fixture, publisher = withPublisher(fixture); publisher.failCode();
  publisher.afterAttach(() => {publisher.savedArticle().product.description = 'Mô tả người quản lý đã sửa.';});
  await assert.rejects(manager.createTemplate(SOURCE.id, SCHEMA), /JSON patch offline/); assert.equal(publisher.attachCalls(), 1);
  publisher.failLink(); await assert.rejects(manager.createTemplate(SOURCE.id, SCHEMA), /Link patch offline/); assert.equal(publisher.attachCalls(), 1);
  const result = await manager.createTemplate(SOURCE.id, SCHEMA); assert.equal(result.imagesReady, true); assert.equal(result.article.product.description, 'Mô tả người quản lý đã sửa.');
  assert.equal(publisher.attachCalls(), 1); assert.equal(publisher.createCalls(), 1);
});

test('failed compression happens before creating any Notion article and permits a clean retry', async t => {
  const fixture = setup(t), {manager, images} = fixture, publisher = withPublisher(fixture), base = images.prepareImages;
  let failed = false; images.prepareImages = async (...args) => {if (!failed) {failed = true; throw Error('Image compression failed');} return base(...args);};
  await assert.rejects(manager.createTemplate(SOURCE.id, SCHEMA), /compression failed/); assert.equal(publisher.createCalls(), 0);
  const result = await manager.createTemplate(SOURCE.id, SCHEMA); assert.equal(result.imagesReady, true); assert.equal(publisher.createCalls(), 1);
});

test('publisher refuses to overwrite manually changed image sources or another article link', async t => {
  const fixture = setup(t), {manager, pages} = fixture, publisher = withPublisher(fixture);
  publisher.afterAttach(() => {publisher.savedArticle().images = ['https://images.example.com/user-new.jpg'];});
  await assert.rejects(manager.createTemplate(SOURCE.id, SCHEMA), /Ảnh trong JSON đã được sửa/); assert.deepEqual(publisher.savedArticle().images, ['https://images.example.com/user-new.jpg']);
  pages[0].properties[LINK_COLUMN].url = 'https://www.notion.so/22222222222222222222222222222222';
  const result = await manager.createTemplate(SOURCE.id, SCHEMA); assert.equal(result.url, pages[0].properties[LINK_COLUMN].url); assert.equal(publisher.createCalls(), 1);
});

test('another prepared plan cannot bypass an uncertain mutation for the same product', async t => {
  const {manager, editor} = setup(t); let submissions = 0;
  const first = await manager.prepare(SOURCE.id, ARTICLE_URL), second = await manager.prepare(SOURCE.id, ARTICLE_URL);
  editor.apply = async (target, desired, assets, options) => {submissions++; options.beforeSubmit(); throw Error('Submit timeout');};
  await assert.rejects(manager.run(first.id), /timeout/); await assert.rejects(manager.run(second.id), /chưa xác minh/); assert.equal(submissions, 1);
});

test('editor uncertain flag is preserved if the editor reports an ambiguous submit without a callback', async t => {
  const {manager, editor} = setup(t), preview = await manager.prepare(SOURCE.id, ARTICLE_URL);
  editor.apply = async () => {const error = Error('Ambiguous submit'); error.submitted = true; throw error;};
  await assert.rejects(manager.run(preview.id), /Ambiguous/); assert.equal(manager.data.plans[0].status, 'uncertain');
});

test('archived Notion source is rejected before creating a template or starting its journal', async t => {
  const {manager, pages, calls} = setup(t); pages[0].archived = true;
  await assert.rejects(manager.createTemplate(SOURCE.id, SCHEMA), /đã bị xoá/);
  assert.equal(calls.some(call => call.endpoint === 'pages' && call.method === 'POST'), false);
  assert.equal(Object.keys(manager.data.templates).length, 0);
});

test('fresh logged-in profile binds Notion products without a full scan or discarding pending local fields', async t => {
  const {manager, products} = setup(t); products.data.shops = {}; products.data.rows[0].profileId = null;
  products.data.rows[0].sync = 'pending'; products.data.rows[0].stock = 12;
  products.store.data = {profiles: [{id: 'profile', enabled: true}]}; let probes = 0;
  products.scanner = {shop: async id => {assert.equal(id, 'profile'); probes++; return 'shop';}};
  await manager.loadLinks(); assert.equal(products.data.rows[0].profileId, 'profile');
  assert.equal(products.data.rows[0].stock, 12); assert.equal(products.data.rows[0].sync, 'pending');
  assert.equal(manager.resolve(SOURCE.id).shop, 'shop'); await manager.loadLinks(); assert.equal(probes, 1);
});
