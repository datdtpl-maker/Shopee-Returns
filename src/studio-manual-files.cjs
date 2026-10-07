const fs = require('node:fs');
const path = require('node:path');
const {randomUUID, createHash} = require('node:crypto');
const {spawn} = require('node:child_process');
const {processImage, MAX_SOURCE_BYTES} = require('./replacement-images.cjs');

class ManualImageFiles {
  constructor({dialog, window, clipboard}) {
    Object.assign(this, {dialog, window, clipboard}); this.files = new Map(); this.picking = false;
  }
  async pick(jobId, index, reference = false) {
    if (!Number.isInteger(index) || index < 0 || index > 4) throw Error('Chọn vị trí ảnh từ 1 đến 5.');
    if (this.picking) throw Error('Cửa sổ chọn ảnh đang mở.');
    this.picking = true;
    try {
      const selected = await this.dialog.showOpenDialog(this.window(), {title: reference ? 'Chọn ảnh mẫu của đúng sản phẩm mới' : 'Chọn ảnh ' + (index + 1) + ' đã tải từ ChatGPT', properties: ['openFile'], filters: [{name: 'Ảnh sản phẩm', extensions: ['png', 'jpg', 'jpeg', 'webp']}]});
      if (selected.canceled) return {cancelled: true};
      if (selected.filePaths?.length !== 1) throw Error('Chọn đúng một ảnh.');
      const file = selected.filePaths[0], stat = fs.lstatSync(file);
      if (!path.isAbsolute(file) || !stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_SOURCE_BYTES) throw Error('Ảnh phải là file local, tối đa 25 MB.');
      const raw = fs.readFileSync(file), sourceHash = createHash('sha256').update(raw).digest('hex');
      const prepared = await processImage(raw);
      if (prepared.sourceWidth < 500 || prepared.sourceHeight < 500) throw Error('Ảnh cần tối thiểu 500 × 500 điểm ảnh.');
      const now = Date.now();
      for (const [id, entry] of this.files) if (now - entry.at > 3600000 || entry.jobId === jobId && entry.index === index) this.files.delete(id);
      while (this.files.size >= 100) this.files.delete(this.files.keys().next().value);
      const selectionId = randomUUID(); this.files.set(selectionId, {jobId, index, path: file, sourceHash, at: now});
      return {selectionId, name: path.basename(file), bytes: stat.size, width: prepared.sourceWidth, height: prepared.sourceHeight, previewDataUrl: prepared.previewDataUrl};
    } finally {this.picking = false;}
  }
  paths(jobId, selectionIds) {
    if (!Array.isArray(selectionIds) || selectionIds.length !== 5 || new Set(selectionIds).size !== 5) throw Error('Chọn đủ 5 ảnh theo thứ tự.');
    return selectionIds.map((id, index) => {
      const entry = this.files.get(id);
      if (!entry || entry.jobId !== jobId || entry.index !== index || Date.now() - entry.at > 3600000) throw Error('Lựa chọn ảnh đã hết hạn hoặc không thuộc bài/vị trí đang chọn. Chọn lại ảnh.');
      const stat = fs.lstatSync(entry.path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_SOURCE_BYTES || createHash('sha256').update(fs.readFileSync(entry.path)).digest('hex') !== entry.sourceHash) throw Error('Ảnh đã thay đổi sau khi chọn. Chọn lại ảnh để xem đúng bản sẽ nhập.');
      return entry.path;
    });
  }
  clear(selectionIds) {for (const id of selectionIds) this.files.delete(id);}
  async reference(jobId, selectionId) {
    const entry = this.files.get(selectionId);
    if (!entry || entry.jobId !== jobId || Date.now() - entry.at > 3600000) throw Error('Ảnh mẫu đã hết hạn hoặc không thuộc bài đã chọn. Chọn lại ảnh mẫu.');
    const stat = fs.lstatSync(entry.path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_SOURCE_BYTES) throw Error('File ảnh mẫu không hợp lệ.');
    const raw = fs.readFileSync(entry.path);
    if (createHash('sha256').update(raw).digest('hex') !== entry.sourceHash) throw Error('Ảnh mẫu đã thay đổi sau khi chọn. Chọn lại ảnh.');
    const prepared = await processImage(raw);
    return {name: 'anh-mau-san-pham.jpg', mimeType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,' + prepared.buffer.toString('base64')};
  }
  copy(text) {this.clipboard.writeText(text); return {message: 'Đã sao chép prompt. Dán vào ChatGPT trong Chrome thường.'};}
  openChrome() {
    const chrome = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean).map(dir => path.join(dir, 'Google', 'Chrome', 'Application', 'chrome.exe')).find(file => fs.existsSync(file));
    if (!chrome) throw Error('Cần cài Google Chrome để mở ChatGPT.');
    return new Promise((resolve, reject) => {
      const child = spawn(chrome, ['https://chatgpt.com/'], {detached: true, stdio: 'ignore', windowsHide: true});
      child.once('error', () => reject(Error('Không mở được Chrome thường.')));
      child.once('spawn', () => {child.unref(); resolve({message: 'Đã mở ChatGPT bằng Chrome thường. Dán prompt và đính kèm ảnh mẫu của đúng sản phẩm.'});});
    });
  }
}
module.exports = {ManualImageFiles};
