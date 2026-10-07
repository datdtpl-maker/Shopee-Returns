const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const {createHash} = require('node:crypto');
const sharp = require('sharp');
const {GeminiClient} = require('../src/studio-gemini.cjs');
const {LocalDrive, segment, ROOT_URL} = require('../src/studio-drive.cjs');
const {ChatGPTImages, imageSource, composerText} = require('../src/studio-chatgpt.cjs');

const jobId = '12345678-1234-4567-abcd-123456789abc';
const hash = data => createHash('sha256').update(data).digest('hex');
function temp(t) {const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srm-studio-adapter-')); t.after(() => fs.rmSync(dir, {recursive: true, force: true})); return dir;}
const jpeg = color => sharp({create: {width: 600, height: 600, channels: 3, background: color || '#448899'}}).jpeg().toBuffer();
const model = (id, extra = {}) => ({name: 'models/' + id, displayName: id, supportedGenerationMethods: ['generateContent'], ...extra});
const response = value => new Response(JSON.stringify(value), {headers: {'Content-Type': 'application/json'}});
const completed = text => ({candidates: [{finishReason: 'STOP', content: {parts: [{text}]}}]});
const args = {jobId, name: 'Thông Tọa Extra', description: 'Mô tả sản phẩm đã duyệt', insight: 'Insight 1', sourceImages: ['https://down-vn.img.susercontent.com/source.jpg']};

test('Gemini follows model pagination and only selects a real text Flash model; keys stay in headers', async () => {
  const calls = [], key = 'API_PRIVATE_KEY';
  const client = new GeminiClient(() => ({}), () => ({geminiApiKey: key}), {fetch: async (url, options) => {
    calls.push({url, options});
    return response(calls.length === 1 ? {models: [model('gemini-2.5-flash'), model('gemini-3.7-flash-image')], nextPageToken: 'page/a'}
      : {models: [model('gemini-3.7-flash'), model('gemini-3.7-flash'), model('gemini-9.9-flash', {supportedGenerationMethods: ['embedContent']})]});
  }});
  const result = await client.models();
  assert.equal(result.selected, 'gemini-3.7-flash'); assert.equal(result.models.length, 3);
  assert.match(result.message, /Không thấy gemini-3.8-flash/);
  assert.equal(calls[1].url, 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=100&pageToken=page%2Fa');
  for (const call of calls) {assert.equal(call.options.headers['x-goog-api-key'], key); assert.equal(call.url.includes(key), false); assert.equal(call.options.redirect, 'error');}
});

test('Gemini handles repeated pages and provider errors without exposing response secrets', async () => {
  const loop = new GeminiClient(() => ({}), () => ({geminiApiKey: 'PRIVATE'}), {fetch: async () => response({models: [], nextPageToken: 'again'})});
  await assert.rejects(loop.models(), /phân trang.*lặp/);
  const denied = new GeminiClient(() => ({}), () => ({geminiApiKey: 'PRIVATE'}), {fetch: async () => new Response('PRIVATE bearer secret', {status: 403})});
  await assert.rejects(denied.models(), error => /HTTP 403/.test(error.message) && !/PRIVATE|bearer|secret/.test(error.message));
  const missing = new GeminiClient(() => ({}), () => ({}), {fetch: async () => {throw Error('must not fetch');}});
  await assert.rejects(missing.models(), /Nhập Gemini API key/);
});

test('dotted Gemini key reaches Google intact in the header and provider failures are safely classified', async()=>{
  const {studioInput}=require('../src/studio-settings.cjs'), key='AQ.'+'FAKE_DOTTED_KEY_'.repeat(4);
  const clean=studioInput({geminiApiKey:'\n'+key+'\n'});let requests=0;
  const client=new GeminiClient(()=>({}),()=>clean,{fetch:async(url,options)=>{requests++;assert.equal(options.headers['x-goog-api-key'],key);assert.equal(url.includes(key),false);return response({models:[model('gemini-test-flash')]});}});
  assert.equal((await client.models()).selected,'gemini-test-flash');assert.equal(requests,1);
  for(const [status,reason,pattern] of [[400,'API_KEY_INVALID',/Google xác nhận/],[403,'PERMISSION_DENIED',/quyền truy cập/],[429,'RESOURCE_EXHAUSTED',/hạn mức/]]){
    const denied=new GeminiClient(()=>({}),()=>clean,{fetch:async()=>new Response(JSON.stringify({error:{message:key,details:[{reason}]} }),{status})});
    await assert.rejects(denied.models(),error=>pattern.test(error.message)&&!error.message.includes(key));
  }
});

test('Gemini validates available model and complete JSON before accepting article', async () => {
  const settings = {geminiModel: 'gemini-3.7-flash', writingReference: 'Mẫu bài viết cũ'}, calls = [];
  let generated = completed(JSON.stringify({name: ' Thông Tọa Extra ', description: ' Mô tả bài đã viết '}));
  const client = new GeminiClient(() => settings, () => ({geminiApiKey: 'PRIVATE'}), {fetch: async (url, options) => {
    calls.push({url, options}); return response(url.includes(':generateContent') ? generated : {models: [model('gemini-3.7-flash')]});
  }});
  const input = {prompt: 'Bám sát công dụng nguồn', source: {name: 'Thông Tọa'}, insight: 'Insight 1', price: 200000};
  assert.deepEqual(await client.generate(input), {name: 'Thông Tọa Extra', description: 'Mô tả bài đã viết'});
  const body = JSON.parse(calls[1].options.body);
  assert.equal(body.generationConfig.responseMimeType, 'application/json'); assert.match(body.contents[0].parts[0].text, /Mẫu bài viết cũ/);
  settings.geminiModel = 'gemini-3.8-flash'; const before = calls.length;
  await assert.rejects(client.generate(input), /không có trong API/); assert.equal(calls.length, before + 1);
  settings.geminiModel = 'gemini-3.7-flash';
  for (const value of [{name: 'A', description: 'B', unexpected: true}, {name: 'A'.repeat(121), description: 'B'}, {name: 'A', description: ''}]) {
    generated = completed(JSON.stringify(value)); await assert.rejects(client.generate(input), /chưa đủ tên\/mô tả/);
  }
  generated = {candidates: [{finishReason: 'MAX_TOKENS', content: {parts: [{text: '{"name":"A","description":"B"}'}]}}]};
  await assert.rejects(client.generate(input), /chưa trả bài viết hoàn chỉnh/);
  await assert.rejects(client.test(), /chưa trả nội dung kiểm tra hoàn chỉnh/);
});

async function assets(t, buffers) {
  const dir = temp(t), data = buffers || new Array(5).fill(await jpeg());
  return {images: data.map((buffer, index) => {const file = path.join(dir, index + '.jpg'); fs.writeFileSync(file, buffer); return {path: file, hash: hash(buffer), sourceUrl: 'PRIVATE_SIGNED_SOURCE'};})};
}

test('Gemini writes from the requested replacement title and prompt without old listing facts', async()=>{
 const calls=[],client=new GeminiClient(()=>({geminiModel:'gemini-3.8-flash',writingReference:'Bố cục bài tham khảo'}),()=>({geminiApiKey:'LOCAL_TEST_KEY'}),{fetch:async(url,options)=>{
  calls.push({url,options});return response(url.includes(':generateContent')?completed(JSON.stringify({name:'Xịt mũi Sinus Spray',description:'Nội dung đúng sản phẩm mới.'})):{models:[model('gemini-3.8-flash')]});
 }});
 await client.generate({prompt:'Viết theo thông tin tôi cung cấp.',requestedName:'Xịt mũi Sinus Spray',source:{name:'Thông Tọa',description:'Rutin và Diosmin'},insight:'Thông Tọa',price:100000});
 const body=JSON.parse(calls[1].options.body),input=JSON.parse(body.contents[0].parts[0].text);
 assert.equal(input.requestedName,'Xịt mũi Sinus Spray');assert.equal(input.prompt,'Viết theo thông tin tôi cung cấp.');assert.equal('source' in input,false);assert.equal('insight' in input,false);
 assert.equal(JSON.stringify(body).includes('Rutin'),false);assert.match(body.systemInstruction.parts[0].text,/không đổi sang sản phẩm khác/);
});

test('Gemini retries temporary 503 at most twice and does not classify it as an invalid key',async()=>{
 let attempts=0;const delays=[],messages=[];
 const client=new GeminiClient(()=>({}),()=>({geminiApiKey:'PRIVATE_KEY'}),{fetch:async()=>{attempts++;return new Response('PRIVATE_KEY',{status:503});},sleep:async ms=>delays.push(ms),onRetry:message=>messages.push(message)});
 await assert.rejects(client.request('models'),error=>/HTTP 503.*tạm bận/.test(error.message)&&!/Kiểm tra key|PRIVATE_KEY/.test(error.message));
 assert.equal(attempts,3);assert.deepEqual(delays,[1000,2000]);assert.equal(messages.length,2);
 attempts=0;client.fetch=async()=>++attempts===1?new Response('',{status:503}):response({ok:true});assert.deepEqual(await client.request('models'),{ok:true});assert.equal(attempts,2);
 attempts=0;client.fetch=async()=>{attempts++;return new Response('',{status:403});};await assert.rejects(client.request('models'),/xác thực/);assert.equal(attempts,1);
});
const driveArgs = data => ({jobId, shop: 'nhathuockh.pharma', productId: '111', productName: 'Thông Tọa Extra', insight: 'Thông Tọa Extra', assets: data});

test('Local Drive persists exactly five verified JPEGs idempotently and reports only the root web link', async t => {
  const root = temp(t), data = await assets(t), drive = new LocalDrive(() => ({driveLocalFolder: root}));
  assert.equal(drive.test().connected, true);
  const result = await drive.uploadSet(driveArgs(data));
  assert.equal(result.folderUrl, ROOT_URL); assert.equal(result.cloudVerified, false); assert.equal(result.verified, true);
  assert.equal(result.images.length, 5); assert.equal(result.relativeDir, path.join('nhathuockh.pharma', 'Thông Tọa Extra'));
  assert.deepEqual(fs.readdirSync(result.localFolder).sort(), ['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg', 'srm-manifest.json']);
  for (const image of result.images) {assert.equal(hash(fs.readFileSync(image.path)), image.hash); assert.equal(image.url, undefined); assert.equal(image.mimeType, 'image/jpeg');}
  const manifest = fs.readFileSync(path.join(result.localFolder, 'srm-manifest.json'), 'utf8');
  assert.equal(manifest.includes('PRIVATE_SIGNED_SOURCE'), false); assert.equal(manifest.includes(data.images[0].path), false);
  const again = await drive.uploadSet(driveArgs(data)); assert.deepEqual(again.images, result.images);
  fs.writeFileSync(path.join(result.localFolder, '5.jpg'), await jpeg('#ee8844'));
  await assert.rejects(drive.uploadSet(driveArgs(data)), /hiện có đã khác/);
});

test('Local Drive validates all images before copying and rejects mismatched hashes, fake JPEGs and task collisions', async t => {
  const root = temp(t), drive = new LocalDrive(() => ({driveLocalFolder: root})), valid = await jpeg();
  const invalid = await assets(t, [valid, valid, valid, valid, Buffer.from([255, 216, 255, 0])]);
  await assert.rejects(drive.uploadSet(driveArgs(invalid)), /JPEG.*hỏng/);
  const folder = path.join(root, 'nhathuockh.pharma', 'Thông Tọa Extra'); assert.deepEqual(fs.readdirSync(folder), []);
  const good = await assets(t); good.images[0].hash = 'a'.repeat(64);
  await assert.rejects(drive.uploadSet(driveArgs(good)), /JPEG đã kiểm tra/); assert.deepEqual(fs.readdirSync(folder), []);
  good.images[0].hash = hash(valid); const result = await drive.uploadSet(driveArgs(good));
  await assert.rejects(drive.uploadSet({...driveArgs(good), jobId: '12345678-ffff-4567-abcd-123456789abc'}), /tác vụ khác/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(result.localFolder, 'srm-manifest.json'), 'utf8')).jobId, jobId);
  for (const value of ['..', '.', 'CON', 'LPT1.txt', '']) assert.throws(() => segment(value), /không hợp lệ/);
});

