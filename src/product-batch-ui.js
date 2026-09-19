// Drafts stay local; nothing is sent to Shopee until the reviewed list is run.
let batchDrafts={},batchReview=null,batchSubmitting=false;
try{const saved=JSON.parse(localStorage.getItem('product-batch-drafts')||'{}');if(saved&&typeof saved==='object'&&!Array.isArray(saved))batchDrafts=saved;}catch{}
const batchDraftKey=(id,field)=>id+':'+field;
function saveBatchDrafts(){try{localStorage.setItem('product-batch-drafts',JSON.stringify(batchDrafts));}catch{}}
function filteredBatchRows(){
 const profile=$('#product-profile').value,q=$('#product-search').value.toLocaleLowerCase('vi');
 return data.products.rows.filter(r=>(!profile||r.profileId===profile)&&[r.name,r.variant,r.productId,r.modelId,r.shop].join(' ').toLocaleLowerCase('vi').includes(q));
}
function renderBatchState(){
 const busy=data.products.busy||data.scanning||data.clearingNotion;
 $('#products-bulk').disabled=busy;
 $('#products-bulk').textContent='Sửa hàng loạt'+(Object.keys(batchDrafts).length?' · '+Object.keys(batchDrafts).length+' bản nháp':'');
 $('#batch-run').disabled=busy||batchSubmitting;
 $('#batch-close').disabled=batchSubmitting;
 const batch=data.products.batch;
 $('#batch-results').hidden=!batch;if(!batch)return;
 const labels={queued:'Chờ chạy',running:'Đang thực hiện',verified:'Đã lưu và xác minh','notion-pending':'Shopee đã lưu · Notion chờ ghi',failed:'Không thực hiện',uncertain:'Chưa xác minh · quét lại trước khi sửa',cancelled:'Chưa chạy',reconciled:'Đã quét kiểm tra lại'};
 const done=batch.items.filter(i=>!['queued','running'].includes(i.status)).length;
 $('#batch-summary').textContent=(batch.status==='running'?'Đang chạy':batch.status==='completed'?'Đã kết thúc':batch.status==='stopped'?'Đã dừng':'Lượt chạy bị gián đoạn')+' · '+done+'/'+batch.items.length+' thay đổi';
 $('#batch-stop').hidden=batch.status!=='running';$('#batch-stop').disabled=!!batch.stopRequested;$('#batch-stop').textContent=batch.stopRequested?'Đang chờ mục hiện tại kết thúc…':'Dừng sau mục hiện tại';
 $('#batch-progress').max=batch.items.length;$('#batch-progress').value=done;
 $('#batch-result-rows').innerHTML=batch.items.map(i=>'<tr><td>'+escape(i.shop)+'<small>'+escape(i.name)+' · '+escape(i.variant)+'</small></td><td>'+(i.field==='price'?'Giá':'Kho')+'<small>'+escape(i.expected)+' → '+escape(i.value)+'</small></td><td>'+escape(labels[i.status]||i.status)+'<small>'+escape(i.error||'')+'</small></td></tr>').join('');
}
function batchCount(){
 $('#batch-draft-count').textContent=Object.keys(batchDrafts).length+' thay đổi đã nhập · giữ bản nháp khi đổi bộ lọc hoặc mở lại app';renderBatchState();
}
function openBulk(){
 batchReview=null;$('#batch-entry').hidden=false;$('#batch-review').hidden=true;$('#batch-error').textContent='';
 const rows=filteredBatchRows();
 $('#batch-entry-rows').innerHTML=rows.map(r=>'<tr><td>'+escape(r.shop)+'<strong>'+escape(r.name)+'</strong><small>'+escape(r.variant||'Không phân loại')+' · ID '+escape(r.productId)+' · Model '+escape(r.modelId)+'</small>'+(!r.profileId?'<small>Chưa liên kết profile: tải dữ liệu Notion trước.</small>':'')+'</td>'+['price','stock'].map(field=>{
  const draft=batchDrafts[batchDraftKey(r.id,field)];
  return '<td><label><span>'+(field==='price'?'Giá mới (VND)':'Kho mới')+'</span><input type="number" step="1" min="'+(field==='price'?1:0)+'" max="1000000000" data-batch-id="'+escape(r.id)+'" data-batch-field="'+field+'" aria-label="'+escape((field==='price'?'Giá mới: ':'Kho mới: ')+r.name+' '+r.variant)+'" placeholder="Giữ nguyên" value="'+escape(draft?.value??'')+'" '+(!r.profileId?'disabled':'')+'></label><small>Hiện tại: '+escape(field==='price'?productMoney(r.price):r.stock)+'</small></td>';
 }).join('')+'</tr>').join('')||'<tr><td colspan="3">Không có sản phẩm khớp bộ lọc.</td></tr>';
 batchCount();$('#batch-dialog').showModal();
}
$('#products-bulk').addEventListener('click',openBulk);
$('#batch-close').addEventListener('click',()=>$('#batch-dialog').close());
$('#batch-clear').addEventListener('click',()=>{batchDrafts={};saveBatchDrafts();$('#batch-entry-rows').querySelectorAll('input').forEach(e=>e.value='');batchCount();});
$('#batch-entry-rows').addEventListener('input',e=>{
 const input=e.target;if(!input.dataset.batchId)return;
 const row=data.products.rows.find(r=>r.id===input.dataset.batchId),field=input.dataset.batchField,k=batchDraftKey(row.id,field);
 if(input.value===''||Number(input.value)===row[field])delete batchDrafts[k];
 else batchDrafts[k]={id:row.id,field,expected:batchDrafts[k]?.expected??row[field],value:input.value,shop:row.shop,name:row.name,variant:row.variant,productId:row.productId,modelId:row.modelId};
 saveBatchDrafts();batchCount();
});
$('#batch-entry').addEventListener('submit',e=>{
 e.preventDefault();const drafts=Object.values(batchDrafts);$('#batch-error').textContent='';
 try{
  if(!drafts.length)throw Error('Nhập ít nhất một giá hoặc tồn kho mới. Ô để trống sẽ giữ nguyên.');
  batchReview=drafts.map(d=>{
   const row=data.products.rows.find(r=>r.id===d.id),value=Number(d.value);
   if(!row?.profileId||row.shop!==d.shop||row.productId!==d.productId||row.modelId!==d.modelId)throw Error('Bản nháp không còn khớp dữ liệu: '+d.name+'. Xoá bản nháp rồi nhập lại.');
   if(row[d.field]!==d.expected)throw Error('Giá/kho đã thay đổi: '+d.name+'. Xoá bản nháp rồi nhập lại.');
   if(!['price','stock'].includes(d.field)||!Number.isSafeInteger(value)||value<(d.field==='price'?1:0)||value>1000000000)throw Error('Giá/kho không hợp lệ: '+d.name);
   return {...d,value};
  });
  $('#batch-review-rows').innerHTML=batchReview.map(i=>'<tr><td>'+escape(i.shop)+'<strong>'+escape(i.name)+'</strong><small>'+escape(i.variant||'Không phân loại')+'</small></td><td>'+(i.field==='price'?'Giá':'Kho')+'</td><td>'+escape(i.expected)+'</td><td><strong>'+escape(i.value)+'</strong></td></tr>').join('');
  $('#batch-run').textContent='Chạy '+batchReview.length+' thay đổi';$('#batch-entry').hidden=true;$('#batch-review').hidden=false;
 }catch(error){$('#batch-error').textContent=error.message;}
});
$('#batch-back').addEventListener('click',()=>{$('#batch-entry').hidden=false;$('#batch-review').hidden=true;});
$('#batch-run').addEventListener('click',async()=>{
 if(batchSubmitting||!batchReview)return;batchSubmitting=true;renderBatchState();const submitted=batchReview.map(r=>({...r}));
 const requestId=crypto.randomUUID();
 try{
  const result=await window.srm.call('products-edit-batch',{requestId,items:submitted.map(({id,field,expected,value})=>({id,field,expected,value}))});
  for(const i of submitted)delete batchDrafts[batchDraftKey(i.id,i.field)];saveBatchDrafts();$('#batch-dialog').close();
  const failed=result.items.filter(i=>['failed','uncertain','cancelled'].includes(i.status)).length;
  toast('Lượt sửa đã kết thúc. '+(failed?failed+' mục chưa hoàn tất; xem Kết quả sửa hàng loạt.':'Xem kết quả từng mục bên dưới.'),!!failed);
 }catch(error){$('#batch-error').textContent=error.message;if(!$('#batch-dialog').open)toast(error.message,true);}
 finally{batchSubmitting=false;renderBatchState();}
});
// Close the editor as soon as the server accepts the run. Live results are on
// the product screen, and reopening the app never replays a submitted list.
window.srm.subscribe(snapshot=>{
 if(batchSubmitting&&snapshot.products.batch?.status==='running'&&$('#batch-dialog').open){
  for(const i of batchReview||[])delete batchDrafts[batchDraftKey(i.id,i.field)];saveBatchDrafts();$('#batch-dialog').close();
 }
});
$('#batch-dialog').addEventListener('cancel',e=>{if(batchSubmitting)e.preventDefault();});
$('#batch-stop').addEventListener('click',()=>call('products-stop-batch').catch(()=>{}));
