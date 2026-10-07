const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {createHash, randomUUID} = require('node:crypto');
const {chromium} = require('playwright');
const {readDebugEndpoint, bindChatGptSession, connectBoundChatGpt, profileEndpoint} = require('./chatgpt/chatgpt-session.js');
const {attachReference} = require('./chatgpt/chatgpt-attachment.js');
const {findEditor, fillChatGptPrompt} = require('./chatgpt/chatgpt-composer.js');
const {createImageRequestTracker} = require('./chatgpt/chatgpt-image-request.js');
const {downloadImage} = require('./replacement-images.cjs');
const prompts = require('./prompts/shopee-images.json');

const fail = (message, code = 'CHATGPT_NOT_READY') => Object.assign(Error(message), {code});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const digest = data => createHash('sha256').update(data).digest('hex');
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const normalize = text => String(text || '').normalize('NFC').replace(/\s+/gu, ' ').trim();
const contained = (root, file) => {const relative = path.relative(root, file); return !relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));};

function writeAtomic(file, data) {
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw fail('File bộ ảnh không được là liên kết ngoài.');
  const temporary = path.join(path.dirname(file), '.write-' + randomUUID() + '.tmp');
  try {fs.writeFileSync(temporary, data, {flag: 'wx', mode: 0o600}); fs.renameSync(temporary, file);}
  finally {if (fs.existsSync(temporary)) fs.unlinkSync(temporary);}
}

function imageSource(value) {
  let url;
  try {url = new URL(value);} catch {throw fail('Link ảnh ChatGPT không hợp lệ.');}
  const httpsAllowed = address => address.protocol === 'https:' && !address.username && !address.password
    && (!address.port || address.port === '443') && ['chatgpt.com', 'files.oaiusercontent.com'].includes(address.hostname);
  if (url.protocol === 'blob:') {
    let nested; try {nested = new URL(url.pathname);} catch {throw fail('Blob ảnh không thuộc ChatGPT.');}
    if (!httpsAllowed(nested) || nested.hostname !== 'chatgpt.com') throw fail('Blob ảnh không thuộc ChatGPT.');
  } else if (!httpsAllowed(url)) throw fail('Nguồn ảnh ChatGPT không thuộc máy chủ được hỗ trợ.');
  return url.href;
}

const SEND_SELECTORS = [
  'button[data-testid="send-button"]',
  'button[data-testid="fruitjuice-send-button"]',
  '[data-testid="send-button"]',
  '[data-testid="fruitjuice-send-button"]',
  'button[aria-label="Send prompt"]',
  'button[aria-label="Gửi phản hồi"]',
  'button[aria-label*="Send" i]',
  'button[aria-label*="Gửi" i]',
  'button.mb-1.mr-1',
  '#prompt-textarea ~ button',
  'div[contenteditable="true"] ~ button',
  'form button[type="submit"]',
  'button:has(svg path[d*="M12"])'
];

async function composerText(editor) {
  return editor.evaluate(element => element.tagName === 'TEXTAREA' || element.tagName === 'INPUT' ? element.value : element.innerText);
}

async function findSendButton(page, editor) {
  if (editor && typeof editor.locator === 'function') {
    try {
      const form = editor.locator('xpath=ancestor::form');
      const formTarget = typeof form.first === 'function' ? form.first() : form;
      if (await formTarget.count() > 0) {
        for (const sel of SEND_SELECTORS) {
          const btn = formTarget.locator(sel);
          const btnTarget = typeof btn.first === 'function' ? btn.first() : btn;
          if (await btnTarget.count() > 0 && await btnTarget.isVisible() && await btnTarget.isEnabled()) return btnTarget;
        }
      }
    } catch {}
  }
  for (const sel of SEND_SELECTORS) {
    try {
      const loc = page.locator(sel);
      const target = typeof loc.first === 'function' ? loc.first() : loc;
      if (await target.count() > 0 && await target.isVisible() && await target.isEnabled()) return target;
    } catch {}
  }
  return null;
}

