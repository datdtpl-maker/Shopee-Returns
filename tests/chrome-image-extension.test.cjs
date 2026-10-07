const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const G = require('../src/chrome-image-extension/guards.js');
const dir = path.join(__dirname, '../src/chrome-image-extension');
const command = () => ({id: 'command-1', kind: 'generate', jobId: 'job-1', index: 0, prompt: 'Tạo ảnh cho sản phẩm đã chọn.', expectedConversationPath: null,
  reference: {name: 'reference.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,AA=='}});
const fresh = () => {
  const {marker, text} = G.promptFor(command());
  const image = {src: 'https://files.oaiusercontent.com/result.png', complete: true, width: 1024, height: 1024, completedCard: true};
  return {turns: [{key: 'old-1', role: 'user', text: 'Tin cũ'}, {key: 'old-2', role: 'assistant', text: 'Ảnh cũ', images: []},
    {key: 'new-1', role: 'user', text}, {key: 'new-2', role: 'assistant', busy: false, images: [image]}],
  baselineKeys: new Set(['old-1', 'old-2']), baselineSources: new Set(['https://files.oaiusercontent.com/old.png']), expectedPrompt: text, marker, requestKey: null, generating: false};
};
test('extension permissions are restricted to selected service and loopback, without debugger/cookies', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.deepEqual(manifest.host_permissions, ['https://chatgpt.com/*', 'https://files.oaiusercontent.com/*', 'http://127.0.0.1:9223/*']);
  assert.deepEqual(manifest.content_scripts[0].matches, ['https://chatgpt.com/*']);
  assert.equal(manifest.manifest_version, 3);
});
test('unique prompt includes exact job, image ordinal and command marker', () => {
  const value = command(); value.index = 4;
  const result = G.promptFor(value);
  assert.equal(result.marker, 'SRM job-1 ảnh 5 lệnh command-1');
  assert.ok(result.text.includes('Mã lượt: ' + result.marker));
  assert.ok(result.text.startsWith(value.prompt));
});
test('reject malformed commands before changing composer', () => {
  for (const changed of [{index: 5}, {index: -1}, {prompt: ''}, {kind: 'unknown'}, {id: '../bad'}, {expectedConversationPath: '/login'},
    {reference: {name: '../bad.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,AA=='}},
    {reference: {name: 'bad.png', mimeType: 'image/png', dataUrl: 'data:image/jpeg;base64,AA=='}}]) assert.throws(() => G.validateCommand({...command(), ...changed}));
});
test('only original image sources on supported HTTPS hosts or ChatGPT blobs are allowed', () => {
  for (const src of ['https://chatgpt.com/backend-api/files/result', 'https://files.oaiusercontent.com/img?sig=unused', 'blob:https://chatgpt.com/id']) assert.equal(G.imageSource(src), src);
  for (const src of ['http://chatgpt.com/x', 'https://files.oaiusercontent.com.evil.test/x', 'https://user:pass@chatgpt.com/x', 'https://chatgpt.com:9000/x', 'blob:https://evil.test/x', 'data:image/png;base64,AA==', 'file:///x']) assert.throws(() => G.imageSource(src));
});
test('select exactly the completed image from the exact new reply', () => {
  const value = fresh(), state = G.requestState(value);
  assert.equal(state.phase, 'candidate'); assert.equal(state.requestKey, 'new-1'); assert.equal(state.replyKey, 'new-2');
  assert.equal(state.image.src, value.turns[3].images[0].src);
});
test('old prompt, duplicate prompt, wrong request identity or extra messages are not accepted', () => {
  const old = fresh(); old.baselineKeys.add('new-1'); assert.throws(() => G.requestState(old));
  const duplicate = fresh(); duplicate.turns.push({...duplicate.turns[2], key: 'new-3'}); assert.throws(() => G.requestState(duplicate));
  const changed = fresh(); changed.requestKey = 'different-user'; assert.throws(() => G.requestState(changed));
  for (const role of ['user', 'unknown', 'assistant']) {const extra = fresh(); extra.turns.push({key: 'extra', role, text: 'Khác', images: []}); assert.throws(() => G.requestState(extra));}
});
test('completion needs generation stopped, a completed card, full image and fresh source', () => {
  for (const changed of [{complete: false}, {width: 499}, {height: 499}, {completedCard: false}, {src: 'https://files.oaiusercontent.com/old.png'}]) {
    const value = fresh(); Object.assign(value.turns[3].images[0], changed); assert.equal(G.requestState(value).phase, 'generating');
  }
  const active = fresh(); active.generating = true; assert.equal(G.requestState(active).phase, 'generating');
  const busy = fresh(); busy.turns[3].busy = true; assert.equal(G.requestState(busy).phase, 'generating');
  const multiple = fresh(); multiple.turns[3].images.push({...multiple.turns[3].images[0], src: 'https://files.oaiusercontent.com/second.png'}); assert.throws(() => G.requestState(multiple));
});

