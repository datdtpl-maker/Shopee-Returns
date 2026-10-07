const {_electron} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {Store} = require('../src/core.cjs');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srm-chrome-persistence-')); let app;
  const launch = async () => {
    app = await _electron.launch({args: ['.'], cwd: path.resolve(__dirname, '..'), env: {...process.env, SRM_DRIVER: '1', SRM_DATA_DIR: dir}});
    const page = await app.firstWindow(); await page.waitForFunction(() => !!window.srm); return page;
  };
  try {
    const store = new Store(dir); store.data.settings.autoScan = false; store.addProfile('Profile giữ nguyên khi nhớ Chrome'); store.save();
    let page = await launch(); assert.equal((await page.evaluate(() => window.srm.call('snapshot'))).studioChrome.remembered, false);
    const issued = await page.evaluate(() => window.srm.call('studio-chrome-pair'));
    assert.equal(issued.expiresAt, null); assert.equal(issued.oneTime, true);
    const encrypted = await app.evaluate(async ({app}, code) => {
      const bridge = app.srmDriver.chromeBridge; await bridge.route('/pair', {code}, 'chrome-extension://' + 'a'.repeat(32));
      const fs = process.getBuiltinModule('fs'), path = process.getBuiltinModule('path'), bytes = fs.readFileSync(path.join(app.srmDriver.store.dir, 'chrome-pairing.enc'));
      return {remembered: bridge.snapshot().remembered, plaintext: bytes.includes(Buffer.from(bridge.binding.token)) || bytes.includes(Buffer.from(bridge.binding.origin))};
    }, issued.code);
    assert.deepEqual(encrypted, {remembered: true, plaintext: false});
    await app.evaluate(({app}) => {app.srmDriver.studio.busy = true;});
    await assert.rejects(page.evaluate(() => window.srm.call('studio-chrome-disconnect')), /Đang có tác vụ/);
    await app.evaluate(({app}) => {app.srmDriver.studio.busy = false; app.srmDriver.products.busy = true;});
    await assert.rejects(page.evaluate(() => window.srm.call('studio-chrome-disconnect')), /Đang có tác vụ/);
    await app.evaluate(({app}) => {app.srmDriver.products.busy = false;});
    await app.close(); app = null;
    page = await launch(); let snapshot = await page.evaluate(() => window.srm.call('snapshot'));
    assert.equal(snapshot.studioChrome.remembered, true); assert.equal(snapshot.studioChrome.listening, true); assert.equal(snapshot.studioChrome.connected, false); assert.equal(!!snapshot.studioChrome.ready, false);
    assert.equal(snapshot.profiles[0].name, 'Profile giữ nguyên khi nhớ Chrome');
    await page.evaluate(() => window.srm.call('studio-chrome-disconnect')); snapshot = await page.evaluate(() => window.srm.call('snapshot')); assert.equal(snapshot.studioChrome.remembered, false);
    await app.close(); app = null;
    page = await launch(); snapshot = await page.evaluate(() => window.srm.call('snapshot')); assert.equal(snapshot.studioChrome.remembered, false); assert.equal(snapshot.studioChrome.listening, false);
    assert.equal(snapshot.profiles[0].name, 'Profile giữ nguyên khi nhớ Chrome'); await app.close(); app = null;
    fs.writeFileSync(path.join(dir, 'chrome-pairing.enc'), Buffer.from('corrupt isolated test file'));
    page = await launch(); snapshot = await page.evaluate(() => window.srm.call('snapshot'));
    assert.equal(snapshot.studioChrome.failed, true); assert.equal(snapshot.studioChrome.remembered, false); assert.equal(snapshot.profiles[0].name, 'Profile giữ nguyên khi nhớ Chrome');
    assert.ok(snapshot.studioChrome.message.includes('Không đọc được kết nối Chrome'));
    console.log('PASS actual Electron: safeStorage encrypted capability survives restart, bridge autostarts, busy disconnect blocked, encrypted revoke persists, corrupt pairing preserves profiles and app startup.');
  } finally {
    if (app) await app.close();
    const resolved = fs.realpathSync(dir), relative = path.relative(os.tmpdir(), resolved);
    if (!path.isAbsolute(relative) && !relative.startsWith('..') && path.basename(resolved).startsWith('srm-chrome-persistence-')) fs.rmSync(resolved, {recursive: true, force: true});
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
