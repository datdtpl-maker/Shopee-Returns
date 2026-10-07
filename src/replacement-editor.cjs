const fs=require('node:fs');
const {createHash}=require('node:crypto');
const {readProducts}=require('./product-scanner.cjs');
const {setDate,validateDate}=require('./replacement-date.cjs');
const clean=s=>String(s??'').replace(/\s+/g,' ').trim();
const DESCRIPTION='Mô tả sản phẩm';
const KNOWN_REQUIRED=new Set(['Hình ảnh sản phẩm','Hình ảnh tỷ lệ 1:1','Hình ảnh tỉ lệ 1:1','Tên sản phẩm','Ngành hàng','Thương hiệu','Ngày hết hạn',DESCRIPTION,'Giá','Kho hàng','Cân nặng','Cân nặng (Sau khi đóng gói)','Trọng lượng','Phân loại hàng','Phân loại']);
const fail=(message,code='REPLACEMENT_INVALID')=>Object.assign(Error(message),{code});

// Runs only against the rendered form. No scripts, cookies or network bodies
// are collected. Field values form the local review/verification snapshot.
function readEditor(){
 const clean=s=>String(s??'').replace(/\s+/g,' ').trim();
 const visible=e=>!!e&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).visibility!=='hidden';
 const labels=[...document.querySelectorAll('.edit-label')];
 const fields=[];
 const controls=scope=>[...scope.querySelectorAll('input:not([type=file]):not([type=hidden]):not([type=checkbox]),textarea,.ql-editor[contenteditable=true]')].filter(visible);
 for(let index=0;index<labels.length;index++){
  const e=labels[index];if(!visible(e))continue;
  const copy=e.cloneNode(true);copy.querySelectorAll('.mandatory,.mandatory-icon,.eds-popover,.eds-popper,.resize-triggers,button,[role=tooltip]').forEach(node=>node.remove());
  const label=clean(copy.querySelector('.item-title-text')?.textContent||copy.textContent).replace(/^\*\s*/,'').replace(/\s*\*$/,'').replace(/\s*\d+\/\d+$/,'');
  if(!label)continue;
  let scope=e.parentElement,depth=1;
  for(;scope&&depth<7;scope=scope.parentElement,depth++){
   if([...scope.querySelectorAll('.edit-label')].filter(visible).length>1)break;
   if(controls(scope).length||scope.querySelector('.eds-date-picker,.eds-select,.shopee-selector,.product-category,.shopee-image-manager,.image-manager,.category-select')||scope.querySelector('input[type=file]'))break;
  }
  if(!scope||[...scope.querySelectorAll('.edit-label')].filter(visible).length>1){scope=e.parentElement;depth=1;}
  const inputs=controls(scope),editor=inputs.find(c=>c.matches('.ql-editor'));
  const select=[...scope.querySelectorAll('.eds-select,.shopee-selector,.product-category,.category-select')].find(visible);
  const category=label==='Ngành hàng';
  const image=/^(Hình ảnh sản phẩm|Hình ảnh t[ỷỉ] lệ 1:1)$/u.test(label);
  const date=label==='Ngày hết hạn';
  const variant=/^Phân loại(?: hàng)?$/u.test(label);
  const kind=image?'images':variant?'variants':category?'category':editor?'description':date?'date':select?'select':inputs.length===1?(inputs[0].type==='number'||['Giá','Kho hàng','Cân nặng','Cân nặng (Sau khi đóng gói)','Trọng lượng'].includes(label)?'number':'text'):'unsupported';
  let value=editor?editor.innerText:inputs.length===1?inputs[0].value:'';
  if(date&&scope.querySelector('.eds-date-picker'))value=scope.querySelector('.eds-date-picker .eds-selector__inner')?.innerText||'';
  if(category||select){value=clean(select?.innerText||scope.querySelector('.eds-input__input')?.value||inputs[0]?.value||scope.innerText.replace(e.innerText,''));if(category)value=clean(value.split(/Ngành hàng được đề xuất|Gợi ý ngành hàng|Recommended category/i)[0]);}
  fields.push({label,index,depth,kind,required:!!e.querySelector('.mandatory-icon')||e.classList.contains('mandatory')||!!scope.querySelector('.mandatory .mandatory-icon'),value:kind==='description'?String(value||'').replace(/\r\n/g,'\n').trim():clean(value),inputCount:inputs.length,tag:inputs[0]?.tagName||select?.tagName||null});
 }
 const manager=document.querySelector('.shopee-image-manager');
 const imageItems=manager?[...manager.querySelectorAll('.shopee-image-manager__itembox,.image-item,.shopee-image-manager__item,.image-manager-item')].filter(e=>!e.parentElement?.closest('.shopee-image-manager__itembox,.image-item,.shopee-image-manager__item,.image-manager-item')&&e.querySelector('img')):[];
 const images=imageItems.map((e,index)=>({index,src:e.querySelector('img')?.currentSrc||e.querySelector('img')?.src||'',url:e.querySelector('img')?.currentSrc||e.querySelector('img')?.src||'',deleteControl:!!e.querySelector('.shopee-image-manager__icon--delete,.delete-image,.image-delete,.image-manager-delete,.shopee-image-manager__delete,[aria-label="Xóa ảnh"],[aria-label="Xóa"]')}));
 const upload=manager?[...manager.querySelectorAll('input[type=file]')].filter(e=>e.accept==='image/*'&&e.multiple).length:0;
 const buttons=[...document.querySelectorAll('button')].filter(visible);
 const legal=[...document.querySelectorAll('label,.eds-checkbox')].filter(e=>visible(e)&&/Tôi đồng ý.*Điều khoản/.test(clean(e.textContent))).map(e=>({checked:!!e.querySelector('input[type=checkbox]:checked')||e.classList.contains('is-checked')||e.classList.contains('checked')}));
 return {productId:location.pathname.match(/\/portal\/product\/(\d+)/)?.[1]||'',shop:clean(document.querySelector('.account-info .subaccount-name')?.textContent),name:fields.find(f=>f.label==='Tên sản phẩm')?.value||'',description:fields.find(f=>f.label==='Mô tả sản phẩm')?.value||'',category:fields.find(f=>f.label==='Ngành hàng')?.value||'',fields,required:fields.filter(f=>f.required),images,uploadCount:upload,saveCount:buttons.filter(e=>clean(e.textContent)==='Cập nhật').length,legalChecked:legal.length?legal.some(e=>e.checked):null,hasVariants:fields.some(f=>f.kind==='variants'),availability:/\/(signin|login)(\/|$)/i.test(location.pathname)||document.querySelector('input[type=password]')?'login':clean(document.body?.innerText).length>30?'ready':'loading'};
}

