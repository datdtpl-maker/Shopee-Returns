const {app,BrowserWindow,ipcMain,safeStorage,shell,dialog,clipboard,Tray,Menu,nativeImage,powerSaveBlocker}=require('electron');
const fs=require('node:fs');const path=require('node:path');const { pathToFileURL }=require('node:url');
try{require('dotenv').config();const envData=path.join(process.env.SRM_DATA_DIR||path.join(__dirname,'..','data'),'.env');if(fs.existsSync(envData))require('dotenv').config({path:envData});}catch{}
const {Store}=require('./core.cjs');const {Scanner}=require('./scanner.cjs');const {Integrations}=require('./integrations.cjs');
const {Products,TARGET:PRODUCT_TARGET}=require('./products.cjs');const {ProductScanner}=require('./product-scanner.cjs');
const {InterfaceMonitor}=require('./interface-monitor.cjs');
const {ReplacementManager}=require('./replacements.cjs');const {ReplacementEditor}=require('./replacement-editor.cjs');const replacementImages=require('./replacement-images.cjs');
const {ReplacementStudio}=require('./replacement-studio.cjs');const {GeminiClient}=require('./studio-gemini.cjs');const {ChatGPTImages}=require('./studio-chatgpt.cjs');const {LocalDrive}=require('./studio-drive.cjs');const {DEFAULTS:STUDIO_DEFAULTS,studioInput,DEFAULT_GEMINI_API_KEY}=require('./studio-settings.cjs');
const {PromptLibrary}=require('./studio-prompts.cjs');
const {ManualImageFiles}=require('./studio-manual-files.cjs');
const {ChromeImageBridge}=require('./studio-chrome-bridge.cjs');
const {ChromePairingStorage}=require('./studio-chrome-pairing.cjs');
const {fetchSheet,sheetUrl}=require('./sheets.cjs');
let window,store,scanner,integrations,products,replacements,replacementEditor,studio,studioPrompts,gemini,chatgpt,drive,chromeBridge,interfaceMonitor,timer,secretFile,secretValues={},scanning=false,nextScan=null,clearingNotion=false;
const dataDir=process.env.SRM_DATA_DIR||(app.isPackaged?path.join(app.getPath('appData'),'ShopeeReturns','data'):path.join(__dirname,'..','data'));
try{fs.mkdirSync(dataDir,{recursive:true});}catch{}
const logFile=path.join(dataDir,'app.log');
function writeLog(level,msg){try{fs.appendFileSync(logFile,`[${new Date().toISOString()}] [${level}] ${msg}\n`);}catch{}}
let tray,powerBlocker;
const testMode=process.env.SRM_DRIVER==='1';
if(app.isPackaged&&!process.env.SRM_DATA_DIR)app.setPath('userData',path.join(app.getPath('appData'),'ShopeeReturns','electron'));
if(process.env.SRM_DATA_DIR) app.setPath('userData',path.join(dataDir,'electron'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-features', 'RendererCodeIntegrity');
app.commandLine.appendSwitch('proxy-bypass-list', '<local>;127.0.0.1;localhost');
writeLog('INIT','Hardware acceleration disabled. RendererCodeIntegrity disabled.');
writeLog('START',`Shopee Returns khởi động v${app.getVersion()} (Electron ${process.versions.electron}, Node ${process.versions.node}, arch ${process.arch}, PID ${process.pid})`);
process.on('uncaughtException',err=>{
  writeLog('FATAL',`UncaughtException: ${err?.stack||err}`);
  try{fs.appendFileSync(path.join(dataDir,'crash.log'),`[${new Date().toISOString()}] UncaughtException: ${err?.stack||err}\n`);}catch{}
});
process.on('unhandledRejection',reason=>{
  writeLog('FATAL',`UnhandledRejection: ${reason?.stack||reason}`);
  try{fs.appendFileSync(path.join(dataDir,'crash.log'),`[${new Date().toISOString()}] UnhandledRejection: ${reason?.stack||reason}\n`);}catch{}
});
const hasLock = app.requestSingleInstanceLock();
writeLog('LOCK', `requestSingleInstanceLock() trả về: ${hasLock}`);
if(!hasLock) {
  writeLog('QUIT', 'Ứng dụng thoát vì không có single instance lock (đang có tiến trình khác chạy).');
  app.quit();
} else {
app.on('second-instance',()=>{
  writeLog('INSTANCE', 'Nhận tín hiệu second-instance từ tiến trình khác.');
  if(window){if(window.isMinimized())window.restore();window.show();window.focus();}
});
app.whenReady().then(async()=>{
  writeLog('READY', 'app.whenReady() đã kích hoạt thành công.');
  store=new Store(dataDir);
  writeLog('STORE', 'Store đã sẵn sàng.');
  store.data.settings={startWithWindows:false,keepAwake:false,closeToTray:false,...store.data.settings};store.save();
  const applyRuntime=()=>{
    const s=store.data.settings;
    if(app.isPackaged&&!testMode)app.setLoginItemSettings({openAtLogin:!!s.startWithWindows,path:process.execPath});
    if(s.keepAwake&&s.autoScan){if(powerBlocker===undefined)powerBlocker=powerSaveBlocker.start('prevent-app-suspension');}
    else if(powerBlocker!==undefined){powerSaveBlocker.stop(powerBlocker);powerBlocker=undefined;}
  };
  applyRuntime();secretFile=path.join(dataDir,'credentials.enc');
  if(fs.existsSync(secretFile)) {
    try {secretValues=JSON.parse(safeStorage.decryptString(fs.readFileSync(secretFile)));}
    catch {store.log('error','Không giải mã được thông tin kết nối. Nhập lại token trong Cài đặt.');}
  }
  if(!secretValues.geminiApiKey)secretValues.geminiApiKey=process.env.GEMINI_API_KEY||DEFAULT_GEMINI_API_KEY;
  if(!secretValues.notionToken&&process.env.NOTION_TOKEN)secretValues.notionToken=process.env.NOTION_TOKEN.trim();
  if(!secretValues.telegramToken&&process.env.TELEGRAM_BOT_TOKEN)secretValues.telegramToken=process.env.TELEGRAM_BOT_TOKEN.trim();
  if(!store.data.settings.sheetUrl&&process.env.GOOGLE_SHEET_URL)store.data.settings.sheetUrl=process.env.GOOGLE_SHEET_URL.trim();
  if(!store.data.settings.notionDatabaseId&&process.env.NOTION_DATABASE_ID){
    store.data.settings.notionDatabaseId=process.env.NOTION_DATABASE_ID.trim();
    store.data.settings.notionPageId=process.env.NOTION_PAGE_ID?.trim()||process.env.NOTION_DATABASE_ID.trim();
  }
  if(!store.data.settings.chatId&&process.env.TELEGRAM_CHAT_ID)store.data.settings.chatId=process.env.TELEGRAM_CHAT_ID.trim();
  interfaceMonitor=new InterfaceMonitor(dataDir,()=>emit());
  scanner=new Scanner(dataDir,interfaceMonitor);integrations=new Integrations(store,()=>secretValues);products=new Products(dataDir,store,integrations,new ProductScanner(scanner));
  replacementEditor=new ReplacementEditor(products.scanner);replacements=new ReplacementManager(dataDir,products,integrations,replacementEditor,replacementImages,require('./replacement-notion-images.cjs'));
  store.data.settings.replacementStudio={...STUDIO_DEFAULTS,...store.data.settings.replacementStudio};store.save();
  const studioSettings=()=>store.data.settings.replacementStudio;
  const studioConnections={};
  let studioReferencePage;
  gemini=new GeminiClient(studioSettings,()=>secretValues,{onRetry:message=>{if(studio){studio.progress=message;emit();}}});drive=new LocalDrive(studioSettings);
  chatgpt=new ChatGPTImages(dataDir,studioSettings,message=>{if(studio){studio.progress=message;emit();}});
  studio=new ReplacementStudio(dataDir,{products,replacements,integrations,gemini,chatgpt,drive});
  const chromePairing=new ChromePairingStorage(dataDir,safeStorage);let chromePairingError='';
  chromeBridge=new ChromeImageBridge(dataDir,{port:testMode?0:9223,
    loadPairing:()=>{try{return chromePairing.load();}catch(error){chromePairingError=error.message;store.log('error',chromePairingError);return null;}},
    savePairing:value=>{try{chromePairing.save(value);}catch(error){store.log('error',error.message);throw error;}}
  });
  if(chromePairingError){chromeBridge.status=chromePairingError;chromeBridge.failed=true;}
  if(chromeBridge.snapshot().remembered)try{await chromeBridge.start();}catch(error){chromeBridge.status=safeError(error);chromeBridge.failed=true;store.log('error',chromeBridge.status);}
  studioPrompts=new PromptLibrary(dataDir);
  for(const p of store.data.profiles) if(p.status==='Đang quét') p.status='Cần quét lại';
  const snapshot=()=>({studioChatgpt:chatgpt.snapshot(),studioChrome:chromeBridge.snapshot(),studio:studio.snapshot(),studioPrompts:studioPrompts.snapshot(),studioConfig:{geminiModel:studioSettings().geminiModel,driveLocalFolder:studioSettings().driveLocalFolder,chatgptPort:studioSettings().chatgptPort,geminiConfigured:!!secretValues.geminiApiKey,geminiApiKey:secretValues.geminiApiKey||'',writingReferenceLoaded:!!studioSettings().writingReference,writingReference:studioSettings().writingReference||'',...studioConnections},replacements:replacements.snapshot(),interfaces:interfaceMonitor.snapshot(),products:products.snapshot(),profiles:store.data.profiles,orders:store.visibleOrders(),hiddenOrders:store.data.orders.length-store.visibleOrders().length,logs:store.data.logs,settings:store.data.settings,sheet:store.data.sheet||{},scanning,nextScan,clearingNotion,notionAwaitScan:!!store.data.notionAwaitScan,notionClearPending:!!store.data.notionClearPending,
    dataDir,version:app.getVersion(),credentials:{notion:!!secretValues.notionToken,telegram:!!secretValues.telegramToken},jobs:{pending:store.data.jobs.filter(j=>j.status==='pending'&&store.data.orders.some(o=>o.id===j.payload.orderKey&&store.isEligible(o))).length,errors:store.data.jobs.filter(j=>j.status==='pending'&&j.error&&store.data.orders.some(o=>o.id===j.payload.orderKey&&store.isEligible(o))).length}});
  const emit=()=>{if(window&&!window.isDestroyed()) window.webContents.send('state',snapshot());};
  studio.onChange=emit;
  chromeBridge.onChange=emit;
  studioPrompts.onChange=emit;
  const plan=()=>{nextScan=store.data.settings.autoScan&&!store.data.notionAwaitScan&&!store.data.notionClearPending?Date.now()+store.data.settings.intervalMinutes*60000:null;};
  const scan=async(id)=>{
    if(clearingNotion||store.data.notionClearPending)throw Error('Đang xoá hoặc chưa xoá xong Notion. Hoàn tất xoá trước khi quét.');
    if(products.busy)throw Error('Module Sản phẩm đang dùng trình duyệt. Lịch hoàn huỷ sẽ chạy ngay sau khi hoàn tất.');
    if(scanning) throw Error('Đang có lượt quét chạy. Vui lòng đợi.');
    const profiles=id?[store.profile(id)]:store.data.profiles.filter(p=>p.enabled);
    if(!profiles.length) throw Error('Thêm ít nhất một profile và đăng nhập Shopee.');
    scanning=true;integrations.paused=true;emit();
    // Finish any already-started outbound request before replacing its evidence.
    while(integrations.running)await new Promise(r=>setTimeout(r,25));
    store.invalidate(profiles.map(p=>p.id));emit();const succeeded=[],healthProfiles=[];
    try {
      for(const p of profiles) {
        p.status='Đang quét';emit();const profileStarted=Date.now();
        try {
          const result=await scanner.scan(p.id);const added=store.ingest(p.id,result.rows);
          if(result.unresolved){store.invalidate([p.id]);throw Error('Có dòng chưa đọc được. Chưa đối chiếu lượt này để tránh dữ liệu thiếu.');}
          succeeded.push(p.id);
          p.lastUnresolved=result.unresolved;
          p.lastTotal=result.totalOrders;p.lastIgnored=result.ignored;
          store.log(result.unresolved?'warning':'success',`${p.name}: đọc hết trang (${result.totalOrders} mã đơn), ${result.rows.length} đơn có chữ đỏ/xanh, ${added} đơn mới; ${result.ignored} mã không có màu cần lấy${result.unresolved?`, ${result.unresolved} dòng chưa đọc được — cần kiểm tra`:''}.`);
        } catch(e) {p.status='Cần kiểm tra';store.log('error',`${p.name}: ${safeError(e)}`);}
        // A completed browser probe (including a failed contract) also schedules
        // a read-only product-list probe. Mock scans without browser evidence do
        // not manufacture a health result or open unrelated real profiles.
        const evidence=interfaceMonitor.data.records[interfaceMonitor.key(p.id,'returns','list')];
        if(evidence&&Date.parse(evidence.checkedAt)>=profileStarted)healthProfiles.push(p);
        emit();
      }
      if(succeeded.length) {
        try {
          const result=await fetchSheet(store.data.settings.sheetUrl);const report=store.applySheet(result,succeeded);
          store.data.notionAwaitScan=false;
          store.log('success',`Google Sheet: đọc mới ${result.count} dòng; ${report.matched} đơn khớp chính xác và có một mã vận đơn; ${report.conflicts} đơn mâu thuẫn không hiển thị.`);
        }catch(e){store.invalidate(succeeded);store.data.sheet={...store.data.sheet,error:safeError(e)};store.log('error',`Google Sheet: ${safeError(e)} Không hiển thị hoặc gửi dữ liệu của lượt này.`);}
      }
      scanning=false;plan();store.save();emit();
      if(healthProfiles.length){
        // Deliver freshly matched returns before additional read-only UI probes.
        integrations.paused=false;await integrations.drain();
        for(const p of healthProfiles)try{await products.scanner.open(p.id);}catch(e){store.log('warning',`${p.name} · kiểm tra giao diện sản phẩm: ${safeError(e)}`);}
      }
    } finally {scanning=false;integrations.paused=false;plan();store.save();emit();}
    await integrations.drain();emit();return snapshot();
  };
  const handle=(name,fn)=>ipcMain.handle(name,async(event,...args)=>{
    if(event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame) return {ok:false,error:'Không được phép.'};
    try {return {ok:true,value:await fn(...args)};} catch(e) {return {ok:false,error:safeError(e)};}
  });
  handle('snapshot',snapshot);
  const productTask=async fn=>{
    if(products.busy||scanning||clearingNotion)throw Error('Trình duyệt đang bận. Hãy đợi thao tác hiện tại hoàn tất.');
    products.busy=true;emit();
    try{return await fn();}catch(e){store.log('error','Sản phẩm: '+safeError(e));throw e;}
    finally{
      products.busy=false;
      if(nextScan&&Date.now()>=nextScan){
        if(process.env.SRM_DRIVER==='1'){if(!scanning&&!clearingNotion)void scan().catch(e=>{store.log('error',safeError(e));plan();emit();});}
        else nextScan=Date.now()+60000;
      }
      emit();
    }
  };
  handle('products-scan',id=>productTask(async()=>{const ids=id?[store.profile(id).id]:store.data.profiles.filter(p=>p.enabled).map(p=>p.id);if(!ids.length)throw Error('Bật ít nhất một profile.');await products.scan(ids,emit);return products.snapshot();}));
  handle('products-load',()=>productTask(async()=>{await products.load();return products.snapshot();}));
  handle('products-delete-shop',shopName=>productTask(async()=>{products.deleteShop(shopName);return products.snapshot();}));
  handle('products-sync',()=>productTask(async()=>{await products.sync(emit);await replacements.syncPending();return products.snapshot();}));
  handle('products-edit',(id,input)=>productTask(()=>products.edit(id,input)));
  handle('products-edit-batch',request=>productTask(()=>products.editBatch(request,emit,safeError)));
  handle('products-stop-batch',()=>{products.stopBatch();emit();});
  handle('products-notion',()=>shell.openExternal('https://app.notion.com/p/'+String(products.data.databaseId||PRODUCT_TARGET).replace(/-/g,'')+'?v=3e070655a9aa81f1a2a5000c1380d3f4'));
  handle('replacements-load',()=>productTask(()=>replacements.loadLinks()));
  handle('replacements-inspect',id=>productTask(()=>replacementEditor.inspect(replacements.target(replacements.resolve(id)))));
  handle('replacements-template',id=>productTask(()=>replacements.createTemplate(id)));
  handle('replacements-prepare',(id,url)=>productTask(()=>replacements.prepare(id,url)));
  handle('replacements-run',id=>productTask(()=>replacements.run(id)));
  handle('replacements-open',url=>{require('./replacements.cjs').articleId(url);return shell.openExternal(url);});
  handle('studio-create',payload=>studio.create(payload));
  handle('studio-prompt-save',input=>studioPrompts.upsert(input));
  handle('studio-prompt-delete',id=>studioPrompts.remove(id));
  handle('studio-update',(id,patch)=>studio.update(id,patch));
  handle('studio-delete-draft',id=>{if(chromeBridge.snapshot().busy)throw Error('Đang tạo ảnh. Đợi hoàn tất trước khi xoá bản nháp.');return studio.deleteDraft(id);});
  handle('studio-generate',async id=>{
    try{const result=await studio.generate(id);Object.assign(studioConnections,{geminiStatus:'Đã viết bài bằng Gemini API.',geminiFailed:false,geminiCheckedAt:new Date().toISOString(),geminiCheckedModel:studioSettings().geminiModel});emit();return result;}
    catch(error){if(error.code?.startsWith('GEMINI_'))Object.assign(studioConnections,{geminiStatus:safeError(error),geminiFailed:true,geminiCheckedAt:new Date().toISOString(),geminiCheckedModel:studioSettings().geminiModel});emit();throw error;}
  });
  handle('studio-approve',id=>studio.approve(id));
  handle('studio-publish',id=>studio.publish(id));
  const manualImageIO=new ManualImageFiles({dialog,window:()=>window,clipboard});
  const referenceImageIO=new ManualImageFiles({dialog,window:()=>window,clipboard});
  const manualJob=id=>{if(studio.busy||chatgpt.busy)throw Error('Studio đang xử lý ảnh. Hãy chờ tác vụ hiện tại.');const job=studio.get(id);if(!job.notionUrl||!job.contentApproved||job.imagesReady)throw Error('Chọn bài đã đẩy Notion và chưa gắn ảnh.');return job;};
  handle('studio-image-prompts',id=>{manualJob(id);return studio.manualPrompts(id);});
  handle('studio-image-prompt-update',(id,index,text)=>{manualJob(id);return studio.updateImagePrompt(id,index,text);});
  handle('studio-image-prompt-reset',(id,index)=>{manualJob(id);return studio.resetImagePrompt(id,index);});
  handle('studio-image-copy',async(id,index)=>{manualJob(id);if(!Number.isInteger(index)||index<0||index>4)throw Error('Vị trí prompt không hợp lệ.');const prepared=await studio.manualPrompts(id);return manualImageIO.copy(prepared.prompts[index].text);});
  handle('studio-open-chatgpt-normal',()=>manualImageIO.openChrome());
  handle('studio-image-reference-pick',id=>{manualJob(id);return referenceImageIO.pick(id,0,true);});
  handle('studio-chrome-pair',()=>{if(studio.busy)throw Error('Đang tạo ảnh. Đợi hoàn tất để ghép Chrome.');return chromeBridge.pair();});
  handle('studio-chrome-disconnect',()=>{if(studio.busy||chromeBridge.snapshot().busy||products.busy)throw Error('Đang có tác vụ chạy. Đợi hoàn tất trước khi ngắt Chrome.');const result=chromeBridge.disconnect();emit();return result;});
  handle('studio-chrome-extension-folder',()=>shell.openPath(app.isPackaged?path.join(process.resourcesPath,'chrome-image-extension'):path.join(__dirname,'chrome-image-extension')));
  const runStudioImages=async(transport,id,selectionId,contentDigest,singleIndex)=>{
    const job=manualJob(id);
    drive.test();
    const provider=transport==='chrome-cdp'?chatgpt:chromeBridge;
    if(transport==='chrome-cdp')await chatgpt.test();
    else if(!chromeBridge.snapshot().ready)throw Error('Tab ChatGPT chưa sẵn sàng. Ghép tiện ích, mở chat trống và dọn bản nháp trước khi chạy.');
    if(!/^[a-f\d]{64}$/i.test(contentDigest||'')||contentDigest!==job.manualPromptDigest)throw Error('Chuẩn bị lại 5 prompt cho đúng bài trước khi tạo ảnh.');
    const reference=await referenceImageIO.reference(id,selectionId);
    if(!job.baseline){
      job.baseline={shop:job.shop,productId:job.productId,name:job.sourceName,images:[]};
      studio.save();
    }
    return studio.chromeImages(id,{bridge:provider,reference,contentDigest,transport,singleIndex});
  };
  handle('studio-chrome-run',(id,selectionId,digest)=>runStudioImages('chrome-extension',id,selectionId,digest));
  handle('studio-cdp-run',(id,selectionId,digest,singleIndex)=>runStudioImages('chrome-cdp',id,selectionId,digest,singleIndex));
  handle('studio-clear-image-logs',id=>{const result=studio.clearImageLogs(id);emit();return result;});
  handle('studio-clear-logs',id=>{const result=studio.clearLogs(id);emit();return result;});
  handle('studio-image-slot-pick-and-import',async(id,index,directPath=null)=>{
    let filePath=directPath;
    if(!filePath){
      const result=await dialog.showOpenDialog(window,{title:'Chọn ảnh '+(index+1)+' ('+(index+1)+'.png)',properties:['openFile'],filters:[{name:'Ảnh sản phẩm',extensions:['png','jpg','jpeg','webp']}]});
      if(result.canceled||!result.filePaths?.length)return {cancelled:true};
      filePath=result.filePaths[0];
    }
    const updatedJob=await studio.importSingleImage(id,index,filePath);emit();return {cancelled:false,job:updatedJob};
  });
  handle('studio-image-pick',(id,index)=>{const job=manualJob(id);if(job.driveAssets)throw Error('Bộ ảnh đã lưu. Gắn bộ ảnh hiện có vào Notion.');return manualImageIO.pick(id,index);});
  handle('studio-images-import',async(id,selectionIds,contentDigest)=>{
    const job=manualJob(id),paths=manualImageIO.paths(id,selectionIds);
    if(!job.baseline)await productTask(async()=>{const row=studio.row(job);job.baseline=await replacementEditor.inspect(replacements.target(row));studio.save();});
    const result=await studio.importLocalImages(id,paths,contentDigest);manualImageIO.clear(selectionIds);return result;
  });
  // ChatGPT uses its own profile. Keep Shopee available for scheduled returns.
  handle('studio-images',async id=>{
    if(studio.busy)throw Error('Studio đang chạy.');const job=studio.get(id);
    if(!job.notionUrl||!job.contentApproved)throw Error('Duyệt và đẩy bài Notion trước khi tạo ảnh.');
    if(!job.baseline)await productTask(async()=>{const row=studio.row(job);job.baseline=await replacementEditor.inspect(replacements.target(row));studio.save();});
    return studio.images(id);
  });
  handle('studio-attach',id=>productTask(()=>studio.attach(id)));
  handle('studio-replace',id=>productTask(()=>studio.replaceProduct(id)));
  handle('studio-activate',id=>productTask(async()=>{const selected=await studio.activate(id);return {...selected,plan:await replacements.prepare(selected.rowId,selected.url,{preserveStock:true})};}));
  handle('studio-load',()=>productTask(()=>studio.load()));
  handle('studio-sync-to-replacements',()=>studio.syncSourceToReplacements());
  handle('studio-scan-replacements',()=>studio.scanReplacements());
  handle('studio-config',input=>{
    if(studio.busy||products.busy||scanning||integrations.running)throw Error('Hãy đợi tác vụ đang chạy hoàn tất trước khi đổi kết nối.');
    const clean=studioInput(input),secrets={...secretValues};
    if(clean.geminiApiKey){
      secrets.geminiApiKey=clean.geminiApiKey;
      if(!safeStorage.isEncryptionAvailable())throw Error('Windows chưa sẵn sàng mã hoá API key.');
      fs.writeFileSync(secretFile+'.tmp',safeStorage.encryptString(JSON.stringify(secrets)));fs.renameSync(secretFile+'.tmp',secretFile);secretValues=secrets;
    }
    delete clean.geminiApiKey;
    if(clean.chatgptPort&&clean.chatgptPort!==studioSettings().chatgptPort)chatgpt.binding=null;
    if(input.geminiApiKey?.trim()||clean.geminiModel!==undefined&&clean.geminiModel!==studioSettings().geminiModel)for(const field of ['geminiStatus','geminiFailed','geminiCheckedAt','geminiCheckedModel'])delete studioConnections[field];
    if(clean.driveLocalFolder!==undefined&&clean.driveLocalFolder!==studioSettings().driveLocalFolder)delete studioConnections.driveStatus;
    if(clean.chatgptPort!==undefined&&clean.chatgptPort!==studioSettings().chatgptPort)delete studioConnections.chatgptStatus;
    Object.assign(store.data.settings.replacementStudio,clean);store.save();emit();return snapshot().studioConfig;
  });
  const geminiConnect=async method=>{
    if(studio.busy)throw Error('Studio đang chạy. Đợi hoàn tất để kiểm tra kết nối.');
    try{const result=await gemini[method]();if(result.selected)store.data.settings.replacementStudio.geminiModel=result.selected;Object.assign(studioConnections,{geminiStatus:result.message,geminiFailed:false,geminiCheckedAt:new Date().toISOString(),geminiCheckedModel:result.selected||studioSettings().geminiModel});store.save();emit();return result;}
    catch(error){Object.assign(studioConnections,{geminiStatus:safeError(error),geminiFailed:true,geminiCheckedAt:new Date().toISOString(),geminiCheckedModel:studioSettings().geminiModel});emit();throw error;}
  };
  handle('studio-models',()=>geminiConnect('models'));handle('studio-test',()=>geminiConnect('test'));
  handle('studio-chatgpt-open',async()=>{if(studio.busy)throw Error('Studio đang chạy.');const result=await chatgpt.open();studioConnections.chatgptStatus=result.message;emit();return result;});
  handle('studio-chatgpt-test',async()=>{if(studio.busy)throw Error('Studio đang chạy.');const result=await chatgpt.test();studioConnections.chatgptStatus=result.message;emit();return result;});
  handle('studio-drive-test',()=>{const result=drive.test();studioConnections.driveStatus=result.message;emit();return result;});
  handle('studio-drive-folder',async()=>{
    if(studio.busy)throw Error('Studio đang chạy.');
    const result=await dialog.showOpenDialog(window,{title:'Chọn thư mục ảnh Google Drive local',defaultPath:studioSettings().driveLocalFolder,properties:['openDirectory']});
    if(result.canceled)return {cancelled:true};const clean=studioInput({driveLocalFolder:result.filePaths[0]});Object.assign(store.data.settings.replacementStudio,clean);store.save();emit();return {cancelled:false,folder:clean.driveLocalFolder};
  });
  handle('studio-open-folder',id=>{const job=studio.get(id);if(!job.localFolder)throw Error('Bài này chưa có thư mục ảnh local.');const root=drive.root(),folder=fs.realpathSync(job.localFolder),relative=path.relative(root,folder);if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('Thư mục ảnh nằm ngoài Drive đã chọn.');return shell.openPath(folder);});
  handle('studio-reference',()=>productTask(async()=>{
    const own=products.data.rows.find(r=>r.productId==='46268625740'&&r.profileId);let description,name;
    if(own){const source=await replacementEditor.inspect(replacements.target(replacements.resolve(own.id)));description=source.description;name=source.name;}
    else {
      const profile=store.data.profiles.find(p=>p.enabled);if(!profile)throw Error('Bật một profile Shopee để đọc link bài mẫu công khai.');
      const ctx=await scanner.context(profile.id);
      if(!studioReferencePage||studioReferencePage.isClosed())studioReferencePage=await ctx.newPage();
      const page=studioReferencePage;await page.goto('https://shopee.vn/product/1474107882/46268625740/',{waitUntil:'domcontentloaded',timeout:60000});
      const read=require('./studio-reference.cjs').readPublicReference;
      await page.waitForFunction(read,null,{timeout:20000}).catch(()=>{});
      const result=await page.evaluate(read);
      if(!result)throw Error('Trang bài mẫu công khai chưa đọc được hoặc cần xác minh Shopee. Hoàn tất xác minh trong tab vừa mở rồi đọc lại; có thể dán cấu trúc bài tham khảo trong Kết nối Studio.');
      ({description,name}=result);
    }
    if(!description)throw Error('Chưa đọc được nội dung bài mẫu Shopee.');
    studioSettings().writingReference=description;store.save();emit();return {message:'Đã đọc cấu trúc bài mẫu Shopee.',name};
  }));
  handle('interfaces-check',()=>productTask(async()=>{
    const profiles=store.data.profiles.filter(p=>p.enabled);if(!profiles.length)throw Error('Bật ít nhất một profile đã đăng nhập.');
    for(const p of profiles){
      products.progress='Kiểm tra giao diện · '+p.name;emit();
      for(const probe of [()=>scanner.scan(p.id),()=>products.scanner.open(p.id)])try{await probe();}catch(e){store.log('warning',p.name+' · '+safeError(e));}
    }
    products.progress='Đã kiểm tra giao diện danh sách của hai module. Hộp sửa được kiểm tra khi sử dụng.';emit();return interfaceMonitor.snapshot();
  }));
  handle('interfaces-report',id=>shell.showItemInFolder(interfaceMonitor.reportPath(id)));
  handle('interfaces-accept',id=>productTask(async()=>{
    const row=interfaceMonitor.snapshot().find(r=>r.id===id);if(!row?.canAccept)throw Error('Cấu trúc chưa phù hợp. Cần sửa bộ đọc và kiểm tra lại.');
    const answer=await dialog.showMessageBox(window,{type:'question',message:'Dùng mẫu DOM/CSS vừa kiểm tra làm mẫu đối chiếu mới?',detail:'Chỉ chấp nhận sau khi bạn đã xem báo cáo. Thao tác này không sửa selector hay luồng chạy. Cấu trúc thiếu thành phần hoặc đổi nhóm màu vận chuyển không được chấp nhận.',buttons:['Huỷ','Chấp nhận mẫu'],defaultId:0,cancelId:0,noLink:true});
    if(answer.response===1)interfaceMonitor.accept(id);
  }));

  handle('clear-notion',async()=>{
    if(scanning||clearingNotion||products.busy)throw Error('Hãy đợi lượt quét hoặc thao tác xoá đang chạy hoàn tất.');
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
    if(scanning||clearingNotion||integrations.running||products.busy)throw Error('Đang quét hoặc đồng bộ dữ liệu. Vui lòng đợi hoàn tất rồi lưu tên lại.');
    store.renameProfile(id,name);emit();void integrations.drain().then(emit);return snapshot();
  });
  handle('toggle-profile',(id,enabled)=>{if(scanning||products.busy)throw Error('Hãy đợi thao tác trình duyệt kết thúc.');store.profile(id).enabled=!!enabled;if(!enabled)store.invalidate([id]);store.save();emit();});
  handle('login',id=>productTask(async()=>{store.profile(id);await scanner.login(id);store.profile(id).status='Đã mở trình duyệt';store.save();emit();}));
  handle('scan',scan);
  handle('refresh-sheet',()=>scan());
  const saveSettings=async input=>{
    if(clearingNotion)throw Error('Hãy đợi thao tác xoá Notion hoàn tất.');
    if(!input||typeof input!=='object')throw Error('Cài đặt không hợp lệ.');
    if(scanning||integrations.running||products.busy||studio.busy)throw Error('Hãy đợi lượt quét và đồng bộ hoàn tất trước khi đổi cài đặt.');
    const {notionIds,connectionInput}=require('./configuration.cjs');
    input=connectionInput(input);
    const {notionPageId,notionDatabaseId}=notionIds(input,store.data.settings);
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
    if(notionDatabaseId!==store.data.settings.notionDatabaseId){integrations.readyDatabase=null;for(const o of store.data.orders){o.notionPageId=null;delete o.notionSyncedRevision;delete o.notionVerifiedAt;}}
    Object.assign(store.data.settings,{notionPageId,notionDatabaseId,startWithWindows:input.startWithWindows??store.data.settings.startWithWindows,keepAwake:input.keepAwake??store.data.settings.keepAwake,closeToTray:input.closeToTray??store.data.settings.closeToTray,intervalMinutes:minutes,autoScan:!!input.autoScan,telegramEnabled:!!input.telegramEnabled,notionEnabled:!!input.notionEnabled,chatId,sheetUrl:sheetSource});store.save();applyRuntime();plan();emit();
    void integrations.drain().then(emit);return snapshot();
  };
  handle('settings',saveSettings);
  handle('open-data',()=>shell.openPath(dataDir));
  handle('import-config',async()=>{
    if(scanning||clearingNotion||integrations.running)throw Error('Hãy đợi lượt quét và đồng bộ hoàn tất.');
    const result=await dialog.showOpenDialog(window,{title:'Nhập cấu hình kết nối',properties:['openFile'],filters:[{name:'Cấu hình JSON',extensions:['json']}]});
    if(result.canceled)return {cancelled:true};
    const file=result.filePaths[0];if(fs.statSync(file).size>65536)throw Error('File cấu hình quá lớn (tối đa 64 KB).');
    let input;try{input=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch{throw Error('File JSON không hợp lệ.');}
    const clean=require('./configuration.cjs').connectionInput(input);
    const current={...store.data.settings};delete current.replacementStudio;
    await saveSettings({...current,...clean});return {cancelled:false};
  });
  handle('connect-notion',async()=>{if(clearingNotion)throw Error('Đang xoá Notion.');const id=await integrations.setupNotion();store.log('success','Notion: đã kết nối bảng Theo dõi hoàn huỷ Shopee.');emit();return id;});
  handle('retry',()=>{for(const j of store.data.jobs) if(j.status==='pending') j.nextAt=0;store.save();void integrations.drain().then(emit);});
  handle('open-notion',()=>shell.openExternal('https://app.notion.com/p/'+String(store.data.settings.notionDatabaseId||store.data.settings.notionPageId).replace(/-/g,'')+'?v=3f070655a9aa81c0bf94000c57957eb2&pvs=11'));
  handle('open-sheet',()=>{sheetUrl(store.data.settings.sheetUrl);return shell.openExternal(store.data.settings.sheetUrl);});
  if(process.env.SRM_DRIVER==='1') app.srmDriver={scanner,store,integrations,products,replacements,replacementEditor,studio,gemini,chatgpt,drive,manualImageIO,referenceImageIO,chromeBridge,interfaceMonitor};
  const appVersion = app.getVersion();
  window=new BrowserWindow({
    width:1420,
    height:960,
    minWidth:760,
    minHeight:620,
    title:`Shopee · Quản lý hoàn huỷ v${appVersion}`,
    backgroundColor:'#f5f6f8',
    webPreferences:{
      preload:path.join(__dirname,'preload.cjs'),
      contextIsolation:true,
      nodeIntegration:false,
      sandbox:false
    }
  });
  window.webContents.on('did-start-loading',()=>{
    writeLog('RENDERER','Bắt đầu nạp file giao diện...');
  });
  window.webContents.on('did-finish-load',()=>{
    writeLog('RENDERER',`Đã nạp xong giao diện. Title cửa sổ: ${window.getTitle()}`);
  });
  window.webContents.on('did-fail-load',(e,errorCode,errorDesc,validatedURL)=>{
    const msg=`Lỗi tải trang: ${errorDesc} (mã: ${errorCode}, URL: ${validatedURL})`;
    writeLog('ERROR',msg);
    try{store?.log('error',msg);}catch{}
    dialog.showErrorBox('Lỗi nạp giao diện Shopee Returns',msg+`\n\nChi tiết xem tại: ${logFile}`);
  });
  window.webContents.on('render-process-gone',(e,details)=>{
    const msg=`Tiến trình renderer bị thoát: ${details.reason} (exitCode: ${details.exitCode})`;
    writeLog('FATAL',msg);
    try{store?.log('error',msg);}catch{}
    dialog.showErrorBox('Lỗi hiển thị màn hình (Crash)',msg+`\n\nChi tiết xem tại: ${logFile}`);
  });
  window.webContents.on('console-message',(e,level,message,line,sourceId)=>{
    const levelNames=['DEBUG','INFO','WARN','ERROR'];
    writeLog('CONSOLE',`[${levelNames[level]||level}] (${path.basename(sourceId||'')}:${line}) ${message}`);
  });
  window.webContents.on('unresponsive',()=>{
    writeLog('WARN','Cửa sổ renderer bị treo (unresponsive).');
  });
  window.webContents.on('responsive',()=>{
    writeLog('INFO','Cửa sổ renderer đã phản hồi lại (responsive).');
  });
  window.webContents.on('before-input-event',(event,input)=>{
    if(input.type==='keyDown'){
      if(input.key==='F12'||(input.control&&input.shift&&(input.key==='I'||input.key==='i'))){
        if(window.webContents.isDevToolsOpened())window.webContents.closeDevTools();
        else window.webContents.openDevTools({mode:'detach'});
      }
    }
  });
  window.webContents.on('context-menu',(e,params)=>{
    const menu=Menu.buildFromTemplate([
      {label:'Tải lại trang (Reload)',click:()=>window.webContents.reload()},
      {label:'Kiểm tra phần tử / DevTools (F12)',click:()=>window.webContents.openDevTools({mode:'detach'})}
    ]);
    menu.popup(window);
  });
  tray=new Tray(nativeImage.createFromPath(path.join(__dirname,'icon.png')));
  tray.setToolTip('Shopee Returns — đang chạy');
  const show=()=>{window.show();if(window.isMinimized())window.restore();window.focus();};
  tray.setContextMenu(Menu.buildFromTemplate([{label:'Mở Shopee Returns',click:show},{label:'Thoát hoàn toàn',click:()=>app.quit()}]));tray.on('double-click',show);
  window.on('close',e=>{if(!quitting&&store.data.settings.closeToTray){e.preventDefault();window.hide();}});
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',(e,url)=>{
    if(!url.startsWith('file://'))e.preventDefault();
  });
  const htmlPath=path.join(__dirname,'index.html');
  const fileUrl=pathToFileURL(htmlPath).href;
  try{
    writeLog('INFO',`Đang nạp URL: ${fileUrl} (File: ${htmlPath})`);
    await window.loadURL(fileUrl);
    writeLog('INFO','window.loadURL đã hoàn tất.');
  }catch(err){
    writeLog('WARN',`loadURL thất bại: ${err?.message||err}. Đang thử lại với loadFile...`);
    try {
      await new Promise(r=>setTimeout(r,300));
      await window.loadFile(htmlPath);
      writeLog('INFO','window.loadFile dự phòng đã hoàn tất.');
    } catch(err2) {
      const loadErr=`Không thể nạp giao diện ${htmlPath}: ${err2?.message||err2}`;
      writeLog('FATAL',loadErr);
      if(!testMode) dialog.showErrorBox('Lỗi khởi động giao diện',loadErr);
    }
  }
  plan();timer=setInterval(()=>{
    if(nextScan&&Date.now()>=nextScan&&!scanning&&!clearingNotion&&!products.busy) void scan().catch(e=>{store.log('error',safeError(e));plan();emit();});
    void integrations.drain().then(emit);
  },5000);
  if(process.env.SRM_DRIVER!=='1'&&!store.data.notionAwaitScan&&!store.data.notionClearPending&&store.data.profiles.some(p=>p.enabled))void scan().catch(e=>{store.log('error',safeError(e));emit();});
});
}
function safeError(e) {let text=String(e.message||'Có lỗi xảy ra.');for(const v of Object.values(secretValues)) if(v) text=text.split(v).join('[ẩn]');return text.replace(/https:\/\/api\.telegram\.org\/bot[^/\s]+/g,'Telegram').slice(0,500);}
let quitting=false;
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',e=>{if(quitting) return;if(testMode){quitting=true;clearInterval(timer);return;}e.preventDefault();quitting=true;clearInterval(timer);if(powerBlocker!==undefined)powerSaveBlocker.stop(powerBlocker);tray?.destroy();Promise.race([Promise.allSettled([scanner?.close(),chromeBridge?.close()]),new Promise(r=>setTimeout(r,5000))]).finally(()=>app.quit());});

