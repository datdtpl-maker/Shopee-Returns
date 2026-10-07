importScripts('guards.js');
const BASE = 'http://127.0.0.1:9223';
const MAX_BYTES = 25 * 1024 * 1024;
const G = ShopeeImageGuards;
const securedStorage = Promise.all([
  chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'}),
  chrome.storage.session.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'})
]);
let operation = Promise.resolve();
const serial = callback => { const result = operation.then(callback, callback); operation = result.catch(() => {}); return result; };
const isChatGpt = value => {try {const url = new URL(value); return url.origin === 'https://chatgpt.com';} catch {return false;}};
async function readCapability() {return (await chrome.storage.local.get('capability')).capability || null;}
async function readBinding() {
  const binding = (await chrome.storage.session.get('binding')).binding || null;
  // Preserve an already paired 1.0.0 session when the extension is upgraded.
  if (binding?.token) {
    if (!await readCapability()) await chrome.storage.local.set({capability: {token: binding.token}});
    delete binding.token; await chrome.storage.session.set({binding});
  }
  return binding;
}
async function assertNoUnfinished(binding) {
  const seen = (await chrome.storage.local.get('seenCommands')).seenCommands || {};
  const pending = Object.values(seen).some(record => !['done', 'error'].includes(record.status)
    && (!binding || record.tabId === binding.tabId || (!Number.isInteger(record.tabId) && record.documentId === binding.documentId)));
  if (pending) throw Error('Có lượt tạo ảnh chưa xác minh trong tab trước. Không kết nối lại hoặc tự gửi lại; kiểm tra đúng chat và nhật ký ở tool.');
}
async function request(route, payload, token) {
  const response = await fetch(BASE + route, {method: 'POST', headers: {'Content-Type': 'application/json', ...(token ? {Authorization: 'Bearer ' + token} : {})},
    body: JSON.stringify(payload), credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(route === '/image' ? 60000 : 8000)});
  if (!response.ok) {
    let detail;
    try {detail = await response.json();} catch { /* Do not surface raw HTML or tokens. */ }
    throw Error(typeof detail?.message === 'string' && detail.message.length < 500 ? detail.message : 'Tool chưa kết nối hoặc đã từ chối phiên Chrome này.');
  }
  return response.json();
}
async function trustedSender(sender, payload) {
  const binding = await readBinding();
  if (!binding || !await readCapability() || sender.tab?.id !== binding.tabId || sender.frameId !== 0 || !isChatGpt(sender.url)
    || !G.identifier(payload.documentId) || typeof payload.path !== 'string' || !payload.path.startsWith('/') || payload.path.length > 250) throw Error('Tab ChatGPT chưa được ghép nối.');
  return binding;
}
async function claim(command, payload) {
  G.validateCommand(command);
  const stored = await chrome.storage.local.get('seenCommands'), seen = stored.seenCommands || {};
  if (seen[command.id]) return false;
  seen[command.id] = {tabId: payload.tabId, documentId: payload.documentId, status: 'claimed', at: Date.now()};
  // Preserve unfinished commands. A service worker restart must never resubmit them.
  const completed = Object.keys(seen).filter(key => seen[key].status === 'done' || seen[key].status === 'error').sort((a, b) => seen[a].at - seen[b].at);
  while (Object.keys(seen).length > 256 && completed.length) delete seen[completed.shift()];
  await chrome.storage.local.set({seenCommands: seen});
  return true;
}
async function commandRecord(commandId, documentId) {
  const stored = await chrome.storage.local.get('seenCommands'), record = stored.seenCommands?.[commandId];
  if (!G.identifier(commandId) || !record || record.documentId !== documentId) throw Error('Không còn đúng lệnh đã nhận.');
  return {seen: stored.seenCommands, record};
}
async function downloadedImage(source) {
  const src = G.imageSource(source);
  if (src.startsWith('blob:')) throw Error('Ảnh blob cần tải trong tab ChatGPT.');
  const response = await fetch(src, {credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(30000)});
  if (!response.ok || !response.body || !/^image\/(png|jpeg|webp)(;|$)/i.test(response.headers.get('content-type') || '')) throw Error('Không tải được file ảnh gốc từ ChatGPT.');
  const reader = response.body.getReader(), parts = []; let bytes = 0;
  while (true) {const item = await reader.read(); if (item.done) break; bytes += item.value.byteLength; if (bytes > MAX_BYTES) {await reader.cancel(); throw Error('Ảnh lớn hơn 25 MB.');} parts.push(item.value);}
  const data = new Uint8Array(bytes); let offset = 0; for (const part of parts) {data.set(part, offset); offset += part.byteLength;}
  let binary = ''; for (let i = 0; i < data.length; i += 16384) binary += String.fromCharCode(...data.subarray(i, i + 16384));
  return 'data:' + response.headers.get('content-type').split(';')[0] + ';base64,' + btoa(binary);
}
async function handle(message, sender) {
  await securedStorage;
  if (!message || typeof message !== 'object') throw Error('Thông điệp không hợp lệ.');
  if (message.kind === 'popup-status') {
    if (sender.tab || sender.url !== chrome.runtime.getURL('popup.html')) throw Error('Yêu cầu không hợp lệ.');
    const binding = await readBinding(), capability = await readCapability();
    return {paired: Boolean(capability), connected: Boolean(binding?.documentId) && !binding?.lastError, tabId: binding?.tabId,
      message: binding?.lastError || (binding?.documentId ? 'Đã kết nối tab ChatGPT. Giữ tab này mở trong lúc tạo ảnh.'
        : capability ? 'Đã nhớ ghép nối. Chọn tab ChatGPT rồi bấm Kết nối lại tab này; không cần nhập mã.' : 'Mở ChatGPT, nhập mã ghép nối đang hiện ở tool.')};
  }
  if (message.kind === 'pair') {
    if (sender.tab || sender.url !== chrome.runtime.getURL('popup.html') || typeof message.code !== 'string' || !/^[A-Z\d-]{6,40}$/i.test(message.code)
      || !Number.isInteger(message.tabId)) throw Error('Mã hoặc tab ghép nối không hợp lệ.');
    const tab = await chrome.tabs.get(message.tabId);
    if (!isChatGpt(tab.url)) throw Error('Hãy chọn đúng tab ChatGPT.');
    await assertNoUnfinished(await readBinding());
    const result = await request('/pair', {code: message.code});
    if (typeof result.token !== 'string' || result.token.length < 20 || result.token.length > 512) throw Error('Tool trả phiên ghép nối không hợp lệ.');
    await chrome.storage.local.set({capability: {token: result.token}});
    await chrome.storage.session.set({binding: {tabId: message.tabId, documentId: null}});
    await chrome.tabs.sendMessage(message.tabId, {kind: 'binding-ready'}).catch(() => {});
    return {paired: true, connected: false, message: 'Đã nhớ ghép nối. Đang kết nối tab đã chọn với tool…'};
  }
  if (message.kind === 'resume-tab') {
    if (sender.tab || sender.url !== chrome.runtime.getURL('popup.html') || !Number.isInteger(message.tabId)) throw Error('Tab kết nối không hợp lệ.');
    if (!await readCapability()) throw Error('Chưa có ghép nối đã lưu. Nhập mã từ tool một lần.');
    const tab = await chrome.tabs.get(message.tabId);
    if (!isChatGpt(tab.url)) throw Error('Hãy chọn đúng tab ChatGPT.');
    await assertNoUnfinished(await readBinding());
    await chrome.storage.session.set({binding: {tabId: message.tabId, documentId: null}});
    await chrome.tabs.sendMessage(message.tabId, {kind: 'binding-ready'}).catch(() => {});
    return {paired: true, connected: false, message: 'Đã chọn tab này. Đang xác nhận kết nối với tool…'};
  }
  const payload = message.payload || {}, binding = await trustedSender(sender, payload);
  const identity = {...payload, tabId: sender.tab.id}, {token} = await readCapability();
  if (message.kind === 'poll') {
    try {
      if (binding.documentId !== payload.documentId) {
        await assertNoUnfinished(binding);
        await request('/resume', identity, token);
        binding.documentId = payload.documentId;
        await chrome.storage.session.set({binding});
      }
      const result = await request('/poll', identity, token);
      delete binding.lastError; await chrome.storage.session.set({binding});
      if (result.command && !await claim(result.command, identity)) return {command: null};
      return result;
    } catch (error) {
      binding.lastError = error.message; await chrome.storage.session.set({binding}); throw error;
    }
  }
  if (binding.documentId !== payload.documentId) throw Error('Trang đã tải lại trong lúc chạy. Không tiếp tục lệnh cũ.');
  if (message.kind === 'event') {
    if (!['prepared', 'submitted', 'progress', 'complete', 'error'].includes(payload.type)) throw Error('Trạng thái không hợp lệ.');
    const {seen, record} = await commandRecord(payload.commandId, payload.documentId);
    if (payload.type === 'submitted') {
      if (record.status !== 'claimed' && record.status !== 'prepared') throw Error('Lượt đã gửi; không gửi lại.');
      record.status = 'submitted'; await chrome.storage.local.set({seenCommands: seen});
    }
    const result = await request('/event', identity, token);
    if (payload.type === 'prepared') record.status = 'prepared';
    if (payload.type === 'complete') record.status = 'done';
    if (payload.type === 'error') record.status = record.status === 'submitted' ? 'uncertain' : 'error';
    record.at = Date.now(); await chrome.storage.local.set({seenCommands: seen});
    return result;
  }
  if (message.kind === 'fetch-image') {
    const {record} = await commandRecord(payload.commandId, payload.documentId);
    if (record.status !== 'submitted') throw Error('Chưa có lượt gửi hợp lệ.');
    return {dataUrl: await downloadedImage(payload.source)};
  }
  if (message.kind === 'image') {
    const {record} = await commandRecord(payload.commandId, payload.documentId);
    if (record.status !== 'submitted' || typeof payload.dataUrl !== 'string' || payload.dataUrl.length > Math.ceil(MAX_BYTES * 4 / 3) + 100
      || !/^data:image\/(?:png|jpeg|webp);base64,[a-z\d+/]+={0,2}$/i.test(payload.dataUrl)) throw Error('File ảnh hoặc lượt gửi không hợp lệ.');
    return request('/image', identity, token);
  }
  throw Error('Chức năng không được hỗ trợ.');
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  serial(() => handle(message, sender)).then(result => respond({ok: true, result}), error => respond({ok: false, message: error.message}));
  return true;
});
