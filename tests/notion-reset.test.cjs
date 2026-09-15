const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const os=require('node:os');
const {Store}=require('../src/core.cjs');const {Integrations}=require('../src/integrations.cjs');const {indexSheet}=require('../src/sheets.cjs');
function setup(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'srm-notion-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const s=new Store(dir);const p=s.addProfile('Shop');s.ingest(p.id,[{orderId:'260915AAAAAA',shippingText:'Đã hủy',color:'red'}]);refresh(s);const i=new Integrations(s,()=>({}));i.setupNotion=async()=> 'db';return {s,i,o:s.data.orders[0]};}
function refresh(s){s.applySheet({...indexSheet('Mã đơn hàng,Mã vận đơn\n260915AAAAAA,SPX12345'),checkedAt:new Date().toISOString()});}
function server(i){let pages=[];let mutations=0,queries=0;i.notion=async(url,method,body)=>{
 if(url.endsWith('/query')){queries++;return {results:pages.filter(p=>!p.archived),has_more:false};}
 mutations++;
 if(url==='pages'){const p={id:'page-'+mutations,properties:structuredClone(body.properties)};pages.push(p);return p;}
 const page=pages.find(p=>'pages/'+p.id===url);Object.assign(page,structuredClone(body));return page;
 };return {get pages(){return pages;},get mutations(){return mutations;},get queries(){return queries;}};}
test('repeat scan, restart and lost local page id never create duplicate or rewrite unchanged row',async t=>{
 const {s,i,o}=setup(t),remote=server(i);assert.equal(await i.syncOrder(o),'created');assert.equal(remote.mutations,1);
 o.notionPageId=null;refresh(s);assert.equal(await i.syncOrder(o),'unchanged');assert.equal(remote.mutations,1);
 const reopened=new Store(s.dir);reopened.ingest(o.profileId,[{orderId:o.orderId,shippingText:o.shippingText,color:o.color}]);refresh(reopened);const again=new Integrations(reopened,()=>({}));again.setupNotion=i.setupNotion;again.notion=i.notion;
 assert.equal(await again.syncOrder(reopened.data.orders[0]),'unchanged');assert.equal(remote.pages.length,1);assert.equal(remote.mutations,1);
 s.setState(o.id,'shipper');assert.equal(await i.syncOrder(o),'updated');assert.equal(remote.pages.length,1);assert.equal(remote.mutations,2);
 assert.ok(!Object.hasOwn(remote.pages[0].properties,'Mã theo dõi'));assert.ok(!Object.hasOwn(remote.pages[0].properties,'Sheet nguồn'));assert.ok(!Object.hasOwn(remote.pages[0].properties,'Đối chiếu Sheet'));
});
test('manual deletion is detected remotely and recreated once despite cached page id',async t=>{
 const {s,i,o}=setup(t),remote=server(i);await i.syncOrder(o);remote.pages[0].archived=true;refresh(s);
 assert.equal(await i.syncOrder(o),'created');assert.equal(remote.pages.filter(p=>!p.archived).length,1);assert.equal(await i.syncOrder(o),'unchanged');
});
test('clear backs up rows, verifies empty, resets only Notion and waits for fresh scan',async t=>{
 const {s,i,o}=setup(t),remote=server(i);await i.syncOrder(o);o.telegramSentAt='sent';s.setState(o.id,'received');i.paused=true;
 const result=await i.clearNotion();assert.equal(result.archived,1);assert.equal(JSON.parse(fs.readFileSync(result.backup)).pages.length,1);
 assert.equal(s.data.notionClearPending,false);assert.equal(s.data.notionAwaitScan,true);assert.equal(s.visibleOrders().length,0);assert.equal(o.notionPageId,null);assert.equal(o.telegramSentAt,'sent');assert.equal(o.state,'received');
 s.data.settings.notionEnabled=true;i.paused=false;await i.drain();assert.equal(remote.pages.filter(p=>!p.archived).length,0);
 s.ingest(o.profileId,[{orderId:o.orderId,shippingText:o.shippingText,color:o.color}]);refresh(s);s.data.notionAwaitScan=false;await i.drain();assert.equal(remote.pages.filter(p=>!p.archived).length,1);
});
test('partial clear failure blocks writes across restart until retried',async t=>{
 const {s,i,o}=setup(t);i.paused=true;i.listPages=async()=>[{id:'a'},{id:'b'}];let patches=0;
 i.notion=async()=>{if(++patches===2)throw Error('offline');return {archived:true};};
 await assert.rejects(i.clearNotion(),/offline/);assert.equal(new Store(s.dir).data.notionClearPending,true);
 assert.equal(s.data.notionAwaitScan,true);assert.equal(s.visibleOrders().length,0);
 let calls=0;i.telegram=i.syncOrder=async()=>{calls++;};i.paused=false;s.data.settings.notionEnabled=true;await i.drain();assert.equal(calls,0);
});
test('query pagination completes before archive mutations',async t=>{
 const {i}=setup(t);let n=0;i.notion=async(url,method,body)=>{n++;if(n===1)return {results:[{id:'a'}],has_more:true,next_cursor:'next'};assert.equal(body.start_cursor,'next');return {results:[{id:'b'}],has_more:false};};
 assert.deepEqual((await i.listPages('db')).map(p=>p.id),['a','b']);
});
test('rename preserves account identity, evidence, processing state and notification history',t=>{
 const {s,o}=setup(t),id=o.profileId,key=o.id;s.setState(key,'shipper');o.telegramSentAt='sent';o.notionPageId='linked-page';
 const revision=o.revision;s.renameProfile(id,'  Shop mới  ');
 assert.equal(s.profile(id).name,'Shop mới');assert.equal(o.profileName,'Shop mới');assert.equal(o.id,key);assert.equal(o.profileId,id);
 assert.equal(o.state,'shipper');assert.equal(o.telegramSentAt,'sent');assert.equal(o.notionPageId,'linked-page');assert.equal(s.isEligible(o),true);assert.equal(o.revision,revision+1);
 const jobs=s.data.jobs.length;s.renameProfile(id,'Shop mới');assert.equal(s.data.jobs.length,jobs);assert.equal(o.revision,revision+1);
 for(const name of ['', '  ', 'x'.repeat(81), {},null])assert.throws(()=>s.renameProfile(id,name),/1–80/);
 const other=s.addProfile('Khác');assert.throws(()=>s.renameProfile(id,'Khác'),/profile khác/);
 assert.throws(()=>s.renameProfile(other.id,'Shop'),/profile khác/);assert.throws(()=>s.addProfile('Shop'),/profile khác/);
 assert.equal(new Store(s.dir).profile(id).name,'Shop mới');
});
test('repeated rename and restart reuse Notion row even with missing local link',async t=>{
 const {s,i,o}=setup(t),remote=server(i);await i.syncOrder(o);const pageId=o.notionPageId;
 s.renameProfile(o.profileId,'Tên hai');s.renameProfile(o.profileId,'Tên ba');o.notionPageId=null;s.save();
 const restored=new Store(s.dir);restored.ingest(o.profileId,[{orderId:o.orderId,shippingText:o.shippingText,color:o.color}]);refresh(restored);
 const again=new Integrations(restored,()=>({}));again.setupNotion=i.setupNotion;again.notion=i.notion;
 const order=restored.data.orders[0];assert.equal(await again.syncOrder(order),'updated');assert.equal(order.notionPageId,pageId);
 assert.equal(remote.pages.length,1);assert.equal(remote.pages[0].properties.Profile.rich_text[0].text.content,'Tên ba');
 assert.equal(await again.syncOrder(order),'unchanged');assert.equal(remote.mutations,2);
 restored.renameProfile(order.profileId,'Shop');assert.equal(await again.syncOrder(order),'updated');assert.equal(remote.pages.length,1);
});
test('renamed profile does not overwrite another shop or create when old/new names conflict',async t=>{
 const {s,i,o}=setup(t),remote=server(i);await i.syncOrder(o);s.renameProfile(o.profileId,'Mới');
 const other=structuredClone(remote.pages[0]);other.id='other';other.properties.Profile.rich_text[0].text.content='Khác';remote.pages.push(other);
 assert.equal(await i.syncOrder(o),'updated');assert.equal(remote.pages.length,2);assert.equal(other.properties.Profile.rich_text[0].text.content,'Khác');
 const duplicate=structuredClone(remote.pages[0]);duplicate.id='duplicate';duplicate.properties.Profile.rich_text[0].text.content='Shop';remote.pages.push(duplicate);
 const mutations=remote.mutations;await assert.rejects(i.syncOrder(o),/nhiều bản ghi/);assert.equal(remote.mutations,mutations);
});
