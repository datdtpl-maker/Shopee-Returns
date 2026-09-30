const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {chromium}=require('playwright');const {Store}=require('../src/core.cjs');const {Products}=require('../src/products.cjs');const {ProductScanner,readProducts}=require('../src/product-scanner.cjs');
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'srm-fresh-edit-')),browser=await chromium.launch({channel:'chrome',headless:true});
 t.after(async()=>{await browser.close();fs.rmSync(dir,{recursive:true,force:true});});
 const page=await browser.newPage();await page.setContent('<table><tr class="eds-table__row"><td><div class="product-variation-item"><div class="item-id">ID Sản phẩm: 123</div><a class="product-name-wrap">Sản phẩm 123</a><div>Model ID: 1239</div><div class="list-view-price">₫90.000</div><div class="stock-content"><span class="stock-text">88</span></div></div></td></tr></table><div class="eds-modal__content" hidden><h2></h2><p></p><input><button>Hủy bỏ</button><button></button></div>');
 await page.evaluate(()=>{
  window.saved=[];window.live={price:90000,stock:88};const dialog=document.querySelector('.eds-modal__content');
  const render=()=>{document.querySelector('.list-view-price').textContent='₫'+window.live.price.toLocaleString('vi-VN');document.querySelector('.stock-text').textContent=window.live.stock;};
  for(const field of ['price','stock'])document.querySelector(field==='price'?'.list-view-price':'.stock-content').onclick=()=>{window.field=field;dialog.querySelector('h2').textContent=field==='price'?'Cập nhật giá':'Cập nhật kho hàng';const name=dialog.querySelector('p');name.className=field+'-edit-name';name.textContent='Sản phẩm 123';dialog.querySelector('input').value=window.live[field];dialog.querySelectorAll('button')[1].textContent=field==='price'?'Cập nhật giá':'Cập nhật';dialog.hidden=false;};
  dialog.querySelectorAll('button')[0].onclick=()=>dialog.hidden=true;
  dialog.querySelectorAll('button')[1].onclick=()=>{window.saved.push({field:window.field,value:Number(dialog.querySelector('input').value)});window.live[window.field]=Number(dialog.querySelector('input').value);if(window.field==='price'&&window.sellDuringPrice)window.live.stock--;render();dialog.hidden=true;};
 });
 const scanner=new ProductScanner({});scanner.find=async()=>({page,row:(await page.evaluate(readProducts)).rows[0],unit:page.locator('.product-variation-item')});
 const store=new Store(dir),profile=store.addProfile('Shop');store.data.settings.autoScan=false;store.save();const service=new Products(dir,store,{},scanner);
 service.ingest(profile.id,{shop:'shop',rows:[{productId:'123',modelId:'1239',name:'Sản phẩm 123',variant:'',price:100000,stock:95}],total:1,pages:1,scannedAt:'2026-09-19T04:01:49Z'});
 service.sync=async()=>{service.data.rows.forEach(r=>r.sync='synced');};return {service,page,scanner,row:service.data.rows[0]};
}
test('single absolute stock edit uses live 88 instead of stale 95 and records the actual previous value',async t=>{
 const {service,page,row}=await fixture(t);await service.edit(row.id,{field:'stock',expected:95,value:0});
 assert.deepEqual(await page.evaluate(()=>window.saved),[{field:'stock',value:0}]);assert.equal(row.stock,0);assert.equal(service.data.actions[0].expected,88);assert.equal(service.data.actions[0].requestedExpected,95);
});
test('batch absolute price and stock edits survive a sale between fields and stale cached drafts',async t=>{
 const {service,page,row}=await fixture(t);await page.evaluate(()=>window.sellDuringPrice=true);
 const result=await service.editBatch({requestId:'fresh-edit-batch-stock-price',items:[{id:row.id,field:'price',expected:100000,value:120000},{id:row.id,field:'stock',expected:95,value:0}]});
 assert.deepEqual(result.items.map(i=>i.status),['verified','verified']);assert.deepEqual(result.items.map(i=>i.expected),[90000,87]);assert.deepEqual(await page.evaluate(()=>window.saved),[{field:'price',value:120000},{field:'stock',value:0}]);assert.equal(row.stock,0);assert.equal(row.price,120000);
});
test('a race after the live read or a promotional price mismatch still blocks without submitting',async t=>{
 const {service,page,row}=await fixture(t);await page.evaluate(()=>window.live.stock=87);
 await assert.rejects(service.edit(row.id,{field:'stock',expected:95,value:0}),/hộp sửa khác dữ liệu Shopee vừa đọc/);
 assert.deepEqual(await page.evaluate(()=>window.saved),[]);assert.equal(service.data.actions[0].status,'failed');
 await page.evaluate(()=>window.live.price=100000);
 await assert.rejects(service.edit(row.id,{field:'price',expected:100000,value:120000}),/hộp sửa khác dữ liệu Shopee vừa đọc/);
 assert.deepEqual(await page.evaluate(()=>window.saved),[]);assert.equal(service.data.actions[0].status,'failed');
});
test('an already matching absolute target is verified without submitting again',async t=>{
 const {service,page,row}=await fixture(t);const result=await service.edit(row.id,{field:'stock',expected:95,value:88});
 assert.equal(result.notionPending,false);assert.deepEqual(await page.evaluate(()=>window.saved),[]);assert.equal(row.stock,88);assert.equal(service.data.actions[0].expected,88);assert.equal(service.data.actions[0].status,'verified');
});