test('Local Drive separates shops and uses product ID for colliding product names without overwriting either set', async t => {
  const root = temp(t), firstAssets = await assets(t), secondAssets = await assets(t, new Array(5).fill(await jpeg('#cc8855'))), drive = new LocalDrive(() => ({driveLocalFolder: root}));
  const first = await drive.uploadSet(driveArgs(firstAssets));
  const secondArgs = {...driveArgs(secondAssets), jobId: 'aaaaaaaa-1234-4567-abcd-123456789abc', productId: '222'}, second = await drive.uploadSet(secondArgs);
  assert.equal(first.relativeDir, path.join('nhathuockh.pharma', 'Thông Tọa Extra')); assert.equal(second.relativeDir, path.join('nhathuockh.pharma', 'Thông Tọa Extra [222]'));
  assert.equal(hash(fs.readFileSync(first.images[0].path)), firstAssets.images[0].hash); assert.equal(hash(fs.readFileSync(second.images[0].path)), secondAssets.images[0].hash);
  const otherShop = await drive.uploadSet({...secondArgs, shop: 'khaihoanpharmacy'});
  assert.equal(otherShop.relativeDir, path.join('khaihoanpharmacy', 'Thông Tọa Extra')); assert.equal(otherShop.images[0].url, undefined);
  assert.equal((await drive.uploadSet(secondArgs)).localFolder, second.localFolder);
  assert.deepEqual(fs.readdirSync(first.localFolder).sort(), ['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg', 'srm-manifest.json']);
});

