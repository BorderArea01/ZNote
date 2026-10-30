const {contextBridge,ipcRenderer}=require('electron');
let snapshot={};
try{snapshot=JSON.parse(decodeURIComponent(process.argv.find(a=>a.startsWith('--znote-appearance='))?.split('=').slice(1).join('=')||'%7B%7D'));}catch{}
const listeners=new Set();
ipcRenderer.on('appearance:changed',(_event,value)=>{snapshot=value;for(const callback of listeners)callback(value);});
contextBridge.exposeInMainWorld('ZNoteAppearance',{
 snapshot:()=>JSON.stringify(snapshot),
 set:value=>{ipcRenderer.invoke('appearance:set',value).catch(()=>{});},
 subscribe:callback=>{listeners.add(callback);return()=>listeners.delete(callback);}
});