function workerHarness({local = {}, session = {}} = {}) {
  const calls = [], storageAccess = []; let receiver, failSubmitted = false, failResume = false;
  const bucket = (data, name) => ({get: async key => ({[key]: data[key]}), set: async value => Object.assign(data, structuredClone(value)), setAccessLevel: async value => storageAccess.push({name, ...value})});
  const ctx = {ShopeeImageGuards: G, importScripts() {}, URL, AbortSignal, Uint8Array, btoa, setTimeout, clearTimeout,
    chrome: {runtime: {getURL: file => 'chrome-extension://test-extension/' + file, onMessage: {addListener: handler => receiver = handler}},
      storage: {local: bucket(local, 'local'), session: bucket(session, 'session')}, tabs: {get: async id => ({id, url: 'https://chatgpt.com/'}), sendMessage: async () => {}}},
    fetch: async (url, options) => {
      calls.push({url, payload: JSON.parse(options.body), options});
      const route = new URL(url).pathname;
      if (route === '/pair') return {ok: true, json: async () => ({token: 'test-token-at-least-20-chars'})};
      if (route === '/resume' && failResume) return {ok: false, json: async () => ({message: 'Resume rejected'})};
      if (route === '/poll') return {ok: true, json: async () => ({command: command()})};
      if (route === '/event' && calls.at(-1).payload.type === 'submitted' && failSubmitted) return {ok: false, json: async () => ({message: 'ACK failed'})};
      return {ok: true, json: async () => ({ok: true})};
    }};
  vm.runInNewContext(fs.readFileSync(path.join(dir, 'background.js'), 'utf8'), ctx);
  const popup = {url: 'chrome-extension://test-extension/popup.html'};
  const content = {tab: {id: 42}, frameId: 0, url: 'https://chatgpt.com/'};
  const post = (kind, payload, sender = content) => new Promise(resolve => receiver({kind, payload}, sender, resolve));
  const pair = () => new Promise(resolve => receiver({kind: 'pair', code: 'PAIR-123', tabId: 42}, popup, resolve));
  const popupCall = message => new Promise(resolve => receiver(message, popup, resolve));
  return {local, session, calls, content, popup, post, pair, popupCall, storageAccess, failSubmitted: () => {failSubmitted = true;}, failResume: () => {failResume = true;}};
}
test('worker pins tab and document, overrides submitted tabId, persists command claim and does not replay it', async () => {
  const w = workerHarness(); assert.equal((await w.pair()).ok, true);
  const state = {documentId: 'document-1', path: '/', ready: true, draft: false, gate: null, generating: false, tabId: 99};
  assert.equal((await w.post('poll', state)).result.command.id, 'command-1');
  assert.equal(w.calls.at(-1).payload.tabId, 42); assert.equal(w.local.seenCommands['command-1'].status, 'claimed');
  assert.equal((await w.post('poll', state)).result.command, null);
  assert.equal((await w.post('poll', {...state, documentId: 'reloaded'})).ok, false);
  assert.equal((await w.post('poll', state, {...w.content, tab: {id: 43}})).ok, false);
  assert.equal((await w.post('poll', state, {...w.content, frameId: 1})).ok, false);
  assert.equal((await w.post('poll', state, {...w.content, url: 'https://evil.test'})).ok, false);
});
test('failed server submit ACK still blocks second send and image before submit is rejected', async () => {
  const w = workerHarness(); await w.pair(); const identity = {documentId: 'document-1', path: '/', commandId: 'command-1'};
  await w.post('poll', {...identity, ready: true});
  assert.equal((await w.post('image', {...identity, dataUrl: 'data:image/png;base64,AA=='})).ok, false);
  w.failSubmitted(); assert.equal((await w.post('event', {...identity, type: 'submitted', phase: 'submitted'})).ok, false);
  assert.equal(w.local.seenCommands['command-1'].status, 'submitted');
  assert.equal((await w.post('event', {...identity, type: 'submitted', phase: 'submitted'})).ok, false);
  assert.equal((await w.post('poll', {...identity, ready: true})).result.command, null);
});

