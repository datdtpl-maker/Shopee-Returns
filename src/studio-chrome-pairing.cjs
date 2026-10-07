const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const MAX_BYTES = 32768;
const failure = (message, code = 'CHROME_PAIRING_STORAGE') => Object.assign(Error(message), {code});

function pairing(value) {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'origin,token' || typeof value.origin !== 'string' || typeof value.token !== 'string' || !/^chrome-extension:\/\/[a-p]{32}$/.test(value.origin) || !/^[a-f\d]{64}$/i.test(value.token)) throw failure('Thông tin ghép Chrome đã lưu không hợp lệ. Ghép lại tiện ích.');
  return {origin: value.origin, token: value.token};
}

class ChromePairingStorage {
  constructor(dir, safeStorage) {this.dir = path.resolve(dir); this.file = path.join(this.dir, 'chrome-pairing.enc'); this.safeStorage = safeStorage;}
  checkPath() {
    const root = fs.lstatSync(this.dir);
    if (!root.isDirectory() || root.isSymbolicLink()) throw failure('Thư mục lưu ghép Chrome không hợp lệ.');
    let file; try {file = fs.lstatSync(this.file);} catch (error) {if (error.code !== 'ENOENT') throw error;}
    if (file && (!file.isFile() || file.isSymbolicLink() || file.size > MAX_BYTES)) throw failure('File lưu ghép Chrome không hợp lệ. Giữ nguyên file để kiểm tra.');
  }
  encryption() {
    if (!this.safeStorage?.isEncryptionAvailable()) throw failure('Windows chưa sẵn sàng mã hoá kết nối Chrome. Thử ghép lại sau.', 'CHROME_PAIRING_ENCRYPTION');
  }
  load() {
    try {
      this.checkPath(); if (!fs.existsSync(this.file)) return null; this.encryption();
      const handle = fs.openSync(this.file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)); let raw;
      try {
        const stat = fs.fstatSync(handle);
        if (!stat.isFile() || !stat.size || stat.size > MAX_BYTES) throw failure('File lưu ghép Chrome không hợp lệ.');
        raw = fs.readFileSync(handle);
      } finally {fs.closeSync(handle);}
      const text = this.safeStorage.decryptString(raw);
      if (typeof text !== 'string' || text.length > MAX_BYTES) throw failure('File lưu ghép Chrome không hợp lệ.');
      const saved = JSON.parse(text);
      if (!saved || Object.keys(saved).sort().join(',') !== 'pairing,version' || saved.version !== 1) throw failure('File lưu ghép Chrome không hợp lệ.');
      return pairing(saved.pairing);
    } catch (error) {
      if (error.code?.startsWith('CHROME_PAIRING')) throw error;
      throw failure('Không đọc được kết nối Chrome đã lưu. Ghép lại tiện ích; dữ liệu khác được giữ nguyên.');
    }
  }
  save(value) {
    let temporary;
    try {
      const clean = pairing(value); this.checkPath(); this.encryption();
      const encrypted = this.safeStorage.encryptString(JSON.stringify({version: 1, pairing: clean}));
      if (!Buffer.isBuffer(encrypted) || !encrypted.length || encrypted.length > MAX_BYTES) throw failure('Không mã hoá được kết nối Chrome.');
      // A null capability is an encrypted revocation marker, never a plaintext fallback.
      temporary = path.join(this.dir, '.chrome-pairing-' + randomUUID() + '.tmp');
      fs.writeFileSync(temporary, encrypted, {flag: 'wx', mode: 0o600}); this.checkPath();
      fs.renameSync(temporary, this.file); temporary = null;
    } catch (error) {
      if (error.code?.startsWith('CHROME_PAIRING')) throw error;
      throw failure('Không lưu được kết nối Chrome. Kiểm tra quyền ghi thư mục dữ liệu rồi ghép lại.');
    } finally {if (temporary && fs.existsSync(temporary)) try {fs.unlinkSync(temporary);} catch {}}
  }
}
module.exports = {ChromePairingStorage};
