const fs = require('node:fs');
const path = require('node:path');
const {randomUUID, createHash} = require('node:crypto');
const {key} = require('./products.cjs');
const {articleId, validateArticle, LINK_COLUMN} = require('./replacements.cjs');
const {ROOT_URL} = require('./studio-drive.cjs');

const PARENT_ID = '3e070655a9aa80d68197fb688ad8e289';
const DEFAULT_REPLACEMENT_DATABASE_ID = '3ec70655a9aa817099c5d877cdb5daa9';
const TABLE_NAME = 'Sản phẩm thay thế';
const SCHEMA = {
  'Tên sản phẩm': {title: {}}, 'Tên shop': {rich_text: {}},
  'Sản phẩm gốc': {rich_text: {}}, 'Sản phẩm nguồn': {rich_text: {}},
  'ID sản phẩm': {rich_text: {}}, 'Model ID': {rich_text: {}},
  'Giá bán': {number: {format: 'number'}},
  'Trạng thái': {select: {options: [
    {name: 'Chưa có', color: 'gray'}, {name: 'Đã có', color: 'blue'},
    {name: 'Bài đã duyệt', color: 'yellow'}, {name: 'Đủ bài và ảnh', color: 'green'},
    {name: 'Đã thay thế', color: 'pink'},
  ]}}, 'Mã tác vụ': {rich_text: {}}, 'Thư mục ảnh': {url: {}},
};
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const plain = entries => (entries || []).map(item => item.plain_text ?? item.text?.content ?? '').join('');
const rich = value => {
  const content = String(value), entries = [];
  for (let index = 0; index < content.length; index += 1800) entries.push({type: 'text', text: {content: content.slice(index, index + 1800)}});
  return entries.length ? entries : [{type: 'text', text: {content: ''}}];
};
const paragraph = value => ({object: 'block', type: 'paragraph', paragraph: {rich_text: rich(value)}});
const identity = value => JSON.stringify([value.shop, value.productId]);
const textOnly = article => article?.product && ['category', 'fields', 'variants'].every(field => !Object.hasOwn(article.product, field));
function fail(message, code = 'STUDIO_INVALID') {const error = Error(message); error.code = code; return error;}
function shortText(value, label, maximum = 120, minimum = 1) {
  if (typeof value !== 'string' || value.trim().length < minimum || value.length > maximum || value.includes('\0')) throw fail(label + ' không hợp lệ.');
  return value.trim();
}
function price(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1000000000) throw fail('Giá bán phải là số nguyên từ 1 đến 1.000.000.000.');
  return value;
}
function cleanError(value) {
  return String(value || 'Không xác định').replace(/\b(?:(?:ntn_|secret_|AIza)[A-Za-z0-9_-]+|AQ\.[A-Za-z0-9._~-]{16,})/g, '[đã ẩn]').replace(/Bearer\s+\S+/gi, 'Bearer [đã ẩn]').slice(0, 1500);
}
function pageUrl(page) {return page.url || 'https://www.notion.so/' + String(page.id).replace(/-/g, '');}

