const {STATES}=require('./core.cjs');
const fs=require('node:fs');const path=require('node:path');
const EXTRA_PROPERTIES={'Mã vận đơn':{rich_text:{}},'Tình trạng Sheet':{rich_text:{}},'Trạng thái Shopee':{rich_text:{}},'Kiểm tra Sheet lúc':{date:{}}};
const plain=(property,type)=>(property?.[type]||[]).map(t=>t.plain_text??t.text?.content??'').join('');
const rich=text=>[{type:'text',text:{content:String(text).slice(0,1900)}}];
class Integrations {
  constructor(store,secrets) {this.store=store;this.secrets=secrets;this.running=false;this.lastNotionRequest=0;}
  async request(url,options={}) {
    const response=await fetch(url,{...options,signal:AbortSignal.timeout(20000)});
    const json=await response.json().catch(()=>({}));
    if(!response.ok || json.ok===false) throw Error(`Dịch vụ trả lỗi HTTP ${response.status}${json.code?' ('+json.code+')':''}.`);
    return json;
  }
  async notion(endpoint,method='GET',body) {
    const token=this.secrets().notionToken;if(!token) throw Error('Chưa có Notion token.');
    const wait=Math.max(0,this.lastNotionRequest+360-Date.now());
    this.lastNotionRequest=Date.now()+wait;
    if(wait) await new Promise(resolve=>setTimeout(resolve,wait));
    return this.request('https://api.notion.com/v1/'+endpoint,{method,headers:{Authorization:`Bearer ${token}`,'Notion-Version':'2022-06-28','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  }
  async setupNotion() {
    if(this.readyDatabase===this.store.data.settings.notionDatabaseId&&this.readyDatabase)return this.readyDatabase;
    if(this.setupPromise)return this.setupPromise;
    this.setupPromise=this.ensureNotion();
    try {const id=await this.setupPromise;this.readyDatabase=id;return id;}finally{this.setupPromise=null;}
  }
  async ensureNotion() {
    const s=this.store.data.settings;
    if(s.notionDatabaseId) {await this.ensureProperties(s.notionDatabaseId);return s.notionDatabaseId;}
    let cursor;let existing;
    do {
      const blocks=await this.notion(`blocks/${s.notionPageId}/children?page_size=100${cursor?'&start_cursor='+cursor:''}`);
      existing=blocks.results.find(b=>b.type==='child_database'&&b.child_database.title==='Theo dõi hoàn huỷ Shopee');
      if(existing) break;cursor=blocks.has_more?blocks.next_cursor:null;
    } while(cursor);
    const db=existing||await this.notion('databases','POST',{parent:{type:'page_id',page_id:s.notionPageId},title:rich('Theo dõi hoàn huỷ Shopee'),properties:{
      'Mã đơn hàng':{title:{}},'Profile':{rich_text:{}},'Vận chuyển chiều giao hàng':{rich_text:{}},'Màu':{select:{options:[{name:'Đỏ',color:'red'},{name:'Xanh',color:'green'}]}},
      'Xử lý':{select:{options:[{name:STATES.new,color:'gray'},{name:STATES.shipper,color:'orange'},{name:STATES.received,color:'green'}]}},'Phát hiện lúc':{date:{}},'Cập nhật lúc':{date:{}}
    }});
    await this.ensureProperties(db.id);s.notionDatabaseId=db.id;this.store.save();return db.id;
  }
  async ensureProperties(id) {
    const db=await this.notion('databases/'+id);const add={};
    for(const [name,schema] of Object.entries(EXTRA_PROPERTIES)) {
      if(!db.properties[name])add[name]=schema;
      else if(db.properties[name].type!==Object.keys(schema)[0])throw Error(`Cột Notion ${name} không đúng kiểu. Giữ nguyên bảng để kiểm tra.`);
    }
    if(Object.keys(add).length)await this.notion('databases/'+id,'PATCH',{properties:add});
  }
  async syncOrder(order) {
    if(!this.store.isEligible(order))throw Error('Đơn chưa được đối chiếu hợp lệ trong lượt quét mới.');
    const db=await this.setupNotion();
    const profile=this.store.profile(order.profileId);
    const names=new Set([profile.name,...(profile.previousNames||[])]);
    const matches=await this.listPages(db,{property:'Mã đơn hàng',title:{equals:order.orderId}});
    const existing=matches.filter(p=>!p.archived&&!p.in_trash&&plain(p.properties?.['Mã đơn hàng'],'title')===order.orderId&&names.has(plain(p.properties?.Profile,'rich_text')));
    if(existing.length>1)throw Error('Notion có nhiều bản ghi cùng profile + mã đơn. Không tạo thêm; cần kiểm tra bảng.');
    const found=existing[0];order.notionPageId=found?.id||null;
    const revision=order.revision;
    const verifiedAt=order.sheetCheckedAt;
    const properties={
      'Mã đơn hàng':{title:rich(order.orderId)},'Profile':{rich_text:rich(order.profileName)},
      'Vận chuyển chiều giao hàng':{rich_text:rich(order.shippingText)},'Màu':{select:{name:order.color==='red'?'Đỏ':'Xanh'}},'Xử lý':{select:{name:STATES[order.state]}},
      'Mã vận đơn':{rich_text:rich((order.trackingNumbers||[]).join(' | '))},'Tình trạng Sheet':{rich_text:rich(order.sheetStatus||'')},
      'Trạng thái Shopee':{rich_text:rich(order.orderStatus||'')},
      'Kiểm tra Sheet lúc':{date:order.sheetCheckedAt?{start:order.sheetCheckedAt}:null},
      'Phát hiện lúc':{date:{start:order.firstSeen}},'Cập nhật lúc':{date:{start:[order.updatedAt,order.lastSeen,order.sheetCheckedAt].filter(Boolean).sort().at(-1)}}
    };
    if(!this.store.isEligible(order))throw Error('Kết quả đối chiếu đã hết hạn; cần quét lại.');
    const changed=!found||Object.entries(properties).some(([name,value])=>{
      if(value.date)return false; // A new scan timestamp alone must not rewrite an existing row.
      if(value.title)return plain(found.properties?.[name],'title')!==value.title.map(t=>t.text.content).join('');
      if(value.rich_text)return plain(found.properties?.[name],'rich_text')!==value.rich_text.map(t=>t.text.content).join('');
      if(value.select)return found.properties?.[name]?.select?.name!==value.select.name;
      return false;
    });
    const page=!changed?found:order.notionPageId?await this.notion('pages/'+order.notionPageId,'PATCH',{properties}):await this.notion('pages','POST',{parent:{database_id:db},properties});
    order.notionPageId=page.id;order.notionSyncedAt=new Date().toISOString();order.notionSyncedRevision=revision;order.notionVerifiedAt=verifiedAt;this.store.save();
    return !changed?'unchanged':found?'updated':'created';
  }
  async listPages(db,filter) {
    const pages=[];let cursor;
    do {
      const result=await this.notion(`databases/${db}/query`,'POST',{page_size:100,...(filter?{filter}:{}),...(cursor?{start_cursor:cursor}:{})});
      pages.push(...result.results);cursor=result.has_more?result.next_cursor:null;
    }while(cursor);
    return pages;
  }
  async clearNotion() {
    if(this.running||!this.paused)throw Error('Cần dừng quét và đồng bộ trước khi xoá Notion.');
    const db=await this.setupNotion();
    const pages=await this.listPages(db);
    const backupDir=path.join(this.store.dir,'notion-backups');fs.mkdirSync(backupDir,{recursive:true});
    const backup=path.join(backupDir,`before-clear-${Date.now()}.json`);
    fs.writeFileSync(backup,JSON.stringify({databaseId:db,at:new Date().toISOString(),pages},null,2));
    this.store.data.notionClearPending=true;this.store.data.notionAwaitScan=true;this.store.invalidate();this.store.save();
    let archived=0;
    try {
      for(const page of pages) {
        const result=await this.notion('pages/'+page.id,'PATCH',{archived:true});
        if(!result.archived&&!result.in_trash)throw Error('Notion chưa xác nhận xoá bản ghi.');
        archived++;
      }
      if((await this.listPages(db)).length)throw Error('Bảng vẫn còn dữ liệu. Bấm Xoá dữ liệu Notion để thử lại.');
      for(const order of this.store.data.orders){order.notionPageId=null;delete order.notionSyncedAt;delete order.notionSyncedRevision;delete order.notionVerifiedAt;}
      for(const job of this.store.data.jobs)if(job.kind==='notion'){job.status='done';delete job.error;}
      this.store.data.notionClearPending=false;this.store.save();
      return {archived,backup};
    }catch(e){this.store.log('error',`Xoá Notion dừng sau ${archived}/${pages.length} bản ghi. Đồng bộ đã tạm dừng; bấm xoá để thử lại. ${e.message}`);throw e;}
  }

  async telegram(order) {
    if(!this.store.isEligible(order))throw Error('Đơn chưa được đối chiếu hợp lệ trong lượt quét mới.');
    const s=this.store.data.settings;const token=this.secrets().telegramToken;
    if(!token||!s.chatId) throw Error('Chưa có Telegram Bot Token hoặc Chat ID.');
    await this.request(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:s.chatId,text:`SHOPEE · ĐƠN HOÀN / HUỶ\nTài khoản: ${order.profileName}\nMã đơn: ${order.orderId}\nMã vận đơn: ${(order.trackingNumbers||[]).join(' | ')||'Chưa khớp Sheet'}\nVận chuyển chiều giao hàng: ${order.shippingText}\nTrạng thái Shopee: ${order.orderStatus||'—'}\nXử lý: ${STATES[order.state]}`,link_preview_options:{is_disabled:true}})});
    order.telegramSentAt=new Date().toISOString();this.store.save();
  }
  async drain() {
    if(this.running||this.paused||this.store.data.notionClearPending||this.store.data.notionAwaitScan) return;this.running=true;
    try {
      for(const job of this.store.data.jobs.filter(j=>j.status==='pending'&&j.nextAt<=Date.now())) {
        if(this.paused)break;
        const s=this.store.data.settings;
        if(job.kind==='notion'&&!s.notionEnabled||job.kind==='telegram'&&!s.telegramEnabled) continue;
        const order=this.store.data.orders.find(o=>o.id===job.payload.orderKey);
        if(!order) {job.status='done';continue;}
        if(!this.store.isEligible(order))continue;
        try {
          if(job.kind==='telegram'&&!order.telegramSentAt) await this.telegram(order);
          else if(job.kind==='notion'&&(order.notionSyncedRevision!==order.revision||order.notionVerifiedAt!==order.sheetCheckedAt)) await this.syncOrder(order);
          job.status='done';delete job.error;
        } catch(e) {
          job.attempts++;job.nextAt=Date.now()+Math.min(3600000,30000*2**Math.min(job.attempts-1,7));job.error=e.message;
          this.store.log('error',`${job.kind==='telegram'?'Telegram':'Notion'} · ${order.orderId}: ${e.message} Sẽ thử lại.`);
        }
        this.store.save();
      }
    } finally {this.running=false;}
  }
}
module.exports={Integrations};
