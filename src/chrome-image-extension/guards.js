(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ShopeeImageGuards = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  const normalize = value => String(value || '').normalize('NFC').replace(/\s+/gu, ' ').trim();
  const identifier = value => typeof value === 'string' && /^[a-z\d_-]{1,120}$/i.test(value);
  const conversationPath = value => typeof value === 'string' && /^\/c\/[a-z\d_-]+\/?$/i.test(value);
  function imageSource(value) {
    let url;
    try { url = new URL(value); } catch { throw Error('Link ảnh kết quả không hợp lệ.'); }
    const allowed = item => item.protocol === 'https:' && !item.username && !item.password && (!item.port || item.port === '443')
      && ['chatgpt.com', 'files.oaiusercontent.com'].includes(item.hostname);
    if (url.protocol === 'blob:') {
      let nested; try { nested = new URL(url.pathname); } catch { throw Error('Blob ảnh không thuộc ChatGPT.'); }
      if (!allowed(nested) || nested.hostname !== 'chatgpt.com') throw Error('Blob ảnh không thuộc ChatGPT.');
    } else if (!allowed(url)) throw Error('Nguồn ảnh không thuộc ChatGPT.');
    return url.href;
  }
  function validateCommand(command) {
    if (!command || command.kind !== 'generate' || !identifier(command.id) || !identifier(command.jobId)
      || !Number.isInteger(command.index) || command.index < 0 || command.index > 4
      || typeof command.prompt !== 'string' || !normalize(command.prompt) || command.prompt.length > 50000
      || (command.expectedConversationPath !== null && !conversationPath(command.expectedConversationPath))) throw Error('Lệnh tạo ảnh không hợp lệ.');
    const reference = command.reference;
    if (!reference || typeof reference.name !== 'string' || !reference.name || reference.name.length > 180
      || /[\\/\u0000-\u001f]/.test(reference.name) || !['image/png', 'image/jpeg', 'image/webp'].includes(reference.mimeType)
      || typeof reference.dataUrl !== 'string' || reference.dataUrl.length > 14 * 1024 * 1024
      || !reference.dataUrl.startsWith('data:' + reference.mimeType + ';base64,')
      || !/^data:image\/(?:png|jpeg|webp);base64,[a-z\d+/]+={0,2}$/i.test(reference.dataUrl)) throw Error('Ảnh mẫu không hợp lệ.');
    return command;
  }
  function promptFor(command) {
    validateCommand(command);
    const marker = 'SRM ' + command.jobId + ' ảnh ' + (command.index + 1) + ' lệnh ' + command.id;
    return {marker, text: command.prompt + '\nMã lượt: ' + marker + '\nChỉ tạo đúng 1 ảnh, không trả lời bằng văn bản.'};
  }
  function requestState({turns, baselineKeys, baselineSources, expectedPrompt, marker, requestKey, generating}) {
    const expected = normalize(expectedPrompt);
    const matches = turns.filter(turn => turn.role === 'user' && normalize(turn.text).includes(expected)
      && normalize(turn.text).includes(normalize(marker)));
    if (matches.length > 1) throw Error('Có nhiều lượt chứa cùng mã prompt. Không chọn ảnh.');
    if (!matches.length) return {phase: 'awaiting-prompt'};
    const request = matches[0];
    if (baselineKeys.has(request.key)) throw Error('Mã prompt đã có trước lượt gửi. Không chọn ảnh cũ.');
    if (requestKey && request.key !== requestKey) throw Error('Danh tính lượt prompt đã thay đổi. Không chọn ảnh.');
    const following = turns.slice(turns.indexOf(request) + 1);
    if (following.some(turn => turn.role !== 'assistant')) throw Error('Có tin nhắn khác sau prompt. Không chọn ảnh.');
    if (following.length > 1) throw Error('Có nhiều lượt trả lời sau prompt. Không chọn ảnh.');
    const reply = following[0];
    if (!reply || baselineKeys.has(reply.key) || reply.busy || generating) return {phase: 'generating', requestKey: request.key};
    const images = (reply.images || []).filter(image => image.complete && image.width >= 500 && image.height >= 500
      && image.completedCard && !baselineSources.has(image.src));
    if (images.length > 1) throw Error('Lượt trả lời có nhiều ảnh; cần kiểm tra thủ công.');
    if (!images.length) return {phase: 'generating', requestKey: request.key};
    imageSource(images[0].src);
    return {phase: 'candidate', requestKey: request.key, replyKey: reply.key, image: images[0]};
  }
  return {normalize, identifier, conversationPath, imageSource, validateCommand, promptFor, requestState};
});
