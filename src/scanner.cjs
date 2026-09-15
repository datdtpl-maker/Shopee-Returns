const {chromium} = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const HOME='https://banhang.shopee.vn/';
const RETURNS=HOME+'portal/sale/returnrefundcancel';

// Runs in the page: use the column heading and rendered geometry, never the order-status column.
function readVisibleRows() {
  const clean=s=>(s||'').replace(/\s+/g,' ').trim();
  const visible=e=>{const r=e.getBoundingClientRect();const s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
  const cards=[...document.querySelectorAll('.return-table-content .return-row-item')];
  if(cards.length) {
    const heading=[...document.querySelectorAll('.header-text')].some(e=>clean(e.textContent)==='Vận chuyển chiều giao hàng');
    const rows=[],allIds=[],ignoredIds=[],unresolvedIds=[];
    for(const card of cards) {
      const orderId=clean(card.querySelector('.order-id .id-content')?.textContent);
      if(!/^[A-Z0-9]{8,30}$/.test(orderId)){unresolvedIds.push('unknown');continue;}
      allIds.push(orderId);
      const column=card.querySelector('.item-logistics.item-forward-logistic');
      if(!column){unresolvedIds.push(orderId);continue;}
      const tag=column.querySelector('.tag .eds-tag');
      if(!tag){if(clean(column.textContent)==='-')ignoredIds.push(orderId);else unresolvedIds.push(orderId);continue;}
      const rgb=getComputedStyle(tag).color.match(/[\d.]+/g)?.map(Number)||[],[r,g,b]=rgb;
      const color=r>120&&r>g*1.7&&r>b*1.3?'red':g>70&&g>r*1.12&&g>b*1.05?'green':null;
      if(!color){ignoredIds.push(orderId);continue;}
      const status=card.querySelector('.item-request-status');
      const statusNode=status?.querySelector('div:not(.request-solution-hint-text)');
      const orderStatus=clean(statusNode?.firstElementChild?.textContent||statusNode?.textContent||status?.textContent);
      rows.push({orderId,shippingText:clean(tag.textContent),color,orderStatus});
    }
    return {heading,rows,allIds,ignoredIds,unresolvedIds,unresolved:unresolvedIds.length,orderCount:cards.length,empty:false};
  }
  const all=[...document.querySelectorAll('body *')];
  const heading=all.filter(e=>visible(e)&&clean(e.textContent)==='Vận chuyển chiều giao hàng').sort((a,b)=>a.querySelectorAll('*').length-b.querySelectorAll('*').length)[0];
  if(!heading) return {heading:false,rows:[],unresolved:0};
  let h=heading;
  while(h.parentElement&&h.getBoundingClientRect().width<100&&clean(h.parentElement.textContent)==='Vận chuyển chiều giao hàng') h=h.parentElement;
  const hr=h.getBoundingClientRect();
  const ids=all.filter(e=>visible(e)&&/^Mã đơn hàng\s*:?\s*[A-Z0-9]{8,30}$/.test(clean(e.textContent)))
    .filter(e=>![...e.children].some(c=>/^Mã đơn hàng\s*:?\s*[A-Z0-9]{8,30}$/.test(clean(c.textContent))));
  // Some Shopee builds separate the label and order number into sibling nodes.
  for(const e of all) if(visible(e)&&clean(e.textContent)==='Mã đơn hàng'&&e.parentElement&&/^Mã đơn hàng\s*:?\s*[A-Z0-9]{8,30}$/.test(clean(e.parentElement.textContent))) ids.push(e.parentElement);
  const colorOf=e=>{
    const c=getComputedStyle(e).color.match(/[\d.]+/g)?.map(Number); if(!c) return null;
    const [r,g,b]=c;
    if(r>120&&r>g*1.7&&r>b*1.3) return 'red';
    if(g>70&&g>r*1.12&&g>b*1.05) return 'green';
    return null;
  };
  const rows=[]; let unresolved=0; const seen=new Set();
  for(const idNode of ids) {
    const orderId=clean(idNode.textContent).match(/([A-Z0-9]{8,30})$/)?.[1];
    if(!orderId||seen.has(orderId)) continue; seen.add(orderId);
    let card=idNode.parentElement, found=null;
    while(card&&card!==document.body) {
      const distinct=new Set(ids.filter(n=>card.contains(n)).map(n=>clean(n.textContent).match(/([A-Z0-9]{8,30})$/)?.[1]));
      if(distinct.size>1) break;
      const colored=[...card.querySelectorAll('*')].filter(e=>visible(e)&&clean(e.textContent)&&clean(e.textContent).length<180&&colorOf(e)&&
        ![...e.children].some(c=>clean(c.textContent)===clean(e.textContent)&&visible(c)));
      found=colored.find(e=>{const r=e.getBoundingClientRect();return r.left>=hr.left-12&&r.left<hr.right+12;});
      if(found) break; card=card.parentElement;
    }
    if(found) rows.push({orderId,shippingText:clean(found.textContent),color:colorOf(found)});
    else unresolved++;
  }
  const body=clean(document.body.innerText);
  return {heading:true,rows,unresolved,orderCount:seen.size,empty:/Không có (yêu cầu|dữ liệu|đơn hàng)|Chưa có (yêu cầu|đơn hàng)|Không tìm thấy (yêu cầu|đơn hàng|kết quả)/i.test(body)};
}

class Scanner {
  constructor(dir) {this.dir=dir;this.contexts=new Map();this.busy=new Set();}
  async context(id) {
    if(this.contexts.has(id)) return this.contexts.get(id);
    const userDataDir=path.join(this.dir,'profiles',id);fs.mkdirSync(userDataDir,{recursive:true});
    let ctx;
    try {ctx=await chromium.launchPersistentContext(userDataDir,{channel:'chrome',headless:false,viewport:null,args:['--start-maximized']});}
    catch(e) { if(!/executable.*exist|distribution.*not found/i.test(e.message)) throw e; ctx=await chromium.launchPersistentContext(userDataDir,{channel:'msedge',headless:false,viewport:null}); }
    this.contexts.set(id,ctx);ctx.on('close',()=>this.contexts.delete(id));return ctx;
  }
  async login(id) {const ctx=await this.context(id);const page=ctx.pages()[0]||await ctx.newPage();await page.goto(HOME,{waitUntil:'domcontentloaded',timeout:60000});await page.bringToFront();}
  async scan(id) {
    if(this.busy.has(id)) throw Error('Profile đang được quét.'); this.busy.add(id);
    try {
      const ctx=await this.context(id); const page=ctx.pages()[0]||await ctx.newPage();
      const cacheControl=await ctx.newCDPSession(page);
      await cacheControl.send('Network.enable');await cacheControl.send('Network.setCacheDisabled',{cacheDisabled:true});
      await cacheControl.send('Network.setBypassServiceWorker',{bypass:true});
      try {
      await page.goto(RETURNS,{waitUntil:'domcontentloaded',timeout:60000});
      try {await page.getByText('Vận chuyển chiều giao hàng',{exact:true}).first().waitFor({timeout:30000});}
      catch {throw Error('Chưa đọc được bảng hoàn/huỷ. Hãy đăng nhập Shopee hoặc xử lý xác minh trong cửa sổ profile.');}
      try {await page.waitForFunction(()=>{
        const ready=document.querySelector('.return-table-content .return-row-item');
        const empty=/Không có (yêu cầu|dữ liệu|đơn hàng)|Chưa có (yêu cầu|đơn hàng)|Không tìm thấy (yêu cầu|đơn hàng|kết quả)/i.test(document.body.innerText);
        return !!ready||empty;
      },null,{timeout:45000});}catch{throw Error('Shopee chưa tải xong danh sách. Không ghi kết quả 0 khi trang còn tải hoặc lỗi.');}
      let deadline;
      try {return await Promise.race([this.collect(page),new Promise((_,reject)=>{deadline=setTimeout(()=>{void page.close().catch(()=>{});reject(Error('Quét quá 120 giây. Đã dừng lượt này; hãy mở lại profile và thử lại.'));},120000);})]);}
      finally{clearTimeout(deadline);}
      } finally {await cacheControl.detach().catch(()=>{});}
    } finally {this.busy.delete(id);}
  }
  async collect(page) {
    const seen=new Map(),allIds=new Set(),ignored=new Set(),unresolvedIds=new Set();let stable=0;let lastSignature='';let unresolved=0;let sample;
    // Scroll only ancestors of the actual table. Shopee also has resize-detector scroll elements.
    const scrollPage=reset=>{
      let node=document.querySelector('.return-table-content')||document.body;const containers=new Set([document.scrollingElement]);
      while(node){if(node.clientHeight>150&&node.scrollHeight>node.clientHeight+80&&/auto|scroll/.test(getComputedStyle(node).overflowY))containers.add(node);node=node.parentElement;}
      const list=[...containers].filter(Boolean);
      return list.map(e=>{e.scrollTop=reset?0:Math.min(e.scrollTop+e.clientHeight*.85,e.scrollHeight);return [Math.round(e.scrollTop),e.scrollHeight,e.clientHeight];});
    };
    await page.evaluate(scrollPage,true);
    for(let step=0;step<160;step++) {
      await page.waitForTimeout(450);
      sample=await page.evaluate(readVisibleRows);
      if(!sample.heading) throw Error('Không tìm thấy cột Vận chuyển chiều giao hàng.');
      unresolved=Math.max(unresolved,sample.unresolved);
      for(const id of sample.allIds||[])allIds.add(id);
      for(const id of sample.ignoredIds||[])ignored.add(id);
      for(const id of sample.unresolvedIds||[])unresolvedIds.add(id);
      for(const row of sample.rows) {
        const previous=seen.get(row.orderId);
        const statuses=[...new Set([...(previous?.orderStatus||'').split(' | '),...(row.orderStatus||'').split(' | ')].filter(Boolean))];
        seen.set(row.orderId,{...row,orderStatus:statuses.join(' | ')});
      }
      const position=await page.evaluate(scrollPage,false);
      const signature=JSON.stringify([position,seen.size,sample.rows.length]);
      stable=signature===lastSignature?stable+1:0;lastSignature=signature;
      if(stable>=4) {
        const atBottom=position.every(([top,height,client])=>top+client>=height-3);
        if(!atBottom)throw Error('Trang dừng cuộn trước cuối danh sách. Chưa lưu kết quả để tránh thiếu đơn.');
        if(!seen.size&&!sample.empty&&!ignored.size) throw Error('Trang có bảng nhưng chưa xác định được mã đơn và chữ đỏ/xanh. Cần kiểm tra cấu trúc trang; không coi đây là kết quả 0 đơn.');
        for(const id of seen.keys())unresolvedIds.delete(id);
        return {rows:[...seen.values()],unresolved:sample.allIds?unresolvedIds.size:unresolved,totalOrders:allIds.size||sample.orderCount,ignored:ignored.size,steps:step+1};
      }
    }
    throw Error('Trang chưa cuộn ổn định sau giới hạn quét. Chưa lưu kết quả để tránh báo thiếu đơn.');
  }
  async close() {await Promise.allSettled([...this.contexts.values()].map(c=>c.close()));}
}
module.exports={Scanner,readVisibleRows,HOME,RETURNS};

