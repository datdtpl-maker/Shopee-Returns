const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 1900000;
const MAX_PIXELS = 40000000;
const MIN_DIMENSION = 500;
const IMAGE_HOSTS = new Set([
  'drive.google.com',
  'drive.usercontent.google.com',
  'lh3.googleusercontent.com',
  'prod-files-secure.s3.us-west-2.amazonaws.com',
  's3.us-west-2.amazonaws.com',
  'secure.notion-static.com',
  'down-vn.img.susercontent.com',
  'cf.shopee.vn',
]);
const FILE_ID = /^[A-Za-z0-9_-]{10,200}$/;

function imageError(message, code = 'REPLACEMENT_IMAGE_INVALID') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function limit(value, fallback, minimum, maximum) {
  const result = value === undefined ? fallback : value;
  if (!Number.isInteger(result) || result < minimum || result > maximum) {
    throw imageError('Giới hạn xử lý ảnh không hợp lệ.');
  }
  return result;
}

function validateSourceUrl(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 8192) {
    throw imageError('Link ảnh không hợp lệ.');
  }
  let url;
  try { url = new URL(value.trim()); } catch { throw imageError('Link ảnh không hợp lệ.'); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !IMAGE_HOSTS.has(url.hostname)) {
    throw imageError('Chỉ hỗ trợ link ảnh HTTPS từ Google Drive, Shopee hoặc bộ lưu trữ ảnh Notion.');
  }
  if (url.hostname === 's3.us-west-2.amazonaws.com' && !url.pathname.startsWith('/secure.notion-static.com/')) {
    throw imageError('Link S3 phải thuộc kho ảnh Notion.');
  }
  if (url.hostname === 'drive.google.com') {
    if (/\/folders\//i.test(url.pathname)) {
      throw imageError('Đây là link thư mục Drive. Cần đọc danh sách file ảnh trong thư mục trước.');
    }
    const id = url.pathname.match(/^\/file\/d\/([A-Za-z0-9_-]+)(?:\/|$)/)?.[1] ||
      (['/uc', '/open'].includes(url.pathname) ? url.searchParams.get('id') : null);
    if (!id || !FILE_ID.test(id)) throw imageError('Link Google Drive phải chỉ đến một file ảnh.');
  }
  if (url.hostname === 'drive.usercontent.google.com') {
    if (url.pathname !== '/download' || !FILE_ID.test(url.searchParams.get('id') || '')) {
      throw imageError('Link tải Google Drive không hợp lệ.');
    }
  }
  if (url.hostname === 'lh3.googleusercontent.com' && !/^\/d\/[A-Za-z0-9_-]{10,200}(?:=|$)/.test(url.pathname)) {
    throw imageError('Link ảnh Google Drive không hợp lệ.');
  }
  url.hash = '';
  return url;
}