async function attachmentState(editor) {
  try {
    return await editor.evaluate(element => {
      const root = element.closest('form') || element.closest('[data-testid="composer"]') || element.closest('#composer') || document.querySelector('form') || element.parentElement?.parentElement;
      if (!root) return {count: 0, busy: false, error: false};
      const visible = item => Boolean(item.getClientRects().length) && getComputedStyle(item).visibility !== 'hidden';
      const preview = [...root.querySelectorAll('img,[data-testid*="attachment"],[data-testid*="thumbnail"],[data-testid*="file"],[aria-label*="Remove" i],[aria-label*="Xóa" i],[class*="thumbnail"],[class*="attachment"]')].filter(visible);
      const status = [...root.querySelectorAll('[role="progressbar"],[aria-busy="true"],[data-testid*="upload-progress"],[class*="progress"],[class*="loading"],svg.animate-spin')].filter(visible);
      const text = [...root.querySelectorAll('[role="alert"],[data-testid*="error"]')].filter(visible).map(item => item.textContent).join(' ');
      return {count: preview.length, busy: status.length > 0, error: /failed|error|không thể|thất bại|lỗi/i.test(text)};
    });
  } catch {
    return {count: 0, busy: false, error: false};
  }
}

class ChatGPTImages {
  constructor(dir, settings, onProgress = () => {}, dependencies = {}) {
    this.dir = path.join(dir, 'chatgpt-studio'); fs.mkdirSync(this.dir, {recursive: true});
    this.settings = settings; this.onProgress = onProgress; this.binding = null; this.busy = false;
    this.api = {readDebugEndpoint, bindChatGptSession, connectBoundChatGpt, findEditor, fillChatGptPrompt, findSendButton, createImageRequestTracker, downloadImage, composerText, attachmentState, attachReference, pause, now: Date.now, ...dependencies};
  }
  port() {const value = this.settings().chatgptPort || 9222; if (!Number.isInteger(value) || value < 1024 || value > 65535) throw fail('Cổng Chrome Debug cần số nguyên 1024–65535.'); return value;}
  profile() {
    const custom = this.settings().chatgptProfileDir;
    if (custom && fs.existsSync(custom)) return custom;
    const mcpShopeeProfile = 'D:\\Project Anti\\MCP Shopee\\chrome_profile_debug';
    if (fs.existsSync(mcpShopeeProfile)) return mcpShopeeProfile;
    return path.join(this.dir, 'profile-cdp');
  }
  async ownedEndpoint() {
    const port = this.port();
    try {
      const endpoint = await this.api.readDebugEndpoint(port);
      if (endpoint) { this.activePort = port; return endpoint; }
    } catch {}
    try {
      const owned = profileEndpoint(this.profile());
      const endpoint = await this.api.readDebugEndpoint(owned.port);
      if (endpoint) { this.activePort = owned.port; return endpoint; }
    } catch {}
    throw fail('Chrome Debug chưa mở cổng hoặc chưa sẵn sàng. Hãy bấm Khởi động Chrome Debug từ tool.');
  }
  snapshot() {return {connected:!!this.binding, ready:this.binding?.ready === true, busy:this.busy, port:this.activePort || this.port(), profileDir:this.profile()};}
  async open() {
    if (this.busy) throw fail('ChatGPT đang tạo ảnh; chờ bộ ảnh hiện tại kết thúc.');
    const port = this.port();
    let endpoint;
    try { endpoint = await this.ownedEndpoint(); } catch {}
    if (!endpoint) {
      const candidates = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean).map(dir => path.join(dir, 'Google', 'Chrome', 'Application', 'chrome.exe'));
      const chrome = candidates.find(file => fs.existsSync(file)); if (!chrome) throw fail('Cần cài Google Chrome để tạo ảnh.');
      const profileDir = this.profile();
      fs.mkdirSync(profileDir, {recursive: true});
      const child = spawn(chrome, ['https://chatgpt.com', `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`], {detached: true, stdio: 'ignore'});
      child.on('error', () => {}); child.unref();
      const deadline = this.api.now() + 15000;
      while (this.api.now() < deadline) {
        try { endpoint = await this.ownedEndpoint(); if (endpoint) break; } catch {}
        await this.api.pause(500);
      }
      if (!endpoint) throw fail(`Chrome Debug chưa mở cổng ${port}. Nếu Chrome đang mở, hãy kiểm tra hoặc đóng lại và mở từ tool.`);
    }
    this.binding = await this.api.bindChatGptSession(chromium, endpoint, this.profile(), null);
    return {ready: this.binding.ready, message: this.binding.ready ? `Đã kết nối Chrome Debug (cổng ${port}) và tab ChatGPT sẵn sàng.` : `Đã mở Chrome Debug (cổng ${port}). Đăng nhập ChatGPT nếu cần rồi bấm Kiểm tra kết nối.`};
  }
  async test() {
    if (this.busy) throw fail('ChatGPT đang tạo ảnh; chờ bộ ảnh hiện tại kết thúc.');
    const port = this.port();
    let endpoint;
    try { endpoint = await this.ownedEndpoint(); }
    catch (e) { throw fail(`Không kết nối được Chrome Debug cổng ${port}. Hãy bấm Khởi động Chrome Debug từ tool hoặc chạy run_debug_chrome.bat.`); }
    this.binding = await this.api.bindChatGptSession(chromium, endpoint, this.profile(), this.binding);
    if (!this.binding.ready) throw fail('Đăng nhập hoặc mở tab chatgpt.com trong Chrome Debug rồi kiểm tra lại.', 'CHATGPT_LOGIN_REQUIRED');
    return {ready: true, message: `ChatGPT sẵn sàng trên Chrome Debug (cổng ${port}).`};
  }
  async original(candidate, tracker) {
    await tracker.validateCandidate(candidate); const src = imageSource(candidate.src);
    const payload = await candidate.image.evaluate(async (element, {src, maxBytes}) => {
      if (!element.isConnected || element.tagName !== 'IMG' || (element.currentSrc || element.src) !== src || !element.complete) throw Error('Ảnh đã thay đổi hoặc chưa hoàn chỉnh.');
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30000);
      try {
        // Download the source file itself. Never export a canvas or screenshot.
        const response = await fetch(src, {credentials: new URL(src).hostname === 'chatgpt.com' ? 'same-origin' : 'omit', redirect: 'error', signal: controller.signal});
        if (!response.ok || !response.body) throw Error('Không tải được file ảnh ChatGPT.');
        const reader = response.body.getReader(), chunks = []; let bytes = 0;
        while (true) {const part = await reader.read(); if (part.done) break; bytes += part.value.length; if (bytes > maxBytes) {await reader.cancel(); throw Error('Ảnh quá 25 MB.');} chunks.push(part.value);}
        const blob = new Blob(chunks, {type: response.headers.get('content-type') || 'application/octet-stream'});
        return await new Promise((resolve, reject) => {const file = new FileReader(); file.onload = () => resolve(file.result); file.onerror = reject; file.readAsDataURL(blob);});
      } finally {clearTimeout(timer);}
    }, {src, maxBytes: 25 * 1024 * 1024});
    if (typeof payload !== 'string' || !/^data:[^,]*;base64,[a-z\d+/=]+$/i.test(payload)) throw fail('File ảnh ChatGPT không hợp lệ.');
    const data = Buffer.from(payload.split(',')[1], 'base64'); if (!data.length || data.length > 25 * 1024 * 1024) throw fail('File ảnh ChatGPT không hợp lệ.');
    const image = require('sharp')(data, {limitInputPixels: 40000000, failOn: 'error'}), metadata = await image.metadata();
    if (!['png', 'jpeg', 'webp'].includes(metadata.format) || metadata.width < 500 || metadata.height < 500 || (metadata.pages || 1) > 1) throw fail('Ảnh ChatGPT chưa đủ kích thước hoặc sai định dạng.');
    await image.resize(1, 1).raw().toBuffer(); await tracker.validateCandidate(candidate);
    return {data, ext: metadata.format === 'jpeg' ? 'jpg' : metadata.format};
  }
  async waitToSend(page, editor) {
    const deadline = this.api.now() + 60000; let readySince = null;
    while (this.api.now() < deadline) {
      const state = await this.api.attachmentState(editor); if (state.error) throw fail('ChatGPT không tải được ảnh tham khảo. Chưa gửi prompt.');
      if (!state.busy) {
        const send = await this.api.findSendButton(page, editor);
        if (send) {
          if (readySince === null) readySince = this.api.now();
          if (this.api.now() - readySince >= 700) return send;
        } else readySince = null;
      } else readySince = null;
      await this.api.pause(200);
    }
    const finalSend = await this.api.findSendButton(page, editor);
    if (finalSend) return finalSend;
    throw fail('Ảnh tham khảo chưa upload xong hoặc nút gửi chưa sẵn sàng. Chưa gửi.');
  }
  async generate({jobId, name, description, insight, sourceImages, styleImage, reference: selectedReference, prompts: preparedPrompts, contentDigest, onImage, onProgress, singleIndex}) {
    if (this.busy) throw fail('ChatGPT đang tạo một bộ ảnh khác.');
    const streaming = !!preparedPrompts;
    if (!UUID.test(jobId || '') || (streaming ? !selectedReference || !Array.isArray(preparedPrompts) || preparedPrompts.length !== 5 || preparedPrompts.some(p=>!p?.text) || typeof onImage !== 'function' : !name || !description || !Array.isArray(sourceImages) || !sourceImages.length)) throw fail('Thiếu tác vụ, bài viết hoặc ảnh sản phẩm gốc.');
    this.busy = true; let browser, submitted = false, journal, journalFile;
    const save = () => writeAtomic(journalFile, JSON.stringify(journal, null, 2));
    try {
      const dir = path.join(this.dir, jobId);
      if (fs.existsSync(dir) && fs.lstatSync(dir).isSymbolicLink()) throw fail('Thư mục bộ ảnh không được là liên kết ngoài.');
      fs.mkdirSync(dir, {recursive: true}); journalFile = path.join(dir, 'journal.json');
      if (fs.existsSync(journalFile) && fs.lstatSync(journalFile).isSymbolicLink()) throw fail('Nhật ký bộ ảnh không được là liên kết ngoài.');
      const requestHash = digest(JSON.stringify(streaming ? {jobId, contentDigest, preparedPrompts, reference: selectedReference.dataUrl} : {jobId, name, description, insight, sourceImages, styleImage, prompts}));
      journal = fs.existsSync(journalFile) ? JSON.parse(fs.readFileSync(journalFile, 'utf8')) : {jobId, requestHash, turns: []};
      if (journal.jobId !== jobId || !Array.isArray(journal.turns) || journal.turns.length > 5 || journal.turns.some(turn => turn && !['submitted', 'uncertain', 'done'].includes(turn.status))) throw fail('Nhật ký bộ ảnh không hợp lệ. Không gửi prompt.');
      const isSingle = Number.isInteger(singleIndex) && singleIndex >= 0 && singleIndex <= 4;
      if (isSingle) {
        if (journal.turns[singleIndex]?.status === 'uncertain') {
          delete journal.turns[singleIndex];
          save();
        }
        if (journal.turns[singleIndex]?.status === 'submitted') {
          throw fail('Lượt tạo ảnh này đang gửi. Hãy đợi hoàn tất.', 'CHATGPT_BUSY');
        }
      } else if (!streaming) {
        if (journal.turns.some(turn => turn && ['submitted', 'uncertain'].includes(turn.status))) throw fail('Bộ ảnh có lượt gửi chưa xác minh. Không tự gửi lại; kiểm tra đúng chat trước.', 'CHATGPT_IMAGE_UNCERTAIN');
      } else {
        let cleaned = false;
        for (let i = 0; i < journal.turns.length; i++) {
          if (journal.turns[i]?.status === 'uncertain') {
            delete journal.turns[i];
            cleaned = true;
          }
        }
        if (cleaned) save();
      }
      if (journal.requestHash !== requestHash) throw fail('Bài viết hoặc ảnh nguồn khác bộ ảnh đã lưu. Tạo tác vụ mới để không nhận nhầm ảnh.');
      for (const saved of journal.turns) if (saved?.status === 'done') {
        if (typeof saved.path !== 'string' || !contained(dir, path.resolve(saved.path)) || !fs.existsSync(saved.path) || fs.lstatSync(saved.path).isSymbolicLink() || digest(fs.readFileSync(saved.path)) !== saved.hash) throw fail('Ảnh đã lưu thay đổi. Không gửi lại tự động.');
      }
      if (singleIndex === undefined || singleIndex === null) {
        if (journal.turns.length === 5 && journal.turns.every(turn => turn?.status === 'done')) return {images: journal.turns, conversationUrl: journal.conversationUrl};
      }
      const connection = await this.api.connectBoundChatGpt(chromium, this.activePort || this.port(), this.binding); browser = connection.browser; const page = connection.page;
      if (journal.conversationUrl) {
        const norm = u => (u || '').split('?')[0].replace(/\/+$/, '');
        const currentUrl = norm(page.url());
        const savedUrl = norm(journal.conversationUrl);
        if (currentUrl !== savedUrl) {
          if ((savedUrl === 'https://chatgpt.com' || isSingle) && currentUrl.startsWith('https://chatgpt.com/c/')) {
            journal.conversationUrl = page.url();
            save();
          } else {
            throw fail('Không còn ở cuộc trò chuyện của bộ ảnh đang làm (' + journal.conversationUrl + '). Quay lại đúng chat trước khi tiếp tục.');
          }
        }
      }
      if (selectedReference && !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z\d+/=]+$/.test(selectedReference.dataUrl || '')) throw fail('Ảnh mẫu được chọn không hợp lệ.');
      const source = selectedReference ? Buffer.from(selectedReference.dataUrl.split(',')[1], 'base64') : (await this.api.downloadImage(sourceImages[0])).buffer;
      if (source.length > 25 * 1024 * 1024) throw fail('Ảnh mẫu vượt 25 MB.');
      const referenceFile = path.join(dir, 'reference.png');
      const reference = await require('sharp')(source, {limitInputPixels:40000000,failOn:'error'}).rotate().png().toBuffer(); writeAtomic(referenceFile, reference);
      const results = [];
      const startIndex = isSingle ? singleIndex : 0;
      const endIndex = isSingle ? singleIndex + 1 : 5;
      for (let index = startIndex; index < endIndex; index++) {
        const saved = journal.turns[index]; if (saved?.status === 'done' && !isSingle) {results.push(saved); continue;}
        const editor = await this.api.findEditor(page); if (!editor) throw fail('ChatGPT yêu cầu đăng nhập hoặc composer đã thay đổi. Chưa gửi prompt.', 'CHATGPT_LOGIN_REQUIRED');
        if (normalize(await this.api.composerText(editor)) || (await this.api.attachmentState(editor)).count) throw fail('Ô ChatGPT đang có bản nháp hoặc ảnh đính kèm. Dọn bản nháp trong trình duyệt trước; tool không ghi đè.');
        const marker = 'SRM ' + jobId + ' ảnh ' + (index + 1);
        const promptNote = index === 0
          ? '\nMã lượt: ' + marker + '\nẢnh đính kèm là sản phẩm gốc cần giữ nguyên bao bì. Chỉ tạo đúng 1 ảnh, không trả lời bằng văn bản.'
          : '\nMã lượt: ' + marker + '\nGiữ nguyên sản phẩm gốc và phong cách ở các ảnh trước. Chỉ tạo đúng 1 ảnh, không trả lời bằng văn bản.';
        const prompt = (streaming ? preparedPrompts[index].text : prompts[index].replaceAll('{{selected_notion_content}}', name + '\n' + description).replaceAll('{{selected_keywords}}', insight || '').replaceAll('{{image_sample}}', styleImage || 'Không có ảnh phong cách; tự thiết kế đồng bộ')).concat(promptNote);
        const tracker = await this.api.createImageRequestTracker(page, prompt); await tracker.assertConversation({beforeSend: true});
        if (index === 0) {
          await this.api.attachReference(page, editor, referenceFile);
          await tracker.assertConversation({beforeSend: true});
        }
        if (normalize(await this.api.composerText(editor))) throw fail('Ô chat đã được sửa trong lúc đính kèm ảnh. Chưa gửi prompt.');
        await this.api.fillChatGptPrompt(editor, prompt);
        const send = await this.waitToSend(page, editor); await tracker.assertConversation({beforeSend: true});
        if (normalize(await this.api.composerText(editor)) !== normalize(prompt)) throw fail('Prompt đã thay đổi khi tải ảnh. Chưa gửi để tránh chạy sai bài.');
        // Persist before clicking: a click timeout may still mean the server accepted it.
        journal.turns[index] = {status: 'submitted', at: new Date().toISOString(), marker}; save(); submitted = true;
        // First click dispatch: focus editor and press Enter + force click button
        try {
          if (editor && typeof editor.focus === 'function') {
            await editor.focus().catch(() => {});
            if (page.keyboard) await page.keyboard.press('Enter').catch(() => {});
          }
        } catch {}
        try {
          await send.click({timeout: 2500, force: true});
        } catch (err) {
          try { await send.dispatchEvent('click'); } catch {}
          try { await send.evaluate(b => b.click()); } catch {}
          if (err?.message?.includes('Click timed out after dispatch')) throw err;
        }
        // Keyboard Enter and retry fallback if text remains in composer
        for (let attempt = 2; attempt <= 8; attempt++) {
          await this.api.pause(1000);
          try {
            const remaining = normalize(await this.api.composerText(editor));
            if (!remaining) break;
          } catch { break; }
          try {
            if (editor && typeof editor.focus === 'function') {
              await editor.focus().catch(() => {});
              if (page.keyboard) await page.keyboard.press('Enter').catch(() => {});
            }
            const btn = (await this.api.findSendButton(page, editor)) || send;
            if (btn) {
              await btn.click({timeout: 1500, force: true}).catch(async () => {
                await btn.dispatchEvent('click').catch(() => {});
                await btn.evaluate(b => b.click()).catch(() => {});
              });
            }
          } catch {}
        }
        const deadline = this.api.now() + 8 * 60000; let candidate;
        while (this.api.now() < deadline) {const state = await tracker.poll(); const message = 'ChatGPT · ảnh ' + (index + 1) + '/5 · ' + (state.phase === 'image-ready' ? 'đang tải file ảnh' : 'đang tạo'); this.onProgress(message); if (onProgress) onProgress(message); if (state.phase === 'image-ready') {candidate = state.candidate; break;} await this.api.pause(1500);}
        if (!candidate) throw fail('ChatGPT chưa có ảnh hoàn chỉnh sau 8 phút.', 'CHATGPT_IMAGE_UNCERTAIN');
        let original; try {original = await this.original(candidate, tracker);} finally {await candidate.image.dispose().catch(() => {});}
        const png = await require('sharp')(original.data, {limitInputPixels:40000000,failOn:'error'}).png().toBuffer();
        const output = path.join(dir, String(index + 1) + '.png'); writeAtomic(output, png);
        // The Studio callback persists Drive + preview before the next send.
        if (onImage) await onImage({jobId, contentDigest, index, buffer:png});
        const done = {status: 'done', path: output, filename: path.basename(output), hash: digest(png)};
        journal.turns[index] = done; journal.conversationUrl = page.url(); save(); submitted = false; results.push(done);
      }
      return {images: results, conversationUrl: journal.conversationUrl};
    } catch (error) {
      if (submitted) {
        const turn = journal.turns.find(turn => turn?.status === 'submitted'); if (turn) turn.status = 'uncertain';
        try {save();} catch { /* The already persisted submitted record still blocks replay. */ }
        error.submitted = true; error.uncertain = true; error.code = 'CHATGPT_IMAGE_UNCERTAIN';
      } else if (!['CHATGPT_IMAGE_UNCERTAIN', 'CHATGPT_LOGIN_REQUIRED'].includes(error.code)) error.code = 'CHATGPT_NOT_READY';
      throw error;
    } finally {this.busy = false; if (browser) await browser.close().catch(() => {});}
  }
}
module.exports = {ChatGPTImages, imageSource, composerText, attachmentState};