class ReplacementStudio {
  constructor(dir, {products, replacements, integrations, gemini, chatgpt, drive, onChange = () => {}}) {
    this.dir = path.join(dir, 'replacement-studio'); fs.mkdirSync(this.dir, {recursive: true});
    this.file = path.join(this.dir, 'state.json');
    Object.assign(this, {products, replacements, i: integrations, gemini, chatgpt, drive, onChange});
    this.busy = false; this.progress = '';
    this.data = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : {version: 1, databaseId: '', jobs: [], logs: []};
    if (!this.data || typeof this.data !== 'object') this.data = {version: 1, databaseId: '', jobs: [], logs: []};
    if (!Array.isArray(this.data.jobs)) this.data.jobs = [];
    if (!Array.isArray(this.data.logs)) this.data.logs = [];
    for (const job of this.data.jobs) {
      if (job.status === 'generating') {job.status = 'draft'; job.error = 'App đã đóng khi viết bài. Bấm Viết lại khi cần.';}
      if (job.status === 'generating-images') {job.status = 'images-uncertain'; job.error = 'App đã đóng khi tạo ảnh. Kiểm tra cuộc trò chuyện ChatGPT; tool không tự gửi lại.';}
      if (job.status === 'copying-images') job.status = 'images-generated';
      if (job.status === 'publishing') job.status = 'publish-uncertain';
      if (job.status === 'attaching') job.status = 'attach-uncertain';
      this.syncDriveAssets(job);
    }
    this.save();
  }
  async syncDriveAssets(job) {
    if (!job || !this.drive || typeof this.drive.inspectImages !== 'function') return;
    try {
      const inspected = await this.drive.inspectImages({
        shop: job.shop,
        productId: job.productId,
        productName: job.name || job.sourceName,
        jobId: job.id,
        relativeDir: job.relativeDir
      });
      if (inspected && Array.isArray(inspected.images) && inspected.images.filter(Boolean).length > 0) {
        job.localFolder = inspected.localFolder;
        job.relativeDir = inspected.relativeDir;
        job.driveFolderUrl = ROOT_URL;
        if (!job.chromeDriveAssets) job.chromeDriveAssets = {jobId: job.id, images: []};
        inspected.images.forEach((img, idx) => {
          if (img) {
            const existing = job.chromeDriveAssets.images[idx];
            job.chromeDriveAssets.images[idx] = existing?.previewDataUrl ? {...img, previewDataUrl: existing.previewDataUrl} : img;
          }
        });
        const count = job.chromeDriveAssets.images.filter(Boolean).length;
        if (count === 5) {
          job.driveAssets = {
            folderUrl: job.driveFolderUrl,
            localFolder: inspected.localFolder,
            relativeDir: inspected.relativeDir,
            images: clone(job.chromeDriveAssets.images),
            verified: true,
            cloudVerified: false
          };
          job.status = job.imagesReady ? 'attached' : 'images-ready';
        }
      }
    } catch {}
  }
  save() {
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.data, null, 2), {mode: 0o600});
    fs.renameSync(this.file + '.tmp', this.file); this.onChange();
  }
  log(job, message, level = 'info') {
    if (!Array.isArray(this.data.logs)) this.data.logs = [];
    this.data.logs.unshift({id: randomUUID(), at: new Date().toISOString(), jobId: job?.id || null, level, message: cleanError(message)});
    this.data.logs = this.data.logs.slice(0, 250); this.progress = cleanError(message); this.save();
  }
  clearImageLogs(id = null) {
    if (!Array.isArray(this.data.logs)) this.data.logs = [];
    if (id) {
      this.data.logs = this.data.logs.filter(entry => entry.jobId !== id || !/ảnh|Drive|Chrome|ChatGPT|image|\.png|\.jpg/i.test(entry.message));
    } else {
      this.data.logs = this.data.logs.filter(entry => !/ảnh|Drive|Chrome|ChatGPT|image|\.png|\.jpg/i.test(entry.message));
    }
    this.progress = '';
    this.save();
    return {cleared: true};
  }
  clearLogs(id = null) {
    if (!Array.isArray(this.data.logs)) this.data.logs = [];
    if (id) {
      this.data.logs = this.data.logs.filter(entry => entry.jobId !== id);
    } else {
      this.data.logs = [];
    }
    this.progress = '';
    this.save();
    return {cleared: true};
  }
  publicJob(job) {
    const fields = ['id', 'rowId', 'shop', 'productId', 'modelId', 'sourceName', 'insight', 'index', 'prompt', 'price', 'name', 'description', 'status', 'notionStatus', 'isReplacementReady', 'contentApproved', 'notionUrl', 'driveFolderUrl', 'localFolder', 'relativeDir', 'imagesReady', 'imageSource', 'error', 'article', 'createdAt', 'updatedAt', 'conversationUrl', 'replacedAt'];
    const result = Object.fromEntries(fields.filter(field => job[field] !== undefined).map(field => [field, clone(job[field])]));
    result.imageFiles = (job.driveAssets?.images || job.chromeDriveAssets?.images || job.generatedAssets?.images || []).filter(Boolean).map(({filename, name, hash, bytes, width, height, previewDataUrl, index, ordinal}) => ({filename: filename || name, hash, bytes, width, height, previewDataUrl, ...(Number.isInteger(index) ? {index, ordinal: ordinal ?? index + 1} : {})}));
    result.canDeleteDraft = this.canDeleteDraft(job);
    return result;
  }
  snapshot() {
    if (!Array.isArray(this.data.jobs)) this.data.jobs = [];
    if (!Array.isArray(this.data.logs)) this.data.logs = [];
    return {busy: this.busy, progress: this.progress, databaseId: this.data.databaseId, jobs: this.data.jobs.filter(job => !job.deletedAt).map(job => this.publicJob(job)), logs: clone(this.data.logs)};
  }
  get(id) {const job = this.data.jobs.find(item => item.id === id && !item.deletedAt); if (!job) throw fail('Không tìm thấy tác vụ sản phẩm thay thế.'); this.syncDriveAssets(job); return job;}
  canDeleteDraft(job) {
    return !!job && !job.deletedAt && !this.busy && job.status !== 'publishing' && job.status !== 'generating';
  }
  deleteDraft(id) {
    if (this.busy) throw fail('Đang xử lý sản phẩm thay thế. Đợi hoàn tất trước khi xoá bản nháp.', 'STUDIO_BUSY');
    const job = this.get(id);
    if (!this.canDeleteDraft(job)) throw fail('Không thể xoá bản nháp trong khi đang bận xử lý.');
    return (async () => {
      const hadNotion = !!job.notionUrl;
      if (job.notionUrl && this.i?.notion) {
        try {
          const pageId = articleId(job.notionUrl);
          await this.i.notion('pages/' + pageId, 'PATCH', {archived: true});
        } catch {}
      }
      if (this.replacements?.data?.links && key(job)) {
        delete this.replacements.data.links[key(job)];
        if (typeof this.replacements.save === 'function') this.replacements.save();
      }
      job.deletedAt = new Date().toISOString(); job.updatedAt = job.deletedAt;
      delete job.notionUrl;
      this.log(job, 'Đã xoá bản nháp local' + (hadNotion ? ' và gỡ bài trên Notion' : '') + ': ' + job.shop + ' · ' + (job.name || job.sourceName) + '.');
      this.save();
      return {id, deleted: true};
    })();
  }
  row(job) {
    let row = this.products.data.rows.find(item => item.id === job.rowId);
    if (!row) row = this.products.data.rows.find(item => item.shop === job.shop && item.productId === job.productId && item.modelId === job.modelId);
    if (!row || row.shop !== job.shop || row.productId !== job.productId || row.modelId !== job.modelId || (row.name !== job.sourceName && row.name !== job.name)) throw fail('Sản phẩm nguồn đã thay đổi hoặc chưa tải về. Tải lại dữ liệu và kiểm tra đúng shop, ID, Model ID, tên.');
    return this.replacements.resolve(row.id);
  }
  async task(id, work) {
    if (this.busy) throw fail('Đang xử lý sản phẩm thay thế. Hãy chờ tác vụ hiện tại.', 'STUDIO_BUSY');
    const job = id ? this.get(id) : null; this.busy = true; this.onChange();
    try {const result = await work(job); if (job) {delete job.error; job.updatedAt = new Date().toISOString(); this.save();} return result;}
    catch (error) {if (job) job.error = cleanError(error.message); this.log(job, error.message, 'error'); throw error;}
    finally {this.busy = false; this.onChange();}
  }
  create({rowIds}) {
    if (this.busy) throw fail('Đang xử lý sản phẩm thay thế.');
    if (!Array.isArray(rowIds) || !rowIds.length || rowIds.length > 100) throw fail('Chọn từ 1 đến 100 sản phẩm nguồn.');
    if (!Array.isArray(this.data.jobs)) this.data.jobs = [];
    if (!Array.isArray(this.data.logs)) this.data.logs = [];
    const rows = rowIds.map(id => this.replacements.resolve(id)); rows.forEach(row => price(row.price));
    const unique = new Map(rows.map(row => [identity(row), row])), jobs = [];
    for (const row of unique.values()) {
      price(row.price);
      const candidates = this.data.jobs.filter(item => !item.deletedAt && identity(item) === identity(row));
      const selectedUrl = row.replacementUrl || this.replacements.data.links[key(row)]?.url;
      let job = candidates.find(item => selectedUrl && item.notionUrl === selectedUrl) || candidates.find(item => item.index === 1) || candidates[0];
      if (!job) {
        job = {id: randomUUID(), rowId: row.id, shop: row.shop, productId: row.productId, modelId: row.modelId, sourceName: row.name, index: 1, insight: row.name, prompt: '', price: row.price, name: '', description: '', status: 'draft', contentApproved: false, imagesReady: false, createdAt: new Date().toISOString()};
        this.data.jobs.push(job);
      }
      this.syncDriveAssets(job);
      jobs.push(this.publicJob(job));
    }
    this.log(null, 'Đã mở ' + jobs.length + ' bài theo đúng shop và sản phẩm nguồn.'); return jobs;
  }
  update(id, patch) {
    if (this.busy) throw fail('Đang xử lý sản phẩm thay thế.');
    const job = this.get(id);
    if (job.status === 'publishing') throw fail('Đang đẩy bài lên Notion.');
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(field => !['prompt', 'price', 'name', 'description'].includes(field))) throw fail('Nội dung chỉnh sửa không hợp lệ.');
    const values = {};
    for (const [field, value] of Object.entries(patch)) values[field] = field === 'price' ? price(value) : shortText(value, field, field === 'prompt' ? 16000 : field === 'description' ? 5000 : 120, ['prompt', 'description', 'name'].includes(field) ? 0 : 1);
    const next = {...clone(job), ...values, contentApproved: false}; if (next.article) next.article.approved = false;
    if ('prompt' in values) {
      next.status = 'draft'; delete next.article; delete next.baseline; delete next.notionUrl; delete next.publishAttempted;
      delete next.chromeImageAttempted; delete next.generatedAssets; delete next.driveAssets; delete next.sourceAssets; delete next.imageContentDigest; delete next.imageSourceDigest;
    }
    else if (next.article) {this.applyContent(next); next.status = 'generated';}
    next.updatedAt = new Date().toISOString(); next.editedLocally = true; delete next.error; Object.assign(job, next);
    if (!next.article) delete job.article; if (!next.baseline) delete job.baseline;
    this.save(); return this.publicJob(job);
  }
  applyContent(job) {
    Object.assign(job.article.product, {name: job.name, description: job.description});
    if (textOnly(job.article)) return;
    if (job.article.product.variants.length === 1) {job.article.product.variants[0].price = job.price; if (Object.hasOwn(job.article.product.fields, 'Giá')) job.article.product.fields['Giá'] = job.price;}
    else if (job.article.product.variants.find(model => model.modelId === job.modelId)?.price !== job.price) throw fail('Sản phẩm nhiều phân loại giữ giá hiện có. Dùng mục sửa giá theo Model ID.');
  }
  validateContent(job, article = job.article) {
    this.validateWritten(job, article);
    if (!job.baseline || textOnly(article)) throw fail('Cần đọc form sản phẩm nguồn trước khi tạo ảnh hoặc cập nhật Shopee.');
    const sourceImages = (job.baseline.images || []).map(image => typeof image === 'string' ? image : image.url).filter(Boolean);
    if (!sourceImages.length) throw fail('Chưa đọc được ảnh mẫu đúng sản phẩm từ Shopee.');
    validateArticle({...clone(article), images: sourceImages}, {shop: job.shop, productId: job.productId, name: job.sourceName});
    this.replacements.editor.validate(job.baseline, article.product); return sourceImages;
  }
  validateWritten(job, article = job.article) {
    if (!article || article.schemaVersion !== 1 || !article.target || ['shop', 'productId', 'name'].some(field => article.target[field] !== {shop: job.shop, productId: job.productId, name: job.sourceName}[field])) throw fail('Bài viết chưa hoàn chỉnh hoặc không khớp sản phẩm nguồn.');
    shortText(article.product?.name, 'Tên sản phẩm', 120); shortText(article.product?.description, 'Mô tả', 5000); price(job.price);
    if (!/^\d{1,30}$/.test(job.productId) || !/^\d{1,30}$/.test(job.modelId)) throw fail('ID sản phẩm hoặc Model ID không hợp lệ.');
    if (typeof article.approved !== 'boolean' || !Array.isArray(article.images)) throw fail('Định dạng bài viết không hợp lệ.');
    if (textOnly(article)) {
      if (Object.keys(article).some(field => !['schemaVersion', 'target', 'product', 'images', 'approved', 'imageFolder'].includes(field)) || Object.keys(article.target).some(field => !['shop', 'productId', 'name'].includes(field)) || Object.keys(article.product).some(field => !['name', 'description'].includes(field))) throw fail('Bài viết chỉ có nội dung chưa được khai báo ảnh hoặc thuộc tính Shopee.');
    } else validateArticle({...clone(article), images: article.images.length ? article.images : ['https://validation.invalid/draft-only']}, {shop: job.shop, productId: job.productId, name: job.sourceName});
    return article;
  }
  generate(id) {return this.task(id, async job => {
    if (job.status === 'publishing') throw fail('Đang đẩy bài lên Notion.');
    shortText(job.prompt, 'Prompt viết bài', 16000); const requestedName = shortText(job.name, 'Tên sản phẩm mới', 120), row = this.row(job);
    job.contentApproved = false; if (job.article) job.article.approved = false; job.status = 'generating'; this.log(job, job.shop + ' · ' + job.insight + ': đang viết bài bằng Gemini API.');
    try {
      const written = await this.gemini.generate({prompt: job.prompt, requestedName, source: {name: row.name}, insight: job.insight, price: job.price});
      job.name = requestedName; job.description = shortText(written.description, 'Mô tả AI', 5000);
      job.article = {schemaVersion: 1, target: {shop: job.shop, productId: job.productId, name: job.sourceName}, product: {name: job.name, description: job.description}, images: [], approved: false};
      delete job.baseline; delete job.notionUrl; delete job.publishAttempted;
      delete job.error; delete job.chromeImageAttempted; delete job.generatedAssets; delete job.driveAssets; delete job.sourceAssets; delete job.imageContentDigest; delete job.imageSourceDigest;
      this.validateWritten(job);
      job.status = 'generated'; this.log(job, job.insight + ': đã viết bài. Xem và chỉnh nội dung rồi đẩy lên Notion.'); return this.publicJob(job);
    } catch (error) {job.status = 'draft'; throw error;}
  });}
  approve(id) {
    if (this.busy) throw fail('Đang xử lý sản phẩm thay thế.');
    const job = this.get(id); if (job.notionUrl || job.publishAttempted) throw fail('Bài đã đẩy hoặc đang chờ xác minh Notion.');
    if (!['generated', 'approved'].includes(job.status)) throw fail('Cần viết bài hoàn chỉnh trước khi duyệt.');
    this.row(job); this.validateWritten(job); job.contentApproved = true; job.article.approved = true; job.status = 'approved';
    this.log(job, job.insight + ': nhân viên đã duyệt bài.'); return this.publicJob(job);
  }
  async children(id) {
    const blocks = [], seen = new Set(); let cursor;
    do {
      const result = await this.i.notion('blocks/' + id + '/children?page_size=100' + (cursor ? '&start_cursor=' + encodeURIComponent(cursor) : ''));
      if (!Array.isArray(result.results)) throw fail('Notion trả danh sách khối không hợp lệ.'); blocks.push(...result.results);
      if (blocks.length > 1000) throw fail('Bài Notion quá lớn để đối chiếu.');
      cursor = result.has_more ? result.next_cursor : null;
      if (result.has_more && !cursor || cursor && seen.has(cursor)) throw fail('Phân trang Notion không hợp lệ.'); if (cursor) seen.add(cursor);
    } while (cursor);
    return blocks.filter(block => !block.archived && !block.in_trash);
  }
  async setup() {
    let database;
    const targetDbId = this.data.databaseId || DEFAULT_REPLACEMENT_DATABASE_ID;
    if (targetDbId) {
      try { database = await this.i.notion('databases/' + targetDbId); } catch {}
    }
    if (!database) {
      const matches = (await this.children(PARENT_ID)).filter(block => block.type === 'child_database' && block.child_database.title === TABLE_NAME);
      if (matches.length > 1) throw fail('Có nhiều bảng Sản phẩm thay thế ở Notion. Cần kiểm tra trước khi ghi.');
      if (matches.length) database = await this.i.notion('databases/' + matches[0].id);
      else {
        if (this.data.databaseCreateAttempted) throw fail('Lượt tạo bảng Notion trước chưa xác minh. Tool không tạo bảng trùng.', 'STUDIO_CREATE_UNCERTAIN');
        this.data.databaseCreateAttempted = true; this.save();
        database = await this.i.notion('databases', 'POST', {parent: {type: 'page_id', page_id: PARENT_ID}, title: rich(TABLE_NAME), properties: SCHEMA});
      }
    }
    if (!database?.id) throw fail('Notion chưa trả ID bảng sản phẩm thay thế.');
    if (!this.data.databaseId && database.parent?.page_id && database.parent.page_id.replace(/-/g, '') !== PARENT_ID && database.id.replace(/-/g, '') !== DEFAULT_REPLACEMENT_DATABASE_ID.replace(/-/g, '')) throw fail('Bảng sản phẩm thay thế không thuộc trang sản phẩm online đã chọn.');
    this.data.databaseId = database.id; this.save();
    const add = {};
    for (const [name, definition] of Object.entries(SCHEMA)) {
      const current = database.properties?.[name], type = Object.keys(definition)[0];
      if (!current) add[name] = definition; else if (current.type !== type) throw fail('Cột Notion sai kiểu: ' + name + '.');
    }
    if (Object.keys(add).length) await this.i.notion('databases/' + database.id, 'PATCH', {properties: add});
    return database.id;
  }
  async remoteJobs(databaseId) {
    const pages = await this.i.listPages(databaseId); return pages.filter(page => !page.archived && !page.in_trash);
  }
  remoteIdentity(job, page) {
    const props = page.properties || {};
    const origin = plain(props['Sản phẩm gốc']?.rich_text) || plain(props['Sản phẩm nguồn']?.rich_text);
    if (plain(props['Mã tác vụ']?.rich_text) !== job.id || plain(props['Tên shop']?.rich_text) !== job.shop || plain(props['ID sản phẩm']?.rich_text) !== job.productId || plain(props['Model ID']?.rich_text) !== job.modelId || (origin && origin !== job.sourceName && origin !== job.name)) throw fail('Bài Notion không khớp tác vụ, shop, sản phẩm nguồn và Model ID.');
  }
  async code(job) {
    const pageId = articleId(job.notionUrl), page = await this.i.notion('pages/' + pageId);
    if (page.archived || page.in_trash || page.parent?.database_id && page.parent.database_id.replace(/-/g, '') !== this.data.databaseId.replace(/-/g, '')) throw fail('Bài Notion đã xoá hoặc không thuộc bảng sản phẩm thay thế.');
    this.remoteIdentity(job, page);
    const candidates = [];
    for (const block of await this.children(pageId)) if (block.type === 'code' && block.code?.language === 'json') {
      let article; try {article = JSON.parse(plain(block.code.rich_text));} catch {throw fail('JSON bài Notion đã sửa nhưng chưa đúng định dạng.');}
      if (article?.schemaVersion === 1) candidates.push({id: block.id, article});
    }
    if (candidates.length !== 1) throw fail('Bài Notion phải có đúng một JSON sản phẩm thay thế.');
    const code = candidates[0];
    if (['shop', 'productId', 'name'].some(field => code.article.target?.[field] !== {shop: job.shop, productId: job.productId, name: job.sourceName}[field])) throw fail('JSON Notion không khớp sản phẩm nguồn.');
    return {...code, price: page.properties?.['Giá bán']?.number};
  }
  props(job) {return {
    'Tên sản phẩm': {title: rich(job.name || '')}, 'Tên shop': {rich_text: rich(job.shop)},
    'Sản phẩm gốc': {rich_text: rich(job.sourceName)}, 'Sản phẩm nguồn': {rich_text: rich(job.sourceName)},
    'ID sản phẩm': {rich_text: rich(job.productId)}, 'Model ID': {rich_text: rich(job.modelId)}, 'Insight': {rich_text: rich(job.insight)},
    'Giá bán': {number: job.price}, 'Trạng thái': {select: {name: 'Bài đã duyệt'}}, 'Mã tác vụ': {rich_text: rich(job.id)}, 'Thư mục ảnh': {url: null},
  };}
  publish(id) {return this.task(id, async job => {
    this.row(job); this.validateWritten(job);
    if (!job.notionUrl && !job.publishAttempted && !['generated', 'approved'].includes(job.status)) throw fail('Cần viết bài hoàn chỉnh trước khi đẩy Notion.');
    const databaseId = await this.setup();
    const pages = await this.remoteJobs(databaseId), matches = pages.filter(page => plain(page.properties?.['Mã tác vụ']?.rich_text) === job.id);
    if (!matches.length && pages.some(page => plain(page.properties?.['Tên shop']?.rich_text) === job.shop && plain(page.properties?.['ID sản phẩm']?.rich_text) === job.productId)) throw fail('Sản phẩm này đã có bài trên Notion cho đúng shop. Tải lại bảng rồi chọn bài có sẵn; không tạo trùng.');
    if (matches.length > 1) throw fail('Notion có nhiều bài cùng Mã tác vụ. Không tạo hoặc ghi đè.');
    if (matches.length) {
      this.remoteIdentity(job, matches[0]); job.notionUrl = pageUrl(matches[0]); articleId(job.notionUrl);
      let remote;
      try { remote = await this.code(job); } catch { remote = null; }
      if (!remote) {
        job.contentApproved = true; if (job.article) job.article.approved = true;
        await this.i.notion('pages/' + articleId(job.notionUrl), 'PATCH', {
          properties: {
            'Tên sản phẩm': {title: rich(job.name)},
            'Sản phẩm gốc': {rich_text: rich(job.sourceName)},
            'Sản phẩm nguồn': {rich_text: rich(job.sourceName)},
            'Giá bán': {number: job.price},
            'Trạng thái': {select: {name: 'Bài đã duyệt'}}
          }
        });
        await this.i.notion('blocks/' + articleId(job.notionUrl) + '/children', 'PATCH', {
          children: [
            paragraph('Sản phẩm nguồn: ' + job.shop + ' · ' + job.sourceName + ' · ' + job.productId + ' · ' + job.insight),
            {object: 'block', type: 'heading_2', heading_2: {rich_text: rich(job.name)}},
            paragraph(job.description),
            paragraph('Giá bán: ' + job.price.toLocaleString('vi-VN') + ' đ. Bài đã duyệt; chưa có ảnh. Chỉ cập nhật Shopee sau khi đủ bài và 5 ảnh.'),
            {object: 'block', type: 'code', code: {language: 'json', rich_text: rich(JSON.stringify(job.article, null, 2))}}
          ]
        });
        remote = await this.code(job);
      }
      if (job.status !== 'publish-uncertain' && job.editedLocally && remote.article?.product) {
        remote.article.product.name = job.name || remote.article.product.name;
        remote.article.product.description = job.description || remote.article.product.description;
        if (Array.isArray(remote.article.product.variants) && remote.article.product.variants.length) {
          if (remote.article.product.variants.length === 1) {
            remote.article.product.variants[0].price = job.price;
          } else {
            const v = remote.article.product.variants.find(m => m.modelId === job.modelId);
            if (v) v.price = job.price;
          }
        }
        if (remote.article.product.fields && Object.hasOwn(remote.article.product.fields, 'Giá')) {
          remote.article.product.fields['Giá'] = job.price;
        }
        remote.article.approved = true;
        this.validateWritten(job, remote.article);

        await this.i.notion('pages/' + articleId(job.notionUrl), 'PATCH', {
          properties: {
            'Tên sản phẩm': {title: rich(job.name)},
            'Giá bán': {number: job.price}
          }
        });
        await this.i.notion('blocks/' + remote.id, 'PATCH', {
          code: {language: 'json', rich_text: rich(JSON.stringify(remote.article, null, 2))}
        });
        remote.price = job.price;
        if (job.driveAssets || job.chromeDriveAssets || job.imageContentDigest) {
          job.imageContentDigest = this.imageDigest(job, remote.article);
        }
        delete job.editedLocally;
      }
      this.validateWritten(job, remote.article);
      job.article = clone(remote.article);
      job.name = remote.article.product.name;
      job.description = remote.article.product.description;
      if (textOnly(remote.article)) job.price = price(remote.price ?? job.price);
      job.contentApproved = remote.article.approved === true;
      job.status = job.imagesReady ? 'attached' : ((job.driveAssets?.images?.length === 5 || job.chromeDriveAssets?.images?.length === 5) ? 'images-ready' : 'published');
      delete job.editedLocally;
      this.log(job, job.insight + ': đã đồng bộ bài Notion có sẵn.');
      this.save();
      return this.publicJob(job);
    }
    if (job.notionUrl || job.publishAttempted) throw fail('Lượt đẩy bài trước chưa xác minh. Tool không tự tạo bài thứ hai.', 'STUDIO_PUBLISH_UNCERTAIN');
    // Publishing is the employee's confirmation of the editable content shown in step 1.
    job.contentApproved = true; job.article.approved = true;
    job.publishAttempted = true; job.status = 'publishing'; this.log(job, job.insight + ': đang đẩy bài đã duyệt, chưa có ảnh, lên Notion.');
    try {
      const page = await this.i.notion('pages', 'POST', {parent: {database_id: databaseId}, properties: this.props(job), children: [
        paragraph('Sản phẩm nguồn: ' + job.shop + ' · ' + job.sourceName + ' · ' + job.productId + ' · ' + job.insight),
        {object: 'block', type: 'heading_2', heading_2: {rich_text: rich(job.name)}}, paragraph(job.description), paragraph('Giá bán: ' + job.price.toLocaleString('vi-VN') + ' đ. Bài đã duyệt; chưa có ảnh. Chỉ cập nhật Shopee sau khi đủ bài và 5 ảnh.'),
        {object: 'block', type: 'code', code: {language: 'json', rich_text: rich(JSON.stringify(job.article, null, 2))}},
      ]});
      job.notionUrl = pageUrl(page); articleId(job.notionUrl); this.save();
      const remote = await this.code(job); this.validateWritten(job, remote.article); job.article = clone(remote.article); job.name = remote.article.product.name; job.description = remote.article.product.description; job.contentApproved = remote.article.approved === true;
      if (textOnly(remote.article)) job.price = price(remote.price);
      delete job.editedLocally;
      job.status = 'published'; this.log(job, job.insight + ': đã đẩy và đọc lại bài Notion. Chưa có ảnh.'); return this.publicJob(job);
    } catch (error) {job.status = 'publish-uncertain'; this.save(); throw error;}
  });}
  checkFive(assets) {
    if (!Array.isArray(assets?.images) || assets.images.length !== 5 || assets.images.some(image => !image.path || !image.filename || !/^[a-f\d]{64}$/i.test(image.hash || '')) || new Set(assets.images.map(image => image.hash)).size !== 5) throw fail('Cần đủ 5 ảnh khác nhau đã xác minh đúng tác vụ.');
    if (assets.jobId && typeof assets.jobId !== 'string') throw fail('Mã tác vụ ảnh không hợp lệ.');
  }
  imageDigest(job, article) {
    return createHash('sha256').update(JSON.stringify([job.shop, job.productId, job.modelId, job.sourceName, job.insight, article.product.name, article.product.description])).digest('hex');
  }
  assertImageContent(job, article, required = false) {
    const hasImages = !!(job.sourceAssets || job.generatedAssets || job.driveAssets || job.chromeDriveAssets || job.imageContentDigest);
    if (!job.imageContentDigest && hasImages && article?.product) {
      job.imageContentDigest = this.imageDigest(job, article);
      this.save();
    }
    if ((required || hasImages) && !job.imageContentDigest) throw fail('Bộ ảnh chưa có dấu xác minh nội dung. Kiểm tra bài và bộ ảnh trước khi tiếp tục.', 'STUDIO_IMAGE_CONTENT_CHANGED');
    if (job.imageContentDigest && job.imageContentDigest !== this.imageDigest(job, article)) throw fail('Bài Notion đã đổi nội dung sau khi tạo ảnh. Tool giữ nguyên bài và bộ ảnh; cần kiểm tra bộ ảnh tương ứng.', 'STUDIO_IMAGE_CONTENT_CHANGED');
    if (job.imageSourceDigest && job.baseline) {
      const sources = (job.baseline.images || []).map(image => typeof image === 'string' ? image : image.url).filter(Boolean);
      if (createHash('sha256').update(JSON.stringify(sources)).digest('hex') !== job.imageSourceDigest) throw fail('Ảnh nguồn đã thay đổi sau khi tạo bộ ảnh. Không tái dùng bộ ảnh cũ.', 'STUDIO_IMAGE_CONTENT_CHANGED');
    }
  }
  async compress(job) {
    this.checkFive(job.sourceAssets);
    const folder = path.join(this.dir, 'assets', job.id); fs.mkdirSync(folder, {recursive: true});
    const result = {jobId: job.id, images: []};
    for (let index = 0; index < 5; index++) {
      const source = job.sourceAssets.images[index], raw = fs.readFileSync(source.path);
      if (createHash('sha256').update(raw).digest('hex') !== source.hash) throw fail('Ảnh ChatGPT đã thay đổi sau khi tải. Tool không tự tạo lại.');
      const processed = await require('./replacement-images.cjs').processImage(raw), filename = String(index + 1) + '-' + processed.hash.slice(0, 16) + '.jpg', file = path.join(folder, filename);
      fs.writeFileSync(file + '.tmp', processed.buffer, {mode: 0o600}); fs.renameSync(file + '.tmp', file);
      const {buffer, ...metadata} = processed; result.images.push({...metadata, path: file, filename, sourceHash: source.hash});
    }
    this.checkFive(result); return result;
  }
  async hydrate(job, row, remote) {
    this.validateWritten(job, remote.article);
    const baseline = job.baseline || await this.replacements.editor.inspect(this.replacements.target(row)), template = this.replacements.makeTemplate(row, baseline);
    const next = {...clone(job), baseline: clone(baseline), article: textOnly(remote.article) ? template : remote.article, name: remote.article.product.name, description: remote.article.product.description, price: textOnly(remote.article) ? price(remote.price) : job.price};
    if (!textOnly(remote.article)) {this.validateContent(next, remote.article); job.baseline = clone(baseline); this.save(); return remote.article;}
    next.article.images = []; next.article.approved = remote.article.approved; delete next.article.imageFolder;
    this.applyContent(next); this.validateContent(next);
    const current = await this.code(job);
    if (current.id !== remote.id || current.price !== remote.price || JSON.stringify(current.article) !== JSON.stringify(remote.article)) throw fail('Bài Notion đã được sửa khi đọc form Shopee. Tool giữ nguyên bài; kiểm tra rồi thử tạo ảnh lại.');
    job.baseline = clone(baseline); this.save();
    await this.i.notion('blocks/' + remote.id, 'PATCH', {code: {language: 'json', rich_text: rich(JSON.stringify(next.article, null, 2))}});
    const verified = await this.code(job);
    if (JSON.stringify(verified.article) !== JSON.stringify(next.article)) throw fail('Chưa xác minh các thuộc tính Shopee trong bài Notion. Tool giữ nguyên bài để kiểm tra.');
    job.price = next.price; this.validateContent(job, verified.article); this.save(); return verified.article;
  }
  manualPrompts(id) {return this.task(id, async job => {
    if (!job.notionUrl || !job.contentApproved) throw fail('Đẩy bài đã xem lên Notion trước khi lấy prompt tạo ảnh.');
    this.row(job); const remote = await this.code(job); this.validateWritten(job, remote.article);
    if (remote.article.approved !== true) throw fail('Bài Notion chưa được xác nhận. Kiểm tra bài trước khi tạo ảnh.');
    if (job.sourceAssets || job.generatedAssets || job.driveAssets) this.assertImageContent(job, remote.article, true);
    this.syncDriveAssets(job);
    const contentDigest = this.imageDigest(job, remote.article);
    job.manualPromptDigest = contentDigest; this.save();
    const defaultPrompts = require('./studio-manual.cjs').manualPrompts(remote.article, job.insight);
    const prompts = defaultPrompts.map((p, i) => {
      if (job.customPrompts && typeof job.customPrompts[i] === 'string') {
        return {...p, text: job.customPrompts[i]};
      }
      return p;
    });
    return {jobId: job.id, shop: job.shop, productId: job.productId, name: remote.article.product.name, contentDigest,
      prompts,
      sourceImages: (job.baseline?.images || []).map(image => typeof image === 'string' ? image : image.url).filter(Boolean),
      sourceProductUrl: 'https://banhang.shopee.vn/portal/product/' + job.productId + '?pageEntry=product_list'};
  });}
  updateImagePrompt(id, index, text) {return this.task(id, async job => {
    if (!Number.isInteger(index) || index < 0 || index > 4) throw fail('Vị trí prompt không hợp lệ (0-4).');
    if (!Array.isArray(job.customPrompts)) job.customPrompts = [];
    job.customPrompts[index] = typeof text === 'string' ? text : '';
    this.save();
    return {ok: true, customPrompts: job.customPrompts};
  });}
  resetImagePrompt(id, index = null) {return this.task(id, async job => {
    const remote = await this.code(job);
    const defaults = require('./studio-manual.cjs').manualPrompts(remote.article, job.insight);
    if (index === null || index === undefined) {
      delete job.customPrompts;
    } else if (Array.isArray(job.customPrompts)) {
      job.customPrompts[index] = defaults[index]?.text || '';
    }
    this.save();
    const prompts = defaults.map((p, i) => {
      if (job.customPrompts && typeof job.customPrompts[i] === 'string') {
        return {...p, text: job.customPrompts[i]};
      }
      return p;
    });
    return {ok: true, prompts};
  });}
  importLocalImages(id, filePaths, contentDigest) {return this.task(id, async job => {
    if (!job.notionUrl || !job.contentApproved) throw fail('Đẩy bài đã xem lên Notion trước khi nhập ảnh.');
    if (!/^[a-f\d]{64}$/i.test(contentDigest || '') || contentDigest !== job.manualPromptDigest) throw fail('Lấy lại prompt đúng bài trước khi chọn 5 ảnh.', 'STUDIO_IMAGE_CONTENT_CHANGED');
    const row = this.row(job), remote = await this.code(job); this.validateWritten(job, remote.article);
    if (remote.article.approved !== true) throw fail('Bài Notion chưa được xác nhận. Kiểm tra bài trước khi nhập ảnh.');
    if (this.imageDigest(job, remote.article) !== contentDigest) throw fail('Bài Notion đã đổi nội dung sau khi lấy prompt. Lấy lại prompt và kiểm tra bộ ảnh.', 'STUDIO_IMAGE_CONTENT_CHANGED');
    const manual = require('./studio-manual.cjs'), prepared = await manual.prepareLocalImages(filePaths);
    const hasAssets = !!(job.sourceAssets || job.generatedAssets || job.driveAssets || job.imageUrls?.length || remote.article.images?.length || job.imagesReady);
    if (hasAssets && (job.imageSource !== 'manual' || !job.generatedAssets || job.manualImportDigest !== prepared.importDigest)) throw fail('Tác vụ đã có bộ ảnh được lưu hoặc đính kèm. Tool giữ nguyên bộ ảnh, không ghi đè.', 'STUDIO_LOCAL_IMAGE_EXISTS');
    if (hasAssets) this.assertImageContent(job, remote.article, true);
    const article = await this.hydrate(job, row, remote);
    if (this.imageDigest(job, article) !== contentDigest) throw fail('Bài Notion đã đổi nội dung khi chuẩn bị nhập ảnh.', 'STUDIO_IMAGE_CONTENT_CHANGED');
    const current = await this.code(job); this.validateContent(job, current.article);
    if (current.id !== remote.id || current.price !== remote.price || current.article.approved !== true || JSON.stringify(current.article) !== JSON.stringify(article)) throw fail('Bài Notion đã được sửa khi nhập ảnh. Tool giữ nguyên bài và bộ ảnh.', 'STUDIO_IMAGE_CONTENT_CHANGED');
    const assets = manual.commitLocalImages(this.dir, job.id, prepared, job.generatedAssets); this.checkFive(assets);
    const sourceImages = this.validateContent(job, article);
    job.article = clone(article); job.name = article.product.name; job.description = article.product.description;
    job.imageSource = 'manual'; job.manualImportDigest = prepared.importDigest;
    job.imageContentDigest = contentDigest; job.imageSourceDigest = createHash('sha256').update(JSON.stringify(sourceImages)).digest('hex');
    job.generatedAssets = clone(assets); job.status = job.imagesReady ? 'attached' : 'images-generated'; this.save();
    if (!job.driveAssets) {
      job.status = 'copying-images'; this.log(job, job.insight + ': đã nhập và nén 5 ảnh, đang lưu vào Drive local theo shop/sản phẩm.');
      const saved = await this.drive.uploadSet({jobId: job.id, shop: job.shop, productId: job.productId, productName: job.name, insight: job.insight, relativeDir: job.relativeDir, assets: job.generatedAssets});
      this.checkFive(saved); if (saved.verified !== true || saved.jobId && saved.jobId !== job.id) throw fail('Chưa xác minh ảnh đã lưu đúng tác vụ trong Drive local.');
      job.driveAssets = clone(saved); job.driveFolderUrl = saved.folderUrl; job.localFolder = saved.localFolder; job.relativeDir = saved.relativeDir; this.save();
    }
    const after = await this.code(job); this.validateContent(job, after.article); this.assertImageContent(job, after.article, true);
    if (after.id !== current.id || after.price !== current.price || after.article.approved !== true || JSON.stringify(after.article) !== JSON.stringify(article)) throw fail('Bài Notion đã được sửa khi lưu ảnh. Tool giữ bộ ảnh để kiểm tra trước khi đính kèm.', 'STUDIO_IMAGE_CONTENT_CHANGED');
    job.status = job.imagesReady ? 'attached' : 'images-ready'; this.log(job, job.insight + ': đã nhập đủ 5 ảnh thủ công dưới 1,9 MB và lưu đúng shop/sản phẩm. Có thể gắn ảnh vào bài Notion.'); return this.publicJob(job);
  });}
  importSingleImage(id, index, filePath) {return this.task(id, async job => {
    if (!job) throw fail('Chưa chọn bài để nhập ảnh.');
    if (!Number.isInteger(index) || index < 0 || index > 4) throw fail('Vị trí ảnh phải từ 1 đến 5 (index 0 đến 4).');
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || !fs.existsSync(filePath)) throw fail('File ảnh không tồn tại.');
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 25 * 1024 * 1024) throw fail('Ảnh phải là file local, tối đa 25 MB.');

    const raw = fs.readFileSync(filePath);
    let meta;
    try {
      meta = await require('sharp')(raw, {limitInputPixels: 40000000, failOn: 'error'}).metadata();
    } catch {
      throw fail('Không đọc được file ảnh đã chọn.');
    }
    if (!meta || meta.width < 500 || meta.height < 500) throw fail('Ảnh cần tối thiểu 500 × 500 điểm ảnh.');

    const pngBuffer = await require('sharp')(raw, {limitInputPixels: 40000000, failOn: 'error'})
      .rotate()
      .png()
      .toBuffer();
    const pngHash = createHash('sha256').update(pngBuffer).digest('hex');

    let previewDataUrl = '';
    try {
      const thumb = await require('sharp')(pngBuffer, {limitInputPixels: 40000000, failOn: 'error'})
        .resize({width: 180, height: 180, fit: 'inside'})
        .jpeg({quality: 70})
        .toBuffer();
      previewDataUrl = 'data:image/jpeg;base64,' + thumb.toString('base64');
    } catch {}

    const folder = path.join(this.dir, 'assets', job.id, 'manual');
    fs.mkdirSync(folder, {recursive: true});
    const tempFile = path.join(folder, String(index + 1) + '-' + pngHash.slice(0, 16) + '.png');
    fs.writeFileSync(tempFile, pngBuffer, {mode: 0o600});

    const driveImage = {
      path: tempFile,
      filename: String(index + 1) + '.png',
      hash: pngHash,
      bytes: pngBuffer.length,
      width: meta.width,
      height: meta.height,
      mimeType: 'image/png',
      allowOverwrite: true,
      previewDataUrl
    };

    const saved = await this.drive.uploadOne({
      jobId: job.id,
      shop: job.shop,
      productId: job.productId,
      productName: job.name || job.sourceName,
      insight: job.insight,
      relativeDir: job.relativeDir,
      index,
      image: driveImage
    });

    if (saved?.verified !== true || saved.jobId !== job.id) throw fail('Chưa xác minh ảnh lưu vào Drive local.');
    job.driveFolderUrl = saved.folderUrl;
    job.localFolder = saved.localFolder;
    job.relativeDir = saved.relativeDir;

    if (!job.chromeDriveAssets) job.chromeDriveAssets = {jobId: job.id, images: []};
    job.chromeDriveAssets.images[index] = {
      ...clone(saved.image),
      previewDataUrl
    };

    const processed = await require('./replacement-images.cjs').processImage(raw);
    const jpgFilename = String(index + 1) + '-' + processed.hash.slice(0, 16) + '.jpg';
    const jpgFile = path.join(folder, jpgFilename);
    fs.writeFileSync(jpgFile, processed.buffer, {mode: 0o600});
    const {buffer: ignored, ...details} = processed;
    const generatedImage = {
      ...details,
      filename: jpgFilename,
      path: jpgFile,
      index,
      ordinal: index + 1,
      sourceHash: createHash('sha256').update(raw).digest('hex')
    };
    if (!job.generatedAssets) job.generatedAssets = {jobId: job.id, source: 'manual', images: []};
    const existingSlot = job.generatedAssets.images.findIndex(img => img.index === index);
    if (existingSlot >= 0) job.generatedAssets.images[existingSlot] = generatedImage;
    else job.generatedAssets.images.push(generatedImage);
    job.generatedAssets.images.sort((a,b) => a.index - b.index);

    const countReady = (job.chromeDriveAssets.images || []).filter(Boolean).length;
    if (countReady === 5) {
      job.driveAssets = {
        folderUrl: job.driveFolderUrl,
        localFolder: saved.localFolder,
        relativeDir: saved.relativeDir,
        images: clone(job.chromeDriveAssets.images),
        verified: true,
        cloudVerified: false
      };
      if (job.article?.product) {
        job.imageContentDigest = this.imageDigest(job, job.article);
      }
      job.status = job.imagesReady ? 'attached' : 'images-ready';
      this.log(job, job.insight + ': đã đủ 5 ảnh local (' + (index + 1) + '.png). Có thể gắn ảnh vào Notion.');
    } else {
      this.log(job, job.insight + ': đã lưu thủ công ảnh ' + (index + 1) + '.png (' + countReady + '/5) vào Drive local.');
    }
    this.save();
    return this.publicJob(job);
  });}
  chromeImages(id, {bridge, reference, contentDigest: requestedDigest, transport = 'chrome-extension', onProgress = () => {}, onImage = () => {}, singleIndex = null} = {}) {return this.task(id, async job => {
    if (!job.notionUrl || !job.contentApproved) throw fail('Đẩy bài đã xem lên Notion trước khi tạo ảnh.');
    if (!bridge || typeof bridge.generate !== 'function' || !reference) throw fail('Kết nối tiện ích Chrome và chọn ảnh mẫu đúng sản phẩm trước khi tạo ảnh.');
    if (!/^[a-f\d]{64}$/i.test(requestedDigest || '') || requestedDigest !== job.manualPromptDigest) throw fail('Chuẩn bị lại 5 prompt cho đúng bài trước khi tạo ảnh.', 'STUDIO_IMAGE_CONTENT_CHANGED');
    this.row(job); const remote = await this.code(job); this.validateWritten(job, remote.article);
    if (remote.article.approved !== true) throw fail('Bài Notion chưa được xác nhận.');
    const hasFullAssets = (job.generatedAssets?.images?.length === 5) || job.driveAssets || job.imagesReady || job.imageUrls?.length || remote.article.images?.length;
    if (job.sourceAssets || hasFullAssets || job.status === 'images-uncertain') {
      if (singleIndex === null) throw fail('Tác vụ đã có ảnh hoặc lượt Chrome chưa xác minh. Tool giữ nguyên dữ liệu, không tự tạo lại bộ ảnh.', 'STUDIO_IMAGES_UNCERTAIN');
    }
    if (!job.baseline) {
      if (!textOnly(remote.article)) throw fail('Chuẩn bị form sản phẩm nguồn trước khi tạo ảnh.');
      job.baseline = {shop: job.shop, productId: job.productId, name: job.sourceName, images: []};
    }
    const sourceImages = (job.baseline?.images || []).map(image => typeof image === 'string' ? image : image?.url).filter(Boolean);
    const contentDigest = this.imageDigest(job, remote.article);
    if (requestedDigest !== contentDigest) throw fail('Bài Notion đã đổi sau khi chuẩn bị prompt. Kiểm tra lại bài và ảnh mẫu.', 'STUDIO_IMAGE_CONTENT_CHANGED');
    this.assertImageContent(job, remote.article);
    const defaultPrompts = require('./studio-manual.cjs').manualPrompts(remote.article, job.insight);
    const prompts = defaultPrompts.map((p, i) => {
      if (job.customPrompts && typeof job.customPrompts[i] === 'string') {
        return {...p, text: job.customPrompts[i]};
      }
      return p;
    });
    const unchanged = async () => {
      this.row(job); const current = await this.code(job); this.validateWritten(job, current.article);
      if (current.id !== remote.id || current.price !== remote.price || current.article.approved !== true || JSON.stringify(current.article) !== JSON.stringify(remote.article) || this.imageDigest(job, current.article) !== contentDigest) throw fail('Bài Notion đã đổi khi tạo ảnh. Tool giữ nguyên ảnh đã lưu và dừng lượt tiếp theo.', 'STUDIO_IMAGE_CONTENT_CHANGED');
      this.assertImageContent(job, current.article, true);
    };
    job.article = clone(remote.article); job.name = remote.article.product.name; job.description = remote.article.product.description;
    job.imageContentDigest = contentDigest; job.imageSourceDigest = createHash('sha256').update(JSON.stringify(sourceImages)).digest('hex');
    job.chromeImageAttempted = true; job.imageSource = transport;
    const browserName = transport === 'chrome-cdp' ? 'Chrome riêng' : 'Chrome thường';
    const isSingle = Number.isInteger(singleIndex) && singleIndex >= 0 && singleIndex <= 4;
    job.status = 'generating-images'; this.log(job, job.insight + ': đang tạo ' + (isSingle ? 'ảnh ' + (singleIndex + 1) : 'lần lượt 5 ảnh') + ' qua ' + browserName + '.');
    let receiving = false;
    try {
      const result = await bridge.generate({jobId: job.id, contentDigest, prompts, reference, singleIndex, onProgress: progress => {
        const message = typeof progress === 'string' ? progress : progress?.message;
        if (message && message !== this.progress) this.log(job, message); onProgress(progress);
      }, onImage: async payload => {
        const index = payload?.index, buffer = payload?.buffer;
        const expectedIndex = isSingle ? singleIndex : (job.generatedAssets?.images?.length || 0);
        if (receiving || !Number.isInteger(index) || index !== expectedIndex || payload.jobId && payload.jobId !== job.id || payload.contentDigest && payload.contentDigest !== contentDigest || !Buffer.isBuffer(buffer)) throw fail('Ảnh Chrome không khớp tác vụ hoặc thứ tự đang chờ. Tool giữ nguyên dữ liệu.', 'STUDIO_CHROME_IMAGE_MISMATCH');
        receiving = true;
        try {
          await unchanged(); const processed = await require('./replacement-images.cjs').processImage(buffer);
          if (job.generatedAssets?.images.some(image => image.hash === processed.hash)) throw fail('Ảnh Chrome trùng với ảnh đã lưu. Tool dừng để kiểm tra.', 'STUDIO_CHROME_IMAGE_MISMATCH');
          await unchanged();
          const root = fs.realpathSync(this.dir); let folder = root;
          for (const name of ['assets', job.id, 'chrome']) {
            folder = path.join(folder, name);
            if (fs.existsSync(folder) && (!fs.lstatSync(folder).isDirectory() || fs.lstatSync(folder).isSymbolicLink())) throw fail('Thư mục ảnh Chrome không được là liên kết ngoài.');
            if (!fs.existsSync(folder)) fs.mkdirSync(folder);
            const relative = path.relative(root, fs.realpathSync(folder)); if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw fail('Thư mục ảnh Chrome nằm ngoài dữ liệu ứng dụng.');
          }
          const filename = String(index + 1) + '-' + processed.hash.slice(0, 16) + '.jpg', file = path.join(folder, filename), temporary = path.join(folder, '.chrome-' + randomUUID() + '.tmp');
          if (fs.existsSync(file) && (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink() || createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== processed.hash)) throw fail('Ảnh Chrome đã lưu khác dữ liệu mới. Không ghi đè ảnh.');
          if (!fs.existsSync(file)) {
            try {fs.writeFileSync(temporary, processed.buffer, {flag: 'wx', mode: 0o600}); fs.copyFileSync(temporary, file, fs.constants.COPYFILE_EXCL);}
            finally {if (fs.existsSync(temporary)) fs.unlinkSync(temporary);}
          }
          const {buffer: ignored, ...details} = processed, image = {...details, filename, path: file, index, ordinal: index + 1, sourceHash: createHash('sha256').update(buffer).digest('hex')};
          if (!job.generatedAssets) job.generatedAssets = {jobId: job.id, source: transport, images: []};
          const existingSlot = job.generatedAssets.images.findIndex(img => img.index === index);
          if (existingSlot >= 0) job.generatedAssets.images[existingSlot] = image;
          else job.generatedAssets.images.push(image);
          job.generatedAssets.images.sort((a,b) => a.index - b.index);
          this.save();
          let driveImage = image;
          if (transport === 'chrome-cdp') {
            const png = await require('sharp')(buffer, {limitInputPixels:40000000,failOn:'error'}).png().toBuffer();
            const pngHash = createHash('sha256').update(png).digest('hex'), pngPath = path.join(folder, (index + 1) + '-' + pngHash.slice(0,16) + '.png');
            if (fs.existsSync(pngPath)) {
              if (fs.lstatSync(pngPath).isSymbolicLink() || createHash('sha256').update(fs.readFileSync(pngPath)).digest('hex') !== pngHash) throw fail('File PNG đã thay đổi. Không ghi đè.');
            } else fs.writeFileSync(pngPath, png, {flag:'wx',mode:0o600});
            driveImage = {...image,path:pngPath,hash:pngHash,bytes:png.length,mimeType:'image/png'};
          }
          const saved = await this.drive.uploadOne({jobId: job.id, shop: job.shop, productId: job.productId, productName: job.name, insight: job.insight, relativeDir: job.relativeDir, index, image:driveImage});
          if (saved?.verified !== true || saved.jobId !== job.id || saved.image?.index !== index || saved.image.hash !== driveImage.hash) throw fail('Chưa xác minh ảnh Chrome đã lưu đúng thứ tự vào Drive local.');
          job.driveFolderUrl = saved.folderUrl; job.localFolder = saved.localFolder; job.relativeDir = saved.relativeDir;
          if (!job.chromeDriveAssets) job.chromeDriveAssets = {jobId: job.id, images: []};
          job.chromeDriveAssets.images[index] = clone(saved.image);
          this.log(job, job.insight + ': đã lưu ' + saved.image.filename + ' (' + (index + 1) + '/5) vào Drive local.');
          await unchanged(); await onImage(this.publicJob(job), {index, ordinal: index + 1});
          return {index, hash: image.hash, verified: true};
        } finally {receiving = false;}
      }});
      if (typeof result?.conversationUrl === 'string' && /^https:\/\/chatgpt\.com\/c\/[a-z\d_-]+$/i.test(result.conversationUrl)) job.conversationUrl = result.conversationUrl;
      const countReady = (job.chromeDriveAssets?.images || job.generatedAssets?.images || []).filter(Boolean).length;
      if (countReady === 5) {
        this.checkFive(job.generatedAssets); await unchanged();
        const saved = await this.drive.uploadSet({jobId: job.id, shop: job.shop, productId: job.productId, productName: job.name, insight: job.insight, relativeDir: job.relativeDir, assets: transport === 'chrome-cdp' ? job.chromeDriveAssets : job.generatedAssets});
        this.checkFive(saved); if (saved.verified !== true || saved.jobId && saved.jobId !== job.id) throw fail('Chưa xác minh đủ 5 ảnh Chrome trong Drive local.');
        job.driveAssets = clone(saved); job.driveFolderUrl = saved.folderUrl; job.localFolder = saved.localFolder; job.relativeDir = saved.relativeDir; await unchanged();
        job.imageContentDigest = contentDigest || this.imageDigest(job, remote.article);
        job.status = 'images-ready'; this.log(job, job.insight + ': đã tạo và lưu đủ 5 ảnh qua ' + browserName + '. Có thể gắn ảnh vào Notion.');
      } else {
        job.status = 'published';
        this.log(job, job.insight + ': đã lưu ảnh ' + ((singleIndex ?? 0) + 1) + ' vào Drive local.');
      }
      return this.publicJob(job);
    } catch (error) {
      if (['CHROME_IMAGE_FAILED','CHATGPT_NOT_READY','CHATGPT_LOGIN_REQUIRED'].includes(error.code) && !error.submitted && !job.generatedAssets?.images.length && !job.chromeDriveAssets?.images.length) {
        delete job.chromeImageAttempted; if (job.generatedAssets?.images.length === 0) delete job.generatedAssets;
        job.status = 'published';
      } else job.status = 'images-uncertain';
      this.save(); throw error;
    }
  });}
  images(id) {return this.task(id, async job => {
    if (!job.notionUrl || !job.contentApproved) throw fail('Duyệt và đẩy bài Notion trước khi tạo ảnh.');
    const row = this.row(job), remote = await this.code(job);
    if (remote.article.approved !== true) throw fail('Bài Notion chưa được xác nhận. Kiểm tra bài trước khi tạo ảnh.');
    const article = await this.hydrate(job, row, remote);
    this.assertImageContent(job, article);
    job.article = clone(article); job.name = article.product.name; job.description = article.product.description;
    if (job.status === 'images-uncertain' && !job.sourceAssets && !job.generatedAssets) throw fail('Lượt tạo ảnh ChatGPT trước chưa xác minh. Kiểm tra cuộc trò chuyện; không tự gửi lại.', 'STUDIO_IMAGES_UNCERTAIN');
    if (!job.sourceAssets && !job.generatedAssets) {
      const sourceImages = this.validateContent(job);
      job.imageContentDigest = this.imageDigest(job, job.article); job.imageSourceDigest = createHash('sha256').update(JSON.stringify(sourceImages)).digest('hex');
      job.status = 'generating-images'; this.log(job, job.insight + ': đang tạo 5 ảnh bằng ChatGPT.');
      try {
        const assets = await this.chatgpt.generate({jobId: job.id, shop: job.shop, productName: job.sourceName, name: job.article.product.name, description: job.article.product.description, insight: job.insight, sourceImages});
        this.checkFive(assets); if (assets.jobId && assets.jobId !== job.id) throw fail('Bộ ảnh không thuộc tác vụ sản phẩm đã chọn.');
        job.sourceAssets = clone(assets); job.conversationUrl = assets.conversationUrl || ''; job.status = 'images-generated'; this.save();
      } catch (error) {job.status = error.code === 'CHATGPT_NOT_READY' || error.code === 'CHATGPT_LOGIN_REQUIRED' ? 'published' : 'images-uncertain'; this.save(); throw error;}
    }
    if (!job.generatedAssets) {this.log(job, job.insight + ': đang nén 5 ảnh dưới 1,9 MB.'); job.generatedAssets = await this.compress(job); this.save();}
    if (!job.driveAssets) {
      this.checkFive(job.generatedAssets); job.status = 'copying-images'; this.log(job, job.insight + ': đang lưu ảnh vào Drive local theo shop/sản phẩm.');
      const saved = await this.drive.uploadSet({jobId: job.id, shop: job.shop, productId: job.productId, productName: job.name, insight: job.insight, relativeDir: job.relativeDir, assets: job.generatedAssets});
      this.checkFive(saved); if (saved.verified !== true || saved.jobId && saved.jobId !== job.id) throw fail('Chưa xác minh ảnh đã lưu đúng tác vụ trong Drive local.');
      job.driveAssets = clone(saved); job.driveFolderUrl = saved.folderUrl; job.localFolder = saved.localFolder; job.relativeDir = saved.relativeDir; this.save();
    }
    job.status = job.imagesReady ? 'attached' : 'images-ready'; this.log(job, job.insight + ': đã lưu đủ 5 ảnh. Có thể gắn ảnh vào bài Notion.'); return this.publicJob(job);
  });}
  async linkSource(job) {
    this.row(job); await this.replacements.ensureColumn();
    const rows = this.products.data.rows.filter(row => row.shop === job.shop && row.productId === job.productId);
    if (!rows.length || rows.some(row => !row.notionPageId || row.name !== job.sourceName)) throw fail('Sản phẩm nguồn chưa đồng bộ đầy đủ sang Notion.');
    // Verify all source identities before updating any links.
    const verified = [];
    for (const row of rows) {
      const remote = await this.i.notion('pages/' + row.notionPageId), parsed = this.products.parse(remote);
      if (remote.archived || remote.in_trash || key(parsed) !== key(row) || parsed.name !== job.sourceName) throw fail('Dòng sản phẩm nguồn Notion đã thay đổi. Chưa gắn link.');
      verified.push({row, url: remote.properties?.[LINK_COLUMN]?.url});
    }
    for (const {row} of verified) await this.replacements.linkSourceRow(row, job.notionUrl);
    this.products.save(); this.replacements.save();
  }
  attach(id) {return this.task(id, async job => {
    if (!job.notionUrl || !job.contentApproved || !job.driveAssets?.verified) throw fail('Cần bài đã duyệt và ảnh đã lưu trong Drive local.');
    this.row(job); this.checkFive(job.driveAssets); let code = await this.code(job);
    this.validateWritten(job, code.article); if (code.article.approved !== true) throw fail('Bài Notion chưa được duyệt.');
    this.assertImageContent(job, code.article, true);
    if (!Array.isArray(code.article.images) || code.article.images.length && JSON.stringify(code.article.images) !== JSON.stringify(job.imageUrls)) throw fail('Ảnh JSON Notion đã được sửa ngoài tool. Giữ nguyên để kiểm tra.');
    job.status = 'attaching'; this.log(job, job.insight + ': đang đính kèm 5 ảnh vào bài Notion.');
    try {
      if (job.imageUrls?.length !== 5) {
        const publisher = this.replacements.publisher || require('./replacement-notion-images.cjs');
        if (!job.generatedAssets || !Array.isArray(job.generatedAssets.images) || job.generatedAssets.images.filter(Boolean).length !== 5) {
          this.log(job, job.insight + ': đang nén 5 ảnh sang chuẩn JPEG dưới 1,9 MB cho Notion.');
          const folder = path.join(this.dir, 'assets', job.id, 'compressed');
          fs.mkdirSync(folder, {recursive: true});
          const compressedImages = [];
          const sourceList = job.driveAssets?.images || job.chromeDriveAssets?.images || [];
          for (let idx = 0; idx < 5; idx++) {
            const srcImg = sourceList[idx];
            if (!srcImg?.path || !fs.existsSync(srcImg.path)) throw fail('Thiếu file ảnh thứ ' + (idx + 1) + ' để nén cho Notion.');
            const raw = fs.readFileSync(srcImg.path);
            const processed = await require('./replacement-images.cjs').processImage(raw);
            const jpgFilename = String(idx + 1) + '-' + processed.hash.slice(0, 16) + '.jpg';
            const jpgFile = path.join(folder, jpgFilename);
            fs.writeFileSync(jpgFile, processed.buffer, {mode: 0o600});
            const {buffer: ignored, ...details} = processed;
            compressedImages.push({
              ...details,
              filename: jpgFilename,
              path: jpgFile,
              index: idx,
              ordinal: idx + 1,
              sourceHash: createHash('sha256').update(raw).digest('hex')
            });
          }
          job.generatedAssets = {jobId: job.id, source: 'compressed', images: compressedImages};
          this.save();
        }
        const assets = job.generatedAssets;
        this.checkFive(assets);
        const urls = await publisher.attachImages(this.i, job.notionUrl, assets, {reconcileOnly: !!job.imageAppendAttempted, beforeAppend: () => {job.imageAppendAttempted = true; this.save();}});
        if (!Array.isArray(urls) || urls.length !== 5 || new Set(urls).size !== 5 || urls.some(url => articleId(url) !== articleId(job.notionUrl) || !/^[a-f\d]{32}$/i.test(new URL(url).hash.slice(1).replace(/-/g, '')))) throw fail('Chưa xác minh đủ 5 ảnh ổn định thuộc bài Notion.');
        job.imageUrls = urls; this.save();
      }
      code = await this.code(job); this.validateWritten(job, code.article); if (code.article.approved !== true) throw fail('Bài Notion chưa được duyệt.');
      this.assertImageContent(job, code.article, true);
      if (!Array.isArray(code.article.images) || code.article.images.length && JSON.stringify(code.article.images) !== JSON.stringify(job.imageUrls)) throw fail('Ảnh JSON đã thay đổi khi gắn ảnh. Tool giữ nguyên chỉnh sửa của nhân viên.');
      const article = {...clone(code.article), images: clone(job.imageUrls), ...(job.driveFolderUrl ? {imageFolder: job.driveFolderUrl} : {})};
      if (textOnly(article)) this.validateWritten(job, article);
      else validateArticle(article, {shop: job.shop, productId: job.productId, name: job.sourceName});
      if (JSON.stringify(code.article) !== JSON.stringify(article)) await this.i.notion('blocks/' + code.id, 'PATCH', {code: {language: 'json', rich_text: rich(JSON.stringify(article, null, 2))}});
      const verified = await this.code(job);
      if (JSON.stringify(verified.article.images) !== JSON.stringify(job.imageUrls)) throw fail('Chưa xác minh JSON Notion có đủ 5 link ảnh.');
      this.assertImageContent(job, verified.article, true);
      job.article = clone(verified.article); job.name = job.article.product.name; job.description = job.article.product.description;
      const marker = 'SRM_LOCAL_DRIVE:' + job.id, blocks = await this.children(articleId(job.notionUrl));
      if (!blocks.some(block => block.type === 'paragraph' && plain(block.paragraph?.rich_text).includes(marker))) {
        if (job.folderAppendAttempted) throw fail('Chưa xác minh ghi chú thư mục ảnh trước. Tool không tự ghi chú trùng.', 'STUDIO_ATTACH_UNCERTAIN');
        job.folderAppendAttempted = true; this.save();
        await this.i.notion('blocks/' + articleId(job.notionUrl) + '/children', 'PATCH', {children: [paragraph(marker + '\nSRM_IMAGE_CONTENT_V1:' + job.imageContentDigest + '\nSRM_IMAGE_SOURCE_V1:' + job.imageSourceDigest + '\nẢnh lưu local: ' + (job.relativeDir || job.localFolder || '') + '\nLink thư mục Drive gốc: ' + (job.driveFolderUrl || 'Chưa cài link Drive gốc') + '\nẢnh đính kèm Notion bên trên là bản dưới 1,9 MB; link Drive gốc không phải link từng ảnh.')]});
      }
      await this.i.notion('pages/' + articleId(job.notionUrl), 'PATCH', {properties: {'Trạng thái': {select: {name: 'Đủ bài và ảnh'}}, 'Thư mục ảnh': {url: job.driveFolderUrl || null}}});
      await this.linkSource(job); job.imagesReady = true; job.status = 'attached';
      this.log(job, job.insight + ': đã gắn 5 ảnh và liên kết đúng sản phẩm nguồn. Chưa cập nhật Shopee.'); return this.publicJob(job);
    } catch (error) {job.status = 'attach-uncertain'; this.save(); throw error;}
  });}
  activate(id) {return this.task(id, async job => {
    if (!job.imagesReady || !job.notionUrl || !job.contentApproved || job.imageUrls?.length !== 5) throw fail('Cần đủ bài đã duyệt và 5 ảnh đã gắn Notion.');
    const row = this.row(job);
    let remote = await this.code(job);
    if (textOnly(remote.article)) {
      remote.article = await this.hydrate(job, row, remote);
    }
    validateArticle(remote.article, {shop: job.shop, productId: job.productId, name: job.sourceName});
    if (remote.article.approved !== true) throw fail('Bài Notion chưa được duyệt.');
    this.assertImageContent(job, remote.article, true);
    if (JSON.stringify(remote.article.images) !== JSON.stringify(job.imageUrls)) throw fail('Bộ ảnh bài Notion đã thay đổi. Kiểm tra lại trước khi chọn.');
    await this.linkSource(job); this.log(job, job.insight + ': đã chọn bài cho bản xem trước cập nhật Shopee.'); return {rowId: row.id, url: job.notionUrl};
  });}
  replaceProduct(id) {return this.task(id, async job => {
    if (!job.name || !job.description || !job.price) throw fail('Thiếu tên sản phẩm, mô tả hoặc giá bán để thay thế.');
    this.row(job);
    const priorStatus = job.status;
    job.status = 'replacing';
    this.save();
    try {
      if (!job.generatedAssets || !Array.isArray(job.generatedAssets.images) || job.generatedAssets.images.filter(Boolean).length !== 5) {
        this.log(job, job.insight + ': đang nén 5 ảnh sang chuẩn JPEG dưới 1,9 MB cho Shopee.');
        const folder = path.join(this.dir, 'assets', job.id, 'compressed');
        fs.mkdirSync(folder, {recursive: true});
        const compressedImages = [];
        const sourceList = job.driveAssets?.images || job.chromeDriveAssets?.images || [];
        for (let idx = 0; idx < 5; idx++) {
          const srcImg = sourceList[idx];
          if (!srcImg?.path || !fs.existsSync(srcImg.path)) throw fail('Thiếu file ảnh thứ ' + (idx + 1) + ' để nén cho Shopee.');
          const raw = fs.readFileSync(srcImg.path);
          const processed = await require('./replacement-images.cjs').processImage(raw);
          const jpgFilename = String(idx + 1) + '-' + processed.hash.slice(0, 16) + '.jpg';
          const jpgFile = path.join(folder, jpgFilename);
          fs.writeFileSync(jpgFile, processed.buffer, {mode: 0o600});
          const {buffer: ignored, ...details} = processed;
          compressedImages.push({
            ...details,
            filename: jpgFilename,
            path: jpgFile,
            index: idx,
            ordinal: idx + 1,
            sourceHash: createHash('sha256').update(raw).digest('hex')
          });
        }
        job.generatedAssets = {jobId: job.id, source: 'compressed', images: compressedImages};
        this.save();
      }
      this.checkFive(job.generatedAssets);

      const row = this.row(job);
      const target = this.replacements.target(row);
      target.sourceName = job.sourceName;
      target.desiredName = job.name;
      if (!target.profileId) throw fail('Sản phẩm chưa liên kết đúng profile Shopee.');

      this.log(job, job.insight + ': đang mở profile ' + job.shop + ', tìm sản phẩm ID ' + job.productId + ' trên Shopee...');
      const schema = await this.replacements.editor.inspect(target);

      const template = this.replacements.makeTemplate(row, schema);
      template.product.name = job.name;
      template.product.description = job.description;
      template.product.category = schema.category;
      if (schema.hasVariants) {
        const v = template.product.variants.find(m => m.modelId === job.modelId);
        if (v) v.price = job.price;
        for (const variant of template.product.variants) {
          const live = schema.variants.find(item => item.modelId === variant.modelId);
          if (live && Number.isSafeInteger(live.stock)) variant.stock = live.stock;
        }
      } else if (template.product.variants.length) {
        template.product.variants[0].price = job.price;
        if (schema.variants[0] && Number.isSafeInteger(schema.variants[0].stock)) {
          template.product.variants[0].stock = schema.variants[0].stock;
        }
      }
      template.images = job.generatedAssets.images.map(img => 'https://validation.local/' + img.filename);

      this.log(job, job.insight + ': đang thay thế 5 ảnh, tên, mô tả và giá lên Shopee...');
      const result = await this.replacements.editor.apply(target, template, job.generatedAssets, {submit: false});

      this.log(job, job.insight + ': Đã điền xong 5 ảnh, tên, mô tả và giá lên Shopee! Đang cập nhật Notion...');
      await this.replacements.ensureColumn();
      try {
        const dbId = this.products.data.databaseId || '3e070655a9aa816c98f4dc2c863fa5bb';
        const db = await this.i.notion('databases/' + dbId);
        if (db?.properties) {
          const patchProps = {};
          if (!db.properties['Ghi chú']) patchProps['Ghi chú'] = {rich_text: {}};
          if (!db.properties['Ghi chú thay thế']) patchProps['Ghi chú thay thế'] = {rich_text: {}};
          if (Object.keys(patchProps).length) {
            await this.i.notion('databases/' + db.id, 'PATCH', {properties: patchProps});
          }
        }
      } catch {}
      const oldName = target.name || job.sourceName || 'Sản phẩm cũ';
      const timeFormatted = new Date().toLocaleString('vi-VN', {hour12: false});
      const noteContent = `Sửa từ: ${oldName} (ID: ${job.productId}) lúc ${timeFormatted}`;

      const matchingRows = this.products.data.rows.filter(r => r.shop === job.shop && r.productId === job.productId);
      for (const r of matchingRows) {
        if (r.notionPageId) {
          try {
            const updateProps = {
              'Tên sản phẩm': {title: rich(job.name)},
              'Giá bán': {number: job.price},
              ['Cần thay thế']: {select: {name: 'Đã thay thế'}},
              ['Ghi chú']: {rich_text: rich(noteContent)},
              ['Ghi chú thay thế']: {rich_text: rich(noteContent)},
              'Quét lúc': {date: {start: new Date().toISOString()}}
            };
            await this.i.notion('pages/' + r.notionPageId, 'PATCH', {properties: updateProps});
          } catch (notionErr) {
            this.log(job, 'Lỗi cập nhật dòng sản phẩm Notion: ' + cleanError(notionErr.message));
          }
        }
        r.name = job.name;
        r.price = job.price;
        r.replacementStatus = 'Đã thay thế';
        r.scannedAt = new Date().toISOString();
        r.sync = 'synced';
      }
      this.products.save();

      if (job.notionUrl) {
        try {
          const articlePageId = articleId(job.notionUrl);
          if (job.imageUrls && job.imageUrls.length === 5) {
            try {
              const codeBlock = await this.code(job);
              if (codeBlock && (!codeBlock.article?.images || !codeBlock.article.images.length)) {
                const patchedArticle = {
                  ...codeBlock.article,
                  images: clone(job.imageUrls),
                  ...(job.driveFolderUrl ? {imageFolder: job.driveFolderUrl} : {})
                };
                await this.i.notion('blocks/' + codeBlock.id, 'PATCH', {
                  code: {language: 'json', rich_text: rich(JSON.stringify(patchedArticle, null, 2))}
                });
              }
            } catch {}
          }
          await this.i.notion('pages/' + articlePageId, 'PATCH', {
            properties: {
              'Trạng thái': {select: {name: 'Đã thay thế'}},
              'Tên sản phẩm': {title: rich(job.name)},
              'Giá bán': {number: job.price}
            }
          });
        } catch (artErr) {
          this.log(job, 'Lỗi cập nhật bài Notion: ' + cleanError(artErr.message));
        }
      }

      job.status = 'replaced';
      job.replacedAt = new Date().toISOString();
      delete job.error;
      this.log(job, job.insight + ': ĐÃ ĐIỀN XONG 5 ẢNH, TÊN, MÔ TẢ VÀ GIÁ LÊN SHOPEE! Nhân viên kiểm tra trên Chrome và bấm Cập nhật.');
      this.save();
      return this.publicJob(job);
    } catch (error) {
      if (job.status === 'replacing') job.status = priorStatus || 'attached';
      this.save();
      throw error;
    }
  });}
  async syncSourceToReplacements() {
    return this.task(null, async () => {
      const databaseId = await this.setup();
      let rows = this.products.data.rows || [];
      if (!rows.length && typeof this.products.load === 'function') {
        await this.products.load();
        rows = this.products.data.rows || [];
      }
      if (!rows.length) throw fail('Kho sản phẩm chưa có dữ liệu. Hãy đồng bộ kho sản phẩm trước.');

      const pages = await this.remoteJobs(databaseId);
      const pageByKey = new Map();
      for (const p of pages) {
        const props = p.properties || {};
        const s = plain(props['Tên shop']?.rich_text);
        const pid = plain(props['ID sản phẩm']?.rich_text);
        const mid = plain(props['Model ID']?.rich_text);
        if (s && pid) {
          pageByKey.set(s + '|' + pid + '|' + mid, p);
          if (!pageByKey.has(s + '|' + pid)) pageByKey.set(s + '|' + pid, p);
        }
      }

      let created = 0, updated = 0, unchanged = 0;
      const uniqueRows = new Map();
      for (const r of rows) {
        if (!r.shop || !r.productId) continue;
        const k = r.shop + '|' + r.productId + '|' + (r.modelId || '');
        if (!uniqueRows.has(k)) uniqueRows.set(k, r);
      }

      for (const r of uniqueRows.values()) {
        const k = r.shop + '|' + r.productId + '|' + (r.modelId || '');
        const existingPage = pageByKey.get(k) || pageByKey.get(r.shop + '|' + r.productId);

        if (existingPage) {
          const props = existingPage.properties || {};
          const currentSource = plain(props['Sản phẩm nguồn']?.rich_text) || plain(props['Sản phẩm gốc']?.rich_text);
          const patch = {};

          if (!currentSource || currentSource !== r.name) patch['Sản phẩm nguồn'] = {rich_text: rich(r.name)};
          if (!props['ID sản phẩm']?.rich_text?.length) patch['ID sản phẩm'] = {rich_text: rich(r.productId)};
          if (!props['Model ID']?.rich_text?.length && r.modelId) patch['Model ID'] = {rich_text: rich(r.modelId)};
          if (!props['Tên shop']?.rich_text?.length) patch['Tên shop'] = {rich_text: rich(r.shop)};
          if (props['Giá bán']?.number === undefined || props['Giá bán']?.number === null) patch['Giá bán'] = {number: r.price};
          if (!plain(props['Mã tác vụ']?.rich_text)) patch['Mã tác vụ'] = {rich_text: rich(randomUUID())};

          const currentTitle = plain(props['Tên sản phẩm']?.title).trim();
          const currentStatus = props['Trạng thái']?.select?.name || '';
          if (currentTitle && currentTitle !== r.name && (!currentStatus || currentStatus === 'Chưa có' || currentStatus === 'Chờ tên mới')) {
            patch['Trạng thái'] = {select: {name: 'Đã có'}};
          } else if (!currentStatus) {
            patch['Trạng thái'] = {select: {name: 'Chưa có'}};
          }

          if (Object.keys(patch).length > 0) {
            await this.i.notion('pages/' + existingPage.id, 'PATCH', {properties: patch});
            updated++;
          } else {
            unchanged++;
          }
        } else {
          const taskId = randomUUID();
          const newProps = {
            'Tên sản phẩm': {title: rich('')},
            'Sản phẩm gốc': {rich_text: rich(r.name)},
            'Sản phẩm nguồn': {rich_text: rich(r.name)},
            'Tên shop': {rich_text: rich(r.shop)},
            'ID sản phẩm': {rich_text: rich(r.productId)},
            'Model ID': {rich_text: rich(r.modelId || '')},
            'Giá bán': {number: r.price || 0},
            'Trạng thái': {select: {name: 'Chưa có'}},
            'Mã tác vụ': {rich_text: rich(taskId)},
            'Thư mục ảnh': {url: null}
          };
          const page = await this.i.notion('pages', 'POST', {
            parent: {database_id: databaseId},
            properties: newProps,
            children: [
              paragraph('Sản phẩm gốc: ' + r.shop + ' · ' + r.name + ' · ID ' + r.productId + (r.modelId ? ' · Model ' + r.modelId : ''))
            ]
          });
          pageByKey.set(k, page);
          created++;
        }
      }

      this.log(null, `Đã ánh xạ ${uniqueRows.size} sản phẩm kho sang Notion thay thế (tạo mới: ${created}, cập nhật: ${updated}, giữ nguyên: ${unchanged}).`);
      return {total: uniqueRows.size, created, updated, unchanged};
    });
  }
  async scanReplacements() {
    return this.task(null, async () => {
      const databaseId = await this.setup();
      const pages = await this.remoteJobs(databaseId);
      const loaded = [];
      const ids = new Set();

      for (const page of pages) {
        const p = page.properties || {};
        const titleProp = plain(p['Tên sản phẩm']?.title || p['Tên sản phẩm thay thế']?.title || p['Tên sản phẩm']?.rich_text).trim();
        const repNameProp = plain(p['Tên sản phẩm thay thế']?.rich_text || p['Sản phẩm thay thế']?.rich_text || p['Tên sản phẩm mới']?.rich_text).trim();
        const origin = plain(p['Sản phẩm gốc']?.rich_text || p['Sản phẩm nguồn']?.rich_text || p['Tên sản phẩm gốc']?.rich_text) || '';

        const title = repNameProp || (titleProp !== origin ? titleProp : (titleProp || ''));
        const rawStatus = (p['Trạng thái']?.select?.name || '').trim();
        const statusVal = rawStatus.toLowerCase();
        const isDaCo = statusVal.includes('đã có') || statusVal.includes('da co') || statusVal.includes('bài đã duyệt') || statusVal.includes('đủ ảnh') || statusVal.includes('đủ bài') || statusVal.includes('đã thay thế');
        const hasReplacementName = (repNameProp.length > 0) || (titleProp.length > 0 && titleProp.toLowerCase() !== origin.toLowerCase());
        const isReady = isDaCo || hasReplacementName;

        const taskId = plain(p['Mã tác vụ']?.rich_text) || page.id;
        if (ids.has(taskId)) continue;
        ids.add(taskId);

        const shop = plain(p['Tên shop']?.rich_text);
        const productId = plain(p['ID sản phẩm']?.rich_text);
        const modelId = plain(p['Model ID']?.rich_text);
        const priceVal = p['Giá bán']?.number;
        const insight = plain(p['Insight']?.rich_text) || origin;

        const row = this.products.data.rows.find(item => item.shop === shop && item.productId === productId && (!modelId || item.modelId === modelId)) ||
                    this.products.data.rows.find(item => item.shop === shop && item.productId === productId);
        const rowId = row?.id || '';
        const basePrice = row?.price || priceVal || 100000;

        let remoteJob = {
          id: taskId,
          rowId,
          shop,
          productId,
          modelId,
          sourceName: origin || row?.name || '',
          sourcePrice: basePrice,
          insight: insight || origin || row?.name || '',
          prompt: '',
          price: priceVal || basePrice,
          name: title,
          description: '',
          status: isReady ? 'draft' : 'waiting_name',
          notionStatus: isReady ? (rawStatus || 'Đã có') : (rawStatus || 'Chưa có'),
          isReplacementReady: isReady,
          contentApproved: false,
          imagesReady: false,
          notionUrl: pageUrl(page),
          driveFolderUrl: p['Thư mục ảnh']?.url || '',
          createdAt: new Date().toISOString()
        };

        if (hasReplacementName && !isDaCo && this.i?.notion) {
          try {
            await this.i.notion('pages/' + page.id, 'PATCH', {
              properties: {
                'Trạng thái': {select: {name: 'Đã có'}}
              }
            });
            remoteJob.notionStatus = 'Đã có';
          } catch {}
        }

        const needsCodeFetch = (
          statusVal.includes('bài đã duyệt') ||
          statusVal.includes('đã duyệt') ||
          statusVal.includes('đủ ảnh') ||
          statusVal.includes('đủ bài') ||
          statusVal.includes('đã thay thế')
        );

        if (needsCodeFetch) {
          try {
            const code = await this.code(remoteJob);
            if (code?.article?.schemaVersion === 1) {
              remoteJob.article = clone(code.article);
              if (title) remoteJob.article.product.name = title;
              remoteJob.name = title || remoteJob.article.product.name;
              remoteJob.description = remoteJob.article.product.description || '';
              remoteJob.contentApproved = remoteJob.article.approved === true;
              remoteJob.imageUrls = remoteJob.article.images || [];
              remoteJob.imagesReady = remoteJob.imageUrls.length === 5;
              remoteJob.status = remoteJob.imagesReady ? 'attached' : 'published';
            }
          } catch {}
        }

        const existing = this.data.jobs.find(j => j.id === taskId || (j.shop === shop && j.productId === productId && (!modelId || j.modelId === modelId)));
        loaded.push({existing, remote: remoteJob});
      }

      for (const {existing, remote} of loaded) {
        if (existing) {
          delete existing.deletedAt;
          if (remote.name) existing.name = remote.name;
          if (remote.sourceName) existing.sourceName = remote.sourceName;
          if (remote.notionUrl) existing.notionUrl = remote.notionUrl;
          if (remote.price) existing.price = remote.price;
          if (remote.notionStatus) existing.notionStatus = remote.notionStatus;
          existing.isReplacementReady = remote.isReplacementReady;
          if (remote.article) {
            existing.article = remote.article;
            existing.description = remote.description;
            existing.status = remote.status;
            existing.contentApproved = remote.contentApproved;
            existing.imagesReady = remote.imagesReady;
          }
          this.syncDriveAssets(existing);
        } else {
          this.syncDriveAssets(remote);
          this.data.jobs.push(remote);
        }
      }

      // Purge ghost jobs that are no longer in the Notion replacement table
      const validIds = new Set(loaded.map(x => x.remote.id));
      this.data.jobs = this.data.jobs.filter(j => validIds.has(j.id) || (j.shop && !j.notionUrl && j.status === 'draft'));

      this.save();
      this.log(null, `Đã quét ${loaded.length} sản phẩm thay thế từ Notion (${loaded.filter(x => x.remote.isReplacementReady).length} đã có tên).`);
      return this.snapshot();
    });
  }
  load() {return this.task(null, async () => {
    const databaseId = await this.setup(), pages = await this.remoteJobs(databaseId), ids = new Set(), loaded = [];
    for (const page of pages) {
      const p = page.properties || {}, id = plain(p['Mã tác vụ']?.rich_text); if (!id) continue;
      if (ids.has(id)) throw fail('Notion có nhiều bài cùng Mã tác vụ. Không tải dữ liệu trùng.'); ids.add(id);
      if (!/^[a-zA-Z\d_-]{8,100}$/.test(id)) throw fail('Mã tác vụ Notion không hợp lệ.');
      const origin = plain(p['Sản phẩm gốc']?.rich_text) || plain(p['Sản phẩm nguồn']?.rich_text);
      const remote = {id, shop: plain(p['Tên shop']?.rich_text), productId: plain(p['ID sản phẩm']?.rich_text), modelId: plain(p['Model ID']?.rich_text), sourceName: origin, insight: plain(p['Insight']?.rich_text) || origin, price: p['Giá bán']?.number, notionUrl: pageUrl(page), driveFolderUrl: p['Thư mục ảnh']?.url || '', status: 'published', contentApproved: true};
      const existing = this.data.jobs.find(job => job.id === id);
      if (existing && [identity(existing), existing.modelId, existing.sourceName].some((value, index) => value !== [identity(remote), remote.modelId, remote.sourceName][index])) throw fail('Tác vụ Notion có danh tính khác dữ liệu local.');
      const row = this.products.data.rows.find(item => item.shop === remote.shop && item.productId === remote.productId && item.modelId === remote.modelId && (item.name === remote.sourceName || !remote.sourceName)) || this.products.data.rows.find(item => item.shop === remote.shop && item.productId === remote.productId);
      remote.rowId = row?.id || existing?.rowId || '';
      let code = null;
      try { code = await this.code(remote); } catch {}
      if (code?.article) {
        remote.article = clone(code.article);
        remote.name = plain(p['Tên sản phẩm']?.title) || code.article.product?.name || '';
        remote.description = code.article.product?.description || '';
        remote.contentApproved = code.article.approved === true;
        this.validateWritten(remote, remote.article);
        if (remote.article.images?.length && remote.article.images.length !== 5) throw fail('Bài thay thế cần đúng 5 ảnh, hoặc chưa có ảnh.');
        remote.imageUrls = remote.article.images || []; remote.imagesReady = remote.imageUrls.length === 5; remote.status = remote.imagesReady ? 'attached' : 'published';
        if (remote.imagesReady) {
          const notes = (await this.children(articleId(remote.notionUrl))).filter(block => block.type === 'paragraph' && plain(block.paragraph?.rich_text).includes('SRM_LOCAL_DRIVE:' + remote.id));
          if (notes.length > 1) throw fail('Notion có ghi chú bộ ảnh trùng. Kiểm tra bài trước khi chọn.');
          const note = plain(notes[0]?.paragraph?.rich_text);
          remote.imageContentDigest = /SRM_IMAGE_CONTENT_V1:([a-f\d]{64})/.exec(note)?.[1] || existing?.imageContentDigest;
          remote.imageSourceDigest = /SRM_IMAGE_SOURCE_V1:([a-f\d]{64})/.exec(note)?.[1] || existing?.imageSourceDigest;
          this.assertImageContent(remote, remote.article, true);
        }
      } else {
        remote.name = plain(p['Tên sản phẩm']?.title) || '';
        remote.description = '';
        remote.contentApproved = false;
        remote.imagesReady = false;
        remote.status = 'draft';
      }
      if (existing?.baseline) remote.baseline = existing.baseline;
      remote.index = existing?.index || Number(/^Insight (\d+)$/.exec(remote.insight)?.[1]) || 0; loaded.push({existing, remote});
    }
    for (const {existing, remote} of loaded) {
      if (existing) {
        delete existing.deletedAt;
        Object.assign(existing, remote);
        this.syncDriveAssets(existing);
      } else {
        const item = {...remote, prompt: '', createdAt: new Date().toISOString()};
        this.syncDriveAssets(item);
        this.data.jobs.push(item);
      }
    }
    for (const job of this.data.jobs) {
      if (job.notionUrl && !ids.has(job.id)) {
        delete job.notionUrl;
        if (job.status === 'published' || job.status === 'attached') job.status = 'draft';
      }
    }
    this.log(null, 'Đã đọc ' + loaded.length + ' bài từ bảng Sản phẩm thay thế, giữ các bản nháp local.'); return this.snapshot();
  });}
}
module.exports = {ReplacementStudio, PARENT_ID, TABLE_NAME, SCHEMA};
