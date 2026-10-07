const fs = require('node:fs');
const path = require('node:path');
const {randomUUID, createHash} = require('node:crypto');
const {key} = require('./products.cjs');
const {STATUS_COLUMN, STATUS_SCHEMA, DONE, nextStatus} = require('./replacement-status.cjs');

const DATABASE_ID = '3e070655a9aa816c98f4dc2c863fa5bb';
const LINK_COLUMN = 'Sản phẩm thay thế';
const NOTE_COLUMN = 'Ghi chú thay thế';
const DRIVE_FOLDER = 'https://drive.google.com/drive/u/2/folders/1yHmjfkK_41sm20X0YxpzOXxepEZMau6B';
const PLAN_TTL = 10 * 60 * 1000;
const MAX_BLOCKS = 1000;
const MAX_DEPTH = 8;
const plain = entries => (entries || []).map(item => item.plain_text ?? item.text?.content ?? '').join('');
const clone = value => JSON.parse(JSON.stringify(value));
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const rich = value => {
  const text = String(value), result = [];
  for (let offset = 0; offset < text.length; offset += 1800) result.push({type: 'text', text: {content: text.slice(offset, offset + 1800)}});
  return result.length ? result : [{type: 'text', text: {content: ''}}];
};

function error(message, code = 'REPLACEMENT_INVALID') {
  const result = Error(message); result.code = code; return result;
}
function object(value, label, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw error(label + ' phải là đối tượng JSON.');
  for (const name of Object.keys(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(name) || allowed && !allowed.includes(name)) throw error(label + ' có trường không được hỗ trợ: ' + name);
  }
  return value;
}
function text(value, label, min, max) {
  if (typeof value !== 'string' || value.length < min || value.length > max || /\u0000/.test(value)) throw error(label + ' không hợp lệ (' + min + '–' + max + ' ký tự).');
  return value;
}
function id(value, label) {
  if (typeof value !== 'string' || !/^\d{1,30}$/.test(value)) throw error(label + ' phải là ID số dạng chuỗi.');
  return value;
}
function https(value, label) {
  text(value, label, 1, 3000); let url;
  try { url = new URL(value); } catch { throw error(label + ' phải là link HTTPS.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443') throw error(label + ' phải là link HTTPS không chứa tài khoản.');
  return value;
}
function articleId(value) {
  https(value, 'Link bài viết Notion'); const url = new URL(value);
  if (!['notion.so', 'www.notion.so', 'app.notion.com', 'www.notion.com'].includes(url.hostname.toLowerCase())) throw error('Sản phẩm thay thế phải là link bài viết Notion.');
  const found = url.pathname.match(/(?:^|[/-])([a-f\d]{32}|[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12})(?:$|\/)/i);
  if (!found) throw error('Link bài viết Notion thiếu ID trang.');
  return found[1].replace(/-/g, '').toLowerCase();
}
function validateArticle(input, target) {
  object(input, 'Bài viết', ['schemaVersion', 'target', 'product', 'images', 'imageFolder', 'approved']);
  if (input.schemaVersion !== 1) throw error('Bài viết phải có schemaVersion: 1.');
  const identity = object(input.target, 'target', ['shop', 'productId', 'name']);
  text(identity.shop, 'Tên shop nguồn', 1, 120); id(identity.productId, 'ID sản phẩm nguồn'); text(identity.name, 'Tên sản phẩm nguồn', 1, 500);
  if (target && ['shop', 'productId', 'name'].some(field => identity[field] !== target[field])) throw error('Bài viết không khớp tuyệt đối tên shop, ID và tên sản phẩm nguồn.');
  const product = object(input.product, 'product', ['name', 'description', 'category', 'fields', 'variants']);
  text(product.name, 'Tên sản phẩm mới', 1, 120); text(product.description, 'Mô tả mới', 1, 10000); text(product.category, 'Ngành hàng', 1, 500);
  const fields = object(product.fields, 'Các thuộc tính');
  if (Object.keys(fields).length > 100) throw error('Bài viết có quá nhiều thuộc tính sản phẩm.');
  for (const [label, value] of Object.entries(fields)) {
    text(label, 'Tên thuộc tính', 1, 200);
    if (typeof value === 'string') text(value, 'Giá trị ' + label, 0, 4000);
    else if (typeof value === 'number') { if (!Number.isFinite(value) || Math.abs(value) > 1e12) throw error('Giá trị ' + label + ' không hợp lệ.'); }
    else if (typeof value !== 'boolean' && !(Array.isArray(value) && value.length <= 50 && value.every(item => typeof item === 'string' && item.length <= 400))) throw error('Giá trị ' + label + ' không được hỗ trợ.');
  }
  if (!Array.isArray(product.variants) || !product.variants.length || product.variants.length > 100) throw error('Cần khai báo từ 1 đến 100 phân loại sản phẩm.');
  const models = new Set();
  for (const variant of product.variants) {
    object(variant, 'Phân loại', ['modelId', 'name', 'price', 'stock']); id(variant.modelId, 'Model ID'); text(variant.name, 'Tên phân loại', 0, 200);
    if (models.has(variant.modelId)) throw error('Model ID trong bài viết bị trùng.'); models.add(variant.modelId);
    if (!Number.isSafeInteger(variant.price) || variant.price < 1 || variant.price > 1e10 || !Number.isSafeInteger(variant.stock) || variant.stock < 0 || variant.stock > 999999) throw error('Giá hoặc tồn kho phân loại không hợp lệ.');
  }
  if (!Array.isArray(input.images) || input.images.length > 9) throw error('Ảnh phải là danh sách tối đa 9 link ảnh.');
  if (!input.images.length) throw error('Cần link từng ảnh trong images; link thư mục Drive chỉ là nguồn tham khảo, không thể tải ảnh thay thế.');
  const imageKeys = new Set();
  for (const value of input.images) {
    https(value, 'Ảnh sản phẩm'); const url = new URL(value);
    if (url.hostname === 'drive.google.com' && /\/folders\//.test(url.pathname)) throw error('images cần link từng file ảnh; không dùng link thư mục Drive.');
    if (imageKeys.has(value)) throw error('Link ảnh sản phẩm bị trùng.'); imageKeys.add(value);
  }
  if (input.imageFolder !== undefined) https(input.imageFolder, 'Thư mục ảnh nguồn');
  if (input.approved !== undefined && typeof input.approved !== 'boolean') throw error('approved phải là true hoặc false.');
  return clone(input);
}

class ReplacementManager {
  constructor(dir, products, integrations, editor, images, publisher) {
    this.dir = path.join(dir, 'replacements'); fs.mkdirSync(this.dir, {recursive: true});
    this.file = path.join(this.dir, 'state.json'); this.products = products; this.i = integrations; this.editor = editor; this.images = images;
    this.publisher=publisher;
    this.busy = false; this.progress = '';
    this.data = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : {version: 1, databaseId: '', links: {}, templates: {}, plans: []};
    if (!this.data || typeof this.data !== 'object') this.data = {version: 1, databaseId: '', links: {}, templates: {}, plans: []};
    if (!Array.isArray(this.data.plans)) this.data.plans = [];
    if (!this.data.links || typeof this.data.links !== 'object') this.data.links = {};
    if (!this.data.templates || typeof this.data.templates !== 'object') this.data.templates = {};
    for (const plan of this.data.plans) if (plan.status === 'running') {
      plan.status = 'uncertain'; plan.error = 'App đã đóng giữa lượt thay thế. Kiểm tra Shopee; tool không tự gửi lại.';
    }
    this.save();
  }
  save() {
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.data, null, 2), {mode: 0o600}); fs.renameSync(this.file + '.tmp', this.file);
  }
  publicPlan(plan) {
    return {
      id: plan.id, status: plan.status, productId: plan.rowId, target: clone(plan.target), createdAt: plan.createdAt, expiresAt: plan.expiresAt,
      expired: Date.now() > plan.expiresAt, submittedAt: plan.submittedAt, verifiedAt: plan.verifiedAt,
      articleUrl: plan.articleUrl, article: clone(plan.article), diff: clone(plan.diff), schema: clone(plan.schema),
      images: (plan.assets?.images || []).map(({path: ignoredPath, ...item}) => item),
      error: plan.error, notionPending: !!plan.notionPending, notionError: plan.notionError,
    };
  }
  snapshot() {
    if (!Array.isArray(this.data.plans)) this.data.plans = [];
    const rows = Array.isArray(this.products?.data?.rows) ? this.products.data.rows : [];
    return {busy: this.busy, progress: this.progress, databaseId: this.data.databaseId,
      rows: rows.map(row => ({id: row.id, shop: row.shop, name: row.name, productId: row.productId, modelId: row.modelId, profileId: row.profileId,
        replacementUrl: row.replacementUrl || this.data.links[key(row)]?.url || '', replacementStatus: row.replacementStatus || ''})), plans: this.data.plans.slice(0, 40).map(plan => this.publicPlan(plan))};
  }
  async task(work) {
    if (this.busy) throw error('Đang xử lý sản phẩm thay thế. Hãy chờ tác vụ hiện tại.', 'REPLACEMENT_BUSY');
    this.busy = true;
    try { return await work(); } finally { this.busy = false; }
  }
  resolve(rowId) {
    const row = this.products.data.rows.find(item => item.id === rowId);
    if (!row) throw error('Không tìm thấy sản phẩm nguồn. Tải lại dữ liệu Notion.');
    if (!row.profileId || this.products.data.shops[row.profileId]?.name !== row.shop) {
      const pid = Object.keys(this.products.data.shops || {}).find(id => this.products.data.shops[id]?.name === row.shop);
      if (pid) {
        row.profileId = pid;
      } else {
        const p = this.products.store?.data?.profiles?.find(p => {
          const pNorm = (p.name || '').toLowerCase().trim(), sNorm = (row.shop || '').toLowerCase().trim();
          return pNorm === sNorm || pNorm.startsWith(sNorm) || pNorm.includes(sNorm) || sNorm.includes(pNorm);
        });
        if (p) {
          row.profileId = p.id;
          if (!this.products.data.shops) this.products.data.shops = {};
          this.products.data.shops[p.id] = {name: row.shop, scannedAt: new Date().toISOString(), total: null, models: 0};
        }
      }
    }
    if (!row.profileId || this.products.data.shops[row.profileId]?.name !== row.shop) throw error('Sản phẩm chưa liên kết đúng profile Shopee.');
    this.products.store?.profile(row.profileId);
    return row;
  }
  target(row) { return {shop: row.shop, productId: row.productId, name: row.name, profileId: row.profileId, modelId: row.modelId, variant: row.variant}; }
  async ensureColumn() {
    const databaseId = this.products.data.databaseId || this.data.databaseId || DATABASE_ID;
    const database = await this.i.notion('databases/' + databaseId), property = database.properties?.[LINK_COLUMN];
    if (property && property.type !== 'url') throw error('Cột ' + LINK_COLUMN + ' phải có kiểu URL. Tool giữ nguyên cột hiện có.');
    const status = database.properties?.[STATUS_COLUMN], patch = {};
    if (status && status.type !== 'select') throw error('Cột ' + STATUS_COLUMN + ' phải có kiểu Select. Tool giữ nguyên cột hiện có.');
    if (!property) patch[LINK_COLUMN] = {url: {}};
    if (!status) patch[STATUS_COLUMN] = STATUS_SCHEMA;
    else {
      const options = status.select?.options || [], missing = STATUS_SCHEMA.select.options.filter(option => !options.some(existing => existing.name === option.name));
      if (missing.length) patch[STATUS_COLUMN] = {select: {options: [...options, ...missing]}};
    }
    if (Object.keys(patch).length) await this.i.notion('databases/' + databaseId, 'PATCH', {properties: patch});
    this.data.databaseId = database.id || databaseId; this.products.data.databaseId = this.data.databaseId; this.products.save(); this.save();
    return this.data.databaseId;
  }
  async linkSourceRow(row, url) {
    if (!row.notionPageId) throw error('Sản phẩm chưa có dòng Notion.');
    if (url) articleId(url);
    const remote = await this.i.notion('pages/' + row.notionPageId), parsed = this.products.parse(remote);
    if (remote.archived || remote.in_trash || key(parsed) !== key(row) || parsed.name !== row.name) throw error('Dòng sản phẩm Notion đã thay đổi. Không ghi link hoặc trạng thái.');
    const previous = remote.properties?.[LINK_COLUMN]?.url || '', current = remote.properties?.[STATUS_COLUMN]?.select?.name || null;
    const sameArticle = previous === url || !!previous && !!url && articleId(previous) === articleId(url);
    const status = nextStatus(current, sameArticle, !!url), properties = {};
    if (previous !== url) properties[LINK_COLUMN] = {url: url || null};
    if (current !== status) properties[STATUS_COLUMN] = {select: status ? {name: status} : null};
    if (Object.keys(properties).length) await this.i.notion('pages/' + row.notionPageId, 'PATCH', {properties});
    const after = Object.keys(properties).length ? await this.i.notion('pages/' + row.notionPageId) : remote;
    if ((after.properties?.[LINK_COLUMN]?.url || '') !== url || (after.properties?.[STATUS_COLUMN]?.select?.name || null) !== status) throw error('Chưa xác minh link hoặc trạng thái thay thế trên Notion.');
    row.replacementUrl = url; row.replacementStatus = status || '';
    this.data.links[key(row)] = {url, notionPageId: row.notionPageId};
    this.products.save(); this.save();
  }
  async loadLinks() {
    return this.task(async () => {
      const databaseId = await this.ensureColumn(), pages = await this.i.listPages(databaseId), seen = new Set(), updates = [];
      if (typeof this.products.scanner?.shop === 'function') {
        const wanted = new Set(pages.filter(page => !page.archived && !page.in_trash).map(page => plain(page.properties?.['Tên shop']?.rich_text)));
        const known = new Set(Object.values(this.products.data.shops).map(shop => shop.name));
        for (const profile of this.products.store.data.profiles.filter(profile => profile.enabled)) {
          if (this.products.data.shops[profile.id]?.name) continue;
          try {
            const name = await this.products.scanner.shop(profile.id);
            if (wanted.has(name) && !known.has(name)) {
              this.products.data.shops[profile.id] = {name, scannedAt: new Date().toISOString(), total: null, models: 0}; known.add(name);
            }
          } catch {}
        }
      }
      for (const page of pages) {
        if (page.archived || page.in_trash) continue;
        if (!plain(page.properties?.['ID sản phẩm']?.rich_text) && !plain(page.properties?.['Model ID']?.rich_text)) continue;
        const parsed = this.products.parse(page), identity = key(parsed);
        if (seen.has(identity)) throw error('Notion có dòng trùng shop + ID sản phẩm + Model ID. Không liên kết.'); seen.add(identity);
        const url = page.properties?.[LINK_COLUMN]?.url || ''; if (url) articleId(url);
        const old = this.products.data.rows.find(row => key(row) === identity);
        const profileId = old?.profileId || Object.keys(this.products.data.shops).find(profile => this.products.data.shops[profile].name === parsed.shop) || null;
        updates.push({identity, url, profileId, parsed, row: old || {...parsed, id: randomUUID(), profileId, sync: 'synced', active: true, source: 'Notion'}, notionPageId: page.id});
      }
      for (const update of updates) {
        if (!this.products.data.rows.includes(update.row)) this.products.data.rows.push(update.row);
        update.row.profileId = update.profileId; update.row.replacementUrl = update.url; update.row.notionPageId = update.notionPageId;
        const status = nextStatus(update.parsed.replacementStatus, true, !!update.url);
        if ((update.parsed.replacementStatus || null) !== status && update.row.name === update.parsed.name) await this.linkSourceRow(update.row, update.url);
        else update.row.replacementStatus = update.parsed.replacementStatus;
        this.data.links[update.identity] = {url: update.url, notionPageId: update.notionPageId};
      }
      this.data.loadedAt = new Date().toISOString(); this.progress = 'Đã đọc ' + updates.length + ' dòng sản phẩm thay thế'; this.products.save(); this.save();
      return this.snapshot();
    });
  }
  async readArticle(url) {
    const pageId = articleId(url), page = await this.i.notion('pages/' + pageId);
    if (page.archived || page.in_trash) throw error('Bài viết sản phẩm thay thế đã bị xoá.');
    const blocks = [], visited = new Set();
    const visit = async (blockId, depth) => {
      if (depth > MAX_DEPTH) throw error('Bài viết lồng quá nhiều cấp. Đặt JSON ở đầu bài viết.');
      if (visited.has(blockId)) throw error('Cấu trúc bài viết Notion bị lặp.'); visited.add(blockId);
      let cursor; const cursors = new Set();
      do {
        const result = await this.i.notion('blocks/' + blockId + '/children?page_size=100' + (cursor ? '&start_cursor=' + encodeURIComponent(cursor) : ''));
        if (!Array.isArray(result.results)) throw error('Notion trả dữ liệu bài viết không hợp lệ.');
        for (const block of result.results) {
          blocks.push(block); if (blocks.length > MAX_BLOCKS) throw error('Bài viết quá lớn. Giới hạn 1.000 khối.');
          if (block.has_children && !['child_page', 'child_database'].includes(block.type)) await visit(block.id, depth + 1);
        }
        cursor = result.has_more ? result.next_cursor : null;
        if (result.has_more && !cursor || cursor && cursors.has(cursor)) throw error('Notion trả phân trang bài viết không hợp lệ.');
        if (cursor) cursors.add(cursor);
      } while (cursor);
    };
    await visit(pageId, 0);
    const candidates = [];
    for (const block of blocks) if (block.type === 'code' && block.code?.language === 'json') {
      const content = plain(block.code.rich_text); if (content.length > 100000) throw error('JSON sản phẩm thay thế quá lớn.');
      let value; try { value = JSON.parse(content); } catch { throw error('Khối JSON trong bài viết sai định dạng.'); }
      if (value?.schemaVersion === 1) candidates.push(value);
    }
    if (candidates.length !== 1) throw error('Bài viết cần đúng một khối code JSON có schemaVersion: 1.');
    return candidates[0];
  }
  makeTemplate(row, schema) {
    if (['shop', 'productId', 'name'].some(field => schema[field] !== row[field])) throw error('Form Shopee không khớp sản phẩm nguồn.');
    const fields = {};
    for (const field of schema.fields || []) if (field.label && !['images','variants','unsupported'].includes(field.kind) && !['Tên sản phẩm', 'Mô tả sản phẩm', 'Ngành hàng'].includes(field.label)) {
      if (['__proto__', 'constructor', 'prototype'].includes(field.label)) throw error('Tên thuộc tính form không hợp lệ.');
      fields[field.label] = field.value ?? '';
    }
    return {schemaVersion: 1, target: {shop: row.shop, productId: row.productId, name: row.name},
      product: {name: schema.name, description: schema.description || '', category: schema.category || '', fields, variants: clone(schema.variants || [])},
      images: (schema.images || []).map(image => typeof image === 'string' ? image : image.url).filter(Boolean), imageFolder: DRIVE_FOLDER, approved: false};
  }
  async templateCode(pageId) {
    const blocks = [], seen = new Set(); let cursor;
    do {
      const response = await this.i.notion('blocks/' + pageId + '/children?page_size=100' + (cursor ? '&start_cursor=' + encodeURIComponent(cursor) : ''));
      if (!Array.isArray(response.results)) throw error('Notion trả khối mẫu không hợp lệ.');
      blocks.push(...response.results); if (blocks.length > MAX_BLOCKS) throw error('Bài viết mẫu quá lớn.');
      cursor = response.has_more ? response.next_cursor : null;
      if (response.has_more && !cursor || cursor && seen.has(cursor)) throw error('Notion trả phân trang mẫu không hợp lệ.');
      if (cursor) seen.add(cursor);
    } while (cursor);
    const matches = [];
    for (const block of blocks) if (!block.archived && !block.in_trash && block.type === 'code' && block.code?.language === 'json') {
      let article;
      try { article = JSON.parse(plain(block.code.rich_text)); } catch { throw error('JSON mẫu đã được sửa nhưng chưa đúng định dạng.'); }
      if (article?.schemaVersion === 1) matches.push({id: block.id, article});
    }
    if (matches.length !== 1) throw error('Không tìm thấy khối JSON mẫu duy nhất để gắn ảnh đã nén.');
    return matches[0];
  }
  async finishTemplateImages(record, row) {
    if (!this.publisher || record.imagesReady) return record.article;
    const pageId = articleId(record.url);
    const check = code => {
      if (['shop', 'productId', 'name'].some(field => code.article.target?.[field] !== row[field])) throw error('JSON mẫu không còn khớp sản phẩm nguồn. Không sửa bài viết.');
      if (!Array.isArray(code.article.images) || !code.article.images.length || code.article.images.length > 9) throw error('Mẫu cần từ 1 đến 9 link ảnh sản phẩm.');
      const source = record.sourceImages || record.article?.images || code.article.images;
      if (JSON.stringify(code.article.images) !== JSON.stringify(source) && JSON.stringify(code.article.images) !== JSON.stringify(record.imageUrls)) throw error('Ảnh trong JSON đã được sửa. Tool giữ nguyên bài viết; kiểm tra mẫu trước khi thử tiếp.');
      return source;
    };
    if (record.imageAttachAttempted === undefined) record.imageAttachAttempted = record.status === 'processing-images';
    let code = await this.templateCode(pageId);
    record.sourceImages = clone(check(code)); record.status = 'processing-images'; this.save();
    if (!record.assets) {
      const sources = await require('./replacement-notion-images.cjs').resolveImages(this.i, record.sourceImages);
      record.assets = await this.images.prepareImages(sources, this.dir, 'template-' + randomUUID()); this.save();
    }
    if (!record.imageUrls) {
      const imageUrls = await this.publisher.attachImages(this.i, record.url, record.assets, {reconcileOnly: !!record.imageAttachAttempted, beforeAppend: () => {
        record.imageAttachAttempted = true; this.save();
      }});
      if (!Array.isArray(imageUrls) || imageUrls.length !== record.sourceImages.length || new Set(imageUrls).size !== imageUrls.length) throw error('Chưa xác minh đủ link ảnh đã nén trong mẫu.');
      for (const url of imageUrls) {
        if (articleId(url) !== pageId || !/^[a-f\d]{32}$/i.test(new URL(url).hash.slice(1).replace(/-/g, ''))) throw error('Link ảnh đã nén không thuộc bài viết mẫu.');
      }
      record.imageUrls = imageUrls;
      this.save();
    }
    // Keep human edits made while uploads were in progress. Only replace the
    // original image sources after re-reading the current JSON from Notion.
    code = await this.templateCode(pageId); check(code);
    const article = {...code.article, images: clone(record.imageUrls)};
    if (JSON.stringify(code.article.images) !== JSON.stringify(record.imageUrls)) await this.i.notion('blocks/' + code.id, 'PATCH', {code: {language: 'json', rich_text: rich(JSON.stringify(article, null, 2))}});
    record.article = article; record.imagesReady = true; record.status = 'created'; delete record.error; this.save(); return article;
  }
  async linkTemplate(record, row) {
    const remote = await this.i.notion('pages/' + row.notionPageId), parsed = this.products.parse(remote);
    if (remote.archived || remote.in_trash) throw error('Dòng sản phẩm Notion đã bị xoá. Tải lại dữ liệu Notion trước khi tạo bài mẫu.');
    if (key(parsed) !== key(row) || parsed.name !== row.name) throw error('Dòng Notion đã thay đổi trong lúc tạo mẫu. Chưa gắn link.');
    const current = remote.properties?.[LINK_COLUMN]?.url;
    if (current && current !== record.url) throw error('Cột Sản phẩm thay thế đã có bài viết khác. Tool giữ nguyên link.');
    await this.linkSourceRow(row, record.url);
  }
  async createTemplate(rowId, suppliedSchema) {
    return this.task(async () => {
      const row = this.resolve(rowId); await this.ensureColumn();
      if (!row.notionPageId) throw error('Sản phẩm chưa có dòng Notion. Đồng bộ sản phẩm trước.');
      const remote = await this.i.notion('pages/' + row.notionPageId), parsed = this.products.parse(remote);
      if (remote.archived || remote.in_trash) throw error('Dòng sản phẩm Notion đã bị xoá. Tải lại dữ liệu Notion trước khi tạo bài mẫu.');
      if (key(parsed) !== key(row) || parsed.name !== row.name) throw error('Dòng Notion không khớp sản phẩm nguồn.');
      const targetKey = [row.shop, row.productId].join('|'), previous = this.data.templates[targetKey];
      const existing = remote.properties?.[LINK_COLUMN]?.url || row.replacementUrl || this.data.links[key(row)]?.url;
      if (existing && (!previous?.url || articleId(existing) !== articleId(previous.url))) {
        articleId(existing); await this.linkSourceRow(row, existing); return {url: existing, existing: true};
      }
      if (previous && !previous.url && (previous.creationAttempted || previous.status === 'creating')) throw error('Lượt tạo bài viết trước chưa xác minh. Kiểm tra trang Notion; không tự tạo trùng.');
      if (previous?.url) {
        try {
          const article = await this.finishTemplateImages(previous, row); await this.linkTemplate(previous, row);
          return {url: previous.url, existing: true, imagesReady: !!previous.imagesReady, article};
        } catch (failure) { previous.error = failure.message; this.save(); throw failure; }
      }
      const schema = suppliedSchema || await this.editor.inspect(this.target(row)), article = this.makeTemplate(row, schema);
      const note = 'Mẫu lấy từ dữ liệu Shopee hiện có. Sửa JSON theo thông tin sản phẩm thật; images dùng link từng ảnh. ' + (this.publisher ? 'Ảnh đính kèm được nén dưới 1,9 MB trước khi gắn link. ' : 'Tool nén ảnh tại máy trước khi tải lên Shopee. ') + 'Thư mục Drive là nguồn tham khảo; chỉ dùng ảnh đúng sản phẩm. Chạy từ bản xem trước trong tool để áp dụng.';
      const required = (schema.fields || []).filter(field => field.required).map(field => field.label).join(', ');
      const record = {status: 'preparing', at: new Date().toISOString(), rowId, article: clone(article), sourceImages: clone(article.images), imagesReady: false, imageAttachAttempted: false}; this.data.templates[targetKey] = record; this.save();
      try {
        if (this.publisher) {
          const sources = await require('./replacement-notion-images.cjs').resolveImages(this.i, article.images);
          record.assets = await this.images.prepareImages(sources, this.dir, 'template-' + randomUUID()); this.save();
        }
        record.creationAttempted = true; record.status = 'creating'; this.save();
        const page = await this.i.notion('pages', 'POST', {parent: {page_id: row.notionPageId}, properties: {title: {title: rich('Mẫu sản phẩm thay thế · ' + row.name.slice(0, 80))}}, children: [
          {object: 'block', type: 'paragraph', paragraph: {rich_text: rich(note)}},
          {object: 'block', type: 'paragraph', paragraph: {rich_text: rich('Các trường có dấu * cần điền: ' + (required || 'Xem kết quả kiểm tra form trong tool.'))}},
          {object: 'block', type: 'code', code: {language: 'json', rich_text: rich(JSON.stringify(article, null, 2))}},
        ]});
        record.url = page.url || 'https://www.notion.so/' + String(page.id).replace(/-/g, ''); articleId(record.url); record.pageId = page.id; record.status = 'created'; this.save();
        const savedArticle = await this.finishTemplateImages(record, row); await this.linkTemplate(record, row);
        return {url: record.url, existing: false, imagesReady: !!record.imagesReady, article: savedArticle || article};
      } catch (failure) { record.error = failure.message; this.save(); throw failure; }
    });
  }
  async prepare(rowId, url, {preserveStock = false} = {}) {
    return this.task(async () => {
      const row = this.resolve(rowId), target = this.target(row);
      if (this.data.plans.some(plan => plan.target.shop === target.shop && plan.target.productId === target.productId && ['running', 'uncertain'].includes(plan.status))) throw error('Sản phẩm có lượt thay thế chưa xác minh. Kiểm tra Shopee trước khi chuẩn bị lượt mới.');
      const articleUrl = url || row.replacementUrl || this.data.links[key(row)]?.url;
      if (!articleUrl) throw error('Chưa có link bài viết ở cột Sản phẩm thay thế.');
      this.progress = 'Đang đọc bài viết và kiểm tra form Shopee';
      const article = validateArticle(await this.readArticle(articleUrl), target), schema = await this.editor.inspect(target);
      if (['shop', 'productId', 'name'].some(field => schema[field] !== target[field])) throw error('Form Shopee không khớp sản phẩm nguồn.');
      if (preserveStock) {
        // Studio changes copy, price and images; keep stock sold since drafting.
        for (const variant of article.product.variants) {
          const current = schema.variants.find(item => item.modelId === variant.modelId);
          if (!current || !Number.isSafeInteger(current.stock) || current.stock < 0) throw error('Chưa đọc được tồn kho mới nhất để giữ nguyên.');
          variant.stock = current.stock;
        }
        if (Object.hasOwn(article.product.fields, 'Kho hàng')) article.product.fields['Kho hàng'] = schema.fields.find(field => field.label === 'Kho hàng')?.value ?? article.product.variants[0]?.stock;
      }
      const diff = await this.editor.validate(schema, article.product), planId = randomUUID();
      this.progress = 'Đang nén và kiểm tra ảnh';
      const sources=await require('./replacement-notion-images.cjs').resolveImages(this.i,article.images);
      const assets = await this.images.prepareImages(sources, this.dir, planId);
      if (!assets || !Array.isArray(assets.images) || assets.images.length !== article.images.length) throw error('Kết quả chuẩn bị ảnh không đầy đủ.');
      for (const asset of assets.images) {
        if (!asset.path || !fs.existsSync(asset.path)) throw error('Ảnh đã chuẩn bị không tồn tại.');
        const hash = createHash('sha256').update(fs.readFileSync(asset.path)).digest('hex');
        if (asset.hash && asset.hash !== hash) throw error('Ảnh đã chuẩn bị không khớp mã kiểm tra.'); asset.hash = hash;
      }
      const plan = {id: planId, rowId, target, articleUrl, article, schema: clone(schema), diff: clone(diff ?? []), assets,
        status: 'prepared', createdAt: new Date().toISOString(), expiresAt: Date.now() + PLAN_TTL};
      plan.digest = this.planDigest(plan);
      if (!Array.isArray(this.data.plans)) this.data.plans = [];
      this.data.plans.unshift(plan);
      this.data.plans = this.data.plans.filter((item, index) => index < 100 || ['running', 'uncertain'].includes(item.status));
      this.progress = 'Đã chuẩn bị bản xem trước; chưa lưu thay đổi lên Shopee'; this.save(); return this.publicPlan(plan);
    });
  }
  planDigest(plan) { return digest({target: plan.target, article: plan.article, schema: plan.schema, assets: plan.assets}); }
  verifyAssets(plan) {
    if (this.planDigest(plan) !== plan.digest) throw error('Kế hoạch đã bị thay đổi. Chuẩn bị lại bản xem trước.');
    for (const asset of plan.assets.images) {
      const relative = path.relative(this.dir, fs.realpathSync(asset.path));
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw error('Ảnh chuẩn bị nằm ngoài dữ liệu ứng dụng.');
      if (createHash('sha256').update(fs.readFileSync(asset.path)).digest('hex') !== asset.hash) throw error('Ảnh đã thay đổi sau bản xem trước. Chuẩn bị lại.');
    }
  }
  async run(planId) {
    return this.task(async () => {
      const plan = this.data.plans.find(item => item.id === planId);
      if (!plan) throw error('Không tìm thấy kế hoạch thay thế.');
      if (plan.status !== 'prepared') throw error('Kế hoạch đã chạy hoặc chưa xác minh. Không tự gửi lại.');
      if (Date.now() > plan.expiresAt) { plan.status = 'failed'; plan.error = 'Bản xem trước đã hết hạn 10 phút. Chuẩn bị lại.'; this.save(); throw error(plan.error); }
      const row = this.resolve(plan.rowId);
      if (['shop', 'productId', 'name', 'profileId', 'modelId', 'variant'].some(field => row[field] !== plan.target[field])) throw error('Sản phẩm hoặc profile đã thay đổi sau bản xem trước.');
      if (this.data.plans.some(other => other.id !== plan.id && other.target.shop === plan.target.shop && other.target.productId === plan.target.productId && ['running', 'uncertain'].includes(other.status))) throw error('Sản phẩm có lượt thay thế chưa xác minh. Không chạy bản xem trước khác.');
      this.verifyAssets(plan);
      const sourceRows = this.products.data.rows.filter(item => item.shop === row.shop && item.productId === row.productId);
      for (const source of sourceRows) {
        const remote = await this.i.notion('pages/' + source.notionPageId), parsed = this.products.parse(remote), link = remote.properties?.[LINK_COLUMN]?.url;
        const expectedLink = source.replacementUrl || this.data.links[key(source)]?.url || plan.articleUrl;
        if (remote.archived || remote.in_trash || key(parsed) !== key(source) || parsed.name !== source.name || link && articleId(link) !== articleId(expectedLink)) throw error('Link bài hoặc sản phẩm Notion đã đổi sau bản xem trước. Chuẩn bị lại trước khi chạy.');
      }
      await this.ensureColumn();
      for (const source of sourceRows) await this.linkSourceRow(source, plan.articleUrl);
      plan.status = 'running'; plan.startedAt = new Date().toISOString(); this.save();
      this.progress = 'Đang điền và lưu sản phẩm thay thế lên Shopee';
      try {
        const result = await this.editor.apply(plan.target, plan.article, plan.assets, {baseline: clone(plan.schema), beforeSubmit: () => {
          if (plan.submittedAt) throw error('Kế hoạch đã gửi cập nhật. Không gửi lần hai.');
          this.verifyAssets(plan); plan.submittedAt = new Date().toISOString(); this.save();
        }});
        if (!plan.submittedAt) throw error('Bộ sửa chưa xác nhận đã gửi và kiểm tra Shopee.');
        const verified = result?.schema;
        if (!verified || verified.shop !== plan.target.shop || verified.productId !== plan.target.productId || verified.name !== plan.article.product.name) throw error('Chưa xác minh đúng sản phẩm sau khi lưu.');
        const variants = verified.variants;
        if (!Array.isArray(variants) || plan.article.product.variants.some(wanted => {
          const actual = variants.find(item => item.modelId === wanted.modelId); return !actual || actual.price !== wanted.price || actual.stock !== wanted.stock || actual.name !== wanted.name;
        })) throw error('Giá hoặc kho đọc lại chưa khớp bản xem trước.');
        const targetRows = this.products.data.rows.filter(item => item.shop === plan.target.shop && item.productId === plan.target.productId);
        if (targetRows.some(item => !variants.some(variant => variant.modelId === item.modelId))) throw error('Phân loại đọc lại không khớp sản phẩm local.');
        const scannedAt = new Date().toISOString();
        for (const current of targetRows) {
          const variant = variants.find(item => item.modelId === current.modelId);
          Object.assign(current, {name: verified.name, variant: variant.name, price: variant.price, stock: variant.stock, scannedAt, sync: 'pending', source: 'Shopee'});
        }
        plan.status = 'verified'; plan.verifiedAt = scannedAt; plan.result = {name: verified.name}; this.products.save(); this.save();
        try { await this.syncPlanNotion(plan, targetRows); }
        catch (failure) { plan.notionPending = true; plan.notionError = failure.message; this.save(); }
        this.progress = plan.notionPending ? 'Shopee đã xác minh; Notion còn chờ đồng bộ' : 'Đã xác minh Shopee và đồng bộ Notion';
        return this.publicPlan(plan);
      } catch (failure) {
        plan.status = plan.submittedAt || failure.submitted || failure.uncertain ? 'uncertain' : 'failed'; plan.error = failure.message; this.save(); throw failure;
      }
    });
  }
  async syncPlanNotion(plan, rows) {
    if (plan.status !== 'verified' || !plan.verifiedAt) throw error('Chưa xác minh Shopee. Không đánh dấu đã thay thế.');
    await this.ensureColumn();
    const oldName = plan.target?.name || 'Sản phẩm cũ';
    const timeFormatted = new Date().toLocaleString('vi-VN', {hour12: false});
    const noteContent = `Sửa từ: ${oldName} lúc ${timeFormatted}`;
    for (const row of rows) {
      await this.products.sync(() => {}, row.id);
      const remote = await this.i.notion('pages/' + row.notionPageId), parsed = this.products.parse(remote);
      const link = remote.properties?.[LINK_COLUMN]?.url;
      if (remote.archived || remote.in_trash || key(parsed) !== key(row) || parsed.name !== row.name || !link || articleId(link) !== articleId(plan.articleUrl)) throw error('Dòng Notion không còn khớp bài Shopee đã thay thế. Giữ trạng thái để kiểm tra.');
      const updateProps = {
        [STATUS_COLUMN]: {select: {name: DONE}},
        [NOTE_COLUMN]: {rich_text: rich(noteContent)}
      };
      await this.i.notion('pages/' + row.notionPageId, 'PATCH', {properties: updateProps});
      const after = await this.i.notion('pages/' + row.notionPageId);
      if (after.properties?.[STATUS_COLUMN]?.select?.name !== DONE || articleId(after.properties?.[LINK_COLUMN]?.url || '') !== articleId(plan.articleUrl)) throw error('Chưa xác minh trạng thái đã thay thế trên Notion.');
      row.replacementStatus = DONE; row.replacementUrl = link;
    }
    plan.notionPending = false; delete plan.notionError; this.products.save(); this.save();
  }
  async syncPending() {
    const pending = this.data.plans.filter(plan => plan.status === 'verified' && plan.notionPending);
    for (const plan of pending) {
      const rows = this.products.data.rows.filter(row => row.shop === plan.target.shop && row.productId === plan.target.productId);
      if (!rows.length) throw error('Không tìm thấy sản phẩm chờ đồng bộ trạng thái.');
      try { await this.syncPlanNotion(plan, rows); }
      catch (failure) { plan.notionError = failure.message; this.save(); throw failure; }
    }
  }
}

module.exports = {ReplacementManager, validateArticle, articleId, DATABASE_ID, LINK_COLUMN, DRIVE_FOLDER, PLAN_TTL};
