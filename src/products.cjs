const fs=require('node:fs');const path=require('node:path');const {randomUUID}=require('node:crypto');
const TARGET='3e070655a9aa80d68197fb688ad8e289';
const key=r=>[r.shop,r.productId,r.modelId].join('|');
const plain=(p,t='rich_text')=>(p?.[t]||[]).map(v=>v.plain_text??v.text?.content??'').join('');
const rich=s=>[{type:'text',text:{content:String(s||'').slice(0,1900)}}];
const SCHEMA={'Tên sản phẩm':{title:{}},'Tên shop':{rich_text:{}},'Giá bán':{number:{format:'number'}},'Kho hàng':{number:{format:'number'}},'ID sản phẩm':{rich_text:{}},'Model ID':{rich_text:{}},'Phân loại':{rich_text:{}},'Quét lúc':{date:{}}};
function validateRow(row){
 if(!row||!row.shop||!row.name||!/^\d+$/.test(row.productId)||!/^\d+$/.test(row.modelId)||!Number.isSafeInteger(row.price)||row.price<0||!Number.isSafeInteger(row.stock)||row.stock<0)throw Error('Dòng sản phẩm thiếu ID, giá hoặc kho hợp lệ.');
 return row;
}
class Products{
 constructor(dir,store,integrations,scanner){
  this.file=path.join(dir,'products.json');this.store=store;this.i=integrations;this.scanner=scanner;this.busy=false;this.progress='';
  this.data=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):{version:1,databaseId:'',shops:{},rows:[],actions:[]};
  for(const a of this.data.actions)if(['preparing','submitted'].includes(a.status))a.status='uncertain';
  if(this.data.batch?.status==='running'){
   this.data.batch.status='interrupted';
   for(const item of this.data.batch.items){
    if(item.status==='queued')item.status='cancelled';
    if(item.status==='running'){
     const action=this.data.actions.find(a=>a.id===item.actionId);
     item.status=action?.status||'failed';item.error='App đã đóng giữa lượt chạy. Không tự gửi lại; kiểm tra kết quả trước khi sửa tiếp.';
    }
   }
  }
  this.save();
 }
 save(){fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.data,null,2));fs.renameSync(this.file+'.tmp',this.file);}
 snapshot(){return {rows:this.data.rows,shops:this.data.shops,busy:this.busy,progress:this.progress,databaseId:this.data.databaseId,actions:this.data.actions.slice(0,30),loadedAt:this.data.loadedAt,batch:this.data.batch||null};}
 async setup(){
  if(this.ready===this.data.databaseId&&this.ready)return this.ready;
  let db;if(this.data.databaseId)db=await this.i.notion('databases/'+this.data.databaseId);
  else{
   try{db=await this.i.notion('databases/'+TARGET);}catch(e){if(!/HTTP (400|404)/.test(e.message))throw e;}
   if(!db){
    await this.i.notion('pages/'+TARGET);let cursor;const children=[];
    do{const result=await this.i.notion('blocks/'+TARGET+'/children?page_size=100'+(cursor?'&start_cursor='+cursor:''));children.push(...result.results);cursor=result.has_more?result.next_cursor:null;}while(cursor);
    const matches=children.filter(p=>p.type==='child_database'&&p.child_database.title==='Kho sản phẩm Shopee');
    if(matches.length>1)throw Error('Có nhiều bảng Kho sản phẩm Shopee. Cần kiểm tra Notion.');
    db=matches.length?await this.i.notion('databases/'+matches[0].id):await this.i.notion('databases','POST',{parent:{type:'page_id',page_id:TARGET},title:rich('Kho sản phẩm Shopee'),properties:SCHEMA});
   }
  }
  const patch={};
  for(const [name,type] of Object.entries(SCHEMA)){
   if(!db.properties?.[name]){
    if(name==='Tên sản phẩm'){
     const title=Object.values(db.properties||{}).find(p=>p.type==='title');if(title)patch[title.id]={name:'Tên sản phẩm'};else patch[name]=type;
    }else patch[name]=type;
   }else if(db.properties[name].type!==Object.keys(type)[0])throw Error('Cột sản phẩm Notion sai kiểu: '+name);
  }
  if(Object.keys(patch).length)await this.i.notion('databases/'+db.id,'PATCH',{properties:patch});
  this.data.databaseId=db.id;this.ready=db.id;this.save();return db.id;
 }
 ingest(profileId,result){
  this.store.profile(profileId);if(!result.shop)throw Error('Không đọc được tên shop.');
  const other=Object.entries(this.data.shops).find(([id,s])=>id!==profileId&&s.name===result.shop);
  if(other)throw Error('Hai profile đang đăng nhập cùng shop. Hãy kiểm tra lại tài khoản.');
  const bound=this.data.shops[profileId];if(bound&&bound.name!==result.shop)throw Error('Profile đã đổi tài khoản Shopee. Tạo profile riêng cho shop mới.');
  const incoming=result.rows.map(r=>validateRow({...r,shop:result.shop}));
  if(new Set(incoming.map(key)).size!==incoming.length)throw Error('Trùng khoá sản phẩm trong lượt quét.');
  const old=new Map(this.data.rows.map(r=>[key(r),r]));
  const next=incoming.map(r=>({...old.get(key(r)),...r,id:old.get(key(r))?.id||randomUUID(),profileId,active:true,scannedAt:result.scannedAt,sync:'pending',source:'Shopee'}));
  this.data.rows=this.data.rows.filter(r=>r.profileId!==profileId).concat(next);
  this.data.shops[profileId]={name:result.shop,total:result.total,models:next.length,pages:result.pages,scannedAt:result.scannedAt};
  for(const a of this.data.actions)if(a.status==='uncertain'&&next.some(r=>key(r)===a.productKey)){a.status='reconciled';a.observed=next.find(r=>key(r)===a.productKey)[a.field];}
  for(const item of this.data.batch?.items||[])if(item.status==='uncertain'&&next.some(r=>key(r)===item.productKey)){item.status='reconciled';item.error='Giá trị đọc lại: '+next.find(r=>key(r)===item.productKey)[item.field];}
  this.data.loadedAt=result.scannedAt;this.save();
 }
 async scan(profileIds,emit=()=>{}){
  for(const id of profileIds){const p=this.store.profile(id);this.progress='Đang đọc '+p.name;emit();
   const result=await this.scanner.scan(id,d=>{this.progress=d.shop+' · trang '+d.page+'/'+d.pages+' · '+d.products+'/'+d.total+' sản phẩm';emit();});
   this.ingest(id,result);this.store.log('success','Sản phẩm · '+p.name+': '+result.total+' sản phẩm, '+result.rows.length+' phân loại, '+result.pages+' trang.');emit();
  }
  await this.sync(emit);
 }
 parse(page){
  const p=page.properties||{};return validateRow({shop:plain(p['Tên shop']),name:plain(p['Tên sản phẩm'],'title'),productId:plain(p['ID sản phẩm']),modelId:plain(p['Model ID']),variant:plain(p['Phân loại']),price:p['Giá bán']?.number,stock:p['Kho hàng']?.number,scannedAt:p['Quét lúc']?.date?.start||null,notionPageId:page.id});
 }
 async remote(){const db=await this.setup();const pages=await this.i.listPages(db);const map=new Map();
  for(const page of pages){if(page.archived||page.in_trash)continue;
   // Unrelated notes/empty rows are left untouched; incomplete product rows stop the operation.
   if(!plain(page.properties?.['ID sản phẩm'])&&!plain(page.properties?.['Model ID']))continue;
   const row=this.parse(page);if(map.has(key(row)))throw Error('Notion có sản phẩm trùng shop + ID + Model ID. Không ghi thêm.');map.set(key(row),row);
  }return map;
 }
 props(r){return {'Tên sản phẩm':{title:rich(r.name)},'Tên shop':{rich_text:rich(r.shop)},'Giá bán':{number:r.price},'Kho hàng':{number:r.stock},'ID sản phẩm':{rich_text:rich(r.productId)},'Model ID':{rich_text:rich(r.modelId)},'Phân loại':{rich_text:rich(r.variant)},'Quét lúc':{date:{start:r.scannedAt}}};}
 async sync(emit=()=>{},onlyId){
  const remote=await this.remote();const rows=this.data.rows.filter(r=>r.sync==='pending'&&(!onlyId||r.id===onlyId));let done=0;
  for(const r of rows){
   try{const old=remote.get(key(r));const changed=!old||['name','price','stock','variant'].some(k=>old[k]!==r[k]);
    if(changed){const page=old?await this.i.notion('pages/'+old.notionPageId,'PATCH',{properties:this.props(r)}):await this.i.notion('pages','POST',{parent:{database_id:this.data.databaseId},properties:this.props(r)});r.notionPageId=page.id;}else r.notionPageId=old.notionPageId;
    r.sync='synced';delete r.error;for(const a of this.data.actions)if(a.productKey===key(r)&&a.status==='notion-pending')a.status='verified';
    for(const item of this.data.batch?.items||[])if(item.productKey===key(r)&&item.status==='notion-pending'){item.status='verified';delete item.error;}
    this.save();this.progress='Notion sản phẩm · '+(++done)+'/'+rows.length;emit();
   }catch(e){r.error=e.message;this.save();throw e;}
  }
  this.progress='Đã đồng bộ '+done+' dòng sản phẩm';emit();
 }
 async load(){
  if(this.data.rows.some(r=>r.sync==='pending'))throw Error('Còn dữ liệu Shopee chờ ghi Notion. Bấm Đồng bộ lại trước khi tải Notion.');
  const remote=await this.remote(),old=new Map(this.data.rows.map(r=>[key(r),r]));
  // A fresh machine can have Notion rows before its local product snapshot has
  // a shop binding. Read only the account label from each logged-in profile so
  // edit buttons become available without forcing a full product rescan.
  if(typeof this.scanner?.shop==='function'){
   const known=new Set(Object.values(this.data.shops).map(s=>s.name));
   for(const p of this.store.data.profiles.filter(p=>p.enabled)){
    if(this.data.shops[p.id]?.name)continue;
    try{
     const name=await this.scanner.shop(p.id);if(!name||known.has(name))continue;
     if([...remote.values()].some(r=>r.shop===name)){
      this.data.shops[p.id]={name,scannedAt:new Date().toISOString(),total:null,models:0};known.add(name);
     }
    }catch{}
   }
  }
  this.data.rows=[...remote.values()].map(r=>{const profileId=Object.keys(this.data.shops).find(id=>this.data.shops[id].name===r.shop);return {...r,id:old.get(key(r))?.id||randomUUID(),profileId:profileId||null,active:true,sync:'synced',source:'Notion'};});
  this.data.loadedAt=new Date().toISOString();this.progress='Đã tải '+this.data.rows.length+' dòng từ Notion';this.save();
 }
 async edit(id,input,{batchItem}={}){
  const r=this.data.rows.find(r=>r.id===id);if(!r||!r.profileId||!this.data.shops[r.profileId])throw Error('Chưa liên kết profile với shop. Quét shop này một lần trước khi sửa.');
  this.store.profile(r.profileId);const {validateEdit}=require('./product-scanner.cjs');const edit=validateEdit(input);
  if(r[edit.field]!==edit.expected)throw Error('Dữ liệu đã thay đổi. Đóng hộp sửa và chọn lại.');
  const action={id:randomUUID(),productKey:key(r),name:r.name,variant:r.variant,...edit,at:new Date().toISOString(),status:'preparing'};
  if(this.data.actions.some(a=>a.productKey===action.productKey&&a.status==='uncertain'))throw Error('Có thao tác chưa xác minh. Quét lại shop trước khi sửa tiếp.');
  this.data.actions.unshift(action);this.data.actions=this.data.actions.filter((a,i)=>i<300||a.status==='uncertain');this.save();
  if(batchItem){batchItem.actionId=action.id;this.save();}
  try{
   const result=await this.scanner.edit(r.profileId,r,edit,{beforeSubmit:()=>{action.status='submitted';this.save();}});
   Object.assign(r,result.row,{scannedAt:new Date().toISOString(),source:'Shopee',sync:'pending'});action.status='verified';this.save();
   try{await this.sync(()=>{},r.id);}catch(e){action.status='notion-pending';this.save();return {notionPending:true,message:'Shopee đã lưu và xác minh. Notion chưa ghi được; bấm Đồng bộ lại. '+e.message};}
   return {notionPending:false,message:'Đã xác minh '+(edit.field==='price'?'giá':'tồn kho')+' trên Shopee và đồng bộ Notion.'};
  }catch(e){action.status=action.status==='submitted'?'uncertain':'failed';action.error=e.message;this.save();throw e;}
 }
 stopBatch(){
  if(this.data.batch?.status!=='running')return;
  this.data.batch.stopRequested=true;this.save();
 }
 async editBatch(request,emit=()=>{},sanitize=e=>e.message){
  if(!request||typeof request.requestId!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(request.requestId))throw Error('Danh sách thay đổi không hợp lệ.');
  if(this.data.batch?.id===request.requestId)return this.data.batch;
  if(this.data.batch?.status==='running')throw Error('Đang chạy danh sách thay đổi.');
  if(!Array.isArray(request.items)||!request.items.length||request.items.length>1000)throw Error('Danh sách cần từ 1 đến 1.000 thay đổi.');
  const {validateEdit}=require('./product-scanner.cjs'),seen=new Set();
  const items=request.items.map(input=>{
   const edit=validateEdit(input),r=this.data.rows.find(r=>r.id===input.id);
   if(!r?.profileId||this.data.shops[r.profileId]?.name!==r.shop)throw Error('Sản phẩm chưa liên kết đúng profile. Tải dữ liệu Notion trước.');
   this.store.profile(r.profileId);
   if(r[edit.field]!==edit.expected)throw Error('Dữ liệu '+r.name+' đã thay đổi. Mở lại danh sách để kiểm tra.');
   const identity=key(r)+'|'+edit.field;if(seen.has(identity))throw Error('Một trường sản phẩm xuất hiện nhiều lần.');seen.add(identity);
   if(this.data.actions.some(a=>a.productKey===key(r)&&a.status==='uncertain'))throw Error('Có sản phẩm chưa xác minh thao tác trước. Quét lại shop trước khi chạy.');
   return {id:r.id,productKey:key(r),shop:r.shop,name:r.name,variant:r.variant,...edit,status:'queued'};
  });
  const batch={id:request.requestId,status:'running',startedAt:new Date().toISOString(),stopRequested:false,items};
  this.data.batch=batch;this.save();emit();
  try{
   for(let i=0;i<items.length;i++){
    const item=items[i];if(batch.stopRequested){item.status='cancelled';this.save();emit();continue;}
    item.status='running';this.progress='Sửa hàng loạt · '+(i+1)+'/'+items.length+' · '+item.shop+' · '+item.name;this.save();emit();
    try{
     const r=this.data.rows.find(r=>r.id===item.id);if(!r||key(r)!==item.productKey)throw Error('Sản phẩm đã thay đổi. Không sửa.');
     const result=await this.edit(item.id,item,{batchItem:item});item.status=result.notionPending?'notion-pending':'verified';
     if(result.notionPending)item.error=result.message;
    }catch(e){item.status=this.data.actions.find(a=>a.id===item.actionId)?.status==='uncertain'?'uncertain':'failed';item.error=sanitize(e);}
    this.save();emit();
   }
   batch.status=batch.stopRequested?'stopped':'completed';
  }finally{
   if(batch.status==='running'){batch.status='interrupted';for(const item of items)if(item.status==='queued')item.status='cancelled';}
   batch.finishedAt=new Date().toISOString();this.progress='Sửa hàng loạt · '+items.filter(i=>['verified','notion-pending'].includes(i.status)).length+'/'+items.length+' đã lưu Shopee';this.save();emit();
  }
  return batch;
 }
}
module.exports={Products,TARGET,key,validateRow};