test('Local Drive resumes a legacy insight folder using saved relative path or exact job manifest', async t => {
  const root = temp(t), data = await assets(t), drive = new LocalDrive(() => ({driveLocalFolder: root})), relativeDir = path.join('nhathuockh.pharma', 'Thông Tọa Extra', 'Insight 1-12345678'), folder = path.join(root, relativeDir);
  fs.mkdirSync(folder, {recursive: true});
  const legacy = {jobId, shop: 'nhathuockh.pharma', productName: 'Thông Tọa Extra', insight: 'Insight 1', relativeDir, legacyNote: 'Giữ nguyên ghi chú cũ', images: data.images.map((image, index) => ({filename: index + 1 + '.jpg', hash: image.hash}))};
  fs.writeFileSync(path.join(folder, 'srm-manifest.json'), JSON.stringify(legacy)); fs.copyFileSync(data.images[0].path, path.join(folder, '1.jpg'));
  const restored = await drive.uploadSet({...driveArgs(data), relativeDir}); assert.equal(restored.localFolder, folder);
  assert.equal(JSON.parse(fs.readFileSync(path.join(folder, 'srm-manifest.json'), 'utf8')).insight, 'Insight 1');
  assert.equal(JSON.parse(fs.readFileSync(path.join(folder, 'srm-manifest.json'), 'utf8')).legacyNote, legacy.legacyNote);
  const found = await drive.uploadSet(driveArgs(data)); assert.equal(found.localFolder, folder); assert.equal(found.images.length, 5);
  assert.deepEqual(fs.readdirSync(path.dirname(folder)), ['Insight 1-12345678']);
  await assert.rejects(drive.uploadSet({...driveArgs(data), relativeDir: path.join('khaihoanpharmacy', 'Thông Tọa Extra')}), /đúng shop/);
  await assert.rejects(drive.uploadSet({...driveArgs(data), relativeDir: 'nhathuockh.pharma\\..'}), /không hợp lệ/);
});

