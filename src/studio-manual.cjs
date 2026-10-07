const fs = require('node:fs');
const path = require('node:path');
const {createHash, randomUUID} = require('node:crypto');
const {processImage, MAX_SOURCE_BYTES, MAX_PIXELS, MIN_DIMENSION} = require('./replacement-images.cjs');
const templates = require('./prompts/shopee-images.json');

const hash = data => createHash('sha256').update(data).digest('hex');
const labels = ['Ảnh bìa', 'Thành phần nổi bật', 'Công dụng chính', 'Cách dùng', 'Điểm tin cậy'];
const invalid = message => Object.assign(Error(message), {code: 'STUDIO_LOCAL_IMAGE_INVALID'});
const contained = (root, file) => {const relative = path.relative(root, file); return !!relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);};

function manualPrompts(article, insight) {
  if (!Array.isArray(templates) || templates.length !== 5 || templates.some(value => typeof value !== 'string')) throw invalid('Cần đúng 5 mẫu prompt tạo ảnh.');
  return templates.map((template, index) => ({index: index + 1, title: labels[index], text: template
    .replaceAll('{{selected_notion_content}}', article.product.name + '\n' + article.product.description)
    .replaceAll('{{selected_keywords}}', insight || '')
    .replaceAll('{{image_sample}}', 'tự thiết kế đồng bộ')}));
}

function regular(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw invalid('File ảnh phải là file thường, không được là liên kết ngoài.');
  return stat;
}

async function prepareLocalImages(filePaths) {
  if (!Array.isArray(filePaths) || filePaths.length !== 5 || filePaths.some(file => typeof file !== 'string' || !path.isAbsolute(file) || file.includes('\0'))) throw invalid('Chọn đúng 5 file ảnh theo thứ tự ảnh 1 đến ảnh 5.');
  const images = [];
  for (let index = 0; index < 5; index++) {
    const file = filePaths[index]; let before, handle, buffer;
    try {
      before = regular(file);
      if (!before.size || before.size > MAX_SOURCE_BYTES) throw invalid('Ảnh ' + (index + 1) + ' trống hoặc vượt 25 MB.');
      handle = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      const opened = fs.fstatSync(handle);
      if (!opened.isFile() || opened.size !== before.size || opened.dev !== before.dev || opened.ino !== before.ino) throw invalid('File ảnh đã thay đổi khi mở. Chọn lại bộ ảnh.');
      buffer = fs.readFileSync(handle);
      const after = regular(file);
      if (buffer.length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.dev !== before.dev || after.ino !== before.ino) throw invalid('File ảnh đã thay đổi khi đọc. Chọn lại bộ ảnh.');
    } catch (error) {
      if (error.code === 'STUDIO_LOCAL_IMAGE_INVALID') throw error;
      throw invalid('Không đọc được ảnh ' + (index + 1) + '. Chọn file ảnh có sẵn trên máy.');
    } finally {if (handle !== undefined) fs.closeSync(handle);}
    let source;
    try {source = await require('sharp')(buffer, {limitInputPixels: MAX_PIXELS, failOn: 'error', animated: false}).timeout({seconds: 10}).metadata();}
    catch {throw invalid('Ảnh ' + (index + 1) + ' hỏng hoặc vượt 40 triệu điểm ảnh.');}
    if (!['png', 'jpeg', 'webp'].includes(source.format) || (source.pages || 1) !== 1 || source.width < MIN_DIMENSION || source.height < MIN_DIMENSION || source.width * source.height > MAX_PIXELS) throw invalid('Ảnh ' + (index + 1) + ' phải là PNG, JPEG hoặc WebP tĩnh, tối thiểu 500 × 500 và tối đa 40 triệu điểm ảnh.');
    const processed = await processImage(buffer), sourceHash = hash(buffer);
    images.push({...processed, sourceHash, sourceFilename: path.basename(file), sourceBytes: buffer.length, sourceFormat: source.format,
      filename: String(index + 1) + '-' + processed.hash.slice(0, 16) + '.jpg'});
  }
  if (new Set(images.map(image => image.hash)).size !== 5) throw invalid('Cần đủ 5 ảnh khác nhau sau khi nén; bộ ảnh đang có ảnh trùng.');
  return {importDigest: hash(JSON.stringify(images.map(image => image.sourceHash))), images};
}

