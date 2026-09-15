const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {Store}=require('../src/core.cjs');const {Integrations}=require('../src/integrations.cjs');const {indexSheet,matchSheet}=require('../src/sheets.cjs');
function setup(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'srm-strict-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return new Store(dir);}
const row={orderId:'260915AAAAAA',color:'red',shippingText:'Đã hủy'};
const sheet=csv=>({...indexSheet(csv),checkedAt:new Date().toISOString()});
const valid=()=>sheet('Mã đơn hàng,Mã vận đơn\n260915AAAAAA,SPX12345');
test('unmatched Shopee cancellation cannot be sent even if queued before Sheet fetch',async t=>{
 const s=setup(t),p=s.addProfile('Shop');s.ingest(p.id,[row]);s.data.settings.telegramEnabled=true;s.data.settings.notionEnabled=true;
 const i=new Integrations(s,()=>({}));let sent=0;i.telegram=i.syncOrder=async()=>{sent++;};
 await i.drain();assert.equal(sent,0,'Đơn chưa có mã vận đơn tuyệt đối không được gửi');
});
test('exact identifiers do not fold case, match prefixes or accept a placeholder tracking code',()=>{
 const r=sheet('Mã đơn hàng,Mã vận đơn\n260915AAAAAA,SPX12345\n260915BBBBBB,-');
 assert.equal(matchSheet('260915aaaaaa',r.index).sheetMatch,'not_found');
 assert.equal(matchSheet('260915AAAAA',r.index).sheetMatch,'not_found');
 assert.notEqual(matchSheet('260915BBBBBB',r.index).sheetMatch,'matched');
});
test('visibility requires fresh paired reads, survives dedup but not stale cache/restart',t=>{
 const s=setup(t),p=s.addProfile('Shop');s.ingest(p.id,[row]);assert.equal(s.visibleOrders().length,0);
 s.applySheet(valid());assert.equal(s.visibleOrders().length,1);const o=s.data.orders[0];s.setState(o.id,'shipper');
 const restarted=new Store(s.dir);assert.equal(restarted.visibleOrders().length,0);restarted.applySheet(valid());assert.equal(restarted.visibleOrders().length,0,'Sheet alone cannot revalidate old Shopee');
 assert.throws(()=>restarted.setState(o.id,'received'),/quét mới/);
 restarted.ingest(p.id,[row]);restarted.applySheet(valid());assert.equal(restarted.visibleOrders().length,1);assert.equal(restarted.data.orders[0].state,'shipper');
 assert.equal(restarted.data.jobs.filter(j=>j.kind==='telegram').length,1);
 restarted.currentScans.get(p.id).at=Date.now()-11*60000;assert.equal(restarted.visibleOrders().length,0);
});
test('disappearance, missing tracking, mixed duplicate rows and conflicts hide orders',t=>{
 const s=setup(t),p=s.addProfile('Shop');s.ingest(p.id,[row]);s.applySheet(valid());
 for(const csv of ['Mã đơn hàng,Mã vận đơn','Mã đơn hàng,Mã vận đơn\n260915AAAAAA,','Mã đơn hàng,Mã vận đơn\n260915AAAAAA,SPX12345\n260915AAAAAA,','Mã đơn hàng,Mã vận đơn\n260915AAAAAA,SPX12345\n260915AAAAAA,SPX99999','Mã đơn hàng,Mã vận đơn\n260915AAAAAA,SPX12345\n260915BBBBBB,SPX12345']){
  s.applySheet(sheet(csv));assert.equal(s.visibleOrders().length,0,csv);
 }
 s.applySheet(valid());assert.equal(s.visibleOrders().length,1);s.ingest(p.id,[]);s.applySheet(valid());assert.equal(s.visibleOrders().length,0);
});
test('failed profile cannot inherit another profile successful scan or retry queue',async t=>{
 const s=setup(t),p=s.addProfile('A'),q=s.addProfile('B');s.ingest(p.id,[row]);s.ingest(q.id,[row]);s.applySheet(valid());assert.equal(s.visibleOrders().length,2);
 s.invalidate([p.id]);s.ingest(q.id,[row]);s.applySheet(valid(),[q.id]);assert.equal(s.visibleOrders().length,1);
 s.data.settings.telegramEnabled=true;const i=new Integrations(s,()=>({}));const sent=[];i.telegram=async o=>sent.push(o.profileId);await i.drain();assert.deepEqual(sent,[q.id]);
});
test('late tracking qualifies once without losing state or sending repeat notifications',async t=>{
 const s=setup(t),p=s.addProfile('Shop');s.ingest(p.id,[row]);s.applySheet(sheet('Mã đơn hàng,Mã vận đơn'));s.data.settings.telegramEnabled=true;
 const i=new Integrations(s,()=>({}));let sent=0;i.telegram=async o=>{sent++;o.telegramSentAt='sent';};await i.drain();assert.equal(sent,0);
 s.ingest(p.id,[row]);s.applySheet(valid());await i.drain();assert.equal(sent,1);
 s.ingest(p.id,[row]);s.applySheet(valid());await i.drain();assert.equal(sent,1);assert.equal(s.visibleOrders().length,1);
});