test('Local Drive leaves a durable folder identity before copy failure and retries within the same product directory', async t => {
  const root = temp(t), data = await assets(t), drive = new LocalDrive(() => ({driveLocalFolder: root})), original = fs.copyFileSync; let copies = 0;
  fs.copyFileSync = (...args) => {copies++; if (copies === 3) throw Error('Mô phỏng Drive ngắt giữa lượt lưu ảnh'); return original(...args);};
  try {await assert.rejects(drive.uploadSet(driveArgs(data)), /ngắt giữa lượt/);} finally {fs.copyFileSync = original;}
  const folder = path.join(root, 'nhathuockh.pharma', 'Thông Tọa Extra'), intent = JSON.parse(fs.readFileSync(path.join(folder, 'srm-manifest.json'), 'utf8'));
  assert.equal(intent.jobId, jobId); assert.equal(intent.status, 'copying'); assert.equal(intent.images.length, 5);
  const restored = await drive.uploadSet(driveArgs(data)); assert.equal(restored.localFolder, folder); assert.equal(restored.images.length, 5);
  assert.deepEqual(fs.readdirSync(path.join(root, 'nhathuockh.pharma')), ['Thông Tọa Extra']);
});

test('Local Drive blocks folder junctions before creating anything outside root and refuses linked image targets', async t => {
  const root = temp(t), outside = temp(t), data = await assets(t), drive = new LocalDrive(() => ({driveLocalFolder: root}));
  const link = path.join(root, 'nhathuockh.pharma'); fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(drive.uploadSet(driveArgs(data)), /liên kết ngoài/); assert.deepEqual(fs.readdirSync(outside), []);
  fs.unlinkSync(link); const result = await drive.uploadSet(driveArgs(data));
  const target = path.join(result.localFolder, '1.jpg'); fs.unlinkSync(target);
  const externalFile = path.join(outside, 'private.jpg'); fs.writeFileSync(externalFile, 'unchanged');
  try {fs.symlinkSync(externalFile, target, 'file');} catch (error) {if (error.code === 'EPERM') {t.diagnostic('Quyền Windows không cho tạo file symlink; folder junction guard đã được kiểm tra, phần file symlink không chạy.'); return;} throw error;}
  await assert.rejects(drive.uploadSet(driveArgs(data)), /liên kết ngoài/); assert.equal(fs.readFileSync(externalFile, 'utf8'), 'unchanged');
});

