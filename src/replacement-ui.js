let replacementWorking = false, replacementSelection = '', replacementPlanId = '';
try {
  const saved = JSON.parse(localStorage.getItem('replacement-preview-selection') || '{}');
  if (typeof saved.planId === 'string' && typeof saved.rowId === 'string') {
    replacementPlanId = saved.planId; replacementSelection = saved.rowId;
  }
} catch {}

const replacementFormat = value => typeof value === 'string' ? value : value == null ? '—' : JSON.stringify(value, null, 2);
const replacementStateLabels = {prepared: 'Đã chuẩn bị', ready: 'Đã chuẩn bị', running: 'Đang cập nhật Shopee', verified: 'Đã xác minh', failed: 'Không thực hiện', uncertain: 'Chưa xác minh · kiểm tra Shopee trước', expired: 'Đã hết hạn'};
function replacementRow() { return data?.products?.rows.find(row => row.id === replacementSelection); }
function replacementBusy() { return replacementWorking || data?.replacements?.busy || data?.products?.busy || data?.scanning || data?.clearingNotion; }
function replacementExpiry(plan) {
  const value = typeof plan?.expiresAt === 'number' ? plan.expiresAt : Date.parse(plan?.expiresAt);
  return Number.isFinite(value) ? value : 0;
}
function replacementCanRun(plan) {
  const row = replacementRow();
  return !!row && ['prepared', 'ready'].includes(plan?.status) && !plan.expired && replacementExpiry(plan) > Date.now() &&
    plan.target?.shop === row.shop && String(plan.target?.productId) === String(row.productId) &&
    plan.target?.profileId === row.profileId &&
    Array.isArray(plan.images) && plan.images.length > 0 && !(plan.validation?.errors?.length);
}
function replacementUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') &&
      ['notion.so', 'www.notion.so', 'app.notion.com', 'www.notion.com'].includes(url.hostname) ? url.href : '';
  } catch { return ''; }
}
function replacementFailure(message) {
  const node = $('#replacement-error'); node.textContent = message; node.classList.add('error'); node.focus();
}
function replacementClearError() { $('#replacement-error').textContent = ''; $('#replacement-error').classList.remove('error'); }

async function replacementTask(work) {
  if (replacementBusy()) return;
  replacementWorking = true; replacementClearError(); renderReplacements();
  try { await work(); }
  catch (error) { replacementFailure(error.message); }
  finally {
    replacementWorking = false;
    try { render(await window.srm.call('snapshot')); } catch {}
    renderReplacements();
  }
}

function replacementDiff(plan) {
  if (Array.isArray(plan.diff)) return plan.diff;
  if (Array.isArray(plan.diff?.changes)) return plan.diff.changes;
  return Object.entries(plan.diff || {}).map(([field, value]) => typeof value === 'object' && value !== null ? {field, ...value} : {field, after: value});
}

function renderReplacementPreview(plan) {
  $('#replacement-preview').hidden = !plan;
  if (!plan) { $('#replacement-run').disabled = true; return; }
  const expired = !!plan.expired || replacementExpiry(plan) <= Date.now();
  $('#replacement-preview').dataset.expired = String(expired);
  $('#replacement-plan-status').textContent = replacementStateLabels[plan.status] || plan.status || 'Chưa chuẩn bị';
  $('#replacement-plan-status').className = 'badge ' + (['failed', 'uncertain'].includes(plan.status) ? 'red' : plan.status === 'verified' ? 'green' : 'warning');
  $('#replacement-preview-time').textContent = 'Chuẩn bị: ' + time(plan.createdAt) + (['prepared', 'ready'].includes(plan.status) ? ' · ' + (expired ? 'Bản xem trước đã hết hạn; chuẩn bị lại.' : 'Có hiệu lực đến ' + time(replacementExpiry(plan))) : '');
  const profile = data.profiles?.find(item => item.id === plan.target?.profileId);
  $('#replacement-preview-identity').innerHTML = [
    ['Shop nguồn', plan.target?.shop], ['ID sản phẩm nguồn', plan.target?.productId],
    ['Profile', profile?.name || plan.target?.profileId], ['Sản phẩm đang thay', plan.target?.name],
    ['Tên sau cập nhật', plan.article?.product?.name], ['Ngành hàng', plan.article?.product?.category],
  ].map(([label, value]) => '<div><dt>' + escape(label) + '</dt><dd>' + escape(replacementFormat(value)) + '</dd></div>').join('');
  $('#replacement-preview-description').textContent = plan.article?.product?.description || '';
  const changes = replacementDiff(plan);
  $('#replacement-diff-rows').innerHTML = changes.map(change => '<tr><td>' + escape(change.label || change.field || change.name || 'Thông tin') + '</td><td>' + escape(replacementFormat(change.before ?? change.previous ?? change.from)) + '</td><td>' + escape(replacementFormat(change.after ?? change.value ?? change.to)) + '</td></tr>').join('') || '<tr><td colspan="3">Nội dung sản phẩm không đổi; bộ ảnh sẽ được thay theo bài Notion.</td></tr>';
  $('#replacement-images').innerHTML = (plan.images || []).map((image, index) => {
    const preview = image.previewDataUrl || image.thumbnail || '';
    const safePreview = preview.length < 500000 && /^data:image\/jpeg;base64,[A-Za-z\d+/=]+$/.test(preview);
    return '<figure class="replacement-image">' + (safePreview ? '<img alt="Ảnh mới ' + (index + 1) + ' sau nén" src="' + preview + '">' : '<div class="replacement-image-placeholder" aria-label="Ảnh mới ' + (index + 1) + '">' + String(index + 1).padStart(2, '0') + '</div>') + '<figcaption><strong>' + (index === 0 ? 'Ảnh bìa · ' : 'Ảnh ' + (index + 1) + ' · ') + escape(image.width) + ' × ' + escape(image.height) + '</strong><small>' + Number(image.bytes || image.size || 0).toLocaleString('vi-VN') + ' byte · JPEG</small><small>' + escape(image.filename || '') + '</small></figcaption></figure>';
  }).join('');
  const errors = plan.validation?.errors || [];
  const required = (plan.schema?.fields || []).filter(field => field.required).length;
  $('#replacement-validation').className = 'replacement-validation ' + (errors.length || plan.error || expired && ['prepared', 'ready'].includes(plan.status) ? 'red' : 'green');
  $('#replacement-validation').textContent = plan.error || errors.join('; ') || (expired && ['prepared', 'ready'].includes(plan.status) ? 'Bản xem trước hết hạn. Bấm Chọn bài này & chuẩn bị xem trước để đọc lại dữ liệu.' : 'Đã kiểm tra form Shopee · ' + required + ' trường bắt buộc · ' + (plan.images || []).length + ' ảnh đã xử lý dưới 1,9 MB.');
  $('#replacement-plan-error').textContent = plan.notionPending ? 'Shopee đã xác minh; Notion còn chờ đồng bộ. ' + (plan.notionError || '') : '';
  $('#replacement-run').disabled = replacementBusy() || !replacementCanRun(plan);
  $('#replacement-run').textContent = plan.status === 'running' ? 'Đang cập nhật…' : plan.status === 'verified' ? 'Đã lưu và xác minh' : 'Chạy cập nhật lên Shopee';
  $('#replacement-preview-article').disabled = replacementWorking || !replacementUrl(plan.articleUrl);
}

