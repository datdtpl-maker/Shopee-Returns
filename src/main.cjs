const {app,BrowserWindow,ipcMain,safeStorage,shell,dialog}=require('electron');
const fs=require('node:fs');const path=require('node:path');
const {Store}=require('./core.cjs');const {Scanner}=require('./scanner.cjs');const {Integrations}=require('./integrations.cjs');
const {fetchSheet,sheetUrl}=require('./sheets.cjs');
let window,store,scanner,integrations,timer,secretFile,secretValues={},scanning=false,nextScan=null,clearingNotion=false;
const dataDir=process.env.SRM_DATA_DIR||path.join(__dirname,'..','data');
if(process.env.SRM_DATA_DIR) app.setPath('userData',path.join(dataDir,'electron'));
if(!app.requestSingleInstanceLock()) app.quit();
else {
app.on('second-instance',()=>{window?.show();window?.focus();});
app.whenReady().then(async()=>{
  store=new Store(dataDir);secretFile=path.join(dataDir,'credentials.enc');
  if(fs.existsSync(secretFile)) {
    try {secretValues=JSON.parse(safeStorage.decryptString(fs.readFileSync(secretFile)));}
    catch {store.log('error','Không giải mã được thông tin kết nối. Nhập lại token trong Cài đặt.');}
  }
  scanner=new Scanner(dataDir);integrations=new Integrations(store,()=>secretValues);
  for(const p of store.data.profiles) if(p.status==='Đang quét') p.status='Cần quét lại';
  const snapshot=()=>({profiles:store.data.profiles,orders:store.visibleOrders(),hiddenOrders:store.data.orders.length-store.visibleOrders().length,logs:store.data.logs,settings:store.data.settings,sheet:store.data.sheet||{},scanning,nextScan,clearingNotion,notionAwaitScan:!!store.data.notionAwaitScan,notionClearPending:!!store.data.notionClearPending,
    credentials:{notion:!!secretValues.notionToken,telegram:!!secretValues.telegramToken},jobs:{pending:store.data.jobs.filter(j=>j.status==='pending'&&store.data.orders.some(o=>o.id===j.payload.orderKey&&store.isEligible(o))).length,errors:store.data.jobs.filter(j=>j.status==='pending'&&j.error&&store.data.orders.some(o=>o.id===j.payload.orderKey&&store.isEligible(o))).length}});
  const emit=()=>{if(window&&!window.isDestroyed()) window.webContents.send('state',snapshot());};
  const plan=()=>{nextScan=store.data.settings.autoScan&&!store.data.notionAwaitScan&&!store.data.notionClearPending?Date.now()+store.data.settings.intervalMinutes*60000:null;};
  const scan=async(id)=>{
    if(clearingNotion||store.data.notionClearPending)throw Error('Đang xoá hoặc chưa xoá xong Notion. Hoàn tất xoá trước khi quét.');
    if(scanning) throw Error('Đang có lượt quét chạy. Vui lòng đợi.');
    const profiles=id?[store.profile(id)]:store.data.profiles.filter(p=>p.enabled);
    if(!profiles.length) throw Error('Thêm ít nhất một profile và đăng nhập Shopee.');
    scanning=true;integrations.paused=true;emit();
    // Finish any already-started outbound request before replacing its evidence.
    while(integrations.running)await new Promise(r=>setTimeout(r,25));
    store.invalidate(profiles.map(p=>p.id));emit();const succeeded=[];
    try {
      for(const p of profiles) {
        p.status='Đang quét';emit();
        try {
          const result=await scanner.scan(p.id);const added=store.ingest(p.id,result.rows);
          if(result.unresolved){store.invalidate([p.id]);throw Error('Có dòng chưa đọc được. Chưa đối chiếu lượt này để tránh dữ liệu thiếu.');}
          succeeded.push(p.id);
          p.lastUnresolved=result.unresolved;
          p.lastTotal=result.totalOrders;p.lastIgnored=result.ignored;
          store.log(result.unresolved?'warning':'success',`${p.name}: đọc hết trang (${result.totalOrders} mã đơn), ${result.rows.length} đơn có chữ đỏ/xanh, ${added} đơn mới; ${result.ignored} mã không có màu cần lấy${result.unresolved?`, ${result.unresolved} dòng chưa đọc được — cần kiểm tra`:''}.`);
        } catch(e) {p.status='Cần kiểm tra';store.log('error',`${p.name}: ${safeError(e)}`);}
        emit();
      }
      if(succeeded.length) {
        try {
          const result=await fetchSheet(store.data.settings.sheetUrl);const report=store.applySheet(result,succeeded);
          store.data.notionAwaitScan=false;
          store.log('success',`Google Sheet: đọc mới ${result.count} dòng; ${report.matched} đơn khớp chính xác và có một mã vận đơn; ${report.conflicts} đơn mâu thuẫn không hiển thị.`);
        }catch(e){store.invalidate(succeeded);store.data.sheet={...store.data.sheet,error:safeError(e)};store.log('error',`Google Sheet: ${safeError(e)} Không hiển thị hoặc gửi dữ liệu của lượt này.`);}
      }
    } finally {scanning=false;integrations.paused=false;plan();store.save();emit();}
    await integrations.drain();emit();return snapshot();
  };
  const handle=(name,fn)=>ipcMain.handle(name,async(event,...args)=>{
    if(event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame) return {ok:false,error:'Không được phép.'};
    try {return {ok:true,value:await fn(...args)};} catch(e) {return {ok:false,error:safeError(e)};}
  });
  handle('snapshot',snapshot);
  handle('clear-notion',async()=>{
    if(scanning||clearingNotion)throw Error('Hãy đợi lượt quét hoặc thao tác xoá đang chạy hoàn tất.');
    clearingNotion=true;integrations.paused=true;nextScan=null;emit();
    try {
      while(integrations.running)await new Promise(r=>setTimeout(r,25));
      const db=await integrations.setupNotion();const pages=await integrations.listPages(db);
      const answer=await dialog.showMessageBox(window,{type:'warning',title:'Xoá dữ liệu Notion',message:`Xoá ${pages.length} bản ghi trong bảng Theo dõi hoàn huỷ Shopee?`,detail:'Các bản ghi được đưa vào thùng rác Notion và sao lưu trên máy. Giữ nguyên cột, profile, dữ liệu Shopee/Sheet và trạng thái xử lý trong app. Sau khi xoá, lịch tạm dừng đến khi bạn bấm Quét ngay.',buttons:['Huỷ','Xoá dữ liệu Notion'],defaultId:0,cancelId:0,noLink:true});
      if(answer.response!==1)return {cancelled:true};
      const result=await integrations.clearNotion();store.log('success',`Đã xoá ${result.archived} bản ghi Notion. Bấm Quét ngay để ghi dữ liệu mới.`);return result;
    }finally{clearingNotion=false;integrations.paused=false;plan();emit();}
  });
  handle('add-profile',name=>{store.addProfile(name);emit();return snapshot();});
  handle('rename-profile',(id,name)=>{
    if(scanning||clearingNotion||integrations.running)throw Error('Đang quét hoặc đồng bộ dữ liệu. Vui lòng đợi hoàn tất rồi lưu tên lại.');
    store.renameProfile(id,name);emit();void integrations.drain().then(emit);return snapshot();
  });
  handle('toggle-profile',(id,enabled)=>{if(scanning)throw Error('Hãy đợi lượt quét kết thúc.');store.profile(id).enabled=!!enabled;if(!enabled)store.invalidate([id]);store.save();emit();});
  handle('login',async id=>{store.profile(id);if(scanning) throw Error('Hãy đợi lượt quét hoàn tất trước khi mở đăng nhập.');await scanner.login(id);store.profile(id).status='Đã mở trình duyệt';store.save();emit();});
  handle('scan',scan);
  handle('refresh-sheet',()=>scan());
  handle('settings',async input=>{
    if(clearingNotion)throw Error('Hãy đợi thao tác xoá Notion hoàn tất.');
    if(!input||typeof input!=='object')throw Error('Cài đặt không hợp lệ.');
    if(scanning)throw Error('Hãy đợi lượt quét hoàn tất trước khi đổi cài đặt.');
    const sheetSource=String(input.sheetUrl||store.data.settings.sheetUrl).trim();sheetUrl(sheetSource);
    const minutes=Number(input.intervalMinutes);if(!Number.isInteger(minutes)||minutes<1||minutes>1440) throw Error('Chu kỳ quét phải từ 1 đến 1440 phút.');
    const chatId=String(input.chatId||'').trim();if(chatId&&!/^(-?\d+|@[A-Za-z0-9_]{5,})$/.test(chatId)) throw Error('Chat ID Telegram không hợp lệ.');
    const secrets={...secretValues};
    if(input.notionToken?.trim()) {if(!/^(ntn_|secret_)[A-Za-z0-9]+$/.test(input.notionToken.trim())) throw Error('Định dạng Notion token không hợp lệ.');secrets.notionToken=input.notionToken.trim();}
    if(input.telegramToken?.trim()) {if(!/^\d+:[A-Za-z0-9_-]+$/.test(input.telegramToken.trim())) throw Error('Định dạng Telegram token không hợp lệ.');secrets.telegramToken=input.telegramToken.trim();}
    if(input.telegramEnabled&&(!secrets.telegramToken||!chatId)) throw Error('Nhập Bot Token và Chat ID trước khi bật Telegram.');
    if(input.notionEnabled&&!secrets.notionToken) throw Error('Nhập token trước khi bật Notion.');
    if(!safeStorage.isEncryptionAvailable()) throw Error('Windows chưa sẵn sàng mã hoá token.');
    fs.writeFileSync(secretFile+'.tmp',safeStorage.encryptString(JSON.stringify(secrets)));fs.renameSync(secretFile+'.tmp',secretFile);secretValues=secrets;
    if(sheetSource!==store.data.settings.sheetUrl)store.invalidate();
    Object.assign(store.data.settings,{intervalMinutes:minutes,autoScan:!!input.autoScan,telegramEnabled:!!input.telegramEnabled,notionEnabled:!!input.notionEnabled,chatId,sheetUrl:sheetSource});store.save();plan();emit();
    void integrations.drain().then(emit);return snapshot();
  });
  handle('connect-notion',async()=>{if(clearingNotion)throw Error('Đang xoá Notion.');const id=await integrations.setupNotion();store.log('success','Notion: đã kết nối bảng Theo dõi hoàn huỷ Shopee.');emit();return id;});
  handle('retry',()=>{for(const j of store.data.jobs) if(j.status==='pending') j.nextAt=0;store.save();void integrations.drain().then(emit);});
  handle('open-notion',()=>shell.openExternal('https://www.notion.so/'+store.data.settings.notionPageId));
  handle('open-sheet',()=>{sheetUrl(store.data.settings.sheetUrl);return shell.openExternal(store.data.settings.sheetUrl);});
  if(process.env.SRM_DRIVER==='1') app.srmDriver={scanner,store,integrations};
  window=new BrowserWindow({width:1420,height:960,minWidth:760,minHeight:620,title:'Shopee · Quản lý hoàn huỷ',backgroundColor:'#f5f6f8',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',e=>e.preventDefault());
  await window.loadFile(path.join(__dirname,'index.html'));
  plan();timer=setInterval(()=>{
    if(nextScan&&Date.now()>=nextScan&&!scanning&&!clearingNotion) void scan().catch(e=>{store.log('error',safeError(e));plan();emit();});
    void integrations.drain().then(emit);
  },5000);
  if(process.env.SRM_DRIVER!=='1'&&!store.data.notionAwaitScan&&!store.data.notionClearPending&&store.data.profiles.some(p=>p.enabled))void scan().catch(e=>{store.log('error',safeError(e));emit();});
});
}
function safeError(e) {let text=String(e.message||'Có lỗi xảy ra.');for(const v of Object.values(secretValues)) if(v) text=text.split(v).join('[ẩn]');return text.replace(/https:\/\/api\.telegram\.org\/bot[^/\s]+/g,'Telegram').slice(0,500);}
let quitting=false;
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',e=>{if(quitting) return;e.preventDefault();quitting=true;clearInterval(timer);Promise.race([Promise.resolve(scanner?.close()),new Promise(r=>setTimeout(r,5000))]).finally(()=>app.quit());});