function fakeChat(t, options = {}) {
  const dir = temp(t), state = {clock: 0, text: options.draft || '', attached: false, sent: 0, connected: 0, closed: 0, asserts: 0, uploads: 0};
  const send = {count: async () => 1, isVisible: async () => true, isEnabled: async () => !options.neverReady && state.clock >= (options.readyAt || 0), click: async () => {state.sent++; state.text = ''; state.attached = false; if (options.clickError) throw Error('Click timed out after dispatch');}};
  const input = {getAttribute: async () => 'image/*', setInputFiles: async () => {state.attached = true; state.uploads++;}};
  const inputs = {count: async () => 1, nth: () => input};
  const page = {url: () => 'https://chatgpt.com/c/test-conversation', locator: selector => selector === 'input[type=file]' ? inputs : send};
  const editor = {};
  const client = new ChatGPTImages(dir, () => ({chatgptPort: 9222}), () => {}, {
    now: () => state.clock, pause: async ms => {state.clock += ms;},
    connectBoundChatGpt: async () => {state.connected++; if (options.connectionError) throw Error('Browser unavailable'); return {page, browser: {close: async () => {state.closed++;}}};},
    downloadImage: async () => ({buffer: await jpeg()}), findEditor: async () => options.loggedOut ? null : editor,
    attachReference: async () => {state.attached = true; state.uploads++;},
    composerText: async () => state.text, attachmentState: async () => ({count: state.attached ? 1 : 0, busy: state.attached && state.clock < (options.uploadDoneAt || 0), error: false}),
    fillChatGptPrompt: async (element, prompt) => {state.text = prompt;},
    createImageRequestTracker: async () => ({assertConversation: async () => {state.asserts++;}, poll: async () => {if (options.pollError) throw Error('Conversation changed'); return {phase: 'image-ready', candidate: {image: {dispose: async () => {}}}};}}),
  });
  client.original = async () => ({data: await jpeg(), ext: 'jpg'});
  return {client, state, dir};
}

test('ChatGPT reads textarea values, validates image source origins and rejects login/profile changes before sending', async t => {
  assert.equal(await composerText({evaluate: fn => fn({tagName: 'TEXTAREA', value: 'draft preserved', innerText: ''})}), 'draft preserved');
  assert.equal(await composerText({evaluate: fn => fn({tagName: 'DIV', innerText: 'rich draft'})}), 'rich draft');
  for (const url of ['http://chatgpt.com/a', 'https://chatgpt.com.evil.test/a', 'https://PRIVATE@chatgpt.com/a', 'https://chatgpt.com:444/a', 'blob:https://evil.test/id', 'file:///private', 'data:image/png;base64,AA']) assert.throws(() => imageSource(url));
  assert.equal(imageSource('blob:https://chatgpt.com/123'), 'blob:https://chatgpt.com/123');
  const offline = fakeChat(t, {connectionError: true}); await assert.rejects(offline.client.generate(args), {code: 'CHATGPT_NOT_READY'}); assert.equal(offline.state.sent, 0); assert.equal(offline.client.busy, false);
  const login = fakeChat(t, {loggedOut: true}); await assert.rejects(login.client.generate(args), {code: 'CHATGPT_LOGIN_REQUIRED'}); assert.equal(login.state.sent, 0); assert.equal(login.state.closed, 1);
  const draft = fakeChat(t, {draft: 'Nhân viên đang viết'}); await assert.rejects(draft.client.generate(args), /bản nháp/); assert.equal(draft.state.uploads, 0); assert.equal(draft.state.text, 'Nhân viên đang viết');
});

