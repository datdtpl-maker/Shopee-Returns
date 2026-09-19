const URL='https://banhang.shopee.vn/portal/product/list/live/all?operationSortBy=recommend_v2';
const normal=s=>String(s||'').replace(/\s+/g,' ').trim();
function readProducts(){
  const text=e=>(e?.innerText||'').replace(/\s+/g,' ').trim();
  const number=s=>{s=s.replace(/[₫đ\s]/g,'');return /^\d+(?:\.\d{3})*$/.test(s)?Number(s.replace(/\./g,'')):null;};
  const rows=[],errors=[],ids=[];
  const mains=[...document.querySelectorAll('.product-variation-item')];
  for(const main of mains){
    const id=text(main.querySelector('.item-id')).match(/ID Sản phẩm:\s*(\d+)/)?.[1];
    const name=text(main.querySelector('a.product-name-wrap'));
    if(!id||!name){errors.push('Không đọc được ID hoặc tên sản phẩm.');continue;}
    ids.push(id);
    const tr=main.closest('tr');const variants=[...(tr?.querySelectorAll('.model-list-item')||[])];
    const units=variants.length?variants:[main];
    for(const unit of units){
      const model=text(unit).match(/Model ID:\s*(\d+)/)?.[1];
      const variant=text(unit.querySelector('.variation-name-info-name'));
      const priceElement=unit.querySelector('.list-view-price, .list-view-model-price');
      const price=number(text(priceElement?.querySelector('[class*="priceCampaignRef"]')||priceElement));
      const stockText=text(unit.querySelector('.stock-text, .stock-content'));
      const stock=unit.dataset.exactStock!==undefined?Number(unit.dataset.exactStock):stockText==='Hết hàng'?0:number(stockText);
      if(!model||price===null||stock===null){errors.push('Thiếu giá/kho/Model ID: '+id+(model?'/'+model:''));continue;}
      rows.push({productId:id,modelId:model,name,variant,price,stock});
    }
  }
  const total=text(document.querySelector('.list-header-title')).match(/^(\d[\d.,]*)\s+Sản Phẩm$/i)?.[1];
  const shop=text(document.querySelector('.account-info .subaccount-name'));
  return {rows,errors,ids,shop,total:total?Number(total.replace(/[.,]/g,'')):null,
    page:Number(text(document.querySelector('.product-list-pagination .eds-pager__current'))),
    pages:Number(text(document.querySelector('.product-list-pagination .eds-pager__total'))),
    size:text(document.querySelector('.product-list-pagination .eds-pagination-sizes__content'))};
}
function validateEdit(input){
  if(!input||!['price','stock'].includes(input.field)||typeof input.value!=='number'||!Number.isSafeInteger(input.value)||input.value<(input.field==='price'?1:0)||input.value>1000000000)throw Error('Giá phải là số nguyên dương; tồn kho là số nguyên từ 0 đến 1 tỷ.');
  if(!Number.isSafeInteger(input.expected)||input.expected<0)throw Error('Thiếu giá trị gốc để đối chiếu. Hãy tải lại dữ liệu.');
  return {field:input.field,value:input.value,expected:input.expected};
}
class ProductScanner{
  constructor(scanner){this.scanner=scanner;this.pages=new Map();}
  async dialogInput(page,dialog,field,variant){
    if(await dialog.count()!==1)throw Error('Không xác định được hộp sửa duy nhất.');
    let scope=dialog;
    if(variant){
      const labels=dialog.locator('.'+field+'-edit-variation');
      const names=(await labels.allTextContents()).map(normal);
      if(names.filter(n=>n===normal(variant)).length!==1)throw Error('Không xác định duy nhất phân loại trong hộp sửa.');
      scope=dialog.locator('tr.eds-table__row').filter({has:page.locator('.'+field+'-edit-variation').filter({hasText:new RegExp('^'+variant.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$')})});
    }
    const input=scope.locator('input');
    if(await input.count()!==1)throw Error('Shopee yêu cầu sửa nhiều kho hoặc trường không hỗ trợ.');
    await input.scrollIntoViewIfNeeded();return input;
  }
  async open(profileId){
    const ctx=await this.scanner.context(profileId);let page=this.pages.get(profileId);
    if(!page||page.isClosed()){page=await ctx.newPage();page.setDefaultTimeout(15000);this.pages.set(profileId,page);}
    const cdp=await ctx.newCDPSession(page);try{await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});await cdp.send('Network.setBypassServiceWorker',{bypass:true});}finally{await cdp.detach();}
    await page.goto(URL,{waitUntil:'domcontentloaded',timeout:60000});
    const skip=page.getByRole('button',{name:'Bỏ qua',exact:true});if(await skip.isVisible().catch(()=>false))await skip.click();
    await page.locator('.product-list-pagination').waitFor({timeout:45000});
    return page;
  }
  async shop(profileId){
    const page=await this.open(profileId);
    return normal(await page.locator('.account-info .subaccount-name').first().innerText());
  }
  async ready(page){
    await page.waitForFunction(()=>document.querySelector('.product-variation-item .item-id')||/0\s+Sản Phẩm/i.test(document.body.innerText),null,{timeout:45000});
    const more=page.getByText(/^(Xem thêm|Hiển thị).*(phân loại)$/i);
    for(let n=0;n<100&&await more.count();n++){const button=more.first();await button.scrollIntoViewIfNeeded();await button.click();}
    // Prices are rendered lazily: bring every product/model into the viewport before reading.
    const units=page.locator('.product-variation-item, .model-list-item');
    for(let n=0;n<await units.count();n++){
      const unit=units.nth(n);await unit.scrollIntoViewIfNeeded();
      const multi=await unit.evaluate(e=>e.matches('.product-variation-item')&&!!e.closest('tr')?.querySelector('.model-list-item'));
      if(!multi){
        await unit.locator('.list-view-price, .list-view-model-price').waitFor({timeout:15000});
        const stock=normal(await unit.locator('.stock-text, .stock-content').first().innerText());
        if(/\d[\d.,]*\s*[kmb]/i.test(stock)){
          await unit.locator('.stock-content').click();
          const dialog=page.locator('.eds-modal__content:visible');
          try{
            await dialog.locator('input:visible').waitFor();
            const variant=await unit.locator('.variation-name-info-name').count()?normal(await unit.locator('.variation-name-info-name').innerText()):'';
            const input=await this.dialogInput(page,dialog,'stock',variant);
            const value=await input.inputValue();
            if(!/^\d+$/.test(value))throw Error('Shopee trả tồn kho không hợp lệ.');
            await unit.evaluate((e,v)=>e.dataset.exactStock=v,value);
          }finally{await dialog.getByRole('button',{name:'Hủy bỏ',exact:true}).click();}
        }
      }
    }
    const deadline=Date.now()+20000;let d;do{d=await page.evaluate(readProducts);if(!d.errors.length)return d;await page.waitForTimeout(250);}while(Date.now()<deadline);throw Error(d.errors.slice(0,3).join(' · '));
  }
  async size48(page){
    const select=page.locator('.product-list-pagination .eds-pagination-sizes__content');await select.scrollIntoViewIfNeeded();
    if(!(await select.innerText()).includes('48/')){
      await select.click();await page.locator('.eds-pagination-sizes__popper:visible .eds-dropdown-item').filter({hasText:/^48$/}).click();
      await page.waitForFunction(()=>document.querySelector('.eds-pagination-sizes__content')?.textContent.includes('48/'));
    }
  }
  async scan(profileId,progress=()=>{}){
    const page=await this.open(profileId);await this.size48(page);
    // Reloading list should begin at page 1; explicitly return if Shopee remembered another page.
    while(Number(await page.locator('.eds-pager__current').innerText())>1){const old=await page.locator('.eds-pager__current').innerText();await page.locator('.eds-pager__button-prev').click();await page.waitForFunction(old=>document.querySelector('.eds-pager__current')?.textContent!==old,old);}
    const rows=[],seen=new Set();let expectedTotal,shop,pages;const deadline=Date.now()+15*60000;
    for(let index=1;index<=500;index++){
      if(Date.now()>deadline)throw Error('Quét sản phẩm vượt 15 phút. Chưa ghi lượt quét dở lên Notion.');
      const d=await this.ready(page);
      if(d.page!==index||!d.size.includes('48/')||!d.shop||d.total===null||d.errors.length)throw Error('Không xác nhận được trang, shop hoặc dữ liệu sản phẩm đầy đủ.');
      if(index===1){expectedTotal=d.total;shop=d.shop;pages=d.pages;}
      if(d.shop!==shop||d.total!==expectedTotal||d.pages!==pages)throw Error('Danh sách thay đổi trong lúc quét. Hãy quét lại để tránh thiếu sản phẩm.');
      for(const id of d.ids){if(seen.has(id))throw Error('Trang sản phẩm bị lặp hoặc thứ tự thay đổi. Hãy quét lại.');seen.add(id);}
      rows.push(...d.rows);progress({shop,page:index,pages,products:seen.size,total:expectedTotal});
      if(index>=pages)break;
      const next=page.locator('.product-list-pagination .eds-pager__button-next');if(await next.isDisabled())throw Error('Shopee dừng phân trang trước khi đủ sản phẩm.');
      const first=d.ids[0];await next.click();
      await page.waitForFunction(({index,first})=>Number(document.querySelector('.eds-pager__current')?.textContent)===index+1&&!document.querySelector('.product-variation-item .item-id')?.textContent.includes(first),{index,first},{timeout:45000});
    }
    if(seen.size!==expectedTotal)throw Error('Chưa đọc đủ sản phẩm: '+seen.size+'/'+expectedTotal+'. Không đồng bộ dữ liệu dở.');
    if(new Set(rows.map(r=>r.productId+':'+r.modelId)).size!==rows.length)throw Error('Model ID bị lặp trong lượt quét.');
    return {shop,rows,total:seen.size,pages,scannedAt:new Date().toISOString()};
  }
  async find(profileId,target){
    const page=await this.open(profileId);
    const shop=await page.locator('.account-info .subaccount-name').first().innerText();
    if(normal(shop)!==target.shop)throw Error('Profile đang đăng nhập shop khác. Không sửa sản phẩm.');
    const search=page.getByPlaceholder('Tìm Tên sản phẩm, SKU sản phẩm, SKU phân loại, Mã sản phẩm',{exact:true});
    await search.fill(target.productId);await search.press('Enter');
    await page.waitForFunction(id=>{const ids=[...document.querySelectorAll('.product-variation-item .item-id')];return ids.length===1&&ids[0].textContent.trim()==='ID Sản phẩm: '+id;},target.productId,{timeout:30000});
    const d=await this.ready(page);const row=d.rows.find(r=>r.productId===target.productId&&r.modelId===target.modelId);
    if(!row||normal(row.name)!==normal(target.name)||normal(row.variant)!==normal(target.variant))throw Error('Tên hoặc phân loại đã thay đổi. Quét lại sản phẩm trước khi sửa.');
    const container=page.locator('tr.eds-table__row').filter({has:page.locator('.item-id').filter({hasText:new RegExp('^ID Sản phẩm: '+target.productId+'$')})});
    const unit=target.variant?container.locator('.model-list-item').filter({has:page.locator('.variation-name-info-sku').filter({hasText:new RegExp('^Model ID:\\s*'+target.modelId+'\\s*$')})}):container.locator('.product-variation-item');
    if(await unit.count()!==1)throw Error('Không xác định duy nhất phân loại cần sửa.');
    return {page,row,unit};
  }
  async edit(profileId,target,input,{dryRun=false,beforeSubmit=()=>{}}={}){
    const edit=validateEdit(input);const {page,row,unit}=await this.find(profileId,target);
    if(row[edit.field]!==edit.expected)throw Error('Giá/tồn kho trên Shopee đã thay đổi ('+row[edit.field]+'). Quét lại trước khi sửa.');
    let submitted=false;
    try{
      await unit.locator(edit.field==='price'?'.list-view-price, .list-view-model-price':'.stock-content').click();
      const dialog=page.locator('.eds-modal__content:visible').filter({has:page.getByText(edit.field==='price'?'Cập nhật giá':'Cập nhật kho hàng',{exact:true})});
      await dialog.locator('input:visible').first().waitFor();
      const inputBox=await this.dialogInput(page,dialog,edit.field,target.variant);
      const title=normal(await dialog.locator(edit.field==='price'?'.price-edit-name':'.stock-edit-name').innerText());
      if(title!==normal(target.name)&&title!==normal(target.variant))throw Error('Tên trong hộp sửa không khớp sản phẩm đã chọn.');
      const currentText=(await inputBox.inputValue()).trim();
      if(!/^\d+$/.test(currentText))throw Error('Không đọc được giá/kho gốc chính xác.');
      const current=Number(currentText);
      if(current!==edit.expected)throw Error('Giá/kho trong hộp sửa khác dữ liệu hiển thị (có thể giá khuyến mãi). Không tự ghi đè.');
      if(dryRun||current===edit.value)return {row,changed:false,dryRun};
      const before=await dialog.locator('input').evaluateAll(es=>es.map(e=>e.value));
      const inputIndex=await inputBox.evaluate(e=>[...e.closest('.eds-modal__content').querySelectorAll('input')].indexOf(e));
      await inputBox.fill(String(edit.value));await inputBox.blur();
      const after=await dialog.locator('input').evaluateAll(es=>es.map(e=>e.value));
      if(after.length!==before.length||after.some((v,i)=>i!==inputIndex&&v!==before[i]))throw Error('Có trường ngoài phân loại yêu cầu bị thay đổi. Không lưu.');
      beforeSubmit();submitted=true;
      await dialog.getByRole('button',{name:edit.field==='price'?'Cập nhật giá':'Cập nhật',exact:true}).click();
      await dialog.waitFor({state:'hidden',timeout:20000});
      // Reopen a fresh page and re-read the exact ID/model, never trust the submit response alone.
      const fresh=await this.find(profileId,target);
      if(fresh.row[edit.field]!==edit.value)throw Error('Chưa xác minh được giá trị mới sau khi lưu.');
      return {row:fresh.row,changed:true};
    }catch(e){if(submitted)e.message='Đã gửi thao tác tới Shopee nhưng chưa xác minh hoàn tất. Không tự gửi lại; quét sản phẩm để kiểm tra. '+e.message;throw e;}
    finally{const cancel=page.locator('.eds-modal__content:visible').getByRole('button',{name:'Hủy bỏ',exact:true});if(await cancel.isVisible().catch(()=>false))await cancel.click().catch(()=>{});}
  }
}
module.exports={ProductScanner,readProducts,validateEdit,URL};
