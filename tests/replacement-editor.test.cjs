const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {chromium}=require('playwright');const {ReplacementEditor,readEditor}=require('../src/replacement-editor.cjs');
const target={profileId:'p',shop:'shop',productId:'123',modelId:'456',name:'Tên gốc',variant:''};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
// These classes and nesting come from the settled Shopee editor DOM, including
// tooltips in labels, a date selector without an input, and the upload/crop boxes.
const field=(label,value,required=true,kind='input')=>'<div class="edit-row product-edit-form-item" data-fixture-label="'+escape(label)+'"><div class="edit-label'+(required?' mandatory':'')+'">'+(required?'<div class="mandatory"><i class="mandatory-icon">*</i></div>':'')+(kind==='date'?'<span class="item-title-text">'+label+'</span>':label)+(label==='Kho hàng'?'<div class="eds-popover" style="display:none"><div role="tooltip">Tồn kho phải chính xác. Hidden instructions are not field labels.</div></div>':'')+'</div><div>'+ (kind==='description'?'<div class="ql-editor" contenteditable="true">'+escape(value)+'</div>':kind==='date'?'<div class="eds-date-picker"><div class="eds-date-picker__input"><div class="eds-selector__inner">'+escape(value)+'</div></div><div class="eds-date-picker__picker" style="display:none"><span class="eds-picker-header__label">Tháng 12</span><span class="eds-picker-header__label">2026</span></div></div>':kind==='category'?'<input value="'+escape(value)+'" readonly>':'<input value="'+escape(value)+'">')+'</div></div>';
const imageItem=src=>'<div class="can-drag shopee-image-manager__itembox"><div class="popover-wrap"><div class="shopee-image-manager__content"><img class="shopee-image-manager__image" src="'+src+'"><div class="shopee-image-manager__tools"><span class="shopee-image-manager__icon shopee-image-manager__icon--delete">Xóa</span></div></div></div></div>';
const form=state=>'<div class="account-info"><span class="subaccount-name">shop</span></div>'+field('Tên sản phẩm',state.name)+field('Ngành hàng','Sức Khỏe > Hỗ trợ sức khỏe',true,'category')+field('Thương hiệu','No brand')+field('Ngày hết hạn','31/12/2026',true,'date')+field('Mô tả sản phẩm',state.description,true,'description')+field('Giá',state.price)+field('Kho hàng',state.stock)+field('Cân nặng (Sau khi đóng gói)','10')+'<div class="edit-row product-edit-form-item"><div class="edit-label">Hình ảnh sản phẩm</div><div class="edit-main"><div class="mandatory"><i class="mandatory-icon">*</i><span>Hình ảnh tỷ lệ 1:1</span></div><div class="shopee-image-manager">'+state.images.map(imageItem).join('')+'<div class="shopee-image-manager__itembox upload-box"><input type="file" accept="image/*" multiple></div><div class="shopee-image-cropper" style="display:none"><img src="https://fixture.invalid/crop.png"></div></div></div></div><label><input type="checkbox" checked>Tôi đồng ý với Điều khoản và Điều kiện</label><button>Cập nhật</button>';
async function fixture(t){
 const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());const page=await browser.newPage();
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'srm-editor-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const imageFile=path.join(dir,'new.jpg');fs.writeFileSync(imageFile,Buffer.from([255,216,255,224,0,0,255,217]));
 const state={name:target.name,description:'Mô tả gốc',price:100000,stock:20,images:['https://fixture.invalid/old.png'],saved:0,finds:0};
 await page.exposeFunction('persist',values=>{Object.assign(state,values);state.saved++;});
 await page.route('https://fixture.invalid/**',route=>route.fulfill({contentType:'image/png',body:png}));
 await page.route('https://banhang.shopee.vn/portal/product/123**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><meta charset="utf-8"><style>.ql-editor{white-space:pre-wrap}</style>'+form(state)}));
 async function load(){await page.goto('https://banhang.shopee.vn/portal/product/123?pageEntry=product_list');await page.evaluate(({localPreview,delay})=>{
  const root=document.querySelector('.shopee-image-manager');root.onclick=e=>{if(e.target.matches('.shopee-image-manager__icon--delete'))e.target.closest('.shopee-image-manager__itembox').remove();};
  root.querySelector('input[type=file]').onchange=e=>{for(const file of e.target.files){const item=document.createElement('div');item.className='shopee-image-manager__itembox';item.innerHTML='<img class="shopee-image-manager__image"><span class="shopee-image-manager__icon--delete">Xóa</span>';const img=item.querySelector('img'),server='https://fixture.invalid/new-'+encodeURIComponent(file.name)+'.png';if(delay){img.src=URL.createObjectURL(new Blob([Uint8Array.from(atob(localPreview),c=>c.charCodeAt(0))],{type:'image/png'}));setTimeout(()=>{img.src=server;},delay);}else img.src=server;root.insertBefore(item,e.target.closest('.upload-box'));}};
  const button=[...document.querySelectorAll('button')].find(e=>e.textContent==='Cập nhật');button.onclick=()=>{
   const values=label=>[...document.querySelectorAll('[data-fixture-label]')].find(e=>e.dataset.fixtureLabel===label).querySelector('input')?.value;
   void window.persist({name:values('Tên sản phẩm'),description:document.querySelector('.ql-editor').innerText,price:Number(values('Giá')),stock:Number(values('Kho hàng')),images:[...root.querySelectorAll('.shopee-image-manager__itembox img')].map(i=>i.src)});
  };
 },{localPreview:png.toString('base64'),delay:state.uploadDelay||0});}
 const productScanner={scanner:{},monitor:null,find:async()=>{state.finds++;return {page,row:{...target,price:state.price,stock:state.stock}};}};
 const editor=new ReplacementEditor(productScanner);editor.open=async()=>{await load();editor.liveVariants=[{modelId:'456',name:'',price:state.price,stock:state.stock}];return page;};
 await load();editor.liveVariants=[{modelId:'456',name:'',price:state.price,stock:state.stock}];
 const article={product:{name:'Tên mới',description:'Nội dung mới\nDòng thứ hai',category:'Sức Khỏe > Hỗ trợ sức khỏe',fields:{'Thương hiệu':'No brand','Ngày hết hạn':'31/12/2026','Cân nặng (Sau khi đóng gói)':'10'},variants:[{modelId:'456',name:'',price:120000,stock:10}]},images:['https://fixture.invalid/new.png']};
 return {page,editor,state,article,assets:{images:[{path:imageFile}]},load};
}
test('reads mandatory labels and scopes current fields without clipboard or unrelated controls',async t=>{
 const {page,editor}=await fixture(t);await page.locator('.ql-editor').evaluate(e=>e.parentElement.insertAdjacentHTML('beforeend','<div class="ql-clipboard" contenteditable="true">ignore</div>'));
 const schema=await editor.observe(page,target);assert.equal(schema.name,target.name);assert.equal(schema.category,'Sức Khỏe > Hỗ trợ sức khỏe');assert.equal(schema.images.length,1);assert.ok(schema.required.some(f=>f.label==='Cân nặng (Sau khi đóng gói)'));assert.equal(schema.fields.find(f=>f.label==='Mô tả sản phẩm').inputCount,1);assert.equal(schema.variants[0].modelId,'456');
});
test('grounded Shopee DOM reads all five product images and ignores upload and hidden crop images',async t=>{
 const {page,editor,state,load}=await fixture(t);state.images=Array.from({length:5},(_,i)=>'https://fixture.invalid/old-'+i+'.png');await load();
 const schema=await editor.observe(page,target);assert.equal(schema.images.length,5);assert.equal(schema.images.every(i=>i.deleteControl),true);assert.deepEqual(schema.images.map(i=>i.url),state.images);
 assert.equal(schema.uploadCount,1);assert.ok(schema.required.some(f=>f.label==='Hình ảnh sản phẩm'));
 assert.equal(schema.fields.find(f=>f.label==='Kho hàng').value,'20');assert.equal(schema.fields.some(f=>f.label.includes('Hidden instructions')),false);
 const date=schema.fields.find(f=>f.label==='Ngày hết hạn');assert.equal(date.value,'31/12/2026');assert.equal(date.kind,'date');assert.equal(date.inputCount,0);assert.equal(date.required,true);
});
test('blocks unknown required fields, category changes and model/variant restructuring before mutation',async t=>{
 const {page,editor,article,state,assets}=await fixture(t);const schema=await editor.observe(page,target);
 assert.throws(()=>editor.validate(schema,{...article.product,category:'Ngành mới'}),/Thay ngành hàng/);
 assert.throws(()=>editor.validate(schema,{...article.product,variants:[{...article.product.variants[0],modelId:'999'}]}),/Model ID/);
 await page.locator('body').evaluate(e=>e.insertAdjacentHTML('afterbegin','<div><div class="edit-label mandatory"><i class="mandatory-icon">*</i>Giấy phép mới</div><input></div>'));
 await assert.rejects(editor.observe(page,target),e=>e.code==='INTERFACE_CHANGED'&&/Giấy phép/.test(e.message));assert.equal(state.saved,0);assert.equal(await page.locator('.shopee-image-manager__itembox img').count(),1);
 schema.required.push({label:'Giấy phép mới',kind:'text',value:''});assert.throws(()=>editor.validate(schema,article.product),/Trường bắt buộc chưa hỗ trợ/);
});
test('validates complete assets before fill; legal checkbox remains under user control',async t=>{
 const {page,editor,article,state,assets}=await fixture(t);
 await assert.rejects(editor.apply(target,article,{images:[]}),/Ảnh đã xử lý/);assert.equal(state.saved,0);assert.equal((await page.evaluate(readEditor)).name,target.name);
 const originalOpen=editor.open.bind(editor);editor.open=async t=>{const p=await originalOpen(t);await p.locator('input[type=checkbox]').uncheck();return p;};
 await assert.rejects(editor.apply(target,article,assets),/tự kiểm tra và xác nhận/);assert.equal(state.saved,0);assert.equal(await page.locator('.shopee-image-manager__itembox img').count(),1);
});
test('sets requested fields and new images once, then verifies after fresh navigation',async t=>{
 const {page,editor,article,state,assets}=await fixture(t);let submits=0;
 const result=await editor.apply(target,article,assets,{beforeSubmit:()=>submits++});assert.equal(submits,1);assert.equal(state.saved,1);assert.equal(state.finds,1);assert.equal(result.schema.name,'Tên mới');assert.equal(result.schema.description,'Nội dung mới\nDòng thứ hai');assert.equal(result.schema.variants[0].stock,10);assert.equal(state.images.length,1);assert.match(state.images[0],/new-new.jpg/);assert.equal((await page.evaluate(readEditor)).fields.find(f=>f.label==='Ngày hết hạn').value,'31/12/2026');
});
test('waits for server image URLs after the local blob preview has rendered',async t=>{
 const {page,editor,state,assets,load}=await fixture(t);state.uploadDelay=700;await load();const schema=await editor.observe(page,target);
 const uploaded=await editor.replaceImages(page,schema,assets.images.map(i=>i.path));assert.deepEqual(uploaded,['https://fixture.invalid/new-new.jpg.png']);assert.equal(state.saved,0);
});
test('keeps save blocked when only a decoded local preview is available',async t=>{
 const {page,editor,state,assets,load}=await fixture(t);state.uploadDelay=10000;await load();const schema=await editor.observe(page,target),wait=page.waitForFunction.bind(page);
 page.waitForFunction=(fn,arg,options)=>wait(fn,arg,options?.timeout===120000?{...options,timeout:300}:options);
 await assert.rejects(editor.replaceImages(page,schema,assets.images.map(i=>i.path)),/Ảnh chưa tải lên máy chủ Shopee đầy đủ/);assert.equal(state.saved,0);
});
test('before-submit failure abandons form; verification failure records uncertain result without retry',async t=>{
 const {editor,article,state,assets}=await fixture(t);await assert.rejects(editor.apply(target,article,assets,{beforeSubmit:()=>{throw Error('Journal cannot save');}}),/Journal/);assert.equal(state.saved,0);
 const original=editor.products.find;editor.products.find=async()=>{throw Error('fresh read unavailable');};
 await assert.rejects(editor.apply(target,article,assets),e=>e.uncertain===true&&e.submitted===true&&e.code==='REPLACEMENT_UNCERTAIN');assert.equal(state.saved,1);editor.products.find=original;
});
test('stale preview prevents overwriting newer stock or changes before deleting images',async t=>{
 const {page,editor,article,state,assets}=await fixture(t);const baseline=await editor.observe(page,target);state.stock=19;
 await assert.rejects(editor.apply(target,article,assets,{baseline}),/đã thay đổi sau bản xem trước/);assert.equal(state.saved,0);assert.equal((await page.evaluate(readEditor)).images[0].url,'https://fixture.invalid/old.png');
});
test('multi variants are preserved; unsupported variant price edits are blocked',async t=>{
 const {page,editor,article}=await fixture(t);const schema=await editor.observe(page,target);schema.hasVariants=true;schema.variants=[{modelId:'a',name:'A',price:100,stock:2},{modelId:'b',name:'B',price:200,stock:3}];
 const product={...article.product,variants:schema.variants};assert.doesNotThrow(()=>editor.validate(schema,product));assert.throws(()=>editor.validate(schema,{...product,variants:[{...schema.variants[0],stock:99},schema.variants[1]]}),/giữ giá\/kho phân loại/);
});
