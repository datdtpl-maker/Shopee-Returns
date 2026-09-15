const $=s=>document.querySelector(s);let data=null;let settingsLoaded=false;let toastTimer;
let groupShipping=false;
try{groupShipping=localStorage.getItem('group-shipping')==='true';}catch{}
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=s=>s?new Date(s).toLocaleString('vi-VN'):'Chưa quét';
const states={new:'Chưa xử lý',shipper:'Đã báo shipper gửi lại hàng',received:'Đã nhận lại hàng'};
const matchLabels={matched:'Đã khớp Sheet',not_found:'Chưa có trong Sheet',missing_tracking:'Sheet thiếu mã vận đơn',conflict:'Cần kiểm tra Sheet',pending:'Chưa đối chiếu'};
function toast(text,error=false){$('#toast').textContent=text;$('#toast').className='toast'+(error?' error':'');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.add('hidden'),6500);}
async function call(name,...args){try{return await window.srm.call(name,...args);}catch(e){toast(e.message,true);throw e;}}
function tab(id){document.querySelectorAll('.view').forEach(e=>e.classList.toggle('hidden',e.id!==id));document.querySelectorAll('nav [data-tab]').forEach(e=>e.classList.toggle('active',e.dataset.tab===id));$('#crumb').textContent={orders:'Đơn hoàn / huỷ',profiles:'Profile Shopee',activity:'Lịch sử quét',settings:'Cài đặt kết nối'}[id];}
function render(snapshot){data=snapshot;const d=data;
  $('#total').textContent=d.orders.length;$('#nav-count').textContent=d.orders.length;
  for(const s of ['new','shipper','received']) $('#'+s+'-count').textContent=d.orders.filter(o=>o.state===s).length;
  $('#schedule-label').textContent=d.scanning?'Đang đọc dữ liệu Shopee…':d.nextScan?'Lượt tiếp theo · '+time(d.nextScan):'Quét tự động đang tắt';
  $('#scan-all').disabled=d.scanning||d.clearingNotion||d.notionClearPending;
  document.querySelectorAll('[data-clear-notion]').forEach(b=>{b.disabled=d.scanning||d.clearingNotion;b.textContent=d.clearingNotion?'Đang xoá Notion…':d.notionClearPending?'Thử lại xoá Notion':'Xoá dữ liệu Notion';});
  if(d.notionAwaitScan||d.notionClearPending)$('#schedule-label').textContent=d.notionClearPending?'Xoá Notion chưa hoàn tất · cần thử lại':'Notion đã xoá · bấm Quét ngay để ghi mới';$('#scan-all').textContent=d.scanning?'Đang quét…':'Quét ngay ↻';
  const current=$('#profile-filter').value;$('#profile-filter').innerHTML='<option value="">Tất cả profile</option>'+d.profiles.map(p=>`<option value="${p.id}">${escape(p.name)}</option>`).join('');$('#profile-filter').value=current;
  $('#latest-scan').textContent=d.profiles.some(p=>p.lastScan)?'Quét gần nhất · '+time(d.profiles.map(p=>p.lastScan).filter(Boolean).sort().at(-1)):'Chưa có lượt quét';
  $('#profile-list').innerHTML=d.profiles.map(p=>`<article class="panel profile-card"><div class="profile-top"><div class="profile-avatar">${escape(p.name[0].toUpperCase())}</div><div><h2>${escape(p.name)}</h2><span class="subtle">${escape(p.status)}</span></div><label class="check"><input type="checkbox" data-enable="${p.id}" ${p.enabled?'checked':''} aria-label="Bật quét ${escape(p.name)}"> Bật</label></div><dl><div><dt>Quét gần nhất</dt><dd>${time(p.lastScan)}</dd></div><div><dt>Đơn đỏ / xanh</dt><dd>${p.lastCount}</dd></div></dl><div class="button-row"><button type="button" data-rename="${p.id}" ${d.scanning||d.clearingNotion?'disabled':''}>Sửa tên</button><button data-login="${p.id}" ${d.scanning?'disabled':''}>Mở đăng nhập Shopee ↗</button><button class="primary" data-scan="${p.id}" ${d.scanning?'disabled':''}>Quét profile</button></div></article>`).join('')||'<div class="empty panel"><h3>Chưa có profile</h3><p>Đặt tên tài khoản ở trên để bắt đầu.</p></div>';
  $('#log-list').innerHTML=d.logs.map(l=>`<div class="log"><span class="badge ${l.level}">${{success:'Thành công',warning:'Cần kiểm tra',error:'Có lỗi'}[l.level]||'Thông tin'}</span><div>${escape(l.message)}<small>${time(l.at)}</small></div></div>`).join('')||'<div class="empty"><h3>Chưa có hoạt động</h3><p>Kết quả quét sẽ được ghi tại đây.</p></div>';
  $('#notion-status').textContent='Notion · '+(d.settings.notionEnabled?(d.settings.notionDatabaseId?'Đang bật đồng bộ':'Chờ tạo bảng'):'Đang tắt');
  $('#telegram-status').textContent='Telegram · '+(d.settings.telegramEnabled?'Đang bật gửi':'Chưa bật');
  $('#sheet-status').textContent=d.sheet?.error?'Sheet · Lỗi đọc, không dùng kết quả cũ':`Đủ mã đơn + mã vận đơn · ${d.orders.length} đơn`;
  $('#sheet-detail').textContent=d.sheet?.error|| (d.sheet?.checkedAt?`Đã đọc ${d.sheet.rowCount} dòng · ${time(d.sheet.checkedAt)} · ${d.sheet.conflicts} đơn cần kiểm tra`:'Đọc Mã đơn hàng, Mã vận đơn và Tình trạng từ trang tính.');
  $('#scan-status').textContent=d.scanning?'Đang đọc mới Shopee và Sheet…':d.jobs.errors?`${d.jobs.errors} lần đồng bộ lỗi đang chờ thử lại`:`Chỉ hiện đơn khớp chính xác, đủ mã vận đơn · ${d.hiddenOrders||0} đơn lưu chưa đủ điều kiện hiện tại`;
  $('#empty h3').textContent=d.scanning?'Đang đối chiếu dữ liệu mới':'Chưa có đơn đủ điều kiện hiển thị';
  $('#empty p').textContent='Chỉ hiển thị khi mã đơn Shopee khớp chính xác một mã vận đơn hợp lệ trong Sheet ở lượt quét mới. Bấm Quét ngay để kiểm tra lại.';
  if(!settingsLoaded){$('#interval').value=d.settings.intervalMinutes;$('#auto-scan').checked=d.settings.autoScan;$('#chat-id').value=d.settings.chatId;$('#telegram-enabled').checked=d.settings.telegramEnabled;$('#notion-enabled').checked=d.settings.notionEnabled;$('#sheet-url').value=d.settings.sheetUrl;settingsLoaded=true;}
  $('#notion-saved').textContent=d.credentials.notion?'Đã lưu token mã hoá.':'Chưa lưu token.';$('#telegram-saved').textContent=d.credentials.telegram?'Đã lưu token mã hoá.':'Chưa lưu token.';
  renderOrders();
}
function renderOrders(){if(!data)return;const search=$('#search').value.toLowerCase();const profile=$('#profile-filter').value;const state=$('#state-filter').value;
  const orders=data.orders.filter(o=>(!profile||o.profileId===profile)&&(!state||o.state===state)&&[o.orderId,...(o.trackingNumbers||[])].some(v=>v.toLowerCase().includes(search)));
  $('#result-count').textContent=orders.length;$('#empty').classList.toggle('hidden',data.orders.length>0);
  const renderRow=o=>`<tr><td><strong class="order-id">${escape(o.orderId)}</strong><small>${escape(o.profileName)}</small><small>Shopee · ${time(o.lastSeen)}</small></td><td class="tracking-cell">${(o.trackingNumbers||[]).map(n=>`<strong class="order-id">${escape(n)}</strong>`).join('<br>')||'—'}<small class="${o.sheetMatch==='matched'?'match-ok':'match-warn'}">${matchLabels[o.sheetMatch]||matchLabels.pending}</small>${o.sheetStatus?`<small>${escape(o.sheetStatus)}</small>`:''}</td><td><span class="badge ${o.color}">${escape(o.shippingText)}</span>${o.orderStatus?`<small>${escape(o.orderStatus)}</small>`:''}</td><td><span class="process ${o.state}">${states[o.state]}</span></td><td><small>Notion · ${!data.settings.notionEnabled?'Đang tắt':(o.notionSyncedRevision===o.revision&&o.notionVerifiedAt===o.sheetCheckedAt)?'Đã lưu':'Chờ đồng bộ'}</small><small>Telegram · ${!data.settings.telegramEnabled?'Đang tắt':o.telegramSentAt?'Đã gửi':'Chờ gửi'}</small></td><td><div class="actions"><button data-order="${o.id}" data-state="shipper" ${o.state!=='new'?'disabled':''}>Đã báo shipper gửi lại hàng</button><button data-order="${o.id}" data-state="received" ${o.state==='received'?'disabled':''}>Đã nhận lại hàng</button></div></td></tr>`;
  const toggle=$('#group-shipping');
  toggle.setAttribute('aria-pressed',String(groupShipping));
  toggle.classList.toggle('is-active',groupShipping);
  toggle.textContent=groupShipping?'Bỏ gom nhóm vận chuyển':'Gom nhóm vận chuyển';
  let html;
  if(groupShipping){
    const groups=new Map();
    for(const order of orders){
      const status=order.shippingText;
      if(!groups.has(status))groups.set(status,[]);
      groups.get(status).push(order);
    }
    html=[...groups.entries()].sort(([a],[b])=>a.localeCompare(b,'vi')).map(([status,items])=>
      `<tr class="shipping-group"><th colspan="6"><span class="badge ${items[0].color}">${escape(status)}</span><span class="group-count">${items.length} đơn</span></th></tr>`+items.map(renderRow).join('')
    ).join('');
  }else html=orders.map(renderRow).join('');
  $('#order-rows').innerHTML=html||(data.orders.length?'<tr><td colspan="6" class="no-results">Không có đơn khớp bộ lọc.</td></tr>':'');
}
document.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;
  try {if(b.dataset.tab)tab(b.dataset.tab);
    else if(b.hasAttribute('data-clear-notion')){const result=await call('clear-notion');if(!result.cancelled)toast(`Đã xoá ${result.archived} bản ghi Notion. Bấm Quét ngay để ghi dữ liệu mới.`);}
    else if(b.dataset.rename){const p=data.profiles.find(p=>p.id===b.dataset.rename);if(!p)return;$('#rename-form').dataset.profileId=p.id;$('#rename-name').value=p.name;$('#rename-error').textContent='';$('#rename-dialog').showModal();$('#rename-name').focus();$('#rename-name').select();}
    else if(b.dataset.login){b.disabled=true;await call('login',b.dataset.login);toast('Đã mở profile. Bạn đăng nhập Shopee trong cửa sổ Chrome.');}
    else if(b.dataset.scan){await call('scan',b.dataset.scan);toast('Lượt quét đã kết thúc. Xem kết quả và nhật ký.');}
    else if(b.dataset.order){b.disabled=true;await call('order-state',b.dataset.order,b.dataset.state);toast('Đã lưu trạng thái. Notion sẽ đồng bộ khi kết nối đang bật.');}
  }catch{if(b.dataset.order)renderOrders();}finally{if(b.isConnected&&!b.dataset.order&&!b.dataset.scan)b.disabled=false;}
});
$('#rename-cancel').addEventListener('click',()=>$('#rename-dialog').close());
$('#rename-form').addEventListener('submit',async e=>{
  e.preventDefault();const b=$('#rename-save');b.disabled=true;$('#rename-error').textContent='';
  try{await window.srm.call('rename-profile',e.currentTarget.dataset.profileId,$('#rename-name').value);$('#rename-dialog').close();toast('Đã đổi tên profile.');}
  catch(error){$('#rename-error').textContent=error.message;}
  finally{b.disabled=false;}
});
$('#rename-dialog').addEventListener('close',()=>{document.querySelector('[data-rename="'+$('#rename-form').dataset.profileId+'"]')?.focus();});
$('#profile-form').addEventListener('submit',async e=>{e.preventDefault();try{await call('add-profile',$('#profile-name').value);$('#profile-name').value='';toast('Đã thêm profile. Bấm Mở đăng nhập Shopee để đăng nhập.');}catch{}});
document.addEventListener('change',async e=>{if(e.target.dataset.enable)try{await call('toggle-profile',e.target.dataset.enable,e.target.checked);}catch{}});
for(const id of ['search','profile-filter','state-filter']) $('#'+id).addEventListener('input',renderOrders);
$('#group-shipping').addEventListener('click',()=>{
  groupShipping=!groupShipping;
  try{localStorage.setItem('group-shipping',String(groupShipping));}catch{}
  renderOrders();
});
$('#scan-all').addEventListener('click',async()=>{try{await call('scan');toast('Lượt quét đã kết thúc. Xem kết quả và nhật ký.');}catch{}});
$('#settings-form').addEventListener('submit',async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{await call('settings',{intervalMinutes:$('#interval').value,autoScan:$('#auto-scan').checked,chatId:$('#chat-id').value,sheetUrl:$('#sheet-url').value,telegramEnabled:$('#telegram-enabled').checked,notionEnabled:$('#notion-enabled').checked,notionToken:$('#notion-token').value,telegramToken:$('#telegram-token').value});$('#notion-token').value='';$('#telegram-token').value='';toast('Đã lưu cài đặt.');}catch{}finally{b.disabled=false;}});
$('#connect-notion').addEventListener('click',async e=>{e.target.disabled=true;try{await call('connect-notion');toast('Notion đã sẵn sàng.');}catch{}finally{e.target.disabled=false;}});
$('#open-notion').addEventListener('click',()=>call('open-notion').catch(()=>{}));
$('#open-sheet').addEventListener('click',()=>call('open-sheet').catch(()=>{}));
$('#refresh-sheet').addEventListener('click',async e=>{e.target.disabled=true;try{await call('refresh-sheet');toast('Đã đối chiếu Google Sheet.');}catch{}finally{e.target.disabled=false;}});
$('#retry').addEventListener('click',()=>call('retry').then(()=>toast('Đang thử lại các mục chờ đồng bộ.')).catch(()=>{}));
window.srm.subscribe(render);call('snapshot').then(render).catch(()=>{});