function assetDirectory(dir, id) {
  if (!path.isAbsolute(dir) || !/^[A-Za-z\d_-]{8,100}$/.test(id || '')) throw invalid('Thư mục dữ liệu hoặc mã tác vụ ảnh không hợp lệ.');
  const root = fs.realpathSync(dir); let folder = root;
  for (const name of ['assets', id]) {
    folder = path.join(folder, name);
    if (!contained(root, folder) || fs.existsSync(folder) && (!fs.lstatSync(folder).isDirectory() || fs.lstatSync(folder).isSymbolicLink())) throw invalid('Thư mục ảnh không được là liên kết ngoài dữ liệu ứng dụng.');
    if (!fs.existsSync(folder)) fs.mkdirSync(folder);
    if (!contained(root, fs.realpathSync(folder))) throw invalid('Thư mục ảnh nằm ngoài dữ liệu ứng dụng.');
  }
  return folder;
}

function commitLocalImages(dir, jobId, prepared, existing) {
  const parent = assetDirectory(dir, jobId), folder = path.join(parent, 'manual-' + prepared.importDigest);
  const images = prepared.images.map(({buffer, ...details}) => ({...details, path: path.join(folder, details.filename)}));
  const result = {jobId, source: 'manual', importDigest: prepared.importDigest, images};
  const manifest = JSON.stringify({version: 1, jobId, importDigest: prepared.importDigest, images: images.map(({path: ignored, previewDataUrl: ignoredPreview, ...details}) => details)});
  const verify = () => {
    if (!fs.existsSync(folder) || fs.lstatSync(folder).isSymbolicLink() || !fs.lstatSync(folder).isDirectory() || !contained(parent, fs.realpathSync(folder))) throw invalid('Thư mục bộ ảnh đã thay đổi. Tool giữ nguyên dữ liệu để kiểm tra.');
    const manifestFile = path.join(folder, 'manual-manifest.json'); regular(manifestFile);
    if (fs.readFileSync(manifestFile, 'utf8') !== manifest) throw invalid('Bộ ảnh đã lưu khác dữ liệu được chọn. Không ghi đè ảnh.');
    for (const image of images) {regular(image.path); if (hash(fs.readFileSync(image.path)) !== image.hash) throw invalid('Ảnh đã lưu đã thay đổi. Không ghi đè ảnh.');}
  };
  if (existing) {
    if (existing.jobId !== jobId || existing.importDigest !== prepared.importDigest || existing.images?.length !== 5 || existing.images.some((image, index) => image.path !== images[index].path || image.hash !== images[index].hash || image.sourceHash !== images[index].sourceHash)) throw invalid('Bộ ảnh khác bộ ảnh đã lưu. Không ghi đè ảnh.');
    verify(); return existing;
  }
  if (fs.existsSync(folder)) {verify(); return result;}
  const staging = path.join(parent, '.manual-import-' + randomUUID()); fs.mkdirSync(staging);
  try {
    for (const image of prepared.images) fs.writeFileSync(path.join(staging, image.filename), image.buffer, {flag: 'wx', mode: 0o600});
    fs.writeFileSync(path.join(staging, 'manual-manifest.json'), manifest, {flag: 'wx', mode: 0o600});
    // Commit the complete set together; no authoritative set exists while files are being written.
    fs.renameSync(staging, folder); verify(); return result;
  } finally {
    if (fs.existsSync(staging) && contained(parent, fs.realpathSync(staging)) && !fs.lstatSync(staging).isSymbolicLink()) {
      for (const entry of fs.readdirSync(staging)) fs.unlinkSync(path.join(staging, entry));
      fs.rmdirSync(staging);
    }
  }
}

module.exports = {manualPrompts, prepareLocalImages, commitLocalImages};
