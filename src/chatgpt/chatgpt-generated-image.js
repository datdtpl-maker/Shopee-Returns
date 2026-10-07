function inferConversationTurnRole({ ownRole, userMarkerCount, assistantMarkerCount, readyImageCount }) {
  if (ownRole === "user" || ownRole === "assistant") return ownRole;
  if (userMarkerCount > 0) return "user";
  if (assistantMarkerCount > 0) return "assistant";
  if (readyImageCount > 0) return "assistant";
  return null;
}

function selectNewAssistantImage(turns, baselineTurnKeys) {
  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = turns[turnIndex];
    if (turn.authorRole !== "assistant" || baselineTurnKeys.has(turn.turnKey)) continue;
    if (turn.images?.length) {
      return turn.images.find(({ alt = "" }) => (
        /(generated image|ảnh (?:đã|được) tạo|hình (?:ảnh )?(?:đã|được) tạo)/i.test(alt)
      )) || turn.images[0];
    }
  }
  return null;
}

module.exports = { inferConversationTurnRole, selectNewAssistantImage };

async function getChatGptConversationTurns(page, { promptText = '' } = {}) {
  // Select in one DOM snapshot. Element handles cannot silently retarget another
  // image when React inserts/reorders nodes between detection and download.
  const snapshot = await page.evaluateHandle(({ promptText, documentId }) => {
    const root = document.querySelector('main, [role="main"]') || document.body;
    const normalize = text => (text || '').normalize('NFC').replace(/\s+/gu, ' ').trim();
    const textOf = element => normalize(element.innerText || element.textContent);
    const excluded = element => Boolean(element.closest('form, [contenteditable="true"], nav, aside, header, footer, [role="dialog"]'));
    const visible = element => {
      const style = getComputedStyle(element);
      if (style.visibility === 'hidden' || style.display === 'none') return false;
      // display:contents message blocks have no own rectangle, but their
      // children (including the completed image) are still rendered normally.
      return Boolean(element.getClientRects().length)
        || (style.display === 'contents' && [...element.children].some(visible));
    };
    const mediaSelector = 'img,canvas,[style*="background"],[role="img"]';
    const selector = '[data-testid^="conversation-turn"],article,[data-message-author-role],[data-turn="user"],[data-turn="assistant"],[data-message-id],[data-turn-id],[data-chatgpt-search-unit-key],[data-user-message-bubble],[aria-label^="You said"],[aria-label^="ChatGPT said"],[aria-label^="Bạn đã nói"],[aria-label^="ChatGPT đã nói"]';
    const state = window.__npcImageTurnIdentity ||= { ids: new WeakMap(), next: 0, documentId };
    const nodeKeyFor = element => {
      if (!state.ids.has(element)) state.ids.set(element, `${state.documentId}:${++state.next}`);
      return state.ids.get(element);
    };
    const messageIdFor = element => {
      const id = element.getAttribute('data-message-id') || element.querySelector('[data-message-id]')?.getAttribute('data-message-id');
      if (id) return id;
      const searchIds = (element.getAttribute('data-chatgpt-search-message-ids')
        || element.querySelector('[data-chatgpt-search-message-ids]')?.getAttribute('data-chatgpt-search-message-ids') || '').trim().split(/[\s,]+/).filter(Boolean);
      return searchIds.length === 1 ? searchIds[0] : null;
    };
    const keyFor = element => {
      const messageId = messageIdFor(element);
      const turnId = element.getAttribute('data-turn-id');
      if (messageId || turnId || element.id) return `id:${messageId || turnId || element.id}`;
      const testId = element.getAttribute('data-testid');
      if (/^conversation-turn-\d+$/.test(testId || '')) return testId;
      return nodeKeyFor(element);
    };
    const labelRole = label => /^(?:you said|bạn (?:đã )?nói)\s*:?$/i.test(normalize(label)) ? 'user'
      : /^(?:chatgpt (?:said|(?:đã )?nói))\s*:?$/i.test(normalize(label)) ? 'assistant' : null;
    const ownRole = element => {
      const role = element.getAttribute('data-message-author-role') || element.getAttribute('data-turn')
        || element.getAttribute('data-conversation-role') || element.getAttribute('data-chatgpt-search-unit-key')?.match(/:(user|assistant)$/)?.[1]
        || (element.hasAttribute('data-user-message-bubble') ? 'user' : null);
      return ['user', 'assistant'].includes(role) ? role : labelRole(element.getAttribute('aria-label'));
    };
    const hasAssistantControls = element => Boolean(element.querySelector('[data-testid="good-response-turn-action-button"],[data-testid="bad-response-turn-action-button"]'))
      || [...element.querySelectorAll('button,[role="button"]')].some(button =>
        /^(good response|bad response|(?:like|dislike) this image|câu trả lời (?:hay|không hay)|thích|không thích)$/i.test(normalize(button.getAttribute('aria-label') || button.getAttribute('title'))));
    // Current ChatGPT nests BOTH messages in one search-turn wrapper. Role
    // headings belong to individual message blocks, never to that shared wrapper.
    const headingBlocks = [...root.querySelectorAll('h4,h5,h6')]
      .filter(heading => ownRole(heading) || labelRole(heading.textContent)).map(heading => heading.parentElement);
    const candidates = [...new Set([...root.querySelectorAll(selector), ...headingBlocks])]
      .filter(element => element !== root && !excluded(element) && visible(element)).map(element => {
      const roles = new Set([ownRole(element), ...[...element.querySelectorAll('[data-message-author-role],[data-turn],[data-conversation-role],[data-chatgpt-search-unit-key],[data-user-message-bubble],h4,h5,h6')]
        .map(child => ownRole(child) || labelRole(child.textContent))].filter(Boolean));
      if (roles.size > 1) return null; // A whole-thread wrapper is not a turn.
      return { element, role: [...roles][0] || null };
    }).filter(Boolean);
    let turns = candidates.filter(candidate => !candidates.some(parent => parent !== candidate
      && parent.element.contains(candidate.element) && (parent.role === candidate.role || (parent.role && !candidate.role))));

    // A/B layouts can have no message attributes at all. Use the exact submitted
    // prompt as the user anchor, and require generated-image UI in its next reply.
    const expected = normalize(promptText);
    if (expected) {
      const fallbackReplies = [];
      const matches = [...root.querySelectorAll('p,div,span')].filter(element => !excluded(element) && visible(element)
        && textOf(element).includes(expected)
        && ![...element.children].some(child => textOf(child).includes(expected)));
      for (const anchor of matches) {
        const existing = turns.find(turn => turn.element.contains(anchor));
        if (existing) {
          if (!existing.role && !hasAssistantControls(existing.element)) existing.role = 'user';
          continue;
        }
        let user = anchor;
        for (let boundary = anchor; boundary.parentElement && boundary.parentElement !== root; boundary = boundary.parentElement) {
          if (boundary.nextElementSibling && !excluded(boundary.nextElementSibling)
            && hasAssistantControls(boundary.nextElementSibling)) { user = boundary; break; }
        }
        // Never adopt the whole thread as the prompt bubble.
        if (user.contains(document.querySelector('#prompt-textarea')) || user === root) user = anchor;
        turns.push({ element: user, role: 'user', key: keyFor(anchor), anchor, fallback: true });
        const reply = user.nextElementSibling;
        if (!reply || excluded(reply) || !visible(reply) || !reply.querySelector(mediaSelector)) continue;
        if (turns.some(turn => turn.element === reply)) continue;
        turns.push({ element: reply, role: null, fallback: true });
        fallbackReplies.push(reply);
      }
      // Resolve all matching prompts before classifying later, unknown bubbles.
      for (const reply of fallbackReplies) {
        for (let later = reply.nextElementSibling; later; later = later.nextElementSibling) {
          if (!excluded(later) && visible(later) && textOf(later) && !turns.some(turn => turn.element === later)) {
            turns.push({ element: later, role: 'unknown', fallback: true });
          }
        }
      }
    }
    turns = turns.sort((a, b) => a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    const generationActive = [...document.querySelectorAll('button,[role="button"]')].some(button => visible(button)
      && (button.getAttribute('data-testid') === 'stop-button'
        || /^(?:stop|dừng)(?:$|[\s.,])/i.test(normalize(button.getAttribute('aria-label') || button.getAttribute('title')))));
    const busySelector = '[aria-busy="true"],[role="progressbar"],[data-testid="stop-button"]';
    const busy = element => (element.matches(busySelector) && visible(element)) || [...element.querySelectorAll(busySelector)].some(visible)
      || [...element.querySelectorAll('div,span,p')].some(status => visible(status)
        && /^(?:(?:creating|generating|rendering|processing) (?:an? )?image|đang (?:tạo|xử lý|tải) (?:hình )?ảnh)(?:\s*\d{1,3}%|[.\s…])*$/i.test(normalize(status.textContent)));
    return turns.map(turn => ({ element: turn.element, role: turn.role, id: turn.key || keyFor(turn.element),
      nodeKey: nodeKeyFor(turn.anchor || turn.element), messageId: messageIdFor(turn.element),
      snapshotUrl: location.href,
      text: textOf(turn.element), fallback: Boolean(turn.fallback), assistantControls: hasAssistantControls(turn.element),
      busy: generationActive || busy(turn.element) }));
  }, { promptText, documentId: require('node:crypto').randomUUID() });
  const result = [];
  const handles = [];
  try {
    const items = [...(await snapshot.getProperties()).values()];
    handles.push(...items);
    for (const item of items) {
      const metadata = await item.evaluate(({ element, ...metadata }) => metadata);
      const turn = (await item.getProperty('element')).asElement();
      handles.push(turn);
      const images = [];
      const nodes = await turn.$$('img, canvas, [style*="background"], [role="img"]');
      handles.push(...nodes);
      if (metadata.role !== 'user') {
        for (const image of nodes) {
          const info = await image.evaluate(async element => {
            // ChatGPT's particle/loading animation is also a full-size canvas.
            // It is never a downloadable result, even when it contains pixels.
            if (element.tagName === 'CANVAS') return { ready: false };
            const alt = element.alt || element.getAttribute('aria-label') || '';
            let src = element.currentSrc || element.src || '';
            let width = element.naturalWidth || 0;
            let height = element.naturalHeight || 0;
            let complete = element.complete;
            if (element.tagName !== 'IMG') {
              src = getComputedStyle(element).backgroundImage.match(/^url\(["']?(.*?)["']?\)$/)?.[1] || '';
              if (src) {
                const decoded = new Image(); decoded.src = src;
                await Promise.race([decoded.decode().catch(() => {}), new Promise(resolve => setTimeout(resolve, 1500))]);
                width = decoded.naturalWidth; height = decoded.naturalHeight; complete = decoded.complete;
              }
            }
            let completedCard = false;
            for (let card = element.parentElement, depth = 0; card && depth < 4; card = card.parentElement, depth++) {
              if (card.matches('main,body,[data-message-author-role="user"],[data-turn="user"],[data-user-message-bubble]')) break;
              const labels = [...card.querySelectorAll('button,[role="button"],a[download]')].flatMap(button =>
                [button.getAttribute('aria-label'), button.getAttribute('title'), button.textContent].filter(Boolean).map(label => label.trim()));
              if (labels.some(label => /^(edit|chỉnh sửa)(\s+((generated )?image|ảnh)(\s+\d+)?)?$/i.test(label))
                && labels.some(label => /download|tải xuống|tải về|share|chia sẻ/i.test(label))) { completedCard = true; break; }
              if (card.matches('article,[data-message-author-role],[data-turn]') || card.querySelector('h4,h5,h6')) break;
            }
            return { src, alt, completedCard, ready: Boolean(complete) && width >= 256 && height >= 256,
              generated: completedCard || /generated image|image generated|image created|ảnh (?:đã |được )?tạo|hình ảnh (?:đã |được )?tạo/i.test(alt) };
          });
          if (!info.ready || !info.src || !info.completedCard || metadata.busy) continue;
          if (metadata.fallback && !metadata.assistantControls) continue;
          // Unknown articles need explicit generated-image evidence, not just a large image.
          if (metadata.role !== 'assistant' && !info.generated) continue;
          if (!await image.isVisible()) continue;
          images.push({ image, src: info.src, alt: info.alt, completedCard: info.completedCard, turnKey: metadata.id });
        }
      }
      result.push({ turnKey: metadata.id, authorRole: metadata.role || (images.length ? 'assistant' : null),
        nodeKey: metadata.nodeKey, messageId: metadata.messageId, snapshotUrl: metadata.snapshotUrl,
        text: metadata.text, fallback: metadata.fallback, busy: metadata.busy, images, mediaCount: nodes.length });
    }
    return result;
  } catch (error) {
    result.length = 0;
    throw error;
  } finally {
    const retained = new Set(result.flatMap(turn => turn.images.map(item => item.image)));
    await Promise.all(handles.filter(handle => !retained.has(handle)).map(handle => handle.dispose().catch(() => {})));
    await snapshot.dispose();
  }
}

async function saveChatGptImage(context, image, src, imagePath, { beforeCommit } = {}) {
  const fs = require('node:fs/promises');
  // Export decoded result pixels, never a page canvas or loading screenshot.
  let bytes;
  try {
    const data = await image.evaluate(async (element, expectedSource) => {
      if (!element.isConnected || element.tagName === 'CANVAS') throw new Error('Ảnh chưa hoàn chỉnh; không lưu canvas đang tạo.');
      let source = element;
      if (element.tagName !== 'IMG') {
        const src = getComputedStyle(element).backgroundImage.match(/^url\(["']?(.*?)["']?\)$/)?.[1];
        source = new Image(); source.src = src; await source.decode();
      }
      if ((source.currentSrc || source.src) !== expectedSource) throw new Error('Nguồn ảnh đã thay đổi trước khi lưu.');
      if (!source.complete || source.naturalWidth < 256 || source.naturalHeight < 256) throw new Error('Ảnh chưa hoàn chỉnh.');
      const canvas = document.createElement('canvas');
      canvas.width = source.naturalWidth || source.width;
      canvas.height = source.naturalHeight || source.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(source, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let hasPixels = false;
      for (let index = 3; index < pixels.length; index += 4) {
        if (pixels[index] > 0) { hasPixels = true; break; }
      }
      if (!hasPixels) throw new Error('Ảnh kết quả đang trống, chưa lưu file.');
      return canvas.toDataURL('image/png');
    }, src);
    bytes = Buffer.from(data.split(',')[1], 'base64');
  } catch (error) {
    throw new Error(`Chưa đọc được ảnh kết quả hoàn chỉnh: ${error.message}`);
  }
  if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.readUInt32BE(16) < 256 || bytes.readUInt32BE(20) < 256) {
    throw new Error('Ảnh kết quả chưa có dữ liệu PNG hợp lệ.');
  }
  const temporaryPath = `${imagePath}.part`;
  try {
    await fs.writeFile(temporaryPath, bytes);
    if (beforeCommit) await beforeCommit(temporaryPath);
    await fs.rename(temporaryPath, imagePath);
  } finally {
    await fs.unlink(temporaryPath).catch(() => {});
  }
  return 'original';
}

module.exports.getChatGptConversationTurns = getChatGptConversationTurns;
module.exports.saveChatGptImage = saveChatGptImage;

async function disposeConversationTurns(turns, keepImage) {
  await Promise.all(turns.flatMap(turn => turn.images || [])
    .filter(item => item.image !== keepImage).map(item => item.image.dispose().catch(() => {})));
}

module.exports.disposeConversationTurns = disposeConversationTurns;
