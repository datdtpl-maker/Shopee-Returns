const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {DEFAULT_SHEET,matchSheet,validTracking}=require('./sheets.cjs');
const STATES = { new: 'Chưa xử lý', shipper: 'Đã báo shipper gửi lại hàng', received: 'Đã nhận lại hàng' };
class Store {
  constructor(dir) {
    this.dir = dir; fs.mkdirSync(dir, {recursive:true}); this.file = path.join(dir,'state.json');
    this.data = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file,'utf8')) : {
      version:1, profiles:[], orders:[], logs:[], jobs:[], settings:{intervalMinutes:10,autoScan:false,telegramEnabled:false,notionEnabled:false,notionPageId:'3d970655a9aa801ca5adfe0e07f32c4a',notionDatabaseId:'',chatId:''}
    };
    this.data.settings={sheetUrl:DEFAULT_SHEET,...this.data.settings};
    // Evidence is valid only in this running session. Persisted rows remain an audit/dedup record.
    this.currentScans=new Map();this.verified=new Map();
  }
  invalidate(profileIds=this.data.profiles.map(p=>p.id)) {
    for(const id of profileIds){this.currentScans.delete(id);for(const o of this.data.orders)if(o.profileId===id)this.verified.delete(o.id);}
  }
  isEligible(order) {
    const evidence=this.verified.get(order.id);const scan=this.currentScans.get(order.profileId);
    return !!(evidence&&scan?.ids.has(order.orderId)&&evidence.scanId===scan.id&&evidence.source===this.data.settings.sheetUrl&&
      Date.now()-Math.min(evidence.at,scan.at)<this.data.settings.intervalMinutes*60000&&
      order.sheetMatch==='matched'&&order.trackingNumbers?.length===1&&validTracking(order.trackingNumbers[0]));
  }
  visibleOrders(){return this.data.orders.filter(o=>this.isEligible(o));}
  save() { const tmp=this.file+'.tmp'; fs.writeFileSync(tmp,JSON.stringify(this.data,null,2)); fs.renameSync(tmp,this.file); }
  log(level,message) { this.data.logs.unshift({id:randomUUID(),at:new Date().toISOString(),level,message}); this.data.logs=this.data.logs.slice(0,500); this.save(); }
  addProfile(name) {
    name=String(name||'').trim(); if(!name || name.length>80) throw Error('Tên profile cần từ 1–80 ký tự.');
    this.checkProfileName(name);
    const p={id:randomUUID(),name,enabled:true,status:'Chưa đăng nhập',lastScan:null,lastCount:0}; this.data.profiles.push(p); this.save(); return p;
  }
  profile(id) { const p=this.data.profiles.find(x=>x.id===id); if(!p) throw Error('Không tìm thấy profile.'); return p; }
  checkProfileName(name,id) {
    if(this.data.profiles.some(p=>p.id!==id&&(p.name===name||p.previousNames?.includes(name))))throw Error('Tên này đang dùng hoặc từng thuộc profile khác. Chọn tên khác để tránh nhầm đơn trên Notion.');
  }
  renameProfile(id,name) {
    const p=this.profile(id);
    if(typeof name!=='string'||!name.trim()||name.trim().length>80)throw Error('Tên profile cần từ 1–80 ký tự.');
    name=name.trim();this.checkProfileName(name,id);if(name===p.name)return p;
    // Reserve former names so old Notion rows remain attributable to the same account.
    p.previousNames=[...new Set([...(p.previousNames||[]),p.name])];p.name=name;
    for(const o of this.data.orders.filter(o=>o.profileId===id)) {
      o.profileName=name;o.updatedAt=new Date().toISOString();o.revision++;
      this.job('notion',`${o.id}:${o.revision}`,{orderKey:o.id});
    }
    this.save();return p;
  }
  job(kind,key,payload) {
    if(this.data.jobs.some(j=>j.kind===kind&&j.key===key)) return;
    this.data.jobs.push({id:randomUUID(),kind,key,payload,attempts:0,nextAt:0,status:'pending'});
  }
  ingest(profileId,rows,now=new Date().toISOString()) {
    const p=this.profile(profileId); let added=0;
    for(const row of rows) if(!/^[A-Z0-9]{8,30}$/.test(row.orderId)||!['red','green'].includes(row.color)||!row.shippingText?.trim()) throw Error('Dữ liệu quét không hợp lệ.');
    this.invalidate([profileId]);
    this.currentScans.set(profileId,{id:randomUUID(),at:Date.parse(now),ids:new Set(rows.map(r=>r.orderId))});
    for(const row of rows) {
      if(!/^[A-Z0-9]{8,30}$/.test(row.orderId) || !['red','green'].includes(row.color) || !row.shippingText?.trim()) throw Error('Dữ liệu quét không hợp lệ.');
      let order=this.data.orders.find(o=>o.profileId===profileId&&o.orderId===row.orderId);
      if(order) {
        const changed=order.shippingText!==row.shippingText||order.color!==row.color||(row.orderStatus&&order.orderStatus!==row.orderStatus);
        Object.assign(order,{shippingText:row.shippingText,color:row.color,lastSeen:now,...(row.orderStatus?{orderStatus:row.orderStatus}:{})});
        if(changed) { order.updatedAt=now;order.revision++; this.job('notion',`${order.id}:${order.revision}`,{orderKey:order.id}); }
        continue;
      }
      order={id:randomUUID(),profileId,profileName:p.name,orderId:row.orderId,shippingText:row.shippingText,color:row.color,state:'new',firstSeen:now,lastSeen:now,revision:1,notionPageId:null,telegramSentAt:null};
      Object.assign(order,{orderStatus:row.orderStatus||'',trackingNumbers:[],sheetStatus:'',sheetMatch:'pending'});
      this.data.orders.unshift(order); added++;
      this.job('telegram',order.id,{orderKey:order.id}); this.job('notion',`${order.id}:1`,{orderKey:order.id});
    }
    p.lastScan=now; p.lastCount=rows.length; p.status='Sẵn sàng'; this.save(); return added;
  }
  applySheet(result,profileIds=[...this.currentScans.keys()]) {
    let matched=0,conflicts=0;
    for(const order of this.data.orders) {
      if(!profileIds.includes(order.profileId))continue;
      this.verified.delete(order.id);
      const scan=this.currentScans.get(order.profileId);if(!scan?.ids.has(order.orderId))continue;
      const next=matchSheet(order.orderId,result.index);
      if(next.sheetMatch==='matched')matched++;
      if(next.sheetMatch==='conflict')conflicts++;
      const changed=['trackingNumbers','sheetStatus','sheetMatch','sheetRows'].some(k=>JSON.stringify(order[k])!==JSON.stringify(next[k]));
      Object.assign(order,next,{sheetCheckedAt:result.checkedAt,sheetSource:this.data.settings.sheetUrl});
      if(next.sheetMatch==='matched'&&Date.parse(result.checkedAt)>=scan.at)this.verified.set(order.id,{scanId:scan.id,at:Date.parse(result.checkedAt),source:this.data.settings.sheetUrl});
      if(this.isEligible(order))this.job('notion',`${order.id}:verify:${scan.id}`,{orderKey:order.id});
      if(changed) {order.updatedAt=result.checkedAt;order.revision++;this.job('notion',`${order.id}:${order.revision}`,{orderKey:order.id});}
    }
    this.data.sheet={checkedAt:result.checkedAt,rowCount:result.count,matched,conflicts,error:null};this.save();
    return this.data.sheet;
  }
  setState(id,state) {
    if(!Object.hasOwn(STATES,state)) throw Error('Trạng thái không hợp lệ.');
    const o=this.data.orders.find(x=>x.id===id); if(!o) throw Error('Không tìm thấy đơn hàng.');
    if(!this.isEligible(o))throw Error('Đơn chưa có mã vận đơn khớp chính xác từ lượt quét mới. Hãy quét lại Shopee và Sheet.');
    if(o.state===state) return o;
    o.state=state; o.updatedAt=new Date().toISOString(); o.revision++; this.job('notion',`${o.id}:${o.revision}`,{orderKey:id}); this.save(); return o;
  }
}
module.exports={Store,STATES};
