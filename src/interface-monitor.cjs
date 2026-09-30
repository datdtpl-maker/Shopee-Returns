const fs=require('node:fs');const path=require('node:path');const {createHash}=require('node:crypto');
// Browser-side structural probe. Only allowlisted DOM/CSS metadata crosses this
// boundary: no full HTML, scripts, cookies, form values or network responses.
function inspectInterface({module,stage,deep=false}){
 const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
 const visible=e=>!!e&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
 const all=s=>[...document.querySelectorAll(s)],first=s=>all(s).find(visible),body=clean(document.body?.innerText);
 const result={module,stage,issues:[],features:{},palette:{},empty:false,availability:'ready'};
 if(/\/(signin|login)(\/|$)/i.test(location.pathname)||/^accounts?\./i.test(location.hostname)||first('input[type="password"]')||all('iframe[src*="captcha"]').some(visible)){
  result.availability='login';return result;
 }
 if(body.length<10||/ERR_(INTERNET|CONNECTION|NAME)|Không có kết nối Internet/.test(body)){
  result.availability='loading';return result;
 }
 const problem=s=>{if(!result.issues.includes(s)&&result.issues.length<25)result.issues.push(s);};
 const feature=(name,selector,{scope=document,required=true,visual=false}={})=>{
  const e=[...scope.querySelectorAll(selector)].find(visible);
  if(!e){if(required)problem('Thiếu hoặc bị ẩn: '+name+' ('+selector+')');return;}
  const css=getComputedStyle(e);result.features[name]={tag:e.tagName,display:css.display,...(visual?{color:css.color,fontSize:css.fontSize,fontWeight:css.fontWeight}: {})};return e;
 };
 if(module==='returns'){
  const heading=all('.header-text').find(e=>visible(e)&&clean(e.textContent)==='Vận chuyển chiều giao hàng');
  if(!heading)problem('Không tìm thấy tiêu đề Vận chuyển chiều giao hàng (.header-text).');
  else{const s=getComputedStyle(heading);result.features.shippingHeading={tag:heading.tagName,display:s.display,color:s.color,fontSize:s.fontSize,fontWeight:s.fontWeight};}
  const rows=all('.return-table-content .return-row-item');
  result.empty=!rows.length&&/Không có (yêu cầu|dữ liệu|đơn hàng)|Chưa có (yêu cầu|đơn hàng)|Không tìm thấy (yêu cầu|đơn hàng|kết quả)/i.test(body);
  if(!rows.length&&!result.empty)problem('Không đọc được dòng đơn hoàn/huỷ hoặc thông báo danh sách trống.');
  for(const row of rows){
   if(!/^[A-Z0-9]{8,30}$/.test(clean(row.querySelector('.order-id .id-content')?.textContent)))problem('Mã đơn không còn ở .order-id .id-content hoặc sai định dạng.');
   const column=row.querySelector('.item-logistics.item-forward-logistic');if(!column){problem('Thiếu cột vận chuyển chiều giao hàng .item-forward-logistic.');continue;}
   const tag=column.querySelector('.tag .eds-tag');if(!tag){if(clean(column.textContent)!=='-')problem('Không nhận diện được nhãn vận chuyển .tag .eds-tag.');continue;}
   if(!visible(tag)){problem('Nhãn vận chuyển bị CSS ẩn.');continue;}
   const color=getComputedStyle(tag).color,[r,g,b]=(color.match(/[\d.]+/g)||[]).map(Number);
   const group=r>120&&r>g*1.7&&r>b*1.3?'red':g>70&&g>r*1.12&&g>b*1.05?'green':'neutral';
   const label=clean(tag.textContent).slice(0,120);if(!label){problem('Nhãn vận chuyển rỗng.');continue;}
   if(/^(Đã giao|Giao hàng không thành công)$/i.test(label)&&group!==(/^Đã giao$/i.test(label)?'green':'red'))problem('Màu CSS không còn phù hợp với nhãn '+label+'.');
   if(result.palette[label]&&result.palette[label].group!==group)problem('Cùng nhãn vận chuyển có nhiều nhóm màu: '+label);
   result.palette[label]={group,color};
  }
 }else if(stage==='list'){
  feature('account','.account-info .subaccount-name');
  const title=feature('productHeader','.list-header-title',{visual:true});
  const total=clean(title?.textContent).match(/^(\d[\d.,]*)\s+Sản Phẩm$/i);
  if(!total)problem('Không đọc được tổng số sản phẩm từ .list-header-title.');
  result.empty=!!total&&Number(total[1].replace(/[.,]/g,''))===0;
  feature('search','input[placeholder="Tìm Tên sản phẩm, SKU sản phẩm, SKU phân loại, Mã sản phẩm"]');
  feature('pageSize','.product-list-pagination .eds-pagination-sizes__content');
  feature('pageCurrent','.product-list-pagination .eds-pager__current');
  feature('pageTotal','.product-list-pagination .eds-pager__total');
  feature('nextPage','.product-list-pagination .eds-pager__button-next');
  const rows=all('.product-variation-item');if(!rows.length&&!result.empty)problem('Thiếu dòng sản phẩm .product-variation-item.');
  for(const row of rows){
   if(!/ID Sản phẩm:\s*\d+/.test(clean(row.querySelector('.item-id')?.textContent)))problem('Thiếu ID sản phẩm .item-id.');
   if(!clean(row.querySelector('a.product-name-wrap')?.textContent))problem('Thiếu tên sản phẩm a.product-name-wrap.');
   const variants=[...row.closest('tr')?.querySelectorAll('.model-list-item')||[]];
   for(const unit of variants.length?variants:[row]){
    if(!/Model ID:\s*\d+/.test(clean(unit.textContent)))problem('Thiếu Model ID của sản phẩm/phân loại.');
    if(!unit.querySelector('.stock-content'))problem('Thiếu ô thao tác tồn kho .stock-content.');
    if(deep&&!unit.querySelector('.list-view-price, .list-view-model-price'))problem('Thiếu ô thao tác giá sau khi cuộn tải dữ liệu.');
   }
  }
 }else if(stage==='page-size'){
  feature('pageSize','.product-list-pagination .eds-pagination-sizes__content');
  const options=all('.eds-pagination-sizes__popper .eds-dropdown-item').filter(visible);
  if(options.filter(e=>clean(e.textContent)==='48').length!==1)problem('Không còn đúng một lựa chọn 48 sản phẩm/trang.');
 }else{
  const field=stage.startsWith('price')?'price':'stock',dialogs=all('.eds-modal__content').filter(visible);
  if(dialogs.length!==1){problem('Không xác định được một hộp sửa duy nhất .eds-modal__content.');return result;}
  const dialog=dialogs[0];
  const title=feature('dialogTitle','.eds-modal__title',{scope:dialog,visual:true});
  if(clean(title?.textContent)!==(field==='price'?'Cập nhật giá':'Cập nhật kho hàng'))problem('Tiêu đề hộp sửa đã thay đổi.');
  feature('productName','.'+field+'-edit-name',{scope:dialog});
  const buttons=[...dialog.querySelectorAll('button')].filter(visible);
  if(!buttons.some(e=>clean(e.textContent)==='Hủy bỏ'))problem('Thiếu nút Hủy bỏ của hộp sửa.');
  const save=buttons.find(e=>clean(e.textContent)===(field==='price'?'Cập nhật giá':'Cập nhật'));
  if(!save)problem('Thiếu nút lưu của hộp sửa.');
  if(stage.endsWith('multi')){
   const rows=[...dialog.querySelectorAll('tr.eds-table__row')];
   if(!rows.length)problem('Thiếu bảng phân loại trong hộp sửa.');
   for(const row of rows)if(!row.querySelector('.'+field+'-edit-variation')||row.querySelectorAll('input').length!==1)problem('Cấu trúc phân loại / ô nhập trong hộp sửa không còn phù hợp.');
  }else if([...dialog.querySelectorAll('input')].filter(visible).length!==1)problem('Hộp sửa đơn không còn đúng một ô nhập.');
 }
 return result;
}
class InterfaceMonitor{
 constructor(dir,onChange=()=>{}){
  this.dir=path.join(dir,'interface-monitor');fs.mkdirSync(this.dir,{recursive:true});this.file=path.join(this.dir,'state.json');this.onChange=onChange;
  this.data=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):{version:1,records:{}};
 }
 save(){fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.data,null,2));fs.renameSync(this.file+'.tmp',this.file);this.onChange();}
 snapshot(){return Object.values(this.data.records).map(({baseline,current,...r})=>({...r,canAccept:r.status==='changed'&&!!current&&!current.issues.length&&current.availability==='ready'&&!r.semanticDrift}));}
 key(profileId,module,stage){return [profileId,module,stage].join(':');}
 async check(profileId,module,stage,page,options={}){
  const observed=await page.evaluate(inspectInterface,{module,stage,...options});
  const record=await this.record(profileId,module,stage,page,observed);
  if(record.status!=='ok'){
   const e=Error(record.status==='changed'?'Giao diện Shopee thay đổi hoặc không còn tương thích. Xem cảnh báo đỏ trong tool.':'Chưa kiểm tra được giao diện Shopee: '+record.issues.join(' '));e.code=record.status==='changed'?'INTERFACE_CHANGED':'INTERFACE_UNAVAILABLE';throw e;
  }
  return record;
 }
 async record(profileId,module,stage,page,current){
  const id=this.key(profileId,module,stage),old=this.data.records[id]||{id,profileId,module,stage};
  const record={...old,checkedAt:new Date().toISOString(),current,semanticDrift:false};
  if(current.availability!=='ready'){
   record.status=old.status==='changed'?'changed':'unavailable';record.issues=old.status==='changed'?old.issues:[current.availability==='login'?'Cần đăng nhập hoặc xử lý xác minh Shopee.':'Trang chưa tải hoặc lỗi mạng; chưa kết luận thay đổi giao diện.'];
  }else{
   const diffs=[];
   if(old.baseline){
    for(const [name,value] of Object.entries(old.baseline.features))if(JSON.stringify(current.features[name])!==JSON.stringify(value))diffs.push('DOM/CSS thay đổi tại '+name+': '+JSON.stringify(value)+' → '+JSON.stringify(current.features[name]||null));
    for(const [label,value] of Object.entries(current.palette)){
     const before=old.baseline.palette[label];
     if(before&&before.group!==value.group){record.semanticDrift=true;diffs.push('Nhóm màu vận chuyển đổi: '+label+' ('+before.group+' → '+value.group+'). Cần sửa bộ đọc trước.');}
     else if(before&&before.color!==value.color)diffs.push('Màu CSS vận chuyển đổi: '+label+' ('+before.color+' → '+value.color+').');
    }
   }
   record.status=current.issues.length||diffs.length?'changed':'ok';record.issues=[...current.issues,...diffs];
   if(record.status==='ok')record.baseline={features:current.features,palette:{...old.baseline?.palette,...current.palette}};
  }
  const changed=record.status==='changed'&&(old.status!=='changed'||JSON.stringify(old.issues)!==JSON.stringify(record.issues));
  this.data.records[id]=record;
  if(changed){
   const name=createHash('sha256').update(id).digest('hex').slice(0,20);record.report=name+'.json';record.image=null;
   if(current.availability==='ready'&&page&&!page.isClosed())try{await page.screenshot({path:path.join(this.dir,name+'.png'),timeout:5000,mask:[page.locator('input,textarea,[contenteditable="true"]')]});record.image=name+'.png';delete record.captureNote;}catch{record.captureNote='Chưa chụp được ảnh; báo cáo DOM/CSS vẫn được lưu.';}
   fs.writeFileSync(path.join(this.dir,record.report),JSON.stringify({profileId,module,stage,checkedAt:record.checkedAt,issues:record.issues,baseline:record.baseline,current},null,2));
  }
  this.save();return record;
 }
 async failure(profileId,module,stage,page,error,options={}){
  if(error.code==='INTERFACE_CHANGED'||error.code==='INTERFACE_UNAVAILABLE')return;
  let current;try{if(page&&!page.isClosed())current=await page.evaluate(inspectInterface,{module,stage,...options});}catch{}
  if(!current||(current.availability==='ready'&&!current.issues.length))current={availability:'loading',issues:[],features:{},palette:{}};
  const record=await this.record(profileId,module,stage,page,current);if(record.status==='changed')error.code='INTERFACE_CHANGED';
 }
 accept(id){
  const r=this.data.records[id];if(!r||!this.snapshot().find(r=>r.id===id)?.canAccept||Date.now()-Date.parse(r.checkedAt)>5*60000)throw Error('Chỉ nhận mẫu vừa kiểm tra trong 5 phút, đủ thành phần và không đổi nhóm màu vận chuyển.');
  r.baseline={features:r.current.features,palette:{...r.baseline?.palette,...r.current.palette}};r.status='ok';r.issues=[];r.acceptedAt=new Date().toISOString();this.save();
 }
 reportPath(id){const r=this.data.records[id];if(!r?.report)throw Error('Chưa có báo cáo cho mục này.');return path.join(this.dir,createHash('sha256').update(id).digest('hex').slice(0,20)+'.json');}
}
module.exports={InterfaceMonitor,inspectInterface};
