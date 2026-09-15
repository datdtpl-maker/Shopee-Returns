const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const os=require('node:os');
const {Store}=require('../src/core.cjs');const {Integrations}=require('../src/integrations.cjs');
const {indexSheet}=require('../src/sheets.cjs');
function qualify(s){s.applySheet({...indexSheet('Mã đơn hàng,Mã vận đơn\n260901UJXBROPV,SPX12345'),checkedAt:new Date().toISOString()});}
function setup(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'srm-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return new Store(dir);}
const row={orderId:'260901UJXBROPV',shippingText:'Đã giao',color:'green'};
test('dedup persists through restart and shipping changes do not requeue Telegram',t=>{
 const s=setup(t);const p=s.addProfile('Shop 1');assert.equal(s.ingest(p.id,[row,row]),1);
 const reopened=new Store(s.dir);assert.equal(reopened.ingest(p.id,[row]),0);
 reopened.ingest(p.id,[{...row,shippingText:'Giao hàng không thành công',color:'red'}]);
 assert.equal(reopened.data.orders.length,1);assert.equal(reopened.data.jobs.filter(j=>j.kind==='telegram').length,1);
 assert.equal(reopened.data.orders[0].shippingText,'Giao hàng không thành công');
});
test('same order across separate profiles is independently tracked',t=>{
 const s=setup(t);for(const name of ['A','B'])s.ingest(s.addProfile(name).id,[row]);assert.equal(s.data.orders.length,2);
});
test('processing actions persist and repeated clicks are idempotent',t=>{
 const s=setup(t);s.ingest(s.addProfile('Shop').id,[row]);qualify(s);const o=s.data.orders[0];s.setState(o.id,'shipper');s.setState(o.id,'shipper');
 assert.equal(o.revision,3);s.setState(o.id,'received');assert.equal(new Store(s.dir).data.orders[0].state,'received');
 assert.equal(s.data.jobs.filter(j=>j.kind==='notion').length,5);assert.throws(()=>s.setState(o.id,'wrong'));
});
test('failed Telegram is retried without treating the message as sent',async t=>{
 const s=setup(t);s.ingest(s.addProfile('Shop').id,[row]);qualify(s);s.data.settings.telegramEnabled=true;const i=new Integrations(s,()=>({}));let attempts=0;
 i.telegram=async o=>{attempts++;if(attempts===1)throw Error('offline');o.telegramSentAt='sent';};
 await i.drain();const j=s.data.jobs.find(j=>j.kind==='telegram');assert.equal(j.status,'pending');assert.equal(s.data.orders[0].telegramSentAt,null);
 j.nextAt=0;await i.drain();await i.drain();assert.equal(attempts,2);assert.equal(j.status,'done');
});
test('disabled integrations retain queued orders and drain cannot overlap',async t=>{
 const s=setup(t);s.ingest(s.addProfile('Shop').id,[row]);qualify(s);const i=new Integrations(s,()=>({}));let sends=0;i.telegram=async()=>{sends++;await new Promise(r=>setTimeout(r,15));};
 await i.drain();assert.equal(sends,0);s.data.settings.telegramEnabled=true;await Promise.all([i.drain(),i.drain()]);assert.equal(sends,1);
});
test('Notion recovers an existing row before creating and preserves new revisions',async t=>{
 const s=setup(t);s.ingest(s.addProfile('Shop').id,[row]);qualify(s);const i=new Integrations(s,()=>({}));const o=s.data.orders[0];const calls=[];
 i.setupNotion=async()=> 'database';i.notion=async(endpoint,method,body)=>{calls.push({endpoint,method,body});if(endpoint.endsWith('/query'))return {results:[{id:'existing',properties:{'Mã đơn hàng':{title:[{plain_text:o.orderId}]},Profile:{rich_text:[{plain_text:o.profileName}]}}}],has_more:false};o.revision++;return {id:'existing'};};
 await i.syncOrder(o);assert.equal(calls.at(-1).method,'PATCH');assert.equal(o.notionPageId,'existing');assert.equal(o.notionSyncedRevision,2);assert.equal(o.revision,3);
});

