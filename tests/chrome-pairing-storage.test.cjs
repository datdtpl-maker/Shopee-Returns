const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {randomBytes, createCipheriv, createDecipheriv} = require('node:crypto');
const {ChromePairingStorage} = require('../src/studio-chrome-pairing.cjs');
const PAIRING = {origin: 'chrome-extension://' + 'a'.repeat(32), token: 'b'.repeat(64)};

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srm-pairing-')); t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const key = randomBytes(32), crypt = {isEncryptionAvailable: () => true,
    encryptString(text) {const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv), encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);},
    decryptString(bytes) {const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); decipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');},
  };
  const storage = new ChromePairingStorage(dir, crypt);
  return {dir, crypt, storage};
}

test('encrypted Chrome capability survives storage recreation and never appears in plaintext', t => {
  const f = setup(t); assert.equal(f.storage.load(), null); f.storage.save(PAIRING);
  const bytes = fs.readFileSync(f.storage.file); assert.ok(!bytes.includes(Buffer.from(PAIRING.token))); assert.ok(!bytes.includes(Buffer.from(PAIRING.origin)));
  assert.deepEqual(new ChromePairingStorage(f.dir, f.crypt).load(), PAIRING); assert.deepEqual(fs.readdirSync(f.dir), ['chrome-pairing.enc']);
});

test('disconnect writes an encrypted null capability and preserves unrelated app data', t => {
  const f = setup(t), profile = path.join(f.dir, 'profile'), state = path.join(f.dir, 'state.json'); fs.mkdirSync(profile); fs.writeFileSync(state, 'preserve historical state'); f.storage.save(PAIRING);
  f.storage.save(null); assert.equal(new ChromePairingStorage(f.dir, f.crypt).load(), null);
  const bytes = fs.readFileSync(f.storage.file); assert.ok(!bytes.includes(Buffer.from('pairing'))); assert.ok(!bytes.includes(Buffer.from('null')));
  assert.equal(fs.readFileSync(state, 'utf8'), 'preserve historical state'); assert.ok(fs.existsSync(profile));
});

test('unavailable encryption refuses save or revoke and keeps the previous capability intact', t => {
  const f = setup(t); f.storage.save(PAIRING); const previous = fs.readFileSync(f.storage.file); f.crypt.isEncryptionAvailable = () => false;
  for (const value of [PAIRING, null]) assert.throws(() => f.storage.save(value), error => error.code === 'CHROME_PAIRING_ENCRYPTION');
  assert.throws(() => f.storage.load(), error => error.code === 'CHROME_PAIRING_ENCRYPTION'); assert.deepEqual(fs.readFileSync(f.storage.file), previous);
  assert.deepEqual(fs.readdirSync(f.dir), ['chrome-pairing.enc']);
});

test('corrupt ciphertext or wrong-user decryption reports a fixed message without exposing secrets or deleting data', t => {
  const f = setup(t); f.storage.save(PAIRING); const previous = fs.readFileSync(f.storage.file);
  f.crypt.decryptString = () => {throw Error('Provider internal credential ' + PAIRING.token);};
  assert.throws(() => f.storage.load(), error => error.code === 'CHROME_PAIRING_STORAGE' && !error.message.includes(PAIRING.token));
  assert.deepEqual(fs.readFileSync(f.storage.file), previous); assert.deepEqual(fs.readdirSync(f.dir), ['chrome-pairing.enc']);
});

test('only the exact extension-origin and opaque token capability schema can be saved or loaded', t => {
  const f = setup(t);
  for (const value of [undefined, {}, [], {origin: 'https://chatgpt.com', token: PAIRING.token}, {...PAIRING, token: 'short'}, {...PAIRING, tabId: 3}, {...PAIRING, expiresAt: Date.now()}]) assert.throws(() => f.storage.save(value), /không hợp lệ/);
  assert.equal(fs.existsSync(f.storage.file), false);
  fs.writeFileSync(f.storage.file, f.crypt.encryptString(JSON.stringify({version: 1, pairing: {...PAIRING, tabId: 5}})));
  assert.throws(() => f.storage.load(), /không hợp lệ/);
  fs.writeFileSync(f.storage.file, f.crypt.encryptString(JSON.stringify({version: 2, pairing: PAIRING})));
  assert.throws(() => f.storage.load(), /không hợp lệ/);
});

test('atomic-write failure leaves the previous encrypted file and removes its temporary file', t => {
  const f = setup(t); f.storage.save(PAIRING); const previous = fs.readFileSync(f.storage.file), rename = fs.renameSync;
  fs.renameSync = () => {throw Error('rename failed secret ' + PAIRING.token);};
  try {assert.throws(() => f.storage.save(null), error => /Không lưu được/.test(error.message) && !error.message.includes(PAIRING.token));} finally {fs.renameSync = rename;}
  assert.deepEqual(fs.readFileSync(f.storage.file), previous); assert.deepEqual(fs.readdirSync(f.dir), ['chrome-pairing.enc']);
});

test('storage refuses a directory target or junction root and never writes outside the chosen data directory', t => {
  const f = setup(t); fs.mkdirSync(f.storage.file); assert.throws(() => f.storage.save(PAIRING), /File lưu ghép Chrome không hợp lệ/); assert.throws(() => f.storage.load(), /File lưu ghép Chrome không hợp lệ/);
  fs.rmdirSync(f.storage.file); const outside = path.join(f.dir, 'outside'), link = path.join(f.dir, 'linked-root'); fs.mkdirSync(outside); fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  const unsafe = new ChromePairingStorage(link, f.crypt); assert.throws(() => unsafe.save(PAIRING), /Thư mục.*không hợp lệ/); assert.throws(() => unsafe.load(), /Thư mục.*không hợp lệ/); assert.deepEqual(fs.readdirSync(outside), []);
});

test('oversized encrypted files are refused without replacing the file', t => {
  const f = setup(t), bytes = Buffer.alloc(32769, 7); fs.writeFileSync(f.storage.file, bytes);
  assert.throws(() => f.storage.load(), /File lưu ghép Chrome không hợp lệ/); assert.throws(() => f.storage.save(null), /File lưu ghép Chrome không hợp lệ/); assert.deepEqual(fs.readFileSync(f.storage.file), bytes);
});
