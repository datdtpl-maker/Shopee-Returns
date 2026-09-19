const {_electron}=require('playwright');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const {Store}=require('../src/core.cjs');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'srm-ui-'));let app;
 try {
  const s=new Store(dir),p=s.addProfile('Cửa hàng kiểm thử <img src=x>');
  s.ingest(p.id,[{orderId:'260901TEST001',shippingText:'Đã giao',color:'green',orderStatus:'Người mua đang trả hàng'},{orderId:'260901TEST002',shippingText:'Giao hàng không thành công',color:'red'},{orderId:'260901TEST003',shippingText:'Đã hủy',color:'red'}]);
  s.data.orders[0].trackingNumbers=['SPXVN0123456789'];s.data.orders[0].sheetMatch='matched';s.save();
  app=await _electron.launch({args:['.'],cwd:path.resolve(__dirname,'..'),env:{...process.env,SRM_DATA_DIR:dir,SRM_DRIVER:'1'}});
  const page=await app.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.waitForFunction(()=>!!window.srm);assert.equal((await page.evaluate(()=>window.srm.call('snapshot'))).orders.length,0,'Never show persisted matches before reading fresh sources');
  await app.evaluate(({app})=>{
    const store=app.srmDriver.store;
    app.srmDriver.scanner.scan=async()=>({rows:store.data.orders.map(o=>({orderId:o.orderId,shippingText:o.shippingText,color:o.color})),totalOrders:3,ignored:0,unresolved:0});
    globalThis.fetch=async()=>({ok:true,text:async()=> 'Mã đơn hàng,Mã vận đơn\n260901TEST001,SPX111111\n260901TEST002,SPXVN0123456789'});
  });
  await page.evaluate(()=>window.srm.call('scan'));
  await page.locator('#order-rows tr:not(.shipping-group)').first().waitFor();assert.equal(await page.locator('#order-rows tr:not(.shipping-group)').count(),2);
  assert.equal(await page.locator('#order-rows img').count(),0);
  await page.locator('#group-shipping').click();
  assert.equal(await page.locator('#group-shipping').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('.shipping-group').count(),2);
  await page.locator('#search').fill('SPXVN0123456789');
  assert.equal(await page.locator('.shipping-group').count(),1);
  assert.equal(await page.locator('.group-count').textContent(),'1 đơn');
  await page.locator('#search').fill('');
  await app.evaluate(({app})=>{
    const store=app.srmDriver.store;
    app.srmDriver.scanner.scan=async()=>({rows:store.data.orders.map(o=>({orderId:o.orderId,shippingText:'Đã giao',color:'green'})),totalOrders:3,ignored:0,unresolved:0});
  });
  await page.evaluate(()=>window.srm.call('scan'));
  assert.equal(await page.locator('.shipping-group').count(),1);
  assert.equal(await page.locator('.group-count').textContent(),'2 đơn');
  assert.equal(await page.locator('#result-count').textContent(),'2');
  await page.reload();await page.locator('.shipping-group').waitFor();
  assert.equal(await page.locator('#group-shipping').getAttribute('aria-pressed'),'true');
  await page.locator('#group-shipping').click();assert.equal(await page.locator('.shipping-group').count(),0);
  await page.locator('#group-shipping').click();
  await page.locator('#search').fill('SPXVN0123456789');assert.equal(await page.locator('#order-rows tr:not(.shipping-group)').count(),1);await page.locator('#search').fill('');
  assert.equal(await page.locator('[data-order],#state-filter,.process').count(),0);
  assert.equal(await page.locator('#orders thead th').count(),4);
  assert.equal(await page.evaluate(()=>window.srm.call('order-state','any','received').then(()=>false).catch(()=>true)),true);
  await page.locator('nav [data-tab="profiles"]').click();
  await page.getByRole('button',{name:'Sửa tên',exact:true}).click();
  assert.equal(await page.locator('#rename-name').inputValue(),p.name);
  await page.locator('#rename-name').fill('Chưa lưu');await page.locator('#rename-cancel').click();assert.equal(new Store(dir).profile(p.id).name,p.name);
  await page.getByRole('button',{name:'Sửa tên',exact:true}).click();
  await page.locator('#rename-name').fill('   ');await page.locator('#rename-save').click();await page.waitForFunction(()=>document.querySelector('#rename-error').textContent.includes('1–80'));
  await page.locator('#rename-name').fill('Shop mới <img src=x>');
  await page.evaluate(async()=>{const d=await window.srm.call('snapshot');await window.srm.call('toggle-profile',d.profiles[0].id,true);});
  assert.equal(await page.locator('#rename-name').inputValue(),'Shop mới <img src=x>','Draft survives snapshot render');
  await page.locator('#rename-save').click();await page.waitForFunction(()=>!document.querySelector('#rename-dialog').open);
  assert.equal(await page.locator('#profile-list h2').textContent(),'Shop mới <img src=x>');assert.equal(await page.locator('#profile-list img').count(),0);
  const renamed=new Store(dir);assert.equal(renamed.profile(p.id).name,'Shop mới <img src=x>');assert.ok(renamed.data.orders.every(o=>o.profileId===p.id&&o.profileName==='Shop mới <img src=x>'));
  assert.ok((await page.locator('#profile-filter').textContent()).includes('Shop mới <img src=x>'));
  await page.getByRole('button',{name:'Sửa tên',exact:true}).click();await page.keyboard.press('Escape');assert.equal(await page.locator('#rename-dialog').isVisible(),false);
  await page.locator('nav [data-tab="settings"]').click();assert.ok(await page.locator('#sheet-url').inputValue());
  await page.locator('#interval').fill('7');await page.getByRole('button',{name:'Lưu cài đặt',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#toast').textContent==='Đã lưu cài đặt.');
  assert.equal(new Store(dir).data.settings.intervalMinutes,7);
  const validation=await page.evaluate(()=>window.srm.call('settings',{intervalMinutes:0}).then(()=>false).catch(()=>true));assert.equal(validation,true);
  for(const width of [1440,780,390]) {
    await app.evaluate(({BrowserWindow},w)=>{const win=BrowserWindow.getAllWindows()[0];win.setMinimumSize(360,500);win.setSize(w,900);},width);
    for(const view of ['orders','products','profiles','settings','activity']){
      await page.locator(`nav [data-tab="${view}"]`).click();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`page overflow: ${view} ${width}`);
    }
  }
  await page.evaluate(()=>window.srm.call('settings',{intervalMinutes:7,autoScan:true,telegramEnabled:false,notionEnabled:false,chatId:''}));
  await app.evaluate(({app})=>{
    const realNow=Date.now;
    app.srmDriver.scanner.scan=async()=>{Date.now=realNow;return {rows:[{orderId:'260901TEST001',shippingText:'Đã giao',color:'green'}],totalOrders:1,ignored:0,unresolved:0};};
    Date.now=()=>realNow()+8*60*1000;
  });
  const beforeSchedule=(await page.evaluate(()=>window.srm.call('snapshot'))).profiles[0].lastScan;
  const deadline=Date.now()+15000;let scheduled;
  do {scheduled=await page.evaluate(()=>window.srm.call('snapshot'));if(scheduled.profiles[0].lastScan!==beforeSchedule&&!scheduled.scanning)break;await new Promise(r=>setTimeout(r,100));}while(Date.now()<deadline);
  assert.notEqual(scheduled.profiles[0].lastScan,beforeSchedule,'Scheduler must complete a new scan');
  assert.ok(new Store(dir).data.profiles[0].lastScan);
  assert.equal(scheduled.orders.length,1,'Order no longer seen in Shopee is excluded');
  await app.evaluate(()=>{globalThis.fetch=async()=>{throw Error('Sheet offline test');};});
  await page.evaluate(()=>window.srm.call('refresh-sheet'));
  const failed=await page.evaluate(()=>window.srm.call('snapshot'));assert.equal(failed.orders.length,0);assert.match(failed.sheet.error,/offline/);
  assert.equal(await page.locator('#total').textContent(),'0');
  await page.locator('nav [data-tab="settings"]').click();
  await app.evaluate(({app,dialog})=>{
    const i=app.srmDriver.integrations;i.setupNotion=async()=> 'test-db';let archived=false;
    i.notion=async(endpoint,method,body)=>endpoint.endsWith('/query')?{results:archived?[]:[{id:'test-only-page'}],has_more:false}:(archived=true,{id:'test-only-page',archived:true});
    dialog.showMessageBox=async()=>({response:0});
  });
  const cancel=await page.evaluate(()=>window.srm.call('clear-notion'));assert.equal(cancel.cancelled,true);
  assert.equal((await page.evaluate(()=>window.srm.call('snapshot'))).notionAwaitScan,false);
  await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});
  await page.locator('#settings [data-clear-notion]').click();
  const clearDeadline=Date.now()+5000;let cleared;
  do{cleared=await page.evaluate(()=>window.srm.call('snapshot'));if(cleared.notionAwaitScan&&!cleared.clearingNotion)break;await new Promise(r=>setTimeout(r,50));}while(Date.now()<clearDeadline);
  assert.equal(cleared.notionAwaitScan,true);assert.equal(cleared.notionClearPending,false);assert.equal(cleared.nextScan,null);
  assert.equal(fs.readdirSync(path.join(dir,'notion-backups')).length,1);
  assert.equal(new Store(dir).data.orders.find(o=>o.orderId==='260901TEST002').state,'new');
  assert.deepEqual(errors,[]);console.log('PASS: Electron UI, XSS escaping, tracking search, raw-only view and blocked processing IPC, persisted settings, shipping groups/counts/filtering/persistence, 12 responsive layouts, scheduled scan with advanced test clock.');
 }finally{if(app)await app.close();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});

