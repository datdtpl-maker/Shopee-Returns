const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {Store}=require('../src/core.cjs');const {Products,key}=require('../src/products.cjs');const {validateEdit}=require('../src/product-scanner.cjs');
const row={productId:'12345678',modelId:'9876543',name:'Sản phẩm <img src=x>',variant:'Nhỏ',price:100000,stock:20};
function setup(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'srm-products-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=new Store(dir),profile=store.addProfile('Profile');const calls=[],pages=[];let fail=false;
const integration={listPages:async()=>structuredClone(pages),notion:async(url,method,body)=>{calls.push({url,method,body});if(fail)throw Error('offline');if(method==='POST'){const p={id:'page-'+pages.length,properties:body.properties};pages.push(p);return p;}if(method==='PATCH'){const p=pages.find(p=>'pages/'+p.id===url);p.properties={...p.properties,...body.properties};return p;}throw Error('unexpected');}};
const scanner={shop:async()=> 'shop',edit:async(id,target,edit,options)=>{options.beforeSubmit();return {row:{...target,[edit.field]:edit.value},changed:true};}};
const service=new Products(dir,store,integration,scanner);service.setup=async()=>{service.data.databaseId='products-only';return 'products-only';};
service.ingest(profile.id,{shop:'shop',rows:[row],total:1,pages:1,scannedAt:new Date().toISOString()});return {service,store,profile,pages,calls,scanner,setFail:v=>{fail=v;}};}
test('products sync inserts once then updates only product fields and never order state',async t=>{
 const {service,store,pages,calls}=setup(t),before=structuredClone(store.data);await service.sync();assert.equal(pages.length,1);assert.equal(pages[0].properties['Kho hàng'].number,20);
 pages[0].properties['Ghi chú']={rich_text:[{text:{content:'Giữ nguyên'}}]};service.data.rows[0].sync='pending';await service.sync();assert.equal(calls.length,1);
 service.data.rows[0].price=120000;service.data.rows[0].sync='pending';await service.sync();assert.equal(pages.length,1);assert.equal(calls[1].method,'PATCH');assert.equal(pages[0].properties['Ghi chú'].rich_text[0].text.content,'Giữ nguyên');assert.deepEqual(store.data,before);
 await service.load();assert.equal(service.data.rows[0].source,'Notion');assert.equal(service.data.rows[0].price,120000);
});
test('duplicate remote identity blocks writes; same title different model is separate',async t=>{
 const {service,pages}=setup(t);await service.sync();const second={...service.data.rows[0],id:'second',modelId:'9876544',sync:'pending'};service.data.rows.push(second);await service.sync();assert.equal(pages.length,2);
 pages.push(structuredClone(pages[0]));await assert.rejects(service.sync(),/trùng/);assert.equal(pages.length,3);
});
test('read Notion refuses to discard pending writes and malformed rows',async t=>{
 const {service,pages}=setup(t);await assert.rejects(service.load(),/chờ ghi/);await service.sync();delete pages[0].properties['Model ID'];await assert.rejects(service.load(),/thiếu ID/);assert.equal(service.data.rows.length,1);
});
test('editing verifies Shopee before updating Notion, errors leave durable pending sync',async t=>{
 const {service,setFail,profile,store,scanner}=setup(t);await service.sync();const r=service.data.rows[0];setFail(true);const result=await service.edit(r.id,{field:'stock',value:0,expected:20});assert.equal(result.notionPending,true);assert.equal(r.stock,0);assert.equal(r.sync,'pending');assert.equal(service.data.actions[0].status,'notion-pending');
 setFail(false);await service.sync();assert.equal(r.sync,'synced');assert.equal(store.profile(profile.id).id,profile.id);
 scanner.edit=async(id,r,e,o)=>{o.beforeSubmit();throw Error('timeout');};await assert.rejects(service.edit(r.id,{field:'stock',expected:0,value:2}),/timeout/);assert.equal(service.data.actions[0].status,'uncertain');await assert.rejects(service.edit(r.id,{field:'stock',expected:0,value:2}),/chưa xác minh/);
 service.ingest(profile.id,{shop:'shop',rows:[{...row,stock:2}],total:1,pages:1,scannedAt:new Date().toISOString()});assert.equal(service.data.actions[0].status,'reconciled');
});
test('profile binding and edits reject wrong accounts, nonintegers and invalid values',t=>{
 const {service,profile,store}=setup(t);assert.throws(()=>service.ingest(profile.id,{shop:'other',rows:[row]}),/đổi tài khoản/);const other=store.addProfile('Other');assert.throws(()=>service.ingest(other.id,{shop:'shop',rows:[row]}),/cùng shop/);
 for(const value of [-1,1.5,'2',NaN,Infinity,1e12])assert.throws(()=>validateEdit({field:'stock',expected:20,value}));assert.throws(()=>validateEdit({field:'price',expected:20,value:0}));assert.throws(()=>validateEdit({field:'name',expected:20,value:1}));assert.equal(validateEdit({field:'stock',expected:20,value:0}).value,0);
});
test('Notion load discovers logged-in shop bindings so edit buttons are enabled',async t=>{
 const {service,profile,pages}=setup(t);await service.sync();service.data.shops={};service.data.rows=[];await service.load();assert.equal(service.data.rows[0].profileId,profile.id);assert.equal(service.data.shops[profile.id].name,'shop');
});
test('batch validates entire list first, edits sequentially across shops and never replays request',async t=>{
 const {service,scanner,store}=setup(t),other=store.addProfile('Shop 2');
 service.ingest(other.id,{shop:'shop2',rows:[row],total:1,pages:1,scannedAt:new Date().toISOString()});
 const [a,b]=service.data.rows,base=scanner.edit;let active=0,max=0,calls=[];
 scanner.edit=async(id,r,e,o)=>{active++;max=Math.max(max,active);calls.push([id,e.field,e.value]);await new Promise(resolve=>setTimeout(resolve,5));try{return await base(id,r,e,o);}finally{active--;}};
 const items=[{id:a.id,field:'price',expected:100000,value:120000},{id:a.id,field:'stock',expected:20,value:0},{id:b.id,field:'stock',expected:20,value:7}];
 await assert.rejects(service.editBatch({requestId:'batch-invalid-input',items:[items[0],{...items[1],value:-1}]}));assert.equal(calls.length,0);
 await assert.rejects(service.editBatch({requestId:'batch-duplicate-input',items:[items[0],items[0]]}),/nhiều lần/);assert.equal(calls.length,0);
 const result=await service.editBatch({requestId:'batch-sequential-valid',items});assert.equal(max,1);assert.equal(result.status,'completed');assert.deepEqual(result.items.map(i=>i.status),['verified','verified','verified']);assert.equal(a.price,120000);assert.equal(a.stock,0);assert.equal(b.stock,7);
 await service.editBatch({requestId:'batch-sequential-valid',items});assert.equal(calls.length,3);
});
test('batch records uncertain saves, continues other products, blocks same product and keeps Notion retries separate',async t=>{
 const {service,scanner,profile,setFail}=setup(t);service.ingest(profile.id,{shop:'shop',rows:[row,{...row,productId:'87654321'}],total:2,pages:1,scannedAt:new Date().toISOString()});
 const [a,b]=service.data.rows,base=scanner.edit;let calls=0;scanner.edit=async(id,r,e,o)=>{calls++;if(r.id===a.id){o.beforeSubmit();throw Error('connection lost');}return base(id,r,e,o);};setFail(true);
 const result=await service.editBatch({requestId:'batch-partial-error',items:[{id:a.id,field:'price',expected:100000,value:120000},{id:a.id,field:'stock',expected:20,value:0},{id:b.id,field:'stock',expected:20,value:0}]});
 assert.deepEqual(result.items.map(i=>i.status),['uncertain','failed','notion-pending']);assert.equal(calls,2);assert.equal(b.stock,0);
 setFail(false);await service.sync();assert.equal(calls,2);assert.equal(result.items[2].status,'verified');
 const restored=new Products(service.store.dir,service.store,service.i,scanner);assert.equal(restored.data.batch.status,'completed');assert.equal(calls,2);
});
test('stop finishes current item only; restart never resumes queued or ambiguous mutations',async t=>{
 const {service,scanner}=setup(t),r=service.data.rows[0],base=scanner.edit;let calls=0;scanner.edit=async(...args)=>{calls++;service.stopBatch();return base(...args);};
 const result=await service.editBatch({requestId:'batch-stop-current-only',items:[{id:r.id,field:'price',expected:100000,value:110000},{id:r.id,field:'stock',expected:20,value:0}]});assert.deepEqual(result.items.map(i=>i.status),['verified','cancelled']);assert.equal(result.status,'stopped');assert.equal(calls,1);
 service.data.batch.status='running';service.data.batch.items[0].status='running';service.data.batch.items[1].status='queued';service.data.actions[0].status='submitted';service.save();
 const restored=new Products(service.store.dir,service.store,service.i,scanner);assert.equal(restored.data.batch.status,'interrupted');assert.deepEqual(restored.data.batch.items.map(i=>i.status),['uncertain','cancelled']);assert.equal(calls,1);
});
