function renderInterfaceHealth(){
 const records=[...(data.interfaces||[])];
 for(const profile of data.profiles)for(const module of ['returns','products'])if(!records.some(r=>r.profileId===profile.id&&r.module===module&&r.stage==='list'))records.push({id:profile.id+':'+module+':list',profileId:profile.id,module,stage:'list',status:'unknown',issues:[]});
 const changed=records.filter(r=>r.status==='changed').length,unavailable=records.filter(r=>r.status==='unavailable').length,unknown=records.filter(r=>r.status==='unknown').length;
 const status=changed?'changed':unavailable?'unavailable':unknown||!records.length?'unknown':'ok';
 $('#interface-health').className='interface-health '+status;
 $('#interface-summary').textContent=changed?changed+' cảnh báo đỏ · luồng bị ảnh hưởng sẽ dừng để kiểm tra':unavailable?unavailable+' mục chưa kiểm tra được · xem đăng nhập / mạng':unknown||!records.length?'Chưa có mẫu cho '+(unknown||'các')+' mục · kiểm tra để tạo mẫu đầu tiên':'Các thành phần đã kiểm tra đang phù hợp với mẫu';
 const busy=data.scanning||data.products.busy||data.clearingNotion;$('#interfaces-check').disabled=busy;
 const names={list:'Danh sách','page-size':'Chọn 48 sản phẩm/trang','price-single':'Sửa giá · đơn','price-multi':'Sửa giá · phân loại','stock-single':'Sửa kho · đơn','stock-multi':'Sửa kho · phân loại'};
 const labels={changed:'CẢNH BÁO GIAO DIỆN',unavailable:'CHƯA KIỂM TRA ĐƯỢC',unknown:'CHƯA CÓ MẪU',ok:'PHÙ HỢP MẪU'};
 $('#interface-records').innerHTML=records.map(r=>'<article class="interface-record '+r.status+'"><div><strong>'+escape(data.profiles.find(p=>p.id===r.profileId)?.name||r.profileId)+' · '+(r.module==='returns'?'Hoàn huỷ':'Sản phẩm')+' · '+escape(names[r.stage]||r.stage)+'</strong><span class="interface-label">'+labels[r.status]+'</span></div><small>'+escape(r.checkedAt?'Kiểm tra: '+time(r.checkedAt):'Chưa kiểm tra')+'</small>'+(r.issues?.length?'<ul>'+r.issues.slice(0,8).map(issue=>'<li>'+escape(issue)+'</li>').join('')+'</ul>':'')+'<div class="button-row">'+(r.report?'<button data-interface-report="'+escape(r.id)+'">Mở báo cáo / ảnh</button>':'')+(r.canAccept?'<button data-interface-accept="'+escape(r.id)+'" '+(busy?'disabled':'')+'>Chấp nhận mẫu đã kiểm tra</button>':'')+'</div></article>').join('')||'<p>Thêm profile Shopee để bắt đầu kiểm tra.</p>';
}
$('#interfaces-check').addEventListener('click',()=>call('interfaces-check').then(()=>toast('Đã kiểm tra. Xem kết quả theo shop và module.')).catch(()=>{}));
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.interfaceReport)void call('interfaces-report',b.dataset.interfaceReport).catch(()=>{});if(b.dataset.interfaceAccept)void call('interfaces-accept',b.dataset.interfaceAccept).catch(()=>{});});
