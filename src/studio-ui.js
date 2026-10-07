const studioUI = (() => {
  const node = id => document.getElementById(id);
  const html = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]));
  const date = value => value ? new Date(value).toLocaleString('vi-VN') : '';
  const labels = {draft: 'Bản nháp', generating: 'Đang viết bài', generated: 'Đã viết bài', approved: 'Đã xem bài', publishing: 'Đang gửi Notion', published: 'Đã có bài · chưa có ảnh', 'publish-uncertain': 'Chờ đối chiếu Notion', 'generating-images': 'Đang tạo ảnh', 'images-generated': 'Đã tạo ảnh · chờ lưu local', 'copying-images': 'Đang lưu ảnh local', 'images-ready': 'Đủ ảnh local · chưa gắn Notion', 'images-uncertain': 'Ảnh chưa xác minh · kiểm tra ChatGPT', attaching: 'Đang gắn ảnh Notion', 'attach-uncertain': 'Chờ đối chiếu ảnh Notion', attached: 'Đủ bài và 5 ảnh', replacing: 'Đang thay thế lên Shopee', replaced: 'Đã thay thế lên Shopee'};
  const fieldIds = {prompt: 'studio-prompt', price: 'studio-price', name: 'studio-name', description: 'studio-description'};
  let snapshot = null, working = false, sourceScanWorking = false, sourceScanStatus = '', selectedJob = '', selectedStep = 1, configLoaded = false, configDirty = false, loadedEditor = '';
  let selectedPrompt = '', promptEditorId = null, promptWorking = false, promptReturnFocus = null;
  const selectedProducts = new Set(), drafts = new Map();
  const manualImages = new Map(), manualPrompts = new Map(), manualDigests = new Map(), manualFeedback = new Map(), promptSlots = new Map();
  const userSelectedSlots = new Set();
  const chromePrompts = new Map(), chromeDigests = new Map();
  const imageReferences = new Map();
  let chromePair = null, chromePairTimer = null;
  let sourceMarkup = '';
  const imageLabels = ['Ảnh bìa', 'Thành phần nổi bật', 'Công dụng chính', 'Cách dùng', 'Điểm tin cậy'];
  const safePreview = preview => typeof preview === 'string' && preview.length < 500000 && /^data:image\/(?:jpeg|png);base64,[A-Za-z\d+/=]+$/.test(preview);
  const jobs = () => snapshot?.studio?.jobs || [];
  const job = () => jobs().find(item => item.id === selectedJob);
  const templates = () => snapshot?.studioPrompts?.templates || [];
  const localImagesReady = item => !!item?.localFolder && item?.imageFiles?.length === 5 && ['images-ready', 'attaching', 'attach-uncertain', 'attached'].includes(item.status);
  const selectedTemplate = () => templates().find(item => item.id === selectedPrompt);
  const busy = () => working || !!snapshot?.studio?.busy || !!snapshot?.studioChrome?.busy;
  const shopeeBusy = () => sourceScanWorking || busy() || snapshot?.products?.busy || snapshot?.scanning || snapshot?.clearingNotion || snapshot?.replacements?.busy;
  const locked = item => !!item && (['publishing', 'publish-uncertain'].includes(item.status) || busy());
  const message = value => typeof value === 'string' ? value : value?.message || '';
  const editable = item => !!item && !locked(item);
  const currentValues = item => ({prompt: item?.prompt || '', price: item?.price ?? '', name: item?.name || item?.sourceName || '', description: item?.description || '', ...(drafts.get(item?.id) || {})});
  const changed = item => {
    if (!item) return {};
    const values = currentValues(item), patch = {};
    for (const field of Object.keys(fieldIds)) {
      const previous = item[field] ?? '';
      if (String(values[field]) !== String(previous)) patch[field] = field === 'price' ? Number(values[field]) : values[field];
    }
    return patch;
  };
  const validPrice = value => Number.isSafeInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 1000000000;
  const hasNewPrompt = item => 'prompt' in changed(item);
  const validPublishStatus = ['draft', 'generated', 'approved', 'publishing', 'published', 'images-ready', 'attaching', 'attached', 'attach-uncertain', 'images-uncertain'];
  const canPublish = item => editable(item) && !hasNewPrompt(item) && validPublishStatus.includes(item.status) && !!item.article && !!currentValues(item).name.trim() && !!currentValues(item).description.trim() && validPrice(currentValues(item).price);
  const canRecoverPublish = item => !!item && !busy() && item.status === 'publish-uncertain' && item.contentApproved === true;
  function sources() {
    const seen = new Set();
    return (snapshot?.products?.rows || []).filter(item => {
      const key = item.shop + ':' + item.productId;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
  }
  function filteredSources() {
    const shop = node('studio-shop').value, query = node('studio-search').value.trim().toLocaleLowerCase('vi');
    return sources().filter(item => (!shop || item.shop === shop) && [item.name, item.productId, item.shop].join(' ').toLocaleLowerCase('vi').includes(query));
  }
  function sourceShops() {
    const enabled = new Set((snapshot?.profiles || []).filter(item => item.enabled).map(item => item.id));
    const names = sources().map(item => item.shop);
    for (const [profileId, binding] of Object.entries(snapshot?.products?.shops || {})) if (enabled.has(profileId)) names.push(binding.name);
    if (job()?.shop) names.push(job().shop);
    return [...new Set(names.filter(name => typeof name === 'string' && name.trim()))].sort();
  }
  function sourceBusyMessage() {
    if (sourceScanWorking) return snapshot?.products?.progress || 'Đang tải dữ liệu sản phẩm từ Notion…';
    if (snapshot?.scanning) return 'Đang quét hoàn / huỷ. Dữ liệu sản phẩm sẽ cập nhật sau.';
    if (snapshot?.clearingNotion) return 'Đang xoá dữ liệu Notion. Đợi thao tác hoàn tất.';
    if (shopeeBusy()) return snapshot?.products?.progress || snapshot?.studio?.progress || 'Trình duyệt đang xử lý. Đợi thao tác hoàn tất.';
    return '';
  }
  function nextJob() {
    const item = job(); if (!item) return null;
    const selectedSources = new Set(sources().filter(entry => selectedProducts.has(entry.id)).map(entry => entry.shop + ':' + entry.productId));
    const selected = jobs().filter(entry => selectedSources.has(entry.shop + ':' + entry.productId));
    const queue = selected.some(entry => entry.id === item.id) ? selected : jobs();
    return queue.slice(queue.findIndex(entry => entry.id === item.id) + 1).find(entry => entry.shop !== item.shop || entry.productId !== item.productId) || null;
  }
  function jobLabel(item, entries = jobs()) {
    const repName = (item.name && item.name.trim() && item.name !== item.sourceName) ? item.name.trim() : '';
    const displayName = repName ? `[${repName}]` : (item.sourceName || item.name);
    const sameSource = entries.filter(entry => entry.shop === item.shop && entry.productId === item.productId).length > 1;
    return item.shop + ' · ' + displayName + ' · ID ' + item.productId + (sameSource ? ' · Bài ' + item.id.slice(0, 8) : '');
  }
  function options(element, values, empty) {
    const content = '<option value="">' + html(empty) + '</option>' + values.map(([value, label]) => '<option value="' + html(value) + '">' + html(label) + '</option>').join('');
    if (element.innerHTML !== content) element.innerHTML = content;
  }
  function setStep(value, focus = false) {
    selectedStep = value;
    for (const [index, id] of [[1, 'studio-content'], [2, 'studio-images-panel'], [3, 'studio-publish-panel']]) {
      node(id).hidden = index !== value;
      const button = node('studio-step-' + index);
      button.setAttribute('aria-selected', String(index === value)); button.tabIndex = index === value ? 0 : -1;
    }
    if (focus) node('studio-step-' + value).focus();
  }
  function error(text) {node('studio-error').textContent = text; if (text) node('studio-error').focus();}
  async function refresh() {
    const updated = await window.srm.call('snapshot');
    if (typeof render === 'function') render(updated);
    renderView(updated);
  }
  async function task(work, {refreshAfter = true} = {}) {
    if (busy()) return;
    working = true; error(''); renderStudio(snapshot);
    try { await work(); }
    catch (failure) { error(failure?.message || 'Không hoàn tất thao tác. Kiểm tra nhật ký Studio.'); }
    finally {
      working = false;
      renderStudio(snapshot);
      if (refreshAfter) {
        try { await refresh(); } catch {}
      }
    }
  }
  async function saveDraft(item) {
    const patch = changed(item);
    if (!Object.keys(patch).length) return item;
    if (!validPrice(patch.price ?? item.price)) throw Error('Giá bán phải là số nguyên từ 1 đến 1.000.000.000 VND.');
    const result = await window.srm.call('studio-update', item.id, patch);
    drafts.delete(item.id); loadedEditor = '';
    return result;
  }
  function renderSources() {
    const source = sources(), shop = node('studio-shop').value, shops = sourceShops();
    options(node('studio-shop'), shops.map(value => {
      const count = source.filter(item => item.shop === value).length;
      return [value, value + (count ? ' · ' + count + ' sản phẩm' : ' · chưa có sản phẩm')];
    }), 'Tất cả shop (' + shops.length + ')');
    node('studio-shop').value = shops.includes(shop) ? shop : '';
    for (const id of selectedProducts) if (!source.some(item => item.id === id)) selectedProducts.delete(id);
    const rows = filteredSources();
    const markup = rows.map(item => '<label class="studio-product"><input type="checkbox" data-studio-product="' + html(item.id) + '"' + (!item.profileId ? ' data-unlinked="true"' : '') + '><span><strong>' + html(item.name) + '</strong><small>' + html(item.shop) + ' · ID ' + html(item.productId) + (!item.profileId ? ' · Chưa liên kết profile Shopee' : '') + '</small></span></label>').join('') || '<p class="studio-empty">' + (shop && !source.some(item => item.shop === shop) ? 'Shop này chưa có sản phẩm trong Notion.' : 'Chưa có sản phẩm phù hợp. Thử đổi bộ lọc.') + '</p>';
    if (sourceMarkup !== markup) {node('studio-products').innerHTML = markup; sourceMarkup = markup;}
    for (const input of node('studio-products').querySelectorAll('[data-studio-product]')) {
      input.checked = selectedProducts.has(input.dataset.studioProduct); input.disabled = !!input.dataset.unlinked || busy();
    }
    node('studio-selection-count').textContent = selectedProducts.size ? selectedProducts.size + ' sản phẩm đã chọn · ' + rows.length + ' đang lọc' : 'Chưa chọn sản phẩm · ' + rows.length + ' đang lọc';
    node('studio-create').disabled = busy() || !selectedProducts.size;
    node('studio-select-visible').disabled = busy() || !rows.some(item => item.profileId);
    node('studio-clear-selection').disabled = busy() || !selectedProducts.size;
    const scanMessage = sourceBusyMessage();
    if (node('studio-source-scan')) {
      node('studio-source-scan').hidden = false;
      node('studio-source-scan').disabled = !!shopeeBusy();
      node('studio-source-scan').textContent = sourceScanWorking ? 'Đang đồng bộ…' : 'Đồng bộ từ Notion ↻';
      node('studio-source-scan').title = 'Lấy dữ liệu sản phẩm mới nhất từ bảng Kho sản phẩm Notion (3e070655a9aa816c98f4dc2c863fa5bb).';
    }
    if (node('studio-shop-delete')) {
      const selectedShop = node('studio-shop').value;
      const emptyShops = shops.filter(s => source.filter(item => item.shop === s).length === 0);
      if (selectedShop) {
        const count = source.filter(item => item.shop === selectedShop).length;
        node('studio-shop-delete').disabled = busy();
        node('studio-shop-delete').textContent = count ? 'Xoá shop' : 'Xoá shop (0 SP)';
        node('studio-shop-delete').title = 'Xoá shop "' + selectedShop + '" khỏi danh sách';
        node('studio-shop-delete').dataset.targetShop = selectedShop;
      } else if (emptyShops.length > 0) {
        node('studio-shop-delete').disabled = busy();
        node('studio-shop-delete').textContent = 'Dọn ' + emptyShops.length + ' shop trống';
        node('studio-shop-delete').title = 'Xoá ' + emptyShops.length + ' shop không có sản phẩm khỏi danh sách';
        node('studio-shop-delete').dataset.targetShop = '__empty__';
      } else {
        node('studio-shop-delete').disabled = true;
        node('studio-shop-delete').textContent = 'Xoá shop';
        node('studio-shop-delete').title = 'Chọn shop cần xoá';
        delete node('studio-shop-delete').dataset.targetShop;
      }
    }
    const totalCount = source.length;
    const enabledCount = (snapshot?.profiles || []).filter(item => item.enabled).length;
    node('studio-source-status').textContent = scanMessage || sourceScanStatus || (totalCount ? shops.length + ' shop trong danh sách (' + enabledCount + ' profile) · ' + totalCount + ' sản phẩm từ Notion (Kho sản phẩm).' : 'Chưa có sản phẩm. Bấm Đồng bộ từ Notion để tải dữ liệu.');
    node('studio-source-status').classList.toggle('studio-source-waiting', !!scanMessage);
    renderReplacementCards();
  }
  let currentReplacementFilter = 'ready';
  function renderReplacementCards() {
    const container = node('studio-replacement-cards');
    if (!container) return;
    const allJobs = jobs();

    const readyCount = allJobs.filter(j => j.isReplacementReady || (j.name && j.name.trim() && j.name !== j.sourceName) || j.notionStatus === 'Đã có').length;
    const waitingCount = allJobs.filter(j => !j.isReplacementReady && (!j.name || !j.name.trim() || j.name === j.sourceName || j.notionStatus === 'Chưa có')).length;
    const doneCount = allJobs.filter(j => ['published', 'attached', 'replaced', 'images-ready'].includes(j.status)).length;

    if (node('studio-count-all')) node('studio-count-all').textContent = String(allJobs.length);
    if (node('studio-count-ready')) node('studio-count-ready').textContent = String(readyCount);
    if (node('studio-count-waiting')) node('studio-count-waiting').textContent = String(waitingCount);
    if (node('studio-count-done')) node('studio-count-done').textContent = String(doneCount);

    const searchInput = node('studio-replacement-search');
    const query = (searchInput?.value || '').trim().toLowerCase();

    const filtered = allJobs.filter(j => {
      const isReady = j.isReplacementReady || (j.name && j.name.trim() && j.name !== j.sourceName) || j.notionStatus === 'Đã có';
      const isDone = ['published', 'attached', 'replaced', 'images-ready'].includes(j.status);
      if (currentReplacementFilter === 'ready' && !isReady) return false;
      if (currentReplacementFilter === 'waiting' && isReady) return false;
      if (currentReplacementFilter === 'published' && !isDone) return false;
      if (query) {
        const text = [j.name, j.sourceName, j.shop, j.productId, j.modelId].join(' ').toLowerCase();
        if (!text.includes(query)) return false;
      }
      return true;
    });

    if (!filtered.length) {
      if (!allJobs.length) {
        container.innerHTML = `<div class="studio-rc-empty-simple"><p class="studio-subtle-hint">Bấm nút <strong>"Quét Notion"</strong> ở phía trên để nạp danh sách sản phẩm cần thay thế.</p></div>`;
      } else {
        container.innerHTML = `<p class="studio-empty">Không tìm thấy sản phẩm phù hợp với bộ lọc hiện tại.</p>`;
      }
      return;
    }

    container.innerHTML = filtered.map(item => {
      const isSelected = item.id === selectedJob;
      const isReady = item.isReplacementReady || (item.name && item.name.trim() && item.name !== item.sourceName) || item.notionStatus === 'Đã có';
      const isDone = ['published', 'attached', 'replaced', 'images-ready'].includes(item.status);
      const badgeClass = isDone ? 'badge-done' : isReady ? 'badge-ready' : 'badge-waiting';
      const badgeText = isDone ? 'Đã tạo bài' : isReady ? 'Đã có tên' : 'Chưa có tên';
      const priceText = item.price ? Number(item.price).toLocaleString('vi-VN') + ' ₫' : '---';
      const titleHtml = item.name && item.name.trim() ? html(item.name) : '<em class="studio-rc-noname">(Chưa có tên thay thế · Chờ nhập Notion)</em>';

      return `
        <article class="studio-replacement-card ${isSelected ? 'active' : ''} ${isReady ? 'card-ready' : 'card-waiting'}" data-replacement-job="${html(item.id)}">
          <div class="studio-rc-header">
            <h4 class="studio-rc-title">${titleHtml}</h4>
            <span class="studio-rc-badge ${badgeClass}">${badgeText}</span>
          </div>
          <div class="studio-rc-meta">
            <div class="studio-rc-source"><span class="studio-rc-label">Sản phẩm gốc:</span> <strong>${html(item.sourceName || 'Chưa rõ')}</strong></div>
            <div class="studio-rc-submeta">
              <span class="studio-rc-shop">${html(item.shop)}</span>
              <span class="studio-rc-id">ID: ${html(item.productId)}</span>
              <span class="studio-rc-price">${priceText}</span>
            </div>
          </div>
          <div class="studio-rc-actions">
            <button type="button" class="studio-rc-pick-btn ${isSelected ? 'picked' : ''}" data-pick-replacement="${html(item.id)}">
              ${isSelected ? '✓ Đang chọn làm bài' : 'Chọn viết bài →'}
            </button>
            ${item.notionUrl ? `<button type="button" class="studio-rc-notion-btn" data-notion-url="${html(item.notionUrl)}" title="Mở trang Notion">Notion ↗</button>` : ''}
          </div>
        </article>
      `;
    }).join('');
  }
  function renderEditor() {
    const all = jobs();
    const activeEntries = all.filter(item =>
      item.isReplacementReady ||
      (item.name && item.name.trim() && item.name !== item.sourceName) ||
      item.notionStatus === 'Đã có' ||
      item.article ||
      ['draft', 'generated', 'published', 'images-ready', 'attached', 'replaced'].includes(item.status) && item.status !== 'waiting_name'
    );
    if (selectedJob && !activeEntries.some(item => item.id === selectedJob)) {
      const cur = all.find(item => item.id === selectedJob);
      if (cur) activeEntries.push(cur);
    }
    const entries = activeEntries.length > 0 ? activeEntries : all;
    if (selectedJob && !entries.some(item => item.id === selectedJob)) {selectedJob = ''; loadedEditor = '';}
    options(node('studio-job'), entries.map(item => [item.id, jobLabel(item) + ' · ' + (labels[item.status] || item.status)]), 'Chọn bài đang sửa…');
    node('studio-job').value = selectedJob;
    const item = job(), values = currentValues(item);
    if (loadedEditor !== selectedJob || !drafts.has(selectedJob)) {
      for (const [field, id] of Object.entries(fieldIds)) if (node(id).value !== String(values[field])) node(id).value = values[field];
      loadedEditor = selectedJob;
    }
    for (const id of Object.values(fieldIds)) node(id).disabled = !editable(item);
    node('studio-job').disabled = busy();
    node('studio-delete-draft').disabled = busy() || !item || item?.canDeleteDraft === false;
    node('studio-delete-draft').title = 'Xoá bản nháp local đang chọn';
    node('studio-source').innerHTML = item ? (
      (item.name && item.name !== item.sourceName)
        ? '<div class="studio-source-preview-box">' +
            '<div class="studio-source-preview-label">Sản phẩm thay thế mới (Từ Notion)</div>' +
            '<div class="studio-source-preview-title">' + html(item.name) + '</div>' +
            '<div class="studio-source-preview-origin"><strong>Sản phẩm gốc Shopee:</strong> ' + html(item.sourceName) + '</div>' +
            '<div class="studio-source-preview-meta">' + html(item.shop) + ' · ID ' + html(item.productId) + (item.modelId ? ' · Model ' + html(item.modelId) : '') + '</div>' +
          '</div>'
        : '<strong>' + html(item.sourceName || item.name) + '</strong><p>' + html(item.shop) + ' · ID ' + html(item.productId) + ' · Model ' + html(item.modelId) + '</p>'
    ) : '<p>Chọn bài đang có trên Shopee để bắt đầu chỉnh nội dung.</p>';
    const dirty = !!Object.keys(changed(item)).length;
    node('studio-content-status').innerHTML = item ? '<span class="badge ' + (item.imagesReady ? 'green' : 'warning') + '">' + html(labels[item.status] || item.status) + '</span>' + (hasNewPrompt(item) ? '<span class="subtle">Prompt đã đổi · bấm Viết bài để tạo nội dung mới</span>' : dirty ? '<span class="subtle">Nội dung chỉnh sửa sẽ lưu khi đẩy Notion</span>' : !item.notionUrl && item.article ? '<span class="subtle">Xem và chỉnh nội dung rồi đẩy lên Notion</span>' : '') + (item.error ? '<p class="studio-form-error">' + html(item.error) + '</p>' : '') : '';
    node('studio-save').disabled = !editable(item) || !dirty;
    node('studio-generate').disabled = !editable(item) || !values.prompt.trim() || !values.name.trim() || !validPrice(values.price);
    node('studio-generate').textContent = item?.article ? 'Viết lại bằng Gemini' : 'Viết bài bằng Gemini';
    node('studio-publish').disabled = !(canPublish(item) || canRecoverPublish(item));
    node('studio-publish').textContent = item?.notionUrl && !canPublish(item) ? 'Đã đẩy lên Notion' : canRecoverPublish(item) ? 'Đối chiếu lượt gửi Notion' : 'Đẩy bài lên Notion';
    node('studio-article').disabled = !item?.notionUrl;
    node('studio-article').hidden = !item?.notionUrl;
    node('studio-next').disabled = busy() || !nextJob();
    node('studio-reference').disabled = shopeeBusy();
    node('studio-load').disabled = !!shopeeBusy();
  }
  function promptStatus(text, failure = false) {
    node('studio-prompt-status').textContent = text;
    node('studio-prompt-status').classList.toggle('studio-form-error', failure);
  }
  function renderPrompts() {
    if (selectedPrompt && !selectedTemplate()) selectedPrompt = '';
    options(node('studio-prompt-template'), templates().map(item => [item.id, item.name]), 'Chọn prompt mẫu…');
    node('studio-prompt-template').value = selectedPrompt;
    node('studio-prompt-template').disabled = promptWorking;
    node('studio-prompt-apply').disabled = promptWorking || !selectedTemplate() || !editable(job());
    node('studio-prompt-add').disabled = promptWorking;
    node('studio-prompt-edit').disabled = promptWorking || !selectedTemplate();
    node('studio-prompt-delete').disabled = promptWorking || !selectedTemplate();
    for (const id of ['studio-prompt-template-name', 'studio-prompt-template-content', 'studio-prompt-template-save', 'studio-prompt-template-cancel']) node(id).disabled = promptWorking;
    node('studio-prompt-library-note').textContent = editable(job()) ? 'Áp dụng chỉ điền prompt vào bản nháp; bấm Viết bài để chạy Gemini.' : 'Chọn một bài để áp dụng prompt. Có thể quản lý mẫu ngay.';
  }
  function openPromptEditor(item) {
    promptEditorId = item?.id || '';
    promptReturnFocus = document.activeElement;
    node('studio-prompt-editor-title').textContent = item ? 'Sửa prompt mẫu' : 'Thêm prompt mẫu';
    node('studio-prompt-template-name').value = item?.name || '';
    node('studio-prompt-template-content').value = item?.content || '';
    node('studio-prompt-template-error').textContent = '';
    node('studio-prompt-editor').hidden = false;
    node('studio-prompt-template-name').focus();
  }
  function closePromptEditor() {
    node('studio-prompt-editor').hidden = true; promptEditorId = null;
    if (promptReturnFocus?.isConnected && !promptReturnFocus.disabled) promptReturnFocus.focus();
  }
  async function promptTask(work) {
    if (promptWorking) return;
    promptWorking = true; promptStatus(''); renderPrompts();
    try {await work();}
    catch (failure) {
      const text = failure?.message || 'Không lưu được prompt mẫu.';
      promptStatus(text, true);
      if (!node('studio-prompt-editor').hidden) node('studio-prompt-template-error').textContent = text;
    }
    finally {
      promptWorking = false; renderPrompts();
      if (node('studio-prompt-editor').hidden && promptReturnFocus?.isConnected && !promptReturnFocus.disabled) promptReturnFocus.focus();
    }
  }
  function updatePromptLibrary(result) {
    const library = result?.studioPrompts || result;
    if (Array.isArray(library?.templates)) snapshot = {...snapshot, studioPrompts: library};
    else if (library?.id) {
      const entries = templates().filter(item => item.id !== library.id);
      entries.push(library); snapshot = {...snapshot, studioPrompts: {...snapshot?.studioPrompts, templates: entries}};
    }
    renderPrompts();
  }
  function summary(element, item, fields) {
    element.innerHTML = item ? fields.map(([label, value]) => '<div><dt>' + html(label) + '</dt><dd>' + html(value) + '</dd></div>').join('') : '<p class="studio-empty">Chưa chọn bài phù hợp.</p>';
  }
  const canImportImages = item => !!item?.notionUrl && item.contentApproved === true && !item.imagesReady && !localImagesReady(item) && !busy();
  function renderChromePair() {
    const permanent = chromePair?.expiresAt === null && chromePair.oneTime === true;
    const expires = chromePair ? Date.parse(chromePair.expiresAt) || Number(chromePair.expiresAt) : 0;
    if ((!permanent && (!expires || expires <= Date.now())) || snapshot?.studioChrome?.connected || snapshot?.studioChrome?.remembered) {chromePair = null; clearTimeout(chromePairTimer); chromePairTimer = null;}
    node('studio-chrome-pair-panel').hidden = !chromePair;
    node('studio-chrome-pair-code').textContent = chromePair?.code || '';
    node('studio-chrome-pair-expiry').textContent = chromePair ? permanent ? 'Không hết hạn · dùng một lần' : 'Hết hạn lúc ' + new Date(expires).toLocaleTimeString('vi-VN') : '';
  }
  const loadingPrompts = new Set();
  function ensureJobPrompts(item) {
    if (!item?.id || !item.notionUrl || !item.contentApproved || chromePrompts.has(item.id) || loadingPrompts.has(item.id) || busy()) return;
    loadingPrompts.add(item.id);
    window.srm.call('studio-image-prompts', item.id).then(result => {
      loadingPrompts.delete(item.id);
      if (result?.jobId && result.jobId !== item.id) return;
      const entries = (result?.prompts || []).map((entry, index) => ({title: typeof entry === 'string' ? imageLabels[index] : String(entry?.title || imageLabels[index]), text: typeof entry === 'string' ? entry : entry?.text}));
      if (entries.length === 5 && /^[a-f\d]{64}$/i.test(result.contentDigest || '')) {
        chromePrompts.set(item.id, entries); chromeDigests.set(item.id, result.contentDigest);
        if (!promptSlots.has(item.id)) promptSlots.set(item.id, 0);
        renderImages();
      }
    }).catch(() => { loadingPrompts.delete(item.id); });
  }
  function renderChromeImages(item) {
    const chrome = snapshot?.studioChatgpt || {}, reference = imageReferences.get(item?.id), preview = reference?.previewDataUrl;
    const allowed = canImportImages(item);
    if (item?.id && item.notionUrl && item.contentApproved && !chromePrompts.has(item.id)) ensureJobPrompts(item);
    const entries = chromePrompts.get(item?.id) || manualPrompts.get(item?.id) || [];
    const existingIndices = new Set((item?.imageFiles || []).map(img => img.index));
    const firstMissing = [0, 1, 2, 3, 4].find(idx => !existingIndices.has(idx));
    const current = promptSlots.get(item?.id);
    if (!promptSlots.has(item?.id) || (!userSelectedSlots.has(item?.id + ':' + current) && existingIndices.has(current))) {
      promptSlots.set(item?.id, firstMissing !== undefined ? firstMissing : 0);
    }
    const slot = promptSlots.get(item?.id) ?? 0;
    if (node('studio-chrome-prompt-slot')) {
      node('studio-chrome-prompt-slot').value = String(slot);
      node('studio-chrome-prompt-slot').disabled = busy() || entries.length !== 5;
    }
    if (node('studio-chrome-prompt-text')) {
      if (document.activeElement !== node('studio-chrome-prompt-text')) {
        node('studio-chrome-prompt-text').value = entries[slot]?.text || '';
      }
      node('studio-chrome-prompt-text').disabled = busy() || entries.length !== 5;
    }
    if (node('studio-chrome-prompt-save')) node('studio-chrome-prompt-save').disabled = busy() || entries.length !== 5;
    if (node('studio-chrome-prompt-reset')) node('studio-chrome-prompt-reset').disabled = busy() || entries.length !== 5;
    if (node('studio-chrome-prompt-clear')) node('studio-chrome-prompt-clear').disabled = busy() || entries.length !== 5;
    if (node('studio-image-reference-pick')) node('studio-image-reference-pick').disabled = !allowed;
    if (node('studio-image-reference-name')) node('studio-image-reference-name').textContent = reference?.name || 'Chưa chọn ảnh mẫu';
    const content = safePreview(preview) ? '<img src="' + preview + '" alt="Ảnh mẫu sản phẩm cho bài đang chọn">' : '<div class="studio-image-placeholder">Ảnh mẫu</div>';
    if (node('studio-image-reference-preview').innerHTML !== content) node('studio-image-reference-preview').innerHTML = content;
    const digest = chromeDigests.get(item?.id) || manualDigests.get(item?.id);
    const canRunSingle = !!item?.notionUrl && item.contentApproved === true && !item.imagesReady && !busy() && chrome.connected && chrome.ready !== false && !!reference?.selectionId && !!digest && entries.length === 5;
    const canRunAll = canRunSingle && !localImagesReady(item);
    if (node('studio-chrome-run-single')) {
      node('studio-chrome-run-single').textContent = 'Tạo ảnh prompt ' + (slot + 1) + ' (' + (slot + 1) + '.png)';
      node('studio-chrome-run-single').disabled = !canRunSingle;
    }
    if (node('studio-chrome-run')) {
      node('studio-chrome-run').disabled = !canRunAll;
      const active = item?.imageSource === 'chrome-cdp' && snapshot?.studio?.busy;
      const hasSome = existingIndices.size > 0 && existingIndices.size < 5;
      const label = hasSome ? 'Tạo tiếp các ảnh còn lại (' + (firstMissing !== undefined ? (firstMissing + 1) + ' - 5' : 'ảnh còn thiếu') + ')' : 'Tạo lần lượt 5 ảnh';
      node('studio-chrome-run').textContent = active && chrome.busy ? 'Đang tạo ảnh…' : label;
    }
    if (node('studio-go-step3')) {
      node('studio-go-step3').hidden = !localImagesReady(item) && !item?.imagesReady;
    }
    const active = item?.imageSource === 'chrome-cdp' && snapshot?.studio?.busy;
    node('studio-chrome-progress').textContent = active && snapshot?.studio?.progress ? snapshot.studio.progress : !item ? 'Chọn bài đã đẩy Notion để tạo ảnh.' : item.imagesReady ? 'Đã gắn đủ 5 ảnh trên Notion. Bấm Sang bước 3 để cập nhật Shopee.' : localImagesReady(item) ? 'Đủ 5 ảnh local. Gắn ảnh Notion hoặc bấm Sang bước 3 để tiếp tục.' : !chrome.connected ? 'Mở Chrome riêng / Khởi động Chrome Debug (Port 9222) hoặc mở sẵn Chrome rồi Kiểm tra kết nối.' : chrome.ready === false ? chrome.message || 'Mở tab ChatGPT trống, đã đăng nhập và dọn bản nháp trước khi chạy.' : !reference ? 'Chọn ảnh mẫu của sản phẩm.' : !digest ? 'Đang chuẩn bị 5 prompt từ bài viết Notion…' : 'Sẵn sàng tạo ảnh: gửi từ prompt 1; lưu xong mới gửi prompt tiếp theo. Chọn prompt rồi bấm Tạo ảnh (' + (slot + 1) + '.png) hoặc Tạo lần lượt 5 ảnh.';
  }
  function renderManualImages(item) {
    const entries = manualPrompts.get(item?.id) || [], slot = promptSlots.get(item?.id) || 0;
    const allowed = canImportImages(item), selected = manualImages.get(item?.id) || [];
    node('studio-manual-prompts').disabled = !allowed;
    node('studio-normal-chatgpt').disabled = busy();
    node('studio-image-prompt-slot').value = String(slot);
    node('studio-image-prompt-slot').disabled = busy() || entries.length !== 5;
    node('studio-image-prompt-text').value = entries[slot]?.text || '';
    node('studio-copy-image-prompt').disabled = !allowed || !entries[slot]?.text;
    const count = selected.filter(Boolean).length;
    const distinct = new Set(selected.filter(Boolean).map(entry => entry.selectionId));
    node('studio-import-images').disabled = !allowed || !manualDigests.get(item?.id) || count !== 5 || distinct.size !== 5;
    node('studio-import-count').textContent = count ? count + '/5 ảnh đã chọn · chưa nhập' : item?.imageFiles?.length === 5 ? 'Đã lưu đủ 5 ảnh local' : 'Chưa chọn ảnh';
    const feedback = manualFeedback.get(item?.id);
    node('studio-manual-status').textContent = feedback?.message || '';
    node('studio-manual-status').classList.toggle('studio-form-error', !!feedback?.failed);
  }
  function renderImages() {
    const published = jobs().filter(item => item.notionUrl), ready = published.filter(item => item.imagesReady === true || (item.imageFiles && item.imageFiles.length === 5));
    options(node('studio-image-job'), published.map(item => [item.id, jobLabel(item, published)]), 'Chọn bài đã đẩy Notion…');
    options(node('studio-ready-job'), ready.map(item => [item.id, jobLabel(item, ready)]), 'Chọn bài đủ nội dung và ảnh…');
    node('studio-image-job').value = published.some(item => item.id === selectedJob) ? selectedJob : '';
    node('studio-ready-job').value = ready.some(item => item.id === selectedJob) ? selectedJob : (ready[0]?.id || '');
    node('studio-image-job').disabled = busy(); node('studio-ready-job').disabled = busy();
    const item = published.find(entry => entry.id === selectedJob), images = item?.imageFiles || [];
    summary(node('studio-image-summary'), item, [['Shop / ID nguồn', item ? item.shop + ' · ' + item.productId : ''], ['Bài đang sửa', item?.name || item?.sourceName || ''], ['Tiến độ ảnh', images.length + '/5 ảnh local · ' + (item?.imagesReady ? 'Đã gắn Notion' : 'Chưa gắn Notion')]]);
    node('studio-images').disabled = busy() || !item || !item.contentApproved || item.imagesReady || item.status === 'images-uncertain';
    node('studio-images').textContent = images.length === 5 && !item?.localFolder ? 'Lưu lại 5 ảnh đã tạo vào Drive local' : 'Tạo 5 ảnh bằng ChatGPT';
    node('studio-image-folder').disabled = !item?.localFolder;
    const selected = ['chrome-extension','chrome-cdp'].includes(item?.imageSource) ? [] : manualImages.get(item?.id) || [];
    const gallery = Array.from({length: item ? 5 : 0}, (_, index) => {
      const saved = images.find(image => Number.isInteger(image.index) && image.index === index) || (!images.some(image => Number.isInteger(image.index)) ? images[index] : null);
      const image = selected[index] || saved, preview = image?.previewDataUrl || '';
      return '<figure data-gallery-slot="' + index + '" class="studio-gallery-slot" tabindex="0" role="button" aria-label="Bấm để chọn hoặc đổi ảnh ' + (index + 1) + ' (' + (index + 1) + '.png)" title="Bấm để chọn hoặc đổi ảnh ' + (index + 1) + ' (' + (index + 1) + '.png)"><span class="studio-image-title">' + (index + 1) + ' · ' + imageLabels[index] + '</span>' + (safePreview(preview) ? '<img src="' + preview + '" alt="Ảnh ' + (index + 1) + ' · ' + imageLabels[index] + ' của bài đang chọn">' : '<div class="studio-image-placeholder">' + (index + 1) + '</div>') + '<figcaption>' + html(image?.name || image?.filename || ('Chưa có ảnh ' + (index + 1))) + (image ? '<small>' + html(image.width || '') + ' × ' + html(image.height || '') + ' · ' + Number(image.bytes || 0).toLocaleString('vi-VN') + ' byte' + (selected[index] ? ' · chưa nhập' : '') + '</small>' : '') + '</figcaption><button type="button" class="studio-slot-pick-btn" data-gallery-pick="' + index + '">' + (image ? 'Đổi ảnh ' + (index + 1) + '.png' : 'Chọn ảnh ' + (index + 1) + '.png') + '</button></figure>';
    }).join('');
    if (node('studio-gallery').innerHTML !== gallery) node('studio-gallery').innerHTML = gallery;
    const selectors = Array.from({length: item ? 5 : 0}, (_, index) => '<button type="button" data-studio-image-slot="' + index + '" aria-label="Chọn file ảnh ' + (index + 1) + ' · ' + imageLabels[index] + '"' + (!canImportImages(item) ? ' disabled' : '') + '>' + (selected[index] ? 'Đổi' : 'Chọn') + ' ảnh ' + (index + 1) + ' · ' + imageLabels[index] + '</button>').join('');
    if (node('studio-manual-selectors').innerHTML !== selectors) node('studio-manual-selectors').innerHTML = selectors;
    renderManualImages(item);
    renderChromeImages(item);
    node('studio-image-status').textContent = item ? item.error || (item.imagesReady ? 'Đã gắn đủ 5 ảnh vào bài Notion. Có thể sang bước 3.' : item.status === 'images-uncertain' ? (images.length ? 'Tool đã dừng và giữ ảnh đã lưu. Kiểm tra nhật ký và đúng cuộc trò chuyện ChatGPT; không tự gửi lại hoặc thay bộ ảnh.' : 'Lượt tự động chưa xác minh. Có thể chọn thủ công 5 ảnh đã tải về; không tự gửi lại ChatGPT.') : labels[item.status] || item.status) : 'Đẩy bài lên Notion ở bước 1 rồi tạo ảnh.';
    node('studio-image-path').textContent = item?.localFolder || '';
    const activeReadyId = node('studio-ready-job').value || selectedJob;
    const target = ready.find(entry => entry.id === activeReadyId);
    summary(node('studio-ready-summary'), target, [['Shop / ID nguồn', target ? target.shop + ' · ' + target.productId : ''], ['Tên sản phẩm mới', target?.name || ''], ['Giá bán', target ? Number(target.price).toLocaleString('vi-VN') + ' ₫' : '']]);
    if (target) {
      if (target.status === 'replaced') {
        node('studio-ready-status').textContent = '✅ Đã điền xong 5 ảnh, tên, mô tả và giá mới lên Shopee! Hãy kiểm tra trên Chrome và bấm Cập nhật.';
      } else if (target.status === 'replacing') {
        node('studio-ready-status').textContent = 'Đang mở profile Shopee, tìm sản phẩm và thay thế ảnh, tên, giá...';
      } else if (target.imagesReady) {
        node('studio-ready-status').textContent = 'Đã có bài và 5 ảnh trên Notion. Bấm "Thay thế sản phẩm" để cập nhật lên Shopee.';
      } else {
        node('studio-ready-status').textContent = 'Đã có đủ 5 ảnh local. Bấm "Gắn 5 ảnh vào Notion" hoặc "Thay thế sản phẩm" để cập nhật ngay lên Shopee.';
      }
    } else {
      node('studio-ready-status').textContent = 'Chọn bài đã có bài và đủ 5 ảnh ở bước 2.';
    }
    const canReplace = target && (target.imagesReady || localImagesReady(target) || (target.imageFiles && target.imageFiles.length === 5));
    if (node('studio-replace')) {
      node('studio-replace').disabled = shopeeBusy() || !canReplace;
      node('studio-replace').textContent = target?.status === 'replaced' ? 'Thay thế lại lên Shopee' : 'Thay thế sản phẩm';
    }
    if (node('studio-activate')) {
      node('studio-activate').textContent = 'Chuẩn bị xem trước';
      node('studio-activate').disabled = shopeeBusy() || !target;
    }
    if (node('studio-attach')) {
      const attachTarget = target || item;
      node('studio-attach').disabled = busy() || !attachTarget || !localImagesReady(attachTarget) || attachTarget.imagesReady;
      node('studio-attach').hidden = !attachTarget || !localImagesReady(attachTarget) || attachTarget.imagesReady;
    }
  }
  function renderConfig() {
    const config = snapshot?.studioConfig || {};
    if (!configLoaded || !configDirty) {
      node('studio-model').value = config.geminiModel || '';
      node('studio-drive-local').value = config.driveLocalFolder || 'G:\\My Drive\\Hình ảnh Shopee\\Sản phẩm thay thế';
      node('studio-chatgpt-port').value = config.chatgptPort || 9222;
      node('studio-writing-reference').value = config.writingReference || '';
      if (node('settings-gemini-model')) node('settings-gemini-model').value = config.geminiModel || '';
      if (node('settings-drive-local')) node('settings-drive-local').value = config.driveLocalFolder || 'G:\\My Drive\\Hình ảnh Shopee\\Sản phẩm thay thế';
      if (node('settings-writing-reference')) node('settings-writing-reference').value = config.writingReference || '';
      if (config.geminiApiKey) {
        if (node('settings-gemini-key') && !node('settings-gemini-key').value) node('settings-gemini-key').value = config.geminiApiKey;
        if (node('studio-gemini-key') && !node('studio-gemini-key').value) node('studio-gemini-key').value = config.geminiApiKey;
      }
      configLoaded = true;
    }
    const geminiSavedText = config.geminiConfigured ? 'Đã lưu key mã hoá trên máy này.' : 'Chưa lưu API key.';
    node('studio-gemini-saved').textContent = geminiSavedText;
    if (node('settings-gemini-saved')) node('settings-gemini-saved').textContent = geminiSavedText;
    const geminiStatusText = (message(config.geminiStatus) || 'Chưa kiểm tra kết nối Gemini.') + (config.geminiCheckedAt ? ' · ' + (config.geminiCheckedModel || '') + ' · ' + date(config.geminiCheckedAt) : '');
    node('studio-gemini-status').textContent = geminiStatusText;
    node('studio-gemini-status').classList.toggle('studio-form-error', config.geminiFailed === true);
    if (node('settings-gemini-status')) {
      node('settings-gemini-status').textContent = geminiStatusText;
      node('settings-gemini-status').classList.toggle('studio-form-error', config.geminiFailed === true);
    }
    const chatgptStatusText = message(config.chatgptStatus) || 'Mở profile và đăng nhập ChatGPT trước.';
    node('studio-chatgpt-status').textContent = chatgptStatusText;
    if (node('settings-chatgpt-status')) node('settings-chatgpt-status').textContent = chatgptStatusText;
    const driveStatusText = message(config.driveStatus) || 'Chỉ kiểm tra thư mục local; Drive Desktop tự đồng bộ.';
    node('studio-drive-status').textContent = driveStatusText;
    if (node('settings-drive-status')) node('settings-drive-status').textContent = driveStatusText;
    node('studio-reference').textContent = config.writingReferenceLoaded ? 'Đọc lại bài mẫu Shopee' : 'Đọc bài mẫu Shopee';
    const chrome = snapshot?.studioChrome || {};
    const remembered = chrome.remembered === true;
    const chromeStatus = chrome.message || (chrome.connected ? 'Đã kết nối tiện ích Chrome.' : chrome.listening ? 'Đang chờ ghép nối tiện ích Chrome.' : 'Chưa kết nối Chrome.');
    node('studio-chrome-connection-status').textContent = chromeStatus + (remembered && !/không cần nhập mã/i.test(chromeStatus) ? ' · Đã nhớ Chrome. Có thể chọn lại tab trong tiện ích, không cần nhập mã.' : '');
    node('studio-chrome-connection-status').classList.toggle('studio-form-error', chrome.failed === true);
    node('studio-chrome-pair').disabled = busy() || remembered || chrome.connected === true; node('studio-chrome-extension-folder').disabled = busy();
    node('studio-chrome-disconnect').disabled = busy() || !!snapshot?.products?.busy || (!remembered && !chrome.connected && !chromePair);
    renderChromePair();
    for (const id of ['studio-config-save', 'studio-models', 'studio-gemini-test', 'studio-chatgpt-open', 'studio-chatgpt-test', 'studio-drive-test', 'studio-drive-folder', 'settings-studio-save', 'settings-models', 'settings-gemini-test', 'settings-chatgpt-open', 'settings-chatgpt-test', 'settings-drive-test', 'settings-drive-folder']) {
      if (node(id)) node(id).disabled = busy();
    }
  }
  function renderLogs() {
    const logs = snapshot?.studio?.logs || [];
    node('studio-log-count').textContent = logs.length;
    node('studio-log-list').innerHTML = logs.map(entry => '<article class="studio-log"><span class="badge ' + (entry.level === 'error' ? 'red' : entry.level === 'success' ? 'green' : 'warning') + '">' + (entry.level === 'error' ? 'Có lỗi' : entry.level === 'success' ? 'Hoàn tất' : 'Thông tin') + '</span><div>' + html(entry.message) + '<small>' + html(date(entry.at)) + '</small></div></article>').join('') || '<p class="studio-empty">Chưa có thao tác sửa bài hoặc tạo ảnh.</p>';
  }
  let autoLoadedNotion = false;
  function ensureNotionProducts() {
    if (autoLoadedNotion || !snapshot || busy() || shopeeBusy()) return;
    if (snapshot.settings?.notionEnabled && snapshot.credentials?.notion && snapshot.products && !snapshot.products.loadedAt && (!Array.isArray(snapshot.products.rows) || snapshot.products.rows.length === 0)) {
      autoLoadedNotion = true;
      void window.srm.call('products-load').then(refresh).catch(() => {});
    }
  }
  function renderView(value) {
    if (value) snapshot = value;
    if (!snapshot || !node('studio')) return;
    ensureNotionProducts();
    renderSources(); renderEditor(); renderPrompts(); renderImages(); renderConfig(); renderLogs(); setStep(selectedStep);
    node('studio-progress').textContent = snapshot.studio?.progress || (working ? 'Đang xử lý tác vụ Studio…' : 'Bắt đầu ở bước 1. Bản nháp và cấu hình lưu trên máy này.');
  }
  function selectJob(id) {
    if(selectedJob!==id && typeof selectReplacementPreview==='function')selectReplacementPreview(null,null);
    selectedJob = id; loadedEditor = ''; error(''); renderView(snapshot);
  }
  for (const id of ['studio-job', 'studio-image-job', 'studio-ready-job']) node(id).addEventListener('change', () => selectJob(node(id).value));
  for (const [field, id] of Object.entries(fieldIds)) node(id).addEventListener('input', () => {
    const item = job(); if (!item || locked(item)) return;
    const values = currentValues(item); values[field] = node(id).value; drafts.set(item.id, values); renderEditor();
  });
  node('studio-prompt-template').addEventListener('change', () => {selectedPrompt = node('studio-prompt-template').value; promptStatus(''); renderPrompts();});
  node('studio-prompt-apply').addEventListener('click', () => {
    const item = job(), template = selectedTemplate();
    if (promptWorking || !editable(item) || !template) return;
    const values = currentValues(item); values.prompt = template.content; drafts.set(item.id, values);
    node('studio-prompt').value = template.content; renderEditor(); renderPrompts();
    promptStatus('Đã áp dụng “' + template.name + '” vào bản nháp; chưa chạy Gemini.');
    node('studio-prompt').focus();
  });
  node('studio-prompt-add').addEventListener('click', () => {if (!promptWorking) openPromptEditor(null);});
  node('studio-prompt-edit').addEventListener('click', () => {if (!promptWorking && selectedTemplate()) openPromptEditor(selectedTemplate());});
  node('studio-prompt-template-cancel').addEventListener('click', () => {if (!promptWorking) closePromptEditor();});
  node('studio-prompt-editor').addEventListener('keydown', event => {if (event.key === 'Escape' && !promptWorking) {event.preventDefault(); closePromptEditor();}});
  node('studio-prompt-editor').addEventListener('submit', event => {
    event.preventDefault();
    if (promptEditorId === null || promptWorking) return;
    const payload = {name: node('studio-prompt-template-name').value.trim(), content: node('studio-prompt-template-content').value.trim()};
    if (!payload.name || !payload.content) {node('studio-prompt-template-error').textContent = 'Nhập tên và nội dung prompt mẫu.'; return;}
    if (promptEditorId) payload.id = promptEditorId;
    const beforeIds = new Set(templates().map(item => item.id));
    void promptTask(async () => {
      const result = await window.srm.call('studio-prompt-save', payload); updatePromptLibrary(result);
      selectedPrompt = payload.id || templates().find(item => !beforeIds.has(item.id))?.id || '';
      closePromptEditor(); promptStatus('Đã lưu prompt mẫu trên máy này.');
    });
  });
  node('studio-prompt-delete').addEventListener('click', () => {
    const template = selectedTemplate(); if (promptWorking || !template) return;
    if (!window.confirm('Xoá prompt mẫu “' + template.name + '”? Prompt đã áp dụng trong bài vẫn được giữ.')) return;
    void promptTask(async () => {
      const result = await window.srm.call('studio-prompt-delete', template.id); updatePromptLibrary(result);
      if (promptEditorId === template.id) closePromptEditor();
      promptStatus('Đã xoá prompt mẫu; giữ nguyên các bài đang sửa.');
    });
  });
  for (const id of ['studio-shop', 'studio-search']) node(id).addEventListener('input', renderSources);
  async function openRows(rowIds) {
    const result = await window.srm.call('studio-create', {rowIds});
    const first = Array.isArray(result) ? result[0] : result?.jobs?.[0]; if (first?.id) {
      const opened = Array.isArray(result) ? result : result.jobs;
      const ids = new Set(opened.map(item => item.id));
      snapshot = {...snapshot, studio:{...snapshot.studio,jobs:[...jobs().filter(item=>!ids.has(item.id)),...opened]}};
      if(selectedJob!==first.id && typeof selectReplacementPreview==='function')selectReplacementPreview(null,null);
      selectedJob = first.id;
    }
    loadedEditor = ''; setStep(1);
  }
  node('studio-products').addEventListener('change', event => {
    const target = event.target; if (!target.dataset.studioProduct) return;
    const source = sources().find(item=>item.id===target.dataset.studioProduct);
    // A previously selected product remains directly openable after deleting another draft.
    if (!target.checked && (!job() || source?.productId !== job().productId || source?.shop !== job().shop)) target.checked = true;
    if (target.checked) selectedProducts.add(target.dataset.studioProduct); else selectedProducts.delete(target.dataset.studioProduct);
    renderSources();
    if (target.checked) void task(() => openRows([target.dataset.studioProduct]), {refreshAfter:false});
  });
  node('studio-select-visible').addEventListener('click', () => {for (const item of filteredSources()) if (item.profileId) selectedProducts.add(item.id); renderSources();});
  node('studio-clear-selection').addEventListener('click', () => {selectedProducts.clear(); renderSources();});
  node('studio-create').addEventListener('click', () => task(() => openRows([...selectedProducts]), {refreshAfter:false}));
  node('studio-delete-draft').addEventListener('click', () => {
    const item = job(); if (busy() || item?.canDeleteDraft !== true) return;
    void task(async () => {
      await window.srm.call('studio-delete-draft', item.id);
      snapshot = {...snapshot,studio:{...snapshot.studio,jobs:jobs().filter(entry=>entry.id!==item.id)}};
      for (const cache of [drafts, manualImages, manualPrompts, manualDigests, manualFeedback, promptSlots, imageReferences]) cache.delete(item.id);
      for (const source of sources()) if (source.shop === item.shop && source.productId === item.productId) selectedProducts.delete(source.id);
      selectedJob = ''; loadedEditor = '';
      if (typeof selectReplacementPreview === 'function') selectReplacementPreview(null, null);
      setStep(1); node('studio-search').focus();
    }, {refreshAfter:false});
  });
  node('studio-save').addEventListener('click', () => task(async () => {const item = job(); if (item) await saveDraft(item);}));
  node('studio-generate').addEventListener('click', () => {
    const item = job(); if (!item || locked(item) || busy()) return;
    void task(async () => {await saveDraft(item); await window.srm.call('studio-generate', item.id); drafts.delete(item.id); loadedEditor = '';});
  });
  node('studio-publish').addEventListener('click', () => {
    const item = job(); if (!(canPublish(item) || canRecoverPublish(item))) return;
    const recovery = canRecoverPublish(item);
    void task(async () => {
      if (!recovery) await saveDraft(item);
      const published = await window.srm.call('studio-publish', item.id);
      loadedEditor = '';
      if (published?.notionUrl && published.contentApproved) setStep(2);
    });
  });
  node('studio-next').addEventListener('click', () => {
    const next = nextJob();
    if (next) selectJob(next.id);
  });
  node('studio-source-scan')?.addEventListener('click', () => {
    if (shopeeBusy()) {sourceScanStatus = sourceBusyMessage(); renderSources(); return;}
    sourceScanWorking = true; sourceScanStatus = 'Đang đồng bộ dữ liệu từ Notion…';
    error(''); renderView(snapshot);
    void (async () => {
      try {
        await window.srm.call('products-load');
        sourceScanStatus = 'Đã đồng bộ dữ liệu sản phẩm mới nhất từ Notion.';
        if (typeof toast === 'function') toast('Đã đồng bộ sản phẩm từ Notion thành công!');
      }
      catch (failure) {error(failure?.message || 'Không đồng bộ được dữ liệu sản phẩm từ Notion.');}
      finally {sourceScanWorking = false; try {await refresh();} catch {} renderView(snapshot);}
    })();
  });
  node('studio-shop')?.addEventListener('change', () => {
    renderSources();
  });
  node('studio-shop-delete')?.addEventListener('click', async () => {
    const targetShop = node('studio-shop-delete')?.dataset.targetShop;
    if (!targetShop || busy()) return;
    const isCleanAll = targetShop === '__empty__';
    const confirmMessage = isCleanAll
      ? 'Bạn có chắc muốn dọn các shop chưa có sản phẩm khỏi danh sách?'
      : 'Bạn có chắc muốn xoá shop "' + targetShop + '" khỏi danh sách?';
    if (!confirm(confirmMessage)) return;
    try {
      node('studio-shop-delete').disabled = true;
      await window.srm.call('products-delete-shop', targetShop);
      node('studio-shop').value = '';
      if (typeof toast === 'function') {
        toast(isCleanAll ? 'Đã dọn dẹp các shop trống thành công.' : 'Đã xoá shop "' + targetShop + '".');
      }
      await refresh();
    } catch (failure) {
      error(failure?.message || 'Không xoá được shop.');
    } finally {
      renderSources();
    }
  });
  node('studio-notion-menu').addEventListener('click', event => {if (event.target.closest('button')) node('studio-notion-menu').open = false;});
  node('studio-load').addEventListener('click', () => {if (!shopeeBusy()) void task(() => window.srm.call('studio-load'));});

  node('studio-replacement-search')?.addEventListener('input', () => renderReplacementCards());
  document.querySelectorAll('.studio-filter-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.studio-filter-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentReplacementFilter = btn.dataset.filter || 'all';
      renderReplacementCards();
    });
  });
  node('studio-replacement-cards')?.addEventListener('click', e => {
    const notionBtn = e.target.closest('[data-notion-url]');
    if (notionBtn) {
      e.stopPropagation();
      void window.srm.call('replacements-open', notionBtn.dataset.notionUrl);
      return;
    }
    const pickBtn = e.target.closest('[data-pick-replacement]');
    if (pickBtn) {
      e.stopPropagation();
      selectJob(pickBtn.dataset.pickReplacement);
      return;
    }
    const card = e.target.closest('[data-replacement-job]');
    if (card) {
      selectJob(card.dataset.replacementJob);
    }
  });

  const showNoReadyModal = () => {
    const modal = node('studio-no-ready-modal');
    if (modal && typeof modal.showModal === 'function') {
      modal.showModal();
    } else if (typeof toast === 'function') {
      toast('Chưa có sản phẩm nào ở trạng thái "Đã có" trên Notion.');
    }
  };
  node('studio-no-ready-close')?.addEventListener('click', () => {
    node('studio-no-ready-modal')?.close();
  });

  const scanReplacements = () => {
    if (working) return;
    void task(async () => {
      drafts.clear();
      node('studio-source-status').textContent = 'Đang quét bảng Notion thay thế…';
      await window.srm.call('studio-scan-replacements');
      await refresh();
      const currentSnap = await window.srm.call('snapshot');
      const allJobs = currentSnap?.studio?.jobs || [];
      const readyJobs = allJobs.filter(j => j.isReplacementReady || (j.name && j.name.trim() && j.name !== j.sourceName) || j.notionStatus === 'Đã có');
      if (readyJobs.length > 0) {
        currentReplacementFilter = 'ready';
        node('studio-filter-pills')?.querySelectorAll('.studio-filter-pill').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.filter === 'ready');
        });
        renderReplacementCards(currentSnap);
        const targetJob = readyJobs.find(j => j.id === selectedJob) || readyJobs[0];
        if (targetJob) {
          selectJob(targetJob.id);
        }
        if (typeof toast === 'function') toast(`Đã tìm thấy ${readyJobs.length} sản phẩm cần thay thế từ Notion!`);
      } else {
        showNoReadyModal();
      }
    });
  };
  node('studio-scan-replacements')?.addEventListener('click', scanReplacements);
  node('studio-scan-replacements-btn')?.addEventListener('click', scanReplacements);

  const syncToReplacements = () => {
    void task(async () => {
      node('studio-source-status').textContent = 'Đang tự động ánh xạ kho sản phẩm sang bảng Notion thay thế…';
      const result = await window.srm.call('studio-sync-to-replacements');
      if (typeof toast === 'function') toast(`Đã ánh xạ ${result.total} sản phẩm sang Notion thay thế (mới: ${result.created}, cập nhật: ${result.updated})!`);
      await refresh();
    });
  };
  node('studio-sync-to-replacements')?.addEventListener('click', syncToReplacements);
  node('studio-sync-replacements-btn')?.addEventListener('click', syncToReplacements);

  node('studio-reference').addEventListener('click', () => task(() => window.srm.call('studio-reference')));
  node('studio-article').addEventListener('click', () => {const item = job(); if (item?.notionUrl) void task(() => window.srm.call('replacements-open', item.notionUrl));});
  async function manualTask(item, work) {
    if (!canImportImages(item)) return;
    await task(async () => {
      manualFeedback.delete(item.id);
      try {await work();}
      catch (failure) {manualFeedback.set(item.id, {message: failure?.message || 'Không hoàn tất thao tác ảnh.', failed: true}); throw failure;}
    });
  }
  node('studio-manual-prompts').addEventListener('click', () => {
    const item = job();
    void manualTask(item, async () => {
      const result = await window.srm.call('studio-image-prompts', item.id);
      if (result?.jobId && result.jobId !== item.id) throw Error('Prompt trả về không thuộc bài đang chọn. Chọn lại bài và thử lại.');
      const entries = (result?.prompts || []).map((entry, index) => ({title: typeof entry === 'string' ? imageLabels[index] : String(entry?.title || imageLabels[index]), text: typeof entry === 'string' ? entry : entry?.text}));
      if (entries.length !== 5 || entries.some(entry => typeof entry.text !== 'string' || !entry.text.trim() || entry.text.length > 60000)) throw Error('Chưa nhận được đủ 5 prompt hợp lệ. Thử chuẩn bị lại.');
      if (!/^[a-f\d]{64}$/i.test(result.contentDigest || '')) throw Error('Chưa xác minh nội dung bài Notion. Lấy lại prompt.');
      manualPrompts.set(item.id, entries); manualDigests.set(item.id, result.contentDigest); promptSlots.set(item.id, 0);
      manualFeedback.set(item.id, {message: 'Đã có 5 prompt. Chọn ảnh mẫu rồi bấm Tạo lần lượt 5 ảnh.'});
      renderImages(); if (node('studio-manual-fallback').open) node('studio-image-prompt-text').focus();
    });
  });
  node('studio-normal-chatgpt').addEventListener('click', () => {if (!busy()) void task(() => window.srm.call('studio-chatgpt-open'));});
  node('studio-chrome-extension-folder').addEventListener('click', () => {if (!busy()) void task(() => window.srm.call('studio-chrome-extension-folder'));});
  node('studio-chrome-pair').addEventListener('click', () => {
    if (busy() || snapshot?.studioChrome?.remembered || snapshot?.studioChrome?.connected) return;
    void task(async () => {
      const result = await window.srm.call('studio-chrome-pair');
      const permanent = result?.expiresAt === null && result.oneTime === true;
      const expires = Date.parse(result?.expiresAt) || Number(result?.expiresAt);
      if (typeof result?.code !== 'string' || !/^[A-Z\d -]{4,32}$/i.test(result.code) || (!permanent && (!Number.isFinite(expires) || expires <= Date.now()))) throw Error('Không nhận được mã ghép nối hợp lệ. Thử ghép nối lại.');
      chromePair = {code: result.code, expiresAt: permanent ? null : expires, oneTime: result.oneTime === true}; clearTimeout(chromePairTimer);
      chromePairTimer = permanent ? null : setTimeout(() => {chromePair = null; renderChromePair();}, Math.min(expires - Date.now(), 2147483647));
      renderChromePair();
    });
  });
  node('studio-chrome-disconnect').addEventListener('click', () => {
    if (busy() || snapshot?.products?.busy || node('studio-chrome-disconnect').disabled) return;
    void task(async () => {
      await window.srm.call('studio-chrome-disconnect');
      chromePair = null; clearTimeout(chromePairTimer); chromePairTimer = null; renderChromePair();
    });
  });
  node('studio-image-reference-pick').addEventListener('click', () => {
    const item = job();
    void manualTask(item, async () => {
      const result = await window.srm.call('studio-image-reference-pick', item.id);
      if (result?.cancelled) return;
      if (typeof result?.selectionId !== 'string' || !result.selectionId || typeof result.name !== 'string' || !safePreview(result.previewDataUrl)) throw Error('Ảnh mẫu chưa hợp lệ. Chọn lại ảnh gốc sản phẩm.');
      imageReferences.set(item.id, {selectionId: result.selectionId, name: result.name, previewDataUrl: result.previewDataUrl});
    });
  });
  node('studio-chatgpt-test-btn')?.addEventListener('click', () => task(async () => {
    if (configDirty) await saveConfig();
    const result = await window.srm.call('studio-chatgpt-test');
    node('studio-chrome-progress').textContent = message(result);
  }));
  node('studio-chrome-prompt-slot')?.addEventListener('change', () => {
    const item = job(), index = Number(node('studio-chrome-prompt-slot').value);
    if (!item || busy() || !Number.isInteger(index) || index < 0 || index > 4) return;
    userSelectedSlots.add(item.id + ':' + index);
    promptSlots.set(item.id, index);
    if (node('studio-chrome-prompt-text')) {
      const entries = chromePrompts.get(item.id) || manualPrompts.get(item.id) || [];
      node('studio-chrome-prompt-text').value = entries[index]?.text || '';
    }
    renderImages();
  });
  let promptSaveTimer = null;
  node('studio-chrome-prompt-text')?.addEventListener('input', () => {
    const item = job(), slot = promptSlots.get(item?.id) ?? 0;
    if (!item) return;
    const text = node('studio-chrome-prompt-text').value;
    const entries = [...(chromePrompts.get(item.id) || manualPrompts.get(item.id) || [])];
    if (!entries[slot]) entries[slot] = {title: imageLabels[slot] || ('Ảnh ' + (slot + 1)), text: ''};
    entries[slot] = {...entries[slot], text};
    chromePrompts.set(item.id, entries);
    manualPrompts.set(item.id, entries);
    clearTimeout(promptSaveTimer);
    promptSaveTimer = setTimeout(() => {
      void window.srm.call('studio-image-prompt-update', item.id, slot, text).catch(() => {});
    }, 300);
  });
  node('studio-chrome-prompt-reset')?.addEventListener('click', () => {
    const item = job(), slot = promptSlots.get(item?.id) ?? 0;
    if (!item || busy()) return;
    void task(async () => {
      const res = await window.srm.call('studio-image-prompt-reset', item.id, slot);
      if (res?.prompts) {
        chromePrompts.set(item.id, res.prompts);
        manualPrompts.set(item.id, res.prompts);
        if (node('studio-chrome-prompt-text')) {
          node('studio-chrome-prompt-text').value = res.prompts[slot]?.text || '';
        }
      }
      await refresh();
    });
  });
  node('studio-chrome-prompt-clear')?.addEventListener('click', () => {
    const item = job(), slot = promptSlots.get(item?.id) ?? 0;
    if (!item || busy()) return;
    if (node('studio-chrome-prompt-text')) node('studio-chrome-prompt-text').value = '';
    const entries = [...(chromePrompts.get(item.id) || manualPrompts.get(item.id) || [])];
    if (entries[slot]) entries[slot] = {...entries[slot], text: ''};
    chromePrompts.set(item.id, entries);
    manualPrompts.set(item.id, entries);
    void window.srm.call('studio-image-prompt-update', item.id, slot, '').catch(() => {});
  });
  node('studio-chrome-prompt-save')?.addEventListener('click', () => {
    const item = job(), slot = promptSlots.get(item?.id) ?? 0;
    if (!item || busy()) return;
    const text = node('studio-chrome-prompt-text')?.value ?? '';
    const entries = [...(chromePrompts.get(item.id) || manualPrompts.get(item.id) || [])];
    if (!entries[slot]) entries[slot] = {title: imageLabels[slot] || ('Ảnh ' + (slot + 1)), text: ''};
    entries[slot] = {...entries[slot], text};
    chromePrompts.set(item.id, entries);
    manualPrompts.set(item.id, entries);
    void task(async () => {
      await window.srm.call('studio-image-prompt-update', item.id, slot, text);
      const statusEl = node('studio-chrome-prompt-save-status');
      if (statusEl) {
        statusEl.textContent = '✅ Đã lưu prompt ' + (slot + 1) + '!';
        setTimeout(() => { if (statusEl.textContent.includes('Đã lưu prompt ' + (slot + 1))) statusEl.textContent = ''; }, 3000);
      }
    });
  });
  node('studio-chrome-run-single')?.addEventListener('click', () => {
    const item = job(), reference = imageReferences.get(item?.id), digest = chromeDigests.get(item?.id) || manualDigests.get(item?.id);
    const slot = promptSlots.get(item?.id) || 0;
    if (!item?.notionUrl || !item.contentApproved || item.imagesReady || busy() || !snapshot?.studioChatgpt?.connected || snapshot.studioChatgpt.ready !== true || !reference?.selectionId || !digest) return;
    void task(async () => {
      if (configDirty) await saveConfig();
      await window.srm.call('studio-cdp-run', item.id, reference.selectionId, digest, slot);
      userSelectedSlots.delete(item.id + ':' + slot);
      if (slot < 4) promptSlots.set(item.id, slot + 1);
    });
  });
  node('studio-chrome-run')?.addEventListener('click', () => {
    const item = job(), reference = imageReferences.get(item?.id), digest = chromeDigests.get(item?.id) || manualDigests.get(item?.id);
    if (!item?.notionUrl || !item.contentApproved || item.imagesReady || localImagesReady(item) || busy() || !snapshot?.studioChatgpt?.connected || snapshot.studioChatgpt.ready !== true || !reference?.selectionId || !digest) return;
    void task(async () => {
      if (configDirty) await saveConfig();
      // Snapshot events continue to render each completed image while this call waits.
      await window.srm.call('studio-cdp-run', item.id, reference.selectionId, digest);
    });
  });
  node('studio-go-step3')?.addEventListener('click', () => setStep(3, true));
  node('studio-image-prompt-slot').addEventListener('change', () => {
    const item = job(), index = Number(node('studio-image-prompt-slot').value);
    if (!item || busy() || !Number.isInteger(index) || index < 0 || index > 4) return;
    promptSlots.set(item.id, index); renderManualImages(item);
  });
  node('studio-copy-image-prompt').addEventListener('click', () => {
    const item = job(), index = promptSlots.get(item?.id) || 0;
    if (!manualPrompts.get(item?.id)?.[index]?.text) return;
    void manualTask(item, async () => {
      await window.srm.call('studio-image-copy', item.id, index);
      manualFeedback.set(item.id, {message: 'Đã sao chép prompt ảnh ' + (index + 1) + ' · ' + imageLabels[index] + '. Dán vào ChatGPT trong Chrome thường.'});
    });
  });
  node('studio-manual-selectors').addEventListener('click', event => {
    const button = event.target.closest('[data-studio-image-slot]'), item = job();
    if (!button || !node('studio-manual-selectors').contains(button)) return;
    const index = Number(button.dataset.studioImageSlot);
    if (!Number.isInteger(index) || index < 0 || index > 4) return;
    void manualTask(item, async () => {
      const result = await window.srm.call('studio-image-pick', item.id, index);
      if (result?.cancelled) return;
      if (typeof result?.selectionId !== 'string' || !result.selectionId || typeof result.name !== 'string' || !safePreview(result.previewDataUrl) || !Number.isFinite(result.bytes) || result.bytes <= 0 || !Number.isInteger(result.width) || result.width < 1 || !Number.isInteger(result.height) || result.height < 1) throw Error('Ảnh chọn chưa hợp lệ. Chọn lại file ảnh gốc đã tải về.');
      const selected = [...(manualImages.get(item.id) || Array(5).fill(null))];
      if (selected.some((entry, slot) => slot !== index && entry?.selectionId === result.selectionId)) throw Error('Ảnh này đã được chọn cho một ô khác. Chọn 5 ảnh riêng biệt.');
      selected[index] = {...result}; manualImages.set(item.id, selected);
      manualFeedback.set(item.id, {message: 'Đã chọn ảnh ' + (index + 1) + ' · ' + imageLabels[index] + '. Chọn đủ 5 ảnh rồi bấm Nhập 5 ảnh vào tool.'});
    });
  });
  async function pickAndImportSlot(index) {
    const item = job();
    if (!item || busy()) return;
    void task(async () => {
      const result = await window.srm.call('studio-image-slot-pick-and-import', item.id, index);
      if (result?.cancelled) return;
      manualFeedback.set(item.id, {message: 'Đã lưu thủ công ' + (index + 1) + '.png vào Drive local.'});
      await refresh();
    });
  }
  node('studio-gallery')?.addEventListener('click', event => {
    const target = event.target.closest('[data-gallery-slot], [data-gallery-pick]');
    if (!target) return;
    const slotStr = target.dataset.galleryPick ?? target.dataset.gallerySlot;
    const index = Number(slotStr);
    if (!Number.isInteger(index) || index < 0 || index > 4) return;
    void pickAndImportSlot(index);
  });
  node('studio-gallery')?.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const target = event.target.closest('[data-gallery-slot], [data-gallery-pick]');
    if (!target) return;
    event.preventDefault();
    const slotStr = target.dataset.galleryPick ?? target.dataset.gallerySlot;
    const index = Number(slotStr);
    if (!Number.isInteger(index) || index < 0 || index > 4) return;
    void pickAndImportSlot(index);
  });
  node('studio-clear-image-logs')?.addEventListener('click', () => {
    const item = job();
    void task(async () => {
      await window.srm.call('studio-clear-image-logs', item?.id);
      if (item?.id) {
        manualFeedback.delete(item.id);
        manualImages.delete(item.id);
      }
      node('studio-manual-status').textContent = 'Đã xoá nhật ký ảnh.';
      node('studio-manual-status').classList.remove('studio-form-error');
      await refresh();
    });
  });
  node('studio-import-images').addEventListener('click', () => {
    const item = job(), selected = manualImages.get(item?.id) || [], handles = selected.map(entry => entry?.selectionId);
    if (handles.length !== 5 || handles.some(value => !value) || new Set(handles).size !== 5) return;
    void manualTask(item, async () => {
      if (configDirty) await saveConfig();
      await window.srm.call('studio-images-import', item.id, handles, manualDigests.get(item.id));
      manualImages.delete(item.id);
      manualFeedback.set(item.id, {message: 'Đã nhập đủ 5 ảnh, nén và lưu local. Bấm Gắn 5 ảnh vào bài Notion để tiếp tục.'});
    });
  });
  node('studio-images')?.addEventListener('click', () => {const item = job(); if (item?.notionUrl && item.contentApproved && !item.imagesReady && item.status !== 'images-uncertain') void task(() => window.srm.call('studio-images', item.id));});
  node('studio-image-folder')?.addEventListener('click', () => {const item = job(); if (item?.localFolder) void task(() => window.srm.call('studio-open-folder', item.id));});
  node('studio-attach')?.addEventListener('click', () => {
    const published = jobs().filter(item => item.notionUrl);
    const ready = published.filter(item => item.imagesReady === true || (item.imageFiles && item.imageFiles.length === 5));
    const activeReadyId = node('studio-ready-job')?.value || selectedJob;
    const item = ready.find(entry => entry.id === activeReadyId) || job();
    if (item?.localFolder && item.imageFiles?.length === 5 && !item.imagesReady) {
      void task(async () => {
        await window.srm.call('studio-attach', item.id);
        await refresh();
      });
    }
  });
  node('studio-clear-logs')?.addEventListener('click', event => {
    event.stopPropagation();
    event.preventDefault();
    void task(async () => {
      await window.srm.call('studio-clear-logs');
      await refresh();
    });
  });
  node('studio-ready-job')?.addEventListener('change', () => {
    selectedJob = node('studio-ready-job').value || selectedJob;
    renderImages();
  });
  node('studio-replace')?.addEventListener('click', () => {
    const published = jobs().filter(item => item.notionUrl);
    const ready = published.filter(item => item.imagesReady === true || (item.imageFiles && item.imageFiles.length === 5));
    const activeReadyId = node('studio-ready-job')?.value || selectedJob;
    const item = ready.find(entry => entry.id === activeReadyId) || job();
    if (!item || shopeeBusy()) return;
    void task(async () => {
      node('studio-ready-status').textContent = 'Đang mở profile Shopee, tìm sản phẩm và thay thế ảnh, tên, giá...';
      const result = await window.srm.call('studio-replace', item.id);
      await refresh();
      node('studio-ready-status').textContent = '✅ Đã điền xong 5 ảnh, tên, mô tả và giá mới lên Shopee! Hãy kiểm tra trên Chrome và bấm Cập nhật.';
      showStudioSuccessModal(result || item);
    });
  });
  node('studio-activate')?.addEventListener('click', () => {
    const published = jobs().filter(item => item.notionUrl);
    const ready = published.filter(item => item.imagesReady === true || (item.imageFiles && item.imageFiles.length === 5));
    const activeReadyId = node('studio-ready-job')?.value || selectedJob;
    const item = ready.find(entry => entry.id === activeReadyId) || job();
    if (!item || shopeeBusy()) return;
    void task(async () => {
      if (!item.imagesReady) {
        node('studio-ready-status').textContent = 'Đang tự động nén và gắn 5 ảnh vào bài Notion...';
        await window.srm.call('studio-attach', item.id);
        await refresh();
      }
      node('studio-ready-status').textContent = 'Đang mở profile Shopee đọc form và chuẩn bị xem trước...';
      const result = await window.srm.call('studio-activate', item.id), plan = result?.plan || (result?.target ? result : null);
      const rowId = result?.rowId || plan?.rowId || item.rowId;
      await refresh();
      if(!plan?.id)throw Error('Chưa có bản xem trước đã xác minh.');
      selectReplacementPreview(plan.id,rowId);
      node('replacement-preview').scrollIntoView({block: 'start', behavior: 'instant'});
    });
  });
  document.querySelectorAll('[data-studio-step]').forEach(button => button.addEventListener('click', () => setStep(Number(button.dataset.studioStep))));
  document.querySelectorAll('.studio-steps [role=tab]').forEach(button => button.addEventListener('keydown', event => {
    const moves = {ArrowRight: 1, ArrowLeft: -1};
    if (event.key in moves) {event.preventDefault(); setStep((selectedStep - 1 + moves[event.key] + 3) % 3 + 1, true);}
    if (event.key === 'Home' || event.key === 'End') {event.preventDefault(); setStep(event.key === 'Home' ? 1 : 3, true);}
  }));
  async function saveConfig() {
    const port = Number(node('studio-chatgpt-port')?.value || 9222);
    if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw Error('Cổng Chrome Debug phải từ 1024 đến 65535.');
    const model = (node('studio-model')?.value ?? node('settings-gemini-model')?.value ?? '').trim();
    const driveLocal = (node('studio-drive-local')?.value ?? node('settings-drive-local')?.value ?? '').trim();
    const writingRef = (node('studio-writing-reference')?.value ?? node('settings-writing-reference')?.value ?? '');
    const payload = {geminiModel: model, driveLocalFolder: driveLocal, chatgptPort: port, writingReference: writingRef};
    const keyVal = (node('studio-gemini-key')?.value || node('settings-gemini-key')?.value || '').trim();
    if (keyVal) payload.geminiApiKey = keyVal;
    await window.srm.call('studio-config', payload);
    if (payload.geminiApiKey) {
      if (node('settings-gemini-key')) node('settings-gemini-key').value = payload.geminiApiKey;
      if (node('studio-gemini-key')) node('studio-gemini-key').value = payload.geminiApiKey;
    }
    configDirty = false;
    const savedMsg = 'Đã lưu trên máy này; giữ nguyên khi cài bản mới.';
    if (node('studio-config-status')) node('studio-config-status').textContent = savedMsg;
    if (node('settings-studio-status')) node('settings-studio-status').textContent = savedMsg;
  }
  const syncPairs = [
    ['studio-gemini-key', 'settings-gemini-key'],
    ['studio-model', 'settings-gemini-model'],
    ['studio-drive-local', 'settings-drive-local'],
    ['studio-writing-reference', 'settings-writing-reference']
  ];
  for (const [idA, idB] of syncPairs) {
    const a = node(idA), b = node(idB);
    if (a && b) {
      a.addEventListener('input', () => { b.value = a.value; });
      b.addEventListener('input', () => { a.value = b.value; });
    }
  }
  for (const id of ['studio-gemini-key', 'studio-model', 'studio-drive-local', 'studio-chatgpt-port', 'studio-writing-reference', 'settings-gemini-key', 'settings-gemini-model', 'settings-drive-local', 'settings-writing-reference']) {
    if (node(id)) node(id).addEventListener('input', () => {
      configDirty = true;
      if (node('studio-config-status')) node('studio-config-status').textContent = 'Cấu hình có chỉnh sửa chưa lưu.';
      if (node('settings-studio-status')) node('settings-studio-status').textContent = 'Cấu hình có chỉnh sửa chưa lưu.';
    });
  }
  node('studio-config-form')?.addEventListener('submit', event => {event.preventDefault(); void task(saveConfig);});
  node('settings-studio-save')?.addEventListener('click', () => void task(saveConfig));

  async function loadModels() {
    if (configDirty) await saveConfig();
    const result = await window.srm.call('studio-models');
    const opts = (result.models || []).map(m => '<option value="' + html(m.id) + '">' + html(m.label || m.id) + '</option>').join('');
    node('studio-model-list').innerHTML = opts;
    if (result.selected) {
      node('studio-model').value = result.selected;
      if (node('settings-gemini-model')) node('settings-gemini-model').value = result.selected;
    }
    const msg = result.message || 'Đã lấy ' + (result.models?.length || 0) + ' model được API hỗ trợ.';
    if (node('studio-config-status')) node('studio-config-status').textContent = msg;
    if (node('settings-gemini-status')) node('settings-gemini-status').textContent = msg;
  }
  node('studio-models')?.addEventListener('click', () => task(loadModels));
  node('settings-models')?.addEventListener('click', () => task(loadModels));

  async function testGemini() {
    if (configDirty) await saveConfig();
    const result = await window.srm.call('studio-test');
    const msg = result.message || 'Đã kiểm tra Gemini.';
    if (node('studio-config-status')) node('studio-config-status').textContent = msg;
    if (node('settings-gemini-status')) node('settings-gemini-status').textContent = msg;
  }
  node('studio-gemini-test')?.addEventListener('click', () => task(testGemini));
  node('settings-gemini-test')?.addEventListener('click', () => task(testGemini));

  async function openChatgpt() {
    if (configDirty) await saveConfig();
    await window.srm.call('studio-chatgpt-open');
  }
  node('studio-chatgpt-open')?.addEventListener('click', () => task(openChatgpt));
  node('settings-chatgpt-open')?.addEventListener('click', () => task(openChatgpt));

  async function testChatgpt() {
    if (configDirty) await saveConfig();
    const result = await window.srm.call('studio-chatgpt-test');
    if (node('studio-config-status')) node('studio-config-status').textContent = message(result);
    if (node('settings-chatgpt-status')) node('settings-chatgpt-status').textContent = message(result);
  }
  node('studio-chatgpt-test')?.addEventListener('click', () => task(testChatgpt));
  node('settings-chatgpt-test')?.addEventListener('click', () => task(testChatgpt));

  async function testDrive() {
    if (configDirty) await saveConfig();
    const result = await window.srm.call('studio-drive-test');
    if (node('studio-config-status')) node('studio-config-status').textContent = message(result);
    if (node('settings-drive-status')) node('settings-drive-status').textContent = message(result);
  }
  node('studio-drive-test')?.addEventListener('click', () => task(testDrive));
  node('settings-drive-test')?.addEventListener('click', () => task(testDrive));

  async function pickDriveFolder() {
    const result = await window.srm.call('studio-drive-folder');
    const folder = typeof result === 'string' ? result : result?.path || result?.folder || result?.driveLocalFolder;
    if (folder && !result?.cancelled) {
      node('studio-drive-local').value = folder;
      if (node('settings-drive-local')) node('settings-drive-local').value = folder;
      configDirty = true;
      const msg = 'Đã chọn thư mục; bấm Lưu cấu hình Studio.';
      if (node('studio-config-status')) node('studio-config-status').textContent = msg;
      if (node('settings-studio-status')) node('settings-studio-status').textContent = msg;
    }
  }
  node('studio-drive-folder')?.addEventListener('click', () => task(pickDriveFolder));
  node('settings-drive-folder')?.addEventListener('click', () => task(pickDriveFolder));

  function showStudioSuccessModal(item) {
    const modal = node('studio-success-modal');
    if (!modal) return;
    const nameEl = node('studio-success-name');
    const shopEl = node('studio-success-shop');
    const priceEl = node('studio-success-price');
    const imagesEl = node('studio-success-images');
    if (nameEl) nameEl.textContent = item?.name || item?.sourceName || 'Sản phẩm thay thế';
    if (shopEl) shopEl.textContent = (item?.shop ? item.shop + ' · ' : '') + 'ID: ' + (item?.productId || '---');
    if (priceEl) priceEl.textContent = item?.price ? Number(item.price).toLocaleString('vi-VN') + ' ₫' : '---';
    if (imagesEl) {
      const files = item?.imageFiles || [];
      if (files.length) {
        imagesEl.innerHTML = files.slice(0, 5).map((img, idx) => {
          const src = img.previewDataUrl || '';
          return '<div class="studio-success-img-box">' +
            (src ? '<img src="' + src + '" alt="Ảnh ' + (idx + 1) + '">' : '<div class="studio-success-placeholder">Ảnh ' + (idx + 1) + '</div>') +
            '<span>' + (imageLabels[idx] || ('Ảnh ' + (idx + 1))) + '</span>' +
          '</div>';
        }).join('');
      } else {
        imagesEl.innerHTML = '<p class="subtle">Đã điền đủ 5 ảnh lên Shopee.</p>';
      }
    }
    if (typeof modal.showModal === 'function') {
      try { modal.showModal(); } catch { modal.hidden = false; }
    } else {
      modal.hidden = false;
    }
  }

  function closeStudioSuccessModal() {
    const modal = node('studio-success-modal');
    if (!modal) return;
    if (typeof modal.close === 'function') {
      try { modal.close(); } catch { modal.hidden = true; }
    } else {
      modal.hidden = true;
    }
  }

  node('studio-success-confirm')?.addEventListener('click', closeStudioSuccessModal);
  node('studio-success-close')?.addEventListener('click', closeStudioSuccessModal);
  return {render: renderView};
})();
function renderStudio(snapshot) {studioUI.render(snapshot);}
if (typeof data !== 'undefined' && data) renderStudio(data);
