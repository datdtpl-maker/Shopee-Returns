(() => {
  'use strict';
  const G = ShopeeImageGuards, documentId = crypto.randomUUID(), MAX_BYTES = 25 * 1024 * 1024;
  const nodeIds = new WeakMap(); let nextNode = 0, running = false, connected = true;
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const visible = element => {
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && (Boolean(element.getClientRects().length)
      || (style.display === 'contents' && [...element.children].some(visible)));
  };
  const keyFor = element => {
    const messageId = element.getAttribute('data-message-id') || element.querySelector('[data-message-id]')?.getAttribute('data-message-id');
    if (messageId) return 'message:' + messageId;
    if (!nodeIds.has(element)) nodeIds.set(element, documentId + ':' + (++nextNode));
    return nodeIds.get(element);
  };
  const label = element => G.normalize(element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent);
  const excluded = element => Boolean(element.closest('form,nav,aside,header,footer,[role="dialog"],[contenteditable="true"]'));
  function editor() {
    const choices = [...document.querySelectorAll('#prompt-textarea[contenteditable="true"],textarea#prompt-textarea,[data-testid="composer-text-input"][contenteditable="true"],form [contenteditable="true"][role="textbox"],form .ProseMirror[contenteditable="true"],textarea[name="prompt-textarea"]')]
      .filter(element => visible(element) && !element.disabled && (element.isContentEditable || element.tagName === 'TEXTAREA'));
    return choices.length === 1 ? choices[0] : null;
  }
  const composerRoot = element => element?.closest('form') || element?.closest('[data-testid="composer"],#composer,#composer-background,[data-composer]') || element?.parentElement?.parentElement;
  const editorText = element => element ? (element.tagName === 'TEXTAREA' ? element.value : element.innerText) : '';
  function attachments(element) {
    const root = composerRoot(element);
    if (!root) return {count: 0, busy: false, error: false};
    return {
      count: [...root.querySelectorAll('img,[data-testid*="attachment"],[data-testid="file-thumbnail"]')].filter(visible).length,
      busy: [...root.querySelectorAll('[role="progressbar"],[aria-busy="true"],[data-testid*="upload-progress"]')].some(visible),
      error: [...root.querySelectorAll('[role="alert"],[data-testid*="error"]')].some(element => visible(element) && /failed|error|không thể|thất bại|lỗi/i.test(element.textContent))
    };
  }
  function generating() {
    return [...document.querySelectorAll('button,[role="button"]')].some(button => visible(button)
      && (button.getAttribute('data-testid') === 'stop-button' || /^(?:stop|dừng)(?:$|[\s.,])/i.test(label(button))));
  }
  function gate() {
    if (/just a moment|verify|verification|xác minh/i.test(document.title) || document.querySelector('iframe[src*="challenges.cloudflare.com"]')) return 'verification';
    if (/\/(auth|login|signup)(\/|$)/.test(location.pathname) || [...document.querySelectorAll('[data-testid="login-button"]')].some(visible)) return 'login';
    return null;
  }
  function completedCard(image, turn) {
    for (let card = image.parentElement, depth = 0; card && depth < 5 && turn.contains(card); card = card.parentElement, depth++) {
      const controls = [...card.querySelectorAll('button,[role="button"],a[download]')].flatMap(button => [button.getAttribute('aria-label'), button.getAttribute('title'), button.textContent].filter(Boolean).map(G.normalize));
      if (controls.some(value => /^(?:edit|chỉnh sửa)(\s+(?:(?:generated )?image|ảnh)(\s+\d+)?)?$/i.test(value))
        && controls.some(value => /download|tải xuống|tải về|share|chia sẻ/i.test(value))) return true;
      if (card === turn) break;
    }
    return false;
  }
  function roleOf(element) {
    const role = element.getAttribute('data-message-author-role') || element.getAttribute('data-turn') || element.getAttribute('data-conversation-role')
      || element.getAttribute('data-chatgpt-search-unit-key')?.match(/:(user|assistant)$/)?.[1] || (element.hasAttribute('data-user-message-bubble') ? 'user' : null);
    if (['user', 'assistant'].includes(role)) return role;
    const text = G.normalize(element.getAttribute('aria-label') || (/^H[4-6]$/.test(element.tagName) ? element.textContent : ''));
    if (/^(?:you said|bạn (?:đã )?nói)\s*:?$/i.test(text)) return 'user';
    if (/^(?:chatgpt (?:said|(?:đã )?nói))\s*:?$/i.test(text)) return 'assistant';
    return null;
  }
  function turns() {
    const root = document.querySelector('main,[role="main"]') || document.body;
    const selector = '[data-testid^="conversation-turn"],article,[data-message-author-role],[data-turn="user"],[data-turn="assistant"],[data-conversation-role],[data-message-id],[data-chatgpt-search-unit-key],[data-user-message-bubble],[aria-label^="You said"],[aria-label^="ChatGPT said"],[aria-label^="Bạn đã nói"],[aria-label^="ChatGPT đã nói"]';
    const headings = [...root.querySelectorAll('h4,h5,h6')].filter(element => roleOf(element)).map(element => element.parentElement);
    const candidates = [...new Set([...root.querySelectorAll(selector), ...headings])].filter(element => !excluded(element) && visible(element) && element !== root).map(element => {
      const roles = new Set([roleOf(element), ...[...element.querySelectorAll('[data-message-author-role],[data-turn],[data-conversation-role],[data-chatgpt-search-unit-key],[data-user-message-bubble],h4,h5,h6')].map(roleOf)].filter(Boolean));
      return roles.size === 1 ? {element, role: [...roles][0]} : null;
    }).filter(Boolean);
    const result = candidates.filter(candidate => !candidates.some(parent => parent !== candidate && parent.role === candidate.role && parent.element.contains(candidate.element)));
    result.sort((left, right) => left.element.compareDocumentPosition(right.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    const busySelector = '[aria-busy="true"],[role="progressbar"],[data-testid="stop-button"]';
    return result.map(({element, role}) => ({
      key: keyFor(element), role, text: G.normalize(element.innerText || element.textContent),
      busy: (element.matches(busySelector) && visible(element)) || [...element.querySelectorAll(busySelector)].some(visible)
        || [...element.querySelectorAll('span,p')].some(item => visible(item) && /^(?:(?:creating|generating|rendering|processing) (?:an? )?image|đang (?:tạo|xử lý|tải) (?:hình )?ảnh)(?:\s*\d{1,3}%|[.\s…])*$/i.test(G.normalize(item.textContent))),
      images: role === 'assistant' ? [...element.querySelectorAll('img')].filter(visible).map(image => ({element: image, src: image.currentSrc || image.src,
        complete: image.complete, width: image.naturalWidth, height: image.naturalHeight, completedCard: completedCard(image, element)})) : []
    }));
  }
  async function bridge(kind, payload = {}) {
    const reply = await chrome.runtime.sendMessage({kind, payload: {...payload, documentId, path: location.pathname}});
    if (!reply?.ok) throw Error(reply?.message || 'Kết nối tiện ích đã ngắt. Không tự gửi lại prompt.');
    return reply.result;
  }
  function assertPage(command, initialPath, lockedPath) {
    if (location.origin !== 'https://chatgpt.com' || gate()) throw Error('ChatGPT đang yêu cầu đăng nhập hoặc xác minh. Tool đã dừng.');
    if (command.expectedConversationPath && location.pathname !== command.expectedConversationPath) throw Error('Không còn ở đúng cuộc trò chuyện đã chọn.');
    if (lockedPath && location.pathname !== lockedPath) throw Error('Cuộc trò chuyện đã thay đổi. Không lưu ảnh.');
    if (!lockedPath && location.pathname !== initialPath && !G.conversationPath(location.pathname)) throw Error('Trang ChatGPT đã thay đổi. Không lưu ảnh.');
  }
  async function attachReference(target, reference, assertUnchanged) {
    const root = composerRoot(target), initialInputs = new Set(document.querySelectorAll('input[type="file"]'));
    if (!root) throw Error('Không xác định được vùng đính kèm của ô ChatGPT. Chưa gửi prompt.');
    const accepts = input => {
      const types = input.accept.toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
      const extension = reference.name.toLowerCase().match(/\.[^.]+$/)?.[0];
      if (!types.length || types.includes('*/*')) return 1;
      if (types.includes(reference.mimeType) || types.includes('image/*') || types.includes(extension)) return 2;
      return 0;
    };
    const choose = () => {
      const inputs = [...document.querySelectorAll('input[type="file"]')].filter(input => !input.disabled && accepts(input));
      // Never adopt an unrelated, pre-existing upload input from the whole page.
      const scoped = inputs.filter(input => root.contains(input) || (target.form && input.form === target.form));
      const pool = scoped.length ? scoped : inputs.filter(input => !initialInputs.has(input));
      const best = Math.max(0, ...pool.map(accepts)), candidates = pool.filter(input => accepts(input) === best);
      if (candidates.length > 1) throw Error('Có nhiều ô đính kèm phù hợp trong ChatGPT. Chưa tải ảnh hoặc gửi prompt để tránh chọn nhầm.');
      return candidates[0] || null;
    };
    let input = choose();
    if (!input) {
      assertUnchanged();
      const plus = [...root.querySelectorAll('button,[role="button"]')].filter(button => visible(button) && !button.disabled
        && (button.id === 'composer-plus-btn' || button.getAttribute('data-testid') === 'composer-plus-btn'
          || /^(?:add (?:photos (?:&|and) files|files and more)|attach (?:photos|files)|thêm (?:ảnh và (?:tệp|tập tin)|tệp và (?:hơn nữa|công cụ)))(?:\.\.\.|…)?$/i.test(label(button))));
      if (plus.length !== 1) throw Error('Chưa nhận diện nút thêm ảnh trong đúng ô ChatGPT. Chưa gửi prompt.');
      const oldMenus = new Set([...document.querySelectorAll('[role="menu"]')].filter(visible));
      const controlledIds = (plus[0].getAttribute('aria-controls') || '').split(/\s+/).filter(Boolean);
      plus[0].click();
      const deadline = Date.now() + 4000; let menuClicked = false;
      while (Date.now() < deadline) {
        assertUnchanged(); input = choose(); if (input) break;
        if (!menuClicked) {
          const controlled = controlledIds.map(id => document.getElementById(id)).filter(menu => menu && visible(menu));
          const newMenus = [...document.querySelectorAll('[role="menu"]')].filter(menu => visible(menu) && !oldMenus.has(menu));
          const menus = controlled.length ? controlled : newMenus;
          if (menus.length > 1) throw Error('Có nhiều menu đính kèm vừa mở. Chưa gửi prompt.');
          if (menus.length === 1) {
            const items = [...menus[0].querySelectorAll('[role="menuitem"],button,[role="button"]')].filter(item => visible(item) && !item.disabled
              && /^(?:add photos (?:&|and) files|upload (?:from computer|files|photos)|attach files|thêm ảnh và (?:tệp|tập tin)|tải (?:ảnh và tệp|tệp|tập tin|tệp từ máy tính|lên từ máy tính)(?: lên)?)(?:\.\.\.|…)?$/i.test(label(item)));
            // Radix may wrap the same button in a menuitem; retain one actual action.
            const actions = items.filter(item => !items.some(other => other !== item && item.contains(other)));
            if (actions.length > 1) throw Error('Có nhiều mục tải ảnh trong menu. Chưa gửi prompt.');
            if (actions.length === 1) {assertUnchanged(); actions[0].click(); menuClicked = true;}
          }
        }
        await pause(100);
      }
      if (!input) throw Error('Đã mở menu thêm ảnh nhưng chưa tìm được ô tải ảnh phù hợp. Chưa gửi prompt.');
    }
    assertUnchanged();
    const bytes = Uint8Array.from(atob(reference.dataUrl.split(',')[1]), value => value.charCodeAt(0));
    const data = new DataTransfer(); data.items.add(new File([bytes], reference.name, {type: reference.mimeType}));
    input.files = data.files;
    input.dispatchEvent(new Event('input', {bubbles: true}));
    input.dispatchEvent(new Event('change', {bubbles: true}));
  }
  async function fillPrompt(target, text) {
    target.focus();
    if (target.tagName === 'TEXTAREA') {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(target, text);
      target.dispatchEvent(new Event('input', {bubbles: true}));
    } else {
      const range = document.createRange(); range.selectNodeContents(target);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      if (!document.execCommand('insertText', false, text)) throw Error('ChatGPT không nhận nội dung prompt. Chưa gửi.');
      target.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'insertText', data: text}));
    }
    const deadline = Date.now() + 3000; let stable = null;
    while (Date.now() < deadline) {
      if (G.normalize(editorText(target)) === G.normalize(text)) {stable ??= Date.now(); if (Date.now() - stable >= 500) return;}
      else stable = null;
      await pause(100);
    }
    throw Error('Prompt trong ChatGPT chưa khớp. Chưa gửi; giữ bản nháp để bạn kiểm tra.');
  }
  async function sendReady(command, target, expected, initialPath) {
    const deadline = Date.now() + 60000; let stable = null;
    while (Date.now() < deadline) {
      assertPage(command, initialPath, null);
      if (!target.isConnected || target !== editor() || G.normalize(editorText(target)) !== G.normalize(expected)) throw Error('Bản nháp ChatGPT đã thay đổi. Chưa gửi.');
      const state = attachments(target);
      if (state.error) throw Error('ChatGPT báo tải ảnh mẫu thất bại. Chưa gửi.');
      const sends = [...document.querySelectorAll('[data-testid="send-button"]')].filter(visible);
      if (state.count > 0 && !state.busy && sends.length === 1 && !sends[0].disabled && sends[0].getAttribute('aria-disabled') !== 'true') {
        stable ??= Date.now(); if (Date.now() - stable >= 700) return sends[0];
      } else stable = null;
      await pause(200);
    }
    throw Error('Ảnh mẫu chưa tải xong hoặc nút gửi chưa sẵn sàng. Chưa gửi.');
  }
  async function originalSource(image, command) {
    G.imageSource(image.src);
    const response = await fetch(image.src, {credentials: new URL(image.src).hostname === 'chatgpt.com' ? 'same-origin' : 'omit', redirect: 'error', signal: AbortSignal.timeout(30000)});
    if (!response.ok || !response.body || !/^image\/(?:png|jpeg|webp)(;|$)/i.test(response.headers.get('content-type') || '')) throw Error('Không tải được file ảnh gốc.');
    const reader = response.body.getReader(), parts = []; let bytes = 0;
    while (true) {const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > MAX_BYTES) {await reader.cancel(); throw Error('Ảnh quá 25 MB.');} parts.push(part.value);}
    const blob = new Blob(parts, {type: response.headers.get('content-type').split(';')[0]});
    return new Promise((resolve, reject) => {const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(Error('Không đọc được file ảnh.')); reader.readAsDataURL(blob);});
  }
  async function execute(command) {
    let submitted = false, phase = 'prepare', requestKey = null, lockedPath = null;
    const initialPath = location.pathname;
    try {
      G.validateCommand(command); const {text: expectedPrompt, marker} = G.promptFor(command);
      if (command.expectedConversationPath && initialPath !== command.expectedConversationPath) throw Error('Mở lại đúng chat đã tạo ảnh trước; tool không tự chuyển chat.');
      assertPage(command, initialPath, null);
      const target = editor();
      if (!target || generating()) throw Error('Ô nhập ChatGPT chưa sẵn sàng hoặc đang có lượt tạo khác.');
      if (G.normalize(editorText(target)) || attachments(target).count) throw Error('ChatGPT đang có bản nháp hoặc ảnh đính kèm. Tool giữ nguyên; hãy dọn bản nháp trước.');
      const baseline = turns(), baselineKeys = new Set(baseline.map(turn => turn.key)), baselineSources = new Set(baseline.flatMap(turn => turn.images.map(image => image.src)));
      if (baseline.some(turn => turn.text.includes(marker))) throw Error('Mã lượt đã tồn tại trong chat. Tool không gửi lại.');
      if (G.conversationPath(initialPath)) lockedPath = initialPath;
      await attachReference(target, command.reference, () => {
        assertPage(command, initialPath, lockedPath);
        if (!target.isConnected || target !== editor() || generating() || G.normalize(editorText(target)) || attachments(target).count || attachments(target).busy)
          throw Error('Ô ChatGPT hoặc bản nháp thay đổi trong lúc mở mục đính kèm. Chưa tải ảnh hoặc gửi prompt.');
      });
      await fillPrompt(target, expectedPrompt);
      const send = await sendReady(command, target, expectedPrompt, initialPath);
      await bridge('event', {commandId: command.id, type: 'prepared', phase: 'prepared', message: 'Đã nhập prompt và tải ảnh mẫu. Chưa gửi.'});
      assertPage(command, initialPath, lockedPath);
      if (G.normalize(editorText(target)) !== G.normalize(expectedPrompt) || attachments(target).busy || send.disabled || !send.isConnected) throw Error('Composer thay đổi trước khi gửi. Chưa gửi.');
      // Persist the uncertain boundary at both ends before touching the send button.
      await bridge('event', {commandId: command.id, type: 'submitted', phase: 'submitted', message: 'Bắt đầu gửi prompt ' + (command.index + 1) + '/5.'});
      submitted = true; phase = 'submitted'; send.click();
      const deadline = Date.now() + 8 * 60000; let stableKey = null, stableSince = null, lastProgress = 0;
      const snapshot = () => {
        assertPage(command, initialPath, lockedPath);
        const state = G.requestState({turns: turns(), baselineKeys, baselineSources, expectedPrompt, marker, requestKey, generating: generating()});
        if (state.requestKey) requestKey = state.requestKey;
        if (requestKey && !lockedPath && G.conversationPath(location.pathname)) lockedPath = location.pathname;
        return state;
      };
      while (Date.now() < deadline) {
        const state = snapshot();
        if (Date.now() - lastProgress >= 3500) {
          await bridge('event', {commandId: command.id, type: 'progress', phase: state.phase, message: 'Ảnh ' + (command.index + 1) + '/5 · ' + (state.phase === 'candidate' ? 'đang xác minh kết quả' : 'đang tạo')});
          lastProgress = Date.now();
        }
        if (state.phase === 'candidate') {
          const signature = state.requestKey + '|' + state.replyKey + '|' + state.image.src + '|' + state.image.width + 'x' + state.image.height;
          if (signature === stableKey) {
            if (Date.now() - stableSince >= 1500) {
              const image = state.image, element = image.element;
              const validate = () => {
                const current = snapshot();
                if (current.phase !== 'candidate' || current.replyKey !== state.replyKey || current.image.element !== element || current.image.src !== image.src
                  || !element.isConnected || !element.complete || (element.currentSrc || element.src) !== image.src) throw Error('Ảnh kết quả đã thay đổi. Không lưu file.');
              };
              validate(); phase = 'download';
              let dataUrl;
              try {dataUrl = await originalSource(image, command);}
              catch (error) {
                if (image.src.startsWith('blob:')) throw error;
                validate(); dataUrl = (await bridge('fetch-image', {commandId: command.id, source: image.src})).dataUrl;
              }
              validate();
              await bridge('image', {commandId: command.id, dataUrl});
              await bridge('event', {commandId: command.id, type: 'complete', phase: 'complete', message: 'Đã lưu ảnh ' + (command.index + 1) + '/5.'});
              return;
            }
          } else {stableKey = signature; stableSince = Date.now();}
        } else {stableKey = null; stableSince = null;}
        await pause(500);
      }
      throw Error('Chưa xác minh được ảnh hoàn chỉnh sau 8 phút. Kiểm tra đúng chat; không tự gửi lại.');
    } catch (error) {
      await bridge('event', {commandId: command.id, type: 'error', phase: submitted ? 'submitted' : phase, message: error.message}).catch(() => {});
    }
  }
  async function poll() {
    if (running || !connected) return;
    try {
      const target = editor(), state = await bridge('poll', {ready: Boolean(target) && !gate(), gate: gate(), draft: Boolean(G.normalize(editorText(target))) || Boolean(attachments(target).count), generating: generating()});
      if (state?.command) {running = true; try {await execute(state.command);} finally {running = false;}}
    } catch { /* Tool may be closed; never touch the page while disconnected. */ }
  }
  chrome.runtime.onMessage.addListener(message => {if (message?.kind === 'binding-ready') {connected = true; poll();}});
  window.addEventListener('pagehide', () => {connected = false;});
  setInterval(poll, 1200); poll();
})();
