const { isChatGptPage } = require('./chatgpt-composer');
const { getChatGptConversationTurns, disposeConversationTurns } = require('./chatgpt-generated-image');

const normalize = text => (text || '').normalize('NFC').replace(/\s+/gu, ' ').trim();

function conversationId(url) {
  if (!isChatGptPage(url)) return null;
  return new URL(url).pathname.match(/\/c\/([^/]+)/)?.[1] || null;
}

function requestError(message) {
  const error = new Error(message);
  error.code = 'CHATGPT_REQUEST_MISMATCH';
  return error;
}

async function createImageRequestTracker(page, promptText) {
  const expected = normalize(promptText);
  if (!expected) throw new Error('Prompt tạo ảnh đang trống.');
  const initialUrl = page.url();
  let lockedConversation = conversationId(initialUrl);
  let requestTurnKey = null;
  let requestIdentity = null;
  let remappedConversation = false;
  const matchesPrompt = turn => turn.authorRole === 'user' && normalize(turn.text).includes(expected);
  const baseline = await getChatGptConversationTurns(page, { promptText });
  const baselineKeys = new Set(baseline.map(turn => turn.turnKey));
  const baselineSources = new Set(baseline.flatMap(turn => turn.images.map(image => image.src)).filter(src => !src.startsWith('canvas:')));
  const previousMatchingPrompts = baseline.filter(matchesPrompt).length;
  const documentId = await page.evaluate(() => window.__npcImageTurnIdentity.documentId);
  await disposeConversationTurns(baseline);

  function sameMessage(identity, turn) {
    if (!identity || !turn) return false;
    // DOM/test-id ordinals are reused across conversations; never use them here.
    if (identity.messageId && turn.messageId) return identity.messageId === turn.messageId;
    return identity.nodeKey === turn.nodeKey;
  }

  async function assertConversation({ beforeSend = false, deferUrlCheck = false, turns } = {}) {
    if (page.isClosed()) throw requestError('Tab ChatGPT đã khóa bị đóng. Tool không chuyển sang tab khác.');
    const url = page.url();
    const current = conversationId(url);
    if (!isChatGptPage(url) || (beforeSend && url !== initialUrl)) {
      throw requestError('Cuộc hội thoại đã thay đổi. Đã dừng để không lưu ảnh của cuộc trò chuyện khác; hãy quay lại đúng cuộc hội thoại vừa gửi prompt.');
    }
    if (await page.evaluate(() => window.__npcImageTurnIdentity?.documentId) !== documentId) {
      throw requestError('Trang ChatGPT đã tải lại trong lúc tạo ảnh. Đã dừng để không nhận nhầm kết quả cũ.');
    }
    if (lockedConversation && current !== lockedConversation && !deferUrlCheck) {
      const observed = turns || await getChatGptConversationTurns(page, { promptText });
      try {
        const matching = observed.filter(matchesPrompt);
        const sameRequest = matching.find(turn => sameMessage(requestIdentity, turn));
        if (observed.some(turn => turn.snapshotUrl !== url)) {
          const error = new Error('URL đang cập nhật trong lúc đọc trang; đọc lại lượt prompt đã khóa.');
          error.code = 'CHATGPT_IMAGE_CHANGED';
          throw error;
        }
        if (!current || !sameRequest || matching.length !== previousMatchingPrompts + 1) {
          throw requestError('Không còn xác minh được lượt prompt đã khóa sau khi URL thay đổi. Đã dừng để tránh lưu ảnh của cuộc trò chuyện khác.');
        }
        locateRequest(observed);
        lockedConversation = current;
        remappedConversation = true;
      } finally { if (!turns) await disposeConversationTurns(observed); }
    }
    return current;
  }

  function locateRequest(turns) {
    const matching = turns.filter(matchesPrompt);
    if (matching.length > previousMatchingPrompts + 1) {
      throw requestError('Prompt được gửi nhiều lần trong khi tool đang chờ. Đã dừng để không chọn nhầm lượt trả lời.');
    }
    if (!requestTurnKey) {
      // A re-rendered old prompt is not evidence that this send succeeded.
      if (matching.length <= previousMatchingPrompts) return -1;
      const request = matching.at(-1);
      if (baselineKeys.has(request.turnKey)) return -1;
      requestTurnKey = request.turnKey;
      requestIdentity = { nodeKey: request.nodeKey, messageId: request.messageId };
    }
    let index = turns.findIndex(turn => turn.turnKey === requestTurnKey && matchesPrompt(turn));
    const continuousRequest = matching.find(turn => sameMessage(requestIdentity, turn));
    if (remappedConversation && !continuousRequest) {
      throw requestError('Lượt prompt đã khóa không còn trong cuộc hội thoại sau khi đổi URL. Đã dừng để tránh lấy ảnh của lượt khác.');
    }
    if (index < 0 && continuousRequest) {
      requestTurnKey = continuousRequest.turnKey;
      index = turns.indexOf(continuousRequest);
    }
    if (index < 0 && matching.length === previousMatchingPrompts + 1 && !baselineKeys.has(matching.at(-1).turnKey)) {
      // React may replace an unmarked bubble after streaming; its unique prompt
      // occurrence is unchanged. Never accept an extra, identical user request.
      requestTurnKey = matching.at(-1).turnKey;
      index = turns.indexOf(matching.at(-1));
    }
    if (index < 0) return -1;
    if (turns.slice(index + 1).some(turn => ['user', 'unknown'].includes(turn.authorRole))) {
      throw requestError('Có thêm lượt nhắn sau prompt đang tạo ảnh. Đã dừng để không lưu kết quả của prompt khác.');
    }
    requestIdentity = { nodeKey: turns[index].nodeKey, messageId: turns[index].messageId };
    return index;
  }

  async function poll() {
    await assertConversation({ deferUrlCheck: true });
    const turns = await getChatGptConversationTurns(page, { promptText });
    let candidate;
    try {
      const current = await assertConversation({ turns });
      const index = locateRequest(turns);
      const diagnostics = { turns: turns.length, assistantTurns: turns.filter(turn => turn.authorRole === 'assistant').length,
        media: turns.reduce((count, turn) => count + turn.mediaCount, 0), readyImages: turns.reduce((count, turn) => count + turn.images.length, 0) };
      if (index < 0) return { phase: 'awaiting-prompt', diagnostics };
      if (!lockedConversation && current) lockedConversation = current;
      const replies = turns.slice(index + 1).filter(turn => turn.authorRole === 'assistant' && !baselineKeys.has(turn.turnKey));
      for (const reply of replies) {
        if (reply.busy) continue;
        const images = reply.images.filter(image => !baselineSources.has(image.src) && image.completedCard);
        if (images.length) {
          candidate = images.find(image => /generated|được tạo|đã tạo/i.test(image.alt)) || images[0];
          return { phase: 'image-ready', candidate, conversationId: lockedConversation, requestTurnKey, diagnostics };
        }
      }
      return { phase: 'awaiting-image', conversationId: lockedConversation, requestTurnKey, diagnostics };
    } finally { await disposeConversationTurns(turns, candidate?.image); }
  }

  async function validateCandidate(candidate) {
    await assertConversation();
    const turns = await getChatGptConversationTurns(page, { promptText });
    try {
      const index = locateRequest(turns);
      const reply = turns.slice(index + 1).find(turn => turn.turnKey === candidate.turnKey && turn.authorRole === 'assistant');
      if (index < 0 || !reply || reply.busy || !reply.images.some(image => image.src === candidate.src)
        || !await candidate.image.evaluate(element => element.isConnected)) {
        const error = new Error('Ảnh đang cập nhật trước khi lưu; tiếp tục đọc lại đúng lượt trả lời, chưa ghi đè file.');
        error.code = 'CHATGPT_IMAGE_CHANGED';
        throw error;
      }
      await assertConversation();
    } finally { await disposeConversationTurns(turns); }
  }

  async function diagnostics() {
    await assertConversation();
    // Structural counts only: no prompt text, image URLs, cookies or tokens.
    return page.evaluate(() => ({
      mainRoots: document.querySelectorAll('main,[role="main"]').length,
      turnMarkers: document.querySelectorAll('[data-testid^="conversation-turn"],article,[data-message-author-role],[data-turn],[data-conversation-role],[data-chatgpt-search-unit-key]').length,
      readyImageElements: [...document.images].filter(image => image.complete && image.naturalWidth >= 256 && image.naturalHeight >= 256 && image.getClientRects().length).length,
      canvases: document.querySelectorAll('canvas').length,
      frames: document.querySelectorAll('iframe').length
    }));
  }

  return { poll, assertConversation, validateCandidate, diagnostics };
}

module.exports = { createImageRequestTracker, conversationId };