function productValues(product){
 if(!product||typeof product!=='object'||Array.isArray(product))throw fail('Bài viết chưa có thông tin sản phẩm hợp lệ.');
 if(!product.fields||typeof product.fields!=='object'||Array.isArray(product.fields))throw fail('Thiếu danh sách fields của sản phẩm.');
 const values={...product.fields,'Tên sản phẩm':product.name,[DESCRIPTION]:product.description};
 if(product.category!==undefined)values['Ngành hàng']=product.category;
 return values;
}

class ReplacementEditor{
 constructor(productScanner){this.products=productScanner;this.scanner=productScanner.scanner;this.monitor=productScanner.monitor;this.pages=new Map();}
 async open(target,{confirmed=false}={}){
  if(!/^\d+$/.test(String(target.productId||''))||!target.profileId||!target.shop||!target.name)throw fail('Thiếu profile, shop, ID hoặc tên sản phẩm gốc.');
  if(!confirmed){const found=await this.products.find(target.profileId,target);const list=await found.page.evaluate(readProducts);this.liveVariants=list.rows.filter(r=>r.productId===String(target.productId)).map(({modelId,variant,price,stock})=>({modelId,name:variant,price,stock}));}
  const ctx=await this.scanner.context(target.profileId);let page=this.pages.get(target.profileId);
  if(!page||page.isClosed()){page=await ctx.newPage();page.setDefaultTimeout(15000);this.pages.set(target.profileId,page);}
  const cdp=await ctx.newCDPSession(page);try{await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});await cdp.send('Network.setBypassServiceWorker',{bypass:true});}finally{await cdp.detach();}
  await page.goto('https://banhang.shopee.vn/portal/product/'+target.productId+'?pageEntry=product_list',{waitUntil:'domcontentloaded',timeout:60000});
  try{await page.locator('.edit-label').first().waitFor({timeout:45000});await page.locator('.ql-editor[contenteditable=true]').waitFor({timeout:30000});
   await page.locator('.product-specification-content .attribute-select-item .edit-label').first().waitFor({timeout:30000});
   let previous='',stable=0;const deadline=Date.now()+10000;
   while(Date.now()<deadline&&stable<3){const signature=await page.evaluate(()=>[...document.querySelectorAll('.edit-label')].map(e=>e.innerText).join('|'));stable=signature===previous?stable+1:0;previous=signature;await page.waitForTimeout(250);}
   if(stable<3)throw fail('Thuộc tính sản phẩm chưa tải ổn định. Thử đọc lại form.','INTERFACE_UNAVAILABLE');}
  catch(error){await this.observe(page,target);throw error;}
  return page;
 }
 async observe(page,target){
  const schema=await page.evaluate(readEditor),issues=[];schema.variants=this.liveVariants||[];schema.hasVariants=schema.variants.length>1||schema.variants.some(v=>v.name);
  if(schema.availability==='ready'){
   if(schema.productId!==String(target.productId))issues.push('ID trên trang cập nhật không khớp sản phẩm.');
   if(clean(schema.shop)!==clean(target.shop))issues.push('Shop trên trang cập nhật không khớp profile.');
   const duplicates=schema.fields.filter((f,i,a)=>a.findIndex(x=>x.label===f.label)!==i&&f.kind!=='variants');
   if(duplicates.length)issues.push('Nhãn trường bị trùng: '+duplicates.map(f=>f.label).join(', '));
   for(const f of schema.required)if(!KNOWN_REQUIRED.has(f.label)||f.kind==='unsupported')issues.push('Trường bắt buộc chưa hỗ trợ: '+f.label);
   for(const label of ['Tên sản phẩm',DESCRIPTION])if(schema.fields.filter(f=>f.label===label).length!==1)issues.push('Thiếu trường '+label+'.');
   if(schema.saveCount!==1)issues.push('Không xác định duy nhất nút Cập nhật.');
   if(schema.uploadCount!==1)issues.push('Không xác định duy nhất ô tải ảnh sản phẩm.');
   if(!schema.images.length)issues.push('Không đọc được ảnh sản phẩm hiện tại.');
   if(schema.images.some(i=>!i.deleteControl))issues.push('Không nhận diện được nút xoá ảnh cũ.');
  }
  const observation={module:'products',stage:'product-editor',availability:schema.availability,issues,palette:{},features:{editor:{name:schema.fields.find(f=>f.label==='Tên sản phẩm')?.kind,description:schema.fields.find(f=>f.label===DESCRIPTION)?.kind,uploadCount:schema.uploadCount,saveCount:schema.saveCount}}};
  const record=this.monitor?await this.monitor.record(target.profileId,'products','product-editor:'+target.productId,page,observation):null;
  if(issues.length||record?.status==='changed')throw fail('Giao diện trang cập nhật Shopee không tương thích: '+(issues.length?issues:record.issues).join(' '),'INTERFACE_CHANGED');
  if(schema.availability!=='ready'||record?.status==='unavailable')throw fail('Chưa đọc được trang cập nhật. Cần đăng nhập hoặc chờ trang tải.','INTERFACE_UNAVAILABLE');
  return schema;
 }
 async inspect(target){const page=await this.open(target);const schema=await this.observe(page,target);const currentName=clean(schema.fields.find(f=>f.label==='Tên sản phẩm')?.value);if(currentName!==clean(target.name)&&(!target.sourceName||currentName!==clean(target.sourceName))&&(!target.desiredName||currentName!==clean(target.desiredName)))throw fail('Tên sản phẩm trên trang cập nhật đã thay đổi. Quét lại trước khi tiếp tục.');return schema;}
 validate(schema,product){
  const values=productValues(product),problems=[];
  if(typeof product.name!=='string'||!clean(product.name)||clean(product.name).length>120)problems.push('Tên sản phẩm phải có 1–120 ký tự.');
  if(typeof product.description!=='string'||!product.description.trim()||product.description.length>5000)problems.push('Mô tả sản phẩm phải có 1–5000 ký tự.');
  if(!Array.isArray(product.variants)||product.variants.length!==schema.variants.length||schema.variants.some(actual=>!product.variants.some(wanted=>wanted.modelId===actual.modelId&&clean(wanted.name)===clean(actual.name))))problems.push('Phân loại và Model ID phải giữ nguyên, đầy đủ như sản phẩm gốc.');
  if(Array.isArray(product.variants))for(const wanted of product.variants){
   if(!Number.isSafeInteger(wanted.price)||wanted.price<1||wanted.price>1e9||!Number.isSafeInteger(wanted.stock)||wanted.stock<0||wanted.stock>999999)problems.push('Giá/kho phân loại không hợp lệ.');
   const actual=schema.variants.find(v=>v.modelId===wanted.modelId);if(schema.hasVariants&&actual&&(wanted.price!==actual.price||wanted.stock!==actual.stock))problems.push('Phiên bản này giữ giá/kho phân loại; dùng mục sửa giá/kho theo Model ID để thay đổi.');
  }
  if(!schema.hasVariants&&product.variants?.length===1){values['Giá']=product.variants[0].price;values['Kho hàng']=product.variants[0].stock;}
  for(const [label,value] of Object.entries(values)){
   const field=schema.fields.find(f=>f.label===label);
   if(!field){problems.push('Trường chưa tìm thấy trên Shopee: '+label);continue;}
   if(['images','variants','unsupported'].includes(field.kind)){problems.push('Không hỗ trợ nhập trường '+label+'.');continue;}
   if(field.kind==='category'){if(clean(value)&&clean(field.value)&&clean(value).toLowerCase()!==clean(field.value).toLowerCase())problems.push('Thay ngành hàng làm đổi bộ trường bắt buộc. Giữ nguyên ngành hàng của sản phẩm gốc.');values['Ngành hàng']=field.value;continue;}
   if(value===null||value===undefined||Array.isArray(value)||typeof value==='object')problems.push('Giá trị không hợp lệ: '+label);
   else if(field.kind==='number'&&(!Number.isFinite(Number(value))||Number(value)<0||(['Giá','Kho hàng'].includes(label)&&(!Number.isSafeInteger(Number(value))||Number(value)>(1e9)||label==='Giá'&&Number(value)===0))))problems.push('Giá trị số không hợp lệ: '+label);
   if(field.kind==='date')try{validateDate(value);}catch(error){problems.push(error.message);}
  }
  for(const field of schema.required){
   if(!KNOWN_REQUIRED.has(field.label)||field.kind==='unsupported')problems.push('Trường bắt buộc chưa hỗ trợ: '+field.label);
   if(['images','variants'].includes(field.kind))continue;
   const value=values[field.label]===undefined?field.value:values[field.label];
   if(value===undefined||value===null||!clean(value))problems.push('Thiếu trường bắt buộc: '+field.label);
  }
  if(schema.hasVariants&&Object.keys(values).some(k=>['Giá','Kho hàng'].includes(k)))problems.push('Sản phẩm có phân loại: dùng chức năng sửa giá/kho theo Model ID hiện có.');
  if(problems.length)throw fail([...new Set(problems)].join(' '));
  return {values,required:schema.required.map(f=>f.label),changes:Object.entries(values).filter(([label,value])=>clean(value)!==clean(schema.fields.find(f=>f.label===label)?.value)).map(([label,after])=>({label,before:schema.fields.find(f=>f.label===label)?.value,after}))};
 }
 scope(page,field){let locator=page.locator('.edit-label').nth(field.index);for(let n=0;n<field.depth;n++)locator=locator.locator('..');return locator;}
 async set(page,field,value){
  const scope=this.scope(page,field);
  if(field.kind==='category')return;
  if(field.kind==='date')return setDate(scope,value);
  if(field.kind==='select'){
   const select=scope.locator('.eds-select,.shopee-selector').filter({visible:true});if(await select.count()!==1)throw fail('Không nhận diện duy nhất lựa chọn '+field.label+'.','INTERFACE_CHANGED');await select.click();
   const options=page.locator('.eds-option:visible,.eds-select-option:visible,.eds-select__option:visible,.shopee-option:visible,[role=option]:visible').filter({hasText:new RegExp('^'+String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$')});
   if(await options.count()!==1)throw fail('Không có lựa chọn duy nhất '+field.label+': '+value+'. Chưa lưu.');await options.click();return;
  }
  const input=field.kind==='description'?scope.locator('.ql-editor[contenteditable=true]'):scope.locator('input:not([type=hidden]):not([type=checkbox]):not([type=file]):visible,textarea:visible');
  if(await input.count()!==1)throw fail('Không xác định duy nhất ô '+field.label+'.','INTERFACE_CHANGED');
  await input.scrollIntoViewIfNeeded();await input.fill(String(value));await input.blur();
 }
 assets(assets,count){
  const list=assets?.images||assets;if(!Array.isArray(list)||list.length!==count)throw fail('Ảnh đã xử lý không khớp danh sách trong bài viết.');
  return list.map(asset=>{
   const filename=asset.path||asset.outputPath;if(typeof filename!=='string'||!fs.existsSync(filename))throw fail('Không tìm thấy file ảnh đã nén trên máy.');
   const data=fs.readFileSync(filename);if(data.length>1900000||data[0]!==255||data[1]!==216||data[2]!==255)throw fail('Ảnh tải Shopee phải là JPEG dưới 1,9 MB.');
   const expected=asset.sha256||asset.hash;if(expected&&createHash('sha256').update(data).digest('hex')!==expected)throw fail('Ảnh đã thay đổi sau khi kiểm tra. Hãy chuẩn bị lại.');return filename;
  });
 }
 async replaceImages(page,schema,files){
  const manager=page.locator('.shopee-image-manager');
  const items=manager.locator('.shopee-image-manager__itembox,.image-item,.shopee-image-manager__item,.image-manager-item').filter({has:page.locator('img')});
  for(let remaining=schema.images.length;remaining>0;remaining--){
   if(await items.count()!==remaining)throw fail('Số ảnh cũ thay đổi trong lúc xử lý. Chưa lưu.');
   const last=items.last();
   await last.hover({force:true}).catch(()=>{});
   await last.evaluate(el=>{
    el.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true}));
    el.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));
   }).catch(()=>{});
   const remove=last.locator('.shopee-image-manager__icon--delete,.delete-image,.image-delete,.image-manager-delete,.shopee-image-manager__delete,[aria-label="Xóa ảnh"],[aria-label="Xóa"]');
   if(await remove.count()<1)throw fail('Không xác định nút xoá ảnh.','INTERFACE_CHANGED');
   const removeBtn=remove.first();
   try{
    await removeBtn.click({force:true,timeout:3000});
   }catch{
    await removeBtn.evaluate(el=>{
     el.click?.();
     el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));
    }).catch(()=>{});
   }
   try{
    await page.waitForFunction(n=>{
     const root=document.querySelector('.shopee-image-manager');
     if(!root)return false;
     const list=[...root.querySelectorAll('.shopee-image-manager__itembox,.image-item,.shopee-image-manager__item,.image-manager-item')]
      .filter(e=>!e.parentElement?.closest('.shopee-image-manager__itembox,.image-item,.shopee-image-manager__item,.image-manager-item')&&e.querySelector('img'));
     return list.length===n;
    },remaining-1,{timeout:4000});
   }catch{
    await removeBtn.evaluate(el=>{
     el.click?.();
     el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));
    }).catch(()=>{});
    await page.waitForFunction(n=>{
     const root=document.querySelector('.shopee-image-manager');
     if(!root)return false;
     const list=[...root.querySelectorAll('.shopee-image-manager__itembox,.image-item,.shopee-image-manager__item,.image-manager-item')]
      .filter(e=>!e.parentElement?.closest('.shopee-image-manager__itembox,.image-item,.shopee-image-manager__item,.image-manager-item')&&e.querySelector('img'));
     return list.length===n;
    },remaining-1,{timeout:15000});
   }
  }
  const fileInput=manager.locator('input[type=file][accept="image/*"][multiple],input[type=file][accept*="image"],input[type=file]').first();
  await fileInput.setInputFiles(files);
  try{await page.waitForFunction(n=>{
   const root=document.querySelector('.shopee-image-manager');
   if(!root)return false;
   const list=[...root.querySelectorAll('.shopee-image-manager__itembox,.image-item,.shopee-image-manager__item,.image-manager-item')]
    .filter(e=>!e.parentElement?.closest('.shopee-image-manager__itembox,.image-item,.shopee-image-manager__item,.image-manager-item')&&e.querySelector('img'));
   const images=list.map(e=>e.querySelector('img')).filter(Boolean);
   // Shopee renders a local blob while its upload is still pending. Decoding
   // that preview proves neither a server upload nor a usable saved image.
   return images.length===n&&images.every(i=>/^https:\/\//.test(i.currentSrc||i.src)&&/^https:\/\//.test(i.src)&&i.complete&&i.naturalWidth>0)&&!root.querySelector('.uploading,.is-uploading,.upload-error,.is-error');
  },files.length,{timeout:120000});}catch(error){
   if(error.name==='TimeoutError')throw fail('Ảnh chưa tải lên máy chủ Shopee đầy đủ sau 120 giây. Chưa lưu.');throw error;
  }
  const uploaded=await page.evaluate(readEditor);
  if(uploaded.images.length!==files.length||uploaded.images.some(i=>!/^https:\/\//.test(i.src)))throw fail('Ảnh chưa tải lên máy chủ Shopee đầy đủ. Chưa lưu.');return uploaded.images.map(i=>i.src.replace(/[?].*$/,''));
 }
 async apply(target,article,assets,{baseline,beforeSubmit=()=>{},submit=true}={}){
  const page=await this.open(target);let submitted=false;const product=article?.product||article;
  try{
   const schema=await this.observe(page,target);
   const currentName=clean(schema.fields.find(f=>f.label==='Tên sản phẩm')?.value);
   if(currentName!==clean(target.name)&&currentName!==clean(product.name))throw fail('Tên sản phẩm đã thay đổi. Đọc lại mẫu trước khi thay thế.');
   if(baseline){
    if(baseline.productId!==schema.productId||baseline.shop!==schema.shop)throw fail('Mẫu đối chiếu không thuộc sản phẩm đang cập nhật.');
    if(['name','description','category'].some(key=>clean(baseline[key])!==clean(schema[key]))||JSON.stringify(baseline.variants)!==JSON.stringify(schema.variants)||baseline.fields.some(field=>!['images','variants'].includes(field.kind)&&clean(field.value)!==clean(schema.fields.find(now=>now.label===field.label)?.value))||JSON.stringify(baseline.images.map(i=>(i.url||i.src).replace(/[?].*$/,'')))!==JSON.stringify(schema.images.map(i=>i.url.replace(/[?].*$/,''))))throw fail('Sản phẩm đã thay đổi sau bản xem trước. Chuẩn bị lại để giữ dữ liệu mới nhất.');
   }
   const imageSources=article.images||product.images;if(!Array.isArray(imageSources)||!imageSources.length||imageSources.length>9)throw fail('Cần 1–9 ảnh trong bài viết.');
   const {values}=this.validate(schema,product),files=this.assets(assets,imageSources.length);
   if(schema.legalChecked===false)throw fail('Shopee yêu cầu đồng ý điều khoản. Bạn cần tự kiểm tra và xác nhận trên Shopee; tool chưa lưu.');
   for(const [label,value] of Object.entries(values)){const field=schema.fields.find(f=>f.label===label);if(clean(value)!==clean(field.value))await this.set(page,field,value);}
   const current=await page.evaluate(readEditor);for(const field of schema.fields){if(values[field.label]!==undefined||['images','variants','category'].includes(field.kind))continue;if(clean(current.fields.find(f=>f.label===field.label)?.value)!==clean(field.value))throw fail('Trường ngoài yêu cầu bị thay đổi: '+field.label+'. Chưa lưu.');}
   const uploadedImages=await this.replaceImages(page,schema,files);
   const ready=await this.observe(page,target);const readyProduct={...product,category:ready.category};this.validate(ready,readyProduct);
   for(const [label,value] of Object.entries(values)){if(label==='Ngành hàng')continue;if(clean(ready.fields.find(f=>f.label===label)?.value)!==clean(value))throw fail('Chưa nhập đúng trường '+label+'. Chưa lưu.');}
   if(ready.legalChecked===false)throw fail('Cần tự xác nhận điều khoản Shopee trước khi lưu.');
   const errors=page.locator('.eds-form-item__error:visible,.edit-error:visible,.error-message:visible');if(await errors.count())throw fail('Shopee báo lỗi trong biểu mẫu: '+clean((await errors.allTextContents()).join(' ')));
   await beforeSubmit({schema,images:uploadedImages});
   if(!submit){
    await page.bringToFront().catch(()=>{});
    return {changed:true,productId:target.productId,name:product.name,schema:ready,images:uploadedImages,submitted:false};
   }
   submitted=true;await page.getByRole('button',{name:'Cập nhật',exact:true}).click();
   // A submit response is not verification. Reopen the list under the same
   // profile, locate the exact item/model, then re-read the saved detail form.
   await page.waitForTimeout(1000);const verifiedTarget={...target,name:product.name};const fresh=await this.products.find(target.profileId,verifiedTarget);const list=await fresh.page.evaluate(readProducts);this.liveVariants=list.rows.filter(r=>r.productId===String(target.productId)).map(({modelId,variant,price,stock})=>({modelId,name:variant,price,stock}));await this.open(verifiedTarget,{confirmed:true});const saved=await this.observe(page,verifiedTarget);
   for(const [label,value] of Object.entries(values))if(clean(saved.fields.find(f=>f.label===label)?.value)!==clean(value))throw fail('Chưa xác minh được trường đã lưu: '+label+'.');
   const savedImages=saved.images.map(i=>i.src.replace(/[?].*$/,''));if(JSON.stringify(savedImages)!==JSON.stringify(uploadedImages))throw fail('Chưa xác minh được ảnh mới sau khi lưu.');
   return {changed:true,productId:target.productId,name:product.name,schema:saved,images:savedImages};
  }catch(error){
   if(submitted){error.submitted=true;error.uncertain=true;error.code='REPLACEMENT_UNCERTAIN';error.message='Đã gửi cập nhật tới Shopee nhưng chưa xác minh hoàn tất. Không tự gửi lại; kiểm tra sản phẩm trước. '+error.message;}
   else if(submit) await page.reload({waitUntil:'domcontentloaded',timeout:60000}).catch(()=>{});
   throw error;
  }
 }
}
module.exports={ReplacementEditor,readEditor,productValues};
