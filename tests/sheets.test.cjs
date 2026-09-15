const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {parseCsv,indexSheet,matchSheet,sheetUrl}=require('../src/sheets.cjs');const {Store}=require('../src/core.cjs');
test('CSV preserves BOM, commas, escaped quotes and line breaks',()=>{
 assert.deepEqual(parseCsv('\uFEFFa,b\r\n"x,y","a""b\nc"\r\n'),[['a','b'],['x,y','a"b\nc']]);
 assert.throws(()=>parseCsv('a,"unfinished'),/chưa hoàn chỉnh/);
});
test('matches order IDs exactly and flags conflicting tracking rather than picking first',()=>{
 const {index,count}=indexSheet(' ,Mã vận đơn,Mã đơn hàng,Tình trạng\t\r\n1,SPX01,260901AAAAAA,Đã gửi\r\n2,SPX02,260901AAAAAA,Đã gửi\r\n3,,260901BBBBBB,\r\n4,SPX03,260901CCCCCC,Đã nhận');
 assert.equal(count,4);assert.equal(matchSheet('260901AAAAAA',index).sheetMatch,'conflict');
 assert.deepEqual(matchSheet('260901AAAAAA',index).trackingNumbers,['SPX01','SPX02']);
 assert.equal(matchSheet('260901BBBBBB',index).sheetMatch,'missing_tracking');
 assert.equal(matchSheet(' 260901CCCCCC ',index).sheetMatch,'matched');
 assert.equal(matchSheet('260901cccccc',index).sheetMatch,'not_found');
 assert.equal(matchSheet('260901AAA',index).sheetMatch,'not_found');
});
test('rejects login HTML, wrong headers and untrusted sheet URLs',()=>{
 assert.throws(()=>indexSheet('<html>Login</html>'),/quyền truy cập/);
 assert.throws(()=>indexSheet('x,y\n1,2'),/cột Mã đơn/);
 assert.throws(()=>sheetUrl('http://localhost/file'));
 assert.throws(()=>sheetUrl('https://docs.google.com.evil.com/spreadsheets/d/abc'));
 assert.match(sheetUrl('https://docs.google.com/spreadsheets/d/abc/edit#gid=42'),/gid=42$/);
});
test('sheet enrichment persists and queues Notion only on meaningful change',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'srm-sheet-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const s=new Store(dir),p=s.addProfile('Shop');s.ingest(p.id,[{orderId:'260901AAAAAA',shippingText:'Đã giao',color:'green'}]);
 const result={...indexSheet('Mã đơn hàng,Mã vận đơn,Tình trạng\n260901AAAAAA,SPXVN1234,Đã gửi'),checkedAt:new Date().toISOString()};
 s.applySheet(result);const revision=s.data.orders[0].revision;s.applySheet({...result,checkedAt:new Date().toISOString()});
 assert.equal(s.data.orders[0].revision,revision);assert.equal(new Store(dir).data.orders[0].trackingNumbers[0],'SPXVN1234');
 assert.equal(s.data.jobs.filter(j=>j.kind==='telegram').length,1);
});
test('invalid batch does not leave partially ingested orders',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'srm-batch-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const s=new Store(dir),p=s.addProfile('Shop');
 assert.throws(()=>s.ingest(p.id,[{orderId:'260901AAAAAA',shippingText:'Đã giao',color:'green'},{orderId:'bad'}]));assert.equal(s.data.orders.length,0);
});
