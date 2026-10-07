// Resolve the upload through the active composer or its own file chooser.
// ChatGPT can mount camera, workspace and message-edit file inputs together.
async function attachReference(page, editor, file) {
  const handle = await editor.evaluateHandle(element => element.closest('form') || element.closest('[data-testid="composer"]') || element.closest('#composer'));
  try {
    const root = handle.asElement();
    if (!root) throw Error('Không tìm thấy khung soạn ChatGPT. Chưa gửi prompt.');
    let inputs = await root.$$('input[type="file"]');
    if (!inputs.length) inputs = await page.$$('input[type="file"]');
    const eligible = [];
    for (const input of inputs) {
      const accept = (await input.getAttribute('accept') || '').toLowerCase();
      const aria = (await input.getAttribute('aria-label') || '').toLowerCase();
      if (!await input.isDisabled() && (!accept || /image\/|\.png|\.jpe?g|\*\/\*/.test(accept) || /photo|ảnh/.test(aria))) {
        eligible.push({input, accept, aria});
      }
    }
    if (eligible.length === 1) {await eligible[0].input.setInputFiles(file); return;}
    // The chooser event identifies exactly which input the menu activated,
    // even when several hidden inputs have identical accept attributes.
    const plusSelectors = [
      '#composer-plus-btn',
      '[data-testid="composer-plus-btn"]',
      'button[aria-label="Add files and more"]',
      'button[aria-label*="Add files" i]',
      'button[aria-label*="Add photos" i]',
      'button[aria-label="Add photos and files"]',
      'button[aria-label*="Attach" i]',
      'button[aria-label="Thêm ảnh và tệp"]',
      'button[aria-label*="Thêm" i]',
      'button[aria-label*="Tải" i]',
      'button[data-testid*="plus" i]',
      'button[data-testid*="attach" i]'
    ];
    let plus = null;
    for (const sel of plusSelectors) {
      const candidate = await root.$(sel);
      if (candidate && await candidate.isVisible()) { plus = candidate; break; }
    }
    if (!plus) {
      for (const sel of plusSelectors) {
        const candidate = await page.$(sel);
        if (candidate && await candidate.isVisible()) { plus = candidate; break; }
      }
    }
    if (!plus) {
      // Fallback: If no plus button found, directly set files on best photo input
      const best = eligible.find(x => x.aria.includes('photo') || x.aria.includes('ảnh') || x.accept === 'image/*') || eligible[0];
      if (best) { await best.input.setInputFiles(file); return; }
      throw Error('Không nhận diện nút Thêm ảnh trong khung chat. Chưa gửi prompt.');
    }
    let chooser;
    const listener = value => {chooser = value;};
    page.on('filechooser', listener);
    try {
      await plus.click();
      if (!chooser) {
        const upload = page.getByRole('menuitem', {name: /^(?:Add photos\s*(?:&|and)\s*files|Upload (?:from computer|files?|photos?)|Attach (?:photos?|files?)|Photos & videos|Thêm ảnh và (?:tệp|tập tin)|Tải (?:tệp|ảnh) lên|Tải lên từ máy tính)/i});
        const hasMenu = await upload.first().waitFor({state:'visible',timeout:3000}).then(() => true).catch(() => false);
        if (hasMenu) {
          const waiting = page.waitForEvent('filechooser', {timeout:8000});
          const clicked = upload.first().click();
          [chooser] = await Promise.all([waiting, clicked]);
        }
      }
      if (!chooser) {
        // Fallback: If file chooser wasn't opened, attach via best eligible file input directly
        const best = eligible.find(x => x.aria.includes('photo') || x.aria.includes('ảnh') || x.accept === 'image/*') || eligible[0];
        if (best) { await best.input.setInputFiles(file); return; }
        throw Error('ChatGPT chưa mở bộ chọn ảnh.');
      }
      await chooser.setFiles(file);
    } finally {page.off('filechooser', listener);}
  } finally {await handle.dispose();}
}
module.exports = {attachReference};