function renderReplacements() {
  if (!data) return;
  $('#replacement-progress').textContent = data.replacements?.progress || (replacementWorking ? 'Đang cập nhật sản phẩm thay thế…' : 'Chuẩn bị bản xem trước của bài đã chọn trước khi chạy.');
  renderReplacementPreview(data.replacements?.plans.find(plan => plan.id === replacementPlanId));
}

function selectReplacementPreview(planId, rowId) {
  const plan = data?.replacements?.plans.find(item => item.id === planId);
  replacementPlanId = typeof planId === 'string' ? planId : '';
  replacementSelection = typeof rowId === 'string' ? rowId : plan?.rowId || '';
  replacementClearError();
  try { localStorage.setItem('replacement-preview-selection', JSON.stringify({planId: replacementPlanId, rowId: replacementSelection})); } catch {}
  renderReplacements();
}

$('#replacement-notion')?.addEventListener('click', () => {
  const id = data.studio?.databaseId || '3ec70655a9aa817099c5d877cdb5daa9';
  if (/^[a-f\d-]{32,36}$/i.test(id)) void call('replacements-open', 'https://app.notion.com/p/' + id.replaceAll('-', '') + '?v=3ec70655a9aa81d89903000c8ec87c4a').catch(error => replacementFailure(error.message));
});
$('#studio-products-notion')?.addEventListener('click', () => {
  const id = data.replacements?.databaseId || '3e070655a9aa816c98f4dc2c863fa5bb';
  if (/^[a-f\d-]{32,36}$/i.test(id)) void call('replacements-open', 'https://app.notion.com/p/' + id.replaceAll('-', '') + '?v=3e070655a9aa81f1a2a5000c1380d3f4').catch(error => replacementFailure(error.message));
});
$('#replacement-preview-article').addEventListener('click', () => {
  const plan = data.replacements?.plans.find(item => item.id === replacementPlanId), url = replacementUrl(plan?.articleUrl);
  if (url) void call('replacements-open', url).catch(error => replacementFailure(error.message));
});
$('#replacement-run').addEventListener('click', () => {
  const plan = data.replacements?.plans.find(item => item.id === replacementPlanId);
  if (!replacementCanRun(plan)) { replacementFailure('Bản xem trước không còn hợp lệ. Chuẩn bị lại trước khi chạy.'); return; }
  void replacementTask(async () => { await call('replacements-run', plan.id); toast('Đã kết thúc lượt cập nhật. Xem trạng thái xác minh trong bản chuẩn bị.'); });
});
setInterval(() => {
  const plan = data?.replacements?.plans.find(item => item.id === replacementPlanId);
  if (plan && ['prepared', 'ready'].includes(plan.status) && replacementExpiry(plan) <= Date.now() && $('#replacement-preview').dataset.expired !== 'true') renderReplacementPreview(plan);
}, 5000);
if (data) renderReplacements();