test('ChatGPT waits for attachment and enabled send, persists five unique turns and reuses complete files without replay', async t => {
  const {client, state} = fakeChat(t, {readyAt: 2000, uploadDoneAt: 4000});
  const result = await client.generate(args);
  assert.equal(result.images.length, 5); assert.equal(state.sent, 5); assert.ok(state.clock >= 4000 + 700); assert.equal(client.busy, false);
  assert.equal(state.asserts, 11); assert.equal(state.uploads, 1); assert.equal(state.closed, 1);
  const again = await client.generate(args); assert.deepEqual(again, result); assert.equal(state.sent, 5); assert.equal(state.connected, 1);
  await assert.rejects(client.generate({...args, description: 'Nội dung đã khác'}), /khác bộ ảnh/); assert.equal(state.sent, 5);
});

test('ChatGPT never sends while upload is pending and never replays a timed out click or changed conversation', async t => {
  const pending = fakeChat(t, {neverReady: true}); await assert.rejects(pending.client.generate(args), {code: 'CHATGPT_NOT_READY'}); assert.equal(pending.state.sent, 0); assert.equal(pending.client.busy, false);
  for (const options of [{clickError: true}, {pollError: true}]) {
    const {client, state, dir} = fakeChat(t, options);
    await assert.rejects(client.generate(args), error => error.code === 'CHATGPT_IMAGE_UNCERTAIN' && error.submitted === true);
    assert.equal(state.sent, 1); const saved = JSON.parse(fs.readFileSync(path.join(dir, 'chatgpt-studio', jobId, 'journal.json'), 'utf8')); assert.equal(saved.turns[0].status, 'uncertain');
    await assert.rejects(client.generate(args), {code: 'CHATGPT_IMAGE_UNCERTAIN'}); assert.equal(state.sent, 1); assert.equal(state.connected, 1); assert.equal(client.busy, false);
  }
});

test('ChatGPT releases busy after corrupt journal or folder failure and blocks linked job folders', async t => {
  const {client, dir, state} = fakeChat(t), folder = path.join(dir, 'chatgpt-studio', jobId);
  fs.mkdirSync(folder); fs.writeFileSync(path.join(folder, 'journal.json'), '{broken');
  await assert.rejects(client.generate(args), {code: 'CHATGPT_NOT_READY'}); assert.equal(client.busy, false); assert.equal(state.connected, 0);
  fs.rmSync(folder, {recursive: true}); fs.writeFileSync(folder, 'not a directory');
  await assert.rejects(client.generate(args), {code: 'CHATGPT_NOT_READY'}); assert.equal(client.busy, false); fs.unlinkSync(folder);
  const outside = temp(t); fs.symlinkSync(outside, folder, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(client.generate(args), /liên kết ngoài/); assert.equal(client.busy, false); assert.deepEqual(fs.readdirSync(outside), []);
});

test('ChatGPT downloads actual source bytes with redirect rejection and validates full raster before accepting', async t => {
  const client = new ChatGPTImages(temp(t), () => ({})), data = await jpeg(), calls = []; let validations = 0;
  const src = 'https://files.oaiusercontent.com/generated.jpg';
  const tracker = {validateCandidate: async () => {validations++;}};
  class Reader {readAsDataURL(blob) {blob.arrayBuffer().then(buffer => {this.result = 'data:image/jpeg;base64,' + Buffer.from(buffer).toString('base64'); this.onload();});}}
  const element = {isConnected: true, tagName: 'IMG', complete: true, currentSrc: src};
  const candidate = {src, image: {evaluate: (fn, arg) => vm.runInNewContext('(' + fn.toString() + ')(element, arg)', {
    element, arg, URL, Blob, FileReader: Reader, AbortController, setTimeout, clearTimeout,
    fetch: async (url, options) => {calls.push({url, options}); return new Response(data, {headers: {'content-type': 'image/jpeg'}});},
  })}};
  const result = await client.original(candidate, tracker); assert.ok(result.data.equals(data)); assert.equal(result.ext, 'jpg'); assert.equal(validations, 2);
  assert.equal(calls[0].url, src); assert.equal(calls[0].options.redirect, 'error'); assert.equal(calls[0].options.credentials, 'omit');
  candidate.image.evaluate = async () => 'data:image/jpeg;base64,' + Buffer.from('<html>not an image</html>').toString('base64');
  await assert.rejects(client.original(candidate, tracker));
  candidate.src = 'https://127.0.0.1/private'; await assert.rejects(client.original(candidate, tracker), /không thuộc máy chủ/);
});
