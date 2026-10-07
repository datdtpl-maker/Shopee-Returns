const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('index.html contains studio-success-modal with all required elements', () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/index.html'), 'utf8');
  assert.ok(html.includes('id="studio-success-modal"'), 'modal dialog exists');
  assert.ok(html.includes('id="studio-success-title"'), 'modal title exists');
  assert.ok(html.includes('id="studio-success-shop"'), 'shop label exists');
  assert.ok(html.includes('id="studio-success-name"'), 'product name exists');
  assert.ok(html.includes('id="studio-success-price"'), 'price exists');
  assert.ok(html.includes('id="studio-success-images"'), 'images row exists');
  assert.ok(html.includes('id="studio-success-confirm"'), 'confirm button exists');
  assert.ok(html.includes('id="studio-success-close"'), 'close button exists');
  assert.ok(html.includes('HƯỚNG DẪN DÀNH CHO NHÂN VIÊN'), 'instructions exist');
});

test('studio-ui.js defines showStudioSuccessModal and sets working=false before refresh', () => {
  const code = fs.readFileSync(path.join(__dirname, '../src/studio-ui.js'), 'utf8');
  assert.ok(code.includes('showStudioSuccessModal('), 'showStudioSuccessModal is invoked');
  assert.ok(code.includes('working = false;'), 'working is cleared');
  // Check that in task finally, working = false occurs before refresh
  const taskFinallyMatch = code.match(/finally\s*\{([^}]+working\s*=\s*false[^}]+)\}/);
  assert.ok(taskFinallyMatch, 'task finally block found');
  const taskFinallyContent = taskFinallyMatch[1];
  assert.ok(taskFinallyContent.indexOf('working = false') < taskFinallyContent.indexOf('refreshAfter'), 'working=false before refresh');
});

test('main.cjs postpones nextScan by 60s in productTask instead of immediate scan', () => {
  const code = fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8');
  assert.ok(code.includes('nextScan=Date.now()+60000'), 'nextScan is postponed by 60000ms');
  assert.ok(!code.includes('if(nextScan&&Date.now()>=nextScan&&!scanning&&!clearingNotion)void scan()'), 'immediate void scan is not called in productTask finally');
});

test('style.css defines non-white, clean disabled button styling', () => {
  const css = fs.readFileSync(path.join(__dirname, '../src/style.css'), 'utf8');
  assert.ok(css.includes('button:disabled{background:#f1f5f9!important'), 'solid disabled background');
  assert.ok(css.includes('cursor:not-allowed!important'), 'not-allowed cursor');
});
