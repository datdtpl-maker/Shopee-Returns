const $=s=>document.querySelector(s);let data=null;let settingsLoaded=false;let toastTimer;
let groupShipping=false;
try{groupShipping=localStorage.getItem('group-shipping')==='true';}catch{}
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=s=>s?new Date(s).toLocaleString('vi-VN'):'Chưa quét';
const matchLabels={matched:'Đã khớp Sheet',not_found:'Chưa có trong Sheet',missing_tracking:'Sheet thiếu mã vận đơn',conflict:'Cần kiểm tra Sheet',pending:'Chưa đối chiếu'};
function toast(text,error=false){$('#toast').textContent=text;$('#toast').className='toast'+(error?' error':'');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.add('hidden'),6500);}
async function call(name,...args){try{return await window.srm.call(name,...args);}catch(e){toast(e.message,true);throw e;}}
function tab(id){document.querySelectorAll('.view').forEach(e=>e.classList.toggle('hidden',e.id!==id));document.querySelectorAll('nav [data-tab]').forEach(e=>e.classList.toggle('active',e.dataset.tab===id));$('#crumb').textContent={orders:'Đơn hoàn / huỷ',profiles:'Profile Shopee',products:'Kho sản phẩm',activity:'Lịch sử quét',settings:'Cài đặt kết nối'}[id];}
function render(snapshot){data=snapshot;const d=data;
  $('#total').textContent=d.orders.length;$('#nav-count').textContent=d.orders.length;
  $('#schedule-label').textContent=d.scanning?'Đang đọc dữ liệu Shopee…':d.nextScan?'Lượt tiếp theo · '+time(d.nextScan):'Quét tự động đang tắt';
  $('#scan-all').disabled=d.scanning||d.clearingNotion||d.notionClearPending||d.products?.busy;
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
  if(!settingsLoaded){$('#interval').value=d.settings.intervalMinutes;$('#notion-page').value=d.settings.notionPageId;$('#notion-database').value=d.settings.notionDatabaseId;for(const [id,key] of [['start-windows','startWithWindows'],['keep-awake','keepAwake'],['close-tray','closeToTray']])$('#'+id).checked=!!d.settings[key];$('#auto-scan').checked=d.settings.autoScan;$('#chat-id').value=d.settings.chatId;$('#telegram-enabled').checked=d.settings.telegramEnabled;$('#notion-enabled').checked=d.settings.notionEnabled;$('#sheet-url').value=d.settings.sheetUrl;settingsLoaded=true;}
  $('#data-location').textContent=d.dataDir;$('#app-version').textContent='PHIÊN BẢN '+d.version;
  $('#notion-saved').textContent=d.credentials.notion?'Đã lưu token mã hoá.':'Chưa lưu token.';$('#telegram-saved').textContent=d.credentials.telegram?'Đã lưu token mã hoá.':'Chưa lưu token.';
  renderOrders();renderProducts();if(typeof renderBatchState==='function')renderBatchState();
}
function renderOrders(){if(!data)return;const search=$('#search').value.toLowerCase();const profile=$('#profile-filter').value;
  const orders=data.orders.filter(o=>(!profile||o.profileId===profile)&&[o.orderId,...(o.trackingNumbers||[])].some(v=>v.toLowerCase().includes(search)));
  $('#result-count').textContent=orders.length;$('#empty').classList.toggle('hidden',data.orders.length>0);
  const renderRow=o=>`<tr><td><strong class="order-id">${escape(o.orderId)}</strong><small>${escape(o.profileName)}</small><small>Shopee · ${time(o.lastSeen)}</small></td><td class="tracking-cell">${(o.trackingNumbers||[]).map(n=>`<strong class="order-id">${escape(n)}</strong>`).join('<br>')||'—'}<small class="${o.sheetMatch==='matched'?'match-ok':'match-warn'}">${matchLabels[o.sheetMatch]||matchLabels.pending}</small>${o.sheetStatus?`<small>${escape(o.sheetStatus)}</small>`:''}</td><td><span class="badge ${o.color}">${escape(o.shippingText)}</span>${o.orderStatus?`<small>${escape(o.orderStatus)}</small>`:''}</td><td><small>Notion · ${!data.settings.notionEnabled?'Đang tắt':(o.notionSyncedRevision===o.revision&&o.notionVerifiedAt===o.sheetCheckedAt)?'Đã có trên Notion':'Chờ kiểm tra'}</small><small>Telegram · ${!data.settings.telegramEnabled?'Đang tắt':o.telegramSentAt?'Đã gửi':'Chờ gửi'}</small></td></tr>`;
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
      `<tr class="shipping-group"><th colspan="4"><span class="badge ${items[0].color}">${escape(status)}</span><span class="group-count">${items.length} đơn</span></th></tr>`+items.map(renderRow).join('')
    ).join('');
  }else html=orders.map(renderRow).join('');
  $('#order-rows').innerHTML=html||(data.orders.length?'<tr><td colspan="4" class="no-results">Không có đơn khớp bộ lọc.</td></tr>':'');
}
document.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;
  try {if(b.dataset.tab)tab(b.dataset.tab);
    else if(b.hasAttribute('data-clear-notion')){const result=await call('clear-notion');if(!result.cancelled)toast(`Đã xoá ${result.archived} bản ghi Notion. Bấm Quét ngay để ghi dữ liệu mới.`);}
    else if(b.dataset.rename){const p=data.profiles.find(p=>p.id===b.dataset.rename);if(!p)return;$('#rename-form').dataset.profileId=p.id;$('#rename-name').value=p.name;$('#rename-error').textContent='';$('#rename-dialog').showModal();$('#rename-name').focus();$('#rename-name').select();}
    else if(b.dataset.login){b.disabled=true;await call('login',b.dataset.login);toast('Đã mở profile. Bạn đăng nhập Shopee trong cửa sổ Chrome.');}
    else if(b.dataset.scan){await call('scan',b.dataset.scan);toast('Lượt quét đã kết thúc. Xem kết quả và nhật ký.');}
  }catch{}finally{if(b.isConnected&&!b.dataset.scan)b.disabled=false;}
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
for(const id of ['search','profile-filter']) $('#'+id).addEventListener('input',renderOrders);
$('#group-shipping').addEventListener('click',()=>{
  groupShipping=!groupShipping;
  try{localStorage.setItem('group-shipping',String(groupShipping));}catch{}
  renderOrders();
});
$('#scan-all').addEventListener('click',async()=>{try{await call('scan');toast('Lượt quét đã kết thúc. Xem kết quả và nhật ký.');}catch{}});
$('#settings-form').addEventListener('submit',async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{await call('settings',{notionPageId:$('#notion-page').value,notionDatabaseId:$('#notion-database').value,startWithWindows:$('#start-windows').checked,keepAwake:$('#keep-awake').checked,closeToTray:$('#close-tray').checked,intervalMinutes:$('#interval').value,autoScan:$('#auto-scan').checked,chatId:$('#chat-id').value,sheetUrl:$('#sheet-url').value,telegramEnabled:$('#telegram-enabled').checked,notionEnabled:$('#notion-enabled').checked,notionToken:$('#notion-token').value,telegramToken:$('#telegram-token').value});$('#notion-token').value='';$('#telegram-token').value='';toast('Đã lưu cài đặt.');}catch{}finally{b.disabled=false;}});
$('#connect-notion').addEventListener('click',async e=>{e.target.disabled=true;try{await call('connect-notion');toast('Notion đã sẵn sàng.');}catch{}finally{e.target.disabled=false;}});
$('#open-notion').addEventListener('click',()=>call('open-notion').catch(()=>{}));
$('#open-sheet').addEventListener('click',()=>call('open-sheet').catch(()=>{}));
$('#refresh-sheet').addEventListener('click',async e=>{e.target.disabled=true;try{await call('refresh-sheet');toast('Đã đối chiếu Google Sheet.');}catch{}finally{e.target.disabled=false;}});
$('#retry').addEventListener('click',()=>call('retry').then(()=>toast('Đang thử lại các mục chờ đồng bộ.')).catch(()=>{}));
window.srm.subscribe(render);call('snapshot').then(render).catch(()=>{});



