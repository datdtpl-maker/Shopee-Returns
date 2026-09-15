const {contextBridge,ipcRenderer}=require('electron');
const allowed=new Set(['snapshot','add-profile','rename-profile','toggle-profile','login','scan','order-state','settings','connect-notion','retry','open-notion','refresh-sheet','open-sheet','clear-notion']);
contextBridge.exposeInMainWorld('srm',{
  call:async(name,...args)=>{if(!allowed.has(name)) throw Error('Thao tác không hợp lệ.');const r=await ipcRenderer.invoke(name,...args);if(!r.ok) throw Error(r.error);return r.value;},
  subscribe:callback=>{const listener=(_event,data)=>callback(data);ipcRenderer.on('state',listener);return()=>ipcRenderer.removeListener('state',listener);}
});
