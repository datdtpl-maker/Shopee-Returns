const {test}=require('node:test');const assert=require('node:assert/strict');const {chromium}=require('playwright');
const {readVisibleRows,Scanner}=require('../src/scanner.cjs');
const fixture=(count=2)=>`<style>body{margin:0;font:14px Arial}.head{display:grid;grid-template-columns:500px 200px;height:50px;position:sticky;top:0;background:white}.card{height:180px;border:1px solid #ddd}.body{display:grid;grid-template-columns:500px 200px}.red{color:rgb(230,60,70)}.green{color:rgb(80,180,110)}</style><div class="head"><div>Trạng thái</div><div>Vận chuyển chiều giao hàng</div></div>${Array.from({length:count},(_,n)=>`<div class="card"><div><span>Mã đơn hàng <a>260901ABC${String(n).padStart(4,'0')}</a></span> | <span>Mã yêu cầu trả hàng RETURN0000${n}</span></div><div class="body"><div class="red">KHÔNG ĐƯỢC LẤY CHỮ NÀY</div><div><span class="${n%2?'red':'green'}">${n%2?'Giao hàng không thành công':'Đã giao'}</span><p>SPX Express</p></div></div></div>`).join('')}`;
test('extracts only shipping-column labels, including rows below viewport',async t=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1200,height:700}});await page.setContent(fixture(20));
 const rows=await page.evaluate(readVisibleRows);assert.equal(rows.rows.length,20);assert.equal(rows.rows[0].shippingText,'Đã giao');assert.equal(rows.rows[1].shippingText,'Giao hàng không thành công');
 const result=await new Scanner('.').collect(page);assert.equal(result.rows.length,20);assert.equal(result.unresolved,0);assert.ok(await page.evaluate(()=>scrollY)>0);
});
test('missing column and unrecognized data produce errors instead of an empty successful scan',async t=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());const page=await browser.newPage();await page.setContent('<h1>Đăng nhập</h1>');
  assert.equal((await page.evaluate(readVisibleRows)).heading,false);
  await page.setContent('<div>Vận chuyển chiều giao hàng</div><div>0 Yêu cầu</div>');assert.equal((await page.evaluate(readVisibleRows)).empty,false);
  await page.setContent('<h1>Đăng nhập</h1>');
 await assert.rejects(new Scanner('.').collect(page),/Không tìm thấy/);
 await page.setContent('<div>Vận chuyển chiều giao hàng</div><div>Loading unknown layout</div>');
 await assert.rejects(new Scanner('.').collect(page),/chưa xác định/);
});
test('explicit empty Shopee page succeeds with zero orders',async t=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());const page=await browser.newPage();await page.setContent('<div>Vận chuyển chiều giao hàng</div><div>0 Yêu cầu</div><div>Không có yêu cầu</div>');assert.equal((await new Scanner('.').collect(page)).rows.length,0);
});
test('real Shopee column structure excludes reverse shipping, neutral tags and resize sensors',async t=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1200,height:700}});
 await page.setContent(`<style>.return-row-item{display:block;height:300px}.eds-tag{color:rgb(50,180,90)}.error{color:rgb(240,50,60)}.neutral{color:rgb(237,165,0)}.resize-triggers{height:200px;overflow:scroll}</style><span class="header-text">Vận chuyển chiều giao hàng</span><div class="return-table-content">${['Chờ xác nhận','Đã hoàn tiền'].map(status=>`<a class="return-row-item"><div class="order-id"><span class="id-content">260901ABC0000</span></div><div class="item-request-status"><div><div>${status}</div></div></div><div class="item-logistics item-forward-logistic"><div class="tag"><span class="eds-tag error">Giao hàng không thành công</span></div></div><div class="item-return-logistic"><span class="eds-tag">Đã giao</span></div></a>`).join('')}<a class="return-row-item"><div class="order-id"><span class="id-content">260901ABC0001</span></div><div class="item-logistics item-forward-logistic"><div class="tag"><span class="eds-tag neutral">Chưa lấy hàng</span></div></div></a></div><div class="resize-triggers"><div style="height:1000px"></div></div>`);
 const result=await new Scanner('.').collect(page);assert.equal(result.rows.length,1);assert.equal(result.totalOrders,2);assert.equal(result.ignored,1);assert.equal(result.unresolved,0);
 assert.equal(result.rows[0].shippingText,'Giao hàng không thành công');assert.equal(result.rows[0].orderStatus,'Chờ xác nhận | Đã hoàn tiền');
 assert.equal(await page.locator('.resize-triggers').evaluate(e=>e.scrollTop),0);
});

