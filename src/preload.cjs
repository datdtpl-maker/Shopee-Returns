const {contextBridge,ipcRenderer}=require('electron');
const manualActions=['studio-image-reference-pick','studio-chrome-pair','studio-chrome-disconnect','studio-chrome-extension-folder','studio-chrome-run','studio-image-prompts','studio-image-copy','studio-open-chatgpt-normal','studio-image-pick','studio-images-import'];
const allowed=new Set(['replacements-load','replacements-inspect','replacements-template','replacements-prepare','replacements-run','replacements-open','snapshot','interfaces-check','interfaces-report','interfaces-accept','products-scan','products-load','products-delete-shop','products-sync','products-edit','products-edit-batch','products-stop-batch','products-notion','import-config','open-data','add-profile','rename-profile','toggle-profile','login','scan','settings','connect-notion','retry','open-notion','refresh-sheet','open-sheet','clear-notion']);
for(const name of ['studio-create','studio-update','studio-generate','studio-approve','studio-publish','studio-images','studio-attach','studio-activate','studio-load','studio-config','studio-models','studio-test','studio-chatgpt-open','studio-chatgpt-test','studio-drive-test','studio-drive-folder','studio-open-folder','studio-reference','studio-prompt-save','studio-prompt-delete'])allowed.add(name);
for(const name of manualActions)allowed.add(name);
allowed.add('studio-delete-draft');
allowed.add('studio-cdp-run');
allowed.add('studio-clear-image-logs');
allowed.add('studio-clear-logs');
allowed.add('studio-image-slot-pick-and-import');
allowed.add('studio-replace');
allowed.add('studio-image-prompt-update');
allowed.add('studio-image-prompt-reset');
allowed.add('studio-sync-to-replacements');
allowed.add('studio-scan-replacements');
contextBridge.exposeInMainWorld('srm',{
  call:async(name,...args)=>{if(!allowed.has(name)) throw Error('Thao tác không hợp lệ.');const r=await ipcRenderer.invoke(name,...args);if(!r.ok) throw Error(r.error);return r.value;},
  subscribe:callback=>{const listener=(_event,data)=>callback(data);ipcRenderer.on('state',listener);return()=>ipcRenderer.removeListener('state',listener);}
});