test('capability persists in trusted local storage, selected tab stays session-only and Chrome restart requires explicit tab selection', async () => {
  const w = workerHarness(); await w.pair();
  assert.equal(w.local.capability.token, 'test-token-at-least-20-chars');
  assert.equal(w.session.binding.token, undefined);
  assert.equal(w.local.capability.tabId, undefined);
  assert.deepEqual(w.storageAccess, [{name: 'local', accessLevel: 'TRUSTED_CONTEXTS'}, {name: 'session', accessLevel: 'TRUSTED_CONTEXTS'}]);
  const restarted = workerHarness({local: w.local, session: {}});
  const status = (await restarted.popupCall({kind: 'popup-status'})).result;
  assert.equal(status.paired, true); assert.equal(status.connected, false); assert.equal(status.tabId, undefined);
  const payload = {documentId: 'document-after-restart', path: '/', ready: true, draft: false, gate: null, generating: false};
  assert.equal((await restarted.post('poll', payload)).ok, false, 'must not auto-adopt arbitrary Chrome tab');
  assert.equal(restarted.calls.length, 0);
  assert.equal((await restarted.popupCall({kind: 'resume-tab', tabId: 42})).ok, true);
  assert.equal((await restarted.post('poll', payload)).ok, true);
  assert.deepEqual(restarted.calls.map(call => new URL(call.url).pathname), ['/resume', '/poll']);
  assert.equal(restarted.calls[0].options.headers.Authorization, 'Bearer test-token-at-least-20-chars');
  assert.equal(restarted.session.binding.documentId, 'document-after-restart');
});

test('reload with completed journal can resume without another pairing code', async () => {
  const w = workerHarness(); await w.pair(); const identity = {documentId: 'document-1', path: '/', commandId: 'command-1'};
  await w.post('poll', {...identity, ready: true});
  await w.post('event', {...identity, type: 'prepared', phase: 'prepared'});
  await w.post('event', {...identity, type: 'submitted', phase: 'submitted'});
  await w.post('image', {...identity, dataUrl: 'data:image/png;base64,AA=='});
  await w.post('event', {...identity, type: 'complete', phase: 'complete'});
  const before = w.calls.length;
  assert.equal((await w.post('poll', {...identity, documentId: 'document-reload', ready: true})).ok, true);
  assert.deepEqual(w.calls.slice(before).map(call => new URL(call.url).pathname), ['/resume', '/poll']);
  assert.equal(w.local.seenCommands['command-1'].status, 'done');
  assert.equal(w.session.binding.documentId, 'document-reload');
});

test('unresolved local commands block reconnect and reload even if pairing token survived Chrome restart', async () => {
  for (const state of ['claimed', 'prepared', 'submitted', 'uncertain']) {
    const w = workerHarness(); await w.pair(); const identity = {documentId: 'document-1', path: '/', commandId: 'command-1'};
    await w.post('poll', {...identity, ready: true}); w.local.seenCommands['command-1'].status = state;
    const before = w.calls.length;
    assert.equal((await w.post('poll', {...identity, documentId: 'new-document', ready: true})).ok, false);
    assert.equal((await w.popupCall({kind: 'resume-tab', tabId: 42})).ok, false);
    assert.equal(w.calls.length, before);
    const restarted = workerHarness({local: w.local, session: {}});
    assert.equal((await restarted.popupCall({kind: 'resume-tab', tabId: 42})).ok, false);
    assert.equal(restarted.calls.length, 0);
  }
});

test('content/page cannot choose a tab or obtain remembered capability through popup commands', async () => {
  const w = workerHarness(); await w.pair();
  for (const kind of ['popup-status', 'resume-tab', 'pair']) assert.equal((await w.post(kind, {tabId: 42})).ok, false);
  assert.equal(w.calls.length, 1);
});

test('failed resume ACK never pins new document or polls for commands', async () => {
  const w = workerHarness(); await w.pair(); w.failResume();
  const state = {documentId: 'new-document', path: '/', ready: true, draft: false, gate: null, generating: false};
  assert.equal((await w.post('poll', state)).ok, false);
  assert.equal(w.session.binding.documentId, null);
  assert.equal(w.session.binding.lastError, 'Resume rejected');
  assert.deepEqual(w.calls.map(call => new URL(call.url).pathname), ['/pair', '/resume']);
  assert.equal((await w.post('resume', state)).ok, false, 'only poll can issue resume; a direct content request is refused');
  assert.equal(w.calls.length, 2);
});

