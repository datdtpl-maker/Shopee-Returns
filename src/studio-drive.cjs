const fs = require('node:fs');
const path = require('node:path');
const {createHash, randomUUID} = require('node:crypto');
const ROOT_URL = 'https://drive.google.com/drive/u/2/folders/1rb6h7JS0_5Yo5BQkOQ-7S4GajPxQ_R_3';
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const hash = buffer => createHash('sha256').update(buffer).digest('hex');
function segment(value) {
  const text = String(value || '').normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/, '').trim().slice(0, 95).replace(/[. ]+$/, '');
  if (!text || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(text)) throw Error('Tên thư mục Drive không hợp lệ.');
  return text;
}
function contained(root, file) {const relative = path.relative(root, file); return !relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));}
function regular(file) {if (fs.existsSync(file) && (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink())) throw Error('File ảnh hoặc manifest không được là liên kết ngoài.');}
function writeAtomic(file, data, exclusive = false) {
  regular(file); const temporary = path.join(path.dirname(file), '.srm-' + randomUUID() + '.tmp');
  try {
    fs.writeFileSync(temporary, data, {flag: 'wx', mode: 0o600});
    if (exclusive) fs.copyFileSync(temporary, file, fs.constants.COPYFILE_EXCL);
    else fs.renameSync(temporary, file);
  } finally {if (fs.existsSync(temporary)) fs.unlinkSync(temporary);}
}
function directory(root, parts, create = false) {
  let folder = root;
  for (const part of parts) {
    if (!part || part === '.' || part === '..' || /[\\/\x00-\x1f]/.test(part)) throw Error('Đường dẫn thư mục ảnh không hợp lệ.');
    folder = path.join(folder, part);
    if (!contained(root, folder) || fs.existsSync(folder) && (!fs.lstatSync(folder).isDirectory() || fs.lstatSync(folder).isSymbolicLink())) throw Error('Thư mục Drive không được đi qua liên kết ngoài root.');
    if (!fs.existsSync(folder)) {if (!create) return null; fs.mkdirSync(folder);}
    if (!contained(root, fs.realpathSync(folder))) throw Error('Thư mục ảnh nằm ngoài Drive đã chọn.');
  }
  return folder;
}
function manifest(folder, strict = true) {
  const file = path.join(folder, 'srm-manifest.json');
  if (!fs.existsSync(file)) return null;
  try {regular(file); return JSON.parse(fs.readFileSync(file, 'utf8'));}
  catch (error) {if (!strict) return null; throw Error('Manifest ảnh Drive không hợp lệ. Không ghi đè.');}
}
function findJobFolder(root, shopPart, jobId) {
  const shop = directory(root, [shopPart]); if (!shop) return null;
  const matches = []; let checked = 0;
  const visit = (folder, depth) => {
    if (++checked > 10000) throw Error('Có quá nhiều thư mục ảnh. Dùng đường dẫn local đã lưu để đối chiếu.');
    if (manifest(folder, false)?.jobId === jobId) matches.push(folder);
    if (depth === 2) return;
    for (const entry of fs.readdirSync(folder, {withFileTypes: true})) if (entry.isDirectory() && !entry.isSymbolicLink()) {
      const child = path.join(folder, entry.name);
      if (fs.lstatSync(child).isSymbolicLink() || !contained(root, fs.realpathSync(child))) continue;
      visit(child, depth + 1);
    }
  };
  visit(shop, 0); if (matches.length > 1) throw Error('Có nhiều thư mục ảnh cùng tác vụ. Kiểm tra dữ liệu local trước khi lưu.');
  return matches[0] || null;
}
class LocalDrive {
  constructor(settings) {this.settings = settings;}
  root() {
    const root = this.settings().driveLocalFolder;
    if (typeof root !== 'string' || !path.isAbsolute(root) || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw Error('Chọn thư mục Google Drive local đang đồng bộ trên máy này.');
    return fs.realpathSync(root);
  }
  test() {const root = this.root(); fs.accessSync(root, fs.constants.W_OK); return {connected: true, folder: root, message: 'Thư mục local sẵn sàng. Google Drive Desktop tự đồng bộ; tool không xác nhận trạng thái đồng bộ trên cloud.'};}
  folder({jobId, shop, productId, productName, relativeDir: savedRelativeDir}) {
    if (!UUID.test(jobId || '')) throw Error('Mã tác vụ ảnh không hợp lệ.');
    if (productId !== undefined && !/^\d{1,30}$/.test(productId)) throw Error('ID sản phẩm ảnh không hợp lệ.');
    const root = this.root(), shopPart = segment(shop), namePart = segment(productName); let folder;
    if (savedRelativeDir !== undefined) {
      if (typeof savedRelativeDir !== 'string' || path.isAbsolute(savedRelativeDir)) throw Error('Đường dẫn thư mục ảnh đã lưu không hợp lệ.');
      const parts = savedRelativeDir.split(/[\\/]/); if (parts.length < 2 || parts.length > 3 || parts[0] !== shopPart) throw Error('Thư mục ảnh đã lưu không thuộc đúng shop.');
      folder = directory(root, parts, true);
    } else folder = findJobFolder(root, shopPart, jobId);
    if (!folder) {
      folder = directory(root, [shopPart, namePart], true);
      if (fs.readdirSync(folder).length) {
        const current = manifest(folder);
        if (current?.jobId !== jobId) {
          if (productId && current?.productId === productId) {
            if (current.status === 'ready') throw Error('Thư mục đang thuộc tác vụ khác của cùng sản phẩm. Không ghi đè ảnh.');
            // Same product with partial images: keep using this folder
          } else {
            const suffix = productId || jobId, uniqueName = namePart.slice(0, 95 - suffix.length - 3) + ' [' + suffix + ']';
            folder = directory(root, [shopPart, uniqueName], true);
          }
        }
      }
    }
    const relativeDir = path.relative(root, folder);
    const manifestFile = path.join(folder, 'srm-manifest.json'); regular(manifestFile);
    const previous = manifest(folder);
    if (previous) {
      const samePartialProduct = Boolean(productId && previous.productId === productId && previous.status !== 'ready');
      if (!samePartialProduct && previous.jobId !== jobId) throw Error('Thư mục đang thuộc tác vụ khác. Không ghi đè ảnh.');
      if (previous.shop !== shop || previous.productName !== productName || (previous.productId && previous.productId !== productId)) {
        if (!samePartialProduct) throw Error('Thư mục đang thuộc tác vụ khác. Không ghi đè ảnh.');
      }
      if (samePartialProduct && previous.jobId !== jobId) previous.jobId = jobId;
    }
    return {root, folder, relativeDir, manifestFile, previous};
  }
  async inspectImages({shop, productId, productName, jobId, relativeDir: savedRelativeDir}) {
    try {
      const root = this.root(), shopPart = segment(shop);
      let folder = null;
      if (savedRelativeDir) {
        const parts = savedRelativeDir.split(/[\\/]/);
        if (parts.length >= 2 && parts[0] === shopPart) {
          const candidate = directory(root, parts);
          if (candidate && fs.existsSync(candidate)) folder = candidate;
        }
      }
      if (!folder && jobId) {
        folder = findJobFolder(root, shopPart, jobId);
      }
      if (!folder && productName) {
        const namePart = segment(productName);
        const candidate = directory(root, [shopPart, namePart]);
        if (candidate && fs.existsSync(candidate)) folder = candidate;
        else if (productId) {
          const suffix = productId;
          const uniqueName = namePart.slice(0, 95 - suffix.length - 3) + ' [' + suffix + ']';
          const sufCandidate = directory(root, [shopPart, uniqueName]);
          if (sufCandidate && fs.existsSync(sufCandidate)) folder = sufCandidate;
        }
      }
      if (!folder && productId) {
        const shopDir = directory(root, [shopPart]);
        if (shopDir && fs.existsSync(shopDir)) {
          for (const entry of fs.readdirSync(shopDir, {withFileTypes: true})) {
            if (entry.isDirectory() && !entry.isSymbolicLink()) {
              const child = path.join(shopDir, entry.name);
              const m = manifest(child, false);
              if (m?.productId === productId) { folder = child; break; }
            }
          }
        }
      }
      if (!folder || !fs.existsSync(folder)) return null;
      const images = [];
      const m = manifest(folder, false);
      for (let i = 0; i < 5; i++) {
        const pngFile = path.join(folder, String(i + 1) + '.png');
        const jpgFile = path.join(folder, String(i + 1) + '.jpg');
        const target = fs.existsSync(pngFile) ? pngFile : (fs.existsSync(jpgFile) ? jpgFile : null);
        if (target) {
          try {
            regular(target);
            const data = fs.readFileSync(target);
            const digest = hash(data);
            const isPng = target.endsWith('.png');
            const mimeType = isPng ? 'image/png' : 'image/jpeg';
            const manifestImg = m?.images?.[i];
            const width = manifestImg?.width || 1024;
            const height = manifestImg?.height || 1024;
            let previewDataUrl = '';
            try {
              const thumb = await require('sharp')(data, {limitInputPixels: 40000000, failOn: 'error'})
                .resize({width: 180, height: 180, fit: 'inside'})
                .jpeg({quality: 70})
                .toBuffer();
              previewDataUrl = 'data:image/jpeg;base64,' + thumb.toString('base64');
            } catch {}
            images[i] = {
              index: i,
              ordinal: i + 1,
              path: target,
              filename: path.basename(target),
              hash: digest,
              bytes: data.length,
              width,
              height,
              mimeType,
              previewDataUrl
            };
          } catch {}
        }
      }
      if (!images.filter(Boolean).length) return null;
      return {
        localFolder: folder,
        relativeDir: path.relative(root, folder),
        images
      };
    } catch {
      return null;
    }
  }
  async preparedImage(source, folder, index, previous) {
    if (!source || typeof source.path !== 'string' || !path.isAbsolute(source.path) || !fs.existsSync(source.path)) throw Error('Thiếu file ảnh đã chuẩn bị.');
    regular(source.path); const data = fs.readFileSync(source.path), digest = hash(data);
    const png = source.mimeType === 'image/png';
    if (png ? data.length > 25 * 1024 * 1024 || !data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || source.hash && source.hash !== digest : data.length >= 1900000 || data[0] !== 255 || data[1] !== 216 || data[2] !== 255 || source.hash && source.hash !== digest) throw Error(png ? 'Ảnh PNG Drive không hợp lệ hoặc vượt 25 MB.' : 'Ảnh Drive phải là JPEG đã kiểm tra dưới 1,9 MB.');
    let metadata;
    try {const image = require('sharp')(data, {limitInputPixels: 40000000, failOn: 'error'}); metadata = await image.metadata(); await image.resize(1, 1).raw().toBuffer();}
    catch {throw Error('File JPEG Drive bị hỏng hoặc quá lớn.');}
    if (metadata.format !== (png ? 'png' : 'jpeg') || metadata.width < 500 || metadata.height < 500 || (metadata.pages || 1) > 1) throw Error('Ảnh Drive cần ảnh tĩnh đúng định dạng, tối thiểu 500 × 500.');
    const filename = String(index + 1) + (png ? '.png' : '.jpg'), target = path.join(folder, filename); regular(target);
    const allowOverwrite = Boolean(source.allowOverwrite);
    if (fs.existsSync(target) && hash(fs.readFileSync(target)) !== digest) {
      if (!allowOverwrite) throw Error('File ảnh Drive hiện có đã khác; tool giữ nguyên file để kiểm tra.');
    }
    if (previous?.images?.[index]?.hash && previous.images[index].hash !== digest) {
      if (!allowOverwrite) throw Error('Bộ ảnh khác manifest đã lưu. Không ghi đè ảnh.');
    }
    return {source, data, digest, filename, target, metadata};
  }
  async uploadOne({jobId, shop, productId, productName, insight, relativeDir: savedRelativeDir, index, image}) {
    if (!Number.isInteger(index) || index < 0 || index > 4) throw Error('Thứ tự ảnh cần từ 0 đến 4.');
    const {root, folder, relativeDir, manifestFile, previous} = this.folder({jobId, shop, productId, productName, relativeDir: savedRelativeDir});
    const prepared = await this.preparedImage(image, folder, index, previous), {source, data, digest, filename, target, metadata} = prepared;
    const previousImages = previous?.images || [];
    if (!Array.isArray(previousImages) || previousImages.length > 5 || previousImages.some((value, slot) => value && (![String(slot + 1) + '.jpg',String(slot + 1) + '.png'].includes(value.filename) || !/^[a-f\d]{64}$/i.test(value.hash || '')))) throw Error('Manifest ảnh từng phần không hợp lệ. Không ghi đè ảnh.');
    if (previousImages.some((value, slot) => slot !== index && value?.hash === digest)) throw Error('Ảnh Drive bị trùng với ảnh đã lưu của tác vụ.');
    const details = {...previous, jobId, shop, productName, ...(productId ? {productId} : {}), ...(previous?.insight !== undefined ? {insight: previous.insight} : insight !== undefined ? {insight} : {}), relativeDir};
    const manifestImages = Array.from({length: 5}, (_, slot) => previousImages[slot] || null);
    const mimeType = metadata.format === 'png' ? 'image/png' : 'image/jpeg';
    manifestImages[index] = {filename, hash: digest, bytes: data.length, width: metadata.width, height: metadata.height, mimeType};
    // Reserve the exact identity and hash before writing so a crash can resume this slot safely.
    if (!previous) writeAtomic(manifestFile, JSON.stringify({...details, status: 'copying', images: manifestImages}, null, 2), true);
    else if (JSON.stringify(previous.images) !== JSON.stringify(manifestImages)) writeAtomic(manifestFile, JSON.stringify({...details, status: 'copying', images: manifestImages}, null, 2));
    if (!contained(root, fs.realpathSync(folder)) || fs.lstatSync(folder).isSymbolicLink()) throw Error('Thư mục Drive đã thay đổi; không ghi ảnh ngoài root.');
    if (!fs.existsSync(target) || source.allowOverwrite) writeAtomic(target, data, !fs.existsSync(target) && !source.allowOverwrite);
    regular(target); if (hash(fs.readFileSync(target)) !== digest) throw Error('Ảnh Drive chưa ghi đầy đủ.');
    const result = {...source, index, ordinal: index + 1, path: target, filename, hash: digest, bytes: data.length, width: metadata.width, height: metadata.height, mimeType};
    const complete = manifestImages.every(value => {
      if (!value || !fs.existsSync(path.join(folder, value.filename))) return false;
      regular(path.join(folder, value.filename)); return hash(fs.readFileSync(path.join(folder, value.filename))) === value.hash;
    });
    writeAtomic(manifestFile, JSON.stringify({...details, status: complete ? 'ready' : 'partial', images: manifestImages}, null, 2));
    return {jobId, folderUrl: ROOT_URL, localFolder: folder, relativeDir, image: result, verified: true, cloudVerified: false, complete};
  }
  async uploadSet({jobId, shop, productId, productName, insight, relativeDir: savedRelativeDir, assets}) {
    if (!UUID.test(jobId || '') || !Array.isArray(assets?.images) || assets.images.length !== 5) throw Error('Cần đúng 5 ảnh đã chuẩn bị của tác vụ.');
    const {root, folder, relativeDir, manifestFile, previous} = this.folder({jobId, shop, productId, productName, relativeDir: savedRelativeDir});
    const prepared = [];
    // Validate the complete set before writing, so an invalid fifth image cannot leave a partial set.
    for (let index = 0; index < 5; index++) {
      prepared.push(await this.preparedImage(assets.images[index], folder, index, previous));
    }
    const details = {...previous, jobId, shop, productName, ...(productId ? {productId} : {}), ...(previous?.insight !== undefined ? {insight: previous.insight} : insight !== undefined ? {insight} : {}), relativeDir};
    // Keep the identity before copying so a crash can resume the same folder.
    if (!previous) writeAtomic(manifestFile, JSON.stringify({...details, status: 'copying', images: prepared.map(({filename, digest}) => ({filename, hash: digest}))}, null, 2), true);
    const images = [];
    for (const {source, data, digest, filename, target, metadata} of prepared) {
      if (!contained(root, fs.realpathSync(folder)) || fs.lstatSync(folder).isSymbolicLink()) throw Error('Thư mục Drive đã thay đổi; không ghi ảnh ngoài root.');
      if (!fs.existsSync(target)) writeAtomic(target, data, true);
      regular(target); if (hash(fs.readFileSync(target)) !== digest) throw Error('Ảnh Drive chưa ghi đầy đủ.');
      images.push({...source, path: target, filename, hash: digest, bytes: data.length, width: metadata.width, height: metadata.height, mimeType: metadata.format === 'png' ? 'image/png' : 'image/jpeg'});
    }
    const manifestImages = images.map(({filename, hash, bytes, width, height, mimeType}) => ({filename, hash, bytes, width, height, mimeType}));
    writeAtomic(manifestFile, JSON.stringify({...details, status: 'ready', images: manifestImages}, null, 2));
    return {folderUrl: ROOT_URL, localFolder: folder, relativeDir, images, verified: true, cloudVerified: false};
  }
}
module.exports = {LocalDrive, segment, ROOT_URL};
