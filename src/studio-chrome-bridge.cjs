const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {randomBytes, randomUUID, timingSafeEqual} = require('node:crypto');
const {validateCommand, conversationPath} = require('./chrome-image-extension/guards.js');
const MAX_BYTES = 25 * 1024 * 1024;
const EXTENSION = /^chrome-extension:\/\/[a-p]{32}$/;
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const failure = (message, code = 'CHROME_IMAGE_INVALID') => Object.assign(Error(message), {code});
const identifier = value => typeof value === 'string' && /^[a-z\d_-]{1,120}$/i.test(value);
const detail = value => typeof value === 'string' ? value.replace(/https?:\/\/\S+|Bearer\s+\S+|\b(?:ntn_|secret_|AIza)[\w-]+/gi, '[đã ẩn]').replace(/[\x00-\x1f]/g, ' ').slice(0, 350) : '';

class ChromeImageBridge {
  constructor(dir, {port = 9223, onChange = () => {}, heartbeatMs = 90000, timeoutMs = 10 * 60000, loadPairing = () => null, savePairing = () => {}} = {}) {
    this.dir = path.join(dir, 'chrome-image-studio'); fs.mkdirSync(this.dir, {recursive: true});
    Object.assign(this, {port, onChange, heartbeatMs, timeoutMs, savePairing});
    this.server = null; this.binding = null; this.pairing = null; this.active = null; this.starting = null;
    this.status = 'Chưa ghép tiện ích với tab ChatGPT.';
    const saved = loadPairing();
    if (saved) {
      if (!EXTENSION.test(saved.origin || '') || !/^[a-f\d]{64}$/i.test(saved.token || '')) throw failure('Thông tin ghép Chrome đã lưu không hợp lệ. Ghép lại tiện ích.');
      this.binding = {origin: saved.origin, token: saved.token, lastSeen: 0};
      this.status = 'Đã nhớ Chrome trên máy này. Mở tiện ích và kết nối tab ChatGPT; không cần nhập mã lại.';
    }
  }
  snapshot() {
    const connected = !!this.binding && Date.now() - this.binding.lastSeen < 15000;
    return {connected, ready: connected && this.binding.ready && !this.binding.gate && !this.binding.draft && !this.binding.generating,
      message: this.status, progress: this.status, port: this.port, busy: !!this.active, completed: this.active?.completed || 0,
      jobId: this.active?.jobId || null, listening: !!this.server, remembered: !!this.binding, failed: this.failed || false, pairExpiresAt: null};
  }
  async start() {
    if (this.server) return;
    if (this.starting) return this.starting;
    this.starting = new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {void this.request(req, res);});
      server.requestTimeout = 65000; server.headersTimeout = 10000; server.maxConnections = 8;
      server.once('error', () => {this.starting = null; reject(failure('Cổng kết nối Chrome đang được dùng. Thoát bản tool khác rồi ghép lại.'));});
      server.listen(this.port, '127.0.0.1', () => {this.server = server; this.port = server.address().port; resolve();});
    });
    await this.starting;
  }
  async pair() {
    if (this.active) throw failure('Đang tạo ảnh; không đổi tab ghép nối.');
    this.assertNoUnresolved();
    await this.start(); this.failed = false;
    const code = randomBytes(16).toString('hex').toUpperCase();
    this.pairing = {code, attempts: 0};
    this.status = 'Nhập mã ghép nối vào tiện ích tại tab ChatGPT.'; this.onChange();
    return {code, expiresAt: null, oneTime: true, message: this.status};
  }
  disconnect() {
    if (this.active) throw failure('Đang tạo ảnh; không ngắt kết nối giữa lượt.');
    this.savePairing(null); this.binding = null; this.pairing = null; this.failed = false;
    this.status = 'Đã ngắt và xoá ghép nối Chrome trên tool.'; this.onChange(); return {message: this.status};
  }
  assertNoUnresolved() {
    for (const entry of fs.readdirSync(this.dir, {withFileTypes: true})) {
      if (!entry.isDirectory()) continue;
      const file = path.join(this.dir, entry.name, 'journal.json');
      if (!fs.existsSync(file)) continue;
      let journal;
      try {
        if (entry.isSymbolicLink() || !fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) throw Error();
        journal = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!Array.isArray(journal.commands)) throw Error();
      } catch {throw failure('Chưa đọc được nhật ký ảnh Chrome. Kiểm tra dữ liệu local; không tự ghép lại.');}
      if (journal.commands.some(command => !['queued', 'failed-before-submit', 'done'].includes(command.state)))
        throw failure('Có lượt ảnh chưa xác minh. Kiểm tra ChatGPT và nhật ký; không đổi tab hoặc tự gửi lại.', 'CHROME_IMAGE_UNCERTAIN');
    }
  }
  validateIdentity(payload) {
    if (!Number.isSafeInteger(payload.tabId) || payload.tabId < 0 || !identifier(payload.documentId)
      || typeof payload.path !== 'string' || !(payload.path === '/' || conversationPath(payload.path))) throw failure('Tab ChatGPT không hợp lệ.');
  }
  validateState(payload) {
    if (['ready', 'draft', 'generating'].some(field => typeof payload[field] !== 'boolean') || ![null, 'verification', 'login'].includes(payload.gate)) throw failure('Trạng thái ChatGPT không hợp lệ.');
  }
  persist(active) {
    const record = {version: 1, jobId: active.jobId, status: active.status, completed: active.completed,
      commands: active.commands.map(({id, index, state, submittedAt, savedAt}) => ({id, index, state, submittedAt, savedAt})), updatedAt: new Date().toISOString()};
    fs.writeFileSync(active.file + '.tmp', JSON.stringify(record, null, 2), {mode: 0o600}); fs.renameSync(active.file + '.tmp', active.file);
  }
  async generate({jobId, prompts, reference, onImage, onProgress = () => {}}) {
    if (this.active) throw failure('Chrome đang xử lý một bộ ảnh.');
    if (!identifier(jobId) || !Array.isArray(prompts) || prompts.length !== 5 || typeof onImage !== 'function') throw failure('Bộ prompt không hợp lệ.');
    if (!this.snapshot().ready) throw failure('Ghép tiện ích với tab ChatGPT trống, đã đăng nhập trước khi chạy.');
    const folder = path.join(this.dir, jobId);
    if (fs.existsSync(folder) && (!fs.lstatSync(folder).isDirectory() || fs.lstatSync(folder).isSymbolicLink())) throw failure('Thư mục lượt ảnh không hợp lệ.');
    fs.mkdirSync(folder, {recursive: true}); const file = path.join(folder, 'journal.json');
    if (fs.existsSync(file) && (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink())) throw failure('Nhật ký lượt ảnh không hợp lệ.');
    if (fs.existsSync(file)) {
      const previous = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (previous.commands?.some(command => !['queued', 'failed-before-submit'].includes(command.state)))
        throw failure('Bộ ảnh đã có lượt gửi hoặc chưa xác minh. Kiểm tra ChatGPT và dùng nhập ảnh dự phòng; tool không tự gửi lại.', 'CHROME_IMAGE_UNCERTAIN');
    }
    const expectedConversationPath = conversationPath(this.binding.path) ? this.binding.path : null;
    const commands = prompts.map((prompt, index) => ({id: randomUUID(), kind: 'generate', jobId, index,
      prompt: typeof prompt === 'string' ? prompt : prompt.text, reference, expectedConversationPath, state: 'queued'}));
    commands.forEach(validateCommand);
    return new Promise((resolve, reject) => {
      const active = {jobId, file, commands, index: 0, completed: 0, status: 'running', onImage, onProgress, resolve, reject,
        lastSeen: Date.now(), startedAt: Date.now(), images: []};
      this.active = active; this.failed = false; this.persist(active);
      this.status = 'Đang chờ tiện ích nhận prompt 1/5.'; onProgress(this.status); this.onChange();
      active.timer = setInterval(() => {
        if (Date.now() - active.lastSeen > this.heartbeatMs || Date.now() - active.startedAt > this.timeoutMs)
          this.stop('Mất kết nối hoặc quá thời gian chờ ảnh. Kiểm tra ChatGPT; không tự gửi lại.');
      }, 1000); active.timer.unref?.();
    });
  }
  stop(message) {
    const active = this.active; if (!active) return;
    const command = active.commands[active.index];
    const uncertain = !!command && !['queued', 'failed-before-submit'].includes(command.state);
    if (command) command.state = uncertain ? 'uncertain' : 'failed-before-submit';
    active.status = uncertain ? 'uncertain' : 'failed'; this.persist(active); clearInterval(active.timer); this.active = null;
    this.status = message; this.failed = true; this.onChange(); active.reject(failure(message, uncertain ? 'CHROME_IMAGE_UNCERTAIN' : 'CHROME_IMAGE_FAILED'));
  }
  identity(payload) {
    const binding = this.binding;
    this.validateIdentity(payload);
    if (binding.documentId === undefined) this.assertNoUnresolved();
    if (binding.tabId === undefined) binding.tabId = payload.tabId;
    if (binding.documentId === undefined && binding.tabId === payload.tabId) Object.assign(binding, {documentId: payload.documentId, path: payload.path});
    if (binding.tabId !== payload.tabId || binding.documentId !== payload.documentId) throw failure('Tab hoặc trang ChatGPT không khớp phiên ghép nối.');
    if (binding.path !== payload.path) {
      const command = this.active?.commands[this.active.index];
      if (binding.path !== '/' || !conversationPath(payload.path) || !command || !['submitted', 'receiving', 'image-saved'].includes(command.state)) throw failure('Cuộc trò chuyện ChatGPT đã thay đổi.');
      binding.path = payload.path;
      this.active.commands.forEach(item => {item.expectedConversationPath = payload.path;});
    }
    binding.lastSeen = Date.now(); if (this.active) this.active.lastSeen = Date.now();
  }
  async route(route, payload, origin) {
    if (route === '/pair') {
      if (this.active) throw failure('Đang tạo ảnh; không đổi ghép nối giữa lượt.');
      this.assertNoUnresolved();
      const pair = this.pairing;
      if (!pair || ++pair.attempts > 8 || !same(payload.code, pair.code)) throw failure('Mã ghép nối sai hoặc đã được dùng.');
      const saved = {origin, token: randomBytes(32).toString('hex')};
      this.savePairing(saved); this.binding = {...saved, lastSeen: 0}; this.pairing = null;
      this.status = 'Đã ghép tiện ích; đang chờ tab ChatGPT.'; this.onChange(); return {token: this.binding.token};
    }
    if (route === '/resume') {
      if (this.active) throw failure('Đang tạo ảnh; không đổi hoặc tải lại tab giữa lượt.');
      this.validateIdentity(payload); this.validateState(payload); this.assertNoUnresolved();
      this.binding = {origin: this.binding.origin, token: this.binding.token, tabId: payload.tabId, documentId: payload.documentId,
        path: payload.path, ready: payload.ready, draft: payload.draft, generating: payload.generating, gate: payload.gate, lastSeen: Date.now()};
      this.failed = false; this.status = 'Đã kết nối tab ChatGPT bằng kết nối đã lưu.'; this.onChange(); return {ok: true};
    }
    if (route === '/poll') this.validateState(payload);
    this.identity(payload);
    if (route === '/poll') {
      Object.assign(this.binding, {ready: payload.ready, draft: payload.draft, generating: payload.generating, gate: payload.gate});
      const active = this.active, command = active?.commands[active.index];
      if (!active && !this.failed) this.status = payload.gate ? 'ChatGPT cần đăng nhập hoặc xác minh.' : payload.draft ? 'ChatGPT có bản nháp; tool giữ nguyên.' : payload.generating ? 'ChatGPT đang xử lý lượt khác.' : 'Tab ChatGPT đã kết nối.';
      this.onChange();
      if (!command || command.state !== 'queued') return {command: null};
      if (!payload.ready || payload.gate || payload.draft || payload.generating) {this.stop('ChatGPT chưa sẵn sàng. Kiểm tra tab và bản nháp trước khi chạy.'); return {command: null};}
      command.state = 'dispatched'; active.startedAt = Date.now(); this.persist(active);
      const {state, ...publicCommand} = command; return {command: publicCommand};
    }
    const active = this.active, command = active?.commands[active.index];
    if (!command || payload.commandId !== command.id) throw failure('Lệnh không thuộc lượt ảnh hiện tại.');
    if (route === '/image') {
      if (command.state !== 'submitted') throw failure('Ảnh chưa có lượt gửi hợp lệ hoặc đã được lưu.');
      const match = typeof payload.dataUrl === 'string' && payload.dataUrl.match(/^data:image\/(png|jpeg|webp);base64,([a-z\d+/]+={0,2})$/i);
      if (!match || match[2].length > Math.ceil(MAX_BYTES * 4 / 3)) throw failure('File ảnh không hợp lệ hoặc vượt 25 MB.');
      const buffer = Buffer.from(match[2], 'base64');
      if (!buffer.length || buffer.length > MAX_BYTES || buffer.toString('base64') !== match[2]) throw failure('Nội dung file ảnh không hợp lệ.');
      command.state = 'receiving'; this.persist(active);
      try {
        const saved = await active.onImage({jobId: active.jobId, index: command.index, commandId: command.id, buffer, mimeType: 'image/' + match[1].toLowerCase()});
        if (this.active !== active) throw failure('Phiên ảnh đã dừng; kiểm tra file đã lưu.');
        active.images.push(saved); command.state = 'image-saved'; command.savedAt = new Date().toISOString(); this.persist(active); return {};
      } catch (error) {this.stop('Chưa lưu và xác minh được file ảnh. Kiểm tra nhật ký Studio và ChatGPT; không tự gửi lại.'); throw error;}
    }
    if (route !== '/event' || !['prepared', 'submitted', 'progress', 'complete', 'error'].includes(payload.type)) throw failure('Sự kiện ảnh không hợp lệ.');
    if (payload.type === 'prepared') {
      if (command.state !== 'dispatched') throw failure('Lượt đã được chuẩn bị.'); command.state = 'prepared';
    } else if (payload.type === 'submitted') {
      if (command.state !== 'prepared') throw failure('Không được gửi lại lệnh.');
      command.state = 'submitted'; command.submittedAt = new Date().toISOString();
    } else if (payload.type === 'complete') {
      if (command.state !== 'image-saved') throw failure('Chưa có file ảnh đã xác minh.');
      command.state = 'done'; active.completed++; active.index++;
      if (active.completed === 5) {
        active.status = 'done'; this.persist(active); clearInterval(active.timer); this.active = null;
        this.status = 'Đã lưu đủ 5 ảnh. Xem ảnh rồi bấm gắn vào bài Notion.'; this.onChange(); active.resolve({images: active.images, conversationUrl: 'https://chatgpt.com' + this.binding.path}); return {};
      }
      active.startedAt = Date.now();
    } else if (payload.type === 'error') {
      if (payload.phase !== 'submitted' && ['dispatched', 'prepared'].includes(command.state)) command.state = 'failed-before-submit';
      this.stop((payload.phase === 'submitted' ? 'Lượt tạo ảnh chưa xác minh. Không tự gửi lại. ' : 'Chưa gửi prompt. ') + (detail(payload.message) || 'Kiểm tra ô đính kèm và bản nháp ChatGPT.')); return {};
    } else if (!['submitted', 'image-saved'].includes(command.state)) throw failure('Chưa có lượt tạo ảnh hợp lệ.');
    this.persist(active); this.status = 'Ảnh ' + Math.min(active.index + 1, 5) + '/5 · ' + ({prepared: 'đã nhập prompt và ảnh mẫu', submitted: 'đang tạo', progress: 'đang chờ kết quả', complete: 'chờ prompt tiếp theo'}[payload.type] || 'đang xử lý');
    active.onProgress(this.status); this.onChange(); return {};
  }
  async request(req, res) {
    const origin = req.headers.origin;
    const reply = (code, value) => {if (!res.destroyed) {res.writeHead(code, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}); res.end(JSON.stringify(value));}};
    try {
      if (req.headers.host !== '127.0.0.1:' + this.port || !EXTENSION.test(origin || '') || !['/pair', '/resume', '/poll', '/event', '/image'].includes(req.url)) throw failure('Kết nối không được phép.');
      const route = req.url;
      if (route !== '/pair' && (!this.binding || origin !== this.binding.origin || req.method !== 'OPTIONS' && !same(req.headers.authorization, 'Bearer ' + this.binding.token))) throw failure('Phiên không được phép.');
      res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
      if (req.method === 'OPTIONS') {res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization'); res.setHeader('Access-Control-Allow-Methods', 'POST'); reply(204, {}); return;}
      if (req.method !== 'POST' || !/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw failure('Yêu cầu không hợp lệ.');
      const maximum = route === '/image' ? Math.ceil(MAX_BYTES * 4 / 3) + 1000 : 4096;
      if (Number(req.headers['content-length']) > maximum) throw failure('Yêu cầu quá lớn.');
      let bytes = 0; const chunks = [];
      for await (const chunk of req) {bytes += chunk.length; if (bytes > maximum) throw failure('Yêu cầu quá lớn.'); chunks.push(chunk);}
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw failure('Yêu cầu không hợp lệ.');
      const result = await this.route(route, payload, origin); reply(200, result);
    } catch {reply(400, {message: 'Tool từ chối yêu cầu hoặc phiên ảnh đã dừng. Kiểm tra trạng thái trên tool.'});}
  }
  async close() {this.stop('Tool đã đóng; kiểm tra ChatGPT trước khi tiếp tục.'); this.binding = null; if (this.server) {const server = this.server; this.server = null; server.closeAllConnections(); await new Promise(resolve => server.close(resolve));}}
}
module.exports = {ChromeImageBridge};