test('content script sends once with reference, waits for new completed image, fetches original bytes and preserves existing drafts', async t => {
  const executable = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)
    .map(root => path.join(root, 'Google/Chrome/Application/chrome.exe')).find(file => fs.existsSync(file));
  if (!executable) return t.skip('Google Chrome is not installed for the isolated DOM fixture.');
  const {chromium} = require('playwright'), sharp = require('sharp');
  const png = await sharp({create: {width: 1024, height: 1024, channels: 3, background: '#9a5f23'}}).png().toBuffer();
  const browser = await chromium.launch({executablePath: executable, headless: true});
  try {
    const context = await browser.newContext();
    await context.route('**/*', route => {
      if (route.request().url() === 'https://chatgpt.com/') return route.fulfill({contentType: 'text/html', body: '<!doctype html><html><head><title>ChatGPT fixture</title></head><body><main><article data-message-id="old-user" data-message-author-role="user">Lượt cũ</article><article data-message-id="old-answer" data-message-author-role="assistant"><img src="https://files.oaiusercontent.com/old.png"></article></main><form><input type="file" accept="image/*"><textarea id="prompt-textarea"></textarea><button type="button" data-testid="send-button">Gửi</button></form></body></html>'});
      if (/^https:\/\/files\.oaiusercontent\.com\/(?:old|new)\.png$/.test(route.request().url())) return route.fulfill({contentType: 'image/png', body: png});
      return route.abort();
    });
    const page = await context.newPage(); await page.goto('https://chatgpt.com/');
    await page.evaluate(value => {
      window.fixture = {clicks: 0, events: [], images: [], polled: false, command: value};
      window.chrome.runtime = {
        onMessage: {addListener() {}},
        sendMessage: async message => {
          if (message.kind === 'poll') {
            if (window.fixture.polled) return {ok: true, result: {command: null}};
            window.fixture.polled = true; return {ok: true, result: {command: window.fixture.command}};
          }
          if (message.kind === 'event') {window.fixture.events.push(message.payload); return {ok: true, result: {ok: true}};}
          if (message.kind === 'image') {window.fixture.images.push(message.payload); return {ok: true, result: {ok: true}};}
          throw Error('Unexpected fixture call');
        }
      };
      document.querySelector('input[type=file]').addEventListener('change', () => {
        const preview = document.createElement('img'); preview.src = 'https://files.oaiusercontent.com/old.png'; document.querySelector('form').append(preview);
      });
      document.querySelector('[data-testid="send-button"]').addEventListener('click', () => {
        window.fixture.clicks++;
        const user = document.createElement('article'); user.dataset.messageId = 'new-user'; user.dataset.messageAuthorRole = 'user'; user.textContent = document.querySelector('textarea').value;
        const answer = document.createElement('article'); answer.dataset.messageId = 'new-answer'; answer.dataset.messageAuthorRole = 'assistant';
        const card = document.createElement('div'), image = document.createElement('img'); image.src = 'https://files.oaiusercontent.com/new.png';
        const edit = document.createElement('button'); edit.setAttribute('aria-label', 'Edit image');
        const download = document.createElement('button'); download.setAttribute('aria-label', 'Download');
        card.append(image, edit, download); answer.append(card); document.querySelector('main').append(user, answer);
        document.querySelector('textarea').value = ''; document.querySelector('form img').remove();
        history.replaceState({}, '', '/c/fixture-conversation');
      });
    }, command());
    await page.addScriptTag({path: path.join(dir, 'guards.js')});
    await page.addScriptTag({path: path.join(dir, 'content.js')});
    await page.waitForFunction(() => window.fixture.events.some(event => event.type === 'complete'), null, {timeout: 15000});
    const done = await page.evaluate(() => ({clicks: fixture.clicks, events: fixture.events, images: fixture.images}));
    assert.equal(done.clicks, 1); assert.equal(done.images.length, 1);
    assert.deepEqual(Buffer.from(done.images[0].dataUrl.split(',')[1], 'base64'), png, 'file is source bytes, never a screenshot/canvas export');
    assert.equal(done.images[0].path, '/c/fixture-conversation');
    assert.ok(done.events.findIndex(event => event.type === 'prepared') < done.events.findIndex(event => event.type === 'submitted'));
    assert.ok(done.events.findIndex(event => event.type === 'submitted') < done.events.findIndex(event => event.type === 'complete'));
    await page.close();
    const draft = await context.newPage(); await draft.goto('https://chatgpt.com/');
    await draft.evaluate(value => {
      window.fixture = {clicks: 0, events: [], polled: false}; document.querySelector('textarea').value = 'Bản nháp của người dùng';
      window.chrome.runtime = {onMessage: {addListener() {}}, sendMessage: async message => {
        if (message.kind === 'poll') {if (fixture.polled) return {ok: true, result: {command: null}}; fixture.polled = true; return {ok: true, result: {command: value}};}
        if (message.kind === 'event') {fixture.events.push(message.payload); return {ok: true, result: {ok: true}};}
        throw Error('Unexpected call while preserving draft');
      }};
      document.querySelector('[data-testid="send-button"]').addEventListener('click', () => fixture.clicks++);
    }, command());
    await draft.addScriptTag({path: path.join(dir, 'guards.js')}); await draft.addScriptTag({path: path.join(dir, 'content.js')});
    await draft.waitForFunction(() => fixture.events.some(event => event.type === 'error'));
    assert.equal(await draft.locator('textarea').inputValue(), 'Bản nháp của người dùng');
    assert.equal(await draft.evaluate(() => fixture.clicks), 0);
    assert.equal(await draft.locator('input[type=file]').evaluate(input => input.files.length), 0);
  } finally {await browser.close();}
});
