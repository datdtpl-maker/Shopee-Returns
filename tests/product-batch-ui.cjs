const {_electron}=require('playwright');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const {Store}=require('../src/core.cjs');
(async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'srm-batch-ui-'));let app;try{
 const store=new Store(dir);store.addProfile('Shop chính');store.addProfile('Shop phụ');store.data.settings.autoScan=false;store.save();
 app=await _electron.launch({args:['.'],cwd:path.resolve(__dirname,'..'),env:{...process.env,SRM_DATA_DIR:dir,SRM_DRIVER:'1'}});
 const page=await app.firstWindow();await page.waitForFunction(()=>!!window.srm);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const ids=await app.evaluate(({app})=>{
  const {products:p,store:s}=app.srmDriver;
  for(const [index,profile] of s.data.profiles.entries())p.ingest(profile.id,{shop:'shop'+index,total:1,pages:1,scannedAt:new Date().toISOString(),rows:[{productId:String(123+index),modelId:String(456+index),name:(index?'Beta':'Alpha')+' <img src=x>',variant:'Hộp',price:100000,stock:20}]});
  p.sync=async()=>{p.data.rows.forEach(r=>r.sync='synced');};globalThis.edits=[];globalThis.returnCalls=0;
  p.scanner.edit=async(id,r,e,o)=>{globalThis.edits.push({id:r.id,...e});if(globalThis.holdEdit)await new Promise(resolve=>globalThis.finishEdit=resolve);if(e.value===999)throw Error('Shopee đã đổi giá trị');o.beforeSubmit();return {row:{...r,[e.field]:e.value}};};
  app.srmDriver.scanner.scan=async()=>{globalThis.returnCalls++;return {rows:[],totalOrders:0,ignored:0,unresolved:0};};globalThis.fetch=async()=>({ok:true,text:async()=> 'Mã đơn hàng,Mã vận đơn\n260901TEST001,SPX123'});
  return p.data.rows.map(r=>r.id);
 });
 await page.reload();await page.locator('nav [data-tab="products"]').click();
 const input=(id,field)=>page.locator('[data-batch-id="'+id+'"][data-batch-field="'+field+'"]');
 await page.locator('#product-search').fill('Alpha');await page.locator('#products-bulk').click();await input(ids[0],'price').fill('120000');await input(ids[0],'stock').fill('0');await page.locator('#batch-close').click();assert.equal(await app.evaluate(()=>globalThis.edits.length),0);
 await page.reload();await page.locator('nav [data-tab="products"]').click();await page.locator('#product-search').fill('Alpha');await page.locator('#products-bulk').click();assert.equal(await input(ids[0],'stock').inputValue(),'0');assert.equal(await input(ids[0],'price').inputValue(),'120000');assert.equal(await page.locator('#batch-entry-rows img').count(),0);
 // Incoming snapshots may update the rest of the screen but must preserve draft/focus.
 await page.evaluate(()=>window.srm.call('products-stop-batch'));assert.equal(await input(ids[0],'price').inputValue(),'120000');await page.locator('#batch-close').click();
 await page.locator('#product-search').fill('Beta');await page.locator('#products-bulk').click();await input(ids[1],'stock').fill('999');await page.locator('#batch-preview').click();assert.equal(await page.locator('#batch-review-rows tr').count(),3);assert.equal(await app.evaluate(()=>globalThis.edits.length),0);
 for(const width of [1440,780,390]){
  await app.evaluate(({BrowserWindow},w)=>{const win=BrowserWindow.getAllWindows()[0];win.setMinimumSize(360,500);win.setSize(w,900);},width);
  assert.ok(await page.evaluate(()=>{const r=document.querySelector('#batch-dialog').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&document.documentElement.scrollWidth<=innerWidth;}));
 }
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1440,960));
 if(process.env.SRM_BATCH_SCREENSHOT)await page.screenshot({path:process.env.SRM_BATCH_SCREENSHOT});
 await page.evaluate(()=>window.srm.call('settings',{autoScan:true,intervalMinutes:1,notionEnabled:false,telegramEnabled:false}));const due=(await page.evaluate(()=>window.srm.call('snapshot'))).nextScan;
 await app.evaluate(()=>{globalThis.holdEdit=true;});await page.locator('#batch-run').click();await page.waitForFunction(async()=> (await window.srm.call('snapshot')).products.batch?.items[0].status==='running');await page.waitForFunction(()=>!document.querySelector('#batch-dialog').open);
 assert.equal(await page.locator('#products-bulk').isDisabled(),true);
 await app.evaluate(()=>{globalThis.realNow=Date.now;Date.now=()=>globalThis.realNow()+120000;});await page.waitForTimeout(5500);assert.equal(await app.evaluate(()=>globalThis.returnCalls),0);assert.equal((await page.evaluate(()=>window.srm.call('snapshot'))).nextScan,due);
 await assert.rejects(page.evaluate(()=>window.srm.call('products-edit-batch',{requestId:'batch-overlap-forbidden',items:[]})),/bận/);
 await app.evaluate(()=>{globalThis.holdEdit=false;globalThis.finishEdit();});await page.waitForFunction(async()=> (await window.srm.call('snapshot')).products.batch?.status==='completed');
 const completed=await page.evaluate(()=>window.srm.call('snapshot'));assert.deepEqual(completed.products.batch.items.map(i=>i.status),['verified','verified','failed']);assert.equal(completed.products.rows[0].stock,0);assert.equal(await app.evaluate(()=>globalThis.edits.length),3);
 await page.waitForFunction(async()=>!(await window.srm.call('snapshot')).scanning);assert.equal(await app.evaluate(()=>globalThis.returnCalls),2,'Each profile returns scan resumes after batch');await app.evaluate(()=>{Date.now=globalThis.realNow;});
 await page.waitForFunction(()=>document.querySelector('#products-bulk').textContent==='Sửa hàng loạt');assert.equal(await page.locator('#batch-result-rows tr').count(),3);
 await page.locator('#product-search').fill('');await page.locator('#products-bulk').click();await input(ids[0],'stock').fill('5');await input(ids[1],'price').fill('130000');await page.locator('#batch-preview').click();await app.evaluate(()=>{globalThis.holdEdit=true;});await page.locator('#batch-run').click();await page.waitForFunction(async()=> (await window.srm.call('snapshot')).products.batch?.items[0].status==='running');await page.locator('#batch-stop').click();await app.evaluate(()=>{globalThis.holdEdit=false;globalThis.finishEdit();});await page.waitForFunction(async()=> (await window.srm.call('snapshot')).products.batch?.status==='stopped');assert.equal(await app.evaluate(()=>globalThis.edits.length),4);
 assert.deepEqual((await page.evaluate(()=>window.srm.call('snapshot'))).products.batch.items.map(i=>i.status),['verified','cancelled']);assert.deepEqual(errors,[]);
 console.log('PASS batch UI: multi-shop drafts across filters/reload, review before run, zero stock, field failure, progress, stop, responsive dialog and overdue returns lock.');
}finally{if(app)await app.close();fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
