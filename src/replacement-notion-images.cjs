const fs = require('node:fs');
const {createHash} = require('node:crypto');
const sharp = require('sharp');
const {articleId} = require('./replacements.cjs');
const MAX_BYTES = 1900000;
const ID = /^[a-f\d]{32}$/i;
const rich = value => [{type: 'text', text: {content: String(value).slice(0, 1800)}}];
const plain = value => (value || []).map(item => item.plain_text ?? item.text?.content ?? '').join('');
const blockId = value => typeof value === 'string' && ID.test(value.replace(/-/g, '')) ? value.replace(/-/g, '').toLowerCase() : null;

function imageError(message, code = 'NOTION_IMAGE_INVALID') {
  const error = Error(message); error.code = code; return error;
}
function secureUrl(value) {
  let url; try { url = new URL(value); } catch { throw imageError('Link ảnh không hợp lệ.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443') throw imageError('Link ảnh phải dùng HTTPS không chứa tài khoản.');
  return url;
}
async function inspectAsset(asset) {
  if (!asset?.path || !asset.filename || /[\/\\\u0000]/.test(asset.filename)) throw imageError('File ảnh Notion không hợp lệ.');
  const buffer = fs.readFileSync(asset.path);
  if (!buffer.length || buffer.length > MAX_BYTES) throw imageError('Ảnh Notion phải là JPEG dưới 1,9 MB.');
  const hash = createHash('sha256').update(buffer).digest('hex');
  if (asset.hash && asset.hash !== hash) throw imageError('Ảnh đã thay đổi sau khi nén. Hãy chuẩn bị lại.');
  let metadata; try { metadata = await sharp(buffer, {limitInputPixels: 40000000}).metadata(); } catch { throw imageError('File ảnh Notion không đọc được.'); }
  if (metadata.format !== 'jpeg' || !metadata.width || !metadata.height) throw imageError('Ảnh Notion phải là JPEG dưới 1,9 MB.');
  return {buffer, hash, width: metadata.width, height: metadata.height, bytes: buffer.length};
}

async function uploadImage(integrations, asset, {marker = ''} = {}) {
  const details = await inspectAsset(asset), token = integrations.secrets?.()?.notionToken;
  if (!token) throw imageError('Chưa có Notion token.');
  const upload = await integrations.notion('file_uploads', 'POST', {mode: 'single_part', filename: asset.filename, content_type: 'image/jpeg'});
  if (typeof upload.id !== 'string' || !/^[a-zA-Z\d_-]{1,100}$/.test(upload.id)) throw imageError('Notion trả ID tải ảnh không hợp lệ.');
  const endpoint = secureUrl(upload.upload_url);
  if (endpoint.hostname !== 'api.notion.com' || endpoint.pathname !== '/v1/file_uploads/' + upload.id + '/send' || endpoint.search || endpoint.hash) throw imageError('Notion trả địa chỉ tải ảnh không hợp lệ.');
  const form = new FormData(); form.append('file', new Blob([details.buffer], {type: 'image/jpeg'}), asset.filename);
  const result = await integrations.request(endpoint.href, {method: 'POST', redirect: 'error', headers: {Authorization: 'Bearer ' + token, 'Notion-Version': '2022-06-28'}, body: form});
  if (result.status !== 'uploaded' || result.id !== upload.id) throw imageError('Chưa xác minh tải ảnh vào Notion.');
  const caption = `${asset.filename} · ${details.width}×${details.height} · ${details.bytes} byte${marker ? ' · ' + marker : ''}`;
  return {object: 'block', type: 'image', image: {type: 'file_upload', file_upload: {id: upload.id}, caption: rich(caption)}};
}

async function belongsToPage(integrations, block, pageId) {
  const visited = new Set();
  for (let depth = 0; depth <= 8; depth++) {
    if (block.parent?.type === 'page_id') return blockId(block.parent.page_id) === pageId;
    const parent = block.parent?.type === 'block_id' && blockId(block.parent.block_id);
    if (!parent || visited.has(parent)) return false;
    visited.add(parent); block = await integrations.notion('blocks/' + parent);
    if (block.archived || block.in_trash) return false;
  }
  return false;
}
async function resolveImages(integrations, sources) {
  if (!Array.isArray(sources) || !sources.length || sources.length > 9) throw imageError('Cần từ 1 đến 9 link ảnh.');
  const result = [];
  for (const source of sources) {
    const url = secureUrl(source);
    if (['notion.so', 'www.notion.so', 'app.notion.com', 'www.notion.com'].includes(url.hostname)) {
      const imageId = blockId(url.hash.replace(/^#/, ''));
      if (!imageId) throw imageError('Link ảnh Notion cần ID khối ảnh sau dấu #.');
      const pageId = articleId(source), block = await integrations.notion('blocks/' + imageId);
      if (block.archived || block.in_trash || block.type !== 'image') throw imageError('Khối ảnh Notion không còn tồn tại.');
      if (!await belongsToPage(integrations, block, pageId)) throw imageError('Khối ảnh không thuộc bài viết Notion trong link.');
      const value = block.image?.file?.url || block.image?.external?.url;
      if (!value) throw imageError('Notion chưa có link tải ảnh.'); secureUrl(value); result.push(value);
    } else result.push(source);
  }
  return result;
}

async function readChildren(integrations, pageId) {
  const results = [], seen = new Set(); let cursor;
  do {
    const page = await integrations.notion('blocks/' + pageId + '/children?page_size=100' + (cursor ? '&start_cursor=' + encodeURIComponent(cursor) : ''));
    if (!Array.isArray(page.results)) throw imageError('Notion trả danh sách ảnh không hợp lệ.');
    results.push(...page.results); if (results.length > 1000) throw imageError('Bài viết quá lớn để đối chiếu ảnh.');
    cursor = page.has_more ? page.next_cursor : null;
    if (page.has_more && !cursor || cursor && seen.has(cursor)) throw imageError('Notion trả phân trang ảnh không hợp lệ.');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return results;
}
function findImages(blocks, markers, pageId) {
  return markers.map(marker => {
    const matches = blocks.filter(block => !block.archived && !block.in_trash && block.type === 'image' && plain(block.image?.caption).includes(marker));
    if (matches.length > 1) throw imageError('Bài viết có ảnh nén trùng; kiểm tra Notion trước khi gắn thêm.');
    if (!matches.length) return null;
    const id = blockId(matches[0].id); if (!id) throw imageError('Notion trả ID khối ảnh không hợp lệ.');
    return 'https://www.notion.so/' + pageId + '#' + id;
  });
}
async function attachImages(integrations, pageUrl, assets, {reconcileOnly = false, beforeAppend = () => {}} = {}) {
  const pageId = articleId(pageUrl);
  if (!Array.isArray(assets?.images) || !assets.images.length || assets.images.length > 9) throw imageError('Cần từ 1 đến 9 ảnh đã nén để gắn vào Notion.');
  const markers = [];
  for (let index = 0; index < assets.images.length; index++) {
    const details = await inspectAsset(assets.images[index]); markers.push('SRM_IMAGE_V1:' + details.hash + ':' + index);
  }
  const existing = await readChildren(integrations, pageId), links = findImages(existing, markers, pageId), pending = [];
  if (reconcileOnly && links.some(link => !link)) throw imageError('Lượt gắn ảnh trước chưa xác minh đầy đủ. Tool chỉ đối chiếu ảnh có sẵn, không tự gắn lần hai.', 'NOTION_IMAGE_ATTACH_UNCERTAIN');
  for (let index = 0; index < assets.images.length; index++) if (!links[index]) pending.push(await uploadImage(integrations, assets.images[index], {marker: markers[index]}));
  if (pending.length) {
    let failure;
    await beforeAppend();
    try {
      const attached = await integrations.notion('blocks/' + pageId + '/children', 'PATCH', {children: pending});
      if (!Array.isArray(attached.results) || attached.results.length !== pending.length || attached.results.some(block => block.type !== 'image' || !blockId(block.id))) throw imageError('Chưa xác minh đầy đủ ảnh Notion.');
    } catch (error) { failure = error; }
    // An append can succeed while its response times out. Read markers before
    // deciding whether another upload or append is needed on a later retry.
    let after;
    try { after = findImages(await readChildren(integrations, pageId), markers, pageId); }
    catch (error) { const uncertain = imageError('Chưa xác minh ảnh đã gắn vào Notion. Kiểm tra bài viết trước khi thử tiếp.', 'NOTION_IMAGE_ATTACH_UNCERTAIN'); uncertain.cause = failure || error; throw uncertain; }
    if (after.some(link => !link)) {
      const uncertain = imageError('Chưa xác minh đầy đủ ảnh đã gắn vào Notion. Lần thử tiếp đối chiếu ảnh có sẵn trước khi gắn.', 'NOTION_IMAGE_ATTACH_UNCERTAIN'); uncertain.cause = failure; throw uncertain;
    }
    if (new Set(after).size !== after.length) throw imageError('Notion trả link ảnh bị trùng. Kiểm tra bài viết trước khi thử tiếp.');
    return after;
  }
  return links;
}
module.exports = {uploadImage, resolveImages, attachImages};
