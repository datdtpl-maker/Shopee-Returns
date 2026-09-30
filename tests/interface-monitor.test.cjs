const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const {chromium}=require('playwright');const {InterfaceMonitor}=require('../src/interface-monitor.cjs');const {Scanner}=require('../src/scanner.cjs');const {ProductScanner}=require('../src/product-scanner.cjs');
const returns=(color='rgb(40,150,70)',id='260921ABCDEFG')=>'<div class="header-text">Vận chuyển chiều giao hàng</div><div class="return-table-content"><div class="return-row-item"><div class="order-id"><b class="id-content">'+id+'</b></div><div class="item-logistics item-forward-logistic"><span class="tag"><span class="eds-tag" style="color:'+color+'">Đã giao</span></span></div></div></div>';
const product=()=>'<div class="account-info"><span class="subaccount-name">shop</span></div><div class="list-header-title">1 Sản Phẩm</div><input placeholder="Tìm Tên sản phẩm, SKU sản phẩm, SKU phân loại, Mã sản phẩm"><table><tr><td><div class="product-variation-item"><span class="item-id">ID Sản phẩm: 123</span><a class="product-name-wrap">Sản phẩm thử</a><span>Model ID: 456</span><div class="list-view-price">₫100.000</div><span class="stock-content"><span class="stock-text">20</span></span></div></td></tr></table><div class="product-list-pagination"><span class="eds-pagination-sizes__content">48/trang</span><span class="eds-pager__current">1</span><span class="eds-pager__total">1</span><button class="eds-pager__button-next" disabled>Tiếp</button></div>';
async function setup(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'srm-interface-'));const browser=await chromium.launch({channel:'chrome',headless:true});t.after(async()=>{await browser.close();fs.rmSync(dir,{force:true,recursive:true});});return {dir,page:await browser.newPage(),monitor:new InterfaceMonitor(dir)};}
test('dynamic orders and an explicit empty list do not drift; shipping color changes block scanning and survive restart',async t=>{
 const {dir,page,monitor}=await setup(t);await page.setContent(returns());await monitor.check('p','returns','list',page);
 await page.setContent(returns('rgb(40,150,70)','260921HIJKLMN'));await monitor.check('p','returns','list',page);
 await page.setContent('<div class="header-text">Vận chuyển chiều giao hàng</div><p>Không có yêu cầu</p>');await monitor.check('p','returns','list',page);
 await page.setContent(returns('rgb(50,60,230)'));const scanner=new Scanner(dir,monitor);await assert.rejects(scanner.collect(page,'p'),e=>e.code==='INTERFACE_CHANGED');
 let r=monitor.snapshot()[0];assert.equal(r.status,'changed');assert.equal(r.canAccept,false);assert.ok(r.image);assert.ok(fs.existsSync(monitor.reportPath(r.id)));
 assert.equal(new InterfaceMonitor(dir).snapshot()[0].status,'changed');assert.throws(()=>monitor.accept(r.id));
 await page.setContent(returns());await monitor.check('p','returns','list',page);assert.equal(monitor.snapshot()[0].status,'ok');
});
test('missing selectors/hidden CSS stop first-run probes; semantic colors cannot be accepted and structural reports contain no HTML secrets',async t=>{
 const {page,monitor}=await setup(t);await page.setContent(returns().replace('item-forward-logistic','changed-column')+'<script>window.secret="DO_NOT_STORE"</script><input value="DO_NOT_STORE">');
 await assert.rejects(monitor.check('p','returns','list',page));let r=monitor.snapshot()[0];assert.match(r.issues.join(' '),/Thiếu cột/);assert.equal(r.canAccept,false);assert.ok(!fs.readFileSync(monitor.reportPath(r.id),'utf8').includes('DO_NOT_STORE'));
 await page.setContent(returns());await monitor.check('p','returns','list',page);
 await page.addStyleTag({content:'.eds-tag{display:none}'});await assert.rejects(monitor.check('p','returns','list',page));assert.match(monitor.snapshot()[0].issues.join(' '),/CSS ẩn/);
});
test('CSS baseline drift requires explicit acceptance; login/network does not poison baseline or hide an existing alert',async t=>{
 const {page,monitor}=await setup(t);await page.setContent(product());await monitor.check('p','products','list',page,{deep:true});
 await page.addStyleTag({content:'.list-header-title{font-size:25px}'});await assert.rejects(monitor.check('p','products','list',page));let r=monitor.snapshot()[0];assert.equal(r.canAccept,true);
 await page.setContent('<h1>Đăng nhập Shopee</h1><input type="password">');await assert.rejects(monitor.check('p','products','list',page));assert.equal(monitor.snapshot()[0].status,'changed');assert.equal(monitor.snapshot()[0].canAccept,false);
 await page.setContent(product()+'<style>.list-header-title{font-size:25px}</style>');await assert.rejects(monitor.check('p','products','list',page));monitor.accept(r.id);await monitor.check('p','products','list',page);
 await page.setContent('');await assert.rejects(monitor.check('p','products','list',page));assert.equal(monitor.snapshot()[0].status,'unavailable');
 await page.setContent(product()+'<style>.list-header-title{font-size:25px}</style>');await monitor.check('p','products','list',page);
 await page.setContent('<h1>Đăng nhập Shopee</h1><input type="password">');await monitor.failure('p','products','list',page,Error('timeout'));assert.equal(monitor.snapshot()[0].status,'unavailable');assert.match(monitor.snapshot()[0].issues.join(' '),/đăng nhập/);
});
test('product values and counts are ignored; missing price, search, pagination and 48 option are detected',async t=>{
 const {page,monitor}=await setup(t);await page.setContent(product());await monitor.check('p','products','list',page,{deep:true});
 await page.locator('.list-header-title').evaluate(e=>e.textContent='222 Sản Phẩm');await page.locator('.list-view-price').evaluate(e=>e.textContent='₫999.000');await monitor.check('p','products','list',page,{deep:true});
 await page.locator('.list-view-price').evaluate(e=>e.remove());await assert.rejects(monitor.check('p','products','list',page,{deep:true}));
 await page.setContent(product().replace('placeholder="Tìm','placeholder="Đổi'));await assert.rejects(monitor.check('p','products','list',page));
 await page.setContent(product()+'<div class="eds-pagination-sizes__popper"><button class="eds-dropdown-item">24</button></div>');await assert.rejects(monitor.check('p','products','page-size',page));
 await page.locator('.eds-dropdown-item').evaluate(e=>e.textContent='48');await monitor.check('p','products','page-size',page);
 assert.equal(monitor.snapshot().find(r=>r.stage==='list').status,'changed','Checking another stage must not clear a red list alert');
});
test('changed edit dialog blocks submission before Shopee mutation',async t=>{
 const {page,monitor}=await setup(t);await page.setContent('<div class="stock-content">20</div><div class="eds-modal__content" hidden><div class="eds-modal__title">Cập nhật kho hàng</div><div class="stock-edit-name">Sản phẩm thử</div><input value="20"><button>Hủy bỏ</button><button id="save">Lưu kiểu mới</button></div>');
 await page.evaluate(()=>{window.saved=0;document.querySelector('.stock-content').onclick=()=>document.querySelector('.eds-modal__content').hidden=false;document.querySelector('button').onclick=()=>document.querySelector('.eds-modal__content').hidden=true;document.querySelector('#save').onclick=()=>window.saved++;});
 const scanner=new ProductScanner({monitor});const row={shop:'shop',productId:'123',modelId:'456',name:'Sản phẩm thử',variant:'',stock:20,price:100000};scanner.find=async()=>({page,row,unit:page.locator('body')});
 await assert.rejects(scanner.edit('p',row,{field:'stock',expected:20,value:0}),e=>e.code==='INTERFACE_CHANGED');assert.equal(await page.evaluate(()=>window.saved),0);assert.equal(monitor.snapshot()[0].status,'changed');assert.equal(await page.locator('.eds-modal__content').isVisible(),false);
});