function sourceInfo(value) {
  const url = validateSourceUrl(value);
  let downloadUrl = url.href;
  let sourceUrl = url.origin + url.pathname;
  if (url.hostname === 'drive.google.com') {
    const id = url.pathname.match(/^\/file\/d\/([A-Za-z0-9_-]+)(?:\/|$)/)?.[1] || url.searchParams.get('id');
    sourceUrl = `https://drive.google.com/file/d/${id}/view`;
    downloadUrl = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`;
  } else if (url.hostname === 'drive.usercontent.google.com') {
    const id = url.searchParams.get('id');
    sourceUrl = `https://drive.google.com/file/d/${id}/view`;
    downloadUrl = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`;
  }
  return {downloadUrl, sourceUrl, sourceKind: url.hostname.includes('google') ? 'drive' : url.hostname.includes('shopee') || url.hostname.includes('susercontent') ? 'shopee' : 'notion'};
}

function hash(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }

function magicFormat(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  throw imageError('File phải là ảnh JPEG, PNG hoặc WebP thật; không hỗ trợ HTML, SVG hoặc file động.');
}

async function downloadImage(value, options = {}) {
  const source = sourceInfo(value);
  const maxBytes = limit(options.maxSourceBytes, MAX_SOURCE_BYTES, 1, MAX_SOURCE_BYTES);
  const timeoutMs = limit(options.timeoutMs, 25000, 1, 60000);
  const fetchImpl = options.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw imageError('Máy chưa hỗ trợ tải ảnh.');
  const controller = new AbortController();
  let timer, abortListener;
  const timedOut = imageError('Tải ảnh quá thời gian cho phép. Kiểm tra quyền chia sẻ Drive.', 'REPLACEMENT_IMAGE_TIMEOUT');
  const aborted = imageError('Đã dừng tải ảnh.', 'REPLACEMENT_IMAGE_ABORTED');
  const interruption = new Promise((resolve, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(timedOut); }, timeoutMs);
    if (options.signal) {
      abortListener = () => { controller.abort(); reject(aborted); };
      if (options.signal.aborted) abortListener();
      else options.signal.addEventListener('abort', abortListener, {once: true});
    }
  });
  const operation = (async () => {
    let current = source.downloadUrl;
    for (let redirects = 0; redirects <= 4; redirects++) {
      if (controller.signal.aborted) throw aborted;
      current = validateSourceUrl(current).href;
      const response = await fetchImpl(current, {
        method: 'GET', redirect: 'manual', credentials: 'omit', signal: controller.signal,
        headers: {'Accept': 'image/jpeg,image/png,image/webp,application/octet-stream'},
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel?.().catch(() => {});
        if (!location || redirects === 4) throw imageError('Link ảnh chuyển hướng quá nhiều lần.');
        try { current = validateSourceUrl(new URL(location, current).href).href; }
        catch { throw imageError('Link ảnh chuyển hướng đến địa chỉ không được phép.'); }
        continue;
      }
      if (response.status !== 200) {
        await response.body?.cancel?.().catch(() => {});
        throw imageError(`Không tải được ảnh (HTTP ${response.status}). Kiểm tra quyền chia sẻ file.`, 'REPLACEMENT_IMAGE_DOWNLOAD');
      }
      const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (contentType && !['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream', 'binary/octet-stream'].includes(contentType)) {
        await response.body?.cancel?.().catch(() => {});
        throw imageError('Link trả về trang đăng nhập hoặc loại file không phải ảnh. Kiểm tra quyền chia sẻ Drive.');
      }
      const contentLength = response.headers.get('content-length');
      if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maxBytes) {
        await response.body?.cancel?.().catch(() => {});
        throw imageError('Ảnh nguồn vượt giới hạn 25 MB.');
      }
      if (!response.body || typeof response.body[Symbol.asyncIterator] !== 'function') {
        throw imageError('Không đọc được dữ liệu ảnh tải xuống.');
      }
      const chunks = [];
      let bytes = 0;
      for await (const chunk of response.body) {
        if (controller.signal.aborted) throw aborted;
        const part = Buffer.from(chunk);
        bytes += part.length;
        if (bytes > maxBytes) {
          controller.abort();
          throw imageError('Ảnh nguồn vượt giới hạn 25 MB.');
        }
        chunks.push(part);
      }
      const buffer = Buffer.concat(chunks, bytes);
      magicFormat(buffer);
      return {...source, buffer, sourceBytes: bytes, sourceHash: hash(buffer)};
    }
    throw imageError('Không tải được ảnh.');
  })();
  try {
    return await Promise.race([operation, interruption]);
  } catch (error) {
    if (error.code?.startsWith('REPLACEMENT_IMAGE')) throw error;
    if (controller.signal.aborted) throw options.signal?.aborted ? aborted : timedOut;
    throw imageError('Không tải được ảnh. Kiểm tra mạng và quyền chia sẻ file.', 'REPLACEMENT_IMAGE_DOWNLOAD');
  } finally {
    clearTimeout(timer);
    if (abortListener) options.signal.removeEventListener('abort', abortListener);
  }
}

async function processImage(buffer, options = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_SOURCE_BYTES) {
    throw imageError('Ảnh nguồn trống hoặc vượt giới hạn 25 MB.');
  }
  const format = magicFormat(buffer);
  const sharp = options.sharp || require('sharp');
  const maxPixels = limit(options.maxPixels, MAX_PIXELS, 1, MAX_PIXELS);
  const maxBytes = limit(options.maxOutputBytes, MAX_OUTPUT_BYTES, 1000, MAX_OUTPUT_BYTES);
  const maxDimension = limit(options.maxDimension, 2000, MIN_DIMENSION, 2500);
  const square = options.square !== false;
  let metadata;
  try {
    metadata = await sharp(buffer, {limitInputPixels: maxPixels, failOn: 'error', animated: false}).timeout({seconds: 10}).metadata();
  } catch { throw imageError('Không giải mã được ảnh, file hỏng hoặc kích thước ảnh quá lớn.'); }
  if (metadata.format !== format || !metadata.width || !metadata.height || metadata.width * metadata.height > maxPixels || (metadata.pages || 1) > 1) {
    throw imageError('Ảnh hỏng, động hoặc vượt giới hạn điểm ảnh.');
  }
  const rotated = [5, 6, 7, 8].includes(metadata.orientation);
  const sourceWidth = rotated ? metadata.height : metadata.width;
  const sourceHeight = rotated ? metadata.width : metadata.height;
  const initialSize = Math.max(MIN_DIMENSION, Math.min(maxDimension, Math.max(sourceWidth, sourceHeight)));
  const candidates = [...new Set([initialSize, 1600, 1200, 900, 700, MIN_DIMENSION].filter(size => size <= initialSize))];
  const startedAt = Date.now();
  for (const size of candidates) {
    const scale = Math.min(size / sourceWidth, size / sourceHeight);
    const width = square ? size : Math.max(MIN_DIMENSION, Math.round(sourceWidth * scale));
    const height = square ? size : Math.max(MIN_DIMENSION, Math.round(sourceHeight * scale));
    for (const quality of [90, 84, 76, 68, 60, 52]) {
      if (options.signal?.aborted) throw imageError('Đã dừng xử lý ảnh.', 'REPLACEMENT_IMAGE_ABORTED');
      if (Date.now() - startedAt > 45000) throw imageError('Xử lý ảnh quá thời gian cho phép.', 'REPLACEMENT_IMAGE_TIMEOUT');
      let result;
      try {
        result = await sharp(buffer, {limitInputPixels: maxPixels, failOn: 'error', animated: false})
          .rotate().toColorspace('srgb').flatten({background: '#ffffff'})
          .resize({width, height, fit: 'contain', background: '#ffffff'})
          .jpeg({quality, progressive: true, chromaSubsampling: '4:4:4'})
          .timeout({seconds: 10}).toBuffer({resolveWithObject: true});
      } catch { throw imageError('Không nén được ảnh. File nguồn có thể đã hỏng.'); }
      if (result.data.length < maxBytes && result.info.width >= MIN_DIMENSION && result.info.height >= MIN_DIMENSION) {
        const preview = await sharp(result.data).resize({width: 180, height: 180, fit: 'inside'}).jpeg({quality: 70}).timeout({seconds: 5}).toBuffer();
        return {
          buffer: result.data, hash: hash(result.data), bytes: result.data.length,
          width: result.info.width, height: result.info.height, mimeType: 'image/jpeg', quality,
          sourceWidth, sourceHeight, orientationApplied: Boolean(metadata.orientation && metadata.orientation !== 1),
          padded: sourceWidth / sourceHeight !== width / height,
          upscaled: sourceWidth < width && sourceHeight < height,
          previewDataUrl: 'data:image/jpeg;base64,' + preview.toString('base64'),
        };
      }
    }
  }
  throw imageError('Không thể tạo ảnh dưới 1,9 MB với kích thước tối thiểu 500 × 500.');
}

function contained(root, target) {
  const relative = path.relative(root, target);
  return !relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function planDirectory(dir, id) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir) || !/^[A-Za-z0-9_-]{8,100}$/.test(id || '')) {
    throw imageError('Thư mục dữ liệu hoặc mã kế hoạch ảnh không hợp lệ.');
  }
  fs.mkdirSync(dir, {recursive: true});
  const root = fs.realpathSync(dir);
  const assets = path.join(root, 'replacement-assets');
  if (fs.existsSync(assets) && fs.lstatSync(assets).isSymbolicLink()) throw imageError('Thư mục ảnh không được là liên kết ngoài.');
  fs.mkdirSync(assets, {recursive: true});
  const target = path.join(assets, id);
  if (!contained(assets, target) || (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink())) {
    throw imageError('Thư mục kế hoạch ảnh không hợp lệ.');
  }
  fs.mkdirSync(target, {recursive: true});
  if (!contained(root, fs.realpathSync(target))) throw imageError('Thư mục ảnh nằm ngoài dữ liệu ứng dụng.');
  return target;
}

function writeAtomic(file, contents) {
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw imageError('File ảnh không được là liên kết ngoài.');
  const temporary = path.join(path.dirname(file), `.write-${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, contents, {flag: 'wx', mode: 0o600});
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

async function prepareImages(sources, dir, id, options = {}) {
  if (!Array.isArray(sources) || sources.length < 1 || sources.length > 9) {
    throw imageError('Cần từ 1 đến 9 ảnh sản phẩm.');
  }
  const urls = sources.map(source => typeof source === 'string' ? source : source?.url);
  urls.forEach(sourceInfo);
  if (new Set(urls.map(url => sourceInfo(url).sourceUrl)).size !== urls.length) {
    throw imageError('Danh sách ảnh có link trùng.');
  }
  const target = planDirectory(dir, id);
  const lockFile = path.join(target, '.preparing');
  let lock;
  try { lock = fs.openSync(lockFile, 'wx', 0o600); }
  catch { throw imageError('Kế hoạch ảnh đang được xử lý. Hãy chờ tác vụ hiện tại kết thúc.'); }
  const manifestPath = path.join(target, 'manifest.json');
  const manifest = {version: 1, id, status: 'preparing', square: options.square !== false, createdAt: new Date().toISOString(), images: []};
  try {
    writeAtomic(manifestPath, JSON.stringify(manifest, null, 2));
    for (let index = 0; index < urls.length; index++) {
      const downloaded = await downloadImage(urls[index], options);
      const result = await processImage(downloaded.buffer, options);
      const filename = `${String(index + 1).padStart(2, '0')}-${result.hash.slice(0, 20)}.jpg`;
      const file = path.join(target, filename);
      writeAtomic(file, result.buffer);
      const {buffer, ...details} = result;
      manifest.images.push({index, filename, sourceUrl: downloaded.sourceUrl, sourceKind: downloaded.sourceKind, sourceHash: downloaded.sourceHash, sourceBytes: downloaded.sourceBytes, ...details});
      writeAtomic(manifestPath, JSON.stringify(manifest, null, 2));
    }
    manifest.status = 'ready';
    manifest.readyAt = new Date().toISOString();
    writeAtomic(manifestPath, JSON.stringify(manifest, null, 2));
    return {...manifest, dir: target, manifestPath, images: manifest.images.map(item => ({...item, path: path.join(target, item.filename)}))};
  } catch (error) {
    manifest.status = 'failed';
    manifest.errorCode = error.code || 'REPLACEMENT_IMAGE_INVALID';
    writeAtomic(manifestPath, JSON.stringify(manifest, null, 2));
    throw error;
  } finally {
    fs.closeSync(lock);
    fs.unlinkSync(lockFile);
  }
}

module.exports = {
  prepareImages, processImage, downloadImage, validateSourceUrl, sourceInfo,
  MAX_SOURCE_BYTES, MAX_OUTPUT_BYTES, MAX_PIXELS, MIN_DIMENSION,
};