$('#open-data').addEventListener('click',()=>call('open-data').catch(()=>{}));
$('#import-config').addEventListener('click',async()=>{try{const r=await call('import-config');if(!r.cancelled){settingsLoaded=false;render(await call('snapshot'));toast('Đã nhập cấu hình. Token được lưu mã hoá trên máy này.');}}catch{}});

const productMoney=n=>Number(n).toLocaleString('vi-VN')+' ₫';
function renderProducts(){
 const p=data.products;if(!p)return;const current=$('#product-profile').value;
 $('#product-profile').innerHTML='<option value="">Tất cả profile đang bật</option>'+data.profiles.map(r=>'<option value="'+escape(r.id)+'">'+escape(r.name)+'</option>').join('');$('#product-profile').value=current;
 const q=$('#product-search').value.toLocaleLowerCase('vi');const rows=p.rows.filter(r=>(!current||r.profileId===current)&&[r.name,r.variant,r.productId,r.modelId,r.shop].join(' ').toLocaleLowerCase('vi').includes(q));
 $('#product-count').textContent=rows.length;$('#product-loaded').textContent=p.loadedAt?'Đọc dữ liệu · '+time(p.loadedAt):'';
 $('#product-progress').textContent=p.progress||'Bấm Quét Shopee để đọc toàn bộ sản phẩm và liên kết shop với profile.';
 const busy=p.busy||data.scanning||data.clearingNotion;for(const id of ['products-scan','products-load','products-sync'])$('#'+id).disabled=busy;
 $('#product-rows').innerHTML=rows.map(r=>'<tr><td>'+escape(r.shop)+'</td><td><strong>'+escape(r.name)+'</strong><small>'+escape(r.variant||'Không phân loại')+'</small><small>ID '+escape(r.productId)+' · Model '+escape(r.modelId)+'</small></td><td>'+productMoney(r.price)+'</td><td>'+r.stock+'</td><td><small>'+escape(r.sync==='synced'?'Đã có trên Notion':'Chờ ghi Notion')+'</small><small>'+escape(r.error||'')+'</small></td><td><div class="button-row"><button data-product="'+r.id+'" data-field="price" '+(busy||!r.profileId?'disabled':'')+'>Sửa giá</button><button data-product="'+r.id+'" data-field="stock" '+(busy||!r.profileId?'disabled':'')+'>Sửa kho</button></div></td></tr>').join('')||'<tr><td colspan="6" class="no-results">Chưa có sản phẩm phù hợp. Quét Shopee hoặc tải dữ liệu từ Notion.</td></tr>';
 const labels={preparing:'Đang kiểm tra',submitted:'Đã gửi, chờ xác minh',verified:'Đã xác minh',failed:'Không thực hiện',uncertain:'Chưa xác minh · cần quét lại',reconciled:'Đã quét kiểm tra lại','notion-pending':'Shopee đã lưu · Notion chờ ghi'};
 $('#product-actions').innerHTML=p.actions.slice(0,8).map(a=>'<p class="product-action">'+escape(a.name)+' · '+escape(a.variant)+' · '+(a.field==='price'?'Giá':'Kho')+': '+a.expected+' → '+a.value+' · <strong>'+escape(labels[a.status]||a.status)+'</strong><small>'+time(a.at)+' '+escape(a.error||'')+'</small></p>').join('')||'<p class="subtle">Chưa có thao tác sửa giá hoặc kho.</p>';
}
for(const id of ['product-search','product-profile'])$('#'+id).addEventListener('input',renderProducts);
for(const action of ['scan','load','sync'])$('#products-'+action).addEventListener('click',async()=>{try{await call('products-'+action,...(action==='scan'?[$('#product-profile').value||null]:[]));toast('Đã hoàn tất thao tác sản phẩm.');}catch{}});
$('#products-notion').addEventListener('click',()=>call('products-notion').catch(()=>{}));
document.addEventListener('click',e=>{const b=e.target.closest('[data-product]');if(!b)return;const r=data.products.rows.find(r=>r.id===b.dataset.product);if(!r)return;
 const form=$('#product-edit-form');form.dataset.id=r.id;form.dataset.field=b.dataset.field;form.dataset.expected=String(r[b.dataset.field]);
 $('#product-edit-title').textContent=b.dataset.field==='price'?'Sửa giá bán':'Sửa kho hàng';$('#product-edit-name').textContent=r.shop+' · '+r.name+(r.variant?' · '+r.variant:'');
 $('#product-edit-old').textContent='Giá trị đang hiển thị: '+(b.dataset.field==='price'?productMoney(r.price):r.stock);$('#product-value-label').textContent=b.dataset.field==='price'?'Giá mới (VND)':'Tồn kho mới';$('#product-value').min=b.dataset.field==='price'?'1':'0';$('#product-value').value=r[b.dataset.field];$('#product-edit-error').textContent='';$('#product-dialog').showModal();$('#product-value').focus();$('#product-value').select();
});
$('#product-edit-cancel').addEventListener('click',()=>$('#product-dialog').close());
$('#product-dialog').addEventListener('cancel',e=>{if($('#product-edit-save').disabled)e.preventDefault();});
$('#product-edit-form').addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget;$('#product-edit-save').disabled=true;$('#product-edit-cancel').disabled=true;$('#product-edit-error').textContent='Đang đọc lại Shopee và xác minh…';
 try{const r=await window.srm.call('products-edit',form.dataset.id,{field:form.dataset.field,expected:Number(form.dataset.expected),value:Number($('#product-value').value)});$('#product-dialog').close();toast(r.message,r.notionPending);}
 catch(error){$('#product-edit-error').textContent=error.message;}finally{$('#product-edit-save').disabled=false;$('#product-edit-cancel').disabled=false;}
});
