const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {ChromeImageBridge} = require('../src/studio-chrome-bridge.cjs');
const origin = 'chrome-extension://' + 'a'.repeat(32), otherOrigin = 'chrome-extension://' + 'b'.repeat(32);
const doc = {tabId: 17, documentId: 'doc-abc', path: '/'};
async function fixture(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srm-chrome-bridge-'));
  const bridge = new ChromeImageBridge(dir, {port: 0, ...options}), pair = await bridge.pair();
  const call = async (route, body, headers = {}) => {
    const response = await fetch('http://127.0.0.1:' + bridge.port + route, {method: 'POST', headers: {'Content-Type': 'application/json', Origin: origin, ...(token ? {Authorization: 'Bearer ' + token} : {}), ...headers}, body: JSON.stringify(body)});
    return {status: response.status, body: await response.json()};
  };
  let token = null;
  token = (await call('/pair', {code: pair.code})).body.token;
  const poll = extra => call('/poll', {...doc, ready: true, gate: null, draft: false, generating: false, ...extra});
  await poll();
  t.after(async () => {await bridge.close(); fs.rmSync(dir, {recursive: true, force: true});});
  const input = {jobId: 'job-a', prompts: Array.from({length: 5}, (_, index) => ({text: 'Prompt ' + index})), reference: {name: 'sample.jpg', mimeType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,YWJj'}, onImage: async value => ({index: value.index})};
  const event = (command, type, extra = {}) => call('/event', {...doc, commandId: command.id, type, phase: type, ...extra});
  return {dir, bridge, pair, call, poll, event, input};
}

test('bridge requires extension Origin, exact host/token and pinned tab/document; no arbitrary routes', async t => {
  const {bridge, call, poll} = await fixture(t);
  for (const headers of [{Origin: 'https://chatgpt.com'}, {Origin: otherOrigin}, {Authorization: 'Bearer wrong'}, {Host: 'localhost:' + bridge.port}]) assert.equal((await call('/poll', doc, headers)).status, 400);
  assert.equal((await poll({tabId: 18})).status, 400);
  assert.equal((await poll({documentId: 'other-document'})).status, 400);
  assert.equal((await poll({path: '/c/other-chat'})).status, 400);
  assert.equal((await call('/fetch', {url: 'http://localhost'})).status, 400);
  assert.equal((await call('/poll?x=1', doc)).status, 400);
  assert.equal((await call('/poll', {...doc, ready: 'true', draft: false, generating: false, gate: null})).status, 400);
  assert.equal(bridge.snapshot().ready, true);
});

test('pair code has no time expiry, is consumed once and guesses are bounded; snapshots omit token/code', async t => {
  const {bridge, call} = await fixture(t);
  const pair = await bridge.pair();
  assert.equal(pair.expiresAt, null); assert.equal(pair.oneTime, true); assert.match(pair.code, /^[A-F0-9]{32}$/);
  const now = Date.now; Date.now = () => now() + 365 * 86400000;
  try {assert.equal((await call('/pair', {code: pair.code})).status, 200);} finally {Date.now = now;}
  assert.equal((await call('/pair', {code: pair.code})).status, 400);
  const next = await bridge.pair(); for (let i = 0; i < 8; i++) assert.equal((await call('/pair', {code: 'WRONG'})).status, 400);
  assert.equal((await call('/pair', {code: next.code})).status, 400);
  assert.equal(JSON.stringify(bridge.snapshot()).includes(next.code), false);
  assert.equal(JSON.stringify(bridge.snapshot()).includes('token'), false);
});

test('saved capability restores across bridge restart, pins only selected tab and disconnect revokes it', async t => {
  let saved;
  const {bridge, dir} = await fixture(t, {savePairing: value => {saved = value;}});
  assert.match(saved.token, /^[a-f0-9]{64}$/); assert.equal(saved.origin, origin);
  assert.deepEqual(Object.keys(saved).sort(), ['origin', 'token']);
  const token = saved.token; await bridge.close();
  const restored = new ChromeImageBridge(dir, {port: 0, loadPairing: () => saved, savePairing: value => {saved = value;}});
  t.after(() => restored.close()); await restored.start();
  assert.equal(restored.snapshot().remembered, true); assert.equal(restored.snapshot().connected, false);
  assert.equal(restored.binding.tabId, undefined); assert.equal(restored.binding.documentId, undefined);
  const call = async (route, body, headers = {}) => {
    const response = await fetch('http://127.0.0.1:' + restored.port + route, {method: 'POST', headers: {Origin: origin, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...headers}, body: JSON.stringify(body)});
    return {status: response.status, body: await response.json()};
  };
  const selected = {...doc, tabId: 45, documentId: 'doc-restored', ready: true, draft: false, generating: false, gate: null};
  for (const headers of [{Origin: otherOrigin}, {Authorization: 'Bearer wrong'}]) assert.equal((await call('/resume', selected, headers)).status, 400);
  for (const payload of [{...selected, tabId: -1}, {...selected, documentId: ''}, {...selected, path: '/settings'}, {...selected, ready: 'yes'}]) assert.equal((await call('/resume', payload)).status, 400);
  assert.equal(restored.binding.documentId, undefined);
  assert.deepEqual((await call('/resume', selected)).body, {ok: true});
  assert.equal(restored.snapshot().ready, true);
  assert.equal((await call('/poll', {...selected, tabId: 46})).status, 400);
  assert.equal((await call('/resume', {...selected, documentId: 'doc-reloaded'})).status, 200);
  restored.disconnect(); assert.equal(saved, null); assert.equal(restored.snapshot().remembered, false);
  assert.equal((await call('/resume', selected)).status, 400);
});

test('pair persistence failure never returns a token, consumes code or replaces old binding', async t => {
  const {bridge, call} = await fixture(t);
  const binding = bridge.binding, pair = await bridge.pair();
  bridge.savePairing = () => {throw Error('storage unavailable');};
  assert.equal((await call('/pair', {code: pair.code})).status, 400);
  assert.equal(bridge.binding, binding); assert.equal(bridge.pairing.code, pair.code);
  assert.throws(() => bridge.disconnect(), /storage unavailable/); assert.equal(bridge.binding, binding);
});

test('resume and re-pair cannot switch tabs while active or after unresolved dispatch/restart', async t => {
  let saved;
  const {bridge, poll, call, input, dir} = await fixture(t, {savePairing: value => {saved = value;}});
  const pair = await bridge.pair(), run = bridge.generate(input).catch(error => error);
  const selected = {...doc, tabId: 45, documentId: 'doc-reloaded', ready: true, draft: false, generating: false, gate: null};
  assert.equal((await call('/resume', selected)).status, 400);
  assert.equal((await call('/pair', {code: pair.code})).status, 400);
  assert.throws(() => bridge.disconnect(), /Đang tạo ảnh/);
  await poll(); bridge.stop('lost dispatched request');
  assert.equal((await run).code, 'CHROME_IMAGE_UNCERTAIN');
  assert.equal((await call('/resume', selected)).status, 400); await assert.rejects(bridge.pair(), /chưa xác minh/);
  const recovered = new ChromeImageBridge(dir, {loadPairing: () => saved});
  await assert.rejects(recovered.route('/resume', selected, origin), /chưa xác minh/);
  await assert.rejects(recovered.route('/poll', selected, origin), /chưa xác minh/);
  assert.equal(recovered.binding.documentId, undefined);
  assert.equal((await poll()).body.command, null);
});

test('next prompt is unavailable while the current image save/verification is pending', async t => {
  const {bridge, poll, event, call, input} = await fixture(t);
  let finishSave, startedSave;
  const started = new Promise(resolve => {startedSave = resolve;});
  const run = bridge.generate({...input, onImage: async () => {startedSave(); await new Promise(resolve => {finishSave = resolve;}); return {};}}).catch(error => error);
  const command = (await poll()).body.command;
  assert.deepEqual(command.reference, input.reference);
  await event(command, 'prepared'); await event(command, 'submitted');
  const saving = call('/image', {...doc, commandId: command.id, dataUrl: 'data:image/png;base64,YWJj'});
  await started;
  assert.equal((await poll()).body.command, null); assert.equal((await event(command, 'complete')).status, 400);
  finishSave(); assert.equal((await saving).status, 200);
  assert.equal((await poll()).body.command, null, 'save ACK alone must not issue prompt 2');
  await event(command, 'complete'); assert.equal((await poll()).body.command.index, 1);
  bridge.stop('test end'); await run;
});

test('five images are saved sequentially with durable submit boundary and no duplicate polling/submission', async t => {
  const {dir, bridge, poll, call, event, input} = await fixture(t), saves = [];
  const done = bridge.generate({...input, onImage: async payload => {
    const journal = JSON.parse(fs.readFileSync(path.join(dir, 'chrome-image-studio', input.jobId, 'journal.json')));
    assert.equal(journal.commands[payload.index].state, 'receiving'); saves.push(payload.index); return {index: payload.index};
  }});
  let currentDoc = {...doc};
  for (let index = 0; index < 5; index++) {
    const command = (await poll(currentDoc)).body.command;
    assert.equal(command.index, index); assert.equal((await poll(currentDoc)).body.command, null);
    assert.equal((await call('/image', {...currentDoc, commandId: command.id, dataUrl: 'data:image/png;base64,YWJj'})).status, 400);
    assert.equal((await event(command, 'prepared', currentDoc)).status, 200);
    assert.equal((await event(command, 'submitted', currentDoc)).status, 200);
    assert.equal((await event(command, 'submitted', currentDoc)).status, 400);
    if (!index) currentDoc = {...doc, path: '/c/new-conversation'};
    assert.equal((await call('/image', {...currentDoc, commandId: command.id, dataUrl: 'data:image/png;base64,YWJj'})).status, 200);
    assert.equal(saves.length, index + 1);
    assert.equal((await event(command, 'complete', currentDoc)).status, 200);
  }
  assert.equal((await done).images.length, 5); assert.deepEqual(saves, [0, 1, 2, 3, 4]);
  assert.equal(bridge.snapshot().busy, false);
  await assert.rejects(bridge.generate(input), /đã có lượt gửi/);
});

test('lost delivery, post-submit error and restart do not replay historical commands', async t => {
  const {bridge, poll, event, input, dir} = await fixture(t);
  const run = bridge.generate(input); const result = run.catch(error => error);
  const command = (await poll()).body.command;
  assert.equal((await poll()).body.command, null);
  await event(command, 'prepared'); await event(command, 'submitted');
  await event(command, 'error', {phase: 'submitted'});
  assert.equal((await result).code, 'CHROME_IMAGE_UNCERTAIN');
  assert.equal((await poll()).body.command, null);
  const recovered = new ChromeImageBridge(dir); recovered.binding = {...bridge.binding};
  await assert.rejects(recovered.generate(input), /đã có lượt gửi/);
});

test('wrong image command, malformed base64 and early completion never call save callback', async t => {
  const {bridge, poll, event, call, input} = await fixture(t); let saves = 0;
  const run = bridge.generate({...input, onImage: async () => {saves++;}}).catch(error => error);
  const command = (await poll()).body.command; await event(command, 'prepared'); await event(command, 'submitted');
  for (const body of [{commandId: 'other', dataUrl: 'data:image/png;base64,YWJj'}, {commandId: command.id, dataUrl: 'data:image/png;base64,YWJj===='}, {commandId: command.id, dataUrl: 'https://example.com/image.png'}])
    assert.equal((await call('/image', {...doc, ...body})).status, 400);
  assert.equal((await event(command, 'complete')).status, 400); assert.equal(saves, 0);
  bridge.stop('test stop'); await run;
});

test('draft/gate readiness prevents new commands and pre-submit failure can retry explicitly', async t => {
  const {bridge, poll, event, input} = await fixture(t);
  await poll({draft: true}); await assert.rejects(bridge.generate(input), /trống/);
  await poll({gate: 'verification', ready: false}); await assert.rejects(bridge.generate(input), /trống/);
  await poll();
  const run = bridge.generate(input).catch(error => error), command = (await poll()).body.command;
  await event(command, 'error', {phase: 'prepare'}); assert.equal((await run).code, 'CHROME_IMAGE_FAILED');
  const retry = bridge.generate(input).catch(error => error); bridge.stop('stop before dispatch'); await retry;
});
