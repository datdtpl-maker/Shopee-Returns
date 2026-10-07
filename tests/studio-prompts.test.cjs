const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {PromptLibrary, DEFAULT_TEMPLATES, LIMITS} = require('../src/studio-prompts.cjs');
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srm-prompts-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  return {dir, library: new PromptLibrary(dir)};
}
test('first-run templates follow the requested layout without borrowing Oximin facts', t => {
  const {dir, library} = setup(t), data = library.snapshot();
  assert.equal(data.templates.length, 3); assert.equal(data.maxTemplates, 100);
  for (const item of data.templates) {
    assert.match(item.id, /^[a-f\d-]{36}$/);
    for (const heading of ['MÔ TẢ SẢN PHẨM', 'THÀNH PHẦN NỔI BẬT', 'CÔNG DỤNG HỖ TRỢ', 'ĐỐI TƯỢNG SỬ DỤNG', 'CÁCH DÙNG', 'LƯU Ý', 'HASHTAG']) assert.ok(item.content.includes('📍 ' + heading));
    assert.ok(item.content.includes('không đưa tên Oximin')); assert.ok(item.content.includes('Bố cục bài Oximin chỉ là mẫu'));
  }
  const restarted = new PromptLibrary(dir);
  assert.deepEqual(restarted.snapshot(), data); assert.equal(DEFAULT_TEMPLATES.length, 3);
});
test('create, edit and remove survive restart without reviving deleted defaults or changing jobs', t => {
  const {dir, library} = setup(t), jobsFile = path.join(dir, 'replacement-studio', 'state.json');
  fs.writeFileSync(jobsFile, '{"jobs":[{"id":"existing-job"}]}');
  const item = library.upsert({name: '  Mẫu riêng  ', content: '  Dòng một\nDòng hai  '});
  assert.equal(item.name, 'Mẫu riêng'); assert.equal(item.content, 'Dòng một\nDòng hai');
  library.upsert({...item, content: 'Nội dung đã sửa'});
  const defaultIds = library.snapshot().templates.filter(value => value.id !== item.id).map(value => value.id);
  for (const id of defaultIds) library.remove(id);
  assert.deepEqual(new PromptLibrary(dir).snapshot().templates, [{...item, content: 'Nội dung đã sửa'}]);
  library.remove(item.id);
  assert.deepEqual(new PromptLibrary(dir).snapshot().templates, []);
  assert.equal(fs.readFileSync(jobsFile, 'utf8'), '{"jobs":[{"id":"existing-job"}]}');
});
test('snapshots and returned templates cannot mutate stored data', t => {
  const {library} = setup(t), snapshot = library.snapshot(), original = snapshot.templates[0].content;
  snapshot.templates[0].content = 'Mutated'; snapshot.templates.length = 0;
  assert.equal(library.snapshot().templates[0].content, original);
  const item = library.upsert({name: 'Mẫu', content: 'Đúng nguồn'}); item.content = 'Mutated';
  assert.equal(library.snapshot().templates.at(-1).content, 'Đúng nguồn');
});
test('invalid input and stale IDs leave the library unchanged', t => {
  const {library} = setup(t), before = library.snapshot();
  for (const input of [null, [], {}, {name: '', content: 'Prompt'}, {name: 'Tên', content: '   '}, {name: 'Tên\nkhác', content: 'Prompt'}, {name: 'x'.repeat(101), content: 'Prompt'}, {name: 'Tên', content: 'x'.repeat(16001)}, {name: 'Tên', content: 'Prompt\0'}, {id: '../../outside', name: 'Tên', content: 'Prompt'}, {id: randomUUID(), name: 'Tên', content: 'Prompt'}]) assert.throws(() => library.upsert(input));
  for (const id of [null, '../../outside', randomUUID()]) assert.throws(() => library.remove(id));
  assert.deepEqual(library.snapshot(), before);
});
test('limits allow valid multiline prompts and edits at capacity', t => {
  const {library} = setup(t), first = library.snapshot().templates[0];
  while (library.snapshot().templates.length < LIMITS.maxTemplates) library.upsert({name: 'Mẫu', content: 'Prompt\n\tchi tiết'});
  assert.throws(() => library.upsert({name: 'Vượt', content: 'Không lưu'}));
  library.upsert({id: first.id, name: 'x'.repeat(LIMITS.nameLimit), content: 'x'.repeat(LIMITS.contentLimit)});
  assert.equal(library.snapshot().templates.length, LIMITS.maxTemplates);
  assert.equal(library.snapshot().templates[0].content.length, LIMITS.contentLimit);
});
test('invalid persisted data is reported without resetting or overwriting it', t => {
  const {dir, library} = setup(t);
  const corruptValues = ['not-json', JSON.stringify({version: 1, templates: [{id: randomUUID(), name: '', content: 'Text'}]}), JSON.stringify({version: 1, templates: [library.snapshot().templates[0], library.snapshot().templates[0]]})];
  for (const value of corruptValues) {
    fs.writeFileSync(library.file, value); assert.throws(() => new PromptLibrary(dir)); assert.equal(fs.readFileSync(library.file, 'utf8'), value);
  }
});
test('writes are atomic and a failed rename keeps the prior in-memory and on-disk data', t => {
  const {library} = setup(t), before = library.snapshot(), disk = fs.readFileSync(library.file, 'utf8'), rename = fs.renameSync;
  fs.renameSync = () => {throw Error('Simulated file lock');};
  try {assert.throws(() => library.upsert({name: 'Không ghi', content: 'Prompt'}), /file lock/);}
  finally {fs.renameSync = rename;}
  assert.deepEqual(library.snapshot(), before); assert.equal(fs.readFileSync(library.file, 'utf8'), disk);
  assert.deepEqual(fs.readdirSync(library.dir), ['prompts.json']);
});
